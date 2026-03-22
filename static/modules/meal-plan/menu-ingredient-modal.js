// ============================================
// 메뉴 식자재 팝업 모달 (메뉴/레시피 관리 수준으로 확장)
// ============================================
let menuIngredientModalData = null;
let menuIngredientModalMenuId = null;
let menuIngredientModalMenuName = null;
let menuIngredientModalCategory = null;
let ingredientSearchResults = [];
let currentReplacingIdx = null;

async function openMenuIngredientModal(menuId, menuName) {
    // 기존 모달만 닫고 변수는 초기화하지 않음
    const existingModal = document.getElementById('menuIngredientModal');
    if (existingModal) existingModal.remove();
    document.removeEventListener('keydown', handleMenuIngredientModalKeydown);

    // 변수 설정
    menuIngredientModalMenuId = menuId;
    menuIngredientModalMenuName = menuName;
    currentReplacingIdx = null;

    const loadingModal = document.createElement('div');
    loadingModal.id = 'menuIngredientModal';
    loadingModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10002;';
    loadingModal.innerHTML = '<div style="background:white;padding:30px;border-radius:12px;text-align:center;"><div style="font-size:24px;margin-bottom:10px;">⏳</div><div>식자재 정보를 불러오는 중...</div></div>';
    document.body.appendChild(loadingModal);
    try {
        const response = await fetch('/api/admin/menu-recipes/' + menuId);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '데이터를 불러올 수 없습니다.');
        menuIngredientModalData = result.data.ingredients || [];
        menuIngredientModalCategory = result.data.recipe?.category || '';
        renderMenuIngredientModal(menuName, menuIngredientModalCategory);
    } catch (error) {
        closeMenuIngredientModal();
        showNotification('식자재 정보를 불러올 수 없습니다: ' + error.message, 'error');
    }
}

/**
 * 규격과 단위에서 총 그램수 계산
 */
function getTotalGramsFromSpec(spec, unit, baseWeightGrams) {
    // 기준용량이 있으면 그것을 사용
    if (baseWeightGrams && baseWeightGrams > 0) {
        return baseWeightGrams;
    }

    // 규격에서 숫자 추출 (예: "3.5kg", "500g", "1kg(5mm슬라이스)")
    const specMatch = spec.match(/([\d.]+)\s*(kg|g|KG|G)/i);
    if (specMatch) {
        const value = parseFloat(specMatch[1]);
        const specUnit = specMatch[2].toLowerCase();
        if (specUnit === 'kg') {
            return value * 1000;
        } else if (specUnit === 'g') {
            return value;
        }
    }

    // 단위가 kg나 g인 경우
    const upperUnit = (unit || '').toUpperCase();
    if (upperUnit === 'KG') {
        const numMatch = spec.match(/([\d.]+)/);
        return numMatch ? parseFloat(numMatch[1]) * 1000 : 1000;
    } else if (upperUnit === 'G') {
        const numMatch = spec.match(/([\d.]+)/);
        return numMatch ? parseFloat(numMatch[1]) : 100;
    }

    return 0;
}

/**
 * 1인필요량 변경 시 1인소요량과 1인재료비 자동 계산
 */
function onRequiredGramsChange(idx, newValue) {
    if (!menuIngredientModalData || !menuIngredientModalData[idx]) return;

    const ing = menuIngredientModalData[idx];
    const requiredGrams = parseFloat(newValue) || 0;
    ing.required_grams = requiredGrams;

    const totalGrams = getTotalGramsFromSpec(ing.specification || '', ing.unit || '', ing.base_weight_grams);
    const price = ing.selling_price || 0;

    if (totalGrams > 0 && requiredGrams > 0) {
        // 1인소요량 = 필요량 / 총량
        const ratio = requiredGrams / totalGrams;
        const roundedRatio = Math.round(ratio * 10000) / 10000;
        ing.quantity = roundedRatio;

        // 1인재료비 = 판매가 * 1인소요량
        ing.amount = Math.round(price * roundedRatio);
    } else {
        ing.quantity = 0;
        ing.amount = 0;
    }

    // UI 업데이트
    updateIngredientRow(idx);
    updateTotalCost();
}

