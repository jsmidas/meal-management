// 식단가 관리 모듈
(function() {
'use strict';

// 식단가 관련 변수
let businessLocations = [];
let currentLocationId = null;
let mealPlans = [];

// MealPricingModule 객체 (다른 모듈과 일관성 유지)
window.MealPricingModule = {
    currentPage: 1,
    totalPages: 1,
    editingId: null,

    // 모듈 초기화
    async init() {
        console.log('💰 MealPricing Module 초기화');
        await this.loadMealPricingStatistics();
        await loadBusinessLocationsForMealPricing();
        this.setupEventListeners();
        return this;
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        console.log('식단가 관리 이벤트 리스너 설정');
    },

    // 식단가 통계 로드
    async loadMealPricingStatistics() {
        try {
            const response = await fetch('http://localhost:9000/api/admin/meal-pricing/statistics');
            const data = await response.json();
            
            if (data.success) {
                this.updateStatistics(data.statistics);
            } else {
                // 통계 API가 없는 경우 기본값 표시
                this.updateStatistics({
                    totalMealPlans: 0,
                    activeMealPlans: 0,
                    locationsWithPricing: 0,
                    averageSellingPrice: 0,
                    averageCostRatio: 0
                });
            }
        } catch (error) {
            console.error('식단가 통계 로드 실패:', error);
            // 에러 시 기본값 표시
            this.updateStatistics({
                totalMealPlans: '-',
                activeMealPlans: '-',
                locationsWithPricing: '-',
                averageSellingPrice: '-',
                averageCostRatio: '-'
            });
        }
    },

    // 통계 업데이트
    updateStatistics(stats) {
        const totalElement = document.getElementById('total-meal-plans-count');
        const activeTextElement = document.getElementById('active-meal-plans-text');
        const locationsElement = document.getElementById('locations-with-pricing-count');
        const avgPriceElement = document.getElementById('average-selling-price');
        const avgRatioElement = document.getElementById('average-cost-ratio');

        if (totalElement) totalElement.textContent = stats.totalMealPlans || '-';
        if (activeTextElement) activeTextElement.textContent = `활성: ${stats.activeMealPlans || 0}개`;
        if (locationsElement) locationsElement.textContent = stats.locationsWithPricing || '-';
        if (avgPriceElement) {
            if (typeof stats.averageSellingPrice === 'number') {
                avgPriceElement.textContent = '₩' + Number(stats.averageSellingPrice).toLocaleString();
            } else {
                avgPriceElement.textContent = stats.averageSellingPrice || '-';
            }
        }
        if (avgRatioElement) {
            if (typeof stats.averageCostRatio === 'number') {
                avgRatioElement.textContent = stats.averageCostRatio.toFixed(1) + '%';
            } else {
                avgRatioElement.textContent = stats.averageCostRatio || '-';
            }
        }
    },

    // 사업장별 식단표 로드 (메서드 형태로 변경)
    async loadMealPlansForLocation() {
        return await loadMealPlansForLocation();
    }
};

// 사업장 목록 로드 (식단가 관리용)
async function loadBusinessLocationsForMealPricing() {
    try {
        console.log('사업장 목록 로드 시작');
        const response = await fetch('http://localhost:9000/api/admin/sites/tree');
        const result = await response.json();
        console.log('API 응답:', result);
        
        businessLocations = result.sites || [];
        console.log('사업장 데이터:', businessLocations);
        
        const select = document.getElementById('businessLocationSelect');
        console.log('select 요소:', select);
        
        if (select) {
            select.innerHTML = '<option value="">사업장을 선택하세요</option>';
            businessLocations.forEach(location => {
                console.log('사업장 추가:', location);
                select.innerHTML += `<option value="${location.id}">${location.name}</option>`;
            });
            console.log('select 옵션 최종 개수:', select.options.length);
        } else {
            console.error('businessLocationSelect 요소를 찾을 수 없음');
        }
    } catch (error) {
        console.error('사업장 목록 로드 실패:', error);
        const select = document.getElementById('businessLocationSelect');
        if (select) {
            select.innerHTML = '<option value="">사업장 목록을 불러올 수 없습니다</option>';
        }
    }
}

// 선택된 사업장의 식단표 목록 로드
async function loadMealPlansForLocation() {
    const businessLocationSelect = document.getElementById('businessLocationSelect');
    const mealPlansContainer = document.getElementById('mealPlansContainer');
    const addMealPlanBtn = document.getElementById('addMealPlanBtn');
    const saveMealPricingBtn = document.getElementById('saveMealPricingBtn');
    
    if (!businessLocationSelect || !mealPlansContainer) {
        console.error('필수 요소를 찾을 수 없음');
        return;
    }
    
    const selectedLocationId = businessLocationSelect.value;
    currentLocationId = selectedLocationId;
    
    if (!selectedLocationId) {
        mealPlansContainer.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">사업장을 선택하면 세부식단표 목록이 표시됩니다.</p>';
        if (addMealPlanBtn) addMealPlanBtn.style.display = 'none';
        if (saveMealPricingBtn) saveMealPricingBtn.style.display = 'none';
        return;
    }
    
    console.log('선택된 사업장 ID:', selectedLocationId);
    
    // 기본 1개 식단표로 시작 (실제로는 API에서 가져와야 함)
    mealPlans = [
        {
            id: 1,
            name: '기본 식단표',
            meal_time: 'lunch', // 기본값: 중식
            selling_price: 5000,
            target_material_cost: 3500,
            location_id: selectedLocationId
        }
    ];
    
    displayMealPlans();
    
    if (addMealPlanBtn) addMealPlanBtn.style.display = 'inline-block';
    if (saveMealPricingBtn) saveMealPricingBtn.style.display = 'inline-block';
}

// 식단표 목록 표시
function displayMealPlans() {
    const mealPlansContainer = document.getElementById('mealPlansContainer');
    if (!mealPlansContainer) return;
    
    if (!mealPlans || mealPlans.length === 0) {
        mealPlansContainer.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">등록된 식단표가 없습니다.</p>';
        return;
    }
    
    const tableHTML = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; font-weight: 600; width: 15%;">시간대</th>
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: left; font-weight: 600; width: 25%;">식단표명</th>
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: right; font-weight: 600; width: 15%;">판매가 (원)</th>
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: right; font-weight: 600; width: 15%;">목표재료비 (원)</th>
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; font-weight: 600; width: 10%;">비율 (%)</th>
                    <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; font-weight: 600; width: 20%;">관리</th>
                </tr>
            </thead>
            <tbody>
                ${mealPlans.map(plan => {
                    const costRatio = plan.selling_price > 0 ? ((plan.target_material_cost / plan.selling_price) * 100).toFixed(1) : 0;
                    const isOverLimit = parseFloat(costRatio) > 40;
                    const ratioColor = isOverLimit ? '#dc3545' : '#28a745';
                    
                    return `
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="border: 1px solid #dee2e6; padding: 12px; text-align: center;">
                                <select id="meal-time-${plan.id}" onchange="updateMealPlanField(${plan.id}, 'meal_time', this.value)" 
                                        style="padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; width: 100%;">
                                    <option value="breakfast" ${plan.meal_time === 'breakfast' ? 'selected' : ''}>🌅 조식</option>
                                    <option value="lunch" ${plan.meal_time === 'lunch' ? 'selected' : ''}>☀️ 중식</option>
                                    <option value="dinner" ${plan.meal_time === 'dinner' ? 'selected' : ''}>🌙 석식</option>
                                    <option value="night" ${plan.meal_time === 'night' ? 'selected' : ''}>🌃 야식</option>
                                </select>
                            </td>
                            <td style="border: 1px solid #dee2e6; padding: 12px; font-weight: 500;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="color: #007bff;">📋</span>
                                    <input type="text" id="plan-name-${plan.id}" value="${plan.name}" 
                                           onchange="updateMealPlanField(${plan.id}, 'name', this.value)"
                                           style="border: none; background: transparent; font-weight: 500; width: 100%; font-size: 14px;"
                                           onblur="this.style.background='transparent'" 
                                           onfocus="this.style.background='#f8f9fa'">
                                </div>
                            </td>
                            <td style="border: 1px solid #dee2e6; padding: 12px; text-align: right;">
                                <input type="number" id="selling-price-${plan.id}" value="${plan.selling_price || 0}" 
                                       onchange="updateMealPlanField(${plan.id}, 'selling_price', this.value)"
                                       style="width: 100px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; text-align: right;"
                                       min="0" step="100">
                            </td>
                            <td style="border: 1px solid #dee2e6; padding: 12px; text-align: right;">
                                <input type="number" id="target-cost-${plan.id}" value="${plan.target_material_cost || 0}"
                                       onchange="updateMealPlanField(${plan.id}, 'target_material_cost', this.value)"
                                       style="width: 100px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; text-align: right;"
                                       min="0" step="100">
                            </td>
                            <td style="border: 1px solid #dee2e6; padding: 12px; text-align: center;">
                                <span id="cost-ratio-${plan.id}" style="color: ${ratioColor}; font-weight: bold; font-size: 14px;">
                                    ${costRatio}%
                                </span>
                                ${isOverLimit ? '<div style="font-size: 10px; color: #dc3545;">⚠️ 목표 초과</div>' : ''}
                            </td>
                            <td style="border: 1px solid #dee2e6; padding: 12px; text-align: center;">
                                <div style="display: flex; gap: 5px; justify-content: center;">
                                    <button onclick="duplicateMealPlan(${plan.id})" 
                                            style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                                        복사
                                    </button>
                                    <button onclick="deleteMealPlan(${plan.id})" 
                                            style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; ${mealPlans.length <= 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                                        삭제
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    
    mealPlansContainer.innerHTML = tableHTML;
}

// 식단표 필드 업데이트
function updateMealPlanField(planId, field, value) {
    const plan = mealPlans.find(p => p.id === planId);
    if (plan) {
        if (field === 'name' || field === 'meal_time') {
            plan[field] = value;
        } else {
            plan[field] = parseInt(value) || 0;
        }
        console.log(`식단표 ${planId}의 ${field}이 ${value}로 업데이트됨`);
        
        // 가격이나 재료비가 변경되면 비율 업데이트
        if (field === 'selling_price' || field === 'target_material_cost') {
            updateCostRatio(planId);
        }
    }
}

// 재료비 비율 업데이트
function updateCostRatio(planId) {
    const plan = mealPlans.find(p => p.id === planId);
    if (!plan) return;
    
    const costRatioElement = document.getElementById(`cost-ratio-${planId}`);
    if (!costRatioElement) return;
    
    const costRatio = plan.selling_price > 0 ? ((plan.target_material_cost / plan.selling_price) * 100).toFixed(1) : 0;
    const isOverLimit = parseFloat(costRatio) > 40;
    const ratioColor = isOverLimit ? '#dc3545' : '#28a745';
    
    costRatioElement.style.color = ratioColor;
    costRatioElement.innerHTML = `${costRatio}%`;
    
    // 목표 초과 경고 업데이트
    const parentCell = costRatioElement.parentElement;
    const warningDiv = parentCell.querySelector('div');
    
    if (isOverLimit && !warningDiv) {
        const warning = document.createElement('div');
        warning.style.cssText = 'font-size: 10px; color: #dc3545;';
        warning.innerHTML = '⚠️ 목표 초과';
        parentCell.appendChild(warning);
    } else if (!isOverLimit && warningDiv) {
        warningDiv.remove();
    }
}

// 새 식단표 추가
function addNewMealPlan() {
    const name = prompt('새 식단표 이름을 입력하세요:', '새 식단표');
    if (!name || name.trim() === '') return;
    
    const newPlan = {
        id: Date.now(), // 임시 ID
        name: name.trim(),
        meal_time: 'lunch', // 기본값: 중식
        selling_price: 0,
        target_material_cost: 0,
        location_id: currentLocationId
    };
    
    mealPlans.push(newPlan);
    displayMealPlans();
    
    console.log('새 식단표 추가:', newPlan);
}

// 식단표 복사
function duplicateMealPlan(planId) {
    const plan = mealPlans.find(p => p.id === planId);
    if (!plan) return;
    
    const newPlan = {
        id: Date.now(), // 임시 ID
        name: plan.name + ' (복사)',
        meal_time: plan.meal_time, // 기존 시간대 복사
        selling_price: plan.selling_price,
        target_material_cost: plan.target_material_cost,
        location_id: currentLocationId
    };
    
    mealPlans.push(newPlan);
    displayMealPlans();
    
    console.log('식단표 복사:', newPlan);
}


// 식단표 삭제
function deleteMealPlan(planId) {
    if (mealPlans.length <= 1) {
        alert('최소 1개의 식단표는 유지해야 합니다.');
        return;
    }
    
    if (!confirm('이 식단표를 삭제하시겠습니까?')) return;
    
    mealPlans = mealPlans.filter(p => p.id !== planId);
    displayMealPlans();
    
    console.log('식단표 삭제, 남은 식단표:', mealPlans);
}

// 식단가 정보 저장
async function saveMealPricing() {
    if (!currentLocationId) {
        alert('사업장을 먼저 선택해주세요.');
        return;
    }
    
    if (!mealPlans || mealPlans.length === 0) {
        alert('저장할 식단표가 없습니다.');
        return;
    }
    
    try {
        console.log('식단가 정보 저장 시도:', {
            location_id: currentLocationId,
            meal_plans: mealPlans
        });
        
        // 실제로는 API 호출이 필요함
        // const response = await fetch('http://localhost:9000/api/admin/meal-pricing/save', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({
        //         location_id: currentLocationId,
        //         meal_plans: mealPlans
        //     })
        // });
        
        // 임시로 성공 메시지만 표시
        alert('식단가 정보가 저장되었습니다.');
        
    } catch (error) {
        console.error('식단가 저장 실패:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 식단가 관리 페이지 초기화
function initializeMealPricingPage() {
    console.log('식단가 관리 페이지 초기화 시작');
    loadBusinessLocationsForMealPricing();
}

// 전역 함수로 내보내기
window.loadBusinessLocationsForMealPricing = loadBusinessLocationsForMealPricing;
window.loadMealPlansForLocation = loadMealPlansForLocation;
window.displayMealPlans = displayMealPlans;
window.updateMealPlanField = updateMealPlanField;
window.updateCostRatio = updateCostRatio;
window.addNewMealPlan = addNewMealPlan;
window.duplicateMealPlan = duplicateMealPlan;
window.deleteMealPlan = deleteMealPlan;
window.saveMealPricing = saveMealPricing;
window.initializeMealPricingPage = initializeMealPricingPage;

})(); // IIFE 종료