// 페이지 네비게이션 관리
function showPage(pageName) {
    // 모든 페이지 숨기기
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.add('hidden');
    });
    
    // 선택된 페이지 보이기
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    // 네비게이션 활성 상태 변경
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeItem = document.querySelector(`[data-page="${pageName}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // 페이지 제목 변경
    const titles = {
        'dashboard': '관리자 대시보드',
        'users': '사용자 관리',
        'suppliers': '업체 관리',
        'business-locations': '사업장 관리',
        'supplier-mapping': '협력업체 매핑',
        'meal-pricing': '식단가 관리',
        'ingredients': '식자재 관리',
        'pricing': '단가 관리',
        'settings': '시스템 설정',
        'logs': '로그 관리'
    };
    
    document.getElementById('page-title').textContent = titles[pageName] || '관리자 시스템';
}


// 네비게이션 클릭 이벤트
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        // target="_blank"가 있는 링크는 새 탭에서 열리도록 허용
        if (e.currentTarget.getAttribute('target') === '_blank') {
            return; // 기본 동작 허용
        }
        
        // href가 있는 외부 링크(협력업체 관리, 사업장 관리, 급식관리로 이동)는 기본 동작 허용
        const href = e.currentTarget.getAttribute('href');
        if (href && (href.startsWith('/admin/suppliers') || href.startsWith('/admin/business-locations') || href === '/')) {
            return; // 기본 동작 허용
        }
        
        e.preventDefault();
        const pageName = e.currentTarget.getAttribute('data-page');
        showPage(pageName);
        
        // 페이지별 초기화
        if (pageName === 'users') {
            loadUsers();
            loadManagedSites();
        } else if (pageName === 'suppliers') {
            loadSuppliers();
        } else if (pageName === 'business-locations') {
            loadSitesTree();
        } else if (pageName === 'ingredients') {
            loadIngredientsList();
            loadSupplierFilter();
        }
    });
});

// 로그아웃 함수
async function logout() {
    if (confirm('로그아웃 하시겠습니까?')) {
        try {
            // localStorage에서 인증 관련 데이터 삭제
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            localStorage.removeItem('userRole');
            localStorage.removeItem('username');
            sessionStorage.clear();

            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'  // 쿠키 포함
            });

            const result = await response.json();

            if (result.success) {
                window.location.href = result.redirect || '/login';
            } else {
                console.error('로그아웃 실패:', result.message);
                window.location.href = '/login.html';  // 실패해도 로그인 페이지로 이동
            }
        } catch (error) {
            console.error('로그아웃 중 오류:', error);
            window.location.href = '/login.html';  // 오류 시에도 로그인 페이지로 이동
        }
    }
}

// 대시보드 데이터 로드
async function loadDashboardData() {
    try {
        // 통계 데이터 가져오기
        const response = await fetch('/api/admin/dashboard-stats');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('total-users').textContent = data.totalUsers || 0;
            document.getElementById('total-sites').textContent = data.totalSites || 0;
            document.getElementById('today-menus').textContent = data.todayMenus || 0;
            document.getElementById('price-updates').textContent = data.priceUpdates || 0;
        }
    } catch (error) {
        console.error('대시보드 데이터 로드 실패:', error);
    }
}

// 최근 활동 로그 로드
async function loadRecentActivity() {
    try {
        const response = await fetch('/api/admin/recent-activity');
        const result = await response.json();
        const activities = result.activities || result.data || [];
        
        const activityList = document.getElementById('activity-list');
        if (activities.length === 0) {
            activityList.innerHTML = '<div class="log-item">최근 활동이 없습니다.</div>';
            return;
        }
        
        activityList.innerHTML = activities.map(activity => `
            <div class="log-item">
                <div class="log-time">${activity.time}</div>
                <div class="log-message">${activity.message}</div>
                <div class="log-user">${activity.user}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('활동 로그 로드 실패:', error);
        document.getElementById('activity-list').innerHTML = 
            '<div class="log-item">활동 로그를 불러올 수 없습니다.</div>';
    }
}

// 전역 변수들 - window 객체에 할당하여 중복 선언 방지
window.pageInitialized = window.pageInitialized || false;
window.window.allowModalDisplay = window.window.allowModalDisplay || false;

// 페이지 로드시 초기화
document.addEventListener('DOMContentLoaded', () => {
    console.log('페이지 초기화 시작');
    
    // 강제로 모든 모달 숨김 처리
    setTimeout(() => {
        const userModal = document.getElementById('user-modal');
        const siteModal = document.getElementById('site-modal');
        
        if (userModal) {
            userModal.style.display = 'none';
            userModal.classList.add('hidden');
            console.log('사용자 모달 강제 숨김');
        }
        if (siteModal) {
            siteModal.style.display = 'none';
            siteModal.classList.add('hidden');
            console.log('사업장 모달 강제 숨김');
        }
        
        // 변수 초기화
        if (typeof currentEditUserId !== 'undefined') {
            currentEditUserId = null;
        }
        if (typeof currentEditSiteId !== 'undefined') {
            currentEditSiteId = null;
        }
        
        console.log('모든 모달 숨김 처리 완료');
        
        // 초기화 완료 후 1초 뒤에 모달 표시 허용
        setTimeout(() => {
            window.pageInitialized = true;
            window.window.allowModalDisplay = true;
            console.log('모달 표시 허용됨');
        }, 1000);
    }, 100);
    
    // 기본으로 대시보드 페이지 표시
    console.log('대시보드 페이지 표시');
    showPage('dashboard');
    loadDashboardData();
    loadRecentActivity();
});

// 사용자 관리 관련 변수
window.currentPage = window.currentPage || 1;
window.totalPages = window.totalPages || 1;
let currentEditUserId = null;

// 사용자 관리 함수들

// 사용자 목록 로드
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const data = await response.json();
        
        if (data.success) {
            displayUsers(data.users);
            updatePagination(data.currentPage, data.totalPages);
        }
    } catch (error) {
        console.error('사용자 목록 로드 실패:', error);
        document.getElementById('users-table-body').innerHTML = 
            '<tr><td colspan="8">사용자 목록을 불러올 수 없습니다.</td></tr>';
    }
}

// 사용자 목록 표시
function displayUsers(users) {
    const tbody = document.getElementById('users-table-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8">등록된 사용자가 없습니다.</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${getRoleDisplay(user.role)}</td>
            <td>${user.department || '-'}</td>
            <td>${user.phone_number || '-'}</td>
            <td>${user.managed_site || '-'}</td>
            <td>${user.assigned_sites_count || 0}개 사업장</td>
            <td><span class="${user.is_active ? 'status-active' : 'status-inactive'}">
                ${user.is_active ? '활성' : '비활성'}
            </span></td>
            <td>
                <button class="btn-small btn-edit" onclick="editUser(${user.id})">수정</button>
                <button class="btn-small btn-sites" onclick="manageSites(${user.id})" style="background: #17a2b8;">사업장</button>
                <button class="btn-small btn-reset" onclick="resetPassword(${user.id})" style="background: #fd7e14;">초기화</button>
                <button class="btn-small" onclick="toggleUserStatus(${user.id}, ${!user.is_active})" style="background: ${user.is_active ? '#dc3545' : '#28a745'};">
                    ${user.is_active ? '비활성화' : '활성화'}
                </button>
            </td>
        </tr>
    `).join('');
}

// 역할 표시명 변환
function getRoleDisplay(role) {
    const roleMap = {
        'nutritionist': '영양사',
        'admin': '관리자', 
        'super_admin': '최고관리자'
    };
    return roleMap[role] || role;
}

// 페이지네이션 업데이트
function updatePagination(current, total) {
    window.currentPage = current;
    window.totalPages = total;
    document.getElementById('page-info').textContent = `${current} / ${total}`;
}

// 페이지 변경
function changePage(direction) {
    const newPage = window.currentPage + direction;
    if (newPage >= 1 && newPage <= window.totalPages) {
        window.currentPage = newPage;
        loadUsers();
    }
}

// 사용자 검색
function searchUsers() {
    const keyword = document.getElementById('user-search').value;
    // 실제 구현에서는 검색 API 호출
    console.log('검색 키워드:', keyword);
    loadUsers(); // 임시로 전체 목록 다시 로드
}

// 담당 사업장 목록 로드
async function loadManagedSites() {
    try {
        const response = await fetch('/api/admin/sites');
        const result = await response.json();
        const sites = result.sites || result.data || [];
        
        const select = document.getElementById('user-managed-site');
        select.innerHTML = '<option value="">선택하세요</option>';
        
        sites.forEach(site => {
            select.innerHTML += `<option value="${site.name}">${site.name}</option>`;
        });
    } catch (error) {
        console.error('사업장 목록 로드 실패:', error);
    }
}

// 새 사용자 추가 모달 표시
function showAddUserModal() {
    currentEditUserId = null;
    document.getElementById('modal-title').textContent = '새 사용자 추가';
    document.getElementById('user-form').reset();
    document.getElementById('user-modal').classList.remove('hidden');
}

// 사용자 수정 모달 표시
async function editUser(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`);
        const result = await response.json();
        const user = result.user || result;
        
        if (user) {
            currentEditUserId = userId;
            document.getElementById('modal-title').textContent = '사용자 정보 수정';
            
            // 폼에 기존 데이터 채우기
            document.getElementById('user-username').value = user.username;
            document.getElementById('user-password').value = ''; // 비밀번호는 비움
            document.getElementById('user-role').value = user.role;
            document.getElementById('user-contact').value = user.contact_info || '';
            document.getElementById('user-department').value = user.department || '';
            document.getElementById('user-position').value = user.position || '';
            document.getElementById('user-managed-site').value = user.managed_site || '';
            document.getElementById('user-operator').checked = user.operator || false;
            document.getElementById('user-semi-operator').checked = user.semi_operator || false;
            
            document.getElementById('user-modal').classList.remove('hidden');
        }
    } catch (error) {
        console.error('사용자 정보 로드 실패:', error);
        alert('사용자 정보를 불러올 수 없습니다.');
    }
}

// 사용자 모달 닫기
function closeUserModal() {
    document.getElementById('user-modal').classList.add('hidden');
    currentEditUserId = null;
}

// 사용자 저장
async function saveUser() {
    const userData = {
        username: document.getElementById('user-username').value,
        password: document.getElementById('user-password').value,
        role: document.getElementById('user-role').value,
        contact_info: document.getElementById('user-contact').value,
        department: document.getElementById('user-department').value,
        position: document.getElementById('user-position').value,
        managed_site: document.getElementById('user-managed-site').value,
        operator: document.getElementById('user-operator').checked,
        semi_operator: document.getElementById('user-semi-operator').checked
    };

    try {
        const url = currentEditUserId ? 
            `/api/admin/users/${currentEditUserId}` : 
            '/api/admin/users';
        
        const method = currentEditUserId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        const result = await response.json();
        
        if (result.success) {
            alert(currentEditUserId ? '사용자가 수정되었습니다.' : '새 사용자가 추가되었습니다.');
            closeUserModal();
            loadUsers();
        } else {
            alert(result.message || '저장 중 오류가 발생했습니다.');
        }
    } catch (error) {
        console.error('사용자 저장 실패:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 비밀번호 초기화
async function resetPassword(userId) {
    if (!confirm('이 사용자의 비밀번호를 초기화하시겠습니까?')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert(`비밀번호가 초기화되었습니다. 새 비밀번호: ${result.newPassword}`);
        } else {
            alert('비밀번호 초기화에 실패했습니다.');
        }
    } catch (error) {
        console.error('비밀번호 초기화 실패:', error);
        alert('비밀번호 초기화 중 오류가 발생했습니다.');
    }
}

// 사용자 삭제
async function deleteUser(userId) {
    if (!confirm('이 사용자를 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('사용자가 삭제되었습니다.');
            loadUsers();
        } else {
            alert('사용자 삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('사용자 삭제 실패:', error);
        alert('사용자 삭제 중 오류가 발생했습니다.');
    }
}

// 사업장 관리 관련 변수
let sitesData = [];
let selectedSiteId = null;
let currentEditSiteId = null;

// 사업장 트리 로드
async function loadSitesTree() {
    try {
        const response = await fetch('/api/admin/sites/tree');
        const data = await response.json();
        
        if (data.success) {
            sitesData = data.sites;
            renderSitesTree();
        }
    } catch (error) {
        console.error('사업장 트리 로드 실패:', error);
        const container = document.getElementById('sites-tree');
        if (container) {
            container.innerHTML = '<div class="text-center">사업장 정보를 불러올 수 없습니다.</div>';
        }
    }
}

// 사업장 트리 렌더링
function renderSitesTree() {
    const container = document.getElementById('sites-tree');
    if (!container) {
        console.log('sites-tree 컨테이너를 찾을 수 없습니다. 현재 페이지에서는 사업장 트리가 필요하지 않습니다.');
        return;
    }
    
    container.innerHTML = '';
    
    if (sitesData.length === 0) {
        container.innerHTML = '<div class="text-center">등록된 사업장이 없습니다.</div>';
        return;
    }
    
    // 헤드 사업장들 렌더링
    const headSites = sitesData.filter(site => site.site_type === 'head');
    headSites.forEach(site => {
        container.appendChild(createTreeNode(site));
    });
}

// 트리 노드 생성
function createTreeNode(site) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';
    nodeDiv.dataset.siteId = site.id;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = `tree-node-content ${site.site_type}-site`;
    contentDiv.onclick = () => selectSite(site.id);
    
    // 드래그 앤 드롭 이벤트 추가
    setupDragAndDrop(contentDiv, site);
    
    // 확장/축소 버튼
    const expandBtn = document.createElement('button');
    expandBtn.className = 'tree-expand-btn';
    const hasChildren = site.children && site.children.length > 0;
    
    if (hasChildren) {
        expandBtn.className += ' expanded';
        expandBtn.onclick = (e) => {
            e.stopPropagation();
            toggleNode(site.id);
        };
    } else {
        expandBtn.className += ' no-children';
    }
    
    // 아이콘
    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-node-icon';
    iconSpan.textContent = getSiteIcon(site.site_type);
    
    // 라벨
    const labelSpan = document.createElement('span');
    labelSpan.className = 'tree-node-label';
    labelSpan.textContent = site.name;
    
    // 상태
    const statusSpan = document.createElement('span');
    statusSpan.className = `tree-node-status ${site.is_active ? 'active' : 'inactive'}`;
    statusSpan.textContent = site.is_active ? '활성' : '비활성';
    
    // 액션 버튼들
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'tree-node-actions';
    
    if (site.site_type === 'head') {
        const addDetailBtn = document.createElement('button');
        addDetailBtn.className = 'tree-action-btn add';
        addDetailBtn.textContent = '+ 세부';
        addDetailBtn.onclick = (e) => {
            e.stopPropagation();
            showAddSiteModal('detail', site.id);
        };
        actionsDiv.appendChild(addDetailBtn);
    } else if (site.site_type === 'detail') {
        const addPeriodBtn = document.createElement('button');
        addPeriodBtn.className = 'tree-action-btn add';
        addPeriodBtn.textContent = '+ 기간';
        addPeriodBtn.onclick = (e) => {
            e.stopPropagation();
            showAddSiteModal('period', site.id);
        };
        actionsDiv.appendChild(addPeriodBtn);
    }
    
    const editBtn = document.createElement('button');
    editBtn.className = 'tree-action-btn edit';
    editBtn.textContent = '수정';
    editBtn.onclick = (e) => {
        e.stopPropagation();
        editSite(site.id);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tree-action-btn delete';
    deleteBtn.textContent = '삭제';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteSite(site.id);
    };
    
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    
    // 컨텐츠 조립
    contentDiv.appendChild(expandBtn);
    contentDiv.appendChild(iconSpan);
    contentDiv.appendChild(labelSpan);
    contentDiv.appendChild(statusSpan);
    contentDiv.appendChild(actionsDiv);
    
    nodeDiv.appendChild(contentDiv);
    
    // 자식 노드들
    if (hasChildren) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';
        site.children.forEach(child => {
            childrenDiv.appendChild(createTreeNode(child));
        });
        nodeDiv.appendChild(childrenDiv);
    }
    
    return nodeDiv;
}

// 사업장 아이콘 가져오기
function getSiteIcon(siteType) {
    switch (siteType) {
        case 'head': return '🏢';
        case 'detail': return '🏫';
        case 'period': return '📅';
        default: return '📍';
    }
}

// 노드 확장/축소
function toggleNode(siteId) {
    const node = document.querySelector(`[data-site-id="${siteId}"]`);
    if (!node) return;
    
    const expandBtn = node.querySelector('.tree-expand-btn');
    const childrenDiv = node.querySelector('.tree-children');
    
    if (!childrenDiv) return;
    
    if (expandBtn.classList.contains('expanded')) {
        expandBtn.className = expandBtn.className.replace('expanded', 'collapsed');
        childrenDiv.classList.add('hidden');
    } else {
        expandBtn.className = expandBtn.className.replace('collapsed', 'expanded');
        childrenDiv.classList.remove('hidden');
    }
}

// 모든 노드 확장
function expandAllSites() {
    document.querySelectorAll('.tree-expand-btn.collapsed').forEach(btn => {
        btn.className = btn.className.replace('collapsed', 'expanded');
    });
    document.querySelectorAll('.tree-children.hidden').forEach(children => {
        children.classList.remove('hidden');
    });
}

// 모든 노드 축소
function collapseAllSites() {
    document.querySelectorAll('.tree-expand-btn.expanded').forEach(btn => {
        btn.className = btn.className.replace('expanded', 'collapsed');
    });
    document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.add('hidden');
    });
}

