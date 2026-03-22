/**
 * 협력업체 관리 모듈
 * admin 대시보드용 완전한 협력업체 관리 기능
 */

(function() {
'use strict';

// 관리자 대시보드와 호환성을 위해 두 이름 모두 지원
window.SupplierManagement = window.SuppliersModule = {
    API_BASE_URL: window.CONFIG?.API?.BASE_URL || window.CONFIG?.API_BASE_URL || '',
    currentSupplierId: null,
    isEditMode: false,
    isLoaded: false,

    // 모듈 초기화
    async init() {
        console.log('🚀 [SupplierManagement] 협력업체 관리 모듈 초기화');
        await this.load();
        return this;
    },

    async load() {
        if (this.isLoaded) return;
        console.log('🚀 [SupplierManagement] 협력업체 관리 모듈 로드');

        // CONFIG 설정 확인
        if (window.CONFIG?.API?.BASE_URL) {
            this.API_BASE_URL = window.CONFIG.API.BASE_URL;
        }

        // 페이지 컨텐츠 영역에 협력업체 관리 HTML 구조 생성
        await this.renderSupplierManagementHTML();

        this.setupEventListeners();
        await this.loadSupplierStats();
        await this.loadSuppliers();

        this.isLoaded = true;
    },

    setupEventListeners() {
        // 검색 입력 시 실시간 검색
        const searchInput = document.getElementById('searchSupplierInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce(() => this.loadSuppliers(), 500));
        }

        // 모달 외부 클릭 시 닫기
        const modal = document.getElementById('supplierModal');
        if (modal) {
            modal.addEventListener('click', function(event) {
                if (event.target === modal) {
                    closeSupplierModal();
                }
            });
        }

        // 활성 상태 필터 변경 시
        const statusFilter = document.getElementById('supplierStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.loadSuppliers());
        }

        // 협력업체 폼 제출
        const supplierForm = document.getElementById('supplierForm');
        if (supplierForm) {
            supplierForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }

        // 모달 외부 클릭 시 닫기
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('supplierModal');
            if (event.target === modal) {
                this.closeModal();
            }
        });
    },

    // 디바운스 함수
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 협력업체 통계 로드
    async loadSupplierStats() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers/stats`);
            if (!response.ok) throw new Error('통계 로드 실패');

            const data = await response.json();

            const totalSuppliersElement = document.getElementById('totalSuppliers');
            const activeSuppliersElement = document.getElementById('activeSuppliers');

            if (totalSuppliersElement) totalSuppliersElement.textContent = data.total || data.stats?.total_suppliers || '0';
            if (activeSuppliersElement) activeSuppliersElement.textContent = data.active || data.stats?.active_suppliers || '0';
        } catch (error) {
            console.error('협력업체 통계 로드 오류:', error);
            const totalSuppliersElement = document.getElementById('totalSuppliers');
            const activeSuppliersElement = document.getElementById('activeSuppliers');

            if (totalSuppliersElement) totalSuppliersElement.textContent = '오류';
            if (activeSuppliersElement) activeSuppliersElement.textContent = '오류';
        }
    },

    // 협력업체 목록 로드
    async loadSuppliers(page = 1) {
        try {
            this.showLoading(true);

            const search = document.getElementById('searchSupplierInput')?.value || '';
            const status = document.getElementById('supplierStatusFilter')?.value || '';

            const params = new URLSearchParams({
                page: page.toString(),
                limit: '10'
            });

            if (search) params.append('search', search);
            if (status) params.append('status', status);

            const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers?${params}`);
            if (!response.ok) throw new Error('협력업체 목록 로드 실패');

            const data = await response.json();

            this.renderSuppliersTable(data.suppliers || []);
            this.renderPagination(data.pagination);

        } catch (error) {
            console.error('협력업체 목록 로드 오류:', error);
            this.showError('협력업체 목록을 불러오는데 실패했습니다.');
        } finally {
            this.showLoading(false);
        }
    },

    // 협력업체 테이블 렌더링
    renderSuppliersTable(suppliers) {
        const tbody = document.getElementById('suppliersTableBody');
        const table = document.getElementById('suppliersTable');
        const emptyState = document.getElementById('supplierEmptyState');

        if (!tbody) return;

        // API에서 받은 실제 데이터 사용
        const displaySuppliers = suppliers;

        if (!displaySuppliers || displaySuppliers.length === 0) {
            if (table) table.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (table) table.style.display = 'table';
        if (emptyState) emptyState.style.display = 'none';

        tbody.innerHTML = displaySuppliers.map(supplier => `
            <tr>
                <td><input type="checkbox" class="supplier-checkbox" data-supplier-id="${supplier.id}"></td>
                <td>${this.escapeHtml(supplier.supplier_code || supplier.code || '-')}</td>
                <td>
                    <div class="supplier-info">
                        <strong>${this.escapeHtml(supplier.name || '')}</strong>
                    </div>
                </td>
                <td>${this.escapeHtml(supplier.businessType || supplier.business_type || '-')}</td>
                <td>${this.escapeHtml(supplier.delivery_code || '-')}</td>
                <td>${this.escapeHtml(supplier.headquarters_address || '-')}</td>
                <td>${this.escapeHtml(supplier.representative || '-')}</td>
                <td>${this.escapeHtml(supplier.phone || supplier.headquarters_phone || supplier.contact || '-')}</td>
                <td>${this.escapeHtml(supplier.email || '-')}</td>
                <td>
                    <span style="font-family: monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">
                        ${this.escapeHtml(supplier.login_id || supplier.supplier_code || '-')}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm" style="background:#6366f1;color:#fff;border:none;font-size:11px;padding:4px 8px;"
                            onclick="window.SupplierManagement.resetPassword(${supplier.id}, '${this.escapeHtml(supplier.name || '')}')">
                        🔑 초기화
                    </button>
                </td>
                <td><span class="status-badge status-${supplier.is_active ? 'active' : 'inactive'}">${supplier.is_active ? '활성' : '비활성'}</span></td>
                <td>
                    <div class="actions">
                        <button class="btn btn-sm btn-primary" onclick="editSupplier(${supplier.id})">수정</button>
                        ${supplier.is_active !== false && supplier.is_active !== 0 ?
                            `<button class="btn btn-sm btn-warning" style="background:#f59e0b;color:#fff;border:none;" onclick="window.SupplierManagement.deactivateSupplier(${supplier.id})">비활성화</button>` :
                            `<button class="btn btn-sm btn-success" style="background:#10b981;color:#fff;border:none;" onclick="window.SupplierManagement.activateSupplier(${supplier.id})">활성화</button>`
                        }
                    </div>
                </td>
            </tr>
        `).join('');
    },

    // 비밀번호 초기화
    async resetPassword(supplierId, supplierName) {
        const newPassword = prompt(`${supplierName}의 새 비밀번호를 입력하세요 (기본값: 1234):`, '1234');
        if (newPassword === null) return; // 취소

        try {
            const response = await fetch('/api/supplier/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplier_id: supplierId,
                    new_password: newPassword || '1234'
                })
            });
            const result = await response.json();
            if (result.success) {
                alert(`${supplierName}의 비밀번호가 초기화되었습니다.`);
            } else {
                alert('비밀번호 초기화 실패: ' + result.error);
            }
        } catch (error) {
            alert('오류 발생: ' + error.message);
        }
    },

    // 모든 협력업체 계정 초기화
    async initAllAccounts() {
        if (!confirm('모든 협력업체의 로그인 계정을 초기화하시겠습니까?\n\n로그인ID: 업체코드\n비밀번호: 1234')) return;

        try {
            const response = await fetch('/api/supplier/init-all-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                alert(result.message);
                this.loadSuppliers(); // 목록 새로고침
            } else {
                alert('초기화 실패: ' + result.error);
            }
        } catch (error) {
            alert('오류 발생: ' + error.message);
        }
    },

    // 페이지네이션 렌더링
    renderPagination(pagination) {
        const container = document.getElementById('supplierPagination');
        if (!container || !pagination) return;

        let html = '';

        // 이전 페이지 버튼
        html += `<button ${!pagination.has_prev ? 'disabled' : ''} onclick="window.supplierManagement.loadSuppliers(${pagination.current_page - 1})">이전</button>`;

        // 페이지 번호들
        const startPage = Math.max(1, pagination.current_page - 2);
        const endPage = Math.min(pagination.total_pages, pagination.current_page + 2);

        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="${i === pagination.current_page ? 'active' : ''}" onclick="window.supplierManagement.loadSuppliers(${i})">${i}</button>`;
        }

        // 다음 페이지 버튼
        html += `<button ${!pagination.has_next ? 'disabled' : ''} onclick="window.supplierManagement.loadSuppliers(${pagination.current_page + 1})">다음</button>`;

        container.innerHTML = html;
    },

    // 날짜 포맷팅
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR');
    },

    // HTML 이스케이프
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    },

    // 협력업체 추가 모달 열기
    openCreateModal() {
        this.currentSupplierId = null;
        this.isEditMode = false;

        const modalTitle = document.getElementById('supplierModalTitle');
        const submitBtn = document.getElementById('supplierSubmitBtn');
        const supplierForm = document.getElementById('supplierForm');
        const supplierModal = document.getElementById('supplierModal');
        const supplierCode = document.getElementById('supplierCode');

        if (modalTitle) modalTitle.textContent = '협력업체 추가';
        if (submitBtn) submitBtn.textContent = '추가';
        if (supplierForm) supplierForm.reset();
        // 새 협력업체 생성 시 업체코드 입력 가능하게
        if (supplierCode) {
            supplierCode.removeAttribute('readonly');
            supplierCode.placeholder = '예: CJ001, GS002';
        }
        if (supplierModal) supplierModal.style.display = 'block';
    },

    // 협력업체 수정 모달 열기
    async editSupplier(supplierId) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers/${supplierId}`);
            if (!response.ok) throw new Error('협력업체 정보 로드 실패');

            const result = await response.json();
            if (!result.success) throw new Error(result.error || '협력업체 정보 로드 실패');

            const supplier = result.data;

            this.currentSupplierId = supplierId;
            this.isEditMode = true;

            const modalTitle = document.getElementById('supplierModalTitle');
            const submitBtn = document.getElementById('supplierSubmitBtn');
            const supplierModal = document.getElementById('supplierModal');

            if (modalTitle) modalTitle.textContent = '협력업체 수정';
            if (submitBtn) submitBtn.textContent = '수정';

            // 폼에 데이터 채우기 (새로운 데이터 구조에 맞게)
            const nameField = document.getElementById('supplierName');
            const codeField = document.getElementById('supplierCode');
            const deliveryCodeField = document.getElementById('supplierDeliveryCode');
            const contactField = document.getElementById('supplierContact');
            const addressField = document.getElementById('supplierAddress');
            const phoneField = document.getElementById('supplierPhone');
            const emailField = document.getElementById('supplierEmail');
            const ingredientCountField = document.getElementById('supplierIngredientCount');
            const avgPriceField = document.getElementById('supplierAvgPrice');

            if (nameField) nameField.value = supplier.name || '';
            if (codeField) {
                codeField.value = supplier.supplier_code || '';
                // 업체코드가 비어있으면 수정 가능, 있으면 readonly
                if (supplier.supplier_code) {
                    codeField.setAttribute('readonly', true);
                } else {
                    codeField.removeAttribute('readonly');
                    codeField.placeholder = '업체코드를 입력하세요';
                }
            }
            if (deliveryCodeField) deliveryCodeField.value = supplier.delivery_code || '';
            if (contactField) contactField.value = supplier.contact || '';
            if (addressField) addressField.value = supplier.address || '';
            if (phoneField) phoneField.value = supplier.phone || '';
            if (emailField) emailField.value = supplier.email || '';
            if (ingredientCountField) ingredientCountField.value = supplier.ingredient_count || 0;
            if (avgPriceField) avgPriceField.value = supplier.avg_price || 0;

            if (supplierModal) supplierModal.style.display = 'block';

        } catch (error) {
            console.error('협력업체 정보 로드 오류:', error);
            this.showError('협력업체 정보를 불러오는데 실패했습니다.');
        }
    },

    // 모달 닫기
    closeModal() {
        const supplierModal = document.getElementById('supplierModal');
        const supplierForm = document.getElementById('supplierForm');

        if (supplierModal) supplierModal.style.display = 'none';
        if (supplierForm) supplierForm.reset();
    },

    // 협력업체 폼 제출
    async handleFormSubmit(e) {
        if (e) e.preventDefault();

        // 폼 요소 직접 가져오기 (버튼 클릭 시 e.target이 버튼이므로)
        const form = document.getElementById('supplierForm');
        if (!form) {
            console.error('supplierForm을 찾을 수 없습니다.');
            return;
        }

        const formData = new FormData(form);
        const supplierData = {
            name: formData.get('name'),
            supplier_code: formData.get('supplier_code'),
            delivery_code: formData.get('delivery_code'),
            contact: formData.get('contact'),
            address: formData.get('address'),
            phone: formData.get('phone'),
            email: formData.get('email')
        };

        try {
            const url = this.isEditMode
                ? `${this.API_BASE_URL}/api/admin/suppliers/${this.currentSupplierId}`
                : `${this.API_BASE_URL}/api/admin/suppliers`;

            const method = this.isEditMode ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(supplierData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || '요청 처리 실패');
            }

            this.showSuccess(this.isEditMode ? '협력업체가 수정되었습니다.' : '협력업체가 추가되었습니다.');
            this.closeModal();
            await this.loadSuppliers();
            await this.loadSupplierStats();

        } catch (error) {
            console.error('협력업체 저장 오류:', error);

            // 사용자 친화적인 오류 메시지 처리
            let errorMessage = error.message;

            if (errorMessage.includes('사업자번호')) {
                errorMessage = '사업자번호가 중복됩니다. 다른 번호를 입력하거나 비워두세요.';
            } else if (errorMessage.includes('협력업체 이름')) {
                errorMessage = '협력업체명이 중복됩니다. 다른 이름을 사용해 주세요.';
            }

            this.showError(`협력업체 ${this.isEditMode ? '수정' : '추가'} 실패: ${errorMessage}`);
        }
    },

    // ★ 메뉴 캐시 전체 삭제 (협력업체 상태 변경 시 호출)
    clearAllMenuCaches() {
        const keysToRemove = Object.keys(localStorage).filter(k =>
            k.includes('menus_cache') || k.includes('meal_plan_menus')
        );
        keysToRemove.forEach(k => localStorage.removeItem(k));
        console.log(`🗑️ 메뉴 캐시 ${keysToRemove.length}개 삭제됨`);
    },

    // 협력업체 비활성화
    async deactivateSupplier(supplierId) {
        if (!confirm('정말로 이 협력업체를 비활성화하시겠습니까?')) {
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers/${supplierId}/deactivate`, {
                method: 'PUT'
            });

            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '비활성화 실패');

            // ★ 메뉴 캐시 삭제 (거래중단 상태 갱신 위해)
            this.clearAllMenuCaches();

            alert('협력업체가 비활성화되었습니다. 메뉴 캐시가 갱신되었습니다.');
            await this.loadSuppliers();
            await this.loadSupplierStats();

        } catch (error) {
            console.error('협력업체 비활성화 오류:', error);
            alert('협력업체 비활성화에 실패했습니다: ' + error.message);
        }
    },

    // 협력업체 활성화
    async activateSupplier(supplierId) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers/${supplierId}/activate`, {
                method: 'PUT'
            });

            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '활성화 실패');

            // ★ 메뉴 캐시 삭제 (거래중단 상태 갱신 위해)
            this.clearAllMenuCaches();

            alert('협력업체가 활성화되었습니다. 메뉴 캐시가 갱신되었습니다.');
            await this.loadSuppliers();
            await this.loadSupplierStats();

        } catch (error) {
            console.error('협력업체 활성화 오류:', error);
            alert('협력업체 활성화에 실패했습니다: ' + error.message);
        }
    },

    // 로딩 표시
    showLoading(show) {
        const loadingIndicator = document.getElementById('supplierLoadingIndicator');
        const table = document.getElementById('suppliersTable');

        if (loadingIndicator) {
            loadingIndicator.style.display = show ? 'block' : 'none';
        }
        if (table) {
            table.style.display = show ? 'none' : 'table';
        }
    },

    // 성공 메시지 표시
    showSuccess(message) {
        this.showAlert(message, 'success');
    },

    // 오류 메시지 표시
    showError(message) {
        this.showAlert(message, 'error');
    },

    // 알림 메시지 표시
    showAlert(message, type = 'success') {
        const container = document.getElementById('supplierAlertContainer');
        if (!container) return;

        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;

        container.appendChild(alert);

        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
    },

    // 협력업체 관리 HTML 구조 생성
    async renderSupplierManagementHTML() {
        // suppliers-content가 이미 HTML에 있는지 확인
        let suppliersContent = document.getElementById('suppliers-content');
        if (!suppliersContent) {
            console.error('suppliers-content element not found');
            return;
        }

        const supplierHTML = `
            <div class="supplier-management-container">

                    <!-- 알림 컨테이너 -->
                    <div id="supplierAlertContainer"></div>

                    <!-- 통계 카드들 -->
                    <div class="dashboard-grid" style="margin-bottom: 2rem;">
                        <div class="dashboard-card">
                            <div class="card-header">
                                <span class="icon">🚛</span>
                                <h3 class="card-title">전체 협력업체</h3>
                            </div>
                            <div class="card-content">
                                <div class="stat-number" id="totalSuppliers">-</div>
                                <div class="stat-label">등록된 협력업체 수</div>
                            </div>
                        </div>

                        <div class="dashboard-card">
                            <div class="card-header">
                                <span class="icon">✅</span>
                                <h3 class="card-title">활성 협력업체</h3>
                            </div>
                            <div class="card-content">
                                <div class="stat-number" id="activeSuppliers">-</div>
                                <div class="stat-label">현재 활성 상태</div>
                            </div>
                        </div>

                        <div class="dashboard-card">
                            <div class="card-header">
                                <span class="icon">🚫</span>
                                <h3 class="card-title">현재 휴무중</h3>
                            </div>
                            <div class="card-content">
                                <div class="stat-number" id="currentBlackouts">-</div>
                                <div class="stat-label">휴무 협력업체</div>
                            </div>
                        </div>

                        <div class="dashboard-card">
                            <div class="card-header">
                                <span class="icon">📅</span>
                                <h3 class="card-title">예정 휴무</h3>
                            </div>
                            <div class="card-content">
                                <div class="stat-number" id="upcomingBlackouts">-</div>
                                <div class="stat-label">30일 내 예정</div>
                            </div>
                        </div>
                    </div>

                    <!-- 컨트롤 패널 -->
                    <div class="controls">
                        <div class="search-container">
                            <input type="text" id="searchSupplierInput" placeholder="협력업체명, 코드, 사업자번호로 검색...">
                        </div>

                        <div class="filter-container">
                            <select id="supplierStatusFilter">
                                <option value="">전체 상태</option>
                                <option value="active">활성</option>
                                <option value="inactive">비활성</option>
                            </select>

                            <button class="btn btn-secondary" onclick="SupplierManagement.showBlackoutModal()" style="margin-right: 8px;">
                                📅 휴무일 관리
                            </button>
                            <button class="btn btn-primary" onclick="openCreateSupplierModal()">
                                + 협력업체 추가
                            </button>
                        </div>
                    </div>

                    <!-- 로딩 인디케이터 -->
                    <div id="supplierLoadingIndicator" class="loading-indicator" style="display: none;">
                        <div class="spinner"></div>
                        <p>데이터를 불러오는 중...</p>
                    </div>

                    <!-- 협력업체 테이블 -->
                    <div class="data-table">
                        <table id="suppliersTable">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="selectAllSuppliers"></th>
                                    <th>ID</th>
                                    <th>업체명</th>
                                    <th>업종</th>
                                    <th>배송코드</th>
                                    <th>지역</th>
                                    <th>대표자</th>
                                    <th>연락처</th>
                                    <th>이메일</th>
                                    <th>로그인ID</th>
                                    <th>비밀번호</th>
                                    <th>상태</th>
                                    <th>작업</th>
                                </tr>
                            </thead>
                            <tbody id="suppliersTableBody">
                                <!-- 동적으로 생성됨 -->
                            </tbody>
                        </table>
                    </div>

                    <!-- 빈 상태 -->
                    <div id="supplierEmptyState" class="empty-state" style="display: none;">
                        <div class="icon">🚛</div>
                        <h3>등록된 협력업체가 없습니다</h3>
                        <p>새로운 협력업체를 추가해보세요.</p>
                        <button class="btn btn-primary" onclick="openCreateSupplierModal()">
                            첫 번째 협력업체 추가
                        </button>
                    </div>

                    <!-- 페이지네이션 -->
                    <div id="supplierPagination" class="pagination"></div>
                </div>
            </div>

            <!-- 협력업체 추가/수정 모달 -->
            <style>
                #supplierModal .modal-content {
                    max-height: 85vh !important;
                    margin: 2% auto !important;
                    width: 680px !important;
                }
                #supplierModal .modal-header {
                    padding: 12px 16px !important;
                    border-bottom: 1px solid #e0e0e0;
                }
                #supplierModal .modal-header h3 {
                    font-size: 18px !important;
                    margin: 0;
                    font-weight: 600;
                }
                #supplierModal .modal-body {
                    padding: 16px !important;
                    max-height: calc(85vh - 120px) !important;
                    overflow-y: auto !important;
                }
                #supplierModal .modal-footer {
                    padding: 12px 16px !important;
                    text-align: right;
                    border-top: 1px solid #e0e0e0;
                }
                #supplierModal .form-group {
                    margin-bottom: 12px !important;
                }
                #supplierModal .form-group label {
                    margin-bottom: 4px !important;
                    font-size: 13px !important;
                    font-weight: 500;
                    display: block;
                    color: #333;
                }
                #supplierModal input,
                #supplierModal textarea {
                    padding: 8px 12px !important;
                    font-size: 14px !important;
                    height: 38px !important;
                    width: 100%;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                #supplierModal textarea {
                    height: 70px !important;
                    resize: vertical;
                }
                #supplierModal .btn {
                    padding: 8px 16px !important;
                    font-size: 14px !important;
                }
                #supplierModal .close {
                    font-size: 24px !important;
                    line-height: 18px !important;
                }
            </style>
            <div id="supplierModal" class="modal" onclick="if(event.target === this) return false;">
                <div class="modal-content" onmousedown="event.stopPropagation();">
                    <div class="modal-header">
                        <h3 id="supplierModalTitle">협력업체 추가</h3>
                        <span class="close" onclick="closeSupplierModal()">&times;</span>
                    </div>

                    <div class="modal-body">
                        <form id="supplierForm">
                            <div class="form-group">
                                <label for="supplierName">업체명 *</label>
                                <input type="text" id="supplierName" name="name" required>
                            </div>

                            <div class="form-group">
                                <label for="supplierCode">업체코드</label>
                                <input type="text" id="supplierCode" name="supplier_code">
                            </div>

                            <div class="form-group">
                                <label for="supplierBusinessNumber">사업자번호</label>
                                <input type="text" id="supplierBusinessNumber" name="business_number">
                            </div>

                            <div class="form-group">
                                <label for="supplierRepresentative">대표자</label>
                                <input type="text" id="supplierRepresentative" name="representative">
                            </div>

                            <div class="form-group">
                                <label for="supplierAddress">주소</label>
                                <input type="text" id="supplierAddress" name="headquarters_address">
                            </div>

                            <div class="form-group">
                                <label for="supplierPhone">전화번호</label>
                                <input type="tel" id="supplierPhone" name="headquarters_phone">
                            </div>

                            <div class="form-group">
                                <label for="supplierEmail">이메일</label>
                                <input type="email" id="supplierEmail" name="email">
                            </div>

                            <div class="form-group">
                                <label for="supplierNotes">비고</label>
                                <textarea id="supplierNotes" name="notes"></textarea>
                            </div>
                        </form>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeSupplierModal()">취소</button>
                        <button type="button" class="btn btn-primary" onclick="saveSupplierWithoutAlert()">저장</button>
                    </div>
                </div>
            </div>
        `;

        // suppliers-content 영역에만 내용을 추가
        suppliersContent.innerHTML = supplierHTML;
    },
};

