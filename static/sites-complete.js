// 사업장 관리 모듈
(function() {
'use strict';

// 사업장 관련 변수
let sitesData = [];
let selectedSiteId = null;
let draggedSite = null;
let currentEditSiteId = null;

// 사업장 관리 모듈 객체
window.SitesModule = {
    // 초기화
    async init() {
        console.log('사업장 관리 모듈 초기화');
        await this.loadSitesTree();
    },

    // 사업장 트리 로드
    async loadSitesTree() {
        try {
            const response = await fetch('/api/admin/sites/tree');
            const data = await response.json();
            
            if (data.success) {
                sitesData = data.sites || [];
                this.renderSitesTree();
            } else {
                console.error('API 응답 오류:', data.message);
                const container = document.getElementById('sites-tree');
                if (container) {
                    container.innerHTML = '<div class="text-center">사업장 정보를 불러올 수 없습니다.</div>';
                }
            }
        } catch (error) {
            console.error('사업장 트리 로드 실패:', error);
            const container = document.getElementById('sites-tree');
            if (container) {
                container.innerHTML = '<div class="text-center">사업장 정보를 불러올 수 없습니다.</div>';
            }
        }
    },

    // 사업장 트리 렌더링
    renderSitesTree() {
        const container = document.getElementById('sites-tree');
        if (!container) {
            console.log('sites-tree 컨테이너를 찾을 수 없습니다. 현재 페이지에서는 사업장 트리가 필요하지 않습니다.');
            return;
        }
        
        container.innerHTML = '';
        
        if (!Array.isArray(sitesData) || sitesData.length === 0) {
            container.innerHTML = '<div class="text-center">등록된 사업장이 없습니다.</div>';
            return;
        }
        
        // 모든 사업장들 렌더링 (레벨 1 사업장들)
        const rootSites = sitesData.filter(site => site && site.level === 1);
        rootSites.forEach(site => {
            container.appendChild(this.createTreeNode(site));
        });
    },

    // 트리 노드 생성
    createTreeNode(site) {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'tree-node';
        nodeDiv.dataset.siteId = site.id;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = `tree-node-content ${site.site_type}-site`;
        contentDiv.onclick = () => this.selectSite(site.id);
        
        // 드래그 앤 드롭 이벤트 추가
        this.setupDragAndDrop(contentDiv, site);
        
        // 확장/축소 버튼
        const expandBtn = document.createElement('button');
        expandBtn.className = 'tree-expand-btn';
        const hasChildren = site.children && site.children.length > 0;
        
        if (hasChildren) {
            expandBtn.className += ' expanded';
            expandBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleNode(site.id);
            };
        } else {
            expandBtn.className += ' no-children';
        }
        
        // 아이콘
        const iconSpan = document.createElement('span');
        iconSpan.className = 'tree-node-icon';
        iconSpan.textContent = this.getSiteIcon(site.site_type);
        
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
                this.showAddSiteModal('detail', site.id);
            };
            actionsDiv.appendChild(addDetailBtn);
        }
        
        const viewBtn = document.createElement('button');
        viewBtn.className = 'tree-action-btn view';
        viewBtn.textContent = '👁';
        viewBtn.onclick = (e) => {
            e.stopPropagation();
            this.showSiteDetails(site.id);
        };
        
        const editBtn = document.createElement('button');
        editBtn.className = 'tree-action-btn edit';
        editBtn.textContent = '✏';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            this.editSite(site.id);
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-action-btn delete';
        deleteBtn.textContent = '🗑';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteSite(site.id);
        };
        
        actionsDiv.appendChild(viewBtn);
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        
        // 모든 요소 조립
        contentDiv.appendChild(expandBtn);
        contentDiv.appendChild(iconSpan);
        contentDiv.appendChild(labelSpan);
        contentDiv.appendChild(statusSpan);
        contentDiv.appendChild(actionsDiv);
        nodeDiv.appendChild(contentDiv);
        
        // 자식 노드들 추가
        if (hasChildren) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'tree-children';
            site.children.forEach(child => {
                childrenDiv.appendChild(this.createTreeNode(child));
            });
            nodeDiv.appendChild(childrenDiv);
        }
        
        return nodeDiv;
    },

    // 사업장 아이콘 반환
    getSiteIcon(siteType) {
        const icons = {
            'head': '🏢',
            'detail': '🏬',
            'customer': '👥'
        };
        return icons[siteType] || '📍';
    },

    // 노드 토글
    toggleNode(siteId) {
        const node = document.querySelector(`[data-site-id="${siteId}"]`);
        if (!node) return;
        
        const expandBtn = node.querySelector('.tree-expand-btn');
        const children = node.querySelector('.tree-children');
        
        if (expandBtn && children) {
            if (expandBtn.classList.contains('expanded')) {
                expandBtn.classList.remove('expanded');
                children.style.display = 'none';
            } else {
                expandBtn.classList.add('expanded');
                children.style.display = 'block';
            }
        }
    },

    // 모든 사이트 확장
    expandAllSites() {
        const expandBtns = document.querySelectorAll('.tree-expand-btn:not(.no-children)');
        const childrenDivs = document.querySelectorAll('.tree-children');
        
        expandBtns.forEach(btn => btn.classList.add('expanded'));
        childrenDivs.forEach(div => div.style.display = 'block');
    },

    // 모든 사이트 축소
    collapseAllSites() {
        const expandBtns = document.querySelectorAll('.tree-expand-btn:not(.no-children)');
        const childrenDivs = document.querySelectorAll('.tree-children');
        
        expandBtns.forEach(btn => btn.classList.remove('expanded'));
        childrenDivs.forEach(div => div.style.display = 'none');
    },

    // 사이트 선택
    selectSite(siteId) {
        // 이전 선택 제거
        document.querySelectorAll('.tree-node-content.selected').forEach(node => {
            node.classList.remove('selected');
        });
        
        // 새 선택 추가
        const selectedNode = document.querySelector(`[data-site-id="${siteId}"] .tree-node-content`);
        if (selectedNode) {
            selectedNode.classList.add('selected');
            selectedSiteId = siteId;
        }
    },

    // 사이트 상세 정보 표시
    async showSiteDetails(siteId) {
        try {
            const response = await fetch(`/api/admin/sites/${siteId}`);
            const data = await response.json();
            
            if (data.success && data.site) {
                const site = data.site;
                
                const detailsHtml = `
                    <div class="site-details">
                        <h3>${site.name} 상세정보</h3>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <label>사업장 코드:</label>
                                <span>${site.code}</span>
                            </div>
                            <div class="detail-item">
                                <label>사업장 유형:</label>
                                <span>${this.getSiteTypeDisplay(site.site_type)}</span>
                            </div>
                            <div class="detail-item">
                                <label>주소:</label>
                                <span>${site.address || '-'}</span>
                            </div>
                            <div class="detail-item">
                                <label>담당자:</label>
                                <span>${site.contact_person || '-'}</span>
                            </div>
                            <div class="detail-item">
                                <label>연락처:</label>
                                <span>${site.contact_phone || '-'}</span>
                            </div>
                            <div class="detail-item">
                                <label>상태:</label>
                                <span class="${site.is_active ? 'active' : 'inactive'}">${site.is_active ? '활성' : '비활성'}</span>
                            </div>
                            <div class="detail-item">
                                <label>설명:</label>
                                <span>${site.description || '-'}</span>
                            </div>
                        </div>
                        <div class="detail-actions">
                            <button onclick="SitesModule.editSite(${site.id})" class="btn btn-primary">수정</button>
                            <button onclick="SitesModule.closeSiteDetails()" class="btn btn-secondary">닫기</button>
                        </div>
                    </div>
                `;
                
                const detailsContainer = document.getElementById('site-details');
                if (detailsContainer) {
                    detailsContainer.innerHTML = detailsHtml;
                    detailsContainer.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('사이트 상세정보 로드 실패:', error);
        }
    },

    // 사업장 유형 표시명 반환
    getSiteTypeDisplay(siteType) {
        const types = {
            'head': '헤드사업장',
            'detail': '세부사업장',
            'customer': '고객사'
        };
        return types[siteType] || siteType;
    },

    // 드래그 앤 드롭 설정
    setupDragAndDrop(element, site) {
        element.draggable = true;
        
        element.addEventListener('dragstart', (e) => {
            draggedSite = site;
            element.classList.add('dragging');
            console.log('드래그 시작:', site.name);
        });
        
        element.addEventListener('dragend', (e) => {
            element.classList.remove('dragging');
            this.clearDropIndicators();
            console.log('드래그 종료');
        });
        
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedSite && this.canDropOn(draggedSite, site)) {
                element.classList.add('drop-target');
            }
        });
        
        element.addEventListener('dragleave', (e) => {
            element.classList.remove('drop-target');
        });
        
        element.addEventListener('drop', async (e) => {
            e.preventDefault();
            element.classList.remove('drop-target');
            
            if (draggedSite && this.canDropOn(draggedSite, site)) {
                await this.handleDrop(draggedSite, site);
            } else {
                console.log('유효하지 않은 드롭:', draggedSite?.name, '->', site.name);
            }
        });
    },

    // 드롭 가능 여부 확인
    canDropOn(draggedSite, targetSite) {
        // 자기 자신에게는 드롭 불가
        if (draggedSite.id === targetSite.id) return false;
        
        // 헤드사업장은 루트에만 위치 가능
        if (draggedSite.site_type === 'head') return false;
        
        // 세부사업장은 헤드사업장 아래에만 위치 가능
        if (draggedSite.site_type === 'detail' && targetSite.site_type !== 'head') return false;
        
        // 고객사는 세부사업장 아래에만 위치 가능
        if (draggedSite.site_type === 'customer' && targetSite.site_type !== 'detail') return false;
        
        return true;
    },

    // 드롭 처리
    async handleDrop(draggedSite, targetSite) {
        try {
            const response = await fetch(`/api/admin/sites/${draggedSite.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    parent_id: targetSite.id
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log('사업장 이동 성공:', draggedSite.name, '->', targetSite.name);
                await this.loadSitesTree(); // 트리 새로고침
            } else {
                console.error('사업장 이동 실패:', data.message);
                alert('사업장 이동에 실패했습니다: ' + data.message);
            }
        } catch (error) {
            console.error('사업장 이동 오류:', error);
            alert('사업장 이동 중 오류가 발생했습니다.');
        }
    },

    // 드롭 인디케이터 제거
    clearDropIndicators() {
        document.querySelectorAll('.drop-target').forEach(el => {
            el.classList.remove('drop-target');
        });
    },

    // 사이트 상세정보 닫기
    closeSiteDetails() {
        const detailsContainer = document.getElementById('site-details');
        if (detailsContainer) {
            detailsContainer.style.display = 'none';
        }
    },

    // 사이트 추가 모달 표시
    showAddSiteModal(siteType, parentId = null) {
        const modal = document.getElementById('site-modal');
        const form = document.getElementById('site-form');
        const title = document.getElementById('site-modal-title');
        
        if (!modal || !form || !title) return;
        
        // 폼 초기화
        form.reset();
        currentEditSiteId = null;
        
        // 제목 설정
        const typeNames = {
            'head': '헤드사업장',
            'detail': '세부사업장',
            'customer': '고객사'
        };
        title.textContent = `${typeNames[siteType] || '사업장'} 추가`;
        
        // 사업장 유형 설정
        const siteTypeSelect = document.getElementById('site-type');
        if (siteTypeSelect) {
            siteTypeSelect.value = siteType;
        }
        
        // 부모 ID 설정
        const parentIdInput = document.getElementById('parent-id');
        if (parentIdInput) {
            parentIdInput.value = parentId || '';
        }
        
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
    },

    // 사이트 편집
    async editSite(siteId) {
        try {
            const response = await fetch(`/api/admin/sites/${siteId}`);
            const data = await response.json();
            
            if (data.success && data.site) {
                const site = data.site;
                currentEditSiteId = siteId;
                
                // 모달 폼에 데이터 채우기
                document.getElementById('site-name').value = site.name || '';
                document.getElementById('site-code').value = site.code || '';
                document.getElementById('site-type').value = site.site_type || '';
                document.getElementById('site-address').value = site.address || '';
                document.getElementById('site-contact').value = site.contact_person || '';
                document.getElementById('site-phone').value = site.contact_phone || '';
                document.getElementById('site-description').value = site.description || '';
                document.getElementById('site-active').checked = site.is_active || false;
                document.getElementById('parent-id').value = site.parent_id || '';
                
                document.getElementById('site-modal-title').textContent = '사업장 수정';
                
                const modal = document.getElementById('site-modal');
                modal.style.display = 'flex';
                modal.classList.remove('hidden');
            }
        } catch (error) {
            console.error('사이트 편집 오류:', error);
        }
    },

    // 사이트 삭제
    async deleteSite(siteId) {
        if (!confirm('정말로 이 사업장을 삭제하시겠습니까?')) return;
        
        try {
            const response = await fetch(`/api/admin/sites/${siteId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('사업장이 삭제되었습니다.');
                await this.loadSitesTree(); // 트리 새로고침
            } else {
                alert('삭제 실패: ' + data.message);
            }
        } catch (error) {
            console.error('사이트 삭제 오류:', error);
            alert('사업장 삭제 중 오류가 발생했습니다.');
        }
    },

    // 사이트 모달 닫기
    closeSiteModal() {
        const modal = document.getElementById('site-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
        }
        currentEditSiteId = null;
    },

    // 사이트 저장
    async saveSite() {
        const formData = {
            name: document.getElementById('site-name').value,
            code: document.getElementById('site-code').value,
            site_type: document.getElementById('site-type').value,
            address: document.getElementById('site-address').value,
            contact_person: document.getElementById('site-contact').value,
            contact_phone: document.getElementById('site-phone').value,
            description: document.getElementById('site-description').value,
            is_active: document.getElementById('site-active').checked,
            parent_id: document.getElementById('parent-id').value || null
        };
        
        try {
            let response;
            if (currentEditSiteId) {
                // 수정
                response = await fetch(`/api/admin/sites/${currentEditSiteId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            } else {
                // 추가
                response = await fetch('/api/admin/sites', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            const data = await response.json();
            
            if (data.success) {
                alert(currentEditSiteId ? '사업장이 수정되었습니다.' : '사업장이 추가되었습니다.');
                this.closeSiteModal();
                await this.loadSitesTree();
                await this.loadSitesTable();
            } else {
                alert('저장 실패: ' + data.message);
            }
        } catch (error) {
            console.error('사이트 저장 오류:', error);
            alert('저장 중 오류가 발생했습니다.');
        }
    },

    // 사이트 테이블 로드
    async loadSitesTable() {
        try {
            const response = await fetch('/api/admin/sites');
            const data = await response.json();
            
            if (data.success && data.sites) {
                const tableBody = document.getElementById('sites-table-body');
                if (!tableBody) return;
                
                tableBody.innerHTML = data.sites.map(site => `
                    <tr>
                        <td>${site.name}</td>
                        <td>${site.code}</td>
                        <td>${this.getSiteTypeDisplay(site.site_type)}</td>
                        <td>${site.contact_person || '-'}</td>
                        <td>${site.contact_phone || '-'}</td>
                        <td>
                            <span class="status ${site.is_active ? 'active' : 'inactive'}">
                                ${site.is_active ? '활성' : '비활성'}
                            </span>
                        </td>
                        <td class="actions">
                            <button onclick="SitesModule.editSite(${site.id})" class="btn btn-sm btn-primary">수정</button>
                            <button onclick="SitesModule.deleteSite(${site.id})" class="btn btn-sm btn-danger">삭제</button>
                        </td>
                    </tr>
                `).join('');
            }
        } catch (error) {
            console.error('사이트 테이블 로드 오류:', error);
        }
    }
};

// 사업장 유형 번역 함수
function siteTranslator(siteType) {
    const translations = {
        'head': '본사',
        'branch': '지사',
        'location': '사업장',
        '일반': '일반'
    };
    return translations[siteType] || siteType;
}

// 전역 함수로 노출 (기존 호환성 유지)
window.siteTranslator = siteTranslator;
window.loadSitesTree = () => window.SitesModule.loadSitesTree();
window.renderSitesTree = () => window.SitesModule.renderSitesTree();
window.expandAllSites = () => window.SitesModule.expandAllSites();
window.collapseAllSites = () => window.SitesModule.collapseAllSites();
window.selectSite = (siteId) => window.SitesModule.selectSite(siteId);
window.showSiteDetails = (siteId) => window.SitesModule.showSiteDetails(siteId);
window.closeSiteDetails = () => window.SitesModule.closeSiteDetails();
window.showAddSiteModal = (siteType, parentId) => window.SitesModule.showAddSiteModal(siteType, parentId);
window.editSite = (siteId) => window.SitesModule.editSite(siteId);
window.deleteSite = (siteId) => window.SitesModule.deleteSite(siteId);
window.closeSiteModal = () => window.SitesModule.closeSiteModal();
window.saveSite = () => window.SitesModule.saveSite();
window.loadSitesTable = () => window.SitesModule.loadSitesTable();

})(); // IIFE 종료