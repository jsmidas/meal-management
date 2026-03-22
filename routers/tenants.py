"""
체험판 관리 라우터
- 가입, 상태 확인, 체험 연장
"""
from fastapi import APIRouter, Request
from core.database import get_db_connection
import hashlib
import secrets
from datetime import datetime, timedelta

router = APIRouter()


@router.post("/api/tenant/register")
async def register_tenant(request: Request):
    """체험판 가입"""
    try:
        data = await request.json()
        company_name = data.get('company_name', '').strip()
        contact_name = data.get('contact_name', '').strip()
        contact_email = data.get('contact_email', '').strip()
        contact_phone = data.get('contact_phone', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()

        if not company_name or not username or not password:
            return {"success": False, "error": "업체명, 아이디, 비밀번호는 필수입니다"}

        if len(password) < 4:
            return {"success": False, "error": "비밀번호는 4자 이상이어야 합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 아이디 중복 체크
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cursor.fetchone():
                cursor.close()
                return {"success": False, "error": "이미 사용 중인 아이디입니다"}

            # 1. tenant 생성
            cursor.execute("""
                INSERT INTO tenants (name, contact_name, contact_email, contact_phone, plan, status)
                VALUES (%s, %s, %s, %s, 'trial', 'active')
                RETURNING id, trial_end
            """, (company_name, contact_name, contact_email, contact_phone))
            tenant_row = cursor.fetchone()
            tenant_id = tenant_row[0]
            trial_end = tenant_row[1]

            # 2. 관리자 사용자 생성
            password_hash = hashlib.sha256(password.encode()).hexdigest()
            cursor.execute("""
                INSERT INTO users (username, password, role, full_name, tenant_id)
                VALUES (%s, %s, 'admin', %s, %s)
                RETURNING id
            """, (username, password_hash, contact_name or username, tenant_id))
            user_id = cursor.fetchone()[0]

            # 3. 기본 사업장 그룹 생성
            cursor.execute("""
                INSERT INTO site_groups (group_name, display_order)
                VALUES (%s, 1)
                RETURNING id
            """, (company_name,))
            group_id = cursor.fetchone()[0]

            # 4. 기본 카테고리 생성
            cursor.execute("""
                INSERT INTO site_categories (group_id, category_code, category_name, display_order)
                VALUES (%s, 'DEFAULT', '기본', 1)
                RETURNING id
            """, (group_id,))
            category_id = cursor.fetchone()[0]

            # 5. 기본 끼니구분 생성 (중식)
            cursor.execute("""
                INSERT INTO category_slots (category_id, slot_code, slot_name, meal_type, is_active)
                VALUES (%s, 'LUNCH', '중식', '중식', TRUE)
            """, (category_id,))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"체험판 가입이 완료되었습니다. 14일간 무료로 사용하세요!",
                "tenant_id": tenant_id,
                "trial_end": str(trial_end)[:10],
                "username": username
            }
    except Exception as e:
        print(f"[체험판] 가입 오류: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/tenant/status")
async def get_tenant_status(request: Request):
    """현재 로그인한 사용자의 체험판 상태"""
    try:
        # Authorization 헤더에서 토큰 추출 → 사용자 정보
        auth_header = request.headers.get('Authorization', '')
        if not auth_header:
            return {"success": False, "error": "인증 필요"}

        token = auth_header.replace('Bearer ', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 토큰으로 사용자 찾기
            cursor.execute("""
                SELECT u.id, u.username, u.tenant_id, u.role,
                       t.name, t.plan, t.status, t.trial_start, t.trial_end
                FROM users u
                LEFT JOIN tenants t ON u.tenant_id = t.id
                WHERE u.token = %s OR u.id = (
                    SELECT user_id FROM user_sessions WHERE token = %s LIMIT 1
                )
            """, (token, token))
            row = cursor.fetchone()
            cursor.close()

            if not row:
                return {"success": True, "tenant": None}

            tenant_data = None
            if row[2]:  # tenant_id exists
                now = datetime.now()
                trial_end = row[8]
                days_left = (trial_end - now).days if trial_end else 0

                tenant_data = {
                    "id": row[2],
                    "name": row[4],
                    "plan": row[5],
                    "status": row[6],
                    "trial_start": str(row[7])[:10] if row[7] else None,
                    "trial_end": str(row[8])[:10] if row[8] else None,
                    "days_left": max(0, days_left),
                    "is_expired": days_left < 0 if trial_end else False
                }

            return {"success": True, "tenant": tenant_data}
    except Exception as e:
        print(f"[체험판] 상태 조회 오류: {e}")
        return {"success": True, "tenant": None}


@router.post("/api/tenant/extend-trial")
async def extend_trial(request: Request):
    """체험판 연장 (관리자 전용)"""
    try:
        data = await request.json()
        tenant_id = data.get('tenant_id')
        days = data.get('days', 14)

        if not tenant_id:
            return {"success": False, "error": "tenant_id 필수"}

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE tenants
                SET trial_end = GREATEST(trial_end, NOW()) + INTERVAL '%s days',
                    status = 'active',
                    updated_at = NOW()
                WHERE id = %s
                RETURNING trial_end
            """, (days, tenant_id))
            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            if not row:
                return {"success": False, "error": "업체를 찾을 수 없습니다"}

            return {
                "success": True,
                "message": f"{days}일 연장 완료",
                "new_trial_end": str(row[0])[:10]
            }
    except Exception as e:
        print(f"[체험판] 연장 오류: {e}")
        return {"success": False, "error": str(e)}