/**
 * 1인소요량 변경 시 1인필요량과 1인재료비 자동 계산
 */
function onQuantityChange(idx, newValue) {
    if (!menuIngredientModalData || !menuIngredientModalData[idx]) return;

    const ing = menuIngredientModalData[idx];
    const quantity = parseFloat(newValue) || 0;
    ing.quantity = quantity;

    const totalGrams = getTotalGramsFromSpec(ing.specification || '', ing.unit || '', ing.base_weight_grams);
    const price = ing.selling_price || 0;

    // 1인필요량(g) 역산 = 1인소요량 × 총량
    if (totalGrams > 0 && quantity > 0) {
        ing.required_grams = Math.round(quantity * totalGrams * 100) / 100;
    }

    // 1인재료비 = 판매가 * 1인소요량
    ing.amount = Math.round(price * quantity);

    // UI 업데이트
    updateIngredientRow(idx);
    updateTotalCost();
}

/**
 * 기준용량 변경
 */
function onBaseWeightChange(idx, newValue) {
    if (!menuIngredientModalData || !menuIngredientModalData[idx]) return;

    const ing = menuIngredientModalData[idx];
    ing.base_weight_grams = parseFloat(newValue) || 0;

    // 1인필요량이 있으면 재계산
    if (ing.required_grams > 0) {
        onRequiredGramsChange(idx, ing.required_grams);
    }
}

/**
 * 행 UI 업데이트
 */
function updateIngredientRow(idx) {
    const ing = menuIngredientModalData[idx];

    const qtyInput = document.getElementById(`ingQuantity_${idx}`);
    if (qtyInput) qtyInput.value = ing.quantity || 0;

    const reqInput = document.getElementById(`ingRequiredGrams_${idx}`);
    if (reqInput) reqInput.value = ing.required_grams || 0;

    const amountEl = document.getElementById(`ingAmount_${idx}`);
    if (amountEl) amountEl.textContent = (ing.amount || 0).toLocaleString();
}

/**
 * 총 재료비 업데이트
 */
function updateTotalCost() {
    const totalCost = menuIngredientModalData.reduce((sum, ing) => sum + (ing.amount || 0), 0);
    const totalReqGrams = menuIngredientModalData.reduce((sum, ing) => sum + (ing.required_grams || 0), 0);

    const totalEl = document.getElementById('menuIngredientTotalCost');
    if (totalEl) totalEl.textContent = totalCost.toLocaleString() + '원';

    const totalGramsEl = document.getElementById('menuIngredientTotalGrams');
    if (totalGramsEl) totalGramsEl.textContent = Math.round(totalReqGrams) + 'g';
}

