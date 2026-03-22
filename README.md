# 다함 식자재 관리 시스템

급식 식자재/레시피/식단 관리 시스템

## 환경 구성

| 환경 | 데이터베이스 | URL |
|------|-------------|-----|
| **로컬 개발** | Railway PostgreSQL | http://localhost:8080 |
| **프로덕션** | Fly.io PostgreSQL | https://dahamfood.kr |

- 로컬과 프로덕션 DB는 분리되어 있음
- DB 동기화 필요 시 `★SYNC_DB.bat` 사용

## 빠른 시작

### 서버 실행

```bash
# 배치 파일 사용
★START_SERVER.bat

# 또는 직접 실행
python main.py

# 접속: http://localhost:8080
```

### 배포

```bash
# GitHub push 시 자동 배포 (GitHub Actions → Fly.io)
git push origin master
```

## 프로젝트 구조

```
daham-meal-management/
├── main.py                 # 메인 서버 (FastAPI, 포트 8080)
├── core/                   # 핵심 모듈 (config, database, auth)
├── routers/               # API 라우터
├── static/                # CSS, JS 파일
├── *.html                 # 페이지들
├── .env                   # 환경변수 (DATABASE_URL)
├── fly.toml               # Fly.io 배포 설정
└── ★START_SERVER.bat     # 서버 시작
```

## 주요 페이지

| 페이지 | 파일 | 설명 |
|--------|------|------|
| 식자재 관리 | ingredients_management.html | 84,000+ 식자재 |
| 메뉴/레시피 | menu_recipe_management.html | 레시피 편집 |
| 식단 관리 | meal_plan_advanced.html | 식단 계획 |
| 대시보드 | dashboard.html | 통계 |

## 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | FastAPI, Python 3.8+ |
| Database | PostgreSQL (Railway/Fly.io) |
| Frontend | Vanilla JS, HTML5, CSS3 |
| Deploy | Fly.io (GitHub Actions 자동 배포) |

## 문제 해결

```bash
# 포트 확인
netstat -ano | findstr :8080

# 서버 종료
STOP_ALL_SERVERS.bat
```

## 문서

- [CLAUDE.md](CLAUDE.md) - 개발 가이드

---

**업데이트**: 2026-01-21 | **도메인**: dahamfood.kr
