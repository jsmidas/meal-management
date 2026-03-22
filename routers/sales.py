#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sales Router
매출가 관리 API 엔드포인트 (월매출, 메뉴단가, 행사매출)
"""

from fastapi import APIRouter, Request, HTTPException
from core.database import get_db_connection
from typing import Optional

router = APIRouter()


# ========== 월매출 API ==========

@router.get("/api/sales/monthly")
async def get_monthly_sales(
    site_id: Optional[int] = None,
    year: Optional[int] = None,
    year_month: Optional[str] = None  # '2025-01' 형식
):
    """월매출 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    sms.id, sms.site_id, sms.year_month,
                    sms.sales_amount, sms.vat_amount, sms.total_amount,
                    sms.memo, sms.created_at, sms.updated_at,
                    bl.site_name
                FROM site_monthly_sales sms
                LEFT JOIN business_locations bl ON sms.site_id = bl.id
                WHERE 1=1
            """
            params = []

            if site_id:
                query += " AND sms.site_id = %s"
                params.append(site_id)

            if year:
                query += " AND sms.year_month LIKE %s"
                params.append(f"{year}-%")

            if year_month:
                query += " AND sms.year_month = %s"
                params.append(year_month)

            query += " ORDER BY sms.year_month DESC, sms.site_id"

            cursor.execute(query, params if params else None)
            columns = [desc[0] for desc in cursor.description]
            sales = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "data": sales
            }

    except Exception as e:
        print(f"[MONTHLY SALES ERROR] {e}")
        return {"success": False, "error": f"월매출 조회 실패: {str(e)}"}


@router.post("/api/sales/monthly")
async def save_monthly_sales(request: Request):
    """월매출 등록/수정 (UPSERT)"""
    try:
        data = await request.json()

        site_id = data.get('site_id')
        year_month = data.get('year_month')
        sales_amount = data.get('sales_amount', 0)
        vat_amount = data.get('vat_amount', 0)
        memo = data.get('memo', '')

        if not site_id or not year_month:
            return {"success": False, "error": "사업장과 년월은 필수입니다"}

        # 부가세 계산 (매출액의 10%)
        if vat_amount == 0 and sales_amount > 0:
            vat_amount = sales_amount * 0.1

        total_amount = sales_amount + vat_amount

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO site_monthly_sales (site_id, year_month, sales_amount, vat_amount, total_amount, memo)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (site_id, year_month)
                DO UPDATE SET
                    sales_amount = EXCLUDED.sales_amount,
                    vat_amount = EXCLUDED.vat_amount,
                    total_amount = EXCLUDED.total_amount,
                    memo = EXCLUDED.memo,
                    updated_at = NOW()
                RETURNING id
            """, (site_id, year_month, sales_amount, vat_amount, total_amount, memo))

            sales_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {"id": sales_id},
                "message": "월매출이 저장되었습니다"
            }

    except Exception as e:
        print(f"[MONTHLY SALES SAVE ERROR] {e}")
        return {"success": False, "error": f"월매출 저장 실패: {str(e)}"}


