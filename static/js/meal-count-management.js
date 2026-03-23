// ========================
// 전역 변수 및 설정
// ========================
// ★ 현재 그룹 ID를 SiteSelector에서 동적으로 가져오는 함수
// - 사업장 선택기에서 본사/영남지사 선택 시 자동으로 변경됨
function getCurrentGroupId() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        if (context?.group_id) return context.group_id;
    }
    return window._defaultGroupId || 1;
}
function getCurrentGroupName() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        if (context?.group_name) return context.group_name;
    }
    return window._defaultGroupName || '본사';
}

// ★ 현재 로그인한 사용자명 반환 (수정자 추적용)
function getCurrentUsername() {
    try {
        const userStr = localStorage.getItem('user_info') || localStorage.getItem('user');
        if (userStr) {
            const user = JSON.parse(userStr);
            return user.username || user.name || '';
        }
    } catch (e) {}
    return '';
}

// 동적으로 로드되는 식시 유형 (카테고리 기반 mealTypes)
// 기본값: 빈 배열 - 필요시 탭을 추가하는 형태로 변경
let businessTypes = [];  // mealTypes 기반으로 동적 변경 (기본 빈 배열)
let currentTabIndex = 0;
let foodCountData = {};
let isDirty = false;  // 저장되지 않은 변경사항 추적

// 현재 카테고리의 meal_types, meal_items (동적으로 로드됨)
// 끼니 기본 1개, 필요시 사용자가 추가
let currentMealTypes = ['조식', '중식', '석식', '야식', '행사'];
let currentMealItems = ['일반'];
let currentCategoryName = '전체';
let currentCategoryId = null;  // 현재 카테고리 ID (슬롯 로드용)
let categorySlots = [];  // 현재 탭의 슬롯
let categorySlotsCache = {};  // 카테고리별 슬롯 캐시 {categoryId: [slots]}
let slotClientsCache = {};  // ★★★ 슬롯별 사업장 목록 캐시 {카테고리명: {슬롯명: [사업장명, ...]}}
let categoryNameToIdMap = {};  // 카테고리 이름 → ID 매핑 {"도시락": 1, "운반": 2, ...}

// ★★★ Phase 3: 캐시 통합 갱신 함수 (날짜/요일 필터 적용) ★★★
async function refreshSiteStructureCache(groupId) {
    console.log(`🔄 캐시 갱신 시작 (groupId=${groupId || 'all'})`);
    try {
        // ★ meal-management/init API 사용 (날짜/요일 필터 적용됨)
        const workDate = document.getElementById('meal-count-date')?.value ||
                         new Date().toISOString().split('T')[0];
        const siteId = groupId || getCurrentGroupId();

        const response = await fetch(`/api/meal-management/init?site_id=${siteId}&date=${workDate}&_t=${Date.now()}`);
        const result = await response.json();

        if (!result.success) {
            console.error('캐시 갱신 실패:', result.error);
            // 폴백: v2 API 사용 (필터 없음)
            return await refreshSiteStructureCacheV2(groupId);
        }

        // 1. categorySlotsCache 갱신 (이미 필터링된 데이터)
        if (result.slots) {
            Object.entries(result.slots).forEach(([catName, slots]) => {
                categorySlotsCache[catName] = slots;
            });
        }

        // 2. slotClientsCache 갱신 (이미 필터링된 데이터)
        if (result.slotClients) {
            // 기존 캐시 초기화 후 새 데이터로 교체
            Object.keys(slotClientsCache).forEach(key => delete slotClientsCache[key]);
            Object.assign(slotClientsCache, result.slotClients);
        }

        const slotCount = Object.values(result.slots || {}).flat().length;
        const clientCount = Object.values(result.slotClients || {})
            .flatMap(slots => Object.values(slots).flat()).length;
        console.log(`✅ 캐시 갱신 완료 (날짜=${workDate}, 요일필터 적용): 슬롯=${slotCount}개, 사업장=${clientCount}개`);

        return { slots: result.slots, clients: result.slotClients };
    } catch (error) {
        console.error('캐시 갱신 오류:', error);
    }
}

// 폴백용 v2 API 캐시 갱신 (필터 없음)
async function refreshSiteStructureCacheV2(groupId) {
    console.log(`🔄 [v2 폴백] 캐시 갱신 (필터 없음)`);
    try {
        const params = groupId ? `?group_id=${groupId}` : '';
        const [slotsRes, clientsRes] = await Promise.all([
            fetch(`/api/v2/slots${params}`),
            fetch(`/api/v2/clients${params}`)
        ]);

        const slotsData = await slotsRes.json();
        const clientsData = await clientsRes.json();

        if (!slotsData.success || !clientsData.success) {
            console.error('v2 캐시 갱신 실패');
            return;
        }

        // categorySlotsCache 갱신
        const newSlotsCache = {};
        slotsData.data.forEach(slot => {
            const catId = slot.category_id;
            const catName = slot.category_name;
            const legacySlot = {
                slot_id: slot.id,
                slot_key: slot.slot_code || `slot_${slot.id}`,
                display_name: slot.slot_name,
                sort_order: slot.display_order || 0,
                target_cost: slot.target_cost || 0,
                selling_price: slot.selling_price || 0
            };
            if (!newSlotsCache[catId]) newSlotsCache[catId] = [];
            if (!newSlotsCache[catName]) newSlotsCache[catName] = [];
            newSlotsCache[catId].push(legacySlot);
            if (catName && catName !== String(catId)) {
                newSlotsCache[catName].push(legacySlot);
            }
        });
        Object.assign(categorySlotsCache, newSlotsCache);

        // ★ C-4: slotClientsCache 갱신 (기존 캐시 초기화 후 새 데이터)
        const newClientsCache = {};
        clientsData.data.forEach(client => {
            const catName = client.category_name;
            const slotName = client.slot_name || (slotsData.data.find(s => s.id === client.slot_id)?.slot_name);
            if (catName && slotName && client.client_name) {
                if (!newClientsCache[catName]) newClientsCache[catName] = {};
                if (!newClientsCache[catName][slotName]) newClientsCache[catName][slotName] = [];
                if (!newClientsCache[catName][slotName].includes(client.client_name)) {
                    newClientsCache[catName][slotName].push(client.client_name);
                }
            }
        });
        Object.keys(slotClientsCache).forEach(key => delete slotClientsCache[key]);
        Object.assign(slotClientsCache, newClientsCache);

        console.log(`✅ [v2 폴백] 캐시 갱신 완료`);
        return { slots: slotsData.data, clients: clientsData.data };
    } catch (error) {
        console.error('v2 캐시 갱신 오류:', error);
    }
}

// 식시별 기본 메뉴 구조 (동적으로 구성됨)
let defaultMenuStructure = {};

// ★★★ 상태 리셋 함수 - 날짜/사업장 변경 시 호출 ★★★
function resetPageState() {
    console.log('🔄 페이지 상태 리셋');

    // 1. 전역 변수 초기화
    businessTypes = [];
    currentTabIndex = 0;
    defaultMenuStructure = {};
    categorySlots = [];
    previousDayDataCache = null;  // ★ 전날 데이터 캐시도 초기화
    previousDayDateCache = null;
    // ★ C-3: slotClientsCache 초기화 (날짜 변경 시 캐시 갱신 보장)
    Object.keys(slotClientsCache).forEach(key => delete slotClientsCache[key]);
    // categorySlotsCache, categoryNameToIdMap은 유지 (성능)

    // 2. DOM 초기화 - 테이블 컨테이너
    const container = document.getElementById('foodCountTables');
    if (container) container.innerHTML = '';

    // 3. DOM 초기화 - 탭 컨테이너
    const tabsContainer = document.getElementById('businessTabs');
    if (tabsContainer) tabsContainer.innerHTML = '';

    // 4. DOM 초기화 - 탭 버튼 컨테이너
    const tabButtons = document.getElementById('tab-buttons');
    if (tabButtons) tabButtons.innerHTML = '';

    // 5. 요약 통계 초기화
    updateSummaryStats();

    console.log('✅ 페이지 상태 리셋 완료');
}

// ★★★ 헬퍼 함수: 문자열 정규화 ★★★
function normalizeString(str) {
    return (str || '').trim().replace(/\s+/g, ' ').normalize('NFC');
}

// ★★★ 헬퍼 함수: 카테고리 탭 인덱스 찾기 (정규화된 매칭) ★★★
function findCategoryTabIndex(categoryName) {
    if (!categoryName || !businessTypes || businessTypes.length === 0) {
        return -1;
    }
    const normalized = normalizeString(categoryName);
    // 1. 정확 매칭 시도
    let idx = businessTypes.indexOf(categoryName);
    if (idx >= 0) return idx;
    // 2. 정규화 매칭 시도
    idx = businessTypes.findIndex(t => normalizeString(t) === normalized);
    if (idx >= 0) return idx;
    // 3. 포함 매칭 시도 (부분 일치)
    idx = businessTypes.findIndex(t =>
        normalizeString(t).includes(normalized) || normalized.includes(normalizeString(t))
    );
    return idx;
}

// ★★★ 헬퍼 함수: 슬롯 캐시에서 슬롯 찾기 ★★★
function findSlotInCache(categoryIdOrName, slotName) {
    const keys = [categoryIdOrName, String(categoryIdOrName)];
    for (const key of keys) {
        if (categorySlotsCache[key]) {
            const slots = categorySlotsCache[key];
            const found = slots.find(s =>
                s.display_name === slotName || s.slot_name === slotName
            );
            if (found) return { cacheKey: key, slot: found, slots };
        }
    }
    return null;
}

// ★★★ 헬퍼 함수: 슬롯 캐시에서 슬롯 제거 ★★★
function removeSlotFromCache(slotName) {
    for (const key in categorySlotsCache) {
        const slots = categorySlotsCache[key];
        if (Array.isArray(slots)) {
            const idx = slots.findIndex(s =>
                s.display_name === slotName || s.slot_name === slotName || s === slotName
            );
            if (idx > -1) {
                slots.splice(idx, 1);
                console.log(`✅ categorySlotsCache에서 삭제: ${key} > ${slotName}`);
            }
        }
    }
}

// ★★★ 헬퍼 함수: 날짜 범위 체크 ★★★
function checkDateRange(targetDate, startDate, endDate) {
    // targetDate: 현재 화면의 날짜 (YYYY-MM-DD)
    // startDate, endDate: 사업장 운영기간 (YYYY-MM-DD 또는 null/빈값)
    if (!targetDate) return true;  // 날짜가 없으면 항상 true

    const target = new Date(targetDate);

    // start_date 체크: NULL이거나 targetDate 이전이면 OK
    if (startDate) {
        const start = new Date(startDate);
        if (target < start) return false;  // 아직 시작 전
    }

    // end_date 체크: NULL이거나 targetDate 이후이면 OK
    if (endDate) {
        const end = new Date(endDate);
        if (target > end) return false;  // 이미 종료됨
    }

    return true;  // 범위 내
}

// 카테고리 이름 → ID 매핑 로드 (현재 사이트의 그룹 기준)
async function loadCategoryNameMapping(groupId) {
    try {
        const response = await fetch('/api/admin/structure/tree');
        const data = await response.json();
        if (data.success && data.data) {
            categoryNameToIdMap = {};

            // 현재 그룹 찾기 (groupId가 없으면 첫 번째 그룹 사용)
            let targetGroup = data.data[0];
            if (groupId) {
                targetGroup = data.data.find(g => g.id === groupId) || data.data[0];
            }

            // 현재 그룹의 카테고리만 매핑
            if (targetGroup) {
                (targetGroup.categories || []).forEach(cat => {
                    categoryNameToIdMap[cat.name] = cat.id;
                });
                console.log(`📋 카테고리 매핑 로드 (${targetGroup.name}):`, categoryNameToIdMap);
                // ★ 슬롯 데이터는 meal-management/init 통합 API에서 받음 (중복 호출 제거)
            }
        }
    } catch (e) {
        console.error('카테고리 매핑 로드 오류:', e);
    }
}

// 카테고리 기반 동적 메뉴 구조 생성
function buildMenuStructureFromCategory(mealTypes, mealItems) {
    const structure = {};
    // 각 mealType(식시)에 대해 mealItems(메뉴유형)를 메뉴로 생성
    mealTypes.forEach(mealType => {
        structure[mealType] = [{
            mealType: mealType,
            menus: mealItems.length > 0 ? mealItems : ['일반']
        }];
    });
    return structure;
}

// 카테고리별 슬롯 로드 (식단가 관리에서 정의된 슬롯)
// categoryId가 없으면 siteId로 카테고리를 조회
async function loadCategorySlots(categoryId, siteId) {
    let effectiveCategoryId = categoryId;

    // category_id가 없고 site_id가 있으면 사이트의 카테고리 조회
    if (!effectiveCategoryId && siteId) {
        console.log(`🔍 site_id=${siteId}에서 category_id 조회 중...`);
        try {
            const response = await fetch(`/api/meal-slot-settings?site_id=${siteId}`);
            const data = await response.json();
            // entity_type이 'category'인 슬롯 찾기
            if (data.success && data.settings) {
                const slots = Object.values(data.settings);
                const categorySlot = slots.find(s => s.entity_type === 'category' && s.entity_id);
                if (categorySlot) {
                    effectiveCategoryId = categorySlot.entity_id;
                    console.log(`✅ site_id=${siteId} → category_id=${effectiveCategoryId} 발견`);
                } else {
                    console.log('⚠️ category 타입 슬롯 없음, 슬롯 목록:', slots.map(s => `${s.entity_type}:${s.entity_id}`));
                }
            }
        } catch (e) {
            console.error('카테고리 조회 오류:', e);
        }
    }

    if (!effectiveCategoryId) {
        console.log('⚠️ category_id 없음, 슬롯 로드 스킵');
        categorySlots = [];
        return [];
    }

    try {
        // ★★★ Phase 4: v2 API 사용 ★★★
        console.log(`🔄 [v2] 슬롯 로드 시작: category_id=${effectiveCategoryId}`);
        const response = await fetch(`/api/v2/slots?category_id=${effectiveCategoryId}`);
        const data = await response.json();

        if (data.success && data.data) {
            // v2 응답 포맷을 레거시 포맷으로 변환 (meal_type 포함)
            categorySlots = data.data.map(slot => ({
                slot_id: slot.id,
                slot_key: slot.slot_code || `slot_${slot.id}`,
                display_name: slot.slot_name,
                sort_order: slot.display_order || 0,
                target_cost: slot.target_cost || 0,
                selling_price: slot.selling_price || 0,
                meal_type: slot.meal_type || '중식'  // ★ 끼니 타입 추가
            }));
            console.log(`✅ [v2] 카테고리 ${effectiveCategoryId} 슬롯 로드:`, categorySlots.length, '개', categorySlots.map(s => s.display_name));

            // 기존 드롭다운 업데이트
            updateAllSlotDropdowns();

            return categorySlots;
        }
    } catch (error) {
        console.error('슬롯 로드 오류:', error);
    }

    categorySlots = [];
    return [];
}

