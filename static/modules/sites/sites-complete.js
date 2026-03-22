// 사업장 관리 모듈
(function() {
'use strict';

// 사업장 관련 변수
let sitesData = [];
let selectedSiteId = null;
let draggedSite = null;
let currentEditSiteId = null;

// 사업장 관리 모듈 객체 (여러 이름으로 접근 가능하게 설정)
window.SitesModule = window.SitesAdminModule = window.SiteManagement = {
    // 초기화
    async init() {
        console.log('🏢 사업장 관리 모듈 초기화');
        await this.loadSitesTree();
        await this.loadSitesStatistics();
    },

    // 관리자 대시보드 호환성을 위한 load 메서드
    async load() {
        console.log('🏢 사업장 모듈 로드 시작');
        await this.init();
        this.isLoaded = true;
        console.log('🏢 사업장 모듈 로드 완료');
        return this;
    },

    // 사업장 목록 로드
    async loadSitesTree() {
        console.log('🏢 사업장 목록 로드 시작...');
        try {
            const response = await fetch(`${CONFIG.API.BASE_URL}/api/admin/business-locations`);
            console.log('📡 API 응답 상태:', response.status);
            const data = await response.json();
            console.log('📊 API 응답 데이터:', data);
            
            if (data.success) {
                sitesData = data.sites || [];
                console.log('✅ 사업장 데이터 설정:', sitesData);
                console.log('🔢 사업장 개수:', sitesData.length);
                this.renderSitesTable();
            } else {
                console.error('❌ API 응답 오류:', data.message);
                const tableBody = document.getElementById('sites-table-body');
                if (tableBody) {
                    tableBody.innerHTML = '<tr><td colspan="8" class="text-center">사업장 정보를 불러올 수 없습니다.</td></tr>';
                }
            }
        } catch (error) {
            console.error('💥 사업장 목록 로드 실패:', error);
            const tableBody = document.getElementById('sites-table-body');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="8" class="text-center">사업장 정보를 불러올 수 없습니다.</td></tr>';
            }
        }
    },

    // 사업장 통계 로드
    async loadSitesStatistics() {
        try {
            const response = await fetch('http://localhost:9000/api/admin/list-sites-simple');
            const data = await response.json();
            
            if (data.success && data.sites) {
                const sites = data.sites;
                const totalSites = sites.length;
                const activeSites = sites.filter(site => site.is_active !== false).length;
                const siteTypes = {};
                
                // 사업장 타입별 통계
                sites.forEach(site => {
                    const type = site.site_type || '일반';
                    siteTypes[type] = (siteTypes[type] || 0) + 1;
                });
                
                // 통계 카드 업데이트
                this.updateSitesStatistics({
                    total: totalSites,
                    active: activeSites,
                    inactive: totalSites - activeSites,
                    types: siteTypes
                });
                
                console.log('사업장 통계:', { totalSites, activeSites, siteTypes });
            }
        } catch (error) {
            console.error('사업장 통계 로드 실패:', error);
        }
    },

    // 사업장 통계 업데이트
    updateSitesStatistics(stats) {
        // 대시보드 사업장 타입별 통계 카드 업데이트
        const schoolSitesElement = document.getElementById('school-sites-count');
        const transportSitesElement = document.getElementById('transport-sites-count');
        const lunchboxSitesElement = document.getElementById('lunchbox-sites-count');
        const nursingSitesElement = document.getElementById('nursing-sites-count');
        
        if (schoolSitesElement) schoolSitesElement.textContent = stats.types['학교'] || 0;
        if (transportSitesElement) transportSitesElement.textContent = stats.types['운반'] || 0;
        if (lunchboxSitesElement) lunchboxSitesElement.textContent = stats.types['도시락'] || 0;
        if (nursingSitesElement) nursingSitesElement.textContent = stats.types['요양원'] || 0;
        
        console.log('사업장 통계 카드 업데이트 완료:', stats);
        console.log('사업장 타입별 분포:', stats.types);
    },

    // 사업장 테이블 렌더링
    renderSitesTable() {
        console.log('🎨 사업장 테이블 렌더링 시작...');
        const tableBody = document.getElementById('sites-table-body');
        console.log('📦 테이블 body 찾기:', tableBody ? '찾음' : '없음');
        if (!tableBody) {
            console.log('❌ sites-table-body를 찾을 수 없습니다.');
            return;
        }
        
        console.log('📋 사업장 데이터 확인:', sitesData);
        console.log('🔍 데이터 타입:', Array.isArray(sitesData) ? '배열' : typeof sitesData);
        console.log('📊 데이터 길이:', sitesData.length);
        
        if (!Array.isArray(sitesData) || sitesData.length === 0) {
            console.log('⚠️ 사업장 데이터가 없거나 배열이 아님');
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center">등록된 사업장이 없습니다.</td></tr>';
            return;
        }
        
        // 테이블 행들 생성
        let tableRows = '';
        sitesData.forEach((site, index) => {
            console.log(`🏢 사업장 ${index + 1} 렌더링:`, site);
            const createdAt = site.created_at ? new Date(site.created_at).toLocaleDateString('ko-KR') : '-';
            const status = site.is_active ? '활성' : '비활성';
            const statusClass = site.is_active ? 'status-active' : 'status-inactive';
            
            tableRows += `
                <tr>
                    <td>${site.id}</td>
                    <td>${site.name || '-'}</td>
                    <td>${site.site_type || '-'}</td>
                    <td>${site.code || '-'}</td>
                    <td>${site.level || '-'}</td>
                    <td><span class="status ${statusClass}">${status}</span></td>
                    <td>${createdAt}</td>
                    <td>
                        <button class="btn-sm btn-edit" onclick="SitesModule.editSite(${site.id})" title="편집" style="margin-right: 5px; background: #007bff; color: white; border: none; padding: 5px 8px; border-radius: 3px; cursor: pointer;">
                            편집
                        </button>
                        <button class="btn-sm btn-delete" onclick="SitesModule.deleteSite(${site.id})" title="삭제" style="background: #dc3545; color: white; border: none; padding: 5px 8px; border-radius: 3px; cursor: pointer;">
                            삭제
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = tableRows;
        console.log('✅ 사업장 테이블 렌더링 완료');
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
    showAddSiteModal(siteType = null, parentId = null) {
        console.log('🆕 새 사업장 모달 열기');
        currentEditSiteId = null;
        
        const modal = document.getElementById('site-modal');
        const form = document.getElementById('site-form');
        const title = document.getElementById('site-modal-title');
        
        if (!modal || !form || !title) {
            console.error('❌ 모달 요소들을 찾을 수 없습니다.');
            return;
        }
        
        // 폼 초기화
        form.reset();
        document.getElementById('site-active').checked = true;
        
        // 제목과 버튼 텍스트 설정
        title.textContent = '새 사업장 등록';
        document.getElementById('site-save-btn').textContent = '등록';
        
        // 사업장 유형 설정 (선택적)
        const siteTypeSelect = document.getElementById('site-type');
        if (siteTypeSelect && siteType) {
            siteTypeSelect.value = siteType;
        }
        
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
        
        // 포커스 설정
        setTimeout(() => {
            const firstInput = document.getElementById('site-name');
            if (firstInput) firstInput.focus();
        }, 100);
    },

    // 사이트 편집
    async editSite(siteId) {
        try {
            console.log('✏️ 사업장 편집 요청:', siteId);
            const response = await fetch(`/api/admin/sites/${siteId}`);
            const data = await response.json();
            
            if (data.success && data.site) {
                const site = data.site;
                console.log('편집할 사업장 정보:', site);
                currentEditSiteId = siteId;
                
                const modal = document.getElementById('site-modal');
                const form = document.getElementById('site-form');
                const title = document.getElementById('site-modal-title');
                
                if (!modal || !form || !title) {
                    console.error('❌ 모달 요소들을 찾을 수 없습니다.');
                    return;
                }
                
                // 모달 폼에 데이터 채우기
                document.getElementById('site-name').value = site.name || '';
                document.getElementById('site-code').value = site.code || '';
                document.getElementById('site-type').value = site.site_type || '';
                document.getElementById('site-address').value = site.address || '';
                document.getElementById('site-contact').value = site.contact_person || '';
                document.getElementById('site-phone').value = site.contact_phone || '';
                document.getElementById('site-description').value = site.description || '';
                document.getElementById('site-active').checked = site.is_active || false;
                
                // 제목과 버튼 텍스트 설정
                title.textContent = '사업장 수정';
                document.getElementById('site-save-btn').textContent = '수정';
                
                // 모달 표시
                modal.style.display = 'flex';
                modal.classList.remove('hidden');
                
                // 첫 번째 입력 필드에 포커스
                setTimeout(() => {
                    const firstInput = document.getElementById('site-name');
                    if (firstInput) firstInput.focus();
                }, 100);
            } else {
                alert('사업장 정보를 불러올 수 없습니다.');
            }
        } catch (error) {
            console.error('사이트 편집 오류:', error);
            alert('편집 중 오류가 발생했습니다.');
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
                await this.loadSitesTree(); // 테이블 새로고침
                await this.loadSitesStatistics(); // 통계 새로고침
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
        console.log('❌ 모달 닫기');
        const modal = document.getElementById('site-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
            
            // 폼 초기화
            const form = document.getElementById('site-form');
            if (form) {
                form.reset();
            }
        }
        currentEditSiteId = null;
    },

    // 사이트 저장
    async saveSite(event) {
        if (event) {
            event.preventDefault();
        }
        
        console.log('💾 사업장 저장 시작...');
        
        const formData = {
            name: document.getElementById('site-name').value.trim(),
            code: document.getElementById('site-code').value.trim(),
            site_type: document.getElementById('site-type').value,
            address: document.getElementById('site-address').value.trim(),
            contact_person: document.getElementById('site-contact').value.trim(),
            contact_phone: document.getElementById('site-phone').value.trim(),
            description: document.getElementById('site-description').value.trim(),
            is_active: document.getElementById('site-active').checked
        };
        
        // 유효성 검사
        if (!formData.name) {
            alert('사업장명을 입력해주세요.');
            return;
        }
        if (!formData.site_type) {
            alert('사업장 유형을 선택해주세요.');
            return;
        }
        
        console.log('📝 저장할 데이터:', formData);
        
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
                response = await fetch('http://localhost:9000/api/admin/sites', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            const data = await response.json();
            
            if (data.success) {
                const isEdit = !!currentEditSiteId;
                console.log(isEdit ? '✅ 사업장 수정 완료' : '✅ 사업장 생성 완료');
                alert(isEdit ? '사업장이 수정되었습니다.' : '사업장이 추가되었습니다.');
                this.closeSiteModal();
                await this.loadSitesTree(); // 테이블 새로고침
                await this.loadSitesStatistics(); // 통계 새로고침
            } else {
                console.error('❌ 저장 실패:', data.message);
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
            const response = await fetch('http://localhost:9000/api/admin/sites');
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

// 모듈 로드 완료 로그
console.log('🏢 Sites Module 정의 완료');

// 전역 함수로 통계 강제 로드 (디버깅용)
window.forceSitesStatsLoad = function() {
    console.log('🔄 강제 사업장 통계 로드 시작');
    if (window.SitesModule) {
        window.SitesModule.loadSitesStatistics();
    }
};

// 전역 함수로 강제 초기화 (디버깅용)  
window.forceSitesInit = function() {
    console.log('🔄 강제 사업장 모듈 초기화 시작');
    if (window.SitesModule) {
        window.SitesModule.init();
    }
};

})(); // IIFE 종료