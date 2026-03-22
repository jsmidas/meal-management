/**
 * 스마트 식단관리 시스템 모듈
 * meal_plan_advanced.html의 핵심 JavaScript 로직
 *
 * 기능:
 * - 캘린더 기반 식단 관리
 * - 메뉴 라이브러리 연동
 * - 식단 복사 (일별/주간/월간/기간별)
 * - 슬롯/템플릿 설정
 */

// 🏗️ 모듈 초기화 및 상태 관리
// 전역 변수들은 AppState로 중앙화됨
let selectedDate = null; // 임시 UI 상태만 유지
let currentView = 'month'; // 현재 캘린더 뷰 (month/week/day)
let currentDate = new Date(); // 현재 표시 중인 날짜

// 📅 날짜별 적용된 템플릿 ID 저장 (예: { '2024-12-29': 5 })
let dateTemplateMap = {};

// 🏷️ 현재 선택된 식단 카테고리 (전체/도시락/운반/학교/요양원)
let currentMealCategory = '전체';

// 🏷️ 모달에서 선택된 카테고리 (캘린더 카테고리와 별도로 관리)
let modalSelectedCategory = '도시락';

// 📊 식수 데이터 캐시 (날짜별로 저장)
let mealCountsCache = {};

// ★ 낙관적 잠금용 타임스탬프 저장 (date -> slot -> updated_at)
let mealTimestamps = {};

// ★ 메뉴 Map 캐시 (allMenus.find() O(n) → Map.get() O(1) 최적화)
let _menuMapCache = new Map();
function updateMenuMapCache(menus) {
    AppState.set('allMenus', menus);
    _menuMapCache = new Map();
    if (menus && menus.length) {
        menus.forEach(m => _menuMapCache.set(m.id, m));
    }
}
function getMenuById(menuId) {
    return _menuMapCache.get(Number(menuId)) || _menuMapCache.get(menuId) || null;
}

// 🗓️ 로컬 시간 기준 날짜 포맷 (toISOString은 UTC 기준이라 하루 차이 발생 방지)
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 🔧 슬롯명 정규화 - 목표식재료비 접미사 제거 (예: "중 주간_1,650" → "중 주간")
function normalizeSlotName(menuName) {
    if (!menuName) return '';
    // "_숫자" 또는 "_숫자,숫자" 패턴 제거 (예: _1650, _1,650, _2760)
    return menuName.replace(/_[\d,]+$/, '').trim();
}

// ★ 메뉴명에서 접두사/접미사 분리 및 색상 적용 HTML 생성
// 알려진 접두사: 본사, 영남, 본, 영
// 알려진 접미사: 도, 운, 학, 요, 유, 초, 중, 고, 유,도, 어
const KNOWN_PREFIXES = ['본사', '영남', '본', '영'];
const KNOWN_SUFFIXES = ['도', '운', '학', '요', '유', '초', '중', '고', '유,도', '어'];

function formatMenuNameWithColors(menuName, returnPlainText = false) {
    if (!menuName) return returnPlainText ? '' : '';

    const parts = menuName.split('-');
    const systemColor = '#0066cc';  // 시스템 값: 파란색
    const userColor = '#333333';    // 사용자 입력: 진한 회색

    if (parts.length === 1) {
        // 구분자 없음 - 그냥 메뉴명
        return returnPlainText ? menuName : `<span style="color: ${userColor}">${menuName}</span>`;
    }

    let prefix = '';
    let baseName = '';
    let suffix = '';

    if (parts.length === 2) {
        // "영남-백미밥" 또는 "백미밥-도"
        if (KNOWN_PREFIXES.includes(parts[0])) {
            prefix = parts[0];
            baseName = parts[1];
        } else if (KNOWN_SUFFIXES.includes(parts[1])) {
            baseName = parts[0];
            suffix = parts[1];
        } else {
            // 둘 다 아니면 전체를 baseName으로
            baseName = menuName;
        }
    } else if (parts.length >= 3) {
        // "영남-백미밥-도" 또는 그 이상
        if (KNOWN_PREFIXES.includes(parts[0])) {
            prefix = parts[0];
            if (KNOWN_SUFFIXES.includes(parts[parts.length - 1])) {
                suffix = parts[parts.length - 1];
                baseName = parts.slice(1, -1).join('-');
            } else {
                baseName = parts.slice(1).join('-');
            }
        } else if (KNOWN_SUFFIXES.includes(parts[parts.length - 1])) {
            suffix = parts[parts.length - 1];
            baseName = parts.slice(0, -1).join('-');
        } else {
            baseName = menuName;
        }
    }

    if (returnPlainText) {
        return menuName;
    }

    // HTML 생성
    let html = '';
    if (prefix) {
        html += `<span style="color: ${systemColor}; font-weight: 600">${prefix}</span>-`;
    }
    html += `<span style="color: ${userColor}">${baseName || menuName}</span>`;
    if (suffix) {
        html += `-<span style="color: ${systemColor}; font-weight: 600">${suffix}</span>`;
    }

    return html;
}

// 📅 과거 날짜인지 확인 (읽기전용 제한 해제됨 - 항상 false 반환)
function isPastDate(dateKey) {
    // const today = formatLocalDate(new Date());
    // return dateKey < today;
    return false;  // 과거 날짜도 편집 가능
}

// 🔒 모달 읽기전용 상태
let isModalReadOnly = false;

// 🌐 PostgreSQL/서버 에러 메시지를 한글로 변환
function translateErrorMessage(errorMsg) {
    if (!errorMsg) return '알 수 없는 오류가 발생했습니다.';

    const errorTranslations = {
        'duplicate key value violates unique constraint': '이미 같은 날짜/시간대에 식단이 존재합니다',
        'already exists': '이미 존재하는 데이터입니다',
        'connection refused': '서버 연결에 실패했습니다',
        'timeout': '서버 응답 시간이 초과되었습니다',
        'network error': '네트워크 오류가 발생했습니다',
        'not found': '데이터를 찾을 수 없습니다',
        'permission denied': '권한이 없습니다',
        'invalid input': '잘못된 입력값입니다',
        'plan_date 필수': '날짜를 선택해주세요',
        'violates foreign key constraint': '참조 데이터가 존재하지 않습니다',
        'null value in column': '필수 항목이 누락되었습니다'
    };

    for (const [engPattern, korMessage] of Object.entries(errorTranslations)) {
        if (errorMsg.toLowerCase().includes(engPattern.toLowerCase())) {
            return korMessage;
        }
    }

    return errorMsg;
}

// 🍽️ 기본 20개 식단 슬롯 정의
const mealSlots = [
    '조식A', '조식B', '조식C', '조식D',
    '중식A', '중식B', '중식C', '중식D', '중식E',
    '석식A', '석식B', '석식C', '석식D',
    '간식A', '간식B', '간식C',
    '특식A', '특식B', '특식C', '특식D'
];

// 🍽️ 표시할 슬롯 개수는 AppState에서 관리됨
// let visibleSlotCount = 3; → AppState.get('visibleSlotCount')

// 🚀 모듈 시스템은 메인 초기화에서 처리됨

// 📊 샘플 메뉴 데이터 (가격 변동 포함)
const sampleMenus = [
    {
        id: 1,
        name: '김치찌개',
        category: '국',
        currentPrice: 3100,
        previousPrice: 2800,
        ingredients: ['돼지고기', '김치', '두부', '대파'],
        trend: 'up',
        changePercent: 10.7,
        changeReason: '돼지고기 가격상승'
    },
    {
        id: 2,
        name: '된장찌개',
        category: '국',
        currentPrice: 2800,
        previousPrice: 2800,
        ingredients: ['된장', '두부', '호박', '양파'],
        trend: 'stable',
        changePercent: 0,
        changeReason: '가격 변동없음'
    },
    {
        id: 3,
        name: '제육볶음',
        category: '주찬',
        currentPrice: 4200,
        previousPrice: 4500,
        ingredients: ['돼지고기', '양파', '고추장', '마늘'],
        trend: 'down',
        changePercent: -6.7,
        changeReason: '양파 가격하락'
    },
    {
        id: 4,
        name: '불고기',
        category: '주찬',
        currentPrice: 5500,
        previousPrice: 5000,
        ingredients: ['소고기', '양파', '당근', '간장'],
        trend: 'up',
        changePercent: 10.0,
        changeReason: '소고기 가격상승'
    },
    {
        id: 5,
        name: '계란말이',
        category: '부찬',
        currentPrice: 2200,
        previousPrice: 2000,
        ingredients: ['계란', '당근', '파', '소금'],
        trend: 'up',
        changePercent: 10.0,
        changeReason: '계란 가격상승'
    },
    {
        id: 6,
        name: '시금치나물',
        category: '부찬',
        currentPrice: 1500,
        previousPrice: 1600,
        ingredients: ['시금치', '마늘', '참기름', '깨'],
        trend: 'down',
        changePercent: -6.3,
        changeReason: '시금치 공급 증가'
    },
    {
        id: 7,
        name: '배추김치',
        category: '김치',
        currentPrice: 1200,
        previousPrice: 1000,
        ingredients: ['배추', '고춧가루', '마늘', '젓갈'],
        trend: 'up',
        changePercent: 20.0,
        changeReason: '배추 가격급등'
    },
    {
        id: 8,
        name: '쌀밥',
        category: '밥',
        currentPrice: 800,
        previousPrice: 850,
        ingredients: ['쌀'],
        trend: 'down',
        changePercent: -5.9,
        changeReason: '쌀 수급 안정'
    }
];

// 🚀 페이지 초기화
document.addEventListener('DOMContentLoaded', async function () {
    console.log('🍽️ 스마트 식단관리 시스템 v2.0 초기화');

    // 🚀 Phase 1: 즉시 UI 표시 (API 대기 없이)
    if (typeof AppState !== 'undefined') {
        AppState.init();
        updateMenuMapCache( sampleMenus);
    }
    if (typeof ApiManager !== 'undefined') ApiManager.init();
    if (typeof UIManager !== 'undefined') UIManager.init();

    // 이벤트 리스너만 설정 (캘린더는 데이터 로드 후 1회만 렌더링)
    setupEventListeners();

    // 🚀 Phase 2: 백그라운드에서 데이터 로드 (비차단)
    setTimeout(async () => {
        try {
            // 브랜딩 적용
            if (typeof BrandingManager !== 'undefined') {
                BrandingManager.applyBranding('스마트 식단관리 v2.0');
            }

            // 사업장 선택기 초기화
            if (typeof SiteSelector !== 'undefined') {
                SiteSelector.init('meal-plan-site-selector');
                SiteSelector.on('siteChange', async function (context) {
                    console.log('🏢 사업장 변경:', context);
                    showLoadingOverlay('사업장 데이터 로드 중...');
                    try {
                        // ★ 사업장 변경 시 캐시 초기화
                        mealCountsCache = {};
                        mealTimestamps = {};  // ★ 타임스탬프도 초기화
                        console.log('🗑️ 식수/타임스탬프 캐시 초기화');

                        // 🏷️ 사업장의 카테고리로 기본 카테고리 자동 설정
                        const siteCategory = context.categoryName || context.category_name || '도시락';
                        if (siteCategory && siteCategory !== currentMealCategory) {
                            console.log(`🏷️ 사업장 카테고리 자동 설정: ${siteCategory}`);
                            selectMealCategory(siteCategory);
                            modalSelectedCategory = siteCategory;
                        }

                        await Promise.all([
                            loadMealPlansFromServer(),
                            loadSlotAndTemplateSettings(),
                            preloadMealCounts(),  // ★ 사업장 변경 시 식수 데이터도 다시 로드
                            loadRealMenuData()  // ★ 사업장별 발주불가 협력업체 체크를 위해 메뉴도 다시 로드
                        ]);
                        syncMealData();
                        generateCalendar();
                        updateStatistics();
                        renderMenuLibrary();  // 메뉴 라이브러리 UI 갱신
                        showNotification(`${context.siteName || '전체'} 사업장으로 변경되었습니다.`, 'success');
                    } catch (error) {
                        console.error('사업장 데이터 로드 실패:', error);
                    } finally {
                        hideLoadingOverlay();
                    }
                });
            }

            // 실제 데이터 로드 (병렬)
            await initializeData();
            syncMealData();
            generateCalendar();
            updateStatistics();

            // 메뉴 라이브러리는 지연 로드
            requestAnimationFrame(() => {
                renderMenuLibrary();
            });

            console.log('✅ 초기화 완료');
        } catch (error) {
            console.error('❌ 데이터 로드 실패:', error);
        }
    }, 0);
});

// 📊 데이터 초기화 (AppState 사용)
async function initializeData() {
    // 📅 날짜별 템플릿 매핑 로드 (로컬스토리지)
    loadDateTemplateMap();

    // 🏷️ 현재 사업장의 카테고리로 기본 카테고리 설정
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        if (context) {
            const siteCategory = context.categoryName || context.category_name;
            if (siteCategory) {
                console.log(`🏷️ 초기 사업장 카테고리: ${siteCategory}`);
                currentMealCategory = siteCategory;
                modalSelectedCategory = siteCategory;
                // UI 탭 업데이트
                const tabs = document.querySelectorAll('.meal-category-tab');
                tabs.forEach(tab => {
                    if (tab.dataset.category === siteCategory) {
                        tab.classList.add('active');
                    } else {
                        tab.classList.remove('active');
                    }
                });
            }
        }
    }

    // 🚀 병렬로 모든 데이터 로드 (성능 최적화)
    const [menuLoaded, mealPlanLoaded, settingsLoaded] = await Promise.all([
        loadRealMenuData(),
        loadMealPlansFromServer(),
        loadSlotAndTemplateSettings(),
        preloadMealCounts()  // 🍽️ 식수 데이터도 미리 로드
    ]);

    let allMenus = AppState.get('allMenus') || [];

    if (menuLoaded && allMenus.length > 0) {
        console.log('✅ 실제 메뉴 데이터 로드 완료:', allMenus.length, '개');
    } else {
        console.log('⚠️ 등록된 메뉴가 없습니다. 샘플 데이터를 사용합니다.');
        updateMenuMapCache( [...sampleMenus]);
    }

    console.log('✅ 모든 데이터 병렬 로드 완료');
}

// 🏢 현재 선택된 사업장 ID 가져오기
function getCurrentSiteId() {
    if (typeof SiteSelector !== 'undefined') {
        const context = SiteSelector.getCurrentContext();
        return context?.site_id || null;
    }
    if (typeof AppState !== 'undefined') {
        return AppState.getCurrentSiteId?.() || null;
    }
    return null;
}

