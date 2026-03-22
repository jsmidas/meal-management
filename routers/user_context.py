#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
User Context Router
사용자별 사업장 접근 권한 및 컨텍스트 관리 API
"""

from fastapi import APIRouter, Request, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from core.database import get_db_connection
import json

router = APIRouter()


# ============================================
# Pydantic Models
# ============================================

class ContextSelect(BaseModel):
    group_id: Optional[int] = None
    category_id: Optional[int] = None
    site_id: Optional[int] = None


class UserSiteAccessCreate(BaseModel):
    user_id: int
    site_id: Optional[int] = None
    group_id: Optional[int] = None
    role: str
    permissions: Optional[dict] = {}
    is_default: Optional[bool] = False


class UserSiteAccessUpdate(BaseModel):
    role: Optional[str] = None
    permissions: Optional[dict] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


# ============================================
# 역할 및 권한 정의
# ============================================

ROLES = {
    'super_admin': {
        'name': '슈퍼관리자',
        'level': 0,
        'permissions': ['*']
    },
    'group_admin': {
        'name': '그룹관리자',
        'level': 1,
        'permissions': ['group.*', 'site.*', 'user.manage', 'order.approve', 'recipe.approve']
    },
    'site_manager': {
        'name': '사업장관리자',
        'level': 2,
        'permissions': ['site.read', 'site.write', 'order.request', 'recipe.edit', 'meal_plan.edit']
    },
    'nutritionist': {
        'name': '영양사',
        'level': 3,
        'permissions': ['recipe.read', 'recipe.edit', 'meal_plan.read', 'meal_plan.edit', 'ingredient.read']
    },
    'chef': {
        'name': '조리사',
        'level': 3,
        'permissions': ['recipe.read', 'meal_plan.read', 'receiving.confirm', 'inventory.read']
    },
    'orderer': {
        'name': '발주담당',
        'level': 3,
        'permissions': ['order.read', 'order.request', 'ingredient.read', 'inventory.read']
    },
    'accountant': {
        'name': '회계담당',
        'level': 4,
        'permissions': ['report.read', 'cost.read', 'order.read']
    },
    'quality_manager': {
        'name': '품질관리자',
        'level': 3,
        'permissions': ['quality.read', 'quality.edit', 'receiving.inspect', 'inventory.read']
    },
    'viewer': {
        'name': '조회전용',
        'level': 5,
        'permissions': ['*.read']
    }
}


# ============================================
# 사용자 접근 가능 구조 API
# ============================================

@router.get("/api/user/accessible-structure")
async def get_accessible_structure(request: Request):
    """현재 사용자가 접근 가능한 그룹/카테고리/사업장 트리"""
    try:
        # 사용자 ID 추출 (실제로는 JWT 토큰에서)
        user_id = request.headers.get('X-User-Id')
        if not user_id:
            # 기본값: 전체 접근 가능 (개발용)
            user_id = None

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if user_id:
                # 사용자별 접근 권한 확인
                cursor.execute("""
                    SELECT usa.group_id, usa.site_id, usa.role
                    FROM user_site_access usa
                    WHERE usa.user_id = %s AND usa.is_active = TRUE
                """, (user_id,))
                access_rows = cursor.fetchall()

                # super_admin이면 전체 접근
                is_super_admin = any(row[2] == 'super_admin' for row in access_rows)

                if is_super_admin:
                    user_id = None  # 전체 접근
                else:
                    accessible_group_ids = [row[0] for row in access_rows if row[0]]
                    accessible_site_ids = [row[1] for row in access_rows if row[1]]

            # 전체 또는 필터링된 구조 조회
            if user_id is None:
                # 전체 접근
                cursor.execute("""
                    SELECT id, group_code, group_name, display_order
                    FROM site_groups WHERE is_active = TRUE
                    ORDER BY display_order
                """)
            else:
                # 권한 기반 필터
                cursor.execute("""
                    SELECT DISTINCT sg.id, sg.group_code, sg.group_name, sg.display_order
                    FROM site_groups sg
                    LEFT JOIN business_locations bl ON sg.id = bl.group_id
                    WHERE sg.is_active = TRUE
                    AND (sg.id = ANY(%s) OR bl.id = ANY(%s))
                    ORDER BY sg.display_order
                """, (accessible_group_ids, accessible_site_ids))

            groups = []
            for row in cursor.fetchall():
                group = {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "order": row[3],
                    "categories": []
                }

                # 카테고리 조회
                cursor.execute("""
                    SELECT id, category_code, category_name, meal_types, meal_items, display_order
                    FROM site_categories
                    WHERE group_id = %s AND is_active = TRUE
                    ORDER BY display_order
                """, (group["id"],))

                for cat_row in cursor.fetchall():
                    category = {
                        "id": cat_row[0],
                        "code": cat_row[1],
                        "name": cat_row[2],
                        "mealTypes": cat_row[3] if isinstance(cat_row[3], list) else json.loads(cat_row[3] or '[]'),
                        "mealItems": cat_row[4] if isinstance(cat_row[4], list) else json.loads(cat_row[4] or '[]'),
                        "order": cat_row[5],
                        "sites": []
                    }

                    # 사업장 조회 (거래종료 사업장 제외)
                    if user_id is None:
                        cursor.execute("""
                            SELECT id, site_code, site_name, display_order
                            FROM business_locations
                            WHERE category_id = %s AND is_active = 1
                              AND (contract_end_date IS NULL OR contract_end_date > CURRENT_DATE)
                            ORDER BY display_order
                        """, (category["id"],))
                    else:
                        cursor.execute("""
                            SELECT id, site_code, site_name, display_order
                            FROM business_locations
                            WHERE category_id = %s AND is_active = 1
                              AND (contract_end_date IS NULL OR contract_end_date > CURRENT_DATE)
                            AND id = ANY(%s)
                            ORDER BY display_order
                        """, (category["id"], accessible_site_ids))

                    for site_row in cursor.fetchall():
                        category["sites"].append({
                            "id": site_row[0],
                            "code": site_row[1],
                            "name": site_row[2],
                            "order": site_row[3]
                        })

                    if category["sites"]:  # 사업장이 있는 카테고리만 포함
                        group["categories"].append(category)

                if group["categories"]:  # 카테고리가 있는 그룹만 포함
                    groups.append(group)

            cursor.close()

            return {"success": True, "data": groups}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/user/accessible-sites")
async def get_accessible_sites(request: Request):
    """현재 사용자가 접근 가능한 사업장 목록 (평면 리스트)"""
    try:
        user_id = request.headers.get('X-User-Id')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if user_id:
                # 사용자 권한 확인
                cursor.execute("""
                    SELECT usa.role FROM user_site_access usa
                    WHERE usa.user_id = %s AND usa.is_active = TRUE
                    AND usa.role = 'super_admin'
                """, (user_id,))

                if cursor.fetchone():
                    user_id = None  # super_admin은 전체 접근

            if user_id is None:
                cursor.execute("""
                    SELECT
                        bl.id, bl.site_code, bl.site_name,
                        sg.group_name, sc.category_name
                    FROM business_locations bl
                    LEFT JOIN site_groups sg ON bl.group_id = sg.id
                    LEFT JOIN site_categories sc ON bl.category_id = sc.id
                    WHERE bl.is_active = 1
                      AND (bl.contract_end_date IS NULL OR bl.contract_end_date > CURRENT_DATE)
                    ORDER BY sg.display_order, sc.display_order, bl.display_order
                """)
            else:
                cursor.execute("""
                    SELECT
                        bl.id, bl.site_code, bl.site_name,
                        sg.group_name, sc.category_name
                    FROM business_locations bl
                    LEFT JOIN site_groups sg ON bl.group_id = sg.id
                    LEFT JOIN site_categories sc ON bl.category_id = sc.id
                    INNER JOIN user_site_access usa ON
                        (usa.site_id = bl.id OR usa.group_id = bl.group_id)
                    WHERE bl.is_active = 1
                      AND (bl.contract_end_date IS NULL OR bl.contract_end_date > CURRENT_DATE)
                    AND usa.user_id = %s AND usa.is_active = TRUE
                    ORDER BY sg.display_order, sc.display_order, bl.display_order
                """, (user_id,))

            columns = ['id', 'code', 'name', 'groupName', 'categoryName']
            sites = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {"success": True, "data": sites, "total": len(sites)}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/user/current-context")
async def get_current_context(request: Request):
    """현재 선택된 컨텍스트 (세션/쿠키 기반 또는 기본 사업장)"""
    try:
        user_id = request.headers.get('X-User-Id')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기본 사업장 조회
            if user_id:
                cursor.execute("""
                    SELECT
                        usa.site_id, usa.group_id, usa.role,
                        bl.site_name, sg.group_name, sc.category_name
                    FROM user_site_access usa
                    LEFT JOIN business_locations bl ON usa.site_id = bl.id
                    LEFT JOIN site_groups sg ON usa.group_id = sg.id OR bl.group_id = sg.id
                    LEFT JOIN site_categories sc ON bl.category_id = sc.id
                    WHERE usa.user_id = %s AND usa.is_active = TRUE AND usa.is_default = TRUE
                    LIMIT 1
                """, (user_id,))

                row = cursor.fetchone()
                if row:
                    cursor.close()
                    return {
                        "success": True,
                        "data": {
                            "siteId": row[0],
                            "groupId": row[1],
                            "role": row[2],
                            "siteName": row[3],
                            "groupName": row[4],
                            "categoryName": row[5]
                        }
                    }

            # 기본 사업장이 없으면 첫 번째 사업장 반환
            cursor.execute("""
                SELECT
                    bl.id, bl.site_name, bl.group_id,
                    sg.group_name, sc.category_name
                FROM business_locations bl
                LEFT JOIN site_groups sg ON bl.group_id = sg.id
                LEFT JOIN site_categories sc ON bl.category_id = sc.id
                WHERE bl.is_active = 1
                ORDER BY sg.display_order, sc.display_order, bl.display_order
                LIMIT 1
            """)

            row = cursor.fetchone()
            cursor.close()

            if row:
                return {
                    "success": True,
                    "data": {
                        "siteId": row[0],
                        "siteName": row[1],
                        "groupId": row[2],
                        "groupName": row[3],
                        "categoryName": row[4],
                        "role": "viewer"
                    }
                }

            return {"success": True, "data": None}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/user/select-context")
async def select_context(context: ContextSelect, request: Request):
    """컨텍스트 변경 (그룹/사업장 선택)

    그룹 레벨 선택: group_id로 선택 시 해당 그룹의 모든 카테고리 정보 반환
    사업장 레벨 선택: site_id로 선택 시 해당 사업장 정보 반환 (하위 호환성)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 그룹 레벨 선택 (본사, 영남지사, 위탁사업장 등)
            if context.group_id:
                # 그룹 정보 조회
                cursor.execute("""
                    SELECT id, group_code, group_name
                    FROM site_groups
                    WHERE id = %s AND is_active = TRUE
                """, (context.group_id,))

                group_row = cursor.fetchone()
                if not group_row:
                    cursor.close()
                    return {"success": False, "error": "그룹을 찾을 수 없습니다"}

                # 그룹 내 모든 카테고리의 meal_types, meal_items 수집
                cursor.execute("""
                    SELECT category_code, category_name, meal_types, meal_items
                    FROM site_categories
                    WHERE group_id = %s AND is_active = TRUE
                    ORDER BY display_order
                """, (context.group_id,))

                categories = cursor.fetchall()
                all_meal_types = set()
                all_meal_items = set()
                category_list = []

                for cat in categories:
                    meal_types = cat[2] if isinstance(cat[2], list) else json.loads(cat[2] or '[]')
                    meal_items = cat[3] if isinstance(cat[3], list) else json.loads(cat[3] or '[]')

                    for t in meal_types:
                        all_meal_types.add(t)
                    for i in meal_items:
                        all_meal_items.add(i)

                    category_list.append({
                        "code": cat[0],
                        "name": cat[1],
                        "mealTypes": meal_types,
                        "mealItems": meal_items
                    })

                # 기본값 설정
                if not all_meal_types:
                    all_meal_types = {'조식', '중식', '석식', '야식', '행사'}
                if not all_meal_items:
                    all_meal_items = {'일반'}

                cursor.close()

                return {
                    "success": True,
                    "data": {
                        "groupId": group_row[0],
                        "groupCode": group_row[1],
                        "groupName": group_row[2],
                        "siteId": group_row[0],  # 하위 호환성
                        "siteName": group_row[2],  # 하위 호환성
                        "categoryId": None,
                        "categoryName": None,
                        "mealTypes": list(all_meal_types),
                        "mealItems": list(all_meal_items),
                        "categories": category_list
                    }
                }

            # 사업장 레벨 선택 (하위 호환성)
            if context.site_id:
                cursor.execute("""
                    SELECT
                        bl.id, bl.site_code, bl.site_name,
                        sg.id, sg.group_name,
                        sc.id, sc.category_name, sc.meal_types, sc.meal_items
                    FROM business_locations bl
                    LEFT JOIN site_groups sg ON bl.group_id = sg.id
                    LEFT JOIN site_categories sc ON bl.category_id = sc.id
                    WHERE bl.id = %s
                """, (context.site_id,))

                row = cursor.fetchone()
                if row:
                    cursor.close()
                    return {
                        "success": True,
                        "data": {
                            "siteId": row[0],
                            "siteCode": row[1],
                            "siteName": row[2],
                            "groupId": row[3],
                            "groupName": row[4],
                            "categoryId": row[5],
                            "categoryName": row[6],
                            "mealTypes": row[7] if isinstance(row[7], list) else json.loads(row[7] or '[]'),
                            "mealItems": row[8] if isinstance(row[8], list) else json.loads(row[8] or '[]')
                        }
                    }

            cursor.close()

            return {"success": False, "error": "그룹 또는 사업장을 선택해주세요"}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 즐겨찾기 API
