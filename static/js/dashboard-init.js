/**
 * Admin Dashboard Initialization Script
 * 관리자 대시보드 초기화 및 핵심 기능
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
 * 페이지 네비게이션 설정
 */
function setupNavigation() {
    console.log('🧭 네비게이션 설정 중...');

    document.querySelectorAll('.nav-item').forEach(navItem => {
        navItem.addEventListener('click', function(e) {
            e.preventDefault();

            // 활성 메뉴 변경
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            this.classList.add('active');

            // 페이지 내용 변경
            const page = this.dataset.page;
            showPage(page);
        });
    });
}

/**
 * 페이지 전환 함수
 */
function showPage(pageName) {
    console.log(`📄 페이지 전환: ${pageName}`);

    // 모든 페이지 숨기기
    document.querySelectorAll('.page-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
    });

    // 선택된 페이지 표시
    const pageContent = document.getElementById(`${pageName}-content`);
    if (pageContent) {
        pageContent.style.display = 'block';
        pageContent.classList.add('active');

        // 페이지별 초기화 함수 호출
        loadPageModule(pageName);
    }

    // URL 해시 업데이트 (브라우저 히스토리)
    window.location.hash = pageName;
}

/**
 * 페이지별 모듈 로드
 */
async function loadPageModule(pageName) {
    console.log(`🔄 모듈 로드 중: ${pageName}`);

    switch(pageName) {
        case 'users':
            // 개선된 사용자 관리 모듈 사용
            if (!window.enhancedUserMgmt) {
                const script = document.createElement('script');
                script.src = '/static/modules/users/users-enhanced.js?v=' + Date.now();
                script.onload = () => {
                    console.log('✅ Enhanced User Management 모듈 로드 완료');
                    if (window.enhancedUserMgmt) {
                        window.enhancedUserMgmt.init();
                    }
                };
                document.head.appendChild(script);
            } else {
                window.enhancedUserMgmt.init();
            }
            break;

        case 'suppliers':
            if (window.SuppliersManagementFull && typeof window.SuppliersManagementFull.init === 'function') {
                window.SuppliersManagementFull.init();
            }
            break;

        case 'business-locations':
            if (window.SitesManagement && typeof window.SitesManagement.init === 'function') {
                window.SitesManagement.init();
            }
            break;

        case 'supplier-mappings':
            loadSupplierMappings();
            break;

        case 'meal-pricing':
            loadMealPricing();
            break;

        case 'meal-plan-advanced':
            loadMealPlanAdvanced();
            break;

        case 'ingredients':
            loadIngredients();
            break;

        case 'menu-recipes':
            loadMenuRecipes();
            break;

        case 'meal-plans':
            loadMealPlans();
            break;

        case 'dashboard':
        default:
            loadDashboardStats();
            break;
    }
}

/**
 * 최근 활동 로그 로드
 */