// 📊 서버에서 식수 데이터 불러오기 (특정 날짜)
// 🔧 버그 수정 (2025-12-24): preloadMealCounts와 동일한 구조 사용
async function loadMealCountsForDate(dateKey, forceReload = false) {
    try {
        // 캐시에 있고, _byCategory 구조가 있으면 반환 (강제 리로드 아닌 경우)
        if (!forceReload && mealCountsCache[dateKey] && mealCountsCache[dateKey]._byCategory) {
            console.log(`[식수] ${dateKey} 캐시 사용 (_byCategory 구조):`, Object.keys(mealCountsCache[dateKey]._byCategory));
            return mealCountsCache[dateKey];
        }

        // ★ site_id로 필터링 추가
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `?site_id=${siteId}` : '';
        const url = `/api/meal-counts/${dateKey}${siteParam}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.data) {
            // 🔧 preloadMealCounts와 동일한 구조로 저장
            // 구조: { _all: { menuName: { count, mealType, menuOrder } }, _byCategory: { category: { menuName: {...} } } }
            // ★ 버그 수정: forceReload일 때는 무조건 캐시 초기화 (합산 방지)
            if (forceReload || !mealCountsCache[dateKey] || !mealCountsCache[dateKey]._byCategory) {
                mealCountsCache[dateKey] = { _all: {}, _byCategory: {} };
            }

            result.data.forEach(item => {
                // 🔧 슬롯명 정규화 - "_1,650" 같은 목표식재료비 접미사 제거
                const rawMenuName = item.menu_name || item.matching_name || '';
                const menuName = normalizeSlotName(rawMenuName);
                const businessType = item.business_type || '기타';
                const mealType = item.meal_type || '';
                const menuOrder = item.menu_order || 0;

                if (!mealCountsCache[dateKey]._byCategory[businessType]) {
                    mealCountsCache[dateKey]._byCategory[businessType] = {};
                }

                if (menuName) {
                    // 전체 합계
                    if (!mealCountsCache[dateKey]._all[menuName]) {
                        mealCountsCache[dateKey]._all[menuName] = { count: 0, mealType, menuOrder, category: businessType };
                    }
                    mealCountsCache[dateKey]._all[menuName].count += (item.meal_count || 0);

                    // 카테고리별 합계
                    if (!mealCountsCache[dateKey]._byCategory[businessType][menuName]) {
                        mealCountsCache[dateKey]._byCategory[businessType][menuName] = { count: 0, mealType, menuOrder, category: businessType };
                    }
                    mealCountsCache[dateKey]._byCategory[businessType][menuName].count += (item.meal_count || 0);
                }
            });

            console.log(`[식수] ${dateKey} 서버에서 로드 (_byCategory 구조):`, Object.keys(mealCountsCache[dateKey]._byCategory));
            return mealCountsCache[dateKey];
        }
    } catch (e) {
        console.error(`식수 로드 실패 (${dateKey}):`, e);
    }
    return { _all: {}, _byCategory: {} };
}

// 📊 현재 월의 식수 데이터 미리 로드
// 🍽️ 끼니 타입 정렬 순서 (조식→중식→석식→간식→야식)
const MEAL_TYPE_ORDER = { '조식': 1, '중식': 2, '석식': 3, '간식': 4, '야식': 5 };

// 🏷️ 카테고리 정렬 순서 (도시락→운반→학교→요양원)
const CATEGORY_ORDER = { '도시락': 1, '운반': 2, '학교': 3, '요양원': 4, '기타': 5 };

async function preloadMealCounts() {
    const currentDate = AppState.get('currentDate');
    if (!currentDate) {
        console.warn('[식수] currentDate가 없음, 기본값 사용');
    }
    const date = currentDate || new Date();
    const year = date.getFullYear();
    const month = date.getMonth();

    // 현재 월의 첫날과 마지막날
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 날짜 범위 API로 한번에 가져오기
    try {
        // 로컬 시간 기준 날짜 포맷 (toISOString은 UTC 기준이라 하루 차이 발생)
        const startDate = formatLocalDate(firstDay);
        const endDate = formatLocalDate(lastDay);
        // ★ site_id로 필터링 추가
        const siteId = getCurrentSiteId();
        const siteParam = siteId ? `&site_id=${siteId}` : '';
        const url = `/api/meal-counts/range?start_date=${startDate}&end_date=${endDate}${siteParam}`;

        console.log(`[식수] API 호출: ${url}`);
        const response = await fetch(url);
        const result = await response.json();
        console.log(`[식수] API 응답: success=${result.success}, count=${result.data?.length || 0}`);

        if (result.success && result.data) {
            // 날짜별 + 카테고리별 + 메뉴별로 그룹화
            // 구조: { _all: { menuName: { count, mealType, menuOrder } }, _byCategory: { category: { menuName: { count, mealType, menuOrder } } } }
            result.data.forEach(item => {
                const dateKey = item.work_date;
                // 🔧 슬롯명 정규화 - "_1,650" 같은 목표식재료비 접미사 제거
                const rawMenuName = item.menu_name || item.matching_name || '';
                const menuName = normalizeSlotName(rawMenuName);
                const businessType = item.business_type || '기타';  // 도시락/운반/요양원 등
                const mealType = item.meal_type || '';  // 조식/중식/석식/야식
                const menuOrder = item.menu_order || 0;

                if (!mealCountsCache[dateKey]) {
                    mealCountsCache[dateKey] = { _all: {}, _byCategory: {} };
                }
                if (!mealCountsCache[dateKey]._byCategory[businessType]) {
                    mealCountsCache[dateKey]._byCategory[businessType] = {};
                }

                if (menuName) {
                    // 전체 합계 (정렬 정보 포함: 카테고리, 끼니타입, 메뉴순서)
                    if (!mealCountsCache[dateKey]._all[menuName]) {
                        mealCountsCache[dateKey]._all[menuName] = { count: 0, mealType, menuOrder, category: businessType };
                    }
                    mealCountsCache[dateKey]._all[menuName].count += (item.meal_count || 0);

                    // 카테고리별 합계 (정렬 정보 포함)
                    if (!mealCountsCache[dateKey]._byCategory[businessType][menuName]) {
                        mealCountsCache[dateKey]._byCategory[businessType][menuName] = { count: 0, mealType, menuOrder, category: businessType };
                    }
                    mealCountsCache[dateKey]._byCategory[businessType][menuName].count += (item.meal_count || 0);
                }
            });
            console.log(`✅ 식수 데이터 로드 완료: ${Object.keys(mealCountsCache).length}일`, mealCountsCache);
        }
    } catch (e) {
        console.error('식수 데이터 로드 실패:', e);
    }
}

// 🔄 서버에서 식단 데이터 불러오기
async function loadMealPlansFromServer() {
    try {
        const siteId = getCurrentSiteId();
        const category = currentMealCategory !== '전체' ? currentMealCategory : null;

        // ★ 보안: site_id 없으면 로드 스킵 (데이터 혼용 방지)
        if (!siteId) {
            console.warn('⚠️ [식단 로드] site_id 없음 - 사업장 선택 후 로드됩니다');
            // 빈 데이터로 초기화 (기존 혼합 데이터 제거)
            AppState.set('mealData', {});
            mealData = {};
            return false;
        }

        // URL 빌드 - site_id와 category 파라미터 추가
        let url = '/api/meal-plans';
        const params = [];
        params.push(`site_id=${siteId}`);  // ★ site_id 필수
        if (category) params.push(`category=${encodeURIComponent(category)}`);
        url += '?' + params.join('&');

        const response = await fetch(url);
        const result = await response.json();

        // ★ 서버 경고 메시지 처리
        if (result._warning) {
            console.warn('⚠️ [서버 경고]', result._warning);
        }

        if (result.success) {
            const serverData = result.data || {};
            const serverTimestamps = result._timestamps || {};  // ★ 타임스탬프
            let loadedCount = 0;

            // 서버 데이터로 완전히 교체 (기존 캐시 데이터 초기화)
            AppState.set('mealData', {});
            mealData = {};
            mealTimestamps = {};  // ★ 타임스탬프도 초기화

            // 서버 데이터를 mealData에 반영
            Object.keys(serverData).forEach(dateKey => {
                const dateData = serverData[dateKey];
                if (!mealData[dateKey]) {
                    mealData[dateKey] = {};
                }
                Object.keys(dateData).forEach(slotName => {
                    mealData[dateKey][slotName] = dateData[slotName];
                    loadedCount++;
                });
            });

            // ★ 타임스탬프 저장 (낙관적 잠금용)
            Object.keys(serverTimestamps).forEach(dateKey => {
                mealTimestamps[dateKey] = serverTimestamps[dateKey];
            });

            // AppState도 동기화
            AppState.set('mealData', mealData);

            console.log(`✅ 서버에서 식단 ${Object.keys(serverData).length}일치, ${loadedCount}개 슬롯 불러옴 (site_id=${siteId})`);
            return true;
        }
    } catch (e) {
        console.error('서버 식단 로드 실패:', e);
    }
    return false;
}

// 🔄 실제 메뉴 데이터 로드 (캐싱 적용)
const MENU_CACHE_KEY = 'meal_plan_menus_cache';
const MENU_CACHE_TTL = 5 * 60 * 1000; // 5분 TTL

function getMenuCache(siteId) {
    try {
        const cacheKey = `${MENU_CACHE_KEY}_${siteId || 'all'}`;
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return null;

        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        // 캐시가 유효한 경우 데이터 반환
        if (age < MENU_CACHE_TTL) {
            console.log(`📦 메뉴 캐시 히트 (${Math.round(age/1000)}초 경과)`);
            return data;
        }
        console.log(`⏰ 메뉴 캐시 만료 (${Math.round(age/1000)}초 경과)`);
        return null;
    } catch (e) {
        console.warn('캐시 읽기 실패:', e);
        return null;
    }
}

function setMenuCache(siteId, data) {
    try {
        const cacheKey = `${MENU_CACHE_KEY}_${siteId || 'all'}`;
        localStorage.setItem(cacheKey, JSON.stringify({
            data: data,
            timestamp: Date.now()
        }));
        console.log(`💾 메뉴 캐시 저장 (${data.length}개)`);
    } catch (e) {
        console.warn('캐시 저장 실패:', e);
    }
}

// 🗑️ 메뉴 캐시 전체 삭제 (메뉴 추가/수정 후 호출)
function clearMenuCache() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(MENU_CACHE_KEY)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log(`🗑️ 메뉴 캐시 ${keysToRemove.length}개 삭제`);
    } catch (e) {
        console.warn('캐시 삭제 실패:', e);
    }
}

// 전역에서 접근 가능하도록 (메뉴 수정 후 호출용)
window.clearMealPlanMenuCache = clearMenuCache;

function convertMenusToAppFormat(recipes) {
    const convertedMenus = recipes.map(menu => ({
        id: menu.id,
        name: menu.display_name || menu.name || menu.menu_name || menu.recipe_name || '이름없음',
        category: menu.category || '미분류',
        currentPrice: menu.total_cost || 0,
        previousPrice: menu.total_cost || 0,
        ingredients: menu.ingredient_count > 0
            ? [`재료 ${menu.ingredient_count}종`]
            : ['재료 미등록'],
        trend: 'stable',
        changePercent: 0,
        changeReason: menu.ingredient_count > 0
            ? `재료 ${menu.ingredient_count}종`
            : '재료 미등록',
        created_at: menu.created_at || '',
        has_unavailable_supplier: menu.has_unavailable_supplier || false,
        unavailable_supplier_names: menu.unavailable_supplier_names || '',
        has_inactive_supplier: menu.has_inactive_supplier || false,
        inactive_supplier_names: menu.inactive_supplier_names || ''
    }));

    convertedMenus.forEach(menu => {
        if (menu.currentPrice === 0) {
            menu.changeReason = '단가 미계산';
        }
    });

    return convertedMenus;
}

async function loadRealMenuData() {
    const siteId = getCurrentSiteId();

    // 1️⃣ 캐시 확인 - 있으면 즉시 사용
    const cachedMenus = getMenuCache(siteId);
    if (cachedMenus && cachedMenus.length > 0) {
        updateMenuMapCache( cachedMenus);
        console.log(`⚡ 캐시에서 메뉴 ${cachedMenus.length}개 즉시 로드`);

        // 백그라운드에서 갱신 (사용자 경험 방해 없이)
        setTimeout(() => refreshMenuDataInBackground(siteId), 100);
        return true;
    }

    // 2️⃣ 캐시 없으면 서버에서 로드
    return await fetchAndCacheMenuData(siteId);
}

async function fetchAndCacheMenuData(siteId) {
    try {
        let apiUrl = `${CONFIG.API.BASE_URL}/api/recipes`;
        if (siteId) {
            apiUrl += `?site_id=${siteId}`;
        }

        console.log('🔄 서버에서 메뉴 로드 중...');
        const startTime = Date.now();

        const response = await fetch(apiUrl);
        const result = await response.json();

        const elapsed = Date.now() - startTime;
        console.log(`📥 메뉴 API 응답 (${elapsed}ms)`);

        if (result.success && result.recipes && result.recipes.length > 0) {
            const convertedMenus = convertMenusToAppFormat(result.recipes);

            // 캐시에 저장
            setMenuCache(siteId, convertedMenus);

            // AppState에 저장
            updateMenuMapCache( convertedMenus);
            console.log(`✅ 메뉴 ${convertedMenus.length}개 로드 (${elapsed}ms, siteId: ${siteId})`);
            return true;
        } else {
            console.warn('⚠️ 메뉴 데이터가 비어있습니다.');
            updateMenuMapCache( []);
            return false;
        }
    } catch (error) {
        console.error('메뉴 로드 실패:', error);
        updateMenuMapCache( []);
        return false;
    }
}

async function refreshMenuDataInBackground(siteId) {
    try {
        let apiUrl = `${CONFIG.API.BASE_URL}/api/recipes`;
        if (siteId) {
            apiUrl += `?site_id=${siteId}`;
        }

        const response = await fetch(apiUrl);
        const result = await response.json();

        if (result.success && result.recipes && result.recipes.length > 0) {
            const convertedMenus = convertMenusToAppFormat(result.recipes);

            // 캐시 갱신
            setMenuCache(siteId, convertedMenus);

            // 메뉴 수가 변경되었으면 AppState 업데이트
            const currentMenus = AppState.get('allMenus') || [];
            if (currentMenus.length !== convertedMenus.length) {
                updateMenuMapCache( convertedMenus);
                console.log(`🔄 백그라운드 갱신: ${currentMenus.length} → ${convertedMenus.length}개`);
            }
        }
    } catch (error) {
        console.warn('백그라운드 메뉴 갱신 실패:', error);
    }
}

// 전역 mealData 변수 정의 (AppState와 동기화)
let mealData = {};

// AppState에서 mealData 가져오기 (호환성을 위해)
function syncMealData() {
    mealData = AppState.get('mealData') || {};
}

// 📅 캘린더 생성
function generateCalendar() {
    const currentDate = AppState.get('currentDate');
    const currentView = AppState.get('currentView');

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // 현재 날짜 표시 업데이트
    document.getElementById('currentDate').textContent = `${year}년 ${month + 1}월`;

    // 월간 뷰 캘린더 생성
    if (currentView === 'month') {
        generateMonthCalendar(year, month);
    } else if (currentView === 'week') {
        generateWeekCalendar();
    } else {
        generateDayCalendar();
    }

    // 통계 업데이트
    updateStatistics();
}

// 📅 월간 캘린더 생성 (DocumentFragment 최적화)
function generateMonthCalendar(year, month) {
    const calendarGrid = document.getElementById('calendarGrid');

    // 그리드 스타일 리셋 (주간/일간 뷰에서 돌아올 때)
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.gridTemplateRows = '';  // 각 주별 내용에 맞게 높이 자동 조절

    // 첫째 날과 마지막 날
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    let currentDate = new Date(startDate);
    const today = formatDate(new Date());

    // 🚀 DocumentFragment로 배치 DOM 조작
    const fragment = document.createDocumentFragment();

    for (let week = 0; week < 6; week++) {
        for (let day = 0; day < 7; day++) {
            const dateKey = formatDate(currentDate);
            const isCurrentMonth = currentDate.getMonth() === month;
            const isToday = dateKey === today;

            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            if (!isCurrentMonth) dayElement.classList.add('other-month');
            if (isToday) dayElement.classList.add('today');

            // ★ 주 인덱스 추가 (주별 스크롤용)
            dayElement.setAttribute('data-week', week);
            if (day === 0) {
                dayElement.id = `week-${week}`;  // 각 주의 첫 번째 셀에 ID 부여
            }

            dayElement.innerHTML = createDayContent(currentDate, dateKey);

            // 드래그 앤 드롭 이벤트
            setupDayDragEvents(dayElement, dateKey);

            fragment.appendChild(dayElement);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    // 한 번에 DOM에 추가
    calendarGrid.innerHTML = '';
    calendarGrid.appendChild(fragment);
}

// 📆 주간 캘린더 생성
function generateWeekCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const currentDate = AppState.get('currentDate');
    const today = formatDate(new Date());

    // 현재 주의 시작일 (일요일)
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

    const fragment = document.createDocumentFragment();

    for (let day = 0; day < 7; day++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + day);
        const dateKey = formatDate(date);
        const isToday = dateKey === today;

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day week-view';
        if (isToday) dayElement.classList.add('today');

        dayElement.innerHTML = createDayContent(date, dateKey);
        setupDayDragEvents(dayElement, dateKey);

        fragment.appendChild(dayElement);
    }

    calendarGrid.innerHTML = '';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.gridTemplateRows = '1fr';
    calendarGrid.appendChild(fragment);

    // 헤더 업데이트
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    document.getElementById('currentDate').textContent =
        `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()} ~ ${endOfWeek.getMonth() + 1}/${endOfWeek.getDate()}`;
}

// 📋 일간 캘린더 생성
function generateDayCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const currentDate = AppState.get('currentDate');
    const dateKey = formatDate(currentDate);
    const today = formatDate(new Date());
    const isToday = dateKey === today;

    const dayElement = document.createElement('div');
    dayElement.className = 'calendar-day day-view';
    if (isToday) dayElement.classList.add('today');

    dayElement.innerHTML = createDayContent(currentDate, dateKey);
    setupDayDragEvents(dayElement, dateKey);

    calendarGrid.innerHTML = '';
    calendarGrid.style.gridTemplateColumns = '1fr';
    calendarGrid.style.gridTemplateRows = '1fr';
    calendarGrid.appendChild(dayElement);

    // 헤더 업데이트
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    document.getElementById('currentDate').textContent =
        `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월 ${currentDate.getDate()}일 (${dayNames[currentDate.getDay()]})`;
}

// 🗓️ 일자별 컨텐츠 생성
function createDayContent(date, dateKey) {
    const dayMeals = mealData[dateKey] || {};
    let totalCost = 0;
    let mealCount = 0;

    // 총 비용과 메뉴 수 계산
    Object.values(dayMeals).forEach(menus => {
        if (Array.isArray(menus)) {
            menus.forEach(menu => {
                totalCost += menu.currentPrice || 0;
                mealCount++;
            });
        }
    });

    // 📊 해당 날짜의 식수 데이터 가져오기 (카테고리 필터 적용)
    const dateCache = mealCountsCache[dateKey] || { _all: {}, _byCategory: {} };

    // 현재 선택된 카테고리에 맞는 식수 데이터 선택
    let dateMealCounts = {};
    if (currentMealCategory === '전체') {
        dateMealCounts = dateCache._all || {};
    } else {
        dateMealCounts = (dateCache._byCategory && dateCache._byCategory[currentMealCategory]) || {};
    }

    // 📊 전체 식수 합계 계산
    let totalMealCount = 0;
    Object.values(dateMealCounts).forEach(item => {
        totalMealCount += (item && typeof item === 'object') ? (item.count || 0) : (item || 0);
    });

    let slotsHTML = '';

    // 🗓️ 식수 데이터가 있는 슬롯과 저장된 데이터의 슬롯 병합
    const savedSlotNames = Object.keys(dayMeals);
    const mealCountSlotNames = Object.keys(dateMealCounts);

    // 모든 슬롯 합치기 (중복 제거)
    const allSlotNames = [...new Set([...savedSlotNames, ...mealCountSlotNames])];

    // 슬롯 정렬: 1. 카테고리 순서(도시락→운반→학교→요양원) 2. 끼니타입 3. 메뉴순서
    allSlotNames.sort((a, b) => {
        const aData = dateMealCounts[a] || {};
        const bData = dateMealCounts[b] || {};

        // 카테고리 정렬 (도시락→운반→학교→요양원)
        const aCatOrder = CATEGORY_ORDER[aData.category] || 99;
        const bCatOrder = CATEGORY_ORDER[bData.category] || 99;
        if (aCatOrder !== bCatOrder) return aCatOrder - bCatOrder;

        // 끼니 타입 정렬 (조식→중식→석식→간식→야식)
        const aMealOrder = MEAL_TYPE_ORDER[aData.mealType] || 99;
        const bMealOrder = MEAL_TYPE_ORDER[bData.mealType] || 99;
        if (aMealOrder !== bMealOrder) return aMealOrder - bMealOrder;

        // 메뉴 순서 정렬
        const aMenuOrder = aData.menuOrder || 0;
        const bMenuOrder = bData.menuOrder || 0;
        if (aMenuOrder !== bMenuOrder) return aMenuOrder - bMenuOrder;

        return a.localeCompare(b);
    });

    // 모든 슬롯 표시 (제한 없음)
    allSlotNames.forEach((slotName, index) => {
        const menus = dayMeals[slotName] || [];
        const slotCost = menus.reduce((sum, menu) => sum + (menu.currentPrice || 0), 0);

        // 🍽️ 해당 슬롯의 식수 가져오기 (객체 구조 지원)
        const slotData = dateMealCounts[slotName];
        const slotMealCount = (slotData && typeof slotData === 'object') ? (slotData.count || 0) : (slotData || 0);
        const slotMealType = (slotData && typeof slotData === 'object') ? (slotData.mealType || '') : '';

        // 메뉴도 없고 식수도 없으면 스킵
        if (menus.length === 0 && slotMealCount === 0) return;

        // 슬롯 이름 표시 (customSlotNames에서 표시명 가져오기)
        // 슬롯 이름 표시 (customSlotNames에서 표시명 가져오기)
        const displayName = customSlotNames[slotName] || slotName;

        // 📋 메뉴명 요약 (최대 2개까지 표시, 나머지는 +N개)
        let menuSummary = '';
        if (menus.length > 0) {
            const menuNames = menus.slice(0, 2).map(m => m.name || '메뉴').join(', ');
            const remaining = menus.length - 2;
            menuSummary = remaining > 0 ? `${menuNames} +${remaining}` : menuNames;
        }

        // 🍽️ 식수 표시 (색상으로 구분, 가독성 향상)
        let mealCountBadge = '';
        if (slotMealCount > 0) {
            let bgColor, textColor;
            if (slotMealCount >= 100) {
                bgColor = '#ffebee'; textColor = '#c62828';  // 빨간색
            } else if (slotMealCount >= 50) {
                bgColor = '#fff3e0'; textColor = '#e65100';  // 주황색
            } else {
                bgColor = '#e8f5e9'; textColor = '#2e7d32';  // 초록색
            }
            mealCountBadge = `<span class="meal-count-badge" style="background: ${bgColor}; color: ${textColor}; padding: 1px 5px; border-radius: 8px; font-size: 10px; font-weight: 700; margin-left: 4px;">👥${slotMealCount.toLocaleString()}</span>`;
        }

        // 🍱 끼니 구분 원문자 표시 (조식→①, 중식→②, 석식→③, 간식→④, 야식→⑤)
        const mealTypeCircles = { '조식': '①', '중식': '②', '석식': '③', '간식': '④', '야식': '⑤' };
        let mealTypeCircleBadge = '';
        if (slotMealType && mealTypeCircles[slotMealType]) {
            const circleColors = { '조식': '#ff9800', '중식': '#4caf50', '석식': '#2196f3', '간식': '#9c27b0', '야식': '#795548' };
            const circleColor = circleColors[slotMealType] || '#666';
            mealTypeCircleBadge = `<span class="meal-type-circle" style="font-size: 13px; font-weight: 700; color: ${circleColor}; margin-left: 4px;" title="${slotMealType}">${mealTypeCircles[slotMealType]}</span>`;
        }

        // 💰 목표식재료비 대비 차이 계산
        const targetCost = slotTargetCosts[slotName] || 0;
        const costDiff = slotCost - targetCost;
        let costDiffBadge = '';
        if (slotCost > 0 && targetCost > 0) {
            const diffColor = costDiff > 0 ? '#dc3545' : costDiff < 0 ? '#28a745' : '#6c757d';
            const diffSign = costDiff > 0 ? '+' : '';
            costDiffBadge = `<span style="color: ${diffColor}; font-size: 10px; font-weight: 600; margin-right: 4px;" title="목표: ${targetCost.toLocaleString()}원">${diffSign}${costDiff.toLocaleString()}</span>`;
        }

        slotsHTML += `
            <div class="meal-slot ${menus.length > 0 ? 'has-menu' : ''}"
                 data-date="${dateKey}" data-slot="${slotName}" data-slot-index="${index}">
                <div class="meal-slot-header">
                    <span class="meal-slot-name">${displayName}${mealTypeCircleBadge}${mealCountBadge}</span>
                    ${slotCost > 0 ? `<span class="meal-slot-cost" style="white-space: nowrap;">${costDiffBadge}<span style="color: #dc3545; font-weight: 700; font-size: 12px;">${slotCost.toLocaleString()}원</span></span>` : ''}
                </div>
                ${menuSummary ? `<div class="meal-slot-summary" style="font-size: 10px; color: #666; padding: 2px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${menuSummary}</div>` : ''}
                ${menus.map(menu => createMealMenuHTML(menu)).join('')}
            </div>
        `;
    });

    // 요일 감지 (0=일요일, 1=월요일, ..., 6=토요일)
    const dayOfWeek = date.getDay();
    let dayClass = 'weekday'; // 기본은 평일

    if (dayOfWeek === 0) {
        dayClass = 'sunday'; // 일요일
    } else if (dayOfWeek === 6) {
        dayClass = 'saturday'; // 토요일
    }

    // TODO: 공휴일 처리 로직 추가 가능
    // if (isHoliday(date)) dayClass = 'holiday';

    // 📊 날짜 헤더에 전체 식수 합계 표시
    let totalMealCountBadge = '';
    if (totalMealCount > 0) {
        totalMealCountBadge = `<span style="background: #e3f2fd; color: #1565c0; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700; margin-left: 4px;">👥${totalMealCount.toLocaleString()}</span>`;
    }

    return `
        <div class="day-header ${dayClass}" onclick="openMealInputModal('${dateKey}', event)" style="cursor: pointer;" title="클릭하여 식단 편집">
            <span class="day-number">${date.getDate()}${totalMealCountBadge}</span>
            ${totalCost > 0 ? `<span class="day-total">${totalCost.toLocaleString()}원</span>` : ''}
        </div>
        <div class="meal-slots" style="max-height: none; overflow-y: visible;">
            ${slotsHTML}
        </div>
    `;
}

// 🍽️ 메뉴 HTML 생성
function createMealMenuHTML(menu) {
    // 🛡️ 안전성 체크: menu 객체가 유효한지 확인
    if (!menu || typeof menu !== 'object') {
        return '';
    }

    const currentPrice = menu.currentPrice || 0;
    const changePercent = menu.changePercent || 0;
    const changeClass = menu.trend === 'up' ? 'up' : menu.trend === 'down' ? 'down' : 'stable';
    const changeIcon = menu.trend === 'up' ? '⬆️' : menu.trend === 'down' ? '⬇️' : '➡️';
    const changeText = changePercent > 0 ? `+${changePercent}%` :
        changePercent < 0 ? `${changePercent}%` : '0%';

    // 절감 금액 계산 (레시피 편집기에서 설정된 경우)
    const savingsAmount = menu.originalPrice ? (menu.originalPrice - currentPrice) : 0;
    const savingsDisplay = savingsAmount > 0 ?
        `<span class="meal-savings" style="color: #1e40af; font-weight: 700; font-size: 10px; margin-left: 4px; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">-${savingsAmount.toLocaleString()}원</span>` : '';

    // 🚚 발주불가 협력업체 경고 배지 (allMenus에서 최신 정보 조회)
    let supplierWarning = '';
    let warningStyle = '';
    if (menu.id) {
        const latestMenuInfo = getMenuById(menu.id);
        if (latestMenuInfo) {
            if (latestMenuInfo.has_unavailable_supplier) {
                supplierWarning = `<span title="발주불가: ${latestMenuInfo.unavailable_supplier_names || ''}" style="color: #dc3545; margin-left: 3px;">⚠️</span>`;
                warningStyle = 'border-left: 2px solid #dc3545; padding-left: 4px;';
            } else if (latestMenuInfo.has_inactive_supplier) {
                supplierWarning = `<span title="거래중단: ${latestMenuInfo.inactive_supplier_names || ''}" style="color: #ffc107; margin-left: 3px;">⚠️</span>`;
                warningStyle = 'border-left: 2px solid #ffc107; padding-left: 4px;';
            }
        }
    }

    // ★ 접두사/접미사 색상 적용
    const coloredMenuName = formatMenuNameWithColors(menu.name || '메뉴');

    return `
        <div class="meal-menu" data-menu-id="${menu.id || 0}" draggable="true"
             oncontextmenu="showMenuContextMenu(event, ${menu.id || 0})"
             onclick="openRecipeEditor(${menu.id || 0})"
             ondragstart="handleMenuDragStart(event)"
             ondragover="handleMenuDragOver(event)"
             ondrop="handleMenuDrop(event)"
             style="cursor: pointer; ${warningStyle}">
            <span class="meal-menu-name" title="${menu.name || '메뉴'}">${coloredMenuName}${supplierWarning}</span>
            <div style="display: flex; align-items: center; gap: 3px;">
                <span class="meal-menu-price">${currentPrice.toLocaleString()}원</span>
                ${savingsDisplay}
                <span class="meal-menu-change ${changeClass}">${changeIcon}${changeText}</span>
            </div>
        </div>
    `;
}

// 📚 메뉴 라이브러리 렌더링 (★ 점진적 렌더링 최적화)
const MENU_RENDER_BATCH = 50;  // 한 번에 렌더링할 메뉴 수
let _menuFilteredList = [];     // 현재 필터링된 전체 목록
let _menuRenderedCount = 0;     // 현재까지 렌더링된 수

function renderMenuLibrary() {
    const menuList = document.getElementById('menuList');
    const allMenus = AppState.get('allMenus') || [];
    let filteredMenus = allMenus;

    // 카테고리 필터 적용
    const currentCategory = AppState.get('currentCategory');
    if (currentCategory !== 'all') {
        filteredMenus = allMenus.filter(menu => menu.category === currentCategory);
    }

    // 검색어 필터 적용
    const searchTerm = document.getElementById('menuSearchInput').value.toLowerCase();
    if (searchTerm) {
        filteredMenus = filteredMenus.filter(menu =>
            menu.name.toLowerCase().includes(searchTerm) ||
            menu.ingredients.some(ing => ing.toLowerCase().includes(searchTerm))
        );
    }

    // ★ 첫 배치만 렌더링 (나머지는 스크롤 시 로드)
    _menuFilteredList = filteredMenus;
    _menuRenderedCount = Math.min(MENU_RENDER_BATCH, filteredMenus.length);

    menuList.innerHTML = filteredMenus.slice(0, _menuRenderedCount)
        .map(menu => createMenuItemHTML(menu)).join('');

    // 드래그 이벤트 설정
    setupMenuDragEvents();
}

// ★ 메뉴 라이브러리 스크롤 시 추가 로드
function loadMoreMenuItems() {
    if (_menuRenderedCount >= _menuFilteredList.length) return;

    const menuList = document.getElementById('menuList');
    const nextBatch = _menuFilteredList.slice(
        _menuRenderedCount,
        _menuRenderedCount + MENU_RENDER_BATCH
    );
    _menuRenderedCount += nextBatch.length;

    const fragment = document.createDocumentFragment();
    const temp = document.createElement('div');
    temp.innerHTML = nextBatch.map(menu => createMenuItemHTML(menu)).join('');
    while (temp.firstChild) {
        fragment.appendChild(temp.firstChild);
    }
    menuList.appendChild(fragment);

    // 새로 추가된 항목에 드래그 이벤트 설정
    setupMenuDragEvents();
}

// 🍽️ 메뉴 아이템 HTML 생성
function createMenuItemHTML(menu) {
    const changeClass = menu.trend === 'up' ? 'price-up' : menu.trend === 'down' ? 'price-down' : 'price-stable';
    const changeTextClass = menu.trend === 'up' ? 'up' : menu.trend === 'down' ? 'down' : 'stable';
    const changeIcon = menu.trend === 'up' ? '📈' : menu.trend === 'down' ? '📉' : '📊';
    const changeText = menu.changePercent > 0 ? `+${menu.changePercent}%` :
        menu.changePercent < 0 ? `${menu.changePercent}%` : '변동없음';

    // ★ 접두사/접미사 색상 적용
    const coloredMenuName = formatMenuNameWithColors(menu.name);

    return `
        <div class="menu-item" draggable="true" data-menu-id="${menu.id}">
            <div class="menu-header">
                <span class="menu-name">${coloredMenuName}</span>
                <span class="menu-category">${menu.category}</span>
            </div>
            <div class="price-comparison ${changeClass}">
                <span class="current-price">${menu.currentPrice.toLocaleString()}원</span>
                <span class="price-change ${changeTextClass}">
                    ${changeIcon} ${changeText}
                </span>
            </div>
            <div class="ingredients-info">
                ${menu.ingredients.join(', ')} • ${menu.changeReason}
            </div>
        </div>
    `;
}

// 🎯 이벤트 리스너 설정
function setupEventListeners() {
    // 카테고리 탭 클릭
    document.getElementById('categoryTabs').addEventListener('click', function (e) {
        if (e.target.classList.contains('category-tab')) {
            document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            renderMenuLibrary();
        }
    });

    // ★ 메뉴 라이브러리 스크롤 시 추가 로드
    const menuList = document.getElementById('menuList');
    if (menuList) {
        menuList.addEventListener('scroll', function () {
            if (this.scrollTop + this.clientHeight >= this.scrollHeight - 100) {
                loadMoreMenuItems();
            }
        });
    }
}

// 🖱️ 메뉴 드래그 이벤트 설정
function setupMenuDragEvents() {
    document.querySelectorAll('.menu-item[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', this.dataset.menuId);
            this.classList.add('dragging');
        });

        item.addEventListener('dragend', function (e) {
            this.classList.remove('dragging');
        });
    });
}

// 🎯 일자별 드래그 이벤트 설정
function setupDayDragEvents(dayElement, dateKey) {
    const mealSlots = dayElement.querySelectorAll('.meal-slot');

    mealSlots.forEach(slot => {
        slot.addEventListener('dragover', function (e) {
            e.preventDefault();
            this.classList.add('drag-over');
        });

        slot.addEventListener('dragleave', function (e) {
            this.classList.remove('drag-over');
        });

        slot.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('drag-over');

            const menuId = e.dataTransfer.getData('text/plain');
            const menu = getMenuById(menuId);
            const slotName = this.dataset.slot;

            if (menu && slotName) {
                addMenuToSlot(dateKey, slotName, menu);
            }
        });
    });
}

// 🍽️ 슬롯에 메뉴 추가 (AppState 사용)
function addMenuToSlot(dateKey, slotName, menu) {
    const currentMeals = AppState.getMealData(dateKey, slotName);

    // 중복 체크
    const exists = currentMeals.some(m => m.id === menu.id);
    if (!exists) {
        const updatedMeals = [...currentMeals, menu];
        AppState.setMealData(dateKey, slotName, updatedMeals);

        // 화면 업데이트
        generateCalendar();
        updateStatistics();

        // 성공 피드백 (UIManager 사용 시도)
        if (window.UIManager) {
            UIManager.showToast(`${menu.name}이(가) ${slotName}에 추가되었습니다.`, 'success');
        } else {
            showNotification(`${menu.name}이(가) ${slotName}에 추가되었습니다.`, 'success');
        }
    } else {
        if (window.UIManager) {
            UIManager.showToast(`${menu.name}은(는) 이미 ${slotName}에 있습니다.`, 'warning');
        } else {
            showNotification(`${menu.name}은(는) 이미 ${slotName}에 있습니다.`, 'warning');
        }
    }
}

// 📊 통계 업데이트
function updateStatistics() {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    let totalMenus = 0;
    let totalCost = 0;
    let priceChanges = 0;

    // AppState에서 최신 mealData 가져오기
    const currentMealData = AppState.get('mealData') || mealData || {};

    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const dateKey = formatDate(date);
        const dayMeals = currentMealData[dateKey] || {};

        Object.values(dayMeals).forEach(menus => {
            if (Array.isArray(menus)) {
                menus.forEach(menu => {
                    totalMenus++;
                    totalCost += menu.currentPrice || menu.total_cost || 0;
                    if (menu.changePercent !== 0) priceChanges++;
                });
            }
        });
    }

    const avgCost = totalMenus > 0 ? Math.round(totalCost / totalMenus) : 0;
    const orderReady = totalMenus > 0 ? Math.round((totalMenus - priceChanges) / totalMenus * 100) : 100;

    document.getElementById('totalMenus').textContent = totalMenus;
    document.getElementById('avgCost').textContent = avgCost.toLocaleString() + '원';
    document.getElementById('priceChanges').textContent = priceChanges;
    document.getElementById('orderReady').textContent = orderReady + '%';

    console.log('📊 통계 업데이트:', { totalMenus, avgCost, priceChanges, orderReady });
}

// 🔍 메뉴 검색
function searchMenus() {
    renderMenuLibrary();
}

// 📅 뷰 변경
function changeView(view) {
    currentView = view;
    AppState.set('currentView', view);  // AppState도 동기화
    generateCalendar();

    // 버튼 스타일 업데이트
    document.querySelectorAll('.toolbar-right .btn-primary').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }
}

// 📅 이전/다음 기간
async function previousPeriod() {
    const date = AppState.get('currentDate');
    const view = AppState.get('currentView') || 'month';
    const oldMonth = date.getMonth();

    if (view === 'month') {
        date.setDate(1);  // ★ 31일→1일로 설정하여 월 이동 시 overflow 방지
        date.setMonth(date.getMonth() - 1);
        currentFocusedWeek = 0;  // ★ 월 변경 시 첫 번째 주로 리셋
    } else if (view === 'week') {
        date.setDate(date.getDate() - 7);
    } else {
        date.setDate(date.getDate() - 1);
    }
    AppState.set('currentDate', new Date(date));

    // 월이 변경되면 해당 월의 데이터 다시 로드
    if (view === 'month' || date.getMonth() !== oldMonth) {
        await Promise.all([
            loadMealPlansFromServer(),
            preloadMealCounts()
        ]);
        syncMealData();
    }
    generateCalendar();
}

async function nextPeriod() {
    const date = AppState.get('currentDate');
    const view = AppState.get('currentView') || 'month';
    const oldMonth = date.getMonth();

    if (view === 'month') {
        date.setDate(1);  // ★ 31일→1일로 설정하여 월 이동 시 overflow 방지
        date.setMonth(date.getMonth() + 1);
        currentFocusedWeek = 0;  // ★ 월 변경 시 첫 번째 주로 리셋
    } else if (view === 'week') {
        date.setDate(date.getDate() + 7);
    } else {
        date.setDate(date.getDate() + 1);
    }
    AppState.set('currentDate', new Date(date));

    // 월이 변경되면 해당 월의 데이터 다시 로드
    if (view === 'month' || date.getMonth() !== oldMonth) {
        await Promise.all([
            loadMealPlansFromServer(),
            preloadMealCounts()
        ]);
        syncMealData();
    }
    generateCalendar();
}

async function goToToday() {
    const oldDate = AppState.get('currentDate');
    const newDate = new Date();
    AppState.set('currentDate', newDate);

    // 월이 변경되면 해당 월의 데이터 다시 로드
    if (oldDate.getMonth() !== newDate.getMonth() || oldDate.getFullYear() !== newDate.getFullYear()) {
        await Promise.all([
            loadMealPlansFromServer(),
            preloadMealCounts()
        ]);
        syncMealData();
    }
    generateCalendar();
}

// 📅 주 단위 스크롤 (direction: -1 이전주, 1 다음주)
// 현재 포커스된 주 인덱스 (0-5)
let currentFocusedWeek = 0;

async function jumpWeek(direction) {
    const view = AppState.get('currentView') || 'month';

    // 월간 뷰에서만 스크롤 방식 사용
    if (view === 'month') {
        const newWeek = currentFocusedWeek + direction;

        // 범위 체크 (0-5)
        if (newWeek < 0) {
            // 이전 달의 마지막 주로 이동
            await previousPeriod();
            currentFocusedWeek = 5;
            scrollToWeek(currentFocusedWeek);
            return;
        } else if (newWeek > 5) {
            // 다음 달의 첫 번째 주로 이동
            await nextPeriod();
            currentFocusedWeek = 0;
            scrollToWeek(currentFocusedWeek);
            return;
        }

        currentFocusedWeek = newWeek;
        scrollToWeek(currentFocusedWeek);
    } else {
        // 주간/일간 뷰에서는 기존 방식
        const date = AppState.get('currentDate');
        const oldMonth = date.getMonth();

        date.setDate(date.getDate() + (7 * direction));
        AppState.set('currentDate', new Date(date));

        if (date.getMonth() !== oldMonth) {
            await Promise.all([
                loadMealPlansFromServer(),
                preloadMealCounts()
            ]);
            syncMealData();
        }
        generateCalendar();
    }
}

// 특정 주로 스크롤
function scrollToWeek(weekIndex) {
    const weekElement = document.getElementById(`week-${weekIndex}`);
    if (weekElement) {
        weekElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // 현재 포커스된 주 하이라이트 (선택사항)
        document.querySelectorAll('.calendar-day').forEach(el => {
            el.classList.remove('week-focused');
        });
        document.querySelectorAll(`[data-week="${weekIndex}"]`).forEach(el => {
            el.classList.add('week-focused');
        });
    }
}

// 🛠️ 유틸리티 함수들
function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 📢 알림 표시 (개선된 버전)
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const bgColor = {
        success: '#48bb78',
        warning: '#ed8936',
        error: '#f56565',
        info: '#4299e1'
    }[type] || '#4299e1';

    const icon = {
        success: '✅',
        warning: '⚠️',
        error: '❌',
        info: 'ℹ️'
    }[type] || 'ℹ️';

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${bgColor};
        color: white;
        border-radius: 8px;
        z-index: 10000;
        font-size: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
        max-width: 300px;
        word-wrap: break-word;
    `;
    notification.innerHTML = `${icon} ${message}`;

    document.body.appendChild(notification);

    const duration = type === 'error' ? 5000 : type === 'warning' ? 8000 : 3000;
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

// 🔄 로딩 오버레이
function showLoadingOverlay(message = '로딩 중...') {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        color: white;
        font-size: 14px;
        font-weight: 600;
    `;
    overlay.innerHTML = `
        <div style="text-align: center;">
            <div style="margin-bottom: 15px;">
                <div class="spinner"></div>
            </div>
            <div>${message}</div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
    }
}

