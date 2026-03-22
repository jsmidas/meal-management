/**
 * 사용자 권한 관리 모듈
 * 사용자별 사업장 접근 권한 관리 UI
 */

const UserPermissionManager = (function() {
    'use strict';

    // Private 상태
    let _container = null;
    let _users = [];
    let _sites = [];
    let _groups = [];
    let _roles = [];
    let _accessList = [];
    let _selectedUserId = null;
    let _isLoading = false;

    // API 엔드포인트
    const API = {
        users: '/api/admin/users',
        sites: '/api/admin/sites',
        groups: '/api/admin/groups',
        roles: '/api/admin/roles',
        access: '/api/admin/user-site-access',
        structure: '/api/admin/structure/tree'
    };

    // 유틸리티 함수
    function _setLoading(loading) {
        _isLoading = loading;
        if (_container) {
            const spinner = _container.querySelector('.upm-loading');
            if (spinner) spinner.style.display = loading ? 'flex' : 'none';
        }
    }

    function _showMessage(message, type = 'info') {
        const msgEl = document.createElement('div');
        msgEl.className = `upm-message upm-message-${type}`;
        msgEl.textContent = message;
        document.body.appendChild(msgEl);
        setTimeout(() => msgEl.remove(), 3000);
    }

    // API 호출
    async function _fetchData() {
        _setLoading(true);
        try {
            const [usersRes, sitesRes, groupsRes, rolesRes] = await Promise.all([
                fetch(API.users).then(r => r.json()),
                fetch(API.sites).then(r => r.json()),
                fetch(API.groups).then(r => r.json()),
                fetch(API.roles).then(r => r.json())
            ]);

            if (usersRes.success !== false) _users = usersRes.data || usersRes;
            if (sitesRes.success) _sites = sitesRes.data;
            if (groupsRes.success) _groups = groupsRes.data;
            if (rolesRes.success) _roles = rolesRes.data;

            _render();
        } catch (error) {
            console.error('데이터 로드 실패:', error);
            _showMessage('데이터를 불러오는데 실패했습니다.', 'error');
        } finally {
            _setLoading(false);
        }
    }

    async function _fetchUserAccess(userId) {
        try {
            const res = await fetch(`${API.access}?user_id=${userId}`);
            const result = await res.json();
            if (result.success) {
                _accessList = result.data || [];
            }
            return _accessList;
        } catch (error) {
            console.error('사용자 권한 로드 실패:', error);
            return [];
        }
    }

    async function _addAccess(data) {
        try {
            const res = await fetch(API.access, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('권한이 추가되었습니다.', 'success');
                return true;
            }
            _showMessage(result.message || '권한 추가 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('권한 추가 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _updateAccess(id, data) {
        try {
            const res = await fetch(`${API.access}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                _showMessage('권한이 수정되었습니다.', 'success');
                return true;
            }
            _showMessage(result.message || '권한 수정 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('권한 수정 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    async function _deleteAccess(id) {
        if (!confirm('이 권한을 삭제하시겠습니까?')) return false;
        try {
            const res = await fetch(`${API.access}/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                _showMessage('권한이 삭제되었습니다.', 'success');
                return true;
            }
            _showMessage(result.message || '권한 삭제 실패', 'error');
            return false;
        } catch (error) {
            _showMessage('권한 삭제 중 오류가 발생했습니다.', 'error');
            return false;
        }
    }

    // 사용자 선택
    async function _selectUser(userId) {
        _selectedUserId = userId;
        _setLoading(true);
        await _fetchUserAccess(userId);
        _setLoading(false);
        _renderUserDetail();
    }

    // 모달 표시
    function _showModal(title, content, onSave) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'upm-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="upm-modal">
                <div class="upm-modal-header">
                    <h3>${title}</h3>
                    <button class="upm-modal-close">&times;</button>
                </div>
                <div class="upm-modal-body">
                    ${content}
                </div>
                <div class="upm-modal-footer">
                    <button class="upm-btn upm-btn-secondary upm-modal-cancel">취소</button>
                    <button class="upm-btn upm-btn-primary upm-modal-save">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const closeModal = () => modalOverlay.remove();

        modalOverlay.querySelector('.upm-modal-close').onclick = closeModal;
        modalOverlay.querySelector('.upm-modal-cancel').onclick = closeModal;
        modalOverlay.querySelector('.upm-modal-save').onclick = async () => {
            if (await onSave()) closeModal();
        };
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) closeModal();
        };

        return modalOverlay;
    }

    // 권한 추가/수정 모달
    function _showAccessModal(access = null) {
        const isEdit = !!access;
        const user = _users.find(u => u.id === _selectedUserId);

        const groupOptions = _groups.map(g =>
            `<option value="${g.id}" ${access?.group_id === g.id ? 'selected' : ''}>${g.group_name}</option>`
        ).join('');

        const siteOptions = _sites.map(s =>
            `<option value="${s.id}" ${access?.site_id === s.id ? 'selected' : ''}>${s.site_name}</option>`
        ).join('');

        const roleOptions = _roles.map(r =>
            `<option value="${r.code}" ${access?.role === r.code ? 'selected' : ''}>${r.name} (Level ${r.level})</option>`
        ).join('');

        const content = `
            <div class="upm-form-group">
                <label>사용자</label>
                <input type="text" value="${user?.username || ''} (${user?.name || ''})" readonly>
            </div>
            <div class="upm-form-group">
                <label>권한 유형</label>
                <select id="modal-access-type">
                    <option value="site" ${!access?.group_id || access?.site_id ? 'selected' : ''}>특정 사업장</option>
                    <option value="group" ${access?.group_id && !access?.site_id ? 'selected' : ''}>그룹 전체</option>
                </select>
            </div>
            <div class="upm-form-group" id="modal-group-wrapper">
                <label>그룹</label>
                <select id="modal-access-group">
                    <option value="">선택 안함</option>
                    ${groupOptions}
                </select>
            </div>
            <div class="upm-form-group" id="modal-site-wrapper">
                <label>사업장</label>
                <select id="modal-access-site">
                    <option value="">선택 안함</option>
                    ${siteOptions}
                </select>
            </div>
            <div class="upm-form-group">
                <label>역할</label>
                <select id="modal-access-role">
                    ${roleOptions}
                </select>
            </div>
            <div class="upm-form-group">
                <label>
                    <input type="checkbox" id="modal-access-default" ${access?.is_default ? 'checked' : ''}>
                    기본 사업장으로 설정
                </label>
            </div>
        `;

        const modal = _showModal(isEdit ? '권한 수정' : '권한 추가', content, async () => {
            const accessType = document.getElementById('modal-access-type').value;
            const data = {
                user_id: _selectedUserId,
                group_id: accessType === 'group' ? parseInt(document.getElementById('modal-access-group').value) || null : null,
                site_id: accessType === 'site' ? parseInt(document.getElementById('modal-access-site').value) || null : null,
                role: document.getElementById('modal-access-role').value,
                is_default: document.getElementById('modal-access-default').checked
            };

            if (accessType === 'site' && !data.site_id) {
                _showMessage('사업장을 선택해주세요.', 'error');
                return false;
            }
            if (accessType === 'group' && !data.group_id) {
                _showMessage('그룹을 선택해주세요.', 'error');
                return false;
            }

            let success;
            if (isEdit) {
                success = await _updateAccess(access.id, data);
            } else {
                success = await _addAccess(data);
            }

            if (success) {
                await _fetchUserAccess(_selectedUserId);
                _renderUserDetail();
            }
            return success;
        });

        // 권한 유형에 따라 필드 표시/숨김
        const typeSelect = modal.querySelector('#modal-access-type');
        const groupWrapper = modal.querySelector('#modal-group-wrapper');
        const siteWrapper = modal.querySelector('#modal-site-wrapper');

        function updateFieldVisibility() {
            const type = typeSelect.value;
            groupWrapper.style.display = type === 'group' ? 'block' : 'none';
            siteWrapper.style.display = type === 'site' ? 'block' : 'none';
        }

        typeSelect.onchange = updateFieldVisibility;
        updateFieldVisibility();
    }

    // 일괄 권한 추가 모달
    function _showBulkAccessModal() {
        const groupOptions = _groups.map(g =>
            `<option value="${g.id}">${g.group_name}</option>`
        ).join('');

        const roleOptions = _roles.map(r =>
            `<option value="${r.code}">${r.name}</option>`
        ).join('');

        const content = `
            <div class="upm-form-group">
                <label>권한을 부여할 사용자 선택</label>
                <div class="upm-user-checklist" style="max-height: 200px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px;">
                    ${_users.map(u => `
                        <label class="upm-checkbox-item">
                            <input type="checkbox" name="bulk-users" value="${u.id}">
                            <span>${u.username} (${u.name || '-'})</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="upm-form-group">
                <label>그룹</label>
                <select id="modal-bulk-group">
                    ${groupOptions}
                </select>
            </div>
            <div class="upm-form-group">
                <label>역할</label>
                <select id="modal-bulk-role">
                    ${roleOptions}
                </select>
            </div>
        `;

        _showModal('일괄 권한 부여', content, async () => {
            const checkedUsers = Array.from(document.querySelectorAll('input[name="bulk-users"]:checked'))
                .map(cb => parseInt(cb.value));
            const groupId = parseInt(document.getElementById('modal-bulk-group').value);
            const role = document.getElementById('modal-bulk-role').value;

            if (checkedUsers.length === 0) {
                _showMessage('사용자를 선택해주세요.', 'error');
                return false;
            }

            let successCount = 0;
            for (const userId of checkedUsers) {
                const success = await _addAccess({
                    user_id: userId,
                    group_id: groupId,
                    site_id: null,
                    role: role,
                    is_default: false
                });
                if (success) successCount++;
            }

            _showMessage(`${successCount}명의 사용자에게 권한이 부여되었습니다.`, 'success');

            if (_selectedUserId) {
                await _fetchUserAccess(_selectedUserId);
                _renderUserDetail();
            }

            return true;
        });
    }

    // 렌더링
    function _render() {
        if (!_container) return;

        _container.innerHTML = `
            <div class="upm-wrapper">
                <div class="upm-loading" style="display: none;">
                    <div class="upm-spinner"></div>
                    <span>로딩 중...</span>
                </div>

                <div class="upm-header">
                    <h2>사용자 권한 관리</h2>
                    <div class="upm-header-actions">
                        <button class="upm-btn upm-btn-primary" id="upm-bulk-add">
                            일괄 권한 부여
                        </button>
                        <button class="upm-btn upm-btn-secondary" id="upm-refresh">
                            새로고침
                        </button>
                    </div>
                </div>

                <div class="upm-content">
                    <div class="upm-user-list">
                        <div class="upm-panel-header">
                            <h3>사용자 목록</h3>
                            <input type="text" class="upm-search" id="upm-user-search" placeholder="사용자 검색...">
                        </div>
                        <div class="upm-user-items" id="upm-user-items">
                            ${_renderUserList()}
                        </div>
                    </div>

                    <div class="upm-user-detail" id="upm-user-detail">
                        <div class="upm-empty-detail">
                            <p>왼쪽에서 사용자를 선택하세요</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        _bindEvents();
    }

    function _renderUserList() {
        if (!_users || _users.length === 0) {
            return '<div class="upm-empty">등록된 사용자가 없습니다.</div>';
        }

        return _users.map(user => {
            const isSelected = user.id === _selectedUserId;
            return `
                <div class="upm-user-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
                    <div class="upm-user-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
                    <div class="upm-user-info">
                        <div class="upm-user-name">${user.username}</div>
                        <div class="upm-user-role">${user.name || '-'} | ${user.role || 'user'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function _renderUserDetail() {
        const detailContainer = document.getElementById('upm-user-detail');
        if (!detailContainer) return;

        if (!_selectedUserId) {
            detailContainer.innerHTML = `
                <div class="upm-empty-detail">
                    <p>왼쪽에서 사용자를 선택하세요</p>
                </div>
            `;
            return;
        }

        const user = _users.find(u => u.id === _selectedUserId);
        if (!user) return;

        detailContainer.innerHTML = `
            <div class="upm-detail-header">
                <div class="upm-detail-user">
                    <div class="upm-user-avatar large">${(user.name || user.username || '?')[0].toUpperCase()}</div>
                    <div>
                        <h3>${user.username}</h3>
                        <p>${user.name || '-'} | 기본 역할: ${user.role || 'user'}</p>
                    </div>
                </div>
                <button class="upm-btn upm-btn-primary" id="upm-add-access">
                    + 권한 추가
                </button>
            </div>

            <div class="upm-access-list">
                <h4>할당된 권한</h4>
                ${_renderAccessList()}
            </div>

            <div class="upm-role-legend">
                <h4>역할 설명</h4>
                <div class="upm-role-grid">
                    ${_roles.map(r => `
                        <div class="upm-role-item">
                            <span class="upm-role-badge level-${r.level}">${r.name}</span>
                            <span class="upm-role-desc">Level ${r.level}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // 이벤트 바인딩
        detailContainer.querySelector('#upm-add-access')?.addEventListener('click', () => {
            _showAccessModal();
        });

        detailContainer.querySelectorAll('.upm-access-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const accessId = parseInt(btn.dataset.accessId);
                const access = _accessList.find(a => a.id === accessId);
                if (access) _showAccessModal(access);
            });
        });

        detailContainer.querySelectorAll('.upm-access-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const accessId = parseInt(btn.dataset.accessId);
                if (await _deleteAccess(accessId)) {
                    await _fetchUserAccess(_selectedUserId);
                    _renderUserDetail();
                }
            });
        });
    }

    function _renderAccessList() {
        if (!_accessList || _accessList.length === 0) {
            return '<div class="upm-empty-access">할당된 권한이 없습니다.</div>';
        }

        return `
            <table class="upm-access-table">
                <thead>
                    <tr>
                        <th>유형</th>
                        <th>대상</th>
                        <th>역할</th>
                        <th>기본</th>
                        <th>작업</th>
                    </tr>
                </thead>
                <tbody>
                    ${_accessList.map(access => {
                        const targetType = access.site_id ? '사업장' : (access.group_id ? '그룹' : '-');
                        const targetName = access.site_name || access.group_name || '-';
                        const roleInfo = _roles.find(r => r.code === access.role);
                        const roleName = roleInfo?.name || access.role;
                        const roleLevel = roleInfo?.level ?? 5;

                        return `
                            <tr>
                                <td><span class="upm-type-badge ${access.site_id ? 'site' : 'group'}">${targetType}</span></td>
                                <td>${targetName}</td>
                                <td><span class="upm-role-badge level-${roleLevel}">${roleName}</span></td>
                                <td>${access.is_default ? '⭐' : '-'}</td>
                                <td>
                                    <button class="upm-btn-icon upm-access-edit" data-access-id="${access.id}" title="수정">✏️</button>
                                    <button class="upm-btn-icon upm-access-delete" data-access-id="${access.id}" title="삭제">🗑️</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    function _bindEvents() {
        if (!_container) return;

        // 새로고침
        _container.querySelector('#upm-refresh')?.addEventListener('click', () => {
            _selectedUserId = null;
            _accessList = [];
            _fetchData();
        });

        // 일괄 권한 부여
        _container.querySelector('#upm-bulk-add')?.addEventListener('click', () => {
            _showBulkAccessModal();
        });

        // 사용자 검색
        const searchInput = _container.querySelector('#upm-user-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const items = _container.querySelectorAll('.upm-user-item');
                items.forEach(item => {
                    const name = item.querySelector('.upm-user-name').textContent.toLowerCase();
                    const role = item.querySelector('.upm-user-role').textContent.toLowerCase();
                    const match = name.includes(query) || role.includes(query);
                    item.style.display = match ? 'flex' : 'none';
                });
            });
        }

        // 사용자 선택
        _container.querySelectorAll('.upm-user-item').forEach(item => {
            item.addEventListener('click', () => {
                const userId = parseInt(item.dataset.userId);
                // 선택 상태 업데이트
                _container.querySelectorAll('.upm-user-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                _selectUser(userId);
            });
        });
    }

    // Public API
    return {
        init(containerId) {
            console.log('UserPermissionManager 초기화');

            if (typeof containerId === 'string') {
                _container = document.getElementById(containerId);
            } else {
                _container = containerId;
            }

            if (!_container) {
                console.error('UserPermissionManager: Container not found');
                return false;
            }

            _fetchData();
            return true;
        },

        refresh() {
            _selectedUserId = null;
            _accessList = [];
            _fetchData();
        },

        getUsers() {
            return _users;
        },

        getRoles() {
            return _roles;
        }
    };
})();

// 전역 접근
window.UserPermissionManager = UserPermissionManager;
