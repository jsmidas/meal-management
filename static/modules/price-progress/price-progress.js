/**
 * 단가 계산 진행률 표시 모듈
 * 실시간 진행률 바와 상태 업데이트 기능 제공
 */

class PriceProgressTracker {
    constructor() {
        this.isTracking = false;
        this.updateInterval = null;
        this.updateIntervalMs = 2000; // 2초마다 업데이트
    }

    /**
     * 진행률 바 HTML 생성
     */
    createProgressBarHTML() {
        return `
            <div id="price-progress-container" class="progress-container" style="display: none;">
                <div class="progress-header">
                    <h4><i class="fas fa-calculator"></i> 단위당 단가 계산 진행률</h4>
                    <button id="close-progress" class="close-btn">×</button>
                </div>

                <div class="progress-stats">
                    <div class="stat-item">
                        <span class="stat-label">진행률:</span>
                        <span id="progress-percentage" class="stat-value">0%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">완료:</span>
                        <span id="completed-items" class="stat-value">0</span>
                        <span class="stat-separator">/</span>
                        <span id="total-items" class="stat-value">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">남은 항목:</span>
                        <span id="remaining-items" class="stat-value">0</span>
                    </div>
                </div>

                <div class="progress-bar-wrapper">
                    <div class="progress-bar">
                        <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="progress-text">
                        <span id="progress-text-value">0%</span>
                    </div>
                </div>

                <div class="progress-details">
                    <div class="detail-item">
                        <i class="fas fa-clock"></i>
                        <span>상태: </span>
                        <span id="calculation-status" class="status-text">대기 중</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-cog fa-spin" id="progress-spinner" style="display: none;"></i>
                        <span>현재 처리: </span>
                        <span id="current-item" class="current-item-text">-</span>
                    </div>
                    <div class="detail-item" id="error-section" style="display: none;">
                        <i class="fas fa-exclamation-triangle text-warning"></i>
                        <span>오류: </span>
                        <span id="error-count" class="error-count">0</span>
                    </div>
                </div>

                <div class="progress-actions">
                    <button id="start-calculation" class="btn btn-primary">
                        <i class="fas fa-play"></i> 계산 시작
                    </button>
                    <button id="refresh-progress" class="btn btn-secondary">
                        <i class="fas fa-refresh"></i> 새로고침
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 진행률 바 스타일 생성
     */
    createProgressBarCSS() {
        return `
            <style id="price-progress-styles">
                .progress-container {
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                    margin: 20px 0;
                    padding: 20px;
                    border: 1px solid #e0e6ed;
                }

                .progress-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #f0f2f5;
                    padding-bottom: 15px;
                }

                .progress-header h4 {
                    color: #2c3e50;
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                }

                .progress-header h4 i {
                    color: #3498db;
                    margin-right: 8px;
                }

