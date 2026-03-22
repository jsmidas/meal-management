/**
 * 대시보드용 g당 단가 통계 카드
 * 읽기 전용 - 현황만 표시하고 식자재 관리로 연결
 */

class DashboardPriceStats {
    constructor() {
        this.init();
    }

    async init() {
        await this.addStatsCard();
        this.loadStats();
        
        // 5분마다 자동 업데이트
        setInterval(() => this.loadStats(), 300000);
    }

    // 대시보드에 통계 카드 추가
    async addStatsCard() {
        // 기존 KPI 그리드 찾기
        const kpiGrid = document.querySelector('.kpi-grid');
        if (!kpiGrid) {
            console.warn('KPI 그리드를 찾을 수 없습니다.');
            return;
        }

        // g당 단가 카드 생성
        const priceCard = document.createElement('div');
        priceCard.className = 'kpi-card price-analysis';
        priceCard.innerHTML = `
            <div class="kpi-icon">⚖️</div>
            <div class="kpi-value" id="price-accuracy">--%</div>
            <div class="kpi-label">g당 단가 정확도</div>
            <div class="kpi-change" id="price-status">
                <span>데이터 로딩 중...</span>
            </div>
        `;

        // CSS 추가
        this.addStyles();

        // KPI 그리드에 추가
        kpiGrid.appendChild(priceCard);

        // 클릭 시 식자재 관리로 이동
        priceCard.addEventListener('click', () => {
            this.navigateToIngredients();
        });

        // 호버 효과
        priceCard.style.cursor = 'pointer';
        priceCard.addEventListener('mouseenter', () => {
            priceCard.style.transform = 'translateY(-5px) scale(1.02)';
        });
        
        priceCard.addEventListener('mouseleave', () => {
            priceCard.style.transform = 'translateY(-5px)';
        });
    }

    // 통계 로드 및 표시
    async loadStats() {
        try {
            const response = await fetch('/price-per-gram-stats');
            const stats = await response.json();
            
            this.updateStatsDisplay(stats);
        } catch (error) {
            console.error('통계 로드 실패:', error);
            this.showError();
        }
    }

    // 통계 표시 업데이트
    updateStatsDisplay(stats) {
        const accuracyElement = document.getElementById('price-accuracy');
        const statusElement = document.getElementById('price-status');
        
        if (!accuracyElement || !statusElement) return;

        const coverage = stats.coverage_percentage;
        const calculated = stats.calculated_count;
        const total = stats.total_ingredients;

        // 정확도 표시
        accuracyElement.textContent = `${coverage}%`;

        // 상태 메시지 및 색상
        let statusClass, statusMessage;
        
        if (coverage >= 85) {
            statusClass = 'excellent';
            statusMessage = `✅ ${calculated.toLocaleString()}개 완료`;
        } else if (coverage >= 75) {
            statusClass = 'good';
            statusMessage = `✨ ${calculated.toLocaleString()}개 완료`;
        } else if (coverage >= 60) {
            statusClass = 'warning';
            statusMessage = `⚠️ ${calculated.toLocaleString()}개 완료`;
        } else {
            statusClass = 'needs-work';
            statusMessage = `🔄 ${calculated.toLocaleString()}개 완료`;
        }

        statusElement.className = `kpi-change ${statusClass}`;
        statusElement.innerHTML = `<span>${statusMessage}</span>`;

        // 카드 색상 업데이트
        const card = document.querySelector('.kpi-card.price-analysis');
        if (card) {
            card.className = `kpi-card price-analysis ${statusClass}`;
        }

        // 툴팁 추가
        this.addTooltip(card, stats);
    }

