/**
 * 발주 관리 - 메인 모듈
 * 초기화, 발주 계산, 저장, 확정, 도착지 로드
 * Depends on: ordering-state.js
 */

// ============================================
// 초기화
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    const today = new Date();

    // 식단표 날짜: 5일 후
    const mealPlanDate = new Date(today);
    mealPlanDate.setDate(today.getDate() + 5);

    // 입고날짜: 3일 후
    const orderDate = new Date(today);
    orderDate.setDate(today.getDate() + 3);

    document.getElementById('orderDate').value = getLocalDateString(orderDate);
    document.getElementById('mealPlanDate').value = getLocalDateString(mealPlanDate);

    // 수동 추가용 날짜: 오늘 기본값
    const manualDateEl = document.getElementById('manualDate');
    if (manualDateEl) manualDateEl.value = getLocalDateString(today);

    // 브랜딩 적용
    if (typeof BrandingManager !== 'undefined') {
        BrandingManager.applyBranding('발주 관리');
    }

    // 사업장 선택기 및 창고 로드
    initializeAsync();
});

async function initializeAsync() {
    if (typeof SiteSelector !== 'undefined') {
        SiteSelector.init('ordering-site-selector').then(() => {
            SiteSelector.on('siteChange', function (context) {
                console.log('사업장 변경:', context);
                loadWarehouses();
                resetOrder();
            });
            loadWarehouses();
        });
    } else {
        loadWarehouses();
    }
}

// ============================================
// 발주량 올림 방식 함수
// ============================================
function getSelectedRoundingMethod() {
    const selected = document.querySelector('input[name="roundingMethod"]:checked');
    return selected ? selected.value : 'threshold';
}

function applyRounding(value, method) {
    const original = parseFloat(value) || 0;
    const intPart = Math.floor(original);
    const decPart = original - intPart;

    if (decPart === 0) {
        return { rounded: original, wasRounded: false, direction: null };
    }

    let rounded, direction;
    switch (method) {
        case 'ceil':
            rounded = intPart + 1;
            direction = 'up';
            break;
        case 'round':
            if (decPart >= 0.5) {
                rounded = intPart + 1;
                direction = 'up';
            } else {
                rounded = intPart;
                direction = 'down';
            }
            break;
        case 'threshold':
        default:
            if (decPart >= 0.3) {
                rounded = intPart + 1;
                direction = 'up';
            } else {
                rounded = intPart;
                direction = 'down';
            }
            break;
    }

    return {
        rounded,
        wasRounded: true,
        direction,
        original: original.toFixed(2)
    };
}

function generateRoundedQtyInput(originalQty, index, canOrder) {
    const method = getSelectedRoundingMethod();
    const result = applyRounding(originalQty, method);

    let style = '';
    let tooltip = '';

    if (result.wasRounded) {
        const arrow = result.direction === 'up' ? '\u2191' : '\u2193';
        style = 'color: #2196F3; font-weight: bold; border: 2px solid #2196F3 !important; background: #e3f2fd !important;';
        tooltip = `title="원래 값: ${result.original} ${arrow} ${result.rounded}로 ${result.direction === 'up' ? '올림' : '내림'}"`;
    }

    if (!canOrder) {
        style = 'background:#f5f5f5;';
    }

    if (OS.aggregatedOrderData && OS.aggregatedOrderData[index]) {
        OS.aggregatedOrderData[index].original_order_qty = originalQty;
        OS.aggregatedOrderData[index].order_qty = result.rounded;
        OS.aggregatedOrderData[index].was_rounded = result.wasRounded;
        OS.aggregatedOrderData[index].total_price = result.rounded * (OS.aggregatedOrderData[index].unit_price || 0);
    }

    return `<input type="number" value="${result.rounded}" step="1" min="0"
                   data-agg-index="${index}" data-original="${originalQty}" class="qty-input"
                   onchange="updateAggregatedItemTotal(${index})"
                   ${!canOrder ? 'disabled' : ''} ${tooltip}
                   style="${style}">`;
}

function onRoundingMethodChange() {
    if (OS.aggregatedOrderData && OS.aggregatedOrderData.length > 0) {
        displayOrderTable(OS.aggregatedOrderData);
        updateOrderSummary();
    }
}