// 🎨 CSS 애니메이션 추가
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);

// 🔄 스마트 복사 시스템 (임시 로컬 변수, 추후 AppState로 이관 예정)
let copyClipboard = {
    type: null, // 'menu', 'meal', 'day'
    data: null,
    sourceDate: null,
    sourceMeal: null
};

// 📋 복사 시스템 열기
function openCopySystem() {
    const modal = createCopySystemModal();
    document.body.appendChild(modal);
}

function createCopySystemModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;

    modal.innerHTML = `
        <div style="
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #2d3748; font-size: 18px;">🔄 스마트 복사 도구</h2>
                <button onclick="this.closest('.modal').remove()" style="
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #718096;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">&times;</button>
            </div>

            <div style="margin-bottom: 20px;">
                <h3 style="font-size: 14px; color: #4a5568; margin-bottom: 12px;">복사 모드 선택</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <button class="copy-mode-btn" data-mode="menu" onclick="selectCopyMode('menu')" style="
                        padding: 12px;
                        border: 2px solid #e2e8f0;
                        border-radius: 8px;
                        background: white;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.3s;
                        font-size: 12px;
                    ">
                        <div style="font-size: 20px; margin-bottom: 4px;">🍽️</div>
                        <div style="font-weight: 600;">단일 메뉴</div>
                        <div style="font-size: 10px; color: #718096;">특정 메뉴를 다른 슬롯에</div>
                    </button>
                    <button class="copy-mode-btn" data-mode="meal" onclick="selectCopyMode('meal')" style="
                        padding: 12px;
                        border: 2px solid #e2e8f0;
                        border-radius: 8px;
                        background: white;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.3s;
                        font-size: 12px;
                    ">
                        <div style="font-size: 20px; margin-bottom: 4px;">🍱</div>
                        <div style="font-weight: 600;">식단 세트</div>
                        <div style="font-size: 10px; color: #718096;">전체 식단을 다른 날에</div>
                    </button>
                    <button class="copy-mode-btn" data-mode="day" onclick="selectCopyMode('day')" style="
                        padding: 12px;
                        border: 2px solid #e2e8f0;
                        border-radius: 8px;
                        background: white;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.3s;
                        font-size: 12px;
                    ">
                        <div style="font-size: 20px; margin-bottom: 4px;">📅</div>
                        <div style="font-weight: 600;">하루 전체</div>
                        <div style="font-size: 10px; color: #718096;">하루 모든 식단을 복사</div>
                    </button>
                    <button class="copy-mode-btn" data-mode="range" onclick="selectCopyMode('range')" style="
                        padding: 12px;
                        border: 2px solid #e2e8f0;
                        border-radius: 8px;
                        background: white;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.3s;
                        font-size: 12px;
                    ">
                        <div style="font-size: 20px; margin-bottom: 4px;">📊</div>
                        <div style="font-weight: 600;">기간 복사</div>
                        <div style="font-size: 10px; color: #718096;">여러 날을 한번에</div>
                    </button>
                </div>
            </div>

            <div id="copyModeDetails" style="margin-bottom: 20px; min-height: 100px;">
                <div style="text-align: center; color: #718096; padding: 40px;">
                    위에서 복사 모드를 선택하세요
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button onclick="this.closest('.modal').remove()" style="
                    padding: 8px 16px;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    background: white;
                    color: #4a5568;
                    cursor: pointer;
                    font-size: 12px;
                ">취소</button>
                <button id="executeCopyBtn" onclick="executeCopy()" disabled style="
                    padding: 8px 16px;
                    border: none;
                    border-radius: 6px;
                    background: #667eea;
                    color: white;
                    cursor: pointer;
                    font-size: 12px;
                    opacity: 0.5;
                ">복사 실행</button>
            </div>
        </div>
    `;

    modal.className = 'modal';
    return modal;
}

// 복사 모드 선택
let selectedCopyMode = null;
let copySourceData = null;
let copyTargetData = null;

function selectCopyMode(mode) {
    selectedCopyMode = mode;

    // 모든 버튼 스타일 초기화
    document.querySelectorAll('.copy-mode-btn').forEach(btn => {
        btn.style.borderColor = '#e2e8f0';
        btn.style.background = 'white';
    });

    // 선택된 버튼 하이라이트
    const selectedBtn = document.querySelector(`[data-mode="${mode}"]`);
    selectedBtn.style.borderColor = '#667eea';
    selectedBtn.style.background = '#f7fafc';

    // 상세 설정 UI 표시
    showCopyModeDetails(mode);
}

function showCopyModeDetails(mode) {
    const detailsContainer = document.getElementById('copyModeDetails');

    switch (mode) {
        case 'menu':
            detailsContainer.innerHTML = `
                <h4 style="font-size: 13px; margin-bottom: 8px;">🍽️ 단일 메뉴 복사</h4>
                <p style="font-size: 11px; color: #718096; margin-bottom: 12px;">
                    특정 메뉴를 선택하여 다른 식단 슬롯에 복사합니다.
                </p>
                <div style="background: #f7fafc; padding: 12px; border-radius: 6px; font-size: 11px;">
                    <strong>사용법:</strong><br>
                    1. 복사할 메뉴를 우클릭하여 "복사" 선택<br>
                    2. 붙여넣을 슬롯을 우클릭하여 "붙여넣기" 선택
                </div>
            `;
            break;

        case 'meal':
            detailsContainer.innerHTML = `
                <h4 style="font-size: 13px; margin-bottom: 8px;">🍱 식단 세트 복사</h4>
                <p style="font-size: 11px; color: #718096; margin-bottom: 12px;">
                    특정 식단(예: 조식A, 중식B)의 모든 메뉴를 다른 날짜의 같은 식단에 복사합니다.
                </p>
                <div style="background: #f7fafc; padding: 12px; border-radius: 6px; font-size: 11px;">
                    <strong>사용법:</strong><br>
                    1. 복사할 식단 슬롯을 우클릭하여 "식단 복사" 선택<br>
                    2. 목표 날짜의 같은 식단 슬롯에 "식단 붙여넣기" 선택
                </div>
            `;
            break;

        case 'day':
            detailsContainer.innerHTML = `
                <h4 style="font-size: 13px; margin-bottom: 8px;">📅 하루 전체 복사</h4>
                <p style="font-size: 11px; color: #718096; margin-bottom: 12px;">
                    선택한 날짜의 모든 식단을 다른 날짜에 일괄 복사합니다.
                </p>
                <div style="background: #f7fafc; padding: 12px; border-radius: 6px; font-size: 11px;">
                    <strong>사용법:</strong><br>
                    1. 복사할 날짜를 우클릭하여 "하루 복사" 선택<br>
                    2. 목표 날짜를 우클릭하여 "하루 붙여넣기" 선택
                </div>
            `;
            break;

        case 'range':
            const today = new Date().toISOString().split('T')[0];
            detailsContainer.innerHTML = `
                <h4 style="font-size: 13px; margin-bottom: 8px;">📊 기간 복사 (DB 저장)</h4>
                <p style="font-size: 11px; color: #718096; margin-bottom: 12px;">
                    지정한 기간의 식단을 다른 날짜로 복사합니다.
                </p>
                <div style="display: grid; gap: 12px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px;">원본 기간</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="date" id="copySourceStart" value="${today}" style="flex: 1; padding: 6px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 4px;">
                            <span style="font-size: 11px;">~</span>
                            <input type="date" id="copySourceEnd" value="${today}" style="flex: 1; padding: 6px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 4px;">
                        </div>
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px;">대상 시작 날짜</label>
                        <input type="date" id="copyTargetStart" value="${today}" style="width: 100%; padding: 6px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
                            <input type="checkbox" id="copyOverwrite">
                            기존 식단 덮어쓰기
                        </label>
                    </div>
                </div>
            `;
            break;
    }

    // 복사 실행 버튼 활성화
    const executeBtn = document.getElementById('executeCopyBtn');
    executeBtn.disabled = false;
    executeBtn.style.opacity = '1';
}

async function executeCopy() {
    // 기간 복사 모드일 경우 백엔드 API 호출
    if (selectedCopyMode === 'range') {
        const sourceStart = document.getElementById('copySourceStart').value;
        const sourceEnd = document.getElementById('copySourceEnd').value;
        const targetStart = document.getElementById('copyTargetStart').value;
        const overwrite = document.getElementById('copyOverwrite').checked;

        if (!sourceStart || !sourceEnd || !targetStart) {
            showNotification('원본 기간과 대상 날짜를 모두 입력해주세요.', 'error');
            return;
        }

        try {
            const response = await fetch('/api/meal-plan-copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    copy_type: 'custom',
                    source_start_date: sourceStart,
                    source_end_date: sourceEnd,
                    target_start_date: targetStart,
                    overwrite: overwrite
                })
            });

            const result = await response.json();

            if (result.success) {
                showNotification(`식단 복사 완료! ${result.copied}개 복사됨, ${result.skipped}개 건너뜀`, 'success');
                document.querySelector('.modal').remove();
                // 식단 데이터 새로고침
                if (typeof loadWeekMeals === 'function') {
                    loadWeekMeals();
                }
            } else {
                showNotification(`복사 실패: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('복사 오류:', error);
            showNotification('복사 중 오류가 발생했습니다.', 'error');
        }
        return;
    }

    // 다른 모드는 기존 방식 (로컬 메모리 복사)
    showNotification(`${selectedCopyMode} 모드가 활성화되었습니다. 이제 캘린더에서 복사/붙여넣기를 사용하세요.`, 'success');
    document.querySelector('.modal').remove();

    // 복사 모드 UI 활성화
    enableCopyMode(selectedCopyMode);
}

function enableCopyMode(mode) {
    // 상단에 복사 모드 표시기 추가
    const modeIndicator = document.createElement('div');
    modeIndicator.id = 'copyModeIndicator';
    modeIndicator.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: #667eea;
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 11px;
        z-index: 9998;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
    `;
    modeIndicator.innerHTML = `
        🔄 ${getModeName(mode)} 모드 활성
        <button onclick="disableCopyMode()" style="
            background: none;
            border: none;
            color: white;
            margin-left: 8px;
            cursor: pointer;
            font-size: 12px;
        ">✕</button>
    `;

    document.body.appendChild(modeIndicator);

    // 우클릭 이벤트 추가
    setupContextMenus(mode);
}

function getModeName(mode) {
    const names = {
        'menu': '단일 메뉴',
        'meal': '식단 세트',
        'day': '하루 전체',
        'range': '기간'
    };
    return names[mode] || mode;
}

function disableCopyMode() {
    const indicator = document.getElementById('copyModeIndicator');
    if (indicator) indicator.remove();

    selectedCopyMode = null;
    copySourceData = null;
    copyTargetData = null;

    // 우클릭 이벤트 제거
    removeContextMenus();

    showNotification('복사 모드가 비활성화되었습니다.', 'info');
}

function setupContextMenus(mode) {
    // 기존 이벤트 리스너 제거
    removeContextMenus();

    // 새로운 우클릭 이벤트 추가
    document.addEventListener('contextmenu', handleContextMenu);
}

function removeContextMenus() {
    document.removeEventListener('contextmenu', handleContextMenu);
}

function handleContextMenu(e) {
    e.preventDefault();

    const target = e.target.closest('.meal-menu, .meal-slot, .calendar-day');
    if (!target) return;

    createContextMenu(e.pageX, e.pageY, target);
}

function createContextMenu(x, y, target) {
    // 기존 컨텍스트 메뉴 제거
    const existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 120px;
        font-size: 11px;
    `;

    const menuItems = getContextMenuItems(target);
    menu.innerHTML = menuItems.map(item => `
        <div onclick="${item.action}" style="
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid #f7fafc;
            transition: background 0.2s;
        " onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='white'">
            ${item.icon} ${item.label}
        </div>
    `).join('');

    document.body.appendChild(menu);

    // 클릭 시 메뉴 제거
    setTimeout(() => {
        document.addEventListener('click', function removeMenu() {
            menu.remove();
            document.removeEventListener('click', removeMenu);
        });
    }, 100);
}

function getContextMenuItems(target) {
    const items = [];

    if (target.classList.contains('meal-menu')) {
        // 메뉴 아이템
        items.push({
            icon: '📋',
            label: '메뉴 복사',
            action: `copyMenu('${target.dataset.menuId}')`
        });

        if (copyClipboard.type === 'menu') {
            items.push({
                icon: '📄',
                label: '메뉴 붙여넣기',
                action: `pasteMenu('${target.closest('.meal-slot').dataset.date}', '${target.closest('.meal-slot').dataset.slot}')`
            });
        }
    } else if (target.classList.contains('meal-slot')) {
        // 식단 슬롯
        items.push({
            icon: '🍱',
            label: '식단 복사',
            action: `copyMealSlot('${target.dataset.date}', '${target.dataset.slot}')`
        });

        if (copyClipboard.type === 'meal') {
            items.push({
                icon: '🍽️',
                label: '식단 붙여넣기',
                action: `pasteMealSlot('${target.dataset.date}', '${target.dataset.slot}')`
            });
        }
    } else if (target.classList.contains('calendar-day')) {
        // 날짜 전체
        items.push({
            icon: '📅',
            label: '하루 복사',
            action: `copyDay('${target.dataset.date || formatDate(new Date())}')`
        });

        if (copyClipboard.type === 'day') {
            items.push({
                icon: '📋',
                label: '하루 붙여넣기',
                action: `pasteDay('${target.dataset.date || formatDate(new Date())}')`
            });
        }
    }

    return items;
}

// 복사/붙여넣기 실행 함수들
function copyMenu(menuId) {
    const menu = getMenuById(menuId);
    if (menu) {
        copyClipboard = {
            type: 'menu',
            data: menu,
            sourceDate: null,
            sourceMeal: null
        };
        showNotification(`"${menu.name}" 메뉴가 복사되었습니다.`, 'success');
    }
    document.getElementById('contextMenu').remove();
}

function pasteMenu(dateKey, slotName) {
    if (copyClipboard.type === 'menu' && copyClipboard.data) {
        addMenuToSlot(dateKey, slotName, copyClipboard.data);
        showNotification(`"${copyClipboard.data.name}" 메뉴가 붙여넣어졌습니다.`, 'success');
    }
    document.getElementById('contextMenu').remove();
}

function copyMealSlot(dateKey, slotName) {
    const mealData_slot = mealData[dateKey] && mealData[dateKey][slotName];
    if (mealData_slot && mealData_slot.length > 0) {
        copyClipboard = {
            type: 'meal',
            data: [...mealData_slot],
            sourceDate: dateKey,
            sourceMeal: slotName
        };
        showNotification(`${slotName} 식단이 복사되었습니다 (${mealData_slot.length}개 메뉴).`, 'success');
    } else {
        showNotification('복사할 메뉴가 없습니다.', 'warning');
    }
    document.getElementById('contextMenu').remove();
}

function pasteMealSlot(dateKey, slotName) {
    if (copyClipboard.type === 'meal' && copyClipboard.data) {
        if (!mealData[dateKey]) mealData[dateKey] = {};
        mealData[dateKey][slotName] = [...copyClipboard.data];

        generateCalendar();
        updateStatistics();

        showNotification(`${slotName}에 식단이 붙여넣어졌습니다 (${copyClipboard.data.length}개 메뉴).`, 'success');
    }
    document.getElementById('contextMenu').remove();
}

function copyDay(dateKey) {
    const dayMeals = mealData[dateKey];
    if (dayMeals && Object.keys(dayMeals).length > 0) {
        copyClipboard = {
            type: 'day',
            data: JSON.parse(JSON.stringify(dayMeals)), // 깊은 복사
            sourceDate: dateKey,
            sourceMeal: null
        };

        const totalMenus = Object.values(dayMeals).reduce((sum, menus) => {
            return sum + (Array.isArray(menus) ? menus.length : 0);
        }, 0);

        showNotification(`${dateKey} 하루 식단이 복사되었습니다 (${totalMenus}개 메뉴).`, 'success');
    } else {
        showNotification('복사할 식단이 없습니다.', 'warning');
    }
    document.getElementById('contextMenu').remove();
}

function pasteDay(dateKey) {
    if (copyClipboard.type === 'day' && copyClipboard.data) {
        mealData[dateKey] = JSON.parse(JSON.stringify(copyClipboard.data)); // 깊은 복사

        generateCalendar();
        updateStatistics();

        const totalMenus = Object.values(copyClipboard.data).reduce((sum, menus) => {
            return sum + (Array.isArray(menus) ? menus.length : 0);
        }, 0);

        showNotification(`${dateKey}에 하루 식단이 붙여넣어졌습니다 (${totalMenus}개 메뉴).`, 'success');
    }
    document.getElementById('contextMenu').remove();
}

// 🍽️ 슬롯 추가 기능 (AppState 사용)
function addMoreSlots() {
    const currentVisibleSlotCount = AppState.get('visibleSlotCount');
    const mealSlots = AppState.get('mealSlots');

    if (currentVisibleSlotCount < mealSlots.length) {
        const newVisibleSlotCount = Math.min(currentVisibleSlotCount + 3, mealSlots.length);
        AppState.set('visibleSlotCount', newVisibleSlotCount);

        generateCalendar();

        if (window.UIManager) {
            UIManager.showToast(`식단 슬롯을 ${3}개 더 추가했습니다! (총 ${newVisibleSlotCount}개)`, 'success');
        } else {
            showNotification(`식단 슬롯을 ${3}개 더 추가했습니다! (총 ${newVisibleSlotCount}개)`, 'success');
        }
    }
}

// 🔄 메뉴 순서 이동 드래그 앤 드롭
let draggedMenuElement = null;
let draggedMenuData = null;

function handleMenuDragStart(event) {
    draggedMenuElement = event.target.closest('.meal-menu');
    const menuId = draggedMenuElement.dataset.menuId;
    const slotElement = draggedMenuElement.closest('.meal-slot');
    const dateKey = slotElement.dataset.date;
    const slotName = slotElement.dataset.slot;

    draggedMenuData = {
        menuId: menuId,
        sourceDate: dateKey,
        sourceSlot: slotName,
        menu: getMenuById(menuId)
    };

    event.dataTransfer.effectAllowed = 'move';
    draggedMenuElement.style.opacity = '0.5';
}

function handleMenuDragOver(event) {
    event.preventDefault();
    const targetElement = event.target.closest('.meal-menu');
    if (targetElement && targetElement !== draggedMenuElement) {
        event.dataTransfer.dropEffect = 'move';

        // 시각적 피드백
        const rect = targetElement.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (event.clientY < midY) {
            targetElement.style.borderTop = '2px solid #3498db';
            targetElement.style.borderBottom = '';
        } else {
            targetElement.style.borderBottom = '2px solid #3498db';
            targetElement.style.borderTop = '';
        }
    }
}

function handleMenuDrop(event) {
    event.preventDefault();
    const targetElement = event.target.closest('.meal-menu');

    if (targetElement && targetElement !== draggedMenuElement && draggedMenuData) {
        const targetSlot = targetElement.closest('.meal-slot');
        const targetDate = targetSlot.dataset.date;
        const targetSlotName = targetSlot.dataset.slot;

        // 같은 슬롯 내에서만 순서 이동 허용
        if (targetDate === draggedMenuData.sourceDate &&
            targetSlotName === draggedMenuData.sourceSlot) {

            const sourceMenus = mealData[targetDate][targetSlotName];
            const draggedIndex = sourceMenus.findIndex(m => m.id == draggedMenuData.menuId);
            const targetIndex = sourceMenus.findIndex(m => m.id == targetElement.dataset.menuId);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                // 배열에서 메뉴 순서 바꾸기
                const draggedMenu = sourceMenus.splice(draggedIndex, 1)[0];
                sourceMenus.splice(targetIndex, 0, draggedMenu);

                generateCalendar();
                showNotification(`메뉴 순서가 변경되었습니다.`, 'success');
            }
        }
    }

    // 정리
    if (draggedMenuElement) {
        draggedMenuElement.style.opacity = '';
    }
    document.querySelectorAll('.meal-menu').forEach(el => {
        el.style.borderTop = '';
        el.style.borderBottom = '';
    });
    draggedMenuElement = null;
    draggedMenuData = null;
}

// 🍳 레시피 편집기 연동
let recipeEditorLoaded = false;

async function loadRecipeEditor() {
    if (recipeEditorLoaded) return;

    try {
        // 레시피 편집기 모듈 로드
        const script = document.createElement('script');
        script.src = 'static/modules/recipe-editor/recipe-editor.js';
        script.onload = async () => {
            await RecipeEditor.init();
            recipeEditorLoaded = true;
            console.log('✅ 레시피 편집기 모듈 로드 완료');
        };
        document.head.appendChild(script);
    } catch (error) {
        console.error('❌ 레시피 편집기 로드 실패:', error);
        showNotification('레시피 편집기를 로드할 수 없습니다.', 'error');
    }
}

async function openRecipeEditor(menuId) {
    // 이벤트 버블링 방지
    event.stopPropagation();

    // 클릭된 메뉴의 위치 정보 찾기
    const menuElement = event.target.closest('.meal-menu');
    const slotElement = menuElement.closest('.meal-slot');
    const dateKey = slotElement.dataset.date;
    const slotName = slotElement.dataset.slot;

    // 레시피 편집기 모듈이 로드되지 않았으면 로드
    if (!recipeEditorLoaded) {
        showNotification('레시피 편집기를 준비하는 중...', 'info');
        await loadRecipeEditor();

        // 로드 완료까지 잠시 대기
        setTimeout(() => {
            if (window.RecipeEditor) {
                RecipeEditor.openEditor(menuId, dateKey, slotName);
            }
        }, 500);
    } else {
        RecipeEditor.openEditor(menuId, dateKey, slotName);
    }
}

// 🚀 고급 기능들
function openPriceAnalysis() {
    showNotification('가격 분석 모듈을 준비 중입니다...', 'info');
}

function openOrderIntegration() {
    showNotification('발주 통합 시스템을 준비 중입니다...', 'info');
}

// 🎯 식단 입력 모달 관련 함수들
let modalSelectedDate = null;
let modalMealData = {}; // 모달 내 임시 식단 데이터
let customSlotNames = {}; // 사용자 정의 슬롯명
let slotTargetCosts = {}; // 슬롯별 목표 재료비
let modalSlotOrder = []; // 슬롯 순서 (드래그로 변경 가능)
let modalDeletedSlotsByCategory = {}; // 카테고리별 삭제된 슬롯 추적
let mealTemplates = []; // 저장된 템플릿 (서버에서 가져옴)
let draggedSlotName = null; // 드래그 중인 슬롯
let _slotSettingsLoadedSiteId = null; // 슬롯 설정이 로드된 사업장 ID (캐싱용)

// 초기화 시 서버에서 설정 불러오기
// forceReload: true면 캐시 무시하고 새로 로드
async function loadSlotAndTemplateSettings(forceReload = false) {
    const siteId = getCurrentSiteId();
    const siteParam = siteId ? `?site_id=${siteId}` : '';

    // 🚀 캐싱: 동일 사업장에서 이미 로드되었으면 스킵 (속도 개선)
    const hasSlotSettings = Object.keys(customSlotNames).length > 0;
    const hasTemplates = mealTemplates.length > 0;
    const sameSite = _slotSettingsLoadedSiteId === siteId;

    if (!forceReload && hasSlotSettings && hasTemplates && sameSite) {
        console.log(`[설정] 캐시 사용 (사업장: ${siteId || '전체'}, 슬롯: ${Object.keys(customSlotNames).length}개)`);
        return true;
    }

    try {
        // 🚀 슬롯명, 템플릿, 카테고리 슬롯(목표비용)을 병렬 로드
        const [slotResponse, templateResponse, v2SlotsResponse] = await Promise.all([
            fetch('/api/meal-slot-settings' + siteParam),
            fetch('/api/meal-templates' + siteParam),
            fetch('/api/v2/slots')  // 어드민 운영설정의 목표식재료비
        ]);

        const [slotData, templateData, v2SlotsData] = await Promise.all([
            slotResponse.json(),
            templateResponse.json(),
            v2SlotsResponse.json()
        ]);

        customSlotNames = {};
        slotTargetCosts = {};

        // 1️⃣ 기존 meal_slot_settings에서 슬롯명 로드
        if (slotData.success && slotData.settings) {
            Object.keys(slotData.settings).forEach(key => {
                const displayName = slotData.settings[key].display_name;
                const targetCost = slotData.settings[key].target_cost || 0;
                customSlotNames[key] = displayName;
                if (targetCost > 0) {
                    slotTargetCosts[key] = targetCost;
                    if (displayName && displayName !== key) {
                        slotTargetCosts[displayName] = targetCost;
                    }
                }
            });
        }

        // 2️⃣ category_slots(v2 API)에서 목표식재료비 로드 (어드민 운영설정)
        const v2Slots = v2SlotsData.data || v2SlotsData.slots || [];
        if (v2SlotsData.success && v2Slots.length > 0) {
            v2Slots.forEach(slot => {
                const slotName = slot.slot_name;
                const targetCost = slot.target_cost || 0;
                if (slotName && targetCost > 0) {
                    slotTargetCosts[slotName] = targetCost;
                    // 슬롯명 정규화 버전도 매핑 (접미사 제거)
                    const normalizedName = normalizeSlotName(slotName);
                    if (normalizedName !== slotName) {
                        slotTargetCosts[normalizedName] = targetCost;
                    }
                }
            });
            console.log('[설정] 어드민 목표비용 로드:', v2Slots.length + '개');
        }

        console.log('[설정] 슬롯명 로드:', Object.keys(customSlotNames).length + '개, 목표비용 매핑:', Object.keys(slotTargetCosts).length + '개');

        if (templateData.success && templateData.templates) {
            mealTemplates = templateData.templates;
            // AppState에도 저장 (getModalCategoryMenuSlots에서 사용)
            if (typeof AppState !== 'undefined') {
                AppState.set('mealTemplates', mealTemplates);
            }
            console.log('[설정] 템플릿 로드:', mealTemplates.length + '개');
        }

        _slotSettingsLoadedSiteId = siteId; // 로드된 사업장 기록
        return true;
    } catch (e) {
        console.error('서버 설정 로드 실패:', e);
        try {
            const savedSlotNames = localStorage.getItem('customSlotNames');
            if (savedSlotNames) customSlotNames = JSON.parse(savedSlotNames);
        } catch (e2) {
            console.error('로컬스토리지 폴백도 실패:', e2);
        }
        return false;
    }
}

// 이전 함수명 호환성 유지
const loadCustomSettings = loadSlotAndTemplateSettings;

async function openMealInputModal(dateKey, event) {
    if (event) event.stopPropagation();

    // 🚀 모달을 먼저 표시하고 로딩 상태 표시 (UX 개선)
    const modalOverlay = document.getElementById('mealInputModalOverlay');
    const modalGrid = document.getElementById('modalMealInputGrid');
    const modalMenuList = document.getElementById('modalMenuList');

    modalSelectedDate = dateKey;
    const date = new Date(dateKey);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[date.getDay()];

    // 🔒 과거 날짜 읽기전용 체크
    isModalReadOnly = isPastDate(dateKey);
    const readOnlyBadge = isModalReadOnly ? ' <span style="background:#ff9800;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">📖 읽기전용</span>' : '';

    document.getElementById('modalDateTitle').innerHTML =
        `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${dayName}) 식단 ${isModalReadOnly ? '조회' : '편집'}${readOnlyBadge}`;

    // 🔄 모달 열 때 캐시 및 상태 초기화
    modalCategoryDataCache = {};
    modalDeletedSlotsByCategory = {};
    modalSlotOrder = [];
    modalSavedCategories = [];

    // 🚀 모달 먼저 표시 + 로딩 표시
    if (modalGrid) modalGrid.innerHTML = '<div style="text-align:center;padding:40px;color:#666;"><div class="spinner" style="margin:0 auto 10px;"></div>데이터 로딩 중...</div>';
    if (modalMenuList) modalMenuList.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">로딩 중...</div>';
    modalOverlay.classList.add('active');

    // 🔒 로딩 중 저장 버튼 비활성화 (로딩 미완료 상태에서 빈 배열 전송 방지)
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 로딩 중...'; }

    const siteId = getCurrentSiteId();
    const siteParam = siteId ? `?site_id=${siteId}` : '';

    // 🚀 병렬 API 호출로 속도 개선 (3개 API 동시 호출)
    const startTime = performance.now();

    const [slotSettingsResult, mealCountsResult, categoriesResult] = await Promise.all([
        // 1. 슬롯 설정 + 템플릿 로드 (이미 내부에서 병렬 처리)
        loadSlotAndTemplateSettings(),
        // 2. 식수 데이터 로드
        loadMealCountsForDate(dateKey, true),
        // 3. 저장된 카테고리 목록 로드
        fetch(`/api/meal-plans-categories/${dateKey}${siteParam}`).then(r => r.json()).catch(() => ({ success: false }))
    ]);

    console.log(`[모달] 병렬 API 로드 완료: ${(performance.now() - startTime).toFixed(0)}ms`);
    console.log(`[모달] 슬롯 설정: ${Object.keys(customSlotNames).length}개, 식수 데이터: ${mealCountsResult ? 'OK' : 'FAIL'}`);

    try {
    // 🏷️ 카테고리 설정 - 저장된 식단 + 식수 데이터 기반으로 자동 선택
    let selectedCategory = currentMealCategory || '전체';
    let savedCategories = [];

    if (selectedCategory === '전체') {
        // 1️⃣ 저장된 식단(meal_plans)에서 카테고리 확인
        if (categoriesResult.success && categoriesResult.categories) {
            modalSavedCategories = categoriesResult.categories;
            if (categoriesResult.categories.length > 0) {
                savedCategories = categoriesResult.categories.map(c => c.name);
                // 고정 순서로 첫 번째 카테고리 선택 (도시락 → 운반 → 학교 → 요양원)
                const categoryOrder = ['도시락', '운반', '학교', '요양원'];
                for (const cat of categoryOrder) {
                    if (savedCategories.includes(cat)) {
                        selectedCategory = cat;
                        break;
                    }
                }
                // 고정 순서에 없는 카테고리만 있으면 첫 번째 선택
                if (!selectedCategory || selectedCategory === '전체') {
                    selectedCategory = savedCategories[0];
                }
                console.log(`[모달] 고정 순서 기반 카테고리 선택: ${selectedCategory}`);
            }
        }

        // 2️⃣ 저장된 식단이 없으면 식수 데이터에서 카테고리 확인
        if (savedCategories.length === 0) {
            const dateCache = mealCountsCache[dateKey];
            if (dateCache && dateCache._byCategory) {
                const rawCategories = Object.keys(dateCache._byCategory).filter(c => c && c !== '기타');
                // 고정 순서로 정렬 (도시락 → 운반 → 학교 → 요양원)
                const categoryOrder = ['도시락', '운반', '학교', '요양원'];
                const availableCategories = categoryOrder.filter(c => rawCategories.includes(c));
                rawCategories.forEach(c => {
                    if (!availableCategories.includes(c)) availableCategories.push(c);
                });
                if (availableCategories.length >= 1) {
                    selectedCategory = availableCategories[0];
                    console.log(`[모달] 식수 데이터 기반 카테고리 선택: ${selectedCategory}`);
                } else {
                    selectedCategory = '도시락';
                }
            } else {
                selectedCategory = '도시락';
            }
        }
    }

    modalSelectedCategory = selectedCategory;
    console.log(`[모달] 최종 카테고리: ${modalSelectedCategory}`);
    syncModalCategoryTabs();

    // 📦 서버에서 해당 날짜의 식단 데이터 로드 (카테고리 필터 적용)
    try {
        const category = modalSelectedCategory !== '전체' ? modalSelectedCategory : null;
        let url = `/api/meal-plans?start_date=${dateKey}&end_date=${dateKey}`;
        if (siteId) url += `&site_id=${siteId}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.data && result.data[dateKey]) {
            modalMealData = result.data[dateKey];
            console.log(`[모달] ${dateKey} 식단 데이터 로드:`, Object.keys(modalMealData).length, '개 슬롯');
        } else {
            modalMealData = {};
        }
    } catch (e) {
        console.error('모달 데이터 로드 실패:', e);
        syncMealData();
        modalMealData = JSON.parse(JSON.stringify(mealData[dateKey] || {}));
    }

    // 🔄 초기 데이터를 현재 카테고리 캐시에 저장
    modalCategoryDataCache[modalSelectedCategory] = JSON.parse(JSON.stringify(modalMealData));

    // 📊 식수 데이터 처리 (이미 로드됨 - 캐시 사용)
    const dateCache = mealCountsCache[dateKey] || { _all: {}, _byCategory: {} };
    const categoryMealCounts = modalSelectedCategory === '전체'
        ? dateCache._all || {}
        : (dateCache._byCategory && dateCache._byCategory[modalSelectedCategory]) || {};

    const hasMealCountData = Object.keys(categoryMealCounts).length > 0;
    const hasMealPlanData = Object.keys(modalMealData || {}).length > 0;

    // 📊 meal_plans가 비어있지만 meal_counts에 데이터가 있으면, meal_counts 기반으로 슬롯 생성
    if (!hasMealPlanData && hasMealCountData) {
        Object.keys(categoryMealCounts).forEach(slotName => {
            if (!modalMealData[slotName]) {
                modalMealData[slotName] = [];
            }
        });
        modalCategoryDataCache[modalSelectedCategory] = JSON.parse(JSON.stringify(modalMealData));
    }

    // 템플릿 select 업데이트 (템플릿은 이미 loadSlotAndTemplateSettings에서 로드됨)
    updateTemplateSelect();

    // 📊 식수 데이터 없음 안내 표시/숨김
    const noMealCountsNotice = document.getElementById('noMealCountsNotice');
    if (noMealCountsNotice) {
        noMealCountsNotice.style.display = hasMealCountData ? 'none' : 'block';
    }

    // 📊 식수 관리와 비교 결과 표시
    showMealCountCompareResult(dateKey, modalSelectedCategory);

    // 슬롯 그리드 생성
    renderModalMealSlots();

    // 메뉴 목록 렌더링
    renderModalMenuList();

    } catch (e) {
        console.error('[모달] 로드 오류:', e);
    } finally {
        // 🔓 로딩 완료 후 저장 버튼 항상 활성화 (에러 발생 시도 포함)
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 저장'; }
    }

    console.log(`[모달] 전체 로드 완료: ${(performance.now() - startTime).toFixed(0)}ms`);
}


