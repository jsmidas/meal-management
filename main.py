#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
급식관리 시스템 - Smart Monolith Main Application
Railway 호환 버전 (식수 삭제 API 추가)
"""

# ⚠️ 최우선: UTF-8 인코딩 강제 설정 (중국어/일본어 등 다국어 지원)
import sys
import io
if sys.platform == 'win32':
    # Windows에서 cp949 대신 UTF-8 사용
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    print("[ENCODING] Windows UTF-8 모드 활성화 ✓")

import os
import json
import uvicorn
import threading
import time
import re
import unicodedata
from fastapi import FastAPI, Request, Body, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
# from starlette.middleware.wsgi import WSGIMiddleware  # Blog app 제거됨
from typing import Optional

# .env 파일 로드 (Railway DB 연결용)
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("[ENV] .env 파일 로드 시도 (via python-dotenv)")
except:
    pass

# DATABASE_URL이 없으면 수동 파싱 시도 (python-dotenv 실패 등 대비)
if not os.environ.get('DATABASE_URL'):
    print("[ENV] DATABASE_URL 미발견 - 수동 파싱 시작")
    try:
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(env_path):
            print(f"[ENV] .env 파일 발견: {env_path}")
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        key, value = line.split('=', 1)
                        os.environ[key.strip()] = value.strip()
            print(f"[ENV] 수동 로드 완료. URL: {os.environ.get('DATABASE_URL', '')[:20]}...")
        else:
            print("[ENV] .env 파일 없음")
    except Exception as e:
        print(f"[ENV] 수동 로드 실패: {e}")

# Core 모듈 임포트
from core.database import fix_encoding, get_db_connection, simple_unit_price_calculation
from utils.batch_calculation import run_batch_calculation, batch_calculation_status

from datetime import datetime, timedelta
# 라우터 임포트
from routers import ingredients, auth, users, suppliers, recipes, admin, site_structure, user_context, orders, order_instructions, order_calculation, supplier_portal, uploads, notices, system_requests, sales, instructions, ingredient_bulk_change, health_certificates, event_templates, events, event_orders, backup, hierarchy, meal_counts, meal_templates, meal_slot_settings, tenants
# 설정값
from core.config import APP_MODE, APP_TITLE as _CONFIG_TITLE
APP_TITLE = _CONFIG_TITLE
APP_VERSION = "1.0.0"
APP_DESCRIPTION = "급식관리 시스템"

# Railway/GCP 환경변수 지원 (하위 호환성 포함)
PORT = int(os.environ.get("PORT", os.environ.get("API_PORT", 8080)))
HOST = "0.0.0.0"
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ★ M-3: 사업장명 정규화 함수 (공백/유니코드 차이 제거)
def normalize_client_name(name: str) -> str:
    """사업장명 정규화: strip + 연속공백 제거 + NFC 정규화"""
    if not name:
        return name
    return unicodedata.normalize('NFC', re.sub(r'\s+', ' ', name.strip()))

# FastAPI 앱 생성
app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://dahamfood.kr", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 서버 종료 시 커넥션 풀 정리
@app.on_event("shutdown")
async def shutdown_cleanup():
    """서버 종료 시 DB 커넥션 풀 정리"""
    from core.database import close_connection_pool
    close_connection_pool()


# 서버 시작 시 DB 마이그레이션 실행
@app.on_event("startup")
async def startup_db_migration():
    """서버 시작 시 필요한 DB 테이블/컬럼 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 핵심 테이블 생성 (새 DB에서 필수)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(50) DEFAULT 'user',
                    full_name VARCHAR(100),
                    email VARCHAR(200),
                    token TEXT,
                    tenant_id INTEGER,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS site_groups (
                    id SERIAL PRIMARY KEY,
                    group_name VARCHAR(200) NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    address TEXT,
                    region TEXT,
                    abbreviation VARCHAR(50),
                    is_active BOOLEAN DEFAULT TRUE
                );
                CREATE TABLE IF NOT EXISTS site_categories (
                    id SERIAL PRIMARY KEY,
                    group_id INTEGER REFERENCES site_groups(id),
                    category_code VARCHAR(50),
                    category_name VARCHAR(200) NOT NULL,
                    meal_types JSONB DEFAULT '["조식", "중식", "석식"]',
                    meal_items JSONB DEFAULT '["일반"]',
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE
                );
                CREATE TABLE IF NOT EXISTS recipe_categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    abbreviation VARCHAR(10),
                    display_order INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS menu_recipes (
                    id SERIAL PRIMARY KEY,
                    recipe_code VARCHAR(50),
                    recipe_name VARCHAR(200) NOT NULL,
                    base_name VARCHAR(200),
                    prefix VARCHAR(50) DEFAULT '',
                    suffix VARCHAR(50) DEFAULT '',
                    category VARCHAR(100),
                    category_id INTEGER,
                    site_id INTEGER,
                    cooking_note TEXT,
                    cooking_yield_rate FLOAT DEFAULT 100,
                    total_cost FLOAT DEFAULT 0,
                    serving_size INTEGER DEFAULT 1,
                    photo_path TEXT,
                    scope VARCHAR(20) DEFAULT 'global',
                    owner_site_id INTEGER,
                    owner_group_id INTEGER,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS menu_recipe_ingredients (
                    id SERIAL PRIMARY KEY,
                    recipe_id INTEGER REFERENCES menu_recipes(id) ON DELETE CASCADE,
                    ingredient_code VARCHAR(50),
                    ingredient_name VARCHAR(200),
                    specification VARCHAR(200),
                    unit VARCHAR(50),
                    quantity FLOAT DEFAULT 0,
                    amount FLOAT DEFAULT 0,
                    selling_price FLOAT DEFAULT 0,
                    supplier_name VARCHAR(200),
                    delivery_days INTEGER DEFAULT 0,
                    required_grams FLOAT DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS ingredients (
                    id SERIAL PRIMARY KEY,
                    ingredient_code VARCHAR(50) UNIQUE,
                    name VARCHAR(200),
                    specification VARCHAR(200),
                    unit VARCHAR(50),
                    price FLOAT DEFAULT 0,
                    price_per_unit FLOAT DEFAULT 0,
                    supplier_name VARCHAR(200),
                    category VARCHAR(100),
                    base_weight_grams FLOAT DEFAULT 1000,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS suppliers (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    contact_name VARCHAR(100),
                    phone VARCHAR(50),
                    email VARCHAR(200),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS meal_plans (
                    id SERIAL PRIMARY KEY,
                    site_id INTEGER,
                    plan_date DATE NOT NULL,
                    slot_name VARCHAR(100),
                    category VARCHAR(100),
                    menus JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    order_number VARCHAR(50),
                    site_id INTEGER,
                    order_date DATE,
                    usage_date DATE,
                    status VARCHAR(20) DEFAULT 'pending',
                    order_type VARCHAR(20) DEFAULT 'regular',
                    total_amount FLOAT DEFAULT 0,
                    notes TEXT,
                    template_id INTEGER,
                    template_name VARCHAR(200),
                    attendees INTEGER,
                    merged_into VARCHAR(50),
                    merged_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS order_items (
                    id SERIAL PRIMARY KEY,
                    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                    ingredient_code VARCHAR(50),
                    ingredient_name VARCHAR(200),
                    specification VARCHAR(200),
                    unit VARCHAR(50),
                    unit_price FLOAT DEFAULT 0,
                    required_qty FLOAT DEFAULT 0,
                    order_qty FLOAT DEFAULT 0,
                    total_price FLOAT DEFAULT 0,
                    supplier_name VARCHAR(200),
                    menu_name VARCHAR(200),
                    recipe_id INTEGER
                );
                CREATE TABLE IF NOT EXISTS meal_counts (
                    id SERIAL PRIMARY KEY,
                    site_id INTEGER,
                    count_date DATE,
                    slot_name VARCHAR(200),
                    category VARCHAR(100),
                    client_name VARCHAR(200),
                    meal_type VARCHAR(50),
                    count INTEGER DEFAULT 0,
                    menu_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            # 누락 컬럼 추가 (새 DB용)
            for tbl_col in [
                ("site_groups", "group_code", "VARCHAR(50)"),
                ("site_groups", "group_name", "VARCHAR(200)"),
                ("menu_recipes", "created_by", "VARCHAR(100)"),
                ("business_locations", "abbreviation", "VARCHAR(50)"),
                ("business_locations", "contract_end_date", "DATE"),
                ("business_locations", "contract_start_date", "DATE"),
                ("business_locations", "health_cert_expiry", "DATE"),
                ("business_locations", "category_id", "INTEGER"),
                ("business_locations", "display_order", "INTEGER DEFAULT 0"),
                ("site_categories", "meal_types", "TEXT"),
                ("site_categories", "meal_items", "TEXT"),
                ("site_categories", "address", "TEXT"),
                ("site_categories", "region", "TEXT"),
                ("site_categories", "abbreviation", "VARCHAR(50)"),
            ]:
                try:
                    cursor.execute(f"""
                        DO $$ BEGIN
                            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '{tbl_col[0]}' AND column_name = '{tbl_col[1]}')
                            THEN ALTER TABLE {tbl_col[0]} ADD COLUMN {tbl_col[1]} {tbl_col[2]};
                            END IF;
                        END $$;
                    """)
                except Exception:
                    pass
            conn.commit()

            # business_locations
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS business_locations (
                    id SERIAL PRIMARY KEY,
                    group_id INTEGER,
                    site_code VARCHAR(50),
                    site_name VARCHAR(200),
                    site_type VARCHAR(50),
                    business_category VARCHAR(100),
                    address TEXT,
                    region TEXT,
                    manager_name VARCHAR(100),
                    manager_phone VARCHAR(50),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            # user_site_access
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_site_access (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    site_id INTEGER,
                    is_active BOOLEAN DEFAULT TRUE
                );
            """)
            # category_slots + slot_clients
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS category_slots (
                    id SERIAL PRIMARY KEY,
                    category_id INTEGER NOT NULL REFERENCES site_categories(id) ON DELETE CASCADE,
                    slot_code VARCHAR(50),
                    slot_name VARCHAR(200) NOT NULL,
                    description TEXT,
                    target_cost INTEGER DEFAULT 0,
                    selling_price INTEGER DEFAULT 0,
                    display_order INTEGER DEFAULT 0,
                    meal_type VARCHAR(50),
                    is_active BOOLEAN DEFAULT TRUE,
                    modified_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS slot_clients (
                    id SERIAL PRIMARY KEY,
                    slot_id INTEGER NOT NULL REFERENCES category_slots(id) ON DELETE CASCADE,
                    business_location_id INTEGER,
                    client_code VARCHAR(50),
                    client_name VARCHAR(200) NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    start_date DATE,
                    end_date DATE,
                    operating_days TEXT DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}',
                    modified_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            # ★ 체험판 관리: tenants 테이블 (핵심 테이블과 함께 생성)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tenants (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    contact_name VARCHAR(100),
                    contact_email VARCHAR(200),
                    contact_phone VARCHAR(50),
                    plan VARCHAR(20) DEFAULT 'trial',
                    status VARCHAR(20) DEFAULT 'active',
                    trial_start TIMESTAMP DEFAULT NOW(),
                    trial_end TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
                    max_users INTEGER DEFAULT 3,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            conn.commit()
            print("[DB] 핵심 테이블 + tenants 생성/확인 완료")

            # users 테이블 누락 컬럼 추가
            for col_def in [
                ("tenant_id", "INTEGER REFERENCES tenants(id)"),
                ("password_hash", "VARCHAR(255)"),
                ("is_active", "BOOLEAN DEFAULT TRUE"),
                ("managed_site", "VARCHAR(200)"),
            ]:
                try:
                    cursor.execute(f"""
                        DO $$
                        BEGIN
                            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = '{col_def[0]}')
                            THEN ALTER TABLE users ADD COLUMN {col_def[0]} {col_def[1]};
                            END IF;
                        END $$;
                    """)
                    conn.commit()
                except Exception:
                    conn.rollback()

            # password → password_hash 동기화
            try:
                cursor.execute("UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL")
                conn.commit()
            except Exception:
                conn.rollback()

            # meal_counts 테이블에 menu_order 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'menu_order'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN menu_order INTEGER DEFAULT 0;
                    END IF;
                END $$;
            """)

            # meal_counts 테이블에 work_date 컬럼 추가 (meal_counts.py 라우터에서 사용)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'work_date'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN work_date DATE;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'business_type'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN business_type VARCHAR(50);
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'menu_name'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN menu_name VARCHAR(100);
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'matching_name'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN matching_name VARCHAR(100);
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'site_name'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN site_name VARCHAR(100);
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_counts' AND column_name = 'meal_count'
                    ) THEN
                        ALTER TABLE meal_counts ADD COLUMN meal_count INTEGER DEFAULT 0;
                    END IF;
                END $$;
            """)

            # users 테이블에 full_name 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'full_name'
                    ) THEN
                        ALTER TABLE users ADD COLUMN full_name VARCHAR(100);
                    END IF;
                END $$;
            """)

            # preprocessing_instructions 테이블 생성 (없으면)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS preprocessing_instructions (
                    id SERIAL PRIMARY KEY,
                    instruction_number VARCHAR(50) UNIQUE NOT NULL,
                    cooking_date DATE NOT NULL,
                    site_id INTEGER,
                    status VARCHAR(20) DEFAULT 'draft',
                    total_items INTEGER DEFAULT 0,
                    notes TEXT,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)

            # preprocessing_instruction_items 테이블 생성 (없으면)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS preprocessing_instruction_items (
                    id SERIAL PRIMARY KEY,
                    instruction_id INTEGER REFERENCES preprocessing_instructions(id) ON DELETE CASCADE,
                    ingredient_id INTEGER,
                    ingredient_code VARCHAR(50),
                    ingredient_name VARCHAR(200),
                    specification VARCHAR(200),
                    unit VARCHAR(50),
                    order_qty DECIMAL(10,2),
                    yield_rate DECIMAL(5,2) DEFAULT 100,
                    final_qty DECIMAL(10,2),
                    preprocessing_instructions TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)

            # preprocessing_yields 테이블에 cut_type 컬럼 추가 (절단 모양: 어슷썰기, 사각썰기 등)
            cursor.execute("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_name = 'preprocessing_yields'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'preprocessing_yields' AND column_name = 'cut_type'
                    ) THEN
                        ALTER TABLE preprocessing_yields ADD COLUMN cut_type VARCHAR(100) DEFAULT '';
                    END IF;
                END $$;
            """)

            # preprocessing_instruction_items 테이블에 cut_type 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'preprocessing_instruction_items' AND column_name = 'cut_type'
                    ) THEN
                        ALTER TABLE preprocessing_instruction_items ADD COLUMN cut_type VARCHAR(100) DEFAULT '';
                    END IF;
                END $$;
            """)

            # ★★★ Phase 0: category_slots 테이블 생성 (DB 이관 시 누락 방지) ★★★
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS category_slots (
                    id SERIAL PRIMARY KEY,
                    category_id INTEGER NOT NULL REFERENCES site_categories(id) ON DELETE CASCADE,
                    slot_code VARCHAR(50),
                    slot_name VARCHAR(200) NOT NULL,
                    description TEXT,
                    target_cost INTEGER DEFAULT 0,
                    selling_price INTEGER DEFAULT 0,
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] category_slots 테이블 확인/생성 완료")

            # ★ 성능 최적화: category_slots 인덱스 (meal_counts LEFT JOIN용)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_category_slots_slot_name ON category_slots(slot_name, is_active);
            """)

            # ★★★ Phase 0: slot_clients 테이블 생성 (DB 이관 시 누락 방지) ★★★
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS slot_clients (
                    id SERIAL PRIMARY KEY,
                    slot_id INTEGER NOT NULL REFERENCES category_slots(id) ON DELETE CASCADE,
                    business_location_id INTEGER,
                    client_code VARCHAR(50),
                    client_name VARCHAR(200) NOT NULL,
                    display_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    start_date DATE,
                    end_date DATE,
                    operating_days TEXT DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] slot_clients 테이블 확인/생성 완료")

            # slot_clients 테이블에 start_date, end_date 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'start_date'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN start_date DATE;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'end_date'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN end_date DATE;
                    END IF;
                END $$;
            """)

            # slot_clients.is_active가 NULL인 경우 TRUE로 설정
            cursor.execute("""
                UPDATE slot_clients SET is_active = TRUE WHERE is_active IS NULL
            """)

            # ★ C-1: slot_clients, category_slots에 modified_by 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'modified_by'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN modified_by VARCHAR(100);
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'category_slots' AND column_name = 'modified_by'
                    ) THEN
                        ALTER TABLE category_slots ADD COLUMN modified_by VARCHAR(100);
                    END IF;
                END $$;
            """)

            # ★ C-2: slot_clients 중복 방지 UNIQUE 인덱스 (같은 슬롯 내 활성 사업장명 중복 불가)
            cursor.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_clients_slot_client
                ON slot_clients (slot_id, client_name) WHERE is_active = TRUE
            """)

            # ★ M-2: category_slots 중복 방지 UNIQUE 인덱스 (같은 카테고리 내 활성 슬롯명 중복 불가)
            cursor.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_category_slots_cat_slot
                ON category_slots (category_id, slot_name) WHERE is_active = TRUE
            """)

            # slot_clients에 operating_days 컬럼 추가 (요일별 운영 설정)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'operating_days'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN operating_days TEXT DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}';
                    END IF;
                END $$;
            """)

            # ★ slot_clients에 끼니별 요일 스케줄 + 특별 운영일 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    -- operating_schedule: 요일별 끼니 운영 설정 (JSON)
                    -- 예: {"mon":{"조식":false,"중식":true,"석식":false,"야식":false},...}
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'operating_schedule'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN operating_schedule TEXT;
                    END IF;

                    -- special_dates: 특별 운영일 목록 (JSON 배열)
                    -- 예: [{"date":"2026-02-15","meals":["조식","중식"],"memo":"설날"},{"date":"2026-03-01","meals":[],"memo":"휴무"}]
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'slot_clients' AND column_name = 'special_dates'
                    ) THEN
                        ALTER TABLE slot_clients ADD COLUMN special_dates TEXT DEFAULT '[]';
                    END IF;
                END $$;
            """)

            # ★ category_slots에 meal_type 컬럼 추가 (끼니 타입: 조식/중식/석식/야식)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'category_slots' AND column_name = 'meal_type'
                    ) THEN
                        ALTER TABLE category_slots ADD COLUMN meal_type VARCHAR(20) DEFAULT '중식';
                    END IF;
                END $$;
            """)

            # menu_recipes 테이블에 prefix, suffix, created_by 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'menu_recipes' AND column_name = 'prefix'
                    ) THEN
                        ALTER TABLE menu_recipes ADD COLUMN prefix VARCHAR(50) DEFAULT '';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'menu_recipes' AND column_name = 'suffix'
                    ) THEN
                        ALTER TABLE menu_recipes ADD COLUMN suffix VARCHAR(50) DEFAULT '';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'menu_recipes' AND column_name = 'created_by'
                    ) THEN
                        ALTER TABLE menu_recipes ADD COLUMN created_by VARCHAR(100) DEFAULT '';
                    END IF;
                END $$;
            """)

            # ★★★ 성능 개선을 위한 인덱스 추가 ★★★
            performance_indexes = [
                ("idx_meal_counts_site_work", "meal_counts", "(site_id, work_date)"),
                ("idx_meal_counts_menu", "meal_counts", "(menu_name, category, site_name)"),
                ("idx_slot_clients_slot_active", "slot_clients", "(slot_id, is_active)"),
                ("idx_category_slots_category_active", "category_slots", "(category_id, is_active)"),
                ("idx_suppliers_active", "suppliers", "(is_active)"),
                ("idx_ingredients_supplier", "ingredients", "(supplier_name)"),
            ]

            for idx_name, table_name, columns in performance_indexes:
                try:
                    cursor.execute(f"""
                        CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name} {columns}
                    """)
                except Exception as idx_err:
                    print(f"[DB] 인덱스 {idx_name} 생성 스킵: {idx_err}")

            # ★ 체험판 관리: tenants 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tenants (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    contact_name VARCHAR(100),
                    contact_email VARCHAR(200),
                    contact_phone VARCHAR(50),
                    plan VARCHAR(20) DEFAULT 'trial',
                    status VARCHAR(20) DEFAULT 'active',
                    trial_start TIMESTAMP DEFAULT NOW(),
                    trial_end TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
                    max_users INTEGER DEFAULT 3,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] tenants 테이블 확인/생성 완료")

            # users 테이블에 tenant_id 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'tenant_id'
                    ) THEN
                        ALTER TABLE users ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
                    END IF;
                END $$;
            """)

            # ★ 식자재 단가 이력: ingredient_prices 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ingredient_prices (
                    id SERIAL PRIMARY KEY,
                    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                    price NUMERIC(12,2),
                    unit_price NUMERIC(12,4),
                    effective_from DATE NOT NULL,
                    effective_to DATE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(ingredient_id, effective_from)
                )
            """)
            print("[DB] ingredient_prices 테이블 확인/생성 완료")

            # ★ 창고 관리: warehouses 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS warehouses (
                    id SERIAL PRIMARY KEY,
                    site_id INTEGER,
                    name VARCHAR(200) NOT NULL,
                    code VARCHAR(50),
                    address TEXT,
                    contact_name VARCHAR(100),
                    contact_phone VARCHAR(50),
                    is_default BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] warehouses 테이블 확인/생성 완료")

            # ★ 사업장 관리: business_locations 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS business_locations (
                    id SERIAL PRIMARY KEY,
                    site_code VARCHAR(50),
                    site_name VARCHAR(200) NOT NULL,
                    site_type VARCHAR(50) DEFAULT '급식업체',
                    business_category VARCHAR(50) DEFAULT 'management',
                    group_id INTEGER,
                    category_id INTEGER,
                    region VARCHAR(100),
                    address TEXT,
                    phone VARCHAR(50),
                    manager_name VARCHAR(100),
                    manager_phone VARCHAR(50),
                    abbreviation VARCHAR(20),
                    has_categories BOOLEAN DEFAULT FALSE,
                    display_order INTEGER DEFAULT 0,
                    contract_end_date DATE,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] business_locations 테이블 확인/생성 완료")

            # orders 테이블에 누락 컬럼 추가
            for col_name, col_def in [
                ('warehouse_id', 'INTEGER'),
                ('total_items', 'INTEGER DEFAULT 0'),
                ('created_by', 'INTEGER'),
                ('confirmed_by', 'INTEGER'),
                ('confirmed_at', 'TIMESTAMP'),
                ('locked_at', 'TIMESTAMP'),
                ('updated_at', 'TIMESTAMP DEFAULT NOW()'),
                ('expected_delivery_date', 'DATE'),
                ('parent_order_id', 'INTEGER'),
                ('meal_counts_snapshot', 'JSONB'),
                ('snapshot_created_at', 'TIMESTAMP'),
            ]:
                cursor.execute(f"""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'orders' AND column_name = '{col_name}'
                        ) THEN
                            ALTER TABLE orders ADD COLUMN {col_name} {col_def};
                        END IF;
                    END $$;
                """)

            # site_categories 테이블에 누락 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'site_categories' AND column_name = 'meal_types'
                    ) THEN
                        ALTER TABLE site_categories ADD COLUMN meal_types JSONB DEFAULT '["조식", "중식", "석식"]';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'site_categories' AND column_name = 'meal_items'
                    ) THEN
                        ALTER TABLE site_categories ADD COLUMN meal_items JSONB DEFAULT '["일반"]';
                    END IF;
                END $$;
            """)
            print("[DB] site_categories 누락 컬럼 추가 완료")

            # site_groups 테이블에 group_code 컬럼 추가
            cursor.execute("ALTER TABLE site_groups ADD COLUMN IF NOT EXISTS group_code VARCHAR(50)")

            # ingredients 테이블에 purchase_price 컬럼 추가
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS purchase_price FLOAT DEFAULT 0")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS ingredient_name VARCHAR(200)")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS selling_price FLOAT DEFAULT 0")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS posting_status VARCHAR(10) DEFAULT '유'")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS origin VARCHAR(100)")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS sub_category VARCHAR(100)")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS tax_type VARCHAR(20)")
            cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS delivery_days VARCHAR(50)")
            # customer_supplier_mappings 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS customer_supplier_mappings (
                    id SERIAL PRIMARY KEY,
                    customer_id INTEGER NOT NULL,
                    supplier_id INTEGER NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            print("[DB] site_groups, ingredients, customer_supplier_mappings 누락 컬럼/테이블 추가 완료")

            # events 테이블에 site_id 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'events' AND column_name = 'site_id'
                    ) THEN
                        ALTER TABLE events ADD COLUMN site_id INTEGER;
                    END IF;
                END $$;
            """)
            print("[DB] events 누락 컬럼 추가 완료")

            conn.commit()
            cursor.close()
            print("[DB] 마이그레이션 완료: 컬럼 추가 + 성능 인덱스")
    except Exception as e:
        print(f"[DB] 마이그레이션 오류 (무시): {e}")

# 개발 모드: 캐시 비활성화 미들웨어
@app.middleware("http")
async def disable_cache_in_dev(request: Request, call_next):
    """개발 중 브라우저 캐시 문제 방지"""
    response = await call_next(request)

    # HTML, CSS, JS 파일은 캐시 비활성화
    if any(request.url.path.endswith(ext) for ext in ['.html', '.css', '.js', '.json']):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    return response

# 정적 파일 서빙
try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
    # 호환성을 위한 추가 마운트
    app.mount("/modules", StaticFiles(directory="static/modules"), name="modules")
    # 템플릿 파일 직접 마운트 (Railway 호환성)
    app.mount("/templates", StaticFiles(directory="static/templates"), name="templates")
except Exception as e:
    print(f"Static files mounting failed: {e}")

# Blog app 제거됨 (판매용 버전에서는 불필요)

# Railway 호환성: 템플릿 파일 직접 서빙
@app.get("/static/templates/{template_name}")
async def serve_template(template_name: str):
    """Railway에서 템플릿 파일 서빙"""
    try:
        import os
        template_path = f"static/templates/{template_name}"
        if os.path.exists(template_path):
            return FileResponse(template_path, media_type="text/html")
        else:
            return {"error": f"Template {template_name} not found"}
    except Exception as e:
        return {"error": str(e)}



# ★★★ 통합 API (성능 최적화) - 라우터보다 먼저 등록 ★★★
@app.get("/api/meal-management/init")
async def get_meal_management_init(site_id: int, date: str):
    """
    식수 관리 페이지 초기화용 통합 API
    - 현재일 식수 데이터
    - 전일 식수 데이터
    - 템플릿 목록
    모두 한 번에 조회하여 API 호출 횟수 감소 (4개 → 1개)

    ★ site_id는 site_groups.id (본사=1, 영남=2 등)
    - 프론트엔드(SiteSelector)에서 group_id를 site_id로 전달
    """
    from datetime import datetime, timedelta

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 전일 날짜 계산
            current_date = datetime.strptime(date, "%Y-%m-%d")
            prev_date = (current_date - timedelta(days=1)).strftime("%Y-%m-%d")

            print(f"[API] meal-management/init: date={date}, site_id={site_id}")

            # 1. 현재일 식수 데이터 (site_id로 필터링)
            site_filter = " AND site_id = %s" if site_id else ""
            params_current = [date] + ([site_id] if site_id else [])

            cursor.execute(f"""
                SELECT mc.id, mc.work_date, COALESCE(mc.category, mc.business_type) AS business_type, mc.menu_name, mc.matching_name,
                       COALESCE(cs.meal_type, mc.meal_type) AS meal_type, mc.site_name, mc.meal_count, mc.menu_order, mc.created_at, mc.updated_at
                FROM meal_counts mc
                LEFT JOIN category_slots cs ON cs.slot_name = mc.menu_name AND cs.is_active = true
                WHERE mc.work_date = %s{site_filter.replace('site_id', 'mc.site_id')}
                ORDER BY COALESCE(mc.category, mc.business_type), COALESCE(mc.menu_order, 999), mc.menu_name, mc.site_name
            """, params_current)

            current_rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            current_data = []
            for row in current_rows:
                item = dict(zip(columns, row))
                if item.get('work_date'): item['work_date'] = str(item['work_date'])
                if item.get('created_at'): item['created_at'] = str(item['created_at'])
                if item.get('updated_at'): item['updated_at'] = str(item['updated_at'])
                current_data.append(item)

            # 2. 전일 식수 데이터 (site_id로 필터링)
            params_prev = [prev_date] + ([site_id] if site_id else [])

            cursor.execute(f"""
                SELECT mc.id, mc.work_date, COALESCE(mc.category, mc.business_type) AS business_type, mc.menu_name, mc.matching_name,
                       COALESCE(cs.meal_type, mc.meal_type) AS meal_type, mc.site_name, mc.meal_count, mc.menu_order, mc.created_at, mc.updated_at
                FROM meal_counts mc
                LEFT JOIN category_slots cs ON cs.slot_name = mc.menu_name AND cs.is_active = true
                WHERE mc.work_date = %s{site_filter.replace('site_id', 'mc.site_id')}
                ORDER BY COALESCE(mc.category, mc.business_type), COALESCE(mc.menu_order, 999), mc.menu_name, mc.site_name
            """, params_prev)

            prev_rows = cursor.fetchall()

            prev_data = []
            for row in prev_rows:
                item = dict(zip(columns, row))
                if item.get('work_date'): item['work_date'] = str(item['work_date'])
                if item.get('created_at'): item['created_at'] = str(item['created_at'])
                if item.get('updated_at'): item['updated_at'] = str(item['updated_at'])
                prev_data.append(item)

            # 3. 템플릿 목록
            cursor.execute("""
                SELECT id, template_name, description, template_data, created_at, updated_at,
                       valid_from, valid_to, apply_days
                FROM meal_templates
                ORDER BY updated_at DESC
            """)

            template_rows = cursor.fetchall()
            templates = []
            for row in template_rows:
                templates.append({
                    "id": row[0],
                    "template_name": row[1],
                    "description": row[2],
                    "template_data": row[3],
                    "created_at": str(row[4]) if row[4] else None,
                    "updated_at": str(row[5]) if row[5] else None,
                    "valid_from": str(row[6]) if row[6] else None,
                    "valid_to": str(row[7]) if row[7] else None,
                    "apply_days": row[8] or ""
                })

            # 4. 템플릿 스케줄 조회 (해당 날짜에 지정된 템플릿)
            schedule_query = """
                SELECT ts.id, ts.schedule_date, ts.template_id, ts.day_type, ts.site_id,
                       mt.template_name, mt.template_data
                FROM template_schedule ts
                LEFT JOIN meal_templates mt ON ts.template_id = mt.id
                WHERE ts.schedule_date = %s
            """
            schedule_params = [date]
            if site_id:
                schedule_query += " AND ts.site_id = %s"
                schedule_params.append(site_id)

            cursor.execute(schedule_query, schedule_params)
            schedule_row = cursor.fetchone()

            schedule_data = None
            if schedule_row:
                schedule_data = {
                    "id": schedule_row[0],
                    "schedule_date": str(schedule_row[1]),
                    "template_id": schedule_row[2],
                    "day_type": schedule_row[3],
                    "site_id": schedule_row[4],
                    "template_name": schedule_row[5],
                    "template_data": schedule_row[6]
                }

            # 5. ★★★ 통합: category_slots에서 슬롯+사업장 한번에 조회 ★★★
            # category_slots를 단일 마스터 테이블로 사용 (meal_slot_settings 대체)
            # ★★★ 날짜 필터링: start_date/end_date 범위 내의 사업장만 표시
            # ★★★ 요일 필터링: operating_days 기준으로 해당 요일에 운영하는 사업장만 표시
            day_names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
            current_day = day_names[current_date.weekday()]  # 0=Monday, 6=Sunday

            # ★★★ Phase 1: 요일 필터링 버그 수정 - 파라미터 바인딩 사용 ★★★
            # ★★★ Phase 2: 끼니별 스케줄 + 특별 운영일 지원 ★★★
            unified_query = """
                SELECT
                    scat.id as category_id,
                    scat.category_name,
                    sg.id as group_id,
                    sg.group_name,
                    cs.id as slot_id,
                    cs.slot_code,
                    cs.slot_name,
                    cs.display_order,
                    COALESCE(cs.target_cost, 0) as target_cost,
                    COALESCE(cs.selling_price, 0) as selling_price,
                    cs.meal_type,
                    scl.id as client_id,
                    scl.client_name,
                    scl.display_order as client_order,
                    scl.operating_schedule,
                    scl.special_dates
                FROM category_slots cs
                JOIN site_categories scat ON cs.category_id = scat.id
                JOIN site_groups sg ON scat.group_id = sg.id
                LEFT JOIN slot_clients scl ON scl.slot_id = cs.id
                    AND scl.is_active = TRUE
                    AND (scl.start_date IS NULL OR scl.start_date <= %s)
                    AND (scl.end_date IS NULL OR scl.end_date >= %s)
                    AND (scl.operating_days IS NULL
                         OR scl.operating_days = ''
                         OR (scl.operating_days::json->>%s)::boolean = true)
                WHERE cs.is_active = TRUE
            """
            unified_params = [date, date, current_day]  # 날짜 필터링 + 요일 필터링

            # ★ 슬롯명에서 끼니 유형 추출 함수
            def extract_meal_type(slot_name):
                if not slot_name:
                    return None
                if '조식' in slot_name:
                    return '조식'
                elif '중식' in slot_name:
                    return '중식'
                elif '석식' in slot_name:
                    return '석식'
                elif '야식' in slot_name:
                    return '야식'
                return None

            # ★ 클라이언트가 현재 날짜/요일에 운영하는지 확인
            def should_include_client(slot_name, operating_schedule, special_dates_str, target_date, weekday):
                import json
                target_date_str = str(target_date)

                # 1. 특별 운영일 체크 (최우선)
                if special_dates_str:
                    try:
                        special_dates = json.loads(special_dates_str)
                        for sd in special_dates:
                            if sd.get('date') == target_date_str:
                                meals = sd.get('meals', [])
                                if not meals:  # 휴무
                                    return False
                                # 특별 운영: 해당 끼니가 포함되어 있는지 확인
                                meal_type = extract_meal_type(slot_name)
                                if meal_type and meal_type in meals:
                                    return True
                                elif not meal_type:  # 슬롯에 끼니 정보 없으면 운영
                                    return True
                                return False
                    except:
                        pass

                # 2. 끼니별 스케줄 체크 (operating_schedule이 있으면)
                if operating_schedule:
                    try:
                        schedule = json.loads(operating_schedule) if isinstance(operating_schedule, str) else operating_schedule
                        meal_type = extract_meal_type(slot_name)
                        if meal_type and weekday in schedule:
                            return schedule[weekday].get(meal_type, True)
                    except:
                        pass

                # 3. 기본: 이미 operating_days 필터를 통과했으므로 True
                return True
            if site_id:
                unified_query += " AND sg.id = %s"
                unified_params.append(site_id)
            # ★★★ 슬롯 정렬: category_slots.meal_type 기준 (조식 > 중식 > 석식 > 야식 > 행사 > 기타) ★★★
            unified_query += """
                ORDER BY sg.id, scat.id,
                    CASE cs.meal_type
                        WHEN '조식' THEN 1
                        WHEN '중식' THEN 2
                        WHEN '석식' THEN 3
                        WHEN '야식' THEN 4
                        WHEN '행사' THEN 5
                        ELSE 6
                    END,
                    cs.display_order, scl.display_order
            """
            cursor.execute(unified_query, unified_params)
            unified_rows = cursor.fetchall()

            # 카테고리별 슬롯 그룹화 + 슬롯별 클라이언트 그룹화
            slots_by_category = {}
            slot_clients_map = {}
            seen_slots = set()  # 중복 슬롯 방지
            filtered_out_count = 0  # 필터링된 클라이언트 수

            for row in unified_rows:
                cat_id = row[0]
                cat_name = row[1]
                group_id = row[2]
                group_name = row[3]
                slot_id = row[4]
                slot_code = row[5]
                slot_name = row[6]
                display_order = row[7]
                target_cost = row[8]
                selling_price = row[9]
                slot_meal_type = row[10]  # ★ cs.meal_type
                client_id = row[11]
                client_name = row[12]
                client_order = row[13]
                operating_schedule = row[14] if len(row) > 14 else None
                special_dates_str = row[15] if len(row) > 15 else None

                if not cat_name:
                    continue

                # 슬롯 정보 추가 (중복 방지)
                slot_key = f"{cat_id}_{slot_id}"
                if slot_key not in seen_slots:
                    seen_slots.add(slot_key)
                    if cat_name not in slots_by_category:
                        slots_by_category[cat_name] = []
                    slots_by_category[cat_name].append({
                        "slot_id": slot_id,
                        "slot_key": slot_code or f"slot_{slot_id}",
                        "slot_name": slot_name,
                        "display_name": slot_name,
                        "sort_order": display_order or 0,
                        "target_cost": target_cost,
                        "selling_price": selling_price,
                        "meal_type": slot_meal_type or '중식'
                    })

                # ★★★ 끼니별 스케줄 + 특별 운영일 필터링 ★★★
                if client_name:
                    if should_include_client(slot_name, operating_schedule, special_dates_str, current_date, current_day):
                        # 클라이언트 정보 추가
                        if cat_name not in slot_clients_map:
                            slot_clients_map[cat_name] = {}
                        if slot_name not in slot_clients_map[cat_name]:
                            slot_clients_map[cat_name][slot_name] = []
                        if client_name not in slot_clients_map[cat_name][slot_name]:
                            slot_clients_map[cat_name][slot_name].append(client_name)
                    else:
                        filtered_out_count += 1

            if filtered_out_count > 0:
                print(f"[API] 끼니별 스케줄/특별 운영일 필터링으로 {filtered_out_count}개 사업장 제외됨")

            cursor.close()

            print(f"[API] 통합 초기화: site_id={site_id}, date={date}, 현재={len(current_data)}건, 전일={len(prev_data)}건, 템플릿={len(templates)}개, 스케줄={'있음' if schedule_data else '없음'}, 슬롯카테고리={len(slots_by_category)}개, 슬롯클라이언트={len(slot_clients_map)}개")

            return {
                "success": True,
                "currentDay": {"data": current_data, "count": len(current_data)},
                "previousDay": {"data": prev_data, "count": len(prev_data), "date": prev_date},
                "templates": templates,
                "schedule": schedule_data,
                "slots": slots_by_category,  # ★ 슬롯 데이터 추가 (카테고리별)
                "slotClients": slot_clients_map  # ★★★ 슬롯별 사업장 목록 (사업장관리와 동기화)
            }

    except Exception as e:
        print(f"[API] 통합 초기화 오류: {e}")
        try:
            if 'cursor' in locals() and cursor:
                cursor.close()
        except:
            pass
        return {"success": False, "error": str(e)}


# 라우터 등록 (순서 중요: 더 구체적인 경로가 먼저 매칭되도록)
app.include_router(ingredients.router, tags=["식자재"])
app.include_router(auth.router, tags=["인증"])
app.include_router(users.router, tags=["사용자"])
app.include_router(suppliers.router, tags=["협력업체"])
app.include_router(recipes.router, tags=["레시피"])
app.include_router(site_structure.router, tags=["사업장구조"])  # admin 보다 먼저 (sites/{id}/suppliers)
app.include_router(admin.router, tags=["관리자"])
app.include_router(user_context.router, tags=["사용자컨텍스트"])
app.include_router(orders.router, tags=["발주관리"])
app.include_router(order_instructions.router, tags=["지시서(전처리/조리/소분)"])
app.include_router(order_calculation.router, tags=["발주계산"])
app.include_router(supplier_portal.router, tags=["협력업체포털"])
app.include_router(uploads.router, tags=["파일업로드"])
app.include_router(notices.router, tags=["공지사항"])
app.include_router(system_requests.router, tags=["시스템요청"])
app.include_router(sales.router, tags=["매출관리"])
app.include_router(instructions.router, tags=["지시서관리"])
app.include_router(ingredient_bulk_change.router, tags=["식자재일괄변경"])
app.include_router(health_certificates.router, tags=["보건증관리"])
app.include_router(event_templates.router, tags=["행사템플릿"])
app.include_router(events.router, tags=["행사관리"])
app.include_router(event_orders.router, tags=["행사발주"])
app.include_router(backup.router, tags=["백업관리"])
app.include_router(hierarchy.router, tags=["계층구조"])
app.include_router(meal_counts.router, tags=["식수관리"])
app.include_router(meal_templates.router, tags=["식단템플릿"])
app.include_router(meal_slot_settings.router, tags=["슬롯설정"])
app.include_router(tenants.router, tags=["체험판"])

# 백업 시스템 초기화
try:
    backup.init_backup_system()
except Exception as e:
    print(f"[백업 시스템] 초기화 경고: {e}")

# 추가 호환성 엔드포인트 (기존 프론트엔드와의 호환을 위해)
from fastapi import Body

# 루트 엔드포인트 - 로그인 페이지로 리다이렉트
@app.get("/")
async def root():
    return RedirectResponse(url="/login.html")

# API 상태 확인용 엔드포인트
@app.get("/api/status")
async def api_status():
    return {
        "status": "ok",
        "message": f"{APP_TITLE} API 서버",
        "version": APP_VERSION,
        "architecture": "smart_monolith"
    }

@app.get("/debug/database")
async def debug_database():
    """데이터베이스 연결 디버그 정보"""
    return {
        "DATABASE_URL_exists": bool(DATABASE_URL),
        "DATABASE_URL_preview": DATABASE_URL[:50] + "..." if DATABASE_URL and len(DATABASE_URL) > 50 else DATABASE_URL,
        "environment": "Railway" if 'RAILWAY_ENVIRONMENT' in os.environ else "Local",
        "railway_vars": {k: v for k, v in os.environ.items() if k.startswith('RAILWAY')}
    }

# 헬스체크
_last_health_check = {"ok": True, "ts": 0}

@app.get("/health")
async def health_check():
    import time
    now = time.time()
    # 10초 TTL 캐시 - Fly.io 헬스체크 빈도 대응
    if now - _last_health_check["ts"] < 10:
        if _last_health_check["ok"]:
            return {"status": "ok"}
        return JSONResponse(status_code=503, content={"status": "unhealthy"})
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        _last_health_check.update({"ok": True, "ts": now})
        return {"status": "ok"}
    except Exception as e:
        _last_health_check.update({"ok": False, "ts": now})
        return JSONResponse(status_code=503, content={"status": "unhealthy", "error": str(e)})

# HTML 파일 서빙
@app.get("/menu_recipe_management.html")
async def serve_menu_recipe_management():
    return FileResponse("menu_recipe_management.html")

@app.get("/recipe_fix.html")
async def serve_recipe_fix():
    return FileResponse("recipe_fix.html")

@app.get("/login.html")
async def serve_login():
    return FileResponse("login.html")

@app.get("/admin_dashboard.html")
async def serve_admin_dashboard():
    return FileResponse("admin_dashboard.html")

@app.get("/dashboard.html")
async def serve_dashboard():
    return FileResponse("dashboard.html")

@app.get("/meal_plan_advanced.html")
async def serve_meal_plan_advanced():
    return FileResponse("meal_plan_advanced.html")

@app.get("/meal_plan_print.html")
async def serve_meal_plan_print():
    return FileResponse("meal_plan_print.html")

@app.get("/meal_count_management.html")
async def serve_meal_count_management():
    return FileResponse("meal_count_management.html")

@app.get("/meal_count_inquiry.html")
async def serve_meal_count_inquiry():
    return FileResponse("meal_count_inquiry.html")

@app.get("/ingredients_management.html")
async def serve_ingredients_management():
    return FileResponse("ingredients_management.html")

@app.get("/ordering_management.html")
async def serve_ordering_management():
    return FileResponse("ordering_management.html")

@app.get("/order_check.html")
async def serve_order_check():
    return FileResponse("order_check.html")

@app.get("/receiving_management.html")
async def serve_receiving_management():
    return FileResponse("receiving_management.html")

@app.get("/preprocessing_management.html")
async def serve_preprocessing_management():
    return FileResponse("preprocessing_management.html")

@app.get("/cooking_instruction_management.html")
async def serve_cooking_instruction_management():
    return FileResponse("cooking_instruction_management.html")

@app.get("/portion_instruction_management.html")
async def serve_portion_instruction_management():
    return FileResponse("portion_instruction_management.html")

@app.get("/base_weight_correction.html")
async def serve_base_weight_correction():
    return FileResponse("base_weight_correction.html")

@app.get("/event_template_management.html")
async def serve_event_template_management():
    return FileResponse("event_template_management.html")

@app.get("/event_order_management.html")
async def serve_event_order_management():
    return FileResponse("event_order_management.html")

@app.get("/event_ordering_management.html")
async def serve_event_ordering_management():
    return FileResponse("event_ordering_management.html")

@app.get("/event_profit_report.html")
async def serve_event_profit_report():
    return FileResponse("event_profit_report.html")

@app.get("/supplier_login.html")
async def serve_supplier_login():
    return FileResponse("supplier_login.html")

@app.get("/supplier_portal.html")
async def serve_supplier_portal():
    return FileResponse("supplier_portal.html")

@app.get("/notice_board.html")
async def serve_notice_board():
    return FileResponse("notice_board.html")

@app.get("/hygiene_notice.html")
async def serve_hygiene_notice():
    return FileResponse("hygiene_notice.html")

@app.get("/system_request.html")
async def serve_system_request():
    return FileResponse("system_request.html")

@app.get("/sales_management.html")
async def serve_sales_management():
    return FileResponse("sales_management.html")

@app.get("/logs_management.html")
async def serve_logs_management():
    return FileResponse("logs_management.html")

@app.get("/ingredient_bulk_change.html")
async def serve_ingredient_bulk_change():
    return FileResponse("ingredient_bulk_change.html")

@app.get("/ingredient_usage_history.html")
async def serve_ingredient_usage_history():
    return FileResponse("ingredient_usage_history.html")

@app.get("/health_certificate_management.html")
async def serve_health_certificate_management():
    return FileResponse("health_certificate_management.html")

@app.get("/side_dish_position_guide.html")
async def serve_side_dish_position_guide():
    return FileResponse("side_dish_position_guide.html")

@app.get("/backup_management.html")
async def serve_backup_management():
    return FileResponse("backup_management.html")

@app.get("/api/app-config")
async def get_app_config():
    """앱 설정 (모드, 타이틀 등) - 프론트엔드에서 사용"""
    from core.config import APP_MODE, APP_TITLE
    return {
        "mode": APP_MODE,
        "title": APP_TITLE,
        "features": {
            "categories": APP_MODE == "advanced",
            "suffix": APP_MODE == "advanced",
            "sibling_sync": APP_MODE == "advanced"
        }
    }

@app.get("/config.js")
async def serve_config():
    return FileResponse("config.js")

@app.get("/favicon.ico")
async def serve_favicon():
    return FileResponse("favicon.ico")

# 템플릿 다운로드 엔드포인트
@app.get("/api/admin/download-template")
async def download_ingredients_template():
    """식자재 엑셀 템플릿 다운로드"""
    import os
    template_path = "static/templates/ingredients_template.xls"

    if os.path.exists(template_path):
        from fastapi.responses import FileResponse
        return FileResponse(
            path=template_path,
            filename="식자재_업로드_템플릿.xls",
            media_type="application/vnd.ms-excel"
        )
    else:
        return {"success": False, "error": "템플릿 파일을 찾을 수 없습니다"}




# 식단 데이터 저장 테이블
def ensure_meal_plans_table():
    """meal_plans 테이블이 없으면 생성 (날짜별 식단 데이터 저장용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_plans (
                    id SERIAL PRIMARY KEY,
                    plan_date DATE NOT NULL,
                    slot_name VARCHAR(50) NOT NULL,
                    menus JSONB NOT NULL DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(plan_date, slot_name)
                );
                CREATE INDEX IF NOT EXISTS idx_meal_plans_date ON meal_plans(plan_date);
            """)
            conn.commit()

            # site_id 컬럼 추가 (없으면)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_plans' AND column_name = 'site_id') THEN
                        ALTER TABLE meal_plans ADD COLUMN site_id INTEGER DEFAULT 1;
                        CREATE INDEX IF NOT EXISTS idx_meal_plans_site_id ON meal_plans(site_id);
                    END IF;
                END $$;
            """)
            conn.commit()

            # category 컬럼 추가 (도시락/운반/학교/요양원 등 구분용)
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_plans' AND column_name = 'category') THEN
                        ALTER TABLE meal_plans ADD COLUMN category VARCHAR(50) DEFAULT '일반';
                        CREATE INDEX IF NOT EXISTS idx_meal_plans_category ON meal_plans(category);
                    END IF;
                END $$;
            """)
            conn.commit()

            # ★ site_id를 포함한 유니크 제약으로 변경 (사업장별 식단 분리)
            # 기존 (plan_date, slot_name, site_id) 제약 → (plan_date, slot_name, site_id, category)로 변경
            # ⚠️ 카테고리별로 별도 레코드 필요 (도시락/운반 등 구분)
            cursor.execute("""
                DO $$
                BEGIN
                    -- 1. category 컬럼에 NULL 값을 기본값으로 변경
                    UPDATE meal_plans SET category = '일반' WHERE category IS NULL OR category = '';

                    -- 2. 기존 인덱스들 삭제
                    IF EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE tablename = 'meal_plans'
                        AND indexname = 'idx_meal_plans_unique_site'
                    ) THEN
                        DROP INDEX idx_meal_plans_unique_site;
                        RAISE NOTICE 'Dropped old unique index (site_id only)';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE tablename = 'meal_plans'
                        AND indexname = 'idx_meal_plans_unique_site_category'
                    ) THEN
                        DROP INDEX idx_meal_plans_unique_site_category;
                        RAISE NOTICE 'Dropped old unique index with COALESCE';
                    END IF;

                    -- 3. 새로운 유니크 인덱스 (category 직접 포함)가 없으면 생성
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE tablename = 'meal_plans'
                        AND indexname = 'idx_meal_plans_unique_full'
                    ) THEN
                        -- 기존 유니크 제약 삭제 시도 (있으면)
                        BEGIN
                            ALTER TABLE meal_plans DROP CONSTRAINT IF EXISTS meal_plans_plan_date_slot_name_key;
                        EXCEPTION WHEN OTHERS THEN
                            NULL;
                        END;
                        -- 새로운 유니크 인덱스 생성 (category 직접 포함)
                        CREATE UNIQUE INDEX idx_meal_plans_unique_full
                        ON meal_plans(plan_date, slot_name, site_id, category);
                        RAISE NOTICE 'Created unique index with site_id and category';
                    END IF;
                END $$;
            """)
            conn.commit()
            print("[DB] meal_plans 유니크 인덱스 변경 완료 (plan_date, slot_name, site_id, category)")

            cursor.close()
            print("[DB] meal_plans 테이블 확인/생성 완료 (site_id, category 컬럼 포함)")
            return True
    except Exception as e:
        print(f"[DB] meal_plans 테이블 생성 오류: {e}")
        return False


# ========== 카테고리 코드 시스템 ==========
def ensure_meal_categories_table():
    """meal_categories 테이블 생성 - 카테고리 코드 관리"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. meal_categories 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_categories (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    site_id INTEGER DEFAULT 1,
                    color VARCHAR(20) DEFAULT '#3B82F6',
                    sort_order INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(site_id, name)
                );
                CREATE INDEX IF NOT EXISTS idx_meal_categories_code ON meal_categories(code);
                CREATE INDEX IF NOT EXISTS idx_meal_categories_site ON meal_categories(site_id);
            """)
            conn.commit()

            # 2. meal_plans에 category_code 컬럼 추가
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'meal_plans' AND column_name = 'category_code') THEN
                        ALTER TABLE meal_plans ADD COLUMN category_code VARCHAR(20);
                        CREATE INDEX IF NOT EXISTS idx_meal_plans_category_code ON meal_plans(category_code);
                    END IF;
                END $$;
            """)
            conn.commit()

            # 3. 기존 카테고리 데이터 마이그레이션 (코드가 없는 경우)
            cursor.execute("SELECT COUNT(*) FROM meal_categories")
            cat_count = cursor.fetchone()[0]

            if cat_count == 0:
                # 기존 meal_plans에서 사용된 카테고리들 추출
                cursor.execute("""
                    SELECT DISTINCT category, site_id FROM meal_plans
                    WHERE category IS NOT NULL AND category != ''
                    ORDER BY site_id, category
                """)
                existing_cats = cursor.fetchall()

                # 기본 카테고리 코드 매핑
                code_map = {}
                code_counter = 1

                for cat_name, site_id in existing_cats:
                    code = f"CAT{code_counter:03d}"
                    code_map[(cat_name, site_id)] = code

                    cursor.execute("""
                        INSERT INTO meal_categories (code, name, site_id, sort_order)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (site_id, name) DO NOTHING
                    """, (code, cat_name, site_id or 1, code_counter))
                    code_counter += 1

                conn.commit()

                # meal_plans의 category_code 업데이트
                for (cat_name, site_id), code in code_map.items():
                    cursor.execute("""
                        UPDATE meal_plans
                        SET category_code = %s
                        WHERE category = %s AND (site_id = %s OR (site_id IS NULL AND %s IS NULL))
                    """, (code, cat_name, site_id, site_id))

                conn.commit()
                print(f"[DB] meal_categories 마이그레이션 완료: {len(code_map)}개 카테고리")

            cursor.close()
            print("[DB] meal_categories 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] meal_categories 테이블 생성 오류: {e}")
        import traceback
        traceback.print_exc()
        return False


