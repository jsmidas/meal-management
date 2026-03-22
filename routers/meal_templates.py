#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
식단 템플릿 API 라우터
- 식단 템플릿 CRUD (서버 저장 방식)
- 템플릿 스케줄 관리 (날짜별 템플릿 지정)
"""

import json
from typing import Optional

from fastapi import APIRouter, Request

from core.database import get_db_connection

router = APIRouter()


# ============================================
# DB 마이그레이션 함수
# ============================================

def ensure_meal_templates_table():
    """meal_templates 테이블이 없으면 생성 (식단 템플릿 저장용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_templates (
                    id SERIAL PRIMARY KEY,
                    template_name VARCHAR(100) NOT NULL UNIQUE,
                    template_data JSONB NOT NULL,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            conn.commit()

            # 유효기간/적용요일 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_templates' AND column_name = 'valid_from') THEN
                        ALTER TABLE meal_templates ADD COLUMN valid_from DATE;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_templates' AND column_name = 'valid_to') THEN
                        ALTER TABLE meal_templates ADD COLUMN valid_to DATE;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_templates' AND column_name = 'apply_days') THEN
                        ALTER TABLE meal_templates ADD COLUMN apply_days VARCHAR(50);
                        COMMENT ON COLUMN meal_templates.apply_days IS '적용요일: 1=월,2=화,...,7=일,H=공휴일 (예: 1,2,3,4,5 또는 6,7,H)';
                    END IF;
                    -- category 컬럼 추가 (도시락/운반/학교/요양원 구분용)
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_templates' AND column_name = 'category') THEN
                        ALTER TABLE meal_templates ADD COLUMN category VARCHAR(50) DEFAULT '일반';
                        COMMENT ON COLUMN meal_templates.category IS '카테고리: 도시락, 운반, 학교, 요양원 등';
                    END IF;
                END $$;
            """)
            conn.commit()
            cursor.close()
            print("[DB] meal_templates 테이블 확인/생성 완료 (유효기간/적용요일/category 컬럼 포함)")
            return True
    except Exception as e:
        print(f"[DB] meal_templates 테이블 생성 오류: {e}")
        return False


def ensure_template_schedule_table():
    """template_schedule 테이블 생성 (날짜별 템플릿 지정용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS template_schedule (
                    id SERIAL PRIMARY KEY,
                    schedule_date DATE NOT NULL,
                    template_id INTEGER NOT NULL,
                    day_type VARCHAR(20) NOT NULL DEFAULT 'weekday',
                    site_id INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(schedule_date, site_id)
                );
                CREATE INDEX IF NOT EXISTS idx_template_schedule_date ON template_schedule(schedule_date);
                CREATE INDEX IF NOT EXISTS idx_template_schedule_site ON template_schedule(site_id);
                COMMENT ON TABLE template_schedule IS '날짜별 템플릿 지정 (캘린더에서 미리 설정)';
                COMMENT ON COLUMN template_schedule.day_type IS 'weekday, saturday, sunday, holiday';
            """)
            conn.commit()
            cursor.close()
            print("[DB] template_schedule 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] template_schedule 테이블 생성 오류: {e}")
        return False


# 모듈 로드 시 테이블 생성
ensure_meal_templates_table()
ensure_template_schedule_table()


# ============================================
# 식단 템플릿 API (서버 저장 방식)
# ============================================

@router.get("/api/meal-templates")
async def get_meal_templates(site_id: Optional[int] = None):
    """저장된 식단 템플릿 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_id 파라미터는 받지만, 현재는 모든 템플릿 반환 (향후 사업장별 필터링 가능)
            cursor.execute("""
                SELECT id, template_name, description, template_data, created_at, updated_at,
                       valid_from, valid_to, apply_days
                FROM meal_templates
                ORDER BY updated_at DESC
            """)

            rows = cursor.fetchall()
            templates = []
            for row in rows:
                templates.append({
                    "id": row[0],
                    "template_name": row[1],
                    "description": row[2],
                    "template_data": row[3],
                    "created_at": str(row[4]) if row[4] else None,
                    "updated_at": str(row[5]) if row[5] else None,
                    "valid_from": str(row[6]) if row[6] else None,
                    "valid_to": str(row[7]) if row[7] else None,
                    "apply_days": row[8] or ""
                })

            cursor.close()

            return {"success": True, "templates": templates}
    except Exception as e:
        print(f"[API] 템플릿 목록 조회 오류: {e}")
        return {"success": False, "error": str(e), "templates": []}


@router.post("/api/meal-templates")
async def save_meal_template(request: Request):
    """새 식단 템플릿 저장"""
    try:
        body = await request.json()
        template_name = body.get('template_name')
        description = body.get('description', '')
        template_data = body.get('template_data', {})
        valid_from = body.get('valid_from') or None
        valid_to = body.get('valid_to') or None
        apply_days = body.get('apply_days', '')  # 예: "1,2,3,4,5" 또는 "6,7,H"

        if not template_name:
            return {"success": False, "error": "template_name이 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # JSON 데이터 변환
            template_json = json.dumps(template_data, ensure_ascii=False)

            cursor.execute("""
                INSERT INTO meal_templates (template_name, description, template_data, valid_from, valid_to, apply_days)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (template_name, description, template_json, valid_from, valid_to, apply_days))

            new_id = cursor.fetchone()[0]

            conn.commit()
            cursor.close()

            return {"success": True, "message": "템플릿 저장 완료", "id": new_id}
    except Exception as e:
        print(f"[API] 템플릿 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@router.put("/api/meal-templates/{template_id}")
async def update_meal_template(template_id: int, request: Request):
    """기존 식단 템플릿 업데이트 (유효기간/적용요일 수정 포함)"""
    try:
        body = await request.json()
        template_name = body.get('template_name')
        description = body.get('description', '')
        template_data = body.get('template_data', {})
        valid_from = body.get('valid_from') or None
        valid_to = body.get('valid_to') or None
        apply_days = body.get('apply_days', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            template_json = json.dumps(template_data, ensure_ascii=False)

            cursor.execute("""
                UPDATE meal_templates
                SET template_name = %s, description = %s, template_data = %s,
                    valid_from = %s, valid_to = %s, apply_days = %s, updated_at = NOW()
                WHERE id = %s
            """, (template_name, description, template_json, valid_from, valid_to, apply_days, template_id))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "템플릿 업데이트 완료"}
    except Exception as e:
        print(f"[API] 템플릿 업데이트 오류: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/meal-templates/{template_id}")
async def delete_meal_template(template_id: int):
    """식단 템플릿 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM meal_templates WHERE id = %s", (template_id,))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "템플릿 삭제 완료"}
    except Exception as e:
        print(f"[API] 템플릿 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# 템플릿 스케줄 API (날짜별 템플릿 지정)
# ============================================

@router.get("/api/template-schedule")
async def get_template_schedule(
    start_date: str = None,
    end_date: str = None,
    site_id: Optional[int] = None
):
    """날짜별 템플릿 지정 조회 (캘린더용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT ts.id, ts.schedule_date, ts.template_id, ts.day_type, ts.site_id,
                       mt.template_name
                FROM template_schedule ts
                LEFT JOIN meal_templates mt ON ts.template_id = mt.id
                WHERE 1=1
            """
            params = []

            if start_date:
                query += " AND ts.schedule_date >= %s"
                params.append(start_date)
            if end_date:
                query += " AND ts.schedule_date <= %s"
                params.append(end_date)
            if site_id:
                query += " AND ts.site_id = %s"
                params.append(site_id)

            query += " ORDER BY ts.schedule_date"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            schedules = []
            for row in rows:
                schedules.append({
                    "id": row[0],
                    "schedule_date": str(row[1]),
                    "template_id": row[2],
                    "day_type": row[3],
                    "site_id": row[4],
                    "template_name": row[5]
                })

            cursor.close()

            return {"success": True, "schedules": schedules}
    except Exception as e:
        print(f"[API] 템플릿 스케줄 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/template-schedule/{date}")
async def get_template_schedule_by_date(date: str, site_id: Optional[int] = None):
    """특정 날짜의 템플릿 지정 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT ts.id, ts.schedule_date, ts.template_id, ts.day_type, ts.site_id,
                       mt.template_name, mt.template_data
                FROM template_schedule ts
                LEFT JOIN meal_templates mt ON ts.template_id = mt.id
                WHERE ts.schedule_date = %s
            """
            params = [date]

            if site_id:
                query += " AND ts.site_id = %s"
                params.append(site_id)

            cursor.execute(query, params)
            row = cursor.fetchone()

            cursor.close()

            if row:
                return {
                    "success": True,
                    "found": True,
                    "schedule": {
                        "id": row[0],
                        "schedule_date": str(row[1]),
                        "template_id": row[2],
                        "day_type": row[3],
                        "site_id": row[4],
                        "template_name": row[5],
                        "template_data": row[6]
                    }
                }
            else:
                return {"success": True, "found": False, "schedule": None}
    except Exception as e:
        print(f"[API] 템플릿 스케줄 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/template-schedule")
async def save_template_schedule(request: Request):
    """날짜별 템플릿 지정 저장 (UPSERT)"""
    try:
        body = await request.json()
        schedule_date = body.get('schedule_date')
        template_id = body.get('template_id')
        day_type = body.get('day_type', 'weekday')
        site_id = body.get('site_id', 1)

        if not schedule_date or not template_id:
            return {"success": False, "error": "날짜와 템플릿 ID가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # UPSERT: 있으면 업데이트, 없으면 삽입
            cursor.execute("""
                INSERT INTO template_schedule (schedule_date, template_id, day_type, site_id, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (schedule_date, site_id)
                DO UPDATE SET template_id = %s, day_type = %s, updated_at = NOW()
                RETURNING id
            """, (schedule_date, template_id, day_type, site_id, template_id, day_type))

            result_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {"success": True, "message": "템플릿 스케줄 저장 완료", "id": result_id}
    except Exception as e:
        print(f"[API] 템플릿 스케줄 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/template-schedule/bulk")
async def save_template_schedule_bulk(request: Request):
    """여러 날짜에 템플릿 일괄 지정"""
    try:
        body = await request.json()
        dates = body.get('dates', [])
        template_id = body.get('template_id')
        day_type = body.get('day_type', 'weekday')
        site_id = body.get('site_id', 1)

        if not dates or not template_id:
            return {"success": False, "error": "날짜 목록과 템플릿 ID가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            saved_count = 0
            for date in dates:
                cursor.execute("""
                    INSERT INTO template_schedule (schedule_date, template_id, day_type, site_id, updated_at)
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (schedule_date, site_id)
                    DO UPDATE SET template_id = %s, day_type = %s, updated_at = NOW()
                """, (date, template_id, day_type, site_id, template_id, day_type))
                saved_count += 1

            conn.commit()
            cursor.close()

            return {"success": True, "message": f"{saved_count}개 날짜에 템플릿 지정 완료"}
    except Exception as e:
        print(f"[API] 템플릿 일괄 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/template-schedule/{date}")
async def delete_template_schedule(date: str, site_id: Optional[int] = None):
    """날짜의 템플릿 지정 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if site_id:
                cursor.execute(
                    "DELETE FROM template_schedule WHERE schedule_date = %s AND site_id = %s",
                    (date, site_id)
                )
            else:
                cursor.execute(
                    "DELETE FROM template_schedule WHERE schedule_date = %s",
                    (date,)
                )

            conn.commit()
            cursor.close()

            return {"success": True, "message": "템플릿 지정 삭제 완료"}
    except Exception as e:
        print(f"[API] 템플릿 지정 삭제 오류: {e}")
        return {"success": False, "error": str(e)}
