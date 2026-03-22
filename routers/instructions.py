#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instructions Router
조리지시서/소분지시서 전용 API
- 발주서와 독립적으로 meal_plans + meal_counts에서 직접 생성
- 카테고리(도시락, 운반, 학교, 요양원)별 관리
- 데이터 변경 감지 및 동기화 안전장치 포함
"""

from datetime import datetime, date
from decimal import Decimal
from fastapi import APIRouter, Request, Query
from typing import Optional, List
from core.database import get_db_connection
from utils.menu_name import get_cooking_yield, get_base_name, get_canonical_name, CATEGORY_NAME_MAP as GLOBAL_CATEGORY_NAME_MAP
import json
import hashlib

router = APIRouter()


# ============================================
# 데이터 변경 감지 유틸리티
# ============================================

def calculate_data_hash(cursor, instruction_date: str, category: str = None, site_id: int = None):
    """
    meal_plans + meal_counts 데이터의 해시값 계산
    - 데이터가 변경되면 해시값이 달라짐
    - 조리지시서 저장 시 해시 저장 → 조회 시 비교하여 변경 감지
    """
    # meal_plans 데이터
    plan_query = """
        SELECT id, slot_name, menus, category, updated_at
        FROM meal_plans
        WHERE plan_date = %s
    """
    params = [instruction_date]
    if category:
        plan_query += " AND category = %s"
        params.append(category)
    if site_id:
        plan_query += " AND site_id = %s"
        params.append(site_id)
    plan_query += " ORDER BY id"

    cursor.execute(plan_query, params)
    plans_data = cursor.fetchall()

    # meal_counts 데이터
    counts_query = """
        SELECT id, menu_name, meal_count, business_type, updated_at
        FROM meal_counts
        WHERE work_date = %s
    """
    params = [instruction_date]
    if category:
        counts_query += " AND business_type = %s"
        params.append(category)
    if site_id:
        counts_query += " AND site_id = %s"
        params.append(site_id)
    counts_query += " ORDER BY id"

    cursor.execute(counts_query, params)
    counts_data = cursor.fetchall()

    # 해시 계산
    hash_input = str(plans_data) + str(counts_data)
    return hashlib.md5(hash_input.encode()).hexdigest()


def check_order_changes(cursor, instruction_date: str, category: str = None, site_id: int = None):
    """
    해당 날짜의 발주서 변경 여부 확인
    - 조리지시서 저장 이후 발주서가 수정되었는지 확인
    """
    site_id_val = site_id if site_id else 0

    # 저장된 조리지시서 조회
    query = """
        SELECT id, updated_at, data_hash
        FROM cooking_instructions_v2
        WHERE instruction_date = %s
    """
    params = [instruction_date]
    if category:
        query += " AND category = %s"
        params.append(category)
    query += " AND site_id = %s"
    params.append(site_id_val)

    cursor.execute(query, params)
    saved = cursor.fetchone()

    if not saved:
        return {'has_saved': False, 'has_changes': False}

    instruction_id, saved_at, saved_hash = saved

    # 현재 데이터 해시 계산
    current_hash = calculate_data_hash(cursor, instruction_date, category, site_id)

    # 발주서 변경 확인
    order_query = """
        SELECT MAX(o.updated_at)
        FROM orders o
        WHERE o.usage_date = %s AND o.status != 'cancelled'
    """
    cursor.execute(order_query, (instruction_date,))
    order_row = cursor.fetchone()
    order_updated_at = order_row[0] if order_row else None

    return {
        'has_saved': True,
        'instruction_id': instruction_id,
        'saved_at': str(saved_at) if saved_at else None,
        'has_changes': saved_hash != current_hash if saved_hash else True,
        'order_updated_after': order_updated_at > saved_at if (order_updated_at and saved_at) else False,
        'current_hash': current_hash,
        'saved_hash': saved_hash
    }


# ============================================
# 테이블 초기화
# ============================================

def init_instruction_tables(cursor, conn):
    """조리지시서/소분지시서 전용 테이블 생성"""

    # 조리지시서 마스터
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cooking_instructions_v2 (
            id SERIAL PRIMARY KEY,
            instruction_date DATE NOT NULL,
            category VARCHAR(50) NOT NULL,
            site_id INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'draft',
            total_meal_count INTEGER DEFAULT 0,
            data_hash VARCHAR(64),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            UNIQUE(instruction_date, category, site_id)
        )
    """)

    # data_hash 컬럼 추가 (기존 테이블에)
    cursor.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'cooking_instructions_v2' AND column_name = 'data_hash'
            ) THEN
                ALTER TABLE cooking_instructions_v2 ADD COLUMN data_hash VARCHAR(64);
            END IF;
        END $$;
    """)

    # 조리지시서 메뉴별 상세
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cooking_instruction_menus_v2 (
            id SERIAL PRIMARY KEY,
            instruction_id INTEGER REFERENCES cooking_instructions_v2(id) ON DELETE CASCADE,
            menu_id INTEGER,
            menu_name VARCHAR(200),
            meal_type VARCHAR(20),
            slot_name VARCHAR(100),
            meal_count INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 조리지시서 식재료별 상세
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cooking_instruction_items_v2 (
            id SERIAL PRIMARY KEY,
            instruction_id INTEGER REFERENCES cooking_instructions_v2(id) ON DELETE CASCADE,
            menu_id INTEGER,
            menu_name VARCHAR(200),
            meal_type VARCHAR(20),
            slot_name VARCHAR(100),
            ingredient_id INTEGER,
            ingredient_code VARCHAR(50),
            ingredient_name VARCHAR(200),
            specification VARCHAR(200),
            unit VARCHAR(20),
            per_person_qty DECIMAL(10,4),
            meal_count INTEGER DEFAULT 0,
            required_qty DECIMAL(10,4),
            preprocessing_yield DECIMAL(5,2) DEFAULT 100.00,
            cooking_yield DECIMAL(5,2) DEFAULT 100.00,
            cooked_qty DECIMAL(10,4),
            notes TEXT,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 소분지시서 마스터
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS portion_instructions_v2 (
            id SERIAL PRIMARY KEY,
            instruction_date DATE NOT NULL,
            category VARCHAR(50) NOT NULL,
            site_id INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'draft',
            total_meal_count INTEGER DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            UNIQUE(instruction_date, category, site_id)
        )
    """)

    # 소분지시서 상세
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS portion_instruction_items_v2 (
            id SERIAL PRIMARY KEY,
            instruction_id INTEGER REFERENCES portion_instructions_v2(id) ON DELETE CASCADE,
            menu_id INTEGER,
            menu_name VARCHAR(200),
            meal_type VARCHAR(20),
            slot_name VARCHAR(100),
            ingredient_id INTEGER,
            ingredient_code VARCHAR(50),
            ingredient_name VARCHAR(200),
            specification VARCHAR(200),
            unit VARCHAR(20),
            cooked_qty DECIMAL(10,4),
            portion_per_person DECIMAL(10,4),
            portion_count INTEGER DEFAULT 0,
            container_type VARCHAR(50),
            notes TEXT,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()


# ============================================
# 카테고리 목록 조회
# ============================================

@router.get("/api/instructions/categories")
async def get_instruction_categories(
    instruction_date: str = Query(..., description="지시서 일자"),
    site_id: int = Query(None, description="사업장 ID")
):
    """해당 일자의 사용 가능한 카테고리 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_plans에서 해당 날짜의 카테고리 조회
            query = """
                SELECT DISTINCT category, COUNT(*) as slot_count
                FROM meal_plans
                WHERE plan_date = %s AND category IS NOT NULL AND category != ''
            """
            params = [instruction_date]

            if site_id:
                query += " AND site_id = %s"
                params.append(site_id)

            query += " GROUP BY category ORDER BY category"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            # 카테고리별 식수도 조회
            categories = []
            category_order = ['도시락', '운반', '학교', '요양원', '일반', '전체']

            for row in rows:
                cat_name, slot_count = row

                # 해당 카테고리의 식수 조회 (meal_counts.business_type 기준)
                cursor.execute("""
                    SELECT SUM(meal_count) as total
                    FROM meal_counts
                    WHERE work_date = %s AND business_type = %s
                """, (instruction_date, cat_name))
                count_row = cursor.fetchone()
                meal_count = count_row[0] if count_row and count_row[0] else 0

                categories.append({
                    'category': cat_name,
                    'slot_count': slot_count,
                    'meal_count': meal_count
                })

            # 정렬
            def sort_key(item):
                try:
                    return category_order.index(item['category'])
                except ValueError:
                    return 999

            categories.sort(key=sort_key)


            return {
                "success": True,
                "instruction_date": instruction_date,
                "categories": categories
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 조리지시서 생성/조회 API
# ============================================

@router.get("/api/instructions/cooking")
async def get_cooking_instruction_v2(
    instruction_date: str = Query(..., description="조리일자"),
    category: str = Query(None, description="카테고리 (도시락, 운반, 학교, 요양원)"),
    site_id: int = Query(None, description="사업장 ID")
):
    """
    조리지시서 조회
    - ★★★ 항상 meal_plans + meal_counts + menu_recipe_ingredients 기반 (레시피 기준) ★★★
    - 재고 보유로 미발주한 식자재도 누락 없이 포함
    - 카테고리별 필터링 지원
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 초기화
            init_instruction_tables(cursor, conn)

            # ★★★ 항상 레시피 기준 조회 (발주서 유무와 무관) ★★★
            print(f"[조리지시서] 레시피 기준 조회: date={instruction_date}, category={category}")

            # 1. meal_plans에서 해당 날짜/카테고리의 슬롯 조회
            plan_query = """
                SELECT id, slot_name, menus, category
                FROM meal_plans
                WHERE plan_date = %s
            """
            plan_params = [instruction_date]

            if category:
                plan_query += " AND category = %s"
                plan_params.append(category)

            if site_id:
                plan_query += " AND site_id = %s"
                plan_params.append(site_id)

            plan_query += " ORDER BY slot_name"

            cursor.execute(plan_query, plan_params)
            meal_plans = cursor.fetchall()

            if not meal_plans:
                return {
                    "success": True,
                    "instruction_date": instruction_date,
                    "category": category,
                    "message": "해당 조건의 식단이 없습니다.",
                    "menus": [],
                    "category_counts": {},
                    "total_meal_count": 0,
                    "data_source": "none"
                }

            # 2. meal_counts에서 슬롯별 식수 조회 (menu_name = slot_name)
            counts_query = """
                SELECT menu_name, business_type, SUM(meal_count) as total
                FROM meal_counts
                WHERE work_date = %s
            """
            counts_params = [instruction_date]

            if category:
                counts_query += " AND business_type = %s"
                counts_params.append(category)

            if site_id:
                counts_query += " AND site_id = %s"
                counts_params.append(site_id)

            counts_query += " GROUP BY menu_name, business_type"

            cursor.execute(counts_query, counts_params)
            counts_rows = cursor.fetchall()

            # 슬롯별 식수 딕셔너리
            slot_counts = {}  # {slot_name: meal_count}
            category_counts = {}  # {category: total_count}

            for row in counts_rows:
                menu_name, biz_type, count = row
                if menu_name:
                    slot_counts[menu_name] = slot_counts.get(menu_name, 0) + (count or 0)
                if biz_type:
                    category_counts[biz_type] = category_counts.get(biz_type, 0) + (count or 0)

            # 2-1. order_items에서 slot_name → meal_type 매핑 조회 (발주서 생성 시점 기준)
            order_slot_meal_type_query = """
                SELECT DISTINCT oi.slot_name, oi.meal_type
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.usage_date = %s AND oi.slot_name IS NOT NULL AND oi.meal_type IS NOT NULL
            """
            cursor.execute(order_slot_meal_type_query, (instruction_date,))
            order_slot_meal_type_map = {row[0]: row[1] for row in cursor.fetchall()}

            # 2-2. meal_count_sites에서 slot_name → meal_type 매핑 조회 (fallback)
            cursor.execute("""
                SELECT DISTINCT slot_name, meal_type
                FROM meal_count_sites
                WHERE slot_name IS NOT NULL AND meal_type IS NOT NULL
            """)
            site_slot_meal_type_map = {row[0]: row[1] for row in cursor.fetchall()}

            # 통합 매핑: order_items 우선, 없으면 meal_count_sites
            slot_meal_type_map = {**site_slot_meal_type_map, **order_slot_meal_type_map}

            # 3. 전처리/조리 수율 조회
            cursor.execute("SELECT ingredient_id, yield_rate FROM preprocessing_yields")
            preprocessing_yields = {row[0]: float(row[1]) for row in cursor.fetchall()}

            # 날짜별 전처리지시서 수율 조회 (글로벌 수율보다 우선)
            # site_id 매칭 우선, 같은 조건이면 최근 업데이트 우선
            date_yield_query = """
                SELECT DISTINCT ON (pii.ingredient_id) pii.ingredient_id, pii.yield_rate
                FROM preprocessing_instruction_items pii
                JOIN preprocessing_instructions pi ON pii.instruction_id = pi.id
                WHERE pi.cooking_date = %s AND pi.status != 'cancelled'
            """
            date_yield_params = [instruction_date]
            if site_id:
                date_yield_query += " AND (pi.site_id = %s OR pi.site_id IS NULL)"
                date_yield_params.append(site_id)
            date_yield_query += " ORDER BY pii.ingredient_id, pi.site_id IS NULL, pi.updated_at DESC"
            cursor.execute(date_yield_query, date_yield_params)
            for row in cursor.fetchall():
                if row[0] and row[1] is not None:
                    preprocessing_yields[row[0]] = float(row[1])

            cursor.execute("SELECT menu_name, ingredient_id, cooking_yield_rate FROM cooking_yields")
            cooking_yields = {}
            for row in cursor.fetchall():
                key = (row[0], row[1])
                cooking_yields[key] = float(row[2]) if row[2] else 100.0

            # 3-1. 오버라이드 조회 (order_ingredient_overrides)
            overrides = []
            try:
                override_query = """
                    SELECT
                        override_type, original_ingredient_id, original_ingredient_code, original_ingredient_name,
                        recipe_id, replacement_ingredient_id, replacement_ingredient_code, replacement_ingredient_name,
                        replacement_specification, replacement_supplier_name, replacement_unit_price,
                        replacement_unit, replacement_lead_time, added_quantity, added_unit
                    FROM order_ingredient_overrides
                    WHERE usage_date = %s
                """
                override_params = [instruction_date]
                if site_id:
                    override_query += " AND site_id = %s"
                    override_params.append(site_id)

                cursor.execute(override_query, override_params)
                for row in cursor.fetchall():
                    overrides.append({
                        'type': row[0],
                        'original_id': row[1],
                        'original_code': row[2],
                        'original_name': row[3],
                        'recipe_id': row[4],
                        'replacement_id': row[5],
                        'replacement_code': row[6],
                        'replacement_name': row[7],
                        'replacement_spec': row[8],
                        'replacement_supplier': row[9],
                        'replacement_price': float(row[10]) if row[10] else 0,
                        'replacement_unit': row[11],
                        'replacement_lead_time': row[12] or 2,
                        'added_qty': float(row[13]) if row[13] else 0,
                        'added_unit': row[14]
                    })
            except Exception as e:
                print(f"[조리지시서] 오버라이드 조회 실패: {e}")

            # ============================================
            # ★★★ 3-2. 레시피 매핑 (카테고리 리매핑 없음) ★★★
            # meal_plan의 recipe_id를 직접 사용
            # ============================================

            # 4. 메뉴별 데이터 구성
            menus_data = []
            processed_menus = set()  # 중복 방지

            for plan in meal_plans:
                plan_id, slot_name, menus_json, plan_category = plan

                if not menus_json:
                    continue

                # menus 파싱
                if isinstance(menus_json, str):
                    try:
                        menus_list = json.loads(menus_json)
                    except:
                        menus_list = []
                else:
                    menus_list = menus_json if isinstance(menus_json, list) else []

                # 슬롯의 식수
                slot_meal_count = slot_counts.get(slot_name, 0)

                # ★★★ 식수가 0인 슬롯: fallback 매칭 시도 (이름 불일치 극복) ★★★
                if slot_meal_count == 0:
                    # Fallback 1: slot_id 기준으로 meal_counts 재조회
                    try:
                        fallback_query = """
                            SELECT SUM(mc.meal_count)
                            FROM meal_counts mc
                            JOIN category_slots cs ON cs.id = mc.slot_id
                            WHERE mc.work_date = %s AND cs.slot_name = %s AND mc.slot_id IS NOT NULL
                        """
                        fallback_params = [instruction_date, slot_name]
                        if site_id:
                            fallback_query += " AND mc.site_id = %s"
                            fallback_params.append(site_id)
                        cursor.execute(fallback_query, fallback_params)
                        fallback_result = cursor.fetchone()
                        if fallback_result and fallback_result[0]:
                            slot_meal_count = int(fallback_result[0])
                            print(f"[조리지시서] Fallback(slot_id) 매칭 성공: {slot_name} → {slot_meal_count}명")
                    except Exception as e:
                        print(f"[조리지시서] Fallback(slot_id) 조회 실패: {e}")

                    # Fallback 2: 부분 문자열 매칭 (최후의 수단)
                    if slot_meal_count == 0:
                        for mc_name, mc_count in slot_counts.items():
                            if mc_name and slot_name and (mc_name in slot_name or slot_name in mc_name):
                                slot_meal_count += mc_count
                        if slot_meal_count > 0:
                            print(f"[조리지시서] Fallback(부분매칭) 성공: {slot_name} → {slot_meal_count}명")

                    if slot_meal_count == 0:
                        print(f"[조리지시서] ⚠️ 식수 0 슬롯 건너뜀: {slot_name} (date={instruction_date})")
                        continue

                # 끼니 유형 추출 - meal_count_sites의 meal_type 우선 사용
                meal_type = slot_meal_type_map.get(slot_name)
                if not meal_type:
                    # 매핑이 없으면 slot_name에서 추론 (fallback)
                    meal_type = '중식'  # 기본값
                    if '조' in slot_name or '아침' in slot_name:
                        meal_type = '조식'
                    elif '석' in slot_name or '저녁' in slot_name:
                        meal_type = '석식'
                    elif '야' in slot_name:
                        meal_type = '야식'

                for menu in menus_list:
                    if isinstance(menu, dict):
                        menu_id = menu.get('id')
                        menu_name = menu.get('canonical_name') or menu.get('name', '')
                    elif isinstance(menu, int):
                        menu_id = menu
                        menu_name = ''
                    else:
                        continue

                    if not menu_id:
                        continue

                    # ★★★ meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 제거) ★★★
                    target_recipe_id = menu_id

                    # 중복 체크 (같은 메뉴가 여러 슬롯에 있을 수 있음)
                    menu_key = (menu_id, meal_type, plan_category)

                    # 레시피 재료 조회 (★ base_weight_grams, required_grams 추가)
                    # ★★★ 카테고리에 맞는 target_recipe_id 사용 ★★★
                    cursor.execute("""
                        SELECT
                            mr.id, mr.recipe_name,
                            COALESCE(mr.suffix, '') as suffix,
                            mri.ingredient_code, mri.ingredient_name, mri.specification,
                            mri.quantity, mri.unit,
                            i.id as ingredient_id,
                            COALESCE(i.base_weight_grams, 1000) as base_weight_grams,
                            mri.required_grams
                        FROM menu_recipes mr
                        JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                        LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                        WHERE mr.id = %s
                        ORDER BY mri.id
                    """, (target_recipe_id,))

                    ingredients_rows = cursor.fetchall()

                    if not ingredients_rows:
                        continue

                    # 메뉴 이름 (DB에서 가져온 것 우선) - suffix 포함하여 구분
                    base_name = (ingredients_rows[0][1] if ingredients_rows else menu_name).strip()
                    suffix_val = (ingredients_rows[0][2] if ingredients_rows else '').strip()
                    actual_menu_name = base_name  # 접미사 제외하여 같은 메뉴 통합

                    # 오버라이드 적용: 대체/제외 처리
                    modified_rows = []
                    for ing_row in ingredients_rows:
                        (recipe_id_val, recipe_name_val, _suffix_val, ing_code, ing_name, spec, per_person_qty, unit, ingredient_id, base_weight_grams, required_grams) = ing_row

                        # 해당 식자재에 대한 오버라이드 찾기
                        matching_override = None
                        for ov in overrides:
                            if ov['recipe_id'] and ov['recipe_id'] != menu_id:
                                continue
                            if ov['type'] in ('replace', 'exclude'):
                                if ov['original_id'] and ov['original_id'] == ingredient_id:
                                    matching_override = ov
                                    break
                                elif ov['original_code'] and ov['original_code'] == ing_code:
                                    matching_override = ov
                                    break

                        if matching_override:
                            if matching_override['type'] == 'exclude':
                                # 제외: 스킵
                                continue
                            elif matching_override['type'] == 'replace':
                                # 대체: 대체 정보 사용
                                # 대체 식자재 정보 조회
                                if matching_override['replacement_id']:
                                    cursor.execute("""
                                        SELECT id, ingredient_code, ingredient_name, specification,
                                               unit, COALESCE(base_weight_grams, 1000)
                                        FROM ingredients WHERE id = %s
                                    """, (matching_override['replacement_id'],))
                                    repl_row = cursor.fetchone()
                                    if repl_row:
                                        modified_rows.append((
                                            recipe_id_val, recipe_name_val, _suffix_val,
                                            repl_row[1],  # ingredient_code
                                            repl_row[2],  # ingredient_name
                                            matching_override['replacement_spec'] or repl_row[3],  # specification
                                            per_person_qty,  # 수량은 원본 유지
                                            matching_override['replacement_unit'] or repl_row[4],  # unit
                                            repl_row[0],  # ingredient_id
                                            float(repl_row[5]),  # base_weight_grams
                                            None  # required_grams
                                        ))
                                        continue

                        # 오버라이드 없으면 원본 유지
                        modified_rows.append(ing_row)

                    # 추가 오버라이드 처리
                    for ov in overrides:
                        if ov['type'] == 'add' and ov['recipe_id'] == menu_id and ov['replacement_id']:
                            cursor.execute("""
                                SELECT id, ingredient_code, ingredient_name, specification,
                                       unit, COALESCE(base_weight_grams, 1000)
                                FROM ingredients WHERE id = %s
                            """, (ov['replacement_id'],))
                            add_row = cursor.fetchone()
                            if add_row:
                                modified_rows.append((
                                    menu_id, actual_menu_name, suffix_val,
                                    add_row[1], add_row[2], add_row[3],
                                    ov['added_qty'],  # per_person_qty
                                    ov['added_unit'] or add_row[4],
                                    add_row[0],
                                    float(add_row[5]),
                                    None  # required_grams
                                ))

                    ingredients = []
                    for ing_row in modified_rows:
                        (_, _, _sfx, ing_code, ing_name, spec, per_person_qty, unit, ingredient_id, base_weight_grams, required_grams) = ing_row

                        if not per_person_qty:
                            continue

                        # 양념류 제외 (비용 계산용 항목, 실제 식자재 아님)
                        if (ing_name or '').startswith('양념류'):
                            continue

                        # 수율 적용
                        prep_yield = preprocessing_yields.get(ingredient_id, 100.0)
                        # ★ cooking_yields fallback 체인: suffix명 → canonical → base_name
                        cook_yield = get_cooking_yield(cooking_yields, actual_menu_name, ingredient_id)

                        # 필요량 계산 (포장단위)
                        required_qty = float(per_person_qty) * slot_meal_count

                        # ★★★ 1인필요량(g) - 저장된 required_grams 우선 사용 ★★★
                        base_weight_g = float(base_weight_grams or 1000)

                        if required_grams and float(required_grams) > 0:
                            # 저장된 required_grams 값 직접 사용
                            per_person_qty_g = float(required_grams)
                        else:
                            # fallback: 계산으로 구함
                            per_person_qty_float = float(per_person_qty or 0)
                            unit_lower = (unit or '').lower().strip()
                            weight_units = ['kg', 'g', 'kg/box', 'g/ea', 'ml', 'l', '리터', '그램', '킬로그램']
                            is_weight_unit = any(w in unit_lower for w in weight_units)

                            if is_weight_unit:
                                per_person_qty_g = per_person_qty_float * 1000  # kg → g 변환
                            else:
                                per_person_qty_g = per_person_qty_float * base_weight_g

                        required_qty_g = per_person_qty_g * slot_meal_count  # 총필요량(g)

                        # 조리후량 계산 (전처리수율 → 조리수율 적용)
                        cooked_qty = required_qty * (prep_yield / 100.0) * (cook_yield / 100.0)
                        cooked_qty_g = required_qty_g * (prep_yield / 100.0) * (cook_yield / 100.0)  # ★ g 단위

                        ingredients.append({
                            'ingredient_id': ingredient_id,
                            'ingredient_code': ing_code,
                            'ingredient_name': ing_name,
                            'specification': spec,
                            'unit': unit,
                            'per_person_qty': float(per_person_qty),
                            'per_person_qty_g': round(per_person_qty_g, 1),  # ★ 1인필요량(g)
                            'base_weight_grams': base_weight_g,  # ★ 기준용량(g)
                            'meal_count': slot_meal_count,
                            'required_qty': round(required_qty, 2),
                            'required_qty_g': round(required_qty_g, 1),  # ★ 총필요량(g)
                            'preprocessing_yield': prep_yield,
                            'cooking_yield': cook_yield,
                            'cooked_qty': round(cooked_qty, 2),
                            'cooked_qty_g': round(cooked_qty_g, 1),  # ★ 조리후량(g)
                            'category_per_person_qty_g': {plan_category: round(per_person_qty_g, 1)} if plan_category else {}  # ★ 카테고리별 인당량
                        })

                    if ingredients:
                        # 기존 메뉴에 식수 추가 또는 새 메뉴 추가
                        existing = None
                        for m in menus_data:
                            if m['menu_name'] == actual_menu_name and m['meal_type'] == meal_type:
                                existing = m
                                break

                        if existing:
                            # 식수와 수량 합산
                            existing['meal_count'] += slot_meal_count
                            existing['slots'].append({
                                'slot_name': slot_name,
                                'meal_count': slot_meal_count,
                                'category': plan_category
                            })
                            # 재료 수량 업데이트 (★ ingredient_id 기반 매칭 — 카테고리별 재료 수 다를 수 있음)
                            existing_ing_map = {ing.get('ingredient_id'): ing for ing in existing['ingredients']}
                            for new_ing in ingredients:
                                iid = new_ing.get('ingredient_id')
                                if iid and iid in existing_ing_map:
                                    ing = existing_ing_map[iid]
                                    ing['meal_count'] += slot_meal_count
                                    ing['required_qty'] += new_ing['required_qty']
                                    ing['required_qty_g'] = ing.get('required_qty_g', 0) + new_ing.get('required_qty_g', 0)
                                    ing['cooked_qty'] += new_ing['cooked_qty']
                                    ing['cooked_qty_g'] = ing.get('cooked_qty_g', 0) + new_ing.get('cooked_qty_g', 0)
                                    # ★ 카테고리별 인당량 병합
                                    if plan_category and new_ing.get('per_person_qty_g'):
                                        if 'category_per_person_qty_g' not in ing:
                                            ing['category_per_person_qty_g'] = {}
                                        if plan_category not in ing['category_per_person_qty_g']:
                                            ing['category_per_person_qty_g'][plan_category] = round(new_ing.get('per_person_qty_g', 0), 1)
                                elif iid:
                                    # 기존 메뉴에 없는 새 재료 추가
                                    existing['ingredients'].append(new_ing)
                        else:
                            menus_data.append({
                                'menu_id': menu_id,
                                'menu_name': actual_menu_name,
                                'meal_type': meal_type,
                                'category': plan_category,
                                'meal_count': slot_meal_count,
                                'slots': [{
                                    'slot_name': slot_name,
                                    'meal_count': slot_meal_count,
                                    'category': plan_category
                                }],
                                'ingredients': ingredients
                            })

            # 최종 반올림 (합산 중 반올림 제거 → 출력 시 반올림)
            for menu in menus_data:
                for ing in menu.get('ingredients', []):
                    ing['required_qty'] = round(ing.get('required_qty', 0), 3)
                    ing['required_qty_g'] = round(ing.get('required_qty_g', 0), 1)
                    ing['cooked_qty'] = round(ing.get('cooked_qty', 0), 3)
                    ing['cooked_qty_g'] = round(ing.get('cooked_qty_g', 0), 1)

            # 총 식수 계산
            total_meal_count = sum(category_counts.values())

            # 데이터 변경 감지
            current_hash = calculate_data_hash(cursor, instruction_date, category, site_id)
            change_info = check_order_changes(cursor, instruction_date, category, site_id)


            return {
                "success": True,
                "instruction_date": instruction_date,
                "category": category,
                "category_counts": category_counts,
                "total_meal_count": total_meal_count,
                "menus": menus_data,
                "data_source": "recipe",  # ★ 항상 레시피 기준 (재고 미발주 누락 방지)
                # 동기화 정보
                "sync_info": {
                    "current_hash": current_hash,
                    "has_saved_instruction": change_info.get('has_saved', False),
                    "has_data_changes": change_info.get('has_changes', False),
                    "order_updated_after_save": change_info.get('order_updated_after', False),
                    "saved_at": change_info.get('saved_at'),
                    "warning": "식단 또는 식수 데이터가 변경되었습니다. 조리지시서를 다시 저장해주세요." if change_info.get('has_changes') else None
                }
            }

    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc(), "data_source": "recipe"}