# 식자재 기준중량 컬럼 추가 (사용자 보정용)
def ensure_base_weight_column():
    """ingredients 테이블에 base_weight_grams 컬럼이 없으면 추가"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # 컬럼 존재 여부 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'ingredients' AND column_name = 'base_weight_grams'
            """)
            if not cursor.fetchone():
                cursor.execute("""
                    ALTER TABLE ingredients ADD COLUMN base_weight_grams NUMERIC;
                    COMMENT ON COLUMN ingredients.base_weight_grams IS '사용자 보정 기준중량(g) - NULL이면 자동계산';
                """)
                conn.commit()
                print("[DB] ingredients.base_weight_grams 컬럼 추가 완료")
            cursor.close()
            return True
    except Exception as e:
        print(f"[DB] base_weight_grams 컬럼 추가 오류: {e}")
        return False


# ========== site_name → category 매핑 테이블 ==========
def ensure_site_category_mapping_table():
    """site_category_mapping 테이블 생성 - site_name과 카테고리 매핑"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_category_mapping (
                    id SERIAL PRIMARY KEY,
                    site_name VARCHAR(100) UNIQUE NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_site_category_mapping_name ON site_category_mapping(site_name);
                CREATE INDEX IF NOT EXISTS idx_site_category_mapping_cat ON site_category_mapping(category);
            """)
            conn.commit()
            cursor.close()
            print("[DB] site_category_mapping 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] site_category_mapping 테이블 생성 오류: {e}")
        return False


