/**
 * 사업장 관리 모듈
 * - 사업장 CRUD 작업
 * - 사업장 검색 및 필터링
 * - 사업장 상태 관리
 */

// 발주 협력업체 배지 렌더링 헬퍼
window._renderSupplierBadges = function(suppliers) {
    if (!suppliers || suppliers.length === 0) {
        return '<span style="color: #999; font-size: 12px;">-</span>';
    }
    return suppliers.map(name =>
        `<span style="display: inline-block; padding: 2px 8px; margin: 1px 2px; background: #e8f5e9; color: #2e7d32; border-radius: 10px; font-size: 11px; font-weight: 500; white-space: nowrap;">${name}</span>`
    ).join('');
};

// BusinessLocationsModule for admin_dashboard.html
window.BusinessLocationsModule = {
    async init() {
        console.log('🏢 Business Locations Module 초기화');
        this.loadSiteStats();
        this.loadSites();
        this.setupEventListeners();
        return this;
    },

    setupEventListeners() {
        // 전체 선택 체크박스
        const selectAll = document.getElementById('selectAllSites');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                const checkboxes = document.querySelectorAll('#sitesTableBody input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = e.target.checked);
            });
        }
    },

    async loadSiteStats() {
        try {
            // API에서 실제 통계 가져오기
            const response = await fetch(`${window.CONFIG.API_BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}'}/api/admin/business-locations`);
            const data = await response.json();

            if (data.success) {
                const locations = data.locations || [];

                // 통계 계산
                const stats = {
                    'totalSites': locations.length,
                    'lunchboxSites': locations.filter(l => l.site_type === '도시락업체').length,
                    'transportSites': locations.filter(l => l.site_type === '운송업체').length,
                    'schoolSites': locations.filter(l => l.site_type === '급식업체' || l.site_name === '학교').length,
                    'careSites': locations.filter(l => l.site_type === '산업체' || l.site_type === '요양시설' || l.site_name === '요양원').length
                };

                // UI 업데이트
                for (const [id, value] of Object.entries(stats)) {
                    const element = document.getElementById(id);
                    if (element) {
                        element.textContent = value;
                    }
                }
            }
        } catch (error) {
            console.error('통계 데이터 로드 오류:', error);
            // 오류 시 0으로 표시
            const elements = ['totalSites', 'lunchboxSites', 'transportSites', 'schoolSites', 'careSites'];
            elements.forEach(id => {
                const element = document.getElementById(id);
                if (element) element.textContent = '0';
            });
        }
    },

    async loadSites() {
        const tbody = document.getElementById('sitesTableBody');
        if (!tbody) return;

        try {
            // API에서 데이터 가져오기 (관리 페이지에서는 거래종료 사업장도 표시)
            const response = await fetch(`${window.CONFIG.API_BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}'}/api/admin/business-locations?include_ended=1`);
            const data = await response.json();

            if (data.success) {
                window.currentSiteData = data.locations || [];
            }
        } catch (error) {
            console.error('사업장 데이터 로드 오류:', error);
        }

        const siteData = [...window.currentSiteData].sort((a, b) => (a.contract_ended ? 1 : 0) - (b.contract_ended ? 1 : 0));

        tbody.innerHTML = siteData.map(site => {
            const endedStyle = site.contract_ended ? 'background-color: #fff3cd; color: #856404;' : '';
            const statusBadge = site.contract_ended
                ? '<span class="status-badge" style="background: #dc3545; color: #fff;">거래종료</span>'
                : `<span class="status-badge ${site.is_active ? 'active' : 'inactive'}">${site.is_active ? '활성' : '비활성'}</span>`;
            return `
            <tr style="${endedStyle}">
                <td>${site.site_code}</td>
                <td>
                    <div class="site-info">
                        <strong>${site.site_name}</strong>
                    </div>
                </td>
                <td>${site.abbreviation || '-'}</td>
                <td>${site.group_type || site.site_type}</td>
                <td>${site.address || site.region || '-'}</td>
                <td>${site.manager_name || '-'}</td>
                <td>${site.manager_phone || site.phone || '-'}</td>
                <td>
                    <span class="status-badge ${site.has_categories ? 'active' : ''}" style="${site.has_categories ? 'background: #e3f2fd; color: #1565c0;' : 'color: #999;'}">
                        ${site.has_categories ? '사용' : '-'}
                    </span>
                </td>
                <td>${window._renderSupplierBadges(site.suppliers)}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="editSite(${site.id})" title="수정">✏️</button>
                        <button class="btn-icon btn-danger" onclick="deleteSite(${site.id})" title="삭제">🗑️</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }
};

// API에서 데이터를 가져오도록 수정
window.currentSiteData = [];


// 급식사업장 수정 함수 - 모달 띄우기
window.editSite = async function(siteId) {
    const site = window.currentSiteData.find(s => s.id === siteId);
    if (!site) {
        alert('급식사업장을 찾을 수 없습니다.');
        return;
    }

    // 모달에 데이터 채우기
    document.getElementById('editSiteId').value = site.id;
    document.getElementById('editSiteCode').value = site.site_code;
    document.getElementById('editSiteName').value = site.site_name;
    document.getElementById('editSiteAbbreviation').value = site.abbreviation || '';
    document.getElementById('editSiteHasCategories').checked = site.has_categories || false;
    document.getElementById('editSiteType').value = site.site_type;
    document.getElementById('editSiteRegion').value = site.region || site.address || '';
    document.getElementById('editSiteManager').value = site.manager_name || '';
    document.getElementById('editSitePhone').value = site.phone || site.manager_phone || '';
    document.getElementById('editSiteStatus').value = site.is_active ? 'true' : 'false';
    document.getElementById('editContractEndDate').value = site.contract_end_date || '';

    // 모달 표시 및 스타일 강제 적용
    const modal = document.getElementById('siteEditModal');
    modal.style.display = 'block';

    // 모달 콘텐츠 스타일 강제 적용
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.style.maxHeight = '90vh';
        modalContent.style.margin = '2% auto';
        modalContent.style.width = '560px';
    }

    // 협력업체 체크박스 로드
    await window.loadSupplierCheckboxes(siteId);
};

// 협력업체 체크박스 목록 로드
window.loadSupplierCheckboxes = async function(siteId) {
    const container = document.getElementById('supplierCheckboxList');
    if (!container) return;

    container.innerHTML = '<div style="grid-column: 1/-1; color: #999; text-align: center; padding: 20px;">협력업체 목록 로딩 중...</div>';

    try {
        // 전체 협력업체 목록 가져오기
        const suppliersRes = await fetch(`${window.CONFIG.API_BASE_URL || ''}/api/admin/suppliers`);
        const suppliersData = await suppliersRes.json();

        // 이 사업장에 매핑된 협력업체 목록 가져오기
        const mappedRes = await fetch(`${window.CONFIG.API_BASE_URL || ''}/api/admin/sites/${siteId}/suppliers`);
        const mappedData = await mappedRes.json();

        const allSuppliers = suppliersData.suppliers || suppliersData.data || [];
        const mappedIds = mappedData.supplier_ids || [];

        if (allSuppliers.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; color: #999; text-align: center; padding: 20px;">등록된 협력업체가 없습니다.</div>';
            return;
        }

        // 그리드 체크박스 렌더링
        // ★ label의 onclick 제거 - change 이벤트와 충돌하여 체크가 해제되는 버그 수정
        container.innerHTML = allSuppliers.map(supplier => {
            const isChecked = mappedIds.includes(supplier.id);
            const ingredientCount = supplier.ingredient_count || 0;
            return `
                <label class="supplier-checkbox-item ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" name="supplier_ids" value="${supplier.id}"
                           ${isChecked ? 'checked' : ''}>
                    <div class="supplier-info">
                        <div class="supplier-name">${supplier.name}</div>
                        ${ingredientCount > 0 ? `<div class="supplier-count">식자재 ${ingredientCount.toLocaleString()}개</div>` : '<div class="supplier-count">식자재 없음</div>'}
                    </div>
                </label>
            `;
        }).join('');

        // 체크박스 변경 시 스타일 업데이트
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                this.closest('.supplier-checkbox-item').classList.toggle('checked', this.checked);
            });
        });

        console.log(`✅ 협력업체 ${allSuppliers.length}개 로드됨, 매핑된 협력업체: ${mappedIds.length}개`);
    } catch (error) {
        console.error('협력업체 로드 오류:', error);
        container.innerHTML = '<div style="grid-column: 1/-1; color: #dc3545; text-align: center; padding: 20px;">협력업체 목록을 불러올 수 없습니다.</div>';
    }
};

// API Base URL 헬퍼
const getApiBaseUrl = () => window.CONFIG?.API_BASE_URL || window.CONFIG?.API?.BASE_URL || '';

// 사업장 삭제 함수
window.deleteSite = function(siteId) {
    if (confirm('정말로 이 사업장을 삭제하시겠습니까?')) {
        // API 호출
        fetch(`${getApiBaseUrl()}/api/admin/sites/${siteId}`, {
            method: 'DELETE'
        })
        .then(res => res.json())
        .then(async data => {
            if (data.success) {
                console.log('✅ 사업장 삭제 성공, 테이블 새로고침 중...');
                // 새로고침을 기다려서 완료되도록 수정
                await window.BusinessLocationsModule.loadSites();
                console.log('✅ 사업장 테이블 새로고침 완료');
            } else {
                alert('삭제 실패: ' + (data.error || '알 수 없는 오류'));
            }
        })
        .catch(err => {
            console.error('삭제 오류:', err);
            alert('삭제 중 오류가 발생했습니다.');
        });
    }
};

// 모달 닫기 함수
window.closeSiteModal = function() {
    document.getElementById('siteEditModal').style.display = 'none';
};

window.closeAddSiteModal = function() {
    document.getElementById('siteAddModal').style.display = 'none';
};

// 사업장 변경사항 저장
window.saveSiteChanges = async function() {
    const siteId = document.getElementById('editSiteId').value;
    const regionValue = document.getElementById('editSiteRegion').value;
    const data = {
        site_name: document.getElementById('editSiteName').value,
        abbreviation: document.getElementById('editSiteAbbreviation').value || null,
        has_categories: document.getElementById('editSiteHasCategories').checked,
        site_type: document.getElementById('editSiteType').value,
        region: regionValue,
        address: regionValue,  // region과 address 모두 동일한 주소값 사용
        phone: document.getElementById('editSitePhone').value || '',
        manager_name: document.getElementById('editSiteManager') ? document.getElementById('editSiteManager').value : '',
        is_active: document.getElementById('editSiteStatus').value === 'true',
        contract_end_date: document.getElementById('editContractEndDate').value || null
    };

    try {
        // 1. 사업장 기본 정보 저장
        const response = await fetch(`${getApiBaseUrl()}/api/admin/sites/${siteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!result.success) {
            alert('수정 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        // 2. 협력업체 매핑 저장
        const supplierCheckboxes = document.querySelectorAll('#supplierCheckboxList input[name="supplier_ids"]:checked');
        const supplierIds = Array.from(supplierCheckboxes).map(cb => parseInt(cb.value));
        console.log('📦 저장할 협력업체 IDs:', supplierIds);

        const mappingResponse = await fetch(`${getApiBaseUrl()}/api/admin/sites/${siteId}/suppliers`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ supplier_ids: supplierIds })
        });

        const mappingResult = await mappingResponse.json();

        if (mappingResult.success) {
            console.log(`✅ 협력업체 매핑 저장 성공: ${supplierIds.length}개`);
        } else {
            console.warn('협력업체 매핑 저장 실패:', mappingResult.error);
        }

        console.log('✅ 사업장 업데이트 성공, 테이블 새로고침 중...');

        // 모달 닫기
        closeSiteModal();

        // 로컬 데이터도 업데이트
        const site = window.currentSiteData.find(s => s.id == siteId);
        if (site) {
            site.site_name = document.getElementById('editSiteName').value;
            site.abbreviation = document.getElementById('editSiteAbbreviation').value || null;
            site.has_categories = document.getElementById('editSiteHasCategories').checked;
            site.site_type = document.getElementById('editSiteType').value;
            site.region = document.getElementById('editSiteRegion').value;
            site.address = document.getElementById('editSiteRegion').value;  // address도 업데이트
            site.manager_name = document.getElementById('editSiteManager').value || null;
            site.manager_phone = document.getElementById('editSitePhone').value || null;
            site.is_active = document.getElementById('editSiteStatus').value === 'true';
            site.contract_end_date = document.getElementById('editContractEndDate').value || null;
        }

        // 새로고침을 기다려서 완료되도록 수정
        await window.BusinessLocationsModule.loadSites();
        console.log('✅ 사업장 테이블 새로고침 완료');

        // 저장 완료 팝업
        alert('저장이 완료되었습니다.');

    } catch (err) {
        console.error('저장 오류:', err);
        alert('저장 중 오류가 발생했습니다.');
    }
};