// 사업장 선택
function selectSite(siteId) {
    // 이전 선택 해제
    document.querySelectorAll('.tree-node-content.selected').forEach(node => {
        node.classList.remove('selected');
    });
    
    // 새 선택
    const node = document.querySelector(`[data-site-id="${siteId}"] .tree-node-content`);
    if (node) {
        node.classList.add('selected');
        selectedSiteId = siteId;
        showSiteDetails(siteId);
    }
}

// 사업장 상세정보 표시
async function showSiteDetails(siteId) {
    try {
        const response = await fetch(`/api/admin/sites/${siteId}`);
        const site = await response.json();
        
        const panel = document.getElementById('site-details-panel');
        const content = document.getElementById('site-details-content');
        
        content.innerHTML = `
            <div class="site-info-group">
                <div class="site-info-label">사업장명</div>
                <div class="site-info-value">${site.name}</div>
            </div>
            <div class="site-info-group">
                <div class="site-info-label">구분</div>
                <div class="site-info-value">${getSiteTypeDisplay(site.site_type)}</div>
            </div>
            <div class="site-info-group">
                <div class="site-info-label">담당자</div>
                <div class="site-info-value">${site.contact_person || '-'}</div>
            </div>
            <div class="site-info-group">
                <div class="site-info-label">연락처</div>
                <div class="site-info-value">${site.contact_phone || '-'}</div>
            </div>
            <div class="site-info-group">
                <div class="site-info-label">주소</div>
                <div class="site-info-value">${site.address || '-'}</div>
            </div>
            <div class="site-info-group">
                <div class="site-info-label">1인당 제공량</div>
                <div class="site-info-value">${site.portion_size || 0}g</div>
            </div>
            <div class="site-stats">
                <div class="stat-box">
                    <div class="stat-number">${site.menu_count || 0}</div>
                    <div class="stat-label">등록된 식단</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${site.children_count || 0}</div>
                    <div class="stat-label">하위 사업장</div>
                </div>
            </div>
        `;
        
        panel.classList.remove('hidden');
    } catch (error) {
        console.error('사업장 상세정보 로드 실패:', error);
    }
}

// 사업장 구분 표시명
function getSiteTypeDisplay(siteType) {
    switch (siteType) {
        case '도시락': return '도시락';
        case '운반': return '운반';
        case '학교': return '학교';
        case '요양원': return '요양원';
        case '위탁': return '위탁';
        case '일반음식점': return '일반음식점';
        case '기타': return '기타';
        // 이전 버전과의 호환성
        case 'head': return '헤드 사업장';
        case 'detail': return '세부 사업장';
        case 'period': return '기간별 사업장';
        default: return siteType || '미분류';
    }
}

// ==============================================================================
// 드래그 앤 드롭 기능
// ==============================================================================

let draggedElement = null;
let draggedSite = null;

// 드래그 앤 드롭 이벤트 설정
function setupDragAndDrop(element, site) {
    element.draggable = true;
    
    element.addEventListener('dragstart', (e) => {
        draggedElement = element;
        draggedSite = site;
        element.classList.add('dragging');
        
        // 드래그 데이터 설정
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', site.id);
        
        console.log('드래그 시작:', site.name);
    });
    
    element.addEventListener('dragend', (e) => {
        element.classList.remove('dragging');
        // 모든 드롭 인디케이터 제거
        clearDropIndicators();
        draggedElement = null;
        draggedSite = null;
        
        console.log('드래그 종료');
    });
    
    element.addEventListener('dragover', (e) => {
        if (!draggedSite || draggedSite.id === site.id) return;
        
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        // 유효한 드롭 대상인지 확인
        if (canDropOn(draggedSite, site)) {
            element.classList.add('drag-over');
        } else {
            element.classList.add('drop-invalid');
        }
    });
    
    element.addEventListener('dragleave', (e) => {
        element.classList.remove('drag-over', 'drop-invalid');
    });
    
    element.addEventListener('drop', (e) => {
        e.preventDefault();
        element.classList.remove('drag-over', 'drop-invalid');
        
        if (!draggedSite || draggedSite.id === site.id) return;
        
        // 유효한 드롭인지 확인
        if (canDropOn(draggedSite, site)) {
            handleDrop(draggedSite, site);
        } else {
            console.log('유효하지 않은 드롭:', draggedSite.name, '->', site.name);
        }
    });
}

// 드롭 가능 여부 확인
function canDropOn(draggedSite, targetSite) {
    // 자기 자신에게는 드롭 불가
    if (draggedSite.id === targetSite.id) return false;
    
    // 계층 구조 규칙 확인
    // head -> detail 또는 detail -> period만 가능
    if (draggedSite.site_type === 'head') {
        // head는 이동 불가
        return false;
    } else if (draggedSite.site_type === 'detail') {
        // detail은 head에만 드롭 가능
        return targetSite.site_type === 'head';
    } else if (draggedSite.site_type === 'period') {
        // period는 detail에만 드롭 가능
        return targetSite.site_type === 'detail';
    }
    
    return false;
}

// 드롭 처리
async function handleDrop(draggedSite, targetSite) {
    console.log(`드롭 처리: ${draggedSite.name} -> ${targetSite.name}`);
    
    // 확인 대화상자
    const message = `"${draggedSite.name}"을(를) "${targetSite.name}" 하위로 이동하시겠습니까?`;
    if (!confirm(message)) {
        return;
    }
    
    try {
        // 서버에 이동 요청
        const response = await fetch(`/api/admin/sites/${draggedSite.id}/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                new_parent_id: targetSite.id
            }),
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('이동 성공:', result.message);
            // 트리 새로고침
            loadSitesTree();
        } else {
            console.error('이동 실패:', result.message);
            alert(`이동 실패: ${result.message}`);
        }
    } catch (error) {
        console.error('이동 요청 오류:', error);
        alert('이동 중 오류가 발생했습니다.');
    }
}

// 드롭 인디케이터 정리
function clearDropIndicators() {
    document.querySelectorAll('.tree-node-content').forEach(el => {
        el.classList.remove('drag-over', 'drop-invalid');
    });
}

// 상세정보 패널 닫기
function closeSiteDetails() {
    document.getElementById('site-details-panel').classList.add('hidden');
    selectedSiteId = null;
    
    // 선택 해제
    document.querySelectorAll('.tree-node-content.selected').forEach(node => {
        node.classList.remove('selected');
    });
}

// 사업장 추가 모달 표시
function showAddSiteModal(siteType, parentId = null) {
    console.log('showAddSiteModal 호출됨:', siteType, parentId, 'window.allowModalDisplay:', window.allowModalDisplay);
    
    // 페이지 초기화가 완료되지 않았으면 실행하지 않음
    if (!window.allowModalDisplay) {
        console.log('페이지 초기화 중이므로 모달 표시 취소');
        return;
    }
    
    currentEditSiteId = null;
    
    const modal = document.getElementById('site-modal');
    if (!modal) {
        console.error('사업장 모달을 찾을 수 없음');
        return;
    }
    
    document.getElementById('site-modal-title').textContent = `새 ${getSiteTypeDisplay(siteType)} 추가`;
    document.getElementById('site-form').reset();
    document.getElementById('site-parent-id').value = parentId || '';
    document.getElementById('site-type').value = siteType;
    document.getElementById('site-is-active').checked = true;
    
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    console.log('사업장 모달 표시됨');
}

// 사업장 수정
async function editSite(siteId) {
    try {
        const response = await fetch(`/api/admin/sites/${siteId}`);
        const site = await response.json();
        
        currentEditSiteId = siteId;
        document.getElementById('site-modal-title').textContent = '사업장 정보 수정';
        
        // 폼에 기존 데이터 채우기
        document.getElementById('site-name').value = site.name;
        document.getElementById('site-contact-person').value = site.contact_person || '';
        document.getElementById('site-contact-phone').value = site.contact_phone || '';
        document.getElementById('site-address').value = site.address || '';
        document.getElementById('site-portion-size').value = site.portion_size || '';
        document.getElementById('site-description').value = site.description || '';
        document.getElementById('site-is-active').checked = site.is_active;
        
        document.getElementById('site-modal').classList.remove('hidden');
    } catch (error) {
        console.error('사업장 정보 로드 실패:', error);
        alert('사업장 정보를 불러올 수 없습니다.');
    }
}

// 사업장 삭제
async function deleteSite(siteId) {
    if (!confirm('이 사업장을 삭제하시겠습니까? 하위 사업장도 함께 삭제됩니다.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/sites/${siteId}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('사업장이 삭제되었습니다.');
            loadSitesTree();
            closeSiteDetails();
        } else {
            alert('사업장 삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('사업장 삭제 실패:', error);
        alert('사업장 삭제 중 오류가 발생했습니다.');
    }
}

// 사업장 모달 닫기
function closeSiteModal() {
    console.log('closeSiteModal 호출됨');
    const modal = document.getElementById('site-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
        console.log('사업장 모달 완전히 숨김');
    }
    currentEditSiteId = null;
}

// 사업장 저장
async function saveSite() {
    const siteData = {
        name: document.getElementById('site-name').value,
        contact_person: document.getElementById('site-contact-person').value,
        contact_phone: document.getElementById('site-contact-phone').value,
        address: document.getElementById('site-address').value,
        portion_size: parseInt(document.getElementById('site-portion-size').value) || null,
        description: document.getElementById('site-description').value,
        is_active: document.getElementById('site-is-active').checked
    };

    if (!currentEditSiteId) {
        // 새 사업장 추가
        siteData.site_type = document.getElementById('site-type').value;
        siteData.parent_id = document.getElementById('site-parent-id').value || null;
    }

    try {
        const url = currentEditSiteId ? 
            `/api/admin/sites/${currentEditSiteId}` : 
            '/api/admin/sites';
        
        const method = currentEditSiteId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(siteData)
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                alert(currentEditSiteId ? '사업장이 수정되었습니다.' : '새 사업장이 추가되었습니다.');
                closeSiteModal();
                loadSitesTree();
            } else {
                alert('❌ ' + (result.message || '저장 중 오류가 발생했습니다.'));
            }
        } else {
            const errorText = await response.text();
            console.error('Server error:', errorText);
            alert(`❌ 서버 오류 (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('사업장 저장 실패:', error);
        alert('❌ 저장 중 오류가 발생했습니다: ' + error.message);
    }
}

// ===== 식자재 업로드 관련 함수들 =====

let selectedFiles = [];

// 업로드 섹션 표시/숨기기
function showUploadSection() {
    const uploadSection = document.getElementById('upload-section');
    const isVisible = uploadSection.style.display !== 'none';
    uploadSection.style.display = isVisible ? 'none' : 'block';
}

// 양식 다운로드
function downloadTemplate() {
    // 템플릿 파일 다운로드 로직
    const link = document.createElement('a');
    link.href = '/templates/ingredient_template.xlsx';
    link.download = '식자재_업로드_양식.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 파일 선택 이벤트 처리
document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.querySelector('.upload-area');
    
    if (fileInput && uploadArea) {
        // 파일 선택 이벤트
        fileInput.addEventListener('change', handleFileSelect);
        
        // 드래그 앤 드롭 이벤트
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('drop', handleDrop);
        uploadArea.addEventListener('dragleave', handleDragLeave);
    }
});

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    addFiles(files);
}

function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('dragover');
}

function handleDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');
    const files = Array.from(event.dataTransfer.files);
    addFiles(files);
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('dragover');
}

function addFiles(files) {
    // 파일 형식 검증
    const validFiles = files.filter(file => {
        const isValidType = file.type.includes('sheet') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB
        
        if (!isValidType) {
            alert(`${file.name}은(는) 지원하지 않는 파일 형식입니다.`);
            return false;
        }
        
        if (!isValidSize) {
            alert(`${file.name}은(는) 파일 크기가 10MB를 초과합니다.`);
            return false;
        }
        
        return true;
    });

    // 중복 파일 체크
    validFiles.forEach(file => {
        const isDuplicate = selectedFiles.some(selectedFile => 
            selectedFile.name === file.name && selectedFile.size === file.size
        );
        
        if (!isDuplicate) {
            selectedFiles.push(file);
        }
    });

    updateFileList();
    updateUploadButton();
}

function updateFileList() {
    const uploadText = document.querySelector('.upload-text h4');
    const uploadBtn = document.getElementById('upload-btn');
    
    if (selectedFiles.length > 0) {
        uploadText.textContent = `${selectedFiles.length}개 파일이 선택되었습니다`;
        uploadBtn.disabled = false;
    } else {
        uploadText.textContent = '파일을 선택하거나 여기로 드래그하세요';
        uploadBtn.disabled = true;
    }
}