# ========== 공지사항 테이블 (업무연락 + 위생안전) ==========
def ensure_notices_table():
    """공지사항 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS notices (
                    id SERIAL PRIMARY KEY,
                    notice_type VARCHAR(20) NOT NULL,  -- 'business' or 'hygiene'
                    title VARCHAR(200) NOT NULL,
                    content TEXT,
                    target_type VARCHAR(20) DEFAULT 'all',  -- 'all', 'group', 'site'
                    target_id INT,  -- group_id or site_id (NULL = 전체)
                    is_urgent BOOLEAN DEFAULT FALSE,
                    author_id INT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    is_active BOOLEAN DEFAULT TRUE
                );
                CREATE INDEX IF NOT EXISTS idx_notices_type ON notices(notice_type);
                CREATE INDEX IF NOT EXISTS idx_notices_created ON notices(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_notices_target ON notices(target_type, target_id);
            """)
            conn.commit()
            cursor.close()
            print("[DB] notices 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] notices 테이블 생성 오류: {e}")
        return False


# ========== 시스템 요청 테이블 ==========
def ensure_system_requests_table():
    """시스템 요청 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_requests (
                    id SERIAL PRIMARY KEY,
                    request_type VARCHAR(20) NOT NULL,  -- 'bug', 'feature', 'question'
                    title VARCHAR(200) NOT NULL,
                    content TEXT,
                    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'in_progress', 'resolved', 'closed'
                    author_id INT,
                    site_id INT,
                    response TEXT,
                    responded_by INT,
                    responded_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_system_requests_status ON system_requests(status);
                CREATE INDEX IF NOT EXISTS idx_system_requests_created ON system_requests(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_system_requests_author ON system_requests(author_id);
            """)
            conn.commit()
            cursor.close()
            print("[DB] system_requests 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] system_requests 테이블 생성 오류: {e}")
        return False


