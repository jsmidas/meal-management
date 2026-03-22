/**
 * 메뉴/레시피 관리 모듈
 * Handsontable을 사용한 엑셀 스타일 편집기
 */

// ★ HTML 이스케이프 (XSS 방지)
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ★ 메뉴명에서 접두사/접미사 분리 및 색상 적용 HTML 생성
const KNOWN_PREFIXES = ['본사', '영남', '본', '영'];
const KNOWN_SUFFIXES = ['도', '운', '학', '요', '유', '초', '중', '고', '유,도', '어'];

function formatMenuNameWithColors(menuName) {
    if (!menuName) return '';

    const parts = menuName.split('-');
    const systemColor = '#0066cc';  // 시스템 값: 파란색
    const userColor = '#333333';    // 사용자 입력: 진한 회색

    if (parts.length === 1) {
        return `<span style="color: ${userColor}">${escapeHtml(menuName)}</span>`;
    }

    let prefix = '';
    let baseName = '';
    let suffix = '';

    if (parts.length === 2) {
        if (KNOWN_PREFIXES.includes(parts[0])) {
            prefix = parts[0];
            baseName = parts[1];
        } else if (KNOWN_SUFFIXES.includes(parts[1])) {
            baseName = parts[0];
            suffix = parts[1];
        } else {
            baseName = menuName;
        }
    } else if (parts.length >= 3) {
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

    let html = '';
    if (prefix) {
        html += `<span style="color: ${systemColor}; font-weight: 600">${escapeHtml(prefix)}</span>-`;
    }
    html += `<span style="color: ${userColor}">${escapeHtml(baseName || menuName)}</span>`;
    if (suffix) {
        html += `-<span style="color: ${systemColor}; font-weight: 600">${escapeHtml(suffix)}</span>`;
    }

    return html;
}

class MenuRecipeManagement {
    constructor() {
        // CONFIG 설정 - window.CONFIG 우선 사용, 없으면 기본값
        this.CONFIG = {
            API_BASE_URL: window.CONFIG?.API_BASE_URL || ''
        };

        // 멤버 변수 초기화
        this.hot = null; // Handsontable 인스턴스
        this.currentRow = -1; // 현재 선택된 행
        this.ingredientsData = []; // 전체 식자재 데이터
        this.menus = []; // 메뉴 목록
        this.currentMenuId = null;
        this.recentlyModifiedMenus = new Set(); // 최근 수정/생성된 메뉴 IDs
        this.siteId = null; // 🏢 현재 선택된 사업장 ID
        this.currentRecipeOwnerSiteId = null; // 🔒 현재 선택된 레시피의 소유 사업장 ID
        this.allowedSuppliers = new Set(); // 🚚 현재 사업장에서 발주 가능한 협력업체 이름 Set
        this.currentMenuSiteAbbr = ''; // 현재 메뉴의 사업장 약어 (preview fallback용)
        this.currentMenuCatAbbr = ''; // 현재 메뉴의 카테고리 약어 (preview fallback용)

        // 사진 관련 변수
        this.currentPhotoFile = null;
        this.currentPhotoUrl = null;
        this.currentPhotoType = null; // 'file', 'url', 'existing'

        // 검색 결과 저장
        this.searchResults = null;

        // 이벤트 바인딩
        this.bindEvents();
    }

    /**
     * 모듈 초기화
     */
    init() {
        console.log('[MenuRecipeManagement] 모듈 초기화 시작');
        console.log('[MenuRecipeManagement] CONFIG:', this.CONFIG);
        console.log('[MenuRecipeManagement] window.CONFIG:', window.CONFIG);

        // Handsontable 라이브러리 확인
        if (typeof Handsontable === 'undefined') {
            console.error('[MenuRecipeManagement] Handsontable 라이브러리가 로드되지 않았습니다.');
            return false;
        }

        // DOM 요소 확인
        if (!document.getElementById('ingredientsGrid')) {
            console.error('[MenuRecipeManagement] ingredientsGrid 요소를 찾을 수 없습니다.');
            return false;
        }

        // 그리드 초기화
        this.initGrid();

        // 메뉴 목록 로드
        this.loadMenus();

        // 전역 함수들을 window에 등록 (기존 코드와의 호환성)
        this.registerGlobalFunctions();

        // 🚚 초기 사업장의 발주 가능 협력업체 로드
        this.loadAllowedSuppliers();

        // 접두사/접미사 미리보기 이벤트 등록
        this.initPrefixSuffixPreview();

        console.log('[MenuRecipeManagement] 모듈 초기화 완료');
        return true;
    }

    /**
     * 접두사/접미사 미리보기 초기화
     */
    initPrefixSuffixPreview() {
        const prefixInput = document.getElementById('menuPrefix');
        const nameInput = document.getElementById('menuName');
        const suffixInput = document.getElementById('menuSuffix');

        if (prefixInput && nameInput && suffixInput) {
            const updatePreview = () => this.updateMenuDisplayPreview();
            prefixInput.addEventListener('input', updatePreview);
            nameInput.addEventListener('input', updatePreview);
            suffixInput.addEventListener('input', updatePreview);
        }
    }

    /**
     * 메뉴 표시명 미리보기 업데이트
     */
    updateMenuDisplayPreview() {
        const prefixInput = document.getElementById('menuPrefix')?.value.trim() || '';
        const name = document.getElementById('menuName')?.value.trim() || '';
        const suffixInput = document.getElementById('menuSuffix')?.value.trim() || '';
        const preview = document.getElementById('menuDisplayPreview');
        const prefixElement = document.getElementById('menuPrefix');
        const suffixElement = document.getElementById('menuSuffix');

        // ★ 접두사에 '-' 포함 시 경고
        if (prefixInput.includes('-')) {
            if (prefixElement) {
                prefixElement.style.borderColor = '#dc3545';
                prefixElement.style.backgroundColor = '#fff5f5';
            }
            let warningEl = document.getElementById('prefixWarning');
            if (!warningEl) {
                warningEl = document.createElement('small');
                warningEl.id = 'prefixWarning';
                warningEl.style.color = '#dc3545';
                warningEl.style.display = 'block';
                warningEl.style.marginTop = '4px';
                prefixElement?.parentNode?.appendChild(warningEl);
            }
            warningEl.textContent = '⚠️ 접두사에 "-"를 포함하면 안됩니다. 구분자는 자동으로 추가됩니다.';
        } else {
            if (prefixElement) {
                prefixElement.style.borderColor = '';
                prefixElement.style.backgroundColor = '';
            }
            const warningEl = document.getElementById('prefixWarning');
            if (warningEl) warningEl.remove();
        }

        // ★ 접미사에 '-' 포함 시 경고
        if (suffixInput.includes('-')) {
            if (suffixElement) {
                suffixElement.style.borderColor = '#dc3545';
                suffixElement.style.backgroundColor = '#fff5f5';
            }
            // 경고 메시지 표시 (기존 경고가 없으면 추가)
            let warningEl = document.getElementById('suffixWarning');
            if (!warningEl) {
                warningEl = document.createElement('small');
                warningEl.id = 'suffixWarning';
                warningEl.style.color = '#dc3545';
                warningEl.style.display = 'block';
                warningEl.style.marginTop = '4px';
                suffixElement?.parentNode?.appendChild(warningEl);
            }
            warningEl.textContent = '⚠️ 접미사에 "-"를 포함하면 안됩니다. 구분자는 자동으로 추가됩니다.';
        } else {
            // 정상인 경우 경고 제거
            if (suffixElement) {
                suffixElement.style.borderColor = '';
                suffixElement.style.backgroundColor = '';
            }
            const warningEl = document.getElementById('suffixWarning');
            if (warningEl) warningEl.remove();
        }

        if (preview) {
            // 입력된 값 우선, 없으면 현재 메뉴의 약어 사용
            const displayPrefix = prefixInput || this.currentMenuSiteAbbr || '';
            const displaySuffix = suffixInput || this.currentMenuCatAbbr || '';

            // ★ 시스템 값인지 사용자 입력인지 구분
            const isPrefixFromSystem = !prefixInput && this.currentMenuSiteAbbr;
            const isSuffixFromSystem = !suffixInput && this.currentMenuCatAbbr;

            // ★ 색상 구분: 시스템 값은 파란색(#0066cc), 사용자 입력은 검정색
            const systemColor = '#0066cc';  // 파란색
            const userColor = '#333333';    // 진한 회색 (검정에 가까움)

            let displayName = name || '(메뉴명)';
            let htmlContent = '';

            // 접두사 부분
            if (displayPrefix) {
                const prefixColor = isPrefixFromSystem ? systemColor : userColor;
                htmlContent += `<span style="color: ${prefixColor}; font-weight: ${isPrefixFromSystem ? '600' : 'normal'}">${displayPrefix}</span>-`;
            }

            // 메뉴명 부분
            htmlContent += `<span style="color: ${userColor}">${displayName}</span>`;

            // 접미사 부분
            if (displaySuffix) {
                const suffixColor = isSuffixFromSystem ? systemColor : userColor;
                htmlContent += `-<span style="color: ${suffixColor}; font-weight: ${isSuffixFromSystem ? '600' : 'normal'}">${displaySuffix}</span>`;
            }

            preview.innerHTML = htmlContent;

            // 참고: fallback 적용 시 tooltip 표시
            let tooltipParts = [];
            if (isPrefixFromSystem) {
                tooltipParts.push(`접두사: 사업장 약어(${this.currentMenuSiteAbbr}) 자동 적용`);
            }
            if (isSuffixFromSystem) {
                tooltipParts.push(`접미사: 카테고리 약어(${this.currentMenuCatAbbr}) 자동 적용`);
            }
            preview.title = tooltipParts.join(' / ');
        }
    }

    /**
     * 🏢 사업장 ID 및 약어 설정
     */
    setSiteId(siteId, siteAbbr = '') {
        console.log('[MenuRecipeManagement] 사업장 ID 설정:', siteId, '약어:', siteAbbr);
        this.siteId = siteId;
        // 사업장 약어 저장 (새 레시피 생성 시 접두사 자동 입력용)
        this.currentMenuSiteAbbr = siteAbbr || '';
        // 🚚 사업장 변경 시 발주 가능 협력업체 다시 로드
        this.loadAllowedSuppliers();
        // preview 업데이트
        this.updateMenuDisplayPreview();
    }

    /**
     * 🏢 현재 사업장 ID 가져오기
     */
    getSiteId() {
        // 외부 함수에서 가져오기 시도
        if (typeof getCurrentSiteId === 'function') {
            return getCurrentSiteId() || this.siteId;
        }
        return this.siteId;
    }

    /**
     * 🚚 현재 사업장의 발주 가능 협력업체 로드
     */
    async loadAllowedSuppliers() {
        const siteId = this.getSiteId();
        if (!siteId) {
            console.log('[발주가능] 사업장 ID 없음 - 전체 허용');
            this.allowedSuppliers = new Set(); // 빈 Set = 전체 허용으로 처리
            return;
        }

        try {
            const response = await fetch(`/api/admin/sites/${siteId}/suppliers`);
            const data = await response.json();

            if (data.success && data.data) {
                // 협력업체 이름을 Set에 저장
                this.allowedSuppliers = new Set(data.data.map(s => s.supplier_name));
                console.log(`[발주가능] 사업장 ${siteId}의 허용 협력업체 ${this.allowedSuppliers.size}개:`, [...this.allowedSuppliers]);
            } else {
                console.warn('[발주가능] 협력업체 목록 로드 실패:', data.error);
                this.allowedSuppliers = new Set();
            }

            // 🚚 그리드가 있으면 새로고침 (발주불가 표시 업데이트)
            if (this.hot) {
                this.hot.render();
            }
        } catch (error) {
            console.error('[발주가능] API 오류:', error);
            this.allowedSuppliers = new Set();
        }
    }

    /**
     * 🚚 협력업체가 발주 가능한지 체크
     */
    isSupplierAllowed(supplierName) {
        // allowedSuppliers가 비어있으면 전체 허용 (사업장 미선택 또는 제한 없음)
        if (this.allowedSuppliers.size === 0) {
            return true;
        }
        // 협력업체명이 없으면 허용
        if (!supplierName || supplierName.trim() === '') {
            return true;
        }
        return this.allowedSuppliers.has(supplierName);
    }

    /**
     * 🔒 편집 권한 체크
     * - owner_site_id가 null이면 본사 레시피 (admin만 수정 가능)
     * - owner_site_id가 현재 사업장과 같으면 수정 가능
     */
    hasEditPermission() {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        const userRole = userInfo.role || 'viewer';
        const currentSiteId = this.getSiteId();

        // admin은 모든 레시피 수정 가능
        if (userRole === 'admin') {
            return true;
        }

        // 새 메뉴 생성 시에는 항상 허용
        if (!this.currentMenuId || !this.currentRecipeOwnerSiteId) {
            return true;
        }

        // 레시피 소유 사업장과 현재 사업장이 같으면 수정 가능
        return this.currentRecipeOwnerSiteId === currentSiteId;
    }

    /**
     * 🔒 버튼 가시성 업데이트
     */
    updateButtonVisibility() {
        const canEdit = this.hasEditPermission();
        const saveButton = document.getElementById('saveButton');
        const copyButton = document.getElementById('copyButton');
        const ownershipInfo = document.getElementById('ownership-info');
        const ownershipText = document.getElementById('ownership-text');

        console.log('[권한 체크] canEdit:', canEdit, 'currentMenuId:', this.currentMenuId, 'ownerSiteId:', this.currentRecipeOwnerSiteId, 'mySiteId:', this.getSiteId());

        if (canEdit) {
            // 편집 권한 있음 - 저장 버튼 표시, 복사 버튼 숨김
            if (saveButton) saveButton.style.display = 'flex';
            if (copyButton) copyButton.style.display = 'none';
            if (ownershipInfo) ownershipInfo.style.display = 'none';
        } else {
            // 편집 권한 없음 - 저장 버튼 숨김, 복사 버튼 표시
            if (saveButton) saveButton.style.display = 'none';
            if (copyButton) copyButton.style.display = 'flex';
            if (ownershipInfo) ownershipInfo.style.display = 'block';
            if (ownershipText) {
                ownershipText.innerHTML = '🔒 이 레시피는 본사/다른 사업장 소유입니다. <b>복사</b>만 가능합니다.';
            }
        }
    }

    /**
     * 🔒 레시피 복사 (내 사업장으로)
     */
    async copyRecipeToMySite() {
        if (!this.currentMenuId) {
            alert('복사할 레시피를 먼저 선택해주세요.');
            return;
        }

        const targetSiteId = this.getSiteId();
        if (!targetSiteId) {
            alert('사업장을 먼저 선택해주세요.');
            return;
        }

        // 새 이름 입력 받기
        const menu = this.menus.find(m => m.id === this.currentMenuId);
        const originalName = menu ? (menu.name || menu.recipe_name) : '레시피';
        const newName = prompt('복사할 레시피 이름을 입력하세요:', `${originalName} (복사)`);

        if (!newName) {
            return; // 취소됨
        }

        try {
            const response = await fetch('/api/recipe/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipe_id: this.currentMenuId,
                    site_id: targetSiteId,
                    new_name: newName
                })
            });

            const result = await response.json();

            if (result.success) {
                alert(`✅ 레시피가 복사되었습니다: ${result.new_recipe_name}`);
                // 메뉴 목록 새로고침
                await this.loadMenus();
                // 새로 복사된 메뉴 선택
                this.selectMenu(result.new_recipe_id);
            } else {
                alert('❌ 복사 실패: ' + result.error);
            }
        } catch (error) {
            console.error('복사 오류:', error);
            alert('❌ 복사 중 오류가 발생했습니다.');
        }
    }

    /**
     * 모듈 정리
     */
    destroy() {
        console.log('[MenuRecipeManagement] 모듈 정리 시작');

        // Handsontable 인스턴스 정리
        if (this.hot) {
            this.hot.destroy();
            this.hot = null;
        }

        // 전역 함수들 제거
        this.unregisterGlobalFunctions();

        // 이벤트 리스너 제거
        this.unbindEvents();

        console.log('[MenuRecipeManagement] 모듈 정리 완료');
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // DOMContentLoaded 이벤트는 init()에서 처리
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('ingredientsGrid')) {
                this.init();
            }
        });
    }

    /**
     * 이벤트 언바인딩
     */
    unbindEvents() {
        // 필요시 이벤트 리스너 제거
    }

    /**
     * 전역 함수들을 window에 등록 (기존 코드와의 호환성)
     */
    registerGlobalFunctions() {
        const self = this;

        // 그리드 관련 함수들
        window.addRow = () => self.addRow();
        window.addRows = (count) => self.addRows(count);
        window.deleteRow = () => self.deleteRow();
        window.resetGrid = (skipConfirm) => self.resetGrid(skipConfirm);
        window.debugGrid = () => self.debugGrid();

        // 모달 관련 함수들
        window.openSearchModal = () => self.openSearchModal();
        window.closeModal = () => self.closeModal();
        window.searchIngredients = () => self.searchIngredients();

        // 메뉴 관련 함수들
        window.saveMenu = () => self.saveMenu();
        window.saveMenuAs = () => self.saveMenuAs();
        window.searchMenus = () => self.searchMenus();
        window.selectMenu = (menuId, element) => self.selectMenu(menuId, element);
        window.createNewMenu = () => self.createNewMenu();
        window.createNewMenuWithName = (menuName) => self.createNewMenuWithName(menuName);
        window.copyRecipeToMySite = () => self.copyRecipeToMySite(); // 🔒 레시피 복사

        // 엑셀 관련 함수들
        window.importFromExcel = () => self.importFromExcel();
        window.exportToExcel = () => self.exportToExcel();

        // 사진 관련 함수들
        window.handlePhotoClick = () => self.handlePhotoClick();
        window.handlePhotoUpload = (event) => self.handlePhotoUpload(event);
        window.useExistingPhoto = () => self.useExistingPhoto();
        window.clearPhoto = () => self.clearPhoto();
        window.selectExistingPhoto = (photoPath, menuName) => self.selectExistingPhoto(photoPath, menuName);

        // 검색 결과 선택 함수
        window.selectIngredientByIndex = (index) => self.selectIngredientByIndex(index);

        // 기준용량 수정 함수
        window.updateBaseWeight = (ingredientId, value, index) => self.updateBaseWeight(ingredientId, value, index);

        // 단위당 단가 모달 관련 함수
        window.openUnitPriceModal = (index) => self.openUnitPriceModal(index);
        window.closeUnitPriceModal = () => self.closeUnitPriceModal();
        window.recalculateUnitPrice = () => self.recalculateUnitPrice();

        // 단가순 정렬 함수
        window.sortByUnitPrice = () => self.sortByUnitPrice();

        // 전체 식자재 로드 함수
        window.loadAllIngredients = () => self.loadAllIngredients();
    }

    /**
     * 전역 함수들 제거
     */
    unregisterGlobalFunctions() {
        const functionsToRemove = [
            'addRow', 'deleteRow', 'resetGrid', 'debugGrid',
            'openSearchModal', 'closeModal', 'searchIngredients',
            'saveMenu', 'saveMenuAs', 'searchMenus', 'selectMenu',
            'createNewMenu', 'createNewMenuWithName',
            'importFromExcel', 'exportToExcel',
            'handlePhotoClick', 'handlePhotoUpload', 'useExistingPhoto',
            'clearPhoto', 'selectExistingPhoto', 'selectIngredientByIndex'
        ];

        functionsToRemove.forEach(funcName => {
            if (window[funcName]) {
                delete window[funcName];
            }
        });
    }

    /**
     * Handsontable 초기화
     */
    initGrid() {
        const container = document.getElementById('ingredientsGrid');
        if (!container) {
            console.error('[initGrid] ingredientsGrid 컨테이너를 찾을 수 없습니다.');
            return;
        }

        // 9개 행으로 초기 데이터 설정
        // 컬럼: 식자재코드, 식자재명, 🔍, 규격, 단위, 선발주일, 판매가, 기준용량(g), 1인필요량(g), 1인소요량, 1인재료비, 거래처명, 등록일, ingredient_id
        const data = [];
        const today = new Date().toISOString().slice(5, 10).replace(/-/g, '.'); // MM.DD 형식
        for (let i = 0; i < 9; i++) {
            // 숨김 컬럼 포함: ingredient_id(13)
            data.push(['', '', '', '', '', 0, 0, null, 0, 0, 0, '', today, null]);
        }

        this.hot = new Handsontable(container, {
            data: data,
            colHeaders: [
                '식자재코드', '식자재명', '🔍', '규격', '단위', '선발주일', '판매가', '기준용량(g)', '1인필요량(g)', '1인소요량', '1인재료비', '거래처명', '등록일',
                'ingredient_id'  // 숨김 컬럼 (13)
            ],
            colWidths: [90, 250, 35, 140, 50, 55, 70, 70, 80, 70, 75, 90, 75, 0.1],  // 등록일 60→75
            hiddenColumns: {
                columns: [13],  // ingredient_id만 숨김
                indicators: false
            },
            rowHeaders: true,
            outsideClickDeselects: false,  // 버튼 클릭 시에도 선택 유지
            height: 350,
            licenseKey: 'non-commercial-and-evaluation',
            afterChange: (changes, source) => {
                // loadData, auto, select 소스는 무시 (체인 호출 방지)
                if (source === 'loadData' || source === 'auto' || source === 'select') return;

                changes?.forEach(([row, prop, oldValue, newValue]) => {
                    // 기준용량(g) 변경 시 DB에 저장하고 재계산
                    if (prop === 7) { // 기준용량(g)
                        const ingredientId = this.hot.getDataAtCell(row, 13);
                        const baseWeight = parseFloat(newValue) || null;

                        // DB에 저장
                        if (ingredientId && source !== 'auto') {
                            this.saveBaseWeightToDb(ingredientId, baseWeight);
                        }

                        // 1인필요량이 있으면 1인소요량 재계산
                        const requiredGrams = parseFloat(this.hot.getDataAtCell(row, 8)) || 0;
                        if (requiredGrams > 0 && baseWeight > 0) {
                            const price = this.hot.getDataAtCell(row, 6) || 0;
                            const ratio = requiredGrams / baseWeight;
                            const roundedRatio = Math.round(ratio * 10000) / 10000;
                            this.hot.setDataAtCell(row, 9, roundedRatio, 'auto');
                            const cost = Math.round(price * roundedRatio);
                            this.hot.setDataAtCell(row, 10, cost, 'auto');
                        }
                    }

                    // 1인필요량(g)이 변경되면 1인소요량과 1인재료비 자동 계산
                    if (prop === 8) { // 1인필요량(g)
                        const spec = this.hot.getDataAtCell(row, 3) || ''; // 규격
                        const unit = (this.hot.getDataAtCell(row, 4) || '').toUpperCase(); // 단위
                        const price = this.hot.getDataAtCell(row, 6) || 0; // 판매가
                        const requiredGrams = parseFloat(newValue) || 0;
                        const baseWeightGrams = parseFloat(this.hot.getDataAtCell(row, 7)) || null; // 기준용량(g)

                        // 규격 또는 단위에서 총량(g) 계산 (base_weight_grams 우선)
                        const totalGrams = this.getTotalGrams(spec, unit, baseWeightGrams);

                        if (totalGrams > 0 && requiredGrams > 0) {
                            // 1인소요량 = 필요량 / 총량
                            const ratio = requiredGrams / totalGrams;
                            const roundedRatio = Math.round(ratio * 10000) / 10000; // 소수점 4자리
                            this.hot.setDataAtCell(row, 9, roundedRatio, 'auto');

                            // 1인재료비 = 판매가 * 1인소요량
                            const cost = Math.round(price * roundedRatio);
                            this.hot.setDataAtCell(row, 10, cost, 'auto');

                            // 기준중량이 없고 사용자가 직접 입력한 경우 저장 제안
                            if (!baseWeightGrams && source !== 'auto') {
                                this.promptSaveBaseWeight(row, totalGrams, requiredGrams);
                            }
                        }
                    }

                    // 1인소요량 직접 입력 시 1인필요량(g) 역산 + 1인재료비 계산
                    if (prop === 9) { // 1인소요량
                        const spec = this.hot.getDataAtCell(row, 3) || ''; // 규격
                        const unit = (this.hot.getDataAtCell(row, 4) || '').toUpperCase(); // 단위
                        const price = this.hot.getDataAtCell(row, 6) || 0; // 판매가
                        const quantity = parseFloat(newValue) || 0;
                        const baseWeightGrams = parseFloat(this.hot.getDataAtCell(row, 7)) || null; // 기준용량(g)

                        // 규격 또는 단위에서 총량(g) 계산 (base_weight_grams 우선)
                        const totalGrams = this.getTotalGrams(spec, unit, baseWeightGrams);

                        // 1인필요량(g) 역산 = 1인소요량 × 총량
                        if (totalGrams > 0 && quantity > 0) {
                            const requiredGrams = Math.round(quantity * totalGrams * 100) / 100; // 소수점 2자리
                            this.hot.setDataAtCell(row, 8, requiredGrams, 'auto');
                        }

                        // 1인재료비 = 판매가 * 1인소요량
                        const cost = Math.round(price * quantity);
                        this.hot.setDataAtCell(row, 10, cost, 'auto');
                    }
                });

                // Handsontable이 setDataAtCell 변경사항을 완전히 반영한 후 계산
                setTimeout(() => {
                    this.calculateTotal();
                    this.updateRowCount();
                }, 10);
            },
            cells: (row, col) => {
                const cellProperties = {};

                // 식자재명 컬럼 - 클릭 가능 스타일
                if (col === 1) {
                    cellProperties.renderer = this.ingredientNameRenderer.bind(this);
                    cellProperties.readOnly = true;
                }

                // 검색 버튼 컬럼 - 읽기 전용
                if (col === 2) {
                    cellProperties.renderer = this.searchButtonRenderer.bind(this);
                    cellProperties.readOnly = true;
                }

                // 판매가 컬럼 - 우측정렬, 천원단위 쉼표
                if (col === 6) {
                    cellProperties.type = 'numeric';
                    cellProperties.numericFormat = { pattern: '0,0' };
                    cellProperties.className = 'htRight';
                }

                // 기준용량(g) 컬럼 - 연한 모래색 배경, 입력 가능
                if (col === 7) {
                    cellProperties.type = 'numeric';
                    cellProperties.className = 'highlight-sand htRight';
                    cellProperties.readOnly = false;
                }

                // 1인필요량(g) 컬럼 - 연두색 배경, 입력 가능
                if (col === 8) {
                    cellProperties.type = 'numeric';
                    cellProperties.className = 'highlight-green htRight';
                    cellProperties.readOnly = false;
                }

                // 1인소요량 컬럼 - 하늘색 배경, 입력 가능, 소수점 4자리 표시
                if (col === 9) {
                    cellProperties.type = 'numeric';
                    cellProperties.numericFormat = { pattern: '0.0000' };  // 소수점 4자리까지 표시
                    cellProperties.className = 'highlight-blue htRight';
                    cellProperties.readOnly = false;
                }

                // 1인재료비 컬럼 - 노란색 배경
                if (col === 10) {
                    cellProperties.type = 'numeric';
                    cellProperties.numericFormat = { pattern: '0,0' };
                    cellProperties.className = 'highlight-yellow htRight';
                }

                // 🚚 거래처명 컬럼 - 발주불가 협력업체 경고 표시
                if (col === 11) {
                    cellProperties.renderer = this.supplierRenderer.bind(this);
                }

                return cellProperties;
            }
        });

        // 검색 버튼 또는 식자재명 클릭 이벤트
        this.hot.addHook('afterOnCellMouseDown', (event, coords) => {
            console.log('[클릭] row:', coords.row, 'col:', coords.col);
            if (coords.col === 2) { // 검색 버튼 컬럼
                this.currentRow = coords.row;
                this.openSearchModal();
            } else if (coords.col === 1) { // 식자재명 컬럼 클릭
                const ingredientName = this.hot.getDataAtCell(coords.row, 1);
                console.log('[식자재명 클릭] ingredientName:', ingredientName);
                if (ingredientName) {
                    this.currentRow = coords.row;
                    // 괄호 앞의 순수 식자재명만 추출 (예: "연두부(동화식품,냉장,수입)" → "연두부")
                    const pureName = ingredientName.split('(')[0].trim();
                    console.log('[식자재명 클릭] pureName:', pureName);
                    this.openSearchModalWithQuery(pureName);
                }
            }
        });
    }

    /**
     * 규격 문자열에서 총량(g)을 파싱
     * 예: "20kg" → 20000, "500g" → 500, "1L" → 1000, "200ml" → 200
     */
    parseSpecToGrams(spec) {
        if (!spec) return 0;

        const specStr = String(spec).toLowerCase().replace(/\s/g, '');

        // kg 단위
        let match = specStr.match(/(\d+\.?\d*)\s*kg/);
        if (match) return parseFloat(match[1]) * 1000;

        // g 단위
        match = specStr.match(/(\d+\.?\d*)\s*g(?!a)/); // ga 제외
        if (match) return parseFloat(match[1]);

        // L 단위 (리터 → ml → g 근사)
        match = specStr.match(/(\d+\.?\d*)\s*l(?!b)/);
        if (match) return parseFloat(match[1]) * 1000;

        // ml 단위
        match = specStr.match(/(\d+\.?\d*)\s*ml/);
        if (match) return parseFloat(match[1]);

        // 숫자만 있는 경우 (g으로 가정)
        match = specStr.match(/^(\d+\.?\d*)$/);
        if (match) return parseFloat(match[1]);

        // 숫자*개수 형태 (예: "200g*10" → 2000)
        match = specStr.match(/(\d+\.?\d*)\s*g?\s*[x×\*]\s*(\d+)/);
        if (match) return parseFloat(match[1]) * parseFloat(match[2]);

        return 0;
    }

    /**
     * 규격 또는 단위에서 총량(g) 계산
     * 우선순위:
     * 1. 사용자 보정값 (base_weight_grams) - DB에 저장된 값
     * 2. 규격에서 파싱 (parseSpecToGrams)
     * 3. 단위 기반 폴백 (KG→1000g, G→1g, L→1000ml, ML→1ml)
     */
    getTotalGrams(spec, unit, baseWeightGrams = null) {
        // 1순위: 사용자 보정값 (DB에 저장된 base_weight_grams)
        if (baseWeightGrams && baseWeightGrams > 0) {
            return baseWeightGrams;
        }

        // 2순위: 규격에서 총량 파싱 시도
        let totalGrams = this.parseSpecToGrams(spec);
        if (totalGrams > 0) {
            return totalGrams;
        }

        // 3순위: 규격에서 파싱 실패 시 단위 기준으로 계산
        if (unit) {
            const upperUnit = unit.toUpperCase();
            if (upperUnit === 'KG') {
                totalGrams = 1000; // 1KG = 1000g
            } else if (upperUnit === 'G') {
                totalGrams = 1; // 1G = 1g
            } else if (upperUnit === 'L') {
                totalGrams = 1000; // 1L ≈ 1000ml
            } else if (upperUnit === 'ML') {
                totalGrams = 1; // 1ML = 1ml
            }
        }

        return totalGrams;
    }

    /**
     * 등록일 포맷팅 (YY.MM.DD)
     * @param {string} dateStr - ISO 형식 날짜 문자열
     * @returns {string} YY.MM.DD 형식 문자열
     */
    formatCreatedAt(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '';
            const yy = String(date.getFullYear()).slice(2);
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${yy}.${mm}.${dd}`;
        } catch (e) {
            return '';
        }
    }

    /**
     * 기준중량 저장 제안 팝업
     * 사용자가 1인필요량(g)을 입력했을 때 역산된 기준중량을 DB에 저장할지 물어봄
     */
    async promptSaveBaseWeight(row, calculatedTotalGrams, requiredGrams) {
        const ingredientId = this.hot.getDataAtCell(row, 13); // ingredient_id
        const ingredientName = this.hot.getDataAtCell(row, 1); // 식자재명
        const spec = this.hot.getDataAtCell(row, 3); // 규격
        const unit = this.hot.getDataAtCell(row, 4); // 단위
        const quantity = parseFloat(this.hot.getDataAtCell(row, 9)) || 0; // 1인소요량

        // ingredient_id가 없으면 저장 불가
        if (!ingredientId) {
            console.log('ingredient_id가 없어 기준중량 저장 불가');
            return;
        }

        // 이미 저장된 base_weight_grams가 있으면 스킵
        const existingBaseWeight = parseFloat(this.hot.getDataAtCell(row, 7)) || 0;
        if (existingBaseWeight > 0) {
            return;
        }

        // 역산된 기준중량 계산 (1인필요량 / 1인소요량)
        let baseWeightToSave = calculatedTotalGrams;
        if (quantity > 0 && requiredGrams > 0) {
            baseWeightToSave = Math.round(requiredGrams / quantity);
        }

        // 확인 팝업
        const message = `"${ingredientName}"의 기준중량을 ${baseWeightToSave}g으로 저장하시겠습니까?\n\n` +
            `• 규격: ${spec}\n` +
            `• 단위: ${unit}\n` +
            `• 계산된 기준중량: ${baseWeightToSave}g\n\n` +
            `저장하면 이 식자재를 다음에 사용할 때 자동으로 적용됩니다.`;

        if (confirm(message)) {
            try {
                const response = await fetch(`${this.CONFIG.API_BASE_URL}/api/ingredients/${ingredientId}/base-weight`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ base_weight_grams: baseWeightToSave })
                });

                const result = await response.json();
                if (result.success) {
                    // 그리드에도 저장된 값 반영 (기준용량(g) 컬럼 7)
                    this.hot.setDataAtCell(row, 7, baseWeightToSave, 'auto');
                    alert(`✅ "${ingredientName}"의 기준중량이 ${baseWeightToSave}g으로 저장되었습니다.`);
                } else {
                    alert(`❌ 저장 실패: ${result.error}`);
                }
            } catch (error) {
                console.error('기준중량 저장 오류:', error);
                alert(`❌ 저장 중 오류 발생: ${error.message}`);
            }
        }
    }

    /**
     * 식자재명 렌더러 - 클릭하면 검색
     */
    ingredientNameRenderer(instance, td, row, col, prop, value, cellProperties) {
        const text = value || '';
        td.innerHTML = `<span class="ingredient-name-link" style="color: #007bff; cursor: pointer; text-decoration: underline;">${text}</span>`;
        td.style.padding = '2px 5px';

        // 클릭 이벤트 추가
        td.onclick = (e) => {
            e.stopPropagation();
            if (text) {
                this.currentRow = row;
                // 핵심 식자재명 추출
                const pureName = this.extractCoreName(text);
                console.log('[식자재명 렌더러 클릭] pureName:', pureName);
                this.openSearchModalWithQuery(pureName);
            }
        };
        return td;
    }

    /**
     * 식자재명에서 핵심 이름 추출
     * 예: "연두부(동화식품,냉장,수입)" → "연두부"
     * 예: "(식자재왕)얇은피김치만두_(30g*50)_1.5kg" → "얇은피김치만두"
     * 예: "[냉동]돈육앞다리_국내산" → "돈육앞다리"
     */
    extractCoreName(fullName) {
        if (!fullName) return '';

        console.log('[extractCoreName] 원본:', fullName);

        // 1단계: 괄호 안 내용 모두 제거 (모든 종류의 괄호)
        let cleaned = fullName
            .replace(/\([^)]*\)/g, '')      // 반각 소괄호 ()
            .replace(/（[^）]*）/g, '')      // 전각 소괄호 （）
            .replace(/\[[^\]]*\]/g, '')     // 반각 대괄호 []
            .replace(/［[^］]*］/g, '')      // 전각 대괄호 ［］
            .replace(/【[^】]*】/g, '')      // 【】
            .replace(/〔[^〕]*〕/g, '')      // 〔〕
            .trim();

        console.log('[extractCoreName] 괄호 제거 후:', cleaned);

        // 2단계: 구분자로 분리 후 첫 부분
        cleaned = cleaned.split(/[_\-,\/]/)[0].trim();
        console.log('[extractCoreName] 구분자 제거 후:', cleaned);

        // 3단계: 결과에서 한글 추출
        if (cleaned) {
            const koreanMatch = cleaned.match(/[가-힣]+/);
            if (koreanMatch) {
                console.log('[extractCoreName] 최종:', koreanMatch[0]);
                return koreanMatch[0];
            }
        }

        // 4단계: 위 방법 실패 시 원본에서 가장 긴 한글 단어
        const koreanWords = fullName.match(/[가-힣]+/g);
        if (koreanWords && koreanWords.length > 0) {
            const longest = koreanWords.reduce((a, b) => a.length >= b.length ? a : b);
            console.log('[extractCoreName] 가장 긴 한글:', longest);
            return longest;
        }

        return fullName.substring(0, 5);
    }

    /**
     * 검색 버튼 렌더러
     */
    searchButtonRenderer(instance, td, row, col, prop, value, cellProperties) {
        td.innerHTML = '<button class="search-btn">🔍</button>';
        td.style.padding = '0';
        return td;
    }

    /**
     * 🚚 거래처명 렌더러 - 발주불가 협력업체 경고 표시
     */
    supplierRenderer(instance, td, row, col, prop, value, cellProperties) {
        const supplierName = value || '';

        // 협력업체가 발주 가능한지 체크
        const isAllowed = this.isSupplierAllowed(supplierName);

        if (!supplierName) {
            // 협력업체 없음
            td.innerHTML = '';
            td.style.background = '';
        } else if (isAllowed) {
            // 발주 가능
            td.innerHTML = `<span style="color: #333;">${supplierName}</span>`;
            td.style.background = '';
        } else {
            // ⚠️ 발주 불가
            td.innerHTML = `<span style="color: #dc3545; font-weight: 600;" title="이 사업장에서 발주할 수 없는 협력업체입니다">⚠️ ${supplierName}</span>`;
            td.style.background = '#fff5f5';
        }

        td.style.padding = '2px 5px';
        td.style.fontSize = '12px';
        return td;
    }

    /**
     * 행 추가 (1개)
     */
    addRow() {
        const today = new Date().toISOString().slice(5, 10).replace(/-/g, '.'); // MM.DD 형식
        // 숨김 컬럼 포함: ingredient_id(12), base_weight_grams(13)
        const newRow = ['', '', '', '', '', 0, 0, 0, 0, 0, '', today, null, null];
        this.hot.alter('insert_row_below', this.hot.countRows() - 1, 1, newRow);
        this.updateRowCount();
    }

    /**
     * 여러 행 추가
     */
    addRows(count = 5) {
        const today = new Date().toISOString().slice(5, 10).replace(/-/g, '.'); // MM.DD 형식
        for (let i = 0; i < count; i++) {
            const newRow = ['', '', '', '', '', 0, 0, 0, 0, 0, '', today];
            this.hot.alter('insert_row_below', this.hot.countRows() - 1, 1, newRow);
        }
        this.updateRowCount();
    }

    /**
     * 행 내용 지우기
     */
    deleteRow() {
        const selected = this.hot.getSelected();
        if (selected) {
            const row = selected[0][0];
            // 선택된 행의 모든 데이터를 비움 (행은 유지)
            // 컬럼: 0:식자재코드, 1:식자재명, 2:🔍, 3:규격, 4:단위, 5:선발주일, 6:판매가, 7:기준용량, 8:1인필요량, 9:1인소요량, 10:1인재료비, 11:거래처명, 12:등록일, 13:ingredient_id
            const emptyRow = ['', '', '', '', '', 0, 0, 0, 0, 0, 0, '', '', null];
            // setDataAtCell로 여러 셀 일괄 업데이트
            const changes = emptyRow.map((value, col) => [row, col, value]);
            this.hot.setDataAtCell(changes, 'auto');
        } else {
            alert('지울 행을 먼저 선택해주세요.');
        }
    }

    /**
     * 그리드 데이터 디버깅 함수
     */
    debugGrid() {
        console.log('===== 그리드 디버깅 정보 =====');
        const data = this.hot.getData();
        console.log('전체 행 수:', this.hot.countRows());
        console.log('전체 열 수:', this.hot.countCols());

        // 각 행의 데이터 상세 표시
        data.forEach((row, index) => {
            // 빈 행인지 확인
            const isEmpty = !row[1] || row[1].trim() === '';
            if (!isEmpty) {
                console.log(`[행 ${index}] 데이터 있음:`);
                console.log('  식자재코드:', row[0]);
                console.log('  식자재명:', row[1]);
                console.log('  규격:', row[3]);
                console.log('  단위:', row[4]);
                console.log('  판매가:', row[6]);
                console.log('  1인필요량(g):', row[7]);
                console.log('  1인소요량:', row[8]);
                console.log('  1인재료비:', row[9]);
                console.log('  거래처명:', row[10]);
            } else {
                console.log(`[행 ${index}] 빈 행`);
            }
        });

        // 숨겨진 행이나 열이 있는지 확인
        const hiddenRows = [];
        const hiddenCols = [];

        for (let i = 0; i < this.hot.countRows(); i++) {
            if (this.hot.getRowHeight(i) === 0) {
                hiddenRows.push(i);
            }
        }

        for (let i = 0; i < this.hot.countCols(); i++) {
            if (this.hot.getColWidth(i) === 0) {
                hiddenCols.push(i);
            }
        }

        if (hiddenRows.length > 0) {
            console.log('숨겨진 행:', hiddenRows);
        }
        if (hiddenCols.length > 0) {
            console.log('숨겨진 열:', hiddenCols);
        }

        console.log('===========================');
    }

    /**
     * 전체 초기화 (메뉴명, 분류, 그리드, 조리법, 사진 모두)
     */
    resetGrid(skipConfirm = false) {
        // 데이터가 있는지 확인
        const currentData = this.hot.getData();
        let hasData = false;
        for (let row of currentData) {
            if (row[1] && row[1].trim() !== '') {  // 식자재명이 있으면 데이터가 있는 것
                hasData = true;
                break;
            }
        }

        // 메뉴명이나 분류가 있는지도 확인
        const menuName = document.getElementById('menuName')?.value || '';
        const categoryChecked = document.querySelector('input[name="category"]:checked');
        if (menuName || categoryChecked) {
            hasData = true;
        }

        // 데이터가 있을 때만 확인 메시지 표시 (skipConfirm이 false일 때)
        if (!skipConfirm && hasData) {
            if (!confirm('메뉴명, 분류, 식자재, 조리법 등 모든 내용이 초기화됩니다.\n계속하시겠습니까?')) {
                return;
            }
        }

        // 현재 메뉴 ID 초기화
        this.currentMenuId = null;

        // 메뉴명 초기화
        const menuNameEl = document.getElementById('menuName');
        if (menuNameEl) menuNameEl.value = '';

        // 분류 선택 해제
        const categoryInputs = document.querySelectorAll('input[name="category"]');
        categoryInputs.forEach(input => input.checked = false);

        // 공개 범위 기본값으로
        const scopeGlobal = document.querySelector('input[name="scope"][value="global"]');
        if (scopeGlobal) scopeGlobal.checked = true;

        // 조리법 메모 초기화
        const cookingNoteEl = document.getElementById('cookingNote');
        if (cookingNoteEl) cookingNoteEl.value = '';

        // 조리수율 초기화 (기본값 100%)
        const cookingYieldRateEl = document.getElementById('cookingYieldRate');
        if (cookingYieldRateEl) cookingYieldRateEl.value = 100;

        // 사진 초기화
        this.clearPhoto();

        // 제목 변경
        const menuTitleEl = document.getElementById('menuTitle');
        if (menuTitleEl) menuTitleEl.textContent = '새 메뉴 만들기';

        // 그리드 초기화
        const data = [];
        const today = new Date().toISOString().slice(5, 10).replace(/-/g, '.'); // MM.DD 형식
        for (let i = 0; i < 9; i++) {
            // 숨김 컬럼 포함: ingredient_id(13)
            data.push(['', '', '', '', '', 0, 0, null, 0, 0, 0, '', today, null]);
        }
        this.hot.loadData(data);
        this.updateRowCount();
        this.calculateTotal();

        console.log('[resetGrid] 전체 초기화 완료');
    }

    /**
     * 행 개수 업데이트
     */
    updateRowCount() {
        const rowCountElement = document.getElementById('rowCount');
        if (rowCountElement) {
            rowCountElement.textContent = this.hot.countRows();
        }
    }

    /**
     * 총 금액/수량 계산
     */
    calculateTotal() {
        let totalAmount = 0;
        let totalQuantity = 0;
        const data = this.hot.getData();

        data.forEach(row => {
            // 빈 행이 아닌 경우에만 계산 (식자재명이 있는 경우)
            if (row[1] && row[1].trim() !== '') {
                totalAmount += parseFloat(row[10]) || 0; // 1인재료비 합계 (컬럼 10)
                totalQuantity += parseFloat(row[8]) || 0; // 1인필요량(g) 합계 (컬럼 8)
            }
        });

        const totalAmountElement = document.getElementById('totalAmount');
        if (totalAmountElement) {
            totalAmountElement.textContent = totalAmount.toLocaleString() + '원';
        }

        const totalQuantityElement = document.getElementById('totalQuantity');
        if (totalQuantityElement) {
            totalQuantityElement.textContent = totalQuantity.toLocaleString() + 'g';
        }

        return totalAmount;
    }

    /**
     * 검색 모달 열기
     */
    openSearchModal() {
        console.log('식자재 검색 모달 열기 시도');
        const modal = document.getElementById('ingredientModal');
        console.log('모달 요소 찾기:', modal ? '성공' : '실패');

        if (modal) {
            modal.classList.add('active');
            console.log('모달 클래스 추가 완료, loadIngredients 호출');
            this.loadIngredients();
        } else {
            console.error('ingredientModal 요소를 찾을 수 없습니다');
        }
    }

    /**
     * 검색어와 함께 검색 모달 열기 (식자재명 클릭 시)
     */
    openSearchModalWithQuery(query) {
        console.log('식자재 검색 모달 열기 (검색어:', query, ')');
        const modal = document.getElementById('ingredientModal');

        if (modal) {
            modal.classList.add('active');

            // 검색 입력란에 검색어 설정
            const searchInput = document.getElementById('ingredientSearch');
            if (searchInput) {
                searchInput.value = query;
                // 자동 검색 실행
                setTimeout(() => {
                    this.searchIngredients();
                }, 100);
            }
        } else {
            console.error('ingredientModal 요소를 찾을 수 없습니다');
        }
    }

    /**
     * 모달 닫기
     */
    closeModal() {
        const modal = document.getElementById('ingredientModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * 식자재 데이터 로드 - 초기에는 안내 메시지만 표시 (DB 연결 지연 방지)
     */
    async loadIngredients() {
        const tbody = document.getElementById('searchResultsBody');
        if (!tbody) return;

        // 초기에는 API 호출하지 않고 안내 메시지만 표시
        const countSpan = document.getElementById('ingredientCount');
        if (countSpan) countSpan.textContent = '';

        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 40px; color: #666;">
                    <div style="font-size: 14px; margin-bottom: 10px;">
                        <i class="fas fa-search" style="font-size: 24px; color: #667eea; margin-bottom: 10px; display: block;"></i>
                        식자재명을 검색하거나 "전체 로드" 버튼을 클릭하세요
                    </div>
                    <div style="font-size: 12px; color: #999;">
                        전체 식자재: 약 83,000개
                    </div>
                </td>
            </tr>
        `;

        this.searchResults = [];
        return; // API 호출하지 않음

        // === 아래 코드는 실행되지 않음 (참고용) ===
        try {
            const url = `${this.CONFIG.API_BASE_URL}/api/admin/ingredients-enhanced?page=1&size=100&exclude_no_price=false`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.success && data.items) {
                let filtered = data.items.filter(item =>
                    (item['판매가'] && item['판매가'] > 0)
                );

                // 단위당 단가는 price_per_unit 필드 사용
                filtered = filtered.map((item) => {
                    item.unit_price = item.price_per_unit || 0;
                    return item;
                });

                // 단위당 단가 기준으로 정렬
                filtered.sort((a, b) => (a.price_per_unit || 0) - (b.price_per_unit || 0));

                // 검색 결과를 인스턴스 변수에 저장
                this.searchResults = filtered;

                // 개수 표시
                const countSpan = document.getElementById('ingredientCount');
                if (countSpan) countSpan.textContent = `샘플 ${filtered.length}개`;

                tbody.innerHTML = `
                    <tr style="background: #f8f9fa;">
                        <td colspan="11" style="text-align: center; padding: 10px; font-size: 12px; color: #6c757d;">
                            <strong>샘플 ${filtered.length}개</strong> - 검색하거나 "전체 로드" 클릭
                        </td>
                    </tr>
                ` + filtered.map((item, index) => {
                    const ingredientId = item.id;
                    const baseWeight = item.base_weight_grams;
                    const sellingPrice = item['판매가'] || item.selling_price || 0;
                    const unitPrice = item.price_per_unit || item['단위당 단가'] || 0;
                    const displayUnitPrice = baseWeight && baseWeight > 0
                        ? (sellingPrice / baseWeight).toFixed(2)
                        : (unitPrice > 0 ? unitPrice.toFixed(1) : '-');
                    const unitPriceColor = baseWeight && baseWeight > 0 ? '#2196f3' : '#f44336';

                    // 다함직구매 협력업체 하이라이트
                    const supplierName = item['거래처명'] || item.supplier_name || '';
                    const isDahamDirect = supplierName === '다함직구매';
                    const rowBgStyle = isDahamDirect ? 'background-color: #fffde7;' : '';

                    return `
                    <tr onclick="window.selectIngredientByIndex(${index})" style="cursor: pointer; ${rowBgStyle}">
                        <td style="padding: 2px;">
                            <div style="width: 40px; height: 40px; background: #f5f5f5; border-radius: 4px; overflow: hidden;">
                                ${item.thumbnail ?
                                  `<img src="${item.thumbnail.startsWith('/') ? item.thumbnail : '/' + item.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>` :
                                  `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>`
                                }
                            </div>
                        </td>
                        <td style="font-weight: 500;" title="${item['식자재명'] || item.ingredient_name || ''}">${item['식자재명'] || item.ingredient_name || ''}</td>
                        <td title="${item['규격'] || item.specification || ''}">${item['규격'] || item.specification || ''}</td>
                        <td>${item['단위'] || item.unit || ''}</td>
                        <td style="text-align: right;">${sellingPrice.toLocaleString()}</td>
                        <td style="text-align: center; background: #f3e5f5;" onclick="event.stopPropagation();">
                            <input type="number"
                                   class="base-weight-input"
                                   data-ingredient-id="${ingredientId || 0}"
                                   data-index="${index}"
                                   value="${baseWeight || ''}"
                                   placeholder="${(item['단위'] || item.unit) === 'KG' ? '1000' : '-'}"
                                   style="width: 70px; text-align: right; border: 1px solid ${baseWeight ? '#4caf50' : '#d4a574'}; border-radius: 3px; padding: 2px 4px; font-size: 11px; background: #fffbf0;"
                                   onclick="event.stopPropagation();"
                                   onchange="window.updateBaseWeight(${ingredientId || 0}, this.value, ${index})"
                                   onkeypress="if(event.key==='Enter'){this.blur();}"
                                   title="기준용량(g) 입력 - 입력 후 Enter">
                        </td>
                        <td style="color: ${unitPriceColor}; font-weight: 600; text-align: right;" id="unit-price-${index}"
                            title="${baseWeight ? '보정된 단가' : '자동계산 단가'}">${displayUnitPrice}</td>
                        <td style="text-align: center;">${item['선발주일'] || item.delivery_days || '1'}</td>
                        <td style="color: #666;" title="${item['거래처명'] || item.supplier_name || ''}">${item['거래처명'] || item.supplier_name || ''}</td>
                        <td style="text-align: center; color: ${item.is_published !== false ? '#4caf50' : '#f44336'};">
                            ${item.is_published !== false ? 'O' : 'X'}
                        </td>
                        <td style="text-align: center; color: ${item.is_stocked !== false ? '#4caf50' : '#f44336'};">
                            ${item.is_stocked !== false ? 'O' : 'X'}
                        </td>
                    </tr>
                `}).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: red;">데이터를 불러올 수 없습니다.</td></tr>';
            }
        } catch (error) {
            console.error('샘플 데이터 로드 실패:', error);
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: red;">데이터 로드 중 오류가 발생했습니다.</td></tr>';
        }
    }

    /**
     * 식자재 검색 - debounce 적용
     */
    searchIngredients() {
        // 이전 debounce 타이머 취소
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        // 300ms 후에 실제 검색 실행
        this.searchDebounceTimer = setTimeout(() => {
            this._executeSearch();
        }, 300);
    }

    /**
     * 실제 검색 실행 (debounce 후 호출)
     */
    async _executeSearch() {
        const searchInput = document.getElementById('ingredientSearch');
        const searchTerm = searchInput?.value?.trim() || '';
        const supplierFilter = document.getElementById('supplierFilter')?.value || '';

        // 이전 요청 취소
        if (this.searchAbortController) {
            this.searchAbortController.abort();
        }
        this.searchAbortController = new AbortController();

        const tbody = document.getElementById('searchResultsBody');
        if (!tbody) {
            console.error('searchResultsBody 요소를 찾을 수 없습니다');
            return;
        }

        // 검색어가 없으면 안내 메시지 표시
        if (!searchTerm && !supplierFilter) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; padding: 40px; color: #666;">
                        <div style="font-size: 14px; margin-bottom: 10px;">
                            <i class="fas fa-search" style="font-size: 24px; color: #667eea; margin-bottom: 10px; display: block;"></i>
                            검색어를 입력하세요
                        </div>
                        <div style="font-size: 12px; color: #999;">
                            식자재명 2글자 이상 입력 후 검색
                        </div>
                    </td>
                </tr>
            `;
            this.searchResults = [];
            const countSpan = document.getElementById('ingredientCount');
            if (countSpan) countSpan.textContent = '';
            return;
        }

        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 검색 중...</td></tr>';

        try {
            // 🏢 현재 사업장 ID 가져오기
            const siteId = this.getSiteId();

            // 서버에서 필터링 후 최대 500개만 반환 (빠른 응답)
            const params = new URLSearchParams({
                search_name: searchTerm || '',
                search_supplier: supplierFilter || '',
                page: 1,
                size: 500,  // 최대 500개만 (서버에서 필터링)
                exclude_no_price: 'false'
            });

            // 🏢 사업장 필터링 적용
            if (siteId) {
                params.append('site_id', siteId);
                console.log('[MenuRecipe] 사업장 필터링 적용:', siteId);
            }

            let url = `${this.CONFIG.API_BASE_URL}/api/admin/ingredients-enhanced?${params}`;

            const response = await fetch(url, { signal: this.searchAbortController.signal });
            const data = await response.json();

            if (data.success) {
                // ingredients API는 data.items 구조 사용
                let filtered = data.items || [];

                // 디버깅용: 엄선 돈까스소스 데이터 확인
                const eomseunItem = filtered.find(item => item['식자재명'] && item['식자재명'].includes('엄선') && item['식자재명'].includes('돈까스'));
                if (eomseunItem) {
                    console.log('엄선 돈까스소스 데이터:', eomseunItem);
                    console.log('price_per_unit:', eomseunItem.price_per_unit);
                    console.log('단위당 단가:', eomseunItem['단위당 단가']);
                }

                // 판매가가 있는 식자재만 표시
                filtered = filtered.filter(item =>
                    (item['판매가'] && item['판매가'] > 0)
                );

                // 데이터 정규화
                filtered = filtered.map(item => {
                    // 기본 정보는 이미 올바른 형태로 제공됨
                    item.delivery_days = item.delivery_days || 1;  // 기본값 1일
                    return item;
                });

                // 단위당 단가는 이미 API에서 제공됨
                filtered = filtered.map((item) => {
                    // unit_price가 이미 계산되어 제공됨
                    item.unit_price = item.unit_price || 0;
                    return item;
                });

                // 단위당 단가 기준으로 정렬 - 낮은 순, 단가 없는 것은 맨 뒤
                filtered.sort((a, b) => {
                    const priceA = this.getEffectiveUnitPrice(a);
                    const priceB = this.getEffectiveUnitPrice(b);
                    const hasNoUnitPriceA = priceA === 0 || priceA >= 999999;
                    const hasNoUnitPriceB = priceB === 0 || priceB >= 999999;

                    // 단가 없는 것은 맨 뒤로
                    if (hasNoUnitPriceA && !hasNoUnitPriceB) return 1;
                    if (!hasNoUnitPriceA && hasNoUnitPriceB) return -1;

                    // 둘 다 단가 없으면 이름순
                    if (hasNoUnitPriceA && hasNoUnitPriceB) {
                        return (a['식자재명'] || '').localeCompare(b['식자재명'] || '');
                    }

                    // 둘 다 단가 있으면 낮은 순
                    return priceA - priceB;
                });

                // 전체 결과 수 저장
                const totalResults = filtered.length;

                // 결과 개수 표시
                if (totalResults > 0) {
                    console.log(`${searchTerm ? searchTerm + ' 검색 결과: ' : ''}${totalResults}개 (단위당 단가 낮은 순)`);
                }

                // 검색 결과를 인스턴스 변수에 저장
                this.searchResults = filtered;

                tbody.innerHTML = filtered.map((item, index) => {
                    const ingredientId = item.id;
                    const baseWeight = item.base_weight_grams;
                    const sellingPrice = item['판매가'] || item.selling_price || 0;
                    const unitPrice = item.price_per_unit || item['단위당 단가'] || 0;
                    // 기준용량이 있으면 그걸로 계산, 없으면 기존 값 사용
                    const displayUnitPrice = baseWeight && baseWeight > 0
                        ? (sellingPrice / baseWeight).toFixed(2)
                        : (unitPrice > 0 ? unitPrice.toFixed(1) : '-');
                    const unitPriceColor = baseWeight && baseWeight > 0 ? '#2196f3' : '#f44336';

                    // 다함직구매 협력업체 하이라이트
                    const supplierName2 = item['거래처명'] || item.supplier_name || '';
                    const isDahamDirect2 = supplierName2 === '다함직구매';
                    const rowBgStyle2 = isDahamDirect2 ? 'background-color: #fffde7;' : '';

                    return `
            <tr onclick="window.selectIngredientByIndex(${index})"
                style="cursor: pointer; ${rowBgStyle2}">
                <td style="padding: 2px;">
                    <div style="width: 40px; height: 40px; background: #f5f5f5; border-radius: 4px; overflow: hidden;">
                        ${item.thumbnail ?
                          `<img src="${item.thumbnail.startsWith('/') ? item.thumbnail : '/' + item.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>` :
                          `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>`
                        }
                    </div>
                </td>
                <td style="font-weight: 500;" title="${item['식자재명'] || item.ingredient_name || ''}">${item['식자재명'] || item.ingredient_name || ''}</td>
                <td title="${item['규격'] || item.specification || ''}">${item['규격'] || item.specification || ''}</td>
                <td>${item['단위'] || item.unit || ''}</td>
                <td style="text-align: right;">${sellingPrice.toLocaleString()}</td>
                <td style="text-align: center; background: #f3e5f5;" onclick="event.stopPropagation();">
                    <input type="number"
                           class="base-weight-input"
                           data-ingredient-id="${ingredientId || 0}"
                           data-index="${index}"
                           value="${baseWeight || ''}"
                           placeholder="${(item['단위'] || item.unit) === 'KG' ? '1000' : '-'}"
                           style="width: 70px; text-align: right; border: 1px solid ${baseWeight ? '#4caf50' : '#d4a574'}; border-radius: 3px; padding: 2px 4px; font-size: 11px; background: #fffbf0;"
                           onclick="event.stopPropagation();"
                           onchange="window.updateBaseWeight(${ingredientId || 0}, this.value, ${index})"
                           onkeypress="if(event.key==='Enter'){this.blur();}"
                           title="기준용량(g) 입력 - 입력 후 Enter">
                </td>
                <td style="color: ${unitPriceColor}; font-weight: 600; text-align: right;" id="unit-price-${index}"
                    title="${baseWeight ? '보정된 단가' : '자동계산 단가'}">${displayUnitPrice}</td>
                <td style="text-align: center;">${item['선발주일'] || item.delivery_days || '1'}</td>
                <td style="color: #666;" title="${item['거래처명'] || item.supplier_name || ''}">${item['거래처명'] || item.supplier_name || ''}</td>
                <td style="text-align: center; color: ${item.is_published !== false ? '#4caf50' : '#f44336'};">
                    ${item.is_published !== false ? 'O' : 'X'}
                </td>
                <td style="text-align: center; color: ${item.is_stocked !== false ? '#4caf50' : '#f44336'};">
                    ${item.is_stocked !== false ? 'O' : 'X'}
                </td>
            </tr>
        `}).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;">검색 결과가 없습니다.</td></tr>';
            }
        } catch (error) {
            // 요청 취소는 무시 (새 검색이 시작된 경우)
            if (error.name === 'AbortError') {
                return;
            }
            console.error('식자재 검색 실패:', error);
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: red;">검색 중 오류가 발생했습니다.</td></tr>';
        }
    }

    /**
     * 폴백 단위당 단가 계산 (API 실패시 사용)
     */
    calculateFallbackUnitPrice(item) {
        const price = item.selling_price || item.purchase_price || 0;
        const specification = item.specification || '';

        if (!specification) {
            return price;
        }

        // kg, g 단위 파싱
        const specMatch = specification.match(/(\d+(?:\.\d+)?)\s*(kg|g)/i);
        if (specMatch) {
            const value = parseFloat(specMatch[1]);
            const unit = specMatch[2].toLowerCase();
            const grams = unit === 'kg' ? value * 1000 : value;
            return grams > 0 ? price / grams : price;
        }

        // 숫자만 있는 경우
        const numMatch = specification.match(/(\d+(?:\.\d+)?)/);
        const quantity = numMatch ? parseFloat(numMatch[1]) : 1;
        return quantity > 0 ? price / quantity : price;
    }

    /**
     * 유효 단위당 단가 계산 (정렬용)
     * - 기준용량이 있으면: 판매가 / 기준용량
     * - 없으면: 기존 price_per_unit 또는 unit_price
     * - 둘 다 없으면: 999999 (맨 뒤로)
     */
    getEffectiveUnitPrice(item) {
        const baseWeight = item.base_weight_grams;
        const sellingPrice = item['판매가'] || item.selling_price || 0;

        // 기준용량이 있으면 직접 계산
        if (baseWeight && baseWeight > 0 && sellingPrice > 0) {
            return sellingPrice / baseWeight;
        }

        // 기존 단위당 단가 사용
        const existingUnitPrice = item.price_per_unit || item['단위당 단가'] || item.unit_price || 0;
        if (existingUnitPrice > 0) {
            return existingUnitPrice;
        }

        // 없으면 맨 뒤로
        return 999999;
    }

    /**
     * 단위당 단가 기준 정렬 (버튼 클릭 시)
     * - 단가 없는 것(0 또는 미계산) 먼저
     * - 그 다음 단가 낮은 순
     */
    sortByUnitPrice() {
        if (!this.searchResults || this.searchResults.length === 0) {
            console.log('[sortByUnitPrice] 정렬할 데이터가 없습니다');
            return;
        }

        this.searchResults.sort((a, b) => {
            const priceA = this.getEffectiveUnitPrice(a);
            const priceB = this.getEffectiveUnitPrice(b);
            const hasNoUnitPriceA = priceA === 0 || priceA >= 999999;
            const hasNoUnitPriceB = priceB === 0 || priceB >= 999999;

            // 단가 없는 것 먼저
            if (hasNoUnitPriceA && !hasNoUnitPriceB) return -1;
            if (!hasNoUnitPriceA && hasNoUnitPriceB) return 1;

            // 둘 다 단가 없으면 이름순
            if (hasNoUnitPriceA && hasNoUnitPriceB) {
                return (a['식자재명'] || '').localeCompare(b['식자재명'] || '');
            }

            // 둘 다 단가 있으면 낮은 순
            return priceA - priceB;
        });

        console.log('[sortByUnitPrice] 단위당 단가 기준 정렬 완료 (단가 없는 것 먼저)');
        this.renderSearchResults();
    }

    /**
     * 단가 미보정 식자재 로드 (최대 5,000개)
     * - 단위당 단가가 없거나 0인 식자재 우선
     * - 빠른 응답을 위해 5,000개로 제한
     */
    async loadAllIngredients() {
        const tbody = document.getElementById('searchResultsBody');
        const countSpan = document.getElementById('ingredientCount');

        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 단가 미보정 식자재 로드 중... (최대 5,000개)</td></tr>';
        if (countSpan) countSpan.textContent = '로딩 중...';

        try {
            // 🏢 현재 사업장 ID 가져오기
            const siteId = this.getSiteId();
            const siteParam = siteId ? `&site_id=${siteId}` : '';

            // 5,000개만 로드 (성능 최적화)
            const url = `${this.CONFIG.API_BASE_URL}/api/admin/ingredients-enhanced?page=1&size=5000&exclude_no_price=false${siteParam}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.success && data.items) {
                let filtered = data.items.filter(item =>
                    (item['판매가'] && item['판매가'] > 0)
                );

                // 단위당 단가 기준으로 정렬 - 단가 없는 것 먼저
                filtered.sort((a, b) => {
                    const priceA = this.getEffectiveUnitPrice(a);
                    const priceB = this.getEffectiveUnitPrice(b);
                    const hasNoUnitPriceA = priceA === 0 || priceA >= 999999;
                    const hasNoUnitPriceB = priceB === 0 || priceB >= 999999;

                    if (hasNoUnitPriceA && !hasNoUnitPriceB) return -1;
                    if (!hasNoUnitPriceA && hasNoUnitPriceB) return 1;
                    if (hasNoUnitPriceA && hasNoUnitPriceB) {
                        return (a['식자재명'] || '').localeCompare(b['식자재명'] || '');
                    }
                    return priceA - priceB;
                });

                this.searchResults = filtered;
                console.log(`[loadAllIngredients] ${filtered.length}개 식자재 로드 완료 (단가 없는 것 먼저)`);

                if (countSpan) countSpan.textContent = `총 ${filtered.length.toLocaleString()}개`;
                this.renderSearchResults();
            } else {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: red;">데이터를 불러올 수 없습니다.</td></tr>';
            }
        } catch (error) {
            console.error('[loadAllIngredients] 로드 실패:', error);
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: red;">전체 로드 실패: ' + error.message + '</td></tr>';
        }
    }

    /**
     * 기준용량(g) 업데이트 - 검색 모달에서 호출
     */
    async updateBaseWeight(ingredientId, value, index) {
        console.log('[updateBaseWeight] ingredientId:', ingredientId, 'value:', value, 'index:', index);

        if (!ingredientId) {
            console.error('[updateBaseWeight] ingredientId가 없습니다');
            return;
        }

        const baseWeight = value ? parseFloat(value) : null;

        try {
            // API 호출하여 DB에 저장
            const response = await fetch(`/api/ingredients/${ingredientId}/base-weight`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_weight_grams: baseWeight })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log('[updateBaseWeight] 저장 성공:', result);

            // searchResults 배열도 업데이트
            if (this.searchResults && this.searchResults[index]) {
                this.searchResults[index].base_weight_grams = baseWeight;

                // 단위당 단가 재계산 및 저장
                const sellingPrice = this.searchResults[index].selling_price || this.searchResults[index]['판매가'] || 0;
                if (baseWeight && baseWeight > 0 && sellingPrice > 0) {
                    this.searchResults[index].unit_price = sellingPrice / baseWeight;
                    this.searchResults[index].price_per_unit = sellingPrice / baseWeight;
                }
            }

            // 성공 메시지
            console.log(`[updateBaseWeight] ${result.ingredient_name}: 기준용량 ${baseWeight}g 저장됨`);

            // 화면의 단위당 단가만 업데이트 (정렬은 하지 않음)
            const sellingPrice = this.searchResults[index]?.selling_price || this.searchResults[index]?.['판매가'] || 0;
            let newUnitPrice = '-';
            if (baseWeight && baseWeight > 0 && sellingPrice > 0) {
                newUnitPrice = (sellingPrice / baseWeight).toFixed(2);
            }
            const unitPriceCell = document.getElementById(`unit-price-${index}`);
            if (unitPriceCell) {
                unitPriceCell.textContent = newUnitPrice;
                unitPriceCell.style.color = baseWeight ? '#2196f3' : '#f44336';
            }

        } catch (error) {
            console.error('[updateBaseWeight] 저장 실패:', error);
            alert('기준용량 저장 실패: ' + error.message);
        }
    }

    /**
     * 기준용량(g)을 DB에 저장 - 레시피 그리드에서 호출
     */
    async saveBaseWeightToDb(ingredientId, baseWeight) {
        if (!ingredientId) {
            console.log('[saveBaseWeightToDb] ingredientId 없음, 저장 스킵');
            return;
        }

        try {
            const response = await fetch(`/api/ingredients/${ingredientId}/base-weight`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_weight_grams: baseWeight })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log(`[saveBaseWeightToDb] ${result.ingredient_name}: 기준용량 ${baseWeight}g 저장됨`);

        } catch (error) {
            console.error('[saveBaseWeightToDb] 저장 실패:', error);
        }
    }

    /**
     * 인덱스로 식자재 선택
     */
    selectIngredientByIndex(index) {
        if (this.searchResults && this.searchResults[index]) {
            this.selectIngredient(this.searchResults[index]);
        }
    }

    /**
     * 식자재 선택
     */
    selectIngredient(item) {
        if (this.currentRow >= 0) {
            // 기존 값 가져오기
            const existingRequiredGrams = this.hot.getDataAtCell(this.currentRow, 8) || 0;  // 1인필요량(g)
            const existingQuantity = this.hot.getDataAtCell(this.currentRow, 9) || 0;      // 1인소요량
            const existingDate = this.hot.getDataAtCell(this.currentRow, 12) || this.formatCreatedAt(new Date().toISOString());

            // 새로운 행 데이터 생성
            const sellingPrice = item.selling_price || 0;
            const ingredientId = item.id || null;  // ingredient_id
            const baseWeightGrams = item.base_weight_grams || null;  // 기준용량(g) (사용자 보정값)

            const newRowData = [
                item.ingredient_code || '',     // 0: 식자재코드
                item.name || item.ingredient_name || '',     // 1: 식자재명
                '',                             // 2: 검색버튼
                item.specification || '',       // 3: 규격
                item.unit || '',               // 4: 단위
                item.delivery_days || 0,        // 5: 선발주일
                sellingPrice,                   // 6: 판매가
                baseWeightGrams,                // 7: 기준용량(g)
                existingRequiredGrams,          // 8: 1인필요량(g)
                existingQuantity,               // 9: 1인소요량
                existingQuantity > 0 ? Math.round(sellingPrice * existingQuantity) : 0, // 10: 1인재료비
                item.supplier_name || '',       // 11: 거래처명
                existingDate,                   // 12: 등록일
                ingredientId                    // 13: ingredient_id (숨김)
            ];

            // 방법: 개별 셀 업데이트 (loadData 대신 setDataAtCell 사용 - 에디터 상태 유지)
            // 일괄 업데이트를 위한 배열 생성
            const changes = [];
            for (let i = 0; i < newRowData.length; i++) {
                if (i !== 2) { // 검색 버튼 열은 제외
                    changes.push([this.currentRow, i, newRowData[i]]);
                }
            }

            // 일괄 셀 업데이트 (setDataAtCell이 자동으로 렌더링함)
            this.hot.setDataAtCell(changes, 'select');

            // 총액 계산 및 행 수 업데이트
            this.calculateTotal();
            this.updateRowCount();
        } else {
            alert('선택할 행을 먼저 클릭해주세요.');
        }

        this.closeModal();
    }

    /**
     * 메뉴 저장
     */
    async saveMenu() {
        console.log('[saveMenu] ===== 저장 시작 =====');
        console.log('[saveMenu] 1. 입력값 확인');
        const menuName = document.getElementById('menuName')?.value || '';

        // 라디오 버튼에서 선택된 카테고리 가져오기
        const categoryRadio = document.querySelector('input[name="category"]:checked');
        const category = categoryRadio ? categoryRadio.value : '';

        console.log('[saveMenu] menuName:', menuName);
        console.log('[saveMenu] category:', category);

        if (!menuName) {
            console.log('[saveMenu] 메뉴명 없음 - 종료');
            alert('메뉴명을 입력해주세요.');
            return;
        }

        // 메뉴명 특수문자 검증
        const invalidChars = menuName.match(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ()&*,/+\[\]-]/g);
        if (invalidChars) {
            const unique = [...new Set(invalidChars)].join(' ');
            alert(`메뉴명에 사용할 수 없는 문자가 포함되어 있습니다: ${unique}\n허용: 한글, 영문, 숫자, 공백, ( ) & * - , / + [ ]`);
            return;
        }

        if (!category) {
            console.log('[saveMenu] 분류 없음 - 종료');
            alert('분류를 선택해주세요.');
            return;
        }

        console.log('[saveMenu] 2. 그리드 데이터 수집');
        const data = this.hot.getData();
        console.log('[saveMenu] 전체 데이터:', data);

        const ingredients = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[1] && row[1].toString().trim() !== '') {
                // D-1, D-2 같은 형식을 숫자로 변환
                let deliveryDays = 0;
                if (row[5]) {
                    const deliveryStr = row[5].toString();
                    if (deliveryStr.startsWith('D-')) {
                        deliveryDays = parseInt(deliveryStr.replace('D-', '')) || 0;
                    } else if (deliveryStr.startsWith('D+')) {
                        deliveryDays = parseInt(deliveryStr.replace('D+', '')) || 0;
                    } else {
                        deliveryDays = parseInt(deliveryStr) || 0;
                    }
                }

                const ingredient = {
                    ingredient_code: row[0] || '',
                    ingredient_name: row[1],
                    specification: row[3] || '',
                    unit: row[4] || '',
                    delivery_days: deliveryDays,
                    selling_price: parseFloat(row[6]) || 0,
                    required_grams: parseFloat(row[8]) || 0,  // 1인필요량(g)
                    quantity: parseFloat(row[9]) || 0,        // 1인소요량
                    amount: parseFloat(row[10]) || 0,         // 1인재료비
                    supplier_name: row[11] || ''              // 거래처명
                };
                ingredients.push(ingredient);
                console.log(`[saveMenu] 재료 ${i}:`, ingredient);
            }
        }
        console.log('[saveMenu] 필터링된 재료 개수:', ingredients.length);

        if (ingredients.length === 0) {
            console.log('[saveMenu] 재료 없음 - 종료');
            alert('최소 1개 이상의 식자재를 추가해주세요.');
            return;
        }

        const cookingNote = document.getElementById('cookingNote')?.value || '';
        const cookingYieldRate = parseFloat(document.getElementById('cookingYieldRate')?.value) || 100;

        // 접두사/접미사 가져오기
        const menuPrefix = document.getElementById('menuPrefix')?.value.trim() || '';
        const menuSuffix = document.getElementById('menuSuffix')?.value.trim() || '';
        console.log('[saveMenu] menuPrefix:', menuPrefix);
        console.log('[saveMenu] menuSuffix:', menuSuffix);

        console.log('[saveMenu] 3. FormData 생성');
        const formData = new FormData();
        formData.append('recipe_name', menuName);
        formData.append('prefix', menuPrefix);
        formData.append('suffix', menuSuffix);
        formData.append('category', category);
        formData.append('cooking_note', cookingNote);
        formData.append('cooking_yield_rate', cookingYieldRate);
        console.log('[saveMenu] cooking_yield_rate:', cookingYieldRate);

        // 기존 메뉴 수정인지 확인하여 recipe_id 추가
        if (this.currentMenuId) {
            console.log('[saveMenu] 기존 메뉴 수정 - recipe_id 추가:', this.currentMenuId);
            formData.append('recipe_id', this.currentMenuId);
        } else {
            console.log('[saveMenu] 새 메뉴 생성');
        }

        // 🏢 사업장 ID 추가 (owner_site_id로 사용됨)
        const siteId = this.getSiteId();
        if (siteId) {
            console.log('[saveMenu] 사업장 ID 추가:', siteId);
            formData.append('site_id', siteId);
        }

        // 🏢 공개 범위(scope) - 항상 'site'로 설정 (사업장 소유)
        formData.append('scope', 'site');
        console.log('[saveMenu] scope: site (사업장 소유)');

        // 🏷️ 레시피 카테고리 (도시락, 운반 등) - 카테고리 사용 사업장만 해당
        const recipeCategoryRadio = document.querySelector('input[name="recipeCategory"]:checked');
        if (recipeCategoryRadio && recipeCategoryRadio.value) {
            console.log('[saveMenu] 레시피 카테고리 ID 추가:', recipeCategoryRadio.value);
            formData.append('recipe_category_id', recipeCategoryRadio.value);
        } else if (window.currentSiteHasCategories) {
            console.log('[saveMenu] 카테고리 사용 사업장이지만 공통 레시피로 저장');
        }

        const ingredientsJson = JSON.stringify(ingredients);
        console.log('[saveMenu] ingredients JSON:', ingredientsJson);
        formData.append('ingredients', ingredientsJson);

        // 사진 처리 - 타입에 따라 다르게 처리
        console.log('[saveMenu] 4. 사진 처리');
        console.log('[saveMenu] currentPhotoType:', this.currentPhotoType);
        console.log('[saveMenu] currentPhotoFile:', this.currentPhotoFile);
        console.log('[saveMenu] currentPhotoUrl:', this.currentPhotoUrl);

        if (this.currentPhotoType === 'file' && this.currentPhotoFile) {
            console.log('[saveMenu] 새 파일 업로드');
            formData.append('image', this.currentPhotoFile);
        } else if (this.currentPhotoType === 'existing' && this.currentPhotoUrl) {
            console.log('[saveMenu] 기존 사진 링크 사용');
            formData.append('image_url', this.currentPhotoUrl);
        } else {
            console.log('[saveMenu] 사진 없음');
        }

        // FormData 내용 확인
        console.log('[saveMenu] 5. FormData 내용 확인');
        for (let pair of formData.entries()) {
            console.log('[saveMenu] FormData:', pair[0], '=',
                pair[1] instanceof File ? `File(${pair[1].name})` : pair[1].substring ? pair[1].substring(0, 100) : pair[1]);
        }

        try {
            console.log('[saveMenu] 6. 서버로 전송 시작');
            console.log('[saveMenu] URL:', `${this.CONFIG.API_BASE_URL}/api/recipe/save`);

            // JWT 토큰 가져오기
            const authToken = localStorage.getItem('auth_token');
            const headers = {};
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            const response = await fetch(`${this.CONFIG.API_BASE_URL}/api/recipe/save`, {
                method: 'POST',
                headers: headers,
                body: formData
            });

            console.log('[saveMenu] 7. 응답 수신');
            console.log('[saveMenu] 상태 코드:', response.status);
            console.log('[saveMenu] 상태 텍스트:', response.statusText);

            const responseText = await response.text();
            console.log('[saveMenu] 응답 텍스트:', responseText);

            let result;
            try {
                result = JSON.parse(responseText);
                console.log('[saveMenu] 8. JSON 파싱 성공');
                console.log('[saveMenu] 파싱된 결과:', result);
            } catch (parseError) {
                console.error('[saveMenu] JSON 파싱 실패:', parseError);
                console.error('[saveMenu] 응답 원문:', responseText);
                alert('서버 응답을 처리할 수 없습니다.\n응답: ' + responseText.substring(0, 100));
                return;
            }

            if (result.success) {
                console.log('[saveMenu] 9. 저장 성공!');
                console.log('[saveMenu] recipe_id:', result.recipe_id);
                console.log('[saveMenu] recipe_code:', result.recipe_code);

                // 🔄 신규 레시피 형제 자동 복사 알림
                if (result.auto_copied) {
                    alert(`"${menuName}" 레시피가 저장되었습니다!\n\n${result.auto_copied_message}`);
                } else {
                    alert(`"${menuName}" 레시피가 성공적으로 저장되었습니다!`);
                }

                // 🔄 형제 레시피 동기화 확인 (기존 레시피 수정 시)
                if (result.sibling_prompt) {
                    const sp = result.sibling_prompt;
                    const names = sp.siblings.map(s => `${s.display_name} (재료 ${s.ingredient_count}개)`).join('\n  ');
                    if (confirm(`${sp.message}\n\n대상:\n  ${names}\n\n확인 시 위 레시피들의 재료가 현재 레시피와 동일하게 변경됩니다.`)) {
                        try {
                            const syncHeaders = { 'Content-Type': 'application/json' };
                            if (authToken) {
                                syncHeaders['Authorization'] = `Bearer ${authToken}`;
                            }
                            const syncRes = await fetch(`${this.CONFIG.API_BASE_URL}/api/recipe/sync-siblings`, {
                                method: 'POST',
                                headers: syncHeaders,
                                body: JSON.stringify({ source_id: sp.source_id })
                            });
                            const syncResult = await syncRes.json();
                            if (syncResult.success) {
                                alert(`${syncResult.synced_count}개 형제 레시피 동기화 완료!`);
                            } else {
                                alert(`동기화 실패: ${syncResult.error}`);
                            }
                        } catch (syncError) {
                            console.error('[saveMenu] 형제 동기화 오류:', syncError);
                            alert('형제 레시피 동기화 중 오류가 발생했습니다.');
                        }
                    }
                }

                // 동명 레시피 경고 표시 (다른 prefix 등)
                if (result.warnings && result.warnings.length > 0) {
                    result.warnings.forEach(w => alert(`⚠️ 경고: ${w}`));
                }

                // 새로 저장된 메뉴를 목록에 추가
                const newMenu = {
                    id: result.recipe_id,
                    recipe_code: result.recipe_code,
                    name: menuName,
                    category: category,
                    total_cost: this.calculateTotal(),
                    created_at: new Date().toISOString()
                };

                // 최근 수정 목록에 추가 (숫자로 변환하여 저장)
                const savedId = parseInt(result.recipe_id);
                this.recentlyModifiedMenus.add(savedId);
                console.log('[saveMenu] 최근 수정 목록에 추가:', savedId, '현재 목록:', [...this.recentlyModifiedMenus]);

                // 메뉴 목록을 서버에서 다시 로드
                await this.loadMenus();

                // 저장 완료 후 목록 맨 위로 스크롤
                const menuList = document.getElementById('menuList');
                if (menuList) {
                    menuList.scrollTop = 0;
                }

                // 저장 완료 후 화면 초기화 (새 메뉴 입력 준비)
                console.log('[saveMenu] 저장 완료, 화면 초기화');
                this.currentMenuId = null;

                // 메뉴명 초기화
                const menuNameEl = document.getElementById('menuName');
                if (menuNameEl) menuNameEl.value = '';

                // 분류 선택 해제
                const categoryInputs = document.querySelectorAll('input[name="category"]');
                categoryInputs.forEach(input => input.checked = false);

                // 공개 범위 기본값으로
                const scopeGlobal = document.querySelector('input[name="scope"][value="global"]');
                if (scopeGlobal) scopeGlobal.checked = true;

                // 그리드 초기화
                this.resetGrid(true);

                // 조리법 메모 초기화
                const cookingNoteEl = document.getElementById('cookingNote');
                if (cookingNoteEl) cookingNoteEl.value = '';

                // 사진 초기화
                this.clearPhoto();

                // 제목 변경
                const menuTitleEl = document.getElementById('menuTitle');
                if (menuTitleEl) menuTitleEl.textContent = '새 메뉴 만들기';

                console.log('[saveMenu] 화면 초기화 완료 - 새 메뉴 입력 준비됨');
            } else {
                console.log('[saveMenu] 9. 저장 실패');
                console.log('[saveMenu] 오류 메시지:', result.detail || result.error || '알 수 없는 오류');
                alert('저장 실패: ' + (result.detail || result.error || '알 수 없는 오류'));
            }
        } catch (error) {
            console.error('[saveMenu] 예외 발생!');
            console.error('[saveMenu] 오류 객체:', error);
            console.error('[saveMenu] 오류 메시지:', error.message);
            console.error('[saveMenu] 스택:', error.stack);
            alert('저장 중 오류가 발생했습니다:\n' + error.message);
        }

        console.log('[saveMenu] ===== 저장 프로세스 종료 =====');
    }

    /**
     * 다른 이름으로 저장
     */
    async saveMenuAs() {
        const menuName = document.getElementById('menuName')?.value || '';

        if (!menuName) {
            alert('메뉴명을 입력해주세요.');
            return;
        }

        // 새 이름 입력 받기
        const newName = prompt('새로운 메뉴명을 입력하세요:', menuName + ' (복사본)');

        if (!newName || newName.trim() === '') {
            return;
        }

        // 원래 메뉴명 임시 보관
        const originalName = menuName;

        // 새 이름으로 변경
        const menuNameElement = document.getElementById('menuName');
        if (menuNameElement) {
            menuNameElement.value = newName;
        }

        // 현재 선택된 카테고리 약어로 suffix 갱신
        const selectedCatRadio = document.querySelector('input[name="recipeCategory"]:checked');
        if (selectedCatRadio) {
            const abbr = selectedCatRadio.dataset.abbr || '';
            const suffixEl = document.getElementById('menuSuffix');
            if (suffixEl) suffixEl.value = abbr;
            this.currentMenuCatAbbr = abbr;
            this.updateMenuDisplayPreview();
        }

        // 새 메뉴로 저장하기 위해 currentMenuId 임시 제거
        const originalMenuId = this.currentMenuId;
        this.currentMenuId = null;

        // 저장 실행
        await this.saveMenu();

        // 원래 상태로 복원
        this.currentMenuId = originalMenuId;
    }

    /**
     * 메뉴 목록 로드 (올바른 엔드포인트 사용)
     */
    async loadMenus() {
        try {
            console.log('===== 메뉴 로딩 시작 =====');
            console.log('API URL:', this.CONFIG.API_BASE_URL);
            const totalCountElem = document.getElementById('totalMenuCount');

            // 🏢 현재 사업장 ID 가져오기
            const siteId = this.getSiteId();
            console.log('🏢 사업장 ID:', siteId);

            // 로딩 표시
            if (totalCountElem) {
                totalCountElem.textContent = '로딩...';
            }

            // 올바른 메뉴 목록 API 호출
            // JWT 토큰 가져오기
            const authToken = localStorage.getItem('auth_token');
            const headers = {};
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            // 먼저 일반 사용자용 API 시도
            const searchBody = {
                keyword: '',
                limit: 10000
            };
            if (siteId) {
                searchBody.site_id = siteId;
            }

            let response = await fetch(`${this.CONFIG.API_BASE_URL}/api/search_recipes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify(searchBody)
            });

            let useAdminApi = false;
            // 일반 API가 실패하면 관리자 API 시도
            if (!response.ok) {
                console.log('일반 API 실패, 관리자 API 시도...');
                const siteParam = siteId ? `&site_id=${siteId}` : '';
                response = await fetch(`${this.CONFIG.API_BASE_URL}/api/admin/menu-recipes?per_page=10000${siteParam}`, {
                    headers: headers
                });
                useAdminApi = true;
            }

            if (response.ok) {
                const result = await response.json();
                console.log('API 응답:', result);

                // 응답 구조에 따라 메뉴 데이터 추출
                if (useAdminApi && result.success && result.data) {
                    // 관리자 API 응답 구조
                    this.menus = result.data.recipes || [];
                    if (totalCountElem) {
                        totalCountElem.textContent = result.data.pagination?.total || this.menus.length;
                    }
                } else if (!useAdminApi && result.success && result.recipes) {
                    // 일반 사용자 API 응답 구조
                    this.menus = result.recipes || [];
                    if (totalCountElem) {
                        totalCountElem.textContent = result.total || this.menus.length;
                    }
                } else {
                    // 폴백 - 어떤 구조든 시도
                    this.menus = result.data?.recipes || result.recipes || result.data || [];
                    if (totalCountElem) {
                        totalCountElem.textContent = result.total || result.data?.pagination?.total || this.menus.length;
                    }
                }

                console.log('로드된 메뉴 데이터:', this.menus);
                this.renderMenuList();
                console.log(`DB 메뉴 로딩 완료: ${this.menus.length}개`);
            } else {
                console.error('API 호출 실패:', response.status);
                // 메뉴가 없는 경우를 위한 폴백
                this.menus = [];
                if (totalCountElem) {
                    totalCountElem.textContent = '0';
                }
                this.renderMenuList();
            }
        } catch (error) {
            console.error('메뉴 로드 오류:', error);
            if (totalCountElem) {
                totalCountElem.textContent = '오류';
            }
        }
    }

    /**
     * 메뉴 목록 렌더링
     */
    renderMenuList(updateCount = true) {
        console.log('🎯 [renderMenuList] 시작 - 메뉴 개수:', this.menus.length);
        const menuList = document.getElementById('menuList');
        const totalCountEl = document.getElementById('totalMenuCount');

        console.log('🎯 [renderMenuList] menuList 엘리먼트:', menuList);
        console.log('🎯 [renderMenuList] totalCountEl 엘리먼트:', totalCountEl);

        if (!menuList) {
            console.error('🚨 [renderMenuList] menuList 엘리먼트를 찾을 수 없습니다!');
            return;
        }

        // 총 메뉴 개수 업데이트 (필요 시에만)
        if (updateCount && totalCountEl) {
            totalCountEl.textContent = this.menus.length;
        }

        // 최근 수정/생성된 메뉴를 상단으로 정렬
        const sortedMenus = [...this.menus].sort((a, b) => {
            // 1순위: 최근 수정된 메뉴
            const aIsRecent = this.recentlyModifiedMenus.has(a.id);
            const bIsRecent = this.recentlyModifiedMenus.has(b.id);

            if (aIsRecent && !bIsRecent) return -1;
            if (!aIsRecent && bIsRecent) return 1;

            // 2순위: 데이터베이스의 새 메뉴
            const aIsNew = a.is_new === true;
            const bIsNew = b.is_new === true;

            if (aIsNew && !bIsNew) return -1;
            if (!aIsNew && bIsNew) return 1;

            // 3순위: ID 역순 (최신순)
            return (b.id || 0) - (a.id || 0);
        });

        // 검색 결과가 없을 때 안내 메시지 표시
        if (sortedMenus.length === 0) {
            const searchTerm = document.getElementById('menuSearch')?.value.trim() || '';
            if (searchTerm) {
                menuList.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #6c757d;">
                        <div style="font-size: 48px; margin-bottom: 10px;">🔍</div>
                        <div style="font-size: 14px; margin-bottom: 15px;">
                            "${searchTerm}" 검색 결과가 없습니다.
                        </div>
                        <button class="btn btn-primary" onclick="createNewMenuWithName('${searchTerm}')"
                            style="background: linear-gradient(135deg, #667eea, #764ba2);
                                   color: white; padding: 8px 20px; border: none;
                                   border-radius: 4px; font-size: 13px; font-weight: 600;
                                   cursor: pointer;">
                            "${searchTerm}" 메뉴 만들기
                        </button>
                    </div>
                `;
            } else {
                menuList.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #6c757d; font-size: 13px;">
                        메뉴를 검색하거나 새로 만들어보세요.
                    </div>
                `;
            }
            return;
        }

        // 메뉴 번호를 생성 순서(ID 순서)대로 부여하기 위해 ID로 정렬한 배열 생성
        const menusSortedById = [...this.menus].sort((a, b) => (a.id || 0) - (b.id || 0));

        menuList.innerHTML = sortedMenus.map((menu, index) => {
            let bgColor = '';
            let indicator = '';
            let borderStyle = '';

            // ID를 숫자로 변환하여 비교
            const menuId = parseInt(menu.id);

            if (this.recentlyModifiedMenus.has(menuId)) {
                // 방금 저장된 메뉴 - 빨간색 강조
                bgColor = '#ffe0e0';
                borderStyle = 'border-left: 4px solid #ff4444;';
                indicator = '<span style="color: #ff0000; font-size: 14px; font-weight: bold; animation: pulse 1s infinite;">🔴 NEW </span>';
            } else if (menu.is_new) {
                bgColor = '#f0fff4';
                indicator = '<span style="color: #28a745; font-size: 10px;">● </span>';
            }

            // ⚠️ 비활성 협력업체 식자재 포함 경고
            let inactiveSupplierWarning = '';
            if (menu.has_inactive_supplier) {
                const supplierNames = menu.inactive_supplier_names || '협력업체';
                inactiveSupplierWarning = `<span title="${supplierNames} (비활성)" style="color: #ff6600; cursor: help; font-size: 11px; background: #fff3cd; padding: 1px 4px; border-radius: 3px; margin-right: 4px;">⚠️비활성</span>`;
            }

            // 메뉴 번호는 생성 순서(ID 순서)에 따라 부여
            const menuNumber = menusSortedById.findIndex(m => m.id === menu.id) + 1;

            return `
                <div class="menu-item" onclick="selectMenu(${menu.id}, this)" style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #eee; ${bgColor ? `background-color: ${bgColor};` : ''} ${borderStyle}">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0; width: 28px;">
                        <div style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: #e9ecef; color: #495057; font-size: 10px; font-weight: 600; border-radius: 50%;">
                            ${menuNumber}
                        </div>
                        <span style="font-size: 8px; color: #aaa;">#${menu.id}</span>
                    </div>
                    <div style="width: 40px; height: 40px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #f0f0f0;">
                        ${menu.thumbnail ?
                          `<img src="${menu.thumbnail.startsWith('/') ? menu.thumbnail : '/' + menu.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center; color: #ccc; font-size: 16px;">🍴</div>` :
                          `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 16px;">🍴</div>`
                        }
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 13px; font-weight: 500; line-height: 1.3; word-break: keep-all;" title="${menu.display_name || menu.name || menu.menu_name || menu.recipe_name || ''}">
                            ${indicator}${inactiveSupplierWarning}${formatMenuNameWithColors(menu.display_name || menu.name || menu.menu_name || menu.recipe_name || '이름 없음')}
                        </div>
                        <div style="font-size: 10px; color: #888; margin-top: 2px;">${menu.category || ''}${menu.created_by ? ` · ${menu.created_by}` : ''}</div>
                    </div>
                </div>
            `;
        }).join('');

        console.log('🎯 [renderMenuList] HTML 생성 완료, innerHTML 설정 전');
        console.log('🎯 [renderMenuList] 생성된 HTML 길이:', menuList.innerHTML.length);
        console.log('🎯 [renderMenuList] 완료!');
    }

    /**
     * 메뉴 검색
     */
    searchMenus() {
        const searchTerm = document.getElementById('menuSearch')?.value.toLowerCase() || '';
        const filtered = this.menus.filter(menu => {
            // 동적 조합명(display_name)과 순수 메뉴명(base_name) 모두에서 검색
            const displayName = menu.display_name || menu.name || menu.menu_name || menu.recipe_name || '';
            const baseName = menu.base_name || '';
            return displayName.toLowerCase().includes(searchTerm) || baseName.toLowerCase().includes(searchTerm);
        });

        const menuList = document.getElementById('menuList');
        if (!menuList) return;

        // 메뉴 번호를 생성 순서(ID 순서)대로 부여하기 위해 ID로 정렬한 배열 생성
        const menusSortedById = [...this.menus].sort((a, b) => (a.id || 0) - (b.id || 0));

        menuList.innerHTML = filtered.map(menu => {
            // ⚠️ 비활성 협력업체 식자재 포함 경고
            const supplierNames = menu.inactive_supplier_names || '협력업체';
            const inactiveWarning = menu.has_inactive_supplier
                ? `<span title="${supplierNames} (비활성)" style="color: #ff6600; cursor: help; font-size: 11px; background: #fff3cd; padding: 1px 4px; border-radius: 3px; margin-right: 4px;">⚠️비활성</span>`
                : '';
            // 메뉴 번호는 생성 순서(ID 순서)에 따라 부여
            const menuNumber = menusSortedById.findIndex(m => m.id === menu.id) + 1;
            return `
            <div class="menu-item" onclick="selectMenu(${menu.id}, this)" style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #eee;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0; width: 28px;">
                    <div style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: #e9ecef; color: #495057; font-size: 10px; font-weight: 600; border-radius: 50%;">
                        ${menuNumber}
                    </div>
                    <span style="font-size: 8px; color: #aaa;">#${menu.id}</span>
                </div>
                <div style="width: 40px; height: 40px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #f0f0f0;">
                    ${menu.thumbnail ?
                      `<img src="${menu.thumbnail.startsWith('/') ? menu.thumbnail : '/' + menu.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center; color: #ccc; font-size: 16px;">🍴</div>` :
                      `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 16px;">🍴</div>`
                    }
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 13px; font-weight: 500; line-height: 1.3; word-break: keep-all;" title="${menu.display_name || menu.name || menu.menu_name || menu.recipe_name || ''}">
                        ${inactiveWarning}${formatMenuNameWithColors(menu.display_name || menu.name || menu.menu_name || menu.recipe_name || '이름 없음')}
                    </div>
                    <div style="font-size: 10px; color: #888; margin-top: 2px;">${menu.category || ''}${menu.created_by ? ` · ${menu.created_by}` : ''}</div>
                </div>
            </div>
        `;
        }).join('');
    }

    /**
     * 메뉴 선택
     */
    async selectMenu(menuId, element) {
        console.log('selectMenu 호출, ID:', menuId, '타입:', typeof menuId);
        console.log('현재 메뉴 목록:', this.menus.map(m => ({id: m.id, name: m.name || m.recipe_name})));

        this.currentMenuId = menuId;
        const menu = this.menus.find(m => m.id === menuId);
        console.log('찾은 메뉴:', menu);

        if (menu) {
            console.log('메뉴 정보 설정 시작');
            const menuTitleElement = document.getElementById('menuTitle');
            const menuNameElement = document.getElementById('menuName');

            // 편집 영역에는 base_name (순수 메뉴명)을, 제목에는 display_name (동적 조합명)을 표시
            const editName = menu.base_name || menu.name || menu.menu_name || menu.recipe_name || '';
            const displayName = menu.display_name || editName;
            if (menuTitleElement) menuTitleElement.textContent = displayName;
            if (menuNameElement) menuNameElement.value = editName;

            // 접두사/접미사 설정 (실제 저장된 값만 표시, 빈 값이면 빈 상태로)
            const prefixElement = document.getElementById('menuPrefix');
            const suffixElement = document.getElementById('menuSuffix');
            // 입력 필드에는 실제 저장된 값만, preview에서는 fallback 적용
            if (prefixElement) prefixElement.value = menu.prefix || '';
            if (suffixElement) suffixElement.value = menu.suffix || '';
            // 현재 메뉴의 site_abbr, cat_abbr 저장 (preview용)
            this.currentMenuSiteAbbr = menu.site_abbr || '';
            this.currentMenuCatAbbr = menu.cat_abbr || '';
            this.updateMenuDisplayPreview();

            // 라디오 버튼에서 카테고리 선택
            if (menu.category) {
                const categoryRadio = document.querySelector(`input[name="category"][value="${menu.category}"]`);
                if (categoryRadio) {
                    categoryRadio.checked = true;
                }
            }

            // 선택된 메뉴 표시
            document.querySelectorAll('.menu-item').forEach(item => {
                item.classList.remove('selected');
            });
            // element 파라미터 사용
            if (element) {
                element.classList.add('selected');
            }

            // 기존 메뉴 선택 시 '다른 이름으로 저장' 버튼 표시
            const saveAsButton = document.getElementById('saveAsButton');
            if (saveAsButton) {
                saveAsButton.style.display = 'block';
            }

            // 그리드 초기화
            this.resetGrid(true);

            // resetGrid 후 메뉴명/분류/currentMenuId 다시 설정 (resetGrid가 초기화하므로)
            this.currentMenuId = menuId;  // 🔧 resetGrid가 null로 리셋하므로 다시 설정
            console.log('[selectMenu] resetGrid 후 currentMenuId 재설정:', this.currentMenuId);
            if (menuNameElement) menuNameElement.value = editName;
            if (menuTitleElement) menuTitleElement.textContent = displayName;
            // 접두사/접미사 재설정 (실제 저장된 값만 표시)
            if (prefixElement) prefixElement.value = menu.prefix || '';
            if (suffixElement) suffixElement.value = menu.suffix || '';
            this.updateMenuDisplayPreview();
            if (menu.category) {
                const categoryRadio = document.querySelector(`input[name="category"][value="${menu.category}"]`);
                if (categoryRadio) categoryRadio.checked = true;
            }

            // 모든 메뉴를 DB 메뉴로 처리 (JSON 로직 완전 제거)
            try {
                const apiUrl = `${this.CONFIG.API_BASE_URL}/api/admin/menu-recipes/${menuId}`;
                console.log('메뉴 상세 정보 로드, ID:', menuId, 'URL:', apiUrl);

                // JWT 토큰 가져오기
                const authToken = localStorage.getItem('auth_token');
                const headers = {};
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }

                const response = await fetch(apiUrl, {
                    headers: headers
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log('API 응답:', result);

                    if (result.success && result.data) {
                        const recipeDetail = result.data.recipe;
                        const ingredients = result.data.ingredients;

                        console.log('레시피 상세:', recipeDetail);
                        console.log('재료 목록:', ingredients);

                        // 🔒 소유 사업장 ID 저장 및 버튼 가시성 업데이트
                        this.currentRecipeOwnerSiteId = recipeDetail.owner_site_id;
                        console.log('[권한] owner_site_id:', this.currentRecipeOwnerSiteId);
                        this.updateButtonVisibility();

                        // 조리법 메모 설정
                        const cookingNoteElem = document.getElementById('cookingNote');
                        if (cookingNoteElem && recipeDetail.cooking_note) {
                            cookingNoteElem.value = recipeDetail.cooking_note;
                            console.log('조리법 설정:', recipeDetail.cooking_note);
                        }

                        // 조리수율 설정
                        const cookingYieldRateElem = document.getElementById('cookingYieldRate');
                        console.log('[DEBUG] cookingYieldRateElem:', cookingYieldRateElem);
                        console.log('[DEBUG] recipeDetail.cooking_yield_rate:', recipeDetail.cooking_yield_rate);
                        console.log('[DEBUG] recipeDetail 전체:', JSON.stringify(recipeDetail));
                        if (cookingYieldRateElem) {
                            const newYieldValue = recipeDetail.cooking_yield_rate || 100;
                            console.log('[DEBUG] 설정할 조리수율 값:', newYieldValue);
                            cookingYieldRateElem.value = newYieldValue;
                            console.log('[DEBUG] 설정 후 cookingYieldRateElem.value:', cookingYieldRateElem.value);
                        } else {
                            console.error('[ERROR] cookingYieldRate 요소를 찾을 수 없음!');
                        }

                        // 사진 설정
                        const photoPreview = document.getElementById('photoPreview');
                        const photoPlaceholder = document.getElementById('photoPlaceholder');

                        if (recipeDetail.photo_path && photoPreview && photoPlaceholder) {
                            // photo_path가 이미 /로 시작하면 그대로, 아니면 / 추가
                            const photoSrc = recipeDetail.photo_path.startsWith('/')
                                ? recipeDetail.photo_path
                                : '/' + recipeDetail.photo_path;
                            photoPreview.src = photoSrc;
                            photoPreview.style.display = 'block';
                            photoPlaceholder.style.display = 'none';
                            console.log('사진 설정:', recipeDetail.photo_path);
                        } else if (photoPreview && photoPlaceholder) {
                            photoPreview.style.display = 'none';
                            photoPlaceholder.style.display = 'block';
                        }

                        // 레시피 카테고리(도시락/운반 등) 설정
                        if (recipeDetail.category_id) {
                            const recipeCategoryRadio = document.querySelector(`input[name="recipeCategory"][value="${recipeDetail.category_id}"]`);
                            if (recipeCategoryRadio) {
                                recipeCategoryRadio.checked = true;
                                console.log('[레시피 카테고리] 설정:', recipeDetail.category_id);
                            } else {
                                console.log('[레시피 카테고리] 라디오 버튼 없음, category_id:', recipeDetail.category_id);
                            }
                        } else {
                            // category_id가 없으면 "공통" 선택
                            const commonRadio = document.querySelector('input[name="recipeCategory"][value=""]');
                            if (commonRadio) {
                                commonRadio.checked = true;
                                console.log('[레시피 카테고리] 공통으로 설정');
                            }
                        }

                        // ★ 접두사/접미사 약어 설정 (카테고리 약어 기준 강제 동기화)
                        this.currentMenuSiteAbbr = recipeDetail.site_abbr || '';
                        this.currentMenuCatAbbr = recipeDetail.cat_abbr || '';

                        // prefix는 직접 저장된 값 우선
                        if (recipeDetail.prefix) {
                            this.currentMenuSiteAbbr = recipeDetail.prefix;
                        }

                        // suffix는 카테고리 약어(cat_abbr)로 강제 설정
                        const catAbbr = recipeDetail.cat_abbr || '';
                        this.currentMenuCatAbbr = catAbbr;
                        const suffixEl = document.getElementById('menuSuffix');
                        if (suffixEl) suffixEl.value = catAbbr;
                        const prefixEl = document.getElementById('menuPrefix');
                        if (prefixEl) prefixEl.value = recipeDetail.prefix || '';

                        console.log('[접두사/접미사] 카테고리 약어 기준 설정:', {
                            prefix: recipeDetail.prefix,
                            cat_abbr: catAbbr
                        });

                        // 미리보기 업데이트
                        this.updateMenuDisplayPreview();

                        // 재료 데이터를 그리드에 로드
                        console.log('[DEBUG] 재료 데이터 검사:', {
                            hasIngredients: !!ingredients,
                            isArray: Array.isArray(ingredients),
                            length: ingredients ? ingredients.length : 'N/A',
                            firstItem: ingredients && ingredients[0] ? ingredients[0] : 'N/A'
                        });

                        if (ingredients && Array.isArray(ingredients) && ingredients.length > 0) {
                            console.log('[SUCCESS] 재료 데이터 그리드 로드:', ingredients.length + '개');
                            try {
                                this.loadIngredientsToGrid(ingredients);
                                console.log('[SUCCESS] loadIngredientsToGrid 호출 성공');
                            } catch (gridError) {
                                console.error('[ERROR] loadIngredientsToGrid 실패:', gridError);
                            }
                        } else {
                            console.warn('[WARNING] 재료 데이터 없음 또는 빈 배열');
                            // 재료가 없는 경우에도 총액 0원으로 초기화
                            setTimeout(() => this.calculateTotal(), 50);
                        }
                    } else {
                        console.error('API 응답 형식 오류:', result);
                    }
                } else {
                    console.error('메뉴 상세 정보 로드 실패:', response.status);
                }
            } catch (error) {
                console.error('메뉴 상세 정보 로드 오류:', error);
            }
        }
    }

    /**
     * 재료 데이터를 그리드에 로드하는 함수 (간단화)
     */
    loadIngredientsToGrid(ingredients) {
        console.log('[GRID] loadIngredientsToGrid 호출됨, 재료 개수:', ingredients ? ingredients.length : 0);
        console.log('[GRID] 전달받은 재료 데이터:', ingredients);
        console.log('[GRID] Handsontable 인스턴스 상태:', !!this.hot);

        if (!this.hot) {
            console.error('[GRID ERROR] Handsontable 인스턴스가 없습니다');
            alert('그리드가 초기화되지 않았습니다. 페이지를 새로고침 해주세요.');
            return;
        }

        if (!ingredients || !Array.isArray(ingredients)) {
            console.log('재료 데이터가 없거나 배열이 아닙니다');
            // 빈 그리드 표시 (숨김 컬럼 포함)
            this.hot.loadData([['', '', '', '', '', 0, 0, null, 0, 0, 0, '', '', null]]);
            return;
        }

        const gridData = [];

        // 재료 데이터를 그리드 형식으로 변환 (올바른 필드명 사용)
        ingredients.forEach((ingredient) => {
            console.log('재료 처리 중:', ingredient);

            // API에서 받은 값들
            const spec = ingredient.specification || '';
            const unit = ingredient.unit || '';
            const ingredientId = ingredient.ingredient_id || null;  // API에서 받은 ingredient_id
            const baseWeightGrams = ingredient.base_weight_grams || null;  // API에서 받은 기준중량
            const sellingPrice = ingredient.selling_price || 0;

            // 1인필요량(g) 계산: 저장된 값이 없으면 1인소요량과 규격/단위에서 역산
            let requiredGrams = ingredient.required_grams || 0;

            if (requiredGrams === 0 && ingredient.quantity > 0) {
                // base_weight_grams 우선 사용
                const totalGrams = this.getTotalGrams(spec, unit, baseWeightGrams);
                if (totalGrams > 0) {
                    requiredGrams = Math.round(ingredient.quantity * totalGrams * 100) / 100;
                }
            }

            // ★ 1인소요량과 1인재료비 재계산 (기준용량 기반)
            // 기준용량이 있으면 항상 재계산하여 최신 값 표시
            let calculatedQuantity = ingredient.quantity || 0;
            let calculatedAmount = ingredient.amount || 0;

            const totalGrams = this.getTotalGrams(spec, unit, baseWeightGrams);
            if (requiredGrams > 0 && totalGrams > 0) {
                // 1인소요량 = 1인필요량(g) / 기준용량(g)
                calculatedQuantity = Math.round((requiredGrams / totalGrams) * 10000) / 10000;
                // 1인재료비 = 판매가 × 1인소요량
                calculatedAmount = Math.round(sellingPrice * calculatedQuantity);
            }

            gridData.push([
                ingredient.ingredient_code || '',        // 0: 식자재코드
                ingredient.ingredient_name || '',        // 1: 식자재명
                '',                                      // 2: 검색 버튼 (빈 칸)
                spec,                                    // 3: 규격
                ingredient.unit || '',                   // 4: 단위
                ingredient.delivery_days || 0,           // 5: 선발주일
                sellingPrice,                            // 6: 판매가
                baseWeightGrams,                         // 7: 기준용량(g)
                requiredGrams,                           // 8: 1인필요량(g) - 역산된 값
                calculatedQuantity,                      // 9: 1인소요량 (★ 재계산된 값)
                calculatedAmount,                        // 10: 1인재료비 (★ 재계산된 값)
                ingredient.supplier_name || '',          // 11: 거래처명
                this.formatCreatedAt(ingredient.created_at), // 12: 등록일 (YY.MM.DD)
                ingredientId                             // 13: ingredient_id (숨김)
            ]);
        });

        console.log('변환된 그리드 데이터:', gridData);

        // 그리드에 데이터 로드
        try {
            console.log('[GRID] 그리드 데이터 로드 시작, 행 개수:', gridData.length);
            this.hot.loadData(gridData);
            console.log('[GRID SUCCESS] 그리드에 데이터 로드 성공:', gridData.length + '개 행');

            // 총액 계산 (Handsontable 렌더링 완료 후 실행)
            setTimeout(() => {
                try {
                    this.calculateTotal();
                    console.log('[GRID SUCCESS] 총액 계산 완료');
                } catch (calcError) {
                    console.error('[GRID ERROR] 총액 계산 실패:', calcError);
                }
            }, 50);
        } catch (error) {
            console.error('[GRID ERROR] 그리드 데이터 로드 오류:', error);
            alert('그리드 데이터 로드 중 오류가 발생했습니다: ' + error.message);
        }
    }

    /**
     * 엑셀 가져오기
     */
    importFromExcel() {
        alert('엑셀 파일을 선택하여 데이터를 가져올 수 있습니다.');
    }

    /**
     * 엑셀 내보내기
     */
    exportToExcel() {
        if (!this.hot) return;

        const exportPlugin = this.hot.getPlugin('exportFile');
        exportPlugin.downloadFile('csv', {
            filename: '메뉴_레시피_' + new Date().toLocaleDateString('ko-KR'),
            columnHeaders: true,
            rowHeaders: false
        });
    }

    /**
     * 사진 업로드 처리 - 사진 영역 클릭
     */
    handlePhotoClick() {
        const photoUpload = document.getElementById('photoUpload');
        if (photoUpload) {
            photoUpload.click();
        }
    }

    /**
     * 사진 업로드 처리 - 파일 선택
     */
    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            this.currentPhotoFile = file;
            this.currentPhotoType = 'file';
            this.currentPhotoUrl = null;

            const reader = new FileReader();
            reader.onload = (e) => {
                const photoPreview = document.getElementById('photoPreview');
                const photoPlaceholder = document.getElementById('photoPlaceholder');

                if (photoPreview && photoPlaceholder) {
                    photoPreview.src = e.target.result;
                    photoPreview.style.display = 'block';
                    photoPlaceholder.style.display = 'none';
                }
            };
            reader.readAsDataURL(file);
        }
    }

    /**
     * 기존 사진 사용 (링크로 참조)
     */
    async useExistingPhoto() {
        try {
            // 저장된 메뉴 목록에서 사진 선택 모달 표시
            const response = await fetch(`${this.CONFIG.API_BASE_URL}/api/recipe/list`);
            const data = await response.json();
            const existingMenus = data.recipes || [];

            const menusWithPhotos = existingMenus.filter(menu => menu.thumbnail_path);

            if (menusWithPhotos.length === 0) {
                alert('사용 가능한 사진이 없습니다.');
                return;
            }

            // 사진 선택 모달 생성
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
                z-index: 10000;
            `;

            const modalContent = document.createElement('div');
            modalContent.style.cssText = `
                background: white;
                border-radius: 8px;
                padding: 20px;
                max-width: 80%;
                max-height: 80vh;
                overflow-y: auto;
            `;

            modalContent.innerHTML = `
                <h3 style="margin-bottom: 15px;">기존 사진 선택</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;">
                    ${menusWithPhotos.map(menu => `
                        <div style="cursor: pointer; border: 2px solid #ddd; border-radius: 8px; padding: 5px;"
                             onclick="window.selectExistingPhoto('${menu.thumbnail_path}', '${menu.recipe_name}')">
                            <img src="/${menu.thumbnail_path}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px;">
                            <div style="text-align: center; font-size: 12px; margin-top: 5px;">${menu.recipe_name}</div>
                        </div>
                    `).join('')}
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="margin-top: 15px; padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">닫기</button>
            `;

            modal.appendChild(modalContent);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('기존 사진 로드 오류:', error);
            alert('기존 사진을 불러오는데 실패했습니다.');
        }
    }

    /**
     * 기존 사진 선택
     */
    selectExistingPhoto(photoPath, menuName) {
        this.currentPhotoUrl = photoPath;
        this.currentPhotoType = 'existing';
        this.currentPhotoFile = null;

        const photoPreview = document.getElementById('photoPreview');
        const photoPlaceholder = document.getElementById('photoPlaceholder');

        if (photoPreview && photoPlaceholder) {
            const photoSrc = photoPath.startsWith('/') ? photoPath : '/' + photoPath;
            photoPreview.src = photoSrc;
            photoPreview.style.display = 'block';
            photoPlaceholder.style.display = 'none';
        }

        // 모달 닫기
        const modal = document.querySelector('div[style*="z-index: 10000"]');
        if (modal) modal.remove();
    }

    /**
     * 사진 제거
     */
    clearPhoto() {
        this.currentPhotoFile = null;
        this.currentPhotoUrl = null;
        this.currentPhotoType = null;

        const photoPreview = document.getElementById('photoPreview');
        const photoPlaceholder = document.getElementById('photoPlaceholder');
        const photoUpload = document.getElementById('photoUpload');

        if (photoPreview) photoPreview.style.display = 'none';
        if (photoPlaceholder) photoPlaceholder.style.display = 'block';
        if (photoUpload) photoUpload.value = '';
    }

    /**
     * 단위당 단가 모달 열기
     */
    openUnitPriceModal(index) {
        console.log('[openUnitPriceModal] 인덱스:', index);

        if (!this.searchResults || !this.searchResults[index]) {
            console.error('[openUnitPriceModal] 식자재 정보를 찾을 수 없음');
            return;
        }

        const item = this.searchResults[index];
        this.currentUnitPriceItem = item;
        this.currentUnitPriceIndex = index;

        // 모달이 없으면 생성
        this.createUnitPriceModal();

        // 모달 데이터 설정
        const modal = document.getElementById('unitPriceModal');
        const itemNameEl = modal.querySelector('#unitPriceItemName');
        const specificationEl = modal.querySelector('#unitPriceSpecification');
        const unitEl = modal.querySelector('#unitPriceUnit');
        const priceEl = modal.querySelector('#unitPricePrice');
        const currentUnitPriceEl = modal.querySelector('#currentUnitPrice');

        if (itemNameEl) itemNameEl.textContent = item.name || item.ingredient_name || '';
        if (specificationEl) specificationEl.value = item.specification || '';
        if (unitEl) unitEl.textContent = item.unit || '';
        if (priceEl) priceEl.textContent = (item.selling_price || item.purchase_price || 0).toLocaleString() + '원';
        if (currentUnitPriceEl) currentUnitPriceEl.textContent = item.unit_price ? item.unit_price.toFixed(2) + '원/g' : '계산되지 않음';

        // 모달 표시
        modal.classList.add('active');
    }

    /**
     * 단위당 단가 모달 닫기
     */
    closeUnitPriceModal() {
        const modal = document.getElementById('unitPriceModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * 단위당 단가 재계산
     */
    async recalculateUnitPrice() {
        if (!this.currentUnitPriceItem) {
            console.error('[recalculateUnitPrice] 현재 아이템이 없음');
            return;
        }

        const modal = document.getElementById('unitPriceModal');
        const specificationEl = modal.querySelector('#unitPriceSpecification');
        const resultEl = modal.querySelector('#calculationResult');
        const recalculateBtn = modal.querySelector('#recalculateBtn');

        if (!specificationEl || !resultEl) return;

        const newSpecification = specificationEl.value.trim();

        if (!newSpecification) {
            alert('규격을 입력해주세요.');
            return;
        }

        // 버튼 상태 변경
        if (recalculateBtn) {
            recalculateBtn.textContent = '계산중...';
            recalculateBtn.disabled = true;
        }

        try {
            const response = await fetch(`${this.CONFIG.API_BASE_URL}/calculate-price-per-gram`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    price: this.currentUnitPriceItem.selling_price || this.currentUnitPriceItem.purchase_price || 0,
                    specification: newSpecification,
                    unit: this.currentUnitPriceItem.unit || ''
                })
            });

            const result = await response.json();

            if (result.success && result.unit_price > 0) {
                // 성공 시 결과 표시
                resultEl.innerHTML = `
                    <div style="color: #28a745; font-weight: bold; margin-top: 10px;">
                        ✅ 계산 완료: ${result.unit_price.toFixed(2)}원/g
                        <br><small style="color: #666;">패턴: ${result.pattern || '기본 계산'}</small>
                    </div>
                `;

                // 검색 결과 업데이트
                if (this.searchResults && this.currentUnitPriceIndex !== undefined) {
                    this.searchResults[this.currentUnitPriceIndex].unit_price = result.unit_price;
                    this.searchResults[this.currentUnitPriceIndex].specification = newSpecification;

                    // 단위당 단가 기준으로 다시 정렬 (낮은 가격 순)
                    this.searchResults.sort((a, b) => (a.price_per_unit || Infinity) - (b.price_per_unit || Infinity));
                }

                // 3초 후 모달 닫기
                setTimeout(() => {
                    this.closeUnitPriceModal();
                    // 검색 결과 다시 렌더링
                    this.renderSearchResults();
                }, 2000);
            } else {
                resultEl.innerHTML = `
                    <div style="color: #dc3545; margin-top: 10px;">
                        ❌ 계산 실패: ${result.error || '알 수 없는 오류'}
                    </div>
                `;
            }
        } catch (error) {
            console.error('[recalculateUnitPrice] 오류:', error);
            resultEl.innerHTML = `
                <div style="color: #dc3545; margin-top: 10px;">
                    ❌ 통신 오류: ${error.message}
                </div>
            `;
        }

        // 버튼 상태 복원
        if (recalculateBtn) {
            recalculateBtn.textContent = '재계산';
            recalculateBtn.disabled = false;
        }
    }

    /**
     * 단위당 단가 모달 생성
     */
    createUnitPriceModal() {
        if (document.getElementById('unitPriceModal')) {
            return; // 이미 존재
        }

        const modalHtml = `
            <div id="unitPriceModal" class="modal">
                <div class="modal-content" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3>단위당 단가 재계산</h3>
                        <button class="modal-close" onclick="window.closeUnitPriceModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom: 15px;">
                            <label><strong>식자재명:</strong></label>
                            <div id="unitPriceItemName" style="padding: 8px; background: #f8f9fa; border-radius: 4px; margin-top: 5px;"></div>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label><strong>현재 단위당 단가:</strong></label>
                            <div id="currentUnitPrice" style="padding: 8px; background: #e9ecef; border-radius: 4px; margin-top: 5px;"></div>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label><strong>판매가:</strong></label>
                            <div id="unitPricePrice" style="padding: 8px; background: #f8f9fa; border-radius: 4px; margin-top: 5px;"></div>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label><strong>단위:</strong></label>
                            <div id="unitPriceUnit" style="padding: 8px; background: #f8f9fa; border-radius: 4px; margin-top: 5px;"></div>
                        </div>

                        <div style="margin-bottom: 20px;">
                            <label for="unitPriceSpecification"><strong>규격 수정:</strong></label>
                            <input type="text" id="unitPriceSpecification"
                                   style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-top: 5px;"
                                   placeholder="예: 3kg, 500g, 1박스(24개) 등">
                            <small style="color: #666;">규격을 수정하여 정확한 단위당 단가를 계산할 수 있습니다.</small>
                        </div>

                        <div id="calculationResult"></div>
                    </div>
                    <div class="modal-footer">
                        <button id="recalculateBtn" onclick="window.recalculateUnitPrice()"
                                style="background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                            재계산
                        </button>
                        <button onclick="window.closeUnitPriceModal()"
                                style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    /**
     * 검색 결과 다시 렌더링 (단위당 단가 업데이트 후 사용)
     */
    renderSearchResults() {
        const tbody = document.getElementById('searchResultsBody');
        if (!tbody || !this.searchResults) return;

        tbody.innerHTML = this.searchResults.map((item, index) => {
            const ingredientId = item.id;
            const baseWeight = item.base_weight_grams;
            const sellingPrice = item['판매가'] || item.selling_price || 0;
            const unitPrice = item.price_per_unit || item['단위당 단가'] || item.unit_price || 0;
            const displayUnitPrice = baseWeight && baseWeight > 0
                ? (sellingPrice / baseWeight).toFixed(2)
                : (unitPrice > 0 ? unitPrice.toFixed(1) : '-');
            const unitPriceColor = baseWeight && baseWeight > 0 ? '#2196f3' : '#f44336';

            // 다함직구매 협력업체 하이라이트
            const supplierName3 = item['거래처명'] || item.supplier_name || item.supplier || '';
            const isDahamDirect3 = supplierName3 === '다함직구매';
            const rowBgStyle3 = isDahamDirect3 ? 'background-color: #fffde7;' : '';

            return `
            <tr onclick="window.selectIngredientByIndex(${index})" style="cursor: pointer; ${rowBgStyle3}">
                <td style="padding: 2px;">
                    <div style="width: 40px; height: 40px; background: #f5f5f5; border-radius: 4px; overflow: hidden;">
                        ${item.thumbnail ?
                          `<img src="${item.thumbnail.startsWith('/') ? item.thumbnail : '/' + item.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="width: 100%; height: 100%; display: none; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>` :
                          `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 10px;">-</div>`
                        }
                    </div>
                </td>
                <td style="font-weight: 500;" title="${item['식자재명'] || item.ingredient_name || item.name || ''}">${item['식자재명'] || item.ingredient_name || item.name || ''}</td>
                <td title="${item['규격'] || item.specification || ''}">${item['규격'] || item.specification || ''}</td>
                <td>${item['단위'] || item.unit || ''}</td>
                <td style="text-align: right;">${sellingPrice.toLocaleString()}</td>
                <td style="text-align: center; background: #f3e5f5;" onclick="event.stopPropagation();">
                    <input type="number"
                           class="base-weight-input"
                           data-ingredient-id="${ingredientId || 0}"
                           data-index="${index}"
                           value="${baseWeight || ''}"
                           placeholder="${(item['단위'] || item.unit) === 'KG' ? '1000' : '-'}"
                           style="width: 70px; text-align: right; border: 1px solid ${baseWeight ? '#4caf50' : '#d4a574'}; border-radius: 3px; padding: 2px 4px; font-size: 11px; background: #fffbf0;"
                           onclick="event.stopPropagation();"
                           onchange="window.updateBaseWeight(${ingredientId || 0}, this.value, ${index})"
                           onkeypress="if(event.key==='Enter'){this.blur();}"
                           title="기준용량(g) 입력 - 입력 후 Enter">
                </td>
                <td style="color: ${unitPriceColor}; font-weight: 600; text-align: right;" id="unit-price-${index}"
                    title="${baseWeight ? '보정된 단가' : '자동계산 단가'}">${displayUnitPrice}</td>
                <td style="text-align: center;">${item['선발주일'] || item.delivery_days || '1'}</td>
                <td style="color: #666;" title="${item['거래처명'] || item.supplier_name || item.supplier || ''}">${item['거래처명'] || item.supplier_name || item.supplier || ''}</td>
                <td style="text-align: center; color: ${item.is_published !== false ? '#4caf50' : '#f44336'};">
                    ${item.is_published !== false ? 'O' : 'X'}
                </td>
                <td style="text-align: center; color: ${item.is_stocked !== false ? '#4caf50' : '#f44336'};">
                    ${item.is_stocked !== false ? 'O' : 'X'}
                </td>
            </tr>
        `}).join('');
    }

    /**
     * 새 메뉴 만들기 버튼 클릭
     */
    createNewMenu() {
        console.log('새 메뉴 만들기 함수 호출됨');
        this.currentMenuId = null;
        this.currentRecipeOwnerSiteId = null; // 🔒 새 메뉴는 소유권 없음 (저장 시 현재 사업장으로 설정됨)
        this.updateButtonVisibility(); // 🔒 버튼 가시성 업데이트 (저장 버튼 표시)

        const menuTitleElement = document.getElementById('menuTitle');
        if (menuTitleElement) {
            menuTitleElement.textContent = '새 메뉴 만들기';
            console.log('메뉴 제목을 "새 메뉴 만들기"로 변경');
        }

        // 검색창에 입력된 텍스트를 먼저 저장
        const searchText = document.getElementById('menuSearch')?.value.trim() || '';

        const categoryInputs = document.querySelectorAll('input[name="category"]');
        categoryInputs.forEach(input => input.checked = false);

        this.resetGrid(true);  // skipConfirm = true로 설정하여 확인 메시지 생략
        this.clearPhoto();

        const cookingNoteElement = document.getElementById('cookingNote');
        if (cookingNoteElement) {
            cookingNoteElement.value = '';
        }

        // resetGrid 후에 메뉴명 설정 (resetGrid가 메뉴명을 초기화하므로)
        const menuNameElement = document.getElementById('menuName');
        if (menuNameElement) {
            menuNameElement.value = searchText;
            menuNameElement.focus();
        }

        // 접두사/접미사 설정
        const prefixElement = document.getElementById('menuPrefix');
        const suffixElement = document.getElementById('menuSuffix');

        // 새 메뉴: 현재 선택된 사업장 약어를 접두사로 자동 설정
        let siteAbbr = '';
        try {
            const context = window.SiteSelector?.getCurrentContext();
            siteAbbr = context?.site_abbr || '';
        } catch (e) {
            console.log('SiteSelector에서 사업장 약어 가져오기 실패:', e);
        }

        if (prefixElement) prefixElement.value = siteAbbr;  // 사업장 약어를 접두사로
        if (suffixElement) suffixElement.value = '';  // 접미사는 빈 값
        // 현재 사업장 약어 저장
        this.currentMenuSiteAbbr = siteAbbr;
        this.currentMenuCatAbbr = '';
        this.updateMenuDisplayPreview();

        // 새 메뉴 만들기 시 '다른 이름으로 저장' 버튼 숨김
        const saveAsButton = document.getElementById('saveAsButton');
        if (saveAsButton) {
            saveAsButton.style.display = 'none';
        }
    }

    /**
     * 검색된 이름으로 새 메뉴 만들기
     */
    createNewMenuWithName(menuName) {
        this.createNewMenu();

        const menuNameElement = document.getElementById('menuName');
        if (menuNameElement) {
            menuNameElement.value = menuName;
        }

        // 첫 번째 카테고리 자동 선택
        const firstCategory = document.querySelector('input[name="category"]');
        if (firstCategory) {
            firstCategory.checked = true;
        }
    }
}

// 전역 노출 - dashboard-init에서 호출할 수 있도록
window.MenuRecipeManagement = {
    init: () => {
        if (!window.menuRecipeManagementInstance) {
            window.menuRecipeManagementInstance = new MenuRecipeManagement();
        }
        return window.menuRecipeManagementInstance.init();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ingredientsGrid')) {
        window.menuRecipeManagementInstance = new MenuRecipeManagement();
        window.menuRecipeManagementInstance.init();

        // selectMenu 전역 함수 추가 (HTML onclick에서 사용)
        window.selectMenu = (menuId, element) => {
            window.menuRecipeManagementInstance.selectMenu(menuId, element);
        };

        console.log('✅ MenuRecipeManagement 초기화 완료');
    }
});