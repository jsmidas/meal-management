#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Users Router
사용자 관리 관련 API 엔드포인트
"""

import hashlib
import bcrypt
from fastapi import APIRouter, Request
from core.database import get_db_connection

router = APIRouter()


@router.get("/api/admin/check-users-schema")
async def check_users_schema():
    """users 테이블 스키마 확인 (디버깅용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'users'
                ORDER BY ordinal_position
            """)
            columns = [{"name": row[0], "type": row[1]} for row in cursor.fetchall()]
            return {"success": True, "columns": columns}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/add-managed-columns")
async def add_managed_columns():
    """managed_groups, managed_categories, permissions 컬럼 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # managed_groups 컬럼 추가
            cursor.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_groups JSONB DEFAULT '[]'
            """)

            # managed_categories 컬럼 추가
            cursor.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_categories JSONB DEFAULT '[]'
            """)

            # permissions 컬럼 추가 (개별 기능 권한)
            cursor.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'
            """)

            # 기존 admin 사용자에게 blog_access 권한 자동 부여
            cursor.execute("""
                UPDATE users SET permissions = jsonb_set(COALESCE(permissions, '{}'), '{blog_access}', 'true')
                WHERE role = 'admin' AND (permissions IS NULL OR NOT (permissions ? 'blog_access'))
            """)

            conn.commit()
            return {"success": True, "message": "managed_groups, managed_categories, permissions 컬럼이 추가되었습니다."}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/users")
async def get_users():
    """사용자 목록"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 먼저 managed_groups, managed_categories, permissions 컬럼이 있는지 확인
            try:
                cursor.execute("""
                    SELECT id, username, role, contact_info, department, is_active, created_at, full_name,
                           operator, semi_operator, managed_site, managed_groups, managed_categories, permissions
                    FROM users
                    WHERE is_active = true OR is_active IS NULL
                    ORDER BY id DESC
                """)
                has_new_columns = True
            except Exception:
                # 컬럼이 없으면 기본 쿼리 사용
                conn.rollback()
                cursor.execute("""
                    SELECT id, username, role, contact_info, department, is_active, created_at, full_name,
                           operator, semi_operator, managed_site
                    FROM users
                    WHERE is_active = true OR is_active IS NULL
                    ORDER BY id DESC
                """)
                has_new_columns = False

            users = cursor.fetchall()

            users_data = []
            for user in users:
                # managed_groups와 managed_categories 처리 (JSONB 또는 문자열)
                if has_new_columns:
                    raw_groups = user[11] if len(user) > 11 and user[11] else []
                    raw_categories = user[12] if len(user) > 12 and user[12] else []
                    # 문자열이면 JSON 파싱
                    if isinstance(raw_groups, str):
                        try:
                            import json
                            managed_groups = json.loads(raw_groups)
                        except:
                            managed_groups = []
                    else:
                        managed_groups = raw_groups if raw_groups else []
                    if isinstance(raw_categories, str):
                        try:
                            import json
                            managed_categories = json.loads(raw_categories)
                        except:
                            managed_categories = []
                    else:
                        managed_categories = raw_categories if raw_categories else []
                else:
                    managed_groups = []
                    managed_categories = []

                # permissions 처리
                if has_new_columns:
                    raw_permissions = user[13] if len(user) > 13 and user[13] else {}
                    if isinstance(raw_permissions, str):
                        try:
                            import json
                            permissions = json.loads(raw_permissions)
                        except:
                            permissions = {}
                    else:
                        permissions = raw_permissions if raw_permissions else {}
                else:
                    permissions = {}

                # admin은 항상 blog_access 권한 보유
                user_role = user[2] or "user"
                if user_role == 'admin':
                    permissions['blog_access'] = True

                users_data.append({
                    "id": user[0],
                    "username": user[1],
                    "full_name": user[7] or "",
                    "name": user[7] or user[1],  # full_name이 있으면 사용, 없으면 username
                    "role": user_role,
                    "email": user[3] or "",  # contact_info를 email로 사용
                    "contact": user[3] or "",
                    "contact_info": user[3] or "",
                    "department": user[4] or "",
                    "is_active": bool(user[5]) if user[5] is not None else True,
                    "isActive": bool(user[5]) if user[5] is not None else True,  # 호환성
                    "createdAt": str(user[6]) if user[6] else None,
                    "created_at": str(user[6]) if user[6] else None,
                    "operator": user[8] if user[8] is not None else 0,
                    "semi_operator": user[9] if user[9] is not None else 0,
                    "managed_site": user[10] or "",
                    "managed_groups": managed_groups,
                    "managed_categories": managed_categories,
                    "permissions": permissions
                })


            return {
                "success": True,
                "users": users_data,
                "data": users_data,  # 호환성 유지
                "total": len(users_data)
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/users")
async def create_user(request: Request):
    """사용자 생성 - Railway PostgreSQL"""
    try:
        import json
        data = await request.json()

        username = data.get("username")
        password = data.get("password")
        password_confirm = data.get("password_confirm", "")
        full_name = data.get("full_name", "")
        role = data.get("role", "user")
        operator = 1 if data.get("operator") else 0
        semi_operator = 1 if data.get("semi_operator") else 0
        contact_info = data.get("contact_info", "")
        department = data.get("department", "")
        notes = data.get("notes", "")
        managed_site = data.get("managed_site", "")
        managed_groups = data.get("managed_groups", [])
        managed_categories = data.get("managed_categories", [])
        permissions = data.get("permissions", {})

        if not username or not password:
            return {"success": False, "error": "사용자명과 비밀번호는 필수입니다"}

        # 비밀번호 확인 검증
        if password != password_confirm:
            return {"success": False, "error": "비밀번호가 일치하지 않습니다"}

        # 비밀번호 해싱 (간단한 해싱 - 프로덕션에서는 bcrypt 사용 권장)
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # Railway PostgreSQL에 저장
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 먼저 새 컬럼으로 시도
            try:
                pg_cursor.execute("""
                    INSERT INTO users (username, password_hash, full_name, role, operator, semi_operator,
                                      contact_info, department, position, is_active, created_at,
                                      managed_site, managed_groups, managed_categories)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s, %s, %s)
                    RETURNING id
                """, (username, password_hash, full_name, role, operator, semi_operator,
                      contact_info, department, notes, 1,
                      managed_site, json.dumps(managed_groups), json.dumps(managed_categories)))
            except Exception:
                # 새 컬럼이 없으면 기본 INSERT 사용
                pg_conn.rollback()
                pg_cursor.execute("""
                    INSERT INTO users (username, password_hash, full_name, role, operator, semi_operator,
                                      contact_info, department, position, is_active, created_at, managed_site)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s)
                    RETURNING id
                """, (username, password_hash, full_name, role, operator, semi_operator,
                      contact_info, department, notes, 1, managed_site))

            user_id = pg_cursor.fetchone()[0]
            pg_conn.commit()

            return {
                "success": True,
                "data": {
                    "id": user_id,
                    "username": username,
                    "full_name": full_name,
                    "role": role,
                    "contact_info": contact_info,
                    "department": department,
                    "managed_site": managed_site,
                    "managed_groups": managed_groups,
                    "managed_categories": managed_categories
                },
                "message": "사용자가 성공적으로 생성되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/users/{user_id}")
async def update_user(user_id: int, request: Request):
    """사용자 수정 - Railway PostgreSQL"""
    try:
        import json
        data = await request.json()

        username = data.get("username")
        full_name = data.get("full_name", "")
        role = data.get("role")
        operator = 1 if data.get("operator") else 0
        semi_operator = 1 if data.get("semi_operator") else 0
        contact_info = data.get("contact_info", "")
        department = data.get("department", "")
        notes = data.get("notes", "")
        password = data.get("password", "")
        password_confirm = data.get("password_confirm", "")
        managed_site = data.get("managed_site", "")
        managed_groups = data.get("managed_groups", [])
        managed_categories = data.get("managed_categories", [])
        permissions = data.get("permissions", {})

        if not username:
            return {"success": False, "error": "사용자명은 필수입니다"}

        # 비밀번호 변경 시 확인 검증
        if password:
            if password != password_confirm:
                return {"success": False, "error": "비밀번호가 일치하지 않습니다"}

        # Railway PostgreSQL 업데이트
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            # 먼저 새 컬럼으로 시도
            try:
                if password:
                    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                    pg_cursor.execute("""
                        UPDATE users
                        SET username = %s, full_name = %s, role = %s, operator = %s, semi_operator = %s,
                            contact_info = %s, department = %s, position = %s, password_hash = %s,
                            managed_site = %s, managed_groups = %s, managed_categories = %s, permissions = %s,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (username, full_name, role, operator, semi_operator, contact_info, department, notes, password_hash,
                          managed_site, json.dumps(managed_groups), json.dumps(managed_categories), json.dumps(permissions), user_id))
                else:
                    pg_cursor.execute("""
                        UPDATE users
                        SET username = %s, full_name = %s, role = %s, operator = %s, semi_operator = %s,
                            contact_info = %s, department = %s, position = %s,
                            managed_site = %s, managed_groups = %s, managed_categories = %s, permissions = %s,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (username, full_name, role, operator, semi_operator, contact_info, department, notes,
                          managed_site, json.dumps(managed_groups), json.dumps(managed_categories), json.dumps(permissions), user_id))
            except Exception as e:
                # 새 컬럼이 없으면 기본 UPDATE 사용
                pg_conn.rollback()
                if password:
                    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                    pg_cursor.execute("""
                        UPDATE users
                        SET username = %s, full_name = %s, role = %s, operator = %s, semi_operator = %s,
                            contact_info = %s, department = %s, position = %s, password_hash = %s,
                            managed_site = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (username, full_name, role, operator, semi_operator, contact_info, department, notes, password_hash,
                          managed_site, user_id))
                else:
                    pg_cursor.execute("""
                        UPDATE users
                        SET username = %s, full_name = %s, role = %s, operator = %s, semi_operator = %s,
                            contact_info = %s, department = %s, position = %s,
                            managed_site = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (username, full_name, role, operator, semi_operator, contact_info, department, notes,
                          managed_site, user_id))

            pg_conn.commit()

            return {
                "success": True,
                "data": {
                    "id": user_id,
                    "username": username,
                    "full_name": full_name,
                    "role": role,
                    "contact_info": contact_info,
                    "department": department,
                    "managed_site": managed_site,
                    "managed_groups": managed_groups,
                    "managed_categories": managed_categories,
                    "permissions": permissions
                },
                "message": "사용자가 성공적으로 수정되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: int):
    """사용자 삭제 - Railway PostgreSQL"""
    try:
        # Railway PostgreSQL에서 삭제 (soft delete)
        with get_db_connection() as pg_conn:
            pg_cursor = pg_conn.cursor()

            pg_cursor.execute("""
                UPDATE users
                SET is_active = false, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (user_id,))

            pg_conn.commit()

            return {
                "success": True,
                "message": f"사용자 ID {user_id}가 성공적으로 비활성화되었습니다."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}

# 프론트엔드 호환을 위한 /api/users 엔드포인트 추가

@router.post("/api/users")
async def create_user_compat(request: Request):
    """사용자 생성 (프론트엔드 호환성)"""
    return await create_user(request)


@router.put("/api/users/{user_id}")
async def update_user_compat(user_id: int, request: Request):
    """사용자 수정 (프론트엔드 호환성)"""
    return await update_user(user_id, request)


@router.get("/api/users")
async def get_users_compat():
    """사용자 목록 (프론트엔드 호환성)"""
    return await get_users()


@router.get("/api/users/{user_id}")
async def get_user_by_id(user_id: int):
    """개별 사용자 정보 조회"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 먼저 새 컬럼으로 시도
            try:
                cursor.execute("""
                    SELECT id, username, role, contact_info, department, position, is_active, created_at, full_name,
                           operator, semi_operator, managed_site, managed_groups, managed_categories, permissions
                    FROM users
                    WHERE id = %s
                """, (user_id,))
                has_new_columns = True
            except Exception:
                conn.rollback()
                cursor.execute("""
                    SELECT id, username, role, contact_info, department, position, is_active, created_at, full_name,
                           operator, semi_operator, managed_site
                    FROM users
                    WHERE id = %s
                """, (user_id,))
                has_new_columns = False

            user = cursor.fetchone()

            if not user:
                return {"success": False, "error": "사용자를 찾을 수 없습니다"}

            # managed_groups와 managed_categories 처리 (JSONB 또는 문자열)
            if has_new_columns:
                raw_groups = user[12] if len(user) > 12 and user[12] else []
                raw_categories = user[13] if len(user) > 13 and user[13] else []
                # 문자열이면 JSON 파싱
                if isinstance(raw_groups, str):
                    try:
                        import json
                        managed_groups = json.loads(raw_groups)
                    except:
                        managed_groups = []
                else:
                    managed_groups = raw_groups if raw_groups else []
                if isinstance(raw_categories, str):
                    try:
                        import json
                        managed_categories = json.loads(raw_categories)
                    except:
                        managed_categories = []
                else:
                    managed_categories = raw_categories if raw_categories else []
            else:
                managed_groups = []
                managed_categories = []

            user_data = {
                "id": user[0],
                "username": user[1],
                "full_name": user[8] or "",
                "role": user[2] or "user",
                "contact_info": user[3] or "",
                "department": user[4] or "",
                "notes": user[5] or "",
                "is_active": bool(user[6]),
                "created_at": str(user[7]) if user[7] else None,
                "operator": user[9] if user[9] is not None else 0,
                "semi_operator": user[10] if user[10] is not None else 0,
                "managed_site": user[11] or "",
                "managed_groups": managed_groups,
                "managed_categories": managed_categories
            }

            # permissions 처리
            raw_perms = user[14] if has_new_columns and len(user) > 14 and user[14] else {}
            if isinstance(raw_perms, str):
                import json
                try:
                    raw_perms = json.loads(raw_perms)
                except:
                    raw_perms = {}
            user_data['permissions'] = raw_perms if isinstance(raw_perms, dict) else {}

            # admin은 항상 blog_access
            if user_data['role'] == 'admin':
                user_data['permissions']['blog_access'] = True

            return {
                "success": True,
                "user": user_data,
                "data": user_data
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/users/{user_id}/sites")
async def get_user_sites(user_id: int):
    """사용자의 사업장 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 전체 사업장 목록
            cursor.execute("""
                SELECT id, site_name, location, site_type
                FROM business_locations
                WHERE is_active = TRUE OR is_active IS NULL
                ORDER BY site_name
            """)
            all_sites = []
            for row in cursor.fetchall():
                all_sites.append({
                    "id": row[0],
                    "name": row[1],
                    "location": row[2] or "",
                    "site_type": row[3] or ""
                })

            # 사용자에게 할당된 사업장 ID 목록
            cursor.execute("""
                SELECT site_id
                FROM user_site_access
                WHERE user_id = %s AND site_id IS NOT NULL AND (is_active = TRUE OR is_active IS NULL)
            """, (user_id,))
            assigned_site_ids = [row[0] for row in cursor.fetchall()]


            return {
                "success": True,
                "all_sites": all_sites,
                "assigned_site_ids": assigned_site_ids
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/users/{user_id}/sites")
async def save_user_sites(user_id: int, request: Request):
    """사용자의 사업장 할당 저장"""
    try:
        data = await request.json()
        site_ids = data.get("site_ids", [])

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기존 사업장 할당 조회
            cursor.execute("""
                SELECT id, site_id
                FROM user_site_access
                WHERE user_id = %s AND site_id IS NOT NULL
            """, (user_id,))
            existing = {row[1]: row[0] for row in cursor.fetchall()}  # site_id -> access_id

            existing_site_ids = set(existing.keys())
            new_site_ids = set(site_ids)

            # 삭제할 할당 (기존에 있지만 새 목록에 없는 것)
            to_delete = existing_site_ids - new_site_ids
            for site_id in to_delete:
                access_id = existing[site_id]
                cursor.execute("DELETE FROM user_site_access WHERE id = %s", (access_id,))

            # 추가할 할당 (새 목록에 있지만 기존에 없는 것)
            to_add = new_site_ids - existing_site_ids
            for site_id in to_add:
                cursor.execute("""
                    INSERT INTO user_site_access (user_id, site_id, role, is_default, is_active)
                    VALUES (%s, %s, 'viewer', FALSE, TRUE)
                """, (user_id, site_id))

            conn.commit()

            return {
                "success": True,
                "message": f"사업장 할당이 저장되었습니다. (추가: {len(to_add)}개, 삭제: {len(to_delete)}개)"
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


