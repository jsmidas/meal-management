#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingredient Bulk Change Router (Rewritten)
식자재 일괄변경 API - 완전 재작성 버전

주요 개선사항:
1. 모든 DB 연결에 context manager (with) 패턴 사용 - 예외 발생 시에도 연결 반환 보장
2. 트랜잭션 관리 개선 - 에러 시 자동 롤백
3. 변경 이력 기록 (ingredient_change_history 테이블)
4. 예약 변경 기능 (scheduled_ingredient_changes 테이블)
5. 타입 안전성 강화
6. 레시피별 식자재 삭제/수량 수정 기능 추가
"""

from datetime import datetime, date
from decimal import Decimal
from fastapi import APIRouter, Request, Query, HTTPException
from typing import Optional, List, Dict, Any
from core.database import get_db_connection
from contextlib import contextmanager
import uuid
import traceback

router = APIRouter()


# ============================================================================
# 헬퍼 함수들
# ============================================================================

def decimal_to_float(value) -> Optional[float]:
    """Decimal 또는 숫자를 float로 안전하게 변환"""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def generate_batch_id() -> str:
    """일괄 작업용 고유 ID 생성"""
    return str(uuid.uuid4())[:8]


def get_client_ip(request: Request) -> str:
    """클라이언트 IP 추출"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ============================================================================
# 테이블 초기화 (최초 1회 실행)
# ============================================================================

_tables_initialized = False