# ========== 첨부파일 테이블 ==========
def ensure_attachments_table():
    """첨부파일 테이블 생성 (공지, 시스템요청 공용)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS attachments (
                    id SERIAL PRIMARY KEY,
                    ref_type VARCHAR(20) NOT NULL,  -- 'notice', 'system_request'
                    ref_id INT NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    file_path VARCHAR(500) NOT NULL,
                    file_size INT,
                    mime_type VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_attachments_ref ON attachments(ref_type, ref_id);
            """)
            conn.commit()
            cursor.close()
            print("[DB] attachments 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] attachments 테이블 생성 오류: {e}")
        return False


# ========== 사업장별 월매출 테이블 ==========
def ensure_site_monthly_sales_table():
    """사업장별 월매출 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_monthly_sales (
                    id SERIAL PRIMARY KEY,
                    site_id INT NOT NULL,
                    year_month VARCHAR(7) NOT NULL,  -- '2025-01'
                    sales_amount DECIMAL(15,2) DEFAULT 0,
                    vat_amount DECIMAL(15,2) DEFAULT 0,
                    total_amount DECIMAL(15,2) DEFAULT 0,
                    memo TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(site_id, year_month)
                );
                CREATE INDEX IF NOT EXISTS idx_site_monthly_sales_site ON site_monthly_sales(site_id);
                CREATE INDEX IF NOT EXISTS idx_site_monthly_sales_month ON site_monthly_sales(year_month);
            """)
            conn.commit()
            cursor.close()
            print("[DB] site_monthly_sales 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] site_monthly_sales 테이블 생성 오류: {e}")
        return False


# ========== 메뉴별 판매단가 테이블 ==========
def ensure_menu_prices_table():
    """메뉴별 판매단가 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS menu_prices (
                    id SERIAL PRIMARY KEY,
                    site_id INT NOT NULL,
                    menu_name VARCHAR(100) NOT NULL,
                    price DECIMAL(10,2) NOT NULL,
                    vat_included BOOLEAN DEFAULT FALSE,
                    effective_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(site_id, menu_name, effective_date)
                );
                CREATE INDEX IF NOT EXISTS idx_menu_prices_site ON menu_prices(site_id);
                CREATE INDEX IF NOT EXISTS idx_menu_prices_date ON menu_prices(effective_date);
            """)
            conn.commit()
            cursor.close()
            print("[DB] menu_prices 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] menu_prices 테이블 생성 오류: {e}")
        return False


# ========== 행사 매출 테이블 ==========
def ensure_event_sales_table():
    """행사 매출 테이블 생성 (개업기념일, 뷔페 등)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_sales (
                    id SERIAL PRIMARY KEY,
                    site_id INT NOT NULL,
                    event_date DATE NOT NULL,
                    event_name VARCHAR(100) NOT NULL,
                    event_type VARCHAR(50),  -- 'anniversary', 'buffet', 'special', 'other'
                    sales_amount DECIMAL(15,2) DEFAULT 0,
                    vat_amount DECIMAL(15,2) DEFAULT 0,
                    total_amount DECIMAL(15,2) DEFAULT 0,
                    attendees INT,  -- 참석인원
                    memo TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_event_sales_site ON event_sales(site_id);
                CREATE INDEX IF NOT EXISTS idx_event_sales_date ON event_sales(event_date);
                CREATE INDEX IF NOT EXISTS idx_event_sales_type ON event_sales(event_type);
            """)
            conn.commit()
            cursor.close()
            print("[DB] event_sales 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] event_sales 테이블 생성 오류: {e}")
        return False


# ========== 행사 등록/손익 테이블 ==========
def ensure_events_table():
    """행사 등록/손익 관리 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id SERIAL PRIMARY KEY,
                    event_name VARCHAR(200) NOT NULL,
                    event_date DATE NOT NULL,
                    event_type VARCHAR(50) NOT NULL,
                    status VARCHAR(20) DEFAULT 'estimate',
                    site_id INTEGER,
                    client_name VARCHAR(200),
                    contact_person VARCHAR(100),
                    phone VARCHAR(50),
                    address TEXT,
                    template_id INTEGER,
                    menu_name VARCHAR(500),
                    expected_attendees INTEGER DEFAULT 0,
                    unit_price DECIMAL(12,2) DEFAULT 0,
                    expected_revenue DECIMAL(15,2) DEFAULT 0,
                    actual_attendees INTEGER,
                    actual_revenue DECIMAL(15,2),
                    ingredient_cost DECIMAL(15,2) DEFAULT 0,
                    labor_cost DECIMAL(15,2) DEFAULT 0,
                    other_cost DECIMAL(15,2) DEFAULT 0,
                    total_cost DECIMAL(15,2) DEFAULT 0,
                    profit DECIMAL(15,2) DEFAULT 0,
                    profit_margin DECIMAL(5,2) DEFAULT 0,
                    memo TEXT,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
                CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
                CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
            """)
            conn.commit()
            cursor.close()
            print("[DB] events 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] events 테이블 생성 오류: {e}")
        return False


