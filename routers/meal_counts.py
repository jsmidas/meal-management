#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
식수 관리 API 라우터
- 식수 데이터 CRUD (날짜별, 사업장별)
- 식수 감사 로그
- 식수관리용 사업장 관리 (DEPRECATED - /api/v2/clients 사용 권장)
"""

import re
import json
import unicodedata
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Request, Query
from core.database import get_db_connection
from core.cache import TTLCache


router = APIRouter()

# ★ M-3: 사업장명 정규화 함수 (공백/유니코드 차이 제거)
def normalize_client_name(name: str) -> str:
    """사업장명 정규화: strip + 연속공백 제거 + NFC 정규화"""
    if not name:
        return name
    return unicodedata.normalize('NFC', re.sub(r'\s+', ' ', name.strip()))

# 식수 데이터 캐시 (60초 TTL)
meal_counts_cache = TTLCache(ttl_seconds=60)


# ========================
# 식수 관리 테이블 마이그레이션
# ========================

def ensure_meal_counts_table():
    """meal_counts 테이블이 없으면 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_counts (
                    id SERIAL PRIMARY KEY,
                    work_date DATE NOT NULL,
                    business_type VARCHAR(50) NOT NULL,
                    menu_name VARCHAR(100) NOT NULL,
                    matching_name VARCHAR(100),
                    meal_type VARCHAR(20) NOT NULL,
                    site_name VARCHAR(100) NOT NULL,
                    meal_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_meal_counts_work_date ON meal_counts(work_date);
                CREATE INDEX IF NOT EXISTS idx_meal_counts_business_type ON meal_counts(business_type);
            """)
            # ★ 성능 최적화: 복합 인덱스 추가 (식단관리 range 쿼리용)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_meal_counts_site_date ON meal_counts(site_id, work_date);
            """)
            # ★ slot_id 컬럼 추가 (기존 테이블에 없으면 추가)
            cursor.execute("""
                ALTER TABLE meal_counts ADD COLUMN IF NOT EXISTS slot_id INTEGER
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_meal_counts_slot_id ON meal_counts(slot_id)
            """)

            # ★ 기존 데이터 backfill: menu_name + category로 매칭하여 slot_id 일괄 업데이트
            cursor.execute("""
                UPDATE meal_counts mc
                SET slot_id = cs.id
                FROM category_slots cs
                JOIN site_categories sc ON cs.category_id = sc.id
                WHERE mc.slot_id IS NULL
                  AND mc.menu_name = cs.slot_name
                  AND (mc.category = sc.category_name OR mc.business_type = sc.category_name)
            """)
            backfilled = cursor.rowcount
            if backfilled > 0:
                print(f"[DB] meal_counts slot_id backfill: {backfilled}건 업데이트")

            conn.commit()
            cursor.close()
            print("[DB] meal_counts 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] meal_counts 테이블 생성 오류: {e}")
        return False

# 서버 시작시 테이블 생성 확인
ensure_meal_counts_table()


def ensure_meal_counts_audit_log_table():
    """meal_counts_audit_log 테이블 - 식수 변경 이력 추적"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_counts_audit_log (
                    id SERIAL PRIMARY KEY,
                    meal_count_id INTEGER,           -- 변경된 meal_counts.id
                    action VARCHAR(20) NOT NULL,     -- INSERT, UPDATE, DELETE
                    work_date DATE,                  -- 작업일
                    site_id INTEGER,                 -- 사업장 ID
                    category VARCHAR(50),            -- 카테고리
                    menu_name VARCHAR(100),          -- 슬롯명
                    site_name VARCHAR(100),          -- 고객사명
                    old_meal_count INTEGER,          -- 변경 전 식수
                    new_meal_count INTEGER,          -- 변경 후 식수
                    user_id INTEGER,                 -- 변경한 사용자 ID
                    user_name VARCHAR(100),          -- 변경한 사용자명
                    changed_at TIMESTAMP DEFAULT NOW(),
                    ip_address VARCHAR(45),          -- 접속 IP
                    user_agent TEXT                  -- 브라우저 정보
                );
                CREATE INDEX IF NOT EXISTS idx_audit_work_date ON meal_counts_audit_log(work_date);
                CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON meal_counts_audit_log(changed_at);
                CREATE INDEX IF NOT EXISTS idx_audit_site_id ON meal_counts_audit_log(site_id);
            """)
            conn.commit()
            cursor.close()
            print("[DB] meal_counts_audit_log 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] meal_counts_audit_log 테이블 생성 오류: {e}")
        return False

# 서버 시작시 감사 로그 테이블 생성 확인
ensure_meal_counts_audit_log_table()


