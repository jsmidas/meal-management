/**
 * 발주 관리 - 식자재 오버라이드 (대체/추가/제외)
 * Depends on: ordering-state.js
 */

// ============================================
// 식자재 오버라이드 (대체/추가/제외) 기능
// ============================================

/**
 * 식자재 오버라이드 모달 열기
 * @param {string} overrideType - 'replace', 'add', 'exclude'
 * @param {object} context - 컨텍스트 정보 (원본 식자재, 레시피 등)
 */
function openIngredientOverrideModal(overrideType, context = {}) {
    OS.currentOverrideContext = context;

    // 모달 초기화
    const modal = document.getElementById('ingredientOverrideModal');

    // 타입 선택 초기화
    document.querySelectorAll('.override-type-option').forEach(opt => {
        opt.classList.remove('selected');
        opt.style.borderColor = '#ddd';
    });
    const selectedOption = document.querySelector(`.override-type-option[data-type="${overrideType}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
        selectedOption.querySelector('input[type="radio"]').checked = true;
    }

    // 섹션 표시/숨김 업데이트
    updateOverrideModalSections(overrideType);

    // 원본 식자재 정보 표시
    if (context.original) {
        document.getElementById('overrideOriginalId').value = context.original.ingredient_id || '';
        document.getElementById('overrideOriginalCode').value = context.original.ingredient_code || '';
        document.getElementById('overrideOriginalName').textContent = context.original.ingredient_name || '-';
        document.getElementById('overrideOriginalSpec').textContent = context.original.specification || '-';
        document.getElementById('overrideOriginalLeadTime').textContent = `D-${context.original.lead_time || context.original.delivery_days || '?'}`;
        document.getElementById('overrideOriginalSupplier').textContent = context.original.supplier_name || '-';
    }

    // 레시피 정보 표시
    if (context.recipe) {
        document.getElementById('overrideRecipeId').value = context.recipe.recipe_id || context.recipe.id || '';
        document.getElementById('overrideRecipeName').textContent = context.recipe.recipe_name || context.recipe.menu_name || '-';
        document.getElementById('overrideSlotName').textContent = context.recipe.slot_name || '-';
    }

    // 검색 결과 초기화
    document.getElementById('overrideSearchKeyword').value = '';
    document.getElementById('overrideSearchResults').innerHTML = `
        <tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">
            검색어를 입력하거나 [추천] 버튼을 클릭하세요.
        </td></tr>
    `;

    // 선택된 대체 식자재 초기화
    clearSelectedReplacement();

    // 사유 기본값
    if (overrideType === 'exclude') {
        document.getElementById('overrideReason').value = 'not_needed';
    } else {
        document.getElementById('overrideReason').value = 'lead_time_exceeded';
    }
    document.getElementById('overrideNotes').value = '';

    // 모달 표시
    modal.classList.add('show');

    // 자동 추천 로드 (대체 시)
    if (overrideType === 'replace' && context.original) {
        setTimeout(() => loadRecommendedAlternatives(), 300);
    }
}

/**
 * 오버라이드 타입에 따라 모달 섹션 표시/숨김
 */
function updateOverrideModalSections(overrideType) {
    const originalSection = document.getElementById('originalIngredientSection');
    const recipeSection = document.getElementById('recipeInfoSection');
    const searchSection = document.getElementById('replacementSearchSection');
    const addQtySection = document.getElementById('addQuantitySection');
    const selectedSection = document.getElementById('selectedReplacementSection');

    // 타이틀 업데이트
    const titleMap = {
        'replace': '식자재 대체',
        'add': '식자재 추가',
        'exclude': '식자재 제외'
    };
    document.getElementById('overrideModalTitle').textContent = titleMap[overrideType] || '식자재 변경';
    document.getElementById('searchSectionTitle').textContent =
        overrideType === 'add' ? '추가할 식자재 검색' : '대체 식자재 검색';
    document.getElementById('saveOverrideBtnText').textContent =
        overrideType === 'exclude' ? '제외 적용' : '적용';

    // 섹션 표시/숨김
    originalSection.style.display = (overrideType === 'replace' || overrideType === 'exclude') ? 'block' : 'none';
    recipeSection.style.display = overrideType === 'add' ? 'block' : 'none';
    searchSection.style.display = overrideType !== 'exclude' ? 'block' : 'none';
    addQtySection.style.display = overrideType === 'add' ? 'block' : 'none';

    // 제외 시 버튼 스타일 변경
    const saveBtn = document.getElementById('saveOverrideBtn');
    if (overrideType === 'exclude') {
        saveBtn.style.background = 'linear-gradient(135deg, #dc3545, #c82333)';
    } else {
        saveBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #feca57)';
    }
}

/**
 * 오버라이드 타입 변경 이벤트
 */
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.override-type-option').forEach(opt => {
        opt.addEventListener('click', function() {
            const overrideType = this.dataset.type;

            // 선택 표시 업데이트
            document.querySelectorAll('.override-type-option').forEach(o => {
                o.classList.remove('selected');
                o.style.borderColor = '#ddd';
            });
            this.classList.add('selected');
            this.querySelector('input[type="radio"]').checked = true;

            // 섹션 업데이트
            updateOverrideModalSections(overrideType);
        });
    });
});

function closeIngredientOverrideModal() {
    document.getElementById('ingredientOverrideModal').classList.remove('show');
    OS.currentOverrideContext = {};
}

/**
 * 대체 가능 식자재 검색
 */
async function searchAlternativeIngredients() {
    const keyword = document.getElementById('overrideSearchKeyword').value.trim();
    if (!keyword) {
        alert('검색어를 입력해주세요.');
        return;
    }

    const tbody = document.getElementById('overrideSearchResults');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 30px; color: #495057;"><i class="fas fa-spinner fa-spin"></i> 검색 중...</td></tr>';

    try {
        // 현재 설정된 입고예정일 기준 최대 선발주일 계산
        const orderDate = document.getElementById('orderDate')?.value;
        const now = new Date();
        const orderCutoffHour = 16;  // 발주 마감 시간

        // 실제 발주일 계산 (16시 이후면 내일)
        let actualOrderDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() >= orderCutoffHour) {
            actualOrderDate.setDate(actualOrderDate.getDate() + 1);
        }

        let maxLeadTime = 7;  // 기본값
        if (orderDate) {
            const orderDateObj = new Date(orderDate + 'T00:00:00');  // 시간 제거
            // 입고예정일 - 실제발주일 = 허용 선발주일
            maxLeadTime = Math.round((orderDateObj - actualOrderDate) / (1000 * 60 * 60 * 24));
            if (maxLeadTime < 0) maxLeadTime = 0;
        }
        console.log(`[대체검색] 실제발주일: ${actualOrderDate.toISOString().split('T')[0]}, 입고예정일: ${orderDate}, maxLeadTime: D-${maxLeadTime}`);

        const response = await fetch(`/api/admin/ingredients-enhanced?search_name=${encodeURIComponent(keyword)}&size=30&sort_by=price_per_unit&sort_order=asc`);
        const result = await response.json();

        if (result.success && result.items && result.items.length > 0) {
            renderAlternativeResults(result.items, maxLeadTime);
        } else {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">검색 결과가 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('검색 오류:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #dc3545;">오류가 발생했습니다.</td></tr>';
    }
}

/**
 * 추천 대체 식자재 로드 (같은 카테고리)
 */
async function loadRecommendedAlternatives() {
    const tbody = document.getElementById('overrideSearchResults');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 30px; color: #495057;"><i class="fas fa-spinner fa-spin"></i> 추천 로드 중...</td></tr>';

    try {
        const originalId = document.getElementById('overrideOriginalId').value;
        const orderDate = document.getElementById('orderDate')?.value;
        const now = new Date();
        const orderCutoffHour = 16;  // 발주 마감 시간

        // 실제 발주일 계산 (16시 이후면 내일)
        let actualOrderDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() >= orderCutoffHour) {
            actualOrderDate.setDate(actualOrderDate.getDate() + 1);
        }

        let maxLeadTime = 7;
        if (orderDate) {
            const orderDateObj = new Date(orderDate + 'T00:00:00');
            maxLeadTime = Math.round((orderDateObj - actualOrderDate) / (1000 * 60 * 60 * 24));
            if (maxLeadTime < 0) maxLeadTime = 0;
        }
        console.log(`[추천검색] 실제발주일: ${actualOrderDate.toISOString().split('T')[0]}, 입고예정일: ${orderDate}, maxLeadTime: D-${maxLeadTime}`);

        let url = `/api/orders/alternative-ingredients?max_lead_time=${maxLeadTime}&limit=30`;
        if (originalId) {
            url += `&ingredient_id=${originalId}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.items && result.items.length > 0) {
            renderAlternativeResults(result.items, maxLeadTime);
        } else {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">추천 식자재가 없습니다. 검색어로 직접 검색해보세요.</td></tr>';
        }
    } catch (error) {
        console.error('추천 로드 오류:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #dc3545;">오류가 발생했습니다.</td></tr>';
    }
}

