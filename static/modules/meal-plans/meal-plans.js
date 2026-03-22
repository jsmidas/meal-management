/**
 * 다함 식자재 관리 시스템 - 식단 관리 모듈
 * 30개 식단 동시 운영을 위한 프론트엔드 모듈
 */

class MealPlansManager {
    constructor() {
        this.apiBaseUrl = '/api/meal-plans';
        this.currentTab = 'masters';
        this.currentPage = 1;
        this.pageSize = 20;
        this.filters = {};
        this.mealPlans = [];
        this.schedules = [];

        // DOM 요소들
        this.container = null;
        this.tabButtons = null;
        this.tabPanes = null;

        // 상태 관리
        this.isLoading = false;
        this.selectedItems = new Set();

        this.init();
    }

    init() {
        this.createUI();
        this.bindEvents();
        this.loadDashboardStats();
        this.loadMealPlanMasters();
    }

    createUI() {
        const container = document.getElementById('meal-plans-content');
        if (!container) {
            console.error('meal-plans-content container not found');
            return;
        }

        container.innerHTML = `
            <div class="meal-plans-container">
                <!-- 헤더 -->
                <div class="meal-plans-header">
                    <div>
                        <h1 class="meal-plans-title">식단 관리</h1>
                        <p class="meal-plans-subtitle">30개 식단 동시 운영 관리 시스템</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-primary" onclick="mealPlansManager.showCreateMealPlanModal()">
                            <i class="fas fa-plus"></i> 새 식단 생성
                        </button>
                        <button class="btn btn-success" onclick="mealPlansManager.showBulkScheduleModal()">
                            <i class="fas fa-calendar-plus"></i> 일괄 스케줄링
                        </button>
                        <button class="btn btn-warning" onclick="mealPlansManager.exportToExcel()">
                            <i class="fas fa-download"></i> Excel 내보내기
                        </button>
                    </div>
                </div>

                <!-- 대시보드 통계 -->
                <div class="dashboard-stats" id="dashboard-stats">
                    <div class="stat-card primary">
                        <h3 id="total-meal-plans">-</h3>
                        <p>전체 식단</p>
                    </div>
                    <div class="stat-card success">
                        <h3 id="active-meal-plans">-</h3>
                        <p>활성 식단</p>
                    </div>
                    <div class="stat-card info">
                        <h3 id="total-target-people">-</h3>
                        <p>총 대상 인원</p>
                    </div>
                    <div class="stat-card warning">
                        <h3 id="total-monthly-budget">-</h3>
                        <p>월 총 예산 (원)</p>
                    </div>
                    <div class="stat-card danger">
                        <h3 id="budget-usage-rate">-</h3>
                        <p>예산 사용률 (%)</p>
                    </div>
                    <div class="stat-card secondary">
                        <h3 id="available-slots">-</h3>
                        <p>사용 가능 슬롯</p>
                    </div>
                </div>

                <!-- 탭 네비게이션 -->
                <div class="meal-plans-tabs">
                    <button class="tab-button active" data-tab="masters">식단 마스터</button>
                    <button class="tab-button" data-tab="schedules">식단 스케줄</button>
                    <button class="tab-button" data-tab="analysis">비용 분석</button>
                    <button class="tab-button" data-tab="requirements">소요량 관리</button>
                    <button class="tab-button" data-tab="calendar">주간 캘린더</button>
                </div>

                <!-- 탭 컨텐츠 -->
                <div class="tab-content">
                    <!-- 식단 마스터 탭 -->
                    <div class="tab-pane active" id="masters-tab">
                        <div class="filters-section">
                            <div class="filter-group">
                                <label>상태</label>
                                <select id="masters-status-filter">
                                    <option value="">전체</option>
                                    <option value="active">활성</option>
                                    <option value="inactive">비활성</option>
                                    <option value="suspended">중단</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>사업장</label>
                                <select id="masters-location-filter">
                                    <option value="">전체 사업장</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>식단명 검색</label>
                                <input type="text" id="masters-search" placeholder="식단명 입력">
                            </div>
                            <div class="filter-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-secondary" onclick="mealPlansManager.filterMasterData()">검색</button>
                            </div>
                        </div>

                        <div id="masters-table-container">
                            <div class="loading">데이터를 불러오는 중...</div>
                        </div>

                        <div id="masters-pagination" class="pagination"></div>
                    </div>

                    <!-- 식단 스케줄 탭 -->
                    <div class="tab-pane" id="schedules-tab">
                        <div class="filters-section">
                            <div class="filter-group">
                                <label>식단</label>
                                <select id="schedules-meal-plan-filter">
                                    <option value="">전체 식단</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>시작일</label>
                                <input type="date" id="schedules-start-date">
                            </div>
                            <div class="filter-group">
                                <label>종료일</label>
                                <input type="date" id="schedules-end-date">
                            </div>
                            <div class="filter-group">
                                <label>승인 상태</label>
                                <select id="schedules-status-filter">
                                    <option value="">전체</option>
                                    <option value="draft">초안</option>
                                    <option value="approved">승인</option>
                                    <option value="served">제공완료</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-secondary" onclick="mealPlansManager.filterScheduleData()">검색</button>
                            </div>
                        </div>

                        <div id="schedules-table-container">
                            <div class="loading">데이터를 불러오는 중...</div>
                        </div>

                        <div id="schedules-pagination" class="pagination"></div>
                    </div>

                    <!-- 비용 분석 탭 -->
                    <div class="tab-pane" id="analysis-tab">
                        <div class="chart-container">
                            <div class="chart-header">
                                <h3 class="chart-title">식단별 비용 분석</h3>
                                <div class="chart-controls">
                                    <select id="analysis-meal-plan">
                                        <option value="">식단을 선택하세요</option>
                                    </select>
                                    <input type="date" id="analysis-start-date">
                                    <input type="date" id="analysis-end-date">
                                    <button class="btn btn-primary" onclick="mealPlansManager.loadCostAnalysis()">분석</button>
                                </div>
                            </div>
                            <div class="chart-body" id="cost-analysis-content">
                                식단과 기간을 선택한 후 분석 버튼을 클릭하세요.
                            </div>
                        </div>
                    </div>

                    <!-- 소요량 관리 탭 -->
                    <div class="tab-pane" id="requirements-tab">
                        <div class="chart-container">
                            <div class="chart-header">
                                <h3 class="chart-title">식자재 소요량 계산</h3>
                                <div class="chart-controls">
                                    <select id="requirements-meal-plan">
                                        <option value="">식단을 선택하세요</option>
                                    </select>
                                    <input type="date" id="requirements-start-date">
                                    <input type="date" id="requirements-end-date">
                                    <button class="btn btn-primary" onclick="mealPlansManager.loadIngredientRequirements()">계산</button>
                                </div>
                            </div>
                            <div class="chart-body" id="requirements-content">
                                식단과 기간을 선택한 후 계산 버튼을 클릭하세요.
                            </div>
                        </div>
                    </div>

                    <!-- 주간 캘린더 탭 -->
                    <div class="tab-pane" id="calendar-tab">
                        <div class="chart-container">
                            <div class="chart-header">
                                <h3 class="chart-title">주간 식단 캘린더</h3>
                                <div class="chart-controls">
                                    <button class="btn btn-secondary" onclick="mealPlansManager.loadWeeklySummary(-1)">이전 주</button>
                                    <button class="btn btn-primary" onclick="mealPlansManager.loadWeeklySummary(0)">이번 주</button>
                                    <button class="btn btn-secondary" onclick="mealPlansManager.loadWeeklySummary(1)">다음 주</button>
                                </div>
                            </div>
                            <div class="chart-body" id="calendar-content">
                                <div class="loading">캘린더를 불러오는 중...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 모달들 -->
            <div id="modal-container"></div>
        `;

        this.container = container.querySelector('.meal-plans-container');
        this.tabButtons = container.querySelectorAll('.tab-button');
        this.tabPanes = container.querySelectorAll('.tab-pane');
    }

