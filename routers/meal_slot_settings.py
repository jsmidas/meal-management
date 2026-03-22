#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
슬롯 설정 API 라우터
- meal_slot_settings 테이블 마이그레이션
- 슬롯명 설정 CRUD (DEPRECATED - /api/v2/slots 사용 권장)
- 카테고리별 슬롯 조회
- 슬롯 사용 현황 조회
"""

import time
from typing import Optional

from fastapi import APIRouter, Request
from core.database import get_db_connection

router = APIRouter()


# ============================================
# 테이블 마이그레이션
# ============================================

def ensure_meal_slot_settings_table():
    """meal_slot_settings 테이블이 없으면 생성 (슬롯명 설정 저장용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_slot_settings (
                    id SERIAL PRIMARY KEY,
                    slot_key VARCHAR(50) NOT NULL,
                    display_name VARCHAR(100) NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    target_cost INTEGER DEFAULT 0,
                    selling_price INTEGER DEFAULT 0,
                    entity_type VARCHAR(20) DEFAULT NULL,
                    entity_id INTEGER DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            conn.commit()

            # ★ 기존 slot_key UNIQUE 제약조건 제거 및 복합 UNIQUE로 변경
            cursor.execute("""
                DO $$
                BEGIN
                    -- 기존 slot_key UNIQUE 제약조건 제거 (존재하면)
                    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_slot_settings_slot_key_key') THEN
                        ALTER TABLE meal_slot_settings DROP CONSTRAINT meal_slot_settings_slot_key_key;
                    END IF;
                    -- slot_key + entity_type + entity_id 복합 UNIQUE 제약조건 추가 (없으면)
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_slot_settings_slot_entity_unique') THEN
                        ALTER TABLE meal_slot_settings
                        ADD CONSTRAINT meal_slot_settings_slot_entity_unique
                        UNIQUE (slot_key, entity_type, entity_id);
                    END IF;
                END $$;
            """)
            conn.commit()

            # 기존 테이블 마이그레이션
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='target_cost') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN target_cost INTEGER DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='site_id') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN site_id INTEGER DEFAULT NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='selling_price') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN selling_price INTEGER DEFAULT 0;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='entity_type') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN entity_type VARCHAR(20) DEFAULT NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='entity_id') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN entity_id INTEGER DEFAULT NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_name='meal_slot_settings' AND column_name='effective_from') THEN
                        ALTER TABLE meal_slot_settings ADD COLUMN effective_from DATE DEFAULT NULL;
                    END IF;
                END $$;
            """)
            conn.commit()

            cursor.close()
            print("[DB] meal_slot_settings 테이블 확인/생성 완료 (selling_price, entity_type/id 포함)")
            return True
    except Exception as e:
        print(f"[DB] meal_slot_settings 테이블 생성 오류: {e}")
        return False


# 서버 시작시 테이블 생성
ensure_meal_slot_settings_table()


# ============================================
# 슬롯 캐시 (디버깅용 비활성화)
# ============================================

_slot_cache = {}
_slot_cache_time = {}
SLOT_CACHE_TTL = 0  # 캐시 비활성화 (디버깅용)


# ============================================
# 어드민 슬롯 설정 API
# ============================================

@router.get("/api/admin/slot-settings")
async def get_slot_settings(category: Optional[str] = None, site_id: Optional[int] = None, group_id: Optional[int] = None):
    """어드민 운영관리의 슬롯 설정 목록 조회 (meal_slot_settings 테이블)

    site_id 또는 group_id를 전달하면 해당 그룹의 카테고리 슬롯을 조회합니다.
    - 본사(group_id=1): 도시락(1), 운반(2), 학교(3), 요양원(4)
    - 영남지사(group_id=2): 도시락(5), 운반(6)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_id에서 group_id 조회
            target_group_id = group_id
            if site_id and not group_id:
                # site_id가 site_groups의 id인 경우 (본사=1, 영남지사=2 등)
                cursor.execute("SELECT id FROM site_groups WHERE id = %s", (site_id,))
                row = cursor.fetchone()
                if row:
                    target_group_id = row[0]
                else:
                    # business_locations에서 group_id 조회
                    cursor.execute("SELECT group_id FROM business_locations WHERE id = %s", (site_id,))
                    row = cursor.fetchone()
                    if row:
                        target_group_id = row[0]

            # 기본값: 본사(group_id=1)
            if not target_group_id:
                target_group_id = 1

            # 그룹별 카테고리명 -> entity_id 매핑 조회
            entity_id = None
            if category:
                cursor.execute("""
                    SELECT id FROM site_categories
                    WHERE group_id = %s AND category_name = %s AND is_active = true
                """, (target_group_id, category))
                row = cursor.fetchone()
                if row:
                    entity_id = row[0]
                else:
                    # 해당 그룹에 카테고리가 없으면 본사 카테고리로 폴백
                    cursor.execute("""
                        SELECT id FROM site_categories
                        WHERE group_id = 1 AND category_name = %s AND is_active = true
                    """, (category,))
                    row = cursor.fetchone()
                    if row:
                        entity_id = row[0]

            query = """
                SELECT slot_key, display_name, sort_order, entity_id
                FROM meal_slot_settings
                WHERE is_active = true
            """
            params = []

            # 카테고리 필터
            if entity_id:
                query += " AND entity_type = 'category' AND entity_id = %s"
                params.append(entity_id)

            query += " ORDER BY sort_order, slot_key"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            slots = []
            for row in rows:
                slots.append({
                    "slot_key": row[0],
                    "display_name": row[1],
                    "sort_order": row[2],
                    "entity_id": row[3]
                })

            cursor.close()

            return {"success": True, "slots": slots, "group_id": target_group_id, "entity_id": entity_id}
    except Exception as e:
        print(f"[API] slot-settings 오류: {e}")
        return {"success": False, "slots": [], "error": str(e)}


