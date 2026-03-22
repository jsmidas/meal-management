/**
 * Admin Dashboard 초기화 스크립트
 */

// 스크립트 동적 로드 헬퍼 함수
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// 개선된 ModuleLoader 기반 초기화 (안전성 + 단순성)
async function initializePage() {
    console.log('🚀 [Admin Dashboard] 개선된 초기화 시작');

    try {
        // Phase 1: 필수 모듈 순차 로드
        console.log('📦 [Admin Dashboard] 필수 모듈 로드 중...');

        // config.js 먼저 로드
        if (!window.CONFIG) {
            console.log('🔧 config.js 로딩...');
            await loadScript('config.js');

            let attempts = 0;
            while (!window.CONFIG && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (!window.CONFIG) {
                throw new Error('config.js 로드 실패');
            }
            console.log('✅ CONFIG 로드 완료');
        }

        // ModuleLoader는 선택사항 - 직접 모듈 로딩으로 대체
        console.log('🔄 간소화된 모드로 작동 - ModuleLoader 생략');
        window.moduleLoader = null;

        // Phase 2: 날짜 표시 등 기본 UI
        const currentDateElement = document.getElementById('current-date');
        if (currentDateElement) {
            currentDateElement.textContent = new Date().toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short'
            });
        }

        console.log('✅ [Admin Dashboard] 개선된 초기화 완료');

    } catch (error) {
        console.error('❌ [Admin Dashboard] 초기화 실패:', error);
        showInitializationError(error);
    }
}

/**
 * 초기화 실패 시 에러 표시
 */
function showInitializationError(error) {
    const contentArea = document.getElementById('content-area');
    if (contentArea) {
        contentArea.innerHTML = `
            <div style="padding: 40px; text-align: center; background: #fff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h2 style="color: #ff6b6b;">⚠️ 시스템 초기화 실패</h2>
                <p style="color: #666; margin: 20px 0;">관리자 시스템을 시작할 수 없습니다.</p>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; font-family: monospace; font-size: 12px; color: #333; text-align: left;">
                    ${error.message || error.toString()}
                </div>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;">
                    🔄 페이지 새로고침
                </button>
                <button onclick="checkModuleStatus()" style="padding: 12px 24px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    🔍 모듈 상태 확인
                </button>
            </div>
        `;
    }
}

/**
 * 안전한 로그아웃 (의존성 확인 후 실행)
 */
async function logout() {
    if (confirm('로그아웃하시겠습니까?')) {
        try {
            // localStorage에서 인증 관련 데이터 삭제
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            localStorage.removeItem('userRole');
            localStorage.removeItem('username');
            sessionStorage.clear();
            console.log('🔑 [Logout] 인증 데이터 삭제 완료');

            // 캐시 정리
            if (window.AdminCache) {
                AdminCache.clearAllCache();
                console.log('🗑️ [Logout] 캐시 정리 완료');
            }

            // 대시보드 정리
            if (window.dashboard && typeof window.dashboard.destroy === 'function') {
                window.dashboard.destroy();
                console.log('🧹 [Logout] 대시보드 정리 완료');
            }

            // 서버에 로그아웃 요청
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });

            // 로그인 페이지로 이동
            console.log('🚪 [Logout] 로그인 페이지로 이동');
            window.location.href = '/login.html';

        } catch (error) {
            console.error('❌ [Logout] 로그아웃 중 오류:', error);
            // 오류가 있어도 로그아웃 진행
            window.location.href = '/login.html';
        }
    }
}

/**
 * 모듈 상태 확인
 */
function checkModuleStatus() {
    const modules = {
        'CONFIG': window.CONFIG,
        'AdminCache': window.AdminCache,
        'dashboard': window.dashboard,
        'moduleLoader': window.moduleLoader
    };
    console.table(modules);
    return modules;
}

/**
 * 개발자용 디버그 함수들 (콘솔에서 사용)
 */
window.debugInfo = {
    modules: checkModuleStatus,
    cache: () => window.AdminCache ? AdminCache.getCacheStatus() : 'AdminCache not loaded',
    dashboard: () => window.dashboard || 'Dashboard not initialized',
    reload: () => location.reload(),
    clearCache: () => window.AdminCache ? AdminCache.clearAllCache() : 'AdminCache not available'
};

console.log('🔧 [Admin Dashboard] 디버그 함수 사용법:');
console.log('  debugInfo.modules()  - 모듈 상태 확인');
console.log('  debugInfo.cache()    - 캐시 상태 확인');
console.log('  debugInfo.dashboard() - 대시보드 상태 확인');
console.log('  debugInfo.clearCache() - 캐시 초기화');
console.log('  debugInfo.reload()   - 페이지 새로고침');