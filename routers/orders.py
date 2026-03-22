#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Orders Router
발주 관리 관련 API 엔드포인트
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
from routers.order_calculation import check_supplier_blackout, get_effective_price_for_date

router = APIRouter()


# ============================================
# 테이블 스키마 업데이트 (meal_counts_snapshot, parent_order_id 컬럼 추가)
# ============================================
def ensure_orders_snapshot_columns():
    """orders 테이블에 meal_counts_snapshot, parent_order_id 컬럼 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_counts_snapshot 컬럼 추가 (없으면)
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'meal_counts_snapshot'
            """)
            if not cursor.fetchone():
                cursor.execute("""
                    ALTER TABLE orders
                    ADD COLUMN meal_counts_snapshot JSONB,
                    ADD COLUMN snapshot_created_at TIMESTAMP
                """)
                conn.commit()
                print("[DB] orders 테이블에 meal_counts_snapshot 컬럼 추가 완료")

            # parent_order_id 컬럼 추가 (추가발주 연결용)
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'parent_order_id'
            """)
            if not cursor.fetchone():
                cursor.execute("""
                    ALTER TABLE orders
                    ADD COLUMN parent_order_id INTEGER REFERENCES orders(id)
                """)
                conn.commit()
                print("[DB] orders 테이블에 parent_order_id 컬럼 추가 완료")

                # 인덱스 생성
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_orders_parent ON orders(parent_order_id)
                """)
                conn.commit()
                print("[DB] orders 테이블에 parent_order_id 인덱스 생성 완료")

            cursor.close()
    except Exception as e:
        print(f"[DB] orders 스키마 업데이트 오류 (무시 가능): {e}")

# 서버 시작시 스키마 업데이트
ensure_orders_snapshot_columns()


# ============================================
# 창고 API
# ============================================

@router.get("/api/warehouses")
async def get_warehouses(site_id: Optional[int] = None):
    """창고 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if site_id:
                cursor.execute("""
                    SELECT id, site_id, name, code, address, contact_name, contact_phone,
                           is_default, is_active
                    FROM warehouses
                    WHERE (site_id = %s OR site_id IS NULL) AND is_active = TRUE
                    ORDER BY is_default DESC, name
                """, (site_id,))
            else:
                cursor.execute("""
                    SELECT id, site_id, name, code, address, contact_name, contact_phone,
                           is_default, is_active
                    FROM warehouses
                    WHERE is_active = TRUE
                    ORDER BY is_default DESC, name
                """)

            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            warehouses = [dict(zip(col_names, row)) for row in rows]

            return {"success": True, "data": warehouses}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 카테고리별 발주 상태 체크 API
# ============================================

@router.get("/api/orders/check-ordered-categories")
async def check_ordered_categories(
    site_id: int = Query(..., description="급식사업장 ID"),
    usage_date: str = Query(..., description="식단표 날짜 (YYYY-MM-DD)")
):
    """
    특정 식단표 날짜/사업장의 카테고리별 발주 상태 확인

    반환값:
    {
        "success": true,
        "ordered_categories": {
            "도시락": {
                "order_id": 123,
                "order_number": "20260114-0001",
                "status": "confirmed",
                "created_at": "2026-01-14 10:30:00",
                "item_count": 25
            },
            ...
        }
    }
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 해당 날짜/사업장의 발주된 카테고리별 정보 조회
            cursor.execute("""
                SELECT
                    oi.meal_category,
                    o.id AS order_id,
                    o.order_number,
                    o.status,
                    o.created_at,
                    COUNT(DISTINCT oi.ingredient_id) AS item_count
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.usage_date = %s
                  AND o.site_id = %s
                  AND o.status NOT IN ('cancelled', 'draft')
                  AND oi.meal_category IS NOT NULL
                GROUP BY oi.meal_category, o.id, o.order_number, o.status, o.created_at
                ORDER BY o.created_at DESC
            """, (usage_date, site_id))

            rows = cursor.fetchall()

            ordered_categories = {}
            for row in rows:
                category = row[0]
                if category and category not in ordered_categories:
                    ordered_categories[category] = {
                        "order_id": row[1],
                        "order_number": row[2],
                        "status": row[3],
                        "created_at": str(row[4]) if row[4] else None,
                        "item_count": row[5]
                    }

            return {
                "success": True,
                "ordered_categories": ordered_categories,
                "usage_date": usage_date,
                "site_id": site_id
            }

    except Exception as e:
        print(f"[ERROR] check_ordered_categories: {e}")
        return {"success": False, "error": str(e)}