# ============================================
# ★★★ 발주서 기준 조리지시서 조회 함수 (핵심) ★★★
# ============================================

async def _get_cooking_instruction_from_orders(
    cursor, conn, instruction_date: str, category: str, site_id: int,
    order_ids: list, order_numbers: list, order_statuses: list
):
    """
    발주서(order_items) 기준으로 조리지시서 데이터 생성
    - ★★★ per_person_qty_g를 기준으로 모든 계산 수행 ★★★
    - 발주 시점의 스냅샷 데이터 사용 (레시피 변경 영향 없음)
    - 여러 발주서(원본 + 추가발주)를 통합 처리
    """
    try:
        # 1. order_items에서 모든 발주서의 데이터 조회
        # ★ 여러 발주서를 한 번에 조회 (IN 절 사용)
        placeholders = ','.join(['%s'] * len(order_ids))
        items_query = f"""
            SELECT
                oi.order_id,
                oi.ingredient_id, oi.ingredient_code, oi.ingredient_name,
                oi.specification, oi.unit, oi.supplier_name,
                oi.meal_type, oi.meal_category, oi.menu_name,
                oi.slot_name, oi.delivery_site_name,
                oi.per_person_qty, oi.per_person_qty_g, oi.meal_count,
                oi.required_qty, oi.order_qty, oi.unit_price,
                COALESCE(i.base_weight_grams, 1000) as base_weight_grams,
                oi.category_counts as row_category_counts
            FROM order_items oi
            LEFT JOIN ingredients i ON oi.ingredient_id = i.id
            WHERE oi.order_id IN ({placeholders})
        """
        items_params = list(order_ids)

        if category:
            # ★ 사업장 카테고리(학교, 도시락, 운반, 요양원) 기준 필터링
            # category_counts JSONB에 해당 카테고리 키가 있거나,
            # category_counts가 NULL/비어있으면 meal_category로 fallback
            items_query += """ AND (
                oi.category_counts ? %s
                OR oi.category_counts IS NULL
                OR oi.category_counts = '{}'::jsonb
                OR oi.meal_category = %s
            )"""
            items_params.append(category)
            items_params.append(category)

        items_query += " ORDER BY oi.menu_name, oi.slot_name, oi.ingredient_name"

        cursor.execute(items_query, items_params)
        rows = cursor.fetchall()

        if not rows:
            return {
                "success": True,
                "instruction_date": instruction_date,
                "category": category,
                "message": "해당 발주서에 데이터가 없습니다.",
                "menus": [],
                "category_counts": {},
                "total_meal_count": 0,
                "data_source": "order",
                "order_info": {
                    "order_ids": order_ids,
                    "order_numbers": order_numbers,
                    "order_count": len(order_ids)
                }
            }

        # 2. 전처리/조리 수율 조회
        cursor.execute("SELECT ingredient_id, yield_rate FROM preprocessing_yields")
        preprocessing_yields = {row[0]: float(row[1]) for row in cursor.fetchall()}

        # 날짜별 전처리지시서 수율 조회 (글로벌 수율보다 우선)
        # site_id 매칭 우선, 같은 조건이면 최근 업데이트 우선
        date_yield_query = """
            SELECT DISTINCT ON (pii.ingredient_id) pii.ingredient_id, pii.yield_rate
            FROM preprocessing_instruction_items pii
            JOIN preprocessing_instructions pi ON pii.instruction_id = pi.id
            WHERE pi.cooking_date = %s AND pi.status != 'cancelled'
        """
        date_yield_params = [instruction_date]
        if site_id:
            date_yield_query += " AND (pi.site_id = %s OR pi.site_id IS NULL)"
            date_yield_params.append(site_id)
        date_yield_query += " ORDER BY pii.ingredient_id, pi.site_id IS NULL, pi.updated_at DESC"
        cursor.execute(date_yield_query, date_yield_params)
        for row in cursor.fetchall():
            if row[0] and row[1] is not None:
                preprocessing_yields[row[0]] = float(row[1])

        cursor.execute("SELECT menu_name, ingredient_id, cooking_yield_rate FROM cooking_yields")
        cooking_yields = {}
        for row in cursor.fetchall():
            key = (row[0], row[1])
            cooking_yields[key] = float(row[2]) if row[2] else 100.0

        # ★ 사업장 카테고리 목록 (이 목록에 없으면 식자재 카테고리로 판단)
        BIZ_CATEGORIES = {'학교', '도시락', '운반', '요양원', '행사', '본사'}

        # 3. 메뉴별로 그룹화
        # ★★★ 핵심 구조 ★★★
        # menus_map: {(menu_name, meal_type): {menu_info}}
        # menu_info.slots: {(slot_name, category): {slot_info}}  # 슬롯+카테고리 조합으로 유니크
        # menu_info.ingredients: {(ingredient_id, slot_name): {ing_data}}  # 슬롯별로 분리 (합산용)
        menus_map = {}
        category_counts = {}  # {category: total_count}
        processed_slot_keys = set()  # 식수 중복 집계 방지용
        validation_warnings = []  # ★ 검증 경고 수집

        for row in rows:
            (order_id_row,
             ingredient_id, ingredient_code, ingredient_name,
             specification, unit, supplier_name,
             meal_type, meal_category, menu_name,
             slot_name, delivery_site_name,
             per_person_qty, per_person_qty_g, meal_count,
             required_qty, order_qty, unit_price,
             base_weight_grams, row_category_counts) = row

            # 양념류 제외 (비용 계산용 항목, 실제 식자재 아님)
            if (ingredient_name or '').startswith('양념류'):
                continue

            # ★ meal_category 보정: 식자재 카테고리(김치 등)이면 사업장 카테고리로 변환
            # category_counts JSONB의 키에서 사업장 카테고리를 추출하여 사용
            if meal_category and meal_category not in BIZ_CATEGORIES:
                biz_cat_from_counts = None
                if row_category_counts and isinstance(row_category_counts, dict):
                    for k in row_category_counts:
                        if k in BIZ_CATEGORIES:
                            biz_cat_from_counts = k
                            break
                meal_category = biz_cat_from_counts or category or meal_category

            # 메뉴 키 (menu_name + meal_type) - ★ base_name으로 접미사 제거하여 같은 메뉴 통합
            clean_menu_name = get_base_name((menu_name or '(미지정)').strip())
            menu_key = (clean_menu_name, meal_type or '중식')

            if menu_key not in menus_map:
                menus_map[menu_key] = {
                    'menu_name': clean_menu_name,
                    'meal_type': meal_type or '중식',
                    'categories': set(),  # ★ 여러 카테고리 가능
                    'slots': {},  # {(slot_name, category): {slot_info}}
                    'ingredients': {},  # {ingredient_id: ing_data}
                    'total_meal_count': 0
                }

            menu_data = menus_map[menu_key]

            # 카테고리 추가
            if meal_category:
                menu_data['categories'].add(meal_category)

            # 슬롯별 식수 집계
            # ★ 같은 슬롯에 여러 row가 있을 수 있음 (다른 식수 그룹) → 합산
            slot_key = (slot_name or '(미지정)', meal_category or '')
            global_slot_key = (menu_key, slot_key)

            if slot_key not in menu_data['slots']:
                menu_data['slots'][slot_key] = {
                    'slot_name': slot_name or '(미지정)',
                    'meal_count': 0,
                    'category': meal_category
                }

            # ★ 슬롯 식수 집계: (슬롯, meal_count) 조합으로 중복 방지
            # 같은 슬롯에 여러 식수 그룹(다른 meal_count)이 있으면 각각 합산
            # 같은 (슬롯, meal_count) 조합은 한 번만 집계
            slot_mc_key = (global_slot_key, meal_count or 0)
            if slot_mc_key not in processed_slot_keys:
                processed_slot_keys.add(slot_mc_key)
                menu_data['slots'][slot_key]['meal_count'] += (meal_count or 0)
                menu_data['total_meal_count'] += (meal_count or 0)
                if meal_category:
                    category_counts[meal_category] = category_counts.get(meal_category, 0) + (meal_count or 0)

            # ★★★ 식자재 수량: order_items의 값을 직접 사용 (재계산 안 함) ★★★
            # order_items에 저장된 per_person_qty_g를 그대로 사용
            ppq_g = float(per_person_qty_g or 0)
            base_weight_g = float(base_weight_grams or 1000)
            slot_meal_count = meal_count or 0

            # ★ required_qty(kg)를 직접 사용 - 발주 시점에 계산된 정확한 값
            row_required_qty = float(required_qty or 0)
            # ★★★ 핵심: 발주서의 required_qty(kg)를 g로 변환하여 사용 ★★★
            required_qty_g = row_required_qty * 1000

            # ★★★ per_person_qty_g 검증 - 0이면 안 됨 (데이터 오류) ★★★
            if ppq_g <= 0:
                warning_msg = f"{menu_name} - {ingredient_name}: 인당량(per_person_qty_g) 누락"
                validation_warnings.append({
                    'type': 'missing_per_person_qty_g',
                    'menu_name': menu_name,
                    'ingredient_name': ingredient_name,
                    'slot_name': slot_name,
                    'message': warning_msg
                })
                print(f"[조리지시서] ⚠️ {warning_msg} (slot: {slot_name})")
                # 데이터 무결성을 위해 required_qty에서 역산 (임시 대응)
                if slot_meal_count > 0 and required_qty_g > 0:
                    ppq_g = round(required_qty_g / slot_meal_count, 1)
                    print(f"    → required_qty({row_required_qty}kg) / 식수({slot_meal_count}) = {ppq_g}g 으로 역산")

            # 수율 적용
            prep_yield = preprocessing_yields.get(ingredient_id, 100.0)
            # ★ cooking_yields fallback 체인: suffix명 → canonical → base_name
            cook_yield = get_cooking_yield(cooking_yields, menu_name, ingredient_id)

            # 조리후량 계산
            cooked_qty_pkg = row_required_qty * (prep_yield / 100.0) * (cook_yield / 100.0)
            cooked_qty_g = required_qty_g * (prep_yield / 100.0) * (cook_yield / 100.0)

            per_person_qty_float = float(per_person_qty or 0)

            # ★ 식자재 집계 (같은 식자재는 합산 - 모든 row 합산)
            ing_key = ingredient_id or ingredient_code

            if ing_key not in menu_data['ingredients']:
                menu_data['ingredients'][ing_key] = {
                    'ingredient_id': ingredient_id,
                    'ingredient_code': ingredient_code,
                    'ingredient_name': ingredient_name,
                    'specification': specification,
                    'unit': unit,
                    'supplier_name': supplier_name,
                    'per_person_qty': per_person_qty_float,
                    'per_person_qty_g': round(ppq_g, 1),
                    'base_weight_grams': base_weight_g,
                    'meal_count': 0,
                    'required_qty': 0,
                    'required_qty_g': 0,
                    'preprocessing_yield': prep_yield,
                    'cooking_yield': cook_yield,
                    'cooked_qty': 0,
                    'cooked_qty_g': 0,
                    'category_per_person_qty_g': {},  # ★ 카테고리별 인당량(g)
                }

            ing_data = menu_data['ingredients'][ing_key]

            # ★ 카테고리별 인당량(g) 저장 - 프론트엔드에서 참조
            # ★★★ 이미 값이 있으면 덮어쓰지 않음 (첫 번째 값 유지) ★★★
            if meal_category and ppq_g > 0:
                if meal_category not in ing_data['category_per_person_qty_g']:
                    ing_data['category_per_person_qty_g'][meal_category] = round(ppq_g, 1)

            # ★ 모든 order_items row를 합산 (각 row는 DB의 고유 레코드)
            # ★ 합산 중에는 반올림하지 않음 (전처리지시서와 동일 방식, 누적 오차 방지)
            ing_data['meal_count'] += slot_meal_count
            ing_data['required_qty'] += row_required_qty
            ing_data['required_qty_g'] += required_qty_g
            ing_data['cooked_qty'] += cooked_qty_pkg
            ing_data['cooked_qty_g'] += cooked_qty_g

        # 4. 결과 변환
        menus_data = []
        for menu_key, menu_info in menus_map.items():
            slots_list = list(menu_info['slots'].values())

            # ingredients에서 내부 추적용 필드(_로 시작) 제거 + 최종 반올림
            ingredients_list = []
            for ing_data in menu_info['ingredients'].values():
                # ★ 합산 완료 후 최종 반올림 (전처리지시서와 동일: kg는 3자리, g는 1자리)
                ing_data['required_qty'] = round(ing_data['required_qty'], 3)
                ing_data['required_qty_g'] = round(ing_data['required_qty_g'], 1)
                ing_data['cooked_qty'] = round(ing_data['cooked_qty'], 3)
                ing_data['cooked_qty_g'] = round(ing_data['cooked_qty_g'], 1)
                clean_ing = {k: v for k, v in ing_data.items() if not k.startswith('_')}
                ingredients_list.append(clean_ing)

            # 카테고리: 여러 개면 첫 번째 것 사용 (또는 콤마로 연결)
            categories_list = list(menu_info['categories'])
            primary_category = categories_list[0] if categories_list else None

            # ★ category_meal_counts 생성 (프론트엔드 필터링용)
            # 슬롯의 category가 사업장 카테고리(학교,도시락,운반,요양원)가 아닌 경우
            # API 요청의 category 파라미터를 사용
            biz_categories = {'학교', '도시락', '운반', '요양원', '행사', '본사'}
            category_meal_counts = {}
            for slot_info in slots_list:
                cat = slot_info.get('category', '')
                # 사업장 카테고리가 아니면 요청된 category로 대체
                if cat and cat not in biz_categories and category:
                    cat = category
                if cat:
                    category_meal_counts[cat] = category_meal_counts.get(cat, 0) + (slot_info.get('meal_count', 0))

            menus_data.append({
                'menu_id': None,  # order_items에는 menu_id가 없음 (menu_name으로 식별)
                'menu_name': menu_info['menu_name'],
                'meal_type': menu_info['meal_type'],
                'category': primary_category,
                'categories': categories_list,  # ★ 모든 카테고리 리스트
                'meal_count': menu_info['total_meal_count'],
                'category_meal_counts': category_meal_counts,  # ★ 카테고리별 식수
                'slots': slots_list,
                'ingredients': ingredients_list
            })

        # 총 식수 계산
        total_meal_count = sum(category_counts.values())


        return {
            "success": True,
            "instruction_date": instruction_date,
            "category": category,
            "category_counts": category_counts,
            "total_meal_count": total_meal_count,
            "menus": menus_data,
            "data_source": "order",  # ★ 발주서 기준임을 표시
            "order_info": {
                "order_ids": order_ids,
                "order_numbers": order_numbers,
                "order_count": len(order_ids),
                "order_statuses": order_statuses
            },
            "sync_info": {
                "message": "발주서 기준 데이터입니다. 레시피 변경이 반영되지 않습니다.",
                "has_data_changes": False
            },
            # ★ 검증 결과 - 인당량 누락 등 데이터 오류 경고
            "validation": {
                "warnings": validation_warnings,
                "warning_count": len(validation_warnings),
                "has_warnings": len(validation_warnings) > 0
            }
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "trace": traceback.format_exc(), "data_source": "order"}


