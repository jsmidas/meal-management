/**
 * 사용자 관리 모듈 (개선 버전)
 * 권한 관리 가이드라인 기반 구현
 */

class EnhancedUserManagement {
    constructor() {
        this.API_BASE_URL = window.CONFIG?.API?.BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}';
        this.currentUserId = null;
        this.isEditMode = false;
        this.users = [];
        this.filteredUsers = [];
        this.businessLocations = [];
        this.siteGroups = [];  // 사업장 그룹 (본사, 영남 등)
        this.siteStructure = [];  // 전체 사업장 구조 트리
        this.consignmentGroupCode = 'Meal';  // 위탁사업장 그룹 코드
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.isSaving = false;  // 중복 저장 방지 플래그
    }

    // 권한 레벨 정의
    // 순서: 시스템 관리자 > 사업장 관리자 > 운영 담당자 > 영양사 > 조회 전용
    static PERMISSION_LEVELS = {
        SYSTEM_ADMIN: { role: 'admin', operator: true, label: '시스템 관리자', level: 1, color: '#dc3545' },
        SITE_ADMIN: { role: 'admin', operator: false, label: '사업장 관리자', level: 2, color: '#ffc107' },
        OPERATOR: { role: 'operator', semi_operator: true, label: '운영 담당자', level: 3, color: '#17a2b8' },
        NUTRITIONIST: { role: 'nutritionist', operator: false, label: '영양사', level: 4, color: '#28a745' },
        VIEWER: { role: 'viewer', operator: false, label: '조회 전용', level: 5, color: '#6c757d' }
    };

    // 권한별 기능 매트릭스 (레벨: 1=시스템관리자, 2=사업장관리자, 3=운영담당자, 4=영양사, 5=조회전용)
    static PERMISSION_MATRIX = {
        '사용자 관리': { 1: 'full', 2: 'limited', 3: 'none', 4: 'none', 5: 'none' },
        '사업장 관리': { 1: 'full', 2: 'limited', 3: 'view', 4: 'view', 5: 'view' },
        '협력업체 관리': { 1: 'full', 2: 'full', 3: 'full', 4: 'view', 5: 'view' },
        '식재료 관리': { 1: 'full', 2: 'full', 3: 'full', 4: 'full', 5: 'view' },
        '메뉴/레시피': { 1: 'full', 2: 'full', 3: 'view', 4: 'full', 5: 'view' },
        '식단 관리': { 1: 'full', 2: 'full', 3: 'view', 4: 'full', 5: 'view' },
        '발주 관리': { 1: 'full', 2: 'approve', 3: 'full', 4: 'view', 5: 'view' },
        '입고 관리': { 1: 'full', 2: 'full', 3: 'full', 4: 'view', 5: 'view' },
        '전처리 지시서': { 1: 'full', 2: 'full', 3: 'full', 4: 'full', 5: 'view' },
        '통계/보고서': { 1: 'full', 2: 'limited', 3: 'full', 4: 'full', 5: 'view' }
    };

    async init() {
        console.log('🚀 [Enhanced User Management] 초기화 시작');
        this.renderHTML();
        this.setupEventListeners();
        await this.loadSiteGroups();
        await this.loadUsers();
    }

    renderHTML() {
        const container = document.getElementById('users-content') || document.getElementById('content-area');
        if (!container) return;

        container.innerHTML = `
            <div class="enhanced-user-management">
                <!-- 헤더 -->
                <div class="page-header">
                    <h1><i class="fas fa-users"></i> 사용자 관리</h1>
                    <button class="btn btn-primary" onclick="enhancedUserMgmt.openUserModal()">
                        <i class="fas fa-plus"></i> 사용자 추가
                    </button>
                </div>

                <!-- 통계 카드 -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon bg-primary"><i class="fas fa-users"></i></div>
                        <div class="stat-content">
                            <h3 id="totalUsers">0</h3>
                            <p>전체 사용자</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon bg-success"><i class="fas fa-user-check"></i></div>
                        <div class="stat-content">
                            <h3 id="activeUsers">0</h3>
                            <p>활성 사용자</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon bg-danger"><i class="fas fa-user-shield"></i></div>
                        <div class="stat-content">
                            <h3 id="adminUsers">0</h3>
                            <p>관리자</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon bg-info"><i class="fas fa-user-nurse"></i></div>
                        <div class="stat-content">
                            <h3 id="nutritionistUsers">0</h3>
                            <p>영양사</p>
                        </div>
                    </div>
                </div>

                <!-- 개선된 검색 박스 -->
                <div class="search-filter-section">
                    <div class="enhanced-search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" id="userSearchInput" placeholder="이름, 아이디, 연락처, 부서로 검색..."
                               onkeyup="enhancedUserMgmt.searchUsers(this.value)">
                        <button class="clear-search" onclick="enhancedUserMgmt.clearSearch()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="filter-buttons">
                        <select id="roleFilter" onchange="enhancedUserMgmt.filterByRole(this.value)">
                            <option value="">모든 권한</option>
                            <option value="1">시스템 관리자</option>
                            <option value="2">사업장 관리자</option>
                            <option value="3">영양사</option>
                            <option value="4">운영 담당자</option>
                            <option value="5">조회 전용</option>
                        </select>

                        <select id="statusFilter" onchange="enhancedUserMgmt.filterByStatus(this.value)">
                            <option value="">모든 상태</option>
                            <option value="active">활성</option>
                            <option value="inactive">비활성</option>
                            <option value="locked">잠김</option>
                        </select>
                    </div>
                </div>

                <!-- 권한별 기능 매트릭스 표 -->
                <div class="permission-matrix-section" style="display: none;">
                    <h3>권한별 기능 매트릭스</h3>
                    <table class="permission-matrix-table">
                        <thead>
                            <tr>
                                <th>기능 모듈</th>
                                <th>시스템관리자</th>
                                <th>사업장관리자</th>
                                <th>영양사</th>
                                <th>운영담당자</th>
                                <th>조회전용</th>
                            </tr>
                        </thead>
                        <tbody id="permissionMatrixBody"></tbody>
                    </table>
                </div>

                <!-- 사용자 테이블 -->
                <div class="users-table-container">
                    <table class="enhanced-users-table">
                        <thead>
                            <tr>
                                <th width="30"><input type="checkbox" id="selectAll"></th>
                                <th>이름 / 아이디</th>
                                <th>권한</th>
                                <th>관리 사업장</th>
                                <th>상태</th>
                                <th>최근 로그인</th>
                                <th>작업</th>
                            </tr>
                        </thead>
                        <tbody id="usersTableBody"></tbody>
                    </table>
                </div>

                <!-- 페이지네이션 -->
                <div class="pagination-container" id="pagination"></div>
            </div>
        `;

        this.addStyles();
    }

    addStyles() {
        if (document.getElementById('enhanced-user-styles')) return;

        const style = document.createElement('style');
        style.id = 'enhanced-user-styles';
        style.textContent = `
            .enhanced-user-management {
                padding: 20px;
                max-width: 1400px;
                margin: 0 auto;
            }

            .page-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
                padding-bottom: 15px;
                border-bottom: 2px solid #e0e0e0;
            }

            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .stat-card {
                background: white;
                border-radius: 10px;
                padding: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.08);
                display: flex;
                align-items: center;
                gap: 15px;
                transition: transform 0.3s;
            }

            .stat-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 5px 20px rgba(0,0,0,0.12);
            }

            .stat-icon {
                width: 60px;
                height: 60px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                color: white;
            }

            .stat-icon.bg-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .stat-icon.bg-success { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
            .stat-icon.bg-danger { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
            .stat-icon.bg-info { background: linear-gradient(135deg, #30cfd0 0%, #330867 100%); }

            .search-filter-section {
                display: flex;
                gap: 20px;
                margin-bottom: 30px;
                flex-wrap: wrap;
            }

            .enhanced-search-box {
                flex: 1;
                min-width: 300px;
                position: relative;
                background: white;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.08);
                overflow: hidden;
            }

            .enhanced-search-box i {
                position: absolute;
                left: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: #999;
            }

            .enhanced-search-box input {
                width: 100%;
                padding: 15px 45px;
                border: none;
                outline: none;
                font-size: 15px;
            }

            .enhanced-search-box .clear-search {
                position: absolute;
                right: 15px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                padding: 5px;
            }

            .filter-buttons {
                display: flex;
                gap: 10px;
            }

            .filter-buttons select {
                padding: 12px 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background: white;
                cursor: pointer;
                font-size: 14px;
            }

            .enhanced-users-table {
                width: 100%;
                background: white;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            }

            .enhanced-users-table thead {
                background: #f8f9fa;
            }

            .enhanced-users-table th {
                padding: 15px;
                text-align: left;
                font-weight: 600;
                color: #333;
                border-bottom: 2px solid #e0e0e0;
            }

            .enhanced-users-table td {
                padding: 15px;
                border-bottom: 1px solid #f0f0f0;
            }

            .user-info-cell {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .user-avatar {
                width: 45px;
                height: 45px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 18px;
            }

            .user-details h4 {
                margin: 0 0 5px 0;
                font-size: 16px;
                color: #333;
            }

            .user-details p {
                margin: 0;
                font-size: 13px;
                color: #666;
            }

            .permission-badge {
                display: inline-block;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                color: white;
            }

            .status-badge {
                display: inline-block;
                padding: 5px 10px;
                border-radius: 5px;
                font-size: 12px;
                font-weight: 600;
            }

            .status-active { background: #d4edda; color: #155724; }
            .status-inactive { background: #f8d7da; color: #721c24; }
            .status-locked { background: #fff3cd; color: #856404; }

            .action-buttons {
                display: flex;
                gap: 8px;
            }

            .action-buttons button {
                padding: 8px 12px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.3s;
            }

            .btn-edit {
                background: #007bff;
                color: white;
            }

            .btn-password {
                background: #ffc107;
                color: #333;
            }

            .btn-delete {
                background: #dc3545;
                color: white;
            }

            .permission-matrix-table {
                width: 100%;
                background: white;
                border-radius: 10px;
                overflow: hidden;
                margin-top: 20px;
            }

            .permission-matrix-table th {
                background: #f8f9fa;
                padding: 12px;
                text-align: center;
                font-size: 14px;
            }

            .permission-matrix-table td {
                padding: 10px;
                text-align: center;
                border: 1px solid #e0e0e0;
            }

            .permission-icon {
                font-size: 18px;
            }

            .permission-full { color: #28a745; }
            .permission-limited { color: #ffc107; }
            .permission-view { color: #17a2b8; }
            .permission-none { color: #dc3545; }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // 전체 선택 체크박스
        const selectAll = document.getElementById('selectAll');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                const checkboxes = document.querySelectorAll('.user-checkbox');
                checkboxes.forEach(cb => cb.checked = e.target.checked);
            });
        }
    }

    async loadUsers() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/users`);
            const data = await response.json();

            if (data.success) {
                this.users = data.users || [];
                this.filteredUsers = [...this.users];
                this.updateStats();
                this.renderUsers();
                this.renderPermissionMatrix();
            }
        } catch (error) {
            console.error('사용자 로드 실패:', error);
        }
    }

    updateStats() {
        document.getElementById('totalUsers').textContent = this.users.length;
        document.getElementById('activeUsers').textContent =
            this.users.filter(u => u.is_active).length;
        document.getElementById('adminUsers').textContent =
            this.users.filter(u => u.role === 'admin').length;
        document.getElementById('nutritionistUsers').textContent =
            this.users.filter(u => u.role === 'nutritionist').length;
    }

    renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageUsers = this.filteredUsers.slice(start, end);

        tbody.innerHTML = pageUsers.map(user => {
            const permissionLevel = this.getUserPermissionLevel(user);
            const permissionInfo = this.getPermissionInfo(permissionLevel);
            const displayName = user.full_name || user.name || user.username;
            const firstChar = displayName.charAt(0).toUpperCase();

            return `
                <tr>
                    <td><input type="checkbox" class="user-checkbox" value="${user.id}"></td>
                    <td>
                        <div class="user-info-cell">
                            <div class="user-avatar">${firstChar}</div>
                            <div class="user-details">
                                <h4>${displayName}</h4>
                                <p><small style="color: #888;">@${user.username}</small> | ${user.contact_info || '연락처 없음'}</p>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="permission-badge" style="background: ${permissionInfo.color}">
                            ${permissionInfo.label}
                        </span>
                    </td>
                    <td>${user.managed_site || '<span style="color: #ff9800;">전체</span>'}</td>
                    <td>
                        <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">
                            ${user.is_active ? '활성' : '비활성'}
                        </span>
                    </td>
                    <td>${this.formatDate(user.last_login) || '없음'}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-edit" onclick="enhancedUserMgmt.editUser(${user.id})">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-password" onclick="enhancedUserMgmt.resetPassword(${user.id})">
                                <i class="fas fa-key"></i>
                            </button>
                            <button class="btn-delete" onclick="enhancedUserMgmt.deleteUser(${user.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        this.renderPagination();
    }

    renderPermissionMatrix() {
        const tbody = document.getElementById('permissionMatrixBody');
        if (!tbody) return;

        tbody.innerHTML = Object.entries(EnhancedUserManagement.PERMISSION_MATRIX).map(([module, permissions]) => {
            return `
                <tr>
                    <td><strong>${module}</strong></td>
                    ${[1, 2, 3, 4, 5].map(level => {
                        const permission = permissions[level];
                        let icon, className;

                        switch(permission) {
                            case 'full':
                                icon = '✅';
                                className = 'permission-full';
                                break;
                            case 'limited':
                            case 'approve':
                                icon = '⚠️';
                                className = 'permission-limited';
                                break;
                            case 'view':
                                icon = '👁️';
                                className = 'permission-view';
                                break;
                            case 'none':
                                icon = '❌';
                                className = 'permission-none';
                                break;
                        }

                        return `<td class="${className}"><span class="permission-icon">${icon}</span></td>`;
                    }).join('')}
                </tr>
            `;
        }).join('');
    }

    getUserPermissionLevel(user) {
        if (user.role === 'admin' && user.operator) return 1;  // 시스템 관리자
        if (user.role === 'admin') return 2;                   // 사업장 관리자
        if (user.role === 'operator' || user.semi_operator) return 3;  // 운영 담당자
        if (user.role === 'nutritionist') return 4;            // 영양사
        return 5;                                              // 조회 전용
    }

    getPermissionInfo(level) {
        const levels = Object.values(EnhancedUserManagement.PERMISSION_LEVELS);
        return levels.find(l => l.level === level) || levels[levels.length - 1];
    }

    searchUsers(query) {
        query = query.toLowerCase().trim();

        if (!query) {
            this.filteredUsers = [...this.users];
        } else {
            this.filteredUsers = this.users.filter(user =>
                user.username.toLowerCase().includes(query) ||
                (user.full_name && user.full_name.toLowerCase().includes(query)) ||
                (user.name && user.name.toLowerCase().includes(query)) ||
                (user.contact_info && user.contact_info.toLowerCase().includes(query)) ||
                (user.department && user.department.toLowerCase().includes(query))
            );
        }

        this.currentPage = 1;
        this.renderUsers();
    }

    clearSearch() {
        document.getElementById('userSearchInput').value = '';
        this.filteredUsers = [...this.users];
        this.renderUsers();
    }

    filterByRole(level) {
        if (!level) {
            this.filteredUsers = [...this.users];
        } else {
            this.filteredUsers = this.users.filter(user =>
                this.getUserPermissionLevel(user) === parseInt(level)
            );
        }
        this.currentPage = 1;
        this.renderUsers();
    }

    filterByStatus(status) {
        if (!status) {
            this.filteredUsers = [...this.users];
        } else {
            this.filteredUsers = this.users.filter(user => {
                if (status === 'active') return user.is_active;
                if (status === 'inactive') return !user.is_active;
                if (status === 'locked') return user.is_locked;
                return true;
            });
        }
        this.currentPage = 1;
        this.renderUsers();
    }

    renderPagination() {
        const totalPages = Math.ceil(this.filteredUsers.length / this.itemsPerPage);
        const pagination = document.getElementById('pagination');
        if (!pagination) return;

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

        let html = '<div class="pagination-wrapper">';

        if (totalPages > 0) {
            // 페이지 정보
            html += `<span class="page-info">총 ${this.filteredUsers.length}명</span>`;

            const currentPage = this.currentPage;
            const hasPrev = currentPage > 1;
            const hasNext = currentPage < totalPages;

            // 처음으로 버튼
            html += `<button class="page-btn nav-btn" ${!hasPrev ? 'disabled' : ''} onclick="enhancedUserMgmt.goToPage(1)" title="처음">«</button>`;

            // 이전 페이지 버튼
            html += `<button class="page-btn nav-btn" ${!hasPrev ? 'disabled' : ''} onclick="enhancedUserMgmt.goToPage(${currentPage - 1})" title="이전">‹</button>`;

            // 페이지 번호들
            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, currentPage + 2);

            // 첫 페이지와 간격이 있으면 ... 표시
            if (startPage > 1) {
                html += `<button class="page-btn" onclick="enhancedUserMgmt.goToPage(1)">1</button>`;
                if (startPage > 2) {
                    html += `<span class="page-dots">...</span>`;
                }
            }

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="enhancedUserMgmt.goToPage(${i})">${i}</button>`;
            }

            // 마지막 페이지와 간격이 있으면 ... 표시
            if (endPage < totalPages) {
                if (endPage < totalPages - 1) {
                    html += `<span class="page-dots">...</span>`;
                }
                html += `<button class="page-btn" onclick="enhancedUserMgmt.goToPage(${totalPages})">${totalPages}</button>`;
            }

            // 다음 페이지 버튼
            html += `<button class="page-btn nav-btn" ${!hasNext ? 'disabled' : ''} onclick="enhancedUserMgmt.goToPage(${currentPage + 1})" title="다음">›</button>`;

            // 마지막으로 버튼
            html += `<button class="page-btn nav-btn" ${!hasNext ? 'disabled' : ''} onclick="enhancedUserMgmt.goToPage(${totalPages})" title="마지막">»</button>`;
        }

        html += '</div>';
        pagination.innerHTML = html;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredUsers.length / this.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        this.currentPage = page;
        this.renderUsers();
    }

    openUserModal(userId = null) {
        this.showCompactModal(userId);
    }

    showCompactModal(userId = null) {
        const isEdit = userId !== null;
        const user = isEdit ? this.users.find(u => u.id === userId) : null;

        const modalHtml = `
            <div id="userModal" class="modal-overlay">
                <div class="compact-modal">
                    <div class="modal-header">
                        <h2>${isEdit ? '사용자 수정' : '새 사용자 추가'}</h2>
                        <button class="close-btn" onclick="enhancedUserMgmt.closeModal()">×</button>
                    </div>

                    <form id="userForm">
                        <div class="ultra-compact-grid">
                            <!-- 좌측: 기본 정보 + 추가 옵션 -->
                            <div class="left-column">
                                <div class="form-section-compact">
                                    <h4>기본 정보</h4>
                                    <div class="form-row-compact">
                                        <div class="form-group-compact">
                                            <label>아이디*</label>
                                            <input type="text" name="username" value="${isEdit && user ? user.username : ''}" required
                                                   placeholder="로그인에 사용할 아이디" ${isEdit ? 'readonly style="background:#f5f5f5;"' : ''}>
                                        </div>
                                        <div class="form-group-compact">
                                            <label>이름*</label>
                                            <input type="text" name="full_name" value="${isEdit && user ? (user.full_name || user.name || '') : ''}" required
                                                   placeholder="사용자 실명">
                                        </div>
                                    </div>
                                    <div class="form-row-compact">
                                        <div class="form-group-compact">
                                            <label>비밀번호${isEdit ? '' : '*'}</label>
                                            <input type="password" name="password" ${isEdit ? '' : 'required'}
                                                   placeholder="${isEdit ? '변경시에만 입력' : ''}">
                                        </div>
                                        <div class="form-group-compact">
                                            <label>비밀번호 확인${isEdit ? '' : '*'}</label>
                                            <input type="password" name="password_confirm" ${isEdit ? '' : 'required'}
                                                   placeholder="${isEdit ? '변경시에만 입력' : ''}">
                                        </div>
                                    </div>
                                    <div class="form-row-compact">
                                        <div class="form-group-compact">
                                            <label>연락처</label>
                                            <input type="text" name="contact_info" value="${isEdit && user ? (user.contact_info || '') : ''}"
                                                   placeholder="전화번호 또는 이메일">
                                        </div>
                                        <div class="form-group-compact">
                                        </div>
                                    </div>
                                    <div class="form-row-compact">
                                        <div class="form-group-compact">
                                            <label>부서</label>
                                            <input type="text" name="department" value="${isEdit && user ? (user.department || '') : ''}">
                                        </div>
                                        <div class="form-group-compact">
                                            <label>직책</label>
                                            <input type="text" name="position" value="${isEdit && user ? (user.position || '') : ''}">
                                        </div>
                                    </div>
                                </div>

                                <div class="form-section-compact">
                                    <h4>추가 옵션</h4>
                                    <div class="checkbox-group-compact">
                                        <label>
                                            <input type="checkbox" name="is_active" ${!isEdit || (user && user.is_active !== false) ? 'checked' : ''}>
                                            <span>계정 활성화</span>
                                        </label>
                                    </div>
                                </div>
                                <div class="form-section-compact" style="margin-top: 8px;">
                                    <h4>페이지 접근 권한</h4>
                                    <div class="checkbox-group-compact">
                                        <label style="display: flex; align-items: center; gap: 8px;">
                                            <input type="checkbox" name="blog_access"
                                                   ${isEdit && user && (user.permissions?.blog_access || user.role === 'admin') ? 'checked' : ''}>
                                            <span>📝 블로그/SNS 관리</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <!-- 우측: 권한 설정 -->
                            <div class="right-column">
                                <div class="form-section-compact">
                                    <h4>권한 설정</h4>
                                    <div class="permission-selector-enhanced">
                                        <label class="permission-radio-item ${user && this.getUserPermissionLevel(user) === 1 ? 'selected' : ''}">
                                            <input type="radio" name="permission_level" value="1"
                                                   ${user && this.getUserPermissionLevel(user) === 1 ? 'checked' : ''}>
                                            <span class="permission-dot" style="background: #dc3545"></span>
                                            <span class="permission-name">시스템 관리자</span>
                                            <span class="permission-desc">모든 기능</span>
                                        </label>
                                        <label class="permission-radio-item ${user && this.getUserPermissionLevel(user) === 2 ? 'selected' : ''}">
                                            <input type="radio" name="permission_level" value="2"
                                                   ${user && this.getUserPermissionLevel(user) === 2 ? 'checked' : ''}>
                                            <span class="permission-dot" style="background: #ffc107"></span>
                                            <span class="permission-name">사업장 관리자</span>
                                            <span class="permission-desc">담당 사업장</span>
                                        </label>
                                        <label class="permission-radio-item ${user && this.getUserPermissionLevel(user) === 3 ? 'selected' : ''}">
                                            <input type="radio" name="permission_level" value="3"
                                                   ${user && this.getUserPermissionLevel(user) === 3 ? 'checked' : ''}>
                                            <span class="permission-dot" style="background: #17a2b8"></span>
                                            <span class="permission-name">운영 담당자</span>
                                            <span class="permission-desc">일일 운영</span>
                                        </label>
                                        <label class="permission-radio-item ${user && this.getUserPermissionLevel(user) === 4 ? 'selected' : ''}">
                                            <input type="radio" name="permission_level" value="4"
                                                   ${user && this.getUserPermissionLevel(user) === 4 ? 'checked' : ''}>
                                            <span class="permission-dot" style="background: #28a745"></span>
                                            <span class="permission-name">영양사</span>
                                            <span class="permission-desc">식단/메뉴</span>
                                        </label>
                                        <label class="permission-radio-item ${!user || this.getUserPermissionLevel(user) === 5 ? 'selected' : ''}">
                                            <input type="radio" name="permission_level" value="5"
                                                   ${!user || this.getUserPermissionLevel(user) === 5 ? 'checked' : ''}>
                                            <span class="permission-dot" style="background: #6c757d"></span>
                                            <span class="permission-name">조회 전용</span>
                                            <span class="permission-desc">읽기만</span>
                                        </label>
                                    </div>
                                </div>

                                <div class="form-section-compact" style="margin-top: 12px;">
                                    <h4>관리 사업장 <span style="font-weight: normal; font-size: 11px; color: #666;">(복수 선택 가능)</span></h4>
                                    <div class="managed-sites-container">
                                        <label class="site-checkbox-item all-sites">
                                            <input type="checkbox" name="managed_access" value="all"
                                                   ${isEdit && user && this.isAllAccess(user) ? 'checked' : ''}
                                                   onchange="enhancedUserMgmt.toggleAllSites(this)">
                                            <span>🌐 전체 사업장</span>
                                        </label>
                                        ${this.getNormalGroups().map(group => {
                                            const groupId = group.id;
                                            const groupName = group.group_name;
                                            const siteCount = group.site_count || 0;
                                            const isChecked = isEdit && user && user.managed_groups && user.managed_groups.includes(groupId);
                                            return `
                                                <label class="site-checkbox-item group-item">
                                                    <input type="checkbox" name="managed_access" value="group_${groupId}"
                                                           ${isChecked ? 'checked' : ''}
                                                           onchange="enhancedUserMgmt.uncheckAllIfSelected()">
                                                    <span>🏢 ${groupName}</span>
                                                    <small class="site-count">${siteCount}개 사업장</small>
                                                </label>
                                            `;
                                        }).join('')}
                                        ${this.getConsignmentSites().length > 0 ? `
                                            <div class="consignment-divider">위탁사업장 (개별 선택)</div>
                                            ${this.getConsignmentSites().map(cat => {
                                                const isChecked = isEdit && user && user.managed_categories && user.managed_categories.includes(cat.id);
                                                return `
                                                    <label class="site-checkbox-item consignment-item">
                                                        <input type="checkbox" name="managed_access" value="category_${cat.id}"
                                                               ${isChecked ? 'checked' : ''}
                                                               onchange="enhancedUserMgmt.uncheckAllIfSelected()">
                                                        <span>🏭 ${cat.name}</span>
                                                    </label>
                                                `;
                                            }).join('')}
                                        ` : `
                                            <div class="consignment-divider">위탁사업장 (개별 선택)</div>
                                            <div class="no-consignment-sites">등록된 위탁사업장이 없습니다</div>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <div class="footer-buttons">
                                <button type="button" class="btn btn-secondary" onclick="enhancedUserMgmt.closeModal()">취소</button>
                                <button type="submit" class="btn btn-primary">
                                    ${isEdit ? '수정' : '추가'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.addModalStyles();

        // 폼 이벤트 리스너 등록 (한 번만)
        const form = document.getElementById('userForm');
        if (form) {
            form.onsubmit = (e) => this.saveUser(e);
        }

        // 수정 모드일 때 데이터 로드
        if (userId && user) {
            this.loadUserDataToForm(user);
        }
    }

    loadUserDataToForm(user) {
        // 사용자 데이터를 폼에 로드
        const form = document.getElementById('userForm');
        if (!form) return;

        // 기본 정보
        if (form.username) form.username.value = user.username || '';
        if (form.contact_info) form.contact_info.value = user.contact_info || '';
        if (form.department) form.department.value = user.department || '';
        if (form.position) form.position.value = user.position || '';
        if (form.managed_site) form.managed_site.value = user.managed_site || '';

        // 권한 레벨 설정 (1=시스템관리자, 2=사업장관리자, 3=운영담당자, 4=영양사, 5=조회전용)
        let permissionLevel = 5; // 기본값: 조회 전용
        if (user.role === 'admin' && user.operator) permissionLevel = 1;
        else if (user.role === 'admin') permissionLevel = 2;
        else if (user.role === 'operator' || user.semi_operator) permissionLevel = 3;
        else if (user.role === 'nutritionist') permissionLevel = 4;

        if (form.permission_level) {
            const radioButtons = form.querySelectorAll('input[name="permission_level"]');
            radioButtons.forEach(radio => {
                if (parseInt(radio.value) === permissionLevel) {
                    radio.checked = true;
                }
            });
        }

        // 활성 상태
        if (form.is_active) form.is_active.checked = user.is_active;
    }

    addModalStyles() {
        if (document.getElementById('compact-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'compact-modal-styles';
        style.textContent = `
            .modal-overlay {
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
            }

            .compact-modal {
                background: white;
                border-radius: 10px;
                width: 90%;
                max-width: 850px;
                max-height: 95vh;
                min-height: 700px;
                overflow: hidden;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            }

            .compact-modal .modal-header {
                padding: 12px 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .compact-modal .modal-header h2 {
                margin: 0;
                font-size: 18px;
            }

            .compact-modal .close-btn {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: white;
                opacity: 0.8;
            }

            .compact-modal .modal-body {
                padding: 15px;
                background: #f8f9fa;
                max-height: calc(92vh - 120px);
                overflow-y: auto;
            }

            .ultra-compact-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
            }

            .form-section-compact {
                background: white;
                padding: 12px;
                border-radius: 6px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.08);
            }

            .form-section-compact h4 {
                margin: 0 0 10px 0;
                color: #333;
                font-size: 13px;
                font-weight: 600;
                border-bottom: 1px solid #e9ecef;
                padding-bottom: 5px;
            }

            .form-group-compact {
                margin-bottom: 8px;
            }

            .form-group-compact label {
                display: block;
                font-size: 11px;
                font-weight: 500;
                color: #495057;
                margin-bottom: 3px;
            }

            .form-group-compact input,
            .form-group-compact select,
            .form-group-compact textarea {
                width: 100%;
                padding: 5px 8px;
                border: 1px solid #ced4da;
                border-radius: 3px;
                font-size: 12px;
            }

            .form-group-compact input:focus,
            .form-group-compact select:focus,
            .form-group-compact textarea:focus {
                border-color: #667eea;
                outline: none;
                box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.1);
            }

            .required::after {
                content: ' *';
                color: #dc3545;
                font-size: 10px;
            }

            .radio-group-compact {
                display: flex;
                gap: 10px;
                margin-top: 3px;
                flex-wrap: wrap;
            }

            .radio-label-compact {
                display: flex;
                align-items: center;
                cursor: pointer;
                font-size: 11px;
            }

            .radio-label-compact input[type="radio"] {
                width: auto;
                margin-right: 3px;
                transform: scale(0.9);
            }

            .permission-matrix-compact {
                background: #f8f9fa;
                padding: 8px;
                border-radius: 4px;
                margin-top: 8px;
                max-height: 180px;
                overflow-y: auto;
            }

            .permission-item-compact {
                display: flex;
                align-items: center;
                padding: 4px 6px;
                margin-bottom: 3px;
                background: white;
                border-radius: 3px;
                font-size: 11px;
            }

            .permission-label-compact {
                flex: 1;
                color: #495057;
            }

            .compact-modal .modal-footer {
                padding: 12px 20px;
                background: #f8f9fa;
                border-top: 1px solid #dee2e6;
                display: flex;
                justify-content: center;
                align-items: center;
            }

            .footer-buttons {
                display: flex;
                gap: 10px;
            }

            .btn {
                padding: 6px 14px;
                border: none;
                border-radius: 4px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s;
                font-size: 12px;
            }

            .btn-primary {
                background: #667eea;
                color: white;
            }

            .btn-primary:hover {
                background: #5a67d8;
            }

            .btn-secondary {
                background: #6c757d;
                color: white;
            }

            .btn-danger {
                background: #dc3545;
                color: white;
            }

            /* 스크롤바 스타일 */
            .compact-modal .modal-body::-webkit-scrollbar,
            .permission-matrix-compact::-webkit-scrollbar {
                width: 6px;
            }

            .compact-modal .modal-body::-webkit-scrollbar-track,
            .permission-matrix-compact::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 3px;
            }

            .compact-modal .modal-body::-webkit-scrollbar-thumb,
            .permission-matrix-compact::-webkit-scrollbar-thumb {
                background: #888;
                border-radius: 3px;
            }

            .permission-selector {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .permission-selector label {
                display: flex;
                align-items: center;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 5px;
                cursor: pointer;
                transition: all 0.3s;
            }

            .permission-selector label:hover {
                background: #f0f0f0;
            }

            .permission-selector input[type="radio"] {
                margin-right: 10px;
            }

            .permission-option {
                display: flex;
                flex-direction: column;
            }

            .permission-option strong {
                font-size: 14px;
            }

            .permission-option small {
                font-size: 12px;
                color: #666;
            }

            /* 개선된 권한 선택 UI */
            .permission-selector-enhanced {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .permission-radio-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
                background: white;
            }

            .permission-radio-item:hover {
                background: #f8f9fa;
                border-color: #667eea;
            }

            .permission-radio-item.selected,
            .permission-radio-item:has(input:checked) {
                background: #f0f4ff;
                border-color: #667eea;
            }

            .permission-radio-item input[type="radio"] {
                width: auto;
                margin: 0;
            }

            .permission-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .permission-name {
                font-weight: 600;
                font-size: 12px;
                color: #333;
                flex: 1;
            }

            .permission-desc {
                font-size: 10px;
                color: #888;
            }

            /* 관리 사업장 복수 선택 */
            .managed-sites-container {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 6px;
                min-height: 200px;
                max-height: 400px;
                overflow-y: auto;
                padding: 10px;
                background: #f8f9fa;
                border-radius: 6px;
                border: 1px solid #e0e0e0;
            }

            .site-checkbox-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
                border: 1px solid #e0e0e0;
            }

            .site-checkbox-item:hover {
                background: #e3f2fd;
                border-color: #90caf9;
            }

            .site-checkbox-item:has(input:checked) {
                background: #e8f5e9;
                border-color: #81c784;
            }

            .site-checkbox-item input[type="checkbox"] {
                width: auto;
                margin: 0;
            }

            .site-checkbox-item.all-sites {
                grid-column: 1 / -1;
                background: #fff3e0;
                border-color: #ffcc80;
            }

            .site-checkbox-item.all-sites:has(input:checked) {
                background: #ffe0b2;
                border-color: #ff9800;
            }

            .site-checkbox-item .site-count {
                margin-left: auto;
                font-size: 10px;
                color: #888;
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 10px;
            }

            .site-checkbox-item.consignment-item {
                background: #fafafa;
            }

            .site-checkbox-item.consignment-item:has(input:checked) {
                background: #e3f2fd;
                border-color: #64b5f6;
            }

            .consignment-divider {
                grid-column: 1 / -1;
                font-size: 11px;
                font-weight: 600;
                color: #666;
                padding: 8px 0 4px 0;
                margin-top: 4px;
                border-top: 1px dashed #ddd;
            }

            .no-consignment-sites {
                grid-column: 1 / -1;
                font-size: 11px;
                color: #999;
                text-align: center;
                padding: 12px;
                background: #fafafa;
                border-radius: 4px;
            }

            .checkbox-group {
                display: flex;
                gap: 20px;
                margin-bottom: 15px;
            }

            .checkbox-group label {
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 14px;
            }

            .modal-actions {
                padding: 20px;
                border-top: 1px solid #e0e0e0;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .btn {
                padding: 10px 20px;
                border: none;
                border-radius: 5px;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.3s;
            }

            .btn-primary {
                background: #007bff;
                color: white;
            }

            .btn-secondary {
                background: #6c757d;
                color: white;
            }

            .btn-warning {
                background: #ffc107;
                color: #333;
            }

            .btn:hover {
                opacity: 0.9;
                transform: translateY(-2px);
            }
        `;
        document.head.appendChild(style);
    }

    closeModal() {
        const modal = document.getElementById('userModal');
        if (modal) modal.remove();
        this.isSaving = false;  // 플래그 초기화
        this.isEditMode = false;
        this.currentUserId = null;
    }

    // 전체 권한 여부 확인
    isAllAccess(user) {
        if (!user) return true;
        const hasGroups = user.managed_groups && user.managed_groups.length > 0;
        const hasCategories = user.managed_categories && user.managed_categories.length > 0;
        return !hasGroups && !hasCategories;
    }

    // 전체 사업장 선택 토글
    toggleAllSites(checkbox) {
        const otherCheckboxes = document.querySelectorAll('input[name="managed_access"]:not([value="all"])');
        if (checkbox.checked) {
            // 전체 선택 시 개별 항목 모두 해제
            otherCheckboxes.forEach(cb => cb.checked = false);
        }
    }

    // 개별 선택 시 전체 해제
    uncheckAllIfSelected() {
        const allCheckbox = document.querySelector('input[name="managed_access"][value="all"]');
        const selectedCheckboxes = document.querySelectorAll('input[name="managed_access"]:not([value="all"]):checked');
        if (allCheckbox && selectedCheckboxes.length > 0) {
            allCheckbox.checked = false;
        }
    }

    async saveUser(event) {
        event.preventDefault();

        // 중복 저장 방지
        if (this.isSaving) {
            console.log('이미 저장 중입니다...');
            return;
        }

        this.isSaving = true;
        const submitButton = event.target.querySelector('button[type="submit"]');
        const originalText = submitButton ? submitButton.textContent : '';

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = '저장 중...';
        }

        const formData = new FormData(event.target);
        const userData = {};

        // 기본 필드 수집
        userData.username = formData.get('username');
        userData.full_name = formData.get('full_name');
        userData.password = formData.get('password');
        userData.password_confirm = formData.get('password_confirm');
        userData.contact_info = formData.get('contact_info');
        userData.department = formData.get('department');
        userData.position = formData.get('position');
        userData.permission_level = formData.get('permission_level');
        userData.is_active = formData.get('is_active') === 'on';

        // 페이지 접근 권한 수집
        userData.permissions = {
            blog_access: formData.get('blog_access') === 'on'
        };

        // 관리 사업장 선택 처리 (그룹 + 개별 위탁사업장)
        const selectedCheckboxes = document.querySelectorAll('input[name="managed_access"]:checked');
        const selectedValues = Array.from(selectedCheckboxes).map(cb => cb.value);

        userData.managed_groups = [];
        userData.managed_categories = [];

        if (selectedValues.includes('all') || selectedValues.length === 0) {
            // 전체 권한
            userData.managed_site = '';
        } else {
            const groupIds = [];
            const categoryIds = [];
            const displayNames = [];

            selectedValues.forEach(val => {
                if (val.startsWith('group_')) {
                    const groupId = parseInt(val.replace('group_', ''));
                    groupIds.push(groupId);
                    const group = this.siteGroups.find(g => g.id === groupId);
                    if (group) displayNames.push(group.group_name);
                } else if (val.startsWith('category_')) {
                    const categoryId = parseInt(val.replace('category_', ''));
                    categoryIds.push(categoryId);
                    const cat = this.getConsignmentSites().find(c => c.id === categoryId);
                    if (cat) displayNames.push(cat.name);
                }
            });

            userData.managed_groups = groupIds;
            userData.managed_categories = categoryIds;
            userData.managed_site = displayNames.join(', ');  // 하위 호환성
        }

        // 권한 레벨에 따라 role과 operator 설정
        // (1=시스템관리자, 2=사업장관리자, 3=운영담당자, 4=영양사, 5=조회전용)
        const permissionLevel = parseInt(userData.permission_level);
        switch(permissionLevel) {
            case 1:
                userData.role = 'admin';
                userData.operator = true;
                userData.semi_operator = false;
                break;
            case 2:
                userData.role = 'admin';
                userData.operator = false;
                userData.semi_operator = false;
                break;
            case 3:
                userData.role = 'operator';
                userData.operator = false;
                userData.semi_operator = true;
                break;
            case 4:
                userData.role = 'nutritionist';
                userData.operator = false;
                userData.semi_operator = false;
                break;
            default:
                userData.role = 'viewer';
                userData.operator = false;
                userData.semi_operator = false;
        }

        // 불린 값 변환
        userData.is_active = userData.is_active === 'on';
        userData.email_notifications = userData.email_notifications === 'on';

        // permission_level 필드 제거 (API에서 불필요)
        delete userData.permission_level;

        // 비밀번호 입력 시 확인 검증
        if (userData.password && userData.password !== '') {
            if (userData.password !== userData.password_confirm) {
                alert('비밀번호가 일치하지 않습니다.');
                return;
            }
        }

        // 수정 모드에서 비밀번호가 비어있으면 제거
        if (this.isEditMode && (!userData.password || userData.password === '')) {
            delete userData.password;
            delete userData.password_confirm;
        }

        // 빈 문자열을 null로 변환
        Object.keys(userData).forEach(key => {
            if (userData[key] === '') {
                userData[key] = null;
            }
        });

        console.log('저장할 데이터:', userData);

        try {
            const url = this.isEditMode ?
                `${this.API_BASE_URL}/api/admin/users/${this.currentUserId}` :
                `${this.API_BASE_URL}/api/admin/users`;

            const method = this.isEditMode ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            const result = await response.json();
            console.log('API 응답:', result);

            if (result.success) {
                this.closeModal();
                await this.loadUsers();
            } else {
                alert('오류: ' + (result.error || result.message || result.detail || '처리 실패'));
            }
        } catch (error) {
            console.error('사용자 저장 실패:', error);
            alert('사용자 저장 중 오류가 발생했습니다.\n' + error.message);
        } finally {
            // 저장 완료 후 플래그 해제
            this.isSaving = false;
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        }
    }

    editUser(userId) {
        this.isEditMode = true;
        this.currentUserId = userId;
        this.showCompactModal(userId);
    }

    async resetPassword(userId) {
        if (!confirm('이 사용자의 비밀번호를 초기화하시겠습니까?\n초기 비밀번호는 "1234"입니다.')) return;

        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/users/${userId}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_password: '1234' })
            });

            const result = await response.json();

            if (result.success) {
                alert('비밀번호가 초기화되었습니다.\n초기 비밀번호: 1234');
            } else {
                alert('비밀번호 초기화 실패: ' + (result.message || ''));
            }
        } catch (error) {
            console.error('비밀번호 초기화 실패:', error);
            alert('비밀번호 초기화 중 오류가 발생했습니다.');
        }
    }

    async deleteUser(userId) {
        if (!confirm('정말로 이 사용자를 삭제하시겠습니까?')) return;

        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                alert('사용자가 삭제되었습니다.');
                await this.loadUsers();
            } else {
                alert('삭제 실패: ' + (result.message || ''));
            }
        } catch (error) {
            console.error('사용자 삭제 실패:', error);
            alert('사용자 삭제 중 오류가 발생했습니다.');
        }
    }

    formatDate(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR') + ' ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }

    async loadBusinessLocations() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/api/admin/business-locations`);
            const data = await response.json();
            if (data.success) {
                this.businessLocations = data.locations || [];
                console.log('✅ 사업장 정보 로드 완료:', this.businessLocations.length, '개');
            }
        } catch (error) {
            console.error('❌ 사업장 로드 실패:', error);
            // 폴백 데이터
            this.businessLocations = [
                { site_name: '도시락' },
                { site_name: '운반' },
                { site_name: '학교' },
                { site_name: '요양원' },
                { site_name: '영남 도시락' },
                { site_name: '영남 운반' }
            ];
        }
    }

    // 사업장 그룹 및 구조 로드
    async loadSiteGroups() {
        try {
            // 그룹 목록과 전체 구조 트리 병렬 로드
            const [groupsRes, structureRes] = await Promise.all([
                fetch(`${this.API_BASE_URL}/api/admin/groups`).then(r => r.json()),
                fetch(`${this.API_BASE_URL}/api/admin/structure/tree`).then(r => r.json())
            ]);

            if (groupsRes.success) {
                this.siteGroups = groupsRes.data || [];
                console.log('✅ 사업장 그룹 로드 완료:', this.siteGroups.length, '개');
            }

            if (structureRes.success) {
                this.siteStructure = structureRes.data || [];
                console.log('✅ 사업장 구조 로드 완료:', JSON.stringify(this.siteStructure, null, 2));
            }
        } catch (error) {
            console.error('❌ 사업장 그룹/구조 로드 실패:', error);
            // 폴백 데이터
            this.siteGroups = [
                { id: 1, group_name: '본사', group_code: 'DEFAULT', site_count: 4 },
                { id: 2, group_name: '영남지사', group_code: '영남지사', site_count: 2 },
                { id: 3, group_name: '위탁사업장', group_code: 'Meal', site_count: 0 }
            ];
        }
    }

    // 위탁사업장 그룹에서 개별 사업장 목록 추출
    // 위탁사업장의 경우 카테고리 자체가 개별 사업장으로 취급됨
    getConsignmentSites() {
        console.log('🔍 getConsignmentSites 호출');
        console.log('  - siteStructure:', this.siteStructure);
        console.log('  - consignmentGroupCode:', this.consignmentGroupCode);

        const consignmentGroup = this.siteStructure.find(g => g.code === this.consignmentGroupCode);
        console.log('  - consignmentGroup:', consignmentGroup);

        if (!consignmentGroup) return [];

        // 위탁사업장은 카테고리를 개별 사업장으로 취급
        const result = (consignmentGroup.categories || []).map(cat => ({
            id: cat.id,
            name: cat.name,
            code: cat.code,
            type: 'category'  // 카테고리임을 표시
        }));
        console.log('  - 결과:', result);
        return result;
    }

    // 일반 그룹 목록 (위탁사업장 제외)
    getNormalGroups() {
        return this.siteGroups.filter(g => g.group_code !== this.consignmentGroupCode);
    }
}

// 전역 인스턴스 생성
window.enhancedUserMgmt = new EnhancedUserManagement();

// 자동 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('users-content') || window.location.hash === '#users') {
            window.enhancedUserMgmt.init();
        }
    });
} else {
    if (document.getElementById('users-content') || window.location.hash === '#users') {
        window.enhancedUserMgmt.init();
    }
}