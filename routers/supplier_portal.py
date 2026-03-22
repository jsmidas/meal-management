#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Supplier Portal Router
협력업체 포털 API 엔드포인트
"""

import hashlib
import secrets
import io
import bcrypt
from datetime import datetime, date, timedelta
from decimal import Decimal
import calendar
from fastapi import APIRouter, Request, Query, Response
from fastapi.responses import StreamingResponse
from typing import Optional
from core.database import get_db_connection

router = APIRouter()


def hash_password(password: str) -> str:
    """비밀번호 해시 생성 (bcrypt 직접 사용)"""
    password_bytes = password.encode('utf-8')[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """비밀번호 검증 (bcrypt 우선, SHA256 하위호환)"""
    if password_hash and password_hash.startswith('$2'):
        password_bytes = password.encode('utf-8')[:72]
        return bcrypt.checkpw(password_bytes, password_hash.encode('utf-8'))
    # SHA256 레거시 호환
    return hashlib.sha256(password.encode()).hexdigest() == password_hash


def generate_api_key() -> str:
    """API 키 생성"""
    return secrets.token_hex(32)


# ============================================
# 협력업체 인증 API
# ============================================

@router.post("/api/supplier/login")
async def supplier_login(request: Request):
    """협력업체 로그인"""
    try:
        data = await request.json()
        login_id = data.get("login_id")
        password = data.get("password")

        if not login_id or not password:
            return {"success": False, "error": "아이디와 비밀번호를 입력해주세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, name, login_id, password_hash, portal_enabled
                FROM suppliers
                WHERE LOWER(login_id) = LOWER(%s)
            """, (login_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": "아이디 또는 비밀번호가 올바르지 않습니다."}

            supplier_id, name, db_login_id, password_hash, portal_enabled = row

            if not portal_enabled:
                return {"success": False, "error": "포털 접근 권한이 없습니다. 관리자에게 문의하세요."}

            if not password_hash or not verify_password(password, password_hash):
                return {"success": False, "error": "아이디 또는 비밀번호가 올바르지 않습니다."}

            # 마지막 로그인 시간 업데이트
            cursor.execute("""
                UPDATE suppliers SET last_login = NOW() WHERE id = %s
            """, (supplier_id,))
            conn.commit()

            return {
                "success": True,
                "data": {
                    "supplier_id": supplier_id,
                    "supplier_name": name,
                    "login_id": db_login_id
                },
                "message": f"{name} 로그인 성공"
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/supplier/init-all-accounts")
async def init_all_supplier_accounts():
    """모든 협력업체에 로그인 계정 초기화 (login_id=supplier_code, password=1234)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            default_password_hash = hash_password("1234")

            # 모든 협력업체에 login_id = supplier_code, password = 1234 설정
            cursor.execute("""
                UPDATE suppliers
                SET login_id = supplier_code,
                    password_hash = %s,
                    portal_enabled = TRUE,
                    updated_at = NOW()
                WHERE supplier_code IS NOT NULL AND supplier_code != ''
            """, (default_password_hash,))

            updated = cursor.rowcount
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"{updated}개 협력업체 계정이 초기화되었습니다.",
                "updated_count": updated
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/supplier/reset-password")
async def reset_supplier_password(request: Request):
    """협력업체 비밀번호 초기화 (관리자용)"""
    try:
        data = await request.json()
        supplier_id = data.get("supplier_id")
        new_password = data.get("new_password", "1234")  # 기본값 1234

        if not supplier_id:
            return {"success": False, "error": "협력업체 ID가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            password_hash = hash_password(new_password)

            cursor.execute("""
                UPDATE suppliers
                SET password_hash = %s, updated_at = NOW()
                WHERE id = %s
            """, (password_hash, supplier_id))

            if cursor.rowcount == 0:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "비밀번호가 초기화되었습니다."
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/supplier/register")
async def register_supplier_account(request: Request):
    """협력업체 계정 등록 (관리자용)"""
    try:
        data = await request.json()
        supplier_id = data.get("supplier_id")
        login_id = data.get("login_id")
        password = data.get("password")
        contact_email = data.get("contact_email")
        contact_phone = data.get("contact_phone")

        if not supplier_id or not login_id or not password:
            return {"success": False, "error": "필수 정보를 입력해주세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute("SELECT id FROM suppliers WHERE login_id = %s", (login_id,))
            if cursor.fetchone():
                return {"success": False, "error": "이미 사용 중인 아이디입니다."}

            # 계정 정보 업데이트
            password_hash = hash_password(password)
            api_key = generate_api_key()

            cursor.execute("""
                UPDATE suppliers
                SET login_id = %s, password_hash = %s, api_key = %s,
                    contact_email = %s, contact_phone = %s,
                    portal_enabled = TRUE, updated_at = NOW()
                WHERE id = %s
            """, (login_id, password_hash, api_key, contact_email, contact_phone, supplier_id))

            if cursor.rowcount == 0:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            conn.commit()

            return {
                "success": True,
                "message": "협력업체 계정이 등록되었습니다.",
                "data": {"api_key": api_key}
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체 사업장 목록 API
# ============================================

@router.get("/api/supplier/sites")
async def get_supplier_sites(supplier_id: int = Query(...)):
    """협력업체에 발주 허락된 사업장 목록 조회 (customer_supplier_mappings 기반)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT DISTINCT bl.id, bl.site_name, bl.site_code
                FROM customer_supplier_mappings csm
                JOIN business_locations bl ON csm.customer_id = bl.id
                WHERE csm.supplier_id = %s AND csm.is_active = 1
                  AND bl.is_active = 1
                  AND (bl.contract_end_date IS NULL OR bl.contract_end_date > CURRENT_DATE)
                ORDER BY bl.site_name
            """, (supplier_id,))
            rows = cursor.fetchall()

            cursor.close()

            sites = [{"id": r[0], "site_name": r[1], "site_code": r[2]} for r in rows]
            return {"success": True, "data": sites}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체 발주 조회 API
# ============================================

@router.get("/api/supplier/orders")
async def get_supplier_orders(
    supplier_id: int = Query(...),
    site_id: int = Query(None),
    status: str = Query(None),
    from_date: str = Query(None),
    to_date: str = Query(None),
    limit: int = Query(50)
):
    """협력업체별 발주 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            # 발주 조회 쿼리 (supplier_id 또는 supplier_name으로 매칭)
            query = """
                SELECT DISTINCT
                    o.id AS order_id,
                    o.order_number,
                    o.order_date,
                    o.usage_date AS delivery_date,
                    o.status,
                    sg.group_name AS site_name,
                    sg.group_name AS display_name,
                    '' AS short_address,
                    '' AS full_address,
                    w.name AS warehouse_name,
                    COUNT(oi.id) AS item_count,
                    SUM(oi.total_price) AS total_amount
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                LEFT JOIN warehouses w ON o.warehouse_id = w.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
            """
            params = [supplier_id, supplier_name]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            if status:
                query += " AND o.status = %s"
                params.append(status)

            if from_date:
                query += " AND o.order_date >= %s"
                params.append(from_date)

            if to_date:
                query += " AND o.order_date <= %s"
                params.append(to_date)

            query += """
                GROUP BY o.id, o.order_number, o.order_date, o.usage_date,
                         o.status, sg.group_name, w.name
                ORDER BY o.order_date DESC, o.id DESC
                LIMIT %s
            """
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            orders = []
            for row in rows:
                order = dict(zip(col_names, row))
                for key, value in order.items():
                    if isinstance(value, (datetime, date)):
                        order[key] = str(value)
                    elif isinstance(value, Decimal):
                        order[key] = float(value)
                orders.append(order)

            return {"success": True, "data": orders, "supplier_name": supplier_name}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/supplier/order-items")
async def get_supplier_order_items(
    supplier_id: int = Query(...),
    site_id: int = Query(None),
    status: str = Query(None),
    from_date: str = Query(None),
    to_date: str = Query(None),
    limit: int = Query(500)
):
    """협력업체별 발주 아이템 단위 조회 (입고일 기준)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            query = """
                SELECT
                    i.ingredient_code,
                    COALESCE(i.ingredient_name, oi.menu_name) AS ingredient_name,
                    i.specification,
                    oi.unit,
                    ROUND(SUM(oi.order_qty)::numeric, 2) AS order_qty,
                    MIN(oi.lead_time) AS lead_time,
                    sg.group_name AS site_name,
                    ROUND(SUM(oi.order_qty * COALESCE(i.base_weight_grams, 1000) / 1000.0)::numeric, 2) AS order_qty_kg
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND COALESCE(oi.order_qty, 0) > 0
                  AND o.status != 'draft'
                  AND COALESCE(i.ingredient_code, '') NOT IN ('DH99998', 'DH99999')
            """
            params = [supplier_id, supplier_name]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            if status:
                query += " AND o.status = %s"
                params.append(status)

            if from_date:
                query += " AND o.order_date >= %s"
                params.append(from_date)

            if to_date:
                query += " AND o.order_date <= %s"
                params.append(to_date)

            query += """
                GROUP BY i.ingredient_code,
                         COALESCE(i.ingredient_name, oi.menu_name),
                         i.specification, oi.unit, sg.group_name
                ORDER BY sg.group_name, i.ingredient_code, COALESCE(i.ingredient_name, oi.menu_name)
                LIMIT %s
            """
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]
            cursor.close()

            items = []
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            return {"success": True, "data": items, "supplier_name": supplier_name}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/supplier/orders/{order_id}")
async def get_supplier_order_detail(order_id: int, supplier_id: int = Query(...)):
    """협력업체별 발주 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            # 발주 기본 정보
            cursor.execute("""
                SELECT o.*, sg.group_name AS site_name, w.name AS warehouse_name, w.address AS warehouse_address
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

            for key, value in order.items():
                if isinstance(value, (datetime, date)):
                    order[key] = str(value)
                elif isinstance(value, Decimal):
                    order[key] = float(value)

            # 해당 협력업체의 발주 품목만 조회 (supplier_id 또는 supplier_name으로 매칭)
            # DH99998, DH99999 제외 + kg 변환값 추가
            cursor.execute("""
                SELECT
                    oi.id,
                    i.ingredient_code,
                    i.ingredient_name,
                    i.specification,
                    oi.unit,
                    oi.order_qty,
                    oi.unit_price,
                    oi.total_price,
                    oi.meal_type,
                    oi.menu_name,
                    ROUND((oi.order_qty * COALESCE(i.base_weight_grams, 1000) / 1000.0)::numeric, 2) AS order_qty_kg
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE oi.order_id = %s AND (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND COALESCE(i.ingredient_code, '') NOT IN ('DH99998', 'DH99999')
                ORDER BY oi.id
            """, (order_id, supplier_id, supplier_name))

            item_rows = cursor.fetchall()
            item_col_names = [desc[0] for desc in cursor.description]

            items = []
            for row in item_rows:
                item = dict(zip(item_col_names, row))
                for key, value in item.items():
                    if isinstance(value, Decimal):
                        item[key] = float(value)
                items.append(item)

            order["items"] = items
            order["supplier_item_count"] = len(items)
            order["supplier_total"] = sum(item.get("total_price", 0) for item in items)

            return {"success": True, "data": order, "supplier_name": supplier_name}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체 대시보드 API
# ============================================

@router.get("/api/supplier/dashboard")
async def get_supplier_dashboard(supplier_id: int = Query(...), site_id: int = Query(None)):
    """협력업체 대시보드 통계"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            # 상태별 발주 건수 (supplier_id 또는 supplier_name으로 매칭)
            status_query = """
                SELECT o.status, COUNT(DISTINCT o.id) AS count
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
            """
            status_params = [supplier_id, supplier_name]
            if site_id:
                status_query += " AND o.site_id = %s"
                status_params.append(site_id)
            status_query += " GROUP BY o.status"
            cursor.execute(status_query, status_params)
            status_counts = {row[0]: row[1] for row in cursor.fetchall()}

            # 이번 달 총 금액
            monthly_query = """
                SELECT COALESCE(SUM(oi.total_price), 0)
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND o.order_date >= DATE_TRUNC('month', CURRENT_DATE)
            """
            monthly_params = [supplier_id, supplier_name]
            if site_id:
                monthly_query += " AND o.site_id = %s"
                monthly_params.append(site_id)
            cursor.execute(monthly_query, monthly_params)
            monthly_total = float(cursor.fetchone()[0] or 0)

            # 오늘 배송 예정 건수
            today_query = """
                SELECT COUNT(DISTINCT o.id)
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND o.usage_date = CURRENT_DATE
                  AND o.status = 'confirmed'
            """
            today_params = [supplier_id, supplier_name]
            if site_id:
                today_query += " AND o.site_id = %s"
                today_params.append(site_id)
            cursor.execute(today_query, today_params)
            today_deliveries = cursor.fetchone()[0] or 0


            return {
                "success": True,
                "data": {
                    "supplier_name": supplier_name,
                    "status_counts": {
                        "draft": status_counts.get("draft", 0),
                        "confirmed": status_counts.get("confirmed", 0),
                        "locked": status_counts.get("locked", 0)
                    },
                    "monthly_total": monthly_total,
                    "today_deliveries": today_deliveries
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 엑셀 다운로드 API
# ============================================

@router.get("/api/supplier/receiving-statement")
async def get_receiving_statement(
    supplier_id: int = Query(...),
    site_id: int = Query(None),
    from_date: str = Query(None),
    to_date: str = Query(None),
    limit: int = Query(1000)
):
    """입고 명세서 조회 (입고일 기준)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            query = """
                SELECT
                    o.order_number,
                    o.usage_date AS delivery_date,
                    i.ingredient_code,
                    COALESCE(i.ingredient_name, oi.menu_name) AS ingredient_name,
                    i.specification,
                    o.order_date,
                    oi.lead_time,
                    oi.order_qty,
                    oi.unit,
                    sg.group_name AS site_name,
                    ROUND((oi.order_qty * COALESCE(i.base_weight_grams, 1000) / 1000.0)::numeric, 2) AS order_qty_kg
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND COALESCE(oi.order_qty, 0) > 0
                  AND COALESCE(i.ingredient_code, '') NOT IN ('DH99998', 'DH99999')
            """
            params = [supplier_id, supplier_name]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            if from_date:
                query += " AND o.order_date >= %s"
                params.append(from_date)

            if to_date:
                query += " AND o.order_date <= %s"
                params.append(to_date)

            query += " ORDER BY o.order_date, o.order_number, oi.id LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]
            cursor.close()

            # 입고일별 그룹핑
            grouped = {}
            for row in rows:
                item = dict(zip(col_names, row))
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = str(value)
                    elif isinstance(value, Decimal):
                        item[key] = float(value)
                delivery_date = item.get("delivery_date", "unknown")
                if delivery_date not in grouped:
                    grouped[delivery_date] = []
                grouped[delivery_date].append(item)

            return {"success": True, "data": grouped, "supplier_name": supplier_name}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/supplier/orders/{order_id}/excel")
async def download_order_excel(order_id: int, supplier_id: int = Query(...)):
    """발주서 엑셀 다운로드"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            # 발주 기본 정보
            cursor.execute("""
                SELECT o.order_number, o.order_date, o.usage_date,
                       sg.group_name AS site_name, w.name AS warehouse_name
                FROM orders o
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                LEFT JOIN warehouses w ON o.warehouse_id = w.id
                WHERE o.id = %s
            """, (order_id,))
            order_row = cursor.fetchone()

            if not order_row:
                return {"success": False, "error": "발주서를 찾을 수 없습니다."}

            order_number, order_date, usage_date, site_name, warehouse_name = order_row

            # 해당 협력업체의 발주 품목 조회 (supplier_id 또는 supplier_name으로 매칭)
            # DH99998, DH99999 제외 + kg 변환값 추가
            cursor.execute("""
                SELECT
                    i.ingredient_code AS "품목코드",
                    i.ingredient_name AS "품목명",
                    i.specification AS "규격",
                    oi.unit AS "단위",
                    oi.order_qty AS "수량",
                    oi.unit_price AS "단가",
                    oi.total_price AS "금액",
                    ROUND((oi.order_qty * COALESCE(i.base_weight_grams, 1000) / 1000.0)::numeric, 2) AS "수량(kg)"
                FROM order_items oi
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                WHERE oi.order_id = %s AND (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND COALESCE(i.ingredient_code, '') NOT IN ('DH99998', 'DH99999')
                ORDER BY oi.id
            """, (order_id, supplier_id, supplier_name))

            items = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            # CSV 형식으로 엑셀 호환 파일 생성
            output = io.StringIO()

            # 헤더 정보
            output.write(f"발주번호,{order_number}\n")
            output.write(f"입고일,{order_date}\n")
            output.write(f"식단표 날짜,{usage_date}\n")
            output.write(f"발주처,{site_name or ''}\n")
            output.write(f"납품장소,{warehouse_name or ''}\n")
            output.write(f"협력업체,{supplier_name}\n")
            output.write("\n")

            # 컬럼 헤더
            output.write(",".join(col_names) + "\n")

            # 데이터 행
            total_amount = 0
            for row in items:
                values = []
                for val in row:
                    if val is None:
                        values.append("")
                    elif isinstance(val, Decimal):
                        values.append(str(float(val)))
                        if col_names[row.index(val) if val in row else -1] == "금액":
                            total_amount += float(val)
                    else:
                        # CSV에서 쉼표 처리
                        str_val = str(val).replace(",", " ")
                        values.append(str_val)
                output.write(",".join(values) + "\n")

            # 합계
            output.write(f"\n합계,,,,,,{total_amount}\n")

            # 파일 응답
            content = output.getvalue()
            output.close()

            # BOM 추가 (한글 엑셀 호환)
            content_bytes = ('\ufeff' + content).encode('utf-8-sig')

            filename = f"order_{order_number}_{supplier_name}.csv"

            return Response(
                content=content_bytes,
                media_type="text/csv; charset=utf-8-sig",
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{filename}"
                }
            )

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체 프로필 관리 API
# ============================================

@router.get("/api/supplier/profile")
async def get_supplier_profile(supplier_id: int = Query(...)):
    """협력업체 프로필 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT name, login_id, contact_email, contact_phone,
                       business_number, representative, headquarters_address,
                       last_login
                FROM suppliers
                WHERE id = %s
            """, (supplier_id,))
            row = cursor.fetchone()
            cursor.close()

            if not row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            col_names = ["name", "login_id", "contact_email", "contact_phone",
                         "business_number", "representative", "headquarters_address",
                         "last_login"]
            profile = dict(zip(col_names, row))

            for key, value in profile.items():
                if isinstance(value, (datetime, date)):
                    profile[key] = str(value)

            return {"success": True, "data": profile}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/supplier/profile")
async def update_supplier_profile(request: Request):
    """협력업체 연락처 정보 수정"""
    try:
        data = await request.json()
        supplier_id = data.get("supplier_id")
        contact_email = data.get("contact_email", "")
        contact_phone = data.get("contact_phone", "")

        if not supplier_id:
            return {"success": False, "error": "협력업체 ID가 필요합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE suppliers
                SET contact_email = %s, contact_phone = %s, updated_at = NOW()
                WHERE id = %s
            """, (contact_email, contact_phone, supplier_id))

            if cursor.rowcount == 0:
                cursor.close()
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            conn.commit()
            cursor.close()

            return {"success": True, "message": "연락처 정보가 저장되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/supplier/change-password")
async def change_supplier_password(request: Request):
    """협력업체 비밀번호 변경 (본인)"""
    try:
        data = await request.json()
        supplier_id = data.get("supplier_id")
        current_password = data.get("current_password")
        new_password = data.get("new_password")

        if not supplier_id or not current_password or not new_password:
            return {"success": False, "error": "모든 항목을 입력해주세요."}

        if len(new_password) < 4:
            return {"success": False, "error": "새 비밀번호는 4자 이상이어야 합니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT password_hash FROM suppliers WHERE id = %s
            """, (supplier_id,))
            row = cursor.fetchone()

            if not row:
                cursor.close()
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            if not verify_password(current_password, row[0]):
                cursor.close()
                return {"success": False, "error": "현재 비밀번호가 올바르지 않습니다."}

            new_hash = hash_password(new_password)
            cursor.execute("""
                UPDATE suppliers
                SET password_hash = %s, updated_at = NOW()
                WHERE id = %s
            """, (new_hash, supplier_id))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "비밀번호가 변경되었습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/supplier/orders/excel")
async def download_orders_excel(
    supplier_id: int = Query(...),
    site_id: int = Query(None),
    from_date: str = Query(None),
    to_date: str = Query(None)
):
    """기간별 발주 목록 엑셀 다운로드"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체명 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            supplier_row = cursor.fetchone()
            if not supplier_row:
                return {"success": False, "error": "협력업체를 찾을 수 없습니다."}

            supplier_name = supplier_row[0]

            # 발주 품목 전체 조회 (supplier_id 또는 supplier_name으로 매칭)
            # DH99998, DH99999 제외 + kg 변환값 추가
            query = """
                SELECT
                    o.order_number AS "발주번호",
                    o.order_date AS "입고일",
                    o.usage_date AS "식단표 날짜",
                    sg.group_name AS "발주처",
                    o.status AS "상태",
                    i.ingredient_code AS "품목코드",
                    i.ingredient_name AS "품목명",
                    i.specification AS "규격",
                    oi.unit AS "단위",
                    oi.order_qty AS "수량",
                    oi.unit_price AS "단가",
                    oi.total_price AS "금액",
                    ROUND((oi.order_qty * COALESCE(i.base_weight_grams, 1000) / 1000.0)::numeric, 2) AS "수량(kg)"
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN ingredients i ON oi.ingredient_id = i.id
                LEFT JOIN site_groups sg ON o.site_id = sg.id
                WHERE (oi.supplier_id = %s OR i.supplier_name = %s)
                  AND COALESCE(i.ingredient_code, '') NOT IN ('DH99998', 'DH99999')
            """
            params = [supplier_id, supplier_name]

            if site_id:
                query += " AND o.site_id = %s"
                params.append(site_id)

            if from_date:
                query += " AND o.order_date >= %s"
                params.append(from_date)

            if to_date:
                query += " AND o.order_date <= %s"
                params.append(to_date)

            query += " ORDER BY o.order_date DESC, o.id, oi.id"

            cursor.execute(query, params)
            items = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            # CSV 생성
            output = io.StringIO()

            # 헤더 정보
            output.write(f"협력업체,{supplier_name}\n")
            if from_date:
                output.write(f"조회기간 시작,{from_date}\n")
            if to_date:
                output.write(f"조회기간 종료,{to_date}\n")
            output.write(f"다운로드 일시,{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            output.write("\n")

            # 컬럼 헤더
            output.write(",".join(col_names) + "\n")

            # 데이터 행
            total_amount = 0
            for row in items:
                values = []
                for idx, val in enumerate(row):
                    if val is None:
                        values.append("")
                    elif isinstance(val, (datetime, date)):
                        values.append(str(val))
                    elif isinstance(val, Decimal):
                        float_val = float(val)
                        values.append(str(float_val))
                        if col_names[idx] == "금액":
                            total_amount += float_val
                    else:
                        str_val = str(val).replace(",", " ")
                        values.append(str_val)
                output.write(",".join(values) + "\n")

            # 합계
            output.write(f"\n합계,,,,,,,,,,,{total_amount}\n")

            content = output.getvalue()
            output.close()

            content_bytes = ('\ufeff' + content).encode('utf-8-sig')

            date_range = f"{from_date or 'all'}_{to_date or 'all'}"
            filename = f"orders_{supplier_name}_{date_range}.csv"

            return Response(
                content=content_bytes,
                media_type="text/csv; charset=utf-8-sig",
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{filename}"
                }
            )

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 발주불가일 캘린더 API
# ============================================

@router.get("/api/supplier/blackout-calendar")
async def get_blackout_calendar(
    supplier_id: int = Query(...),
    year: int = Query(...),
    month: int = Query(...)
):
    """월간 발주불가일 캘린더 데이터 반환 (일요일 자동 시드 포함)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 해당 월의 첫날/마지막날
            first_day = date(year, month, 1)
            last_day = date(year, month, calendar.monthrange(year, month)[1])

            # 해당 월에 겹치는 blackout 기간 조회
            cursor.execute("""
                SELECT id, start_date, end_date, reason
                FROM supplier_blackout_periods
                WHERE supplier_id = %s
                  AND is_active = TRUE
                  AND start_date <= %s
                  AND end_date >= %s
            """, (supplier_id, last_day, first_day))
            rows = cursor.fetchall()

            # 레코드가 0건이면 일요일 자동 시드
            if len(rows) == 0:
                sundays = []
                d = first_day
                while d <= last_day:
                    if d.weekday() == 6:  # Sunday
                        sundays.append(d)
                    d += timedelta(days=1)

                for sun in sundays:
                    cursor.execute("""
                        INSERT INTO supplier_blackout_periods
                            (supplier_id, start_date, end_date, reason, is_active)
                        VALUES (%s, %s, %s, %s, TRUE)
                    """, (supplier_id, sun, sun, "일요일(기본)"))
                conn.commit()

                # 다시 조회
                cursor.execute("""
                    SELECT id, start_date, end_date, reason
                    FROM supplier_blackout_periods
                    WHERE supplier_id = %s
                      AND is_active = TRUE
                      AND start_date <= %s
                      AND end_date >= %s
                """, (supplier_id, last_day, first_day))
                rows = cursor.fetchall()

            cursor.close()

            # 기간을 개별 날짜로 확장
            blackout_dates = {}
            for row in rows:
                rec_id, s_date, e_date, reason = row
                d = max(s_date, first_day)
                end = min(e_date, last_day)
                while d <= end:
                    blackout_dates[str(d)] = reason or ""
                    d += timedelta(days=1)

            return {
                "success": True,
                "data": {
                    "year": year,
                    "month": month,
                    "blackout_dates": blackout_dates
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/supplier/blackout-date/toggle")
async def toggle_blackout_date(request: Request):
    """단일 날짜 발주불가일 토글 (있으면 삭제, 없으면 생성)"""
    try:
        data = await request.json()
        supplier_id = data.get("supplier_id")
        date_str = data.get("date")

        if not supplier_id or not date_str:
            return {"success": False, "error": "supplier_id와 date가 필요합니다."}

        target = date.fromisoformat(date_str)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 해당 날짜에 정확히 매칭되는 단일일 레코드 확인
            cursor.execute("""
                SELECT id FROM supplier_blackout_periods
                WHERE supplier_id = %s
                  AND start_date = %s AND end_date = %s
                  AND is_active = TRUE
            """, (supplier_id, target, target))
            existing = cursor.fetchone()

            if existing:
                # 삭제
                cursor.execute("""
                    DELETE FROM supplier_blackout_periods WHERE id = %s
                """, (existing[0],))
                conn.commit()
                cursor.close()
                return {"success": True, "blackout": False, "date": date_str}
            else:
                # 생성
                cursor.execute("""
                    INSERT INTO supplier_blackout_periods
                        (supplier_id, start_date, end_date, reason, is_active)
                    VALUES (%s, %s, %s, %s, TRUE)
                """, (supplier_id, target, target, "발주불가"))
                conn.commit()
                cursor.close()
                return {"success": True, "blackout": True, "date": date_str}

    except Exception as e:
        return {"success": False, "error": str(e)}