// HTML에서 호출하는 전역 함수들
window.filterSitesByType = function() {
    const filter = document.getElementById('siteTypeFilter')?.value;
    const tbody = document.getElementById('sitesTableBody');
    if (!tbody) return;

    // 하드코딩 대신 전역 변수 사용
    const siteData = window.currentSiteData;

    let filteredData = siteData;
    if (filter) {
        filteredData = siteData.filter(s => s.site_name === filter);
    }
    filteredData = [...filteredData].sort((a, b) => (a.contract_ended ? 1 : 0) - (b.contract_ended ? 1 : 0));

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">검색 결과가 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = filteredData.map(site => {
        const endedStyle = site.contract_ended ? 'background-color: #fff3cd; color: #856404;' : '';
        const statusBadge = site.contract_ended
            ? '<span class="status-badge" style="background: #dc3545; color: #fff;">거래종료</span>'
            : `<span class="status-badge ${site.is_active ? 'active' : 'inactive'}">${site.is_active ? '활성' : '비활성'}</span>`;
        return `
        <tr style="${endedStyle}">
            <td>${site.site_code}</td>
            <td>${site.site_name}</td>
            <td>${site.abbreviation || '-'}</td>
            <td>${site.group_type || site.site_type}</td>
            <td>${site.address || site.region || '-'}</td>
            <td>${site.manager_name || '-'}</td>
            <td>${site.manager_phone || site.phone || '-'}</td>
            <td>
                <span class="status-badge ${site.has_categories ? 'active' : ''}" style="${site.has_categories ? 'background: #e3f2fd; color: #1565c0;' : 'color: #999;'}">
                    ${site.has_categories ? '사용' : '-'}
                </span>
            </td>
            <td>${window._renderSupplierBadges(site.suppliers)}</td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon" onclick="editSite(${site.id})" title="수정">✏️</button>
                    <button class="btn-icon btn-danger" onclick="deleteSite(${site.id})" title="삭제">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
};

window.searchSites = function() {
    const searchTerm = document.getElementById('siteSearchInput')?.value.toLowerCase();
    const tbody = document.getElementById('sitesTableBody');
    if (!tbody) return;

    // 하드코딩 대신 전역 변수 사용
    const siteData = window.currentSiteData;

    if (!searchTerm) {
        BusinessLocationsModule.loadSites();
        return;
    }

    const filteredData = siteData.filter(site =>
        site.site_name.toLowerCase().includes(searchTerm) ||
        site.site_code.toLowerCase().includes(searchTerm) ||
        site.site_type.toLowerCase().includes(searchTerm)
    ).sort((a, b) => (a.contract_ended ? 1 : 0) - (b.contract_ended ? 1 : 0));

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">검색 결과가 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = filteredData.map(site => {
        const endedStyle = site.contract_ended ? 'background-color: #fff3cd; color: #856404;' : '';
        const statusBadge = site.contract_ended
            ? '<span class="status-badge" style="background: #dc3545; color: #fff;">거래종료</span>'
            : `<span class="status-badge ${site.is_active ? 'active' : 'inactive'}">${site.is_active ? '활성' : '비활성'}</span>`;
        return `
        <tr style="${endedStyle}">
            <td>${site.site_code}</td>
            <td>${site.site_name}</td>
            <td>${site.abbreviation || '-'}</td>
            <td>${site.group_type || site.site_type}</td>
            <td>${site.address || site.region || '-'}</td>
            <td>${site.manager_name || '-'}</td>
            <td>${site.manager_phone || site.phone || '-'}</td>
            <td>
                <span class="status-badge ${site.has_categories ? 'active' : ''}" style="${site.has_categories ? 'background: #e3f2fd; color: #1565c0;' : 'color: #999;'}">
                    ${site.has_categories ? '사용' : '-'}
                </span>
            </td>
            <td>${window._renderSupplierBadges(site.suppliers)}</td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon" onclick="editSite(${site.id})" title="수정">✏️</button>
                    <button class="btn-icon btn-danger" onclick="deleteSite(${site.id})" title="삭제">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
};

