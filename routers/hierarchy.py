#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hierarchy Router (v2)
정규화된 사업장 관리 API - 계층구조 (그룹 > 카테고리 > 슬롯 > 고객사)
"""

import json
import re
import time
import uuid
import unicodedata
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Request
from core.database import get_db_connection

router = APIRouter()


@router.get("/api/v2/groups")
async def get_groups_v2():
    """그룹 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, group_name, group_code, display_order FROM site_groups WHERE is_active = TRUE ORDER BY display_order")
            rows = cursor.fetchall()
            cursor.close()
            return {"success": True, "data": [
                {"id": r[0], "group_name": r[1], "group_code": r[2], "display_order": r[3]}
                for r in rows
            ]}
    except Exception as e:
        return {"success": False, "error": str(e)}


def normalize_client_name(name: str) -> str:
    """사업장명 정규화: strip + 연속공백 제거 + NFC 정규화"""
    if not name:
        return name
    return unicodedata.normalize('NFC', re.sub(r'\s+', ' ', name.strip()))


# ============================================
# 정규화된 사업장 관리 API (v2)
# 구조: 그룹 > 카테고리 > 슬롯 > 고객사
# ============================================

@router.get("/api/v2/hierarchy")
async def get_hierarchy(group_id: int = None):
    """전체 계층 구조 조회 (그룹 > 카테고리 > 슬롯 > 고객사)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    g.id as group_id,
                    g.group_name,
                    c.id as category_id,
                    c.category_name,
                    s.id as slot_id,
                    s.slot_name,
                    cl.id as client_id,
                    cl.client_name,
                    cl.is_active as client_active
                FROM site_groups g
                LEFT JOIN site_categories c ON c.group_id = g.id AND c.is_active = TRUE
                LEFT JOIN category_slots s ON s.category_id = c.id AND s.is_active = TRUE
                LEFT JOIN slot_clients cl ON cl.slot_id = s.id
                WHERE g.is_active = TRUE
            """
            params = []

            if group_id:
                query += " AND g.id = %s"
                params.append(group_id)

            query += """
                ORDER BY g.display_order, c.display_order,
                    CASE s.meal_type
                        WHEN '조식' THEN 1
                        WHEN '중식' THEN 2
                        WHEN '석식' THEN 3
                        WHEN '야식' THEN 4
                        WHEN '행사' THEN 5
                        ELSE 6
                    END,
                    s.display_order, cl.display_order
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            # 계층 구조로 변환
            hierarchy = {}
            for row in rows:
                gid, gname, cid, cname, sid, sname, clid, clname, clactive = row

                if gid not in hierarchy:
                    hierarchy[gid] = {"id": gid, "name": gname, "categories": {}}

                if cid and cid not in hierarchy[gid]["categories"]:
                    hierarchy[gid]["categories"][cid] = {"id": cid, "name": cname, "slots": {}}

                if cid and sid and sid not in hierarchy[gid]["categories"][cid]["slots"]:
                    hierarchy[gid]["categories"][cid]["slots"][sid] = {"id": sid, "name": sname, "clients": []}

                if cid and sid and clid:
                    hierarchy[gid]["categories"][cid]["slots"][sid]["clients"].append({
                        "id": clid, "name": clname, "is_active": clactive
                    })

            # dict를 list로 변환
            result = []
            for g in hierarchy.values():
                group_data = {"id": g["id"], "name": g["name"], "categories": []}
                for c in g["categories"].values():
                    cat_data = {"id": c["id"], "name": c["name"], "slots": []}
                    for s in c["slots"].values():
                        cat_data["slots"].append(s)
                    group_data["categories"].append(cat_data)
                result.append(group_data)

            return {"success": True, "data": result}
    except Exception as e:
        print(f"[API] 계층 구조 조회 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.get("/api/v2/slots")
async def get_slots_v2(category_id: int = None, group_id: int = None, include_inactive: bool = False):
    """슬롯 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    s.id, s.slot_code, s.slot_name, s.target_cost, s.selling_price,
                    s.display_order, s.is_active, s.category_id,
                    c.category_name, c.group_id, s.meal_type
                FROM category_slots s
                JOIN site_categories c ON c.id = s.category_id
                WHERE 1=1
            """
            if not include_inactive:
                query += " AND s.is_active = TRUE"
            params = []

            if category_id:
                query += " AND s.category_id = %s"
                params.append(category_id)

            if group_id:
                query += " AND c.group_id = %s"
                params.append(group_id)

            query += """
                ORDER BY c.display_order,
                    CASE COALESCE(s.meal_type, '중식')
                        WHEN '조식' THEN 1
                        WHEN '중식' THEN 2
                        WHEN '석식' THEN 3
                        WHEN '야식' THEN 4
                        ELSE 5
                    END,
                    s.display_order
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            slots = [{
                "id": r[0], "slot_code": r[1], "slot_name": r[2],
                "target_cost": r[3], "selling_price": r[4],
                "display_order": r[5], "is_active": r[6],
                "category_id": r[7], "category_name": r[8], "group_id": r[9],
                "meal_type": r[10] or '중식'
            } for r in rows]

            return {"success": True, "data": slots}
    except Exception as e:
        print(f"[API] 슬롯 조회 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.post("/api/v2/slots")
async def create_slot(request: Request):
    """슬롯 생성"""
    try:
        data = await request.json()
        category_id = data.get('category_id')
        slot_name = data.get('slot_name', '').strip()
        slot_code = data.get('slot_code', '')
        target_cost = data.get('target_cost', 0)
        selling_price = data.get('selling_price', 0)
        meal_type = data.get('meal_type', '').strip()
        modified_by = data.get('modified_by', '').strip()

        if not category_id or not slot_name:
            return {"success": False, "error": "카테고리와 슬롯명은 필수입니다"}

        valid_meal_types = ['조식', '중식', '석식', '야식']
        if not meal_type or meal_type not in valid_meal_types:
            return {"success": False, "error": f"끼니 타입은 필수입니다 ({', '.join(valid_meal_types)} 중 선택)"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 슬롯 코드 자동 생성 (중복 방지: MAX ID + timestamp)
            if not slot_code:
                cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM category_slots")
                next_id = cursor.fetchone()[0]
                slot_code = f"SLOT_{category_id}_{next_id}_{int(time.time()) % 10000}"

            cursor.execute("""
                INSERT INTO category_slots (category_id, slot_code, slot_name, target_cost, selling_price, meal_type, modified_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (category_id, slot_code, slot_name, target_cost, selling_price, meal_type, modified_by or None))

            slot_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {"success": True, "id": slot_id, "message": "슬롯 생성 완료"}
    except Exception as e:
        print(f"[API] 슬롯 생성 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.put("/api/v2/slots/{slot_id}")
async def update_slot(slot_id: int, request: Request):
    """슬롯 수정 (slot_name 변경 시 meal_slot_settings도 동기화)"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # slot_name 변경 시 기존 값 조회 (동기화용)
            old_slot_name = None
            category_id = None
            if 'slot_name' in data:
                cursor.execute("SELECT slot_name, category_id FROM category_slots WHERE id = %s", (slot_id,))
                result = cursor.fetchone()
                if result:
                    old_slot_name, category_id = result

            updates = []
            params = []

            if 'slot_name' in data:
                updates.append("slot_name = %s")
                params.append(data['slot_name'])
            if 'target_cost' in data:
                updates.append("target_cost = %s")
                params.append(data['target_cost'])
            if 'selling_price' in data:
                updates.append("selling_price = %s")
                params.append(data['selling_price'])
            if 'is_active' in data:
                updates.append("is_active = %s")
                params.append(data['is_active'])
            if 'display_order' in data:
                updates.append("display_order = %s")
                params.append(data['display_order'])
            if 'meal_type' in data:
                meal_type = data['meal_type']
                valid_meal_types = ['조식', '중식', '석식', '야식']
                if meal_type and meal_type in valid_meal_types:
                    updates.append("meal_type = %s")
                    params.append(meal_type)
            if 'modified_by' in data and data['modified_by']:
                updates.append("modified_by = %s")
                params.append(data['modified_by'])

            if updates:
                updates.append("updated_at = NOW()")
                params.append(slot_id)
                cursor.execute(f"UPDATE category_slots SET {', '.join(updates)} WHERE id = %s", params)

                # slot_name 변경 시 연관 데이터 동기화
                if 'slot_name' in data and old_slot_name and old_slot_name != data['slot_name']:
                    new_slot_name = data['slot_name']

                    # 1. meal_slot_settings 동기화
                    cursor.execute("""
                        UPDATE meal_slot_settings
                        SET slot_key = %s, updated_at = NOW()
                        WHERE slot_key = %s AND entity_type = 'category' AND entity_id = %s
                    """, (new_slot_name, old_slot_name, category_id))
                    synced_settings = cursor.rowcount
                    if synced_settings > 0:
                        print(f"[API] meal_slot_settings 동기화: '{old_slot_name}' → '{new_slot_name}' ({synced_settings}건)")

                    # 2. meal_counts.menu_name 동기화 (slot_id 우선, 문자열 fallback)
                    # slot_id 기준 업데이트 (안정적)
                    cursor.execute("""
                        UPDATE meal_counts
                        SET menu_name = %s
                        WHERE slot_id = %s AND menu_name != %s
                    """, (new_slot_name, slot_id, new_slot_name))
                    synced_by_id = cursor.rowcount
                    if synced_by_id > 0:
                        print(f"[API] meal_counts 동기화(slot_id): '{old_slot_name}' → '{new_slot_name}' ({synced_by_id}건)")

                    # 문자열 기반 fallback (slot_id가 NULL인 레거시 데이터)
                    cursor.execute("""
                        SELECT sc.category_name FROM site_categories sc
                        WHERE sc.id = %s
                    """, (category_id,))
                    cat_result = cursor.fetchone()
                    if cat_result:
                        category_name = cat_result[0]
                        cursor.execute("""
                            UPDATE meal_counts
                            SET menu_name = %s, slot_id = %s
                            WHERE menu_name = %s AND slot_id IS NULL
                              AND (category = %s OR business_type = %s)
                        """, (new_slot_name, slot_id, old_slot_name, category_name, category_name))
                        synced_legacy = cursor.rowcount
                        if synced_legacy > 0:
                            print(f"[API] meal_counts 동기화(legacy): '{old_slot_name}' → '{new_slot_name}' ({synced_legacy}건)")

                # meal_type 변경 시 meal_counts 동기화
                if 'meal_type' in data and data.get('meal_type'):
                    new_meal_type = data['meal_type']
                    cursor.execute("""
                        UPDATE meal_counts
                        SET meal_type = %s
                        WHERE slot_id = %s AND meal_type != %s
                    """, (new_meal_type, slot_id, new_meal_type))
                    synced_meal_type = cursor.rowcount
                    if synced_meal_type > 0:
                        print(f"[API] meal_counts meal_type 동기화: slot_id={slot_id} → '{new_meal_type}' ({synced_meal_type}건)")

                conn.commit()

            cursor.close()

            return {"success": True, "message": "슬롯 수정 완료"}
    except Exception as e:
        print(f"[API] 슬롯 수정 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.delete("/api/v2/slots/{slot_id}")
async def delete_slot(slot_id: int, permanent: bool = False):
    """슬롯 비활성화 (기본) 또는 영구 삭제 (permanent=true)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 먼저 슬롯 정보 조회 (slot_name, category_id)
            cursor.execute("""
                SELECT slot_name, category_id, is_active FROM category_slots WHERE id = %s
            """, (slot_id,))
            slot_info = cursor.fetchone()

            if not slot_info:
                cursor.close()
                return {"success": False, "error": "슬롯을 찾을 수 없습니다"}

            slot_name, category_id, is_active = slot_info

            # 비활성화 모드 (기본)
            if not permanent:
                cursor.execute("""
                    UPDATE category_slots SET is_active = FALSE, updated_at = NOW() WHERE id = %s
                """, (slot_id,))
                cursor.execute("""
                    UPDATE slot_clients SET is_active = FALSE, updated_at = NOW() WHERE slot_id = %s
                """, (slot_id,))
                conn.commit()
                cursor.close()
                return {"success": True, "message": f"'{slot_name}' 끼니구분이 비활성화되었습니다. (복원 가능)"}

            # 영구 삭제 모드
            # 1. slot_clients에서 연결된 사업장 먼저 삭제
            cursor.execute("DELETE FROM slot_clients WHERE slot_id = %s", (slot_id,))
            clients_deleted = cursor.rowcount

            # 2. category_slots에서 삭제
            cursor.execute("DELETE FROM category_slots WHERE id = %s", (slot_id,))

            # 3. meal_slot_settings에서도 삭제 (동기화)
            # slot_key = slot_name, entity_type = 'category', entity_id = category_id
            cursor.execute("""
                DELETE FROM meal_slot_settings
                WHERE slot_key = %s AND entity_type = 'category' AND entity_id = %s
            """, (slot_name, category_id))
            mss_deleted = cursor.rowcount

            conn.commit()
            cursor.close()

            msg = f"슬롯 '{slot_name}' 삭제 완료"
            if clients_deleted > 0:
                msg += f" (연결된 사업장 {clients_deleted}개 함께 삭제)"
            if mss_deleted > 0:
                msg += f" (운영관리 설정도 함께 삭제)"
            print(f"[API] {msg}")

            return {"success": True, "message": msg}
    except Exception as e:
        print(f"[API] 슬롯 삭제 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.get("/api/v2/clients")
async def get_clients_v2(slot_id: int = None, category_id: int = None, group_id: int = None, include_inactive: bool = False):
    """고객사 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    cl.id, cl.client_code, cl.client_name, cl.display_order, cl.is_active,
                    cl.slot_id, s.slot_name,
                    c.id as category_id, c.category_name,
                    c.group_id, cl.start_date, cl.end_date, cl.operating_days,
                    cl.operating_schedule, cl.special_dates,
                    s.meal_type
                FROM slot_clients cl
                JOIN category_slots s ON s.id = cl.slot_id
                JOIN site_categories c ON c.id = s.category_id
                WHERE 1=1
            """
            params = []

            if not include_inactive:
                query += " AND cl.is_active = TRUE"

            if slot_id:
                query += " AND cl.slot_id = %s"
                params.append(slot_id)

            if category_id:
                query += " AND c.id = %s"
                params.append(category_id)

            if group_id:
                query += " AND c.group_id = %s"
                params.append(group_id)

            query += """
                ORDER BY c.display_order,
                    CASE COALESCE(s.meal_type, '중식')
                        WHEN '조식' THEN 1
                        WHEN '중식' THEN 2
                        WHEN '석식' THEN 3
                        WHEN '야식' THEN 4
                        ELSE 5
                    END,
                    s.display_order, cl.display_order
            """

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            default_operating_days = '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}'
            clients = [{
                "id": r[0], "client_code": r[1], "client_name": r[2],
                "display_order": r[3], "is_active": r[4],
                "slot_id": r[5], "slot_name": r[6],
                "category_id": r[7], "category_name": r[8],
                "group_id": r[9],
                "start_date": str(r[10]) if r[10] else None,
                "end_date": str(r[11]) if r[11] else None,
                "operating_days": json.loads(r[12]) if r[12] else json.loads(default_operating_days),
                "operating_schedule": json.loads(r[13]) if r[13] else None,
                "special_dates": json.loads(r[14]) if r[14] else [],
                "meal_type": r[15] or '중식'
            } for r in rows]

            return {"success": True, "data": clients}
    except Exception as e:
        print(f"[API] 고객사 조회 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.post("/api/v2/clients")
async def create_client(request: Request):
    """고객사 생성 - 슬롯 자동 생성 지원 (원스탑)

    slot_id가 있으면 기존 방식으로 동작
    slot_id가 없고 slot_name + category_id가 있으면 슬롯 자동 생성 후 고객사 연결
    """
    try:
        data = await request.json()
        slot_id = data.get('slot_id')
        slot_name = data.get('slot_name', '').strip()
        category_id = data.get('category_id')
        client_name = normalize_client_name(data.get('client_name', ''))
        client_code = data.get('client_code', '')
        business_location_id = data.get('business_location_id')
        start_date = data.get('start_date')  # YYYY-MM-DD 형식
        end_date = data.get('end_date')  # YYYY-MM-DD 형식
        display_order = data.get('display_order', 0)
        operating_days = data.get('operating_days')  # 요일별 운영 설정 (JSON)
        if operating_days and isinstance(operating_days, dict):
            has_any_day = any(operating_days.get(day, False) for day in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
            if not has_any_day:
                return {"success": False, "error": "운영 요일을 최소 하나 이상 선택해주세요"}
            operating_days = json.dumps(operating_days)
        elif not operating_days:
            return {"success": False, "error": "운영 요일은 필수입니다"}

        # 끼니별 요일 스케줄 (operating_schedule)
        operating_schedule = data.get('operating_schedule')
        if operating_schedule and isinstance(operating_schedule, dict):
            operating_schedule = json.dumps(operating_schedule)

        # 특별 운영일 (special_dates)
        special_dates = data.get('special_dates')
        if special_dates and isinstance(special_dates, list):
            special_dates = json.dumps(special_dates)
        elif not special_dates:
            special_dates = '[]'

        if not client_name:
            return {"success": False, "error": "고객사명은 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            slot_created = False

            # ★ category_id가 없으면 기본 카테고리 자동 생성
            if not category_id and slot_name:
                req_group_id = data.get('group_id')
                req_group_name = data.get('group_name', '기본')

                if req_group_id:
                    # 해당 그룹의 기본 카테고리 찾기
                    cursor.execute("SELECT id FROM site_categories WHERE group_id = %s AND is_active = TRUE ORDER BY id LIMIT 1", (req_group_id,))
                else:
                    cursor.execute("SELECT id FROM site_categories WHERE is_active = TRUE ORDER BY id LIMIT 1")

                existing_cat = cursor.fetchone()
                if existing_cat:
                    category_id = existing_cat[0]
                else:
                    # 그룹 정보 결정 (없으면 자동 생성)
                    if req_group_id:
                        cursor.execute("SELECT id, group_name FROM site_groups WHERE id = %s", (req_group_id,))
                        group_row = cursor.fetchone()
                        if group_row:
                            group_id = group_row[0]
                            group_name = group_row[1]
                        else:
                            # 그룹이 없으면 자동 생성
                            cursor.execute("""
                                INSERT INTO site_groups (group_name, group_code, display_order, is_active)
                                VALUES (%s, 'DEFAULT', 0, TRUE)
                                RETURNING id
                            """, (req_group_name,))
                            group_id = cursor.fetchone()[0]
                            group_name = req_group_name
                            conn.commit()
                            print(f"[원스탑] 기본 그룹 자동 생성: {group_name} (ID: {group_id})")
                    else:
                        cursor.execute("SELECT id, group_name FROM site_groups WHERE is_active = TRUE ORDER BY id LIMIT 1")
                        group_row = cursor.fetchone()
                        if group_row:
                            group_id = group_row[0]
                            group_name = group_row[1]
                        else:
                            # 그룹이 아예 없으면 생성
                            cursor.execute("""
                                INSERT INTO site_groups (group_name, group_code, display_order, is_active)
                                VALUES ('본사', 'DEFAULT', 0, TRUE)
                                RETURNING id
                            """)
                            group_id = cursor.fetchone()[0]
                            group_name = '본사'
                            conn.commit()
                            print(f"[원스탑] 기본 그룹 자동 생성: {group_name} (ID: {group_id})")

                    cursor.execute("""
                        INSERT INTO site_categories (group_id, category_code, category_name, display_order)
                        VALUES (%s, 'DEFAULT', %s, 0)
                        RETURNING id
                    """, (group_id, group_name))
                    category_id = cursor.fetchone()[0]
                    conn.commit()
                    print(f"[원스탑] 기본 카테고리 자동 생성: {group_name} (ID: {category_id})")

            # 슬롯 자동 생성 로직
            meal_type = data.get('meal_type', '').strip()
            valid_meal_types = ['조식', '중식', '석식', '야식']

            if not slot_id and slot_name and category_id:
                # 1. 기존 슬롯 확인
                cursor.execute("""
                    SELECT id FROM category_slots
                    WHERE category_id = %s AND slot_name = %s AND is_active = TRUE
                """, (category_id, slot_name))
                existing_slot = cursor.fetchone()

                if existing_slot:
                    slot_id = existing_slot[0]
                    if meal_type and meal_type in valid_meal_types:
                        cursor.execute("""
                            UPDATE category_slots SET meal_type = %s, updated_at = NOW()
                            WHERE id = %s
                        """, (meal_type, slot_id))
                        print(f"[원스탑] 기존 슬롯 사용 + meal_type 업데이트: {slot_name} (ID: {slot_id}, meal_type: {meal_type})")
                    else:
                        print(f"[원스탑] 기존 슬롯 사용: {slot_name} (ID: {slot_id})")
                else:
                    if not meal_type or meal_type not in valid_meal_types:
                        cursor.close()
                        return {"success": False, "error": f"새 슬롯 생성 시 끼니 타입은 필수입니다 ({', '.join(valid_meal_types)} 중 선택)"}

                    # 2. 슬롯 자동 생성 (중복 방지: MAX ID + timestamp)
                    cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM category_slots")
                    next_id = cursor.fetchone()[0]
                    auto_slot_code = f"SLOT_{category_id}_{next_id}_{int(time.time()) % 10000}"

                    cursor.execute("""
                        INSERT INTO category_slots (category_id, slot_code, slot_name, meal_type, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, TRUE, NOW(), NOW())
                        ON CONFLICT DO NOTHING
                        RETURNING id
                    """, (category_id, auto_slot_code, slot_name, meal_type))
                    row = cursor.fetchone()
                    if row:
                        slot_id = row[0]
                        slot_created = True
                        print(f"[원스탑] 슬롯 자동 생성: {slot_name} (meal_type: {meal_type}, ID: {slot_id})")
                    else:
                        # ON CONFLICT 발생 시 기존 슬롯 재조회
                        cursor.execute("""
                            SELECT id FROM category_slots
                            WHERE category_id = %s AND slot_name = %s AND is_active = TRUE
                        """, (category_id, slot_name))
                        existing = cursor.fetchone()
                        if existing:
                            slot_id = existing[0]
                            print(f"[원스탑] 기존 슬롯 재사용 (CONFLICT): {slot_name} (ID: {slot_id})")
                        else:
                            cursor.close()
                            return {"success": False, "error": f"슬롯 '{slot_name}' 생성에 실패했습니다."}

            if not slot_id:
                cursor.close()
                return {"success": False, "error": "슬롯 정보가 필요합니다 (slot_id 또는 slot_name + category_id)"}

            # C-2: 중복 체크 (같은 슬롯 내 동일 사업장명 활성 상태)
            cursor.execute("""
                SELECT id FROM slot_clients
                WHERE slot_id = %s AND client_name = %s AND is_active = TRUE
            """, (slot_id, client_name))
            if cursor.fetchone():
                cursor.close()
                return {"success": False, "error": f"'{client_name}'은(는) 이미 해당 슬롯에 등록된 사업장입니다."}

            # 고객사 코드 자동 생성 (타임스탬프 기반 - 중복 방지)
            if not client_code:
                client_code = f"C_{slot_id}_{uuid.uuid4().hex[:8]}"

            # 수정자 추적
            modified_by_user = data.get('modified_by', '').strip() or None

            cursor.execute("""
                INSERT INTO slot_clients (slot_id, client_code, client_name, business_location_id, start_date, end_date, display_order, is_active, operating_days, operating_schedule, special_dates, modified_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s, %s)
                RETURNING id
            """, (slot_id, client_code, client_name, business_location_id, start_date, end_date, display_order, operating_days, operating_schedule, special_dates, modified_by_user))

            client_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            message = f"고객사 '{client_name}' 생성 완료"
            if slot_created:
                message = f"슬롯 '{slot_name}' + 고객사 '{client_name}' 자동 생성 완료"

            return {
                "success": True,
                "id": client_id,
                "slot_id": slot_id,
                "slot_created": slot_created,
                "slot_name": slot_name,
                "message": message
            }
    except Exception as e:
        print(f"[API] 고객사 생성 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.put("/api/v2/clients/{client_id}")
async def update_client(client_id: int, request: Request):
    """고객사 수정 + meal_counts 자동 동기화"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 수정 전 기존 정보 조회 (meal_counts 동기화용)
            cursor.execute("""
                SELECT cs.slot_name, scl.client_name, scl.end_date, scl.is_active
                FROM slot_clients scl
                JOIN category_slots cs ON scl.slot_id = cs.id
                WHERE scl.id = %s
            """, (client_id,))
            old_row = cursor.fetchone()
            old_slot_name = old_row[0] if old_row else None
            old_client_name = old_row[1] if old_row else None
            old_end_date = old_row[2] if old_row else None
            old_is_active = old_row[3] if old_row else True

            updates = []
            params = []
            meal_counts_updated = 0
            meal_counts_deleted = 0

            if 'client_name' in data:
                new_client_name = normalize_client_name(data['client_name'])
                # M-4: 이름변경 시 같은 슬롯 내 중복 체크
                if new_client_name != old_client_name:
                    cursor.execute("""
                        SELECT id FROM slot_clients
                        WHERE slot_id = (SELECT slot_id FROM slot_clients WHERE id = %s)
                          AND client_name = %s AND is_active = TRUE AND id != %s
                    """, (client_id, new_client_name, client_id))
                    if cursor.fetchone():
                        cursor.close()
                        return {"success": False, "error": f"'{new_client_name}'은(는) 이미 해당 슬롯에 등록된 사업장입니다."}
                updates.append("client_name = %s")
                params.append(new_client_name)
                data['client_name'] = new_client_name  # 정규화된 이름으로 업데이트
            if 'is_active' in data:
                updates.append("is_active = %s")
                params.append(data['is_active'])
            if 'display_order' in data:
                updates.append("display_order = %s")
                params.append(data['display_order'])
            if 'slot_id' in data:
                updates.append("slot_id = %s")
                params.append(data['slot_id'])
            if 'start_date' in data:
                updates.append("start_date = %s")
                params.append(data['start_date'] if data['start_date'] else None)
            if 'end_date' in data:
                updates.append("end_date = %s")
                params.append(data['end_date'] if data['end_date'] else None)
            if 'operating_days' in data:
                updates.append("operating_days = %s")
                operating_days = data['operating_days']
                if isinstance(operating_days, dict):
                    operating_days = json.dumps(operating_days)
                params.append(operating_days)

            # 끼니별 요일 스케줄 업데이트
            if 'operating_schedule' in data:
                updates.append("operating_schedule = %s")
                operating_schedule = data['operating_schedule']
                if isinstance(operating_schedule, dict):
                    operating_schedule = json.dumps(operating_schedule)
                params.append(operating_schedule)

            # 특별 운영일 업데이트
            if 'special_dates' in data:
                updates.append("special_dates = %s")
                special_dates = data['special_dates']
                if isinstance(special_dates, list):
                    special_dates = json.dumps(special_dates)
                params.append(special_dates)

            # 수정자 추적
            if 'modified_by' in data and data['modified_by']:
                updates.append("modified_by = %s")
                params.append(data['modified_by'])

            if updates:
                updates.append("updated_at = NOW()")
                params.append(client_id)
                sql = f"UPDATE slot_clients SET {', '.join(updates)} WHERE id = %s"
                cursor.execute(sql, params)

            # meal_counts 동기화 처리
            today = date.today()

            # 1. client_name 변경 시 -> meal_counts.site_name도 업데이트 (H-6: 과거 데이터 포함)
            if 'client_name' in data and old_client_name and data['client_name'] != old_client_name:
                cursor.execute("""
                    UPDATE meal_counts
                    SET site_name = %s
                    WHERE menu_name = %s AND site_name = %s
                """, (data['client_name'], old_slot_name, old_client_name))
                meal_counts_updated = cursor.rowcount
                if meal_counts_updated > 0:
                    print(f"[API] 고객사명 변경 → meal_counts {meal_counts_updated}건 동기화 (전체): {old_client_name} → {data['client_name']}")

            # 2. end_date 설정 시 -> end_date 다음날 이후 meal_counts 삭제
            if 'end_date' in data and data['end_date']:
                new_end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date() if isinstance(data['end_date'], str) else data['end_date']
                delete_from_date = new_end_date + timedelta(days=1)
                current_client_name = data.get('client_name', old_client_name)
                cursor.execute("""
                    DELETE FROM meal_counts
                    WHERE menu_name = %s AND site_name = %s AND work_date >= %s
                """, (old_slot_name, current_client_name, delete_from_date))
                meal_counts_deleted += cursor.rowcount
                if cursor.rowcount > 0:
                    print(f"[API] end_date 설정 → meal_counts {cursor.rowcount}건 삭제: {old_slot_name} > {current_client_name} ({delete_from_date}~)")

            # 3. is_active=false 설정 시 -> 오늘 이후 meal_counts 삭제
            if 'is_active' in data and data['is_active'] == False and old_is_active == True:
                current_client_name = data.get('client_name', old_client_name)
                # M-5: 삭제 전 감사 로그 (과거/미래 건수)
                cursor.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE work_date < %s) as past_count,
                        COUNT(*) FILTER (WHERE work_date >= %s) as future_count
                    FROM meal_counts
                    WHERE menu_name = %s AND site_name = %s
                """, (today, today, old_slot_name, current_client_name))
                audit_row = cursor.fetchone()
                past_count = audit_row[0] if audit_row else 0
                future_count = audit_row[1] if audit_row else 0
                print(f"[감사] 비활성화 전 meal_counts: {old_slot_name} > {current_client_name} (과거={past_count}건, 미래={future_count}건)")

                cursor.execute("""
                    DELETE FROM meal_counts
                    WHERE menu_name = %s AND site_name = %s AND work_date >= %s
                """, (old_slot_name, current_client_name, today))
                meal_counts_deleted += cursor.rowcount
                if cursor.rowcount > 0:
                    print(f"[API] 비활성화 → meal_counts {cursor.rowcount}건 삭제: {old_slot_name} > {current_client_name} (과거 {past_count}건 보존)")

            conn.commit()
            cursor.close()

            msg = "고객사 수정 완료"
            if meal_counts_updated > 0:
                msg += f" (meal_counts {meal_counts_updated}건 동기화)"
            if meal_counts_deleted > 0:
                msg += f" (meal_counts {meal_counts_deleted}건 정리)"

            return {"success": True, "message": msg}
    except Exception as e:
        print(f"[API] 고객사 수정 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.delete("/api/v2/clients/{client_id}")
async def delete_client(client_id: int):
    """고객사 삭제 + 관련 meal_counts 자동 정리"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 삭제 전 slot_name, client_name 조회 (meal_counts 정리용)
            cursor.execute("""
                SELECT cs.slot_name, scl.client_name
                FROM slot_clients scl
                JOIN category_slots cs ON scl.slot_id = cs.id
                WHERE scl.id = %s
            """, (client_id,))
            row = cursor.fetchone()

            deleted_meal_counts = 0
            if row:
                slot_name, client_name = row
                today = date.today()

                # H-7: 삭제 전 감사 로그 (과거/미래 건수)
                cursor.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE work_date < %s) as past_count,
                        COUNT(*) FILTER (WHERE work_date >= %s) as future_count
                    FROM meal_counts
                    WHERE menu_name = %s AND site_name = %s
                """, (today, today, slot_name, client_name))
                audit_row = cursor.fetchone()
                past_count = audit_row[0] if audit_row else 0
                future_count = audit_row[1] if audit_row else 0
                print(f"[감사] 삭제 전 meal_counts: {slot_name} > {client_name} (과거={past_count}건, 미래={future_count}건)")

                # 해당 slot_name + site_name 조합의 미래 meal_counts 삭제 (과거 데이터 보존)
                cursor.execute("""
                    DELETE FROM meal_counts
                    WHERE menu_name = %s AND site_name = %s AND work_date >= %s
                """, (slot_name, client_name, today))
                deleted_meal_counts = cursor.rowcount

                if deleted_meal_counts > 0:
                    print(f"[API] 고객사 삭제 시 meal_counts {deleted_meal_counts}건 정리: {slot_name} > {client_name} (과거 {past_count}건 보존)")

            cursor.execute("DELETE FROM slot_clients WHERE id = %s", (client_id,))
            conn.commit()
            cursor.close()

            return {"success": True, "message": f"고객사 삭제 완료 (meal_counts {deleted_meal_counts}건 정리)"}
    except Exception as e:
        print(f"[API] 고객사 삭제 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


@router.get("/api/v2/categories")
async def get_categories_v2(group_id: int = None):
    """카테고리 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    c.id, c.category_code, c.category_name, c.group_id,
                    c.display_order, c.is_active,
                    g.group_name
                FROM site_categories c
                JOIN site_groups g ON g.id = c.group_id
                WHERE c.is_active = TRUE
            """
            params = []

            if group_id:
                query += " AND c.group_id = %s"
                params.append(group_id)

            query += " ORDER BY c.display_order"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            categories = [{
                "id": r[0], "category_code": r[1], "category_name": r[2],
                "group_id": r[3], "display_order": r[4], "is_active": r[5],
                "group_name": r[6]
            } for r in rows]

            return {"success": True, "data": categories}
    except Exception as e:
        print(f"[API] 카테고리 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/v2/categories")
async def create_category(request: Request):
    """카테고리 생성"""
    try:
        data = await request.json()
        group_id = data.get('group_id')
        category_name = data.get('category_name', '').strip()
        category_code = data.get('category_code', '')
        display_order = data.get('display_order', 0)

        if not group_id or not category_name:
            return {"success": False, "error": "그룹과 카테고리명은 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 카테고리 코드 자동 생성
            if not category_code:
                cursor.execute("SELECT COUNT(*) FROM site_categories WHERE group_id = %s", (group_id,))
                count = cursor.fetchone()[0]
                category_code = f"CAT_{group_id}_{count+1}"

            cursor.execute("""
                INSERT INTO site_categories (group_id, category_code, category_name, display_order)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (group_id, category_code, category_name, display_order))

            category_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {"success": True, "id": category_id, "message": "카테고리 생성 완료"}
    except Exception as e:
        print(f"[API] 카테고리 생성 오류: {e}")
        return {"success": False, "error": str(e)}
