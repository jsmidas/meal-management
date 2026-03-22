/**
 * 사업장 선택기 모듈
 * 다중 사업장 시스템의 사업장 선택 UI
 * 그룹(본사, 영남지사, 위탁사업장 등) 레벨에서 선택
 * 카테고리(도시락, 운반 등)는 선택 단위가 아님
 */

const SiteSelector = (function() {
    'use strict';

    // Private 상태
    let _structure = null;     // 전체 계층 구조 데이터
    let _currentContext = null; // 현재 선택된 컨텍스트
    let _favorites = [];        // 즐겨찾기 목록
    let _container = null;      // 렌더링 컨테이너
    let _isOpen = false;        // 드롭다운 열림 상태
    let _isLoading = false;     // 로딩 상태
    let _structureCache = null; // 구조 데이터 캐시
    let _structureCacheTime = 0; // 캐시 시간
    const CACHE_TTL = 5 * 60 * 1000; // 5분 캐시
    let _userGroupId = null;    // 사용자 소속 그룹 ID (권한 필터링용)

    // 이벤트 리스너
    const _listeners = {
        siteChange: [],
        structureLoad: [],
        error: []
    };

    // API 엔드포인트
    const API = {
        structure: '/api/admin/structure/tree',
        context: '/api/user/current-context',
        selectContext: '/api/user/select-context',
        favorites: '/api/user/favorites'
    };

    // 유틸리티 함수
    function _notify(event, data) {
        if (_listeners[event]) {
            _listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`SiteSelector event error (${event}):`, e); }
            });
        }
    }

    function _setLoading(loading) {
        _isLoading = loading;
        if (_container) {
            _container.classList.toggle('loading', loading);
        }
    }

    // API 호출 함수들 (캐싱 적용)
    async function _fetchStructure() {
        // 캐시가 유효하면 캐시 사용
        const now = Date.now();
        if (_structureCache && (now - _structureCacheTime) < CACHE_TTL) {
            console.log('📦 구조 데이터 캐시 사용');
            _structure = _structureCache;
            return _structure;
        }

        try {
            const response = await fetch(API.structure);
            if (!response.ok) throw new Error('Failed to fetch structure');
            const result = await response.json();
            if (result.success) {
                _structure = result.data;
                // 캐시 저장
                _structureCache = result.data;
                _structureCacheTime = now;
                console.log('📡 구조 데이터 새로 로드 및 캐시');
                _notify('structureLoad', _structure);
                return _structure;
            }
            throw new Error(result.message || result.error || 'Unknown error');
        } catch (error) {
            console.error('Structure fetch error:', error);
            _notify('error', { message: '사업장 구조를 불러올 수 없습니다.', error });
            return null;
        }
    }

    async function _fetchCurrentContext() {
        try {
            const response = await fetch(API.context);
            if (!response.ok) return null;
            const result = await response.json();
            if (result.success) {
                _currentContext = result.data;
                return _currentContext;
            }
            return null;
        } catch (error) {
            console.error('Context fetch error:', error);
            return null;
        }
    }

    async function _fetchFavorites() {
        try {
            const response = await fetch(API.favorites);
            if (!response.ok) return [];
            const result = await response.json();
            if (result.success) {
                _favorites = result.data || [];
                return _favorites;
            }
            return [];
        } catch (error) {
            console.error('Favorites fetch error:', error);
            return [];
        }
    }

    /**
     * 그룹(사업장) 선택 - 본사, 영남지사, 위탁사업장 등
     * 카테고리가 아닌 그룹 레벨에서 선택
     */
    async function _selectGroup(groupId, groupName, groupData) {
        try {
            // 그룹 내 모든 카테고리의 mealTypes, mealItems 수집
            let allMealTypes = new Set();
            let allMealItems = new Set();

            if (groupData && groupData.categories) {
                groupData.categories.forEach(cat => {
                    if (cat.mealTypes) cat.mealTypes.forEach(t => allMealTypes.add(t));
                    if (cat.mealItems) cat.mealItems.forEach(i => allMealItems.add(i));
                });
            }

            // 끼니는 기본값 1개 (필요시 사용자가 추가)
            if (allMealTypes.size === 0) {
                allMealTypes = new Set(['중식']);
            }
            if (allMealItems.size === 0) {
                allMealItems = new Set(['일반']);
            }

            _currentContext = {
                group_id: groupId,
                group_name: groupName,
                site_id: groupId,  // 하위 호환성을 위해 group_id를 site_id로도 사용
                site_name: groupName,
                site_abbr: groupData?.abbreviation || '',  // 사업장 약어 (접두사 자동 입력용)
                category_id: null,  // 그룹 레벨 선택이므로 카테고리는 null
                category_name: null,
                meal_types: Array.from(allMealTypes),
                meal_items: Array.from(allMealItems),
                categories: groupData?.categories || []  // 그룹 내 카테고리 정보 포함
            };

            // AppState에 반영
            if (window.AppState) {
                AppState.set({
                    currentSiteId: groupId,
                    currentSiteName: groupName,
                    currentGroupId: groupId,
                    currentCategoryId: null,
                    currentMealTypes: _currentContext.meal_types,
                    currentMealItems: _currentContext.meal_items
                });
            }

            // localStorage에 저장
            localStorage.setItem('currentSiteContext', JSON.stringify(_currentContext));

            // UI 먼저 업데이트 (빠른 반응)
            _notify('siteChange', _currentContext);
            _close();
            _render();

            // 서버에도 컨텍스트 저장 시도 (백그라운드, 실패해도 로컬은 유지)
            fetch(API.selectContext, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: groupId })
            }).catch(e => console.warn('서버 컨텍스트 저장 실패:', e));
            return true;
        } catch (error) {
            console.error('Group selection error:', error);
            _notify('error', { message: '사업장 선택에 실패했습니다.', error });
            return false;
        }
    }

    /**
     * 위탁사업장 선택 - 군위복지관, 아이팜코리아 등 개별 사업장
     */
    async function _selectConsignmentSite(groupId, groupName, categoryId, categoryName, siteId, siteName) {
        try {
            // 구조에서 카테고리 정보 찾기
            const group = _structure?.find(g => g.id === groupId);
            const category = group?.categories?.find(c => c.id === categoryId);

            const mealTypes = category?.mealTypes || ['중식'];  // 기본 1개
            const mealItems = category?.mealItems || ['일반'];

            _currentContext = {
                group_id: groupId,
                group_name: groupName,
                category_id: categoryId,
                category_name: categoryName,
                site_id: siteId || categoryId,  // siteId가 없으면 categoryId 사용
                site_name: siteName,
                site_abbr: category?.abbreviation || '',  // 사업장 약어 (접두사 자동 입력용)
                meal_types: mealTypes,
                meal_items: mealItems,
                is_consignment: true  // 위탁사업장 표시
            };

            // AppState에 반영
            if (window.AppState) {
                AppState.set({
                    currentSiteId: _currentContext.site_id,
                    currentSiteName: siteName,
                    currentGroupId: groupId,
                    currentCategoryId: categoryId,
                    currentMealTypes: mealTypes,
                    currentMealItems: mealItems
                });
            }

            // localStorage에 저장
            localStorage.setItem('currentSiteContext', JSON.stringify(_currentContext));

            // UI 먼저 업데이트 (빠른 반응)
            _notify('siteChange', _currentContext);
            _close();
            _render();

            // 서버에도 컨텍스트 저장 시도 (백그라운드)
            fetch(API.selectContext, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_id: groupId,
                    category_id: categoryId,
                    site_id: siteId
                })
            }).catch(e => console.warn('서버 컨텍스트 저장 실패:', e));
            return true;
        } catch (error) {
            console.error('Consignment site selection error:', error);
            _notify('error', { message: '사업장 선택에 실패했습니다.', error });
            return false;
        }
    }

    // 하위 호환성을 위해 _selectSite도 유지
    async function _selectSite(siteId, siteName, groupId, categoryId) {
        // 그룹 정보를 찾아서 적절한 선택 함수 호출
        if (_structure) {
            const group = _structure.find(g => g.id === groupId);
            if (group) {
                // 위탁사업장인 경우
                const isConsignment = group.code === 'Meal' || group.name === '위탁사업장' ||
                                      group.code?.toLowerCase().includes('consign') ||
                                      group.name?.includes('위탁');
                if (isConsignment && categoryId) {
                    const category = group.categories?.find(c => c.id === categoryId);
                    return _selectConsignmentSite(groupId, group.name, categoryId, category?.name, siteId, siteName);
                }
                return _selectGroup(groupId, group.name, group);
            }
        }
        return _selectGroup(siteId, siteName, null);
    }

    async function _addFavorite(siteId) {
        try {
            const response = await fetch(API.favorites, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ site_id: siteId })
            });

            if (response.ok) {
                await _fetchFavorites();
                _render();
            }
        } catch (error) {
            console.error('Add favorite error:', error);
        }
    }

    async function _removeFavorite(favoriteId) {
        try {
            const response = await fetch(`${API.favorites}/${favoriteId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await _fetchFavorites();
                _render();
            }
        } catch (error) {
            console.error('Remove favorite error:', error);
        }
    }

    // 드롭다운 열기/닫기
    function _toggle() {
        if (_isOpen) {
            _close();
        } else {
            _open();
        }
    }

    function _open() {
        _isOpen = true;
        if (_container) {
            const dropdown = _container.querySelector('.site-selector-dropdown');
            if (dropdown) {
                dropdown.classList.add('open');
            }
        }
        // 외부 클릭 감지
        setTimeout(() => {
            document.addEventListener('click', _handleOutsideClick);
        }, 10);
    }

    function _close() {
        _isOpen = false;
        if (_container) {
            const dropdown = _container.querySelector('.site-selector-dropdown');
            if (dropdown) {
                dropdown.classList.remove('open');
            }
        }
        document.removeEventListener('click', _handleOutsideClick);
    }

    function _handleOutsideClick(e) {
        if (_container && !_container.contains(e.target)) {
            _close();
        }
    }

    // HTML 렌더링
    function _render() {
        if (!_container) return;

        const currentSiteName = _currentContext?.site_name || '사업장 선택';

        _container.innerHTML = `
            <div class="site-selector-wrapper">
                <button class="site-selector-trigger" type="button">
                    <span class="site-selector-icon">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                            <polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                    </span>
                    <span class="site-selector-text">${currentSiteName}</span>
                    <span class="site-selector-arrow">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </span>
                </button>
                <div class="site-selector-dropdown">
                    ${_renderDropdownContent()}
                </div>
            </div>
        `;

        // 이벤트 바인딩
        _bindEvents();
    }

    function _renderDropdownContent() {
        if (_isLoading) {
            return '<div class="site-selector-loading">로딩 중...</div>';
        }

        if (!_structure || _structure.length === 0) {
            return '<div class="site-selector-empty">사업장 구조가 없습니다.</div>';
        }

        let html = '<div class="site-selector-dropdown-inner">';

        // 즐겨찾기 섹션
        if (_favorites.length > 0) {
            html += `
                <div class="site-selector-section">
                    <div class="site-selector-section-title">즐겨찾기</div>
                    ${_favorites.map(fav => `
                        <div class="site-selector-item favorite"
                             data-group-id="${fav.group_id || fav.site_id}"
                             data-group-name="${fav.group_name || fav.site_name}">
                            <span class="site-selector-item-icon star">★</span>
                            <span class="site-selector-item-text">${fav.group_name || fav.site_name}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="site-selector-divider"></div>
            `;
        }

        // 사업장 목록 - 평면화하여 표시
        // 본사, 영남지사는 그룹 레벨로 선택
        // 위탁사업장(consignment)은 하위 카테고리/사이트를 각각 표시
        html += '<div class="site-selector-section">';
        html += '<div class="site-selector-section-title">사업장 선택</div>';

        console.log('[SiteSelector] Rendering groups:', _structure?.map(g => g.name));
        _structure.forEach(group => {
            console.log('[SiteSelector] Group:', group.name, 'isConsignment:', group.code === 'Meal');
            const isConsignment = group.code === 'Meal' || group.name === '위탁사업장' ||
                                  group.code?.toLowerCase().includes('consign') ||
                                  group.name?.includes('위탁');

            if (isConsignment && group.categories && group.categories.length > 0) {
                // 위탁사업장: 하위 카테고리/사이트를 각각 표시
                group.categories.forEach(category => {
                    // 카테고리의 사이트가 있으면 사이트 정보 사용, 없으면 카테고리 정보 사용
                    const site = category.sites && category.sites.length > 0 ? category.sites[0] : null;
                    const itemId = site ? site.id : category.id;
                    const itemName = site ? site.name : category.name;
                    const isCurrent = _currentContext?.site_id === itemId ||
                                      _currentContext?.category_id === category.id;

                    html += `
                        <div class="site-selector-item consignment-item ${isCurrent ? 'current' : ''}"
                             data-group-id="${group.id}"
                             data-group-name="${group.name}"
                             data-category-id="${category.id}"
                             data-category-name="${category.name}"
                             data-site-id="${site ? site.id : ''}"
                             data-site-name="${itemName}">
                            <span class="site-selector-item-icon">🏭</span>
                            <span class="site-selector-item-text">${itemName}</span>
                        </div>
                    `;
                });
            } else {
                // 본사, 영남지사 등: 그룹 레벨로 선택
                const isCurrent = _currentContext?.group_id === group.id &&
                                  !_currentContext?.category_id;

                html += `
                    <div class="site-selector-item group-item ${isCurrent ? 'current' : ''}"
                         data-group-id="${group.id}"
                         data-group-name="${group.name}">
                        <span class="site-selector-item-icon">🏢</span>
                        <span class="site-selector-item-text">${group.name}</span>
                    </div>
                `;
            }
        });

        html += '</div>';  // section 닫기
        html += '</div>';  // site-selector-dropdown-inner 닫기

        return html;
    }

    function _renderCategories(group) {
        if (!group.categories || group.categories.length === 0) {
            return '<div class="site-selector-empty-category">카테고리 없음</div>';
        }

        return group.categories.map(category => `
            <div class="site-selector-category" data-category-id="${category.id}">
                <div class="site-selector-category-header">
                    <span class="site-selector-expand-icon">▶</span>
                    <span class="site-selector-category-name">${category.name}</span>
                    <span class="site-selector-count">${category.sites?.length || 0}</span>
                </div>
                <div class="site-selector-category-content">
                    ${_renderSites(category.sites, group.id, category.id)}
                </div>
            </div>
        `).join('');
    }

    function _renderSites(sites, groupId, categoryId) {
        if (!sites || sites.length === 0) {
            return '<div class="site-selector-empty-sites">사업장 없음</div>';
        }

        return sites.map(site => {
            const isCurrent = _currentContext?.site_id === site.id;
            const isFavorite = _favorites.some(f => f.site_id === site.id);

            return `
                <div class="site-selector-item site ${isCurrent ? 'current' : ''}"
                     data-site-id="${site.id}"
                     data-site-name="${site.name}"
                     data-site-code="${site.code}"
                     data-group-id="${groupId}"
                     data-category-id="${categoryId}">
                    <span class="site-selector-item-icon">📍</span>
                    <span class="site-selector-item-text">${site.name}</span>
                    <button class="site-selector-favorite-btn ${isFavorite ? 'active' : ''}"
                            data-site-id="${site.id}"
                            title="${isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                        ${isFavorite ? '★' : '☆'}
                    </button>
                </div>
            `;
        }).join('');
    }

    function _countSitesInGroup(group) {
        let count = 0;
        if (group.categories) {
            group.categories.forEach(cat => {
                count += cat.sites?.length || 0;
            });
        }
        return count;
    }

    function _bindEvents() {
        if (!_container) return;

        // 트리거 버튼 클릭
        const trigger = _container.querySelector('.site-selector-trigger');
        if (trigger) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                _toggle();
            });
        }

        // 그룹(본사, 영남지사 등) 아이템 클릭
        _container.querySelectorAll('.site-selector-item.group-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(item.dataset.groupId);
                const groupName = item.dataset.groupName;

                // 구조에서 그룹 데이터 찾기
                const groupData = _structure?.find(g => g.id === groupId);
                _selectGroup(groupId, groupName, groupData);
            });
        });

        // 위탁사업장 아이템 클릭
        _container.querySelectorAll('.site-selector-item.consignment-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(item.dataset.groupId);
                const groupName = item.dataset.groupName;
                const categoryId = item.dataset.categoryId ? parseInt(item.dataset.categoryId) : null;
                const categoryName = item.dataset.categoryName;
                const siteId = item.dataset.siteId ? parseInt(item.dataset.siteId) : null;
                const siteName = item.dataset.siteName;

                // 위탁사업장 선택
                _selectConsignmentSite(groupId, groupName, categoryId, categoryName, siteId, siteName);
            });
        });

        // 즐겨찾기 아이템 클릭
        _container.querySelectorAll('.site-selector-item.favorite').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(item.dataset.groupId);
                const groupName = item.dataset.groupName;

                // 구조에서 그룹 데이터 찾기
                const groupData = _structure?.find(g => g.id === groupId);
                _selectGroup(groupId, groupName, groupData);
            });
        });
    }

    // 사용자 권한 정보 저장용 변수
    let _userRole = 'user';
    let _userManagedCategories = [];  // 관리 카테고리 ID 목록
    let _userManagedGroups = [];      // 관리 그룹 ID 목록

    // 사용자 권한 정보 로드
    function _loadUserPermissions() {
        try {
            const userInfoStr = localStorage.getItem('user_info') || localStorage.getItem('user');
            if (userInfoStr) {
                const userInfo = JSON.parse(userInfoStr);
                _userGroupId = userInfo.group_id || null;
                _userRole = userInfo.role || 'user';
                _userManagedCategories = userInfo.managed_categories || [];
                _userManagedGroups = userInfo.managed_groups || [];
                console.log('[SiteSelector] 사용자 권한 로드:', {
                    role: _userRole,
                    groupId: _userGroupId,
                    managedCategories: _userManagedCategories,
                    managedGroups: _userManagedGroups
                });
            }
        } catch (e) {
            console.warn('[SiteSelector] 사용자 권한 정보 로드 실패:', e);
            _userGroupId = null;
            _userRole = 'user';
            _userManagedCategories = [];
            _userManagedGroups = [];
        }
    }

    // 사용자 권한에 따라 구조 데이터 필터링
    function _filterStructureByPermission() {
        if (!_structure) return;

        // admin은 모든 사업장 접근 가능
        if (_userRole === 'admin') {
            console.log('[SiteSelector] 관리자 - 모든 사업장 접근 가능');
            return;
        }

        // operator도 모든 사업장 접근 가능 (운영 담당자)
        if (_userRole === 'operator') {
            console.log('[SiteSelector] 운영 담당자 - 모든 사업장 접근 가능');
            return;
        }

        // managed_categories 또는 managed_groups 기반 필터링
        const hasCategories = _userManagedCategories && _userManagedCategories.length > 0;
        const hasGroups = _userManagedGroups && _userManagedGroups.length > 0;

        if (!hasCategories && !hasGroups && !_userGroupId) {
            console.log('[SiteSelector] 권한 정보 없음 - 필터링 스킵');
            return;
        }

        // 구조 데이터 필터링
        const filteredStructure = _structure.map(group => {
            const isConsignment = group.code === 'Meal' || group.name === '위탁사업장' ||
                                  group.code?.toLowerCase().includes('consign') ||
                                  group.name?.includes('위탁');

            // 위탁사업장 그룹인 경우: 카테고리 단위로 필터링
            if (isConsignment && group.categories && hasCategories) {
                const filteredCategories = group.categories.filter(cat =>
                    _userManagedCategories.includes(cat.id)
                );

                if (filteredCategories.length > 0) {
                    return { ...group, categories: filteredCategories };
                }
                return null;  // 접근 가능한 카테고리 없음
            }

            // 일반 그룹 (본사, 영남지사 등): 그룹 단위로 필터링
            if (hasGroups && _userManagedGroups.includes(group.id)) {
                return group;
            }

            // group_id 기반 필터링 (하위 호환성)
            if (_userGroupId && group.id === _userGroupId) {
                return group;
            }

            return null;
        }).filter(group => group !== null);

        console.log('[SiteSelector] 권한 필터링 적용:', _structure.length, '→', filteredStructure.length);
        _structure = filteredStructure;
    }

    // 저장된 컨텍스트 복원
    function _restoreContext() {
        try {
            const saved = localStorage.getItem('currentSiteContext');
            if (saved) {
                _currentContext = JSON.parse(saved);

                // AppState에 반영
                if (window.AppState && _currentContext) {
                    AppState.set({
                        currentSiteId: _currentContext.site_id,
                        currentSiteName: _currentContext.site_name,
                        currentGroupId: _currentContext.group_id,
                        currentCategoryId: _currentContext.category_id
                    });
                }

                return true;
            }
        } catch (error) {
            console.error('Context restore error:', error);
        }
        return false;
    }

    // 사용자 할당 사업장 자동 선택
    async function _autoSelectUserSite() {
        try {
            // 이미 컨텍스트가 있으면 스킵
            if (_currentContext?.site_id) {
                console.log('[SiteSelector] 이미 선택된 사업장 있음:', _currentContext.site_name);
                return false;
            }

            // 사용자 정보에서 할당된 사업장 확인
            const userInfoStr = localStorage.getItem('user_info') || localStorage.getItem('user');
            if (!userInfoStr) {
                console.log('[SiteSelector] 사용자 정보 없음');
                return false;
            }

            const userInfo = JSON.parse(userInfoStr);
            const assignedSites = userInfo.assigned_sites || [];

            console.log('[SiteSelector] 사용자 할당 사업장:', assignedSites);

            if (assignedSites.length === 0) {
                // 할당된 사업장 없음 - admin이면 전체, 아니면 선택 대기
                if (userInfo.role === 'admin' || userInfo.role === 'operator') {
                    console.log('[SiteSelector] 관리자/운영자 - 전체 사업장 접근 가능');
                }
                return false;
            }

            if (assignedSites.length === 1) {
                // 사업장이 1개면 자동 선택
                const site = assignedSites[0];
                console.log('[SiteSelector] 사업장 자동 선택:', site.site_name);

                // 구조 데이터에서 해당 사업장 찾기
                if (_structure) {
                    const group = _structure.find(g => g.id === site.site_id);
                    if (group) {
                        await _selectGroup(site.site_id, site.site_name, group);
                        return true;
                    }
                }

                // 구조에서 못 찾으면 직접 설정
                _currentContext = {
                    group_id: site.site_id,
                    group_name: site.site_name,
                    site_id: site.site_id,
                    site_name: site.site_name,
                    site_abbr: site.abbreviation || '',
                    category_id: null,
                    category_name: null,
                    meal_types: ['중식'],
                    meal_items: ['일반']
                };
                localStorage.setItem('currentSiteContext', JSON.stringify(_currentContext));
                _notify('siteChange', _currentContext);
                return true;
            }

            // 여러 사업장이 있으면 선택 UI 표시 (자동 선택 안 함)
            console.log('[SiteSelector] 여러 사업장 할당됨 - 사용자 선택 필요');
            return false;

        } catch (error) {
            console.error('[SiteSelector] 자동 사업장 선택 오류:', error);
            return false;
        }
    }

    // Public API
    return {
        /**
         * 초기화
         * @param {string|HTMLElement} containerId - 렌더링할 컨테이너 ID 또는 요소
         */
        async init(containerId) {
            console.log('SiteSelector 초기화 시작');

            // 컨테이너 설정
            if (typeof containerId === 'string') {
                _container = document.getElementById(containerId);
            } else if (containerId instanceof HTMLElement) {
                _container = containerId;
            }

            if (!_container) {
                console.warn('SiteSelector: Container not found');
                return false;
            }

            _container.classList.add('site-selector');

            // 사용자 권한 정보 로드
            _loadUserPermissions();

            // 🚀 즉시 로딩 플레이스홀더 표시 (딜레이 제거)
            _restoreContext();
            const savedName = _currentContext?.site_name || '사업장 선택';
            _container.innerHTML = `
                <div class="site-selector-wrapper">
                    <button class="site-selector-trigger" disabled style="opacity: 0.7;">
                        <span class="site-selector-icon"><i class="fas fa-building"></i></span>
                        <span class="site-selector-text">${savedName}</span>
                        <span class="site-selector-arrow"><i class="fas fa-spinner fa-spin"></i></span>
                    </button>
                </div>
            `;

            try {
                // ★ 구조 데이터만 우선 로드 (즐겨찾기는 비동기 지연)
                await _fetchStructure();

                // 사용자 권한에 따라 구조 데이터 필터링
                _filterStructureByPermission();

                // 저장된 컨텍스트가 없으면 사용자 할당 사업장 자동 선택
                if (!_currentContext?.site_id) {
                    await _autoSelectUserSite();
                }

                // 실제 UI 렌더링 (즐겨찾기 없이 먼저 표시)
                _render();

                // ★ 즐겨찾기는 백그라운드 로드 후 UI 갱신
                _fetchFavorites().then(() => {
                    if (_favorites && _favorites.length > 0) {
                        _render(); // 즐겨찾기 반영하여 재렌더링
                    }
                });

                console.log('SiteSelector 초기화 완료');
                return true;
            } catch (error) {
                console.error('SiteSelector init error:', error);
                _notify('error', { message: '사업장 선택기 초기화 실패', error });
                return false;
            }
        },

        /**
         * 그룹(사업장) 선택 - 본사, 영남지사, 위탁사업장 등
         */
        selectGroup: _selectGroup,

        /**
         * 사업장 선택 (하위 호환성)
         */
        selectSite: _selectSite,

        /**
         * 현재 컨텍스트 반환
         */
        getCurrentContext() {
            return _currentContext;
        },

        /**
         * 현재 사업장 ID 반환
         */
        getCurrentSiteId() {
            return _currentContext?.site_id || null;
        },

        /**
         * 현재 사업장 이름 반환
         */
        getCurrentSiteName() {
            return _currentContext?.site_name || null;
        },

        /**
         * 구조 데이터 반환
         */
        getStructure() {
            return _structure;
        },

        /**
         * 모든 사업장 목록 반환 (프리캐시용)
         * @returns {Array} [{id, name, groupName}, ...]
         */
        getAllSites() {
            if (!_structure) return [];
            const sites = [];
            _structure.forEach(group => {
                if (group.categories) {
                    group.categories.forEach(category => {
                        if (category.sites) {
                            category.sites.forEach(site => {
                                sites.push({
                                    id: site.id,
                                    name: site.name,
                                    groupName: group.name,
                                    categoryName: category.name
                                });
                            });
                        }
                    });
                }
            });
            return sites;
        },

        /**
         * 구조 데이터 새로고침
         */
        async refresh() {
            _setLoading(true);
            try {
                await Promise.all([
                    _fetchStructure(),
                    _fetchFavorites()
                ]);
                _render();
            } finally {
                _setLoading(false);
            }
        },

        /**
         * 이벤트 리스너 등록
         * @param {string} event - 'siteChange', 'structureLoad', 'error'
         * @param {Function} callback
         */
        on(event, callback) {
            if (_listeners[event]) {
                _listeners[event].push(callback);
            }
        },

        /**
         * 이벤트 리스너 해제
         */
        off(event, callback) {
            if (_listeners[event]) {
                const idx = _listeners[event].indexOf(callback);
                if (idx > -1) _listeners[event].splice(idx, 1);
            }
        },

        /**
         * 드롭다운 열기/닫기
         */
        toggle: _toggle,
        open: _open,
        close: _close,

        /**
         * 리렌더링
         */
        render: _render
    };
})();

// 전역 접근 가능하게 설정
window.SiteSelector = SiteSelector;