// 모든 슬롯 드롭다운 업데이트
function updateAllSlotDropdowns() {
    const selects = document.querySelectorAll('.menu-name-select');
    console.log(`🔄 드롭다운 업데이트: ${selects.length}개`);

    selects.forEach(select => {
        const currentValue = select.value;

        // ★ 드롭다운이 속한 테이블에서 categoryId 가져오기
        let categoryId = null;
        const table = select.closest('.food-count-table');
        if (table && table.id) {
            const tabIndex = parseInt(table.id.replace('table-', ''));
            if (!isNaN(tabIndex) && businessTypes[tabIndex]) {
                const categoryName = businessTypes[tabIndex];
                categoryId = categoryNameToIdMap[categoryName];
            }
        }

        select.innerHTML = buildSlotOptions(currentValue, categoryId);
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

// 슬롯 드롭다운 옵션 생성 (display_name을 value로 사용)
function buildSlotOptions(selectedValue, categoryId = null, categoryName = null) {
    // 카테고리 ID/이름으로 캐시 조회, 없으면 전역 categorySlots
    let slots = categorySlots;

    // categoryName이 직접 주어진 경우
    if (categoryName && categorySlotsCache[categoryName]) {
        slots = categorySlotsCache[categoryName];
    } else if (categoryId) {
        const catName = Object.keys(categoryNameToIdMap).find(
            name => categoryNameToIdMap[name] == categoryId
        );
        slots = categorySlotsCache[categoryId] ||
                categorySlotsCache[String(categoryId)] ||
                (catName ? categorySlotsCache[catName] : null) ||
                categorySlots;
    }

    // ★ 여전히 비어있으면 캐시의 첫 번째 항목 사용
    if ((!slots || slots.length === 0) && Object.keys(categorySlotsCache).length > 0) {
        const firstKey = Object.keys(categorySlotsCache)[0];
        slots = categorySlotsCache[firstKey] || [];
    }

    if (!slots || slots.length === 0) {
        return '<option value="">끼니를 선택하세요</option>';
    }

    // ★★★ 카테고리 이름 가져오기 (slotClientsCache 확인용) ★★★
    if (!categoryName && categoryId) {
        for (const [name, id] of Object.entries(categoryNameToIdMap)) {
            if (String(id) === String(categoryId)) {
                categoryName = name;
                break;
            }
        }
    }

    let options = '<option value="">끼니 선택</option>';
    slots.forEach(slot => {
        // ★ display_name 우선, 없으면 slot_name 사용 (fallback)
        const displayText = slot.display_name || slot.slot_name || '';
        if (!displayText) return;  // 둘 다 없으면 스킵

        // ★★★ 해당 슬롯에 사업장이 있는지 확인 ★★★
        // slotClientsCache에 사업장이 없으면 드롭다운에서 제외
        if (categoryName) {
            const categoryClients = slotClientsCache[categoryName];
            if (categoryClients) {
                const clients = categoryClients[displayText];
                if (!clients || clients.length === 0) {
                    // 현재 선택된 값이 아니면 스킵
                    if (displayText !== selectedValue) {
                        console.log(`🚫 슬롯 필터링: ${categoryName} > ${displayText} (사업장 없음)`);
                        return;
                    }
                }
            }
        }

        const selected = displayText === selectedValue ? 'selected' : '';
        const slotMealType = slot.meal_type || '중식';
        options += `<option value="${displayText}" data-meal-type="${slotMealType}" ${selected}>${displayText}</option>`;
    });

    return options;
}

// 탭 동적 생성 함수
function createBusinessTabs() {
    const tabsContainer = document.getElementById('businessTabs');
    tabsContainer.innerHTML = '';

    // 아이콘 매핑
    const iconMap = {
        '조식': 'fa-sun',
        '중식': 'fa-cloud-sun',
        '석식': 'fa-moon',
        '간식': 'fa-cookie',
        '야식': 'fa-star',
        '행사': 'fa-calendar-alt'
    };

    businessTypes.forEach((type, index) => {
        const icon = iconMap[type] || 'fa-utensils';
        const btn = document.createElement('button');
        btn.className = 'business-tab' + (index === currentTabIndex ? ' active' : '');
        btn.setAttribute('data-tab', index);
        btn.setAttribute('data-category', type);
        btn.innerHTML = `
            <span onclick="switchBusinessTab('${type}', ${index})">
                <i class="fas ${icon}"></i> ${type}
            </span>
        `;
        tabsContainer.appendChild(btn);
    });

    console.log('✅ 탭 생성 완료:', businessTypes);
}

// ========================
// 카테고리 관리 함수
// ========================
let editingCategoryIndex = -1;  // 수정 중인 카테고리 인덱스 (-1이면 새로 추가)

function showAddCategoryModal() {
    editingCategoryIndex = -1;
    document.getElementById('categoryModalTitle').textContent = '카테고리 추가';
    document.getElementById('categoryNameInput').value = '';
    document.getElementById('categoryModal').classList.add('show');
    document.getElementById('categoryNameInput').focus();
}

function editCategory(index) {
    editingCategoryIndex = index;
    document.getElementById('categoryModalTitle').textContent = '카테고리 수정';
    document.getElementById('categoryNameInput').value = businessTypes[index];
    document.getElementById('categoryModal').classList.add('show');
    document.getElementById('categoryNameInput').focus();
}

function closeCategoryModal() {
    document.getElementById('categoryModal').classList.remove('show');
    editingCategoryIndex = -1;
}

// ★★★ 경고 모달 표시 함수 ★★★
function showWarningModal(title, htmlContent) {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('warningModal');
    if (existingModal) existingModal.remove();

    const modalHtml = `
        <div id="warningModal" class="modal show" style="display:flex; align-items:center; justify-content:center; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:10000;">
            <div class="modal-content" style="background:white; border-radius:12px; padding:20px; max-width:600px; width:90%; max-height:80vh; overflow:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0; color:#e74c3c;">⚠️ ${title}</h3>
                    <button onclick="closeWarningModal()" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999;">&times;</button>
                </div>
                <div>${htmlContent}</div>
                <div style="text-align:center; margin-top:20px;">
                    <button onclick="closeWarningModal()" style="padding:10px 30px; background:#3498db; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px;">확인</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeWarningModal() {
    const modal = document.getElementById('warningModal');
    if (modal) modal.remove();
}

// ★★★ 사업장명 불일치 수정 함수 ★★★
async function fixSiteName(idx) {
    const select = document.getElementById(`fix-select-${idx}`);
    if (!select) return;

    const newSiteName = select.value;
    const slotName = select.dataset.slot;
    const oldSiteName = select.dataset.old;
    const workDate = window._mismatchWorkDate;

    if (!newSiteName) {
        showToast('⚠️ 수정할 사업장을 선택해주세요.', 'warning', 2000);
        return;
    }

    try {
        const response = await fetch('/api/meal-counts/fix-site-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                work_date: workDate,
                menu_name: slotName,
                old_site_name: oldSiteName,
                new_site_name: newSiteName
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast(`✅ ${result.message}`, 'success', 2000);
            // 해당 행 성공 표시
            const row = document.getElementById(`mismatch-row-${idx}`);
            if (row) {
                row.style.backgroundColor = '#d4edda';
                row.innerHTML = `<td colspan="4" style="padding:8px; text-align:center; color:#155724;">
                    ✓ ${slotName} > "${oldSiteName}" → "${newSiteName}" 수정 완료
                </td>`;
            }
            // 캐시 무효화
            const siteId = getCurrentSiteId();
            const cacheKey = `${siteId}_${workDate}`;
            siteDataCache.delete(cacheKey);
        } else {
            showToast(`❌ 수정 실패: ${result.error}`, 'error', 3000);
        }
    } catch (error) {
        console.error('수정 오류:', error);
        showToast('❌ 서버 연결 오류', 'error', 3000);
    }
}

// ★★★ 전체 사업장명 일괄 수정 ★★★
async function fixAllSiteNames() {
    const selects = document.querySelectorAll('[id^="fix-select-"]');
    let fixCount = 0;
    let errorCount = 0;

    for (const select of selects) {
        if (select.value) {
            const idx = select.id.replace('fix-select-', '');
            const slotName = select.dataset.slot;
            const oldSiteName = select.dataset.old;
            const newSiteName = select.value;
            const workDate = window._mismatchWorkDate;

            try {
                const response = await fetch('/api/meal-counts/fix-site-name', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        work_date: workDate,
                        menu_name: slotName,
                        old_site_name: oldSiteName,
                        new_site_name: newSiteName
                    })
                });

                const result = await response.json();
                if (result.success) {
                    fixCount++;
                    const row = document.getElementById(`mismatch-row-${idx}`);
                    if (row) {
                        row.style.backgroundColor = '#d4edda';
                        row.innerHTML = `<td colspan="4" style="padding:8px; text-align:center; color:#155724;">
                            ✓ ${slotName} > "${oldSiteName}" → "${newSiteName}" 수정 완료
                        </td>`;
                    }
                } else {
                    errorCount++;
                }
            } catch (error) {
                errorCount++;
            }
        }
    }

    if (fixCount > 0) {
        showToast(`✅ ${fixCount}건 수정 완료` + (errorCount > 0 ? `, ${errorCount}건 실패` : ''), 'success', 3000);
        // 캐시 무효화
        const siteId = getCurrentSiteId();
        const workDate = window._mismatchWorkDate;
        const cacheKey = `${siteId}_${workDate}`;
        siteDataCache.delete(cacheKey);
    } else if (errorCount > 0) {
        showToast(`❌ ${errorCount}건 수정 실패`, 'error', 3000);
    } else {
        showToast('⚠️ 수정할 항목을 선택해주세요.', 'warning', 2000);
    }
}

async function saveCategory() {
    const name = document.getElementById('categoryNameInput').value.trim();
    if (!name) {
        alert('카테고리명을 입력해주세요.');
        return;
    }

    if (editingCategoryIndex === -1) {
        // 새 카테고리 추가
        if (businessTypes.includes(name)) {
            alert('이미 존재하는 카테고리입니다.');
            return;
        }
        businessTypes.push(name);
        currentMealTypes.push(name);
        // 새 카테고리에 대한 기본 메뉴 구조 추가
        defaultMenuStructure[name] = [{
            mealType: name,
            menus: currentMealItems.length > 0 ? [...currentMealItems] : ['일반']
        }];
        console.log(`✅ 카테고리 추가: ${name}`);
    } else {
        // 기존 카테고리 수정
        const oldName = businessTypes[editingCategoryIndex];
        if (oldName !== name) {
            // 🔄 DB의 기존 데이터도 함께 업데이트
            try {
                const response = await fetch('/api/meal-counts/rename-category', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        old_name: oldName,
                        new_name: name,
                        site_id: currentSiteId
                    })
                });
                const result = await response.json();
                if (result.success) {
                    console.log(`✅ DB 카테고리 업데이트: ${result.updated}개 레코드`);
                } else {
                    console.error('❌ DB 카테고리 업데이트 실패:', result.error);
                    alert('카테고리 변경 중 오류가 발생했습니다: ' + result.error);
                    return;
                }
            } catch (error) {
                console.error('❌ 카테고리 변경 API 호출 실패:', error);
                alert('서버 연결 오류가 발생했습니다.');
                return;
            }

            // 메뉴 구조에서 이름 변경
            if (defaultMenuStructure[oldName]) {
                defaultMenuStructure[name] = defaultMenuStructure[oldName];
                delete defaultMenuStructure[oldName];
            }
            // foodCountDataByCategory에서도 이름 변경
            if (foodCountDataByCategory[oldName]) {
                foodCountDataByCategory[name] = foodCountDataByCategory[oldName];
                delete foodCountDataByCategory[oldName];
            }
            businessTypes[editingCategoryIndex] = name;
            const mealTypeIndex = currentMealTypes.indexOf(oldName);
            if (mealTypeIndex > -1) {
                currentMealTypes[mealTypeIndex] = name;
            }
            console.log(`✅ 카테고리 수정: ${oldName} → ${name}`);
        }
    }

    closeCategoryModal();
    createBusinessTabs();
    createFoodCountTables();
    updateSummaryStats();
}

function deleteCategory(index) {
    if (businessTypes.length <= 1) {
        alert('최소 1개의 카테고리가 필요합니다.');
        return;
    }

    const name = businessTypes[index];
    if (!confirm(`'${name}' 카테고리를 삭제하시겠습니까?\n해당 카테고리의 식수 데이터도 함께 삭제됩니다.`)) {
        return;
    }

    // 삭제
    businessTypes.splice(index, 1);
    const mealTypeIndex = currentMealTypes.indexOf(name);
    if (mealTypeIndex > -1) {
        currentMealTypes.splice(mealTypeIndex, 1);
    }
    delete defaultMenuStructure[name];

    // 탭 인덱스 조정
    if (currentTabIndex >= businessTypes.length) {
        currentTabIndex = businessTypes.length - 1;
    }

    console.log(`✅ 카테고리 삭제: ${name}`);
    createBusinessTabs();
    createFoodCountTables();
    updateSummaryStats();
}

// Enter 키로 저장
document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.getElementById('categoryModal').classList.contains('show')) {
        saveCategory();
    }
    if (e.key === 'Escape' && document.getElementById('categoryModal').classList.contains('show')) {
        closeCategoryModal();
    }
});

// ========================
// 로딩 오버레이 함수
// ========================
function showLoading(text = '데이터 로딩 중...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (overlay) {
        loadingText.textContent = text;
        overlay.style.display = 'flex';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// ★ 토스트 메시지 (빠른 피드백)
function showToast(message, type = 'success', duration = 2000) {
    // 기존 토스트 제거
    const existing = document.getElementById('toastMessage');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toastMessage';
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        padding: 15px 25px; border-radius: 8px; color: white;
        font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
    `;
    toast.innerHTML = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ========================
// 현재 날짜/시간 표시
// ========================
function updateDateTime() {
    const now = new Date();
    const dateTimeString = now.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    document.getElementById('currentDateTime').textContent = dateTimeString;
}

// ========================
// 날짜 관련 함수
// ========================
// 로컬 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function changeDate(days) {
    const dateInput = document.getElementById('meal-count-date');
    const currentDate = new Date(dateInput.value);
    currentDate.setDate(currentDate.getDate() + days);
    dateInput.value = getLocalDateString(currentDate);
    loadFoodCountData();
}

function setToday() {
    // 기본값은 내일 (익일 기준)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('meal-count-date').value = getLocalDateString(tomorrow);
    loadFoodCountData();
}

// ========================
// 탭 전환 함수
// ========================
async function switchBusinessTab(businessType, tabIndex) {
    currentTabIndex = tabIndex;

    // 탭 버튼 활성화 상태 변경
    document.querySelectorAll('.business-tab').forEach((tab, index) => {
        tab.classList.toggle('active', index === tabIndex);
    });

    // 테이블 표시/숨김
    document.querySelectorAll('.food-count-table').forEach((table, index) => {
        table.style.display = index === tabIndex ? 'block' : 'none';
    });

    // ★ 해당 카테고리의 슬롯 로드
    await loadSlotsForCategory(businessType);

    // 현재 탭의 드롭다운만 업데이트
    updateTabSlotDropdowns(tabIndex);

    updateSummaryStats();
}

// 카테고리 이름으로 슬롯 로드
async function loadSlotsForCategory(categoryName) {
    // ★ 이름으로 먼저 캐시 확인 (통합 API에서 이름으로 저장됨)
    if (categorySlotsCache[categoryName]) {
        categorySlots = categorySlotsCache[categoryName];
        console.log(`⚡ 캐시에서 슬롯 로드: ${categoryName} - ${categorySlots.length}개`);
        return;
    }

    const categoryId = categoryNameToIdMap[categoryName];
    if (!categoryId) {
        console.log(`⚠️ 카테고리 "${categoryName}" ID를 찾을 수 없음`);
        categorySlots = [];
        return;
    }

    // ID로 캐시 확인
    if (categorySlotsCache[categoryId]) {
        categorySlots = categorySlotsCache[categoryId];
        console.log(`⚡ 캐시에서 슬롯 로드: ${categoryName}(${categoryId}) - ${categorySlots.length}개`);
        return;
    }

    // ★★★ Phase 4: v2 API 사용 ★★★
    try {
        const response = await fetch(`/api/v2/slots?category_id=${categoryId}`);
        const data = await response.json();
        if (data.success && data.data) {
            // v2 응답 포맷을 레거시 포맷으로 변환 (meal_type 포함)
            categorySlots = data.data.map(slot => ({
                slot_id: slot.id,
                slot_key: slot.slot_code || `slot_${slot.id}`,
                display_name: slot.slot_name,
                sort_order: slot.display_order || 0,
                target_cost: slot.target_cost || 0,
                selling_price: slot.selling_price || 0,
                meal_type: slot.meal_type || '중식'  // ★ 끼니 타입 추가
            }));
            categorySlotsCache[categoryId] = categorySlots;
            console.log(`✅ [v2] 슬롯 로드: ${categoryName}(${categoryId}) - ${categorySlots.length}개`);
        } else {
            categorySlots = [];
        }
    } catch (e) {
        console.error(`슬롯 로드 오류 (${categoryName}):`, e);
        categorySlots = [];
    }
}

// 특정 탭의 드롭다운만 업데이트
function updateTabSlotDropdowns(tabIndex) {
    const table = document.getElementById(`table-${tabIndex}`);
    if (!table) {
        console.log(`⚠️ 탭 ${tabIndex} 테이블을 찾을 수 없음`);
        return;
    }

    // 탭의 카테고리 ID 가져오기
    const categoryName = businessTypes[tabIndex];
    const categoryId = categoryNameToIdMap[categoryName];
    const slots = categorySlotsCache[categoryId] || categorySlotsCache[categoryName] || [];

    const selects = table.querySelectorAll('.menu-name-select');
    console.log(`🔄 탭 ${tabIndex} (${categoryName}) 드롭다운 업데이트: ${selects.length}개, 슬롯: ${slots.length}개, catId=${categoryId}`);

    if (selects.length === 0) {
        console.log(`⚠️ 탭 ${tabIndex}에 드롭다운이 없음`);
        return;
    }

    selects.forEach(select => {
        const currentValue = select.value;
        const newOptions = buildSlotOptions(currentValue, categoryId, categoryName);
        select.innerHTML = newOptions;
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

// ========================
// 테이블 생성 함수
// ========================
function createFoodCountTables() {
    const container = document.getElementById('foodCountTables');
    container.innerHTML = '';

    // 탭이 없으면 기본 입력 UI 표시
    if (businessTypes.length === 0) {
        const defaultTable = createDefaultTable();
        container.appendChild(defaultTable);
        return;
    }

    businessTypes.forEach((businessType, tabIndex) => {
        const table = createBusinessTable(businessType, tabIndex);
        container.appendChild(table);
    });
}

// 탭이 없을 때 기본 입력 테이블 생성
function createDefaultTable() {
    const tableDiv = document.createElement('div');
    tableDiv.className = 'food-count-table';
    tableDiv.id = 'table-default';
    tableDiv.style.display = 'block';

    // 테이블 헤더
    const header = document.createElement('div');
    header.className = 'table-header';
    header.innerHTML = `
        <span class="title"><i class="fas fa-clipboard-list"></i> 식수입력</span>
        <button class="add-menu-btn" onclick="addDefaultMenuSection()">
            <i class="fas fa-plus"></i> 끼니 추가
        </button>
    `;
    tableDiv.appendChild(header);

    // 메뉴 섹션들
    const menuSections = document.createElement('div');
    menuSections.className = 'menu-sections';
    menuSections.id = 'menu-sections-default';

    // 기본 끼니 유형: currentMealTypes 사용 (기본 1개 - 중식)
    currentMealTypes.forEach((mealType, index) => {
        const section = createMenuSection(0, index, 0, mealType, '일반');
        menuSections.appendChild(section);
    });

    tableDiv.appendChild(menuSections);
    return tableDiv;
}

// 기본 테이블에 끼니 추가
function addDefaultMenuSection() {
    const menuSections = document.getElementById('menu-sections-default');
    if (!menuSections) return;

    const sectionCount = menuSections.children.length;
    const section = createMenuSection(0, sectionCount, 0, '중식', '일반');
    menuSections.appendChild(section);
    updateSummaryStats();
}

function createBusinessTable(businessType, tabIndex) {
    const tableDiv = document.createElement('div');
    tableDiv.className = 'food-count-table';
    tableDiv.id = `table-${tabIndex}`;
    tableDiv.style.display = tabIndex === currentTabIndex ? 'block' : 'none';

    // 테이블 헤더
    const header = document.createElement('div');
    header.className = 'table-header';
    header.innerHTML = `
        <span class="title"><i class="fas fa-clipboard-list"></i> ${businessType} 식수입력</span>
        <button class="add-menu-btn" onclick="addMenuSection(${tabIndex})">
            <i class="fas fa-plus"></i> 끼니 추가
        </button>
    `;
    tableDiv.appendChild(header);

    // 메뉴 섹션들
    const menuSections = document.createElement('div');
    menuSections.className = 'menu-sections';
    menuSections.id = `menu-sections-${tabIndex}`;

    // 기본 메뉴 구조 생성
    const structure = defaultMenuStructure[businessType] || [{ mealType: '중식', menus: ['메뉴1'] }];
    structure.forEach((mealGroup, groupIndex) => {
        mealGroup.menus.forEach((menuName, menuIndex) => {
            const section = createMenuSection(tabIndex, groupIndex, menuIndex, mealGroup.mealType, menuName);
            menuSections.appendChild(section);
        });
    });

    tableDiv.appendChild(menuSections);
    return tableDiv;
}

// mealType 옵션을 동적으로 생성하는 헬퍼 함수
function buildMealTypeOptions(selectedMealType) {
    return currentMealTypes.map(mt =>
        `<option value="${mt}" ${mt === selectedMealType ? 'selected' : ''}>${mt}</option>`
    ).join('');
}

// ★ 슬롯명으로 meal_type 조회 (category_slots 캐시 기준)
function getMealTypeForSlot(slotName, categoryId) {
    // categorySlotsCache 키가 카테고리 이름(예: "운반")일 수 있으므로
    // categoryId(숫자)와 카테고리 이름 모두로 조회
    const categoryName = Object.keys(categoryNameToIdMap).find(
        name => categoryNameToIdMap[name] == categoryId
    );
    const slots = categorySlotsCache[categoryId] ||
                  categorySlotsCache[String(categoryId)] ||
                  (categoryName ? categorySlotsCache[categoryName] : null) ||
                  categorySlots || [];
    const found = slots.find(s => (s.display_name || s.slot_name) === slotName);
    return found?.meal_type || '중식';
}

// ★ meal_type 색상 매핑 (공통 상수)
const MEAL_TYPE_COLORS = {
    '조식': '#ff9800', '중식': '#2196f3', '석식': '#9c27b0', '야식': '#607d8b'
};

// ★ 섹션에서 meal_type 조회 (category_slots 마스터 기준, 배지가 아닌 마스터 데이터 사용)
function getSectionMealType(section) {
    const menuName = (section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input'))?.value || '';
    if (!menuName) return '중식';

    const table = section.closest('[id^="table-"]');
    if (!table) return '중식';
    const tabIndex = parseInt(table.id.replace('table-', ''));
    const categoryName = businessTypes[tabIndex];
    const categoryId = categoryNameToIdMap[categoryName];

    return getMealTypeForSlot(menuName, categoryId);
}

// ★ 배지 UI 업데이트 (표시용)
function updateMealTypeBadge(badge, mealType) {
    if (!badge) return;
    badge.dataset.mealType = mealType;
    badge.textContent = mealType;
    badge.style.background = MEAL_TYPE_COLORS[mealType] || '#2196f3';
}

// ★ 화면의 모든 meal_type 배지를 category_slots 캐시 기준으로 일괄 갱신
function refreshAllMealTypeBadges() {
    let updated = 0, total = 0;
    document.querySelectorAll('.menu-section').forEach(section => {
        const badge = section.querySelector('.meal-type-badge');
        if (!badge) return;
        total++;
        const newMealType = getSectionMealType(section);
        const oldMealType = badge.dataset.mealType;
        // ★ 항상 업데이트 (캐시가 갱신된 후이므로 최신 값 반영)
        updateMealTypeBadge(badge, newMealType);
        if (oldMealType !== newMealType) {
            updated++;
            const menuName = (section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input'))?.value || '';
            console.log(`🔄 배지 갱신: ${menuName} ${oldMealType} → ${newMealType}`);
        }
    });
    console.log(`✅ 배지 갱신 완료: ${total}개 중 ${updated}개 변경`);
}

function createMenuSection(tabIndex, groupIndex, menuIndex, mealType, menuName) {
    const sectionId = `section-${tabIndex}-${groupIndex}-${menuIndex}`;
    const section = document.createElement('div');
    section.className = 'menu-section';
    section.id = sectionId;

    // 드래그 앤 드롭 설정
    section.draggable = true;
    section.addEventListener('dragstart', handleDragStart);
    section.addEventListener('dragend', handleDragEnd);
    section.addEventListener('dragover', handleDragOver);
    section.addEventListener('drop', handleDrop);
    section.addEventListener('dragleave', handleDragLeave);

    // 슬롯 드롭다운 옵션 생성 (해당 탭의 카테고리 슬롯 사용)
    const categoryName = businessTypes[tabIndex];
    const categoryId = categoryNameToIdMap[categoryName];
    const slotOptions = buildSlotOptions(menuName, categoryId, categoryName);

    // ★ meal_type을 슬롯 마스터 데이터에서 자동 결정
    const resolvedMealType = menuName ? getMealTypeForSlot(menuName, categoryId) : (mealType || '중식');

    // ★★★ slotClients에서 해당 슬롯의 기본 사업장 목록 가져오기 ★★★
    let defaultBusinessHtml = '';
    const slotClientsList = slotClientsCache[categoryName]?.[menuName] || [];
    if (slotClientsList.length > 0) {
        slotClientsList.forEach((clientName, idx) => {
            const itemId = sectionId + '-item-' + idx;
            defaultBusinessHtml += '<div class="business-input-item" id="' + itemId + '">' +
                '<div class="business-input-label">사업장명</div>' +
                '<input type="text" class="business-name-input" value="' + clientName + '" readonly style="background: #f5f5f5;">' +
                '<div class="business-input-label">식수</div>' +
                '<input type="number" class="business-count-input" placeholder="0" min="0" value="" ' +
                'onchange="updateSectionTotal(\'' + sectionId + '\')" oninput="updateSectionTotal(\'' + sectionId + '\')">' +
                '<div class="business-item-actions">' +
                '<button class="business-item-remove" onclick="removeBusinessItem(\'' + itemId + '\', \'' + sectionId + '\')">' +
                '<i class="fas fa-times"></i></button></div></div>';
        });
        console.log('📋 ' + menuName + ': slotClients ' + slotClientsList.length + '개');
    } else {
        defaultBusinessHtml = createDefaultBusinessItems(sectionId, 3);
    }

    section.innerHTML = `
        <div class="menu-header">
            <div class="menu-info">
                <div class="menu-top-row">
                    <span class="drag-handle" title="드래그하여 순서 변경"><i class="fas fa-grip-vertical"></i></span>
                    <select class="menu-name-select" onchange="updateMenuName('${sectionId}', this.value)"
                            style="min-width: 120px; padding: 4px 8px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px;">
                        ${slotOptions}
                    </select>
                    <span class="meal-type-badge" data-meal-type="${resolvedMealType}"
                          style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; color: #fff;
                                 background: ${MEAL_TYPE_COLORS[resolvedMealType] || '#2196f3'};">
                        ${resolvedMealType}
                    </span>
                    <span class="total-count" id="total-${sectionId}">0명</span>
                    <button class="remove-menu-btn" onclick="removeMenuSection('${sectionId}')" style="padding: 4px 8px; font-size: 11px;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="menu-match-row">
                    <span style="font-size: 11px; color: #999;">매칭:</span>
                    <input type="text" class="menu-match-input" value="" placeholder="매칭명"
                           onchange="updateMatchingName('${sectionId}', this.value)">
                </div>
            </div>
        </div>
        <div class="business-detail-container">
            <div class="business-input-grid" id="grid-${sectionId}">
                ${defaultBusinessHtml}
            </div>
        </div>
        <div class="section-side-actions">
            <button class="add-business-btn-vertical" onclick="addBusinessItem('${sectionId}')" title="사업장 추가">
                <i class="fas fa-plus"></i>
            </button>
        </div>
    `;

    // ★ select 값을 명시적으로 설정 (innerHTML selected 속성이 안 먹힐 수 있음)
    const menuNameSelect = section.querySelector('.menu-name-select');
    if (menuNameSelect && menuName) {
        menuNameSelect.value = menuName;
    }

    return section;
}

// ========================
// 드래그 앤 드롭 기능
// ========================
let draggedElement = null;

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.menu-section').forEach(section => {
        section.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('drag-over');

    if (draggedElement !== this) {
        const parent = this.parentNode;
        const allSections = [...parent.querySelectorAll('.menu-section')];
        const draggedIndex = allSections.indexOf(draggedElement);
        const dropIndex = allSections.indexOf(this);

        if (draggedIndex < dropIndex) {
            parent.insertBefore(draggedElement, this.nextSibling);
        } else {
            parent.insertBefore(draggedElement, this);
        }

        // 순서 변경 후 통계 업데이트
        updateSummaryStats();
        console.log('메뉴 순서 변경됨');
    }
}

function createDefaultBusinessItems(sectionId, count) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += createBusinessItemHtml(sectionId, i);
    }
    return html;
}

function createBusinessItemHtml(sectionId, index) {
    const itemId = `${sectionId}-item-${index}`;
    return `
        <div class="business-input-item" id="${itemId}">
            <div class="business-input-label">사업장명</div>
            <input type="text" class="business-name-input" placeholder="사업장명" readonly
                   style="background: #f5f5f5; cursor: not-allowed;"
                   title="사업장명은 Admin에서만 수정 가능합니다">
            <div class="business-input-label">식수</div>
            <input type="number" class="business-count-input" placeholder="0" min="0" value=""
                   onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
            <div class="business-item-actions">
                <button class="business-item-remove" onclick="removeBusinessItem('${itemId}', '${sectionId}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
}

// ========================
// 메뉴/사업장 관리 함수
// ========================
function addMenuSection(tabIndex) {
    const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
    const sectionCount = menuSections.children.length;
    const section = createMenuSection(tabIndex, sectionCount, 0, '중식', '새 메뉴');
    menuSections.appendChild(section);
}

function removeMenuSection(sectionId) {
    if (confirm('이 메뉴 섹션을 삭제하시겠습니까?')) {
        const section = document.getElementById(sectionId);
        if (section) {
            section.remove();
            updateSummaryStats();
        }
    }
}

function addBusinessItem(sectionId) {
    const grid = document.getElementById(`grid-${sectionId}`);
    const itemCount = grid.children.length;
    const newItem = document.createElement('div');
    newItem.className = 'business-input-item';
    newItem.id = `${sectionId}-item-${itemCount}`;
    newItem.innerHTML = `
        <div class="business-input-label">사업장명</div>
        <input type="text" class="business-name-input" placeholder="사업장명" readonly
               style="background: #f5f5f5; cursor: not-allowed;"
               title="사업장명은 Admin에서만 수정 가능합니다">
        <div class="business-input-label">식수</div>
        <input type="number" class="business-count-input" placeholder="0" min="0" value=""
               onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
        <div class="business-item-actions">
            <button class="business-item-remove" onclick="removeBusinessItem('${newItem.id}', '${sectionId}')">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    grid.appendChild(newItem);
}

function removeBusinessItem(itemId, sectionId) {
    const item = document.getElementById(itemId);
    if (item) {
        item.remove();
        updateSectionTotal(sectionId);
    }
}

// ========================
// 데이터 업데이트 함수
// ========================
function updateSectionTotal(sectionId) {
    const grid = document.getElementById(`grid-${sectionId}`);
    if (!grid) return;

    let total = 0;
    const inputs = grid.querySelectorAll('.business-count-input');
    inputs.forEach(input => {
        const value = parseInt(input.value) || 0;
        total += value;
    });

    const totalDisplay = document.getElementById(`total-${sectionId}`);
    if (totalDisplay) {
        totalDisplay.textContent = `${total.toLocaleString()}명`;
    }

    updateSummaryStats();
    updateSummaryCards();
    markDirty();  // ★ 변경사항 추적
}

function updateMenuName(sectionId, value) {
    console.log(`메뉴명 변경: ${sectionId} -> ${value}`);
    markDirty();  // ★ 변경사항 추적

    // ★★★ 슬롯 선택 시 해당 슬롯의 사업장 자동 로드 ★★★
    if (!value || value.trim() === '') {
        console.log(`⚠️ 빈 슬롯명 선택됨 - 무시`);
        return;
    }

    // sectionId에서 탭 인덱스 추출 (section-{tabIndex}-{groupIndex}-{menuIndex})
    const parts = sectionId.split('-');
    const tabIndex = parseInt(parts[1]) || 0;
    const categoryName = businessTypes[tabIndex];

    if (!categoryName) {
        console.log(`⚠️ 카테고리명을 찾을 수 없음 (tabIndex: ${tabIndex})`);
        return;
    }

    const categoryId = categoryNameToIdMap[categoryName];

    // slotClientsCache에서 해당 슬롯의 사업장 목록 가져오기
    const slotClients = slotClientsCache[categoryName]?.[value] || [];
    console.log(`📋 슬롯 '${value}' 선택 - 사업장 ${slotClients.length}개 로드`);

    // 기존 사업장 입력란 교체
    const grid = document.getElementById(`grid-${sectionId}`);
    if (!grid) {
        console.warn(`⚠️ grid-${sectionId}를 찾을 수 없음`);
        return;
    }

    if (slotClients.length > 0) {
        // 슬롯에 사업장이 있는 경우: 해당 사업장들로 교체
        let newHtml = '';
        slotClients.forEach((clientName, idx) => {
            const itemId = sectionId + '-item-' + idx;
            newHtml += `<div class="business-input-item" id="${itemId}">
                <div class="business-input-label">사업장명</div>
                <input type="text" class="business-name-input" value="${clientName}" readonly style="background: #f5f5f5;">
                <div class="business-input-label">식수</div>
                <input type="number" class="business-count-input" placeholder="0" min="0" value=""
                    onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                <div class="business-item-actions">
                    <button class="business-item-remove" onclick="removeBusinessItem('${itemId}', '${sectionId}')">
                        <i class="fas fa-times"></i></button></div></div>`;
        });
        grid.innerHTML = newHtml;
    } else {
        // 슬롯에 사업장이 없는 경우: 기본 입력란 유지
        console.log(`ℹ️ 슬롯 '${value}'에 연결된 사업장 없음 - 기본 입력란 유지`);
    }

    // ★ 슬롯의 meal_type으로 배지 자동 업데이트
    const section = document.getElementById(sectionId);
    if (section) {
        const badge = section.querySelector('.meal-type-badge');
        const newMealType = getMealTypeForSlot(value, categoryId);
        updateMealTypeBadge(badge, newMealType);
        console.log(`🏷️ meal_type 자동 설정: ${value} → ${newMealType}`);
    }

    // 섹션 합계 업데이트
    updateSectionTotal(sectionId);
}

function updateMatchingName(sectionId, value) {
    console.log(`매칭명 변경: ${sectionId} -> ${value}`);
    markDirty();  // ★ 변경사항 추적
}

function updateMealType(sectionId, value) {
    console.log(`식사유형 변경: ${sectionId} -> ${value}`);
    markDirty();  // ★ 변경사항 추적
}

function saveItemData(sectionId, index) {
    console.log(`사업장 데이터 저장: ${sectionId}, index: ${index}`);
    markDirty();  // ★ 변경사항 추적
}

// ========================
// 통계 업데이트
// ========================
function updateSummaryStats() {
    const summaryStats = document.getElementById('summaryStats');
    const currentTable = document.querySelector(`.food-count-table[style*="display: block"]`);

    if (!currentTable) {
        summaryStats.innerHTML = '<span style="color: #666;">데이터 없음</span>';
        return;
    }

    // 현재 탭의 메뉴별 합계 계산
    const sections = currentTable.querySelectorAll('.menu-section');
    let statsHtml = '';
    let grandTotal = 0;

    sections.forEach(section => {
        const menuName = (section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input'))?.value || '메뉴';
        const totalElement = section.querySelector('.total-count');
        const totalText = totalElement?.textContent || '0명';
        const total = parseInt(totalText.replace(/[^0-9]/g, '')) || 0;
        grandTotal += total;

        if (total > 0) {
            statsHtml += `
                <div class="stat-item">
                    <div class="stat-number">${total.toLocaleString()}</div>
                    <div class="stat-label">${menuName}</div>
                </div>
            `;
        }
    });

    // 전체 합계 추가
    statsHtml += `
        <div class="stat-item stat-total" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white;">
            <div class="stat-number">${grandTotal.toLocaleString()}</div>
            <div class="stat-label">전체</div>
        </div>
    `;

    summaryStats.innerHTML = statsHtml || '<span style="color: #666;">입력된 식수 없음</span>';
}

function updateSummaryCards() {
    let totalMealCount = 0;
    const categoryTotals = {};  // { '도시락': 150, '운반': 80, ... }

    // 카테고리별 색상
    const categoryColors = {
        '도시락': 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
        '운반': 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)',
        '학교': 'linear-gradient(135deg, #4caf50 0%, #388e3c 100%)',
        '요양원': 'linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)',
        '기타': 'linear-gradient(135deg, #607d8b 0%, #455a64 100%)'
    };

    // 모든 테이블에서 카테고리별 식수 합계 계산
    document.querySelectorAll('.food-count-table').forEach(table => {
        // table ID에서 인덱스 추출 (table-0, table-1, ...)
        const tableId = table.id;
        let categoryName = '기타';

        if (tableId && tableId.startsWith('table-')) {
            const tabIndex = parseInt(tableId.replace('table-', ''));
            if (!isNaN(tabIndex) && businessTypes[tabIndex]) {
                categoryName = businessTypes[tabIndex];
            }
        }

        const inputs = table.querySelectorAll('.business-count-input');
        inputs.forEach(input => {
            const value = parseInt(input.value) || 0;
            if (value > 0) {
                totalMealCount += value;
                if (!categoryTotals[categoryName]) {
                    categoryTotals[categoryName] = 0;
                }
                categoryTotals[categoryName] += value;
            }
        });
    });

    // 총 식수 업데이트
    const totalEl = document.getElementById('total-meal-count');
    if (totalEl) totalEl.textContent = totalMealCount.toLocaleString();
    const totalInlineEl = document.getElementById('total-meal-count-inline');
    if (totalInlineEl) totalInlineEl.textContent = totalMealCount.toLocaleString();

    // 카테고리별 카드 동적 생성
    const categoryCardsContainer = document.getElementById('category-summary-cards');
    if (categoryCardsContainer) {
        // 카테고리 정렬 순서
        const categoryOrder = ['도시락', '운반', '학교', '요양원', '기타'];
        const sortedCategories = categoryOrder.filter(c => categoryTotals[c] > 0);
        // 정렬 순서에 없는 카테고리 추가
        Object.keys(categoryTotals).forEach(c => {
            if (!sortedCategories.includes(c) && categoryTotals[c] > 0) {
                sortedCategories.push(c);
            }
        });

        let cardsHtml = '';
        sortedCategories.forEach(category => {
            const count = categoryTotals[category] || 0;
            const color = categoryColors[category] || 'linear-gradient(135deg, #78909c 0%, #546e7a 100%)';
            cardsHtml += `
                <div class="summary-card" style="background: ${color};">
                    <h3>${category}</h3>
                    <div class="number">${count.toLocaleString()}</div>
                    <div class="unit">명</div>
                </div>
            `;
        });

        categoryCardsContainer.innerHTML = cardsHtml;
    }
}

// ========================
// 데이터 저장/로드 (DB 연동)
// ========================
async function saveFoodCountData() {
    const workDate = document.getElementById('meal-count-date').value;
    const items = collectAllDataForDB();

    if (items.length === 0) {
        alert('저장할 식수 데이터가 없습니다.');
        return;
    }

    // ★ 사업장 선택 확인 (필수)
    const siteId = getCurrentSiteId();
    const siteName = getCurrentSiteName();

    if (!siteId) {
        alert('⚠️ 사업장을 먼저 선택해주세요.\n\n상단의 사업장 선택기에서 본사 또는 영남지사를 선택하세요.');
        return;
    }

    // ★ 저장 전 사업장 확인 (실수 방지)
    const confirmMessage = `📍 [${siteName}] 사업장으로 저장합니다.\n\n` +
        `• 날짜: ${workDate}\n` +
        `• 항목: ${items.length}건\n\n` +
        `맞으면 [확인], 사업장을 변경하려면 [취소]를 누르세요.`;

    if (!confirm(confirmMessage)) {
        return;
    }

    // ★ 과거 날짜 저장 방지 (당일은 허용)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(workDate);
    selectedDate.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
        showToast(`❌ 오늘(${getLocalDateString(today)}) 이후 날짜만 저장 가능`, 'error', 3000);
        return;
    }

    // ★ 즉시 로딩 표시 (체감 속도 개선)
    showLoading('💾 식수 저장 중...');

    try {
        // ★ 사용자 정보 가져오기 (감사 로그용)
        const userInfo = JSON.parse(localStorage.getItem('user_info') || localStorage.getItem('user') || '{}');
        const userId = userInfo.id || userInfo.user_id || null;
        const userName = userInfo.name || userInfo.username || userInfo.display_name || '알수없음';

        // ★ 식수 데이터만 저장 (템플릿은 자동 업데이트 안함 - 구조 변경은 사업장관리에서)
        const response = await fetch('/api/meal-counts/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                work_date: workDate,
                items: items,
                site_id: siteId,
                user_id: userId,
                user_name: userName
            })
        });

        const mealResult = await response.json();
        hideLoading();

        if (mealResult.success) {
            showToast(`✅ ${workDate} 식수 저장완료 (${mealResult.inserted}건)`, 'success', 2500);
            console.log('저장 완료:', mealResult);
            clearDirty();  // ★ 저장 완료 후 변경 플래그 초기화

            // ★★★ 저장 후 캐시 무효화 (다른 날짜 갔다 와도 최신 데이터 표시) ★★★
            const cacheKey = `${siteId}_${workDate}`;
            siteDataCache.delete(cacheKey);
            console.log(`🗑️ 캐시 무효화: ${cacheKey}`);

            // ★★★ slot_clients 불일치 경고 표시 (수정 기능 포함) ★★★
            if (mealResult.slot_client_mismatches && mealResult.slot_client_mismatches.count > 0) {
                const mismatches = mealResult.slot_client_mismatches;
                // 전역 변수에 저장 (수정 함수에서 사용)
                window._mismatchWorkDate = workDate;

                let warningHtml = `<div style="text-align:left; max-height:400px; overflow-y:auto;">
                    <p><strong>⚠️ ${mismatches.count}건의 사업장명이 사업장관리에 등록되지 않았습니다.</strong></p>
                    <p style="color:#666; font-size:0.9em;">아래에서 올바른 사업장을 선택하여 바로 수정할 수 있습니다.</p>
                    <hr style="margin:10px 0;">
                    <table style="width:100%; font-size:0.85em; border-collapse:collapse;">
                        <tr style="background:#f5f5f5;">
                            <th style="padding:5px; border:1px solid #ddd;">슬롯</th>
                            <th style="padding:5px; border:1px solid #ddd;">입력된 사업장</th>
                            <th style="padding:5px; border:1px solid #ddd;">수정할 사업장</th>
                            <th style="padding:5px; border:1px solid #ddd; width:60px;">작업</th>
                        </tr>`;

                mismatches.items.slice(0, 15).forEach((item, idx) => {
                    // 드롭다운 옵션 생성
                    let options = '<option value="">-- 선택 --</option>';
                    if (item.valid_clients && item.valid_clients.length > 0) {
                        item.valid_clients.forEach(client => {
                            options += `<option value="${client}">${client}</option>`;
                        });
                    }

                    warningHtml += `<tr id="mismatch-row-${idx}">
                        <td style="padding:5px; border:1px solid #ddd;">${item.slot_name}</td>
                        <td style="padding:5px; border:1px solid #ddd; color:red;">${item.site_name}</td>
                        <td style="padding:5px; border:1px solid #ddd;">
                            <select id="fix-select-${idx}" style="width:100%; padding:3px; font-size:0.9em;"
                                data-slot="${item.slot_name}" data-old="${item.site_name}">
                                ${options}
                            </select>
                        </td>
                        <td style="padding:5px; border:1px solid #ddd; text-align:center;">
                            <button onclick="fixSiteName(${idx})"
                                style="padding:3px 8px; background:#28a745; color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.8em;">
                                수정
                            </button>
                        </td>
                    </tr>`;
                });

                if (mismatches.count > 15) {
                    warningHtml += `<tr><td colspan="4" style="padding:5px; text-align:center; color:#666;">... 외 ${mismatches.count - 15}건 (사업장관리에서 확인)</td></tr>`;
                }

                warningHtml += `</table>
                    <div style="margin-top:15px; display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#666; font-size:0.85em;">
                            👉 <a href="meal_count_site_management.html" target="_blank" style="color:#007bff;">사업장관리</a>에서 신규 등록 가능
                        </span>
                        <button onclick="fixAllSiteNames()"
                            style="padding:6px 15px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">
                            전체 수정
                        </button>
                    </div>
                </div>`;

                // 경고 모달 표시
                showWarningModal('사업장 불일치 경고', warningHtml);
            }
        } else {
            showToast('❌ 저장 실패: ' + mealResult.error, 'error', 3000);
        }
    } catch (error) {
        hideLoading();
        console.error('저장 오류:', error);
        showToast('❌ 서버 연결 오류', 'error', 3000);
    }
}

// ★ 구조 저장 (현재 화면 구조를 선택된 템플릿의 해당 요일 타입에 저장)
async function saveStructureToTemplate() {
    let selectedTemplateId = document.getElementById('mealTemplateSelect')?.value;

    // ★ 템플릿이 없으면 기본 템플릿 자동 생성
    if (!selectedTemplateId) {
        try {
            const res = await fetch('/api/meal-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_name: '기본 템플릿',
                    description: '자동 생성된 기본 템플릿',
                    template_data: {}
                })
            });
            const result = await res.json();
            if (result.success && result.id) {
                selectedTemplateId = result.id;
                mealTemplates.push({ id: result.id, template_name: '기본 템플릿', template_data: {} });
                updateMealTemplateSelect();
                const select = document.getElementById('mealTemplateSelect');
                if (select) select.value = selectedTemplateId;
                showToast('📋 기본 템플릿이 자동 생성되었습니다.', 'info', 2000);
            } else {
                showToast('❌ 템플릿 생성 실패: ' + (result.error || ''), 'error', 3000);
                return;
            }
        } catch (e) {
            showToast('❌ 템플릿 생성 오류', 'error', 3000);
            return;
        }
    }

    const selectedTemplate = mealTemplates.find(t => t.id == selectedTemplateId);
    if (!selectedTemplate) {
        showToast('❌ 선택된 템플릿을 찾을 수 없습니다.', 'error', 3000);
        return;
    }

    const workDate = document.getElementById('meal-count-date').value;
    const dayType = getDayTypeFromDate(workDate);
    const dayTypeNames = { 'weekday': '평일', 'saturday': '토요일', 'sunday': '일요일' };
    const dayTypeName = dayTypeNames[dayType] || dayType;

    // 확인 메시지
    if (!confirm(`📋 "${selectedTemplate.template_name}" 템플릿의\n[${dayTypeName}] 구조를 현재 화면으로 저장합니다.\n\n계속하시겠습니까?`)) {
        return;
    }

    showLoading('💾 구조 저장 중...');

    try {
        const templateData = collectCurrentScreenData();

        // 기존 day_structures 유지하면서 현재 요일타입만 업데이트
        let dayStructures = {};
        if (selectedTemplate.template_data && selectedTemplate.template_data.day_structures) {
            dayStructures = { ...selectedTemplate.template_data.day_structures };
        }
        dayStructures[dayType] = templateData;

        const response = await fetch(`/api/meal-templates/${selectedTemplateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_name: selectedTemplate.template_name,
                description: selectedTemplate.description || '',
                valid_from: null,
                valid_to: null,
                apply_days: null,
                template_data: {
                    day_structures: dayStructures,
                    version: 2
                }
            })
        });

        const result = await response.json();
        hideLoading();

        if (result.success) {
            // 로컬 캐시 업데이트
            selectedTemplate.template_data = { day_structures: dayStructures, version: 2 };
            showToast(`✅ "${selectedTemplate.template_name}" [${dayTypeName}] 구조 저장완료`, 'success', 2500);
        } else {
            showToast('❌ 구조 저장 실패: ' + result.error, 'error', 3000);
        }
    } catch (error) {
        hideLoading();
        console.error('구조 저장 오류:', error);
        showToast('❌ 서버 연결 오류', 'error', 3000);
    }
}

function collectAllDataForDB() {
    const items = [];

    businessTypes.forEach((businessType, tabIndex) => {
        const table = document.getElementById(`table-${tabIndex}`);
        if (!table) return;

        const sections = table.querySelectorAll('.menu-section');

        sections.forEach((section, menuOrder) => {
            const menuName = (section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input'))?.value || '';
            const matchingName = section.querySelector('.menu-match-input')?.value || '';
            // ★ meal_type을 category_slots 마스터에서 직접 조회
            const mealType = getSectionMealType(section);

            const businessItems = section.querySelectorAll('.business-input-item');
            businessItems.forEach(item => {
                const siteName = (item.querySelector('.business-name-input')?.value || '').trim();
                const mealCount = parseInt(item.querySelector('.business-count-input')?.value) || 0;

                // 사업장명이 있으면 저장 (0 카운트도 허용 - 고객 목록 유지)
                if (siteName) {
                    // ★ menu_name이 비어있으면 site_name 사용 (슬롯 미선택 방지)
                    const finalMenuName = menuName || siteName;
                    if (!menuName) {
                        console.warn(`[경고] 슬롯 미선택 → site_name 사용: ${siteName}`);
                    }
                    items.push({
                        business_type: businessType,
                        menu_name: finalMenuName,
                        matching_name: matchingName,
                        meal_type: mealType,
                        site_name: siteName,
                        meal_count: mealCount,
                        menu_order: menuOrder  // 순서 정보 추가
                    });
                }
            });
        });
    });

    // ★ 중복 데이터 제거 (같은 site_name + business_type + meal_type + menu_name 조합)
    const uniqueMap = new Map();
    items.forEach(item => {
        const key = `${item.site_name}|${item.business_type}|${item.meal_type}|${item.menu_name}`;
        // 기존 항목이 없거나 현재 항목의 meal_count가 더 크면 교체
        if (!uniqueMap.has(key) || item.meal_count > (uniqueMap.get(key).meal_count || 0)) {
            uniqueMap.set(key, item);
        }
    });
    const uniqueItems = Array.from(uniqueMap.values());
    if (items.length !== uniqueItems.length) {
        console.warn(`[중복제거] ${items.length}건 → ${uniqueItems.length}건 (${items.length - uniqueItems.length}건 중복 제거됨)`);
    }

    return uniqueItems;
}

// 전날 데이터 캐시 (버튼으로 불러올 때 사용)
let previousDayDataCache = null;
let previousDayDateCache = null;

// ★★★ 사업장 데이터 프리캐시 ★★★
const siteDataCache = new Map();  // site_id -> { data, timestamp, date }
const CACHE_EXPIRE_MS = 5 * 60 * 1000;  // 5분 캐시 유효기간
let isPrefetching = false;

// 캐시에서 데이터 가져오기
function getCachedSiteData(siteId, date) {
    const key = `${siteId}_${date}`;
    const cached = siteDataCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_EXPIRE_MS) {
        console.log(`⚡ 캐시 히트: site_id=${siteId}`);
        return cached.data;
    }
    return null;
}

// 캐시에 데이터 저장
function setCachedSiteData(siteId, date, data) {
    const key = `${siteId}_${date}`;
    siteDataCache.set(key, {
        data: data,
        timestamp: Date.now(),
        date: date
    });
    console.log(`💾 캐시 저장: site_id=${siteId}, 크기=${siteDataCache.size}`);
}

// 백그라운드 프리페치 (자주 사용하는 사업장)
async function prefetchFrequentSites() {
    if (isPrefetching) return;
    isPrefetching = true;

    const workDate = document.getElementById('meal-count-date').value;

    // SiteSelector에서 모든 사업장 목록 가져오기
    let allSites = [];
    if (typeof SiteSelector !== 'undefined' && SiteSelector.getAllSites) {
        allSites = SiteSelector.getAllSites();
    }

    // 최대 5개 사업장 프리페치 (현재 선택된 것 제외)
    const currentSiteId = getCurrentSiteId();
    const sitesToPrefetch = allSites
        .filter(s => s.id !== currentSiteId)
        .slice(0, 5);

    console.log(`🔄 프리페치 시작: ${sitesToPrefetch.length}개 사업장`);

    for (const site of sitesToPrefetch) {
        // 이미 캐시에 있으면 스킵
        if (getCachedSiteData(site.id, workDate)) continue;

        try {
            const response = await fetch(`/api/meal-management/init?site_id=${site.id}&date=${workDate}`);
            const result = await response.json();
            if (result.success) {
                setCachedSiteData(site.id, workDate, result);
            }
            // 서버 부하 방지를 위해 약간의 딜레이
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            console.warn(`프리페치 실패: site_id=${site.id}`, e);
        }
    }

    console.log(`✅ 프리페치 완료: 캐시 크기=${siteDataCache.size}`);
    isPrefetching = false;
}

// 통합 API로 초기 데이터 로드 (성능 최적화 + 캐시 우선)
async function loadInitData() {
    const workDate = document.getElementById('meal-count-date').value;
    const siteId = getCurrentSiteId();

    if (!siteId) {
        console.warn('사업장 ID가 없습니다');
        createFoodCountTables();
        return;
    }

    try {
        let result;

        // 1️⃣ 캐시 확인 (즉시 응답)
        const cached = getCachedSiteData(siteId, workDate);
        if (cached) {
            result = cached;
            console.log(`⚡ 캐시에서 로드: site_id=${siteId} (0ms)`);
        } else {
            // 2️⃣ API 호출 (캐시 없을 때만)
            console.time('📦 API 호출');
            const response = await fetch(`/api/meal-management/init?site_id=${siteId}&date=${workDate}`);
            result = await response.json();
            console.timeEnd('📦 API 호출');

            if (result.success) {
                // 캐시에 저장
                setCachedSiteData(siteId, workDate, result);
            }
        }

        if (!result.success) {
            console.error('데이터 로드 오류:', result.error);
            createFoodCountTables();
            return;
        }

        // 데이터 적용
        await applyInitData(result, workDate);

    } catch (error) {
        console.error('데이터 로드 오류:', error);
        createFoodCountTables();
    }
}

// 로드된 데이터 적용 (캐시/API 공통)
// ★ 수정: 템플릿 우선 적용 후 식수 데이터 병합
async function applyInitData(result, workDate) {
    // 1. 템플릿 데이터 저장
    mealTemplates = result.templates || [];

    // ★★★ 중요: updateMealTemplateSelect에서 loadMealTemplate 중복 호출 방지
    // applyInitData에서 이미 템플릿+식수 병합을 처리하므로 자동 적용 비활성화
    window._templateAutoApplied = true;

    updateMealTemplateSelect();

    // 2. 전날 데이터 캐시
    previousDayDataCache = result.previousDay?.data || null;
    previousDayDateCache = result.previousDay?.date || null;

    // 3. 현재일 데이터
    const currentData = result.currentDay?.data || [];

    // ★ 4. 슬롯 데이터 캐시에 저장 (통합 API에서 받은 데이터)
    if (result.slots) {
        Object.entries(result.slots).forEach(([categoryName, slots]) => {
            const categoryId = categoryNameToIdMap[categoryName];
            if (categoryId) {
                categorySlotsCache[categoryId] = slots;
            }
            // 이름으로도 캐시 (ID 매핑 전에 접근 가능하도록)
            categorySlotsCache[categoryName] = slots;
        });
        console.log(`⚡ 슬롯 데이터 캐시 완료: ${Object.keys(result.slots).length}개 카테고리`);
    }

    // ★★★ M-9: 슬롯별 사업장 목록 캐시 (내용 교체 방식으로 통일)
    if (result.slotClients) {
        Object.keys(slotClientsCache).forEach(key => delete slotClientsCache[key]);
        Object.assign(slotClientsCache, result.slotClients);
        console.log(`⚡ 슬롯별 사업장 캐시 완료: ${Object.keys(result.slotClients).length}개 카테고리`);
    }

    // ★ 새로운 로직: 통합 API에서 받은 스케줄 데이터 사용 (API 호출 제거)
    const scheduleResult = result.schedule;  // 통합 API에서 이미 로드됨
    let templateApplied = false;
    let appliedTemplateId = null;

    if (scheduleResult) {
        // 캘린더에 지정된 템플릿이 있으면 적용
        console.log(`📅 스케줄된 템플릿 적용: ${scheduleResult.template_name} (${scheduleResult.day_type})`);
        const template = mealTemplates.find(t => t.id == scheduleResult.template_id);
        if (template && template.template_data) {
            const dayStructures = template.template_data.day_structures || {};
            const dataToApply = dayStructures[scheduleResult.day_type] || template.template_data;
            if (dataToApply.menuStructure) {
                applyTemplateData(dataToApply, true);  // ★ 자동 로드 시 식수 제외
                templateApplied = true;
                appliedTemplateId = template.id;
            }
        }
    }

    if (!templateApplied) {
        // 캘린더에 지정된 템플릿이 없으면 자동 감지
        const templateMatch = findMatchingTemplate(workDate);
        if (templateMatch) {
            const dayTypeLabel = templateMatch._dayType ? DAY_TYPE_LABELS[templateMatch._dayType] : '기본';
            console.log(`🎨 템플릿 자동 적용: ${templateMatch.template_name} (${dayTypeLabel})`);
            const dataToApply = templateMatch._dayStructure || templateMatch.template_data;
            applyTemplateData(dataToApply, true);  // ★ 자동 로드 시 식수 제외
            templateApplied = true;
            appliedTemplateId = templateMatch.id;
        }
    }

    // 템플릿 선택 드롭다운 업데이트
    if (appliedTemplateId) {
        const select = document.getElementById('mealTemplateSelect');
        if (select) select.value = appliedTemplateId;
    }

    // 4. 템플릿이 적용되었으면 식수 데이터 병합, 아니면 기존 방식
    if (templateApplied && currentData.length > 0) {
        // 템플릿 구조에 식수 데이터만 병합
        mergeMealCountsToTemplate(currentData);
        console.log(`✅ 템플릿 + 식수 데이터 ${currentData.length}건 병합`);
    } else if (templateApplied && currentData.length === 0) {
        // ★★★ 템플릿만 있고 식수 데이터 없음 - 템플릿 구조만 표시 (빈 상태) ★★★
        console.log(`📋 템플릿만 적용됨 (저장된 식수 데이터 없음) - 빈 템플릿 표시`);
        // applyTemplateData()에서 이미 UI 생성됨, 추가 작업 불필요
        // 하지만 통계는 업데이트 필요
        updateSummaryStats();
    } else if (currentData.length > 0) {
        // 템플릿 없으면 기존 방식
        applyLoadedDataFromDB(currentData);
        console.log(`✅ 데이터 ${currentData.length}건 적용`);
    } else if (!templateApplied) {
        // 아무것도 없으면 기본 테이블
        console.log(`📭 템플릿도 없고 데이터도 없음 - 기본 테이블 생성`);
        createFoodCountTables();
        // ★ 사업장 관리 동기화: slotClientsCache에서 활성 슬롯 자동 추가
        addMissingSlotsFromCache();
    }

    updateSummaryStats();
    updateSummaryCards();
}

// ★ 새 함수: 템플릿 구조에 DB 식수 데이터 병합
// 템플릿의 메뉴 구조는 유지하고, 각 메뉴의 사업장/식수는 DB 데이터로 대체
// ★ 템플릿에 없는 DB 데이터는 새 섹션으로 추가
function mergeMealCountsToTemplate(countsData) {
    console.log('🔀 식수 데이터 병합 시작:', countsData.length, '건');

    // DB 식수 데이터를 business_type > menu_name > meal_type 구조로 그룹화
    // ★ 수정: meal_type도 키에 포함하여 다른 끼니의 데이터가 섞이지 않도록 함
    // ★ 추가: menu_name이 비어있으면 menu_order로 구분 (학교 등 1:1 매핑용)
    const countsGrouped = {};
    countsData.forEach(row => {
        const bt = row.business_type;
        const menuName = row.menu_name;
        const mealType = row.meal_type || '중식';
        const menuOrder = row.menu_order ?? 0;

        // ★ menu_name이 비어있으면 menu_order를 키에 포함 (1:1 매핑)
        const key = menuName
            ? `${bt}|${menuName}|${mealType}`
            : `${bt}|ORDER:${menuOrder}|${mealType}`;

        if (!countsGrouped[key]) {
            countsGrouped[key] = {
                businessType: bt,
                menuName: menuName,
                mealType: mealType,
                menuOrder: menuOrder,
                businesses: [],
                seenSites: new Set(),  // ★ 중복 체크용
                matched: false  // 템플릿과 매칭되었는지 추적
            };
        }
        // ★ 같은 끼니에 같은 사업장이 있으면 추가하지 않음
        if (!countsGrouped[key].seenSites.has(row.site_name)) {
            countsGrouped[key].seenSites.add(row.site_name);
            countsGrouped[key].businesses.push({
                name: row.site_name,
                count: row.meal_count
            });
        }
    });

    // 현재 화면의 각 메뉴 섹션에 DB 데이터 적용
    businessTypes.forEach((businessType, tabIndex) => {
        const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
        if (!menuSections) return;

        const sections = menuSections.querySelectorAll('.menu-section');
        sections.forEach((section, sectionIndex) => {
            const menuNameElement = section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input');
            const menuName = menuNameElement?.value || '';
            // ★ meal_type을 category_slots 마스터에서 직접 조회
            const mealType = getSectionMealType(section);
            // ★ menu_order를 data attribute에서 가져오거나 섹션 인덱스 사용
            const menuOrder = parseInt(section.dataset.menuOrder ?? sectionIndex, 10);

            // ★ menu_name이 비어있으면 menu_order로 매칭 (1:1 매핑)
            const key = menuName
                ? `${businessType}|${menuName}|${mealType}`
                : `${businessType}|ORDER:${menuOrder}|${mealType}`;
            let dbData = countsGrouped[key];

            // ★★★ 정확한 매칭 실패 시 meal_type 무시하고 재시도 (fallback) ★★★
            if (!dbData && menuName) {
                // 같은 businessType + menuName을 가진 다른 meal_type 데이터 찾기
                const fallbackKey = Object.keys(countsGrouped).find(k =>
                    k.startsWith(`${businessType}|${menuName}|`) && k !== key
                );
                if (fallbackKey) {
                    dbData = countsGrouped[fallbackKey];
                    console.warn(`⚠️ meal_type 불일치 fallback: ${key} → ${fallbackKey}`);
                }
            }

            if (dbData && dbData.businesses.length > 0) {
                // DB에 해당 메뉴의 식수 데이터가 있으면 사업장 목록 교체
                dbData.matched = true;  // ★ 매칭 표시
                const grid = section.querySelector('.business-input-grid');
                const sectionId = section.id;

                // ★ M-6: DB 데이터 + slotClientsCache 병합 (전역 normalizeString 사용)
                const businessesToShow = [...dbData.businesses];
                const existingNames = new Set(businessesToShow.map(b => normalizeString(b.name)));
                if (menuName && slotClientsCache[businessType]?.[menuName]) {
                    slotClientsCache[businessType][menuName].forEach(clientName => {
                        const normalized = normalizeString(clientName);
                        if (normalized && !existingNames.has(normalized)) {
                            businessesToShow.push({ name: normalized, count: '' });
                            existingNames.add(normalized);
                        }
                    });
                }

                if (grid) {
                    grid.innerHTML = '';
                    businessesToShow.forEach((business, idx) => {
                        const itemDiv = document.createElement('div');
                        itemDiv.className = 'business-input-item';
                        itemDiv.id = `${sectionId}-item-${idx}`;
                        itemDiv.innerHTML = `
                            <div class="business-input-label">사업장명</div>
                            <input type="text" class="business-name-input" placeholder="사업장명" value="${business.name || ''}"
                                   readonly style="background: #f5f5f5; cursor: not-allowed;"
                                   title="사업장명은 Admin에서만 수정 가능합니다">
                            <div class="business-input-label">식수</div>
                            <input type="number" class="business-count-input" placeholder="0" min="0" value="${business.count || ''}"
                                   onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                            <div class="business-item-actions">
                                <button class="business-item-remove" onclick="removeBusinessItem('${itemDiv.id}', '${sectionId}')">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        `;
                        grid.appendChild(itemDiv);
                    });
                }

                // 섹션 합계 업데이트
                if (typeof updateSectionTotal === 'function') {
                    updateSectionTotal(sectionId);
                }
                console.log(`  ✅ ${businessType}/${menuName}: ${businessesToShow.length}개 사업장 적용`);
            }
        });
    });

    // ★ 템플릿에 없는 DB 데이터를 새 섹션으로 추가
    Object.values(countsGrouped).forEach(dbData => {
        if (dbData.matched) return;  // 이미 매칭된 것은 스킵

        const businessType = dbData.businessType;
        const menuName = (dbData.menuName || '').trim();

        // ★★★ slotClientsCache 기반 필터링: 현재 날짜에 사업장이 없는 슬롯은 생성하지 않음 ★★★
        const categoryClients = slotClientsCache[businessType];
        if (categoryClients && menuName) {
            const clients = categoryClients[menuName];
            if (!clients || clients.length === 0) {
                console.log(`🚫 DB→템플릿 섹션 필터링: ${businessType} > ${menuName} (현재 날짜에 사업장 없음)`);
                return;  // 섹션 생성 스킵
            }
        }
        let tabIndex = businessTypes.indexOf(businessType);

        // ★ 탭이 없으면 동적으로 생성
        if (tabIndex === -1) {
            console.log(`  🆕 새 탭 생성: ${businessType}`);
            tabIndex = businessTypes.length;
            businessTypes.push(businessType);

            // 탭 버튼 추가
            const tabButtons = document.getElementById('tab-buttons');
            if (tabButtons) {
                const tabBtn = document.createElement('button');
                tabBtn.className = 'tab-button';
                tabBtn.textContent = businessType;
                tabBtn.onclick = () => switchTab(tabIndex);
                tabButtons.appendChild(tabBtn);
            }

            // 탭 콘텐츠(테이블) 추가
            const container = document.getElementById('foodCountTables');
            if (container) {
                const table = createBusinessTable(businessType, tabIndex);
                container.appendChild(table);
            }
        }

        let menuSections = document.getElementById(`menu-sections-${tabIndex}`);
        if (!menuSections) return;

        // 새 섹션 생성
        const sectionCount = menuSections.children.length;
        const section = createMenuSection(tabIndex, sectionCount, 0, dbData.mealType, dbData.menuName);
        menuSections.appendChild(section);

        // 사업장 데이터 추가
        const sectionId = section.id;
        const grid = section.querySelector('.business-input-grid');
        if (grid) {
            grid.innerHTML = '';
            dbData.businesses.forEach((business, idx) => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'business-input-item';
                itemDiv.id = `${sectionId}-item-${idx}`;
                itemDiv.innerHTML = `
                    <div class="business-input-label">사업장명</div>
                    <input type="text" class="business-name-input" placeholder="사업장명" value="${business.name || ''}"
                           readonly style="background: #f5f5f5; cursor: not-allowed;"
                           title="사업장명은 Admin에서만 수정 가능합니다">
                    <div class="business-input-label">식수</div>
                    <input type="number" class="business-count-input" placeholder="0" min="0" value="${business.count || ''}"
                           onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                    <div class="business-item-actions">
                        <button class="business-item-remove" onclick="removeBusinessItem('${itemDiv.id}', '${sectionId}')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
                grid.appendChild(itemDiv);
            });
        }

        // 섹션 합계 업데이트
        updateSectionTotal(sectionId);
        console.log(`  ➕ ${businessType}/${dbData.menuName}: 새 섹션 추가 (${dbData.businesses.length}개 사업장)`);
    });

    // 전체 통계 업데이트
    updateSummaryStats();
    updateSummaryCards();
    console.log('🔀 식수 데이터 병합 완료');
}