// 저장된 카테고리 정보 (모달 열 때 API에서 가져옴)
let modalSavedCategories = [];

/**
 * 📊 식수 관리와 식단 비교 결과 표시
 */
function showMealCountCompareResult(dateKey, category) {
    const compareNotice = document.getElementById('mealCountCompareNotice');
    const compareContent = document.getElementById('mealCountCompareContent');

    if (!compareNotice || !compareContent) return;

    // 식수 데이터 가져오기
    const dateCache = mealCountsCache[dateKey] || { _all: {}, _byCategory: {} };
    let mealCountSlots = {};

    if (category === '전체') {
        mealCountSlots = dateCache._all || {};
    } else {
        mealCountSlots = (dateCache._byCategory && dateCache._byCategory[category]) || {};
    }

    // 식수 > 0인 슬롯만 유효 (식수 0은 미사용 슬롯)
    const mealCountSlotNames = Object.keys(mealCountSlots).filter(s => {
        const sd = mealCountSlots[s];
        const count = (sd && typeof sd === 'object') ? (sd.count || 0) : (sd || 0);
        return count > 0;
    });

    // 식단 데이터(현재 모달에 로드된 데이터) 가져오기
    const mealPlanSlotNames = Object.keys(modalMealData || {}).filter(s =>
        modalMealData[s] && modalMealData[s].length > 0
    );

    // 비교
    const onlyInMealCount = mealCountSlotNames.filter(s => !mealPlanSlotNames.includes(s));
    const onlyInMealPlan = mealPlanSlotNames.filter(s => !mealCountSlotNames.includes(s));
    const inBoth = mealCountSlotNames.filter(s => mealPlanSlotNames.includes(s));

    // 결과 표시
    if (mealCountSlotNames.length === 0) {
        compareNotice.style.display = 'none';
        return;
    }

    let html = '';
    html += `<div style="margin-bottom: 6px;">✅ 식수 관리 슬롯: <strong>${mealCountSlotNames.length}개</strong> (${mealCountSlotNames.slice(0, 5).join(', ')}${mealCountSlotNames.length > 5 ? '...' : ''})</div>`;

    if (inBoth.length > 0) {
        html += `<div style="color: #2e7d32;">✅ 식단 등록됨: ${inBoth.length}개</div>`;
    }

    if (onlyInMealCount.length > 0) {
        html += `<div style="color: #e65100;">⚠️ 식단 미등록: ${onlyInMealCount.length}개 (${onlyInMealCount.join(', ')})</div>`;
    }

    if (onlyInMealPlan.length > 0) {
        html += `<div style="color: #c62828;">❌ 식수 없음: ${onlyInMealPlan.length}개 (${onlyInMealPlan.join(', ')})</div>`;
    }

    compareContent.innerHTML = html;
    compareNotice.style.display = 'block';

    console.log(`[비교] 식수관리: ${mealCountSlotNames.length}개, 식단: ${mealPlanSlotNames.length}개, 일치: ${inBoth.length}개`);
}

/**
 * 모달 카테고리 탭 UI 동기화 - 저장된 데이터 표시 포함
 */
function syncModalCategoryTabs() {
    const tabs = document.querySelectorAll('.modal-category-tab');
    tabs.forEach(tab => {
        const category = tab.dataset.category;

        // 활성 탭 표시
        if (category === modalSelectedCategory) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }

        // 저장된 데이터가 있는 카테고리 표시 (점 또는 배지)
        let badge = tab.querySelector('.saved-badge');
        const savedCat = modalSavedCategories.find(c => c.name === category);

        if (savedCat && savedCat.slots > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'saved-badge';
                badge.style.cssText = 'display:inline-block;width:8px;height:8px;background:#4CAF50;border-radius:50%;margin-left:4px;vertical-align:middle;';
                badge.title = `${savedCat.slots}개 슬롯 저장됨`;
                tab.appendChild(badge);
            }
        } else if (badge) {
            badge.remove();
        }
    });
}

function closeMealInputModal() {
    document.getElementById('mealInputModalOverlay').classList.remove('active');
    modalSelectedDate = null;
    modalMealData = {};
    modalCategoryDataCache = {};  // 캐시도 초기화
    modalSavedCategories = [];  // 저장된 카테고리 정보 초기화
}

// 모달 내 카테고리별 데이터 캐시 (탭 전환 시 편집 내용 유지)
let modalCategoryDataCache = {};

/**
 * 모달에서 카테고리 선택 - 편집 중인 데이터를 캐시하고 전환
 *
 * 🔧 버그 수정 (2025-12-24):
 * - 동일 카테고리 선택 시 중복 처리 방지
 * - 데이터 로드 전 명시적 초기화
 * - 상세 로깅 추가
 */