console.log('🚀 Complete Supplier Management Module 정의 완료');

// 전역 함수들 (onclick 핸들러용)
window.openCreateSupplierModal = function() {
    if (window.SupplierManagement) {
        window.SupplierManagement.openCreateModal();
    }
};

window.closeSupplierModal = function() {
    const modal = document.getElementById('supplierModal');
    if (modal) {
        modal.style.display = 'none';
        // 폼 초기화
        const form = document.getElementById('supplierForm');
        if (form) form.reset();
        // 상태 초기화
        if (window.SupplierManagement) {
            window.SupplierManagement.isEditMode = false;
            window.SupplierManagement.currentSupplierId = null;
        }
    }
};

window.loadSuppliers = function() {
    if (window.SupplierManagement) {
        window.SupplierManagement.loadSuppliers();
    }
};

window.saveSupplierWithoutAlert = function() {
    console.log('Save supplier without alert');
    if (window.SupplierManagement) {
        const form = document.getElementById('supplierForm');
        if (!form) return;

        // 필드명 매핑 수정
        const supplierData = {
            name: document.getElementById('supplierName').value,
            supplier_code: document.getElementById('supplierCode').value,
            business_number: document.getElementById('supplierBusinessNumber').value,
            representative: document.getElementById('supplierRepresentative').value,
            headquarters_address: document.getElementById('supplierAddress').value,
            headquarters_phone: document.getElementById('supplierPhone').value,
            email: document.getElementById('supplierEmail').value,
            notes: document.getElementById('supplierNotes').value
        };

        console.log('Supplier data to save:', supplierData);
        console.log('Edit mode:', window.SupplierManagement.isEditMode);
        console.log('Current supplier ID:', window.SupplierManagement.currentSupplierId);

        const url = window.SupplierManagement.isEditMode
            ? `${window.SupplierManagement.API_BASE_URL}/api/admin/suppliers/${window.SupplierManagement.currentSupplierId}`
            : `${window.SupplierManagement.API_BASE_URL}/api/admin/suppliers`;

        const method = window.SupplierManagement.isEditMode ? 'PUT' : 'POST';

        console.log('Request URL:', url);
        console.log('Request method:', method);

        fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(supplierData)
        })
        .then(res => {
            console.log('Response status:', res.status);
            if (!res.ok) {
                return res.json().then(data => {
                    throw new Error(data.detail || data.error || '알 수 없는 오류');
                });
            }
            return res.json();
        })
        .then(data => {
            console.log('Response data:', data);
            // API 응답 성공 시 모달 닫고 목록 새로고침
            closeSupplierModal();
            window.SupplierManagement.loadSuppliers();
            window.SupplierManagement.loadSupplierStats();
        })
        .catch(err => {
            console.error('Save error:', err);

            // 사용자 친화적인 오류 메시지
            let errorMessage = err.message || '저장 중 오류가 발생했습니다.';

            // 사업자번호 중복 오류 처리
            if (errorMessage.includes('사업자번호')) {
                errorMessage = '📝 사업자번호 중복 오류\n\n' +
                    '동일한 사업자번호가 이미 등록되어 있습니다.\n' +
                    '해결 방법:\n' +
                    '1. 다른 사업자번호를 입력하거나\n' +
                    '2. 사업자번호를 비워두세요';
            }
            // 협력업체명 중복 오류 처리
            else if (errorMessage.includes('협력업체 이름')) {
                errorMessage = '🏪 협력업체명 중복 오류\n\n' +
                    '동일한 협력업체명이 이미 등록되어 있습니다.\n' +
                    '다른 이름을 사용해 주세요.';
            }
            // UNIQUE constraint 오류 처리
            else if (errorMessage.includes('UNIQUE constraint')) {
                errorMessage = '⚠️ 중복 데이터 오류\n\n' +
                    '입력하신 정보 중 중복된 값이 있습니다.\n' +
                    '사업자번호나 협력업체명을 확인해 주세요.';
            }

            alert(errorMessage);
        });
    }
};