# ========== 공지 읽음 상태 테이블 ==========
def ensure_notice_reads_table():
    """공지 읽음 상태 테이블 생성"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS notice_reads (
                    id SERIAL PRIMARY KEY,
                    notice_id INT NOT NULL,
                    user_id INT NOT NULL,
                    read_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(notice_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_notice_reads_notice ON notice_reads(notice_id);
                CREATE INDEX IF NOT EXISTS idx_notice_reads_user ON notice_reads(user_id);
            """)
            conn.commit()
            cursor.close()
            print("[DB] notice_reads 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] notice_reads 테이블 생성 오류: {e}")
        return False


# 서버 시작시 추가 테이블 생성
ensure_meal_plans_table()
ensure_meal_categories_table()  # 카테고리 코드 시스템
ensure_site_category_mapping_table()  # site_name → category 매핑
ensure_base_weight_column()

# 대시보드/공지/매출 관련 테이블
ensure_notices_table()  # 공지사항 (업무연락 + 위생안전)
ensure_system_requests_table()  # 시스템 요청
ensure_attachments_table()  # 첨부파일
ensure_site_monthly_sales_table()  # 사업장별 월매출
ensure_menu_prices_table()  # 메뉴별 판매단가
ensure_event_sales_table()  # 행사 매출
ensure_events_table()  # 행사 등록/손익 관리
ensure_notice_reads_table()  # 공지 읽음 상태


# ========== system_settings 테이블 ==========
def ensure_system_settings_table():
    """시스템 설정 테이블 생성 (key-value 구조)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            conn.commit()
            cursor.close()
            print("[DB] system_settings 테이블 확인/생성 완료")
            return True
    except Exception as e:
        print(f"[DB] system_settings 테이블 생성 오류: {e}")
        return False

ensure_system_settings_table()  # 시스템 설정 (브랜딩 등)


# ========== orders 테이블 외래키 제약 제거 ==========
def fix_orders_foreign_keys():
    """orders 테이블 외래키 제약 제거 - site_id, warehouse_id"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 외래키 제약 존재 여부 확인 후 제거
            cursor.execute("""
                DO $$
                BEGIN
                    -- site_id 외래키 제거
                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_name = 'orders_site_id_fkey'
                        AND table_name = 'orders'
                    ) THEN
                        ALTER TABLE orders DROP CONSTRAINT orders_site_id_fkey;
                        RAISE NOTICE 'orders_site_id_fkey 제약조건 제거됨';
                    END IF;

                    -- warehouse_id 외래키 제거
                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_name = 'orders_warehouse_id_fkey'
                        AND table_name = 'orders'
                    ) THEN
                        ALTER TABLE orders DROP CONSTRAINT orders_warehouse_id_fkey;
                        RAISE NOTICE 'orders_warehouse_id_fkey 제약조건 제거됨';
                    END IF;
                END $$;
            """)
            conn.commit()
            cursor.close()
            print("[DB] orders 외래키 제약 확인/제거 완료 (site_id, warehouse_id)")
            return True
    except Exception as e:
        print(f"[DB] orders 외래키 제거 오류: {e}")
        return False

fix_orders_foreign_keys()  # orders 테이블 외래키 제약 제거


# ========== menu_recipes 테이블 외래키 제약 제거 ==========
def fix_menu_recipes_foreign_keys():
    """menu_recipes 테이블 외래키 제약 제거 - site_id"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                DO $$
                BEGIN
                    -- site_id 외래키 제거
                    IF EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_name = 'menu_recipes_site_id_fkey'
                        AND table_name = 'menu_recipes'
                    ) THEN
                        ALTER TABLE menu_recipes DROP CONSTRAINT menu_recipes_site_id_fkey;
                        RAISE NOTICE 'menu_recipes_site_id_fkey 제약조건 제거됨';
                    END IF;
                END $$;
            """)
            conn.commit()
            cursor.close()
            print("[DB] menu_recipes 외래키 제약 확인/제거 완료 (site_id)")
            return True
    except Exception as e:
        print(f"[DB] menu_recipes 외래키 제거 오류: {e}")
        return False

fix_menu_recipes_foreign_keys()  # menu_recipes 테이블 외래키 제약 제거


# ========== 식단 저장/조회 API ==========

@app.get("/api/meal-plans")
async def get_meal_plans(start_date: str = None, end_date: str = None, site_id: Optional[int] = None, category: Optional[str] = None):
    """식단 데이터 조회 (날짜 범위) - 최신 레시피 정보 포함, site_id/category 필터링 지원"""
    try:
        # ★ 보안: site_id 없이 호출 시 경고 및 빈 데이터 반환 (데이터 혼용 방지)
        if not site_id:
            print(f"[WARNING] 식단 조회 시 site_id 누락! 데이터 혼용 방지를 위해 빈 결과 반환")
            return {
                "success": True,
                "data": {},
                "_raw": [],
                "_warning": "site_id가 필요합니다. 사업장을 선택해주세요."
            }

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 🏢 필터링 조건 구성 (information_schema 조회 제거로 성능 개선)
            filters = []
            params = []

            # site_id는 필수이므로 항상 필터링
            filters.append("site_id = %s")
            params.append(site_id)

            if category:
                filters.append("category = %s")
                params.append(category)

            filter_clause = (" AND " + " AND ".join(filters)) if filters else ""

            if start_date and end_date:
                query = f"""
                    SELECT plan_date, slot_name, menus, updated_at, site_id, category
                    FROM meal_plans
                    WHERE plan_date BETWEEN %s AND %s{filter_clause}
                    ORDER BY plan_date, slot_name
                """
                query_params = [start_date, end_date] + params
                cursor.execute(query, query_params)
            else:
                # 기본: 최근 30일
                query = f"""
                    SELECT plan_date, slot_name, menus, updated_at, site_id, category
                    FROM meal_plans
                    WHERE plan_date >= CURRENT_DATE - INTERVAL '30 days'{filter_clause}
                    ORDER BY plan_date, slot_name
                """
                cursor.execute(query, params if params else None)

            rows = cursor.fetchall()

            # 모든 메뉴 ID 수집
            all_menu_ids = set()
            for row in rows:
                menus = row[2] or []
                for menu in menus:
                    if isinstance(menu, dict) and menu.get('id'):
                        all_menu_ids.add(menu['id'])

            # 최신 레시피 정보 조회 (재료비 합계 계산)
            recipes_map = {}
            if all_menu_ids:
                cursor.execute("""
                    SELECT r.id, r.recipe_name, r.category,
                           COALESCE(SUM(mri.amount), 0) as total_cost,
                           COUNT(mri.id) as ingredient_count
                    FROM menu_recipes r
                    LEFT JOIN menu_recipe_ingredients mri ON r.id = mri.recipe_id
                    WHERE r.id = ANY(%s)
                    GROUP BY r.id, r.recipe_name, r.category
                """, (list(all_menu_ids),))
                for r in cursor.fetchall():
                    recipes_map[r[0]] = {
                        'id': r[0],
                        'name': r[1],
                        'category': r[2] or '미분류',
                        'currentPrice': float(r[3]) if r[3] else 0,
                        'previousPrice': float(r[3]) if r[3] else 0,
                        'ingredients': [f'재료 {r[4]}종'] if r[4] else ['재료 미등록'],
                        'trend': 'stable',
                        'changePercent': 0,
                        'changeReason': f'재료 {r[4]}종' if r[4] else '재료 미등록'
                    }

            cursor.close()

            # 날짜별로 그룹화 + 최신 정보 병합
            result = {}
            raw_data = []  # site_id, category 포함한 원본 데이터
            timestamps = {}  # ★ 낙관적 잠금용 타임스탬프 (date -> slot -> updated_at)

            for row in rows:
                date_str = str(row[0])
                slot_name = row[1]
                menus = row[2] or []
                row_updated_at = row[3]  # ★ updated_at 추출
                row_site_id = row[4] if len(row) > 4 else None
                row_category = row[5] if len(row) > 5 else None

                # 원본 데이터 저장 (디버그용)
                raw_data.append({
                    "date": date_str,
                    "slot": slot_name,
                    "site_id": row_site_id,
                    "category": row_category,
                    "menu_count": len(menus)
                })

                # ★ 타임스탬프 저장 (낙관적 잠금용)
                if date_str not in timestamps:
                    timestamps[date_str] = {}
                timestamps[date_str][slot_name] = str(row_updated_at) if row_updated_at else None

                # 메뉴 ID로 최신 정보 가져오기
                updated_menus = []
                for menu in menus:
                    if isinstance(menu, dict) and menu.get('id'):
                        menu_id = menu['id']
                        if menu_id in recipes_map:
                            updated_menus.append(recipes_map[menu_id])
                        else:
                            # DB에서 삭제된 메뉴는 기존 정보 유지
                            updated_menus.append(menu)
                    else:
                        updated_menus.append(menu)

                if date_str not in result:
                    result[date_str] = {}
                result[date_str][slot_name] = updated_menus

            return {"success": True, "data": result, "_raw": raw_data, "_timestamps": timestamps}
    except Exception as e:
        print(f"[ERROR] 식단 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/meal-plans/{plan_date}")
async def get_meal_plan_by_date(plan_date: str):
    """특정 날짜의 식단 데이터 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT slot_name, menus, updated_at
                FROM meal_plans
                WHERE plan_date = %s
                ORDER BY slot_name
            """, (plan_date,))

            rows = cursor.fetchall()
            cursor.close()

            result = {}
            for row in rows:
                result[row[0]] = row[1]  # slot_name: menus

            return {"success": True, "date": plan_date, "data": result}
    except Exception as e:
        print(f"[ERROR] 식단 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/meal-plans-categories/{plan_date}")
async def get_meal_plan_categories(plan_date: str, site_id: Optional[int] = None):
    """특정 날짜에 저장된 카테고리 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # category 컬럼 존재 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'meal_plans' AND column_name = 'category'
            """)
            has_category = cursor.fetchone() is not None

            if not has_category:
                cursor.close()
                return {"success": True, "date": plan_date, "categories": []}

            # 카테고리별 슬롯 수 조회
            if site_id:
                cursor.execute("""
                    SELECT category, COUNT(*) as slot_count
                    FROM meal_plans
                    WHERE plan_date = %s AND site_id = %s AND category IS NOT NULL
                    GROUP BY category
                    ORDER BY category
                """, (plan_date, site_id))
            else:
                cursor.execute("""
                    SELECT category, COUNT(*) as slot_count
                    FROM meal_plans
                    WHERE plan_date = %s AND category IS NOT NULL
                    GROUP BY category
                    ORDER BY category
                """, (plan_date,))

            rows = cursor.fetchall()
            cursor.close()

            categories = [{"name": row[0], "slots": row[1]} for row in rows if row[0]]
            print(f"[API] {plan_date} categories: {[c['name'] for c in categories]}")

            return {"success": True, "date": plan_date, "categories": categories}
    except Exception as e:
        print(f"[ERROR] 카테고리 조회 오류: {e}")
        return {"success": False, "error": str(e)}


# ========== 카테고리 코드 관리 API ==========

@app.get("/api/meal-categories")
async def get_meal_categories(site_id: Optional[int] = None):
    """카테고리 목록 조회 (코드 포함)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if site_id:
                cursor.execute("""
                    SELECT id, code, name, color, sort_order, is_active
                    FROM meal_categories
                    WHERE site_id = %s AND is_active = TRUE
                    ORDER BY sort_order, name
                """, (site_id,))
            else:
                cursor.execute("""
                    SELECT id, code, name, color, sort_order, is_active
                    FROM meal_categories
                    WHERE is_active = TRUE
                    ORDER BY sort_order, name
                """)

            rows = cursor.fetchall()
            cursor.close()

            categories = [{
                "id": row[0],
                "code": row[1],
                "name": row[2],
                "color": row[3],
                "sortOrder": row[4],
                "isActive": row[5]
            } for row in rows]

            return {"success": True, "categories": categories}
    except Exception as e:
        print(f"[ERROR] 카테고리 조회 오류: {e}")
        return {"success": False, "error": str(e), "categories": []}


@app.post("/api/meal-categories")
async def create_meal_category(request: Request):
    """새 카테고리 생성 (자동 코드 부여)"""
    try:
        data = await request.json()
        name = data.get('name')
        site_id = data.get('site_id', 1)
        color = data.get('color', '#3B82F6')

        if not name:
            return {"success": False, "error": "카테고리명 필수"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 다음 코드 번호 생성
            cursor.execute("SELECT MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)) FROM meal_categories WHERE code LIKE 'CAT%'")
            max_num = cursor.fetchone()[0] or 0
            new_code = f"CAT{max_num + 1:03d}"

            # 다음 정렬 순서
            cursor.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM meal_categories WHERE site_id = %s", (site_id,))
            sort_order = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO meal_categories (code, name, site_id, color, sort_order)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, code, name, color, sort_order
            """, (new_code, name, site_id, color, sort_order))

            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            return {
                "success": True,
                "category": {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "color": row[3],
                    "sortOrder": row[4]
                }
            }
    except Exception as e:
        print(f"[ERROR] 카테고리 생성 오류: {e}")
        return {"success": False, "error": str(e)}


@app.put("/api/meal-categories/{code}")
async def update_meal_category(code: str, request: Request):
    """카테고리 수정 (이름, 색상 등)"""
    try:
        data = await request.json()
        name = data.get('name')
        color = data.get('color')
        sort_order = data.get('sortOrder')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            updates = []
            params = []

            if name:
                updates.append("name = %s")
                params.append(name)
            if color:
                updates.append("color = %s")
                params.append(color)
            if sort_order is not None:
                updates.append("sort_order = %s")
                params.append(sort_order)

            if not updates:
                return {"success": False, "error": "변경할 내용 없음"}

            params.append(code)
            cursor.execute(f"""
                UPDATE meal_categories
                SET {', '.join(updates)}
                WHERE code = %s
                RETURNING id, code, name, color, sort_order
            """, params)

            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            if not row:
                return {"success": False, "error": "카테고리 없음"}

            return {
                "success": True,
                "category": {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "color": row[3],
                    "sortOrder": row[4]
                }
            }
    except Exception as e:
        print(f"[ERROR] 카테고리 수정 오류: {e}")
        return {"success": False, "error": str(e)}


@app.delete("/api/meal-categories/{code}")
async def delete_meal_category(code: str):
    """카테고리 비활성화 (soft delete)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE meal_categories
                SET is_active = FALSE
                WHERE code = %s
                RETURNING id, code, name
            """, (code,))

            row = cursor.fetchone()
            conn.commit()
            cursor.close()

            if not row:
                return {"success": False, "error": "카테고리 없음"}

            return {"success": True, "message": f"'{row[2]}' 카테고리 비활성화 완료"}
    except Exception as e:
        print(f"[ERROR] 카테고리 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/meal-categories/by-name/{name}")