// 라디오 버튼 이벤트 등록
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('input[name="roundingMethod"]').forEach(radio => {
        radio.addEventListener('change', onRoundingMethodChange);
    });

    document.querySelectorAll('.rounding-option').forEach(label => {
        label.addEventListener('click', function() {
            document.querySelectorAll('.rounding-option').forEach(l => {
                l.style.borderColor = 'transparent';
                l.style.background = 'white';
            });
            this.style.borderColor = '#667eea';
            this.style.background = '#f0f4ff';
        });
    });

    const checkedOption = document.querySelector('input[name="roundingMethod"]:checked');
    if (checkedOption) {
        const label = checkedOption.closest('.rounding-option');
        if (label) {
            label.style.borderColor = '#667eea';
            label.style.background = '#f0f4ff';
        }
    }
});

// ============================================
// 도착지(사업장) 로드
// ============================================
async function loadWarehouses() {
    try {
        const select = document.getElementById('warehouseSelect');

        let context = null;
        if (typeof SiteSelector !== 'undefined') {
            context = SiteSelector.getCurrentContext();
        }

        if (!context) {
            select.innerHTML = '<option value="">사업장을 먼저 선택하세요</option>';
            OS.currentDestination = null;
            return;
        }

        const siteId = context.site_id;
        const groupId = context.group_id;
        const categoryId = context.category_id;

        let groups = [];
        if (typeof SiteSelector !== 'undefined') {
            const structure = SiteSelector.getStructure();
            if (structure) {
                groups = structure;
            }
        }

        let sites = [];
        const now = Date.now();
        if (OS._sitesCache && (now - OS._sitesCacheTime) < OS.SITES_CACHE_TTL) {
            sites = OS._sitesCache;
        } else {
            const sitesRes = await fetch('/api/admin/sites');
            if (sitesRes.ok) {
                const sitesResult = await sitesRes.json();
                sites = sitesResult.data || sitesResult.sites || [];
                OS._sitesCache = sites;
                OS._sitesCacheTime = now;
            }
        }

        if (sites.length === 0 && groups.length === 0) {
            select.innerHTML = '<option value="">사업장 정보 로드 실패</option>';
            OS.currentDestination = null;
            return;
        }

        let site = sites.find(s => s.id == siteId);

        if (!site && groupId) {
            site = sites.find(s => s.group_id == groupId && !s.category_id);
        }

        if (!site && categoryId) {
            site = sites.find(s => s.category_id == categoryId);
        }

        if (!site && groupId) {
            const group = groups.find(g => g.id == groupId);
            if (group) {
                if (categoryId && group.categories) {
                    const category = group.categories.find(c => c.id == categoryId);
                    if (category) {
                        site = {
                            id: categoryId + 1000,
                            site_name: category.name,
                            address: category.address || ''
                        };
                    }
                }

                if (!site) {
                    site = {
                        id: groupId,
                        site_name: group.name,
                        address: group.address || ''
                    };
                }
            }
        }

        if (site) {
            const siteName = site.site_name || site.name || '미지정';
            const siteAddress = site.address || site.region || '';

            OS.currentDestination = {
                id: site.id,
                name: siteName,
                address: siteAddress,
                full: `${siteName} (${siteAddress || ''})`
            };

            select.innerHTML = '';
            const option = document.createElement('option');
            option.value = site.id;
            option.textContent = OS.currentDestination.full;
            option.selected = true;
            select.appendChild(option);

            if (!siteAddress) {
                select.style.borderColor = '#f59e0b';
                select.title = '주소가 설정되지 않았습니다.';
            } else {
                select.style.borderColor = '';
                select.title = '';
            }
        } else {
            const groupName = context.group_name || context.site_name || '미지정';
            OS.currentDestination = {
                id: groupId || siteId,
                name: groupName,
                address: '',
                full: groupName
            };

            select.innerHTML = '';
            const option = document.createElement('option');
            option.value = groupId || siteId;
            option.textContent = groupName;
            option.selected = true;
            select.appendChild(option);
            select.style.borderColor = '';
            select.title = '';
        }
    } catch (error) {
        console.error('도착지 로드 오류:', error);
        document.getElementById('warehouseSelect').innerHTML = '<option value="">로드 오류</option>';
        OS.currentDestination = null;
    }
}

