/**
 * 발주 관리 - 이전 발주서 조회/수정/스냅샷 복원
 * Depends on: ordering-state.js
 */

async function togglePreviousOrders() {
    const section = document.getElementById('previousOrdersSection');
    const toggle = document.getElementById('previousOrdersToggle');
    if (section.style.display === 'none') {
        section.style.display = 'block';
        toggle.style.transform = 'rotate(180deg)';

        // 기본 날짜 설정 (7일 전 ~ 3주 후, 총 4주)
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        const threeWeeksLater = new Date(today);
        threeWeeksLater.setDate(today.getDate() + 21);

        document.getElementById('orderSearchFrom').value = getLocalDateString(sevenDaysAgo);
        document.getElementById('orderSearchTo').value = getLocalDateString(threeWeeksLater);

        // 드롭다운 초기화 (최초 1회만)
        if (!OS.orderSearchInitialized) {
            await loadOrderSearchOptions();
            OS.orderSearchInitialized = true;
        }
    } else {
        section.style.display = 'none';
        toggle.style.transform = 'rotate(0deg)';
    }
}

async function loadOrderSearchOptions() {
    // 사업장 목록 로드 (그룹 단위: 본사/영남지사 - orders.site_id = site_groups.id)
    try {
        const siteSelect = document.getElementById('orderSearchSite');
        const response = await fetch('/api/admin/structure/tree');
        const result = await response.json();
        if (result.success && result.data) {
            result.data.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                siteSelect.appendChild(option);
            });
        }
    } catch (e) { console.error('사업장 로드 오류:', e); }

    // 협력업체 목록 로드
    try {
        const supplierSelect = document.getElementById('orderSearchSupplier');
        const response = await fetch('/api/admin/suppliers');
        const result = await response.json();
        if (result.success && result.data) {
            result.data.forEach(supplier => {
                const option = document.createElement('option');
                option.value = supplier.id;
                option.textContent = supplier.company_name || supplier.name;
                supplierSelect.appendChild(option);
            });
        }
    } catch (e) { console.error('협력업체 로드 오류:', e); }
}

