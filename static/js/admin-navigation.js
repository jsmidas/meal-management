/**
 * 🧭 Admin Navigation 모듈
 * 페이지 네비게이션 및 모듈 동적 로딩을 관리합니다.
 */

class AdminNavigation {
    constructor(moduleLoader) {
        this.moduleLoader = moduleLoader;
        this.currentPage = null;
        this.loadedModules = new Map();
        this.pageModuleMap = {
            'dashboard': null, // 대시보드는 별도 모듈 없음
            'users': 'users',
            'suppliers': 'suppliers',
            'business-locations': 'sites',
            'meal-pricing': 'meal-pricing',
            'ingredients': 'ingredients',
            'supplier-mapping': 'mappings'  // 협력업체 매칭
        };
    }

    /**
     * 네비게이션 초기화
     */
    initialize() {
        console.log('🧭 [Navigation] 초기화 시작');

        // 네비게이션 이벤트 리스너 설정
        this.setupNavigationListeners();

        // 기본 페이지로 대시보드 활성화
        this.switchToPage('dashboard');

        console.log('✅ [Navigation] 초기화 완료');
    }

    /**
     * 네비게이션 이벤트 리스너 설정
     */
    setupNavigationListeners() {
        document.querySelectorAll('.nav-item').forEach(navItem => {
            navItem.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPage = navItem.getAttribute('data-page');
                if (targetPage) {
                    this.switchToPage(targetPage);
                }
            });
        });
    }

    /**
     * 페이지 전환
     */
    async switchToPage(pageName) {
        console.log(`🔄 [Navigation] 페이지 전환: ${pageName}`);

        // 권한 관리 메뉴 클릭 시 사용자 관리로 리다이렉트 (통합됨)
        if (pageName === 'user-permissions') {
            console.log('🔐 [Navigation] 권한 관리가 사용자 관리에 통합되었습니다');
            this.showIntegrationNotice();
            // 사용자 관리 페이지로 이동
            pageName = 'users';
        }

        // 동일한 페이지면 무시
        if (this.currentPage === pageName) {
            console.log(`ℹ️ [Navigation] 이미 ${pageName} 페이지에 있습니다`);
            return;
        }

        try {
            // 1. 네비게이션 상태 업데이트
            this.updateNavigationState(pageName);

            // 2. 콘텐츠 영역 전환
            this.switchContentArea(pageName);

            // 3. 페이지별 모듈 초기화
            await this.initializePageModule(pageName);

            // 4. 페이지 타이틀 업데이트
            this.updatePageTitle(pageName);

            this.currentPage = pageName;
            console.log(`✅ [Navigation] ${pageName} 페이지로 전환 완료`);

        } catch (error) {
            console.error(`❌ [Navigation] 페이지 전환 실패:`, error);
            this.showPageError(pageName, error);
        }
    }

    /**
     * 네비게이션 상태 업데이트
     */
    updateNavigationState(pageName) {
        // 모든 네비게이션 아이템에서 active 클래스 제거
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // 선택된 아이템에 active 클래스 추가
        const activeItem = document.querySelector(`[data-page="${pageName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }

    /**
     * 콘텐츠 영역 전환
     */
    switchContentArea(pageName) {
        // 모든 페이지 콘텐츠 숨기기
        document.querySelectorAll('.page-content').forEach(content => {
            content.classList.remove('active');
            content.style.display = 'none';
        });

        // 선택된 페이지 콘텐츠 표시
        const targetContent = document.getElementById(`${pageName}-content`);
        if (targetContent) {
            targetContent.classList.add('active');
            targetContent.style.display = 'block';
        } else {
            console.warn(`⚠️ [Navigation] ${pageName}-content 요소를 찾을 수 없습니다`);
        }
    }

    /**
     * 페이지별 모듈 초기화
     */
    async initializePageModule(pageName) {
        // 대시보드는 모듈 초기화 불필요
        if (pageName === 'dashboard') {
            console.log('📊 [Navigation] 대시보드 페이지 - 추가 모듈 불필요');
            this.loadDashboardData();
            return;
        }

        const moduleName = this.pageModuleMap[pageName];
        if (!moduleName) {
            console.warn(`⚠️ [Navigation] ${pageName}에 대한 모듈 매핑이 없습니다`);
            return;
        }

        // 이미 로드된 모듈인지 확인
        if (this.loadedModules.has(moduleName)) {
            const moduleInstance = this.loadedModules.get(moduleName);
            console.log(`♻️ [Navigation] ${moduleName} 모듈 재사용`);

            // refresh 메서드가 있으면 호출
            if (moduleInstance && typeof moduleInstance.refresh === 'function') {
                await moduleInstance.refresh();
            }
            return;
        }

        // ModuleLoader로 모듈 로드
        try {
            console.log(`📦 [Navigation] ${moduleName} 모듈 로드 중...`);

            if (this.moduleLoader) {
                const ModuleClass = await this.moduleLoader.loadModule(moduleName);

                if (ModuleClass) {
                    // 모듈 인스턴스 생성
                    const moduleInstance = new ModuleClass();
                    this.loadedModules.set(moduleName, moduleInstance);

                    // init 메서드가 있으면 호출
                    if (typeof moduleInstance.init === 'function') {
                        await moduleInstance.init();
                    }

                    console.log(`✅ [Navigation] ${moduleName} 모듈 초기화 완료`);
                }
            } else {
                // 폴백: 직접 모듈 로드
                await this.fallbackModuleLoad(pageName);
            }
        } catch (error) {
            console.error(`❌ [Navigation] ${moduleName} 모듈 로드 실패:`, error);
            // 모듈 로드 실패해도 페이지는 표시
        }
    }

    /**
     * 폴백 모듈 로드
     */
    async fallbackModuleLoad(pageName) {
        console.log(`🔄 [Navigation] 폴백 모드로 ${pageName} 모듈 로드`);

        const fallbackScripts = {
            'users': 'static/modules/users/users-complete.js',
            'suppliers': 'static/modules/suppliers/suppliers.js',
            'business-locations': 'static/modules/sites/sites.js',
            'meal-pricing': 'static/modules/meal-pricing/meal-pricing.js',
            'ingredients': 'static/modules/ingredients/ingredients.js',
            'supplier-mapping': 'static/modules/mappings/mappings.js'
        };

        const scriptPath = fallbackScripts[pageName];
        if (scriptPath) {
            await this.loadScript(scriptPath);
            console.log(`✅ [Navigation] 폴백 스크립트 로드 완료: ${scriptPath}`);
        }
    }

    /**
     * 대시보드 데이터 로드
     */
    async loadDashboardData() {
        console.log('📊 [Navigation] 대시보드 데이터 로드 중...');

        try {
            // API에서 통계 데이터 가져오기
            if (window.CONFIG && window.CONFIG.API) {
                const apiBase = window.CONFIG.API.BASE_URL || window.location.origin;

                // 캐시 사용 가능하면 캐시에서 가져오기
                if (window.AdminCache) {
                    const cachedData = AdminCache.get('dashboard-stats');
                    if (cachedData) {
                        this.updateDashboardStats(cachedData);
                        return;
                    }
                }

                // API 호출 (실제 구현 시)
                // const response = await fetch(`${apiBase}/dashboard/stats`);
                // const data = await response.json();
                // this.updateDashboardStats(data);

                // 임시 데이터 표시
                this.updateDashboardStats({
                    totalUsers: 12,
                    totalSites: 4,
                    totalIngredients: 84215,
                    totalSuppliers: 5
                });
            }
        } catch (error) {
            console.error('❌ [Navigation] 대시보드 데이터 로드 실패:', error);
        }
    }

    /**
     * 대시보드 통계 업데이트
     */
    updateDashboardStats(data) {
        const elements = {
            'total-users': data.totalUsers,
            'total-sites': data.totalSites,
            'total-ingredients': data.totalIngredients,
            'total-suppliers': data.totalSuppliers
        };

        for (const [id, value] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value !== undefined ? value.toLocaleString() : '-';
            }
        }
    }

    /**
     * 페이지 타이틀 업데이트
     */
    updatePageTitle(pageName) {
        const titles = {
            'dashboard': '관리자 대시보드',
            'users': '사용자 관리',
            'suppliers': '협력업체 관리',
            'business-locations': '사업장 관리',
            'meal-pricing': '식단가 관리',
            'ingredients': '식자재 관리',
            'supplier-mapping': '협력업체 매칭'
        };

        const titleElement = document.getElementById('page-title');
        if (titleElement) {
            titleElement.textContent = titles[pageName] || '관리자 시스템';
        }
    }

    /**
     * 페이지 오류 표시
     */
    showPageError(pageName, error) {
        const contentArea = document.getElementById(`${pageName}-content`);
        if (contentArea) {
            contentArea.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <h3 style="color: #ff6b6b;">⚠️ 페이지 로드 실패</h3>
                    <p style="color: #666; margin: 20px 0;">${pageName} 페이지를 불러올 수 없습니다.</p>
                    <p style="color: #999; font-size: 14px;">${error.message}</p>
                    <button onclick="window.navigation.switchToPage('${pageName}')"
                            style="margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        🔄 다시 시도
                    </button>
                </div>
            `;
        }
    }

    /**
     * 스크립트 동적 로드
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * 모듈 언로드
     */
    unloadModule(moduleName) {
        if (this.loadedModules.has(moduleName)) {
            const module = this.loadedModules.get(moduleName);

            // destroy 메서드가 있으면 호출
            if (module && typeof module.destroy === 'function') {
                try {
                    module.destroy();
                    console.log(`🧹 [Navigation] ${moduleName} 모듈 정리 완료`);
                } catch (error) {
                    console.error(`⚠️ [Navigation] ${moduleName} 모듈 정리 실패:`, error);
                }
            }

            this.loadedModules.delete(moduleName);
        }
    }

    /**
     * 전체 초기화
     */
    reset() {
        // 모든 로드된 모듈 정리
        for (const [name, module] of this.loadedModules) {
            if (module && typeof module.destroy === 'function') {
                try {
                    module.destroy();
                } catch (error) {
                    console.error(`⚠️ [Navigation] ${name} 모듈 정리 실패:`, error);
                }
            }
        }

        this.loadedModules.clear();
        this.currentPage = null;
        console.log('🔄 [Navigation] 초기화 완료');
    }

    /**
     * 권한 관리 통합 안내 표시
     */
    showIntegrationNotice() {
        // 기존 알림이 있으면 제거
        const existingNotice = document.querySelector('.integration-notice');
        if (existingNotice) existingNotice.remove();

        const notice = document.createElement('div');
        notice.className = 'integration-notice';
        notice.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
            z-index: 10000;
            max-width: 360px;
            animation: slideIn 0.3s ease-out;
        `;
        notice.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 24px;">🔐</span>
                <div>
                    <strong style="display: block; margin-bottom: 6px;">권한 관리 통합 안내</strong>
                    <p style="margin: 0; font-size: 13px; opacity: 0.95; line-height: 1.5;">
                        권한 관리 기능이 사용자 관리에 통합되었습니다.<br>
                        사용자 목록에서 <strong>✏️ 편집</strong> 버튼을 클릭하면<br>
                        <strong>🔐 권한 관리</strong> 탭에서 권한을 설정할 수 있습니다.
                    </p>
                </div>
                <button onclick="this.parentElement.parentElement.remove()"
                        style="background: none; border: none; color: white; cursor: pointer; font-size: 18px; opacity: 0.8; padding: 0; margin-left: auto;">
                    &times;
                </button>
            </div>
        `;

        // 애니메이션 스타일 추가
        if (!document.querySelector('#integration-notice-style')) {
            const style = document.createElement('style');
            style.id = 'integration-notice-style';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notice);

        // 5초 후 자동 제거
        setTimeout(() => {
            if (notice.parentElement) {
                notice.style.animation = 'slideIn 0.3s ease-out reverse';
                setTimeout(() => notice.remove(), 300);
            }
        }, 5000);
    }
}

// 전역 등록
window.AdminNavigation = AdminNavigation;
console.log('✅ [Navigation] 네비게이션 모듈 준비 완료');