def ensure_meal_count_sites_table():
    """meal_count_sites 테이블 - 식수관리용 사업장 목록 (카테고리 → 슬롯 → 사업장 구조)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_count_sites (
                    id SERIAL PRIMARY KEY,
                    business_type VARCHAR(50) DEFAULT '운반',
                    slot_name VARCHAR(50) DEFAULT NULL,
                    site_name VARCHAR(100) NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            conn.commit()

            # slot_name 컬럼이 없으면 추가
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'meal_count_sites' AND column_name = 'slot_name'
            """)
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE meal_count_sites ADD COLUMN slot_name VARCHAR(50) DEFAULT NULL")
                conn.commit()
                print("[DB] meal_count_sites에 slot_name 컬럼 추가")

            # meal_type 컬럼이 있으면 slot_name으로 데이터 이전
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'meal_count_sites' AND column_name = 'meal_type'
            """)
            if cursor.fetchone():
                # 기존 meal_type 데이터가 있고 slot_name이 비어있으면 이전
                cursor.execute("""
                    UPDATE meal_count_sites
                    SET slot_name = meal_type
                    WHERE slot_name IS NULL AND meal_type IS NOT NULL
                """)
                conn.commit()

            # 인덱스 생성
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_count_sites_active ON meal_count_sites(is_active)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_count_sites_order ON meal_count_sites(display_order)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_count_sites_slot ON meal_count_sites(slot_name)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_count_sites_business_type ON meal_count_sites(business_type)")
            conn.commit()

            cursor.close()
            print("[DB] meal_count_sites 테이블 확인/생성 완료 (slot_name 컬럼 포함)")
            return True
    except Exception as e:
        print(f"[DB] meal_count_sites 테이블 생성 오류: {e}")
        return False

ensure_meal_count_sites_table()


# ========================
# 식수 관리 API 엔드포인트
# ========================

@router.get("/api/meal-counts/dates")
async def get_meal_count_dates(site_id: Optional[int] = None):
    """식수 데이터가 있는 날짜 목록 조회 (사업장별)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT DISTINCT work_date, COUNT(*) as count, SUM(meal_count) as total
                FROM meal_counts
            """
            params = []
            if site_id:
                query += " WHERE site_id = %s"
                params.append(site_id)
            query += " GROUP BY work_date ORDER BY work_date DESC LIMIT 30"

            cursor.execute(query, params)

            rows = cursor.fetchall()
            data = [{"date": str(row[0]), "count": row[1], "total": row[2]} for row in rows]

            cursor.close()

            return {"success": True, "data": data}
    except Exception as e:
        print(f"[API] 식수 날짜 목록 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/meal-counts/range")
async def get_meal_counts_range(
    start_date: str,
    end_date: str,
    site_id: Optional[int] = None,
    group_id: Optional[int] = None,
    category_id: Optional[int] = None,
    meal_type: Optional[str] = None
):
    """기간별 식수 데이터 조회 (사업장/그룹/카테고리별 필터링 지원) - 캐싱 적용"""
    # 🚀 캐시 키 생성
    cache_key = f"range:{start_date}:{end_date}:{site_id}:{group_id}:{category_id}:{meal_type}"
    cached = meal_counts_cache.get(cache_key)
    if cached:
        print(f"[API] meal_counts_range 캐시 히트: {cache_key[:50]}...")
        return cached

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 필터 조건 구성
            filters = ["work_date >= %s", "work_date <= %s"]
            params = [start_date, end_date]

            # 그룹별 필터링 (본사, 영남지사 등) - meal_counts.site_id = site_groups.id
            if group_id:
                filters.append("site_id = %s")
                params.append(group_id)
                print(f"[API] meal_counts_range: group_id={group_id}")
            # 카테고리별 필터링 - business_type으로 필터링
            elif category_id:
                cursor.execute("""
                    SELECT category_code FROM site_categories WHERE id = %s
                """, (category_id,))
                row = cursor.fetchone()
                if row and row[0]:
                    filters.append("business_type = %s")
                    params.append(row[0])
                else:
                    filters.append("1=0")
                print(f"[API] meal_counts_range: category_id={category_id}")
            # site_id로 직접 필터링 (site_groups.id = 그룹 ID)
            elif site_id:
                filters.append("site_id = %s")
                params.append(site_id)
                print(f"[API] meal_counts_range: site_id={site_id}")

            # 끼니 유형 필터
            if meal_type:
                filters.append("business_type = %s")
                params.append(meal_type)

            where_clause = " AND ".join(["mc." + f if not f.startswith("1=") else f for f in filters])

            # ★ category_slots의 meal_type을 우선 사용 (마스터 설정 기준)
            cursor.execute(f"""
                SELECT mc.id, mc.work_date, COALESCE(mc.category, mc.business_type) AS business_type,
                       mc.menu_name, mc.matching_name,
                       COALESCE(cs.meal_type, mc.meal_type) AS meal_type,
                       mc.site_name, mc.meal_count, mc.menu_order, mc.created_at, mc.site_id
                FROM meal_counts mc
                LEFT JOIN category_slots cs ON cs.slot_name = mc.menu_name AND cs.is_active = true
                WHERE {where_clause}
                ORDER BY mc.work_date DESC, COALESCE(mc.category, mc.business_type), COALESCE(mc.menu_order, 999), mc.menu_name
            """, params)

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            data = []
            for row in rows:
                item = dict(zip(columns, row))
                if item.get('work_date'):
                    item['work_date'] = str(item['work_date'])
                if item.get('created_at'):
                    item['created_at'] = str(item['created_at'])
                data.append(item)

            cursor.close()

            site_info = f", site_id={site_id}" if site_id else ""
            print(f"[API] 기간 식수 조회: {start_date} ~ {end_date}{site_info}, {len(data)}건")

            # 🚀 결과 캐싱
            result = {"success": True, "data": data, "count": len(data)}
            meal_counts_cache.set(cache_key, result)
            return result
    except Exception as e:
        print(f"[API] 기간 식수 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/meal-counts/{work_date}")
async def get_meal_counts(work_date: str, site_id: Optional[int] = None):
    """특정 날짜의 식수 데이터 조회 - site_id 필터링 지원 (캐싱 적용)

    ★ site_id는 site_groups.id (본사=1, 영남=2 등)
    - 프론트엔드(SiteSelector)에서 group_id를 site_id로 전달
    - meal_counts.site_id와 직접 매칭
    """
    # 🚀 캐시 확인
    cache_key = f"date:{work_date}:{site_id}"
    cached = meal_counts_cache.get(cache_key)
    if cached:
        print(f"[API] meal_counts 캐시 히트: {work_date}")
        return cached

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            site_filter = ""
            params = [work_date]
            if site_id:
                site_filter = " AND site_id = %s"
                params.append(site_id)
                print(f"[API] meal_counts 조회: work_date={work_date}, site_id={site_id}")

            # ★ category_slots의 meal_type을 우선 사용 (마스터 설정 기준)
            cursor.execute(f"""
                SELECT mc.id, mc.work_date, COALESCE(mc.category, mc.business_type) AS business_type,
                       mc.menu_name, mc.matching_name,
                       COALESCE(cs.meal_type, mc.meal_type) AS meal_type,
                       mc.site_name, mc.meal_count, mc.menu_order, mc.created_at, mc.updated_at, mc.site_id
                FROM meal_counts mc
                LEFT JOIN category_slots cs ON cs.slot_name = mc.menu_name AND cs.is_active = true
                WHERE mc.work_date = %s{site_filter}
                ORDER BY COALESCE(mc.category, mc.business_type), COALESCE(mc.menu_order, 999), mc.menu_name, mc.site_name
            """, params)

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            data = []
            for row in rows:
                item = dict(zip(columns, row))
                # datetime 객체를 문자열로 변환
                if item.get('work_date'):
                    item['work_date'] = str(item['work_date'])
                if item.get('created_at'):
                    item['created_at'] = str(item['created_at'])
                if item.get('updated_at'):
                    item['updated_at'] = str(item['updated_at'])
                data.append(item)

            cursor.close()

            # 🚀 결과 캐싱
            result = {"success": True, "data": data, "count": len(data)}
            meal_counts_cache.set(cache_key, result)
            return result
    except Exception as e:
        print(f"[API] 식수 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/meal-counts/save")
async def save_meal_counts(request: Request):
    """식수 데이터 저장 (해당 날짜 + 사업장별 교체) - Batch INSERT로 성능 최적화 + 감사 로그"""
    try:
        body = await request.json()
        work_date = body.get('work_date')
        items = body.get('items', [])
        site_id = body.get('site_id')  # 사업장(지사) ID

        # ★ 사용자 정보 추출 (감사 로그용)
        user_id = body.get('user_id') or request.headers.get('X-User-Id')
        user_name = body.get('user_name') or request.headers.get('X-User-Name') or '알수없음'
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get('User-Agent', '')[:500]  # 너무 길면 자르기

        if not work_date:
            return {"success": False, "error": "work_date가 필요합니다"}

        # ★ 과거 날짜 저장 방지 (당일은 허용)
        today = date.today()
        try:
            selected_date = datetime.strptime(work_date, '%Y-%m-%d').date()
            if selected_date < today:
                return {"success": False, "error": f"과거 날짜의 데이터는 저장할 수 없습니다. 오늘({today}) 이후 날짜만 저장 가능합니다."}
        except ValueError:
            return {"success": False, "error": "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 감사 로그: 기존 데이터 조회 (변경 전 상태)
            if site_id:
                cursor.execute("""
                    SELECT id, category, menu_name, site_name, meal_count
                    FROM meal_counts
                    WHERE work_date = %s AND site_id = %s
                """, (work_date, site_id))
            else:
                cursor.execute("""
                    SELECT id, category, menu_name, site_name, meal_count
                    FROM meal_counts
                    WHERE work_date = %s AND site_id IS NULL
                """, (work_date,))

            old_rows = cursor.fetchall()
            old_data = {}  # {(menu_name, site_name): {'id': id, 'count': count, 'category': category}}
            for row in old_rows:
                key = (row[2], row[3])  # (menu_name, site_name)
                old_data[key] = {'id': row[0], 'count': row[4], 'category': row[1]}

            # 해당 날짜 + 사업장의 기존 데이터만 삭제 (다른 사업장 데이터는 유지)
            if site_id:
                cursor.execute("DELETE FROM meal_counts WHERE work_date = %s AND site_id = %s", (work_date, site_id))
            else:
                # site_id가 없으면 site_id가 NULL인 데이터만 삭제
                cursor.execute("DELETE FROM meal_counts WHERE work_date = %s AND site_id IS NULL", (work_date,))

            # ★★★ slot_clients 검증: 유효한 (category, slot_name, client_name) 조합 조회 ★★★
            cursor.execute("""
                SELECT scat.category_name, cs.slot_name, scl.client_name
                FROM slot_clients scl
                JOIN category_slots cs ON scl.slot_id = cs.id
                JOIN site_categories scat ON cs.category_id = scat.id
                WHERE scl.is_active = TRUE AND cs.is_active = TRUE
            """)
            valid_combinations = set()
            for row in cursor.fetchall():
                valid_combinations.add((row[0], row[1], row[2]))  # (category, slot_name, client_name)

            # ★ Batch INSERT로 성능 최적화
            # 사업장명이 있으면 저장 (0 카운트도 허용 - 고객 목록 유지)

            # ★ M-1: category_slots에서 meal_type, slot_id 조회 (카테고리별 정밀 매핑)
            cursor.execute("""
                SELECT cs.slot_name, cs.meal_type, cs.id, scat.category_name
                FROM category_slots cs
                JOIN site_categories scat ON cs.category_id = scat.id
                WHERE cs.is_active = true
            """)
            slot_meal_types = {}
            slot_name_to_id = {}  # ★ slot_name → slot_id 매핑
            slot_cat_to_id = {}   # ★ (category_name, slot_name) → slot_id 정밀 매핑
            for row in cursor.fetchall():
                slot_meal_types[row[0]] = row[1]
                slot_name_to_id[row[0]] = row[2]
                slot_cat_to_id[(row[3], row[0])] = row[2]  # (category_name, slot_name) → slot_id

            # 슬롯명에서 meal_type 조회 함수 (category_slots 우선, fallback으로 패턴 추론)
            def get_meal_type_for_slot(slot_name):
                """슬롯의 끼니 유형 조회 (category_slots 마스터 설정 우선)"""
                if not slot_name:
                    return '중식'

                # ★ category_slots에서 조회 (마스터 설정)
                if slot_name in slot_meal_types:
                    return slot_meal_types[slot_name] or '중식'

                # Fallback: 슬롯명 패턴으로 추론 (마스터에 없는 경우만)
                slot_lower = slot_name.lower()
                if slot_lower.startswith('조') or '조식' in slot_lower or '아침' in slot_lower:
                    return '조식'
                if slot_lower.startswith('중') or '중식' in slot_lower or '점심' in slot_lower:
                    return '중식'
                if slot_lower.startswith('석') or '석식' in slot_lower or '저녁' in slot_lower:
                    return '석식'
                if slot_lower.startswith('야') or '야식' in slot_lower:
                    return '야식'
                return '중식'  # 기본값

            # ★ 중복 방지: (menu_name, site_name) 조합 기준으로 마지막 값만 유지
            values_dict = {}  # key: (menu_name, site_name), value: tuple
            mismatched_items = []  # ★ slot_clients와 불일치하는 항목
            for item in items:
                site_name = (item.get('site_name') or '').strip()
                meal_count = item.get('meal_count', 0)

                # 사업장명이 있으면 저장 (빈 사업장명은 저장 안함)
                if site_name:
                    category_value = item.get('business_type', '')  # business_type 값을 category로도 저장
                    menu_name = (item.get('menu_name') or '').strip()

                    # ★ menu_name이 비어있으면 site_name을 사용 (슬롯 미선택 방지)
                    if not menu_name:
                        menu_name = site_name
                        print(f"[WARN] menu_name 없음 → site_name 사용: {site_name}")

                    # ★★★ slot_clients 검증: 유효한 (category, slot_name, client_name) 조합인지 확인 ★★★
                    # 사업장 관리에 없는 사업장은 저장하지 않음 (고아 데이터 방지)
                    if valid_combinations and (category_value, menu_name, site_name) not in valid_combinations:
                        # 해당 슬롯의 유효한 client_name 목록 조회
                        valid_clients_for_slot = [c for (cat, s, c) in valid_combinations if s == menu_name]
                        mismatched_items.append({
                            "slot_name": menu_name,
                            "site_name": site_name,
                            "meal_count": meal_count,
                            "category": category_value,
                            "valid_clients": valid_clients_for_slot[:5]  # 최대 5개만
                        })
                        continue  # 불일치 항목은 저장하지 않음

                    # ★ meal_type 결정: category_slots 마스터 설정 우선 사용
                    meal_type = get_meal_type_for_slot(menu_name)

                    # ★ 중복 키: (menu_name, site_name) - 같은 조합이 있으면 덮어씀
                    key = (menu_name, site_name)
                    values_dict[key] = (
                        work_date,
                        category_value,  # business_type
                        category_value,  # category (동기화)
                        menu_name,
                        item.get('matching_name', ''),
                        meal_type,  # 슬롯명 기반 자동 추출
                        site_name,
                        meal_count,
                        item.get('menu_order', 0),
                        site_id,  # site_id
                        slot_cat_to_id.get((category_value, menu_name), slot_name_to_id.get(menu_name))  # ★ M-1: 카테고리+슬롯명 정밀 매핑, fallback
                    )

            # ★ 불일치 항목 로그 출력 (필터링됨)
            if mismatched_items:
                print(f"[API] ⚠️ slot_clients 불일치 {len(mismatched_items)}건 필터링 (저장 제외):", flush=True)
                for item in mismatched_items[:5]:
                    print(f"  - {item['slot_name']} > {item['site_name']} ({item['meal_count']}명) / 유효: {item['valid_clients']}")

            values_list = list(values_dict.values())

            if values_list:
                from psycopg2.extras import execute_values
                execute_values(
                    cursor,
                    """INSERT INTO meal_counts
                       (work_date, business_type, category, menu_name, matching_name, meal_type, site_name, meal_count, menu_order, site_id, slot_id)
                       VALUES %s""",
                    values_list
                )

            # ★ 감사 로그: 변경 내역 기록 (필터링 후 values_dict 기준으로 구성)
            new_data = {}  # {(menu_name, site_name): {'count': count, 'category': category}}
            for key, val in values_dict.items():
                # val = (work_date, category, category, menu_name, matching_name, meal_type, site_name, meal_count, ...)
                new_data[key] = {
                    'count': val[7],       # meal_count
                    'category': val[1]     # category_value
                }

            audit_logs = []
            new_keys = set(new_data.keys())
            old_keys = set(old_data.keys())

            # UPDATE: 기존에 있던 항목 중 식수가 변경된 경우
            for key in old_keys & new_keys:
                old_count = old_data[key]['count'] or 0
                new_count = new_data[key]['count'] or 0
                if old_count != new_count:
                    audit_logs.append((
                        old_data[key]['id'], 'UPDATE', work_date, site_id,
                        new_data[key]['category'], key[0], key[1],
                        old_count, new_count,
                        user_id, user_name, ip_address, user_agent
                    ))

            # INSERT: 새로 추가된 항목
            for key in new_keys - old_keys:
                new_count = new_data[key]['count'] or 0
                if new_count > 0:  # 0이 아닌 경우만 INSERT 로그
                    audit_logs.append((
                        None, 'INSERT', work_date, site_id,
                        new_data[key]['category'], key[0], key[1],
                        None, new_count,
                        user_id, user_name, ip_address, user_agent
                    ))

            # DELETE: 삭제된 항목 (기존에 있었으나 새 데이터에 없는 경우)
            for key in old_keys - new_keys:
                old_count = old_data[key]['count'] or 0
                if old_count > 0:  # 0이 아닌 경우만 DELETE 로그
                    audit_logs.append((
                        old_data[key]['id'], 'DELETE', work_date, site_id,
                        old_data[key]['category'], key[0], key[1],
                        old_count, None,
                        user_id, user_name, ip_address, user_agent
                    ))

            # 감사 로그 일괄 삽입
            if audit_logs:
                execute_values(
                    cursor,
                    """INSERT INTO meal_counts_audit_log
                       (meal_count_id, action, work_date, site_id, category, menu_name, site_name,
                        old_meal_count, new_meal_count, user_id, user_name, ip_address, user_agent)
                       VALUES %s""",
                    audit_logs
                )
                print(f"[감사로그] {work_date} 식수 변경 {len(audit_logs)}건 기록 (사용자: {user_name})")

            conn.commit()
            cursor.close()

            # 🚀 캐시 무효화 (해당 날짜 관련 캐시 삭제)
            meal_counts_cache.invalidate(f"date:{work_date}")
            meal_counts_cache.invalidate("range:")  # 범위 조회 캐시도 무효화
            print(f"[캐시] {work_date} 식수 캐시 무효화")

            site_info = f" (사업장 ID: {site_id})" if site_id else ""
            audit_info = f", 변경 이력 {len(audit_logs)}건" if audit_logs else ""
            mismatch_info = f", ⚠️ 사업장 불일치 {len(mismatched_items)}건" if mismatched_items else ""

            result = {
                "success": True,
                "message": f"{work_date} 식수 데이터 저장 완료{site_info}{audit_info}{mismatch_info}",
                "inserted": len(values_list),
                "audit_count": len(audit_logs)
            }

            # ★ slot_clients 불일치 항목 반환 (프론트엔드에서 경고 표시용)
            if mismatched_items:
                result["slot_client_mismatches"] = {
                    "count": len(mismatched_items),
                    "items": mismatched_items[:20],  # 최대 20개만 반환
                    "message": f"사업장관리에 없는 {len(mismatched_items)}건이 자동 제외되었습니다."
                }

            return result
    except Exception as e:
        print(f"[API] 식수 저장 오류: {e}")
        try:
            cursor.close()
        except Exception:
            pass
        return {"success": False, "error": str(e)}


@router.post("/api/meal-counts/fix-site-name")
async def fix_meal_counts_site_name(request: Request):
    """meal_counts의 site_name을 slot_clients의 client_name으로 수정"""
    try:
        body = await request.json()
        work_date = body.get('work_date')
        menu_name = body.get('menu_name')  # slot_name
        old_site_name = body.get('old_site_name')  # 현재 잘못된 이름
        new_site_name = body.get('new_site_name')  # 수정할 올바른 이름

        if not all([work_date, menu_name, old_site_name, new_site_name]):
            return {"success": False, "error": "필수 파라미터가 누락되었습니다."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. new_site_name이 slot_clients에 유효한지 검증
            cursor.execute("""
                SELECT scl.id FROM slot_clients scl
                JOIN category_slots cs ON scl.slot_id = cs.id
                WHERE cs.slot_name = %s AND scl.client_name = %s AND scl.is_active = TRUE
            """, (menu_name, new_site_name))

            if not cursor.fetchone():
                return {"success": False, "error": f"'{new_site_name}'은(는) '{menu_name}' 슬롯에 등록된 사업장이 아닙니다."}

            # 2. meal_counts 업데이트
            cursor.execute("""
                UPDATE meal_counts
                SET site_name = %s
                WHERE work_date = %s AND menu_name = %s AND site_name = %s
            """, (new_site_name, work_date, menu_name, old_site_name))

            updated_count = cursor.rowcount
            conn.commit()
            cursor.close()

            if updated_count > 0:
                print(f"[API] site_name 수정: {menu_name} > '{old_site_name}' → '{new_site_name}' ({updated_count}건)")
                return {
                    "success": True,
                    "message": f"'{old_site_name}' → '{new_site_name}' 수정 완료 ({updated_count}건)",
                    "updated_count": updated_count
                }
            else:
                return {"success": False, "error": "수정할 데이터가 없습니다."}

    except Exception as e:
        print(f"[API] site_name 수정 오류: {e}")
        try:
            if 'conn' in locals() and conn:
                conn.rollback()
        except:
            pass
        finally:
            try:
                if 'cursor' in locals() and cursor:
                    cursor.close()
            except:
                pass
        return {"success": False, "error": str(e)}


@router.get("/api/meal-counts/audit-log")
async def get_meal_counts_audit_log(
    work_date: str,
    site_id: Optional[int] = None,
    limit: int = 50
):
    """식수 변경 이력 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT action, category, menu_name, site_name,
                       old_meal_count, new_meal_count,
                       user_name, changed_at, ip_address
                FROM meal_counts_audit_log
                WHERE work_date = %s
            """
            params = [work_date]

            if site_id is not None:
                query += " AND site_id = %s"
                params.append(site_id)

            query += " ORDER BY changed_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            logs = []
            for row in rows:
                logs.append({
                    'action': row[0],
                    'category': row[1],
                    'menu_name': row[2],
                    'site_name': row[3],
                    'old_meal_count': row[4],
                    'new_meal_count': row[5],
                    'user_name': row[6],
                    'changed_at': str(row[7]) if row[7] else None,
                    'ip_address': row[8]
                })

            cursor.close()

            return {"success": True, "logs": logs, "count": len(logs)}
    except Exception as e:
        print(f"[API] 식수 이력 조회 오류: {e}")
        return {"success": False, "error": str(e), "logs": []}


@router.delete("/api/meal-counts/record/{record_id}")
async def delete_meal_count(record_id: int):
    """식수 레코드 개별 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 삭제 전 해당 레코드의 work_date 조회 (캐시 무효화용)
            cursor.execute("SELECT work_date FROM meal_counts WHERE id = %s", (record_id,))
            row = cursor.fetchone()

            if not row:
                cursor.close()
                return {"success": False, "error": f"ID {record_id} 레코드를 찾을 수 없습니다"}

            work_date = row[0]

            # 레코드 삭제
            cursor.execute("DELETE FROM meal_counts WHERE id = %s", (record_id,))
            conn.commit()
            cursor.close()

            # 캐시 무효화
            meal_counts_cache.invalidate(f"date:{work_date}")
            meal_counts_cache.invalidate("range:")
            print(f"[API] 식수 레코드 삭제: ID={record_id}, work_date={work_date}")

            return {"success": True, "message": f"ID {record_id} 레코드가 삭제되었습니다", "work_date": str(work_date)}
    except Exception as e:
        print(f"[API] 식수 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/meal-counts/cleanup-duplicates/{work_date}")
