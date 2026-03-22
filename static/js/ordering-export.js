/**
 * 발주 관리 - 엑셀/PDF 출력
 * Depends on: ordering-state.js
 */

// ============================================
// 엑셀 출력
// ============================================
function exportToExcel() {
    // aggregatedOrderData가 있으면 사용 (사용자가 입력한 재고/발주량 반영)
    // 없으면 currentOrderData.items 사용
    const items = OS.aggregatedOrderData && OS.aggregatedOrderData.length > 0
        ? OS.aggregatedOrderData
        : (OS.currentOrderData?.items || []);

    if (!items || items.length === 0) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    try {
        const mealPlanDate = document.getElementById('mealPlanDate').value;
        const orderDate = document.getElementById('orderDate').value;

        // 협력업체별 그룹핑
        const supplierGroups = {};
        const allItems = [];

        items.forEach((item, idx) => {
            const supplier = item.supplier_name || '미지정';
            if (!supplierGroups[supplier]) {
                supplierGroups[supplier] = [];
            }

            // 발주량: 정수면 정수로, 소수면 소수점 1자리로 표시
            const orderQty = Number(item.order_qty || 0);
            const orderQtyDisplay = Number.isInteger(orderQty) ? orderQty : orderQty.toFixed(1);

            const rowData = {
                '순번': idx + 1,
                '식자재코드': item.ingredient_code || '',
                '협력업체': supplier,
                '식자재명': item.ingredient_name || '',
                '규격': item.specification || item.spec || '',
                '단위': item.unit || '',
                '식수': item.meal_count || 0,
                '필요량': Number(item.required_qty || 0).toFixed(2),
                '현재재고': Number(item.current_stock || 0).toFixed(1),
                '발주량': orderQtyDisplay,
                '단가': item.unit_price || 0,
                '금액': Math.round(item.total_price || 0),  // 금액도 정수로
                '입고예정일': item.expected_delivery_date || '',
                '선발주일': item.lead_time_display || 'D-2',
                '상태': item.can_order !== false ? '발주가능' : '발주불가'
            };

            supplierGroups[supplier].push({ ...rowData });
            allItems.push(rowData);
        });

        // 워크북 생성
        const wb = XLSX.utils.book_new();

        // 컬럼 너비 설정 함수
        const setColWidths = (ws) => {
            ws['!cols'] = [
                { wch: 5 },   // 순번
                { wch: 15 },  // 식자재코드
                { wch: 15 },  // 협력업체
                { wch: 30 },  // 식자재명
                { wch: 18 },  // 규격
                { wch: 8 },   // 단위
                { wch: 8 },   // 식수
                { wch: 10 },  // 필요량
                { wch: 10 },  // 현재재고
                { wch: 10 },  // 발주량
                { wch: 10 },  // 단가
                { wch: 12 },  // 금액
                { wch: 12 },  // 입고예정일
                { wch: 8 },   // 선발주일
                { wch: 10 }   // 상태
            ];
        };

        // 도착지 정보
        const destinationInfo = OS.currentDestination
            ? `도착지: ${OS.currentDestination.name}${OS.currentDestination.address ? ' / ' + OS.currentDestination.address : ''}`
            : '도착지: 미지정';

        // 헤더 정보 생성 함수
        const createHeaderRows = () => {
            return [
                [`발주서 - ${mealPlanDate || orderDate}`],
                [destinationInfo],
                [`입고일: ${orderDate}`, `식단표 날짜: ${mealPlanDate}`],
                []  // 빈 행
            ];
        };

        // 1. "통합" 시트 (모든 업체 포함)
        const headerRows = createHeaderRows();
        const wsAll = XLSX.utils.aoa_to_sheet(headerRows);
        XLSX.utils.sheet_add_json(wsAll, allItems, { origin: 'A5' });
        setColWidths(wsAll);
        XLSX.utils.book_append_sheet(wb, wsAll, '통합');

        // 2. 협력업체별 개별 시트
        for (const [supplier, supplierItems] of Object.entries(supplierGroups)) {
            // 순번 재정렬
            supplierItems.forEach((item, i) => item['순번'] = i + 1);

            // 협력업체별 시트에도 헤더 추가
            const supplierHeaderRows = [
                [`발주서 - ${supplier}`],
                [destinationInfo],
                [`입고일: ${orderDate}`, `식단표 날짜: ${mealPlanDate}`],
                []  // 빈 행
            ];
            const ws = XLSX.utils.aoa_to_sheet(supplierHeaderRows);
            XLSX.utils.sheet_add_json(ws, supplierItems, { origin: 'A5' });
            setColWidths(ws);

            // 시트 이름 31자 제한 (엑셀 제약)
            const sheetName = supplier.substring(0, 31).replace(/[\[\]\*\/\\\?:]/g, '_');
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        // 파일 다운로드
        const fileName = `발주서_${mealPlanDate || orderDate}_${new Date().getTime()}.xlsx`;
        XLSX.writeFile(wb, fileName);

        alert(`엑셀 파일이 생성되었습니다.\n- 통합 시트 1개\n- 협력업체별 시트 ${Object.keys(supplierGroups).length}개`);

    } catch (error) {
        console.error('엑셀 출력 오류:', error);
        alert('엑셀 출력 중 오류가 발생했습니다.');
    }
}

// ============================================
// PDF 출력
// ============================================
async function exportToPdf() {
    if (!OS.currentOrderData || !OS.currentOrderData.items.length) {
        alert('출력할 데이터가 없습니다.');
        return;
    }

    const mealPlanDate = document.getElementById('mealPlanDate').value;
    const orderDate = document.getElementById('orderDate').value;

    // 협력업체별 그룹핑
    const supplierGroups = {};
    OS.currentOrderData.items.forEach(item => {
        const supplier = item.supplier_name || '미지정';
        if (!supplierGroups[supplier]) {
            supplierGroups[supplier] = [];
        }
        supplierGroups[supplier].push(item);
    });

    const supplierCount = Object.keys(supplierGroups).length;

    // 사용자 선택
    const exportType = confirm(`PDF 출력 방식을 선택하세요.\n\n[확인] 협력업체별 분리 (${supplierCount}개 파일)\n[취소] 통합 (1개 파일)`);

    try {
        if (exportType) {
            // 업체별 분리 출력
            for (const [supplier, items] of Object.entries(supplierGroups)) {
                await generateAndDownloadPdf(items, supplier, mealPlanDate, orderDate);
            }
            alert(`${supplierCount}개의 PDF 파일이 생성되었습니다.`);
        } else {
            // 통합 출력
            await generateAndDownloadPdf(OS.currentOrderData.items, '통합', mealPlanDate, orderDate);
        }
    } catch (error) {
        console.error('PDF 출력 오류:', error);
        alert('PDF 출력 중 오류가 발생했습니다.');
    }
}

async function generateAndDownloadPdf(items, supplierName, mealPlanDate, orderDate) {
    const pdfContent = generatePdfContentForSupplier(items, supplierName, mealPlanDate, orderDate);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = pdfContent;
    tempDiv.style.cssText = 'position:absolute;left:-9999px;width:800px;background:white;padding:20px;';
    document.body.appendChild(tempDiv);

    const canvas = await html2canvas(tempDiv, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    let heightLeft = pdfHeight;
    let position = 0;
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
    }

    const safeSupplierName = supplierName.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `발주서_${safeSupplierName}_${mealPlanDate || orderDate}.pdf`;
    pdf.save(fileName);
    document.body.removeChild(tempDiv);
}

function generatePdfContentForSupplier(items, supplierName, mealPlanDate, orderDate) {
    const totalAmount = items.reduce((sum, item) => sum + (item.total_price || 0), 0);

    // 도착지 정보
    const destinationName = OS.currentDestination?.name || '미지정';
    const destinationAddress = OS.currentDestination?.address || '';
    const destinationDisplay = destinationAddress
        ? `${destinationName} / ${destinationAddress}`
        : destinationName;

    let html = `
        <div style="font-family: 'Malgun Gothic', sans-serif; color: #333;">
            <h1 style="text-align: center; color: #667eea; margin-bottom: 10px;">발 주 서</h1>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; font-size: 13px; background: #f8f9fa; padding: 10px; border-radius: 8px;">
                <div><strong>협력업체:</strong> ${supplierName}</div>
                <div><strong>입고일:</strong> ${orderDate || new Date().toISOString().split('T')[0]}</div>
                <div style="grid-column: 1 / -1;"><strong>도착지:</strong> ${destinationDisplay}</div>
                <div><strong>식단표 날짜:</strong> ${mealPlanDate}</div>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead>
                    <tr style="background: #667eea; color: white;">
                        <th style="border: 1px solid #ddd; padding: 6px;">No</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">식자재명</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">규격</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">단위</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">식수</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">필요량</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">재고</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">발주량</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">단가</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">금액</th>
                        <th style="border: 1px solid #ddd; padding: 6px;">입고예정</th>
                    </tr>
                </thead>
                <tbody>
    `;

    items.forEach((item, idx) => {
        html += `
            <tr style="${!item.can_order ? 'background: #fff3f3;' : ''}">
                <td style="border: 1px solid #ddd; padding: 5px; text-align: center;">${idx + 1}</td>
                <td style="border: 1px solid #ddd; padding: 5px; max-width: 150px;">${item.ingredient_name || ''}</td>
                <td style="border: 1px solid #ddd; padding: 5px; font-size: 10px;">${item.specification || item.spec || ''}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: center;">${item.unit || ''}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${(item.meal_count || 0).toLocaleString()}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.required_qty || 0).toFixed(1)}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.current_stock || 0).toFixed(1)}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right; font-weight: bold;">${Number(item.order_qty || 0).toFixed(1)}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right;">${Number(item.unit_price || 0).toLocaleString()}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: right; font-weight: bold; color: #28a745;">${Number(item.total_price || 0).toLocaleString()}</td>
                <td style="border: 1px solid #ddd; padding: 5px; text-align: center; font-size: 10px;">${item.expected_delivery_date || ''}<br><small style="color:#888;">${item.lead_time_display || ''}</small></td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
            <div style="margin-top: 20px; text-align: right; font-size: 14px; padding: 10px; background: #e8f5e9; border-radius: 8px;">
                <strong>총 품목수:</strong> ${items.length}개 &nbsp;&nbsp;|&nbsp;&nbsp;
                <strong>총 금액:</strong> <span style="color: #28a745; font-size: 16px;">${totalAmount.toLocaleString()}원</span>
            </div>
            <div style="margin-top: 40px; font-size: 11px; color: #888; text-align: center;">
                다함푸드 급식관리 시스템 | 출력일시: ${new Date().toLocaleString()}
            </div>
        </div>
    `;

    return html;
}
