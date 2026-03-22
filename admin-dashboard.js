// 모듈화된 관리자 대시보드 - 최소한의 통합 스크립트
// 각 모듈에서 제공하지 않는 추가 기능들만 포함

console.log('관리자 대시보드 통합 스크립트 로드됨');

// 전역 변수들 - window 객체에 할당하여 중복 선언 방지
window.pageInitialized = window.pageInitialized || false;
window.allowModalDisplay = window.allowModalDisplay || false;

// 모듈 로드 상태 확인
function checkModulesLoaded() {
    const modules = [
        { name: 'Navigation', check: () => window.showPage },
        { name: 'Dashboard', check: () => window.DashboardModule },
        { name: 'Users', check: () => window.UsersModule },
        { name: 'Suppliers', check: () => window.SuppliersModule },
        { name: 'Sites', check: () => window.SitesModule },
        { name: 'Ingredients', check: () => window.IngredientsModule },
        { name: 'Mappings', check: () => window.MappingsModule },
        { name: 'MealPricing', check: () => window.MealPricingModule }
    ];
    
    modules.forEach(module => {
        if (module.check()) {
            console.log(`✅ ${module.name} 모듈 로드됨`);
        } else {
            console.warn(`❌ ${module.name} 모듈 로드 실패`);
        }
    });
}

// DOM 로드 후 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('관리자 대시보드 초기화 시작');
    
    // 모듈 로드 상태 확인 (더 늦게 실행)
    setTimeout(checkModulesLoaded, 2000);
    
    // 강제로 모든 모달 숨김 처리
    setTimeout(() => {
        const modals = ['user-modal', 'site-modal', 'supplier-modal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.style.display = 'none';
                modal.classList.add('hidden');
                console.log(`${modalId} 강제 숨김`);
            }
        });
        
        console.log('모든 모달 숨김 처리 완료');
        
        // 1초 후 모달 표시 허용
        setTimeout(() => {
            pageInitialized = true;
            allowModalDisplay = true;
            console.log('모달 표시 허용됨');
        }, 1000);
    }, 100);
});

// 기타 유틸리티 함수들 (모듈에 포함되지 않은 것들)

// 급식수 관리 페이지 초기화
function initMealCountsPage() {
    console.log('급식수 관리 페이지 초기화');
    // 급식수 관련 초기화 로직
}

// 급식수 데이터 로드
async function loadMealCounts() {
    try {
        const response = await fetch('/api/admin/meal-counts');
        const data = await response.json();
        
        if (data.success) {
            updateMealCountsSummary(data.mealCounts);
            updateMealCountsTable(data.mealCounts);
        }
    } catch (error) {
        console.error('급식수 데이터 로드 실패:', error);
    }
}

// 급식수 요약 업데이트
function updateMealCountsSummary(mealCounts) {
    // 급식수 요약 정보 업데이트
    console.log('급식수 요약 업데이트:', mealCounts?.length || 0, '건');
}

// 급식수 테이블 업데이트
function updateMealCountsTable(mealCounts) {
    const tbody = document.getElementById('meal-counts-table-body');
    if (!tbody) return;
    
    if (!mealCounts || mealCounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">등록된 급식수 데이터가 없습니다.</td></tr>';
        return;
    }
    
    tbody.innerHTML = mealCounts.map(count => `
        <tr>
            <td>${count.date}</td>
            <td>${count.site_name}</td>
            <td>${count.meal_type}</td>
            <td>${count.count}</td>
            <td>${count.created_at}</td>
            <td>
                <button class="btn-small btn-edit" onclick="editMealCount(${count.id})">수정</button>
                <button class="btn-small btn-duplicate" onclick="duplicateMealCount(${count.id})">복제</button>
            </td>
        </tr>
    `).join('');
}

