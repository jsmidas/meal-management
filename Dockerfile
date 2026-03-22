# 최적화된 Python 3.11 베이스 이미지
FROM python:3.11-slim

# 시스템 최적화 (curl 추가 - 헬스체크용)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    postgresql-client \
    fonts-nanum \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --upgrade pip

# 작업 디렉토리 설정
WORKDIR /app

# 의존성 설치 최적화 (레이어 캐싱)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip cache purge

# 환경 변수 설정 (앞으로 이동)
ENV PYTHONIOENCODING=utf-8
ENV PORT=8080
ENV API_PORT=8080
ENV PYTHONUNBUFFERED=1

# 앱 파일들 복사 (의존성 설치 후)
COPY . .

# 포트 노출
EXPOSE 8080

# 비루트 사용자로 실행 (보안 개선)
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app

# 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# 앱 실행
CMD ["python", "main.py"]