// 전날 데이터 불러오기 (캐시 또는 API)
async function applyPreviousDayData() {
    if (!previousDayDataCache || previousDayDataCache.length === 0) {
        alert('전날 데이터가 없습니다.');
        return;
    }

    // ★★★ H-5: 무시될 슬롯/사업장 분석 (디스트럭처링) ★★★
    const { ignoredSlots, ignoredClients } = analyzeIgnoredSlots(previousDayDataCache);

    // ★ 경고 메시지 생성
    let warningMessage = '';

    // 슬롯 전체가 없는 경우
    if (ignoredSlots.length > 0) {
        warningMessage += `\n\n⚠️ 슬롯 전체가 운영하지 않음:\n`;
        ignoredSlots.forEach(item => {
            warningMessage += `  • ${item.category} > ${item.slot} (${item.count}건)\n`;
        });
    }

    // ★ 개별 사업장이 운영 종료된 경우 (고아 데이터)
    if (ignoredClients.length > 0) {
        warningMessage += `\n\n⚠️ 운영 종료된 사업장 (고아 데이터):\n`;
        ignoredClients.slice(0, 10).forEach(item => {
            warningMessage += `  • ${item.category} > ${item.slot} > ${item.site_name}\n`;
        });
        if (ignoredClients.length > 10) {
            warningMessage += `  ... 외 ${ignoredClients.length - 10}건\n`;
        }
    }

    const totalRecords = previousDayDataCache.length;
    const ignoredSlotCount = ignoredSlots.reduce((sum, s) => sum + s.count, 0);
    const ignoredClientCount = ignoredClients.length;
    const totalIgnored = ignoredSlotCount + ignoredClientCount;
    const appliedCount = totalRecords - totalIgnored;

    const confirmMessage = `전날(${previousDayDateCache}) 데이터를 불러오시겠습니까?\n\n` +
        `📊 총 ${totalRecords}건 중 ${appliedCount}건 적용 예정` +
        (totalIgnored > 0 ? ` (${totalIgnored}건 제외)` : '') +
        warningMessage;

    if (!confirm(confirmMessage)) {
        return;
    }

    applyLoadedDataFromDB(previousDayDataCache);

    let resultMessage = `전날(${previousDayDateCache}) 데이터 ${appliedCount}건을 불러왔습니다.`;
    if (totalIgnored > 0) {
        resultMessage += `\n\n⚠️ ${totalIgnored}건은 운영하지 않는 슬롯/사업장으로 제외되었습니다.`;
        if (ignoredClients.length > 0) {
            resultMessage += `\n   (운영 종료된 사업장: ${ignoredClients.length}건)`;
        }
    }
    alert(resultMessage);

    updateSummaryStats();
    updateSummaryCards();
}