# ============================================

@router.get("/api/user/favorites")
async def get_favorites(request: Request):
    """사용자 즐겨찾기 목록"""
    try:
        user_id = request.headers.get('X-User-Id', '1')  # 기본값 1

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    uf.id, uf.site_id, uf.display_order,
                    bl.site_code, bl.site_name,
                    sg.group_name, sc.category_name
                FROM user_favorites uf
                INNER JOIN business_locations bl ON uf.site_id = bl.id
                LEFT JOIN site_groups sg ON bl.group_id = sg.id
                LEFT JOIN site_categories sc ON bl.category_id = sc.id
                WHERE uf.user_id = %s
                ORDER BY uf.display_order
            """, (user_id,))

            columns = ['id', 'siteId', 'order', 'siteCode', 'siteName', 'groupName', 'categoryName']
            favorites = [dict(zip(columns, row)) for row in cursor.fetchall()]

            cursor.close()

            return {"success": True, "data": favorites, "total": len(favorites)}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/user/favorites")
async def add_favorite(request: Request):
    """즐겨찾기 추가"""
    try:
        data = await request.json()
        user_id = request.headers.get('X-User-Id', '1')
        site_id = data.get('site_id') or data.get('siteId')

        if not site_id:
            return {"success": False, "error": "site_id가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 현재 최대 순서
            cursor.execute("""
                SELECT COALESCE(MAX(display_order), 0) + 1
                FROM user_favorites WHERE user_id = %s
            """, (user_id,))
            next_order = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO user_favorites (user_id, site_id, display_order)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, site_id) DO NOTHING
                RETURNING id
            """, (user_id, site_id, next_order))

            result = cursor.fetchone()
            conn.commit()

            cursor.close()

            if result:
                return {"success": True, "data": {"id": result[0]}, "message": "즐겨찾기에 추가되었습니다"}
            else:
                return {"success": False, "error": "이미 즐겨찾기에 있습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/user/favorites/{favorite_id}")
