"""
행사 등록/손익 관리 API
"""
from fastapi import APIRouter, Request, HTTPException
from core.database import get_db_connection
from datetime import datetime, date
from decimal import Decimal

router = APIRouter()


def init_events_table():
    """events 테이블 초기화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id SERIAL PRIMARY KEY,
                    event_name VARCHAR(200) NOT NULL,
                    event_date DATE NOT NULL,
                    event_type VARCHAR(50) NOT NULL,
                    status VARCHAR(20) DEFAULT 'estimate',
                    client_name VARCHAR(200),
                    contact_person VARCHAR(100),
                    phone VARCHAR(50),
                    address TEXT,
                    template_id INTEGER,
                    menu_name VARCHAR(500),
                    expected_attendees INTEGER DEFAULT 0,
                    unit_price DECIMAL(12,2) DEFAULT 0,
                    expected_revenue DECIMAL(15,2) DEFAULT 0,
                    actual_attendees INTEGER,
                    actual_revenue DECIMAL(15,2),
                    ingredient_cost DECIMAL(15,2) DEFAULT 0,
                    labor_cost DECIMAL(15,2) DEFAULT 0,
                    other_cost DECIMAL(15,2) DEFAULT 0,
                    total_cost DECIMAL(15,2) DEFAULT 0,
                    profit DECIMAL(15,2) DEFAULT 0,
                    profit_margin DECIMAL(5,2) DEFAULT 0,
                    memo TEXT,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
                CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
                CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
            """)
            # site_id 컬럼 추가 (마이그레이션)
            cursor.execute("""
                ALTER TABLE events ADD COLUMN IF NOT EXISTS site_id INTEGER
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_events_site ON events(site_id)
            """)
            conn.commit()
            cursor.close()
            print("[DB] events 테이블 초기화 완료")
            return True
    except Exception as e:
        print(f"[DB] events 테이블 초기화 오류: {e}")
        return False


