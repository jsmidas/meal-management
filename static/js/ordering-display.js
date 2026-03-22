/**
 * 발주 관리 - 결과 표시/테이블 렌더링/식자재 검색
 * Depends on: ordering-state.js
 */

// ============================================
// 결과 표시
// ============================================
// ============================================
// 결과 표시
// ============================================
async function displayOrderResults(data) {
    // 빈 상태 숨기기
    document.getElementById('emptyState').style.display = 'none';

    // 결과 섹션 표시
    document.getElementById('resultSection').style.display = 'block';

    // Step 3 (최종 발주서)는 초기에 숨김
    document.getElementById('orderSection').style.display = 'none';

    // ★ 이미 발주된 카테고리 체크
    const siteId = typeof SiteSelector !== 'undefined' ?
        (SiteSelector.getCurrentContext()?.id || 1) : 1;
    const usageDate = document.getElementById('mealPlanDate')?.value ||
                      document.querySelector('input[name="usage_date"]')?.value;
    if (usageDate) {
        await checkOrderedCategories(siteId, usageDate);
    }

    // 경고 표시
    displayWarnings(data.warnings || []);

    // ★ 고아 데이터 경고 표시
    displayOrphanDataWarning(data.orphan_data);

    // 끼니별 내역 표시 (Step 2)
    displayMealSections(data.items || []);

    // 요약 업데이트 (일단 초기에는 전체 포함으로 표시하되, Step 3 진입 시 갱신됨)
    // 일단 기존 로직 유지를 위해 호출하되, Step 3 UI가 숨겨져 있으므로 괜찮음.
    if (data.summary) {
        // Step 2 단계에서는 '검증 대기' 상태임을 알리는 등의 처리를 할 수도 있으나
        // 현재 UI상 요약이 상단에 있다면 업데이트 해두는 것이 좋음
        updateSummary(data.summary);
    }
}

// 이미 발주된 카테고리 체크 API 호출
async function checkOrderedCategories(siteId, usageDate) {
    try {
        const response = await fetch(`/api/orders/check-ordered-categories?site_id=${siteId}&usage_date=${usageDate}`);
        const data = await response.json();
        if (data.success) {
            OS.orderedCategories = data.ordered_categories || {};
            console.log('[발주관리] 이미 발주된 카테고리:', OS.orderedCategories);
        } else {
            OS.orderedCategories = {};
        }
    } catch (e) {
        console.error('[발주관리] 카테고리 체크 실패:', e);
        OS.orderedCategories = {};
    }
    return OS.orderedCategories;
}

function displayWarnings(warnings) {
    const section = document.getElementById('warningSection');

    if (!warnings || warnings.length === 0) {
        section.innerHTML = '';
        return;
    }

    // summary에서 마감 시간 정보 가져오기
    const summary = OS.currentOrderData?.summary || {};
    const cutoffInfo = summary.is_after_cutoff
        ? `(현재 ${summary.order_cutoff_hour}시 이후, 실제 발주 처리일: ${summary.actual_order_date})`
        : `(발주 마감: ${summary.order_cutoff_hour}시)`;

    let html = `
        <div class="warning-box danger">
            <div class="warning-title">
                <i class="fas fa-exclamation-triangle"></i>
                발주 불가 품목 (선발주일 미충족) ${cutoffInfo}
            </div>
    `;

    warnings.forEach(w => {
        const daysInfo = w.days_until_delivery !== undefined ? w.days_until_delivery : w.days_until_usage;
        html += `
            <div class="warning-item">
                • ${w.ingredient_name} (D-${w.lead_time} 필요, 현재 D-${daysInfo})
            </div>
        `;
    });

    html += '</div>';
    section.innerHTML = html;
}

// ★★★ 고아 데이터 경고 표시 ★★★
function displayOrphanDataWarning(orphanData) {
    // 기존 고아 데이터 경고 제거
    const existing = document.getElementById('orphanDataWarning');
    if (existing) existing.remove();

    if (!orphanData || orphanData.count === 0) {
        return;
    }

    const warningSection = document.getElementById('warningSection');
    const warningHtml = `
        <div id="orphanDataWarning" class="warning-box info" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin-bottom: 10px;">
            <div class="warning-title" style="color: #856404; font-weight: bold; margin-bottom: 8px;">
                <i class="fas fa-info-circle"></i>
                고아 데이터 제외 안내
            </div>
            <div style="color: #856404; font-size: 13px;">
                <strong>${orphanData.count}건</strong>의 식수 데이터가 발주 계산에서 제외되었습니다.
                (운영 종료 또는 해당 요일 미운영 사업장)
            </div>
            ${orphanData.count <= 5 ? `
            <div style="margin-top: 8px; font-size: 12px; color: #6c757d;">
                ${orphanData.items.map(item =>
                    `• ${item.category} > ${item.slot} > ${item.site_name} (${item.meal_count}명)`
                ).join('<br>')}
            </div>
            ` : `
            <details style="margin-top: 8px;">
                <summary style="cursor: pointer; font-size: 12px; color: #6c757d;">상세 보기 (${orphanData.count}건 중 상위 10건)</summary>
                <div style="margin-top: 5px; font-size: 12px; color: #6c757d; padding-left: 10px;">
                    ${orphanData.items.map(item =>
                        `• ${item.category} > ${item.slot} > ${item.site_name} (${item.meal_count}명)`
                    ).join('<br>')}
                </div>
            </details>
            `}
        </div>
    `;
    warningSection.insertAdjacentHTML('beforeend', warningHtml);
}

