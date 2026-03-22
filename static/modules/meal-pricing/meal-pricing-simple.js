// 간단한 식단가 관리 모듈 - 기존 양식과 기능 유지
window.MealPricingModule = {
    currentLocationId: null,
    mealPlans: [],

    init() {
        console.log('🍽️ 간단 식단가 모듈 초기화');
        this.bindEvents();
    },

    // 사업장 목록 로드 (기존 함수명 유지)
    async loadBusinessLocationsForMealPricing() {
        console.log('[MealPricing] 사업장 목록 로드 시작');
        
        // 드롭다운 요소 확인
        const select = document.getElementById('mealPricingLocationSelect');
        console.log('[MealPricing] 사업장 선택 드롭다운 찾기:', select ? '찾음' : '못찾음');
        
        if (!select) {
            console.error('[MealPricing] mealPricingLocationSelect 요소를 찾을 수 없습니다');
            return;
        }
        
        try {
            console.log('[MealPricing] API 호출 시작: /api/admin/customers');
            const response = await fetch('http://localhost:9000/api/admin/customers');
            console.log('[MealPricing] API 응답 상태:', response.status, response.statusText);
            
            const result = await response.json();
            console.log('[MealPricing] API 응답 데이터:', result);
            
            if (result.success && result.customers) {
                this.populateLocationSelect(result.customers);
                console.log('[MealPricing] 사업장 목록 로드 성공, 개수:', result.customers.length);
            } else {
                console.log('[MealPricing] 사업장 목록 로드 실패, 기본 옵션 사용');
                this.createDefaultLocationOptions();
            }
        } catch (error) {
            console.error('[MealPricing] 사업장 목록 로드 오류:', error);
            this.createDefaultLocationOptions();
        }
    },

    populateLocationSelect(customers) {
        const select = document.getElementById('mealPricingLocationSelect');
        if (!select) return;

        select.innerHTML = '<option value="">-- 사업장 선택 --</option>';
        
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = customer.name;
            select.appendChild(option);
        });
    },

    createDefaultLocationOptions() {
        const select = document.getElementById('mealPricingLocationSelect');
        if (!select) return;

        select.innerHTML = `
            <option value="">-- 사업장 선택 --</option>
            <option value="1">본사</option>
            <option value="2">지점A</option>
            <option value="3">학교</option>
        `;
    },

    bindEvents() {
        // 사업장 선택 이벤트
        const locationSelect = document.getElementById('mealPricingLocationSelect');
        if (locationSelect) {
            locationSelect.addEventListener('change', (e) => {
                this.currentLocationId = e.target.value;
                console.log('[MealPricing] 사업장 선택됨:', this.currentLocationId);
                if (this.currentLocationId) {
                    this.loadMealPricingData();
                    // 식단표 추가 버튼 표시
                    const addBtn = document.getElementById('addMealPlanBtn');
                    if (addBtn) addBtn.style.display = 'inline-block';
                } else {
                    this.clearDisplay();
                    // 식단표 추가 버튼 숨기기
                    const addBtn = document.getElementById('addMealPlanBtn');
                    if (addBtn) addBtn.style.display = 'none';
                }
            });
        }
    },

    clearDisplay() {
        this.mealPlans = [];
        this.displayMealPlans();
    },

    // 기존 함수명 유지: loadMealPricingData 
    async loadMealPricingData() {
        if (!this.currentLocationId) {
            console.error('[MealPricing] currentLocationId가 설정되지 않음');
            return;
        }

        console.log('[MealPricing] 데이터 로드 시작, 사업장ID:', this.currentLocationId);

        const storageKey = `meal_pricing_${this.currentLocationId}`;
        console.log('[MealPricing] 스토리지 키:', storageKey);
        
        const savedData = localStorage.getItem(storageKey);
        console.log('[MealPricing] 저장된 데이터 확인:', savedData ? `${savedData.length}자 데이터 있음` : '데이터 없음');
        
        if (savedData) {
            try {
                this.mealPlans = JSON.parse(savedData);
                console.log('[MealPricing] 저장된 데이터 로드 성공:', this.mealPlans);
            } catch (error) {
                console.error('[MealPricing] 저장된 데이터 파싱 오류:', error);
                this.createDefaultMealPlans();
            }
        } else {
            console.log('[MealPricing] 저장된 데이터 없음, 기본 식단표 생성');
            this.createDefaultMealPlans();
        }

        console.log('[MealPricing] displayMealPlans 호출 전, mealPlans:', this.mealPlans);
        this.displayMealPlans();
        console.log('[MealPricing] displayMealPlans 호출 완료');
    },

    createDefaultMealPlans() {
        this.mealPlans = [
            {
                id: Date.now(),
                name: '기본 식단표',
                meal_time: 'lunch',
                selling_price: 0,
                target_material_cost: 0,
                location_id: this.currentLocationId
            }
        ];
        console.log('[MealPricing] 기본 식단표 생성됨');
    },

    // 기존 함수명 유지: saveMealPricing
    async saveMealPricing() {
        if (!this.currentLocationId) {
            alert('사업장을 먼저 선택해주세요.');
            return;
        }

        const storageKey = `meal_pricing_${this.currentLocationId}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(this.mealPlans));
            console.log('[MealPricing] 저장 성공:', this.mealPlans);
            alert('식단가 정보가 저장되었습니다.');
        } catch (error) {
            console.error('[MealPricing] 저장 실패:', error);
            alert('저장 중 오류가 발생했습니다.');
        }
    },

    // 기존 함수명 유지: addNewMealPlan
    addNewMealPlan() {
        if (!this.currentLocationId) {
            alert('사업장을 먼저 선택해주세요.');
            return;
        }

        const name = prompt('새 식단표 이름을 입력하세요:', '새 식단표');
        if (!name || name.trim() === '') return;

        const newPlan = {
            id: Date.now(),
            name: name.trim(),
            meal_time: 'lunch',
            selling_price: 0,
            target_material_cost: 0,
            location_id: this.currentLocationId
        };

        this.mealPlans.push(newPlan);
        this.displayMealPlans();
        console.log('[MealPricing] 새 식단표 추가:', newPlan);
    },

    // 기존 함수명 유지: displayMealPlans
    displayMealPlans() {
        console.log('[MealPricing] displayMealPlans 시작');
        
        const container = document.getElementById('mealPlansContainer');
        console.log('[MealPricing] 컨테이너 찾기 결과:', container ? '찾음' : '못찾음');
        
        if (!container) {
            console.error('[MealPricing] mealPlansContainer 요소를 찾을 수 없습니다');
            // DOM에서 실제로 존재하는 요소들을 확인
            console.log('[MealPricing] DOM에서 meal 관련 요소들:', 
                document.querySelectorAll('[id*="meal"]').length + '개 찾음');
            return;
        }

        console.log('[MealPricing] 표시할 식단표 개수:', this.mealPlans.length);
        
        if (this.mealPlans.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 20px;">식단표가 없습니다.</p>';
            console.log('[MealPricing] 빈 상태 메시지 표시');
            return;
        }

        // 엑셀 표 형태의 테이블 생성
        let html = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px;">
                <thead>
                    <tr style="background-color: #f8f9fa;">
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 120px;">식사시간</th>
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 200px;">식단표명</th>
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 120px;">판매가격</th>
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 120px;">목표재료비</th>
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 80px;">재료비율(%)</th>
                        <th style="border: 1px solid #dee2e6; padding: 12px; text-align: center; width: 80px;">삭제</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        this.mealPlans.forEach((plan, index) => {
            const ratio = plan.selling_price > 0 ? ((plan.target_material_cost / plan.selling_price) * 100).toFixed(1) : 0;
            const isHighRatio = ratio > 40;
            
            html += `
                <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
                    <td style="border: 1px solid #dee2e6; padding: 8px; text-align: center;">
                        <select onchange="MealPricingModule.updateMealTime(${index}, this.value)" 
                                style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px;">
                            <option value="breakfast" ${plan.meal_time === 'breakfast' ? 'selected' : ''}>조식</option>
                            <option value="lunch" ${plan.meal_time === 'lunch' ? 'selected' : ''}>중식</option>
                            <option value="dinner" ${plan.meal_time === 'dinner' ? 'selected' : ''}>석식</option>
                            <option value="snack" ${plan.meal_time === 'snack' ? 'selected' : ''}>간식</option>
                        </select>
                    </td>
                    <td style="border: 1px solid #dee2e6; padding: 8px;">
                        <input type="text" value="${plan.name || ''}" 
                               onchange="MealPricingModule.updateMealName(${index}, this.value)"
                               placeholder="식단표명 입력"
                               style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px;">
                    </td>
                    <td style="border: 1px solid #dee2e6; padding: 8px;">
                        <input type="number" value="${plan.selling_price}" 
                               onchange="MealPricingModule.updateSellingPrice(${index}, this.value)"
                               onkeydown="MealPricingModule.handleTabNavigation(event, ${index}, 'selling_price')"
                               placeholder="0" min="0"
                               style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; text-align: right; font-size: 13px;">
                    </td>
                    <td style="border: 1px solid #dee2e6; padding: 8px;">
                        <input type="number" value="${plan.target_material_cost}" 
                               onchange="MealPricingModule.updateMaterialCost(${index}, this.value)"
                               onkeydown="MealPricingModule.handleTabNavigation(event, ${index}, 'target_cost')"
                               placeholder="0" min="0"
                               style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; text-align: right; font-size: 13px;">
                    </td>
                    <td style="border: 1px solid #dee2e6; padding: 8px; text-align: right; font-weight: bold; color: ${isHighRatio ? '#dc3545' : '#495057'};">
                        ${ratio}%
                        ${isHighRatio ? ' ⚠️' : ''}
                    </td>
                    <td style="border: 1px solid #dee2e6; padding: 8px; text-align: center;">
                        <button onclick="MealPricingModule.deleteMealPlan(${index})" 
                                style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">
                            삭제
                        </button>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;

        console.log('[MealPricing] HTML 생성 완료, 길이:', html.length);
        container.innerHTML = html;
        console.log('[MealPricing] 컨테이너에 HTML 삽입 완료');
    },

    // 업데이트 함수들
    updateMealTime(index, value) {
        this.mealPlans[index].meal_time = value;
        console.log('[MealPricing] 식사 시간 업데이트:', this.mealPlans[index]);
    },

    updateMealName(index, value) {
        this.mealPlans[index].name = value.trim();
        console.log('[MealPricing] 세부식단명 업데이트:', this.mealPlans[index]);
    },

    updateSellingPrice(index, value) {
        this.mealPlans[index].selling_price = parseFloat(value) || 0;
        console.log('[MealPricing] 판매가격 업데이트:', this.mealPlans[index]);
        this.displayMealPlans(); // 재료비 비율 업데이트를 위해 재렌더링
    },

    updateMaterialCost(index, value) {
        this.mealPlans[index].target_material_cost = parseFloat(value) || 0;
        console.log('[MealPricing] 목표재료비 업데이트:', this.mealPlans[index]);
        this.displayMealPlans(); // 재료비 비율 업데이트를 위해 재렌더링
    },

    deleteMealPlan(index) {
        if (confirm('정말로 이 식단표를 삭제하시겠습니까?')) {
            this.mealPlans.splice(index, 1);
            this.displayMealPlans();
            console.log('[MealPricing] 식단표 삭제됨');
        }
    },

    handleTabNavigation(event, index, fieldType) {
        if (event.key === 'Tab') {
            event.preventDefault();
            
            if (fieldType === 'selling_price') {
                // 판매가격에서 Tab 누르면 같은 row의 목표재료비로 이동
                const targetField = document.querySelector(`input[onchange="MealPricingModule.updateMaterialCost(${index}, this.value)"]`);
                if (targetField) {
                    targetField.focus();
                    targetField.select();
                }
            } else if (fieldType === 'target_cost') {
                // 목표재료비에서 Tab 누르면 다음 row의 판매가격으로 이동
                const nextIndex = index + 1;
                if (nextIndex < this.mealPlans.length) {
                    const nextField = document.querySelector(`input[onchange="MealPricingModule.updateSellingPrice(${nextIndex}, this.value)"]`);
                    if (nextField) {
                        nextField.focus();
                        nextField.select();
                    }
                }
            }
        }
    },

    // 기존 데이터 조회 (버튼용)
    loadExistingData() {
        if (!this.currentLocationId) {
            alert('먼저 사업장을 선택해주세요.');
            return;
        }
        console.log('[MealPricing] 기존 데이터 조회 시작');
        this.loadMealPricingData();
    }
};

// 전역 함수 등록
window.addNewMealPlan = () => MealPricingModule.addNewMealPlan();
window.saveMealPricing = () => MealPricingModule.saveMealPricing();

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    MealPricingModule.init();
    console.log('🍽️ MealPricingModule 초기화 완료');
});