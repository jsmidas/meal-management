/* 대시보드 동적 로더 모듈 */

class DashboardLoader {
    constructor() {
        this.templatesPath = '/static/templates/user/';
        this.modulesPath = '/static/modules/user/';
        this.loadedModules = new Set();
    }

    // 템플릿 로드
    async loadTemplate(templateName) {
        try {
            const response = await fetch(`${this.templatesPath}${templateName}.html`);
            if (!response.ok) {
                throw new Error(`템플릿 로드 실패: ${templateName}`);
            }
            return await response.text();
        } catch (error) {
            console.error(`템플릿 로드 오류 (${templateName}):`, error);
            return null;
        }
    }

    // 모듈 스크립트 동적 로드
    loadModule(modulePath) {
        if (this.loadedModules.has(modulePath)) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${this.modulesPath}${modulePath}.js`;
            script.onload = () => {
                this.loadedModules.add(modulePath);
                resolve();
            };
            script.onerror = () => {
                reject(new Error(`모듈 로드 실패: ${modulePath}`));
            };
            document.head.appendChild(script);
        });
    }

    // 네비게이션 로드
    async loadNavigation() {
        const navHTML = await this.loadTemplate('navigation');
        if (navHTML) {
            const navContainer = document.getElementById('navigation-container');
            if (navContainer) {
                navContainer.innerHTML = navHTML;
                this.initNavigation();
            }
        }
    }

    // 네비게이션 초기화
    initNavigation() {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        const navItems = document.querySelectorAll('.nav-item');

        navItems.forEach(item => {
            const page = item.dataset.page;
            if (page === currentPage || (currentPage === '' && page === 'dashboard')) {
                item.classList.add('active');
            }

            item.addEventListener('click', (e) => {
                if (!item.classList.contains('admin-item')) {
                    e.preventDefault();
                    this.navigateTo(page);
                }
            });
        });
    }

    // KPI 카드 로드
    async loadKPICards() {
        const kpiHTML = await this.loadTemplate('kpi-cards');
        if (kpiHTML) {
            const kpiContainer = document.getElementById('kpi-container');
            if (kpiContainer) {
                kpiContainer.innerHTML = kpiHTML;

                // KPI 관리자 모듈 로드
                await this.loadModule('kpi/kpi-manager');
                if (window.kpiManager) {
                    window.kpiManager.init();
                }
            }
        }
    }

    // 차트 섹션 로드
    async loadCharts() {
        // 차트 관리자 모듈 로드
        await this.loadModule('charts/chart-manager');
        if (window.chartManager) {
            window.chartManager.initCharts();
        }
    }

    // 인사이트 패널 로드
    async loadInsights() {
        const insightHTML = await this.loadTemplate('insights-panel');
        if (insightHTML) {
            const insightContainer = document.getElementById('insights-container');
            if (insightContainer) {
                insightContainer.innerHTML = insightHTML;
            }
        }
    }

    // 페이지 네비게이션
    navigateTo(page) {
        const pages = {
            'dashboard': 'dashboard.html',
            'ingredients': 'ingredients_management.html',
            'meals': 'meal_plans.html',
            'suppliers': 'suppliers.html',
            'reports': 'reports.html'
        };

        if (pages[page]) {
            window.location.href = pages[page];
        }
    }

    // 대시보드 초기화
    async initDashboard() {
        try {
            // 1. 네비게이션 로드
            await this.loadNavigation();

            // 2. KPI 카드 로드
            await this.loadKPICards();

            // 3. 차트 로드
            await this.loadCharts();

            // 4. 인사이트 로드
            await this.loadInsights();

            // 5. 날짜 표시
            const dateElem = document.getElementById('current-date');
            if (dateElem) {
                dateElem.textContent = new Date().toLocaleDateString('ko-KR');
            }

            console.log('대시보드 초기화 완료');

        } catch (error) {
            console.error('대시보드 초기화 오류:', error);
        }
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    const loader = new DashboardLoader();
    loader.initDashboard();
});