// ============================================
// 날짜 변경 함수
// ============================================
function changeDateInput(inputId, days) {
    const dateInput = document.getElementById(inputId);
    if (!dateInput.value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.value = getLocalDateString(tomorrow);
    }
    const currentDate = new Date(dateInput.value);
    currentDate.setDate(currentDate.getDate() + days);
    dateInput.value = getLocalDateString(currentDate);
}

// ============================================
// 발주량 계산
// ============================================
async function calculateOrder() {
    const siteId = getCurrentSiteId();
    const mealPlanDate = document.getElementById('mealPlanDate').value;
    const orderDate = document.getElementById('orderDate').value;

    if (!siteId) {
        alert('사업장을 먼저 선택해주세요.');
        return;
    }

    if (!mealPlanDate || !orderDate) {
        alert('식단표 날짜와 입고일을 모두 입력해주세요.');
        return;
    }

    try {
        const validateResponse = await fetch(`/api/orders/validate?usage_date=${mealPlanDate}&order_date=${orderDate}&site_id=${siteId}`);
        const validateResult = await validateResponse.json();

        if (validateResult.success && validateResult.data.has_existing_orders) {
            showExistingOrdersModal(validateResult.data.existing_orders, mealPlanDate);
            return;
        }
    } catch (e) {
        console.error('기존 발주서 체크 오류:', e);
    }

    await executeCalculateOrder();
}

