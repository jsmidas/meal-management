/**
 * 완전한 협력업체 관리 모듈
 * admin_dashboard.html에 통합하기 위한 버전
 */

(function() {
    'use strict';

    const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.CONFIG?.API_BASE_URL || '';
    let currentPage = 1;
    let currentSort = { field: 'created_at', order: 'desc' };
    let selectedSuppliers = new Set();

    window.SuppliersManagementFull = {
        // 모듈 초기화
        async init() {
            console.log('🏢 Full Suppliers Management Module 초기화');
            await this.loadSupplierStats();
            await this.loadBlackoutStats();
            await this.loadSuppliers();
            this.setupEventListeners();
            return this;
        },

        // 이벤트 리스너 설정
        setupEventListeners() {
            // 검색 입력
            const searchInput = document.getElementById('supplierSearchInput');
            if (searchInput) {
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.loadSuppliers(1);
                    }
                });
            }

            // 전체 선택 체크박스
            const selectAll = document.getElementById('selectAllSuppliers');
            if (selectAll) {
                selectAll.addEventListener('change', (e) => {
                    const checkboxes = document.querySelectorAll('.supplier-checkbox');
                    checkboxes.forEach(cb => {
                        cb.checked = e.target.checked;
                        const supplierId = parseInt(cb.dataset.supplierId);
                        if (e.target.checked) {
                            selectedSuppliers.add(supplierId);
                        } else {
                            selectedSuppliers.delete(supplierId);
                        }
                    });
                    this.updateBulkActions();
                });
            }
        },

        // 협력업체 통계 로드
        async loadSupplierStats() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/suppliers/stats`);
                const data = await response.json();

                if (data.success) {
                    document.getElementById('totalSuppliers').textContent = data.stats.total_suppliers;
                    document.getElementById('activeSuppliers').textContent = data.stats.active_suppliers;
                }
            } catch (error) {
                console.error('통계 로드 실패:', error);
            }
        },

        // 협력업체 목록 로드
        async loadSuppliers(page = 1) {
            try {
                const search = document.getElementById('supplierSearchInput')?.value || '';

                const url = new URL(`${API_BASE_URL}/api/admin/suppliers`);
                url.searchParams.append('page', page);
                url.searchParams.append('limit', 10);
                if (search) url.searchParams.append('search', search);

                const response = await fetch(url);
                const data = await response.json();

                if (data.success) {
                    this.renderSuppliersTable(data.suppliers);
                    this.renderPagination(data.pagination);
                    currentPage = page;
                } else {
                    this.showAlert('협력업체 목록을 불러오는데 실패했습니다: ' + data.error, 'error');
                }
            } catch (error) {
                console.error('협력업체 목록 로드 실패:', error);
                this.showAlert('협력업체 목록을 불러오는데 실패했습니다', 'error');
            }
        },

        // 협력업체 테이블 렌더링
        renderSuppliersTable(suppliers) {
            const tbody = document.getElementById('suppliersTableBody');
            if (!tbody) return;

            if (suppliers.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="13" class="empty-state">
                            <h3>검색 결과가 없습니다</h3>
                            <p>다른 검색 조건을 시도해보세요.</p>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = suppliers.map(supplier => `
                <tr>
                    <td><input type="checkbox" class="supplier-checkbox" data-supplier-id="${supplier.id}"></td>
                    <td>${supplier.id}</td>
                    <td>
                        <div class="supplier-info">
                            <strong>${supplier.name}</strong>
                            <br>
                            <small>${supplier.code || '-'}</small>
                        </div>
                    </td>
                    <td>${supplier.businessType || '-'}</td>
                    <td>${supplier.delivery_code || '-'}</td>
                    <td>${supplier.headquarters_address || '-'}</td>
                    <td>${supplier.representative || '-'}</td>
                    <td>${supplier.phone || '-'}</td>
                    <td>${supplier.email || '-'}</td>
                    <td>
                        <span style="font-family: monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">
                            ${supplier.login_id || supplier.code || '-'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm" style="background:#6366f1;color:#fff;border:none;font-size:11px;padding:4px 8px;"
                                onclick="window.SupplierManagement.resetPassword(${supplier.id}, '${(supplier.name || '').replace(/'/g, "\\'")}')">
                            🔑 초기화
                        </button>
                    </td>
                    <td>
                        <span class="status-badge ${supplier.isActive ? 'active' : 'inactive'}">
                            ${supplier.isActive ? '활성' : '비활성'}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon" onclick="SuppliersManagementFull.viewSupplierDetails(${supplier.id})" title="상세보기">
                                📋
                            </button>
                            <button class="btn-icon" onclick="SuppliersManagementFull.editSupplier(${supplier.id})" title="수정">
                                ✏️
                            </button>
                            <button class="btn-icon" onclick="SuppliersManagementFull.showSupplierBlackoutModal(${supplier.id}, '${(supplier.name || '').replace(/'/g, "\\'")}') " title="휴무일 관리">
                                📅
                            </button>
                            <button class="btn-icon" onclick="SuppliersManagementFull.toggleSupplierStatus(${supplier.id}, ${!supplier.isActive})" title="상태 변경">
                                ${supplier.isActive ? '⏸️' : '▶️'}
                            </button>
                            <button class="btn-icon btn-danger" onclick="SuppliersManagementFull.deleteSupplier(${supplier.id})" title="삭제">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

            // 체크박스 이벤트 리스너 추가
            document.querySelectorAll('.supplier-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const supplierId = parseInt(e.target.dataset.supplierId);
                    if (e.target.checked) {
                        selectedSuppliers.add(supplierId);
                    } else {
                        selectedSuppliers.delete(supplierId);
                    }
                    this.updateBulkActions();
                });
            });
        },

        // 페이지네이션 렌더링
        renderPagination(pagination) {
            const container = document.getElementById('suppliersPagination');
            if (!container) return;

            let html = '';

            // 이전 페이지 버튼
            html += `<button ${!pagination.has_prev ? 'disabled' : ''} onclick="SuppliersManagementFull.loadSuppliers(${pagination.current_page - 1})">이전</button>`;

            // 페이지 번호들
            const startPage = Math.max(1, pagination.current_page - 2);
            const endPage = Math.min(pagination.total_pages, pagination.current_page + 2);

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="${i === pagination.current_page ? 'active' : ''}" onclick="SuppliersManagementFull.loadSuppliers(${i})">${i}</button>`;
            }

            // 다음 페이지 버튼
            html += `<button ${!pagination.has_next ? 'disabled' : ''} onclick="SuppliersManagementFull.loadSuppliers(${pagination.current_page + 1})">다음</button>`;

            container.innerHTML = html;
        },

        // 알림 표시
        showAlert(message, type = 'info') {
            const alertDiv = document.createElement('div');
            alertDiv.className = `alert alert-${type}`;
            alertDiv.textContent = message;

            const container = document.querySelector('.content-container') || document.body;
            container.insertBefore(alertDiv, container.firstChild);

            setTimeout(() => alertDiv.remove(), 5000);
        },

        // 벌크 액션 업데이트
        updateBulkActions() {
            const bulkActions = document.getElementById('supplierBulkActions');
            if (bulkActions) {
                bulkActions.style.display = selectedSuppliers.size > 0 ? 'flex' : 'none';
                const selectedCount = document.getElementById('supplierSelectedCount');
                if (selectedCount) {
                    selectedCount.textContent = selectedSuppliers.size;
                }
            }
        },

        // 협력업체 상세보기
        async viewSupplierDetails(supplierId) {
            console.log('협력업체 상세보기:', supplierId);
            // 상세보기 모달 표시
            this.showSupplierModal(supplierId, 'view');
        },

        // 협력업체 편집
        async editSupplier(supplierId) {
            console.log('협력업체 편집:', supplierId);
            this.showSupplierModal(supplierId, 'edit');
        },

        // 협력업체 모달 표시
        showSupplierModal(supplierId, mode) {
            const modalHtml = `
                <div id="supplierModal" class="modal" style="display:flex; align-items:flex-start; justify-content:center; padding:30px 0; overflow-y:auto;">
                    <div class="modal-content" style="max-height:85vh; overflow-y:auto; margin:auto; font-size:13px;">
                        <div class="modal-header" style="padding:10px 16px;">
                            <h2 style="font-size:16px; margin:0;">${mode === 'edit' ? '협력업체 수정' : mode === 'view' ? '협력업체 상세' : '새 협력업체 추가'}</h2>
                            <button class="close-btn" onclick="SuppliersManagementFull.closeModal()">×</button>
                        </div>
                        <div class="modal-body" style="padding:12px 16px;">
                            <form id="supplierForm">
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 12px;">
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">업체명</label><input type="text" id="supplierName" ${mode === 'view' ? 'readonly' : ''} required style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">업체코드</label><input type="text" id="supplierCode" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">배송코드</label><input type="text" id="supplierDeliveryCode" name="delivery_code" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">사업자번호</label><input type="text" id="businessNumber" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">업종</label><input type="text" id="businessType" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">대표자</label><input type="text" id="representative" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">연락처</label><input type="tel" id="phone" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">이메일</label><input type="email" id="email" ${mode === 'view' ? 'readonly' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                </div>
                                <hr style="margin:10px 0; border:none; border-top:1px solid #e0e0e0;">
                                <div style="font-weight:bold; font-size:13px; margin-bottom:6px; color:#555;">포털 로그인 설정</div>
                                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 12px;">
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">로그인 ID</label><input type="text" id="loginId" ${mode === 'view' ? 'readonly' : ''} placeholder="업체코드 권장" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">비밀번호 ${mode === 'edit' ? '<span style="font-size:10px;color:#999">(변경시만)</span>' : ''}</label><input type="text" id="portalPassword" ${mode === 'view' ? 'readonly' : ''} placeholder="${mode === 'edit' ? '미입력시 유지' : ''}" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"></div>
                                    <div><label style="font-size:12px;color:#555;margin-bottom:2px;display:block;">포털 접근</label><select id="portalEnabled" ${mode === 'view' ? 'disabled' : ''} style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:4px;"><option value="true">활성화</option><option value="false">비활성화</option></select></div>
                                </div>
                                ${mode !== 'view' ? `
                                <div class="form-actions" style="margin-top:12px; text-align:right;">
                                    <button type="submit" class="btn btn-primary" style="padding:6px 20px;font-size:13px;">저장</button>
                                    <button type="button" class="btn btn-secondary" style="padding:6px 20px;font-size:13px;" onclick="SuppliersManagementFull.closeModal()">취소</button>
                                </div>
                                ` : `
                                <div class="form-actions" style="margin-top:12px; text-align:right;">
                                    <button type="button" class="btn btn-secondary" style="padding:6px 20px;font-size:13px;" onclick="SuppliersManagementFull.closeModal()">닫기</button>
                                </div>
                                `}
                            </form>
                        </div>
                    </div>
                </div>
            `;

            // 기존 모달 제거
            const existingModal = document.getElementById('supplierModal');
            if (existingModal) existingModal.remove();

            // 새 모달 추가
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            document.getElementById('supplierModal').style.display = 'block';

            // 폼 submit 이벤트 바인딩
            const form = document.getElementById('supplierForm');
            if (form && mode !== 'view') {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveSupplier(supplierId, mode);
                });
            }

            // 데이터 로드 (편집/상세보기의 경우)
            if (supplierId && (mode === 'edit' || mode === 'view')) {
                this.loadSupplierData(supplierId);
            }
        },

        // 협력업체 저장
        async saveSupplier(supplierId, mode) {
            const data = {
                name: document.getElementById('supplierName')?.value || '',
                supplier_code: document.getElementById('supplierCode')?.value || '',
                delivery_code: document.getElementById('supplierDeliveryCode')?.value || '',
                business_number: document.getElementById('businessNumber')?.value || '',
                business_type: document.getElementById('businessType')?.value || '',
                representative: document.getElementById('representative')?.value || '',
                phone: document.getElementById('phone')?.value || '',
                email: document.getElementById('email')?.value || '',
                login_id: document.getElementById('loginId')?.value || '',
                portal_enabled: document.getElementById('portalEnabled')?.value === 'true'
            };

            const password = document.getElementById('portalPassword')?.value;
            if (password) {
                data.password = password;
            }

            if (!data.name) {
                alert('업체명을 입력해주세요.');
                return;
            }

            try {
                const url = mode === 'add'
                    ? `${API_BASE_URL}/api/admin/suppliers`
                    : `${API_BASE_URL}/api/admin/suppliers/${supplierId}`;
                const method = mode === 'add' ? 'POST' : 'PUT';

                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                if (result.success) {
                    alert(mode === 'add' ? '협력업체가 추가되었습니다.' : '협력업체가 수정되었습니다.');
                    this.closeModal();
                    this.loadSuppliers(currentPage);
                } else {
                    alert(result.error || '저장에 실패했습니다.');
                }
            } catch (error) {
                console.error('협력업체 저장 오류:', error);
                alert('저장 중 오류가 발생했습니다.');
            }
        },

        // 모달 닫기
        closeModal() {
            const modal = document.getElementById('supplierModal');
            if (modal) modal.remove();
        },

        // 협력업체 데이터 로드
        async loadSupplierData(supplierId) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/suppliers/${supplierId}`);
                if (!response.ok) throw new Error('협력업체 정보 로드 실패');

                const result = await response.json();
                if (!result.success) throw new Error(result.error || '협력업체 정보 로드 실패');

                const supplier = result.data;

                // 폼 필드에 데이터 채우기
                const nameField = document.getElementById('supplierName');
                const codeField = document.getElementById('supplierCode');
                const deliveryCodeField = document.getElementById('supplierDeliveryCode');
                const businessNumberField = document.getElementById('businessNumber');
                const businessTypeField = document.getElementById('businessType');
                const representativeField = document.getElementById('representative');
                const phoneField = document.getElementById('phone');
                const emailField = document.getElementById('email');

                if (nameField) nameField.value = supplier.name || '';
                if (codeField) codeField.value = supplier.supplier_code || '';
                if (deliveryCodeField) deliveryCodeField.value = supplier.delivery_code || '';
                if (businessNumberField) businessNumberField.value = supplier.business_number || '';
                if (businessTypeField) businessTypeField.value = supplier.business_type || '';
                if (representativeField) representativeField.value = supplier.representative || '';
                if (phoneField) phoneField.value = supplier.phone || '';
                if (emailField) emailField.value = supplier.email || '';

                const loginIdField = document.getElementById('loginId');
                const portalEnabledField = document.getElementById('portalEnabled');
                if (loginIdField) loginIdField.value = supplier.login_id || '';
                if (portalEnabledField) portalEnabledField.value = supplier.portal_enabled ? 'true' : 'false';

            } catch (error) {
                console.error('협력업체 정보 로드 오류:', error);
                this.showAlert('협력업체 정보를 불러오는데 실패했습니다.', 'error');
            }
        },

        // 협력업체 상태 토글
        async toggleSupplierStatus(supplierId, newStatus) {
            const statusText = newStatus ? '활성화' : '비활성화';
            if (!confirm(`협력업체를 ${statusText}하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isActive: newStatus })
                });

                const result = await response.json();
                if (result.success) {
                    this.showAlert(`협력업체가 ${statusText}되었습니다.`, 'success');
                    this.loadSuppliers(currentPage);
                } else {
                    this.showAlert(`상태 변경 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('상태 변경 오류:', error);
                this.showAlert('상태 변경 중 오류가 발생했습니다.', 'error');
            }
        },

        // 협력업체 삭제
        async deleteSupplier(supplierId) {
            if (!confirm('정말로 이 협력업체를 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/suppliers/${supplierId}`, {
                    method: 'DELETE'
                });

                const result = await response.json();
                if (result.success !== false) {
                    this.showAlert('협력업체가 삭제되었습니다.', 'success');
                    this.loadSuppliers(currentPage);
                } else {
                    this.showAlert(`삭제 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('삭제 오류:', error);
                this.showAlert('삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 선택된 협력업체 벌크 삭제
        async bulkDelete() {
            if (!confirm(`선택한 ${selectedSuppliers.size}개의 협력업체를 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/bulk-delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ supplierIds: Array.from(selectedSuppliers) })
                });

                const result = await response.json();
                if (result.success) {
                    this.showAlert(`${result.deleted}개의 협력업체가 삭제되었습니다.`, 'success');
                    selectedSuppliers.clear();
                    this.updateBulkActions();
                    this.loadSuppliers(1);
                } else {
                    this.showAlert(`벌크 삭제 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('벌크 삭제 오류:', error);
                this.showAlert('벌크 삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 새 협력업체 추가 모달 표시
        showAddSupplierModal() {
            console.log('새 협력업체 추가 모달');
            this.showSupplierModal(null, 'add');
        },

        // ============================================
        // 휴무일 관리 기능
        // ============================================

        // 휴무일 통계 로드
        async loadBlackoutStats() {
            try {
                const today = new Date().toISOString().split('T')[0];
                const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

                // 현재 휴무중인 협력업체 수
                const currentResponse = await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/all?from_date=${today}&to_date=${today}`);
                const currentData = await currentResponse.json();
                if (currentData.success) {
                    document.getElementById('currentBlackouts').textContent = currentData.data.length;
                }

                // 향후 30일 내 예정된 휴무 수
                const upcomingResponse = await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/all?from_date=${today}&to_date=${nextMonth}`);
                const upcomingData = await upcomingResponse.json();
                if (upcomingData.success) {
                    // 현재 휴무 제외
                    const upcomingCount = upcomingData.data.filter(bp => bp.start_date > today).length;
                    document.getElementById('upcomingBlackouts').textContent = upcomingCount;
                }
            } catch (error) {
                console.error('휴무일 통계 로드 실패:', error);
            }
        },

        // 휴무일 관리 모달 표시
        async showBlackoutPeriodsModal() {
            const modalHtml = `
                <div id="blackoutModal" class="modal" style="display: flex;">
                    <div class="modal-content" style="max-width: 900px; width: 90%;">
                        <div class="modal-header">
                            <h2>📅 협력업체 휴무일 관리</h2>
                            <button class="close-btn" onclick="SuppliersManagementFull.closeBlackoutModal()">×</button>
                        </div>
                        <div class="modal-body">
                            <div class="blackout-controls" style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;">
                                <select id="blackoutSupplierSelect" style="padding: 8px; min-width: 200px;">
                                    <option value="">-- 협력업체 선택 --</option>
                                </select>
                                <input type="date" id="blackoutStartDate" style="padding: 8px;">
                                <span>~</span>
                                <input type="date" id="blackoutEndDate" style="padding: 8px;">
                                <input type="text" id="blackoutReason" placeholder="사유 (선택)" style="padding: 8px; flex: 1; min-width: 150px;">
                                <button class="btn btn-primary" onclick="SuppliersManagementFull.addBlackoutPeriod()">추가</button>
                            </div>
                            <div class="blackout-filter" style="margin-bottom: 15px;">
                                <label style="margin-right: 10px;">
                                    <input type="checkbox" id="showExpiredBlackouts" onchange="SuppliersManagementFull.loadAllBlackoutPeriods()">
                                    만료된 휴무일 포함
                                </label>
                            </div>
                            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                                <table class="data-table" style="width: 100%;">
                                    <thead style="position: sticky; top: 0; background: #fff;">
                                        <tr>
                                            <th>협력업체</th>
                                            <th>시작일</th>
                                            <th>종료일</th>
                                            <th>사유</th>
                                            <th>상태</th>
                                            <th>작업</th>
                                        </tr>
                                    </thead>
                                    <tbody id="blackoutTableBody">
                                        <tr><td colspan="6" style="text-align: center;">로딩 중...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // 기존 모달 제거
            const existingModal = document.getElementById('blackoutModal');
            if (existingModal) existingModal.remove();

            // 새 모달 추가
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // 협력업체 목록 로드
            await this.loadSuppliersForBlackout();
            // 휴무일 목록 로드
            await this.loadAllBlackoutPeriods();

            // 기본 날짜 설정 (오늘 ~ 일주일 후)
            const today = new Date().toISOString().split('T')[0];
            const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            document.getElementById('blackoutStartDate').value = today;
            document.getElementById('blackoutEndDate').value = nextWeek;
        },

        // 휴무일 모달 닫기
        closeBlackoutModal() {
            const modal = document.getElementById('blackoutModal');
            if (modal) modal.remove();
            // 통계 업데이트
            this.loadBlackoutStats();
        },

        // 협력업체 목록 로드 (휴무일 추가용)
        async loadSuppliersForBlackout() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/suppliers?limit=1000`);
                const data = await response.json();

                if (data.success) {
                    const select = document.getElementById('blackoutSupplierSelect');
                    select.innerHTML = '<option value="">-- 협력업체 선택 --</option>';
                    data.suppliers.forEach(supplier => {
                        select.innerHTML += `<option value="${supplier.id}">${supplier.name}</option>`;
                    });
                }
            } catch (error) {
                console.error('협력업체 목록 로드 실패:', error);
            }
        },

        // 모든 휴무일 목록 로드
        async loadAllBlackoutPeriods() {
            try {
                const showExpired = document.getElementById('showExpiredBlackouts')?.checked;
                const today = new Date().toISOString().split('T')[0];

                let url = `${API_BASE_URL}/api/suppliers/blackout-periods/all`;
                if (!showExpired) {
                    url += `?from_date=${today}`;
                }

                const response = await fetch(url);
                const data = await response.json();

                const tbody = document.getElementById('blackoutTableBody');
                if (!data.success || data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">등록된 휴무일이 없습니다</td></tr>';
                    return;
                }

                tbody.innerHTML = data.data.map(bp => {
                    const isExpired = bp.end_date < today;
                    const isCurrent = bp.start_date <= today && bp.end_date >= today;
                    const statusClass = isExpired ? 'expired' : (isCurrent ? 'current' : 'upcoming');
                    const statusText = isExpired ? '만료' : (isCurrent ? '휴무중' : '예정');

                    return `
                        <tr style="${isExpired ? 'opacity: 0.6;' : ''}">
                            <td><strong>${bp.supplier_name}</strong></td>
                            <td>${bp.start_date}</td>
                            <td>${bp.end_date}</td>
                            <td>${bp.reason || '-'}</td>
                            <td>
                                <span class="status-badge ${statusClass}" style="
                                    padding: 4px 8px;
                                    border-radius: 4px;
                                    font-size: 12px;
                                    ${statusClass === 'current' ? 'background: #fee2e2; color: #dc2626;' : ''}
                                    ${statusClass === 'upcoming' ? 'background: #fef3c7; color: #d97706;' : ''}
                                    ${statusClass === 'expired' ? 'background: #e5e7eb; color: #6b7280;' : ''}
                                ">
                                    ${statusText}
                                </span>
                            </td>
                            <td>
                                <div class="action-buttons" style="display: flex; gap: 5px;">
                                    <button class="btn-icon" onclick="SuppliersManagementFull.editBlackoutPeriod(${bp.id}, '${bp.start_date}', '${bp.end_date}', '${bp.reason || ''}')" title="수정">✏️</button>
                                    <button class="btn-icon btn-danger" onclick="SuppliersManagementFull.deleteBlackoutPeriod(${bp.id})" title="삭제">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (error) {
                console.error('휴무일 목록 로드 실패:', error);
            }
        },

        // 휴무일 추가
        async addBlackoutPeriod() {
            const supplierId = document.getElementById('blackoutSupplierSelect').value;
            const startDate = document.getElementById('blackoutStartDate').value;
            const endDate = document.getElementById('blackoutEndDate').value;
            const reason = document.getElementById('blackoutReason').value;

            if (!supplierId) {
                this.showAlert('협력업체를 선택해주세요.', 'error');
                return;
            }
            if (!startDate || !endDate) {
                this.showAlert('시작일과 종료일을 입력해주세요.', 'error');
                return;
            }
            if (startDate > endDate) {
                this.showAlert('종료일은 시작일 이후여야 합니다.', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/blackout-periods`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ start_date: startDate, end_date: endDate, reason })
                });

                const data = await response.json();
                if (data.success) {
                    this.showAlert('휴무일이 등록되었습니다.', 'success');
                    // 입력 초기화
                    document.getElementById('blackoutReason').value = '';
                    // 목록 새로고침
                    await this.loadAllBlackoutPeriods();
                } else {
                    this.showAlert('휴무일 등록 실패: ' + data.error, 'error');
                }
            } catch (error) {
                console.error('휴무일 등록 실패:', error);
                this.showAlert('휴무일 등록 중 오류가 발생했습니다.', 'error');
            }
        },

        // 휴무일 수정
        async editBlackoutPeriod(periodId, startDate, endDate, reason) {
            const newStartDate = prompt('시작일 (YYYY-MM-DD):', startDate);
            if (newStartDate === null) return;

            const newEndDate = prompt('종료일 (YYYY-MM-DD):', endDate);
            if (newEndDate === null) return;

            const newReason = prompt('사유:', reason);
            if (newReason === null) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/${periodId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start_date: newStartDate,
                        end_date: newEndDate,
                        reason: newReason
                    })
                });

                const data = await response.json();
                if (data.success) {
                    this.showAlert('휴무일이 수정되었습니다.', 'success');
                    await this.loadAllBlackoutPeriods();
                } else {
                    this.showAlert('휴무일 수정 실패: ' + data.error, 'error');
                }
            } catch (error) {
                console.error('휴무일 수정 실패:', error);
                this.showAlert('휴무일 수정 중 오류가 발생했습니다.', 'error');
            }
        },

        // 휴무일 삭제
        async deleteBlackoutPeriod(periodId) {
            if (!confirm('이 휴무일을 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/${periodId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();
                if (data.success) {
                    this.showAlert('휴무일이 삭제되었습니다.', 'success');
                    await this.loadAllBlackoutPeriods();
                } else {
                    this.showAlert('휴무일 삭제 실패: ' + data.error, 'error');
                }
            } catch (error) {
                console.error('휴무일 삭제 실패:', error);
                this.showAlert('휴무일 삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // ============================================
        // 달력 기반 휴무일 관리
        // ============================================
        _calendarState: {
            supplierId: null,
            supplierName: '',
            currentYear: new Date().getFullYear(),
            currentMonth: new Date().getMonth(),
            blackoutDates: {},  // 'YYYY-MM-DD' -> { id, reason }
            isDragging: false,
            dragStart: null,
            dragEnd: null,
            dragMode: null  // 'add' or 'remove'
        },

        // 특정 협력업체의 휴무일 관리 (달력 UI)
        async showSupplierBlackoutModal(supplierId, supplierName) {
            const cs = this._calendarState;
            cs.supplierId = supplierId;
            cs.supplierName = supplierName;
            cs.currentYear = new Date().getFullYear();
            cs.currentMonth = new Date().getMonth();
            cs.blackoutDates = {};

            const modalHtml = `
                <div id="supplierBlackoutModal" class="modal" style="display: flex;">
                    <div class="modal-content" style="max-width: 800px; width: 95%;">
                        <div class="modal-header">
                            <h2>📅 ${supplierName} 주문불가일 관리</h2>
                            <button class="close-btn" onclick="document.getElementById('supplierBlackoutModal').remove()">×</button>
                        </div>
                        <div class="modal-body" style="padding: 20px;">
                            <!-- 달력 네비게이션 -->
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <button class="btn btn-sm" onclick="SuppliersManagementFull.calendarNav(-1)" style="padding: 6px 12px;">◀ 이전달</button>
                                <h3 id="calendarTitle" style="margin: 0; font-size: 1.2rem;"></h3>
                                <button class="btn btn-sm" onclick="SuppliersManagementFull.calendarNav(1)" style="padding: 6px 12px;">다음달 ▶</button>
                            </div>
                            <!-- 사유 입력 -->
                            <div style="display: flex; gap: 10px; margin-bottom: 15px; align-items: center;">
                                <label style="font-size: 13px; color: #555; white-space: nowrap;">사유:</label>
                                <input type="text" id="calendarBlackoutReason" placeholder="휴무, 재고정리, 명절 등" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
                                <span style="font-size: 12px; color: #888;">날짜 클릭 또는 드래그로 선택</span>
                            </div>
                            <!-- 달력 그리드 -->
                            <div id="calendarGrid" style="user-select: none;"></div>
                            <!-- 범례 -->
                            <div style="display: flex; gap: 15px; margin-top: 12px; font-size: 12px; color: #666;">
                                <span><span style="display: inline-block; width: 14px; height: 14px; background: #fee2e2; border: 1px solid #fc8181; border-radius: 3px; vertical-align: middle; margin-right: 4px;"></span>주문불가일</span>
                                <span><span style="display: inline-block; width: 14px; height: 14px; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 3px; vertical-align: middle; margin-right: 4px;"></span>드래그 선택중</span>
                                <span><span style="display: inline-block; width: 14px; height: 14px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 3px; vertical-align: middle; margin-right: 4px;"></span>오늘</span>
                            </div>
                            <!-- 등록된 휴무일 목록 -->
                            <div style="margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                                <h4 style="margin: 0 0 10px; font-size: 0.95rem; color: #374151;">등록된 주문불가일</h4>
                                <div style="max-height: 200px; overflow-y: auto;">
                                    <table class="data-table" style="width: 100%; font-size: 13px;">
                                        <thead>
                                            <tr>
                                                <th>시작일</th>
                                                <th>종료일</th>
                                                <th>사유</th>
                                                <th>상태</th>
                                                <th>작업</th>
                                            </tr>
                                        </thead>
                                        <tbody id="singleBlackoutTableBody">
                                            <tr><td colspan="5" style="text-align: center;">로딩 중...</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const existingModal = document.getElementById('supplierBlackoutModal');
            if (existingModal) existingModal.remove();

            document.body.insertAdjacentHTML('beforeend', modalHtml);

            await this.loadBlackoutDatesForCalendar(supplierId);
            this.renderCalendar();
            await this.loadSingleSupplierBlackouts(supplierId);
        },

        // 달력 월 이동
        calendarNav(delta) {
            const cs = this._calendarState;
            cs.currentMonth += delta;
            if (cs.currentMonth > 11) { cs.currentMonth = 0; cs.currentYear++; }
            if (cs.currentMonth < 0) { cs.currentMonth = 11; cs.currentYear--; }
            this.renderCalendar();
        },

        // 달력에 표시할 휴무일 데이터 로드
        async loadBlackoutDatesForCalendar(supplierId) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/blackout-periods?include_expired=true`);
                const data = await response.json();
                const cs = this._calendarState;
                cs.blackoutDates = {};

                if (data.success && data.data) {
                    data.data.forEach(bp => {
                        // 날짜 범위를 개별 날짜로 확장
                        const start = new Date(bp.start_date + 'T00:00:00');
                        const end = new Date(bp.end_date + 'T00:00:00');
                        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                            const key = d.toISOString().split('T')[0];
                            cs.blackoutDates[key] = { id: bp.id, reason: bp.reason || '' };
                        }
                    });
                }
            } catch (error) {
                console.error('휴무일 데이터 로드 실패:', error);
            }
        },

        // 달력 렌더링
        renderCalendar() {
            const cs = this._calendarState;
            const container = document.getElementById('calendarGrid');
            if (!container) return;

            const year = cs.currentYear;
            const month = cs.currentMonth;
            const titleEl = document.getElementById('calendarTitle');
            if (titleEl) titleEl.textContent = `${year}년 ${month + 1}월`;

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const todayStr = new Date().toISOString().split('T')[0];

            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            let html = '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">';

            // 요일 헤더
            dayNames.forEach((name, i) => {
                const color = i === 0 ? '#dc3545' : (i === 6 ? '#0d6efd' : '#374151');
                html += `<div style="text-align: center; font-weight: 600; padding: 8px 4px; font-size: 13px; color: ${color};">${name}</div>`;
            });

            // 빈 칸
            for (let i = 0; i < firstDay; i++) {
                html += '<div></div>';
            }

            // 날짜 셀
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isBlackout = !!cs.blackoutDates[dateStr];
                const isToday = dateStr === todayStr;
                const isInDrag = cs.isDragging && this._isDateInDragRange(dateStr);
                const dayOfWeek = new Date(year, month, day).getDay();

                let bg = 'white';
                let border = '1px solid #e5e7eb';
                let fontColor = dayOfWeek === 0 ? '#dc3545' : (dayOfWeek === 6 ? '#0d6efd' : '#1f2937');

                if (isBlackout) {
                    bg = '#fee2e2';
                    border = '1px solid #fc8181';
                    fontColor = '#991b1b';
                }
                if (isInDrag) {
                    bg = cs.dragMode === 'add' ? '#dbeafe' : '#fef3c7';
                    border = cs.dragMode === 'add' ? '1px solid #93c5fd' : '1px solid #fcd34d';
                }
                if (isToday) {
                    border = '2px solid #22c55e';
                }

                const reason = isBlackout ? cs.blackoutDates[dateStr].reason : '';
                const tooltip = reason ? ` title="${reason}"` : '';

                html += `<div data-date="${dateStr}"${tooltip}
                    onmousedown="SuppliersManagementFull.calendarMouseDown('${dateStr}')"
                    onmouseenter="SuppliersManagementFull.calendarMouseEnter('${dateStr}')"
                    onmouseup="SuppliersManagementFull.calendarMouseUp()"
                    style="
                        text-align: center; padding: 10px 4px; cursor: pointer;
                        border-radius: 6px; font-size: 14px; font-weight: 500;
                        background: ${bg}; border: ${border}; color: ${fontColor};
                        transition: background 0.1s;
                        position: relative;
                    ">
                    ${day}
                    ${isBlackout ? '<div style="width: 6px; height: 6px; background: #dc3545; border-radius: 50%; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);"></div>' : ''}
                </div>`;
            }

            html += '</div>';
            container.innerHTML = html;
        },

        _isDateInDragRange(dateStr) {
            const cs = this._calendarState;
            if (!cs.dragStart || !cs.dragEnd) return false;
            const d = dateStr;
            const start = cs.dragStart < cs.dragEnd ? cs.dragStart : cs.dragEnd;
            const end = cs.dragStart < cs.dragEnd ? cs.dragEnd : cs.dragStart;
            return d >= start && d <= end;
        },

        calendarMouseDown(dateStr) {
            const cs = this._calendarState;
            cs.isDragging = true;
            cs.dragStart = dateStr;
            cs.dragEnd = dateStr;
            // 이미 휴무일이면 제거 모드, 아니면 추가 모드
            cs.dragMode = cs.blackoutDates[dateStr] ? 'remove' : 'add';
            this.renderCalendar();

            // mouseup 이벤트를 document에 등록 (드래그 범위 밖에서 놓을 경우 대비)
            const handler = () => {
                this.calendarMouseUp();
                document.removeEventListener('mouseup', handler);
            };
            document.addEventListener('mouseup', handler);
        },

        calendarMouseEnter(dateStr) {
            const cs = this._calendarState;
            if (!cs.isDragging) return;
            cs.dragEnd = dateStr;
            this.renderCalendar();
        },

        async calendarMouseUp() {
            const cs = this._calendarState;
            if (!cs.isDragging) return;
            cs.isDragging = false;

            const start = cs.dragStart < cs.dragEnd ? cs.dragStart : cs.dragEnd;
            const end = cs.dragStart < cs.dragEnd ? cs.dragEnd : cs.dragStart;

            if (cs.dragMode === 'add') {
                await this.addBlackoutRange(cs.supplierId, start, end);
            } else {
                await this.removeBlackoutRange(cs.supplierId, start, end);
            }

            cs.dragStart = null;
            cs.dragEnd = null;
        },

        // 휴무일 범위 추가
        async addBlackoutRange(supplierId, startDate, endDate) {
            const reason = document.getElementById('calendarBlackoutReason')?.value || '';
            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/blackout-periods`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ start_date: startDate, end_date: endDate, reason })
                });
                const data = await response.json();
                if (data.success) {
                    this.showAlert('주문불가일이 등록되었습니다.', 'success');
                    await this.loadBlackoutDatesForCalendar(supplierId);
                    this.renderCalendar();
                    await this.loadSingleSupplierBlackouts(supplierId);
                } else {
                    this.showAlert('등록 실패: ' + data.error, 'error');
                }
            } catch (error) {
                this.showAlert('등록 중 오류가 발생했습니다.', 'error');
            }
        },

        // 휴무일 범위 제거 (해당 범위에 걸친 모든 period 삭제)
        async removeBlackoutRange(supplierId, startDate, endDate) {
            const cs = this._calendarState;
            // 범위 내 날짜들의 period ID 수집
            const idsToDelete = new Set();
            const s = new Date(startDate + 'T00:00:00');
            const e = new Date(endDate + 'T00:00:00');
            for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                const key = d.toISOString().split('T')[0];
                if (cs.blackoutDates[key]) {
                    idsToDelete.add(cs.blackoutDates[key].id);
                }
            }

            if (idsToDelete.size === 0) return;

            try {
                for (const id of idsToDelete) {
                    await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/${id}`, { method: 'DELETE' });
                }
                this.showAlert(`${idsToDelete.size}건의 주문불가일이 삭제되었습니다.`, 'success');
                await this.loadBlackoutDatesForCalendar(supplierId);
                this.renderCalendar();
                await this.loadSingleSupplierBlackouts(supplierId);
            } catch (error) {
                this.showAlert('삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 특정 협력업체 휴무일 목록 로드 (테이블)
        async loadSingleSupplierBlackouts(supplierId) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/blackout-periods?include_expired=true`);
                const data = await response.json();

                const tbody = document.getElementById('singleBlackoutTableBody');
                const today = new Date().toISOString().split('T')[0];

                if (!data.success || data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">등록된 주문불가일이 없습니다</td></tr>';
                    return;
                }

                tbody.innerHTML = data.data.map(bp => {
                    const isExpired = bp.end_date < today;
                    const isCurrent = bp.start_date <= today && bp.end_date >= today;
                    const statusText = isExpired ? '만료' : (isCurrent ? '휴무중' : '예정');
                    const statusStyle = isExpired ? 'background: #e5e7eb; color: #6b7280;' :
                                       (isCurrent ? 'background: #fee2e2; color: #dc2626;' : 'background: #fef3c7; color: #d97706;');

                    return `
                        <tr style="${isExpired ? 'opacity: 0.6;' : ''}">
                            <td>${bp.start_date}</td>
                            <td>${bp.end_date}</td>
                            <td>${bp.reason || '-'}</td>
                            <td><span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; ${statusStyle}">${statusText}</span></td>
                            <td>
                                <button class="btn-icon btn-danger" onclick="SuppliersManagementFull.deleteSingleBlackout(${bp.id}, ${supplierId})" title="삭제">🗑️</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (error) {
                console.error('휴무일 목록 로드 실패:', error);
            }
        },

        // 특정 협력업체 휴무일 삭제
        async deleteSingleBlackout(periodId, supplierId) {
            if (!confirm('이 주문불가일을 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/suppliers/blackout-periods/${periodId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();
                if (data.success) {
                    this.showAlert('주문불가일이 삭제되었습니다.', 'success');
                    await this.loadBlackoutDatesForCalendar(supplierId);
                    this.renderCalendar();
                    await this.loadSingleSupplierBlackouts(supplierId);
                } else {
                    this.showAlert('삭제 실패: ' + data.error, 'error');
                }
            } catch (error) {
                this.showAlert('삭제 중 오류가 발생했습니다.', 'error');
            }
        }
    };

    console.log('🏢 Full Suppliers Management Module 정의 완료');

})();