function renderMenuIngredientModal(menuName, category) {
    const modal = document.getElementById('menuIngredientModal');
    if (!modal) return;

    const totalCost = menuIngredientModalData.reduce((sum, ing) => sum + (ing.amount || 0), 0);
    const totalReqGrams = menuIngredientModalData.reduce((sum, ing) => sum + (ing.required_grams || 0), 0);

    let tableRows = '';
    menuIngredientModalData.forEach((ing, idx) => {
        const ingName = (ing.ingredient_name || '-').replace(/"/g, '&quot;');
        const ingSpec = (ing.specification || '').replace(/"/g, '&quot;');
        const ingCode = (ing.ingredient_code || '').replace(/"/g, '&quot;');
        const baseWeight = ing.base_weight_grams || 0;
        const requiredGrams = ing.required_grams || 0;
        const quantity = ing.quantity || 0;
        const amount = ing.amount || 0;
        const deliveryDays = ing.delivery_days || 0;
        const supplierName = ing.supplier_name || '-';

        tableRows += `<tr style="border-bottom:1px solid #eee;" data-index="${idx}">
            <td style="padding:6px 4px;text-align:center;font-size:11px;color:#666;">${ingCode || '-'}</td>
            <td style="padding:6px 4px;">
                <span title="${ingName}" style="display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;font-size:12px;">${ingName}</span>
            </td>
            <td style="padding:6px 4px;text-align:center;">
                <button onclick="openIngredientSearch(${idx})" style="padding:3px 6px;border:none;border-radius:4px;background:#4a90d9;color:white;font-size:10px;cursor:pointer;" title="식자재 교체">🔍</button>
            </td>
            <td style="padding:6px 4px;font-size:11px;color:#666;" title="${ingSpec}">${ingSpec.length > 15 ? ingSpec.substring(0, 15) + '...' : ingSpec || '-'}</td>
            <td style="padding:6px 4px;text-align:center;font-size:11px;">${ing.unit || '-'}</td>
            <td style="padding:6px 4px;text-align:center;font-size:11px;">${deliveryDays > 0 ? deliveryDays + '일' : '-'}</td>
            <td style="padding:6px 4px;text-align:right;font-size:11px;">${(ing.selling_price || 0).toLocaleString()}</td>
            <td style="padding:6px 4px;text-align:center;background:#fff8e1;">
                <input type="number" value="${baseWeight}" step="1" min="0" id="ingBaseWeight_${idx}"
                    onchange="onBaseWeightChange(${idx},this.value)"
                    style="width:70px;padding:3px 4px;border:1px solid #d4a574;border-radius:3px;text-align:right;font-size:11px;background:#fffbf0;">
            </td>
            <td style="padding:6px 4px;text-align:center;background:#d4edda;">
                <input type="number" value="${requiredGrams}" step="0.1" min="0" id="ingRequiredGrams_${idx}"
                    onchange="onRequiredGramsChange(${idx},this.value)"
                    style="width:70px;padding:3px 4px;border:1px solid #28a745;border-radius:3px;text-align:right;font-size:11px;background:#f0fff4;">
            </td>
            <td style="padding:6px 4px;text-align:center;background:#cce5ff;">
                <input type="number" value="${quantity}" step="0.0001" min="0" id="ingQuantity_${idx}"
                    onchange="onQuantityChange(${idx},this.value)"
                    style="width:60px;padding:3px 4px;border:1px solid #007bff;border-radius:3px;text-align:right;font-size:11px;background:#f0f8ff;">
            </td>
            <td style="padding:6px 4px;text-align:right;font-weight:600;font-size:11px;" id="ingAmount_${idx}">${amount.toLocaleString()}</td>
            <td style="padding:6px 4px;font-size:10px;color:#666;" title="${supplierName}">${supplierName.length > 8 ? supplierName.substring(0, 8) + '..' : supplierName}</td>
        </tr>`;
    });

    const tableContent = menuIngredientModalData.length === 0
        ? '<div style="text-align:center;padding:40px;color:#999;">등록된 식자재가 없습니다.</div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #dee2e6;">
                    <th style="padding:8px 4px;text-align:center;width:70px;font-size:11px;">식자재코드</th>
                    <th style="padding:8px 4px;text-align:left;font-size:11px;">식자재명</th>
                    <th style="padding:8px 4px;text-align:center;width:35px;font-size:11px;">🔍</th>
                    <th style="padding:8px 4px;text-align:left;width:100px;font-size:11px;">규격</th>
                    <th style="padding:8px 4px;text-align:center;width:40px;font-size:11px;">단위</th>
                    <th style="padding:8px 4px;text-align:center;width:50px;font-size:11px;">선발주</th>
                    <th style="padding:8px 4px;text-align:right;width:65px;font-size:11px;">판매가</th>
                    <th style="padding:8px 4px;text-align:center;width:80px;font-size:11px;background:#fff8e1;">기준용량</th>
                    <th style="padding:8px 4px;text-align:center;width:85px;font-size:11px;background:#d4edda;">1인필요량(g)</th>
                    <th style="padding:8px 4px;text-align:center;width:70px;font-size:11px;background:#cce5ff;">1인소요량</th>
                    <th style="padding:8px 4px;text-align:right;width:65px;font-size:11px;">1인재료비</th>
                    <th style="padding:8px 4px;text-align:left;width:70px;font-size:11px;">거래처</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>`;

    const safeMenuName = menuName.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    modal.innerHTML = `
        <div style="background:white;border-radius:12px;width:98%;max-width:1400px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
            <div style="padding:14px 20px;border-bottom:1px solid #e9ecef;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px 12px 0 0;">
                <div>
                    <h3 style="margin:0;font-size:17px;color:white;">📋 ${safeMenuName} 레시피 편집기</h3>
                    <span style="font-size:11px;color:rgba(255,255,255,0.8);">${category || '미분류'} · 식자재 ${menuIngredientModalData.length}개</span>
                </div>
                <button onclick="closeMenuIngredientModal()" style="background:none;border:none;font-size:24px;color:white;cursor:pointer;">&times;</button>
            </div>

            <!-- 안내 메시지 -->
            <div style="padding:10px 20px;background:#fff3cd;border-bottom:1px solid #ffc107;font-size:12px;color:#856404;">
                💡 <strong>1인필요량(g)</strong> 또는 <strong>1인소요량</strong> 중 하나만 입력하면 나머지가 자동 계산됩니다. 🔍 버튼으로 식자재 교체 가능.
            </div>

            <div style="flex:1;overflow-y:auto;padding:12px 16px;min-height:300px;">${tableContent}</div>

            <div style="padding:14px 20px;border-top:1px solid #e9ecef;display:flex;justify-content:space-between;align-items:center;background:#f8f9fa;border-radius:0 0 12px 12px;">
                <div style="display:flex;gap:20px;align-items:center;">
                    <div style="font-weight:600;color:#333;">
                        1인 필요량 합계: <span id="menuIngredientTotalGrams" style="color:#28a745;font-size:16px;">${Math.round(totalReqGrams)}g</span>
                    </div>
                    <div style="font-weight:600;color:#333;">
                        총 재료비: <span id="menuIngredientTotalCost" style="color:#667eea;font-size:18px;">${totalCost.toLocaleString()}원</span>
                    </div>
                </div>
                <div style="display:flex;gap:10px;">
                    <button onclick="closeMenuIngredientModal()" style="padding:10px 20px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer;">닫기</button>
                    <button onclick="saveMenuIngredients()" style="padding:10px 20px;border:none;border-radius:6px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;cursor:pointer;font-weight:600;">💾 저장</button>
                </div>
            </div>
        </div>

        <!-- 식자재 검색 모달 -->
        <div id="ingredientSearchModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10003;display:none;align-items:center;justify-content:center;">
            <div style="background:white;border-radius:12px;width:95%;max-width:1000px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.4);">
                <div style="padding:14px 20px;border-bottom:1px solid #e9ecef;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#28a745,#20c997);border-radius:12px 12px 0 0;">
                    <h3 style="margin:0;font-size:15px;color:white;">🔍 식자재 검색 (교체) - 단위당 단가 낮은 순</h3>
                    <button onclick="closeIngredientSearch()" style="background:none;border:none;font-size:24px;color:white;cursor:pointer;">&times;</button>
                </div>
                <div style="padding:12px 16px;">
                    <div style="display:flex;gap:10px;">
                        <input type="text" id="ingredientSearchInput" placeholder="식자재명 또는 코드로 검색..."
                            onkeyup="if(event.key==='Enter')searchIngredients()"
                            style="flex:1;padding:10px 14px;border:2px solid #28a745;border-radius:8px;font-size:13px;box-sizing:border-box;">
                        <button onclick="searchIngredients()" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">검색</button>
                    </div>
                </div>
                <!-- 컬럼 헤더 -->
                <div style="display:flex;padding:8px 16px;background:#f8f9fa;border-bottom:2px solid #dee2e6;font-size:11px;font-weight:600;color:#495057;">
                    <div style="flex:2;">식자재명 / 규격</div>
                    <div style="flex:1;text-align:center;">단위</div>
                    <div style="flex:1;text-align:right;">단위당 단가</div>
                    <div style="flex:1;text-align:right;">판매가</div>
                    <div style="flex:1;text-align:right;">기준용량</div>
                    <div style="flex:1;text-align:right;">협력업체</div>
                </div>
                <div id="ingredientSearchResults" style="flex:1;overflow-y:auto;padding:0;min-height:200px;max-height:500px;">
                    <div style="text-align:center;color:#999;padding:40px;">검색어를 입력하세요</div>
                </div>
            </div>
        </div>`;

    document.addEventListener('keydown', handleMenuIngredientModalKeydown);
}

function handleMenuIngredientModalKeydown(e) {
    if (e.key === 'Escape') {
        const searchModal = document.getElementById('ingredientSearchModal');
        if (searchModal && searchModal.style.display === 'flex') {
            closeIngredientSearch();
        } else {
            closeMenuIngredientModal();
        }
    }
}

function closeMenuIngredientModal() {
    const modal = document.getElementById('menuIngredientModal');
    if (modal) modal.remove();
    document.removeEventListener('keydown', handleMenuIngredientModalKeydown);
    menuIngredientModalData = null;
    menuIngredientModalMenuId = null;
    menuIngredientModalMenuName = null;
    menuIngredientModalCategory = null;
    currentReplacingIdx = null;
}

function openIngredientSearch(idx) {
    currentReplacingIdx = idx;
    const currentIng = menuIngredientModalData[idx];
    const searchModal = document.getElementById('ingredientSearchModal');
    if (searchModal) {
        searchModal.style.display = 'flex';
        const input = document.getElementById('ingredientSearchInput');
        if (input) {
            // 현재 식자재명에서 핵심 키워드 추출
            const ingName = currentIng?.ingredient_name || '';
            const coreName = ingName.split('(')[0].split('/')[0].split('-')[0].split('_')[0].trim();
            input.value = coreName;
            input.focus();
        }
        // 현재 식자재 정보 표시
        const currentPrice = currentIng?.selling_price || 0;
        const currentPricePerUnit = currentIng?.price_per_unit || 0;
        document.getElementById('ingredientSearchResults').innerHTML = `
            <div style="background:#fff3cd;padding:12px 16px;border:1px solid #ffc107;margin:0;">
                <div style="font-weight:600;color:#856404;font-size:11px;margin-bottom:6px;">📌 현재 선택된 식자재</div>
                <div style="display:flex;align-items:center;">
                    <div style="flex:2;">
                        <div style="font-weight:600;color:#856404;">${currentIng?.ingredient_name || '-'}</div>
                        <div style="font-size:11px;color:#856404;">${currentIng?.specification || '-'}</div>
                    </div>
                    <div style="flex:1;text-align:center;color:#856404;">${currentIng?.unit || '-'}</div>
                    <div style="flex:1;text-align:right;font-weight:700;color:#856404;">${currentPricePerUnit > 0 ? currentPricePerUnit.toLocaleString() + '원/g' : '-'}</div>
                    <div style="flex:1;text-align:right;color:#856404;">${currentPrice.toLocaleString()}원</div>
                    <div style="flex:1;text-align:right;color:#856404;">${currentIng?.base_weight_grams || '-'}g</div>
                    <div style="flex:1;text-align:right;font-size:11px;color:#856404;">${currentIng?.supplier_name || '-'}</div>
                </div>
            </div>
            <div style="text-align:center;color:#999;padding:20px;">Enter를 눌러 검색하거나 검색어를 수정하세요</div>
        `;
        // 자동 검색
        if (input.value.length >= 2) {
            setTimeout(() => searchIngredients(), 200);
        }
    }
}

function closeIngredientSearch() {
    const searchModal = document.getElementById('ingredientSearchModal');
    if (searchModal) searchModal.style.display = 'none';
    currentReplacingIdx = null;
}

async function searchIngredients() {
    const input = document.getElementById('ingredientSearchInput');
    const keyword = input?.value?.trim();
    if (!keyword || keyword.length < 2) {
        showNotification('2글자 이상 입력하세요', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('ingredientSearchResults');
    const currentIng = currentReplacingIdx !== null ? menuIngredientModalData[currentReplacingIdx] : null;
    const currentPrice = currentIng?.selling_price || 0;
    const currentPricePerUnit = currentIng?.price_per_unit || 0;

    // 현재 식자재 정보 유지
    const currentIngHtml = currentIng ? `
        <div style="background:#fff3cd;padding:12px 16px;border:1px solid #ffc107;margin:0;">
            <div style="font-weight:600;color:#856404;font-size:11px;margin-bottom:6px;">📌 현재 선택된 식자재</div>
            <div style="display:flex;align-items:center;">
                <div style="flex:2;">
                    <div style="font-weight:600;color:#856404;">${currentIng.ingredient_name || '-'}</div>
                    <div style="font-size:11px;color:#856404;">${currentIng.specification || '-'}</div>
                </div>
                <div style="flex:1;text-align:center;color:#856404;">${currentIng.unit || '-'}</div>
                <div style="flex:1;text-align:right;font-weight:700;color:#856404;">${currentPricePerUnit > 0 ? currentPricePerUnit.toLocaleString() + '원/g' : '-'}</div>
                <div style="flex:1;text-align:right;color:#856404;">${currentPrice.toLocaleString()}원</div>
                <div style="flex:1;text-align:right;color:#856404;">${currentIng.base_weight_grams || '-'}g</div>
                <div style="flex:1;text-align:right;font-size:11px;color:#856404;">${currentIng.supplier_name || '-'}</div>
            </div>
        </div>
    ` : '';

    resultsDiv.innerHTML = currentIngHtml + '<div style="text-align:center;padding:30px;"><div style="font-size:24px;">⏳</div><div>검색 중...</div></div>';

    try {
        const response = await fetch(`/api/admin/ingredients-enhanced?search_name=${encodeURIComponent(keyword)}&size=50`);
        const result = await response.json();

        if (!result.success || !result.items || result.items.length === 0) {
            resultsDiv.innerHTML = currentIngHtml + '<div style="text-align:center;color:#999;padding:40px;">검색 결과가 없습니다</div>';
            return;
        }

        // 단위당 단가 낮은 순으로 정렬
        const sortedData = [...result.items].sort((a, b) => {
            const priceA = a.price_per_unit || 999999999;
            const priceB = b.price_per_unit || 999999999;
            return priceA - priceB;
        });

        ingredientSearchResults = sortedData;
        let html = currentIngHtml;

        // 저렴한 대안 개수
        const comparePrice = currentPricePerUnit || currentPrice;
        const cheaperCount = sortedData.filter(ing => {
            const ingPpu = ing.price_per_unit || 0;
            return ingPpu > 0 && comparePrice > 0 && ingPpu < comparePrice;
        }).length;

        if (cheaperCount > 0 && comparePrice > 0) {
            html += `<div style="background:#d4edda;padding:10px 16px;border:1px solid #28a745;font-size:12px;color:#155724;">
                💡 현재보다 저렴한 대안이 <strong>${cheaperCount}개</strong> 있습니다
            </div>`;
        }

        sortedData.forEach((ing, i) => {
            const ingPricePerUnit = ing.price_per_unit || 0;
            const ingSellingPrice = ing.selling_price || 0;
            const ingUnit = ing.unit || '';
            const ingBaseWeight = ing.base_weight_grams || 0;
            let priceBadge = '';
            let rowBg = 'white';

            if (comparePrice > 0 && ingPricePerUnit > 0) {
                const diff = ingPricePerUnit - comparePrice;
                const diffPercent = Math.round((diff / comparePrice) * 100);

                if (diff < 0) {
                    priceBadge = `<span style="background:#28a745;color:white;padding:2px 5px;border-radius:10px;font-size:9px;margin-left:4px;">▼${Math.abs(diffPercent)}%</span>`;
                    rowBg = '#f0fff4';
                } else if (diff > 0) {
                    priceBadge = `<span style="background:#dc3545;color:white;padding:2px 5px;border-radius:10px;font-size:9px;margin-left:4px;">▲${diffPercent}%</span>`;
                }
            }

            const pricePerUnitDisplay = ingPricePerUnit > 0
                ? `<span style="font-weight:700;color:#1976d2;">${ingPricePerUnit.toLocaleString()}원/g</span>`
                : `<span style="color:#999;">-</span>`;

            html += `<div onclick="selectIngredient(${i})" style="display:flex;padding:10px 16px;border-bottom:1px solid #eee;cursor:pointer;align-items:center;background:${rowBg};"
                onmouseover="this.style.background='#e8f5e9'" onmouseout="this.style.background='${rowBg}'">
                <div style="flex:2;">
                    <div style="font-weight:500;color:#333;font-size:12px;">${ing.name || ing.ingredient_name}</div>
                    <div style="font-size:10px;color:#999;">${ing.specification || '-'}</div>
                </div>
                <div style="flex:1;text-align:center;font-size:11px;color:#666;">${ingUnit || '-'}</div>
                <div style="flex:1;text-align:right;">${pricePerUnitDisplay}${priceBadge}</div>
                <div style="flex:1;text-align:right;font-size:11px;">${ingSellingPrice.toLocaleString()}원</div>
                <div style="flex:1;text-align:right;font-size:11px;color:#666;">${ingBaseWeight > 0 ? ingBaseWeight + 'g' : '-'}</div>
                <div style="flex:1;text-align:right;font-size:10px;color:#666;">${ing.supplier_name || '-'}</div>
            </div>`;
        });
        resultsDiv.innerHTML = html;
    } catch (error) {
        resultsDiv.innerHTML = currentIngHtml + '<div style="text-align:center;color:#dc3545;padding:40px;">검색 오류: ' + error.message + '</div>';
    }
}

function selectIngredient(searchIdx) {
    if (currentReplacingIdx === null || !ingredientSearchResults[searchIdx]) return;

    const newIng = ingredientSearchResults[searchIdx];
    const oldIng = menuIngredientModalData[currentReplacingIdx];

    // 기존 1인필요량과 1인소요량 유지
    const oldRequiredGrams = oldIng?.required_grams || 0;
    const oldQuantity = oldIng?.quantity || 0;

    // 데이터 교체
    menuIngredientModalData[currentReplacingIdx] = {
        ingredient_code: newIng.ingredient_code,
        ingredient_name: newIng.name || newIng.ingredient_name,
        specification: newIng.specification || '',
        unit: newIng.unit || '',
        delivery_days: newIng.delivery_days || 0,
        selling_price: newIng.selling_price || 0,
        base_weight_grams: newIng.base_weight_grams || 0,
        price_per_unit: newIng.price_per_unit || 0,
        required_grams: oldRequiredGrams,
        quantity: oldQuantity,
        amount: Math.round(oldQuantity * (newIng.selling_price || 0)),
        supplier_name: newIng.supplier_name || ''
    };

    // 1인필요량이 있으면 재계산
    if (oldRequiredGrams > 0) {
        onRequiredGramsChange(currentReplacingIdx, oldRequiredGrams);
    }

    closeIngredientSearch();
    renderMenuIngredientModal(menuIngredientModalMenuName, menuIngredientModalCategory);
    showNotification(`식자재가 "${newIng.name || newIng.ingredient_name}"(으)로 교체되었습니다`, 'success');
}

function updateIngredientQuantity(idx, newQuantity) {
    onQuantityChange(idx, newQuantity);
}

async function saveMenuIngredients() {
    if (!menuIngredientModalMenuId || !menuIngredientModalData) {
        showNotification('저장할 데이터가 없습니다.', 'warning');
        return;
    }
    try {
        const formData = new FormData();
        formData.append('recipe_id', menuIngredientModalMenuId);
        formData.append('recipe_name', menuIngredientModalMenuName);
        formData.append('ingredients', JSON.stringify(menuIngredientModalData));

        const response = await fetch('/api/recipe/save', { method: 'POST', body: formData });
        const result = await response.json();

        if (result.success) {
            showNotification('식자재 정보가 저장되었습니다.', 'success');
            // 동명 레시피 경고 표시
            if (result.warnings && result.warnings.length > 0) {
                setTimeout(() => {
                    result.warnings.forEach(w => showNotification(`⚠️ ${w}`, 'warning', 8000));
                }, 1500);
            }
            closeMenuIngredientModal();
            if (typeof loadMealData === 'function') loadMealData();
        } else {
            throw new Error(result.error || '저장에 실패했습니다.');
        }
    } catch (error) {
        showNotification('저장 실패: ' + error.message, 'error');
    }
}

// 전역 함수 등록
window.openMenuIngredientModal = openMenuIngredientModal;
window.closeMenuIngredientModal = closeMenuIngredientModal;
window.updateIngredientQuantity = updateIngredientQuantity;
window.saveMenuIngredients = saveMenuIngredients;
window.openIngredientSearch = openIngredientSearch;
window.closeIngredientSearch = closeIngredientSearch;
window.searchIngredients = searchIngredients;
window.selectIngredient = selectIngredient;
window.onRequiredGramsChange = onRequiredGramsChange;
window.onQuantityChange = onQuantityChange;
window.onBaseWeightChange = onBaseWeightChange;