async function loadPreviousOrders() {
    const siteIdFromDropdown = document.getElementById('orderSearchSite').value;
    const supplierId = document.getElementById('orderSearchSupplier').value;
    const fromDate = document.getElementById('orderSearchFrom').value;
    const toDate = document.getElementById('orderSearchTo').value;

    // ★ 현재 SiteSelector에서 선택된 그룹 정보 가져오기
    let currentGroupId = null;
    let currentSiteId = null;
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        if (context) {
            currentGroupId = context.group_id;
            currentSiteId = context.site_id;
        }
    }

    const listContainer = document.getElementById('previousOrdersList');
    listContainer.innerHTML = '<p style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 조회 중...</p>';

    try {
        let url = `/api/orders?limit=100`;
        // 드롭다운 선택 우선, 없으면 상단 SiteSelector의 그룹으로 필터
        if (siteIdFromDropdown) {
            url += `&site_id=${siteIdFromDropdown}`;
        } else if (currentGroupId) {
            url += `&site_id=${currentGroupId}`;
        }
        if (supplierId) url += `&supplier_id=${supplierId}`;
        if (fromDate) url += `&from_date=${fromDate}`;
        if (toDate) url += `&to_date=${toDate}`;

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            let html = `
                <div style="margin-bottom: 10px; color: #666; font-size: 12px;">
                    총 <strong>${result.data.length}</strong>건의 발주서
                </div>
                <div style="overflow-x: auto;">
                <table class="order-table" style="font-size: 13px; min-width: 900px;">
                    <thead>
                        <tr>
                            <th>발주번호</th>
                            <th>사업장</th>
                            <th>식단표 날짜</th>
                            <th>입고일</th>
                            <th>저장시간</th>
                            <th>상태</th>
                            <th>품목수</th>
                            <th>총금액</th>
                            <th>액션</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            const _today = new Date().toISOString().split('T')[0];
            result.data.forEach(order => {
                const usageDate = order.meal_plan_date || order.usage_date || '';
                const isPast = usageDate && usageDate < _today;
                const statusBadge = {
                    'draft': '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:10px;font-size:11px;">임시</span>',
                    'confirmed': '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:10px;font-size:11px;">확정</span>',
                    'locked': '<span style="background:#e9ecef;color:#495057;padding:2px 8px;border-radius:10px;font-size:11px;">완료</span>'
                }[order.status] || order.status;

                // 발주 유형 배지 (추가발주 표시)
                let orderTypeBadge = '';
                if (order.order_type === 'additional' || order.parent_order_id) {
                    orderTypeBadge = `<span style="background:#17a2b8;color:white;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:5px;" title="원본: ${order.parent_order_number || ''}">추가</span>`;
                } else if (order.order_type === 'urgent') {
                    orderTypeBadge = `<span style="background:#dc3545;color:white;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:5px;">긴급</span>`;
                }

                // 추가발주 자식 개수 표시
                let additionalCountBadge = '';
                if (order.additional_orders_count && order.additional_orders_count > 0) {
                    additionalCountBadge = `<span style="background:#6f42c1;color:white;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:5px;" title="추가발주 ${order.additional_orders_count}건">+${order.additional_orders_count}</span>`;
                }

                // 저장 시간 포맷팅 (updated_at 우선, 없으면 created_at)
                let savedTime = '-';
                const timeStr = order.updated_at || order.created_at;
                if (timeStr) {
                    const dt = new Date(timeStr);
                    if (!isNaN(dt.getTime())) {
                        savedTime = dt.toLocaleString('ko-KR', {
                            month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                        });
                    }
                }

                html += `
                    <tr style="${isPast ? 'background:#f8f9fa;color:#9ca3af;' : ''}">
                        <td><strong>${order.order_number || '-'}</strong>${orderTypeBadge}${additionalCountBadge}</td>
                        <td>${order.site_name || '-'}</td>
                        <td>${order.meal_plan_date || order.usage_date || '-'}</td>
                        <td>${order.expected_delivery_date || order.order_date || '-'}</td>
                        <td style="font-size:11px;color:#666;">${savedTime}</td>
                        <td>${statusBadge}</td>
                        <td>${order.total_items || 0}개</td>
                        <td style="text-align:right;">${Number(order.total_amount || 0).toLocaleString()}원</td>
                        <td style="white-space: nowrap;">
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="viewOrder(${order.id})" title="상세보기">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn" style="padding:4px 8px;font-size:11px;margin-left:2px;background:linear-gradient(135deg,#6a11cb,#2575fc);color:white;"
                                    onclick="openCompareModal(${order.id})" title="현재 식단/식수와 비교">
                                <i class="fas fa-balance-scale"></i>
                            </button>
                            ${order.status === 'draft' ? `
                                <button class="btn btn-warning" style="padding:4px 8px;font-size:11px;margin-left:2px;"
                                        onclick="editOrder(${order.id})" title="수정">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-success" style="padding:4px 8px;font-size:11px;margin-left:2px;"
                                        onclick="changeOrderStatus(${order.id}, 'confirmed', '${order.order_number}')" title="확정">
                                    <i class="fas fa-check"></i>
                                </button>
                            ` : ''}
                            ${order.status === 'confirmed' ? `
                                <button class="btn" style="padding:4px 8px;font-size:11px;margin-left:2px;background:#6c757d;color:white;"
                                        onclick="changeOrderStatus(${order.id}, 'locked', '${order.order_number}')" title="완료처리">
                                    <i class="fas fa-lock"></i>
                                </button>
                            ` : ''}
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;margin-left:2px;"
                                    onclick="checkAndDeleteOrder(${order.id}, '${order.order_number}', '${order.order_date}', '${order.usage_date || order.meal_plan_date}', '${order.status}')"
                                    ${order.status === 'locked' ? 'disabled' : ''} title="삭제">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
            html += '</tbody></table></div>';
            listContainer.innerHTML = html;
        } else {
            listContainer.innerHTML = '<p style="color: #888; text-align: center; padding: 20px;">해당 기간에 발주서가 없습니다.</p>';
        }
    } catch (error) {
        console.error('발주서 조회 오류:', error);
        listContainer.innerHTML = '<p style="color: #dc3545; text-align: center; padding: 20px;">조회 중 오류가 발생했습니다.</p>';
    }
}

