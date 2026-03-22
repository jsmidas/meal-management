// 식단가 관리 - 인라인 편집 버전
(function() {
    'use strict';

    console.log('💰 Meal Pricing Inline Module Loading...');

    let allMealPricing = [];
    let businessLocations = [];
    let editingCell = null;

    async function initMealPricingInline() {
        console.log('🚀 Meal Pricing Inline 초기화 시작');

        const container = document.getElementById('meal-pricing-content');
        if (!container) {
            console.error('❌ meal-pricing-content 컨테이너를 찾을 수 없음');
            return;
        }

        container.style.display = 'block';

        // HTML 구조 생성
        container.innerHTML = `
            <div class="meal-pricing-container">
                <!-- 헤더 -->
                <div class="page-header">
                    <h2>식단가 관리</h2>
                    <p class="page-description">사업장별 세부식단표를 관리하고 끼니별 매출가, 목표식재료비를 설정합니다.</p>
                </div>

                <!-- 통계 카드 -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value" id="total-meal-plans">0</div>
                        <div class="stat-label">전체 식단표</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="active-meal-plans">0</div>
                        <div class="stat-label">활성 식단표</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="locations-count">0</div>
                        <div class="stat-label">운영 사업장</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="avg-selling-price">0</div>
                        <div class="stat-label">평균 판매가</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="avg-cost-ratio">0%</div>
                        <div class="stat-label">평균 원가율</div>
                    </div>
                </div>

                <!-- 필터 및 액션 바 -->
                <div class="filter-bar">
                    <div class="filter-group">
                        <select id="location-filter" class="form-control">
                            <option value="">전체 사업장</option>
                        </select>
                        <select id="meal-type-filter" class="form-control">
                            <option value="">전체 식사시간</option>
                            <option value="조식">조식</option>
                            <option value="중식">중식</option>
                            <option value="석식">석식</option>
                            <option value="야식">야식</option>
                        </select>
                        <select id="status-filter" class="form-control">
                            <option value="">전체 상태</option>
                            <option value="active">활성</option>
                            <option value="inactive">비활성</option>
                        </select>
                    </div>
                    <div class="action-group">
                        <button class="btn btn-primary" onclick="addNewMealPricing()">
                            <i class="fas fa-plus"></i> 새 식단표 추가
                        </button>
                    </div>
                </div>

                <!-- 데이터 테이블 -->
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>사업장</th>
                                <th>식단계획</th>
                                <th>운영타입</th>
                                <th>계획명</th>
                                <th>적용기간</th>
                                <th>판매가</th>
                                <th>목표원가</th>
                                <th>달성율</th>
                                <th>상태</th>
                                <th>작업</th>
                            </tr>
                        </thead>
                        <tbody id="meal-pricing-tbody">
                            <tr><td colspan="10" class="text-center">데이터 로드 중...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // 스타일 추가
        addStyles();

        // 사업장 목록 로드
        await loadBusinessLocations();

        // 데이터 로드
        await loadMealPricingData();

        // 이벤트 리스너 설정
        setupEventListeners();
    }

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .meal-pricing-container {
                padding: 20px;
                background: #f5f5f5;
                min-height: 100vh;
            }

            .page-header {
                margin-bottom: 30px;
            }

            .page-header h2 {
                font-size: 28px;
                font-weight: 600;
                color: #333;
                margin: 0 0 10px 0;
            }

            .page-description {
                color: #666;
                font-size: 14px;
            }

            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                text-align: center;
            }

            .stat-value {
                font-size: 28px;
                font-weight: bold;
                color: #007bff;
                margin-bottom: 5px;
            }

            .stat-label {
                color: #666;
                font-size: 13px;
            }

            .filter-bar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                background: white;
                padding: 15px;
                border-radius: 8px;
            }

            .filter-group {
                display: flex;
                gap: 10px;
            }

            .form-control {
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
            }

            .btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.3s;
            }

            .btn-primary {
                background: #007bff;
                color: white;
            }

            .btn-primary:hover {
                background: #0056b3;
            }

            .btn-small {
                padding: 4px 8px;
                font-size: 12px;
            }

            .btn-edit {
                background: #28a745;
                color: white;
            }

            .btn-delete {
                background: #dc3545;
                color: white;
                margin-left: 5px;
            }

            .table-container {
                background: white;
                border-radius: 8px;
                overflow: hidden;
            }

            .data-table {
                width: 100%;
                border-collapse: collapse;
            }

            .data-table th {
                background: #f8f9fa;
                padding: 12px;
                text-align: left;
                font-weight: 600;
                font-size: 13px;
                color: #666;
                border-bottom: 2px solid #dee2e6;
            }

            .data-table td {
                padding: 10px 12px;
                border-bottom: 1px solid #dee2e6;
                font-size: 14px;
            }

            .data-table tbody tr:hover {
                background: #f8f9fa;
            }

            .editable-cell {
                cursor: pointer;
                position: relative;
            }

            .editable-cell:hover {
                background: #e9ecef;
            }

            .editable-select {
                width: 100%;
                padding: 4px;
                border: 1px solid #007bff;
                border-radius: 3px;
                font-size: 13px;
            }

            .editable-input {
                width: 100%;
                padding: 4px;
                border: 1px solid #007bff;
                border-radius: 3px;
                font-size: 13px;
            }

            .date-range-input {
                display: flex;
                gap: 5px;
                align-items: center;
            }

            .date-input {
                width: 110px;
                padding: 4px;
                border: 1px solid #007bff;
                border-radius: 3px;
                font-size: 12px;
            }

            .badge {
                padding: 3px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
            }

            .badge-active {
                background: #d4edda;
                color: #155724;
            }

            .badge-inactive {
                background: #f8d7da;
                color: #721c24;
            }

            .ratio-good {
                color: #28a745;
                font-weight: bold;
            }

            .ratio-warning {
                color: #ffc107;
                font-weight: bold;
            }

            .ratio-danger {
                color: #dc3545;
                font-weight: bold;
            }

            .text-center {
                text-align: center;
            }

            .text-right {
                text-align: right;
            }
        `;
        document.head.appendChild(style);
    }

    // 사업장 목록 로드
    async function loadBusinessLocations() {
        try {
            const response = await fetch('/api/api/admin/business-locations');
            const data = await response.json();

            if (data.success && data.locations) {
                // 중복 제거
                const uniqueLocations = [];
                const seenNames = new Set();

                for (const loc of data.locations) {
                    if (!seenNames.has(loc.name)) {
                        seenNames.add(loc.name);
                        uniqueLocations.push(loc);
                    }
                }

                businessLocations = uniqueLocations;

                // 필터 드롭다운 채우기
                const filterSelect = document.getElementById('location-filter');
                businessLocations.forEach(loc => {
                    const option = document.createElement('option');
                    option.value = loc.name;
                    option.textContent = loc.name;
                    filterSelect.appendChild(option);
                });

                console.log('✅ 사업장 목록 로드 완료:', businessLocations.map(l => l.name).join(', '));
            }
        } catch (error) {
            console.error('사업장 목록 로드 실패:', error);
        }
    }

    // 데이터 로드
    async function loadMealPricingData() {
        try {
            const response = await fetch('/api/api/admin/meal-pricing');
            const data = await response.json();

            if (data.success && data.meal_pricing) {
                allMealPricing = data.meal_pricing;
                updateStatistics(data.statistics || {});
                displayMealPricing(allMealPricing);
            }
        } catch (error) {
            console.error('데이터 로드 실패:', error);
        }
    }

    // 통계 업데이트
    function updateStatistics(stats) {
        document.getElementById('total-meal-plans').textContent = stats.total || '0';
        document.getElementById('active-meal-plans').textContent = stats.active || '0';
        document.getElementById('locations-count').textContent = stats.locations || '0';
        document.getElementById('avg-selling-price').textContent =
            Number(stats.avg_selling_price || 0).toLocaleString();
        document.getElementById('avg-cost-ratio').textContent =
            (stats.avg_cost_ratio || 0).toFixed(1) + '%';
    }

    // 테이블 표시
    function displayMealPricing(mealPricing) {
        const tbody = document.getElementById('meal-pricing-tbody');
        if (!tbody) return;

        if (mealPricing.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">등록된 식단표가 없습니다</td></tr>';
            return;
        }

        tbody.innerHTML = mealPricing.map(pricing => {
            const ratio = pricing.selling_price > 0 ?
                (pricing.material_cost_guideline / pricing.selling_price * 100) : 0;
            const ratioClass = ratio >= 40 ? 'ratio-danger' : ratio >= 35 ? 'ratio-warning' : 'ratio-good';

            return `
                <tr data-id="${pricing.id}">
                    <td class="editable-cell" onclick="editLocationField(this, ${pricing.id}, '${pricing.location_name || ''}')">
                        ${pricing.location_name || '-'}
                    </td>
                    <td class="editable-cell" onclick="editMealPlanField(this, ${pricing.id}, '${pricing.meal_plan_type || ''}')">
                        ${pricing.meal_plan_type || '-'}
                    </td>
                    <td>${pricing.meal_type || '-'}</td>
                    <td>${pricing.plan_name || '-'}</td>
                    <td class="editable-cell" onclick="editDateRange(this, ${pricing.id}, '${pricing.apply_date_start || ''}', '${pricing.apply_date_end || ''}')">
                        ${formatDateRange(pricing.apply_date_start, pricing.apply_date_end)}
                    </td>
                    <td class="text-right editable-cell" onclick="editNumberField(this, ${pricing.id}, 'selling_price', ${pricing.selling_price || 0})">
                        ${Number(pricing.selling_price || 0).toLocaleString()}
                    </td>
                    <td class="text-right editable-cell" onclick="editNumberField(this, ${pricing.id}, 'material_cost_guideline', ${pricing.material_cost_guideline || 0})">
                        ${Number(pricing.material_cost_guideline || 0).toLocaleString()}
                    </td>
                    <td class="text-center">
                        <span class="${ratioClass}">${ratio.toFixed(1)}%</span>
                    </td>
                    <td class="text-center">
                        <label class="switch">
                            <input type="checkbox" ${pricing.is_active ? 'checked' : ''}
                                onchange="toggleStatus(${pricing.id}, this.checked)">
                            <span class="slider"></span>
                        </label>
                    </td>
                    <td class="text-center">
                        <button class="btn btn-small btn-delete" onclick="deleteMealPricing(${pricing.id})">삭제</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // 날짜 범위 포맷
    function formatDateRange(start, end) {
        if (!start || !end) return '-';
        const startDate = new Date(start).toLocaleDateString('ko-KR');
        const endDate = new Date(end).toLocaleDateString('ko-KR');
        return `${startDate} ~ ${endDate}`;
    }

    // 사업장 편집
    window.editLocationField = function(cell, id, currentValue) {
        if (editingCell) return;
        editingCell = cell;

        const select = document.createElement('select');
        select.className = 'editable-select';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '선택하세요';
        select.appendChild(defaultOption);

        businessLocations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc.name;
            option.textContent = loc.name;
            if (loc.name === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.onblur = async function() {
            const newValue = select.value;
            if (newValue !== currentValue && newValue) {
                await updateField(id, 'location_name', newValue);
            }
            cell.textContent = newValue || currentValue || '-';
            editingCell = null;
        };

        select.onkeydown = function(e) {
            if (e.key === 'Enter') {
                select.blur();
            } else if (e.key === 'Escape') {
                cell.textContent = currentValue || '-';
                editingCell = null;
            }
        };

        cell.textContent = '';
        cell.appendChild(select);
        select.focus();
    };

    // 식단계획 편집
    window.editMealPlanField = function(cell, id, currentValue) {
        if (editingCell) return;
        editingCell = cell;

        const select = document.createElement('select');
        select.className = 'editable-select';

        const plans = ['', '조식', '중식', '석식', '야식', '행사'];
        plans.forEach(plan => {
            const option = document.createElement('option');
            option.value = plan;
            option.textContent = plan || '선택하세요';
            if (plan === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.onblur = async function() {
            const newValue = select.value;
            if (newValue !== currentValue && newValue) {
                await updateField(id, 'meal_plan_type', newValue);
            }
            cell.textContent = newValue || currentValue || '-';
            editingCell = null;
        };

        select.onkeydown = function(e) {
            if (e.key === 'Enter') {
                select.blur();
            } else if (e.key === 'Escape') {
                cell.textContent = currentValue || '-';
                editingCell = null;
            }
        };

        cell.textContent = '';
        cell.appendChild(select);
        select.focus();
    };

    // 날짜 범위 편집
    window.editDateRange = function(cell, id, startDate, endDate) {
        if (editingCell) return;
        editingCell = cell;

        const container = document.createElement('div');
        container.className = 'date-range-input';

        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.className = 'date-input';
        startInput.value = startDate || '';

        const separator = document.createElement('span');
        separator.textContent = '~';

        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.className = 'date-input';
        endInput.value = endDate || '';

        const saveChanges = async function() {
            if (startInput.value !== startDate || endInput.value !== endDate) {
                await updateDateRange(id, startInput.value, endInput.value);
            }
            cell.textContent = formatDateRange(startInput.value, endInput.value);
            editingCell = null;
        };

        startInput.onblur = endInput.onblur = function(e) {
            // 다른 날짜 입력으로 포커스가 이동하면 저장하지 않음
            setTimeout(() => {
                if (!container.contains(document.activeElement)) {
                    saveChanges();
                }
            }, 100);
        };

        startInput.onkeydown = endInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                saveChanges();
            } else if (e.key === 'Escape') {
                cell.textContent = formatDateRange(startDate, endDate);
                editingCell = null;
            }
        };

        container.appendChild(startInput);
        container.appendChild(separator);
        container.appendChild(endInput);

        cell.textContent = '';
        cell.appendChild(container);
        startInput.focus();
    };

    // 숫자 필드 편집
    window.editNumberField = function(cell, id, field, currentValue) {
        if (editingCell) return;
        editingCell = cell;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'editable-input';
        input.value = currentValue;

        input.onblur = async function() {
            const newValue = parseFloat(input.value) || 0;
            if (newValue !== currentValue) {
                await updateField(id, field, newValue);
            }
            cell.textContent = Number(newValue).toLocaleString();
            editingCell = null;
        };

        input.onkeydown = function(e) {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                cell.textContent = Number(currentValue).toLocaleString();
                editingCell = null;
            }
        };

        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();
    };

    // 필드 업데이트
    async function updateField(id, field, value) {
        try {
            const pricing = allMealPricing.find(p => p.id === id);
            const updateData = { ...pricing, [field]: value };

            // 달성율 재계산
            if (field === 'selling_price' || field === 'material_cost_guideline') {
                updateData.cost_ratio = updateData.selling_price > 0 ?
                    (updateData.material_cost_guideline / updateData.selling_price * 100) : 0;
            }

            const response = await fetch(`/api/api/admin/meal-pricing/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                await loadMealPricingData();
            }
        } catch (error) {
            console.error('업데이트 실패:', error);
        }
    }

    // 날짜 범위 업데이트
    async function updateDateRange(id, startDate, endDate) {
        try {
            const pricing = allMealPricing.find(p => p.id === id);
            const updateData = {
                ...pricing,
                apply_date_start: startDate,
                apply_date_end: endDate
            };

            const response = await fetch(`/api/api/admin/meal-pricing/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                await loadMealPricingData();
            }
        } catch (error) {
            console.error('날짜 업데이트 실패:', error);
        }
    }

    // 상태 토글
    window.toggleStatus = async function(id, isActive) {
        try {
            const pricing = allMealPricing.find(p => p.id === id);
            const updateData = { ...pricing, is_active: isActive };

            const response = await fetch(`/api/api/admin/meal-pricing/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                await loadMealPricingData();
            }
        } catch (error) {
            console.error('상태 업데이트 실패:', error);
        }
    };

    // 삭제
    window.deleteMealPricing = async function(id) {
        if (!confirm('정말로 이 식단표를 삭제하시겠습니까?')) return;

        try {
            const response = await fetch(`/api/api/admin/meal-pricing/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await loadMealPricingData();
            }
        } catch (error) {
            console.error('삭제 실패:', error);
        }
    };

    // 새 식단표 추가
    window.addNewMealPricing = async function() {
        const newData = {
            location_name: '새 사업장',
            meal_plan_type: '중식',
            meal_type: '급식',
            plan_name: '새 식단표',
            apply_date_start: new Date().toISOString().split('T')[0],
            apply_date_end: new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0],
            selling_price: 0,
            material_cost_guideline: 0,
            cost_ratio: 0,
            is_active: true
        };

        try {
            const response = await fetch('/api/api/admin/meal-pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newData)
            });

            if (response.ok) {
                await loadMealPricingData();
            }
        } catch (error) {
            console.error('추가 실패:', error);
        }
    };

    // 이벤트 리스너 설정
    function setupEventListeners() {
        // 필터 이벤트
        document.getElementById('location-filter')?.addEventListener('change', filterData);
        document.getElementById('meal-type-filter')?.addEventListener('change', filterData);
        document.getElementById('status-filter')?.addEventListener('change', filterData);
    }

    // 필터링
    function filterData() {
        const locationFilter = document.getElementById('location-filter').value;
        const mealTypeFilter = document.getElementById('meal-type-filter').value;
        const statusFilter = document.getElementById('status-filter').value;

        let filtered = allMealPricing;

        if (locationFilter) {
            filtered = filtered.filter(p => p.location_name === locationFilter);
        }

        if (mealTypeFilter) {
            filtered = filtered.filter(p => p.meal_plan_type === mealTypeFilter);
        }

        if (statusFilter === 'active') {
            filtered = filtered.filter(p => p.is_active);
        } else if (statusFilter === 'inactive') {
            filtered = filtered.filter(p => !p.is_active);
        }

        displayMealPricing(filtered);
    }

    // 스위치 스타일 추가
    const switchStyle = document.createElement('style');
    switchStyle.textContent = `
        .switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 24px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 16px;
            width: 16px;
            left: 4px;
            bottom: 4px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }

        input:checked + .slider {
            background-color: #28a745;
        }

        input:checked + .slider:before {
            transform: translateX(26px);
        }
    `;
    document.head.appendChild(switchStyle);

    // 전역 함수 등록
    window.initMealPricingInline = initMealPricingInline;

    console.log('✅ Meal Pricing Inline Module 로드 완료');
})();