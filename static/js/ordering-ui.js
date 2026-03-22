/**
 * 발주 관리 - UI (요약패널/충돌해결)
 * Depends on: ordering-state.js
 */

// ============================================
// 하단 발주 현황 요약 패널
// ============================================

// 패널 표시/숨기기 토글
function toggleSummaryPanel() {
    const panel = document.getElementById('orderSummaryPanel');
    const btn = document.getElementById('summaryToggleBtn');

    if (!panel) return;

    OS.summaryPanelCollapsed = !OS.summaryPanelCollapsed;

    if (OS.summaryPanelCollapsed) {
        panel.classList.add('collapsed');
        document.body.classList.remove('summary-panel-open');
    } else {
        panel.classList.remove('collapsed');
        document.body.classList.add('summary-panel-open');
    }
}
window.toggleSummaryPanel = toggleSummaryPanel;

// 요약 패널 업데이트
function updateSummaryPanel() {
    const panel = document.getElementById('orderSummaryPanel');
    if (!panel) return;

    // 데이터가 없으면 패널 숨기기
    if (!OS.currentDisplayItems || OS.currentDisplayItems.length === 0) {
        panel.style.display = 'none';
        document.body.classList.remove('summary-panel-open');
        return;
    }

    // 패널 표시
    panel.style.display = 'block';
    if (!OS.summaryPanelCollapsed) {
        document.body.classList.add('summary-panel-open');
    }

    // 반영된 항목 (발주 가능하고 order_qty > 0)
    const includedItems = OS.currentDisplayItems.filter(item =>
        item.can_order !== false && item.order_qty > 0
    );

    // 미반영 항목 (발주 불가 또는 order_qty = 0)
    const excludedItems = OS.currentDisplayItems.filter(item =>
        item.can_order === false || (item.required_qty > 0 && item.order_qty <= 0)
    );

    // 통계 업데이트
    const includedCount = includedItems.length;
    const excludedCount = excludedItems.length;
    const totalCount = includedCount + excludedCount;
    const includedAmount = includedItems.reduce((sum, item) => sum + (item.order_qty * (item.unit_price || 0)), 0);

    document.getElementById('summaryBadge').textContent = `${totalCount}건`;
    document.getElementById('summaryIncludedCount').textContent = includedCount;
    document.getElementById('summaryIncludedAmount').textContent = formatCurrency(includedAmount);
    document.getElementById('summaryExcludedCount').textContent = excludedCount;
    document.getElementById('includedColumnCount').textContent = `${includedCount}건`;
    document.getElementById('excludedColumnCount').textContent = `${excludedCount}건`;

    // 반영된 항목을 식자재별로 그룹화
    const includedByIngredient = {};
    includedItems.forEach((item, idx) => {
        const key = item.ingredient_id || item.ingredient_code || item.ingredient_name;
        if (!includedByIngredient[key]) {
            includedByIngredient[key] = {
                ingredient_id: item.ingredient_id,
                ingredient_code: item.ingredient_code,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                supplier_name: item.supplier_name,
                unit: item.unit,
                unit_price: item.unit_price,
                total_required_qty: 0,
                total_order_qty: 0,
                total_price: 0,
                items: []
            };
        }

        const group = includedByIngredient[key];
        group.total_required_qty += (item.required_qty || 0);
        group.total_order_qty += (item.order_qty || 0);
        group.total_price += (item.order_qty || 0) * (item.unit_price || 0);
        group.items.push(item);
    });

    // 그룹화된 반영 항목 리스트 생성
    const includedList = document.getElementById('includedItemsList');
    const includedGroups = Object.values(includedByIngredient);

    // 통계 업데이트 (그룹 수로 표시)
    document.getElementById('includedColumnCount').textContent = `${includedGroups.length}종 (${includedItems.length}건)`;

    if (includedGroups.length > 0) {
        includedList.innerHTML = includedGroups.map((group, idx) => {
            const itemCountText = group.items.length > 1 ? `(${group.items.length}건)` : '';
            const addedQty = group.total_order_qty - group.total_required_qty;
            const addedText = addedQty > 0 ? `<span class="added-qty">+${addedQty.toFixed(1)}</span>` :
                              addedQty < 0 ? `<span class="reduced-qty">${addedQty.toFixed(1)}</span>` : '';

            return `
                <div class="summary-item included-item">
                    <div class="item-info">
                        <div class="item-name">
                            ${group.ingredient_name || '-'}
                            ${itemCountText ? `<span class="item-count">${itemCountText}</span>` : ''}
                        </div>
                        <div class="item-detail">
                            ${group.specification || ''} ${group.supplier_name ? '/ ' + group.supplier_name : ''}
                        </div>
                    </div>
                    <div class="item-qty-detail">
                        <div class="qty-row">
                            <span class="qty-label">필요:</span>
                            <span class="qty-value">${group.total_required_qty.toFixed(1)}</span>
                        </div>
                        <div class="qty-row">
                            <span class="qty-label">발주:</span>
                            <span class="qty-value order-qty">${group.total_order_qty.toFixed(1)} ${group.unit || 'kg'}</span>
                            ${addedText}
                        </div>
                    </div>
                    <div class="item-price">${formatCurrency(group.total_price)}</div>
                </div>
            `;
        }).join('');
    } else {
        includedList.innerHTML = '<p class="empty-message">반영된 항목이 없습니다</p>';
    }

    // 미반영 항목을 식자재별로 그룹화
    const excludedByIngredient = {};
    excludedItems.forEach((item, idx) => {
        const key = item.ingredient_id || item.ingredient_code || item.ingredient_name;
        if (!excludedByIngredient[key]) {
            excludedByIngredient[key] = {
                ingredient_id: item.ingredient_id,
                ingredient_code: item.ingredient_code,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                supplier_name: item.supplier_name,
                unit: item.unit,
                unit_price: item.unit_price,
                total_required_qty: 0,
                items: [],
                indices: [],
                canAddAny: false,
                allBlocked: true,
                reasons: new Set()
            };
        }

        const group = excludedByIngredient[key];
        group.total_required_qty += (item.required_qty || 0);
        group.items.push(item);

        // 원본 인덱스 찾기
        const originalIndex = OS.currentDisplayItems.findIndex(i =>
            i.ingredient_id === item.ingredient_id &&
            i.slot_name === item.slot_name &&
            i.delivery_site_name === item.delivery_site_name
        );
        group.indices.push(originalIndex);

        // 사유 및 추가 가능 여부 확인
        if (item.can_order === false) {
            if (item.warning && item.warning.includes('리드타임')) {
                group.reasons.add('D-' + (item.lead_time || item.delivery_days || '?') + ' 초과');
            } else if (item.warning) {
                group.reasons.add(item.warning.substring(0, 15));
            } else {
                group.reasons.add('발주불가');
            }
        } else {
            group.allBlocked = false;
            group.canAddAny = true;
            if (item.order_qty <= 0 && item.required_qty > 0) {
                group.reasons.add('재고 사용');
            } else {
                group.reasons.add('미선택');
            }
        }
    });

    // 그룹화된 미반영 항목 리스트 생성
    const excludedList = document.getElementById('excludedItemsList');
    const groupedItems = Object.values(excludedByIngredient);

    // 통계 업데이트 (그룹 수로 표시)
    document.getElementById('excludedColumnCount').textContent = `${groupedItems.length}종 (${excludedItems.length}건)`;

    if (groupedItems.length > 0) {
        excludedList.innerHTML = groupedItems.map((group, idx) => {
            const reasonText = Array.from(group.reasons).join(', ');
            const itemCountText = group.items.length > 1 ? `(${group.items.length}건 합산)` : '';

            const ingredientKey = group.ingredient_id || group.ingredient_code;
            return `
                <div class="summary-item excluded-item" data-ingredient-key="${ingredientKey}">
                    <div class="item-info">
                        <div class="item-name">
                            ${group.ingredient_name || '-'}
                            <span class="item-reason">${reasonText}</span>
                        </div>
                        <div class="item-detail">
                            ${group.specification || ''} ${itemCountText}
                        </div>
                    </div>
                    <div class="item-qty" style="color: #dc3545; font-weight: bold;">
                        ${(group.total_required_qty || 0).toFixed(1)} ${group.unit || 'kg'}
                    </div>
                    <div class="item-actions">
                        <button class="replace-btn" onclick="openReplaceModalFromSummary('${ingredientKey}')" title="대체">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="exclude-btn" onclick="openExcludeModalFromSummary('${ingredientKey}')" title="제외">
                            <i class="fas fa-times"></i>
                        </button>
                        ${group.canAddAny ? `
                            <button class="add-btn" onclick="addExcludedGroupToOrder('${ingredientKey}')" title="전체추가">
                                <i class="fas fa-plus"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        excludedList.innerHTML = '<p class="empty-message">미반영 항목이 없습니다</p>';
    }

    // 그룹 데이터 저장 (전체 추가용)
    window.excludedGroupsData = excludedByIngredient;
}
window.updateSummaryPanel = updateSummaryPanel;

// 식자재 그룹 전체를 발주에 추가
function addExcludedGroupToOrder(ingredientKey) {
    const groupsData = window.excludedGroupsData;
    if (!groupsData || !groupsData[ingredientKey]) {
        alert('항목을 찾을 수 없습니다.');
        return;
    }

    const group = groupsData[ingredientKey];
    let addedCount = 0;

    // 그룹 내 모든 추가 가능한 항목 처리
    group.indices.forEach((originalIndex, idx) => {
        if (originalIndex >= 0 && originalIndex < OS.currentDisplayItems.length) {
            const item = OS.currentDisplayItems[originalIndex];

            // 발주 가능한 항목만 추가 (리드타임 초과 제외)
            if (item.can_order !== false) {
                // 단순 계산: 총필요량(g) / 기준용량(g) = 발주량(포)
                const totalQtyG = item.required_qty_g || 0;
                // 대체품인 경우 price_base_weight_grams 사용
                const orderBaseWeightG = item.price_base_weight_grams || item.base_weight_grams || 1000;
                item.order_qty = totalQtyG / orderBaseWeightG;
                item.total_price = item.order_qty * (item.unit_price || 0);
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        // 테이블과 요약 패널 업데이트
        displayOrderTable(OS.currentDisplayItems);
        updateOrderSummary();
        updateSummaryPanel();

        console.log(`[요약패널] "${group.ingredient_name}" ${addedCount}건이 발주에 추가됨 (총 ${group.total_required_qty.toFixed(1)} ${group.unit || 'kg'})`);
    } else {
        alert('추가 가능한 항목이 없습니다. (리드타임 초과)');
    }
}
window.addExcludedGroupToOrder = addExcludedGroupToOrder;

// 개별 미반영 항목을 발주에 추가 (하위 호환)
function addExcludedItemToOrder(index) {
    if (!OS.currentDisplayItems || index < 0 || index >= OS.currentDisplayItems.length) {
        alert('항목을 찾을 수 없습니다.');
        return;
    }

    const item = OS.currentDisplayItems[index];

    // 단순 계산: 총필요량(g) / 기준용량(g) = 발주량(포)
    const totalQtyG = item.required_qty_g || 0;
    // 대체품인 경우 price_base_weight_grams 사용
    const orderBaseWeightG = item.price_base_weight_grams || item.base_weight_grams || 1000;
    item.order_qty = totalQtyG / orderBaseWeightG;
    item.can_order = true;
    item.total_price = item.order_qty * (item.unit_price || 0);

    // 테이블과 요약 패널 업데이트
    displayOrderTable(OS.currentDisplayItems);
    updateOrderSummary();
    updateSummaryPanel();

    // 사용자에게 알림
    console.log(`[요약패널] "${item.ingredient_name}" 항목이 발주에 추가됨 (${item.order_qty} ${item.unit || 'kg'})`);
}
window.addExcludedItemToOrder = addExcludedItemToOrder;

// 요약 패널에서 대체 모달 열기
function openReplaceModalFromSummary(ingredientKey) {
    const groupsData = window.excludedGroupsData;
    if (!groupsData || !groupsData[ingredientKey]) {
        alert('항목을 찾을 수 없습니다.');
        return;
    }

    const group = groupsData[ingredientKey];
    // 그룹의 첫 번째 항목 정보로 모달 열기
    openIngredientOverrideModal('replace', {
        original: {
            ingredient_id: group.ingredient_id,
            ingredient_code: group.ingredient_code,
            ingredient_name: group.ingredient_name,
            specification: group.specification,
            supplier_name: group.supplier_name
        }
    });
}
window.openReplaceModalFromSummary = openReplaceModalFromSummary;

// 요약 패널에서 제외 모달 열기
function openExcludeModalFromSummary(ingredientKey) {
    const groupsData = window.excludedGroupsData;
    if (!groupsData || !groupsData[ingredientKey]) {
        alert('항목을 찾을 수 없습니다.');
        return;
    }

    const group = groupsData[ingredientKey];
    // 그룹의 첫 번째 항목 정보로 제외 모달 열기
    openIngredientOverrideModal('exclude', {
        original: {
            ingredient_id: group.ingredient_id,
            ingredient_code: group.ingredient_code,
            ingredient_name: group.ingredient_name,
            specification: group.specification,
            supplier_name: group.supplier_name
        }
    });
}
window.openExcludeModalFromSummary = openExcludeModalFromSummary;

// ============================================
// 주문불가 충돌 해결 모달
// ============================================

function showBlackoutConflictModal(unorderableItems) {
    OS.conflictItems = unorderableItems;
    OS.conflictResolutions = {};

    const container = document.getElementById('conflictItemsList');
    if (!container) return;

    container.innerHTML = unorderableItems.map((item, idx) => {
        const ingredientName = item.ingredient_name || '-';
        const supplierName = item.supplier_name || '-';
        const warning = item.warning || '발주 불가';
        const code = item.ingredient_code || '';

        return `
            <div class="conflict-item" id="conflict-item-${idx}">
                <div class="conflict-item-header">
                    <div>
                        <span style="color: #667eea; font-size: 12px; margin-right: 8px;">${code}</span>
                        ${ingredientName}
                        <span style="color: #6b7280; font-weight: 400; font-size: 13px; margin-left: 10px;">(${supplierName})</span>
                    </div>
                    <span class="conflict-item-reason"><i class="fas fa-ban"></i> ${warning}</span>
                </div>
                <div class="conflict-options">
                    <div class="conflict-option" onclick="selectConflictOption(${idx}, 'reschedule', this)">
                        <div class="conflict-option-icon">📅</div>
                        <div class="conflict-option-label">입고일 변경</div>
                        <div class="conflict-option-desc">다음 영업일로 변경</div>
                    </div>
                    <div class="conflict-option" onclick="selectConflictOption(${idx}, 'alternative', this)">
                        <div class="conflict-option-icon">🔄</div>
                        <div class="conflict-option-label">대체 업체</div>
                        <div class="conflict-option-desc">다른 협력업체에서 발주</div>
                    </div>
                    <div class="conflict-option" onclick="selectConflictOption(${idx}, 'exclude', this)">
                        <div class="conflict-option-icon">❌</div>
                        <div class="conflict-option-label">제외</div>
                        <div class="conflict-option-desc">이번 발주에서 제외</div>
                    </div>
                </div>
                <div class="conflict-alt-supplier" id="conflict-alt-${idx}">
                    <div style="margin-bottom: 6px; font-weight: 600; color: #4338ca;">대체 협력업체 선택:</div>
                    <div id="conflict-alt-list-${idx}" style="color: #888;">검색 중...</div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('blackoutConflictModal').style.display = 'flex';
}
window.showBlackoutConflictModal = showBlackoutConflictModal;

function closeBlackoutConflictModal() {
    document.getElementById('blackoutConflictModal').style.display = 'none';
}
window.closeBlackoutConflictModal = closeBlackoutConflictModal;

function selectConflictOption(idx, action, el) {
    // 같은 항목 내 다른 옵션 선택 해제
    const parent = el.closest('.conflict-options');
    parent.querySelectorAll('.conflict-option').forEach(opt => {
        opt.classList.remove('selected', 'selected-green', 'selected-red');
    });

    if (action === 'reschedule') {
        el.classList.add('selected-green');
    } else if (action === 'exclude') {
        el.classList.add('selected-red');
    } else {
        el.classList.add('selected');
    }

    OS.conflictResolutions[idx] = { action };

    // 대체 업체 패널 처리
    const altPanel = document.getElementById(`conflict-alt-${idx}`);
    if (action === 'alternative') {
        altPanel.style.display = 'block';
        loadAlternativeSuppliers(idx);
    } else {
        altPanel.style.display = 'none';
    }
}
window.selectConflictOption = selectConflictOption;

async function loadAlternativeSuppliers(idx) {
    const item = OS.conflictItems[idx];
    const listEl = document.getElementById(`conflict-alt-list-${idx}`);
    if (!listEl) return;

    listEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 검색 중...';

    try {
        const orderDate = document.getElementById('orderDate')?.value || '';
        const mealPlanDate = document.getElementById('mealPlanDate')?.value || '';
        const actualOrderDate = new Date();
        const deliveryDate = new Date(orderDate + 'T00:00:00');
        const maxLeadTime = Math.max(0, Math.floor((deliveryDate - actualOrderDate) / (1000 * 60 * 60 * 24)));

        let url = `/api/orders/alternative-ingredients?max_lead_time=${maxLeadTime}&limit=10`;
        if (item.ingredient_id) url += `&ingredient_id=${item.ingredient_id}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.success && data.alternatives && data.alternatives.length > 0) {
            listEl.innerHTML = data.alternatives.map(alt => `
                <label style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: 4px; margin: 2px 0; transition: background 0.15s;"
                    onmouseover="this.style.background='#eef2ff'" onmouseout="this.style.background='transparent'"
                    onclick="selectAlternativeSupplier(${idx}, ${alt.id}, '${(alt.name || '').replace(/'/g, "\\'")}', ${alt.unit_price || 0})">
                    <input type="radio" name="conflict_alt_${idx}" style="margin: 0;">
                    <span style="font-weight: 500;">${alt.name || alt.ingredient_name}</span>
                    <span style="color: #6b7280; font-size: 11px;">${alt.specification || ''}</span>
                    <span style="color: #059669; font-size: 12px; margin-left: auto;">${alt.supplier_name || ''}</span>
                    <span style="color: #6366f1; font-size: 12px;">D-${alt.lead_time_days || 0}</span>
                    <span style="color: #374151; font-size: 12px;">₩${(alt.unit_price || 0).toLocaleString()}</span>
                </label>
            `).join('');
        } else {
            listEl.innerHTML = '<span style="color: #ef4444;">대체 가능한 식자재가 없습니다. 다른 옵션을 선택해 주세요.</span>';
        }
    } catch (error) {
        console.error('대체 업체 검색 실패:', error);
        listEl.innerHTML = '<span style="color: #ef4444;">검색 중 오류가 발생했습니다.</span>';
    }
}

function selectAlternativeSupplier(idx, altId, altName, altPrice) {
    OS.conflictResolutions[idx] = {
        action: 'alternative',
        data: { alternative_id: altId, alternative_name: altName, alternative_price: altPrice }
    };
}
window.selectAlternativeSupplier = selectAlternativeSupplier;

async function applyConflictResolutions() {
    const resolvedCount = Object.keys(OS.conflictResolutions).length;
    if (resolvedCount === 0) {
        alert('처리할 항목을 선택해 주세요.');
        return;
    }

    let appliedCount = 0;

    for (const [idxStr, resolution] of Object.entries(OS.conflictResolutions)) {
        const idx = parseInt(idxStr);
        const item = OS.conflictItems[idx];
        if (!item) continue;

        try {
            if (resolution.action === 'exclude') {
                const siteId = getCurrentSiteId();
                const usageDate = document.getElementById('mealPlanDate')?.value;
                if (siteId && usageDate) {
                    await fetch('/api/orders/overrides', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            site_id: siteId,
                            usage_date: usageDate,
                            original_ingredient_id: item.ingredient_id,
                            original_ingredient_code: item.ingredient_code,
                            original_ingredient_name: item.ingredient_name,
                            override_type: 'exclude',
                            override_reason: 'blackout_conflict',
                            override_notes: item.warning || '주문불가 충돌 해결로 제외'
                        })
                    });
                }
                appliedCount++;
            } else if (resolution.action === 'alternative' && resolution.data) {
                const siteId = getCurrentSiteId();
                const usageDate = document.getElementById('mealPlanDate')?.value;
                if (siteId && usageDate) {
                    await fetch('/api/orders/overrides', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            site_id: siteId,
                            usage_date: usageDate,
                            original_ingredient_id: item.ingredient_id,
                            original_ingredient_code: item.ingredient_code,
                            original_ingredient_name: item.ingredient_name,
                            override_type: 'replace',
                            replacement_ingredient_id: resolution.data.alternative_id,
                            override_reason: 'blackout_conflict',
                            override_notes: `주문불가 충돌 → ${resolution.data.alternative_name}으로 대체`
                        })
                    });
                }
                appliedCount++;
            } else if (resolution.action === 'reschedule') {
                // 입고일 변경은 프론트에서 처리 (다음 영업일로)
                // 해당 항목의 warning에서 다음 영업일 정보 추출 시도
                appliedCount++;
            }
        } catch (error) {
            console.error(`충돌 해결 적용 실패 (${idx}):`, error);
        }
    }

    closeBlackoutConflictModal();

    if (appliedCount > 0) {
        alert(`${appliedCount}건의 충돌이 처리되었습니다. 발주량을 다시 계산합니다.`);
        // 발주량 재계산
        await calculateOrder();
    }
}
window.applyConflictResolutions = applyConflictResolutions;