    bindEvents() {
        // 탭 버튼 이벤트
        this.tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // 키보드 이벤트
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
    }

    switchTab(tabName) {
        // 탭 버튼 활성화
        this.tabButtons.forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // 탭 패널 활성화
        this.tabPanes.forEach(pane => pane.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');

        this.currentTab = tabName;

        // 탭별 데이터 로드
        switch (tabName) {
            case 'masters':
                this.loadMealPlanMasters();
                break;
            case 'schedules':
                this.loadMealPlanSchedules();
                break;
            case 'analysis':
                this.setupAnalysisTab();
                break;
            case 'requirements':
                this.setupRequirementsTab();
                break;
            case 'calendar':
                this.loadWeeklySummary(0);
                break;
        }
    }

    async loadDashboardStats() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/dashboard-stats`);
            const data = await response.json();

            if (response.ok) {
                this.updateDashboardStats(data);
            } else {
                console.error('Failed to load dashboard stats:', data);
            }
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
        }
    }

    updateDashboardStats(stats) {
        document.getElementById('total-meal-plans').textContent = stats.total_meal_plans || 0;
        document.getElementById('active-meal-plans').textContent = stats.active_meal_plans || 0;
        document.getElementById('total-target-people').textContent = (stats.total_target_people || 0).toLocaleString();
        document.getElementById('total-monthly-budget').textContent = (stats.total_monthly_budget || 0).toLocaleString();
        document.getElementById('budget-usage-rate').textContent = `${stats.budget_usage_rate || 0}%`;
        document.getElementById('available-slots').textContent = stats.available_slots || 0;

        // 예산 사용률에 따른 색상 변경
        const usageElement = document.getElementById('budget-usage-rate').parentElement;
        if (stats.budget_usage_rate > 90) {
            usageElement.className = 'stat-card danger';
        } else if (stats.budget_usage_rate > 75) {
            usageElement.className = 'stat-card warning';
        } else {
            usageElement.className = 'stat-card success';
        }
    }

    async loadMealPlanMasters() {
        const container = document.getElementById('masters-table-container');
        container.innerHTML = '<div class="loading">데이터를 불러오는 중...</div>';

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                size: this.pageSize,
                ...this.filters
            });

            const response = await fetch(`${this.apiBaseUrl}/masters?${params}`);
            const data = await response.json();

            if (response.ok) {
                this.mealPlans = data.items;
                this.renderMasterTable(data);
                this.renderPagination('masters', data);
            } else {
                container.innerHTML = `<div class="alert alert-danger">데이터 로드 실패: ${data.detail}</div>`;
            }
        } catch (error) {
            console.error('Error loading meal plan masters:', error);
            container.innerHTML = '<div class="alert alert-danger">데이터 로드 중 오류가 발생했습니다.</div>';
        }
    }

    renderMasterTable(data) {
        const container = document.getElementById('masters-table-container');

        if (data.items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 식단이 없습니다</h3>
                    <p>새 식단을 생성하여 관리를 시작하세요.</p>
                    <button class="btn btn-primary" onclick="mealPlansManager.showCreateMealPlanModal()">
                        새 식단 생성
                    </button>
                </div>
            `;
            return;
        }