@router.get("/api/orders/overrides")
async def get_order_overrides(
    site_id: int = Query(..., description="사업장 ID"),
    usage_date: str = Query(..., description="식단표 날짜 (YYYY-MM-DD)"),
    order_id: int = Query(None, description="발주서 ID (선택)")
):
    """
    발주 오버라이드 목록 조회
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    id, order_id, site_id, usage_date,
                    override_type,
                    original_ingredient_id, original_ingredient_code, original_ingredient_name,
                    recipe_id, recipe_name,
                    replacement_ingredient_id, replacement_ingredient_code, replacement_ingredient_name,
                    replacement_specification, replacement_supplier_name, replacement_unit_price,
                    replacement_unit, replacement_lead_time,
                    added_quantity, added_unit,
                    override_reason, override_notes,
                    created_by, created_at
                FROM order_ingredient_overrides
                WHERE site_id = %s AND usage_date = %s
            """
            params = [site_id, usage_date]

            if order_id:
                query += " AND order_id = %s"
                params.append(order_id)

            query += " ORDER BY created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            overrides = []
            for row in rows:
                override = dict(zip(col_names, row))
                # 날짜/시간 직렬화
                if override.get('usage_date'):
                    override['usage_date'] = str(override['usage_date'])
                if override.get('created_at'):
                    override['created_at'] = str(override['created_at'])
                overrides.append(override)

            return {
                "success": True,
                "overrides": overrides,
                "count": len(overrides)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/orders/overrides")
async def save_order_override(request: Request):
    """
    발주 오버라이드 저장 (대체/추가/제외)

    요청 예시:
    {
        "site_id": 1,
        "usage_date": "2026-01-25",
        "override_type": "replace",  // replace, add, exclude

        // 대체/제외 시 필수
        "original_ingredient_id": 123,
        "original_ingredient_code": "ABC-001",
        "original_ingredient_name": "양파",

        // 레시피 지정 시 (선택)
        "recipe_id": 10,
        "recipe_name": "불고기",

        // 대체/추가 시 필수
        "replacement_ingredient_id": 456,
        "replacement_ingredient_code": "DEF-002",
        "replacement_ingredient_name": "냉동양파",
        "replacement_specification": "1kg",
        "replacement_supplier_name": "A업체",
        "replacement_unit_price": 2500,
        "replacement_unit": "kg",
        "replacement_lead_time": 1,

        // 추가 시 필수
        "added_quantity": 0.05,  // 1인당 필요량 (kg)
        "added_unit": "kg",

        "override_reason": "lead_time_exceeded",  // lead_time_exceeded, out_of_stock, price, manual, not_needed
        "override_notes": "선발주일 초과로 대체"
    }
    """
    try:
        data = await request.json()

        site_id = data.get("site_id")
        usage_date = data.get("usage_date")
        override_type = data.get("override_type", "replace")

        if not site_id or not usage_date:
            return {"success": False, "error": "site_id와 usage_date는 필수입니다."}

        if override_type not in ('replace', 'add', 'exclude', 'qty_adjust'):
            return {"success": False, "error": "override_type은 replace, add, exclude, qty_adjust 중 하나여야 합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 동일 오버라이드 제거 (중복 방지)
            if override_type in ('replace', 'exclude', 'qty_adjust'):
                cursor.execute("""
                    DELETE FROM order_ingredient_overrides
                    WHERE site_id = %s AND usage_date = %s
                      AND override_type = %s
                      AND original_ingredient_id = %s
                      AND (recipe_id = %s OR (recipe_id IS NULL AND %s IS NULL))
                """, (
                    site_id, usage_date, override_type,
                    data.get("original_ingredient_id"),
                    data.get("recipe_id"), data.get("recipe_id")
                ))

            # 새 오버라이드 저장
            cursor.execute("""
                INSERT INTO order_ingredient_overrides (
                    order_id, site_id, usage_date, override_type,
                    original_ingredient_id, original_ingredient_code, original_ingredient_name,
                    recipe_id, recipe_name,
                    replacement_ingredient_id, replacement_ingredient_code, replacement_ingredient_name,
                    replacement_specification, replacement_supplier_name, replacement_unit_price,
                    replacement_unit, replacement_lead_time,
                    added_quantity, added_unit,
                    override_reason, override_notes, created_by
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s, %s
                )
                RETURNING id
            """, (
                data.get("order_id"),
                site_id,
                usage_date,
                override_type,
                data.get("original_ingredient_id"),
                data.get("original_ingredient_code"),
                data.get("original_ingredient_name"),
                data.get("recipe_id"),
                data.get("recipe_name"),
                data.get("replacement_ingredient_id"),
                data.get("replacement_ingredient_code"),
                data.get("replacement_ingredient_name"),
                data.get("replacement_specification"),
                data.get("replacement_supplier_name"),
                data.get("replacement_unit_price"),
                data.get("replacement_unit"),
                data.get("replacement_lead_time"),
                data.get("added_quantity"),
                data.get("added_unit"),
                data.get("override_reason", "manual"),
                data.get("override_notes"),
                data.get("created_by")
            ))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {
                "success": True,
                "message": "오버라이드가 저장되었습니다.",
                "id": new_id,
                "override_type": override_type
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/orders/overrides/bulk-delete")
async def bulk_delete_overrides(site_id: int = Query(...), usage_date: str = Query(...), types: str = Query(...)):
    """특정 날짜/사업장의 지정 타입 override 일괄 삭제"""
    try:
        type_list = [t.strip() for t in types.split(',') if t.strip()]
        if not type_list:
            return {"success": False, "error": "삭제할 override type을 지정해주세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join(['%s'] * len(type_list))
            cursor.execute(f"""
                DELETE FROM order_ingredient_overrides
                WHERE site_id = %s AND usage_date = %s AND override_type IN ({placeholders})
            """, [site_id, usage_date] + type_list)
            deleted = cursor.rowcount
            conn.commit()
            return {"success": True, "deleted": deleted}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/orders/overrides/{override_id}")
async def delete_order_override(override_id: int):
    """
    발주 오버라이드 삭제
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM order_ingredient_overrides WHERE id = %s RETURNING id
            """, (override_id,))

            deleted = cursor.fetchone()
            conn.commit()

            if deleted:
                return {"success": True, "message": "오버라이드가 삭제되었습니다."}
            else:
                return {"success": False, "error": "해당 오버라이드를 찾을 수 없습니다."}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 발주서 CRUD API
# ============================================

@router.get("/api/orders")
async def get_orders(
    site_id: int = Query(None),
    group_id: int = Query(None),
    supplier_id: int = Query(None),
    status: str = Query(None),
    from_date: str = Query(None),
    to_date: str = Query(None),
    limit: int = Query(100)
):
    """발주서 목록 조회 (사업장별, 그룹별, 협력업체별, 일자별)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT DISTINCT o.id, o.order_number, o.site_id, o.warehouse_id,
                       o.order_date, o.usage_date, o.order_type, o.status,
                       o.total_items, o.total_amount, o.notes,
                       o.created_by, o.confirmed_by, o.confirmed_at, o.locked_at,
                       o.created_at, o.updated_at, o.expected_delivery_date,
                       o.parent_order_id,
                       sg.group_name AS site_name, w.name AS warehouse_name,
                       (SELECT COUNT(*) FROM orders child WHERE child.parent_order_id = o.id) AS additional_orders_count,
                       (SELECT order_number FROM orders parent WHERE parent.id = o.parent_order_id) AS parent_order_number
                FROM orders o
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                LEFT JOIN warehouses w ON o.warehouse_id = w.id
            """

            # 협력업체 필터 시 order_items 조인
            if supplier_id:
                query += " INNER JOIN order_items oi ON o.id = oi.order_id AND oi.supplier_id = %s"

            query += " WHERE 1=1"
            params = []

            if supplier_id:
                params.append(supplier_id)

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)
            elif group_id:
                # group_id가 있으면 해당 그룹의 모든 사업장 발주서 조회
                query += " AND o.site_id = %s"
                params.append(group_id)

            if status:
                query += " AND o.status = %s"
                params.append(status)

            # 🔧 수정: 입고일 기간 필터는 expected_delivery_date로 조회
            if from_date:
                query += " AND COALESCE(o.expected_delivery_date, o.order_date) >= %s"
                params.append(from_date)

            if to_date:
                query += " AND COALESCE(o.expected_delivery_date, o.order_date) <= %s"
                params.append(to_date)

            query += " ORDER BY o.order_date DESC, o.id DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            orders = []
            for row in rows:
                order = dict(zip(col_names, row))
                # datetime 객체를 문자열로 변환
                for key, value in order.items():
                    if isinstance(value, (datetime, date)):
                        order[key] = str(value)
                    elif isinstance(value, Decimal):
                        order[key] = float(value)
                orders.append(order)

            return {"success": True, "data": orders}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체별 발주 현황 API (관리자용)
# ============================================

@router.get("/api/orders/by-supplier")
async def get_orders_by_supplier(
    order_date: str = Query(None, description="입고일"),
    usage_date: str = Query(None, description="식단표 날짜")
):
    """협력업체별 발주 현황 조회 (관리자가 발주 처리 확인용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기본값: 오늘 날짜
            if not order_date and not usage_date:
                order_date = str(date.today())

            query = """
                SELECT
                    COALESCE(s.name, i.supplier_name, '미지정') AS supplier_name,
                    s.id AS supplier_id,
                    s.supplier_code,
                    s.delivery_code,
                    COUNT(DISTINCT o.id) AS order_count,
                    COUNT(oi.id) AS item_count,
                    SUM(oi.order_qty) AS total_quantity,
                    SUM(oi.total_price) AS total_amount,
                    STRING_AGG(DISTINCT sg.group_name, ', ') AS site_names
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN suppliers s ON oi.supplier_id = s.id OR s.name = i.supplier_name
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE 1=1
            """
            params = []

            if order_date:
                query += " AND o.order_date = %s"
                params.append(order_date)

            if usage_date:
                query += " AND o.usage_date = %s"
                params.append(usage_date)

            query += """
                GROUP BY COALESCE(s.name, i.supplier_name, '미지정'), s.id, s.supplier_code, s.delivery_code
                ORDER BY total_amount DESC NULLS LAST
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            suppliers = []
            for row in rows:
                supplier = dict(zip(col_names, row))
                for key, value in supplier.items():
                    if isinstance(value, Decimal):
                        supplier[key] = float(value)
                suppliers.append(supplier)

            # 전체 합계
            total_orders = sum(s.get('order_count', 0) for s in suppliers)
            total_items = sum(s.get('item_count', 0) for s in suppliers)
            total_amount = sum(s.get('total_amount', 0) or 0 for s in suppliers)


            return {
                "success": True,
                "data": suppliers,
                "summary": {
                    "supplier_count": len(suppliers),
                    "total_orders": total_orders,
                    "total_items": total_items,
                    "total_amount": total_amount
                },
                "filter": {
                    "order_date": order_date,
                    "usage_date": usage_date
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/orders/by-supplier/{supplier_id}/items")
async def get_supplier_order_items(
    supplier_id: int,
    order_date: str = Query(None),
    usage_date: str = Query(None)
):
    """특정 협력업체의 발주 상세 품목 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if not order_date and not usage_date:
                order_date = str(date.today())

            query = """
                SELECT
                    o.id AS order_id,
                    o.order_number,
                    o.order_date,
                    o.usage_date,
                    o.status,
                    sg.group_name AS site_name,
                    oi.id AS item_id,
                    i.name AS ingredient_name,
                    i.specification,
                    i.unit,
                    oi.order_qty,
                    oi.unit_price,
                    oi.total_price
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = (SELECT name FROM suppliers WHERE id = %s))
            """
            params = [supplier_id, supplier_id]

            if order_date:
                query += " AND o.order_date = %s"
                params.append(order_date)

            if usage_date:
                query += " AND o.usage_date = %s"
                params.append(usage_date)

            query += " ORDER BY o.order_number, sg.group_name, i.name"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            items = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            return {"success": True, "data": items}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 입고 명세서 조회 API (경로 충돌 방지를 위해 {order_id} 라우트 앞에 위치)
# ============================================

@router.get("/api/orders/receiving")
async def get_receiving_documents(
    receiving_date: str = Query(None, description="입고예정일"),
    supplier_name: str = Query(None, description="협력업체명"),
    order_number: str = Query(None, description="발주번호"),
    site_id: int = Query(None, description="사업장 ID")
):
    """입고 명세서 조회 - 발주서별로 분리하여 업체별/일자별 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 발주 품목에서 입고예정일 기준으로 조회
            query = """
                SELECT
                    oi.id AS item_id,
                    o.id AS order_id,
                    o.order_number,
                    o.order_date,
                    o.usage_date,
                    oi.supplier_name,
                    oi.ingredient_code,
                    oi.ingredient_name,
                    oi.specification,
                    oi.unit,
                    oi.order_qty,
                    oi.unit_price,
                    oi.total_price,
                    oi.expected_delivery_date,
                    COALESCE(oi.received_qty, 0) AS received_qty,
                    COALESCE(oi.received, false) AS received,
                    oi.received_at,
                    sg.group_name AS site_name
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE o.status NOT IN ('cancelled')
            """
            params = []

            if receiving_date:
                query += " AND oi.expected_delivery_date = %s"
                params.append(receiving_date)

            if supplier_name:
                query += " AND oi.supplier_name = %s"
                params.append(supplier_name)

            if order_number:
                query += " AND o.order_number = %s"
                params.append(order_number)

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            query += " ORDER BY o.order_date, o.order_number, oi.supplier_name, oi.ingredient_name"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            # 발주서별 → 업체별로 그룹핑
            orders_data = {}
            for row in rows:
                item = dict(zip(col_names, row))
                # datetime 객체를 문자열로 변환
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)

                order_num = item['order_number']
                supplier = item['supplier_name'] or '기타'

                # 발주서별 그룹 생성
                if order_num not in orders_data:
                    orders_data[order_num] = {
                        'order_number': order_num,
                        'order_id': item['order_id'],
                        'order_date': item['order_date'],
                        'usage_date': item['usage_date'],
                        'suppliers': {},
                        'total_amount': 0,
                        'total_count': 0,
                        'received_count': 0
                    }

                # 발주서 내 업체별 그룹 생성
                if supplier not in orders_data[order_num]['suppliers']:
                    orders_data[order_num]['suppliers'][supplier] = {
                        'supplier_name': supplier,
                        'items': {},  # 딕셔너리로 변경 (동일 식자재 합산용)
                        'total_amount': 0,
                        'received_count': 0,
                        'total_count': 0
                    }

                # 동일 식자재 키 (식자재명 + 규격으로 합산)
                ingredient_key = f"{item['ingredient_name'] or 'unknown'}_{item['specification'] or ''}"
                supplier_group = orders_data[order_num]['suppliers'][supplier]

                if ingredient_key not in supplier_group['items']:
                    # 첫 번째 항목
                    supplier_group['items'][ingredient_key] = {
                        **item,
                        'order_qty': float(item['order_qty'] or 0),
                        'total_price': float(item['total_price'] or 0),
                        'received_qty': float(item['received_qty'] or 0),
                        'merged_count': 1,
                        'original_item_ids': [item['item_id']]
                    }
                else:
                    # 동일 식자재 합산
                    merged_item = supplier_group['items'][ingredient_key]
                    merged_item['order_qty'] += float(item['order_qty'] or 0)
                    merged_item['total_price'] += float(item['total_price'] or 0)
                    merged_item['received_qty'] += float(item['received_qty'] or 0)
                    merged_item['merged_count'] += 1
                    merged_item['original_item_ids'].append(item['item_id'])
                    # 하나라도 미입고면 전체 미입고로 표시
                    if not item['received']:
                        merged_item['received'] = False

                supplier_group['total_amount'] += float(item['total_price'] or 0)
                supplier_group['total_count'] += 1
                orders_data[order_num]['total_amount'] += float(item['total_price'] or 0)
                orders_data[order_num]['total_count'] += 1

                if item['received']:
                    supplier_group['received_count'] += 1
                    orders_data[order_num]['received_count'] += 1

            # suppliers 내 items를 딕셔너리에서 리스트로 변환
            for order_num in orders_data:
                for supplier_name, supplier_data in orders_data[order_num]['suppliers'].items():
                    supplier_data['items'] = list(supplier_data['items'].values())
                    # 합산된 품목 수로 업데이트
                    supplier_data['merged_item_count'] = len(supplier_data['items'])
                orders_data[order_num]['suppliers'] = list(orders_data[order_num]['suppliers'].values())

            # 협력업체 목록도 함께 반환
            cursor.execute("""
                SELECT DISTINCT supplier_name
                FROM order_items
                WHERE supplier_name IS NOT NULL AND supplier_name != ''
                ORDER BY supplier_name
            """)
            supplier_rows = cursor.fetchall()
            suppliers_list = [row[0] for row in supplier_rows]

            # 해당 입고일의 발주서 목록
            order_list_query = """
                SELECT DISTINCT o.order_number, o.order_date
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status NOT IN ('cancelled')
            """
            order_list_params = []
            if receiving_date:
                order_list_query += " AND oi.expected_delivery_date = %s"
                order_list_params.append(receiving_date)
            order_list_query += " ORDER BY o.order_date, o.order_number"

            cursor.execute(order_list_query, order_list_params)
            order_list = [{'order_number': row[0], 'order_date': str(row[1])} for row in cursor.fetchall()]


            return {
                "success": True,
                "data": list(orders_data.values()),
                "orders": order_list,
                "suppliers": suppliers_list,
                "summary": {
                    "total_orders": len(orders_data),
                    "total_suppliers": sum(len(o['suppliers']) for o in orders_data.values()),
                    "total_items": sum(o['total_count'] for o in orders_data.values()),
                    "total_received": sum(o['received_count'] for o in orders_data.values()),
                    "total_amount": sum(o['total_amount'] for o in orders_data.values())
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/orders/receiving/statement")
async def get_receiving_statement(
    receiving_date: str = Query(..., description="입고예정일 (필수)"),
    site_id: int = Query(None, description="사업장 ID")
):
    """
    입고 명세서 - 입고일 기준 식단표 날짜별 그룹핑
    금요일에 토/일/월 식자재가 모두 입고되는 경우를 위한 명세서
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 입고예정일 기준으로 모든 발주 품목 조회
            query = """
                SELECT
                    oi.id AS item_id,
                    o.id AS order_id,
                    o.order_number,
                    o.usage_date,
                    oi.supplier_id,
                    oi.supplier_name,
                    oi.ingredient_id,
                    oi.ingredient_code,
                    oi.ingredient_name,
                    oi.specification,
                    oi.unit,
                    oi.order_qty,
                    oi.unit_price,
                    oi.total_price,
                    oi.expected_delivery_date,
                    oi.meal_type,
                    oi.menu_name,
                    COALESCE(oi.received, false) AS received,
                    COALESCE(oi.received_qty, 0) AS received_qty,
                    sg.group_name AS site_name
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE oi.expected_delivery_date = %s
                  AND o.status NOT IN ('cancelled')
            """
            params = [receiving_date]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            query += " ORDER BY o.usage_date, oi.supplier_name, oi.ingredient_name"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            # 1. 사용일별 그룹핑
            by_usage_date = {}
            # 2. 협력업체별 전체 합산
            by_supplier_total = {}
            # 3. 식자재별 전체 합산
            by_ingredient_total = {}

            for row in rows:
                item = dict(zip(col_names, row))
                # datetime 변환
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)

                usage_date = item['usage_date']
                supplier = item['supplier_name'] or '미지정'
                ingredient_key = item['ingredient_code'] or item['ingredient_name']

                # ===== 사용일별 그룹핑 =====
                if usage_date not in by_usage_date:
                    by_usage_date[usage_date] = {
                        'usage_date': usage_date,
                        'suppliers': {},
                        'total_amount': 0,
                        'total_items': 0
                    }

                # 사용일 내 협력업체별 그룹핑
                if supplier not in by_usage_date[usage_date]['suppliers']:
                    by_usage_date[usage_date]['suppliers'][supplier] = {
                        'supplier_name': supplier,
                        'items': {},  # 식자재 합산용 dict
                        'total_amount': 0,
                        'total_items': 0
                    }

                # 동일 식자재 합산 (사용일 내)
                supplier_group = by_usage_date[usage_date]['suppliers'][supplier]
                if ingredient_key not in supplier_group['items']:
                    supplier_group['items'][ingredient_key] = {
                        **item,
                        'order_qty': float(item['order_qty'] or 0),
                        'total_price': float(item['total_price'] or 0),
                        'meal_types': [item['meal_type']] if item['meal_type'] else [],
                        'menu_names': [item['menu_name']] if item['menu_name'] else [],
                        'merged_count': 1
                    }
                else:
                    supplier_group['items'][ingredient_key]['order_qty'] += float(item['order_qty'] or 0)
                    supplier_group['items'][ingredient_key]['total_price'] += float(item['total_price'] or 0)
                    if item['meal_type'] and item['meal_type'] not in supplier_group['items'][ingredient_key]['meal_types']:
                        supplier_group['items'][ingredient_key]['meal_types'].append(item['meal_type'])
                    if item['menu_name'] and item['menu_name'] not in supplier_group['items'][ingredient_key]['menu_names']:
                        supplier_group['items'][ingredient_key]['menu_names'].append(item['menu_name'])
                    supplier_group['items'][ingredient_key]['merged_count'] += 1

                supplier_group['total_amount'] += float(item['total_price'] or 0)
                supplier_group['total_items'] += 1
                by_usage_date[usage_date]['total_amount'] += float(item['total_price'] or 0)
                by_usage_date[usage_date]['total_items'] += 1

                # ===== 협력업체별 전체 합산 =====
                if supplier not in by_supplier_total:
                    by_supplier_total[supplier] = {
                        'supplier_name': supplier,
                        'items': {},
                        'total_amount': 0,
                        'total_qty': 0
                    }

                if ingredient_key not in by_supplier_total[supplier]['items']:
                    by_supplier_total[supplier]['items'][ingredient_key] = {
                        'ingredient_code': item['ingredient_code'],
                        'ingredient_name': item['ingredient_name'],
                        'specification': item['specification'],
                        'unit': item['unit'],
                        'unit_price': item['unit_price'],
                        'order_qty': float(item['order_qty'] or 0),
                        'total_price': float(item['total_price'] or 0)
                    }
                else:
                    by_supplier_total[supplier]['items'][ingredient_key]['order_qty'] += float(item['order_qty'] or 0)
                    by_supplier_total[supplier]['items'][ingredient_key]['total_price'] += float(item['total_price'] or 0)

                by_supplier_total[supplier]['total_amount'] += float(item['total_price'] or 0)

                # ===== 식자재별 전체 합산 =====
                if ingredient_key not in by_ingredient_total:
                    by_ingredient_total[ingredient_key] = {
                        'ingredient_code': item['ingredient_code'],
                        'ingredient_name': item['ingredient_name'],
                        'specification': item['specification'],
                        'unit': item['unit'],
                        'supplier_name': supplier,
                        'unit_price': item['unit_price'],
                        'order_qty': float(item['order_qty'] or 0),
                        'total_price': float(item['total_price'] or 0),
                        'usage_dates': [usage_date]
                    }
                else:
                    by_ingredient_total[ingredient_key]['order_qty'] += float(item['order_qty'] or 0)
                    by_ingredient_total[ingredient_key]['total_price'] += float(item['total_price'] or 0)
                    if usage_date not in by_ingredient_total[ingredient_key]['usage_dates']:
                        by_ingredient_total[ingredient_key]['usage_dates'].append(usage_date)

            # 결과 정리 - items dict를 list로 변환
            for usage_date in by_usage_date:
                for supplier in by_usage_date[usage_date]['suppliers']:
                    by_usage_date[usage_date]['suppliers'][supplier]['items'] = list(
                        by_usage_date[usage_date]['suppliers'][supplier]['items'].values()
                    )
                by_usage_date[usage_date]['suppliers'] = list(by_usage_date[usage_date]['suppliers'].values())

            for supplier in by_supplier_total:
                by_supplier_total[supplier]['items'] = list(by_supplier_total[supplier]['items'].values())

            # 사용일 정렬
            usage_dates_sorted = sorted(by_usage_date.keys())
            by_usage_date_list = [by_usage_date[d] for d in usage_dates_sorted]


            return {
                "success": True,
                "receiving_date": receiving_date,
                "by_usage_date": by_usage_date_list,  # 사용일별 그룹
                "by_supplier_total": list(by_supplier_total.values()),  # 협력업체별 전체 합산
                "by_ingredient_total": list(by_ingredient_total.values()),  # 식자재별 전체 합산
                "summary": {
                    "receiving_date": receiving_date,
                    "usage_date_count": len(by_usage_date),
                    "usage_dates": usage_dates_sorted,
                    "supplier_count": len(by_supplier_total),
                    "total_items": sum(d['total_items'] for d in by_usage_date.values()),
                    "total_amount": round(sum(d['total_amount'] for d in by_usage_date.values()), 2)
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/orders/receiving/confirm")
async def confirm_receiving(request: Request):
    """입고 확인 처리"""
    try:
        data = await request.json()
        item_ids = data.get('item_ids', [])
        received_qty = data.get('received_qty', {})  # {item_id: qty}

        if not item_ids:
            return {"success": False, "error": "확인할 품목이 없습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            updated_count = 0
            for item_id in item_ids:
                qty = received_qty.get(str(item_id))
                if qty is not None:
                    cursor.execute("""
                        UPDATE order_items
                        SET received = true,
                            received_qty = %s,
                            received_at = NOW()
                        WHERE id = %s
                    """, (qty, item_id))
                else:
                    cursor.execute("""
                        UPDATE order_items
                        SET received = true,
                            received_qty = order_qty,
                            received_at = NOW()
                        WHERE id = %s
                    """, (item_id,))
                updated_count += cursor.rowcount

            conn.commit()

            return {
                "success": True,
                "message": f"{updated_count}개 품목이 입고 확인되었습니다.",
                "updated_count": updated_count
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/orders/{order_id}")
async def get_order(order_id: int, mode: str = Query("summary", description="조회 모드: summary(집계), detail(정규화)")):
    """발주서 상세 조회 (mode: summary=집계 뷰, detail=정규화 데이터)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 발주서 기본 정보
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

            # 60일 이상 지난 발주서의 스냅샷은 만료 처리
            SNAPSHOT_RETENTION_DAYS = 60
            created_at = order.get("created_at")
            if created_at:
                if isinstance(created_at, str):
                    created_date = datetime.strptime(created_at[:10], "%Y-%m-%d").date()
                else:
                    created_date = created_at.date() if isinstance(created_at, datetime) else created_at

                days_old = (date.today() - created_date).days

                if days_old > SNAPSHOT_RETENTION_DAYS:
                    # 스냅샷이 있으면 DB에서 삭제하고 응답에서도 제외
                    if order.get("step2_snapshot") or order.get("step3_snapshot"):
                        cursor.execute("""
                            UPDATE orders
                            SET step2_snapshot = NULL, step3_snapshot = NULL
                            WHERE id = %s
                        """, (order_id,))
                        conn.commit()
                    order["step2_snapshot"] = None
                    order["step3_snapshot"] = None
                    order["snapshot_expired"] = True
                    order["snapshot_expired_message"] = f"스냅샷 데이터가 {SNAPSHOT_RETENTION_DAYS}일 보관 기간을 초과하여 삭제되었습니다."

            # datetime 변환
            for key, value in order.items():
                if isinstance(value, (datetime, date)):
                    order[key] = str(value)
                elif isinstance(value, Decimal):
                    order[key] = float(value)

            # 발주 상세 품목 (식자재 정보 + 협력업체 정보 조인)
            cursor.execute("""
                SELECT oi.*,
                       i.ingredient_name, i.specification AS spec, i.origin,
                       COALESCE(i.base_weight_grams, 1000) AS base_weight_grams,
                       COALESCE(s.name, i.supplier_name) AS resolved_supplier_name
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN suppliers s ON oi.supplier_id = s.id
                WHERE oi.order_id = %s
                ORDER BY resolved_supplier_name, oi.meal_type, oi.id
            """, (order_id,))
            item_rows = cursor.fetchall()
            item_col_names = [desc[0] for desc in cursor.description]

            raw_items = []
            for row in item_rows:
                item = dict(zip(item_col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                raw_items.append(item)

            # [정규화] mode에 따른 처리
            if mode == "detail":
                # detail 모드: 정규화된 데이터 그대로 반환
                order["items"] = raw_items
                order["mode"] = "detail"
            else:
                # summary 모드: 식자재별 집계 (기본값)
                aggregated = {}
                for item in raw_items:
                    # 집계 키: (ingredient_id, meal_type)
                    agg_key = (item.get("ingredient_id"), item.get("meal_type"))
                    if agg_key not in aggregated:
                        aggregated[agg_key] = {
                            **item,
                            "detail_items": [],  # 원본 상세 데이터 참조
                            "delivery_sites": []  # 납품처 목록
                        }
                        # 집계용 필드 초기화
                        aggregated[agg_key]["meal_count"] = 0
                        aggregated[agg_key]["required_qty"] = 0
                        aggregated[agg_key]["order_qty"] = 0
                        aggregated[agg_key]["total_price"] = 0
                        # 집계 후 의미없는 단일값 필드 제거 (여러 납품처 합계이므로)
                        aggregated[agg_key]["slot_name"] = None
                        aggregated[agg_key]["delivery_site_name"] = None
                        aggregated[agg_key]["menu_name"] = None
                        aggregated[agg_key]["per_person_qty"] = None

                    # 수량 합산
                    aggregated[agg_key]["meal_count"] += item.get("meal_count") or 0
                    aggregated[agg_key]["required_qty"] += item.get("required_qty") or 0
                    aggregated[agg_key]["order_qty"] += item.get("order_qty") or 0
                    aggregated[agg_key]["total_price"] += item.get("total_price") or 0

                    # 납품처 정보 수집
                    ds_info = {
                        "slot_name": item.get("slot_name"),
                        "delivery_site_name": item.get("delivery_site_name"),
                        "menu_name": item.get("menu_name"),
                        "meal_count": item.get("meal_count"),
                        "required_qty": item.get("required_qty"),
                        "order_qty": item.get("order_qty"),
                        "per_person_qty": item.get("per_person_qty")
                    }
                    aggregated[agg_key]["delivery_sites"].append(ds_info)
                    aggregated[agg_key]["detail_items"].append(item.get("id"))

                order["items"] = list(aggregated.values())
                order["mode"] = "summary"
                order["original_item_count"] = len(raw_items)

            return {"success": True, "data": order}

    except Exception as e:
        return {"success": False, "error": str(e)}



@router.get("/api/admin/orders/{order_id}/items")
async def get_order_items(order_id: int):
    """발주서 품목 조회 (검증용) - base_weight_grams 포함"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT oi.*,
                       i.ingredient_name, i.specification AS spec, i.origin,
                       COALESCE(i.base_weight_grams, 1000) AS base_weight_grams,
                       COALESCE(s.name, i.supplier_name) AS resolved_supplier_name
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN suppliers s ON oi.supplier_id = s.id
                WHERE oi.order_id = %s
                ORDER BY oi.id
            """, (order_id,))

            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            items = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            return {"success": True, "items": items}

    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.post("/api/orders")
async def create_order(request: Request):
    """발주서 생성"""
    try:
        data = await request.json()

        site_id = data.get("site_id")
        warehouse_id = data.get("warehouse_id")
        order_date = data.get("order_date", str(date.today()))
        # meal_plan_date 우선, usage_date는 하위호환용
        usage_date = data.get("meal_plan_date") or data.get("usage_date")
        order_type = data.get("order_type", "regular")
        items = data.get("items", [])
        notes = data.get("notes", "")
        created_by = data.get("created_by")
        parent_order_id = data.get("parent_order_id")  # 추가발주 시 원본 발주서 ID

        # Step 2/3 스냅샷 데이터 (발주서 복원용)
        step2_snapshot = data.get("step2_snapshot")  # 끼니별 내역
        step3_snapshot = data.get("step3_snapshot")  # 합산된 발주 데이터

        if not site_id or not usage_date:
            return {"success": False, "error": "site_id와 식단표 날짜는 필수입니다."}

        # 휴무일 체크 옵션 (기본값: 경고만, True면 차단)
        block_on_blackout = data.get("block_on_blackout", False)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체 휴무일 체크
            supplier_ids = list(set([
                item.get("supplier_id") for item in items
                if item.get("supplier_id")
            ]))

            blackout_suppliers = check_supplier_blackout(cursor, supplier_ids, usage_date)

            if blackout_suppliers:
                blackout_warnings = []
                for bs in blackout_suppliers:
                    msg = f"{bs['supplier_name']}: {bs['start_date']}~{bs['end_date']}"
                    if bs['reason']:
                        msg += f" ({bs['reason']})"
                    blackout_warnings.append(msg)

                if block_on_blackout:
                    return {
                        "success": False,
                        "error": "휴무 중인 협력업체가 있어 발주를 생성할 수 없습니다.",
                        "blackout_suppliers": blackout_suppliers
                    }
                # 경고만 하고 계속 진행 - 결과에 포함

            # 동일 날짜 기존 발주서 확인
            force_create = data.get("force_create", False)  # 강제 생성 옵션

            cursor.execute("""
                SELECT id, order_number, status, created_at
                FROM orders
                WHERE usage_date = %s AND site_id = %s AND status != 'cancelled'
                ORDER BY created_at DESC
            """, (usage_date, site_id))
            existing_orders = cursor.fetchall()

            if existing_orders and not force_create:
                # 기존 발주서가 있고 강제 생성이 아니면 경고 반환
                existing_list = []
                for eo in existing_orders:
                    existing_list.append({
                        "order_id": eo[0],
                        "order_number": eo[1],
                        "status": eo[2],
                        "created_at": str(eo[3]) if eo[3] else None
                    })

                return {
                    "success": False,
                    "error": "existing_orders",
                    "message": f"해당 날짜({usage_date})에 이미 {len(existing_orders)}개의 발주서가 있습니다.",
                    "existing_orders": existing_list,
                    "requires_confirmation": True
                }

            # ★ 식수 스냅샷 저장 (발주 후 식수 변경 감지용)
            cursor.execute("""
                SELECT category, menu_name, site_name, meal_count, meal_type
                FROM meal_counts
                WHERE work_date = %s AND (site_id = %s OR %s IS NULL)
            """, (usage_date, site_id, site_id))
            snapshot_rows = cursor.fetchall()
            meal_counts_snapshot = [
                {
                    'category': row[0],
                    'menu_name': row[1],
                    'site_name': row[2],
                    'meal_count': row[3],
                    'meal_type': row[4]
                }
                for row in snapshot_rows
            ] if snapshot_rows else None

            # 발주서 생성
            # 🔧 수정: order_date = 사용자가 선택한 "입고일" (입고예정일)
            # expected_delivery_date에 저장하고, order_date는 실제 발주 확정일로 나중에 설정
            cursor.execute("""
                INSERT INTO orders (site_id, warehouse_id, order_date, usage_date,
                                  order_type, status, notes, created_by, expected_delivery_date,
                                  step2_snapshot, step3_snapshot, meal_counts_snapshot, snapshot_created_at,
                                  parent_order_id)
                VALUES (%s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, NOW(), %s)
                RETURNING id, order_number
            """, (site_id, warehouse_id, order_date, usage_date, order_type, notes, created_by, order_date,
                  Json(step2_snapshot) if step2_snapshot else None,
                  Json(step3_snapshot) if step3_snapshot else None,
                  Json(meal_counts_snapshot) if meal_counts_snapshot else None,
                  parent_order_id))

            result = cursor.fetchone()
            order_id = result[0]
            order_number = result[1]

            # 발주 상세 품목 저장
            total_items = 0
            total_amount = 0

            # 🔧 중복 제거: [정규화] 완전 정규화된 키 (ingredient_id, meal_type, menu_name, category, slot_name, delivery_site)
            seen_items = {}
            unique_items = []
            for item in items:
                key = (
                    item.get("ingredient_id"),
                    item.get("meal_type"),
                    item.get("menu_name"),
                    item.get("meal_category"),
                    item.get("slot_name"),
                    item.get("delivery_site_name")
                )
                if key not in seen_items:
                    seen_items[key] = True
                    unique_items.append(item)
                else:
                    print(f"[WARN] 중복 항목 제거: {item.get('ingredient_name')} / {item.get('meal_type')} / {item.get('slot_name')} / {item.get('delivery_site_name')}", flush=True)

            if len(items) != len(unique_items):
                print(f"[WARN] 발주서 생성 시 중복 제거: {len(items)}건 → {len(unique_items)}건", flush=True)

            # base_weight_grams 일괄 조회 (성능 최적화)
            ingredient_codes = [item.get("ingredient_code") for item in unique_items if item.get("ingredient_code")]
            base_weight_map = {}  # {ingredient_code: base_weight_grams}
            if ingredient_codes:
                placeholders = ','.join(['%s'] * len(ingredient_codes))
                cursor.execute(
                    f"SELECT ingredient_code, base_weight_grams FROM ingredients WHERE ingredient_code IN ({placeholders})",
                    ingredient_codes
                )
                for row in cursor.fetchall():
                    if row[1]:
                        base_weight_map[row[0]] = float(row[1])

            # 일괄 INSERT를 위한 데이터 준비
            insert_values = []
            for item in unique_items:
                ingredient_id = item.get("ingredient_id")
                ingredient_code = item.get("ingredient_code")
                order_qty = float(item.get("order_qty", 0))

                # 단가: 클라이언트 값 우선, 없으면 usage_date 기준 유효 단가 조회
                unit_price = float(item.get("unit_price", 0))
                if unit_price <= 0 and ingredient_id:
                    unit_price = get_effective_price_for_date(cursor, ingredient_id, usage_date)

                total_price = order_qty * unit_price
                lead_time = int(item.get("lead_time", 2))
                expected_delivery_date = order_date
                category_counts = item.get("category_counts") or item.get("categories")

                # required_qty는 이미 kg 단위로 계산되어 있음 (Line 568)
                required_qty_kg = float(item.get("required_qty", 0) or 0)
                base_weight_g = base_weight_map.get(ingredient_code, 1000)  # 기준용량 (카테고리별 계산용)

                # category_counts는 이미 kg 단위 (변환 불필요)
                if category_counts:
                    # 이미 kg 단위로 계산되어 있으므로 그대로 사용
                    pass

                # ★ per_person_qty_g: 1인필요량(g) - 조리지시서/소분지시서의 기준값
                per_person_qty_g = float(item.get("per_person_qty_g") or 0)

                insert_values.append((
                    order_id,
                    ingredient_id,
                    ingredient_code,
                    item.get("ingredient_name"),
                    item.get("specification"),
                    item.get("supplier_id"),
                    item.get("supplier_name"),
                    item.get("meal_type"),
                    item.get("meal_category"),
                    (item.get("menu_name") or '').strip(),  # ★ 메뉴명 trim
                    item.get("slot_name"),           # [정규화] 슬롯명
                    item.get("delivery_site_name"),  # [정규화] 납품처
                    item.get("meal_plan_date"),
                    item.get("per_person_qty"),
                    per_person_qty_g,                # ★ 1인필요량(g)
                    item.get("meal_count"),
                    required_qty_kg,  # kg로 변환된 값
                    item.get("current_stock", 0),
                    order_qty,
                    item.get("unit", "kg") if item.get("is_manual") else "kg",  # 수동입력은 원래 단위 유지
                    unit_price,
                    total_price,
                    lead_time,
                    item.get("can_order", True),
                    item.get("warning"),
                    expected_delivery_date,
                    Json(category_counts) if category_counts else None  # kg로 변환된 category_counts
                ))

                total_items += 1
                total_amount += total_price

            # 일괄 INSERT 실행 (성능 최적화)
            if insert_values:
                execute_values(cursor, """
                    INSERT INTO order_items (order_id, ingredient_id, ingredient_code, ingredient_name,
                        specification, supplier_id, supplier_name,
                        meal_type, meal_category, menu_name, slot_name, delivery_site_name, meal_plan_date,
                        per_person_qty, per_person_qty_g, meal_count, required_qty, current_stock,
                        order_qty, unit, unit_price, total_price, lead_time, can_order, order_warning,
                        expected_delivery_date, category_counts)
                    VALUES %s
                """, insert_values)

            # 발주서 합계 업데이트
            cursor.execute("""
                UPDATE orders SET total_items = %s, total_amount = %s
                WHERE id = %s
            """, (total_items, total_amount, order_id))

            conn.commit()

            response = {
                "success": True,
                "data": {
                    "order_id": order_id,
                    "order_number": order_number,
                    "total_items": total_items,
                    "total_amount": total_amount
                },
                "message": f"발주서 {order_number}가 생성되었습니다."
            }

            # 휴무일 경고가 있으면 응답에 포함
            if blackout_suppliers:
                response["warnings"] = {
                    "blackout_suppliers": blackout_suppliers,
                    "message": "일부 협력업체가 휴무 기간입니다. 배송이 지연될 수 있습니다."
                }

            return response

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.put("/api/orders/{order_id}/confirm")
async def confirm_order(order_id: int, request: Request):
    """발주서 확정"""
    try:
        data = await request.json()
        confirmed_by = data.get("confirmed_by")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 상태 확인
            cursor.execute("SELECT status FROM orders WHERE id = %s", (order_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            if result[0] == 'locked':
                return {"success": False, "error": "이미 잠긴 발주서입니다."}

            if result[0] == 'confirmed':
                return {"success": False, "error": "이미 확정된 발주서입니다."}

            # 확정 처리
            cursor.execute("""
                UPDATE orders
                SET status = 'confirmed', confirmed_by = %s, confirmed_at = NOW(), updated_at = NOW()
                WHERE id = %s
            """, (confirmed_by, order_id))

            conn.commit()

            return {"success": True, "message": "발주서가 확정되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/orders/{order_id}/lock")
async def lock_order(order_id: int):
    """발주서 잠금 (날짜 지난 후)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE orders
                SET status = 'locked', locked_at = NOW(), updated_at = NOW()
                WHERE id = %s AND status != 'locked'
            """, (order_id,))

            affected = cursor.rowcount
            conn.commit()

            if affected > 0:
                return {"success": True, "message": "발주서가 잠겼습니다."}
            else:
                return {"success": False, "error": "이미 잠긴 발주서이거나 존재하지 않습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/orders/{order_id}/status")
async def update_order_status(order_id: int, request: Request):
    """발주서 상태 변경 (draft -> confirmed -> locked)"""
    try:
        data = await request.json()
        new_status = data.get('status')

        if new_status not in ['draft', 'confirmed', 'locked']:
            return {"success": False, "error": "유효하지 않은 상태입니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 현재 상태 확인
            cursor.execute("SELECT status FROM orders WHERE id = %s", (order_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            current_status = result[0]

            # 상태 전환 규칙 체크
            if current_status == 'locked' and new_status != 'locked':
                return {"success": False, "error": "완료된 발주서의 상태는 변경할 수 없습니다."}

            # 상태 업데이트
            cursor.execute("""
                UPDATE orders
                SET status = %s, updated_at = NOW()
                WHERE id = %s
            """, (new_status, order_id))

            conn.commit()

            status_names = {'draft': '임시', 'confirmed': '확정', 'locked': '완료'}
            return {
                "success": True,
                "message": f"발주서 상태가 '{status_names.get(new_status, new_status)}'(으)로 변경되었습니다."
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/orders/fix-delivery-dates")
async def fix_delivery_dates():
    """기존 발주 품목의 입고예정일 일괄 수정"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # expected_delivery_date가 NULL인 품목들 업데이트
            # expected_delivery_date = order_date + lead_time
            cursor.execute("""
                UPDATE order_items oi
                SET expected_delivery_date = (
                    SELECT o.order_date + INTERVAL '1 day' * COALESCE(oi.lead_time, 2)
                    FROM orders o
                    WHERE o.id = oi.order_id
                )
                WHERE oi.expected_delivery_date IS NULL
            """)

            updated_count = cursor.rowcount
            conn.commit()

            return {
                "success": True,
                "message": f"{updated_count}개 품목의 입고예정일이 설정되었습니다."
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/orders/{order_id}")
async def update_order(order_id: int, request: Request):
    """발주서 수정 (draft 상태만) - 수량 조정 기능"""
    try:
        data = await request.json()
        items = data.get("items", [])
        step3_snapshot = data.get("step3_snapshot")  # Step 5 수정 시 스냅샷 업데이트
        request_site_id = data.get("site_id")  # 클라이언트에서 전송한 site_id (소유권 검증용)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 상태 및 소유권 확인
            cursor.execute("SELECT status, order_date, order_number, site_id, usage_date FROM orders WHERE id = %s", (order_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            if result[0] != 'draft':
                return {"success": False, "error": "초안 상태의 발주서만 수정할 수 있습니다. 확정된 발주서는 수정할 수 없습니다."}

            order_date = result[1]
            order_number = result[2]
            order_site_id = result[3]
            order_usage_date = result[4]

            # ★ site_id 소유권 검증: 다른 사업장의 발주서를 덮어쓰는 것 방지
            if request_site_id and order_site_id and int(request_site_id) != int(order_site_id):
                print(f"[WARN] 발주서 수정 site_id 불일치: 요청={request_site_id}, 발주서={order_site_id} (order_id={order_id})", flush=True)
                return {"success": False, "error": f"사업장이 일치하지 않습니다. 이 발주서는 다른 사업장(ID:{order_site_id})의 발주서입니다."}

            # ★ usage_date 불일치 감지: 다른 날짜의 발주서를 덮어쓰는 것 방지
            request_usage_date = data.get("usage_date")
            if request_usage_date and order_usage_date:
                order_usage_str = str(order_usage_date)
                if request_usage_date != order_usage_str:
                    print(f"[BLOCK] 발주서 수정 usage_date 불일치: 요청={request_usage_date}, 발주서={order_usage_str} (order_id={order_id}, number={order_number})", flush=True)
                    return {"success": False, "error": f"사용일자가 일치하지 않습니다. 이 발주서는 {order_usage_str}의 발주서인데, {request_usage_date} 데이터로 수정하려고 합니다. 페이지를 새로고침 후 다시 시도해주세요."}

            # 기존 order_items 삭제
            cursor.execute("DELETE FROM order_items WHERE order_id = %s", (order_id,))

            # 새로운 발주 상세 품목 저장
            total_items = 0
            total_amount = 0

            # 🔧 중복 제거: [정규화] 완전 정규화된 키 (POST create_order와 동일 기준)
            seen_items = {}
            unique_items = []
            for item in items:
                key = (
                    item.get("ingredient_id"),
                    item.get("meal_type"),
                    item.get("menu_name"),
                    item.get("meal_category"),
                    item.get("slot_name"),
                    item.get("delivery_site_name")
                )
                if key not in seen_items:
                    seen_items[key] = True
                    unique_items.append(item)
                else:
                    print(f"[WARN] 수정 시 중복 항목 제거: {item.get('ingredient_name')} / {item.get('meal_type')} / {item.get('slot_name')} / {item.get('delivery_site_name')}", flush=True)

            # base_weight_grams 일괄 조회 (성능 최적화)
            ingredient_codes = [item.get("ingredient_code") for item in unique_items if item.get("ingredient_code")]
            base_weight_map = {}  # {ingredient_code: base_weight_grams}
            if ingredient_codes:
                placeholders = ','.join(['%s'] * len(ingredient_codes))
                cursor.execute(
                    f"SELECT ingredient_code, base_weight_grams FROM ingredients WHERE ingredient_code IN ({placeholders})",
                    ingredient_codes
                )
                for row in cursor.fetchall():
                    if row[1]:
                        base_weight_map[row[0]] = float(row[1])

            # 일괄 INSERT를 위한 데이터 준비
            insert_values = []
            for item in unique_items:
                order_qty = float(item.get("order_qty", 0))
                required_qty = float(item.get("required_qty", 0) or 0)

                # ★ 발주량이 0이어도 필요량이 있으면 저장 (재고 사용 항목도 조리지시서에 필요)
                # 발주량과 필요량 모두 0인 경우에만 제외
                if order_qty <= 0 and required_qty <= 0:
                    continue

                ingredient_id = item.get("ingredient_id")
                ingredient_code = item.get("ingredient_code")
                unit_price = float(item.get("unit_price", 0))
                total_price = order_qty * unit_price

                # 입고예정일 계산
                lead_time = int(item.get("lead_time", 2))
                if order_date:
                    order_date_obj = order_date if isinstance(order_date, date) else datetime.strptime(str(order_date), "%Y-%m-%d").date()
                    expected_delivery_date = order_date_obj + timedelta(days=lead_time)
                else:
                    expected_delivery_date = None

                category_counts = item.get("category_counts") or item.get("categories")

                # required_qty는 이미 kg 단위로 계산되어 있음 (Line 568)
                required_qty_kg = float(item.get("required_qty", 0) or 0)
                base_weight_g = base_weight_map.get(ingredient_code, 1000)  # 기준용량 (카테고리별 계산용)

                # category_counts는 이미 kg 단위 (변환 불필요)
                if category_counts:
                    # 이미 kg 단위로 계산되어 있으므로 그대로 사용
                    pass

                # ★ per_person_qty_g: 1인필요량(g) - 조리지시서/소분지시서의 기준값
                per_person_qty_g = float(item.get("per_person_qty_g") or 0)

                insert_values.append((
                    order_id,
                    ingredient_id,
                    ingredient_code,
                    item.get("ingredient_name"),
                    item.get("specification"),
                    item.get("supplier_id"),
                    item.get("supplier_name"),
                    item.get("meal_type"),
                    item.get("meal_category"),
                    (item.get("menu_name") or '').strip(),  # ★ 메뉴명 trim
                    item.get("slot_name"),           # [정규화] 슬롯명
                    item.get("delivery_site_name"),  # [정규화] 납품처
                    item.get("meal_plan_date"),
                    item.get("per_person_qty"),
                    per_person_qty_g,                # ★ 1인필요량(g)
                    item.get("meal_count"),
                    required_qty_kg,  # kg로 변환된 값
                    item.get("current_stock", 0),
                    order_qty,
                    item.get("unit", "kg") if item.get("is_manual") else "kg",  # 수동입력은 원래 단위 유지
                    unit_price,
                    total_price,
                    lead_time,
                    item.get("can_order", True),
                    item.get("warning"),
                    expected_delivery_date,
                    Json(category_counts) if category_counts else None  # kg로 변환된 category_counts
                ))

                total_items += 1
                total_amount += total_price

            # 일괄 INSERT 실행 (성능 최적화)
            if insert_values:
                execute_values(cursor, """
                    INSERT INTO order_items (order_id, ingredient_id, ingredient_code, ingredient_name,
                        specification, supplier_id, supplier_name,
                        meal_type, meal_category, menu_name, slot_name, delivery_site_name, meal_plan_date,
                        per_person_qty, per_person_qty_g, meal_count, required_qty, current_stock,
                        order_qty, unit, unit_price, total_price, lead_time, can_order, order_warning,
                        expected_delivery_date, category_counts)
                    VALUES %s
                """, insert_values)

            # 발주서 합계 업데이트 (+ step3_snapshot이 있으면 함께 업데이트)
            cursor.execute("""
                UPDATE orders SET total_items = %s, total_amount = %s,
                       step3_snapshot = COALESCE(%s, step3_snapshot),
                       updated_at = NOW()
                WHERE id = %s
            """, (total_items, total_amount,
                  Json(step3_snapshot) if step3_snapshot else None,
                  order_id))

            conn.commit()

            return {
                "success": True,
                "data": {
                    "order_id": order_id,
                    "order_number": order_number,
                    "total_items": total_items,
                    "total_amount": total_amount
                },
                "message": f"발주서가 수정되었습니다. (총 {total_items}개 품목, {total_amount:,.0f}원)"
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/orders/{order_id}")
async def delete_order(order_id: int):
    """발주서 삭제 (draft, confirmed 상태 가능, locked는 불가)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 삭제 전 발주서 정보 조회 (로깅용)
            cursor.execute("""
                SELECT order_number, status, site_id, order_date, usage_date, total_items, total_amount
                FROM orders WHERE id = %s
            """, (order_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            order_number, status, site_id, order_date, usage_date, total_items, total_amount = result

            if status == 'locked':
                return {"success": False, "error": "완료(잠금) 상태의 발주서는 삭제할 수 없습니다."}

            # ★ 삭제 로깅 (발주서 유실 추적용)
            print(f"[DELETE ORDER] id={order_id}, number={order_number}, site_id={site_id}, "
                  f"status={status}, order_date={order_date}, usage_date={usage_date}, "
                  f"items={total_items}, amount={total_amount}", flush=True)

            # 삭제 (CASCADE로 order_items도 함께 삭제됨)
            cursor.execute("DELETE FROM orders WHERE id = %s", (order_id,))
            conn.commit()

            return {"success": True, "message": "발주서가 삭제되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 자동 잠금 API (스케줄러용)
# ============================================

@router.post("/api/orders/auto-lock")
async def auto_lock_orders():
    """식단표 날짜가 지난 발주서 자동 잠금"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE orders
                SET status = 'locked', locked_at = NOW(), updated_at = NOW()
                WHERE usage_date < CURRENT_DATE
                  AND status NOT IN ('locked', 'cancelled')
            """)

            affected = cursor.rowcount
            conn.commit()

            return {
                "success": True,
                "message": f"{affected}개 발주서가 자동 잠금되었습니다.",
                "locked_count": affected
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/orders/manual-item")
async def add_manual_item(request: Request):
    """수동 기타 품목 즉시 저장 (발주서 확정 없이)"""
    try:
        body = await request.json()
        site_id = body.get("site_id")
        usage_date = body.get("usage_date")  # 식단표 날짜
        order_date = body.get("order_date")  # 입고일
        item = body.get("item", {})

        if not site_id or not usage_date:
            return {"success": False, "error": "site_id와 usage_date는 필수입니다."}

        ingredient_name = item.get("ingredient_name", "").strip()
        if not ingredient_name:
            return {"success": False, "error": "품명이 필요합니다."}

        order_qty = float(item.get("order_qty", 0))
        unit_price = float(item.get("unit_price", 0))
        total_price = order_qty * unit_price

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 해당 날짜에 기존 발주서가 있는지 확인 (status != cancelled)
            cursor.execute("""
                SELECT id FROM orders
                WHERE site_id = %s AND usage_date = %s AND status != 'cancelled'
                ORDER BY id DESC LIMIT 1
            """, (site_id, usage_date))
            row = cursor.fetchone()

            if row:
                order_id = row[0]
            else:
                # 발주서가 없으면 새로 생성 (draft 상태)
                cursor.execute("""
                    INSERT INTO orders (site_id, usage_date, order_date, status, order_type, total_amount)
                    VALUES (%s, %s, %s, 'draft', 'additional', 0)
                    RETURNING id
                """, (site_id, usage_date, order_date or usage_date))
                order_id = cursor.fetchone()[0]

            # order_items에 추가
            ingredient_id = item.get("ingredient_id")
            if ingredient_id:
                ingredient_id = int(ingredient_id)

            cursor.execute("""
                INSERT INTO order_items (
                    order_id, ingredient_id, ingredient_code, ingredient_name,
                    specification, supplier_name,
                    meal_type, meal_plan_date,
                    required_qty, order_qty, unit, unit_price, total_price,
                    can_order, order_warning
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s, %s, %s, %s,
                    TRUE, %s
                ) RETURNING id
            """, (
                order_id,
                ingredient_id,
                item.get("ingredient_code", ""),
                ingredient_name,
                item.get("specification", ""),
                item.get("supplier_name", "마트구매"),
                item.get("meal_type", "기타"),
                usage_date,
                order_qty,
                order_qty,
                item.get("unit", "EA"),
                unit_price,
                total_price,
                item.get("remarks", "수동 추가 (직접입력)")
            ))
            item_id = cursor.fetchone()[0]

            # 발주서 총액 업데이트
            cursor.execute("""
                UPDATE orders SET total_amount = (
                    SELECT COALESCE(SUM(total_price), 0) FROM order_items WHERE order_id = %s
                ) WHERE id = %s
            """, (order_id, order_id))

            conn.commit()

            return {
                "success": True,
                "message": f"'{ingredient_name}' 저장 완료",
                "order_id": order_id,
                "item_id": item_id,
                "total_price": total_price
            }

    except Exception as e:
        print(f"[ERROR] 수동 품목 저장 실패: {e}", flush=True)
        return {"success": False, "error": str(e)}