    // 상세 툴팁 추가
    addTooltip(card, stats) {
        if (!card || card.querySelector('.price-tooltip')) return;

        const tooltip = document.createElement('div');
        tooltip.className = 'price-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-header">📊 g당 단가 상세 현황</div>
            <div class="tooltip-stats">
                <div class="stat-row">
                    <span>전체 식자재:</span>
                    <strong>${stats.total_ingredients.toLocaleString()}개</strong>
                </div>
                <div class="stat-row">
                    <span>계산 완료:</span>
                    <strong>${stats.calculated_count.toLocaleString()}개</strong>
                </div>
                <div class="stat-row">
                    <span>미계산:</span>
                    <strong>${(stats.total_ingredients - stats.calculated_count).toLocaleString()}개</strong>
                </div>
                ${stats.highest_price ? `
                    <div class="tooltip-divider"></div>
                    <div class="extreme-price">
                        <div class="price-item highest">
                            <span>최고가:</span>
                            <strong>${stats.highest_price.price_per_gram.toLocaleString()}원/g</strong>
                        </div>
                        <div class="price-item lowest">
                            <span>최저가:</span>
                            <strong>${stats.lowest_price.price_per_gram.toFixed(4)}원/g</strong>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="tooltip-footer">
                <small>클릭하여 식자재 관리로 이동 →</small>
            </div>
        `;

        card.appendChild(tooltip);

        // 호버 이벤트
        card.addEventListener('mouseenter', () => {
            tooltip.style.opacity = '1';
            tooltip.style.visibility = 'visible';
        });

        card.addEventListener('mouseleave', () => {
            tooltip.style.opacity = '0';
            tooltip.style.visibility = 'hidden';
        });
    }

    // 에러 상태 표시
    showError() {
        const accuracyElement = document.getElementById('price-accuracy');
        const statusElement = document.getElementById('price-status');
        
        if (accuracyElement) accuracyElement.textContent = '--';
        if (statusElement) {
            statusElement.className = 'kpi-change error';
            statusElement.innerHTML = '<span>❌ 로드 실패</span>';
        }
    }

    // 식자재 관리로 이동
    navigateToIngredients() {
        // ADMIN 페이지 내에서 식자재 관리 섹션으로 이동
        const ingredientsLink = document.querySelector('a[href*="ingredients"]') || 
                              document.querySelector('[onclick*="ingredients"]');
        
        if (ingredientsLink) {
            ingredientsLink.click();
        } else {
            // 직접 페이지 이동
            window.location.href = '/admin#ingredients';
        }
    }

    // 스타일 추가
    addStyles() {
        if (document.querySelector('#dashboard-price-stats-css')) return;

        const style = document.createElement('style');
        style.id = 'dashboard-price-stats-css';
        style.textContent = `
            /* g당 단가 카드 색상 테마 */
            .kpi-card.price-analysis::before {
                background: linear-gradient(90deg, #667eea, #764ba2);
            }

            .kpi-card.price-analysis.excellent::before {
                background: linear-gradient(90deg, #22c55e, #16a085);
            }

            .kpi-card.price-analysis.good::before {
                background: linear-gradient(90deg, #3b82f6, #1e40af);
            }

            .kpi-card.price-analysis.warning::before {
                background: linear-gradient(90deg, #f59e0b, #d97706);
            }

            .kpi-card.price-analysis.needs-work::before {
                background: linear-gradient(90deg, #ef4444, #dc2626);
            }

            .kpi-change.excellent {
                background: #dcfce7;
                color: #15803d;
            }

            .kpi-change.good {
                background: #dbeafe;
                color: #1d4ed8;
            }

            .kpi-change.warning {
                background: #fef3c7;
                color: #d97706;
            }

            .kpi-change.needs-work {
                background: #fee2e2;
                color: #dc2626;
            }

            .kpi-change.error {
                background: #fecaca;
                color: #991b1b;
            }

            /* 툴팁 스타일 */
            .price-tooltip {
                position: absolute;
                top: -10px;
                left: 50%;
                transform: translateX(-50%) translateY(-100%);
                background: white;
                border-radius: 12px;
                padding: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                border: 1px solid #e2e8f0;
                min-width: 280px;
                z-index: 1000;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
                pointer-events: none;
            }

            .price-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 8px solid transparent;
                border-top-color: white;
            }

            .tooltip-header {
                font-weight: 600;
                color: #374151;
                margin-bottom: 15px;
                text-align: center;
                font-size: 16px;
            }

            .tooltip-stats {
                margin-bottom: 15px;
            }

            .stat-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 0;
                font-size: 14px;
            }

            .stat-row span {
                color: #6b7280;
            }

            .stat-row strong {
                color: #374151;
            }

            .tooltip-divider {
                height: 1px;
                background: #e5e7eb;
                margin: 12px 0;
            }

            .extreme-price {
                margin-top: 10px;
            }

            .price-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 0;
                font-size: 13px;
            }

            .price-item.highest strong {
                color: #dc2626;
            }

            .price-item.lowest strong {
                color: #16a34a;
            }

            .tooltip-footer {
                text-align: center;
                padding-top: 10px;
                border-top: 1px solid #f3f4f6;
            }

            .tooltip-footer small {
                color: #9ca3af;
                font-style: italic;
            }

            /* 반응형 */
            @media (max-width: 768px) {
                .price-tooltip {
                    min-width: 250px;
                    left: 10px;
                    right: 10px;
                    transform: translateY(-100%);
                }
            }
        `;

        document.head.appendChild(style);
    }
}

// 대시보드 페이지에서만 초기화
function initDashboardPriceStats() {
    // 현재 페이지가 대시보드인지 확인
    if (window.location.pathname === '/' || 
        window.location.pathname.includes('dashboard') ||
        document.querySelector('.kpi-grid')) {
        
        // KPI 그리드가 로드될 때까지 대기
        const checkAndInit = () => {
            const kpiGrid = document.querySelector('.kpi-grid');
            if (kpiGrid) {
                new DashboardPriceStats();
            } else {
                setTimeout(checkAndInit, 100);
            }
        };
        
        checkAndInit();
    }
}

// DOM 로드 시 자동 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboardPriceStats);
} else {
    initDashboardPriceStats();
}

// 전역에서 사용 가능하도록 export
window.DashboardPriceStats = DashboardPriceStats;