async def remove_favorite(favorite_id: int, request: Request):
    """즐겨찾기 삭제"""
    try:
        user_id = request.headers.get('X-User-Id', '1')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM user_favorites
                WHERE id = %s AND user_id = %s
            """, (favorite_id, user_id))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "즐겨찾기에서 삭제되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 사용자-사업장 권한 관리 API (ADMIN)
# ============================================

@router.get("/api/admin/user-site-access")
async def get_user_site_access(
    user_id: Optional[int] = None,
    site_id: Optional[int] = None
):
    """사용자-사업장 권한 목록"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    usa.id, usa.user_id, usa.site_id, usa.group_id,
                    usa.role, usa.permissions, usa.is_default, usa.is_active,
                    usa.created_at,
                    u.username,
                    bl.site_name,
                    sg.group_name
                FROM user_site_access usa
                INNER JOIN users u ON usa.user_id = u.id
                LEFT JOIN business_locations bl ON usa.site_id = bl.id
                LEFT JOIN site_groups sg ON usa.group_id = sg.id
                WHERE 1=1
            """
            params = []

            if user_id:
                query += " AND usa.user_id = %s"
                params.append(user_id)
            if site_id:
                query += " AND usa.site_id = %s"
                params.append(site_id)

            query += " ORDER BY u.username, usa.is_default DESC"

            cursor.execute(query, params)

            columns = [desc[0] for desc in cursor.description]
            access_list = [dict(zip(columns, row)) for row in cursor.fetchall()]

            for item in access_list:
                if item.get('created_at'):
                    item['created_at'] = item['created_at'].isoformat()
                # 역할 이름 추가
                role = item.get('role')
                if role in ROLES:
                    item['role_name'] = ROLES[role]['name']

            cursor.close()

            return {"success": True, "data": access_list, "total": len(access_list)}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/user-site-access")
async def create_user_site_access(access: UserSiteAccessCreate):
    """사용자 권한 할당"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO user_site_access (user_id, site_id, group_id, role, permissions, is_default)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                access.user_id,
                access.site_id,
                access.group_id,
                access.role,
                json.dumps(access.permissions),
                access.is_default
            ))

            new_id = cursor.fetchone()[0]

            # is_default=True이면 다른 기본 설정 해제
            if access.is_default:
                cursor.execute("""
                    UPDATE user_site_access
                    SET is_default = FALSE
                    WHERE user_id = %s AND id != %s
                """, (access.user_id, new_id))

            conn.commit()
            cursor.close()

            return {"success": True, "data": {"id": new_id}, "message": "권한이 할당되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/user-site-access/{access_id}")