@router.get("/api/events")
async def get_events(
    status: str = None,
    event_type: str = None,
    start_date: str = None,
    end_date: str = None,
    search: str = None,
    site_id: int = None,
    page: int = 1,
    limit: int = 20
):
    """행사 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기본 쿼리
            query = """
                SELECT e.id, e.event_name, e.event_date, e.event_type, e.status,
                       e.client_name, e.contact_person, e.phone, e.address,
                       e.template_id, e.menu_name,
                       e.expected_attendees, e.unit_price, e.expected_revenue,
                       e.actual_attendees, e.actual_revenue,
                       e.ingredient_cost, e.labor_cost, e.other_cost, e.total_cost,
                       e.profit, e.profit_margin, e.memo,
                       e.created_at, e.updated_at,
                       e.site_id, sg.group_name as site_name
                FROM events e
                LEFT JOIN site_groups sg ON e.site_id = sg.id
                WHERE 1=1
            """
            params = []

            # 필터 조건
            if status:
                query += " AND e.status = %s"
                params.append(status)

            if event_type:
                query += " AND e.event_type = %s"
                params.append(event_type)

            if start_date:
                query += " AND e.event_date >= %s"
                params.append(start_date)

            if end_date:
                query += " AND e.event_date <= %s"
                params.append(end_date)

            if site_id:
                query += " AND e.site_id = %s"
                params.append(site_id)

            if search:
                query += " AND (e.event_name ILIKE %s OR e.client_name ILIKE %s OR e.menu_name ILIKE %s)"
                search_pattern = f"%{search}%"
                params.extend([search_pattern, search_pattern, search_pattern])

            # 간단한 카운트 쿼리
            count_sql = "SELECT COUNT(*) FROM events e WHERE 1=1"
            count_params = []
            if status:
                count_sql += " AND e.status = %s"
                count_params.append(status)
            if event_type:
                count_sql += " AND e.event_type = %s"
                count_params.append(event_type)
            if start_date:
                count_sql += " AND e.event_date >= %s"
                count_params.append(start_date)
            if end_date:
                count_sql += " AND e.event_date <= %s"
                count_params.append(end_date)
            if site_id:
                count_sql += " AND e.site_id = %s"
                count_params.append(site_id)
            if search:
                count_sql += " AND (e.event_name ILIKE %s OR e.client_name ILIKE %s OR e.menu_name ILIKE %s)"
                search_pattern = f"%{search}%"
                count_params.extend([search_pattern, search_pattern, search_pattern])

            cursor.execute(count_sql, count_params)
            total = cursor.fetchone()[0]

            # 정렬 및 페이징
            query += " ORDER BY e.event_date DESC, e.id DESC"
            offset = (page - 1) * limit
            query += f" LIMIT {limit} OFFSET {offset}"

            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            events = []
            for row in cursor.fetchall():
                event = dict(zip(columns, row))
                # datetime/date/Decimal 변환
                for key, value in event.items():
                    if isinstance(value, (datetime, date)):
                        event[key] = value.isoformat() if value else None
                    elif isinstance(value, Decimal):
                        event[key] = float(value)
                events.append(event)

            cursor.close()

            return {
                "success": True,
                "data": events,
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": (total + limit - 1) // limit
            }

    except Exception as e:
        print(f"[API] 행사 목록 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/events/{event_id}")
async def get_event(event_id: int):
    """행사 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT e.id, e.event_name, e.event_date, e.event_type, e.status,
                       e.client_name, e.contact_person, e.phone, e.address,
                       e.template_id, e.menu_name,
                       e.expected_attendees, e.unit_price, e.expected_revenue,
                       e.actual_attendees, e.actual_revenue,
                       e.ingredient_cost, e.labor_cost, e.other_cost, e.total_cost,
                       e.profit, e.profit_margin, e.memo,
                       e.created_at, e.updated_at,
                       e.site_id, sg.group_name as site_name
                FROM events e
                LEFT JOIN site_groups sg ON e.site_id = sg.id
                WHERE e.id = %s
            """, (event_id,))

            row = cursor.fetchone()
            cursor.close()

            if not row:
                raise HTTPException(status_code=404, detail="행사를 찾을 수 없습니다")

            columns = ['id', 'event_name', 'event_date', 'event_type', 'status',
                       'client_name', 'contact_person', 'phone', 'address',
                       'template_id', 'menu_name',
                       'expected_attendees', 'unit_price', 'expected_revenue',
                       'actual_attendees', 'actual_revenue',
                       'ingredient_cost', 'labor_cost', 'other_cost', 'total_cost',
                       'profit', 'profit_margin', 'memo',
                       'created_at', 'updated_at',
                       'site_id', 'site_name']

            event = dict(zip(columns, row))
            for key, value in event.items():
                if isinstance(value, (datetime, date)):
                    event[key] = value.isoformat() if value else None
                elif isinstance(value, Decimal):
                    event[key] = float(value)

            return {"success": True, "data": event}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] 행사 상세 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/events")
async def create_event(request: Request):
    """행사 등록"""
    try:
        data = await request.json()

        # 필수 필드 검증
        if not data.get('event_name'):
            raise HTTPException(status_code=400, detail="행사명은 필수입니다")
        if not data.get('event_date'):
            raise HTTPException(status_code=400, detail="행사일은 필수입니다")
        if not data.get('event_type'):
            raise HTTPException(status_code=400, detail="행사 종류는 필수입니다")

        # 예상 매출 계산
        expected_attendees = int(data.get('expected_attendees', 0) or 0)
        unit_price = float(data.get('unit_price', 0) or 0)
        expected_revenue = expected_attendees * unit_price

        # 실제 매출 계산 (입력된 경우)
        actual_attendees = data.get('actual_attendees')
        actual_revenue = None
        if actual_attendees is not None:
            actual_attendees = int(actual_attendees)
            actual_revenue = actual_attendees * unit_price

        # 비용 계산
        ingredient_cost = float(data.get('ingredient_cost', 0) or 0)
        labor_cost = float(data.get('labor_cost', 0) or 0)
        other_cost = float(data.get('other_cost', 0) or 0)
        total_cost = ingredient_cost + labor_cost + other_cost

        # 손익 계산 (실제 매출이 있는 경우)
        profit = 0
        profit_margin = 0
        if actual_revenue is not None:
            profit = actual_revenue - total_cost
            if actual_revenue > 0:
                profit_margin = (profit / actual_revenue) * 100

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO events (
                    event_name, event_date, event_type, status,
                    client_name, contact_person, phone, address,
                    template_id, menu_name,
                    expected_attendees, unit_price, expected_revenue,
                    actual_attendees, actual_revenue,
                    ingredient_cost, labor_cost, other_cost, total_cost,
                    profit, profit_margin, memo, site_id
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s
                ) RETURNING id
            """, (
                data.get('event_name'),
                data.get('event_date'),
                data.get('event_type'),
                data.get('status', 'estimate'),
                data.get('client_name'),
                data.get('contact_person'),
                data.get('phone'),
                data.get('address'),
                data.get('template_id'),
                data.get('menu_name'),
                expected_attendees,
                unit_price,
                expected_revenue,
                actual_attendees,
                actual_revenue,
                ingredient_cost,
                labor_cost,
                other_cost,
                total_cost,
                profit,
                profit_margin,
                data.get('memo'),
                data.get('site_id')
            ))

            event_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "행사가 등록되었습니다",
                "id": event_id
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] 행사 등록 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/events/{event_id}")
async def update_event(event_id: int, request: Request):
    """행사 수정"""
    try:
        data = await request.json()

        # 예상 매출 계산
        expected_attendees = int(data.get('expected_attendees', 0) or 0)
        unit_price = float(data.get('unit_price', 0) or 0)
        expected_revenue = expected_attendees * unit_price

        # 실제 매출 계산
        actual_attendees = data.get('actual_attendees')
        actual_revenue = None
        if actual_attendees is not None and actual_attendees != '':
            actual_attendees = int(actual_attendees)
            actual_revenue = actual_attendees * unit_price
        else:
            actual_attendees = None

        # 비용 계산
        ingredient_cost = float(data.get('ingredient_cost', 0) or 0)
        labor_cost = float(data.get('labor_cost', 0) or 0)
        other_cost = float(data.get('other_cost', 0) or 0)
        total_cost = ingredient_cost + labor_cost + other_cost

        # 손익 계산
        profit = 0
        profit_margin = 0
        if actual_revenue is not None:
            profit = actual_revenue - total_cost
            if actual_revenue > 0:
                profit_margin = (profit / actual_revenue) * 100

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE events SET
                    event_name = %s,
                    event_date = %s,
                    event_type = %s,
                    status = %s,
                    client_name = %s,
                    contact_person = %s,
                    phone = %s,
                    address = %s,
                    template_id = %s,
                    menu_name = %s,
                    expected_attendees = %s,
                    unit_price = %s,
                    expected_revenue = %s,
                    actual_attendees = %s,
                    actual_revenue = %s,
                    ingredient_cost = %s,
                    labor_cost = %s,
                    other_cost = %s,
                    total_cost = %s,
                    profit = %s,
                    profit_margin = %s,
                    memo = %s,
                    site_id = %s,
                    updated_at = NOW()
                WHERE id = %s
            """, (
                data.get('event_name'),
                data.get('event_date'),
                data.get('event_type'),
                data.get('status'),
                data.get('client_name'),
                data.get('contact_person'),
                data.get('phone'),
                data.get('address'),
                data.get('template_id'),
                data.get('menu_name'),
                expected_attendees,
                unit_price,
                expected_revenue,
                actual_attendees,
                actual_revenue,
                ingredient_cost,
                labor_cost,
                other_cost,
                total_cost,
                profit,
                profit_margin,
                data.get('memo'),
                data.get('site_id'),
                event_id
            ))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "행사가 수정되었습니다"}

    except Exception as e:
        print(f"[API] 행사 수정 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/events/{event_id}")
async def delete_event(event_id: int):
    """행사 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM events WHERE id = %s", (event_id,))
            conn.commit()
            cursor.close()

            return {"success": True, "message": "행사가 삭제되었습니다"}

    except Exception as e:
        print(f"[API] 행사 삭제 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/events/summary/profit")