async function selectModalCategory(category) {
    const previousCategory = modalSelectedCategory;

    // ✅ 동일 카테고리 선택 시 UI만 갱신하고 종료
    if (previousCategory === category) {
        console.log(`[모달 카테고리] 동일 카테고리 "${category}" 재선택 - 스킵`);
        renderModalMealSlots();
        return;
    }

    // 🚫 '전체' 카테고리 선택 시 경고 (보기 전용)
    if (category === '전체') {
        showNotification('전체 보기는 읽기 전용입니다. 편집하려면 특정 카테고리를 선택하세요.', 'warning');
        // 선택은 허용하되 저장은 차단됨
    }

    // 현재 카테고리의 편집 내용을 캐시에 저장 (전체 제외)
    if (previousCategory && previousCategory !== '전체' && modalSelectedDate) {
        modalCategoryDataCache[previousCategory] = JSON.parse(JSON.stringify(modalMealData));
        console.log(`[모달 카테고리] "${previousCategory}" → 캐시 저장:`, Object.keys(modalMealData));
    }

    // ✅ 카테고리 전환 전 modalMealData 명시적 초기화 (데이터 혼합 방지)
    modalMealData = {};

    modalSelectedCategory = category;

    // 탭 UI 업데이트
    const tabs = document.querySelectorAll('.modal-category-tab');
    tabs.forEach(tab => {
        if (tab.dataset.category === category) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // 캐시에서 해당 카테고리 데이터 로드 (이미 편집한 적 있으면)
    if (modalCategoryDataCache[category]) {
        modalMealData = JSON.parse(JSON.stringify(modalCategoryDataCache[category]));
        console.log(`[모달 카테고리] "${category}" ← 캐시에서 로드:`, Object.keys(modalMealData));
    } else if (modalSelectedDate) {
        // 캐시에 없으면 서버에서 로드
        try {
            const siteId = getCurrentSiteId();
            let url = `/api/meal-plans?start_date=${modalSelectedDate}&end_date=${modalSelectedDate}`;
            if (siteId) url += `&site_id=${siteId}`;
            if (category !== '전체') url += `&category=${encodeURIComponent(category)}`;

            console.log(`[모달 카테고리] "${category}" ← 서버 요청:`, url);

            const response = await fetch(url);
            const result = await response.json();

            if (result.success && result.data && result.data[modalSelectedDate]) {
                modalMealData = result.data[modalSelectedDate];
                console.log(`[모달 카테고리] "${category}" ← 서버 로드 완료:`, Object.keys(modalMealData));
            } else {
                // 해당 카테고리에 데이터 없음 - 빈 슬롯으로 시작
                modalMealData = {};
                console.log(`[모달 카테고리] "${category}" - 데이터 없음, 빈 상태`);
            }
        } catch (e) {
            console.error(`[모달 카테고리] "${category}" 로드 실패:`, e);
            modalMealData = {};
        }

        // 🍽️ meal_plans가 비어있지만 meal_counts에 데이터가 있으면, meal_counts 기반으로 슬롯 생성
        // ⚠️ 카테고리별로 정확히 매칭 (다른 카테고리 데이터 섞이지 않도록)
        const dateCache = mealCountsCache[modalSelectedDate] || { _all: {}, _byCategory: {} };
        const categoryMealCounts = category === '전체'
            ? dateCache._all || {}
            : (dateCache._byCategory && dateCache._byCategory[category]) || {};

        const hasMealCountData = Object.keys(categoryMealCounts).length > 0;
        const hasMealPlanData = Object.keys(modalMealData || {}).length > 0;

        if (!hasMealPlanData && hasMealCountData) {
            console.log(`[모달 카테고리] "${category}" - meal_counts 기반 슬롯 생성:`, Object.keys(categoryMealCounts));
            Object.keys(categoryMealCounts).forEach(slotName => {
                if (!modalMealData[slotName]) {
                    modalMealData[slotName] = [];
                }
            });
        }

        // 로드한 데이터를 캐시에 저장
        modalCategoryDataCache[category] = JSON.parse(JSON.stringify(modalMealData));

        // 📊 식수 데이터 없음 안내 표시/숨김
        const noMealCountsNotice = document.getElementById('noMealCountsNotice');
        if (noMealCountsNotice) {
            noMealCountsNotice.style.display = hasMealCountData ? 'none' : 'block';
        }
    }

    // 슬롯 다시 렌더링
    renderModalMealSlots();

    console.log(`[모달 카테고리] 전환 완료: "${previousCategory}" → "${category}"`);
}

/**
 * 모달용 카테고리별 메뉴 슬롯 가져오기
 */
function getModalCategoryMenuSlots() {
    const category = modalSelectedCategory;

    // 전체일 경우 기본 슬롯 사용
    if (category === '전체') {
        return mealSlots.map(slot => ({
            slotName: slot,
            mealType: slot.replace(/[A-Z]$/, ''),
            menuName: slot,
            mealTypeShort: ''
        }));
    }

    // 저장된 템플릿에서 해당 카테고리의 메뉴 가져오기
    const templates = AppState.get('mealTemplates') || [];
    const categoryMenus = [];
    const seenMenus = new Set();

    templates.forEach(template => {
        // 🛡️ template_data가 문자열인 경우 파싱
        let templateData = template.template_data;
        if (typeof templateData === 'string') {
            try {
                templateData = JSON.parse(templateData);
            } catch (e) {
                console.warn('[템플릿] template_data 파싱 실패:', e);
                templateData = {};
            }
        }

        const mealData = templateData?.mealData || {};
        const categoryData = mealData[category] || [];

        // 배열인지 확인
        if (!Array.isArray(categoryData)) {
            console.warn(`[템플릿] ${category} 데이터가 배열이 아님:`, categoryData);
            return;
        }

        categoryData.forEach(item => {
            const menuName = item.menuName || '';
            const mealType = item.mealType || '중식';
            const order = item.order || 0;

            if (menuName && !seenMenus.has(menuName)) {
                seenMenus.add(menuName);
                categoryMenus.push({
                    slotName: menuName,
                    mealType: mealType,
                    menuName: menuName,
                    order: order,
                    mealTypeShort: getMealTypeShort(mealType)
                });
            }
        });
    });

    // order 기준 정렬
    categoryMenus.sort((a, b) => a.order - b.order);

    return categoryMenus.length > 0 ? categoryMenus : mealSlots.slice(0, 5).map(slot => ({
        slotName: slot,
        mealType: slot.replace(/[A-Z]$/, ''),
        menuName: slot,
        mealTypeShort: ''
    }));
}

function renderModalMealSlots() {
    const grid = document.getElementById('modalMealInputGrid');
    grid.innerHTML = '';

    // 🍱 카테고리별 메뉴 슬롯 가져오기
    let categorySlots = getModalCategoryMenuSlots();

    // 🗑️ 현재 카테고리의 삭제된 슬롯 필터링
    const currentCategoryDeletedSlots = modalDeletedSlotsByCategory[modalSelectedCategory] || new Set();
    categorySlots = categorySlots.filter(s => !currentCategoryDeletedSlots.has(s.slotName));
    console.log(`[renderModalMealSlots] ${modalSelectedCategory} 삭제된 슬롯:`, Array.from(currentCategoryDeletedSlots));

    // 📦 저장된 데이터에 있는 슬롯도 추가 (템플릿에 없는 슬롯 포함)
    const templateSlotNames = new Set(categorySlots.map(s => s.slotName));
    const savedSlotNames = Object.keys(modalMealData || {});

    // 저장된 데이터에서 슬롯 중 템플릿에 없는 것 추가 (빈 슬롯도 포함)
    savedSlotNames.forEach(slotName => {
        // 삭제된 슬롯은 추가하지 않음
        if (currentCategoryDeletedSlots.has(slotName)) return;

        // 템플릿에 없는 슬롯은 추가 (메뉴 유무 상관없이)
        if (!templateSlotNames.has(slotName)) {
            categorySlots.push({
                slotName: slotName,
                mealType: '',
                menuName: slotName,
                mealTypeShort: '',
                fromSavedData: true  // 저장된 데이터에서 온 슬롯 표시
            });
        }
    });

    // 📊 현재 날짜의 식수 데이터 가져오기 (카테고리 필터 적용) - 정렬보다 먼저!
    const dateCache = modalSelectedDate ? (mealCountsCache[modalSelectedDate] || { _all: {}, _byCategory: {} }) : { _all: {}, _byCategory: {} };
    let dateMealCounts = {};
    if (modalSelectedCategory === '전체') {
        dateMealCounts = dateCache._all || {};
    } else {
        dateMealCounts = (dateCache._byCategory && dateCache._byCategory[modalSelectedCategory]) || {};
    }
    console.log(`[renderModalMealSlots] 카테고리: ${modalSelectedCategory}, 식수 데이터:`, dateMealCounts);

    // 🍱 식수 데이터 기반 슬롯 추가 (템플릿보다 우선)
    const mealCountSlotNames = Object.keys(dateMealCounts);
    if (mealCountSlotNames.length > 0) {
        // 식수 데이터가 있으면 템플릿 슬롯을 모두 제거하고 식수 기반으로 교체
        const existingSlotNames = new Set(categorySlots.map(s => s.slotName));

        mealCountSlotNames.forEach(slotName => {
            // 삭제된 슬롯은 추가하지 않음
            if (currentCategoryDeletedSlots.has(slotName)) return;

            // 식수 0인 슬롯은 추가하지 않음 (사용하지 않는 슬롯)
            const slotData = dateMealCounts[slotName];
            const slotCount = (slotData && typeof slotData === 'object') ? (slotData.count || 0) : (slotData || 0);
            if (slotCount === 0) return;

            if (!existingSlotNames.has(slotName)) {
                categorySlots.push({
                    slotName: slotName,
                    mealType: slotData?.mealType || '',
                    menuName: slotName,
                    mealTypeShort: '',
                    order: typeof slotData?.menuOrder === 'number' ? slotData.menuOrder : 999,
                    fromMealCounts: true  // 식수 데이터에서 온 슬롯 표시
                });
                existingSlotNames.add(slotName);
            }
        });

        // 슬롯 필터: 실제 데이터가 있는 슬롯만 유지
        // - 식수 > 0인 슬롯, 또는 메뉴가 저장된 슬롯만 표시
        categorySlots = categorySlots.filter(slot => {
            const sd = dateMealCounts[slot.slotName];
            const count = (sd && typeof sd === 'object') ? (sd.count || 0) : (sd || 0);
            const hasMenus = modalMealData[slot.slotName]?.length > 0;
            return count > 0 || hasMenus;
        });

        console.log(`[renderModalMealSlots] 식수 데이터 기반 슬롯 추가 완료:`, categorySlots.map(s => s.slotName));
    }

    // 🔄 슬롯 순서 적용 - 식수 데이터의 menuOrder 기준
    if (modalSlotOrder.length > 0) {
        // 사용자 정의 순서가 있으면 해당 순서대로 정렬
        const slotMap = new Map(categorySlots.map(s => [s.slotName, s]));
        const orderedSlots = [];

        modalSlotOrder.forEach(slotName => {
            if (slotMap.has(slotName)) {
                orderedSlots.push(slotMap.get(slotName));
                slotMap.delete(slotName);
            }
        });

        slotMap.forEach(slot => orderedSlots.push(slot));
        categorySlots = orderedSlots;
    } else {
        // 🔧 식수 데이터의 menuOrder 순서대로 정렬
        categorySlots.sort((a, b) => {
            // 식수 데이터에서 menuOrder 가져오기
            const getMealCountOrder = (slotName) => {
                const slotData = dateMealCounts[slotName];
                if (slotData && typeof slotData === 'object') {
                    // 🐛 버그 수정: menuOrder=0도 유효한 값 (|| 연산자는 0을 falsy로 처리)
                    return typeof slotData.menuOrder === 'number' ? slotData.menuOrder : 999;
                }
                return 999;
            };

            const orderA = getMealCountOrder(a.slotName);
            const orderB = getMealCountOrder(b.slotName);

            // 1. menuOrder로 정렬
            if (orderA !== orderB) return orderA - orderB;
            // 2. 슬롯명 알파벳순 (menuOrder가 같거나 없는 경우)
            return a.slotName.localeCompare(b.slotName, 'ko');
        });
        console.log(`[renderModalMealSlots] 식수 menuOrder 기준 정렬:`, categorySlots.map(s => {
            const data = dateMealCounts[s.slotName];
            const order = data && typeof data.menuOrder === 'number' ? data.menuOrder : 'N/A';
            return `${s.slotName}(${order})`;
        }).join(', '));
    }

    categorySlots.forEach((slotInfo, index) => {
        const slotName = slotInfo.slotName;
        const mealTypeShort = slotInfo.mealTypeShort || '';
        const displayName = customSlotNames[slotName] || slotName;
        const menus = modalMealData[slotName] || [];
        const slotCost = menus.reduce((sum, m) => sum + (m.currentPrice || 0), 0);
        const targetCost = slotTargetCosts[slotName] || 0;
        const hasMenu = menus.length > 0;

        // 🍽️ 해당 슬롯의 식수 가져오기 (슬롯명으로 매칭, 객체 구조 지원)
        const slotData = dateMealCounts[slotName] || dateMealCounts[displayName];
        const slotMealCount = (slotData && typeof slotData === 'object') ? (slotData.count || 0) : (slotData || 0);

        // 식수에 따른 색상 구분 (가독성 향상)
        let mealCountBadge = '';
        if (slotMealCount > 0) {
            let bgColor, textColor;
            if (slotMealCount >= 100) {
                bgColor = '#ffebee'; textColor = '#c62828';  // 빨간색 (100식 이상)
            } else if (slotMealCount >= 50) {
                bgColor = '#fff3e0'; textColor = '#e65100';  // 주황색 (50~99식)
            } else {
                bgColor = '#e8f5e9'; textColor = '#2e7d32';  // 초록색 (50식 미만)
            }
            const formattedCount = slotMealCount.toLocaleString();
            mealCountBadge = `<span class="meal-count-badge" style="
                background: ${bgColor};
                color: ${textColor};
                padding: 3px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 700;
                margin-left: 8px;
                border: 1px solid ${textColor}20;
                display: inline-flex;
                align-items: center;
                gap: 3px;
            ">👥 ${formattedCount}</span>`;
        }

        // 목표 재료비 차이 표시 (목표 - 실제)
        let targetCostDisplay = '';
        if (targetCost > 0 && slotCost > 0) {
            const diff = targetCost - slotCost;
            const diffAbs = Math.abs(diff);
            const diffText = diffAbs >= 1000 ? `${(diffAbs / 1000).toFixed(1)}천` : `${diffAbs}`;
            if (diff > 0) {
                // 목표보다 적게 사용 (여유 있음) - 빨간색
                targetCostDisplay = `<span style="color: #dc3545; font-size: 12px; font-weight: 700; margin-left: 4px;">(+${diffText}원)</span>`;
            } else if (diff < 0) {
                // 목표 초과 - 파란색
                targetCostDisplay = `<span style="color: #2563eb; font-size: 12px; font-weight: 700; margin-left: 4px;">(-${diffText}원)</span>`;
            } else {
                // 정확히 목표 금액
                targetCostDisplay = `<span style="color: #6b7280; font-size: 12px; font-weight: 500; margin-left: 4px;">(±0)</span>`;
            }
        }
        // 메뉴가 없을 때는 아무것도 표시하지 않음

        // 슬롯 이름에 끼니 유형 + 목표재료비 표시 (카테고리 모드일 때)
        const displayLabel = mealTypeShort && modalSelectedCategory !== '전체'
            ? `<span class="meal-type-badge">${mealTypeShort}</span> ${displayName}${targetCostDisplay}${mealCountBadge}`
            : `${displayName}${targetCostDisplay}${mealCountBadge}`;

        const slotDiv = document.createElement('div');
        slotDiv.className = `modal-meal-slot ${hasMenu ? 'has-menu' : ''}`;
        slotDiv.dataset.slotName = slotName;
        slotDiv.dataset.slotIndex = index;

        // 🔒 읽기전용 모드에서는 편집 UI 숨김
        const dragHandle = isModalReadOnly ? '' : `<span class="slot-drag-handle" draggable="true"
                      ondragstart="handleSlotDragStart(event, '${slotName}')"
                      ondragend="handleSlotDragEnd(event)"
                      title="드래그하여 순서 변경" style="
                    cursor: grab;
                    padding: 4px 6px;
                    color: #adb5bd;
                    font-size: 14px;
                    user-select: none;
                    display: flex;
                    align-items: center;
                ">☰</span>`;

        const slotNameClick = isModalReadOnly ? '' : `onclick="editSlotName('${slotName}', this)" title="클릭하여 이름 변경"`;

        slotDiv.innerHTML = `
            <div class="modal-meal-name">
                ${dragHandle}
                <span class="modal-meal-name-editable" ${slotNameClick}>${displayLabel}</span>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; flex-shrink: 0;">
                    ${hasMenu ? `<button class="slot-copy-btn" onclick="openSlotCopyModal('${slotName}')" title="이 슬롯 복사" style="
                        background: #4a90d9;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        padding: 3px 8px;
                        font-size: 10px;
                        cursor: pointer;
                        white-space: nowrap;
                    ">복사</button>` : ''}
                    ${slotCost > 0 ? (() => {
                let costColor = '#666';
                let costTitle = '';
                if (targetCost > 0) {
                    if (slotCost > targetCost) {
                        costColor = '#dc3545';
                        costTitle = '목표 초과';
                    } else if (slotCost <= targetCost * 0.9) {
                        costColor = '#28a745';
                        costTitle = '목표 이하';
                    } else {
                        costColor = '#17a2b8';
                        costTitle = '목표 근접';
                    }
                }
                const targetText = targetCost > 0 ? ` <span style="font-size:10px;color:#999;">(목표:${targetCost.toLocaleString()})</span>` : '';
                return `<span class="modal-meal-cost" style="white-space: nowrap; color: ${costColor};" title="${costTitle}">${slotCost.toLocaleString()}원${targetText}</span>`;
            })() : (targetCost > 0 ? `<span style="font-size:11px;color:#999;white-space:nowrap;">(목표:${targetCost.toLocaleString()}원)</span>` : '')}
                </div>
            </div>
            <div class="modal-selected-menus" data-slot="${slotName}">
                ${menus.map((menu, menuIndex) => {
                const price = menu.currentPrice || 0;
                const priceText = price > 0 ? price.toLocaleString() + '원' : '단가미정';
                const priceClass = price > 0 ? 'modal-menu-price' : 'modal-menu-price no-price';
                // 🔒 읽기전용 모드에서는 드래그/편집 버튼 숨김
                const menuDraggable = isModalReadOnly ? 'draggable="false"' : `draggable="true" ondragstart="handleSlotMenuDragStart(event, '${slotName}', ${menuIndex})" title="다른 슬롯으로 드래그하여 복사"`;
                const menuDragHandle = isModalReadOnly ? '' : `<span class="menu-drag-handle" title="드래그하여 다른 슬롯에 복사">⋮</span>`;
                const menuOrderBtns = '';
                const menuRemoveBtn = isModalReadOnly ? '' : `<button class="modal-menu-remove" onclick="removeModalMenu('${slotName}', ${menuIndex})">×</button>`;
                return `
                    <div class="modal-selected-menu" data-menu-id="${menu.id}" data-slot="${slotName}" data-index="${menuIndex}" ${menuDraggable}>
                        ${menuDragHandle}
                        <div class="modal-menu-info">
                            <span title="${menu.name}" onclick="event.stopPropagation(); openMenuIngredientModal(${menu.id}, '${menu.name.replace(/'/g, "\'")}')" style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted;">${menu.name}</span>
                            <span class="${priceClass}">${priceText}</span>
                        </div>
                        ${menuOrderBtns}
                        ${menuRemoveBtn}
                    </div>
                `}).join('')}
            </div>
        `;

        // 드롭 이벤트 (메뉴 라이브러리 + 슬롯 간 복사 + 슬롯 순서 변경 지원)
        slotDiv.addEventListener('dragover', (e) => {
            e.preventDefault();

            // 슬롯 드래그 중이면 슬롯 위치 표시
            if (draggedSlotName && draggedSlotName !== slotName) {
                slotDiv.classList.add('slot-drag-over');
            } else {
                slotDiv.classList.add('drag-over');
            }
        });

        slotDiv.addEventListener('dragleave', () => {
            slotDiv.classList.remove('drag-over');
            slotDiv.classList.remove('slot-drag-over');
        });

        slotDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            slotDiv.classList.remove('drag-over');
            slotDiv.classList.remove('slot-drag-over');

            // 🔄 슬롯 순서 변경인지 확인
            const draggedSlot = e.dataTransfer.getData('draggedSlot');
            if (draggedSlot && draggedSlot !== slotName) {
                reorderSlots(draggedSlot, slotName);
                return;
            }

            // 슬롯 간 복사인지 확인
            const sourceSlot = e.dataTransfer.getData('sourceSlot');
            const sourceIndex = e.dataTransfer.getData('sourceIndex');

            if (sourceSlot && sourceIndex !== '') {
                // 🔄 슬롯 간 메뉴 복사
                copyMenuBetweenSlots(sourceSlot, parseInt(sourceIndex), slotName);
            } else {
                // 📚 메뉴 라이브러리에서 추가
                const menuId = e.dataTransfer.getData('text/plain');
                if (menuId) {
                    addMenuToModalSlot(slotName, parseInt(menuId));
                }
            }
        });

        grid.appendChild(slotDiv);
    });

    // ➕ 슬롯 추가 버튼 (읽기전용이 아닐 때만 표시)
    if (!isModalReadOnly) {
        const addSlotBtn = document.createElement('div');
        addSlotBtn.className = 'modal-meal-slot add-slot-btn';
        addSlotBtn.style.cssText = 'border: 2px dashed #cbd5e0; background: #f8fafc; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80px; transition: all 0.2s;';
        addSlotBtn.innerHTML = `
            <span style="font-size: 24px; color: #a0aec0;">➕</span>
            <span style="font-size: 12px; color: #718096; margin-top: 4px;">새 슬롯 추가</span>
        `;
        addSlotBtn.onclick = () => openAddSlotModal();
        addSlotBtn.onmouseover = () => { addSlotBtn.style.borderColor = '#667eea'; addSlotBtn.style.background = '#eef2ff'; };
        addSlotBtn.onmouseout = () => { addSlotBtn.style.borderColor = '#cbd5e0'; addSlotBtn.style.background = '#f8fafc'; };
        grid.appendChild(addSlotBtn);
    }
}

/**
 * 🆕 슬롯 추가 모달 열기
 */
function openAddSlotModal() {
    // 🔒 읽기전용 모드에서는 추가 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }

    // 카테고리 확인 (전체 선택 시 경고)
    if (modalSelectedCategory === '전체') {
        showNotification('특정 카테고리를 선택한 후 슬롯을 추가해주세요.', 'warning');
        return;
    }

    // 모달 초기화
    document.getElementById('newSlotName').value = '';
    document.getElementById('newSlotTargetCost').value = '';
    document.querySelector('input[name="newSlotMealType"][value="중식"]').checked = true;
    document.getElementById('newSlotCategoryDisplay').textContent = modalSelectedCategory;

    // 모달 표시
    document.getElementById('addSlotModalOverlay').style.display = 'flex';
    document.getElementById('newSlotName').focus();
}

/**
 * 🆕 슬롯 추가 모달 닫기
 */
function closeAddSlotModal() {
    document.getElementById('addSlotModalOverlay').style.display = 'none';
}

/**
 * 🆕 새 슬롯 생성 (category_slots + meal_count_sites 테이블에 저장)
 * 슬롯과 사업장을 함께 생성하여 식수관리와 양방향 동기화
 */
async function createNewSlotFromModal() {
    const slotName = document.getElementById('newSlotName').value.trim();
    const mealType = document.querySelector('input[name="newSlotMealType"]:checked')?.value;
    const targetCost = parseInt(document.getElementById('newSlotTargetCost').value) || 0;

    // 유효성 검사
    if (!slotName) {
        showNotification('슬롯명을 입력해주세요.', 'warning');
        document.getElementById('newSlotName').focus();
        return;
    }

    if (!mealType) {
        showNotification('끼니 타입을 선택해주세요.', 'warning');
        return;
    }

    // 이미 존재하는 슬롯인지 확인 (모달 내)
    if (modalMealData[slotName]) {
        showNotification('이미 존재하는 슬롯 이름입니다.', 'warning');
        return;
    }

    // 카테고리 ID 가져오기
    const categoryId = await getCategoryIdByName(modalSelectedCategory);
    if (!categoryId) {
        showNotification(`'${modalSelectedCategory}' 카테고리를 찾을 수 없습니다.`, 'error');
        return;
    }

    try {
        // 1단계: 슬롯 생성 (category_slots)
        const slotResponse = await fetch('/api/v2/slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category_id: categoryId,
                slot_name: slotName,
                meal_type: mealType,
                target_cost: targetCost || null
            })
        });

        const slotResult = await slotResponse.json();

        if (!slotResult.success) {
            showNotification(slotResult.error || '슬롯 생성에 실패했습니다.', 'error');
            return;
        }

        const slotId = slotResult.id;
        console.log(`[슬롯 생성] ${slotName} (${mealType}, 카테고리: ${modalSelectedCategory}, ID: ${slotId})`);

        // 2단계: 사업장 생성 (meal_count_sites) - 슬롯명과 동일한 이름으로
        const clientResponse = await fetch('/api/v2/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot_id: slotId,
                client_name: slotName,  // 슬롯명과 동일
                meal_type: mealType,
                operating_days: {
                    mon: true, tue: true, wed: true, thu: true, fri: true,
                    sat: false, sun: false  // 기본: 월~금 운영
                }
            })
        });

        const clientResult = await clientResponse.json();

        if (clientResult.success) {
            console.log(`[사업장 생성] ${slotName} (client_id: ${clientResult.id})`);
        } else {
            console.warn(`[사업장 생성 실패] ${clientResult.error} - 슬롯은 생성됨`);
        }

        // 모달 데이터에 빈 슬롯 추가
        modalMealData[slotName] = [];

        // 슬롯 설정 캐시에도 추가
        if (!customSlotNames[slotName]) {
            customSlotNames[slotName] = slotName;
        }

        // 모달 닫기 및 슬롯 목록 새로고침
        closeAddSlotModal();
        renderModalMealSlots();

        showNotification(`'${slotName}' 슬롯과 사업장이 생성되었습니다. (${mealType})`, 'success');
    } catch (error) {
        console.error('[슬롯/사업장 생성] API 오류:', error);
        showNotification('서버 오류가 발생했습니다.', 'error');
    }
}

/**
 * 카테고리 이름으로 ID 가져오기 (현재 사업장의 group_id 고려)
 */
async function getCategoryIdByName(categoryName) {
    try {
        const response = await fetch('/api/v2/categories');
        const result = await response.json();

        if (result.success && result.data) {
            // 현재 선택된 사업장의 group_id 가져오기
            const currentGroupId = getCurrentSiteGroupId();

            // group_id가 일치하는 카테고리 우선 검색
            if (currentGroupId) {
                const matchingCategory = result.data.find(
                    c => c.category_name === categoryName && c.group_id === currentGroupId
                );
                if (matchingCategory) {
                    console.log(`[카테고리 조회] ${categoryName} → ID: ${matchingCategory.id} (group_id: ${currentGroupId})`);
                    return matchingCategory.id;
                }
            }

            // group_id 매칭 실패 시 이름만으로 검색 (fallback)
            const category = result.data.find(c => c.category_name === categoryName);
            if (category) {
                console.log(`[카테고리 조회] ${categoryName} → ID: ${category.id} (fallback, group_id: ${category.group_id})`);
            }
            return category ? category.id : null;
        }
        return null;
    } catch (error) {
        console.error('[카테고리 조회] 오류:', error);
        return null;
    }
}

/**
 * 현재 선택된 사업장의 group_id 가져오기
 */
function getCurrentSiteGroupId() {
    // SiteSelector에서 현재 컨텍스트 가져오기
    if (typeof SiteSelector !== 'undefined' && SiteSelector.getCurrentContext) {
        const context = SiteSelector.getCurrentContext();
        if (context?.group_id) {
            console.log(`[getCurrentSiteGroupId] SiteSelector context: group_id=${context.group_id}`);
            return context.group_id;
        }
    }
    // AppState에서 가져오기
    if (typeof AppState !== 'undefined') {
        const groupId = AppState.get?.('currentGroupId') || AppState.currentGroupId;
        if (groupId) {
            console.log(`[getCurrentSiteGroupId] AppState: group_id=${groupId}`);
            return groupId;
        }
    }
    console.log(`[getCurrentSiteGroupId] group_id를 찾을 수 없음`);
    return null;
}

/**
 * [DEPRECATED] 새 슬롯 추가 안내 메시지 표시 - openAddSlotModal 사용
 */
function showAddSlotDialog() {
    openAddSlotModal();
}

/**
 * 모달에 새 슬롯 추가
 */
function addNewSlotToModal(slotName) {
    // 🔒 읽기전용 모드에서는 추가 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }
    // 이미 존재하는지 확인
    if (modalMealData[slotName]) {
        showNotification('이미 존재하는 슬롯 이름입니다.', 'warning');
        return;
    }

    // 빈 슬롯 추가
    modalMealData[slotName] = [];

    // customSlotNames에도 추가 (다음 렌더링에서 표시되도록)
    if (!customSlotNames[slotName]) {
        customSlotNames[slotName] = slotName;
    }

    // 모달 다시 렌더링
    renderModalMealSlots();

    showNotification(`'${slotName}' 슬롯이 추가되었습니다.`, 'success');
    console.log(`[모달] 새 슬롯 추가: ${slotName}`);
}

/**
 * 모달에서 슬롯 삭제
 */
function deleteSlotFromModal(slotName) {
    // 🔒 읽기전용 모드에서는 삭제 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }
    const menus = modalMealData[slotName] || [];
    const menuCount = menus.length;

    // 메뉴가 있으면 확인
    if (menuCount > 0) {
        if (!confirm(`'${slotName}' 슬롯에 ${menuCount}개의 메뉴가 있습니다.\n정말 삭제하시겠습니까?`)) {
            return;
        }
    } else {
        if (!confirm(`'${slotName}' 슬롯을 삭제하시겠습니까?`)) {
            return;
        }
    }

    // modalMealData에서 삭제
    delete modalMealData[slotName];

    // customSlotNames에서도 삭제
    if (customSlotNames[slotName]) {
        delete customSlotNames[slotName];
    }

    // 삭제된 슬롯 기록 (다시 생성되지 않도록) - 현재 카테고리에만 적용
    if (!modalDeletedSlotsByCategory[modalSelectedCategory]) {
        modalDeletedSlotsByCategory[modalSelectedCategory] = new Set();
    }
    modalDeletedSlotsByCategory[modalSelectedCategory].add(slotName);
    console.log(`[슬롯 삭제] ${modalSelectedCategory} 카테고리의 '${slotName}' 삭제됨`);

    // 슬롯 순서에서도 제거
    const orderIndex = modalSlotOrder.indexOf(slotName);
    if (orderIndex > -1) {
        modalSlotOrder.splice(orderIndex, 1);
    }

    // 모달 다시 렌더링
    renderModalMealSlots();

    showNotification(`'${slotName}' 슬롯이 삭제되었습니다.`, 'info');
    console.log(`[모달] 슬롯 삭제: ${slotName}`);
}

/**
 * 🔄 슬롯 드래그 시작 핸들러
 */
function handleSlotDragStart(event, slotName) {
    draggedSlotName = slotName;
    event.dataTransfer.setData('draggedSlot', slotName);
    event.dataTransfer.effectAllowed = 'move';

    // 드래그 중인 슬롯 스타일
    const slotDiv = event.target.closest('.modal-meal-slot');
    if (slotDiv) {
        slotDiv.classList.add('slot-dragging');
    }

    console.log('[슬롯 드래그] 시작:', slotName);
}

/**
 * 🔄 슬롯 드래그 종료 핸들러
 */
function handleSlotDragEnd(event) {
    draggedSlotName = null;

    // 모든 드래그 스타일 제거
    document.querySelectorAll('.modal-meal-slot').forEach(slot => {
        slot.classList.remove('slot-dragging', 'slot-drag-over');
    });
}

/**
 * 🔄 슬롯 순서 변경
 */
function reorderSlots(draggedSlot, targetSlot) {
    // 현재 슬롯 순서 가져오기
    const categorySlots = getModalCategoryMenuSlots();
    const allSlotNames = categorySlots.map(s => s.slotName);

    // 저장된 데이터의 슬롯도 추가
    Object.keys(modalMealData || {}).forEach(slotName => {
        if (!allSlotNames.includes(slotName) && modalMealData[slotName]?.length > 0) {
            allSlotNames.push(slotName);
        }
    });

    // 기존 순서가 있으면 사용, 없으면 기본 순서 사용
    let currentOrder = modalSlotOrder.length > 0 ? [...modalSlotOrder] : [...allSlotNames];

    // 새 슬롯이 있으면 추가
    allSlotNames.forEach(name => {
        if (!currentOrder.includes(name)) {
            currentOrder.push(name);
        }
    });

    // 드래그한 슬롯을 타겟 슬롯 위치로 이동
    const draggedIndex = currentOrder.indexOf(draggedSlot);
    const targetIndex = currentOrder.indexOf(targetSlot);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // 드래그한 슬롯 제거
    currentOrder.splice(draggedIndex, 1);

    // 타겟 위치에 삽입
    currentOrder.splice(targetIndex, 0, draggedSlot);

    // 순서 저장
    modalSlotOrder = currentOrder;

    console.log('[슬롯 순서 변경]', draggedSlot, '->', targetSlot, '새 순서:', modalSlotOrder);

    // 다시 렌더링
    renderModalMealSlots();

    showNotification('슬롯 순서가 변경되었습니다.', 'success');
}

// 전역 함수 등록
window.showAddSlotDialog = showAddSlotDialog;
window.addNewSlotToModal = addNewSlotToModal;
window.deleteSlotFromModal = deleteSlotFromModal;
window.openAddSlotModal = openAddSlotModal;
window.closeAddSlotModal = closeAddSlotModal;
window.createNewSlotFromModal = createNewSlotFromModal;
window.selectModalCategory = selectModalCategory;
window.handleSlotDragStart = handleSlotDragStart;
window.handleSlotDragEnd = handleSlotDragEnd;
window.reorderSlots = reorderSlots;

/**
 * 🔄 슬롯 내 메뉴 드래그 시작 핸들러
 */
function handleSlotMenuDragStart(event, slotName, menuIndex) {
    event.dataTransfer.setData('sourceSlot', slotName);
    event.dataTransfer.setData('sourceIndex', menuIndex.toString());
    event.dataTransfer.effectAllowed = 'copy';

    // 드래그 중인 요소 스타일
    event.target.style.opacity = '0.5';
    setTimeout(() => {
        event.target.style.opacity = '1';
    }, 0);

    console.log(`[드래그] 슬롯 "${slotName}"의 ${menuIndex}번 메뉴 드래그 시작`);
}

/**
 * 🔄 슬롯 간 메뉴 복사
 */
function copyMenuBetweenSlots(sourceSlot, sourceIndex, targetSlot) {
    // 같은 슬롯이면 무시
    if (sourceSlot === targetSlot) {
        console.log('[복사] 같은 슬롯으로는 복사할 수 없습니다.');
        return;
    }

    // 원본 메뉴 가져오기
    const sourceMenus = modalMealData[sourceSlot] || [];
    if (sourceIndex >= sourceMenus.length) {
        console.warn('[복사] 원본 메뉴를 찾을 수 없습니다.');
        return;
    }

    const menuToCopy = sourceMenus[sourceIndex];

    // 대상 슬롯에 복사 (깊은 복사)
    if (!modalMealData[targetSlot]) {
        modalMealData[targetSlot] = [];
    }

    const copiedMenu = JSON.parse(JSON.stringify(menuToCopy));
    modalMealData[targetSlot].push(copiedMenu);

    // 화면 갱신
    renderModalMealSlots();

    showNotification(`"${menuToCopy.name}"이(가) "${targetSlot}"에 복사되었습니다.`, 'success');
    console.log(`[복사] "${sourceSlot}" → "${targetSlot}": ${menuToCopy.name}`);
}

// 전역 함수 등록
window.handleSlotMenuDragStart = handleSlotMenuDragStart;
window.copyMenuBetweenSlots = copyMenuBetweenSlots;

// 슬롯명 편집 함수 - admin에서만 가능하도록 안내
function editSlotName(slotName, element) {
    // 🔒 슬롯명 변경은 admin에서만 가능
    customAlert('슬롯명(끼니 구분)을 변경하려면\nAdmin → 운영설정 → 사업장 배치 및 목표 설정에서\n변경해 주세요.', 'info');
}

async function saveSlotName(slotName, newName, originalElement) {
    newName = newName.trim();
    const siteId = getCurrentSiteId();

    if (newName && newName !== slotName) {
        customSlotNames[slotName] = newName;

        // 서버에 저장
        try {
            const response = await fetch('/api/meal-slot-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    settings: {
                        [slotName]: { display_name: newName, sort_order: 0, is_active: true }
                    },
                    site_id: siteId
                })
            });
            const result = await response.json();
            if (result.success) {
                showNotification(`슬롯명이 "${newName}"으로 변경되었습니다.`, 'success');
            } else {
                console.error('슬롯명 저장 실패:', result.error);
                showNotification('슬롯명 저장 실패: ' + result.error, 'error');
            }
        } catch (e) {
            console.error('슬롯명 저장 오류:', e);
            // 폴백: 로컬스토리지에 저장
            localStorage.setItem('customSlotNames', JSON.stringify(customSlotNames));
            showNotification(`슬롯명이 "${newName}"으로 변경되었습니다. (로컬 저장)`, 'success');
        }
    } else if (!newName) {
        delete customSlotNames[slotName];
        // 서버에서도 비활성화
        try {
            await fetch('/api/meal-slot-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    settings: {
                        [slotName]: { display_name: slotName, sort_order: 0, is_active: false }
                    },
                    site_id: siteId
                })
            });
        } catch (e) {
            console.error('슬롯명 초기화 오류:', e);
        }
    }
    renderModalMealSlots();
}

function renderModalMenuList(searchTerm = '') {
    const list = document.getElementById('modalMenuList');
    const allMenus = AppState.get('allMenus') || [];

    let filteredMenus = allMenus;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredMenus = allMenus.filter(m =>
            m.name.toLowerCase().includes(term) ||
            (m.category && m.category.toLowerCase().includes(term))
        );
    }

    // 카테고리별 기본 이모지 아이콘
    const categoryIcons = {
        '국': '🍲', '찌개': '🍲', '국/찌개': '🍲',
        '밥': '🍚', '밥류': '🍚',
        '주찬': '🍖', '고기': '🍖',
        '부찬': '🥗', '반찬': '🥗',
        '디저트': '🍰', '후식': '🍰',
        '샐러드': '🥬',
        '면': '🍜', '면류': '🍜',
        '볶음': '🍳',
        '구이': '🥩',
        '튀김': '🍤',
        '미분류': '🍽️'
    };

    list.innerHTML = filteredMenus.slice(0, 50).map(menu => {
        const icon = categoryIcons[menu.category] || '🍽️';
        const imageUrl = menu.image_url || menu.photo_path || null;
        const priceText = menu.currentPrice > 0 ? menu.currentPrice.toLocaleString() + '원' : '단가미정';
        const priceClass = menu.currentPrice > 0 ? 'modal-menu-item-price' : 'modal-menu-item-price no-price';

        // 🚚 발주불가 또는 거래중단 협력업체 경고 배지
        let warningBadge = '';
        let warningStyle = '';
        if (menu.has_unavailable_supplier) {
            warningBadge = `<span class="supplier-warning-badge" title="발주불가: ${menu.unavailable_supplier_names}" style="background: #dc3545; color: white; font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">⚠️발주불가</span>`;
            warningStyle = 'border-left: 3px solid #dc3545;';
        } else if (menu.has_inactive_supplier) {
            warningBadge = `<span class="supplier-warning-badge" title="거래중단: ${menu.inactive_supplier_names}" style="background: #ffc107; color: #333; font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">⚠️거래중단</span>`;
            warningStyle = 'border-left: 3px solid #ffc107;';
        }

        return `
            <div class="modal-menu-item" draggable="true" data-menu-id="${menu.id}"
                 ondragstart="handleModalMenuDragStart(event, ${menu.id})" style="${warningStyle}">
                <div class="modal-menu-item-image">
                    ${imageUrl
                ? `<img src="${imageUrl}" alt="${menu.name}" onerror="this.parentElement.innerHTML='${icon}'">`
                : icon
            }
                </div>
                <div class="modal-menu-item-content">
                    <span class="modal-menu-item-name" title="${menu.name}">${menu.name}${warningBadge}</span>
                    <span class="${priceClass}">${priceText}</span>
                </div>
            </div>
        `;
    }).join('');
}

function handleModalMenuDragStart(e, menuId) {
    e.dataTransfer.setData('text/plain', menuId);
    e.target.classList.add('dragging');
    setTimeout(() => e.target.classList.remove('dragging'), 0);
}

function addMenuToModalSlot(slotName, menuId) {
    // 🔒 읽기전용 모드에서는 추가 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }
    const menu = getMenuById(menuId);
    if (!menu) return;

    if (!modalMealData[slotName]) {
        modalMealData[slotName] = [];
    }

    // 중복 체크
    if (modalMealData[slotName].some(m => m.id === menuId)) {
        showNotification('이미 추가된 메뉴입니다.', 'warning');
        return;
    }

    modalMealData[slotName].push({ ...menu });
    renderModalMealSlots();
    showNotification(`${menu.name}이(가) ${slotName}에 추가되었습니다.`, 'success');
}

function removeModalMenu(slotName, menuIndex) {
    // 🔒 읽기전용 모드에서는 삭제 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }
    if (modalMealData[slotName] && modalMealData[slotName][menuIndex]) {
        const removedMenu = modalMealData[slotName].splice(menuIndex, 1)[0];
        renderModalMealSlots();
        showNotification(`${removedMenu.name}이(가) 삭제되었습니다.`, 'info');
    }
}

// 메뉴 순서 이동 함수 (버튼 클릭)
function moveMenuInSlot(slotName, menuIndex, direction) {
    // 🔒 읽기전용 모드에서는 이동 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }
    const menus = modalMealData[slotName];
    if (!menus || menus.length < 2) return;

    const newIndex = menuIndex + direction;
    if (newIndex < 0 || newIndex >= menus.length) return;

    // 배열에서 위치 교환
    [menus[menuIndex], menus[newIndex]] = [menus[newIndex], menus[menuIndex]];

    renderModalMealSlots();
}

// 드래그 앤 드롭으로 메뉴 순서 변경
let draggedMenuInfo = null;

function initMenuDragEvents() {
    document.addEventListener('dragstart', (e) => {
        const menuItem = e.target.closest('.modal-selected-menu');
        if (menuItem && menuItem.draggable) {
            draggedMenuInfo = {
                slot: menuItem.dataset.slot,
                index: parseInt(menuItem.dataset.index)
            };
            menuItem.classList.add('dragging-menu');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'menu-reorder');
        }
    });

    document.addEventListener('dragend', (e) => {
        const menuItem = e.target.closest('.modal-selected-menu');
        if (menuItem) {
            menuItem.classList.remove('dragging-menu');
        }
        draggedMenuInfo = null;
        // 모든 드래그 오버 표시 제거
        document.querySelectorAll('.drag-over-menu').forEach(el => el.classList.remove('drag-over-menu'));
    });

    document.addEventListener('dragover', (e) => {
        if (!draggedMenuInfo) return;

        const targetMenu = e.target.closest('.modal-selected-menu');
        if (targetMenu && targetMenu.dataset.slot === draggedMenuInfo.slot) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            // 드래그 오버 표시
            document.querySelectorAll('.drag-over-menu').forEach(el => el.classList.remove('drag-over-menu'));
            targetMenu.classList.add('drag-over-menu');
        }
    });

    document.addEventListener('drop', (e) => {
        if (!draggedMenuInfo) return;

        const targetMenu = e.target.closest('.modal-selected-menu');
        if (targetMenu && targetMenu.dataset.slot === draggedMenuInfo.slot) {
            e.preventDefault();

            const targetIndex = parseInt(targetMenu.dataset.index);
            const sourceIndex = draggedMenuInfo.index;
            const slotName = draggedMenuInfo.slot;

            if (sourceIndex !== targetIndex) {
                const menus = modalMealData[slotName];
                const [movedMenu] = menus.splice(sourceIndex, 1);
                menus.splice(targetIndex, 0, movedMenu);
                renderModalMealSlots();
            }
        }

        draggedMenuInfo = null;
        document.querySelectorAll('.drag-over-menu').forEach(el => el.classList.remove('drag-over-menu'));
    });
}

// 페이지 로드 시 드래그 이벤트 초기화
initMenuDragEvents();

async function saveMealInputModal() {
    if (!modalSelectedDate) return;

    // 🔒 읽기전용 모드에서는 저장 불가
    if (isModalReadOnly) {
        showNotification('과거 날짜의 데이터는 수정할 수 없습니다.', 'warning');
        return;
    }

    const siteId = getCurrentSiteId();

    // ★ 보안: site_id 필수 검증 (데이터 혼용 방지)
    if (!siteId) {
        showNotification('사업장을 선택해주세요. 사업장 없이 저장할 수 없습니다.', 'error');
        console.error('[저장 오류] site_id 없음 - 사업장 선택 필요');
        return;
    }

    // 🚫 '전체' 카테고리에서는 저장 불가 - 명확한 카테고리 필요
    if (modalSelectedCategory === '전체') {
        showNotification('전체 보기에서는 저장할 수 없습니다. 특정 카테고리(도시락/학교/요양원 등)를 선택하세요.', 'warning');
        return;
    }

    // 📦 현재 탭의 데이터를 캐시에 저장 (편집 내용 보존)
    modalCategoryDataCache[modalSelectedCategory] = JSON.parse(JSON.stringify(modalMealData));
    console.log(`[저장 준비] 현재 카테고리: ${modalSelectedCategory}`);
    console.log(`[저장 준비] modalMealData 슬롯:`, Object.keys(modalMealData));
    console.log(`[저장 준비] 삭제된 슬롯:`, modalDeletedSlotsByCategory);

    // 🔍 편집된 카테고리 목록 확인 (전체 제외)
    const categoriesToSave = Object.keys(modalCategoryDataCache).filter(cat => cat !== '전체' && cat);
    console.log('[저장] 저장할 카테고리 목록:', categoriesToSave);
    console.log('[저장] 캐시 상태:', JSON.stringify(Object.keys(modalCategoryDataCache).reduce((acc, k) => {
        acc[k] = Object.keys(modalCategoryDataCache[k] || {});
        return acc;
    }, {})));

    if (categoriesToSave.length === 0) {
        showNotification('저장할 데이터가 없습니다.', 'warning');
        return;
    }

    // 💾 모든 편집된 카테고리 데이터를 각각 저장 (실패 시 자동 재시도)
    const MAX_RETRIES = 2;
    let totalSaved = 0;
    let errors = [];
    let failedCategories = [];

    for (const category of categoriesToSave) {
        const categoryData = modalCategoryDataCache[category];
        // 🗑️ 해당 카테고리의 삭제된 슬롯만 가져오기
        const categoryDeletedSlots = modalDeletedSlotsByCategory[category]
            ? Array.from(modalDeletedSlotsByCategory[category])
            : [];

        // 빈 데이터는 건너뛰기 (단, 삭제된 슬롯이 있으면 처리)
        if (Object.keys(categoryData).length === 0 && categoryDeletedSlots.length === 0) {
            console.log(`[저장] ${category} - 데이터 없음, 건너뜀`);
            continue;
        }

        // ★ 낙관적 잠금: 해당 날짜의 타임스탬프 가져오기
        const expectedTimestamps = mealTimestamps[modalSelectedDate] || {};
        const requestBody = {
            plan_date: modalSelectedDate,
            meal_data: categoryData,
            site_id: siteId,
            category: category,
            deleted_slots: categoryDeletedSlots,
            expected_timestamps: expectedTimestamps
        };
        const expectedSlots = Object.keys(categoryData).length;

        console.log(`[저장 요청] ${category}:`, JSON.stringify({
            plan_date: modalSelectedDate,
            category: category,
            slots: Object.keys(categoryData),
            deleted_slots: categoryDeletedSlots
        }));

        // ★ 재시도 루프
        let saved = false;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[재시도] ${category} ${attempt}/${MAX_RETRIES}회 재시도...`);
                    await new Promise(r => setTimeout(r, 1000)); // 1초 대기
                }

                const response = await fetch('/api/meal-plans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(attempt > 0 ? { ...requestBody, force_save: true } : requestBody)
                });
                const result = await response.json();

                if (result.success) {
                    const savedSlots = result.saved_slots || 0;
                    totalSaved += savedSlots;
                    console.log(`[DB] ${category} 저장 완료: ${savedSlots}/${expectedSlots}개 슬롯`);

                    // ★ 저장 후 검증: 기대 슬롯 수와 실제 저장 수 비교
                    if (savedSlots < expectedSlots && attempt < MAX_RETRIES) {
                        console.warn(`[검증] ${category} 슬롯 수 불일치! 기대=${expectedSlots}, 실제=${savedSlots} → 재시도`);
                        continue; // 재시도
                    }
                    saved = true;
                    break;
                } else if (result.conflict) {
                    // ★ 낙관적 잠금 충돌 처리
                    console.warn(`[충돌] ${category}:`, result.conflicts);
                    const conflictSlots = result.conflicts.map(c => c.slot).join(', ');
                    const forceOverwrite = confirm(
                        `⚠️ 다른 사용자가 이미 수정했습니다!\n\n` +
                        `충돌 슬롯: ${conflictSlots}\n\n` +
                        `[확인] 내 변경사항으로 덮어쓰기\n` +
                        `[취소] 저장 취소 후 새로고침`
                    );

                    if (forceOverwrite) {
                        const forceResponse = await fetch('/api/meal-plans', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...requestBody, force_save: true })
                        });
                        const forceResult = await forceResponse.json();
                        if (forceResult.success) {
                            totalSaved += forceResult.saved_slots || 0;
                            console.log(`[DB] ${category} 강제 저장 완료: ${forceResult.saved_slots}개 슬롯`);
                            saved = true;
                        }
                        break;
                    } else {
                        await loadMealPlansFromServer();
                        syncMealData();
                        generateCalendar();
                        closeMealInputModal();
                        showNotification('데이터를 새로고침했습니다. 다시 편집해주세요.', 'info');
                        return;
                    }
                } else {
                    // 저장 실패 → 재시도 가능하면 재시도
                    console.error(`[DB] ${category} 저장 실패 (${attempt + 1}회차):`, result.error);
                    if (attempt >= MAX_RETRIES) {
                        const korError = translateErrorMessage(result.error);
                        errors.push(`${category}: ${korError}`);
                        failedCategories.push(category);
                    }
                }
            } catch (e) {
                console.error(`[DB] ${category} 저장 오류 (${attempt + 1}회차):`, e);
                if (attempt >= MAX_RETRIES) {
                    const korError = translateErrorMessage(e.message);
                    errors.push(`${category}: ${korError}`);
                    failedCategories.push(category);
                }
            }
        }
    }

    // 결과 알림
    if (errors.length > 0) {
        showNotification(
            `⚠️ 저장 실패 (${failedCategories.join(', ')})\n${errors.join('\n')}\n\n해당 카테고리를 다시 열고 저장해주세요.`,
            'error'
        );
    } else {
        console.log(`[DB] 식단 저장 완료: ${modalSelectedDate}, 총 ${totalSaved}개 슬롯 (${categoriesToSave.length}개 카테고리)`);
    }

    // 2. 서버에서 최신 데이터 다시 로드 (카테고리 필터 포함)
    await loadMealPlansFromServer();

    // 캘린더 다시 그리기
    generateCalendar();

    closeMealInputModal();

    if (errors.length === 0) {
        showNotification(`식단이 저장되었습니다. (${categoriesToSave.join(', ')})`, 'success');
    }
}

