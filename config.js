/**
 * 급식관리 시스템 설정 파일
 * 🔧 환경별 자동 설정 (로컬/Railway/GCP 배포 모두 자동 처리)
 *
 * 지원 환경:
 * - local: 개발 환경 (localhost)
 * - railway: Railway 배포 환경
 * - gcp: Google Cloud Platform 배포 환경
 * - daham_domain: 도메인 연결 후 (dahamfood.kr)
 */

// 환경 자동 감지
function detectEnvironment() {
    const hostname = window.location.hostname;

    // Railway 배포 환경
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
        return 'railway';
    }

    // GCP 배포 환경 (IP주소 또는 GCP 도메인)
    if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/) ||
        hostname.includes('googleapis.com') ||
        hostname.includes('compute.googleapis.com') ||
        hostname.includes('run.app')) {
        return 'gcp';
    }

    // 로컬 개발 환경
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'local';
    }

    // 도메인 (GCP 배포 후 도메인 연결)
    if (hostname === 'dahamfood.kr' || hostname.includes('dahamfood')) {
        return 'daham_domain';
    }

    return 'production';
}

// 환경별 자동 설정
const environment = detectEnvironment();
const currentHost = window.location.protocol + "//" + window.location.host;

// API 서버 주소 결정
let apiBaseUrl;
if (environment === 'daham_domain') {
    // dahamfood.kr에서는 로컬 서버를 사용할 수 없으므로 현재 호스트 사용
    apiBaseUrl = currentHost;
} else {
    apiBaseUrl = currentHost;
}

window.CONFIG = window.CONFIG || {
    ENVIRONMENT: environment,

    API: {
        BASE_URL: apiBaseUrl,
        TIMEOUT: 30000
    },

    // 브랜딩 설정 (화이트라벨용)
    BRANDING: {
        COMPANY_NAME: '급식관리',
        SYSTEM_NAME: '급식관리',
        LOGO_PATH: '/static/images/logo.png?v=20251027',
        SIDEBAR_TITLE: '급식관리',
        COLORS: {
            PRIMARY: '#2a5298',
            SECONDARY: '#667eea'
        }
    },

    // 하위 호환성을 위한 기존 필드들
    API_BASE_URL: apiBaseUrl,
    API_TIMEOUT: 30000,
    DEBUG: environment === 'local' || environment === 'daham_domain'
};

// API URL 헬퍼 함수 (선택사항)
window.getApiUrl = function (endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    return window.CONFIG.API.BASE_URL + cleanEndpoint;
};

// 환경 정보 출력
console.log(`✅ CONFIG.js 로드 완료 [${environment.toUpperCase()}]`, {
    host: currentHost,
    hostname: window.location.hostname,
    environment: environment,
    apiBaseUrl: window.CONFIG.API.BASE_URL,
    debug: window.CONFIG.DEBUG
});