def ensure_tables_exist():
    """필요한 테이블이 없으면 생성"""
    global _tables_initialized
    if _tables_initialized:
        return

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # ingredient_change_history 테이블 확인 및 생성
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'ingredient_change_history'
            )
        """)
        if not cursor.fetchone()[0]:
            cursor.execute("""
                CREATE TABLE ingredient_change_history (
                    id SERIAL PRIMARY KEY,
                    change_type VARCHAR(50) NOT NULL,
                    recipe_id INTEGER NOT NULL,
                    recipe_name VARCHAR(200),
                    mri_id INTEGER,
                    old_ingredient_code VARCHAR(50),
                    old_ingredient_name VARCHAR(200),
                    old_quantity DECIMAL(10, 3),
                    old_unit VARCHAR(20),
                    old_selling_price DECIMAL(12, 2),
                    new_ingredient_code VARCHAR(50),
                    new_ingredient_name VARCHAR(200),
                    new_quantity DECIMAL(10, 3),
                    new_unit VARCHAR(20),
                    new_selling_price DECIMAL(12, 2),
                    change_reason TEXT,
                    changed_by VARCHAR(100),
                    batch_id VARCHAR(50),
                    effective_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # 인덱스 생성
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_ich_recipe_id ON ingredient_change_history(recipe_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_ich_batch_id ON ingredient_change_history(batch_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_ich_created_at ON ingredient_change_history(created_at)")
            conn.commit()

        # scheduled_ingredient_changes 테이블 확인 및 생성
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'scheduled_ingredient_changes'
            )
        """)
        if not cursor.fetchone()[0]:
            cursor.execute("""
                CREATE TABLE scheduled_ingredient_changes (
                    id SERIAL PRIMARY KEY,
                    recipe_id INTEGER NOT NULL,
                    recipe_name VARCHAR(200),
                    mri_id INTEGER NOT NULL,
                    current_ingredient_code VARCHAR(50) NOT NULL,
                    current_ingredient_name VARCHAR(200),
                    current_quantity DECIMAL(10, 3),
                    current_unit VARCHAR(20),
                    new_ingredient_code VARCHAR(50) NOT NULL,
                    new_ingredient_name VARCHAR(200),
                    new_quantity DECIMAL(10, 3),
                    new_unit VARCHAR(20),
                    new_selling_price DECIMAL(12, 2),
                    new_supplier_name VARCHAR(100),
                    new_specification VARCHAR(200),
                    effective_date DATE NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    batch_id VARCHAR(50),
                    created_by VARCHAR(100),
                    cancel_reason TEXT,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    applied_at TIMESTAMP,
                    cancelled_at TIMESTAMP
                )
            """)
            # 인덱스 생성
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sic_effective_date ON scheduled_ingredient_changes(effective_date)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sic_status ON scheduled_ingredient_changes(status)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sic_recipe_id ON scheduled_ingredient_changes(recipe_id)")
            conn.commit()

        _tables_initialized = True


# ============================================================================
# API 엔드포인트
# ============================================================================

@router.get("/api/site-groups")
async def get_site_groups():
    """
    사업장 그룹 목록 조회

    Returns:
        success: 성공 여부
        groups: 사업장 그룹 목록
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, group_code, group_name, description, display_order
                FROM site_groups
                WHERE is_active = true
                ORDER BY display_order, id
            """)

            groups = []
            for row in cursor.fetchall():
                groups.append({
                    'id': row[0],
                    'code': row[1],
                    'name': row[2],
                    'description': row[3],
                    'display_order': row[4]
                })

            return {"success": True, "groups": groups}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/ingredient-mismatch")
async def get_ingredient_mismatch(
    group_id: int = Query(None, description="사업장 그룹 ID (없으면 전체)")
):
    """
    식자재 불일치 레시피 조회

    같은 베이스명(예: '된장찌개')의 레시피들 중
    식자재 구성이 다른 경우를 찾아 반환합니다.

    Args:
        group_id: 사업장 그룹 ID (선택)

    Returns:
        mismatch_groups: 불일치 그룹 목록
    """
    try:
        ensure_tables_exist()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 모든 레시피의 베이스명과 재료 조회
            recipe_query = """
                SELECT
                    mr.id as recipe_id,
                    mr.recipe_name,
                    REGEXP_REPLACE(mr.recipe_name, '-[^-]+$', '') as base_name,
                    mr.scope,
                    mr.owner_group_id,
                    mri.ingredient_code,
                    mri.ingredient_name,
                    mri.quantity,
                    mri.unit,
                    i.selling_price,
                    i.supplier_name,
                    i.price_per_unit
                FROM menu_recipes mr
                JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                WHERE mr.is_active = true
            """
            params = []

            if group_id:
                recipe_query += " AND (mr.owner_group_id = %s OR mr.scope = 'global')"
                params.append(group_id)

            recipe_query += " ORDER BY mr.recipe_name, mri.sort_order"

            cursor.execute(recipe_query, params)
            rows = cursor.fetchall()

            # 레시피별로 재료 그룹화
            recipes: Dict[int, Dict[str, Any]] = {}
            for row in rows:
                recipe_id = row[0]
                if recipe_id not in recipes:
                    recipes[recipe_id] = {
                        'id': recipe_id,
                        'name': row[1],
                        'base_name': row[2],
                        'scope': row[3],
                        'group_id': row[4],
                        'ingredients': {}
                    }

                ing_code = row[5]
                if ing_code:
                    recipes[recipe_id]['ingredients'][ing_code] = {
                        'code': ing_code,
                        'name': row[6],
                        'quantity': decimal_to_float(row[7]) or 0,
                        'unit': row[8],
                        'price': decimal_to_float(row[9]) or 0,
                        'supplier': row[10],
                        'price_per_unit': decimal_to_float(row[11]) or 0
                    }

            # 베이스명으로 그룹화
            base_groups: Dict[str, List[int]] = {}
            for recipe_id, recipe_data in recipes.items():
                base_name = recipe_data['base_name']
                if base_name not in base_groups:
                    base_groups[base_name] = []
                base_groups[base_name].append(recipe_id)

            # 불일치 감지
            mismatch_groups = []
            for base_name, recipe_ids in base_groups.items():
                if len(recipe_ids) < 2:
                    continue

                # 각 레시피의 재료 코드 집합 비교
                all_codes: set = set()
                recipe_codes: Dict[int, set] = {}

                for rid in recipe_ids:
                    codes = set(recipes[rid]['ingredients'].keys())
                    recipe_codes[rid] = codes
                    all_codes.update(codes)

                # 불일치 재료 찾기
                mismatched_items = []
                for code in all_codes:
                    recipes_with = []
                    recipes_without = []
                    ingredient_info = None

                    for rid in recipe_ids:
                        if code in recipe_codes[rid]:
                            recipes_with.append(rid)
                            if not ingredient_info:
                                ingredient_info = recipes[rid]['ingredients'][code]
                        else:
                            recipes_without.append(rid)

                    if recipes_with and recipes_without:
                        mismatched_items.append({
                            'ingredient_code': code,
                            'ingredient_name': ingredient_info['name'] if ingredient_info else '',
                            'unit': ingredient_info['unit'] if ingredient_info else '',
                            'price': ingredient_info['price'] if ingredient_info else 0,
                            'price_per_unit': ingredient_info['price_per_unit'] if ingredient_info else 0,
                            'supplier': ingredient_info['supplier'] if ingredient_info else '',
                            'used_in': [recipes[rid]['name'] for rid in recipes_with],
                            'used_in_ids': recipes_with,
                            'not_in': [recipes[rid]['name'] for rid in recipes_without],
                            'not_in_ids': recipes_without
                        })

                if mismatched_items:
                    recipe_details = []
                    for rid in recipe_ids:
                        r = recipes[rid]
                        recipe_details.append({
                            'id': rid,
                            'name': r['name'],
                            'scope': r['scope'],
                            'group_id': r['group_id'],
                            'ingredients': list(r['ingredients'].values())
                        })

                    mismatch_groups.append({
                        'base_name': base_name,
                        'recipe_count': len(recipe_ids),
                        'recipes': recipe_details,
                        'mismatched_items': mismatched_items
                    })

            # 베이스명 기준 정렬
            mismatch_groups.sort(key=lambda x: x['base_name'])

            return {
                "success": True,
                "total_mismatch_groups": len(mismatch_groups),
                "mismatch_groups": mismatch_groups
            }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/recipes/using-ingredient")
async def get_recipes_using_ingredient(
    ingredient_code: str = Query(..., description="식자재 코드"),
    group_id: int = Query(None, description="사업장 그룹 ID (없으면 전체)")
):
    """
    특정 식자재를 사용하는 레시피 목록 조회

    식자재 교체 시 영향받는 레시피를 파악하기 위해 사용합니다.
    각 레시피의 현재 사용량(quantity)을 포함합니다.

    Args:
        ingredient_code: 식자재 코드
        group_id: 사업장 그룹 ID (선택)

    Returns:
        ingredient: 식자재 정보
        recipes: 해당 식자재를 사용하는 레시피 목록
    """
    try:
        ensure_tables_exist()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 식자재 정보 조회
            cursor.execute("""
                SELECT i.ingredient_code, i.ingredient_name, i.specification, i.unit,
                       i.selling_price, i.price_per_unit, i.supplier_name
                FROM ingredients i
                WHERE i.ingredient_code = %s
            """, (ingredient_code,))
            ing_row = cursor.fetchone()

            if not ing_row:
                return {"success": False, "error": "식자재를 찾을 수 없습니다."}

            ingredient_info = {
                'code': ing_row[0],
                'name': ing_row[1],
                'specification': ing_row[2],
                'unit': ing_row[3],
                'selling_price': decimal_to_float(ing_row[4]) or 0,
                'price_per_unit': decimal_to_float(ing_row[5]) or 0,
                'supplier_name': ing_row[6] or ''
            }

            # 해당 식자재를 사용하는 레시피 조회
            recipe_query = """
                SELECT
                    mr.id as recipe_id,
                    mr.recipe_name,
                    mr.scope,
                    mr.owner_group_id,
                    mri.quantity,
                    mri.unit,
                    mri.id as mri_id,
                    sg.group_name
                FROM menu_recipe_ingredients mri
                JOIN menu_recipes mr ON mri.recipe_id = mr.id
                LEFT JOIN site_groups sg ON mr.owner_group_id = sg.id
                WHERE mri.ingredient_code = %s
                  AND mr.is_active = true
            """
            params = [ingredient_code]

            if group_id:
                recipe_query += " AND (mr.owner_group_id = %s OR mr.scope = 'global')"
                params.append(group_id)

            recipe_query += " ORDER BY mr.recipe_name"

            cursor.execute(recipe_query, params)
            rows = cursor.fetchall()

            recipes = []
            for row in rows:
                recipes.append({
                    'recipe_id': row[0],
                    'recipe_name': row[1],
                    'scope': row[2],
                    'group_id': row[3],
                    'quantity': decimal_to_float(row[4]) or 0,
                    'unit': row[5] or ingredient_info['unit'],
                    'mri_id': row[6],
                    'group_name': row[7] or '전체'
                })

            return {
                "success": True,
                "ingredient": ingredient_info,
                "recipe_count": len(recipes),
                "recipes": recipes
            }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/ingredients/used-in-recipes")
async def search_ingredients_used_in_recipes(
    keyword: str = Query(..., description="검색어"),
    limit: int = Query(30, description="결과 개수"),
    group_id: int = Query(None, description="그룹 ID (사업장 필터링)")
):
    """
    레시피에서 실제 사용 중인 식자재 검색

    menu_recipe_ingredients에 존재하는 식자재만 검색합니다.
    같은 이름의 식자재는 그룹화하여 사용 레시피 수를 표시합니다.
    group_id가 있으면 해당 그룹에 매핑된 협력업체의 식자재만 검색합니다.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 ID가 있으면 해당 그룹의 협력업체 목록 조회
            supplier_filter = ""
            supplier_names = []
            if group_id:
                cursor.execute("""
                    SELECT DISTINCT s.name
                    FROM customer_supplier_mappings csm
                    JOIN suppliers s ON csm.supplier_id = s.id
                    JOIN business_locations bl ON csm.customer_id = bl.id
                    WHERE bl.group_id = %s AND csm.is_active = 1
                """, (group_id,))
                supplier_names = [row[0] for row in cursor.fetchall()]
                if supplier_names:
                    placeholders = ','.join(['%s'] * len(supplier_names))
                    supplier_filter = f"AND COALESCE(i.supplier_name, mri.supplier_name) IN ({placeholders})"

            # 레시피에서 사용 중인 식자재 중 키워드와 일치하는 것 검색
            query = f"""
                SELECT
                    mri.ingredient_code,
                    mri.ingredient_name,
                    mri.specification,
                    mri.unit,
                    COALESCE(i.selling_price, mri.selling_price) as selling_price,
                    COALESCE(i.price_per_unit, 0) as price_per_unit,
                    COALESCE(i.supplier_name, mri.supplier_name) as supplier_name,
                    COUNT(DISTINCT mri.recipe_id) as recipe_count
                FROM menu_recipe_ingredients mri
                LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                JOIN menu_recipes mr ON mri.recipe_id = mr.id AND mr.is_active = true
                WHERE mri.ingredient_name ILIKE %s
                {supplier_filter}
                GROUP BY
                    mri.ingredient_code,
                    mri.ingredient_name,
                    mri.specification,
                    mri.unit,
                    i.selling_price,
                    mri.selling_price,
                    i.price_per_unit,
                    i.supplier_name,
                    mri.supplier_name
                ORDER BY recipe_count DESC, mri.ingredient_name
                LIMIT %s
            """
            params = [f'%{keyword}%'] + supplier_names + [limit]
            cursor.execute(query, params)

            rows = cursor.fetchall()

            results = []
            for row in rows:
                results.append({
                    'ingredient_code': row[0],
                    'ingredient_name': row[1],
                    'specification': row[2] or '',
                    'unit': row[3] or '',
                    'selling_price': decimal_to_float(row[4]) or 0,
                    'price_per_unit': decimal_to_float(row[5]) or 0,
                    'supplier_name': row[6] or '',
                    'recipe_count': row[7]
                })

            return {
                "success": True,
                "count": len(results),
                "results": results
            }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/ingredients/search-for-replace")
async def search_ingredients_for_replace(
    keyword: str = Query(..., description="검색어"),
    current_code: str = Query(None, description="현재 식자재 코드 (제외용)"),
    limit: int = Query(50, description="결과 개수"),
    group_id: int = Query(None, description="그룹 ID (사업장 필터링)")
):
    """
    대체 식자재 검색

    키워드로 식자재를 검색하고, 단가 정보를 포함하여 반환합니다.
    결과는 다함직구매 우선, 그 다음 단위당 단가(price_per_unit) 기준 오름차순 정렬됩니다.
    group_id가 있으면 해당 그룹에 매핑된 협력업체의 식자재만 검색합니다.

    Args:
        keyword: 검색어 (식자재명 또는 코드)
        current_code: 현재 식자재 코드 (검색 결과에서 제외)
        limit: 결과 개수 제한
        group_id: 그룹 ID (사업장 필터링)

    Returns:
        results: 검색된 식자재 목록
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 ID가 있으면 해당 그룹의 협력업체 목록 조회
            supplier_filter = ""
            supplier_names = []
            if group_id:
                cursor.execute("""
                    SELECT DISTINCT s.name
                    FROM customer_supplier_mappings csm
                    JOIN suppliers s ON csm.supplier_id = s.id
                    JOIN business_locations bl ON csm.customer_id = bl.id
                    WHERE bl.group_id = %s AND csm.is_active = 1
                """, (group_id,))
                supplier_names = [row[0] for row in cursor.fetchall()]
                if supplier_names:
                    placeholders = ','.join(['%s'] * len(supplier_names))
                    supplier_filter = f" AND i.supplier_name IN ({placeholders})"

            # 활성화된 공급업체의 식자재만 검색 (suppliers.is_active = 1)
            # 다함직구매 우선, 그 다음 단위당 단가 낮은 순
            query = f"""
                SELECT
                    i.ingredient_code,
                    i.ingredient_name,
                    i.specification,
                    i.unit,
                    i.selling_price,
                    i.price_per_unit,
                    i.supplier_name
                FROM ingredients i
                LEFT JOIN suppliers s ON i.supplier_name = s.name
                WHERE (i.ingredient_name ILIKE %s OR i.ingredient_code ILIKE %s)
                  AND i.posting_status IN ('유', '판매중', '무')
                  AND (s.is_active = 1 OR s.is_active IS NULL)
                  {supplier_filter}
            """
            params = [f'%{keyword}%', f'%{keyword}%'] + supplier_names

            if current_code:
                query += " AND i.ingredient_code != %s"
                params.append(current_code)

            # 다함직구매 우선, 그 다음 단위당 단가 낮은 순
            # psycopg2에서 literal %는 %%로 이스케이프
            query += """
                ORDER BY
                    CASE WHEN i.supplier_name ILIKE '%%다함직구매%%' THEN 0 ELSE 1 END,
                    COALESCE(i.price_per_unit, 999999) ASC
                LIMIT %s
            """
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            results = []
            for row in rows:
                results.append({
                    'ingredient_code': row[0],
                    'name': row[1],
                    'specification': row[2],
                    'unit': row[3],
                    'selling_price': decimal_to_float(row[4]) or 0,
                    'price_per_unit': decimal_to_float(row[5]) or 0,
                    'supplier_name': row[6] or ''
                })

            return {
                "success": True,
                "count": len(results),
                "results": results
            }

    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/recipes/compare-group")
async def compare_recipe_group(
    recipe_ids: str = Query(..., description="레시피 ID 목록 (쉼표 구분)")
):
    """
    레시피 그룹 비교 - 여러 레시피의 전체 재료를 비교합니다.

    Args:
        recipe_ids: 레시피 ID 목록 (쉼표로 구분)

    Returns:
        recipes: 각 레시피의 정보와 재료 목록
        all_ingredients: 모든 재료의 통합 목록 (비교용)
        mismatches: 불일치 재료 정보
    """
    try:
        ids = [int(x.strip()) for x in recipe_ids.split(',') if x.strip()]

        if not ids:
            return {"success": False, "error": "레시피 ID가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 레시피 기본 정보 조회
            placeholders = ','.join(['%s'] * len(ids))
            cursor.execute(f"""
                SELECT id, recipe_name, scope, owner_group_id
                FROM menu_recipes
                WHERE id IN ({placeholders}) AND is_active = true
                ORDER BY recipe_name
            """, ids)

            recipe_rows = cursor.fetchall()

            if not recipe_rows:
                return {"success": False, "error": "레시피를 찾을 수 없습니다"}

            recipes = {}
            for row in recipe_rows:
                recipes[row[0]] = {
                    'id': row[0],
                    'name': row[1],
                    'scope': row[2],
                    'group_id': row[3],
                    'ingredients': []
                }

            # 각 레시피의 재료 조회
            cursor.execute(f"""
                SELECT
                    mri.recipe_id,
                    mri.id as mri_id,
                    mri.ingredient_code,
                    mri.ingredient_name,
                    mri.quantity,
                    mri.unit,
                    COALESCE(i.selling_price, mri.selling_price) as selling_price,
                    COALESCE(i.price_per_unit, 0) as price_per_unit,
                    COALESCE(i.supplier_name, mri.supplier_name) as supplier_name,
                    mri.specification,
                    mri.sort_order,
                    COALESCE(mri.required_grams, 0) as required_grams
                FROM menu_recipe_ingredients mri
                LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                WHERE mri.recipe_id IN ({placeholders})
                ORDER BY mri.recipe_id, mri.sort_order, mri.ingredient_name
            """, ids)

            ingredient_rows = cursor.fetchall()

            # 모든 재료 코드 수집 (비교용)
            all_ingredient_codes = {}
            recipe_ingredient_map = {rid: {} for rid in recipes.keys()}

            for row in ingredient_rows:
                recipe_id = row[0]
                if recipe_id not in recipes:
                    continue

                ing_data = {
                    'mri_id': row[1],
                    'code': row[2],
                    'name': row[3],
                    'quantity': decimal_to_float(row[4]) or 0,
                    'unit': row[5] or '',
                    'price': decimal_to_float(row[6]) or 0,
                    'price_per_unit': decimal_to_float(row[7]) or 0,
                    'supplier': row[8] or '',
                    'specification': row[9] or '',
                    'sort_order': row[10] or 0,
                    'required_grams': decimal_to_float(row[11]) or 0
                }

                recipes[recipe_id]['ingredients'].append(ing_data)

                # 재료 코드별로 매핑
                code = row[2]
                recipe_ingredient_map[recipe_id][code] = ing_data

                if code not in all_ingredient_codes:
                    all_ingredient_codes[code] = {
                        'code': code,
                        'name': row[3],
                        'in_recipes': [],
                        'not_in_recipes': []
                    }
                all_ingredient_codes[code]['in_recipes'].append(recipe_id)

            # 불일치 분석
            recipe_id_list = list(recipes.keys())
            all_ingredients_list = []

            for code, info in all_ingredient_codes.items():
                # 어떤 레시피에 없는지 확인
                not_in = [rid for rid in recipe_id_list if rid not in info['in_recipes']]
                info['not_in_recipes'] = not_in
                info['is_mismatch'] = len(not_in) > 0 and len(info['in_recipes']) > 0

                # 각 레시피별 수량 정보 추가
                info['by_recipe'] = {}
                for rid in recipe_id_list:
                    if code in recipe_ingredient_map[rid]:
                        ing = recipe_ingredient_map[rid][code]
                        info['by_recipe'][rid] = {
                            'has': True,
                            'quantity': ing['quantity'],
                            'unit': ing['unit'],
                            'mri_id': ing['mri_id'],
                            'required_grams': ing['required_grams']
                        }
                    else:
                        info['by_recipe'][rid] = {
                            'has': False,
                            'quantity': 0,
                            'unit': '',
                            'required_grams': 0
                        }

                all_ingredients_list.append(info)

            # 이름순 정렬 (불일치 항목 먼저)
            all_ingredients_list.sort(key=lambda x: (not x['is_mismatch'], x['name']))

            return {
                "success": True,
                "recipes": list(recipes.values()),
                "all_ingredients": all_ingredients_list,
                "recipe_count": len(recipes),
                "ingredient_count": len(all_ingredients_list),
                "mismatch_count": sum(1 for x in all_ingredients_list if x['is_mismatch'])
            }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/ingredient-mismatch/preview")
async def preview_bulk_change(
    recipe_ids: str = Query(..., description="레시피 ID 목록 (쉼표 구분)"),
    old_code: str = Query(..., description="기존 식자재 코드"),
    new_code: str = Query(..., description="새 식자재 코드")
):
    """
    일괄 변경 미리보기

    변경 전/후 비교 정보를 제공합니다.

    Args:
        recipe_ids: 레시피 ID 목록 (쉼표로 구분)
        old_code: 기존 식자재 코드
        new_code: 새 식자재 코드

    Returns:
        old_ingredient: 기존 식자재 정보
        new_ingredient: 새 식자재 정보
        affected_recipes: 영향받는 레시피 목록
        price_difference: 가격 차이
    """
    try:
        recipe_id_list = [int(x.strip()) for x in recipe_ids.split(',') if x.strip()]

        if not recipe_id_list:
            return {"success": False, "error": "레시피 ID가 없습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 식자재 정보
            cursor.execute("""
                SELECT ingredient_code, name, specification, unit, selling_price
                FROM ingredients WHERE ingredient_code = %s
            """, (old_code,))
            old_ing = cursor.fetchone()

            # 새 식자재 정보
            cursor.execute("""
                SELECT ingredient_code, name, specification, unit, selling_price
                FROM ingredients WHERE ingredient_code = %s
            """, (new_code,))
            new_ing = cursor.fetchone()

            if not new_ing:
                return {"success": False, "error": "새 식자재를 찾을 수 없습니다."}

            # 영향받는 레시피 목록
            affected_recipes = []
            for rid in recipe_id_list:
                cursor.execute("""
                    SELECT mr.recipe_name, mri.quantity, mri.unit
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    WHERE mr.id = %s AND mri.ingredient_code = %s
                """, (rid, old_code))
                row = cursor.fetchone()
                if row:
                    affected_recipes.append({
                        'recipe_id': rid,
                        'recipe_name': row[0],
                        'current_qty': decimal_to_float(row[1]) or 0,
                        'current_unit': row[2]
                    })

            old_data = {
                'code': old_ing[0] if old_ing else old_code,
                'name': old_ing[1] if old_ing else '(알 수 없음)',
                'specification': old_ing[2] if old_ing else '',
                'unit': old_ing[3] if old_ing else '',
                'price': decimal_to_float(old_ing[4]) if old_ing else 0
            }

            new_data = {
                'code': new_ing[0],
                'name': new_ing[1],
                'specification': new_ing[2],
                'unit': new_ing[3],
                'price': decimal_to_float(new_ing[4]) or 0
            }

            # 가격 차이 계산
            price_diff = (new_data['price'] or 0) - (old_data['price'] or 0)
            price_diff_percent = (price_diff / old_data['price'] * 100) if old_data['price'] and old_data['price'] > 0 else 0

            return {
                "success": True,
                "old_ingredient": old_data,
                "new_ingredient": new_data,
                "price_difference": round(price_diff, 2),
                "price_difference_percent": round(price_diff_percent, 1),
                "affected_recipes": affected_recipes,
                "affected_count": len(affected_recipes)
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/ingredient-bulk-change")
async def apply_ingredient_bulk_change(request: Request):
    """
    식자재 일괄 변경 적용

    선택된 레시피들의 특정 식자재를 다른 식자재로 변경합니다.
    변경 이력은 ingredient_change_history 테이블에 기록됩니다.

    Request Body:
        recipe_ids: 변경할 레시피 ID 목록
        old_ingredient_code: 기존 식자재 코드
        new_ingredient_code: 새 식자재 코드
        adjust_quantity: 수량 자동 조정 여부 (선택)
        change_reason: 변경 사유 (선택)

    Returns:
        updated_count: 변경된 레시피 수
        batch_id: 변경 배치 ID (이력 조회용)
    """
    try:
        ensure_tables_exist()

        data = await request.json()
        recipe_ids = data.get('recipe_ids', [])
        old_ingredient_code = data.get('old_ingredient_code')
        new_ingredient_code = data.get('new_ingredient_code')
        change_reason = data.get('change_reason', '')

        if not recipe_ids:
            return {"success": False, "error": "변경할 레시피를 선택해주세요."}

        if not new_ingredient_code:
            return {"success": False, "error": "새 식자재를 선택해주세요."}

        batch_id = generate_batch_id()
        client_ip = get_client_ip(request)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # ★★★ 새 식자재 정보 조회 (base_weight_grams 포함) ★★★
                cursor.execute("""
                    SELECT i.ingredient_code, i.ingredient_name, i.specification, i.unit,
                           i.selling_price, i.supplier_name,
                           COALESCE(i.base_weight_grams, 1000) as base_weight_grams
                    FROM ingredients i
                    WHERE i.ingredient_code = %s
                """, (new_ingredient_code,))
                new_ing = cursor.fetchone()

                if not new_ing:
                    return {"success": False, "error": "새 식자재를 찾을 수 없습니다."}

                new_ing_data = {
                    'code': new_ing[0],
                    'name': new_ing[1],
                    'specification': new_ing[2],
                    'unit': new_ing[3],
                    'price': decimal_to_float(new_ing[4]) or 0,
                    'supplier_name': new_ing[5] or '',
                    'base_weight_grams': decimal_to_float(new_ing[6]) or 1000  # ★ 새 식자재 base_weight
                }

                updated_count = 0
                updated_recipes = []

                for recipe_id in recipe_ids:
                    # 기존 재료 확인
                    if old_ingredient_code:
                        # ★★★ required_grams 조회 추가 ★★★
                        cursor.execute("""
                            SELECT mri.id, mri.quantity, mri.unit, mri.ingredient_name,
                                   mri.selling_price, mr.recipe_name,
                                   COALESCE(mri.required_grams, 0) as required_grams
                            FROM menu_recipe_ingredients mri
                            JOIN menu_recipes mr ON mri.recipe_id = mr.id
                            WHERE mri.recipe_id = %s AND mri.ingredient_code = %s
                        """, (recipe_id, old_ingredient_code))
                        existing = cursor.fetchone()

                        if existing:
                            mri_id = existing[0]
                            old_qty = existing[1]
                            old_unit = existing[2]
                            old_name = existing[3]
                            old_price = existing[4]
                            recipe_name = existing[5]
                            required_grams = decimal_to_float(existing[6]) or 0  # ★ 1인당 필요량(g)

                            # ★★★ 핵심: required_grams 기반으로 new_quantity 재계산 ★★★
                            # required_grams를 유지하면서, 새 식자재의 base_weight_grams로 quantity 재계산
                            if required_grams > 0 and new_ing_data['base_weight_grams'] > 0:
                                new_qty = round(required_grams / new_ing_data['base_weight_grams'], 6)
                            else:
                                # required_grams가 없으면 기존 quantity 유지 (호환성)
                                new_qty = decimal_to_float(old_qty) or 0

                            # 변경 이력 기록
                            cursor.execute("""
                                INSERT INTO ingredient_change_history
                                (change_type, recipe_id, recipe_name, mri_id,
                                 old_ingredient_code, old_ingredient_name, old_quantity, old_unit, old_selling_price,
                                 new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                                 change_reason, changed_by, batch_id)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """, (
                                'bulk_replace', recipe_id, recipe_name, mri_id,
                                old_ingredient_code, old_name, old_qty, old_unit, old_price,
                                new_ing_data['code'], new_ing_data['name'], new_qty, new_ing_data['unit'], new_ing_data['price'],
                                change_reason, client_ip, batch_id
                            ))

                            # ★★★ 식자재 업데이트 (quantity 재계산 반영, required_grams 유지) ★★★
                            cursor.execute("""
                                UPDATE menu_recipe_ingredients
                                SET ingredient_code = %s,
                                    ingredient_name = %s,
                                    specification = %s,
                                    unit = %s,
                                    selling_price = %s,
                                    supplier_name = %s,
                                    quantity = %s
                                WHERE id = %s
                            """, (
                                new_ing_data['code'],
                                new_ing_data['name'],
                                new_ing_data['specification'],
                                new_ing_data['unit'],
                                new_ing_data['price'],
                                new_ing_data['supplier_name'],
                                new_qty,  # ★ 재계산된 quantity
                                mri_id
                            ))

                            updated_count += 1
                            updated_recipes.append({
                                'recipe_id': recipe_id,
                                'recipe_name': recipe_name,
                                'old_ingredient': old_ingredient_code,
                                'new_ingredient': new_ing_data['code'],
                                'required_grams': required_grams,  # ★ 유지된 값
                                'old_quantity': decimal_to_float(old_qty),
                                'new_quantity': new_qty,  # ★ 재계산된 값
                                'new_base_weight_grams': new_ing_data['base_weight_grams']
                            })

                    else:
                        # 새 재료 추가 (old_ingredient_code가 없는 경우)
                        cursor.execute("""
                            SELECT id FROM menu_recipe_ingredients
                            WHERE recipe_id = %s AND ingredient_code = %s
                        """, (recipe_id, new_ingredient_code))

                        if not cursor.fetchone():
                            # 레시피명 조회
                            cursor.execute("SELECT recipe_name FROM menu_recipes WHERE id = %s", (recipe_id,))
                            recipe_row = cursor.fetchone()
                            recipe_name = recipe_row[0] if recipe_row else ''

                            # sort_order 조회
                            cursor.execute("""
                                SELECT COALESCE(MAX(sort_order), 0) + 1
                                FROM menu_recipe_ingredients
                                WHERE recipe_id = %s
                            """, (recipe_id,))
                            next_order = cursor.fetchone()[0]

                            cursor.execute("""
                                INSERT INTO menu_recipe_ingredients
                                (recipe_id, ingredient_code, ingredient_name, specification, unit,
                                 selling_price, supplier_name, quantity, sort_order, created_at)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, 0, %s, CURRENT_TIMESTAMP)
                            """, (
                                recipe_id,
                                new_ing_data['code'],
                                new_ing_data['name'],
                                new_ing_data['specification'],
                                new_ing_data['unit'],
                                new_ing_data['price'],
                                new_ing_data['supplier_name'],
                                next_order
                            ))

                            # 변경 이력 기록 (추가)
                            cursor.execute("""
                                INSERT INTO ingredient_change_history
                                (change_type, recipe_id, recipe_name, mri_id,
                                 new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                                 change_reason, changed_by, batch_id)
                                VALUES (%s, %s, %s, NULL, %s, %s, 0, %s, %s, %s, %s, %s)
                            """, (
                                'bulk_add', recipe_id, recipe_name,
                                new_ing_data['code'], new_ing_data['name'], new_ing_data['unit'], new_ing_data['price'],
                                change_reason, client_ip, batch_id
                            ))

                            updated_count += 1

                # 트랜잭션 커밋
                conn.commit()

                return {
                    "success": True,
                    "message": f"{updated_count}개 레시피의 식자재가 변경되었습니다.",
                    "updated_count": updated_count,
                    "batch_id": batch_id,
                    "new_ingredient": new_ing_data,
                    "updated_recipes": updated_recipes
                }

            except Exception as e:
                # 에러 발생 시 롤백
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/api/ingredient-bulk-change/with-quantities")
async def apply_ingredient_bulk_change_with_quantities(request: Request):
    """
    개별 수량 지정 식자재 일괄 변경

    각 레시피별로 다른 수량을 지정하여 변경합니다.
    사용자가 하나하나 확인한 수량을 반영합니다.

    Request Body:
        changes: [{recipe_id, mri_id, new_quantity}, ...]
        new_ingredient_code: 새 식자재 코드
        change_reason: 변경 사유 (선택)
        effective_date: 적용 시작일 (선택, YYYY-MM-DD 형식)

    Returns:
        updated_count: 변경된 레시피 수
        batch_id: 변경 배치 ID
    """
    try:
        ensure_tables_exist()

        data = await request.json()
        changes = data.get('changes', [])
        new_ingredient_code = data.get('new_ingredient_code')
        change_reason = data.get('change_reason', '')
        effective_date_str = data.get('effective_date')  # YYYY-MM-DD 형식

        if not changes:
            return {"success": False, "error": "변경할 항목이 없습니다."}

        if not new_ingredient_code:
            return {"success": False, "error": "새 식자재를 선택해주세요."}

        # 적용 시작일 파싱
        effective_date = None
        is_scheduled = False
        if effective_date_str:
            try:
                effective_date = datetime.strptime(effective_date_str, '%Y-%m-%d').date()
                # 오늘 이후 날짜인 경우 예약 변경으로 처리
                if effective_date > date.today():
                    is_scheduled = True
            except ValueError:
                return {"success": False, "error": "적용 시작일 형식이 잘못되었습니다. (YYYY-MM-DD)"}

        batch_id = generate_batch_id()
        client_ip = get_client_ip(request)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # ★★★ 새 식자재 정보 조회 (base_weight_grams 포함) ★★★
                cursor.execute("""
                    SELECT i.ingredient_code, i.ingredient_name, i.specification, i.unit,
                           i.selling_price, i.supplier_name,
                           COALESCE(i.base_weight_grams, 1000) as base_weight_grams
                    FROM ingredients i
                    WHERE i.ingredient_code = %s
                """, (new_ingredient_code,))
                new_ing = cursor.fetchone()

                if not new_ing:
                    return {"success": False, "error": "새 식자재를 찾을 수 없습니다."}

                new_ing_data = {
                    'code': new_ing[0],
                    'name': new_ing[1],
                    'specification': new_ing[2],
                    'unit': new_ing[3],
                    'price': decimal_to_float(new_ing[4]) or 0,
                    'supplier_name': new_ing[5] or '',
                    'base_weight_grams': decimal_to_float(new_ing[6]) or 1000  # ★ 새 식자재 base_weight
                }

                updated_count = 0
                scheduled_count = 0
                updated_recipes = []

                for change in changes:
                    recipe_id = change.get('recipe_id')
                    mri_id = change.get('mri_id')
                    new_quantity = change.get('new_quantity')
                    # ★★★ 프론트엔드에서 required_grams 직접 전달 가능 ★★★
                    passed_required_grams = change.get('required_grams')

                    if not mri_id or new_quantity is None:
                        continue

                    # 현재 재료 정보 조회 (required_grams 포함)
                    cursor.execute("""
                        SELECT mri.ingredient_code, mri.ingredient_name, mri.quantity,
                               mri.unit, mri.selling_price, mr.recipe_name,
                               COALESCE(mri.required_grams, 0) as required_grams
                        FROM menu_recipe_ingredients mri
                        JOIN menu_recipes mr ON mri.recipe_id = mr.id
                        WHERE mri.id = %s
                    """, (mri_id,))
                    current = cursor.fetchone()

                    if not current:
                        continue

                    current_code = current[0]
                    current_name = current[1]
                    current_qty = current[2]
                    current_unit = current[3]
                    current_price = current[4]
                    recipe_name = current[5]
                    current_required_grams = decimal_to_float(current[6]) or 0

                    # ★★★ required_grams 결정 로직 ★★★
                    # 1. 프론트엔드에서 직접 전달된 경우 사용
                    # 2. 그 외: 기존 required_grams 유지
                    if passed_required_grams is not None:
                        new_required_grams = passed_required_grams
                    else:
                        new_required_grams = current_required_grams

                    if is_scheduled:
                        # 예약 변경 등록
                        cursor.execute("""
                            INSERT INTO scheduled_ingredient_changes
                            (recipe_id, recipe_name, mri_id,
                             current_ingredient_code, current_ingredient_name, current_quantity, current_unit,
                             new_ingredient_code, new_ingredient_name, new_quantity, new_unit,
                             new_selling_price, new_supplier_name, new_specification,
                             effective_date, status, batch_id, created_by)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s)
                        """, (
                            recipe_id, recipe_name, mri_id,
                            current_code, current_name, current_qty, current_unit,
                            new_ing_data['code'], new_ing_data['name'], new_quantity, new_ing_data['unit'],
                            new_ing_data['price'], new_ing_data['supplier_name'], new_ing_data['specification'],
                            effective_date, batch_id, client_ip
                        ))

                        scheduled_count += 1
                        updated_recipes.append({
                            'recipe_id': recipe_id,
                            'recipe_name': recipe_name,
                            'new_quantity': new_quantity,
                            'status': 'scheduled',
                            'effective_date': effective_date_str
                        })

                    else:
                        # 즉시 변경
                        # 변경 이력 기록
                        cursor.execute("""
                            INSERT INTO ingredient_change_history
                            (change_type, recipe_id, recipe_name, mri_id,
                             old_ingredient_code, old_ingredient_name, old_quantity, old_unit, old_selling_price,
                             new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                             change_reason, changed_by, batch_id, effective_date)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            'bulk_replace', recipe_id, recipe_name, mri_id,
                            current_code, current_name, current_qty, current_unit, current_price,
                            new_ing_data['code'], new_ing_data['name'], new_quantity, new_ing_data['unit'], new_ing_data['price'],
                            change_reason, client_ip, batch_id, effective_date or date.today()
                        ))

                        # ★★★ 수량과 식자재 정보 업데이트 (required_grams 유지) ★★★
                        cursor.execute("""
                            UPDATE menu_recipe_ingredients
                            SET ingredient_code = %s,
                                ingredient_name = %s,
                                specification = %s,
                                unit = %s,
                                selling_price = %s,
                                supplier_name = %s,
                                quantity = %s,
                                required_grams = %s
                            WHERE id = %s
                        """, (
                            new_ing_data['code'],
                            new_ing_data['name'],
                            new_ing_data['specification'],
                            new_ing_data['unit'],
                            new_ing_data['price'],
                            new_ing_data['supplier_name'],
                            new_quantity,
                            new_required_grams,  # ★ required_grams 유지/업데이트
                            mri_id
                        ))

                        updated_count += 1
                        updated_recipes.append({
                            'recipe_id': recipe_id,
                            'recipe_name': recipe_name,
                            'new_quantity': new_quantity,
                            'required_grams': new_required_grams,  # ★ 추가
                            'status': 'applied'
                        })

                # 트랜잭션 커밋
                conn.commit()

                if is_scheduled:
                    message = f"{scheduled_count}개 레시피의 식자재 변경이 {effective_date_str}부터 적용되도록 예약되었습니다."
                else:
                    message = f"{updated_count}개 레시피의 식자재가 변경되었습니다."

                return {
                    "success": True,
                    "message": message,
                    "updated_count": updated_count,
                    "scheduled_count": scheduled_count,
                    "batch_id": batch_id,
                    "new_ingredient": new_ing_data,
                    "updated_recipes": updated_recipes,
                    "is_scheduled": is_scheduled
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/ingredient-change-history")
async def get_ingredient_change_history(
    batch_id: str = Query(None, description="배치 ID"),
    recipe_id: int = Query(None, description="레시피 ID"),
    ingredient_code: str = Query(None, description="식자재 코드 (신/구)"),
    start_date: str = Query(None, description="시작일 (YYYY-MM-DD)"),
    end_date: str = Query(None, description="종료일 (YYYY-MM-DD)"),
    limit: int = Query(100, description="결과 개수")
):
    """
    식자재 변경 이력 조회

    Args:
        batch_id: 특정 배치 ID로 필터
        recipe_id: 특정 레시피로 필터
        ingredient_code: 식자재 코드로 필터 (변경 전/후 모두)
        start_date: 조회 시작일
        end_date: 조회 종료일
        limit: 결과 개수 제한

    Returns:
        history: 변경 이력 목록
    """
    try:
        ensure_tables_exist()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, change_type, recipe_id, recipe_name, mri_id,
                       old_ingredient_code, old_ingredient_name, old_quantity, old_unit, old_selling_price,
                       new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                       change_reason, changed_by, batch_id, effective_date, created_at
                FROM ingredient_change_history
                WHERE 1=1
            """
            params = []

            if batch_id:
                query += " AND batch_id = %s"
                params.append(batch_id)

            if recipe_id:
                query += " AND recipe_id = %s"
                params.append(recipe_id)

            if ingredient_code:
                query += " AND (old_ingredient_code = %s OR new_ingredient_code = %s)"
                params.extend([ingredient_code, ingredient_code])

            if start_date:
                query += " AND created_at >= %s"
                params.append(start_date)

            if end_date:
                query += " AND created_at <= %s::date + interval '1 day'"
                params.append(end_date)

            query += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            history = []
            for row in rows:
                history.append({
                    'id': row[0],
                    'change_type': row[1],
                    'recipe_id': row[2],
                    'recipe_name': row[3],
                    'mri_id': row[4],
                    'old_ingredient_code': row[5],
                    'old_ingredient_name': row[6],
                    'old_quantity': decimal_to_float(row[7]),
                    'old_unit': row[8],
                    'old_selling_price': decimal_to_float(row[9]),
                    'new_ingredient_code': row[10],
                    'new_ingredient_name': row[11],
                    'new_quantity': decimal_to_float(row[12]),
                    'new_unit': row[13],
                    'new_selling_price': decimal_to_float(row[14]),
                    'change_reason': row[15],
                    'changed_by': row[16],
                    'batch_id': row[17],
                    'effective_date': row[18].isoformat() if row[18] else None,
                    'created_at': row[19].isoformat() if row[19] else None
                })

            return {
                "success": True,
                "count": len(history),
                "history": history
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/scheduled-ingredient-changes")
async def get_scheduled_changes(
    status: str = Query('pending', description="상태 (pending, applied, cancelled, all)"),
    recipe_id: int = Query(None, description="레시피 ID"),
    effective_date: str = Query(None, description="적용일 (YYYY-MM-DD)")
):
    """
    예약된 식자재 변경 목록 조회

    Args:
        status: 상태 필터 (pending, applied, cancelled, all)
        recipe_id: 레시피 ID 필터
        effective_date: 적용일 필터

    Returns:
        scheduled_changes: 예약 변경 목록
    """
    try:
        ensure_tables_exist()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, recipe_id, recipe_name, mri_id,
                       current_ingredient_code, current_ingredient_name, current_quantity, current_unit,
                       new_ingredient_code, new_ingredient_name, new_quantity, new_unit,
                       new_selling_price, new_supplier_name, new_specification,
                       effective_date, status, batch_id, created_by,
                       cancel_reason, error_message, created_at, applied_at, cancelled_at
                FROM scheduled_ingredient_changes
                WHERE 1=1
            """
            params = []

            if status and status != 'all':
                query += " AND status = %s"
                params.append(status)

            if recipe_id:
                query += " AND recipe_id = %s"
                params.append(recipe_id)

            if effective_date:
                query += " AND effective_date = %s"
                params.append(effective_date)

            query += " ORDER BY effective_date ASC, created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            changes = []
            for row in rows:
                changes.append({
                    'id': row[0],
                    'recipe_id': row[1],
                    'recipe_name': row[2],
                    'mri_id': row[3],
                    'current_ingredient_code': row[4],
                    'current_ingredient_name': row[5],
                    'current_quantity': decimal_to_float(row[6]),
                    'current_unit': row[7],
                    'new_ingredient_code': row[8],
                    'new_ingredient_name': row[9],
                    'new_quantity': decimal_to_float(row[10]),
                    'new_unit': row[11],
                    'new_selling_price': decimal_to_float(row[12]),
                    'new_supplier_name': row[13],
                    'new_specification': row[14],
                    'effective_date': row[15].isoformat() if row[15] else None,
                    'status': row[16],
                    'batch_id': row[17],
                    'created_by': row[18],
                    'cancel_reason': row[19],
                    'error_message': row[20],
                    'created_at': row[21].isoformat() if row[21] else None,
                    'applied_at': row[22].isoformat() if row[22] else None,
                    'cancelled_at': row[23].isoformat() if row[23] else None
                })

            return {
                "success": True,
                "count": len(changes),
                "scheduled_changes": changes
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/scheduled-ingredient-changes/cancel")
async def cancel_scheduled_change(request: Request):
    """
    예약된 식자재 변경 취소

    Request Body:
        schedule_id: 취소할 예약 ID (단건) 또는
        batch_id: 취소할 배치 ID (일괄)
        cancel_reason: 취소 사유 (선택)

    Returns:
        cancelled_count: 취소된 건수
    """
    try:
        ensure_tables_exist()

        data = await request.json()
        schedule_id = data.get('schedule_id')
        batch_id = data.get('batch_id')
        cancel_reason = data.get('cancel_reason', '')

        if not schedule_id and not batch_id:
            return {"success": False, "error": "취소할 항목을 지정해주세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                if schedule_id:
                    # 단건 취소
                    cursor.execute("""
                        UPDATE scheduled_ingredient_changes
                        SET status = 'cancelled',
                            cancel_reason = %s,
                            cancelled_at = CURRENT_TIMESTAMP
                        WHERE id = %s AND status = 'pending'
                    """, (cancel_reason, schedule_id))
                    cancelled_count = cursor.rowcount

                else:
                    # 배치 취소
                    cursor.execute("""
                        UPDATE scheduled_ingredient_changes
                        SET status = 'cancelled',
                            cancel_reason = %s,
                            cancelled_at = CURRENT_TIMESTAMP
                        WHERE batch_id = %s AND status = 'pending'
                    """, (cancel_reason, batch_id))
                    cancelled_count = cursor.rowcount

                conn.commit()

                return {
                    "success": True,
                    "message": f"{cancelled_count}건의 예약이 취소되었습니다.",
                    "cancelled_count": cancelled_count
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/scheduled-ingredient-changes/apply-now")
async def apply_scheduled_changes_now(request: Request):
    """
    예약된 변경을 즉시 적용

    Request Body:
        schedule_ids: 적용할 예약 ID 목록 또는
        batch_id: 적용할 배치 ID
        apply_all_due: true면 적용일이 오늘 이전인 모든 예약 적용

    Returns:
        applied_count: 적용된 건수
        failed_count: 실패한 건수
    """
    try:
        ensure_tables_exist()

        data = await request.json()
        schedule_ids = data.get('schedule_ids', [])
        batch_id = data.get('batch_id')
        apply_all_due = data.get('apply_all_due', False)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # 적용할 예약 목록 조회
                if apply_all_due:
                    cursor.execute("""
                        SELECT id FROM scheduled_ingredient_changes
                        WHERE status = 'pending' AND effective_date <= CURRENT_DATE
                    """)
                elif batch_id:
                    cursor.execute("""
                        SELECT id FROM scheduled_ingredient_changes
                        WHERE batch_id = %s AND status = 'pending'
                    """, (batch_id,))
                elif schedule_ids:
                    cursor.execute("""
                        SELECT id FROM scheduled_ingredient_changes
                        WHERE id = ANY(%s) AND status = 'pending'
                    """, (schedule_ids,))
                else:
                    return {"success": False, "error": "적용할 항목을 지정해주세요."}

                pending_ids = [row[0] for row in cursor.fetchall()]

                applied_count = 0
                failed_count = 0
                results = []

                for sid in pending_ids:
                    # 예약 정보 조회
                    cursor.execute("""
                        SELECT mri_id, new_ingredient_code, new_ingredient_name,
                               new_quantity, new_unit, new_selling_price,
                               new_supplier_name, new_specification,
                               recipe_id, recipe_name, current_ingredient_code,
                               current_ingredient_name, current_quantity, current_unit
                        FROM scheduled_ingredient_changes
                        WHERE id = %s
                    """, (sid,))
                    sched = cursor.fetchone()

                    if not sched:
                        continue

                    mri_id = sched[0]
                    new_code = sched[1]
                    new_name = sched[2]
                    new_qty = sched[3]
                    new_unit = sched[4]
                    new_price = sched[5]
                    new_supplier = sched[6]
                    new_spec = sched[7]
                    recipe_id = sched[8]
                    recipe_name = sched[9]
                    old_code = sched[10]
                    old_name = sched[11]
                    old_qty = sched[12]
                    old_unit = sched[13]

                    try:
                        # menu_recipe_ingredients 업데이트
                        cursor.execute("""
                            UPDATE menu_recipe_ingredients
                            SET ingredient_code = %s,
                                ingredient_name = %s,
                                specification = %s,
                                unit = %s,
                                selling_price = %s,
                                supplier_name = %s,
                                quantity = %s
                            WHERE id = %s
                        """, (new_code, new_name, new_spec, new_unit, new_price, new_supplier, new_qty, mri_id))

                        # 변경 이력 기록
                        cursor.execute("""
                            INSERT INTO ingredient_change_history
                            (change_type, recipe_id, recipe_name, mri_id,
                             old_ingredient_code, old_ingredient_name, old_quantity, old_unit,
                             new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                             change_reason, changed_by, effective_date)
                            VALUES ('scheduled', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '예약 변경 적용', 'system', CURRENT_DATE)
                        """, (recipe_id, recipe_name, mri_id, old_code, old_name, old_qty, old_unit,
                              new_code, new_name, new_qty, new_unit, new_price))

                        # 예약 상태 업데이트
                        cursor.execute("""
                            UPDATE scheduled_ingredient_changes
                            SET status = 'applied', applied_at = CURRENT_TIMESTAMP
                            WHERE id = %s
                        """, (sid,))

                        applied_count += 1
                        results.append({'id': sid, 'status': 'applied', 'recipe_name': recipe_name})

                    except Exception as apply_error:
                        # 개별 실패 처리
                        cursor.execute("""
                            UPDATE scheduled_ingredient_changes
                            SET status = 'failed', error_message = %s
                            WHERE id = %s
                        """, (str(apply_error), sid))
                        failed_count += 1
                        results.append({'id': sid, 'status': 'failed', 'error': str(apply_error)})

                conn.commit()

                return {
                    "success": True,
                    "message": f"{applied_count}건 적용 완료, {failed_count}건 실패",
                    "applied_count": applied_count,
                    "failed_count": failed_count,
                    "results": results
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


# ============================================================================
# 불일치 조치 API
# ============================================================================

@router.post("/api/ingredient-mismatch/unify")
async def unify_ingredient(request: Request):
    """
    불일치 식자재 통일 - 미사용 레시피에 식자재 추가
    """
    try:
        data = await request.json()
        ingredient_code = data.get('ingredient_code')
        ingredient_name = data.get('ingredient_name')
        recipe_ids = data.get('recipe_ids', [])
        unit = data.get('unit', 'EA')
        quantity = data.get('quantity', 0.01)
        passed_required_grams = data.get('required_grams')  # 프론트엔드에서 전달받은 값

        if not ingredient_code or not recipe_ids:
            return {"success": False, "error": "필수 파라미터가 누락되었습니다."}

        client_ip = get_client_ip(request)
        batch_id = generate_batch_id()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # 식자재 정보 조회
                cursor.execute("""
                    SELECT ingredient_code, ingredient_name, specification, unit, selling_price, supplier_name
                    FROM ingredients
                    WHERE ingredient_code = %s
                """, (ingredient_code,))
                ing_row = cursor.fetchone()

                if not ing_row:
                    return {"success": False, "error": "식자재를 찾을 수 없습니다."}

                ing_data = {
                    'code': ing_row[0],
                    'name': ing_row[1] or ingredient_name,
                    'spec': ing_row[2] or '',
                    'unit': ing_row[3] or unit,
                    'price': decimal_to_float(ing_row[4]) or 0,
                    'supplier': ing_row[5] or ''
                }

                updated_count = 0

                # required_grams: 전달받은 값이 있으면 사용, 없으면 DB에서 조회
                if passed_required_grams is not None and passed_required_grams > 0:
                    source_required_grams = passed_required_grams
                else:
                    # 이미 해당 식자재를 사용하는 레시피에서 required_grams 값 조회
                    cursor.execute("""
                        SELECT required_grams FROM menu_recipe_ingredients
                        WHERE ingredient_code = %s AND required_grams > 0
                        LIMIT 1
                    """, (ingredient_code,))
                    existing_rg = cursor.fetchone()
                    source_required_grams = decimal_to_float(existing_rg[0]) if existing_rg else 0

                for recipe_id in recipe_ids:
                    # 레시피 이름 조회
                    cursor.execute("SELECT recipe_name FROM menu_recipes WHERE id = %s", (recipe_id,))
                    recipe_row = cursor.fetchone()
                    recipe_name = recipe_row[0] if recipe_row else f"Recipe#{recipe_id}"

                    # 이미 존재하는지 확인
                    cursor.execute("""
                        SELECT id FROM menu_recipe_ingredients
                        WHERE recipe_id = %s AND ingredient_code = %s
                    """, (recipe_id, ingredient_code))

                    if cursor.fetchone():
                        continue  # 이미 존재하면 스킵

                    # 다음 정렬 순서 조회
                    cursor.execute("""
                        SELECT COALESCE(MAX(sort_order), 0) + 1
                        FROM menu_recipe_ingredients WHERE recipe_id = %s
                    """, (recipe_id,))
                    sort_order = cursor.fetchone()[0]

                    # 식자재 추가 (required_grams 포함)
                    cursor.execute("""
                        INSERT INTO menu_recipe_ingredients
                        (recipe_id, ingredient_code, ingredient_name, specification, unit,
                         selling_price, supplier_name, quantity, sort_order, required_grams)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id
                    """, (recipe_id, ing_data['code'], ing_data['name'], ing_data['spec'],
                          ing_data['unit'], ing_data['price'], ing_data['supplier'], quantity, sort_order, source_required_grams))

                    mri_id = cursor.fetchone()[0]

                    # 변경 이력 기록
                    cursor.execute("""
                        INSERT INTO ingredient_change_history
                        (change_type, recipe_id, recipe_name, mri_id,
                         new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                         change_reason, changed_by, batch_id)
                        VALUES ('unify_add', %s, %s, %s, %s, %s, %s, %s, %s, '불일치 통일 - 식자재 추가', %s, %s)
                    """, (recipe_id, recipe_name, mri_id, ing_data['code'], ing_data['name'],
                          quantity, ing_data['unit'], ing_data['price'], client_ip, batch_id))

                    updated_count += 1

                conn.commit()

                return {
                    "success": True,
                    "message": f"{updated_count}개 레시피에 식자재가 추가되었습니다.",
                    "updated_count": updated_count,
                    "batch_id": batch_id
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/api/ingredient-mismatch/replace")
async def replace_mismatch_ingredient(request: Request):
    """
    불일치 식자재 교체 - 특정 레시피들의 식자재를 다른 것으로 교체
    """
    try:
        data = await request.json()
        old_ingredient_code = data.get('old_ingredient_code')
        new_ingredient_code = data.get('new_ingredient_code')
        new_ingredient_name = data.get('new_ingredient_name')
        recipe_ids = data.get('recipe_ids', [])

        if not old_ingredient_code or not new_ingredient_code or not recipe_ids:
            return {"success": False, "error": "필수 파라미터가 누락되었습니다."}

        client_ip = get_client_ip(request)
        batch_id = generate_batch_id()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # ★★★ 새 식자재 정보 조회 (base_weight_grams 포함) ★★★
                cursor.execute("""
                    SELECT ingredient_code, ingredient_name, specification, unit, selling_price, supplier_name,
                           COALESCE(base_weight_grams, 1000) as base_weight_grams
                    FROM ingredients
                    WHERE ingredient_code = %s
                """, (new_ingredient_code,))
                new_ing_row = cursor.fetchone()

                if not new_ing_row:
                    return {"success": False, "error": "새 식자재를 찾을 수 없습니다."}

                new_ing = {
                    'code': new_ing_row[0],
                    'name': new_ing_row[1] or new_ingredient_name,
                    'spec': new_ing_row[2] or '',
                    'unit': new_ing_row[3] or 'EA',
                    'price': decimal_to_float(new_ing_row[4]) or 0,
                    'supplier': new_ing_row[5] or '',
                    'base_weight_grams': decimal_to_float(new_ing_row[6]) or 1000  # ★ 새 식자재 base_weight
                }

                updated_count = 0

                for recipe_id in recipe_ids:
                    # ★★★ 기존 식자재 정보 조회 (required_grams 포함) ★★★
                    cursor.execute("""
                        SELECT mri.id, mri.ingredient_name, mri.quantity, mri.unit, mr.recipe_name,
                               COALESCE(mri.required_grams, 0) as required_grams
                        FROM menu_recipe_ingredients mri
                        JOIN menu_recipes mr ON mri.recipe_id = mr.id
                        WHERE mri.recipe_id = %s AND mri.ingredient_code = %s
                    """, (recipe_id, old_ingredient_code))

                    old_row = cursor.fetchone()
                    if not old_row:
                        continue

                    mri_id, old_name, old_qty, old_unit, recipe_name, required_grams = old_row
                    required_grams = decimal_to_float(required_grams) or 0

                    # ★★★ 핵심: required_grams 기반으로 new_quantity 재계산 ★★★
                    if required_grams > 0 and new_ing['base_weight_grams'] > 0:
                        new_qty = round(required_grams / new_ing['base_weight_grams'], 6)
                    else:
                        # required_grams가 없으면 기존 quantity 유지 (호환성)
                        new_qty = decimal_to_float(old_qty) or 0

                    # ★★★ 식자재 업데이트 (quantity 재계산 반영, required_grams 유지) ★★★
                    cursor.execute("""
                        UPDATE menu_recipe_ingredients
                        SET ingredient_code = %s,
                            ingredient_name = %s,
                            specification = %s,
                            unit = %s,
                            selling_price = %s,
                            supplier_name = %s,
                            quantity = %s
                        WHERE id = %s
                    """, (new_ing['code'], new_ing['name'], new_ing['spec'],
                          new_ing['unit'], new_ing['price'], new_ing['supplier'], new_qty, mri_id))

                    # 변경 이력 기록
                    cursor.execute("""
                        INSERT INTO ingredient_change_history
                        (change_type, recipe_id, recipe_name, mri_id,
                         old_ingredient_code, old_ingredient_name, old_quantity, old_unit,
                         new_ingredient_code, new_ingredient_name, new_quantity, new_unit, new_selling_price,
                         change_reason, changed_by, batch_id)
                        VALUES ('mismatch_replace', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '불일치 조치 - 식자재 교체', %s, %s)
                    """, (recipe_id, recipe_name, mri_id, old_ingredient_code, old_name,
                          decimal_to_float(old_qty), old_unit, new_ing['code'], new_ing['name'],
                          new_qty, new_ing['unit'], new_ing['price'], client_ip, batch_id))

                    updated_count += 1

                conn.commit()

                return {
                    "success": True,
                    "message": f"{updated_count}개 레시피의 식자재가 교체되었습니다.",
                    "updated_count": updated_count,
                    "batch_id": batch_id
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/api/ingredient-mismatch/delete-from-recipe")
async def delete_ingredient_from_recipe(request: Request):
    """
    레시피에서 특정 식자재 삭제 - 유사 식자재 통일 시 기존 식자재 제거용
    """
    try:
        data = await request.json()
        ingredient_code = data.get('ingredient_code')
        recipe_id = data.get('recipe_id')

        if not ingredient_code or not recipe_id:
            return {"success": False, "error": "필수 파라미터가 누락되었습니다."}

        client_ip = get_client_ip(request)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # 삭제할 식자재 정보 조회
                cursor.execute("""
                    SELECT mri.id, mri.ingredient_name, mri.quantity, mri.unit, mr.recipe_name
                    FROM menu_recipe_ingredients mri
                    JOIN menu_recipes mr ON mri.recipe_id = mr.id
                    WHERE mri.recipe_id = %s AND mri.ingredient_code = %s
                """, (recipe_id, ingredient_code))

                row = cursor.fetchone()
                if not row:
                    return {"success": False, "error": "해당 식자재를 찾을 수 없습니다."}

                mri_id, ing_name, qty, unit, recipe_name = row

                # 변경 이력 기록 (삭제)
                cursor.execute("""
                    INSERT INTO ingredient_change_history
                    (change_type, recipe_id, recipe_name, mri_id,
                     old_ingredient_code, old_ingredient_name, old_quantity, old_unit,
                     change_reason, changed_by)
                    VALUES ('unify_delete', %s, %s, %s, %s, %s, %s, %s, '유사 식자재 통일 - 기존 식자재 삭제', %s)
                """, (recipe_id, recipe_name, mri_id, ingredient_code, ing_name,
                      decimal_to_float(qty), unit, client_ip))

                # 식자재 삭제
                cursor.execute("""
                    DELETE FROM menu_recipe_ingredients
                    WHERE id = %s
                """, (mri_id,))

                conn.commit()

                return {
                    "success": True,
                    "message": f"'{ing_name}' 식자재가 '{recipe_name}' 레시피에서 삭제되었습니다.",
                    "deleted_ingredient": ing_name,
                    "recipe_name": recipe_name
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/api/ingredient-mismatch/update-quantity")
async def update_ingredient_quantity(request: Request):
    """
    레시피 내 식자재 수량 업데이트 (required_grams 옵션 지원)
    """
    try:
        data = await request.json()
        ingredient_code = data.get('ingredient_code')
        recipe_id = data.get('recipe_id')
        new_quantity = data.get('new_quantity')
        new_required_grams = data.get('required_grams')  # 선택적 파라미터

        if not ingredient_code or not recipe_id or new_quantity is None:
            return {"success": False, "error": "필수 파라미터가 누락되었습니다."}

        client_ip = get_client_ip(request)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                # 기존 식자재 정보 조회
                cursor.execute("""
                    SELECT mri.id, mri.ingredient_name, mri.quantity, mri.unit, mr.recipe_name
                    FROM menu_recipe_ingredients mri
                    JOIN menu_recipes mr ON mri.recipe_id = mr.id
                    WHERE mri.recipe_id = %s AND mri.ingredient_code = %s
                """, (recipe_id, ingredient_code))

                row = cursor.fetchone()
                if not row:
                    return {"success": False, "error": "해당 식자재를 찾을 수 없습니다."}

                mri_id, ing_name, old_qty, unit, recipe_name = row

                # 변경 이력 기록
                cursor.execute("""
                    INSERT INTO ingredient_change_history
                    (change_type, recipe_id, recipe_name, mri_id,
                     old_ingredient_code, old_ingredient_name, old_quantity, old_unit,
                     new_ingredient_code, new_ingredient_name, new_quantity, new_unit,
                     change_reason, changed_by)
                    VALUES ('quantity_update', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '수량 수정', %s)
                """, (recipe_id, recipe_name, mri_id, ingredient_code, ing_name,
                      decimal_to_float(old_qty), unit, ingredient_code, ing_name,
                      new_quantity, unit, client_ip))

                # 수량 업데이트 (required_grams 포함)
                if new_required_grams is not None:
                    # required_grams 모드에서는 unit도 'g'로 업데이트
                    cursor.execute("""
                        UPDATE menu_recipe_ingredients
                        SET quantity = %s, required_grams = %s, unit = 'g'
                        WHERE id = %s
                    """, (new_quantity, new_required_grams, mri_id))
                else:
                    cursor.execute("""
                        UPDATE menu_recipe_ingredients
                        SET quantity = %s
                        WHERE id = %s
                    """, (new_quantity, mri_id))

                conn.commit()

                return {
                    "success": True,
                    "message": f"'{ing_name}' 수량이 {decimal_to_float(old_qty)} → {new_quantity} {unit}로 변경되었습니다.",
                    "old_quantity": decimal_to_float(old_qty),
                    "new_quantity": new_quantity,
                    "recipe_name": recipe_name
                }

            except Exception as e:
                conn.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}