@router.delete("/api/sales/monthly/{sales_id}")
async def delete_monthly_sales(sales_id: int):
    """월매출 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM site_monthly_sales WHERE id = %s", (sales_id,))

            if cursor.rowcount == 0:
                cursor.close()
                raise HTTPException(status_code=404, detail="월매출 데이터를 찾을 수 없습니다")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "월매출이 삭제되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[MONTHLY SALES DELETE ERROR] {e}")
        return {"success": False, "error": f"월매출 삭제 실패: {str(e)}"}


# ========== 메뉴 단가 API ==========

@router.get("/api/sales/menu-prices")
async def get_menu_prices(
    site_id: Optional[int] = None,
    menu_name: Optional[str] = None
):
    """메뉴 단가 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    mp.id, mp.site_id, mp.menu_name, mp.price,
                    mp.vat_included, mp.effective_date, mp.created_at,
                    bl.site_name
                FROM menu_prices mp
                LEFT JOIN business_locations bl ON mp.site_id = bl.id
                WHERE 1=1
            """
            params = []

            if site_id:
                query += " AND mp.site_id = %s"
                params.append(site_id)

            if menu_name:
                query += " AND mp.menu_name ILIKE %s"
                params.append(f"%{menu_name}%")

            query += " ORDER BY mp.site_id, mp.menu_name, mp.effective_date DESC"

            cursor.execute(query, params if params else None)
            columns = [desc[0] for desc in cursor.description]
            prices = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "data": prices
            }

    except Exception as e:
        print(f"[MENU PRICES ERROR] {e}")
        return {"success": False, "error": f"메뉴 단가 조회 실패: {str(e)}"}


@router.post("/api/sales/menu-prices")
async def save_menu_price(request: Request):
    """메뉴 단가 등록/수정"""
    try:
        data = await request.json()

        site_id = data.get('site_id')
        menu_name = data.get('menu_name')
        price = data.get('price', 0)
        vat_included = data.get('vat_included', False)
        effective_date = data.get('effective_date')  # 'YYYY-MM-DD' 또는 None (오늘)

        if not site_id or not menu_name or not price:
            return {"success": False, "error": "사업장, 메뉴명, 단가는 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if effective_date:
                cursor.execute("""
                    INSERT INTO menu_prices (site_id, menu_name, price, vat_included, effective_date)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (site_id, menu_name, effective_date)
                    DO UPDATE SET
                        price = EXCLUDED.price,
                        vat_included = EXCLUDED.vat_included
                    RETURNING id
                """, (site_id, menu_name, price, vat_included, effective_date))
            else:
                cursor.execute("""
                    INSERT INTO menu_prices (site_id, menu_name, price, vat_included)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (site_id, menu_name, effective_date)
                    DO UPDATE SET
                        price = EXCLUDED.price,
                        vat_included = EXCLUDED.vat_included
                    RETURNING id
                """, (site_id, menu_name, price, vat_included))

            price_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {"id": price_id},
                "message": "메뉴 단가가 저장되었습니다"
            }

    except Exception as e:
        print(f"[MENU PRICE SAVE ERROR] {e}")
        return {"success": False, "error": f"메뉴 단가 저장 실패: {str(e)}"}


@router.delete("/api/sales/menu-prices/{price_id}")
async def delete_menu_price(price_id: int):
    """메뉴 단가 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM menu_prices WHERE id = %s", (price_id,))

            if cursor.rowcount == 0:
                cursor.close()
                raise HTTPException(status_code=404, detail="메뉴 단가 데이터를 찾을 수 없습니다")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "메뉴 단가가 삭제되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[MENU PRICE DELETE ERROR] {e}")
        return {"success": False, "error": f"메뉴 단가 삭제 실패: {str(e)}"}


# ========== 행사 매출 API ==========

@router.get("/api/sales/events")
async def get_event_sales(
    site_id: Optional[int] = None,
    event_type: Optional[str] = None,  # 'anniversary', 'buffet', 'special', 'other'
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    year: Optional[int] = None
):
    """행사 매출 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    es.id, es.site_id, es.event_date, es.event_name,
                    es.event_type, es.sales_amount, es.vat_amount, es.total_amount,
                    es.attendees, es.memo, es.created_at, es.updated_at,
                    bl.site_name
                FROM event_sales es
                LEFT JOIN business_locations bl ON es.site_id = bl.id
                WHERE 1=1
            """
            params = []

            if site_id:
                query += " AND es.site_id = %s"
                params.append(site_id)

            if event_type:
                query += " AND es.event_type = %s"
                params.append(event_type)

            if start_date:
                query += " AND es.event_date >= %s"
                params.append(start_date)

            if end_date:
                query += " AND es.event_date <= %s"
                params.append(end_date)

            if year:
                query += " AND EXTRACT(YEAR FROM es.event_date) = %s"
                params.append(year)

            query += " ORDER BY es.event_date DESC"

            cursor.execute(query, params if params else None)
            columns = [desc[0] for desc in cursor.description]
            events = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "data": events
            }

    except Exception as e:
        print(f"[EVENT SALES ERROR] {e}")
        return {"success": False, "error": f"행사 매출 조회 실패: {str(e)}"}


