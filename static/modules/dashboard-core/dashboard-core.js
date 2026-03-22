// 🎯 다함 식자재 관리 시스템 - 대시보드 코어 모듈
// 메인 대시보드 기능과 네비게이션을 담당

class DashboardCore {
    constructor() {
        this.currentPage = 'dashboard';
        this.modules = {};
        this.apiBase = CONFIG.API.BASE_URL;
        this.statsRefreshInterval = null;
        
        console.log('[DashboardCore] 초기화 시작');
        this.init();
    }

    /**
     * 대시보드 초기화
     */
    init() {
        this.bindEvents();
        this.setupDateTime();
        this.loadDashboardStats();
        this.loadRecentActivity();
        this.setupAutoRefresh();
        
        console.log('[DashboardCore] 초기화 완료');
    }

    /**
     * 날짜/시간 설정 (자체적 구현 - 의존성 제거)
     */
    setupDateTime() {
        console.log('[DashboardCore] 날짜/시간 설정 시작');
        
        const updateDateTime = () => {
            const currentDateElement = document.getElementById('current-date');
            if (!currentDateElement) return;
            
            try {
                const now = new Date();
                const dateString = now.toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long', 
                    day: 'numeric',
                    weekday: 'short'
                });
                currentDateElement.textContent = dateString;
            } catch (error) {
                console.warn('[DashboardCore] 날짜 표시 오류:', error);
                currentDateElement.textContent = new Date().toLocaleDateString();
            }
        };
        
        // 즉시 날짜 업데이트
        updateDateTime();
        
        // 실시간 업데이트 (DateTimeUtils 사용 가능한 경우에만)
        if (window.DateTimeUtils && typeof window.DateTimeUtils.startRealTimeUpdate === 'function') {
            try {
                this.dateUpdateInterval = window.DateTimeUtils.startRealTimeUpdate('current-date', 'korean');
                console.log('[DashboardCore] DateTimeUtils 실시간 업데이트 활성화');
                return;
            } catch (error) {
                console.warn('[DashboardCore] DateTimeUtils 사용 실패, 기본 타이머 사용:', error);
            }
        } else {
            console.log('[DashboardCore] DateTimeUtils 사용 불가 - window.DateTimeUtils:', !!window.DateTimeUtils, 'startRealTimeUpdate:', typeof window.DateTimeUtils?.startRealTimeUpdate);
        }
        
        // 기본 타이머로 1분마다 업데이트
        this.dateUpdateInterval = setInterval(updateDateTime, 60000);
        console.log('[DashboardCore] 기본 날짜 업데이트 활성화 (1분 간격)');
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // 네비게이션 클릭 이벤트
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.getAttribute('data-page');
                this.switchPage(page);
            });
        });
    }

    /**
     * 페이지 전환
     */
    async switchPage(pageName) {
        console.log(`[DashboardCore] 페이지 전환: ${this.currentPage} → ${pageName}`);
        
        // 네비게이션 활성화 상태 업데이트
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
        
        // 컨텐츠 영역 전환
        document.querySelectorAll('.page-content').forEach(content => {
            content.style.display = 'none';
        });
        
        const targetContent = document.getElementById(`${pageName}-content`);
        if (targetContent) {
            targetContent.style.display = 'block';
        }
        
        // 페이지 제목 업데이트
        this.updatePageTitle(pageName);
        
        // 페이지별 모듈 로드
        await this.loadPageModule(pageName);
        
        this.currentPage = pageName;
    }

    /**
     * 페이지 제목 업데이트
     */
    updatePageTitle(pageName) {
        const titles = {
            'dashboard': '관리자 대시보드',
            'users': '사용자 관리',
            'suppliers': '협력업체 관리',
            'business-locations': '사업장 관리',
            'meal-pricing': '식단가 관리',
            'ingredients': '식자재 관리'
        };
        
        const title = titles[pageName] || '관리자 시스템';
        document.getElementById('page-title').textContent = title;
        document.title = `${title} - 다함 식자재 관리 시스템`;
    }

    /**
     * 페이지별 모듈 동적 로드 (ModuleLoader 사용)
     */
    async loadPageModule(pageName) {
        if (this.modules[pageName]) {
            console.log(`[DashboardCore] ${pageName} 모듈 이미 로드됨`);
            return;
        }

        try {
            console.log(`[DashboardCore] ${pageName} 모듈 로드 시작`);
            
            // 페이지명을 모듈명으로 매핑
            const pageToModule = {
                'users': 'users',
                'suppliers': 'suppliers',
                'business-locations': 'sites',
                'meal-pricing': 'meal-pricing',
                'ingredients': 'ingredients'
            };
            
            const moduleName = pageToModule[pageName];
            if (moduleName) {
                // 이미 로드된 모듈 인스턴스 확인
                const existingInstance = window[`${moduleName}Management`];

                if (existingInstance && existingInstance.load) {
                    console.log(`[DashboardCore] 기존 ${pageName} 모듈 인스턴스 사용`);
                    this.modules[pageName] = existingInstance;

                    // 모듈 로드 (HTML 생성 포함)
                    if (!existingInstance.isLoaded) {
                        await existingInstance.load();
                    }
                    console.log(`[DashboardCore] ${pageName} 모듈 로드 완료`);
                    return;
                }

                // ModuleLoader를 통한 안전한 모듈 로드
                const ModuleClass = await window.ModuleLoader.loadModule(moduleName);

                if (ModuleClass) {
                    // 모듈이 객체인지 클래스인지 확인
                    if (typeof ModuleClass === 'function') {
                        this.modules[pageName] = new ModuleClass();
                        // 모듈이 HTML을 생성하는 load 메서드를 호출
                        if (this.modules[pageName].load) {
                            await this.modules[pageName].load();
                        }
                    } else if (typeof ModuleClass === 'object' && ModuleClass.load) {
                        // 기존 모듈 방식
                        const containerId = `${pageName}-content`;
                        let container = document.getElementById(containerId);

                        if (!container) {
                            console.warn(`[DashboardCore] 컨테이너 ${containerId}를 찾을 수 없습니다`);
                            return;
                        }

                        // 컨테이너에 임시 ID 추가
                        const moduleId = `${moduleName}-module`;
                        if (!document.getElementById(moduleId)) {
                            container.innerHTML = `<div id="${moduleId}"></div>`;
                        }

                        this.modules[pageName] = ModuleClass;
                        await ModuleClass.load();
                    }
                    console.log(`[DashboardCore] ${pageName} 모듈 로드 완료`);
                } else {
                    console.warn(`[DashboardCore] ${pageName} 모듈을 로드할 수 없습니다`);
                }
            }
        } catch (error) {
            console.error(`[DashboardCore] ${pageName} 모듈 로드 실패:`, error);
            this.showModuleLoadError(pageName);
        }
    }

    /**
     * 스크립트 동적 로드
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * 모듈 클래스 가져오기
     */
    getModuleClass(pageName) {
        const classNames = {
            'users': 'UsersAdminModule',
            'suppliers': 'SuppliersAdminModule', 
            'business-locations': 'SitesAdminModule',
            'meal-pricing': 'MealPricingAdminModule',
            'ingredients': 'IngredientsAdminModule'
        };
        
        const className = classNames[pageName];
        return className ? window[className] : null;
    }

    /**
     * 모듈 로드 실패 시 에러 표시
     */
    showModuleLoadError(pageName) {
        const content = document.getElementById(`${pageName}-content`);
        if (content) {
            content.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #666;">
                    <h3>⚠️ 모듈 로드 실패</h3>
                    <p>${pageName} 모듈을 불러올 수 없습니다.</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        페이지 새로고침
                    </button>
                </div>
            `;
        }
    }

    /**
     * 대시보드 통계 로드 (견고한 에러 처리 + UX 개선)
     */
    async loadDashboardStats() {
        let loadingId = null;
        
        // LoadingManager 사용 가능한 경우에만 로딩 표시 (더 안전한 체크)
        try {
            if (window.LoadingManager && 
                typeof window.LoadingManager === 'object' && 
                typeof window.LoadingManager.startLoading === 'function') {
                
                loadingId = window.LoadingManager.startLoading('dashboard-stats', {
                    message: '대시보드 통계를 불러오는 중...',
                    type: 'card',
                    element: document.querySelector('.dashboard-grid')
                });
                console.log('[DashboardCore] LoadingManager 활성화됨');
            } else {
                console.log('[DashboardCore] LoadingManager 사용 불가, 기본 로딩 진행');
            }
        } catch (loadingError) {
            console.warn('[DashboardCore] LoadingManager 실행 중 오류:', loadingError);
            loadingId = null;
        }

        try {
            console.log('[DashboardCore] 대시보드 통계 로드 시작');
            
            const endpoint = `${this.apiBase}${CONFIG.API.ENDPOINTS.DASHBOARD_STATS}`;
            
            // 프로그레스 업데이트 (안전한 방식)
            if (loadingId && window.LoadingManager && typeof window.LoadingManager.updateProgress === 'function') {
                try { window.LoadingManager.updateProgress(loadingId, 30); } catch (e) { console.warn('LoadingManager.updateProgress 실패:', e); }
            }
            
            const response = await fetch(endpoint);
            
            if (loadingId && window.LoadingManager && typeof window.LoadingManager.updateProgress === 'function') {
                try { window.LoadingManager.updateProgress(loadingId, 70); } catch (e) { console.warn('LoadingManager.updateProgress 실패:', e); }
            }
            
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }
            
            const data = await response.json();
            
            if (loadingId && window.LoadingManager && typeof window.LoadingManager.updateProgress === 'function') {
                try { window.LoadingManager.updateProgress(loadingId, 90); } catch (e) { console.warn('LoadingManager.updateProgress 실패:', e); }
            }
            
            if (data.success) {
                this.displayStats(data);
                
                if (loadingId && window.LoadingManager && typeof window.LoadingManager.updateProgress === 'function') {
                    try { window.LoadingManager.updateProgress(loadingId, 100); } catch (e) { console.warn('LoadingManager.updateProgress 실패:', e); }
                }
                
                console.log('[DashboardCore] 통계 로드 성공');
            } else {
                throw new Error(data.error || '통계 데이터 로드 실패');
            }
        } catch (error) {
            // ErrorHandler를 통한 중앙 집중식 에러 처리 (가능한 경우에만)
            if (window.ErrorHandler && typeof window.ErrorHandler.handleApiError === 'function') {
                ErrorHandler.handleApiError(error, {
                    endpoint: `${this.apiBase}${CONFIG.API.ENDPOINTS.DASHBOARD_STATS}`,
                    method: 'GET',
                    context: '대시보드 통계 로드'
                });
            } else {
                console.error('[DashboardCore] 통계 로드 실패:', error);
            }
            
            this.showStatsError();
        } finally {
            // 로딩 상태 정리 (안전한 방식)
            if (loadingId && window.LoadingManager && typeof window.LoadingManager.stopLoading === 'function') {
                try { 
                    window.LoadingManager.stopLoading(loadingId); 
                } catch (e) { 
                    console.warn('[DashboardCore] LoadingManager.stopLoading 실패:', e); 
                }
            }
        }
    }

    /**
     * 통계 데이터 표시
     */
    displayStats(data) {
        const elements = {
            'total-users': data.totalUsers || 0,
            'total-sites': data.totalSites || 0,
            'total-ingredients': (data.totalIngredients || 0).toLocaleString(),
            'total-suppliers': data.totalSuppliers || 0
        };
        
        Object.keys(elements).forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = elements[id];
            }
        });
        
        console.log('[DashboardCore] 통계 표시 완료:', data);
    }

    /**
     * 통계 로드 실패 시 에러 표시
     */
    showStatsError() {
        const statElements = ['total-users', 'total-sites', 'total-ingredients', 'total-suppliers'];
        statElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = 'N/A';
                element.style.color = '#ff6b6b';
            }
        });
    }

    /**
     * 최근 활동 로드
     */
    async loadRecentActivity() {
        try {
            console.log('[DashboardCore] 최근 활동 로드 시작');
            
            const response = await fetch(`${this.apiBase}${CONFIG.API.ENDPOINTS.RECENT_ACTIVITY}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            if (data.success && data.activities) {
                this.displayActivities(data.activities);
            } else {
                throw new Error('활동 데이터가 없습니다');
            }
        } catch (error) {
            console.error('[DashboardCore] 최근 활동 로드 실패:', error);
            this.showActivitiesError();
        }
    }

    /**
     * 활동 로그 표시
     */
    displayActivities(activities) {
        const activityList = document.getElementById('activity-list');
        if (!activityList) return;
        
        if (!activities || activities.length === 0) {
            activityList.innerHTML = '<div class="log-item"><div class="log-message">최근 활동이 없습니다.</div></div>';
            return;
        }
        
        const html = activities.map(activity => `
            <div class="log-item">
                <div class="log-time">${activity.time}</div>
                <div class="log-message">${activity.action}</div>
                <div class="log-user">${activity.user}</div>
            </div>
        `).join('');
        
        activityList.innerHTML = html;
        console.log(`[DashboardCore] ${activities.length}개 활동 표시 완료`);
    }

    /**
     * 활동 로그 에러 표시
     */
    showActivitiesError() {
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            activityList.innerHTML = `
                <div class="log-item">
                    <div class="log-message" style="color: #ff6b6b;">
                        ⚠️ 최근 활동을 불러올 수 없습니다.
                    </div>
                </div>
            `;
        }
    }

    /**
     * 자동 새로고침 설정
     */
    setupAutoRefresh() {
        // 5분마다 통계 새로고침
        this.statsRefreshInterval = setInterval(() => {
            if (this.currentPage === 'dashboard') {
                console.log('[DashboardCore] 통계 자동 새로고침');
                this.loadDashboardStats();
                this.loadRecentActivity();
            }
        }, 5 * 60 * 1000);
    }

    /**
     * 정리 (메모리 해제) - 견고한 정리 시스템
     */
    destroy() {
        // 통계 새로고침 정리
        if (this.statsRefreshInterval) {
            clearInterval(this.statsRefreshInterval);
            this.statsRefreshInterval = null;
        }
        
        // 날짜 업데이트 정리
        if (this.dateUpdateInterval) {
            clearInterval(this.dateUpdateInterval);
            this.dateUpdateInterval = null;
        }
        
        // 모듈 정리
        Object.keys(this.modules).forEach(moduleName => {
            const module = this.modules[moduleName];
            if (module && typeof module.destroy === 'function') {
                module.destroy();
            }
        });
        this.modules = {};
        
        console.log('[DashboardCore] 완전한 정리 완료 (메모리 누수 방지)');
    }
}

// 전역에서 사용 가능하도록 설정
if (typeof window !== 'undefined') {
    window.DashboardCore = DashboardCore;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardCore;
}