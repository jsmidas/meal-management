#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Order Calculation Router
발주 계산/검증/비교 관련 API 엔드포인트
"""

import json
import re
from datetime import datetime, date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Request, Query
from typing import Optional, List
from core.database import get_db_connection

router = APIRouter()


def check_supplier_blackout(cursor, supplier_ids: List[int], target_date: str) -> List[dict]:
    """협력업체 휴무일 체크 - 해당 날짜에 휴무인 협력업체 목록 반환"""
    if not supplier_ids:
        return []

    placeholders = ','.join(['%s'] * len(supplier_ids))
    cursor.execute(f"""
        SELECT sbp.supplier_id, s.name AS supplier_name,
               sbp.start_date, sbp.end_date, sbp.reason
        FROM supplier_blackout_periods sbp
        JOIN suppliers s ON sbp.supplier_id = s.id
        WHERE sbp.supplier_id IN ({placeholders})
          AND sbp.is_active = true
          AND sbp.start_date <= %s
          AND sbp.end_date >= %s
    """, (*supplier_ids, target_date, target_date))

    rows = cursor.fetchall()
    return [
        {
            "supplier_id": row[0],
            "supplier_name": row[1],
            "start_date": str(row[2]),
            "end_date": str(row[3]),
            "reason": row[4]
        }
        for row in rows
    ]


def get_effective_price_for_date(cursor, ingredient_id: int, target_date: str) -> float:
    """특정 날짜의 유효 단가 조회"""
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
        return float(row[0])

    # 유효 단가 없으면 ingredients 테이블의 selling_price 사용
    cursor.execute("SELECT selling_price FROM ingredients WHERE id = %s", (ingredient_id,))
    fallback = cursor.fetchone()
    if fallback and fallback[0]:
        return float(fallback[0])
    return 0.0

# ============================================
# 발주 계산 API (핵심)
# ============================================

@router.post("/api/orders/calculate")
async def calculate_order(request: Request):
    """
    식수 × 식단표 기반 발주량 계산

    요청 데이터:
    {
        "site_id": 1,
        "meal_plan_date": "2025-12-18",  # 식단표 날짜 (메뉴 제공일)
        "order_date": "2025-12-16",  # 주문일
        "warehouse_id": 1
    }
    """
    try:
        data = await request.json()
        site_id = data.get("site_id")
        # meal_plan_date 우선, usage_date는 하위호환용
        usage_date = data.get("meal_plan_date") or data.get("usage_date")
        order_date = data.get("order_date", str(date.today()))
        warehouse_id = data.get("warehouse_id")

        if not usage_date:
            return {"success": False, "error": "식단표 날짜는 필수입니다."}

        import time
        _start_time = time.time()
        print(f"[발주계산] site_id={site_id}, usage_date={usage_date}, order_date={order_date}", flush=True)

        with get_db_connection() as conn:
            print(f"[발주계산] DB 연결: {time.time() - _start_time:.2f}초", flush=True)
            # 연결 상태 초기화 (이전 트랜잭션 오류 방지)
            try:
                conn.rollback()
            except:
                pass
            cursor = conn.cursor()

            # 1. 해당 날짜의 식단표 조회 (site_id 필터 포함, category 포함)
            # ★ site_id가 반드시 일치하는 것만 조회 (NULL 제외)
            if site_id:
                cursor.execute("""
                    SELECT id, plan_date, slot_name, menus, category, site_id
                    FROM meal_plans
                    WHERE plan_date = %s AND site_id = %s
                """, (usage_date, site_id))
            else:
                cursor.execute("""
                    SELECT id, plan_date, slot_name, menus, category, site_id
                    FROM meal_plans
                    WHERE plan_date = %s
                """, (usage_date,))
            meal_plans = cursor.fetchall()
            print(f"[발주계산] 1. 식단표 조회 완료: {len(meal_plans)}개 ({time.time() - _start_time:.2f}초)", flush=True)
            if meal_plans:
                for mp in meal_plans[:5]:  # 처음 5개만 로그
                    print(f"  - slot={mp[2]}, site_id={mp[5]}")

            if not meal_plans:
                return {
                    "success": True,
                    "message": f"{usage_date}에 등록된 식단표가 없습니다. (site_id={site_id})",
                    "data": {"items": [], "summary": {}}
                }

            # 2. 해당 날짜의 식수 조회 (납품처 단위까지 세분화)
            # [정규화] menu_name=슬롯, category=카테고리, site_name=납품처(소분단위)
            # ★★★ 고아 데이터: 해당 날짜의 식단(meal_plans)과 식수(meal_counts) 비교 ★★★
            from datetime import datetime

            # ★ 고아 데이터 판별: 식단과 식수를 직접 비교
            # 타입 A: 식수는 있는데 (meal_count > 0) 해당 슬롯+카테고리의 식단이 없음
            orphan_type_a_query = """
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
            orphan_params_a = [usage_date]
            if site_id:
                orphan_type_a_query += " AND mc.site_id = %s"
                orphan_params_a.append(site_id)
            cursor.execute(orphan_type_a_query, orphan_params_a)
            orphan_rows_a = cursor.fetchall()

            # 타입 B: 식단은 있는데 (menus가 비어있지 않음) 해당 슬롯+카테고리의 식수가 전혀 없거나 모두 0
            orphan_type_b_query = """
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
            orphan_params_b = [usage_date]
            if site_id:
                orphan_type_b_query += " AND mp.site_id = %s"
                orphan_params_b.append(site_id)
            cursor.execute(orphan_type_b_query, orphan_params_b)
            orphan_rows_b = cursor.fetchall()

            # 고아 데이터 합산
            orphan_data = []
            for row in orphan_rows_a:
                orphan_data.append({
                    "slot": row[0], "category": row[1], "site_name": row[2],
                    "meal_count": row[3], "type": row[4]
                })
            for row in orphan_rows_b:
                orphan_data.append({
                    "slot": row[0], "category": row[1], "site_name": row[2],
                    "meal_count": row[3], "type": row[4]
                })

            orphan_count = len(orphan_data)
            orphan_meal_sum = sum(item['meal_count'] or 0 for item in orphan_data)

            if orphan_count > 0:
                print(f"[발주계산] ⚠️ 고아 데이터 {orphan_count}건 감지됨 (식수 합계: {orphan_meal_sum}명)", flush=True)
                for item in orphan_data[:5]:
                    print(f"  - [{item['type']}] {item['category']} > {item['slot']} > {item['site_name']} ({item['meal_count']}명)")

            # ★ 식수 조회: meal_count > 0인 데이터만 (식수 0인 것은 제외)
            meal_counts_query = """
                SELECT
                    mc.menu_name,                              -- slot_name (슬롯)
                    COALESCE(mc.category, mc.business_type) as category,  -- 카테고리
                    mc.site_name,                              -- delivery_site_name (납품처)
                    mc.meal_count                              -- 식수 (집계 안함)
                FROM meal_counts mc
                WHERE mc.work_date = %s
                  AND mc.meal_count > 0
            """
            meal_counts_params = [usage_date]
            if site_id:
                meal_counts_query += " AND mc.site_id = %s"
                meal_counts_params.append(site_id)
            meal_counts_query += " ORDER BY mc.menu_name, category, mc.site_name"
            cursor.execute(meal_counts_query, meal_counts_params)
            meal_counts_rows = cursor.fetchall()
            print(f"[발주계산] 2. 식수 조회 완료: {len(meal_counts_rows)}개 (납품처 단위) ({time.time() - _start_time:.2f}초)", flush=True)

            # [정규화] 납품처 단위 식수 저장 구조
            # meal_counts_detail: {(slot_name, category, delivery_site): meal_count}
            # meal_counts_by_menu: {slot_name: total_count} - 슬롯별 합계 (하위호환)
            # meal_counts_by_menu_category: {slot_name: {category: count}} - 카테고리별 합계 (하위호환)
            meal_counts_detail = {}  # 납품처 단위 상세 (신규)
            meal_counts_by_menu = {}
            meal_counts_by_menu_category = {}
            total_head_count = 0

            for row in meal_counts_rows:
                slot_name = row[0] or ''
                category = row[1] or '운반'
                delivery_site = row[2] or '(미지정)'
                count = row[3] or 0

                if slot_name:
                    # 납품처 단위 상세 저장 (신규)
                    detail_key = (slot_name, category, delivery_site)
                    meal_counts_detail[detail_key] = meal_counts_detail.get(detail_key, 0) + count

                    # 하위호환: 슬롯별 합계
                    meal_counts_by_menu[slot_name] = meal_counts_by_menu.get(slot_name, 0) + count

                    # 하위호환: 카테고리별 합계
                    if slot_name not in meal_counts_by_menu_category:
                        meal_counts_by_menu_category[slot_name] = {}
                    meal_counts_by_menu_category[slot_name][category] = \
                        meal_counts_by_menu_category[slot_name].get(category, 0) + count

                total_head_count += count

            print(f"[발주계산] 2-1. 납품처 단위 데이터: {len(meal_counts_detail)}개 ({time.time() - _start_time:.2f}초)", flush=True)
            # [DEBUG] 납품처 데이터 샘플 출력
            if meal_counts_detail:
                sample_keys = list(meal_counts_detail.keys())[:3]
                print(f"[발주계산] 2-2. [DEBUG] meal_counts_detail 샘플: {sample_keys}", flush=True)

            # 3. 메뉴별 레시피 재료 조회 및 발주량 계산
            order_items = []
            ingredient_totals = {}  # 식자재별 합산용

            # ---------------------------------------------------------
            # [단순화된 식수 계산 로직]
            # slot_name(식단 슬롯) = menu_name(식수 등록 슬롯) 직접 매칭
            # ---------------------------------------------------------

            # ★ category_slots에서 slot_name → meal_type 마스터 매핑 조회
            cursor.execute("SELECT slot_name, meal_type FROM category_slots WHERE is_active = true AND meal_type IS NOT NULL AND meal_type != ''")
            slot_meal_type_master = {row[0]: row[1] for row in cursor.fetchall()}

            def extract_meal_type_simple(text):
                """텍스트에서 끼니 유형 추출 (category_slots 마스터 우선)"""
                if not text: return '중식'
                # ★ category_slots 마스터 설정 우선
                if text in slot_meal_type_master:
                    return slot_meal_type_master[text]
                if '조' in text or '아침' in text or '조식' in text: return '조식'
                if '중' in text or '점심' in text or '중식' in text: return '중식'
                if '석' in text or '저녁' in text or '석식' in text: return '석식'
                if '야' in text or '야식' in text: return '야식'
                return '중식'

            # 식단표 슬롯별 식수 직접 조회 (slot_name = menu_name)
            slot_tasks = []
            for plan in meal_plans:
                plan_id, plan_date, slot_name, menus, db_category, plan_site_id = plan
                if not slot_name or not menus:
                    continue

                # meal_counts_by_menu에서 slot_name과 일치하는 식수 직접 조회
                head_count = meal_counts_by_menu.get(slot_name, 0)

                # [DEBUG] 도레이 추적
                if '도레이' in slot_name:
                    print(f"[DEBUG 도레이] slot_name={slot_name}, head_count={head_count}, menus_count={len(menus) if menus else 0}")
                # 카테고리별 식수 조회 (meal_counts.category 기반)
                category_counts = meal_counts_by_menu_category.get(slot_name, {})
                m_type = extract_meal_type_simple(slot_name)

                # [정규화] 납품처별 식수 조회 (meal_counts_detail 기반)
                # delivery_site_counts: {(category, delivery_site): meal_count}
                delivery_site_counts = {}
                for (mc_slot, mc_cat, mc_site), mc_count in meal_counts_detail.items():
                    if mc_slot == slot_name:
                        delivery_site_counts[(mc_cat, mc_site)] = mc_count

                slot_tasks.append({
                    'plan_id': plan_id,
                    'slot_name': slot_name,
                    'menus': menus,
                    'db_category': db_category,
                    'meal_type': m_type,
                    'calculated_count': head_count,
                    'category_counts': category_counts,  # 카테고리별 식수 {도시락: 100, 운반: 50}
                    'delivery_site_counts': delivery_site_counts,  # [정규화] 납품처별 식수 {(카테고리, 납품처): 식수}
                    'breakdown': [{'site': slot_name, 'count': head_count}] if head_count > 0 else []
                })

            # (4) 결과 매핑 (기존 로직과의 연결)
            # menu_head_counts 구조: (menu_id, meal_type) -> info
            menu_head_counts = {}

            for task in slot_tasks:
                head_count = task['calculated_count']
                meal_type = task['meal_type']
                slot_name = task['slot_name']
                slot_category_counts = task.get('category_counts', {})  # meal_counts.category 기반 카테고리별 식수
                slot_delivery_counts = task.get('delivery_site_counts', {})  # [정규화] 납품처별 식수

                # 카테고리 결정: meal_counts.category 기반 (가장 많은 식수를 가진 카테고리)
                # 또는 모든 카테고리에 분배
                if slot_category_counts:
                    # 가장 많은 식수를 가진 카테고리를 대표 카테고리로 사용
                    category = max(slot_category_counts, key=slot_category_counts.get)
                else:
                    # fallback: db_category 또는 슬롯명 기반
                    category = task['db_category']
                    if not category:
                        if '도시락' in task['slot_name'] or 'BASIC' in task['slot_name'] or 'PLUS' in task['slot_name']:
                            category = '도시락'
                        elif '운반' in task['slot_name'] or '찬' in task['slot_name']:
                            category = '운반'
                        else:
                            category = '운반'

                menus = task['menus']
                # menus 파싱 로직 (기존 코드 재사용 가능하나 여기서 수행)
                if isinstance(menus, str):
                    import json
                    try:
                        menus = json.loads(menus)
                    except:
                        menus = []

                if not menus: continue

                for menu in menus:
                    if isinstance(menu, dict):
                        menu_id = menu.get('id')
                    elif isinstance(menu, int):
                        menu_id = menu
                    else:
                        continue

                    if menu_id:
                        key = (menu_id, meal_type)
                        if key not in menu_head_counts:
                            menu_head_counts[key] = {
                                'head_count': 0,
                                'meal_type': meal_type,
                                'menu_id': menu_id,
                                'category': category,
                                'slot_name': slot_name,  # [정규화] 슬롯명
                                'categories': {},
                                'delivery_sites': {},  # [정규화] 납품처별 식수 {(cat, site): count}
                                'breakdown': []
                            }
                        menu_head_counts[key]['head_count'] += head_count
                        # breakdown 합치기
                        if 'breakdown' in task:
                            menu_head_counts[key]['breakdown'].extend(task['breakdown'])

                        # 카테고리별 식수 합산 (meal_counts.category 기반)
                        if slot_category_counts:
                            # slot_category_counts: {도시락: 100, 운반: 50} - meal_counts.category에서 가져온 카테고리별 식수
                            for cat, cnt in slot_category_counts.items():
                                if cat not in menu_head_counts[key]['categories']:
                                    menu_head_counts[key]['categories'][cat] = 0
                                menu_head_counts[key]['categories'][cat] += cnt
                        elif category:
                            # fallback: 단일 카테고리
                            if category not in menu_head_counts[key]['categories']:
                                menu_head_counts[key]['categories'][category] = 0
                            menu_head_counts[key]['categories'][category] += head_count

                        # [정규화] 납품처별 식수 합산 (slot_name 포함)
                        if slot_delivery_counts:
                            for (d_cat, d_site), d_cnt in slot_delivery_counts.items():
                                # slot_name을 키에 포함하여 슬롯별로 분리 저장
                                ds_key = (d_cat, d_site, slot_name)
                                if ds_key not in menu_head_counts[key]['delivery_sites']:
                                    menu_head_counts[key]['delivery_sites'][ds_key] = 0
                                menu_head_counts[key]['delivery_sites'][ds_key] += d_cnt

            # ============================================
            # [최적화] 배치 쿼리로 DB 호출 최소화
            # ============================================

            # 1단계: 모든 menu_id 수집 및 breakdown 사전 계산
            all_menu_ids = []
            menu_breakdown_map = {}  # menu_id -> final_breakdown_list

            for (menu_id, key_meal_type), menu_info in menu_head_counts.items():
                if menu_info['head_count'] == 0:
                    continue
                all_menu_ids.append(menu_id)

                # breakdown 집계 (끼니별 합산)
                raw_breakdown = menu_info.get('breakdown', [])
                aggregated_breakdown_map = {}
                for item in raw_breakdown:
                    k = item.get('site', '구분없음')
                    if not k: k = '구분없음'
                    k = str(k).strip()
                    aggregated_breakdown_map[k] = aggregated_breakdown_map.get(k, 0) + item['count']
                menu_breakdown_map[(menu_id, key_meal_type)] = [
                    {'site': k, 'count': v} for k, v in aggregated_breakdown_map.items()
                ]

            if not all_menu_ids:
                return {
                    "success": True,
                    "message": "계산할 메뉴가 없습니다.",
                    "data": {"items": [], "summary": {}}
                }

            # ============================================
            # ★★★ 2단계: 각 메뉴의 카테고리별 매핑 생성 ★★★
            # meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 없음)
            # ============================================
            recipe_category_mapping = []

            for (menu_id, key_meal_type), menu_info in menu_head_counts.items():
                if menu_info['head_count'] == 0:
                    continue
                categories = menu_info.get('categories', {})
                delivery_sites = menu_info.get('delivery_sites', {})  # [정규화] 납품처별 식수 {(cat, site, slot_name): count}
                default_slot_name = menu_info.get('slot_name', '')  # [정규화] 기본 슬롯명 (하위호환)

                # [정규화] 납품처 단위로 처리 (있는 경우)
                if delivery_sites:
                    for ds_key, ds_count in delivery_sites.items():
                        if ds_count == 0:
                            continue

                        # 키가 (cat, site, slot_name) 또는 (cat, site) 형태일 수 있음
                        if len(ds_key) == 3:
                            ds_cat, ds_site, ds_slot_name = ds_key
                        else:
                            ds_cat, ds_site = ds_key
                            ds_slot_name = default_slot_name

                        # ★★★ meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 제거) ★★★
                        # 식단표에 저장된 recipe_id가 정확한 레시피를 가리키므로 그대로 사용
                        # 어떤 접미사(-도, -운, -요)의 레시피도 어떤 카테고리에서든 사용 가능
                        target_recipe_id = menu_id

                        recipe_category_mapping.append({
                            'menu_id': menu_id,
                            'meal_type': key_meal_type,
                            'category': ds_cat,
                            'slot_name': ds_slot_name,  # [정규화] 각 납품처의 실제 슬롯명
                            'delivery_site': ds_site,  # [정규화]
                            'cat_count': ds_count,  # 해당 납품처의 식수
                            'recipe_id': target_recipe_id,
                            'menu_info': menu_info
                        })

                else:
                    # 하위호환: delivery_sites가 없으면 기존 카테고리 단위 처리
                    for cat, cat_count in categories.items():
                        if cat_count == 0:
                            continue

                        # ★★★ meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 제거) ★★★
                        target_recipe_id = menu_id

                        recipe_category_mapping.append({
                            'menu_id': menu_id,
                            'meal_type': key_meal_type,
                            'category': cat,
                            'slot_name': default_slot_name,  # [정규화] 현재 menu_info의 슬롯명
                            'delivery_site': '(집계)',  # [정규화] 하위호환 - 집계 데이터
                            'cat_count': cat_count,
                            'recipe_id': target_recipe_id,
                            'menu_info': menu_info
                        })

            # 3단계: 모든 원본 recipe_id의 재료 배치 조회
            all_recipe_ids = list(set([m['recipe_id'] for m in recipe_category_mapping]))
            recipe_ingredients_map = {}  # recipe_id -> [ingredients]

            if all_recipe_ids:
                placeholders = ','.join(['%s'] * len(all_recipe_ids))
                # ★ base_name 우선 사용하여 사이트 접두사 없는 정규 메뉴명 생성
                cursor.execute(f"""
                    SELECT mr.id AS recipe_id,
                           CASE WHEN COALESCE(mr.suffix, '') != ''
                                THEN COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) || '-' || mr.suffix
                                ELSE COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name)
                           END AS menu_name,
                           mri.ingredient_code,
                           mri.ingredient_name AS mri_ingredient_name,
                           mri.specification AS mri_specification,
                           mri.supplier_name AS mri_supplier_name,
                           mri.quantity AS per_person_qty,
                           mri.unit AS mri_unit,
                           mri.required_grams,
                           i.id AS ingredient_id,
                           i.ingredient_name,
                           i.category,
                           i.supplier_name,
                           i.origin,
                           i.specification,
                           i.unit,
                           i.purchase_price,
                           i.delivery_days,
                           COALESCE(i.base_weight_grams, 1000) AS base_weight_grams
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                    WHERE mr.id IN ({placeholders})
                """, all_recipe_ids)

                for row in cursor.fetchall():
                    recipe_id = row[0]
                    if recipe_id not in recipe_ingredients_map:
                        recipe_ingredients_map[recipe_id] = []
                    recipe_ingredients_map[recipe_id].append(row[1:])  # recipe_id 제외한 나머지

            print(f"[발주계산] 3. 원본 레시피 {len(all_recipe_ids)}개 재료 배치 조회 완료 ({time.time() - _start_time:.2f}초)", flush=True)

            # 3-1단계: 오버라이드 적용 (대체/제외/추가)
            # DB 저장된 오버라이드 + 임시(pending) 오버라이드 모두 적용
            overrides = []

            # DB에서 저장된 오버라이드 조회
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
                override_params = [usage_date]
                if site_id:
                    override_query += " AND site_id = %s"
                    override_params.append(site_id)

                cursor.execute(override_query, override_params)
                override_rows = cursor.fetchall()

                for row in override_rows:
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

                if overrides:
                    print(f"[발주계산] 3-1. 오버라이드 {len(overrides)}건 적용 중...", flush=True)

                    # 오버라이드 적용
                    for recipe_id in list(recipe_ingredients_map.keys()):
                        ingredients = recipe_ingredients_map[recipe_id]
                        modified_ingredients = []

                        for ing in ingredients:
                            # 튜플 구조: (menu_name[0], ingredient_code[1], mri_ing_name[2], mri_spec[3],
                            #   mri_supplier[4], per_person_qty[5], mri_unit[6], required_grams[7],
                            #   ingredient_id[8], ing_name[9], ing_category[10], supplier_name[11],
                            #   origin[12], specification[13], ing_unit[14], price[15], delivery_days[16],
                            #   base_weight_grams[17])
                            ing_code = ing[1]   # ingredient_code
                            ing_id = ing[8]     # ingredient_id (index 8, not 7)
                            ing_name = ing[2] or ing[9]  # mri_ing_name or ing_name

                            # 해당 식자재에 대한 오버라이드 찾기
                            matching_override = None
                            for ov in overrides:
                                # recipe_id가 지정된 경우 해당 레시피만 적용
                                if ov['recipe_id'] and ov['recipe_id'] != recipe_id:
                                    continue
                                # 원본 식자재 매칭
                                if ov['type'] in ('replace', 'exclude'):
                                    if ov['original_id'] and ov['original_id'] == ing_id:
                                        matching_override = ov
                                        break
                                    elif ov['original_code'] and ov['original_code'] == ing_code:
                                        matching_override = ov
                                        break

                            if matching_override:
                                if matching_override['type'] == 'exclude':
                                    # 제외: 이 식자재를 스킵
                                    print(f"  [제외] {ing_name} (recipe_id={recipe_id})")
                                    continue
                                elif matching_override['type'] == 'replace':
                                    # 대체: 원본 데이터를 대체 식자재로 교체
                                    # ★★★ 수량 계산: 원본 base_weight 사용 (per_person_qty → grams)
                                    # ★★★ 가격 계산: 대체품 base_weight 사용 (grams → packages → price)
                                    print(f"  [대체] {ing_name} → {matching_override['replacement_name']} (recipe_id={recipe_id})")

                                    # 대체 식자재의 base_weight 조회
                                    replacement_base_weight = ing[17]  # 기본값: 원본 base_weight_grams
                                    if matching_override['replacement_id']:
                                        cursor.execute("""
                                            SELECT COALESCE(base_weight_grams, 1000)
                                            FROM ingredients WHERE id = %s
                                        """, (matching_override['replacement_id'],))
                                        repl_bw = cursor.fetchone()
                                        if repl_bw:
                                            replacement_base_weight = repl_bw[0]

                                    print(f"    → 수량계산용 base_weight: {ing[17]}g (원본)")
                                    print(f"    → 가격계산용 base_weight: {replacement_base_weight}g (대체품)")

                                    # 원본 튜플 구조 유지하면서 대체 정보로 교체
                                    # (menu_name[0], ingredient_code[1], mri_ing_name[2], mri_spec[3],
                                    #  mri_supplier[4], per_person_qty[5], mri_unit[6], required_grams[7],
                                    #  ingredient_id[8], ing_name[9], ing_category[10],
                                    #  supplier_name[11], origin[12], specification[13], ing_unit[14],
                                    #  price[15], delivery_days[16], base_weight_grams[17],
                                    #  price_base_weight_grams[18])
                                    replaced_ing = (
                                        ing[0],  # [0] menu_name
                                        matching_override['replacement_code'] or ing_code,  # [1] ingredient_code
                                        matching_override['replacement_name'] or ing[2],  # [2] mri_ing_name
                                        matching_override['replacement_spec'] or ing[3],  # [3] mri_specification
                                        matching_override['replacement_supplier'] or ing[4],  # [4] mri_supplier
                                        ing[5],  # [5] per_person_qty (수량은 그대로)
                                        matching_override['replacement_unit'] or ing[6],  # [6] mri_unit
                                        ing[7],  # [7] required_grams (원본 그대로)
                                        matching_override['replacement_id'] or ing_id,  # [8] ingredient_id
                                        matching_override['replacement_name'] or ing[9],  # [9] ing_name
                                        ing[10],  # [10] ing_category (원본 카테고리 유지)
                                        matching_override['replacement_supplier'] or ing[11],  # [11] supplier_name
                                        ing[12],  # [12] origin
                                        matching_override['replacement_spec'] or ing[13],  # [13] specification
                                        matching_override['replacement_unit'] or ing[14],  # [14] ing_unit
                                        matching_override['replacement_price'] if matching_override['replacement_price'] > 0 else ing[15],  # [15] price
                                        str(matching_override['replacement_lead_time']) if matching_override['replacement_lead_time'] else ing[16],  # [16] delivery_days
                                        ing[17],  # [17] base_weight_grams (원본 - 수량 계산용)
                                        replacement_base_weight  # [18] price_base_weight_grams (대체품 - 가격 계산용)
                                    )
                                    modified_ingredients.append(replaced_ing)
                                    continue

                            # 오버라이드가 없으면 원본 유지
                            modified_ingredients.append(ing)

                        # 추가 오버라이드 처리
                        for ov in overrides:
                            if ov['type'] == 'add':
                                # recipe_id가 지정된 경우 해당 레시피에만 추가
                                if ov['recipe_id'] and ov['recipe_id'] == recipe_id:
                                    print(f"  [추가] {ov['replacement_name']} {ov['added_qty']}{ov['added_unit']} (recipe_id={recipe_id})")
                                    # 추가할 식자재 정보 조회
                                    if ov['replacement_id']:
                                        cursor.execute("""
                                            SELECT id, ingredient_code, ingredient_name, specification,
                                                   supplier_name, unit, purchase_price, delivery_days,
                                                   COALESCE(base_weight_grams, 1000), category, origin
                                            FROM ingredients WHERE id = %s
                                        """, (ov['replacement_id'],))
                                        add_row = cursor.fetchone()
                                        if add_row:
                                            menu_name = ingredients[0][0] if ingredients else ''
                                            # 추가 식자재의 required_grams 계산
                                            # added_qty가 g 단위 인당량이므로 그대로 사용
                                            added_required_grams = float(ov['added_qty'] or 0)
                                            added_ing = (
                                                menu_name,  # [0] menu_name
                                                add_row[1],  # [1] ingredient_code
                                                add_row[2],  # [2] mri_ing_name
                                                add_row[3],  # [3] mri_specification
                                                add_row[4],  # [4] mri_supplier
                                                ov['added_qty'],  # [5] per_person_qty (1인필요량)
                                                ov['added_unit'] or add_row[5],  # [6] mri_unit
                                                added_required_grams,  # [7] required_grams
                                                add_row[0],  # [8] ingredient_id
                                                add_row[2],  # [9] ing_name
                                                add_row[9],  # [10] ing_category
                                                add_row[4],  # [11] supplier_name
                                                add_row[10],  # [12] origin
                                                add_row[3],  # [13] specification
                                                add_row[5],  # [14] ing_unit
                                                float(add_row[6] or 0),  # [15] price
                                                add_row[7] or '2',  # [16] delivery_days
                                                float(add_row[8] or 1000)  # [17] base_weight_grams
                                            )
                                            modified_ingredients.append(added_ing)

                        recipe_ingredients_map[recipe_id] = modified_ingredients

                    print(f"[발주계산] 3-1. 오버라이드 적용 완료 ({time.time() - _start_time:.2f}초)", flush=True)

            except Exception as e:
                print(f"[WARNING] 오버라이드 적용 중 오류: {e}")
                import traceback
                traceback.print_exc()
                try:
                    conn.rollback()
                except:
                    pass

            # 4단계: 각 메뉴별로 재료 처리 (원본 레시피 사용)
            # [정규화] 납품처 단위까지 세분화된 데이터 저장
            for mapping in recipe_category_mapping:
                menu_id = mapping['menu_id']
                meal_type = mapping['meal_type']
                cat = mapping['category']
                slot_name = mapping.get('slot_name', '')  # [정규화]
                delivery_site = mapping.get('delivery_site', '(집계)')  # [정규화]
                site_head_count = mapping['cat_count']  # 납품처별 식수 (또는 카테고리별 식수)
                recipe_id = mapping['recipe_id']
                menu_info = mapping['menu_info']

                head_count = menu_info['head_count']
                category = menu_info.get('category')
                final_breakdown_list = menu_breakdown_map.get((menu_id, meal_type), [])

                # 배치 조회된 재료 사용
                recipe_ingredients = recipe_ingredients_map.get(recipe_id, [])

                for ri in recipe_ingredients:
                    # 배치 쿼리 결과: 18개 컬럼 (일반) 또는 19개 컬럼 (대체 시 price_base_weight 추가)
                    # required_grams 컬럼 추가됨
                    if len(ri) >= 19:
                        (menu_name, ingredient_code, mri_ing_name, mri_spec, mri_supplier,
                         per_person_qty, mri_unit, required_grams, ingredient_id, ing_name, ing_category,
                         supplier_name, origin, specification, ing_unit, price, delivery_days,
                         base_weight_grams, price_base_weight_grams) = ri[:19]
                    else:
                        (menu_name, ingredient_code, mri_ing_name, mri_spec, mri_supplier,
                         per_person_qty, mri_unit, required_grams, ingredient_id, ing_name, ing_category,
                         supplier_name, origin, specification, ing_unit, price, delivery_days,
                         base_weight_grams) = ri[:18]
                        price_base_weight_grams = base_weight_grams  # 대체 아닌 경우 동일

                    if not per_person_qty and not required_grams:
                        continue

                    # mri 값 우선, 없으면 ingredients 테이블 값 사용
                    final_ing_name = mri_ing_name or ing_name or ingredient_code
                    final_spec = mri_spec or specification or ''
                    final_supplier = mri_supplier or supplier_name or ''
                    final_unit = mri_unit or ing_unit or ''

                    # ★★★ required_grams 직접 사용 (역산 금지) ★★★
                    per_person_qty_g = float(required_grams or 0)

                    # ★★★ 인당량 검증 - 0이면 경고 ★★★
                    if per_person_qty_g <= 0:
                        print(f"[발주생성] ⚠️ 인당량(required_grams) 누락: {menu_name} - {final_ing_name}")

                    final_price = float(price or 0)
                    # delivery_days가 'D-1', 'D-2' 형식일 수 있으므로 숫자만 추출
                    if delivery_days:
                        import re
                        match = re.search(r'\d+', str(delivery_days))
                        final_delivery_days = int(match.group()) if match else 2
                    else:
                        final_delivery_days = 2

                    # 필요량 계산 (해당 납품처의 식수 × 인당량) - kg 단위로 계산
                    required_qty = (per_person_qty_g / 1000) * int(site_head_count or 0)

                    # [정규화] 완전 정규화된 키 사용
                    # 저장 단위: (식자재, 끼니, 메뉴, 카테고리, 슬롯, 납품처)
                    item_key = (
                        ingredient_code or final_ing_name,
                        meal_type,
                        menu_name,
                        cat,
                        slot_name,
                        delivery_site
                    )

                    if item_key not in ingredient_totals:
                        ingredient_totals[item_key] = {
                            "ingredient_id": ingredient_id,
                            "ingredient_code": ingredient_code,
                            "ingredient_name": final_ing_name,
                            "specification": final_spec,
                            "category": ing_category or '',
                            "supplier_name": final_supplier,
                            "origin": origin or '',
                            "unit": final_unit,
                            "unit_price": final_price,
                            "delivery_days": final_delivery_days,
                            "required_qty": 0,
                            "required_qty_g": 0,  # ★ 총필요량(g) - 조리/소분용
                            "current_stock": 0,  # 프론트엔드에서 수동 입력
                            "meal_count": 0,  # 해당 납품처 식수
                            "meal_type": meal_type,  # 끼니 유형
                            "meal_category": cat,  # 배분 카테고리 (도시락, 운반, 학교, 요양원)
                            "slot_name": slot_name,  # [정규화] 슬롯명
                            "delivery_site_name": delivery_site,  # [정규화] 납품처
                            "menu_name": menu_name,  # [정규화] 메뉴명
                            "per_person_qty": float(per_person_qty or 0),  # [정규화] 인당량(포)
                            "per_person_qty_g": per_person_qty_g,  # ★ 인당량(g) - 조리/소분용
                            "base_weight_grams": float(base_weight_grams or 1000),  # ★ 수량계산용 기준용량(g)
                            "price_base_weight_grams": float(price_base_weight_grams or base_weight_grams or 1000),  # ★ 가격계산용 기준용량(g)
                            "category_counts": {},  # 하위호환용
                            "meal_refs": []  # 하위호환용
                        }

                    # 같은 키의 데이터가 여러 번 나올 경우 합산
                    ingredient_totals[item_key]["required_qty"] += required_qty
                    ingredient_totals[item_key]["required_qty_g"] += per_person_qty_g * int(site_head_count or 0)  # ★ g단위 합산
                    ingredient_totals[item_key]["meal_count"] += int(site_head_count or 0)

                    # 하위호환: category_counts (카테고리별 집계)
                    cnt = int(site_head_count or 0)
                    if cat and cnt > 0:
                        if cat not in ingredient_totals[item_key]["category_counts"]:
                            ingredient_totals[item_key]["category_counts"][cat] = {
                                "head_count": 0,
                                "required_qty": 0
                            }
                        ingredient_totals[item_key]["category_counts"][cat]["head_count"] += cnt
                        ingredient_totals[item_key]["category_counts"][cat]["required_qty"] += required_qty

                    # 하위호환: meal_refs (상세 내역)
                    if not final_breakdown_list and head_count > 0:
                         final_breakdown_list = [{'site': delivery_site, 'count': site_head_count}]

                    ingredient_totals[item_key]["meal_refs"].append({
                        "menu_name": menu_name,
                        "head_count": int(site_head_count or 0),
                        "meal_type": meal_type,
                        "category": cat,
                        "slot_name": slot_name,  # [정규화]
                        "delivery_site": delivery_site,  # [정규화]
                        "categories": {cat: cnt} if cat else {},
                        "breakdown": final_breakdown_list,
                        "per_person_qty": float(per_person_qty or 0),
                        "per_person_qty_g": per_person_qty_g,  # ★ 1인필요량(g)
                        "qty_g": per_person_qty_g * int(site_head_count or 0)  # ★ 총필요량(g)
                    })

            print(f"[발주계산] 4. 재료 처리 완료: {len(ingredient_totals)}개 식자재 ({time.time() - _start_time:.2f}초)", flush=True)

            # 4. 선발주일 및 단가 검증
            # 사용자가 선택한 입고예정일 (order_date)
            expected_delivery_obj = datetime.strptime(order_date, "%Y-%m-%d").date()
            usage_date_obj = datetime.strptime(usage_date, "%Y-%m-%d").date()

            # 서버 현재 시간 기준 실제 발주일 계산 (20시 마감 규칙 적용)
            now = datetime.now()
            actual_order_date = now.date()
            order_cutoff_hour = 20  # 발주 마감 시간 (20시)

            if now.hour >= order_cutoff_hour:
                # 20시 이후면 오늘 발주 불가, 내일로 계산
                actual_order_date = actual_order_date + timedelta(days=1)

            # 업체별 휴무일 조회 (발주 가능 여부 판단용)
            supplier_blackouts = {}  # supplier_name -> [blackout_dates]
            try:
                cursor.execute("""
                    SELECT s.name AS supplier_name, sbp.start_date, sbp.end_date
                    FROM supplier_blackout_periods sbp
                    JOIN suppliers s ON sbp.supplier_id = s.id
                    WHERE sbp.is_active = true
                      AND sbp.end_date >= %s
                      AND sbp.start_date <= %s
                """, (str(actual_order_date), str(expected_delivery_obj + timedelta(days=7))))

                for row in cursor.fetchall():
                    supplier_name, start_date, end_date = row
                    if supplier_name not in supplier_blackouts:
                        supplier_blackouts[supplier_name] = []
                    supplier_blackouts[supplier_name].append({
                        'start': start_date,
                        'end': end_date
                    })
            except Exception as e:
                print(f"[WARNING] 휴무일 조회 실패: {e}")
                # 트랜잭션 상태 초기화
                try:
                    conn.rollback()
                except:
                    pass

            # 품목별 공급불가 기간 조회 (ingredient_blackout_periods)
            blackout_ingredients = set()
            try:
                cursor.execute("""
                    SELECT ingredient_code
                    FROM ingredient_blackout_periods
                    WHERE is_active = TRUE
                      AND %s BETWEEN start_date AND end_date
                """, (str(expected_delivery_obj),))
                blackout_ingredients = set(str(row[0]).strip() for row in cursor.fetchall())
                if blackout_ingredients:
                    print(f"[DEBUG] 공급불가 품목 {len(blackout_ingredients)}개 발견 (입고예정일: {expected_delivery_obj})")
            except Exception as e:
                print(f"[WARNING] 공급불가 품목 조회 실패: {e}")

            # 🚫 비활성 협력업체 조회 (거래중단 업체)
            inactive_suppliers = set()
            try:
                cursor.execute("SELECT name FROM suppliers WHERE is_active = false")
                inactive_suppliers = set(row[0] for row in cursor.fetchall())
                if inactive_suppliers:
                    print(f"[DEBUG] 비활성 협력업체 {len(inactive_suppliers)}개: {list(inactive_suppliers)[:5]}...")
            except Exception as e:
                print(f"[WARNING] 비활성 협력업체 조회 실패: {e}")
                # 트랜잭션 상태 초기화 (테이블이 없어도 계속 진행)
                try:
                    conn.rollback()
                except:
                    pass

            print(f"[발주계산] 5. 휴무일/비활성업체 조회 완료 ({time.time() - _start_time:.2f}초)", flush=True)

            def is_blackout_date(supplier_name, check_date):
                """특정 업체의 특정 날짜가 휴무일인지 확인"""
                if supplier_name not in supplier_blackouts:
                    return False
                for period in supplier_blackouts[supplier_name]:
                    if period['start'] <= check_date <= period['end']:
                        return True
                return False

            def get_next_working_date(supplier_name, start_date):
                """특정 업체의 다음 영업일 반환 (휴무일 건너뛰기)"""
                check_date = start_date
                max_days = 30  # 최대 30일까지만 확인
                for _ in range(max_days):
                    if not is_blackout_date(supplier_name, check_date):
                        return check_date
                    check_date = check_date + timedelta(days=1)
                return check_date

            # 실제 발주일에서 입고예정일까지 남은 일수
            days_until_delivery = (expected_delivery_obj - actual_order_date).days

            # 식단표 날짜까지 남은 일수 (참고용)
            days_until_usage = (usage_date_obj - actual_order_date).days

            print(f"[DEBUG] 현재시간: {now}, 발주마감: {order_cutoff_hour}시, 실제발주일: {actual_order_date}")
            print(f"[DEBUG] 입고예정일: {expected_delivery_obj}, 납품까지: {days_until_delivery}일")

            # [정규화] 현재고 비율 배분을 위한 전처리
            # 식자재별 total required_qty 계산 (ingredient_id 기준)
            ingredient_totals_by_ing = {}  # {ingredient_id: {'total_required': float, 'current_stock': float}}
            for item_key, item in ingredient_totals.items():
                ing_id = item.get("ingredient_id") or item.get("ingredient_code")
                if ing_id not in ingredient_totals_by_ing:
                    ingredient_totals_by_ing[ing_id] = {
                        'total_required': 0,
                        'current_stock': item.get("current_stock", 0)
                    }
                ingredient_totals_by_ing[ing_id]['total_required'] += item.get("required_qty", 0)

            warnings = []
            cannot_order = []

            # 📅 단가 유효기간 일괄 조회 (단일 쿼리로 최적화)
            all_ingredient_ids = list(set(
                item.get("ingredient_id") for item in ingredient_totals.values()
                if item.get("ingredient_id") and isinstance(item.get("ingredient_id"), int)
            ))
            expired_ingredient_ids = set()
            if all_ingredient_ids:
                placeholders = ','.join(['%s'] * len(all_ingredient_ids))
                cursor.execute(f"""
                    SELECT ingredient_id,
                           MAX(CASE WHEN effective_from <= %s AND (effective_to IS NULL OR effective_to >= %s) THEN 1 ELSE 0 END) AS has_valid
                    FROM ingredient_prices
                    WHERE ingredient_id IN ({placeholders})
                    GROUP BY ingredient_id
                    HAVING MAX(CASE WHEN effective_from <= %s AND (effective_to IS NULL OR effective_to >= %s) THEN 1 ELSE 0 END) = 0
                """, [usage_date, usage_date] + all_ingredient_ids + [usage_date, usage_date])
                expired_ingredient_ids = set(row[0] for row in cursor.fetchall())
            print(f"[발주계산] 5-1. 단가 만료 체크 완료: {len(expired_ingredient_ids)}개 만료 ({time.time() - _start_time:.2f}초)", flush=True)

            for ing_id, item in ingredient_totals.items():
                lead_time = item["delivery_days"]

                # ★★★ 단순 계산: 총필요량(g) ÷ 기준용량(g) = 발주량(포) ★★★
                total_qty_g = item.get("required_qty_g", 0)  # 1인당 필요량(g) × 식수 = 총필요량(g)

                # ★ 대체품인 경우 대체품의 기준용량 사용 (price_base_weight_grams)
                # ★ 원본이면 base_weight_grams 사용
                order_base_weight_g = item.get("price_base_weight_grams") or item.get("base_weight_grams") or 1000

                # 발주량(포) = 총필요량(g) ÷ 기준용량(g)
                order_qty = total_qty_g / order_base_weight_g
                total_price = order_qty * item["unit_price"]
                item["allocated_stock"] = 0  # 현재고 배분 로직은 프론트엔드에서 처리
                supplier_name = item.get("supplier_name", "")

                # 입고예정일 = 사용자가 선택한 주문일
                expected_delivery_str = order_date

                # 선발주일 체크 (실제 발주일 기준)
                can_order = True
                warning_msg = None
                blackout_warning = None

                # 업체 휴무일 체크
                if supplier_name:
                    # 실제 발주일이 휴무일인지 확인
                    if is_blackout_date(supplier_name, actual_order_date):
                        next_working = get_next_working_date(supplier_name, actual_order_date)
                        days_lost = (next_working - actual_order_date).days
                        blackout_warning = f"발주일({actual_order_date}) 휴무 → 다음 영업일: {next_working}"
                        # 휴무로 인해 실제 사용 가능한 일수 감소
                        effective_days = days_until_delivery - days_lost
                        if effective_days < lead_time:
                            can_order = False
                            warning_msg = f"업체 휴무로 선발주일 미충족 ({blackout_warning})"

                    # 입고예정일이 휴무일인지 확인
                    if is_blackout_date(supplier_name, expected_delivery_obj):
                        blackout_warning = f"입고예정일({expected_delivery_obj}) 휴무"
                        can_order = False
                        warning_msg = f"입고예정일이 업체 휴무일입니다"

                # 입고예정일까지 lead_time보다 적은 일수가 남으면 발주 불가
                if can_order and days_until_delivery < lead_time:
                    can_order = False
                    warning_msg = f"선발주일 D-{lead_time} 미충족 (현재 D-{days_until_delivery}, 마감시간 {order_cutoff_hour}시)"

                # 품목별 공급불가 기간 체크
                ingredient_code = item.get("ingredient_code", "")
                if can_order and ingredient_code and str(ingredient_code).strip() in blackout_ingredients:
                    can_order = False
                    warning_msg = "공급불가 기간 (협력업체 사정)"

                # 🚫 비활성 협력업체 체크 (거래중단)
                if can_order and supplier_name and supplier_name in inactive_suppliers:
                    can_order = False
                    warning_msg = "거래중단 협력업체 (발주 불가)"

                # 📅 단가 만료 체크 (사전 일괄 조회 결과 참조)
                price_expired = False
                ingredient_id = item.get("ingredient_id")
                if can_order and isinstance(ingredient_id, int) and ingredient_id in expired_ingredient_ids:
                    price_expired = True
                    can_order = False
                    warning_msg = "단가 유효기간 만료 (대체 식자재를 선택하세요)"

                if not can_order:
                    # DEBUG: 발주불가 품목 상세 로그
                    print(f"[발주불가] {item['ingredient_name']}: lead_time=D-{lead_time}, days_until_delivery={days_until_delivery}, 사유={warning_msg}")
                    cannot_order.append({
                        "ingredient_name": item["ingredient_name"],
                        "lead_time": lead_time,
                        "days_until_delivery": days_until_delivery,
                        "blackout_warning": blackout_warning
                    })

                order_items.append({
                    **item,
                    "required_qty": round(item["required_qty"], 2),
                    "order_qty": round(order_qty, 2),
                    "total_price": round(total_price, 2),
                    "lead_time": lead_time,
                    "lead_time_display": f"D-{lead_time}",
                    "expected_delivery_date": expected_delivery_str,
                    "can_order": can_order,
                    "warning": warning_msg,
                    "price_expired": price_expired
                })

            # 5. 결과 정리
            total_amount = sum(item["total_price"] for item in order_items)
            orderable_items = [item for item in order_items if item["can_order"]]
            unorderable_items = [item for item in order_items if not item["can_order"]]

            # 6. 협력업체 휴무일 체크
            supplier_names = list(set([
                item.get("supplier_name") for item in order_items
                if item.get("supplier_name")
            ]))

            # supplier_name으로 supplier_id 조회 후 휴무일 체크
            blackout_suppliers = []
            if supplier_names:
                placeholders = ','.join(['%s'] * len(supplier_names))
                cursor.execute(f"""
                    SELECT id FROM suppliers WHERE name IN ({placeholders})
                """, supplier_names)
                supplier_rows = cursor.fetchall()
                supplier_ids = [row[0] for row in supplier_rows]

                if supplier_ids:
                    blackout_suppliers = check_supplier_blackout(cursor, supplier_ids, usage_date)

            print(f"[발주계산] 6. 전체 완료 ({time.time() - _start_time:.2f}초)", flush=True)

            return {
                "success": True,
                "data": {
                    "usage_date": usage_date,
                    "order_date": order_date,
                    "days_until_usage": days_until_usage,
                    "items": order_items,
                    "summary": {
                        "total_items": len(order_items),
                        "orderable_items": len(orderable_items),
                        "unorderable_items": len(unorderable_items),
                        "total_amount": round(total_amount, 2),
                        "actual_order_date": str(actual_order_date),
                        "order_cutoff_hour": order_cutoff_hour,
                        "current_time": now.strftime("%Y-%m-%d %H:%M"),
                        "is_after_cutoff": now.hour >= order_cutoff_hour
                    },
                    "warnings": cannot_order,
                    "blackout_suppliers": blackout_suppliers,
                    "orphan_data": {
                        "count": orphan_count,
                        "meal_sum": orphan_meal_sum,
                        "items": orphan_data[:10] if orphan_count > 10 else orphan_data  # 최대 10개만 전송
                    } if orphan_count > 0 else None
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/orders/validate")
async def validate_order(
    usage_date: str = Query(...),
    order_date: str = Query(None),
    site_id: int = Query(None)
):
    """발주 유효성 검증 (선발주일, 단가 변동, 기존 발주서 체크)"""
    try:
        if not order_date:
            order_date = str(date.today())

        order_date_obj = datetime.strptime(order_date, "%Y-%m-%d").date()
        usage_date_obj = datetime.strptime(usage_date, "%Y-%m-%d").date()
        days_until_usage = (usage_date_obj - order_date_obj).days

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 발주서 체크 (같은 식단표 날짜 + 사업장)
            existing_orders = []
            if site_id:
                cursor.execute("""
                    SELECT id, order_number, status, total_items, total_amount, created_at
                    FROM orders
                    WHERE usage_date = %s AND site_id = %s AND status != 'cancelled'
                    ORDER BY created_at DESC
                """, (usage_date, site_id))
                for row in cursor.fetchall():
                    existing_orders.append({
                        "order_id": row[0],
                        "order_number": row[1],
                        "status": row[2],
                        "status_label": "임시저장" if row[2] == "draft" else "확정" if row[2] == "confirmed" else row[2],
                        "total_items": row[3],
                        "total_amount": float(row[4]) if row[4] else 0,
                        "created_at": str(row[5]) if row[5] else None
                    })

            # 선발주일이 긴 식자재 찾기
            long_lead_items = []
            try:
                cursor.execute("""
                    SELECT DISTINCT i.ingredient_name, i.delivery_days, i.supplier_name
                    FROM ingredients i
                    WHERE COALESCE(NULLIF(regexp_replace(COALESCE(i.delivery_days, '0'), '[^0-9]', '', 'g'), ''), '0')::integer > %s
                    ORDER BY COALESCE(NULLIF(regexp_replace(COALESCE(i.delivery_days, '0'), '[^0-9]', '', 'g'), ''), '0')::integer DESC
                    LIMIT 20
                """, (days_until_usage,))
                long_lead_items = cursor.fetchall()
            except Exception as e:
                print(f"[WARN] 선발주일 체크 오류: {e}", flush=True)

            # 단가 변동 예정 품목 (ingredient_prices 테이블)
            price_changes = []
            try:
                cursor.execute("""
                    SELECT i.ingredient_name, ip.unit_price, ip.effective_from
                    FROM ingredient_prices ip
                    JOIN ingredients i ON ip.ingredient_id = i.id
                    WHERE ip.effective_from > CURRENT_DATE
                      AND ip.effective_from <= %s
                    ORDER BY ip.effective_from
                    LIMIT 20
                """, (usage_date,))
                price_changes = cursor.fetchall()
            except:
                pass  # 테이블이 없으면 무시


            return {
                "success": True,
                "data": {
                    "usage_date": usage_date,
                    "order_date": order_date,
                    "days_until_usage": days_until_usage,
                    "existing_orders": existing_orders,
                    "has_existing_orders": len(existing_orders) > 0,
                    "lead_time_warnings": [
                        {
                            "ingredient_name": row[0],
                            "lead_time": row[1],
                            "supplier_name": row[2],
                            "message": f"D-{row[1]} 필요, 현재 D-{days_until_usage}"
                        }
                        for row in long_lead_items
                    ],
                    "price_changes": [
                        {
                            "ingredient_name": row[0],
                            "new_price": float(row[1]),
                            "effective_date": str(row[2])
                        }
                        for row in price_changes
                    ]
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 발주서 식자재 오버라이드 API
# ============================================

@router.get("/api/orders/alternative-ingredients")
async def get_alternative_ingredients(
    ingredient_id: int = Query(None, description="원본 식자재 ID"),
    ingredient_code: str = Query(None, description="원본 식자재 코드"),
    category: str = Query(None, description="식자재 카테고리"),
    max_lead_time: int = Query(None, description="최대 선발주일"),
    search: str = Query(None, description="검색어"),
    limit: int = Query(20, description="결과 수")
):
    """
    대체 가능 식자재 조회
    - 같은 카테고리 식자재
    - 발주 가능 (선발주일 충족)
    - 단위당 단가순 정렬
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 원본 식자재 정보 조회 (카테고리 자동 추출)
            if ingredient_id and not category:
                cursor.execute("""
                    SELECT category FROM ingredients WHERE id = %s
                """, (ingredient_id,))
                row = cursor.fetchone()
                if row:
                    category = row[0]
            elif ingredient_code and not category:
                cursor.execute("""
                    SELECT category FROM ingredients WHERE ingredient_code = %s
                """, (ingredient_code,))
                row = cursor.fetchone()
                if row:
                    category = row[0]

            # 대체 가능 식자재 조회
            # delivery_days가 "D-2" 형식일 수 있으므로 숫자만 추출
            query = """
                SELECT
                    i.id,
                    i.ingredient_code,
                    i.ingredient_name,
                    i.specification,
                    i.unit,
                    i.purchase_price,
                    i.price_per_unit,
                    COALESCE(
                        NULLIF(regexp_replace(COALESCE(i.delivery_days, '2'), '[^0-9]', '', 'g'), ''),
                        '2'
                    )::integer AS lead_time,
                    i.supplier_name,
                    i.category,
                    i.origin
                FROM ingredients i
                WHERE 1=1
            """
            params = []

            # 카테고리 필터
            if category:
                query += " AND i.category = %s"
                params.append(category)

            # 선발주일 필터
            if max_lead_time:
                query += " AND COALESCE(NULLIF(regexp_replace(COALESCE(i.delivery_days, '2'), '[^0-9]', '', 'g'), ''), '2')::integer <= %s"
                params.append(max_lead_time)

            # 검색어 필터
            if search:
                query += " AND (i.ingredient_name ILIKE %s OR i.ingredient_code ILIKE %s)"
                params.extend([f'%{search}%', f'%{search}%'])

            # 원본 식자재 제외
            if ingredient_id:
                query += " AND i.id != %s"
                params.append(ingredient_id)

            # 정렬: 단위당 단가 낮은 순
            query += " ORDER BY COALESCE(i.price_per_unit, 999999) ASC, i.ingredient_name ASC"
            query += " LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            items = []
            for row in rows:
                item = dict(zip(col_names, row))
                item['lead_time_display'] = f"D-{item.get('lead_time', 2)}"
                item['can_order'] = True
                if max_lead_time and item.get('lead_time', 2) > max_lead_time:
                    item['can_order'] = False
                items.append(item)

            return {
                "success": True,
                "items": items,
                "category": category
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 발주서 변경 비교 API
# ============================================

@router.get("/api/orders/compare/{order_id}")
async def compare_order(
    order_id: int,
    site_id: Optional[int] = Query(None, description="급식사업장 ID"),
    warehouse_id: Optional[int] = Query(None, description="창고 ID")
):
    """
    기존 발주서와 현재 식단/식수 기반 필요량을 비교하여 차이 분석

    반환:
    {
        "original_order": { 발주서 정보 },
        "comparison": {
            "increased": [...],   // 수량 증가 (추가 구매 필요)
            "decreased": [...],   // 수량 감소 (참고용)
            "added": [...],       // 신규 추가 (추가 구매 필요)
            "removed": [...],     // 삭제됨 (발주 취소 검토)
            "replaced": [...]     // 식자재 교체 (확인 필요)
        },
        "summary": {
            "additional_purchase_items": 23,
            "additional_amount": 230000
        }
    }
    """
    try:
        import time
        _start_time = time.time()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 기존 발주서 조회
            cursor.execute("""
                SELECT o.*, sg.group_name AS site_name, w.name AS warehouse_name
                FROM orders o
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                LEFT JOIN warehouses w ON o.warehouse_id = w.id
                WHERE o.id = %s
            """, (order_id,))
            order_row = cursor.fetchone()

            if not order_row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            col_names = [desc[0] for desc in cursor.description]
            order = dict(zip(col_names, order_row))

            # datetime 변환
            for key, value in order.items():
                if isinstance(value, (datetime, date)):
                    order[key] = str(value)
                elif isinstance(value, Decimal):
                    order[key] = float(value)

            # 2. 기존 발주서 품목 조회 (정규화된 데이터)
            cursor.execute("""
                SELECT oi.*,
                       i.ingredient_name, i.specification AS spec, i.origin,
                       COALESCE(i.base_weight_grams, 1000) AS base_weight_grams
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE oi.order_id = %s
            """, (order_id,))
            original_items = cursor.fetchall()
            original_col_names = [desc[0] for desc in cursor.description]

            # 기존 발주 품목을 딕셔너리로 변환 (매칭 키 기준)
            original_items_map = {}
            original_items_by_menu = {}  # 메뉴별 식자재 목록 (교체 감지용)

            for row in original_items:
                item = dict(zip(original_col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)

                # 매칭 키: (ingredient_id, meal_type, menu_name, meal_category, slot_name, delivery_site_name)
                match_key = (
                    item.get("ingredient_id"),
                    item.get("meal_type"),
                    item.get("menu_name"),
                    item.get("meal_category"),
                    item.get("slot_name"),
                    item.get("delivery_site_name")
                )
                original_items_map[match_key] = item

                # 메뉴별 식자재 목록 (교체 감지용)
                menu_key = (item.get("meal_type"), item.get("menu_name"), item.get("slot_name"))
                if menu_key not in original_items_by_menu:
                    original_items_by_menu[menu_key] = set()
                original_items_by_menu[menu_key].add(item.get("ingredient_id"))

            print(f"[발주비교] 1. 기존 발주서 조회 완료: {len(original_items_map)}개 품목 ({time.time() - _start_time:.2f}초)")

            # 3. 현재 필요량 계산 (기존 calculate_order 로직 재사용)
            usage_date = order.get("usage_date")
            order_site_id = site_id or order.get("site_id")
            order_date = order.get("order_date") or str(date.today())

            if not usage_date:
                return {"success": False, "error": "발주서에 식단표 날짜(usage_date)가 없습니다."}

            # 식단표 조회
            if order_site_id:
                cursor.execute("""
                    SELECT id, plan_date, slot_name, menus, category, site_id
                    FROM meal_plans
                    WHERE plan_date = %s AND site_id = %s
                """, (usage_date, order_site_id))
            else:
                cursor.execute("""
                    SELECT id, plan_date, slot_name, menus, category, site_id
                    FROM meal_plans
                    WHERE plan_date = %s
                """, (usage_date,))
            meal_plans = cursor.fetchall()

            if not meal_plans:
                return {
                    "success": True,
                    "message": f"{usage_date}에 등록된 식단표가 없습니다.",
                    "original_order": order,
                    "comparison": {"increased": [], "decreased": [], "added": [], "removed": list(original_items_map.values()), "replaced": []},
                    "summary": {"additional_purchase_items": 0, "additional_amount": 0}
                }

            # 원본 발주서 생성일 (비교 기준)
            order_created_at = order.get("created_at")
            if order_created_at and isinstance(order_created_at, str):
                try:
                    order_created_date = datetime.strptime(order_created_at[:10], "%Y-%m-%d").date()
                except:
                    order_created_date = None
            else:
                order_created_date = None

            # 식수 조회 (납품처 단위) - 수정일 포함
            meal_counts_query = """
                SELECT
                    menu_name,
                    COALESCE(category, business_type) as category,
                    site_name,
                    meal_count,
                    COALESCE(updated_at, created_at) as last_modified
                FROM meal_counts
                WHERE work_date = %s
            """
            meal_counts_params = [usage_date]
            if order_site_id:
                meal_counts_query += " AND site_id = %s"
                meal_counts_params.append(order_site_id)
            meal_counts_query += " ORDER BY menu_name, category, site_name"
            cursor.execute(meal_counts_query, meal_counts_params)
            meal_counts_rows = cursor.fetchall()

            # 납품처 단위 식수 저장 (수정일 포함)
            meal_counts_detail = {}
            meal_counts_by_menu = {}
            meal_counts_modified = {}  # 슬롯별 최근 수정일

            for row in meal_counts_rows:
                slot_name = row[0] or ''
                category = row[1] or '운반'
                delivery_site = row[2] or '(미지정)'
                count = row[3] or 0
                last_modified = row[4] if len(row) > 4 else None

                if slot_name:
                    detail_key = (slot_name, category, delivery_site)
                    meal_counts_detail[detail_key] = meal_counts_detail.get(detail_key, 0) + count
                    meal_counts_by_menu[slot_name] = meal_counts_by_menu.get(slot_name, 0) + count

                    # 슬롯별 최근 수정일 추적
                    if last_modified:
                        if slot_name not in meal_counts_modified or (meal_counts_modified[slot_name] and last_modified > meal_counts_modified[slot_name]):
                            meal_counts_modified[slot_name] = last_modified

            print(f"[발주비교] 2. 식단/식수 조회 완료: 식단 {len(meal_plans)}개, 식수 {len(meal_counts_detail)}개 ({time.time() - _start_time:.2f}초)")

            # ★ category_slots에서 slot_name → meal_type 마스터 매핑 조회
            cursor.execute("SELECT slot_name, meal_type FROM category_slots WHERE is_active = true AND meal_type IS NOT NULL AND meal_type != ''")
            slot_meal_type_master = {row[0]: row[1] for row in cursor.fetchall()}

            # 끼니 유형 추출 함수
            def extract_meal_type_simple(text):
                if not text: return '중식'
                # ★ category_slots 마스터 설정 우선
                if text in slot_meal_type_master:
                    return slot_meal_type_master[text]
                if '조' in text or '아침' in text or '조식' in text: return '조식'
                if '중' in text or '점심' in text or '중식' in text: return '중식'
                if '석' in text or '저녁' in text or '석식' in text: return '석식'
                if '야' in text or '야식' in text: return '야식'
                return '중식'

            # ============================================
            # ★★★ 식단별 레시피 매핑 (비교 API) ★★★
            # meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 없음)
            # ============================================

            # 식단별 처리
            recipe_category_mapping = []
            for plan in meal_plans:
                plan_id, plan_date, slot_name, menus, db_category, plan_site_id = plan
                if not slot_name or not menus:
                    continue

                head_count = meal_counts_by_menu.get(slot_name, 0)
                m_type = extract_meal_type_simple(slot_name)

                # 납품처별 식수 조회
                delivery_site_counts = {}
                for (mc_slot, mc_cat, mc_site), mc_count in meal_counts_detail.items():
                    if mc_slot == slot_name:
                        delivery_site_counts[(mc_cat, mc_site)] = mc_count

                # 카테고리 결정
                if delivery_site_counts:
                    # 가장 많은 식수를 가진 카테고리
                    cat_totals = {}
                    for (cat, site), cnt in delivery_site_counts.items():
                        cat_totals[cat] = cat_totals.get(cat, 0) + cnt
                    category = max(cat_totals, key=cat_totals.get) if cat_totals else '운반'
                else:
                    category = db_category or '운반'

                # 메뉴 파싱
                if isinstance(menus, str):
                    try:
                        menus = json.loads(menus)
                    except:
                        menus = []

                if not menus:
                    continue

                for menu in menus:
                    if isinstance(menu, dict):
                        menu_id = menu.get('id')
                    elif isinstance(menu, int):
                        menu_id = menu
                    else:
                        continue

                    if menu_id:
                        if delivery_site_counts:
                            for (ds_cat, ds_site), ds_count in delivery_site_counts.items():
                                if ds_count == 0:
                                    continue
                                # ★★★ meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 제거) ★★★
                                target_recipe_id = menu_id
                                recipe_category_mapping.append({
                                    'menu_id': menu_id,
                                    'meal_type': m_type,
                                    'category': ds_cat,
                                    'slot_name': slot_name,
                                    'delivery_site': ds_site,
                                    'cat_count': ds_count,
                                    'recipe_id': target_recipe_id
                                })
                        elif head_count > 0:
                            # ★★★ meal_plan의 recipe_id를 직접 사용 (카테고리 리매핑 제거) ★★★
                            target_recipe_id = menu_id
                            recipe_category_mapping.append({
                                'menu_id': menu_id,
                                'meal_type': m_type,
                                'category': category,
                                'slot_name': slot_name,
                                'delivery_site': '(집계)',
                                'cat_count': head_count,
                                'recipe_id': target_recipe_id
                            })

            # 레시피 재료 배치 조회
            all_recipe_ids = list(set([m['recipe_id'] for m in recipe_category_mapping]))
            recipe_ingredients_map = {}

            if all_recipe_ids:
                placeholders = ','.join(['%s'] * len(all_recipe_ids))
                # ★ base_name 우선 사용 (사이트 접두사 없는 정규 메뉴명)
                cursor.execute(f"""
                    SELECT mr.id AS recipe_id,
                           CASE WHEN COALESCE(mr.suffix, '') != ''
                                THEN COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) || '-' || mr.suffix
                                ELSE COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name)
                           END AS menu_name,
                           mri.ingredient_code,
                           mri.ingredient_name AS mri_ingredient_name,
                           mri.specification AS mri_specification,
                           mri.supplier_name AS mri_supplier_name,
                           mri.quantity AS per_person_qty,
                           mri.unit AS mri_unit,
                           mri.required_grams,
                           i.id AS ingredient_id,
                           i.ingredient_name,
                           i.category,
                           i.supplier_name,
                           i.origin,
                           i.specification,
                           i.unit,
                           i.purchase_price,
                           i.delivery_days,
                           COALESCE(i.base_weight_grams, 1000) AS base_weight_grams
                    FROM menu_recipes mr
                    JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                    LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                    WHERE mr.id IN ({placeholders})
                """, all_recipe_ids)

                for row in cursor.fetchall():
                    recipe_id = row[0]
                    if recipe_id not in recipe_ingredients_map:
                        recipe_ingredients_map[recipe_id] = []
                    recipe_ingredients_map[recipe_id].append(row[1:])

            print(f"[발주비교] 3. 레시피 재료 조회 완료: {len(recipe_ingredients_map)}개 레시피 ({time.time() - _start_time:.2f}초)")

            # 현재 필요량 계산
            current_items_map = {}
            current_items_by_menu = {}  # 메뉴별 식자재 목록 (교체 감지용)

            for mapping in recipe_category_mapping:
                menu_id = mapping['menu_id']
                meal_type = mapping['meal_type']
                cat = mapping['category']
                slot_name = mapping.get('slot_name', '')
                delivery_site = mapping.get('delivery_site', '(집계)')
                site_head_count = mapping['cat_count']
                recipe_id = mapping['recipe_id']

                recipe_ingredients = recipe_ingredients_map.get(recipe_id, [])

                for ri in recipe_ingredients:
                    # required_grams 컬럼 추가됨 (쿼리 순서: menu_name, ingredient_code, mri_ing_name, mri_spec, mri_supplier, per_person_qty, mri_unit, required_grams, ingredient_id, ...)
                    (menu_name, ingredient_code, mri_ing_name, mri_spec, mri_supplier,
                     per_person_qty, mri_unit, required_grams, ingredient_id, ing_name, ing_category,
                     supplier_name, origin, specification, ing_unit, price, delivery_days,
                     base_weight_grams) = ri

                    if not per_person_qty and not required_grams:
                        continue

                    final_ing_name = mri_ing_name or ing_name or ingredient_code
                    final_spec = mri_spec or specification or ''
                    final_supplier = mri_supplier or supplier_name or ''
                    final_unit = mri_unit or ing_unit or ''
                    final_price = float(price or 0)

                    # ★★★ required_grams 직접 사용 (역산 금지) ★★★
                    per_person_qty_g = float(required_grams or 0)

                    required_qty = (per_person_qty_g / 1000) * int(site_head_count or 0)

                    match_key = (
                        ingredient_id,
                        meal_type,
                        menu_name,
                        cat,
                        slot_name,
                        delivery_site
                    )

                    if match_key not in current_items_map:
                        current_items_map[match_key] = {
                            "ingredient_id": ingredient_id,
                            "ingredient_code": ingredient_code,
                            "ingredient_name": final_ing_name,
                            "specification": final_spec,
                            "supplier_name": final_supplier,
                            "unit": final_unit,
                            "unit_price": final_price,
                            "required_qty": 0,
                            "meal_count": 0,
                            "meal_type": meal_type,
                            "meal_category": cat,
                            "menu_name": menu_name,
                            "slot_name": slot_name,
                            "delivery_site_name": delivery_site,
                            "delivery_days": int(re.search(r'\d+', str(delivery_days)).group()) if delivery_days and re.search(r'\d+', str(delivery_days)) else 2
                        }

                    current_items_map[match_key]["required_qty"] += required_qty
                    current_items_map[match_key]["meal_count"] += int(site_head_count or 0)

                    # 메뉴별 식자재 목록 (교체 감지용)
                    menu_key = (meal_type, menu_name, slot_name)
                    if menu_key not in current_items_by_menu:
                        current_items_by_menu[menu_key] = set()
                    current_items_by_menu[menu_key].add(ingredient_id)

            print(f"[발주비교] 4. 현재 필요량 계산 완료: {len(current_items_map)}개 품목 ({time.time() - _start_time:.2f}초)")

            # 4. 비교 분석
            comparison = {
                "increased": [],   # 수량 증가
                "decreased": [],   # 수량 감소
                "added": [],       # 신규 추가
                "removed": [],     # 삭제됨
                "replaced": []     # 교체됨
            }

            # 리드타임 계산 함수
            def calculate_lead_time_info(delivery_days, usage_date_str):
                """리드타임 초과 여부 및 발주 마감일 계산"""
                today = date.today()
                delivery_days = int(re.search(r'\d+', str(delivery_days)).group()) if delivery_days and re.search(r'\d+', str(delivery_days)) else 2

                # usage_date 파싱
                if isinstance(usage_date_str, str):
                    try:
                        usage_dt = datetime.strptime(usage_date_str[:10], "%Y-%m-%d").date()
                    except:
                        usage_dt = today
                elif isinstance(usage_date_str, date):
                    usage_dt = usage_date_str
                else:
                    usage_dt = today

                # 발주 마감일 = 사용일 - 리드타임
                required_order_date = usage_dt - timedelta(days=delivery_days)
                lead_time_exceeded = today > required_order_date

                return {
                    "delivery_days": delivery_days,
                    "required_order_date": str(required_order_date),
                    "lead_time_exceeded": lead_time_exceeded
                }

            # 교체 감지를 위한 처리
            replaced_ingredients = set()  # 교체된 것으로 분류된 식자재 ID

            # 메뉴별 식자재 변경 확인 (교체 감지)
            for menu_key in set(list(original_items_by_menu.keys()) + list(current_items_by_menu.keys())):
                orig_ings = original_items_by_menu.get(menu_key, set())
                curr_ings = current_items_by_menu.get(menu_key, set())

                # 같은 메뉴에서 식자재가 변경된 경우
                removed_from_menu = orig_ings - curr_ings
                added_to_menu = curr_ings - orig_ings

                # 하나가 빠지고 하나가 추가된 경우 교체로 간주
                if len(removed_from_menu) == 1 and len(added_to_menu) == 1:
                    replaced_ingredients.add(list(removed_from_menu)[0])
                    replaced_ingredients.add(list(added_to_menu)[0])

            # 변경 원인 분석 함수
            def analyze_change_reason(orig_item, curr_item, diff_qty):
                """변경 원인을 분석하여 reason 문자열 생성 (수정일 포함)"""
                reasons = []
                slot_name = orig_item.get("slot_name") or curr_item.get("slot_name") or ""
                delivery_site = orig_item.get("delivery_site_name") or curr_item.get("delivery_site_name") or ""
                menu_name = orig_item.get("menu_name") or curr_item.get("menu_name") or ""

                orig_meal = int(orig_item.get("meal_count") or 0) if orig_item else 0
                curr_meal = int(curr_item.get("meal_count") or 0) if curr_item else 0
                meal_diff = curr_meal - orig_meal

                # 위치 정보
                location_parts = []
                if slot_name:
                    location_parts.append(f"[{slot_name}]")
                if delivery_site and delivery_site != '(집계)':
                    location_parts.append(f"{delivery_site}")
                location_str = " ".join(location_parts)

                # 식수 변동 확인
                if meal_diff != 0:
                    if meal_diff > 0:
                        reasons.append(f"식수 증가 ({orig_meal}→{curr_meal}명, +{meal_diff})")
                    else:
                        reasons.append(f"식수 감소 ({orig_meal}→{curr_meal}명, {meal_diff})")

                # 인당량 변동 확인 (같은 식수에서 발주량이 변경된 경우)
                if meal_diff == 0 and abs(diff_qty) >= 0.01:
                    reasons.append("레시피 인당량 변경")

                # 수정일 정보 추가
                modified_date_str = ""
                if slot_name and slot_name in meal_counts_modified:
                    mod_dt = meal_counts_modified[slot_name]
                    if mod_dt:
                        mod_date_only = None
                        if isinstance(mod_dt, datetime):
                            modified_date_str = mod_dt.strftime("%m/%d %H:%M")
                            mod_date_only = mod_dt.date()
                        elif isinstance(mod_dt, date):
                            modified_date_str = mod_dt.strftime("%m/%d")
                            mod_date_only = mod_dt
                        elif isinstance(mod_dt, str):
                            # 문자열인 경우 파싱 시도 (예: "2026-01-19 14:30:00")
                            try:
                                if len(mod_dt) >= 16:
                                    parsed_dt = datetime.strptime(mod_dt[:19], "%Y-%m-%d %H:%M:%S")
                                    modified_date_str = parsed_dt.strftime("%m/%d %H:%M")
                                    mod_date_only = parsed_dt.date()
                                elif len(mod_dt) >= 10:
                                    parsed_dt = datetime.strptime(mod_dt[:10], "%Y-%m-%d")
                                    modified_date_str = parsed_dt.strftime("%m/%d")
                                    mod_date_only = parsed_dt.date()
                            except:
                                modified_date_str = str(mod_dt)[:16].replace("T", " ")

                        # 발주서 생성 이후 변경인지 확인
                        if order_created_date and mod_date_only:
                            if isinstance(mod_date_only, date) and mod_date_only > order_created_date:
                                modified_date_str = f"⚡{modified_date_str}"  # 발주 후 변경 표시

                # 위치 정보 + 변경 원인 + 수정일
                result_parts = []
                if location_str:
                    result_parts.append(location_str)
                if reasons:
                    result_parts.append(" / ".join(reasons))
                if modified_date_str:
                    result_parts.append(f"({modified_date_str})")

                return " ".join(result_parts) if result_parts else "변경"

            # 기존 발주 품목 순회
            processed_current_keys = set()
            for match_key, orig_item in original_items_map.items():
                if match_key in current_items_map:
                    processed_current_keys.add(match_key)
                    curr_item = current_items_map[match_key]

                    orig_qty = float(orig_item.get("order_qty") or orig_item.get("required_qty") or 0)
                    curr_qty = float(curr_item.get("required_qty") or 0)
                    diff_qty = curr_qty - orig_qty

                    if abs(diff_qty) < 0.01:  # 변경 없음
                        continue

                    # 변경 원인 분석
                    reason = analyze_change_reason(orig_item, curr_item, diff_qty)

                    # 리드타임 정보 계산
                    lead_time_info = calculate_lead_time_info(
                        curr_item.get("delivery_days") or orig_item.get("delivery_days") or 2,
                        usage_date
                    )

                    diff_item = {
                        "ingredient_id": orig_item.get("ingredient_id"),
                        "ingredient_code": orig_item.get("ingredient_code"),
                        "ingredient_name": orig_item.get("ingredient_name"),
                        "specification": orig_item.get("specification"),
                        "supplier_name": orig_item.get("supplier_name"),
                        "unit": orig_item.get("unit") or "kg",
                        "unit_price": float(orig_item.get("unit_price") or 0),
                        "original_qty": round(orig_qty, 2),
                        "current_qty": round(curr_qty, 2),
                        "diff_qty": round(diff_qty, 2),
                        "diff_amount": round(diff_qty * float(orig_item.get("unit_price") or 0), 2),
                        "meal_type": orig_item.get("meal_type"),
                        "meal_category": orig_item.get("meal_category"),
                        "menu_name": orig_item.get("menu_name"),
                        "slot_name": orig_item.get("slot_name"),
                        "delivery_site_name": orig_item.get("delivery_site_name"),
                        "original_meal_count": orig_item.get("meal_count"),
                        "current_meal_count": curr_item.get("meal_count"),
                        "reason": reason,
                        "delivery_days": lead_time_info["delivery_days"],
                        "required_order_date": lead_time_info["required_order_date"],
                        "lead_time_exceeded": lead_time_info["lead_time_exceeded"]
                    }

                    if diff_qty > 0:
                        comparison["increased"].append(diff_item)
                    else:
                        comparison["decreased"].append(diff_item)
                else:
                    # 현재 필요량에 없음 = 삭제됨
                    orig_qty = float(orig_item.get("order_qty") or orig_item.get("required_qty") or 0)
                    slot_name = orig_item.get("slot_name") or ""
                    delivery_site = orig_item.get("delivery_site_name") or ""
                    menu_name = orig_item.get("menu_name") or ""

                    # 삭제 원인 분석
                    location_parts = []
                    if slot_name:
                        location_parts.append(f"[{slot_name}]")
                    if delivery_site and delivery_site != '(집계)':
                        location_parts.append(f"{delivery_site}")
                    location_str = " ".join(location_parts)

                    # 수정일 정보 (시간 포함)
                    modified_date_str = ""
                    if slot_name and slot_name in meal_counts_modified:
                        mod_dt = meal_counts_modified[slot_name]
                        if mod_dt:
                            mod_date_only = None
                            if isinstance(mod_dt, datetime):
                                modified_date_str = mod_dt.strftime("%m/%d %H:%M")
                                mod_date_only = mod_dt.date()
                            elif isinstance(mod_dt, date):
                                modified_date_str = mod_dt.strftime("%m/%d")
                                mod_date_only = mod_dt
                            elif isinstance(mod_dt, str):
                                try:
                                    if len(mod_dt) >= 16:
                                        parsed_dt = datetime.strptime(mod_dt[:19], "%Y-%m-%d %H:%M:%S")
                                        modified_date_str = parsed_dt.strftime("%m/%d %H:%M")
                                        mod_date_only = parsed_dt.date()
                                    elif len(mod_dt) >= 10:
                                        parsed_dt = datetime.strptime(mod_dt[:10], "%Y-%m-%d")
                                        modified_date_str = parsed_dt.strftime("%m/%d")
                                        mod_date_only = parsed_dt.date()
                                except:
                                    modified_date_str = str(mod_dt)[:16].replace("T", " ")
                            if order_created_date and mod_date_only:
                                if isinstance(mod_date_only, date) and mod_date_only > order_created_date:
                                    modified_date_str = f"⚡{modified_date_str}"

                    # 교체된 경우와 삭제된 경우 구분
                    if orig_item.get("ingredient_id") in replaced_ingredients:
                        base_reason = f"{location_str} 식자재 교체 (→ 다른 식자재로 변경)" if location_str else "식자재 교체"
                    else:
                        base_reason = f"{location_str} 식자재 삭제 (레시피에서 제외)" if location_str else "식자재 삭제"
                    reason = f"{base_reason} ({modified_date_str})" if modified_date_str else base_reason

                    removed_item = {
                        "ingredient_id": orig_item.get("ingredient_id"),
                        "ingredient_code": orig_item.get("ingredient_code"),
                        "ingredient_name": orig_item.get("ingredient_name"),
                        "specification": orig_item.get("specification"),
                        "supplier_name": orig_item.get("supplier_name"),
                        "unit": orig_item.get("unit") or "kg",
                        "unit_price": float(orig_item.get("unit_price") or 0),
                        "original_qty": round(orig_qty, 2),
                        "current_qty": 0,
                        "diff_qty": round(-orig_qty, 2),
                        "diff_amount": round(-orig_qty * float(orig_item.get("unit_price") or 0), 2),
                        "meal_type": orig_item.get("meal_type"),
                        "meal_category": orig_item.get("meal_category"),
                        "menu_name": orig_item.get("menu_name"),
                        "slot_name": orig_item.get("slot_name"),
                        "delivery_site_name": orig_item.get("delivery_site_name"),
                        "reason": reason
                    }

                    if orig_item.get("ingredient_id") in replaced_ingredients:
                        comparison["replaced"].append(removed_item)
                    else:
                        comparison["removed"].append(removed_item)

            # 신규 추가 품목
            for match_key, curr_item in current_items_map.items():
                if match_key not in processed_current_keys and match_key not in original_items_map:
                    curr_qty = float(curr_item.get("required_qty") or 0)
                    if curr_qty < 0.01:
                        continue

                    slot_name = curr_item.get("slot_name") or ""
                    delivery_site = curr_item.get("delivery_site_name") or ""
                    menu_name = curr_item.get("menu_name") or ""

                    # 추가 원인 분석
                    location_parts = []
                    if slot_name:
                        location_parts.append(f"[{slot_name}]")
                    if delivery_site and delivery_site != '(집계)':
                        location_parts.append(f"{delivery_site}")
                    location_str = " ".join(location_parts)

                    # 수정일 정보 (시간 포함)
                    modified_date_str = ""
                    if slot_name and slot_name in meal_counts_modified:
                        mod_dt = meal_counts_modified[slot_name]
                        if mod_dt:
                            mod_date_only = None
                            if isinstance(mod_dt, datetime):
                                modified_date_str = mod_dt.strftime("%m/%d %H:%M")
                                mod_date_only = mod_dt.date()
                            elif isinstance(mod_dt, date):
                                modified_date_str = mod_dt.strftime("%m/%d")
                                mod_date_only = mod_dt
                            elif isinstance(mod_dt, str):
                                try:
                                    if len(mod_dt) >= 16:
                                        parsed_dt = datetime.strptime(mod_dt[:19], "%Y-%m-%d %H:%M:%S")
                                        modified_date_str = parsed_dt.strftime("%m/%d %H:%M")
                                        mod_date_only = parsed_dt.date()
                                    elif len(mod_dt) >= 10:
                                        parsed_dt = datetime.strptime(mod_dt[:10], "%Y-%m-%d")
                                        modified_date_str = parsed_dt.strftime("%m/%d")
                                        mod_date_only = parsed_dt.date()
                                except:
                                    modified_date_str = str(mod_dt)[:16].replace("T", " ")
                            if order_created_date and mod_date_only:
                                if isinstance(mod_date_only, date) and mod_date_only > order_created_date:
                                    modified_date_str = f"⚡{modified_date_str}"

                    # 교체된 경우와 추가된 경우 구분
                    if curr_item.get("ingredient_id") in replaced_ingredients:
                        base_reason = f"{location_str} 식자재 교체 (← 기존 식자재 대체)" if location_str else "식자재 교체"
                    else:
                        base_reason = f"{location_str} 신규 추가 (레시피에 추가됨)" if location_str else "신규 추가"
                    reason = f"{base_reason} ({modified_date_str})" if modified_date_str else base_reason

                    # 리드타임 정보 계산
                    lead_time_info = calculate_lead_time_info(
                        curr_item.get("delivery_days") or 2,
                        usage_date
                    )

                    added_item = {
                        "ingredient_id": curr_item.get("ingredient_id"),
                        "ingredient_code": curr_item.get("ingredient_code"),
                        "ingredient_name": curr_item.get("ingredient_name"),
                        "specification": curr_item.get("specification"),
                        "supplier_name": curr_item.get("supplier_name"),
                        "unit": curr_item.get("unit") or "kg",
                        "unit_price": float(curr_item.get("unit_price") or 0),
                        "original_qty": 0,
                        "current_qty": round(curr_qty, 2),
                        "diff_qty": round(curr_qty, 2),
                        "diff_amount": round(curr_qty * float(curr_item.get("unit_price") or 0), 2),
                        "meal_type": curr_item.get("meal_type"),
                        "meal_category": curr_item.get("meal_category"),
                        "menu_name": curr_item.get("menu_name"),
                        "slot_name": curr_item.get("slot_name"),
                        "delivery_site_name": curr_item.get("delivery_site_name"),
                        "meal_count": curr_item.get("meal_count"),
                        "reason": reason,
                        "delivery_days": lead_time_info["delivery_days"],
                        "required_order_date": lead_time_info["required_order_date"],
                        "lead_time_exceeded": lead_time_info["lead_time_exceeded"]
                    }

                    if curr_item.get("ingredient_id") in replaced_ingredients:
                        comparison["replaced"].append(added_item)
                    else:
                        comparison["added"].append(added_item)

            # 5. 요약 계산
            additional_items = comparison["increased"] + comparison["added"]
            additional_purchase_items = len(additional_items)
            additional_amount = sum(item["diff_amount"] for item in additional_items if item["diff_amount"] > 0)

            decrease_items = comparison["decreased"] + comparison["removed"]
            decrease_amount = sum(abs(item["diff_amount"]) for item in decrease_items)

            net_change = additional_amount - decrease_amount

            summary = {
                "increased_count": len(comparison["increased"]),
                "decreased_count": len(comparison["decreased"]),
                "added_count": len(comparison["added"]),
                "removed_count": len(comparison["removed"]),
                "replaced_count": len(comparison["replaced"]),
                "additional_purchase_items": additional_purchase_items,
                "additional_amount": round(additional_amount, 2),
                "decrease_amount": round(decrease_amount, 2),
                "net_change": round(net_change, 2)
            }

            print(f"[발주비교] 5. 비교 완료: 증가 {summary['increased_count']}, 감소 {summary['decreased_count']}, 추가 {summary['added_count']}, 삭제 {summary['removed_count']}, 교체 {summary['replaced_count']} ({time.time() - _start_time:.2f}초)")

            return {
                "success": True,
                "original_order": order,
                "comparison": comparison,
                "summary": summary
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 추가발주 이력 조회 API
# ============================================

@router.get("/api/orders/{order_id}/additional-orders")
async def get_additional_orders(order_id: int):
    """
    특정 발주서의 추가발주 이력 조회

    반환:
    {
        "success": true,
        "parent_order": { 원본 발주서 정보 },
        "additional_orders": [
            { 추가발주서 정보 1 },
            { 추가발주서 정보 2 }
        ],
        "total_additional_count": 2
    }
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 원본 발주서 조회
            cursor.execute("""
                SELECT id, order_number, usage_date, order_date, status, order_type,
                       total_amount, created_at, parent_order_id
                FROM orders
                WHERE id = %s
            """, (order_id,))
            parent_row = cursor.fetchone()

            if not parent_row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            col_names = ['id', 'order_number', 'usage_date', 'order_date', 'status',
                         'order_type', 'total_amount', 'created_at', 'parent_order_id']
            parent_order = dict(zip(col_names, parent_row))

            # datetime 변환
            for key, value in parent_order.items():
                if isinstance(value, (datetime, date)):
                    parent_order[key] = str(value)
                elif isinstance(value, Decimal):
                    parent_order[key] = float(value)

            # 추가발주서 조회 (이 발주서를 parent로 참조하는 발주서들)
            cursor.execute("""
                SELECT o.id, o.order_number, o.usage_date, o.order_date, o.status,
                       o.order_type, o.total_amount, o.created_at, o.notes,
                       COUNT(oi.id) as item_count,
                       COALESCE(SUM(oi.total_price), 0) as items_total
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                WHERE o.parent_order_id = %s
                GROUP BY o.id, o.order_number, o.usage_date, o.order_date, o.status,
                         o.order_type, o.total_amount, o.created_at, o.notes
                ORDER BY o.created_at ASC
            """, (order_id,))

            additional_rows = cursor.fetchall()
            add_col_names = ['id', 'order_number', 'usage_date', 'order_date', 'status',
                            'order_type', 'total_amount', 'created_at', 'notes',
                            'item_count', 'items_total']

            additional_orders = []
            for row in additional_rows:
                add_order = dict(zip(add_col_names, row))
                for key, value in add_order.items():
                    if isinstance(value, (datetime, date)):
                        add_order[key] = str(value)
                    elif isinstance(value, Decimal):
                        add_order[key] = float(value)
                additional_orders.append(add_order)


            return {
                "success": True,
                "parent_order": parent_order,
                "additional_orders": additional_orders,
                "total_additional_count": len(additional_orders)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