async def get_category_by_name(name: str, site_id: Optional[int] = None):
    """이름으로 카테고리 조회 (코드 반환)"""
    try:
        from urllib.parse import unquote
        decoded_name = unquote(name)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            if site_id:
                cursor.execute("""
                    SELECT id, code, name, color, sort_order
                    FROM meal_categories
                    WHERE name = %s AND site_id = %s AND is_active = TRUE
                """, (decoded_name, site_id))
            else:
                cursor.execute("""
                    SELECT id, code, name, color, sort_order
                    FROM meal_categories
                    WHERE name = %s AND is_active = TRUE
                    LIMIT 1
                """, (decoded_name,))

            row = cursor.fetchone()
            cursor.close()

            if not row:
                return {"success": False, "error": f"'{decoded_name}' 카테고리 없음"}

            return {
                "success": True,
                "category": {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "color": row[3],
                    "sortOrder": row[4]
                }
            }
    except Exception as e:
        print(f"[ERROR] 카테고리 조회 오류: {e}")
        return {"success": False, "error": str(e)}


# ========== site_name → category 매핑 API ==========

@app.get("/api/site-category-mapping")
async def get_site_category_mapping():
    """site_name → category 매핑 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, site_name, category, created_at, updated_at
                FROM site_category_mapping
                ORDER BY category, site_name
            """)

            rows = cursor.fetchall()
            cursor.close()

            mappings = [{
                "id": row[0],
                "site_name": row[1],
                "category": row[2],
                "created_at": row[3].isoformat() if row[3] else None,
                "updated_at": row[4].isoformat() if row[4] else None
            } for row in rows]

            return {"success": True, "mappings": mappings, "total": len(mappings)}
    except Exception as e:
        print(f"[ERROR] 매핑 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/site-category-mapping")
async def save_site_category_mapping(request: Request):
    """site_name → category 매핑 저장 (단일 또는 다중)"""
    try:
        data = await request.json()
        mappings = data.get('mappings', [])

        if not mappings:
            # 단일 매핑
            site_name = data.get('site_name')
            category = data.get('category')
            if site_name and category:
                mappings = [{"site_name": site_name, "category": category}]

        if not mappings:
            return {"success": False, "error": "mappings 데이터 필요"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            saved = 0
            for m in mappings:
                site_name = m.get('site_name')
                category = m.get('category')
                if site_name and category:
                    cursor.execute("""
                        INSERT INTO site_category_mapping (site_name, category, updated_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (site_name) DO UPDATE SET
                            category = EXCLUDED.category,
                            updated_at = NOW()
                    """, (site_name, category))
                    saved += 1

            conn.commit()
            cursor.close()

            return {"success": True, "message": f"{saved}개 매핑 저장 완료"}
    except Exception as e:
        print(f"[ERROR] 매핑 저장 오류: {e}")
        return {"success": False, "error": str(e)}


@app.delete("/api/site-category-mapping/{site_name}")
async def delete_site_category_mapping(site_name: str):
    """site_name → category 매핑 삭제"""
    try:
        import urllib.parse
        decoded_name = urllib.parse.unquote(site_name)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM site_category_mapping WHERE site_name = %s", (decoded_name,))
            deleted = cursor.rowcount

            conn.commit()
            cursor.close()

            if deleted > 0:
                return {"success": True, "message": f"'{decoded_name}' 매핑 삭제 완료"}
            else:
                return {"success": False, "error": f"'{decoded_name}' 매핑 없음"}
    except Exception as e:
        print(f"[ERROR] 매핑 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/site-category-mapping/unmapped")
async def get_unmapped_sites(work_date: str = None):
    """카테고리가 매핑되지 않은 site_name 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT DISTINCT mc.site_name, SUM(mc.meal_count) as total_count
                FROM meal_counts mc
                LEFT JOIN site_category_mapping scm ON mc.site_name = scm.site_name
                WHERE scm.id IS NULL AND mc.site_name IS NOT NULL AND mc.site_name != ''
            """
            params = []

            if work_date:
                query += " AND mc.work_date = %s"
                params.append(work_date)

            query += " GROUP BY mc.site_name ORDER BY total_count DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            unmapped = [{"site_name": row[0], "total_count": row[1]} for row in rows]

            return {"success": True, "unmapped": unmapped, "total": len(unmapped)}
    except Exception as e:
        print(f"[ERROR] 미매핑 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/meal-plans")
async def save_meal_plan(request: Request):
    """식단 데이터 저장 (날짜 + 슬롯별 + 사업장별 + 카테고리별)"""
    from psycopg2.extras import Json
    try:
        data = await request.json()
        print(f"[DEBUG] /api/meal-plans POST received")
        plan_date = data.get('plan_date')
        meal_data = data.get('meal_data', {})  # {slot_name: [menus]}
        site_id = data.get('site_id')  # site ID
        category = data.get('category')  # category
        deleted_slots = data.get('deleted_slots', [])  # deleted slots list
        expected_timestamps = data.get('expected_timestamps', {})  # ★ 낙관적 잠금용
        force_save = data.get('force_save', False)  # ★ 충돌 무시하고 강제 저장
        print(f"[DEBUG] plan_date={plan_date}, site_id={site_id}, category={category}, deleted_slots={deleted_slots}, slots={list(meal_data.keys())}")

        if not plan_date:
            return {"success": False, "error": "plan_date 필수"}

        # ★ 보안: site_id 필수 검증 (데이터 혼용 방지)
        if not site_id:
            print(f"[ERROR] 식단 저장 시 site_id 누락!")
            return {"success": False, "error": "site_id가 필요합니다. 사업장을 선택해주세요."}

        # 🚫 category 필수 검증 - '전체' 또는 빈 값 거부
        if not category or category == '전체':
            return {"success": False, "error": "명확한 카테고리(도시락/학교/요양원 등)를 지정해야 합니다. '전체'로는 저장할 수 없습니다."}

        print(f"[DEBUG] Saving: date={plan_date}, site_id={site_id}, category={category}, slots={list(meal_data.keys())}")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ★ 낙관적 잠금: 충돌 감지 (expected_timestamps가 있고, force_save가 아닌 경우)
            if expected_timestamps and not force_save:
                slots_to_check = list(meal_data.keys())
                if slots_to_check:
                    # 현재 DB의 타임스탬프 조회
                    cursor.execute("""
                        SELECT slot_name, updated_at
                        FROM meal_plans
                        WHERE plan_date = %s AND site_id = %s AND category = %s
                        AND slot_name = ANY(%s)
                    """, (plan_date, site_id, category, slots_to_check))

                    db_timestamps = {row[0]: str(row[1]) if row[1] else None for row in cursor.fetchall()}

                    # 충돌 검사
                    conflicts = []
                    for slot_name in slots_to_check:
                        expected_ts = expected_timestamps.get(slot_name)
                        current_ts = db_timestamps.get(slot_name)

                        # 새로운 슬롯은 충돌 없음 (DB에 없는 경우)
                        if current_ts is None:
                            continue

                        # 기대 타임스탬프가 없거나 다르면 충돌
                        if expected_ts is None or expected_ts != current_ts:
                            conflicts.append({
                                "slot": slot_name,
                                "expected": expected_ts,
                                "current": current_ts
                            })

                    if conflicts:
                        print(f"[CONFLICT] 낙관적 잠금 충돌 감지: {conflicts}")
                        cursor.close()
                        return {
                            "success": False,
                            "error": "다른 사용자가 이미 수정했습니다. 데이터를 새로고침 후 다시 시도하세요.",
                            "conflict": True,
                            "conflicts": conflicts
                        }

            # 📦 변경 전 데이터를 이력 테이블에 저장 (백업)
            # ⚠️ 이력은 유실 복구의 마지막 안전망이므로, 실패 시 저장을 중단
            try:
                cursor.execute("SAVEPOINT backup_savepoint")
                cursor.execute("""
                    INSERT INTO meal_plans_history
                    (original_id, plan_date, slot_name, category, menus, site_id, action, changed_by)
                    SELECT id, plan_date, slot_name, category, menus, site_id, 'BEFORE_UPDATE', 'api'
                    FROM meal_plans
                    WHERE plan_date = %s AND (%s IS NULL OR category = %s) AND (%s IS NULL OR site_id = %s)
                """, (plan_date, category, category, site_id, site_id))
                history_count = cursor.rowcount
                if history_count > 0:
                    print(f"[백업] meal_plans 이력 저장: {history_count}개 레코드")
                cursor.execute("RELEASE SAVEPOINT backup_savepoint")
            except Exception as backup_err:
                print(f"[백업 실패] meal_plans 이력 저장 실패: {backup_err}")
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT backup_savepoint")
                except Exception as rollback_err:
                    print(f"[백업 실패] SAVEPOINT 롤백도 실패: {rollback_err}")
                try:
                    conn.rollback()
                    cursor.close()
                except Exception:
                    pass
                return {"success": False, "error": f"이력 백업 실패로 저장을 중단합니다: {backup_err}"}

            # category 컬럼 존재 여부 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'meal_plans' AND column_name = 'category'
            """)
            has_category_column = cursor.fetchone() is not None

            # 컬럼이 없으면 추가
            if not has_category_column and category:
                try:
                    cursor.execute("ALTER TABLE meal_plans ADD COLUMN category VARCHAR(50)")
                    conn.commit()
                    has_category_column = True
                    print("[DB] meal_plans에 category 컬럼 추가됨")
                except Exception as e:
                    print(f"[DB] category 컬럼 추가 실패 (이미 존재할 수 있음): {e}")

            # 🗑️ 1단계: 삭제된 슬롯 명시적 삭제 (deleted_slots 배열 처리)
            deleted_count = 0
            if deleted_slots:
                print(f"[DB] 삭제 요청된 슬롯: {deleted_slots}")
                for slot_name in deleted_slots:
                    if site_id and category and has_category_column:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s AND category = %s
                        """, (plan_date, slot_name, site_id, category))
                    elif site_id:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s
                        """, (plan_date, slot_name, site_id))
                    else:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s
                        """, (plan_date, slot_name))
                    deleted_count += cursor.rowcount
                print(f"[DB] 삭제된 슬롯 {deleted_count}개 제거 완료")

            # 🗑️ 2단계: 빈 배열로 전송된 슬롯은 DB에서 삭제
            # (사용자가 슬롯의 모든 메뉴를 제거한 경우 의도적인 삭제로 처리)
            empty_slots = [s for s, m in meal_data.items() if not m]
            if empty_slots:
                empty_deleted = 0
                for slot_name in empty_slots:
                    if site_id and category and has_category_column:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s AND category = %s
                        """, (plan_date, slot_name, site_id, category))
                    elif site_id:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s
                        """, (plan_date, slot_name, site_id))
                    else:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s
                        """, (plan_date, slot_name))
                    empty_deleted += cursor.rowcount
                    del meal_data[slot_name]
                print(f"[DB] 빈 슬롯 삭제: {empty_slots} ({empty_deleted}개 레코드 제거)")

            # 전달된 슬롯만 삭제 후 재삽입 (다른 슬롯 보존)
            slots_to_update = list(meal_data.keys())
            deleted = 0
            if slots_to_update:
                for slot_name in slots_to_update:
                    if site_id and category and has_category_column:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s AND category = %s
                        """, (plan_date, slot_name, site_id, category))
                        deleted += cursor.rowcount
                    elif site_id:
                        cursor.execute("""
                            DELETE FROM meal_plans
                            WHERE plan_date = %s AND slot_name = %s AND site_id = %s
                        """, (plan_date, slot_name, site_id))
                        deleted += cursor.rowcount
                print(f"[DB] 해당 슬롯 삭제: {plan_date}, slots={slots_to_update}, site_id={site_id}, category={category}, {deleted}개")

            # ★ 2.5단계: canonical_name 추가 (메뉴명 일관성 보장)
            # meal_plans에는 display_name(예: "영남-현미밥-요")이 저장되지만,
            # order_items에는 recipe_name+suffix(예: "현미밥-요")가 저장됨.
            # 저장 시점에 canonical_name을 추가하여 이후 조리/소분지시서에서 정확한 매칭 보장.
            all_recipe_ids = set()
            for slot_name, menus in meal_data.items():
                for m in (menus or []):
                    if isinstance(m, dict) and m.get('id'):
                        try:
                            all_recipe_ids.add(int(m['id']))
                        except (ValueError, TypeError):
                            pass

            if all_recipe_ids:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids))
                cursor.execute(f"""
                    SELECT id,
                           CASE WHEN COALESCE(suffix, '') != ''
                                THEN COALESCE(NULLIF(base_name, ''), recipe_name) || '-' || suffix
                                ELSE COALESCE(NULLIF(base_name, ''), recipe_name)
                           END AS canonical_name
                    FROM menu_recipes WHERE id IN ({rid_placeholders})
                """, list(all_recipe_ids))
                id_to_canonical = {r[0]: r[1] for r in cursor.fetchall()}

                enriched_count = 0
                for slot_name, menus in meal_data.items():
                    for m in (menus or []):
                        if isinstance(m, dict) and m.get('id'):
                            try:
                                rid = int(m['id'])
                            except (ValueError, TypeError):
                                continue
                            if rid in id_to_canonical:
                                m['canonical_name'] = id_to_canonical[rid]
                                enriched_count += 1
                print(f"[canonical_name] {enriched_count}개 메뉴에 canonical_name 추가 완료")

            # 3단계: 새로운 데이터 UPSERT (중복 키 충돌 방지)
            saved_count = 0
            print(f"[DB UPSERT START] date={plan_date}, site_id={site_id}, category={category}")
            for slot_name, menus in meal_data.items():
                menu_count = len(menus) if menus else 0
                print(f"  [UPSERT] slot={slot_name}, menus={menu_count}개, category={category}")
                if site_id and category and has_category_column:
                    # site_id + category를 포함한 유니크 제약 사용 (카테고리별 식단 분리)
                    cursor.execute("""
                        INSERT INTO meal_plans (plan_date, slot_name, menus, site_id, category, updated_at)
                        VALUES (%s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (plan_date, slot_name, site_id, category) DO UPDATE SET
                            menus = EXCLUDED.menus,
                            updated_at = NOW()
                    """, (plan_date, slot_name, Json(menus), site_id, category))
                elif site_id:
                    cursor.execute("""
                        INSERT INTO meal_plans (plan_date, slot_name, menus, site_id, updated_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (plan_date, slot_name, site_id) DO UPDATE SET
                            menus = EXCLUDED.menus,
                            updated_at = NOW()
                    """, (plan_date, slot_name, Json(menus), site_id))
                else:
                    cursor.execute("""
                        INSERT INTO meal_plans (plan_date, slot_name, menus, updated_at)
                        VALUES (%s, %s, %s, NOW())
                        ON CONFLICT (plan_date, slot_name) DO UPDATE SET
                            menus = EXCLUDED.menus,
                            updated_at = NOW()
                    """, (plan_date, slot_name, Json(menus)))
                saved_count += 1

            conn.commit()
            print(f"[DB COMMIT] Transaction committed successfully")
            cursor.close()

            print(f"[DB] Meal plan saved: date={plan_date}, site_id={site_id}, category={category}, saved={saved_count}, deleted_slots={len(deleted_slots)}")
            return {"success": True, "date": plan_date, "saved_slots": saved_count, "deleted_slots": len(deleted_slots), "site_id": site_id, "category": category}
    except Exception as e:
        print(f"[ERROR] 식단 저장 오류: {e}")
        try:
            cursor.close()
        except Exception:
            pass
        return {"success": False, "error": str(e)}