function displayMealSections(items) {
    const section = document.getElementById('mealSections');
    OS.selectedRefKeys.clear();
    OS.groupSelectionState = {};

    // ★★★ 새 구조: Category -> Ingredient (메뉴별 합산) ★★★
    const byCategory = {};

    // 현재 사업장 이름 가져오기
    const siteName = typeof SiteSelector !== 'undefined' ?
        (SiteSelector.getCurrentContext()?.siteName || '본사') : '본사';

    items.forEach((item, itemIndex) => {
        (item.meal_refs || []).forEach((ref, refIndex) => {
            // 카테고리 (예: 도시락, 운반)
            const categoryName = ref.category || '기타';

            // 식재료 고유 키
            const ingredientKey = item.ingredient_code || item.ingredient_name;

            if (!byCategory[categoryName]) {
                byCategory[categoryName] = {
                    name: categoryName,
                    siteName: siteName,
                    ingredients: {},
                    totalHeadCount: 0
                };
            }

            if (!byCategory[categoryName].ingredients[ingredientKey]) {
                byCategory[categoryName].ingredients[ingredientKey] = {
                    ingredient_code: item.ingredient_code,
                    ingredient_name: item.ingredient_name,
                    specification: item.specification,
                    supplier_name: item.supplier_name,
                    unit: item.unit,
                    unit_price: item.unit_price || 0,
                    can_order: item.can_order !== false,
                    warning: item.warning || '',
                    total_qty: 0,
                    total_qty_g: 0,  // ★ 총필요량(g)
                    total_head_count: 0,
                    base_weight_grams: item.base_weight_grams || 1000,  // ★ 수량계산용 기준용량(g)
                    price_base_weight_grams: item.price_base_weight_grams || item.base_weight_grams || 1000,  // ★ 가격계산용 기준용량(g)
                    menu_breakdown: [],  // 메뉴별 상세
                    refs: []  // 선택 추적용
                };
            }

            // 고유 키 생성
            const refUniqueKey = `${itemIndex}_${refIndex}`;

            // 발주 가능한 항목만 기본 선택
            if (item.can_order !== false) {
                OS.selectedRefKeys.add(refUniqueKey);
            }

            const perPersonQty = ref.per_person_qty || 0;
            const perPersonQtyG = ref.per_person_qty_g || 0;  // ★ 1인필요량(g)
            const headCount = ref.head_count || 0;
            const qty = perPersonQty * headCount;
            const qtyG = ref.qty_g || (perPersonQtyG * headCount);  // ★ 총필요량(g)

            // ★★★ 슬롯 단위로 합산 (납품처별 분리 X) ★★★
            const menuName = ref.menu_name || '메뉴명 없음';
            const mealType = ref.meal_type || '';
            const slotName = ref.slot_name || '';
            const slotKey = `${mealType}_${menuName}_${slotName}`;  // 슬롯 단위 그룹 키

            // 기존에 같은 슬롯 항목이 있는지 확인
            const existingSlot = byCategory[categoryName].ingredients[ingredientKey].menu_breakdown
                .find(mb => mb.slotKey === slotKey);

            if (existingSlot) {
                // 기존 항목에 합산
                existingSlot.head_count += headCount;
                existingSlot.qty += qty;
                existingSlot.qty_g += qtyG;
                existingSlot.refKeys.push(refUniqueKey);  // 모든 refKey 추적
            } else {
                // 새 항목 추가
                byCategory[categoryName].ingredients[ingredientKey].menu_breakdown.push({
                    menu_name: menuName,
                    meal_type: mealType,
                    slot_name: slotName,
                    slotKey: slotKey,  // 그룹핑 키
                    head_count: headCount,
                    per_person_qty: perPersonQty,
                    per_person_qty_g: perPersonQtyG,
                    qty: qty,
                    qty_g: qtyG,
                    breakdown: ref.breakdown || [],
                    refKey: refUniqueKey,  // 첫 번째 refKey (대표)
                    refKeys: [refUniqueKey],  // 모든 refKey 배열
                    itemIndex: itemIndex,
                    refIndex: refIndex
                });
            }

            // 총량 합산
            byCategory[categoryName].ingredients[ingredientKey].total_qty += qty;
            byCategory[categoryName].ingredients[ingredientKey].total_qty_g += qtyG;  // ★ g단위 합산
            byCategory[categoryName].ingredients[ingredientKey].total_head_count += headCount;
            byCategory[categoryName].ingredients[ingredientKey].refs.push({
                refKey: refUniqueKey,
                itemIndex: itemIndex,
                refIndex: refIndex
            });
        });
    });

    if (Object.keys(byCategory).length === 0) {
        section.innerHTML = `
            <div class="warning-box">
                <div class="warning-title"><i class="fas fa-info-circle"></i> 식단 정보 없음</div>
                <div class="warning-item">선택한 날짜에 등록된 식단표가 없거나 식수가 0입니다.</div>
            </div>
        `;
        return;
    }

    // 발주불가 식자재 수집
    const unorderableItems = [];
    items.forEach(item => {
        if (item.can_order === false && item.warning) {
            unorderableItems.push({
                ingredient_name: item.ingredient_name,
                ingredient_code: item.ingredient_code,
                supplier_name: item.supplier_name,
                warning: item.warning,
                menu_refs: [...new Set((item.meal_refs || []).map(ref => ref.menu_name))].join(', ')
            });
        }
    });

    let html = '';

    // 발주불가 식자재 경고 섹션
    if (unorderableItems.length > 0) {
        html += `
            <div class="unorderable-warning-box" style="
                background: linear-gradient(135deg, #fff5f5 0%, #fed7d7 100%);
                border: 2px solid #fc8181;
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 30px;
                box-shadow: 0 4px 15px rgba(252, 129, 129, 0.2);
            ">
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #feb2b2;
                ">
                    <i class="fas fa-exclamation-triangle" style="color: #c53030; font-size: 1.5rem;"></i>
                    <h3 style="margin: 0; color: #c53030; font-size: 1.2rem;">
                        발주불가 식자재 (${unorderableItems.length}건)
                    </h3>
                </div>
                <p style="color: #742a2a; margin-bottom: 15px; font-size: 0.9rem;">
                    아래 식자재는 발주가 불가능합니다. 대체 식자재를 추가하거나 레시피를 수정해 주세요.
                </p>
                <div style="max-height: 300px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: #feb2b2;">
                                <th style="padding: 8px; text-align: left; border: 1px solid #fc8181;">식자재코드</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #fc8181;">식자재명</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #fc8181;">협력업체</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #fc8181;">사유</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #fc8181;">사용 메뉴</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        unorderableItems.forEach(item => {
            html += `
                <tr style="background: white;">
                    <td style="padding: 8px; border: 1px solid #fc8181; color: #742a2a;">${item.ingredient_code || '-'}</td>
                    <td style="padding: 8px; border: 1px solid #fc8181; font-weight: 600; color: #c53030;">${item.ingredient_name}</td>
                    <td style="padding: 8px; border: 1px solid #fc8181; color: #742a2a;">${item.supplier_name || '-'}</td>
                    <td style="padding: 8px; border: 1px solid #fc8181; color: #9b2c2c; font-weight: 500;">
                        <i class="fas fa-ban" style="margin-right: 5px;"></i>${item.warning}
                    </td>
                    <td style="padding: 8px; border: 1px solid #fc8181; color: #742a2a; font-size: 0.8rem;">${item.menu_refs}</td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ★★★ 새 구조: 카테고리 > 식재료별 그룹핑 ★★★
    Object.values(byCategory).forEach(cat => {
        const categoryId = `cat_${cat.name.replace(/\s+/g, '_')}`;

        // ★★★ 이미 발주된 카테고리 체크 ★★★
        const alreadyOrdered = OS.orderedCategories[cat.name];
        const isBlocked = !!alreadyOrdered;

        // 발주된 카테고리는 기본 선택 해제
        OS.groupSelectionState[categoryId] = !isBlocked;

        // 카테고리별 총 식수 계산 (중복 제거)
        const categoryTotalHeadCount = Object.values(cat.ingredients).reduce((sum, ing) => {
            // 각 식재료의 메뉴별 식수 중 최대값만 합산 (중복 방지)
            const uniqueMenus = new Set();
            let maxHeadCount = 0;
            ing.menu_breakdown.forEach(mb => {
                const menuKey = `${mb.meal_type}_${mb.menu_name}`;
                if (!uniqueMenus.has(menuKey)) {
                    uniqueMenus.add(menuKey);
                    maxHeadCount += mb.head_count;
                }
            });
            return Math.max(sum, maxHeadCount);
        }, 0);

        // ★ 이미 발주된 카테고리용 스타일
        const headerBg = isBlocked
            ? 'linear-gradient(135deg, #718096 0%, #4a5568 100%)'
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        const headerShadow = isBlocked
            ? '0 4px 15px rgba(113, 128, 150, 0.3)'
            : '0 4px 15px rgba(102, 126, 234, 0.3)';

        // ★ 발주완료 뱃지
        const orderedBadge = isBlocked ? `
            <span style="
                background: #fc8181;
                color: white;
                padding: 4px 12px;
                border-radius: 15px;
                font-size: 0.8rem;
                font-weight: 700;
                margin-left: 10px;
            ">
                <i class="fas fa-check-circle" style="margin-right: 4px;"></i>
                발주완료 (${alreadyOrdered.order_number})
            </span>
        ` : '';

        html += `
            <div class="category-section ${isBlocked ? 'already-ordered' : ''}" id="section_${categoryId}" style="margin-bottom: 40px; ${isBlocked ? 'opacity: 0.7;' : ''}">
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding: 15px 20px;
                    background: ${headerBg};
                    border-radius: 10px;
                    box-shadow: ${headerShadow};
                ">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <input type="checkbox" id="chk_${categoryId}" ${isBlocked ? '' : 'checked'}
                            onchange="toggleCategorySelection('${categoryId}', this.checked)"
                            style="width: 20px; height: 20px; cursor: ${isBlocked ? 'not-allowed' : 'pointer'};"
                            ${isBlocked ? 'disabled' : ''}>
                        <h2 style="margin: 0; font-size: 1.3rem; color: white; font-weight: 700;">
                            <i class="fas fa-building" style="margin-right: 8px;"></i>
                            ${cat.siteName} > ${cat.name}
                            ${orderedBadge}
                        </h2>
                    </div>
                    <span style="background: rgba(255,255,255,0.2); color: white; padding: 6px 15px; border-radius: 20px; font-size: 0.9rem; font-weight: 600;">
                        ${Object.keys(cat.ingredients).length}개 식자재
                    </span>
                </div>
        `;

        // 식재료 순회
        Object.values(cat.ingredients).forEach(ing => {
            const ingId = `${categoryId}_${(ing.ingredient_code || ing.ingredient_name).replace(/[^a-zA-Z0-9가-힣]/g, '_')}`;
            const canOrder = ing.can_order && !isBlocked;  // ★ 이미 발주된 카테고리면 발주불가
            const warningMsg = isBlocked ? '이미 발주완료' : (ing.warning || '');
            // ★★★ 가격 계산: 필요 패키지 수 × 패키지당 단가 ★★★
            // total_qty_g: 총 필요량(g)
            // price_base_weight_grams: 가격계산용 패키지 용량(g) - 대체품인 경우 대체품 값
            // unit_price: 패키지당 가격
            const priceBaseWeight = ing.price_base_weight_grams || ing.base_weight_grams || 1000;
            const requiredPackages = (ing.total_qty_g || 0) / priceBaseWeight;
            const estimatedPrice = Math.round(requiredPackages * ing.unit_price);

            // 발주불가 항목 스타일 (이미 발주된 카테고리는 회색 배경)
            const boxBgColor = isBlocked ? '#f7fafc' : (canOrder ? 'white' : '#fff5f5');
            const boxBorder = isBlocked ? '1px solid #cbd5e0' : (canOrder ? '1px solid #e2e8f0' : '2px solid #fc8181');

            // ★ g/kg 포맷 헬퍼 함수
            const formatGrams = (grams) => {
                if (!grams || grams === 0) return '';
                if (grams >= 1000) {
                    return (grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'kg';
                }
                return grams.toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'g';
            };

            // 메뉴별 상세 내역 구성 (슬롯 단위로 합산됨)
            let menuBreakdownHtml = ing.menu_breakdown.map(mb => {
                const qtyGDisplay = mb.qty_g > 0 ? ` <span style="color: #805ad5; font-size: 0.85rem; font-weight: 600;">(${formatGrams(mb.qty_g)})</span>` : '';
                // ★ 이미 발주된 카테고리의 항목은 selectedRefKeys에서 제거
                if (isBlocked && mb.refKeys) {
                    mb.refKeys.forEach(rk => OS.selectedRefKeys.delete(rk));
                }
                // ★ 표시 형식: [중식] 메뉴명 | 슬롯명 (납품처는 표시 안함)
                const slotDisplay = mb.slot_name ? ` <span style="font-size: 0.8rem; color: #a0aec0;">|</span> <span style="color: #667eea; font-weight: 600;">${mb.slot_name}</span>` : '';

                // refKeys를 JSON 문자열로 (체크박스 토글용)
                const refKeysJson = JSON.stringify(mb.refKeys || [mb.refKey]).replace(/"/g, '&quot;');

                return `
                <div style="display: flex; align-items: center; padding: 8px 12px; background: ${isBlocked ? '#edf2f7' : '#f7fafc'}; border-radius: 6px; margin-bottom: 5px; border-left: 3px solid ${isBlocked ? '#cbd5e0' : '#667eea'};">
                    <input type="checkbox" class="item-chk cat-chk-${categoryId}"
                        id="chk_${mb.refKey}" ${canOrder && !isBlocked ? 'checked' : ''}
                        data-category="${categoryId}"
                        data-ref-keys="${refKeysJson}"
                        onchange="toggleSlotSelection(this, '${categoryId}')"
                        style="cursor: ${isBlocked ? 'not-allowed' : 'pointer'}; margin-right: 12px; width: 16px; height: 16px;"
                        ${!canOrder || isBlocked ? 'disabled' : ''}>
                    <span style="min-width: 280px; flex: 2; font-weight: 500; color: ${isBlocked ? '#a0aec0' : '#2d3748'}; font-size: 0.9rem;">
                        [${mb.meal_type}] ${mb.menu_name}${slotDisplay}
                    </span>
                    <span style="flex: 1; font-family: 'Consolas', monospace; color: ${isBlocked ? '#a0aec0' : '#4a5568'}; font-size: 0.9rem; text-align: right;">
                        <span style="color: ${isBlocked ? '#cbd5e0' : '#718096'};">${(mb.per_person_qty_g || 0).toFixed(1)}g × ${mb.head_count}명</span>
                        <span style="margin: 0 6px; color: #cbd5e0;">=</span>
                        <strong style="color: ${isBlocked ? '#a0aec0' : '#2b6cb0'}; font-size: 1rem; font-weight: 700;">${((mb.per_person_qty_g || 0) * mb.head_count).toLocaleString(undefined, { maximumFractionDigits: 0 })}g</strong>
                        <span style="color: #718096; font-size: 0.85rem; margin-left: 4px;">(${(((mb.per_person_qty_g || 0) * mb.head_count) / 1000).toFixed(2)}kg)</span>
                    </span>
                </div>
            `;}).join('');

            html += `
                <div class="ingredient-box" id="ing_${ingId}" style="
                    background: ${boxBgColor};
                    border: ${boxBorder};
                    border-radius: 8px;
                    padding: 15px 20px;
                    margin-bottom: 15px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                ">
                    <div class="ingredient-header" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding-bottom: 10px;
                        border-bottom: 1px solid #edf2f7;
                        margin-bottom: 10px;
                    ">
                        <div style="display: flex; align-items: center; gap: 12px; flex: 3;">
                            ${!canOrder && !isBlocked ? `<i class="fas fa-exclamation-circle" style="color: #c53030;" title="${warningMsg}"></i>` : ''}
                            ${isBlocked ? `<i class="fas fa-check-circle" style="color: #718096;" title="이미 발주완료"></i>` : ''}
                            <span style="width: 80px; font-size: 0.75rem; color: ${isBlocked ? '#a0aec0' : '#888'};">${ing.ingredient_code || '-'}</span>
                            <span style="font-weight: 700; font-size: 1rem; color: ${isBlocked ? '#a0aec0' : (canOrder ? '#2d3748' : '#c53030')};">
                                ${ing.ingredient_name}
                                ${ing.specification ? `<span style="font-weight:normal; color:${isBlocked ? '#cbd5e0' : '#718096'}; font-size:0.85rem; margin-left:6px;">(${ing.specification})</span>` : ''}
                                ${!canOrder && !isBlocked ? `<span style="color: #e53e3e; font-size: 0.75rem; margin-left: 8px; background: #fed7d7; padding: 2px 6px; border-radius: 4px;">발주불가</span>` : ''}
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 20px;">
                            <span style="color: #667eea; font-size: 0.85rem;">${ing.supplier_name || '-'}</span>
                            <span style="
                                background: #ebf8ff;
                                color: #2b6cb0;
                                padding: 4px 12px;
                                border-radius: 15px;
                                font-weight: 700;
                                font-size: 0.95rem;
                            ">
                                총 ${ing.total_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}${ing.unit}
                            </span>
                            ${ing.total_qty_g > 0 ? `<span style="
                                background: #e9d8fd;
                                color: #805ad5;
                                padding: 4px 10px;
                                border-radius: 15px;
                                font-weight: 600;
                                font-size: 0.85rem;
                            ">${formatGrams(ing.total_qty_g)}</span>` : ''}
                            <span style="color: #718096; font-size: 0.85rem;">@${ing.unit_price.toLocaleString()}</span>
                            <span style="font-weight: 600; color: ${canOrder ? '#38a169' : '#a0aec0'};">
                                ${canOrder ? estimatedPrice.toLocaleString() + '원' : '-'}
                            </span>
                        </div>
                    </div>
                    <div class="menu-breakdown" style="padding-left: 10px;">
                        <div style="font-size: 0.8rem; color: #718096; margin-bottom: 6px;">
                            <i class="fas fa-list-ul" style="margin-right: 5px;"></i>메뉴별 상세 (${ing.menu_breakdown.length}개 메뉴)
                        </div>
                        ${menuBreakdownHtml}
                    </div>
                </div>
            `;
        });

        html += `</div>`; // End Category Section
    });

    // 생성 버튼 추가
    html += `
        <div style="text-align: center; margin-top: 40px; padding: 30px; background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
            <h4 style="margin-bottom: 10px; color: #2d3748;">검증 완료</h4>
            <p style="color: #718096; margin-bottom: 20px;">
                선택한 식재료들로 최종 발주서를 생성합니다.<br>
                (체크 해제된 항목은 발주서에서 제외됩니다)
            </p>
            <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                <button class="btn btn-secondary" onclick="downloadStep2Excel(true)" style="
                    font-size: 1rem;
                    padding: 12px 20px;
                    border-radius: 8px;
                    background-color: #718096;
                    color: white;
                    border: none;
                    box-shadow: 0 4px 6px rgba(113, 128, 150, 0.4);
                    transition: transform 0.2s;
                "
                onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-file-excel" style="margin-right: 8px;"></i> 전체 엑셀 다운로드
                </button>
                <button class="btn btn-secondary" onclick="downloadStep2Excel(false)" style="
                    font-size: 1rem;
                    padding: 12px 20px;
                    border-radius: 8px;
                    background-color: #2b6cb0;
                    color: white;
                    border: none;
                    box-shadow: 0 4px 6px rgba(43, 108, 176, 0.4);
                    transition: transform 0.2s;
                "
                onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-file-excel" style="margin-right: 8px;"></i> 선택 항목만 엑셀 다운로드
                </button>
                <button class="btn btn-primary" onclick="generateFinalOrder()" style="
                    font-size: 1.2rem;
                    padding: 15px 40px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none;
                    box-shadow: 0 4px 6px rgba(102, 126, 234, 0.4);
                    transition: transform 0.2s;
                "
                onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform='translateY(0)'"
                >
                    <i class="fas fa-file-invoice-dollar" style="margin-right: 10px;"></i> 최종 발주서 생성하기
                </button>
            </div>
        </div>
    `;

    section.innerHTML = html;
}

// Step 2 엑셀 다운로드 (XLSX)
// includeAll: true면 전체, false면 선택된 항목만
function downloadStep2Excel(includeAll = false) {
    if (!OS.currentOrderData || !OS.currentOrderData.items) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }

    // 데이터 준비
    const data = [];
    // 헤더 (선택 여부 컬럼 추가)
    if (includeAll) {
        data.push(["선택여부", "카테고리", "메뉴(슬롯명)", "식수", "식수상세내역", "식자재코드", "식자재명", "규격", "협력업체", "단위", "1인량", "총발주량", "단가", "예상금액"]);
    } else {
        data.push(["카테고리", "메뉴(슬롯명)", "식수", "식수상세내역", "식자재코드", "식자재명", "규격", "협력업체", "단위", "1인량", "총발주량", "단가", "예상금액"]);
    }

    let includedCount = 0;
    let excludedCount = 0;

    OS.currentOrderData.items.forEach(item => {
        if (!item.meal_refs) return;

        const itemIndex = OS.currentOrderData.items.indexOf(item);

        item.meal_refs.forEach((ref, refIndex) => {
            const refKey = `${itemIndex}_${refIndex}`;
            const isSelected = OS.selectedRefKeys.has(refKey);

            // 선택 항목만 모드일 때 선택되지 않은 항목 스킵
            if (!includeAll && !isSelected) {
                excludedCount++;
                return;
            }

            if (isSelected) includedCount++;
            else excludedCount++;

            const category = ref.category || '기타';
            const menuName = `[${ref.meal_type}] ${ref.menu_name || ''}`;
            let breakdownStr = "";
            if (ref.breakdown) {
                breakdownStr = ref.breakdown.map(b => `${b.site}:${b.count}`).join(" | ");
            }

            if (includeAll) {
                const row = [
                    isSelected ? "O" : "X",  // 선택 여부 표시
                    category,
                    menuName,
                    ref.head_count,
                    breakdownStr,
                    item.ingredient_code || "",
                    item.ingredient_name.replace(/,/g, " "),
                    item.specification || "",
                    item.supplier_name || "",
                    item.unit,
                    ref.per_person_qty,
                    parseFloat((ref.per_person_qty * ref.head_count).toFixed(2)),
                    item.unit_price,
                    Math.round(ref.per_person_qty * ref.head_count * item.unit_price)
                ];
                data.push(row);
            } else {
                const row = [
                    category,
                    menuName,
                    ref.head_count,
                    breakdownStr,
                    item.ingredient_code || "",
                    item.ingredient_name.replace(/,/g, " "),
                    item.specification || "",
                    item.supplier_name || "",
                    item.unit,
                    ref.per_person_qty,
                    parseFloat((ref.per_person_qty * ref.head_count).toFixed(2)),
                    item.unit_price,
                    Math.round(ref.per_person_qty * ref.head_count * item.unit_price)
                ];
                data.push(row);
            }
        });
    });

    // 선택된 항목이 없는 경우 경고
    if (!includeAll && data.length <= 1) {
        alert('선택된 항목이 없습니다.');
        return;
    }

    // 워크북 생성
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // 컬럼 너비 설정 (전체 모드일 때 선택여부 컬럼 추가)
    const wscols = includeAll
        ? [
            { wch: 8 },  // 선택여부
            { wch: 10 }, // 카테고리
            { wch: 30 }, // 메뉴
            { wch: 8 },  // 식수
            { wch: 40 }, // 상세내역
            { wch: 15 }, // 식자재코드
            { wch: 30 }, // 식자재명
            { wch: 20 }, // 규격
            { wch: 15 }, // 협력업체
            { wch: 8 },  // 단위
            { wch: 10 }, // 1인량
            { wch: 10 }, // 총발주량
            { wch: 10 }, // 단가
            { wch: 15 }  // 예상금액
        ]
        : [
            { wch: 10 }, // 카테고리
            { wch: 30 }, // 메뉴
            { wch: 8 },  // 식수
            { wch: 40 }, // 상세내역
            { wch: 15 }, // 식자재코드
            { wch: 30 }, // 식자재명
            { wch: 20 }, // 규격
            { wch: 15 }, // 협력업체
            { wch: 8 },  // 단위
            { wch: 10 }, // 1인량
            { wch: 10 }, // 총발주량
            { wch: 10 }, // 단가
            { wch: 15 }  // 예상금액
        ];
    ws['!cols'] = wscols;

    const sheetName = includeAll ? "Step2_전체검증내역" : "Step2_선택항목";
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // 다운로드 (파일명에 모드 표시)
    const filename = includeAll
        ? `Step2_전체검증내역_${document.getElementById('orderDate').value}.xlsx`
        : `Step2_선택항목_${document.getElementById('orderDate').value}.xlsx`;
    XLSX.writeFile(wb, filename);
}



// 체크박스 로직
// 수정: CSS 클래스 대신 data-group 속성 사용 (메뉴명에 공백/특수문자 있을 때 오류 방지)
// ★★★ 카테고리 전체 선택/해제 ★★★
function toggleCategorySelection(categoryId, isChecked) {
    // 해당 카테고리의 모든 체크박스 선택/해제
    const checkboxes = document.querySelectorAll(`input.item-chk.cat-chk-${categoryId}`);
    checkboxes.forEach(chk => {
        if (!chk.disabled) {  // 발주불가 항목은 제외
            chk.checked = isChecked;
            // ★ refKeys 배열 처리 (슬롯 단위 합산)
            const refKeysJson = chk.getAttribute('data-ref-keys');
            try {
                const refKeys = JSON.parse(refKeysJson);
                refKeys.forEach(refKey => {
                    if (isChecked) OS.selectedRefKeys.add(refKey);
                    else OS.selectedRefKeys.delete(refKey);
                });
            } catch (e) {
                // fallback: 단일 refKey
                const refKey = chk.dataset.refKey;
                if (refKey) {
                    if (isChecked) OS.selectedRefKeys.add(refKey);
                    else OS.selectedRefKeys.delete(refKey);
                }
            }
        }
    });
    OS.groupSelectionState[categoryId] = isChecked;
}

function toggleGroupSelection(groupKey, isChecked) {
    // data-group 속성으로 선택 (공백, 괄호 등 특수문자에 안전)
    const checkboxes = document.querySelectorAll(`input.item-chk[data-group="${groupKey}"]`);
    checkboxes.forEach(chk => {
        chk.checked = isChecked;
        const refKey = chk.dataset.refKey;
        if (isChecked) OS.selectedRefKeys.add(refKey);
        else OS.selectedRefKeys.delete(refKey);
    });
    OS.groupSelectionState[groupKey] = isChecked;
}

function toggleRefSelection(refKey, categoryId) {
    const chk = document.getElementById(`chk_${refKey}`);
    if (!chk) return;  // 요소가 없으면 종료
    const isChecked = chk.checked;

    if (isChecked) OS.selectedRefKeys.add(refKey);
    else OS.selectedRefKeys.delete(refKey);

    // 카테고리 체크박스 상태 업데이트 (하나라도 해제되면 카테고리 해제, 모두 체크되면 카테고리 체크)
    const categoryChk = document.getElementById(`chk_${categoryId}`);
    if (!categoryChk) return;  // 요소가 없으면 종료

    if (!isChecked) {
        categoryChk.checked = false;
        OS.groupSelectionState[categoryId] = false;
    } else {
        // 해당 카테고리의 모든 항목이 체크되었는지 확인
        const allCategoryItems = document.querySelectorAll(`input.item-chk.cat-chk-${categoryId}`);
        const allChecked = Array.from(allCategoryItems).every(c => c.checked || c.disabled);
        categoryChk.checked = allChecked;
        OS.groupSelectionState[categoryId] = allChecked;
    }
}

// ★ 슬롯 단위 선택 토글 (여러 refKey를 한번에 처리)
function toggleSlotSelection(checkbox, categoryId) {
    const isChecked = checkbox.checked;
    const refKeysJson = checkbox.getAttribute('data-ref-keys');

    try {
        const refKeys = JSON.parse(refKeysJson);
        refKeys.forEach(refKey => {
            if (isChecked) OS.selectedRefKeys.add(refKey);
            else OS.selectedRefKeys.delete(refKey);
        });
    } catch (e) {
        console.error('[toggleSlotSelection] refKeys 파싱 오류:', e);
    }

    // 카테고리 체크박스 상태 업데이트
    const categoryChk = document.getElementById(`chk_${categoryId}`);
    if (!categoryChk) return;

    if (!isChecked) {
        categoryChk.checked = false;
        OS.groupSelectionState[categoryId] = false;
    } else {
        const allCategoryItems = document.querySelectorAll(`input.item-chk.cat-chk-${categoryId}`);
        const allChecked = Array.from(allCategoryItems).every(c => c.checked || c.disabled);
        categoryChk.checked = allChecked;
        OS.groupSelectionState[categoryId] = allChecked;
    }
}

// 최종 발주서 생성 로직
function generateFinalOrder() {
    if (!OS.currentOrderData || !OS.currentOrderData.items) return;

    // DEBUG: generateFinalOrder 시작 시 currentOrderData 확인
    const srcItems = OS.currentOrderData.items;
    const srcUnorderable = srcItems.filter(i => i.can_order === false);
    console.log('[DEBUG GEN] currentOrderData.items 총:', srcItems.length, ', can_order===false:', srcUnorderable.length);
    if (srcUnorderable.length > 0) {
        console.log('[DEBUG GEN] 첫 번째 발주불가:', srcUnorderable[0].ingredient_name, ', can_order:', srcUnorderable[0].can_order);
    }

    showLoading('최종 발주서를 생성하고 있습니다...');

    // setTimeout으로 UI 렌더링 시간 확보
    setTimeout(() => {
        try {
            // Deep copy items to avoid mutating original
            // 그러나 여기서는 새로운 item 리스트를 만드는 방식이 나음

            // 1. 선택된 refKey들을 파싱하여 itemIndex별로 어떤 refIndex가 선택되었는지 맵핑
            // Map<itemIndex, Set<refIndex>>
            const selectionMap = new Map();
            OS.selectedRefKeys.forEach(refKey => {
                const [itemIdxStr, refIdxStr] = refKey.split('_');
                const itemIdx = parseInt(itemIdxStr);
                const refIdx = parseInt(refIdxStr);

                if (!selectionMap.has(itemIdx)) {
                    selectionMap.set(itemIdx, new Set());
                }
                selectionMap.get(itemIdx).add(refIdx);
            });

            // 2. 필터링 및 재계산 수행
            const finalItems = [];

            OS.currentOrderData.items.forEach((item, index) => {
                const selectedRefsIndices = selectionMap.get(index);

                // ★★★ 발주불가 품목은 선택 여부와 관계없이 포함 (대체/제외 버튼 표시용) ★★★
                const isUnorderable = item.can_order === false;

                // 선택된 것이 하나도 없고, 발주가능 품목이면 제외
                if ((!selectedRefsIndices || selectedRefsIndices.size === 0) && !isUnorderable) {
                    return;
                }

                // 원본 item 복사 (얕은 복사 후 필요한 필드 재계산)
                const newItem = { ...item };

                // meal_refs 필터링
                const originalRefs = item.meal_refs || [];

                // 발주불가 품목은 모든 refs 포함 (표시용), 발주가능 품목은 선택된 refs만
                const filteredRefs = isUnorderable
                    ? originalRefs  // 발주불가: 모든 refs 포함
                    : originalRefs.filter((_, refIdx) => selectedRefsIndices && selectedRefsIndices.has(refIdx));

                newItem.meal_refs = filteredRefs;

                // qty 재계산 (서버 로직과 동일하게)
                // 서버: per_person_qty_g = per_person_qty * base_weight_grams
                //       required_qty = (per_person_qty_g / 1000) * head_count (kg 단위)

                let newRequiredQty = 0;
                let newMealCount = 0;

                // 단위 확인 (중량 단위인지 포장 단위인지)
                const unit = (newItem.unit || '').toLowerCase().trim();
                const weightUnits = ['kg', 'g', 'kg/box', 'g/ea', 'ml', 'l', '리터', '그램', '킬로그램'];
                const isWeightUnit = weightUnits.some(w => unit.includes(w)) || unit.includes('/');
                const baseWeight = newItem.base_weight_grams || 1000;

                filteredRefs.forEach(ref => {
                    let perPersonQtyG;
                    if (isWeightUnit) {
                        // 중량 단위: per_person_qty를 kg로 해석 → g 변환
                        perPersonQtyG = ref.per_person_qty * 1000;
                    } else {
                        // 포장 단위(PK, EA 등): base_weight 곱함
                        perPersonQtyG = ref.per_person_qty * baseWeight;
                    }
                    // kg 단위로 변환하여 합산
                    newRequiredQty += (perPersonQtyG / 1000) * ref.head_count;
                    newMealCount += ref.head_count;
                });

                newItem.required_qty = newRequiredQty;
                // meal_count는 단순 합산이 애매하지만(중복인원 등), 여기서는 로직상 합산값으로 둠
                newItem.meal_count = newMealCount;

                // order_qty 재계산
                // ★ 발주불가 품목은 order_qty = 0 (실제 발주하지 않음)
                if (isUnorderable) {
                    newItem.order_qty = 0;
                    newItem.total_price = 0;
                } else {
                    // ★★★ 단순 계산: 총필요량(g) ÷ 기준용량(g) = 발주량(포) ★★★
                    const totalQtyG = newItem.required_qty_g || 0;
                    // ★ 대체품인 경우 price_base_weight_grams 사용
                    const orderBaseWeightG = newItem.price_base_weight_grams || newItem.base_weight_grams || 1000;
                    newItem.order_qty = totalQtyG / orderBaseWeightG;
                    newItem.total_price = newItem.order_qty * newItem.unit_price;
                }

                finalItems.push(newItem);
            });

            // DEBUG: finalItems 생성 후 확인
            const finalUnorderable = finalItems.filter(i => i.can_order === false);
            console.log('[DEBUG GEN2] finalItems 총:', finalItems.length, ', can_order===false:', finalUnorderable.length);
            if (finalUnorderable.length > 0) {
                console.log('[DEBUG GEN2] 첫 번째 발주불가:', finalUnorderable[0].ingredient_name);
            }

            // 3. 행사 발주 합산 체크 후 Step 3 표시
            checkEventOrderMerge(finalItems, function(mergedItems) {
                document.getElementById('orderSection').style.display = 'block';

                // 테이블 렌더링
                displayOrderTable(mergedItems);

                // 요약 업데이트
                const tempSummary = {
                    ...OS.currentOrderData.summary,
                    total_items: mergedItems.length,
                    orderable_items: mergedItems.filter(i => i.can_order !== false).length,
                    unorderable_items: mergedItems.filter(i => i.can_order === false).length,
                    total_amount: mergedItems.reduce((sum, i) => sum + i.total_price, 0)
                };
                updateSummary(tempSummary);

                // 스크롤 이동
                document.getElementById('orderSection').scrollIntoView({ behavior: 'smooth' });
            });

        } catch (e) {
            console.error('Final order generation error:', e);
            alert('발주서 생성 중 오류가 발생했습니다.');
        } finally {
            hideLoading();
        }
    }, 100);
}

// Step 3 엑셀 다운로드 (XLSX)
function downloadStep3Excel() {
    if (!OS.currentDisplayItems || OS.currentDisplayItems.length === 0) {
        alert('다운로드할 발주 데이터가 없습니다.');
        return;
    }

    const data = [];
    data.push(["순번", "식자재코드", "식자재명", "규격", "단위", "현재고", "필요량", "실발주량", "단가", "예상금액", "협력업체", "비고"]);

    OS.currentDisplayItems.forEach((item, index) => {
        const row = [
            index + 1,
            item.ingredient_code || "",
            item.ingredient_name,
            item.specification || "",
            item.unit,
            parseFloat(item.current_stock || 0),
            parseFloat(item.required_qty.toFixed(2)),
            parseFloat(item.order_qty.toFixed(2)),
            item.unit_price,
            Math.round(item.total_price),
            item.supplier_name || "",
            item.remarks || ""
        ];
        data.push(row);
    });

    // 워크북 생성
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // 컬럼 너비 설정
    const wscols = [
        { wch: 6 },  // 순번
        { wch: 12 }, // 코드
        { wch: 30 }, // 식자재명
        { wch: 20 }, // 규격
        { wch: 6 },  // 단위
        { wch: 8 },  // 현재고
        { wch: 10 }, // 필요량
        { wch: 10 }, // 실발주량
        { wch: 10 }, // 단가
        { wch: 15 }, // 예상금액
        { wch: 15 }, // 협력업체
        { wch: 20 }  // 비고
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "Step3_최종발주서");

    // 다운로드
    XLSX.writeFile(wb, `Step3_최종발주서_${document.getElementById('orderDate').value}.xlsx`);
}

/**
 * 동일 식자재 코드(ingredient_code)만으로 합산
 * - 협력업체, 품목명 등 다른 기준과 관계없이 순수히 식자재 코드별로 합산
 */
function aggregateOrderItems(items) {
    const grouped = {};
    const mapping = {};

    items.forEach((item, originalIndex) => {
        // 순수히 식자재코드로만 그룹핑
        const key = item.ingredient_code || item.ingredient_id || `unknown_${originalIndex}`;

        if (!grouped[key]) {
            grouped[key] = {
                ...item,
                meal_count: 0,
                required_qty: 0,
                required_qty_g: 0,  // ★ 총필요량(g) 합산용
                order_qty: 0,
                total_price: 0,
                current_stock: item.current_stock || 0,
                original_indices: [],
                can_order: item.can_order === false ? false : true,  // 초기값 명시적 설정
                _has_unorderable: item.can_order === false  // 발주불가 아이템 존재 여부 추적
            };
        }

        // 합산
        grouped[key].meal_count += (item.meal_count || 0);
        grouped[key].required_qty += (item.required_qty || 0);
        grouped[key].required_qty_g += (item.required_qty_g || 0);  // ★ 총필요량(g) 합산
        grouped[key].order_qty += (item.order_qty || 0);
        grouped[key].total_price += (item.total_price || 0);
        grouped[key].original_indices.push(originalIndex);

        // 발주 가능 여부: 하나라도 발주불가면 발주불가로 표시 (보수적 접근)
        if (item.can_order === false) {
            grouped[key].can_order = false;
            grouped[key]._has_unorderable = true;
            grouped[key].warning = item.warning || grouped[key].warning;  // 경고 메시지 보존
        }

        // meal_refs 합치기
        if (item.meal_refs && item.meal_refs.length > 0) {
            if (!grouped[key].all_meal_refs) {
                grouped[key].all_meal_refs = [];
            }
            grouped[key].all_meal_refs.push(...item.meal_refs);
        }
    });

    // 배열로 변환하고 매핑 생성
    const aggregatedItems = [];
    Object.values(grouped).forEach((aggItem, aggIndex) => {
        mapping[aggIndex] = aggItem.original_indices;
        aggregatedItems.push(aggItem);
    });

    return { aggregatedItems, mapping };
}

function displayOrderTable(items) {
    const tbody = document.getElementById('orderTableBody');
    OS.currentDisplayItems = items || [];

    // 디버그: 원본 데이터의 can_order 값 확인
    console.log('[DEBUG] displayOrderTable called with', items?.length, 'items');
    if (items && items.length > 0) {
        const unorderableRaw = items.filter(i => i.can_order === false);
        console.log('[DEBUG] Raw items with can_order===false:', unorderableRaw.length);
        if (unorderableRaw.length > 0) {
            console.log('[DEBUG] First unorderable item:', unorderableRaw[0]);
        }
        // can_order 값 분포 확인
        const canOrderValues = items.map(i => i.can_order);
        const uniqueValues = [...new Set(canOrderValues)];
        console.log('[DEBUG] can_order unique values:', uniqueValues);
    }

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="14" style="text-align: center; padding: 2rem; color: #666;">
                    발주할 품목이 없습니다.
                </td>
            </tr>
        `;
        OS.aggregatedOrderData = null;
        OS.aggregatedToOriginalMap = {};
        return;
    }

    // 메뉴 기반 항목과 수동 추가 항목 분리
    const menuBasedItems = items.filter(i => i.is_manual !== true);
    const manualItems = items.filter(i => i.is_manual === true);

    // 메뉴 기반 항목 합산
    const { aggregatedItems: menuAggItems, mapping: menuMapping } = aggregateOrderItems(menuBasedItems);

    // 수동 항목은 합산하지 않고 개별 표시
    const manualAggItems = manualItems.map((item, idx) => ({
        ...item,
        original_indices: [menuBasedItems.length + idx],
        is_manual: true
    }));

    // 전체 합산 데이터 (메뉴 기반 + 수동)
    OS.aggregatedOrderData = [...menuAggItems, ...manualAggItems];
    OS.aggregatedToOriginalMap = menuMapping;

    console.log(`[발주] 메뉴기반 ${menuAggItems.length}건 + 수동 ${manualAggItems.length}건 = 총 ${OS.aggregatedOrderData.length}건`);

    let html = '';
    let rowNum = 1;

    // 메뉴 기반 식자재 표시
    console.log('[DEBUG] menuAggItems count:', menuAggItems.length);
    const unorderableCount = menuAggItems.filter(i => i.can_order === false).length;
    console.log('[DEBUG] Unorderable items:', unorderableCount);

    menuAggItems.forEach((item, index) => {
        const canOrder = item.can_order !== false;
        if (!canOrder) {
            console.log('[DEBUG] Unorderable item found:', index, item.ingredient_name, 'can_order:', item.can_order);
        }
        const priceExpired = item.price_expired === true;
        const statusBadge = priceExpired
            ? '<span class="badge badge-warning" style="background:#ff9800;color:white;cursor:help;" title="단가 유효기간 만료">단가만료</span>'
            : (canOrder
                ? '<span class="badge badge-success">발주가능</span>'
                : `<span class="badge badge-danger" title="${item.warning || ''}" style="cursor: help;">발주마감</span>`);

        const mergeInfo = item.original_indices.length > 1
            ? `<small style="color: #888; font-size: 10px;"><br>(${item.original_indices.length}건 합산)</small>`
            : '';

        const deleteBtn = `<button onclick="deleteOrderItem(${index})" style="padding: 3px 8px; background: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px; margin-left: 5px;" title="삭제"><i class="fas fa-trash-alt"></i></button>`;

        // 발주 불가 품목에 대체/제외 버튼 추가
        const overrideButtons = !canOrder ? `
            <div class="cannot-order-actions" style="display: flex; gap: 4px; margin-top: 4px;">
                <button class="btn-replace" onclick="window.openReplaceModalByIndex(${index})">
                    <i class="fas fa-sync-alt"></i> 대체
                </button>
                <button class="btn-exclude" onclick="window.openExcludeModalByIndex(${index})">
                    <i class="fas fa-times"></i> 제외
                </button>
            </div>
        ` : '';

        html += `
            <tr data-agg-index="${index}" style="${priceExpired ? 'background: #fff8e1;' : (!canOrder ? 'background: #fff3f3;' : '')}">
                <td>${rowNum++}</td>
                <td style="font-size: 0.75rem; color: #666; max-width: 80px; overflow: hidden; text-overflow: ellipsis;" title="${item.ingredient_code || ''}">
                    ${item.ingredient_code || '-'}
                </td>
                <td style="text-align: left; max-width: 180px; overflow: hidden; text-overflow: ellipsis;" title="${item.ingredient_name || ''}">
                    ${item.ingredient_name || '-'}${mergeInfo}
                </td>
                <td style="font-size: 0.8rem; max-width: 100px; overflow: hidden; text-overflow: ellipsis;" title="${item.specification || ''}">
                    ${item.specification || '-'}
                </td>
                <td style="font-size: 0.85rem;">${item.supplier_name || '-'}</td>
                <td>${item.unit || '-'}</td>
                <td style="color: #667eea; font-weight: 600;">${(item.meal_count || 0).toLocaleString()}</td>
                <td>${(item.required_qty || 0).toFixed(2)}</td>
                <td>
                    <input type="number" value="${item.current_stock || 0}" step="0.1" min="0"
                           data-agg-index="${index}" class="stock-input"
                           onchange="recalculateAggregatedItem(${index})"
                           style="background: #e8f5e9; border: 2px solid #28a745;">
                </td>
                <td>
                    ${generateRoundedQtyInput(item.order_qty || 0, index, canOrder)}
                </td>
                <td style="text-align: right;">${formatCurrency(item.unit_price || 0)}</td>
                <td style="font-weight: 600; color: #28a745; text-align: right;" id="aggPrice_${index}">
                    ${formatCurrency(item.total_price || 0)}
                </td>
                <td style="font-size: 0.85rem;">
                    ${item.expected_delivery_date || '-'}
                    <br><small style="color: #888;">(${item.lead_time_display || 'D-2'})</small>
                </td>
                <td>${statusBadge} ${deleteBtn}${overrideButtons}</td>
            </tr>
        `;
    });

    // 수동발주 섹션 구분선 및 헤더
    if (manualAggItems.length > 0) {
        html += `
            <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <td colspan="14" style="padding: 10px 15px; color: white; font-weight: 600; text-align: left;">
                    <i class="fas fa-hand-paper" style="margin-right: 8px;"></i>
                    수동발주 품목 (${manualAggItems.length}건)
                    <span style="font-weight: 400; font-size: 12px; margin-left: 10px; opacity: 0.9;">
                        ※ 메뉴 외 별도 발주 품목
                    </span>
                </td>
            </tr>
        `;

        // 수동발주 품목 표시
        manualAggItems.forEach((item, idx) => {
            const aggIndex = menuAggItems.length + idx; // 전체 인덱스
            const canOrder = item.can_order !== false;

            const deleteBtn = `<button onclick="deleteManualOrderItem(${idx})" style="padding: 3px 8px; background: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px; margin-left: 5px;" title="삭제"><i class="fas fa-trash-alt"></i></button>`;

            html += `
                <tr style="background: #f8f9ff;">
                    <td style="color: #667eea; font-weight: 600;">${rowNum++}</td>
                    <td style="font-size: 0.75rem; color: #666; max-width: 80px; overflow: hidden; text-overflow: ellipsis;" title="${item.ingredient_code || ''}">
                        ${item.ingredient_code || '-'}
                    </td>
                    <td style="text-align: left; max-width: 180px; overflow: hidden; text-overflow: ellipsis;" title="${item.ingredient_name || ''}">
                        ${item.ingredient_name || '-'}
                        <span style="color:#667eea;font-size:10px;margin-left:4px;font-weight:600;">[수동]</span>
                    </td>
                    <td style="font-size: 0.8rem; max-width: 100px; overflow: hidden; text-overflow: ellipsis;" title="${item.specification || ''}">
                        ${item.specification || '-'}
                    </td>
                    <td style="font-size: 0.85rem;">${item.supplier_name || '-'}</td>
                    <td>${item.unit || '-'}</td>
                    <td style="color: #667eea; font-weight: 600;">-</td>
                    <td>${(item.required_qty || item.order_qty || 0).toFixed(2)}</td>
                    <td>
                        <input type="number" value="${item.current_stock || 0}" step="0.1" min="0"
                               data-agg-index="${aggIndex}" class="stock-input"
                               onchange="recalculateAggregatedItem(${aggIndex})"
                               style="background: #e8f5e9; border: 2px solid #28a745;">
                    </td>
                    <td>
                        ${generateRoundedQtyInput(item.order_qty || 0, aggIndex, canOrder)}
                    </td>
                    <td style="text-align: right;">${formatCurrency(item.unit_price || 0)}</td>
                    <td style="font-weight: 600; color: #667eea; text-align: right;" id="aggPrice_${aggIndex}">
                        ${formatCurrency(item.total_price || 0)}
                    </td>
                    <td style="font-size: 0.85rem;">
                        ${item.expected_delivery_date || '-'}
                        <br><small style="color: #888;">(${item.lead_time_display || 'D-2'})</small>
                    </td>
                    <td><span class="badge badge-info">수동</span> ${deleteBtn}</td>
                </tr>
            `;
        });
    }

    tbody.innerHTML = html;

    // 발주 불가 품목에 대체/제외 버튼 추가
    setTimeout(() => addOverrideButtonsToUnorderableItems(), 100);

    // 오버라이드 요약 패널 렌더링
    renderOverrideSummaryPanel();

    // 수동 품목 목록도 갱신
    renderManualItemsList();

    // 하단 요약 패널 업데이트
    if (typeof updateSummaryPanel === 'function') {
        updateSummaryPanel();
    }

    // Step 4 버튼 추가 (카테고리별 발주)
    if (typeof addStep4ButtonToOrderTable !== 'undefined') {
        addStep4ButtonToOrderTable();
    }
}

/**
 * 수동발주 품목 삭제 (테이블에서)
 */
function deleteManualOrderItem(manualIdx) {
    if (!OS.currentDisplayItems) return;

    // 수동 항목만 필터링해서 해당 인덱스 찾기
    const manualItems = OS.currentDisplayItems.filter(i => i.is_manual === true);
    if (!manualItems[manualIdx]) return;

    const targetItem = manualItems[manualIdx];
    if (!confirm(`'${targetItem.ingredient_name}' 품목을 삭제하시겠습니까?`)) {
        return;
    }

    // 원본 배열에서 해당 항목 찾아서 삭제
    const realIndex = OS.currentDisplayItems.findIndex(i => i === targetItem);
    if (realIndex >= 0) {
        OS.currentDisplayItems.splice(realIndex, 1);
    }

    // 테이블 갱신
    displayOrderTable(OS.currentDisplayItems);

    // 요약 갱신
    const tempSummary = {
        total_items: OS.currentDisplayItems.length,
        orderable_items: OS.currentDisplayItems.filter(i => i.can_order !== false).length,
        unorderable_items: OS.currentDisplayItems.filter(i => i.can_order === false).length,
        total_amount: OS.currentDisplayItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
    };
    updateSummary(tempSummary);
}

/**
 * 합산 항목 재계산 (재고 변경 시)
 */
function recalculateAggregatedItem(aggIndex) {
    if (!OS.aggregatedOrderData || !OS.aggregatedOrderData[aggIndex]) return;

    const aggItem = OS.aggregatedOrderData[aggIndex];
    const stockInput = document.querySelector(`.stock-input[data-agg-index="${aggIndex}"]`);
    const qtyInput = document.querySelector(`.qty-input[data-agg-index="${aggIndex}"]`);

    // ★★★ 단순 계산: 총필요량(g) ÷ 기준용량(g) = 발주량(포) ★★★
    // 재고 입력은 포장 단위이므로, 발주량에서 직접 차감
    const newStockPackages = parseFloat(stockInput.value) || 0;
    const totalQtyG = aggItem.required_qty_g || 0;
    // ★ 대체품인 경우 price_base_weight_grams 사용
    const orderBaseWeightG = aggItem.price_base_weight_grams || aggItem.base_weight_grams || 1000;
    const requiredPackages = totalQtyG / orderBaseWeightG;
    const newOrderQty = Math.max(0, requiredPackages - newStockPackages);

    aggItem.current_stock = newStockPackages;
    aggItem.order_qty = newOrderQty;
    aggItem.total_price = newOrderQty * aggItem.unit_price;

    qtyInput.value = newOrderQty.toFixed(2);

    // 원본 데이터에도 비례 배분 적용
    syncAggregatedToOriginal(aggIndex);

    updateAggregatedItemTotal(aggIndex);
}

/**
 * 수동 품목 추가 함수
 */
async function addManualItem() {
    const idFn = document.getElementById('manualId');
    const codeFn = document.getElementById('manualCode');
    const nameFn = document.getElementById('manualName');
    const specFn = document.getElementById('manualSpec');
    const unitFn = document.getElementById('manualUnit');
    const supplierFn = document.getElementById('manualSupplier');
    const qtyFn = document.getElementById('manualQty');
    const priceFn = document.getElementById('manualPrice');
    const remarksFn = document.getElementById('manualRemarks');

    const id = idFn.value;
    const code = codeFn.value;
    const name = nameFn.value.trim();
    const spec = specFn.value.trim();
    const unit = unitFn.value.trim() || 'EA';
    const supplier = supplierFn.value.trim();
    const qty = parseFloat(qtyFn.value) || 0;
    const price = parseFloat(priceFn.value) || 0;
    const remarks = remarksFn.value.trim();

    if (!name) {
        alert('품명을 입력하거나 식자재를 검색하여 선택해주세요.');
        nameFn.focus();
        return;
    }
    if (qty <= 0) {
        alert('수량을 확인해주세요.');
        qtyFn.focus();
        return;
    }

    // 새 아이템 객체 생성
    const isFromSearch = !!id; // 식자재 DB에서 검색한 경우
    const newItem = {
        ingredient_id: id ? parseInt(id) : null,
        ingredient_code: code || '',
        ingredient_name: name,
        specification: spec,
        unit: unit,
        supplier_name: supplier || (isFromSearch ? '수동입력' : '마트구매'),
        current_stock: 0,
        required_qty: qty,
        order_qty: qty, // 필요량 = 발주량 기본 설정
        unit_price: price,
        total_price: qty * price,
        can_order: true,
        meal_type: '기타',  // 수동 추가 → 식재료-기타로 집계
        meal_refs: [],
        remarks: (() => {
            const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
            const who = userInfo.name || userInfo.username || userInfo.id || '';
            const base = remarks || (isFromSearch ? '수동 추가 (검색)' : '수동 추가 (직접입력)');
            return who ? `${base} [${who}]` : base;
        })(),
        is_manual: true  // 수동 추가 플래그
    };

    // 리스트에 추가
    if (!OS.currentDisplayItems) OS.currentDisplayItems = [];
    OS.currentDisplayItems.push(newItem);

    // 테이블 갱신
    displayOrderTable(OS.currentDisplayItems);

    // 요약 갱신
    const tempSummary = {
        total_items: OS.currentDisplayItems.length,
        orderable_items: OS.currentDisplayItems.filter(i => i.can_order !== false).length,
        unorderable_items: OS.currentDisplayItems.filter(i => i.can_order === false).length,
        total_amount: OS.currentDisplayItems.reduce((sum, i) => sum + i.total_price, 0)
    };
    updateSummary(tempSummary);

    // ★ DB에 즉시 저장 (발주 확정 없이)
    const siteId = document.getElementById('siteId')?.value;
    // 수동 추가 전용 날짜 우선, 없으면 Step1 날짜 사용
    const manualDate = document.getElementById('manualDate')?.value;
    const usageDate = manualDate || document.getElementById('mealPlanDate')?.value;
    const orderDate = document.getElementById('orderDate')?.value;

    if (!usageDate) {
        alert('식단표 날짜를 입력해주세요.');
        document.getElementById('manualDate')?.focus();
        return;
    }

    // siteId: 선택된 사업장 또는 기본값 1
    const effectiveSiteId = siteId || '1';

    try {
        const resp = await fetch('/api/orders/manual-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                site_id: parseInt(effectiveSiteId),
                usage_date: usageDate,
                order_date: orderDate || usageDate,
                item: newItem
            })
        });
        const result = await resp.json();
        if (result.success) {
            alert(`${result.message} (발주서 #${result.order_id})`);
        } else {
            alert(`DB 저장 실패: ${result.error}`);
        }
    } catch (e) {
        console.error('수동 품목 즉시 저장 실패:', e);
        alert('DB 저장 실패: ' + e.message);
    }

    // 입력 필드 초기화
    idFn.value = '';
    codeFn.value = '';
    nameFn.value = '';
    specFn.value = '';
    unitFn.value = '';
    supplierFn.value = '';
    qtyFn.value = '';
    priceFn.value = '';
    remarksFn.value = '';

    // 수동 품목 목록 갱신
    renderManualItemsList();
}

/**
 * 수동 추가 품목 목록 렌더링
 */
function renderManualItemsList() {
    const listContainer = document.getElementById('manualItemsList');
    const itemsContainer = document.getElementById('manualItemsContainer');

    if (!OS.currentDisplayItems) {
        listContainer.style.display = 'none';
        return;
    }

    const manualItems = OS.currentDisplayItems.filter(i => i.is_manual === true);

    if (manualItems.length === 0) {
        listContainer.style.display = 'none';
        return;
    }

    listContainer.style.display = 'block';
    itemsContainer.innerHTML = manualItems.map((item, idx) => {
        // currentDisplayItems에서의 실제 인덱스 찾기
        const realIndex = OS.currentDisplayItems.findIndex(i => i === item);
        return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #f8f9ff; border-radius: 4px; margin-bottom: 4px; font-size: 12px;">
            <div style="flex: 1;">
                <span style="font-weight: 600; color: #333;">${item.ingredient_name}</span>
                <span style="color: #888; margin-left: 8px;">${item.specification || ''}</span>
                <span style="color: #667eea; margin-left: 8px;">${item.order_qty}${item.unit}</span>
                <span style="color: #28a745; margin-left: 8px; font-weight: 600;">₩${(item.total_price || 0).toLocaleString()}</span>
            </div>
            <button onclick="deleteManualItem(${realIndex})"
                style="padding: 3px 8px; background: #dc3545; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px;"
                title="삭제">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `}).join('');
}

/**
 * 수동 추가 품목 삭제
 */
function deleteManualItem(index) {
    if (!OS.currentDisplayItems || !OS.currentDisplayItems[index]) return;

    const item = OS.currentDisplayItems[index];
    if (!confirm(`'${item.ingredient_name}' 품목을 삭제하시겠습니까?`)) {
        return;
    }

    OS.currentDisplayItems.splice(index, 1);

    // 테이블 갱신
    displayOrderTable(OS.currentDisplayItems);

    // 수동 품목 목록 갱신
    renderManualItemsList();

    // 요약 갱신
    const tempSummary = {
        total_items: OS.currentDisplayItems.length,
        orderable_items: OS.currentDisplayItems.filter(i => i.can_order !== false).length,
        unorderable_items: OS.currentDisplayItems.filter(i => i.can_order === false).length,
        total_amount: OS.currentDisplayItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
    };
    updateSummary(tempSummary);
}

/**
 * 발주 품목 삭제 함수
 */
function deleteOrderItem(aggIndex) {
    if (!OS.aggregatedOrderData || !OS.aggregatedOrderData[aggIndex]) return;

    const item = OS.aggregatedOrderData[aggIndex];
    if (!confirm(`'${item.ingredient_name}' 품목을 삭제하시겠습니까?`)) {
        return;
    }

    // 원본 인덱스들을 가져와서 currentDisplayItems에서 제거
    const originalIndices = item.original_indices || [aggIndex];

    // 인덱스를 내림차순으로 정렬하여 삭제 (앞에서부터 삭제하면 인덱스가 밀림)
    originalIndices.sort((a, b) => b - a);
    originalIndices.forEach(idx => {
        if (OS.currentDisplayItems && OS.currentDisplayItems[idx]) {
            OS.currentDisplayItems.splice(idx, 1);
        }
    });

    // 테이블 갱신
    displayOrderTable(OS.currentDisplayItems);

    // 요약 갱신
    const tempSummary = {
        total_items: OS.currentDisplayItems.length,
        orderable_items: OS.currentDisplayItems.filter(i => i.can_order !== false).length,
        unorderable_items: OS.currentDisplayItems.filter(i => i.can_order === false).length,
        total_amount: OS.currentDisplayItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
    };
    updateSummary(tempSummary);
}

// ============================================
// 식자재 검색 모달 로직
// ============================================
function openIngredientSearch() {
    document.getElementById('ingredientSearchModal').classList.add('show');
    setTimeout(() => {
        document.getElementById('ingSearchKeyword').focus();
    }, 100);
}

function closeIngredientSearchModal() {
    document.getElementById('ingredientSearchModal').classList.remove('show');
}

function searchIngredientsKey(e) {
    if (e.key === 'Enter') searchIngredients();
}

async function searchIngredients() {
    const keyword = document.getElementById('ingSearchKeyword').value.trim();
    if (!keyword) {
        alert('검색어를 입력해주세요');
        return;
    }

    const tbody = document.getElementById('ingSearchResults');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: #666;"><i class="fas fa-spinner fa-spin"></i> 검색 중...</td></tr>';

    try {
        // 향상된 검색 API 사용 (단위당 단가 정렬)
        const response = await fetch(`/api/admin/ingredients-enhanced?search_name=${encodeURIComponent(keyword)}&size=50&sort_by=price_per_unit&sort_order=asc`);
        const result = await response.json();

        if (result.success && result.items && result.items.length > 0) {
            // 단위당 단가로 정렬 (낮은 순, null/0은 맨 뒤로)
            const sortedItems = result.items.sort((a, b) => {
                const priceA = a.price_per_unit || a.단위당단가 || 999999999;
                const priceB = b.price_per_unit || b.단위당단가 || 999999999;
                return priceA - priceB;
            });

            tbody.innerHTML = sortedItems.map(item => {
                const pricePerUnit = item.price_per_unit || item.단위당단가 || 0;
                const priceDisplay = pricePerUnit > 0 ? pricePerUnit.toFixed(2) : '-';
                const leadTime = item.lead_time || item.선발주일 || 0;
                const leadTimeDisplay = leadTime > 0 ? `D-${leadTime}` : '-';
                return `
                <tr style="cursor: pointer; transition: background 0.15s;"
                    onmouseover="this.style.background='#f0f4ff'"
                    onmouseout="this.style.background=''"
                    onclick='selectIngredient(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
                    <td style="padding: 6px; border-bottom: 1px solid #eee;">
                        <div style="font-weight: 600; color: #333;">${item.ingredient_name || item.식자재명}</div>
                        <div style="font-size: 0.85em; color: #888;">${item.ingredient_code || item.고유코드 || ''}</div>
                    </td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; color: #555;">${item.specification || item.규격 || '-'}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; color: #555;">${item.unit || item.단위 || '-'}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; color: #28a745; font-weight: 600; text-align: right;">${priceDisplay}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; color: #e65100; text-align: center; font-weight: 500;">${leadTimeDisplay}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; color: #555;">${item.supplier_name || item.거래처명 || '-'}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: center;">
                        <button style="padding: 4px 8px; background: linear-gradient(135deg, #667eea, #764ba2); border: none; border-radius: 4px; color: white; font-size: 11px; cursor: pointer;">선택</button>
                    </td>
                </tr>
            `}).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #999;">검색 결과가 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('검색 오류:', error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #dc3545;">오류가 발생했습니다.</td></tr>';
    }
}

function selectIngredient(item) {
    document.getElementById('manualId').value = item.id || '';
    document.getElementById('manualCode').value = item.ingredient_code || item.고유코드 || '';
    document.getElementById('manualName').value = item.ingredient_name || item.식자재명 || '';
    document.getElementById('manualSpec').value = item.specification || item.규격 || '';
    document.getElementById('manualUnit').value = item.unit || item.단위 || '';
    document.getElementById('manualSupplier').value = item.supplier_name || item.거래처명 || '';

    // 단가는 입고가(purchase_price) 우선 사용 (발주 시점이므로)
    const price = item.purchase_price || item.입고가 || 0;
    document.getElementById('manualPrice').value = price;

    document.getElementById('manualQty').focus();
    closeIngredientSearchModal();
}

/**
 * 합산 항목 금액 업데이트
 */
function updateAggregatedItemTotal(aggIndex) {
    if (!OS.aggregatedOrderData || !OS.aggregatedOrderData[aggIndex]) return;

    const aggItem = OS.aggregatedOrderData[aggIndex];
    const qtyInput = document.querySelector(`.qty-input[data-agg-index="${aggIndex}"]`);

    aggItem.order_qty = parseFloat(qtyInput.value) || 0;
    aggItem.total_price = aggItem.order_qty * aggItem.unit_price;

    // 금액 셀 업데이트
    const priceCell = document.getElementById(`aggPrice_${aggIndex}`);
    if (priceCell) {
        priceCell.textContent = formatCurrency(aggItem.total_price);
    }

    // 원본 데이터에도 비례 배분 적용
    syncAggregatedToOriginal(aggIndex);

    // 전체 합계 업데이트
    const totalAmount = OS.aggregatedOrderData.reduce((sum, i) => sum + (i.total_price || 0), 0);
    document.getElementById('totalAmount').textContent = formatCurrency(totalAmount);
    if (OS.currentOrderData && OS.currentOrderData.summary) {
        OS.currentOrderData.summary.total_amount = totalAmount;
    }
}

/**
 * 합산 데이터를 원본 데이터에 비례 배분
 */
function syncAggregatedToOriginal(aggIndex) {
    if (!OS.aggregatedOrderData || !OS.currentDisplayItems) return;

    const aggItem = OS.aggregatedOrderData[aggIndex];
    const originalIndices = OS.aggregatedToOriginalMap[aggIndex] || [];

    if (originalIndices.length === 0) return;

    // 원본 항목들의 required_qty 총합
    const totalOriginalRequired = originalIndices.reduce((sum, idx) => {
        return sum + (OS.currentDisplayItems[idx]?.required_qty || 0);
    }, 0);

    // 비례 배분
    originalIndices.forEach(idx => {
        const origItem = OS.currentDisplayItems[idx];
        if (!origItem) return;

        const ratio = totalOriginalRequired > 0
            ? (origItem.required_qty / totalOriginalRequired)
            : (1 / originalIndices.length);

        origItem.order_qty = aggItem.order_qty * ratio;
        origItem.total_price = origItem.order_qty * origItem.unit_price;
        origItem.current_stock = aggItem.current_stock * ratio;
    });
}

function updateSummary(summary) {
    // 합산 데이터 기준으로 품목 수 계산
    if (OS.aggregatedOrderData) {
        const orderableCount = OS.aggregatedOrderData.filter(i => i.can_order !== false).length;
        const unorderableCount = OS.aggregatedOrderData.filter(i => i.can_order === false).length;
        document.getElementById('orderableCount').textContent = orderableCount + '개';
        document.getElementById('unorderableCount').textContent = unorderableCount + '개';
    } else {
        document.getElementById('orderableCount').textContent =
            (summary.orderable_items || 0) + '개';
        document.getElementById('unorderableCount').textContent =
            (summary.unorderable_items || 0) + '개';
    }
    document.getElementById('totalAmount').textContent =
        formatCurrency(summary.total_amount || 0);

    // 수동발주 금액 계산
    let manualAmount = 0;
    if (OS.currentDisplayItems) {
        manualAmount = OS.currentDisplayItems
            .filter(i => i.is_manual === true)
            .reduce((sum, i) => sum + (i.total_price || 0), 0);
    }
    const manualAmountEl = document.getElementById('manualOrderAmount');
    if (manualAmountEl) {
        manualAmountEl.textContent = formatCurrency(manualAmount);
    }

    // 마감 시간 정보 표시
    const cutoffInfoEl = document.getElementById('cutoffInfo');
    if (cutoffInfoEl && summary.actual_order_date) {
        const isAfterCutoff = summary.is_after_cutoff;
        const cutoffHour = summary.order_cutoff_hour || 16;
        const actualDate = summary.actual_order_date;

        if (isAfterCutoff) {
            cutoffInfoEl.innerHTML = `
                <span style="color: #dc3545; font-weight: 600;">
                    <i class="fas fa-clock"></i> 오늘 마감(${cutoffHour}시) 지남 → 실제 발주일: ${actualDate}
                </span>`;
        } else {
            cutoffInfoEl.innerHTML = `
                <span style="color: #28a745;">
                    <i class="fas fa-check-circle"></i> 발주 마감: 오늘 ${cutoffHour}시
                </span>`;
        }
    }
}

// ============================================
// 재계산
// ============================================
function recalculateItem(index) {
    if (!OS.currentOrderData || !OS.currentOrderData.items[index]) return;

    const item = OS.currentOrderData.items[index];
    const stockInput = document.querySelector(`.stock-input[data-index="${index}"]`);
    const qtyInput = document.querySelector(`.qty-input[data-index="${index}"]`);

    // ★★★ 단순 계산: 총필요량(g) ÷ 기준용량(g) = 발주량(포) ★★★
    const newStockPackages = parseFloat(stockInput.value) || 0;
    const totalQtyG = item.required_qty_g || 0;
    // ★ 대체품인 경우 price_base_weight_grams 사용
    const orderBaseWeightG = item.price_base_weight_grams || item.base_weight_grams || 1000;
    const requiredPackages = totalQtyG / orderBaseWeightG;
    const newOrderQty = Math.max(0, requiredPackages - newStockPackages);

    item.current_stock = newStockPackages;
    item.order_qty = newOrderQty;
    item.total_price = newOrderQty * item.unit_price;

    qtyInput.value = newOrderQty.toFixed(2);
    updateItemTotal(index);
}

function updateItemTotal(index) {
    if (!OS.currentOrderData || !OS.currentOrderData.items[index]) return;

    const item = OS.currentOrderData.items[index];
    const qtyInput = document.querySelector(`.qty-input[data-index="${index}"]`);

    item.order_qty = parseFloat(qtyInput.value) || 0;
    item.total_price = item.order_qty * item.unit_price;

    // 테이블 금액 업데이트 (11번째 컬럼 = 금액)
    const row = qtyInput.closest('tr');
    const priceCell = row.querySelector('td:nth-child(11)');
    if (priceCell) {
        priceCell.textContent = formatCurrency(item.total_price);
    }

    // 전체 합계 업데이트
    const totalAmount = OS.currentOrderData.items.reduce((sum, i) => sum + (i.total_price || 0), 0);
    document.getElementById('totalAmount').textContent = formatCurrency(totalAmount);
    OS.currentOrderData.summary.total_amount = totalAmount;
}

// mapOrderItems는 ordering-management.js에 정의됨

// ============================================
// 행사 발주 합산 체크 (Step3 진입 시)
// ============================================
async function checkEventOrderMerge(finalItems, callback) {
    try {
        const orderDate = document.getElementById('orderDate')?.value;
        const context = typeof SiteSelector !== 'undefined' ? SiteSelector.getCurrentContext() : null;
        const siteId = context?.group_id || context?.site_id;

        if (!orderDate || !siteId) {
            callback(finalItems);
            return;
        }

        // 같은 입고일+사업장에 행사 발주서가 있는지 확인
        const res = await fetch(`/api/event-orders/check-merge?order_date=${orderDate}&site_id=${siteId}&exclude_type=regular`);
        const data = await res.json();

        if (!data.success || !data.has_merge_target) {
            callback(finalItems);
            return;
        }

        // 합산 팝업 표시
        const typeLabel = { regular: '일반', event: '행사', additional: '추가', urgent: '긴급' };
        let popupHtml = `
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center;" id="merge-popup-overlay">
                <div style="background:white;border-radius:16px;width:90%;max-width:650px;max-height:80vh;display:flex;flex-direction:column;">
                    <div style="padding:15px 20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border-radius:16px 16px 0 0;">
                        <h3 style="margin:0;font-size:1rem;"><i class="fas fa-object-group"></i> 행사 발주서 발견</h3>
                    </div>
                    <div style="padding:20px;overflow-y:auto;flex:1;">
                        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:15px;color:#92400e;">
                            <i class="fas fa-exclamation-triangle"></i>
                            같은 <strong>입고일(${orderDate})</strong>에 행사 발주서 <strong>${data.orders.length}건</strong>이 있습니다.
                        </div>`;

        data.orders.forEach(order => {
            const total = Math.round(order.total_amount || 0).toLocaleString('ko-KR');
            popupHtml += `
                        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                <strong>${order.order_number}</strong>
                                <span style="background:#fce7f3;color:#9d174d;padding:3px 8px;border-radius:10px;font-size:11px;">${typeLabel[order.order_type] || '행사'}</span>
                            </div>
                            <div style="font-size:13px;color:#64748b;">
                                ${order.template_name ? `템플릿: ${order.template_name} | ` : ''}
                                품목: ${order.item_count}건 | 금액: <strong style="color:#0369a1;">${total}원</strong>
                                ${order.attendees ? ` | ${order.attendees}명` : ''}
                            </div>
                        </div>`;
        });

        popupHtml += `
                        <div style="margin-top:15px;padding:12px;background:#f0f9ff;border-radius:8px;color:#0369a1;font-size:13px;">
                            <i class="fas fa-info-circle"></i>
                            <strong>합산</strong>: 행사 식자재가 발주서에 추가됩니다. 같은 식자재는 수량이 합산됩니다.
                        </div>
                    </div>
                    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">
                        <button class="btn btn-secondary" id="merge-skip-btn" style="padding:8px 16px;">
                            <i class="fas fa-times"></i> 합산 안함
                        </button>
                        <button class="btn btn-success" id="merge-apply-btn" style="padding:8px 16px;">
                            <i class="fas fa-object-group"></i> 합산하기
                        </button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', popupHtml);

        // 버튼 이벤트
        document.getElementById('merge-skip-btn').addEventListener('click', function() {
            document.getElementById('merge-popup-overlay').remove();
            callback(finalItems);
        });

        document.getElementById('merge-apply-btn').addEventListener('click', function() {
            // 합산 로직: 행사 발주 항목을 finalItems에 추가
            data.orders.forEach(order => {
                if (!order.items) return;
                order.items.forEach(eventItem => {
                    // 식자재코드 없으면 건너뛰기
                    if (!eventItem.ingredient_code) return;

                    // 같은 식자재코드가 있으면 수량 합산
                    const existing = finalItems.find(fi =>
                        fi.ingredient_code && fi.ingredient_code === eventItem.ingredient_code
                    );

                    if (existing) {
                        existing.required_qty = (parseFloat(existing.required_qty) || 0) + (parseFloat(eventItem.required_qty) || 0);
                        existing.order_qty = (parseFloat(existing.order_qty) || 0) + (parseFloat(eventItem.order_qty) || 0);
                        existing.total_price = Math.round((parseFloat(existing.unit_price) || 0) * existing.order_qty);
                        existing.merged_event = true;
                    } else {
                        // 새 항목 추가
                        finalItems.push({
                            ingredient_code: eventItem.ingredient_code,
                            ingredient_name: eventItem.ingredient_name,
                            specification: eventItem.specification || '',
                            unit: eventItem.unit || '',
                            unit_price: eventItem.unit_price || 0,
                            required_qty: eventItem.required_qty || 0,
                            order_qty: eventItem.order_qty || 0,
                            total_price: eventItem.total_price || 0,
                            supplier_name: eventItem.supplier_name || '',
                            menu_name: `[행사] ${eventItem.menu_name || ''}`,
                            can_order: true,
                            merged_event: true
                        });
                    }
                });
            });

            document.getElementById('merge-popup-overlay').remove();

            // 합산 이력 기록
            const sourceIds = data.orders.map(o => o.id);
            fetch('/api/event-orders/mark-merged', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_order_ids: sourceIds,
                    target_order_date: orderDate
                })
            }).catch(e => console.error('합산 이력 기록 오류:', e));

            alert(`행사 발주서 ${data.orders.length}건의 물량이 합산되었습니다.`);
            callback(finalItems);
        });

    } catch (error) {
        console.error('행사 발주 합산 체크 오류:', error);
        callback(finalItems);
    }
}
