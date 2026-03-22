/**
 * 레시피 관리 API 연동 모듈
 * 30K 레시피 증가 대응 및 고성능 검색/비용계산 기능
 */

class RecipeAPIManager {
    constructor(baseUrl = '/api/recipes') {
        this.baseUrl = baseUrl;
        this.cache = new Map();
        this.cacheExpiry = new Map();
    }

    /**
     * API 요청 헬퍼
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        try {
            const response = await fetch(url, { ...defaultOptions, ...options });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`API Request failed: ${url}`, error);
            throw error;
        }
    }

    /**
     * 레시피 검색 (고성능 Full-text search)
     */
    async searchRecipes(params = {}) {
        const searchParams = new URLSearchParams();

        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                searchParams.append(key, value);
            }
        });

        const cacheKey = `search:${searchParams.toString()}`;

        // 캐시 확인 (5분 유효)
        if (this.isValidCache(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const result = await this.request(`/search?${searchParams}`);

        // 성능 정보 로깅
        if (result.performance?.estimated_ms) {
            console.log(`🔍 Search Performance: ${result.performance.estimated_ms}`);
        }

        // 캐시 저장
        this.setCache(cacheKey, result, 5 * 60 * 1000); // 5분

        return result;
    }

    /**
     * 레시피 상세 정보 조회
     */
    async getRecipe(recipeId, options = {}) {
        const params = new URLSearchParams(options);
        const result = await this.request(`/${recipeId}?${params}`);

        console.log(`📋 Recipe loaded: ${result.data.recipe_name}`);
        return result;
    }

    /**
     * 레시피 생성
     */
    async createRecipe(recipeData) {
        const result = await this.request('/', {
            method: 'POST',
            body: JSON.stringify(recipeData)
        });

        console.log(`✅ Recipe created: ID ${result.data.recipe_id}`);
        this.clearSearchCache(); // 검색 캐시 무효화

        return result;
    }

    /**
     * 레시피 수정
     */
    async updateRecipe(recipeId, recipeData) {
        const result = await this.request(`/${recipeId}`, {
            method: 'PUT',
            body: JSON.stringify(recipeData)
        });

        console.log(`✅ Recipe updated: ID ${recipeId}`);
        this.clearSearchCache();

        return result;
    }

    /**
     * 레시피 삭제
     */
    async deleteRecipe(recipeId) {
        const result = await this.request(`/${recipeId}`, {
            method: 'DELETE'
        });

        console.log(`🗑️ Recipe deleted: ID ${recipeId}`);
        this.clearSearchCache();

        return result;
    }

    /**
     * 고급 비용 계산 (84,215개 식자재 연동)
     */
    async calculateAdvancedCost(recipeId, options = {}) {
        const params = new URLSearchParams(options);
        const result = await this.request(`/${recipeId}/cost/advanced?${params}`);

        const performance = result.data.performance;
        if (performance?.calculation_time_ms) {
            console.log(`💰 Cost Calculation: ${performance.calculation_time_ms}ms (Target: ${performance.target_ms}ms)`);
        }

        return result;
    }

    /**
     * 일괄 비용 계산
     */
    async calculateBulkCosts(recipeIds, servingCount = 1) {
        const requestBody = {
            recipe_ids: recipeIds,
            serving_count: servingCount
        };

        const result = await this.request('/cost/bulk', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        const performance = result.data.performance;
        console.log(`📊 Bulk Calculation: ${performance.calculation_time_ms}ms for ${recipeIds.length} recipes`);

        return result;
    }

    /**
     * 비용 최적화 제안
     */
    async getOptimizationSuggestions(recipeId) {
        const result = await this.request(`/${recipeId}/cost/optimization`);

        const suggestions = result.data.optimization_suggestions;
        if (suggestions?.length > 0) {
            console.log(`💡 Found ${suggestions.length} optimization suggestions`);
        }

        return result;
    }

    /**
     * 인기 레시피 조회
     */
    async getPopularRecipes(limit = 10, periodDays = 30) {
        const params = new URLSearchParams({ limit, period_days: periodDays });
        return await this.request(`/analytics/popular?${params}`);
    }

    /**
     * 시장 분석
     */
    async getMarketAnalysis(category = null, limit = 20) {
        const params = new URLSearchParams({ limit });
        if (category) params.append('category', category);

        return await this.request(`/cost/market-analysis?${params}`);
    }

    /**
     * 레시피 카테고리 목록
     */
    async getCategories() {
        const cacheKey = 'categories';

        if (this.isValidCache(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const result = await this.request('/categories');
        this.setCache(cacheKey, result, 10 * 60 * 1000); // 10분 캐시

        return result;
    }

    /**
     * 레시피 통계
     */
    async getStatistics() {
        return await this.request('/analytics/stats');
    }

    /**
     * 캐시 관리
     */
    setCache(key, value, expiry) {
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + expiry);
    }

    isValidCache(key) {
        if (!this.cache.has(key)) return false;
        if (Date.now() > this.cacheExpiry.get(key)) {
            this.cache.delete(key);
            this.cacheExpiry.delete(key);
            return false;
        }
        return true;
    }

    clearSearchCache() {
        // 검색 관련 캐시만 삭제
        for (const key of this.cache.keys()) {
            if (key.startsWith('search:')) {
                this.cache.delete(key);
                this.cacheExpiry.delete(key);
            }
        }
    }

    clearAllCache() {
        this.cache.clear();
        this.cacheExpiry.clear();
    }
}

/**
 * UI 연동 헬퍼 클래스
 */
class RecipeUIManager {
    constructor() {
        this.api = new RecipeAPIManager();
        this.currentRecipes = [];
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchFilters = {};
    }

    /**
     * 검색 UI 업데이트
     */
    async updateSearchResults(filters = {}) {
        try {
            this.showLoading('검색 중...');

            const searchParams = {
                ...filters,
                page: this.currentPage,
                size: this.pageSize
            };

            const result = await this.api.searchRecipes(searchParams);
            this.currentRecipes = result.data.recipes;

            this.renderRecipeList(result.data);
            this.updatePagination(result.data);

            // 성능 정보 표시
            if (result.performance) {
                this.showPerformanceInfo(result.performance);
            }

        } catch (error) {
            this.showError('검색 중 오류가 발생했습니다: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 레시피 목록 렌더링
     */
    renderRecipeList(data) {
        const container = document.getElementById('recipeListContainer');
        if (!container) return;

        const html = data.recipes.map(recipe => `
            <div class="recipe-card" data-recipe-id="${recipe.id}">
                <div class="recipe-header">
                    <h3>${recipe.recipe_name}</h3>
                    <span class="recipe-category">${recipe.category}</span>
                </div>
                <div class="recipe-info">
                    <span class="cost">₩${(recipe.cost_per_serving || 0).toLocaleString()}/인분</span>
                    <span class="ingredients">${recipe.ingredient_count || 0}개 재료</span>
                    <span class="popularity">인기도: ${recipe.popularity_score || 0}</span>
                </div>
                <div class="recipe-actions">
                    <button onclick="recipeUI.viewRecipe(${recipe.id})" class="btn-view">상세보기</button>
                    <button onclick="recipeUI.calculateCost(${recipe.id})" class="btn-cost">비용계산</button>
                    <button onclick="recipeUI.editRecipe(${recipe.id})" class="btn-edit">수정</button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;

        // 검색 결과 요약 표시
        this.showSearchSummary(data);
    }

    /**
     * 검색 결과 요약 표시
     */
    showSearchSummary(data) {
        const summaryEl = document.getElementById('searchSummary');
        if (!summaryEl) return;

        summaryEl.innerHTML = `
            <div class="search-summary">
                <span class="result-count">${data.total.toLocaleString()}개 레시피 발견</span>
                <span class="page-info">${data.page}/${data.total_pages} 페이지</span>
                ${data.search_params?.query ? `<span class="search-query">검색어: "${data.search_params.query}"</span>` : ''}
            </div>
        `;
    }

    /**
     * 성능 정보 표시
     */
    showPerformanceInfo(performance) {
        const perfEl = document.getElementById('performanceInfo');
        if (!perfEl) return;

        const isGood = performance.estimated_ms && performance.estimated_ms.includes('< 100ms');

        perfEl.innerHTML = `
            <div class="performance-info ${isGood ? 'good' : 'normal'}">
                <i class="fas fa-tachometer-alt"></i>
                <span>검색 성능: ${performance.estimated_ms || '측정 중'}</span>
                <small>${performance.optimized_for || ''}</small>
            </div>
        `;
    }

    /**
     * 비용 계산 모달 표시
     */
    async showCostCalculation(recipeId, options = {}) {
        try {
            this.showLoading('비용 계산 중...');

            const result = await this.api.calculateAdvancedCost(recipeId, {
                serving_count: options.servingCount || 1,
                include_trends: true,
                include_optimization: true
            });

            this.renderCostModal(result.data);

        } catch (error) {
            this.showError('비용 계산 중 오류: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 비용 계산 모달 렌더링
     */
    renderCostModal(data) {
        const modal = document.getElementById('costModal') || this.createCostModal();
        const content = modal.querySelector('.modal-content');

        const costSummary = data.cost_summary;
        const ingredients = data.ingredients_breakdown;
        const performance = data.performance;

        content.innerHTML = `
            <div class="modal-header">
                <h3>${data.recipe_name} - 비용 분석</h3>
                <button class="modal-close" onclick="recipeUI.closeCostModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="cost-summary">
                    <div class="cost-item">
                        <label>총 비용</label>
                        <span class="cost-value">₩${costSummary.total_cost.toLocaleString()}</span>
                    </div>
                    <div class="cost-item">
                        <label>1인분 비용</label>
                        <span class="cost-value">₩${costSummary.cost_per_serving.toLocaleString()}</span>
                    </div>
                    <div class="cost-item">
                        <label>가격 변동성</label>
                        <span class="volatility ${costSummary.price_volatility > 15 ? 'high' : 'normal'}">
                            ${costSummary.price_volatility}%
                        </span>
                    </div>
                    <div class="cost-item">
                        <label>비용 트렌드</label>
                        <span class="trend ${costSummary.cost_trend}">${costSummary.cost_trend}</span>
                    </div>
                </div>

                <div class="ingredients-breakdown">
                    <h4>재료별 비용 분석</h4>
                    <table class="ingredients-table">
                        <thead>
                            <tr>
                                <th>재료명</th>
                                <th>수량</th>
                                <th>단위</th>
                                <th>현재 단가</th>
                                <th>가격 변동</th>
                                <th>총 금액</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ingredients.map(ing => `
                                <tr>
                                    <td>${ing.ingredient_name}</td>
                                    <td>${ing.quantity}</td>
                                    <td>${ing.unit}</td>
                                    <td>₩${ing.current_price.toLocaleString()}</td>
                                    <td class="${Math.abs(ing.price_change_percent) > 10 ? 'high-change' : 'normal-change'}">
                                        ${ing.price_change_percent > 0 ? '+' : ''}${ing.price_change_percent.toFixed(1)}%
                                    </td>
                                    <td>₩${ing.total_amount.toLocaleString()}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="performance-info">
                    <small>
                        계산 시간: ${performance.calculation_time_ms}ms / 목표: ${performance.target_ms}ms
                        (${performance.ingredients_analyzed}개 재료 분석)
                    </small>
                </div>

                ${data.optimization_suggestions ? this.renderOptimizationSuggestions(data.optimization_suggestions) : ''}
            </div>
        `;

        modal.style.display = 'block';
    }

    /**
     * 최적화 제안 렌더링
     */
    renderOptimizationSuggestions(optimization) {
        if (!optimization.optimization_suggestions.length) {
            return '<div class="optimization-info">비용 최적화 제안이 없습니다.</div>';
        }

        return `
            <div class="optimization-suggestions">
                <h4>💡 비용 최적화 제안</h4>
                <div class="savings-summary">
                    절약 가능 금액: ₩${optimization.potential_savings.toLocaleString()}
                    (${optimization.savings_percentage}%)
                </div>
                <ul class="suggestions-list">
                    ${optimization.optimization_suggestions.map(suggestion => `
                        <li class="suggestion-item">
                            <strong>${suggestion.ingredient}</strong>
                            <p>${suggestion.recommendation || '공급업체 변경 검토'}</p>
                            ${suggestion.potential_saving ? `<span class="saving">절약: ₩${suggestion.potential_saving.toLocaleString()}</span>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    /**
     * 유틸리티 메서드들
     */
    showLoading(message = '로딩 중...') {
        // 로딩 스피너 표시
        const loader = document.getElementById('globalLoader');
        if (loader) {
            loader.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
            loader.style.display = 'flex';
        }
    }

    hideLoading() {
        const loader = document.getElementById('globalLoader');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    showError(message) {
        // 에러 메시지 표시
        console.error(message);
        alert(message); // 실제로는 더 나은 UI로 교체
    }

    // API 메서드 래퍼들
    async viewRecipe(recipeId) {
        try {
            const result = await this.api.getRecipe(recipeId, { include_ingredients: true });
            this.showRecipeDetail(result.data);
        } catch (error) {
            this.showError('레시피를 불러올 수 없습니다: ' + error.message);
        }
    }

    async calculateCost(recipeId) {
        await this.showCostCalculation(recipeId);
    }

    async editRecipe(recipeId) {
        // 레시피 편집 로직 구현
        console.log('Edit recipe:', recipeId);
    }

    createCostModal() {
        const modal = document.createElement('div');
        modal.id = 'costModal';
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal-content"></div>';
        document.body.appendChild(modal);
        return modal;
    }

    closeCostModal() {
        const modal = document.getElementById('costModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
}

// 전역 인스턴스
window.recipeAPI = new RecipeAPIManager();
window.recipeUI = new RecipeUIManager();

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Recipe API Integration Module Loaded');
    console.log('   - 30K+ recipes capacity');
    console.log('   - 84,215 ingredients integration');
    console.log('   - High-performance search & cost calculation');
});