# ============================================
# 소분지시서 조회 API
# ============================================

@router.get("/api/instructions/portion")
async def get_portion_instruction_v2(
    instruction_date: str = Query(..., description="소분일자"),
    category: str = Query(None, description="카테고리"),
    site_id: int = Query(None, description="사업장 ID")
):
    """
    소분지시서 조회 (조리지시서와 동일한 데이터 구조 사용)
    """
    # 조리지시서 API 재사용 (소분지시서는 조리지시서의 결과물 배분)
    result = await get_cooking_instruction_v2(instruction_date, category, site_id)

    if not result.get('success'):
        return result

    # 소분지시서용 데이터 변환
    menus = result.get('menus', [])
    portion_menus = []

    for menu in menus:
        portion_items = []
        meal_count = menu.get('meal_count', 0)

        for ing in menu.get('ingredients', []):
            cooked_qty = ing.get('cooked_qty', 0)
            cooked_qty_g = ing.get('cooked_qty_g', 0)  # ★ g 단위
            portion_per_person = round(cooked_qty / meal_count, 4) if meal_count > 0 else 0
            portion_per_person_g = round(cooked_qty_g / meal_count, 1) if meal_count > 0 else 0  # ★ g 단위

            portion_items.append({
                'ingredient_id': ing.get('ingredient_id'),
                'ingredient_code': ing.get('ingredient_code'),
                'ingredient_name': ing.get('ingredient_name'),
                'specification': ing.get('specification'),
                'unit': ing.get('unit'),
                'cooked_qty': cooked_qty,
                'cooked_qty_g': cooked_qty_g,  # ★ 조리후량(g)
                'portion_per_person': portion_per_person,
                'portion_per_person_g': portion_per_person_g,  # ★ 1인배분량(g)
                'portion_count': meal_count
            })

        portion_menus.append({
            'menu_id': menu.get('menu_id'),
            'menu_name': menu.get('menu_name'),
            'meal_type': menu.get('meal_type'),
            'category': menu.get('category'),
            'meal_count': meal_count,
            'slots': menu.get('slots', []),
            'items': portion_items
        })

    return {
        "success": True,
        "instruction_date": instruction_date,
        "category": category,
        "category_counts": result.get('category_counts', {}),
        "total_meal_count": result.get('total_meal_count', 0),
        "menus": portion_menus,
        "data_source": result.get('data_source', 'recipe'),  # ★ 데이터 출처 전달
        "order_info": result.get('order_info'),  # ★ 발주서 정보 전달
        "sync_info": result.get('sync_info')  # ★ 동기화 정보 전달
    }


