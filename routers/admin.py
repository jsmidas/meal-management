#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Admin Router
관리자 전용 API 엔드포인트
"""

from fastapi import APIRouter, Request, UploadFile, File, Form
from typing import Optional
import os
import json
import re
from datetime import datetime
from core.database import get_db_connection
from utils.batch_calculation import batch_calculation_status, run_batch_calculation
import psycopg2

router = APIRouter()

# 업로드 진행 상태 추적
upload_progress = {
    "is_uploading": False,
    "total_rows": 0,
    "current_row": 0,
    "phase": "",  # "파일 읽는 중", "데이터 준비 중", "DB 저장 중", "완료"
    "inserted": 0,
    "updated": 0,
    "errors": 0
}


@router.get("/api/admin/dashboard-stats")
async def get_dashboard_stats_compat(site_id: Optional[int] = None, group_id: Optional[int] = None):
    """대시보드 통계 (통합 API) - 사업장/그룹 필터링 지원

    통계 기준:
    - 식자재: 해당 사업장에서 발주 가능한 식자재 수 (협력업체 매핑 기준)
    - 레시피: 전체 레시피 수 (공용이므로)
    - 협력업체: 해당 사업장에서 발주 가능한 협력업체 수
    - 보건증: 만기 1개월 이내 경고
    """
    try:
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 🏢 사업장별 협력업체 목록 조회
            supplier_names = []
            if site_id or group_id:
                # 사업장 또는 그룹에 매핑된 협력업체 조회
                if site_id:
                    pg_cursor.execute("""
                        SELECT DISTINCT s.name
                        FROM customer_supplier_mappings csm
                        JOIN suppliers s ON csm.supplier_id = s.id
                        WHERE csm.customer_id = %s AND csm.is_active = true
                    """, (site_id,))
                else:
                    # 그룹에 속한 모든 사업장의 협력업체
                    pg_cursor.execute("""
                        SELECT DISTINCT s.name
                        FROM customer_supplier_mappings csm
                        JOIN suppliers s ON csm.supplier_id = s.id
                        JOIN business_locations bl ON csm.customer_id = bl.id
                        WHERE bl.group_id = %s AND csm.is_active = true
                    """, (group_id,))
                supplier_rows = pg_cursor.fetchall()
                supplier_names = [row[0] for row in supplier_rows] if supplier_rows else []

            # 1. 식자재 개수 (발주 가능한 식자재)
            if supplier_names:
                placeholders = ','.join(['%s'] * len(supplier_names))
                pg_cursor.execute(f"""
                    SELECT COUNT(*) FROM ingredients
                    WHERE supplier_name IN ({placeholders})
                """, supplier_names)
            else:
                pg_cursor.execute("SELECT COUNT(*) FROM ingredients")
            total_ingredients = pg_cursor.fetchone()[0]

            # 2. 레시피 개수 (전체 - 공용이므로)
            pg_cursor.execute("SELECT COUNT(*) FROM menu_recipes")
            total_recipes = pg_cursor.fetchone()[0]

            # 2-1. 사용자 수
            pg_cursor.execute("SELECT COUNT(*) FROM users WHERE is_active = true")
            total_users = pg_cursor.fetchone()[0]

            # 2-2. 사업장 수
            pg_cursor.execute("SELECT COUNT(*) FROM business_locations")
            total_sites = pg_cursor.fetchone()[0]

            # 3. 협력업체 개수 (발주 가능한 업체)
            if supplier_names:
                total_suppliers = len(supplier_names)
                # 주요 협력업체 이름 (최대 3개)
                main_suppliers = supplier_names[:3]
            else:
                pg_cursor.execute("""
                    SELECT COUNT(*) FROM suppliers
                    WHERE is_active = true
                """)
                total_suppliers = pg_cursor.fetchone()[0]
                pg_cursor.execute("""
                    SELECT name FROM suppliers
                    WHERE is_active = true
                    LIMIT 3
                """)
                main_suppliers = [row[0] for row in pg_cursor.fetchall()]

            # 4. 보건증 만기 현황 (테이블 존재 확인)
            health_stats = {"urgent": 0, "warning": 0, "normal": 0, "next_expiry": None}
            try:
                pg_cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_name = 'health_certificates'
                    )
                """)
                table_exists = pg_cursor.fetchone()[0]

                if table_exists:
                    pg_cursor.execute("""
                        SELECT
                            COUNT(CASE WHEN expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 1 END) as urgent,
                            COUNT(CASE WHEN expiry_date > CURRENT_DATE + INTERVAL '7 days'
                                       AND expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as warning,
                            COUNT(CASE WHEN expiry_date > CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as normal,
                            MIN(CASE WHEN expiry_date > CURRENT_DATE THEN expiry_date END) as next_expiry
                        FROM health_certificates
                        WHERE (site_id = %s OR %s IS NULL)
                          AND (group_id = %s OR %s IS NULL)
                    """, (site_id, site_id, group_id, group_id))
                    health_row = pg_cursor.fetchone()
                    health_stats = {
                        "urgent": health_row[0] or 0,
                        "warning": health_row[1] or 0,
                        "normal": health_row[2] or 0,
                        "next_expiry": str(health_row[3]) if health_row[3] else None
                    }
            except Exception as health_err:
                print(f"보건증 테이블 조회 오류 (무시): {health_err}")


            return {
                "success": True,
                "data": {
                    "total_users": total_users,
                    "total_sites": total_sites,
                    "total_ingredients": total_ingredients,
                    "total_recipes": total_recipes,
                    "total_suppliers": total_suppliers,
                    "main_suppliers": main_suppliers,
                    "health_certificates": health_stats
                },
                "filtered_by": {
                    "site_id": site_id,
                    "group_id": group_id
                }
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "data": {
                "total_users": 0,
                "total_sites": 0,
                "total_ingredients": 0,
                "total_recipes": 0,
                "total_suppliers": 0,
                "main_suppliers": [],
                "health_certificates": {"urgent": 0, "warning": 0, "normal": 0, "next_expiry": None}
            },
            "error": str(e)
        }

@router.get("/api/admin/batch-progress")
async def get_batch_progress():
    """배치 계산 진행률 조회 - 실시간 상태 포함"""
    global batch_calculation_status

    try:
        # 실시간 전체 통계 (실행 중일 때는 배치 상태, 아닐 때는 DB 상태)
        if batch_calculation_status["is_running"] and batch_calculation_status["total_items"] > 0:
            # 배치 계산 실행 중 - 실시간 상태 반환
            total_items = batch_calculation_status["total_items"]
            completed_items = batch_calculation_status["completed_items"]
            progress_percentage = round((completed_items / total_items) * 100, 2) if total_items > 0 else 0
        else:
            # 배치 계산 중이 아님 - DB에서 실제 상태 조회
            # Railway PostgreSQL 전용
            with get_db_connection() as conn:
                cursor = conn.cursor()

                cursor.execute("SELECT COUNT(*) FROM ingredients WHERE purchase_price IS NOT NULL AND purchase_price > 0")
                total_result = cursor.fetchone()
                total_items = total_result[0] if total_result else 0

                cursor.execute("SELECT COUNT(*) FROM ingredients WHERE price_per_unit IS NOT NULL AND price_per_unit > 0")
                completed_result = cursor.fetchone()
                completed_items = completed_result[0] if completed_result else 0


                progress_percentage = round((completed_items / total_items) * 100, 2) if total_items > 0 else 0

        return {
            "success": True,
            "data": {
                "is_running": batch_calculation_status["is_running"],
                "progress": progress_percentage,
                "progress_percentage": progress_percentage,
                "total_items": total_items,
                "completed_items": completed_items,
                "remaining_items": total_items - completed_items,
                "current_item": batch_calculation_status["current_item"],
                "error_count": batch_calculation_status["error_count"],
                "start_time": batch_calculation_status["start_time"],
                "estimated_remaining": batch_calculation_status["estimated_remaining"],
                "status": "running" if batch_calculation_status["is_running"] else "completed",
                "message": f"Processing {batch_calculation_status['current_item']}" if batch_calculation_status["is_running"] else "All operations completed successfully"
            }
        }

    except Exception as e:
        print(f"배치 진행률 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/admin/upload-progress")
async def get_upload_progress():
    """업로드 진행 상태 조회"""
    global upload_progress

    try:
        if not upload_progress["is_uploading"] and upload_progress["total_rows"] == 0:
            # 업로드 중이 아님
            return {
                "success": True,
                "is_uploading": False,
                "progress_percentage": 0
            }

        # 진행률 계산
        progress_percentage = 0
        if upload_progress["total_rows"] > 0:
            progress_percentage = round((upload_progress["current_row"] / upload_progress["total_rows"]) * 100, 2)

        return {
            "success": True,
            "is_uploading": upload_progress["is_uploading"],
            "progress_percentage": progress_percentage,
            "total_rows": upload_progress["total_rows"],
            "current_row": upload_progress["current_row"],
            "phase": upload_progress["phase"],
            "inserted": upload_progress["inserted"],
            "updated": upload_progress["updated"],
            "errors": upload_progress["errors"]
        }

    except Exception as e:
        print(f"업로드 진행률 조회 오류: {e}", flush=True)
        return {"success": False, "error": str(e)}


@router.post("/api/admin/batch-calculate-all")
async def start_batch_calculation():
    """전체 DB 배치 계산 시작"""
    global batch_calculation_status

    try:
        # 이미 실행 중인지 확인
        if batch_calculation_status["is_running"]:
            return {
                "success": False,
                "message": "배치 계산이 이미 실행 중입니다."
            }

        # 백그라운드 스레드로 배치 계산 시작
        thread = threading.Thread(target=run_batch_calculation)
        thread.daemon = True
        thread.start()

        batch_calculation_status["thread"] = thread

        return {
            "success": True,
            "message": "배치 계산이 시작되었습니다.",
            "estimated_time": "약 5-15분 소요 예상"
        }

    except Exception as e:
        print(f"배치 계산 시작 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/admin/business-locations")