async def cleanup_duplicate_meal_counts(work_date: str, site_id: Optional[int] = None):
    """
    특정 날짜의 중복 식수 데이터 정리
    (menu_name, site_name) 조합 기준으로 중복 제거 - 가장 최근 데이터 유지
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 중복 데이터 찾기
            if site_id:
                cursor.execute("""
                    WITH duplicates AS (
                        SELECT id, menu_name, site_name, meal_count, created_at,
                               ROW_NUMBER() OVER (
                                   PARTITION BY menu_name, site_name
                                   ORDER BY id DESC
                               ) as rn
                        FROM meal_counts
                        WHERE work_date = %s AND site_id = %s
                    )
                    SELECT id, menu_name, site_name, meal_count
                    FROM duplicates
                    WHERE rn > 1
                """, (work_date, site_id))
            else:
                cursor.execute("""
                    WITH duplicates AS (
                        SELECT id, menu_name, site_name, meal_count, created_at,
                               ROW_NUMBER() OVER (
                                   PARTITION BY menu_name, site_name
                                   ORDER BY id DESC
                               ) as rn
                        FROM meal_counts
                        WHERE work_date = %s AND site_id IS NULL
                    )
                    SELECT id, menu_name, site_name, meal_count
                    FROM duplicates
                    WHERE rn > 1
                """, (work_date,))

            duplicates = cursor.fetchall()

            if not duplicates:
                cursor.close()
                return {"success": True, "message": "중복 데이터가 없습니다", "deleted_count": 0}

            # 중복 삭제
            duplicate_ids = [row[0] for row in duplicates]
            cursor.execute(
                f"DELETE FROM meal_counts WHERE id IN ({','.join(['%s'] * len(duplicate_ids))})",
                duplicate_ids
            )

            deleted_count = cursor.rowcount
            conn.commit()

            # 삭제된 항목 로그
            deleted_items = [{"id": row[0], "menu_name": row[1], "site_name": row[2], "meal_count": row[3]} for row in duplicates]
            print(f"[API] 중복 정리: {work_date}, 삭제 {deleted_count}건")
            for item in deleted_items[:10]:  # 최대 10개만 로그
                print(f"  - ID:{item['id']} {item['menu_name']} > {item['site_name']} (count:{item['meal_count']})")

            cursor.close()

            # 캐시 무효화
            meal_counts_cache.invalidate(f"date:{work_date}")
            meal_counts_cache.invalidate("range:")

            return {
                "success": True,
                "message": f"{deleted_count}개의 중복 데이터가 삭제되었습니다",
                "deleted_count": deleted_count,
                "deleted_items": deleted_items
            }
    except Exception as e:
        print(f"[API] 중복 정리 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/meal-counts/copy/{from_date}/{to_date}")
async def copy_meal_counts(from_date: str, to_date: str, site_id: Optional[int] = None):
    """특정 날짜의 식수 데이터를 다른 날짜로 복사 (사업장별, 고아 데이터 필터링)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★★★ 대상 날짜에 유효한 사업장 목록 조회 ★★★
            to_date_obj = datetime.strptime(to_date, '%Y-%m-%d').date()
            weekday_map = {0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'}
            target_weekday = weekday_map[to_date_obj.weekday()]

            # 대상 날짜에 유효한 슬롯-사업장 조합 조회
            valid_clients_query = """
                SELECT
                    scat.category_name,
                    cs.slot_name,
                    scl.client_name
                FROM slot_clients scl
                JOIN category_slots cs ON scl.slot_id = cs.id
                JOIN site_categories scat ON cs.category_id = scat.id
                JOIN site_groups sg ON scat.group_id = sg.id
                WHERE scl.is_active = TRUE
                  AND cs.is_active = TRUE
                  AND (scl.start_date IS NULL OR scl.start_date <= %s)
                  AND (scl.end_date IS NULL OR scl.end_date >= %s)
                  AND (scl.operating_days IS NULL
                       OR scl.operating_days = ''
                       OR (scl.operating_days::json->>%s)::boolean = true)
            """
            valid_params = [to_date, to_date, target_weekday]
            if site_id:
                valid_clients_query += " AND sg.id = %s"
                valid_params.append(site_id)

            cursor.execute(valid_clients_query, valid_params)
            valid_rows = cursor.fetchall()

            # 유효한 (카테고리, 슬롯, 사업장) 조합을 Set으로 저장
            valid_combinations = set()
            for row in valid_rows:
                cat_name, slot_name, client_name = row
                if cat_name and slot_name and client_name:
                    valid_combinations.add((cat_name, slot_name, client_name))

            print(f"[API] 복사 대상 {to_date} ({target_weekday}) 유효 사업장: {len(valid_combinations)}개")

            # 원본 데이터 조회 (site_id 필터) - category 포함
            if site_id:
                cursor.execute("""
                    SELECT COALESCE(category, business_type), menu_name, matching_name, meal_type, site_name, meal_count, menu_order, site_id
                    FROM meal_counts
                    WHERE work_date = %s AND site_id = %s
                """, (from_date, site_id))
            else:
                cursor.execute("""
                    SELECT COALESCE(category, business_type), menu_name, matching_name, meal_type, site_name, meal_count, menu_order, site_id
                    FROM meal_counts
                    WHERE work_date = %s AND site_id IS NULL
                """, (from_date,))

            source_data = cursor.fetchall()

            if not source_data:
                cursor.close()
                return {"success": False, "error": f"{from_date}에 복사할 데이터가 없습니다"}

            # ★★★ 고아 데이터 필터링 ★★★
            values_list = []
            filtered_items = []  # 필터링된 고아 데이터 목록

            for row in source_data:
                category = row[0]
                menu_name = row[1]
                site_name = (row[4] or '').strip()

                if not site_name:
                    continue  # 사업장명 없으면 스킵

                # 대상 날짜에 유효한 조합인지 확인
                if (category, menu_name, site_name) in valid_combinations:
                    values_list.append(
                        (to_date, row[0], row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7])
                    )
                else:
                    # 고아 데이터로 분류
                    filtered_items.append({
                        "category": category,
                        "slot": menu_name,
                        "site_name": site_name,
                        "meal_count": row[5],
                        "reason": "대상 날짜에 운영하지 않는 사업장"
                    })

            if filtered_items:
                print(f"[API] 복사 시 필터링된 고아 데이터: {len(filtered_items)}건")
                for item in filtered_items[:5]:  # 최대 5개만 로그
                    print(f"  - {item['category']} > {item['slot']} > {item['site_name']} ({item['meal_count']}명)")

            if not values_list:
                cursor.close()
                return {
                    "success": False,
                    "error": f"{from_date}에서 {to_date}로 복사할 유효한 데이터가 없습니다",
                    "filtered": filtered_items,
                    "filtered_count": len(filtered_items)
                }

            # 대상 날짜 + 사업장의 기존 데이터만 삭제
            if site_id:
                cursor.execute("DELETE FROM meal_counts WHERE work_date = %s AND site_id = %s", (to_date, site_id))
            else:
                cursor.execute("DELETE FROM meal_counts WHERE work_date = %s AND site_id IS NULL", (to_date,))

            # 데이터 복사 (유효한 데이터만)
            from psycopg2.extras import execute_values
            execute_values(
                cursor,
                """INSERT INTO meal_counts
                   (work_date, business_type, category, menu_name, matching_name, meal_type, site_name, meal_count, menu_order, site_id)
                   VALUES %s""",
                values_list
            )

            conn.commit()
            cursor.close()

            result = {
                "success": True,
                "message": f"{from_date} → {to_date} 복사 완료",
                "copied": len(values_list),
                "total_source": len(source_data)
            }

            # 필터링된 항목이 있으면 경고 정보 추가
            if filtered_items:
                result["warning"] = f"{len(filtered_items)}개 사업장이 대상 날짜에 운영하지 않아 제외됨"
                result["filtered"] = filtered_items
                result["filtered_count"] = len(filtered_items)

            return result
    except Exception as e:
        print(f"[API] 식수 복사 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/meal-counts/rename-category")
