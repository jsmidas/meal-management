/**
 * 발주 관리 - 모달/상세보기/비교
 * Depends on: ordering-state.js
 */

// ============================================
// 모달 관련
// ============================================

function closeOrderDetailModal() {
    document.getElementById('orderDetailModal').classList.remove('show');
}

// 전처리 지시서로 이동 (현재 발주서 기준)
function goToPreprocessingInstruction() {
    if (!OS.viewedOrderData) {
        alert('발주서 데이터가 없습니다.');
        return;
    }
    const orderId = OS.viewedOrderData.id;
    const usageDate = OS.viewedOrderData.usage_date;
    window.location.href = `preprocessing_management.html?order_id=${orderId}&date=${usageDate}`;
}

// 조리 지시서로 이동 (현재 발주서 기준)
function goToCookingInstruction() {
    if (!OS.viewedOrderData) {
        alert('발주서 데이터가 없습니다.');
        return;
    }
    const orderId = OS.viewedOrderData.id;
    const usageDate = OS.viewedOrderData.usage_date;
    window.location.href = `cooking_instruction_management.html?order_id=${orderId}&date=${usageDate}`;
}

// 데이터 검증 모달 열기
async function openDataVerificationModal() {
    if (!OS.viewedOrderData) {
        alert('발주서 데이터가 없습니다.');
        return;
    }

    document.getElementById('dataVerificationModal').classList.add('show');
    document.getElementById('dataVerificationBody').innerHTML = `
        <div class="loading" style="padding: 3rem; text-align: center;">
            <div class="spinner"></div>
            <p>데이터를 비교하는 중...</p>
        </div>
    `;

    const orderId = OS.viewedOrderData.id;
    const usageDate = OS.viewedOrderData.usage_date;

    try {
        // 발주서의 사업장 ID
        const siteId = OS.viewedOrderData.site_id;

        // 발주서, 전처리, 조리, 소분 데이터를 병렬로 가져오기 (사업장 필터 추가)
        const [prepResponse, cookResponse, portionResponse] = await Promise.all([
            fetch(`/api/preprocessing?cooking_date=${usageDate}&order_id=${orderId}${siteId ? `&site_id=${siteId}` : ''}`),
            fetch(`/api/cooking-instruction?cooking_date=${usageDate}&order_id=${orderId}${siteId ? `&site_id=${siteId}` : ''}`),
            fetch(`/api/portion-instruction?cooking_date=${usageDate}&order_id=${orderId}${siteId ? `&site_id=${siteId}` : ''}`)
        ]);

        const prepData = await prepResponse.json();
        const cookData = await cookResponse.json();
        const portionData = await portionResponse.json();

        if (!prepData.success || !cookData.success) {
            throw new Error('데이터 조회 실패');
        }

        // 발주서 아이템 (OS.viewedOrderData.items)
        const orderItems = OS.viewedOrderData.items || [];

        // 전처리 지시서 아이템 추출
        const prepItems = [];
        for (const [mealType, content] of Object.entries(prepData.by_meal_type || {})) {
            const required = content.preprocessing_required || [];
            const notRequired = content.preprocessing_not_required || [];
            prepItems.push(...required, ...notRequired);
        }

        // 조리 지시서 아이템 추출
        const cookItems = [];
        for (const menu of cookData.menus || []) {
            for (const ing of menu.ingredients || []) {
                cookItems.push({
                    ...ing,
                    menu_name: menu.menu_name
                });
            }
        }

        // 소분 지시서 데이터
        const portionMenus = portionData.success ? (portionData.menus || []) : [];
        const portionSites = portionData.success ? (portionData.business_sites || []) : [];

        // ingredient_id 기준으로 데이터 병합
        const mergedData = mergeVerificationData(orderItems, prepItems, cookItems);

        // 검증 결과 렌더링
        renderVerificationTable(mergedData, OS.viewedOrderData.order_number, portionMenus, portionSites);

    } catch (error) {
        console.error('검증 데이터 조회 오류:', error);
        document.getElementById('dataVerificationBody').innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #dc3545;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem;"></i>
                <h3>데이터 조회 실패</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// 데이터 병합 함수
function mergeVerificationData(orderItems, prepItems, cookItems) {
    const merged = new Map();

    // 발주서 데이터
    for (const item of orderItems) {
        const key = item.ingredient_id;
        if (!merged.has(key)) {
            merged.set(key, {
                ingredient_id: key,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                unit: item.unit,
                order: { qty: 0, items: [] },
                prep: { qty: 0, final_qty: 0, yield_rate: 100, items: [] },
                cook: { required_qty: 0, preprocessed_qty: 0, cooked_qty: 0, prep_yield: 100, cook_yield: 100, items: [], menus: [] }
            });
        }
        const data = merged.get(key);
        data.order.qty += parseFloat(item.order_qty || 0);
        data.order.items.push(item);
    }

    // 전처리 지시서 데이터
    for (const item of prepItems) {
        const key = item.ingredient_id;
        if (!merged.has(key)) {
            merged.set(key, {
                ingredient_id: key,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                unit: item.unit,
                order: { qty: 0, items: [] },
                prep: { qty: 0, final_qty: 0, yield_rate: 100, items: [] },
                cook: { required_qty: 0, preprocessed_qty: 0, cooked_qty: 0, prep_yield: 100, cook_yield: 100, items: [], menus: [] }
            });
        }
        const data = merged.get(key);
        data.prep.qty += parseFloat(item.order_qty || 0);
        data.prep.final_qty += parseFloat(item.final_qty || 0);
        data.prep.yield_rate = parseFloat(item.yield_rate || 100);
        data.prep.items.push(item);
    }

    // 조리 지시서 데이터 - 식자재별로 합산 (같은 식자재가 다른 끼니/메뉴에서 나타날 수 있음)
    // item_id별로 중복 추적 (API DISTINCT ON으로 item_id당 1행이지만, 끼니별로 다른 order_item 가능)
    const cookItemProcessed = new Set(); // 이미 처리된 item_id 추적
    for (const item of cookItems) {
        const key = item.ingredient_id;
        const itemId = item.item_id;

        // item_id 기준 중복 체크 (API JOIN으로 인한 중복 방지)
        if (cookItemProcessed.has(itemId)) continue;
        cookItemProcessed.add(itemId);

        if (!merged.has(key)) {
            merged.set(key, {
                ingredient_id: key,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                unit: item.unit,
                order: { qty: 0, items: [] },
                prep: { qty: 0, final_qty: 0, yield_rate: 100, items: [] },
                cook: { required_qty: 0, preprocessed_qty: 0, cooked_qty: 0, prep_yield: 100, cook_yield: 100, items: [], menus: [] }
            });
        }
        const data = merged.get(key);

        // 메뉴 목록에 추가
        if (item.menu_name && !data.cook.menus.includes(item.menu_name)) {
            data.cook.menus.push(item.menu_name);
        }

        // 끼니별로 다른 order_item이면 합산 (조식 삼진어묵 + 중식 삼진어묵 = 총 삼진어묵)
        data.cook.required_qty += parseFloat(item.required_qty || 0);
        data.cook.preprocessed_qty += parseFloat(item.preprocessed_qty || 0);
        data.cook.cooked_qty += parseFloat(item.cooked_qty || 0);
        // 수율은 마지막 값 사용 (동일 식자재는 수율도 동일할 것으로 가정)
        data.cook.prep_yield = parseFloat(item.preprocessing_yield || 100);
        data.cook.cook_yield = parseFloat(item.cooking_yield || 100);
        data.cook.items.push(item);
    }

    return Array.from(merged.values());
}

// 검증 테이블 렌더링
function renderVerificationTable(data, orderNumber, portionMenus = [], portionSites = []) {
    let matchCount = 0;
    let mismatchCount = 0;
    let warningCount = 0;

    let html = `
        <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
            <strong>발주서:</strong> ${orderNumber} |
            <strong>총 식자재:</strong> ${data.length}개
        </div>

        <!-- 식자재별 검증 (발주→전처리→조리) -->
        <h4 style="margin: 15px 0 10px; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 5px;">
            <i class="fas fa-carrot"></i> 식자재별 검증 (발주 → 전처리 → 조리)
        </h4>
        <div style="font-size: 11px; color: #666; margin-bottom: 10px;">
            <span style="color: #28a745;">● 일치</span> |
            <span style="color: #ffc107;">● 오차 (0.1% 이내)</span> |
            <span style="color: #dc3545;">● 불일치</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead style="background: linear-gradient(135deg, #667eea, #764ba2); color: white;">
                <tr>
                    <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">식자재명</th>
                    <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">단위</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">발주량</th>
                    <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">전처리<br>수율</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">전처리<br>후량</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">조리전<br>(전처리후)</th>
                    <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">조리<br>수율</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">조리<br>후량</th>
                    <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">상태</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const item of data) {
        // 검증: 전처리 후량과 조리 전 량이 일치하는지
        const prepFinal = item.prep.final_qty;
        const cookPreprocessed = item.cook.preprocessed_qty;
        const diff = Math.abs(prepFinal - cookPreprocessed);
        const baseAmount = Math.max(prepFinal, cookPreprocessed);

        // 오차율 계산 (기준값 대비 %)
        const diffPercent = baseAmount > 0 ? (diff / baseAmount) * 100 : 0;

        // 최소 절대 허용치 (0.02 이하 차이는 무시) + 상대 허용치
        const minAbsTolerance = 0.02;  // 0.02kg 이하 차이는 반올림 오차로 간주

        let status, statusColor, statusIcon;
        if (prepFinal === 0 && cookPreprocessed === 0) {
            status = '데이터없음';
            statusColor = '#6c757d';
            statusIcon = '⚪';
        } else if (diff <= minAbsTolerance || diffPercent <= 0.5) {
            // 절대 오차 0.02 이하 또는 상대 오차 0.5% 이하: 일치
            status = '일치';
            statusColor = '#28a745';
            statusIcon = '✅';
            matchCount++;
        } else if (diffPercent <= 3) {
            // 0.5~3%: 오차 (반올림 오차 수준)
            status = '오차';
            statusColor = '#ffc107';
            statusIcon = '⚠️';
            warningCount++;
        } else {
            // 3% 초과: 불일치
            status = '불일치';
            statusColor = '#dc3545';
            statusIcon = '❌';
            mismatchCount++;
        }

        const rowBg = status === '불일치' ? '#fff5f5' : (status === '오차' ? '#fffdf0' : 'white');

        html += `
            <tr style="background: ${rowBg};">
                <td style="padding: 8px; border: 1px solid #ddd;">${item.ingredient_name || '-'}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.unit || '-'}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold;">${item.order.qty.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.prep.yield_rate}%</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; background: #e8f5e9;">${prepFinal.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; background: #e3f2fd;">${cookPreprocessed.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.cook.cook_yield}%</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold;">${item.cook.cooked_qty.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: ${statusColor}; font-weight: bold;">
                    ${statusIcon} ${status}
                </td>
            </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    `;

    // 소분 지시서 검증 섹션
    if (portionMenus.length > 0) {
        let portionMatchCount = 0;
        let portionMismatchCount = 0;

        html += `
            <h4 style="margin: 30px 0 10px; color: #333; border-bottom: 2px solid #e91e63; padding-bottom: 5px;">
                <i class="fas fa-balance-scale"></i> 메뉴별 소분 검증 (조리후량 → 소분배분량)
            </h4>
            <div style="font-size: 11px; color: #666; margin-bottom: 10px;">
                조리후 총량과 사업장별 배분 합계가 일치하는지 확인
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead style="background: linear-gradient(135deg, #e91e63, #9c27b0); color: white;">
                    <tr>
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">메뉴명</th>
                        <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">끼니</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">조리후<br>총량</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">배분<br>합계</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">차이</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">오차율</th>
                        <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">상태</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // 메뉴별 소분 배분 합계 계산 (meal_type별로 구분!)
        const portionTotals = {};  // {`${menu_name}_${meal_type}`: total_portions}
        for (const site of portionSites) {
            const portions = site.portions || {};
            const siteMealType = site.meal_type || '';  // 사업장의 끼니 유형
            for (const [menuName, amount] of Object.entries(portions)) {
                // meal_type 포함한 복합 키 사용
                const portionKey = `${menuName}_${siteMealType}`;
                portionTotals[portionKey] = (portionTotals[portionKey] || 0) + parseFloat(amount || 0);
            }
        }

        for (const menu of portionMenus) {
            const menuName = menu.name;
            const menuMealType = menu.meal_type || '';
            const totalAmount = parseFloat(menu.total_amount || 0);
            // meal_type 포함한 복합 키로 조회
            const portionKey = `${menuName}_${menuMealType}`;
            const distributedAmount = portionTotals[portionKey] || 0;
            const diff = Math.abs(totalAmount - distributedAmount);

            // 오차율 계산 (기준값 대비 %)
            const baseAmount = Math.max(totalAmount, distributedAmount);
            const diffPercent = baseAmount > 0 ? (diff / baseAmount) * 100 : 0;

            let status, statusColor, statusIcon, rowBg;
            if (totalAmount === 0 && distributedAmount === 0) {
                status = '데이터없음';
                statusColor = '#6c757d';
                statusIcon = '-';
                rowBg = 'white';
            } else if (diffPercent <= 0.5) {
                // 0.5% 이하: 일치
                status = '일치';
                statusColor = '#28a745';
                statusIcon = 'O';
                rowBg = 'white';
                portionMatchCount++;
            } else if (diffPercent <= 3) {
                // 0.5~3%: 근사 (반올림 오차 수준)
                status = '근사';
                statusColor = '#17a2b8';
                statusIcon = '≈';
                rowBg = '#f0f9ff';
                portionMatchCount++;  // 근사도 일치로 카운트
            } else if (diffPercent <= 10) {
                // 3~10%: 경미한 차이
                status = '경미';
                statusColor = '#ffc107';
                statusIcon = '△';
                rowBg = '#fffdf0';
                portionMismatchCount++;
            } else {
                // 10% 초과: 불일치
                status = '불일치';
                statusColor = '#dc3545';
                statusIcon = 'X';
                rowBg = '#fff5f5';
                portionMismatchCount++;
            }

            const diffDisplay = diff > 0 ? diff.toFixed(2) : '-';
            const percentDisplay = baseAmount > 0 ? diffPercent.toFixed(1) + '%' : '-';
            const percentColor = diffPercent <= 0.5 ? '#28a745' : diffPercent <= 3 ? '#17a2b8' : diffPercent <= 10 ? '#ffc107' : '#dc3545';

            html += `
                <tr style="background: ${rowBg};">
                    <td style="padding: 8px; border: 1px solid #ddd;">${menuName}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${menu.meal_type || '-'}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; background: #fce4ec;">${totalAmount.toFixed(2)}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right; background: #f3e5f5;">${distributedAmount.toFixed(2)}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #666;">${diffDisplay}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${percentColor}; font-weight: bold;">${percentDisplay}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: ${statusColor}; font-weight: bold;">
                        ${statusIcon} ${status}
                    </td>
                </tr>
            `;
        }

        html += `
                </tbody>
            </table>
            <div style="margin-top: 10px; padding: 8px; background: #f8f9fa; border-radius: 5px; font-size: 12px;">
                <strong>소분 검증 결과:</strong>
                <span style="color: #28a745; margin-left: 10px;"><i class="fas fa-check-circle"></i> 일치: ${portionMatchCount}건</span>
                <span style="color: #dc3545; margin-left: 10px;"><i class="fas fa-times-circle"></i> 불일치: ${portionMismatchCount}건</span>
            </div>
        `;
    } else {
        html += `
            <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-radius: 8px; color: #856404;">
                <i class="fas fa-info-circle"></i> 소분 지시서 데이터가 없습니다.
            </div>
        `;
    }

    document.getElementById('dataVerificationBody').innerHTML = html;
    document.getElementById('verificationSummary').innerHTML = `
        <span style="color: #28a745;"><i class="fas fa-check-circle"></i> 일치: ${matchCount}건</span> |
        <span style="color: #ffc107;"><i class="fas fa-exclamation-triangle"></i> 오차: ${warningCount}건</span> |
        <span style="color: #dc3545;"><i class="fas fa-times-circle"></i> 불일치: ${mismatchCount}건</span>
    `;
}

// 데이터 검증 모달 닫기
function closeDataVerificationModal() {
    document.getElementById('dataVerificationModal').classList.remove('show');
}

function printOrderDetail() {
    const printContent = document.getElementById('orderDetailBody').innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>발주서 - ${OS.viewedOrderData?.order_number || ''}</title>
            <style>
                body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ddd; padding: 8px; }
                th { background: #667eea; color: white; }
                .order-info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
                .order-info-item { padding: 10px; background: #f8f9fa; border-radius: 5px; }
                .order-info-label { font-size: 12px; color: #666; }
                .order-info-value { font-size: 14px; font-weight: bold; }
                @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            </style>
        </head>
        <body>${printContent}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

function exportViewedOrderToExcel() {
    if (!OS.viewedOrderData || !OS.viewedOrderData.items?.length) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    try {
        const items = OS.viewedOrderData.items;
        const order = OS.viewedOrderData;

        const excelData = items.map((item, idx) => ({
            '순번': idx + 1,
            '끼니': item.meal_type || '',
            '메뉴명': item.menu_name || '',
            '품목명': item.ingredient_name || '',
            '규격': item.spec || '',
            '단위': item.unit || '',
            '발주량': item.order_qty || 0,
            '단가': item.unit_price || 0,
            '금액': item.total_price || 0,
            '협력업체': item.supplier_name || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(excelData);
        ws['!cols'] = [
            { wch: 5 }, { wch: 8 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
            { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 15 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, '발주서');
        XLSX.writeFile(wb, `발주서_${order.order_number || order.usage_date}.xlsx`);

    } catch (error) {
        console.error('엑셀 출력 오류:', error);
        alert('엑셀 출력 중 오류가 발생했습니다.');
    }
}

function exportViewedOrderToPdf() {
    if (!OS.viewedOrderData) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const order = OS.viewedOrderData;
        const items = order.items || [];

        let html = `
            <div style="font-family: 'Malgun Gothic', sans-serif; color: #333;">
                <h1 style="text-align: center; color: #667eea; margin-bottom: 10px;">발 주 서</h1>
                <p style="text-align: center; color: #888; margin-bottom: 20px;">No. ${order.order_number || '-'}</p>
                <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px;">
                    <div><strong>사업장:</strong> ${order.site_name || '-'}</div>
                    <div><strong>식단표 날짜:</strong> ${order.usage_date || '-'}</div>
                    <div><strong>입고일:</strong> ${order.order_date || '-'}</div>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead>
                        <tr style="background: #667eea; color: white;">
                            <th style="border: 1px solid #ddd; padding: 6px;">No</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">끼니</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">메뉴</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">품목명</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">규격</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">발주량</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">단가</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">금액</th>
                            <th style="border: 1px solid #ddd; padding: 6px;">협력업체</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        items.forEach((item, idx) => {
            html += `
                <tr>
                    <td style="border: 1px solid #ddd; padding: 5px; text-align: center;">${idx + 1}</td>
                    <td style="border: 1px solid #ddd; padding: 5px; text-align: center;">${item.meal_type || ''}</td>
                    <td style="border: 1px solid #ddd; padding: 5px;">${item.menu_name || ''}</td>
                    <td style="border: 1px solid #ddd; padding: 5px;">${item.ingredient_name || ''}</td>
                    <td style="border: 1px solid #ddd; padding: 5px;">${item.spec || ''}</td>
                    <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.order_qty || 0).toLocaleString()} ${item.unit || ''}</td>
                    <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.unit_price || 0).toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.total_price || 0).toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 5px;">${item.supplier_name || ''}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
                <div style="margin-top: 20px; text-align: right; font-size: 14px;">
                    <strong>총 품목수:</strong> ${order.total_items || items.length}개 |
                    <strong>총 금액:</strong> ${Number(order.total_amount || 0).toLocaleString()}원
                </div>
                <div style="margin-top: 30px; font-size: 11px; color: #888; text-align: center;">
                    다함푸드 급식관리 시스템 | 출력일시: ${new Date().toLocaleString()}
                </div>
            </div>
        `;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        tempDiv.style.cssText = 'position:absolute;left:-9999px;width:800px;background:white;padding:20px;';
        document.body.appendChild(tempDiv);

        html2canvas(tempDiv, { scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`발주서_${order.order_number || order.usage_date}.pdf`);
            document.body.removeChild(tempDiv);
        });

    } catch (error) {
        console.error('PDF 출력 오류:', error);
        alert('PDF 출력 중 오류가 발생했습니다.');
    }
}

// ============================================
// 발주서 변경 비교 기능
// ============================================

async function openCompareModal(orderId) {
    OS.currentCompareOrderId = orderId;
    OS.currentCompareData = null;  // 먼저 초기화
    document.getElementById('orderCompareModal').style.display = 'flex';
    document.getElementById('compareTableBody').innerHTML = `
        <tr><td colspan="9" style="text-align: center; padding: 40px; color: #999;">
            <i class="fas fa-spinner fa-spin"></i> 비교 데이터 로딩 중...
        </td></tr>`;

    // 로딩 중 버튼 비활성화
    setCompareButtonsEnabled(false);

    try {
        const response = await fetch(`/api/orders/compare/${orderId}`);
        const result = await response.json();

        if (!result.success) {
            document.getElementById('compareTableBody').innerHTML = `
                <tr><td colspan="9" style="text-align: center; padding: 40px; color: #dc3545;">
                    오류: ${result.error || '비교 데이터를 가져올 수 없습니다.'}
                </td></tr>`;
            return;
        }

        OS.currentCompareData = result;
        renderComparisonResults(result);
        // 로딩 완료 후 버튼 활성화
        setCompareButtonsEnabled(true);

    } catch (error) {
        console.error('비교 API 호출 오류:', error);
        document.getElementById('compareTableBody').innerHTML = `
            <tr><td colspan="9" style="text-align: center; padding: 40px; color: #dc3545;">
                API 호출 오류: ${error.message}
            </td></tr>`;
    }
}

function setCompareButtonsEnabled(enabled) {
    const btnAdditional = document.querySelector('#orderCompareModal .btn-success');
    const btnExcel = document.querySelector('#orderCompareModal .btn-info');
    if (btnAdditional) {
        btnAdditional.disabled = !enabled;
        btnAdditional.style.opacity = enabled ? '1' : '0.5';
    }
    if (btnExcel) {
        btnExcel.disabled = !enabled;
        btnExcel.style.opacity = enabled ? '1' : '0.5';
    }
}

function closeOrderCompareModal() {
    document.getElementById('orderCompareModal').style.display = 'none';
    OS.currentCompareData = null;
    OS.currentCompareOrderId = null;
}

function renderComparisonResults(data) {
    const order = data.original_order;
    const comparison = data.comparison;
    const summary = data.summary;

    // 헤더 정보 업데이트
    document.getElementById('compareOrderNumber').textContent = order.order_number || '-';
    document.getElementById('compareUsageDate').textContent = order.usage_date || '-';
    document.getElementById('compareOriginalAmount').textContent = '₩' + Number(order.total_amount || 0).toLocaleString();
    document.getElementById('compareTimestamp').textContent = new Date().toLocaleString('ko-KR');

    // 탭 카운트 업데이트
    document.getElementById('tabIncreased').textContent = summary.increased_count || 0;
    document.getElementById('tabDecreased').textContent = summary.decreased_count || 0;
    document.getElementById('tabAdded').textContent = summary.added_count || 0;
    document.getElementById('tabRemoved').textContent = summary.removed_count || 0;
    document.getElementById('tabReplaced').textContent = summary.replaced_count || 0;

    // 요약 정보 업데이트
    document.getElementById('summaryAdditional').textContent =
        `${summary.additional_purchase_items}건 (₩${Number(summary.additional_amount || 0).toLocaleString()})`;
    document.getElementById('summaryDecrease').textContent =
        '₩' + Number(summary.decrease_amount || 0).toLocaleString();
    const netChange = summary.net_change || 0;
    document.getElementById('summaryNetChange').textContent =
        (netChange >= 0 ? '+' : '') + '₩' + Number(netChange).toLocaleString();
    document.getElementById('summaryNetChange').style.color = netChange >= 0 ? '#28a745' : '#dc3545';

    // 탭 이벤트 설정
    document.querySelectorAll('.compare-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.compare-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterCompareTable(tab.dataset.type);
        };
    });

    // 테이블 렌더링
    let html = '';
    const allItems = [
        ...comparison.increased.map(i => ({ ...i, changeType: 'increased' })),
        ...comparison.decreased.map(i => ({ ...i, changeType: 'decreased' })),
        ...comparison.added.map(i => ({ ...i, changeType: 'added' })),
        ...comparison.removed.map(i => ({ ...i, changeType: 'removed' })),
        ...comparison.replaced.map(i => ({ ...i, changeType: 'replaced' }))
    ];

    if (allItems.length === 0) {
        html = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #28a745;">
            <i class="fas fa-check-circle"></i> 변경 사항이 없습니다. 발주서와 현재 식단/식수가 동일합니다.
        </td></tr>`;
    } else {
        allItems.forEach((item, idx) => {
            const isSelectable = item.changeType === 'increased' || item.changeType === 'added';
            const diffSign = item.diff_qty >= 0 ? '+' : '';
            const amountSign = item.diff_amount >= 0 ? '+' : '';

            html += `
                <tr class="compare-row-${item.changeType}" data-type="${item.changeType}" data-index="${idx}">
                    <td style="text-align: center; padding: 8px 6px;">
                        ${isSelectable ?
                            `<input type="checkbox" class="compare-item-check" data-index="${idx}"
                                data-amount="${item.diff_amount}" onchange="updateCompareSelection()">` : ''}
                    </td>
                    <td style="padding: 8px 6px; font-size: 11px; color: #666;">${item.ingredient_code || '-'}</td>
                    <td style="padding: 8px 6px; font-weight: 500;">${item.ingredient_name || '-'}</td>
                    <td style="padding: 8px 6px; font-size: 11px;">${item.specification || '-'}</td>
                    <td style="padding: 8px 6px; text-align: right;">${Number(item.original_qty || 0).toFixed(2)} ${item.unit || 'kg'}</td>
                    <td style="padding: 8px 6px; text-align: right;">${Number(item.current_qty || 0).toFixed(2)} ${item.unit || 'kg'}</td>
                    <td style="padding: 8px 6px; text-align: right; font-weight: 600; color: ${item.diff_qty >= 0 ? '#28a745' : '#dc3545'};">
                        ${diffSign}${Number(item.diff_qty || 0).toFixed(2)}
                    </td>
                    <td style="padding: 8px 6px; text-align: right; font-weight: 600; color: ${item.diff_amount >= 0 ? '#28a745' : '#dc3545'};">
                        ${amountSign}₩${Number(item.diff_amount || 0).toLocaleString()}
                    </td>
                    <td style="padding: 8px 6px; font-size: 11px; color: #555;">
                        ${item.reason || '-'}
                    </td>
                </tr>
            `;
        });
    }

    document.getElementById('compareTableBody').innerHTML = html;

    // 전체 선택 체크박스 초기화
    document.getElementById('compareSelectAll').checked = false;
    updateCompareSelection();
}

function filterCompareTable(type) {
    const rows = document.querySelectorAll('#compareTableBody tr[data-type]');
    rows.forEach(row => {
        if (type === 'all' || row.dataset.type === type) {
            row.classList.remove('compare-row-hidden');
        } else {
            row.classList.add('compare-row-hidden');
        }
    });
}

function toggleCompareSelectAll() {
    const isChecked = document.getElementById('compareSelectAll').checked;
    document.querySelectorAll('.compare-item-check').forEach(cb => {
        const row = cb.closest('tr');
        if (!row.classList.contains('compare-row-hidden')) {
            cb.checked = isChecked;
        }
    });
    updateCompareSelection();
}

function updateCompareSelection() {
    let count = 0;
    let amount = 0;
    document.querySelectorAll('.compare-item-check:checked').forEach(cb => {
        count++;
        amount += parseFloat(cb.dataset.amount) || 0;
    });
    document.getElementById('compareSelectedCount').textContent = count;
    document.getElementById('compareSelectedAmount').textContent = '₩' + Math.round(amount).toLocaleString();
}

async function generateAdditionalOrder() {
    if (!OS.currentCompareData) {
        alert('비교 데이터가 없습니다.');
        return;
    }

    const selectedItems = [];
    document.querySelectorAll('.compare-item-check:checked').forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        const allItems = [
            ...OS.currentCompareData.comparison.increased.map(i => ({ ...i, changeType: 'increased' })),
            ...OS.currentCompareData.comparison.added.map(i => ({ ...i, changeType: 'added' }))
        ];

        // 선택 가능한 항목에서만 선택
        const selectableItems = allItems.filter(item =>
            item.changeType === 'increased' || item.changeType === 'added'
        );

        // 원본 인덱스로 찾기
        const allItemsWithType = [
            ...OS.currentCompareData.comparison.increased.map(i => ({ ...i, changeType: 'increased' })),
            ...OS.currentCompareData.comparison.decreased.map(i => ({ ...i, changeType: 'decreased' })),
            ...OS.currentCompareData.comparison.added.map(i => ({ ...i, changeType: 'added' })),
            ...OS.currentCompareData.comparison.removed.map(i => ({ ...i, changeType: 'removed' })),
            ...OS.currentCompareData.comparison.replaced.map(i => ({ ...i, changeType: 'replaced' }))
        ];

        if (allItemsWithType[idx]) {
            const item = allItemsWithType[idx];
            selectedItems.push({
                ingredient_id: item.ingredient_id,
                ingredient_code: item.ingredient_code,
                ingredient_name: item.ingredient_name,
                specification: item.specification,
                supplier_name: item.supplier_name,
                unit: item.unit,
                unit_price: item.unit_price,
                order_qty: item.diff_qty,
                required_qty: item.diff_qty,
                total_price: item.diff_amount,
                meal_type: item.meal_type,
                meal_category: item.meal_category,
                menu_name: item.menu_name,
                slot_name: item.slot_name,
                delivery_site_name: item.delivery_site_name,
                can_order: true
            });
        }
    });

    if (selectedItems.length === 0) {
        alert('추가 발주할 항목을 선택해주세요.');
        return;
    }

    if (!confirm(`선택한 ${selectedItems.length}개 항목으로 추가 발주서를 생성하시겠습니까?`)) {
        return;
    }

    try {
        const order = OS.currentCompareData.original_order;
        const orderData = {
            site_id: order.site_id,
            warehouse_id: order.warehouse_id,
            order_date: new Date().toISOString().split('T')[0],
            meal_plan_date: order.usage_date,
            order_type: 'additional',
            parent_order_id: order.id,  // 원본 발주서 ID 연결
            items: selectedItems,
            notes: `추가발주 (원본: ${order.order_number})`,
            force_create: true
        };

        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();

        if (result.success) {
            alert(`추가 발주서가 생성되었습니다.\n발주번호: ${result.order_number}`);
            closeOrderCompareModal();
            loadPreviousOrders();
        } else {
            alert('발주서 생성 실패: ' + (result.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('추가 발주서 생성 오류:', error);
        alert('추가 발주서 생성 중 오류가 발생했습니다.');
    }
}

function exportComparisonToExcel() {
    if (!OS.currentCompareData) {
        alert('비교 데이터가 없습니다.');
        return;
    }

    const order = OS.currentCompareData.original_order;
    const comparison = OS.currentCompareData.comparison;

    // 데이터 준비
    const rows = [];
    const headers = ['유형', '식자재코드', '식자재명', '규격', '기존수량', '현재수량', '차이', '금액차이', '변경원인', '슬롯', '납품처'];

    const typeLabels = {
        increased: '수량증가',
        decreased: '수량감소',
        added: '신규추가',
        removed: '삭제됨',
        replaced: '교체됨'
    };

    ['increased', 'decreased', 'added', 'removed', 'replaced'].forEach(type => {
        (comparison[type] || []).forEach(item => {
            rows.push([
                typeLabels[type],
                item.ingredient_code || '',
                item.ingredient_name || '',
                item.specification || '',
                item.original_qty || 0,
                item.current_qty || 0,
                item.diff_qty || 0,
                item.diff_amount || 0,
                item.reason || '',
                item.slot_name || '',
                item.delivery_site_name || ''
            ]);
        });
    });

    // 엑셀 생성
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '변경비교');

    // 다운로드
    XLSX.writeFile(wb, `발주변경비교_${order.order_number || order.usage_date}.xlsx`);
}