async function loadActivityLogs() {
    console.log('📝 최근 활동 로그 로딩...');

    try {
        const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.location.origin;
        const response = await fetch(`${API_BASE_URL}/api/admin/activity-logs?limit=15`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const activityList = document.getElementById('activity-list');

        if (!activityList) return;

        if (data.logs && data.logs.length > 0) {
            activityList.innerHTML = data.logs.map(log => {
                const time = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // 아이콘 선택
                let icon = '📝';
                if (log.action_type.includes('추가')) icon = '➕';
                else if (log.action_type.includes('수정')) icon = '✏️';
                else if (log.action_type.includes('삭제')) icon = '🗑️';
                else if (log.action_type.includes('로그인')) icon = '🔐';

                return `
                    <div class="log-item">
                        <div class="log-time">${time}</div>
                        <div class="log-message">
                            <span style="margin-right: 5px;">${icon}</span>
                            <strong>${log.user}</strong> - ${log.action_detail}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            activityList.innerHTML = `
                <div class="log-item">
                    <div class="log-message" style="color: #999; text-align: center;">
                        아직 기록된 활동이 없습니다.
                    </div>
                </div>
            `;
        }

        console.log('✅ 최근 활동 로그 로드 완료');
    } catch (error) {
        console.error('❌ 최근 활동 로그 로드 실패:', error);
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            activityList.innerHTML = `
                <div class="log-item">
                    <div class="log-message" style="color: #dc3545;">
                        활동 로그를 불러올 수 없습니다.
                    </div>
                </div>
            `;
        }
    }
}

// 정기적으로 활동 로그 새로고침 (30초마다)
let activityRefreshInterval = null;

function startActivityRefresh() {
    if (activityRefreshInterval) {
        clearInterval(activityRefreshInterval);
    }

    activityRefreshInterval = setInterval(() => {
        if (document.getElementById('dashboard-content').style.display !== 'none') {
            loadActivityLogs();
        }
    }, 30000); // 30초마다 새로고침
}

/**
 * 대시보드 통계 로드
 */
async function loadDashboardStats() {
    console.log('📊 대시보드 통계 로딩...');

    try {
        const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.location.origin;
        const response = await fetch(`${API_BASE_URL}/api/admin/dashboard-stats`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // 통계 업데이트
        updateDashboardCard('total-users', data.totalUsers || 0);
        updateDashboardCard('total-suppliers', data.totalSuppliers || 0);
        updateDashboardCard('total-ingredients', data.totalIngredients || 0);
        updateDashboardCard('active-sites', data.activeSites || 0);

        console.log('✅ 대시보드 통계 로드 완료');

        // 최근 활동 로그 로드
        await loadActivityLogs();
    } catch (error) {
        console.error('❌ 대시보드 통계 로드 실패:', error);
    }
}

/**
 * 대시보드 카드 업데이트
 */
function updateDashboardCard(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value.toLocaleString('ko-KR');
    }
}

/**
 * 협력업체 매핑 로드
 */
async function loadSupplierMappings() {
    console.log('🔗 협력업체 매핑 로딩...');
    const content = document.getElementById('supplier-mappings-content');
    if (content) {
        content.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</div>';

        // supplier-mapping.js 모듈 로드
        try {
            // 이미 로드된 경우 정리
            if (window.supplierMapping) {
                if (typeof window.supplierMapping.destroy === 'function') {
                    window.supplierMapping.destroy();
                }
                window.supplierMapping = null;
            }

            // 스크립트 동적 로드 (캐시 무효화 포함)
            const script = document.createElement('script');
            script.src = '/static/modules/mappings/supplier-mapping.js?v=' + Date.now();
            script.onload = async () => {
                console.log('✅ supplier-mapping.js 로드 완료 (캐시 무효화)');

                // 모듈 초기화
                if (window.SupplierMappingModule) {
                    window.supplierMapping = new window.SupplierMappingModule();
                    await window.supplierMapping.init();
                    console.log('✅ 협력업체 매핑 모듈 초기화 완료');
                }
            };
            script.onerror = (error) => {
                console.error('❌ supplier-mapping.js 로드 실패:', error);
                content.innerHTML = '<div class="error-message">모듈 로드 실패</div>';
            };
            document.head.appendChild(script);
        } catch (error) {
            console.error('❌ 협력업체 매핑 로드 실패:', error);
            content.innerHTML = '<div class="error-message">오류가 발생했습니다</div>';
        }
    }
}

/**
 * 식단가 관리 로드
 */
function loadMealPricing() {
    console.log('💰 식단가 관리 로딩...');
    const content = document.getElementById('meal-pricing-content');
    if (content) {
        content.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</div>';
        // 실제 모듈 로드 로직
    }
}

/**
 * 식단관리 Ⅱ (고급 식단 관리) 로드
 */
function loadMealPlanAdvanced() {
    console.log('📅 식단관리 Ⅱ 로딩...');
    const content = document.getElementById('meal-plan-advanced-content');
    if (content) {
        // iframe이 이미 있으므로 추가 로딩 작업은 필요 없음
        console.log('✅ 식단관리 Ⅱ 준비 완료');
    }
}

/**
 * 식자재 관리 로드
 */
async function loadIngredients() {
    console.log('🥕 식자재 관리 로딩...');
    const content = document.getElementById('ingredients-content');
    if (!content) return;

    try {
        content.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> 템플릿 로딩 중...</div>';

        // 템플릿 로드 (캐시 방지를 위해 타임스탬프 추가)
        const timestamp = new Date().getTime();
        const templateResponse = await fetch(`/static/templates/ingredients-section.html?v=${timestamp}`);
        if (!templateResponse.ok) {
            throw new Error(`템플릿 로드 실패: ${templateResponse.status}`);
        }

        const templateHtml = await templateResponse.text();
        content.innerHTML = templateHtml;

        console.log(`✅ 식자재 템플릿 로드 완료 (v=${timestamp})`);

        // Excel 모듈 로드 - 중복 로딩 방지를 위해 주석 처리
        // dashboard-init-complete.js에서 ingredients.js를 로드하므로 여기서는 로드하지 않음
        console.log('✅ 식자재 모듈은 dashboard-init-complete.js에서 로드됩니다.');

    } catch (error) {
        console.error('❌ 식자재 로딩 오류:', error);
        content.innerHTML = `<div class="error-message">⚠️ 식자재 모듈 로드 실패: ${error.message}</div>`;
    }
}

/**
 * 모듈 상태 확인
 */
function checkModuleStatus() {
    const modules = {
        'CONFIG': window.CONFIG,
        'userManagement': window.userManagement,
        'SuppliersManagementFull': window.SuppliersManagementFull,
        'SitesManagement': window.SitesManagement
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

/**
 * DOM Ready 시 초기화
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        await initializePage();
        setupNavigation();

        // URL 해시에 따라 초기 페이지 설정
        const hash = window.location.hash.slice(1);
        if (hash) {
            showPage(hash);
        } else {
            showPage('dashboard');
        }

        // 활동 로그 자동 새로고침 시작
        startActivityRefresh();
    });
} else {
    // 이미 로드된 경우 바로 실행
    initializePage().then(() => {
        setupNavigation();
        const hash = window.location.hash.slice(1);
        showPage(hash || 'dashboard');
    });
}

/**
 * 메뉴/레시피 관리 모듈 로드
 */
async function loadMenuRecipes() {
    console.log('🍽️ 메뉴/레시피 관리 모듈 로딩...');

    const container = document.getElementById('menu-recipes-content');
    if (!container) return;

    try {
        // CSS 로드
        if (!document.querySelector('link[href*="menu-recipes.css"]')) {
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = '/static/modules/menu-recipes/menu-recipes.css?v=' + Date.now();
            document.head.appendChild(cssLink);
        }

        // JS 모듈 로드
        if (!window.menuRecipesManager) {
            const script = document.createElement('script');
            script.src = '/static/modules/menu-recipes/menu-recipes.js?v=' + Date.now();
            script.onload = () => {
                console.log('✅ 메뉴/레시피 관리 모듈 로드 완료');
            };
            script.onerror = () => {
                console.error('❌ 메뉴/레시피 관리 모듈 로드 실패');
                container.innerHTML = '<div class="error-message">메뉴/레시피 관리 모듈을 로드할 수 없습니다.</div>';
            };
            document.head.appendChild(script);
        }
    } catch (error) {
        console.error('메뉴/레시피 관리 모듈 로드 오류:', error);
        container.innerHTML = '<div class="error-message">메뉴/레시피 관리 모듈 로드 중 오류가 발생했습니다.</div>';
    }
}

/**
 * 식단 관리 모듈 로드
 */
async function loadMealPlans() {
    console.log('📅 식단 관리 모듈 로딩...');

    const container = document.getElementById('meal-plans-content');
    if (!container) return;

    try {
        // CSS 로드
        if (!document.querySelector('link[href*="meal-plans.css"]')) {
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = '/static/modules/meal-plans/meal-plans.css?v=' + Date.now();
            document.head.appendChild(cssLink);
        }

        // FontAwesome 아이콘 로드 (필요시)
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const fontAwesome = document.createElement('link');
            fontAwesome.rel = 'stylesheet';
            fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
            document.head.appendChild(fontAwesome);
        }

        // JS 모듈 로드
        if (!window.mealPlansManager) {
            const script = document.createElement('script');
            script.src = '/static/modules/meal-plans/meal-plans.js?v=' + Date.now();
            script.onload = () => {
                console.log('✅ 식단 관리 모듈 로드 완료');
            };
            script.onerror = () => {
                console.error('❌ 식단 관리 모듈 로드 실패');
                container.innerHTML = `
                    <div class="error-message" style="padding: 40px; text-align: center; background: #f8d7da; color: #721c24; border-radius: 8px; margin: 20px;">
                        <h3>식단 관리 모듈 로드 실패</h3>
                        <p>식단 관리 시스템을 로드할 수 없습니다.</p>
                        <button onclick="loadMealPlans()" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            다시 시도
                        </button>
                    </div>
                `;
            };
            document.head.appendChild(script);
        } else {
            // 이미 로드된 경우 재초기화
            if (window.mealPlansManager && typeof window.mealPlansManager.init === 'function') {
                window.mealPlansManager.init();
            }
        }
    } catch (error) {
        console.error('식단 관리 모듈 로드 오류:', error);
        container.innerHTML = `
            <div class="error-message" style="padding: 40px; text-align: center; background: #f8d7da; color: #721c24; border-radius: 8px; margin: 20px;">
                <h3>시스템 오류</h3>
                <p>식단 관리 모듈 로드 중 예상치 못한 오류가 발생했습니다.</p>
                <details style="margin-top: 15px; text-align: left;">
                    <summary>오류 상세 정보</summary>
                    <pre style="background: #fff; padding: 10px; margin-top: 10px; border-radius: 4px;">${error.toString()}</pre>
                </details>
            </div>
        `;
    }
}