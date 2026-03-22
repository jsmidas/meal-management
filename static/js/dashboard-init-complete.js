/**
 * Admin Dashboard 초기화 스크립트
 * admin_dashboard.html의 인라인 JavaScript에서 분리
 */

// CONFIG 설정 (config.js와 호환 구조)
// CONFIG 설정 (admin_dashboard.html에서 이미 설정되므로 중복 방지)
window.CONFIG = window.CONFIG || {
    API_URL: '',  // 상대 경로 사용 (localhost에서 작동)
    ENVIRONMENT: 'development',
    API: {
        BASE_URL: '',  // 상대 경로 사용
        TIMEOUT: 30000
    }
};

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

// 페이지 네비게이션 설정
function setupNavigation() {
    console.log('🧭 네비게이션 설정 중...');

    document.querySelectorAll('.nav-item').forEach(navItem => {
        navItem.addEventListener('click', function(e) {
            e.preventDefault();
            const targetPage = this.getAttribute('data-page');
            switchToPage(targetPage);
        });
    });

    // 기본으로 대시보드 활성화
    switchToPage('dashboard');

    // 초기 대시보드 통계 로드
    console.log('DEBUG: window.CONFIG =', window.CONFIG);
    console.log('DEBUG: window.CONFIG.API =', window.CONFIG?.API);

    // 안전한 API_URL 접근 (상대 경로 사용)
    const baseUrl = window.CONFIG?.API?.BASE_URL || window.CONFIG?.API_BASE_URL || '';
    console.log('DEBUG: BASE_URL =', baseUrl);
    const apiUrl = `${baseUrl}/api/admin/dashboard-stats`;
    console.log('DEBUG: Final API URL =', apiUrl);
    fetch(apiUrl)
        .then(res => {
            console.log('Dashboard stats response status:', res.status);
            return res.json();
        })
        .then(data => {
            console.log('Dashboard stats data:', data);
            if (data.success) {
                const els = {
                    'total-users': data.data?.total_users || data.totalUsers || 0,
                    'total-sites': data.data?.total_sites || data.totalSites || 0,
                    'total-ingredients': (data.data?.total_ingredients || data.totalIngredients || 0).toLocaleString(),
                    'total-suppliers': data.data?.total_suppliers || data.totalSuppliers || 0,
                    'total-recipes': (data.data?.total_recipes || data.totalRecipes || 0).toLocaleString()
                };
                for (const [id, value] of Object.entries(els)) {
                    const el = document.getElementById(id);
                    if (el) {
                        el.textContent = value;
                        console.log(`Updated ${id} to ${value}`);
                    } else {
                        console.warn(`Element with ID ${id} not found`);
                    }
                }
            } else {
                console.error('Invalid dashboard stats response:', data);
                // 오류 시 기본값 설정
                const defaultEls = {
                    'total-users': '오류',
                    'total-sites': '오류',
                    'total-ingredients': '오류',
                    'total-suppliers': '오류'
                };
                for (const [id, value] of Object.entries(defaultEls)) {
                    const el = document.getElementById(id);
                    if (el) el.textContent = value;
                }
            }
        })
        .catch(err => {
            console.error('초기 대시보드 통계 로드 실패:', err);
            // 네트워크 오류 시 오류 표시
            const errorEls = {
                'total-users': '오류',
                'total-sites': '오류',
                'total-ingredients': '오류',
                'total-suppliers': '오류'
            };
            for (const [id, value] of Object.entries(errorEls)) {
                const el = document.getElementById(id);
                if (el) el.textContent = value;
            }
        });
}