function searchModalMenus() {
    const searchTerm = document.getElementById('modalMenuSearchInput').value;
    renderModalMenuList(searchTerm);
}

// 🎯 템플릿 관련 함수들 (서버 저장 방식)
function updateTemplateSelect() {
    const select = document.getElementById('templateSelect');
    if (!select) {
        console.warn('[템플릿] templateSelect 엘리먼트를 찾을 수 없음');
        return;
    }

    console.log('[템플릿] 드롭다운 업데이트 - 템플릿 수:', mealTemplates.length);

    // mealTemplates는 이제 배열 형태 [{id, template_name, ...}, ...]
    select.innerHTML = `<option value="">-- 템플릿 선택 --</option>` +
        mealTemplates.map(t => `<option value="${t.id}">${t.template_name}</option>`).join('');
}

async function saveAsTemplate() {
    const name = prompt('템플릿 이름을 입력하세요:', '');
    if (!name || !name.trim()) return;

    const templateName = name.trim();

    // 현재 모달 데이터를 템플릿으로 저장
    const templateData = {
        mealData: JSON.parse(JSON.stringify(modalMealData)),
        slotNames: JSON.parse(JSON.stringify(customSlotNames))
    };

    try {
        const siteId = getCurrentSiteId();
        const response = await fetch('/api/meal-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_name: templateName,
                description: `${Object.keys(modalMealData).length}개 슬롯`,
                template_data: templateData,
                site_id: siteId
            })
        });
        const result = await response.json();

        if (result.success) {
            // 템플릿 목록 새로고침
            await loadTemplatesFromServer();
            updateTemplateSelect();
            showNotification(`템플릿 "${templateName}"이(가) 저장되었습니다.`, 'success');
        } else {
            showNotification('템플릿 저장 실패: ' + result.error, 'error');
        }
    } catch (e) {
        console.error('템플릿 저장 오류:', e);
        showNotification('템플릿 저장 중 오류가 발생했습니다.', 'error');
    }
}

async function loadTemplatesFromServer() {
    try {
        const siteId = getCurrentSiteId();
        const url = siteId ? `/api/meal-templates?site_id=${siteId}` : '/api/meal-templates';
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
            mealTemplates = data.templates;
            // AppState에도 저장
            if (typeof AppState !== 'undefined') {
                AppState.set('mealTemplates', mealTemplates);
            }
        }
    } catch (e) {
        console.error('템플릿 목록 로드 실패:', e);
    }
}

function loadTemplate() {
    const select = document.getElementById('templateSelect');
    const templateId = select.value;

    if (!templateId) {
        showNotification('템플릿을 선택해주세요.', 'warning');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        showNotification('템플릿을 찾을 수 없습니다.', 'error');
        return;
    }

    // 확인 메시지
    if (Object.keys(modalMealData).length > 0) {
        if (!confirm('현재 식단을 템플릿으로 덮어쓰시겠습니까?')) return;
    }

    // 템플릿 적용 (template_data는 JSON 객체)
    const templateData = typeof template.template_data === 'string'
        ? JSON.parse(template.template_data)
        : template.template_data;

    // ⚠️ 중요: 템플릿의 mealData는 슬롯 구성 정보이므로,
    // 기존 메뉴는 유지하고 없는 슬롯만 추가 (메뉴를 삭제하지 않음)
    if (templateData.mealData) {
        const categorySlots = templateData.mealData[modalSelectedCategory] || [];
        // 기존 modalMealData 유지 (초기화하지 않음)
        const existingSlots = Object.keys(modalMealData);
        let addedSlots = 0;
        categorySlots.forEach(slot => {
            if (slot.menuName && !modalMealData[slot.menuName]) {
                // 슬롯이 없을 때만 빈 배열로 추가
                modalMealData[slot.menuName] = [];
                addedSlots++;
            }
        });
        console.log(`[템플릿] ${modalSelectedCategory} 카테고리 - 기존 ${existingSlots.length}개 유지, 새 슬롯 ${addedSlots}개 추가`);
    }

    // 슬롯명도 적용 (선택적)
    if (templateData.slotNames) {
        Object.assign(customSlotNames, templateData.slotNames);
    }

    renderModalMealSlots();
    showNotification(`템플릿 "${template.template_name}"이(가) 적용되었습니다.`, 'success');
}

