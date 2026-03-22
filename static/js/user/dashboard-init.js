/* 사용자 대시보드 초기화 스크립트 */

// 현재 날짜 표시
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

function initializeDashboard() {
    // 현재 날짜 표시
    const currentDateElem = document.getElementById('current-date');
    if (currentDateElem) {
        currentDateElem.textContent = new Date().toLocaleDateString('ko-KR');
    }

    // 차트 초기화
    initializeCharts();

    // 실시간 데이터 업데이트
    startRealtimeUpdates();
}

function initializeCharts() {
    // 차트 데이터 생성
    const last15Days = [];
    const mealCounts = [];
    const revenues = [];

    // 지난 15일 데이터 생성
    for (let i = 14; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        last15Days.push(date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));

        const baseCount = 2200 + Math.random() * 600;
        mealCounts.push(Math.floor(baseCount));
        revenues.push(Math.floor(baseCount * 2000));
    }

    // 1. 식수 추이 차트
    const mealTrendCtx = document.getElementById('mealTrendChart');
    if (mealTrendCtx) {
        new Chart(mealTrendCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: last15Days,
                datasets: [
                    {
                        label: '총 식수',
                        data: mealCounts,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: '조식',
                        data: mealCounts.map(count => Math.floor(count * 0.3)),
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: '중식',
                        data: mealCounts.map(count => Math.floor(count * 0.45)),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: '석식',
                        data: mealCounts.map(count => Math.floor(count * 0.25)),
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString() + '명';
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + '명';
                            }
                        }
                    }
                }
            }
        });
    }

    // 2. 식사시간별 분포 도넛 차트
    const mealTypeCtx = document.getElementById('mealTypeChart');
    if (mealTypeCtx) {
        new Chart(mealTypeCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['중식', '조식', '석식', '야식'],
                datasets: [{
                    data: [45, 30, 22, 3],
                    backgroundColor: [
                        '#10b981',
                        '#f59e0b',
                        '#8b5cf6',
                        '#ef4444'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.label + ': ' + context.parsed + '%';
                            }
                        }
                    }
                }
            }
        });
    }

    // 3. 매출 차트
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
        new Chart(revenueCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: last15Days,
                datasets: [{
                    label: '일별 매출',
                    data: revenues,
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderColor: '#22c55e',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₩' + (value / 1000000).toFixed(1) + 'M';
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '매출: ₩' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    // 4. 탭별 매출 비중 차트
    const tabRevenueCtx = document.getElementById('tabRevenueChart');
    if (tabRevenueCtx) {
        new Chart(tabRevenueCtx.getContext('2d'), {
            type: 'pie',
            data: {
                labels: ['도시락', '운반', '학교', '요양원'],
                datasets: [{
                    data: [49.0, 32.7, 14.3, 4.0],
                    backgroundColor: [
                        '#3b82f6',
                        '#f59e0b',
                        '#10b981',
                        '#ef4444'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.label + ': ' + context.parsed + '%';
                            }
                        }
                    }
                }
            }
        });
    }
}

// 업체별 식자재 현황 로드 함수
async function loadSupplierIngredients() {
    const statusDiv = document.getElementById('ingredient-status');
    const table = document.getElementById('supplier-ingredients-table');
    const tbody = table ? table.querySelector('tbody') : null;

    if (!statusDiv || !tbody) return;

    try {
        statusDiv.innerHTML = '<div style="color: #007bff;">⏳ 식자재 현황을 로드하는 중...</div>';

        // API 호출
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-summary');
        const data = await response.json();

        if (data.success) {
            statusDiv.innerHTML = `<div style="color: #28a745;">✅ 식자재 데이터 로드 완료</div>`;

            // 최근 식자재 표시
            if (data.recent && data.recent.length > 0) {
                tbody.innerHTML = data.recent.slice(0, 10).map(ingredient => `
                    <tr>
                        <td>${ingredient.name || '-'}</td>
                        <td>${ingredient.category || '-'}</td>
                        <td>${ingredient.supplier || '-'}</td>
                        <td>-</td>
                        <td>-</td>
                    </tr>
                `).join('');
            }
        } else {
            statusDiv.innerHTML = `<div style="color: #dc3545;">❌ 데이터 로드 실패</div>`;
            tbody.innerHTML = '<tr><td colspan="5">데이터를 불러올 수 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('Error loading ingredients:', error);
        statusDiv.innerHTML = `<div style="color: #dc3545;">❌ 네트워크 오류</div>`;
        tbody.innerHTML = '<tr><td colspan="5">네트워크 연결을 확인해주세요.</td></tr>';
    }
}

// 실시간 데이터 업데이트
function startRealtimeUpdates() {
    setInterval(() => {
        const todayMeals = document.getElementById('today-meals');
        if (todayMeals) {
            const currentValue = parseInt(todayMeals.textContent.replace(',', ''));
            const newValue = currentValue + Math.floor(Math.random() * 20 - 10);
            todayMeals.textContent = newValue.toLocaleString();

            const todayRevenue = document.getElementById('today-revenue');
            if (todayRevenue) {
                todayRevenue.textContent = '₩' + (newValue * 2000).toLocaleString();
            }
        }
    }, 30000);
}

// 페이지 로드 시 식자재 데이터 로드
window.addEventListener('load', () => {
    loadSupplierIngredients();
});