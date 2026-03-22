/* 차트 관리 모듈 */

class ChartManager {
    constructor() {
        this.charts = {};
        this.chartConfig = {
            mealTrend: null,
            mealType: null,
            revenue: null,
            tabRevenue: null
        };
    }

    // 차트 초기화
    initCharts() {
        this.initMealTrendChart();
        this.initMealTypeChart();
        this.initRevenueChart();
        this.initTabRevenueChart();
    }

    // 식수 추이 차트
    initMealTrendChart() {
        const ctx = document.getElementById('mealTrendChart');
        if (!ctx) return;

        const { labels, data } = this.generateTrendData();

        this.charts.mealTrend = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '총 식수',
                        data: data.total,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: '조식',
                        data: data.breakfast,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: '중식',
                        data: data.lunch,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: '석식',
                        data: data.dinner,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    }
                ]
            },
            options: this.getLineChartOptions()
        });
    }

    // 식사 타입별 분포 차트
    initMealTypeChart() {
        const ctx = document.getElementById('mealTypeChart');
        if (!ctx) return;

        this.charts.mealType = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['중식', '조식', '석식', '야식'],
                datasets: [{
                    data: [45, 30, 22, 3],
                    backgroundColor: ['#10b981', '#f59e0b', '#8b5cf6', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: this.getDoughnutChartOptions()
        });
    }

    // 매출 차트
    initRevenueChart() {
        const ctx = document.getElementById('revenueChart');
        if (!ctx) return;

        const { labels, revenues } = this.generateRevenueData();

        this.charts.revenue = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '일별 매출',
                    data: revenues,
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderColor: '#22c55e',
                    borderWidth: 1
                }]
            },
            options: this.getBarChartOptions()
        });
    }

    // 사업장별 매출 차트
    initTabRevenueChart() {
        const ctx = document.getElementById('tabRevenueChart');
        if (!ctx) return;

        this.charts.tabRevenue = new Chart(ctx.getContext('2d'), {
            type: 'pie',
            data: {
                labels: ['도시락', '운반', '학교', '요양원'],
                datasets: [{
                    data: [49.0, 32.7, 14.3, 4.0],
                    backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#ef4444'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: this.getPieChartOptions()
        });
    }

    // 차트 데이터 생성 메서드들
    generateTrendData() {
        const labels = [];
        const total = [];
        const breakfast = [];
        const lunch = [];
        const dinner = [];

        for (let i = 14; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));

            const baseCount = 2200 + Math.random() * 600;
            total.push(Math.floor(baseCount));
            breakfast.push(Math.floor(baseCount * 0.3));
            lunch.push(Math.floor(baseCount * 0.45));
            dinner.push(Math.floor(baseCount * 0.25));
        }

        return { labels, data: { total, breakfast, lunch, dinner } };
    }

    generateRevenueData() {
        const labels = [];
        const revenues = [];

        for (let i = 14; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));

            const baseRevenue = 4400000 + Math.random() * 1200000;
            revenues.push(Math.floor(baseRevenue));
        }

        return { labels, revenues };
    }

    // 차트 옵션 메서드들
    getLineChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => value.toLocaleString() + '명'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => context.dataset.label + ': ' + context.parsed.y.toLocaleString() + '명'
                    }
                }
            }
        };
    }

    getDoughnutChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => context.label + ': ' + context.parsed + '%'
                    }
                }
            }
        };
    }

    getBarChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => '₩' + (value / 1000000).toFixed(1) + 'M'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => '매출: ₩' + context.parsed.y.toLocaleString()
                    }
                }
            }
        };
    }

    getPieChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => context.label + ': ' + context.parsed + '%'
                    }
                }
            }
        };
    }

    // 차트 업데이트
    updateChart(chartName, newData) {
        if (this.charts[chartName]) {
            this.charts[chartName].data = newData;
            this.charts[chartName].update();
        }
    }

    // 차트 제거
    destroyChart(chartName) {
        if (this.charts[chartName]) {
            this.charts[chartName].destroy();
            delete this.charts[chartName];
        }
    }

    // 모든 차트 제거
    destroyAll() {
        Object.keys(this.charts).forEach(chartName => {
            this.destroyChart(chartName);
        });
    }
}

// 전역 인스턴스 생성
window.chartManager = new ChartManager();