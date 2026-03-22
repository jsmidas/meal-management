/**
 * 🎨 UI 관리자
 * 로딩 상태, 에러 처리, 접근성 개선
 */

const UIManager = (function() {
    'use strict';

    // 🎨 UI 요소들
    let elements = {};

    // 📱 터치 지원 감지
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // 🎯 Public API
    return {
        // 🏗️ 초기화
        init() {
            console.log('🎨 UIManager 초기화');
            this._createUIElements();
            this._setupEventListeners();
            this._setupAccessibility();
            console.log('✅ UIManager 초기화 완료');
        },

        // 🔄 로딩 오버레이 표시
        showLoading(message = '처리 중...') {
            if (!elements.loadingOverlay) {
                this._createLoadingOverlay();
            }

            elements.loadingMessage.textContent = message;
            elements.loadingOverlay.style.display = 'flex';
            elements.loadingOverlay.setAttribute('aria-busy', 'true');

            // 바디 스크롤 방지
            document.body.style.overflow = 'hidden';

            console.log('🔄 로딩 표시:', message);
        },

        // ✅ 로딩 오버레이 숨김
        hideLoading() {
            if (elements.loadingOverlay) {
                elements.loadingOverlay.style.display = 'none';
                elements.loadingOverlay.setAttribute('aria-busy', 'false');
            }

            // 바디 스크롤 복원
            document.body.style.overflow = '';

            console.log('✅ 로딩 숨김');
        },

        // ❌ 에러 모달 표시
        showError(message, details = null) {
            if (!elements.errorModal) {
                this._createErrorModal();
            }

            elements.errorMessage.textContent = message;

            if (details) {
                elements.errorDetails.textContent = details;
                elements.errorDetails.style.display = 'block';
            } else {
                elements.errorDetails.style.display = 'none';
            }

            elements.errorModal.style.display = 'flex';
            elements.errorModal.setAttribute('aria-hidden', 'false');

            // 첫 번째 버튼에 포커스
            const firstButton = elements.errorModal.querySelector('button');
            if (firstButton) {
                setTimeout(() => firstButton.focus(), 100);
            }

            console.log('❌ 에러 표시:', message);
        },

        // ✅ 에러 모달 숨김
        hideError() {
            if (elements.errorModal) {
                elements.errorModal.style.display = 'none';
                elements.errorModal.setAttribute('aria-hidden', 'true');
            }
            console.log('✅ 에러 숨김');
        },

        // 📢 알림 토스트 표시
        showToast(message, type = 'info', duration = 3000) {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'polite');

            const icons = {
                success: '✅',
                error: '❌',
                warning: '⚠️',
                info: 'ℹ️'
            };

            toast.innerHTML = `
                <div class="toast-content">
                    <span class="toast-icon">${icons[type] || icons.info}</span>
                    <span class="toast-message">${message}</span>
                    <button class="toast-close" aria-label="닫기">×</button>
                </div>
            `;

            // 스타일 적용
            Object.assign(toast.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '10001',
                backgroundColor: this._getToastColor(type),
                color: 'white',
                padding: '12px 16px',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                transform: 'translateX(100%)',
                transition: 'transform 0.3s ease',
                maxWidth: '400px',
                fontSize: '14px'
            });

            // 토스트 컨테이너에 추가
            if (!elements.toastContainer) {
                this._createToastContainer();
            }
            elements.toastContainer.appendChild(toast);

            // 애니메이션으로 나타나기
            setTimeout(() => {
                toast.style.transform = 'translateX(0)';
            }, 10);

            // 닫기 버튼 이벤트
            const closeBtn = toast.querySelector('.toast-close');
            closeBtn.addEventListener('click', () => {
                this._removeToast(toast);
            });

            // 자동 제거
            if (duration > 0) {
                setTimeout(() => {
                    this._removeToast(toast);
                }, duration);
            }

            return toast;
        },

        // 🗑️ 토스트 제거
        _removeToast(toast) {
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        },

        // 🎨 토스트 색상 결정
        _getToastColor(type) {
            const colors = {
                success: '#10b981',
                error: '#ef4444',
                warning: '#f59e0b',
                info: '#3b82f6'
            };
            return colors[type] || colors.info;
        },

        // 🔄 로딩 오버레이 생성
        _createLoadingOverlay() {
            const overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', '로딩 중');
            overlay.setAttribute('aria-busy', 'true');

            overlay.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-message">처리 중...</div>
                </div>
            `;

            // 스타일 적용
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '10000',
                backdropFilter: 'blur(3px)'
            });

            const content = overlay.querySelector('.loading-content');
            Object.assign(content.style, {
                backgroundColor: 'white',
                padding: '40px',
                borderRadius: '12px',
                textAlign: 'center',
                boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                minWidth: '200px'
            });

            const spinner = overlay.querySelector('.loading-spinner');
            Object.assign(spinner.style, {
                width: '40px',
                height: '40px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #3498db',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px'
            });

            const message = overlay.querySelector('.loading-message');
            Object.assign(message.style, {
                fontSize: '16px',
                color: '#333',
                fontWeight: '500'
            });

            // 스피너 애니메이션 CSS 추가
            if (!document.querySelector('#spinner-styles')) {
                const style = document.createElement('style');
                style.id = 'spinner-styles';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(overlay);
            elements.loadingOverlay = overlay;
            elements.loadingMessage = message;
        },

        // ❌ 에러 모달 생성
        _createErrorModal() {
            const modal = document.createElement('div');
            modal.id = 'errorModal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-labelledby', 'error-title');
            modal.setAttribute('aria-describedby', 'error-message');
            modal.setAttribute('aria-hidden', 'true');

            modal.innerHTML = `
                <div class="error-content">
                    <div class="error-header">
                        <h3 id="error-title">⚠️ 오류 발생</h3>
                    </div>
                    <div class="error-body">
                        <p id="error-message" class="error-message"></p>
                        <details class="error-details" style="display: none;">
                            <summary>상세 정보</summary>
                            <pre class="error-details-text"></pre>
                        </details>
                    </div>
                    <div class="error-footer">
                        <button class="btn-error-close">확인</button>
                        <button class="btn-error-retry" style="display: none;">다시 시도</button>
                    </div>
                </div>
            `;

            // 스타일 적용
            Object.assign(modal.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '10001'
            });

            const content = modal.querySelector('.error-content');
            Object.assign(content.style, {
                backgroundColor: 'white',
                borderRadius: '8px',
                maxWidth: '500px',
                width: '90%',
                maxHeight: '80vh',
                overflow: 'auto',
                boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
            });

            // 이벤트 리스너
            modal.querySelector('.btn-error-close').addEventListener('click', () => {
                this.hideError();
                AppState.clearError();
            });

            // ESC 키로 닫기
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.hideError();
                    AppState.clearError();
                }
            });

            document.body.appendChild(modal);
            elements.errorModal = modal;
            elements.errorMessage = modal.querySelector('.error-message');
            elements.errorDetails = modal.querySelector('.error-details-text');
        },

        // 📱 토스트 컨테이너 생성
        _createToastContainer() {
            const container = document.createElement('div');
            container.id = 'toastContainer';
            container.setAttribute('aria-live', 'polite');

            Object.assign(container.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '10001',
                pointerEvents: 'none'
            });

            document.body.appendChild(container);
            elements.toastContainer = container;
        },

        // 🎯 모든 UI 요소 생성
        _createUIElements() {
            // 로딩과 에러 모달은 필요할 때 생성
            this._createToastContainer();
        },

        // 👂 이벤트 리스너 설정
        _setupEventListeners() {
            // AppState 이벤트 리스너
            AppState.on('loading', (data) => {
                if (data.isLoading) {
                    this.showLoading(data.message);
                } else {
                    this.hideLoading();
                }
            });

            AppState.on('error', (data) => {
                if (data.hasError) {
                    this.showError(data.message);
                } else {
                    this.hideError();
                }
            });

            // 전역 키보드 단축키
            document.addEventListener('keydown', (e) => {
                // Ctrl+R: 새로고침
                if (e.ctrlKey && e.key === 'r') {
                    e.preventDefault();
                    window.location.reload();
                }

                // ESC: 모든 모달 닫기
                if (e.key === 'Escape') {
                    this.hideError();
                    this.hideLoading();
                }
            });
        },

        // ♿ 접근성 설정
        _setupAccessibility() {
            // Skip to content 링크 추가
            const skipLink = document.createElement('a');
            skipLink.href = '#main-content';
            skipLink.textContent = '메인 콘텐츠로 건너뛰기';
            skipLink.className = 'skip-link';

            Object.assign(skipLink.style, {
                position: 'absolute',
                top: '-40px',
                left: '6px',
                background: '#000',
                color: '#fff',
                padding: '8px',
                textDecoration: 'none',
                zIndex: '10002',
                borderRadius: '4px'
            });

            skipLink.addEventListener('focus', () => {
                skipLink.style.top = '6px';
            });

            skipLink.addEventListener('blur', () => {
                skipLink.style.top = '-40px';
            });

            document.body.insertBefore(skipLink, document.body.firstChild);

            // 메인 콘텐츠 영역에 ID 추가
            const mainContent = document.querySelector('.content-area') ||
                              document.querySelector('main') ||
                              document.body;
            if (mainContent && !mainContent.id) {
                mainContent.id = 'main-content';
            }

            // 터치 디바이스 감지 및 클래스 추가
            if (isTouchDevice) {
                document.body.classList.add('touch-device');
            }

            console.log('♿ 접근성 기능 설정 완료');
        },

        // 🧹 정리 함수
        destroy() {
            // 생성된 UI 요소들 제거
            Object.values(elements).forEach(element => {
                if (element && element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            });

            elements = {};
            console.log('🧹 UIManager 정리 완료');
        }
    };
})();

// 🌍 전역 접근 가능하게 설정
window.UIManager = UIManager;