window.editSupplier = function(supplierId) {
    console.log('Edit supplier called:', supplierId);
    if (window.SupplierManagement) {
        // API를 통해 협력업체 정보 가져오기
        window.SupplierManagement.editSupplier(supplierId);
    }
};

// ============================================
// 휴무일 관리 기능 추가
// ============================================

// 휴무일 통계 로드
window.SupplierManagement.loadBlackoutStats = async function() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // 현재 휴무중인 협력업체 수
        const currentResponse = await fetch(`${this.API_BASE_URL}/api/suppliers/blackout-periods/all?from_date=${today}&to_date=${today}`);
        const currentData = await currentResponse.json();
        if (currentData.success) {
            const el = document.getElementById('currentBlackouts');
            if (el) el.textContent = currentData.data.length;
        }

        // 향후 30일 내 예정된 휴무 수
        const upcomingResponse = await fetch(`${this.API_BASE_URL}/api/suppliers/blackout-periods/all?from_date=${today}&to_date=${nextMonth}`);
        const upcomingData = await upcomingResponse.json();
        if (upcomingData.success) {
            const upcomingCount = upcomingData.data.filter(bp => bp.start_date > today).length;
            const el = document.getElementById('upcomingBlackouts');
            if (el) el.textContent = upcomingCount;
        }
    } catch (error) {
        console.error('휴무일 통계 로드 실패:', error);
    }
};