async function deleteTemplate() {
    const select = document.getElementById('templateSelect');
    const templateId = select.value;

    if (!templateId) {
        showNotification('삭제할 템플릿을 선택해주세요.', 'warning');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        showNotification('템플릿을 찾을 수 없습니다.', 'error');
        return;
    }

    if (!confirm(`템플릿 "${template.template_name}"을(를) 삭제하시겠습니까?`)) return;

    try {
        const response = await fetch(`/api/meal-templates/${templateId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (result.success) {
            // 템플릿 목록 새로고침
            await loadTemplatesFromServer();
            updateTemplateSelect();
            showNotification(`템플릿 "${template.template_name}"이(가) 삭제되었습니다.`, 'info');
        } else {
            showNotification('템플릿 삭제 실패: ' + result.error, 'error');
        }
    } catch (e) {
        console.error('템플릿 삭제 오류:', e);
        showNotification('템플릿 삭제 중 오류가 발생했습니다.', 'error');
    }
}

function clearAllSlots() {
    if (!confirm('모든 슬롯의 메뉴를 비우시겠습니까?')) return;
    modalMealData = {};
    renderModalMealSlots();
    showNotification('모든 슬롯이 비워졌습니다.', 'info');
}

// ========================================
// 📅 날짜별 템플릿 자동 적용 시스템
// ========================================

/**
 * 날짜에 템플릿 적용 및 저장
 * @param {string} dateKey - 날짜 (예: '2024-12-29')
 * @param {number} templateId - 템플릿 ID
 */
async function applyTemplateToDate(dateKey, templateId) {
    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        showNotification('템플릿을 찾을 수 없습니다.', 'error');
        return false;
    }

    // 날짜별 템플릿 매핑 저장
    dateTemplateMap[dateKey] = templateId;

    // 로컬스토리지에 저장 (페이지 새로고침 후에도 유지)
    try {
        localStorage.setItem('dateTemplateMap', JSON.stringify(dateTemplateMap));
    } catch (e) {
        console.error('날짜별 템플릿 저장 실패:', e);
    }

    console.log(`[템플릿] ${dateKey}에 템플릿 "${template.template_name}" 적용됨`);
    return true;
}

/**
 * 날짜에 적용된 템플릿 가져오기 (사업장 매칭 포함)
 * @param {string} dateKey - 날짜
 * @returns {Object|null} 템플릿 객체 또는 null
 */
function getTemplateForDate(dateKey) {
    const templateId = dateTemplateMap[dateKey];
    if (!templateId) {
        // 날짜별 매핑이 없으면 사업장에 맞는 기본 템플릿 반환
        return getDefaultTemplateForSite();
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) return null;

    // ★ 템플릿이 현재 사업장에 맞는지 검증
    if (!isTemplateMatchingSite(template)) {
        console.log(`[템플릿] ${template.template_name}은 현재 사업장과 맞지 않음`);
        return getDefaultTemplateForSite();
    }

    return template;
}

/**
 * 현재 사업장에 맞는 기본 템플릿 반환
 */
function getDefaultTemplateForSite() {
    const siteId = getCurrentSiteId();
    const siteName = typeof SiteSelector !== 'undefined' ? (SiteSelector.getCurrentSiteName() || '') : '';

    // 사업장 키워드 매칭
    let matchKeyword = '';
    if (siteId === 1 || siteName.includes('본사')) {
        matchKeyword = '본사';
    } else if (siteId === 2 || siteName.includes('영남')) {
        matchKeyword = '영남';
    }

    if (!matchKeyword) {
        console.log('[템플릿] 본사/영남 외 사업장 - 기본 템플릿 없음');
        return null;
    }

    const matchedTemplate = mealTemplates.find(t => t.template_name.includes(matchKeyword));
    if (matchedTemplate) {
        console.log(`[템플릿] 사업장 기본 템플릿: ${matchedTemplate.template_name}`);
    }
    return matchedTemplate || null;
}

/**
 * 템플릿이 현재 사업장과 맞는지 확인
 */
function isTemplateMatchingSite(template) {
    const siteId = getCurrentSiteId();
    const siteName = typeof SiteSelector !== 'undefined' ? (SiteSelector.getCurrentSiteName() || '') : '';

    const templateName = template.template_name || '';

    // 본사 사업장
    if (siteId === 1 || siteName.includes('본사')) {
        return templateName.includes('본사');
    }
    // 영남지사
    if (siteId === 2 || siteName.includes('영남')) {
        return templateName.includes('영남');
    }
    // 그 외 사업장은 템플릿 매칭 안 함
    return false;
}

/**
 * 날짜에 카테고리 저장
 * @param {string} dateKey - 날짜
 * @param {string} category - 카테고리 (도시락/운반/학교/요양원)
 */
function saveDateCategory(dateKey, category) {
    try {
        let dateCategoryMap = JSON.parse(localStorage.getItem('dateCategoryMap') || '{}');
        dateCategoryMap[dateKey] = category;
        localStorage.setItem('dateCategoryMap', JSON.stringify(dateCategoryMap));
        console.log(`[카테고리] ${dateKey}에 "${category}" 저장됨`);
    } catch (e) {
        console.error('날짜별 카테고리 저장 실패:', e);
    }
}

/**
 * 날짜에 저장된 카테고리 가져오기
 * @param {string} dateKey - 날짜
 * @returns {string|null} 카테고리 또는 null
 */
function getCategoryForDate(dateKey) {
    try {
        const dateCategoryMap = JSON.parse(localStorage.getItem('dateCategoryMap') || '{}');
        return dateCategoryMap[dateKey] || null;
    } catch (e) {
        return null;
    }
}

/**
 * 날짜별 템플릿 매핑 로드
 */
function loadDateTemplateMap() {
    try {
        const saved = localStorage.getItem('dateTemplateMap');
        if (saved) {
            dateTemplateMap = JSON.parse(saved);
            console.log('[템플릿] 날짜별 템플릿 매핑 로드:', Object.keys(dateTemplateMap).length + '개');
        }
    } catch (e) {
        console.error('날짜별 템플릿 로드 실패:', e);
        dateTemplateMap = {};
    }
}

/**
 * 모달에서 템플릿 적용 (현재 날짜 + 모든 페이지에 적용)
 */
function applyTemplateToCurrentDate() {
    const select = document.getElementById('templateSelect');
    const templateId = select.value;

    if (!templateId) {
        showNotification('템플릿을 선택해주세요.', 'warning');
        return;
    }

    const template = mealTemplates.find(t => t.id == templateId);
    if (!template) {
        showNotification('템플릿을 찾을 수 없습니다.', 'error');
        return;
    }

    // 확인 메시지
    const dateStr = modalSelectedDate || '선택된 날짜';
    if (!confirm(`템플릿 "${template.template_name}"을(를) ${dateStr}의 기본 템플릿으로 적용하시겠습니까?\n\n이 날짜에 식단을 입력할 때마다 이 템플릿의 슬롯이 자동으로 표시됩니다.`)) {
        return;
    }

    // 날짜에 템플릿 + 카테고리 적용 (저장)
    if (modalSelectedDate) {
        applyTemplateToDate(modalSelectedDate, templateId);
        // 선택된 카테고리도 함께 저장
        saveDateCategory(modalSelectedDate, modalSelectedCategory);
    }

    // 템플릿 데이터 적용
    const templateData = typeof template.template_data === 'string'
        ? JSON.parse(template.template_data)
        : template.template_data;

    // ⚠️ 기본적용: 템플릿의 슬롯 구조를 적용 (기존 메뉴 데이터는 매칭되는 슬롯에 유지)
    // menuStructure 우선 사용 (슬롯 정의), mealData는 식수 데이터 포함
    const slotSource = templateData.menuStructure || templateData.mealData || {};
    const categorySlots = slotSource[modalSelectedCategory] || [];

    console.log(`[기본적용] 카테고리: ${modalSelectedCategory}, 사용 가능 카테고리:`, Object.keys(slotSource));
    console.log(`[기본적용] 슬롯 수: ${categorySlots.length}`, categorySlots);

    if (categorySlots.length > 0) {
        const oldMealData = { ...modalMealData };

        // 템플릿의 슬롯 구조로 새로 생성
        modalMealData = {};
        categorySlots.forEach(slot => {
            if (slot.menuName) {
                // 기존에 같은 슬롯명이 있으면 메뉴 데이터 유지, 없으면 빈 배열
                modalMealData[slot.menuName] = oldMealData[slot.menuName] || [];
            }
        });
        console.log(`[기본적용] ${modalSelectedCategory} 카테고리 - ${Object.keys(modalMealData).length}개 슬롯 적용됨`);
    } else {
        console.warn(`[기본적용] ${modalSelectedCategory} 카테고리에 슬롯이 없습니다.`);
        showNotification(`템플릿에 "${modalSelectedCategory}" 카테고리 슬롯이 없습니다.`, 'warning');
        return;
    }

    if (templateData.slotNames) {
        Object.assign(customSlotNames, templateData.slotNames);
    }

    renderModalMealSlots();
    showNotification(`템플릿 "${template.template_name}"이(가) ${dateStr}에 적용되었습니다.`, 'success');
}

/**
 * 모달 열 때 날짜의 기본 템플릿 자동 적용
 * @param {string} dateKey - 날짜
 *
 * 🔧 버그 수정 (2025-12-24):
 * - 카테고리 변경 로직 제거 (openMealInputModal에서 이미 결정됨)
 * - mealData 대신 modalMealData 사용 (모달 데이터 기준)
 */
function autoApplyTemplateForDate(dateKey) {
    const template = getTemplateForDate(dateKey);

    // ⚠️ 카테고리 변경 로직 제거됨
    // 카테고리는 openMealInputModal에서 이미 결정되고 데이터가 로드됨
    // 여기서 변경하면 캐시와 UI 불일치 발생

    if (!template) {
        console.log(`[자동적용] ${dateKey}에 적용된 템플릿 없음`);
        return false;
    }

    // 템플릿 선택 드롭다운 업데이트
    const select = document.getElementById('templateSelect');
    if (select) {
        select.value = template.id;
    }

    // 🔧 수정: modalMealData (모달 데이터)를 기준으로 체크
    // 이전: mealData[dateKey] (전역 데이터) - 잘못된 참조
    const hasExistingData = Object.keys(modalMealData || {}).length > 0;

    const templateData = typeof template.template_data === 'string'
        ? JSON.parse(template.template_data)
        : template.template_data;

    if (templateData.slotNames) {
        Object.assign(customSlotNames, templateData.slotNames);
    }

    // 기존 데이터가 없을 때만 템플릿의 슬롯 구조 적용
    if (!hasExistingData) {
        const slotSource = templateData.menuStructure || templateData.mealData || {};
        const categorySlots = slotSource[modalSelectedCategory] || [];

        if (categorySlots.length > 0) {
            modalMealData = {};
            categorySlots.forEach(slot => {
                if (slot.menuName) {
                    modalMealData[slot.menuName] = [];
                }
            });
            // 🔧 캐시도 업데이트 (일관성 유지)
            modalCategoryDataCache[modalSelectedCategory] = JSON.parse(JSON.stringify(modalMealData));
            console.log(`[자동적용] ${dateKey} - ${modalSelectedCategory} 카테고리 ${Object.keys(modalMealData).length}개 슬롯 생성`);
        }
    }

    console.log(`[자동적용] ${dateKey}에 템플릿 "${template.template_name}" 적용됨 (기존 데이터: ${hasExistingData})`);
    return true;
}

/**
 * 모달에 현재 적용된 템플릿 정보 표시
 * @param {string} dateKey - 날짜
 */
function updateAppliedTemplateInfo(dateKey) {
    const template = getTemplateForDate(dateKey);
    const infoContainer = document.getElementById('appliedTemplateInfo');

    if (!infoContainer) return;

    if (template) {
        infoContainer.innerHTML = `
            <div class="applied-template-badge">
                📌 기본 템플릿: <strong>${template.template_name}</strong>
                <button class="btn-clear-template" onclick="clearDateTemplate('${dateKey}')" title="템플릿 해제">✕</button>
            </div>
        `;
        infoContainer.style.display = 'block';
    } else {
        infoContainer.innerHTML = '';
        infoContainer.style.display = 'none';
    }
}

/**
 * 날짜의 기본 템플릿 해제
 * @param {string} dateKey - 날짜
 */
function clearDateTemplate(dateKey) {
    if (!confirm('이 날짜의 기본 템플릿을 해제하시겠습니까?')) return;

    delete dateTemplateMap[dateKey];

    try {
        localStorage.setItem('dateTemplateMap', JSON.stringify(dateTemplateMap));
    } catch (e) {
        console.error('템플릿 해제 저장 실패:', e);
    }

    // UI 업데이트
    updateAppliedTemplateInfo(dateKey);
    const select = document.getElementById('templateSelect');
    if (select) select.value = '';

    showNotification('기본 템플릿이 해제되었습니다.', 'info');
}

// 전역 함수 등록
window.applyTemplateToCurrentDate = applyTemplateToCurrentDate;
window.clearDateTemplate = clearDateTemplate;
window.jumpWeek = jumpWeek;

// ========================================
// 🏷️ 카테고리 관리 (도시락/운반/학교/요양원)
// ========================================

/**
 * 식단 카테고리 선택
 * @param {string} category - 선택할 카테고리 (전체/도시락/운반/학교/요양원)
 */
async function selectMealCategory(category) {
    currentMealCategory = category;

    // 탭 UI 업데이트
    const tabs = document.querySelectorAll('.meal-category-tab');
    tabs.forEach(tab => {
        if (tab.dataset.category === category) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // 카테고리 정보 업데이트
    const categoryInfo = document.getElementById('currentCategoryInfo');
    if (categoryInfo) {
        if (category === '전체') {
            categoryInfo.textContent = '전체 카테고리 보기';
        } else {
            categoryInfo.textContent = `${category} 식단 보기`;
        }
    }

    // AppState에 저장
    if (typeof AppState !== 'undefined') {
        AppState.set('currentMealCategory', category);
    }

    // 해당 카테고리 데이터 로드
    await loadMealPlansFromServer();

    // 캘린더 새로고침 (카테고리 필터 적용)
    generateCalendar();

    console.log(`[카테고리] 선택됨: ${category}`);
}

/**
 * 현재 선택된 카테고리 가져오기
 */
function getCurrentMealCategory() {
    return currentMealCategory;
}

/**
 * 카테고리별 템플릿 목록 필터링
 */
function filterTemplatesByCategory(templates, category) {
    if (category === '전체') {
        return templates;
    }
    return templates.filter(t => t.category === category || !t.category);
}

/**
 * 🍱 현재 카테고리에 맞는 메뉴 슬롯 목록 가져오기
 * 템플릿의 mealType + menuName을 조합하여 슬롯 생성
 * @returns {Array<{slotName: string, mealType: string, menuName: string}>}
 */
function getCategoryMenuSlots() {
    const category = currentMealCategory;

    // 전체일 경우 기본 슬롯 사용
    if (category === '전체') {
        return mealSlots.map(slot => ({
            slotName: slot,
            mealType: slot.replace(/[A-Z]$/, ''),
            menuName: slot
        }));
    }

    // 저장된 템플릿에서 해당 카테고리의 메뉴 가져오기
    const templates = AppState.get('mealTemplates') || [];
    const categoryMenus = [];
    const seenMenus = new Set();

    templates.forEach(template => {
        const mealData = template.template_data?.mealData || {};
        const categoryData = mealData[category] || [];

        categoryData.forEach(item => {
            const menuName = item.menuName || '';
            const mealType = item.mealType || '중식';
            const order = item.order || 0;

            if (menuName && !seenMenus.has(menuName)) {
                seenMenus.add(menuName);
                categoryMenus.push({
                    slotName: menuName,
                    mealType: mealType,
                    menuName: menuName,
                    order: order,
                    // mealType 앞글자 추가 (조/중/석/야/행)
                    mealTypeShort: getMealTypeShort(mealType)
                });
            }
        });
    });

    // order 기준 정렬
    categoryMenus.sort((a, b) => a.order - b.order);

    console.log(`[카테고리 메뉴] ${category}: ${categoryMenus.length}개 메뉴`, categoryMenus);

    return categoryMenus.length > 0 ? categoryMenus : mealSlots.map(slot => ({
        slotName: slot,
        mealType: slot.replace(/[A-Z]$/, ''),
        menuName: slot
    }));
}

/**
 * 끼니 유형의 짧은 표시 (조/중/석/야/행)
 */
function getMealTypeShort(mealType) {
    const typeMap = {
        '조식': '조',
        '중식': '중',
        '석식': '석',
        '야식': '야',
        '행사': '행',
        '간식': '간'
    };
    return typeMap[mealType] || mealType?.charAt(0) || '';
}

// 전역 함수 등록
window.selectMealCategory = selectMealCategory;
window.getCurrentMealCategory = getCurrentMealCategory;
window.getCategoryMenuSlots = getCategoryMenuSlots;

// ========================================
// 📋 슬롯 복사 모달
// ========================================

let copySourceSlot = null;  // 복사 원본 슬롯
let copyTargetSlots = [];   // 대상 슬롯 목록 (동적 로딩)

/**
 * 사업장 목록 가져오기
 */
async function getSiteList() {
    try {
        const response = await fetch('/api/admin/sites');
        const result = await response.json();
        if (result.success) {
            return result.sites || result.data || [];
        }
    } catch (e) {
        console.error('사업장 목록 로드 실패:', e);
    }
    return [];
}

/**
 * 어드민 운영관리의 슬롯 설정에서 해당 카테고리의 슬롯 목록 가져오기
 * @param {number} siteId - 사업장 ID (그룹별 카테고리 구분에 사용)
 * @param {string} category - 카테고리명 (도시락, 운반, 학교, 요양원)
 */
async function getTargetSlotsFromPricing(siteId, category) {
    try {
        // 어드민 슬롯 설정 API에서 슬롯 목록 가져오기 (meal_slot_settings 테이블)
        // site_id를 전달하여 해당 그룹의 카테고리 슬롯을 가져옴
        const url = `/api/admin/slot-settings?category=${encodeURIComponent(category)}&site_id=${siteId || ''}`;
        console.log(`[슬롯] 슬롯 설정 조회: site_id=${siteId}, category=${category}`);
        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.slots && result.slots.length > 0) {
            console.log(`[슬롯] ${result.slots.length}개 슬롯 로드됨 (group_id=${result.group_id}, entity_id=${result.entity_id})`);
            // display_name만 사용 (slot_key는 내부용이므로 표시하지 않음)
            return result.slots
                .filter(s => s.display_name)  // display_name이 있는 것만
                .map(s => ({
                    slotName: s.display_name,
                    menuCount: 0
                }));
        }
    } catch (e) {
        console.error('슬롯 설정 로드 실패:', e);
    }

    // 슬롯 설정이 없으면 빈 배열 반환
    console.log(`[복사] ${category} 카테고리의 슬롯 설정이 없습니다.`);
    return [];
}

/**
 * 슬롯 복사 모달 열기 - 순차적 선택 UI
 * @param {string} slotName - 복사할 슬롯 이름
 */
async function openSlotCopyModal(slotName) {
    copySourceSlot = slotName;
    const menus = modalMealData[slotName] || [];
    const currentSiteId = getCurrentSiteId();
    const currentCategory = modalSelectedCategory || '도시락';

    // 모달이 없으면 생성
    let modal = document.getElementById('slotCopyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'slotCopyModal';
        modal.className = 'slot-copy-modal-overlay';
        document.body.appendChild(modal);
    }

    // 사업장 목록 가져오기
    const sites = await getSiteList();
    const categories = ['도시락', '운반', '학교', '요양원'];

    modal.innerHTML = `
        <div class="slot-copy-modal" style="
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 550px;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        ">
            <div class="slot-copy-modal-header" style="
                padding: 16px 20px;
                border-bottom: 1px solid #e9ecef;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(135deg, #4a90d9, #357abd);
            ">
                <h3 style="margin: 0; font-size: 17px; color: white;">📋 메뉴 복사</h3>
                <button onclick="closeSlotCopyModal()" style="
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: white;
                    opacity: 0.8;
                ">&times;</button>
            </div>

            <div class="slot-copy-modal-body" style="padding: 20px;">
                <!-- 복사 원본 정보 -->
                <div style="
                    background: #e3f2fd;
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-bottom: 20px;
                    border-left: 4px solid #1976d2;
                ">
                    <div style="font-size: 12px; color: #1565c0; margin-bottom: 4px;">복사 원본</div>
                    <div style="font-weight: 600; color: #0d47a1;">${slotName} <span style="font-weight: normal; color: #1976d2;">(${menus.length}개 메뉴)</span></div>
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
                        ${menus.slice(0, 5).map(m => `<span style="background: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #555;">${m.name || '메뉴'}</span>`).join('')}
                        ${menus.length > 5 ? `<span style="color: #1565c0; font-size: 11px;">외 ${menus.length - 5}개</span>` : ''}
                    </div>
                </div>

                <!-- 1단계: 날짜 선택 -->
                <div class="copy-step" style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="
                            background: #4a90d9;
                            color: white;
                            width: 22px;
                            height: 22px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 12px;
                            font-weight: 600;
                        ">1</span>
                        <label style="font-weight: 600; color: #333; font-size: 14px;">날짜 선택</label>
                    </div>
                    <div style="padding-left: 30px;">
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                            <input type="date" id="copyStartDate" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                            <span style="color: #999;">~</span>
                            <input type="date" id="copyEndDate" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                        </div>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${['월', '화', '수', '목', '금', '토', '일'].map((day, i) => `
                                <label style="display: flex; align-items: center; cursor: pointer;">
                                    <input type="checkbox" class="copy-day-checkbox" value="${i + 1}" ${i < 5 ? 'checked' : ''} style="display: none;">
                                    <span class="day-chip" style="
                                        display: inline-block;
                                        width: 32px;
                                        height: 32px;
                                        line-height: 32px;
                                        text-align: center;
                                        background: ${i < 5 ? '#4a90d9' : '#f0f0f0'};
                                        color: ${i < 5 ? 'white' : (i === 5 ? '#1565c0' : i === 6 ? '#c62828' : '#666')};
                                        border-radius: 50%;
                                        font-size: 12px;
                                        font-weight: 500;
                                        transition: all 0.2s;
                                    ">${day}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!-- 2단계: 사업장 선택 -->
                <div class="copy-step" style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="
                            background: #4a90d9;
                            color: white;
                            width: 22px;
                            height: 22px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 12px;
                            font-weight: 600;
                        ">2</span>
                        <label style="font-weight: 600; color: #333; font-size: 14px;">사업장 선택</label>
                    </div>
                    <div style="padding-left: 30px;">
                        <select id="copyTargetSite" onchange="onCopyTargetChange()" style="
                            width: 100%;
                            padding: 10px 12px;
                            border: 1px solid #ddd;
                            border-radius: 6px;
                            font-size: 13px;
                            cursor: pointer;
                        ">
                            <option value="${currentSiteId}">현재 사업장 (${sites.find(s => s.id == currentSiteId)?.site_name || sites.find(s => s.id == currentSiteId)?.name || '선택됨'})</option>
                            ${sites.filter(s => s.id != currentSiteId).map(site => `
                                <option value="${site.id}">${site.site_name || site.name}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <!-- 3단계: 카테고리 선택 -->
                <div class="copy-step" style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="
                            background: #4a90d9;
                            color: white;
                            width: 22px;
                            height: 22px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 12px;
                            font-weight: 600;
                        ">3</span>
                        <label style="font-weight: 600; color: #333; font-size: 14px;">카테고리 선택</label>
                    </div>
                    <div style="padding-left: 30px;">
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                            ${categories.map(cat => `
                                <label class="category-option" style="
                                    display: flex;
                                    flex-direction: column;
                                    align-items: center;
                                    padding: 10px 8px;
                                    background: ${cat === currentCategory ? '#e3f2fd' : '#f8f9fa'};
                                    border: 2px solid ${cat === currentCategory ? '#4a90d9' : 'transparent'};
                                    border-radius: 8px;
                                    cursor: pointer;
                                    transition: all 0.2s;
                                ">
                                    <input type="radio" name="copyCategory" value="${cat}" ${cat === currentCategory ? 'checked' : ''} onchange="onCopyTargetChange()" style="display: none;">
                                    <span style="font-size: 20px; margin-bottom: 4px;">${cat === '도시락' ? '🍱' : cat === '운반' ? '🚚' : cat === '학교' ? '🏫' : '🏥'}</span>
                                    <span style="font-size: 11px; color: ${cat === currentCategory ? '#1565c0' : '#666'};">${cat}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!-- 4단계: 대상 슬롯 선택 -->
                <div class="copy-step" style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="
                            background: #4a90d9;
                            color: white;
                            width: 22px;
                            height: 22px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 12px;
                            font-weight: 600;
                        ">4</span>
                        <label style="font-weight: 600; color: #333; font-size: 14px;">대상 슬롯 선택</label>
                    </div>
                    <div style="padding-left: 30px;">
                        <div id="targetSlotsList" style="
                            display: grid;
                            grid-template-columns: repeat(2, 1fr);
                            gap: 8px;
                            max-height: 180px;
                            overflow-y: auto;
                            padding: 2px;
                        ">
                            <div style="grid-column: 1/-1; color: #999; text-align: center; padding: 20px;">
                                슬롯 목록 로딩 중...
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 복사 실행 버튼 -->
                <button onclick="executeSequentialCopy()" style="
                    width: 100%;
                    padding: 14px;
                    background: linear-gradient(135deg, #4a90d9, #357abd);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                ">
                    <span>📋</span> 선택한 조건으로 복사
                </button>
            </div>
        </div>
    `;

    // 모달 오버레이 스타일
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    `;

    // 기본 날짜 설정 (시작일=종료일=내일)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    document.getElementById('copyStartDate').value = tomorrowStr;
    document.getElementById('copyEndDate').value = tomorrowStr;

    // 요일 칩 토글 이벤트
    document.querySelectorAll('.copy-day-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            const chip = this.nextElementSibling;
            if (this.checked) {
                chip.style.background = '#4a90d9';
                chip.style.color = 'white';
            } else {
                const dayIndex = parseInt(this.value) - 1;
                chip.style.background = '#f0f0f0';
                chip.style.color = dayIndex === 5 ? '#1565c0' : dayIndex === 6 ? '#c62828' : '#666';
            }
        });
    });

    // 카테고리 라디오 버튼 스타일 이벤트
    document.querySelectorAll('input[name="copyCategory"]').forEach(radio => {
        radio.addEventListener('change', function () {
            document.querySelectorAll('.category-option').forEach(opt => {
                opt.style.background = '#f8f9fa';
                opt.style.borderColor = 'transparent';
                opt.querySelector('span:last-child').style.color = '#666';
            });
            if (this.checked) {
                const label = this.closest('.category-option');
                label.style.background = '#e3f2fd';
                label.style.borderColor = '#4a90d9';
                label.querySelector('span:last-child').style.color = '#1565c0';
            }
        });
    });

    // 초기 슬롯 목록 로드
    await loadTargetSlots();
}

/**
 * 대상 슬롯 목록 로드
 */
async function loadTargetSlots() {
    const siteId = document.getElementById('copyTargetSite')?.value || getCurrentSiteId();
    const category = document.querySelector('input[name="copyCategory"]:checked')?.value || modalSelectedCategory || '도시락';
    const startDate = document.getElementById('copyStartDate')?.value;

    const container = document.getElementById('targetSlotsList');
    if (!container) return;

    container.innerHTML = '<div style="grid-column: 1/-1; color: #999; text-align: center; padding: 20px;">슬롯 목록 로딩 중...</div>';

    const currentSiteId = getCurrentSiteId();
    const currentCategory = modalSelectedCategory || '도시락';

    let slots = [];

    // 항상 어드민 슬롯 설정(meal_slot_settings)에서 가져오기
    slots = await getTargetSlotsFromPricing(siteId, category);

    // 슬롯 설정에 메뉴 개수 정보 추가 (같은 카테고리인 경우)
    if (siteId == currentSiteId && category === currentCategory) {
        slots = slots.map(s => ({
            ...s,
            menuCount: (modalMealData[s.slotName] || []).length
        }));
    }

    // 원본 슬롯 제외 (같은 사업장/카테고리인 경우만)
    if (siteId == currentSiteId && category === currentCategory) {
        slots = slots.filter(s => s.slotName !== copySourceSlot);
    }

    if (slots.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; color: #888; text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                <div style="font-size: 24px; margin-bottom: 8px;">📭</div>
                <div>등록된 슬롯이 없습니다</div>
                <div style="font-size: 11px; color: #aaa; margin-top: 4px;">템플릿 설정에서 슬롯을 추가하세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = slots.map(s => `
        <label style="
            display: flex;
            align-items: center;
            padding: 10px 12px;
            background: #f8f9fa;
            border-radius: 8px;
            cursor: pointer;
            border: 2px solid transparent;
            transition: all 0.2s;
        " onmouseover="this.style.borderColor='#4a90d9'; this.style.background='#e3f2fd';"
           onmouseout="if(!this.querySelector('input').checked){this.style.borderColor='transparent'; this.style.background='#f8f9fa';}">
            <input type="checkbox" class="target-slot-checkbox" value="${s.slotName}"
                   onchange="updateSlotCheckStyle(this)"
                   style="width: 16px; height: 16px; margin-right: 10px; accent-color: #4a90d9;">
            <div style="flex: 1;">
                <div style="font-size: 13px; font-weight: 500; color: #333;">${s.slotName}</div>
                ${s.menuCount > 0 ? `<div style="font-size: 10px; color: #888; margin-top: 2px;">${s.menuCount}개 메뉴</div>` : ''}
            </div>
        </label>
    `).join('');
}

/**
 * 슬롯 체크박스 스타일 업데이트
 */
function updateSlotCheckStyle(checkbox) {
    const label = checkbox.closest('label');
    if (checkbox.checked) {
        label.style.borderColor = '#4a90d9';
        label.style.background = '#e3f2fd';
    } else {
        label.style.borderColor = 'transparent';
        label.style.background = '#f8f9fa';
    }
}

/**
 * 복사 대상 변경시 슬롯 목록 새로고침
 */
async function onCopyTargetChange() {
    await loadTargetSlots();
}

/**
 * 슬롯 복사 모달 닫기
 */
function closeSlotCopyModal() {
    const modal = document.getElementById('slotCopyModal');
    if (modal) {
        modal.remove();
    }
    copySourceSlot = null;
}

/**
 * 순차적 복사 실행 (새로운 통합 복사 함수)
 */
async function executeSequentialCopy() {
    // 1. 날짜 범위 및 요일 수집
    const startDate = document.getElementById('copyStartDate').value;
    const endDate = document.getElementById('copyEndDate').value;
    const dayCheckboxes = document.querySelectorAll('.copy-day-checkbox:checked');
    const selectedDays = Array.from(dayCheckboxes).map(cb => parseInt(cb.value));

    if (!startDate || !endDate) {
        showNotification('날짜 범위를 선택해주세요.', 'warning');
        return;
    }

    if (selectedDays.length === 0) {
        showNotification('복사할 요일을 선택해주세요.', 'warning');
        return;
    }

    // 2. 사업장 선택
    const targetSiteId = document.getElementById('copyTargetSite').value;

    // ★ 보안: site_id 필수 검증 (데이터 혼용 방지)
    if (!targetSiteId) {
        showNotification('사업장을 선택해주세요. 사업장 없이 복사할 수 없습니다.', 'error');
        return;
    }

    // 3. 카테고리 선택
    const targetCategory = document.querySelector('input[name="copyCategory"]:checked')?.value;
    if (!targetCategory || targetCategory === '전체') {
        showNotification('특정 카테고리를 선택해주세요. 전체 모드에서는 복사할 수 없습니다.', 'warning');
        return;
    }

    // 4. 대상 슬롯 수집
    const slotCheckboxes = document.querySelectorAll('.target-slot-checkbox:checked');
    const targetSlots = Array.from(slotCheckboxes).map(cb => cb.value);

    if (targetSlots.length === 0) {
        showNotification('복사할 슬롯을 선택해주세요.', 'warning');
        return;
    }

    const sourceMenus = modalMealData[copySourceSlot] || [];
    if (sourceMenus.length === 0) {
        showNotification('복사할 메뉴가 없습니다.', 'warning');
        return;
    }

    const currentSiteId = getCurrentSiteId();
    const currentCategory = modalSelectedCategory || '도시락';

    // 날짜 범위 생성
    const start = new Date(startDate);
    const end = new Date(endDate);
    const targetDates = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
        if (selectedDays.includes(dayOfWeek)) {
            targetDates.push(new Date(d).toISOString().split('T')[0]);
        }
    }

    if (targetDates.length === 0) {
        showNotification('선택된 날짜가 없습니다.', 'warning');
        return;
    }

    // 복사 실행
    let successCount = 0;
    let errorCount = 0;

    // 같은 사업장/카테고리/날짜인 경우 로컬 데이터만 수정
    const isSameContext = (
        targetSiteId == currentSiteId &&
        targetCategory === currentCategory &&
        targetDates.length === 1 &&
        targetDates[0] === modalSelectedDate
    );

    if (isSameContext) {
        // 현재 모달 내에서만 복사 (서버 요청 없이)
        targetSlots.forEach(targetSlot => {
            if (!modalMealData[targetSlot]) {
                modalMealData[targetSlot] = [];
            }

            sourceMenus.forEach(menu => {
                // 중복 체크 없이 복사 (같은 메뉴도 다른 슬롯에 복사 가능)
                modalMealData[targetSlot].push(JSON.parse(JSON.stringify(menu)));
                successCount++;
            });
        });

        closeSlotCopyModal();
        renderModalMealSlots();
        showNotification(`${targetSlots.length}개 슬롯에 ${successCount}개 메뉴가 복사되었습니다.`, 'success');
        return;
    }

    // 다른 날짜/사업장/카테고리로 복사 (서버 요청 필요)
    showNotification('복사 진행 중...', 'info');

    // 🔄 대상 카테고리가 다르면 변형 레시피 적용
    let menusToSave = JSON.parse(JSON.stringify(sourceMenus));

    if (targetCategory && targetCategory !== currentCategory) {
        console.log(`[슬롯복사] 카테고리 변경: ${currentCategory} → ${targetCategory}, 변형 레시피 검색...`);

        const recipeIds = sourceMenus.filter(m => m.id).map(m => m.id);

        if (recipeIds.length > 0) {
            try {
                const variantResponse = await fetch('/api/recipe/find-variants', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipe_ids: recipeIds,
                        target_category: targetCategory
                    })
                });
                const variantResult = await variantResponse.json();

                if (variantResult.success && variantResult.variants) {
                    let replacedCount = 0;
                    menusToSave = menusToSave.map(menu => {
                        const variant = variantResult.variants[String(menu.id)];
                        if (variant) {
                            console.log(`[슬롯복사] 변형 적용: ${menu.name} (ID:${menu.id}) → ${variant.display_name} (ID:${variant.id})`);
                            replacedCount++;
                            return { ...menu, id: variant.id, name: variant.name, display_name: variant.display_name };
                        }
                        return menu;
                    });
                    console.log(`[슬롯복사] 변형 레시피 적용 완료: ${replacedCount}개`);
                }
            } catch (e) {
                console.error('[슬롯복사] 변형 레시피 검색 실패:', e);
            }
        }
    }

    for (const dateKey of targetDates) {
        for (const targetSlot of targetSlots) {
            try {
                const mealDataToSave = {};
                mealDataToSave[targetSlot] = menusToSave;

                const response = await fetch('/api/meal-plans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        plan_date: dateKey,
                        meal_data: mealDataToSave,
                        site_id: parseInt(targetSiteId),
                        category: targetCategory
                    })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (e) {
                console.error(`복사 실패 (${dateKey}, ${targetSlot}):`, e);
                errorCount++;
            }
        }
    }

    closeSlotCopyModal();

    // 같은 사업장인 경우 캘린더 새로고침
    if (targetSiteId == currentSiteId) {
        await loadMealPlansFromServer();
        syncMealData();
        generateCalendar();
    }

    if (errorCount === 0) {
        showNotification(`${targetDates.length}개 날짜 x ${targetSlots.length}개 슬롯에 복사 완료!`, 'success');
    } else {
        showNotification(`복사 완료 (성공: ${successCount}, 실패: ${errorCount})`, 'warning');
    }
}

/**
 * 날짜 전체 복사 모달 열기 (모달 헤더에 버튼 추가용)
 */
async function openFullDayCopyModal() {
    // 현재 모달에 있는 모든 슬롯 데이터
    const allSlots = Object.keys(modalMealData).filter(slot => modalMealData[slot]?.length > 0);

    if (allSlots.length === 0) {
        showNotification('복사할 메뉴가 없습니다.', 'warning');
        return;
    }

    const totalMenus = allSlots.reduce((sum, slot) => sum + (modalMealData[slot]?.length || 0), 0);

    // 복사 모달 생성
    let modal = document.getElementById('fullDayCopyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fullDayCopyModal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
        ">
            <div style="
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 500px;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            ">
                <div style="
                    padding: 16px 20px;
                    border-bottom: 1px solid #e9ecef;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <h3 style="margin: 0; font-size: 18px; color: #333;">📅 날짜 전체 복사</h3>
                    <button onclick="closeFullDayCopyModal()" style="
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: #999;
                    ">&times;</button>
                </div>

                <div style="padding: 20px;">
                    <!-- 복사할 데이터 요약 -->
                    <div style="margin-bottom: 20px; background: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <div style="font-weight: 600; margin-bottom: 8px;">복사할 데이터</div>
                        <div style="color: #666; font-size: 14px;">
                            ${allSlots.length}개 슬롯, ${totalMenus}개 메뉴
                        </div>
                        <div style="margin-top: 8px; max-height: 100px; overflow-y: auto;">
                            ${allSlots.map(slot => `
                                <span style="display: inline-block; background: #e9ecef; padding: 4px 8px; border-radius: 4px; margin: 2px; font-size: 11px;">
                                    ${slot} (${modalMealData[slot]?.length || 0})
                                </span>
                            `).join('')}
                        </div>
                    </div>

                    <!-- 날짜 범위 -->
                    <div style="margin-bottom: 16px;">
                        <label style="font-weight: 600; color: #495057; display: block; margin-bottom: 8px;">복사할 날짜 범위</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="date" id="fullDayStartDate" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                            <span>~</span>
                            <input type="date" id="fullDayEndDate" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                        </div>
                    </div>

                    <!-- 요일 선택 -->
                    <div style="margin-bottom: 16px;">
                        <label style="font-weight: 600; color: #495057; display: block; margin-bottom: 8px;">요일 선택</label>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            ${['월', '화', '수', '목', '금', '토', '일'].map((day, i) => `
                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                                    <input type="checkbox" class="fullday-checkbox" value="${i + 1}" ${i < 5 ? 'checked' : ''}>
                                    <span style="
                                        display: inline-block;
                                        width: 28px;
                                        height: 28px;
                                        line-height: 28px;
                                        text-align: center;
                                        background: ${i === 5 ? '#e3f2fd' : i === 6 ? '#ffebee' : '#f8f9fa'};
                                        border-radius: 50%;
                                        font-size: 12px;
                                        color: ${i === 5 ? '#1565c0' : i === 6 ? '#c62828' : '#495057'};
                                    ">${day}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <button onclick="executeFullDayCopy()" style="
                        width: 100%;
                        padding: 12px;
                        background: linear-gradient(135deg, #e67e22, #d35400);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                    ">선택한 날짜에 전체 복사</button>
                </div>
            </div>
        </div>
    `;

    // 기본 날짜 설정
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    document.getElementById('fullDayStartDate').value = today.toISOString().split('T')[0];
    document.getElementById('fullDayEndDate').value = nextWeek.toISOString().split('T')[0];
}

/**
 * 날짜 전체 복사 모달 닫기
 */
function closeFullDayCopyModal() {
    const modal = document.getElementById('fullDayCopyModal');
    if (modal) modal.remove();
}

/**
 * 날짜 전체 복사 실행
 */
async function executeFullDayCopy() {
    const startDate = document.getElementById('fullDayStartDate').value;
    const endDate = document.getElementById('fullDayEndDate').value;
    const dayCheckboxes = document.querySelectorAll('.fullday-checkbox:checked');
    const selectedDays = Array.from(dayCheckboxes).map(cb => parseInt(cb.value));

    if (!startDate || !endDate) {
        showNotification('날짜 범위를 선택해주세요.', 'warning');
        return;
    }

    if (selectedDays.length === 0) {
        showNotification('복사할 요일을 선택해주세요.', 'warning');
        return;
    }

    const siteId = getCurrentSiteId();

    // ★ 보안: site_id 및 category 필수 검증 (데이터 혼용 방지)
    if (!siteId) {
        showNotification('사업장을 선택해주세요. 사업장 없이 복사할 수 없습니다.', 'error');
        return;
    }

    if (!modalSelectedCategory || modalSelectedCategory === '전체') {
        showNotification('특정 카테고리를 선택해주세요. 전체 모드에서는 복사할 수 없습니다.', 'error');
        return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    let copyCount = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
        if (!selectedDays.includes(dayOfWeek)) continue;

        const dateKey = d.toISOString().split('T')[0];

        try {
            await fetch('/api/meal-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_date: dateKey,
                    meal_data: modalMealData,
                    site_id: siteId,
                    category: modalSelectedCategory  // ★ category 추가
                })
            });
            copyCount++;
        } catch (e) {
            console.error(`날짜 전체 복사 실패 (${dateKey}):`, e);
        }
    }

    closeFullDayCopyModal();

    // 캘린더 데이터 다시 로드
    await loadMealPlansFromServer();
    syncMealData();
    generateCalendar();

    showNotification(`${copyCount}개 날짜에 전체 메뉴가 복사되었습니다.`, 'success');
}

// 전역 함수 등록
window.openSlotCopyModal = openSlotCopyModal;
window.closeSlotCopyModal = closeSlotCopyModal;
window.executeSequentialCopy = executeSequentialCopy;
window.onCopyTargetChange = onCopyTargetChange;
window.updateSlotCheckStyle = updateSlotCheckStyle;
window.openFullDayCopyModal = openFullDayCopyModal;
window.closeFullDayCopyModal = closeFullDayCopyModal;
window.executeFullDayCopy = executeFullDayCopy;

/**
 * 📋 일괄 슬롯 복사 모달 열기
 * 복수 슬롯을 선택하고 날짜/사업장/카테고리 조합으로 복사
 */
async function openBulkSlotCopyModal() {
    // 현재 슬롯 목록 가져오기
    const slots = Object.keys(modalMealData || {}).filter(slot => modalMealData[slot]?.length > 0);

    if (slots.length === 0) {
        showNotification('복사할 슬롯이 없습니다. 먼저 메뉴를 추가해주세요.', 'warning');
        return;
    }

    // 사업장 목록 가져오기
    const sites = await getSiteList();

    // 카테고리 목록
    const categories = ['도시락', '운반', '학교', '요양원'];

    // 오늘 날짜
    const today = new Date().toISOString().split('T')[0];

    // 모달 생성
    let modal = document.getElementById('bulkSlotCopyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'bulkSlotCopyModal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        " onclick="closeBulkSlotCopyModal()">
            <div style="
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 700px;
                max-height: 85vh;
                overflow-y: auto;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            " onclick="event.stopPropagation()">
                <!-- 헤더 -->
                <div style="
                    padding: 16px 20px;
                    border-bottom: 1px solid #e9ecef;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: linear-gradient(135deg, #9b59b6, #8e44ad);
                    color: white;
                    border-radius: 12px 12px 0 0;
                ">
                    <h3 style="margin: 0; font-size: 18px;">📋 선택 슬롯 복사</h3>
                    <button onclick="closeBulkSlotCopyModal()" style="
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: white;
                    ">&times;</button>
                </div>

                <div style="padding: 20px;">
                    <!-- 1. 복사할 슬롯 선택 -->
                    <div style="margin-bottom: 20px;">
                        <label style="font-weight: 600; color: #495057; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                            <span style="background: #9b59b6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;">1</span>
                            복사할 슬롯 선택
                            <button onclick="toggleAllBulkSlots()" style="margin-left: auto; padding: 4px 10px; font-size: 11px; border: 1px solid #9b59b6; background: white; color: #9b59b6; border-radius: 4px; cursor: pointer;">전체 선택/해제</button>
                        </label>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; max-height: 150px; overflow-y: auto; background: #f8f9fa; padding: 12px; border-radius: 8px;">
                            ${slots.map(slot => {
        const menus = modalMealData[slot] || [];
        const menuCount = menus.length;
        const menuNames = menus.map(m => m.name).join(', ');
        return `
                                    <label style="
                                        display: flex;
                                        align-items: center;
                                        padding: 10px;
                                        background: white;
                                        border-radius: 8px;
                                        cursor: pointer;
                                        border: 2px solid transparent;
                                        transition: all 0.2s;
                                    " onmouseover="this.style.borderColor='#9b59b6'" onmouseout="this.style.borderColor=this.querySelector('input').checked ? '#9b59b6' : 'transparent'">
                                        <input type="checkbox" class="bulk-slot-checkbox" value="${slot}" style="margin-right: 10px; transform: scale(1.2);">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-weight: 600; font-size: 13px;">${slot}</div>
                                            <div style="font-size: 11px; color: #6c757d; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${menuNames}">${menuCount}개: ${menuNames}</div>
                                        </div>
                                    </label>
                                `;
    }).join('')}
                        </div>
                    </div>

                    <!-- 2. 복사 대상 설정 -->
                    <div style="margin-bottom: 20px;">
                        <label style="font-weight: 600; color: #495057; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                            <span style="background: #9b59b6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;">2</span>
                            복사 대상 설정
                        </label>

                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                            <!-- 날짜 범위 -->
                            <div style="margin-bottom: 12px;">
                                <label style="font-size: 13px; color: #495057; display: block; margin-bottom: 6px;">📅 날짜 범위</label>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <input type="date" id="bulkCopyStartDate" value="${today}" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                                    <span>~</span>
                                    <input type="date" id="bulkCopyEndDate" value="${today}" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                                </div>
                            </div>

                            <!-- 요일 선택 -->
                            <div style="margin-bottom: 12px;">
                                <label style="font-size: 13px; color: #495057; display: block; margin-bottom: 6px;">📆 요일 선택</label>
                                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                    ${['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => `
                                        <label style="
                                            display: flex;
                                            align-items: center;
                                            justify-content: center;
                                            width: 36px;
                                            height: 36px;
                                            background: ${idx === 0 ? '#ffebee' : idx === 6 ? '#e3f2fd' : '#fff'};
                                            border: 2px solid #e9ecef;
                                            border-radius: 8px;
                                            cursor: pointer;
                                            font-size: 13px;
                                            font-weight: 600;
                                            color: ${idx === 0 ? '#c62828' : idx === 6 ? '#1565c0' : '#495057'};
                                        ">
                                            <input type="checkbox" class="bulk-copy-day" value="${idx}" ${idx >= 1 && idx <= 5 ? 'checked' : ''} style="display: none;">
                                            ${day}
                                        </label>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- 사업장 선택 -->
                            <div style="margin-bottom: 12px;">
                                <label style="font-size: 13px; color: #495057; display: block; margin-bottom: 6px;">🏢 사업장</label>
                                <select id="bulkCopySite" style="width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                                    <option value="">현재 사업장 유지</option>
                                    ${sites.map(site => `<option value="${site.id}">${site.site_name || site.name}</option>`).join('')}
                                </select>
                            </div>

                            <!-- 카테고리 선택 -->
                            <div>
                                <label style="font-size: 13px; color: #495057; display: block; margin-bottom: 6px;">🏷️ 카테고리</label>
                                <select id="bulkCopyCategory" style="width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 6px;">
                                    <option value="">현재 카테고리 유지 (${modalSelectedCategory})</option>
                                    ${categories.map(cat => `<option value="${cat}" ${cat === modalSelectedCategory ? 'selected' : ''}>${cat}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- 복사 버튼 -->
                    <button onclick="executeBulkSlotCopy()" style="
                        width: 100%;
                        padding: 14px;
                        background: linear-gradient(135deg, #9b59b6, #8e44ad);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                    ">
                        📋 선택한 슬롯 복사 실행
                    </button>
                </div>
            </div>
        </div>
    `;

    // 요일 토글 이벤트
    modal.querySelectorAll('.bulk-copy-day').forEach(checkbox => {
        checkbox.parentElement.addEventListener('click', function () {
            checkbox.checked = !checkbox.checked;
            this.style.borderColor = checkbox.checked ? '#9b59b6' : '#e9ecef';
            this.style.background = checkbox.checked
                ? (checkbox.value === '0' ? '#ffcdd2' : checkbox.value === '6' ? '#bbdefb' : '#e1bee7')
                : (checkbox.value === '0' ? '#ffebee' : checkbox.value === '6' ? '#e3f2fd' : '#fff');
        });
        // 초기 상태 설정
        if (checkbox.checked) {
            checkbox.parentElement.style.borderColor = '#9b59b6';
            checkbox.parentElement.style.background = '#e1bee7';
        }
    });

    // 슬롯 체크박스 스타일 이벤트
    modal.querySelectorAll('.bulk-slot-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function () {
            this.closest('label').style.borderColor = this.checked ? '#9b59b6' : 'transparent';
        });
    });
}

/**
 * 일괄 복사 모달 닫기
 */
function closeBulkSlotCopyModal() {
    const modal = document.getElementById('bulkSlotCopyModal');
    if (modal) {
        modal.remove();
    }
}

/**
 * 전체 슬롯 선택/해제 토글
 */
function toggleAllBulkSlots() {
    const checkboxes = document.querySelectorAll('.bulk-slot-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
        cb.closest('label').style.borderColor = cb.checked ? '#9b59b6' : 'transparent';
    });
}

/**
 * 일괄 슬롯 복사 실행
 */
async function executeBulkSlotCopy() {
    // 선택된 슬롯 가져오기
    const selectedSlots = Array.from(document.querySelectorAll('.bulk-slot-checkbox:checked')).map(cb => cb.value);

    if (selectedSlots.length === 0) {
        showNotification('복사할 슬롯을 선택해주세요.', 'warning');
        return;
    }

    // 날짜 범위
    const startDate = document.getElementById('bulkCopyStartDate').value;
    const endDate = document.getElementById('bulkCopyEndDate').value;

    if (!startDate || !endDate) {
        showNotification('날짜 범위를 선택해주세요.', 'warning');
        return;
    }

    // 선택된 요일
    const selectedDays = Array.from(document.querySelectorAll('.bulk-copy-day:checked')).map(cb => parseInt(cb.value));

    if (selectedDays.length === 0) {
        showNotification('최소 하나의 요일을 선택해주세요.', 'warning');
        return;
    }

    // 사업장 및 카테고리
    const targetSiteId = document.getElementById('bulkCopySite').value || getCurrentSiteId();
    const targetCategory = document.getElementById('bulkCopyCategory').value || modalSelectedCategory;

    // ★ 보안: site_id 및 category 필수 검증 (데이터 혼용 방지)
    if (!targetSiteId) {
        showNotification('사업장을 선택해주세요. 사업장 없이 복사할 수 없습니다.', 'error');
        return;
    }

    if (!targetCategory || targetCategory === '전체') {
        showNotification('특정 카테고리를 선택해주세요. 전체 모드에서는 복사할 수 없습니다.', 'error');
        return;
    }

    // 복사할 메뉴 데이터 준비
    let copyData = {};
    selectedSlots.forEach(slot => {
        if (modalMealData[slot] && modalMealData[slot].length > 0) {
            copyData[slot] = JSON.parse(JSON.stringify(modalMealData[slot]));
        }
    });

    console.log('[일괄복사] 선택된 슬롯:', selectedSlots);
    console.log('[일괄복사] 복사 데이터:', Object.keys(copyData), copyData);

    if (Object.keys(copyData).length === 0) {
        showNotification('복사할 데이터가 없습니다.', 'warning');
        return;
    }

    // 🔄 대상 카테고리가 다르면 변형 레시피 적용
    if (targetCategory && targetCategory !== modalSelectedCategory) {
        console.log(`[일괄복사] 카테고리 변경: ${modalSelectedCategory} → ${targetCategory}, 변형 레시피 검색...`);

        // 모든 메뉴의 ID 수집
        const allRecipeIds = [];
        Object.values(copyData).forEach(menus => {
            menus.forEach(menu => {
                if (menu.id && !allRecipeIds.includes(menu.id)) {
                    allRecipeIds.push(menu.id);
                }
            });
        });

        if (allRecipeIds.length > 0) {
            try {
                const variantResponse = await fetch('/api/recipe/find-variants', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipe_ids: allRecipeIds,
                        target_category: targetCategory
                    })
                });
                const variantResult = await variantResponse.json();

                if (variantResult.success && variantResult.variants) {
                    let replacedCount = 0;
                    // 변형 레시피로 교체
                    Object.keys(copyData).forEach(slot => {
                        copyData[slot] = copyData[slot].map(menu => {
                            const variant = variantResult.variants[String(menu.id)];
                            if (variant) {
                                console.log(`[일괄복사] 변형 적용: ${menu.name} (ID:${menu.id}) → ${variant.display_name} (ID:${variant.id})`);
                                replacedCount++;
                                return {
                                    ...menu,
                                    id: variant.id,
                                    name: variant.name,
                                    display_name: variant.display_name
                                };
                            }
                            return menu;
                        });
                    });
                    console.log(`[일괄복사] 변형 레시피 적용 완료: ${replacedCount}개`);
                }
            } catch (e) {
                console.error('[일괄복사] 변형 레시피 검색 실패:', e);
            }
        }
    }

    // 날짜 범위 내 해당 요일에 복사
    const start = new Date(startDate);
    const end = new Date(endDate);
    let copyCount = 0;
    let failCount = 0;
    const copiedDates = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        if (!selectedDays.includes(dayOfWeek)) continue;

        const dateKey = d.toISOString().split('T')[0];

        try {
            // 서버에 저장
            const response = await fetch('/api/meal-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_date: dateKey,
                    meal_data: copyData,
                    site_id: targetSiteId,
                    category: targetCategory
                })
            });
            const result = await response.json();
            if (result.success) {
                copyCount++;
                copiedDates.push(dateKey);
                console.log(`[일괄복사] 성공: ${dateKey}, 저장된 슬롯: ${result.saved_slots}`);
            } else {
                failCount++;
                console.error(`[일괄복사] 실패 (${dateKey}):`, result.error);
            }
        } catch (e) {
            failCount++;
            console.error(`복사 실패 (${dateKey}):`, e);
        }
    }

    closeBulkSlotCopyModal();

    // 현재 표시된 데이터 갱신
    await loadMealPlansFromServer();
    syncMealData();
    generateCalendar();

    showNotification(`${selectedSlots.length}개 슬롯이 ${copyCount}개 날짜에 복사되었습니다.\n(${targetCategory} 카테고리)`, 'success');
    console.log(`[일괄복사] ${selectedSlots.join(', ')} → ${copiedDates.join(', ')} (${targetCategory})`);
}