// ★★★ 새 함수: 무시될 슬롯/사업장 분석 (개별 사업장 레벨까지 체크) ★★★
function analyzeIgnoredSlots(sourceData) {
    const ignoredSlots = [];      // 슬롯 전체가 없는 경우
    const ignoredClients = [];    // 개별 사업장이 없는 경우

    // 카테고리 > 슬롯별로 그룹화
    const grouped = {};
    sourceData.forEach(row => {
        const key = `${row.business_type}|${row.menu_name}`;
        if (!grouped[key]) {
            grouped[key] = {
                category: row.business_type,
                slot: row.menu_name,
                sites: [],
                count: 0
            };
        }
        grouped[key].sites.push(row.site_name);
        grouped[key].count++;
    });

    // slotClientsCache와 비교
    Object.values(grouped).forEach(item => {
        const categoryClients = slotClientsCache[item.category];
        if (!categoryClients) {
            // 카테고리 자체가 없음
            ignoredSlots.push({ category: item.category, slot: item.slot, count: item.count });
        } else {
            const validClients = categoryClients[item.slot];
            if (!validClients || validClients.length === 0) {
                // 슬롯에 사업장이 없음 (운영요일 필터링됨)
                ignoredSlots.push({ category: item.category, slot: item.slot, count: item.count });
            } else {
                // ★ 개별 사업장 레벨 체크: 슬롯은 있지만 특정 사업장만 운영 종료
                item.sites.forEach(siteName => {
                    if (!validClients.includes(siteName)) {
                        ignoredClients.push({
                            category: item.category,
                            slot: item.slot,
                            site_name: siteName
                        });
                    }
                });
            }
        }
    });

    // ★ H-5: 명확한 객체 반환 (배열에 속성 추가하는 안티패턴 제거)
    return { ignoredSlots, ignoredClients };
}

// ★★★ 복수 날짜 복사 기능 ★★★
let copyTargetDates = [];

function showCopyToMultipleDatesModal() {
    const workDate = document.getElementById('meal-count-date').value;
    document.getElementById('copySourceDate').textContent = workDate;

    // 기본값: 내일부터
    const tomorrow = new Date(workDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('copyTargetDateInput').value = tomorrow.toISOString().split('T')[0];

    copyTargetDates = [];
    renderCopyTargetDatesList();
    document.getElementById('copyToMultipleDatesModal').style.display = 'block';
}

function closeCopyToMultipleDatesModal() {
    document.getElementById('copyToMultipleDatesModal').style.display = 'none';
}

function addCopyTargetDate() {
    const dateInput = document.getElementById('copyTargetDateInput');
    const date = dateInput.value;
    const sourceDate = document.getElementById('meal-count-date').value;

    if (!date) {
        alert('날짜를 선택해주세요.');
        return;
    }

    if (date === sourceDate) {
        alert('원본 날짜와 같은 날짜는 추가할 수 없습니다.');
        return;
    }

    if (copyTargetDates.includes(date)) {
        alert('이미 추가된 날짜입니다.');
        return;
    }

    if (copyTargetDates.length >= 14) {
        alert('최대 14일까지만 선택할 수 있습니다.');
        return;
    }

    copyTargetDates.push(date);
    copyTargetDates.sort();
    renderCopyTargetDatesList();

    // 다음 날로 자동 이동
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    dateInput.value = nextDate.toISOString().split('T')[0];
}

function removeCopyTargetDate(date) {
    copyTargetDates = copyTargetDates.filter(d => d !== date);
    renderCopyTargetDatesList();
}

function clearCopyTargetDates() {
    copyTargetDates = [];
    renderCopyTargetDatesList();
}

function addWeekdayDates() {
    const sourceDate = document.getElementById('meal-count-date').value;
    const startDate = new Date(sourceDate);
    startDate.setDate(startDate.getDate() + 1);

    let count = 0;
    let current = new Date(startDate);

    while (count < 5 && copyTargetDates.length < 14) {
        const dayOfWeek = current.getDay();
        // 평일만 (월~금: 1~5)
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            const dateStr = current.toISOString().split('T')[0];
            if (!copyTargetDates.includes(dateStr) && dateStr !== sourceDate) {
                copyTargetDates.push(dateStr);
                count++;
            }
        }
        current.setDate(current.getDate() + 1);
    }

    copyTargetDates.sort();
    renderCopyTargetDatesList();
}

function addNextWeekDates() {
    const sourceDate = document.getElementById('meal-count-date').value;
    const startDate = new Date(sourceDate);

    // 다음주 월요일 찾기
    const dayOfWeek = startDate.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    startDate.setDate(startDate.getDate() + daysUntilMonday);

    for (let i = 0; i < 5 && copyTargetDates.length < 14; i++) {
        const dateStr = startDate.toISOString().split('T')[0];
        if (!copyTargetDates.includes(dateStr) && dateStr !== sourceDate) {
            copyTargetDates.push(dateStr);
        }
        startDate.setDate(startDate.getDate() + 1);
    }

    copyTargetDates.sort();
    renderCopyTargetDatesList();
}

function renderCopyTargetDatesList() {
    const container = document.getElementById('copyTargetDatesList');

    if (copyTargetDates.length === 0) {
        container.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">선택된 날짜가 없습니다</div>';
        return;
    }

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    let html = '';

    copyTargetDates.forEach(date => {
        const d = new Date(date);
        const dayName = dayNames[d.getDay()];
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const bgColor = isWeekend ? '#ffebee' : '#fff';
        const textColor = d.getDay() === 0 ? '#c62828' : (d.getDay() === 6 ? '#e65100' : '#333');

        html += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: ${bgColor}; border-bottom: 1px solid #eee;">
                <span style="color: ${textColor}; font-weight: 500;">${date} (${dayName})</span>
                <button onclick="removeCopyTargetDate('${date}')" style="background: #ff5722; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function executeCopyToMultipleDates() {
    if (copyTargetDates.length === 0) {
        alert('복사할 날짜를 최소 1개 이상 선택해주세요.');
        return;
    }

    const sourceDate = document.getElementById('meal-count-date').value;
    const siteId = getCurrentSiteId();

    const confirmMsg = `현재 날짜(${sourceDate})의 식수 데이터를 ` +
        `${copyTargetDates.length}개 날짜에 복사하시겠습니까?\n\n` +
        `대상 날짜:\n${copyTargetDates.join('\n')}\n\n` +
        `⚠️ 각 날짜의 기존 데이터는 덮어씁니다.`;

    if (!confirm(confirmMsg)) {
        return;
    }

    closeCopyToMultipleDatesModal();

    // 복사 실행 (기존 copy API 사용)
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    const results = [];
    const allFilteredItems = [];  // ★ 전체 필터링된 항목

    for (const targetDate of copyTargetDates) {
        try {
            const siteParam = siteId ? `?site_id=${siteId}` : '';
            const response = await fetch(`/api/meal-counts/copy/${sourceDate}/${targetDate}${siteParam}`);
            const result = await response.json();

            if (result.success) {
                successCount++;
                results.push({ date: targetDate, count: result.copied || 0 });
                console.log(`✅ ${targetDate} 복사 완료: ${result.copied}건`);

                // ★ 필터링된 항목이 있으면 수집
                if (result.filtered && result.filtered.length > 0) {
                    allFilteredItems.push({
                        date: targetDate,
                        items: result.filtered,
                        count: result.filtered_count
                    });
                    console.log(`⚠️ ${targetDate} 필터링된 고아 데이터: ${result.filtered_count}건`);
                }
            } else {
                failCount++;
                errors.push(`${targetDate}: ${result.error}`);
            }
        } catch (err) {
            failCount++;
            errors.push(`${targetDate}: ${err.message}`);
        }
    }

    let resultMsg = `복사 완료!\n\n✅ 성공: ${successCount}개 날짜\n❌ 실패: ${failCount}개 날짜`;

    if (results.length > 0) {
        const totalCopied = results.reduce((sum, r) => sum + r.count, 0);
        resultMsg += `\n\n📊 총 ${totalCopied}건 복사됨`;
    }

    // ★ 필터링된 고아 데이터 경고
    if (allFilteredItems.length > 0) {
        const totalFiltered = allFilteredItems.reduce((sum, f) => sum + f.count, 0);
        resultMsg += `\n\n⚠️ 경고: ${totalFiltered}개 사업장이 운영 기간 종료로 제외됨`;

        // 상세 내역 (최대 10개)
        const detailItems = [];
        for (const dateGroup of allFilteredItems) {
            for (const item of dateGroup.items.slice(0, 3)) {
                detailItems.push(`  • ${dateGroup.date}: ${item.category} > ${item.slot} > ${item.site_name}`);
                if (detailItems.length >= 10) break;
            }
            if (detailItems.length >= 10) break;
        }
        if (detailItems.length > 0) {
            resultMsg += `\n\n제외된 사업장 예시:\n${detailItems.join('\n')}`;
            if (totalFiltered > detailItems.length) {
                resultMsg += `\n  ... 외 ${totalFiltered - detailItems.length}건`;
            }
        }
    }

    if (errors.length > 0) {
        resultMsg += `\n\n오류 내역:\n${errors.join('\n')}`;
    }

    alert(resultMsg);
}

// 현재 화면에서 식수 데이터 수집 (저장 시 사용하는 것과 동일한 형식)
function collectCurrentMealCountData() {
    const mealCountData = [];
    const workDate = document.getElementById('meal-count-date').value;

    businessTypes.forEach((businessType, tabIndex) => {
        const container = document.getElementById(`menu-sections-${tabIndex}`);
        if (!container) return;

        const sections = container.querySelectorAll('.menu-section');
        sections.forEach((section, sectionIndex) => {
            const menuSelect = section.querySelector('.menu-name-select');
            const menuName = menuSelect?.value || '';
            // ★ meal_type을 category_slots 마스터에서 직접 조회
            const mealType = getSectionMealType(section);
            const matchingInput = section.querySelector('.menu-match-input');
            const matchingName = matchingInput?.value || '';
            const menuOrder = parseInt(section.dataset.menuOrder ?? sectionIndex, 10);

            const businessItems = section.querySelectorAll('.business-input-item');
            businessItems.forEach(item => {
                const siteNameInput = item.querySelector('.business-name-input');
                const countInput = item.querySelector('.business-count-input');

                if (siteNameInput && countInput) {
                    const siteName = siteNameInput.value.trim();
                    const count = parseInt(countInput.value) || 0;

                    if (siteName) {
                        mealCountData.push({
                            business_type: businessType,
                            menu_name: menuName,
                            meal_type: mealType,
                            matching_name: matchingName,
                            menu_order: menuOrder,
                            site_name: siteName,
                            meal_count: count
                        });
                    }
                }
            });
        });
    });

    return mealCountData;
}

// ★ 수정: 통합 API 사용으로 단순화 (loadInitData 재사용)
async function loadFoodCountData() {
    // ★ 사용자가 명시적으로 조회 요청 시 초기 로드 플래그 해제
    _skipInitialLoad = false;

    // ★★★ 상태 리셋으로 이전 데이터 오염 방지 ★★★
    resetPageState();

    // 날짜 변경 시 캐시 무효화 후 loadInitData 호출
    const workDate = document.getElementById('meal-count-date').value;
    const siteId = getCurrentSiteId();

    // 해당 날짜의 캐시 삭제 (새로고침)
    const cacheKey = `${siteId}_${workDate}`;
    siteDataCache.delete(cacheKey);

    // 통합 API로 로드
    await loadInitData();
}

// 캘린더에서 지정된 템플릿 확인
async function checkScheduledTemplate(dateStr, siteId) {
    try {
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const response = await fetch(`/api/template-schedule/${dateStr}${siteParam}`);
        const result = await response.json();
        if (result.success && result.found) {
            return result.schedule;
        }
    } catch (e) {
        console.error('스케줄 확인 오류:', e);
    }
    return null;
}

// 전날 데이터 로드 (이전 데이터 복사용)
async function loadPreviousDayData(currentDate, siteId) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = getLocalDateString(prevDate);

    try {
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const response = await fetch(`/api/meal-counts/${prevDateStr}${siteParam}`);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            console.log(`전날(${prevDateStr}) 데이터 발견: ${result.data.length}건`);
            return result.data;
        }
    } catch (e) {
        console.warn('전날 데이터 로드 오류:', e);
    }
    return null;
}

// 날짜에 맞는 템플릿과 요일타입 구조 찾기 (새로운 day_structures 형식)
function findMatchingTemplate(dateStr) {
    if (!mealTemplates || mealTemplates.length === 0) {
        return null;
    }

    const dayType = getDayTypeFromDate(dateStr);
    console.log(`템플릿 검색 - 날짜: ${dateStr}, 요일타입: ${dayType}`);

    // ★★★ 현재 사이트에 맞는 템플릿 찾기 ★★★
    const siteId = getCurrentSiteId();
    let matchKeyword = null;
    if (siteId === 1) matchKeyword = '본사';
    else if (siteId === 2) matchKeyword = '영남';

    let template = null;
    if (matchKeyword) {
        // 본사/영남이면 해당 키워드가 포함된 템플릿 찾기
        template = mealTemplates.find(t => t.template_name && t.template_name.includes(matchKeyword));
        console.log(`🔍 ${matchKeyword} 템플릿 검색 결과:`, template?.template_name || '없음');
    }

    // 매칭 템플릿이 없으면 첫 번째 템플릿 사용 (fallback)
    if (!template) {
        template = mealTemplates[0];
    }

    if (!template || !template.template_data) {
        console.log('❌ 템플릿 없음');
        return null;
    }

    // 새로운 형식 (day_structures) 확인
    if (template.template_data.day_structures) {
        const dayStructure = template.template_data.day_structures[dayType];
        if (dayStructure && dayStructure.menuStructure) {
            console.log(`✅ 템플릿 발견: ${template.template_name} (${DAY_TYPE_LABELS[dayType]})`);
            // 해당 요일타입의 구조를 반환
            return {
                ...template,
                _dayType: dayType,
                _dayStructure: dayStructure
            };
        }
        // 해당 요일타입이 없으면 평일 구조로 fallback
        const weekdayStructure = template.template_data.day_structures['weekday'];
        if (weekdayStructure && weekdayStructure.menuStructure) {
            console.log(`⚠️ ${DAY_TYPE_LABELS[dayType]} 구조 없음, 평일 구조로 대체`);
            return {
                ...template,
                _dayType: 'weekday',
                _dayStructure: weekdayStructure
            };
        }
    }

    // 기존 형식 (하위 호환) - menuStructure가 직접 있는 경우
    if (template.template_data.menuStructure) {
        console.log(`✅ 기존 형식 템플릿 사용: ${template.template_name}`);
        return {
            ...template,
            _dayType: null,
            _dayStructure: template.template_data
        };
    }

    console.log('❌ 매칭되는 템플릿 구조 없음');
    return null;
}

function applyLoadedDataFromDB(dbData) {
    // DB 데이터를 사업장 유형 > 메뉴 > 사업장 구조로 변환 (순서 포함)
    const structured = {};
    dbData.forEach(row => {
        const bt = row.business_type;
        const menuKey = `${row.menu_name}|${row.meal_type}|${row.matching_name || ''}`;

        if (!structured[bt]) structured[bt] = {};
        if (!structured[bt][menuKey]) {
            structured[bt][menuKey] = {
                menuName: row.menu_name,
                mealType: row.meal_type,
                matchingName: row.matching_name || '',
                menuOrder: row.menu_order ?? 999,  // 순서 정보 (없으면 맨 뒤)
                businesses: [],
                seenSites: new Set()  // ★ 중복 체크용
            };
        }
        // 가장 작은 menu_order를 사용
        if (row.menu_order !== undefined && row.menu_order < structured[bt][menuKey].menuOrder) {
            structured[bt][menuKey].menuOrder = row.menu_order;
        }
        // ★ 같은 끼니에 같은 사업장이 있으면 추가하지 않음
        if (!structured[bt][menuKey].seenSites.has(row.site_name)) {
            structured[bt][menuKey].seenSites.add(row.site_name);
            structured[bt][menuKey].businesses.push({
                name: row.site_name,
                count: row.meal_count
            });
        }
    });

    // ★ businessTypes가 비어있으면 DB 데이터에서 추출 (고정 순서 적용)
    if (businessTypes.length === 0 && Object.keys(structured).length > 0) {
        const categoryOrder = ['도시락', '운반', '학교', '요양원', '기타'];
        const dbCategories = Object.keys(structured);
        // 고정 순서에 있는 카테고리 먼저, 나머지는 뒤에 추가
        businessTypes = categoryOrder.filter(c => dbCategories.includes(c));
        dbCategories.forEach(c => {
            if (!businessTypes.includes(c)) businessTypes.push(c);
        });
        console.log('📋 DB에서 businessTypes 추출 (정렬됨):', businessTypes);
        createBusinessTabs();
    }

    // 테이블 생성
    createFoodCountTables();

    // 각 사업장 유형에 데이터 적용
    businessTypes.forEach((businessType, tabIndex) => {
        const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
        if (!menuSections) return;

        const menus = structured[businessType];
        if (!menus || Object.keys(menus).length === 0) return;

        // 기존 섹션 제거
        menuSections.innerHTML = '';

        // menu_order로 정렬하여 순서 보장
        let sortedMenus = Object.values(menus).sort((a, b) => (a.menuOrder || 0) - (b.menuOrder || 0));
        console.log(`${businessType} 메뉴 순서:`, sortedMenus.map(m => `${m.menuOrder}:${m.menuName}`));

        // ★★★ slotClientsCache 기반 필터링: 현재 날짜에 사업장이 없는 슬롯 제외 ★★★
        const categoryClients = slotClientsCache[businessType];
        if (categoryClients) {
            sortedMenus = sortedMenus.filter(menu => {
                const menuName = (menu.menuName || '').trim();
                if (!menuName) return true;  // 메뉴명 없으면 통과
                const clients = categoryClients[menuName];
                if (!clients || clients.length === 0) {
                    console.log(`🚫 DB 데이터 슬롯 필터링: ${businessType} > ${menuName} (현재 날짜에 사업장 없음)`);
                    return false;
                }
                return true;
            });
        }

        // 정렬된 순서대로 섹션 생성
        sortedMenus.forEach((menu, menuIndex) => {
            const section = createMenuSection(tabIndex, 0, menuIndex, menu.mealType, menu.menuName);
            menuSections.appendChild(section);

            const sectionId = section.id;

            // 매칭명 설정
            const matchInput = section.querySelector('.menu-match-input');
            if (matchInput) matchInput.value = menu.matchingName || '';

            // ★ M-8: DB 데이터 + slotClientsCache 병합 (신규 사업장 누락 방지)
            const businessesToShow = [...menu.businesses];
            const existingNames = new Set(businessesToShow.map(b => normalizeString(b.name)));
            if (menu.menuName && slotClientsCache[businessType]?.[menu.menuName]) {
                slotClientsCache[businessType][menu.menuName].forEach(clientName => {
                    const normalized = normalizeString(clientName);
                    if (normalized && !existingNames.has(normalized)) {
                        businessesToShow.push({ name: normalized, count: '' });
                        existingNames.add(normalized);
                    }
                });
            }

            // 사업장 데이터 적용
            const grid = section.querySelector('.business-input-grid');
            if (grid && businessesToShow && businessesToShow.length > 0) {
                grid.innerHTML = '';
                businessesToShow.forEach((business, idx) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'business-input-item';
                    itemDiv.id = `${sectionId}-item-${idx}`;
                    itemDiv.innerHTML = `
                        <div class="business-input-label">사업장명</div>
                        <input type="text" class="business-name-input" placeholder="사업장명" value="${business.name}"
                               readonly style="background: #f5f5f5; cursor: not-allowed;"
                               title="사업장명은 Admin에서만 수정 가능합니다">
                        <div class="business-input-label">식수</div>
                        <input type="number" class="business-count-input" placeholder="0" min="0" value="${business.count || ''}"
                               onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                        <div class="business-item-actions">
                            <button class="business-item-remove" onclick="removeBusinessItem('${itemDiv.id}', '${sectionId}')">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `;
                    grid.appendChild(itemDiv);
                });
            }

            // 합계 업데이트
            updateSectionTotal(sectionId);
        });
    });

    // ★ 사업장 관리 동기화: slotClientsCache에서 활성 슬롯 자동 추가
    addMissingSlotsFromCache();
}