        const table = `
            <table class="meal-plans-table">
                <thead>
                    <tr>
                        <th>식단명</th>
                        <th>사업장</th>
                        <th>식사 유형</th>
                        <th>대상 인원</th>
                        <th>월 예산</th>
                        <th>상태</th>
                        <th>스케줄 수</th>
                        <th>평균 비용</th>
                        <th>작업</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.items.map(item => `
                        <tr>
                            <td>
                                <strong>${item.name}</strong>
                                ${item.special_requirements ? `<br><small style="color: #666;">${item.special_requirements}</small>` : ''}
                            </td>
                            <td>${item.location_name || '-'}</td>
                            <td>
                                <span class="status-badge ${item.meal_type}">
                                    ${this.getMealTypeLabel(item.meal_type)}
                                </span>
                            </td>
                            <td>${item.target_people_count?.toLocaleString() || 0}명</td>
                            <td>₩${(item.budget_per_month || 0).toLocaleString()}</td>
                            <td>
                                <span class="status-badge ${item.status}">
                                    ${this.getStatusLabel(item.status)}
                                </span>
                            </td>
                            <td>${item.scheduled_days || 0}일</td>
                            <td>₩${Math.round(item.avg_actual_cost || item.avg_estimated_cost || 0).toLocaleString()}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn btn-primary" onclick="mealPlansManager.showEditMealPlanModal(${item.id})" title="수정">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-success" onclick="mealPlansManager.showScheduleModal(${item.id})" title="스케줄 관리">
                                        <i class="fas fa-calendar"></i>
                                    </button>
                                    <button class="btn btn-warning" onclick="mealPlansManager.showBudgetAnalysis(${item.id})" title="예산 분석">
                                        <i class="fas fa-chart-bar"></i>
                                    </button>
                                    <button class="btn btn-danger" onclick="mealPlansManager.deleteMealPlan(${item.id})" title="삭제">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
    }

    getMealTypeLabel(type) {
        const labels = {
            breakfast: '아침',
            lunch: '점심',
            dinner: '저녁',
            snack: '간식'
        };
        return labels[type] || type;
    }

    getStatusLabel(status) {
        const labels = {
            active: '활성',
            inactive: '비활성',
            suspended: '중단',
            draft: '초안',
            approved: '승인',
            served: '제공완료'
        };
        return labels[status] || status;
    }

    renderPagination(type, data) {
        const container = document.getElementById(`${type}-pagination`);
        const totalPages = data.pages;
        const currentPage = data.page;

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let pagination = `
            <button ${currentPage <= 1 ? 'disabled' : ''} onclick="mealPlansManager.changePage(${currentPage - 1})">
                이전
            </button>
        `;

        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        for (let i = startPage; i <= endPage; i++) {
            pagination += `
                <button class="${i === currentPage ? 'active' : ''}" onclick="mealPlansManager.changePage(${i})">
                    ${i}
                </button>
            `;
        }

        pagination += `
            <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="mealPlansManager.changePage(${currentPage + 1})">
                다음
            </button>
            <span class="pagination-info">
                ${data.total}개 중 ${(currentPage - 1) * this.pageSize + 1}-${Math.min(currentPage * this.pageSize, data.total)}
            </span>
        `;

        container.innerHTML = pagination;
    }

    changePage(page) {
        this.currentPage = page;
        if (this.currentTab === 'masters') {
            this.loadMealPlanMasters();
        } else if (this.currentTab === 'schedules') {
            this.loadMealPlanSchedules();
        }
    }

    filterMasterData() {
        this.filters = {
            status: document.getElementById('masters-status-filter').value,
            location_id: document.getElementById('masters-location-filter').value,
            search: document.getElementById('masters-search').value
        };
        this.currentPage = 1;
        this.loadMealPlanMasters();
    }

    async loadMealPlanSchedules() {
        const container = document.getElementById('schedules-table-container');
        container.innerHTML = '<div class="loading">데이터를 불러오는 중...</div>';

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                size: this.pageSize
            });

            // 필터 추가
            const mealPlanId = document.getElementById('schedules-meal-plan-filter')?.value;
            const startDate = document.getElementById('schedules-start-date')?.value;
            const endDate = document.getElementById('schedules-end-date')?.value;
            const status = document.getElementById('schedules-status-filter')?.value;

            if (mealPlanId) params.append('meal_plan_id', mealPlanId);
            if (startDate) params.append('start_date', startDate);
            if (endDate) params.append('end_date', endDate);
            if (status) params.append('approval_status', status);

            const response = await fetch(`${this.apiBaseUrl}/schedules?${params}`);
            const data = await response.json();

            if (response.ok) {
                this.schedules = data.items;
                this.renderScheduleTable(data);
                this.renderPagination('schedules', data);
            } else {
                container.innerHTML = `<div class="alert alert-danger">데이터 로드 실패: ${data.detail}</div>`;
            }
        } catch (error) {
            console.error('Error loading meal plan schedules:', error);
            container.innerHTML = '<div class="alert alert-danger">데이터 로드 중 오류가 발생했습니다.</div>';
        }
    }

    renderScheduleTable(data) {
        const container = document.getElementById('schedules-table-container');

        if (data.items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 스케줄이 없습니다</h3>
                    <p>식단 스케줄을 추가하여 계획을 수립하세요.</p>
                </div>
            `;
            return;
        }

        const table = `
            <table class="meal-plans-table">
                <thead>
                    <tr>
                        <th>식단명</th>
                        <th>계획일</th>
                        <th>요일</th>
                        <th>레시피</th>
                        <th>제공 인원</th>
                        <th>예상 비용</th>
                        <th>실제 비용</th>
                        <th>상태</th>
                        <th>작업</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.items.map(item => `
                        <tr>
                            <td><strong>${item.meal_plan_name}</strong></td>
                            <td>${item.plan_date}</td>
                            <td>${this.getDayOfWeekLabel(item.day_of_week)}</td>
                            <td>${item.recipe_name || '-'}</td>
                            <td>${(item.serving_count || 0).toLocaleString()}명</td>
                            <td>₩${(item.estimated_cost || 0).toLocaleString()}</td>
                            <td>₩${(item.actual_cost || 0).toLocaleString()}</td>
                            <td>
                                <span class="status-badge ${item.approval_status}">
                                    ${this.getStatusLabel(item.approval_status)}
                                </span>
                            </td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn btn-primary" onclick="mealPlansManager.showEditScheduleModal(${item.id})" title="수정">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-success" onclick="mealPlansManager.approveSchedule(${item.id})" title="승인">
                                        <i class="fas fa-check"></i>
                                    </button>
                                    <button class="btn btn-warning" onclick="mealPlansManager.showCostCalculation(${item.id})" title="비용 계산">
                                        <i class="fas fa-calculator"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
    }

    getDayOfWeekLabel(dayOfWeek) {
        const labels = ['', '월', '화', '수', '목', '금', '토', '일'];
        return labels[dayOfWeek] || dayOfWeek;
    }

    // 모달 관련 메서드들
    showCreateMealPlanModal() {
        // 30개 제한 확인
        const activeCount = parseInt(document.getElementById('active-meal-plans').textContent);
        if (activeCount >= 30) {
            alert('최대 30개의 활성 식단만 운영 가능합니다.');
            return;
        }

        const modal = this.createModal('새 식단 생성', this.getMealPlanFormHTML(), [
            { text: '취소', className: 'btn btn-secondary', onclick: 'mealPlansManager.closeModal()' },
            { text: '생성', className: 'btn btn-primary', onclick: 'mealPlansManager.saveMealPlan()' }
        ]);

        this.showModal(modal);
        this.loadBusinessLocations();
    }

    showEditMealPlanModal(id) {
        const mealPlan = this.mealPlans.find(mp => mp.id === id);
        if (!mealPlan) return;

        const modal = this.createModal('식단 수정', this.getMealPlanFormHTML(mealPlan), [
            { text: '취소', className: 'btn btn-secondary', onclick: 'mealPlansManager.closeModal()' },
            { text: '저장', className: 'btn btn-primary', onclick: `mealPlansManager.updateMealPlan(${id})` }
        ]);

        this.showModal(modal);
        this.loadBusinessLocations();
    }

    getMealPlanFormHTML(mealPlan = null) {
        return `
            <form id="meal-plan-form">
                <div class="form-row">
                    <div class="form-group">
                        <label>식단명 *</label>
                        <input type="text" id="meal-plan-name" required value="${mealPlan?.name || ''}">
                    </div>
                    <div class="form-group">
                        <label>사업장 *</label>
                        <select id="meal-plan-location" required>
                            <option value="">사업장을 선택하세요</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>식사 유형 *</label>
                        <select id="meal-plan-type" required>
                            <option value="">선택하세요</option>
                            <option value="breakfast" ${mealPlan?.meal_type === 'breakfast' ? 'selected' : ''}>아침</option>
                            <option value="lunch" ${mealPlan?.meal_type === 'lunch' ? 'selected' : ''}>점심</option>
                            <option value="dinner" ${mealPlan?.meal_type === 'dinner' ? 'selected' : ''}>저녁</option>
                            <option value="snack" ${mealPlan?.meal_type === 'snack' ? 'selected' : ''}>간식</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>대상 인원</label>
                        <input type="number" id="meal-plan-people" min="0" value="${mealPlan?.target_people_count || 0}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>1식당 예산 (원)</label>
                        <input type="number" id="meal-plan-budget-per-meal" min="0" value="${mealPlan?.budget_per_meal || 0}">
                    </div>
                    <div class="form-group">
                        <label>월 예산 (원)</label>
                        <input type="number" id="meal-plan-budget-monthly" min="0" value="${mealPlan?.budget_per_month || 0}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>시작일 *</label>
                        <input type="date" id="meal-plan-start-date" required value="${mealPlan?.start_date || ''}">
                    </div>
                    <div class="form-group">
                        <label>종료일</label>
                        <input type="date" id="meal-plan-end-date" value="${mealPlan?.end_date || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label>특별 요구사항</label>
                    <textarea id="meal-plan-requirements" rows="3">${mealPlan?.special_requirements || ''}</textarea>
                </div>
                ${mealPlan ? `
                <div class="form-group">
                    <label>상태</label>
                    <select id="meal-plan-status">
                        <option value="active" ${mealPlan.status === 'active' ? 'selected' : ''}>활성</option>
                        <option value="inactive" ${mealPlan.status === 'inactive' ? 'selected' : ''}>비활성</option>
                        <option value="suspended" ${mealPlan.status === 'suspended' ? 'selected' : ''}>중단</option>
                    </select>
                </div>
                ` : ''}
            </form>
        `;
    }

    createModal(title, body, buttons = []) {
        return `
            <div class="modal-overlay" onclick="mealPlansManager.closeModal(event)">
                <div class="modal" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h3 class="modal-title">${title}</h3>
                        <button class="modal-close" onclick="mealPlansManager.closeModal()">×</button>
                    </div>
                    <div class="modal-body">
                        ${body}
                    </div>
                    <div class="modal-footer">
                        ${buttons.map(btn => `
                            <button class="${btn.className}" onclick="${btn.onclick}">
                                ${btn.text}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    showModal(modalHTML) {
        const container = document.getElementById('modal-container');
        container.innerHTML = modalHTML;
    }

    closeModal(event) {
        if (event && event.target.classList.contains('modal-overlay')) {
            const container = document.getElementById('modal-container');
            container.innerHTML = '';
        } else if (!event) {
            const container = document.getElementById('modal-container');
            container.innerHTML = '';
        }
    }

    closeAllModals() {
        const container = document.getElementById('modal-container');
        container.innerHTML = '';
    }

    async loadBusinessLocations() {
        try {
            const response = await fetch('/api/admin/business-locations');
            const data = await response.json();

            if (response.ok && data.success) {
                const select = document.getElementById('meal-plan-location');
                if (select) {
                    select.innerHTML = '<option value="">사업장을 선택하세요</option>' +
                        data.items.map(location =>
                            `<option value="${location.id}">${location.name}</option>`
                        ).join('');
                }
            }
        } catch (error) {
            console.error('Error loading business locations:', error);
        }
    }

    async saveMealPlan() {
        const formData = {
            name: document.getElementById('meal-plan-name').value,
            business_location_id: parseInt(document.getElementById('meal-plan-location').value),
            meal_type: document.getElementById('meal-plan-type').value,
            target_people_count: parseInt(document.getElementById('meal-plan-people').value) || 0,
            budget_per_meal: parseFloat(document.getElementById('meal-plan-budget-per-meal').value) || null,
            budget_per_month: parseFloat(document.getElementById('meal-plan-budget-monthly').value) || null,
            start_date: document.getElementById('meal-plan-start-date').value,
            end_date: document.getElementById('meal-plan-end-date').value || null,
            special_requirements: document.getElementById('meal-plan-requirements').value || null
        };

        if (!formData.name || !formData.business_location_id || !formData.meal_type || !formData.start_date) {
            alert('필수 항목을 모두 입력해주세요.');
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/masters`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (response.ok) {
                alert('식단이 성공적으로 생성되었습니다.');
                this.closeModal();
                this.loadDashboardStats();
                this.loadMealPlanMasters();
            } else {
                alert(`생성 실패: ${result.detail}`);
            }
        } catch (error) {
            console.error('Error saving meal plan:', error);
            alert('식단 생성 중 오류가 발생했습니다.');
        }
    }

    async updateMealPlan(id) {
        const formData = {
            name: document.getElementById('meal-plan-name').value,
            target_people_count: parseInt(document.getElementById('meal-plan-people').value) || 0,
            budget_per_meal: parseFloat(document.getElementById('meal-plan-budget-per-meal').value) || null,
            budget_per_month: parseFloat(document.getElementById('meal-plan-budget-monthly').value) || null,
            end_date: document.getElementById('meal-plan-end-date').value || null,
            special_requirements: document.getElementById('meal-plan-requirements').value || null
        };

        const statusElement = document.getElementById('meal-plan-status');
        if (statusElement) {
            formData.status = statusElement.value;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/masters/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (response.ok) {
                alert('식단이 성공적으로 수정되었습니다.');
                this.closeModal();
                this.loadDashboardStats();
                this.loadMealPlanMasters();
            } else {
                alert(`수정 실패: ${result.detail}`);
            }
        } catch (error) {
            console.error('Error updating meal plan:', error);
            alert('식단 수정 중 오류가 발생했습니다.');
        }
    }

    async deleteMealPlan(id) {
        if (!confirm('정말로 이 식단을 삭제하시겠습니까?')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/masters/${id}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (response.ok) {
                alert(result.message);
                this.loadDashboardStats();
                this.loadMealPlanMasters();
            } else {
                alert(`삭제 실패: ${result.detail}`);
            }
        } catch (error) {
            console.error('Error deleting meal plan:', error);
            alert('식단 삭제 중 오류가 발생했습니다.');
        }
    }

    async loadWeeklySummary(weekOffset = 0) {
        const container = document.getElementById('calendar-content');
        container.innerHTML = '<div class="loading">주간 캘린더를 불러오는 중...</div>';

        try {
            const response = await fetch(`${this.apiBaseUrl}/weekly-summary?week_offset=${weekOffset}`);
            const data = await response.json();

            if (response.ok) {
                this.renderWeeklyCalendar(data);
            } else {
                container.innerHTML = `<div class="alert alert-danger">데이터 로드 실패: ${data.detail}</div>`;
            }
        } catch (error) {
            console.error('Error loading weekly summary:', error);
            container.innerHTML = '<div class="alert alert-danger">데이터 로드 중 오류가 발생했습니다.</div>';
        }
    }

    renderWeeklyCalendar(data) {
        const container = document.getElementById('calendar-content');

        // 요일 헤더
        const dayHeaders = ['월', '화', '수', '목', '금', '토', '일'];

        let calendarHTML = `
            <div style="margin-bottom: 20px; text-align: center;">
                <h4>${data.week_info.start_date} ~ ${data.week_info.end_date}</h4>
                <div class="row" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 15px 0;">
                    <div class="stat-card info">
                        <h3>${data.summary.total_schedules}</h3>
                        <p>총 스케줄</p>
                    </div>
                    <div class="stat-card success">
                        <h3>${data.summary.total_servings.toLocaleString()}</h3>
                        <p>총 제공 인원</p>
                    </div>
                    <div class="stat-card warning">
                        <h3>₩${data.summary.total_cost.toLocaleString()}</h3>
                        <p>총 비용</p>
                    </div>
                    <div class="stat-card primary">
                        <h3>₩${data.summary.avg_cost_per_serving.toLocaleString()}</h3>
                        <p>1인당 평균 비용</p>
                    </div>
                </div>
            </div>
            <div class="weekly-calendar">
        `;

        // 요일별 컬럼 생성
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(data.week_info.start_date);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];

            calendarHTML += `
                <div class="calendar-day">
                    <div class="calendar-day-header">
                        ${dayHeaders[i]}<br>
                        <small>${currentDate.getDate()}</small>
                    </div>
            `;

            // 해당 날짜의 식단들
            const daySchedules = data.daily_schedules[dateStr] || [];

            daySchedules.forEach(schedule => {
                calendarHTML += `
                    <div class="calendar-meal-item ${schedule.approval_status}">
                        <div style="font-weight: bold; font-size: 10px;">${schedule.meal_plan_name}</div>
                        <div style="font-size: 9px;">${schedule.recipe_name || '레시피 미정'}</div>
                        <div style="font-size: 9px;">${schedule.serving_count}명</div>
                    </div>
                `;
            });

            calendarHTML += `</div>`;
        }

        calendarHTML += `</div>`;

        container.innerHTML = calendarHTML;
    }

    setupAnalysisTab() {
        // 식단 목록 로드
        this.loadMealPlansForSelect('analysis-meal-plan');

        // 기본 날짜 설정 (이번 달)
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        document.getElementById('analysis-start-date').value = firstDay.toISOString().split('T')[0];
        document.getElementById('analysis-end-date').value = lastDay.toISOString().split('T')[0];
    }

    setupRequirementsTab() {
        // 식단 목록 로드
        this.loadMealPlansForSelect('requirements-meal-plan');

        // 기본 날짜 설정 (이번 주)
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + 1); // 월요일
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6); // 일요일

        document.getElementById('requirements-start-date').value = weekStart.toISOString().split('T')[0];
        document.getElementById('requirements-end-date').value = weekEnd.toISOString().split('T')[0];
    }

    async loadMealPlansForSelect(selectId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/masters?size=100`);
            const data = await response.json();

            if (response.ok) {
                const select = document.getElementById(selectId);
                if (select) {
                    select.innerHTML = '<option value="">식단을 선택하세요</option>' +
                        data.items.filter(mp => mp.status === 'active').map(mp =>
                            `<option value="${mp.id}">${mp.name}</option>`
                        ).join('');
                }
            }
        } catch (error) {
            console.error('Error loading meal plans for select:', error);
        }
    }

    async loadCostAnalysis() {
        const mealPlanId = document.getElementById('analysis-meal-plan').value;
        const startDate = document.getElementById('analysis-start-date').value;
        const endDate = document.getElementById('analysis-end-date').value;

        if (!mealPlanId || !startDate || !endDate) {
            alert('식단과 기간을 모두 선택해주세요.');
            return;
        }

        const container = document.getElementById('cost-analysis-content');
        container.innerHTML = '<div class="loading">비용 분석 중...</div>';

        try {
            const response = await fetch(
                `${this.apiBaseUrl}/cost-analysis/${mealPlanId}?start_date=${startDate}&end_date=${endDate}`
            );
            const data = await response.json();

            if (response.ok) {
                this.renderCostAnalysis(data);
            } else {
                container.innerHTML = `<div class="alert alert-danger">분석 실패: ${data.detail}</div>`;
            }
        } catch (error) {
            console.error('Error loading cost analysis:', error);
            container.innerHTML = '<div class="alert alert-danger">분석 중 오류가 발생했습니다.</div>';
        }
    }

    renderCostAnalysis(data) {
        const container = document.getElementById('cost-analysis-content');

        let html = `
            <div class="row" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card success">
                    <h3>₩${data.total_estimated_cost.toLocaleString()}</h3>
                    <p>총 예상 비용</p>
                </div>
                <div class="stat-card warning">
                    <h3>₩${data.total_actual_cost.toLocaleString()}</h3>
                    <p>총 실제 비용</p>
                </div>
                <div class="stat-card info">
                    <h3>${data.summary.total_days}일</h3>
                    <p>총 계획 일수</p>
                </div>
            </div>
        `;

        if (data.daily_costs && data.daily_costs.length > 0) {
            html += `
                <h4>일별 비용 현황</h4>
                <table class="meal-plans-table">
                    <thead>
                        <tr>
                            <th>날짜</th>
                            <th>레시피</th>
                            <th>제공 인원</th>
                            <th>예상 비용</th>
                            <th>실제 비용</th>
                            <th>계산된 비용</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.daily_costs.map(day => `
                            <tr>
                                <td>${day.plan_date}</td>
                                <td>${day.recipe_name || '-'}</td>
                                <td>${(day.serving_count || 0).toLocaleString()}명</td>
                                <td>₩${(day.estimated_cost || 0).toLocaleString()}</td>
                                <td>₩${(day.actual_cost || 0).toLocaleString()}</td>
                                <td>₩${(day.calculated_cost || 0).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html += '<div class="empty-state"><p>해당 기간에 비용 데이터가 없습니다.</p></div>';
        }

        container.innerHTML = html;
    }

    async loadIngredientRequirements() {
        const mealPlanId = document.getElementById('requirements-meal-plan').value;
        const startDate = document.getElementById('requirements-start-date').value;
        const endDate = document.getElementById('requirements-end-date').value;

        if (!mealPlanId || !startDate || !endDate) {
            alert('식단과 기간을 모두 선택해주세요.');
            return;
        }

        const container = document.getElementById('requirements-content');
        container.innerHTML = '<div class="loading">소요량 계산 중...</div>';

        try {
            const response = await fetch(
                `${this.apiBaseUrl}/ingredient-requirements/${mealPlanId}?start_date=${startDate}&end_date=${endDate}`
            );
            const data = await response.json();

            if (response.ok) {
                this.renderIngredientRequirements(data);
            } else {
                container.innerHTML = `<div class="alert alert-danger">계산 실패: ${data.detail}</div>`;
            }
        } catch (error) {
            console.error('Error loading ingredient requirements:', error);
            container.innerHTML = '<div class="alert alert-danger">계산 중 오류가 발생했습니다.</div>';
        }
    }

    renderIngredientRequirements(data) {
        const container = document.getElementById('requirements-content');

        let html = `
            <div class="row" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card primary">
                    <h3>${data.total_ingredients}</h3>
                    <p>필요 식자재 종류</p>
                </div>
                <div class="stat-card success">
                    <h3>₩${data.total_estimated_cost.toLocaleString()}</h3>
                    <p>총 예상 비용</p>
                </div>
                <div class="stat-card info">
                    <h3>${data.period.start_date} ~ ${data.period.end_date}</h3>
                    <p>계산 기간</p>
                </div>
            </div>
        `;

        if (data.requirements && data.requirements.length > 0) {
            html += `
                <h4>식자재별 소요량</h4>
                <table class="meal-plans-table">
                    <thead>
                        <tr>
                            <th>식자재명</th>
                            <th>필요 수량</th>
                            <th>단위</th>
                            <th>예상 비용</th>
                            <th>사용 식단 수</th>
                            <th>상세 내역</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.requirements.map(req => `
                            <tr>
                                <td><strong>${req.ingredient_name}</strong></td>
                                <td>${req.total_quantity.toLocaleString()}</td>
                                <td>${req.unit}</td>
                                <td>₩${req.estimated_cost.toLocaleString()}</td>
                                <td>${req.usage_details.length}개 식단</td>
                                <td>
                                    <button class="btn btn-secondary" onclick="mealPlansManager.showRequirementDetail(${JSON.stringify(req.usage_details).replace(/"/g, '&quot;')})">
                                        상세보기
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html += '<div class="empty-state"><p>해당 기간에 소요량 데이터가 없습니다.</p></div>';
        }

        container.innerHTML = html;
    }

    showRequirementDetail(usageDetails) {
        const detailHTML = `
            <table class="meal-plans-table">
                <thead>
                    <tr>
                        <th>날짜</th>
                        <th>레시피</th>
                        <th>사용량</th>
                        <th>제공 인원</th>
                    </tr>
                </thead>
                <tbody>
                    ${usageDetails.map(detail => `
                        <tr>
                            <td>${detail.plan_date}</td>
                            <td>${detail.recipe_name}</td>
                            <td>${detail.quantity.toLocaleString()}</td>
                            <td>${detail.serving_count.toLocaleString()}명</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        const modal = this.createModal('식자재 사용 상세', detailHTML, [
            { text: '닫기', className: 'btn btn-secondary', onclick: 'mealPlansManager.closeModal()' }
        ]);

        this.showModal(modal);
    }

    // 유틸리티 메서드들
    exportToExcel() {
        // Excel 내보내기 구현
        alert('Excel 내보내기 기능은 준비 중입니다.');
    }

    showBulkScheduleModal() {
        alert('일괄 스케줄링 기능은 준비 중입니다.');
    }

    showScheduleModal(mealPlanId) {
        alert(`식단 ID ${mealPlanId}의 스케줄 관리 기능은 준비 중입니다.`);
    }

    showBudgetAnalysis(mealPlanId) {
        // 예산 분석 모달 표시
        const mealPlan = this.mealPlans.find(mp => mp.id === mealPlanId);
        if (!mealPlan) return;

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        // 예산 분석 API 호출
        this.loadBudgetAnalysisModal(mealPlanId, year, month);
    }

    async loadBudgetAnalysisModal(mealPlanId, year, month) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/budget-analysis/${mealPlanId}?year=${year}&month=${month}`);
            const data = await response.json();

            if (response.ok) {
                this.showBudgetAnalysisModal(data);
            } else {
                alert(`예산 분석 실패: ${data.detail}`);
            }
        } catch (error) {
            console.error('Error loading budget analysis:', error);
            alert('예산 분석 중 오류가 발생했습니다.');
        }
    }

    showBudgetAnalysisModal(data) {
        const modalBody = `
            <div class="row" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 20px;">
                <div class="stat-card primary">
                    <h3>₩${data.budget_per_month.toLocaleString()}</h3>
                    <p>월 예산</p>
                </div>
                <div class="stat-card ${data.budget_usage_rate > 90 ? 'danger' : data.budget_usage_rate > 75 ? 'warning' : 'success'}">
                    <h3>${data.budget_usage_rate}%</h3>
                    <p>예산 사용률</p>
                </div>
                <div class="stat-card success">
                    <h3>₩${data.total_cost.toLocaleString()}</h3>
                    <p>사용 금액</p>
                </div>
                <div class="stat-card info">
                    <h3>₩${data.remaining_budget.toLocaleString()}</h3>
                    <p>잔여 예산</p>
                </div>
            </div>
            <div class="row" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                <div class="stat-card secondary">
                    <h3>${data.total_days}일</h3>
                    <p>운영 일수</p>
                </div>
                <div class="stat-card warning">
                    <h3>₩${data.cost_per_serving.toLocaleString()}</h3>
                    <p>1인당 비용</p>
                </div>
                <div class="stat-card info">
                    <h3>${data.efficiency_score}점</h3>
                    <p>효율성 점수</p>
                </div>
            </div>
            <div style="margin-top: 20px;">
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${Math.min(data.budget_usage_rate, 100)}%">
                        ${data.budget_usage_rate}%
                    </div>
                </div>
            </div>
        `;

        const modal = this.createModal(`${data.meal_plan_name} - ${data.tracking_month} 예산 분석`, modalBody, [
            { text: '닫기', className: 'btn btn-secondary', onclick: 'mealPlansManager.closeModal()' }
        ]);

        this.showModal(modal);
    }

    showEditScheduleModal(scheduleId) {
        alert(`스케줄 ID ${scheduleId} 수정 기능은 준비 중입니다.`);
    }

    approveSchedule(scheduleId) {
        if (confirm('이 스케줄을 승인하시겠습니까?')) {
            // 승인 처리
            alert(`스케줄 ID ${scheduleId} 승인 기능은 준비 중입니다.`);
        }
    }

    showCostCalculation(scheduleId) {
        alert(`스케줄 ID ${scheduleId} 비용 계산 기능은 준비 중입니다.`);
    }

    filterScheduleData() {
        this.currentPage = 1;
        this.loadMealPlanSchedules();
    }
}

// 전역 인스턴스 생성
let mealPlansManager;

// DOM이 로드된 후 초기화
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('meal-plans-content')) {
        mealPlansManager = new MealPlansManager();
    }
});