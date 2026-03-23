#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Site Structure Router
사업장 계층 구조 관리 API (그룹 > 카테고리 > 사업장)
"""

from fastapi import APIRouter, Request, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from core.database import get_db_connection
from datetime import datetime
import json

router = APIRouter()


# ============================================
# Pydantic Models
# ============================================

class GroupCreate(BaseModel):
    group_code: str
    group_name: str
    description: Optional[str] = None
    display_order: Optional[int] = 0


class GroupUpdate(BaseModel):
    group_name: Optional[str] = None
    description: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryCreate(BaseModel):
    category_code: str
    category_name: str
    meal_types: Optional[List[str]] = ["조식", "중식", "석식", "야식", "행사"]
    meal_items: Optional[List[str]] = ["일반"]
    display_order: Optional[int] = 0
    modified_by: Optional[str] = None  # 수정자 추적


class CategoryUpdate(BaseModel):
    category_name: Optional[str] = None
    meal_types: Optional[List[str]] = None
    meal_items: Optional[List[str]] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None
    modified_by: Optional[str] = None  # 수정자 추적


class SiteUpdate(BaseModel):
    site_name: Optional[str] = None
    group_id: Optional[int] = None
    category_id: Optional[int] = None
    site_type: Optional[str] = None
    region: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    manager_name: Optional[str] = None
    manager_phone: Optional[str] = None
    is_active: Optional[bool] = None  # boolean으로 변경
    display_order: Optional[int] = None
    abbreviation: Optional[str] = None  # 약어 필드 추가
    has_categories: Optional[bool] = None  # 카테고리 여부 필드 추가


class SiteAssignmentCreate(BaseModel):
    site_id: int
    group_id: int
    category_id: int
    meal_slot: str
    menu_type: Optional[str] = "일반"
    display_order: Optional[int] = 0


class SiteAssignmentUpdate(BaseModel):
    site_id: Optional[int] = None
    group_id: Optional[int] = None
    category_id: Optional[int] = None
    meal_slot: Optional[str] = None
    menu_type: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None
    target_cost: Optional[int] = None
    selling_price: Optional[int] = None


# ============================================
# 그룹 (Groups) API
# ============================================

@router.get("/api/admin/groups")
async def get_groups():
    """그룹 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    id, group_code, group_name, description,
                    display_order, is_active, created_at, updated_at,
                    (SELECT COUNT(*) FROM site_categories WHERE group_id = site_groups.id) as category_count,
                    (SELECT COUNT(*) FROM business_locations WHERE group_id = site_groups.id) as site_count
                FROM site_groups
                ORDER BY display_order, id
            """)

            columns = [desc[0] for desc in cursor.description]
            groups = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # datetime 직렬화
            for group in groups:
                if group.get('created_at'):
                    group['created_at'] = group['created_at'].isoformat()
                if group.get('updated_at'):
                    group['updated_at'] = group['updated_at'].isoformat()

            cursor.close()

            return {"success": True, "data": groups, "total": len(groups)}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.get("/api/admin/groups/{group_id}")
async def get_group(group_id: int):
    """그룹 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    id, group_code, group_name, description,
                    display_order, is_active, created_at, updated_at
                FROM site_groups
                WHERE id = %s
            """, (group_id,))

            row = cursor.fetchone()
            if not row:
                cursor.close()
                return {"success": False, "error": "그룹을 찾을 수 없습니다"}

            columns = [desc[0] for desc in cursor.description]
            group = dict(zip(columns, row))

            # 카테고리 목록 포함
            cursor.execute("""
                SELECT id, category_code, category_name, meal_types, meal_items, display_order, is_active
                FROM site_categories
                WHERE group_id = %s
                ORDER BY display_order
            """, (group_id,))

            cat_columns = [desc[0] for desc in cursor.description]
            group['categories'] = [dict(zip(cat_columns, row)) for row in cursor.fetchall()]

            cursor.close()

            # datetime 직렬화
            if group.get('created_at'):
                group['created_at'] = group['created_at'].isoformat()
            if group.get('updated_at'):
                group['updated_at'] = group['updated_at'].isoformat()

            return {"success": True, "data": group}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.post("/api/admin/groups")
async def create_group(group: GroupCreate):
    """그룹 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO site_groups (group_code, group_name, description, display_order)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (group.group_code, group.group_name, group.description, group.display_order))

            new_id = cursor.fetchone()[0]
            conn.commit()

            cursor.close()

            return {"success": True, "data": {"id": new_id}, "message": "그룹이 생성되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/groups/{group_id}")