// ========================
// 다른 날짜에서 불러오기
// ========================
async function showLoadFromDateModal() {
    // 저장된 날짜 목록 가져오기 (현재 선택된 사업장 기준)
    try {
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const response = await fetch(`/api/meal-counts/dates${siteParam}`);
        const result = await response.json();

        let dateOptions = '<option value="">날짜 선택...</option>';
        if (result.success && result.data) {
            result.data.forEach(item => {
                dateOptions += `<option value="${item.date}">${item.date} (${item.total}명)</option>`;
            });
        }

        const currentSiteName = getCurrentSiteName();
        const siteColor = currentSiteName.includes('영남') ? '#e91e63' :
                          currentSiteName.includes('본사') ? '#2196f3' : '#4caf50';

        const modalHtml = `
            <div id="loadFromDateModal" class="modal" style="display: block;">
                <div class="modal-content" style="max-width: 400px;">
                    <div class="modal-header">
                        <h3><i class="fas fa-copy"></i> 다른 날짜에서 불러오기</h3>
                        <span class="close" onclick="closeLoadFromDateModal()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div style="background: ${siteColor}; color: white; padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; font-weight: 600;">
                            📍 현재 사업장: ${currentSiteName}
                        </div>
                        <div class="form-group">
                            <label>불러올 날짜 선택:</label>
                            <select id="source-date-select" class="form-control">
                                ${dateOptions}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>또는 직접 입력:</label>
                            <input type="date" id="source-date-input" class="form-control">
                        </div>
                        <p style="color: #666; font-size: 12px; margin-top: 10px;">
                            ※ <strong>${currentSiteName}</strong>의 식수 데이터만 표시됩니다.<br>
                            ※ 선택한 날짜의 데이터를 현재 날짜로 복사합니다.<br>
                            ※ 현재 입력된 데이터는 덮어씌워집니다.
                        </p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="closeLoadFromDateModal()">취소</button>
                        <button class="btn btn-primary" onclick="loadFromSelectedDate()">
                            <i class="fas fa-download"></i> 불러오기
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 기존 모달 제거
        const existingModal = document.getElementById('loadFromDateModal');
        if (existingModal) existingModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        console.error('날짜 목록 조회 오류:', error);
        alert('날짜 목록을 불러올 수 없습니다.');
    }
}

function closeLoadFromDateModal() {
    const modal = document.getElementById('loadFromDateModal');
    if (modal) modal.remove();
}

async function loadFromSelectedDate() {
    const selectDate = document.getElementById('source-date-select').value;
    const inputDate = document.getElementById('source-date-input').value;
    const sourceDate = selectDate || inputDate;

    if (!sourceDate) {
        alert('불러올 날짜를 선택해주세요.');
        return;
    }

    const currentDate = document.getElementById('meal-count-date').value;

    if (sourceDate === currentDate) {
        alert('현재 날짜와 같은 날짜입니다.');
        return;
    }

    if (!confirm(`${sourceDate}의 식수 데이터를 ${currentDate}로 복사하시겠습니까?\n\n※ 현재 입력된 데이터는 덮어씌워집니다.`)) {
        return;
    }

    try {
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const response = await fetch(`/api/meal-counts/copy/${sourceDate}/${currentDate}${siteParam}`);
        const result = await response.json();

        if (result.success) {
            closeLoadFromDateModal();
            alert(`✅ ${result.copied}건의 데이터가 복사되었습니다.`);
            loadFoodCountData(); // 화면 새로고침
        } else {
            alert('❌ 복사 실패: ' + result.error);
        }
    } catch (error) {
        console.error('복사 오류:', error);
        alert('❌ 서버 연결 오류');
    }
}

// ========================
// 모달 관련 함수 (기존 호환성 유지)
// ========================
function showAddMealCountModal() {
    document.getElementById('meal-count-modal-title').textContent = '식수 등록';
    document.getElementById('meal-count-id').value = '';
    document.getElementById('mealCountForm').reset();

    // 기본값은 내일 (익일 기준)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('form-meal-date').value = getLocalDateString(tomorrow);

    const container = document.getElementById('sites-container');
    container.innerHTML = `
        <div class="site-input-row">
            <input type="text" placeholder="사업장명" class="site-name" required readonly
                   style="background: #f5f5f5; cursor: not-allowed;"
                   title="사업장명은 Admin에서만 수정 가능합니다">
            <input type="number" placeholder="식수" class="site-count" min="0" required>
            <button type="button" class="btn btn-danger btn-sm" onclick="removeSiteRow(this)">삭제</button>
        </div>
    `;

    document.getElementById('mealCountModal').style.display = 'block';
}

function closeMealCountModal() {
    document.getElementById('mealCountModal').style.display = 'none';
}

// ============================================
// 사업장 관리 기능
// ============================================

// 슬롯 설정 캐시
let slotSettingsCache = null;
let siteManagementCategories = [];  // 사업장 관리용 카테고리 캐시
let siteManagementSlots = [];      // 사업장 관리용 슬롯 캐시 (v2 API)

async function openSiteManagementModal() {
    document.getElementById('siteManagementModal').style.display = 'block';

    // v2 API로 카테고리와 슬롯 로드
    await loadSiteManagementCategories();
    loadSlotsForSiteManagement();
    loadMealCountSites();
}

// 사업장 관리용 카테고리 로드 (v2 API 사용)
async function loadSiteManagementCategories() {
    const categorySelect = document.getElementById('newSiteBusinessType');
    try {
        const groupId = getCurrentGroupId();
        const groupName = getCurrentGroupName();
        let response = await fetch(`/api/v2/categories?group_id=${groupId}`);
        let result = await response.json();

        // ★ group_id로 결과 없으면 전체 조회 재시도
        if (result.success && (!result.data || result.data.length === 0)) {
            response = await fetch('/api/v2/categories');
            result = await response.json();
            // 실제 group_id로 기본값 갱신
            if (result.success && result.data && result.data.length > 0) {
                window._defaultGroupId = result.data[0].group_id;
                window._defaultGroupName = result.data[0].group_name || result.data[0].category_name;
            }
        }

        if (result.success && result.data && result.data.length > 0) {
            siteManagementCategories = result.data;

            categorySelect.innerHTML = '';
            result.data.forEach((cat, index) => {
                const option = document.createElement('option');
                option.value = cat.id;  // ★ value를 ID로 변경
                option.setAttribute('data-cat-id', cat.id);
                option.setAttribute('data-cat-name', cat.category_name);
                option.textContent = cat.category_name;
                if (index === 0) option.selected = true;
                categorySelect.appendChild(option);
            });
            console.log(`✅ [v2] 카테고리 로드 (${groupName}): ${result.data.length}개`);
        } else {
            // ★ 카테고리가 없으면 기본 카테고리 자동 생성
            console.warn('⚠️ 카테고리 없음 → 기본 카테고리 자동 생성 시도');
            try {
                const createRes = await fetch('/api/v2/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        group_id: groupId,
                        category_code: 'DEFAULT',
                        category_name: groupName || '기본',
                        display_order: 0
                    })
                });
                const createResult = await createRes.json();
                if (createResult.success && createResult.id) {
                    const catName = groupName || '기본';
                    const catId = createResult.id;
                    siteManagementCategories = [{ id: catId, category_name: catName, group_id: groupId }];
                    categorySelect.innerHTML = '';
                    const option = document.createElement('option');
                    option.value = catId;
                    option.setAttribute('data-cat-id', catId);
                    option.setAttribute('data-cat-name', catName);
                    option.textContent = catName;
                    option.selected = true;
                    categorySelect.appendChild(option);
                    console.log(`✅ 기본 카테고리 자동 생성 완료: ${catName} (id=${catId})`);
                } else {
                    categorySelect.innerHTML = '<option value="">카테고리 없음</option>';
                    console.warn('⚠️ 기본 카테고리 생성 실패:', createResult.error);
                }
            } catch (createError) {
                categorySelect.innerHTML = '<option value="">카테고리 없음</option>';
                console.error('기본 카테고리 생성 오류:', createError);
            }
        }
    } catch (error) {
        console.error('카테고리 로드 오류:', error);
        categorySelect.innerHTML = '<option value="">로드 오류</option>';
    }
}

async function closeSiteManagementModal() {
    document.getElementById('siteManagementModal').style.display = 'none';
    // ★ 모달 닫을 때 캐시 갱신 + 배지 실시간 반영
    const groupId = getCurrentGroupId();
    await refreshSiteStructureCache(groupId);
    refreshAllMealTypeBadges();
}

// v2 API로 슬롯 로드 (카테고리 변경 시 호출) - datalist용
async function loadSlotsForSiteManagement() {
    console.log('🔄 [v2] loadSlotsForSiteManagement 호출됨');
    const categorySelect = document.getElementById('newSiteBusinessType');
    const slotDatalist = document.getElementById('slotDatalist');
    const slotInput = document.getElementById('newSiteSlotName');

    if (!categorySelect || !slotDatalist) {
        console.log('⚠️ 요소 없음');
        return;
    }

    const catId = categorySelect.value;
    const selectedOption = categorySelect.options[categorySelect.selectedIndex];
    const catName = selectedOption ? selectedOption.text : '';

    console.log(`🔍 선택된 카테고리: ${catName} (catId=${catId})`);

    // datalist 초기화
    slotDatalist.innerHTML = '';
    if (slotInput) slotInput.value = '';

    if (!catId) {
        console.log('⚠️ 카테고리 미선택');
        return;
    }

    try {
        // v2 API로 해당 카테고리의 슬롯 조회
        const response = await fetch(`/api/v2/slots?category_id=${catId}`);
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            siteManagementSlots = result.data;

            // 정렬 후 datalist에 옵션 추가
            result.data.sort((a, b) => a.display_order - b.display_order);
            result.data.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.slot_name;  // ★ 슬롯명을 value로
                option.setAttribute('data-slot-id', slot.id);
                option.setAttribute('data-category', catName);  // ★ M-10: 카테고리명 속성 추가
                slotDatalist.appendChild(option);
            });
            console.log(`✅ [v2] 카테고리 ${catId}(${catName}) 슬롯: ${result.data.length}개`);
        } else {
            console.log('ℹ️ 해당 카테고리에 슬롯 없음 (새로 생성 가능)');
        }
    } catch (error) {
        console.error('슬롯 로드 오류:', error);
    }
}

// ★★★ 원스탑 사업장 추가 (슬롯 자동 생성 + 사업장 + 캐시 갱신 + UI 반영) ★★★
async function addNewSiteOneStop() {
    const categorySelect = document.getElementById('newSiteBusinessType');
    const slotNameInput = document.getElementById('newSiteSlotName');
    const mealTypeSelect = document.getElementById('newSiteMealType');  // ★ 끼니 타입
    const clientNameInput = document.getElementById('newSiteName');
    const displayOrder = parseInt(document.getElementById('newSiteOrder').value) || 0;
    const startDate = document.getElementById('newSiteStartDate').value || null;
    const endDate = document.getElementById('newSiteEndDate').value || null;

    const categoryId = categorySelect.value;
    const categoryName = categorySelect.options[categorySelect.selectedIndex]?.text || '';
    const slotName = slotNameInput.value.trim();
    const mealType = mealTypeSelect?.value || '';  // ★ 끼니 타입
    let clientName = clientNameInput.value.trim();

    // 유효성 검사
    if (!slotName) {
        alert('슬롯명을 입력해주세요.');
        return;
    }

    // ★ 끼니 타입 필수 검사 (새 슬롯 생성 시)
    // 기존 슬롯을 선택한 경우에는 체크 생략 (서버에서 처리)
    // 새 슬롯 생성 시에만 meal_type 필수
    // 단, UI에서는 항상 선택하도록 권장
    if (!mealType) {
        alert('끼니 타입을 선택해주세요. (조식/중식/석식/야식)');
        return;
    }

    // ★ 운영 요일 유효성 검사
    if (!validateOperatingDays('new')) {
        alert('운영 요일을 최소 1개 이상 선택해주세요.');
        return;
    }

    // ★ 운영 요일 수집
    const operatingDays = {};
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const cb = document.getElementById(`newDay_${day}`);
        operatingDays[day] = cb ? cb.checked : true;
    });

    // 사업장명이 비어있으면 슬롯명과 동일하게
    if (!clientName) {
        clientName = slotName;
    }

    try {
        // ★ 원스탑 API 호출 (slot_name + category_id + meal_type + operating_days)
        const response = await fetch('/api/v2/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot_name: slotName,
                category_id: parseInt(categoryId) || null,
                group_id: getCurrentGroupId(),  // ★ 카테고리 자동 생성용
                group_name: getCurrentGroupName(),
                meal_type: mealType,  // ★ 끼니 타입 추가
                client_name: clientName,
                display_order: displayOrder,
                start_date: startDate,
                end_date: endDate,
                operating_days: operatingDays,
                modified_by: getCurrentUsername()  // ★ 수정자 추적
            })
        });

        const result = await response.json();

        if (result.success) {
            // ★ 서버에서 반환된 group_id로 기본값 갱신 (자동 생성된 경우)
            if (result.group_id) {
                window._defaultGroupId = result.group_id;
            }

            alert(result.message);

            // 입력 필드 초기화
            slotNameInput.value = '';
            clientNameInput.value = '';
            document.getElementById('newSiteOrder').value = '0';
            document.getElementById('newSiteStartDate').value = '';
            document.getElementById('newSiteEndDate').value = '';
            document.getElementById('newSiteMealType').value = '중식';  // ★ 끼니 타입 초기화
            resetNewSiteDays();  // ★ 요일 체크박스 초기화 (매일 선택)

            // ★★★ C-5: 현재 화면 날짜와 사업장 운영기간 비교 ★★★
            const workDateEl = document.getElementById('meal-count-date');
            const workDate = workDateEl ? workDateEl.value : new Date().toISOString().split('T')[0];
            const isWithinDateRange = checkDateRange(workDate, startDate, endDate);
            console.log(`📅 날짜 체크: workDate=${workDate}, start=${startDate}, end=${endDate}, 범위내=${isWithinDateRange}`);

            // ★★★ 캐시 통합 갱신 (API에서 날짜/요일 필터링된 데이터 가져오기) ★★★
            const groupId = getCurrentGroupId();
            try {
                await refreshSiteStructureCache(groupId);
                refreshAllMealTypeBadges();
                console.log(`✅ 캐시 갱신 완료 (날짜/요일 필터 적용됨)`);
            } catch (cacheErr) {
                console.warn('⚠️ 캐시 갱신 실패 (무시):', cacheErr);
            }

            // datalist 새로고침 (사업장 관리 모달용)
            try { await loadSlotsForSiteManagement(); } catch(e) { console.warn('슬롯 로드 실패:', e); }

            // 사업장 관리 모달 목록 새로고침
            console.log('🔄 loadMealCountSites 호출');
            await loadMealCountSites();

            // ★★★ 식수입력 UI 갱신 ★★★
            // 캐시가 갱신되었으므로 slotClientsCache 기준으로 UI 업데이트
            const clientInCache = slotClientsCache[categoryName]?.[slotName]?.includes(clientName);
            console.log(`🔍 UI 갱신 전: businessTypes=[${businessTypes.join(',')}], 캐시에 존재=${clientInCache}`);

            if (clientInCache) {
                console.log(`🔍 addBusinessToMealInput 호출: category=${categoryName}, slot=${slotName}, client=${clientName}`);
                const addResult = addBusinessToMealInput(categoryName, slotName, clientName);
                if (addResult) {
                    console.log(`✅ 식수입력 UI에 추가 완료: ${categoryName} > ${slotName} > ${clientName}`);
                } else {
                    console.warn(`⚠️ 식수입력 UI 추가 실패 - addMissingSlotsFromCache로 재시도`);
                    addMissingSlotsFromCache();
                }
            } else {
                console.log(`ℹ️ 현재 날짜/요일에 해당 사업장이 표시되지 않음 (날짜/요일 필터에 의해 제외됨)`);
            }

            // 탭 드롭다운 업데이트
            const tabIndex = findCategoryTabIndex(categoryName);
            if (tabIndex >= 0) {
                updateTabSlotDropdowns(tabIndex);
            }

            console.log(`✅ 원스탑 추가 완료: ${categoryName} > ${slotName} > ${clientName} (UI반영=${isWithinDateRange})`);
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('원스탑 추가 오류:', error);
        alert('서버 오류가 발생했습니다.');
    }
}

async function loadMealCountSites() {
    const container = document.getElementById('siteList');
    if (!container) { console.error('siteList 컨테이너 없음'); return; }
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: #999;"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</div>';

    try {
        const groupId = getCurrentGroupId();
        const groupName = getCurrentGroupName();
        console.log(`🔍 loadMealCountSites: groupId=${groupId}, groupName=${groupName}`);

        // ★★★ 전체 조회 (group_id 필터 제거 — simple 모드 호환) ★★★
        const [clientsResponse, slotsResponse] = await Promise.all([
            fetch('/api/v2/clients?include_inactive=true'),
            fetch('/api/v2/slots')
        ]);

        const clientsResult = await clientsResponse.json();
        const slotsResult = await slotsResponse.json();
        console.log(`📋 사업장 목록: clients=${clientsResult.data?.length || 0}, slots=${slotsResult.data?.length || 0}`);

        // 고객사 데이터 변환
        const sites = (clientsResult.success ? clientsResult.data : []).map(c => ({
            id: c.id,
            business_type: c.category_name,
            slot_name: c.slot_name,
            slot_id: c.slot_id,
            site_name: c.client_name,
            display_order: c.display_order,
            is_active: c.is_active,
            category_id: c.category_id,
            start_date: c.start_date,
            end_date: c.end_date,
            operating_days: c.operating_days,  // ★ 운영 요일 추가
            operating_schedule: c.operating_schedule,  // ★ 끼니별 스케줄
            special_dates: c.special_dates,  // ★ 특별 운영일
            meal_type: c.meal_type || '중식'  // ★ 끼니 타입 추가
        }));

        // ★★★ 빈 슬롯도 목록에 추가 (사업장이 없는 슬롯) ★★★
        const slots = slotsResult.success ? slotsResult.data : [];
        const existingSlotIds = new Set(sites.map(s => s.slot_id));

        slots.forEach(slot => {
            if (!existingSlotIds.has(slot.id)) {
                // 사업장이 없는 슬롯 → 더미 항목 추가 (슬롯 헤더 표시용)
                sites.push({
                    id: null,  // 사업장 ID 없음
                    business_type: slot.category_name,
                    slot_name: slot.slot_name,
                    slot_id: slot.id,
                    site_name: null,  // 사업장명 없음
                    display_order: 0,
                    is_active: true,
                    category_id: slot.category_id,
                    start_date: null,
                    end_date: null,
                    _isEmpty: true  // 빈 슬롯 표시용 플래그
                });
                console.log(`📋 빈 슬롯 추가: ${slot.category_name} > ${slot.slot_name}`);
            }
        });

        if (sites.length > 0) {
            renderSiteList(sites);
            console.log(`✅ [v2] 슬롯+고객사 로드 (${groupName}): ${sites.length}개 (슬롯 ${slots.length}개)`);
        } else {
            container.innerHTML = `<div style="text-align: center; padding: 30px; color: #999;">등록된 슬롯/고객사가 없습니다 (${groupName}).<br>위에서 새 고객사를 추가하세요.</div>`;
        }
    } catch (error) {
        console.error('고객사 목록 로드 오류:', error);
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #dc3545;">서버 연결 오류</div>';
    }
}

// 운영 요일을 읽기 쉬운 형식으로 변환
function getOperatingDaysDisplay(days) {
    if (!days) return '매일';

    const dayNames = {mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일'};
    const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const weekends = ['sat', 'sun'];

    const activeDays = allDays.filter(d => days[d] === true);

    // 모든 요일 체크
    if (activeDays.length === 7) return '매일';
    if (activeDays.length === 0) return '없음';

    // 평일만 체크
    if (weekdays.every(d => days[d]) && !days.sat && !days.sun) return '평일';

    // 주말만 체크
    if (!weekdays.some(d => days[d]) && days.sat && days.sun) return '주말';

    // 개별 요일 표시
    return activeDays.map(d => dayNames[d]).join('');
}

function renderSiteList(sites) {
    const container = document.getElementById('siteList');

    // 카테고리별 → 슬롯별 그룹화
    const categoryOrder = ['도시락', '운반', '학교', '요양원', '기타'];
    const grouped = {};

    sites.forEach(site => {
        const businessType = site.business_type || '기타';
        const slotName = site.slot_name || '(슬롯 미지정)';
        if (!grouped[businessType]) grouped[businessType] = {};
        if (!grouped[businessType][slotName]) grouped[businessType][slotName] = [];
        grouped[businessType][slotName].push(site);
    });

    let html = '';
    const categoryColors = {
        '도시락': '#ff9800',
        '운반': '#2196f3',
        '학교': '#4caf50',
        '요양원': '#9c27b0',
        '기타': '#607d8b'
    };

    // ★ categoryOrder에 없는 카테고리도 포함 (자동 생성된 '기본' 등)
    const allCategories = new Set([...categoryOrder, ...Object.keys(grouped)]);
    allCategories.forEach(businessType => {
        if (!grouped[businessType]) return;

        const categoryColor = categoryColors[businessType] || '#607d8b';
        const slots = grouped[businessType];
        const totalCount = Object.values(slots).flat().length;

        html += `<div style="background: ${categoryColor}; color: white; padding: 10px 15px; font-weight: 700; font-size: 15px; margin-top: 10px;">
            📦 ${businessType} (${totalCount}개)
        </div>`;

        // 슬롯명으로 정렬
        const slotNames = Object.keys(slots).sort();

        slotNames.forEach(slotName => {
            const siteList = slots[slotName];
            const slotId = siteList[0]?.slot_id;  // 첫 번째 사업장에서 slot_id 가져오기
            const escapedSlotName = slotName.replace(/'/g, "\\'");

            // 슬롯의 끼니구분 가져오기 (첫 번째 사업장 또는 슬롯 캐시에서)
            const slotMealType = siteList[0]?.meal_type || '';
            const mealTypeColor = {'조식':'#e67e22','중식':'#2980b9','석식':'#8e44ad','야식':'#2c3e50','행사':'#27ae60'}[slotMealType] || '#999';

            html += `<div style="background: #f0f0f0; border-left: 4px solid ${categoryColor}; padding: 6px 15px; font-weight: 600; color: #333; display: flex; align-items: center; justify-content: space-between;">
                <span>🍽️ ${slotName} (${siteList.length}개) <span style="margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:white;background:${mealTypeColor};">${slotMealType || '미지정'}</span></span>
                ${slotId ? `<button onclick="deleteSlot(${slotId}, '${escapedSlotName}')"
                        style="background: #ff5722; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;"
                        title="⚠️ 슬롯 전체 삭제 (연결된 모든 사업장도 함께 삭제됩니다!)">
                    <i class="fas fa-layer-group"></i> 슬롯전체삭제
                </button>` : ''}
            </div>`;

            // ★ 빈 슬롯인지 확인 (사업장이 없는 경우)
            const hasClients = siteList.some(site => site.site_name);

            if (!hasClients) {
                // 빈 슬롯: 안내 메시지만 표시
                html += `
                    <div style="display: flex; align-items: center; padding: 8px 15px 8px 30px; border-bottom: 1px solid #eee; color: #999; font-style: italic;">
                        <span style="flex: 1;">(등록된 사업장 없음 - 위에서 새 사업장을 추가하세요)</span>
                    </div>
                `;
            } else {
                siteList.forEach(site => {
                    // 빈 슬롯 더미 항목은 건너뛰기
                    if (!site.site_name) return;

                    const activeStyle = site.is_active ? '' : 'opacity: 0.5; text-decoration: line-through;';
                    const escapedSlot = (site.slot_name || '').replace(/'/g, "\\'");
                    const escapedName = (site.site_name || '').replace(/'/g, "\\'");
                    const escapedType = (site.business_type || '').replace(/'/g, "\\'");
                    const escapedStart = (site.start_date || '').replace(/'/g, "\\'");
                    const escapedEnd = (site.end_date || '').replace(/'/g, "\\'");

                    // 운영 요일 표시 생성
                    const operatingDays = site.operating_days || {mon:true,tue:true,wed:true,thu:true,fri:true,sat:true,sun:true};
                    const operatingDaysJson = encodeURIComponent(JSON.stringify(operatingDays));
                    const daysDisplay = getOperatingDaysDisplay(operatingDays);

                    // ★ 끼니별 스케줄 및 특별 운영일
                    const operatingScheduleJson = site.operating_schedule ? encodeURIComponent(JSON.stringify(site.operating_schedule)) : '';
                    const specialDatesJson = site.special_dates ? encodeURIComponent(JSON.stringify(site.special_dates)) : '';
                    const mealType = (site.meal_type || '중식').replace(/'/g, "\\'");

                    // ★ 끼니별 스케줄이 있으면 표시
                    let scheduleIndicator = '';
                    if (site.operating_schedule) {
                        scheduleIndicator = '<span style="font-size: 9px; color: #9c27b0; margin-left: 4px; background: #f3e5f5; padding: 1px 5px; border-radius: 8px;">🍽️고급</span>';
                    }
                    if (site.special_dates && site.special_dates.length > 0) {
                        scheduleIndicator += `<span style="font-size: 9px; color: #e65100; margin-left: 4px; background: #fff3e0; padding: 1px 5px; border-radius: 8px;">📅${site.special_dates.length}</span>`;
                    }

                    const dateInfo = site.start_date || site.end_date
                        ? `<span style="font-size: 10px; color: #888; margin-left: 8px;">${site.start_date || '∞'} ~ ${site.end_date || '∞'}</span>`
                        : '';
                    html += `
                        <div style="display: flex; align-items: center; padding: 8px 15px 8px 30px; border-bottom: 1px solid #eee; ${activeStyle}">
                            <span style="flex: 1; font-weight: 500;">
                                ${site.site_name}
                                <span style="font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 700; color: white; background: ${({'조식':'#e67e22','중식':'#2980b9','석식':'#8e44ad','야식':'#2c3e50','행사':'#27ae60'}[site.meal_type] || '#999')}; margin-left: 4px;">${site.meal_type || '미지정'}</span>
                                ${dateInfo}
                                <span style="font-size: 10px; color: #2196f3; margin-left: 8px; background: #e3f2fd; padding: 2px 6px; border-radius: 10px;">${daysDisplay}</span>
                                ${scheduleIndicator}
                            </span>
                            <span style="width: 50px; text-align: center; color: #666; font-size: 11px;">${site.display_order}</span>
                            <span style="width: 40px; text-align: center;">
                                ${site.is_active
                                    ? '<span style="color: #4caf50;"><i class="fas fa-check"></i></span>'
                                    : '<span style="color: #999;"><i class="fas fa-times"></i></span>'}
                            </span>
                            <button onclick="editSite(${site.id}, '${escapedType}', '${escapedSlot}', '${escapedName}', ${site.display_order}, ${site.slot_id || 0}, '${escapedStart}', '${escapedEnd}', '${operatingDaysJson}', '${operatingScheduleJson}', '${specialDatesJson}', '${mealType}')"
                                    style="background: #2196f3; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-right: 4px; font-size: 11px;"
                                    title="수정">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="toggleSiteActive(${site.id}, ${site.is_active}, '${escapedType}', '${escapedSlot}', '${escapedName}')"
                                    style="background: ${site.is_active ? '#ff9800' : '#4caf50'}; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-right: 4px; font-size: 11px;"
                                    title="${site.is_active ? '비활성화' : '활성화'}">
                                ${site.is_active ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>'}
                            </button>
                            <button onclick="deleteSite(${site.id}, '${escapedType}', '${escapedSlot}', '${escapedName}')"
                                    style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;"
                                    title="삭제">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    `;
                });
            }
        });
    });

    container.innerHTML = html || '<div style="text-align: center; padding: 30px; color: #999;">등록된 사업장이 없습니다.</div>';
}

// ★★★ 식수입력 UI에 사업장 즉시 추가 (사업장관리에서 추가 시 호출) ★★★
function addBusinessToMealInput(categoryName, slotName, clientName) {
    console.log(`🔍 addBusinessToMealInput 시작: category=${categoryName}, slot=${slotName}, client=${clientName}`);

    // 1. 카테고리(탭)에 해당하는 tabIndex 찾기 (개선된 매칭)
    const tabIndex = findCategoryTabIndex(categoryName);
    if (tabIndex === -1) {
        console.log(`⚠️ addBusinessToMealInput: 카테고리 '${categoryName}'를 찾을 수 없음 (businessTypes: ${businessTypes.join(', ')})`);
        // 탭이 없어도 캐시에 저장해둠 (나중에 UI가 갱신될 때 반영됨)
        return false;
    }
    console.log(`✅ 탭 인덱스 찾음: ${tabIndex}`);

    // ★★★ 해당 탭으로 자동 전환 ★★★
    if (currentTabIndex !== tabIndex) {
        console.log(`🔄 탭 전환: ${currentTabIndex} → ${tabIndex}`);
        switchBusinessTab(categoryName, tabIndex);
    }

    // 2. 해당 탭의 메뉴 섹션들에서 slotName이 일치하는 섹션 찾기
    const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
    if (!menuSections) {
        console.log(`⚠️ addBusinessToMealInput: menu-sections-${tabIndex} 없음 (카테고리: ${categoryName})`);
        return false;
    }

    const sections = menuSections.querySelectorAll('.menu-section');
    console.log(`🔍 기존 섹션 수: ${sections.length}`);
    let found = false;
    let targetSection = null;
    const normalizedSlotName = normalizeString(slotName);

    // ★ M-11: for...of로 변경 (break로 정확한 루프 종료 보장)
    for (const section of sections) {
        const menuSelect = section.querySelector('.menu-name-select');
        const selectValue = normalizeString(menuSelect?.value || '');
        // 정규화된 매칭
        if (menuSelect && (menuSelect.value === slotName || selectValue === normalizedSlotName)) {
            found = true;
            targetSection = section;
            const sectionId = section.id;
            const grid = document.getElementById(`grid-${sectionId}`);
            if (!grid) break;

            // 이미 같은 이름의 사업장이 있는지 확인
            const existingInputs = grid.querySelectorAll('.business-name-input');
            const normalizedClientName = normalizeString(clientName);

            let alreadyExists = false;
            for (const input of existingInputs) {
                if (normalizeString(input.value) === normalizedClientName) {
                    alreadyExists = true;
                    break;
                }
            }

            if (alreadyExists) {
                console.log(`⚠️ addBusinessToMealInput: '${clientName}'가 이미 존재함`);
                break;
            }

            // 새 사업장 아이템 추가
            const itemCount = grid.children.length;
            const itemId = `${sectionId}-item-${itemCount}`;
            const newItem = document.createElement('div');
            newItem.className = 'business-input-item';
            newItem.id = itemId;
            newItem.innerHTML = `
                <div class="business-input-label">사업장명</div>
                <input type="text" class="business-name-input" value="${clientName}" readonly
                       style="background: #f5f5f5; cursor: not-allowed;"
                       title="사업장명은 Admin에서만 수정 가능합니다">
                <div class="business-input-label">식수</div>
                <input type="number" class="business-count-input" placeholder="0" min="0" value=""
                       onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                <div class="business-item-actions">
                    <button class="business-item-remove" onclick="removeBusinessItem('${itemId}', '${sectionId}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            grid.appendChild(newItem);

            console.log(`✅ addBusinessToMealInput: '${clientName}'를 ${categoryName} > ${slotName} 에 추가 완료`);
            updateSectionTotal(sectionId);
            break;
        }
    }

    if (!found) {
        // ★★★ 섹션이 없으면: 빈 섹션 재활용 또는 새로 생성 ★★★
        console.log(`ℹ️ addBusinessToMealInput: '${slotName}' 섹션 없음 → 새로 생성/재활용`);

        // 1. 먼저 빈 섹션(기본 템플릿)이 있는지 확인하여 재활용
        const allSections = menuSections.querySelectorAll('.menu-section');
        for (const section of allSections) {
            const menuSelect = section.querySelector('.menu-name-select');
            const selectValue = menuSelect?.value || '';
            const grid = section.querySelector('.business-input-grid');
            const hasData = grid && grid.querySelectorAll('.business-count-input').length > 0 &&
                           Array.from(grid.querySelectorAll('.business-count-input')).some(inp => inp.value && parseInt(inp.value) > 0);

            // 기본 템플릿 섹션 감지: 비어있거나, 기본 이름이거나, 데이터가 없는 섹션
            const defaultNames = ['끼니 선택', '새 메뉴', '일반', '메뉴1', ''];
            const isDefaultSection = defaultNames.includes(selectValue) || (!hasData && !selectValue);

            if (isDefaultSection) {
                // 빈 섹션 발견 → 재활용
                targetSection = section;
                console.log(`🔄 빈 섹션 발견 → 재활용: ${selectValue || '(없음)'}`);
                break;
            }
        }

        // 2. 빈 섹션이 없으면 새로 생성
        if (!targetSection) {
            const sectionCount = menuSections.children.length;
            targetSection = createMenuSection(tabIndex, sectionCount, 0, '중식', slotName);
            menuSections.appendChild(targetSection);
            console.log(`✨ 새 섹션 생성: sectionCount=${sectionCount}`);
        }

        // 3. 드롭다운 값을 슬롯명으로 설정 (옵션이 없으면 추가)
        const menuSelect = targetSection.querySelector('.menu-name-select');
        if (menuSelect) {
            // 옵션이 있는지 확인
            let optionExists = Array.from(menuSelect.options).some(opt => opt.value === slotName);
            console.log(`🔍 드롭다운 옵션 확인: ${slotName} 존재=${optionExists}, 총 옵션수=${menuSelect.options.length}`);

            if (!optionExists) {
                // ★ 새 슬롯 옵션 추가
                const newOption = document.createElement('option');
                newOption.value = slotName;
                newOption.textContent = slotName;
                menuSelect.appendChild(newOption);
                console.log(`➕ 드롭다운에 새 옵션 추가: ${slotName}`);
            }

            menuSelect.value = slotName;
            console.log(`✅ 드롭다운 값 설정: ${slotName} (실제값: ${menuSelect.value})`);
        }

        // 4. 사업장 추가 (기존 아이템 모두 제거 후)
        const sectionId = targetSection.id;
        const grid = targetSection.querySelector('.business-input-grid');
        if (grid) {
            // ★★★ 기존 빈 아이템 모두 제거 (중요!)
            grid.innerHTML = '';

            // 새 사업장 아이템 추가
            const itemId = `${sectionId}-item-0`;
            const newItem = document.createElement('div');
            newItem.className = 'business-input-item';
            newItem.id = itemId;
            newItem.innerHTML = `
                <div class="business-input-label">사업장명</div>
                <input type="text" class="business-name-input" value="${clientName}" readonly
                       style="background: #f5f5f5; cursor: not-allowed;"
                       title="사업장명은 Admin에서만 수정 가능합니다">
                <div class="business-input-label">식수</div>
                <input type="number" class="business-count-input" placeholder="0" min="0" value=""
                       onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
                <div class="business-item-actions">
                    <button class="business-item-remove" onclick="removeBusinessItem('${itemId}', '${sectionId}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            grid.appendChild(newItem);
            console.log(`✅ 그리드 초기화 + 사업장 추가 완료`);
        } else {
            console.error(`❌ 그리드를 찾을 수 없음: ${sectionId}`);
        }

        console.log(`✅ addBusinessToMealInput: 섹션 '${slotName}' + '${clientName}' 추가 완료`);
        updateSummaryStats();
    }

    // ★★★ 새로 추가된 섹션으로 스크롤 + 하이라이트 ★★★
    if (targetSection) {
        setTimeout(() => {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 하이라이트 효과
            targetSection.style.transition = 'box-shadow 0.3s ease';
            targetSection.style.boxShadow = '0 0 15px rgba(76, 175, 80, 0.6)';
            setTimeout(() => {
                targetSection.style.boxShadow = '';
            }, 2000);
        }, 100);
    }

    return true;
}

async function addNewSite() {
    const slotSelect = document.getElementById('newSiteSlot');
    const slotId = slotSelect.value;  // ★ 슬롯 ID
    const clientName = document.getElementById('newSiteName').value.trim();
    const displayOrder = parseInt(document.getElementById('newSiteOrder').value) || 0;
    const startDate = document.getElementById('newSiteStartDate').value || null;
    const endDate = document.getElementById('newSiteEndDate').value || null;

    if (!slotId) {
        alert('슬롯을 선택해주세요.');
        return;
    }
    if (!clientName) {
        alert('고객사명을 입력해주세요.');
        return;
    }

    try {
        // v2 API로 고객사 생성
        const response = await fetch('/api/v2/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot_id: parseInt(slotId),
                client_name: clientName,
                display_order: displayOrder,
                start_date: startDate,
                end_date: endDate,
                modified_by: getCurrentUsername()  // ★ 수정자 추적
            })
        });

        const result = await response.json();
        if (result.success) {
            alert(result.message);
            document.getElementById('newSiteName').value = '';
            document.getElementById('newSiteOrder').value = '0';
            document.getElementById('newSiteStartDate').value = '';
            document.getElementById('newSiteEndDate').value = '';
            loadMealCountSites();

            // ★ M-7: 서버 캐시 갱신 후 UI 반영
            const groupId = getCurrentGroupId();
            await refreshSiteStructureCache(groupId);

            // ★ slotClientsCache 업데이트 (식수입력에 즉시 반영)
            const slotOption = slotSelect.options[slotSelect.selectedIndex];
            if (slotOption) {
                const categoryName = slotOption.dataset.category || currentCategoryName;
                const slotName = slotOption.text;
                if (categoryName && slotName) {
                    if (!slotClientsCache[categoryName]) slotClientsCache[categoryName] = {};
                    if (!slotClientsCache[categoryName][slotName]) slotClientsCache[categoryName][slotName] = [];
                    if (!slotClientsCache[categoryName][slotName].includes(clientName)) {
                        slotClientsCache[categoryName][slotName].push(clientName);
                        console.log(`✅ slotClientsCache 업데이트: ${categoryName} > ${slotName} > ${clientName}`);
                    }

                    // ★★★ 식수입력 UI에 즉시 사업장 추가 ★★★
                    addBusinessToMealInput(categoryName, slotName, clientName);
                }
            }
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('고객사 추가 오류:', error);
        alert('서버 오류가 발생했습니다.');
    }
}

// ★ 현재 편집 중인 사업장 데이터 (고급 설정용)
let currentEditingSchedule = null;
let currentEditingSpecialDates = [];

function editSite(id, businessType, slotName, siteName, displayOrder, slotId, startDate, endDate, operatingDaysEncoded, operatingScheduleEncoded, specialDatesEncoded, mealType) {
    // 모달에 현재 값 채우기
    document.getElementById('editSiteId').value = id;
    document.getElementById('editSiteSlotId').value = slotId || '';
    document.getElementById('editSiteName').value = siteName || '';
    document.getElementById('editSiteOrder').value = displayOrder || 0;
    document.getElementById('editSiteStartDate').value = startDate || '';
    document.getElementById('editSiteEndDate').value = endDate || '';
    // ★ 끼니 타입 설정
    document.getElementById('editSiteMealType').value = mealType || '중식';

    // 요일 체크박스 설정 (URL 인코딩된 JSON 디코딩)
    const defaultDays = {mon:true, tue:true, wed:true, thu:true, fri:true, sat:true, sun:true};
    let days = defaultDays;
    try {
        if (operatingDaysEncoded) {
            days = JSON.parse(decodeURIComponent(operatingDaysEncoded));
        }
    } catch (e) {
        console.warn('운영 요일 파싱 오류:', e);
    }
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const checkbox = document.getElementById(`editDay_${day}`);
        if (checkbox) checkbox.checked = days[day] !== false;
    });

    // ★ 끼니별 요일 스케줄 설정
    currentEditingSchedule = null;
    try {
        if (operatingScheduleEncoded) {
            currentEditingSchedule = JSON.parse(decodeURIComponent(operatingScheduleEncoded));
        }
    } catch (e) {
        console.warn('끼니별 스케줄 파싱 오류:', e);
    }
    loadMealScheduleToUI(currentEditingSchedule);

    // ★ 특별 운영일 설정
    currentEditingSpecialDates = [];
    try {
        if (specialDatesEncoded) {
            currentEditingSpecialDates = JSON.parse(decodeURIComponent(specialDatesEncoded));
        }
    } catch (e) {
        console.warn('특별 운영일 파싱 오류:', e);
    }
    renderSpecialDatesList();

    // ★ 고급 설정 섹션 접기
    document.getElementById('mealScheduleSection').style.display = 'none';
    document.getElementById('mealScheduleArrow').style.transform = 'rotate(0deg)';
    document.getElementById('specialDatesSection').style.display = 'none';
    document.getElementById('specialDatesArrow').style.transform = 'rotate(0deg)';

    // 모달 표시
    document.getElementById('editSiteModal').style.display = 'block';
}

function closeEditSiteModal() {
    document.getElementById('editSiteModal').style.display = 'none';
}

function setAllDays(checked) {
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const checkbox = document.getElementById(`editDay_${day}`);
        if (checkbox) checkbox.checked = checked;
    });
}

function setWeekdays() {
    ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = true;
    });
    ['sat', 'sun'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = false;
    });
}

function setWeekends() {
    ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = false;
    });
    ['sat', 'sun'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = true;
    });
}

// ★ 토요일만 선택 (수정 모달용)
function setSaturdayOnly() {
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = false;
    });
    document.getElementById('editDay_sat').checked = true;
}

// ★ 일요일만 선택 (수정 모달용)
function setSundayOnly() {
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(day => {
        document.getElementById(`editDay_${day}`).checked = false;
    });
    document.getElementById('editDay_sun').checked = true;
}

// ★ 원스톱 추가 폼 요일 프리셋
function setNewSiteDays(type) {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    if (type === 'all') {
        // 매일
        days.forEach(day => {
            const cb = document.getElementById(`newDay_${day}`);
            if (cb) cb.checked = true;
        });
    } else if (type === 'weekdays') {
        // 평일만
        days.forEach(day => {
            const cb = document.getElementById(`newDay_${day}`);
            if (cb) cb.checked = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(day);
        });
    } else if (type === 'sat') {
        // 토요일만
        days.forEach(day => {
            const cb = document.getElementById(`newDay_${day}`);
            if (cb) cb.checked = (day === 'sat');
        });
    } else if (type === 'sun') {
        // 일요일만
        days.forEach(day => {
            const cb = document.getElementById(`newDay_${day}`);
            if (cb) cb.checked = (day === 'sun');
        });
    }
}

// ★ 원스톱 폼 요일 체크박스 초기화 (매일 선택)
function resetNewSiteDays() {
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const cb = document.getElementById(`newDay_${day}`);
        if (cb) cb.checked = true;
    });
}

// ★ 요일 선택 유효성 검사
function validateOperatingDays(prefix) {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const hasAnyDay = days.some(day => {
        const cb = document.getElementById(`${prefix}Day_${day}`);
        return cb && cb.checked;
    });
    return hasAnyDay;
}

// ★★★ 끼니별 요일 스케줄 관련 함수들 ★★★
function toggleMealSchedule() {
    const section = document.getElementById('mealScheduleSection');
    const arrow = document.getElementById('mealScheduleArrow');
    if (section.style.display === 'none') {
        section.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
    } else {
        section.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

function toggleSpecialDates() {
    const section = document.getElementById('specialDatesSection');
    const arrow = document.getElementById('specialDatesArrow');
    if (section.style.display === 'none') {
        section.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
    } else {
        section.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

// 끼니별 스케줄 UI에 로드
function loadMealScheduleToUI(schedule) {
    const meals = ['조식', '중식', '석식', '야식'];
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    meals.forEach(meal => {
        days.forEach(day => {
            const cb = document.getElementById(`schedule_${meal}_${day}`);
            if (cb) {
                if (schedule && schedule[day] && schedule[day][meal] !== undefined) {
                    cb.checked = schedule[day][meal];
                } else {
                    // 기본값: 중식만 매일 체크
                    cb.checked = (meal === '중식');
                }
            }
        });
    });
}

// UI에서 끼니별 스케줄 수집
function collectMealScheduleFromUI() {
    const meals = ['조식', '중식', '석식', '야식'];
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const schedule = {};

    days.forEach(day => {
        schedule[day] = {};
        meals.forEach(meal => {
            const cb = document.getElementById(`schedule_${meal}_${day}`);
            schedule[day][meal] = cb ? cb.checked : false;
        });
    });

    return schedule;
}

// 끼니 행 일괄 설정
function setMealRow(meal, type) {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    days.forEach(day => {
        const cb = document.getElementById(`schedule_${meal}_${day}`);
        if (cb) {
            if (type === 'all') {
                cb.checked = true;
            } else if (type === 'weekdays') {
                cb.checked = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(day);
            } else if (type === 'none') {
                cb.checked = false;
            }
        }
    });
}

// 전체 스케줄 해제
function clearAllSchedule() {
    const meals = ['조식', '중식', '석식', '야식'];
    meals.forEach(meal => setMealRow(meal, 'none'));
}

// 기본 스케줄 설정 (중식만 매일)
function setDefaultSchedule() {
    const meals = ['조식', '중식', '석식', '야식'];
    meals.forEach(meal => {
        if (meal === '중식') {
            setMealRow(meal, 'all');
        } else {
            setMealRow(meal, 'none');
        }
    });
}

// ★★★ 특별 운영일 관련 함수들 ★★★
function renderSpecialDatesList() {
    const container = document.getElementById('specialDatesList');
    if (!currentEditingSpecialDates || currentEditingSpecialDates.length === 0) {
        container.innerHTML = '<div style="color: #999; font-size: 12px; text-align: center; padding: 20px;">등록된 특별 운영일이 없습니다.</div>';
        return;
    }

    let html = '';
    currentEditingSpecialDates.forEach((item, idx) => {
        const isOperate = item.meals && item.meals.length > 0;
        const typeLabel = isOperate ? '🟢 특별운영' : '🔴 휴무';
        const mealText = isOperate ? item.meals.join(', ') : '-';
        html += `
            <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: ${isOperate ? '#e8f5e9' : '#ffebee'}; border-radius: 4px; margin-bottom: 5px;">
                <span style="font-weight: 600; color: ${isOperate ? '#2e7d32' : '#c62828'};">${item.date}</span>
                <span style="font-size: 12px;">${typeLabel}</span>
                <span style="font-size: 11px; color: #666;">(${mealText})</span>
                ${item.memo ? `<span style="font-size: 11px; color: #999;">${item.memo}</span>` : ''}
                <button onclick="removeSpecialDate(${idx})" style="margin-left: auto; padding: 3px 8px; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">삭제</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function addSpecialDate() {
    const dateInput = document.getElementById('specialDateInput');
    const typeSelect = document.getElementById('specialDateType');
    const memoInput = document.getElementById('specialDateMemo');

    const date = dateInput.value;
    if (!date) {
        alert('날짜를 선택해주세요.');
        return;
    }

    // 중복 체크
    if (currentEditingSpecialDates.some(s => s.date === date)) {
        alert('이미 등록된 날짜입니다.');
        return;
    }

    const type = typeSelect.value;
    const memo = memoInput.value.trim();

    if (type === 'operate') {
        // 특별 운영: 모든 끼니 운영 (나중에 끼니 선택 UI 추가 가능)
        currentEditingSpecialDates.push({
            date: date,
            meals: ['조식', '중식', '석식', '야식'],
            memo: memo
        });
    } else {
        // 휴무
        currentEditingSpecialDates.push({
            date: date,
            meals: [],
            memo: memo || '휴무'
        });
    }

    // 날짜순 정렬
    currentEditingSpecialDates.sort((a, b) => a.date.localeCompare(b.date));

    // UI 갱신 및 입력 초기화
    renderSpecialDatesList();
    dateInput.value = '';
    memoInput.value = '';
}

function removeSpecialDate(idx) {
    if (confirm('이 특별 운영일을 삭제하시겠습니까?')) {
        currentEditingSpecialDates.splice(idx, 1);
        renderSpecialDatesList();
    }
}

async function saveEditSite() {
    const id = document.getElementById('editSiteId').value;
    const slotId = document.getElementById('editSiteSlotId').value;
    const clientName = document.getElementById('editSiteName').value.trim();
    const displayOrder = parseInt(document.getElementById('editSiteOrder').value) || 0;
    const startDate = document.getElementById('editSiteStartDate').value || null;
    const endDate = document.getElementById('editSiteEndDate').value || null;
    const mealType = document.getElementById('editSiteMealType').value;  // ★ 끼니 타입

    // 요일 체크박스에서 operating_days 생성
    const operatingDays = {};
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        operatingDays[day] = document.getElementById(`editDay_${day}`).checked;
    });

    if (!clientName) {
        alert('고객사명을 입력해주세요.');
        return;
    }

    // ★ 끼니 타입 필수 검사
    if (!mealType) {
        alert('끼니 타입을 선택해주세요. (조식/중식/석식/야식)');
        return;
    }

    // ★ 운영 요일 유효성 검사
    if (!validateOperatingDays('edit')) {
        alert('운영 요일을 최소 1개 이상 선택해주세요.');
        return;
    }

    // ★ 끼니별 스케줄 수집 (고급 설정이 열려있으면 적용)
    const mealScheduleSection = document.getElementById('mealScheduleSection');
    let operatingSchedule = null;
    if (mealScheduleSection.style.display !== 'none') {
        operatingSchedule = collectMealScheduleFromUI();
    }

    // ★ 특별 운영일
    const specialDates = currentEditingSpecialDates;

    try {
        // ★ 슬롯의 끼니 타입 업데이트 (슬롯 레벨 속성)
        if (slotId && mealType) {
            await fetch(`/api/v2/slots/${slotId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meal_type: mealType, modified_by: getCurrentUsername() })
            });
            console.log(`✅ 슬롯 끼니 타입 업데이트: ${mealType}`);
        }

        // v2 API로 고객사 수정
        const response = await fetch(`/api/v2/clients/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_name: clientName,
                display_order: displayOrder,
                start_date: startDate,
                end_date: endDate,
                operating_days: operatingDays,
                operating_schedule: operatingSchedule,
                special_dates: specialDates,
                modified_by: getCurrentUsername()  // ★ 수정자 추적
            })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            closeEditSiteModal();
            loadMealCountSites();

            // ★★★ 캐시 갱신 및 식수입력 UI 즉시 반영 ★★★
            const groupId = getCurrentGroupId();
            await refreshSiteStructureCache(groupId);
            addMissingSlotsFromCache();
            refreshAllMealTypeBadges();  // ★ meal_type 배지 실시간 갱신
            console.log('✅ 사업장 수정 후 캐시 및 UI 갱신 완료');
        } else {
            alert('오류: ' + result.error);
        }
    } catch (err) {
        console.error('수정 오류:', err);
        alert('서버 오류가 발생했습니다.');
    }
}