async function switchToPage(pageName) {
    console.log(`🔄 페이지 전환: ${pageName}`);

    // 네비게이션 상태 업데이트
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const activeNavItem = document.querySelector(`[data-page="${pageName}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }

    // 모든 페이지 콘텐츠 숨기기 - display 직접 제어
    document.querySelectorAll('.page-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });

    // 선택된 페이지만 표시 - display 직접 제어
    const targetContent = document.getElementById(`${pageName}-content`);
    if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'block';
        console.log(`✅ ${pageName} 콘텐츠 표시 완료`);

        // 모듈 초기화
        await initializePageModule(pageName);
    } else {
        console.error(`❌ ${pageName}-content 요소를 찾을 수 없음`);
    }
}

// 페이지별 모듈 초기화
async function initializePageModule(pageName) {
    // 대시보드는 모듈 초기화 불필요
    if (pageName === 'dashboard') {
        console.log('📊 대시보드 - 모듈 초기화 불필요');
        // 대시보드 통계 로드 (window.loadDashboardStats가 있으면 사용, 없으면 직접 호출)
        if (window.loadDashboardStats) {
            window.loadDashboardStats();
        } else {
            // 🏢 사업장 필터링 지원
            const siteId = typeof getCurrentSiteId === 'function' ? getCurrentSiteId() : null;
            const siteParam = siteId ? `?site_id=${siteId}` : '';

            fetch(`${window.CONFIG?.API?.BASE_URL || window.CONFIG?.API_BASE_URL || ''}/api/admin/dashboard-stats${siteParam}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        const els = {
                            'total-users': data.totalUsers || data.data?.total_users,
                            'total-sites': data.totalSites || data.data?.total_sites,
                            'total-ingredients': (data.totalIngredients || data.data?.total_ingredients || 0).toLocaleString(),
                            'total-suppliers': data.totalSuppliers || data.data?.total_suppliers
                        };
                        for (const [id, value] of Object.entries(els)) {
                            const el = document.getElementById(id);
                            if (el) el.textContent = value;
                        }
                    }
                })
                .catch(err => console.error('대시보드 통계 로드 실패:', err));
        }

        // 최근 활동 로그 로드
        loadActivityLogs();
        startActivityRefresh();
        return;
    }

    const fallbackInitialization = {
        'users': async () => {
            // Enhanced User Management 모듈 사용
            if (window.enhancedUserMgmt) {
                console.log('✅ Enhanced User Management 모듈 사용');
                return window.enhancedUserMgmt.init();
            }

            // Enhanced 모듈이 없으면 로드
            if (!window.enhancedUserMgmt) {
                await loadScript('/static/modules/users/users-enhanced.js');
                await new Promise(resolve => setTimeout(resolve, 100));
                if (window.enhancedUserMgmt) {
                    return window.enhancedUserMgmt.init();
                }
            }

            // 폴백: 기존 모듈 사용
            console.log('⚠️ Enhanced 모듈 로드 실패, 기존 모듈 사용');
            if (!window.UsersManagementFull) {
                await loadScript('/static/modules/users/users-management-full.js');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return window.UsersManagementFull?.init?.();
        },
        'suppliers': async () => {
            // 템플릿 로드
            const suppliersContent = document.getElementById('suppliers-content');
            if (suppliersContent && suppliersContent.innerHTML.trim().length < 100) {
                try {
                    // HTTP 환경에서는 파일 로드
                    if (window.location.protocol.startsWith('http')) {
                        const timestamp = new Date().getTime();
                        const response = await fetch(`static/templates/suppliers-section.html?v=${timestamp}`);
                        if (response.ok) {
                            const html = await response.text();
                            suppliersContent.innerHTML = html;
                            console.log(`✅ suppliers-section.html 템플릿 로드 완료 (v=${timestamp})`);
                        } else {
                            console.warn('⚠️ suppliers-section.html 로드 실패');
                        }
                    }
                } catch (error) {
                    console.error('❌ suppliers 템플릿 로드 오류:', error);
                }
            }

            // 모듈 초기화
            if (!window.SupplierManagement) {
                await loadScript('/static/modules/suppliers/suppliers.js');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return window.SupplierManagement?.init?.();
        },
        'business-locations': async () => {
            // 템플릿 로드
            const sitesContent = document.getElementById('business-locations-content');
            if (sitesContent && sitesContent.innerHTML.trim().length < 100) {
                try {
                    // HTTP 환경에서는 파일 로드
                    if (window.location.protocol.startsWith('http')) {
                        const timestamp = new Date().getTime();
                        const response = await fetch(`static/templates/sites-section.html?v=${timestamp}`);
                        if (response.ok) {
                            const html = await response.text();
                            sitesContent.innerHTML = html;
                            console.log(`✅ 사업장 템플릿 로드 완료 (v=${timestamp})`);
                        }
                    } else {
                        // file:// 프로토콜에서는 폴백 HTML
                        sitesContent.innerHTML = '<div class="page-header"><h2>사업장 관리</h2><p>file:// 프로토콜에서는 제한적 기능만 지원됩니다.</p></div>';
                        console.log('✅ 사업장 템플릿 폴백 삽입');
                    }
                } catch (err) {
                    console.error('❌ 사업장 템플릿 로드 실패:', err);
                }
            }

            // 모듈 초기화
            if (!window.BusinessLocationsModule) {
                const timestamp = new Date().getTime();
                await loadScript(`/static/modules/sites/sites.js?v=${timestamp}`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return window.BusinessLocationsModule?.init?.();
        },
        'meal-pricing': async () => {
            console.log('🎯 meal-pricing 모듈 초기화 시작');

            // 템플릿 로드
            const pricingContent = document.getElementById('meal-pricing-content');
            if (pricingContent && pricingContent.innerHTML.trim().length < 100) {
                try {
                    // HTTP 환경에서는 파일 로드
                    if (window.location.protocol.startsWith('http')) {
                        const timestamp = new Date().getTime();
                        const response = await fetch(`static/templates/meal-pricing-section.html?v=${timestamp}`);
                        if (response.ok) {
                            const html = await response.text();
                            pricingContent.innerHTML = html;
                            console.log(`✅ 식단가 템플릿 파일 로드 완료 (v=${timestamp})`);
                        }
                    } else {
                        // file:// 프로토콜에서는 직접 HTML 삽입 (폴백)
                        pricingContent.innerHTML = `<div class="page-header">
                            <h2>식단가 관리</h2>
                            <p class="page-description">사업장별 세부식단표를 관리하고 끼니별 판매가, 목표식재료비를 설정합니다.</p>
                        </div>`;
                        console.log('✅ 식단가 템플릿 폴백 삽입');
                    }
                } catch (err) {
                    console.error('❌ 식단가 템플릿 로드 실패:', err);
                }
            }

            // Meal Pricing 모듈 로드 (운영타입/계획명 직접 수정 버전)
            const timestamp = new Date().getTime();
            await loadScript(`static/modules/meal-pricing/meal-pricing.js?v=${timestamp}`);
            await new Promise(resolve => setTimeout(resolve, 100));

            if (window.MealPricingModule) {
                console.log('🚀 MealPricingModule.init 호출');
                await window.MealPricingModule.init();
                // 사업장 선택 이벤트 추가
                const select = document.getElementById('businessLocationSelect');
                if (select) {
                    select.addEventListener('change', window.loadMealPlansForLocation);
                }
            } else {
                console.error('❌ MealPricingModule을 찾을 수 없음');
            }
        },
        'ingredients': async () => {
            console.log('🥬 식자재 관리 모듈 초기화 시작');

            // 템플릿 로드 (캐시 무효화)
            const ingredientsContent = document.getElementById('ingredients-content');
            if (ingredientsContent && ingredientsContent.innerHTML.trim().length < 100) {
                try {
                    if (window.location.protocol.startsWith('http')) {
                        const timestamp = new Date().getTime();
                        const response = await fetch(`static/templates/ingredients-section.html?v=${timestamp}`);
                        if (response.ok) {
                            const html = await response.text();
                            ingredientsContent.innerHTML = html;
                            console.log('✅ 식자재 템플릿 로드 완료 (v=' + timestamp + ')');

                            // 템플릿 로드 후 대기 (DOM 렌더링 완료 보장)
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }
                    }
                } catch (err) {
                    console.error('❌ 식자재 템플릿 로드 실패:', err);
                }
            }

            // 모듈 로드 (캐시 버스팅 - 강력)
            // 항상 새로 로드 (개발 중)
            const timestamp = Date.now();
            console.log('🔄 JavaScript 로드 시도:', timestamp);
            await loadScript('/static/modules/ingredients/ingredients.js?v=' + timestamp);
            await new Promise(resolve => setTimeout(resolve, 100));

            // 모듈 초기화
            if (window.IngredientsModule) {
                console.log('🚀 IngredientsModule.init 호출');

                // DOM 요소 존재 확인
                const tbody = document.getElementById('ingredients-table-body');
                console.log('📊 테이블 바디 존재:', !!tbody);

                await window.IngredientsModule.init();

                // 이벤트 리스너 및 업로드 기능 초기화
                if (window.initializeIngredientsPage) {
                    console.log('🎯 initializeIngredientsPage 호출 - 이벤트 리스너 설정');
                    window.initializeIngredientsPage();
                } else {
                    console.warn('⚠️ initializeIngredientsPage 함수를 찾을 수 없음');
                }

                // 식자재 업로드용 협력업체 드롭다운 로드
                await loadUploadSupplierDropdown();

                return;
            } else {
                console.error('❌ IngredientsModule을 찾을 수 없음');
            }
        },
        'supplier-mapping': async () => {
            // 개선된 매핑 모듈 사용
            if (!window.initEnhancedMapping) {
                await loadScript('/static/modules/mappings/enhanced-mapping.js');
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // 개선된 매핑 초기화
            if (window.initEnhancedMapping) {
                await window.initEnhancedMapping();
            }
        },
        'menu-recipes': async () => {
            console.log('🍽️ 메뉴/레시피 관리 모듈 초기화 시작');

            // admin_dashboard.html에 정의된 loadMenuRecipes 함수 호출
            if (typeof window.loadMenuRecipes === 'function') {
                console.log('🚀 window.loadMenuRecipes() 호출');
                await window.loadMenuRecipes();
                console.log('✅ 메뉴/레시피 데이터 로드 완료');
            } else {
                console.error('❌ window.loadMenuRecipes 함수를 찾을 수 없음');
            }
        },
        'site-structure': async () => {
            console.log('🗂️ 구조 관리 모듈 초기화 시작');

            // 전역 함수 호출
            if (typeof window.initSiteStructureIfNeeded === 'function') {
                window.initSiteStructureIfNeeded();
            } else if (window.SiteStructureManager) {
                window.SiteStructureManager.init('site-structure-container');
            } else {
                console.warn('⚠️ SiteStructureManager를 찾을 수 없습니다.');
            }
        },
        'user-permissions': async () => {
            console.log('🔐 사용자 권한 관리 모듈 초기화 시작');

            // 전역 함수 호출
            if (typeof window.initUserPermissionIfNeeded === 'function') {
                window.initUserPermissionIfNeeded();
            } else if (window.UserPermissionManager) {
                window.UserPermissionManager.init('user-permission-container');
            } else {
                console.warn('⚠️ UserPermissionManager를 찾을 수 없습니다.');
            }
        },

        // ========== 통합 페이지들 ==========

        // 🏢 사업장 관리 통합 (사업장 목록 + 구조 관리)
        'sites-integrated': async () => {
            console.log('🏢 사업장 관리 통합 페이지 초기화');

            // 사업장 목록 탭 초기 로드
            await loadSitesListTab();

            // 구조 관리 모듈 준비
            if (window.SiteStructureManager) {
                console.log('✅ SiteStructureManager 준비됨');
            }
        },

        // 🚚 협력업체 관리 통합 (협력업체 + 매핑)
        'suppliers-integrated': async () => {
            console.log('🚚 협력업체 관리 통합 페이지 초기화');

            // 협력업체 목록 탭 초기 로드
            await loadSuppliersListTab();
        },

        // 🍽️ 운영 설정 통합 (식단가, 식자재, 메뉴/레시피)
        'operations': async () => {
            console.log('🍽️ 운영 설정 통합 페이지 초기화');

            // 식단가 관리 탭 초기 로드
            await loadMealPricingTab();
        },

        // 📝 블로그/SNS 관리
        'blog-management': async () => {
            console.log('📝 블로그/SNS 관리 페이지 초기화');
            const iframe = document.getElementById('blog-iframe');
            if (iframe) {
                const token = localStorage.getItem('auth_token') || '';
                const userInfo = (() => { try { return JSON.parse(localStorage.getItem('user_info') || '{}'); } catch(e) { return {}; } })();
                const userRole = userInfo.role || '';
                const blogAccess = (userRole === 'admin' || userInfo.permissions?.blog_access) ? 'true' : 'false';
                const blogUrl = `/blog-app/blog?auth_token=${encodeURIComponent(token)}&user_role=${encodeURIComponent(userRole)}&blog_access=${blogAccess}&embed=1`;
                if (!iframe.src || iframe.src === 'about:blank' || !iframe.src.includes('auth_token')) {
                    iframe.src = blogUrl;
                }
            }
        },

        // ⚙️ 시스템 설정 (브랜딩)
        'system-settings': async () => {
            console.log('⚙️ 시스템 설정 페이지 초기화');

            // 브랜딩 설정 로드
            const container = document.getElementById('branding-settings-container');
            if (container) {
                container.innerHTML = await getBrandingFormHTML();
                loadBranding();
                // 색상 선택기 이벤트 바인딩
                const pc = document.getElementById('primary-color');
                const sc = document.getElementById('secondary-color');
                if (pc) pc.addEventListener('input', () => { if (typeof updateColorPreview === 'function') updateColorPreview(); });
                if (sc) sc.addEventListener('input', () => { if (typeof updateColorPreview === 'function') updateColorPreview(); });
            }
        },

        // 📢 공지사항 관리
        'notice-management': async () => {
            console.log('📢 공지사항 관리 페이지 초기화');

            // admin_dashboard.html에 정의된 loadAdminNotices 함수 호출
            if (typeof window.loadAdminNotices === 'function') {
                await window.loadAdminNotices('business');
                await window.loadAdminNotices('hygiene');
                console.log('✅ 공지사항 목록 로드 완료');
            } else {
                console.warn('⚠️ loadAdminNotices 함수를 찾을 수 없습니다.');
            }
        }
    };

    // ========== 통합 페이지 탭 전환 함수들 ==========

    // 🏢 사업장 관리 탭 전환
    window.switchSiteTab = async function(tabName) {
        console.log('🏢 사업장 탭 전환:', tabName);

        // 탭 버튼 상태 업데이트
        document.querySelectorAll('#sites-integrated-content .admin-tab').forEach(btn => {
            btn.style.background = '#f1f5f9';
            btn.style.color = '#64748b';
        });
        const activeBtn = document.querySelector(`#sites-integrated-content [data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.style.background = '#3b82f6';
            activeBtn.style.color = 'white';
        }

        // 탭 컨텐츠 전환
        document.querySelectorAll('#sites-integrated-content .tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.style.display = 'block';
        }

        // 해당 탭 데이터 로드
        if (tabName === 'sites-list') {
            await loadSitesListTab();
        } else if (tabName === 'site-structure') {
            if (window.SiteStructureManager) {
                window.SiteStructureManager.init('site-structure-container');
            }
        }
    };

    // 🚚 협력업체 관리 탭 전환
    window.switchSupplierTab = async function(tabName) {
        console.log('🚚 협력업체 탭 전환:', tabName);

        // 탭 버튼 상태 업데이트
        document.querySelectorAll('#suppliers-integrated-content .admin-tab').forEach(btn => {
            btn.style.background = '#f1f5f9';
            btn.style.color = '#64748b';
        });
        const activeBtn = document.querySelector(`#suppliers-integrated-content [data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.style.background = '#3b82f6';
            activeBtn.style.color = 'white';
        }

        // 탭 컨텐츠 전환
        document.querySelectorAll('#suppliers-integrated-content .tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.style.display = 'block';
        }

        // 해당 탭 데이터 로드
        if (tabName === 'suppliers-list') {
            await loadSuppliersListTab();
        } else if (tabName === 'supplier-mapping') {
            await loadSupplierMappingTab();
        } else if (tabName === 'supplier-holidays') {
            if (typeof loadHolidayData === 'function') {
                await loadHolidayData();
            }
        }
    };

    // 🍽️ 운영 설정 탭 전환
    window.switchOperationsTab = async function(tabName) {
        console.log('🍽️ 운영 설정 탭 전환:', tabName);

        // 탭 버튼 상태 업데이트
        document.querySelectorAll('#operations-content .admin-tab').forEach(btn => {
            btn.style.background = '#f1f5f9';
            btn.style.color = '#64748b';
        });
        const activeBtn = document.querySelector(`#operations-content [data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.style.background = '#3b82f6';
            activeBtn.style.color = 'white';
        }

        // 탭 컨텐츠 전환
        document.querySelectorAll('#operations-content .tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.style.display = 'block';
        }

        // 해당 탭 데이터 로드
        if (tabName === 'meal-pricing') {
            await loadMealPricingTab();
        } else if (tabName === 'ingredients') {
            await loadIngredientsTab();
        }
    };

    // ========== 탭별 데이터 로드 함수들 ==========

    async function loadSitesListTab() {
        const container = document.getElementById('sites-list-tab');
        if (!container || container.innerHTML.trim().length > 100) return;

        try {
            const timestamp = Date.now();
            const response = await fetch(`static/templates/sites-section.html?v=${timestamp}`);
            if (response.ok) {
                container.innerHTML = await response.text();
                console.log('✅ 사업장 목록 템플릿 로드 완료');

                // 모듈 초기화
                if (!window.BusinessLocationsModule) {
                    const ts = new Date().getTime();
                    await loadScript(`/static/modules/sites/sites.js?v=${ts}`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (window.BusinessLocationsModule?.init) {
                    await window.BusinessLocationsModule.init();
                }
            }
        } catch (err) {
            console.error('❌ 사업장 목록 로드 실패:', err);
        }
    }

    async function loadSuppliersListTab() {
        const container = document.getElementById('suppliers-list-tab');
        if (!container || container.innerHTML.trim().length > 100) return;

        try {
            const timestamp = Date.now();
            const response = await fetch(`static/templates/suppliers-section.html?v=${timestamp}`);
            if (response.ok) {
                container.innerHTML = await response.text();
                console.log('✅ 협력업체 목록 템플릿 로드 완료');

                // suppliers-management-full.js 모듈 로드 (템플릿에서 SuppliersManagementFull 사용)
                if (!window.SuppliersManagementFull) {
                    await loadScript(`/static/modules/suppliers/suppliers-management-full.js?v=${timestamp}`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (window.SuppliersManagementFull?.init) {
                    await window.SuppliersManagementFull.init();
                }

                // 기존 SupplierManagement도 로드 (showBlackoutModal 등 호환성)
                if (!window.SupplierManagement) {
                    await loadScript('/static/modules/suppliers/suppliers.js');
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        } catch (err) {
            console.error('❌ 협력업체 목록 로드 실패:', err);
        }
    }

    async function loadSupplierMappingTab() {
        const container = document.getElementById('supplier-mapping-tab');
        if (!container || container.innerHTML.trim().length > 100) return;

        container.innerHTML = `
            <div style="padding: 20px; background: white; border-radius: 8px;">
                <h3 style="margin-bottom: 15px;">🔗 식자재 매핑 관리</h3>
                <p style="color: #666;">협력업체별 식자재 매핑 기능입니다.</p>
                <div id="supplier-mapping-container"></div>
            </div>
        `;
        console.log('✅ 협력업체 매핑 탭 로드 완료');
    }

    async function loadMealPricingTab() {
        const container = document.getElementById('meal-pricing-tab');
        if (!container || container.innerHTML.trim().length > 100) return;

        try {
            const timestamp = Date.now();
            const response = await fetch(`static/templates/meal-pricing-section.html?v=${timestamp}`);
            if (response.ok) {
                container.innerHTML = await response.text();
                console.log('✅ 식단가 관리 템플릿 로드 완료');

                // 모듈 초기화
                await loadScript(`static/modules/meal-pricing/meal-pricing.js?v=${timestamp}`);
                await new Promise(resolve => setTimeout(resolve, 100));

                if (window.MealPricingModule?.init) {
                    await window.MealPricingModule.init();
                }
            }
        } catch (err) {
            console.error('❌ 식단가 관리 로드 실패:', err);
        }
    }

    async function loadIngredientsTab() {
        const container = document.getElementById('ingredients-tab');
        if (!container) return;

        // 템플릿이 아직 로드되지 않은 경우에만 로드
        const needsLoad = container.innerHTML.trim().length <= 100;

        try {
            if (needsLoad) {
                const timestamp = Date.now();
                const response = await fetch(`static/templates/ingredients-section.html?v=${timestamp}`);
                if (response.ok) {
                    container.innerHTML = await response.text();
                    console.log('✅ 식자재 관리 템플릿 로드 완료');

                    await loadScript(`/static/modules/ingredients/ingredients.js?v=${timestamp}`);
                    await new Promise(resolve => setTimeout(resolve, 100));

                    if (window.AdminIngredientsModule?.init) {
                        await window.AdminIngredientsModule.init();
                    }

                    // 식자재 업로드용 협력업체 드롭다운 로드
                    await loadUploadSupplierDropdown();
                }
            }

            // 드래그 앤 드롭 이벤트 바인딩 (매번 확인 - 이벤트 중복 방지)
            const uploadArea = document.getElementById('excel-upload-area');
            if (uploadArea && !uploadArea.dataset.dragBound) {
                uploadArea.dataset.dragBound = 'true'; // 중복 바인딩 방지

                uploadArea.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.classList.add('dragover');
                    console.log('📁 드래그 오버');
                });
                uploadArea.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    this.classList.remove('dragover');
                });
                uploadArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.classList.remove('dragover');
                    console.log('📁 파일 드롭 이벤트 발생');

                    const files = e.dataTransfer?.files;
                    if (!files || files.length === 0) {
                        console.log('⚠️ 드롭된 파일 없음');
                        return;
                    }

                    const file = files[0];
                    console.log('📁 드롭된 파일:', file.name);

                    const isExcel = file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
                    if (!isExcel) {
                        alert('❌ Excel 파일(.xls, .xlsx)만 업로드 가능합니다.');
                        return;
                    }

                    // 파일 input에 파일 설정
                    const fileInput = document.getElementById('excel-file-input');
                    if (fileInput) {
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInput.files = dataTransfer.files;

                        // IngredientsModule의 uploadedFiles 배열에도 추가
                        if (window.IngredientsModule && window.IngredientsModule.setUploadedFiles) {
                            window.IngredientsModule.setUploadedFiles([file]);
                            console.log('✅ IngredientsModule.uploadedFiles 설정 완료');
                        }

                        // 파일 정보 표시
                        const fileInfo = document.getElementById('file-info');
                        const fileName = document.getElementById('file-name');
                        const fileSize = document.getElementById('file-size');
                        if (fileInfo && fileName && fileSize) {
                            fileName.textContent = file.name;
                            fileSize.textContent = (file.size / 1024).toFixed(1) + ' KB';
                            fileInfo.style.display = 'block';
                        }
                        console.log('✅ 파일 드롭 완료:', file.name);
                    }
                });

                // 클릭 이벤트 (파일 선택 대화상자 열기)
                uploadArea.addEventListener('click', function(e) {
                    // input 요소 클릭이면 무시 (무한 루프 방지)
                    if (e.target.tagName === 'INPUT') return;
                    const fileInput = document.getElementById('excel-file-input');
                    if (fileInput) fileInput.click();
                });

                console.log('✅ 업로드 영역 이벤트 바인딩 완료 (드래그 앤 드롭 + 클릭)');
            }

            // 공급불가 품목 업로드 영역 드래그 앤 드롭 이벤트
            const supplyUploadArea = document.getElementById('supply-unavailable-upload-area');
            if (supplyUploadArea && !supplyUploadArea.dataset.dragBound) {
                supplyUploadArea.dataset.dragBound = 'true';

                supplyUploadArea.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.style.borderColor = '#ff9800';
                    this.style.background = '#fff3e0';
                });
                supplyUploadArea.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    this.style.borderColor = '#ddd';
                    this.style.background = 'transparent';
                });
                supplyUploadArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.style.borderColor = '#ddd';
                    this.style.background = 'transparent';

                    const files = e.dataTransfer?.files;
                    if (!files || files.length === 0) return;

                    const file = files[0];
                    const isExcel = file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
                    if (!isExcel) {
                        alert('❌ Excel 파일(.xls, .xlsx)만 업로드 가능합니다.');
                        return;
                    }

                    const fileInput = document.getElementById('supply-unavailable-file-input');
                    if (fileInput) {
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInput.files = dataTransfer.files;
                        handleSupplyUnavailableFile(fileInput);
                    }
                });
                console.log('✅ 공급불가 업로드 영역 이벤트 바인딩 완료');
            }

            // 협력업체 드롭다운 로드
            loadSupplierDropdown();
        } catch (err) {
            console.error('❌ 식자재 관리 로드 실패:', err);
        }
    }

    // 공급불가 품목용 협력업체 드롭다운 로드
    async function loadSupplierDropdown() {
        const select = document.getElementById('supply-unavailable-supplier');
        if (!select || select.dataset.loaded) return;

        try {
            const response = await fetch('/api/admin/suppliers');
            const result = await response.json();

            if (result.success && result.suppliers) {
                result.suppliers.forEach(supplier => {
                    const option = document.createElement('option');
                    option.value = supplier.name;
                    option.textContent = supplier.name;
                    select.appendChild(option);
                });
                select.dataset.loaded = 'true';
                console.log('✅ 공급불가 협력업체 드롭다운 로드 완료:', result.suppliers.length + '개');
            }
        } catch (err) {
            console.error('⚠️ 협력업체 목록 로드 실패:', err);
        }
    }

    // 식자재 업로드용 협력업체 드롭다운 로드
    async function loadUploadSupplierDropdown() {
        const select = document.getElementById('upload-supplier-select');
        if (!select) {
            console.log('[업로드 협력업체 드롭다운] select 요소 없음');
            return;
        }

        // 이미 로드되었는지 확인
        if (select.options.length > 1) {
            console.log('[업로드 협력업체 드롭다운] 이미 로드됨');
            return;
        }

        try {
            const response = await fetch('/api/admin/suppliers');
            const data = await response.json();

            if (data.success && data.suppliers) {
                let count = 0;
                data.suppliers.forEach(supplier => {
                    if (supplier.is_active !== false && supplier.is_active !== 0) {  // 활성 업체만
                        const option = document.createElement('option');
                        option.value = supplier.name;
                        option.textContent = `${supplier.name} (${supplier.ingredient_count || 0}개 식자재)`;
                        select.appendChild(option);
                        count++;
                    }
                });
                console.log('✅ 업로드 협력업체 드롭다운 로드 완료:', count + '개');
            }
        } catch (error) {
            console.error('⚠️ 업로드 협력업체 드롭다운 로드 실패:', error);
        }
    }

    // ========================================
    // 공급 불가 품목 관리 함수
    // ========================================

    // 파일 선택 처리
    window.handleSupplyUnavailableFile = function(input) {
        const file = input.files[0];
        if (!file) return;

        document.getElementById('supply-unavailable-file-name').textContent = file.name;
        document.getElementById('supply-unavailable-file-info').style.display = 'block';
        document.getElementById('supply-unavailable-upload-area').style.display = 'none';
    };

    // 파일 선택 취소
    window.clearSupplyUnavailableFile = function() {
        document.getElementById('supply-unavailable-file-input').value = '';
        document.getElementById('supply-unavailable-file-info').style.display = 'none';
        document.getElementById('supply-unavailable-upload-area').style.display = 'block';
    };

    // 공급불가 품목 업로드
    window.uploadSupplyUnavailable = async function() {
        const fileInput = document.getElementById('supply-unavailable-file-input');
        const supplierSelect = document.getElementById('supply-unavailable-supplier').value.trim();
        const supplierCustom = document.getElementById('supply-unavailable-supplier-custom').value.trim();
        const reason = document.getElementById('supply-unavailable-reason').value.trim();

        // 드롭다운 선택값 우선, 없으면 직접입력값 사용
        const supplierName = supplierSelect || supplierCustom;

        if (!fileInput?.files?.length) {
            alert('❌ Excel 파일을 선택해주세요.');
            return;
        }

        if (!supplierName) {
            alert('❌ 협력업체를 선택하거나 직접 입력해주세요.');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('supplier_name', supplierName);
        if (reason) formData.append('reason', reason);

        try {
            const response = await fetch('/api/admin/upload-supply-unavailable', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                alert(`✅ 공급불가 품목 업로드 완료!\n\n등록: ${result.inserted}개\n총 행: ${result.total_rows}개\n오류: ${result.errors}개`);
                clearSupplyUnavailableFile();
                document.getElementById('supply-unavailable-supplier').value = '';
                document.getElementById('supply-unavailable-supplier-custom').value = '';
                document.getElementById('supply-unavailable-reason').value = '';
            } else {
                alert(`❌ 업로드 실패: ${result.error}`);
            }
        } catch (error) {
            alert(`❌ 업로드 중 오류: ${error.message}`);
        }
    };

    // 공급불가 품목 목록 표시
    window.showSupplyUnavailableList = async function() {
        try {
            const response = await fetch('/api/admin/supply-unavailable?per_page=100');
            const result = await response.json();

            if (!result.success) {
                alert('❌ 목록 조회 실패: ' + result.error);
                return;
            }

            // 요약 정보 표시
            const summaryDiv = document.getElementById('supply-unavailable-summary');
            if (result.summary && result.summary.length > 0) {
                summaryDiv.innerHTML = result.summary.map(s => `
                    <div style="display: inline-block; margin: 5px; padding: 8px 12px; background: #fff3e0; border-radius: 4px; font-size: 11px;">
                        <strong>${s.supplier_name}</strong> - ${s.reason || '(사유 없음)'}
                        <br><span style="color: #666;">${s.count}개 품목 (${s.start_date} ~ ${s.end_date})</span>
                        <button onclick="deleteSupplyUnavailableBulk('${s.supplier_name}', '${s.reason || ''}')"
                                style="margin-left: 10px; background: #f44336; color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 10px; cursor: pointer;">
                            삭제
                        </button>
                    </div>
                `).join('');
            } else {
                summaryDiv.innerHTML = '<p style="color: #999; font-size: 12px;">등록된 공급불가 품목이 없습니다.</p>';
            }

            // 목록 테이블 표시
            const tbody = document.getElementById('supply-unavailable-tbody');
            tbody.innerHTML = result.items.map(item => `
                <tr>
                    <td style="padding: 6px 8px; border: 1px solid #ddd;">${item.supplier_name || ''}</td>
                    <td style="padding: 6px 8px; border: 1px solid #ddd;">${item.ingredient_code || ''}</td>
                    <td style="padding: 6px 8px; border: 1px solid #ddd;">${item.ingredient_name || ''}</td>
                    <td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">${item.start_date || ''}</td>
                    <td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">${item.end_date || ''}</td>
                    <td style="padding: 6px 8px; border: 1px solid #ddd;">${item.reason || ''}</td>
                </tr>
            `).join('');

            document.getElementById('supply-unavailable-modal').style.display = 'block';
        } catch (error) {
            alert('❌ 목록 조회 중 오류: ' + error.message);
        }
    };

    // 모달 닫기
    window.hideSupplyUnavailableModal = function() {
        document.getElementById('supply-unavailable-modal').style.display = 'none';
    };

    // 일괄 삭제
    window.deleteSupplyUnavailableBulk = async function(supplierName, reason) {
        if (!confirm(`${supplierName}의 ${reason || '전체'} 공급불가 품목을 삭제하시겠습니까?`)) {
            return;
        }

        try {
            let url = `/api/admin/supply-unavailable/bulk?supplier_name=${encodeURIComponent(supplierName)}`;
            if (reason) url += `&reason=${encodeURIComponent(reason)}`;

            const response = await fetch(url, { method: 'DELETE' });
            const result = await response.json();

            if (result.success) {
                alert(`✅ ${result.deleted}개 항목이 삭제되었습니다.`);
                showSupplyUnavailableList(); // 목록 새로고침
            } else {
                alert('❌ 삭제 실패: ' + result.error);
            }
        } catch (error) {
            alert('❌ 삭제 중 오류: ' + error.message);
        }
    };

    async function getBrandingFormHTML() {
        return `
            <!-- 로고 업로드 섹션 -->
            <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px;">
                <h3 style="margin: 0 0 20px 0; font-size: 16px; color: #333; border-bottom: 2px solid #2a5298; padding-bottom: 10px;">📷 로고 이미지</h3>
                <div id="logo-drop-zone"
                    style="position: relative; width: 280px; min-height: 160px; border: 2px dashed #ccc; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fafafa; cursor: pointer; transition: all 0.2s; overflow: hidden;"
                    onclick="document.getElementById('logo-file').click()"
                    ondragover="event.preventDefault(); this.style.borderColor='#2196F3'; this.style.background='#e3f2fd';"
                    ondragleave="this.style.borderColor='#ccc'; this.style.background='#fafafa';"
                    ondrop="event.preventDefault(); this.style.borderColor='#ccc'; this.style.background='#fafafa'; handleLogoDrop(event);">
                    <div id="logo-preview-area" style="padding: 20px 20px 10px;">
                        <img id="logo-preview" src="/static/images/logo.png?v=20251027"
                            style="max-width: 240px; max-height: 100px; object-fit: contain; display: block;"
                            onerror="this.style.display='none'; document.getElementById('logo-empty-state').style.display='';">
                        <div id="logo-empty-state" style="display: none; padding: 20px; text-align: center;">
                            <div style="font-size: 40px; opacity: 0.4;">🖼️</div>
                            <div style="font-size: 13px; color: #999; margin-top: 5px;">로고 없음</div>
                        </div>
                    </div>
                    <div style="padding: 5px 20px 15px; text-align: center;">
                        <div style="font-size: 12px; color: #888;">
                            <span style="background: #e8e8e8; padding: 3px 10px; border-radius: 12px;">📁 클릭 또는 드래그하여 변경</span>
                        </div>
                    </div>
                    <div id="logo-upload-status" style="padding: 0 20px 10px; font-size: 12px; color: #666; text-align: center;"></div>
                </div>
                <input type="file" id="logo-file" accept=".png,.jpg,.jpeg,.gif,.webp" style="display: none;" onchange="uploadLogo(this)">
                <input type="hidden" id="logo-path" value="/static/images/logo.png?v=20251027">
                <div style="margin-top: 15px; max-width: 380px;">
                    <div style="font-size: 11px; color: #aaa; line-height: 1.6;">
                        PNG / JPG / GIF / WebP &middot; 최대 10MB &middot; 권장 가로 300~600px, 투명 배경 PNG
                    </div>
                </div>
            </div>

            <!-- 기본 정보 섹션 -->
            <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px;">
                <h3 style="margin: 0 0 20px 0; font-size: 16px; color: #333; border-bottom: 2px solid #2a5298; padding-bottom: 10px;">🏢 기본 정보</h3>
                <form id="branding-form">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #333; font-size: 13px;">회사명</label>
                            <input type="text" id="company-name" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" placeholder="예: 다함푸드">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #333; font-size: 13px;">시스템 이름</label>
                            <input type="text" id="system-name" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" placeholder="예: 급식관리">
                        </div>
                    </div>
                </form>
            </div>

            <!-- 테마 색상 섹션 -->
            <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px;">
                <h3 style="margin: 0 0 20px 0; font-size: 16px; color: #333; border-bottom: 2px solid #2a5298; padding-bottom: 10px;">🎨 테마 색상</h3>

                <!-- 프리셋 테마 선택 -->
                <div style="margin-bottom: 24px;">
                    <label style="display: block; margin-bottom: 10px; font-weight: 600; color: #333; font-size: 13px;">테마 선택</label>
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                        <div class="theme-preset" onclick="applyThemePreset('#2a5298','#667eea')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #2a5298, #667eea);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#1a1a2e','#e94560')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #1a1a2e, #e94560);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#0f3443','#34e89e')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #0f3443, #34e89e);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#4a1942','#c74b50')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #4a1942, #c74b50);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#2c3e50','#3498db')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #2c3e50, #3498db);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#232526','#f09819')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #232526, #f09819);"></div>
                        </div>
                        <div class="theme-preset" onclick="applyThemePreset('#355c7d','#c06c84')" style="cursor:pointer; border-radius: 10px; overflow: hidden; height: 60px; border: 3px solid transparent; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.12);"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
                            <div style="height: 100%; background: linear-gradient(135deg, #355c7d, #c06c84);"></div>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; margin-top: 4px;">
                        <div style="text-align: center; font-size: 11px; color: #888;">오션블루</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">미드나잇</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">에메랄드</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">와인베리</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">클래식</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">선셋</div>
                        <div style="text-align: center; font-size: 11px; color: #888;">로즈핑크</div>
                    </div>
                </div>

                <!-- 커스텀 색상 + 미리보기 -->
                <div style="display: flex; gap: 30px; align-items: flex-end; flex-wrap: wrap; padding-top: 20px; border-top: 1px solid #eee;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #333; font-size: 13px;">기본 색상</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="color" id="primary-color" value="#2a5298" style="width: 50px; height: 40px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 2px;">
                            <span id="primary-color-hex" style="font-size: 13px; color: #666; font-family: monospace;">#2a5298</span>
                        </div>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #333; font-size: 13px;">보조 색상</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="color" id="secondary-color" value="#667eea" style="width: 50px; height: 40px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 2px;">
                            <span id="secondary-color-hex" style="font-size: 13px; color: #666; font-family: monospace;">#667eea</span>
                        </div>
                    </div>
                    <div style="flex: 1; min-width: 200px;">
                        <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #333; font-size: 13px;">사이드바 미리보기</label>
                        <div id="color-preview-bar" style="height: 40px; border-radius: 8px; background: linear-gradient(135deg, #2a5298, #667eea); box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: background 0.3s;"></div>
                    </div>
                </div>
            </div>

            <!-- 저장 버튼 -->
            <div style="background: white; padding: 20px 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 10px;">
                    <button type="button" onclick="saveBranding()" style="padding: 12px 30px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">💾 저장</button>
                    <button type="button" onclick="loadBranding()" style="padding: 12px 30px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">🔄 새로고침</button>
                </div>
                <button type="button" onclick="resetBranding()" style="padding: 12px 30px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">🔙 기본값 복원</button>
            </div>

            <!-- 현재 설정값 -->
            <div style="margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 8px;">
                <h3 style="margin-bottom: 15px; font-size: 16px; color: #333;">📋 현재 설정값</h3>
                <pre id="current-branding" style="background: white; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 13px;"></pre>
            </div>
        `;
    }

    // ModuleLoader 먼저 시도
    if (window.moduleLoader) {
        try {
            console.log(`📦 [ModuleLoader] ${pageName} 모듈 로드 중...`);
            const moduleObject = await window.moduleLoader.loadModule(pageName);

            if (moduleObject && typeof moduleObject.init === 'function') {
                console.log(`🎯 [ModuleLoader] ${pageName} 모듈 초기화 중...`);
                await moduleObject.init();
                console.log(`✅ [ModuleLoader] ${pageName} 모듈 초기화 완료`);
                return;
            }
        } catch (error) {
            console.warn(`⚠️ [ModuleLoader] ${pageName} 모듈 로드 실패:`, error);
        }
    }

    // 폴백: 직접 모듈 로딩
    console.log(`🔄 [Fallback] 직접 ${pageName} 모듈 로드 중...`);
    if (fallbackInitialization[pageName]) {
        try {
            await fallbackInitialization[pageName]();
            console.log(`✅ [Fallback] ${pageName} 모듈 초기화 완료`);
        } catch (fallbackError) {
            console.error(`❌ [Fallback] ${pageName} 모듈 초기화 실패:`, fallbackError);
        }
    } else {
        console.warn(`⚠️ ${pageName} 페이지에 대한 모듈이 정의되지 않음`);
    }
}

// 간단한 초기화 함수
async function initializePage() {
    console.log('🚀 [Admin Dashboard] 초기화 시작');

    // 날짜 표시
    const currentDateElement = document.getElementById('current-date');
    if (currentDateElement) {
        currentDateElement.textContent = new Date().toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'short'
        });
    }

    console.log('✅ [Admin Dashboard] 초기화 완료');
}

/**
 * 최근 활동 로그 로드
 */
async function loadActivityLogs() {
    console.log('📝 최근 활동 로그 로딩...');

    try {
        const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.CONFIG?.API_BASE_URL || '';
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
        console.warn('⚠️ 최근 활동 로그 로드 실패 (서버 재시작 필요):', error.message);
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            activityList.innerHTML = `
                <div class="log-item">
                    <div class="log-message" style="color: #ff9800; text-align: center;">
                        <div style="margin-bottom: 10px;">⚠️ 활동 로그 서비스가 준비 중입니다.</div>
                        <div style="font-size: 12px; color: #666;">
                            서버를 재시작하면 활동 로그가 표시됩니다.<br>
                            (터미널에서 Ctrl+C 후 python main.py 실행)
                        </div>
                    </div>
                </div>
            `;
        }
    }
}

/**
 * 정기적으로 활동 로그 새로고침 (30초마다)
 */
let activityRefreshInterval = null;

function startActivityRefresh() {
    if (activityRefreshInterval) {
        clearInterval(activityRefreshInterval);
    }

    activityRefreshInterval = setInterval(() => {
        const dashboardContent = document.getElementById('dashboard-content');
        if (dashboardContent && dashboardContent.style.display !== 'none') {
            loadActivityLogs();
        }
    }, 30000); // 30초마다 새로고침
}

// 초기화 에러 표시 함수
function showInitializationError(error) {
    const contentArea = document.getElementById('content-area');
    if (contentArea) {
        contentArea.innerHTML = `
            <div style="padding: 40px; text-align: center; background: #fff; border-radius: 10px;">
                <h2 style="color: #ff6b6b;">⚠️ 시스템 초기화 실패</h2>
                <p style="color: #666; margin: 20px 0;">관리자 시스템을 시작할 수 없습니다.</p>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    ${error.message || error.toString()}
                </div>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    🔄 페이지 새로고침
                </button>
            </div>
        `;
    }
}

// 로그아웃 함수 (전역으로 필요)
window.logout = function() {
    if (confirm('로그아웃 하시겠습니까?')) {
        // localStorage에서 인증 관련 데이터 삭제
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        localStorage.removeItem('userRole');
        localStorage.removeItem('username');
        sessionStorage.clear();

        // 서버에 로그아웃 요청
        fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        }).finally(() => {
            window.location.href = '/login.html';
        });
    }
};

// 페이지 로드 시 통합 초기화 (단일 DOMContentLoaded 이벤트)
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎯 [Admin Dashboard] 통합 초기화 시작');

    try {
        // 기본 초기화 실행
        await initializePage();

        // 네비게이션 설정
        setupNavigation();

        console.log('✅ [Admin Dashboard] 통합 초기화 완료');

    } catch (error) {
        console.error('❌ [Admin Dashboard] 통합 초기화 실패:', error);
        showInitializationError(error);
    }
});

// 전역 함수 export (다른 모듈에서 사용 가능)
window.dashboardInit = {
    loadScript,
    switchToPage,
    initializePageModule,
    setupNavigation
};

// 전역 파일 저장 변수
window.selectedFiles = null;

// 이벤트 리스너 디버깅 및 감지
console.log('🔍 현재 등록된 이벤트 리스너 분석 시작...');

// 기존 change 이벤트 리스너들 확인
const originalAddEventListener = EventTarget.prototype.addEventListener;
const eventListeners = [];

EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'change') {
        console.log('📋 Change 이벤트 리스너 등록 감지:', this, listener.toString().substring(0, 100));
        eventListeners.push({ target: this, type, listener, options });
    }
    return originalAddEventListener.call(this, type, listener, options);
};

// 강제로 높은 우선순위로 change 이벤트 캐치
document.addEventListener('change', function(e) {
    console.log('🔍 [최우선] Change 이벤트 감지:', e.target);
    console.log('- 요소 타입:', e.target.type);
    console.log('- 요소 ID:', e.target.id);
    console.log('- 요소 클래스:', e.target.className);

    if (e.target && e.target.type === 'file') {
        console.log('📁 [최우선] 파일 input 변경 감지!');
        console.log('- 파일들:', e.target.files);

        // 즉시 전역 저장
        window.selectedFiles = e.target.files;
        console.log('✅ [최우선] 파일 전역 저장 완료:', e.target.files);

        // UI 업데이트
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            console.log('📂 선택된 파일:', file.name, file.size);

            // 즉시 UI 업데이트 시도
            setTimeout(() => {
                const fileInfo = document.getElementById('file-info');
                const fileName = document.getElementById('file-name');
                const fileSize = document.getElementById('file-size');

                if (fileInfo && fileName && fileSize) {
                    fileName.textContent = file.name;
                    fileSize.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} MB)`;
                    fileInfo.style.display = 'flex';
                    console.log('✅ [최우선] UI 업데이트 완료:', file.name);
                }
            }, 100);
        }
    }
}, true); // true = 캡처 단계에서 처리 (다른 리스너보다 먼저 실행)