async def update_user_site_access(access_id: int, access: UserSiteAccessUpdate):
    """권한 수정"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            updates = []
            values = []

            if access.role is not None:
                updates.append("role = %s")
                values.append(access.role)
            if access.permissions is not None:
                updates.append("permissions = %s")
                values.append(json.dumps(access.permissions))
            if access.is_default is not None:
                updates.append("is_default = %s")
                values.append(access.is_default)
            if access.is_active is not None:
                updates.append("is_active = %s")
                values.append(access.is_active)

            if not updates:
                return {"success": False, "error": "수정할 내용이 없습니다"}

            updates.append("updated_at = NOW()")
            values.append(access_id)

            cursor.execute(f"""
                UPDATE user_site_access
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)

            # is_default=True이면 다른 기본 설정 해제
            if access.is_default:
                cursor.execute("""
                    SELECT user_id FROM user_site_access WHERE id = %s
                """, (access_id,))
                user_id = cursor.fetchone()[0]

                cursor.execute("""
                    UPDATE user_site_access
                    SET is_default = FALSE
                    WHERE user_id = %s AND id != %s
                """, (user_id, access_id))

            conn.commit()
            cursor.close()

            return {"success": True, "message": "권한이 수정되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/user-site-access/{access_id}")
async def delete_user_site_access(access_id: int):
    """권한 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM user_site_access WHERE id = %s", (access_id,))
            conn.commit()

            cursor.close()

            return {"success": True, "message": "권한이 삭제되었습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 역할 목록 API
# ============================================

@router.get("/api/admin/roles")
async def get_roles():
    """사용 가능한 역할 목록"""
    roles = [
        {"code": code, "name": info["name"], "level": info["level"]}
        for code, info in ROLES.items()
    ]
    return {"success": True, "data": roles}
