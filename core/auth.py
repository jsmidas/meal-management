"""
Authentication and authorization utilities
"""
import jwt
import datetime
import json
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
from .config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from .database import get_db_connection, log_admin_activity

# Security scheme
security = HTTPBearer()

class TokenData(BaseModel):
    username: str = None

class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = 'user'
    business_locations: List[str] = []

class UserUpdate(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    business_locations: Optional[List[str]] = None
    is_active: Optional[bool] = None

def create_access_token(data: dict):
    """JWT 토큰 생성"""
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """토큰 검증"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return TokenData(username=username)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(token_data: TokenData = Depends(verify_token)):
    """현재 로그인된 사용자 정보 조회"""
    try:
        pool = await get_db_connection()
        async with pool.acquire() as conn:
            user = await conn.fetchrow("""
                SELECT * FROM auth_schema.users
                WHERE username = $1 AND is_active = TRUE
            """, token_data.username)

            if not user:
                raise HTTPException(status_code=401, detail="User not found")

            user_dict = dict(user)
            # business_locations JSON 파싱
            if user_dict.get('business_locations'):
                try:
                    user_dict['business_locations'] = json.loads(user_dict['business_locations'])
                except:
                    user_dict['business_locations'] = []
            else:
                user_dict['business_locations'] = []

            return user_dict
    except Exception as e:
        print(f"사용자 조회 오류: {e}")
        raise HTTPException(status_code=500, detail="Database error")

async def require_admin(current_user: dict = Depends(get_current_user)):
    """관리자 권한 필요"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

async def require_nutritionist_or_admin(current_user: dict = Depends(get_current_user)):
    """영양사 또는 관리자 권한 필요"""
    if current_user['role'] not in ['admin', 'nutritionist']:
        raise HTTPException(status_code=403, detail="Nutritionist or Admin access required")
    return current_user

async def require_business_access(business_location: str, current_user: dict = Depends(get_current_user)):
    """특정 사업장 접근 권한 확인"""
    # 관리자는 모든 사업장 접근 가능
    if current_user['role'] == 'admin':
        return current_user

    # 사용자의 사업장 권한 확인
    user_locations = current_user.get('business_locations', [])
    if business_location not in user_locations:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied to business location: {business_location}"
        )
    return current_user

async def get_user_permissions(user_id: int):
    """사용자 권한 정보 조회"""
    try:
        pool = await get_db_connection()
        async with pool.acquire() as conn:
            user = await conn.fetchrow("""
                SELECT role, business_locations FROM auth_schema.users
                WHERE id = $1 AND is_active = TRUE
            """, user_id)

            if not user:
                return None

            permissions = {
                "role": user['role'],
                "business_locations": json.loads(user['business_locations'] or '[]'),
                "is_admin": user['role'] == 'admin',
                "is_nutritionist": user['role'] in ['admin', 'nutritionist']
            }

            return permissions
    except Exception as e:
        print(f"권한 정보 조회 실패: {e}")
        return None

# 10개 사업장 정의
BUSINESS_LOCATIONS = {
    'dosirak': '도시락',
    'unban': '운반',
    'school': '학교',
    'hospital': '병원',
    'nursing_home': '요양원',
    'daycare': '어린이집',
    'factory': '공장',
    'office': '사무실',
    'restaurant': '식당',
    'cafe': '카페'
}

def get_business_location_name(code: str) -> str:
    """사업장 코드로 이름 조회"""
    return BUSINESS_LOCATIONS.get(code, code)

def validate_business_locations(locations: List[str]) -> bool:
    """사업장 코드 유효성 검증"""
    return all(loc in BUSINESS_LOCATIONS for loc in locations)

async def log_user_activity(user: dict, action: str, description: str, request: Request = None):
    """사용자 활동 로깅"""
    try:
        ip_address = None
        if request:
            ip_address = request.client.host if request.client else None

        await log_admin_activity(
            user_id=user['id'],
            action=action,
            description=description,
            ip_address=ip_address
        )
        return True
    except Exception as e:
        print(f"활동 로깅 실패: {e}")
        return False