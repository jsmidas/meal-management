#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Health Certificates Router
보건증 관리 API

직원 보건증 정보 CRUD 및 만료 경고 기능
- 만기 1개월 전: 주의(warning)
- 만기 1주일 전 또는 만료됨: 긴급(urgent)
"""

from datetime import datetime, date, timedelta
from fastapi import APIRouter, Request, Query, HTTPException
from typing import Optional, List
from core.database import get_db_connection
import traceback

router = APIRouter()

# 테이블 초기화 플래그
_table_initialized = False


def ensure_table_exists():
    """health_certificates 테이블이 없으면 생성"""
    global _table_initialized
    if _table_initialized:
        return

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 테이블 존재 확인
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'health_certificates'
            )
        """)

        if not cursor.fetchone()[0]:
            cursor.execute("""
                CREATE TABLE health_certificates (
                    id SERIAL PRIMARY KEY,
                    employee_name VARCHAR(100) NOT NULL,
                    employee_position VARCHAR(100),
                    certificate_number VARCHAR(50),
                    issue_date DATE,
                    expiry_date DATE NOT NULL,
                    hire_date DATE,
                    resignation_date DATE,
                    birth_date DATE,
                    phone VARCHAR(20),
                    salary DECIMAL(12, 0),
                    image_path VARCHAR(500),
                    site_id INTEGER,
                    group_id INTEGER,
                    notes TEXT,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER
                )
            """)

            # 인덱스 생성
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_cert_expiry ON health_certificates(expiry_date)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_cert_site ON health_certificates(site_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_cert_group ON health_certificates(group_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_cert_active ON health_certificates(is_active)")

            conn.commit()
            print("[INFO] health_certificates 테이블 생성 완료")
        else:
            # 기존 테이블에 새 컬럼 추가 (birth_date, phone)
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'health_certificates' AND column_name = 'birth_date'
            """)
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE health_certificates ADD COLUMN birth_date DATE")
                print("[INFO] health_certificates에 birth_date 컬럼 추가")

            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'health_certificates' AND column_name = 'phone'
            """)
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE health_certificates ADD COLUMN phone VARCHAR(20)")
                print("[INFO] health_certificates에 phone 컬럼 추가")

            conn.commit()

        _table_initialized = True


@router.get("/api/health-certificates")
async def get_health_certificates(
    site_id: int = Query(None, description="사업장 ID"),
    group_id: int = Query(None, description="그룹 ID"),
    status: str = Query(None, description="상태 필터 (urgent/warning/normal)"),
    include_inactive: bool = Query(False, description="비활성 포함 여부")
):
    """
    보건증 목록 조회

    상태 기준:
    - urgent: 만료됨 또는 1주일 이내 만료
    - warning: 1개월 이내 만료
    - normal: 1개월 이상 남음
    """
    ensure_table_exists()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            today = date.today()
            one_week = today + timedelta(days=7)
            one_month = today + timedelta(days=30)

            # 기본 쿼리
            query = """
                SELECT
                    hc.id,
                    hc.employee_name,
                    hc.employee_position,
                    hc.certificate_number,
                    hc.issue_date,
                    hc.expiry_date,
                    hc.hire_date,
                    hc.resignation_date,
                    hc.birth_date,
                    hc.phone,
                    hc.salary,
                    hc.image_path,
                    hc.site_id,
                    hc.group_id,
                    hc.notes,
                    hc.is_active,
                    hc.created_at,
                    bl.site_name as site_name,
                    sg.group_name as group_name,
                    CASE
                        WHEN hc.expiry_date <= %s THEN 'expired'
                        WHEN hc.expiry_date <= %s THEN 'urgent'
                        WHEN hc.expiry_date <= %s THEN 'warning'
                        ELSE 'normal'
                    END as status,
                    hc.expiry_date - %s as days_remaining
                FROM health_certificates hc
                LEFT JOIN business_locations bl ON hc.site_id = bl.id
                LEFT JOIN site_groups sg ON hc.group_id = sg.id
                WHERE 1=1
            """
            params = [today, one_week, one_month, today]

            # 필터 적용
            if not include_inactive:
                query += " AND hc.is_active = true"

            if site_id:
                query += " AND hc.site_id = %s"
                params.append(site_id)

            if group_id:
                query += " AND hc.group_id = %s"
                params.append(group_id)

            if status:
                if status == 'urgent':
                    query += " AND hc.expiry_date <= %s"
                    params.append(one_week)
                elif status == 'warning':
                    query += " AND hc.expiry_date > %s AND hc.expiry_date <= %s"
                    params.append(one_week)
                    params.append(one_month)
                elif status == 'normal':
                    query += " AND hc.expiry_date > %s"
                    params.append(one_month)

            query += " ORDER BY hc.expiry_date ASC"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            certificates = []
            for row in rows:
                certificates.append({
                    'id': row[0],
                    'employee_name': row[1],
                    'employee_position': row[2],
                    'certificate_number': row[3],
                    'issue_date': row[4].isoformat() if row[4] else None,
                    'expiry_date': row[5].isoformat() if row[5] else None,
                    'hire_date': row[6].isoformat() if row[6] else None,
                    'resignation_date': row[7].isoformat() if row[7] else None,
                    'birth_date': row[8].isoformat() if row[8] else None,
                    'phone': row[9],
                    'salary': int(row[10]) if row[10] else None,
                    'image_path': row[11],
                    'site_id': row[12],
                    'group_id': row[13],
                    'notes': row[14],
                    'is_active': row[15],
                    'created_at': row[16].isoformat() if row[16] else None,
                    'site_name': row[17],
                    'group_name': row[18],
                    'status': row[19],
                    'days_remaining': row[20]
                })

            # 통계 계산
            stats = {'urgent': 0, 'warning': 0, 'normal': 0, 'expired': 0}
            for cert in certificates:
                if cert['status'] in stats:
                    stats[cert['status']] += 1

            return {
                "success": True,
                "data": certificates,
                "stats": stats,
                "total": len(certificates)
            }

    except Exception as e:
        return {"success": False, "error": str(e), "trace": traceback.format_exc()}


@router.get("/api/health-certificates/stats")
async def get_health_certificate_stats(
    site_id: int = Query(None, description="사업장 ID"),
    group_id: int = Query(None, description="그룹 ID")
):
    """보건증 통계 조회 (대시보드용)"""
    ensure_table_exists()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            today = date.today()
            one_week = today + timedelta(days=7)
            one_month = today + timedelta(days=30)

            # 필터 조건
            filters = ["is_active = true"]
            params = []

            if site_id:
                filters.append("site_id = %s")
                params.append(site_id)

            if group_id:
                filters.append("group_id = %s")
                params.append(group_id)

            where_clause = " AND ".join(filters)

            # 통계 쿼리
            cursor.execute(f"""
                SELECT
                    COUNT(*) FILTER (WHERE expiry_date <= %s) as expired,
                    COUNT(*) FILTER (WHERE expiry_date > %s AND expiry_date <= %s) as urgent,
                    COUNT(*) FILTER (WHERE expiry_date > %s AND expiry_date <= %s) as warning,
                    COUNT(*) FILTER (WHERE expiry_date > %s) as normal,
                    MIN(CASE WHEN expiry_date > %s THEN expiry_date END) as next_expiry
                FROM health_certificates
                WHERE {where_clause}
            """, [today, today, one_week, one_week, one_month, one_month, today] + params)

            row = cursor.fetchone()

            # 다음 만료자 정보
            next_expiry_info = None
            if row[4]:
                cursor.execute(f"""
                    SELECT employee_name, expiry_date
                    FROM health_certificates
                    WHERE expiry_date = %s AND {where_clause}
                    LIMIT 1
                """, [row[4]] + params)
                next_row = cursor.fetchone()
                if next_row:
                    next_expiry_info = f"{next_row[0]} ({next_row[1].strftime('%m/%d')})"

            return {
                "success": True,
                "data": {
                    "expired": row[0] or 0,
                    "urgent": (row[0] or 0) + (row[1] or 0),  # 만료 + 긴급
                    "warning": row[2] or 0,
                    "normal": row[3] or 0,
                    "next_expiry": next_expiry_info
                }
            }

    except Exception as e:
        return {"success": False, "error": str(e), "data": {"urgent": 0, "warning": 0, "normal": 0, "next_expiry": None}}


@router.post("/api/health-certificates")
async def create_health_certificate(request: Request):
    """보건증 등록"""
    ensure_table_exists()

    try:
        data = await request.json()

        # 필수 필드 검증
        if not data.get('employee_name'):
            raise HTTPException(status_code=400, detail="직원 이름은 필수입니다")
        if not data.get('expiry_date'):
            raise HTTPException(status_code=400, detail="만기일은 필수입니다")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO health_certificates (
                    employee_name, employee_position, certificate_number,
                    issue_date, expiry_date, hire_date, resignation_date,
                    birth_date, phone, salary,
                    image_path, site_id, group_id, notes, created_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                data.get('employee_name'),
                data.get('employee_position'),
                data.get('certificate_number'),
                data.get('issue_date'),
                data.get('expiry_date'),
                data.get('hire_date'),
                data.get('resignation_date'),
                data.get('birth_date'),
                data.get('phone'),
                data.get('salary'),
                data.get('image_path'),
                data.get('site_id'),
                data.get('group_id'),
                data.get('notes'),
                data.get('created_by')
            ))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {"success": True, "id": new_id, "message": "보건증이 등록되었습니다"}

    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/health-certificates/{cert_id}")