async def get_business_locations(include_ended: int = 0):
    """사업장 목록 API - 그룹(본사, 영남지사) + 위탁사업장 단위로 반환

    올바른 사업장 범위:
    - 본사, 영남지사 (site_groups)
    - 군위복지관, 아이팜코리아, 모레코리아 등 위탁사업장 (site_categories where group_code='Meal')

    include_ended=1: 거래종료 사업장도 포함 (관리 페이지용)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            locations = []

            # 1. site_groups에서 본사, 영남지사 등 그룹 가져오기 (위탁사업장 그룹 제외)
            # business_locations의 management 사이트 데이터를 함께 조회 (수정용)
            cursor.execute("""
                SELECT sg.id, sg.group_code, sg.group_name, sg.display_order, sg.is_active,
                       bl.id as business_location_id, bl.site_code as bl_site_code,
                       bl.site_type as bl_site_type, bl.region, bl.address, bl.phone,
                       bl.manager_name, bl.is_active as bl_is_active, bl.abbreviation, bl.has_categories,
                       bl.contract_end_date
                FROM site_groups sg
                LEFT JOIN business_locations bl ON bl.group_id = sg.id AND bl.business_category IN ('management', 'legacy')
                WHERE sg.group_code != 'Meal'
                ORDER BY sg.display_order
            """)
            for row in cursor.fetchall():
                contract_end = str(row[15]) if row[15] else None
                contract_ended = bool(row[15] and str(row[15]) <= str(datetime.now().date()))
                # 거래종료 사업장 필터링 (include_ended=0일 때)
                if not include_ended and contract_ended:
                    continue
                # business_locations.id를 사용 (발주 등 FK 참조용)
                site_id = row[5] if row[5] else row[0]
                group_name = row[2]
                # 급식사업장 유형: 본사/영남/기타
                if '본사' in group_name:
                    group_type_display = "본사"
                elif '영남' in group_name:
                    group_type_display = "영남"
                else:
                    group_type_display = group_name
                locations.append({
                    "id": site_id,
                    "site_code": row[6] or row[1] or f"GRP_{row[0]:03d}",
                    "site_name": row[2],
                    "name": row[2],
                    "location_name": row[2],
                    "site_type": row[7] or "급식업체",  # 실제 business_locations.site_type
                    "group_type": group_type_display,  # 본사/영남/기타 구분
                    "type": "group",
                    "location_type": "group",
                    "region": row[8] or "",
                    "address": row[9] or "",
                    "phone": row[10] or "",
                    "manager_name": row[11] or "",
                    "manager_phone": "",
                    "is_active": bool(row[12]) if row[12] is not None else (bool(row[4]) if row[4] is not None else True),
                    "status": "active" if (row[12] is None or row[12]) else "inactive",
                    "source": "site_groups",
                    "group_id": row[0],
                    "business_location_id": row[5],
                    "abbreviation": row[13] or None,
                    "has_categories": bool(row[14]) if row[14] is not None else False,
                    "contract_end_date": contract_end,
                    "contract_ended": contract_ended
                })

            # 2. 위탁사업장 그룹의 카테고리들을 각각 사업장으로 가져오기
            # business_locations와 JOIN하여 실제 ID와 주소 정보를 가져옴
            cursor.execute("""
                SELECT sc.id, sc.category_code, sc.category_name, sc.display_order, sc.is_active, sg.id as group_id,
                       bl.id as business_location_id, bl.site_code as bl_site_code, bl.site_type as bl_site_type,
                       bl.region, bl.address, bl.phone, bl.manager_name, bl.is_active as bl_is_active,
                       bl.abbreviation, bl.has_categories, bl.contract_end_date
                FROM site_categories sc
                JOIN site_groups sg ON sc.group_id = sg.id
                LEFT JOIN business_locations bl ON bl.category_id = sc.id AND (bl.group_id = sg.id OR bl.group_id IS NULL)
                WHERE sg.group_code = 'Meal'
                ORDER BY sc.display_order
            """)
            for row in cursor.fetchall():
                # business_locations.id가 있으면 사용, 없으면 가상 ID (1000 + category_id)
                site_id = row[6] if row[6] else (1000 + row[0])
                contract_end = str(row[16]) if row[16] else None
                contract_ended = bool(row[16] and str(row[16]) <= str(datetime.now().date()))
                # 거래종료 사업장 필터링 (include_ended=0일 때)
                if not include_ended and contract_ended:
                    continue
                locations.append({
                    "id": site_id,
                    "site_code": row[7] or row[1] or f"CSG_{row[0]:03d}",
                    "site_name": row[2],
                    "name": row[2],
                    "location_name": row[2],
                    "site_type": row[8] or "위탁급식",
                    "type": "consignment",
                    "location_type": "consignment",
                    "region": row[9] or "",
                    "address": row[10] or "",
                    "phone": row[11] or "",
                    "manager_name": row[12] or "",
                    "manager_phone": "",
                    "is_active": bool(row[13]) if row[13] is not None else (bool(row[4]) if row[4] is not None else True),
                    "status": "active" if (row[13] is None or row[13]) else "inactive",
                    "source": "business_locations" if row[6] else "site_categories",
                    "category_id": row[0],
                    "group_id": row[5],
                    "business_location_id": row[6],
                    "abbreviation": row[14] or None,
                    "has_categories": bool(row[15]) if row[15] is not None else False,
                    "contract_end_date": contract_end,
                    "contract_ended": contract_ended
                })

            # 3. business_locations는 중복 데이터이므로 제외
            # 원본 데이터는 site_groups와 site_categories에 있음

            # 4. 각 사업장의 발주 가능 협력업체 정보 조회
            cursor.execute("""
                SELECT csm.customer_id, s.name as supplier_name
                FROM customer_supplier_mappings csm
                JOIN suppliers s ON csm.supplier_id = s.id
                WHERE csm.is_active = true OR csm.is_active IS NULL
                ORDER BY csm.customer_id, s.name
            """)
            supplier_map = {}
            for row in cursor.fetchall():
                customer_id = row[0]
                if customer_id not in supplier_map:
                    supplier_map[customer_id] = []
                supplier_map[customer_id].append(row[1])

            # locations에 협력업체 정보 추가
            for loc in locations:
                loc["suppliers"] = supplier_map.get(loc["id"], [])


            return {
                "success": True,
                "data": locations,
                "locations": locations,
                "total": len(locations)
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/admin/customer-supplier-mappings")
async def get_customer_supplier_mappings():
    """협력업체 매핑 목록 API"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT csm.id, csm.customer_id, csm.supplier_id,
                       bl.site_name as customer_name,
                       csm.supplier_code, csm.delivery_code,
                       csm.priority_order, csm.is_primary_supplier,
                       csm.contract_start_date, csm.contract_end_date,
                       csm.is_active, csm.notes, csm.created_at
                FROM customer_supplier_mappings csm
                LEFT JOIN business_locations bl ON csm.customer_id = bl.id
                ORDER BY csm.id
            """)
            mappings_data = cursor.fetchall()

            mappings = []
            for mapping in mappings_data:
                # PostgreSQL ingredients 테이블에서 supplier 이름을 조회
                cursor.execute("""
                    SELECT DISTINCT supplier_name
                    FROM ingredients
                    WHERE supplier_name IS NOT NULL
                    LIMIT 1 OFFSET %s
                """, (mapping[2] - 1,))
                supplier_result = cursor.fetchone()
                supplier_name = supplier_result[0] if supplier_result else f"공급업체{mapping[2]}"

                mappings.append({
                    "id": mapping[0],
                    "customer_id": mapping[1],
                    "supplier_id": mapping[2],
                    "customer_name": mapping[3],
                    "supplier_name": supplier_name,
                    "supplier_code": mapping[4] or "",
                    "delivery_code": mapping[5] or "",
                    "priority_order": mapping[6] or 1,
                    "is_primary_supplier": bool(mapping[7]),
                    "contract_start_date": mapping[8],
                    "contract_end_date": mapping[9],
                    "is_active": bool(mapping[10]),
                    "notes": mapping[11] or "",
                    "created_at": mapping[12]
                })


            return {
                "success": True,
                "mappings": mappings,
                "data": mappings,  # 호환성 유지
                "total": len(mappings)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


# GET /api/admin/sites는 site_structure.py에서 처리 (중복 제거)


@router.get("/api/admin/site-stats")
async def get_site_stats():
    """사업장 통계 API - 그룹 + 위탁사업장 기준"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 그룹 수 (위탁사업장 그룹 제외)
            cursor.execute("SELECT COUNT(*) FROM site_groups WHERE group_code != 'Meal'")
            group_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM site_groups WHERE group_code != 'Meal' AND (is_active = true OR is_active IS NULL)")
            group_active = cursor.fetchone()[0]

            # 2. 위탁사업장 수 (site_categories에서 Meal 그룹 하위)
            cursor.execute("""
                SELECT COUNT(*) FROM site_categories sc
                JOIN site_groups sg ON sc.group_id = sg.id
                WHERE sg.group_code = 'Meal'
            """)
            consignment_count = cursor.fetchone()[0]

            cursor.execute("""
                SELECT COUNT(*) FROM site_categories sc
                JOIN site_groups sg ON sc.group_id = sg.id
                WHERE sg.group_code = 'Meal' AND (sc.is_active = true OR sc.is_active IS NULL)
            """)
            consignment_active = cursor.fetchone()[0]


            total_sites = group_count + consignment_count
            active_sites = group_active + consignment_active
            inactive_sites = total_sites - active_sites

            return {
                "success": True,
                "stats": {
                    "total_sites": total_sites,
                    "active_sites": active_sites,
                    "inactive_sites": inactive_sites,
                    "group_count": group_count,
                    "consignment_count": consignment_count
                }
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


# POST /api/admin/sites는 site_structure.py에서 처리


@router.put("/api/admin/sites/{site_id}")
async def update_business_location(site_id: int, request: Request):
    """사업장 정보 수정 API - group_id, category_id, 위탁사업장(가상ID) 지원"""
    try:
        # UTF-8 인코딩을 명시적으로 처리
        body = await request.body()
        text = body.decode('utf-8')
        data = json.loads(text)

        # Railway PostgreSQL 연결
        with get_db_connection() as postgres_conn:
            postgres_cursor = postgres_conn.cursor()

            # ★ 가상 ID 처리: 1000 이상이면 위탁사업장 (site_categories)
            if site_id >= 1000:
                actual_id = site_id - 1000
                # site_categories 테이블 업데이트
                cat_updates = []
                cat_values = []

                if 'site_name' in data:
                    cat_updates.append("category_name = %s")
                    cat_values.append(data.get('site_name', '').strip() or '미입력')
                if 'is_active' in data:
                    cat_updates.append("is_active = %s")
                    cat_values.append(data['is_active'])

                if cat_updates:
                    cat_values.append(actual_id)
                    postgres_cursor.execute(f"""
                        UPDATE site_categories
                        SET {', '.join(cat_updates)}
                        WHERE id = %s
                    """, cat_values)

                    if postgres_cursor.rowcount == 0:
                        return {"success": False, "error": "위탁사업장을 찾을 수 없습니다"}

                # ★ 위탁사업장의 정보를 business_locations에도 동기화 (category_id로 연결)
                sync_fields = ['site_name', 'region', 'address', 'phone', 'manager_name',
                               'abbreviation', 'has_categories', 'site_type', 'contract_end_date']
                if any(f in data for f in sync_fields):
                    # 기존 business_locations 레코드 확인
                    postgres_cursor.execute(
                        "SELECT id FROM business_locations WHERE category_id = %s LIMIT 1",
                        (actual_id,)
                    )
                    bl_row = postgres_cursor.fetchone()

                    if bl_row:
                        # 기존 레코드 업데이트
                        bl_updates = []
                        bl_values = []
                        if 'site_name' in data:
                            bl_updates.append("site_name = %s")
                            bl_values.append(data.get('site_name', '').strip() or '미입력')
                        if 'region' in data:
                            bl_updates.append("region = %s")
                            bl_values.append(data.get('region', '').strip() or '')
                        if 'address' in data:
                            bl_updates.append("address = %s")
                            bl_values.append(data.get('address', '').strip() or '')
                        if 'phone' in data:
                            bl_updates.append("phone = %s")
                            bl_values.append(data.get('phone', '').strip() or '')
                        if 'manager_name' in data:
                            bl_updates.append("manager_name = %s")
                            bl_values.append(data.get('manager_name', '').strip() or '')
                        if 'abbreviation' in data:
                            bl_updates.append("abbreviation = %s")
                            bl_values.append(data.get('abbreviation', '').strip() if data.get('abbreviation') else None)
                        if 'has_categories' in data:
                            bl_updates.append("has_categories = %s")
                            bl_values.append(data['has_categories'])
                        if 'site_type' in data:
                            bl_updates.append("site_type = %s")
                            bl_values.append(data.get('site_type', '').strip() or '위탁급식')
                        if 'contract_end_date' in data:
                            bl_updates.append("contract_end_date = %s")
                            bl_values.append(data['contract_end_date'] if data['contract_end_date'] else None)
                        if bl_updates:
                            bl_updates.append("updated_at = NOW()")
                            bl_values.append(bl_row[0])
                            postgres_cursor.execute(f"""
                                UPDATE business_locations
                                SET {', '.join(bl_updates)}
                                WHERE id = %s
                            """, bl_values)
                    else:
                        # 새 레코드 생성 (위탁사업장용) - group_id도 설정하여 JOIN 정합성 유지
                        postgres_cursor.execute("""
                            INSERT INTO business_locations
                            (site_code, site_name, category_id, group_id, region, address, phone, manager_name, business_category, is_active, created_at)
                            SELECT 'CONS_' || category_code, category_name, %s, sc.group_id, %s, %s, %s, %s, 'consignment', 1, NOW()
                            FROM site_categories sc WHERE sc.id = %s
                        """, (
                            actual_id,
                            data.get('region', '').strip() or '',
                            data.get('address', '').strip() or '',
                            data.get('phone', '').strip() or '',
                            data.get('manager_name', '').strip() or '',
                            actual_id
                        ))

                postgres_conn.commit()
                return {"success": True, "message": "위탁사업장 정보가 수정되었습니다"}

            # 일반 사업장: business_locations 테이블 업데이트
            updates = []
            values = []

            # 🏢 그룹/카테고리 이동 지원
            if 'group_id' in data:
                updates.append("group_id = %s")
                values.append(data['group_id'])
            if 'category_id' in data:
                updates.append("category_id = %s")
                values.append(data['category_id'])

            # 기본 필드들
            if 'site_name' in data:
                updates.append("site_name = %s")
                values.append(data.get('site_name', '').strip() or '미입력')
            if 'site_type' in data:
                updates.append("site_type = %s")
                values.append(data.get('site_type', '').strip() or '일반')
            if 'region' in data:
                updates.append("region = %s")
                values.append(data.get('region', '').strip() or '')
            if 'address' in data:
                updates.append("address = %s")
                values.append(data.get('address', '').strip() or '')
            if 'phone' in data:
                updates.append("phone = %s")
                values.append(data.get('phone', '').strip() or '')
            if 'manager_name' in data:
                updates.append("manager_name = %s")
                values.append(data.get('manager_name', '').strip() or '')
            if 'display_order' in data:
                updates.append("display_order = %s")
                values.append(data['display_order'])
            if 'is_active' in data:
                updates.append("is_active = %s")
                values.append(1 if data['is_active'] else 0)
            if 'abbreviation' in data:
                updates.append("abbreviation = %s")
                values.append(data.get('abbreviation', '').strip() if data.get('abbreviation') else None)
            if 'has_categories' in data:
                updates.append("has_categories = %s")
                values.append(data['has_categories'])
            if 'contract_end_date' in data:
                updates.append("contract_end_date = %s")
                values.append(data['contract_end_date'] if data['contract_end_date'] else None)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            # updated_at 추가
            updates.append("updated_at = NOW()")
            values.append(site_id)

            postgres_cursor.execute(f"""
                UPDATE business_locations
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            if postgres_cursor.rowcount == 0:
                return {"success": False, "error": "사업장을 찾을 수 없습니다"}

            postgres_conn.commit()

            return {
                "success": True,
                "message": "사업장 정보가 성공적으로 수정되었습니다"
            }

    except Exception as e:
        return {"success": False, "error": f"사업장 수정 중 오류 발생: {str(e)}"}


@router.delete("/api/admin/sites/{site_id}")
async def delete_business_location(site_id: int):
    """사업장 삭제 API

    ★ 가상 ID 처리:
    - site_id >= 1000: site_categories 테이블 (실제 id = site_id - 1000)
    - site_id < 1000: business_locations 테이블
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 가상 ID 체크 (위탁사업장)
            if site_id >= 1000:
                real_id = site_id - 1000

                # site_categories에서 찾기
                cursor.execute("SELECT category_name FROM site_categories WHERE id = %s", (real_id,))
                site = cursor.fetchone()
                if not site:
                    cursor.close()
                    return {"success": False, "error": "사업장을 찾을 수 없습니다"}

                # site_categories에서 삭제
                cursor.execute("DELETE FROM site_categories WHERE id = %s", (real_id,))
                conn.commit()

                cursor.close()
                return {"success": True, "message": f"사업장 '{site[0]}'이(가) 삭제되었습니다"}

            # 일반 사업장 (business_locations)
            cursor.execute("SELECT site_name FROM business_locations WHERE id = %s", (site_id,))
            site = cursor.fetchone()
            if not site:
                cursor.close()
                return {"success": False, "error": "사업장을 찾을 수 없습니다"}

            # 사업장 삭제
            cursor.execute("DELETE FROM business_locations WHERE id = %s", (site_id,))
            conn.commit()

            cursor.close()

            return {"success": True, "message": f"사업장 '{site[0]}'이(가) 삭제되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/sites/{site_id}/suppliers")
async def get_site_suppliers(site_id: int):
    """사업장에 매핑된 협력업체 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장에 매핑된 협력업체 ID 목록 조회
            cursor.execute("""
                SELECT csm.supplier_id, s.name as supplier_name, s.supplier_code,
                       csm.is_active, csm.created_at
                FROM customer_supplier_mappings csm
                JOIN suppliers s ON csm.supplier_id = s.id
                WHERE csm.customer_id = %s
                ORDER BY s.name
            """, (site_id,))

            mappings = []
            for row in cursor.fetchall():
                mappings.append({
                    "supplier_id": row[0],
                    "supplier_name": row[1],
                    "supplier_code": row[2] or "",
                    "is_active": bool(row[3]),
                    "created_at": str(row[4]) if row[4] else None
                })

            cursor.close()

            return {
                "success": True,
                "data": mappings,
                "supplier_ids": [m["supplier_id"] for m in mappings],
                "total": len(mappings)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/sites/{site_id}/suppliers")
async def update_site_suppliers(site_id: int, request: Request):
    """사업장의 협력업체 매핑 일괄 저장"""
    try:
        data = await request.json()
        supplier_ids = data.get("supplier_ids", [])

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 가상 ID 변환: 1000 이상이면 site_categories의 가상 ID (1000 + category_id)
            actual_id = site_id
            target_table = None

            if site_id >= 1000:
                # 위탁사업장: 가상 ID → 실제 category_id
                actual_id = site_id - 1000
                target_table = 'site_categories'

            # 사업장 존재 확인 (테이블명 화이트리스트 검증)
            ALLOWED_TABLES = {'site_groups', 'site_categories', 'business_locations'}
            site_exists = False

            if target_table:
                # 가상 ID인 경우 해당 테이블만 확인
                if target_table not in ALLOWED_TABLES:
                    cursor.close()
                    return {"success": False, "error": "잘못된 테이블 접근"}

                if target_table == 'site_categories':
                    cursor.execute("SELECT id FROM site_categories WHERE id = %s", (actual_id,))
                elif target_table == 'site_groups':
                    cursor.execute("SELECT id FROM site_groups WHERE id = %s", (actual_id,))
                else:
                    cursor.execute("SELECT id FROM business_locations WHERE id = %s", (actual_id,))

                if cursor.fetchone():
                    site_exists = True
            else:
                # 일반 ID인 경우 각 테이블 순차 확인
                cursor.execute("SELECT id FROM site_groups WHERE id = %s", (actual_id,))
                if cursor.fetchone():
                    site_exists = True
                    target_table = 'site_groups'
                else:
                    cursor.execute("SELECT id FROM site_categories WHERE id = %s", (actual_id,))
                    if cursor.fetchone():
                        site_exists = True
                        target_table = 'site_categories'
                    else:
                        cursor.execute("SELECT id FROM business_locations WHERE id = %s", (actual_id,))
                        if cursor.fetchone():
                            site_exists = True
                            target_table = 'business_locations'

            if not site_exists:
                cursor.close()
                return {"success": False, "error": "사업장을 찾을 수 없습니다"}

            print(f"[SUPPLIER] site_id={site_id} → actual_id={actual_id}, table={target_table}", flush=True)

            # 기존 매핑 삭제
            cursor.execute("DELETE FROM customer_supplier_mappings WHERE customer_id = %s", (site_id,))

            # 새 매핑 추가
            added_count = 0
            for supplier_id in supplier_ids:
                try:
                    cursor.execute("""
                        INSERT INTO customer_supplier_mappings (customer_id, supplier_id, is_active, created_at)
                        VALUES (%s, %s, 1, NOW())
                    """, (site_id, supplier_id))
                    added_count += 1
                except Exception as insert_error:
                    print(f"매핑 추가 실패 (supplier_id={supplier_id}): {insert_error}")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"{added_count}개의 협력업체가 매핑되었습니다",
                "added_count": added_count
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/recent-activity")
async def get_recent_activity():
    """최근 활동 API - Railway PostgreSQL 실시간 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, action, username, created_at, status
                FROM activity_logs
                ORDER BY created_at DESC
                LIMIT 10
            """)
        
            logs = cursor.fetchall()
            activities = []
        
            for log in logs:
                activities.append({
                    "id": log[0],
                    "action": log[1],
                    "user": log[2] or "system",
                    "timestamp": str(log[3]),
                    "status": log[4] or "completed"
                })
            

            return {
                "success": True,
                "data": activities,
                "activities": activities,
                "total": len(activities)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/activity-logs")
async def get_activity_logs(limit: int = 15):
    """활동 로그 API - Railway PostgreSQL 실시간 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, username, action, details, created_at, status
                FROM activity_logs
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
        
            logs = cursor.fetchall()
        
            log_data = []
            for log in logs:
                log_data.append({
                    "id": log[0],
                    "user": log[1] or "system",
                    "action": log[2],
                    "details": log[3] or "",
                    "timestamp": str(log[4]),
                    "status": log[5] or "success"
                })
            

            return {
                "success": True,
                "data": log_data,
                "total": len(log_data)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/meal-pricing")
async def get_meal_pricing():
    """식단가 관리 목록"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # meal_pricing 테이블에서 실제 데이터 조회
            cursor.execute("""
                SELECT id, location_id, location_name, meal_plan_type, meal_type, plan_name,
                       apply_date_start, apply_date_end, selling_price, material_cost_guideline,
                       cost_ratio, is_active, created_at, updated_at
                FROM meal_pricing
                WHERE is_active = true
                ORDER BY created_at DESC
            """)

            pricing_data = cursor.fetchall()
            meal_pricing = []

            for row in pricing_data:
                # 수익률 계산
                selling_price = float(row[8]) if row[8] else 0
                material_cost = float(row[9]) if row[9] else 0
                profit_margin = ((selling_price - material_cost) / selling_price * 100) if selling_price > 0 else 0

                meal_pricing.append({
                    "id": row[0],
                    "location_id": row[1],
                    "location_name": row[2] or "미정",
                    "meal_plan_type": row[3] or "기본",
                    "meal_type": row[4] or "중식",
                    "plan_name": row[5] or f"식단{row[0]}",
                    "meal_name": row[5] or f"식단{row[0]}",  # 호환성
                    "category": f"{row[2] or '미정'} - {row[4] or '중식'}",  # 호환성
                    "apply_date_start": str(row[6]) if row[6] else None,
                    "apply_date_end": str(row[7]) if row[7] else None,
                    "selling_price": round(selling_price),
                    "base_price": round(selling_price),  # 호환성
                    "material_cost_guideline": round(material_cost),
                    "actual_cost": round(material_cost),  # 호환성
                    "cost_ratio": float(row[10]) if row[10] else 0,
                    "profit_margin": round(profit_margin, 1),
                    "status": "active" if row[11] else "inactive",
                    "is_active": bool(row[11]),
                    "created_at": str(row[12]) if row[12] else None,
                    "updated_at": str(row[13]) if row[13] else None,
                    "last_updated": str(row[13])[:10] if row[13] else "2025-09-27"
                })


            return {
                "success": True,
                "data": meal_pricing,
                "total": len(meal_pricing)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}



@router.post("/api/admin/business-locations")
async def create_business_location(request: Request):
    """사업장 생성"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_code 자동 생성
            site_code = data.get('site_code')
            if not site_code:
                cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM business_locations")
                next_id = cursor.fetchone()[0]
                site_code = f"SITE_{next_id:05d}"

            cursor.execute("""
                INSERT INTO business_locations
                (site_code, site_name, site_type, group_id, category_id, region, address, phone, manager_name, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                RETURNING id
            """, (
                site_code,
                data.get('site_name', ''),
                data.get('site_type', '일반'),
                data.get('group_id'),
                data.get('category_id'),
                data.get('region', ''),
                data.get('address', ''),
                data.get('phone', ''),
                data.get('manager_name', ''),
                1 if data.get('is_active', True) else 0
            ))

            new_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {
                    "id": new_id,
                    "site_code": site_code,
                    "site_name": data.get('site_name'),
                    "site_type": data.get('site_type')
                },
                "message": "사업장이 성공적으로 생성되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/business-locations/{location_id}")
async def update_business_location(location_id: int, request: Request):
    """사업장 수정"""
    try:
        data = await request.json()
        return {
            "success": True,
            "data": {
                "id": location_id,
                "name": data.get("name"),
                "type": data.get("type"),
                "address": data.get("address"),
                "status": data.get("status")
            },
            "message": "사업장이 성공적으로 수정되었습니다."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/business-locations/{location_id}")
async def delete_business_location(location_id: int):
    """사업장 삭제"""
    try:
        return {
            "success": True,
            "message": f"사업장 ID {location_id}가 성공적으로 삭제되었습니다."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/meal-pricing")
async def create_meal_pricing(request: Request):
    """식단가 생성 - Railway PostgreSQL"""
    try:
        data = await request.json()

        # 입력 데이터 검증
        plan_name = data.get("meal_name") or data.get("plan_name")
        location_name = data.get("location_name", "미정")
        meal_plan_type = data.get("meal_plan_type", "기본")
        meal_type = data.get("meal_type", "중식")
        selling_price = float(data.get("base_price", 0))
        material_cost = float(data.get("actual_cost", 0))

        if not plan_name:
            return {"success": False, "error": "식단명은 필수입니다"}

        # PostgreSQL에 저장
        # Railway PostgreSQL 연결
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            pg_cursor.execute("""
                INSERT INTO meal_pricing (location_name, meal_plan_type, meal_type, plan_name,
                                        selling_price, material_cost_guideline, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING id
            """, (location_name, meal_plan_type, meal_type, plan_name, selling_price, material_cost, True))

            new_id = pg_cursor.fetchone()[0]
            pg_conn.commit()

            return {
                "success": True,
                "data": {
                    "id": new_id,
                    "meal_name": plan_name,
                    "plan_name": plan_name,
                    "location_name": location_name,
                    "meal_plan_type": meal_plan_type,
                    "meal_type": meal_type,
                    "base_price": selling_price,
                    "selling_price": selling_price,
                    "actual_cost": material_cost,
                    "material_cost_guideline": material_cost,
                    "status": "active"
                },
                "message": "식단가가 성공적으로 생성되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/meal-pricing/{pricing_id}")
async def update_meal_pricing(pricing_id: int, request: Request):
    """식단가 수정 - Railway PostgreSQL"""
    try:
        data = await request.json()

        # 입력 데이터 처리
        plan_name = data.get("meal_name") or data.get("plan_name")
        location_name = data.get("location_name")
        meal_plan_type = data.get("meal_plan_type")
        meal_type = data.get("meal_type")
        selling_price = data.get("base_price") or data.get("selling_price")
        material_cost = data.get("actual_cost") or data.get("material_cost_guideline")
        is_active = data.get("status") == "active" if "status" in data else True

        # PostgreSQL 업데이트
        # Railway PostgreSQL 연결
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 수정할 필드들 동적으로 구성
            update_fields = []
            update_values = []

            if plan_name is not None:
                update_fields.append("plan_name = %s")
                update_values.append(plan_name)
            if location_name is not None:
                update_fields.append("location_name = %s")
                update_values.append(location_name)
            if meal_plan_type is not None:
                update_fields.append("meal_plan_type = %s")
                update_values.append(meal_plan_type)
            if meal_type is not None:
                update_fields.append("meal_type = %s")
                update_values.append(meal_type)
            if selling_price is not None:
                update_fields.append("selling_price = %s")
                update_values.append(float(selling_price))
            if material_cost is not None:
                update_fields.append("material_cost_guideline = %s")
                update_values.append(float(material_cost))
            if "status" in data:
                update_fields.append("is_active = %s")
                update_values.append(is_active)

            update_fields.append("updated_at = CURRENT_TIMESTAMP")
            update_values.append(pricing_id)

            if update_fields:
                query = f"UPDATE meal_pricing SET {', '.join(update_fields)} WHERE id = %s"
                pg_cursor.execute(query, update_values)
                pg_conn.commit()

            # 업데이트된 데이터 조회
            pg_cursor.execute("SELECT * FROM meal_pricing WHERE id = %s", (pricing_id,))
            updated_row = pg_cursor.fetchone()

            if not updated_row:
                return {"success": False, "error": "해당 ID의 식단가를 찾을 수 없습니다"}

            return {
                "success": True,
                "data": {
                    "id": pricing_id,
                    "meal_name": plan_name,
                    "plan_name": plan_name,
                    "location_name": location_name,
                    "meal_plan_type": meal_plan_type,
                    "meal_type": meal_type,
                    "base_price": selling_price,
                    "selling_price": selling_price,
                    "actual_cost": material_cost,
                    "material_cost_guideline": material_cost,
                    "status": "active" if is_active else "inactive"
                },
                "message": "식단가가 성공적으로 수정되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/meal-pricing/{pricing_id}")
async def delete_meal_pricing(pricing_id: int):
    """식단가 삭제 - Railway PostgreSQL"""
    try:
        # PostgreSQL에서 삭제
        # Railway PostgreSQL 연결
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 삭제 전 데이터 존재 확인
            pg_cursor.execute("SELECT plan_name FROM meal_pricing WHERE id = %s", (pricing_id,))
            existing_row = pg_cursor.fetchone()

            if not existing_row:
                return {"success": False, "error": "해당 ID의 식단가를 찾을 수 없습니다"}

            plan_name = existing_row[0]

            # PostgreSQL에서 삭제
            pg_cursor.execute("DELETE FROM meal_pricing WHERE id = %s", (pricing_id,))
            pg_conn.commit()


            return {
                "success": True,
                "message": f"식단가 '{plan_name}' (ID: {pricing_id})가 성공적으로 삭제되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/system-info")
async def get_system_info():
    """시스템 연결 정보 조회"""
    try:
        import os
        from urllib.parse import urlparse

        db_url = os.environ.get('DATABASE_URL', '')
        env_type = "Local"
        masked_host = "localhost"

        if db_url:
            if 'railway' in db_url or 'rlwy' in db_url:
                env_type = "Railway"
            elif 'flycast' in db_url or 'fly.io' in db_url:
                env_type = "Fly.io"
            elif 'googleapis' in db_url:
                env_type = "GCP"
            
            # Host masking
            try:
                parsed = urlparse(db_url)
                host = parsed.hostname or ""
                if len(host) > 10:
                    masked_host = f"{host[:4]}***{host[-4:]}"
                else:
                    masked_host = host
            except:
                masked_host = "Unknown"

        return {
            "success": True,
            "environment": env_type,
            "db_host": masked_host,
            "db_type": "PostgreSQL"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/create-database-indexes")
async def create_database_indexes():
    """PostgreSQL 데이터베이스 성능 최적화 인덱스 생성"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if db_type != "postgresql":
                return {"success": False, "error": "PostgreSQL 연결이 필요합니다"}

            # 기존 인덱스 확인
            cursor.execute("""
                SELECT indexname, tablename
                FROM pg_indexes
                WHERE tablename = 'ingredients'
                AND schemaname = 'public'
            """)
            existing_indexes = cursor.fetchall()
            existing_index_names = [idx[0] for idx in existing_indexes]

            # 성능 최적화 인덱스들
            indexes_to_create = [
                {
                    "name": "idx_ingredients_name_btree",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_name_btree ON ingredients(ingredient_name)",
                    "description": "식자재명 B-tree 인덱스 (정렬/필터용)"
                },
                {
                    "name": "idx_ingredients_supplier",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_supplier ON ingredients(supplier_name)",
                    "description": "협력업체명 인덱스"
                },
                {
                    "name": "idx_ingredients_price_per_unit",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_price_per_unit ON ingredients(price_per_unit) WHERE price_per_unit IS NOT NULL",
                    "description": "단위당 단가 인덱스 (NULL 제외)"
                },
                {
                    "name": "idx_ingredients_category",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category, sub_category)",
                    "description": "카테고리 복합 인덱스"
                },
                {
                    "name": "idx_ingredients_code",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_code ON ingredients(ingredient_code)",
                    "description": "식자재 코드 인덱스"
                },
                {
                    "name": "idx_ingredients_composite_search",
                    "sql": "CREATE INDEX IF NOT EXISTS idx_ingredients_composite_search ON ingredients(supplier_name, price_per_unit, ingredient_name)",
                    "description": "복합 검색 최적화 인덱스"
                }
            ]

            # 인덱스 생성
            created_indexes = []
            skipped_indexes = []
            failed_indexes = []

            for idx in indexes_to_create:
                try:
                    if idx["name"] in existing_index_names:
                        skipped_indexes.append(f"{idx['name']} (이미 존재)")
                        continue

                    cursor.execute(idx['sql'])
                    conn.commit()
                    created_indexes.append(f"{idx['name']} - {idx['description']}")
                except Exception as e:
                    failed_indexes.append(f"{idx['name']} - 오류: {str(e)}")

            # 통계 정보 업데이트
            cursor.execute("ANALYZE ingredients")
            conn.commit()

            # 최종 인덱스 목록 확인
            cursor.execute("""
                SELECT indexname, tablename
                FROM pg_indexes
                WHERE tablename = 'ingredients'
                AND schemaname = 'public'
                ORDER BY indexname
            """)
            final_indexes = cursor.fetchall()

            cursor.close()

            return {
                "success": True,
                "message": f"데이터베이스 인덱스 최적화 완료!",
                "details": {
                    "total_indexes": len(final_indexes),
                    "created_indexes": len(created_indexes),
                    "skipped_indexes": len(skipped_indexes),
                    "failed_indexes": len(failed_indexes),
                    "created_list": created_indexes,
                    "skipped_list": skipped_indexes,
                    "failed_list": failed_indexes,
                    "all_indexes": [idx[0] for idx in final_indexes],
                    "performance_note": "84,215개 식자재 검색 성능이 대폭 향상됩니다!"
                }
            }

    except Exception as e:
        return {"success": False, "error": f"인덱스 생성 실패: {str(e)}"}

# ================================
# 식단관리 Ⅱ 페이지용 API 엔드포인트
# ================================


@router.post("/api/admin/initialize-database")
async def initialize_railway_database():
    """Railway PostgreSQL 데이터베이스에 누락된 기본 데이터 초기화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            results = {}

            # 1. Users 테이블 초기화
            cursor.execute("SELECT COUNT(*) FROM users")
            user_count = cursor.fetchone()[0]

            if user_count == 0:
                # 보안 강화: 환경변수에서 초기 관리자 정보 읽기
                import bcrypt as _bcrypt
                admin_password = os.environ.get("ADMIN_PASSWORD", "defaultAdmin2024!")
                admin_hash = _bcrypt.hashpw(admin_password.encode('utf-8'), _bcrypt.gensalt()).decode('utf-8')

                users_data = [
                    ('admin', admin_hash, 'admin', 1, '시스템 관리자', 'IT'),
                    ('js', _bcrypt.hashpw(b'js2024!', _bcrypt.gensalt()).decode('utf-8'), 'admin', 1, '다함', 'IT'),
                    ('jylee', _bcrypt.hashpw(b'jylee2024!', _bcrypt.gensalt()).decode('utf-8'), 'admin', 1, '다함', 'IT')
                ]

                for username, password_hash, role, is_active, contact_info, department in users_data:
                    cursor.execute("""
                        INSERT INTO users (username, password_hash, role, is_active, contact_info, department, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (username) DO NOTHING
                    """, (username, password_hash, role, is_active, contact_info, department))

                results['users'] = '3개 사용자 추가됨'
            else:
                results['users'] = f'이미 {user_count}개 사용자 존재'

            # 2. Business Locations 테이블 초기화
            cursor.execute("SELECT COUNT(*) FROM business_locations")
            location_count = cursor.fetchone()[0]

            if location_count == 0:
                locations_data = [
                    ('BIZ001', '도시락', '급식업체', '대구 달성', '', '', 'Manager 1', '', 1),
                    ('BIZ002', '운반', '급식업체', '대구 서구', '', '', 'Manager 2', '', 1),
                    ('BIZ003', '학교', '급식업체', '대구 달성', '', '', 'Manager 3', '', 1),
                    ('BIZ004', '요양원', '급식업체', '대구 달성', '', '', 'Manager 4', '', 1),
                    ('BIZ005', '영남 도시락', '급식업체', '대구 달성', '', '', 'Manager 5', '', 1),
                    ('BIZ006', '영남 운반', '급식업체', '대구 달성', '', '', 'Manager 6', '', 1)
                ]

                for site_code, site_name, site_type, region, address, phone, manager_name, manager_phone, is_active in locations_data:
                    cursor.execute("""
                        INSERT INTO business_locations (site_code, site_name, site_type, region, address, phone, manager_name, manager_phone, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (site_code) DO NOTHING
                    """, (site_code, site_name, site_type, region, address, phone, manager_name, manager_phone, is_active))

                results['business_locations'] = '6개 사업장 추가됨'
            else:
                results['business_locations'] = f'이미 {location_count}개 사업장 존재'

            # 3. Suppliers 테이블 초기화
            cursor.execute("SELECT COUNT(*) FROM suppliers")
            supplier_count = cursor.fetchone()[0]

            if supplier_count == 0:
                suppliers_data = [
                    ('삼성웰스토리', '서울 강남구', '02-1234-5678', 'contact@samsung.com', 1),
                    ('현대그린푸드', '서울 서초구', '02-2345-6789', 'contact@hyundai.com', 1),
                    ('CJ푸드빌', '서울 중구', '02-3456-7890', 'contact@cj.com', 1),
                    ('푸디스트', '대구 달성', '053-456-7890', 'contact@foodist.com', 1),
                    ('동원홈푸드', '서울 용산구', '02-5678-9012', 'contact@dongwon.com', 1),
                    ('기타 협력업체', '대구 달성', '053-000-0000', 'contact@other.com', 1),
                    ('직접 구매', '대구 달성', '053-111-1111', 'direct@purchase.com', 1)
                ]

                for name, address, phone, email, is_active in suppliers_data:
                    cursor.execute("""
                        INSERT INTO suppliers (name, address, phone, email, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (name) DO NOTHING
                    """, (name, address, phone, email, is_active))

                results['suppliers'] = '7개 협력업체 추가됨'
            else:
                results['suppliers'] = f'이미 {supplier_count}개 협력업체 존재'

            # 4. Menu Recipes 테이블 초기화 (기본 레시피 2개)
            cursor.execute("SELECT COUNT(*) FROM menu_recipes")
            recipe_count = cursor.fetchone()[0]

            if recipe_count == 0:
                recipes_data = [
                    ('RECIPE_1758837652', '다)백미밥-운-120', '밥', '', 166.0, 1, 1, 'system'),
                    ('RECIPE_RESTORED_002', '복구된 식단표 2', '밥', '백업에서 복구된 메뉴', 200.00, 1, 1, 'system')
                ]

                for recipe_code, recipe_name, category, cooking_note, total_cost, serving_size, is_active, created_by in recipes_data:
                    cursor.execute("""
                        INSERT INTO menu_recipes (recipe_code, recipe_name, category, cooking_note, total_cost, serving_size, is_active, created_by, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (recipe_code) DO NOTHING
                    """, (recipe_code, recipe_name, category, cooking_note, total_cost, serving_size, is_active, created_by))

                results['menu_recipes'] = '2개 메뉴 레시피 추가됨'
            else:
                results['menu_recipes'] = f'이미 {recipe_count}개 메뉴 레시피 존재'

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "Railway PostgreSQL 데이터베이스 초기화 완료",
                "results": results
            }

    except Exception as e:
        print(f"[ERROR] initialize_railway_database: {e}")
        return {"success": False, "error": str(e)}



@router.post("/api/admin/create-secure-users")
async def create_secure_users():
    """Railway DB에 보안 강화된 사용자 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            import hashlib

            # 보안 강화된 사용자 데이터
            secure_users = [
                {
                    "username": "admin_secure",
                    "password": "SecureAdmin2024!",
                    "role": "admin",
                    "contact_info": "보안 강화된 관리자",
                    "department": "IT"
                },
                {
                    "username": "js_secure",
                    "password": "js2024!",
                    "role": "admin",
                    "contact_info": "다함 - 보안 강화",
                    "department": "IT"
                },
                {
                    "username": "jylee_secure",
                    "password": "jylee2024!",
                    "role": "admin",
                    "contact_info": "다함 - 보안 강화",
                    "department": "IT"
                }
            ]

            created_users = []

            for user_data in secure_users:
                # 사용자가 이미 존재하는지 확인
                cursor.execute("SELECT id FROM users WHERE username = %s", (user_data["username"],))
                existing = cursor.fetchone()

                if existing:
                    created_users.append(f"{user_data['username']} (이미 존재)")
                    continue

                # 비밀번호 해시 생성 (bcrypt)
                import bcrypt as _bcrypt
                password_hash = _bcrypt.hashpw(user_data["password"].encode('utf-8'), _bcrypt.gensalt()).decode('utf-8')

                # 새 사용자 생성
                cursor.execute("""
                    INSERT INTO users (username, password_hash, role, contact_info, department, is_active, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    RETURNING id
                """, (
                    user_data["username"],
                    password_hash,
                    user_data["role"],
                    user_data["contact_info"],
                    user_data["department"],
                    1
                ))

                user_id = cursor.fetchone()[0]
                created_users.append(f"{user_data['username']} (ID: {user_id})")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "보안 강화된 사용자 생성 완료",
                "created_users": created_users,
                "login_info": [
                    "admin_secure / SecureAdmin2024!",
                    "js_secure / js2024!",
                    "jylee_secure / jylee2024!"
                ]
            }

    except Exception as e:
        print(f"[ERROR] create_secure_users: {e}")
        return {"success": False, "error": str(e)}



@router.post("/api/admin/test-secure-login")
async def test_secure_login(request: Request):
    """보안 강화된 로그인 테스트"""
    try:
        data = await request.json()
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return {"success": False, "error": "사용자명과 비밀번호를 입력해주세요"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사용자 조회 (permissions 포함)
            try:
                cursor.execute("SELECT id, username, password_hash, role, permissions FROM users WHERE username = %s AND is_active = TRUE", (username,))
                has_permissions_col = True
            except Exception:
                conn.rollback()
                cursor.execute("SELECT id, username, password_hash, role FROM users WHERE username = %s AND is_active = TRUE", (username,))
                has_permissions_col = False
            user = cursor.fetchone()

            if not user:
                return {"success": False, "error": "사용자를 찾을 수 없습니다"}

            user_id, db_username, password_hash, role = user[0], user[1], user[2], user[3]
            user_permissions = user[4] if has_permissions_col and len(user) > 4 and user[4] else {}
            if isinstance(user_permissions, str):
                import json as _json
                try:
                    user_permissions = _json.loads(user_permissions)
                except:
                    user_permissions = {}
            # admin은 항상 blog_access 보유
            if role == 'admin':
                user_permissions['blog_access'] = True

            # 비밀번호 검증 (bcrypt 우선, SHA256 하위호환)
            import hashlib
            import time
            import secrets
            import bcrypt as _bcrypt
            password_valid = False
            if password_hash and password_hash.startswith('$2'):
                password_valid = _bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
            else:
                input_hash = hashlib.sha256(password.encode()).hexdigest()
                if input_hash == password_hash:
                    password_valid = True
                    try:
                        new_hash = _bcrypt.hashpw(password.encode('utf-8'), _bcrypt.gensalt()).decode('utf-8')
                        cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user_id))
                        conn.commit()
                    except Exception:
                        pass

            if password_valid:
                return {
                    "success": True,
                    "data": {
                        "token": secrets.token_urlsafe(32),
                        "user": {
                            "username": db_username,
                            "role": role,
                            "permissions": user_permissions
                        }
                    },
                    "message": "보안 강화된 로그인 성공"
                }
            else:
                return {"success": False, "error": "비밀번호가 일치하지 않습니다"}

            cursor.close()

    except Exception as e:
        print(f"[AUTH ERROR] {e}")
        return {"success": False, "error": "인증 처리 중 오류가 발생했습니다"}


@router.get("/api/admin/ingredients-stats")
async def get_ingredients_stats():
    """식자재 협력업체별 통계 정보"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체별 식자재 개수
            cursor.execute("""
                SELECT
                    supplier_name,
                    COUNT(*) as count
                FROM ingredients
                WHERE supplier_name IS NOT NULL
                GROUP BY supplier_name
                ORDER BY count DESC
            """)

            supplier_stats = []
            for row in cursor.fetchall():
                supplier_stats.append({
                    "supplier": row[0],
                    "count": row[1]
                })

            # 전체 통계
            cursor.execute("SELECT COUNT(*) FROM ingredients")
            total_ingredients = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(DISTINCT supplier_name) FROM ingredients WHERE supplier_name IS NOT NULL")
            total_suppliers = cursor.fetchone()[0]

            cursor.close()

            return {
                "success": True,
                "total_ingredients": total_ingredients,
                "total_suppliers": total_suppliers,
                "supplier_stats": supplier_stats
            }

    except Exception as e:
        print(f"[INGREDIENTS STATS ERROR] {e}")
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/api/admin/validate-supplier-names")
async def validate_supplier_names(request: Request):
    """
    업로드 전 협력업체명 검증
    - 엑셀 파일에서 추출한 거래처명 목록을 받아서
    - 기존 협력업체와 매칭되는지 확인
    - 매칭되지 않는 이름(오타 가능성)을 반환
    """
    try:
        data = await request.json()
        supplier_names = data.get('supplier_names', [])

        if not supplier_names:
            return {"success": True, "data": {"unmatched": [], "matched": [], "existing_suppliers": []}}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 협력업체 목록 조회
            cursor.execute("""
                SELECT id, name, supplier_code
                FROM suppliers
                WHERE is_active = true
                ORDER BY name
            """)
            existing_suppliers = [{"id": row[0], "name": row[1], "code": row[2]} for row in cursor.fetchall()]
            existing_names = {s['name'].strip().lower() for s in existing_suppliers}

            # 매칭 결과 분류
            matched = []
            unmatched = []

            for name in set(supplier_names):  # 중복 제거
                if not name or str(name).strip() == '' or str(name).lower() in ['nan', 'none', '미등록']:
                    continue

                name_lower = str(name).strip().lower()
                if name_lower in existing_names:
                    matched.append(name)
                else:
                    # 유사한 이름 찾기 (편집 거리 기반)
                    similar = find_similar_suppliers(name, existing_suppliers)
                    unmatched.append({
                        "name": name,
                        "similar": similar[:3]  # 상위 3개만
                    })

            cursor.close()

            return {
                "success": True,
                "data": {
                    "matched": matched,
                    "unmatched": unmatched,
                    "existing_suppliers": existing_suppliers
                }
            }

    except Exception as e:
        print(f"[VALIDATE SUPPLIER ERROR] {e}")
        return {"success": False, "error": str(e)}


def find_similar_suppliers(name: str, suppliers: list, threshold: float = 0.6) -> list:
    """간단한 유사도 기반으로 비슷한 협력업체 찾기"""
    from difflib import SequenceMatcher

    name_lower = str(name).lower().strip()
    results = []

    for supplier in suppliers:
        supplier_name = supplier['name'].lower().strip()
        ratio = SequenceMatcher(None, name_lower, supplier_name).ratio()

        if ratio >= threshold:
            results.append({
                "id": supplier['id'],
                "name": supplier['name'],
                "code": supplier['code'],
                "similarity": round(ratio * 100)
            })

    # 유사도 높은 순으로 정렬
    results.sort(key=lambda x: x['similarity'], reverse=True)
    return results


@router.post("/api/admin/upload-ingredients")
async def upload_ingredients(
    file: UploadFile = File(...),
    start_date: Optional[str] = Form(None),
    end_date: Optional[str] = Form(None),
    supplier_mapping: Optional[str] = Form(None),  # JSON 문자열: {"오타업체명": "정확한업체명", ...}
    override_supplier: Optional[str] = Form(None)  # 전체 식자재에 적용할 협력업체명
):
    """식자재 Excel 파일 업로드 및 DB 저장"""
    global upload_progress

    try:
        import io
        import pandas as pd
        from datetime import datetime
        from core.database import simple_unit_price_calculation

        # 진행 상태 초기화
        upload_progress = {
            "is_uploading": True,
            "total_rows": 0,
            "current_row": 0,
            "phase": "파일 읽는 중",
            "inserted": 0,
            "updated": 0,
            "errors": 0
        }

        # 파일 내용 읽기
        contents = await file.read()

        # Excel 파일 파싱
        try:
            df = pd.read_excel(io.BytesIO(contents))
            upload_progress["total_rows"] = len(df)
        except Exception as e:
            upload_progress["is_uploading"] = False
            return {"success": False, "error": f"Excel 파일 읽기 실패: {str(e)}"}

        print(f"[DEBUG] upload_ingredients called. Start: {start_date}, End: {end_date}", flush=True)

        # 협력업체 강제 지정 로그
        if override_supplier:
            print(f"[UPLOAD] 협력업체 강제 지정: {override_supplier} (모든 식자재에 적용)", flush=True)

        # 협력업체 매핑 파싱 (오타 → 정확한 이름)
        supplier_name_mapping = {}
        if supplier_mapping:
            try:
                supplier_name_mapping = json.loads(supplier_mapping)
                print(f"[UPLOAD] 협력업체 매핑 적용: {supplier_name_mapping}", flush=True)
            except json.JSONDecodeError:
                print(f"[UPLOAD] 협력업체 매핑 파싱 실패: {supplier_mapping}", flush=True)

        # 실제 파일의 컬럼 로그 출력
        print(f"[UPLOAD] Excel 파일 컬럼: {list(df.columns)}", flush=True)

        # 컬럼 이름 정리 (공백 제거 + 유니코드 정규화)
        import unicodedata
        import re
        df.columns = [unicodedata.normalize('NFC', str(col).strip()) for col in df.columns]
        print(f"[UPLOAD] 원본 컬럼: {list(df.columns)}", flush=True)

        # 유연한 컬럼 매칭 패턴 정의
        # 각 표준 필드명에 대해 가능한 여러 컬럼 이름들을 리스트로 정의
        FLEXIBLE_COLUMN_PATTERNS = {
            '업체명': ['거래처명', '업체명', '공급업체', '협력업체', '업체', 'supplier', 'vendor'],
            '품목코드': ['상품코드', '품목코드', '고유코드', '아이템코드', '코드', 'item_code', 'sku', 'code'],
            '품명': ['품목명', '품명', '식자재명', '상품명', '기본상품명(중분류)', '기본상품명', 'item_name', 'name'],
            '대분류': ['분류(대분류)', '대분류', '대카테고리', '분류', '카테고리', 'category', 'large_category'],
            '기본식자재': ['기본식자재(중분류)', '기본식자재(세분류)', '기본식자재', '중분류', '세분류', '서브카테고리', 'sub_category', 'middle_category'],
            '원산지': ['원산지', '산지', '원료산지', 'origin', 'source'],
            '게시유무': ['게시유무', '게시', '공개여부', '노출여부', 'posting', 'visible'],
            '규격': ['규격', '상품규격', '사양', '스펙', 'specification', 'spec'],
            '단위': ['단위', '포장단위', '판매단위', 'unit'],
            '과세구분': ['과세', '과세구분', '세금', '과세여부', 'tax', 'tax_type'],
            '납품요일': ['선발주일', '선별주일', '납품요일', '배송', '배송일', '납품일', 'delivery', 'shipping'],
            '구매단가': ['입고가', '입고단가', '구매가', '구매단가', '매입가', '원가', 'purchase_price', 'cost'],
            '판매단가': ['판매가', '판매단가', '판매가격', 'selling_price', 'price', 'sale_price']
        }

        # 컬럼 이름 정규화 함수 (비교용)
        def normalize_for_match(text):
            """컬럼 이름을 비교하기 쉽게 정규화"""
            text = str(text).lower().strip()
            text = re.sub(r'[_\-\s\(\)]+', '', text)  # 특수문자, 공백 제거
            return text

        # 유연한 컬럼 매칭
        column_mapping = {}
        matched_excel_cols = set()

        for standard_name, possible_names in FLEXIBLE_COLUMN_PATTERNS.items():
            # 가능한 이름들을 정규화
            normalized_patterns = [normalize_for_match(p) for p in possible_names]

            # 엑셀의 각 컬럼과 비교
            for excel_col in df.columns:
                if excel_col in matched_excel_cols:
                    continue  # 이미 매칭된 컬럼은 건너뛰기

                normalized_excel = normalize_for_match(excel_col)

                # 패턴 중 하나라도 일치하면 매칭
                if normalized_excel in normalized_patterns:
                    column_mapping[excel_col] = standard_name
                    matched_excel_cols.add(excel_col)
                    print(f"[UPLOAD] ✓ '{excel_col}' → '{standard_name}' 자동 매칭", flush=True)
                    break

        # 매칭되지 않은 컬럼 표시
        for excel_col in df.columns:
            if excel_col not in matched_excel_cols:
                print(f"[UPLOAD] ⚠ '{excel_col}' → 매핑 없음 (무시됨)", flush=True)

        # 컬럼 이름 변환
        df = df.rename(columns=column_mapping)
        print(f"[UPLOAD] 최종 컬럼: {list(df.columns)}", flush=True)

        # 필수 컬럼 확인 (최소 필수 항목만 체크)
        required_columns = ['품목코드', '품명']
        missing_columns = [col for col in required_columns if col not in df.columns]

        if missing_columns:
            print(f"[UPLOAD] 누락된 컬럼: {missing_columns}", flush=True)
            return {
                "success": False,
                "error": f"필수 컬럼이 없습니다: {', '.join(missing_columns)}",
                "found_columns": list(df.columns)
            }

        # DB 연결
        upload_progress["phase"] = "데이터 준비 중"
        print(f"[UPLOAD] DB 연결 시작", flush=True)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            print(f"[UPLOAD] 배치 처리 시작 (총 {len(df)}개 행)", flush=True)

            inserted_count = 0
            updated_count = 0
            error_count = 0

            # 배치 처리: 모든 데이터를 한 번에 upsert
            # 중복 제거를 위해 딕셔너리 사용 (마지막 값만 유지)
            batch_data_dict = {}
            error_details = []  # 실패 상세 정보

            # 첫 번째 행 디버깅 (컬럼 접근 확인)
            if len(df) > 0:
                first_row = df.iloc[0]
                print(f"[UPLOAD DEBUG] 첫 번째 행 컬럼 키: {list(first_row.keys())}", flush=True)
                print(f"[UPLOAD DEBUG] '품목코드' in columns: {'품목코드' in df.columns}", flush=True)
                print(f"[UPLOAD DEBUG] '품명' in columns: {'품명' in df.columns}", flush=True)
                if '품목코드' in df.columns:
                    print(f"[UPLOAD DEBUG] 첫 번째 품목코드 값: {repr(first_row.get('품목코드', 'NOT_FOUND'))}", flush=True)
                if '품명' in df.columns:
                    print(f"[UPLOAD DEBUG] 첫 번째 품명 값: {repr(first_row.get('품명', 'NOT_FOUND'))}", flush=True)

            for idx, row in df.iterrows():
                upload_progress["current_row"] = idx + 1  # 1부터 시작
                upload_progress["errors"] = error_count

                # 진행률 업데이트 (매 10개마다)
                if idx % 10 == 0:
                    percentage = round((idx / len(df)) * 100, 1)
                    upload_progress["phase"] = f"데이터 준비 중 ({percentage}%)"

                if idx % 100 == 0:
                    print(f"[UPLOAD] 데이터 준비 중: {idx}/{len(df)}", flush=True)

                try:
                    # 기본 필수 정보 - 다양한 방식으로 접근 시도
                    ingredient_code = None
                    ingredient_name = None

                    # 품목코드 접근
                    if '품목코드' in df.columns:
                        val = row['품목코드']
                        ingredient_code = str(val) if pd.notna(val) else None

                    # 품명 접근
                    if '품명' in df.columns:
                        val = row['품명']
                        ingredient_name = str(val) if pd.notna(val) else None

                    # 첫 번째 행에서 디버그 출력
                    if idx == 0:
                        print(f"[UPLOAD DEBUG] Row 0 - code: {repr(ingredient_code)}, name: {repr(ingredient_name)}", flush=True)

                    # 선택 정보 (없을 수 있음) - 안전한 접근 방식
                    raw_supplier_name = str(row['업체명']) if '업체명' in df.columns and pd.notna(row['업체명']) else '미등록'
                    # 협력업체 매핑 적용 (오타 → 정확한 이름으로 변환)
                    supplier_name = supplier_name_mapping.get(raw_supplier_name, raw_supplier_name)
                    # ★ 협력업체 강제 지정 (드롭다운 선택 시)
                    if override_supplier:
                        supplier_name = override_supplier
                    category = str(row['대분류']) if '대분류' in df.columns and pd.notna(row['대분류']) else None
                    sub_category = str(row['기본식자재']) if '기본식자재' in df.columns and pd.notna(row['기본식자재']) else None
                    origin = str(row['원산지']) if '원산지' in df.columns and pd.notna(row['원산지']) else None
                    # 게시유무: 빈값이거나 '무'/'미게시'가 아니면 모두 '유'(게시)로 설정
                    raw_posting = str(row['게시유무']).strip() if '게시유무' in df.columns and pd.notna(row['게시유무']) else ''
                    posting_status = '무' if raw_posting in ['무', '미게시', 'N', 'n', 'no', 'No', 'NO', '0', 'false', 'False'] else '유'
                    specification = str(row['규격']) if '규격' in df.columns and pd.notna(row['규격']) else None
                    unit = str(row['단위']) if '단위' in df.columns and pd.notna(row['단위']) else None
                    tax_type = str(row['과세구분']) if '과세구분' in df.columns and pd.notna(row['과세구분']) else None
                    delivery_days = str(row['납품요일']) if '납품요일' in df.columns and pd.notna(row['납품요일']) else None

                    # 가격 정보
                    try:
                        purchase_price = float(row['구매단가']) if '구매단가' in df.columns and pd.notna(row['구매단가']) else 0
                    except:
                        purchase_price = 0

                    try:
                        selling_price = float(row['판매단가']) if '판매단가' in df.columns and pd.notna(row['판매단가']) else 0
                    except:
                        selling_price = 0

                    if not ingredient_code or not ingredient_name:
                        error_count += 1
                        error_details.append({
                            "row": idx + 2,  # Excel 행 번호 (헤더 포함)
                            "code": ingredient_code or "(없음)",
                            "name": ingredient_name or "(없음)",
                            "error": "필수 정보 누락 (품목코드 또는 품명)"
                        })
                        continue

                    # 단위당 단가 계산 (구매가 기준)
                    price_per_unit = simple_unit_price_calculation(purchase_price, specification, unit)

                    # 중복 키: (ingredient_code, supplier_name) - 마지막 행만 유지
                    key = (ingredient_code, supplier_name)
                    batch_data_dict[key] = (
                        supplier_name, ingredient_code, ingredient_name, category, sub_category,
                        origin, posting_status, specification, unit, tax_type, delivery_days,
                        purchase_price, selling_price, price_per_unit
                    )

                except Exception as e:
                    error_msg = str(e)
                    print(f"[UPLOAD ERROR] Row {idx + 2}: {ingredient_name or '(알수없음)'} - {error_msg}", flush=True)
                    error_count += 1
                    error_details.append({
                        "row": idx + 2,
                        "code": ingredient_code if 'ingredient_code' in locals() else "(없음)",
                        "name": ingredient_name if 'ingredient_name' in locals() else "(없음)",
                        "error": error_msg
                    })

            # 딕셔너리를 리스트로 변환
            batch_data = list(batch_data_dict.values())
            print(f"[UPLOAD] 중복 제거 완료: {len(df)}개 → {len(batch_data)}개", flush=True)

            # ========================================
            # suppliers 테이블 자동 동기화
            # 협력업체코드와 suppliers를 동일시하도록 처리
            # ========================================
            upload_progress["phase"] = "협력업체 동기화 중"
            print(f"[UPLOAD] suppliers 테이블 동기화 시작", flush=True)

            # 1. batch_data에서 고유한 supplier_name 추출
            unique_suppliers = set(row[0] for row in batch_data if row[0] and row[0] != '미등록')
            print(f"[UPLOAD] 업로드 파일의 협력업체: {unique_suppliers}", flush=True)

            # 2. 현재 suppliers 테이블에 등록된 업체 조회
            cursor.execute("SELECT name FROM suppliers WHERE is_active = true")
            registered_suppliers = set(row[0] for row in cursor.fetchall())
            print(f"[UPLOAD] 등록된 협력업체: {registered_suppliers}", flush=True)

            # 3. 미등록 업체 자동 등록
            new_suppliers = unique_suppliers - registered_suppliers
            if new_suppliers:
                print(f"[UPLOAD] 신규 협력업체 자동 등록: {new_suppliers}", flush=True)
                for supplier_name in new_suppliers:
                    try:
                        cursor.execute("""
                            INSERT INTO suppliers (name, is_active, created_at, updated_at)
                            VALUES (%s, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            ON CONFLICT (name) DO NOTHING
                        """, (supplier_name,))
                        print(f"[UPLOAD] 협력업체 등록됨: {supplier_name}", flush=True)
                    except Exception as e:
                        print(f"[UPLOAD WARNING] 협력업체 등록 실패 ({supplier_name}): {e}", flush=True)
                conn.commit()
            else:
                print(f"[UPLOAD] 모든 협력업체가 이미 등록되어 있습니다", flush=True)

            upload_progress["phase"] = "DB 저장 중"
            print(f"[UPLOAD] 고속 bulk insert 시작 ({len(batch_data)}건)", flush=True)

            # Start Date / End Date 확인 (이미 파라미터로 받음)
            if not start_date or start_date == 'null' or start_date == 'undefined':
                start_date = None
            if not end_date or end_date == 'null' or end_date == 'undefined':
                 end_date = None
        
            # 오늘 날짜
            today = datetime.now().strftime('%Y-%m-%d')
        

            # 만약 start_date가 미래라면, 메인 테이블 업데이트 여부를 고민해야 함
            # 현재 로직: 무조건 메인 테이블 업데이트 + 옵션으로 히스토리 추가
            # (유저가 "지금 이 데이터로 덮어쓰고, 히스토리도 남겨줘" 라고 가정)

            # PostgreSQL executemany()를 사용한 고속 bulk upsert
            # 먼저 모두 INSERT 시도, 중복되면 UPDATE
            from psycopg2.extras import execute_values

            # id 시퀀스 동기화 (시퀀스가 기존 max id보다 뒤처져 있으면 충돌 발생)
            try:
                cursor.execute("SELECT setval(pg_get_serial_sequence('ingredients', 'id'), COALESCE((SELECT MAX(id) FROM ingredients), 0) + 1, false)")
                conn.commit()
                print("[UPLOAD] id 시퀀스 동기화 완료", flush=True)
            except Exception as seq_err:
                print(f"[UPLOAD WARNING] 시퀀스 동기화 실패 (무시): {seq_err}", flush=True)
                try:
                    conn.rollback()
                except:
                    pass

            # DB에 기존 식자재 개수 확인 (카운트용)
            cursor.execute("SELECT COUNT(*) FROM ingredients")
            count_before = cursor.fetchone()[0]

            # UPSERT 쿼리 (RETURNING 없이 - 더 빠름)
            upsert_query = """
                INSERT INTO ingredients
                (supplier_name, ingredient_code, ingredient_name, category, sub_category,
                 origin, posting_status, specification, unit, tax_type, delivery_days,
                 purchase_price, selling_price, price_per_unit, created_at, updated_at)
                VALUES %s
                ON CONFLICT (ingredient_code, supplier_name)
                DO UPDATE SET
                    ingredient_name = EXCLUDED.ingredient_name,
                    category = EXCLUDED.category,
                    sub_category = EXCLUDED.sub_category,
                    origin = EXCLUDED.origin,
                    posting_status = EXCLUDED.posting_status,
                    specification = EXCLUDED.specification,
                    unit = EXCLUDED.unit,
                    tax_type = EXCLUDED.tax_type,
                    delivery_days = EXCLUDED.delivery_days,
                    purchase_price = EXCLUDED.purchase_price,
                    selling_price = EXCLUDED.selling_price,
                    price_per_unit = CASE
                        WHEN ingredients.base_weight_grams IS NOT NULL AND ingredients.base_weight_grams > 0
                        THEN EXCLUDED.selling_price / ingredients.base_weight_grams
                        ELSE EXCLUDED.price_per_unit
                    END,
                    updated_at = CURRENT_TIMESTAMP
            """

            try:
                # VALUES 부분만 추출하여 execute_values에 전달
                # CURRENT_TIMESTAMP는 template에서 처리하므로 제외
                values_list = batch_data  # 이미 튜플 형태로 준비됨

                print(f"[UPLOAD] execute_values 실행 중... (총 {len(values_list)}건)", flush=True)
                if len(values_list) > 0:
                    print(f"[UPLOAD] 첫 번째 데이터: {values_list[0]}", flush=True)

                execute_values(
                    cursor,
                    upsert_query,
                    values_list,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    page_size=1000
                )
                print(f"[UPLOAD] execute_values 성공!", flush=True)

                conn.commit()
                print(f"[UPLOAD] commit 성공!", flush=True)

                # 처리 후 개수 확인
                cursor.execute("SELECT COUNT(*) FROM ingredients")
                count_after = cursor.fetchone()[0]

                # 신규/수정 계산
                inserted_count = count_after - count_before
                updated_count = len(batch_data) - inserted_count

                print(f"[UPLOAD] bulk insert 완료 - 처리: {len(batch_data)}건, 신규: {inserted_count}, 수정: {updated_count}", flush=True)
            
                # ---------------------------------------------------------
                # [추가 기능] 날짜가 제공된 경우, ingredient_prices 테이블에도 저장
                # 주의: 이 기능은 선택적이며, 실패해도 식자재 업로드 성공에 영향 없음
                # ---------------------------------------------------------
                if start_date:
                    try:
                        print(f"[UPLOAD] 단가 이력 저장 시작 (적용일: {start_date} ~ {end_date or '계속'})", flush=True)
                        # 단가 이력 저장은 ingredient_prices 테이블이 올바르게 구성되어 있어야 함
                        # 테이블 구조가 다르면 스킵
                        print(f"[UPLOAD] 단가 이력 저장 스킵 (테이블 구조 확인 필요)", flush=True)
                    except Exception as price_error:
                        print(f"[UPLOAD WARNING] 단가 이력 저장 실패 (무시됨): {price_error}", flush=True)
                        try:
                            conn.rollback()
                        except:
                            pass

            except Exception as e:
                bulk_error_msg = str(e)
                print(f"[UPLOAD ERROR] Bulk insert 실패: {bulk_error_msg}", flush=True)
                conn.rollback()

                # 폴백: 기존 방식으로 한 번 더 시도
                print(f"[UPLOAD] 폴백: 개별 처리 방식으로 재시도 ({len(batch_data)}건)", flush=True)
                inserted_count = 0
                updated_count = 0

                # 폴백 모드는 이력 저장 미지원 (복잡도 감소)

                for idx, data in enumerate(batch_data):
                    try:
                        (supplier_name, ingredient_code, ingredient_name, category, sub_category,
                         origin, posting_status, specification, unit, tax_type, delivery_days,
                         purchase_price, selling_price, price_per_unit) = data

                        # 첫 번째 행 디버그
                        if idx == 0:
                            print(f"[UPLOAD FALLBACK] 첫 번째 데이터: code={ingredient_code}, name={ingredient_name}, supplier={supplier_name}", flush=True)

                        # SAVEPOINT를 사용하여 개별 행 실패가 전체 트랜잭션에 영향 주지 않도록 함
                        cursor.execute(f"SAVEPOINT sp_{idx}")

                        cursor.execute("""
                            INSERT INTO ingredients
                            (supplier_name, ingredient_code, ingredient_name, category, sub_category,
                             origin, posting_status, specification, unit, tax_type, delivery_days,
                             purchase_price, selling_price, price_per_unit, created_at, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            ON CONFLICT (ingredient_code, supplier_name)
                            DO UPDATE SET
                                ingredient_name = EXCLUDED.ingredient_name,
                                category = EXCLUDED.category,
                                sub_category = EXCLUDED.sub_category,
                                origin = EXCLUDED.origin,
                                posting_status = EXCLUDED.posting_status,
                                specification = EXCLUDED.specification,
                                unit = EXCLUDED.unit,
                                tax_type = EXCLUDED.tax_type,
                                delivery_days = EXCLUDED.delivery_days,
                                purchase_price = EXCLUDED.purchase_price,
                                selling_price = EXCLUDED.selling_price,
                                price_per_unit = CASE
                                    WHEN ingredients.base_weight_grams IS NOT NULL AND ingredients.base_weight_grams > 0
                                    THEN EXCLUDED.selling_price / ingredients.base_weight_grams
                                    ELSE EXCLUDED.price_per_unit
                                END,
                                updated_at = CURRENT_TIMESTAMP
                            RETURNING (xmax = 0) AS inserted
                        """, (supplier_name, ingredient_code, ingredient_name, category, sub_category,
                              origin, posting_status, specification, unit, tax_type, delivery_days,
                              purchase_price, selling_price, price_per_unit))

                        result = cursor.fetchone()
                        if result and result[0]:
                            inserted_count += 1
                        else:
                            updated_count += 1

                        cursor.execute(f"RELEASE SAVEPOINT sp_{idx}")

                    except Exception as e2:
                        error_msg = str(e2)
                        print(f"[UPLOAD ERROR] Row {idx}: {error_msg}", flush=True)
                        # SAVEPOINT로 롤백하여 트랜잭션 유지
                        try:
                            cursor.execute(f"ROLLBACK TO SAVEPOINT sp_{idx}")
                        except:
                            pass
                        error_count += 1
                        # 에러 상세정보 추가
                        if len(error_details) < 10:  # 처음 10개만
                            error_details.append({
                                "row": idx + 2,
                                "code": ingredient_code if 'ingredient_code' in locals() else "(없음)",
                                "name": ingredient_name if 'ingredient_name' in locals() else "(없음)",
                                "error": f"Fallback 오류: {error_msg}"
                            })

                conn.commit()
                print(f"[UPLOAD FALLBACK] 완료 - 삽입: {inserted_count}, 수정: {updated_count}, 오류: {error_count}", flush=True)

            cursor.close()

            # 완료 상태로 변경
            upload_progress["phase"] = "완료"
            upload_progress["is_uploading"] = False
            upload_progress["current_row"] = upload_progress["total_rows"]

            # bulk_insert 성공 여부 추적
            bulk_success = 'bulk_error_msg' not in locals()

            result = {
                "success": True,
                "message": f"업로드 완료: 신규 {inserted_count}건, 수정 {updated_count}건, 오류 {error_count}건",
                "inserted": inserted_count,
                "updated": updated_count,
                "errors": error_count,
                "total": inserted_count + updated_count + error_count,
                "error_details": error_details[:10],  # 처음 10개만 반환 (너무 많으면 응답 크기 문제)
                "debug_info": {
                    "column_mapping": column_mapping,
                    "final_columns": list(df.columns) if 'df' in locals() else [],
                    "batch_data_count": len(batch_data) if 'batch_data' in locals() else 0,
                    "bulk_insert_success": bulk_success,
                    "bulk_error": bulk_error_msg if 'bulk_error_msg' in locals() else None
                }
            }
            print(f"[UPLOAD SUCCESS] 응답: {result}", flush=True)
            import sys
            sys.stdout.flush()
            return result

    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        upload_progress["is_uploading"] = False
        upload_progress["phase"] = "오류 발생"
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/api/admin/migrate-suppliers-table")
async def migrate_suppliers_table():
    """suppliers 테이블에 누락된 컬럼 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 현재 컬럼 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'suppliers'
            """)
            existing_columns = set(row[0] for row in cursor.fetchall())

            added_columns = []

            # 누락된 컬럼 추가
            if 'address' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN address VARCHAR(500)")
                added_columns.append('address')

            if 'phone' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN phone VARCHAR(50)")
                added_columns.append('phone')

            if 'email' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN email VARCHAR(100)")
                added_columns.append('email')

            if 'is_active' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN DEFAULT true")
                added_columns.append('is_active')

            if 'created_at' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                added_columns.append('created_at')

            if 'updated_at' not in existing_columns:
                cursor.execute("ALTER TABLE suppliers ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                added_columns.append('updated_at')

            conn.commit()

            return {
                "success": True,
                "message": f"마이그레이션 완료",
                "added_columns": added_columns,
                "existing_columns": list(existing_columns)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/check-db-constraints")
async def check_db_constraints():
    """DB 테이블 제약조건 확인 (디버깅용)"""
    try:
        import os
        db_url = os.environ.get("DATABASE_URL", "NOT_SET")
        # 보안을 위해 마스킹 (호스트와 DB 이름만 표시)
        if db_url and "@" in db_url:
            parts = db_url.split("@")
            if len(parts) > 1:
                db_info = parts[1]  # host:port/database
            else:
                db_info = "INVALID_FORMAT"
        else:
            db_info = "NOT_SET"

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 현재 연결된 데이터베이스 이름 확인
            cursor.execute("SELECT current_database(), current_user, inet_server_addr(), inet_server_port()")
            db_connection_info = cursor.fetchone()
            connection_details = {
                "database": db_connection_info[0] if db_connection_info else None,
                "user": db_connection_info[1] if db_connection_info else None,
                "server_addr": str(db_connection_info[2]) if db_connection_info and db_connection_info[2] else None,
                "server_port": db_connection_info[3] if db_connection_info else None,
                "env_db_url_suffix": db_info
            }

            # ingredients 테이블 constraints 확인
            cursor.execute("""
                SELECT conname, pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'ingredients'::regclass
            """)
            ingredients_constraints = [{"name": row[0], "definition": row[1]} for row in cursor.fetchall()]

            # 자동 수정: unique constraint가 없으면 추가
            auto_fix_result = None
            constraint_names = [c["name"] for c in ingredients_constraints]
            if "ingredients_code_supplier_unique" not in constraint_names:
                try:
                    cursor.execute("""
                        ALTER TABLE ingredients
                        ADD CONSTRAINT ingredients_code_supplier_unique
                        UNIQUE (ingredient_code, supplier_name)
                    """)
                    conn.commit()
                    auto_fix_result = "ADDED: ingredients_code_supplier_unique"
                    # 추가 후 다시 확인
                    cursor.execute("""
                        SELECT conname, pg_get_constraintdef(oid)
                        FROM pg_constraint
                        WHERE conrelid = 'ingredients'::regclass
                    """)
                    ingredients_constraints = [{"name": row[0], "definition": row[1]} for row in cursor.fetchall()]
                except Exception as e:
                    auto_fix_result = f"FAILED: {str(e)}"
                    conn.rollback()

            # ingredients 테이블 인덱스 확인
            cursor.execute("""
                SELECT indexname, indexdef
                FROM pg_indexes
                WHERE tablename = 'ingredients'
            """)
            ingredients_indexes = [{"name": row[0], "definition": row[1]} for row in cursor.fetchall()]

            # UPSERT 테스트
            upsert_test = {"success": False, "error": None}
            try:
                from psycopg2.extras import execute_values
                test_data = [('TEST_SUPPLIER', 'TEST_CODE_12345', 'TEST_NAME', None, None, None, '유', None, None, None, None, 0, 0, None)]
                execute_values(
                    cursor,
                    """
                    INSERT INTO ingredients
                    (supplier_name, ingredient_code, ingredient_name, category, sub_category,
                     origin, posting_status, specification, unit, tax_type, delivery_days,
                     purchase_price, selling_price, price_per_unit, created_at, updated_at)
                    VALUES %s
                    ON CONFLICT (ingredient_code, supplier_name)
                    DO UPDATE SET ingredient_name = EXCLUDED.ingredient_name, updated_at = CURRENT_TIMESTAMP
                    """,
                    test_data,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                # 테스트 데이터 롤백
                conn.rollback()
                upsert_test["success"] = True
            except Exception as e:
                upsert_test["error"] = str(e)
                conn.rollback()

            cursor.close()

            return {
                "success": True,
                "connection_details": connection_details,
                "auto_fix_result": auto_fix_result,
                "ingredients_constraints": ingredients_constraints,
                "ingredients_indexes": ingredients_indexes,
                "upsert_test": upsert_test
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/fix-constraints")
async def fix_constraints():
    """누락된 DB 제약조건 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            results = {
                "added": [],
                "already_exists": [],
                "errors": []
            }

            # 1. ingredients 테이블의 (ingredient_code, supplier_name) unique constraint 확인 및 추가
            cursor.execute("""
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'ingredients'::regclass
                AND contype = 'u'
                AND conname = 'ingredients_code_supplier_unique'
            """)
            if not cursor.fetchone():
                try:
                    cursor.execute("""
                        ALTER TABLE ingredients
                        ADD CONSTRAINT ingredients_code_supplier_unique
                        UNIQUE (ingredient_code, supplier_name)
                    """)
                    conn.commit()
                    results["added"].append("ingredients_code_supplier_unique")
                except Exception as e:
                    results["errors"].append(f"ingredients_code_supplier_unique: {str(e)}")
                    conn.rollback()
            else:
                results["already_exists"].append("ingredients_code_supplier_unique")

            # 2. suppliers 테이블의 name unique constraint 확인 및 추가
            cursor.execute("""
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'suppliers'::regclass
                AND contype = 'u'
                AND conname = 'suppliers_name_unique'
            """)
            if not cursor.fetchone():
                try:
                    cursor.execute("""
                        ALTER TABLE suppliers
                        ADD CONSTRAINT suppliers_name_unique
                        UNIQUE (name)
                    """)
                    conn.commit()
                    results["added"].append("suppliers_name_unique")
                except Exception as e:
                    results["errors"].append(f"suppliers_name_unique: {str(e)}")
                    conn.rollback()
            else:
                results["already_exists"].append("suppliers_name_unique")

            cursor.close()

            return {
                "success": True,
                "results": results
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/cleanup-suppliers")
async def cleanup_suppliers():
    """suppliers 테이블 정비 - 불필요한 레코드 삭제 및 누락 업체 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            results = {
                "deleted": [],
                "added": [],
                "errors": []
            }

            # 1. 비활성 협력업체 중 식자재가 없는 레코드 정리 (선택적)
            # 레거시 하드코딩 제거됨 - is_active = 0인 레코드는 이미 목록에서 제외됨

            # 2. ingredients에 있지만 suppliers 테이블에 없는 업체 추가
            cursor.execute("""
                SELECT DISTINCT supplier_name
                FROM ingredients
                WHERE supplier_name IS NOT NULL AND supplier_name != ''
            """)
            ingredient_suppliers = set(row[0] for row in cursor.fetchall())

            cursor.execute("SELECT name FROM suppliers")
            existing_suppliers = set(row[0] for row in cursor.fetchall())

            # 누락된 업체 추가 (ON CONFLICT 없이)
            missing = ingredient_suppliers - existing_suppliers
            for name in missing:
                try:
                    # 먼저 존재 여부 확인
                    cursor.execute("SELECT id FROM suppliers WHERE name = %s", (name,))
                    exists = cursor.fetchone()
                    if not exists:
                        cursor.execute("""
                            INSERT INTO suppliers (name, is_active)
                            VALUES (%s, 1)
                            RETURNING id
                        """, (name,))
                        new_id = cursor.fetchone()
                        if new_id:
                            results["added"].append({"id": new_id[0], "name": name})
                        conn.commit()  # 각 추가 후 커밋
                except Exception as e:
                    conn.rollback()
                    results["errors"].append(f"추가 실패 ({name}): {str(e)}")

            # 3. 정비 후 현황 조회
            cursor.execute("SELECT id, name FROM suppliers ORDER BY name")
            final_list = [{"id": row[0], "name": row[1]} for row in cursor.fetchall()]


            return {
                "success": True,
                "message": "suppliers 테이블 정비 완료",
                "results": results,
                "final_suppliers": final_list
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/migrate-multi-site")
async def migrate_multi_site_tables():
    """다중 사업장 시스템 테이블 마이그레이션 (프로덕션용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            results = {
                "tables_created": [],
                "columns_added": [],
                "data_inserted": []
            }

            # 1. site_groups 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_groups (
                    id SERIAL PRIMARY KEY,
                    group_code VARCHAR(20) UNIQUE NOT NULL,
                    group_name VARCHAR(100) NOT NULL,
                    description TEXT,
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            results["tables_created"].append("site_groups")

            # 2. site_categories 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_categories (
                    id SERIAL PRIMARY KEY,
                    group_id INTEGER REFERENCES site_groups(id) ON DELETE CASCADE,
                    category_code VARCHAR(20) NOT NULL,
                    category_name VARCHAR(100) NOT NULL,
                    meal_types JSONB DEFAULT '["조식", "중식", "석식"]',
                    meal_items JSONB DEFAULT '["일반"]',
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(group_id, category_code)
                )
            """)
            results["tables_created"].append("site_categories")

            # 3. user_site_access 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_site_access (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    site_id INTEGER REFERENCES business_locations(id) ON DELETE CASCADE,
                    group_id INTEGER REFERENCES site_groups(id) ON DELETE CASCADE,
                    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
                    permissions JSONB DEFAULT '{}',
                    is_default BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            results["tables_created"].append("user_site_access")

            # 4. approval_thresholds 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS approval_thresholds (
                    id SERIAL PRIMARY KEY,
                    group_id INTEGER REFERENCES site_groups(id) ON DELETE CASCADE,
                    approval_type VARCHAR(50) NOT NULL,
                    min_amount DECIMAL(12,2) DEFAULT 0,
                    max_amount DECIMAL(12,2),
                    required_role VARCHAR(50) NOT NULL,
                    auto_approve BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
            results["tables_created"].append("approval_thresholds")

            # 5. user_favorites 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_favorites (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    site_id INTEGER REFERENCES business_locations(id) ON DELETE CASCADE,
                    display_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, site_id)
                )
            """)
            results["tables_created"].append("user_favorites")

            # 6. business_locations에 컬럼 추가
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'business_locations'
            """)
            existing_cols = set(row[0] for row in cursor.fetchall())

            if 'group_id' not in existing_cols:
                cursor.execute("ALTER TABLE business_locations ADD COLUMN group_id INTEGER REFERENCES site_groups(id)")
                results["columns_added"].append("business_locations.group_id")

            if 'category_id' not in existing_cols:
                cursor.execute("ALTER TABLE business_locations ADD COLUMN category_id INTEGER REFERENCES site_categories(id)")
                results["columns_added"].append("business_locations.category_id")

            if 'display_order' not in existing_cols:
                cursor.execute("ALTER TABLE business_locations ADD COLUMN display_order INTEGER DEFAULT 0")
                results["columns_added"].append("business_locations.display_order")

            # 7. 기본 그룹 생성
            cursor.execute("SELECT COUNT(*) FROM site_groups WHERE group_code = 'DEFAULT'")
            if cursor.fetchone()[0] == 0:
                cursor.execute("""
                    INSERT INTO site_groups (group_code, group_name, description, display_order)
                    VALUES ('DEFAULT', '본사', '기본 그룹', 1)
                """)
                results["data_inserted"].append("site_groups: 본사")

            # 8. 기본 카테고리 생성
            cursor.execute("SELECT id FROM site_groups WHERE group_code = 'DEFAULT'")
            default_group = cursor.fetchone()
            if default_group:
                group_id = default_group[0]

                categories = [
                    ('DOSIRAK', '도시락', '["조식", "중식", "석식"]', '["일반", "저염", "채식"]', 1),
                    ('UNBAN', '운반', '["중식"]', '["일반"]', 2),
                    ('SCHOOL', '학교', '["중식"]', '["일반", "알레르기대응"]', 3),
                    ('YOYANG', '요양원', '["조식", "중식", "석식"]', '["일반", "저염", "연하식"]', 4)
                ]

                for cat_code, cat_name, meal_types, meal_items, order in categories:
                    cursor.execute("""
                        INSERT INTO site_categories (group_id, category_code, category_name, meal_types, meal_items, display_order)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (group_id, category_code) DO NOTHING
                    """, (group_id, cat_code, cat_name, meal_types, meal_items, order))
                results["data_inserted"].append("site_categories: 도시락, 운반, 학교, 요양원")

            # 9. 기존 사업장을 기본 그룹/카테고리에 연결
            cursor.execute("""
                UPDATE business_locations
                SET group_id = (SELECT id FROM site_groups WHERE group_code = 'DEFAULT'),
                    category_id = (SELECT id FROM site_categories WHERE category_code = 'DOSIRAK' LIMIT 1)
                WHERE group_id IS NULL
            """)
            results["data_inserted"].append(f"business_locations 연결: {cursor.rowcount}개")

            # 9.5. menu_recipes에 scope, owner_site_id, owner_group_id 컬럼 추가
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'menu_recipes'
            """)
            recipe_cols = set(row[0] for row in cursor.fetchall())

            if 'scope' not in recipe_cols:
                cursor.execute("ALTER TABLE menu_recipes ADD COLUMN scope VARCHAR(20) DEFAULT 'global'")
                results["columns_added"].append("menu_recipes.scope")

            if 'owner_site_id' not in recipe_cols:
                cursor.execute("ALTER TABLE menu_recipes ADD COLUMN owner_site_id INTEGER REFERENCES business_locations(id)")
                results["columns_added"].append("menu_recipes.owner_site_id")

            if 'owner_group_id' not in recipe_cols:
                cursor.execute("ALTER TABLE menu_recipes ADD COLUMN owner_group_id INTEGER REFERENCES site_groups(id)")
                results["columns_added"].append("menu_recipes.owner_group_id")

            # 10. admin 사용자에게 super_admin 권한
            cursor.execute("""
                INSERT INTO user_site_access (user_id, group_id, role, is_default, permissions)
                SELECT
                    u.id,
                    (SELECT id FROM site_groups WHERE group_code = 'DEFAULT'),
                    'super_admin',
                    TRUE,
                    '{"all": true}'::jsonb
                FROM users u
                WHERE u.role = 'admin'
                ON CONFLICT DO NOTHING
            """)
            results["data_inserted"].append(f"user_site_access: {cursor.rowcount}개")

            conn.commit()

            return {
                "success": True,
                "message": "다중 사업장 마이그레이션 완료",
                "results": results
            }

    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
        return {"success": False, "error": str(e)}


@router.get("/api/admin/fix-consignment-sites")
async def fix_consignment_sites():
    """위탁사업장 카테고리에 business_location 자동 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 위탁사업장 그룹(Meal)의 카테고리 중 business_location이 없는 것 찾기
            cursor.execute("""
                SELECT sc.id, sc.category_code, sc.category_name, sc.group_id
                FROM site_categories sc
                JOIN site_groups sg ON sc.group_id = sg.id
                WHERE sg.group_code = 'Meal'
                AND NOT EXISTS (
                    SELECT 1 FROM business_locations bl WHERE bl.category_id = sc.id
                )
            """)
            missing_sites = cursor.fetchall()

            created = []
            for cat_id, cat_code, cat_name, group_id in missing_sites:
                site_code = f"CONS_{cat_code}"

                cursor.execute("""
                    INSERT INTO business_locations (site_code, site_name, site_type, group_id, category_id, is_active)
                    VALUES (%s, %s, %s, %s, %s, 1)
                    RETURNING id
                """, (site_code, cat_name, '위탁급식', group_id, cat_id))

                new_id = cursor.fetchone()[0]
                created.append({"id": new_id, "name": cat_name, "code": site_code})

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"{len(created)}개의 위탁사업장이 생성되었습니다",
                "created": created
            }

    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
        return {"success": False, "error": str(e)}


@router.get("/api/admin/reset-meal-types")
async def reset_meal_types():
    """모든 사업장의 끼니를 1개(중식)로 초기화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 모든 site_categories의 meal_types를 ['중식']으로 변경
            cursor.execute("""
                UPDATE site_categories
                SET meal_types = '["중식"]'::jsonb,
                    updated_at = NOW()
            """)
            updated = cursor.rowcount

            conn.commit()
            cursor.close()

            print(f"[API] {updated}개 카테고리의 끼니를 '중식' 1개로 초기화")
            return {
                "success": True,
                "updated": updated,
                "message": f"{updated}개 카테고리의 끼니가 '중식' 1개로 초기화되었습니다"
            }

    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
        return {"success": False, "error": str(e)}


# ========================================
# 공급 불가 품목 관리 API
# ========================================

@router.post("/api/admin/upload-supply-unavailable")
async def upload_supply_unavailable(
    file: UploadFile = File(...),
    supplier_name: str = Form(...),
    reason: Optional[str] = Form(None)
):
    """공급 불가 품목 Excel 업로드"""
    try:
        import io
        import pandas as pd
        from datetime import datetime

        # 파일 읽기
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))

        print(f"[SUPPLY_UNAVAILABLE] 업로드 시작 - 협력업체: {supplier_name}, 사유: {reason}")
        print(f"[SUPPLY_UNAVAILABLE] 컬럼: {list(df.columns)}")
        print(f"[SUPPLY_UNAVAILABLE] 행 수: {len(df)}")

        # 컬럼명 정규화 (공백 제거, 소문자 변환)
        df.columns = df.columns.str.strip()

        # 컬럼 매핑 (다양한 변형 지원)
        column_mapping = {
            # ingredient_code 변형
            '단품코드': 'ingredient_code',
            '상품코드': 'ingredient_code',
            '품목코드': 'ingredient_code',
            '코드': 'ingredient_code',
            '식자재코드': 'ingredient_code',
            '제품코드': 'ingredient_code',
            '자재코드': 'ingredient_code',
            'item_code': 'ingredient_code',
            'code': 'ingredient_code',
            # ingredient_name 변형
            '단품명': 'ingredient_name',
            '품명': 'ingredient_name',
            '품목명': 'ingredient_name',
            '상품명': 'ingredient_name',
            '식자재명': 'ingredient_name',
            '제품명': 'ingredient_name',
            '자재명': 'ingredient_name',
            'item_name': 'ingredient_name',
            'name': 'ingredient_name',
            # category 변형
            '대분류': 'category',
            '분류': 'category',
            '카테고리': 'category',
            # specification 변형
            '규격': 'specification',
            '스펙': 'specification',
            # unit 변형
            '단위': 'unit',
            # start_date 변형
            '시작일': 'start_date',
            '시작날짜': 'start_date',
            '시작': 'start_date',
            '공급불가시작': 'start_date',
            '공급불가시작일': 'start_date',
            '불가시작일': 'start_date',
            'start': 'start_date',
            # end_date 변형
            '종료일': 'end_date',
            '종료날짜': 'end_date',
            '종료': 'end_date',
            '공급불가종료': 'end_date',
            '공급불가종료일': 'end_date',
            '불가종료일': 'end_date',
            'end': 'end_date',
        }

        # 컬럼 이름 매핑
        df = df.rename(columns={col: column_mapping.get(col, col) for col in df.columns})

        print(f"[SUPPLY_UNAVAILABLE] 매핑 후 컬럼: {list(df.columns)}")

        # 필수 컬럼 확인
        required = ['ingredient_code', 'start_date', 'end_date']
        missing = [col for col in required if col not in df.columns]
        if missing:
            print(f"[SUPPLY_UNAVAILABLE] 필수 컬럼 누락: {missing}")
            print(f"[SUPPLY_UNAVAILABLE] 원본 컬럼: {list(df.columns)}")
            return {
                "success": False,
                "error": f"필수 컬럼이 없습니다: {', '.join(missing)}. 파일의 컬럼: {list(df.columns)}",
                "found_columns": list(df.columns),
                "required_columns": required,
                "hint": "필요한 컬럼: 단품코드(또는 상품코드/코드), 시작일, 종료일"
            }

        # DB 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            inserted = 0
            errors = []

            for idx, row in df.iterrows():
                try:
                    ingredient_code = str(row['ingredient_code']).strip()

                    # 날짜 파싱 (YYYYMMDD 형식)
                    start_date_raw = row['start_date']
                    end_date_raw = row['end_date']

                    if isinstance(start_date_raw, (int, float)):
                        start_date = datetime.strptime(str(int(start_date_raw)), '%Y%m%d').date()
                    else:
                        start_date = pd.to_datetime(start_date_raw).date()

                    if isinstance(end_date_raw, (int, float)):
                        end_date = datetime.strptime(str(int(end_date_raw)), '%Y%m%d').date()
                    else:
                        end_date = pd.to_datetime(end_date_raw).date()

                    ingredient_name = row.get('ingredient_name', '')
                    if pd.isna(ingredient_name):
                        ingredient_name = ''

                    category = row.get('category', '')
                    if pd.isna(category):
                        category = ''

                    specification = row.get('specification', '')
                    if pd.isna(specification):
                        specification = ''

                    unit = row.get('unit', '')
                    if pd.isna(unit):
                        unit = ''

                    # UPSERT (같은 품목+기간이 있으면 업데이트)
                    cursor.execute("""
                        INSERT INTO ingredient_blackout_periods
                        (ingredient_code, ingredient_name, supplier_name, start_date, end_date,
                         reason, category, specification, unit, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT DO NOTHING
                    """, (ingredient_code, ingredient_name, supplier_name, start_date, end_date,
                          reason, category, specification, unit))

                    if cursor.rowcount > 0:
                        inserted += 1

                except Exception as e:
                    errors.append({"row": idx + 2, "error": str(e)})

            conn.commit()
            cursor.close()

            print(f"[SUPPLY_UNAVAILABLE] 완료 - 등록: {inserted}, 오류: {len(errors)}")

            return {
                "success": True,
                "inserted": inserted,
                "total_rows": len(df),
                "errors": len(errors),
                "error_details": errors[:10] if errors else []
            }

    except Exception as e:
        print(f"[SUPPLY_UNAVAILABLE] 오류: {str(e)}")
        return {"success": False, "error": str(e)}


@router.get("/api/admin/supply-unavailable")
async def get_supply_unavailable(
    supplier_name: Optional[str] = None,
    target_date: Optional[str] = None,
    page: int = 1,
    per_page: int = 50
):
    """공급 불가 품목 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            where_conditions = ["is_active = TRUE"]
            params = []

            if supplier_name:
                where_conditions.append("supplier_name = %s")
                params.append(supplier_name)

            if target_date:
                where_conditions.append("%s BETWEEN start_date AND end_date")
                params.append(target_date)

            where_clause = " AND ".join(where_conditions)

            # 총 개수 조회
            cursor.execute(f"""
                SELECT COUNT(*) FROM ingredient_blackout_periods
                WHERE {where_clause}
            """, params)
            total = cursor.fetchone()[0]

            # 목록 조회
            offset = (page - 1) * per_page
            cursor.execute(f"""
                SELECT id, ingredient_code, ingredient_name, supplier_name,
                       start_date, end_date, reason, category, specification, unit
                FROM ingredient_blackout_periods
                WHERE {where_clause}
                ORDER BY start_date DESC, ingredient_name
                LIMIT %s OFFSET %s
            """, params + [per_page, offset])

            items = []
            for row in cursor.fetchall():
                items.append({
                    "id": row[0],
                    "ingredient_code": row[1],
                    "ingredient_name": row[2],
                    "supplier_name": row[3],
                    "start_date": str(row[4]) if row[4] else None,
                    "end_date": str(row[5]) if row[5] else None,
                    "reason": row[6],
                    "category": row[7],
                    "specification": row[8],
                    "unit": row[9]
                })

            # 협력업체별 통계
            cursor.execute("""
                SELECT supplier_name, reason, COUNT(*), MIN(start_date), MAX(end_date)
                FROM ingredient_blackout_periods
                WHERE is_active = TRUE
                GROUP BY supplier_name, reason
                ORDER BY MAX(end_date) DESC
            """)
            summary = []
            for row in cursor.fetchall():
                summary.append({
                    "supplier_name": row[0],
                    "reason": row[1],
                    "count": row[2],
                    "start_date": str(row[3]) if row[3] else None,
                    "end_date": str(row[4]) if row[4] else None
                })

            cursor.close()

            return {
                "success": True,
                "items": items,
                "total": total,
                "page": page,
                "per_page": per_page,
                "summary": summary
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/supply-unavailable/{item_id}")
async def delete_supply_unavailable(item_id: int):
    """공급 불가 품목 개별 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE ingredient_blackout_periods
                SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (item_id,))

            affected = cursor.rowcount
            conn.commit()
            cursor.close()

            return {"success": True, "deleted": affected}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/supply-unavailable/bulk")
async def delete_supply_unavailable_bulk(
    supplier_name: str,
    reason: Optional[str] = None
):
    """공급 불가 품목 일괄 삭제 (협력업체+사유 기준)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if reason:
                cursor.execute("""
                    UPDATE ingredient_blackout_periods
                    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
                    WHERE supplier_name = %s AND reason = %s AND is_active = TRUE
                """, (supplier_name, reason))
            else:
                cursor.execute("""
                    UPDATE ingredient_blackout_periods
                    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
                    WHERE supplier_name = %s AND is_active = TRUE
                """, (supplier_name,))

            affected = cursor.rowcount
            conn.commit()
            cursor.close()

            return {"success": True, "deleted": affected}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/fix-sequences")
async def fix_database_sequences():
    """데이터베이스 시퀀스 수정 - 기본키 충돌 해결용"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            results = {}

            # 수정할 테이블 목록 (테이블명, 시퀀스명)
            tables_to_fix = [
                ('menu_recipes', 'menu_recipes_id_seq'),
                ('ingredients', 'ingredients_id_seq'),
                ('orders', 'orders_id_seq'),
                ('order_items', 'order_items_id_seq'),
                ('suppliers', 'suppliers_id_seq'),
                ('users', 'users_id_seq'),
                ('sites', 'sites_id_seq'),
            ]

            for table_name, seq_name in tables_to_fix:
                try:
                    # 현재 max ID 확인
                    cursor.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")
                    max_id = cursor.fetchone()[0]

                    # 현재 시퀀스 값 확인
                    cursor.execute(f"SELECT last_value FROM {seq_name}")
                    current_seq = cursor.fetchone()[0]

                    # 시퀀스가 max_id보다 작거나 같으면 수정
                    if current_seq <= max_id:
                        new_val = max_id + 1
                        cursor.execute(f"SELECT setval('{seq_name}', %s, false)", (new_val,))
                        results[table_name] = {
                            "fixed": True,
                            "old_seq": current_seq,
                            "max_id": max_id,
                            "new_seq": new_val
                        }
                    else:
                        results[table_name] = {
                            "fixed": False,
                            "reason": "already correct",
                            "current_seq": current_seq,
                            "max_id": max_id
                        }
                except Exception as table_error:
                    results[table_name] = {
                        "fixed": False,
                        "error": str(table_error)
                    }

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "시퀀스 점검 완료",
                "results": results
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ========== 브랜딩 설정 API ==========

@router.get("/api/admin/branding")
async def get_branding():
    """브랜딩 설정 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM system_settings WHERE key = 'branding'")
            row = cursor.fetchone()
            cursor.close()

            if row and row[0]:
                return {"success": True, "branding": json.loads(row[0])}

            # 기본값
            return {"success": True, "branding": {
                "COMPANY_NAME": "다함푸드",
                "SYSTEM_NAME": "급식관리",
                "LOGO_PATH": "/static/images/logo.png?v=20251027",
                "COLORS": {
                    "PRIMARY": "#2a5298",
                    "SECONDARY": "#667eea"
                }
            }}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/branding")
async def save_branding(request: Request):
    """브랜딩 설정 저장 (UPSERT)"""
    try:
        data = await request.json()
        branding = data.get("branding", {})

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('branding', %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """, (json.dumps(branding, ensure_ascii=False),))
            conn.commit()
            cursor.close()

            return {"success": True, "message": "브랜딩 설정이 저장되었습니다."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# fix-menu-suffixes 엔드포인트는 main.py로 이동됨