async function viewOrder(orderId) {
    try {
        const response = await fetch(`/api/orders/${orderId}`);
        const result = await response.json();

        if (result.success) {
            const order = result.data;
            const items = order.items || [];

            // 스냅샷 데이터가 있으면 Step 2/3 복원 버튼 추가
            const hasSnapshot = order.step2_snapshot || order.step3_snapshot;
            const snapshotExpired = order.snapshot_expired;

            // 상태 배지
            const statusBadge = {
                'draft': '<span class="badge badge-warning">임시저장</span>',
                'confirmed': '<span class="badge badge-success">확정</span>',
                'locked': '<span style="background:#6c757d;color:white;padding:2px 8px;border-radius:4px;font-size:11px;">완료</span>'
            }[order.status] || order.status;

            // 협력업체별 그룹핑 + 동일 식자재 합산
            const supplierGroups = {};
            items.forEach(item => {
                const supplierName = item.supplier_name || '미지정';
                if (!supplierGroups[supplierName]) {
                    supplierGroups[supplierName] = { items: {}, total: 0 };  // items를 객체로 변경 (합산용)
                }

                // 동일 식자재 키 (식자재 코드 기준)
                const ingredientKey = item.ingredient_code || item.ingredient_id || item.ingredient_name;

                if (!supplierGroups[supplierName].items[ingredientKey]) {
                    // 첫 번째 항목
                    supplierGroups[supplierName].items[ingredientKey] = {
                        ...item,
                        order_qty: Number(item.order_qty || 0),
                        total_price: Number(item.total_price || 0),
                        meal_types: [item.meal_type].filter(Boolean),  // 끼니 정보 수집
                        menu_names: [item.menu_name].filter(Boolean),  // 메뉴 정보 수집
                        merged_count: 1  // 합산된 항목 수
                    };
                } else {
                    // 동일 식자재 합산
                    supplierGroups[supplierName].items[ingredientKey].order_qty += Number(item.order_qty || 0);
                    supplierGroups[supplierName].items[ingredientKey].total_price += Number(item.total_price || 0);
                    if (item.meal_type && !supplierGroups[supplierName].items[ingredientKey].meal_types.includes(item.meal_type)) {
                        supplierGroups[supplierName].items[ingredientKey].meal_types.push(item.meal_type);
                    }
                    if (item.menu_name && !supplierGroups[supplierName].items[ingredientKey].menu_names.includes(item.menu_name)) {
                        supplierGroups[supplierName].items[ingredientKey].menu_names.push(item.menu_name);
                    }
                    supplierGroups[supplierName].items[ingredientKey].merged_count++;
                }

                supplierGroups[supplierName].total += Number(item.total_price || 0);
            });

            // items 객체를 배열로 변환
            for (const supplierName of Object.keys(supplierGroups)) {
                supplierGroups[supplierName].items = Object.values(supplierGroups[supplierName].items);
            }

            // 모달 내용 구성
            let html = `
                <div class="order-info-grid">
                    <div class="order-info-item">
                        <span class="order-info-label">발주번호</span>
                        <span class="order-info-value">${order.order_number || '-'}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">상태</span>
                        <span class="order-info-value">${statusBadge}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">사업장</span>
                        <span class="order-info-value">${order.site_name || '-'}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">창고/도착지</span>
                        <span class="order-info-value">${order.warehouse_name || '-'}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">식단표 날짜</span>
                        <span class="order-info-value">${order.usage_date || '-'}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">입고일</span>
                        <span class="order-info-value">${order.expected_delivery_date || order.order_date || '-'}</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">저장시간</span>
                        <span class="order-info-value" style="font-size: 0.9rem; color: #666;">
                            ${(() => {
                                const timeStr = order.updated_at || order.created_at;
                                if (!timeStr) return '-';
                                const dt = new Date(timeStr);
                                if (isNaN(dt.getTime())) return '-';
                                return dt.toLocaleString('ko-KR', {
                                    year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                                });
                            })()}
                        </span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">총 품목수</span>
                        <span class="order-info-value">${order.total_items || items.length}개</span>
                    </div>
                    <div class="order-info-item">
                        <span class="order-info-label">총 금액</span>
                        <span class="order-info-value" style="color: #667eea; font-size: 1.2rem;">
                            ${Number(order.total_amount || 0).toLocaleString()}원
                        </span>
                    </div>
                </div>
            `;

            // 협력업체별 품목 목록
            if (Object.keys(supplierGroups).length > 0) {
                html += `<div class="order-items-section">`;

                for (const [supplierName, group] of Object.entries(supplierGroups)) {
                    html += `
                        <h4>
                            <i class="fas fa-building"></i> ${supplierName}
                            <span style="font-weight: normal; font-size: 0.85rem; color: #666; margin-left: auto;">
                                ${group.items.length}개 품목 | ${group.total.toLocaleString()}원
                            </span>
                        </h4>
                        <div class="order-table-container" style="margin-bottom: 1.5rem;">
                            <table class="order-table">
                                <thead>
                                    <tr>
                                        <th>품목명</th>
                                        <th>규격</th>
                                        <th>끼니</th>
                                        <th>메뉴</th>
                                        <th>발주량</th>
                                        <th>단가</th>
                                        <th>금액</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;

                    group.items.forEach(item => {
                        // 합산된 끼니/메뉴 정보 표시
                        const mealTypesDisplay = item.meal_types?.length > 0
                            ? item.meal_types.join(', ')
                            : (item.meal_type || '-');
                        const menuNamesDisplay = item.menu_names?.length > 0
                            ? (item.menu_names.length > 2
                                ? `${item.menu_names.slice(0,2).join(', ')} 외 ${item.menu_names.length - 2}개`
                                : item.menu_names.join(', '))
                            : (item.menu_name || '-');

                        // 합산 표시 (2개 이상 합산된 경우)
                        const mergedBadge = item.merged_count > 1
                            ? `<span style="background:#e2e8f0;color:#4a5568;padding:1px 5px;border-radius:3px;font-size:10px;margin-left:5px;">${item.merged_count}건 합산</span>`
                            : '';

                        html += `
                            <tr>
                                <td style="text-align: left;">${item.ingredient_name || '-'}${mergedBadge}</td>
                                <td>${item.spec || item.specification || '-'}</td>
                                <td>${mealTypesDisplay}</td>
                                <td title="${item.menu_names?.join(', ') || ''}">${menuNamesDisplay}</td>
                                <td><strong>${Number(item.order_qty || 0).toLocaleString()}</strong> ${item.unit || ''}</td>
                                <td style="text-align: right;">${Number(item.unit_price || 0).toLocaleString()}원</td>
                                <td style="text-align: right;"><strong>${Number(item.total_price || 0).toLocaleString()}원</strong></td>
                            </tr>
                        `;
                    });

                    html += `
                                </tbody>
                            </table>
                        </div>
                    `;
                }

                html += `</div>`;
            } else {
                html += `<p style="text-align: center; color: #888; padding: 2rem;">등록된 품목이 없습니다.</p>`;
            }

            // 비고
            if (order.notes) {
                html += `
                    <div style="margin-top: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
                        <strong><i class="fas fa-sticky-note"></i> 비고:</strong>
                        <p style="margin-top: 0.5rem; color: #666;">${order.notes}</p>
                    </div>
                `;
            }

            // 스냅샷 복원 버튼 (60일 이내 데이터만)
            if (hasSnapshot && !snapshotExpired) {
                html += `
                    <div style="margin-top: 1.5rem; padding: 1rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; text-align: center;">
                        <p style="color: white; margin-bottom: 10px; font-size: 14px;">
                            <i class="fas fa-magic"></i> 이 발주서는 Step 2/3 작업 상태를 복원할 수 있습니다.
                        </p>
                        <button onclick="restoreOrderSnapshot(${orderId})"
                            style="padding: 10px 20px; background: white; color: #667eea; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
                            <i class="fas fa-undo"></i> Step 2/3 상태로 복원하기
                        </button>
                    </div>
                `;
            } else if (snapshotExpired) {
                html += `
                    <div style="margin-top: 1rem; padding: 0.75rem; background: #fff3cd; border-radius: 6px; color: #856404; font-size: 13px;">
                        <i class="fas fa-info-circle"></i> ${order.snapshot_expired_message || '스냅샷 데이터가 보관 기간(60일)을 초과하여 삭제되었습니다.'}
                    </div>
                `;
            }

            document.getElementById('orderDetailBody').innerHTML = html;
            OS.viewedOrderData = order;  // 엑셀/PDF 출력용 데이터 저장
            document.getElementById('orderDetailModal').classList.add('show');
        } else {
            alert('발주서 조회 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('발주 상세 조회 오류:', error);
        alert('발주서 조회 중 오류가 발생했습니다.');
    }
}

// ============================================
// 스냅샷 복원 기능 - Step 2/3 상태로 복원
// ============================================
async function restoreOrderSnapshot(orderId) {
    try {
        showLoading('발주서 상태 복원 중...');

        const response = await fetch(`/api/orders/${orderId}`);

        // 네트워크 응답 체크
        if (!response.ok) {
            throw new Error(`서버 응답 오류: ${response.status} ${response.statusText}`);
        }

        let result;
        try {
            result = await response.json();
        } catch (jsonError) {
            console.error('JSON 파싱 오류:', jsonError);
            throw new Error('서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.');
        }

        if (!result.success) {
            alert('발주서 조회 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        const order = result.data;

        // 스냅샷 만료 체크
        if (order.snapshot_expired) {
            alert(order.snapshot_expired_message || '스냅샷 데이터가 보관 기간(60일)을 초과하여 삭제되었습니다.');
            return;
        }

        const step2 = order.step2_snapshot;
        const step3 = order.step3_snapshot;

        if (!step2 && !step3) {
            alert('복원할 스냅샷 데이터가 없습니다.\n\n발주서에 저장된 작업 상태(Step 2/3)가 없거나 삭제되었습니다.');
            return;
        }

        // 모달 닫기
        closeOrderDetailModal();

        // 기본 정보 설정 (요소가 존재하는 경우에만)
        const mealPlanDateEl = document.getElementById('mealPlanDate');
        const orderDateEl = document.getElementById('orderDate');
        const warehouseSelectEl = document.getElementById('warehouseSelect');

        if (order.usage_date && mealPlanDateEl) {
            mealPlanDateEl.value = order.usage_date;
        }
        if ((order.order_date || order.expected_delivery_date) && orderDateEl) {
            orderDateEl.value = order.expected_delivery_date || order.order_date;
        }
        if (order.warehouse_id && warehouseSelectEl) {
            warehouseSelectEl.value = order.warehouse_id;
        }

        // Step 2 데이터 복원
        if (step2) {
            OS.currentOrderData = {
                items: step2.items || [],
                summary: step2.summary || {}
            };

            // 선택 상태 복원
            OS.selectedRefKeys = new Set(step2.selectedRefKeys || []);
            OS.groupSelectionState = step2.groupSelectionState || {};

            // Step 2 섹션 표시
            document.getElementById('resultSection').style.display = 'block';

            // Step 2 UI 표시
            displayMealSections(step2.items || []);
        }

        // Step 3 데이터 복원
        if (step3) {
            OS.aggregatedOrderData = step3.aggregatedItems || [];
            OS.currentDisplayItems = step3.displayItems || [];

            // summary 업데이트
            if (step3.summary) {
                updateSummary(step3.summary);
            }

            // Step 3 섹션 표시
            document.getElementById('orderSection').style.display = 'block';

            // Step 3 UI 표시
            displayOrderTable(OS.currentDisplayItems);
        }

        // 현재 발주 ID 설정 (수정 모드)
        OS.currentOrderId = orderId;

        // 저장 버튼 텍스트 변경
        document.getElementById('saveOrderBtn').textContent = '발주서 수정';
        document.getElementById('confirmOrderBtn').style.display = order.status === 'draft' ? 'inline-flex' : 'none';

        // 안내 메시지
        alert(`발주서 ${order.order_number}의 작업 상태가 복원되었습니다.\n\nStep 2와 Step 3 화면에서 수정 후 저장하실 수 있습니다.`);

        // Step 2 섹션으로 스크롤
        setTimeout(() => {
            const targetSection = document.getElementById('resultSection');
            if (targetSection) {
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);

    } catch (error) {
        console.error('스냅샷 복원 오류:', error);
        const errorMsg = error.message || '알 수 없는 오류';
        if (errorMsg.includes('NetworkError') || errorMsg.includes('Failed to fetch') || errorMsg.includes('Resource was not cached')) {
            alert('네트워크 연결 오류입니다.\n\n인터넷 연결을 확인하고 다시 시도해주세요.');
        } else {
            alert('발주서 상태 복원 중 오류가 발생했습니다.\n\n' + errorMsg);
        }
    } finally {
        hideLoading();
    }
}

// ============================================
// 발주서 수정 기능 (수량 조정)
// ============================================

async function editOrder(orderId) {
    try {
        const response = await fetch(`/api/orders/${orderId}`);
        const result = await response.json();

        if (!result.success) {
            alert('발주서 조회 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        const order = result.data;

        if (order.status !== 'draft') {
            alert('임시저장 상태의 발주서만 수정할 수 있습니다.');
            return;
        }

        OS.editingOrderId = orderId;
        OS.editingOrderSiteId = order.site_id;
        OS.editingOrderUsageDate = order.usage_date;
        OS.editingOrderItems = order.items || [];

        // 모달 헤더 정보
        document.getElementById('editOrderNumber').textContent = order.order_number || '-';
        document.getElementById('editOrderSite').textContent = order.site_name || '-';
        document.getElementById('editOrderDate').textContent = order.order_date || '-';
        document.getElementById('editUsageDate').textContent = order.usage_date || '-';

        // 품목 테이블 렌더링
        renderEditOrderItems();

        // 모달 열기
        document.getElementById('orderEditModal').classList.add('show');

    } catch (error) {
        console.error('발주서 수정 오류:', error);
        alert('발주서 조회 중 오류가 발생했습니다.');
    }
}

function renderEditOrderItems() {
    const tbody = document.getElementById('editOrderItemsBody');
    let html = '';
    let totalAmount = 0;
    let totalItems = 0;

    OS.editingOrderItems.forEach((item, index) => {
        const orderQty = Number(item.order_qty || 0);
        const unitPrice = Number(item.unit_price || 0);
        const itemTotal = orderQty * unitPrice;

        if (orderQty > 0) {
            totalAmount += itemTotal;
            totalItems++;
        }

        html += `
            <tr data-index="${index}" class="${orderQty <= 0 ? 'excluded-item' : ''}">
                <td style="text-align:left;">
                    <strong>${item.ingredient_name || '-'}</strong>
                    <br><small style="color:#888;">${item.specification || item.spec || '-'}</small>
                </td>
                <td>${item.supplier_name || '-'}</td>
                <td>${item.meal_type || '-'}</td>
                <td>${item.menu_name || '-'}</td>
                <td style="text-align:right;">${Number(item.required_qty || 0).toLocaleString()}</td>
                <td style="text-align:center;">
                    <input type="number" class="edit-qty-input" value="${orderQty}"
                           min="0" step="0.1" data-index="${index}"
                           onchange="updateEditItemQty(${index}, this.value)"
                           style="width:80px;text-align:right;padding:4px 8px;border:1px solid #ddd;border-radius:4px;">
                    <span style="margin-left:4px;">${item.unit || ''}</span>
                </td>
                <td style="text-align:right;">${unitPrice.toLocaleString()}원</td>
                <td style="text-align:right;" id="itemTotal_${index}">
                    <strong>${itemTotal.toLocaleString()}원</strong>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // 합계 업데이트
    document.getElementById('editTotalItems').textContent = totalItems + '개';
    document.getElementById('editTotalAmount').textContent = totalAmount.toLocaleString() + '원';
}

function updateEditItemQty(index, value) {
    const qty = parseFloat(value) || 0;
    OS.editingOrderItems[index].order_qty = qty;

    // 개별 금액 업데이트
    const unitPrice = Number(OS.editingOrderItems[index].unit_price || 0);
    const itemTotal = qty * unitPrice;
    document.getElementById(`itemTotal_${index}`).innerHTML = `<strong>${itemTotal.toLocaleString()}원</strong>`;

    // 행 스타일 업데이트 (0이면 흐리게)
    const row = document.querySelector(`tr[data-index="${index}"]`);
    if (row) {
        row.classList.toggle('excluded-item', qty <= 0);
    }

    // 전체 합계 재계산
    recalculateEditTotals();
}

function recalculateEditTotals() {
    let totalAmount = 0;
    let totalItems = 0;

    OS.editingOrderItems.forEach(item => {
        const qty = Number(item.order_qty || 0);
        if (qty > 0) {
            totalAmount += qty * Number(item.unit_price || 0);
            totalItems++;
        }
    });

    document.getElementById('editTotalItems').textContent = totalItems + '개';
    document.getElementById('editTotalAmount').textContent = totalAmount.toLocaleString() + '원';
}

async function saveOrderEdit() {
    if (!OS.editingOrderId) {
        alert('수정할 발주서가 없습니다.');
        return;
    }

    // ★ 발주량 또는 필요량이 0보다 큰 품목 필터링 (재고 사용 항목도 포함)
    const itemsToSave = OS.editingOrderItems.filter(item =>
        Number(item.order_qty || 0) > 0 || Number(item.required_qty || 0) > 0
    );

    if (itemsToSave.length === 0) {
        if (!confirm('발주할 품목이 없습니다. 발주서를 삭제하시겠습니까?')) {
            return;
        }
        // 발주서 삭제
        try {
            const deleteResponse = await fetch(`/api/orders/${OS.editingOrderId}`, { method: 'DELETE' });
            const deleteResult = await deleteResponse.json();
            if (deleteResult.success) {
                alert('발주서가 삭제되었습니다.');
                closeOrderEditModal();
                loadPreviousOrders();
            } else {
                alert('삭제 실패: ' + deleteResult.error);
            }
        } catch (e) {
            alert('삭제 중 오류: ' + e.message);
        }
        return;
    }

    try {
        const response = await fetch(`/api/orders/${OS.editingOrderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_id: OS.editingOrderSiteId, usage_date: OS.editingOrderUsageDate, items: itemsToSave })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message || '발주서가 수정되었습니다.');
            closeOrderEditModal();
            loadPreviousOrders();
        } else {
            alert('수정 실패: ' + result.error);
        }
    } catch (error) {
        console.error('발주서 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

function closeOrderEditModal() {
    document.getElementById('orderEditModal').classList.remove('show');
    OS.editingOrderId = null;
    OS.editingOrderSiteId = null;
    OS.editingOrderUsageDate = null;
    OS.editingOrderItems = [];
}

// 발주서 삭제 전 선발주일 체크
async function checkAndDeleteOrder(orderId, orderNumber, orderDate, usageDate, status) {
    // 완료된 발주서는 삭제 불가
    if (status === 'locked') {
        alert('완료된 발주서는 삭제할 수 없습니다.');
        return;
    }

    try {
        // 발주서 상세 정보 가져오기 (선발주일 확인용)
        const response = await fetch(`/api/orders/${orderId}`);
        const result = await response.json();

        if (!result.success) {
            alert('발주서 정보를 가져올 수 없습니다.');
            return;
        }

        const order = result.data;
        const items = order.items || [];

        // 오늘 날짜
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 식단표 날짜
        const mealDate = new Date(usageDate);
        mealDate.setHours(0, 0, 0, 0);

        // 최대 선발주일 찾기
        let maxLeadTime = 0;
        items.forEach(item => {
            const leadTime = parseInt(item.lead_time) || 2;
            if (leadTime > maxLeadTime) {
                maxLeadTime = leadTime;
            }
        });

        // 발주 마감일 계산 (식단일 - 선발주일)
        const deadlineDate = new Date(mealDate);
        deadlineDate.setDate(deadlineDate.getDate() - maxLeadTime);

        // 경고 메시지 구성
        let warningMessage = '';
        let canDelete = true;

        if (today > deadlineDate) {
            // 발주 마감일이 지났음
            warningMessage = `⚠️ 주의: 발주 마감일(${formatDate(deadlineDate)})이 지났습니다.\n`;
            warningMessage += `식단일: ${usageDate}\n`;
            warningMessage += `최대 선발주일: ${maxLeadTime}일\n\n`;
            warningMessage += `삭제하면 해당 날짜 식단에 필요한 식자재를 다시 발주해야 합니다.\n`;
        }

        if (mealDate <= today) {
            // 식단일이 오늘이거나 지났음
            warningMessage = `⚠️ 주의: 식단일(${usageDate})이 오늘이거나 이미 지났습니다.\n\n`;
            warningMessage += `이 발주서를 삭제하시겠습니까?\n`;
        }

        // 삭제 확인
        const confirmMessage = warningMessage
            ? warningMessage + `\n정말 발주서 [${orderNumber}]를 삭제하시겠습니까?`
            : `발주서 [${orderNumber}]를 삭제하시겠습니까?\n\n` +
            `식단일: ${usageDate}\n` +
            `입고일: ${orderDate}\n` +
            `품목수: ${items.length}개`;

        if (!confirm(confirmMessage)) {
            return;
        }

        // 삭제 실행
        const deleteResponse = await fetch(`/api/orders/${orderId}`, {
            method: 'DELETE'
        });
        const deleteResult = await deleteResponse.json();

        if (deleteResult.success) {
            alert(`발주서 [${orderNumber}]가 삭제되었습니다.`);
            // 목록 새로고침
            loadPreviousOrders();
        } else {
            alert('삭제 실패: ' + (deleteResult.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('발주서 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

/* 툴팁 스타일 동적 추가 */
const _historyStyle = document.createElement('style');
_historyStyle.textContent = `
    .meal-count-badge:hover .breakdown-tooltip {
        display: block !important;
    }
`;
document.head.appendChild(_historyStyle);

// 발주서 상태 변경
async function changeOrderStatus(orderId, newStatus, orderNumber) {
    const statusNames = {
        'draft': '임시',
        'confirmed': '확정',
        'locked': '완료'
    };

    const confirmMsg = newStatus === 'confirmed'
        ? `발주서 [${orderNumber}]를 확정하시겠습니까?\n\n확정 후에는 입고명세서에 표시됩니다.`
        : `발주서 [${orderNumber}]를 완료 처리하시겠습니까?\n\n완료 후에는 수정/삭제가 불가능합니다.`;

    if (!confirm(confirmMsg)) {
        return;
    }

    try {
        const response = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            searchOrders();  // 목록 새로고침
        } else {
            alert('상태 변경 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('상태 변경 중 오류가 발생했습니다.');
    }
}


// =====================
// 행사 발주 현황 (발주관리 페이지 내)
// =====================

function toggleEventOrders() {
    const section = document.getElementById('eventOrdersSection');
    const toggle = document.getElementById('eventOrdersToggle');
    if (section.style.display === 'none') {
        section.style.display = 'block';
        toggle.style.transform = 'rotate(180deg)';
        loadEventOrdersInOrdering();
    } else {
        section.style.display = 'none';
        toggle.style.transform = 'rotate(0deg)';
    }
}

async function loadEventOrdersInOrdering() {
    const container = document.getElementById('eventOrdersList');
    const statusFilter = document.getElementById('eventOrderStatusFilter').value;

    try {
        let url = '/api/event-orders?limit=30';
        if (statusFilter) url += `&status=${statusFilter}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!data.success || data.orders.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center; padding: 15px;">행사 발주 내역이 없습니다.</p>';
            return;
        }

        const statusBadge = (status) => {
            const colors = { pending: '#fef3c7;color:#92400e', confirmed: '#dcfce7;color:#166534', cancelled: '#fee2e2;color:#991b1b' };
            const texts = { pending: '대기', confirmed: '확정', cancelled: '취소' };
            return `<span style="display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:500;background:${colors[status] || '#f1f5f9;color:#475569'}">${texts[status] || status}</span>`;
        };

        let html = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:#f8fafc;">
                    <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">발주번호</th>
                    <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">템플릿</th>
                    <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">인원</th>
                    <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">입고일</th>
                    <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">행사일</th>
                    <th style="padding:8px;text-align:right;border-bottom:2px solid #e2e8f0;">총액</th>
                    <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">상태</th>
                    <th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">관리</th>
                </tr>
            </thead>
            <tbody>`;

        const _todayEv = new Date().toISOString().split('T')[0];
        data.orders.forEach(order => {
            const totalFormatted = Math.round(order.total_amount || 0).toLocaleString('ko-KR');
            const isPastEv = order.usage_date && order.usage_date < _todayEv;
            html += `
                <tr style="border-bottom:1px solid #f1f5f9;${isPastEv ? 'background:#f8f9fa;color:#9ca3af;' : ''}">
                    <td style="padding:8px;">${order.order_number}</td>
                    <td style="padding:8px;">${order.template_name || '-'}</td>
                    <td style="padding:8px;text-align:center;">${order.attendees || '-'}명</td>
                    <td style="padding:8px;text-align:center;">${order.order_date || '-'}</td>
                    <td style="padding:8px;text-align:center;">${order.usage_date || '-'}</td>
                    <td style="padding:8px;text-align:right;">${totalFormatted}원</td>
                    <td style="padding:8px;text-align:center;">${statusBadge(order.status)}</td>
                    <td style="padding:8px;text-align:center;">
                        <div style="display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap;">
                            ${order.merged_into ?
                                `<span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;" title="합산 완료">
                                    <i class="fas fa-link" style="margin-right:2px;"></i>${order.merged_into}
                                </span>` : ''
                            }
                            ${order.status === 'pending' ?
                                `<button onclick="changeEventOrderStatusInOrdering(${order.id}, 'confirmed')" style="border:1px solid #bbf7d0;background:none;color:#16a34a;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;" title="확정">
                                    <i class="fas fa-check"></i>
                                </button>` :
                                order.status === 'confirmed' ?
                                `<button onclick="changeEventOrderStatusInOrdering(${order.id}, 'pending')" style="border:1px solid #fde68a;background:none;color:#f59e0b;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;" title="확정 취소">
                                    <i class="fas fa-undo"></i>
                                </button>` : ''
                            }
                            <button onclick="viewEventOrderDetail(${order.id})" style="border:1px solid #bfdbfe;background:none;color:#2563eb;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;" title="상세">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button onclick="deleteEventOrderInOrdering(${order.id})" style="border:1px solid #fecaca;background:none;color:#dc2626;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;" title="삭제">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (error) {
        console.error('행사 발주 로드 오류:', error);
        container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 15px;">행사 발주 내역 로드 실패</p>';
    }
}

async function changeEventOrderStatusInOrdering(orderId, newStatus) {
    const statusText = { confirmed: '확정', pending: '대기', cancelled: '취소' };
    if (!confirm(`행사 발주서를 '${statusText[newStatus]}'(으)로 변경하시겠습니까?`)) return;

    try {
        const response = await fetch(`/api/event-orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            loadEventOrdersInOrdering();
        } else {
            alert(data.error || '상태 변경 실패');
        }
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('상태 변경 중 오류가 발생했습니다.');
    }
}

async function deleteEventOrderInOrdering(orderId) {
    if (!confirm('이 행사 발주서를 삭제하시겠습니까?')) return;

    try {
        const response = await fetch(`/api/event-orders/${orderId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            loadEventOrdersInOrdering();
        } else {
            alert(data.error || '삭제 실패');
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

async function viewEventOrderDetail(orderId) {
    try {
        const response = await fetch(`/api/event-orders/${orderId}`);
        const data = await response.json();

        if (!data.success) {
            alert(data.error || '조회 실패');
            return;
        }

        const order = data.order;
        const totalFormatted = Math.round(order.total_amount || 0).toLocaleString('ko-KR');

        // 협력업체별 그룹화
        const supplierMap = {};
        order.items.forEach(item => {
            const supplier = item.supplier_name || '(미지정)';
            if (!supplierMap[supplier]) supplierMap[supplier] = { items: [], total: 0 };
            supplierMap[supplier].items.push(item);
            supplierMap[supplier].total += (item.total_amount || 0);
        });

        let detailHtml = `
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
                <div style="background:white;border-radius:12px;width:90%;max-width:900px;max-height:80vh;display:flex;flex-direction:column;">
                    <div style="padding:15px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
                        <h3 style="margin:0;font-size:1rem;"><i class="fas fa-file-invoice" style="color:#6366f1;"></i> 행사 발주서 상세 - ${order.order_number}</h3>
                        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">&times;</button>
                    </div>
                    <div style="padding:15px 20px;overflow-y:auto;flex:1;">
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:15px;background:#f8fafc;padding:12px;border-radius:8px;">
                            <div><small style="color:#64748b;">템플릿</small><br><strong>${order.template_name || '-'}</strong></div>
                            <div><small style="color:#64748b;">인원수</small><br><strong>${order.attendees || '-'}명</strong></div>
                            <div><small style="color:#64748b;">입고일</small><br><strong>${order.order_date || '-'}</strong></div>
                            <div><small style="color:#64748b;">행사일</small><br><strong>${order.usage_date || '-'}</strong></div>
                            <div><small style="color:#64748b;">총액</small><br><strong style="color:#0369a1;">${totalFormatted}원</strong></div>
                        </div>`;

        Object.entries(supplierMap).forEach(([supplier, info]) => {
            const supTotal = Math.round(info.total).toLocaleString('ko-KR');
            detailHtml += `
                <div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                    <div style="background:#f8fafc;padding:8px 12px;font-weight:600;font-size:13px;display:flex;justify-content:space-between;">
                        <span><i class="fas fa-building" style="color:#6366f1;margin-right:5px;"></i>${supplier}</span>
                        <span style="color:#6366f1;">${supTotal}원</span>
                    </div>
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                        <thead><tr style="background:#fafafa;">
                            <th style="padding:6px 8px;text-align:left;">식자재명</th>
                            <th style="padding:6px 8px;text-align:left;">규격</th>
                            <th style="padding:6px 8px;">단위</th>
                            <th style="padding:6px 8px;text-align:right;">단가</th>
                            <th style="padding:6px 8px;text-align:right;">수량</th>
                            <th style="padding:6px 8px;text-align:right;">금액</th>
                            <th style="padding:6px 8px;">메뉴</th>
                        </tr></thead>
                        <tbody>`;
            info.items.forEach(item => {
                detailHtml += `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:5px 8px;">${item.ingredient_name}</td>
                        <td style="padding:5px 8px;">${item.specification || '-'}</td>
                        <td style="padding:5px 8px;text-align:center;">${item.unit || '-'}</td>
                        <td style="padding:5px 8px;text-align:right;">${Math.round(item.unit_price || 0).toLocaleString()}</td>
                        <td style="padding:5px 8px;text-align:right;">${item.required_qty}</td>
                        <td style="padding:5px 8px;text-align:right;">${Math.round(item.total_amount || 0).toLocaleString()}</td>
                        <td style="padding:5px 8px;">${item.menu_name || '-'}</td>
                    </tr>`;
            });
            detailHtml += '</tbody></table></div>';
        });

        detailHtml += `
                    </div>
                    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;text-align:right;">
                        <button onclick="this.closest('[style*=fixed]').remove()" class="btn btn-secondary" style="padding:6px 16px;font-size:13px;">닫기</button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', detailHtml);

    } catch (error) {
        console.error('상세 조회 오류:', error);
        alert('상세 조회 중 오류가 발생했습니다.');
    }
}