// 전역 함수 등록
window.openBulkSlotCopyModal = openBulkSlotCopyModal;
window.closeBulkSlotCopyModal = closeBulkSlotCopyModal;
window.toggleAllBulkSlots = toggleAllBulkSlots;
window.executeBulkSlotCopy = executeBulkSlotCopy;

/**
 * 일괄 슬롯 삭제 모달 열기
 */
function openBulkSlotDeleteModal() {
    // 🔧 현재 모달에 렌더링된 슬롯들을 DOM에서 직접 가져오기
    const grid = document.getElementById('modalMealInputGrid');
    const renderedSlots = grid ? Array.from(grid.querySelectorAll('.modal-meal-slot')) : [];
    const allSlotNames = renderedSlots.map(slot => slot.dataset.slotName).filter(Boolean);

    // 렌더링된 슬롯이 없으면 기존 방식으로 fallback
    if (allSlotNames.length === 0) {
        const categorySlots = getModalCategoryMenuSlots();
        allSlotNames.push(...categorySlots.map(s => s.slotName));

        // 저장된 데이터의 슬롯도 추가
        Object.keys(modalMealData || {}).forEach(slotName => {
            if (!allSlotNames.includes(slotName) && modalMealData[slotName]?.length > 0) {
                allSlotNames.push(slotName);
            }
        });
    }
    // 모달 생성
    const modal = document.createElement('div');
    modal.id = 'bulkSlotDeleteModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    `;

    modal.innerHTML = `
        <div class="bulk-delete-modal" style="
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 500px;
            max-height: 70vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        ">
            <div style="
                padding: 16px 20px;
                border-bottom: 1px solid #e9ecef;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(135deg, #e74c3c, #c0392b);
                border-radius: 12px 12px 0 0;
            ">
                <h3 style="margin: 0; font-size: 18px; color: white;">🗑️ 슬롯 일괄 삭제</h3>
                <button onclick="closeBulkSlotDeleteModal()" style="
                    background: none;
                    border: none;
                    font-size: 24px;
                    color: white;
                    cursor: pointer;
                ">&times;</button>
            </div>

            <div style="padding: 20px;">
                <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">
                    삭제할 슬롯을 선택하세요. 선택한 슬롯과 해당 슬롯의 모든 메뉴가 삭제됩니다.
                </p>

                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; background: #fff3cd; border-radius: 6px;">
                        <input type="checkbox" id="bulkDeleteSelectAll" onchange="toggleAllBulkDeleteSlots(this.checked)">
                        <span style="font-weight: 600; color: #856404;">⚠️ 전체 선택</span>
                    </label>
                </div>

                <div id="bulkDeleteSlotList" style="
                    max-height: 300px;
                    overflow-y: auto;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    padding: 8px;
                ">
                    ${allSlotNames.map(slotName => {
        const menus = modalMealData[slotName] || [];
        const menuCount = menus.length;
        const displayName = customSlotNames[slotName] || slotName;
        return `
                            <label style="
                                display: flex;
                                align-items: center;
                                gap: 10px;
                                padding: 10px;
                                border-bottom: 1px solid #f0f0f0;
                                cursor: pointer;
                                transition: background 0.2s;
                            " onmouseover="this.style.background='#fff5f5'" onmouseout="this.style.background='transparent'">
                                <input type="checkbox" class="bulk-delete-slot-checkbox" value="${slotName}">
                                <div style="flex: 1;">
                                    <div style="font-weight: 500; color: #333;">${displayName}</div>
                                    <div style="font-size: 12px; color: ${menuCount > 0 ? '#e74c3c' : '#999'};">
                                        ${menuCount > 0 ? `메뉴 ${menuCount}개` : '비어있음'}
                                    </div>
                                </div>
                            </label>
                        `;
    }).join('')}
                </div>

                <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: flex-end;">
                    <button onclick="closeBulkSlotDeleteModal()" style="
                        padding: 10px 20px;
                        border: 1px solid #ddd;
                        border-radius: 6px;
                        background: white;
                        cursor: pointer;
                    ">취소</button>
                    <button onclick="executeBulkSlotDelete()" style="
                        padding: 10px 20px;
                        border: none;
                        border-radius: 6px;
                        background: linear-gradient(135deg, #e74c3c, #c0392b);
                        color: white;
                        cursor: pointer;
                        font-weight: 600;
                    ">🗑️ 선택 삭제</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

/**
 * 일괄 삭제 모달 닫기
 */
function closeBulkSlotDeleteModal() {
    const modal = document.getElementById('bulkSlotDeleteModal');
    if (modal) modal.remove();
}

/**
 * 일괄 삭제 슬롯 전체 선택/해제
 */
function toggleAllBulkDeleteSlots(checked) {
    document.querySelectorAll('.bulk-delete-slot-checkbox').forEach(cb => {
        cb.checked = checked;
    });
}

/**
 * 일괄 슬롯 삭제 실행
 */
function executeBulkSlotDelete() {
    const selectedSlots = Array.from(document.querySelectorAll('.bulk-delete-slot-checkbox:checked'))
        .map(cb => cb.value);

    if (selectedSlots.length === 0) {
        showNotification('삭제할 슬롯을 선택해주세요.', 'warning');
        return;
    }

    // 삭제할 메뉴 수 계산
    let totalMenuCount = 0;
    selectedSlots.forEach(slotName => {
        totalMenuCount += (modalMealData[slotName] || []).length;
    });

    const confirmMsg = totalMenuCount > 0
        ? `${selectedSlots.length}개 슬롯과 ${totalMenuCount}개 메뉴를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`
        : `${selectedSlots.length}개 슬롯을 삭제하시겠습니까?`;

    if (!confirm(confirmMsg)) return;

    // 슬롯 삭제
    selectedSlots.forEach(slotName => {
        delete modalMealData[slotName];
        if (customSlotNames[slotName]) {
            delete customSlotNames[slotName];
        }
        // 삭제된 슬롯 기록 (다시 생성되지 않도록) - 현재 카테고리에만 적용
        if (!modalDeletedSlotsByCategory[modalSelectedCategory]) {
            modalDeletedSlotsByCategory[modalSelectedCategory] = new Set();
        }
        modalDeletedSlotsByCategory[modalSelectedCategory].add(slotName);
        console.log(`[슬롯 삭제] ${modalSelectedCategory} 카테고리의 '${slotName}' 삭제됨`);
        // 슬롯 순서에서도 제거
        const orderIndex = modalSlotOrder.indexOf(slotName);
        if (orderIndex > -1) {
            modalSlotOrder.splice(orderIndex, 1);
        }
    });

    // 모달 닫기 및 다시 렌더링
    closeBulkSlotDeleteModal();
    renderModalMealSlots();

    showNotification(`${selectedSlots.length}개 슬롯이 삭제되었습니다.`, 'success');
    console.log('[일괄 삭제] 삭제된 슬롯:', selectedSlots);
}

// 전역 함수 등록
window.openBulkSlotDeleteModal = openBulkSlotDeleteModal;
window.closeBulkSlotDeleteModal = closeBulkSlotDeleteModal;
window.toggleAllBulkDeleteSlots = toggleAllBulkDeleteSlots;
window.executeBulkSlotDelete = executeBulkSlotDelete;

