/**
 * 발주 관리 - Step 4/5 (협력업체별 수정/최종 발주서)
 * Depends on: ordering-state.js
 */

/**
 * Step 3 데이터 → Step 4 업체별 그룹핑 (깊은 복사)
 */
function buildStep4Data() {
    if (!OS.aggregatedOrderData || OS.aggregatedOrderData.length === 0) {
        alert('Step 3 발주 데이터가 없습니다. 먼저 발주량을 계산하세요.');
        return;
    }

    OS.step4Data = {};
    OS.step4Modifications = [];
    OS.step4OriginalSnapshot = {};

    // aggregatedOrderData를 업체별로 그룹핑
    OS.aggregatedOrderData.forEach((item, aggIdx) => {
        // 발주불가 품목 제외 (can_order === false)
        if (item.can_order === false) return;

        const supplier = item.supplier_name || '(업체미지정)';

        if (!OS.step4Data[supplier]) {
            OS.step4Data[supplier] = { items: [], collapsed: false };
        }

        // 깊은 복사 + 원본 정보 저장
        const clonedItem = JSON.parse(JSON.stringify(item));
        clonedItem._aggIndex = aggIdx;
        clonedItem._originalSupplier = supplier;
        clonedItem._originalQty = item.order_qty;
        clonedItem._originalPrice = item.total_price;
        clonedItem._modified = false;

        clonedItem._added = false;
        clonedItem._deleted = false;
        clonedItem._replaced = false;
        clonedItem._replacedFrom = null;

        OS.step4Data[supplier].items.push(clonedItem);
    });

    // 원본 스냅샷 저장 (비교용)
    OS.step4OriginalSnapshot = JSON.parse(JSON.stringify(OS.step4Data));

    // UI 표시
    document.getElementById('step4Section').style.display = 'block';
    renderStep4();
    renderStep5();

    // Step 4로 스크롤
    document.getElementById('step4Section').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Step 4 렌더링
 */
function renderStep4() {
    const container = document.getElementById('step4Content');
    let html = '';
    let totalSuppliers = 0;
    let totalItems = 0;
    let totalAmount = 0;

    const supplierNames = Object.keys(OS.step4Data).sort();

    supplierNames.forEach(supplier => {
        const group = OS.step4Data[supplier];
        const activeItems = group.items.filter(i => !i._deleted);
        if (activeItems.length === 0) return;

        totalSuppliers++;
        totalItems += activeItems.length;
        const supplierTotal = activeItems.reduce((sum, i) => sum + (i.total_price || 0), 0);
        totalAmount += supplierTotal;

        const isCollapsed = group.collapsed;
        const hasModified = activeItems.some(i => i._modified || i._added || i._replaced);

        html += `
            <div class="step4-supplier-card" data-supplier="${supplier}">
                <div class="step4-supplier-header" onclick="toggleStep4Supplier('${supplier.replace(/'/g, "\\'")}')">
                    <div class="step4-supplier-title">
                        <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}" id="step4Chevron_${supplier.replace(/[^a-zA-Z0-9가-힣]/g, '_')}"></i>
                        <i class="fas fa-building" style="color: #667eea;"></i>
                        <strong>${supplier}</strong>
                        <span style="color: #888; font-size: 13px;">${activeItems.length}건</span>
                        <span style="color: #28a745; font-weight: 600;">${formatCurrency(supplierTotal)}</span>
                        ${hasModified ? '<span class="badge badge-warning" style="margin-left: 6px;">수정됨</span>' : ''}
                    </div>
                    <div class="step4-supplier-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-success" style="padding: 4px 10px; font-size: 12px;" onclick="openStep4AddModal('${supplier.replace(/'/g, "\\'")}')">
                            <i class="fas fa-plus"></i> 추가
                        </button>
                    </div>
                </div>
                <div class="step4-supplier-body" id="step4Body_${supplier.replace(/[^a-zA-Z0-9가-힣]/g, '_')}" style="${isCollapsed ? 'display:none;' : ''}">
                    <table class="order-table step4-table">
                        <thead>
                            <tr>
                                <th style="width: 35px;">NO</th>
                                <th style="font-size: 0.7rem;">식자재코드</th>
                                <th style="text-align: left;">식자재명</th>
                                <th>규격</th>
                                <th>단위</th>
                                <th style="width: 85px;">발주량</th>
                                <th>단가</th>
                                <th>금액</th>
                                <th style="width: 90px;">액션</th>
                            </tr>
                        </thead>
                        <tbody>`;

        activeItems.forEach((item, idx) => {
            const realIdx = group.items.indexOf(item);
            const modClass = item._modified ? 'step4-modified' :
                            item._added ? 'step4-added' :
                            item._replaced ? 'step4-replaced' : '';

            html += `
                            <tr class="${modClass}">
                                <td>${idx + 1}</td>
                                <td style="font-size: 0.7rem; color: #888; max-width: 80px; overflow: hidden; text-overflow: ellipsis;" title="${item.ingredient_code || ''}">${item.ingredient_code || '-'}</td>
                                <td style="text-align: left;">
                                    ${item.ingredient_name || '-'}
                                    ${item._replaced ? `<br><small style="color: #8b5cf6;">(기존: ${item._replacedFrom})</small>` : ''}
                                </td>
                                <td>${item.specification || '-'}</td>
                                <td>${item.unit || '-'}</td>
                                <td>
                                    <input type="number" value="${item.order_qty || 0}" step="1" min="0"
                                           class="qty-input step4-qty-input"
                                           onchange="step4EditQty('${supplier.replace(/'/g, "\\'")}', ${realIdx}, this.value)"
                                           style="width: 75px; ${item._modified ? 'border-color: #2196F3; background: #e3f2fd;' : ''}">
                                </td>
                                <td style="text-align: right;">${formatCurrency(item.unit_price || 0)}</td>
                                <td style="text-align: right; font-weight: 600; color: #28a745;">${formatCurrency(item.total_price || 0)}</td>
                                <td>
                                    <button onclick="step4ReplaceItem('${supplier.replace(/'/g, "\\'")}', ${realIdx})" title="대체" style="padding: 4px 8px; background: #8b5cf6; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px;">
                                        <i class="fas fa-sync-alt"></i> 대체
                                    </button>
                                    <button onclick="step4DeleteItem('${supplier.replace(/'/g, "\\'")}', ${realIdx})" title="삭제" style="padding: 4px 8px; background: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px; margin-left: 3px;">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </td>
                            </tr>`;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>`;
    });

    container.innerHTML = html || '<p style="text-align: center; color: #999; padding: 20px;">표시할 품목이 없습니다.</p>';

    // 요약 업데이트
    document.getElementById('step4SupplierCount').textContent = totalSuppliers;
    document.getElementById('step4ItemCount').textContent = totalItems;
    document.getElementById('step4TotalAmount').textContent = formatCurrency(totalAmount);

    // 수정 뱃지
    const hasAnyMod = OS.step4Modifications.length > 0 ||
        Object.values(OS.step4Data).some(g => g.items.some(i => i._modified || i._added || i._replaced || i._deleted));
    document.getElementById('step4ModifiedBadge').style.display = hasAnyMod ? 'inline' : 'none';
}

/**
 * 업체 접기/펼치기
 */
function toggleStep4Supplier(supplier) {
    if (!OS.step4Data[supplier]) return;
    OS.step4Data[supplier].collapsed = !OS.step4Data[supplier].collapsed;
    const key = supplier.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    const body = document.getElementById(`step4Body_${key}`);
    const chevron = document.getElementById(`step4Chevron_${key}`);
    if (body) body.style.display = OS.step4Data[supplier].collapsed ? 'none' : '';
    if (chevron) {
        chevron.className = OS.step4Data[supplier].collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
    }
}

function toggleStep4All() {
    OS.step4AllCollapsed = !OS.step4AllCollapsed;
    Object.keys(OS.step4Data).forEach(s => {
        OS.step4Data[s].collapsed = OS.step4AllCollapsed;
    });
    renderStep4();
}

/**
 * 수량 편집
 */
function step4EditQty(supplier, itemIdx, newQty) {
    const item = OS.step4Data[supplier]?.items[itemIdx];
    if (!item) return;

    const qty = parseFloat(newQty) || 0;
    item.order_qty = qty;
    item.total_price = qty * (item.unit_price || 0);
    item._modified = true;

    OS.step4Modifications.push({
        type: 'qty_change', supplier, itemIdx,
        ingredient: item.ingredient_name,
        from: item._originalQty, to: qty
    });

    renderStep4();
    renderStep5();
}

/**
 * 삭제
 */
function step4DeleteItem(supplier, itemIdx) {
    const item = OS.step4Data[supplier]?.items[itemIdx];
    if (!item) return;

    if (!confirm(`"${item.ingredient_name}"을(를) 삭제하시겠습니까?`)) return;

    item._deleted = true;

    OS.step4Modifications.push({
        type: 'delete', supplier,
        ingredient: item.ingredient_name
    });

    renderStep4();
    renderStep5();
}

/**
 * 식자재 추가 - 모달 열기
 */
function openStep4AddModal(supplier) {
    OS.step4PendingAddSupplier = supplier;
    OS.step4PendingAddItem = null;
    document.getElementById('step4AddSupplierName').textContent = supplier;
    document.getElementById('step4AddSearchKeyword').value = '';
    document.getElementById('step4AddSearchSupplier').value = '';
    document.getElementById('step4AddSearchResults').innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 30px; color: #999;">검색어를 입력하세요.</td></tr>';
    document.getElementById('step4AddSelectedItem').style.display = 'none';
    document.getElementById('step4AddModal').classList.add('show');
    setTimeout(() => document.getElementById('step4AddSearchKeyword').focus(), 100);
}

function closeStep4AddModal() {
    document.getElementById('step4AddModal').classList.remove('show');
    OS.step4PendingAddSupplier = null;
    OS.step4PendingAddItem = null;
}

async function step4SearchAddIngredient() {
    const keyword = document.getElementById('step4AddSearchKeyword').value.trim();
    const supplierKeyword = document.getElementById('step4AddSearchSupplier').value.trim();
    if (!keyword && !supplierKeyword) {
        alert('식자재명 또는 협력업체명을 입력해주세요.');
        return;
    }

    const tbody = document.getElementById('step4AddSearchResults');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 검색 중...</td></tr>';

    try {
        let url = `/api/admin/ingredients-enhanced?size=50&sort_by=price_per_unit&sort_order=asc`;
        if (keyword) url += `&search_name=${encodeURIComponent(keyword)}`;
        if (supplierKeyword) url += `&search_supplier=${encodeURIComponent(supplierKeyword)}`;

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.items?.length > 0) {
            tbody.innerHTML = result.items.map((item, idx) => {
                const ppu = item.price_per_unit || item.단위당단가 || 0;
                const leadTime = item.lead_time || item.선발주일 || 0;
                return `
                <tr style="cursor: pointer;" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background=''"
                    onclick="step4SelectAddIngredient(${idx})">
                    <td style="font-size: 0.75rem; color: #888;">${item.ingredient_code || item.고유코드 || '-'}</td>
                    <td style="text-align: left; font-weight: 500;">${item.ingredient_name || item.식자재명}</td>
                    <td>${item.specification || item.규격 || '-'}</td>
                    <td>${item.unit || item.단위 || '-'}</td>
                    <td style="text-align: right; font-weight: 600; color: #28a745;">${formatCurrency(item.purchase_price || item.입고가 || 0)}</td>
                    <td style="text-align: right; color: #667eea;">${ppu > 0 ? ppu.toFixed(1) : '-'}</td>
                    <td style="text-align: center; color: #e65100; font-weight: 500;">${leadTime > 0 ? 'D-' + leadTime : '-'}</td>
                    <td>${item.supplier_name || item.거래처명 || '-'}</td>
                    <td><button class="btn btn-primary" style="padding: 3px 8px; font-size: 11px;">선택</button></td>
                </tr>`;
            }).join('');

            window._step4AddSearchItems = result.items;
        } else {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 30px; color: #999;">검색 결과가 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('식자재 검색 오류:', error);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 30px; color: #dc3545;">오류 발생</td></tr>';
    }
}

function step4SelectAddIngredient(idx) {
    const items = window._step4AddSearchItems;
    if (!items || !items[idx]) return;

    OS.step4PendingAddItem = items[idx];
    document.getElementById('step4AddSelectedName').textContent =
        `${items[idx].ingredient_name || items[idx].식자재명} (${items[idx].specification || items[idx].규격 || '-'})`;
    document.getElementById('step4AddQty').value = 1;
    document.getElementById('step4AddSelectedItem').style.display = 'block';
}

function confirmStep4Add() {
    if (!OS.step4PendingAddSupplier || !OS.step4PendingAddItem) return;

    const item = OS.step4PendingAddItem;
    const qty = parseFloat(document.getElementById('step4AddQty').value) || 1;
    const unitPrice = item.purchase_price || item.입고가 || 0;

    const newItem = {
        ingredient_id: item.id,
        ingredient_code: item.ingredient_code || item.고유코드 || '',
        ingredient_name: item.ingredient_name || item.식자재명 || '',
        specification: item.specification || item.규격 || '',
        unit: item.unit || item.단위 || '',
        supplier_name: OS.step4PendingAddSupplier,
        supplier_id: item.supplier_id,
        unit_price: unitPrice,
        order_qty: qty,
        total_price: qty * unitPrice,
        meal_count: 0,
        required_qty: 0,
        current_stock: 0,
        can_order: true,
        _aggIndex: -1,
        _originalSupplier: OS.step4PendingAddSupplier,
        _originalQty: 0,
        _originalPrice: 0,
        _modified: false,

        _added: true,
        _deleted: false,
        _replaced: false,
        _replacedFrom: null
    };

    if (!OS.step4Data[OS.step4PendingAddSupplier]) {
        OS.step4Data[OS.step4PendingAddSupplier] = { items: [], collapsed: false };
    }
    OS.step4Data[OS.step4PendingAddSupplier].items.push(newItem);

    OS.step4Modifications.push({
        type: 'add', supplier: OS.step4PendingAddSupplier,
        ingredient: newItem.ingredient_name, qty
    });

    closeStep4AddModal();
    renderStep4();
    renderStep5();
}

/**
 * 식자재 대체 - 모달 열기
 */
function step4ReplaceItem(supplier, itemIdx) {
    const item = OS.step4Data[supplier]?.items[itemIdx];
    if (!item) return;

    OS.step4PendingReplace = { supplier, itemIdx };

    // 원본 식자재 상세 정보 표시
    document.getElementById('step4ReplaceOriginalName').textContent = item.ingredient_name || '-';
    document.getElementById('step4ReplaceOriginalCode').textContent = item.ingredient_code || '';
    document.getElementById('step4ReplaceOriginalSpec').textContent = item.specification || '';
    document.getElementById('step4ReplaceOriginalSupplier').textContent = item.supplier_name || '';
    document.getElementById('step4ReplaceOriginalPrice').textContent = formatCurrency(item.unit_price || 0);

    document.getElementById('step4ReplaceSearchKeyword').value = '';
    document.getElementById('step4ReplaceSearchSupplier').value = '';
    document.getElementById('step4ReplaceSearchResults').innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 30px; color: #999;">검색어를 입력하세요.</td></tr>';
    document.getElementById('step4ReplaceModal').classList.add('show');
    setTimeout(() => document.getElementById('step4ReplaceSearchKeyword').focus(), 100);
}

function closeStep4ReplaceModal() {
    document.getElementById('step4ReplaceModal').classList.remove('show');
    OS.step4PendingReplace = null;
}

async function step4SearchReplacementIngredient() {
    const keyword = document.getElementById('step4ReplaceSearchKeyword').value.trim();
    const supplierKeyword = document.getElementById('step4ReplaceSearchSupplier').value.trim();
    if (!keyword && !supplierKeyword) {
        alert('식자재명 또는 협력업체명을 입력해주세요.');
        return;
    }

    const tbody = document.getElementById('step4ReplaceSearchResults');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 검색 중...</td></tr>';

    try {
        let url = `/api/admin/ingredients-enhanced?size=50&sort_by=price_per_unit&sort_order=asc`;
        if (keyword) url += `&search_name=${encodeURIComponent(keyword)}`;
        if (supplierKeyword) url += `&search_supplier=${encodeURIComponent(supplierKeyword)}`;

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.items?.length > 0) {
            tbody.innerHTML = result.items.map((item, idx) => {
                const ppu = item.price_per_unit || item.단위당단가 || 0;
                const leadTime = item.lead_time || item.선발주일 || 0;
                const baseWeight = item.base_weight_grams || item.기준용량g || 0;
                return `
                <tr style="cursor: pointer;" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background=''"
                    onclick="step4ConfirmReplace(${idx})">
                    <td style="font-size: 0.75rem; color: #888;">${item.ingredient_code || item.고유코드 || '-'}</td>
                    <td style="text-align: left; font-weight: 500;">${item.ingredient_name || item.식자재명}</td>
                    <td>${item.specification || item.규격 || '-'}</td>
                    <td>${item.unit || item.단위 || '-'}</td>
                    <td style="text-align: right; font-weight: 600; color: #28a745;">${formatCurrency(item.purchase_price || item.입고가 || 0)}</td>
                    <td style="text-align: right; color: #667eea;">${ppu > 0 ? ppu.toFixed(1) : '-'}</td>
                    <td style="text-align: center;">${baseWeight > 0 ? baseWeight + 'g' : '-'}</td>
                    <td style="text-align: center; color: #e65100; font-weight: 500;">${leadTime > 0 ? 'D-' + leadTime : '-'}</td>
                    <td>${item.supplier_name || item.거래처명 || '-'}</td>
                    <td><button class="btn btn-primary" style="padding: 3px 8px; font-size: 11px;">선택</button></td>
                </tr>`;
            }).join('');

            window._step4ReplaceSearchItems = result.items;
        } else {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 30px; color: #999;">검색 결과가 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('식자재 검색 오류:', error);
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 30px; color: #dc3545;">오류 발생</td></tr>';
    }
}

async function step4ConfirmReplace(searchIdx) {
    if (!OS.step4PendingReplace) return;

    const items = window._step4ReplaceSearchItems;
    if (!items || !items[searchIdx]) return;

    const { supplier, itemIdx } = OS.step4PendingReplace;
    const original = OS.step4Data[supplier]?.items[itemIdx];
    if (!original) return;

    const replacement = items[searchIdx];
    const originalName = original.ingredient_name;

    // 원래 식자재 정보 보존
    const originalIngredientId = original.ingredient_id;
    const originalIngredientCode = original.ingredient_code;

    // 대체 식자재 정보로 업데이트
    original.ingredient_id = replacement.id;
    original.ingredient_code = replacement.ingredient_code || replacement.고유코드 || '';
    original.ingredient_name = replacement.ingredient_name || replacement.식자재명 || '';
    original.specification = replacement.specification || replacement.규격 || '';
    original.unit = replacement.unit || replacement.단위 || '';
    original.supplier_name = replacement.supplier_name || replacement.거래처명 || original.supplier_name;
    original.unit_price = replacement.purchase_price || replacement.입고가 || 0;
    original.total_price = original.order_qty * original.unit_price;
    original._replaced = true;
    original._replacedFrom = originalName;

    // 오버라이드 레코드 생성 (지시서 반영용)
    try {
        const siteId = getCurrentSiteId();
        const usageDate = document.getElementById('mealPlanDate')?.value;
        if (siteId && usageDate) {
            await fetch('/api/orders/overrides', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    site_id: siteId,
                    usage_date: usageDate,
                    original_ingredient_id: originalIngredientId,
                    original_ingredient_code: originalIngredientCode,
                    original_ingredient_name: originalName,
                    override_type: 'replace',
                    replacement_ingredient_id: replacement.id,
                    replacement_ingredient_code: replacement.ingredient_code || replacement.고유코드,
                    replacement_ingredient_name: replacement.ingredient_name || replacement.식자재명,
                    replacement_specification: replacement.specification || replacement.규격,
                    replacement_supplier_name: replacement.supplier_name || replacement.거래처명,
                    replacement_unit_price: replacement.purchase_price || replacement.입고가,
                    replacement_unit: replacement.unit || replacement.단위,
                    override_reason: 'manual',
                    override_notes: `Step 4 수동 대체: ${originalName} → ${replacement.ingredient_name || replacement.식자재명}`
                })
            });
        }
    } catch (e) {
        console.error('오버라이드 저장 실패:', e);
    }

    OS.step4Modifications.push({
        type: 'replace', supplier,
        from: originalName,
        to: original.ingredient_name
    });

    closeStep4ReplaceModal();
    renderStep4();
    renderStep5();
}

// ============================================
// Step 5: 수정 반영 최종 발주서
// ============================================

/**
 * Step 4 데이터를 flat 리스트로 합쳐서 Step 5 렌더링
 */
function renderStep5() {
    if (!OS.step4Data || Object.keys(OS.step4Data).length === 0) return;

    const finalItems = getStep5FinalItems();
    const tbody = document.getElementById('step5TableBody');

    if (finalItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" style="text-align: center; padding: 2rem; color: #666;">품목이 없습니다.</td></tr>';
        document.getElementById('step5Section').style.display = 'block';
        return;
    }

    let html = '';
    let rowNum = 1;
    let totalAmount = 0;
    let modCounts = { modified: 0, deleted: 0, added: 0, replaced: 0 };

    finalItems.forEach(item => {
        totalAmount += item.total_price || 0;

        let bgStyle = '';
        let changeBadge = '';

        if (item._replaced) {
            bgStyle = 'background: #f3e8ff;';
            changeBadge = `<span class="badge" style="background: #8b5cf6; color: white;">대체</span><br><small style="color: #8b5cf6;">${item._replacedFrom} →</small>`;
            modCounts.replaced++;
        } else if (item._added) {
            bgStyle = 'background: #dcfce7;';
            changeBadge = '<span class="badge" style="background: #28a745; color: white;">추가</span>';
            modCounts.added++;
        } else if (item._modified) {
            bgStyle = 'background: #dbeafe;';
            changeBadge = `<span class="badge" style="background: #2196F3; color: white;">수정</span><br><small style="color: #2196F3;">(${item._originalQty}→${item.order_qty})</small>`;
            modCounts.modified++;
        }

        html += `
            <tr style="${bgStyle}">
                <td>${rowNum++}</td>
                <td style="font-size: 0.75rem; color: #666;">${item.ingredient_code || '-'}</td>
                <td style="text-align: left;">${item.ingredient_name || '-'}</td>
                <td style="font-size: 0.8rem;">${item.specification || '-'}</td>
                <td>${item.supplier_name || '-'}</td>
                <td>${item.unit || '-'}</td>
                <td style="color: #667eea; font-weight: 600;">${(item.meal_count || 0).toLocaleString()}</td>
                <td>${(item.required_qty || 0).toFixed(2)}</td>
                <td>${Number(item.current_stock || 0).toFixed(2)}</td>
                <td style="font-weight: 600;">${item.order_qty}</td>
                <td style="text-align: right;">${formatCurrency(item.unit_price || 0)}</td>
                <td style="font-weight: 600; color: #28a745; text-align: right;">${formatCurrency(item.total_price || 0)}</td>
                <td style="font-size: 0.85rem;">${item.expected_delivery_date || '-'}</td>
                <td>${changeBadge || '<span style="color: #ccc;">-</span>'}</td>
            </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('step5TotalAmount').textContent = formatCurrency(totalAmount);

    // 변경 요약
    const summaryEl = document.getElementById('step5ChangeSummary');
    const totalMods = modCounts.modified + modCounts.deleted + modCounts.added + modCounts.replaced;
    if (totalMods > 0) {
        const parts = [];
        if (modCounts.modified) parts.push(`<span style="color: #2196F3;">수량수정 ${modCounts.modified}건</span>`);
        if (modCounts.replaced) parts.push(`<span style="color: #8b5cf6;">식자재대체 ${modCounts.replaced}건</span>`);
        if (modCounts.added) parts.push(`<span style="color: #28a745;">추가 ${modCounts.added}건</span>`);
        summaryEl.innerHTML = `<i class="fas fa-info-circle" style="color: #f59e0b;"></i> 변경사항: ${parts.join(' | ')}`;
        summaryEl.style.display = 'block';
    } else {
        summaryEl.style.display = 'none';
    }

    document.getElementById('step5Section').style.display = 'block';
}

/**
 * Step 4 데이터 → flat 리스트 (삭제 항목 제외)
 */
function getStep5FinalItems() {
    const items = [];
    Object.keys(OS.step4Data).forEach(supplier => {
        OS.step4Data[supplier].items.forEach(item => {
            if (!item._deleted) {
                items.push({ ...item });
            }
        });
    });
    return items;
}

/**
 * Step 5에서 저장 (Step 4/5 데이터 사용)
 */
async function saveOrderFromStep5() {
    const finalItems = getStep5FinalItems();
    if (finalItems.length === 0) {
        alert('저장할 품목이 없습니다.');
        return;
    }

    // Step 4 변경사항 → override 레코드 자동 생성 (조리/소분지시서 반영용)
    await saveStep4Overrides();

    // Step 3의 currentDisplayItems를 Step 5 데이터로 교체
    const originalDisplayItems = OS.currentDisplayItems;
    const originalAggData = OS.aggregatedOrderData;

    try {
        // Step 5 데이터를 currentDisplayItems와 aggregatedOrderData에 반영
        OS.currentDisplayItems = finalItems;
        OS.aggregatedOrderData = finalItems;

        // 기존 saveOrder 호출
        await saveOrder();
    } finally {
        // 복원 (saveOrder 성공 여부에 관계없이)
        OS.currentDisplayItems = originalDisplayItems;
        OS.aggregatedOrderData = originalAggData;
    }
}

/**
 * Step 4 수량변경/삭제 → qty_adjust/exclude override 자동 생성
 * 조리지시서, 소분지시서에서 비율 기반으로 반영됨
 */
async function saveStep4Overrides() {
    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate')?.value;
    if (!siteId || !usageDate) return;

    // 1) 기존 qty_adjust/exclude override 일괄 삭제 (재저장 시 중복 방지)
    try {
        await fetch(`/api/orders/overrides/bulk-delete?site_id=${siteId}&usage_date=${usageDate}&types=qty_adjust,exclude`, {
            method: 'DELETE'
        });
    } catch (e) {
        console.warn('기존 override 삭제 실패:', e);
    }

    // 2) step4Data 순회하며 수량변경/삭제 항목에 대해 override 생성
    const overridePromises = [];
    for (const supplier of Object.keys(OS.step4Data)) {
        for (const item of OS.step4Data[supplier].items) {
            // 수량 변경 항목 → qty_adjust override
            if (item._modified && !item._deleted && !item._added && !item._replaced) {
                const originalQty = item._originalQty || 0;
                if (originalQty > 0) {
                    const ratio = item.order_qty / originalQty;
                    if (Math.abs(ratio - 1.0) > 0.001) {
                        overridePromises.push(
                            fetch('/api/orders/overrides', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    site_id: siteId,
                                    usage_date: usageDate,
                                    override_type: 'qty_adjust',
                                    original_ingredient_id: item.ingredient_id,
                                    original_ingredient_name: item.ingredient_name,
                                    added_quantity: ratio,
                                    override_notes: `발주량 변경: ${originalQty} → ${item.order_qty}`
                                })
                            }).catch(e => console.warn('qty_adjust override 저장 실패:', e))
                        );
                    }
                }
            }

            // 삭제 항목 → exclude override
            if (item._deleted && !item._added) {
                overridePromises.push(
                    fetch('/api/orders/overrides', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            site_id: siteId,
                            usage_date: usageDate,
                            override_type: 'exclude',
                            original_ingredient_id: item.ingredient_id,
                            original_ingredient_name: item.ingredient_name,
                            override_notes: `Step 4에서 삭제됨`
                        })
                    }).catch(e => console.warn('exclude override 저장 실패:', e))
                );
            }
        }
    }

    // 모든 override 병렬 저장
    if (overridePromises.length > 0) {
        await Promise.all(overridePromises);
        console.log(`[Step4] ${overridePromises.length}건 override 저장 완료`);
    }
}