@router.get("/api/instructions/portion/detail")
async def get_portion_instruction_detail(
    instruction_date: str = Query(..., description="소분일자"),
    category: str = Query(None, description="카테고리"),
    site_id: int = Query(None, description="사업장 ID")
):
    """
    소분지시서 상세 조회 - 납품처(delivery_site)별 배분 데이터
    [정규화] order_items의 정규화된 데이터 활용
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 해당 날짜의 확정된 발주서 조회
            order_query = """
                SELECT id FROM orders
                WHERE usage_date = %s AND status IN ('confirmed', 'ordered', 'received')
            """
            order_params = [instruction_date]
            if site_id:
                order_query += " AND site_id = %s"
                order_params.append(site_id)
            order_query += " ORDER BY created_at DESC LIMIT 1"

            cursor.execute(order_query, order_params)
            order_row = cursor.fetchone()

            if not order_row:
                # 발주서가 없으면 meal_counts에서 직접 조회
                return await get_portion_instruction_from_meal_counts(instruction_date, category, site_id)

            order_id = order_row[0]

            # 2. order_items에서 정규화된 데이터 조회 (★ per_person_qty_g 추가)
            items_query = """
                SELECT
                    oi.ingredient_id, oi.ingredient_code, oi.ingredient_name,
                    oi.specification, oi.unit, oi.supplier_name,
                    oi.meal_type, oi.meal_category, oi.menu_name,
                    oi.slot_name, oi.delivery_site_name,
                    oi.per_person_qty, oi.per_person_qty_g, oi.meal_count, oi.order_qty,
                    COALESCE(i.base_weight_grams, 1000) as base_weight_grams
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE oi.order_id = %s
            """
            items_params = [order_id]

            if category:
                # ★ 사업장 카테고리(학교, 도시락, 운반, 요양원) 기준 필터링
                items_query += " AND oi.category_counts ? %s"
                items_params.append(category)

            items_query += " ORDER BY oi.slot_name, oi.delivery_site_name, oi.ingredient_name"

            cursor.execute(items_query, items_params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            # 3. 슬롯 > 납품처 > 식자재 계층 구조로 정리
            slots_data = {}  # {slot_name: {delivery_sites: {}, total_count: 0}}

            for row in rows:
                item = dict(zip(col_names, row))
                slot = item.get('slot_name') or '(미지정)'
                ds = item.get('delivery_site_name') or '(미지정)'
                meal_count = item.get('meal_count') or 0

                if slot not in slots_data:
                    slots_data[slot] = {
                        'slot_name': slot,
                        'meal_type': item.get('meal_type'),
                        'category': item.get('meal_category'),
                        'delivery_sites': {},
                        'total_count': 0
                    }

                if ds not in slots_data[slot]['delivery_sites']:
                    slots_data[slot]['delivery_sites'][ds] = {
                        'delivery_site_name': ds,
                        'meal_count': meal_count,
                        'meal_count_max': meal_count,  # 데이터 불일치 감지용
                        'ingredients': []
                    }
                    slots_data[slot]['total_count'] += meal_count
                else:
                    # 같은 납품처가 여러 번 나타나면 meal_count 검증
                    existing_count = slots_data[slot]['delivery_sites'][ds]['meal_count']
                    if meal_count != existing_count and meal_count > 0:
                        # meal_count 불일치 시 최대값 사용 (데이터 안전성)
                        slots_data[slot]['delivery_sites'][ds]['meal_count_max'] = max(
                            slots_data[slot]['delivery_sites'][ds].get('meal_count_max', existing_count),
                            meal_count
                        )

                # 최종 meal_count는 최대값 사용 (portion_qty 계산에 사용)
                final_meal_count = slots_data[slot]['delivery_sites'][ds].get('meal_count_max', meal_count) or meal_count

                # 식자재 추가 (같은 납품처에 중복 방지)
                existing_ings = [i['ingredient_id'] for i in slots_data[slot]['delivery_sites'][ds]['ingredients']]
                if item.get('ingredient_id') not in existing_ings:
                    # ★★★ per_person_qty_g 기준으로 계산 ★★★
                    ppq_g = float(item.get('per_person_qty_g') or 0)
                    base_weight_g = float(item.get('base_weight_grams') or 1000)

                    # per_person_qty_g가 0이면 per_person_qty로 계산 (fallback)
                    if ppq_g <= 0 and item.get('per_person_qty'):
                        per_person_qty_float = float(item.get('per_person_qty') or 0)
                        unit_lower = (item.get('unit') or '').lower().strip()
                        weight_units = ['kg', 'g', 'kg/box', 'g/ea', 'ml', 'l', '리터', '그램', '킬로그램']
                        is_weight_unit = any(w in unit_lower for w in weight_units)
                        if is_weight_unit:
                            ppq_g = per_person_qty_float * 1000
                        else:
                            ppq_g = per_person_qty_float * base_weight_g

                    portion_qty_g = ppq_g * final_meal_count  # ★ 소분량(g)

                    slots_data[slot]['delivery_sites'][ds]['ingredients'].append({
                        'ingredient_id': item.get('ingredient_id'),
                        'ingredient_code': item.get('ingredient_code'),
                        'ingredient_name': item.get('ingredient_name'),
                        'specification': item.get('specification'),
                        'unit': item.get('unit'),
                        'per_person_qty': float(item.get('per_person_qty') or 0),
                        'per_person_qty_g': round(ppq_g, 1),  # ★ 1인필요량(g)
                        'portion_qty': float((item.get('per_person_qty') or 0) * final_meal_count),
                        'portion_qty_g': round(portion_qty_g, 1),  # ★ 소분량(g)
                        'supplier_name': item.get('supplier_name')
                    })

            # 4. 응답 형식 변환
            result_slots = []
            for slot_name, slot_data in slots_data.items():
                ds_list = []
                for ds_data in slot_data['delivery_sites'].values():
                    # 최종 meal_count 사용 (불일치 시 최대값)
                    final_count = ds_data.get('meal_count_max', ds_data['meal_count'])
                    ds_output = {
                        'delivery_site_name': ds_data['delivery_site_name'],
                        'meal_count': final_count,
                        'ingredients': ds_data['ingredients']
                    }
                    # 데이터 불일치 경고 (디버깅용)
                    if ds_data.get('meal_count_max') and ds_data['meal_count'] != ds_data['meal_count_max']:
                        ds_output['meal_count_warning'] = f"원본값 {ds_data['meal_count']}, 최대값 사용"
                    ds_list.append(ds_output)

                result_slots.append({
                    'slot_name': slot_data['slot_name'],
                    'meal_type': slot_data['meal_type'],
                    'category': slot_data['category'],
                    'total_count': slot_data['total_count'],
                    'delivery_site_count': len(ds_list),
                    'delivery_sites': ds_list
                })

            return {
                "success": True,
                "instruction_date": instruction_date,
                "category": category,
                "order_id": order_id,
                "slots": result_slots,
                "total_delivery_sites": sum(s['delivery_site_count'] for s in result_slots),
                "total_meal_count": sum(s['total_count'] for s in result_slots),
                "data_source": "order",  # ★ 발주서 기준
                "sync_info": {
                    "message": "발주서 기준 데이터입니다. 레시피 변경이 반영되지 않습니다."
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "data_source": "order"}


async def get_portion_instruction_from_meal_counts(instruction_date: str, category: str = None, site_id: int = None):
    """발주서 없이 meal_counts에서 직접 소분 데이터 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_counts에서 납품처별 식수 조회
            query = """
                SELECT
                    menu_name as slot_name,
                    COALESCE(category, business_type) as category,
                    site_name as delivery_site_name,
                    SUM(meal_count) as meal_count
                FROM meal_counts
                WHERE work_date = %s
            """
            params = [instruction_date]

            if category:
                query += " AND (category = %s OR business_type = %s)"
                params.extend([category, category])

            if site_id:
                query += " AND site_id = %s"
                params.append(site_id)

            query += " GROUP BY menu_name, COALESCE(category, business_type), site_name"
            query += " ORDER BY menu_name, site_name"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            # 슬롯 > 납품처 계층 구조
            slots_data = {}
            for row in rows:
                slot_name, cat, ds_name, count = row
                slot = slot_name or '(미지정)'
                ds = ds_name or '(미지정)'

                if slot not in slots_data:
                    slots_data[slot] = {
                        'slot_name': slot,
                        'category': cat,
                        'delivery_sites': [],
                        'total_count': 0
                    }

                slots_data[slot]['delivery_sites'].append({
                    'delivery_site_name': ds,
                    'meal_count': count or 0
                })
                slots_data[slot]['total_count'] += count or 0

            return {
                "success": True,
                "instruction_date": instruction_date,
                "category": category,
                "order_id": None,
                "message": "발주서가 없어 meal_counts 데이터만 조회됩니다.",
                "slots": list(slots_data.values()),
                "total_delivery_sites": sum(len(s['delivery_sites']) for s in slots_data.values()),
                "total_meal_count": sum(s['total_count'] for s in slots_data.values()),
                "data_source": "meal_counts",  # ★ 발주서 없음 - meal_counts 기준
                "sync_info": {
                    "warning": "발주서가 없습니다. 식수 데이터만 조회됩니다."
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e), "data_source": "meal_counts"}