async function toggleSiteActive(id, currentActive, categoryName, slotName, clientName) {
    const action = currentActive ? '비활성화' : '활성화';
    if (!confirm(`이 고객사를 ${action}하시겠습니까?`)) return;

    try {
        // v2 API로 활성화/비활성화
        const response = await fetch(`/api/v2/clients/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !currentActive, modified_by: getCurrentUsername() })
        });
        const result = await response.json();
        alert(result.success ? result.message : '오류: ' + result.error);

        if (result.success) {
            // ★ H-4: 캐시/UI 즉시 갱신
            const groupId = getCurrentGroupId();
            await refreshSiteStructureCache(groupId);
            if (currentActive && categoryName && slotName && clientName) {
                // 비활성화 → UI에서 제거
                removeBusinessFromMealInput(categoryName, slotName, clientName);
            } else {
                // 활성화 → 누락 슬롯 추가
                addMissingSlotsFromCache();
            }
        }
        loadMealCountSites();
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('서버 오류가 발생했습니다.');
    }
}

// ★★★ 슬롯 삭제 (연결된 사업장도 함께 삭제) ★★★
async function deleteSlot(slotId, slotName) {
    // ★ 2단계 확인 - 슬롯 삭제는 위험한 작업
    if (!confirm(`⚠️ 경고: "${slotName}" 슬롯 전체를 삭제합니다!\n\n이 슬롯 아래의 모든 사업장도 함께 삭제됩니다.\n\n정말 삭제하시겠습니까?`)) return;
    if (!confirm(`🚨 최종 확인: "${slotName}" 슬롯과 모든 사업장이 영구 삭제됩니다.\n\n계속하시겠습니까?`)) return;

    try {
        const response = await fetch(`/api/v2/slots/${slotId}`, { method: 'DELETE' });
        const result = await response.json();

        if (result.success) {
            alert(`"${slotName}" 슬롯이 삭제되었습니다.`);

            // ★ 캐시에서 슬롯 제거 (헬퍼 함수 사용)
            removeSlotFromCache(slotName);

            // ★★★ slotClientsCache에서도 제거 (정규화 매칭 사용) ★★★
            const normalizedSlotName = normalizeString(slotName);
            for (const category in slotClientsCache) {
                // 정규화된 슬롯명으로 매칭하여 특수문자/공백 차이 처리
                for (const cachedSlot in slotClientsCache[category]) {
                    if (normalizeString(cachedSlot) === normalizedSlotName) {
                        delete slotClientsCache[category][cachedSlot];
                        console.log(`✅ slotClientsCache에서 삭제: ${category} > ${cachedSlot}`);
                    }
                }
            }

            // ★★★ 식수입력 UI에서 섹션 제거 ★★★
            removeSlotFromMealInput(slotName);

            // ★ datalist 갱신
            await loadSlotsForSiteManagement();
            // ★ 사업장 목록 갱신
            await loadMealCountSites();
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('슬롯 삭제 오류:', error);
        alert('서버 오류가 발생했습니다.');
    }
}

async function deleteSite(id, categoryName, slotName, clientName) {
    if (!confirm('이 고객사를 삭제하시겠습니까?\n(복구할 수 없습니다)')) return;

    try {
        const response = await fetch(`/api/v2/clients/${id}`, { method: 'DELETE' });
        const result = await response.json();
        alert(result.success ? result.message : '오류: ' + result.error);

        if (result.success && categoryName && slotName && clientName) {
            // ★ slotClientsCache에서 제거 (정규화된 매칭)
            const normalizedClientName = normalizeString(clientName);
            if (slotClientsCache[categoryName]?.[slotName]) {
                const idx = slotClientsCache[categoryName][slotName].findIndex(
                    c => normalizeString(c) === normalizedClientName
                );
                if (idx > -1) {
                    slotClientsCache[categoryName][slotName].splice(idx, 1);
                    console.log(`✅ slotClientsCache에서 삭제: ${categoryName} > ${slotName} > ${clientName}`);
                }
            }
            // ★ 식수입력 UI에서도 즉시 제거
            removeBusinessFromMealInput(categoryName, slotName, clientName);
        }

        await loadMealCountSites();
    } catch (error) {
        console.error('삭제 오류:', error);
        alert('서버 오류가 발생했습니다.');
    }
}

// ★★★ 식수입력 UI에서 슬롯(섹션) 전체 제거 (슬롯 삭제 시 호출) ★★★
function removeSlotFromMealInput(slotName) {
    if (!slotName) {
        console.warn(`⚠️ removeSlotFromMealInput: slotName 누락`);
        return;
    }

    const normalizedSlotName = normalizeString(slotName);
    console.log(`🗑️ removeSlotFromMealInput: '${slotName}' 섹션 제거 시작`);

    // 모든 탭에서 해당 슬롯의 섹션 찾아서 제거
    businessTypes.forEach((categoryName, tabIndex) => {
        const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
        if (!menuSections) return;

        const sections = menuSections.querySelectorAll('.menu-section');
        sections.forEach(section => {
            const menuSelect = section.querySelector('.menu-name-select');
            const selectValue = menuSelect?.value || '';
            const normalizedSelectValue = normalizeString(selectValue);

            // 슬롯명이 일치하면 섹션 전체 제거
            if (selectValue === slotName || normalizedSelectValue === normalizedSlotName) {
                section.remove();
                console.log(`✅ removeSlotFromMealInput: '${slotName}' 섹션 제거 완료 (탭: ${categoryName})`);
            }
        });
    });

    // 통계 업데이트
    updateSummaryStats();
}

// ★★★ 식수입력 UI에서 사업장 즉시 제거 (사업장관리에서 삭제 시 호출) ★★★
function removeBusinessFromMealInput(categoryName, slotName, clientName) {
    // ★ 필수 파라미터 검증 (빈 값이면 잘못된 매칭 방지)
    if (!slotName || !clientName) {
        console.warn(`⚠️ removeBusinessFromMealInput: 필수 파라미터 누락 (slot=${slotName}, client=${clientName})`);
        return;
    }

    // 개선된 카테고리 매칭
    const tabIndex = findCategoryTabIndex(categoryName);
    if (tabIndex === -1) {
        console.log(`⚠️ removeBusinessFromMealInput: 카테고리 '${categoryName}'를 찾을 수 없음`);
        return;
    }

    const menuSections = document.getElementById(`menu-sections-${tabIndex}`);
    if (!menuSections) return;

    const normalizedClientName = normalizeString(clientName);
    const normalizedSlotName = normalizeString(slotName);

    // ★ 정규화된 값도 검증
    if (!normalizedSlotName || !normalizedClientName) {
        console.warn(`⚠️ removeBusinessFromMealInput: 정규화 후 빈 값 (slot=${normalizedSlotName}, client=${normalizedClientName})`);
        return;
    }

    const sections = menuSections.querySelectorAll('.menu-section');
    sections.forEach(section => {
        const menuSelect = section.querySelector('.menu-name-select');
        const selectValue = menuSelect?.value || '';
        const normalizedSelectValue = normalizeString(selectValue);

        // ★ 슬롯명이 빈 값이 아니고, 정확히 일치할 때만 처리
        if (selectValue && (selectValue === slotName || normalizedSelectValue === normalizedSlotName)) {
            const sectionId = section.id;
            const grid = document.getElementById(`grid-${sectionId}`);
            if (!grid) return;

            const items = grid.querySelectorAll('.business-input-item');
            items.forEach(item => {
                const nameInput = item.querySelector('.business-name-input');
                if (nameInput && normalizeString(nameInput.value) === normalizedClientName) {
                    item.remove();
                    console.log(`✅ removeBusinessFromMealInput: '${clientName}'를 ${categoryName} > ${slotName} 에서 제거 완료`);
                }
            });

            updateSectionTotal(sectionId);
        }
    });
}

function addSiteRow() {
    const container = document.getElementById('sites-container');
    const newRow = document.createElement('div');
    newRow.className = 'site-input-row';
    newRow.innerHTML = `
        <input type="text" placeholder="사업장명" class="site-name" required readonly
               style="background: #f5f5f5; cursor: not-allowed;"
               title="사업장명은 Admin에서만 수정 가능합니다">
        <input type="number" placeholder="식수" class="site-count" min="0" required>
        <button type="button" class="btn btn-danger btn-sm" onclick="removeSiteRow(this)">삭제</button>
    `;
    container.appendChild(newRow);
}

function removeSiteRow(button) {
    const container = document.getElementById('sites-container');
    if (container.children.length > 1) {
        button.parentNode.remove();
    } else {
        alert('최소 하나의 사업장은 입력해야 합니다.');
    }
}

function saveMealCount() {
    alert('모달 저장 기능 대신 메인 저장 버튼을 사용해주세요.');
    closeMealCountModal();
}

// 모달 외부 클릭시 닫기
window.onclick = function (event) {
    const modal = document.getElementById('mealCountModal');
    if (event.target == modal) {
        closeMealCountModal();
    }
}

// ========================
// 템플릿 관리 기능
// ========================
let mealTemplates = [];

// 현재 화면에서 메뉴 구조와 식수 데이터를 수집하는 함수
// ※ 화면에 나타난 순서대로 저장하여 순서 보장
function collectCurrentScreenData() {
    const templateData = {
        mealData: {},
        menuStructure: {},
        categoryOrder: [...businessTypes]  // ★ 현재 탭 순서 저장 (DB에 고정)
    };

    businessTypes.forEach((businessType, tabIndex) => {
        const table = document.getElementById(`table-${tabIndex}`);
        if (!table) return;

        const sections = table.querySelectorAll('.menu-section');
        const menuList = [];      // 화면 순서대로 메뉴 저장
        const businesses = [];    // 사업장별 식수 데이터

        sections.forEach((section, order) => {
            const menuName = (section.querySelector('.menu-name-select') || section.querySelector('.menu-name-input'))?.value || '';
            const matchingName = section.querySelector('.menu-match-input')?.value || '';
            // ★ meal_type을 category_slots 마스터에서 직접 조회
            const mealType = getSectionMealType(section);

            // ★★★ 빈 슬롯은 템플릿에 저장하지 않음 ★★★
            const skipNames = ['', '끼니 선택', '새 메뉴', '일반', '메뉴1'];
            if (skipNames.includes(menuName.trim())) {
                console.log(`⏭️ 빈 슬롯 제외: "${menuName}"`);
                return;  // 빈 슬롯 건너뛰기
            }

            // 화면 순서대로 메뉴 저장 (order 포함)
            menuList.push({
                order: menuList.length,  // ★ 빈 슬롯 제외 후 순서 재계산
                mealType: mealType,
                menuName: menuName,
                matchingName: matchingName
            });

            // 사업장별 식수 데이터 수집
            const businessItems = section.querySelectorAll('.business-input-item');
            businessItems.forEach(item => {
                const siteName = item.querySelector('.business-name-input')?.value || '';
                const mealCount = parseInt(item.querySelector('.business-count-input')?.value) || 0;
                if (siteName || mealCount > 0) {
                    businesses.push({
                        order: order,
                        menuName,
                        matchingName,
                        mealType,
                        siteName,
                        mealCount
                    });
                }
            });
        });

        // 새 형식: menuList는 순서가 보장된 배열
        templateData.menuStructure[businessType] = menuList;
        if (businesses.length > 0) {
            templateData.mealData[businessType] = businesses;
        }
    });

    return templateData;
}

async function loadMealTemplates() {
    try {
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const response = await fetch('/api/meal-templates' + siteParam);
        const result = await response.json();
        if (result.success || result.templates) {
            mealTemplates = result.templates || [];
            updateMealTemplateSelect();
        }
    } catch (e) {
        console.error('템플릿 목록 로드 오류:', e);
    }
}

function updateMealTemplateSelect() {
    const select = document.getElementById('mealTemplateSelect');
    const templateNameSpan = document.getElementById('currentTemplateName');
    select.innerHTML = '<option value="">-- 템플릿 선택 --</option>';

    // ★ 현재 사업장에 맞는 템플릿 자동 매칭
    const siteId = getCurrentSiteId();
    const siteName = typeof SiteSelector !== 'undefined' ? (SiteSelector.getCurrentSiteName() || '') : '';

    // 사업장 키워드 매칭 (본사=1, 영남=2)
    let matchKeyword = '';
    if (siteId === 1 || siteName.includes('본사')) {
        matchKeyword = '본사';
    } else if (siteId === 2 || siteName.includes('영남')) {
        matchKeyword = '영남';
    }

    let matchedTemplate = null;

    mealTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;

        // 템플릿 이름 + 저장된 요일 타입 표시
        let displayText = t.template_name;

        // 새로운 형식: day_structures에서 저장된 요일 타입 확인
        const dayStructures = t.template_data?.day_structures || {};
        const savedDayTypes = Object.keys(dayStructures).filter(k => dayStructures[k]);

        if (savedDayTypes.length > 0) {
            const shortLabels = {
                weekday: '평일',
                saturday: '토',
                sunday: '일',
                holiday: '휴일'
            };
            const dayTypeText = savedDayTypes.map(dt => shortLabels[dt] || dt).join('/');
            displayText += ` [${dayTypeText}]`;
        } else if (t.template_data?.menuStructure) {
            // 기존 형식 (하위 호환)
            displayText += ' [기존형식]';
        }

        option.textContent = displayText;
        select.appendChild(option);

        // ★ 사업장에 맞는 템플릿 매칭
        if (matchKeyword && t.template_name.includes(matchKeyword)) {
            matchedTemplate = { id: t.id, name: displayText };
        }
    });

    // ★ 자동 선택 및 표시 (본사/영남만 자동 적용)
    if (matchedTemplate) {
        select.value = matchedTemplate.id;
        templateNameSpan.textContent = matchedTemplate.name;
        templateNameSpan.style.background = '#e8f4fd';
        console.log(`📋 템플릿 자동 선택: ${matchedTemplate.name}`);

        // ★ 최초 한 번만 자동 적용 (본사/영남 사업장만)
        if (!window._templateAutoApplied) {
            window._templateAutoApplied = true;
            setTimeout(() => {
                loadMealTemplate(true);  // silent 모드
            }, 100);
        }
    } else if (matchKeyword && mealTemplates.length > 0) {
        // ★ 본사/영남인데 매칭 템플릿이 없으면 선택 초기화 (다른 그룹 템플릿 선택 방지)
        select.value = '';
        templateNameSpan.textContent = `${matchKeyword} 템플릿 없음`;
        templateNameSpan.style.background = '#fff3cd';
        console.log(`⚠️ ${matchKeyword} 전용 템플릿 없음 - 선택 초기화`);
    } else if (mealTemplates.length > 0) {
        // 본사/영남 외 사업장: 템플릿 선택만 하고 자동 적용 안 함
        const firstTemplate = mealTemplates[0];
        select.value = firstTemplate.id;
        templateNameSpan.textContent = '템플릿 미적용';
        templateNameSpan.style.background = '#e0e0e0';
        console.log(`📋 템플릿 미적용 (본사/영남 외 사업장)`);
    } else {
        templateNameSpan.textContent = '템플릿 없음';
        templateNameSpan.style.background = '#f8d7da';
    }

    // 템플릿 목록 패널도 업데이트
    renderTemplateListPanel();
}

// 템플릿 목록 패널 토글
function toggleTemplateList() {
    const panel = document.getElementById('templateListPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        renderTemplateListPanel();
    } else {
        panel.style.display = 'none';
    }
}

// 템플릿 목록 패널 렌더링 (새로운 day_structures 형식)
function renderTemplateListPanel() {
    const grid = document.getElementById('templateListGrid');
    const countBadge = document.getElementById('templateCountBadge');

    if (!mealTemplates || mealTemplates.length === 0) {
        grid.innerHTML = '<div style="text-align: center; color: #999; padding: 20px; grid-column: 1/-1;">저장된 템플릿이 없습니다. "새 템플릿" 버튼으로 추가하세요.</div>';
        countBadge.textContent = '0개';
        return;
    }

    countBadge.textContent = `${mealTemplates.length}개`;

    grid.innerHTML = mealTemplates.map(t => {
        // 저장된 요일타입 배지 (새로운 형식)
        let daysHtml = '';
        const dayStructures = t.template_data?.day_structures || {};
        const savedDayTypes = Object.keys(dayStructures).filter(k => dayStructures[k]);

        if (savedDayTypes.length > 0) {
            const dayTypeColors = {
                weekday: '#4a90d9',
                saturday: '#e67e22',
                sunday: '#9b59b6',
                holiday: '#e74c3c'
            };
            daysHtml = savedDayTypes.map(dt => {
                const label = DAY_TYPE_LABELS[dt] || dt;
                const color = dayTypeColors[dt] || '#95a5a6';
                return `<span style="background:${color}; color:#fff; padding:2px 8px; border-radius:10px; font-size:11px; margin-right:4px;">${label}</span>`;
            }).join('');
        } else if (t.template_data?.menuStructure) {
            // 기존 형식 (하위 호환)
            daysHtml = '<span style="background:#95a5a6; color:#fff; padding:2px 8px; border-radius:10px; font-size:11px;">기존형식</span>';
        }

        return `
            <div style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:12px; cursor:pointer; transition:all 0.2s;"
                 onclick="selectAndLoadTemplate(${t.id})"
                 onmouseover="this.style.borderColor='#4a90d9'; this.style.boxShadow='0 2px 8px rgba(74,144,217,0.2)';"
                 onmouseout="this.style.borderColor='#ddd'; this.style.boxShadow='none';">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="font-weight:600; color:#333; font-size:14px;">${t.template_name || '이름 없음'}</div>
                    <div style="display:flex; gap:4px;">
                        <button onclick="event.stopPropagation(); editTemplateById(${t.id})" style="background:none; border:none; cursor:pointer; color:#666; padding:2px;" title="수정">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="event.stopPropagation(); deleteTemplateById(${t.id})" style="background:none; border:none; cursor:pointer; color:#e74c3c; padding:2px;" title="삭제">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                ${t.description ? `<div style="font-size:12px; color:#888; margin-top:4px;">${t.description}</div>` : ''}
                <div style="margin-top:8px;">${daysHtml || '<span style="color:#999; font-size:11px;">구조 없음</span>'}</div>
            </div>
        `;
    }).join('');
}

// 템플릿 선택하고 바로 적용
function selectAndLoadTemplate(templateId) {
    document.getElementById('mealTemplateSelect').value = templateId;
    loadMealTemplate();
}

// ID로 템플릿 수정
function editTemplateById(templateId) {
    document.getElementById('mealTemplateSelect').value = templateId;
    editMealTemplate();
}

// ID로 템플릿 삭제
async function deleteTemplateById(templateId) {
    const template = mealTemplates.find(t => t.id == templateId);
    if (!confirm(`"${template?.template_name}" 템플릿을 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/meal-templates/${templateId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            alert('✅ 템플릿이 삭제되었습니다.');
            loadMealTemplates();
        } else {
            alert('❌ 삭제 실패: ' + result.error);
        }
    } catch (e) {
        console.error('템플릿 삭제 오류:', e);
        alert('❌ 삭제 중 오류가 발생했습니다.');
    }
}

// 현재 수정 중인 템플릿 ID (null이면 새로 저장)
let editingTemplateId = null;

// ========================
// 요일 타입 관련 함수들
// ========================
const DAY_TYPE_LABELS = {
    weekday: '평일(월~금)',
    saturday: '토요일',
    sunday: '일요일',
    holiday: '공휴일'
};

// 날짜에서 요일 타입 판단
function getDayTypeFromDate(dateStr) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0=일, 1=월, ..., 6=토

    // TODO: 공휴일 체크 로직 추가 가능
    // const isHoliday = checkHoliday(dateStr);
    // if (isHoliday) return 'holiday';

    if (dayOfWeek === 0) return 'sunday';
    if (dayOfWeek === 6) return 'saturday';
    return 'weekday';
}

