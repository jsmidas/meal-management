/**
 * 대시보드 유틸리티 함수들
 * 공통으로 사용되는 헬퍼 함수들
 */

// 숫자 포맷팅 (천 단위 콤마)
function formatNumber(num) {
    return num.toLocaleString();
}

// 날짜 포맷팅 (YYYY-MM-DD HH:mm)
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// API 요청 헬퍼
async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API 요청 실패:', error);
        throw error;
    }
}

// 로딩 표시
function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = '<div class="loading">⏳ 로딩 중...</div>';
    }
}

// 성공 메시지 표시
function showSuccess(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, duration);
}

// 오류 메시지 표시
function showError(message, duration = 5000) {
    const toast = document.createElement('div');
    toast.className = 'toast error';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, duration);
}

// 전역으로 노출
window.DashboardUtils = {
    formatNumber,
    formatDateTime,
    apiRequest,
    showLoading,
    showSuccess,
    showError
};