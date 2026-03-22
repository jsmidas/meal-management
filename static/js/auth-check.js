/**
 * 공통 인증 체크 모듈
 * 보호가 필요한 모든 페이지의 <head>에 포함하여 사용
 *
 * 사용법: <script src="/static/js/auth-check.js"></script>
 */

(function() {
    'use strict';

    // 로그인이 필요 없는 페이지 목록
    const PUBLIC_PAGES = [
        '/login.html',
        '/login',
        '/register.html',
        '/register',
        '/supplier_login.html',
        '/supplier_login'
    ];

    // 현재 페이지가 공개 페이지인지 확인
    const currentPath = window.location.pathname;
    const isPublicPage = PUBLIC_PAGES.some(page =>
        currentPath.endsWith(page) || currentPath === page
    );

    // 공개 페이지면 인증 체크 스킵
    if (isPublicPage) {
        console.log('[AuthCheck] 공개 페이지 - 인증 체크 스킵');
        return;
    }

    /**
     * 토큰 만료 확인
     * - JWT 토큰: exp 클레임으로 만료 확인
     * - 서버 토큰 (auth_token_xxx, temp_token_xxx): 항상 유효로 처리
     */
    function isTokenExpired(token) {
        if (!token) return true;

        try {
            // 서버에서 발급한 임시 토큰 형식 허용
            // 형식: auth_token_xxx, temp_token_xxx, supplier_xxx
            if (token.startsWith('auth_token_') ||
                token.startsWith('temp_token_') ||
                token.startsWith('supplier_')) {
                console.log('[AuthCheck] 서버 토큰 감지 - 유효');
                return false; // 만료되지 않음
            }

            // JWT 구조: header.payload.signature
            const parts = token.split('.');
            if (parts.length !== 3) {
                // JWT도 아니고 알려진 형식도 아니면 일단 허용
                // (서버 API 호출 시 실제 검증됨)
                console.log('[AuthCheck] 알 수 없는 토큰 형식 - 일단 허용');
                return false;
            }

            const payload = JSON.parse(atob(parts[1]));
            const now = Math.floor(Date.now() / 1000);

            // 만료 시간 확인
            if (payload.exp && payload.exp < now) {
                console.log('[AuthCheck] JWT 토큰 만료됨');
                return true;
            }

            return false;
        } catch (e) {
            // 파싱 오류 시에도 일단 허용 (서버에서 최종 검증)
            console.log('[AuthCheck] 토큰 파싱 실패 - 일단 허용');
            return false;
        }
    }

    /**
     * 로그인 상태 확인
     */
    function checkAuth() {
        const token = localStorage.getItem('auth_token');
        const userInfo = localStorage.getItem('user_info') || localStorage.getItem('user');

        // 토큰 없음
        if (!token) {
            console.log('[AuthCheck] 토큰 없음 - 로그인 필요');
            return false;
        }

        // 토큰 만료 확인
        if (isTokenExpired(token)) {
            console.log('[AuthCheck] 토큰 만료 - 로그인 필요');
            // 만료된 토큰 삭제
            clearAuthData();
            return false;
        }

        // 사용자 정보 없음
        if (!userInfo) {
            console.log('[AuthCheck] 사용자 정보 없음 - 로그인 필요');
            return false;
        }

        console.log('[AuthCheck] 인증 확인됨');
        return true;
    }

    /**
     * 인증 데이터 삭제
     */
    function clearAuthData() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_info');
        localStorage.removeItem('user');
        localStorage.removeItem('token');
    }

    /**
     * 로그인 페이지로 리다이렉트
     */
    function redirectToLogin() {
        // 현재 페이지 URL 저장 (로그인 후 돌아오기 위해)
        const returnUrl = encodeURIComponent(window.location.href);
        window.location.href = `/login.html?return=${returnUrl}`;
    }

    // 페이지 로드 시 즉시 인증 체크 실행
    if (!checkAuth()) {
        // 인증 실패 시 페이지 내용 숨기고 로그인 페이지로 리다이렉트
        document.documentElement.style.display = 'none';
        redirectToLogin();
    } else {
        console.log('[AuthCheck] 인증 성공 - 페이지 접근 허용');
    }

    // 전역 함수로 내보내기 (다른 스크립트에서 사용 가능)
    window.AuthCheck = {
        checkAuth: checkAuth,
        isTokenExpired: isTokenExpired,
        clearAuthData: clearAuthData,
        redirectToLogin: redirectToLogin
    };
})();