// 기존 발주서 정보 저장 (추가발주 연결용)
function showExistingOrdersModal(existingOrders, mealPlanDate) {
    OS.existingOrdersForLink = existingOrders;

    const orderListHtml = existingOrders.map(o => `
        <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${o.order_number}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
                <span class="badge ${o.status === 'confirmed' ? 'badge-success' : 'badge-warning'}">${o.status_label}</span>
            </td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${o.total_items}건</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formatCurrency(o.total_amount)}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
                <button onclick="deleteExistingOrder(${o.order_id}, '${o.order_number}')"
                        class="btn btn-sm" style="background: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </td>
        </tr>
    `).join('');

    const confirmedOrders = existingOrders.filter(o => o.status === 'confirmed');
    const additionalOrderOptions = confirmedOrders.length > 0 ?
        confirmedOrders.map(o => `<option value="${o.order_id}">${o.order_number} (${o.total_items}건, ${formatCurrency(o.total_amount)})</option>`).join('') :
        '<option value="">확정된 발주서 없음</option>';

    const modalHtml = `
        <div id="existingOrdersModal" style="
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        ">
            <div style="
                background: white; border-radius: 12px; padding: 0;
                max-width: 650px; width: 95%; max-height: 90vh; overflow: hidden;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            ">
                <div style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 20px; color: white;
                ">
                    <h3 style="margin: 0; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-clipboard-list"></i>
                        기존 발주서가 있습니다
                    </h3>
                </div>

                <div style="padding: 20px;">
                    <p style="margin-bottom: 15px; color: #333;">
                        <strong>${mealPlanDate}</strong> 식단표에 대해 이미 발주서가 존재합니다.
                    </p>

                    <div style="max-height: 150px; overflow-y: auto; margin-bottom: 20px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <thead>
                                <tr style="background: #f8f9fa;">
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">발주번호</th>
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">상태</th>
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">품목</th>
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">금액</th>
                                    <th style="padding: 8px; border: 1px solid #ddd;">관리</th>
                                </tr>
                            </thead>
                            <tbody>${orderListHtml}</tbody>
                        </table>
                    </div>

                    <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; cursor: pointer;">
                            <input type="radio" name="orderAction" value="additional" checked>
                            <strong>추가발주로 생성</strong>
                        </label>
                        <div style="margin-left: 26px; margin-bottom: 10px;">
                            <select id="parentOrderSelect" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
                                ${additionalOrderOptions}
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button onclick="closeExistingOrdersModal()" class="btn" style="background: #6c757d; color: white; padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer;">
                            취소
                        </button>
                        <button onclick="proceedWithDuplicateOrder()" class="btn" style="background: #28a745; color: white; padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-plus"></i> 새 발주서 생성
                        </button>
                        <button onclick="processOrderAction()" class="btn" style="background: #667eea; color: white; padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-arrow-right"></i> 진행
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeExistingOrdersModal() {
    const modal = document.getElementById('existingOrdersModal');
    if (modal) modal.remove();
}

async function deleteExistingOrder(orderId, orderNumber) {
    if (!confirm(`발주서 "${orderNumber}"를 삭제하시겠습니까?\n\n삭제된 발주서는 복구할 수 없습니다.`)) {
        return;
    }

    const siteIdBeforeDelete = getCurrentSiteId();

    showLoading('발주서 삭제 중...');
    try {
        const response = await fetch(`/api/orders/${orderId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (result.success) {
            alert(`발주서 "${orderNumber}"가 삭제되었습니다.`);
            closeExistingOrdersModal();

            const siteIdAfterDelete = getCurrentSiteId();
            if (siteIdBeforeDelete && siteIdAfterDelete && siteIdBeforeDelete === siteIdAfterDelete) {
                await calculateOrder();
            } else {
                console.warn('[발주] 삭제 전후 사업장 불일치 - 재계산 중단', siteIdBeforeDelete, '->', siteIdAfterDelete);
                alert('사업장이 변경되었습니다. 발주량을 다시 계산해주세요.');
            }
        } else {
            alert('삭제 실패: ' + result.error);
        }
    } catch (e) {
        console.error('발주서 삭제 오류:', e);
        alert('발주서 삭제 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

async function processOrderAction() {
    const selectedAction = document.querySelector('input[name="orderAction"]');
    if (!selectedAction || selectedAction.value === 'cancel') {
        closeExistingOrdersModal();
        return;
    }

    await proceedWithAdditionalOrder();
}

async function proceedWithAdditionalOrder() {
    const parentSelect = document.getElementById('parentOrderSelect');
    if (!parentSelect || !parentSelect.value) {
        alert('연결할 기존 발주서를 선택해주세요.');
        return;
    }

    OS.pendingParentOrderId = parseInt(parentSelect.value);
    const parentOrder = OS.existingOrdersForLink.find(o => o.order_id === OS.pendingParentOrderId);

    closeExistingOrdersModal();
    showToast(`추가발주 모드: ${parentOrder?.order_number || ''} 에 연결됩니다`, 'info');
    await executeCalculateOrder();
}

async function proceedWithDuplicateOrder() {
    OS.pendingParentOrderId = null;
    closeExistingOrdersModal();
    await executeCalculateOrder();
}

async function executeCalculateOrder() {
    const siteId = getCurrentSiteId();
    const mealPlanDate = document.getElementById('mealPlanDate').value;
    const orderDate = document.getElementById('orderDate').value;
    const warehouseId = document.getElementById('warehouseSelect').value;

    // ★ 새로운 날짜로 계산 시 이전 발주 ID 초기화 (다른 날짜 발주서 덮어쓰기 방지)
    OS.currentOrderId = null;

    showLoading('식수 x 식단표 기반 발주량 계산 중...');

    try {
        const requestBody = {
            site_id: siteId,
            meal_plan_date: mealPlanDate,
            order_date: orderDate,
            warehouse_id: warehouseId || null
        };

        const response = await fetch('/api/orders/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (result.success) {
            OS.currentOrderData = result.data;

            const apiItems = result.data.items || [];
            const apiUnorderable = apiItems.filter(i => i.can_order === false);
            console.log('[DEBUG API] 총 품목:', apiItems.length, ', can_order===false:', apiUnorderable.length);
            if (apiUnorderable.length > 0) {
                console.log('[DEBUG API] 첫 번째 발주불가 품목:', apiUnorderable[0].ingredient_name);
            }

            displayOrderResults(result.data);

            const unorderableForConflict = (result.data.items || []).filter(i => i.can_order === false && i.warning);
            if (unorderableForConflict.length > 0) {
                showBlackoutConflictModal(unorderableForConflict);
            }
        } else {
            alert('발주 계산 실패: ' + result.error);
        }
    } catch (error) {
        console.error('발주 계산 오류:', error);
        alert('발주 계산 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

// ============================================
// 발주 품목 매핑 (saveOrder, saveOrderWithForce 공통)
// ============================================
function mapOrderItems(orderableItems, usageDate) {
    return orderableItems.map(item => ({
        ingredient_id: item.ingredient_id,
        ingredient_code: item.ingredient_code,
        ingredient_name: item.ingredient_name,
        specification: item.specification,
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_name,
        meal_type: item.meal_type || item.meal_refs?.[0]?.meal_type,
        meal_category: item.category || item.meal_refs?.[0]?.category,
        menu_name: item.menu_name || item.meal_refs?.[0]?.menu_name,
        slot_name: item.slot_name,
        delivery_site_name: item.delivery_site_name,
        meal_plan_date: usageDate,
        per_person_qty: item.per_person_qty || item.meal_refs?.[0]?.per_person_qty,
        per_person_qty_g: item.per_person_qty_g || item.meal_refs?.[0]?.per_person_qty_g || 0,
        meal_count: item.meal_count || item.meal_refs?.[0]?.head_count,
        required_qty: item.required_qty,
        current_stock: item.current_stock,
        order_qty: item.order_qty,
        unit: item.unit,
        unit_price: item.unit_price,
        lead_time: item.lead_time,
        can_order: item.can_order,
        warning: item.warning,
        category_counts: item.category_counts
    }));
}

// ============================================
// 발주서 저장
// ============================================
async function saveOrder() {
    if (!OS.currentOrderData || !OS.currentDisplayItems || OS.currentDisplayItems.length === 0) {
        alert('저장할 발주 데이터가 없습니다. 먼저 발주서를 생성해주세요.');
        return;
    }

    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate').value;
    const orderDate = document.getElementById('orderDate').value;
    const warehouseId = document.getElementById('warehouseSelect').value;
    const orderType = document.getElementById('orderType').value;

    const orderableItems = OS.currentDisplayItems.filter(item =>
        item.can_order !== false && (item.order_qty > 0 || item.required_qty > 0)
    );

    if (orderableItems.length === 0) {
        alert('발주 가능한 품목이 없습니다.');
        return;
    }

    showLoading('발주서 저장 중...');

    const step2Snapshot = {
        items: OS.currentOrderData?.items || [],
        summary: OS.currentOrderData?.summary || {},
        selectedRefKeys: Array.from(OS.selectedRefKeys),
        groupSelectionState: { ...OS.groupSelectionState }
    };

    const step3Snapshot = {
        aggregatedItems: OS.aggregatedOrderData || [],
        displayItems: OS.currentDisplayItems || [],
        summary: OS.currentOrderData?.summary || {}
    };

    try {
        const finalOrderType = OS.pendingParentOrderId ? 'additional' : orderType;
        const mappedItems = mapOrderItems(orderableItems, usageDate);

        let response;
        const isUpdate = !!OS.currentOrderId;

        if (isUpdate) {
            response = await fetch(`/api/orders/${OS.currentOrderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    site_id: siteId,
                    usage_date: usageDate,
                    step3_snapshot: step3Snapshot,
                    items: mappedItems
                })
            });
        } else {
            response = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    site_id: siteId,
                    warehouse_id: warehouseId || null,
                    order_date: orderDate,
                    usage_date: usageDate,
                    order_type: finalOrderType,
                    parent_order_id: OS.pendingParentOrderId || null,
                    step2_snapshot: step2Snapshot,
                    step3_snapshot: step3Snapshot,
                    items: mappedItems
                })
            });
        }

        const result = await response.json();

        if (result.success) {
            OS.currentOrderId = result.data.order_id;
            const parentInfo = OS.pendingParentOrderId ? '\n(추가발주로 연결됨)' : '';
            const actionText = isUpdate ? '수정' : '저장';
            const orderNumText = result.data.order_number ? `\n발주번호: ${result.data.order_number}` : '';
            alert(`발주서가 ${actionText}되었습니다.${parentInfo}${orderNumText}\n품목 수: ${result.data.total_items}개\n총 금액: ${formatCurrency(result.data.total_amount)}`);

            OS.pendingParentOrderId = null;

            document.getElementById('confirmOrderBtn').style.display = 'inline-flex';
            document.getElementById('saveOrderBtn').textContent = '발주서 수정';
        } else if (result.error === 'existing_orders' && result.requires_confirmation) {
            const existingList = result.existing_orders.map(o =>
                `\u2022 ${o.order_number} (${o.status === 'draft' ? '임시' : o.status === 'confirmed' ? '확정' : o.status})`
            ).join('\n');

            const confirmCreate = confirm(
                `${result.message}\n\n기존 발주서:\n${existingList}\n\n` +
                `새 발주서를 추가로 생성하시겠습니까?\n(기존 발주서는 유지됩니다)`
            );

            if (confirmCreate) {
                await saveOrderWithForce();
            }
        } else {
            alert('저장 실패: ' + (result.message || result.error));
        }
    } catch (error) {
        console.error('저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

async function saveOrderWithForce() {
    const siteId = getCurrentSiteId();
    const usageDate = document.getElementById('mealPlanDate').value;
    const orderDate = document.getElementById('orderDate').value;
    const warehouseId = document.getElementById('warehouseSelect').value;
    const orderType = document.getElementById('orderType').value;

    const orderableItems = OS.currentDisplayItems.filter(item =>
        item.can_order !== false && (item.order_qty > 0 || item.required_qty > 0)
    );

    showLoading('발주서 저장 중...');

    const step2Snapshot = {
        items: OS.currentOrderData?.items || [],
        summary: OS.currentOrderData?.summary || {},
        selectedRefKeys: Array.from(OS.selectedRefKeys),
        groupSelectionState: { ...OS.groupSelectionState }
    };

    const step3Snapshot = {
        aggregatedItems: OS.aggregatedOrderData || [],
        displayItems: OS.currentDisplayItems || [],
        summary: OS.currentOrderData?.summary || {}
    };

    try {
        const finalOrderType = OS.pendingParentOrderId ? 'additional' : orderType;

        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                site_id: siteId,
                warehouse_id: warehouseId || null,
                order_date: orderDate,
                usage_date: usageDate,
                order_type: finalOrderType,
                parent_order_id: OS.pendingParentOrderId || null,
                force_create: true,
                step2_snapshot: step2Snapshot,
                step3_snapshot: step3Snapshot,
                items: mapOrderItems(orderableItems, usageDate)
            })
        });

        const result = await response.json();

        if (result.success) {
            OS.currentOrderId = result.data.order_id;
            const parentInfo = OS.pendingParentOrderId ? '\n(추가발주로 연결됨)' : '';
            alert(`발주서가 저장되었습니다.${parentInfo}\n\n발주번호: ${result.data.order_number}\n품목 수: ${result.data.total_items}개\n총 금액: ${formatCurrency(result.data.total_amount)}`);

            OS.pendingParentOrderId = null;

            document.getElementById('confirmOrderBtn').style.display = 'inline-flex';
            document.getElementById('saveOrderBtn').textContent = '발주서 수정';
        } else {
            alert('저장 실패: ' + (result.message || result.error));
        }
    } catch (error) {
        console.error('저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

// ============================================
// 발주 확정
// ============================================
async function confirmOrder() {
    if (!OS.currentOrderId) {
        alert('먼저 발주서를 저장해주세요.');
        return;
    }

    if (!confirm('발주를 확정하시겠습니까?\n확정 후에는 수정이 제한됩니다.')) {
        return;
    }

    showLoading('발주 확정 중...');

    try {
        const response = await fetch(`/api/orders/${OS.currentOrderId}/confirm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmed_by: 1 })
        });

        const result = await response.json();

        if (result.success) {
            alert('발주가 확정되었습니다.');
            document.getElementById('confirmOrderBtn').style.display = 'none';
            document.getElementById('saveOrderBtn').disabled = true;
        } else {
            alert('확정 실패: ' + result.error);
        }
    } catch (error) {
        console.error('확정 오류:', error);
        alert('확정 중 오류가 발생했습니다.');
    } finally {
        hideLoading();
    }
}

// ============================================
// 초기화
// ============================================
function resetOrder() {
    OS.reset();

    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
    document.getElementById('orderSection').style.display = 'none';
    document.getElementById('confirmOrderBtn').style.display = 'none';
    document.getElementById('saveOrderBtn').disabled = false;
    document.getElementById('saveOrderBtn').innerHTML = '<i class="fas fa-save"></i> 발주서 저장';

    const summaryPanel = document.getElementById('orderSummaryPanel');
    if (summaryPanel) {
        summaryPanel.style.display = 'none';
    }
    document.body.classList.remove('summary-panel-open');

    // Step 4/5 초기화
    OS.resetSteps();
}