@app.delete("/api/meal-plans/{plan_date}")
async def delete_meal_plan(plan_date: str, slot_name: str = None, site_id: str = None, category: str = None):
    """식단 데이터 삭제 (site_id/category 필터 필수)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 안전장치: site_id 또는 slot_name 없이 전체 삭제 방지
            if not slot_name and not site_id and not category:
                cursor.close()
                return {"success": False, "error": "site_id, category, slot_name 중 하나 이상의 필터가 필요합니다"}

            # 동적 WHERE 절 구성
            conditions = ["plan_date = %s"]
            params = [plan_date]
            if slot_name:
                conditions.append("slot_name = %s")
                params.append(slot_name)
            if site_id:
                conditions.append("site_id = %s")
                params.append(site_id)
            if category:
                conditions.append("category = %s")
                params.append(category)

            where_clause = " AND ".join(conditions)
            cursor.execute(f"DELETE FROM meal_plans WHERE {where_clause}", params)

            deleted = cursor.rowcount
            conn.commit()
            cursor.close()

            print(f"[DB] 식단 삭제: date={plan_date}, site_id={site_id}, category={category}, slot={slot_name}, deleted={deleted}")
            return {"success": True, "deleted": deleted}
    except Exception as e:
        print(f"[ERROR] 식단 삭제 오류: {e}")
        try:
            cursor.close()
        except Exception:
            pass
        return {"success": False, "error": str(e)}


# ========== 식단 복사 API (Phase 2) ==========

@app.post("/api/meal-plan-copy")
async def copy_meal_plans(request: Request):
    """식단 복사 - 일자별/주간/월간/기간별"""
    try:
        data = await request.json()
        copy_type = data.get('copy_type', 'daily')  # daily, weekly, monthly, custom
        source_start = data.get('source_start_date')
        source_end = data.get('source_end_date', source_start)
        target_start = data.get('target_start_date')
        target_site_id = data.get('target_site_id')
        overwrite = data.get('overwrite', False)

        if not source_start or not target_start:
            return {"success": False, "error": "원본/대상 날짜가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 원본 날짜 범위 계산
            from datetime import datetime, timedelta
            source_start_dt = datetime.strptime(source_start, '%Y-%m-%d')
            source_end_dt = datetime.strptime(source_end, '%Y-%m-%d')
            target_start_dt = datetime.strptime(target_start, '%Y-%m-%d')

            # 날짜 차이 계산
            date_diff = (target_start_dt - source_start_dt).days

            # 원본 데이터 조회
            cursor.execute("""
                SELECT plan_date, slot_name, menus
                FROM meal_plans
                WHERE plan_date >= %s AND plan_date <= %s
                ORDER BY plan_date, slot_name
            """, (source_start, source_end))

            source_plans = cursor.fetchall()
            if not source_plans:
                return {"success": False, "error": "원본 날짜에 식단이 없습니다"}

            copied_count = 0
            skipped_count = 0

            for plan in source_plans:
                source_date = plan[0] if isinstance(plan[0], str) else plan[0].strftime('%Y-%m-%d')
                slot_name = plan[1]
                menus = plan[2]

                # 대상 날짜 계산
                source_dt = datetime.strptime(source_date, '%Y-%m-%d')
                target_dt = source_dt + timedelta(days=date_diff)
                target_date = target_dt.strftime('%Y-%m-%d')

                # 기존 데이터 확인
                cursor.execute("""
                    SELECT id FROM meal_plans
                    WHERE plan_date = %s AND slot_name = %s
                """, (target_date, slot_name))

                existing = cursor.fetchone()

                if existing and not overwrite:
                    skipped_count += 1
                    continue

                if existing and overwrite:
                    cursor.execute("""
                        UPDATE meal_plans
                        SET menus = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE plan_date = %s AND slot_name = %s
                    """, (menus, target_date, slot_name))
                else:
                    cursor.execute("""
                        INSERT INTO meal_plans (plan_date, slot_name, menus, updated_at)
                        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                    """, (target_date, slot_name, menus))

                copied_count += 1

            conn.commit()

            return {
                "success": True,
                "message": f"식단 복사 완료",
                "copied": copied_count,
                "skipped": skipped_count,
                "source_range": f"{source_start} ~ {source_end}",
                "target_start": target_start
            }

    except Exception as e:
        print(f"[ERROR] 식단 복사 오류: {e}")
        return {"success": False, "error": str(e)}


# ========== 식자재 기준중량 보정 API ==========

@app.patch("/api/ingredients/{ingredient_id}/base-weight")
async def update_ingredient_base_weight(ingredient_id: int, request: Request):
    """식자재 기준중량(g) 업데이트 - 사용자 보정용"""
    try:
        data = await request.json()
        base_weight_grams = data.get('base_weight_grams')

        if base_weight_grams is not None and base_weight_grams <= 0:
            return {"success": False, "error": "기준중량은 0보다 커야 합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE ingredients
                SET base_weight_grams = %s
                WHERE id = %s
                RETURNING id, ingredient_name, base_weight_grams
            """, (base_weight_grams, ingredient_id))

            result = cursor.fetchone()
            conn.commit()
            cursor.close()

            if result:
                print(f"[DB] 기준중량 업데이트: ID={result[0]}, 이름={result[1]}, 기준중량={result[2]}g")
                return {
                    "success": True,
                    "ingredient_id": result[0],
                    "ingredient_name": result[1],
                    "base_weight_grams": result[2]
                }
            else:
                return {"success": False, "error": "식자재를 찾을 수 없습니다"}
    except Exception as e:
        print(f"[ERROR] 기준중량 업데이트 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/ingredients/{ingredient_id}/base-weight")
async def get_ingredient_base_weight(ingredient_id: int):
    """식자재 기준중량(g) 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, ingredient_code, ingredient_name, specification, unit,
                       selling_price, base_weight_grams
                FROM ingredients
                WHERE id = %s
            """, (ingredient_id,))

            result = cursor.fetchone()
            cursor.close()

            if result:
                return {
                    "success": True,
                    "data": {
                        "id": result[0],
                        "ingredient_code": result[1],
                        "ingredient_name": result[2],
                        "specification": result[3],
                        "unit": result[4],
                        "selling_price": result[5],
                        "base_weight_grams": result[6]
                    }
                }
            else:
                return {"success": False, "error": "식자재를 찾을 수 없습니다"}
    except Exception as e:
        print(f"[ERROR] 기준중량 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/admin/base-weight-stats")
async def get_base_weight_stats(site_id: Optional[int] = None):
    """기준용량 보정 전체 통계 조회 - site_id 필터링 지원"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 🚫 비활성 협력업체 식자재 제외 (거래중단된 업체)
            inactive_filter = ""
            inactive_params = []
            cursor.execute("SELECT name FROM suppliers WHERE is_active = 0")
            inactive_suppliers = [row[0] for row in cursor.fetchall()]
            if inactive_suppliers:
                placeholders = ','.join(['%s'] * len(inactive_suppliers))
                inactive_filter = f" AND supplier_name NOT IN ({placeholders})"
                inactive_params = inactive_suppliers

            # 🏢 사업장별 협력업체 필터링
            supplier_filter = ""
            supplier_params = []
            if site_id:
                cursor.execute("""
                    SELECT DISTINCT s.name
                    FROM customer_supplier_mappings csm
                    JOIN suppliers s ON csm.supplier_id = s.id
                    WHERE csm.customer_id = %s AND csm.is_active = 1
                """, (site_id,))
                supplier_rows = cursor.fetchall()
                if supplier_rows:
                    supplier_names = [row[0] for row in supplier_rows]
                    placeholders = ','.join(['%s'] * len(supplier_names))
                    supplier_filter = f" AND supplier_name IN ({placeholders})"
                    supplier_params = supplier_names

            # 전체 (판매가 있는 것만)
            query_total = f"""
                SELECT COUNT(*) FROM ingredients
                WHERE selling_price IS NOT NULL AND selling_price > 0
                {inactive_filter}
                {supplier_filter}
            """
            cursor.execute(query_total, inactive_params + supplier_params)
            total = cursor.fetchone()[0]

            # 기준용량 입력완료 (base_weight_grams만 기준)
            query_corrected = f"""
                SELECT COUNT(*) FROM ingredients
                WHERE selling_price IS NOT NULL AND selling_price > 0
                AND base_weight_grams IS NOT NULL AND base_weight_grams > 0
                {inactive_filter}
                {supplier_filter}
            """
            cursor.execute(query_corrected, inactive_params + supplier_params)
            corrected = cursor.fetchone()[0]

            # 기준용량 미입력
            uncorrected = total - corrected

            cursor.close()

            return {
                "success": True,
                "stats": {
                    "total": total,
                    "corrected": corrected,
                    "uncorrected": uncorrected,
                    "progress": round(corrected / total * 100, 1) if total > 0 else 0
                },
                "filteredBySite": site_id
            }
    except Exception as e:
        print(f"[ERROR] 기준용량 통계 조회 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/admin/no-price-stats")
async def get_no_price_stats():
    """판매가 없는 식자재 업체별 통계"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT supplier_name, COUNT(*) as cnt
                FROM ingredients
                WHERE selling_price IS NULL OR selling_price <= 0
                GROUP BY supplier_name
                ORDER BY cnt DESC
            """)
            rows = cursor.fetchall()

            cursor.close()

            stats = [{"supplier": row[0] or "미지정", "count": row[1]} for row in rows]
            total = sum(s["count"] for s in stats)

            return {"success": True, "total": total, "by_supplier": stats}
    except Exception as e:
        return {"success": False, "error": str(e)}


# POST /api/admin/sites는 site_structure.py에서 처리


@app.post("/api/admin/sites-create")
async def create_new_site(request: Request):
    """새 사업장 추가 API"""
    try:
        body = await request.body()
        text = body.decode('utf-8')
        data = json.loads(text)

        site_name = (data.get('name') or '').strip()
        if not site_name:
            return {"success": False, "error": "사업장명은 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장 구분 처리 (management=급식관리, customer=고객사)
            business_category = data.get('business_category', 'management')
            site_type = (data.get('type') or '급식업체').strip()

            if business_category == 'management':
                # 급식관리 사업장은 site_categories에 추가 (위탁사업장 그룹)
                # 위탁사업장 그룹(group_code='Meal') ID 찾기
                cursor.execute("SELECT id FROM site_groups WHERE group_code = 'Meal'")
                meal_group = cursor.fetchone()
                if not meal_group:
                    return {"success": False, "error": "위탁사업장 그룹이 없습니다"}
                meal_group_id = meal_group[0]

                # site_code 자동 생성
                cursor.execute("SELECT COALESCE(MAX(id), 0) FROM site_categories")
                max_id = cursor.fetchone()[0] or 0
                site_code = f"NEW{str(max_id + 1).zfill(4)}"

                # site_categories에 추가
                cursor.execute("""
                    INSERT INTO site_categories (group_id, category_code, category_name, meal_types, meal_items, display_order, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                    RETURNING id, category_code
                """, (meal_group_id, site_code, site_name, '["조식","중식","석식"]', '["일반"]', max_id + 1))

                result = cursor.fetchone()
                new_id = result[0]
                new_code = result[1]
            else:
                # 고객사 사업장은 business_locations에 추가
                cursor.execute("SELECT COALESCE(MAX(id), 0) FROM business_locations")
                max_id = cursor.fetchone()[0] or 0
                site_code = f"C{str(max_id + 1).zfill(6)}"

                # 고객사는 운반으로 설정
                if site_type in ['급식업체', '위탁급식', '직영', '도시락업체']:
                    site_type = '운반'

                address = (data.get('address') or '').strip()
                manager_name = (data.get('manager_name') or '').strip()
                manager_phone = (data.get('contact_info') or '').strip()

                cursor.execute("""
                    INSERT INTO business_locations (site_code, site_name, site_type, business_category, address, manager_name, manager_phone, is_active, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 1, NOW(), NOW())
                    RETURNING id, site_code
                """, (site_code, site_name, site_type, 'customer', address, manager_name, manager_phone))

                result = cursor.fetchone()
                new_id = result[0]
                new_code = result[1]

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "사업장이 추가되었습니다",
                "site": {"id": new_id, "site_code": new_code, "site_name": site_name}
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.delete("/api/admin/sites/{site_id}")
async def delete_site(site_id: int):
    """사업장 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장 존재 확인
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


@app.get("/api/admin/fix-menu-suffixes")
async def fix_menu_suffixes(fix: bool = False):
    """메뉴명 접미사 중복 정리 및 base_name/suffix 분리

    - fix=false: 문제 있는 메뉴 목록만 반환
    - fix=true: 실제로 수정 실행

    정리 규칙:
    1. '-유,도-유,도' → '-유,도' (중복 제거)
    2. '-유,도-유' → '-유,도' (중복 제거)
    3. '-유도' → '-유,도' (표기 통일)
    4. recipe_name에 접미사 유지, base_name에 접미사 제외한 이름 저장
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 알려진 접미사 패턴 (정규화 대상)
            known_suffixes = ['-유,도', '-유도', '-운', '-요', '-학', '-초', '-중', '-고', '-도', '-유']

            # 중복 접미사 또는 정규화 필요한 레시피 찾기
            cursor.execute("""
                SELECT id, recipe_name, base_name, suffix
                FROM menu_recipes
                WHERE recipe_name LIKE '%%-유,도-유,도'
                   OR recipe_name LIKE '%%-유,도-유'
                   OR recipe_name LIKE '%%-유도-유'
                   OR recipe_name LIKE '%%-유도'
                ORDER BY id
            """)

            rows = cursor.fetchall()
            issues = []

            for row in rows:
                rid, recipe_name, current_base, current_suffix = row
                if not recipe_name:
                    continue

                clean_name = recipe_name.strip()

                # 중복 접미사 패턴 정리 → 단일 -유,도로 통일
                clean_name = clean_name.replace('-유,도-유,도', '-유,도')
                clean_name = clean_name.replace('-유,도-유', '-유,도')
                clean_name = clean_name.replace('-유도-유', '-유,도')
                clean_name = clean_name.replace('-유도', '-유,도')

                # base_name 추출 (접미사 제외)
                new_base_name = clean_name
                new_suffix = ''
                for s in known_suffixes:
                    if clean_name.endswith(s):
                        new_base_name = clean_name[:-len(s)].strip()
                        new_suffix = s
                        break

                # 변경이 있는 경우만 추가
                if clean_name != recipe_name or new_base_name != current_base:
                    issues.append({
                        "id": rid,
                        "current_name": recipe_name,
                        "suggested_name": clean_name,
                        "base_name": new_base_name,
                        "suffix": new_suffix
                    })

            if not fix:
                return {
                    "success": True,
                    "mode": "preview",
                    "found_issues": len(issues),
                    "issues": issues[:50],
                    "message": f"문제 발견: {len(issues)}건. fix=true로 수정 가능"
                }

            fixed_count = 0
            for issue in issues:
                cursor.execute("""
                    UPDATE menu_recipes
                    SET recipe_name = %s, base_name = %s, suffix = %s
                    WHERE id = %s
                """, (issue["suggested_name"], issue["base_name"], issue["suffix"], issue["id"]))
                fixed_count += 1

            conn.commit()

            return {
                "success": True,
                "mode": "fixed",
                "found_issues": len(issues),
                "fixed_count": fixed_count,
                "message": f"{fixed_count}개 메뉴명 수정 완료"
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/admin/fix-consignment-sites")
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
        return {"success": False, "error": str(e)}


@app.get("/api/admin/reset-meal-types")
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
        return {"success": False, "error": str(e)}


@app.post("/api/admin/backfill-canonical-names")
async def backfill_canonical_names():
    """
    기존 meal_plans 데이터에 canonical_name 일괄 보강/수정
    - canonical_name 누락된 메뉴에 추가
    - 사이트 접두사 포함된 canonical_name 정규화 (본사-현미밥-요 → 현미밥-요)
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            from utils.menu_name import get_canonical_name, SITE_PREFIXES

            # 1. 모든 meal_plans 조회 (개별 메뉴 레벨에서 확인 필요)
            cursor.execute("""
                SELECT id, menus
                FROM meal_plans
                WHERE menus IS NOT NULL
                  AND jsonb_array_length(menus) > 0
            """)
            rows = cursor.fetchall()

            if not rows:
                return {"success": True, "message": "보강할 데이터가 없습니다.", "updated": 0}

            # 2. 모든 레시피 ID 수집
            import json as json_module
            all_recipe_ids = set()
            for row in rows:
                menus = row[1]
                if isinstance(menus, str):
                    try:
                        menus = json_module.loads(menus)
                    except:
                        continue
                for m in (menus or []):
                    if isinstance(m, dict) and m.get('id'):
                        try:
                            all_recipe_ids.add(int(m['id']))
                        except (ValueError, TypeError):
                            pass

            # 3. recipe_id → canonical_name 매핑 (base_name 우선, 접두사 없는 정규명)
            id_to_canonical = {}
            if all_recipe_ids:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids))
                cursor.execute(f"""
                    SELECT id,
                           CASE WHEN COALESCE(suffix, '') != ''
                                THEN COALESCE(NULLIF(base_name, ''), recipe_name) || '-' || suffix
                                ELSE COALESCE(NULLIF(base_name, ''), recipe_name)
                           END AS canonical_name
                    FROM menu_recipes WHERE id IN ({rid_placeholders})
                """, list(all_recipe_ids))
                id_to_canonical = {r[0]: r[1] for r in cursor.fetchall()}

            # 4. 각 meal_plan 업데이트 (누락 추가 + 접두사 포함 수정)
            updated_count = 0
            added_count = 0
            fixed_prefix_count = 0
            for row in rows:
                plan_id, menus = row
                if isinstance(menus, str):
                    try:
                        menus = json_module.loads(menus)
                    except:
                        continue

                changed = False
                for m in (menus or []):
                    if not isinstance(m, dict) or not m.get('id'):
                        continue
                    try:
                        rid = int(m['id'])
                    except (ValueError, TypeError):
                        continue

                    existing_cn = m.get('canonical_name', '')

                    # Case 1: canonical_name 누락 → 추가
                    if not existing_cn:
                        if rid in id_to_canonical:
                            m['canonical_name'] = get_canonical_name(id_to_canonical[rid])
                            changed = True
                            added_count += 1
                    # Case 2: canonical_name에 사이트 접두사 포함 → 정규화
                    elif any(existing_cn.startswith(p) for p in SITE_PREFIXES):
                        new_cn = get_canonical_name(existing_cn)
                        if new_cn != existing_cn:
                            m['canonical_name'] = new_cn
                            changed = True
                            fixed_prefix_count += 1

                if changed:
                    from psycopg2.extras import Json
                    cursor.execute("""
                        UPDATE meal_plans SET menus = %s WHERE id = %s
                    """, (Json(menus), plan_id))
                    updated_count += 1

            conn.commit()

            total_fixed = added_count + fixed_prefix_count
            print(f"[canonical_name 보강] {updated_count}개 식단 업데이트 (추가: {added_count}, 접두사수정: {fixed_prefix_count})")
            return {
                "success": True,
                "message": f"{updated_count}개 식단 업데이트 (추가: {added_count}개, 접두사수정: {fixed_prefix_count}개)",
                "updated_plans": updated_count,
                "added_canonical": added_count,
                "fixed_prefix": fixed_prefix_count,
                "total_recipes_mapped": len(id_to_canonical)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/admin/migrate-yeongnam-site-id")
async def migrate_yeongnam_site_id():
    """영남지사 전용 운반 사업장 site_id를 2로 마이그레이션 (일회성)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 공통 사업장 (본사+영남 모두 납품) - 제외
            common_sites = ['아람', '원앤원']

            # 영남지사 전용 운반 사업장 업데이트
            # business_type='운반'이고 site_id=1이고 공통 사업장이 아닌 것
            cursor.execute("""
                UPDATE meal_counts
                SET site_id = 2
                WHERE business_type = '운반'
                  AND site_id = 1
                  AND site_name NOT IN %s
                RETURNING id
            """, (tuple(common_sites),))

            updated_ids = cursor.fetchall()
            updated_count = len(updated_ids)

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"영남지사 운반 사업장 {updated_count}건 site_id=2로 업데이트 완료",
                "updated_count": updated_count
            }
    except Exception as e:
        print(f"[API] 영남지사 마이그레이션 오류: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/admin/site-id-validation")
async def validate_site_id_mapping():
    """site_id 매핑 검증 및 데이터 무결성 확인 API"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            result = {
                "success": True,
                "site_groups": [],
                "meal_counts_distribution": [],
                "validation": {
                    "is_valid": True,
                    "issues": []
                }
            }

            # 1. site_groups 테이블 확인
            cursor.execute("""
                SELECT id, group_code, group_name, is_active
                FROM site_groups
                ORDER BY id
            """)
            for row in cursor.fetchall():
                result["site_groups"].append({
                    "id": row[0],
                    "group_code": row[1],
                    "group_name": row[2],
                    "is_active": row[3]
                })

            # 2. meal_counts의 site_id 분포
            cursor.execute("""
                SELECT
                    mc.site_id,
                    sg.group_name,
                    COUNT(*) as record_count,
                    COUNT(DISTINCT mc.site_name) as unique_sites,
                    array_agg(DISTINCT mc.business_type) as business_types
                FROM meal_counts mc
                LEFT JOIN site_groups sg ON mc.site_id = sg.id
                GROUP BY mc.site_id, sg.group_name
                ORDER BY mc.site_id
            """)
            for row in cursor.fetchall():
                result["meal_counts_distribution"].append({
                    "site_id": row[0],
                    "group_name": row[1] or "미매핑",
                    "record_count": row[2],
                    "unique_sites": row[3],
                    "business_types": row[4]
                })

            # 3. 검증: site_id가 site_groups에 없는 경우
            cursor.execute("""
                SELECT DISTINCT mc.site_id
                FROM meal_counts mc
                LEFT JOIN site_groups sg ON mc.site_id = sg.id
                WHERE sg.id IS NULL AND mc.site_id IS NOT NULL
            """)
            orphan_ids = [row[0] for row in cursor.fetchall()]
            if orphan_ids:
                result["validation"]["is_valid"] = False
                result["validation"]["issues"].append({
                    "type": "orphan_site_id",
                    "message": f"site_groups에 없는 site_id 발견: {orphan_ids}",
                    "site_ids": orphan_ids
                })

            # 4. 검증: site_id가 NULL인 레코드
            cursor.execute("SELECT COUNT(*) FROM meal_counts WHERE site_id IS NULL")
            null_count = cursor.fetchone()[0]
            if null_count > 0:
                result["validation"]["issues"].append({
                    "type": "null_site_id",
                    "message": f"site_id가 NULL인 레코드: {null_count}건",
                    "count": null_count
                })

            # 5. 본사/영남 매핑 확인
            cursor.execute("""
                SELECT id, group_name FROM site_groups WHERE id IN (1, 2)
            """)
            id_mapping = {row[0]: row[1] for row in cursor.fetchall()}
            result["validation"]["id_mapping"] = {
                "id_1": id_mapping.get(1, "미설정"),
                "id_2": id_mapping.get(2, "미설정")
            }

            cursor.close()

            return result

    except Exception as e:
        print(f"[API] site_id 검증 오류: {e}")
        return {"success": False, "error": str(e)}