/**
 * Step 5 엑셀 내보내기
 */
function exportStep5ToExcel() {
    const items = getStep5FinalItems();
    if (!items || items.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    const data = [];
    data.push(["순번", "식자재코드", "식자재명", "규격", "협력업체", "단위", "발주량", "단가", "금액", "변경사항"]);

    items.forEach((item, index) => {
        let change = '';
        if (item._replaced) change = `대체(${item._replacedFrom})`;
        else if (item._added) change = '추가';
        else if (item._modified) change = `수정(${item._originalQty}→${item.order_qty})`;

        data.push([
            index + 1,
            item.ingredient_code || '',
            item.ingredient_name || '',
            item.specification || '',
            item.supplier_name || '',
            item.unit || '',
            item.order_qty || 0,
            item.unit_price || 0,
            Math.round(item.total_price || 0),
            change
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
        { wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 20 }, { wch: 15 },
        { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 25 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Step5_수정발주서");
    XLSX.writeFile(wb, `Step5_수정발주서_${document.getElementById('orderDate').value}.xlsx`);
}

/**
 * Step 5 PDF 내보내기
 */
function exportStep5ToPdf() {
    const items = getStep5FinalItems();
    if (!items || items.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    // Step 3의 exportToPdf 로직 재활용 (Step 5 데이터로)
    const originalAgg = OS.aggregatedOrderData;
    OS.aggregatedOrderData = items;
    try {
        exportToPdf();
    } finally {
        OS.aggregatedOrderData = originalAgg;
    }
}

// ============================================
// Step 3 → Step 4 전환 버튼 (displayOrderTable 후 호출됨)
// ============================================

/**
 * Step 4 진입 버튼 추가 (displayOrderTable 후 호출됨)
 */
function addStep4ButtonToOrderTable() {
    const actionBtns = document.querySelector('#orderSection .action-buttons');
    if (actionBtns && !document.getElementById('goToStep4Btn')) {
        const btn = document.createElement('button');
        btn.id = 'goToStep4Btn';
        btn.className = 'btn btn-primary';
        btn.innerHTML = '<i class="fas fa-building"></i> 협력업체별 수정 (Step 4)';
        btn.onclick = buildStep4Data;
        const saveBtn = document.getElementById('saveOrderBtn');
        if (saveBtn) {
            actionBtns.insertBefore(btn, saveBtn);
        } else {
            actionBtns.appendChild(btn);
        }
    }
}
