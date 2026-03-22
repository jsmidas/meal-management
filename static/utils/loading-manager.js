// 🔄 다함 식자재 관리 시스템 - 로딩 상태 관리 시스템
// 전체 시스템의 로딩 상태를 중앙에서 관리하고 사용자 경험 개선

class LoadingManager {
    constructor() {
        this.activeLoaders = new Map();
        this.loadingQueue = [];
        this.isInitialized = false;
        
        console.log('[LoadingManager] 초기화 시작');
        this.init();
    }

    /**
     * 로딩 매니저 초기화
     */
    init() {
        this.createLoadingStyles();
        this.createGlobalLoadingIndicator();
        this.isInitialized = true;
        
        console.log('[LoadingManager] 로딩 관리 시스템 초기화 완료');
    }

    /**
     * 로딩 관련 CSS 스타일 생성
     */
    createLoadingStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 전역 로딩 인디케이터 */
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.9);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                backdrop-filter: blur(2px);
            }

            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 4px solid #f0f0f0;
                border-top: 4px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            .loading-message {
                margin-top: 20px;
                font-size: 16px;
                color: #666;
                text-align: center;
            }

            .loading-progress {
                width: 200px;
                height: 4px;
                background: #f0f0f0;
                border-radius: 2px;
                margin-top: 10px;
                overflow: hidden;
            }

            .loading-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #667eea, #764ba2);
                border-radius: 2px;
                transition: width 0.3s ease;
            }

            /* 인라인 로딩 */
            .inline-loading {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: #666;
            }

            .inline-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid #f0f0f0;
                border-top: 2px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            /* 카드 로딩 상태 */
            .card-loading {
                position: relative;
                opacity: 0.6;
                pointer-events: none;
            }

            .card-loading::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 30px;
                height: 30px;
                margin: -15px 0 0 -15px;
                border: 3px solid #f0f0f0;
                border-top: 3px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            /* 스켈레톤 로딩 */
            .skeleton {
                background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                background-size: 200% 100%;
                animation: skeleton 1.5s infinite;
            }

            .skeleton-text {
                height: 16px;
                margin: 8px 0;
                border-radius: 4px;
            }

            .skeleton-title {
                height: 24px;
                margin: 12px 0;
                border-radius: 6px;
            }

            .skeleton-card {
                height: 120px;
                border-radius: 8px;
                margin: 16px 0;
            }

            /* 버튼 로딩 상태 */
            .btn-loading {
                position: relative;
                color: transparent !important;
                pointer-events: none;
            }

            .btn-loading::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 20px;
                height: 20px;
                margin: -10px 0 0 -10px;
                border: 2px solid #fff;
                border-top: 2px solid transparent;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            /* 애니메이션 */
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            @keyframes skeleton {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }

            /* 페이드 인/아웃 */
            .fade-in {
                animation: fadeIn 0.3s ease-in;
            }

            .fade-out {
                animation: fadeOut 0.3s ease-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            @keyframes fadeOut {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(-10px); }
            }
        `;
        
        document.head.appendChild(style);
        console.log('[LoadingManager] 로딩 스타일 적용 완료');
    }

    /**
     * 전역 로딩 인디케이터 생성
     */
    createGlobalLoadingIndicator() {
        this.globalLoader = document.createElement('div');
        this.globalLoader.className = 'loading-overlay';
        this.globalLoader.style.display = 'none';
        this.globalLoader.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-message">데이터를 불러오는 중...</div>
            <div class="loading-progress">
                <div class="loading-progress-bar" style="width: 0%"></div>
            </div>
        `;
        document.body.appendChild(this.globalLoader);
    }

    /**
     * 로딩 시작
     */
    startLoading(id, options = {}) {
        const loadingConfig = {
            id: id,
            message: options.message || '로딩 중...',
            type: options.type || 'global', // global, inline, card, skeleton
            element: options.element || null,
            progress: options.progress || false,
            timeout: options.timeout || 30000, // 30초 기본 타임아웃
            startTime: Date.now()
        };

        this.activeLoaders.set(id, loadingConfig);
        
        switch (loadingConfig.type) {
            case 'global':
                this.showGlobalLoading(loadingConfig);
                break;
            case 'inline':
                this.showInlineLoading(loadingConfig);
                break;
            case 'card':
                this.showCardLoading(loadingConfig);
                break;
            case 'skeleton':
                this.showSkeletonLoading(loadingConfig);
                break;
            case 'button':
                this.showButtonLoading(loadingConfig);
                break;
        }

        // 타임아웃 설정
        if (loadingConfig.timeout > 0) {
            setTimeout(() => {
                if (this.activeLoaders.has(id)) {
                    console.warn(`[LoadingManager] 로딩 타임아웃: ${id}`);
                    this.stopLoading(id);
                    // ErrorHandler 사용 가능한 경우에만
                    if (window.ErrorHandler && typeof window.ErrorHandler.handleError === 'function') {
                        ErrorHandler.handleError({
                            type: 'timeout',
                            message: `로딩 타임아웃: ${id}`,
                            timeout: loadingConfig.timeout,
                            timestamp: new Date()
                        });
                    } else {
                        console.error(`[LoadingManager] 로딩 타임아웃: ${id} (${loadingConfig.timeout}ms)`);
                    }
                }
            }, loadingConfig.timeout);
        }

        console.log(`[LoadingManager] 로딩 시작: ${id} (${loadingConfig.type})`);
        return id;
    }

    /**
     * 로딩 종료
     */
    stopLoading(id) {
        const loadingConfig = this.activeLoaders.get(id);
        if (!loadingConfig) {
            console.warn(`[LoadingManager] 존재하지 않는 로딩 ID: ${id}`);
            return;
        }

        const duration = Date.now() - loadingConfig.startTime;
        
        switch (loadingConfig.type) {
            case 'global':
                this.hideGlobalLoading();
                break;
            case 'inline':
                this.hideInlineLoading(loadingConfig);
                break;
            case 'card':
                this.hideCardLoading(loadingConfig);
                break;
            case 'skeleton':
                this.hideSkeletonLoading(loadingConfig);
                break;
            case 'button':
                this.hideButtonLoading(loadingConfig);
                break;
        }

        this.activeLoaders.delete(id);
        console.log(`[LoadingManager] 로딩 완료: ${id} (${duration}ms)`);
    }

    /**
     * 로딩 진행률 업데이트
     */
    updateProgress(id, progress) {
        const loadingConfig = this.activeLoaders.get(id);
        if (!loadingConfig) return;

        loadingConfig.progress = Math.max(0, Math.min(100, progress));
        
        if (loadingConfig.type === 'global') {
            const progressBar = this.globalLoader.querySelector('.loading-progress-bar');
            if (progressBar) {
                progressBar.style.width = `${loadingConfig.progress}%`;
            }
        }
    }

    /**
     * 로딩 메시지 업데이트
     */
    updateMessage(id, message) {
        const loadingConfig = this.activeLoaders.get(id);
        if (!loadingConfig) return;

        loadingConfig.message = message;
        
        if (loadingConfig.type === 'global') {
            const messageEl = this.globalLoader.querySelector('.loading-message');
            if (messageEl) {
                messageEl.textContent = message;
            }
        }
    }

    /**
     * 전역 로딩 표시
     */
    showGlobalLoading(config) {
        const messageEl = this.globalLoader.querySelector('.loading-message');
        if (messageEl) {
            messageEl.textContent = config.message;
        }
        
        const progressBar = this.globalLoader.querySelector('.loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
        
        this.globalLoader.style.display = 'flex';
        this.globalLoader.classList.add('fade-in');
    }

    /**
     * 전역 로딩 숨김
     */
    hideGlobalLoading() {
        this.globalLoader.classList.remove('fade-in');
        this.globalLoader.classList.add('fade-out');
        
        setTimeout(() => {
            this.globalLoader.style.display = 'none';
            this.globalLoader.classList.remove('fade-out');
        }, 300);
    }

    /**
     * 인라인 로딩 표시
     */
    showInlineLoading(config) {
        if (!config.element) return;

        const loader = document.createElement('span');
        loader.className = 'inline-loading';
        loader.setAttribute('data-loading-id', config.id);
        loader.innerHTML = `
            <div class="inline-spinner"></div>
            <span>${config.message}</span>
        `;

        config.element.appendChild(loader);
    }

    /**
     * 인라인 로딩 숨김
     */
    hideInlineLoading(config) {
        if (!config.element) return;

        const loader = config.element.querySelector(`[data-loading-id="${config.id}"]`);
        if (loader) {
            loader.remove();
        }
    }

    /**
     * 카드 로딩 표시
     */
    showCardLoading(config) {
        if (!config.element) return;
        
        config.element.classList.add('card-loading');
    }

    /**
     * 카드 로딩 숨김
     */
    hideCardLoading(config) {
        if (!config.element) return;
        
        config.element.classList.remove('card-loading');
    }

    /**
     * 스켈레톤 로딩 표시
     */
    showSkeletonLoading(config) {
        if (!config.element) return;

        const skeleton = document.createElement('div');
        skeleton.setAttribute('data-loading-id', config.id);
        
        // 기본 스켈레톤 템플릿
        skeleton.innerHTML = `
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text" style="width: 80%"></div>
            <div class="skeleton skeleton-card"></div>
        `;

        config.element.innerHTML = '';
        config.element.appendChild(skeleton);
    }

    /**
     * 스켈레톤 로딩 숨김
     */
    hideSkeletonLoading(config) {
        if (!config.element) return;

        const skeleton = config.element.querySelector(`[data-loading-id="${config.id}"]`);
        if (skeleton) {
            skeleton.remove();
        }
    }

    /**
     * 버튼 로딩 표시
     */
    showButtonLoading(config) {
        if (!config.element) return;
        
        config.originalText = config.element.textContent;
        config.element.classList.add('btn-loading');
        config.element.disabled = true;
    }

    /**
     * 버튼 로딩 숨김
     */
    hideButtonLoading(config) {
        if (!config.element) return;
        
        config.element.classList.remove('btn-loading');
        config.element.disabled = false;
        
        if (config.originalText) {
            config.element.textContent = config.originalText;
        }
    }

    /**
     * 모든 로딩 상태 확인
     */
    getActiveLoadings() {
        return Array.from(this.activeLoaders.entries()).map(([id, config]) => ({
            id,
            type: config.type,
            message: config.message,
            duration: Date.now() - config.startTime,
            progress: config.progress || 0
        }));
    }

    /**
     * 모든 로딩 강제 중단
     */
    stopAllLoadings() {
        const activeIds = Array.from(this.activeLoaders.keys());
        activeIds.forEach(id => this.stopLoading(id));
        
        console.log(`[LoadingManager] 모든 로딩 중단: ${activeIds.length}개`);
    }

    /**
     * 로딩 통계
     */
    getLoadingStats() {
        return {
            active: this.activeLoaders.size,
            details: this.getActiveLoadings(),
            types: this.getLoadingsByType()
        };
    }

    /**
     * 타입별 로딩 상태
     */
    getLoadingsByType() {
        const types = {};
        this.activeLoaders.forEach((config, id) => {
            if (!types[config.type]) {
                types[config.type] = [];
            }
            types[config.type].push(id);
        });
        return types;
    }

    /**
     * 페이지 전환 시 로딩 초기화
     */
    resetForPageTransition() {
        this.stopAllLoadings();
        console.log('[LoadingManager] 페이지 전환을 위한 로딩 상태 초기화');
    }
}

// 전역 인스턴스 생성
window.LoadingManager = new LoadingManager();

console.log('🔄 [LoadingManager] 로딩 관리 시스템 준비 완료');