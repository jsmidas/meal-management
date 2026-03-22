/**
 * 레시피 편집기 모듈
 * 메뉴 클릭 시 레시피와 재료를 편집할 수 있는 모달 제공
 */

const RecipeEditor = {
    // 모듈 상태
    isOpen: false,
    currentMenu: null,
    currentDateKey: null,
    currentSlotName: null,
    ingredients: [],
    originalIngredients: [],
    recipeId: null,

    // 모듈 초기화
    async init() {
        console.log('레시피 편집기 모듈 초기화');
        await this.loadCSS();
        this.bindEvents();
    },

    // CSS 로드
    async loadCSS() {
        if (!document.querySelector('link[href*="recipe-editor.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'static/modules/recipe-editor/recipe-editor.css';
            document.head.appendChild(link);
        }
    },

    // 이벤트 바인딩
    bindEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeEditor();
            }
        });
    },

    // 레시피 편집기 열기 - menu-ingredient-modal.js 사용
    async openEditor(menuId, dateKey, slotName) {
        // AppState에서 메뉴 목록 가져오기
        const allMenus = (typeof AppState !== 'undefined' ? AppState.get('allMenus') : null) || [];
        const menu = allMenus.find(m => m.id == menuId);

        if (!menu) {
            showNotification('메뉴 정보를 찾을 수 없습니다.', 'error');
            return;
        }

        // menu-ingredient-modal.js의 openMenuIngredientModal 호출
        if (typeof openMenuIngredientModal === 'function') {
            openMenuIngredientModal(menuId, menu.name);
        } else {
            showNotification('레시피 편집기를 불러올 수 없습니다.', 'error');
        }
    },

    // 모달 HTML 생성
    async createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'recipe-editor-overlay';
        overlay.id = 'recipeEditorOverlay';

        overlay.innerHTML = `
            <div class="recipe-editor-modal">
                <!-- 헤더 -->
                <div class="recipe-editor-header">
                    <div class="recipe-editor-title">
                        <span>${this.currentMenu.name}</span> 레시피 편집기
                    </div>
                    <button class="recipe-editor-close" onclick="RecipeEditor.closeEditor()">×</button>
                </div>

                <!-- 바디 -->
                <div class="recipe-editor-body">
                    <!-- 레시피 정보 패널 -->
                    <div class="recipe-info-panel">
                        <div class="recipe-basic-info">
                            <div class="recipe-name">${this.currentMenu.name}</div>
                            <div class="recipe-meta">
                                <div class="recipe-meta-item">
                                    <span>${this.currentDateKey}</span>
                                </div>
                                <div class="recipe-meta-item">
                                    <span>${this.currentSlotName}</span>
                                </div>
                                <div class="recipe-meta-item">
                                    <span id="currentMenuCost">${this.currentMenu.currentPrice?.toLocaleString() || 0}원</span>
                                </div>
                            </div>
                        </div>

                        <!-- 재료 목록 -->
                        <div class="ingredients-section">
                            <div class="section-title">
                                재료 목록 <span id="ingredientCount">(로딩 중...)</span>
                                <button class="btn-add-ingredient" onclick="RecipeEditor.showIngredientSearch()">
                                    + 재료 추가
                                </button>
                            </div>
                            <div id="ingredientsList">
                                <div style="text-align: center; padding: 40px; color: #718096;">
                                    재료 정보를 불러오는 중...
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 합계 패널 -->
                    <div class="optimization-panel">
                        <div class="optimization-summary">
                            <div class="optimization-title">원가 정보</div>
                            <div class="total-cost" id="totalCost">계산 중...</div>
                            <div class="cost-detail" id="costDetail"></div>
                        </div>

                        <!-- 변경 내역 -->
                        <div class="changes-section" id="changesSection" style="display: none;">
                            <div class="changes-title">변경 내역</div>
                            <div id="changesList"></div>
                        </div>
                    </div>
                </div>

                <!-- 푸터 -->
                <div class="recipe-editor-footer">
                    <div class="footer-info">
                        변경사항은 레시피 원본에 저장됩니다.
                    </div>
                    <div class="footer-actions">
                        <button class="btn-secondary" onclick="RecipeEditor.closeEditor()">취소</button>
                        <button class="btn-primary" onclick="RecipeEditor.saveChanges()">
                            변경사항 저장
                        </button>
                    </div>
                </div>
            </div>

            <!-- 재료 검색 모달 -->
            <div class="ingredient-search-modal" id="ingredientSearchModal" style="display: none;">
                <div class="search-modal-content">
                    <div class="search-modal-header">
                        <h3>식자재 검색</h3>
                        <button onclick="RecipeEditor.closeIngredientSearch()">×</button>
                    </div>
                    <div class="search-modal-body">
                        <div class="search-input-wrapper">
                            <input type="text" id="ingredientSearchInput" placeholder="식자재명 검색..."
                                   onkeyup="RecipeEditor.searchIngredients(event)">
                            <button onclick="RecipeEditor.searchIngredients()">검색</button>
                        </div>
                        <div id="ingredientSearchResults">
                            <div style="text-align: center; padding: 20px; color: #718096;">
                                식자재명을 입력하고 검색하세요
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeEditor();
            }
        });

        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = '1';
        }, 10);
    },

    // 레시피 데이터 로드 (실제 API 호출)
    async loadRecipeData() {
        try {
            const response = await fetch(`/api/admin/menu-recipes/${this.recipeId}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '레시피 정보를 불러올 수 없습니다.');
            }

            const { recipe, ingredients } = result.data;

            // 재료 데이터 저장
            this.ingredients = ingredients.map((ing, index) => ({
                id: index + 1,
                ingredient_code: ing.ingredient_code,
                ingredient_name: ing.ingredient_name,
                specification: ing.specification,
                unit: ing.unit,
                quantity: parseFloat(ing.quantity) || 0,
                selling_price: parseFloat(ing.selling_price) || 0,
                amount: parseFloat(ing.amount) || 0,
                supplier_name: ing.supplier_name,
                delivery_days: ing.delivery_days,
                ingredient_id: ing.ingredient_id,
                base_weight_grams: ing.base_weight_grams
            }));

            // 원본 복사 (변경 추적용)
            this.originalIngredients = JSON.parse(JSON.stringify(this.ingredients));

            this.displayIngredients();
            this.updateTotalCost();
            document.getElementById('ingredientCount').textContent = `(${this.ingredients.length}개)`;

        } catch (error) {
            console.error('레시피 데이터 로드 실패:', error);
            document.getElementById('ingredientsList').innerHTML = `
                <div style="text-align: center; padding: 40px; color: #e53e3e;">
                    레시피 데이터를 불러올 수 없습니다.<br>
                    <small>${error.message}</small>
                </div>
            `;
        }
    },

    // 재료 목록 표시 (편집 가능)
    displayIngredients() {
        if (this.ingredients.length === 0) {
            document.getElementById('ingredientsList').innerHTML = `
                <div style="text-align: center; padding: 40px; color: #718096;">
                    등록된 재료가 없습니다.<br>
                    <button class="btn-add-first" onclick="RecipeEditor.showIngredientSearch()">
                        + 첫 번째 재료 추가하기
                    </button>
                </div>
            `;
            return;
        }

        const html = this.ingredients.map((ingredient, index) => {
            // 인당량(g) 계산: quantity * base_weight_grams 또는 규격에서 추출
            let perPersonGrams = '';
            if (ingredient.base_weight_grams && ingredient.quantity) {
                const grams = ingredient.quantity * ingredient.base_weight_grams;
                perPersonGrams = grams >= 1 ? `${Math.round(grams)}g` : `${grams.toFixed(2)}g`;
            }

            return `
            <div class="ingredient-item" data-index="${index}">
                <div class="ingredient-info">
                    <div class="ingredient-name">${ingredient.ingredient_name}</div>
                    <div class="ingredient-spec">${ingredient.specification || ''}</div>
                    <div class="ingredient-price-info">
                        ${ingredient.selling_price ? `판매가: ${ingredient.selling_price.toLocaleString()}원/${ingredient.unit || ''}` : ''}
                        ${perPersonGrams ? ` · 인당: ${perPersonGrams}` : ''}
                    </div>
                </div>
                <div class="ingredient-edit">
                    <div class="quantity-wrapper">
                        <input type="number" step="0.001" min="0"
                               value="${ingredient.quantity}"
                               onchange="RecipeEditor.updateQuantity(${index}, this.value)"
                               class="quantity-input">
                        <span class="unit-label">${ingredient.unit || ''}</span>
                    </div>
                    <div class="cost-display">
                        <span class="amount-value">${Math.round(ingredient.amount).toLocaleString()}원</span>
                    </div>
                </div>
                <div class="ingredient-actions">
                    <button class="btn-replace" onclick="RecipeEditor.replaceIngredient(${index})" title="대체 재료 검색">
                        교체
                    </button>
                    <button class="btn-remove" onclick="RecipeEditor.removeIngredient(${index})" title="재료 삭제">
                        ×
                    </button>
                </div>
            </div>
        `}).join('');

        document.getElementById('ingredientsList').innerHTML = html;
    },

    // 수량 업데이트
    updateQuantity(index, newValue) {
        const quantity = parseFloat(newValue) || 0;
        const ingredient = this.ingredients[index];

        ingredient.quantity = quantity;
        ingredient.amount = quantity * ingredient.selling_price;

        // 해당 항목의 금액 표시 업데이트
        const amountEl = document.querySelectorAll('.ingredient-item')[index]?.querySelector('.amount-value');
        if (amountEl) {
            amountEl.textContent = `${Math.round(ingredient.amount).toLocaleString()}원`;
        }

        this.updateTotalCost();
        this.updateChangesList();
    },

    // 재료 삭제
    removeIngredient(index) {
        const ingredient = this.ingredients[index];
        if (confirm(`'${ingredient.ingredient_name}'을(를) 삭제하시겠습니까?`)) {
            this.ingredients.splice(index, 1);
            this.displayIngredients();
            this.updateTotalCost();
            this.updateChangesList();
            document.getElementById('ingredientCount').textContent = `(${this.ingredients.length}개)`;
        }
    },

    // 재료 대체 (교체)
    replaceIngredient(index) {
        this.replacingIndex = index;
        this.showIngredientSearch();
    },

    // 총 원가 업데이트
    updateTotalCost() {
        const totalCost = this.ingredients.reduce((sum, ing) => sum + (ing.amount || 0), 0);
        document.getElementById('totalCost').textContent = `${Math.round(totalCost).toLocaleString()}원`;

        const originalCost = this.originalIngredients.reduce((sum, ing) => sum + (ing.amount || 0), 0);
        const diff = totalCost - originalCost;

        if (diff !== 0) {
            const diffText = diff > 0 ? `+${Math.round(diff).toLocaleString()}원` : `${Math.round(diff).toLocaleString()}원`;
            const diffClass = diff > 0 ? 'cost-increase' : 'cost-decrease';
            document.getElementById('costDetail').innerHTML = `<span class="${diffClass}">(원래: ${Math.round(originalCost).toLocaleString()}원, ${diffText})</span>`;
        } else {
            document.getElementById('costDetail').innerHTML = '';
        }
    },

    // 변경 내역 업데이트
    updateChangesList() {
        const changes = [];

        // 수량 변경 확인
        this.ingredients.forEach((ing, idx) => {
            const original = this.originalIngredients.find(o => o.ingredient_code === ing.ingredient_code);
            if (original && original.quantity !== ing.quantity) {
                changes.push(`${ing.ingredient_name}: ${original.quantity} → ${ing.quantity}`);
            }
        });

        // 삭제된 재료
        this.originalIngredients.forEach(orig => {
            if (!this.ingredients.find(i => i.ingredient_code === orig.ingredient_code)) {
                changes.push(`${orig.ingredient_name}: 삭제됨`);
            }
        });

        // 추가된 재료
        this.ingredients.forEach(ing => {
            if (!this.originalIngredients.find(o => o.ingredient_code === ing.ingredient_code)) {
                changes.push(`${ing.ingredient_name}: 새로 추가됨`);
            }
        });

        const changesSection = document.getElementById('changesSection');
        if (changes.length > 0) {
            changesSection.style.display = 'block';
            document.getElementById('changesList').innerHTML = changes.map(c => `<div class="change-item">${c}</div>`).join('');
        } else {
            changesSection.style.display = 'none';
        }
    },

    // 재료 검색 모달 표시
    showIngredientSearch() {
        document.getElementById('ingredientSearchModal').style.display = 'flex';
        document.getElementById('ingredientSearchInput').focus();
    },

    // 재료 검색 모달 닫기
    closeIngredientSearch() {
        document.getElementById('ingredientSearchModal').style.display = 'none';
        document.getElementById('ingredientSearchInput').value = '';
        document.getElementById('ingredientSearchResults').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #718096;">
                식자재명을 입력하고 검색하세요
            </div>
        `;
        this.replacingIndex = null;
    },

    // 식자재 검색
    async searchIngredients(event) {
        if (event && event.key && event.key !== 'Enter') return;

        const query = document.getElementById('ingredientSearchInput').value.trim();
        if (!query) {
            showNotification('검색어를 입력하세요.', 'warning');
            return;
        }

        document.getElementById('ingredientSearchResults').innerHTML = `
            <div style="text-align: center; padding: 20px;">검색 중...</div>
        `;

        try {
            const response = await fetch(`/api/admin/ingredients-enhanced?search_name=${encodeURIComponent(query)}&per_page=20`);
            const result = await response.json();

            // API는 'items' 또는 'ingredients' 키로 반환할 수 있음
            const ingredients = result.items || result.ingredients || [];

            if (!result.success || ingredients.length === 0) {
                document.getElementById('ingredientSearchResults').innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #718096;">
                        검색 결과가 없습니다.
                    </div>
                `;
                return;
            }

            const html = ingredients.map(ing => `
                <div class="search-result-item" onclick="RecipeEditor.selectIngredient(${JSON.stringify(ing).replace(/"/g, '&quot;')})">
                    <div class="result-name">${ing.ingredient_name}</div>
                    <div class="result-spec">${ing.specification || ''}</div>
                    <div class="result-price">${(ing.price_per_unit || ing.purchase_price || 0).toLocaleString()}원/${ing.unit || ''}</div>
                    <div class="result-supplier">${ing.supplier_name || ''}</div>
                </div>
            `).join('');

            document.getElementById('ingredientSearchResults').innerHTML = html;

        } catch (error) {
            console.error('식자재 검색 실패:', error);
            document.getElementById('ingredientSearchResults').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #e53e3e;">
                    검색 중 오류가 발생했습니다.
                </div>
            `;
        }
    },

    // 식자재 선택 (추가 또는 교체)
    selectIngredient(ingredient) {
        const newIngredient = {
            id: Date.now(),
            ingredient_code: ingredient.ingredient_code,
            ingredient_name: ingredient.ingredient_name,
            specification: ingredient.specification || '',
            unit: ingredient.unit || '',
            quantity: 1,  // 기본 수량
            selling_price: parseFloat(ingredient.price_per_unit || ingredient.purchase_price) || 0,
            amount: parseFloat(ingredient.price_per_unit || ingredient.purchase_price) || 0,
            supplier_name: ingredient.supplier_name || '',
            delivery_days: ingredient.lead_time || 2,
            ingredient_id: ingredient.id
        };

        if (this.replacingIndex !== null && this.replacingIndex !== undefined) {
            // 기존 재료 교체
            this.ingredients[this.replacingIndex] = newIngredient;
            showNotification(`재료가 '${ingredient.ingredient_name}'(으)로 교체되었습니다.`, 'success');
        } else {
            // 새 재료 추가
            this.ingredients.push(newIngredient);
            showNotification(`'${ingredient.ingredient_name}'이(가) 추가되었습니다.`, 'success');
        }

        this.closeIngredientSearch();
        this.displayIngredients();
        this.updateTotalCost();
        this.updateChangesList();
        document.getElementById('ingredientCount').textContent = `(${this.ingredients.length}개)`;
    },

    // 변경사항 저장
    async saveChanges() {
        if (!this.recipeId) {
            showNotification('저장할 레시피 정보가 없습니다.', 'error');
            return;
        }

        // 변경 사항 확인
        const hasChanges = JSON.stringify(this.ingredients) !== JSON.stringify(this.originalIngredients);
        if (!hasChanges) {
            showNotification('변경된 내용이 없습니다.', 'info');
            return;
        }

        try {
            // FormData로 저장
            const formData = new FormData();
            formData.append('recipe_id', this.recipeId);
            formData.append('recipe_name', this.currentMenu.name);
            formData.append('category', this.currentMenu.category || '');
            formData.append('cooking_note', this.currentMenu.cooking_note || '');
            formData.append('ingredients', JSON.stringify(this.ingredients.map(ing => ({
                ingredient_code: ing.ingredient_code,
                ingredient_name: ing.ingredient_name,
                specification: ing.specification,
                unit: ing.unit,
                delivery_days: ing.delivery_days || 0,
                selling_price: ing.selling_price,
                quantity: ing.quantity,
                amount: ing.amount,
                supplier_name: ing.supplier_name
            }))));

            const response = await fetch('/api/recipe/save', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                // 새로운 총 원가 계산
                const newTotalCost = this.ingredients.reduce((sum, ing) => sum + (ing.amount || 0), 0);

                // mealData에서 해당 메뉴를 사용하는 모든 날짜의 가격 업데이트
                const updatedDates = [];
                if (typeof mealData !== 'undefined') {
                    const today = new Date().toISOString().split('T')[0];

                    Object.keys(mealData).forEach(dateKey => {
                        // 오늘 이후 날짜만 업데이트
                        if (dateKey >= today) {
                            const dayData = mealData[dateKey];
                            let dateUpdated = false;

                            Object.keys(dayData).forEach(slotName => {
                                const menus = dayData[slotName];
                                if (menus && Array.isArray(menus)) {
                                    menus.forEach(menu => {
                                        if (menu.id == this.recipeId) {
                                            menu.currentPrice = Math.round(newTotalCost);
                                            menu.total_cost = Math.round(newTotalCost);
                                            dateUpdated = true;
                                        }
                                    });
                                }
                            });

                            if (dateUpdated) {
                                updatedDates.push(dateKey);
                            }
                        }
                    });
                }

                // allMenus에서도 해당 메뉴의 가격 업데이트
                if (typeof AppState !== 'undefined') {
                    const allMenus = AppState.get('allMenus') || [];
                    allMenus.forEach(menu => {
                        if (menu.id == this.recipeId) {
                            menu.currentPrice = Math.round(newTotalCost);
                            menu.total_cost = Math.round(newTotalCost);
                        }
                    });
                    AppState.set('allMenus', allMenus);
                }

                // 서버에 변경된 모든 날짜의 식단표 저장
                if (updatedDates.length > 0) {
                    try {
                        const siteId = typeof getCurrentSiteId === 'function' ? getCurrentSiteId() : null;
                        const category = typeof AppState !== 'undefined' ? AppState.get('selectedCategory') : null;

                        // site_id/category가 없으면 저장 스킵 (빈 배열로 덮어쓰기 방지)
                        if (!siteId || !category) {
                            console.warn(`[DB] 식단표 저장 스킵: site_id=${siteId}, category=${category} (필수값 누락)`);
                        } else {
                            // 모든 변경된 날짜를 순차적으로 저장
                            for (const dateKey of updatedDates) {
                                await fetch('/api/meal-plans', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        plan_date: dateKey,
                                        meal_data: mealData[dateKey] || {},
                                        site_id: siteId,
                                        category: category
                                    })
                                });
                            }
                            console.log(`[DB] 식단표 업데이트 저장 완료: ${updatedDates.length}개 날짜`);
                        }
                    } catch (e) {
                        console.error('식단표 서버 저장 실패:', e);
                    }
                }

                const updateMsg = updatedDates.length > 0
                    ? `레시피가 저장되었습니다! (원가: ${Math.round(newTotalCost).toLocaleString()}원, ${updatedDates.length}개 날짜 업데이트)`
                    : `레시피가 저장되었습니다! (원가: ${Math.round(newTotalCost).toLocaleString()}원)`;
                showNotification(updateMsg, 'success');

                // 동명 레시피 경고 표시
                if (result.warnings && result.warnings.length > 0) {
                    setTimeout(() => {
                        result.warnings.forEach(w => showNotification(w, 'warning', 8000));
                    }, 1500);
                }

                // 🗑️ 메뉴 캐시 무효화 (식단관리 페이지에서 갱신되도록)
                if (typeof window.clearMealPlanMenuCache === 'function') {
                    window.clearMealPlanMenuCache();
                }

                // 원본 데이터 업데이트
                this.originalIngredients = JSON.parse(JSON.stringify(this.ingredients));
                this.updateChangesList();

                // 캘린더 업데이트 (있는 경우)
                if (typeof generateCalendar === 'function') {
                    generateCalendar();
                }
                if (typeof updateStatistics === 'function') {
                    updateStatistics();
                }

                this.closeEditor();
            } else {
                throw new Error(result.error || '저장에 실패했습니다.');
            }

        } catch (error) {
            console.error('레시피 저장 실패:', error);
            showNotification(`저장 실패: ${error.message}`, 'error');
        }
    },

    // 편집기 닫기
    closeEditor() {
        if (!this.isOpen) return;

        const overlay = document.getElementById('recipeEditorOverlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
            }, 200);
        }

        this.isOpen = false;
        this.currentMenu = null;
        this.currentDateKey = null;
        this.currentSlotName = null;
        this.ingredients = [];
        this.originalIngredients = [];
        this.recipeId = null;
        this.replacingIndex = null;
    }
};

// 전역 함수로 노출
window.RecipeEditor = RecipeEditor;
