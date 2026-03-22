/* KPI 관리 모듈 */

class KPIManager {
    constructor() {
        this.apiUrl = window.CONFIG?.API_BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}';
        this.refreshInterval = 30000; // 30초
        this.intervalId = null;
    }

    // KPI 데이터 로드
    async loadKPIData() {
        try {
            const response = await fetch(`${this.apiUrl}/api/dashboard/kpi`);
            if (!response.ok) {
                throw new Error('KPI 데이터 로드 실패');
            }

            const data = await response.json();
            this.updateKPICards(data);
            return data;
        } catch (error) {
            console.error('KPI 로드 오류:', error);
            // 폴백: 로컬 데이터 사용
            this.loadMockKPIData();
        }
    }

    // Mock 데이터 (API 연결 전)
    loadMockKPIData() {
        const mockData = {
            todayMeals: 2567,
            mealsChange: 5.2,
            todayRevenue: 5134000,
            revenueChange: 3.5,
            avgMealPrice: 2000,
            priceChange: -1.2,
            costRatio: 68.5,
            costChange: 0.5
        };

        this.updateKPICards(mockData);
    }

    // KPI 카드 업데이트
    updateKPICards(data) {
        // 오늘 식수
        const mealsElem = document.getElementById('today-meals');
        if (mealsElem) {
            mealsElem.textContent = (data.todayMeals || 0).toLocaleString();
        }

        // 식수 변화율
        const mealsChangeElem = document.getElementById('meals-change');
        if (mealsChangeElem) {
            this.updateChangeIndicator(mealsChangeElem, data.mealsChange || 0);
        }

        // 오늘 매출
        const revenueElem = document.getElementById('today-revenue');
        if (revenueElem) {
            revenueElem.textContent = '₩' + (data.todayRevenue || 0).toLocaleString();
        }

        // 매출 변화율
        const revenueChangeElem = document.getElementById('revenue-change');
        if (revenueChangeElem) {
            this.updateChangeIndicator(revenueChangeElem, data.revenueChange || 0);
        }

        // 평균 식단가
        const priceElem = document.getElementById('avg-meal-price');
        if (priceElem) {
            priceElem.textContent = '₩' + (data.avgMealPrice || 0).toLocaleString();
        }

        // 가격 변화율
        const priceChangeElem = document.getElementById('price-change');
        if (priceChangeElem) {
            this.updateChangeIndicator(priceChangeElem, data.priceChange || 0);
        }

        // 원가율
        const costElem = document.getElementById('cost-ratio');
        if (costElem) {
            costElem.textContent = (data.costRatio || 0).toFixed(1) + '%';
        }

        // 원가율 변화
        const costChangeElem = document.getElementById('cost-change');
        if (costChangeElem) {
            this.updateChangeIndicator(costChangeElem, data.costChange || 0);
        }
    }

    // 변화율 표시 업데이트
    updateChangeIndicator(element, value) {
        const arrow = value >= 0 ? '↑' : '↓';
        const className = value >= 0 ? 'positive' : 'negative';

        element.className = `kpi-change ${className}`;
        element.innerHTML = `<span>${arrow} ${Math.abs(value).toFixed(1)}%</span>`;
    }

    // 자동 새로고침 시작
    startAutoRefresh() {
        this.stopAutoRefresh(); // 기존 인터벌 정리

        this.intervalId = setInterval(() => {
            this.loadKPIData();
        }, this.refreshInterval);
    }

    // 자동 새로고침 중지
    stopAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    // 초기화
    init() {
        // 초기 데이터 로드
        this.loadKPIData();

        // 자동 새로고침 시작
        this.startAutoRefresh();

        // 페이지 벗어날 때 정리
        window.addEventListener('beforeunload', () => {
            this.stopAutoRefresh();
        });
    }
}

// 전역 인스턴스 생성
window.kpiManager = new KPIManager();