#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingredients Router
식자재 관련 API 엔드포인트
"""

from fastapi import APIRouter, Request, Body, HTTPException
from core.database import get_db_connection
import pandas as pd
from datetime import date, datetime
from typing import Optional
from fastapi import UploadFile, File, Form
import io
from cachetools import TTLCache
import time

router = APIRouter()

# ★ 비활성 협력업체 캐시 (5분 TTL) - 매 요청마다 DB 조회 방지
_inactive_suppliers_cache = TTLCache(maxsize=1, ttl=300)

def get_inactive_suppliers():
    """비활성 협력업체 목록 조회 (캐싱)"""
    cache_key = "inactive_suppliers"
    if cache_key in _inactive_suppliers_cache:
        return _inactive_suppliers_cache[cache_key]

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM suppliers WHERE is_active = 0")
            result = [row[0] for row in cursor.fetchall()]
            cursor.close()
            _inactive_suppliers_cache[cache_key] = result
            print(f"[캐시] 비활성 협력업체 로드: {len(result)}개")
            return result
    except Exception as e:
        print(f"[캐시] 비활성 협력업체 조회 실패: {e}")
        return []

def clear_inactive_suppliers_cache():
    """비활성 협력업체 캐시 무효화 (활성화/비활성화 시 호출)"""
    _inactive_suppliers_cache.clear()
    print("[캐시] 비활성 협력업체 캐시 초기화됨")


@router.get("/api/ingredients/suppliers")
async def get_ingredient_suppliers():
    """식자재에 등록된 업체 목록 조회 (식자재 개수순 정렬)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT supplier_name, COUNT(*) as ingredient_count
                FROM ingredients
                WHERE supplier_name IS NOT NULL AND supplier_name != ''
                GROUP BY supplier_name
                ORDER BY COUNT(*) DESC
            """)

            suppliers = []
            for row in cursor.fetchall():
                suppliers.append({
                    "name": row[0],
                    "count": row[1]
                })

            cursor.close()

            return {
                "success": True,
                "suppliers": suppliers,
                "total": len(suppliers)
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "suppliers": []
        }


@router.get("/api/admin/ingredients-new")
async def get_ingredients_new(
    page: int = 1,
    limit: int = 1000,
    per_page: int = 1000,
    search: str = "",
    category: str = "",
    supplier: str = "",
    ingredient_name: str = "",
    ingredient_code: str = "",
    supplier_name: str = "",
    exclude_unpublished: bool = False,
    exclude_no_price: bool = False,
    target_date: Optional[str] = None
):
    """식자재 목록 조회 (페이징 지원) - Railway PostgreSQL"""
    try:
        # per_page 파라미터가 있으면 limit보다 우선
        actual_limit = per_page if per_page else limit

        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()
            is_postgresql = True

            # 기본 쿼리
            base_query = """
                SELECT id, ingredient_name, category, sub_category, ingredient_code, specification,
                       unit, supplier_name, purchase_price, selling_price, price_per_unit,
                       posting_status, origin, tax_type, delivery_days, notes, COALESCE(updated_at, created_at) as created_at, updated_at,
                       base_weight_grams
                FROM ingredients
                WHERE 1=1
            """

            count_query = "SELECT COUNT(*) FROM ingredients WHERE 1=1"
            params = []

            # 🚫 비활성 협력업체 식자재 제외 (거래중단된 업체) - ★ 캐싱 적용
            inactive_suppliers = get_inactive_suppliers()
            if inactive_suppliers:
                placeholders = ','.join(['%s'] * len(inactive_suppliers))
                inactive_filter = f" AND (supplier_name IS NULL OR supplier_name NOT IN ({placeholders}))"
                base_query += inactive_filter
                count_query += inactive_filter
                params.extend(inactive_suppliers)

            # 날짜별 유효성 필터링 (가장 먼저 적용)
            # 1. 이력은 존재하지만 해당 날짜에 유효한 판가 이력이 없는 식자재 ID 조회 후 제외
            if target_date:
                try:
                    # 날짜 형식 검증
                    datetime.strptime(target_date, '%Y-%m-%d')
                
                    # 해당 식자재의 이력 데이터가 존재하는데, target_date에 해당하는 이력은 없는 경우 (유효기간 만료/미도래)
                    # 즉, "이력 관리 대상이나 현재 유효하지 않음" -> 제외
                    # 이력이 아예 없는 식자재(레거시)는 제외하지 않음 (계속 보임)
                    exclude_ids_query = """
                        SELECT ingredient_id 
                        FROM ingredient_price_history 
                        GROUP BY ingredient_id 
                        HAVING SUM(CASE WHEN %s BETWEEN start_date AND COALESCE(end_date, '9999-12-31') THEN 1 ELSE 0 END) = 0
                    """
                    cursor.execute(exclude_ids_query, (target_date,))
                    exclude_ids = [row[0] for row in cursor.fetchall()]
                
                    if exclude_ids:
                        base_query += f" AND id NOT IN ({','.join(map(str, exclude_ids))})"
                        count_query += f" AND id NOT IN ({','.join(map(str, exclude_ids))})"
                except ValueError:
                    pass # 날짜 형식이 잘못되면 무시

            # 검색 조건 추가
            if search:
                search_condition = " AND (ingredient_name LIKE %s OR ingredient_code LIKE %s)"
                base_query += search_condition
                count_query += search_condition
                params.extend([f"%{search}%", f"%{search}%"])

            if ingredient_name:
                base_query += " AND ingredient_name LIKE %s"
                count_query += " AND ingredient_name LIKE %s"
                params.append(f"%{ingredient_name}%")

            if ingredient_code:
                base_query += " AND ingredient_code LIKE %s"
                count_query += " AND ingredient_code LIKE %s"
                params.append(f"%{ingredient_code}%")

            if supplier_name:
                base_query += " AND supplier_name LIKE %s"
                count_query += " AND supplier_name LIKE %s"
                params.append(f"%{supplier_name}%")

            if category:
                base_query += " AND category = %s"
                count_query += " AND category = %s"
                params.append(category)

            if supplier:
                base_query += " AND supplier_name = %s"
                count_query += " AND supplier_name = %s"
                params.append(supplier)

            # 필터링 조건 추가
            if exclude_unpublished:
                base_query += " AND posting_status != '미게시'"
                count_query += " AND posting_status != '미게시'"

            if exclude_no_price:
                base_query += " AND price_per_unit IS NOT NULL AND price_per_unit > 0"
                count_query += " AND price_per_unit IS NOT NULL AND price_per_unit > 0"

            # 총 개수 조회
            cursor.execute(count_query, params)
            total_count = cursor.fetchone()[0]

            # 페이징 적용
            offset = (page - 1) * actual_limit
            base_query += " ORDER BY id DESC LIMIT %s OFFSET %s"
            params.extend([actual_limit, offset])

            # 데이터 조회
            cursor.execute(base_query, params)
            ingredients = []
            columns = ['id', 'ingredient_name', 'category', 'sub_category', 'ingredient_code', 'specification',
                       'unit', 'supplier_name', 'purchase_price', 'selling_price', 'price_per_unit',
                       'posting_status', 'origin', 'tax_type', 'delivery_days', 'notes', 'created_at', 'updated_at',
                       'base_weight_grams']

            for row in cursor.fetchall():
                # PostgreSQL 호환: 튜플을 딕셔너리로 변환
                ingredient = dict(zip(columns, row))

                # 기본식자재 필드 추가 (프론트엔드에서 기대하는 필드)
                ingredient_name = ingredient.get('ingredient_name', '')
                if ingredient_name:
                    # 괄호 앞부분을 기본식자재로 사용
                    basic_ingredient = ingredient_name.split('(')[0].strip() if '(' in ingredient_name else ingredient_name
                    ingredient['기본식자재(세분류)'] = basic_ingredient
                else:
                    ingredient['기본식자재(세분류)'] = ''

                ingredients.append(ingredient)

            cursor.close()

            return {
                "success": True,
                "data": {
                    "ingredients": ingredients,
                    "pagination": {
                        "current_page": page,
                        "per_page": actual_limit,
                        "total_count": total_count,
                        "total_pages": (total_count + actual_limit - 1) // actual_limit
                    }
                },
                "message": f"식자재 {len(ingredients)}개 조회 성공"
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": "식자재 조회 실패"
        }

@router.get("/api/admin/ingredients-enhanced")
async def get_admin_ingredients_enhanced(
    page: int = 1,
    size: int = 50,
    per_page: Optional[int] = None,  # 프론트엔드 호환성
    search_supplier: str = "",
    search_name: str = "",
    search_code: str = "",
    exclude_unpublished: bool = False,
    exclude_no_price: bool = False,
    target_date: Optional[str] = None,
    filter_no_base_weight: bool = False,  # 기준용량 미입력만 필터
    site_id: Optional[int] = None  # 🏢 사업장 필터링
):
    """향상된 식자재 목록 API - 메뉴/레시피 시스템용 (site_id 필터링 지원)"""
    try:
        # per_page 파라미터가 명시적으로 전달된 경우만 사용
        if per_page is not None:
            size = per_page

        # Railway PostgreSQL 연결
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
        except Exception as e:
            return {"success": False, "error": f"데이터베이스 연결 실패: {str(e)}"}

        # 기본 쿼리 조건
        where_conditions = ["1=1"]
        params = []

        # 🚫 비활성 협력업체 식자재 제외 (거래중단된 업체) - ★ 캐싱 적용
        inactive_suppliers = get_inactive_suppliers()
        if inactive_suppliers:
            placeholders = ','.join(['%s'] * len(inactive_suppliers))
            where_conditions.append(f"supplier_name NOT IN ({placeholders})")
            params.extend(inactive_suppliers)

        # 🏢 사업장별 협력업체 필터링
        if site_id:
            cursor.execute("""
                SELECT DISTINCT s.name
                FROM customer_supplier_mappings csm
                JOIN suppliers s ON csm.supplier_id = s.id
                WHERE csm.customer_id = %s AND csm.is_active = 1
            """, (site_id,))
            supplier_rows = cursor.fetchall()
            if supplier_rows:
                supplier_names = [row[0] for row in supplier_rows]
                placeholders = ','.join(['%s'] * len(supplier_names))
                where_conditions.append(f"supplier_name IN ({placeholders})")
                params.extend(supplier_names)
            else:
                # 매핑된 협력업체가 없으면 아무 식자재도 표시하지 않음
                where_conditions.append("1=0")

        # 검색 조건 추가 (PostgreSQL 문법)
        if search_supplier:
            where_conditions.append("supplier_name ILIKE %s")
            params.append(f"%{search_supplier}%")

        if search_name:
            where_conditions.append("ingredient_name ILIKE %s")
            params.append(f"%{search_name}%")

        if search_code:
            where_conditions.append("ingredient_code ILIKE %s")
            params.append(f"%{search_code}%")

        # 필터 조건
        if exclude_no_price:
            # 입고가와 단위당 단가가 모두 있는 것만 (요구사항: 입고가 없는 식자재 제외)
            where_conditions.append("price_per_unit IS NOT NULL AND price_per_unit > 0")
            where_conditions.append("purchase_price IS NOT NULL AND purchase_price > 0")

        if exclude_unpublished:
            # 미게시 식자재 제외 ('유'=게시, '판매중'=판매중, '무'=게시(사용가능))
            # 주의: '무'도 사용 가능한 식자재로 포함 (대부분의 식자재가 '무' 상태)
            where_conditions.append("posting_status IN ('유', '판매중', '무')")

        if filter_no_base_weight:
            # 기준용량 미입력 (base_weight_grams가 NULL이거나 0인 것만)
            # 판매가가 있는 것만 (기준용량 보정 페이지용)
            where_conditions.append("(base_weight_grams IS NULL OR base_weight_grams <= 0)")
            where_conditions.append("selling_price IS NOT NULL AND selling_price > 0")

        where_clause = " AND ".join(where_conditions)

        # 검색 조건이 있으면 단위당 단가 낮은 순, 없으면 최신순
        is_searching = search_supplier or search_name or search_code
        if is_searching:
            order_clause = "ORDER BY COALESCE(price_per_unit, 999999) ASC, ingredient_name ASC"
        else:
            order_clause = "ORDER BY id DESC"

        # PostgreSQL 쿼리 (실제 식자재 데이터) - base_weight_grams 추가
        query = f"""
            SELECT id, ingredient_code, ingredient_name, specification, unit,
                   purchase_price, selling_price, supplier_name, delivery_days, price_per_unit,
                   category, sub_category, origin, notes, COALESCE(updated_at, created_at) as updated_at, posting_status, base_weight_grams
            FROM ingredients
            WHERE {where_clause}
            {order_clause}
            LIMIT %s OFFSET %s
        """
        cursor.execute(query, params + [size, (page - 1) * size])
        ingredients = cursor.fetchall()

        # 결과를 JSON 형태로 변환
        items = []
        for ing in ingredients:
            # PostgreSQL에서 직접 읽음
            ingredient_name = ing[2] or ""

            # 기본식자재 추출 로직 (간단화하여 문제 해결)
            if ingredient_name and '(' in ingredient_name:
                basic_ingredient = ingredient_name.split('(')[0].strip()
            elif ingredient_name and ',' in ingredient_name:
                basic_ingredient = ingredient_name.split(',')[0].strip()
            else:
                basic_ingredient = ingredient_name or ""


            items.append({
                "id": ing[0],
                "ingredient_code": ing[1] or "",
                "고유코드": ing[1] or "",
                "식자재명": ingredient_name,
                "ingredient_name": ingredient_name,
                "기본식자재": basic_ingredient,  # 개선된 추출 로직
                "기본식자재(세분류)": basic_ingredient,  # 프론트엔드 호환용
                "규격": ing[3] or "",
                "specification": ing[3] or "",
                "단위": ing[4] or "",
                "unit": ing[4] or "",
                "입고가": ing[5] or 0,
                "purchase_price": ing[5] or 0,
                "판매가": ing[6] or 0,
                "selling_price": ing[6] or 0,
                "거래처명": ing[7] or "",
                "supplier_name": ing[7] or "",
                "선발주일": ing[8] or 1,
                "delivery_days": ing[8] or 1,
                "단위당 단가": ing[9] or 0,
                "price_per_unit": ing[9] or 0,
                "unit_price": ing[9] or 0,
                "분류": ing[10] or "",
                "category": ing[10] or "",
                "소분류": ing[11] or "",
                "sub_category": ing[11] or "",
                "원산지": ing[12] or "",
                "origin": ing[12] or "",
                "비고": ing[13] or "",
                "notes": ing[13] or "",
                "등록일": str(ing[14]) if ing[14] else "",
                "created_date": str(ing[14]) if ing[14] else "",
                "posting_status": ing[15] or "유",  # 빈값은 '유'(게시)로 처리
                "게시유무": ing[15] if ing[15] else "유",  # 빈값/NULL은 '유'(게시)로 처리
                "is_published": True,
                "is_stocked": True,
                "thumbnail": None,
                "base_weight_grams": float(ing[16]) if ing[16] else None  # 사용자 보정 기준중량
            })

        # Override prices if target_date is provided and history exists
        if target_date and items:
            ing_ids = [item['id'] for item in items]
            if ing_ids:
                try:
                    history_query = """
                        SELECT ingredient_id, purchase_price, selling_price, price_per_unit
                        FROM ingredient_price_history
                        WHERE ingredient_id = ANY(%s)
                          AND %s BETWEEN start_date AND COALESCE(end_date, '9999-12-31')
                    """
                    cursor.execute(history_query, (ing_ids, target_date))
                    history_map = {row[0]: row for row in cursor.fetchall()}
                    
                    for item in items:
                        if item['id'] in history_map:
                            h_data = history_map[item['id']]
                            # Override values
                            p_price = float(h_data[1]) if h_data[1] is not None else 0
                            s_price = float(h_data[2]) if h_data[2] is not None else 0
                            u_price = float(h_data[3]) if h_data[3] is not None else 0
                            
                            item['입고가'] = p_price
                            item['purchase_price'] = p_price
                            item['판매가'] = s_price
                            item['selling_price'] = s_price
                            item['단위당 단가'] = u_price
                            item['price_per_unit'] = u_price
                            item['unit_price'] = u_price
                            item['is_history_price'] = True
                except Exception as e:
                    print(f"History override error: {e}")


        return {
            "success": True,
            "items": items,
            "pagination": {
                "page": page,
                "size": size,
                "total": len(items)
            }
        }

    except Exception as e:
        return {
            "success": False,
            "items": [],
            "error": str(e)
        }

@router.get("/api/admin/ingredients-summary")
async def get_ingredients_summary():
    """식자재 요약 정보"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 총 식자재 수
            pg_cursor.execute("SELECT COUNT(*) FROM ingredients")
            total_ingredients = pg_cursor.fetchone()[0]

            # 카테고리별 식자재 수
            pg_cursor.execute("SELECT category, COUNT(*) FROM ingredients WHERE category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC LIMIT 5")
            categories = pg_cursor.fetchall()


            return {
                "success": True,
                "data": {
                    "total_ingredients": total_ingredients,
                    "categories": [{"name": cat[0], "count": cat[1]} for cat in categories]
                }
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/ingredients/recalculate-all")
async def recalculate_all_prices():
    """
    단위당 단가 일괄 재계산 API
    단가가 0이거나 NULL인 식자재를 대상으로 재계산을 시도합니다.
    """
    try:
        from core.database import simple_unit_price_calculation

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 단가가 0이거나 NULL인 식자재 조회 (입고가와 규격이 있는 것만)
            cursor.execute("""
                SELECT id, ingredient_name, specification, unit, purchase_price
                FROM ingredients
                WHERE (price_per_unit IS NULL OR price_per_unit = 0)
                  AND purchase_price > 0
                  AND specification IS NOT NULL
            """)
        
            targets = cursor.fetchall()
            updated_count = 0
            failed_count = 0
        
            for row in targets:
                ing_id, name, spec, unit, p_price = row
            
                # 계산 시도
                new_price, _ = simple_unit_price_calculation(p_price, spec, unit, return_debug_info=True)
            
                if new_price > 0:
                    # DB 업데이트
                    cursor.execute("""
                        UPDATE ingredients
                        SET price_per_unit = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (new_price, ing_id))
                    updated_count += 1
                else:
                    failed_count += 1

            conn.commit()

            return {
                "success": True,
                "total_targets": len(targets),
                "updated_count": updated_count,
                "failed_count": failed_count,
                "message": f"총 {len(targets)}개 대상 중 {updated_count}개 재계산 완료"
            }

    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/api/admin/ingredients/{ingredient_id}/recalculate")
async def recalculate_single_ingredient(ingredient_id: int):
    """
    개별 식자재 단위당 단가 재계산 API

    Args:
        ingredient_id: 재계산할 식자재 ID

    Returns:
        {
            "success": bool,
            "ingredient_id": int,
            "price_per_unit": float,
            "debug_info": dict,  # 계산 과정 정보
            "message": str
        }
    """
    try:
        from core.database import simple_unit_price_calculation

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 식자재 정보 조회
            cursor.execute("""
                SELECT id, ingredient_name, specification, unit, purchase_price, price_per_unit
                FROM ingredients
                WHERE id = %s
            """, (ingredient_id,))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": f"식자재 ID {ingredient_id}를 찾을 수 없습니다"}

            ing_id, ing_name, specification, unit, purchase_price, old_price_per_unit = row

            # 단위당 단가 재계산 (디버깅 정보 포함)
            new_price_per_unit, debug_info = simple_unit_price_calculation(
                purchase_price,
                specification,
                unit,
                return_debug_info=True
            )

            # DB 업데이트
            cursor.execute("""
                UPDATE ingredients
                SET price_per_unit = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (new_price_per_unit, ingredient_id))

            conn.commit()

            return {
                "success": True,
                "ingredient_id": ingredient_id,
                "ingredient_name": ing_name,
                "specification": specification,
                "unit": unit,
                "purchase_price": float(purchase_price) if purchase_price else 0,
                "old_price_per_unit": float(old_price_per_unit) if old_price_per_unit else 0,
                "price_per_unit": new_price_per_unit,
                "debug_info": debug_info,
                "message": f"'{ing_name}' 단위당 단가 재계산 완료"
            }

    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/api/admin/ingredients")
async def create_ingredient(request: Request):
    """식자재 생성"""
    try:
        data = await request.json()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
        
            # 필수 필드 체크
            name = data.get('ingredient_name') or data.get('name')
            if not name:
                return {"success": False, "error": "식자재명은 필수입니다."}

            # 자동 계산 로직 (입고가와 규격이 있으면 단위당 단가 계산)
            purchase_price = data.get('purchase_price')
            specification = data.get('specification')
            unit = data.get('unit') or data.get('base_unit')
            price_per_unit = data.get('price_per_unit')

            if not price_per_unit and purchase_price and specification:
                try:
                    from core.database import simple_unit_price_calculation
                    # simple_unit_price_calculation might return tuple or float depending on impl, check usage in recalculate_single_ingredient
                    # In recalculate_single_ingredient: new_price_per_unit, debug_info = simple_unit_price_calculation(..., return_debug_info=True)
                    # So default is probably float.
                    price_per_unit = simple_unit_price_calculation(purchase_price, specification, unit)
                except:
                    pass

            query = """
                INSERT INTO ingredients (
                    ingredient_name, category, sub_category, ingredient_code, 
                    specification, unit, purchase_price, selling_price, 
                    price_per_unit, origin, posting_status, tax_type, 
                    delivery_days, notes, created_at, updated_at, supplier_name
                ) VALUES (
                    %s, %s, %s, %s, 
                    %s, %s, %s, %s, 
                    %s, %s, %s, %s, 
                    %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, %s
                ) RETURNING id
            """
        
            params = (
                name,
                data.get('category', ''),
                data.get('sub_category') or data.get('subcategory', ''),
                data.get('ingredient_code') or data.get('code', ''),
                specification,
                unit,
                purchase_price,
                data.get('selling_price') or data.get('price'),
                price_per_unit,
                data.get('origin', ''),
                data.get('posting_status') or data.get('calculation', '유'),  # 기본값: 게시
                data.get('tax_type') or data.get('tax_free', '과세'),
                data.get('delivery_days') or data.get('selective_order'),
                data.get('notes') or data.get('memo', ''),
                data.get('supplier_name') or data.get('ingredientSupplier', '')
            )
        
            cursor.execute(query, params)
            new_id = cursor.fetchone()[0]
        
            conn.commit()
        
            return {"success": True, "id": new_id, "message": "식자재가 생성되었습니다."}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.put("/api/admin/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: int, request: Request):
    """식자재 수정 (단가 재계산 포함)"""
    try:
        data = await request.json()

        # JWT 토큰에서 사용자 ID 추출
        updated_by = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                import jwt
                from core.config import SECRET_KEY, ALGORITHM
                token = auth_header.replace('Bearer ', '')
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                updated_by = payload.get('sub')  # username
            except:
                pass  # 토큰 파싱 실패 시 무시

        with get_db_connection() as conn:
            cursor = conn.cursor()
        
            # 1. 단가 재계산 모달에서 호출된 경우 (price_per_gram)
            if 'price_per_gram' in data:
                price_per_unit = data['price_per_gram']
                # calculation_method 등은 필요시 로깅

                cursor.execute("""
                    UPDATE ingredients
                    SET price_per_unit = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
                    WHERE id = %s
                """, (price_per_unit, updated_by, ingredient_id))

                conn.commit()
                return {"success": True, "message": "단위당 단가가 업데이트되었습니다."}
            
            # 2. 일반 수정
            # 현재 값 조회 (판매가 포함)
            cursor.execute("SELECT purchase_price, specification, unit, price_per_unit, selling_price FROM ingredients WHERE id = %s", (ingredient_id,))
            current = cursor.fetchone()
            if not current:
                return {"success": False, "error": "식자재를 찾을 수 없습니다."}

            new_purchase_price = data.get('purchase_price')
            new_selling_price = data.get('selling_price') or data.get('price')
            new_spec = data.get('specification')
            new_unit = data.get('unit') or data.get('base_unit')

            # ★★★ 단위당 단가 자동 재계산 로직 (selling_price / base_weight_grams) ★★★
            price_per_unit = current[3]  # 기존 값
            should_recalculate = False

            new_base_weight = data.get('base_weight_grams')

            # 판매가 변경 감지
            if new_selling_price is not None and str(new_selling_price) != str(current[4] if current[4] is not None else ''):
                should_recalculate = True

            # 기준용량 변경 감지
            if new_base_weight is not None:
                should_recalculate = True

            if should_recalculate:
                try:
                    # ★★★ 핵심: selling_price / base_weight_grams 로 직접 계산 ★★★
                    s_price = float(new_selling_price) if new_selling_price else (float(current[4]) if current[4] else 0)

                    # base_weight_grams 조회
                    if new_base_weight:
                        base_weight = float(new_base_weight)
                    else:
                        cursor.execute("SELECT base_weight_grams FROM ingredients WHERE id = %s", (ingredient_id,))
                        bw_result = cursor.fetchone()
                        base_weight = float(bw_result[0]) if bw_result and bw_result[0] else 0

                    if s_price > 0 and base_weight > 0:
                        price_per_unit = round(s_price / base_weight, 4)
                        print(f"[PUT ingredient] price_per_unit 재계산: {s_price} / {base_weight} = {price_per_unit}")
                except Exception as e:
                    print(f"Auto calculation failed: {e}")
                
            # 업데이트 쿼리 구성
            update_fields = []
            params = []
        
            # 매핑 정의 (Frontend field name -> DB column name)
            field_map = {
                'ingredient_name': 'ingredient_name', 'name': 'ingredient_name',
                'category': 'category',
                'sub_category': 'sub_category', 'subcategory': 'sub_category',
                'ingredient_code': 'ingredient_code', 'code': 'ingredient_code',
                'specification': 'specification',
                'unit': 'unit', 'base_unit': 'unit',
                'purchase_price': 'purchase_price',
                'selling_price': 'selling_price', 'price': 'selling_price',
                'origin': 'origin',
                'posting_status': 'posting_status', 'calculation': 'posting_status',
                'tax_type': 'tax_type', 'tax_free': 'tax_type',
                'delivery_days': 'delivery_days', 'selective_order': 'delivery_days',
                'notes': 'notes', 'memo': 'notes',
                'supplier_name': 'supplier_name', 'ingredientSupplier': 'supplier_name',
                'base_weight_grams': 'base_weight_grams'  # 기준용량 보정
            }
        
            # price_per_unit는 위에서 계산됨
            update_fields.append("price_per_unit = %s")
            params.append(price_per_unit)
        
            processed_columns = set()

            for key, value in data.items():
                if key in field_map:
                    db_col = field_map[key]
                    if db_col not in processed_columns and db_col != 'price_per_unit':
                        # posting_status가 빈 값이면 업데이트에서 제외 (기존 값 유지)
                        if db_col == 'posting_status' and (value is None or value == ''):
                            continue
                        update_fields.append(f"{db_col} = %s")
                        params.append(value)
                        processed_columns.add(db_col)
                    
            update_fields.append("updated_at = CURRENT_TIMESTAMP")
            if updated_by:
                update_fields.append("updated_by = %s")
                params.append(updated_by)

            if not processed_columns and not should_recalculate:
                 return {"success": True, "message": "변경 사항이 없습니다."}

            query = f"UPDATE ingredients SET {', '.join(update_fields)} WHERE id = %s"
            params.append(ingredient_id)
        
            cursor.execute(query, tuple(params))
            conn.commit()
        
            return {"success": True, "message": "식자재가 수정되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}

@router.patch("/api/admin/ingredients/{ingredient_id}")
async def patch_ingredient(ingredient_id: int, request: Request):
    """식자재 부분 수정 (기준용량 보정 등)"""
    conn = None
    try:
        data = await request.json()
        print(f"[PATCH ingredient] id={ingredient_id}, data={data}")

        # JWT 토큰에서 사용자 ID 추출
        updated_by = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                import jwt
                from core.config import SECRET_KEY, ALGORITHM
                token = auth_header.replace('Bearer ', '')
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                updated_by = payload.get('sub')  # username
            except:
                pass  # 토큰 파싱 실패 시 무시

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 먼저 해당 식자재가 존재하는지 확인
            cursor.execute("SELECT id, ingredient_name FROM ingredients WHERE id = %s", (ingredient_id,))
            existing = cursor.fetchone()
            if not existing:
                return {"success": False, "error": f"ID {ingredient_id} 식자재를 찾을 수 없습니다."}

            update_fields = []
            params = []

            # 기준용량 업데이트
            if 'base_weight_grams' in data:
                base_weight = float(data['base_weight_grams']) if data['base_weight_grams'] else None
                update_fields.append("base_weight_grams = %s")
                params.append(base_weight)

                # 기준용량이 있으면 단위당 단가도 재계산
                if base_weight and base_weight > 0:
                    cursor.execute("SELECT selling_price FROM ingredients WHERE id = %s", (ingredient_id,))
                    result = cursor.fetchone()
                    if result and result[0]:
                        price_per_unit = float(result[0]) / base_weight
                        update_fields.append("price_per_unit = %s")
                        params.append(round(price_per_unit, 4))

            # 단위당 단가 직접 업데이트
            if 'price_per_unit' in data and 'base_weight_grams' not in data:
                price_per_unit = float(data['price_per_unit']) if data['price_per_unit'] else None
                update_fields.append("price_per_unit = %s")
                params.append(round(price_per_unit, 4) if price_per_unit else None)

            # 입고가 업데이트
            if 'purchase_price' in data:
                purchase_price = float(data['purchase_price']) if data['purchase_price'] else None
                update_fields.append("purchase_price = %s")
                params.append(purchase_price)

            # 판매가 업데이트
            if 'selling_price' in data:
                selling_price = float(data['selling_price']) if data['selling_price'] else None
                update_fields.append("selling_price = %s")
                params.append(selling_price)

                # ★★★ 판매가 변경 시 price_per_unit 자동 재계산 ★★★
                if selling_price and selling_price > 0 and 'base_weight_grams' not in data:
                    cursor.execute("SELECT base_weight_grams FROM ingredients WHERE id = %s", (ingredient_id,))
                    result = cursor.fetchone()
                    if result and result[0] and float(result[0]) > 0:
                        price_per_unit = selling_price / float(result[0])
                        update_fields.append("price_per_unit = %s")
                        params.append(round(price_per_unit, 4))

            # ★★★ base_weight_grams와 selling_price 동시 변경 시 재계산 ★★★
            if 'base_weight_grams' in data and 'selling_price' in data:
                bw = float(data['base_weight_grams']) if data['base_weight_grams'] else 0
                sp = float(data['selling_price']) if data['selling_price'] else 0
                if bw > 0 and sp > 0:
                    price_per_unit = sp / bw
                    # 이미 추가된 price_per_unit 필드 제거 후 새로 추가
                    for i, field in enumerate(update_fields):
                        if 'price_per_unit' in field:
                            update_fields.pop(i)
                            params.pop(i)
                            break
                    update_fields.append("price_per_unit = %s")
                    params.append(round(price_per_unit, 4))

            if not update_fields:
                return {"success": False, "error": "업데이트할 필드가 없습니다."}

            update_fields.append("updated_at = CURRENT_TIMESTAMP")
            if updated_by:
                update_fields.append("updated_by = %s")
                params.append(updated_by)
            params.append(ingredient_id)

            query = f"UPDATE ingredients SET {', '.join(update_fields)} WHERE id = %s"
            print(f"[PATCH ingredient] query={query}, params={params}")
            cursor.execute(query, params)

            if cursor.rowcount == 0:
                return {"success": False, "error": "업데이트된 행이 없습니다. ID를 확인해주세요."}

            conn.commit()

            return {"success": True, "message": "식자재 정보가 업데이트되었습니다."}

    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"[PATCH ingredient ERROR] id={ingredient_id}, error={str(e)}\n{error_detail}")
        pass
        return {"success": False, "error": f"서버 오류: {str(e)}"}


@router.patch("/api/ingredients/{ingredient_id}/base-weight")
async def update_ingredient_base_weight(ingredient_id: int, request: Request):
    """
    식자재 기준용량 업데이트 (메뉴/레시피 관리에서 호출)
    - base_weight_grams 업데이트
    - price_per_unit 자동 재계산 (selling_price / base_weight_grams)
    """
    conn = None
    try:
        data = await request.json()
        base_weight = data.get('base_weight_grams')

        if base_weight is None:
            return {"success": False, "error": "base_weight_grams 값이 필요합니다."}

        base_weight = float(base_weight) if base_weight else None

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 식자재 존재 확인 및 현재 selling_price 조회
            cursor.execute("""
                SELECT id, ingredient_name, selling_price, price_per_unit
                FROM ingredients WHERE id = %s
            """, (ingredient_id,))
            existing = cursor.fetchone()

            if not existing:
                return {"success": False, "error": f"ID {ingredient_id} 식자재를 찾을 수 없습니다."}

            ing_id, ing_name, selling_price, old_ppu = existing
            selling_price = float(selling_price) if selling_price else 0

            # ★★★ price_per_unit 자동 재계산 ★★★
            new_price_per_unit = None
            if base_weight and base_weight > 0 and selling_price > 0:
                new_price_per_unit = round(selling_price / base_weight, 4)

            # 업데이트 실행
            if new_price_per_unit is not None:
                cursor.execute("""
                    UPDATE ingredients
                    SET base_weight_grams = %s, price_per_unit = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (base_weight, new_price_per_unit, ingredient_id))
            else:
                cursor.execute("""
                    UPDATE ingredients
                    SET base_weight_grams = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (base_weight, ingredient_id))

            conn.commit()

            print(f"[base-weight] {ing_name}: base_weight={base_weight}g, selling_price={selling_price}, price_per_unit={new_price_per_unit}")

            return {
                "success": True,
                "message": "기준용량이 업데이트되었습니다.",
                "ingredient_id": ingredient_id,
                "ingredient_name": ing_name,
                "base_weight_grams": base_weight,
                "selling_price": selling_price,
                "price_per_unit": new_price_per_unit,
                "old_price_per_unit": float(old_ppu) if old_ppu else None
            }

    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"[base-weight ERROR] id={ingredient_id}, error={str(e)}\n{error_detail}")
        pass
        return {"success": False, "error": f"서버 오류: {str(e)}"}


@router.delete("/api/admin/ingredients/{ingredient_id}")
async def delete_ingredient(ingredient_id: int):
    """식자재 삭제 API"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 해당 식자재가 존재하는지 확인
            cursor.execute("SELECT id, ingredient_name FROM ingredients WHERE id = %s", (ingredient_id,))
            ingredient = cursor.fetchone()

            if not ingredient:
                cursor.close()
                return {"success": False, "error": f"식자재 ID {ingredient_id}를 찾을 수 없습니다."}

            ingredient_name = ingredient[1]

            # 식자재 삭제
            cursor.execute("DELETE FROM ingredients WHERE id = %s", (ingredient_id,))

            conn.commit()
            cursor.close()

            return {"success": True, "message": f"식자재 '{ingredient_name}' (ID: {ingredient_id})가 삭제되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/ingredients/delete/{ingredient_id}")
async def delete_ingredient_post(ingredient_id: int):
    """식자재 삭제 API (POST 방식)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 식자재 삭제
            cursor.execute("DELETE FROM ingredients WHERE id = %s", (ingredient_id,))
            deleted = cursor.rowcount

            conn.commit()
            cursor.close()

            if deleted > 0:
                return {"success": True, "message": f"식자재 ID {ingredient_id}가 삭제되었습니다."}
            else:
                return {"success": False, "error": f"식자재 ID {ingredient_id}를 찾을 수 없습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/ingredients/upload-price-history")
async def upload_price_history(
    file: UploadFile = File(...),
    start_date: str = Form(...),
    end_date: Optional[str] = Form(None)
):
    """식자재 단가 업로드 (시작일/종료일 일괄 적용)"""
    try:
        contents = await file.read()

        # 엑셀 파일 읽기
        try:
            df = pd.read_excel(io.BytesIO(contents), engine='openpyxl')
        except:
            df = pd.read_excel(io.BytesIO(contents), engine='xlrd')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            success_count = 0
            fail_count = 0
            errors = []

            # 컬럼 매핑 확인
            columns = df.columns.tolist()
            col_code = next((c for c in columns if '코드' in c or 'code' in c.lower()), None)
            col_purchase = next((c for c in columns if '입고가' in c or 'purchase' in c.lower()), None)
            col_selling = next((c for c in columns if '판매가' in c or 'selling' in c.lower()), None)
            col_unit_price = next((c for c in columns if '단위당' in c or 'unit_price' in c.lower()), None)

            if not col_code:
                return {"success": False, "error": "식자재 코드 컬럼('코드' 또는 'code')을 찾을 수 없습니다."}

            today = date.today().isoformat()

            for index, row in df.iterrows():
                code = str(row[col_code]).strip()
                if not code or code == 'nan':
                    continue

                try:
                    # 식자재 ID 조회
                    cursor.execute("SELECT id, specification, unit FROM ingredients WHERE ingredient_code = %s", (code,))
                    ing = cursor.fetchone()

                    if not ing:
                        fail_count += 1
                        errors.append(f"코드 {code}: 식자재를 찾을 수 없음")
                        continue

                    ing_id, spec, unit = ing

                    selling_price = row[col_selling] if col_selling and pd.notna(row[col_selling]) else 0
                    if not selling_price or selling_price <= 0:
                        purchase_price = row[col_purchase] if col_purchase and pd.notna(row[col_purchase]) else 0
                        selling_price = purchase_price if purchase_price else 0

                    if not selling_price or selling_price <= 0:
                        fail_count += 1
                        errors.append(f"코드 {code}: 단가 정보 없음")
                        continue

                    # 기존 무기한 단가가 있으면 종료일 설정 (새 시작일 하루 전으로)
                    cursor.execute("""
                        UPDATE ingredient_prices
                        SET effective_to = %s::date - INTERVAL '1 day', updated_at = NOW()
                        WHERE ingredient_id = %s
                          AND effective_to IS NULL
                          AND effective_from < %s
                    """, (start_date, ing_id, start_date))

                    # ingredient_prices에 새 단가 추가
                    cursor.execute("""
                        INSERT INTO ingredient_prices (ingredient_id, price, effective_from, effective_to)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (ingredient_id, effective_from)
                        DO UPDATE SET price = EXCLUDED.price, effective_to = EXCLUDED.effective_to, updated_at = NOW()
                    """, (ing_id, float(selling_price), start_date, end_date if end_date else None))

                    # 현재 유효한 단가인 경우 메인 테이블도 업데이트
                    is_active_period = start_date <= today and (not end_date or end_date >= today)
                    if is_active_period:
                        # ★★★ base_weight_grams 조회하여 price_per_unit 재계산 ★★★
                        cursor.execute("SELECT base_weight_grams FROM ingredients WHERE id = %s", (ing_id,))
                        bw_result = cursor.fetchone()
                        base_weight = float(bw_result[0]) if bw_result and bw_result[0] else 0

                        if base_weight > 0:
                            price_per_unit = round(float(selling_price) / base_weight, 4)
                            cursor.execute("""
                                UPDATE ingredients
                                SET selling_price = %s, price_per_unit = %s, updated_at = CURRENT_TIMESTAMP
                                WHERE id = %s
                            """, (float(selling_price), price_per_unit, ing_id))
                        else:
                            cursor.execute("""
                                UPDATE ingredients
                                SET selling_price = %s, updated_at = CURRENT_TIMESTAMP
                                WHERE id = %s
                            """, (float(selling_price), ing_id))

                    success_count += 1

                except Exception as e:
                    fail_count += 1
                    errors.append(f"코드 {code}: {str(e)}")

            conn.commit()

            return {
                "success": True,
                "message": f"총 {success_count}건 처리 완료 (실패 {fail_count}건)",
                "errors": errors[:10]  # 처음 10개 에러만 표시
            }

    except Exception as e:
        return {"success": False, "error": f"파일 처리 중 오류 발생: {str(e)}"}


# ============================================
# 날짜별 단가 관리 API
# ============================================

@router.get("/api/ingredient-prices/{ingredient_id}")
async def get_ingredient_prices(ingredient_id: int, target_date: Optional[str] = None):
    """식자재의 날짜별 단가 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if target_date:
                # 특정 날짜의 유효 단가 조회
                cursor.execute("""
                    SELECT id, price, effective_from, effective_to
                    FROM ingredient_prices
                    WHERE ingredient_id = %s
                      AND effective_from <= %s
                      AND (effective_to IS NULL OR effective_to >= %s)
                    ORDER BY effective_from DESC
                    LIMIT 1
                """, (ingredient_id, target_date, target_date))
            else:
                # 전체 단가 이력 조회
                cursor.execute("""
                    SELECT id, price, effective_from, effective_to
                    FROM ingredient_prices
                    WHERE ingredient_id = %s
                    ORDER BY effective_from DESC
                """, (ingredient_id,))

            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            prices = []
            for row in rows:
                price_data = dict(zip(col_names, row))
                for key, value in price_data.items():
                    if isinstance(value, (date, datetime)):
                        price_data[key] = str(value)
                prices.append(price_data)

            return {"success": True, "data": prices}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/ingredient-prices")
async def add_ingredient_price(request: Request):
    """새 단가 추가 (기존 단가 종료일 자동 조정)"""
    try:
        data = await request.json()
        ingredient_id = data.get("ingredient_id")
        price = data.get("price")
        effective_from = data.get("effective_from")
        effective_to = data.get("effective_to")  # Optional

        if not ingredient_id or not price or not effective_from:
            return {"success": False, "error": "ingredient_id, price, effective_from은 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 무기한 단가가 있으면 종료일 설정
            cursor.execute("""
                UPDATE ingredient_prices
                SET effective_to = %s, updated_at = NOW()
                WHERE ingredient_id = %s
                  AND effective_to IS NULL
                  AND effective_from < %s
            """, (effective_from, ingredient_id, effective_from))

            # 새 단가 추가
            cursor.execute("""
                INSERT INTO ingredient_prices (ingredient_id, price, effective_from, effective_to)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (ingredient_id, effective_from)
                DO UPDATE SET price = EXCLUDED.price, effective_to = EXCLUDED.effective_to, updated_at = NOW()
                RETURNING id
            """, (ingredient_id, price, effective_from, effective_to))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {"success": True, "message": "단가가 추가되었습니다", "id": new_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/ingredient-prices/{price_id}")
async def update_ingredient_price(price_id: int, request: Request):
    """단가 수정"""
    try:
        data = await request.json()
        price = data.get("price")
        effective_from = data.get("effective_from")
        effective_to = data.get("effective_to")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            update_fields = []
            params = []

            if price is not None:
                update_fields.append("price = %s")
                params.append(price)
            if effective_from:
                update_fields.append("effective_from = %s")
                params.append(effective_from)
            if effective_to is not None:
                update_fields.append("effective_to = %s")
                params.append(effective_to if effective_to else None)

            if not update_fields:
                return {"success": False, "error": "수정할 필드가 없습니다"}

            update_fields.append("updated_at = NOW()")
            params.append(price_id)

            cursor.execute(f"""
                UPDATE ingredient_prices
                SET {', '.join(update_fields)}
                WHERE id = %s
            """, params)

            conn.commit()

            return {"success": True, "message": "단가가 수정되었습니다"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/ingredient-prices/{price_id}")
async def delete_ingredient_price(price_id: int):
    """단가 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM ingredient_prices WHERE id = %s", (price_id,))
            conn.commit()

            return {"success": True, "message": "단가가 삭제되었습니다"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/effective-price/{ingredient_id}")
async def get_effective_price(ingredient_id: int, target_date: str):
    """특정 날짜의 유효 단가 조회 (발주 시 사용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT unit_price
                FROM ingredient_prices
                WHERE ingredient_id = %s
                  AND effective_from <= %s
                  AND (effective_to IS NULL OR effective_to >= %s)
                ORDER BY effective_from DESC
                LIMIT 1
            """, (ingredient_id, target_date, target_date))

            row = cursor.fetchone()

            if row:
                return {"success": True, "price": float(row[0])}
            else:
                # 유효 단가가 없으면 ingredients 테이블의 selling_price 반환
                cursor.execute("SELECT selling_price FROM ingredients WHERE id = %s", (ingredient_id,))
                fallback = cursor.fetchone()

                if fallback and fallback[0]:
                    return {"success": True, "price": float(fallback[0]), "fallback": True}
                return {"success": False, "error": "유효한 단가를 찾을 수 없습니다"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 식자재 사용현황 통계 API
# ============================================

@router.get("/api/ingredient-usage/by-supplier")
async def get_ingredient_usage_by_supplier(
    start_date: str,
    end_date: str,
    site_id: Optional[int] = None
):
    """
    업체별 식자재 사용현황 통계

    Args:
        start_date: 시작일 (YYYY-MM-DD)
        end_date: 종료일 (YYYY-MM-DD)
        site_id: 사업장 ID (선택)

    Returns:
        협력업체별 발주건수, 총 발주량, 총 금액, 비율
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장 필터 조건
            site_condition = "AND o.site_id = %s" if site_id else ""
            params = [start_date, end_date]
            if site_id:
                params.append(site_id)

            # 업체별 통계 쿼리
            query = f"""
                SELECT
                    oi.supplier_name,
                    COUNT(DISTINCT o.id) AS order_count,
                    SUM(oi.order_qty) AS total_qty,
                    SUM(oi.total_price) AS total_amount
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.usage_date BETWEEN %s AND %s
                  AND o.status NOT IN ('cancelled', 'draft')
                  AND oi.supplier_name IS NOT NULL
                  AND oi.supplier_name != ''
                  {site_condition}
                GROUP BY oi.supplier_name
                ORDER BY total_amount DESC
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()

            # 전체 합계 계산
            total_amount_sum = sum(float(row[3] or 0) for row in rows)

            # 결과 구성
            data = []
            for row in rows:
                supplier_name = row[0]
                order_count = row[1] or 0
                total_qty = float(row[2] or 0)
                total_amount = float(row[3] or 0)
                ratio = round((total_amount / total_amount_sum * 100), 1) if total_amount_sum > 0 else 0

                data.append({
                    "supplier_name": supplier_name,
                    "order_count": order_count,
                    "total_qty_kg": round(total_qty / 1000, 2),  # g -> kg
                    "total_amount": round(total_amount),
                    "ratio": ratio
                })


            return {
                "success": True,
                "data": data,
                "summary": {
                    "total_suppliers": len(data),
                    "total_amount": round(total_amount_sum),
                    "period": f"{start_date} ~ {end_date}"
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/ingredient-usage/by-item")
async def get_ingredient_usage_by_item(
    start_date: str,
    end_date: str,
    site_id: Optional[int] = None
):
    """
    품목별 식자재 사용현황 통계

    Args:
        start_date: 시작일 (YYYY-MM-DD)
        end_date: 종료일 (YYYY-MM-DD)
        site_id: 사업장 ID (선택)

    Returns:
        식자재별 규격, 단위, 원산지, 사용횟수, 총 사용량
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장 필터 조건
            site_condition = "AND o.site_id = %s" if site_id else ""
            params = [start_date, end_date]
            if site_id:
                params.append(site_id)

            # 품목별 통계 쿼리 (규격, 단위, 원산지, 메뉴사용횟수 포함)
            query = f"""
                SELECT
                    oi.ingredient_code,
                    oi.ingredient_name,
                    oi.specification,
                    oi.unit,
                    COALESCE(i.origin, '') AS origin,
                    oi.supplier_name,
                    COUNT(*) AS order_include_count,
                    COUNT(DISTINCT oi.menu_name) AS menu_count,
                    SUM(oi.order_qty) AS total_qty,
                    SUM(oi.total_price) AS total_amount
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE o.usage_date BETWEEN %s AND %s
                  AND o.status NOT IN ('cancelled', 'draft')
                  AND oi.ingredient_name IS NOT NULL
                  {site_condition}
                GROUP BY oi.ingredient_code, oi.ingredient_name, oi.specification, oi.unit, i.origin, oi.supplier_name
                ORDER BY order_include_count DESC, total_qty DESC
                LIMIT 500
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()

            # 총 사용량 합계
            total_qty_sum = sum(float(row[8] or 0) for row in rows)

            # 결과 구성
            data = []
            for row in rows:
                total_qty = float(row[8] or 0)
                data.append({
                    "ingredient_code": row[0] or "",
                    "ingredient_name": row[1] or "",
                    "specification": row[2] or "",
                    "unit": row[3] or "",
                    "origin": row[4] or "",
                    "supplier_name": row[5] or "",
                    "order_include_count": row[6] or 0,  # 발주포함 횟수
                    "menu_count": row[7] or 0,  # 메뉴 사용횟수
                    "total_qty": round(total_qty, 2),  # 원래 단위 그대로 (g)
                    "total_qty_kg": round(total_qty / 1000, 2),  # kg 변환
                    "total_amount": round(float(row[9] or 0))
                })


            return {
                "success": True,
                "data": data,
                "summary": {
                    "total_items": len(data),
                    "total_qty": round(total_qty_sum, 2),
                    "total_qty_kg": round(total_qty_sum / 1000, 2),
                    "period": f"{start_date} ~ {end_date}"
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/ingredient-usage/by-date")
async def get_ingredient_usage_by_date(
    start_date: str,
    end_date: str,
    site_id: Optional[int] = None
):
    """
    일자별 식자재 사용현황 통계

    Args:
        start_date: 시작일 (YYYY-MM-DD)
        end_date: 종료일 (YYYY-MM-DD)
        site_id: 사업장 ID (선택)

    Returns:
        일자별 발주건수, 품목수, 총 발주량, 총 금액
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장 필터 조건
            site_condition = "AND o.site_id = %s" if site_id else ""
            params = [start_date, end_date]
            if site_id:
                params.append(site_id)

            # 일자별 통계 쿼리
            query = f"""
                SELECT
                    o.usage_date,
                    COUNT(DISTINCT o.id) AS order_count,
                    COUNT(DISTINCT oi.ingredient_id) AS item_count,
                    SUM(oi.order_qty) AS total_qty,
                    SUM(oi.total_price) AS total_amount
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.usage_date BETWEEN %s AND %s
                  AND o.status NOT IN ('cancelled', 'draft')
                  {site_condition}
                GROUP BY o.usage_date
                ORDER BY o.usage_date ASC
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()

            # 전체 합계 계산
            total_amount_sum = sum(float(row[4] or 0) for row in rows)

            # 결과 구성
            data = []
            for row in rows:
                data.append({
                    "usage_date": str(row[0]) if row[0] else "",
                    "order_count": row[1] or 0,
                    "item_count": row[2] or 0,
                    "total_qty_kg": round(float(row[3] or 0) / 1000, 2),  # g -> kg
                    "total_amount": round(float(row[4] or 0))
                })


            return {
                "success": True,
                "data": data,
                "summary": {
                    "total_days": len(data),
                    "total_amount": round(total_amount_sum),
                    "period": f"{start_date} ~ {end_date}"
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}
