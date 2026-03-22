/**
 * 발주 관리 - 공유 상태 및 유틸리티
 * 모든 ordering-*.js 모듈이 참조하는 전역 상태 객체
 */
const OS = {
    // 핵심 발주 데이터
    currentOrderData: null,
    currentOrderId: null,
    warehouses: [],

    // 도착지/사업장
    currentDestination: null,
    _sitesCache: null,
    _sitesCacheTime: 0,
    SITES_CACHE_TTL: 5 * 60 * 1000,

    // 기존 발주서 연결
    existingOrdersForLink: [],
    pendingParentOrderId: null,

    // 이전 발주서 검색
    orderSearchInitialized: false,

    // 발주서 수정
    editingOrderId: null,
    editingOrderSiteId: null,
    editingOrderItems: [],

    // Step 2 선택 상태
    selectedRefKeys: new Set(),
    groupSelectionState: {},
    orderedCategories: {},

    // Step 3 합산 데이터
    aggregatedOrderData: null,
    aggregatedToOriginalMap: {},
    currentDisplayItems: [],

    // 수동 추가 품목
    manualOrderItems: [],

    // 모달/상세보기
    viewedOrderData: null,

    // 발주서 비교
    currentCompareData: null,
    currentCompareOrderId: null,

    // 오버라이드
    currentOverrides: [],
    currentOverrideContext: {},

    // UI 상태
    summaryPanelCollapsed: false,

    // 충돌 해결
    conflictItems: [],
    conflictResolutions: {},

    // Step 4 (협력업체별 수정)
    step4Data: {},
    step4Modifications: [],
    step4OriginalSnapshot: {},
    step4AllCollapsed: false,
    step4PendingReplace: null,
    step4PendingAddSupplier: null,
    step4PendingAddItem: null,

    // resetOrder 시 초기화할 항목
    reset() {
        this.currentOrderData = null;
        this.currentOrderId = null;
        this.currentDisplayItems = [];
        this.manualOrderItems = [];
    },

    // Step 4/5 초기화
    resetSteps() {
        this.step4Data = {};
        this.step4Modifications = [];
        this.step4OriginalSnapshot = {};
        this.step4PendingReplace = null;
        this.step4PendingAddSupplier = null;
        this.step4PendingAddItem = null;
        const s4 = document.getElementById('step4Section');
        const s5 = document.getElementById('step5Section');
        if (s4) s4.style.display = 'none';
        if (s5) s5.style.display = 'none';
    }
};

window.OS = OS;

// ============================================
// 공용 유틸리티 함수
// ============================================
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getCurrentSiteId() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        return context?.site_id || null;
    }
    return null;
}

function showLoading(text = '처리 중입니다...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function formatCurrency(amount) {
    return '\u20a9' + Math.round(amount).toLocaleString();
}

function formatDate(date) {
    if (!date) return '-';
    if (typeof date === 'string') {
        if (date.includes('T')) {
            date = new Date(date);
        } else {
            return date;
        }
    }
    return getLocalDateString(date);
}

function showToast(message, type = 'info') {
    const colors = {
        info: '#3498db', success: '#2ecc71', warning: '#f39c12', error: '#e74c3c'
    };
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 100000;
        background: ${colors[type] || colors.info}; color: white;
        padding: 12px 20px; border-radius: 8px; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
