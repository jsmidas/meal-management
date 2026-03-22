/**
 * Dashboard Module - 대시보드 데이터 관리
 * 시스템 현황, 통계, 최근 활동 등을 표시하는 독립 모듈
 */
class DashboardModule {
    constructor() {
        this.refreshInterval = null;
        this.autoRefreshEnabled = true;
        this.refreshIntervalTime = 30000; // 30초마다 자동 새로고침
        this.init();
    }

    /**
     * 모듈 초기화
     */
    init() {
        console.log('[Dashboard] 모듈 초기화 시작');
        
        // 페이지가 대시보드일 때만 초기화
        if (document.getElementById('dashboard-page')) {
            this.loadDashboardData();
            this.loadRecentActivity();
            this.startAutoRefresh();
        }
        
        console.log('[Dashboard] 모듈 초기화 완료');
    }

    /**
     * 대시보드 통계 데이터 로드
     */
    async loadDashboardData() {
        try {
            console.log('[Dashboard] 통계 데이터 로드 시작');
            
            const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/dashboard-stats');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStatistics(data);
                console.log('[Dashboard] 통계 데이터 로드 완료');
            } else {
                console.warn('[Dashboard] 통계 데이터 로드 실패:', data.message);
                this.showFallbackStats();
            }
        } catch (error) {
            console.error('[Dashboard] 통계 데이터 로드 에러:', error);
            this.showFallbackStats();
        }
    }

    /**
     * 통계 데이터 UI 업데이트
     */
    updateStatistics(data) {
        const mappedStats = {
            'total-users': data.totalUsers || 0,
            'total-sites': data.totalSites || 0,
            'today-menus': data.totalSuppliers || 0,  // "협력업체 수"로 변경
            'price-updates': data.totalIngredients || 0  // "전체 식자재"로 변경
        };

        Object.entries(mappedStats).forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                this.animateCounter(element, value);
            } else {
                console.warn(`[Dashboard] 요소를 찾을 수 없음: ${elementId}`);
            }
        });

        // 트렌드 데이터도 업데이트 (있는 경우)
        if (data.trends) {
            this.updateTrends(data.trends);
        }
    }

    /**
     * 숫자 애니메이션 효과
     */
    animateCounter(element, targetValue) {
        const startValue = parseInt(element.textContent) || 0;
        const difference = targetValue - startValue;
        const duration = 1000; // 1초
        const steps = 60;
        const stepValue = difference / steps;
        let currentStep = 0;

        const timer = setInterval(() => {
            currentStep++;
            const currentValue = Math.round(startValue + (stepValue * currentStep));
            element.textContent = currentValue;

            if (currentStep >= steps) {
                clearInterval(timer);
                element.textContent = targetValue;
            }
        }, duration / steps);
    }

    /**
     * 트렌드 데이터 업데이트
     */
    updateTrends(trends) {
        const trendElements = {
            'users-trend': trends.users,
            'sites-trend': trends.sites,
            'menus-trend': trends.menus,
            'price-trend': trends.prices
        };

        Object.entries(trendElements).forEach(([elementId, trendValue]) => {
            const element = document.getElementById(elementId);
            if (element && trendValue !== undefined) {
                const formattedValue = trendValue > 0 ? `+${trendValue}%` : `${trendValue}%`;
                element.textContent = formattedValue;
                
                // 트렌드에 따른 클래스 업데이트
                element.className = 'stat-trend';
                if (trendValue > 0) {
                    element.classList.add('positive');
                } else if (trendValue < 0) {
                    element.classList.add('negative');
                } else {
                    element.classList.add('neutral');
                }
            }
        });
    }

    /**
     * 폴백 통계 데이터 표시 (API 실패 시)
     */
    showFallbackStats() {
        const fallbackStats = {
            'total-users': 1,
            'total-sites': 5,
            'today-menus': 0,
            'price-updates': 0
        };

        Object.entries(fallbackStats).forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = value;
            }
        });

        console.log('[Dashboard] 폴백 통계 데이터 표시');
    }

    /**
     * 최근 활동 로그 로드
     */
    async loadRecentActivity() {
        try {
            console.log('[Dashboard] 최근 활동 로드 시작');
            
            const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/recent-activity');
            
            if (response.ok) {
                const result = await response.json();
                const activities = result.activities || result.data || [];
                this.displayActivities(activities);
            } else {
                console.warn('[Dashboard] 최근 활동 API 응답 실패');
                this.showFallbackActivities();
            }
        } catch (error) {
            console.error('[Dashboard] 최근 활동 로드 에러:', error);
            this.showFallbackActivities();
        }
    }

    /**
     * 활동 로그 표시
     */
    displayActivities(activities) {
        const activityList = document.getElementById('activity-list');
        if (!activityList) return;

        if (activities.length === 0) {
            activityList.innerHTML = '<div class="log-item">최근 활동이 없습니다.</div>';
            return;
        }

        activityList.innerHTML = activities.map(activity => `
            <div class="log-item">
                <div class="log-time">${this.formatTime(activity.timestamp)}</div>
                <div class="log-message">${this.escapeHtml(activity.message)}</div>
                <div class="log-user">${this.escapeHtml(activity.user)}</div>
            </div>
        `).join('');

        console.log('[Dashboard] 활동 로그 표시 완료:', activities.length + '개');
    }

    /**
     * 폴백 활동 로그 표시
     */
    showFallbackActivities() {
        const fallbackActivities = [
            {
                timestamp: new Date().toISOString(),
                message: '시스템이 시작되었습니다.',
                user: 'System'
            },
            {
                timestamp: new Date(Date.now() - 300000).toISOString(),
                message: 'Settings 모듈이 성공적으로 로드되었습니다.',
                user: 'System'
            },
            {
                timestamp: new Date(Date.now() - 600000).toISOString(),
                message: '데이터베이스 연결이 성공했습니다.',
                user: 'System'
            }
        ];

        this.displayActivities(fallbackActivities);
        console.log('[Dashboard] 폴백 활동 로그 표시');
    }

    /**
     * 활동 새로고침
     */
    async refreshActivity() {
        const refreshBtn = document.querySelector('.btn-refresh i');
        if (refreshBtn) {
            refreshBtn.classList.add('fa-spin');
        }

        await this.loadRecentActivity();
        
        setTimeout(() => {
            if (refreshBtn) {
                refreshBtn.classList.remove('fa-spin');
            }
        }, 500);
    }

    /**
     * 자동 새로고침 시작
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.autoRefreshEnabled) {
            this.refreshInterval = setInterval(() => {
                // 현재 페이지가 대시보드일 때만 새로고침
                const dashboardPage = document.getElementById('dashboard-page');
                if (dashboardPage && !dashboardPage.classList.contains('hidden')) {
                    console.log('[Dashboard] 자동 새로고침 실행');
                    this.loadDashboardData();
                    this.loadRecentActivity();
                }
            }, this.refreshIntervalTime);

            console.log('[Dashboard] 자동 새로고침 시작 (' + (this.refreshIntervalTime / 1000) + '초 간격)');
        }
    }

    /**
     * 자동 새로고침 중지
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('[Dashboard] 자동 새로고침 중지');
        }
    }

    /**
     * 시간 포맷팅
     */
    formatTime(timestamp) {
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;

            // 1분 미만
            if (diff < 60000) {
                return '방금 전';
            }
            // 1시간 미만
            else if (diff < 3600000) {
                return Math.floor(diff / 60000) + '분 전';
            }
            // 24시간 미만
            else if (diff < 86400000) {
                return Math.floor(diff / 3600000) + '시간 전';
            }
            // 그 외
            else {
                return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            }
        } catch (error) {
            return timestamp;
        }
    }

    /**
     * HTML 이스케이프
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 페이지 전환 시 호출
     */
    onPageShow() {
        console.log('[Dashboard] 페이지 표시됨');
        this.loadDashboardData();
        this.loadRecentActivity();
        this.startAutoRefresh();
    }

    /**
     * 페이지 숨김 시 호출
     */
    onPageHide() {
        console.log('[Dashboard] 페이지 숨김');
        this.stopAutoRefresh();
    }

    /**
     * 모듈 제거 시 정리
     */
    destroy() {
        this.stopAutoRefresh();
        console.log('[Dashboard] 모듈 제거됨');
    }
}

// 전역 클래스 등록
window.DashboardModule = DashboardModule;

// 페이지 전환 이벤트 감지 (showPage 함수가 호출될 때)
const originalShowPage = window.showPage;
if (originalShowPage) {
    window.showPage = function(pageName) {
        const result = originalShowPage.call(this, pageName);
        
        if (pageName === 'dashboard' && window.dashboardInstance) {
            window.dashboardInstance.onPageShow();
        } else if (window.dashboardInstance) {
            window.dashboardInstance.onPageHide();
        }
        
        return result;
    };
}

console.log('[Dashboard] 대시보드 모듈 로드 완료');