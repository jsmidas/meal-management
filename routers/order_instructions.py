#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Order Instructions Router
전처리/조리/소분 지시서 및 수율/용기/밥솥 설정 관련 API 엔드포인트
(orders.py에서 분리)
"""

import json
import re
from datetime import datetime, date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Request, Query
from typing import Optional, List
from core.database import get_db_connection
from psycopg2.extras import Json, execute_values
from utils.menu_name import get_canonical_name, get_base_name, get_cooking_yield, CATEGORY_NAME_MAP as GLOBAL_CATEGORY_NAME_MAP

router = APIRouter()


# ============================================
# 전처리 지시서 API
# ============================================

@router.get("/api/preprocessing")
async def get_preprocessing_items(
    cooking_date: str = Query(..., description="조리일자 (식단표 날짜)"),
    site_id: int = Query(None, description="사업장 ID"),
    order_id: int = Query(None, description="(호환용, 무시됨)")
):
    """전처리 지시서 조회 - ★ 레시피(meal_plans + menu_recipe_ingredients) 기반
    재고 보유로 미발주한 식자재도 누락 없이 포함"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # cut_type 컬럼 존재 여부 확인
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'preprocessing_yields' AND column_name = 'cut_type'
                )
            """)
            has_cut_type = cursor.fetchone()[0]

            print(f"[전처리지시서] 레시피 기준 조회: date={cooking_date}, site_id={site_id}")

            # ============================================
            # 1단계: meal_plans 조회 (식단표)
            # ============================================
            plan_query = """
                SELECT id, slot_name, menus, category
                FROM meal_plans
                WHERE plan_date = %s
            """
            plan_params = [cooking_date]
            if site_id:
                plan_query += " AND site_id = %s"
                plan_params.append(site_id)
            plan_query += " ORDER BY slot_name"
            cursor.execute(plan_query, plan_params)
            meal_plans = cursor.fetchall()

            if not meal_plans:
                return {
                    "success": True,
                    "cooking_date": cooking_date,
                    "meal_types": [],
                    "by_meal_type": {},
                    "preprocessing_required": [],
                    "preprocessing_not_required": [],
                    "has_draft_orders": False,
                    "draft_order_count": 0,
                    "current_order_is_draft": False,
                    "other_draft_count": 0,
                    "order_id": None,
                    "summary": {"total_items": 0, "preprocessing_count": 0, "no_preprocessing_count": 0},
                    "message": "해당 날짜에 식단이 없습니다."
                }

            # ============================================
            # 2단계: meal_counts 조회 (슬롯별 식수)
            # ============================================
            counts_query = """
                SELECT menu_name, business_type, SUM(meal_count) as total
                FROM meal_counts
                WHERE work_date = %s
            """
            counts_params = [cooking_date]
            if site_id:
                counts_query += " AND site_id = %s"
                counts_params.append(site_id)
            counts_query += " GROUP BY menu_name, business_type"
            cursor.execute(counts_query, counts_params)

            slot_counts = {}  # {slot_name: meal_count}
            slot_category_counts = {}  # {slot_name: {category: count}}
            for row in cursor.fetchall():
                menu_name, biz_type, count = row
                if menu_name:
                    slot_counts[menu_name] = slot_counts.get(menu_name, 0) + (count or 0)
                    if biz_type:
                        if menu_name not in slot_category_counts:
                            slot_category_counts[menu_name] = {}
                        slot_category_counts[menu_name][biz_type] = \
                            slot_category_counts[menu_name].get(biz_type, 0) + (count or 0)

            # slot_name → meal_type 매핑
            cursor.execute("""
                SELECT DISTINCT slot_name, meal_type
                FROM meal_count_sites
                WHERE slot_name IS NOT NULL AND meal_type IS NOT NULL
            """)
            slot_meal_type_map = {row[0]: row[1] for row in cursor.fetchall()}

            # order_items 매핑도 참조 (보완용)
            cursor.execute("""
                SELECT DISTINCT oi.slot_name, oi.meal_type
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.usage_date = %s AND oi.slot_name IS NOT NULL AND oi.meal_type IS NOT NULL
            """, (cooking_date,))
            for row in cursor.fetchall():
                slot_meal_type_map[row[0]] = row[1]

            # ============================================
            # 3단계: 전처리 수율 및 설정 조회
            # ============================================
            preprocessing_yields = {}  # {ingredient_id: {yield_rate, requires, instructions, cut_type, id}}
            py_cut_col = ", cut_type" if has_cut_type else ""
            cursor.execute(f"""
                SELECT ingredient_id, yield_rate, requires_preprocessing,
                       preprocessing_instructions, id {py_cut_col}
                FROM preprocessing_yields
            """)
            for row in cursor.fetchall():
                preprocessing_yields[row[0]] = {
                    'yield_rate': float(row[1] or 100),
                    'requires': bool(row[2]),
                    'instructions': row[3],
                    'preprocessing_id': row[4],
                    'cut_type': row[5] if has_cut_type and len(row) > 5 else ''
                }

            # 날짜별 저장된 전처리 수율 오버라이드
            date_yield_overrides = {}
            date_yield_query = """
                SELECT DISTINCT ON (pii.ingredient_id) pii.ingredient_id, pii.yield_rate
                FROM preprocessing_instruction_items pii
                JOIN preprocessing_instructions pi ON pii.instruction_id = pi.id
                WHERE pi.cooking_date = %s AND pi.status != 'cancelled'
            """
            date_yield_params = [cooking_date]
            if site_id:
                date_yield_query += " AND (pi.site_id = %s OR pi.site_id IS NULL)"
                date_yield_params.append(site_id)
            date_yield_query += " ORDER BY pii.ingredient_id, pi.site_id IS NULL, pi.updated_at DESC"
            cursor.execute(date_yield_query, date_yield_params)
            for row in cursor.fetchall():
                if row[0] and row[1] is not None:
                    date_yield_overrides[row[0]] = float(row[1])

            # ============================================
            # 3-1단계: 레시피 매핑 (카테고리 리매핑 없음)
            # meal_plan의 recipe_id를 직접 사용
            # ============================================

            # ============================================
            # 4단계: 식단표 메뉴별 레시피 재료 조회 → 식자재별 집계
            # ============================================
            BIZ_CATEGORIES = {'학교', '도시락', '운반', '요양원', '행사', '본사'}
            meal_type_order = {'조식': 1, '중식': 2, '석식': 3, '야식': 4, '행사': 5}
            aggregated = {}  # {(ingredient_id, meal_type): item}
            processed_slot_keys = set()

            for plan in meal_plans:
                plan_id, slot_name, menus_json, plan_category = plan
                if not menus_json:
                    continue

                if isinstance(menus_json, str):
                    try:
                        menus_list = json.loads(menus_json)
                    except:
                        menus_list = []
                else:
                    menus_list = menus_json if isinstance(menus_json, list) else []

                slot_meal_count = slot_counts.get(slot_name, 0)

                # Fallback: slot_id 기준 매칭
                if slot_meal_count == 0:
                    try:
                        cursor.execute("""
                            SELECT SUM(mc.meal_count)
                            FROM meal_counts mc
                            JOIN category_slots cs ON cs.id = mc.slot_id
                            WHERE mc.work_date = %s AND cs.slot_name = %s AND mc.slot_id IS NOT NULL
                        """, (cooking_date, slot_name))
                        fb = cursor.fetchone()
                        if fb and fb[0]:
                            slot_meal_count = int(fb[0])
                    except:
                        pass

                    # Fallback: 부분 문자열 매칭
                    if slot_meal_count == 0:
                        for mc_name, mc_count in slot_counts.items():
                            if mc_name and slot_name and (mc_name in slot_name or slot_name in mc_name):
                                slot_meal_count += mc_count

                    if slot_meal_count == 0:
                        print(f"[전처리지시서] 식수 0 슬롯 건너뜀: {slot_name}")
                        continue

                # 끼니 유형 추출
                meal_type = slot_meal_type_map.get(slot_name)
                if not meal_type:
                    meal_type = '중식'
                    if '조' in slot_name or '아침' in slot_name:
                        meal_type = '조식'
                    elif '석' in slot_name or '저녁' in slot_name:
                        meal_type = '석식'
                    elif '야' in slot_name:
                        meal_type = '야식'

                # 슬롯의 카테고리별 식수
                cat_counts = slot_category_counts.get(slot_name, {})
                if not cat_counts and plan_category:
                    cat_counts = {plan_category: slot_meal_count}

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

                    # 레시피 재료 조회
                    cursor.execute("""
                        SELECT
                            mr.recipe_name,
                            mri.ingredient_code, mri.ingredient_name, mri.specification,
                            mri.quantity, mri.unit,
                            i.id as ingredient_id,
                            COALESCE(i.base_weight_grams, 1000) as base_weight_grams,
                            mri.required_grams,
                            i.supplier_name
                        FROM menu_recipes mr
                        JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                        LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                        WHERE mr.id = %s
                        ORDER BY mri.id
                    """, (target_recipe_id,))

                    ingredients_rows = cursor.fetchall()
                    if not ingredients_rows:
                        continue

                    base_name = (ingredients_rows[0][0] or menu_name).strip()
                    actual_menu_name = get_base_name(base_name)

                    for ing_row in ingredients_rows:
                        (recipe_name_val, ing_code, ing_name, spec,
                         per_person_qty, unit, ingredient_id,
                         base_weight_grams, required_grams, supplier_name) = ing_row

                        if not ingredient_id:
                            continue
                        if (ing_name or '').startswith('양념류'):
                            continue

                        # per_person_qty_g 계산
                        if required_grams and float(required_grams) > 0:
                            ppq_g = float(required_grams)
                        else:
                            ppq_float = float(per_person_qty or 0)
                            base_wt = float(base_weight_grams or 1000)
                            u = (unit or '').strip()
                            if u in ('g', '그램', 'ml'):
                                ppq_g = ppq_float
                            elif u in ('kg', '킬로그램', 'l', '리터'):
                                ppq_g = ppq_float * 1000
                            else:
                                ppq_g = ppq_float * base_wt

                        # 필요량(g) = 인당량(g) × 식수
                        required_qty_g = ppq_g * slot_meal_count

                        # 전처리 수율 정보
                        py_info = preprocessing_yields.get(ingredient_id, {})
                        yield_rate = date_yield_overrides.get(
                            ingredient_id, py_info.get('yield_rate', 100))
                        requires_pp = py_info.get('requires', False)
                        pp_instructions = py_info.get('instructions', '')
                        cut_type = py_info.get('cut_type', '')
                        pp_id = py_info.get('preprocessing_id')

                        mt = meal_type
                        agg_key = (ingredient_id, mt)

                        if agg_key not in aggregated:
                            aggregated[agg_key] = {
                                'ingredient_id': ingredient_id,
                                'ingredient_code': ing_code,
                                'ingredient_name': ing_name or '',
                                'specification': spec,
                                'unit': unit,
                                'order_qty': 0,
                                'required_qty': 0,
                                'per_person_qty_g': ppq_g,
                                'meal_count': 0,
                                'base_weight_grams': float(base_weight_grams or 1000),
                                'meal_type': mt,
                                'cooking_date': cooking_date,
                                'order_number': None,
                                'requires_preprocessing': requires_pp,
                                'yield_rate': yield_rate,
                                'preprocessing_instructions': pp_instructions,
                                'cut_type': cut_type or '',
                                'preprocessing_id': pp_id,
                                'supplier_name': supplier_name or '',
                                'is_ordered': False,
                                'menu_names': [],
                                'menu_details': [],
                                '_processed_slots': set(),
                                'source': 'recipe'
                            }

                        item = aggregated[agg_key]
                        # 필요량(g → 포장단위 근사)
                        base_wt_val = float(base_weight_grams or 1000)
                        req_qty_pkg = required_qty_g / base_wt_val if base_wt_val > 0 else 0
                        item['required_qty'] += req_qty_pkg

                        if actual_menu_name and actual_menu_name not in item['menu_names']:
                            item['menu_names'].append(actual_menu_name)

                        # 식수 중복 방지
                        slot_mc_key = (agg_key, slot_name, slot_meal_count)
                        if slot_mc_key not in processed_slot_keys:
                            processed_slot_keys.add(slot_mc_key)
                            item['meal_count'] += slot_meal_count

                        # 카테고리별 메뉴 상세
                        detail_key = (agg_key, actual_menu_name, slot_name)
                        if detail_key not in item['_processed_slots']:
                            item['_processed_slots'].add(detail_key)
                            for cat, cat_count in cat_counts.items():
                                if cat in BIZ_CATEGORIES and cat_count > 0:
                                    total_cat = sum(c for k, c in cat_counts.items() if k in BIZ_CATEGORIES)
                                    cat_req = req_qty_pkg * (cat_count / total_cat) if total_cat > 0 else req_qty_pkg
                                    item['menu_details'].append({
                                        'menu_name': actual_menu_name,
                                        'meal_type': mt,
                                        'slot_name': cat,
                                        'category_name': cat,
                                        'required_qty': round(cat_req, 3),
                                        'meal_count': cat_count,
                                        'per_person_qty_g': ppq_g,
                                        'cut_type': cut_type or '',
                                        'is_ordered': False
                                    })

            # ============================================
            # 5단계: 합산 → 끼니별 분류
            # ============================================
            by_meal_type = {}
            for agg_key, item in aggregated.items():
                item.pop('_processed_slots', None)
                for k, v in item.items():
                    if isinstance(v, Decimal):
                        item[k] = float(v)

                yield_rate = float(item['yield_rate'] or 100)
                req_qty = float(item['required_qty'] or 0)
                item['final_qty'] = round(req_qty * (yield_rate / 100), 3)
                item['required_qty'] = round(req_qty, 3)
                item['order_qty'] = round(float(item['order_qty'] or 0), 3)

                menu_names = item.pop('menu_names', [])
                if len(menu_names) > 3:
                    item['menu_name'] = ', '.join(menu_names[:3]) + f' 외 {len(menu_names)-3}개'
                else:
                    item['menu_name'] = ', '.join(menu_names) if menu_names else ''

                mt = item['meal_type']
                if mt not in by_meal_type:
                    by_meal_type[mt] = {'required': [], 'not_required': [], 'source': 'recipe'}

                if item['requires_preprocessing']:
                    by_meal_type[mt]['required'].append(item)
                else:
                    by_meal_type[mt]['not_required'].append(item)

            sorted_meal_types = sorted(by_meal_type.keys(),
                                       key=lambda x: meal_type_order.get(x, 99))

            all_required = []
            all_not_required = []
            for mt in sorted_meal_types:
                all_required.extend(by_meal_type[mt]['required'])
                all_not_required.extend(by_meal_type[mt]['not_required'])

            # draft 발주서 존재 확인 (참고 정보용)
            cursor.execute("""
                SELECT COUNT(*) FROM orders
                WHERE usage_date = %s AND status = 'draft'
            """, (cooking_date,))
            draft_count = cursor.fetchone()[0]

            return {
                "success": True,
                "cooking_date": cooking_date,
                "meal_types": sorted_meal_types,
                "by_meal_type": {
                    mt: {
                        "source": "recipe",
                        "preprocessing_required": by_meal_type[mt]['required'],
                        "preprocessing_not_required": by_meal_type[mt]['not_required'],
                        "summary": {
                            "total_items": len(by_meal_type[mt]['required']) + len(by_meal_type[mt]['not_required']),
                            "preprocessing_count": len(by_meal_type[mt]['required']),
                            "no_preprocessing_count": len(by_meal_type[mt]['not_required'])
                        }
                    }
                    for mt in sorted_meal_types
                },
                "preprocessing_required": all_required,
                "preprocessing_not_required": all_not_required,
                "has_draft_orders": draft_count > 0,
                "draft_order_count": draft_count,
                "current_order_is_draft": False,
                "other_draft_count": 0,
                "order_id": None,
                "summary": {
                    "total_items": len(all_required) + len(all_not_required),
                    "preprocessing_count": len(all_required),
                    "no_preprocessing_count": len(all_not_required)
                },
                "data_source": "recipe"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/preprocessing/set-yield")
async def set_preprocessing_yield(request: Request):
    """전처리 수율 설정 및 이력 저장"""
    try:
        data = await request.json()
        ingredient_id = data.get('ingredient_id')
        ingredient_code = data.get('ingredient_code')
        ingredient_name = data.get('ingredient_name')
        yield_rate = data.get('yield_rate', 100)
        preprocessing_instructions = data.get('preprocessing_instructions', '')
        requires_preprocessing = data.get('requires_preprocessing', False)
        changed_by = data.get('changed_by', 'system')
        change_reason = data.get('change_reason', '')

        if not ingredient_id:
            return {"success": False, "error": "ingredient_id가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 설정 조회
            cursor.execute("""
                SELECT id, yield_rate, preprocessing_instructions
                FROM preprocessing_yields
                WHERE ingredient_id = %s
            """, (ingredient_id,))
            existing = cursor.fetchone()

            if existing:
                old_yield = existing[1]
                old_instructions = existing[2]

                # 이력 저장
                cursor.execute("""
                    INSERT INTO preprocessing_yield_history
                    (ingredient_id, ingredient_code, old_yield_rate, new_yield_rate,
                     old_instructions, new_instructions, changed_by, change_reason)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (ingredient_id, ingredient_code, old_yield, yield_rate,
                      old_instructions, preprocessing_instructions, changed_by, change_reason))

                # 기존 설정 업데이트
                cursor.execute("""
                    UPDATE preprocessing_yields
                    SET yield_rate = %s,
                        preprocessing_instructions = %s,
                        requires_preprocessing = %s,
                        updated_at = NOW()
                    WHERE ingredient_id = %s
                """, (yield_rate, preprocessing_instructions, requires_preprocessing, ingredient_id))
            else:
                # 새 설정 생성
                cursor.execute("""
                    INSERT INTO preprocessing_yields
                    (ingredient_id, ingredient_code, ingredient_name, yield_rate,
                     preprocessing_instructions, requires_preprocessing, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (ingredient_id, ingredient_code, ingredient_name, yield_rate,
                      preprocessing_instructions, requires_preprocessing, changed_by))

                # 첫 설정도 이력에 기록
                cursor.execute("""
                    INSERT INTO preprocessing_yield_history
                    (ingredient_id, ingredient_code, old_yield_rate, new_yield_rate,
                     old_instructions, new_instructions, changed_by, change_reason)
                    VALUES (%s, %s, NULL, %s, NULL, %s, %s, %s)
                """, (ingredient_id, ingredient_code, yield_rate,
                      preprocessing_instructions, changed_by, '최초 설정'))

            conn.commit()

            return {
                "success": True,
                "message": "전처리 수율이 저장되었습니다.",
                "data": {
                    "ingredient_id": ingredient_id,
                    "yield_rate": yield_rate,
                    "requires_preprocessing": requires_preprocessing
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/preprocessing/yield-history/{ingredient_id}")
async def get_yield_history(ingredient_id: int):
    """식자재별 수율 변경 이력 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, ingredient_code, old_yield_rate, new_yield_rate,
                       old_instructions, new_instructions, changed_by,
                       changed_at, change_reason
                FROM preprocessing_yield_history
                WHERE ingredient_id = %s
                ORDER BY changed_at DESC
            """, (ingredient_id,))

            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            history = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                history.append(item)


            return {
                "success": True,
                "ingredient_id": ingredient_id,
                "history": history,
                "total_changes": len(history)
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/preprocessing/toggle")
async def toggle_preprocessing(request: Request):
    """전처리 필요/불필요 토글"""
    try:
        data = await request.json()
        ingredient_id = data.get('ingredient_id')
        ingredient_code = data.get('ingredient_code')
        ingredient_name = data.get('ingredient_name')
        requires_preprocessing = data.get('requires_preprocessing', False)
        changed_by = data.get('changed_by', 'system')

        if not ingredient_id:
            return {"success": False, "error": "ingredient_id가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 설정 확인
            cursor.execute("""
                SELECT id FROM preprocessing_yields WHERE ingredient_id = %s
            """, (ingredient_id,))
            existing = cursor.fetchone()

            if existing:
                cursor.execute("""
                    UPDATE preprocessing_yields
                    SET requires_preprocessing = %s, updated_at = NOW()
                    WHERE ingredient_id = %s
                """, (requires_preprocessing, ingredient_id))
            else:
                cursor.execute("""
                    INSERT INTO preprocessing_yields
                    (ingredient_id, ingredient_code, ingredient_name, requires_preprocessing, created_by)
                    VALUES (%s, %s, %s, %s, %s)
                """, (ingredient_id, ingredient_code, ingredient_name, requires_preprocessing, changed_by))

            conn.commit()

            return {
                "success": True,
                "message": f"전처리 {'필요' if requires_preprocessing else '불필요'}로 설정되었습니다.",
                "requires_preprocessing": requires_preprocessing
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/preprocessing/save-instruction")
async def save_preprocessing_instruction(request: Request):
    """전처리 지시서 저장"""
    try:
        data = await request.json()
        cooking_date = data.get('cooking_date')
        site_id = data.get('site_id')
        items = data.get('items', [])
        notes = data.get('notes', '')
        created_by = data.get('created_by', 'system')

        if not cooking_date:
            return {"success": False, "error": "조리일자가 필요합니다."}

        if not items:
            return {"success": False, "error": "저장할 품목이 없습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 번호 생성
            date_str = cooking_date.replace('-', '')
            cursor.execute("""
                SELECT COUNT(*) FROM preprocessing_instructions
                WHERE cooking_date = %s AND (site_id = %s OR (%s IS NULL AND site_id IS NULL))
            """, (cooking_date, site_id, site_id))
            count = cursor.fetchone()[0]
            instruction_number = f"PP{date_str}-{count + 1:04d}"

            # 기존 지시서 확인 (같은 날짜, 같은 사업장)
            cursor.execute("""
                SELECT id FROM preprocessing_instructions
                WHERE cooking_date = %s AND (site_id = %s OR (%s IS NULL AND site_id IS NULL))
                AND status = 'draft'
            """, (cooking_date, site_id, site_id))
            existing = cursor.fetchone()

            if existing:
                instruction_id = existing[0]
                # 기존 품목 삭제
                cursor.execute("DELETE FROM preprocessing_instruction_items WHERE instruction_id = %s", (instruction_id,))
                # 지시서 업데이트
                cursor.execute("""
                    UPDATE preprocessing_instructions
                    SET total_items = %s, notes = %s, updated_at = NOW()
                    WHERE id = %s
                """, (len(items), notes, instruction_id))
            else:
                # 새 지시서 생성
                cursor.execute("""
                    INSERT INTO preprocessing_instructions
                    (instruction_number, cooking_date, site_id, total_items, notes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (instruction_number, cooking_date, site_id, len(items), notes, created_by))
                instruction_id = cursor.fetchone()[0]

            # 품목 저장 및 수율 일괄 업데이트
            yield_save_count = 0
            for item in items:
                ingredient_id = item.get('ingredient_id')
                yield_rate = item.get('yield_rate', 100)
                preprocessing_instructions = item.get('preprocessing_instructions', '')

                cut_type = item.get('cut_type', '')

                # cut_type 컬럼 존재 여부 확인 (첫 아이템에서만)
                if '_has_ct_items' not in locals():
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'preprocessing_instruction_items' AND column_name = 'cut_type'
                        )
                    """)
                    _has_ct_items = cursor.fetchone()[0]
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'preprocessing_yields' AND column_name = 'cut_type'
                        )
                    """)
                    _has_ct_yields = cursor.fetchone()[0]

                # 지시서 품목 저장
                if _has_ct_items:
                    cursor.execute("""
                        INSERT INTO preprocessing_instruction_items
                        (instruction_id, ingredient_id, ingredient_code, ingredient_name,
                         specification, unit, order_qty, yield_rate, final_qty, preprocessing_instructions, cut_type)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        instruction_id, ingredient_id, item.get('ingredient_code'),
                        item.get('ingredient_name'), item.get('specification'), item.get('unit'),
                        item.get('order_qty'), yield_rate, item.get('final_qty'),
                        preprocessing_instructions, cut_type
                    ))
                else:
                    cursor.execute("""
                        INSERT INTO preprocessing_instruction_items
                        (instruction_id, ingredient_id, ingredient_code, ingredient_name,
                         specification, unit, order_qty, yield_rate, final_qty, preprocessing_instructions)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        instruction_id, ingredient_id, item.get('ingredient_code'),
                        item.get('ingredient_name'), item.get('specification'), item.get('unit'),
                        item.get('order_qty'), yield_rate, item.get('final_qty'),
                        preprocessing_instructions
                    ))

                # 수율 테이블 업데이트 (UPSERT)
                if ingredient_id:
                    if _has_ct_yields:
                        cursor.execute("""
                            INSERT INTO preprocessing_yields
                            (ingredient_id, ingredient_code, ingredient_name, yield_rate,
                             preprocessing_instructions, cut_type, requires_preprocessing, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, true, NOW())
                            ON CONFLICT (ingredient_id) DO UPDATE SET
                                yield_rate = EXCLUDED.yield_rate,
                                preprocessing_instructions = EXCLUDED.preprocessing_instructions,
                                cut_type = EXCLUDED.cut_type,
                                requires_preprocessing = true,
                                updated_at = NOW()
                        """, (
                            ingredient_id, item.get('ingredient_code'), item.get('ingredient_name'),
                            yield_rate, preprocessing_instructions, cut_type
                        ))
                    else:
                        cursor.execute("""
                            INSERT INTO preprocessing_yields
                            (ingredient_id, ingredient_code, ingredient_name, yield_rate,
                             preprocessing_instructions, requires_preprocessing, updated_at)
                            VALUES (%s, %s, %s, %s, %s, true, NOW())
                            ON CONFLICT (ingredient_id) DO UPDATE SET
                                yield_rate = EXCLUDED.yield_rate,
                                preprocessing_instructions = EXCLUDED.preprocessing_instructions,
                                requires_preprocessing = true,
                                updated_at = NOW()
                        """, (
                            ingredient_id, item.get('ingredient_code'), item.get('ingredient_name'),
                            yield_rate, preprocessing_instructions
                        ))
                    yield_save_count += 1

            conn.commit()

            return {
                "success": True,
                "message": "전처리 지시서가 저장되었습니다.",
                "instruction_id": instruction_id,
                "instruction_number": instruction_number,
                "yield_save_count": yield_save_count
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/preprocessing/instructions")
async def get_preprocessing_instructions(
    cooking_date: str = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    site_id: int = Query(None),
    status: str = Query(None)
):
    """저장된 전처리 지시서 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT pi.id, pi.instruction_number, pi.cooking_date, pi.site_id,
                       pi.status, pi.total_items, pi.notes, pi.created_by, pi.created_at,
                       bl.site_name
                FROM preprocessing_instructions pi
                LEFT JOIN business_locations bl ON pi.site_id = bl.id
                WHERE 1=1
            """
            params = []

            if cooking_date:
                query += " AND pi.cooking_date = %s"
                params.append(cooking_date)
            elif start_date and end_date:
                query += " AND pi.cooking_date BETWEEN %s AND %s"
                params.extend([start_date, end_date])

            if site_id:
                query += " AND pi.site_id = %s"
                params.append(site_id)

            if status:
                query += " AND pi.status = %s"
                params.append(status)

            query += " ORDER BY pi.cooking_date DESC, pi.created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            instructions = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                instructions.append(item)


            return {"success": True, "instructions": instructions}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/preprocessing/instruction/{instruction_id}")
async def get_preprocessing_instruction_detail(instruction_id: int):
    """전처리 지시서 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 정보
            cursor.execute("""
                SELECT pi.*, bl.site_name
                FROM preprocessing_instructions pi
                LEFT JOIN business_locations bl ON pi.site_id = bl.id
                WHERE pi.id = %s
            """, (instruction_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            col_names = [desc[0] for desc in cursor.description]
            instruction = dict(zip(col_names, row))
            for key, value in instruction.items():
                if isinstance(value, (datetime, date)):
                    instruction[key] = str(value)
                elif isinstance(value, Decimal):
                    instruction[key] = float(value)

            # 품목 정보
            cursor.execute("""
                SELECT * FROM preprocessing_instruction_items
                WHERE instruction_id = %s
                ORDER BY id
            """, (instruction_id,))
            item_rows = cursor.fetchall()
            item_col_names = [desc[0] for desc in cursor.description]

            items = []
            for item_row in item_rows:
                item = dict(zip(item_col_names, item_row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            instruction['items'] = items

            return {"success": True, "instruction": instruction}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/preprocessing/instruction/{instruction_id}")
async def delete_preprocessing_instruction(instruction_id: int):
    """전처리 지시서 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 존재 확인
            cursor.execute("SELECT instruction_number FROM preprocessing_instructions WHERE id = %s", (instruction_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            instruction_number = row[0]

            # 품목 삭제
            cursor.execute("DELETE FROM preprocessing_instruction_items WHERE instruction_id = %s", (instruction_id,))

            # 지시서 삭제
            cursor.execute("DELETE FROM preprocessing_instructions WHERE id = %s", (instruction_id,))

            conn.commit()

            return {"success": True, "message": f"지시서 {instruction_number}가 삭제되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 조리지시서 API
# ============================================

@router.get("/api/cooking-instruction")
async def get_cooking_instruction(
    cooking_date: str = Query(..., description="조리일자 (식단표 일자)"),
    meal_type: str = Query(None, description="끼니 유형 (조식/중식/석식)"),
    site_id: int = Query(None, description="사업장 ID"),
    order_id: int = Query(None, description="특정 발주서 ID (지정 시 해당 발주서만 조회)")
):
    """조리지시서 조회 - 메뉴별 식자재 및 조리정보"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 식수 관리(meal_counts)에서 카테고리별 식수 직접 조회
            # meal_counts 테이블을 사용하여 정확한 식수 계산 (order_items 대신)
            meal_type_map = {
                'breakfast': '조식', '조식': '조식',
                'lunch': '중식', '중식': '중식',
                'dinner': '석식', '석식': '석식',
                'night': '야식', '야식': '야식',
                'event': '행사', '행사': '행사'
            }
            mapped_meal_type = meal_type_map.get(meal_type, meal_type) if meal_type else None

            # meal_counts 테이블에서 카테고리별 식수 조회
            # menu_name은 슬롯명(예: "중 5찬저"), meal_type은 끼니(조식/중식/석식)
            # category 컬럼 우선, fallback으로 business_type 사용
            # ★★★ 고아 데이터 필터링: 유효한 사업장만 조회 ★★★
            from datetime import datetime as dt_module
            cooking_date_obj = dt_module.strptime(cooking_date, '%Y-%m-%d').date()
            weekday_map_cook = {0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'}
            target_weekday_cook = weekday_map_cook[cooking_date_obj.weekday()]

            # ★ category_slots의 meal_type을 우선 사용 (마스터 설정 기준)
            # fallback: 슬롯 이름에서 끼니 추론 (조→조식, 석→석식, 야→야식, 기본→중식)
            category_query = """
                SELECT
                    COALESCE(mc.category, mc.business_type) as category,
                    COALESCE(
                        NULLIF(cs_master.meal_type, ''),
                        NULLIF(mc.meal_type, ''),
                        CASE
                            WHEN mc.menu_name LIKE '조 %%' OR mc.menu_name LIKE '조식 %%' OR mc.menu_name LIKE '조4%%' THEN '조식'
                            WHEN mc.menu_name LIKE '석 %%' OR mc.menu_name LIKE '석식 %%' OR mc.menu_name LIKE '%%%% 석식%%%%' THEN '석식'
                            WHEN mc.menu_name LIKE '야 %%' OR mc.menu_name LIKE '야식 %%' OR mc.menu_name LIKE '%%%% 야식%%%%' THEN '야식'
                            ELSE '중식'
                        END
                    ) as meal_type,
                    mc.menu_name as slot_name,
                    SUM(mc.meal_count) as total_count
                FROM meal_counts mc
                LEFT JOIN category_slots cs_master ON cs_master.slot_name = mc.menu_name AND cs_master.is_active = true
                WHERE mc.work_date = %s
                  AND EXISTS (
                    SELECT 1 FROM slot_clients scl
                    JOIN category_slots cs ON scl.slot_id = cs.id
                    JOIN site_categories scat ON cs.category_id = scat.id
                    WHERE cs.slot_name = mc.menu_name
                      AND scat.category_name = COALESCE(mc.category, mc.business_type)
                      AND scl.client_name = mc.site_name
                      AND scl.is_active = TRUE
                      AND cs.is_active = TRUE
                      AND (scl.start_date IS NULL OR scl.start_date <= %s)
                      AND (scl.end_date IS NULL OR scl.end_date >= %s)
                      AND (scl.operating_days IS NULL OR scl.operating_days = '' OR (scl.operating_days::json->>%s)::boolean = true)
                  )
            """
            category_params = [cooking_date, cooking_date, cooking_date, target_weekday_cook]

            # meal_type fallback CASE (WHERE/GROUP BY용)
            meal_type_fallback_sql = """COALESCE(
                        NULLIF(cs_master.meal_type, ''),
                        NULLIF(mc.meal_type, ''),
                        CASE
                            WHEN mc.menu_name LIKE '조 %%' OR mc.menu_name LIKE '조식 %%' OR mc.menu_name LIKE '조4%%' THEN '조식'
                            WHEN mc.menu_name LIKE '석 %%' OR mc.menu_name LIKE '석식 %%' OR mc.menu_name LIKE '%%%% 석식%%%%' THEN '석식'
                            WHEN mc.menu_name LIKE '야 %%' OR mc.menu_name LIKE '야식 %%' OR mc.menu_name LIKE '%%%% 야식%%%%' THEN '야식'
                            ELSE '중식'
                        END
                    )"""

            if mapped_meal_type:
                category_query += f" AND {meal_type_fallback_sql} = %s"
                category_params.append(mapped_meal_type)

            if site_id:
                category_query += " AND mc.site_id = %s"
                category_params.append(site_id)

            category_query += f" GROUP BY COALESCE(mc.category, mc.business_type), {meal_type_fallback_sql}, mc.menu_name"

            cursor.execute(category_query, category_params)
            category_rows = cursor.fetchall()

            # ★ 고아 데이터 조회 (조리지시서용) - 해당 날짜의 식단과 식수 직접 비교
            # 타입 A: 식수는 있는데 (meal_count > 0) 해당 슬롯+카테고리의 식단이 없음
            orphan_cook_a_query = """
                SELECT mc.menu_name, COALESCE(mc.category, mc.business_type) as category,
                       mc.site_name, mc.meal_count, '식수는 있으나 식단 미등록' as orphan_type
                FROM meal_counts mc
                WHERE mc.work_date = %s
                  AND mc.meal_count > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM meal_plans mp
                    WHERE mp.plan_date = mc.work_date
                      AND mp.slot_name = mc.menu_name
                      AND mp.category = COALESCE(mc.category, mc.business_type)
                  )
            """
            orphan_cook_params_a = [cooking_date]
            if mapped_meal_type:
                orphan_cook_a_query += " AND mc.meal_type = %s"
                orphan_cook_params_a.append(mapped_meal_type)
            if site_id:
                orphan_cook_a_query += " AND mc.site_id = %s"
                orphan_cook_params_a.append(site_id)
            cursor.execute(orphan_cook_a_query, orphan_cook_params_a)
            orphan_cook_rows_a = cursor.fetchall()

            # 타입 B: 식단은 있는데 (menus가 비어있지 않음) 해당 슬롯+카테고리의 식수가 전혀 없거나 모두 0
            orphan_cook_b_query = """
                SELECT mp.slot_name, mp.category, '(식수 없음)' as site_name, 0 as meal_count,
                       '식단은 있으나 식수 미입력' as orphan_type
                FROM meal_plans mp
                WHERE mp.plan_date = %s
                  AND jsonb_array_length(COALESCE(mp.menus, '[]'::jsonb)) > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM meal_counts mc
                    WHERE mc.work_date = mp.plan_date
                      AND mc.menu_name = mp.slot_name
                      AND COALESCE(mc.category, mc.business_type) = mp.category
                      AND mc.meal_count > 0
                  )
            """
            orphan_cook_params_b = [cooking_date]
            if site_id:
                orphan_cook_b_query += " AND mp.site_id = %s"
                orphan_cook_params_b.append(site_id)
            cursor.execute(orphan_cook_b_query, orphan_cook_params_b)
            orphan_cook_rows_b = cursor.fetchall()

            # 고아 데이터 합산
            orphan_data_cook = []
            for row in orphan_cook_rows_a:
                orphan_data_cook.append({
                    "slot": row[0], "category": row[1], "site_name": row[2],
                    "meal_count": row[3], "type": row[4]
                })
            for row in orphan_cook_rows_b:
                orphan_data_cook.append({
                    "slot": row[0], "category": row[1], "site_name": row[2],
                    "meal_count": row[3], "type": row[4]
                })

            orphan_count_cook = len(orphan_data_cook)
            orphan_meal_sum_cook = sum(item['meal_count'] or 0 for item in orphan_data_cook)
            if orphan_count_cook > 0:
                print(f"[조리지시서] ⚠️ 고아 데이터 {orphan_count_cook}건 감지됨 (식수 합계: {orphan_meal_sum_cook}명)", flush=True)
                for item in orphan_data_cook[:5]:
                    print(f"  - [{item['type']}] {item['category']} > {item['slot']} > {item['site_name']} ({item['meal_count']}명)")

            # 카테고리별 식수 집계 (meal_counts.category)
            meal_counts_dict = {}  # 끼니별 총 식수
            category_counts = {}  # 카테고리별 합계 (도시락, 운반, 학교, 요양원)
            category_counts_by_meal_type = {}  # 끼니별 카테고리 식수 {'조식': {'운반': 30}, '중식': {'도시락': 200}}

            for row in category_rows:
                cat_name, mt, slot_name, count = row
                if not count:
                    continue

                cat_name = cat_name or '기타'
                mt = mt or '기타'
                count = int(count)

                # 끼니별 합계
                if mt not in meal_counts_dict:
                    meal_counts_dict[mt] = 0
                meal_counts_dict[mt] += count

                # 끼니별 카테고리 집계
                if mt not in category_counts_by_meal_type:
                    category_counts_by_meal_type[mt] = {}
                if cat_name not in category_counts_by_meal_type[mt]:
                    category_counts_by_meal_type[mt][cat_name] = 0
                category_counts_by_meal_type[mt][cat_name] += count

                # 대분류 카테고리별 집계
                if cat_name not in category_counts:
                    category_counts[cat_name] = 0
                category_counts[cat_name] += count

            # 카테고리 정렬 순서: 도시락, 운반, 학교, 요양원, 기타
            category_order = ['도시락', '운반', '학교', '요양원', '기타']
            sorted_category_counts = {}
            for cat in category_order:
                if cat in category_counts and category_counts[cat] > 0:
                    sorted_category_counts[cat] = category_counts[cat]
            # 정렬 순서에 없는 카테고리 추가 (값이 0보다 큰 경우만)
            for cat, count in category_counts.items():
                if cat not in sorted_category_counts and count > 0:
                    sorted_category_counts[cat] = count
            category_counts = sorted_category_counts

            # 끼니별 카테고리도 같은 순서로 정렬 (0인 카테고리 제외)
            sorted_by_meal_type = {}
            for mt, cats in category_counts_by_meal_type.items():
                sorted_cats = {}
                for cat in category_order:
                    if cat in cats and cats[cat] > 0:
                        sorted_cats[cat] = cats[cat]
                for cat, count in cats.items():
                    if cat not in sorted_cats and count > 0:
                        sorted_cats[cat] = count
                if sorted_cats:  # 빈 끼니는 제외
                    sorted_by_meal_type[mt] = sorted_cats
            category_counts_by_meal_type = sorted_by_meal_type

            # 조리수율 테이블 생성 (없으면)
            # site_id: 사업장 ID (0 = 전역/기본값)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cooking_yields (
                    id SERIAL PRIMARY KEY,
                    menu_name VARCHAR(200) NOT NULL,
                    ingredient_id INTEGER,
                    site_id INTEGER NOT NULL DEFAULT 0,
                    cooking_yield_rate DECIMAL(5,2) DEFAULT 100.00,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

            # cooking_yields 테이블 마이그레이션: site_id 컬럼 추가 + UNIQUE 제약 변경
            try:
                cursor.execute("ALTER TABLE cooking_yields ADD COLUMN IF NOT EXISTS site_id INTEGER NOT NULL DEFAULT 0")
                conn.commit()
            except Exception:
                conn.rollback()
            try:
                cursor.execute("""
                    DO $$
                    BEGIN
                        -- 기존 UNIQUE 제약 삭제
                        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cooking_yields_menu_name_ingredient_id_key') THEN
                            ALTER TABLE cooking_yields DROP CONSTRAINT cooking_yields_menu_name_ingredient_id_key;
                        END IF;
                        -- 기존 NULL 기반 제약 삭제
                        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cooking_yields_menu_name_site_id_key') THEN
                            ALTER TABLE cooking_yields DROP CONSTRAINT cooking_yields_menu_name_site_id_key;
                        END IF;
                    END $$;
                """)
                conn.commit()
            except Exception:
                conn.rollback()
            try:
                # NULL site_id → 0으로 변환 (기존 데이터 마이그레이션)
                cursor.execute("UPDATE cooking_yields SET site_id = 0 WHERE site_id IS NULL")
                conn.commit()
            except Exception:
                conn.rollback()
            try:
                # 기존 expression index 삭제 (이전 마이그레이션에서 생성된 경우)
                cursor.execute("DROP INDEX IF EXISTS cooking_yields_menu_site_idx")
                conn.commit()
            except Exception:
                conn.rollback()
            try:
                # 새 UNIQUE 제약 추가 (menu_name, site_id) — site_id는 NOT NULL이므로 안전
                cursor.execute("""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cooking_yields_menu_name_site_id_key') THEN
                            ALTER TABLE cooking_yields ADD CONSTRAINT cooking_yields_menu_name_site_id_key UNIQUE (menu_name, site_id);
                        END IF;
                    END $$;
                """)
                conn.commit()
            except Exception:
                conn.rollback()

            # order_items 테이블에 category_counts 컬럼 추가 (없으면)
            try:
                cursor.execute("""
                    ALTER TABLE order_items
                    ADD COLUMN IF NOT EXISTS category_counts JSONB
                """)
                conn.commit()
            except Exception as e:
                conn.rollback()

            # [정규화 대응] 메뉴별 식수 계산: meal_plans + meal_counts 기반
            # 1) meal_plans에서 slot_name -> [menu_name] 매핑 생성
            # 2) meal_counts에서 slot_name -> meal_count 합산
            # 3) 각 메뉴에 대해 해당 메뉴가 있는 슬롯의 식수 합산
            menu_meal_counts = {}  # {(base_menu_name, meal_type): total_meal_count}
            menu_category_meal_counts = {}  # {(base_menu_name, meal_type): {category: meal_count}}

            # 슬롯명 정규화 함수 (띄어쓰기 제거, 접두사 처리)
            def normalize_slot_name(name):
                if not name:
                    return ""
                # 공백 제거
                normalized = name.replace(" ", "")
                # 월/화/수 등 요일 접두사 제거 (예: "월 남산초등학교" -> "남산초등학교")
                import re
                normalized = re.sub(r'^[월화수목금토일]\s*', '', normalized)
                return normalized

            slot_category_counts = {}  # {(normalized_slot_name, meal_type, category): meal_count}
            for row in category_rows:
                cat_name, mt, slot_name, count = row
                if slot_name and count:
                    norm_name = normalize_slot_name(slot_name)
                    cat_name = cat_name or '기타'
                    mt = mt or '기타'
                    # 슬롯별, 끼니별, 카테고리별 식수 저장
                    slot_cat_key = (norm_name, mt, cat_name)
                    slot_category_counts[slot_cat_key] = slot_category_counts.get(slot_cat_key, 0) + int(count)

            # meal_plans에서 슬롯별 메뉴 조회
            meal_plan_query = """
                SELECT slot_name, menus, category
                FROM meal_plans
                WHERE plan_date = %s
            """
            meal_plan_params = [cooking_date]

            if site_id:
                meal_plan_query += " AND site_id = %s"
                meal_plan_params.append(site_id)

            cursor.execute(meal_plan_query, meal_plan_params)
            plan_rows = cursor.fetchall()

            import json as json_module

            # ★★★ 레시피 ID → 정규 메뉴명 매핑 (order_items와 동일한 형식) ★★★
            # meal_plans에는 display_name(예: "영남-현미밥-요")이 저장되지만,
            # order_items에는 recipe_name+suffix(예: "현미밥-요")가 저장되므로 매칭 불일치 발생.
            # recipe ID를 기준으로 정규 메뉴명을 조회하여 매칭 정확도를 보장한다.
            all_recipe_ids_from_plans = set()
            for plan_row in plan_rows:
                _, menus_json_tmp, _ = plan_row
                if not menus_json_tmp:
                    continue
                if isinstance(menus_json_tmp, str):
                    try:
                        tmp_list = json_module.loads(menus_json_tmp)
                    except:
                        tmp_list = []
                else:
                    tmp_list = menus_json_tmp if isinstance(menus_json_tmp, list) else []
                for mi in tmp_list:
                    if isinstance(mi, dict) and mi.get('id'):
                        all_recipe_ids_from_plans.add(int(mi['id']))

            recipe_id_to_base_name = {}
            if all_recipe_ids_from_plans:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids_from_plans))
                # ★ base_name 우선 사용 (접미사 제외 - 같은 메뉴 통합을 위해)
                cursor.execute(f"""
                    SELECT id,
                           COALESCE(NULLIF(base_name, ''), recipe_name) AS base_menu_name
                    FROM menu_recipes
                    WHERE id IN ({rid_placeholders})
                """, list(all_recipe_ids_from_plans))
                for row in cursor.fetchall():
                    recipe_id_to_base_name[row[0]] = row[1]
                print(f"[조리지시서] 레시피 ID→base_name 매핑: {len(recipe_id_to_base_name)}개")

            # 슬롯별로 처리하되, 각 슬롯이 가진 모든 meal_type에 대해 반복
            for plan_row in plan_rows:
                slot_name, menus_json, plan_category = plan_row
                if not slot_name or not menus_json:
                    continue

                # 정규화된 슬롯명으로 매칭
                norm_slot_name = normalize_slot_name(slot_name)

                # 이 슬롯이 가진 모든 meal_type 찾기 (slot_category_counts에서)
                slot_meal_types = set()
                for (slot_norm, mt, cat), cat_count in slot_category_counts.items():
                    if slot_norm == norm_slot_name:
                        slot_meal_types.add(mt)

                # 각 meal_type에 대해 개별 처리 (한 슬롯이 조식+중식+석식 모두 가질 수 있음)
                for slot_meal_type in slot_meal_types:
                    # 이 슬롯의 이 meal_type에 해당하는 식수 가져오기
                    slot_count = 0
                    for (slot_norm, mt, cat), cat_count in slot_category_counts.items():
                        if slot_norm == norm_slot_name and mt == slot_meal_type:
                            slot_count += cat_count

                    if slot_count <= 0:
                        continue

                    # menus 파싱
                    if isinstance(menus_json, str):
                        try:
                            menus_list = json_module.loads(menus_json)
                        except:
                            menus_list = []
                    else:
                        menus_list = menus_json if isinstance(menus_json, list) else []

                    for menu_item in menus_list:
                        if isinstance(menu_item, dict):
                            # ★ 1순위: canonical_name (저장 시 정규화된 값)
                            menu_name = menu_item.get('canonical_name', '')
                            # ★ 2순위: recipe ID → DB 조회 (이전 데이터 호환)
                            if not menu_name:
                                recipe_id_val = menu_item.get('id')
                                if recipe_id_val and int(recipe_id_val) in recipe_id_to_base_name:
                                    menu_name = recipe_id_to_base_name[int(recipe_id_val)]
                            # ★ 3순위: display_name fallback
                            if not menu_name:
                                menu_name = menu_item.get('name', '')
                        elif isinstance(menu_item, str):
                            menu_name = menu_item
                        else:
                            continue

                        if not menu_name:
                            continue

                        # ★ 접두사 + 접미사 모두 제거하여 같은 메뉴 통합 (본사-현미밥-요 → 현미밥)
                        menu_name = get_base_name(menu_name)
                        menu_key = (menu_name, slot_meal_type)

                        if menu_key not in menu_meal_counts:
                            menu_meal_counts[menu_key] = 0
                        menu_meal_counts[menu_key] += slot_count

                        # 카테고리별 식수도 추적 (이 슬롯에 해당하는 모든 카테고리 반영)
                        if menu_key not in menu_category_meal_counts:
                            menu_category_meal_counts[menu_key] = {}

                        # 이 슬롯의 모든 카테고리별 식수를 반영 (끼니 타입도 일치해야 함!)
                        for (slot_norm, mt, cat), cat_count in slot_category_counts.items():
                            if slot_norm == norm_slot_name and mt == slot_meal_type:
                                if cat not in menu_category_meal_counts[menu_key]:
                                    menu_category_meal_counts[menu_key][cat] = 0
                                menu_category_meal_counts[menu_key][cat] += cat_count

            print(f"[조리지시서] 메뉴별 식수 계산 완료: {len(menu_meal_counts)}개 메뉴")
            print(f"[조리지시서] 카테고리별 식수 샘플: {list(menu_category_meal_counts.items())[:3]}")

            # 2. meal_plans의 모든 메뉴 식자재 조회 (menu_recipe_ingredients 기반)
            # ★ 기존: order_items에서 조회 → 발주 미생성 메뉴 누락
            # ★ 변경: menu_recipe_ingredients에서 직접 조회 → meal_plans의 모든 메뉴 포함

            menus = {}
            # 재료별 카테고리 수량 임시 저장 (menu_key -> ingredient_key -> category -> qty)
            ingredient_category_qty = {}

            # canonical_name별로 식자재 그룹화 (같은 canonical_name의 카테고리 변형 레시피 식자재 병합)
            canonical_ingredients = {}  # canonical_name → {ingredient_key → ingredient_data}

            if all_recipe_ids_from_plans:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids_from_plans))
                query = f"""
                    SELECT
                        mr.id AS recipe_id,
                        COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) AS canonical_name,
                        mri.ingredient_code,
                        mri.ingredient_name,
                        mri.specification,
                        mri.unit,
                        mri.required_grams,
                        mri.quantity,
                        i.id AS ingredient_id,
                        COALESCE(i.base_weight_grams, 1000) AS base_weight_grams,
                        COALESCE(py.yield_rate, 100.00) AS preprocessing_yield,
                        py.preprocessing_instructions,
                        COALESCE(mr.cooking_yield_rate, 100.00) AS cooking_yield
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                    LEFT JOIN preprocessing_yields py ON i.id = py.ingredient_id
                    WHERE mr.id IN ({rid_placeholders})
                      AND mri.ingredient_name NOT LIKE '양념류%%'
                """
                cursor.execute(query, list(all_recipe_ids_from_plans))
                rows = cursor.fetchall()
                col_names = [desc[0] for desc in cursor.description]

                # 디버그: 조리수율 값 확인
                if rows:
                    sample_row = dict(zip(col_names, rows[0]))
                    print(f"[조리수율 로드] 첫 번째 행: canonical_name={sample_row.get('canonical_name')}, cooking_yield={sample_row.get('cooking_yield')}")

                for row in rows:
                    item = dict(zip(col_names, row))
                    # datetime/Decimal 변환
                    for key, value in item.items():
                        if isinstance(value, (datetime, date)):
                            item[key] = str(value)
                        elif isinstance(value, Decimal):
                            item[key] = float(value)

                    canonical_name = get_base_name(item['canonical_name'] or '기타') or '기타'

                    preprocessing_yield = float(item.get('preprocessing_yield') or 100)
                    cooking_yield = float(item.get('cooking_yield') or 100)
                    per_person_qty_g = float(item.get('required_grams') or 0)

                    ingredient_key = (item['ingredient_id'], item['ingredient_name'])

                    if canonical_name not in canonical_ingredients:
                        canonical_ingredients[canonical_name] = {}

                    if ingredient_key not in canonical_ingredients[canonical_name]:
                        canonical_ingredients[canonical_name][ingredient_key] = {
                            'item_id': item['recipe_id'],
                            'ingredient_id': item['ingredient_id'],
                            'ingredient_code': item['ingredient_code'],
                            'ingredient_name': item['ingredient_name'],
                            'specification': item['specification'],
                            'unit': item['unit'],
                            'preprocessing_yield': preprocessing_yield,
                            'cooking_yield': cooking_yield,
                            'per_person_qty': float(item.get('quantity') or 0),
                            'per_person_qty_g': per_person_qty_g,
                            'base_weight_grams': item.get('base_weight_grams', 1000),
                        }

                print(f"[조리지시서] canonical_name별 식자재 그룹: {len(canonical_ingredients)}개")

            # ★ cooking_yields 테이블에서 사업장별 조리수율 조회 (1순위)
            # 키: menu_name → cooking_yield_rate (사업장별 우선, fallback으로 전역(site_id=0))
            site_cooking_yields = {}
            all_menu_names_for_yield = list(canonical_ingredients.keys())
            if all_menu_names_for_yield:
                yield_placeholders = ','.join(['%s'] * len(all_menu_names_for_yield))
                if site_id:
                    # site_id 매칭 우선, site_id=0 (전역)은 fallback
                    # ORDER BY site_id ASC → 전역(0)이 먼저 → 사업장별 값이 나중에 덮어씀
                    cursor.execute(f"""
                        SELECT menu_name, cooking_yield_rate, site_id
                        FROM cooking_yields
                        WHERE menu_name IN ({yield_placeholders})
                          AND site_id IN (%s, 0)
                        ORDER BY site_id ASC
                    """, list(all_menu_names_for_yield) + [site_id])
                else:
                    cursor.execute(f"""
                        SELECT menu_name, cooking_yield_rate, site_id
                        FROM cooking_yields
                        WHERE menu_name IN ({yield_placeholders})
                          AND site_id = 0
                    """, list(all_menu_names_for_yield))
                for row in cursor.fetchall():
                    cy_menu, cy_rate, cy_site = row
                    cy_menu_stripped = cy_menu.strip() if cy_menu else cy_menu
                    # 전역(0)이 먼저 들어오고, 사업장별 값이 나중에 덮어씀 → 사업장별 우선
                    site_cooking_yields[cy_menu_stripped] = float(cy_rate)
                print(f"[조리지시서] cooking_yields 사업장별 조리수율: {len(site_cooking_yields)}건 (site_id={site_id})")

                # canonical_ingredients의 조리수율 오버라이드
                for menu_name_key, ingredients_dict in canonical_ingredients.items():
                    if menu_name_key in site_cooking_yields:
                        override_rate = site_cooking_yields[menu_name_key]
                        for ing_key in ingredients_dict:
                            ingredients_dict[ing_key]['cooking_yield'] = override_rate

            # ★ order_ingredient_overrides 적용 (Step 4 식자재 대체/수량조정/제외 반영)
            try:
                override_query = """
                    SELECT original_ingredient_id, original_ingredient_name,
                           replacement_ingredient_id, replacement_ingredient_code,
                           replacement_ingredient_name, replacement_specification,
                           replacement_unit, replacement_unit_price,
                           override_type, added_quantity
                    FROM order_ingredient_overrides
                    WHERE usage_date = %s AND override_type IN ('replace', 'qty_adjust', 'exclude')
                """
                override_params = [cooking_date]
                if site_id:
                    override_query += " AND (site_id = %s OR site_id IS NULL)"
                    override_params.append(site_id)

                cursor.execute(override_query, override_params)
                overrides = cursor.fetchall()
                override_cols = [desc[0] for desc in cursor.description]

                # 1) replace 처리
                qty_adjustments = {}  # {ingredient_id: ratio}
                exclude_ids = set()   # 제외할 ingredient_id

                if overrides:
                    print(f"[조리지시서] order_ingredient_overrides: {len(overrides)}건 조회")
                    for row in overrides:
                        ov = dict(zip(override_cols, row))
                        if ov['override_type'] == 'replace':
                            orig_id = ov['original_ingredient_id']
                            for menu_name_key, ingredients_dict in canonical_ingredients.items():
                                keys_to_replace = []
                                for ing_key, ing_data in ingredients_dict.items():
                                    if ing_data.get('ingredient_id') == orig_id:
                                        keys_to_replace.append(ing_key)

                                for old_key in keys_to_replace:
                                    old_data = ingredients_dict.pop(old_key)
                                    new_key = (ov['replacement_ingredient_id'], ov['replacement_ingredient_name'])
                                    ingredients_dict[new_key] = {
                                        **old_data,
                                        'ingredient_id': ov['replacement_ingredient_id'],
                                        'ingredient_code': ov['replacement_ingredient_code'] or old_data['ingredient_code'],
                                        'ingredient_name': ov['replacement_ingredient_name'] or old_data['ingredient_name'],
                                        'specification': ov['replacement_specification'] or old_data['specification'],
                                        'unit': ov['replacement_unit'] or old_data['unit'],
                                    }
                                    print(f"  [Override replace] {old_data['ingredient_name']} → {ov['replacement_ingredient_name']} in {menu_name_key}")
                        elif ov['override_type'] == 'qty_adjust':
                            ratio = float(ov['added_quantity'] or 1.0)
                            qty_adjustments[ov['original_ingredient_id']] = ratio
                        elif ov['override_type'] == 'exclude':
                            exclude_ids.add(ov['original_ingredient_id'])

                # 2) exclude/qty_adjust 적용 (canonical_ingredients에 반영)
                if exclude_ids or qty_adjustments:
                    for menu_name_key, ingredients_dict in canonical_ingredients.items():
                        # 제외 처리
                        if exclude_ids:
                            keys_to_delete = [k for k, v in ingredients_dict.items() if v.get('ingredient_id') in exclude_ids]
                            for k in keys_to_delete:
                                print(f"  [Override exclude] {ingredients_dict[k].get('ingredient_name')} in {menu_name_key}")
                                del ingredients_dict[k]

                        # 수량 비율 조정
                        if qty_adjustments:
                            for ing_key, ing_data in ingredients_dict.items():
                                ing_id = ing_data.get('ingredient_id')
                                if ing_id in qty_adjustments:
                                    ratio = qty_adjustments[ing_id]
                                    old_qty = ing_data.get('per_person_qty_g') or 0
                                    ing_data['per_person_qty_g'] = old_qty * ratio
                                    print(f"  [Override qty_adjust] {ing_data.get('ingredient_name')} ratio={ratio:.3f} ({old_qty:.2f}g → {ing_data['per_person_qty_g']:.2f}g) in {menu_name_key}")
            except Exception as e:
                print(f"[조리지시서] order_ingredient_overrides 조회 오류 (무시): {e}")

            # menu_meal_counts의 모든 키에 대해 menus dict 생성
            for menu_key in menu_meal_counts:
                menu_name, meal_type_val = menu_key

                if menu_key not in menus:
                    menus[menu_key] = {
                        'menu_name': menu_name,
                        'meal_type': meal_type_val,
                        'meal_category': '기타',
                        'meal_count': 0,
                        'cooking_method': '',  # 조리방법은 프론트엔드에서 입력
                        'ingredients': {},  # dict (ingredient_key -> data)
                        'total_weight': 0,
                        'category_meal_counts': {}  # 카테고리별 식수
                    }
                    ingredient_category_qty[menu_key] = {}

                # canonical_name으로 식자재 복사
                if menu_name in canonical_ingredients:
                    for ing_key, ing_data in canonical_ingredients[menu_name].items():
                        if ing_key not in menus[menu_key]['ingredients']:
                            # 각 메뉴키별로 독립적인 식자재 데이터 생성 (Step 3에서 수량 개별 계산)
                            menus[menu_key]['ingredients'][ing_key] = {
                                'item_id': ing_data['item_id'],
                                'ingredient_id': ing_data['ingredient_id'],
                                'ingredient_code': ing_data['ingredient_code'],
                                'ingredient_name': ing_data['ingredient_name'],
                                'specification': ing_data['specification'],
                                'unit': ing_data['unit'],
                                'required_qty': 0,
                                'required_qty_g': 0,
                                'preprocessing_yield': ing_data['preprocessing_yield'],
                                'preprocessed_qty': 0,
                                'preprocessed_qty_g': 0,
                                'cooking_yield': ing_data['cooking_yield'],
                                'cooked_qty': 0,
                                'cooked_qty_g': 0,
                                'per_person_qty': ing_data['per_person_qty'],
                                'per_person_qty_g': ing_data['per_person_qty_g'],
                                'base_weight_grams': ing_data['base_weight_grams'],
                                'category_qty': {},
                                'category_per_person_qty_g': {}
                            }
                            ingredient_category_qty[menu_key][ing_key] = {}

            print(f"[조리지시서] Step 2 완료: {len(menus)}개 메뉴, 식자재 총 {sum(len(m['ingredients']) for m in menus.values())}개")

            # ============================================
            # ★★★ 카테고리별 레시피 인당량 조회 ★★★
            # ============================================
            # 식단표 카테고리 → 레시피 카테고리 매핑 (recipe_categories 테이블 기준)
            CATEGORY_NAME_MAP_COOK = {
                '요양원': '요양원',  # DB에 '요양원'으로 저장됨
                '운반': '운반',      # DB에 '운반'으로 저장됨
                '학교': '학교',
                '도시락': '도시락',
            }

            # 메뉴별 카테고리별 인당량 캐시: {(menu_name, ingredient_name, category): required_grams}
            category_per_person_cache = {}

            # 모든 메뉴명 수집 (공백 trim 처리)
            all_menu_names = list(set(menu_data['menu_name'].strip() for menu_data in menus.values()))
            if all_menu_names:
                # 카테고리별 레시피와 그 식자재의 required_grams 조회
                # recipe_categories 테이블과 조인해서 카테고리명 가져옴
                # ★ TRIM으로 레시피명 공백 처리
                menu_placeholders = ','.join(['%s'] * len(all_menu_names))
                # ★ site_id 필터 추가: 해당 사업장 소유 또는 전역(owner_site_id IS NULL) 레시피만 조회
                site_filter = ""
                query_params = list(all_menu_names)
                if site_id:
                    site_filter = " AND (mr.owner_site_id = %s OR mr.owner_site_id IS NULL)"
                    query_params.append(site_id)
                cursor.execute(f"""
                    SELECT COALESCE(NULLIF(TRIM(mr.base_name), ''), TRIM(mr.recipe_name)) as recipe_name,
                           rc.name as category_name,
                           mri.ingredient_name, mri.required_grams
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    LEFT JOIN recipe_categories rc ON mr.category_id = rc.id
                    WHERE COALESCE(NULLIF(TRIM(mr.base_name), ''), TRIM(mr.recipe_name)) IN ({menu_placeholders})
                      AND rc.name IN ('도시락', '운반', '학교', '요양원')
                      {site_filter}
                    ORDER BY mr.owner_site_id IS NOT NULL ASC
                """, query_params)
                for row in cursor.fetchall():
                    recipe_name, recipe_cat, ing_name, req_grams = row
                    if req_grams and recipe_cat:
                        # 공백 제거하여 저장
                        cache_key = (recipe_name.strip(), ing_name.strip() if ing_name else '', recipe_cat)
                        category_per_person_cache[cache_key] = float(req_grams)
                print(f"[조리지시서] 카테고리별 인당량 캐시: {len(category_per_person_cache)}건", flush=True)
                # 디버그: 혼합잡곡밥 관련 캐시 출력
                for sk, val in category_per_person_cache.items():
                    if '잡곡' in sk[0]:
                        print(f"  - {sk}: {val}g", flush=True)

            # ============================================
            # 수량 계산: 현재 식수(meal_counts) × 인당량(per_person_qty_g)
            # ============================================
            # 행 루프에서 수집한 재료 메타데이터를 기반으로,
            # 현재 meal_counts 테이블의 카테고리별 식수로 수량을 한 번만 계산
            for menu_key, menu_data in menus.items():
                current_cats = menu_category_meal_counts.get(menu_key, {})
                current_total = menu_meal_counts.get(menu_key, 0)
                menu_data['meal_count'] = current_total
                menu_data['category_meal_counts'] = current_cats
                menu_data['total_weight'] = 0

                menu_name = menu_data['menu_name']

                for ing_key, ing_data in menu_data['ingredients'].items():
                    default_per_person_qty_g = float(ing_data.get('per_person_qty_g') or 0)
                    preprocessing_yield = float(ing_data.get('preprocessing_yield') or 100)
                    cooking_yield = float(ing_data.get('cooking_yield') or 100)
                    ingredient_name = ing_data.get('ingredient_name', '')

                    # 수량 초기화
                    ing_data['required_qty'] = 0
                    ing_data['required_qty_g'] = 0
                    ing_data['preprocessed_qty'] = 0
                    ing_data['preprocessed_qty_g'] = 0
                    ing_data['cooked_qty'] = 0
                    ing_data['cooked_qty_g'] = 0
                    ingredient_category_qty[menu_key][ing_key] = {}
                    ing_data['category_per_person_qty_g'] = {}

                    if current_cats:
                        # 카테고리별 계산
                        for cat, cat_count in current_cats.items():
                            head_count = int(cat_count) if not isinstance(cat_count, dict) else int(cat_count.get('head_count', 0) or 0)

                            # ★★★ 카테고리별 인당량 조회 (캐시에서) ★★★
                            mapped_cat = CATEGORY_NAME_MAP_COOK.get(cat, cat)
                            # 캐시 키: 공백 제거하여 매칭
                            cache_key = (menu_name.strip(), ingredient_name.strip(), mapped_cat)
                            per_person_qty_g = category_per_person_cache.get(cache_key, default_per_person_qty_g)

                            req_g = per_person_qty_g * head_count
                            req_kg = req_g / 1000
                            pre_kg = req_kg * (preprocessing_yield / 100)
                            cooked_kg = pre_kg * (cooking_yield / 100)

                            ingredient_category_qty[menu_key][ing_key][cat] = pre_kg
                            ing_data['category_per_person_qty_g'][cat] = per_person_qty_g

                            ing_data['required_qty'] += req_kg
                            ing_data['required_qty_g'] += req_g
                            ing_data['preprocessed_qty'] += pre_kg
                            ing_data['preprocessed_qty_g'] += pre_kg * 1000
                            ing_data['cooked_qty'] += cooked_kg
                            ing_data['cooked_qty_g'] += cooked_kg * 1000
                            menu_data['total_weight'] += pre_kg
                    else:
                        # 카테고리 정보 없음: 전체 식수로 단일 계산
                        meal_count = current_total or 0
                        meal_cat = menu_data.get('meal_category', '기타')

                        # ★ 기본 인당량 사용 (카테고리별 캐시가 없으므로)
                        per_person_qty_g = default_per_person_qty_g
                        req_g = per_person_qty_g * meal_count
                        req_kg = req_g / 1000
                        pre_kg = req_kg * (preprocessing_yield / 100)
                        cooked_kg = pre_kg * (cooking_yield / 100)

                        ingredient_category_qty[menu_key][ing_key][meal_cat] = pre_kg
                        ing_data['category_per_person_qty_g'][meal_cat] = per_person_qty_g

                        ing_data['required_qty'] = req_kg
                        ing_data['required_qty_g'] = req_g
                        ing_data['preprocessed_qty'] = pre_kg
                        ing_data['preprocessed_qty_g'] = pre_kg * 1000
                        ing_data['cooked_qty'] = cooked_kg
                        ing_data['cooked_qty_g'] = cooked_kg * 1000
                        menu_data['total_weight'] += pre_kg


            # 메뉴 리스트로 변환 및 재료 데이터 정리
            menu_list = []
            for menu_key, menu_data in menus.items():
                # ingredients를 dict에서 list로 변환
                ingredients_list = []
                for ing_key, ing_data in menu_data['ingredients'].items():
                    # 카테고리별 수량 추가
                    ing_data['category_qty'] = ingredient_category_qty[menu_key].get(ing_key, {})
                    # 수량 반올림 (kg 단위)
                    ing_data['preprocessed_qty'] = round(ing_data['preprocessed_qty'], 1)
                    ing_data['cooked_qty'] = round(ing_data['cooked_qty'], 1)
                    ing_data['required_qty'] = round(ing_data.get('required_qty', 0), 1)
                    # ★ g 단위 반올림 (소수점 1자리)
                    ing_data['preprocessed_qty_g'] = round(ing_data.get('preprocessed_qty_g', 0), 1)
                    ing_data['cooked_qty_g'] = round(ing_data.get('cooked_qty_g', 0), 1)
                    ing_data['required_qty_g'] = round(ing_data.get('required_qty_g', 0), 1)
                    # 카테고리별 수량도 반올림
                    for cat in ing_data['category_qty']:
                        ing_data['category_qty'][cat] = round(ing_data['category_qty'][cat], 1)
                    ingredients_list.append(ing_data)

                menu_data['ingredients'] = ingredients_list

                # ★★★ 식수가 0인 메뉴 필터링 (식단 변경 후 발주 미갱신으로 인한 유령 메뉴 제외) ★★★
                if menu_data.get('meal_count', 0) > 0:
                    menu_list.append(menu_data)
                else:
                    print(f"[조리지시서] ⚠️ 식수 0인 메뉴 제외: {menu_data.get('menu_name')} ({menu_data.get('meal_type')})")

            # 전체 요약
            total_ingredients = sum(len(m['ingredients']) for m in menu_list)
            total_menus = len(menu_list)

            # 임시(draft) 상태 발주 확인
            draft_query = """
                SELECT COUNT(*) FROM orders
                WHERE usage_date = %s AND status = 'draft'
            """
            draft_params = [cooking_date]
            if site_id:
                draft_query += " AND site_id = %s"
                draft_params.append(site_id)
            cursor.execute(draft_query, draft_params)
            draft_count = cursor.fetchone()[0]

            # ============================================
            # 식자재 불일치 알림 감지 (각 메뉴를 독립적으로 처리)
            # ============================================
            ingredient_mismatch_warnings = []

            try:
                # 해당 날짜에 사용되는 레시피 목록 조회 (meal_plans에서)
                cursor.execute("""
                    SELECT DISTINCT
                        mr.id as recipe_id,
                        mr.recipe_name
                    FROM meal_plans mp
                    CROSS JOIN LATERAL jsonb_array_elements(mp.menus) as menu_item
                    JOIN menu_recipes mr ON mr.id = (menu_item->>'id')::int
                    WHERE mp.plan_date = %s
                """, (cooking_date,))
                recipes_used = cursor.fetchall()

                # 각 레시피를 독립적으로 처리 (접미사 기반 그룹화 제거)
                base_name_groups = {}  # {recipe_name: [(recipe_id, recipe_name), ...]}
                for recipe_id, recipe_name in recipes_used:
                    if recipe_name not in base_name_groups:
                        base_name_groups[recipe_name] = []
                    base_name_groups[recipe_name].append((recipe_id, recipe_name))

                # 2개 이상의 레시피가 있는 그룹만 검사
                for base_name, recipes in base_name_groups.items():
                    if len(recipes) < 2:
                        continue

                    # 각 레시피의 식자재 조회
                    recipe_ingredients = {}  # {recipe_id: {ingredient_code: ingredient_name}}
                    for recipe_id, recipe_name in recipes:
                        cursor.execute("""
                            SELECT ingredient_code, ingredient_name
                            FROM menu_recipe_ingredients
                            WHERE recipe_id = %s
                            ORDER BY sort_order
                        """, (recipe_id,))
                        ingredients = cursor.fetchall()
                        recipe_ingredients[recipe_id] = {
                            'name': recipe_name,
                            'ingredients': {row[0]: row[1] for row in ingredients}
                        }

                    # 식자재 코드 비교 (같은 순서의 재료가 다른 코드인지 확인)
                    # 모든 레시피의 ingredient_code 집합 비교
                    all_codes = set()
                    recipe_codes_list = []
                    for recipe_id, data in recipe_ingredients.items():
                        codes = set(data['ingredients'].keys())
                        all_codes.update(codes)
                        recipe_codes_list.append((recipe_id, data['name'], codes, data['ingredients']))

                    # 각 레시피에 없는 코드가 있으면 불일치
                    mismatched_ingredients = []
                    for code in all_codes:
                        recipes_with_code = []
                        recipes_without_code = []
                        ingredient_name = None

                        for recipe_id, recipe_name, codes, ingredients in recipe_codes_list:
                            if code in codes:
                                recipes_with_code.append(recipe_name)
                                ingredient_name = ingredients[code]
                            else:
                                recipes_without_code.append(recipe_name)

                        # 일부 레시피에만 있는 식자재
                        if recipes_with_code and recipes_without_code:
                            mismatched_ingredients.append({
                                'ingredient_code': code,
                                'ingredient_name': ingredient_name,
                                'used_in': recipes_with_code,
                                'not_in': recipes_without_code
                            })

                    if mismatched_ingredients:
                        ingredient_mismatch_warnings.append({
                            'base_name': base_name,
                            'recipes': [r[1] for r in recipes],
                            'mismatched_ingredients': mismatched_ingredients,
                            'message': f'"{base_name}" 계열 레시피 중 식자재가 다른 레시피가 있습니다. 레시피 통일이 필요하면 식자재 일괄변경을 이용하세요.'
                        })
            except Exception as warn_error:
                # 알림 로직 오류는 무시 (메인 기능에 영향 없도록)
                print(f"[경고] 식자재 불일치 감지 오류: {warn_error}")

            # ============================================
            # 발주 후 식수 변경 경고 감지
            # ============================================
            meal_count_warning = None
            try:
                # 해당 날짜의 최신 확정/잠금 발주서 조회
                order_query = """
                    SELECT id, order_number, meal_counts_snapshot,
                           snapshot_created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
                           created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul',
                           status
                    FROM orders
                    WHERE usage_date = %s AND status IN ('confirmed', 'locked', 'draft')
                """
                order_params = [cooking_date]
                if site_id:
                    order_query += " AND site_id = %s"
                    order_params.append(site_id)
                order_query += " ORDER BY created_at DESC LIMIT 1"

                cursor.execute(order_query, order_params)
                order_row = cursor.fetchone()

                if order_row and order_row[2]:  # meal_counts_snapshot이 있는 경우
                    order_id, order_number, snapshot_json, snapshot_created_at, order_created_at, order_status = order_row

                    # 스냅샷과 현재 식수 비교
                    snapshot_data = snapshot_json if isinstance(snapshot_json, list) else []
                    snapshot_dict = {}
                    for item in snapshot_data:
                        key = (item.get('menu_name', ''), item.get('site_name', ''))
                        snapshot_dict[key] = item.get('meal_count', 0)

                    # 현재 식수 조회
                    current_query = """
                        SELECT menu_name, site_name, meal_count
                        FROM meal_counts
                        WHERE work_date = %s
                    """
                    current_params = [cooking_date]
                    if site_id:
                        current_query += " AND site_id = %s"
                        current_params.append(site_id)
                    cursor.execute(current_query, current_params)
                    current_rows = cursor.fetchall()

                    current_dict = {}
                    for row in current_rows:
                        key = (row[0], row[1])
                        current_dict[key] = row[2] or 0

                    # 변경 내역 비교
                    changes = []
                    all_keys = set(snapshot_dict.keys()) | set(current_dict.keys())
                    for key in all_keys:
                        old_count = snapshot_dict.get(key, 0) or 0
                        new_count = current_dict.get(key, 0) or 0
                        if old_count != new_count:
                            changes.append({
                                'menu_name': key[0],
                                'site_name': key[1],
                                'old_count': old_count,
                                'new_count': new_count,
                                'diff': new_count - old_count
                            })

                    if changes:
                        # 마지막 변경자 조회 (user_id 포함, KST 변환)
                        cursor.execute("""
                            SELECT user_id, user_name, changed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'
                            FROM meal_counts_audit_log
                            WHERE work_date = %s AND (site_id = %s OR %s IS NULL)
                            ORDER BY changed_at DESC LIMIT 1
                        """, (cooking_date, site_id, site_id))
                        last_change = cursor.fetchone()

                        # 전체 식수 증감 계산
                        total_old = sum(c.get('old_count', 0) or 0 for c in changes)
                        total_new = sum(c.get('new_count', 0) or 0 for c in changes)
                        total_diff = total_new - total_old
                        diff_sign = '+' if total_diff > 0 else ''
                        shortage_warning = total_diff > 0  # 식수 증가 = 발주량 부족 가능

                        meal_count_warning = {
                            "type": "meal_count_changed_after_order",
                            "message": "⚠️ 발주 후 식수가 변경되었습니다!" + (" 🔴 발주량 부족 주의!" if shortage_warning else ""),
                            "detail": f"발주번호 {order_number} 생성 이후 식수가 수정되었습니다. (변동: {diff_sign}{total_diff}명)",
                            "action_required": "조리량은 현재 식수 기준으로 자동 재계산됩니다. 발주량이 부족할 수 있으니 확인해주세요." if shortage_warning else "조리량은 현재 식수 기준으로 자동 재계산됩니다.",
                            "total_old": total_old,
                            "total_new": total_new,
                            "total_diff": total_diff,
                            "shortage_warning": shortage_warning,
                            "order_id": order_id,
                            "order_number": order_number,
                            "order_status": order_status,
                            "order_created_at": str(order_created_at) if order_created_at else None,
                            "snapshot_created_at": str(snapshot_created_at) if snapshot_created_at else None,
                            "last_changed_by_id": last_change[0] if last_change else None,
                            "last_changed_by": last_change[1] if last_change else '알수없음',
                            "last_changed_at": str(last_change[2]) if last_change else None,
                            "changes": changes,
                            "change_count": len(changes)
                        }
                        print(f"[경고] 발주 후 식수 변경 감지: {order_number}, 변경 {len(changes)}건")

            except Exception as warn_error:
                print(f"[경고] 식수 변경 감지 오류: {warn_error}")

            # ============================================
            # 발주 후 레시피 변경 이력 조회
            # ============================================
            recipe_change_warnings = []
            try:
                # 해당 날짜의 발주서 생성일 조회
                order_date_query = """
                    SELECT MIN(created_at) as order_created_at
                    FROM orders
                    WHERE usage_date = %s AND status IN ('draft', 'confirmed', 'ordered')
                """
                order_date_params = [cooking_date]
                if site_id:
                    order_date_query = order_date_query.replace("WHERE", "WHERE site_id = %s AND")
                    order_date_params = [site_id] + order_date_params
                cursor.execute(order_date_query, order_date_params)
                order_date_row = cursor.fetchone()
                order_created_date = order_date_row[0] if order_date_row and order_date_row[0] else None

                if order_created_date:
                    # 해당 날짜에 사용되는 레시피 ID 목록
                    cursor.execute("""
                        SELECT DISTINCT (menu_item->>'id')::int as recipe_id
                        FROM meal_plans mp
                        CROSS JOIN LATERAL jsonb_array_elements(mp.menus) as menu_item
                        WHERE mp.plan_date = %s AND (menu_item->>'id') IS NOT NULL
                    """, (cooking_date,))
                    recipe_ids = [row[0] for row in cursor.fetchall()]

                    if recipe_ids:
                        # 발주일 이후 변경 이력 조회
                        placeholders = ','.join(['%s'] * len(recipe_ids))
                        cursor.execute(f"""
                            SELECT recipe_id, recipe_name, ingredient_code, ingredient_name, action,
                                   old_required_grams, new_required_grams, changed_by,
                                   changed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul' as changed_at_kst
                            FROM menu_recipe_ingredients_audit
                            WHERE recipe_id IN ({placeholders})
                              AND changed_at > %s
                            ORDER BY changed_at DESC
                        """, recipe_ids + [order_created_date])

                        changes = cursor.fetchall()
                        if changes:
                            for row in changes:
                                recipe_change_warnings.append({
                                    "recipe_id": row[0],
                                    "recipe_name": row[1],
                                    "ingredient_code": row[2],
                                    "ingredient_name": row[3],
                                    "action": row[4],  # ADD, DELETE, UPDATE
                                    "old_grams": float(row[5]) if row[5] else None,
                                    "new_grams": float(row[6]) if row[6] else None,
                                    "changed_by": row[7],
                                    "changed_at": str(row[8]) if row[8] else None
                                })
                            print(f"[경고] 발주 후 레시피 변경 {len(changes)}건 감지")
            except Exception as recipe_warn_error:
                print(f"[경고] 레시피 변경 이력 조회 오류: {recipe_warn_error}")


            return {
                "success": True,
                "cooking_date": cooking_date,
                "meal_type": meal_type,
                "meal_counts": meal_counts_dict,  # 끼니별 식수 (meal_counts 테이블 기준)
                "category_counts": category_counts,  # 대분류 카테고리별 (조리지시서용)
                "category_counts_by_meal_type": category_counts_by_meal_type,  # 끼니별 카테고리 식수
                "site_counts": {},  # 소분류 사업장별 (필요시 별도 조회)
                "menus": menu_list,
                "has_draft_orders": draft_count > 0,  # 임시 발주 존재 여부
                "draft_order_count": draft_count,  # 임시 발주 개수
                "ingredient_mismatch_warnings": ingredient_mismatch_warnings,  # 식자재 불일치 경고
                "meal_count_warning": meal_count_warning,  # 발주 후 식수 변경 경고
                "recipe_change_warnings": recipe_change_warnings if recipe_change_warnings else None,  # 발주 후 레시피 변경 경고
                "orphan_data": {
                    "count": orphan_count_cook,
                    "meal_sum": orphan_meal_sum_cook,
                    "items": orphan_data_cook[:10] if orphan_count_cook > 10 else orphan_data_cook
                } if orphan_count_cook > 0 else None,
                "summary": {
                    "total_menus": total_menus,
                    "total_ingredients": total_ingredients
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/cooking-instruction/save")
async def save_cooking_instruction(request: Request):
    """조리지시서 저장"""
    try:
        data = await request.json()
        cooking_date = data.get('cooking_date')
        meal_type = data.get('meal_type')
        site_id = data.get('site_id')
        menus = data.get('menus', [])
        notes = data.get('notes', '')
        created_by = data.get('created_by', 'system')

        if not cooking_date:
            return {"success": False, "error": "조리일자가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # cooking_instructions 테이블 존재 확인 및 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cooking_instructions (
                    id SERIAL PRIMARY KEY,
                    instruction_number VARCHAR(50) UNIQUE,
                    cooking_date DATE NOT NULL,
                    meal_type VARCHAR(20),
                    site_id INTEGER,
                    total_menus INTEGER DEFAULT 0,
                    total_ingredients INTEGER DEFAULT 0,
                    notes TEXT,
                    status VARCHAR(20) DEFAULT 'draft',
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cooking_instruction_items (
                    id SERIAL PRIMARY KEY,
                    instruction_id INTEGER NOT NULL,
                    menu_name VARCHAR(255),
                    cooking_order INTEGER,
                    cooking_method TEXT,
                    ingredient_id INTEGER,
                    ingredient_name VARCHAR(255),
                    unit VARCHAR(50),
                    order_qty DECIMAL(10,2),
                    yield_rate DECIMAL(5,2),
                    final_qty DECIMAL(10,2),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)

            conn.commit()

            # 지시서 번호 생성
            date_str = cooking_date.replace('-', '')
            meal_code = {'조식': 'B', '중식': 'L', '석식': 'D'}.get(meal_type, 'X')
            cursor.execute("""
                SELECT COUNT(*) FROM cooking_instructions
                WHERE cooking_date = %s AND (site_id = %s OR (%s IS NULL AND site_id IS NULL))
            """, (cooking_date, site_id, site_id))
            count = cursor.fetchone()[0]
            instruction_number = f"CI{date_str}{meal_code}-{count + 1:04d}"

            # 기존 지시서 확인
            cursor.execute("""
                SELECT id FROM cooking_instructions
                WHERE cooking_date = %s AND meal_type = %s
                AND (site_id = %s OR (%s IS NULL AND site_id IS NULL))
                AND status = 'draft'
            """, (cooking_date, meal_type, site_id, site_id))
            existing = cursor.fetchone()

            total_ingredients = sum(len(m.get('ingredients', [])) for m in menus)

            if existing:
                instruction_id = existing[0]
                cursor.execute("DELETE FROM cooking_instruction_items WHERE instruction_id = %s", (instruction_id,))
                cursor.execute("""
                    UPDATE cooking_instructions
                    SET total_menus = %s, total_ingredients = %s, notes = %s, updated_at = NOW()
                    WHERE id = %s
                """, (len(menus), total_ingredients, notes, instruction_id))
            else:
                cursor.execute("""
                    INSERT INTO cooking_instructions
                    (instruction_number, cooking_date, meal_type, site_id, total_menus, total_ingredients, notes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (instruction_number, cooking_date, meal_type, site_id, len(menus), total_ingredients, notes, created_by))
                instruction_id = cursor.fetchone()[0]

            # 품목 저장
            cooking_order = 1
            for menu in menus:
                menu_name = menu.get('menu_name')
                cooking_method = menu.get('cooking_method', '')
                for ingredient in menu.get('ingredients', []):
                    cursor.execute("""
                        INSERT INTO cooking_instruction_items
                        (instruction_id, menu_name, cooking_order, cooking_method,
                         ingredient_id, ingredient_name, unit, order_qty, yield_rate, final_qty)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        instruction_id,
                        menu_name,
                        cooking_order,
                        cooking_method,
                        ingredient.get('ingredient_id'),
                        ingredient.get('ingredient_name'),
                        ingredient.get('unit'),
                        ingredient.get('order_qty'),
                        ingredient.get('yield_rate', 100),
                        ingredient.get('final_qty')
                    ))
                cooking_order += 1

            conn.commit()

            return {
                "success": True,
                "message": "조리지시서가 저장되었습니다.",
                "instruction_id": instruction_id,
                "instruction_number": instruction_number
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/cooking-instruction/list")
async def get_cooking_instruction_list(
    start_date: str = Query(None),
    end_date: str = Query(None),
    cooking_date: str = Query(None)
):
    """저장된 조리지시서 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, instruction_number, cooking_date, meal_type,
                       status, total_menus, notes, created_by, created_at
                FROM cooking_instructions
                WHERE 1=1
            """
            params = []

            if cooking_date:
                query += " AND cooking_date = %s"
                params.append(cooking_date)
            elif start_date and end_date:
                query += " AND cooking_date BETWEEN %s AND %s"
                params.extend([start_date, end_date])

            query += " ORDER BY cooking_date DESC, created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            instructions = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                instructions.append(item)


            return {"success": True, "instructions": instructions}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/cooking-instruction/detail/{instruction_id}")
async def get_cooking_instruction_detail(instruction_id: int):
    """조리지시서 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 정보
            cursor.execute("""
                SELECT * FROM cooking_instructions WHERE id = %s
            """, (instruction_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            col_names = [desc[0] for desc in cursor.description]
            instruction = dict(zip(col_names, row))
            for key, value in instruction.items():
                if isinstance(value, (datetime, date)):
                    instruction[key] = str(value)
                elif isinstance(value, Decimal):
                    instruction[key] = float(value)

            # 품목 정보
            cursor.execute("""
                SELECT * FROM cooking_instruction_items
                WHERE instruction_id = %s
                ORDER BY cooking_order
            """, (instruction_id,))
            item_rows = cursor.fetchall()
            item_col_names = [desc[0] for desc in cursor.description]

            items = []
            for item_row in item_rows:
                item = dict(zip(item_col_names, item_row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            instruction['items'] = items

            return {"success": True, "instruction": instruction}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/cooking-instruction/{instruction_id}")
async def delete_cooking_instruction(instruction_id: int):
    """조리지시서 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 존재 확인
            cursor.execute("SELECT instruction_number FROM cooking_instructions WHERE id = %s", (instruction_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            instruction_number = row[0]

            # 품목 삭제
            cursor.execute("DELETE FROM cooking_instruction_items WHERE instruction_id = %s", (instruction_id,))

            # 지시서 삭제
            cursor.execute("DELETE FROM cooking_instructions WHERE id = %s", (instruction_id,))

            conn.commit()

            return {"success": True, "message": f"지시서 {instruction_number}가 삭제되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 소분지시서 API
# ============================================

@router.get("/api/portion-instruction")
async def get_portion_instruction(
    cooking_date: str = Query(..., description="조리일자 (식단표 일자)"),
    meal_type: str = Query(None, description="끼니 유형 (조식/중식/석식/야식)"),
    site_id: int = Query(None, description="사업장 ID"),
    order_id: int = Query(None, description="특정 발주서 ID (지정 시 해당 발주서만 조회)")
):
    """소분지시서 조회 - 조리지시서 기반 사업장별 메뉴 분배 (meal_plans + meal_counts + recipe 기반)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 끼니 유형 매핑
            meal_type_map = {
                'breakfast': '조식', '조식': '조식',
                'lunch': '중식', '중식': '중식',
                'dinner': '석식', '석식': '석식',
                'night': '야식', '야식': '야식'
            }
            mapped_meal_type = meal_type_map.get(meal_type, meal_type) if meal_type else None

            # ★ 조리지시서 저장 여부 확인 (게이트 체크)
            # 해당 날짜에 조리지시서가 하나라도 존재하는지 확인 (사업장 무관)
            # 실제 사업장별 데이터 범위는 meal_plans/meal_counts의 site_id 필터로 보장
            cooking_instruction_info = None
            try:
                gate_query = "SELECT id, instruction_number, meal_type, status FROM cooking_instructions WHERE cooking_date = %s"
                gate_params = [cooking_date]
                if mapped_meal_type:
                    gate_query += " AND (meal_type = %s OR meal_type = '전체')"
                    gate_params.append(mapped_meal_type)
                gate_query += " ORDER BY id DESC LIMIT 1"
                cursor.execute(gate_query, gate_params)
                cooking_instruction_info = cursor.fetchone()
            except Exception as gate_err:
                # cooking_instructions 테이블이 없는 경우 등 - 게이트 체크 스킵
                print(f"[소분지시서] 조리지시서 게이트 체크 오류 (무시): {gate_err}")
                try:
                    conn.rollback()
                except:
                    pass

            if not cooking_instruction_info:
                meal_type_label = mapped_meal_type or '전체'
                return {
                    "success": False,
                    "error_type": "no_cooking_instruction",
                    "error": f"{cooking_date} {meal_type_label} 조리지시서가 저장되지 않았습니다. 조리지시서를 먼저 저장해주세요.",
                    "cooking_date": cooking_date,
                    "meal_type": meal_type,
                    "business_sites": [],
                    "menus": []
                }

            # 메뉴명 정규화 함수 (meal_plans와 recipe 재료 간 매칭을 위해)
            # ★ get_base_name 사용 (utils/menu_name.py - 접두사+접미사 모두 제거, 조리지시서와 동일)
            def get_base_recipe_name(menu_name):
                if not menu_name:
                    return '기타'
                return get_base_name(menu_name) or '기타'

            # 1. 사업장별 식수 정보 조회 (슬롯 정보 포함!)
            # category 컬럼 우선, fallback으로 business_type 사용
            sites_query = """
                SELECT site_name, meal_type, COALESCE(category, business_type) as category, menu_name as slot_name, SUM(meal_count) as meal_count
                FROM meal_counts
                WHERE work_date = %s
            """
            sites_params = [cooking_date]

            if site_id:
                sites_query += " AND site_id = %s"
                sites_params.append(site_id)
            if mapped_meal_type:
                sites_query += " AND meal_type = %s"
                sites_params.append(mapped_meal_type)

            sites_query += " GROUP BY site_name, meal_type, COALESCE(category, business_type), menu_name ORDER BY COALESCE(category, business_type), site_name"
            cursor.execute(sites_query, sites_params)
            site_rows = cursor.fetchall()

            # ★ 요양원은 중식 소분에서 분리 (별도 계산 후 합산)
            yoyangwon_rows = []
            if mapped_meal_type == '중식':
                yoyangwon_rows = [r for r in site_rows if r[2] == '요양원']
                site_rows = [r for r in site_rows if r[2] != '요양원']

            # 2. 사업장별 가중치 조회
            cursor.execute("SELECT site_name, meal_type, weight_percent FROM site_portion_weights")
            weight_rows = cursor.fetchall()
            site_weights = {}  # {(site_name, meal_type): weight_percent}
            for w_site, w_meal, w_percent in weight_rows:
                site_weights[(w_site, w_meal or '')] = float(w_percent) if w_percent else 100.0

            # 2-0. 사업장 표시 순서 조회 (끼니 무관 - 빈 문자열 또는 'all' 모두 지원)
            site_display_order = {}  # {site_name: display_order}
            try:
                cursor.execute("""
                    SELECT site_name, display_order FROM site_portion_display_order
                    WHERE meal_type IN ('', 'all')
                    ORDER BY display_order
                """)
                for o_site, o_order in cursor.fetchall():
                    site_display_order[o_site] = o_order
            except Exception:
                conn.rollback()

            # 2-1. 사업장별 용기 설정 조회 {site_name: container_type}
            site_container_map = {}
            try:
                cursor.execute("SELECT site_name, container_type FROM site_container_settings")
                for c_site, c_type in cursor.fetchall():
                    site_container_map[c_site] = c_type
            except Exception:
                conn.rollback()

            # 2-2. 사업장별 밥통 설정 조회 {site_name: rice_cooker_size}
            site_rice_cooker_map = {}
            try:
                cursor.execute("SELECT site_name, rice_cooker_size FROM site_rice_cooker_settings")
                for r_site, r_size in cursor.fetchall():
                    site_rice_cooker_map[r_site] = r_size
            except Exception:
                conn.rollback()

            # 사업장 목록 구성 (슬롯 정보 포함)
            business_sites = []
            total_meal_count = 0
            for idx, row in enumerate(site_rows):
                site_name, mt, category, slot_name, meal_count = row
                meal_count = meal_count or 0
                total_meal_count += meal_count

                # 가중치 조회 (기본값 100%)
                weight = site_weights.get((site_name, mt), 100.0)

                business_sites.append({
                    'id': idx + 1,
                    'site_name': site_name or '기타',
                    'meal_type': mt,
                    'category': category or '운반',  # business_type → category로 통합
                    'slot_name': slot_name or '',  # 슬롯명 (예: 야 4찬, 야 5찬)
                    'meal_count': meal_count,
                    'weight_percent': weight,
                    'container_type': site_container_map.get(site_name, '1/2'),
                    'rice_cooker_size': site_rice_cooker_map.get(site_name, ''),
                    'portions': {}
                })

            # 2-3. 사용자 정의 순서 적용
            if site_display_order:
                # 카테고리 순서 매핑
                category_order = {'도시락': 0, '운반': 1, '학교': 2, '요양원': 3, '기타': 4}
                def sort_key(site):
                    name = site['site_name']
                    cat = site['category']
                    if name in site_display_order:
                        return (category_order.get(cat, 4), site_display_order[name])
                    return (category_order.get(cat, 4), 9999)
                business_sites.sort(key=sort_key)
                # id 재부여
                for idx, site in enumerate(business_sites):
                    site['id'] = idx + 1

            # 3. meal_plans에서 슬롯→메뉴 매핑 조회 (핵심!)
            # 각 슬롯에 어떤 메뉴가 배정되어 있는지 확인
            slot_menus_query = """
                SELECT slot_name, menus
                FROM meal_plans
                WHERE plan_date = %s
            """
            slot_params = [cooking_date]
            if site_id:
                slot_menus_query += " AND site_id = %s"
                slot_params.append(site_id)

            cursor.execute(slot_menus_query, slot_params)
            slot_menu_rows = cursor.fetchall()

            # ★ 레시피 ID → canonical_name 매핑 (meal_plans 메뉴명 정규화용)
            all_recipe_ids_from_plans = set()
            for slot_row in slot_menu_rows:
                _, menus_json_tmp = slot_row
                if not menus_json_tmp:
                    continue
                if isinstance(menus_json_tmp, str):
                    import json
                    try:
                        tmp_list = json.loads(menus_json_tmp)
                    except:
                        tmp_list = []
                else:
                    tmp_list = menus_json_tmp if isinstance(menus_json_tmp, list) else []
                for mi in tmp_list:
                    if isinstance(mi, dict) and mi.get('id'):
                        try:
                            all_recipe_ids_from_plans.add(int(mi['id']))
                        except (ValueError, TypeError):
                            pass

            recipe_id_to_canonical = {}
            if all_recipe_ids_from_plans:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids_from_plans))
                # ★ base_name만 사용 (접두사+접미사 모두 제거, 조리지시서와 동일)
                cursor.execute(f"""
                    SELECT id,
                           COALESCE(NULLIF(base_name, ''), recipe_name) AS canonical_name
                    FROM menu_recipes
                    WHERE id IN ({rid_placeholders})
                """, list(all_recipe_ids_from_plans))
                for row in cursor.fetchall():
                    recipe_id_to_canonical[row[0]] = row[1]
                print(f"[소분지시서] 레시피 ID→정규명 매핑: {len(recipe_id_to_canonical)}개")

            # {slot_name: [(base_name, recipe_id), ...]}  ★ recipe_id 포함하여 카테고리별 레시피 구분
            slot_menus = {}
            for slot_row in slot_menu_rows:
                slot_name_from_plan, menus_json = slot_row
                if slot_name_from_plan:
                    # menus JSONB 파싱
                    if isinstance(menus_json, str):
                        import json
                        menus_list = json.loads(menus_json)
                    else:
                        menus_list = menus_json or []

                    # 메뉴 이름 + recipe_id 추출 (base_name으로 정규화)
                    menu_entries = []
                    for menu_item in menus_list:
                        recipe_id_val = None
                        if isinstance(menu_item, dict):
                            # recipe_id 추출
                            rid = menu_item.get('id')
                            if rid:
                                try:
                                    recipe_id_val = int(rid)
                                except (ValueError, TypeError):
                                    pass
                            # ★ 1순위: canonical_name (저장 시 정규화된 값)
                            menu_name = menu_item.get('canonical_name', '')
                            # ★ 2순위: recipe ID → DB 조회 (이전 데이터 호환)
                            if not menu_name:
                                if rid:
                                    try:
                                        menu_name = recipe_id_to_canonical.get(int(rid), '')
                                    except (ValueError, TypeError):
                                        menu_name = ''
                            # ★ 3순위: name에서 접두사 제거
                            if not menu_name:
                                menu_name = menu_item.get('name', '') or menu_item.get('menu_name', '')
                        else:
                            menu_name = str(menu_item)
                        if menu_name:
                            base_name = get_base_recipe_name(menu_name)
                            menu_entries.append((base_name, recipe_id_val))

                    slot_menus[slot_name_from_plan] = menu_entries

            print(f"[소분지시서] slot_menus: {len(slot_menus)}개 슬롯")

            # 5. 조리지시서 기반 메뉴별/카테고리별 조리후량 계산
            # ★ order_items(발주) 대신 meal_plans + meal_counts + menu_recipe_ingredients 사용
            # 조리지시서와 동일한 데이터 소스로, 발주 유무와 관계없이 정확한 수량 계산

            # 5a. 슬롯별 카테고리 식수 집계 (site_rows에서)
            slot_category_counts = {}  # {(slot_name, meal_type, category): meal_count}
            for row in site_rows:
                _, mt, category, slot_name_val, meal_count_val = row
                if slot_name_val and meal_count_val:
                    scc_key = (slot_name_val, mt, category)
                    slot_category_counts[scc_key] = slot_category_counts.get(scc_key, 0) + int(meal_count_val)

            # 5b. 메뉴별 카테고리 식수 계산 (슬롯→메뉴 매핑)
            menu_category_meal_counts = {}  # {(base_menu_name, meal_type): {category: head_count}}
            # ★ 카테고리별 recipe_id 매핑 (카테고리별 다른 레시피의 1인분량 구분용)
            menu_category_recipe_map = {}  # {(base_menu_name, meal_type, category): recipe_id}
            for slot_name_key, menu_entries_in_slot_list in slot_menus.items():
                for (s, mt, cat), count in slot_category_counts.items():
                    if s == slot_name_key:
                        for (mn, rid) in menu_entries_in_slot_list:
                            mk = (mn, mt)
                            if mk not in menu_category_meal_counts:
                                menu_category_meal_counts[mk] = {}
                            menu_category_meal_counts[mk][cat] = menu_category_meal_counts[mk].get(cat, 0) + count
                            # ★ 카테고리별 recipe_id 기록 (나중에 정확한 1인분량 조회용)
                            if rid:
                                menu_category_recipe_map[(mn, mt, cat)] = rid

            print(f"[소분지시서] 메뉴별 카테고리 식수: {len(menu_category_meal_counts)}개 메뉴")
            for mk, cats in list(menu_category_meal_counts.items())[:5]:
                print(f"  - {mk}: {cats}")

            # 5c. 레시피 재료 조회 (per_person_qty + 수율) — 조리지시서와 동일한 쿼리
            recipe_ingredients = {}  # {base_menu_name: {(ing_id, ing_name): {per_person_qty_g, ...}}} (fallback용)
            recipe_ingredients_by_id = {}  # ★ {recipe_id: {(ing_id, ing_name): {per_person_qty_g, ...}}} (정확한 매칭용)
            menu_yield_rates = {}  # {base_menu_name: cooking_yield_rate} 메뉴 헤더 표시용
            if all_recipe_ids_from_plans:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids_from_plans))
                cursor.execute(f"""
                    SELECT
                        mr.id AS recipe_id,
                        COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) AS base_menu_name,
                        i.id AS ingredient_id,
                        mri.ingredient_name,
                        mri.required_grams,
                        COALESCE(py.yield_rate, 100.00) AS preprocessing_yield,
                        COALESCE(mr.cooking_yield_rate, 100.00) AS cooking_yield
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                    LEFT JOIN preprocessing_yields py ON i.id = py.ingredient_id
                    WHERE mr.id IN ({rid_placeholders})
                      AND mri.ingredient_name NOT LIKE '양념류%%'
                """, list(all_recipe_ids_from_plans))

                for row in cursor.fetchall():
                    recipe_id_row, base_name_raw, ing_id, ing_name, req_grams, prep_yield_val, cook_yield_val = row
                    base_name_norm = get_base_name(base_name_raw) if base_name_raw else '기타'
                    if not base_name_norm:
                        base_name_norm = '기타'
                    per_person_g = float(req_grams) if req_grams else 0
                    if per_person_g <= 0:
                        continue

                    ing_data = {
                            'per_person_qty_g': per_person_g,
                            'preprocessing_yield': float(prep_yield_val) if prep_yield_val else 100.0,
                            'cooking_yield': float(cook_yield_val) if cook_yield_val else 100.0
                        }
                    ing_key = (ing_id, ing_name)

                    # ★ recipe_id별 딕셔너리 (정확한 카테고리별 매칭용)
                    if recipe_id_row not in recipe_ingredients_by_id:
                        recipe_ingredients_by_id[recipe_id_row] = {}
                    recipe_ingredients_by_id[recipe_id_row][ing_key] = {**ing_data}
                    # base_name별 딕셔너리 (fallback용 - recipe_id 없는 구 데이터 호환)
                    if base_name_norm not in recipe_ingredients:
                        recipe_ingredients[base_name_norm] = {}
                    if base_name_norm not in menu_yield_rates:
                        menu_yield_rates[base_name_norm] = float(cook_yield_val) if cook_yield_val else 100.0
                    if ing_key not in recipe_ingredients[base_name_norm]:
                        recipe_ingredients[base_name_norm][ing_key] = {**ing_data}

                print(f"[소분지시서] 레시피 재료: {len(recipe_ingredients)}개 메뉴, {len(recipe_ingredients_by_id)}개 레시피ID")

            # ★ cooking_yields 테이블에서 사업장별 조리수율 오버라이드 (조리지시서와 동일 로직)
            portion_menu_names = list(recipe_ingredients.keys())
            if portion_menu_names:
                yield_ph = ','.join(['%s'] * len(portion_menu_names))
                if site_id:
                    # ORDER BY site_id ASC → 전역(0)이 먼저 → 사업장별 값이 나중에 덮어씀
                    cursor.execute(f"""
                        SELECT menu_name, cooking_yield_rate, site_id
                        FROM cooking_yields
                        WHERE menu_name IN ({yield_ph})
                          AND site_id IN (%s, 0)
                        ORDER BY site_id ASC
                    """, list(portion_menu_names) + [site_id])
                else:
                    cursor.execute(f"""
                        SELECT menu_name, cooking_yield_rate, site_id
                        FROM cooking_yields
                        WHERE menu_name IN ({yield_ph})
                          AND site_id = 0
                    """, list(portion_menu_names))
                portion_site_yields = {}
                for row in cursor.fetchall():
                    cy_menu, cy_rate, cy_site = row
                    portion_site_yields[cy_menu.strip() if cy_menu else cy_menu] = float(cy_rate)
                if portion_site_yields:
                    print(f"[소분지시서] cooking_yields 오버라이드: {len(portion_site_yields)}건")
                    for menu_name_key, ingredients_dict in recipe_ingredients.items():
                        if menu_name_key in portion_site_yields:
                            override_rate = portion_site_yields[menu_name_key]
                            for ing_key in ingredients_dict:
                                ingredients_dict[ing_key]['cooking_yield'] = override_rate
                    # ★ recipe_ingredients_by_id에도 동일 적용
                    # recipe_id → base_name 매핑으로 오버라이드 적용
                    for rid, ingredients_dict in recipe_ingredients_by_id.items():
                        rid_base = recipe_id_to_canonical.get(rid, '')
                        rid_base_norm = get_base_name(rid_base) if rid_base else ''
                        if rid_base_norm and rid_base_norm in portion_site_yields:
                            override_rate = portion_site_yields[rid_base_norm]
                            for ing_key in ingredients_dict:
                                ingredients_dict[ing_key]['cooking_yield'] = override_rate

            # ★ order_ingredient_overrides 적용 (Step 4 식자재 대체/수량조정/제외 반영 - 소분지시서)
            try:
                override_query = """
                    SELECT original_ingredient_id, original_ingredient_name,
                           replacement_ingredient_id, replacement_ingredient_code,
                           replacement_ingredient_name, replacement_specification,
                           replacement_unit, override_type, added_quantity
                    FROM order_ingredient_overrides
                    WHERE usage_date = %s AND override_type IN ('replace', 'qty_adjust', 'exclude')
                """
                override_params = [cooking_date]
                if site_id:
                    override_query += " AND (site_id = %s OR site_id IS NULL)"
                    override_params.append(site_id)

                cursor.execute(override_query, override_params)
                portion_overrides = cursor.fetchall()
                po_cols = [desc[0] for desc in cursor.description]

                # 1) replace 처리
                portion_qty_adjustments = {}  # {ingredient_id: ratio}
                portion_exclude_ids = set()   # 제외할 ingredient_id

                if portion_overrides:
                    print(f"[소분지시서] order_ingredient_overrides: {len(portion_overrides)}건 조회")
                    for row in portion_overrides:
                        ov = dict(zip(po_cols, row))
                        if ov['override_type'] == 'replace':
                            orig_id = ov['original_ingredient_id']
                            # base_name별 딕셔너리에 적용
                            for menu_name_key, ingredients_dict in recipe_ingredients.items():
                                keys_to_replace = []
                                for ing_key, ing_data in ingredients_dict.items():
                                    if ing_key[0] == orig_id:
                                        keys_to_replace.append(ing_key)
                                for old_key in keys_to_replace:
                                    old_data = ingredients_dict.pop(old_key)
                                    new_key = (ov['replacement_ingredient_id'], ov['replacement_ingredient_name'])
                                    ingredients_dict[new_key] = {**old_data}
                                    print(f"  [소분Override replace] {old_key[1]} → {ov['replacement_ingredient_name']} in {menu_name_key}")
                            # ★ recipe_id별 딕셔너리에도 적용
                            for rid, ingredients_dict in recipe_ingredients_by_id.items():
                                keys_to_replace = []
                                for ing_key, ing_data in ingredients_dict.items():
                                    if ing_key[0] == orig_id:
                                        keys_to_replace.append(ing_key)
                                for old_key in keys_to_replace:
                                    old_data = ingredients_dict.pop(old_key)
                                    new_key = (ov['replacement_ingredient_id'], ov['replacement_ingredient_name'])
                                    ingredients_dict[new_key] = {**old_data}
                        elif ov['override_type'] == 'qty_adjust':
                            ratio = float(ov['added_quantity'] or 1.0)
                            portion_qty_adjustments[ov['original_ingredient_id']] = ratio
                        elif ov['override_type'] == 'exclude':
                            portion_exclude_ids.add(ov['original_ingredient_id'])

                # 2) exclude/qty_adjust 적용 (recipe_ingredients + recipe_ingredients_by_id 양쪽에 반영)
                if portion_exclude_ids or portion_qty_adjustments:
                    # 두 딕셔너리 모두 처리하는 헬퍼
                    all_dicts = list(recipe_ingredients.items()) + list(recipe_ingredients_by_id.items())
                    for dict_key, ingredients_dict in all_dicts:
                        # 제외 처리
                        if portion_exclude_ids:
                            keys_to_delete = [k for k in ingredients_dict if k[0] in portion_exclude_ids]
                            for k in keys_to_delete:
                                del ingredients_dict[k]

                        # 수량 비율 조정
                        if portion_qty_adjustments:
                            for ing_key, ing_data in ingredients_dict.items():
                                ing_id = ing_key[0]
                                if ing_id in portion_qty_adjustments:
                                    ratio = portion_qty_adjustments[ing_id]
                                    old_qty = ing_data.get('per_person_qty_g') or 0
                                    ing_data['per_person_qty_g'] = old_qty * ratio
            except Exception as e:
                print(f"[소분지시서] order_ingredient_overrides 조회 오류 (무시): {e}")

            # 5d. 메뉴별/카테고리별 인당 조리후량 계산 (★ 직접 계산 방식으로 변경)
            # {(base_menu_name, meal_type, category): per_person_cooked_g}
            menu_category_per_person_cooked = {}

            for (menu_name, meal_type_val), cat_counts in menu_category_meal_counts.items():
                for category, head_count in cat_counts.items():
                    # ★ 카테고리별 recipe_id로 정확한 재료 조회 (핵심 변경!)
                    cat_recipe_id = menu_category_recipe_map.get((menu_name, meal_type_val, category))
                    if cat_recipe_id and cat_recipe_id in recipe_ingredients_by_id:
                        ingredients = recipe_ingredients_by_id[cat_recipe_id]
                    else:
                        # fallback: base_name으로 조회 (recipe_id 없는 구 데이터)
                        ingredients = recipe_ingredients.get(menu_name, {})

                    if not ingredients:
                        print(f"[소분지시서] 레시피 재료 없음 (skip): {menu_name} cat={category} rid={cat_recipe_id}")
                        continue

                    # ★ 인당 조리후 총량(g) 계산 (식수와 무관)
                    per_person_cooked_g = 0
                    for ing_key, ing_data in ingredients.items():
                        per_person_g = ing_data['per_person_qty_g']
                        p_yield = ing_data['preprocessing_yield'] / 100.0
                        c_yield = ing_data['cooking_yield'] / 100.0
                        per_person_cooked_g += per_person_g * p_yield * c_yield

                    key = (menu_name, meal_type_val, category)
                    menu_category_per_person_cooked[key] = per_person_cooked_g

            print(f"[소분지시서] menu_category_per_person_cooked: {len(menu_category_per_person_cooked)}개 항목")
            for k, v in list(menu_category_per_person_cooked.items())[:5]:
                print(f"  - {k}: {v:.1f}g/인")

            # 6. 사업장별 소분량 직접 계산 (★ 인당량 × 식수 × 가중치 — 비율 분배 제거)
            # 카테고리/끼니별 총 가중식수 (디버그/참조용)
            category_weighted_totals = {}  # {(meal_type, category): weighted_total}
            for site in business_sites:
                key = (site['meal_type'], site['category'])
                weighted_count = site['meal_count'] * (site['weight_percent'] / 100.0)
                category_weighted_totals[key] = category_weighted_totals.get(key, 0) + weighted_count

            print(f"[소분지시서] category_weighted_totals: {category_weighted_totals}")

            # 각 사업장별 소분량 직접 계산
            for site in business_sites:
                site_name = site['site_name']
                site_meal_type = site['meal_type']
                site_category = site['category']
                site_slot = site['slot_name']
                site_meal_count = site['meal_count']
                site_weight = site['weight_percent'] / 100.0

                # 해당 슬롯에 포함된 메뉴 목록 (★ 튜플 리스트에서 base_name만 추출)
                if site_slot not in slot_menus:
                    continue
                site_menu_names_in_slot = [mn for (mn, rid) in slot_menus[site_slot]]

                if site_meal_count > 0:
                    for menu_name in site_menu_names_in_slot:
                        key = (menu_name, site_meal_type, site_category)
                        per_person_g = menu_category_per_person_cooked.get(key, 0)
                        if per_person_g > 0:
                            # ★ 직접 계산: 인당량(g) × 식수 × 가중치 / 1000 = kg
                            portion_kg = per_person_g * site_meal_count * site_weight / 1000.0
                            site['portions'][menu_name] = round(portion_kg, 1)

            # ★ 요양원 중식 별도 계산 (분리된 yoyangwon_rows로 독립 소분)
            if yoyangwon_rows:
                # 요양원 사업장 목록
                yo_sites = []
                for idx, row in enumerate(yoyangwon_rows):
                    s_name, mt, cat, slot_name, mc = row
                    mc = mc or 0
                    total_meal_count += mc
                    weight = site_weights.get((s_name, mt), 100.0)
                    yo_sites.append({
                        'id': len(business_sites) + idx + 1,
                        'site_name': s_name or '기타',
                        'meal_type': mt,
                        'category': cat or '요양원',
                        'slot_name': slot_name or '',
                        'meal_count': mc,
                        'weight_percent': weight,
                        'container_type': site_container_map.get(s_name, '1/2'),
                        'rice_cooker_size': site_rice_cooker_map.get(s_name, ''),
                        'portions': {}
                    })

                # 요양원 슬롯별 카테고리 식수
                yo_scc = {}
                for row in yoyangwon_rows:
                    _, mt, cat, sn, mc = row
                    if sn and mc:
                        k = (sn, mt, cat)
                        yo_scc[k] = yo_scc.get(k, 0) + int(mc)

                # 요양원 메뉴별 카테고리 식수 (slot_menus 재사용 - 튜플 구조 반영)
                yo_mcmc = {}
                yo_cat_recipe_map = {}  # ★ 요양원용 카테고리별 recipe_id 매핑
                for sn_key, menu_entries in slot_menus.items():
                    for (s, mt, cat), cnt in yo_scc.items():
                        if s == sn_key:
                            for (mn, rid) in menu_entries:
                                mk = (mn, mt)
                                if mk not in yo_mcmc:
                                    yo_mcmc[mk] = {}
                                yo_mcmc[mk][cat] = yo_mcmc[mk].get(cat, 0) + cnt
                                if rid:
                                    yo_cat_recipe_map[(mn, mt, cat)] = rid

                # 요양원 인당 조리후량 (★ recipe_id별 재료 사용 — 직접 계산 방식)
                yo_per_person_cooked = {}  # {(menu_name, meal_type, category): per_person_cooked_g}
                for (mn, mt_val), cats in yo_mcmc.items():
                    for cat, hc in cats.items():
                        cat_rid = yo_cat_recipe_map.get((mn, mt_val, cat))
                        if cat_rid and cat_rid in recipe_ingredients_by_id:
                            ings = recipe_ingredients_by_id[cat_rid]
                        else:
                            ings = recipe_ingredients.get(mn, {})
                        if not ings:
                            continue
                        ppg_total = 0
                        for ik, idata in ings.items():
                            ppg = idata['per_person_qty_g']
                            py = idata['preprocessing_yield'] / 100.0
                            cy = idata['cooking_yield'] / 100.0
                            ppg_total += ppg * py * cy
                        yo_per_person_cooked[(mn, mt_val, cat)] = ppg_total

                # 요양원 소분량 직접 계산 (★ 인당량 × 식수 × 가중치)
                for site in yo_sites:
                    site_slot = site['slot_name']
                    if site_slot not in slot_menus:
                        continue
                    smi_names = [mn for (mn, rid) in slot_menus[site_slot]]
                    if site['meal_count'] > 0:
                        sw = site['weight_percent'] / 100.0
                        for mn in smi_names:
                            key = (mn, site['meal_type'], site['category'])
                            ppg = yo_per_person_cooked.get(key, 0)
                            if ppg > 0:
                                portion_kg = ppg * site['meal_count'] * sw / 1000.0
                                site['portions'][mn] = round(portion_kg, 1)

                # 메인 데이터에 합산
                business_sites.extend(yo_sites)
                # 요양원 인당량도 합산 (메뉴 목록 생성용)
                menu_category_per_person_cooked.update(yo_per_person_cooked)

                print(f"[소분지시서] 요양원 중식 별도 계산: {len(yo_sites)}개 사업장, {len(yo_per_person_cooked)}개 메뉴")

            # 7. 실제 배분된 총량 계산 (슬롯 필터링 결과 기준)
            # {(menu_name, meal_type): actually_distributed_total}
            distributed_totals = {}
            for site in business_sites:
                site_meal_type = site['meal_type']
                for menu_name, portion in site['portions'].items():
                    key = (menu_name, site_meal_type)
                    distributed_totals[key] = distributed_totals.get(key, 0) + portion

            # 8. 메뉴 목록 생성 (실제 배분량 기준)
            # 카테고리별 배분 총량 계산 (사업장 portions에서 역산)
            distributed_category_totals = {}  # {(menu_name, meal_type, category): total_kg}
            for site in business_sites:
                for menu_name, portion in site['portions'].items():
                    key = (menu_name, site['meal_type'], site['category'])
                    distributed_category_totals[key] = distributed_category_totals.get(key, 0) + portion

            # 카테고리별 breakdown을 미리 그룹핑
            grouped_cat = {}
            for (m_name, m_type, category), qty in distributed_category_totals.items():
                grouped_cat.setdefault((m_name, m_type), {})[category] = round(qty, 1)

            menus = []
            for (menu_name, meal_type), total_qty in distributed_totals.items():
                menus.append({
                    'name': menu_name,
                    'meal_type': meal_type,
                    'total_amount': round(total_qty, 1),
                    'category_breakdown': grouped_cat.get((menu_name, meal_type), {}),
                    'yield_rate': menu_yield_rates.get(menu_name, 100)
                })

            # 임시(draft) 상태 발주 확인
            draft_query = "SELECT COUNT(*) FROM orders WHERE usage_date = %s AND status = 'draft'"
            draft_params = [cooking_date]
            if site_id:
                draft_query += " AND site_id = %s"
                draft_params.append(site_id)
            cursor.execute(draft_query, draft_params)
            draft_count = cursor.fetchone()[0]


            # 디버그: 슬롯별 메뉴 매핑 정보
            debug_slot_menus = {k: len(v) for k, v in slot_menus.items()}

            return {
                "success": True,
                "cooking_date": cooking_date,
                "meal_type": meal_type,
                "total_meal_count": total_meal_count,
                "business_sites": business_sites,
                "menus": menus,
                "has_draft_orders": draft_count > 0,
                "draft_order_count": draft_count,
                "cooking_instruction_number": cooking_instruction_info[1] if cooking_instruction_info else None,
                "cooking_instruction_status": cooking_instruction_info[3] if cooking_instruction_info else None,
                "summary": {
                    "total_sites": len(business_sites),
                    "total_menus": len(menus)
                },
                "debug": {
                    "slot_menus_count": debug_slot_menus,
                    "category_weighted_totals": {f"{k[0]}_{k[1]}": v for k, v in category_weighted_totals.items()}
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/portion-weights/save")
async def save_portion_weight(request: Request):
    """사업장별 가중치 저장"""
    try:
        data = await request.json()
        site_name = data.get('site_name')
        meal_type = data.get('meal_type') or ''
        weight_percent = data.get('weight_percent', 100.0)

        if not site_name:
            return {"success": False, "error": "site_name is required"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 생성 (없으면)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_portion_weights (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) NOT NULL,
                    meal_type VARCHAR(50) NOT NULL DEFAULT '',
                    weight_percent DECIMAL(10, 2) DEFAULT 100.0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

            # 기존 NULL meal_type → '' 변환
            cursor.execute("UPDATE site_portion_weights SET meal_type = '' WHERE meal_type IS NULL")
            conn.commit()

            # DELETE + INSERT 방식 (UNIQUE 제약 필요 없음)
            cursor.execute("""
                DELETE FROM site_portion_weights WHERE site_name = %s AND meal_type = %s
            """, [site_name, meal_type])
            cursor.execute("""
                INSERT INTO site_portion_weights (site_name, meal_type, weight_percent, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            """, [site_name, meal_type, weight_percent])

            conn.commit()

            return {
                "success": True,
                "message": f"가중치 저장 완료: {site_name} ({meal_type}) = {weight_percent}%"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/portion-weights")
async def get_portion_weights():
    """모든 사업장 가중치 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, site_name, meal_type, weight_percent, updated_at
                FROM site_portion_weights
                ORDER BY site_name, meal_type
            """)
            rows = cursor.fetchall()

            weights = []
            for row in rows:
                weights.append({
                    'id': row[0],
                    'site_name': row[1],
                    'meal_type': row[2],
                    'weight_percent': float(row[3]) if row[3] else 100.0,
                    'updated_at': str(row[4]) if row[4] else None
                })


            return {"success": True, "weights": weights}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/portion-site-order/save")
async def save_portion_site_order(request: Request):
    """소분지시서 사업장 표시 순서 저장"""
    try:
        data = await request.json()
        meal_type = data.get('meal_type', '')
        orders = data.get('orders', [])  # [{site_name, category, display_order}]

        if not orders:
            return {"success": False, "error": "순서 데이터가 없습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_portion_display_order (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) NOT NULL,
                    meal_type VARCHAR(50) NOT NULL DEFAULT '',
                    category VARCHAR(50) DEFAULT '',
                    display_order INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(site_name, meal_type)
                )
            """)
            conn.commit()

            for item in orders:
                site_name = item.get('site_name')
                category = item.get('category', '')
                display_order = item.get('display_order', 0)
                cursor.execute("""
                    INSERT INTO site_portion_display_order (site_name, meal_type, category, display_order, updated_at)
                    VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (site_name, meal_type)
                    DO UPDATE SET category = EXCLUDED.category, display_order = EXCLUDED.display_order, updated_at = CURRENT_TIMESTAMP
                """, [site_name, meal_type, category, display_order])

            conn.commit()
            return {"success": True, "message": f"{len(orders)}개 사업장 순서 저장 완료"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/portion-site-order")
async def get_portion_site_order(meal_type: str = ''):
    """소분지시서 사업장 표시 순서 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                cursor.execute("""
                    SELECT site_name, meal_type, category, display_order
                    FROM site_portion_display_order
                    WHERE meal_type = %s
                    ORDER BY display_order
                """, [meal_type])
                rows = cursor.fetchall()
            except Exception:
                conn.rollback()
                rows = []

            orders = [{'site_name': r[0], 'meal_type': r[1], 'category': r[2], 'display_order': r[3]} for r in rows]
            return {"success": True, "orders": orders}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/portion-instruction/save")
async def save_portion_instruction(request: Request):
    """소분지시서 저장"""
    try:
        data = await request.json()
        cooking_date = data.get('cooking_date')
        meal_type = data.get('meal_type')
        site_id = data.get('site_id')
        business_sites = data.get('business_sites', [])
        menus = data.get('menus', [])
        notes = data.get('notes', '')
        created_by = data.get('created_by', 'system')

        if not cooking_date:
            return {"success": False, "error": "조리일자가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS portion_instructions (
                    id SERIAL PRIMARY KEY,
                    instruction_number VARCHAR(50) UNIQUE,
                    cooking_date DATE NOT NULL,
                    meal_type VARCHAR(20),
                    site_id INTEGER,
                    total_sites INTEGER DEFAULT 0,
                    total_menus INTEGER DEFAULT 0,
                    notes TEXT,
                    status VARCHAR(20) DEFAULT 'draft',
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS portion_instruction_items (
                    id SERIAL PRIMARY KEY,
                    instruction_id INTEGER NOT NULL,
                    site_name VARCHAR(255),
                    business_type VARCHAR(50),
                    meal_count INTEGER,
                    container_type VARCHAR(20),
                    menu_name VARCHAR(255),
                    portion_amount DECIMAL(10,2),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)

            conn.commit()

            # 지시서 번호 생성
            date_str = cooking_date.replace('-', '')
            meal_code = {'조식': 'B', '중식': 'L', '석식': 'D'}.get(meal_type, 'X')
            cursor.execute("""
                SELECT COUNT(*) FROM portion_instructions
                WHERE cooking_date = %s
            """, (cooking_date,))
            count = cursor.fetchone()[0]
            instruction_number = f"PI{date_str}{meal_code}-{count + 1:04d}"

            # 기존 지시서 확인
            cursor.execute("""
                SELECT id FROM portion_instructions
                WHERE cooking_date = %s AND meal_type = %s AND status = 'draft'
            """, (cooking_date, meal_type))
            existing = cursor.fetchone()

            if existing:
                instruction_id = existing[0]
                cursor.execute("DELETE FROM portion_instruction_items WHERE instruction_id = %s", (instruction_id,))
                cursor.execute("""
                    UPDATE portion_instructions
                    SET total_sites = %s, total_menus = %s, notes = %s, updated_at = NOW()
                    WHERE id = %s
                """, (len(business_sites), len(menus), notes, instruction_id))
            else:
                cursor.execute("""
                    INSERT INTO portion_instructions
                    (instruction_number, cooking_date, meal_type, site_id, total_sites, total_menus, notes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (instruction_number, cooking_date, meal_type, site_id, len(business_sites), len(menus), notes, created_by))
                instruction_id = cursor.fetchone()[0]

            # 품목 저장
            for site in business_sites:
                portions = site.get('portions', {})
                for menu_name, portion_amount in portions.items():
                    cursor.execute("""
                        INSERT INTO portion_instruction_items
                        (instruction_id, site_name, business_type, meal_count, container_type, menu_name, portion_amount)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        instruction_id,
                        site.get('site_name'),
                        site.get('category'),  # business_type → category로 통합
                        site.get('meal_count'),
                        site.get('container_type'),
                        menu_name,
                        portion_amount
                    ))

            conn.commit()

            return {
                "success": True,
                "message": "소분지시서가 저장되었습니다.",
                "instruction_id": instruction_id,
                "instruction_number": instruction_number
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/portion-instruction/list")
async def get_portion_instruction_list(
    start_date: str = Query(None),
    end_date: str = Query(None),
    cooking_date: str = Query(None)
):
    """저장된 소분지시서 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, instruction_number, cooking_date, meal_type,
                       status, total_sites, notes, created_by, created_at
                FROM portion_instructions
                WHERE 1=1
            """
            params = []

            if cooking_date:
                query += " AND cooking_date = %s"
                params.append(cooking_date)
            elif start_date and end_date:
                query += " AND cooking_date BETWEEN %s AND %s"
                params.extend([start_date, end_date])

            query += " ORDER BY cooking_date DESC, created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            instructions = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                instructions.append(item)


            return {"success": True, "instructions": instructions}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/portion-instruction/detail/{instruction_id}")
async def get_portion_instruction_detail(instruction_id: int):
    """소분지시서 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 정보
            cursor.execute("""
                SELECT * FROM portion_instructions WHERE id = %s
            """, (instruction_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            col_names = [desc[0] for desc in cursor.description]
            instruction = dict(zip(col_names, row))
            for key, value in instruction.items():
                if isinstance(value, (datetime, date)):
                    instruction[key] = str(value)
                elif isinstance(value, Decimal):
                    instruction[key] = float(value)

            # 품목 정보
            cursor.execute("""
                SELECT * FROM portion_instruction_items
                WHERE instruction_id = %s
                ORDER BY id
            """, (instruction_id,))
            item_rows = cursor.fetchall()
            item_col_names = [desc[0] for desc in cursor.description]

            items = []
            for item_row in item_rows:
                item = dict(zip(item_col_names, item_row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            instruction['items'] = items

            return {"success": True, "instruction": instruction}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/portion-instruction/{instruction_id}")
async def delete_portion_instruction(instruction_id: int):
    """소분지시서 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 지시서 존재 확인
            cursor.execute("SELECT instruction_number FROM portion_instructions WHERE id = %s", (instruction_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "지시서를 찾을 수 없습니다."}

            instruction_number = row[0]

            # 품목 삭제
            cursor.execute("DELETE FROM portion_instruction_items WHERE instruction_id = %s", (instruction_id,))

            # 지시서 삭제
            cursor.execute("DELETE FROM portion_instructions WHERE id = %s", (instruction_id,))

            conn.commit()

            return {"success": True, "message": f"지시서 {instruction_number}가 삭제되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 조리수율 관리 API
# ============================================

@router.post("/api/cooking-yield/save")
async def save_cooking_yield(request: Request):
    """조리수율 저장 - cooking_yields 테이블에 사업장별 UPSERT"""
    try:
        data = await request.json()
        menu_name = data.get('menu_name')
        site_id = data.get('site_id') or 0  # 사업장별 저장 (None/null → 0 = 전역)
        cooking_yield_rate = data.get('cooking_yield_rate', 100)

        print(f"[조리수율 저장] menu_name={menu_name}, site_id={site_id}, rate={cooking_yield_rate}")

        if not menu_name:
            return {"success": False, "error": "메뉴명이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # cooking_yields 테이블에 사업장별 UPSERT
            cursor.execute("""
                INSERT INTO cooking_yields (menu_name, site_id, cooking_yield_rate, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (menu_name, site_id)
                DO UPDATE SET cooking_yield_rate = EXCLUDED.cooking_yield_rate, updated_at = CURRENT_TIMESTAMP
            """, (menu_name, site_id, cooking_yield_rate))

            conn.commit()

            # 저장 확인
            cursor.execute("""
                SELECT menu_name, site_id, cooking_yield_rate FROM cooking_yields
                WHERE menu_name = %s AND site_id = %s
            """, (menu_name, site_id))
            saved = cursor.fetchone()
            cursor.close()

            print(f"[조리수율 저장 확인] saved={saved}")

            return {
                "success": True,
                "message": f"조리수율이 저장되었습니다. ({menu_name}: {cooking_yield_rate}%, site_id={site_id})"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/cooking-yield/debug")
async def debug_cooking_yield(menu_name: str = Query(None)):
    """조리수율 디버그 - 테이블 내용 확인"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if menu_name:
                cursor.execute("""
                    SELECT menu_name, ingredient_id, cooking_yield_rate, updated_at
                    FROM cooking_yields
                    WHERE menu_name LIKE %s
                    ORDER BY updated_at DESC
                    LIMIT 20
                """, (f"%{menu_name}%",))
            else:
                cursor.execute("""
                    SELECT menu_name, ingredient_id, cooking_yield_rate, updated_at
                    FROM cooking_yields
                    ORDER BY updated_at DESC
                    LIMIT 20
                """)

            rows = cursor.fetchall()
            cursor.close()

            results = []
            for row in rows:
                results.append({
                    "menu_name": row[0],
                    "ingredient_id": row[1],
                    "cooking_yield_rate": float(row[2]) if row[2] else None,
                    "updated_at": str(row[3]) if row[3] else None
                })

            return {"success": True, "data": results, "count": len(results)}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 사업장별 용기 설정 API
# ============================================

@router.get("/api/container-settings")
async def get_container_settings():
    """사업장별 용기 설정 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_container_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    container_type VARCHAR(20) DEFAULT '1/2',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            # 기존 테이블에 UNIQUE 제약조건 누락 시 추가
            try:
                cursor.execute("""
                    ALTER TABLE site_container_settings
                    ADD CONSTRAINT site_container_settings_site_name_key UNIQUE (site_name)
                """)
            except Exception:
                conn.rollback()

            conn.commit()

            cursor.execute("SELECT site_name, container_type FROM site_container_settings")
            rows = cursor.fetchall()

            # 사업장명을 키로 하는 딕셔너리 반환
            settings = {row[0]: row[1] for row in rows}

            return {
                "success": True,
                "settings": settings
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/container-settings/save")
async def save_container_setting(request: Request):
    """사업장별 용기 설정 저장"""
    try:
        data = await request.json()
        site_name = data.get('site_name')
        container_type = data.get('container_type', '1/2')

        if not site_name:
            return {"success": False, "error": "사업장명이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_container_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    container_type VARCHAR(20) DEFAULT '1/2',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            # 기존 테이블에 UNIQUE 제약조건 누락 시 추가
            try:
                cursor.execute("""
                    ALTER TABLE site_container_settings
                    ADD CONSTRAINT site_container_settings_site_name_key UNIQUE (site_name)
                """)
                conn.commit()
            except Exception:
                conn.rollback()

            # UPSERT: 있으면 업데이트, 없으면 삽입
            cursor.execute("""
                INSERT INTO site_container_settings (site_name, container_type, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (site_name)
                DO UPDATE SET container_type = EXCLUDED.container_type, updated_at = NOW()
            """, (site_name, container_type))

            conn.commit()

            return {
                "success": True,
                "message": f"용기 설정이 저장되었습니다. ({site_name}: {container_type})"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 밥통 설정 관리 API
# ============================================

@router.get("/api/rice-cooker-settings")
async def get_rice_cooker_settings():
    """사업장별 밥통 설정 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_rice_cooker_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    rice_cooker_size VARCHAR(20) DEFAULT '',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            conn.commit()

            cursor.execute("SELECT site_name, rice_cooker_size FROM site_rice_cooker_settings")
            rows = cursor.fetchall()

            # 사업장명을 키로 하는 딕셔너리 반환
            settings = {row[0]: row[1] for row in rows}

            return {
                "success": True,
                "settings": settings
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/rice-cooker-settings/save")
async def save_rice_cooker_setting(request: Request):
    """사업장별 밥통 설정 저장"""
    try:
        data = await request.json()
        site_name = data.get('site_name')
        rice_cooker_size = data.get('rice_cooker_size', '')

        if not site_name:
            return {"success": False, "error": "사업장명이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_rice_cooker_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    rice_cooker_size VARCHAR(20) DEFAULT '',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            # UPSERT: 있으면 업데이트, 없으면 삽입
            cursor.execute("""
                INSERT INTO site_rice_cooker_settings (site_name, rice_cooker_size, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (site_name)
                DO UPDATE SET rice_cooker_size = EXCLUDED.rice_cooker_size, updated_at = NOW()
            """, (site_name, rice_cooker_size))

            conn.commit()

            return {
                "success": True,
                "message": f"밥통 설정이 저장되었습니다. ({site_name}: {rice_cooker_size})"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 용기 종류 관리 API
# ============================================

@router.get("/api/container-types")
async def get_container_types():
    """용기 종류 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성하고 기본값 삽입
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS container_types (
                    id SERIAL PRIMARY KEY,
                    type_code VARCHAR(20) UNIQUE NOT NULL,
                    type_name VARCHAR(50) NOT NULL,
                    fill_percent INTEGER DEFAULT 50,
                    sort_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
            conn.commit()

            # 기본 용기 종류가 없으면 삽입
            cursor.execute("SELECT COUNT(*) FROM container_types")
            if cursor.fetchone()[0] == 0:
                default_types = [
                    ('1/6', '1/6', 17, 1),
                    ('1/3', '1/3', 33, 2),
                    ('1/2', '1/2', 50, 3),
                    ('2/3', '2/3', 67, 4),
                    ('full', 'Full', 100, 5)
                ]
                for code, name, percent, order in default_types:
                    cursor.execute("""
                        INSERT INTO container_types (type_code, type_name, fill_percent, sort_order)
                        VALUES (%s, %s, %s, %s)
                    """, (code, name, percent, order))
                conn.commit()

            cursor.execute("""
                SELECT id, type_code, type_name, fill_percent, sort_order, is_active
                FROM container_types
                WHERE is_active = TRUE
                ORDER BY sort_order, type_code
            """)
            rows = cursor.fetchall()

            types = [{
                'id': row[0],
                'type_code': row[1],
                'type_name': row[2],
                'fill_percent': row[3],
                'sort_order': row[4],
                'is_active': row[5]
            } for row in rows]

            return {
                "success": True,
                "types": types
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/container-types/save")
async def save_container_type(request: Request):
    """용기 종류 추가/수정"""
    try:
        data = await request.json()
        type_id = data.get('id')
        type_code = data.get('type_code')
        type_name = data.get('type_name')
        fill_percent = data.get('fill_percent', 50)
        sort_order = data.get('sort_order', 0)

        if not type_code or not type_name:
            return {"success": False, "error": "용기 코드와 이름이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if type_id:
                # 수정
                cursor.execute("""
                    UPDATE container_types
                    SET type_code = %s, type_name = %s, fill_percent = %s, sort_order = %s
                    WHERE id = %s
                """, (type_code, type_name, fill_percent, sort_order, type_id))
                message = f"용기 종류가 수정되었습니다. ({type_name})"
            else:
                # 추가
                cursor.execute("""
                    INSERT INTO container_types (type_code, type_name, fill_percent, sort_order)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                """, (type_code, type_name, fill_percent, sort_order))
                type_id = cursor.fetchone()[0]
                message = f"용기 종류가 추가되었습니다. ({type_name})"

            conn.commit()

            return {
                "success": True,
                "message": message,
                "id": type_id
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/container-types/{type_id}")
async def delete_container_type(type_id: int):
    """용기 종류 삭제 (비활성화)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 실제 삭제 대신 비활성화
            cursor.execute("""
                UPDATE container_types SET is_active = FALSE WHERE id = %s
            """, (type_id,))

            conn.commit()

            return {
                "success": True,
                "message": "용기 종류가 삭제되었습니다."
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 밥통 종류 관리 API
# ============================================

@router.get("/api/rice-cooker-types")
async def get_rice_cooker_types():
    """밥통 종류 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS rice_cooker_types (
                    id SERIAL PRIMARY KEY,
                    type_code VARCHAR(20) UNIQUE NOT NULL,
                    type_name VARCHAR(50) NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
            conn.commit()

            # 기본 밥통 종류가 없으면 삽입
            cursor.execute("SELECT COUNT(*) FROM rice_cooker_types")
            if cursor.fetchone()[0] == 0:
                default_types = [
                    ('21인', '21인', 1),
                    ('35인', '35인', 2),
                    ('50인', '50인', 3)
                ]
                for code, name, order in default_types:
                    cursor.execute("""
                        INSERT INTO rice_cooker_types (type_code, type_name, sort_order)
                        VALUES (%s, %s, %s)
                    """, (code, name, order))
                conn.commit()

            cursor.execute("""
                SELECT id, type_code, type_name, sort_order, is_active
                FROM rice_cooker_types
                WHERE is_active = TRUE
                ORDER BY sort_order, type_code
            """)
            rows = cursor.fetchall()

            types = [{
                'id': row[0],
                'type_code': row[1],
                'type_name': row[2],
                'sort_order': row[3],
                'is_active': row[4]
            } for row in rows]

            return {"success": True, "types": types}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/rice-cooker-types/save")
async def save_rice_cooker_type(request: Request):
    """밥통 종류 추가/수정"""
    try:
        data = await request.json()
        type_id = data.get('id')
        type_code = data.get('type_code')
        type_name = data.get('type_name')
        sort_order = data.get('sort_order', 0)

        if not type_code or not type_name:
            return {"success": False, "error": "밥통 코드와 이름이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if type_id:
                cursor.execute("""
                    UPDATE rice_cooker_types
                    SET type_code = %s, type_name = %s, sort_order = %s
                    WHERE id = %s
                """, (type_code, type_name, sort_order, type_id))
                message = f"밥통 종류가 수정되었습니다. ({type_name})"
            else:
                cursor.execute("""
                    INSERT INTO rice_cooker_types (type_code, type_name, sort_order)
                    VALUES (%s, %s, %s)
                    RETURNING id
                """, (type_code, type_name, sort_order))
                type_id = cursor.fetchone()[0]
                message = f"밥통 종류가 추가되었습니다. ({type_name})"

            conn.commit()

            return {"success": True, "message": message, "id": type_id}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/rice-cooker-types/{type_id}")
async def delete_rice_cooker_type(type_id: int):
    """밥통 종류 삭제 (비활성화)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("UPDATE rice_cooker_types SET is_active = FALSE WHERE id = %s", (type_id,))

            conn.commit()

            return {"success": True, "message": "밥통 종류가 삭제되었습니다."}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 사업장 강조(하이라이트) 관리 API
# ============================================

@router.get("/api/highlight-settings")
async def get_highlight_settings():
    """강조 설정된 사업장 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블이 없으면 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_highlight_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    is_highlighted BOOLEAN DEFAULT FALSE,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    updated_by VARCHAR(100)
                )
            """)
            conn.commit()

            # 강조된 사업장만 조회
            cursor.execute("""
                SELECT site_name FROM site_highlight_settings
                WHERE is_highlighted = TRUE
            """)
            rows = cursor.fetchall()

            settings = {}
            for row in rows:
                settings[row[0]] = True

            return {"success": True, "settings": settings}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/highlight-settings/toggle")
async def toggle_highlight_setting(request: Request):
    """사업장 강조 토글"""
    try:
        data = await request.json()
        site_name = data.get('site_name', '').strip()
        changed_by = data.get('changed_by', '')

        if not site_name:
            return {"success": False, "error": "사업장명이 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 생성 (없으면)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_highlight_settings (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) UNIQUE NOT NULL,
                    is_highlighted BOOLEAN DEFAULT FALSE,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    updated_by VARCHAR(100)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_highlight_history (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) NOT NULL,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)
            conn.commit()

            # 현재 상태 확인
            cursor.execute("""
                SELECT is_highlighted FROM site_highlight_settings
                WHERE site_name = %s
            """, (site_name,))
            row = cursor.fetchone()

            if row is None:
                # 없으면 TRUE로 INSERT
                new_state = True
                cursor.execute("""
                    INSERT INTO site_highlight_settings (site_name, is_highlighted, updated_at, updated_by)
                    VALUES (%s, TRUE, NOW(), %s)
                """, (site_name, changed_by))
            else:
                # 있으면 반전
                new_state = not row[0]
                cursor.execute("""
                    UPDATE site_highlight_settings
                    SET is_highlighted = %s, updated_at = NOW(), updated_by = %s
                    WHERE site_name = %s
                """, (new_state, changed_by, site_name))

            # 이력 기록
            action = 'HIGHLIGHT' if new_state else 'UNHIGHLIGHT'
            cursor.execute("""
                INSERT INTO site_highlight_history (site_name, action, changed_at, changed_by)
                VALUES (%s, %s, NOW(), %s)
            """, (site_name, action, changed_by))

            conn.commit()

            return {"success": True, "is_highlighted": new_state}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/highlight-settings/history")
async def get_highlight_history(site_name: str = None, limit: int = 50):
    """강조 변경 이력 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 생성 (없으면)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_highlight_history (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(255) NOT NULL,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)
            conn.commit()

            if site_name:
                cursor.execute("""
                    SELECT site_name, action, changed_at, changed_by
                    FROM site_highlight_history
                    WHERE site_name = %s
                    ORDER BY changed_at DESC
                    LIMIT %s
                """, (site_name, limit))
            else:
                cursor.execute("""
                    SELECT site_name, action, changed_at, changed_by
                    FROM site_highlight_history
                    ORDER BY changed_at DESC
                    LIMIT %s
                """, (limit,))

            rows = cursor.fetchall()
            history = [{
                'site_name': row[0],
                'action': row[1],
                'changed_at': row[2].isoformat() if row[2] else None,
                'changed_by': row[3]
            } for row in rows]

            return {"success": True, "history": history}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