async def update_health_certificate(cert_id: int, request: Request):
    """보건증 수정"""
    ensure_table_exists()

    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 존재 확인
            cursor.execute("SELECT id FROM health_certificates WHERE id = %s", (cert_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="보건증을 찾을 수 없습니다")

            # 업데이트 필드 구성
            updates = []
            params = []

            fields = ['employee_name', 'employee_position', 'certificate_number',
                     'issue_date', 'expiry_date', 'hire_date', 'resignation_date',
                     'birth_date', 'phone', 'salary', 'image_path', 'site_id', 'group_id', 'notes', 'is_active']

            for field in fields:
                if field in data:
                    updates.append(f"{field} = %s")
                    params.append(data[field])

            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                params.append(cert_id)

                cursor.execute(f"""
                    UPDATE health_certificates
                    SET {', '.join(updates)}
                    WHERE id = %s
                """, params)
                conn.commit()

            return {"success": True, "message": "보건증이 수정되었습니다"}

    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/health-certificates/{cert_id}")
async def delete_health_certificate(cert_id: int, permanent: bool = Query(False)):
    """보건증 삭제 (기본: 비활성화, permanent=true: 완전 삭제)"""
    ensure_table_exists()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if permanent:
                cursor.execute("DELETE FROM health_certificates WHERE id = %s", (cert_id,))
            else:
                cursor.execute("""
                    UPDATE health_certificates
                    SET is_active = false, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (cert_id,))

            conn.commit()

            return {"success": True, "message": "보건증이 삭제되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}