// 새 급식사업장 추가 모달 표시
window.showAddSiteModal = function() {
    // 폼 초기화 - 모든 필드를 빈 값으로
    const nameField = document.getElementById('newSiteName');
    const typeField = document.getElementById('newSiteType');
    const regionField = document.getElementById('newSiteRegion');
    const managerField = document.getElementById('newSiteManager');
    const phoneField = document.getElementById('newSitePhone');

    if (nameField) nameField.value = '';
    if (typeField) typeField.value = '급식업체';
    if (regionField) regionField.value = '';
    if (managerField) managerField.value = '';
    if (phoneField) phoneField.value = '';

    // 모달 표시
    const modal = document.getElementById('siteAddModal');
    if (!modal) {
        console.error('siteAddModal not found');
        return;
    }
    modal.style.display = 'block';

    // 모달 콘텐츠 스타일 강제 적용
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.style.maxHeight = '80vh';
        modalContent.style.margin = '3% auto';
        modalContent.style.width = '500px';
    }
    console.log('✅ 사업장 추가 모달 표시됨');
};

// 사업장 구분에 따라 유형 옵션 변경
window.updateSiteTypeOptions = function() {
    const categorySelect = document.getElementById('newSiteCategory');
    const typeSelect = document.getElementById('newSiteType');
    if (!categorySelect || !typeSelect) return;

    const category = categorySelect.value;

    if (category === 'management') {
        // 급식관리 사업장 유형
        typeSelect.innerHTML = `
            <option value="급식업체">급식업체</option>
            <option value="위탁급식">위탁급식</option>
            <option value="직영">직영</option>
            <option value="도시락업체">도시락업체</option>
        `;
    } else {
        // 고객사 사업장 유형
        typeSelect.innerHTML = `
            <option value="운반">운반 (배송)</option>
            <option value="산업체">산업체</option>
            <option value="교육기관">교육기관</option>
            <option value="의료업체">의료업체</option>
            <option value="요양시설">요양시설</option>
        `;
    }
};