async def rename_meal_count_category(request: Request):
    """식수 카테고리 이름 변경 - category와 business_type 모두 업데이트"""
    try:
        data = await request.json()
        old_name = data.get('old_name')
        new_name = data.get('new_name')
        site_id = data.get('site_id')

        if not old_name or not new_name:
            return {"success": False, "error": "old_name과 new_name은 필수입니다."}

        if old_name == new_name:
            return {"success": True, "message": "이름이 동일하여 변경하지 않았습니다.", "updated": 0}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_id가 있으면 해당 사업장만, 없으면 전체
            # category와 business_type 모두 업데이트
            if site_id:
                cursor.execute("""
                    UPDATE meal_counts
                    SET business_type = %s, category = %s
                    WHERE (business_type = %s OR category = %s) AND site_id = %s
                """, (new_name, new_name, old_name, old_name, site_id))
            else:
                cursor.execute("""
                    UPDATE meal_counts
                    SET business_type = %s, category = %s
                    WHERE business_type = %s OR category = %s
                """, (new_name, new_name, old_name, old_name))

            updated_count = cursor.rowcount
            conn.commit()
            cursor.close()

            print(f"[API] 카테고리 이름 변경: '{old_name}' → '{new_name}', {updated_count}개 레코드 업데이트")
            return {
                "success": True,
                "message": f"'{old_name}'을(를) '{new_name}'(으)로 변경했습니다.",
                "updated": updated_count
            }

    except Exception as e:
        print(f"[API] 카테고리 이름 변경 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/meal-counts/summary/{work_date}")
