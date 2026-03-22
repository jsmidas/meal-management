#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auth Router
인증 관련 API 엔드포인트
"""

import os
import hashlib
import secrets
import time
import bcrypt
from fastapi import APIRouter, Request
from core.database import get_db_connection

router = APIRouter()


@router.post("/api/auth/login")
async def login(request: Request):
    """로그인 API"""
    try:
        data = await request.json()
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return {"success": False, "error": "사용자명과 비밀번호를 입력해주세요"}

        # 데이터베이스 인증
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()

                # 사용자 조회 (managed_site 포함)
                cursor.execute("""
                    SELECT u.id, u.username, u.password_hash, u.role, u.managed_site, sg.id as group_id
                    FROM users u
                    LEFT JOIN site_groups sg ON u.managed_site = sg.group_name
                    WHERE u.username = %s AND u.is_active = 1
                """, (username,))
                user = cursor.fetchone()

                if not user:
                    return {"success": False, "error": "사용자를 찾을 수 없습니다"}

                user_id, db_username, password_hash, role, managed_site, group_id = user

                # 비밀번호 검증 (bcrypt 우선, SHA256 하위호환)
                password_valid = False
                if password_hash and password_hash.startswith('$2'):
                    # bcrypt 해시
                    password_valid = bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
                else:
                    # SHA256 레거시 해시 → 검증 후 bcrypt로 자동 마이그레이션
                    input_hash = hashlib.sha256(password.encode()).hexdigest()
                    if input_hash == password_hash:
                        password_valid = True
                        try:
                            new_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                            cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user_id))
                            conn.commit()
                            print(f"[AUTH] 사용자 {db_username} 비밀번호 bcrypt 마이그레이션 완료")
                        except Exception as e:
                            print(f"[AUTH] bcrypt 마이그레이션 실패: {e}")

                if password_valid:
                    # 사용자에게 할당된 사업장 목록 조회
                    assigned_sites = []
                    try:
                        cursor.execute("""
                            SELECT usa.site_id, sg.group_name, sg.abbreviation
                            FROM user_site_access usa
                            JOIN site_groups sg ON usa.site_id = sg.id
                            WHERE usa.user_id = %s AND usa.site_id IS NOT NULL
                            AND (usa.is_active = TRUE OR usa.is_active IS NULL)
                        """, (user_id,))
                        for row in cursor.fetchall():
                            assigned_sites.append({
                                "site_id": row[0],
                                "site_name": row[1],
                                "abbreviation": row[2] or ''
                            })
                    except Exception as e:
                        print(f"[AUTH] 할당 사업장 조회 실패: {e}")

                    return {
                        "success": True,
                        "data": {
                            "token": secrets.token_urlsafe(32),
                            "user": {
                                "id": user_id,
                                "username": db_username,
                                "role": role,
                                "managed_site": managed_site,
                                "group_id": group_id,
                                "assigned_sites": assigned_sites
                            }
                        },
                        "message": "로그인 성공"
                    }
                else:
                    return {"success": False, "error": "비밀번호가 일치하지 않습니다"}

        except Exception as e:
            print(f"[AUTH ERROR] {e}")
            return {"success": False, "error": "인증 처리 중 오류가 발생했습니다"}

    except Exception as e:
        return {"success": False, "error": f"로그인 처리 중 오류가 발생했습니다: {str(e)}"}


@router.post("/api/auth/logout")
async def logout(request: Request):
    """로그아웃 API"""
    try:
        # 클라이언트에서 토큰 삭제를 지시
        return {
            "success": True,
            "message": "로그아웃 성공",
            "redirect": "/login.html"
        }
    except Exception as e:
        return {"success": False, "error": f"로그아웃 처리 중 오류: {str(e)}"}


@router.get("/api/status")
async def api_status():
    """API 상태 확인"""
    port = int(os.environ.get("PORT", os.environ.get("API_PORT", 8080)))
    return {
        "message": "식자재 관리 API 서버가 정상 작동 중입니다",
        "status": "running",
        "port": port,
        "endpoints": [
            "/test-samsung-welstory",
            "/all-ingredients-for-suppliers",
            "/api/auth/login",
            "/api/users"
        ]
    }
