/**
 * 사업장 구조 관리 모듈
 * 관리자용 그룹/카테고리/사업장 계층 구조 관리 UI
 */

const SiteStructureManager = (function() {
    'use strict';

    // Private 상태
    let _container = null;
    let _structure = null;
    let _groups = [];
    let _categories = [];
    let _sites = [];
    let _roles = [];
    let _isLoading = false;

    // API 엔드포인트
    const API = {
        groups: '/api/admin/groups',
        categories: '/api/admin/categories',
        sites: '/api/admin/sites',
        structure: '/api/admin/structure/tree',
        roles: '/api/admin/roles'
    };

    // 유틸리티 함수
    function _setLoading(loading) {
        _isLoading = loading;
        if (_container) {
            const spinner = _container.querySelector('.ssm-loading');
            if (spinner) spinner.style.display = loading ? 'flex' : 'none';
        }
    }

    function _showMessage(message, type = 'info') {
        const msgEl = document.createElement('div');
        msgEl.className = `ssm-message ssm-message-${type}`;
        msgEl.textContent = message;
        document.body.appendChild(msgEl);
        setTimeout(() => msgEl.remove(), 3000);
    }

    // API 호출
    async function _fetchData() {
        _setLoading(true);
        try {
            const [groupsRes, structureRes, rolesRes] = await Promise.all([
                fetch(API.groups).then(r => r.json()),
                fetch(API.structure).then(r => r.json()),
                fetch(API.roles).then(r => r.json())
            ]);

            if (groupsRes.success) _groups = groupsRes.data;
            if (structureRes.success) _structure = structureRes.data;
            if (rolesRes.success) _roles = rolesRes.data;

            _render();
        } catch (error) {
            console.error('데이터 로드 실패:', error);
            _showMessage('데이터를 불러오는데 실패했습니다.', 'error');
        } finally {
            _setLoading(false);
        }
    }

    // 그룹 CRUD
    async function _createGroup(data) {
        try {
            const res = await fetch(API.groups, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('그룹이 생성되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '그룹 생성 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('그룹 생성 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _updateGroup(id, data) {
        try {
            const res = await fetch(`${API.groups}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('그룹이 수정되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '그룹 수정 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('그룹 수정 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _deleteGroup(id) {
        if (!confirm('이 그룹을 삭제하시겠습니까?\n하위 카테고리와 사업장 연결도 해제됩니다.')) return false;
        try {
            const res = await fetch(`${API.groups}/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                _showMessage('그룹이 삭제되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '그룹 삭제 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('그룹 삭제 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    // 카테고리 CRUD
    async function _createCategory(groupId, data) {
        try {
            const res = await fetch(`${API.groups}/${groupId}/categories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('카테고리가 생성되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '카테고리 생성 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('카테고리 생성 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _updateCategory(id, data) {
        try {
            const res = await fetch(`${API.categories}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('카테고리가 수정되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '카테고리 수정 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('카테고리 수정 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _deleteCategory(id) {
        if (!confirm('이 카테고리를 삭제하시겠습니까?')) return false;
        try {
            const res = await fetch(`${API.categories}/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                _showMessage('카테고리가 삭제되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '카테고리 삭제 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('카테고리 삭제 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    // 사업장 할당 업데이트
    async function _updateSite(id, data) {
        try {
            const res = await fetch(`${API.sites}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('사업장이 수정되었습니다.', 'success');
                await _fetchData();
                return true;
            }
            _showMessage(result.message || '사업장 수정 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('사업장 수정 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    // 모달 표시
    function _showModal(title, content, onSave) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'ssm-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="ssm-modal">
                <div class="ssm-modal-header">
                    <h3>${title}</h3>
                    <button class="ssm-modal-close">&times;</button>
                </div>
                <div class="ssm-modal-body">
                    ${content}
                </div>
                <div class="ssm-modal-footer">
                    <button class="ssm-btn ssm-btn-secondary ssm-modal-cancel">취소</button>
                    <button class="ssm-btn ssm-btn-primary ssm-modal-save">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const closeModal = () => modalOverlay.remove();

        modalOverlay.querySelector('.ssm-modal-close').onclick = closeModal;
        modalOverlay.querySelector('.ssm-modal-cancel').onclick = closeModal;
        modalOverlay.querySelector('.ssm-modal-save').onclick = () => {
            if (onSave()) closeModal();
        };
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) closeModal();
        };

        return modalOverlay;
    }

    // 그룹 추가/수정 모달
    function _showGroupModal(group = null) {
        const isEdit = !!group;
        const content = `
            <div class="ssm-form-group">
                <label>그룹 코드</label>
                <input type="text" id="modal-group-code" value="${group?.group_code || ''}" ${isEdit ? 'readonly' : ''} placeholder="예: DAEGU">
            </div>
            <div class="ssm-form-group">
                <label>그룹 이름</label>
                <input type="text" id="modal-group-name" value="${group?.group_name || ''}" placeholder="예: 대구지역">
            </div>
            <div class="ssm-form-group">
                <label>설명</label>
                <textarea id="modal-group-desc" rows="2">${group?.description || ''}</textarea>
            </div>
            <div class="ssm-form-group">
                <label>순서</label>
                <input type="number" id="modal-group-order" value="${group?.display_order || 0}">
            </div>
        `;

        _showModal(isEdit ? '그룹 수정' : '그룹 추가', content, () => {
            const data = {
                group_code: document.getElementById('modal-group-code').value.trim(),
                group_name: document.getElementById('modal-group-name').value.trim(),
                description: document.getElementById('modal-group-desc').value.trim(),
                display_order: parseInt(document.getElementById('modal-group-order').value) || 0
            };

            if (!data.group_code || !data.group_name) {
                _showMessage('그룹 코드와 이름은 필수입니다.', 'error');
                return false;
            }

            if (isEdit) {
                _updateGroup(group.id, data);
            } else {
                _createGroup(data);
            }
            return true;
        });
    }

    // 카테고리 추가/수정 모달
    function _showCategoryModal(groupId, category = null) {
        const isEdit = !!category;
        const mealTypes = category?.meal_types || ['조식', '중식', '석식', '야식', '행사'];
        const mealItems = category?.meal_items || ['일반'];

        const content = `
            <div class="ssm-form-group">
                <label>구분코드</label>
                <input type="text" id="modal-cat-code" value="${category?.category_code || ''}" ${isEdit ? 'readonly' : ''} placeholder="예: 001, DOSIRAK, SCHOOL 등 고유코드">
            </div>
            <div class="ssm-form-group">
                <label>구분명칭</label>
                <input type="text" id="modal-cat-name" value="${category?.category_name || ''}" placeholder="예: 도시락, 학교급식">
            </div>
            <div class="ssm-form-group">
                <label>식사 유형 (쉼표로 구분)</label>
                <input type="text" id="modal-cat-meals" value="${mealTypes.join(', ')}" placeholder="조식, 중식, 석식, 야식, 행사">
            </div>
            <div class="ssm-form-group">
                <label>식사 종류 (쉼표로 구분)</label>
                <input type="text" id="modal-cat-items" value="${mealItems.join(', ')}" placeholder="일반, 저염, 채식">
            </div>
            <div class="ssm-form-group">
                <label>순서</label>
                <input type="number" id="modal-cat-order" value="${category?.display_order || 0}">
            </div>
        `;

        _showModal(isEdit ? '카테고리 수정' : '카테고리 추가', content, () => {
            const data = {
                category_code: document.getElementById('modal-cat-code').value.trim(),
                category_name: document.getElementById('modal-cat-name').value.trim(),
                meal_types: document.getElementById('modal-cat-meals').value.split(',').map(s => s.trim()).filter(s => s),
                meal_items: document.getElementById('modal-cat-items').value.split(',').map(s => s.trim()).filter(s => s),
                display_order: parseInt(document.getElementById('modal-cat-order').value) || 0
            };

            if (!data.category_code || !data.category_name) {
                _showMessage('구분코드와 구분명칭은 필수입니다.', 'error');
                return false;
            }

            if (isEdit) {
                _updateCategory(category.id, data);
            } else {
                _createCategory(groupId, data);
            }
            return true;
        });
    }

    // 사업장 할당 모달
    function _showSiteAssignModal(site) {
        const groupOptions = _groups.map(g =>
            `<option value="${g.id}" ${site.group_id === g.id ? 'selected' : ''}>${g.group_name}</option>`
        ).join('');

        // 현재 선택된 그룹의 카테고리 가져오기
        const selectedGroup = _groups.find(g => g.id === site.group_id);
        const categories = _structure?.find(g => g.id === site.group_id)?.categories || [];
        const categoryOptions = categories.map(c =>
            `<option value="${c.id}" ${site.category_id === c.id ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        const content = `
            <div class="ssm-form-group">
                <label>사업장</label>
                <input type="text" value="${site.site_name}" readonly>
            </div>
            <div class="ssm-form-group">
                <label>그룹</label>
                <select id="modal-site-group">
                    <option value="">선택 안함</option>
                    ${groupOptions}
                </select>
            </div>
            <div class="ssm-form-group">
                <label>카테고리</label>
                <select id="modal-site-category">
                    <option value="">선택 안함</option>
                    ${categoryOptions}
                </select>
            </div>
            <div class="ssm-form-group">
                <label>순서</label>
                <input type="number" id="modal-site-order" value="${site.display_order || 0}">
            </div>
        `;

        const modal = _showModal('사업장 할당 변경', content, () => {
            const data = {
                group_id: parseInt(document.getElementById('modal-site-group').value) || null,
                category_id: parseInt(document.getElementById('modal-site-category').value) || null,
                display_order: parseInt(document.getElementById('modal-site-order').value) || 0
            };
            _updateSite(site.id, data);
            return true;
        });

        // 그룹 변경 시 카테고리 옵션 업데이트
        modal.querySelector('#modal-site-group').onchange = function() {
            const groupId = parseInt(this.value);
            const cats = _structure?.find(g => g.id === groupId)?.categories || [];
            const catSelect = modal.querySelector('#modal-site-category');
            catSelect.innerHTML = `<option value="">선택 안함</option>` +
                cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        };
    }

    // 렌더링
    function _render() {
        if (!_container) return;

        _container.innerHTML = `
            <div class="ssm-wrapper">
                <div class="ssm-loading" style="display: none;">
                    <div class="ssm-spinner"></div>
                    <span>로딩 중...</span>
                </div>

                <div class="ssm-header">
                    <h2>사업장 구조 관리</h2>
                    <div class="ssm-header-actions">
                        <button class="ssm-btn ssm-btn-primary" id="ssm-add-group">
                            + 그룹 추가
                        </button>
                        <button class="ssm-btn ssm-btn-secondary" id="ssm-refresh">
                            새로고침
                        </button>
                    </div>
                </div>

                <div class="ssm-content">
                    ${_renderStructureTree()}
                </div>

                <div class="ssm-unassigned">
                    <h3>미할당 사업장</h3>
                    ${_renderUnassignedSites()}
                </div>
            </div>
        `;

        _bindEvents();
    }

    function _renderStructureTree() {
        if (!_structure || _structure.length === 0) {
            return '<div class="ssm-empty">등록된 그룹이 없습니다.</div>';
        }

        return _structure.map(group => `
            <div class="ssm-group" data-group-id="${group.id}">
                <div class="ssm-group-header">
                    <span class="ssm-expand-btn">▶</span>
                    <span class="ssm-group-name">${group.name}</span>
                    <span class="ssm-group-code">(${group.code})</span>
                    <span class="ssm-badge">${_countSitesInGroup(group)}개 사업장</span>
                    <div class="ssm-group-actions">
                        <button class="ssm-btn-icon ssm-add-category" title="카테고리 추가">➕</button>
                        <button class="ssm-btn-icon ssm-edit-group" title="수정">✏️</button>
                        <button class="ssm-btn-icon ssm-delete-group" title="삭제">🗑️</button>
                    </div>
                </div>
                <div class="ssm-group-content">
                    ${_renderCategories(group)}
                </div>
            </div>
        `).join('');
    }

    function _renderCategories(group) {
        if (!group.categories || group.categories.length === 0) {
            return '<div class="ssm-empty-category">카테고리 없음</div>';
        }

        return group.categories.map(cat => `
            <div class="ssm-category" data-category-id="${cat.id}">
                <div class="ssm-category-header">
                    <span class="ssm-expand-btn">▶</span>
                    <span class="ssm-category-name">${cat.name}</span>
                    <span class="ssm-category-info">
                        [${cat.mealTypes?.join(', ') || '-'}]
                    </span>
                    <span class="ssm-badge">${cat.sites?.length || 0}개</span>
                    <div class="ssm-category-actions">
                        <button class="ssm-btn-icon ssm-edit-category" title="수정">✏️</button>
                        <button class="ssm-btn-icon ssm-delete-category" title="삭제">🗑️</button>
                    </div>
                </div>
                <div class="ssm-category-content">
                    ${_renderSites(cat.sites, group.id, cat.id)}
                </div>
            </div>
        `).join('');
    }

    function _renderSites(sites, groupId, categoryId) {
        if (!sites || sites.length === 0) {
            return '<div class="ssm-empty-sites">사업장 없음</div>';
        }

        return sites.map(site => `
            <div class="ssm-site" data-site-id="${site.id}">
                <span class="ssm-site-icon">📍</span>
                <span class="ssm-site-name">${site.name}</span>
                <span class="ssm-site-code">(${site.code})</span>
                <button class="ssm-btn-icon ssm-edit-site" title="할당 변경">🔄</button>
            </div>
        `).join('');
    }

    function _renderUnassignedSites() {
        // 구조에서 모든 할당된 사업장 ID 수집
        const assignedIds = new Set();
        _structure?.forEach(group => {
            group.categories?.forEach(cat => {
                cat.sites?.forEach(site => assignedIds.add(site.id));
            });
        });

        // _groups에서 모든 사업장 가져오기 (API가 다르므로 별도 호출 필요)
        // 현재는 빈 목록 표시
        return '<div class="ssm-empty-sites">모든 사업장이 할당되었습니다.</div>';
    }

    function _countSitesInGroup(group) {
        let count = 0;
        group.categories?.forEach(cat => {
            count += cat.sites?.length || 0;
        });
        return count;
    }

    function _bindEvents() {
        if (!_container) return;

        // 그룹 추가
        _container.querySelector('#ssm-add-group')?.addEventListener('click', () => {
            _showGroupModal();
        });

        // 새로고침
        _container.querySelector('#ssm-refresh')?.addEventListener('click', () => {
            _fetchData();
        });

        // 그룹 확장/축소
        _container.querySelectorAll('.ssm-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.ssm-group-actions')) return;
                header.closest('.ssm-group').classList.toggle('expanded');
            });
        });

        // 카테고리 확장/축소
        _container.querySelectorAll('.ssm-category-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.ssm-category-actions')) return;
                header.closest('.ssm-category').classList.toggle('expanded');
            });
        });

        // 그룹 수정
        _container.querySelectorAll('.ssm-edit-group').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(btn.closest('.ssm-group').dataset.groupId);
                const group = _groups.find(g => g.id === groupId);
                if (group) _showGroupModal(group);
            });
        });

        // 그룹 삭제
        _container.querySelectorAll('.ssm-delete-group').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(btn.closest('.ssm-group').dataset.groupId);
                _deleteGroup(groupId);
            });
        });

        // 카테고리 추가
        _container.querySelectorAll('.ssm-add-category').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = parseInt(btn.closest('.ssm-group').dataset.groupId);
                _showCategoryModal(groupId);
            });
        });

        // 카테고리 수정
        _container.querySelectorAll('.ssm-edit-category').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const categoryId = parseInt(btn.closest('.ssm-category').dataset.categoryId);
                const groupId = parseInt(btn.closest('.ssm-group').dataset.groupId);
                const group = _structure?.find(g => g.id === groupId);
                const category = group?.categories?.find(c => c.id === categoryId);
                if (category) {
                    // API에서 받은 형식을 변환
                    const catData = {
                        id: category.id,
                        category_code: category.code,
                        category_name: category.name,
                        meal_types: category.mealTypes,
                        meal_items: category.mealItems,
                        display_order: category.order
                    };
                    _showCategoryModal(groupId, catData);
                }
            });
        });

        // 카테고리 삭제
        _container.querySelectorAll('.ssm-delete-category').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const categoryId = parseInt(btn.closest('.ssm-category').dataset.categoryId);
                _deleteCategory(categoryId);
            });
        });

        // 사업장 할당 변경
        _container.querySelectorAll('.ssm-edit-site').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const siteId = parseInt(btn.closest('.ssm-site').dataset.siteId);
                const groupId = parseInt(btn.closest('.ssm-group').dataset.groupId);
                const categoryId = parseInt(btn.closest('.ssm-category').dataset.categoryId);
                const group = _structure?.find(g => g.id === groupId);
                const category = group?.categories?.find(c => c.id === categoryId);
                const site = category?.sites?.find(s => s.id === siteId);
                if (site) {
                    _showSiteAssignModal({
                        id: site.id,
                        site_name: site.name,
                        site_code: site.code,
                        group_id: groupId,
                        category_id: categoryId,
                        display_order: site.order || 0
                    });
                }
            });
        });
    }

    // Public API
    return {
        init(containerId) {
            console.log('SiteStructureManager 초기화');

            if (typeof containerId === 'string') {
                _container = document.getElementById(containerId);
            } else {
                _container = containerId;
            }

            if (!_container) {
                console.error('SiteStructureManager: Container not found');
                return false;
            }

            _fetchData();
            return true;
        },

        refresh() {
            _fetchData();
        },

        getStructure() {
            return _structure;
        },

        getGroups() {
            return _groups;
        }
    };
})();

// 전역 접근
window.SiteStructureManager = SiteStructureManager;
