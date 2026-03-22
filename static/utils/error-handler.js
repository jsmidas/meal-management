// 🛡️ 다함 식자재 관리 시스템 - 전역 에러 처리 시스템
// 시스템 전체의 에러를 중앙에서 관리하고 사용자에게 친화적으로 표시

class ErrorHandler {
    constructor() {
        this.errorQueue = [];
        this.maxErrors = 50; // 최대 저장할 에러 수
        this.isInitialized = false;
        
        console.log('[ErrorHandler] 초기화 시작');
        this.init();
    }

    /**
     * 에러 핸들러 초기화
     */
    init() {
        // 전역 에러 캐치
        this.setupGlobalErrorHandling();
        
        // Promise rejection 캐치
        this.setupUnhandledRejectionHandling();
        
        // 리소스 로드 실패 캐치
        this.setupResourceErrorHandling();
        
        this.isInitialized = true;
        console.log('[ErrorHandler] 전역 에러 처리 시스템 활성화');
    }

    /**
     * 전역 JavaScript 에러 처리
     */
    setupGlobalErrorHandling() {
        window.addEventListener('error', (event) => {
            const errorInfo = {
                type: 'javascript',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error ? event.error.stack : null,
                timestamp: new Date(),
                url: window.location.href
            };
            
            this.handleError(errorInfo);
        });
    }

    /**
     * Promise rejection 처리
     */
    setupUnhandledRejectionHandling() {
        window.addEventListener('unhandledrejection', (event) => {
            const errorInfo = {
                type: 'promise',
                message: event.reason.message || event.reason.toString(),
                stack: event.reason.stack,
                promise: event.promise,
                timestamp: new Date(),
                url: window.location.href
            };
            
            this.handleError(errorInfo);
            
            // 기본 동작 방지 (콘솔 에러 출력 방지)
            event.preventDefault();
        });
    }

    /**
     * 리소스 로드 실패 처리
     */
    setupResourceErrorHandling() {
        window.addEventListener('error', (event) => {
            // 리소스 에러인지 확인
            if (event.target !== window) {
                const errorInfo = {
                    type: 'resource',
                    message: `리소스 로드 실패: ${event.target.src || event.target.href}`,
                    resource: event.target.tagName,
                    src: event.target.src || event.target.href,
                    timestamp: new Date(),
                    url: window.location.href
                };
                
                this.handleError(errorInfo);
            }
        }, true);
    }

    /**
     * 에러 처리 중앙 메서드
     */
    handleError(errorInfo) {
        // 에러 저장
        this.addToErrorQueue(errorInfo);
        
        // 콘솔에 에러 출력
        this.logError(errorInfo);
        
        // 사용자에게 에러 알림 (심각한 에러만)
        if (this.isCriticalError(errorInfo)) {
            this.showErrorToUser(errorInfo);
        }
        
        // 개발 모드에서 상세 정보 표시
        if (this.isDevelopmentMode()) {
            this.showDetailedError(errorInfo);
        }
    }

    /**
     * API 호출 에러 처리 (수동 호출)
     */
    handleApiError(error, context = {}) {
        const errorInfo = {
            type: 'api',
            message: error.message || '알 수 없는 API 에러',
            status: error.status,
            endpoint: context.endpoint,
            method: context.method,
            requestData: context.requestData,
            timestamp: new Date(),
            url: window.location.href
        };
        
        this.handleError(errorInfo);
        
        // API 에러는 항상 사용자에게 표시
        this.showApiErrorToUser(errorInfo);
        
        return errorInfo;
    }

    /**
     * 모듈 로드 에러 처리
     */
    handleModuleError(moduleName, error) {
        const errorInfo = {
            type: 'module',
            message: `모듈 로드 실패: ${moduleName}`,
            moduleName: moduleName,
            originalError: error.message,
            stack: error.stack,
            timestamp: new Date(),
            url: window.location.href
        };
        
        this.handleError(errorInfo);
        
        // 모듈 에러는 복구 가능성 제시
        this.showModuleErrorToUser(errorInfo);
        
        return errorInfo;
    }

    /**
     * 에러 큐에 추가
     */
    addToErrorQueue(errorInfo) {
        this.errorQueue.unshift(errorInfo);
        
        // 최대 개수 초과 시 오래된 에러 제거
        if (this.errorQueue.length > this.maxErrors) {
            this.errorQueue = this.errorQueue.slice(0, this.maxErrors);
        }
    }

    /**
     * 콘솔에 에러 로그
     */
    logError(errorInfo) {
        let timestamp;
        try {
            if (window.DateTimeUtils && typeof window.DateTimeUtils.formatDate === 'function') {
                timestamp = DateTimeUtils.formatDate(errorInfo.timestamp, 'YYYY-MM-DD HH:mm:ss');
            } else {
                timestamp = errorInfo.timestamp.toLocaleString('ko-KR');
            }
        } catch (error) {
            timestamp = new Date().toLocaleString('ko-KR');
        }
        
        console.group(`🚨 [ErrorHandler] ${errorInfo.type.toUpperCase()} 에러 - ${timestamp}`);
        console.error('메시지:', errorInfo.message);
        if (errorInfo.filename) console.error('파일:', errorInfo.filename);
        if (errorInfo.lineno) console.error('라인:', errorInfo.lineno);
        if (errorInfo.stack) console.error('스택:', errorInfo.stack);
        console.error('전체 정보:', errorInfo);
        console.groupEnd();
    }