async def get_profit_summary(
    start_date: str = None,
    end_date: str = None,
    event_type: str = None
):
    """손익 요약 통계"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    COUNT(*) as total_events,
                    COALESCE(SUM(expected_revenue), 0) as total_expected_revenue,
                    COALESCE(SUM(actual_revenue), 0) as total_actual_revenue,
                    COALESCE(SUM(total_cost), 0) as total_cost,
                    COALESCE(SUM(profit), 0) as total_profit,
                    CASE
                        WHEN SUM(actual_revenue) > 0
                        THEN ROUND((SUM(profit) / SUM(actual_revenue)) * 100, 2)
                        ELSE 0
                    END as avg_profit_margin
                FROM events
                WHERE status = 'completed'
            """
            params = []

            if start_date:
                query += " AND event_date >= %s"
                params.append(start_date)

            if end_date:
                query += " AND event_date <= %s"
                params.append(end_date)

            if event_type:
                query += " AND event_type = %s"
                params.append(event_type)

            cursor.execute(query, params)
            row = cursor.fetchone()

            # 종류별 통계
            type_query = """
                SELECT event_type,
                       COUNT(*) as count,
                       COALESCE(SUM(actual_revenue), 0) as revenue,
                       COALESCE(SUM(profit), 0) as profit
                FROM events
                WHERE status = 'completed'
            """
            type_params = []

            if start_date:
                type_query += " AND event_date >= %s"
                type_params.append(start_date)
            if end_date:
                type_query += " AND event_date <= %s"
                type_params.append(end_date)

            type_query += " GROUP BY event_type"

            cursor.execute(type_query, type_params)
            type_stats = []
            for r in cursor.fetchall():
                type_stats.append({
                    "event_type": r[0],
                    "count": r[1],
                    "revenue": float(r[2]) if r[2] else 0,
                    "profit": float(r[3]) if r[3] else 0
                })

            cursor.close()

            return {
                "success": True,
                "data": {
                    "total_events": row[0],
                    "total_expected_revenue": float(row[1]) if row[1] else 0,
                    "total_actual_revenue": float(row[2]) if row[2] else 0,
                    "total_cost": float(row[3]) if row[3] else 0,
                    "total_profit": float(row[4]) if row[4] else 0,
                    "avg_profit_margin": float(row[5]) if row[5] else 0,
                    "by_type": type_stats
                }
            }

    except Exception as e:
        print(f"[API] 손익 요약 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))