@router.post("/api/sales/events")
async def save_event_sales(request: Request):
    """행사 매출 등록"""
    try:
        data = await request.json()

        site_id = data.get('site_id')
        event_date = data.get('event_date')
        event_name = data.get('event_name')
        event_type = data.get('event_type', 'other')
        sales_amount = data.get('sales_amount', 0)
        vat_amount = data.get('vat_amount', 0)
        attendees = data.get('attendees')
        memo = data.get('memo', '')

        if not site_id or not event_date or not event_name:
            return {"success": False, "error": "사업장, 행사일, 행사명은 필수입니다"}

        # 부가세 계산
        if vat_amount == 0 and sales_amount > 0:
            vat_amount = sales_amount * 0.1

        total_amount = sales_amount + vat_amount

        with get_db_connection() as conn:
            cursor = conn.cursor()

            event_id = data.get('id')

            if event_id:
                # 수정
                cursor.execute("""
                    UPDATE event_sales SET
                        site_id = %s, event_date = %s, event_name = %s, event_type = %s,
                        sales_amount = %s, vat_amount = %s, total_amount = %s,
                        attendees = %s, memo = %s, updated_at = NOW()
                    WHERE id = %s
                    RETURNING id
                """, (site_id, event_date, event_name, event_type, sales_amount, vat_amount, total_amount, attendees, memo, event_id))
            else:
                # 신규 등록
                cursor.execute("""
                    INSERT INTO event_sales (site_id, event_date, event_name, event_type, sales_amount, vat_amount, total_amount, attendees, memo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (site_id, event_date, event_name, event_type, sales_amount, vat_amount, total_amount, attendees, memo))

            result_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {"id": result_id},
                "message": "행사 매출이 저장되었습니다"
            }

    except Exception as e:
        print(f"[EVENT SALES SAVE ERROR] {e}")
        return {"success": False, "error": f"행사 매출 저장 실패: {str(e)}"}


@router.delete("/api/sales/events/{event_id}")
async def delete_event_sales(event_id: int):
    """행사 매출 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM event_sales WHERE id = %s", (event_id,))

            if cursor.rowcount == 0:
                cursor.close()
                raise HTTPException(status_code=404, detail="행사 매출 데이터를 찾을 수 없습니다")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "행사 매출이 삭제되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[EVENT SALES DELETE ERROR] {e}")
        return {"success": False, "error": f"행사 매출 삭제 실패: {str(e)}"}


# ========== 매출 통계 API ==========

