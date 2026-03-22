// 공통 유틸리티 함수들
(function() {
'use strict';

// 날짜 포맷팅
function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return format
        .replace('YYYY', year)
        .replace('MM', month)
        .replace('DD', day)
        .replace('HH', hours)
        .replace('mm', minutes)
        .replace('ss', seconds);
}

// 숫자를 한국어 통화 형식으로 포맷
function formatCurrency(amount, currency = '원') {
    if (amount === null || amount === undefined || isNaN(amount)) return '0' + currency;
    return Number(amount).toLocaleString('ko-KR') + currency;
}

// 문자열이 비어있는지 확인
function isEmpty(str) {
    return !str || str.trim().length === 0;
}

// 전화번호 형식 검증
function isValidPhone(phone) {
    if (!phone) return false;
    const phoneRegex = /^(\d{2,3}-\d{3,4}-\d{4})$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
}

// 이메일 형식 검증
function isValidEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// 사업자등록번호 형식 검증
function isValidBusinessNumber(number) {
    if (!number) return false;
    const cleanNumber = number.replace(/\D/g, '');
    return cleanNumber.length === 10;
}

// HTML 이스케이프
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// 배열을 청크 단위로 분할
function chunkArray(array, chunkSize) {
    if (!Array.isArray(array) || chunkSize <= 0) return [];
    
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// 객체 깊은 복사
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }
    return obj;
}

// 디바운스 함수
function debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func(...args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func(...args);
    };
}

// 스로틀 함수
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 페이지네이션 정보 생성
function createPaginationInfo(currentPage, totalPages, maxVisiblePages = 5) {
    const pages = [];
    const halfVisible = Math.floor(maxVisiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, currentPage + halfVisible);
    
    // 시작 페이지 조정
    if (endPage - startPage + 1 < maxVisiblePages) {
        if (startPage === 1) {
            endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        } else {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
    }
    
    return {
        pages,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
        showFirstDots: startPage > 2,
        showLastDots: endPage < totalPages - 1
    };
}

// localStorage 안전 사용
function safeLocalStorage() {
    try {
        const testKey = '__localStorage_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        return {
            getItem: (key) => localStorage.getItem(key),
            setItem: (key, value) => localStorage.setItem(key, value),
            removeItem: (key) => localStorage.removeItem(key),
            clear: () => localStorage.clear()
        };
    } catch (e) {
        // localStorage 사용 불가능한 경우 메모리 기반 구현
        const storage = {};
        return {
            getItem: (key) => storage[key] || null,
            setItem: (key, value) => storage[key] = value,
            removeItem: (key) => delete storage[key],
            clear: () => Object.keys(storage).forEach(key => delete storage[key])
        };
    }
}

// URL 파라미터 파싱
function parseUrlParams(url = window.location.search) {
    const params = new URLSearchParams(url);
    const result = {};
    for (const [key, value] of params) {
        result[key] = value;
    }
    return result;
}

// 문자열 검색 하이라이트
function highlightText(text, searchTerm) {
    if (!text || !searchTerm) return text;
    
    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

// 정규식 이스케이프
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 전역 함수로 내보내기
window.formatDate = formatDate;
window.formatCurrency = formatCurrency;
window.isEmpty = isEmpty;
window.isValidPhone = isValidPhone;
window.isValidEmail = isValidEmail;
window.isValidBusinessNumber = isValidBusinessNumber;
window.escapeHtml = escapeHtml;
window.chunkArray = chunkArray;
window.deepClone = deepClone;
window.debounce = debounce;
window.throttle = throttle;
window.createPaginationInfo = createPaginationInfo;
window.safeLocalStorage = safeLocalStorage;
window.parseUrlParams = parseUrlParams;
window.highlightText = highlightText;
window.escapeRegex = escapeRegex;

})(); // IIFE 종료