// 요일 타입 선택
function selectDayType(dayType) {
    document.getElementById('selectedDayType').value = dayType;

    // 버튼 활성화 상태 업데이트
    document.querySelectorAll('.day-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.daytype === dayType) {
            btn.classList.add('active');
        }
    });

    // 상태 텍스트 업데이트
    const label = DAY_TYPE_LABELS[dayType] || dayType;
    document.getElementById('dayTypeStatusText').innerHTML =
        `현재 화면의 메뉴 구조가 <strong>${label}</strong>에 적용됩니다.`;
}

// 템플릿 저장 모달 열기
function saveMealTemplate() {
    showTemplateSaveModal();
}

function showTemplateSaveModal() {
    // 신규 저장 모드로 초기화
    editingTemplateId = null;

    // 모달 초기화
    document.getElementById('templateName').value = '';
    document.getElementById('templateDescription').value = '';

    // 현재 날짜의 요일 타입으로 자동 선택
    const workDate = document.getElementById('meal-count-date').value;
    const currentDayType = getDayTypeFromDate(workDate);
    selectDayType(currentDayType);

    // 기존 템플릿이 있으면 이름 자동 채우기
    if (mealTemplates.length > 0) {
        const existingTemplate = mealTemplates[0];
        document.getElementById('templateName').value = existingTemplate.template_name || '';
        document.getElementById('templateDescription').value = existingTemplate.description || '';
        editingTemplateId = existingTemplate.id;

        // 기존 저장된 요일 타입 표시
        updateExistingDayTypesDisplay(existingTemplate);
    }

    // 모달 표시
    document.getElementById('templateSaveModal').style.display = 'flex';
}

// 기존 템플릿에 저장된 요일 타입 표시
function updateExistingDayTypesDisplay(template) {
    const container = document.getElementById('existingDayTypes');
    if (!template || !template.template_data) {
        container.innerHTML = '';
        return;
    }

    const dayStructures = template.template_data.day_structures || {};
    const savedTypes = Object.keys(dayStructures).filter(key => dayStructures[key]);

    if (savedTypes.length > 0) {
        const labels = savedTypes.map(t => DAY_TYPE_LABELS[t] || t).join(', ');
        container.innerHTML = `이미 저장됨: ${labels}`;
    } else {
        container.innerHTML = '';
    }

    // 버튼에 저장 여부 표시
    document.querySelectorAll('.day-type-btn').forEach(btn => {
        const dt = btn.dataset.daytype;
        btn.classList.toggle('has-data', savedTypes.includes(dt));
    });
}

function closeTemplateSaveModal() {
    document.getElementById('templateSaveModal').style.display = 'none';
    editingTemplateId = null;
}

// 템플릿 저장/수정 확인 (새로운 day_structures 형식)
async function confirmSaveTemplate() {
    const name = document.getElementById('templateName').value.trim();
    const description = document.getElementById('templateDescription').value.trim();
    const selectedDayType = document.getElementById('selectedDayType').value;

    if (!name) {
        alert('템플릿 이름을 입력해주세요.');
        document.getElementById('templateName').focus();
        return;
    }

    // 현재 화면에서 메뉴 구조와 식수 데이터 수집
    const currentScreenData = collectCurrentScreenData();
    console.log('저장할 화면 데이터:', currentScreenData);

    // 기존 템플릿의 day_structures 가져오기 (있으면)
    let dayStructures = {};
    if (editingTemplateId) {
        const existingTemplate = mealTemplates.find(t => t.id == editingTemplateId);
        if (existingTemplate && existingTemplate.template_data && existingTemplate.template_data.day_structures) {
            dayStructures = { ...existingTemplate.template_data.day_structures };
        }
    }

    // 선택한 요일 타입에 현재 화면 데이터 저장
    dayStructures[selectedDayType] = currentScreenData;

    // 새로운 template_data 형식
    const templateData = {
        day_structures: dayStructures,
        version: 2  // 새로운 형식 버전 표시
    };

    console.log('저장할 템플릿 데이터:', templateData);

    try {
        // 수정 모드인지 신규 저장인지 판단
        const isEdit = editingTemplateId !== null;
        const url = isEdit ? `/api/meal-templates/${editingTemplateId}` : '/api/meal-templates';
        const method = isEdit ? 'PUT' : 'POST';

        const siteId = getCurrentSiteId();
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_name: name,
                description: description,
                template_data: templateData,
                valid_from: null,
                valid_to: null,
                apply_days: null,  // 더 이상 사용 안함
                user_id: 1,
                site_id: siteId
            })
        });
        const result = await response.json();
        if (result.success) {
            const dayTypeLabel = DAY_TYPE_LABELS[selectedDayType];
            alert(`✅ 템플릿 "${name}"의 ${dayTypeLabel} 구조가 저장되었습니다.`);
            closeTemplateSaveModal();
            loadMealTemplates();
        } else {
            alert('❌ 템플릿 저장 실패: ' + result.error);
        }
    } catch (e) {
        console.error('템플릿 저장 오류:', e);
        alert('❌ 템플릿 저장 중 오류가 발생했습니다.');
    }
}

async function loadMealTemplate(silent = false) {
    const select = document.getElementById('mealTemplateSelect');
    const templateId = select.value;
    if (!templateId) {
        if (!silent) alert('템플릿을 선택해주세요.');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        if (!silent) alert('템플릿을 찾을 수 없습니다.');
        return;
    }

    // 현재 날짜의 요일 타입 확인
    const workDate = document.getElementById('meal-count-date').value;
    const dayType = getDayTypeFromDate(workDate);
    const dayTypeLabel = DAY_TYPE_LABELS[dayType];

    // silent 모드가 아닐 때만 확인 팝업 표시
    if (!silent && !confirm(`"${template.template_name}" 템플릿의 ${dayTypeLabel} 구조를 적용하시겠습니까?\n\n※ 현재 화면의 메뉴 구조가 템플릿으로 대체됩니다.`)) {
        return;
    }

    // 템플릿 데이터 적용 (새로운 day_structures 형식)
    const templateData = template.template_data;
    let dataToApply = null;

    // 새로운 형식 (day_structures)
    if (templateData && templateData.day_structures) {
        dataToApply = templateData.day_structures[dayType];
        // 해당 요일타입이 없으면 평일로 fallback
        if (!dataToApply) {
            dataToApply = templateData.day_structures['weekday'];
            if (dataToApply) {
                alert(`⚠️ ${dayTypeLabel} 구조가 없어 평일 구조를 적용합니다.`);
            }
        }
    }
    // 기존 형식 (하위 호환)
    else if (templateData && templateData.menuStructure) {
        dataToApply = templateData;
    }

    if (dataToApply && dataToApply.menuStructure) {
        applyTemplateData(dataToApply);

        // 최근 선택한 템플릿 ID 저장
        localStorage.setItem('lastSelectedTemplateId', templateId);

        // silent 모드가 아닐 때만 완료 메시지 표시
        if (!silent) {
            const hasData = dataToApply.mealData && Object.keys(dataToApply.mealData).length > 0;
            if (hasData) {
                alert(`✅ 템플릿 "${template.template_name}"의 ${dayTypeLabel} 구조가 적용되었습니다.\n\n메뉴 구조와 식수 데이터가 함께 적용되었습니다.`);
            } else {
                alert(`✅ 템플릿 "${template.template_name}"의 ${dayTypeLabel} 구조가 적용되었습니다.\n\n메뉴 구조만 적용되었습니다. 식수를 입력하고 저장해주세요.`);
            }
        } else {
            console.log(`📋 템플릿 자동 적용 완료: ${template.template_name} (${dayTypeLabel})`);
        }
    } else {
        if (!silent) alert('⚠️ 템플릿에 해당 요일의 메뉴 구조 데이터가 없습니다.\n먼저 "새 템플릿" 버튼으로 저장해주세요.');
    }
}

// 템플릿 전체 데이터(메뉴 구조 + 식수 데이터)를 적용하는 함수
// ※ 새 형식(order 포함)과 기존 형식(menus 배열) 모두 지원
// ★ skipMealData=true: 메뉴 구조만 적용, 식수는 적용하지 않음 (자동 로드 시)
function applyTemplateData(templateData, skipMealData = false) {
    console.log('템플릿 데이터 적용:', templateData, 'skipMealData:', skipMealData);

    const menuStructure = templateData.menuStructure || {};
    const mealData = skipMealData ? {} : (templateData.mealData || {});

    // ★ 템플릿의 카테고리들을 businessTypes로 설정 (항상 고정 순서 적용)
    const categoryOrder = ['도시락', '운반', '학교', '요양원', '기타'];
    const rawCategories = templateData.categoryOrder || Object.keys(menuStructure);
    // 고정 순서로 재정렬
    let templateCategories = categoryOrder.filter(c => rawCategories.includes(c));
    rawCategories.forEach(c => {
        if (!templateCategories.includes(c)) templateCategories.push(c);
    });
    if (templateCategories.length > 0) {
        businessTypes = templateCategories;
        currentTabIndex = 0;
        // 탭 UI 재생성
        createBusinessTabs();
        console.log('템플릿 카테고리 적용:', businessTypes);
    }

    const container = document.getElementById('foodCountTables');
    container.innerHTML = '';

    businessTypes.forEach((businessType, tabIndex) => {
        const tableDiv = document.createElement('div');
        tableDiv.className = 'food-count-table';
        tableDiv.id = `table-${tabIndex}`;
        tableDiv.style.display = tabIndex === currentTabIndex ? 'block' : 'none';

        // 테이블 헤더
        const header = document.createElement('div');
        header.className = 'table-header';
        header.innerHTML = `
            <span class="title"><i class="fas fa-clipboard-list"></i> ${businessType} 식수입력</span>
            <button class="add-menu-btn" onclick="addMenuSection(${tabIndex})">
                <i class="fas fa-plus"></i> 끼니 추가
            </button>
        `;
        tableDiv.appendChild(header);

        // 메뉴 섹션들
        const menuSections = document.createElement('div');
        menuSections.className = 'menu-sections';
        menuSections.id = `menu-sections-${tabIndex}`;

        // 템플릿의 메뉴 구조 사용 (없으면 기본값)
        const rawStructure = menuStructure[businessType] || [{ mealType: '중식', menus: ['메뉴1'] }];

        // 해당 사업장의 식수 데이터
        const businessMealData = mealData[businessType] || [];

        // 새 형식인지 기존 형식인지 확인
        const isNewFormat = rawStructure.length > 0 && rawStructure[0].menuName !== undefined;

        if (isNewFormat) {
            // 새 형식: [{ order, mealType, menuName, matchingName }, ...]
            // order 순서대로 정렬
            const sortedMenus = [...rawStructure].sort((a, b) => (a.order || 0) - (b.order || 0));

            // ★★★ 빈 슬롯 필터링 ★★★
            const skipNames = ['', '끼니 선택', '새 메뉴', '일반', '메뉴1'];
            let validMenus = sortedMenus.filter(menu => !skipNames.includes((menu.menuName || '').trim()));

            // ★★★ slotClientsCache 기반 필터링: 현재 날짜에 사업장이 없는 슬롯 제외 ★★★
            const categoryClients = slotClientsCache[businessType];
            if (categoryClients) {
                validMenus = validMenus.filter(menu => {
                    const slotName = (menu.menuName || '').trim();
                    const clients = categoryClients[slotName];
                    if (!clients || clients.length === 0) {
                        console.log(`🚫 템플릿 슬롯 필터링: ${businessType} > ${slotName} (현재 날짜에 사업장 없음)`);
                        return false;
                    }
                    return true;
                });
            }

            validMenus.forEach((menu, menuIndex) => {
                const section = createMenuSection(tabIndex, 0, menuIndex, menu.mealType, menu.menuName);
                // ★ menu_order 저장 (1:1 매핑용)
                section.dataset.menuOrder = menu.order ?? menuIndex;
                menuSections.appendChild(section);

                // 매칭명 설정
                const matchInput = section.querySelector('.menu-match-input');
                if (matchInput && menu.matchingName) {
                    matchInput.value = menu.matchingName;
                }

                // 해당 메뉴의 식수 데이터 적용 (order로 매칭)
                const sectionId = section.id;
                // menu_order 또는 order 필드 모두 지원
                const menuData = businessMealData.filter(d => (d.menu_order ?? d.order) === menu.order);

                if (menuData.length > 0) {
                    // ★ businessType, menuName 전달하여 slotClients 병합
                    applyMealDataToSection(section, sectionId, menuData, businessType, menu.menuName);
                }
            });
        } else {
            // 기존 형식: [{ mealType, menus: ['메뉴1', '메뉴2'] }, ...]
            // mealData에 순서 정보가 있으면 그것을 우선 사용 (순서 보장)
            if (businessMealData.length > 0) {
                // mealData에서 고유한 메뉴 목록을 순서대로 추출
                const uniqueMenus = [];
                const seenMenus = new Set();
                businessMealData.forEach(d => {
                    const key = `${d.mealType}|${d.menuName}`;
                    if (!seenMenus.has(key)) {
                        seenMenus.add(key);
                        uniqueMenus.push({ mealType: d.mealType, menuName: d.menuName, matchingName: d.matchingName || '' });
                    }
                });

                console.log('mealData 기반 메뉴 순서:', uniqueMenus);

                // ★★★ slotClientsCache 기반 필터링: 현재 날짜에 사업장이 없는 슬롯 제외 ★★★
                const categoryClients = slotClientsCache[businessType];
                const filteredMenus = categoryClients ? uniqueMenus.filter(menu => {
                    const slotName = (menu.menuName || '').trim();
                    const clients = categoryClients[slotName];
                    if (!clients || clients.length === 0) {
                        console.log(`🚫 템플릿 슬롯 필터링 (기존형식): ${businessType} > ${slotName} (현재 날짜에 사업장 없음)`);
                        return false;
                    }
                    return true;
                }) : uniqueMenus;

                // mealData 순서대로 메뉴 섹션 생성
                filteredMenus.forEach((menu, menuIndex) => {
                    const section = createMenuSection(tabIndex, 0, menuIndex, menu.mealType, menu.menuName);
                    menuSections.appendChild(section);

                    // 매칭명 설정
                    const matchInput = section.querySelector('.menu-match-input');
                    if (matchInput && menu.matchingName) {
                        matchInput.value = menu.matchingName;
                    }

                    // 해당 메뉴의 식수 데이터 적용
                    const sectionId = section.id;
                    const menuData = businessMealData.filter(d => d.menuName === menu.menuName && d.mealType === menu.mealType);

                    if (menuData.length > 0) {
                        // ★ businessType, menuName 전달하여 slotClients 병합
                        applyMealDataToSection(section, sectionId, menuData, businessType, menu.menuName);
                    }
                });
            } else {
                // mealData도 없으면 menuStructure 기준으로 생성
                // ★★★ 빈 슬롯 필터링 ★★★
                const skipNames = ['', '끼니 선택', '새 메뉴', '일반', '메뉴1'];
                const categoryClients = slotClientsCache[businessType];
                rawStructure.forEach((mealGroup, groupIndex) => {
                    if (mealGroup.menus && Array.isArray(mealGroup.menus)) {
                        let validMenus = mealGroup.menus.filter(name => !skipNames.includes((name || '').trim()));
                        // ★★★ slotClientsCache 기반 필터링 ★★★
                        if (categoryClients) {
                            validMenus = validMenus.filter(menuName => {
                                const slotName = (menuName || '').trim();
                                const clients = categoryClients[slotName];
                                if (!clients || clients.length === 0) {
                                    console.log(`🚫 템플릿 슬롯 필터링 (rawStructure): ${businessType} > ${slotName} (현재 날짜에 사업장 없음)`);
                                    return false;
                                }
                                return true;
                            });
                        }
                        validMenus.forEach((menuName, menuIndex) => {
                            const section = createMenuSection(tabIndex, groupIndex, menuIndex, mealGroup.mealType, menuName);
                            menuSections.appendChild(section);
                        });
                    }
                });
            }
        }

        tableDiv.appendChild(menuSections);
        container.appendChild(tableDiv);
    });

    // 현재 탭 다시 활성화
    switchBusinessTab(businessTypes[currentTabIndex], currentTabIndex);
    updateSummaryStats();
    updateSummaryCards();

    console.log('템플릿 적용 완료');

    // ★ 사업장 관리 동기화: slotClientsCache에서 활성 슬롯 자동 추가
    addMissingSlotsFromCache();
}