// 등록된 이벤트 리스너 목록 출력
setTimeout(() => {
    console.log('📋 등록된 change 이벤트 리스너들:', eventListeners.length, '개');
    eventListeners.forEach((item, index) => {
        console.log(`${index + 1}. 대상:`, item.target.tagName || item.target.constructor.name, 'ID:', item.target.id);
    });
}, 2000);

// 전역 uploadExcelFile 함수 추가 - IngredientsModule 활용 중심
window.uploadExcelFile = function() {
    console.log('🎯 전역 uploadExcelFile 함수 호출됨');

    // IngredientsModule이 이미 파일을 처리하고 있으므로, 바로 활용
    if (window.IngredientsModule) {
        console.log('✅ IngredientsModule 발견 - 구조 분석 및 업로드 기능 호출');

        // IngredientsModule 구조 분석
        console.log('🔍 IngredientsModule 분석:');
        console.log('- uploadFiles 함수:', typeof window.IngredientsModule.uploadFiles);
        console.log('- uploadFileToServer 함수:', typeof window.IngredientsModule.uploadFileToServer);
        console.log('- handleFileSelect 함수:', typeof window.IngredientsModule.handleFileSelect);
        console.log('- uploadedFiles 배열:', window.IngredientsModule.uploadedFiles);

        // 모든 속성과 메서드 출력
        console.log('📋 IngredientsModule 모든 속성:');
        for (let key in window.IngredientsModule) {
            console.log(`- ${key}:`, typeof window.IngredientsModule[key]);
        }

        // 방법 1: uploadFiles 함수 직접 호출
        if (typeof window.IngredientsModule.uploadFiles === 'function') {
            console.log('🚀 IngredientsModule.uploadFiles() 직접 호출');
            try {
                window.IngredientsModule.uploadFiles();
                return;
            } catch (error) {
                console.warn('⚠️ uploadFiles 호출 실패:', error.message);
                console.error('에러 상세:', error);
            }
        } else {
            console.warn('⚠️ uploadFiles 함수가 존재하지 않음');
        }

        // 방법 2: uploadFileToServer 함수 활용 (IngredientsModule의 내부 함수)
        if (typeof window.IngredientsModule.uploadFileToServer === 'function' && window.IngredientsModule.uploadedFiles?.length > 0) {
            console.log('🚀 IngredientsModule.uploadFileToServer() 호출');
            try {
                const firstFile = window.IngredientsModule.uploadedFiles[0];
                window.IngredientsModule.uploadFileToServer(firstFile);
                return;
            } catch (error) {
                console.warn('⚠️ uploadFileToServer 호출 실패:', error.message);
            }
        }

        // 방법 2: IngredientsModule 내부 변수 직접 확인
        console.log('🎯 IngredientsModule 내부 파일 저장소 확인');

        // IngredientsModule 내부의 모든 변수 확인
        console.log('🔍 IngredientsModule 내부 상태:');
        for (let key in window.IngredientsModule) {
            const value = window.IngredientsModule[key];
            if (value && (Array.isArray(value) || value.length !== undefined)) {
                console.log(`- ${key} (배열/리스트):`, value);
            } else if (value && typeof value === 'object' && value !== null) {
                console.log(`- ${key} (객체):`, Object.keys(value));
            }
        }

        // 모든 파일 input 상세 검색
        const allFileInputs = document.querySelectorAll('input[type="file"]');
        console.log('🔍 모든 파일 input 상세 분석:', allFileInputs.length, '개');

        let foundFiles = null;
        for (let input of allFileInputs) {
            console.log(`📂 Input 분석:`, {
                id: input.id,
                name: input.name,
                className: input.className,
                filesCount: input.files?.length || 0,
                value: input.value,
                files: input.files ? Array.from(input.files).map(f => f.name) : []
            });

            if (input.files && input.files.length > 0) {
                foundFiles = input.files;
                console.log('✅ 파일 발견!', input.id, ':', foundFiles[0].name);
                break;
            }
        }

        // 전역 변수들 및 ingredients.js 변수 확인
        console.log('🌐 전역 변수 확인:');
        console.log('- window.selectedFiles:', window.selectedFiles);
        console.log('- window.uploadedFiles:', window.uploadedFiles);
        console.log('- window.fileData:', window.fileData);

        // ingredients.js의 uploadedFiles 변수 확인 (전역 스코프)
        let ingredientsUploadedFiles = null;
        try {
            // ingredients.js에서 정의된 uploadedFiles 변수 접근 시도
            if (typeof uploadedFiles !== 'undefined') {
                ingredientsUploadedFiles = uploadedFiles;
                console.log('📁 ingredients.js uploadedFiles 발견:', ingredientsUploadedFiles);
            }
        } catch (e) {
            console.log('⚠️ uploadedFiles 변수 접근 실패:', e.message);
        }

        // 전역 스코프에서 uploadedFiles 찾기
        if (!ingredientsUploadedFiles && window.uploadedFiles) {
            ingredientsUploadedFiles = window.uploadedFiles;
            console.log('📁 window.uploadedFiles 발견:', ingredientsUploadedFiles);
        }

        // 방법 1: ingredients.js의 uploadedFiles로 업로드
        if (ingredientsUploadedFiles && ingredientsUploadedFiles.length > 0) {
            console.log('🚀 ingredients uploadedFiles로 handleFileSelect 호출');
            const mockEvent = {
                target: { files: ingredientsUploadedFiles },
                preventDefault: function() { console.log('preventDefault 호출됨'); },
                stopPropagation: function() { console.log('stopPropagation 호출됨'); }
            };
            try {
                window.IngredientsModule.handleFileSelect(mockEvent);
                console.log('✅ ingredients uploadedFiles로 handleFileSelect 성공');
                return;
            } catch (error) {
                console.error('❌ ingredients uploadedFiles handleFileSelect 실패:', error);
                console.error('에러 스택:', error.stack);
            }
        }

        // 방법 2: 찾은 파일로 handleFileSelect 호출
        if (foundFiles && foundFiles.length > 0) {
            console.log('🚀 실제 파일로 handleFileSelect 호출');
            const mockEvent = {
                target: { files: foundFiles },
                preventDefault: function() { console.log('preventDefault 호출됨'); },
                stopPropagation: function() { console.log('stopPropagation 호출됨'); }
            };
            try {
                window.IngredientsModule.handleFileSelect(mockEvent);
                console.log('✅ handleFileSelect 성공적으로 실행됨');
                return;
            } catch (error) {
                console.error('❌ handleFileSelect 실행 실패:', error);
                console.error('에러 스택:', error.stack);
            }
        }

        // 전역에서 파일 가져오기
        if (window.selectedFiles && window.selectedFiles.length > 0) {
            console.log('🚀 전역 파일로 handleFileSelect 호출');
            const mockEvent = {
                target: { files: window.selectedFiles },
                preventDefault: function() { console.log('preventDefault 호출됨'); },
                stopPropagation: function() { console.log('stopPropagation 호출됨'); }
            };
            try {
                window.IngredientsModule.handleFileSelect(mockEvent);
                console.log('✅ 전역 파일로 handleFileSelect 성공');
                return;
            } catch (error) {
                console.error('❌ 전역 파일 handleFileSelect 실패:', error);
            }
        }

        // 방법 4: 전역 업로드 함수들 직접 호출
        console.log('🎯 전역 업로드 함수들 확인 및 호출 시도');
        console.log('- window.uploadFiles:', typeof window.uploadFiles);
        console.log('- window.uploadNewFile:', typeof window.uploadNewFile);
        console.log('- window.finalUploadFile:', typeof window.finalUploadFile);

        // 전역 업로드 함수 호출 시도
        if (typeof window.uploadFiles === 'function') {
            console.log('🚀 window.uploadFiles() 직접 호출');
            try {
                window.uploadFiles();
                console.log('✅ window.uploadFiles 성공적으로 실행됨');

                // 상세 결과가 자동으로 표시되므로 별도 알림 불필요
                console.log('✅ 파일 업로드 처리 중 - 상세 결과가 자동으로 표시됩니다.');

                return;
            } catch (error) {
                console.error('❌ window.uploadFiles 실행 실패:', error);
                console.error('에러 스택:', error.stack);
            }
        }

        if (typeof window.uploadNewFile === 'function') {
            console.log('🚀 window.uploadNewFile() 직접 호출');
            try {
                window.uploadNewFile();
                console.log('✅ window.uploadNewFile 성공적으로 실행됨');
                return;
            } catch (error) {
                console.error('❌ window.uploadNewFile 실행 실패:', error);
            }
        }

        if (typeof window.finalUploadFile === 'function') {
            console.log('🚀 window.finalUploadFile() 직접 호출');
            try {
                window.finalUploadFile();
                console.log('✅ window.finalUploadFile 성공적으로 실행됨');
                return;
            } catch (error) {
                console.error('❌ window.finalUploadFile 실행 실패:', error);
            }
        }

        console.warn('⚠️ 모든 방법으로 파일을 찾을 수 없음');
    }

    // IngredientsModule이 없거나 모든 시도 실패
    console.error('❌ IngredientsModule을 찾을 수 없거나 모든 업로드 시도 실패');
    alert('업로드 시스템을 찾을 수 없습니다. 페이지를 새로고침해주세요.');
};