// 공급업체 관리 모듈
(function() {
'use strict';

// 공급업체 관련 변수
let currentSupplierPage = 1;
let totalSupplierPages = 1;
let currentEditSupplierId = null;

// SuppliersModule 객체 (다른 모듈과 일관성 유지)
window.SuppliersModule = {
    currentPage: 1,
    totalPages: 1,
    editingId: null,

    // 모듈 초기화
    async init() {
        console.log('🏭 Suppliers Module 초기화');
        await this.loadSuppliers();
        await this.loadSupplierStatistics();
        this.setupEventListeners();
        return this;
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        const searchInput = document.getElementById('supplier-search');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchSuppliers();
                }
            });
        }
    },

    // 공급업체 목록 로드 (모듈화된 버전)
    async loadSuppliers() {
        try {
            const search = document.getElementById('supplier-search')?.value || '';
            const page = this.currentPage || 1;
            const response = await fetch(`/api/admin/suppliers/enhanced?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
            const data = await response.json();
            
            if (data.success) {
                this.displaySuppliers(data.suppliers || []);
                this.updatePagination(data.currentPage || 1, data.totalPages || 1);
            }
        } catch (error) {
            console.error('공급업체 목록 로드 실패:', error);
            const tbody = document.getElementById('suppliers-table-body');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="11">공급업체 목록을 불러올 수 없습니다.</td></tr>';
            }
        }
    },

    // 공급업체 통계 로드
    async loadSupplierStatistics() {
        try {
            const response = await fetch(`/api/admin/suppliers/enhanced?page=1&limit=100`);
            const data = await response.json();
            
            if (data.success && data.suppliers) {
                const suppliers = data.suppliers;
                const totalCount = suppliers.length;
                const activeCount = suppliers.filter(s => s.is_active).length;
                const largeCompanyCount = suppliers.filter(s => s.company_scale === '대기업').length;
                const smallCompanyCount = suppliers.filter(s => s.company_scale === '중소기업').length;

                // 통계 카드 업데이트
                this.updateStatistics({
                    total: totalCount,
                    active: activeCount,
                    largeCompany: largeCompanyCount,
                    smallCompany: smallCompanyCount
                });
            }
        } catch (error) {
            console.error('공급업체 통계 로드 실패:', error);
        }
    },

    // 통계 업데이트
    updateStatistics(stats) {
        const totalElement = document.getElementById('total-suppliers-count');
        const activeElement = document.getElementById('active-suppliers-count');
        const activeTextElement = document.getElementById('active-suppliers-text');
        const largeElement = document.getElementById('large-company-count');
        const smallElement = document.getElementById('small-company-count');

        if (totalElement) totalElement.textContent = stats.total;
        if (activeElement) activeElement.textContent = stats.active;
        if (activeTextElement) activeTextElement.textContent = `활성: ${stats.active}개`;
        if (largeElement) largeElement.textContent = stats.largeCompany;
        if (smallElement) smallElement.textContent = stats.smallCompany;
    },

    // 공급업체 목록 표시 (모듈화된 버전)
    displaySuppliers(suppliers) {
        const tbody = document.getElementById('suppliers-table-body');
        if (!tbody) return;
        
        if (!suppliers || suppliers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11">등록된 공급업체가 없습니다.</td></tr>';
            return;
        }
        
        tbody.innerHTML = suppliers.map(supplier => `
            <tr>
                <td>${supplier.parent_code || '-'}</td>
                <td>${supplier.business_location_code || '-'}</td>
                <td>${supplier.business_location_name || '-'}</td>
                <td><strong>${supplier.name}</strong></td>
                <td>${supplier.headquarters_phone || supplier.phone || '-'}</td>
                <td>${supplier.email || '-'}</td>
                <td>
                    <span class="status-badge ${supplier.is_active ? 'active' : 'inactive'}">
                        ${supplier.is_active ? '거래중' : '거래중단'}
                    </span>
                </td>
                <td>${supplier.business_number || '-'}</td>
                <td>${supplier.representative || '-'}</td>
                <td>${supplier.contact_person || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-edit" onclick="editSupplier(${supplier.id})" title="수정">
                            ✏️
                        </button>
                        <button class="btn-small btn-toggle" onclick="toggleSupplierStatus(${supplier.id}, ${!supplier.is_active})" title="상태 변경">
                            ${supplier.is_active ? '⏸️' : '▶️'}
                        </button>
                        <button class="btn-small btn-sites" onclick="bulkToggleSupplierMappings(${supplier.id}, '${supplier.name}')" title="거래관리">
                            🔗
                        </button>
                        <button class="btn-small btn-delete" onclick="deleteSupplier(${supplier.id})" title="삭제">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    // 페이지네이션 업데이트
    updatePagination(current, total) {
        this.currentPage = current;
        this.totalPages = total;
        currentSupplierPage = current;
        totalSupplierPages = total;
        const pageInfo = document.getElementById('supplier-page-info');
        if (pageInfo) {
            pageInfo.textContent = `${current} / ${total}`;
        }
    },

    // 검색
    searchSuppliers() {
        this.currentPage = 1;
        currentSupplierPage = 1;
        this.loadSuppliers();
    }
};

// 공급업체 목록 로드
async function loadSuppliers() {
    try {
        const search = document.getElementById('supplier-search')?.value || '';
        const page = currentSupplierPage || 1;
        const response = await fetch(`/api/admin/suppliers/enhanced?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
        const data = await response.json();
        
        if (data.success) {
            displaySuppliers(data.suppliers || []);
            updateSupplierPagination(data.currentPage || 1, data.totalPages || 1);
        }
    } catch (error) {
        console.error('공급업체 목록 로드 실패:', error);
        const tbody = document.getElementById('suppliers-table-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8">공급업체 목록을 불러올 수 없습니다.</td></tr>';
        }
    }
}

// 공급업체 목록 표시
function displaySuppliers(suppliers) {
    const tbody = document.getElementById('suppliers-table-body');
    if (!tbody) return;
    
    if (!suppliers || suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8">등록된 공급업체가 없습니다.</td></tr>';
        return;
    }
    
    tbody.innerHTML = suppliers.map(supplier => `
        <tr>
            <td>${supplier.id}</td>
            <td>${supplier.name}</td>
            <td>${supplier.contact_person || '-'}</td>
            <td>${supplier.phone || '-'}</td>
            <td>${supplier.address || '-'}</td>
            <td><span class="${supplier.is_active ? 'status-active' : 'status-inactive'}">
                ${supplier.is_active ? '활성' : '비활성'}
            </span></td>
            <td>
                <button class="btn-small btn-edit" onclick="editSupplier(${supplier.id})">수정</button>
                <button class="btn-small" onclick="toggleSupplierStatus(${supplier.id}, ${!supplier.is_active})" 
                        style="background: ${supplier.is_active ? '#dc3545' : '#28a745'};">
                    ${supplier.is_active ? '비활성화' : '활성화'}
                </button>
                <button class="btn-small" onclick="bulkToggleSupplierMappings(${supplier.id}, '${supplier.name}')" 
                        style="background: #17a2b8; margin: 0 5px;" title="이 업체와의 모든 매핑을 일괄 중단/재개">
                    🔗 거래관리
                </button>
                <button class="btn-small btn-delete" onclick="deleteSupplier(${supplier.id})" style="background: #dc3545;">삭제</button>
            </td>
        </tr>
    `).join('');
}

// 공급업체 페이지네이션 업데이트
function updateSupplierPagination(currentPage, totalPages) {
    currentSupplierPage = currentPage;
    totalSupplierPages = totalPages;
    const pageInfo = document.getElementById('supplier-page-info');
    if (pageInfo) {
        pageInfo.textContent = `${currentPage} / ${totalPages}`;
    }
}

// 공급업체 페이지 변경
function changeSupplierPage(direction) {
    const newPage = currentSupplierPage + direction;
    if (newPage >= 1 && newPage <= totalSupplierPages) {
        currentSupplierPage = newPage;
        loadSuppliers();
    }
}

// 공급업체 검색
function searchSuppliers() {
    currentSupplierPage = 1;
    loadSuppliers();
}

// 공급업체 추가 모달 표시
function showAddSupplierModal() {
    console.log('[Suppliers] 공급업체 추가 모달 표시');
    currentEditSupplierId = null;
    
    const modalTitle = document.getElementById('supplier-modal-title');
    const supplierForm = document.getElementById('supplier-form');
    const supplierModal = document.getElementById('supplier-modal');
    
    if (modalTitle) {
        modalTitle.textContent = '새 공급업체 추가';
        console.log('[Suppliers] 모달 제목 설정됨');
    } else {
        console.error('[Suppliers] supplier-modal-title 요소를 찾을 수 없음');
    }
    
    if (supplierForm) {
        supplierForm.reset();
        console.log('[Suppliers] 공급업체 폼 초기화됨');
    } else {
        console.error('[Suppliers] supplier-form 요소를 찾을 수 없음');
    }
    
    if (supplierModal) {
        supplierModal.classList.remove('hidden');
        // 강제로 display 스타일 설정
        supplierModal.style.display = 'flex';
        supplierModal.style.visibility = 'visible';
        supplierModal.style.opacity = '1';
        supplierModal.style.zIndex = '9999';
        console.log('[Suppliers] 공급업체 모달 표시됨');
        console.log('[Suppliers] 모달 현재 클래스:', supplierModal.className);
        console.log('[Suppliers] 모달 현재 스타일:', supplierModal.style.cssText);
    } else {
        console.error('[Suppliers] supplier-modal 요소를 찾을 수 없음');
    }
}

// 공급업체 수정
async function editSupplier(supplierId) {
    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}`);
        const result = await response.json();
        const supplier = result.supplier || result;
        
        if (supplier) {
            currentEditSupplierId = supplierId;
            document.getElementById('supplier-modal-title').textContent = '공급업체 정보 수정';
            
            // 폼에 기존 데이터 채우기
            document.getElementById('supplier-id').value = supplier.id || '';
            document.getElementById('supplier-name').value = supplier.name || '';
            document.getElementById('supplier-representative').value = supplier.representative || '';
            document.getElementById('supplier-contact').value = supplier.contact || '';
            document.getElementById('supplier-fax').value = supplier.fax || '';
            document.getElementById('supplier-email').value = supplier.email || '';
            document.getElementById('supplier-business-number').value = supplier.business_number || '';
            document.getElementById('supplier-business-item').value = supplier.business_item || '';
            document.getElementById('supplier-manager-name').value = supplier.manager_name || '';
            document.getElementById('supplier-manager-phone').value = supplier.manager_phone || '';
            document.getElementById('supplier-parent-code').value = supplier.parent_code || '';
            document.getElementById('supplier-site-code').value = supplier.site_code || '';
            document.getElementById('supplier-site-name').value = supplier.site_name || '';
            document.getElementById('supplier-business-type').value = supplier.business_type || '';
            document.getElementById('supplier-phone').value = supplier.phone || '';
            document.getElementById('supplier-address').value = supplier.address || '';
            document.getElementById('supplier-update-frequency').value = supplier.update_frequency || 'weekly';
            document.getElementById('supplier-is-active').checked = supplier.is_active !== false;
            document.getElementById('supplier-notes').value = supplier.notes || '';
            
            document.getElementById('supplier-modal').classList.remove('hidden');
        }
    } catch (error) {
        console.error('공급업체 정보 로드 실패:', error);
        alert('공급업체 정보를 불러올 수 없습니다.');
    }
}

// 공급업체 저장
async function saveSupplier() {
    const supplierData = {
        name: document.getElementById('supplier-name').value,
        representative: document.getElementById('supplier-representative').value,
        contact: document.getElementById('supplier-contact').value,
        fax: document.getElementById('supplier-fax').value,
        email: document.getElementById('supplier-email').value,
        business_number: document.getElementById('supplier-business-number').value,
        business_item: document.getElementById('supplier-business-item').value,
        manager_name: document.getElementById('supplier-manager-name').value,
        manager_phone: document.getElementById('supplier-manager-phone').value,
        parent_code: document.getElementById('supplier-parent-code').value,
        site_code: document.getElementById('supplier-site-code').value,
        site_name: document.getElementById('supplier-site-name').value,
        business_type: document.getElementById('supplier-business-type').value,
        phone: document.getElementById('supplier-phone').value,
        address: document.getElementById('supplier-address').value,
        update_frequency: document.getElementById('supplier-update-frequency').value,
        is_active: document.getElementById('supplier-is-active').checked,
        notes: document.getElementById('supplier-notes').value
    };

    try {
        const url = currentEditSupplierId ? 
            `/api/admin/suppliers/${currentEditSupplierId}` : 
            '/api/admin/suppliers/create';
        
        const method = currentEditSupplierId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(supplierData)
        });

        const result = await response.json();
        
        if (result.success) {
            alert(currentEditSupplierId ? '공급업체가 수정되었습니다.' : '새 공급업체가 추가되었습니다.');
            closeSupplierModal();
            loadSuppliers();
        } else {
            alert('저장에 실패했습니다: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('공급업체 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 공급업체 상태 토글
async function toggleSupplierStatus(supplierId, newStatus) {
    const statusText = newStatus ? '활성화' : '비활성화';
    if (!confirm(`이 공급업체를 ${statusText}하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`공급업체가 ${statusText}되었습니다.`);
            loadSuppliers();
        } else {
            alert('상태 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('상태 변경 중 오류가 발생했습니다.');
    }
}

// 공급업체 삭제
async function deleteSupplier(supplierId) {
    if (!confirm('이 공급업체를 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('공급업체가 삭제되었습니다.');
            loadSuppliers();
        } else {
            alert(result.message || '삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('업체 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 공급업체 모달 닫기
function closeSupplierModal() {
    document.getElementById('supplier-modal').classList.add('hidden');
    currentEditSupplierId = null;
}

// 일괄 거래 중단/재개 기능
async function bulkToggleSupplierMappings(supplierId, supplierName) {
    try {
        // 해당 공급업체의 현재 매핑 상태 조회
        const response = await fetch(`/api/admin/supplier-mappings/${supplierId}/status`);
        const result = await response.json();
        
        if (!result.success) {
            alert('매핑 상태를 확인할 수 없습니다.');
            return;
        }
        
        const { total_mappings, active_mappings, inactive_mappings } = result.data;
        
        if (total_mappings === 0) {
            alert(`${supplierName}과(와) 연결된 매핑이 없습니다.`);
            return;
        }
        
        // 사용자에게 현재 상태 표시 및 확인
        const statusText = active_mappings > 0 ? 
            `활성 매핑 ${active_mappings}개를 포함하여 총 ${total_mappings}개의 매핑이 있습니다.\n모든 매핑을 중단하시겠습니까?` :
            `총 ${inactive_mappings}개의 중단된 매핑이 있습니다.\n모든 매핑을 재개하시겠습니까?`;
        
        if (!confirm(`${supplierName}\n${statusText}`)) {
            return;
        }
        
        // 일괄 토글 실행
        const newStatus = active_mappings === 0; // 모두 비활성이면 활성화, 아니면 비활성화
        const toggleResponse = await fetch(`/api/admin/supplier-mappings/${supplierId}/bulk-toggle`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        const toggleResult = await toggleResponse.json();
        
        if (toggleResult.success) {
            const actionText = newStatus ? '재개' : '중단';
            alert(`${supplierName}과(와)의 거래가 일괄 ${actionText}되었습니다.\n영향받은 매핑: ${toggleResult.affected_count}개`);
            
            // 협력업체 매핑 페이지가 현재 보이면 새로고침
            if (!document.getElementById('supplier-mapping-page').classList.contains('hidden')) {
                if (typeof loadMappingData === 'function') {
                    loadMappingData();
                }
            }
        } else {
            alert(`처리 중 오류가 발생했습니다: ${toggleResult.message}`);
        }
        
    } catch (error) {
        console.error('일괄 거래 관리 오류:', error);
        alert('처리 중 오류가 발생했습니다.');
    }
}

// 전역 함수로 내보내기
window.loadSuppliers = loadSuppliers;
window.displaySuppliers = displaySuppliers;
window.updateSupplierPagination = updateSupplierPagination;
window.changeSupplierPage = changeSupplierPage;
window.searchSuppliers = searchSuppliers;
window.showAddSupplierModal = showAddSupplierModal;
window.editSupplier = editSupplier;
window.saveSupplier = saveSupplier;
window.toggleSupplierStatus = toggleSupplierStatus;
window.deleteSupplier = deleteSupplier;
window.closeSupplierModal = closeSupplierModal;
window.bulkToggleSupplierMappings = bulkToggleSupplierMappings;

})(); // IIFE 종료