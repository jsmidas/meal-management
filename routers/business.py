from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from core.database import get_db_connection

router = APIRouter()

@router.get("/health")
async def business_health():
    """비즈니스 관리 헬스체크"""
    return {"service": "business", "status": "healthy", "description": "비즈니스 관리"}

@router.get("/")
async def get_business():
    """비즈니스 관리 목록 조회"""
    return {"message": "비즈니스 관리 서비스가 준비되었습니다", "items": []}