# ============================================
# ★★★ Phase 5: 레거시 테이블 마이그레이션 확인 API ★★★
# ============================================

@app.get("/api/admin/verify-migration")
async def verify_migration():
    """레거시 테이블 → 신규 테이블 마이그레이션 상태 확인

    확인 항목:
    1. meal_count_sites → slot_clients 마이그레이션 상태
    2. meal_slot_settings → category_slots 마이그레이션 상태
    3. 테이블 존재 여부 확인
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            result = {
                "tables_exist": {},
                "row_counts": {},
                "migration_status": {},
                "missing_data": []
            }

            # 1. 테이블 존재 여부 확인
            tables_to_check = ['site_groups', 'site_categories', 'category_slots', 'slot_clients',
                              'meal_count_sites', 'meal_slot_settings']
            for table in tables_to_check:
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = %s
                    )
                """, (table,))
                result["tables_exist"][table] = cursor.fetchone()[0]

            # 2. 행 개수 확인
            for table in tables_to_check:
                if result["tables_exist"].get(table):
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    result["row_counts"][table] = cursor.fetchone()[0]

            # 3. 마이그레이션 상태 확인
            # 3-1. meal_count_sites → slot_clients
            if result["tables_exist"].get("meal_count_sites") and result["tables_exist"].get("slot_clients"):
                # meal_count_sites에는 있지만 slot_clients에 없는 사업장 확인
                cursor.execute("""
                    SELECT mcs.id, mcs.site_name, mcs.slot_name, mcs.business_type
                    FROM meal_count_sites mcs
                    WHERE mcs.is_active = TRUE
                    AND NOT EXISTS (
                        SELECT 1 FROM slot_clients scl
                        JOIN category_slots cs ON cs.id = scl.slot_id
                        JOIN site_categories sc ON sc.id = cs.category_id
                        WHERE scl.client_name = mcs.site_name
                        AND cs.slot_name = mcs.slot_name
                    )
                    LIMIT 20
                """)
                missing_clients = cursor.fetchall()
                if missing_clients:
                    result["missing_data"].append({
                        "source": "meal_count_sites",
                        "target": "slot_clients",
                        "count": len(missing_clients),
                        "samples": [{"id": r[0], "site_name": r[1], "slot_name": r[2], "business_type": r[3]} for r in missing_clients]
                    })
                    result["migration_status"]["meal_count_sites_to_slot_clients"] = "INCOMPLETE"
                else:
                    result["migration_status"]["meal_count_sites_to_slot_clients"] = "COMPLETE"

            # 3-2. meal_slot_settings → category_slots
            if result["tables_exist"].get("meal_slot_settings") and result["tables_exist"].get("category_slots"):
                # meal_slot_settings에는 있지만 category_slots에 없는 슬롯 확인
                cursor.execute("""
                    SELECT mss.id, mss.display_name, mss.slot_key, mss.target_cost, mss.selling_price
                    FROM meal_slot_settings mss
                    WHERE mss.is_active = TRUE
                    AND mss.entity_type = 'category'
                    AND NOT EXISTS (
                        SELECT 1 FROM category_slots cs
                        WHERE cs.slot_name = mss.display_name
                        AND cs.is_active = TRUE
                    )
                    LIMIT 20
                """)
                missing_slots = cursor.fetchall()
                if missing_slots:
                    result["missing_data"].append({
                        "source": "meal_slot_settings",
                        "target": "category_slots",
                        "count": len(missing_slots),
                        "samples": [{"id": r[0], "display_name": r[1], "slot_key": r[2], "target_cost": r[3], "selling_price": r[4]} for r in missing_slots]
                    })
                    result["migration_status"]["meal_slot_settings_to_category_slots"] = "INCOMPLETE"
                else:
                    result["migration_status"]["meal_slot_settings_to_category_slots"] = "COMPLETE"

            cursor.close()

            # 전체 상태 판단
            all_complete = all(v == "COMPLETE" for v in result["migration_status"].values())
            all_tables_exist = all(result["tables_exist"].get(t) for t in ['site_groups', 'site_categories', 'category_slots', 'slot_clients'])

            result["overall_status"] = "READY_FOR_CLEANUP" if (all_complete and all_tables_exist) else "MIGRATION_NEEDED"

            print(f"[마이그레이션 확인] 상태: {result['overall_status']}")
            return {"success": True, **result}

    except Exception as e:
        print(f"[마이그레이션 확인 오류]: {e}")
        return {"success": False, "error": str(e)}


# ========== 식단표 배경 이미지 API ==========

@app.get("/api/meal-plan/backgrounds")
async def get_meal_plan_backgrounds():
    """저장된 배경 이미지 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 테이블 존재 확인 및 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_plan_backgrounds (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    image_data TEXT NOT NULL,
                    file_type VARCHAR(20) DEFAULT 'image/jpeg',
                    file_size INTEGER DEFAULT 0,
                    created_by INTEGER,
                    is_shared BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

            cursor.execute("""
                SELECT id, name, image_data, file_type, file_size, created_at
                FROM meal_plan_backgrounds
                WHERE is_shared = TRUE
                ORDER BY created_at DESC
            """)

            rows = cursor.fetchall()
            backgrounds = []
            for row in rows:
                backgrounds.append({
                    "id": row[0],
                    "name": row[1],
                    "data": row[2],
                    "file_type": row[3],
                    "file_size": row[4],
                    "created_at": str(row[5]) if row[5] else None
                })

            cursor.close()

            return {"success": True, "backgrounds": backgrounds, "count": len(backgrounds)}
    except Exception as e:
        print(f"[API] 배경 이미지 목록 조회 오류: {e}")
        return {"success": False, "error": str(e), "backgrounds": []}


@app.post("/api/meal-plan/backgrounds")
async def upload_meal_plan_background(request: Request):
    """배경 이미지 업로드"""
    try:
        data = await request.json()
        name = data.get('name', '커스텀 이미지')
        image_data = data.get('image_data')  # Base64 데이터
        file_type = data.get('file_type', 'image/jpeg')

        if not image_data:
            return {"success": False, "error": "이미지 데이터가 없습니다"}

        # 이미지 크기 계산 (Base64 문자열 길이 기준, 대략적)
        file_size = len(image_data) * 3 // 4  # Base64 디코딩 후 대략적 크기

        # 5MB 제한
        if file_size > 5 * 1024 * 1024:
            return {"success": False, "error": "이미지 크기는 5MB 이하로 해주세요"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO meal_plan_backgrounds (name, image_data, file_type, file_size, is_shared)
                VALUES (%s, %s, %s, %s, TRUE)
                RETURNING id
            """, (name, image_data, file_type, file_size))

            bg_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            print(f"[API] 배경 이미지 업로드 완료: id={bg_id}, name={name}")
            return {"success": True, "id": bg_id, "message": "이미지가 저장되었습니다"}
    except Exception as e:
        print(f"[API] 배경 이미지 업로드 오류: {e}")
        return {"success": False, "error": str(e)}


@app.delete("/api/meal-plan/backgrounds/{bg_id}")
async def delete_meal_plan_background(bg_id: int):
    """배경 이미지 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM meal_plan_backgrounds WHERE id = %s", (bg_id,))
            deleted = cursor.rowcount
            conn.commit()
            cursor.close()

            if deleted > 0:
                print(f"[API] 배경 이미지 삭제 완료: id={bg_id}")
                return {"success": True, "message": "이미지가 삭제되었습니다"}
            else:
                return {"success": False, "error": "이미지를 찾을 수 없습니다"}
    except Exception as e:
        print(f"[API] 배경 이미지 삭제 오류: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    print(f"[{APP_TITLE}] 시스템 시작 (mode={APP_MODE})")
    print(f"[서버] 주소: http://{HOST}:{PORT}")
    print(f"[아키텍처] Smart Monolith")
    print(f"[환경] {'Railway' if 'RAILWAY_ENVIRONMENT' in os.environ else 'Local'}")

    # reload 비활성화 (성능 향상) - 개발 시 필요하면 ENABLE_RELOAD=1 환경변수 설정
    enable_reload = os.environ.get('ENABLE_RELOAD', '0') == '1'
    if enable_reload:
        print(f"[서버] Auto-reload 활성화 (개발 모드)")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=enable_reload)