async def get_meal_counts_summary(work_date: str, site_id: Optional[int] = None):
    """특정 날짜의 식수 요약 통계 (사업장별)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_id 필터 조건
            site_filter = ""
            params = [work_date]
            if site_id:
                site_filter = " AND site_id = %s"
                params.append(site_id)

            # 전체 합계
            cursor.execute(f"""
                SELECT
                    COUNT(DISTINCT site_name) as site_count,
                    SUM(meal_count) as total_count,
                    COUNT(DISTINCT business_type) as business_type_count
                FROM meal_counts
                WHERE work_date = %s{site_filter}
            """, params)

            summary = cursor.fetchone()

            # 사업장 유형별 합계
            cursor.execute(f"""
                SELECT business_type, SUM(meal_count) as total
                FROM meal_counts
                WHERE work_date = %s{site_filter}
                GROUP BY business_type
                ORDER BY business_type
            """, params)

            by_business = [{"type": row[0], "total": row[1]} for row in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "summary": {
                    "site_count": summary[0] or 0,
                    "total_count": summary[1] or 0,
                    "business_type_count": summary[2] or 0
                },
                "by_business_type": by_business
            }
    except Exception as e:
        print(f"[API] 식수 요약 조회 오류: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# 식수관리용 사업장 관리 API
# ============================================

@router.get("/api/meal-count-sites")
async def get_meal_count_sites(include_inactive: bool = False, meal_type: str = None, group_id: int = None):
    """[DEPRECATED] 식수관리용 사업장 목록 조회 - /api/v2/clients 사용 권장

    Args:
        include_inactive: 비활성 사업장도 포함할지 여부
        meal_type: (미사용, 호환성 유지)
        group_id: 그룹 필터 (1=본사, 2=영남지사). None이면 전체 조회
    """
    try:
        print("[DEPRECATED] /api/meal-count-sites 호출됨 - /api/v2/clients 사용 권장")
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # group_id 컬럼 존재 확인 및 추가
            try:
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'meal_count_sites' AND column_name = 'group_id'
                """)
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE meal_count_sites ADD COLUMN group_id INTEGER DEFAULT 1")
                    conn.commit()
            except Exception as migration_error:
                print(f"[마이그레이션] group_id 컬럼 추가 건너뜀: {migration_error}")
                conn.rollback()

            query = """
                SELECT id, business_type, slot_name, site_name, display_order, is_active, created_at,
                       category_id, group_id
                FROM meal_count_sites
                WHERE 1=1
            """
            params = []

            if not include_inactive:
                query += " AND is_active = TRUE"

            # group_id 필터
            if group_id is not None:
                query += " AND group_id = %s"
                params.append(group_id)

            query += " ORDER BY business_type, slot_name, display_order, site_name"

            # ★ 디버그: 실행되는 쿼리 확인
            print(f"[DEBUG] meal-count-sites 쿼리: {query}")
            print(f"[DEBUG] 파라미터: {params}")

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            sites = []
            for row in rows:
                sites.append({
                    "id": row[0],
                    "business_type": row[1] or '운반',
                    "slot_name": row[2] or '',
                    "site_name": row[3],
                    "display_order": row[4],
                    "is_active": row[5],
                    "created_at": row[6].isoformat() if row[6] else None,
                    "category_id": row[7],
                    "group_id": row[8] or 1
                })

            return {"success": True, "sites": sites}
    except Exception as e:
        print(f"[API] 식수관리 사업장 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/meal-count-sites")