function updateUploadButton() {
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.disabled = selectedFiles.length === 0;
}

function clearFiles() {
    selectedFiles = [];
    document.getElementById('file-input').value = '';
    updateFileList();
    updateUploadButton();
    hideResults();
}

function hideResults() {
    document.getElementById('upload-results').style.display = 'none';
}

// 파일 업로드 실행
async function uploadFiles() {
    if (selectedFiles.length === 0) {
        alert('업로드할 파일을 선택해주세요.');
        return;
    }

    const uploadProgress = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const uploadBtn = document.getElementById('upload-btn');

    // 업로드 시작
    uploadProgress.style.display = 'block';
    uploadBtn.disabled = true;
    
    let successCount = 0;
    let errorCount = 0;
    const results = [];

    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);

        try {
            // 진행률 업데이트
            const progress = ((i + 1) / selectedFiles.length) * 100;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `업로드 중... ${i + 1}/${selectedFiles.length} (${Math.round(progress)}%)`;

            const response = await fetch('/api/admin/upload-ingredients', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                successCount++;
                results.push({
                    fileName: file.name,
                    status: 'success',
                    message: `${result.processed_count}개 식자재 처리 완료`,
                    details: result.details || {}
                });
            } else {
                errorCount++;
                results.push({
                    fileName: file.name,
                    status: 'error',
                    message: result.message || '업로드 실패',
                    details: result.details || {}
                });
            }
        } catch (error) {
            console.error('파일 업로드 오류:', error);
            errorCount++;
            results.push({
                fileName: file.name,
                status: 'error',
                message: '서버 연결 오류',
                details: {}
            });
        }
    }

    // 업로드 완료
    uploadProgress.style.display = 'none';
    uploadBtn.disabled = false;
    
    // 결과 표시
    showUploadResults(successCount, errorCount, results);
    
    // 성공한 경우 식자재 목록 새로고침
    if (successCount > 0) {
        loadIngredientsList();
    }
}

function showUploadResults(successCount, errorCount, results) {
    document.getElementById('success-count').textContent = successCount;
    document.getElementById('error-count').textContent = errorCount;
    
    const resultDetails = document.getElementById('result-details');
    resultDetails.innerHTML = '';
    
    results.forEach(result => {
        const resultDiv = document.createElement('div');
        resultDiv.className = `result-file ${result.status}`;
        
        resultDiv.innerHTML = `
            <div class="file-name">${result.fileName}</div>
            <div class="file-status ${result.status}">
                <span>${result.status === 'success' ? '✓' : '✗'}</span>
                <span>${result.message}</span>
            </div>
        `;
        
        resultDetails.appendChild(resultDiv);
    });
    
    document.getElementById('upload-results').style.display = 'block';
}