# ============================================
# 슬롯명 설정 API (서버 저장 방식)
# ============================================

@router.get("/api/meal-slot-settings")
async def get_meal_slot_settings(entity_type: str = None, entity_id: int = None, site_id: int = None):
    """[DEPRECATED] 저장된 슬롯명 설정 조회 - /api/v2/slots 사용 권장

    우선순위: site_id가 주어지면 해당 사이트의 카테고리/그룹 설정을 찾음
    - 사이트 레벨 설정 (있으면)
    - 카테고리 레벨 설정 (있으면)
    - 그룹 레벨 설정 (있으면)
    - 전역 설정 (entity_type IS NULL)
    """
    try:
        print("[DEPRECATED] /api/meal-slot-settings 호출됨 - /api/v2/slots 사용 권장")
        with get_db_connection() as conn:
            cursor = conn.cursor()

            category_id = None
            group_id = None

            # site_id가 주어지면 해당 사이트의 카테고리/그룹 찾기 (상위 계층 설정 상속용)
            if site_id:
                cursor.execute("""
                    SELECT bl.category_id, sc.group_id
                    FROM business_locations bl
                    LEFT JOIN site_categories sc ON bl.category_id = sc.id
                    WHERE bl.id = %s
                """, (site_id,))
                site_info = cursor.fetchone()
                if site_info:
                    category_id = site_info[0]
                    group_id = site_info[1]
                # site_id가 주어진 경우 상위 계층도 조회해야 하므로 entity_type 설정 안함

            # 설정 조회 (entity_type/entity_id가 직접 파라미터로 지정된 경우 해당 설정만 조회)
            if entity_type and entity_id and not site_id:
                # 특정 엔티티의 설정만 조회 (전역 설정 제외)
                cursor.execute("""
                    SELECT slot_key, display_name, sort_order, is_active,
                           COALESCE(target_cost, 0) as target_cost,
                           COALESCE(selling_price, 0) as selling_price,
                           entity_type, entity_id, effective_from
                    FROM meal_slot_settings
                    WHERE is_active = TRUE
                      AND entity_type = %s AND entity_id = %s
                    ORDER BY sort_order, slot_key
                """, (entity_type, entity_id))
            else:
                # 🔧 수정: 모든 카테고리의 설정을 반환 (여러 카테고리 식단 관리를 위해)
                # site_id의 카테고리 우선, 그 외 모든 카테고리 설정도 포함
                cursor.execute("""
                    SELECT slot_key, display_name, sort_order, is_active,
                           COALESCE(target_cost, 0) as target_cost,
                           COALESCE(selling_price, 0) as selling_price,
                           entity_type, entity_id, effective_from,
                           CASE
                               WHEN entity_type = 'site' AND entity_id = %s THEN 1
                               WHEN entity_type = 'category' AND entity_id = %s THEN 2
                               WHEN entity_type = 'category' THEN 3
                               WHEN entity_type = 'group' AND entity_id = %s THEN 4
                               ELSE 5
                           END as priority
                    FROM meal_slot_settings
                    WHERE is_active = TRUE
                      AND entity_type = 'category'
                    ORDER BY slot_key, priority
                """, (site_id, category_id, group_id))

            rows = cursor.fetchall()

            # slot_key로만 등록 (중복 방지)
            settings = {}
            for row in rows:
                slot_key = row[0]
                display_name = row[1]
                effective_from_val = row[8]
                setting_data = {
                    "display_name": display_name,
                    "sort_order": row[2],
                    "is_active": row[3],
                    "target_cost": row[4],
                    "selling_price": row[5],
                    "entity_type": row[6],
                    "entity_id": row[7],
                    "effective_from": str(effective_from_val) if effective_from_val else None
                }
                # slot_key로만 등록 (display_name 중복 등록 제거)
                settings[slot_key] = setting_data

            cursor.close()

            return {"success": True, "settings": settings}
    except Exception as e:
        print(f"[API] 슬롯 설정 조회 오류: {e}")
        return {"success": False, "error": str(e), "settings": {}}