// 새 사업장 추가
window.addNewSite = function() {
    const categorySelect = document.getElementById('newSiteCategory');
    const businessCategory = categorySelect ? categorySelect.value : 'management';

    // site_code는 서버에서 자동 생성하므로 전송하지 않음
    const data = {
        // site_code 제거 - 서버에서 자동 생성
        name: document.getElementById('newSiteName').value,
        type: document.getElementById('newSiteType').value,
        business_category: businessCategory,  // 급식관리/고객사 구분
        parent_id: document.getElementById('newSiteRegion').value,
        address: document.getElementById('newSiteRegion').value,
        contact_info: document.getElementById('newSitePhone').value || null,
        manager_name: document.getElementById('newSiteManager').value || null,
        is_active: true
    };

    // 필수 필드 검증 (사업장명만 검증, 코드는 자동생성)
    if (!data.name) {
        alert('사업장명은 필수입니다.');
        return;
    }

    // API 호출 - /api/admin/sites-create 사용 (POST /api/admin/sites 충돌 회피)
    fetch(`${getApiBaseUrl()}/api/admin/sites-create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(async result => {
        if (result.success) {
            console.log('✅ 사업장 추가 성공, 테이블 새로고침 중...');
            // 모달 닫기
            closeAddSiteModal();
            // 새로고침을 기다려서 완료되도록 수정
            await window.BusinessLocationsModule.loadSites();
            console.log('✅ 사업장 테이블 새로고침 완료');
        } else {
            alert('추가 실패: ' + (result.error || '알 수 없는 오류'));
        }
    })
    .catch(err => {
        console.error('추가 오류:', err);
        alert('추가 중 오류가 발생했습니다.');
    });
};

window.SitesModule = {
    currentPage: 1,
    pageSize: 20,
    totalPages: 0,
    editingSiteId: null,

    async load() {
        console.log('🏢 Sites Module 로딩 시작...');
        await this.render();
        await this.loadSites();
        this.setupEventListeners();
        console.log('🏢 Sites Module 로드됨');
    },

    async render() {
        console.log('[DEBUG] render() called');
        const container = document.getElementById('sites-module');
        console.log('[DEBUG] sites-module container:', container);
        if (!container) {
            console.error('[ERROR] sites-module container not found!');
            return;
        }

        container.innerHTML = `
            <style>
            .sites-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }

            .sites-header {
                background: white;
                padding: 25px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                margin-bottom: 25px;
            }

            .sites-header h1 {
                margin: 0 0 10px 0;
                color: #2c3e50;
                font-size: 28px;
                font-weight: 600;
            }

            .sites-header p {
                margin: 0;
                color: #7f8c8d;
                font-size: 16px;
            }

            .sites-toolbar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                gap: 15px;
                flex-wrap: wrap;
            }

            .search-box {
                display: flex;
                align-items: center;
                gap: 10px;
                flex: 1;
                max-width: 400px;
            }

            .search-box input {
                flex: 1;
                padding: 12px 15px;
                border: 2px solid #e1e8ed;
                border-radius: 8px;
                font-size: 14px;
                transition: border-color 0.3s;
            }

            .search-box input:focus {
                outline: none;
                border-color: #667eea;
            }

            .sites-content {
                background: white;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                overflow: hidden;
            }

            .sites-table {
                width: 100%;
                border-collapse: collapse;
                margin: 0;
            }

            .sites-table th,
            .sites-table td {
                padding: 15px;
                text-align: left;
                border-bottom: 1px solid #f1f3f4;
                vertical-align: middle;
            }

            .sites-table th {
                background: #f8f9fa;
                font-weight: 600;
                color: #333;
            }

            .sites-table tr:hover {
                background: #f8f9fa;
            }

            .loading-cell {
                text-align: center;
                color: #666;
                font-style: italic;
            }

            .btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 500;
                text-decoration: none;
                display: inline-block;
            }

            .btn-primary {
                background: #667eea;
                color: white;
            }

            .btn-secondary {
                background: #6c757d;
                color: white;
            }

            .btn-danger {
                background: #dc3545;
                color: white;
            }

            .btn-warning {
                background: #ffc107;
                color: #333;
            }

            .btn:hover {
                opacity: 0.9;
            }

            .btn-sm {
                padding: 4px 8px;
                font-size: 12px;
            }

            .status-badge {
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
            }

            .status-active {
                background: #d4edda;
                color: #155724;
            }

            .status-inactive {
                background: #f8d7da;
                color: #721c24;
            }

            .modal {
                position: fixed;
                z-index: 1000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
            }

            .modal-content {
                background: white;
                margin: 5% auto;
                padding: 0;
                border-radius: 8px;
                width: 90%;
                max-width: 500px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }

            .modal-header {
                padding: 20px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .modal-close {
                font-size: 28px;
                font-weight: bold;
                color: #aaa;
                cursor: pointer;
            }

            .modal-close:hover {
                color: #000;
            }

            .modal-body {
                padding: 20px;
            }

            .form-group {
                margin-bottom: 15px;
            }

            .form-group label {
                display: block;
                margin-bottom: 5px;
                font-weight: 500;
                color: #333;
            }

            .form-group input,
            .form-group select,
            .form-group textarea {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
            }

            .form-group textarea {
                height: 80px;
                resize: vertical;
            }

            .form-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                margin-top: 20px;
            }

            .pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
                gap: 10px;
            }

            .pagination button {
                padding: 8px 12px;
                border: 1px solid #ddd;
                background: white;
                cursor: pointer;
                border-radius: 4px;
            }

            .pagination button:hover {
                background: #f8f9fa;
            }

            .pagination button.active {
                background: #667eea;
                color: white;
                border-color: #667eea;
            }

            .pagination button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-left: 4px solid #667eea;
            }

            .stat-card h3 {
                margin: 0;
                font-size: 32px;
                color: #667eea;
                font-weight: 700;
            }

            .stat-card p {
                margin: 0;
                color: #666;
                font-size: 16px;
                font-weight: 500;
            }

            .stat-icon {
                font-size: 36px;
                opacity: 0.7;
            }
            </style>

            <div class="sites-container">
                <!-- 헤더 -->
                <div class="sites-header">
                    <h1>🏢 사업장 관리</h1>
                    <p>사업장 정보를 등록하고 관리합니다</p>
                </div>

                <!-- 통계 -->
                <div class="stats-grid" id="sites-stats">
                    <div class="stat-card" style="border-left-color: #667eea;">
                        <div>
                            <p>전체 사업장</p>
                            <h3 id="total-sites">-</h3>
                        </div>
                        <div class="stat-icon">🏢</div>
                    </div>
                    <div class="stat-card" style="border-left-color: #28a745;">
                        <div>
                            <p>활성 사업장</p>
                            <h3 id="active-sites">-</h3>
                        </div>
                        <div class="stat-icon">✅</div>
                    </div>
                    <div class="stat-card" style="border-left-color: #dc3545;">
                        <div>
                            <p>비활성 사업장</p>
                            <h3 id="inactive-sites">-</h3>
                        </div>
                        <div class="stat-icon">❌</div>
                    </div>
                </div>

                <!-- 툴바 -->
                <div class="sites-toolbar">
                    <div class="search-box">
                        <input type="text" id="site-search" placeholder="사업장명, 주소로 검색...">
                        <button class="btn btn-secondary" onclick="SitesModule.searchSites()">🔍</button>
                    </div>
                    <button class="btn btn-primary" onclick="SitesModule.showCreateModal()">+ 새 사업장</button>
                </div>

                <!-- 사업장 목록 -->
                <div class="sites-content">
                    <table class="sites-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>사업장명</th>
                                <th>사업장타입</th>
                                <th>주소</th>
                                <th>연락처</th>
                                <th>상태</th>
                                <th>등록일</th>
                                <th>작업</th>
                            </tr>
                        </thead>
                        <tbody id="sites-table-body">
                            <tr>
                                <td colspan="8" class="loading-cell">사업장 목록을 불러오는 중...</td>
                            </tr>
                        </tbody>
                    </table>
                    
                    <!-- 페이지네이션 -->
                    <div class="pagination" id="sites-pagination">
                        <!-- 페이지네이션 버튼들이 여기에 동적으로 생성됩니다 -->
                    </div>
                </div>
            </div>

            <!-- 사업장 생성/수정 모달 -->
            <div id="site-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-title">새 사업장</h3>
                        <span class="modal-close" onclick="SitesModule.closeModal()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <form id="site-form" onsubmit="SitesModule.saveSite(event)">
                            <div class="form-group">
                                <label for="site_name">사업장명 *</label>
                                <input type="text" id="site_name" name="site_name" required>
                            </div>
                            <div class="form-group">
                                <label for="address">주소 (배송시 사용) *</label>
                                <input type="text" id="address" name="address" required placeholder="예: 대구시 달서구 성서공단로 123">
                            </div>
                            <div class="form-group">
                                <label for="contact_info">연락처</label>
                                <input type="text" id="contact_info" name="contact_info">
                            </div>
                            <div class="form-group">
                                <label for="description">설명</label>
                                <textarea id="description" name="description" placeholder="사업장에 대한 추가 설명..."></textarea>
                            </div>
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="is_active" name="is_active" checked>
                                    활성화
                                </label>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="btn btn-primary">저장</button>
                                <button type="button" class="btn btn-secondary" onclick="SitesModule.closeModal()">취소</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    },

    setupEventListeners() {
        // 검색 엔터키 처리
        const searchInput = document.getElementById('site-search');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchSites();
                }
            });
        }

        // 모달 외부 클릭시 닫기
        const modal = document.getElementById('site-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }
    },

    async loadSites() {
        try {
            const search = document.getElementById('site-search')?.value || '';
            
            console.log(`Loading sites - page: ${this.currentPage}, search: "${search}"`);
            
            const response = await apiGet(`/api/admin/sites?page=${this.currentPage}&limit=${this.pageSize}&search=${encodeURIComponent(search)}`);
            
            console.log('Sites response:', response);
            
            console.log('[DEBUG] response.success:', response.success);
            console.log('[DEBUG] response.sites length:', response.sites ? response.sites.length : 'undefined');
            
            if (response.success) {
                console.log('[DEBUG] Calling renderSites with sites:', response.sites);
                console.log('[DEBUG] First site data:', response.sites[0]);
                window.lastSitesData = response.sites; // 디버깅용
                this.renderSites(response.sites || []);
                this.updatePagination(response.total, response.page, response.limit);
                await this.loadSiteStats();
            } else {
                console.error('[ERROR] API response success is false');
                showMessage('사업장 목록을 불러올 수 없습니다.', 'error');
                this.renderSites([]);
            }
        } catch (error) {
            console.error('사업장 로드 중 오류:', error);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            showMessage('사업장 목록을 불러오는 중 오류가 발생했습니다.', 'error');
            this.renderSites([]);
        }
    },

    async loadSiteStats() {
        try {
            const response = await apiGet('/api/admin/site-stats');
            if (response.success) {
                const stats = response.stats;
                document.getElementById('total-sites').textContent = stats.total_sites || 0;
                document.getElementById('active-sites').textContent = stats.active_sites || 0;
                document.getElementById('inactive-sites').textContent = stats.inactive_sites || 0;
            }
        } catch (error) {
            console.error('사업장 통계 로드 중 오류:', error);
        }
    },

    renderSites(sites) {
        console.log('[DEBUG] renderSites called with:', sites);
        const tbody = document.getElementById('sites-table-body');
        console.log('[DEBUG] tbody element:', tbody);
        if (!tbody) {
            console.error('[ERROR] sites-table-body element not found!');
            return;
        }

        if (sites.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="loading-cell">등록된 사업장이 없습니다.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = sites.map(site => `
            <tr>
                <td>${site.id}</td>
                <td><strong>${site.site_name || '-'}</strong></td>
                <td>${site.site_type || '-'}</td>
                <td>${site.address || site.region || '-'}</td>
                <td>${site.phone || site.manager_phone || '-'}</td>
                <td>
                    <span class="status-badge ${site.is_active ? 'status-active' : 'status-inactive'}">
                        ${site.is_active ? '활성' : '비활성'}
                    </span>
                </td>
                <td>${site.created_at ? new Date(site.created_at).toLocaleDateString() : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="SitesModule.editSite(${site.id})">수정</button>
                    <button class="btn btn-sm btn-danger" onclick="SitesModule.deleteSite(${site.id})">삭제</button>
                </td>
            </tr>
        `).join('');
    },

    updatePagination(total, page, limit) {
        this.totalPages = Math.ceil(total / limit);
        this.currentPage = page;

        const paginationContainer = document.getElementById('sites-pagination');
        if (!paginationContainer) return;

        let paginationHTML = '';

        // 이전 페이지
        paginationHTML += `
            <button ${this.currentPage <= 1 ? 'disabled' : ''} onclick="SitesModule.goToPage(${this.currentPage - 1})">
                이전
            </button>
        `;

        // 페이지 번호들
        for (let i = Math.max(1, this.currentPage - 2); i <= Math.min(this.totalPages, this.currentPage + 2); i++) {
            paginationHTML += `
                <button class="${i === this.currentPage ? 'active' : ''}" onclick="SitesModule.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        // 다음 페이지
        paginationHTML += `
            <button ${this.currentPage >= this.totalPages ? 'disabled' : ''} onclick="SitesModule.goToPage(${this.currentPage + 1})">
                다음
            </button>
        `;

        paginationContainer.innerHTML = paginationHTML;
    },

    goToPage(page) {
        if (page >= 1 && page <= this.totalPages) {
            this.currentPage = page;
            this.loadSites();
        }
    },

    searchSites() {
        this.currentPage = 1;
        this.loadSites();
    },

    showCreateModal() {
        document.getElementById('modal-title').textContent = '새 사업장';
        document.getElementById('site-form').reset();
        
        // 기본값 설정
        document.getElementById('is_active').checked = true;
        
        document.getElementById('site-modal').style.display = 'block';
        this.editingSiteId = null;
    },

    closeModal() {
        document.getElementById('site-modal').style.display = 'none';
        document.getElementById('site-form').reset();
        this.editingSiteId = null;
    },

    async saveSite(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const siteData = {
            site_name: formData.get('site_name'),
            address: formData.get('address'),
            contact_info: formData.get('contact_info'),
            description: formData.get('description'),
            is_active: formData.has('is_active')
        };

        try {
            let response;
            if (this.editingSiteId) {
                response = await apiPut(`/api/admin/sites/${this.editingSiteId}`, siteData);
            } else {
                console.log('Sending site data:', siteData);
                response = await apiPost('/api/admin/sites', siteData);
            }

            if (response.success !== false) {
                showMessage(this.editingSiteId ? '사업장이 수정되었습니다.' : '사업장이 추가되었습니다.', 'success');
                this.closeModal();
                this.loadSites();
            } else {
                showMessage(response.message || '저장 중 오류가 발생했습니다.', 'error');
            }
        } catch (error) {
            console.error('사업장 저장 중 오류:', error);
            
            if (error.message.includes('422')) {
                showMessage('입력 데이터를 확인해 주세요.', 'error');
            } else if (error.message.includes('400')) {
                showMessage('이미 존재하는 사업장명입니다.', 'error');
            } else {
                showMessage('사업장 저장 중 오류가 발생했습니다.', 'error');
            }
        }
    },

    async editSite(siteId) {
        try {
            const response = await apiGet(`/api/admin/sites/${siteId}`);
            
            if (response.success !== false) {
                const site = response.site || response;
                
                document.getElementById('modal-title').textContent = '사업장 수정';
                document.getElementById('site_name').value = site.site_name;
                document.getElementById('address').value = site.address || '';
                document.getElementById('contact_info').value = site.contact_info || '';
                document.getElementById('description').value = site.description || '';
                document.getElementById('is_active').checked = site.is_active;
                
                this.editingSiteId = siteId;
                document.getElementById('site-modal').style.display = 'block';
            } else {
                showMessage('사업장 정보를 불러올 수 없습니다.', 'error');
            }
        } catch (error) {
            console.error('사업장 로드 중 오류:', error);
            showMessage('사업장 정보를 불러오는 중 오류가 발생했습니다.', 'error');
        }
    },

    async deleteSite(siteId) {
        if (!confirm('정말로 이 사업장을 삭제하시겠습니까?')) {
            return;
        }

        try {
            const response = await apiDelete(`/api/admin/sites/${siteId}`);
            
            if (response.success !== false) {
                showMessage('사업장이 삭제되었습니다.', 'success');
                this.loadSites();
            } else {
                showMessage('사업장 삭제 중 오류가 발생했습니다.', 'error');
            }
        } catch (error) {
            console.error('사업장 삭제 중 오류:', error);
            showMessage('사업장 삭제 중 오류가 발생했습니다.', 'error');
        }
    }
};

console.log('🏢 Sites Module 정의됨');