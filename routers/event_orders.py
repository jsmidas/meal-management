#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
행사 발주 관리 API
템플릿 기반 행사 발주 전용 API 엔드포인트
"""

from fastapi import APIRouter, Request, Query
from core.database import get_db_connection
from datetime import date, datetime
from typing import Optional
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def init_event_orders_tables():
    """테이블 컬럼 초기화 (마이그레이션)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # orders 테이블에 event_id, template_id 컬럼 추가
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_id INTEGER
            """)
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS template_id INTEGER
            """)
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'regular'
            """)
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS attendees INTEGER
            """)
            # 합산 이력 컬럼
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS merged_into VARCHAR(50)
            """)
            cursor.execute("""
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP
            """)

            conn.commit()
            logger.info("[event_orders] 테이블 초기화 완료")
    except Exception as e:
        logger.error(f"[event_orders] 테이블 초기화 오류: {e}")


# 초기화 실행
init_event_orders_tables()


# =====================
# 발주량 계산 API
# =====================

@router.post("/api/event-orders/calculate")
async def calculate_event_order(request: Request):
    """
    템플릿 + 인원수 기반 발주량 계산

    요청:
    {
        "template_id": 1,
        "attendees": 100,
        "usage_date": "2026-01-25"
    }

    응답:
    {
        "success": true,
        "template_name": "프리미엄 뷔페",
        "menus": [...],
        "total_amount": 2500000
    }
    """
    try:
        data = await request.json()
        template_id = data.get('template_id')
        attendees = int(data.get('attendees', 0))
        usage_date = data.get('usage_date')

        if not template_id:
            return {"success": False, "error": "템플릿을 선택하세요."}
        if not attendees or attendees <= 0:
            return {"success": False, "error": "인원수를 입력하세요."}
        if not usage_date:
            return {"success": False, "error": "행사일(사용일)을 입력하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 템플릿 정보 조회
            cursor.execute("""
                SELECT id, name, category, category_name, selling_price, base_serving
                FROM event_templates
                WHERE id = %s
            """, (template_id,))

            template_row = cursor.fetchone()
            if not template_row:
                return {"success": False, "error": "템플릿을 찾을 수 없습니다."}

            template_info = {
                "id": template_row[0],
                "name": template_row[1],
                "category": template_row[2],
                "category_name": template_row[3],
                "selling_price": float(template_row[4]) if template_row[4] else 0,
                "base_serving": int(template_row[5]) if template_row[5] else 1
            }

            # 2. 템플릿 메뉴 조회
            cursor.execute("""
                SELECT id, menu_id, menu_name, quantity, unit, unit_price, notes, sort_order
                FROM event_template_menus
                WHERE template_id = %s
                ORDER BY sort_order, id
            """, (template_id,))

            menu_rows = cursor.fetchall()
            menu_ids = [row[0] for row in menu_rows]

            # 3. 모든 메뉴의 식자재를 한 번에 조회 (N+1 방지)
            all_ingredients = {}
            if menu_ids:
                menu_placeholders = ','.join(['%s'] * len(menu_ids))
                cursor.execute(f"""
                    SELECT
                        etmi.template_menu_id,
                        etmi.id,
                        etmi.ingredient_code,
                        etmi.ingredient_name,
                        etmi.specification,
                        etmi.unit,
                        etmi.selling_price,
                        etmi.quantity,
                        etmi.amount,
                        etmi.required_grams,
                        etmi.supplier_name,
                        i.price_per_unit,
                        COALESCE(i.base_weight_grams, 1000) as base_weight_grams
                    FROM event_template_menu_ingredients etmi
                    LEFT JOIN ingredients i ON etmi.ingredient_code = i.ingredient_code
                    WHERE etmi.template_menu_id IN ({menu_placeholders})
                    ORDER BY etmi.template_menu_id, etmi.sort_order, etmi.id
                """, menu_ids)

                for ing_row in cursor.fetchall():
                    tmid = ing_row[0]
                    if tmid not in all_ingredients:
                        all_ingredients[tmid] = []
                    all_ingredients[tmid].append(ing_row[1:])  # template_menu_id 제외

            menus = []
            total_amount = 0

            for menu_row in menu_rows:
                template_menu_id = menu_row[0]
                menu_obj = {
                    "template_menu_id": template_menu_id,
                    "menu_id": menu_row[1],
                    "menu_name": menu_row[2],
                    "quantity": float(menu_row[3]) if menu_row[3] else 1,
                    "unit": menu_row[4] or '인분',
                    "unit_price": float(menu_row[5]) if menu_row[5] else 0,
                    "notes": menu_row[6],
                    "sort_order": menu_row[7],
                    "ingredients": []
                }

                menu_total = 0
                for ing_row in all_ingredients.get(template_menu_id, []):
                    base_qty = float(ing_row[6]) if ing_row[6] else 0
                    unit_price = float(ing_row[5]) if ing_row[5] else 0
                    base_weight_grams = float(ing_row[11]) if ing_row[11] else 1000

                    required_qty = base_qty * attendees
                    item_total = unit_price * required_qty

                    ingredient_obj = {
                        "id": ing_row[0],
                        "ingredient_code": ing_row[1],
                        "ingredient_name": ing_row[2],
                        "specification": ing_row[3] or '',
                        "unit": ing_row[4] or '',
                        "unit_price": unit_price,
                        "base_qty": base_qty,
                        "required_qty": round(required_qty, 4),
                        "total_price": round(item_total, 0),
                        "supplier_name": ing_row[9] or '',
                        "price_per_unit": float(ing_row[10]) if ing_row[10] else 0,
                        "base_weight_grams": base_weight_grams,
                        "can_edit": True
                    }
                    menu_obj["ingredients"].append(ingredient_obj)
                    menu_total += item_total

                menu_obj["menu_total"] = round(menu_total, 0)
                total_amount += menu_total
                menus.append(menu_obj)


            return {
                "success": True,
                "template_id": template_id,
                "template_name": template_info["name"],
                "category": template_info["category"],
                "category_name": template_info["category_name"],
                "attendees": attendees,
                "usage_date": usage_date,
                "menus": menus,
                "total_amount": round(total_amount, 0)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 생성 API
# =====================

@router.post("/api/event-orders")
async def create_event_order(request: Request):
    """
    행사 발주서 생성

    요청:
    {
        "template_id": 1,
        "attendees": 100,
        "usage_date": "2026-01-25",
        "order_date": "2026-01-23",
        "menus": [...],  # 수정된 식자재 목록
        "notes": ""
    }
    """
    try:
        data = await request.json()
        template_id = data.get('template_id')
        attendees = int(data.get('attendees', 0))
        usage_date = data.get('usage_date')
        order_date = data.get('order_date', str(date.today()))
        menus = data.get('menus', [])
        notes = data.get('notes', '')
        site_id = data.get('site_id')

        if not template_id:
            return {"success": False, "error": "템플릿을 선택하세요."}
        if not attendees or attendees <= 0:
            return {"success": False, "error": "인원수를 입력하세요."}
        if not usage_date:
            return {"success": False, "error": "행사일(사용일)을 입력하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 템플릿 정보 조회
            cursor.execute("""
                SELECT name FROM event_templates WHERE id = %s
            """, (template_id,))
            template_row = cursor.fetchone()
            template_name = template_row[0] if template_row else '(알 수 없음)'

            # 2+3. 발주번호 생성 + 발주서 생성 (원자적 처리 - 동시성 안전)
            order_date_str = order_date.replace('-', '')[:8]
            cursor.execute("""
                INSERT INTO orders (
                    order_number, order_date, usage_date, status,
                    order_type, template_id, attendees, notes, site_id, created_at
                )
                SELECT
                    %s || '-' || LPAD(
                        (COALESCE(MAX(CAST(SUBSTRING(o2.order_number FROM 10) AS INTEGER)), 0) + 1)::TEXT,
                        4, '0'
                    ),
                    %s, %s, 'pending', 'event', %s, %s, %s, %s, NOW()
                FROM orders o2
                WHERE o2.order_number LIKE %s
                RETURNING id, order_number
            """, (order_date_str, order_date, usage_date, template_id, attendees, notes, site_id, f"{order_date_str}-%"))

            result_row = cursor.fetchone()
            if not result_row:
                return {"success": False, "error": "발주서 생성 실패"}
            order_id = result_row[0]
            order_number = result_row[1]
            logger.info(f"[행사발주] 생성: {order_number}, 템플릿={template_name}, 인원={attendees}, 사업장={site_id}")

            # 4. order_items 테이블에 식자재 저장
            total_amount = 0
            for menu in menus:
                menu_name = menu.get('menu_name', '')
                for ing in menu.get('ingredients', []):
                    ingredient_code = ing.get('ingredient_code')
                    if not ingredient_code:
                        continue  # 식자재코드 없으면 건너뛰기

                    ingredient_name = ing.get('ingredient_name', '')
                    unit = ing.get('unit', '')
                    unit_price = float(ing.get('unit_price', 0) or 0)
                    required_qty = float(ing.get('required_qty', 0) or 0)
                    total_price = float(ing.get('total_price', 0) or 0)
                    supplier_name = ing.get('supplier_name', '')
                    specification = ing.get('specification', '')

                    if required_qty <= 0:
                        continue  # 수량 0이면 건너뛰기

                    # ingredient_id 조회
                    cursor.execute("""
                        SELECT id FROM ingredients WHERE ingredient_code = %s LIMIT 1
                    """, (ingredient_code,))
                    ing_row = cursor.fetchone()
                    ingredient_id = ing_row[0] if ing_row else None

                    cursor.execute("""
                        INSERT INTO order_items (
                            order_id, ingredient_id, ingredient_code, ingredient_name,
                            unit, unit_price, required_qty, order_qty, total_price,
                            supplier_name, specification, menu_name
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        order_id, ingredient_id, ingredient_code, ingredient_name,
                        unit, unit_price, required_qty, required_qty, total_price,
                        supplier_name, specification, menu_name
                    ))

                    total_amount += total_price

            # 5. 발주서 총액 업데이트
            cursor.execute("""
                UPDATE orders SET total_amount = %s WHERE id = %s
            """, (total_amount, order_id))

            conn.commit()

            return {
                "success": True,
                "message": f"행사 발주서가 생성되었습니다. (발주번호: {order_number})",
                "order_id": order_id,
                "order_number": order_number,
                "total_amount": round(total_amount, 0)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 합산 대상 발주서 조회 API (반드시 {order_id} 라우트보다 위에 위치)
# =====================

@router.get("/api/event-orders/check-merge")
async def check_merge_orders(
    order_date: str,
    site_id: int,
    exclude_type: Optional[str] = None
):
    """같은 입고일+사업장에 기존 발주서가 있는지 확인"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    o.id, o.order_number, o.order_type, o.status,
                    o.total_amount, o.attendees, o.usage_date,
                    et.name as template_name,
                    COUNT(oi.id) as item_count
                FROM orders o
                LEFT JOIN event_templates et ON o.template_id = et.id
                LEFT JOIN order_items oi ON oi.order_id = o.id
                WHERE o.order_date = %s
                  AND o.site_id = %s
                  AND o.status != 'cancelled'
                  AND o.merged_into IS NULL
            """
            params = [order_date, site_id]

            if exclude_type:
                query += " AND o.order_type != %s"
                params.append(exclude_type)

            query += " GROUP BY o.id, o.order_number, o.order_type, o.status, o.total_amount, o.attendees, o.usage_date, et.name"
            query += " ORDER BY o.created_at DESC"

            cursor.execute(query, params)

            orders = []
            for row in cursor.fetchall():
                orders.append({
                    "id": row[0], "order_number": row[1], "order_type": row[2],
                    "status": row[3], "total_amount": float(row[4]) if row[4] else 0,
                    "attendees": row[5], "usage_date": str(row[6]) if row[6] else None,
                    "template_name": row[7], "item_count": row[8]
                })

            if not orders:
                return {"success": True, "has_merge_target": False, "orders": []}

            # 상세 항목 조회
            order_ids = [o["id"] for o in orders]
            placeholders = ','.join(['%s'] * len(order_ids))
            cursor.execute(f"""
                SELECT oi.order_id, oi.ingredient_code, oi.ingredient_name,
                    oi.specification, oi.unit, oi.unit_price,
                    oi.required_qty, oi.order_qty, oi.total_price,
                    oi.supplier_name, oi.menu_name
                FROM order_items oi WHERE oi.order_id IN ({placeholders})
                ORDER BY oi.order_id, oi.id
            """, order_ids)

            items_by_order = {}
            for row in cursor.fetchall():
                oid = row[0]
                if oid not in items_by_order:
                    items_by_order[oid] = []
                items_by_order[oid].append({
                    "ingredient_code": row[1], "ingredient_name": row[2],
                    "specification": row[3], "unit": row[4],
                    "unit_price": float(row[5]) if row[5] else 0,
                    "required_qty": float(row[6]) if row[6] else 0,
                    "order_qty": float(row[7]) if row[7] else 0,
                    "total_price": float(row[8]) if row[8] else 0,
                    "supplier_name": row[9], "menu_name": row[10]
                })

            for order in orders:
                order["items"] = items_by_order.get(order["id"], [])

            return {"success": True, "has_merge_target": True, "orders": orders, "total_orders": len(orders)}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/event-orders/instructions")
async def get_event_instructions(
    usage_date: str,
    site_id: Optional[int] = None
):
    """
    행사 발주서 기반 지시서 데이터 반환
    같은 행사일(usage_date)의 확정/대기 행사 발주서에서 메뉴별 식자재 정보 제공
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    o.id, o.order_number, o.attendees, o.usage_date,
                    o.template_id, et.name as template_name,
                    o.site_id, sg.group_name as site_name
                FROM orders o
                LEFT JOIN event_templates et ON o.template_id = et.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE o.order_type = 'event'
                  AND o.usage_date = %s
                  AND o.status != 'cancelled'
                  AND o.merged_into IS NULL
            """
            params = [usage_date]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            query += " ORDER BY o.created_at DESC"
            cursor.execute(query, params)

            orders = []
            order_ids = []
            for row in cursor.fetchall():
                orders.append({
                    "id": row[0], "order_number": row[1],
                    "attendees": row[2], "usage_date": str(row[3]) if row[3] else None,
                    "template_id": row[4], "template_name": row[5],
                    "site_id": row[6], "site_name": row[7],
                    "menus": []
                })
                order_ids.append(row[0])

            if not order_ids:
                return {"success": True, "has_events": False, "orders": []}

            # 발주 항목을 메뉴별로 그룹화
            placeholders = ','.join(['%s'] * len(order_ids))
            cursor.execute(f"""
                SELECT
                    oi.order_id, oi.menu_name,
                    oi.ingredient_code, oi.ingredient_name,
                    oi.specification, oi.unit, oi.unit_price,
                    oi.required_qty, oi.order_qty, oi.total_price,
                    oi.supplier_name
                FROM order_items oi
                WHERE oi.order_id IN ({placeholders})
                ORDER BY oi.order_id, oi.menu_name, oi.id
            """, order_ids)

            items_by_order = {}
            for row in cursor.fetchall():
                oid = row[0]
                menu_name = row[1] or '(메뉴 미지정)'
                if oid not in items_by_order:
                    items_by_order[oid] = {}
                if menu_name not in items_by_order[oid]:
                    items_by_order[oid][menu_name] = []
                items_by_order[oid][menu_name].append({
                    "ingredient_code": row[2],
                    "ingredient_name": row[3],
                    "specification": row[4],
                    "unit": row[5],
                    "unit_price": float(row[6]) if row[6] else 0,
                    "required_qty": float(row[7]) if row[7] else 0,
                    "order_qty": float(row[8]) if row[8] else 0,
                    "total_price": float(row[9]) if row[9] else 0,
                    "supplier_name": row[10]
                })

            for order in orders:
                menu_map = items_by_order.get(order["id"], {})
                for menu_name, items in menu_map.items():
                    order["menus"].append({
                        "menu_name": menu_name,
                        "ingredients": items,
                        "menu_total": sum(i["total_price"] for i in items)
                    })

            return {
                "success": True,
                "has_events": True,
                "orders": orders,
                "total_orders": len(orders)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/event-orders/mark-merged")
async def mark_orders_merged(request: Request):
    """합산된 발주서에 합산 이력 기록"""
    try:
        data = await request.json()
        source_ids = data.get('source_order_ids', [])
        target_date = data.get('target_order_date', '')

        if not source_ids:
            return {"success": False, "error": "합산 대상 발주서가 없습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()
            merged_label = target_date
            try:
                parts = target_date.split('-')
                if len(parts) == 3:
                    merged_label = f"{int(parts[1])}월{int(parts[2])}일 합산"
            except:
                pass

            placeholders = ','.join(['%s'] * len(source_ids))
            cursor.execute(f"""
                UPDATE orders SET merged_into = %s, merged_at = NOW()
                WHERE id IN ({placeholders}) AND order_type = 'event'
            """, [merged_label] + source_ids)
            conn.commit()

            logger.info(f"[행사발주] 합산 마킹: {len(source_ids)}건, label={merged_label}, ids={source_ids}")
            return {"success": True, "message": f"{len(source_ids)}건의 발주서에 합산 이력이 기록되었습니다.", "merged_label": merged_label}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 목록 조회 API
# =====================

@router.get("/api/event-orders")
async def get_event_orders(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    site_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200)
):
    """
    행사 발주서 목록 조회
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    o.id, o.order_number, o.order_date, o.usage_date,
                    o.status, o.total_amount, o.attendees, o.notes,
                    o.template_id, et.name as template_name,
                    o.created_at, o.site_id,
                    sg.group_name as site_name,
                    o.merged_into, o.merged_at
                FROM orders o
                LEFT JOIN event_templates et ON o.template_id = et.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE o.order_type = 'event'
            """
            params = []

            if start_date:
                query += " AND o.order_date >= %s"
                params.append(start_date)

            if end_date:
                query += " AND o.order_date <= %s"
                params.append(end_date)

            if status:
                query += " AND o.status = %s"
                params.append(status)

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            query += " ORDER BY o.created_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)

            orders = []
            for row in cursor.fetchall():
                orders.append({
                    "id": row[0],
                    "order_number": row[1],
                    "order_date": str(row[2]) if row[2] else None,
                    "usage_date": str(row[3]) if row[3] else None,
                    "status": row[4],
                    "total_amount": float(row[5]) if row[5] else 0,
                    "attendees": row[6],
                    "notes": row[7],
                    "template_id": row[8],
                    "template_name": row[9],
                    "created_at": str(row[10]) if row[10] else None,
                    "site_id": row[11],
                    "site_name": row[12],
                    "merged_into": row[13],
                    "merged_at": str(row[14]) if row[14] else None
                })

            return {"success": True, "orders": orders}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 상세 조회 API
# =====================

@router.get("/api/event-orders/{order_id}")
async def get_event_order(order_id: int):
    """
    행사 발주서 상세 조회
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 발주서 정보 조회
            cursor.execute("""
                SELECT
                    o.id, o.order_number, o.order_date, o.usage_date,
                    o.status, o.total_amount, o.attendees, o.notes,
                    o.template_id, et.name as template_name,
                    o.created_at, o.site_id,
                    sg.group_name as site_name
                FROM orders o
                LEFT JOIN event_templates et ON o.template_id = et.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE o.id = %s AND o.order_type = 'event'
            """, (order_id,))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            order_info = {
                "id": row[0],
                "order_number": row[1],
                "order_date": str(row[2]) if row[2] else None,
                "usage_date": str(row[3]) if row[3] else None,
                "status": row[4],
                "total_amount": float(row[5]) if row[5] else 0,
                "attendees": row[6],
                "notes": row[7],
                "template_id": row[8],
                "template_name": row[9],
                "created_at": str(row[10]) if row[10] else None,
                "site_id": row[11],
                "site_name": row[12],
                "items": []
            }

            # 발주 항목 조회
            cursor.execute("""
                SELECT
                    id, ingredient_id, ingredient_code, ingredient_name,
                    unit, unit_price, required_qty, order_qty, total_price,
                    supplier_name, specification, menu_name
                FROM order_items
                WHERE order_id = %s
                ORDER BY id
            """, (order_id,))

            for item_row in cursor.fetchall():
                order_info["items"].append({
                    "id": item_row[0],
                    "ingredient_id": item_row[1],
                    "ingredient_code": item_row[2],
                    "ingredient_name": item_row[3],
                    "unit": item_row[4],
                    "unit_price": float(item_row[5]) if item_row[5] else 0,
                    "required_qty": float(item_row[6]) if item_row[6] else 0,
                    "order_qty": float(item_row[7]) if item_row[7] else 0,
                    "total_amount": float(item_row[8]) if item_row[8] else 0,
                    "supplier_name": item_row[9],
                    "specification": item_row[10],
                    "menu_name": item_row[11]
                })

            return {"success": True, "order": order_info}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 수정 API
# =====================

@router.put("/api/event-orders/{order_id}")
async def update_event_order(order_id: int, request: Request):
    """
    행사 발주서 수정 (pending/confirmed 모두 가능 - 행사 특성상 확정 후에도 변경 허용)
    """
    try:
        data = await request.json()
        attendees = data.get('attendees')
        usage_date = data.get('usage_date')
        order_date = data.get('order_date')
        menus = data.get('menus')
        notes = data.get('notes')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 발주서 존재 및 타입 확인
            cursor.execute("""
                SELECT id, status, order_number FROM orders
                WHERE id = %s AND order_type = 'event'
            """, (order_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            current_status = row[1]
            order_number = row[2]

            # 발주서 기본 정보 업데이트
            update_fields = []
            update_params = []

            if attendees is not None:
                update_fields.append("attendees = %s")
                update_params.append(int(attendees))
            if usage_date is not None:
                update_fields.append("usage_date = %s")
                update_params.append(usage_date)
            if order_date is not None:
                update_fields.append("order_date = %s")
                update_params.append(order_date)
            if notes is not None:
                update_fields.append("notes = %s")
                update_params.append(notes)

            site_id = data.get('site_id')
            if site_id is not None:
                update_fields.append("site_id = %s")
                update_params.append(int(site_id) if site_id else None)

            if update_fields:
                update_params.append(order_id)
                cursor.execute(f"""
                    UPDATE orders SET {', '.join(update_fields)}
                    WHERE id = %s
                """, update_params)

            # 식자재 목록 업데이트 (menus가 있으면 전량 교체)
            if menus is not None:
                # 기존 항목 삭제
                cursor.execute("DELETE FROM order_items WHERE order_id = %s", (order_id,))

                # 새 항목 삽입
                total_amount = 0
                for menu in menus:
                    menu_name = menu.get('menu_name', '')
                    for ing in menu.get('ingredients', []):
                        ingredient_code = ing.get('ingredient_code')
                        if not ingredient_code:
                            continue

                        ingredient_name = ing.get('ingredient_name', '')
                        unit = ing.get('unit', '')
                        unit_price = float(ing.get('unit_price', 0) or 0)
                        required_qty = float(ing.get('required_qty', 0) or 0)
                        total_price = float(ing.get('total_price', 0) or 0)
                        supplier_name = ing.get('supplier_name', '')
                        specification = ing.get('specification', '')

                        if required_qty <= 0:
                            continue

                        # ingredient_id 조회
                        cursor.execute("""
                            SELECT id FROM ingredients WHERE ingredient_code = %s LIMIT 1
                        """, (ingredient_code,))
                        ing_row = cursor.fetchone()
                        ingredient_id = ing_row[0] if ing_row else None

                        cursor.execute("""
                            INSERT INTO order_items (
                                order_id, ingredient_id, ingredient_code, ingredient_name,
                                unit, unit_price, required_qty, order_qty, total_price,
                                supplier_name, specification, menu_name
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            order_id, ingredient_id, ingredient_code, ingredient_name,
                            unit, unit_price, required_qty, required_qty, total_price,
                            supplier_name, specification, menu_name
                        ))

                        total_amount += total_price

                # 총액 업데이트
                cursor.execute("""
                    UPDATE orders SET total_amount = %s WHERE id = %s
                """, (total_amount, order_id))

            conn.commit()

            return {
                "success": True,
                "message": f"발주서 {order_number}이(가) 수정되었습니다."
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 상태 변경 API
# =====================

@router.put("/api/event-orders/{order_id}/status")
async def update_event_order_status(order_id: int, request: Request):
    """
    행사 발주서 상태 변경
    - pending → confirmed (확정)
    - confirmed → pending (확정 취소 - 행사 특성상 허용)
    - pending/confirmed → cancelled (취소)
    """
    try:
        data = await request.json()
        new_status = data.get('status')

        if new_status not in ('pending', 'confirmed', 'cancelled'):
            return {"success": False, "error": "유효하지 않은 상태입니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 현재 상태 확인
            cursor.execute("""
                SELECT status, order_number FROM orders
                WHERE id = %s AND order_type = 'event'
            """, (order_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            current_status = row[0]
            order_number = row[1]

            # 상태 업데이트
            if new_status == 'confirmed':
                cursor.execute("""
                    UPDATE orders SET status = 'confirmed', confirmed_at = NOW()
                    WHERE id = %s
                """, (order_id,))
            elif new_status == 'cancelled':
                cursor.execute("""
                    UPDATE orders SET status = 'cancelled'
                    WHERE id = %s
                """, (order_id,))
            else:
                cursor.execute("""
                    UPDATE orders SET status = %s
                    WHERE id = %s
                """, (new_status, order_id))

            conn.commit()
            logger.info(f"[행사발주] 상태변경: {order_number} {current_status}→{new_status}")

            status_text = {'pending': '대기', 'confirmed': '확정', 'cancelled': '취소'}
            return {
                "success": True,
                "message": f"발주서 {order_number} 상태가 '{status_text.get(new_status, new_status)}'(으)로 변경되었습니다.",
                "status": new_status
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 행사 발주서 삭제 API
# =====================

@router.delete("/api/event-orders/{order_id}")
async def delete_event_order(order_id: int):
    """
    행사 발주서 삭제
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 발주서 존재 확인
            cursor.execute("""
                SELECT order_number FROM orders WHERE id = %s AND order_type = 'event'
            """, (order_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            order_number = row[0]

            # 발주 항목 삭제
            cursor.execute("DELETE FROM order_items WHERE order_id = %s", (order_id,))

            # 발주서 삭제
            cursor.execute("DELETE FROM orders WHERE id = %s", (order_id,))

            conn.commit()

            logger.info(f"[행사발주] 삭제: {order_number}")
            return {
                "success": True,
                "message": f"발주서 {order_number}이(가) 삭제되었습니다."
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 협력업체별 합산 조회 API
# =====================

@router.post("/api/event-orders/summary-by-supplier")
async def get_summary_by_supplier(request: Request):
    """
    식자재를 협력업체별로 합산
    """
    try:
        data = await request.json()
        menus = data.get('menus', [])

        supplier_summary = {}

        for menu in menus:
            for ing in menu.get('ingredients', []):
                supplier = ing.get('supplier_name', '(미지정)')
                if not supplier:
                    supplier = '(미지정)'

                if supplier not in supplier_summary:
                    supplier_summary[supplier] = {
                        "supplier_name": supplier,
                        "items": [],
                        "total_amount": 0
                    }

                item = {
                    "ingredient_code": ing.get('ingredient_code'),
                    "ingredient_name": ing.get('ingredient_name'),
                    "unit": ing.get('unit'),
                    "required_qty": ing.get('required_qty', 0),
                    "unit_price": ing.get('unit_price', 0),
                    "total_price": ing.get('total_price', 0),
                    "menu_name": menu.get('menu_name')
                }
                supplier_summary[supplier]["items"].append(item)
                supplier_summary[supplier]["total_amount"] += float(ing.get('total_price', 0))

        # 리스트로 변환 및 총액 순 정렬
        result = list(supplier_summary.values())
        result.sort(key=lambda x: x['total_amount'], reverse=True)

        return {
            "success": True,
            "suppliers": result,
            "total_suppliers": len(result)
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


