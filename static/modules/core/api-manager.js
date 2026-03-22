/**
 * 🌐 API 관리자
 * 실제 데이터베이스 연동 및 에러 처리 강화
 */

const ApiManager = (function() {
    'use strict';

    // 🔧 설정
    const config = {
        baseURL: window.location.protocol + '//' + window.location.host,
        timeout: 30000, // 30초 타임아웃
        retryAttempts: 3,
        retryDelay: 1000
    };

    // 📊 요청 캐시
    const cache = new Map();
    const cacheTimeout = 5 * 60 * 1000; // 5분

    // 🔄 진행 중인 요청 추적 (중복 방지)
    const pendingRequests = new Map();

    // 🎯 Public API
    return {
        // 🏗️ 초기화
        init() {
            console.log('🌐 ApiManager 초기화');
            this._setupGlobalErrorHandling();
        },

        // 📡 HTTP 요청 래퍼
        async request(url, options = {}) {
            const fullUrl = url.startsWith('http') ? url : `${config.baseURL}${url}`;
            const requestKey = `${options.method || 'GET'}:${fullUrl}`;

            try {
                // 로딩 상태 시작
                AppState.setLoading(true, `${options.loadingMessage || '데이터를 불러오는 중'}...`);

                // 중복 요청 방지
                if (pendingRequests.has(requestKey)) {
                    return await pendingRequests.get(requestKey);
                }

                // 캐시 확인 (GET 요청만)
                if (!options.method || options.method === 'GET') {
                    const cached = this._getFromCache(requestKey);
                    if (cached) {
                        AppState.setLoading(false);
                        return cached;
                    }
                }

                // 실제 요청 실행
                const requestPromise = this._executeRequest(fullUrl, options);
                pendingRequests.set(requestKey, requestPromise);

                const result = await requestPromise;

                // 성공한 GET 요청 결과 캐시
                if (!options.method || options.method === 'GET') {
                    this._setCache(requestKey, result);
                }

                return result;

            } catch (error) {
                this._handleError(error, options);
                throw error;
            } finally {
                // 정리
                AppState.setLoading(false);
                pendingRequests.delete(requestKey);
            }
        },

        // 🍽️ 메뉴/레시피 API (Production DB 연동)
        async getMenus() {
            return this.request('/api/recipes', {
                loadingMessage: '메뉴 목록을 불러오는 중'
            });
        },

        async getMenuById(id) {
            // 현재 서버에서 개별 메뉴 조회 엔드포인트가 없으므로 전체 조회 후 필터링
            const result = await this.getMenus();
            if (result.success && result.recipes) {
                const menu = result.recipes.find(recipe => recipe[0] == id);
                return { success: true, menu: menu };
            }
            return { success: false, error: 'Menu not found' };
        },

        async saveMenu(menuData) {
            // 실제 서버에 맞는 엔드포인트로 수정 예정
            console.warn('saveMenu: 실제 API 엔드포인트 구현 필요');
            return { success: false, error: 'Not implemented yet' };
        },

        async updateMenu(id, menuData) {
            console.warn('updateMenu: 실제 API 엔드포인트 구현 필요');
            return { success: false, error: 'Not implemented yet' };
        },

        // 🥗 식자재 API (Production DB 연동)
        async getIngredients(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            const url = `/api/admin/ingredients-new${queryString ? '?' + queryString : ''}`;

            return this.request(url, {
                loadingMessage: '식자재 정보를 불러오는 중'
            });
        },

        async getIngredientsByMenu(menuId) {
            // 메뉴별 재료 조회 엔드포인트 구현 필요
            console.warn('getIngredientsByMenu: 실제 API 엔드포인트 구현 필요');
            return { success: false, error: 'Not implemented yet' };
        },

        async getIngredientPrice(ingredientId) {
            // 식자재 가격 조회는 ingredients-new API의 응답에 포함됨
            const ingredients = await this.getIngredients();
            if (ingredients.success && ingredients.data) {
                const ingredient = ingredients.data.find(ing => ing.id == ingredientId);
                return { success: true, price: ingredient?.unit_price || 0 };
            }
            return { success: false, error: 'Ingredient not found' };
        },

        // 💰 가격 최적화 API
        async getOptimizedIngredients(menuId) {
            return this.request(`/api/menu/${menuId}/optimize`, {
                loadingMessage: '가격 최적화 옵션을 분석하는 중'
            });
        },

        // 📊 대시보드 API (Production DB 연동)
        async getDashboardStats() {
            // 여러 API 호출을 조합하여 대시보드 통계 생성
            try {
                const [recipes, ingredients, mealPricing] = await Promise.all([
                    this.getMenus(),
                    this.getIngredients(),
                    this.request('/api/admin/meal-pricing', { loadingMessage: '식단가 정보를 불러오는 중' })
                ]);

                return {
                    success: true,
                    stats: {
                        totalRecipes: recipes.success ? recipes.recipes?.length || 0 : 0,
                        totalIngredients: ingredients.success ? ingredients.data?.length || 0 : 0,
                        activeMealPricing: mealPricing.success ? mealPricing.stats?.active || 0 : 0,
                        totalLocations: mealPricing.success ? mealPricing.stats?.locations || 0 : 0
                    }
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },

        // 📋 식단표 저장/불러오기 API (LocalStorage 기반, 추후 DB 연동)
        async saveMealPlan(mealPlanData) {
            // 현재는 AppState를 통해 localStorage에 저장
            console.warn('saveMealPlan: localStorage 사용, 추후 DB 연동 필요');
            AppState.set('mealData', mealPlanData);
            return { success: true, message: 'Meal plan saved to localStorage' };
        },

        async getMealPlan(dateRange) {
            // AppState에서 식단 데이터 조회
            const mealData = AppState.get('mealData') || {};
            return { success: true, mealPlan: mealData };
        },

        // 🔄 실제 HTTP 요청 실행
        async _executeRequest(url, options) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            const fetchOptions = {
                ...options,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers
                }
            };

            let lastError;
            for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
                try {
                    const response = await fetch(url, fetchOptions);
                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        return await response.json();
                    } else {
                        return await response.text();
                    }

                } catch (error) {
                    lastError = error;

                    if (attempt < config.retryAttempts && this._isRetryableError(error)) {
                        console.warn(`Request failed (attempt ${attempt}/${config.retryAttempts}):`, error.message);
                        await this._delay(config.retryDelay * attempt);
                        continue;
                    }

                    throw error;
                }
            }

            throw lastError;
        },

        // ❌ 에러 처리
        _handleError(error, options) {
            console.error('API Request Error:', error);

            let userMessage = '알 수 없는 오류가 발생했습니다.';

            if (error.name === 'AbortError') {
                userMessage = '요청이 시간 초과되었습니다. 다시 시도해주세요.';
            } else if (error.message.includes('fetch')) {
                userMessage = '네트워크 연결을 확인해주세요.';
            } else if (error.message.includes('HTTP 404')) {
                userMessage = '요청한 데이터를 찾을 수 없습니다.';
            } else if (error.message.includes('HTTP 500')) {
                userMessage = '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
            } else if (error.message.includes('HTTP 403')) {
                userMessage = '접근 권한이 없습니다.';
            }

            AppState.setError(true, userMessage);

            // 에러 알림 표시
            if (window.showNotification) {
                showNotification(userMessage, 'error');
            }
        },

        // 🔄 재시도 가능한 에러 판단
        _isRetryableError(error) {
            if (error.name === 'AbortError') return false;
            if (error.message.includes('HTTP 4')) return false; // 4xx 에러는 재시도 안함
            return true;
        },

        // ⏱️ 지연 함수
        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        // 💾 캐시 관리
        _getFromCache(key) {
            const cached = cache.get(key);
            if (cached && Date.now() - cached.timestamp < cacheTimeout) {
                console.log('📦 캐시에서 반환:', key);
                return cached.data;
            }
            cache.delete(key);
            return null;
        },

        _setCache(key, data) {
            cache.set(key, {
                data,
                timestamp: Date.now()
            });
        },

        // 🧹 캐시 클리어
        clearCache() {
            cache.clear();
            console.log('🗑️ API 캐시 클리어됨');
        },

        // 🌍 전역 에러 핸들링 설정
        _setupGlobalErrorHandling() {
            // Unhandled Promise rejection 처리
            window.addEventListener('unhandledrejection', (event) => {
                console.error('Unhandled Promise Rejection:', event.reason);
                AppState.setError(true, '예상치 못한 오류가 발생했습니다.');

                if (window.showNotification) {
                    showNotification('시스템 오류가 발생했습니다.', 'error');
                }
            });

            // JavaScript 에러 처리
            window.addEventListener('error', (event) => {
                console.error('JavaScript Error:', event.error);
                AppState.setError(true, 'JavaScript 오류가 발생했습니다.');
            });
        },

        // 📊 API 상태 확인
        async healthCheck() {
            try {
                const response = await this.request('/api/health', {
                    method: 'GET',
                    loadingMessage: '서버 상태 확인 중'
                });
                return response;
            } catch (error) {
                console.error('Health check failed:', error);
                return { status: 'error', message: error.message };
            }
        }
    };
})();

// 🌍 전역 접근 가능하게 설정
window.ApiManager = ApiManager;