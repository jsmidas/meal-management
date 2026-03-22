/**
 * 완전한 사용자 관리 모듈 (user_management.html에서 검증된 버전)
 * admin_dashboard.html에 통합하기 위한 버전
 * 권한 관리 통합 버전
 */

(function() {
    'use strict';

    const API_BASE_URL = window.CONFIG?.API?.BASE_URL || '';
    let currentPage = 1;
    let currentSort = { field: 'created_at', order: 'desc' };
    let selectedUsers = new Set();

    // 권한 관리 관련 상태
    let _sites = [];
    let _groups = [];
    let _roles = [];
    let _currentUserAccess = [];
    let _editingUserId = null;

    window.UsersManagementFull = {
        // 모듈 초기화
        async init() {
            console.log('👥 Full Users Management Module 초기화');
            await this.loadUserStats();
            await this.loadUsers();
            this.setupEventListeners();
            return this;
        },

        // 이벤트 리스너 설정
        setupEventListeners() {
            // 검색 입력
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.loadUsers(1);
                    }
                });
            }

            // 역할 필터
            const roleFilter = document.getElementById('roleFilter');
            if (roleFilter) {
                roleFilter.addEventListener('change', () => {
                    this.loadUsers(1);
                });
            }

            // 전체 선택 체크박스
            const selectAll = document.getElementById('selectAll');
            if (selectAll) {
                selectAll.addEventListener('change', (e) => {
                    const checkboxes = document.querySelectorAll('.user-checkbox');
                    checkboxes.forEach(cb => {
                        cb.checked = e.target.checked;
                        const userId = parseInt(cb.dataset.userId);
                        if (e.target.checked) {
                            selectedUsers.add(userId);
                        } else {
                            selectedUsers.delete(userId);
                        }
                    });
                    this.updateBulkActions();
                });
            }
        },

        // 사용자 통계 로드
        async loadUserStats() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/users/stats`);
                const data = await response.json();

                if (data.success || data.total !== undefined) {
                    // ID 수정: totalUsersCount, activeUsersCount
                    const totalEl = document.getElementById('totalUsersCount');
                    const activeEl = document.getElementById('activeUsersCount');
                    const inactiveEl = document.getElementById('inactiveUsers');
                    const adminEl = document.getElementById('adminUsers');

                    if (totalEl) totalEl.textContent = data.total || data.stats?.total_users || '0';
                    if (activeEl) activeEl.textContent = data.active || data.stats?.active_users || '0';
                    if (inactiveEl) inactiveEl.textContent = data.inactive || data.stats?.inactive_users || '0';
                    if (adminEl) adminEl.textContent = data.admins || data.stats?.admin_users || '0';
                }
            } catch (error) {
                console.error('통계 로드 실패:', error);
            }
        },

        // 사용자 목록 로드
        async loadUsers(page = 1) {
            try {
                const search = document.getElementById('searchInput')?.value || '';
                const role = document.getElementById('roleFilter')?.value || '';

                const url = new URL(`${API_BASE_URL}/api/users`);
                url.searchParams.append('page', page);
                url.searchParams.append('limit', 10);
                if (search) url.searchParams.append('search', search);
                if (role) url.searchParams.append('role', role);

                const response = await fetch(url);
                const data = await response.json();

                if (data.success) {
                    this.renderUsersTable(data.users);
                    this.renderPagination(data.pagination);
                    currentPage = page;
                } else {
                    this.showAlert('사용자 목록을 불러오는데 실패했습니다: ' + data.error, 'error');
                }
            } catch (error) {
                console.error('사용자 목록 로드 실패:', error);
                this.showAlert('사용자 목록을 불러오는데 실패했습니다', 'error');
            }
        },

        // 사용자 테이블 렌더링
        renderUsersTable(users) {
            const tbody = document.getElementById('usersTableBody');
            if (!tbody) return;

            if (users.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="empty-state">
                            <h3>검색 결과가 없습니다</h3>
                            <p>다른 검색 조건을 시도해보세요.</p>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = users.map(user => `
                <tr>
                    <td><input type="checkbox" class="user-checkbox" data-user-id="${user.id}"></td>
                    <td>
                        <div class="user-info">
                            <strong>${user.name}</strong>
                            <br>
                            <small>${user.username}</small>
                        </div>
                    </td>
                    <td>${user.contact || '-'}</td>
                    <td>${user.department || '-'}</td>
                    <td><span class="role-badge ${this.getRoleBadgeClass(user.role)}">${this.getRoleText(user.role)}</span></td>
                    <td>${this.formatDate(user.createdAt)}</td>
                    <td>
                        <span class="status-badge ${user.isActive ? 'active' : 'inactive'}">
                            ${user.isActive ? '활성' : '비활성'}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon" onclick="UsersManagementFull.editUser(${user.id})" title="수정">
                                ✏️
                            </button>
                            <button class="btn-icon" onclick="UsersManagementFull.toggleUserStatus(${user.id}, ${!user.isActive})" title="상태 변경">
                                ${user.isActive ? '⏸️' : '▶️'}
                            </button>
                            <button class="btn-icon btn-danger" onclick="UsersManagementFull.deleteUser(${user.id})" title="삭제">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

            // 체크박스 이벤트 리스너 추가
            document.querySelectorAll('.user-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const userId = parseInt(e.target.dataset.userId);
                    if (e.target.checked) {
                        selectedUsers.add(userId);
                    } else {
                        selectedUsers.delete(userId);
                    }
                    this.updateBulkActions();
                });
            });
        },

        // 페이지네이션 렌더링
        renderPagination(pagination) {
            const container = document.getElementById('pagination');
            if (!container) return;

            // 스타일 추가 (한 번만)
            if (!document.getElementById('pagination-styles')) {
                const style = document.createElement('style');
                style.id = 'pagination-styles';
                style.textContent = `
                    .pagination-wrapper {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        gap: 8px;
                        padding: 20px 0;
                        flex-wrap: wrap;
                    }
                    .pagination-wrapper .page-info {
                        font-size: 13px;
                        color: #6b7280;
                        margin-right: 12px;
                    }
                    .pagination-wrapper .page-btn {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 36px;
                        height: 36px;
                        padding: 0 12px;
                        border: 1px solid #e5e7eb;
                        background: white;
                        color: #374151;
                        font-size: 14px;
                        font-weight: 500;
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                    }
                    .pagination-wrapper .page-btn:hover:not(:disabled):not(.active) {
                        background: #f3f4f6;
                        border-color: #d1d5db;
                    }
                    .pagination-wrapper .page-btn.active {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border-color: transparent;
                        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
                    }
                    .pagination-wrapper .page-btn:disabled {
                        opacity: 0.4;
                        cursor: not-allowed;
                    }
                    .pagination-wrapper .page-btn.nav-btn {
                        padding: 0 14px;
                        font-weight: 600;
                    }
                    .pagination-wrapper .page-dots {
                        color: #9ca3af;
                        padding: 0 4px;
                    }
                `;
                document.head.appendChild(style);
            }

            const { current_page, total_pages, has_prev, has_next, total } = pagination;

            let html = '<div class="pagination-wrapper">';

            // 페이지 정보
            if (total) {
                html += `<span class="page-info">총 ${total}명</span>`;
            }

            // 처음으로 버튼
            html += `<button class="page-btn nav-btn" ${!has_prev ? 'disabled' : ''} onclick="UsersManagementFull.loadUsers(1)" title="처음">«</button>`;

            // 이전 페이지 버튼
            html += `<button class="page-btn nav-btn" ${!has_prev ? 'disabled' : ''} onclick="UsersManagementFull.loadUsers(${current_page - 1})" title="이전">‹</button>`;

            // 페이지 번호들
            const startPage = Math.max(1, current_page - 2);
            const endPage = Math.min(total_pages, current_page + 2);

            // 첫 페이지와 간격이 있으면 ... 표시
            if (startPage > 1) {
                html += `<button class="page-btn" onclick="UsersManagementFull.loadUsers(1)">1</button>`;
                if (startPage > 2) {
                    html += `<span class="page-dots">...</span>`;
                }
            }

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="page-btn ${i === current_page ? 'active' : ''}" onclick="UsersManagementFull.loadUsers(${i})">${i}</button>`;
            }

            // 마지막 페이지와 간격이 있으면 ... 표시
            if (endPage < total_pages) {
                if (endPage < total_pages - 1) {
                    html += `<span class="page-dots">...</span>`;
                }
                html += `<button class="page-btn" onclick="UsersManagementFull.loadUsers(${total_pages})">${total_pages}</button>`;
            }

            // 다음 페이지 버튼
            html += `<button class="page-btn nav-btn" ${!has_next ? 'disabled' : ''} onclick="UsersManagementFull.loadUsers(${current_page + 1})" title="다음">›</button>`;

            // 마지막으로 버튼
            html += `<button class="page-btn nav-btn" ${!has_next ? 'disabled' : ''} onclick="UsersManagementFull.loadUsers(${total_pages})" title="마지막">»</button>`;

            html += '</div>';
            container.innerHTML = html;
        },

        // 권한 텍스트 변환
        getRoleText(role) {
            const roleMap = {
                'admin': '관리자',
                'nutritionist': '영양사',
                'operator': '운영자',
                'viewer': '조회자'
            };
            return roleMap[role] || role;
        },

        // 권한 배지 클래스
        getRoleBadgeClass(role) {
            const classMap = {
                'admin': 'admin',
                'nutritionist': 'nutritionist',
                'operator': 'operator',
                'viewer': 'viewer'
            };
            return classMap[role] || 'default';
        },

        // 날짜 포맷
        formatDate(dateString) {
            if (!dateString) return '-';
            const date = new Date(dateString);
            return date.toLocaleDateString('ko-KR');
        },

        // 알림 표시
        showAlert(message, type = 'info') {
            const alertDiv = document.createElement('div');
            alertDiv.className = `alert alert-${type}`;
            alertDiv.textContent = message;

            const container = document.querySelector('.content-container') || document.body;
            container.insertBefore(alertDiv, container.firstChild);

            setTimeout(() => alertDiv.remove(), 5000);
        },

        // 벌크 액션 업데이트
        updateBulkActions() {
            const bulkActions = document.getElementById('bulkActions');
            if (bulkActions) {
                bulkActions.style.display = selectedUsers.size > 0 ? 'flex' : 'none';
                const selectedCount = document.getElementById('selectedCount');
                if (selectedCount) {
                    selectedCount.textContent = selectedUsers.size;
                }
            }
        },

        // 사용자 편집 (권한 관리 통합)
        async editUser(userId) {
            console.log('사용자 편집:', userId);
            _editingUserId = userId;

            try {
                // 사용자 정보, 권한 데이터 병렬 로드
                const [userRes, sitesRes, groupsRes, rolesRes, accessRes] = await Promise.all([
                    fetch(`${API_BASE_URL}/api/users/${userId}`).then(r => r.json()),
                    fetch(`${API_BASE_URL}/api/admin/sites`).then(r => r.json()),
                    fetch(`${API_BASE_URL}/api/admin/groups`).then(r => r.json()),
                    fetch(`${API_BASE_URL}/api/admin/roles`).then(r => r.json()),
                    fetch(`${API_BASE_URL}/api/admin/user-site-access?user_id=${userId}`).then(r => r.json())
                ]);

                const user = userRes.user || userRes;
                _sites = sitesRes.success ? sitesRes.data : [];
                _groups = groupsRes.success ? groupsRes.data : [];
                _roles = rolesRes.success ? rolesRes.data : [];
                _currentUserAccess = accessRes.success ? (accessRes.data || []) : [];

                this.showUserEditModal(user);
            } catch (error) {
                console.error('사용자 정보 로드 실패:', error);
                this.showAlert('사용자 정보를 불러오는데 실패했습니다.', 'error');
            }
        },

        // 사용자 편집 모달 표시
        showUserEditModal(user) {
            // 기존 모달 제거
            const existingModal = document.getElementById('userEditModal');
            if (existingModal) existingModal.remove();

            const modalHtml = `
                <div id="userEditModal" class="modal" style="display: flex;">
                    <div class="modal-content" style="width: 800px; max-width: 95%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
                        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; border-bottom: 1px solid #e2e8f0;">
                            <h3 style="margin: 0;">사용자 편집 - ${user.username}</h3>
                            <button class="close" onclick="UsersManagementFull.closeEditModal()" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
                        </div>

                        <!-- 탭 헤더 -->
                        <div class="user-edit-tabs" style="display: flex; border-bottom: 2px solid #e2e8f0;">
                            <button class="tab-btn active" data-tab="info" onclick="UsersManagementFull.switchTab('info')" style="flex: 1; padding: 12px; border: none; background: #f8fafc; cursor: pointer; font-weight: 600;">
                                📋 기본 정보
                            </button>
                            <button class="tab-btn" data-tab="permissions" onclick="UsersManagementFull.switchTab('permissions')" style="flex: 1; padding: 12px; border: none; background: #fff; cursor: pointer;">
                                🔐 권한 관리
                            </button>
                        </div>

                        <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px;">
                            <!-- 기본 정보 탭 -->
                            <div id="tab-info" class="tab-content" style="display: block;">
                                <form id="userEditForm">
                                    <input type="hidden" id="editUserId" value="${user.id}">
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                        <div class="form-group">
                                            <label for="editUsername">아이디</label>
                                            <input type="text" id="editUsername" value="${user.username || ''}" readonly
                                                   style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb;">
                                        </div>
                                        <div class="form-group">
                                            <label for="editName">이름</label>
                                            <input type="text" id="editName" value="${user.name || ''}"
                                                   style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                        </div>
                                        <div class="form-group">
                                            <label for="editContact">연락처</label>
                                            <input type="text" id="editContact" value="${user.contact || ''}"
                                                   style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                        </div>
                                        <div class="form-group">
                                            <label for="editDepartment">부서</label>
                                            <input type="text" id="editDepartment" value="${user.department || ''}"
                                                   style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                        </div>
                                        <div class="form-group">
                                            <label for="editRole">기본 역할</label>
                                            <select id="editRole" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>관리자</option>
                                                <option value="nutritionist" ${user.role === 'nutritionist' ? 'selected' : ''}>영양사</option>
                                                <option value="operator" ${user.role === 'operator' ? 'selected' : ''}>운영자</option>
                                                <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>조회자</option>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label for="editStatus">상태</label>
                                            <select id="editStatus" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                                <option value="true" ${user.isActive || user.is_active ? 'selected' : ''}>활성</option>
                                                <option value="false" ${!(user.isActive || user.is_active) ? 'selected' : ''}>비활성</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div style="margin-top: 18px; padding: 14px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;">
                                        <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #0369a1;">개별 기능 권한</h4>
                                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                                            <input type="checkbox" id="editBlogAccess"
                                                   ${(user.permissions?.blog_access || user.role === 'admin') ? 'checked' : ''}
                                                   ${user.role === 'admin' ? 'disabled' : ''}
                                                   style="width: 18px; height: 18px; cursor: pointer;">
                                            <span style="font-size: 14px;">블로그/SNS 관리 접근 허용</span>
                                            ${user.role === 'admin' ? '<span style="font-size: 11px; color: #6b7280; margin-left: 4px;">(관리자는 항상 허용)</span>' : ''}
                                        </label>
                                    </div>
                                    <div class="form-group" style="margin-top: 15px;">
                                        <label for="editPassword">새 비밀번호 (변경 시에만 입력)</label>
                                        <input type="password" id="editPassword" placeholder="비밀번호 변경 시에만 입력"
                                               style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                    </div>
                                </form>
                            </div>

                            <!-- 권한 관리 탭 -->
                            <div id="tab-permissions" class="tab-content" style="display: none;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                    <h4 style="margin: 0;">사업장/그룹 접근 권한</h4>
                                    <button onclick="UsersManagementFull.showAddAccessModal()" class="btn btn-primary"
                                            style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                        + 권한 추가
                                    </button>
                                </div>
                                <div id="userAccessList" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                                    ${this.renderAccessList()}
                                </div>
                                <div style="margin-top: 15px; padding: 12px; background: #f8fafc; border-radius: 8px;">
                                    <h5 style="margin: 0 0 10px 0;">역할 설명</h5>
                                    <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                                        ${_roles.map(r => `
                                            <span style="padding: 4px 10px; background: ${this.getRoleBgColor(r.level)}; color: #333; border-radius: 12px; font-size: 12px;">
                                                ${r.name} (Level ${r.level})
                                            </span>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; padding: 15px 20px; border-top: 1px solid #e2e8f0;">
                            <button type="button" class="btn btn-secondary" onclick="UsersManagementFull.closeEditModal()"
                                    style="padding: 10px 20px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">
                                닫기
                            </button>
                            <button type="button" class="btn btn-primary" onclick="UsersManagementFull.saveUserInfo()"
                                    style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                저장
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // 모달 배경 클릭 시 닫기
            document.getElementById('userEditModal').addEventListener('click', (e) => {
                if (e.target.id === 'userEditModal') {
                    this.closeEditModal();
                }
            });
        },

        // 역할별 배경색
        getRoleBgColor(level) {
            const colors = {
                1: '#fee2e2',  // admin - red
                2: '#fef3c7',  // manager - yellow
                3: '#d1fae5',  // operator - green
                4: '#dbeafe',  // nutritionist - blue
                5: '#f3e8ff'   // viewer - purple
            };
            return colors[level] || '#f3f4f6';
        },

        // 탭 전환
        switchTab(tabId) {
            // 모든 탭 버튼 비활성화
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.style.background = '#fff';
            });
            // 클릭된 탭 활성화
            document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
            document.querySelector(`.tab-btn[data-tab="${tabId}"]`).style.background = '#f8fafc';

            // 모든 탭 컨텐츠 숨기기
            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
            });
            // 선택된 탭 컨텐츠 표시
            document.getElementById(`tab-${tabId}`).style.display = 'block';
        },

        // 권한 목록 렌더링
        renderAccessList() {
            if (!_currentUserAccess || _currentUserAccess.length === 0) {
                return '<div style="padding: 30px; text-align: center; color: #6b7280;">할당된 권한이 없습니다.</div>';
            }

            let html = `
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8fafc;">
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0;">유형</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0;">대상</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0;">역할</th>
                            <th style="padding: 12px; text-align: center; border-bottom: 1px solid #e2e8f0;">기본</th>
                            <th style="padding: 12px; text-align: center; border-bottom: 1px solid #e2e8f0;">작업</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            _currentUserAccess.forEach(access => {
                const targetType = access.site_id ? '사업장' : (access.group_id ? '그룹' : '-');
                const targetName = access.site_name || access.group_name || '-';
                const roleInfo = _roles.find(r => r.code === access.role);
                const roleName = roleInfo?.name || access.role;

                html += `
                    <tr>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
                            <span style="padding: 4px 8px; background: ${access.site_id ? '#dbeafe' : '#d1fae5'}; border-radius: 4px; font-size: 12px;">
                                ${targetType}
                            </span>
                        </td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${targetName}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${roleName}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${access.is_default ? '⭐' : '-'}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">
                            <button onclick="UsersManagementFull.editAccess(${access.id})" style="background: none; border: none; cursor: pointer; font-size: 16px;" title="수정">✏️</button>
                            <button onclick="UsersManagementFull.deleteAccess(${access.id})" style="background: none; border: none; cursor: pointer; font-size: 16px;" title="삭제">🗑️</button>
                        </td>
                    </tr>
                `;
            });

            html += '</tbody></table>';
            return html;
        },

        // 권한 추가 모달
        showAddAccessModal(access = null) {
            const isEdit = !!access;

            const groupOptions = _groups.map(g =>
                `<option value="${g.id}" ${access?.group_id === g.id ? 'selected' : ''}>${g.group_name}</option>`
            ).join('');

            const siteOptions = _sites.map(s =>
                `<option value="${s.id}" ${access?.site_id === s.id ? 'selected' : ''}>${s.site_name}</option>`
            ).join('');

            const roleOptions = _roles.map(r =>
                `<option value="${r.code}" ${access?.role === r.code ? 'selected' : ''}>${r.name} (Level ${r.level})</option>`
            ).join('');

            // 기존 모달 제거
            const existingModal = document.getElementById('accessModal');
            if (existingModal) existingModal.remove();

            const modalHtml = `
                <div id="accessModal" class="modal" style="display: flex; z-index: 1100;">
                    <div class="modal-content" style="width: 450px; max-width: 90%;">
                        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; border-bottom: 1px solid #e2e8f0;">
                            <h3 style="margin: 0;">${isEdit ? '권한 수정' : '권한 추가'}</h3>
                            <button onclick="UsersManagementFull.closeAccessModal()" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
                        </div>
                        <div class="modal-body" style="padding: 20px;">
                            <input type="hidden" id="accessId" value="${access?.id || ''}">
                            <div class="form-group" style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">권한 유형</label>
                                <select id="accessType" onchange="UsersManagementFull.toggleAccessType()" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                    <option value="site" ${!access?.group_id || access?.site_id ? 'selected' : ''}>특정 사업장</option>
                                    <option value="group" ${access?.group_id && !access?.site_id ? 'selected' : ''}>그룹 전체</option>
                                </select>
                            </div>
                            <div id="groupField" class="form-group" style="margin-bottom: 15px; ${(!access?.group_id || access?.site_id) ? 'display: none;' : ''}">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">그룹</label>
                                <select id="accessGroup" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                    <option value="">선택하세요</option>
                                    ${groupOptions}
                                </select>
                            </div>
                            <div id="siteField" class="form-group" style="margin-bottom: 15px; ${access?.group_id && !access?.site_id ? 'display: none;' : ''}">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">사업장</label>
                                <select id="accessSite" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                    <option value="">선택하세요</option>
                                    ${siteOptions}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">역할</label>
                                <select id="accessRole" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
                                    ${roleOptions}
                                </select>
                            </div>
                            <div class="form-group">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" id="accessDefault" ${access?.is_default ? 'checked' : ''}>
                                    기본 사업장으로 설정
                                </label>
                            </div>
                        </div>
                        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; padding: 15px 20px; border-top: 1px solid #e2e8f0;">
                            <button onclick="UsersManagementFull.closeAccessModal()" style="padding: 10px 20px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">취소</button>
                            <button onclick="UsersManagementFull.saveAccess()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">저장</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
        },

        // 권한 유형 토글
        toggleAccessType() {
            const type = document.getElementById('accessType').value;
            document.getElementById('groupField').style.display = type === 'group' ? 'block' : 'none';
            document.getElementById('siteField').style.display = type === 'site' ? 'block' : 'none';
        },

        // 권한 편집
        async editAccess(accessId) {
            const access = _currentUserAccess.find(a => a.id === accessId);
            if (access) {
                this.showAddAccessModal(access);
            }
        },

        // 권한 저장
        async saveAccess() {
            const accessId = document.getElementById('accessId').value;
            const accessType = document.getElementById('accessType').value;
            const isEdit = !!accessId;

            const data = {
                user_id: _editingUserId,
                group_id: accessType === 'group' ? parseInt(document.getElementById('accessGroup').value) || null : null,
                site_id: accessType === 'site' ? parseInt(document.getElementById('accessSite').value) || null : null,
                role: document.getElementById('accessRole').value,
                is_default: document.getElementById('accessDefault').checked
            };

            if (accessType === 'site' && !data.site_id) {
                this.showAlert('사업장을 선택해주세요.', 'error');
                return;
            }
            if (accessType === 'group' && !data.group_id) {
                this.showAlert('그룹을 선택해주세요.', 'error');
                return;
            }

            try {
                let response;
                if (isEdit) {
                    response = await fetch(`${API_BASE_URL}/api/admin/user-site-access/${accessId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                } else {
                    response = await fetch(`${API_BASE_URL}/api/admin/user-site-access`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                }

                const result = await response.json();
                if (result.success) {
                    this.showAlert(isEdit ? '권한이 수정되었습니다.' : '권한이 추가되었습니다.', 'success');
                    this.closeAccessModal();
                    await this.refreshAccessList();
                } else {
                    this.showAlert(result.message || '권한 저장 실패', 'error');
                }
            } catch (error) {
                console.error('권한 저장 오류:', error);
                this.showAlert('권한 저장 중 오류가 발생했습니다.', 'error');
            }
        },

        // 권한 삭제
        async deleteAccess(accessId) {
            if (!confirm('이 권한을 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/user-site-access/${accessId}`, {
                    method: 'DELETE'
                });

                const result = await response.json();
                if (result.success) {
                    this.showAlert('권한이 삭제되었습니다.', 'success');
                    await this.refreshAccessList();
                } else {
                    this.showAlert(result.message || '권한 삭제 실패', 'error');
                }
            } catch (error) {
                console.error('권한 삭제 오류:', error);
                this.showAlert('권한 삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 권한 목록 새로고침
        async refreshAccessList() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/admin/user-site-access?user_id=${_editingUserId}`);
                const result = await response.json();
                if (result.success) {
                    _currentUserAccess = result.data || [];
                    document.getElementById('userAccessList').innerHTML = this.renderAccessList();
                }
            } catch (error) {
                console.error('권한 목록 새로고침 실패:', error);
            }
        },

        // 사용자 정보 저장
        async saveUserInfo() {
            const userId = document.getElementById('editUserId').value;
            const blogAccessEl = document.getElementById('editBlogAccess');
            const data = {
                name: document.getElementById('editName').value,
                contact: document.getElementById('editContact').value,
                department: document.getElementById('editDepartment').value,
                role: document.getElementById('editRole').value,
                isActive: document.getElementById('editStatus').value === 'true',
                permissions: {
                    blog_access: blogAccessEl ? blogAccessEl.checked : false
                }
            };

            const password = document.getElementById('editPassword').value;
            if (password) {
                data.password = password;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                if (result.success !== false) {
                    this.showAlert('사용자 정보가 저장되었습니다.', 'success');
                    this.closeEditModal();
                    this.loadUsers(currentPage);
                } else {
                    this.showAlert(`저장 실패: ${result.error || result.message}`, 'error');
                }
            } catch (error) {
                console.error('사용자 정보 저장 오류:', error);
                this.showAlert('저장 중 오류가 발생했습니다.', 'error');
            }
        },

        // 편집 모달 닫기
        closeEditModal() {
            const modal = document.getElementById('userEditModal');
            if (modal) modal.remove();
            _editingUserId = null;
            _currentUserAccess = [];
        },

        // 권한 모달 닫기
        closeAccessModal() {
            const modal = document.getElementById('accessModal');
            if (modal) modal.remove();
        },

        // 사용자 상태 토글
        async toggleUserStatus(userId, newStatus) {
            const statusText = newStatus ? '활성화' : '비활성화';
            if (!confirm(`사용자를 ${statusText}하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/users/${userId}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isActive: newStatus })
                });

                const result = await response.json();
                if (result.success) {
                    this.showAlert(`사용자가 ${statusText}되었습니다.`, 'success');
                    this.loadUsers(currentPage);
                } else {
                    this.showAlert(`상태 변경 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('상태 변경 오류:', error);
                this.showAlert('상태 변경 중 오류가 발생했습니다.', 'error');
            }
        },

        // 사용자 삭제
        async deleteUser(userId) {
            if (!confirm('정말로 이 사용자를 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
                    method: 'DELETE'
                });

                const result = await response.json();
                if (result.success !== false) {
                    this.showAlert('사용자가 삭제되었습니다.', 'success');
                    this.loadUsers(currentPage);
                } else {
                    this.showAlert(`삭제 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('삭제 오류:', error);
                this.showAlert('삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 선택된 사용자 벌크 삭제
        async bulkDelete() {
            if (!confirm(`선택한 ${selectedUsers.size}명의 사용자를 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/users/bulk-delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userIds: Array.from(selectedUsers) })
                });

                const result = await response.json();
                if (result.success) {
                    this.showAlert(`${result.deleted}명의 사용자가 삭제되었습니다.`, 'success');
                    selectedUsers.clear();
                    this.updateBulkActions();
                    this.loadUsers(1);
                } else {
                    this.showAlert(`벌크 삭제 실패: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('벌크 삭제 오류:', error);
                this.showAlert('벌크 삭제 중 오류가 발생했습니다.', 'error');
            }
        },

        // 새 사용자 추가 모달 표시
        showAddUserModal() {
            console.log('새 사용자 추가 모달');
            // TODO: 사용자 추가 모달 구현
            this.showAlert('사용자 추가 기능 준비 중', 'info');
        }
    };

    console.log('👥 Full Users Management Module 정의 완료');

})();