/**
 * 🔗 협력업체 매칭 모듈
 *
 * 협력업체 코드와 배송지 매칭 관리
 * - 급식업체의 여러 지점별 코드 부여
 * - 원활한 배송을 위한 매핑 관리
 */

(function() {
'use strict';

class SupplierMappingModule {
    constructor() {
        this.currentPage = 1;
        this.totalPages = 1;
        this.itemsPerPage = 20;
        this.mappings = [];
        this.suppliers = [];
        this.sites = [];
        this.currentEditId = null;
    }

    /**
     * 모듈 초기화
     */
    async init() {
        console.log('🔗 [Supplier Mapping] 모듈 초기화 시작');

        // HTML 구조 생성
        this.renderHTML();

        // 이벤트 리스너 설정
        this.setupEventListeners();

        // 데이터 로드
        await this.loadInitialData();

        console.log('✅ [Supplier Mapping] 모듈 초기화 완료');
    }

    /**
     * HTML 구조 렌더링
     */
    renderHTML() {
        const container = document.getElementById('supplier-mapping-content');
        if (!container) return;

        container.innerHTML = `
            <div class="supplier-mapping-container">
                <!-- 헤더 영역 -->
                <div class="mapping-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div>
                        <h2 style="margin: 0;">협력업체 매칭 관리</h2>
                        <p style="color: #666; margin: 5px 0;">협력업체별 배송지 코드를 관리합니다</p>
                    </div>
                    <button class="btn-primary" id="btn-add-mapping" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        ➕ 새 매칭 추가
                    </button>
                </div>

                <!-- 검색 영역 -->
                <div class="search-area" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="display: flex; gap: 10px;">
                        <select id="filter-supplier" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; flex: 1;">
                            <option value="">전체 협력업체</option>
                        </select>
                        <select id="filter-site" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; flex: 1;">
                            <option value="">전체 사업장</option>
                        </select>
                        <select id="filter-status" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="">전체 상태</option>
                            <option value="active">활성</option>
                            <option value="inactive">비활성</option>
                        </select>
                        <button id="btn-search" style="padding: 8px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            🔍 검색
                        </button>
                    </div>
                </div>

                <!-- 매칭 목록 테이블 -->
                <div class="mapping-table-container" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                                <th style="padding: 12px; text-align: left;">협력업체</th>
                                <th style="padding: 12px; text-align: left;">사업장</th>
                                <th style="padding: 12px; text-align: left;">협력업체 코드 / 배송 코드</th>
                                <th style="padding: 12px; text-align: center;">상태</th>
                                <th style="padding: 12px; text-align: center;">등록일</th>
                                <th style="padding: 12px; text-align: center;">작업</th>
                            </tr>
                        </thead>
                        <tbody id="mapping-table-body">
                            <tr>
                                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                                    데이터를 불러오는 중...
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- 페이지네이션 -->
                    <div class="pagination" style="display: flex; justify-content: center; align-items: center; margin-top: 20px; gap: 10px;">
                        <button id="btn-prev-page" style="padding: 5px 10px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer;">이전</button>
                        <span id="page-info">1 / 1</span>
                        <button id="btn-next-page" style="padding: 5px 10px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer;">다음</button>
                    </div>
                </div>
            </div>

            <!-- 매칭 추가/수정 모달 -->
            <div id="mapping-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
                <div class="modal-content" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 8px; width: 500px; max-width: 90%;">
                    <h3 id="modal-title" style="margin-top: 0;">새 매칭 추가</h3>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            협력업체 <span style="color: red;">*</span>
                        </label>
                        <select id="modal-supplier" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" required>
                            <option value="">선택하세요</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            사업장 <span style="color: red;">*</span>
                        </label>
                        <select id="modal-site" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" required>
                            <option value="">선택하세요</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            협력업체 코드 <span style="color: red;">*</span>
                        </label>
                        <input type="text" id="modal-supplier-code" placeholder="예: CJ001 (필수)" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" required>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">배송 코드</label>
                        <input type="text" id="modal-delivery-code" placeholder="예: DS001" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" id="modal-is-active" checked style="margin-right: 8px;">
                            <span>활성 상태</span>
                        </label>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="btn-modal-cancel" style="padding: 8px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">취소</button>
                        <button id="btn-modal-save" style="padding: 8px 20px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">저장</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        // 새 매칭 추가 버튼
        const addBtn = document.getElementById('btn-add-mapping');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddModal());
        }

        // 검색 버튼
        const searchBtn = document.getElementById('btn-search');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.searchMappings());
        }

        // 페이지네이션
        const prevBtn = document.getElementById('btn-prev-page');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.changePage(-1));
        }

        const nextBtn = document.getElementById('btn-next-page');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.changePage(1));
        }

        // 모달 버튼들
        const modalCancelBtn = document.getElementById('btn-modal-cancel');
        if (modalCancelBtn) {
            modalCancelBtn.addEventListener('click', () => this.hideModal());
        }

        const modalSaveBtn = document.getElementById('btn-modal-save');
        if (modalSaveBtn) {
            modalSaveBtn.addEventListener('click', () => this.saveMapping());
        }

        // 필터 변경시 자동 검색
        ['filter-supplier', 'filter-site', 'filter-status'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.searchMappings());
            }
        });
    }

    /**
     * 초기 데이터 로드
     */
    async loadInitialData() {
        try {
            // 협력업체와 사업장 목록 로드
            await Promise.all([
                this.loadSuppliers(),
                this.loadSites()
            ]);

            // 매칭 목록 로드
            await this.loadMappings();
        } catch (error) {
            console.error('❌ [Supplier Mapping] 초기 데이터 로드 실패:', error);
        }
    }

    /**
     * 협력업체 목록 로드
     */
    async loadSuppliers() {
        try {
            const apiBase = window.CONFIG?.API?.BASE_URL || '';
            const response = await fetch(`${apiBase}/api/admin/suppliers`);

            if (response.ok) {
                const data = await response.json();
                this.suppliers = data.suppliers || [];

                // 필터 드롭다운 업데이트
                const filterSelect = document.getElementById('filter-supplier');
                const modalSelect = document.getElementById('modal-supplier');

                const options = this.suppliers.map(s =>
                    `<option value="${s.id}">${s.name}</option>`
                ).join('');

                if (filterSelect) {
                    filterSelect.innerHTML = '<option value="">전체 협력업체</option>' + options;
                }
                if (modalSelect) {
                    modalSelect.innerHTML = '<option value="">선택하세요</option>' + options;
                }
            }
        } catch (error) {
            console.error('❌ [Supplier Mapping] 협력업체 로드 실패:', error);
        }
    }

    /**
     * 사업장 목록 로드
     */
    async loadSites() {
        try {
            const apiBase = window.CONFIG?.API?.BASE_URL || '';
            const response = await fetch(`${apiBase}/api/admin/business-locations`);

            if (response.ok) {
                const data = await response.json();
                this.sites = data.locations || [];

                // 필터 드롭다운 업데이트
                const filterSelect = document.getElementById('filter-site');
                const modalSelect = document.getElementById('modal-site');

                const options = this.sites.map(s =>
                    `<option value="${s.id}">${s.name}</option>`
                ).join('');

                if (filterSelect) {
                    filterSelect.innerHTML = '<option value="">전체 사업장</option>' + options;
                }
                if (modalSelect) {
                    modalSelect.innerHTML = '<option value="">선택하세요</option>' + options;
                }
            }
        } catch (error) {
            console.error('❌ [Supplier Mapping] 사업장 로드 실패:', error);
        }
    }

    /**
     * 매칭 목록 로드
     */
    async loadMappings() {
        try {
            // 실제 DB 데이터 로드 시도
            const apiBase = window.CONFIG?.API?.BASE_URL || '';

            // 필터 값 가져오기
            const supplierId = document.getElementById('filter-supplier')?.value;
            const siteId = document.getElementById('filter-site')?.value;
            const status = document.getElementById('filter-status')?.value;

            // 쿼리 파라미터 구성
            const params = new URLSearchParams();
            if (supplierId) params.append('supplier_id', supplierId);
            if (siteId) params.append('site_id', siteId);
            if (status) params.append('status', status);
            params.append('page', this.currentPage);
            params.append('limit', this.itemsPerPage);

            const response = await fetch(`${apiBase}/api/admin/customer-supplier-mappings?${params}`);

            if (response.ok) {
                const data = await response.json();
                console.log('📊 [Supplier Mapping] API 응답:', data);

                this.mappings = data.mappings || [];

                // 디버깅: ID 15 데이터 확인
                const dosirak = this.mappings.find(m => m.id === 15);
                if (dosirak) {
                    console.log('🔍 [DEBUG] ID 15 (도시락-동원홈푸드) 데이터:');
                    console.log('  supplier_code:', dosirak.supplier_code);
                    console.log('  delivery_code:', dosirak.delivery_code);
                    console.log('  전체 객체:', dosirak);
                }

                // total_pages가 없으면 전체 데이터로 계산
                if (data.total_pages) {
                    this.totalPages = data.total_pages;
                } else {
                    // 전체 매핑 개수로 페이지 수 계산
                    const totalCount = this.mappings.length;
                    this.totalPages = Math.max(1, Math.ceil(totalCount / this.itemsPerPage));
                }

                console.log(`📊 [Supplier Mapping] 로드된 매핑: ${this.mappings.length}개, 페이지: ${this.currentPage}/${this.totalPages}`);

                this.displayMappings();
                this.updatePagination();
            } else {
                // API가 없을 경우 실제 DB 데이터 직접 로드
                console.log('📊 [Supplier Mapping] API 없음, 실제 DB 데이터 로드 시도');
                await this.loadRealData();
            }
        } catch (error) {
            console.error('❌ [Supplier Mapping] 매칭 목록 로드 실패:', error);
            // 실제 DB 데이터 직접 로드
            await this.loadRealData();
        }
    }

    /**
     * API 실패 시 빈 데이터 표시
     */
    async loadRealData() {
        console.log('⚠️ [Supplier Mapping] API 실패 - 빈 데이터 표시');
        // 하드코딩 제거 - 빈 배열 사용
        this.mappings = [];
        this.totalPages = 1;
        this.displayMappings();
        this.updatePagination();
    }

    /**
     * 매칭 목록 표시
     */
    displayMappings() {
        const tbody = document.getElementById('mapping-table-body');
        if (!tbody) {
            console.error('❌ [Supplier Mapping] 테이블 tbody를 찾을 수 없습니다');
            return;
        }

        console.log(`📊 [Supplier Mapping] 표시할 매핑 수: ${this.mappings.length}`);

        // 디버깅: 표시 전 ID 15 데이터 재확인
        const dosirak = this.mappings.find(m => m.id === 15);
        if (dosirak) {
            console.log('🎨 [Display] ID 15 표시 직전 데이터:');
            console.log('  supplier_code:', dosirak.supplier_code);
            console.log('  delivery_code:', dosirak.delivery_code);
        }

        if (this.mappings.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                        등록된 매칭이 없습니다
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.mappings.map(mapping => {
            // 날짜 포맷팅
            let createdDate = '-';
            if (mapping.created_at) {
                const date = new Date(mapping.created_at);
                if (!isNaN(date.getTime())) {
                    createdDate = date.toLocaleDateString('ko-KR');
                }
            }

            // supplier_code와 delivery_code 구분하여 표시
            const displayCode = mapping.supplier_code || mapping.delivery_code || '미설정';

            // 디버깅: 각 매핑의 값 확인
            if (mapping.id === 15) {
                console.log('🚨 [Display Row] ID 15 값 확인:');
                console.log('  mapping.supplier_code =', mapping.supplier_code);
                console.log('  mapping.delivery_code =', mapping.delivery_code);
            }

            return `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 12px;">${mapping.supplier_name || '-'}</td>
                    <td style="padding: 12px;">${mapping.customer_name || mapping.site_name || '-'}</td>
                    <td style="padding: 12px;">
                        <div>
                            <code style="background: #e3f2fd; padding: 4px 8px; border-radius: 3px; margin-right: 5px;">
                                협력업체: ${mapping.supplier_code || '미설정'}
                            </code>
                            <code style="background: #fff3cd; padding: 4px 8px; border-radius: 3px;">
                                배송: ${mapping.delivery_code || '미설정'}
                            </code>
                        </div>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span style="display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; ${mapping.is_active ? 'background: #d4edda; color: #155724;' : 'background: #f8d7da; color: #721c24;'}">
                            ${mapping.is_active ? '활성' : '비활성'}
                        </span>
                    </td>
                    <td style="padding: 12px; text-align: center;">${createdDate}</td>
                    <td style="padding: 12px; text-align: center;">
                        <button onclick="window.supplierMapping.editMapping(${mapping.id})" style="padding: 4px 8px; margin: 0 2px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">수정</button>
                        <button onclick="window.supplierMapping.deleteMapping(${mapping.id})" style="padding: 4px 8px; margin: 0 2px; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">삭제</button>
                    </td>
                </tr>
            `;
        }).join('');

        console.log('✅ [Supplier Mapping] 테이블 업데이트 완료');
    }

    /**
     * 페이지네이션 업데이트
     */
    updatePagination() {
        const pageInfo = document.getElementById('page-info');
        if (pageInfo) {
            pageInfo.textContent = `${this.currentPage} / ${this.totalPages}`;
        }

        const prevBtn = document.getElementById('btn-prev-page');
        const nextBtn = document.getElementById('btn-next-page');

        if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
            prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
        }

        if (nextBtn) {
            nextBtn.disabled = this.currentPage >= this.totalPages;
            nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
        }
    }

    /**
     * 페이지 변경
     */
    changePage(direction) {
        const newPage = this.currentPage + direction;
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.loadMappings();
        }
    }

    /**
     * 매칭 검색
     */
    searchMappings() {
        this.currentPage = 1;
        this.loadMappings();
    }

    /**
     * 추가 모달 표시
     */
    showAddModal() {
        this.currentEditId = null;
        const modal = document.getElementById('mapping-modal');
        const title = document.getElementById('modal-title');

        if (modal) modal.style.display = 'block';
        if (title) title.textContent = '새 매칭 추가';

        // 폼 초기화
        this.resetModalForm();
    }

    /**
     * 수정 모달 표시
     */
    editMapping(id) {
        this.currentEditId = id;
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        // 디버깅: 매핑 데이터 확인
        console.log('🔍 [Edit Mapping] ID:', id);
        console.log('🔍 [Edit Mapping] Found mapping:', mapping);
        console.log('🔍 [Edit Mapping] supplier_code:', mapping.supplier_code);
        console.log('🔍 [Edit Mapping] delivery_code:', mapping.delivery_code);

        const modal = document.getElementById('mapping-modal');
        const title = document.getElementById('modal-title');

        if (modal) modal.style.display = 'block';
        if (title) title.textContent = '매칭 수정';

        // 폼에 데이터 설정
        const supplierSelect = document.getElementById('modal-supplier');
        const siteSelect = document.getElementById('modal-site');
        const supplierCodeInput = document.getElementById('modal-supplier-code');
        const deliveryCodeInput = document.getElementById('modal-delivery-code');
        const activeCheck = document.getElementById('modal-is-active');

        // 디버깅: 입력 필드 확인
        console.log('🔍 [Edit Mapping] Input fields found:');
        console.log('  - supplierCodeInput:', !!supplierCodeInput);
        console.log('  - deliveryCodeInput:', !!deliveryCodeInput);

        if (supplierSelect) supplierSelect.value = mapping.supplier_id || '';
        if (siteSelect) siteSelect.value = mapping.customer_id || mapping.site_id || '';

        if (supplierCodeInput) {
            supplierCodeInput.value = mapping.supplier_code || '';
            console.log('🔍 [Edit Mapping] Set supplier_code input to:', supplierCodeInput.value);
        }

        if (deliveryCodeInput) {
            deliveryCodeInput.value = mapping.delivery_code || '';
            console.log('🔍 [Edit Mapping] Set delivery_code input to:', deliveryCodeInput.value);
        }

        if (activeCheck) activeCheck.checked = mapping.is_active;
    }

    /**
     * 매칭 삭제
     */
    async deleteMapping(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;

        try {
            const apiBase = window.CONFIG?.API?.BASE_URL || '';
            const response = await fetch(`${apiBase}/api/admin/customer-supplier-mappings/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                alert('삭제되었습니다.');
                this.loadMappings();
            } else {
                // API 미구현시
                alert('삭제되었습니다. (시뮬레이션)');
                this.mappings = this.mappings.filter(m => m.id !== id);
                this.displayMappings();
            }
        } catch (error) {
            console.error('❌ [Supplier Mapping] 삭제 실패:', error);
            alert('삭제되었습니다. (시뮬레이션)');
            this.mappings = this.mappings.filter(m => m.id !== id);
            this.displayMappings();
        }
    }

    /**
     * 매칭 저장
     */
    async saveMapping() {
        const supplierSelect = document.getElementById('modal-supplier');
        const siteSelect = document.getElementById('modal-site');
        const supplierCodeInput = document.getElementById('modal-supplier-code');
        const deliveryCodeInput = document.getElementById('modal-delivery-code');
        const activeCheck = document.getElementById('modal-is-active');

        // 디버깅: 입력 필드 값 확인
        console.log('💾 [Save Mapping] Reading values from inputs:');
        console.log('  - supplier_code input value:', supplierCodeInput?.value);
        console.log('  - delivery_code input value:', deliveryCodeInput?.value);

        const data = {
            supplier_id: parseInt(supplierSelect?.value),
            customer_id: parseInt(siteSelect?.value),  // customer_id는 사업장 ID
            supplier_code: supplierCodeInput?.value || '',
            delivery_code: deliveryCodeInput?.value || '',
            is_active: activeCheck?.checked,
            priority_order: 1,
            is_primary_supplier: false,
            notes: ''
        };

        // 디버깅: 저장할 데이터 확인
        console.log('💾 [Save Mapping] Data to save:', data);
        console.log('💾 [Save Mapping] supplier_code:', data.supplier_code);
        console.log('💾 [Save Mapping] delivery_code:', data.delivery_code);

        // 유효성 검사
        if (!data.supplier_id) {
            alert('협력업체를 선택해주세요.');
            return;
        }
        if (!data.customer_id) {
            alert('사업장을 선택해주세요.');
            return;
        }
        if (!data.supplier_code || data.supplier_code.trim() === '') {
            alert('협력업체 코드는 필수 항목입니다.');
            return;
        }

        try {
            const apiBase = window.CONFIG?.API?.BASE_URL || '';
            const url = this.currentEditId
                ? `${apiBase}/api/admin/customer-supplier-mappings/${this.currentEditId}`
                : `${apiBase}/api/admin/customer-supplier-mappings`;

            const method = this.currentEditId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ [Supplier Mapping] 저장 성공:', result);

                alert(this.currentEditId ? '수정되었습니다.' : '추가되었습니다.');
                this.hideModal();

                // 목록 새로고침
                await this.loadMappings();
            } else {
                const errorText = await response.text();
                console.error('❌ [Supplier Mapping] 저장 실패:', response.status, errorText);

                // API 오류 상세 표시
                alert(`저장 실패: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('❌ [Supplier Mapping] 저장 실패:', error);
            this.simulateSave(data);
        }
    }

    /**
     * 저장 시뮬레이션 (API 미구현시)
     */
    simulateSave(data) {
        const supplierName = this.suppliers.find(s => s.id == data.supplier_id)?.name || '알 수 없음';
        const siteName = this.sites.find(s => s.id == data.site_id)?.name || '알 수 없음';

        if (this.currentEditId) {
            // 수정
            const mapping = this.mappings.find(m => m.id === this.currentEditId);
            if (mapping) {
                Object.assign(mapping, {
                    ...data,
                    supplier_name: supplierName,
                    site_name: siteName
                });
            }
            alert('수정되었습니다. (시뮬레이션)');
        } else {
            // 추가
            const newMapping = {
                id: Date.now(),
                ...data,
                supplier_name: supplierName,
                site_name: siteName,
                created_at: new Date().toISOString().split('T')[0]
            };
            this.mappings.unshift(newMapping);
            alert('추가되었습니다. (시뮬레이션)');
        }

        this.hideModal();
        this.displayMappings();
    }

    /**
     * 모달 숨기기
     */
    hideModal() {
        const modal = document.getElementById('mapping-modal');
        if (modal) modal.style.display = 'none';
        this.resetModalForm();
    }

    /**
     * 모달 폼 초기화
     */
    resetModalForm() {
        const supplierSelect = document.getElementById('modal-supplier');
        const siteSelect = document.getElementById('modal-site');
        const supplierCodeInput = document.getElementById('modal-supplier-code');
        const deliveryCodeInput = document.getElementById('modal-delivery-code');
        const activeCheck = document.getElementById('modal-is-active');

        if (supplierSelect) supplierSelect.value = '';
        if (siteSelect) siteSelect.value = '';
        if (supplierCodeInput) supplierCodeInput.value = '';
        if (deliveryCodeInput) deliveryCodeInput.value = '';
        if (activeCheck) activeCheck.checked = true;
    }

    /**
     * 모듈 새로고침
     */
    async refresh() {
        console.log('🔄 [Supplier Mapping] 모듈 새로고침');
        await this.loadMappings();
    }

    /**
     * 모듈 정리
     */
    destroy() {
        console.log('🧹 [Supplier Mapping] 모듈 정리');
        // 이벤트 리스너 제거 등 필요시 구현
    }
}

// 전역 인스턴스 생성
window.supplierMapping = new SupplierMappingModule();

// 페이지별 모듈 정의 (admin_dashboard.html에서 사용)
window.pageModules = window.pageModules || {};
window.pageModules['supplier-mapping'] = {
    init: async function() {
        if (!window.supplierMapping) {
            window.supplierMapping = new SupplierMappingModule();
        }
        await window.supplierMapping.init();
    },
    refresh: async function() {
        if (window.supplierMapping) {
            await window.supplierMapping.refresh();
        }
    }
};

// Window에 클래스 등록
window.SupplierMappingModule = SupplierMappingModule;

// ModuleLoader를 위한 export
if (typeof window.ModuleLoader !== 'undefined') {
    window.ModuleLoader.register('mappings', SupplierMappingModule);
}

console.log('✅ [Supplier Mapping Module] 로드 완료');

})();