// 식자재 목록 로드
async function loadIngredientsList() {
    try {
        const response = await fetch('/api/admin/ingredients');
        const result = await response.json();
        const ingredients = result.ingredients || result.data || [];
        
        const tbody = document.getElementById('ingredients-tbody');
        tbody.innerHTML = '';
        
        if (ingredients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #666;">등록된 식자재가 없습니다.</td></tr>';
            return;
        }
        
        ingredients.forEach(ingredient => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${ingredient.name}</td>
                <td>${ingredient.supplier_name || '-'}</td>
                <td>${ingredient.base_unit}</td>
                <td>${ingredient.price ? ingredient.price.toLocaleString() + '원' : '-'}</td>
                <td>${ingredient.moq || '1'}</td>
                <td>${new Date(ingredient.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn-small btn-primary" onclick="editIngredient(${ingredient.id})">수정</button>
                    <button class="btn-small btn-danger" onclick="deleteIngredient(${ingredient.id})">삭제</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('식자재 목록 로드 실패:', error);
        document.getElementById('ingredients-tbody').innerHTML = 
            '<tr><td colspan="7" style="text-align: center; color: #dc3545;">식자재 목록을 불러올 수 없습니다.</td></tr>';
    }
}

// 공급업체 필터 로드
async function loadSupplierFilter() {
    try {
        const response = await fetch('/api/admin/suppliers/enhanced');
        const result = await response.json();
        const suppliers = result.suppliers || result.data || [];
        
        const supplierFilter = document.getElementById('supplier-filter');
        supplierFilter.innerHTML = '<option value="">전체 업체</option>';
        
        suppliers.forEach(supplier => {
            const option = document.createElement('option');
            option.value = supplier.id;
            option.textContent = supplier.name;
            supplierFilter.appendChild(option);
        });
        
    } catch (error) {
        console.error('공급업체 목록 로드 실패:', error);
    }
}

// 식자재 수정 (추후 구현)
function editIngredient(ingredientId) {
    alert(`식자재 ID ${ingredientId} 수정 기능은 곧 구현될 예정입니다.`);
}

// 식자재 삭제 (추후 구현)
function deleteIngredient(ingredientId) {
    if (confirm('이 식자재를 삭제하시겠습니까?')) {
        alert(`식자재 ID ${ingredientId} 삭제 기능은 곧 구현될 예정입니다.`);
    }
}

// ===== 식수 등록 관리 관련 함수들 =====

// 식수 등록 페이지 초기화
function initMealCountsPage() {
    // 오늘 날짜를 기본값으로 설정
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('meal-count-date').value = today;
    document.getElementById('form-meal-date').value = today;
}

// 식수 데이터 로드
async function loadMealCounts() {
    try {
        const selectedDate = document.getElementById('meal-count-date').value;
        const url = selectedDate ? `/api/admin/meal-counts?date=${selectedDate}` : '/api/admin/meal-counts';
        
        const response = await fetch(url);
        const mealCounts = await response.json();
        
        updateMealCountsSummary(mealCounts);
        updateMealCountsTable(mealCounts);
        
    } catch (error) {
        console.error('식수 데이터 로드 실패:', error);
        document.getElementById('meal-counts-tbody').innerHTML = 
            '<tr><td colspan="8" style="text-align: center; color: #dc3545;">식수 데이터를 불러올 수 없습니다.</td></tr>';
    }
}

// 식수 현황 요약 업데이트
function updateMealCountsSummary(mealCounts) {
    let totalCount = 0;
    let totalCost = 0;
    let deliverySites = new Set();
    
    mealCounts.forEach(item => {
        totalCount += item.total_count || 0;
        totalCost += (item.target_material_cost || 0) * (item.total_count || 0);
        deliverySites.add(item.delivery_site);
    });
    
    document.getElementById('total-meal-count').textContent = `${totalCount.toLocaleString()}명`;
    document.getElementById('avg-material-cost').textContent = 
        totalCount > 0 ? `${Math.round(totalCost / totalCount).toLocaleString()}원` : '0원';
    document.getElementById('delivery-sites-count').textContent = `${deliverySites.size}개소`;
    document.getElementById('estimated-total-cost').textContent = `${totalCost.toLocaleString()}원`;
}

// 식수 데이터 테이블 업데이트
function updateMealCountsTable(mealCounts) {
    const tbody = document.getElementById('meal-counts-tbody');
    tbody.innerHTML = '';
    
    if (mealCounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #666;">등록된 식수 데이터가 없습니다.</td></tr>';
        return;
    }
    
    mealCounts.forEach((item, index) => {
        // 메인 행
        const mainRow = document.createElement('tr');
        mainRow.innerHTML = `
            <td class="delivery-site-cell" rowspan="${item.site_details.length + 1}">${item.delivery_site}</td>
            <td class="meal-type-cell" rowspan="${item.site_details.length + 1}">${item.meal_type}</td>
            <td class="cost-cell" rowspan="${item.site_details.length + 1}">${(item.target_material_cost || 0).toLocaleString()}원</td>
            <td class="count-cell" rowspan="${item.site_details.length + 1}">${(item.total_count || 0).toLocaleString()}명</td>
            <td colspan="3" style="background: #f0f8ff; font-weight: 500;">${item.menu_info || '-'}</td>
            <td rowspan="${item.site_details.length + 1}">
                <div class="btn-group">
                    <button class="btn-small btn-primary" onclick="editMealCount(${item.id})">수정</button>
                    <button class="btn-small btn-warning" onclick="duplicateMealCount(${item.id})">복사</button>
                </div>
            </td>
        `;
        tbody.appendChild(mainRow);
        
        // 사업장별 상세 행들
        item.site_details.forEach(site => {
            const detailRow = document.createElement('tr');
            detailRow.className = 'site-detail-row';
            detailRow.innerHTML = `
                <td>${site.site_name}</td>
                <td class="count-cell">${site.count}명</td>
                <td>${site.notes || '-'}</td>
            `;
            tbody.appendChild(detailRow);
        });
    });
}

// 식수 등록 모달 표시
function showAddMealCountModal() {
    document.getElementById('meal-count-modal-title').textContent = '식수 등록';
    document.getElementById('meal-count-form').reset();
    document.getElementById('meal-count-id').value = '';
    
    // 선택된 날짜를 폼에도 반영
    const selectedDate = document.getElementById('meal-count-date').value;
    document.getElementById('form-meal-date').value = selectedDate;
    
    document.getElementById('meal-count-modal').classList.remove('hidden');
}

// 식수 등록 모달 닫기
function closeMealCountModal() {
    document.getElementById('meal-count-modal').classList.add('hidden');
}

// 식수 데이터 저장
async function saveMealCount() {
    try {
        const formData = {
            meal_date: document.getElementById('form-meal-date').value,
            delivery_site: document.getElementById('form-delivery-site').value.trim(),
            meal_type: document.getElementById('form-meal-type').value,
            target_material_cost: parseInt(document.getElementById('form-target-cost').value) || 0,
            menu_info: document.getElementById('form-menu-info').value.trim(),
            site_counts: document.getElementById('form-site-counts').value.trim(),
            notes: document.getElementById('form-notes').value.trim()
        };

        // 유효성 검사
        if (!formData.meal_date || !formData.delivery_site || !formData.meal_type) {
            alert('필수 항목을 모두 입력해주세요.');
            return;
        }

        if (!formData.site_counts) {
            alert('사업장별 식수를 입력해주세요.');
            return;
        }

        const mealCountId = document.getElementById('meal-count-id').value;
        const url = mealCountId ? `/api/admin/meal-counts/${mealCountId}` : '/api/admin/meal-counts';
        const method = mealCountId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.success) {
            alert(mealCountId ? '식수 정보가 수정되었습니다.' : '식수 정보가 등록되었습니다.');
            closeMealCountModal();
            loadMealCounts();
        } else {
            alert(result.message || '저장 중 오류가 발생했습니다.');
        }
        
    } catch (error) {
        console.error('식수 데이터 저장 실패:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 식수 데이터 수정
async function editMealCount(mealCountId) {
    try {
        const response = await fetch(`/api/admin/meal-counts/${mealCountId}`);
        const mealCount = await response.json();
        
        if (mealCount) {
            document.getElementById('meal-count-modal-title').textContent = '식수 수정';
            document.getElementById('meal-count-id').value = mealCount.id;
            document.getElementById('form-meal-date').value = mealCount.meal_date;
            document.getElementById('form-delivery-site').value = mealCount.delivery_site;
            document.getElementById('form-meal-type').value = mealCount.meal_type;
            document.getElementById('form-target-cost').value = mealCount.target_material_cost;
            document.getElementById('form-menu-info').value = mealCount.menu_info || '';
            document.getElementById('form-notes').value = mealCount.notes || '';
            
            // 사업장별 식수 데이터 변환
            const siteCountsText = mealCount.site_details.map(site => 
                `${site.site_name}:${site.count}`
            ).join(',');
            document.getElementById('form-site-counts').value = siteCountsText;
            
            document.getElementById('meal-count-modal').classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('식수 데이터 로드 실패:', error);
        alert('식수 정보를 불러올 수 없습니다.');
    }
}

// 식수 데이터 복사
async function duplicateMealCount(mealCountId) {
    try {
        const response = await fetch(`/api/admin/meal-counts/${mealCountId}`);
        const mealCount = await response.json();
        
        if (mealCount) {
            document.getElementById('meal-count-modal-title').textContent = '식수 복사 등록';
            document.getElementById('meal-count-id').value = ''; // 새로운 등록이므로 ID 비움
            
            // 오늘 날짜로 설정
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('form-meal-date').value = today;
            
            document.getElementById('form-delivery-site').value = mealCount.delivery_site;
            document.getElementById('form-meal-type').value = mealCount.meal_type;
            document.getElementById('form-target-cost').value = mealCount.target_material_cost;
            document.getElementById('form-menu-info').value = mealCount.menu_info || '';
            document.getElementById('form-notes').value = '';
            
            // 사업장별 식수 데이터 변환
            const siteCountsText = mealCount.site_details.map(site => 
                `${site.site_name}:${site.count}`
            ).join(',');
            document.getElementById('form-site-counts').value = siteCountsText;
            
            document.getElementById('meal-count-modal').classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('식수 데이터 로드 실패:', error);
        alert('식수 정보를 불러올 수 없습니다.');
    }
}

// 식수 데이터 새로고침
function refreshMealCounts() {
    loadMealCounts();
}

// 발주서 출력 (추후 구현)
function exportMealCounts() {
    alert('발주서 출력 기능은 곧 구현될 예정입니다.');
}

// 날짜 변경 이벤트
document.addEventListener('DOMContentLoaded', function() {
    const mealCountDateInput = document.getElementById('meal-count-date');
    if (mealCountDateInput) {
        mealCountDateInput.addEventListener('change', loadMealCounts);
    }
});

// ===================
// 사용자 관리 확장 기능
// ===================

// 사용자 비밀번호 초기화
async function resetPassword(userId) {
    if (!confirm('이 사용자의 비밀번호를 초기화하시겠습니까?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`비밀번호가 초기화되었습니다.\n새 비밀번호: ${result.new_password}\n사용자에게 새 비밀번호를 전달해주세요.`);
        } else {
            alert('비밀번호 초기화에 실패했습니다.');
        }
    } catch (error) {
        console.error('비밀번호 초기화 오류:', error);
        alert('비밀번호 초기화 중 오류가 발생했습니다.');
    }
}

// 사용자 활성 상태 토글
async function toggleUserStatus(userId, newStatus) {
    const statusText = newStatus ? '활성화' : '비활성화';
    if (!confirm(`이 사용자를 ${statusText}하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`사용자가 ${statusText}되었습니다.`);
            loadUsers(); // 목록 새로고침
        } else {
            alert('상태 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('상태 변경 중 오류가 발생했습니다.');
    }
}

// 사업장 관리 모달 표시
async function manageSites(userId) {
    try {
        // 사용자 사업장 정보 가져오기
        const response = await fetch(`/api/admin/users/${userId}/sites`);
        const data = await response.json();
        
        // 모든 사업장 체크박스 생성
        const sitesList = document.getElementById('sites-list');
        sitesList.innerHTML = '';
        
        data.all_sites.forEach(site => {
            const isAssigned = data.assigned_site_ids.includes(site.id);
            const siteDiv = document.createElement('div');
            siteDiv.innerHTML = `
                <label class="checkbox-label" style="margin-bottom: 5px;">
                    <input type="checkbox" 
                           value="${site.id}" 
                           ${isAssigned ? 'checked' : ''} 
                           onchange="updateSitesAllStatus()">
                    ${site.name} (${site.location})
                </label>
            `;
            sitesList.appendChild(siteDiv);
        });
        
        // 전체 선택 체크박스 상태 업데이트
        updateSitesAllStatus();
        
        // 모달에 사용자 ID 저장
        document.getElementById('user-sites-container').setAttribute('data-user-id', userId);
        
        // 사업장 관리 모달 표시
        showSitesModal();
        
    } catch (error) {
        console.error('사업장 정보 로드 오류:', error);
        alert('사업장 정보를 불러올 수 없습니다.');
    }
}

// 사업장 관리 모달 표시 함수
function showSitesModal() {
    // 간단한 모달 HTML 생성 (기존 모달 재사용할 수도 있음)
    const modalHtml = `
        <div id="sites-modal" class="modal" style="display: block;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>사업장 접근 권한 관리</h3>
                    <button class="modal-close" onclick="closeSitesModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>접근 가능한 사업장</label>
                        <div id="user-sites-container-modal" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                            <label class="checkbox-label" style="margin-bottom: 10px;">
                                <input type="checkbox" id="sites-all-modal" onchange="toggleAllSitesModal(this)">
                                <strong>모든 사업장</strong>
                            </label>
                            <div id="sites-list-modal">
                                ${document.getElementById('sites-list').innerHTML}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="saveSitesAssignment()">저장</button>
                    <button class="btn-secondary" onclick="closeSitesModal()">취소</button>
                </div>
            </div>
        </div>
    `;
    
    // 기존 모달 제거 후 새 모달 추가
    const existingModal = document.getElementById('sites-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// 사업장 모달 닫기
function closeSitesModal() {
    const modal = document.getElementById('sites-modal');
    if (modal) {
        modal.remove();
    }
}

// 모든 사업장 선택/해제
function toggleAllSites(checkbox) {
    const sitesList = document.getElementById('sites-list');
    const siteCheckboxes = sitesList.querySelectorAll('input[type="checkbox"]');
    
    siteCheckboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
}

// 모든 사업장 선택/해제 (모달용)
function toggleAllSitesModal(checkbox) {
    const sitesList = document.getElementById('sites-list-modal');
    const siteCheckboxes = sitesList.querySelectorAll('input[type="checkbox"]');
    
    siteCheckboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
}

// 전체 선택 상태 업데이트
function updateSitesAllStatus() {
    const sitesList = document.getElementById('sites-list');
    const allCheckbox = document.getElementById('sites-all');
    
    if (!sitesList || !allCheckbox) return;
    
    const siteCheckboxes = sitesList.querySelectorAll('input[type="checkbox"]');
    const checkedCount = Array.from(siteCheckboxes).filter(cb => cb.checked).length;
    
    allCheckbox.checked = checkedCount === siteCheckboxes.length && siteCheckboxes.length > 0;
}

// 사업장 할당 저장
async function saveSitesAssignment() {
    const userId = document.getElementById('user-sites-container').getAttribute('data-user-id');
    const sitesList = document.getElementById('sites-list-modal');
    const checkedSites = Array.from(sitesList.querySelectorAll('input[type="checkbox"]:checked'))
                               .map(cb => parseInt(cb.value));
    
    try {
        const response = await fetch(`/api/admin/users/${userId}/sites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_ids: checkedSites })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('사업장 할당이 저장되었습니다.');
            closeSitesModal();
            loadUsers(); // 목록 새로고침
        } else {
            alert('사업장 할당 저장에 실패했습니다.');
        }
    } catch (error) {
        console.error('사업장 할당 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 데이터베이스 확장 초기화
async function initUserExtensions() {
    if (!confirm('사용자 관리 기능을 확장하시겠습니까? (데이터베이스 업데이트)')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/init_user_extensions', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('사용자 관리 기능이 확장되었습니다.\n페이지를 새로고침합니다.');
            window.location.reload();
        } else {
            alert('기능 확장에 실패했습니다.');
        }
    } catch (error) {
        console.error('기능 확장 오류:', error);
        alert('기능 확장 중 오류가 발생했습니다.');
    }
}

// ===========================================
// 공급업체 관리 확장 기능
// ===========================================

// 탭 전환 함수들
function showIngredientTab() {
    document.getElementById('ingredient-tab-content').classList.remove('hidden');
    
    // 탭 버튼 스타일 변경
    const tabButton = document.querySelector('.tab-button');
    if (tabButton) {
        tabButton.style.borderBottomColor = '#007bff';
        tabButton.style.backgroundColor = '#f8f9fa';
    }
}


// 공급업체 기능 확장 초기화
async function initSupplierExtensions() {
    if (!confirm('공급업체 관리 기능을 확장하시겠습니까? (데이터베이스 업데이트)')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/init_supplier_extensions', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(result.message + '\n페이지를 새로고침합니다.');
            window.location.reload();
        } else {
            alert('기능 확장에 실패했습니다: ' + result.message);
        }
    } catch (error) {
        console.error('기능 확장 오류:', error);
        alert('기능 확장 중 오류가 발생했습니다.');
    }
}

// 공급업체 관리 변수들
let currentSupplierPage = 1;
let totalSupplierPages = 1;
let currentEditSupplierId = null;

// 공급업체 목록 로드
async function loadSuppliers() {
    try {
        const search = document.getElementById('supplier-search')?.value || '';
        const page = currentSupplierPage || 1;
        const response = await fetch(`/api/admin/suppliers/enhanced?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
        const data = await response.json();
        
        if (data.suppliers) {
            displaySuppliers(data.suppliers);
            updateSupplierPagination(data.page, data.total_pages);
        }
    } catch (error) {
        console.error('공급업체 목록 로드 실패:', error);
        document.getElementById('suppliers-table-body').innerHTML = 
            '<tr><td colspan="11">공급업체 목록을 불러올 수 없습니다.</td></tr>';
    }
}

// 공급업체 목록 표시
function displaySuppliers(suppliers) {
    const tbody = document.getElementById('suppliers-table-body');
    
    if (!suppliers || suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11">등록된 공급업체가 없습니다.</td></tr>';
        return;
    }
    
    tbody.innerHTML = suppliers.map(supplier => `
        <tr>
            <td><strong>${supplier.parent_code || '-'}</strong></td>
            <td><strong>${supplier.site_code || '-'}</strong></td>
            <td>${supplier.site_name || '-'}</td>
            <td><strong>${supplier.name || '-'}</strong></td>
            <td>${supplier.phone || supplier.contact || '-'}</td>
            <td>${supplier.email || '-'}</td>
            <td><span class="${supplier.is_active ? 'status-active' : 'status-inactive'}">
                ${supplier.is_active ? '거래중' : '중단'}
            </span></td>
            <td>${supplier.business_number || '-'}</td>
            <td>${supplier.representative || '-'}</td>
            <td>${supplier.manager_name || '-'}</td>
            <td>
                <button class="btn-small btn-edit" onclick="editSupplier(${supplier.id})" style="background: #28a745; margin-right: 5px;">수정</button>
                <button class="btn-small btn-toggle" onclick="toggleSupplierStatus(${supplier.id}, ${!supplier.is_active})" 
                        style="background: ${supplier.is_active ? '#dc3545' : '#17a2b8'}; margin-right: 5px;">
                    ${supplier.is_active ? '중단' : '재개'}
                </button>
                <button class="btn-small btn-delete" onclick="deleteSupplier(${supplier.id})" style="background: #6c757d;">삭제</button>
            </td>
        </tr>
    `).join('');
}

// 공급업체 페이지네이션 업데이트
function updateSupplierPagination(currentPage, totalPages) {
    currentSupplierPage = currentPage;
    totalSupplierPages = totalPages;
    const pageInfoElement = document.getElementById('supplier-page-info');
    if (pageInfoElement) {
        pageInfoElement.textContent = `${currentPage} / ${totalPages}`;
    }
}

// 공급업체 페이지 변경
function changeSupplierPage(direction) {
    const newPage = currentSupplierPage + direction;
    if (newPage >= 1 && newPage <= totalSupplierPages) {
        currentSupplierPage = newPage;
        loadSuppliers();
    }
}

// 공급업체 검색
function searchSuppliers() {
    currentSupplierPage = 1;
    loadSuppliers();
}

// 공급업체 추가 모달 표시
function showAddSupplierModal() {
    currentEditSupplierId = null;
    document.getElementById('supplier-modal-title').textContent = '새 업체 등록';
    clearSupplierForm();
    document.getElementById('supplier-modal').classList.remove('hidden');
}

// 공급업체 수정 모달 표시
async function editSupplier(supplierId) {
    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}/detail`);
        const result = await response.json();
        const supplier = result.supplier || result;
        
        if (!response.ok) {
            throw new Error('공급업체 정보를 불러올 수 없습니다.');
        }
        
        currentEditSupplierId = supplierId;
        document.getElementById('supplier-modal-title').textContent = '업체 정보 수정';
        
        // 폼에 데이터 채우기
        document.getElementById('supplier-name').value = supplier.name || '';
        document.getElementById('supplier-parent-code').value = supplier.parent_code || '';
        document.getElementById('supplier-site-code').value = supplier.site_code || '';
        document.getElementById('supplier-site-name').value = supplier.site_name || '';
        document.getElementById('supplier-representative').value = supplier.representative || '';
        document.getElementById('supplier-contact').value = supplier.contact || '';
        document.getElementById('supplier-phone').value = supplier.phone || '';
        document.getElementById('supplier-fax').value = supplier.fax || '';
        document.getElementById('supplier-email').value = supplier.email || '';
        document.getElementById('supplier-address').value = supplier.address || '';
        document.getElementById('supplier-business-number').value = supplier.business_number || '';
        document.getElementById('supplier-business-type').value = supplier.business_type || '';
        document.getElementById('supplier-business-item').value = supplier.business_item || '';
        document.getElementById('supplier-manager-name').value = supplier.manager_name || '';
        document.getElementById('supplier-manager-phone').value = supplier.manager_phone || '';
        document.getElementById('supplier-update-frequency').value = supplier.update_frequency || 'weekly';
        document.getElementById('supplier-is-active').checked = supplier.is_active !== false;
        document.getElementById('supplier-notes').value = supplier.notes || '';
        
        document.getElementById('supplier-modal').classList.remove('hidden');
        
    } catch (error) {
        console.error('공급업체 정보 로드 오류:', error);
        alert('공급업체 정보를 불러올 수 없습니다.');
    }
}

// 공급업체 폼 초기화
function clearSupplierForm() {
    document.getElementById('supplier-form').reset();
    document.getElementById('supplier-is-active').checked = true;
}

// 공급업체 저장
async function saveSupplier() {
    const supplierData = {
        name: document.getElementById('supplier-name').value.trim(),
        parent_code: document.getElementById('supplier-parent-code').value.trim(),
        site_code: document.getElementById('supplier-site-code').value.trim(),
        site_name: document.getElementById('supplier-site-name').value.trim(),
        representative: document.getElementById('supplier-representative').value,
        contact: document.getElementById('supplier-contact').value,
        phone: document.getElementById('supplier-phone').value.trim(),
        fax: document.getElementById('supplier-fax').value,
        email: document.getElementById('supplier-email').value.trim(),
        address: document.getElementById('supplier-address').value.trim(),
        business_number: document.getElementById('supplier-business-number').value,
        business_type: document.getElementById('supplier-business-type').value,
        business_item: document.getElementById('supplier-business-item').value,
        manager_name: document.getElementById('supplier-manager-name').value,
        manager_phone: document.getElementById('supplier-manager-phone').value,
        update_frequency: document.getElementById('supplier-update-frequency').value,
        is_active: document.getElementById('supplier-is-active').checked,
        notes: document.getElementById('supplier-notes').value
    };
    
    // 필수 필드 검증
    const parentCode = document.getElementById('supplier-parent-code').value.trim();
    const siteName = document.getElementById('supplier-site-name').value.trim();
    const siteCode = document.getElementById('supplier-site-code').value.trim();
    
    
    if (!supplierData.name) {
        alert('식자재업체명은 필수입니다.');
        return;
    }
    
    if (!supplierData.address) {
        alert('주소는 필수입니다.');
        return;
    }
    
    if (!supplierData.phone && !supplierData.email) {
        alert('연락처 또는 이메일 중 하나는 반드시 입력해야 합니다.');
        return;
    }
    
    // 새로운 필드 추가
    supplierData.parent_code = parentCode;
    supplierData.site_name = siteName;
    supplierData.site_code = siteCode;
    
    try {
        const url = currentEditSupplierId 
            ? `/api/admin/suppliers/${currentEditSupplierId}/update`
            : '/api/admin/suppliers/create';
        const method = currentEditSupplierId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(supplierData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(currentEditSupplierId ? '업체 정보가 수정되었습니다.' : '새 업체가 등록되었습니다.');
            closeSupplierModal();
            loadSuppliers();
        } else {
            alert('저장에 실패했습니다: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('공급업체 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 공급업체 거래 상태 토글
async function toggleSupplierStatus(supplierId, newStatus) {
    const statusText = newStatus ? '거래를 재개' : '거래를 중단';
    if (!confirm(`이 업체와의 ${statusText}하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`업체 거래 상태가 변경되었습니다.`);
            loadSuppliers();
        } else {
            alert('상태 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('상태 변경 오류:', error);
        alert('상태 변경 중 오류가 발생했습니다.');
    }
}

// 공급업체 삭제
async function deleteSupplier(supplierId) {
    if (!confirm('이 업체를 삭제하시겠습니까?\n연관된 식자재가 있는 경우 삭제되지 않습니다.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}/delete`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('업체가 삭제되었습니다.');
            loadSuppliers();
        } else {
            alert(result.message || '삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('업체 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 공급업체 모달 닫기
function closeSupplierModal() {
    document.getElementById('supplier-modal').classList.add('hidden');
    currentEditSupplierId = null;
}

// 자코드 자동 생성 함수
async function suggestSiteCode() {
    const parentCode = document.getElementById('supplier-parent-code').value.trim();
    if (!parentCode) {
        document.getElementById('supplier-site-code').value = '';
        return;
    }
    
    try {
        // 기존 자코드들 조회
        const response = await fetch(`/api/admin/suppliers/enhanced?search=${parentCode}`);
        const result = await response.json();
        
        if (result.success && result.suppliers) {
            const existingSiteCodes = result.suppliers
                .filter(s => s.parent_code === parentCode)
                .map(s => s.site_code)
                .filter(code => code && code.includes('-'));
            
            // 다음 순번 계산
            let nextNumber = 1;
            if (existingSiteCodes.length > 0) {
                const numbers = existingSiteCodes.map(code => {
                    const parts = code.split('-');
                    return parseInt(parts[parts.length - 1]) || 0;
                });
                nextNumber = Math.max(...numbers) + 1;
            }
            
            // 자코드 자동 생성
            const suggestedCode = `${parentCode}-${String(nextNumber).padStart(2, '0')}`;
            document.getElementById('supplier-site-code').value = suggestedCode;
            
            // 기존 사업장 정보 표시 (existing-sites-info 요소가 있는 경우에만)
            const infoElement = document.getElementById('existing-sites-info');
            if (infoElement && existingSiteCodes.length > 0) {
                infoElement.innerHTML = 
                    `<span style="color: #28a745;">기존 사업장 ${existingSiteCodes.length}개 | 신규: ${suggestedCode}</span>`;
            }
        } else {
            // 첫 번째 자코드
            const suggestedCode = `${parentCode}-01`;
            document.getElementById('supplier-site-code').value = suggestedCode;
        }
    } catch (error) {
        console.error('자코드 생성 오류:', error);
        // 오류 시 기본 자코드 생성
        const suggestedCode = `${parentCode}-01`;
        document.getElementById('supplier-site-code').value = suggestedCode;
    }
}

// 자코드 직접 수정 기능
function editSiteCode() {
    const siteCodeInput = document.getElementById('supplier-site-code');
    if (siteCodeInput.readOnly) {
        siteCodeInput.readOnly = false;
        siteCodeInput.style.backgroundColor = '#ffffff';
        siteCodeInput.focus();
    }
}

// ===== 통합 식단표 관리 관련 함수들 =====

// 식단표 탭 전환
function showMealPlanTab(tabName) {
    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 모든 탭 컨텐츠 숨김
    document.querySelectorAll('.meal-plan-tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });
    
    // 선택된 탭 활성화
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const activeTab = document.getElementById(`${tabName}-tab`);
    if (activeTab) activeTab.classList.remove('hidden');
    
    // 탭별 초기화 로직
    if (tabName === 'master') {
        loadMasterMealPlans();
    } else if (tabName === 'batch') {
        initializeBatchTab();
    }
}

// 마스터 식단표 목록 로드
function loadMasterMealPlans() {
    const listContainer = document.getElementById('master-meal-plan-list');
    if (listContainer) {
        listContainer.innerHTML = `
            <div style="display: grid; gap: 15px;">
                <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h4>🍱 도시락 마스터 식단표</h4>
                            <p style="color: #666; margin: 5px 0;">2025년 9월 2주차</p>
                        </div>
                        <div>
                            <button onclick="editMasterMealPlan('dosirak')" style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px;">편집</button>
                        </div>
                    </div>
                </div>
                
                <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h4>🚚 운반 마스터 식단표</h4>
                            <p style="color: #666; margin: 5px 0;">2025년 9월 2주차</p>
                        </div>
                        <div>
                            <button onclick="editMasterMealPlan('transport')" style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px;">편집</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// 일괄 탭 초기화
function initializeBatchTab() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekLater = new Date(today);
    weekLater.setDate(today.getDate() + 31);
    const weekLaterStr = weekLater.toISOString().split('T')[0];
    
    const startDateEl = document.getElementById('batch-start-date');
    const endDateEl = document.getElementById('batch-end-date');
    if (startDateEl) startDateEl.value = todayStr;
    if (endDateEl) endDateEl.value = weekLaterStr;
}

// 식단표 유형별 관리
function manageMealPlanType(type) {
    const typeNames = {
        'dosirak': '도시락',
        'transport': '운반',
        'school': '학교',
        'care': '요양원'
    };
    alert(`${typeNames[type]} 식단표 관리 기능을 구현 중입니다.`);
}

// 마스터 식단표 생성
function createMasterMealPlan() {
    alert('마스터 식단표 생성 기능을 구현 중입니다.');
}

// 마스터 식단표 편집
function editMasterMealPlan(type) {
    window.open('meal_plan_management.html', '_blank');
}

// 지시서 생성 함수들
function generatePreprocessingInstruction() {
    alert('전처리 지시서 일괄 생성 기능을 구현 중입니다.');
}

function generateCookingInstruction() {
    alert('조리 지시서 일괄 생성 기능을 구현 중입니다.');
}

function generatePortionInstruction() {
    alert('소분 지시서 일괄 생성 기능을 구현 중입니다.');
}

function generateAllInstructions() {
    const dateSelect = document.getElementById('instruction-date-select');
    const selectedDate = dateSelect ? dateSelect.value : '';
    
    if (!selectedDate || selectedDate === '생성할 날짜 선택') {
        alert('생성할 날짜를 선택해주세요.');
        return;
    }
    
    if (confirm(`${selectedDate}에 대한 모든 지시서(전처리, 조리, 소분)를 일괄 생성하시겠습니까?`)) {
        alert('모든 지시서 일괄 생성 기능을 구현 중입니다.');
    }
}

// 일괄 생성 함수들
function batchGenerateMealPlans() {
    const startDate = document.getElementById('batch-start-date')?.value;
    const endDate = document.getElementById('batch-end-date')?.value;
    const targetType = document.getElementById('batch-target-type')?.value;
    
    if (!startDate || !endDate) {
        alert('시작일과 종료일을 모두 선택해주세요.');
        return;
    }
    
    const typeNames = {
        'all': '전체',
        'dosirak': '도시락',
        'transport': '운반',
        'school': '학교',
        'care': '요양원'
    };
    
    if (confirm(`${startDate}부터 ${endDate}까지 ${typeNames[targetType]} 식단표를 일괄 생성하시겠습니까?`)) {
        alert('일괄 생성 기능을 구현 중입니다.');
    }
}

function createFromTemplate() {
    alert('템플릿 기반 생성 기능을 구현 중입니다.');
}

function showWeeklyMealPlans() {
    alert('주간 식단표 보기 기능을 구현 중입니다.');
}

// 단가관리 관련 함수들
let pricingData = [];

async function loadPricingCustomers() {
    try {
        const response = await fetch('/api/customers');
        const result = await response.json();
        const customers = result.customers || result.data || [];
        
        const select = document.getElementById('pricing-customer-select');
        select.innerHTML = '<option value="">사업장 선택</option>';
        
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = customer.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('사업장 목록 로드 실패:', error);
        alert('사업장 목록을 불러오는데 실패했습니다.');
    }
}

async function loadPricingData() {
    const customerId = document.getElementById('pricing-customer-select').value;
    const mealTypeFilter = document.getElementById('pricing-meal-type-filter').value;
    
    if (!customerId) {
        alert('사업장을 선택해주세요.');
        return;
    }

    try {
        // 해당 사업장의 식단표 목록을 가져와서 단가 정보 생성
        const response = await fetch(`/api/diet-plans?customer_id=${customerId}`);
        const dietPlans = await response.json();
        
        // 단가 정보 테이블 생성
        const tableBody = document.getElementById('pricing-table-body');
        tableBody.innerHTML = '';
        
        if (dietPlans.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="padding: 40px; text-align: center; color: #666;">
                        해당 사업장에 식단표가 없습니다. 먼저 식단표를 생성해주세요.
                    </td>
                </tr>
            `;
            return;
        }

        pricingData = [];
        
        // 식단표별로 아침, 점심, 저녁에 대한 단가 정보 생성
        dietPlans.forEach(plan => {
            ['아침', '점심', '저녁'].forEach(mealTime => {
                if (mealTypeFilter === 'all' || plan.meal_type === mealTypeFilter) {
                    const pricingItem = {
                        customer_name: plan.customer_name,
                        meal_type: plan.meal_type,
                        meal_time: mealTime,
                        sales_price: '',
                        target_cost: '',
                        profit_margin: 0,
                        updated_date: ''
                    };
                    
                    pricingData.push(pricingItem);
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${plan.customer_name}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${plan.meal_type}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${mealTime}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                            <input type="number" class="pricing-input sales-price" 
                                   style="width: 80px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: right;"
                                   placeholder="0" data-index="${pricingData.length - 1}" onchange="updateProfitMargin(this)">
                        </td>
                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                            <input type="number" class="pricing-input target-cost" 
                                   style="width: 80px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: right;"
                                   placeholder="0" data-index="${pricingData.length - 1}" onchange="updateProfitMargin(this)">
                        </td>
                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                            <span class="profit-margin" data-index="${pricingData.length - 1}" style="font-weight: bold;">-</span>
                        </td>
                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center; color: #666;">
                            <span class="updated-date" data-index="${pricingData.length - 1}">-</span>
                        </td>
                    `;
                    tableBody.appendChild(row);
                }
            });
        });
        
        updatePricingSummary();
        
    } catch (error) {
        console.error('단가 정보 로드 실패:', error);
        alert('단가 정보를 불러오는데 실패했습니다.');
    }
}

function updateProfitMargin(input) {
    const index = input.dataset.index;
    const row = input.closest('tr');
    const salesPriceInput = row.querySelector('.sales-price');
    const targetCostInput = row.querySelector('.target-cost');
    const profitMarginSpan = row.querySelector('.profit-margin');
    
    const salesPrice = parseFloat(salesPriceInput.value) || 0;
    const targetCost = parseFloat(targetCostInput.value) || 0;
    
    if (salesPrice > 0 && targetCost > 0) {
        const margin = ((salesPrice - targetCost) / salesPrice * 100).toFixed(1);
        profitMarginSpan.textContent = margin + '%';
        profitMarginSpan.style.color = margin > 0 ? '#27ae60' : '#e74c3c';
        
        // 데이터 업데이트
        if (pricingData[index]) {
            pricingData[index].sales_price = salesPrice;
            pricingData[index].target_cost = targetCost;
            pricingData[index].profit_margin = parseFloat(margin);
        }
    } else {
        profitMarginSpan.textContent = '-';
        profitMarginSpan.style.color = '#666';
    }
    
    updatePricingSummary();
}

function updatePricingSummary() {
    const validItems = pricingData.filter(item => item.sales_price > 0 && item.target_cost > 0);
    const totalItems = validItems.length;
    
    if (totalItems === 0) {
        document.getElementById('total-items').textContent = '0';
        document.getElementById('avg-price').textContent = '0원';
        document.getElementById('avg-cost').textContent = '0원';
        document.getElementById('avg-margin').textContent = '0%';
        return;
    }
    
    const avgPrice = Math.round(validItems.reduce((sum, item) => sum + item.sales_price, 0) / totalItems);
    const avgCost = Math.round(validItems.reduce((sum, item) => sum + item.target_cost, 0) / totalItems);
    const avgMargin = (validItems.reduce((sum, item) => sum + item.profit_margin, 0) / totalItems).toFixed(1);
    
    document.getElementById('total-items').textContent = totalItems;
    document.getElementById('avg-price').textContent = avgPrice.toLocaleString() + '원';
    document.getElementById('avg-cost').textContent = avgCost.toLocaleString() + '원';
    document.getElementById('avg-margin').textContent = avgMargin + '%';
}

async function savePricingData() {
    const validItems = pricingData.filter(item => item.sales_price > 0 && item.target_cost > 0);
    
    if (validItems.length === 0) {
        alert('저장할 데이터가 없습니다. 판매가와 목표 재료비를 입력해주세요.');
        return;
    }
    
    try {
        // 실제로는 서버에 저장하는 API를 호출해야 하지만, 현재는 로컬 저장소에 저장
        localStorage.setItem('pricingData', JSON.stringify(validItems));
        
        // 수정일 업데이트
        const currentDate = new Date().toLocaleDateString('ko-KR');
        document.querySelectorAll('.updated-date').forEach((span, index) => {
            if (pricingData[index] && pricingData[index].sales_price > 0) {
                span.textContent = currentDate;
                pricingData[index].updated_date = currentDate;
            }
        });
        
        alert(`${validItems.length}개의 단가 정보가 저장되었습니다.`);
        
    } catch (error) {
        console.error('단가 정보 저장 실패:', error);
        alert('단가 정보 저장에 실패했습니다.');
    }
}

// 페이지 로드 시 단가관리용 사업장 목록 로드
document.addEventListener('DOMContentLoaded', function() {
    // 단가관리 페이지가 표시될 때 사업장 목록 로드
    const pricingPage = document.getElementById('pricing-page');
    if (pricingPage) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'class') {
                    if (!pricingPage.classList.contains('hidden')) {
                        loadPricingCustomers();
                    }
                }
            });
        });
        observer.observe(pricingPage, { attributes: true });
    }

    // 협력업체 매핑 페이지가 표시될 때 데이터 로드
    const mappingPage = document.getElementById('supplier-mapping-page');
    if (mappingPage) {
        const mappingObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'class') {
                    if (!mappingPage.classList.contains('hidden')) {
                        loadSupplierMappingPage();
                    }
                }
            });
        });
        mappingObserver.observe(mappingPage, { attributes: true });
    }
});

// ============================
// 협력업체 매핑 관리 관련 함수들
// ============================

let mappingData = [];
let customersData = [];
let suppliersData = [];

// 매핑 페이지 로드
async function loadSupplierMappingPage() {
    try {
        // 병렬로 데이터 로드
        await Promise.all([
            loadMappingData(),
            loadCustomersForMapping(),
            loadSuppliersForMapping()
        ]);
        
        // 필터 옵션 업데이트
        updateMappingFilters();
        
        // 통계 업데이트
        updateMappingStats();
        
    } catch (error) {
        console.error('매핑 페이지 로드 오류:', error);
    }
}

// 매핑 데이터 로드
async function loadMappingData() {
    try {
        console.log('매핑 데이터 로드 시작...');
        const response = await fetch('/api/admin/customer-supplier-mappings');
        const result = await response.json();
        console.log('매핑 API 응답:', result);
        
        if (result.success) {
            mappingData = result.mappings || [];
            console.log('매핑 데이터 설정됨:', mappingData.length, '개');
            displayMappings(mappingData);
        } else {
            console.error('매핑 데이터 로드 실패:', result.message);
            mappingData = [];
        }
    } catch (error) {
        console.error('매핑 데이터 로드 오류:', error);
        mappingData = [];
        displayMappings([]);
    }
}

// 사업장 데이터 로드 (매핑용)
async function loadCustomersForMapping() {
    try {
        const response = await fetch('/api/admin/sites');
        const result = await response.json();
        customersData = result.sites || [];
    } catch (error) {
        console.error('사업장 데이터 로드 오류:', error);
        customersData = [];
    }
}

// 협력업체 데이터 로드 (매핑용)
async function loadSuppliersForMapping() {
    try {
        const response = await fetch('/api/admin/suppliers/enhanced');
        const result = await response.json();
        if (result.success) {
            suppliersData = result.suppliers || [];
        } else {
            suppliersData = [];
        }
    } catch (error) {
        console.error('협력업체 데이터 로드 오류:', error);
        suppliersData = [];
    }
}

// 매핑 데이터 표시
function displayMappings(mappings) {
    console.log('displayMappings 호출됨, 매핑 개수:', mappings ? mappings.length : 0);
    console.log('첫 번째 매핑 데이터:', mappings && mappings[0] ? mappings[0] : null);
    
    const tbody = document.getElementById('mappings-table-body');
    
    if (!mappings || mappings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="no-data">매핑 데이터가 없습니다.</td></tr>';
        return;
    }

    console.log('customersData 길이:', customersData ? customersData.length : 'undefined');
    console.log('suppliersData 길이:', suppliersData ? suppliersData.length : 'undefined');
    
    tbody.innerHTML = mappings.map(mapping => {
        const customer = customersData.find(c => c.id === mapping.customer_id);
        const supplier = suppliersData.find(s => s.id === mapping.supplier_id);
        
        console.log(`매핑 ID ${mapping.id}: 고객 ${customer ? customer.name : '없음'}, 협력업체 ${supplier ? supplier.name : '없음'}`);
        
        return `
            <tr>
                <td>${mapping.id}</td>
                <td>${customer ? customer.name : '삭제된 사업장'}</td>
                <td>${customer ? customer.site_code || '-' : '-'}</td>
                <td>
                    ${customer ? `<span class="status-badge ${customer.is_active !== false ? 'status-active' : 'status-inactive'}">
                        ${customer.is_active !== false ? '운영중' : '중단'}
                    </span>` : '<span class="status-badge status-inactive">삭제됨</span>'}
                </td>
                <td>${supplier ? supplier.name : '삭제된 업체'}</td>
                <td>${supplier ? supplier.parent_code || '-' : '-'}</td>
                <td><strong>${mapping.delivery_code || '-'}</strong></td>
                <td>${mapping.priority_order || '-'}</td>
                <td>
                    <span class="status-badge ${mapping.is_primary_supplier ? 'status-active' : 'status-inactive'}">
                        ${mapping.is_primary_supplier ? '주요' : '일반'}
                    </span>
                </td>
                <td>${mapping.contract_start_date || '-'}</td>
                <td>${mapping.contract_end_date || '-'}</td>
                <td>
                    <span class="status-badge ${mapping.is_active ? 'status-active' : 'status-inactive'}">
                        ${mapping.is_active ? '활성' : '비활성'}
                    </span>
                </td>
                <td>
                    ${customer ? 
                        '<div style="display: flex; gap: 4px; justify-content: center;">' +
                            '<button onclick="editBusinessLocation(' + customer.id + ')" class="btn-edit" title="사업장 편집" style="margin: 2px; padding: 4px 8px;">' +
                                '<i class="fas fa-edit"></i>' +
                            '</button>' +
                            (customer.is_active !== false ? 
                                '<button onclick="deleteBusinessLocation(' + customer.id + ')" class="btn-delete" title="사업장 삭제" style="margin: 2px; padding: 4px 8px;">' +
                                    '<i class="fas fa-trash"></i>' +
                                '</button>' : 
                                '<button onclick="restoreBusinessLocation(' + customer.id + ')" class="btn-success" title="사업장 복원" style="margin: 2px; padding: 4px 8px; background: #28a745; color: white;">' +
                                    '<i class="fas fa-undo"></i>' +
                                '</button>'
                            ) +
                        '</div>'
                    : '<button onclick="cleanupOrphanedMapping(' + mapping.id + ', ' + mapping.customer_id + ')" class="btn-warning" title="고아 매핑 정리" style="margin: 2px; background: #ffc107; color: #212529;">' +
                        '<i class="fas fa-broom"></i> 정리' +
                    '</button>'}
                </td>
                <td>
                    <button onclick="editMapping(${mapping.id})" class="btn-edit" title="매핑 수정" style="margin: 2px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteMapping(${mapping.id})" class="btn-delete" title="매핑 삭제" style="margin: 2px;">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 매핑 필터 업데이트
function updateMappingFilters() {
    // 사업장 필터
    const customerFilter = document.getElementById('mapping-customer-filter');
    customerFilter.innerHTML = '<option value="">전체 사업장</option>' +
        customersData.map(customer => 
            `<option value="${customer.id}">${customer.name}</option>`
        ).join('');

    // 협력업체 필터
    const supplierFilter = document.getElementById('mapping-supplier-filter');
    supplierFilter.innerHTML = '<option value="">전체 협력업체</option>' +
        suppliersData.map(supplier => 
            `<option value="${supplier.id}">${supplier.name}</option>`
        ).join('');
}

// 매핑 통계 업데이트
function updateMappingStats() {
    const totalMappings = mappingData.length;
    const activeMappings = mappingData.filter(m => m.is_active).length;
    const mappedCustomers = new Set(mappingData.map(m => m.customer_id)).size;
    const mappedSuppliers = new Set(mappingData.map(m => m.supplier_id)).size;

    document.getElementById('total-mappings').textContent = totalMappings;
    document.getElementById('active-mappings').textContent = activeMappings;
    document.getElementById('mapped-customers').textContent = mappedCustomers;
    document.getElementById('mapped-suppliers').textContent = mappedSuppliers;
}

// 매핑 필터링
function filterMappings() {
    const customerFilter = document.getElementById('mapping-customer-filter').value;
    const supplierFilter = document.getElementById('mapping-supplier-filter').value;
    const statusFilter = document.getElementById('mapping-status-filter').value;

    let filteredMappings = mappingData;

    if (customerFilter) {
        filteredMappings = filteredMappings.filter(m => m.customer_id == customerFilter);
    }

    if (supplierFilter) {
        filteredMappings = filteredMappings.filter(m => m.supplier_id == supplierFilter);
    }

    if (statusFilter !== '') {
        const isActive = statusFilter === 'true';
        filteredMappings = filteredMappings.filter(m => m.is_active === isActive);
    }

    displayMappings(filteredMappings);
}

// 매핑 필터 초기화
function clearMappingFilters() {
    document.getElementById('mapping-customer-filter').value = '';
    document.getElementById('mapping-supplier-filter').value = '';
    document.getElementById('mapping-status-filter').value = '';
    displayMappings(mappingData);
}

// 매핑 모달 열기
function openMappingModal(mappingId = null) {
    const modal = document.getElementById('mapping-modal');
    const title = document.getElementById('mapping-modal-title');
    
    // 폼 초기화
    document.getElementById('mapping-form').reset();
    document.getElementById('mapping-id').value = '';

    // 기존 행들 초기화
    supplierRowCounter = 0;
    const container = document.getElementById('supplier-rows-container');
    container.innerHTML = '';

    if (mappingId) {
        title.textContent = '매핑 수정';
        loadMappingForEdit(mappingId);
    } else {
        title.textContent = '협력업체 매핑 추가';
        // 첫 번째 행 추가
        addSupplierRow();
    }

    // 선택 옵션 업데이트
    updateMappingModalOptions();

    modal.classList.remove('hidden');
}

// 매핑 모달 옵션 업데이트
function updateMappingModalOptions() {
    // 사업장 옵션
    const customerSelect = document.getElementById('mapping-customer');
    if (customerSelect) {
        customerSelect.innerHTML = '<option value="">사업장을 선택하세요</option>' +
            customersData.map(customer => {
                const codeText = customer.site_code ? `코드: ${customer.site_code}` : '⚠️ 코드 없음';
                return `<option value="${customer.id}">${customer.name} (${codeText})</option>`;
            }).join('');
    }

    // 협력업체 옵션 - 동적으로 생성된 모든 supplier-select 요소들 업데이트
    const supplierSelects = document.querySelectorAll('.supplier-select');
    supplierSelects.forEach(supplierSelect => {
        if (supplierSelect) {
            supplierSelect.innerHTML = '<option value="">협력업체를 선택하세요</option>' +
                suppliersData.map(supplier => {
                    const codeText = supplier.parent_code ? `코드: ${supplier.parent_code}` : '⚠️ 코드 없음';
                    return `<option value="${supplier.id}">${supplier.name} (${codeText})</option>`;
                }).join('');
        }
    });
}

// 매핑 편집
function loadMappingForEdit(mappingId) {
    const mapping = mappingData.find(m => m.id === mappingId);
    if (!mapping) {
        alert('매핑 데이터를 찾을 수 없습니다.');
        return;
    }

    // 기본 정보 설정
    document.getElementById('mapping-id').value = mapping.id;
    document.getElementById('mapping-customer').value = mapping.customer_id;
    document.getElementById('mapping-contract-start').value = mapping.contract_start_date || '';
    document.getElementById('mapping-contract-end').value = mapping.contract_end_date || '';

    // 협력업체 행 추가
    addSupplierRow({
        supplier_id: mapping.supplier_id,
        delivery_code: mapping.delivery_code,
        priority: mapping.priority_order,
        is_primary: mapping.is_primary_supplier,
        is_active: mapping.is_active
    });

    // 옵션 업데이트 후 값 다시 설정
    setTimeout(() => {
        document.getElementById('mapping-customer').value = mapping.customer_id;
        const supplierSelect = document.querySelector('.supplier-select');
        if (supplierSelect) {
            supplierSelect.value = mapping.supplier_id;
            // 선택 변경 이벤트 트리거
            supplierSelect.dispatchEvent(new Event('change'));
        }
    }, 100);
}

// 매핑 저장
async function saveMapping() {
    const customerElement = document.getElementById('mapping-customer');
    if (!customerElement) {
        console.error('mapping-customer element not found');
        alert('사업장 선택 요소를 찾을 수 없습니다.');
        return;
    }
    const customerId = parseInt(customerElement.value);
    
    // 기본 유효성 검사
    if (!customerId) {
        alert('사업장을 선택하세요.');
        return;
    }

    // 협력업체 행 데이터 수집
    const supplierRows = document.querySelectorAll('.supplier-row');
    const mappingsToSave = [];
    
    for (let row of supplierRows) {
        const supplierSelect = row.querySelector('.supplier-select');
        const deliveryCodeInput = row.querySelector('.delivery-code-input');
        const priorityInput = row.querySelector('.priority-input');
        const primaryCheckbox = row.querySelector('.primary-checkbox');
        
        const supplierId = parseInt(supplierSelect.value);
        const deliveryCode = deliveryCodeInput.value.trim();
        const priority = parseInt(priorityInput.value) || 1;
        const isPrimary = primaryCheckbox.checked;
        
        if (!supplierId) {
            alert('모든 협력업체를 선택하세요.');
            return;
        }
        
        if (!deliveryCode) {
            alert('모든 배송코드를 입력하세요.');
            return;
        }
        
        // 중복 협력업체 검사
        const duplicateSupplier = mappingsToSave.find(m => m.supplier_id === supplierId);
        if (duplicateSupplier) {
            const supplierName = suppliersData.find(s => s.id === supplierId)?.name || '알 수 없음';
            alert(`협력업체 '${supplierName}'가 중복으로 선택되었습니다.`);
            return;
        }
        
        mappingsToSave.push({
            customer_id: customerId,
            supplier_id: supplierId,
            delivery_code: deliveryCode,
            priority_order: priority,
            is_primary_supplier: isPrimary,
            contract_start_date: document.getElementById('mapping-contract-start').value || null,
            contract_end_date: document.getElementById('mapping-contract-end').value || null,
            notes: document.getElementById('mapping-notes').value.trim() || null,
            is_active: true
        });
    }
    
    if (mappingsToSave.length === 0) {
        alert('저장할 매핑이 없습니다.');
        return;
    }

    // 저장 처리
    try {
        let successCount = 0;
        let errorMessages = [];
        
        // 편집 모드인지 확인
        const mappingId = document.getElementById('mapping-id').value;
        const isEditMode = mappingId && mappingId.trim() !== '';
        
        if (isEditMode && mappingsToSave.length > 1) {
            alert('편집 모드에서는 하나의 매핑만 수정할 수 있습니다.');
            return;
        }
        
        for (let mappingData of mappingsToSave) {
            try {
                let url = '/api/admin/customer-supplier-mappings';
                let method = 'POST';
                
                if (isEditMode) {
                    url += `/${mappingId}`;
                    method = 'PUT';
                }
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(mappingData)
                });

                const result = await response.json();
                
                if (result.success) {
                    successCount++;
                } else {
                    const supplierName = suppliersData.find(s => s.id === mappingData.supplier_id)?.name || '알 수 없음';
                    errorMessages.push(`${supplierName}: ${result.message}`);
                }
            } catch (error) {
                const supplierName = suppliersData.find(s => s.id === mappingData.supplier_id)?.name || '알 수 없음';
                errorMessages.push(`${supplierName}: 저장 중 오류 발생`);
            }
        }
        
        let message = `${successCount}개의 매핑이 성공적으로 저장되었습니다.`;
        if (errorMessages.length > 0) {
            message += `\n\n실패한 매핑:\n${errorMessages.join('\n')}`;
        }
        
        alert(message);
        
        if (successCount > 0) {
            closeMappingModal();
            loadMappingData();
        }
        
    } catch (error) {
        console.error('매핑 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 매핑 편집
function editMapping(mappingId) {
    openMappingModal(mappingId);
}

// 매핑 삭제
async function deleteMapping(mappingId) {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/customer-supplier-mappings/${mappingId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            alert('매핑이 삭제되었습니다.');
            loadMappingData();
        } else {
            alert(result.message || '삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('매핑 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 사업장 삭제 (소프트 삭제)
async function deleteBusinessLocation(customerId) {
    const customer = customersData.find(c => c.id === customerId);
    if (!customer) return;

    if (!confirm(`'${customer.name}' 사업장을 삭제하시겠습니까?\n관련된 매핑은 유지되지만 사업장은 비활성화됩니다.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/customers/${customerId}/update`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: customer.name,
                code: customer.code,
                site_code: customer.site_code,
                site_type: customer.site_type,
                contact_person: customer.contact_person,
                contact_phone: customer.contact_phone,
                address: customer.address,
                description: customer.description,
                portion_size: customer.portion_size,
                is_active: false
            })
        });

        const result = await response.json();

        if (result.success || response.ok) {
            alert('사업장이 삭제되었습니다.');
            // 데이터 새로고침
            await loadCustomersData();
            displayMappings(mappingData);
        } else {
            alert(result.message || '사업장 삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('사업장 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 사업장 복원
async function restoreBusinessLocation(customerId) {
    const customer = customersData.find(c => c.id === customerId);
    if (!customer) return;

    if (!confirm(`'${customer.name}' 사업장을 복원하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/customers/${customerId}/update`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: customer.name,
                code: customer.code,
                site_code: customer.site_code,
                site_type: customer.site_type,
                contact_person: customer.contact_person,
                contact_phone: customer.contact_phone,
                address: customer.address,
                description: customer.description,
                portion_size: customer.portion_size,
                is_active: true
            })
        });

        const result = await response.json();

        if (result.success || response.ok) {
            alert('사업장이 복원되었습니다.');
            // 데이터 새로고침
            await loadCustomersData();
            displayMappings(mappingData);
        } else {
            alert(result.message || '사업장 복원에 실패했습니다.');
        }
    } catch (error) {
        console.error('사업장 복원 오류:', error);
        alert('복원 중 오류가 발생했습니다.');
    }
}

// 고아 매핑 정리 (사업장 데이터가 없는 매핑)
async function cleanupOrphanedMapping(mappingId, customerId) {
    if (!confirm(`사업장 ID ${customerId}에 해당하는 데이터가 없습니다.\n이 매핑을 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/customer-supplier-mappings/${mappingId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            alert('고아 매핑이 정리되었습니다.');
            loadMappingData();
        } else {
            alert(result.message || '정리에 실패했습니다.');
        }
    } catch (error) {
        console.error('고아 매핑 정리 오류:', error);
        alert('정리 중 오류가 발생했습니다.');
    }
}

// 매핑 모달 닫기
// 다중 행 관련 변수
let supplierRowCounter = 0;

// 협력업체 행 추가
function addSupplierRow(supplierData = null) {
    supplierRowCounter++;
    const container = document.getElementById('supplier-rows-container');
    
    const rowDiv = document.createElement('div');
    rowDiv.className = 'supplier-row';
    rowDiv.id = `supplier-row-${supplierRowCounter}`;
    
    rowDiv.innerHTML = `
        <div>
            <label>협력업체</label>
            <select class="supplier-select" data-row="${supplierRowCounter}" onchange="onSupplierChangeMulti(${supplierRowCounter})" required>
                <option value="">협력업체를 선택하세요</option>
                ${suppliersData.map(supplier => {
                    const codeText = supplier.parent_code ? `코드: ${supplier.parent_code}` : '⚠️ 코드 없음';
                    const selected = supplierData && supplier.id === supplierData.supplier_id ? 'selected' : '';
                    return `<option value="${supplier.id}" ${selected}>${supplier.name} (${codeText})</option>`;
                }).join('')}
            </select>
        </div>
        <div>
            <label>배송코드(사업장코드)</label>
            <input type="text" class="delivery-code-input" data-row="${supplierRowCounter}" 
                   value="${supplierData ? (supplierData.delivery_code || '') : ''}" 
                   placeholder="자동 생성됨" maxlength="20" required>
        </div>
        <div>
            <label>우선순위</label>
            <input type="number" class="priority-input" data-row="${supplierRowCounter}" 
                   value="${supplierData ? (supplierData.priority || 1) : 1}" 
                   min="1" max="10">
        </div>
        <div>
            <label class="checkbox-label" style="margin-bottom: 0;">
                <input type="checkbox" class="primary-checkbox" data-row="${supplierRowCounter}" 
                       ${supplierData && supplierData.is_primary ? 'checked' : ''}>
                주요업체
            </label>
        </div>
        <div>
            <button type="button" class="btn-remove" onclick="removeSupplierRow(${supplierRowCounter})" title="삭제">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    container.appendChild(rowDiv);
    
    // 첫 번째 행이면 삭제 버튼 숨기기
    if (container.children.length === 1) {
        rowDiv.querySelector('.btn-remove').style.display = 'none';
    } else {
        // 첫 번째 행의 삭제 버튼 다시 보이기
        const firstRow = container.children[0];
        if (firstRow) {
            const firstRemoveBtn = firstRow.querySelector('.btn-remove');
            if (firstRemoveBtn) firstRemoveBtn.style.display = 'block';
        }
    }
    
    return rowDiv;
}

// 협력업체 행 삭제
function removeSupplierRow(rowId) {
    const row = document.getElementById(`supplier-row-${rowId}`);
    if (row) {
        row.remove();
        
        const container = document.getElementById('supplier-rows-container');
        // 행이 하나만 남으면 삭제 버튼 숨기기
        if (container.children.length === 1) {
            const lastRow = container.children[0];
            if (lastRow) {
                const removeBtn = lastRow.querySelector('.btn-remove');
                if (removeBtn) removeBtn.style.display = 'none';
            }
        }
    }
}

// 다중 행에서 협력업체 선택 시 배송코드 자동 입력
function onSupplierChangeMulti(rowId) {
    const supplierSelect = document.querySelector(`select[data-row="${rowId}"]`);
    const deliveryCodeInput = document.querySelector(`input.delivery-code-input[data-row="${rowId}"]`);
    
    const selectedSupplierId = parseInt(supplierSelect.value);
    
    if (selectedSupplierId && suppliersData) {
        const selectedSupplier = suppliersData.find(s => s.id === selectedSupplierId);
        if (selectedSupplier && selectedSupplier.parent_code) {
            // 사업장코드 가져오기
            const customerElement = document.getElementById('mapping-customer');
            if (!customerElement) return;
            const customerId = parseInt(customerElement.value);
            const selectedCustomer = customersData.find(c => c.id === customerId);
            const siteCode = selectedCustomer?.site_code;
            
            // 배송코드 생성: 모코드-사업장코드 (사업장코드가 없으면 모코드만)
            const deliveryCode = siteCode ? 
                `${selectedSupplier.parent_code}-${siteCode}` : 
                selectedSupplier.parent_code;
            
            deliveryCodeInput.value = deliveryCode;
            deliveryCodeInput.focus();
            deliveryCodeInput.setSelectionRange(deliveryCodeInput.value.length, deliveryCodeInput.value.length);
        } else {
            deliveryCodeInput.value = '';
        }
    } else {
        deliveryCodeInput.value = '';
    }
}

function closeMappingModal() {
    document.getElementById('mapping-modal').classList.add('hidden');
}

// ========================
// 식단가 관리 관련 JavaScript 함수들
// ========================

let currentMealPlan = null;
let detailedMealPlans = [];
let businessLocationsData = [];

// 식단가 관리 페이지 로드 시 사업장 목록 불러오기
async function loadMealPricingPage() {
    try {
        const response = await fetch('/api/admin/customers?page=1&limit=100');
        const data = await response.json();
        
        console.log('사업장 데이터 로드 응답:', data);
        
        if (data.success) {
            businessLocationsData = data.customers || [];
            console.log('사업장 데이터 개수:', businessLocationsData.length);
            populateBusinessLocationSelect();
        } else {
            console.error('사업장 데이터 로드 실패:', data.message);
        }
    } catch (error) {
        console.error('사업장 목록 로드 오류:', error);
    }
}

// 사업장 선택 드롭다운 채우기
function populateBusinessLocationSelect() {
    const select = document.getElementById('businessLocationSelect');
    
    if (!select) {
        console.error('businessLocationSelect 요소를 찾을 수 없습니다.');
        return;
    }
    
    select.innerHTML = '<option value="">사업장을 선택하세요</option>';
    
    console.log('사업장 드롭다운 채우기 시작:', businessLocationsData.length + '개');
    
    businessLocationsData.forEach(location => {
        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = `${location.name} (${location.site_type})`;
        select.appendChild(option);
        console.log('사업장 추가:', location.name);
    });
    
    console.log('드롭다운 총 옵션 수:', select.options.length);
}

// 사업장 선택 시 식단표 옵션 업데이트
function updateMealPlanOptions() {
    const businessLocationSelect = document.getElementById('businessLocationSelect');
    const mealPlanSelect = document.getElementById('mealPlanSelect');
    const selectedLocationId = businessLocationSelect.value;
    
    if (!selectedLocationId) {
        mealPlanSelect.innerHTML = '<option value="">먼저 사업장을 선택하세요</option>';
        mealPlanSelect.disabled = true;
        clearDetailedMealPlans();
        return;
    }
    
    // 선택된 사업장 정보 찾기
    const selectedLocation = businessLocationsData.find(loc => loc.id == selectedLocationId);
    
    if (selectedLocation) {
        // 사업장 타입에 따른 식단표 옵션 생성
        mealPlanSelect.innerHTML = '';
        mealPlanSelect.disabled = false;
        
        // 기본 옵션
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '식단표 타입을 선택하세요';
        mealPlanSelect.appendChild(defaultOption);
        
        // 사업장 타입별 식단표 옵션
        const mealPlanOptions = {
            '학교': [
                {value: 'school_lunch', text: '학교 급식'},
                {value: 'school_breakfast', text: '학교 조식'},
                {value: 'school_dinner', text: '학교 석식'}
            ],
            '병원': [
                {value: 'hospital_regular', text: '병원 일반식'},
                {value: 'hospital_special', text: '병원 특식'},
                {value: 'hospital_diet', text: '병원 치료식'}
            ],
            '기업': [
                {value: 'company_lunch', text: '기업 중식'},
                {value: 'company_catering', text: '기업 케이터링'}
            ]
        };
        
        const options = mealPlanOptions[selectedLocation.site_type] || [
            {value: 'general', text: '일반 식단'}
        ];
        
        options.forEach(optionData => {
            const option = document.createElement('option');
            option.value = `${selectedLocation.id}_${optionData.value}`;
            option.textContent = `${selectedLocation.name} - ${optionData.text}`;
            mealPlanSelect.appendChild(option);
        });
    }
    
    clearDetailedMealPlans();
}

// 마스터 식단표 선택 시 세부 식단표 로드
async function onMasterMealPlanChange() {
    const businessLocationSelect = document.getElementById('businessLocationSelect');
    const mealPlanSelect = document.getElementById('mealPlanSelect');
    const selectedLocationId = businessLocationSelect.value;
    const selectedMealPlan = mealPlanSelect.value;
    
    if (!selectedLocationId || !selectedMealPlan) {
        alert('사업장과 식단표 타입을 모두 선택해주세요.');
        clearDetailedMealPlans();
        return;
    }

    try {
        // 선택된 사업장 정보
        const selectedLocation = businessLocationsData.find(loc => loc.id == selectedLocationId);
        
        // 기존 저장된 데이터 먼저 확인
        const savedData = await loadSavedMealPricing(selectedLocationId, selectedMealPlan);
        
        let detailedPlans;
        if (savedData && savedData.length > 0) {
            // 저장된 데이터가 있으면 그것을 사용
            detailedPlans = savedData.map((record, index) => ({
                id: record.id || (index + 1),
                name: record.plan_name,
                meal_type: record.meal_type,
                apply_date_start: record.apply_date_start || new Date().toISOString().split('T')[0],
                apply_date_end: record.apply_date_end || '',
                selling_price: record.selling_price || 0,
                material_cost_guideline: record.material_cost_guideline || 0,
                location_id: record.location_id,
                location_name: record.location_name
            }));
        } else {
            // 저장된 데이터가 없으면 템플릿 생성
            detailedPlans = generateDetailedMealPlans(selectedMealPlan, selectedLocation);
        }
        
        displayDetailedMealPlans(detailedPlans);
        
        document.getElementById('saveMealPricingBtn').style.display = 'block';
    } catch (error) {
        console.error('세부 식단표 로드 오류:', error);
        alert('세부 식단표를 불러올 수 없습니다.');
    }
}

// 저장된 식단가 데이터 불러오기
async function loadSavedMealPricing(locationId, mealPlanType) {
    try {
        const response = await fetch(`/api/admin/meal-pricing?location_id=${locationId}&meal_plan_type=${mealPlanType}`);
        const data = await response.json();
        
        if (data.success) {
            return data.pricing_records;
        }
        return [];
    } catch (error) {
        console.error('저장된 식단가 데이터 로드 오류:', error);
        return [];
    }
}

// 임시 세부 식단표 데이터 생성 (실제로는 API에서 가져와야 함)
function generateDetailedMealPlans(mealPlanType, location) {
    const basePlans = [
        {name: 'A형', meal_type: '조'},
        {name: 'B형', meal_type: '조'},
        {name: 'C형', meal_type: '조'},
        {name: 'A형', meal_type: '중'},
        {name: 'B형', meal_type: '중'},
        {name: 'C형', meal_type: '중'},
        {name: 'A형', meal_type: '석'},
        {name: 'B형', meal_type: '석'},
        {name: 'A형', meal_type: '야'}
    ];

    const today = new Date().toISOString().split('T')[0];

    return basePlans.map((planInfo, index) => ({
        id: index + 1,
        name: planInfo.name,
        meal_type: planInfo.meal_type,
        apply_date_start: today, // 시작일
        apply_date_end: '', // 종료일은 비워둠 (무기한)
        selling_price: 0,  // 부가세 제외 판매가
        material_cost_guideline: 0,  // 재료비 가이드라인
        location_id: location ? location.id : null, // 사업장 ID 추가
        location_name: location ? location.name : '' // 사업장명 추가
    }));
}

// 세부 식단표 목록 표시
function displayDetailedMealPlans(plans) {
    detailedMealPlans = plans;
    const container = document.getElementById('pricingManagementContainer');
    
    const tableHtml = `
        <div style="margin-bottom: 15px; text-align: right;">
            <button onclick="reloadMealPlans()" 
                    style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                🔄 다시 불러오기
            </button>
            <button onclick="addDetailedMealPlan()" 
                    style="padding: 8px 16px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                ➕ 세부식단표 추가
            </button>
        </div>
        
        <div style="overflow-x: auto;">
            <table id="mealPlanTable" style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 15px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 50px;">No.</th>
                        <th style="padding: 15px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 280px;">세부식단표명</th>
                        <th style="padding: 15px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 280px;">적용기간</th>
                        <th style="padding: 15px; text-align: right; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 120px;">판매가 (VAT제외)</th>
                        <th style="padding: 15px; text-align: right; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 120px;">식재료비</th>
                        <th style="padding: 15px; text-align: right; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 80px;">비율</th>
                        <th style="padding: 15px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; width: 100px;">작업</th>
                    </tr>
                </thead>
                <tbody id="mealPlanTableBody">
                    ${plans.map((plan, index) => createMealPlanRow(plan, index)).join('')}
                </tbody>
            </table>
        </div>
        
        <!-- 통계 정보 -->
        <div style="margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 14px; color: #666; margin-bottom: 5px;">평균 판매가</div>
                <div id="avgSellingPrice" style="font-size: 20px; font-weight: bold; color: #27ae60;">0원</div>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 14px; color: #666; margin-bottom: 5px;">평균 재료비</div>
                <div id="avgMaterialCost" style="font-size: 20px; font-weight: bold; color: #f39c12;">0원</div>
            </div>
            <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 14px; color: #666; margin-bottom: 5px;">평균 재료비 비율</div>
                <div id="avgCostRatio" style="font-size: 20px; font-weight: bold; color: #17a2b8;">0%</div>
            </div>
        </div>
    `;
    
    container.innerHTML = tableHtml;
    
    // 초기 비율 계산
    plans.forEach(plan => {
        calculateMaterialCostRatio(plan.id);
    });
    
    updateStatistics();
}

// 세부 식단표 행 생성
function createMealPlanRow(plan, index) {
    return `
        <tr id="meal-row-${plan.id}" style="border-bottom: 1px solid #f1f3f5;">
            <td style="padding: 12px 15px; text-align: center; font-weight: 600; color: #495057;">
                ${index + 1}
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <select id="meal-type-${plan.id}" 
                            onchange="updateMealPlanName(${plan.id})"
                            style="padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; width: 70px; font-size: 12px;">
                        <option value="조" ${plan.meal_type === '조' ? 'selected' : ''}>조식</option>
                        <option value="중" ${plan.meal_type === '중' ? 'selected' : ''}>중식</option>
                        <option value="석" ${plan.meal_type === '석' ? 'selected' : ''}>석식</option>
                        <option value="야" ${plan.meal_type === '야' ? 'selected' : ''}>야식</option>
                    </select>
                    <input type="text" 
                           id="plan-name-${plan.id}"
                           value="${plan.name || ''}" 
                           placeholder="명칭 입력"
                           style="flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; gap: 5px; align-items: center;">
                    <input type="date" 
                           id="apply-date-start-${plan.id}"
                           value="${plan.apply_date_start || ''}" 
                           title="시작일"
                           style="width: 130px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                    <span style="color: #666;">~</span>
                    <input type="date" 
                           id="apply-date-end-${plan.id}"
                           value="${plan.apply_date_end || ''}" 
                           title="종료일"
                           style="width: 130px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                </div>
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; align-items: center;">
                    <input type="number" 
                           id="selling-price-${plan.id}"
                           value="${plan.selling_price}" 
                           min="0" 
                           step="1"
                           onchange="calculateMaterialCostRatio(${plan.id})"
                           style="width: 100px; text-align: right; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;">
                    <span style="margin-left: 5px; color: #666; font-size: 12px;">원</span>
                </div>
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; align-items: center;">
                    <input type="number" 
                           id="material-cost-${plan.id}"
                           value="${plan.material_cost_guideline}" 
                           min="0" 
                           step="1"
                           onchange="calculateMaterialCostRatio(${plan.id})"
                           style="width: 100px; text-align: right; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;">
                    <span style="margin-left: 5px; color: #666; font-size: 12px;">원</span>
                </div>
            </td>
            <td style="padding: 12px 15px; text-align: center;">
                <span id="cost-ratio-${plan.id}" 
                      style="font-weight: 600; color: #495057; font-size: 14px;">0%</span>
            </td>
            <td style="padding: 12px 15px; text-align: center;">
                <div style="display: flex; gap: 5px; justify-content: center;">
                    <button onclick="insertMealPlanAfter(${plan.id})" 
                            title="뒤에 추가"
                            style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                        ➕
                    </button>
                    <button onclick="removeDetailedMealPlan(${plan.id})" 
                            title="삭제"
                            style="padding: 4px 8px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// 끼니별 식단표명 자동 업데이트
function updateMealPlanName(planId) {
    const mealTypeSelect = document.getElementById(`meal-type-${planId}`);
    const planNameInput = document.getElementById(`plan-name-${planId}`);
    
    if (mealTypeSelect && planNameInput) {
        const selectedMealType = mealTypeSelect.value;
        if (planNameInput.value === '' || planNameInput.value.includes('새 식단표')) {
            planNameInput.value = 'A형'; // 기본값으로 A형 설정
        }
    }
}

// 세부 식단표 추가 (맨 끝에)
function addDetailedMealPlan() {
    const newId = Math.max(...detailedMealPlans.map(p => p.id), 0) + 1;
    const newPlan = {
        id: newId,
        name: 'A형',
        meal_type: '조', // 기본값
        apply_date_start: new Date().toISOString().split('T')[0],
        apply_date_end: '',
        selling_price: 0,
        material_cost_guideline: 0
    };
    
    detailedMealPlans.push(newPlan);
    
    // 테이블 전체 다시 그리기 (넘버링 업데이트를 위해)
    refreshTableDisplay();
    
    calculateMaterialCostRatio(newId);
}

// 특정 행 뒤에 식단표 추가 (같은 끼니 타입으로)
function insertMealPlanAfter(afterPlanId) {
    const afterPlan = detailedMealPlans.find(p => p.id === afterPlanId);
    const afterIndex = detailedMealPlans.findIndex(p => p.id === afterPlanId);
    
    if (!afterPlan || afterIndex === -1) return;
    
    const newId = Math.max(...detailedMealPlans.map(p => p.id), 0) + 1;
    const newPlan = {
        id: newId,
        name: 'A형', // 기본 명칭
        meal_type: afterPlan.meal_type, // 같은 끼니 타입
        apply_date_start: afterPlan.apply_date_start, // 같은 시작일
        apply_date_end: afterPlan.apply_date_end, // 같은 종료일
        selling_price: 0,
        material_cost_guideline: 0
    };
    
    // 배열에서 해당 위치 뒤에 삽입
    detailedMealPlans.splice(afterIndex + 1, 0, newPlan);
    
    // 테이블 전체 다시 그리기 (넘버링 업데이트를 위해)
    refreshTableDisplay();
    
    calculateMaterialCostRatio(newId);
    
    // 새로 추가된 행의 명칭 입력필드에 포커스
    setTimeout(() => {
        const nameInput = document.getElementById(`plan-name-${newId}`);
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }, 100);
}

// 세부 식단표 삭제
function removeDetailedMealPlan(planId) {
    if (detailedMealPlans.length <= 1) {
        alert('최소 1개의 세부식단표가 필요합니다.');
        return;
    }
    
    if (!confirm('이 세부식단표를 삭제하시겠습니까?')) {
        return;
    }
    
    // 데이터에서 제거
    detailedMealPlans = detailedMealPlans.filter(plan => plan.id !== planId);
    
    // 테이블 전체 다시 그리기 (넘버링 업데이트를 위해)
    refreshTableDisplay();
    
    updateStatistics();
}

// 재료비 비율 계산
function calculateMaterialCostRatio(planId) {
    const sellingPriceInput = document.getElementById(`selling-price-${planId}`);
    const materialCostInput = document.getElementById(`material-cost-${planId}`);
    const ratioSpan = document.getElementById(`cost-ratio-${planId}`);
    
    if (!sellingPriceInput || !materialCostInput || !ratioSpan) {
        return;
    }
    
    const sellingPrice = parseFloat(sellingPriceInput.value) || 0;
    const materialCost = parseFloat(materialCostInput.value) || 0;
    
    let ratio = 0;
    if (sellingPrice > 0) {
        ratio = Math.round((materialCost / sellingPrice) * 100);
    }
    
    ratioSpan.textContent = ratio + '%';
    
    // 비율에 따른 색상 변경
    if (ratio <= 30) {
        ratioSpan.style.color = '#27ae60';  // 녹색
    } else if (ratio <= 50) {
        ratioSpan.style.color = '#f39c12';  // 주황
    } else {
        ratioSpan.style.color = '#e74c3c';  // 빨강
    }
    
    updateStatistics();
}

// 통계 정보 업데이트
function updateStatistics() {
    let totalSellingPrice = 0;
    let totalMaterialCost = 0;
    let count = 0;
    
    detailedMealPlans.forEach(plan => {
        const sellingPriceInput = document.getElementById(`selling-price-${plan.id}`);
        const materialCostInput = document.getElementById(`material-cost-${plan.id}`);
        
        if (sellingPriceInput && materialCostInput) {
            const sellingPrice = parseFloat(sellingPriceInput.value) || 0;
            const materialCost = parseFloat(materialCostInput.value) || 0;
            
            if (sellingPrice > 0 || materialCost > 0) { // 0이 아닌 값들만 통계에 포함
                totalSellingPrice += sellingPrice;
                totalMaterialCost += materialCost;
                count++;
            }
        }
    });
    
    const avgSellingPrice = count > 0 ? Math.round(totalSellingPrice / count) : 0;
    const avgMaterialCost = count > 0 ? Math.round(totalMaterialCost / count) : 0;
    const avgCostRatio = avgSellingPrice > 0 ? Math.round((avgMaterialCost / avgSellingPrice) * 100) : 0;
    
    const avgSellingElement = document.getElementById('avgSellingPrice');
    const avgMaterialElement = document.getElementById('avgMaterialCost');
    const avgRatioElement = document.getElementById('avgCostRatio');
    
    if (avgSellingElement) avgSellingElement.textContent = avgSellingPrice.toLocaleString() + '원';
    if (avgMaterialElement) avgMaterialElement.textContent = avgMaterialCost.toLocaleString() + '원';
    if (avgRatioElement) {
        avgRatioElement.textContent = avgCostRatio + '%';
        
        // 평균 비율에 따른 색상 변경
        if (avgCostRatio <= 30) {
            avgRatioElement.style.color = '#27ae60';  // 녹색
        } else if (avgCostRatio <= 50) {
            avgRatioElement.style.color = '#f39c12';  // 주황
        } else {
            avgRatioElement.style.color = '#e74c3c';  // 빨강
        }
    }
}

// 세부 식단표 목록 지우기
function clearDetailedMealPlans() {
    document.getElementById('detailedMealPlansContainer').innerHTML = 
        '<p style="color: #888; text-align: center; padding: 40px;">위에서 식단표를 선택하면 세부식단표 목록이 표시됩니다.</p>';
    document.getElementById('pricingManagementContainer').innerHTML = 
        '<p style="color: #888; text-align: center; padding: 40px;">위에서 세부식단표를 불러온 후 가격 관리가 가능합니다.</p>';
    document.getElementById('saveMealPricingBtn').style.display = 'none';
    detailedMealPlans = [];
}

// 테이블 표시 새로고침 (넘버링 업데이트)
function refreshTableDisplay() {
    const tbody = document.getElementById('mealPlanTableBody');
    if (!tbody) return;
    
    const newRows = detailedMealPlans.map((plan, index) => createMealPlanRow(plan, index)).join('');
    tbody.innerHTML = newRows;
    
    // 모든 행의 비율 재계산
    detailedMealPlans.forEach(plan => {
        calculateMaterialCostRatio(plan.id);
    });
}

// 다시 불러오기 (취소 기능)
function reloadMealPlans() {
    if (confirm('현재 수정 중인 내용이 모두 사라집니다. 다시 불러오시겠습니까?')) {
        onMasterMealPlanChange();
    }
}

// 식단가 관리 페이지 표시 시 초기화
function showMealPricingPage() {
    showPage('meal-pricing-page');
    
    // DOM이 완전히 로드된 후 사업장 목록 로드
    setTimeout(() => {
        loadMealPricingPage();
    }, 100);
}

// 페이지 로드 시에도 식단가 관리 페이지가 활성화되어 있다면 데이터 로드
document.addEventListener('DOMContentLoaded', function() {
    // 현재 활성 페이지가 meal-pricing인지 확인
    const mealPricingPage = document.getElementById('meal-pricing-page');
    if (mealPricingPage && !mealPricingPage.classList.contains('hidden')) {
        setTimeout(() => {
            loadMealPricingPage();
        }, 100);
    }
});

// 식단가 정보 저장
async function saveMealPricing() {
    const masterMealPlanSelect = document.getElementById('mealPlanSelect');
    const selectedMealPlan = masterMealPlanSelect.value;
    
    if (!selectedMealPlan) {
        alert('먼저 식단표를 선택해주세요.');
        return;
    }
    
    // 가격 데이터 수집
    const businessLocationSelect = document.getElementById('businessLocationSelect');
    const selectedLocationId = businessLocationSelect.value;
    const selectedLocation = businessLocationsData.find(loc => loc.id == selectedLocationId);
    
    const pricingData = detailedMealPlans.map(plan => {
        const planNameInput = document.getElementById(`plan-name-${plan.id}`);
        const mealTypeSelect = document.getElementById(`meal-type-${plan.id}`);
        const applyDateStartInput = document.getElementById(`apply-date-start-${plan.id}`);
        const applyDateEndInput = document.getElementById(`apply-date-end-${plan.id}`);
        const sellingPriceInput = document.getElementById(`selling-price-${plan.id}`);
        const materialCostInput = document.getElementById(`material-cost-${plan.id}`);
        
        return {
            plan_id: plan.id,
            plan_name: planNameInput ? planNameInput.value : plan.name,
            meal_type: mealTypeSelect ? mealTypeSelect.value : plan.meal_type,
            apply_date_start: applyDateStartInput ? applyDateStartInput.value : '',
            apply_date_end: applyDateEndInput ? applyDateEndInput.value : '',
            selling_price: parseFloat(sellingPriceInput.value) || 0,
            material_cost_guideline: parseFloat(materialCostInput.value) || 0,
            location_id: selectedLocation ? selectedLocation.id : null,
            location_name: selectedLocation ? selectedLocation.name : ''
        };
    });
    
    console.log('저장할 데이터:', {
        meal_plan_type: selectedMealPlan,
        pricing_data: pricingData
    });
    
    try {
        const response = await fetch('/api/admin/meal-pricing', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                meal_plan_type: selectedMealPlan,
                pricing_data: pricingData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`식단가 정보가 성공적으로 저장되었습니다.\n- 식단표: ${selectedMealPlan}\n- 세부식단표: ${pricingData.length}개`);
        } else {
            alert('저장에 실패했습니다: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('식단가 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 사업장 편집 모달 관련 함수들
function editBusinessLocation(customerId) {
    const customer = customersData.find(c => c.id === customerId);
    if (!customer) {
        alert('사업장 데이터를 찾을 수 없습니다.');
        return;
    }

    // 모달 필드에 데이터 채우기
    document.getElementById('edit-customer-id').value = customer.id;
    document.getElementById('edit-customer-name').value = customer.name || '';
    document.getElementById('edit-customer-code').value = customer.site_code || '';
    document.getElementById('edit-customer-type').value = customer.site_type || '';
    document.getElementById('edit-customer-contact').value = customer.contact_person || '';
    document.getElementById('edit-customer-phone').value = customer.contact_phone || '';
    document.getElementById('edit-customer-portion').value = customer.portion_size || '';
    document.getElementById('edit-customer-address').value = customer.address || '';
    document.getElementById('edit-customer-description').value = customer.description || '';
    document.getElementById('edit-customer-active').checked = customer.is_active !== false;

    // 모달 표시
    document.getElementById('business-location-modal').style.display = 'flex';
}

function closeBusinessLocationModal() {
    document.getElementById('business-location-modal').style.display = 'none';
}

async function saveBusinessLocation() {
    const customerId = document.getElementById('edit-customer-id').value;
    const customerData = {
        name: document.getElementById('edit-customer-name').value,
        code: document.getElementById('edit-customer-code').value,
        site_code: document.getElementById('edit-customer-code').value,
        site_type: document.getElementById('edit-customer-type').value,
        contact_person: document.getElementById('edit-customer-contact').value,
        contact_phone: document.getElementById('edit-customer-phone').value,
        portion_size: parseInt(document.getElementById('edit-customer-portion').value) || null,
        address: document.getElementById('edit-customer-address').value,
        description: document.getElementById('edit-customer-description').value,
        is_active: document.getElementById('edit-customer-active').checked
    };

    if (!customerData.name) {
        alert('사업장명은 필수 입력 항목입니다.');
        return;
    }

    try {
        const response = await fetch(`/api/admin/customers/${customerId}/update`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(customerData)
        });

        const result = await response.json();

        if (result.success || response.ok) {
            alert('사업장 정보가 수정되었습니다.');
            closeBusinessLocationModal();
            // 데이터 새로고침
            await loadCustomersData();
            displayMappings(mappingData);
        } else {
            alert(result.message || '수정에 실패했습니다.');
        }
    } catch (error) {
        console.error('사업장 수정 오류:', error);
        alert('수정 중 오류가 발생했습니다.');
    }
}

