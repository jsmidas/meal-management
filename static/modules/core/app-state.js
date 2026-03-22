/**
 * 🏗️ 애플리케이션 상태 관리자
 * 전역 변수들을 중앙화하고 모듈 패턴으로 관리
 */

const AppState = (function() {
    'use strict';

    // 🔒 Private 상태 변수들
    let _state = {
        // 📊 데이터 상태
        mealData: {},
        allMenus: [],
        priceHistory: {},

        // 🎛️ UI 상태
        currentView: 'month',
        currentDate: new Date(),
        visibleSlotCount: 3,

        // 📋 복사 클립보드
        copyClipboard: null,

        // 🎯 선택된 카테고리
        currentCategory: 'all',

        // 🔄 로딩 상태
        isLoading: false,
        loadingMessage: '',

        // ❌ 에러 상태
        hasError: false,
        errorMessage: '',

        // 📅 캘린더 설정
        mealSlots: [
            '조식A', '조식B', '조식C', '조식D',
            '중식A', '중식B', '중식C', '중식D', '중식E',
            '석식A', '석식B', '석식C', '석식D',
            '간식A', '간식B', '간식C',
            '특식A', '특식B', '특식C', '특식D'
        ],

        // 🏢 다중 사업장 상태
        currentSiteId: null,
        currentSiteName: null,
        currentGroupId: null,
        currentCategoryId: null,
        accessibleSites: [],
        siteStructure: {}
    };

    // 📢 상태 변경 이벤트 리스너들
    const _listeners = {
        dataChange: [],
        uiChange: [],
        error: [],
        loading: [],
        siteChange: []
    };

    // 🎯 Public API
    return {
        // 📖 상태 읽기
        get(key) {
            if (key) {
                return _state[key];
            }
            return { ..._state }; // 얕은 복사로 반환
        },

        // ✏️ 상태 업데이트
        set(key, value) {
            if (typeof key === 'object') {
                // 객체로 여러 값 한번에 설정
                Object.assign(_state, key);
                this._notify('dataChange', key);
            } else {
                const oldValue = _state[key];
                _state[key] = value;
                this._notify('dataChange', { [key]: value, oldValue });
            }

            // localStorage에 영속화
            this._persistState();
        },

        // 📊 식단 데이터 관리
        getMealData(date, slot) {
            const dateKey = this._formatDate(date);
            if (slot) {
                return _state.mealData[dateKey]?.[slot] || [];
            }
            return _state.mealData[dateKey] || {};
        },

        setMealData(date, slot, menus) {
            const dateKey = this._formatDate(date);
            if (!_state.mealData[dateKey]) {
                _state.mealData[dateKey] = {};
            }
            _state.mealData[dateKey][slot] = menus;
            this._notify('dataChange', { mealData: _state.mealData });
            this._persistState();
        },

        // 🍽️ 메뉴 관리
        addMenu(menu) {
            _state.allMenus.push(menu);
            this._notify('dataChange', { allMenus: _state.allMenus });
        },

        findMenu(id) {
            return _state.allMenus.find(menu => menu.id == id);
        },

        updateMenu(id, updates) {
            const index = _state.allMenus.findIndex(menu => menu.id == id);
            if (index !== -1) {
                _state.allMenus[index] = { ..._state.allMenus[index], ...updates };
                this._notify('dataChange', { allMenus: _state.allMenus });
                this._persistState();
            }
        },

        // 🔄 로딩 상태 관리
        setLoading(isLoading, message = '') {
            _state.isLoading = isLoading;
            _state.loadingMessage = message;
            this._notify('loading', { isLoading, message });
        },

        // ❌ 에러 상태 관리
        setError(hasError, message = '') {
            _state.hasError = hasError;
            _state.errorMessage = message;
            this._notify('error', { hasError, message });
        },

        // 🧹 에러 클리어
        clearError() {
            this.setError(false, '');
        },

        // 👂 이벤트 리스너 등록
        on(event, callback) {
            if (_listeners[event]) {
                _listeners[event].push(callback);
            }
        },

        // 🚫 이벤트 리스너 해제
        off(event, callback) {
            if (_listeners[event]) {
                const index = _listeners[event].indexOf(callback);
                if (index > -1) {
                    _listeners[event].splice(index, 1);
                }
            }
        },

        // 🔔 내부 알림 메서드
        _notify(event, data) {
            if (_listeners[event]) {
                _listeners[event].forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`Event listener error in ${event}:`, error);
                    }
                });
            }
        },

        // 💾 상태 영속화
        _persistState() {
            try {
                const persistData = {
                    mealData: _state.mealData,
                    currentView: _state.currentView,
                    currentDate: _state.currentDate.toISOString(),
                    visibleSlotCount: _state.visibleSlotCount,
                    currentCategory: _state.currentCategory,
                    // 사업장 상태
                    currentSiteId: _state.currentSiteId,
                    currentSiteName: _state.currentSiteName,
                    currentGroupId: _state.currentGroupId,
                    currentCategoryId: _state.currentCategoryId
                };
                localStorage.setItem('mealPlanState', JSON.stringify(persistData));
            } catch (error) {
                console.error('Failed to persist state:', error);
            }
        },

        // 📥 상태 복원
        _restoreState() {
            try {
                const saved = localStorage.getItem('mealPlanState');
                if (saved) {
                    const persistData = JSON.parse(saved);
                    _state.mealData = persistData.mealData || {};
                    _state.currentView = persistData.currentView || 'month';
                    _state.currentDate = new Date(); // 항상 현재 날짜로 시작
                    _state.visibleSlotCount = persistData.visibleSlotCount || 3;
                    _state.currentCategory = persistData.currentCategory || 'all';
                    // 사업장 상태 복원
                    _state.currentSiteId = persistData.currentSiteId || null;
                    _state.currentSiteName = persistData.currentSiteName || null;
                    _state.currentGroupId = persistData.currentGroupId || null;
                    _state.currentCategoryId = persistData.currentCategoryId || null;

                    console.log('[OK] 상태 복원 완료');
                    return true;
                }
            } catch (error) {
                console.error('Failed to restore state:', error);
            }
            return false;
        },

        // 🗑️ 상태 초기화
        reset() {
            _state = {
                mealData: {},
                allMenus: [],
                priceHistory: {},
                currentView: 'week',
                currentDate: new Date(),
                visibleSlotCount: 3,
                copyClipboard: null,
                currentCategory: 'all',
                isLoading: false,
                loadingMessage: '',
                hasError: false,
                errorMessage: '',
                mealSlots: _state.mealSlots, // 기본 슬롯은 유지
                // 사업장 상태 초기화
                currentSiteId: null,
                currentSiteName: null,
                currentGroupId: null,
                currentCategoryId: null,
                accessibleSites: [],
                siteStructure: {}
            };
            localStorage.removeItem('mealPlanState');
            this._notify('dataChange', _state);
        },

        // 🏢 사업장 상태 설정
        setSiteContext(context) {
            _state.currentSiteId = context.site_id || context.siteId || null;
            _state.currentSiteName = context.site_name || context.siteName || null;
            _state.currentGroupId = context.group_id || context.groupId || null;
            _state.currentCategoryId = context.category_id || context.categoryId || null;
            this._persistState();
            this._notify('siteChange', {
                siteId: _state.currentSiteId,
                siteName: _state.currentSiteName,
                groupId: _state.currentGroupId,
                categoryId: _state.currentCategoryId
            });
        },

        // 🏢 현재 사업장 ID 반환
        getCurrentSiteId() {
            return _state.currentSiteId;
        },

        // 🏢 현재 사업장 이름 반환
        getCurrentSiteName() {
            return _state.currentSiteName;
        },

        // 🏢 현재 사업장 컨텍스트 반환
        getSiteContext() {
            return {
                siteId: _state.currentSiteId,
                siteName: _state.currentSiteName,
                groupId: _state.currentGroupId,
                categoryId: _state.currentCategoryId
            };
        },

        // 📅 날짜 포맷 유틸리티
        _formatDate(date) {
            if (!date) {
                console.warn('[AppState] _formatDate: date가 null입니다');
                return new Date().toISOString().split('T')[0];  // 오늘 날짜로 폴백
            }
            if (typeof date === 'string') return date;
            return date.toISOString().split('T')[0];
        },

        // 🚀 초기화
        init() {
            console.log('🏗️ AppState 초기화 시작');

            // 저장된 상태 복원 시도
            this._restoreState();

            // 브라우저 종료 시 상태 저장
            window.addEventListener('beforeunload', () => {
                this._persistState();
            });

            console.log('✅ AppState 초기화 완료');
        }
    };
})();

// 🌍 전역 접근 가능하게 설정
window.AppState = AppState;