async def save_meal_count_site(request: Request):
    """[DEPRECATED] 식수관리용 사업장 추가/수정 - /api/v2/clients 사용 권장

    구조: 그룹(group_id) → 카테고리(business_type) → 슬롯(slot_name) → 사업장(site_name)
    """
    try:
        print("[DEPRECATED] POST /api/meal-count-sites 호출됨 - /api/v2/clients 사용 권장")
        data = await request.json()
        site_id = data.get('id')
        slot_name = data.get('slot_name', '')
        site_name = data.get('site_name', '').strip()
        business_type = data.get('business_type', '운반')
        display_order = data.get('display_order', 0)
        is_active = data.get('is_active', True)
        group_id = data.get('group_id', 1)  # 기본값: 본사(1)
        category_id = data.get('category_id')

        if not site_name and not site_id:
            return {"success": False, "error": "사업장명을 입력해주세요"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if site_id:
                # 수정
                if site_name:
                    # 기존 slot_name 조회 (변경 감지용)
                    cursor.execute("SELECT slot_name FROM meal_count_sites WHERE id = %s", (site_id,))
                    old_result = cursor.fetchone()
                    old_slot_name = old_result[0] if old_result else None

                    cursor.execute("""
                        UPDATE meal_count_sites
                        SET slot_name = %s, site_name = %s, business_type = %s, display_order = %s,
                            is_active = %s, group_id = %s, category_id = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (slot_name, site_name, business_type, display_order, is_active, group_id, category_id, site_id))

                    # slot_name이 변경된 경우, 연결된 테이블도 업데이트
                    if old_slot_name and old_slot_name != slot_name:
                        # meal_counts.menu_name 업데이트
                        cursor.execute("""
                            UPDATE meal_counts SET menu_name = %s WHERE menu_name = %s
                        """, (slot_name, old_slot_name))
                        updated_counts = cursor.rowcount

                        # meal_plans.slot_name 업데이트
                        cursor.execute("""
                            UPDATE meal_plans SET slot_name = %s WHERE slot_name = %s
                        """, (slot_name, old_slot_name))
                        updated_plans = cursor.rowcount

                        print(f"[사업장관리] 슬롯명 변경: '{old_slot_name}' → '{slot_name}' (meal_counts: {updated_counts}행, meal_plans: {updated_plans}행)")

                    message = f"사업장 '{site_name}' 수정 완료"
                else:
                    # site_name 없이 is_active만 변경하는 경우 (활성화 토글)
                    cursor.execute("""
                        UPDATE meal_count_sites
                        SET is_active = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (is_active, site_id))
                    message = "사업장 상태 변경 완료"
            else:
                # 추가
                cursor.execute("""
                    INSERT INTO meal_count_sites (business_type, slot_name, site_name, display_order, is_active, group_id, category_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (business_type, slot_name, site_name, display_order, is_active, group_id, category_id))
                result = cursor.fetchone()
                site_id = result[0] if result else None
                group_name = '본사' if group_id == 1 else '영남지사' if group_id == 2 else f'그룹{group_id}'

                # site_id 결정 (group_id 기반)
                target_site_id = 1 if group_id == 1 else 2 if group_id == 2 else group_id

                # meal_slot_settings에도 추가 (슬롯 설정 테이블)
                cursor.execute("""
                    INSERT INTO meal_slot_settings (slot_key, display_name, is_active, entity_type, entity_id)
                    VALUES (%s, %s, TRUE, 'category', %s)
                    ON CONFLICT (slot_key) DO NOTHING
                """, (slot_name, slot_name, category_id))

                print(f"[사업장관리] 추가: '{slot_name}' (site_id={target_site_id}, category_id={category_id})")
                message = f"[{group_name}] [{business_type}] {slot_name} > {site_name} 추가 완료"

            conn.commit()
            cursor.close()

            return {"success": True, "message": message, "id": site_id}
    except Exception as e:
        print(f"[API] 식수관리 사업장 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/meal-count-sites/{site_id}")
async def delete_meal_count_site(site_id: int):
    """[DEPRECATED] 식수관리용 사업장 삭제 - /api/v2/clients/{id} 사용 권장"""
    try:
        print("[DEPRECATED] DELETE /api/meal-count-sites 호출됨 - /api/v2/clients 사용 권장")
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 먼저 slot_name 조회 (연결 테이블 삭제용)
            cursor.execute("SELECT slot_name, site_name FROM meal_count_sites WHERE id = %s", (site_id,))
            site_info = cursor.fetchone()

            if not site_info:
                return {"success": False, "error": "사업장을 찾을 수 없습니다"}

            slot_name, site_name = site_info

            # 소프트 삭제 (비활성화)
            cursor.execute("""
                UPDATE meal_count_sites
                SET is_active = FALSE, updated_at = NOW()
                WHERE id = %s
            """, (site_id,))

            # 연결된 meal_counts 삭제 (해당 슬롯의 모든 식수 데이터)
            cursor.execute("DELETE FROM meal_counts WHERE menu_name = %s", (slot_name,))
            deleted_counts = cursor.rowcount

            # 연결된 meal_plans 삭제 (해당 슬롯의 모든 식단 데이터)
            cursor.execute("DELETE FROM meal_plans WHERE slot_name = %s", (slot_name,))
            deleted_plans = cursor.rowcount

            # meal_slot_settings 비활성화
            cursor.execute("""
                UPDATE meal_slot_settings SET is_active = FALSE
                WHERE slot_key = %s OR display_name = %s
            """, (slot_name, slot_name))

            conn.commit()
            cursor.close()

            print(f"[사업장관리] 삭제: '{slot_name}' (meal_counts: {deleted_counts}행, meal_plans: {deleted_plans}행)")
            return {"success": True, "message": f"사업장 '{site_name}' 및 관련 데이터 삭제 완료"}
    except Exception as e:
        print(f"[API] 식수관리 사업장 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/meal-count-sites/migrate")
async def migrate_meal_count_sites(reset: bool = False, group_id: int = 1):
    """기존 meal_counts에서 사업장 목록 자동 추출하여 마이그레이션

    구조: 그룹(group_id) → 카테고리(business_type) → 슬롯(menu_name) → 사업장(site_name)

    Args:
        reset: True이면 기존 데이터를 삭제하고 새로 마이그레이션
        group_id: 대상 그룹 (1=본사, 2=영남지사)
    """
    group_name = '본사' if group_id == 1 else '영남지사' if group_id == 2 else f'그룹{group_id}'
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # group_id 컬럼 존재 확인 및 추가
            try:
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'meal_count_sites' AND column_name = 'group_id'
                """)
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE meal_count_sites ADD COLUMN group_id INTEGER DEFAULT 1")
                    conn.commit()
            except:
                conn.rollback()

            # reset=True이면 해당 그룹의 데이터만 삭제
            if reset:
                cursor.execute("DELETE FROM meal_count_sites WHERE group_id = %s", (group_id,))
                conn.commit()
                print(f"[마이그레이션] {group_name} meal_count_sites 데이터 삭제됨")

            # 해당 그룹의 슬롯명 목록 가져오기 (meal_slot_settings에서)
            cursor.execute("""
                SELECT display_name
                FROM meal_slot_settings
                WHERE is_active = TRUE AND entity_type = 'category'
                  AND entity_id IN (SELECT id FROM meal_categories WHERE site_id = %s)
            """, (group_id,))
            valid_slots = set(row[0] for row in cursor.fetchall())
            print(f"[마이그레이션] 유효한 {group_name} 슬롯: {len(valid_slots)}개")

            # 해당 그룹의 카테고리명 목록
            cursor.execute("SELECT name FROM meal_categories WHERE site_id = %s", (group_id,))
            valid_categories = set(row[0] for row in cursor.fetchall())
            print(f"[마이그레이션] {group_name} 카테고리: {valid_categories}")

            # 기존 meal_counts에서 해당 그룹 데이터 추출
            if group_id == 1:
                # 본사: 영남 데이터 제외
                cursor.execute("""
                    SELECT DISTINCT business_type, menu_name, site_name
                    FROM meal_counts
                    WHERE site_name IS NOT NULL AND site_name != ''
                      AND menu_name IS NOT NULL AND menu_name != ''
                      AND business_type IN (SELECT name FROM meal_categories WHERE site_id = 1)
                      AND menu_name NOT LIKE '%%영남%%'
                    ORDER BY business_type, menu_name, site_name
                """)
            else:
                # 영남지사: 영남 데이터만 (menu_name에 '영남' 포함)
                cursor.execute("""
                    SELECT DISTINCT business_type, menu_name, site_name
                    FROM meal_counts
                    WHERE site_name IS NOT NULL AND site_name != ''
                      AND menu_name IS NOT NULL AND menu_name != ''
                      AND menu_name LIKE '%%영남%%'
                    ORDER BY business_type, menu_name, site_name
                """)

            all_sites = cursor.fetchall()

            # 유효한 슬롯명과 매칭되는 것만 필터링
            existing_sites = [(bt, mn, sn) for bt, mn, sn in all_sites if mn in valid_slots]
            print(f"[마이그레이션] 전체 {len(all_sites)}개 중 유효 슬롯 매칭: {len(existing_sites)}개")

            # 매칭 안 된 슬롯 확인 (디버깅용)
            unmatched = [(bt, mn, sn) for bt, mn, sn in all_sites if mn not in valid_slots]
            unmatched_slots = set(mn for bt, mn, sn in unmatched)
            print(f"[마이그레이션] 매칭 안 된 슬롯: {unmatched_slots}")

            migrated_count = 0
            errors = []
            for idx, (business_type, slot_name, site_name) in enumerate(existing_sites):
                try:
                    # ★ group_id 추가
                    cursor.execute("""
                        INSERT INTO meal_count_sites (business_type, slot_name, site_name, display_order, is_active, group_id)
                        VALUES (%s, %s, %s, %s, TRUE, %s)
                    """, (business_type or '운반', slot_name, site_name, idx, group_id))
                    conn.commit()
                    migrated_count += 1
                except Exception as insert_err:
                    conn.rollback()
                    if len(errors) < 5:
                        errors.append(str(insert_err))

            if errors:
                print(f"[마이그레이션] 오류 샘플: {errors[:3]}")
            cursor.close()

            return {
                "success": True,
                "message": f"{group_name} {migrated_count}개 사업장 마이그레이션 완료",
                "total_found": len(all_sites),
                "matched": len(existing_sites),
                "migrated": migrated_count,
                "valid_slots_count": len(valid_slots),
                "valid_categories": list(valid_categories),
                "unmatched_slots": list(unmatched_slots)[:20]  # 최대 20개만
            }
    except Exception as e:
        print(f"[API] 식수관리 사업장 마이그레이션 오류: {e}")
        return {"success": False, "error": str(e)}
