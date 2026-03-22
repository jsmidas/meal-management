# 급식관리 시스템 - 개발 가이드

## 핵심 규칙

1. **main.py만 서버 파일** (포트 8080)
2. **PostgreSQL만 사용** (SQLite 사용 금지)
3. **API URL은 상대 경로** (`/api/...`, localhost 하드코딩 금지)
4. **APP_MODE=simple** — 카테고리/suffix UI 숨김, prefix만 유지

## 프로젝트 특징 (다함푸드 기반 포크)

- 다함푸드 시스템에서 포크한 판매용 버전
- `APP_MODE` 환경변수로 simple/advanced 모드 전환
- simple 모드: 카테고리 탭 숨김, suffix 항상 빈 문자열, 형제 동기화 스킵
- advanced 모드: 다함푸드와 동일한 전체 기능

## 환경 구성

| 환경 | DB | URL |
|------|-----|-----|
| **로컬 개발** | Railway PostgreSQL | http://localhost:8080 |
| **프로덕션** | (미설정) | (미설정) |

## 빠른 시작

```bash
# 서버 시작
python main.py

# 개발 모드 (auto-reload)
set ENABLE_RELOAD=1 && python main.py

# 접속: http://localhost:8080
```

## Simple 모드 구조

### 모드 감지 흐름
```
.env (APP_MODE=simple)
  → core/config.py (APP_MODE 로드)
  → /api/app-config (프론트엔드에 전달)
  → static/js/app-mode.js (body.mode-simple 클래스 적용)
  → static/css/simple-mode.css (카테고리 UI 숨김)
```

### 숨겨지는 UI
- 레시피 관리: suffix 입력, 카테고리 선택
- 식단 관리: 카테고리 탭 (도시락/운반/학교/요양원)
- 조리/소분/전처리 지시서: 카테고리 필터
- 출력 옵션: 카테고리 선택

### 서버 분기
- `routers/recipes.py`: suffix 강제 빈 문자열, 형제동기화 스킵
- `routers/order_calculation.py`: suffix 빈 → base_name만 자동 사용
- `routers/instructions.py`: suffix 빈 → fallback 자동 처리

## 주요 설정 파일

| 파일 | 설명 |
|------|------|
| `.env` | DATABASE_URL, APP_MODE, APP_TITLE |
| `core/config.py` | 앱 설정 (모드, 타이틀) |
| `static/js/app-mode.js` | 프론트 모드 감지 |
| `static/css/simple-mode.css` | 카테고리 UI 숨김 CSS |

## 개발 시 주의사항

1. **다함푸드 코드 동기화**: 다함푸드에서 버그 수정/기능 추가 시 이 프로젝트에도 반영 필요
2. **카테고리 제거 아님**: 코드에서 카테고리를 삭제하지 않고 숨기기만 함
3. **suffix는 항상 빈 문자열**: simple 모드에서 suffix 관련 코드는 자동 스킵됨
4. **prefix는 유지**: 사업장별 레시피 구분은 그대로

---
**마지막 업데이트**: 2026-03-23
