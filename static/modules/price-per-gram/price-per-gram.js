/**
 * g당 단가 통합 모듈
 * - 대시보드: 읽기전용 통계 카드
 * - 식자재관리: 작업 워크스페이스
 */

class PricePerGramModule {
    constructor() {
        this.init();
    }

    async init() {
        // 현재 페이지 컨텍스트에 따라 적절한 모듈 초기화
        this.initDashboardStats();
        this.initIngredientsWorkspace();
    }

    // 대시보드 통계 카드 초기화
    initDashboardStats() {
        // 대시보드 페이지이고 KPI 그리드가 있는 경우에만
        if (document.querySelector('.kpi-grid')) {
            this.initDashboardPriceStats();
        }
    }

    // 식자재 관리 워크스페이스 초기화  
    initIngredientsWorkspace() {
        // 식자재 관리 페이지에서 전용 워크스페이스 추가
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && 
                        (node.id === 'ingredients-page' || 
                         node.id === 'ingredients-content' ||
                         node.classList?.contains('ingredients-section'))) {
                        this.addIngredientsWorkspace();
                    }
                });
            });
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        
        // 이미 존재하는 경우 바로 추가
        if (document.getElementById('ingredients-page') || document.getElementById('ingredients-content')) {
            setTimeout(() => this.addIngredientsWorkspace(), 100);
        }
    }

    // 대시보드 통계 카드 추가
    async initDashboardPriceStats() {
        const kpiGrid = document.querySelector('.kpi-grid');
        if (!kpiGrid) return;

        // 기존 카드가 있으면 제거
        const existingCard = kpiGrid.querySelector('.kpi-card.price-analysis');
        if (existingCard) existingCard.remove();

        // g당 단가 통계 카드 생성
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

        // 스타일 추가
        this.addDashboardStyles();
        
        // KPI 그리드에 추가
        kpiGrid.appendChild(priceCard);
        
        // 클릭 이벤트 - 식자재 관리로 이동
        priceCard.style.cursor = 'pointer';
        priceCard.addEventListener('click', () => {
            this.navigateToIngredients();
        });

        // 호버 효과
        priceCard.addEventListener('mouseenter', () => {
            priceCard.style.transform = 'translateY(-5px) scale(1.02)';
        });
        
        priceCard.addEventListener('mouseleave', () => {
            priceCard.style.transform = 'translateY(-5px)';
        });

        // 통계 로드 및 자동 업데이트
        this.loadDashboardStats();
        setInterval(() => this.loadDashboardStats(), 300000); // 5분마다 업데이트
    }

    // 식자재 관리 워크스페이스 추가
    addIngredientsWorkspace() {
        // admin 페이지의 식자재 섹션 확인
        const ingredientsPage = document.getElementById('ingredients-page');
        if (!ingredientsPage) return;

        // 페이지가 숨겨진 상태면 나중에 다시 시도
        if (ingredientsPage.classList.contains('hidden')) {
            setTimeout(() => this.addIngredientsWorkspace(), 500);
            return;
        }

        // 헤더 다음에 워크스페이스를 삽입할 위치 찾기
        const pageHeader = ingredientsPage.querySelector('.page-header');
        if (!pageHeader) return;

        // 기존 워크스페이스 제거
        const existingWorkspace = document.getElementById('price-per-gram-workspace');
        if (existingWorkspace) existingWorkspace.remove();

        // 워크스페이스 생성
        const workspace = document.createElement('div');
        workspace.id = 'price-per-gram-workspace';
        workspace.innerHTML = `
            <div class="workspace-card">
                <div class="workspace-header">
                    <div class="workspace-icon">⚖️</div>
                    <div class="workspace-title">g당 단가 관리</div>
                    <div class="workspace-subtitle">식자재 단가 효율성 분석</div>
                </div>
                
                <div class="workspace-content">
                    <div class="stats-row" id="workspace-stats">
                        <div class="stat-card loading">
                            <div class="loading-spinner"></div>
                            <div class="stat-label">통계 로딩중...</div>
                        </div>
                    </div>
                    
                    <div class="workspace-actions">
                        <button class="btn-primary" id="calculate-price-btn" onclick="window.priceModule.calculatePricePerGram()">
                            <span class="btn-icon">⚡</span>
                            g당 단가 계산
                        </button>
                        <button class="btn-secondary" onclick="window.priceModule.loadWorkspaceStats()">
                            <span class="btn-icon">🔄</span>
                            통계 새로고침
                        </button>
                    </div>
                    
                    <div class="workspace-results" id="calculation-results"></div>
                </div>
            </div>
        `;

        // 스타일 추가
        this.addWorkspaceStyles();
        
        // 헤더 다음에 워크스페이스 추가
        pageHeader.insertAdjacentElement('afterend', workspace);
        
        // 통계 로드
        this.loadWorkspaceStats();
        
        console.log('✅ 식자재 g당 단가 워크스페이스가 추가되었습니다.');
    }

    // 대시보드 통계 로드
    async loadDashboardStats() {
        try {
            const response = await fetch('/price-per-gram-stats');
            const stats = await response.json();
            
            this.updateDashboardDisplay(stats);
        } catch (error) {
            console.error('대시보드 통계 로드 실패:', error);
            this.showDashboardError();
        }
    }

    // 워크스페이스 통계 로드
    async loadWorkspaceStats() {
        const statsContainer = document.getElementById('workspace-stats');
        if (!statsContainer) return;

        try {
            const response = await fetch('/price-per-gram-stats');
            const stats = await response.json();
            
            const coverage = stats.coverage_percentage;
            const coverageColor = coverage >= 85 ? '#22c55e' : coverage >= 75 ? '#3b82f6' : coverage >= 60 ? '#f59e0b' : '#ef4444';
            
            statsContainer.innerHTML = `
                <div class="stat-card">
                    <div class="stat-number">${stats.total_ingredients.toLocaleString()}</div>
                    <div class="stat-label">전체 식자재</div>
                </div>
                <div class="stat-card accent" style="border-left-color: ${coverageColor};">
                    <div class="stat-number" style="color: ${coverageColor};">${stats.calculated_count.toLocaleString()}</div>
                    <div class="stat-label">계산 완료 (${coverage}%)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${(stats.total_ingredients - stats.calculated_count).toLocaleString()}</div>
                    <div class="stat-label">미계산 항목</div>
                </div>
                ${stats.highest_price ? `
                    <div class="stat-card">
                        <div class="stat-number">${stats.highest_price.price_per_gram.toLocaleString()}</div>
                        <div class="stat-label">최고 단가 (원/g)</div>
                    </div>
                ` : ''}
            `;
        } catch (error) {
            console.error('워크스페이스 통계 로드 실패:', error);
            statsContainer.innerHTML = `
                <div class="stat-card error">
                    <div class="stat-number">--</div>
                    <div class="stat-label">로드 실패</div>
                </div>
            `;
        }
    }

    // 대시보드 표시 업데이트
    updateDashboardDisplay(stats) {
        const accuracyElement = document.getElementById('price-accuracy');
        const statusElement = document.getElementById('price-status');
        
        if (!accuracyElement || !statusElement) return;

        const coverage = stats.coverage_percentage;
        const calculated = stats.calculated_count;

        accuracyElement.textContent = `${coverage}%`;

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

        const card = document.querySelector('.kpi-card.price-analysis');
        if (card) {
            card.className = `kpi-card price-analysis ${statusClass}`;
        }
    }

    // g당 단가 계산 실행
    async calculatePricePerGram() {
        const button = document.getElementById('calculate-price-btn');
        const resultsContainer = document.getElementById('calculation-results');
        
        if (!button || !resultsContainer) return;

        // 버튼 비활성화
        button.disabled = true;
        button.innerHTML = '<span class="btn-icon loading-spinner"></span>계산 중...';
        
        // 진행 상태 표시
        resultsContainer.innerHTML = `
            <div class="result-card progress">
                <div class="progress-header">
                    <div class="loading-spinner"></div>
                    <h4>g당 단가 계산 진행 중</h4>
                </div>
                <p>식자재 규격 정보를 분석하고 g당 단가를 계산하고 있습니다. 잠시만 기다려주세요.</p>
            </div>
        `;

        try {
            const response = await fetch('/calculate-price-per-gram', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                const successRate = ((result.calculated_count / result.total_ingredients) * 100).toFixed(1);
                const successColor = successRate >= 80 ? '#22c55e' : '#f59e0b';
                
                resultsContainer.innerHTML = `
                    <div class="result-card success">
                        <div class="result-header">
                            <div class="result-icon">✅</div>
                            <h4>계산 완료!</h4>
                        </div>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="result-label">전체 항목:</span>
                                <span class="result-value">${result.total_ingredients.toLocaleString()}개</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-label">계산 성공:</span>
                                <span class="result-value success">${result.calculated_count.toLocaleString()}개</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-label">새로 계산:</span>
                                <span class="result-value new">${result.new_calculated.toLocaleString()}개</span>
                            </div>
                            <div class="result-stat">
                                <span class="result-label">성공률:</span>
                                <span class="result-value" style="color: ${successColor};">${successRate}%</span>
                            </div>
                        </div>
                        <p class="result-message">${result.message}</p>
                    </div>
                `;
                
                // 통계 새로고침
                setTimeout(() => {
                    this.loadWorkspaceStats();
                    this.loadDashboardStats();
                }, 1000);
                
            } else {
                throw new Error(result.message || '계산에 실패했습니다.');
            }
        } catch (error) {
            resultsContainer.innerHTML = `
                <div class="result-card error">
                    <div class="result-header">
                        <div class="result-icon">❌</div>
                        <h4>계산 실패</h4>
                    </div>
                    <p class="result-message">${error.message}</p>
                </div>
            `;
        } finally {
            // 버튼 복원
            button.disabled = false;
            button.innerHTML = '<span class="btn-icon">⚡</span>g당 단가 계산';
        }
    }

    // 식자재 관리로 이동
    navigateToIngredients() {
        // 먼저 네비게이션 클릭 시도
        const ingredientsNav = document.querySelector('[data-section="ingredients"]') ||
                             document.querySelector('a[href*="ingredients"]') ||
                             document.querySelector('[onclick*="ingredients"]');
        
        if (ingredientsNav) {
            ingredientsNav.click();
        } else {
            // showPage 함수 호출 시도
            if (window.showPage) {
                window.showPage('ingredients');
            }
        }
    }

    // 대시보드 에러 표시
    showDashboardError() {
        const accuracyElement = document.getElementById('price-accuracy');
        const statusElement = document.getElementById('price-status');
        
        if (accuracyElement) accuracyElement.textContent = '--';
        if (statusElement) {
            statusElement.className = 'kpi-change error';
            statusElement.innerHTML = '<span>❌ 로드 실패</span>';
        }
    }

    // 대시보드 스타일 추가
    addDashboardStyles() {
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
            
            .kpi-change.excellent { background: #dcfce7; color: #15803d; }
            .kpi-change.good { background: #dbeafe; color: #1d4ed8; }
            .kpi-change.warning { background: #fef3c7; color: #d97706; }
            .kpi-change.needs-work { background: #fee2e2; color: #dc2626; }
            .kpi-change.error { background: #fecaca; color: #991b1b; }
        `;
        document.head.appendChild(style);
    }

    // 워크스페이스 스타일 추가
    addWorkspaceStyles() {
        if (document.querySelector('#price-workspace-css')) return;

        const style = document.createElement('style');
        style.id = 'price-workspace-css';
        style.textContent = `
            .workspace-card {
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                margin-bottom: 25px;
                overflow: hidden;
                border: 1px solid #e2e8f0;
            }
            
            .workspace-header {
                background: linear-gradient(135deg, #667eea, #764ba2);
                padding: 20px;
                color: white;
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .workspace-icon {
                font-size: 24px;
                background: rgba(255,255,255,0.2);
                padding: 8px;
                border-radius: 8px;
            }
            
            .workspace-title {
                font-size: 20px;
                font-weight: 600;
                margin: 0;
            }
            
            .workspace-subtitle {
                font-size: 14px;
                opacity: 0.9;
                margin-left: auto;
            }
            
            .workspace-content {
                padding: 20px;
            }
            
            .stats-row {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
                margin-bottom: 25px;
            }
            
            .stat-card {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 15px;
                text-align: center;
                border-left: 4px solid #64748b;
            }
            
            .stat-card.accent {
                background: #f0f9ff;
                border-color: #e0f2fe;
            }
            
            .stat-card.loading, .stat-card.error {
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                min-height: 80px;
            }
            
            .stat-card.error {
                background: #fef2f2;
                border-left-color: #ef4444;
            }
            
            .stat-number {
                font-size: 24px;
                font-weight: 700;
                color: #1e293b;
                margin-bottom: 5px;
            }
            
            .stat-label {
                font-size: 12px;
                color: #64748b;
                font-weight: 500;
            }
            
            .workspace-actions {
                display: flex;
                gap: 12px;
                margin-bottom: 20px;
            }
            
            .btn-primary, .btn-secondary {
                padding: 12px 20px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.3s ease;
                font-size: 14px;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #22c55e, #16a34a);
                color: white;
            }
            
            .btn-primary:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(34, 197, 94, 0.4);
            }
            
            .btn-secondary {
                background: #f1f5f9;
                color: #475569;
                border: 1px solid #e2e8f0;
            }
            
            .btn-secondary:hover {
                background: #e2e8f0;
            }
            
            .btn-primary:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .btn-icon {
                font-size: 14px;
            }
            
            .result-card {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 20px;
                margin-top: 15px;
            }
            
            .result-card.success {
                background: #f0fdf4;
                border-color: #bbf7d0;
            }
            
            .result-card.error {
                background: #fef2f2;
                border-color: #fecaca;
            }
            
            .result-card.progress {
                background: #eff6ff;
                border-color: #dbeafe;
            }
            
            .result-header, .progress-header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 15px;
            }
            
            .result-icon {
                font-size: 20px;
            }
            
            .result-header h4, .progress-header h4 {
                margin: 0;
                color: #1e293b;
            }
            
            .result-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 10px;
                margin: 15px 0;
            }
            
            .result-stat {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
            }
            
            .result-label {
                color: #64748b;
                font-size: 14px;
            }
            
            .result-value {
                font-weight: 600;
                color: #1e293b;
            }
            
            .result-value.success { color: #16a34a; }
            .result-value.new { color: #0ea5e9; }
            
            .result-message {
                color: #64748b;
                font-style: italic;
                margin: 10px 0 0 0;
            }
            
            .loading-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid #f3f3f3;
                border-top: 2px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* 반응형 */
            @media (max-width: 768px) {
                .workspace-header {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 10px;
                }
                
                .workspace-subtitle {
                    margin-left: 0;
                }
                
                .workspace-actions {
                    flex-direction: column;
                }
                
                .stats-row {
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// 전역 인스턴스 생성
window.priceModule = new PricePerGramModule();

// 전역에서 사용 가능하도록 export
window.PricePerGramModule = PricePerGramModule;