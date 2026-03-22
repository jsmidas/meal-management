/**
 * 관리자 페이지 접근 권한 체크 모듈
 * admin_dashboard.html 등 관리자 전용 페이지에서 사용
 *
 * 접근 가능한 역할:
 * - admin (시스템 관리자, 사업장 관리자)
 * - operator (운영 담당자)
 *
 * 사용법: <script src="/static/js/admin-auth-check.js"></script>
 * (auth-check.js 다음에 로드)
 */

(function() {
    'use strict';

    // 관리자 페이지 접근 가능 역할 목록
    const ADMIN_ALLOWED_ROLES = ['admin', 'operator'];

    /**
     * 사용자 역할 확인
     */
    function getUserRole() {
        try {
            const userInfoStr = localStorage.getItem('user_info') || localStorage.getItem('user');
            if (userInfoStr) {
                const userInfo = JSON.parse(userInfoStr);
                return userInfo.role || null;
            }
        } catch (e) {
            console.error('[AdminAuthCheck] 사용자 정보 파싱 실패:', e);
        }
        return null;
    }

    /**
     * 관리자 권한 확인
     */
    function checkAdminAccess() {
        const userRole = getUserRole();

        if (!userRole) {
            console.log('[AdminAuthCheck] 역할 정보 없음 - 접근 거부');
            return false;
        }

        const hasAccess = ADMIN_ALLOWED_ROLES.includes(userRole);

        if (hasAccess) {
            console.log(`[AdminAuthCheck] 역할: ${userRole} - 관리자 페이지 접근 허용`);
        } else {
            console.log(`[AdminAuthCheck] 역할: ${userRole} - 관리자 페이지 접근 거부`);
        }

        return hasAccess;
    }

    /**
     * 권한 없음 페이지로 리다이렉트
     */
    function redirectToAccessDenied() {
        // 권한 없음 알림 후 대시보드로 이동
        alert('관리자 페이지에 접근할 권한이 없습니다.\n\n접근 가능한 역할: 시스템 관리자, 사업장 관리자, 운영 담당자');
        window.location.href = '/dashboard.html';
    }

    // 페이지 로드 시 즉시 관리자 권한 체크 실행
    // auth-check.js가 먼저 실행되어 로그인 여부는 이미 확인됨
    if (!checkAdminAccess()) {
        // 접근 권한 없음 - 페이지 숨기고 리다이렉트
        document.documentElement.style.display = 'none';
        redirectToAccessDenied();
    } else {
        console.log('[AdminAuthCheck] 관리자 권한 확인됨 - 페이지 접근 허용');
    }

    // 전역 함수로 내보내기
    window.AdminAuthCheck = {
        checkAdminAccess: checkAdminAccess,
        getUserRole: getUserRole,
        ADMIN_ALLOWED_ROLES: ADMIN_ALLOWED_ROLES
    };
})();