// ★★★ 새 함수: 템플릿에 없지만 slotClientsCache에 사업장이 있는 슬롯 자동 추가 ★★★
function addMissingSlotsFromCache() {
    if (!slotClientsCache || Object.keys(slotClientsCache).length === 0) {
        console.log('⚠️ slotClientsCache가 비어있어 누락 슬롯 추가 생략');
        return;
    }

    console.log('🔍 템플릿에 누락된 슬롯 확인 중...');
    console.log('  📦 slotClientsCache 내용:', JSON.stringify(slotClientsCache));

    Object.entries(slotClientsCache).forEach(([categoryName, slots]) => {
        // 해당 카테고리의 탭 인덱스 찾기
        let tabIndex = businessTypes.indexOf(categoryName);

        // ★★★ 카테고리가 없으면 동적으로 생성 ★★★
        if (tabIndex === -1) {
            console.log(`  🆕 새 카테고리 생성: ${categoryName}`);
            tabIndex = businessTypes.length;
            businessTypes.push(categoryName);

            // 탭 버튼 추가
            const tabButtons = document.getElementById('tab-buttons');
            if (tabButtons) {
                const tabBtn = document.createElement('button');
                tabBtn.className = 'tab-button';
                tabBtn.textContent = categoryName;
                tabBtn.onclick = () => switchBusinessTab(categoryName, tabIndex);
                tabButtons.appendChild(tabBtn);
            }

            // 탭 콘텐츠(테이블) 추가
            const container = document.getElementById('foodCountTables');
            if (container) {
                const table = createBusinessTable(categoryName, tabIndex);
                container.appendChild(table);
            }

            // 탭 UI 갱신
            createBusinessTabs();
        }

        let menuSections = document.getElementById(`menu-sections-${tabIndex}`);
        if (!menuSections) {
            console.log(`  ⚠️ menu-sections-${tabIndex} 요소를 찾을 수 없음, 생성 시도...`);
            // menuSections가 없으면 테이블을 다시 생성
            const container = document.getElementById('foodCountTables');
            if (container) {
                let table = document.getElementById(`table-${tabIndex}`);
                if (!table) {
                    table = createBusinessTable(categoryName, tabIndex);
                    container.appendChild(table);
                }
                menuSections = document.getElementById(`menu-sections-${tabIndex}`);
            }
            if (!menuSections) {
                console.log(`  ❌ menu-sections-${tabIndex} 생성 실패`);
                return;
            }
        }

        // 현재 템플릿에 있는 슬롯 이름들 수집
        const existingSlotNames = new Set();
        menuSections.querySelectorAll('.menu-name-select').forEach(select => {
            const slotName = select.value;
            if (slotName) existingSlotNames.add(slotName);
        });
        console.log(`  📋 ${categoryName} 기존 슬롯:`, Array.from(existingSlotNames));

        // slotClientsCache에 있지만 템플릿에 없는 슬롯 추가
        Object.entries(slots).forEach(([slotName, clients]) => {
            // ★ 빈 슬롯명 스킵
            if (!slotName || slotName.trim() === '') return;
            if (!clients || clients.length === 0) return;

            if (!existingSlotNames.has(slotName)) {
                console.log(`  ✅ 누락 슬롯 추가: ${categoryName} > ${slotName} (${clients.length}개 사업장)`);

                // ★ 끼니타입: categorySlotsCache에서 조회 (마스터 설정), 없으면 '중식'
                let mealType = '중식';
                const categoryId = categoryNameToIdMap[categoryName];
                const cachedSlots = categorySlotsCache[categoryId] || [];
                const slotData = cachedSlots.find(s => s.display_name === slotName);
                if (slotData && slotData.meal_type) {
                    mealType = slotData.meal_type;
                }

                const existingSections = menuSections.querySelectorAll('.menu-section').length;
                const section = createMenuSection(tabIndex, 0, existingSections, mealType, slotName);
                menuSections.appendChild(section);

                console.log(`    📋 ${slotName} 섹션 생성 완료 - 사업장: ${clients.join(', ')}`);
            } else {
                console.log(`  ℹ️ 슬롯 이미 존재: ${categoryName} > ${slotName}`);
            }
        });
    });

    console.log('✅ 누락 슬롯 추가 완료');
}

// 식수 데이터를 섹션에 적용하는 헬퍼 함수
// ★ slotClientsCache 병합 추가
function applyMealDataToSection(section, sectionId, menuData, businessType = null, menuName = null) {
    const grid = section.querySelector('.business-input-grid');
    if (!grid) return;

    // ★ M-6: menuData의 사업장 + slotClientsCache의 사업장 병합 (전역 normalizeString 사용)
    const mergedBusinesses = menuData.map(d => ({ name: normalizeString(d.siteName), count: d.mealCount || '' }));
    const existingNames = new Set(mergedBusinesses.map(b => normalizeString(b.name)));

    // businessType, menuName이 있으면 slotClientsCache에서 추가
    if (businessType && menuName && slotClientsCache[businessType]?.[menuName]) {
        const slotClientsList = slotClientsCache[businessType][menuName];
        slotClientsList.forEach(clientName => {
            const normalizedName = normalizeString(clientName);
            if (normalizedName && !existingNames.has(normalizedName)) {
                mergedBusinesses.push({ name: normalizedName, count: '' });
                existingNames.add(normalizedName);
            }
        });
    }

    grid.innerHTML = '';
    mergedBusinesses.forEach((business, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'business-input-item';
        itemDiv.id = `${sectionId}-item-${idx}`;
        itemDiv.innerHTML = `
            <div class="business-input-label">사업장명</div>
            <input type="text" class="business-name-input" placeholder="사업장명" value="${business.name || ''}"
                   readonly style="background: #f5f5f5; cursor: not-allowed;"
                   title="사업장명은 Admin에서만 수정 가능합니다">
            <div class="business-input-label">식수</div>
            <input type="number" class="business-count-input" placeholder="0" min="0" value="${business.count || ''}"
                   onchange="updateSectionTotal('${sectionId}')" oninput="updateSectionTotal('${sectionId}')">
            <div class="business-item-actions">
                <button class="business-item-remove" onclick="removeBusinessItem('${itemDiv.id}', '${sectionId}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        grid.appendChild(itemDiv);
    });
    // 합계 업데이트
    setTimeout(() => updateSectionTotal(sectionId), 0);
}

// 템플릿 수정 (유효기간 연장 등)
function editMealTemplate() {
    const select = document.getElementById('mealTemplateSelect');
    const templateId = select.value;
    if (!templateId) {
        alert('수정할 템플릿을 선택해주세요.');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        alert('템플릿을 찾을 수 없습니다.');
        return;
    }

    // 수정 모드로 설정
    editingTemplateId = templateId;

    // 모달에 기존 데이터 채우기
    document.getElementById('templateName').value = template.template_name || '';
    document.getElementById('templateDescription').value = template.description || '';

    // 현재 날짜의 요일 타입을 기본 선택
    const workDate = document.getElementById('meal-count-date').value;
    const currentDayType = getDayTypeFromDate(workDate);
    selectDayType(currentDayType);

    // 저장된 요일타입 표시
    updateExistingDayTypesDisplay(template);

    // 모달 표시
    document.getElementById('templateSaveModal').style.display = 'flex';
}

async function deleteMealTemplate() {
    const select = document.getElementById('mealTemplateSelect');
    const templateId = select.value;
    if (!templateId) {
        alert('삭제할 템플릿을 선택해주세요.');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!confirm(`"${template?.template_name}" 템플릿을 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/meal-templates/${templateId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            alert('✅ 템플릿이 삭제되었습니다.');
            loadMealTemplates();
        } else {
            alert('❌ 삭제 실패: ' + result.error);
        }
    } catch (e) {
        console.error('템플릿 삭제 오류:', e);
        alert('❌ 삭제 중 오류가 발생했습니다.');
    }
}

// ========================
// 템플릿 캘린더 (날짜별 템플릿 지정)
// ========================
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let templateScheduleData = {};  // { 'YYYY-MM-DD': { template_id, day_type, template_name } }

function openTemplateCalendar() {
    document.getElementById('templateCalendarModal').style.display = 'flex';
    // 템플릿 목록 로드
    updateCalendarTemplateSelect();
    // 캘린더 렌더링
    renderCalendar();
}

function closeTemplateCalendar() {
    document.getElementById('templateCalendarModal').style.display = 'none';
}

function updateCalendarTemplateSelect() {
    const select = document.getElementById('calendarTemplateSelect');
    select.innerHTML = '<option value="">-- 선택 --</option>';
    mealTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.template_name;
        select.appendChild(option);
    });
}

function changeCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    } else if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    }
    renderCalendar();
}

async function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const titleEl = document.getElementById('calendarMonthTitle');

    titleEl.textContent = `${calendarYear}년 ${calendarMonth + 1}월`;

    // 스케줄 데이터 로드
    const startDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const endDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${lastDay}`;

    try {
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `&site_id=${siteId}` : '';
        const response = await fetch(`/api/template-schedule?start_date=${startDate}&end_date=${endDate}${siteParam}`);
        const result = await response.json();
        if (result.success) {
            templateScheduleData = {};
            result.schedules.forEach(s => {
                templateScheduleData[s.schedule_date] = s;
            });
        }
    } catch (e) {
        console.error('스케줄 로드 오류:', e);
    }

    // 요일 헤더
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    let html = dayNames.map((d, i) => {
        const cls = i === 0 ? 'sun' : (i === 6 ? 'sat' : '');
        return `<div class="calendar-header ${cls}">${d}</div>`;
    }).join('');

    // 첫날의 요일
    const firstDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();

    // 빈 셀
    for (let i = 0; i < firstDayOfWeek; i++) {
        html += '<div class="calendar-day" style="background:#f5f5f5; cursor:default;"></div>';
    }

    // 날짜 셀
    for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const schedule = templateScheduleData[dateStr];
        const dayOfWeek = new Date(calendarYear, calendarMonth, day).getDay();

        let dayTypeClass = '';
        let badgeHtml = '';

        if (schedule) {
            dayTypeClass = schedule.day_type;
            const dayTypeLabels = { weekday: '평일', saturday: '토', sunday: '일', holiday: '휴일' };
            badgeHtml = `<div class="day-type-badge">${dayTypeLabels[schedule.day_type] || schedule.day_type}</div>`;
        }

        const sunClass = dayOfWeek === 0 ? 'color:#e74c3c;' : (dayOfWeek === 6 ? 'color:#4a90d9;' : '');

        html += `
            <div class="calendar-day ${dayTypeClass} ${schedule ? 'assigned' : ''}"
                 onclick="assignTemplateToDate('${dateStr}')"
                 title="${schedule ? schedule.template_name : '클릭하여 템플릿 지정'}">
                <div class="day-number" style="${sunClass}">${day}</div>
                ${badgeHtml}
            </div>
        `;
    }

    grid.innerHTML = html;
}

async function assignTemplateToDate(dateStr) {
    const templateId = document.getElementById('calendarTemplateSelect').value;
    const dayType = document.getElementById('calendarDayType').value;

    if (!templateId) {
        alert('먼저 적용할 템플릿을 선택해주세요.');
        return;
    }

    try {
        const siteId = getCurrentSiteId();
        const response = await fetch('/api/template-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                schedule_date: dateStr,
                template_id: parseInt(templateId),
                day_type: dayType,
                site_id: siteId
            })
        });
        const result = await response.json();
        if (result.success) {
            renderCalendar();  // 캘린더 새로고침
        } else {
            alert('❌ 저장 실패: ' + result.error);
        }
    } catch (e) {
        console.error('템플릿 지정 오류:', e);
        alert('❌ 저장 중 오류가 발생했습니다.');
    }
}

async function bulkAssignWeekdays() {
    await bulkAssignByDayType([1, 2, 3, 4, 5], 'weekday');
}

async function bulkAssignSaturdays() {
    await bulkAssignByDayType([6], 'saturday');
}

async function bulkAssignSundays() {
    await bulkAssignByDayType([0], 'sunday');
}

async function bulkAssignByDayType(targetDaysOfWeek, dayType) {
    const templateId = document.getElementById('calendarTemplateSelect').value;
    if (!templateId) {
        alert('먼저 적용할 템플릿을 선택해주세요.');
        return;
    }

    const lastDay = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const dates = [];

    for (let day = 1; day <= lastDay; day++) {
        const date = new Date(calendarYear, calendarMonth, day);
        if (targetDaysOfWeek.includes(date.getDay())) {
            dates.push(`${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
    }

    if (dates.length === 0) {
        alert('해당하는 날짜가 없습니다.');
        return;
    }

    const dayTypeLabels = { weekday: '평일', saturday: '토요일', sunday: '일요일', holiday: '공휴일' };
    if (!confirm(`${dates.length}개 ${dayTypeLabels[dayType]}에 템플릿을 지정하시겠습니까?`)) {
        return;
    }

    try {
        const siteId = getCurrentSiteId();
        const response = await fetch('/api/template-schedule/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dates: dates,
                template_id: parseInt(templateId),
                day_type: dayType,
                site_id: siteId
            })
        });
        const result = await response.json();
        if (result.success) {
            alert(`✅ ${result.message}`);
            renderCalendar();
        } else {
            alert('❌ 저장 실패: ' + result.error);
        }
    } catch (e) {
        console.error('일괄 저장 오류:', e);
        alert('❌ 저장 중 오류가 발생했습니다.');
    }
}

// ========================
// 페이지 초기화
// ========================
document.addEventListener('DOMContentLoaded', async function () {
    // ★ 그룹에 따른 페이지 타이틀 업데이트는 siteChange 이벤트에서 처리
    // (SiteSelector가 초기화된 후에 실행됨)

    // ★ 기본 그룹 정보 로드 (SiteSelector 실패 시 폴백용 - 즉시 실행)
    try {
        const grpRes = await fetch('/api/v2/groups');
        const grpData = await grpRes.json();
        if (grpData.success && grpData.data && grpData.data.length > 0) {
            window._defaultGroupId = grpData.data[0].id;
            window._defaultGroupName = grpData.data[0].group_name;
            console.log(`🏢 기본 그룹 로드: id=${window._defaultGroupId}, name=${window._defaultGroupName}`);
        }
    } catch(e) { console.warn('기본 그룹 로드 실패:', e); }

    updateDateTime();
    setInterval(updateDateTime, 60000);

    // 내일 날짜로 초기화 (식수 관리는 보통 익일 기준)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = getLocalDateString(tomorrow);
    document.getElementById('meal-count-date').value = defaultDate;
    document.getElementById('form-meal-date').value = defaultDate;

    // 날짜 변경시 데이터 새로고침 (로딩 표시 포함)
    document.getElementById('meal-count-date').addEventListener('change', async function () {
        showLoading('날짜 데이터 로딩 중...');
        try {
            await loadFoodCountData();
        } finally {
            hideLoading();
        }
    });

    // 페이지 이탈 시 저장 확인 (비활성화됨 - 사용자 요청)
    // window.addEventListener('beforeunload', function (e) {
    //     if (isDirty) {
    //         const message = '저장되지 않은 변경사항이 있습니다. 페이지를 떠나시겠습니까?';
    //         e.returnValue = message;
    //         return message;
    //     }
    // });

    // 초기 로드는 initializePage에서 처리됨
    console.log('🚀 식수 등록 관리 시스템 이벤트 등록 완료!');
});

// ★ 데이터 변경 감지 함수
function markDirty() {
    if (!isDirty) {
        isDirty = true;
        console.log('📝 변경사항 감지됨 - 저장 필요');
    }
}

function clearDirty() {
    isDirty = false;
    console.log('✅ 변경사항 저장됨');
}

// ========================
// 사업장 선택기 초기화
// ========================
// 🏢 현재 선택된 사업장 ID 가져오기
function getCurrentSiteId() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        if (context?.site_id) return context.site_id;
    }
    return window._defaultGroupId || null;
}

function getCurrentSiteName() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        return context?.site_name || context?.group_name || '미선택';
    }
    return '미선택';
}

// 사업장 선택기 초기화
document.addEventListener('DOMContentLoaded', function () {
    if (typeof SiteSelector !== 'undefined') {
        SiteSelector.init('meal-count-site-selector');
        SiteSelector.on('siteChange', async function (context) {
            console.log('🏢 사업장 변경:', context);

            // ★ 그룹에 따른 페이지 타이틀 업데이트
            const groupId = context.group_id || 1;
            const groupName = groupId === 1 ? '본사' : groupId === 2 ? '영남지사' : `그룹${groupId}`;
            const titleEl = document.getElementById('pageTitle');
            if (titleEl) {
                titleEl.textContent = groupId !== 1 ? `👥 식수 등록 관리 (${groupName})` : '👥 식수 등록 관리';
            }
            document.title = groupId !== 1 ? `식수 등록 관리 (${groupName}) - 급식관리 시스템` : '식수 등록 관리 - 급식관리 시스템';
            console.log(`🏢 그룹 변경: ${groupName} (group_id=${groupId})`);

            // ★ 현재 사업장 배지 업데이트
            const badge = document.getElementById('current-site-badge');
            const nameSpan = document.getElementById('current-site-name');
            if (badge && nameSpan) {
                const siteName = context.site_name || context.group_name || '미선택';
                nameSpan.textContent = siteName;
                badge.style.display = 'block';
                // 본사/영남지사에 따라 색상 변경
                if (siteName.includes('영남')) {
                    badge.style.background = '#e91e63';  // 핑크 (영남)
                } else if (siteName.includes('본사')) {
                    badge.style.background = '#2196f3';  // 파랑 (본사)
                } else {
                    badge.style.background = '#ff9800';  // 주황 (기타)
                }
            }

            // 로딩 표시
            showLoading('사업장 데이터 로딩 중...');

            try {
                // ★★★ 상태 완전 리셋 (이전 데이터 오염 방지) ★★★
                resetPageState();

                // 모든 사업장에서 탭 없이 시작 (필요시 +카테고리 추가)
                // 끼니 옵션은 모든 유형 포함
                currentMealTypes = ['조식', '중식', '석식', '야식', '행사'];
                currentMealItems = ['일반'];
                businessTypes = [];  // 탭 항상 비움
                console.log('✅ 사업장 변경 - 탭 초기화 (빈 상태)');

                // 카테고리 정보 저장
                currentCategoryName = context.category_name || context.site_name || '전체';
                currentCategoryId = context.category_id || null;
                const currentSiteId = context.site_id || null;
                currentTabIndex = 0;

                console.log(`🏢 siteChange: category_id=${currentCategoryId}, site_id=${currentSiteId}`);

                // 카테고리 매핑 로드 (현재 그룹 기준)
                const groupId = context.group_id || null;
                await loadCategoryNameMapping(groupId);

                // 메뉴 구조 재구성 (카테고리 기반)
                defaultMenuStructure = buildMenuStructureFromCategory(currentMealTypes, currentMealItems);

                // 탭 재생성 (빠름)
                createBusinessTabs();
                createFoodCountTables();

                // ★ 초기 자동 로드 방지 - 사용자가 조회 버튼 클릭 시에만 로드
                if (_skipInitialLoad) {
                    _skipInitialLoad = false;
                    console.log('🚫 초기 자동 로드 건너뜀 - 조회 버튼 클릭 시 로드');
                    hideLoading();
                    return;
                }

                // 통합 API로 한 번에 로드 (성능 최적화)
                await loadInitData();
                _dataLoaded = true; // 중복 로드 방지

                // ★ 드롭다운 업데이트 (슬롯은 통합 API에서 이미 캐시됨)
                if (businessTypes.length > 0) {
                    businessTypes.forEach((_, i) => updateTabSlotDropdowns(i));
                }

                console.log(`🏢 ${currentCategoryName} 데이터 로드 완료`);

                // ★ 사업장 변경 시 템플릿 목록 및 선택 업데이트
                await loadMealTemplates();

                // 🚀 백그라운드에서 다른 사업장 프리페치 (지연)
                setTimeout(() => prefetchFrequentSites(), 2000);
            } catch (e) {
                console.error('사업장 전환 오류:', e);
            } finally {
                hideLoading();
            }
        });
    }

    // 페이지 로드 시 초기 탭 및 테이블 생성
    initializePage();
});

// 페이지 초기화 함수 (UI만 초기화, 데이터 로드는 siteChange에서 처리)
let _dataLoaded = false; // 중복 로드 방지 플래그
let _skipInitialLoad = true; // ★ 초기 자동 로드 방지 (사용자가 조회 버튼 클릭 시에만 로드)

async function initializePage() {
    // 초기 상태: 카테고리(탭) 없음
    businessTypes = [];
    defaultMenuStructure = buildMenuStructureFromCategory(currentMealTypes, currentMealItems);
    // UI만 생성 (데이터 로드 안함)
    createBusinessTabs();
    createFoodCountTables();
    console.log('✅ 페이지 UI 초기화 완료');

    // ★ 딜레이 없이 즉시 로드 (siteChange 이벤트 대기 최소화)
    requestAnimationFrame(async () => {
        if (!_dataLoaded) {
            console.log('📦 초기 데이터 로드 시작 (최적화)');
            showLoading('데이터 로딩 중...');
            try {
                // ★ _defaultGroupId가 없으면 직접 확보
                if (!window._defaultGroupId) {
                    try {
                        const grpRes = await fetch('/api/v2/groups');
                        const grpData = await grpRes.json();
                        if (grpData.success && grpData.data?.length > 0) {
                            window._defaultGroupId = grpData.data[0].id;
                            window._defaultGroupName = grpData.data[0].group_name;
                            console.log(`🏢 그룹 ID 확보: ${window._defaultGroupId}`);
                        }
                    } catch(e) {}
                }

                const siteId = getCurrentSiteId();
                console.log(`🏢 초기 로드: site_id=${siteId}, groupId=${getCurrentGroupId()}`);

                // ★ 카테고리 매핑 로드 (슬롯은 통합 API에서 받음)
                await loadCategoryNameMapping(getCurrentGroupId());

                // 통합 API로 모든 데이터 로드 (식수 + 템플릿 + 슬롯)
                await loadInitData();
                _dataLoaded = true;

                // ★ 드롭다운 업데이트 (슬롯은 통합 API에서 이미 캐시됨)
                if (businessTypes.length > 0) {
                    businessTypes.forEach((_, i) => updateTabSlotDropdowns(i));
                }

                updateSiteBadge();

                // 🚀 백그라운드 프리페치 (지연 시작)
                setTimeout(() => prefetchFrequentSites(), 2000);
            } finally {
                hideLoading();
            }
        }
    });
}

// ★ 사업장 배지 업데이트 함수
function updateSiteBadge() {
    const badge = document.getElementById('current-site-badge');
    const nameSpan = document.getElementById('current-site-name');
    if (badge && nameSpan) {
        const siteName = getCurrentSiteName();
        nameSpan.textContent = siteName;
        badge.style.display = 'block';
        // 본사/영남지사에 따라 색상 변경
        if (siteName.includes('영남')) {
            badge.style.background = '#e91e63';  // 핑크 (영남)
        } else if (siteName.includes('본사')) {
            badge.style.background = '#2196f3';  // 파랑 (본사)
        } else {
            badge.style.background = '#4caf50';  // 녹색 (기타)
        }
    }
}

// ========================
// 브랜딩 적용
// ========================
document.addEventListener('DOMContentLoaded', function () {
    // 브랜딩 시스템 적용
    if (typeof BrandingManager !== 'undefined') {
        BrandingManager.applyBranding('식수 관리');
        console.log('✅ 브랜딩 시스템 적용 완료 (식수 관리)');
    }
});