                .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    color: #95a5a6;
                    cursor: pointer;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    transition: all 0.3s ease;
                }

                .close-btn:hover {
                    background: #ecf0f1;
                    color: #e74c3c;
                }

                .progress-stats {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    gap: 15px;
                }

                .stat-item {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 10px 15px;
                    background: #f8f9fa;
                    border-radius: 8px;
                    border-left: 4px solid #3498db;
                }

                .stat-label {
                    font-weight: 600;
                    color: #34495e;
                    font-size: 14px;
                }

                .stat-value {
                    font-weight: 700;
                    color: #2c3e50;
                    font-size: 16px;
                }

                .stat-separator {
                    color: #95a5a6;
                    margin: 0 2px;
                }

                .progress-bar-wrapper {
                    position: relative;
                    margin-bottom: 20px;
                }

                .progress-bar {
                    width: 100%;
                    height: 30px;
                    background: #ecf0f1;
                    border-radius: 15px;
                    overflow: hidden;
                    position: relative;
                    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
                }

                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #3498db 0%, #2980b9 50%, #27ae60 100%);
                    border-radius: 15px;
                    transition: width 0.8s ease-in-out;
                    position: relative;
                    overflow: hidden;
                }

                .progress-fill::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(45deg,
                        rgba(255,255,255,0.2) 25%,
                        transparent 25%,
                        transparent 50%,
                        rgba(255,255,255,0.2) 50%,
                        rgba(255,255,255,0.2) 75%,
                        transparent 75%);
                    background-size: 20px 20px;
                    animation: progress-stripe 1s linear infinite;
                }

                @keyframes progress-stripe {
                    0% { background-position: 0 0; }
                    100% { background-position: 20px 0; }
                }

                .progress-text {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-weight: bold;
                    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
                    font-size: 14px;
                    pointer-events: none;
                }

                .progress-details {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 20px;
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 8px;
                }

                .detail-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                }

                .detail-item i {
                    width: 16px;
                    color: #3498db;
                }

                .status-text {
                    font-weight: 600;
                    color: #27ae60;
                }

                .current-item-text {
                    color: #34495e;
                    font-style: italic;
                    max-width: 300px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .error-count {
                    color: #e74c3c;
                    font-weight: 600;
                }

                .progress-actions {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                }

                .progress-actions .btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }

                .btn-primary {
                    background: #3498db;
                    color: white;
                }

                .btn-primary:hover {
                    background: #2980b9;
                    transform: translateY(-2px);
                }

                .btn-secondary {
                    background: #95a5a6;
                    color: white;
                }

                .btn-secondary:hover {
                    background: #7f8c8d;
                    transform: translateY(-2px);
                }

                .text-warning {
                    color: #f39c12;
                }

                /* 반응형 */
                @media (max-width: 768px) {
                    .progress-stats {
                        flex-direction: column;
                    }

                    .stat-item {
                        justify-content: space-between;
                    }

                    .progress-actions {
                        flex-direction: column;
                    }
                }
            </style>
        `;
    }

    /**
     * 진행률 바 초기화
     */
    init(containerId = 'main-content') {
        // 스타일 추가
        if (!document.getElementById('price-progress-styles')) {
            document.head.insertAdjacentHTML('beforeend', this.createProgressBarCSS());
        }

        // HTML 추가
        const container = document.getElementById(containerId);
        if (container && !document.getElementById('price-progress-container')) {
            container.insertAdjacentHTML('afterbegin', this.createProgressBarHTML());
            this.bindEvents();
        }
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // 닫기 버튼
        document.getElementById('close-progress')?.addEventListener('click', () => {
            this.hide();
        });

        // 계산 시작 버튼
        document.getElementById('start-calculation')?.addEventListener('click', () => {
            this.startCalculation();
        });

        // 새로고침 버튼
        document.getElementById('refresh-progress')?.addEventListener('click', () => {
            this.updateProgress();
        });
    }

    /**
     * 진행률 바 표시
     */
    show() {
        const container = document.getElementById('price-progress-container');
        if (container) {
            container.style.display = 'block';
            this.startTracking();
        }
    }

    /**
     * 진행률 바 숨기기
     */
    hide() {
        const container = document.getElementById('price-progress-container');
        if (container) {
            container.style.display = 'none';
            this.stopTracking();
        }
    }

    /**
     * 실시간 추적 시작
     */
    startTracking() {
        if (this.isTracking) return;

        this.isTracking = true;
        this.updateProgress(); // 즉시 업데이트

        this.updateInterval = setInterval(() => {
            this.updateProgress();
        }, this.updateIntervalMs);
    }

    /**
     * 실시간 추적 중지
     */
    stopTracking() {
        this.isTracking = false;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * 진행률 업데이트
     */
    async updateProgress() {
        try {
            const response = await fetch('/api/admin/batch-progress');
            const data = await response.json();

            if (data.success) {
                this.updateProgressUI(data);
            } else {
                console.error('진행률 조회 실패:', data.error);
            }
        } catch (error) {
            console.error('진행률 업데이트 오류:', error);
        }
    }

    /**
     * UI 업데이트
     */
    updateProgressUI(data) {
        // 진행률
        const progressPercentage = Math.round(data.progress_percentage);
        document.getElementById('progress-percentage').textContent = `${progressPercentage}%`;
        document.getElementById('progress-text-value').textContent = `${progressPercentage}%`;
        document.getElementById('progress-fill').style.width = `${progressPercentage}%`;

        // 통계
        document.getElementById('completed-items').textContent = data.completed_items.toLocaleString();
        document.getElementById('total-items').textContent = data.total_items.toLocaleString();
        document.getElementById('remaining-items').textContent = data.remaining_items.toLocaleString();

        // 상태
        const statusText = data.is_running ? '계산 중...' : '완료';
        document.getElementById('calculation-status').textContent = statusText;

        // 스피너
        const spinner = document.getElementById('progress-spinner');
        if (data.is_running) {
            spinner.style.display = 'inline-block';
        } else {
            spinner.style.display = 'none';
        }

        // 현재 처리 항목
        document.getElementById('current-item').textContent = data.current_item || '-';

        // 오류 카운트
        if (data.error_count > 0) {
            document.getElementById('error-section').style.display = 'flex';
            document.getElementById('error-count').textContent = data.error_count;
        } else {
            document.getElementById('error-section').style.display = 'none';
        }

        // 100% 완료 시 자동 추적 중지
        if (progressPercentage >= 100) {
            this.stopTracking();
        }
    }

    /**
     * 계산 시작
     */
    async startCalculation() {
        try {
            const response = await fetch('/api/admin/batch-calculate-all', {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                alert('배치 계산이 시작되었습니다.');
                this.startTracking();
            } else {
                alert('계산 시작 실패: ' + data.error);
            }
        } catch (error) {
            console.error('계산 시작 오류:', error);
            alert('계산 시작 중 오류가 발생했습니다.');
        }
    }
}

// 전역 인스턴스 생성
window.PriceProgressTracker = new PriceProgressTracker();

// 모듈 내보내기
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PriceProgressTracker;
}