# ============================================
# 조리지시서 저장 API
# ============================================

@router.post("/api/instructions/cooking/save")
async def save_cooking_instruction_v2(request: Request):
    """조리지시서 저장 (확정)"""
    try:
        data = await request.json()
        instruction_date = data.get('instruction_date')
        category = data.get('category')
        site_id = data.get('site_id')
        menus = data.get('menus', [])

        if not instruction_date or not category:
            return {"success": False, "error": "instruction_date와 category는 필수입니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 초기화
            init_instruction_tables(cursor, conn)

            # site_id가 None이면 0으로 처리
            site_id_val = site_id if site_id else 0

            # 기존 데이터 확인
            cursor.execute("""
                SELECT id FROM cooking_instructions_v2
                WHERE instruction_date = %s AND category = %s AND site_id = %s
            """, (instruction_date, category, site_id_val))

            existing = cursor.fetchone()

            # 총 식수 계산
            total_meal_count = sum(m.get('meal_count', 0) for m in menus)

            # 현재 데이터 해시 계산 (변경 감지용)
            data_hash = calculate_data_hash(cursor, instruction_date, category, site_id)

            if existing:
                instruction_id = existing[0]
                # 기존 데이터 삭제
                cursor.execute("DELETE FROM cooking_instruction_items_v2 WHERE instruction_id = %s", (instruction_id,))
                cursor.execute("DELETE FROM cooking_instruction_menus_v2 WHERE instruction_id = %s", (instruction_id,))
                # 업데이트 (해시 포함)
                cursor.execute("""
                    UPDATE cooking_instructions_v2
                    SET status = 'confirmed', total_meal_count = %s, data_hash = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (total_meal_count, data_hash, instruction_id))
            else:
                # 신규 생성 (해시 포함)
                cursor.execute("""
                    INSERT INTO cooking_instructions_v2
                    (instruction_date, category, site_id, status, total_meal_count, data_hash)
                    VALUES (%s, %s, %s, 'confirmed', %s, %s)
                    RETURNING id
                """, (instruction_date, category, site_id_val, total_meal_count, data_hash))
                instruction_id = cursor.fetchone()[0]

            # 메뉴 및 재료 저장
            for menu_order, menu in enumerate(menus):
                cursor.execute("""
                    INSERT INTO cooking_instruction_menus_v2
                    (instruction_id, menu_id, menu_name, meal_type, slot_name, meal_count, display_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    instruction_id,
                    menu.get('menu_id'),
                    menu.get('menu_name'),
                    menu.get('meal_type'),
                    ','.join([s['slot_name'] for s in menu.get('slots', [])]),
                    menu.get('meal_count'),
                    menu_order
                ))

                for ing_order, ing in enumerate(menu.get('ingredients', [])):
                    cursor.execute("""
                        INSERT INTO cooking_instruction_items_v2
                        (instruction_id, menu_id, menu_name, meal_type, ingredient_id, ingredient_code,
                         ingredient_name, specification, unit, per_person_qty, meal_count,
                         required_qty, preprocessing_yield, cooking_yield, cooked_qty, display_order)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        instruction_id,
                        menu.get('menu_id'),
                        menu.get('menu_name'),
                        menu.get('meal_type'),
                        ing.get('ingredient_id'),
                        ing.get('ingredient_code'),
                        ing.get('ingredient_name'),
                        ing.get('specification'),
                        ing.get('unit'),
                        ing.get('per_person_qty'),
                        ing.get('meal_count'),
                        ing.get('required_qty'),
                        ing.get('preprocessing_yield'),
                        ing.get('cooking_yield'),
                        ing.get('cooked_qty'),
                        ing_order
                    ))

            conn.commit()

            return {
                "success": True,
                "message": f"{category} 조리지시서가 저장되었습니다.",
                "instruction_id": instruction_id
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 저장된 조리지시서 목록 조회
# ============================================

@router.get("/api/instructions/cooking/list")
async def get_cooking_instruction_list(
    start_date: str = Query(None, description="시작일"),
    end_date: str = Query(None, description="종료일"),
    category: str = Query(None, description="카테고리"),
    site_id: int = Query(None, description="사업장 ID")
):
    """저장된 조리지시서 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, instruction_date, category, site_id, status,
                       total_meal_count, created_at, updated_at
                FROM cooking_instructions_v2
                WHERE 1=1
            """
            params = []

            if start_date:
                query += " AND instruction_date >= %s"
                params.append(start_date)

            if end_date:
                query += " AND instruction_date <= %s"
                params.append(end_date)

            if category:
                query += " AND category = %s"
                params.append(category)

            if site_id:
                query += " AND site_id = %s"
                params.append(site_id)

            query += " ORDER BY instruction_date DESC, category"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            instructions = []
            for row in rows:
                instructions.append({
                    'id': row[0],
                    'instruction_date': str(row[1]),
                    'category': row[2],
                    'site_id': row[3],
                    'status': row[4],
                    'total_meal_count': row[5],
                    'created_at': str(row[6]) if row[6] else None,
                    'updated_at': str(row[7]) if row[7] else None
                })


            return {"success": True, "data": instructions}

    except Exception as e:
        return {"success": False, "error": str(e)}