@router.get("/api/sales/summary")
async def get_sales_summary(
    site_id: Optional[int] = None,
    year: Optional[int] = None,
    year_month: Optional[str] = None
):
    """매출 요약 통계"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            result = {
                "monthly_total": 0,
                "event_total": 0,
                "combined_total": 0,
                "monthly_vat": 0,
                "event_vat": 0
            }

            # 월매출 합계
            monthly_query = """
                SELECT COALESCE(SUM(sales_amount), 0), COALESCE(SUM(vat_amount), 0)
                FROM site_monthly_sales
                WHERE 1=1
            """
            monthly_params = []

            if site_id:
                monthly_query += " AND site_id = %s"
                monthly_params.append(site_id)
            if year:
                monthly_query += " AND year_month LIKE %s"
                monthly_params.append(f"{year}-%")
            if year_month:
                monthly_query += " AND year_month = %s"
                monthly_params.append(year_month)

            cursor.execute(monthly_query, monthly_params if monthly_params else None)
            row = cursor.fetchone()
            result["monthly_total"] = float(row[0]) if row and row[0] else 0
            result["monthly_vat"] = float(row[1]) if row and row[1] else 0

            # 행사 매출 합계
            event_query = """
                SELECT COALESCE(SUM(sales_amount), 0), COALESCE(SUM(vat_amount), 0)
                FROM event_sales
                WHERE 1=1
            """
            event_params = []

            if site_id:
                event_query += " AND site_id = %s"
                event_params.append(site_id)
            if year:
                event_query += " AND EXTRACT(YEAR FROM event_date) = %s"
                event_params.append(year)
            if year_month:
                event_query += " AND TO_CHAR(event_date, 'YYYY-MM') = %s"
                event_params.append(year_month)

            cursor.execute(event_query, event_params if event_params else None)
            row = cursor.fetchone()
            result["event_total"] = float(row[0]) if row and row[0] else 0
            result["event_vat"] = float(row[1]) if row and row[1] else 0

            # 합계
            result["combined_total"] = result["monthly_total"] + result["event_total"]

            cursor.close()

            return {
                "success": True,
                "data": result
            }

    except Exception as e:
        print(f"[SALES SUMMARY ERROR] {e}")
        return {"success": False, "error": f"매출 통계 조회 실패: {str(e)}"}


# ========== 일매출 API ==========

@router.get("/api/sales/daily-revenue")
async def get_daily_revenue(
    site_id: int,
    start_date: str,
    end_date: str
):
    """일매출 조회 (식수 × 판매가)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_counts와 category_slots 조인하여 일별 매출 계산
            # menu_name이 "알 아라 조식" 형태이고 slot_name이 "알 아라"인 경우 부분 매칭
            query = """
                SELECT
                    mc.work_date,
                    mc.meal_type,
                    mc.menu_name,
                    COALESCE(SUM(mc.meal_count), 0) as total_meal_count,
                    COALESCE(MAX(cs.selling_price), 0) as selling_price
                FROM meal_counts mc
                LEFT JOIN category_slots cs ON (
                    mc.menu_name = cs.slot_name
                    OR mc.menu_name LIKE cs.slot_name || ' %%'
                ) AND cs.is_active = true
                WHERE mc.work_date BETWEEN %s AND %s
                  AND mc.site_id = %s
                GROUP BY mc.work_date, mc.meal_type, mc.menu_name
                ORDER BY mc.work_date, mc.meal_type
            """

            cursor.execute(query, (start_date, end_date, site_id))

            # cursor.description이 None인 경우 처리 (테이블이 없거나 결과가 없는 경우)
            if cursor.description is None:
                cursor.close()
                return {
                    "success": True,
                    "data": {
                        "daily_revenue": [],
                        "summary": {
                            "total_revenue": 0,
                            "total_vat": 0,
                            "total_revenue_with_vat": 0,
                            "total_meal_count": 0,
                            "average_daily_revenue": 0,
                            "days_count": 0
                        }
                    }
                }

            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # 일별로 그룹핑
            daily_data = {}
            for row in rows:
                work_date = str(row['work_date'])
                meal_type = row['meal_type'] or '중식'
                meal_count = int(row['total_meal_count']) if row['total_meal_count'] else 0
                selling_price = int(row['selling_price']) if row['selling_price'] else 0
                revenue = meal_count * selling_price

                # 디버그 로그 (selling_price가 0인 경우 확인)
                if meal_count > 0 and selling_price == 0:
                    print(f"[DEBUG] 매칭 실패: {work_date} {meal_type} {row['menu_name']} - 식수:{meal_count}, 단가:0")

                if work_date not in daily_data:
                    daily_data[work_date] = {
                        'date': work_date,
                        'revenue_by_meal_type': {},
                        'total_meal_count': 0,
                        'total_revenue': 0
                    }

                if meal_type not in daily_data[work_date]['revenue_by_meal_type']:
                    daily_data[work_date]['revenue_by_meal_type'][meal_type] = {
                        'meal_count': 0,
                        'revenue': 0
                    }

                daily_data[work_date]['revenue_by_meal_type'][meal_type]['meal_count'] += meal_count
                daily_data[work_date]['revenue_by_meal_type'][meal_type]['revenue'] += revenue
                daily_data[work_date]['total_meal_count'] += meal_count
                daily_data[work_date]['total_revenue'] += revenue

            # VAT 계산 (10%)
            daily_revenue = []
            for date_key in sorted(daily_data.keys()):
                data = daily_data[date_key]
                data['vat'] = int(data['total_revenue'] * 0.1)
                data['revenue_with_vat'] = data['total_revenue'] + data['vat']
                daily_revenue.append(data)

            # 요약 계산
            total_revenue = sum(d['total_revenue'] for d in daily_revenue)
            total_vat = sum(d['vat'] for d in daily_revenue)
            total_meal_count = sum(d['total_meal_count'] for d in daily_revenue)
            days_count = len(daily_revenue) if daily_revenue else 1
            average_daily_revenue = int(total_revenue / days_count) if days_count > 0 else 0

            cursor.close()

            return {
                "success": True,
                "data": {
                    "daily_revenue": daily_revenue,
                    "summary": {
                        "total_revenue": total_revenue,
                        "total_vat": total_vat,
                        "total_revenue_with_vat": total_revenue + total_vat,
                        "total_meal_count": total_meal_count,
                        "average_daily_revenue": average_daily_revenue,
                        "days_count": days_count
                    }
                }
            }

    except Exception as e:
        print(f"[DAILY REVENUE ERROR] {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": f"일매출 조회 실패: {str(e)}"}


