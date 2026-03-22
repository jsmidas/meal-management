"""
Configuration settings for the application
"""
import os

# App Mode: "simple" (카테고리 숨김, suffix 없음) / "advanced" (다함푸드 전체 기능)
APP_MODE = os.getenv("APP_MODE", "simple")
APP_TITLE = os.getenv("APP_TITLE", "급식관리 시스템")

# JWT Settings
SECRET_KEY = os.environ.get("SECRET_KEY") or "meal_mgmt_secret_key_2025_dev_only"
if not os.environ.get("SECRET_KEY"):
    print("[WARNING] SECRET_KEY not set - using dev default. Set SECRET_KEY env var in production.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8시간

# Database Settings - Railway PostgreSQL 전용
DATABASE_URL = os.getenv('DATABASE_URL')

# Railway 환경 감지
IS_RAILWAY = 'RAILWAY_ENVIRONMENT' in os.environ

# Server Settings
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", 8080))  # Railway 환경변수 지원
DEBUG = os.getenv("DEBUG", "true").lower() == "true"

# CORS Settings
ALLOWED_ORIGINS = ["*"]
ALLOWED_METHODS = ["*"]
ALLOWED_HEADERS = ["*"]

# File Upload Settings
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.xlsx', '.xls', '.csv'}

# Application Info
APP_TITLE = "다함 식자재 관리 시스템"
APP_VERSION = "2.0.0"
APP_DESCRIPTION = "Fast API 모듈 구조화 버전"