/**
 * 대체 식자재 검색 결과 렌더링
 */
function renderAlternativeResults(items, maxLeadTime) {
    const tbody = document.getElementById('overrideSearchResults');

    // ★ 단위당 단가 기준 오름차순 정렬 (저단가 우선)
    const sortedItems = [...items].sort((a, b) => {
        const priceA = a.price_per_unit || 999999999;
        const priceB = b.price_per_unit || 999999999;
        return priceA - priceB;
    });

    tbody.innerHTML = sortedItems.map(item => {
        const leadTime = item.lead_time || parseInt(item.delivery_days) || 2;
        const canOrder = leadTime <= maxLeadTime;
        const price = item.purchase_price || item.unit_price || 0;
        const pricePerUnit = item.price_per_unit || 0;

        // 단가 표시 (원 단위)
        const priceDisplay = price > 0 ? Math.round(price).toLocaleString() : '-';
        // 단위당 단가 표시 (원/g 또는 원/EA)
        const pricePerUnitDisplay = pricePerUnit > 0
            ? `₩${pricePerUnit.toFixed(1)}`
            : '-';

        return `
            <tr style="cursor: pointer; transition: background 0.15s; ${!canOrder ? 'background: #fff5f5;' : ''}"
                onmouseover="this.style.background='${canOrder ? '#e8f4ff' : '#ffe8e8'}'"
                onmouseout="this.style.background='${canOrder ? '' : '#fff5f5'}'"
                onclick='selectReplacementIngredient(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6;">
                    <div style="font-weight: 600; color: #212529;">${item.ingredient_name || ''}</div>
                    <div style="font-size: 0.85em; color: #6c757d;">${item.ingredient_code || ''}</div>
                </td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: #495057;">${item.specification || '-'}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: #495057; text-align: center;">${item.unit || '-'}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: #212529; font-weight: 500; text-align: right;">${priceDisplay}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: #0d6efd; font-weight: 700; text-align: right;">${pricePerUnitDisplay}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; text-align: center;">
                    <span style="color: ${canOrder ? '#198754' : '#dc3545'}; font-weight: 700;">D-${leadTime}</span>
                    ${!canOrder ? '<br><small style="color: #dc3545; font-weight: 500;">발주불가</small>' : ''}
                </td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: #495057;">${item.supplier_name || '-'}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; text-align: center;">
                    <button style="padding: 5px 12px; background: ${canOrder ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#adb5bd'}; border: none; border-radius: 4px; color: white; font-size: 12px; font-weight: 600; cursor: pointer;">
                        선택
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * 대체 식자재 선택
 */
function selectReplacementIngredient(item) {
    document.getElementById('selectedReplacementId').value = item.id || '';
    document.getElementById('selectedReplacementCode').value = item.ingredient_code || '';
    document.getElementById('selectedReplacementName').textContent = item.ingredient_name || '-';
    document.getElementById('selectedReplacementSpec').textContent = item.specification || '';
    document.getElementById('selectedReplacementLeadTime').textContent = `D-${item.lead_time || item.delivery_days || 2}`;
    document.getElementById('selectedReplacementPrice').value = item.purchase_price || item.unit_price || 0;
    document.getElementById('selectedReplacementUnit').value = item.unit || '';
    document.getElementById('selectedReplacementSupplier').value = item.supplier_name || '';
    document.getElementById('selectedReplacementLeadTimeValue').value = item.lead_time || item.delivery_days || 2;

    // 선택 섹션 표시
    document.getElementById('selectedReplacementSection').style.display = 'block';
}

/**
 * 선택된 대체 식자재 초기화
 */
function clearSelectedReplacement() {
    document.getElementById('selectedReplacementId').value = '';
    document.getElementById('selectedReplacementCode').value = '';
    document.getElementById('selectedReplacementName').textContent = '-';
    document.getElementById('selectedReplacementSpec').textContent = '';
    document.getElementById('selectedReplacementLeadTime').textContent = '';
    document.getElementById('selectedReplacementPrice').value = '';
    document.getElementById('selectedReplacementUnit').value = '';
    document.getElementById('selectedReplacementSupplier').value = '';
    document.getElementById('selectedReplacementLeadTimeValue').value = '';
    document.getElementById('selectedReplacementSection').style.display = 'none';
}

/**
 * 오버라이드 임시 저장 (메모리에만 저장, 발주서 저장 시 DB에 저장)
 */
async function saveIngredientOverride() {
    const overrideType = document.querySelector('input[name="overrideType"]:checked')?.value || 'replace';
    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate')?.value;

    if (!siteId || !usageDate) {
        alert('사업장과 식단표 날짜를 먼저 선택해주세요.');
        return;
    }

    // 유효성 검사
    if (overrideType === 'replace' || overrideType === 'add') {
        const replacementId = document.getElementById('selectedReplacementId').value;
        if (!replacementId) {
            alert('대체/추가할 식자재를 선택해주세요.');
            return;
        }
    }

    // 데이터 구성
    const data = {
        site_id: siteId,
        usage_date: usageDate,
        override_type: overrideType,
        override_reason: document.getElementById('overrideReason').value,
        override_notes: document.getElementById('overrideNotes').value
    };

    // 원본 식자재 정보 (대체/제외 시)
    if (overrideType === 'replace' || overrideType === 'exclude') {
        data.original_ingredient_id = parseInt(document.getElementById('overrideOriginalId').value) || null;
        data.original_ingredient_code = document.getElementById('overrideOriginalCode').value;
        data.original_ingredient_name = document.getElementById('overrideOriginalName').textContent;
    }

    // 레시피 정보 (추가 시)
    if (overrideType === 'add') {
        data.recipe_id = parseInt(document.getElementById('overrideRecipeId').value) || null;
        data.recipe_name = document.getElementById('overrideRecipeName').textContent;
    }

    // 대체/추가 식자재 정보
    if (overrideType === 'replace' || overrideType === 'add') {
        data.replacement_ingredient_id = parseInt(document.getElementById('selectedReplacementId').value) || null;
        data.replacement_ingredient_code = document.getElementById('selectedReplacementCode').value;
        data.replacement_ingredient_name = document.getElementById('selectedReplacementName').textContent;
        data.replacement_specification = document.getElementById('selectedReplacementSpec').textContent;
        data.replacement_supplier_name = document.getElementById('selectedReplacementSupplier').value;
        data.replacement_unit_price = parseFloat(document.getElementById('selectedReplacementPrice').value) || 0;
        data.replacement_unit = document.getElementById('selectedReplacementUnit').value;
        data.replacement_lead_time = parseInt(document.getElementById('selectedReplacementLeadTimeValue').value) || 2;
    }

    // 추가 시 수량 정보
    if (overrideType === 'add') {
        data.added_quantity = parseFloat(document.getElementById('overrideAddQuantity').value) || 0;
        data.added_unit = document.getElementById('overrideAddUnit').value;
    }

    // ★ DB에 즉시 저장 (API 호출)
    try {
        const response = await fetch('/api/orders/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!result.success) {
            alert('오버라이드 저장 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        const typeLabels = { replace: '대체', add: '추가', exclude: '제외' };
        console.log(`[오버라이드] ${typeLabels[overrideType]} 저장 완료: ${data.original_ingredient_name || ''} → ${data.replacement_ingredient_name || '(제외)'}`);

        closeIngredientOverrideModal();

        // ★★★ 재계산 없이 오버라이드 목록만 새로고침 ★★★
        // 사용자가 여러 항목을 처리한 후 "전체 적용" 버튼으로 한번에 재계산
        await refreshOverridesOnly();

        // 알림 표시
        showToast(`${typeLabels[overrideType]} 설정이 저장되었습니다. 모든 처리 완료 후 "전체 적용" 버튼을 눌러주세요.`, 'success');
    } catch (error) {
        console.error('오버라이드 저장 오류:', error);
        alert('오버라이드 저장 중 오류가 발생했습니다.');
    }
}

/**
 * 오버라이드 목록만 새로고침 (재계산 없이)
 */
async function refreshOverridesOnly() {
    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate')?.value;

    if (!siteId || !usageDate) return;

    try {
        const response = await fetch(`/api/orders/overrides?site_id=${siteId}&usage_date=${usageDate}`);
        const result = await response.json();

        if (result.success && result.overrides) {
            OS.currentOverrides = result.overrides;
            updateOverrideIndicators();
            updateApplyAllButton();
        }
    } catch (error) {
        console.error('오버라이드 목록 새로고침 오류:', error);
    }
}

/**
 * 미반영 항목에 오버라이드 처리됨 표시 업데이트
 */
function updateOverrideIndicators() {
    if (!OS.currentOverrides || OS.currentOverrides.length === 0) return;

    // 오버라이드된 식자재 코드/ID 목록
    const overriddenItems = new Set();
    OS.currentOverrides.forEach(o => {
        if (o.original_ingredient_code) overriddenItems.add(o.original_ingredient_code);
        if (o.original_ingredient_id) overriddenItems.add(String(o.original_ingredient_id));
    });

    // 미반영 항목 리스트에서 처리됨 표시
    const excludedList = document.getElementById('excludedItemsList');
    if (excludedList) {
        const items = excludedList.querySelectorAll('.summary-item');
        items.forEach(item => {
            const itemName = item.querySelector('.item-name');
            if (itemName) {
                // 이미 처리됨 배지가 있으면 제거
                const existingBadge = item.querySelector('.processed-badge');
                if (existingBadge) existingBadge.remove();

                // 해당 항목이 오버라이드되었는지 확인
                const ingredientKey = item.dataset?.ingredientKey;
                if (ingredientKey && overriddenItems.has(ingredientKey)) {
                    const badge = document.createElement('span');
                    badge.className = 'processed-badge';
                    badge.innerHTML = '<i class="fas fa-check"></i> 처리됨';
                    badge.style.cssText = 'background: #28a745; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;';
                    itemName.appendChild(badge);
                }
            }
        });
    }
}

/**
 * "전체 적용" 버튼 표시/업데이트
 */
function updateApplyAllButton() {
    let applyBtn = document.getElementById('applyAllOverridesBtn');
    const summaryPanel = document.getElementById('summaryPanel');

    if (OS.currentOverrides && OS.currentOverrides.length > 0) {
        if (!applyBtn && summaryPanel) {
            // 버튼 생성
            applyBtn = document.createElement('button');
            applyBtn.id = 'applyAllOverridesBtn';
            applyBtn.className = 'btn btn-primary';
            applyBtn.innerHTML = '<i class="fas fa-sync"></i> 전체 적용 및 재계산';
            applyBtn.style.cssText = 'position: fixed; bottom: 80px; right: 20px; z-index: 1000; padding: 12px 20px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            applyBtn.onclick = applyAllOverridesAndRecalculate;
            document.body.appendChild(applyBtn);
        }

        if (applyBtn) {
            applyBtn.innerHTML = `<i class="fas fa-sync"></i> 전체 적용 (${OS.currentOverrides.length}건)`;
            applyBtn.style.display = 'block';
        }
    } else if (applyBtn) {
        applyBtn.style.display = 'none';
    }
}

/**
 * 모든 오버라이드 적용 후 재계산
 */
async function applyAllOverridesAndRecalculate() {
    if (!OS.currentOverrides || OS.currentOverrides.length === 0) {
        alert('적용할 변경 설정이 없습니다.');
        return;
    }

    if (!confirm(`${OS.currentOverrides.length}건의 변경 설정을 적용하고 발주량을 재계산합니다.\n\n진행하시겠습니까?`)) {
        return;
    }

    showLoading('변경 설정 적용 및 재계산 중...');
    try {
        await executeCalculateOrder();
        showToast('변경 설정이 적용되었습니다.', 'success');
    } finally {
        hideLoading();
    }
}
window.applyAllOverridesAndRecalculate = applyAllOverridesAndRecalculate;

/**
 * 오버라이드 삭제
 */
async function deleteOverride(overrideId) {
    if (!confirm('이 변경 설정을 삭제하시겠습니까?')) {
        return;
    }

    try {
        const response = await fetch(`/api/orders/overrides/${overrideId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            // 발주량 재계산
            await executeCalculateOrder();
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('오버라이드 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

/**
 * 오버라이드 요약 패널 렌더링
 */
async function renderOverrideSummaryPanel() {
    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate')?.value;

    if (!siteId || !usageDate) return;

    try {
        const response = await fetch(`/api/orders/overrides?site_id=${siteId}&usage_date=${usageDate}`);
        const result = await response.json();

        if (result.success && result.overrides && result.overrides.length > 0) {
            OS.currentOverrides = result.overrides;

            // 요약 패널 HTML 생성
            const panelHtml = `
                <div class="override-summary-panel" id="overrideSummaryPanel">
                    <div style="font-weight: 600; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span><i class="fas fa-exchange-alt" style="color: #667eea;"></i> 이번 발주서 변경 내역 (${result.overrides.length}건)</span>
                        <button onclick="clearAllOverrides()" style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 12px;">
                            <i class="fas fa-trash"></i> 전체 삭제
                        </button>
                    </div>
                    ${result.overrides.map(o => {
                        const typeLabels = { replace: '대체', add: '추가', exclude: '제외' };
                        const typeIcons = { replace: 'sync-alt', add: 'plus-circle', exclude: 'times-circle' };
                        let description = '';

                        if (o.override_type === 'replace') {
                            description = `${o.original_ingredient_name} → ${o.replacement_ingredient_name}`;
                        } else if (o.override_type === 'add') {
                            description = `${o.recipe_name}: ${o.replacement_ingredient_name} ${o.added_quantity}${o.added_unit}`;
                        } else if (o.override_type === 'exclude') {
                            description = `${o.original_ingredient_name}`;
                        }

                        return `
                            <div class="override-summary-item ${o.override_type}">
                                <span>
                                    <i class="fas fa-${typeIcons[o.override_type]}"></i>
                                    [${typeLabels[o.override_type]}] ${description}
                                </span>
                                <button class="override-remove-btn" onclick="deleteOverride(${o.id})">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // 기존 패널 제거 후 Step 3 상단에 삽입
            const existingPanel = document.getElementById('overrideSummaryPanel');
            if (existingPanel) existingPanel.remove();

            const orderSection = document.getElementById('orderSection');
            if (orderSection) {
                const cardTitle = orderSection.querySelector('.card-title');
                if (cardTitle) {
                    cardTitle.insertAdjacentHTML('afterend', panelHtml);
                }
            }
        } else {
            // 오버라이드 없으면 패널 제거
            const existingPanel = document.getElementById('overrideSummaryPanel');
            if (existingPanel) existingPanel.remove();
            OS.currentOverrides = [];
        }
    } catch (error) {
        console.error('오버라이드 목록 로드 오류:', error);
    }
}

/**
 * 전체 오버라이드 삭제
 */
async function clearAllOverrides() {
    if (!confirm('모든 변경 설정을 삭제하시겠습니까?\n\n원래 식자재로 복원됩니다.')) {
        return;
    }

    showLoading('변경 설정 삭제 중...');

    try {
        for (const o of OS.currentOverrides) {
            await fetch(`/api/orders/overrides/${o.id}`, { method: 'DELETE' });
        }

        // 발주량 재계산
        await executeCalculateOrder();
    } catch (error) {
        console.error('전체 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

/**
 * 발주 불가 품목에 대체/제외 버튼 추가 (displayOrderTable 호출 후 실행)
 */
function addOverrideButtonsToUnorderableItems() {
    if (!OS.aggregatedOrderData) {
        console.log('[Override] aggregatedOrderData is null');
        return;
    }

    console.log('[Override] Checking items:', OS.aggregatedOrderData.length);
    const unorderableItems = OS.aggregatedOrderData.filter(item => item.can_order === false);
    console.log('[Override] Unorderable items count:', unorderableItems.length);

    OS.aggregatedOrderData.forEach((item, index) => {
        if (item.can_order === false) {
            console.log('[Override] Found unorderable item:', index, item.ingredient_name);
            const row = document.querySelector(`tr[data-agg-index="${index}"]`);
            if (row) {
                const statusCell = row.querySelector('td:last-child');
                if (statusCell && !statusCell.querySelector('.cannot-order-actions')) {
                    // DOM 요소 생성하여 이벤트 리스너 직접 연결
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'cannot-order-actions';

                    const replaceBtn = document.createElement('button');
                    replaceBtn.className = 'btn-replace';
                    replaceBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 대체';
                    replaceBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openReplaceModal(index);
                    });

                    const excludeBtn = document.createElement('button');
                    excludeBtn.className = 'btn-exclude';
                    excludeBtn.innerHTML = '<i class="fas fa-times"></i> 제외';
                    excludeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openExcludeModal(index);
                    });

                    actionsDiv.appendChild(replaceBtn);
                    actionsDiv.appendChild(excludeBtn);
                    statusCell.appendChild(actionsDiv);
                }
            }
        }
    });
}

/**
 * 대체 모달 열기 (발주 불가 품목에서)
 */
function openReplaceModal(aggIndex) {
    const item = OS.aggregatedOrderData[aggIndex];
    if (!item) return;

    openIngredientOverrideModal('replace', {
        original: {
            ingredient_id: item.ingredient_id,
            ingredient_code: item.ingredient_code,
            ingredient_name: item.ingredient_name,
            specification: item.specification,
            lead_time: item.lead_time || item.delivery_days,
            supplier_name: item.supplier_name
        }
    });
}

/**
 * 제외 모달 열기 (발주 불가 품목에서)
 */
function openExcludeModal(aggIndex) {
    const item = OS.aggregatedOrderData[aggIndex];
    if (!item) return;

    openIngredientOverrideModal('exclude', {
        original: {
            ingredient_id: item.ingredient_id,
            ingredient_code: item.ingredient_code,
            ingredient_name: item.ingredient_name,
            specification: item.specification,
            lead_time: item.lead_time || item.delivery_days,
            supplier_name: item.supplier_name
        }
    });
}

// 글로벌 함수 노출 (인라인 onclick에서 사용)
window.openReplaceModalByIndex = function(index) {
    openReplaceModal(index);
};
window.openExcludeModalByIndex = function(index) {
    openExcludeModal(index);
};
