/**
 * 완전한 협력업체 매핑 관리 모듈
 * - admin_dashboard.html에서 추출한 모든 협력업체 매핑 관리 기능
 * - 기존 화면과 100% 동일한 기능 제공
 */

window.MappingsModule = {
    currentPage: 1,
    totalPages: 1,
    editingMappingId: null,
    suppliersCache: [],
    customersCache: [],

    // 모듈 초기화
    async init() {
        console.log('🔗 Complete Mappings Module 초기화');
        await this.loadMappingData();
        this.setupEventListeners();
        return this;
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        // 검색 엔터키 처리
        const searchInput = document.getElementById('mapping-search');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchMappings();
                }
            });
        }
    },

    // 매핑 목록 로드
    async loadMappingData() {
        try {
            console.log('[LoadMappings] 매핑 목록 로드 시작...');
            const response = await fetch('http://localhost:9000/api/admin/customer-supplier-mappings');
            const data = await response.json();
            
            if (data.success) {
                const mappings = data.mappings || [];
                // 고객과 공급업체 데이터를 별도로 로드
                await this.loadCustomersAndSuppliers();
                // 필터 드롭다운 채우기
                this.populateFilters();
                this.displayMappings(mappings, this.customersCache || [], this.suppliersCache || []);
                this.updatePagination(1, Math.ceil(mappings.length / 20));
                this.updateStatistics(mappings);
            }
        } catch (error) {
            console.error('매핑 목록 로드 실패:', error);
            const tbody = document.getElementById('mappings-table-body');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="5">매핑 목록을 불러올 수 없습니다.</td></tr>';
            }
        }
    },

    // 매핑 목록 표시
    displayMappings(mappings, customers, suppliers) {
        const tbody = document.getElementById('mappings-table-body');
        if (!tbody) return;
        
        if (!mappings || mappings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">등록된 매핑이 없습니다.</td></tr>';
            return;
        }
        
        tbody.innerHTML = mappings.map(mapping => {
            const customer = customers.find(c => c.id === mapping.customer_id);
            const supplier = suppliers.find(s => s.id === mapping.supplier_id);
            
            return `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="font-weight: 500;">${customer ? customer.name : '⚠️ 삭제된 사업장'}</td>
                    <td>${supplier ? supplier.name : '⚠️ 삭제된 업체'}</td>
                    <td><code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${mapping.delivery_code || '미설정'}</code></td>
                    <td>
                        <span style="color: ${mapping.is_active ? '#28a745' : '#dc3545'}; font-weight: bold;">
                            ${mapping.is_active ? '🟢 거래중' : '🔴 중단'}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                            <button class="btn-small btn-edit" onclick="MappingsModule.editMapping(${mapping.id})" style="background: #007bff;">수정</button>
                            <button class="btn-small" onclick="MappingsModule.toggleMappingStatus(${mapping.id}, ${!mapping.is_active})" 
                                    style="background: ${mapping.is_active ? '#dc3545' : '#28a745'};">
                                ${mapping.is_active ? '중단' : '재개'}
                            </button>
                            <button class="btn-small btn-delete" onclick="MappingsModule.deleteMapping(${mapping.id})" style="background: #dc3545;">삭제</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // 통계 업데이트
    updateStatistics(mappings) {
        const totalMappings = mappings.length;
        const activeMappings = mappings.filter(m => m.is_active).length;
        const uniqueCustomers = new Set(mappings.map(m => m.customer_id)).size;
        const uniqueSuppliers = new Set(mappings.map(m => m.supplier_id)).size;

        // DOM 요소 업데이트
        const totalEl = document.getElementById('total-mappings');
        const activeEl = document.getElementById('active-mappings');
        
        if (totalEl) totalEl.textContent = totalMappings;
        if (activeEl) activeEl.textContent = activeMappings;
    },

    // 페이지네이션 업데이트
    updatePagination(current, total) {
        this.currentPage = current;
        this.totalPages = total;
        const pageInfo = document.getElementById('mapping-page-info');
        if (pageInfo) {
            pageInfo.textContent = `${current} / ${total}`;
        }
    },

    // 페이지 변경
    changePage(direction) {
        const newPage = this.currentPage + direction;
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.loadMappingData();
        }
    },

    // 매핑 검색
    searchMappings() {
        this.currentPage = 1;
        this.loadMappingData();
    },

    async filterMappings() {
        try {
            console.log('매핑 필터링 시작');
            
            // 필터 값들 가져오기
            const customerFilter = document.getElementById('mapping-customer-filter')?.value || '';
            const supplierFilter = document.getElementById('mapping-supplier-filter')?.value || '';
            const statusFilter = document.getElementById('mapping-status-filter')?.value || '';
            
            console.log('필터 조건:', { customerFilter, supplierFilter, statusFilter });
            
            // API에서 전체 매핑 데이터 가져오기
            const response = await fetch('http://localhost:9000/api/admin/customer-supplier-mappings');
            const data = await response.json();
            
            if (data.success) {
                let mappings = data.mappings || [];
                
                // 필터 적용
                if (customerFilter) {
                    mappings = mappings.filter(m => m.customer_id == customerFilter);
                }
                if (supplierFilter) {
                    mappings = mappings.filter(m => m.supplier_id == supplierFilter);
                }
                if (statusFilter !== '') {
                    const isActive = statusFilter === 'true';
                    mappings = mappings.filter(m => m.is_active === isActive);
                }
                
                console.log(`필터 결과: ${mappings.length}개 매핑`);
                
                // 필터링된 결과 표시
                this.displayMappings(mappings, this.customersCache || [], this.suppliersCache || []);
                this.updatePagination(1, Math.ceil(mappings.length / 20));
                this.updateStatistics(mappings);
            }
        } catch (error) {
            console.error('매핑 필터링 실패:', error);
        }
    },

    // 새 매핑 추가 모달 표시
    async showAddMappingModal() {
        this.editingMappingId = null;
        document.getElementById('mapping-modal-title').textContent = '새 협력업체 매핑 추가';
        
        // 폼 초기화
        document.getElementById('mapping-form').reset();
        
        // 고객 및 공급업체 목록 로드
        await this.loadCustomersAndSuppliers();
        
        document.getElementById('mapping-modal').classList.remove('hidden');
    },

    // 고객 및 공급업체 목록 로드
    async loadCustomersAndSuppliers() {
        try {
            const [customersResponse, suppliersResponse] = await Promise.all([
                fetch('http://localhost:9000/api/admin/sites/tree'),
                fetch('http://localhost:9000/api/admin/suppliers/enhanced')
            ]);
            
            const customersData = await customersResponse.json();
            const suppliersData = await suppliersResponse.json();
            
            this.customersCache = customersData.sites || [];
            this.suppliersCache = suppliersData.suppliers || [];
            
            // 고객 select 박스 업데이트
            const customerSelect = document.getElementById('mapping-customer');
            if (customerSelect) {
                customerSelect.innerHTML = '<option value="">사업장을 선택하세요</option>';
                this.customersCache.forEach(customer => {
                    customerSelect.innerHTML += `<option value="${customer.id}">${customer.name}</option>`;
                });
                console.log('고객 select 박스 업데이트 완료, 옵션 수:', customerSelect.options.length);
            } else {
                console.error('mapping-customer select 요소를 찾을 수 없음');
            }
            
        } catch (error) {
            console.error('고객/공급업체 목록 로드 실패:', error);
        }
    },

    // 필터 드롭다운 채우기
    populateFilters() {
        // 사업장 필터 채우기
        const customerFilter = document.getElementById('mapping-customer-filter');
        if (customerFilter && this.customersCache) {
            customerFilter.innerHTML = '<option value="">전체 사업장</option>';
            this.customersCache.forEach(customer => {
                customerFilter.innerHTML += `<option value="${customer.id}">${customer.name}</option>`;
            });
            console.log('사업장 필터 업데이트 완료, 옵션 수:', customerFilter.options.length);
        }

        // 협력업체 필터 채우기
        const supplierFilter = document.getElementById('mapping-supplier-filter');
        if (supplierFilter && this.suppliersCache) {
            supplierFilter.innerHTML = '<option value="">전체 협력업체</option>';
            this.suppliersCache.forEach(supplier => {
                supplierFilter.innerHTML += `<option value="${supplier.id}">${supplier.name}</option>`;
            });
            console.log('협력업체 필터 업데이트 완료, 옵션 수:', supplierFilter.options.length);
        }
    },

    // 매핑 수정
    async editMapping(mappingId) {
        try {
            console.log('매핑 수정 요청:', mappingId);
            const response = await fetch(`/api/admin/customer-supplier-mappings/${mappingId}`);
            const result = await response.json();
            
            console.log('매핑 API 응답:', result);
            
            // result가 배열인 경우 첫 번째 요소 사용
            const mapping = Array.isArray(result) ? result[0] : (result.mapping || result);
            
            if (mapping) {
                console.log('처리할 매핑 데이터:', mapping);
                this.editingMappingId = mappingId;
                document.getElementById('mapping-modal-title').textContent = '협력업체 매핑 수정';
                
                // 고객 및 공급업체 목록 먼저 로드
                await this.loadCustomersAndSuppliers();
                console.log('고객/공급업체 목록 로드 완료');
                
                // 모달 표시
                document.getElementById('mapping-modal').classList.remove('hidden');
                
                // DOM이 준비된 후 값 설정 (약간의 지연)
                setTimeout(() => {
                    // 사업장 선택
                    const customerSelect = document.getElementById('mapping-customer');
                    if (customerSelect) {
                        console.log('사업장 선택 설정 시도:', mapping.customer_id);
                        customerSelect.value = mapping.customer_id || '';
                        console.log('사업장 선택 결과:', customerSelect.value);
                    } else {
                        console.error('mapping-customer 요소를 찾을 수 없음');
                    }
                    
                    // 특이사항
                    const notesElement = document.getElementById('mapping-notes');
                    if (notesElement) {
                        notesElement.value = mapping.notes || '';
                        console.log('특이사항 설정:', notesElement.value);
                    }
                    
                    // 기존 supplier rows 초기화 후 데이터로 행 추가
                    const container = document.getElementById('supplier-rows-container');
                    if (container) {
                        container.innerHTML = '';
                        console.log('공급업체 행 추가 시도:', {
                            supplier_id: mapping.supplier_id,
                            delivery_code: mapping.delivery_code
                        });
                        
                        // 매핑 데이터로 supplier row 추가
                        this.addSupplierRow({
                            supplier_id: mapping.supplier_id,
                            delivery_code: mapping.delivery_code
                        });
                    } else {
                        console.error('supplier-rows-container 요소를 찾을 수 없음');
                    }
                }, 100);
                
            } else {
                console.error('매핑 데이터가 없음:', result);
                alert('매핑 데이터를 찾을 수 없습니다.');
            }
        } catch (error) {
            console.error('매핑 정보 로드 실패:', error);
            alert('매핑 정보를 불러올 수 없습니다.');
        }
    },

    // 매핑 저장
    async saveMapping() {
        // 현재 HTML 구조를 분석하여 올바른 필드명 사용
        const customerSelect = document.getElementById('mapping-customer');
        const supplierRows = document.querySelectorAll('.supplier-row');
        const notesField = document.getElementById('mapping-notes');
        
        if (!customerSelect || !customerSelect.value) {
            alert('사업장을 선택해주세요.');
            return;
        }
        
        if (supplierRows.length === 0) {
            alert('최소 하나의 협력업체를 추가해주세요.');
            return;
        }
        
        // 첫 번째 공급업체 행에서 데이터 추출
        const firstRow = supplierRows[0];
        const supplierSelect = firstRow.querySelector('.supplier-select');
        const deliveryCodeInput = firstRow.querySelector('.delivery-code-input');
        
        if (!supplierSelect.value) {
            alert('협력업체를 선택해주세요.');
            return;
        }
        
        const mappingData = {
            customer_id: parseInt(customerSelect.value),
            supplier_id: parseInt(supplierSelect.value),
            delivery_code: deliveryCodeInput.value || '',
            notes: notesField ? notesField.value : '',
            is_active: true // 기본값
        };
        
        try {
            const url = this.editingMappingId ? 
                `/api/admin/customer-supplier-mappings/${this.editingMappingId}` : 
                '/api/admin/customer-supplier-mappings/create';
            
            const method = this.editingMappingId ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mappingData)
            });

            const result = await response.json();
            
            if (result.success) {
                alert(this.editingMappingId ? '매핑이 수정되었습니다.' : '새 매핑이 추가되었습니다.');
                this.closeMappingModal();
                this.loadMappingData();
            } else {
                alert('저장에 실패했습니다: ' + (result.message || '알 수 없는 오류'));
            }
        } catch (error) {
            console.error('매핑 저장 오류:', error);
            alert('저장 중 오류가 발생했습니다.');
        }
    },

    // 매핑 상태 토글
    async toggleMappingStatus(mappingId, newStatus) {
        const statusText = newStatus ? '재개' : '중단';
        if (!confirm(`이 거래를 ${statusText}하시겠습니까?`)) {
            return;
        }
        
        try {
            const response = await fetch(`/api/admin/customer-supplier-mappings/${mappingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: newStatus })
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert(`거래가 ${statusText}되었습니다.`);
                this.loadMappingData();
            } else {
                alert('상태 변경에 실패했습니다.');
            }
        } catch (error) {
            console.error('상태 변경 오류:', error);
            alert('상태 변경 중 오류가 발생했습니다.');
        }
    },

    // 매핑 삭제
    async deleteMapping(mappingId) {
        if (!confirm('이 매핑을 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/customer-supplier-mappings/${mappingId}`, {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (result.success) {
                alert('매핑이 삭제되었습니다.');
                this.loadMappingData();
            } else {
                alert(result.message || '삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('매핑 삭제 오류:', error);
            alert('삭제 중 오류가 발생했습니다.');
        }
    },

    // 협력업체 행 추가 함수 (매핑 모달용)
    addSupplierRow(supplierData = null) {
        const container = document.getElementById('supplier-rows-container');
        if (!container) return;
        
        const rowDiv = document.createElement('div');
        rowDiv.className = 'supplier-row';
        rowDiv.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-bottom: 10px; padding: 10px; border: 1px solid #eee; border-radius: 5px;';
        
        rowDiv.innerHTML = `
            <div style="flex: 1;">
                <label>협력업체</label>
                <select class="supplier-select" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" required>
                    <option value="">협력업체를 선택하세요</option>
                    ${this.suppliersCache.map(supplier => {
                        const selected = supplierData && supplier.id === supplierData.supplier_id ? 'selected' : '';
                        return `<option value="${supplier.id}" ${selected}>${supplier.name}</option>`;
                    }).join('')}
                </select>
            </div>
            <div style="flex: 1;">
                <label>배송코드</label>
                <input type="text" class="delivery-code-input" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
                       value="${supplierData ? (supplierData.delivery_code || '') : ''}" 
                       placeholder="배송코드를 입력하세요" maxlength="20" required>
            </div>
            <div style="padding-top: 20px;">
                <button type="button" onclick="MappingsModule.removeSupplierRow(this)" style="background: #dc3545; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">
                    삭제
                </button>
            </div>
        `;
        
        container.appendChild(rowDiv);
    },

    // 협력업체 행 제거 함수
    removeSupplierRow(button) {
        const row = button.closest('.supplier-row');
        if (row) {
            row.remove();
        }
    },

    // 매핑 모달 닫기
    closeMappingModal() {
        document.getElementById('mapping-modal').classList.add('hidden');
        this.editingMappingId = null;
    },

    // 매핑 필터 초기화
    clearMappingFilters() {
        const customerFilter = document.getElementById('mapping-customer-filter');
        const supplierFilter = document.getElementById('mapping-supplier-filter');
        const statusFilter = document.getElementById('mapping-status-filter');
        
        if (customerFilter) customerFilter.value = '';
        if (supplierFilter) supplierFilter.value = '';
        if (statusFilter) statusFilter.value = '';
        
        this.loadMappingData();
    },

    // 매핑 페이지 변경 (전역 함수로 내보내기 위해 추가)
    changeMappingPage(direction) {
        this.changePage(direction);
    }
};

// 전역 함수로 내보내기 (기존 HTML과의 호환성을 위해)
window.loadMappingData = () => MappingsModule.loadMappingData();
window.changeMappingPage = (direction) => MappingsModule.changePage(direction);
window.searchMappings = () => MappingsModule.searchMappings();
window.filterMappings = () => MappingsModule.filterMappings();
window.clearMappingFilters = () => MappingsModule.clearMappingFilters();
window.showAddMappingModal = () => MappingsModule.showAddMappingModal();
window.editMapping = (id) => MappingsModule.editMapping(id);
window.saveMapping = () => MappingsModule.saveMapping();
window.toggleMappingStatus = (id, status) => MappingsModule.toggleMappingStatus(id, status);
window.deleteMapping = (id) => MappingsModule.deleteMapping(id);
window.closeMappingModal = () => MappingsModule.closeMappingModal();
window.addSupplierRow = (data) => MappingsModule.addSupplierRow(data);
window.removeSupplierRow = (button) => MappingsModule.removeSupplierRow(button);

console.log('🔗 Complete Mappings Module 정의 완료');