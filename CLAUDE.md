# 다함 식자재 관리 시스템 - 개발 가이드

## 핵심 규칙

1. **main.py만 서버 파일** (포트 8080)
2. **PostgreSQL만 사용** (SQLite 사용 금지)
3. **API URL은 상대 경로** (`/api/...`, localhost 하드코딩 금지)

## 환경 구성

| 환경 | DB | URL |
|------|-----|-----|
| **로컬 개발** | Railway PostgreSQL | http://localhost:8080 |
| **프로덕션** | Fly.io PostgreSQL | https://dahamfood.kr |

- 로컬과 프로덕션 DB는 분리되어 있음
- 프록시 없이 바로 연결 가능

## 빠른 시작

### 로컬 서버 실행

```bash
# 서버 시작
python main.py

# 또는 배치 파일 사용
★START_SERVER.bat

# 개발 모드 (auto-reload)
set ENABLE_RELOAD=1 && python main.py

# 접속: http://localhost:8080
```

### 배포

```bash
# GitHub push 시 자동 배포
git push origin master

# 수동 배포 (필요시)
flyctl deploy
```

## 프로젝트 구조

```
daham-meal-management/
├── main.py                 # 메인 서버 (FastAPI)
├── core/                   # 핵심 모듈
│   ├── config.py          # 설정
│   ├── database.py        # DB 연결
│   └── auth.py            # 인증
├── routers/               # API 라우터
│   ├── admin.py           # 관리자 API
│   ├── ingredients.py     # 식자재 API (검색 정렬 포함)
│   ├── recipes.py         # 레시피 API
│   └── ...
├── static/                # 정적 파일
│   ├── css/              # 스타일
│   ├── js/               # JavaScript
│   └── modules/          # JS 모듈
├── utils/                 # 유틸리티
│   └── batch_calculation.py  # 배치 계산
├── *.html                 # 페이지들
├── .env                   # 환경변수 (DATABASE_URL)
├── fly.toml               # Fly.io 배포 설정
├── Dockerfile             # 컨테이너 설정
├── ★START_SERVER.bat     # 서버 시작
└── STOP_ALL_SERVERS.bat   # 서버 종료
```

## 주요 페이지

| 페이지 | 파일 | 설명 |
|--------|------|------|
| 식자재 관리 | ingredients_management.html | 84,000+ 식자재 |
| 메뉴/레시피 | menu_recipe_management.html | 레시피 편집 |
| 식단 관리 | meal_plan_advanced.html | 식단 계획 |
| 대시보드 | dashboard.html | 통계 |
| 관리자 | admin_dashboard.html | 시스템 관리 |

## 데이터베이스

### 로컬 개발 (Railway)
```
DATABASE_URL=postgresql://postgres:PASSWORD@metro.proxy.rlwy.net:47620/railway
```

### 프로덕션 (Fly.io)
- Fly.io 내부에서 자동 연결
- 외부 접속 시 `flyctl proxy` 필요

**주요 테이블:**
- `ingredients` - 식자재 (84,000+개)
- `menu_recipes` - 메뉴/레시피
- `menu_recipe_ingredients` - 레시피 재료
- `users` - 사용자
- `suppliers` - 협력업체

### 프로덕션 DB → 로컬 동기화 (필요시)

```bash
# ★SYNC_DB.bat 사용 (권장)
# Fly.io → Railway 전체 동기화

# 수동 동기화 (필요시)
flyctl proxy 5433:5432 -a daham-db
pg_dump "postgresql://postgres:PASSWORD@localhost:5433/postgres" > backup.sql
psql "RAILWAY_DATABASE_URL" < backup.sql
```

**주의**: `scripts/` 폴더의 sync 스크립트는 사용하지 마세요 (삭제됨)

## API 엔드포인트

```
GET  /api/admin/ingredients-enhanced  # 식자재 검색 (정렬 포함)
GET  /api/admin/dashboard-stats       # 대시보드 통계
POST /api/recipe/save                 # 레시피 저장
GET  /api/admin/users                 # 사용자 목록
```