// 급식수 관리 모달 관련 함수들
function showAddMealCountModal() {
    console.log('급식수 추가 모달 표시');
    const modal = document.getElementById('meal-count-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeMealCountModal() {
    const modal = document.getElementById('meal-count-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function saveMealCount() {
    // 급식수 저장 로직
    console.log('급식수 저장');
}

async function editMealCount(mealCountId) {
    console.log('급식수 수정:', mealCountId);
}

async function duplicateMealCount(mealCountId) {
    console.log('급식수 복제:', mealCountId);
}

function refreshMealCounts() {
    loadMealCounts();
}

function exportMealCounts() {
    console.log('급식수 내보내기');
}

// 가격 관리 관련 함수들
async function loadPricingCustomers() {
    try {
        const response = await fetch('/api/admin/customers');
        const data = await response.json();
        // 고객사 데이터 처리
        console.log('가격 관리 고객사 로드:', data.customers?.length || 0, '개');
    } catch (error) {
        console.error('가격 관리 고객사 로드 실패:', error);
    }
}

async function loadPricingData() {
    try {
        const response = await fetch('/api/admin/pricing');
        const data = await response.json();
        // 가격 데이터 처리
        console.log('가격 데이터 로드:', data.pricing?.length || 0, '건');
    } catch (error) {
        console.error('가격 데이터 로드 실패:', error);
    }
}

function updateProfitMargin(input) {
    // 이익률 업데이트
    console.log('이익률 업데이트:', input.value);
}

function updatePricingSummary() {
    // 가격 요약 업데이트
    console.log('가격 요약 업데이트');
}

async function savePricingData() {
    // 가격 데이터 저장
    console.log('가격 데이터 저장');
}

// 협력업체 매핑 관리 관련 함수들
async function loadSupplierMappingPage() {
    console.log('공급업체 매핑 페이지 로드');
}

async function loadMappingData() {
    console.log('매핑 데이터 로드');
}

async function loadCustomersForMapping() {
    console.log('매핑용 고객사 데이터 로드');
}

function displayMappings(mappings) {
    console.log('매핑 데이터 표시:', mappings?.length || 0, '건');
}

function updateMappingFilters() {
    console.log('매핑 필터 업데이트');
}

function updateMappingStats() {
    console.log('매핑 통계 업데이트');
}

function filterMappings() {
    console.log('매핑 필터링');
}

function clearMappingFilters() {
    console.log('매핑 필터 초기화');
}

function openMappingModal(mappingId = null) {
    console.log('[Mapping] 매핑 모달 열기 시작:', mappingId);
    
    const mappingModal = document.getElementById('mapping-modal');
    if (mappingModal) {
        mappingModal.classList.remove('hidden');
        mappingModal.style.display = 'flex';
        mappingModal.style.visibility = 'visible';
        mappingModal.style.opacity = '1';
        mappingModal.style.zIndex = '9999';
        console.log('[Mapping] 매핑 모달 표시됨');
    } else {
        console.error('[Mapping] mapping-modal 요소를 찾을 수 없음');
    }
    
    // 모달 제목 설정
    const modalTitle = document.getElementById('mapping-modal-title');
    if (modalTitle) {
        modalTitle.textContent = mappingId ? '매핑 수정' : '새 매핑 추가';
    }
}

function editMapping(mappingId) {
    console.log('매핑 수정:', mappingId);
}

async function deleteMapping(mappingId) {
    console.log('매핑 삭제:', mappingId);
}

function closeMappingModal() {
    const modal = document.getElementById('mapping-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
    console.log('매핑 모달 닫기');
}

async function saveMapping() {
    try {
        const mappingData = {
            supplier_id: document.getElementById('mapping-supplier-id')?.value || '',
            ingredient_id: document.getElementById('mapping-ingredient-id')?.value || '',
            customer_ingredient_name: document.getElementById('mapping-customer-name')?.value || '',
            mapping_type: document.getElementById('mapping-type')?.value || 'manual',
            is_active: document.getElementById('mapping-active')?.checked || true,
            notes: document.getElementById('mapping-notes')?.value || ''
        };

        console.log('매핑 데이터 저장:', mappingData);

        const response = await fetch('/api/admin/mappings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mappingData)
        });

        const result = await response.json();
        
        if (result.success) {
            alert('매핑이 저장되었습니다.');
            closeMappingModal();
            // Reload mapping data if there's a load function
            if (typeof loadMappingData === 'function') {
                loadMappingData();
            }
        } else {
            alert('저장 중 오류가 발생했습니다: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('매핑 저장 실패:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 식단가 관리 관련 함수들
async function loadMealPricingPage() {
    console.log('식단가 관리 페이지 로드');
}

function populateBusinessLocationSelect() {
    console.log('사업장 선택 옵션 생성');
}

function updateMealPlanOptions() {
    console.log('식단 옵션 업데이트');
}

async function onMasterMealPlanChange() {
    console.log('마스터 식단 변경');
}

function showMealPricingPage() {
    console.log('식단가 페이지 표시');
}

async function saveMealPricing() {
    console.log('식단가 저장');
}

// 사용자 생성 - 새로운 완전 동작 버전
async function createNewUser() {
    console.log('[UserCreation] 사용자 생성 시작');
    
    const userData = {
        username: document.getElementById('user-username')?.value || '',
        password: document.getElementById('user-password')?.value || 'default123',
        role: document.getElementById('user-role')?.value || 'viewer',
        contact_info: document.getElementById('user-contact')?.value || '',
        department: document.getElementById('user-department')?.value || '',
        position: document.getElementById('user-position')?.value || '',
        managed_site: document.getElementById('user-managed-site')?.value || null,
        operator: document.getElementById('user-operator')?.checked || false,
        semi_operator: document.getElementById('user-semi-operator')?.checked || false
    };

    if (!userData.username) {
        alert('사용자명을 입력해주세요.');
        return;
    }

    console.log('[UserCreation] 전송할 데이터:', userData);

    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });

        console.log('[UserCreation] 서버 응답 상태:', response.status);
        const result = await response.json();
        console.log('[UserCreation] 서버 응답 데이터:', result);
        
        if (result.success) {
            alert('사용자가 성공적으로 생성되었습니다!');
            
            // 사용자 모달 닫기
            const modal = document.getElementById('user-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            
            // 사용자 목록 새로고침
            if (window.UsersModule && typeof window.UsersModule.loadUsers === 'function') {
                console.log('[UserCreation] 사용자 목록 새로고침');
                window.UsersModule.loadUsers();
            } else {
                console.log('[UserCreation] UsersModule을 찾을 수 없어 페이지 새로고침');
                location.reload();
            }
        } else {
            alert('사용자 생성 실패: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[UserCreation] 오류 발생:', error);
        alert('사용자 생성 중 오류가 발생했습니다: ' + error.message);
    }
}

// 사업장 생성 - 새로운 완전 동작 버전  
async function createNewSite() {
    console.log('[SiteCreation] 사업장 생성 시작');
    
    const siteData = {
        name: document.getElementById('site-name')?.value || '',
        code: document.getElementById('site-name')?.value ? document.getElementById('site-name')?.value.toUpperCase().replace(/\s/g, '') : '',
        site_type: document.getElementById('site-type')?.value || '일반',
        address: document.getElementById('site-address')?.value || '',
        contact_phone: document.getElementById('site-contact-phone')?.value || '',
        contact_person: document.getElementById('site-contact-person')?.value || '',
        description: document.getElementById('site-description')?.value || '',
        parent_id: document.getElementById('site-parent-id')?.value || null,
        level: 1,
        sort_order: 0,
        portion_size: document.getElementById('site-portion-size')?.value || null
    };

    if (!siteData.name) {
        alert('사업장명을 입력해주세요.');
        return;
    }

    console.log('[SiteCreation] 전송할 데이터:', siteData);

    try {
        const response = await fetch('/api/admin/sites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(siteData)
        });

        console.log('[SiteCreation] 서버 응답 상태:', response.status);
        const result = await response.json();
        console.log('[SiteCreation] 서버 응답 데이터:', result);
        
        if (result.success) {
            alert('사업장이 성공적으로 생성되었습니다!');
            
            // 사업장 모달 닫기
            const modal = document.getElementById('site-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            
            // 사업장 목록 새로고침
            if (typeof loadSitesTree === 'function') {
                console.log('[SiteCreation] 사업장 트리 새로고침');
                loadSitesTree();
            } else {
                console.log('[SiteCreation] loadSitesTree를 찾을 수 없어 페이지 새로고침');
                location.reload();
            }
        } else {
            alert('사업장 생성 실패: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[SiteCreation] 오류 발생:', error);
        alert('사업장 생성 중 오류가 발생했습니다: ' + error.message);
    }
}

// 전역 함수로 내보내기
window.createNewUser = createNewUser;
window.createNewSite = createNewSite;
window.initMealCountsPage = initMealCountsPage;
window.loadMealCounts = loadMealCounts;
window.updateMealCountsSummary = updateMealCountsSummary;
window.updateMealCountsTable = updateMealCountsTable;
window.showAddMealCountModal = showAddMealCountModal;
window.closeMealCountModal = closeMealCountModal;
window.saveMealCount = saveMealCount;
window.editMealCount = editMealCount;
window.duplicateMealCount = duplicateMealCount;
window.refreshMealCounts = refreshMealCounts;
window.exportMealCounts = exportMealCounts;

window.loadPricingCustomers = loadPricingCustomers;
window.loadPricingData = loadPricingData;
window.updateProfitMargin = updateProfitMargin;
window.updatePricingSummary = updatePricingSummary;
window.savePricingData = savePricingData;

window.loadSupplierMappingPage = loadSupplierMappingPage;
window.loadMappingData = loadMappingData;
window.loadCustomersForMapping = loadCustomersForMapping;
window.displayMappings = displayMappings;
window.updateMappingFilters = updateMappingFilters;
window.updateMappingStats = updateMappingStats;
window.filterMappings = filterMappings;
window.clearMappingFilters = clearMappingFilters;
window.openMappingModal = openMappingModal;
window.editMapping = editMapping;
window.deleteMapping = deleteMapping;
window.closeMappingModal = closeMappingModal;
window.saveMapping = saveMapping;

window.loadMealPricingPage = loadMealPricingPage;
window.populateBusinessLocationSelect = populateBusinessLocationSelect;
window.updateMealPlanOptions = updateMealPlanOptions;
window.onMasterMealPlanChange = onMasterMealPlanChange;
window.showMealPricingPage = showMealPricingPage;
window.saveMealPricing = saveMealPricing;

// ==================== 새로운 작동 테스트 함수들 ====================

// 새로운 사용자 생성 함수 - 완전히 처음부터
async function testCreateUser() {
    const userData = {
        username: 'testuser_' + Date.now(),
        password: 'test123',
        role: 'nutritionist',
        department: '테스트부서',
        position: '테스터',
        contact_info: 'test@example.com',
        operator: false,
        semi_operator: false,
        managed_site: ''
    };
    
    console.log('[TEST] 사용자 생성 테스트 시작:', userData);
    
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });
        
        console.log('[TEST] 응답 상태:', response.status);
        const result = await response.json();
        console.log('[TEST] 응답 데이터:', result);
        
        if (result.success) {
            alert('사용자 생성 성공! ID: ' + result.user_id);
            // 사용자 목록 강제 새로고침
            await testLoadUsers();
        } else {
            alert('사용자 생성 실패: ' + result.message);
        }
    } catch (error) {
        console.error('[TEST] 오류:', error);
        alert('오류 발생: ' + error.message);
    }
}

// 새로운 사용자 목록 로드 함수
async function testLoadUsers() {
    console.log('[TEST] 사용자 목록 로드 시작');
    
    try {
        const response = await fetch('/api/admin/users');
        const result = await response.json();
        
        console.log('[TEST] 사용자 목록:', result);
        
        if (result.success) {
            const userTableBody = document.getElementById('users-table-body');
            if (userTableBody) {
                userTableBody.innerHTML = result.users.map(user => `
                    <tr>
                        <td>${user.id}</td>
                        <td>${user.username}</td>
                        <td>${user.role}</td>
                        <td>${user.department || '-'}</td>
                        <td>${user.position || '-'}</td>
                        <td>${user.contact_info || '-'}</td>
                        <td><span class="${user.is_active ? 'status-active' : 'status-inactive'}">${user.is_active ? '활성' : '비활성'}</span></td>
                        <td>
                            <button class="btn-small btn-edit">수정</button>
                            <button class="btn-small btn-delete">삭제</button>
                        </td>
                    </tr>
                `).join('');
                console.log('[TEST] 사용자 테이블 업데이트 완료:', result.users.length, '명');
            }
        }
    } catch (error) {
        console.error('[TEST] 사용자 목록 로드 오류:', error);
    }
}

// 새로운 사업장 생성 함수 - 완전히 처음부터
async function testCreateSite() {
    const siteData = {
        name: '테스트사업장_' + Date.now(),
        code: 'TEST' + Date.now(),
        site_type: '일반',
        level: 1,
        sort_order: 0,
        address: '테스트 주소',
        contact_phone: '010-1234-5678',
        contact_person: '담당자',
        description: '테스트 사업장입니다',
        is_active: true,
        parent_id: null,
        portion_size: null
    };
    
    console.log('[TEST] 사업장 생성 테스트 시작:', siteData);
    
    try {
        const response = await fetch('/api/admin/sites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(siteData)
        });
        
        console.log('[TEST] 사업장 응답 상태:', response.status);
        const result = await response.json();
        console.log('[TEST] 사업장 응답 데이터:', result);
        
        if (result.success) {
            alert('사업장 생성 성공! ID: ' + result.id);
            // 사업장 목록 강제 새로고침
            await testLoadSites();
        } else {
            alert('사업장 생성 실패: ' + JSON.stringify(result));
        }
    } catch (error) {
        console.error('[TEST] 사업장 생성 오류:', error);
        alert('오류 발생: ' + error.message);
    }
}

// 새로운 사업장 목록 로드 함수
async function testLoadSites() {
    console.log('[TEST] 사업장 목록 로드 시작');
    
    try {
        const response = await fetch('/api/admin/sites/tree');
        const result = await response.json();
        
        console.log('[TEST] 사업장 목록:', result);
        
        if (result.success) {
            const sitesContainer = document.getElementById('sites-tree');
            if (sitesContainer) {
                const sitesHtml = (result.tree || result.sites || []).map(site => `
                    <div class="tree-node" data-site-id="${site.id}">
                        <div class="tree-item">
                            <span class="site-name">${site.name}</span>
                            <span class="site-type">(${site.site_type})</span>
                            <span class="site-code">[${site.code}]</span>
                        </div>
                    </div>
                `).join('');
                
                sitesContainer.innerHTML = `
                    <div class="sites-tree">
                        ${sitesHtml}
                    </div>
                `;
                console.log('[TEST] 사업장 트리 업데이트 완료:', (result.tree || result.sites || []).length, '개');
            }
        }
    } catch (error) {
        console.error('[TEST] 사업장 목록 로드 오류:', error);
    }
}

// 전역 함수로 노출
window.testCreateUser = testCreateUser;
window.testLoadUsers = testLoadUsers;
window.testCreateSite = testCreateSite;
window.testLoadSites = testLoadSites;

console.log('테스트 함수들 준비 완료 - testCreateUser(), testCreateSite() 등 사용 가능');

// ==================== 기존 코드 ====================

console.log('관리자 대시보드 통합 스크립트 로드 완료');