@router.get("/api/sales/daily-orders")
async def get_daily_orders(
    site_id: int,
    start_date: str,
    end_date: str
):
    """일별 식재료비 조회 - 끼니별 세분화 (식단표 일자 기준)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # order_items의 meal_type으로 끼니별 분류
            # meal_type이 없거나 빈 값이면 '공통'으로 처리
            # ★ usage_date(입고일) + 1일 = 실제 식단표 날짜 (식자재가 제공되는 날)
            query = """
                SELECT
                    (COALESCE(oi.meal_plan_date, o.usage_date) + interval '1 day')::date as date,
                    COALESCE(NULLIF(TRIM(oi.meal_type), ''), '공통') as meal_type,
                    SUM(oi.total_price) as cost
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.site_id = %s
                  AND (COALESCE(oi.meal_plan_date, o.usage_date) + interval '1 day')::date BETWEEN %s AND %s
                  AND o.status != 'cancelled'
                GROUP BY (COALESCE(oi.meal_plan_date, o.usage_date) + interval '1 day')::date,
                         COALESCE(NULLIF(TRIM(oi.meal_type), ''), '공통')
                ORDER BY date, meal_type
            """

            cursor.execute(query, (site_id, start_date, end_date))

            if cursor.description is None:
                cursor.close()
                return {
                    "success": True,
                    "data": {
                        "daily_orders": [],
                        "summary": {
                            "total_confirmed": 0,
                            "total_draft": 0,
                            "total_orders": 0
                        }
                    }
                }

            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # 일별로 끼니별 식재료비 그룹핑
            daily_data = {}
            for row in rows:
                date_str = str(row['date'])
                meal_type = row['meal_type'] or '공통'
                cost = int(row['cost']) if row['cost'] else 0

                if date_str not in daily_data:
                    daily_data[date_str] = {
                        'date': date_str,
                        'cost_by_meal_type': {},
                        'total_cost': 0
                    }

                daily_data[date_str]['cost_by_meal_type'][meal_type] = cost
                daily_data[date_str]['total_cost'] += cost

            daily_orders = [daily_data[k] for k in sorted(daily_data.keys())]

            total_cost = sum(d['total_cost'] for d in daily_orders)

            cursor.close()

            return {
                "success": True,
                "data": {
                    "daily_orders": daily_orders,
                    "summary": {
                        "total_confirmed": total_cost,
                        "total_draft": 0,
                        "total_orders": len(daily_orders)
                    }
                }
            }

    except Exception as e:
        print(f"[DAILY ORDERS ERROR] {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": f"일별 식재료비 조회 실패: {str(e)}"}


@router.get("/api/sales/daily-order-detail")
async def get_daily_order_detail(
    site_id: int,
    date: str,
    meal_type: str = ""
):
    """특정 날짜+끼니의 식재료 상세 내역 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_type이 '공통'이면 빈값/NULL 조건
            if meal_type == '공통' or not meal_type:
                meal_filter = "AND (TRIM(oi.meal_type) = '' OR oi.meal_type IS NULL)"
                params = (site_id, date)
            else:
                meal_filter = "AND TRIM(oi.meal_type) = %s"
                params = (site_id, date, meal_type)

            query = f"""
                SELECT
                    oi.ingredient_name,
                    oi.order_qty,
                    oi.unit,
                    oi.unit_price,
                    oi.total_price,
                    oi.menu_name,
                    oi.slot_name,
                    o.order_number,
                    o.status
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.site_id = %s
                  AND (COALESCE(oi.meal_plan_date, o.usage_date) + interval '1 day')::date = %s::date
                  AND o.status != 'cancelled'
                  {meal_filter}
                ORDER BY oi.ingredient_name, oi.menu_name
            """

            cursor.execute(query, params)

            if cursor.description is None:
                cursor.close()
                return {"success": True, "data": {"items": [], "total": 0}}

            columns = [desc[0] for desc in cursor.description]
            items = [dict(zip(columns, row)) for row in cursor.fetchall()]

            total = 0
            for item in items:
                item['order_qty'] = float(item['order_qty']) if item['order_qty'] else 0
                item['unit_price'] = int(item['unit_price']) if item['unit_price'] else 0
                item['total_price'] = int(item['total_price']) if item['total_price'] else 0
                item['unit'] = item['unit'] or ''
                item['menu_name'] = item['menu_name'] or ''
                item['slot_name'] = item['slot_name'] or ''
                total += item['total_price']

            cursor.close()

            return {
                "success": True,
                "data": {
                    "items": items,
                    "total": total,
                    "count": len(items)
                }
            }

    except Exception as e:
        print(f"[ORDER DETAIL ERROR] {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": f"식재료 상세 조회 실패: {str(e)}"}