    /**
     * 심각한 에러인지 판단
     */
    isCriticalError(errorInfo) {
        const criticalKeywords = [
            'network',
            'connection',
            'server',
            'api',
            'authentication',
            'authorization',
            'database'
        ];
        
        return criticalKeywords.some(keyword => 
            errorInfo.message.toLowerCase().includes(keyword)
        ) || errorInfo.type === 'api' || errorInfo.type === 'module';
    }

    /**
     * 개발 모드인지 확인
     */
    isDevelopmentMode() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1';
    }

    /**
     * 사용자에게 에러 표시
     */
    showErrorToUser(errorInfo) {
        const userMessage = this.getUserFriendlyMessage(errorInfo);
        
        // 기존 에러 알림 제거
        this.removeExistingErrorNotifications();
        
        // 새 에러 알림 생성
        const notification = this.createErrorNotification(userMessage, errorInfo);
        document.body.appendChild(notification);
        
        // 5초 후 자동 제거
        setTimeout(() => {
            this.removeNotification(notification);
        }, 5000);
    }

    /**
     * API 에러를 사용자에게 표시
     */
    showApiErrorToUser(errorInfo) {
        const message = this.getApiErrorMessage(errorInfo);
        this.showErrorToUser({...errorInfo, userMessage: message});
    }

    /**
     * 모듈 에러를 사용자에게 표시
     */
    showModuleErrorToUser(errorInfo) {
        const message = `${errorInfo.moduleName} 모듈을 불러올 수 없습니다. 페이지를 새로고침 해보세요.`;
        this.showErrorToUser({...errorInfo, userMessage: message});
    }

    /**
     * 사용자 친화적 메시지 생성
     */
    getUserFriendlyMessage(errorInfo) {
        if (errorInfo.userMessage) return errorInfo.userMessage;
        
        switch (errorInfo.type) {
            case 'javascript':
                return '일시적인 오류가 발생했습니다. 페이지를 새로고침 해보세요.';
            case 'promise':
                return '데이터 처리 중 오류가 발생했습니다.';
            case 'resource':
                return '필요한 파일을 불러올 수 없습니다.';
            case 'api':
                return this.getApiErrorMessage(errorInfo);
            case 'module':
                return `${errorInfo.moduleName} 기능을 불러올 수 없습니다.`;
            default:
                return '알 수 없는 오류가 발생했습니다.';
        }
    }

    /**
     * API 에러 메시지 생성
     */
    getApiErrorMessage(errorInfo) {
        if (errorInfo.status >= 500) {
            return '서버에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
        } else if (errorInfo.status >= 400) {
            return '요청이 잘못되었습니다. 입력값을 확인해주세요.';
        } else {
            return '네트워크 연결을 확인하고 다시 시도해주세요.';
        }
    }

    /**
     * 에러 알림 요소 생성
     */
    createErrorNotification(message, errorInfo) {
        const notification = document.createElement('div');
        notification.className = 'error-notification';
        notification.innerHTML = `
            <div class="error-content">
                <div class="error-icon">⚠️</div>
                <div class="error-message">${message}</div>
                <button class="error-close" onclick="this.parentElement.parentElement.remove()">✕</button>
            </div>
        `;
        
        // 스타일 적용
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4757;
            color: white;
            padding: 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;
        
        return notification;
    }

    /**
     * 기존 에러 알림 제거
     */
    removeExistingErrorNotifications() {
        const existing = document.querySelectorAll('.error-notification');
        existing.forEach(el => el.remove());
    }

    /**
     * 알림 제거
     */
    removeNotification(notification) {
        if (notification && notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }

    /**
     * 개발 모드 상세 에러 표시
     */
    showDetailedError(errorInfo) {
        if (this.isDevelopmentMode()) {
            console.group('🔧 [개발 모드] 상세 에러 정보');
            console.table(errorInfo);
            console.groupEnd();
        }
    }

    /**
     * 에러 통계 반환
     */
    getErrorStats() {
        const stats = {
            total: this.errorQueue.length,
            byType: {},
            recent: this.errorQueue.slice(0, 10)
        };
        
        this.errorQueue.forEach(error => {
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
        });
        
        return stats;
    }

    /**
     * 에러 큐 초기화
     */
    clearErrorQueue() {
        this.errorQueue = [];
        console.log('[ErrorHandler] 에러 큐 초기화');
    }
}

// CSS 애니메이션 추가
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    .error-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .error-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 18px;
        margin-left: auto;
    }
    .error-close:hover {
        opacity: 0.8;
    }
`;
document.head.appendChild(style);

// 전역 인스턴스 생성
window.ErrorHandler = new ErrorHandler();

console.log('🛡️ [ErrorHandler] 전역 에러 처리 시스템 준비 완료');