@router.post("/api/meal-slot-settings")
async def save_meal_slot_settings(request: Request):
    """[DEPRECATED] 슬롯명 설정 저장 - /api/v2/slots 사용 권장

    ★ 구조 개선: slot_key는 자동 생성 ID (cat{entity_id}_slot{순번})
    - 새 슬롯: slot_key가 'new_'로 시작하거나 없으면 자동 생성
    - 기존 슬롯: slot_key로 식별하여 업데이트
    - display_name: 화면에 표시되는 이름 (금액 미포함)
    """
    try:
        print("[DEPRECATED] POST /api/meal-slot-settings 호출됨 - /api/v2/slots 사용 권장")
        body = await request.json()
        settings = body.get('settings', {})

        if not settings:
            return {"success": False, "error": "settings가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            saved_count = 0
            for slot_key, config in settings.items():
                display_name = config.get('display_name', slot_key)
                sort_order = config.get('sort_order', 0)
                is_active = config.get('is_active', True)
                target_cost = config.get('target_cost', 0)
                selling_price = config.get('selling_price', 0)
                entity_type = config.get('entity_type', None)
                entity_id = config.get('entity_id', None)
                effective_from = config.get('effective_from', None)

                # ★ 새 슬롯인지 확인 (slot_key가 'new_'로 시작하거나, 기존 형식인 경우)
                is_new_slot = slot_key.startswith('new_') or not slot_key.startswith('cat')

                if is_new_slot:
                    # ★ 새 슬롯: slot_key 자동 생성
                    cursor.execute("""
                        SELECT COALESCE(MAX(CAST(SUBSTRING(slot_key FROM 'cat[0-9]+_slot([0-9]+)') AS INTEGER)), 0) + 1
                        FROM meal_slot_settings
                        WHERE entity_type = %s AND entity_id = %s
                    """, (entity_type, entity_id))
                    next_num = cursor.fetchone()[0] or 1
                    new_slot_key = f"cat{entity_id or 0}_slot{next_num}"

                    cursor.execute("""
                        INSERT INTO meal_slot_settings
                        (slot_key, display_name, sort_order, is_active, target_cost, selling_price, entity_type, entity_id, effective_from, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    """, (new_slot_key, display_name, sort_order, is_active, target_cost, selling_price, entity_type, entity_id, effective_from))
                    print(f"[API] 새 슬롯 생성: {new_slot_key} ({display_name})")
                else:
                    # ★ 기존 슬롯: slot_key + entity_type + entity_id로 찾아서 업데이트
                    cursor.execute("""
                        SELECT id FROM meal_slot_settings
                        WHERE slot_key = %s
                          AND COALESCE(entity_type, '') = COALESCE(%s, '')
                          AND COALESCE(entity_id, 0) = COALESCE(%s, 0)
                    """, (slot_key, entity_type, entity_id))
                    existing = cursor.fetchone()

                    if existing:
                        cursor.execute("""
                            UPDATE meal_slot_settings SET
                                display_name = %s, sort_order = %s, is_active = %s,
                                target_cost = %s, selling_price = %s, effective_from = %s,
                                updated_at = NOW()
                            WHERE id = %s
                        """, (display_name, sort_order, is_active, target_cost, selling_price, effective_from, existing[0]))
                    else:
                        # 기존 슬롯이 없으면 새로 생성
                        cursor.execute("""
                            INSERT INTO meal_slot_settings
                            (slot_key, display_name, sort_order, is_active, target_cost, selling_price, entity_type, entity_id, effective_from, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        """, (slot_key, display_name, sort_order, is_active, target_cost, selling_price, entity_type, entity_id, effective_from))
                saved_count += 1

            conn.commit()
            cursor.close()

            # 캐시 무효화 (저장 후 캐시 갱신)
            global _slot_cache, _slot_cache_time
            _slot_cache = {}
            _slot_cache_time = {}
            print(f"[API] 슬롯 설정 저장 완료: {saved_count}개, 캐시 무효화")

            return {"success": True, "message": f"{saved_count}개 슬롯 설정 저장 완료", "saved_count": saved_count}
    except Exception as e:
        print(f"[API] 슬롯 설정 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/meal-slot-settings/{slot_key}")
async def delete_meal_slot_setting(slot_key: str, entity_type: Optional[str] = None, entity_id: Optional[int] = None):
    """슬롯 비활성화 - 실제 삭제 아님, is_active=false로 변경

    ★ 정책:
    - 슬롯 삭제 = 비활성화 (is_active=false)
    - 모든 관련 데이터 보존 (meal_count_sites, meal_counts, meal_plans)
    - 비활성화된 슬롯은 UI에서 선택 불가
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 삭제 대신 비활성화 (is_active=false)
            if entity_type and entity_id:
                cursor.execute("""
                    UPDATE meal_slot_settings
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE slot_key = %s AND entity_type = %s AND entity_id = %s
                """, (slot_key, entity_type, entity_id))
            else:
                cursor.execute("""
                    UPDATE meal_slot_settings
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE slot_key = %s
                """, (slot_key,))

            updated = cursor.rowcount
            conn.commit()
            cursor.close()

            if updated > 0:
                return {"success": True, "message": f"{slot_key} 슬롯이 비활성화되었습니다", "updated": updated}
            else:
                return {"success": False, "error": "슬롯을 찾을 수 없습니다"}
    except Exception as e:
        print(f"[API] 슬롯 비활성화 오류: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# 카테고리별 슬롯 조회 / 슬롯 관리 API
# ============================================

@router.get("/api/meal-slots/by-category/{category_id}")
async def get_meal_slots_by_category(category_id: int):
    """[DEPRECATED] 카테고리별 슬롯 목록 조회 - /api/v2/slots?category_id= 사용 권장"""
    import time

    # ★★★ Deprecation 경고 ★★★
    print(f"[DEPRECATED] /api/meal-slots/by-category/{category_id} 호출됨 - /api/v2/slots?category_id= 사용 권장")

    # 캐시 확인
    cache_key = f"slots_{category_id}"
    if cache_key in _slot_cache:
        if time.time() - _slot_cache_time.get(cache_key, 0) < SLOT_CACHE_TTL:
            return _slot_cache[cache_key]

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★★★ category_slots 테이블 사용 (통합) ★★★
            # ★★★ 슬롯 정렬: category_slots.meal_type 기준 (조식 > 중식 > 석식 > 야식 > 행사 > 기타) ★★★
            cursor.execute("""
                SELECT
                    cs.id as slot_id,
                    COALESCE(cs.slot_code, 'slot_' || cs.id) as slot_key,
                    cs.slot_name as display_name,
                    COALESCE(cs.display_order, 0) as sort_order,
                    COALESCE(cs.target_cost, 0) as target_cost,
                    COALESCE(cs.selling_price, 0) as selling_price
                FROM category_slots cs
                WHERE cs.is_active = TRUE
                  AND cs.category_id = %s
                ORDER BY
                    CASE cs.meal_type
                        WHEN '조식' THEN 1
                        WHEN '중식' THEN 2
                        WHEN '석식' THEN 3
                        WHEN '야식' THEN 4
                        WHEN '행사' THEN 5
                        ELSE 6
                    END,
                    cs.display_order, cs.slot_name
            """, (category_id,))

            rows = cursor.fetchall()
            slots = []
            for row in rows:
                slots.append({
                    "slot_id": row[0],
                    "slot_key": row[1],
                    "display_name": row[2],
                    "sort_order": row[3],
                    "target_cost": row[4],
                    "selling_price": row[5]
                })

            cursor.close()

            result = {"success": True, "slots": slots, "category_id": category_id}

            # 캐시 저장
            _slot_cache[cache_key] = result
            _slot_cache_time[cache_key] = time.time()

            return result
    except Exception as e:
        print(f"[API] 카테고리별 슬롯 조회 오류: {e}")
        return {"success": False, "error": str(e), "slots": []}


@router.post("/api/meal-slots/rename")
async def rename_meal_slot(request: Request):
    """슬롯 이름 변경 - 비활성화됨

    ★ 정책 변경: 슬롯명 수정 불가
    - 슬롯명을 변경하면 과거 데이터와의 연결이 끊어짐
    - 슬롯 변경이 필요하면: 기존 슬롯 삭제 → 새 슬롯 생성
    """
    return {
        "success": False,
        "error": "슬롯명 수정은 지원되지 않습니다. 슬롯을 삭제하고 새로 생성해주세요."
    }


@router.get("/api/meal-slots/usage/{slot_key}")
async def get_meal_slot_usage(slot_key: str, entity_type: str = None, entity_id: int = None):
    """슬롯 사용 현황 조회 (삭제 전 확인용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            usage = {"meal_counts": 0, "meal_plans": 0}

            if entity_type == 'category' and entity_id:
                # 카테고리에 속한 사이트들의 사용 현황
                cursor.execute("""
                    SELECT COUNT(*) FROM meal_counts mc
                    JOIN business_locations bl ON mc.site_id = bl.id
                    WHERE bl.category_id = %s AND mc.menu_name = %s
                """, (entity_id, slot_key))
                usage["meal_counts"] = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT COUNT(*) FROM meal_plans mp
                    JOIN business_locations bl ON mp.site_id = bl.id
                    WHERE bl.category_id = %s AND mp.slot_name = %s
                """, (entity_id, slot_key))
                usage["meal_plans"] = cursor.fetchone()[0]

            cursor.close()

            return {"success": True, "slot_key": slot_key, "usage": usage}
    except Exception as e:
        print(f"[API] 슬롯 사용 현황 조회 오류: {e}")
        return {"success": False, "error": str(e)}