## 검색 정렬 규칙

**식자재 검색 시 자동 정렬:**
- 단위당 단가 낮은 순 (price_per_unit ASC)
- 단가 없는 항목은 맨 뒤로

```python
# routers/ingredients.py
if is_searching:
    order_clause = "ORDER BY COALESCE(price_per_unit, 999999) ASC"
```

## ★ 날짜 용어 정의 (필수 준수)

### 핵심 날짜 (발주 관련)

| 한글 용어 | DB 컬럼 | 의미 | 기본값 |
|---|---|---|---|
| **식단표 날짜** | `usage_date`, `plan_date` | 메뉴가 제공되는 날 (급식일) | 오늘+5일 |
| **입고일** | `order_date`, `expected_delivery_date` | 식자재가 도착하는 날 | 오늘+3일 |
| **발주일** | `created_at`, `actual_order_date` | 발주서를 작성/등록한 날 | 자동 기록 |
| **선발주일** | `lead_time` | 입고까지 필요한 최소 일수 | 식자재별 상이 |

### 기타 날짜

| 한글 용어 | DB 컬럼 | 의미 |
|---|---|---|
| **검수일** | `receiving_date` | 실제 입고 확인한 날 |
| **지시서 날짜** | `instruction_date` | 조리 지시서 기준일 (= 식단표 날짜) |
| **매출일** | `sale_date` | 매출 발생 기준일 |
| **정산일** | `payment_date` | 대금 지급일 |
| **가격 적용일** | `effective_date` | 가격 변경 적용 시작일 |
| **업체 휴무** | `blackout_start/end` | 업체 휴무 기간 |
| **계약 기간** | `contract_start/end` | 업체 계약 기간 |
| **위생증 만료** | `health_cert_expiry` | 위생증 만료일 |

### 용어 변환 규칙 (반드시 준수)

**절대 금지:**
- ❌ `order_date` → "발주일" (잘못됨!)
- ❌ `usage_date` → "사용일", "납품일" (잘못됨!)

**올바른 표기:**
- ✅ `order_date` → **"입고일"**
- ✅ `usage_date` → **"식단표 날짜"**
- ✅ `created_at` → **"발주일"**
- ✅ `plan_date` → **"식단표 날짜"**
- ✅ `expected_delivery_date` → **"입고일"** (= order_date와 동일)
- ✅ `actual_order_date` → **"발주일"** (= created_at와 동일)

## 개발 시 주의사항

1. **API URL**: 항상 상대 경로 사용 (`/api/...`)
2. **DB 연결**: `get_db_connection()` 함수만 사용
3. **정렬**: 검색 시 단위당 단가 기준 정렬 유지
4. **커밋**: 기능별로 작은 단위로 커밋
5. **날짜 용어**: 위 "날짜 용어 정의" 반드시 준수

## Fly.io 관리

```bash
# 로그 확인
flyctl logs -a daham-meal-management

# 머신 재시작
flyctl machines restart -a daham-meal-management

# DB 직접 접속
flyctl postgres connect -a daham-db

# 앱 상태 확인
flyctl status -a daham-meal-management

# 도메인 인증서 확인
flyctl certs check dahamfood.kr -a daham-meal-management
```

## 문제 해결

```bash
# 포트 확인
netstat -ano | findstr :8080

# Python 프로세스 종료
taskkill /F /IM python.exe

# 프로덕션 사이트 확인
curl https://dahamfood.kr/
```

## 배포

- **자동 배포**: `git push origin master` → GitHub Actions → Fly.io
- **프로덕션 URL**: https://dahamfood.kr
- **Fly.io 대시보드**: https://fly.io/apps/daham-meal-management
- **도메인**: dahamfood.kr (카페24에서 관리, CNAME → Fly.io)

---
**마지막 업데이트**: 2026-03-09