// 휴무일 관리 모달 표시
window.SupplierManagement.showBlackoutModal = async function() {
    const modalHtml = `
        <div id="blackoutModal" class="modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; justify-content: center; align-items: center;">
            <div class="modal-content" style="background: white; padding: 20px; border-radius: 8px; max-width: 900px; width: 90%; max-height: 80vh; overflow-y: auto;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                    <h3 style="margin: 0;">📅 협력업체 휴무일 관리</h3>
                    <button onclick="SupplierManagement.closeBlackoutModal()" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;">
                        <select id="blackoutSupplierSelect" style="padding: 8px; min-width: 200px; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="">-- 협력업체 선택 --</option>
                        </select>
                        <input type="date" id="blackoutStartDate" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <span>~</span>
                        <input type="date" id="blackoutEndDate" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <input type="text" id="blackoutReason" placeholder="사유 (선택)" style="padding: 8px; flex: 1; min-width: 150px; border: 1px solid #ddd; border-radius: 4px;">
                        <button class="btn btn-primary" onclick="SupplierManagement.addBlackoutPeriod()" style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">추가</button>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="cursor: pointer;">
                            <input type="checkbox" id="showExpiredBlackouts" onchange="SupplierManagement.loadAllBlackoutPeriods()">
                            만료된 휴무일 포함
                        </label>
                    </div>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; background: #f5f5f5;">
                                <tr>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">협력업체</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">시작일</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">종료일</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">사유</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">상태</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">작업</th>
                                </tr>
                            </thead>
                            <tbody id="blackoutTableBody">
                                <tr><td colspan="6" style="padding: 20px; text-align: center;">로딩 중...</td></tr>
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

    // 기본 날짜 설정
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    document.getElementById('blackoutStartDate').value = today;
    document.getElementById('blackoutEndDate').value = nextWeek;
};

// 휴무일 모달 닫기
window.SupplierManagement.closeBlackoutModal = function() {
    const modal = document.getElementById('blackoutModal');
    if (modal) modal.remove();
    this.loadBlackoutStats();
};

// 협력업체 목록 로드 (휴무일 추가용)
window.SupplierManagement.loadSuppliersForBlackout = async function() {
    try {
        const response = await fetch(`${this.API_BASE_URL}/api/admin/suppliers?limit=1000`);
        const data = await response.json();

        if (data.success) {
            const suppliers = data.suppliers || data.data || [];
            const select = document.getElementById('blackoutSupplierSelect');
            select.innerHTML = '<option value="">-- 협력업체 선택 --</option>';
            suppliers.forEach(supplier => {
                select.innerHTML += `<option value="${supplier.id}">${supplier.name}</option>`;
            });
        }
    } catch (error) {
        console.error('협력업체 목록 로드 실패:', error);
    }
};

// 모든 휴무일 목록 로드
window.SupplierManagement.loadAllBlackoutPeriods = async function() {
    try {
        const showExpired = document.getElementById('showExpiredBlackouts')?.checked;
        const today = new Date().toISOString().split('T')[0];

        let url = `${this.API_BASE_URL}/api/suppliers/blackout-periods/all`;
        if (!showExpired) {
            url += `?from_date=${today}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        const tbody = document.getElementById('blackoutTableBody');
        if (!data.success || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center;">등록된 휴무일이 없습니다</td></tr>';
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
                    <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${bp.supplier_name}</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${bp.start_date}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${bp.end_date}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${bp.reason || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">
                        <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; ${statusStyle}">${statusText}</span>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">
                        <button onclick="SupplierManagement.deleteBlackoutPeriod(${bp.id})" style="background: #fee2e2; color: #dc2626; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">삭제</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('휴무일 목록 로드 실패:', error);
    }
};

// 휴무일 추가
window.SupplierManagement.addBlackoutPeriod = async function() {
    const supplierId = document.getElementById('blackoutSupplierSelect').value;
    const startDate = document.getElementById('blackoutStartDate').value;
    const endDate = document.getElementById('blackoutEndDate').value;
    const reason = document.getElementById('blackoutReason').value;

    if (!supplierId) {
        alert('협력업체를 선택해주세요.');
        return;
    }
    if (!startDate || !endDate) {
        alert('시작일과 종료일을 입력해주세요.');
        return;
    }
    if (startDate > endDate) {
        alert('종료일은 시작일 이후여야 합니다.');
        return;
    }

    try {
        const response = await fetch(`${this.API_BASE_URL}/api/suppliers/${supplierId}/blackout-periods`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: startDate, end_date: endDate, reason })
        });

        const data = await response.json();
        if (data.success) {
            alert('휴무일이 등록되었습니다.');
            document.getElementById('blackoutReason').value = '';
            await this.loadAllBlackoutPeriods();
        } else {
            alert('휴무일 등록 실패: ' + data.error);
        }
    } catch (error) {
        console.error('휴무일 등록 실패:', error);
        alert('휴무일 등록 중 오류가 발생했습니다.');
    }
};

// 휴무일 삭제
window.SupplierManagement.deleteBlackoutPeriod = async function(periodId) {
    if (!confirm('이 휴무일을 삭제하시겠습니까?')) return;

    try {
        const response = await fetch(`${this.API_BASE_URL}/api/suppliers/blackout-periods/${periodId}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        if (data.success) {
            alert('휴무일이 삭제되었습니다.');
            await this.loadAllBlackoutPeriods();
        } else {
            alert('휴무일 삭제 실패: ' + data.error);
        }
    } catch (error) {
        console.error('휴무일 삭제 실패:', error);
        alert('휴무일 삭제 중 오류가 발생했습니다.');
    }
};

// 모듈 초기화 시 휴무일 통계도 로드
const originalLoad = window.SupplierManagement.load;
window.SupplierManagement.load = async function() {
    await originalLoad.call(this);
    await this.loadBlackoutStats();
};

})(); // IIFE 종료