async def update_group(group_id: int, group: GroupUpdate):
    """그룹 수정"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 동적 UPDATE 쿼리 생성
            updates = []
            values = []

            if group.group_name is not None:
                updates.append("group_name = %s")
                values.append(group.group_name)
            if group.description is not None:
                updates.append("description = %s")
                values.append(group.description)
            if group.display_order is not None:
                updates.append("display_order = %s")
                values.append(group.display_order)
            if group.is_active is not None:
                updates.append("is_active = %s")
                values.append(group.is_active)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(group_id)

            cursor.execute(f"""
                UPDATE site_groups
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            conn.commit()
            cursor.close()

            return {"success": True, "message": "그룹이 수정되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/groups/{group_id}")
async def delete_group(group_id: int):
    """그룹 삭제 (CASCADE로 하위 카테고리도 삭제됨)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장이 연결되어 있는지 확인
            cursor.execute("SELECT COUNT(*) FROM business_locations WHERE group_id = %s", (group_id,))
            site_count = cursor.fetchone()[0]

            if site_count > 0:
                cursor.close()
                return {"success": False, "error": f"이 그룹에 {site_count}개의 사업장이 연결되어 있습니다. 먼저 사업장을 이동하세요."}

            cursor.execute("DELETE FROM site_groups WHERE id = %s", (group_id,))
            conn.commit()

            cursor.close()

            return {"success": True, "message": "그룹이 삭제되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/groups/reorder")
async def reorder_groups(request: Request):
    """그룹 순서 변경"""
    try:
        data = await request.json()
        order_list = data.get('order', [])  # [{"id": 1, "order": 0}, {"id": 2, "order": 1}]

        with get_db_connection() as conn:
            cursor = conn.cursor()

            for item in order_list:
                cursor.execute("""
                    UPDATE site_groups SET display_order = %s WHERE id = %s
                """, (item['order'], item['id']))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "순서가 변경되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 카테고리 (Categories) API
# ============================================

@router.get("/api/admin/groups/{group_id}/categories")
async def get_categories(group_id: int):
    """그룹 내 카테고리 목록"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    sc.id, sc.category_code, sc.category_name,
                    sc.meal_types, sc.meal_items, sc.display_order, sc.is_active,
                    sc.created_at, sc.updated_at,
                    (SELECT COUNT(*) FROM business_locations WHERE category_id = sc.id) as site_count
                FROM site_categories sc
                WHERE sc.group_id = %s
                ORDER BY sc.display_order
            """, (group_id,))

            columns = [desc[0] for desc in cursor.description]
            categories = [dict(zip(columns, row)) for row in cursor.fetchall()]

            for cat in categories:
                if cat.get('created_at'):
                    cat['created_at'] = cat['created_at'].isoformat()
                if cat.get('updated_at'):
                    cat['updated_at'] = cat['updated_at'].isoformat()

            cursor.close()

            return {"success": True, "data": categories, "total": len(categories)}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.post("/api/admin/groups/{group_id}/categories")
async def create_category(group_id: int, category: CategoryCreate):
    """카테고리 생성 - 위탁사업장 그룹인 경우 business_location도 자동 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 정보 조회 (위탁사업장 그룹인지 확인)
            cursor.execute("SELECT group_code FROM site_groups WHERE id = %s", (group_id,))
            group_row = cursor.fetchone()
            is_consignment_group = group_row and group_row[0] == 'Meal'

            # 카테고리 생성
            cursor.execute("""
                INSERT INTO site_categories (group_id, category_code, category_name, meal_types, meal_items, display_order, modified_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                group_id,
                category.category_code,
                category.category_name,
                json.dumps(category.meal_types, ensure_ascii=False),
                json.dumps(category.meal_items, ensure_ascii=False),
                category.display_order,
                category.modified_by
            ))

            new_category_id = cursor.fetchone()[0]

            # 위탁사업장 그룹인 경우 business_location도 자동 생성
            site_id = None
            if is_consignment_group:
                # 고유한 site_code 생성 (CONS + category_code)
                site_code = f"CONS_{category.category_code}"

                cursor.execute("""
                    INSERT INTO business_locations (site_code, site_name, site_type, group_id, category_id, is_active)
                    VALUES (%s, %s, %s, %s, %s, 1)
                    RETURNING id
                """, (
                    site_code,
                    category.category_name,
                    '위탁급식',
                    group_id,
                    new_category_id
                ))
                site_id = cursor.fetchone()[0]

            # 기본 끼니구분 자동 생성 (위탁사업장 그룹이 아닌 경우만)
            if not is_consignment_group:
                default_slots = [
                    ("조식", 1),
                    ("중식", 2),
                    ("석식", 3),
                ]
                for slot_name, sort_order in default_slots:
                    slot_key = f"cat{new_category_id}_slot{sort_order}"
                    cursor.execute("""
                        INSERT INTO meal_slot_settings (slot_key, display_name, sort_order, entity_type, entity_id, is_active)
                        VALUES (%s, %s, %s, 'category', %s, TRUE)
                        ON CONFLICT (slot_key, entity_type, entity_id) DO NOTHING
                    """, (slot_key, slot_name, sort_order, new_category_id))

            conn.commit()

            cursor.close()

            result_data = {"id": new_category_id}
            if site_id:
                result_data["site_id"] = site_id

            return {"success": True, "data": result_data, "message": "카테고리가 생성되었습니다 (기본 끼니구분 포함)"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/categories/{category_id}")
async def update_category(category_id: int, category: CategoryUpdate):
    """카테고리 수정"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ H-8: 카테고리명 변경 시 기존 이름 조회 (meal_counts 동기화용)
            old_category_name = None
            if category.category_name is not None:
                cursor.execute("SELECT category_name FROM site_categories WHERE id = %s", (category_id,))
                old_row = cursor.fetchone()
                old_category_name = old_row[0] if old_row else None

            updates = []
            values = []

            if category.category_name is not None:
                updates.append("category_name = %s")
                values.append(category.category_name)
            if category.meal_types is not None:
                updates.append("meal_types = %s")
                values.append(json.dumps(category.meal_types, ensure_ascii=False))
            if category.meal_items is not None:
                updates.append("meal_items = %s")
                values.append(json.dumps(category.meal_items, ensure_ascii=False))
            if category.display_order is not None:
                updates.append("display_order = %s")
                values.append(category.display_order)
            if category.is_active is not None:
                updates.append("is_active = %s")
                values.append(category.is_active)
            # ★ 수정자 추적
            if category.modified_by is not None:
                updates.append("modified_by = %s")
                values.append(category.modified_by)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(category_id)

            cursor.execute(f"""
                UPDATE site_categories
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            # ★ H-8: 카테고리명 변경 시 meal_counts 동기화
            meal_counts_synced = 0
            if category.category_name is not None and old_category_name and category.category_name != old_category_name:
                cursor.execute("""
                    UPDATE meal_counts
                    SET category = %s, business_type = %s
                    WHERE category = %s OR business_type = %s
                """, (category.category_name, category.category_name, old_category_name, old_category_name))
                meal_counts_synced = cursor.rowcount
                if meal_counts_synced > 0:
                    print(f"[API] 카테고리명 변경 → meal_counts {meal_counts_synced}건 동기화: {old_category_name} → {category.category_name}")

            conn.commit()
            cursor.close()

            msg = "카테고리가 수정되었습니다"
            if meal_counts_synced > 0:
                msg += f" (meal_counts {meal_counts_synced}건 동기화)"

            return {"success": True, "message": msg}

    except Exception as e:
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


@router.delete("/api/admin/categories/{category_id}")
async def delete_category(category_id: int):
    """카테고리 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장이 연결되어 있는지 확인
            cursor.execute("SELECT COUNT(*) FROM business_locations WHERE category_id = %s", (category_id,))
            site_count = cursor.fetchone()[0]

            if site_count > 0:
                cursor.close()
                return {"success": False, "error": f"이 카테고리에 {site_count}개의 사업장이 연결되어 있습니다"}

            # 연결된 끼니구분(meal_slot_settings) 먼저 삭제
            cursor.execute("""
                DELETE FROM meal_slot_settings
                WHERE entity_type = 'category' AND entity_id = %s
            """, (category_id,))
            deleted_slots = cursor.rowcount

            cursor.execute("DELETE FROM site_categories WHERE id = %s", (category_id,))
            conn.commit()

            cursor.close()

            msg = "카테고리가 삭제되었습니다"
            if deleted_slots > 0:
                msg += f" (연결된 끼니구분 {deleted_slots}개도 함께 삭제됨)"
            return {"success": True, "message": msg}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/categories/{category_id}/meal-settings")
async def update_meal_settings(category_id: int, request: Request):
    """카테고리 식사 구분/항목 설정"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            updates = []
            values = []

            if 'meal_types' in data:
                updates.append("meal_types = %s")
                values.append(json.dumps(data['meal_types'], ensure_ascii=False))
            if 'meal_items' in data:
                updates.append("meal_items = %s")
                values.append(json.dumps(data['meal_items'], ensure_ascii=False))

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(category_id)

            cursor.execute(f"""
                UPDATE site_categories
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            conn.commit()
            cursor.close()

            return {"success": True, "message": "식사 설정이 저장되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 사업장 (Sites) API - 계층 정보 포함
# ============================================

@router.get("/api/admin/sites")
async def get_sites(
    group_id: Optional[int] = None,
    category_id: Optional[int] = None,
    is_active: Optional[int] = None,
    search: Optional[str] = None
):
    """사업장 목록 - 그룹(본사, 영남지사) + 위탁사업장 단위로 반환

    올바른 사업장 범위:
    - 본사, 영남지사 (site_groups)
    - 군위복지관, 아이팜코리아, 모레코리아 등 위탁사업장 (site_categories where group_code='Meal')
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            sites = []

            # 1. site_groups에서 본사, 영남지사 등 그룹 가져오기 (위탁사업장 그룹 제외)
            # business_locations의 management 사이트 ID와 주소 정보를 함께 조회
            # 거래종료일이 지난 사업장은 제외
            group_query = """
                SELECT sg.id, sg.group_code, sg.group_name, sg.display_order, sg.is_active,
                       bl.id as business_location_id,
                       bl.address as bl_address, bl.region as bl_region, bl.phone as bl_phone,
                       bl.manager_name as bl_manager, bl.manager_phone as bl_manager_phone,
                       bl.contract_end_date
                FROM site_groups sg
                LEFT JOIN business_locations bl ON bl.group_id = sg.id AND bl.business_category IN ('management', 'legacy')
                WHERE sg.group_code != 'Meal'
            """
            group_params = []
            if group_id:
                group_query += " AND sg.id = %s"
                group_params.append(group_id)
            if is_active is not None:
                group_query += " AND sg.is_active = %s"
                group_params.append(is_active)
            if search:
                group_query += " AND sg.group_name ILIKE %s"
                group_params.append(f"%{search}%")
            group_query += " ORDER BY sg.display_order"

            cursor.execute(group_query, group_params if group_params else None)
            for row in cursor.fetchall():
                # 거래종료일이 지난 사업장 제외
                if row[11] is not None and row[11] <= datetime.now().date():
                    continue
                # business_locations.id를 사용 (발주 등 FK 참조용)
                # 없으면 site_groups.id 사용 (하위 호환성)
                site_id = row[5] if row[5] else row[0]
                sites.append({
                    "id": site_id,
                    "site_code": row[1] or f"GRP_{row[0]:03d}",
                    "site_name": row[2],
                    "name": row[2],
                    "site_type": "그룹",
                    "type": "group",
                    "region": row[7] or "",
                    "address": row[6] or "",
                    "phone": row[8] or "",
                    "manager_name": row[9] or "",
                    "manager_phone": row[10] or "",
                    "is_active": bool(row[4]) if row[4] is not None else True,
                    "status": "active" if (row[4] is None or row[4]) else "inactive",
                    "source": "site_groups",
                    "group_id": row[0],
                    "business_location_id": row[5],  # 실제 business_locations.id
                    "category_id": None,
                    "display_order": row[3]
                })

            # 2. 위탁사업장 그룹의 카테고리들을 각각 사업장으로 가져오기
            # business_locations에서 주소 정보도 함께 조회
            # 거래종료일이 지난 사업장은 제외
            cat_query = """
                SELECT sc.id, sc.category_code, sc.category_name, sc.display_order, sc.is_active, sg.id as group_id,
                       bl.address as bl_address, bl.region as bl_region, bl.phone as bl_phone,
                       bl.manager_name as bl_manager, bl.manager_phone as bl_manager_phone,
                       bl.contract_end_date
                FROM site_categories sc
                JOIN site_groups sg ON sc.group_id = sg.id
                LEFT JOIN business_locations bl ON bl.category_id = sc.id
                WHERE sg.group_code = 'Meal'
            """
            cat_params = []
            if category_id:
                cat_query += " AND sc.id = %s"
                cat_params.append(category_id)
            if is_active is not None:
                cat_query += " AND sc.is_active = %s"
                cat_params.append(is_active)
            if search:
                cat_query += " AND sc.category_name ILIKE %s"
                cat_params.append(f"%{search}%")
            cat_query += " ORDER BY sc.display_order"

            cursor.execute(cat_query, cat_params if cat_params else None)
            for row in cursor.fetchall():
                # 거래종료일이 지난 사업장 제외
                if row[11] is not None and row[11] <= datetime.now().date():
                    continue
                sites.append({
                    "id": 1000 + row[0],  # 카테고리 ID에 1000 더해서 그룹 ID와 충돌 방지
                    "site_code": row[1] or f"CSG_{row[0]:03d}",
                    "site_name": row[2],
                    "name": row[2],
                    "site_type": "위탁",
                    "type": "consignment",
                    "region": row[7] or "",
                    "address": row[6] or "",
                    "phone": row[8] or "",
                    "manager_name": row[9] or "",
                    "manager_phone": row[10] or "",
                    "is_active": bool(row[4]) if row[4] is not None else True,
                    "status": "active" if (row[4] is None or row[4]) else "inactive",
                    "source": "site_categories",
                    "category_id": row[0],
                    "group_id": row[5],
                    "display_order": row[3]
                })

            # 3. business_locations는 중복 데이터이므로 제외
            # 원본 데이터는 site_groups와 site_categories에 있음

            cursor.close()

            # 활성/비활성 카운트
            active_count = sum(1 for s in sites if s["is_active"])

            return {
                "success": True,
                "data": sites,
                "sites": sites,
                "total": len(sites),
                "active_count": active_count,
                "inactive_count": len(sites) - active_count
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.post("/api/admin/sites")
async def create_site(request: Request):
    """새 사업장 추가 API"""
    try:
        body = await request.body()
        text = body.decode('utf-8')
        data = json.loads(text)

        # 필수 필드 검증
        site_name = (data.get('name') or '').strip()
        if not site_name:
            return {"success": False, "error": "사업장명은 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # site_code 자동 생성 (S + 6자리 숫자)
            cursor.execute("SELECT COALESCE(MAX(id), 0) FROM business_locations")
            max_id = cursor.fetchone()[0] or 0
            site_code = f"S{str(max_id + 1).zfill(6)}"

            # 데이터 준비
            site_type = (data.get('type') or '급식업체').strip()
            address = (data.get('address') or '').strip()
            manager_name = (data.get('manager_name') or '').strip()
            manager_phone = (data.get('contact_info') or '').strip()
            is_active = 1 if data.get('is_active', True) else 0
            group_id = data.get('group_id')
            category_id = data.get('category_id')

            # INSERT 쿼리 (business_locations 테이블)
            cursor.execute("""
                INSERT INTO business_locations (site_code, site_name, site_type, address, manager_name, manager_phone, is_active, group_id, category_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                RETURNING id, site_code
            """, (site_code, site_name, site_type, address, manager_name, manager_phone, is_active, group_id, category_id))

            result = cursor.fetchone()
            new_id = result[0]
            new_code = result[1]

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "사업장이 추가되었습니다",
                "site": {
                    "id": new_id,
                    "site_code": new_code,
                    "site_name": site_name
                }
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 사업장-협력업체 매핑 API (sites/{site_id} 보다 먼저 정의되어야 함)
# ============================================

@router.get("/api/admin/sites/{site_id}/suppliers")
async def get_site_suppliers(site_id: int):
    """사업장에 매핑된 협력업체 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장에 매핑된 협력업체 목록 조회
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
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/sites/{site_id}/suppliers")
async def update_site_suppliers_mapping(site_id: int, request: Request):
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

            # 기존 매핑 삭제 (원래 site_id로 삭제 - 기존 데이터 호환)
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


# admin.py에서 처리 (더 유연한 JSON 파싱 지원)
# @router.put("/api/admin/sites/{site_id}")
async def update_site_disabled(site_id: int, site: SiteUpdate):
    """사업장 정보 수정 - admin.py로 이동됨"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            updates = []
            values = []

            if site.site_name is not None:
                updates.append("site_name = %s")
                values.append(site.site_name)
            if site.group_id is not None:
                updates.append("group_id = %s")
                values.append(site.group_id)
            if site.category_id is not None:
                updates.append("category_id = %s")
                values.append(site.category_id)
            if site.site_type is not None:
                updates.append("site_type = %s")
                values.append(site.site_type)
            if site.region is not None:
                updates.append("region = %s")
                values.append(site.region)
            if site.address is not None:
                updates.append("address = %s")
                values.append(site.address)
            if site.phone is not None:
                updates.append("phone = %s")
                values.append(site.phone)
            if site.manager_name is not None:
                updates.append("manager_name = %s")
                values.append(site.manager_name)
            if site.manager_phone is not None:
                updates.append("manager_phone = %s")
                values.append(site.manager_phone)
            if site.is_active is not None:
                updates.append("is_active = %s")
                values.append(site.is_active)
            if site.display_order is not None:
                updates.append("display_order = %s")
                values.append(site.display_order)
            if site.abbreviation is not None:
                updates.append("abbreviation = %s")
                values.append(site.abbreviation)
            if site.has_categories is not None:
                updates.append("has_categories = %s")
                values.append(site.has_categories)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(site_id)

            cursor.execute(f"""
                UPDATE business_locations
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            conn.commit()
            cursor.close()

            return {"success": True, "message": "사업장이 수정되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 전체 계층 트리 API
# ============================================

# 구조 트리 캐시 (5분 TTL)
_structure_tree_cache = None
_structure_tree_cache_time = 0
STRUCTURE_CACHE_TTL = 300  # 5분


@router.get("/api/admin/structure/tree")
async def get_structure_tree(refresh: Optional[int] = None):
    """전체 계층 구조 트리 - 캐싱 적용 (refresh=1로 캐시 무효화)"""
    import time
    global _structure_tree_cache, _structure_tree_cache_time

    # refresh=1이면 캐시 무효화
    if refresh == 1:
        _structure_tree_cache = None
        _structure_tree_cache_time = 0

    # 캐시 확인
    if _structure_tree_cache and (time.time() - _structure_tree_cache_time) < STRUCTURE_CACHE_TTL:
        return _structure_tree_cache

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 조회
            # 그룹 조회 (본사, 영남지사 등 - business_locations에서 주소, abbreviation 가져오기)
            # 거래종료일이 지난 사업장은 제외
            cursor.execute("""
                SELECT sg.id, sg.group_code, sg.group_name, sg.display_order, sg.is_active,
                       bl.address, bl.region, bl.abbreviation, bl.contract_end_date
                FROM site_groups sg
                LEFT JOIN business_locations bl ON bl.group_id = sg.id AND bl.business_category IN ('management', 'legacy')
                WHERE sg.is_active = TRUE
                ORDER BY sg.display_order
            """)
            groups = {}
            for row in cursor.fetchall():
                if row[0] in groups:
                    continue
                # 거래종료일이 지난 사업장 제외
                if row[8] is not None and row[8] <= datetime.now().date():
                    continue
                groups[row[0]] = {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "order": row[3],
                    "address": row[5] or "",
                    "region": row[6] or "",
                    "abbreviation": row[7] or "",
                    "categories": []
                }

            # 카테고리 조회
            # 카테고리 조회 (위탁급식 사업장 - business_locations에서 주소, abbreviation 가져오기)
            # 거래종료일이 지난 사업장은 제외
            cursor.execute("""
                SELECT sc.id, sc.group_id, sc.category_code, sc.category_name,
                       sc.meal_types, sc.meal_items, sc.display_order, sc.is_active,
                       bl.address, bl.region, bl.abbreviation, bl.contract_end_date
                FROM site_categories sc
                LEFT JOIN business_locations bl ON bl.category_id = sc.id
                WHERE sc.is_active = TRUE
                ORDER BY sc.display_order
            """)
            categories = {}
            for row in cursor.fetchall():
                cat_id, group_id, code, name, meal_types, meal_items, order, active, address, region, abbreviation, contract_end = row
                # 이미 처리된 카테고리는 스킵 (LEFT JOIN으로 중복 행 발생 방지)
                if cat_id in categories:
                    continue
                # 거래종료일이 지난 사업장 제외
                if contract_end is not None and contract_end <= datetime.now().date():
                    continue
                cat = {
                    "id": cat_id,
                    "code": code,
                    "name": name,
                    "mealTypes": meal_types if isinstance(meal_types, list) else json.loads(meal_types or '[]'),
                    "mealItems": meal_items if isinstance(meal_items, list) else json.loads(meal_items or '[]'),
                    "order": order,
                    "address": address or "",
                    "region": region or "",
                    "abbreviation": abbreviation or "",
                    "sites": []
                }
                categories[cat_id] = cat
                if group_id in groups:
                    groups[group_id]["categories"].append(cat)

            # 사업장 조회 (거래종료일이 지난 사업장 제외)
            cursor.execute("""
                SELECT id, site_code, site_name, category_id, group_id, display_order, is_active
                FROM business_locations
                WHERE is_active = true
                  AND (contract_end_date IS NULL OR contract_end_date > CURRENT_DATE)
                ORDER BY display_order
            """)
            for row in cursor.fetchall():
                site_id, code, name, cat_id, group_id, order, active = row
                site = {
                    "id": site_id,
                    "code": code,
                    "name": name,
                    "order": order
                }
                if cat_id in categories:
                    categories[cat_id]["sites"].append(site)

            cursor.close()

            result = {
                "success": True,
                "data": list(groups.values())
            }

            # 캐시 저장
            _structure_tree_cache = result
            _structure_tree_cache_time = time.time()

            return result

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 카테고리 목록 (전체)
# ============================================

@router.get("/api/admin/categories")
async def get_all_categories():
    """전체 카테고리 목록"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    sc.id, sc.group_id, sc.category_code, sc.category_name,
                    sc.meal_types, sc.meal_items, sc.display_order, sc.is_active,
                    sg.group_name
                FROM site_categories sc
                LEFT JOIN site_groups sg ON sc.group_id = sg.id
                ORDER BY sg.display_order, sc.display_order
            """)

            columns = [desc[0] for desc in cursor.description]
            categories = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {"success": True, "data": categories, "total": len(categories)}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


# ============================================
# 사업장 배치 (Site Assignments) API
# ============================================

@router.get("/api/admin/site-assignments")
async def get_site_assignments(
    group_id: Optional[int] = None,
    category_id: Optional[int] = None,
    site_id: Optional[int] = None,
    meal_slot: Optional[str] = None,
    is_active: Optional[bool] = None
):
    """사업장 배치 목록 조회 (필터 지원)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    sa.id, sa.site_id, sa.group_id, sa.category_id,
                    sa.meal_slot, sa.menu_type, sa.display_order, sa.is_active,
                    sa.created_at, sa.updated_at,
                    bl.site_name, bl.site_code,
                    sg.group_name, sg.group_code,
                    sc.category_name, sc.category_code
                FROM site_assignments sa
                JOIN business_locations bl ON sa.site_id = bl.id
                JOIN site_groups sg ON sa.group_id = sg.id
                JOIN site_categories sc ON sa.category_id = sc.id
                WHERE 1=1
            """
            params = []

            if group_id is not None:
                query += " AND sa.group_id = %s"
                params.append(group_id)
            if category_id is not None:
                query += " AND sa.category_id = %s"
                params.append(category_id)
            if site_id is not None:
                query += " AND sa.site_id = %s"
                params.append(site_id)
            if meal_slot is not None:
                query += " AND sa.meal_slot = %s"
                params.append(meal_slot)
            if is_active is not None:
                query += " AND sa.is_active = %s"
                params.append(is_active)

            query += " ORDER BY sg.display_order, sc.display_order, sa.meal_slot, sa.display_order"

            cursor.execute(query, params if params else None)

            columns = [desc[0] for desc in cursor.description]
            assignments = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # datetime 직렬화
            for item in assignments:
                if item.get('created_at'):
                    item['created_at'] = item['created_at'].isoformat()
                if item.get('updated_at'):
                    item['updated_at'] = item['updated_at'].isoformat()

            cursor.close()

            return {"success": True, "data": assignments, "total": len(assignments)}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.get("/api/admin/site-assignments/tree")
async def get_site_assignments_tree():
    """사업장 배치를 계층 트리 구조로 반환

    구조: 그룹 > 카테고리 > 식사구분 > 사업장
    예: 본사 > 운반 > 중식 > [화성대구, 대구지하철, ...]
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 조회 (Meal 제외 - 위탁사업장은 별도 관리)
            cursor.execute("""
                SELECT id, group_code, group_name, display_order
                FROM site_groups
                WHERE is_active = TRUE AND group_code != 'Meal'
                ORDER BY display_order
            """)
            groups = []
            for row in cursor.fetchall():
                groups.append({
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "order": row[3],
                    "categories": []
                })

            # 카테고리 조회
            cursor.execute("""
                SELECT id, group_id, category_code, category_name, display_order
                FROM site_categories
                WHERE is_active = TRUE
                ORDER BY display_order
            """)
            cat_map = {}
            for row in cursor.fetchall():
                cat_id, group_id, code, name, order = row
                cat_map[cat_id] = {
                    "id": cat_id,
                    "group_id": group_id,
                    "code": code,
                    "name": name,
                    "order": order,
                    "meal_slots": {}
                }

            # 배치 조회
            cursor.execute("""
                SELECT
                    sa.id, sa.site_id, sa.group_id, sa.category_id,
                    sa.meal_slot, sa.menu_type, sa.display_order, sa.is_active,
                    bl.site_name, bl.site_code,
                    sa.target_cost, sa.selling_price
                FROM site_assignments sa
                JOIN business_locations bl ON sa.site_id = bl.id
                WHERE sa.is_active = TRUE
                ORDER BY sa.group_id, sa.category_id, sa.meal_slot, sa.display_order
            """)

            for row in cursor.fetchall():
                assign_id, site_id, group_id, cat_id, meal_slot, menu_type, order, active, site_name, site_code, target_cost, selling_price = row

                if cat_id not in cat_map:
                    continue

                if meal_slot not in cat_map[cat_id]["meal_slots"]:
                    cat_map[cat_id]["meal_slots"][meal_slot] = []

                cat_map[cat_id]["meal_slots"][meal_slot].append({
                    "assignment_id": assign_id,
                    "site_id": site_id,
                    "site_name": site_name,
                    "site_code": site_code,
                    "menu_type": menu_type,
                    "order": order,
                    "target_cost": target_cost or 0,
                    "selling_price": selling_price or 0
                })

            # 그룹에 카테고리 연결
            for cat_id, cat in cat_map.items():
                group_id = cat["group_id"]
                for group in groups:
                    if group["id"] == group_id:
                        # meal_slots를 리스트로 변환
                        cat_copy = {
                            "id": cat["id"],
                            "code": cat["code"],
                            "name": cat["name"],
                            "order": cat["order"],
                            "meal_slots": [
                                {"slot": slot, "sites": sites}
                                for slot, sites in cat["meal_slots"].items()
                            ]
                        }
                        group["categories"].append(cat_copy)
                        break

            cursor.close()

            return {"success": True, "data": groups}

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}


@router.post("/api/admin/site-assignments")
async def create_site_assignment(assignment: SiteAssignmentCreate):
    """사업장 배치 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 중복 확인
            cursor.execute("""
                SELECT id FROM site_assignments
                WHERE site_id = %s AND group_id = %s AND category_id = %s
                      AND meal_slot = %s AND menu_type = %s
            """, (assignment.site_id, assignment.group_id, assignment.category_id,
                  assignment.meal_slot, assignment.menu_type))

            if cursor.fetchone():
                cursor.close()
                return {"success": False, "error": "이미 동일한 배치가 존재합니다"}

            cursor.execute("""
                INSERT INTO site_assignments (site_id, group_id, category_id, meal_slot, menu_type, display_order)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (assignment.site_id, assignment.group_id, assignment.category_id,
                  assignment.meal_slot, assignment.menu_type, assignment.display_order))

            new_id = cursor.fetchone()[0]
            conn.commit()

            cursor.close()

            return {"success": True, "data": {"id": new_id}, "message": "배치가 생성되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.put("/api/admin/site-assignments/{assignment_id}")
async def update_site_assignment(assignment_id: int, assignment: SiteAssignmentUpdate):
    """사업장 배치 수정"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            updates = []
            values = []

            if assignment.site_id is not None:
                updates.append("site_id = %s")
                values.append(assignment.site_id)
            if assignment.group_id is not None:
                updates.append("group_id = %s")
                values.append(assignment.group_id)
            if assignment.category_id is not None:
                updates.append("category_id = %s")
                values.append(assignment.category_id)
            if assignment.meal_slot is not None:
                updates.append("meal_slot = %s")
                values.append(assignment.meal_slot)
            if assignment.menu_type is not None:
                updates.append("menu_type = %s")
                values.append(assignment.menu_type)
            if assignment.display_order is not None:
                updates.append("display_order = %s")
                values.append(assignment.display_order)
            if assignment.is_active is not None:
                updates.append("is_active = %s")
                values.append(assignment.is_active)
            if assignment.target_cost is not None:
                updates.append("target_cost = %s")
                values.append(assignment.target_cost)
            if assignment.selling_price is not None:
                updates.append("selling_price = %s")
                values.append(assignment.selling_price)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(assignment_id)

            cursor.execute(f"""
                UPDATE site_assignments
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            conn.commit()
            cursor.close()

            return {"success": True, "message": "배치가 수정되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/site-assignments/{assignment_id}")
async def delete_site_assignment(assignment_id: int):
    """사업장 배치 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM site_assignments WHERE id = %s", (assignment_id,))

            if cursor.rowcount == 0:
                cursor.close()
                return {"success": False, "error": "배치를 찾을 수 없습니다"}

            conn.commit()
            cursor.close()

            return {"success": True, "message": "배치가 삭제되었습니다"}

    except Exception as e:
        try:
            if 'conn' in locals() and conn: conn.rollback()
        except: pass
        finally:
            try:
                if 'cursor' in locals() and cursor: cursor.close()
            except: pass
        return {"success": False, "error": str(e)}


@router.get("/api/admin/site-assignments/available-sites")
async def get_available_sites_for_assignment():
    """배치 가능한 사업장 목록 (본사/영남지사 소속 사업장들)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # business_locations에서 위탁급식(Meal 그룹) 제외한 사업장들 (거래종료 제외)
            cursor.execute("""
                SELECT bl.id, bl.site_code, bl.site_name, bl.site_type,
                       sg.group_name, sc.category_name
                FROM business_locations bl
                LEFT JOIN site_groups sg ON bl.group_id = sg.id
                LEFT JOIN site_categories sc ON bl.category_id = sc.id
                WHERE bl.is_active = true
                  AND (sg.group_code IS NULL OR sg.group_code != 'Meal')
                  AND (bl.contract_end_date IS NULL OR bl.contract_end_date > CURRENT_DATE)
                ORDER BY sg.display_order, sc.display_order, bl.site_name
            """)

            sites = []
            for row in cursor.fetchall():
                sites.append({
                    "id": row[0],
                    "site_code": row[1],
                    "site_name": row[2],
                    "site_type": row[3],
                    "group_name": row[4] or "미분류",
                    "category_name": row[5] or ""
                })

            cursor.close()

            return {"success": True, "data": sites, "total": len(sites)}

    except Exception as e:
        try:
            if 'cursor' in locals() and cursor: cursor.close()
        except: pass
        return {"success": False, "error": str(e)}
