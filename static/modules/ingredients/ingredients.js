// 식자재 관리 모듈
(function () {
    'use strict';

    // 식자재 관련 변수
    let uploadedFiles = [];
    let uploadHistory = [];

    // 정확한 필드 헤더 (띄어쓰기, 괄호 포함 - 매우 중요!)
    const FIELD_HEADERS = [
        '분류(대분류)',
        '기본식자재(세분류)',
        '고유코드',
        '식자재명',
        '원산지',
        '게시유무',
        '규격',
        '단위',
        '면세',
        '선발주일',
        '입고가',
        '판매가',
        '거래처명',
        '비고',
        '등록일'
    ];

    // IngredientsModule 객체 (다른 모듈과 일관성 유지)
    window.IngredientsModule = {
        currentPage: 1,
        totalPages: 1,
        editingId: null,

        // 모듈 초기화
        async init() {
            console.log('🎬 IngredientsModule.init() 호출됨');
            try {
                console.log('1️⃣ loadIngredients 호출 시작');
                await this.loadIngredients();
                console.log('✅ loadIngredients 완료');

                console.log('2️⃣ loadIngredientStatistics 호출 시작');
                await this.loadIngredientStatistics();
                console.log('✅ loadIngredientStatistics 완료');

                console.log('3️⃣ loadRecentIngredients 호출 시작');
                await this.loadRecentIngredients();
                console.log('✅ loadRecentIngredients 완료');

                console.log('4️⃣ setupEventListeners 호출 시작');
                this.setupEventListeners();
                console.log('✅ setupEventListeners 완료');

                console.log('5️⃣ initPriceProgress 호출 시작');
                this.initPriceProgress();
                console.log('✅ initPriceProgress 완료');

                console.log('✅ IngredientsModule.init() 전체 완료');
            } catch (error) {
                console.error('❌ IngredientsModule.init() 실패:', error);
                console.error('❌ 에러 스택:', error.stack);

                // 에러가 발생해도 최소한 테이블은 표시
                const tbody = document.getElementById('ingredients-table-body');
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="17" style="color: red; padding: 20px; text-align: center;">
                    <h3>❌ 초기화 실패</h3>
                    <p>에러: ${error.message}</p>
                    <p style="font-size: 12px;">F12 콘솔에서 자세한 내용을 확인하세요.</p>
                </td></tr>`;
                }
            }
            return this;
        },

        // 단가 계산 진행률 초기화
        initPriceProgress() {
            // 진행률 모듈 로드
            if (typeof window.PriceProgressTracker === 'undefined') {
                const script = document.createElement('script');
                script.src = '/static/modules/price-progress/price-progress.js';
                script.onload = () => {
                    window.PriceProgressTracker.init('ingredients-content');
                    this.addProgressButton();
                };
                document.head.appendChild(script);
            } else {
                window.PriceProgressTracker.init('ingredients-content');
                this.addProgressButton();
            }
        },

        // 진행률 표시 버튼 추가
        addProgressButton() {
            try {
                const buttonContainer = document.querySelector('.filters-container') ||
                    document.querySelector('.ingredients-header') ||
                    document.querySelector('#ingredients-content');

                if (buttonContainer && !document.getElementById('show-progress-btn')) {
                    const progressButton = document.createElement('button');
                    progressButton.id = 'show-progress-btn';
                    progressButton.className = 'btn btn-info me-2';
                    progressButton.innerHTML = '<i class="fas fa-chart-line"></i> 단가 계산 진행률';
                    progressButton.onclick = () => {
                        try {
                            if (window.PriceProgressTracker && typeof window.PriceProgressTracker.show === 'function') {
                                window.PriceProgressTracker.show();
                            } else {
                                console.log('PriceProgressTracker not available');
                                showNotification('단가 계산 진행률 기능을 준비 중입니다.', 'info');
                            }
                        } catch (error) {
                            console.error('Progress button error:', error);
                            showNotification('진행률 표시 중 오류가 발생했습니다.', 'error');
                        }
                    };

                    buttonContainer.appendChild(progressButton);
                }
            } catch (error) {
                console.error('addProgressButton error:', error);
            }
        },

        // 관리자 로그인 요청
        async requestLogin() {
            try {
                const username = prompt('관리자 사용자명을 입력하세요:', 'admin');
                if (!username) return null;

                const password = prompt('비밀번호를 입력하세요:');
                if (!password) return null;

                const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/auth/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: username,
                        password: password
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    alert('로그인 실패: ' + (error.detail || '인증 오류'));
                    return null;
                }

                const result = await response.json();
                if (result.success && result.token) {
                    localStorage.setItem('auth_token', result.token);
                    console.log('🔑 로그인 성공, 토큰 저장됨');
                    return result.token;
                } else {
                    alert('로그인 실패: 토큰을 받지 못했습니다.');
                    return null;
                }
            } catch (error) {
                console.error('🔑 로그인 오류:', error);
                alert('로그인 중 오류가 발생했습니다: ' + error.message);
                return null;
            }
        },

        // 수동 로그인 기능 (버튼용)
        async manualLogin() {
            try {
                console.log('🔑 수동 로그인 시작...');
                const token = await this.requestLogin();
                if (token) {
                    alert('로그인 성공! 이제 엑셀 업로드가 가능합니다.');
                    console.log('🔑 수동 로그인 성공');
                    return true;
                } else {
                    alert('로그인에 실패했습니다.');
                    return false;
                }
            } catch (error) {
                console.error('🔑 수동 로그인 오류:', error);
                alert('로그인 중 오류가 발생했습니다: ' + error.message);
                return false;
            }
        },

        // 단위당 단가 재계산
        async recalculateUnitPrices() {
            // 확인 대화상자
            if (!confirm('모든 식자재의 단위당 단가를 재계산하시겠습니까?\n\n약 85,000개의 데이터를 처리하므로 1-2분 정도 소요될 수 있습니다.')) {
                return;
            }

            // 진행 상태 표시를 위한 모달 생성
            const progressModal = document.createElement('div');
            progressModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 10000;
            min-width: 400px;
            text-align: center;
        `;
            progressModal.innerHTML = `
            <h3 style="margin-bottom: 20px;">🔄 단위당 단가 재계산 중...</h3>
            <div style="margin-bottom: 15px;">
                <div style="background: #f0f0f0; border-radius: 10px; height: 30px; overflow: hidden;">
                    <div id="progressBar" style="background: linear-gradient(90deg, #4CAF50, #45a049); height: 100%; width: 0%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                        0%
                    </div>
                </div>
            </div>
            <p id="progressText" style="color: #666;">재계산을 시작하는 중...</p>
            <p style="font-size: 12px; color: #999; margin-top: 10px;">잠시만 기다려주세요.</p>
        `;
            document.body.appendChild(progressModal);

            // 배경 오버레이
            const overlay = document.createElement('div');
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;
            document.body.appendChild(overlay);

            try {
                const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.location.origin;

                // 진행률 시뮬레이션 (실제 진행 상황을 알 수 없으므로)
                let progress = 0;
                const progressInterval = setInterval(() => {
                    if (progress < 90) {
                        progress += Math.random() * 10;
                        progress = Math.min(progress, 90);
                        document.getElementById('progressBar').style.width = progress + '%';
                        document.getElementById('progressBar').textContent = Math.floor(progress) + '%';
                        document.getElementById('progressText').textContent = `약 ${Math.floor(progress * 850)}개 처리 중...`;
                    }
                }, 500);

                const response = await fetch(`${API_BASE_URL}/api/admin/ingredients/recalculate-unit-prices`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                clearInterval(progressInterval);

                if (response.ok) {
                    const result = await response.json();

                    // 완료 표시
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('progressBar').textContent = '100%';
                    document.getElementById('progressText').textContent = '재계산 완료!';

                    setTimeout(() => {
                        document.body.removeChild(progressModal);
                        document.body.removeChild(overlay);

                        alert(`✅ 단위당 단가 재계산 완료!\n\n${result.message}`);

                        // 테이블 새로고침
                        this.loadIngredients();
                    }, 1000);
                } else {
                    throw new Error('재계산 실패');
                }
            } catch (error) {
                // console.error('재계산 오류:', error);
                document.body.removeChild(progressModal);
                document.body.removeChild(overlay);
                alert('❌ 재계산 중 오류가 발생했습니다.\n\n' + error.message);
            }
        },

        // 이벤트 리스너 설정
        setupEventListeners() {
            const searchInput = document.getElementById('ingredients-search');
            if (searchInput) {
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.searchIngredients();
                    }
                });
            }
        },

        // 식자재 목록 로드
        async loadIngredients() {
            console.log('🔄 loadIngredients() 시작');
            try {
                const search = document.getElementById('ingredients-search')?.value || '';
                const category = document.getElementById('ingredient-category-filter')?.value || '';
                const excludeUnpublished = document.getElementById('exclude-unpublished')?.checked !== false;
                const excludeNoPrice = document.getElementById('exclude-no-price')?.checked !== false;
                const showRecentOnly = document.getElementById('show-recent-only')?.checked === true;
                const page = this.currentPage || 1;

                console.log('📋 DOM 요소 확인:', {
                    search: !!document.getElementById('ingredients-search'),
                    category: !!document.getElementById('ingredient-category-filter'),
                    excludeUnpublished: !!document.getElementById('exclude-unpublished'),
                    excludeNoPrice: !!document.getElementById('exclude-no-price'),
                    showRecentOnly: !!document.getElementById('show-recent-only')
                });

                // 검색이 있으면 더 많이 표시하되 합리적인 수준으로
                const perPage = search ? 5000 : 1000;
                let url = `${window.CONFIG?.API_BASE_URL || window.location.origin}/api/admin/ingredients-new?page=${page}&per_page=${perPage}`;
                url += `&exclude_no_price=${excludeNoPrice}`;
                url += `&exclude_unpublished=${excludeUnpublished}`;
                if (search) url += `&search=${encodeURIComponent(search)}`;
                if (category) url += `&category=${encodeURIComponent(category)}`;

                console.log('🔍 API 호출 URL:', url);
                console.log('🔍 검색어:', search);
                console.log('✨ 최근 업로드만 보기:', showRecentOnly);

                const response = await fetch(url);
                console.log('📡 API 응답 상태:', response.status);
                const data = await response.json();
                console.log('📦 API 응답 데이터:', data);

                if (data.success) {
                    // API 응답 구조: data.data.ingredients 또는 data.ingredients
                    let ingredients = data.data?.ingredients || data.ingredients || [];
                    console.log('📊 파싱된 식자재 개수:', ingredients.length);

                    // 최근 업로드 필터 적용 (7일 이내)
                    if (showRecentOnly) {
                        try {
                            const sevenDaysAgo = new Date();
                            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                            const beforeCount = ingredients.length;
                            ingredients = ingredients.filter(item => {
                                try {
                                    // updated_at 또는 created_at 사용 (안전한 파싱)
                                    const dateStr = item.updated_at || item.created_at;
                                    if (!dateStr) return false; // 날짜 정보 없으면 제외

                                    const itemDate = new Date(dateStr);
                                    // 유효한 날짜인지 확인
                                    if (isNaN(itemDate.getTime())) return false;

                                    return itemDate >= sevenDaysAgo;
                                } catch (err) {
                                    console.warn('날짜 파싱 에러:', item.ingredient_name, err);
                                    return false; // 에러 발생 시 제외
                                }
                            });

                            console.log(`✨ 최근 7일 이내 식자재: ${ingredients.length}개 (전체: ${beforeCount}개)`);

                            // 정보 박스 표시
                            const infoBox = document.getElementById('current-view-info');
                            const infoText = document.getElementById('view-info-text');
                            const infoDetail = document.getElementById('view-info-detail');

                            if (infoBox && infoText && infoDetail) {
                                infoBox.style.display = 'block';
                                infoText.textContent = `✨ 최근 7일 이내 업로드된 식자재 ${ingredients.length.toLocaleString()}개를 표시하고 있습니다`;
                                infoDetail.textContent = `업로드 확인을 마치셨다면 체크박스를 해제하여 전체 목록을 보실 수 있습니다.`;
                            }
                        } catch (err) {
                            console.error('최근 업로드 필터 에러:', err);
                            // 에러 발생 시 필터 비활성화
                            const showRecentCheckbox = document.getElementById('show-recent-only');
                            if (showRecentCheckbox) showRecentCheckbox.checked = false;
                        }
                    } else {
                        // 최근 업로드 필터가 꺼져있으면 정보 박스 숨김
                        const infoBox = document.getElementById('current-view-info');
                        if (infoBox) {
                            infoBox.style.display = 'none';
                        }
                    }

                    // 정렬 디버깅 로그
                    if (search && ingredients.length > 0) {
                        console.log('🔍 검색 결과 첫 5개 단위당 단가:');
                        ingredients.slice(0, 5).forEach((item, index) => {
                            console.log(`${index + 1}. ${item.ingredient_name}: ${item.price_per_unit}원/g`);
                        });
                    }

                    // API에서 이미 정렬되어 오므로 추가 처리 불필요
                    // (검색 시 API 레벨에서 자동으로 단위당 단가 낮은 순 정렬 + 필터링 완료)

                    this.displayIngredients(ingredients);
                    this.updatePagination(data.pagination?.page || 1, data.pagination?.total_pages || 1);
                }
            } catch (error) {
                console.error('❌ 식자재 목록 로드 실패:', error);
                console.error('❌ 에러 상세:', error.message, error.stack);
                const tbody = document.getElementById('ingredients-table-body');
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="17" style="color: red; padding: 20px;">
                    ❌ 식자재 목록을 불러올 수 없습니다.<br>
                    에러: ${error.message}<br>
                    F12 콘솔을 확인해주세요.
                </td></tr>`;
                } else {
                    console.error('❌ ingredients-table-body 요소를 찾을 수 없음!');
                }
            }
        },

        // 식자재 통계 로드
        async loadIngredientStatistics() {
            try {
                const response = await fetch(`${window.CONFIG?.API_BASE_URL || window.location.origin}/api/admin/ingredients-new?page=1&limit=100`);
                const data = await response.json();

                if (data.success && data.ingredients) {
                    const ingredients = data.ingredients;
                    const totalCount = ingredients.length;
                    const activeCount = ingredients.filter(i => i.posting_status === '게시' || i.posting_status === '활성').length;
                    const vegetableCount = ingredients.filter(i => i.category && i.category.includes('채소')).length;
                    const meatCount = ingredients.filter(i => i.category && i.category.includes('육류')).length;
                    const seafoodCount = ingredients.filter(i => i.category && i.category.includes('생선')).length;

                    // 통계 카드 업데이트
                    this.updateStatistics({
                        total: totalCount,
                        active: activeCount,
                        vegetable: vegetableCount,
                        meat: meatCount,
                        seafood: seafoodCount
                    });
                }
            } catch (error) {
                // console.error('식자재 통계 로드 실패:', error);
            }
        },

        // 최신 업데이트 식자재 로드
        async loadRecentIngredients() {
            try {
                const response = await fetch(`${window.CONFIG?.API_BASE_URL || window.location.origin}/api/admin/ingredients-new?page=1&per_page=5&exclude_no_price=false&exclude_unpublished=false`);
                const data = await response.json();

                if (data.success && data.ingredients && data.ingredients.length > 0) {
                    // 최신 업데이트 날짜 업데이트
                    const latestIngredient = data.ingredients[0];
                    const lastUpdate = new Date(latestIngredient.created_at).toLocaleDateString();
                    const lastUpdateElement = document.getElementById('last-update');
                    if (lastUpdateElement) {
                        lastUpdateElement.textContent = lastUpdate;
                    }

                    // 최신 업데이트 식자재 정보 툴팁 추가
                    const lastUpdateParent = lastUpdateElement?.parentElement;
                    if (lastUpdateParent) {
                        lastUpdateParent.title = `최근 등록: ${latestIngredient.ingredient_name} (${latestIngredient.supplier_name})`;
                    }
                }
            } catch (error) {
                // console.error('최신 식자재 로드 실패:', error);
            }
        },

        // 통계 업데이트
        updateStatistics(stats) {
            const totalElement = document.getElementById('total-ingredients-count');
            const activeTextElement = document.getElementById('active-ingredients-text');
            const vegetableElement = document.getElementById('vegetable-count');
            const meatElement = document.getElementById('meat-count');
            const seafoodElement = document.getElementById('seafood-count');

            if (totalElement) totalElement.textContent = stats.total;
            if (activeTextElement) activeTextElement.textContent = `게시: ${stats.active}개`;
            if (vegetableElement) vegetableElement.textContent = stats.vegetable;
            if (meatElement) meatElement.textContent = stats.meat;
            if (seafoodElement) seafoodElement.textContent = stats.seafood;
        },

        // 식자재 목록 표시
        displayIngredients(ingredients) {
            const tbody = document.getElementById('ingredients-table-body');
            if (!tbody) return;

            if (!ingredients || ingredients.length === 0) {
                tbody.innerHTML = '<tr><td colspan="16">등록된 식자재가 없습니다.</td></tr>';
                return;
            }

            // 단위당 단가 포매팅 함수
            const formatUnitPrice = (price) => {
                if (!price || price === 0) return '-';
                return `<span style="color: #007bff; font-weight: 600;">${Number(price).toFixed(1)}</span>`;
            };

            tbody.innerHTML = ingredients.map(ingredient => {
                // 단위당 단가 상태 표시 (0이면 빨간색)
                const pricePerUnit = ingredient.price_per_unit || 0;
                const priceClass = pricePerUnit === 0 ? 'price-failed' : '';
                const priceStyle = pricePerUnit === 0 ? 'color: #f44336; font-weight: bold;' : '';

                // posting_status 변환: posted → 유, unpublished → 무, 나머지 → 공란
                const getPostingStatus = (status) => {
                    if (!status) return ''; // null, undefined → 공란
                    if (status === 'posted' || status === '판매중' || status === '게시') return '유';
                    if (status === 'unpublished' || status === '미게시') return '무';
                    return ''; // 기타 → 공란
                };

                return `
            <tr>
                <td>${ingredient.category || '-'}</td>
                <td>${ingredient.sub_category || ingredient['기본식자재(세분류)'] || '-'}</td>
                <td>${ingredient.ingredient_code || '-'}</td>
                <td>${ingredient.ingredient_name || '-'}</td>
                <td>${ingredient.origin || '-'}</td>
                <td>${getPostingStatus(ingredient.posting_status)}</td>
                <td>${ingredient.specification || '-'}</td>
                <td>${ingredient.unit || '-'}</td>
                <td>${ingredient.tax_type || '-'}</td>
                <td>${ingredient.delivery_days || '-'}</td>
                <td class="${priceClass}" style="${priceStyle}">${formatUnitPrice(ingredient.price_per_unit)}</td>
                <td style="text-align: center; padding: 2px;">
                    <button
                        onclick="window.recalculateSingleIngredient(${ingredient.id})"
                        title="재계산"
                        style="background: none; border: 1px solid #ddd; border-radius: 3px; padding: 2px 6px; font-size: 16px; cursor: pointer; line-height: 1;">
                        🔄
                    </button>
                </td>
                <td>${ingredient.purchase_price ? Number(ingredient.purchase_price).toLocaleString() : '-'}</td>
                <td>${ingredient.selling_price ? Number(ingredient.selling_price).toLocaleString() : '-'}</td>
                <td>${ingredient.supplier_name || '-'}</td>
                <td>${ingredient.notes || '-'}</td>
                <td>${ingredient.created_at ? new Date(ingredient.created_at).toLocaleDateString('ko-KR') : '-'}</td>
            </tr>
            `;
            }).join('');
        },

        // 페이지네이션 업데이트
        updatePagination(current, total) {
            this.currentPage = current;
            this.totalPages = total;
            const pageInfo = document.getElementById('ingredients-page-info');
            if (pageInfo) {
                pageInfo.textContent = `${current} / ${total}`;
            }
        },

        // 검색
        searchIngredients() {
            this.currentPage = 1;
            this.loadIngredients();
        },

        // 새 식자재 추가 모달
        showAddModal() {
            // console.log('새 식자재 추가 모달');
            alert('새 식자재 추가 기능 (구현 예정)');
        },

        // 식자재 수정
        editIngredient(id) {
            // console.log('식자재 수정:', id);
            alert(`식자재 수정 기능 - ID: ${id} (구현 예정)`);
        },

        // 상태 토글
        toggleStatus(id) {
            // console.log('식자재 상태 토글:', id);
            alert(`식자재 상태 토글 기능 - ID: ${id} (구현 예정)`);
        },

        // 식자재 삭제
        deleteIngredient(id) {
            if (!confirm('정말로 이 식자재를 삭제하시겠습니까?')) {
                return;
            }
            // console.log('식자재 삭제:', id);
            alert(`식자재 삭제 기능 - ID: ${id} (구현 예정)`);
        },

        // 템플릿 다운로드
        downloadTemplate() {
            try {
                // API를 통한 템플릿 다운로드
                const apiBase = window.CONFIG?.API?.BASE_URL || window.location.origin;
                const link = document.createElement('a');
                link.href = `${apiBase}/api/admin/download-template`;
                link.download = '식자재_업로드_템플릿.xls';
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // 다운로드 성공 메시지
                if (typeof showNotification === 'function') {
                    showNotification('📋 템플릿 다운로드가 시작되었습니다.', 'success');
                }
                console.log('[템플릿] 다운로드 URL:', link.href);
            } catch (error) {
                console.error('템플릿 다운로드 실패:', error);
                if (typeof showNotification === 'function') {
                    showNotification('❌ 템플릿 다운로드에 실패했습니다.', 'error');
                }
            }
        },

        // 오류 데이터 다운로드
        downloadErrors() {
            if (!this.errorData || this.errorData.length === 0) {
                alert('다운로드할 오류 데이터가 없습니다.');
                return;
            }
            // 오류 데이터를 CSV로 변환하여 다운로드
            const csvContent = this.convertToCSV(this.errorData);
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `오류_데이터_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        // 파일 선택 처리
        handleFileSelect(event) {
            console.log('🔍 handleFileSelect 호출됨');
            event.preventDefault();
            event.stopPropagation();
            const file = event.target.files[0];
            console.log('📁 선택된 파일:', file);
            if (!file) {
                console.log('❌ 파일이 없음');
                return;
            }

            const fileInfo = document.getElementById('file-info');
            const fileName = document.getElementById('file-name');
            const fileSize = document.getElementById('file-size');

            console.log('🎯 DOM 요소들:', {
                fileInfo: fileInfo,
                fileName: fileName,
                fileSize: fileSize
            });

            if (fileInfo && fileName && fileSize) {
                fileName.textContent = file.name;
                fileSize.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} MB)`;
                fileInfo.style.display = 'flex';
                console.log('✅ 파일 정보 표시 완료:', file.name);
                console.log('📱 fileInfo display:', fileInfo.style.display);
            } else {
                console.log('❌ DOM 요소를 찾을 수 없음');
            }

            this.selectedFile = file;
        },

        // CSV 변환
        convertToCSV(data) {
            const fieldHeaders = [
                '분류(대분류)', '기본식자재(세분류)', '고유코드', '식자재명',
                '원산지', '게시유무', '규격', '단위', '면세', '선발주일',
                '입고가', '판매가', '거래처명', '비고', '등록일'
            ];
            const headers = fieldHeaders.join(',');
            const rows = data.map(row =>
                fieldHeaders.map(header => row[header] || '').join(',')
            );
            return headers + '\n' + rows.join('\n');
        },

        // 단위당 단가 계산
        calculatePricePerUnit() {
            // console.log('단위당 단가 계산 시작...');

            // price-per-gram 모듈이 있으면 사용
            if (window.PricePerGramModule) {
                window.PricePerGramModule.calculateAll();
            } else {
                // 간단한 계산 로직
                const ingredients = document.querySelectorAll('#ingredients-table-body tr');
                ingredients.forEach(row => {
                    const priceCell = row.querySelector('td:nth-child(6)'); // 입고가
                    const specCell = row.querySelector('td:nth-child(7)'); // 규격

                    if (priceCell && specCell) {
                        const price = parseFloat(priceCell.textContent.replace(/[^\d]/g, ''));
                        const specText = specCell.textContent;

                        // 규격에서 무게 추출 (예: "1kg", "500g", "2.5kg")
                        const weightMatch = specText.match(/(\d+(?:\.\d+)?)\s*(kg|g)/i);
                        if (weightMatch) {
                            const weight = parseFloat(weightMatch[1]);
                            const unit = weightMatch[2].toLowerCase();
                            const grams = unit === 'kg' ? weight * 1000 : weight;

                            if (grams > 0) {
                                const pricePerGram = (price / grams).toFixed(2);
                                // console.log(`${specText}: ₩${pricePerGram}/단위`);
                            }
                        }
                    }
                });
            }

            alert('단위당 단가 계산이 완료되었습니다. 콘솔에서 결과를 확인하세요.');
        },

        // 단가 이력 업로드 처리
        async uploadPriceHistory() {
            const fileInput = document.getElementById('priceHistoryAdminFile');
            const startDate = document.getElementById('priceAdminStartDate').value;
            const endDate = document.getElementById('priceAdminEndDate').value;
            const file = fileInput.files[0];

            if (!file) {
                alert('파일을 선택해주세요.');
                return;
            }

            if (!startDate) {
                alert('시작일을 입력해주세요.');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('start_date', startDate);
            if (endDate) {
                formData.append('end_date', endDate);
            }

            // 로딩 표시
            const uploadBtn = document.querySelector('#priceHistoryAdminModal .btn-primary');
            const originalText = uploadBtn.innerHTML;
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 업로드 중...';

            try {
                console.log('📤 단가 이력 업로드 시작:', file.name, startDate, endDate);

                const response = await fetch('/api/admin/ingredients/upload-price-history', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                console.log('📥 업로드 결과:', result);

                if (result.success) {
                    alert(result.message || '업로드가 완료되었습니다.');
                    document.getElementById('priceHistoryAdminModal').style.display = 'none';

                    // 입력 필드 초기화
                    fileInput.value = '';
                    document.getElementById('priceAdminStartDate').value = '';
                    document.getElementById('priceAdminEndDate').value = '';

                    // 목록 새로고침
                    this.loadIngredients();
                } else {
                    alert('업로드 실패: ' + (result.error || '알 수 없는 오류'));
                }
            } catch (error) {
                console.error('Upload Error:', error);
                alert('업로드 중 오류가 발생했습니다: ' + error.message);
            } finally {
                // 버튼 복원
                if (uploadBtn) {
                    uploadBtn.disabled = false;
                    uploadBtn.innerHTML = originalText;
                }
            }
        }
    };

    // 식자재 관리 페이지 초기화
    function initializeIngredientsPage() {
        console.log('식자재 관리 모듈 초기화');
        setupEventListeners();
        loadUploadHistory();
        loadSupplierStats(); // 협력업체별 통계 로드
    }

    // 이벤트 리스너 설정
    function setupEventListeners() {
        const fileInput = document.getElementById('excel-file-input'); // 템플릿의 올바른 ID
        const uploadArea = document.getElementById('excel-upload-area'); // 템플릿의 올바른 ID

        console.log('파일 입력 요소:', fileInput); // 디버깅용
        console.log('업로드 영역 요소:', uploadArea); // 디버깅용

        // 전체 문서에 대한 드래그 앤 드롭 기본 동작 방지 (브라우저가 파일을 열지 않도록)
        document.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
        });
        document.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('⚠️ 업로드 영역 밖에 파일을 드롭했습니다. 업로드 영역에 드롭해주세요.');
        });
        console.log('전체 문서 드래그 방지 이벤트 등록됨');

        if (fileInput) {
            // 파일 선택 이벤트
            fileInput.addEventListener('change', handleFileSelect);
            console.log('파일 입력 이벤트 리스너 연결됨');
        }

        if (uploadArea) {
            // 드래그 앤 드롭 이벤트
            uploadArea.addEventListener('dragover', handleDragOver);
            uploadArea.addEventListener('dragleave', handleDragLeave);
            uploadArea.addEventListener('drop', handleFileDrop);
            console.log('드래그 앤 드롭 이벤트 리스너 연결됨');
        }

        // 업로드 시작 버튼 연결
        const uploadBtn = document.getElementById('newUploadBtn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', uploadFiles);  // uploadFile → uploadFiles 수정
            console.log('업로드 버튼 이벤트 리스너 연결됨');
        }

        // 날짜 필터 기본값 설정
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const dateToElement = document.getElementById('date-to');
        const dateFromElement = document.getElementById('date-from');

        if (dateToElement) dateToElement.value = today;
        if (dateFromElement) dateFromElement.value = weekAgo;
    }

    // 파일 업로드 섹션 토글
    function showUploadSection() {
        const uploadSection = document.getElementById('upload-section');
        const historySection = document.getElementById('upload-history-section');

        if (!uploadSection) return;

        // 다른 섹션 숨기기
        if (historySection && historySection.style.display !== 'none') {
            historySection.style.display = 'none';
        }

        const isVisible = uploadSection.style.display !== 'none';
        uploadSection.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            showNotification('📁 파일 업로드 섹션이 열렸습니다.', 'info');
        }
    }

    // 양식 다운로드
    function downloadTemplate() {
        try {
            // API를 통한 템플릿 다운로드
            const apiBase = window.CONFIG?.API?.BASE_URL || window.location.origin;
            const link = document.createElement('a');
            link.href = `${apiBase}/api/admin/download-template`;
            link.download = '식자재_업로드_템플릿.xls';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // 다운로드 성공 메시지
            showNotification('📋 템플릿 다운로드가 시작되었습니다.', 'success');
            console.log('[템플릿] 다운로드 URL:', link.href);
        } catch (error) {
            console.error('템플릿 다운로드 실패:', error);
            showNotification('❌ 템플릿 다운로드에 실패했습니다.', 'error');
        }
    }

    // 업로드 결과 조회 표시
    function showUploadHistory() {
        const historySection = document.getElementById('upload-history-section');
        const uploadSection = document.getElementById('upload-section');

        if (!historySection) return;

        // 다른 섹션 숨기기
        if (uploadSection && uploadSection.style.display !== 'none') {
            uploadSection.style.display = 'none';
        }

        historySection.style.display = 'block';
        loadUploadHistory();
        showNotification('📊 업로드 결과를 조회합니다.', 'info');
    }

    // 업로드 결과 조회 숨기기
    function hideUploadHistory() {
        const historySection = document.getElementById('upload-history-section');
        const detailsSection = document.getElementById('upload-details-section');

        if (historySection) historySection.style.display = 'none';
        if (detailsSection) detailsSection.style.display = 'none';
    }

    // 파일 선택 처리
    function handleFileSelect(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        const files = Array.from(event.target.files);
        processSelectedFiles(files);
    }

    // 드래그 오버 처리
    function handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add('dragover');
    }

    // 드래그 떠남 처리
    function handleDragLeave(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('dragover');
    }

    // 파일 드롭 처리
    function handleFileDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('dragover');

        const files = Array.from(event.dataTransfer.files);
        processSelectedFiles(files);
    }

    // 선택된 파일 처리
    function processSelectedFiles(files) {
        const validFiles = files.filter(file => {
            const isExcel = file.type === 'application/vnd.ms-excel' ||
                file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
            const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB

            if (!isExcel) {
                showNotification(`❌ ${file.name}: Excel 파일만 업로드 가능합니다.`, 'error');
                return false;
            }

            if (!isValidSize) {
                showNotification(`❌ ${file.name}: 파일 크기는 10MB 이하여야 합니다.`, 'error');
                return false;
            }

            return true;
        });

        if (validFiles.length > 0) {
            uploadedFiles = validFiles;
            updateFileList();
            enableUploadButton();
            showNotification(`✅ ${validFiles.length}개 파일이 선택되었습니다.`, 'success');
        }
    }

    // 파일 선택 처리 (input change 이벤트용)
    function handleFileSelect(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        const files = Array.from(event.target.files);
        processSelectedFiles(files);
    }

    // 파일 초기화
    function clearFiles() {
        uploadedFiles = [];
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.value = '';
        }
        updateFileList();
        disableUploadButton();
        showNotification('📁 선택된 파일이 초기화되었습니다.', 'info');
    }

    // 파일 목록 업데이트
    function updateFileList() {
        // 템플릿의 실제 요소들 사용
        const fileInfo = document.getElementById('file-info');
        const fileName = document.getElementById('file-name');
        const fileSize = document.getElementById('file-size');

        if (!fileInfo || !fileName || !fileSize) {
            console.log('선택된 파일들:', uploadedFiles.map(f => f.name));
            return;
        }

        if (uploadedFiles.length === 0) {
            fileInfo.style.display = 'none';
            return;
        }

        // 첫 번째 파일 정보 표시 (템플릿은 단일 파일용)
        const file = uploadedFiles[0];
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
        fileName.textContent = file.name;
        fileSize.textContent = `(${fileSizeMB} MB)`;
        fileInfo.style.display = 'flex';
    }

    // 개별 파일 삭제
    function removeFile(index) {
        uploadedFiles.splice(index, 1);
        updateFileList();
        if (uploadedFiles.length === 0) {
            disableUploadButton();
        } else {
            enableUploadButton();
        }
    }

    // 외부에서 uploadedFiles 설정 (드래그 앤 드롭 지원)
    function setUploadedFiles(files) {
        uploadedFiles = files;
        console.log('📁 setUploadedFiles 호출됨:', files.length, '개 파일');
        updateFileList();
        if (files.length > 0) {
            enableUploadButton();
        } else {
            disableUploadButton();
        }
    }

    // 업로드 버튼 활성화
    function enableUploadButton() {
        const uploadBtn = document.getElementById('newUploadBtn');
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.style.opacity = '1';
        }
    }

    // 업로드 버튼 비활성화
    function disableUploadButton() {
        const uploadBtn = document.getElementById('newUploadBtn');
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.style.opacity = '0.5';
        }
    }

    // 파일 업로드 실행
    async function uploadFiles() {
        console.log('★★★ MODULAR uploadFiles 함수 호출됨 - 실제 서버 업로드 시작 ★★★');
        if (uploadedFiles.length === 0) {
            showNotification('❌ 업로드할 파일을 선택해주세요.', 'error');
            return;
        }

        const progressSection = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const progressPercentage = document.getElementById('progress-percentage');
        const progressPhase = document.getElementById('progress-phase');

        try {
            // 진행률 모달 표시
            if (progressSection) {
                progressSection.style.display = 'block';
                console.log('✅ 진행율 모달 표시');
            }

            // 초기 상태 설정 (강제로 0%부터 시작)
            if (progressFill) {
                progressFill.style.setProperty('width', '0%', 'important');
                progressFill.style.setProperty('transition', 'width 0.5s ease', 'important');
                console.log('🔧 진행율 바 초기화: 0%, 실제 width:', progressFill.style.width, 'offsetWidth:', progressFill.offsetWidth);
            }
            if (progressPercentage) progressPercentage.textContent = '0%';
            if (progressText) progressText.textContent = '파일 분석 중...';
            if (progressPhase) progressPhase.textContent = '상태: 업로드 준비';

            // 잠시 대기 (사용자가 0% 상태를 볼 수 있도록)
            await new Promise(resolve => setTimeout(resolve, 800));

            let totalProcessedRows = 0;
            let totalSuccessRows = 0;
            let totalFailedRows = 0;
            const uploadResults = [];

            for (let i = 0; i < uploadedFiles.length; i++) {
                const file = uploadedFiles[i];

                // 파일별 시작 진행율
                const baseProgress = (i / uploadedFiles.length) * 100;

                // 1단계: 파일 읽기 시작 (0-20%)
                const step1Progress = baseProgress + (20 / uploadedFiles.length);
                if (progressFill) {
                    progressFill.style.setProperty('width', step1Progress + '%', 'important');
                    console.log(`📊 1단계 진행율: ${step1Progress.toFixed(1)}%, 실제 width:`, progressFill.style.width);
                }
                if (progressPercentage) progressPercentage.textContent = step1Progress.toFixed(1) + '%';
                if (progressText) progressText.textContent = `${file.name} 파일 분석 중...`;
                if (progressPhase) progressPhase.textContent = `파일 ${i + 1}/${uploadedFiles.length} • 단계: 데이터 읽기`;
                await new Promise(resolve => setTimeout(resolve, 1200)); // 800ms → 1200ms

                // 2단계: 데이터 검증 (20-40%)
                const step2Progress = baseProgress + (40 / uploadedFiles.length);
                if (progressFill) {
                    progressFill.style.setProperty('width', step2Progress + '%', 'important');
                    console.log(`📊 2단계 진행율: ${step2Progress.toFixed(1)}%`);
                }
                if (progressPercentage) progressPercentage.textContent = step2Progress.toFixed(1) + '%';
                if (progressText) progressText.textContent = `${file.name} 데이터 검증 중...`;
                if (progressPhase) progressPhase.textContent = `파일 ${i + 1}/${uploadedFiles.length} • 단계: 유효성 검사`;
                await new Promise(resolve => setTimeout(resolve, 1000)); // 600ms → 1000ms

                // 3단계: 서버 업로드 시작 (40-60%)
                const step3Progress = baseProgress + (60 / uploadedFiles.length);
                if (progressFill) {
                    progressFill.style.setProperty('width', step3Progress + '%', 'important');
                    console.log(`📊 3단계 진행율: ${step3Progress.toFixed(1)}%`);
                }
                if (progressPercentage) progressPercentage.textContent = step3Progress.toFixed(1) + '%';
                if (progressText) progressText.textContent = `${file.name} 서버로 전송 중...`;
                if (progressPhase) progressPhase.textContent = `파일 ${i + 1}/${uploadedFiles.length} • 단계: 업로드`;

                // 실제 서버 업로드 (폴링 포함)
                const uploadStartTime = Date.now();
                const result = await uploadFileToServer(file);
                const uploadDuration = Date.now() - uploadStartTime;

                // 최소 2초는 업로드 중으로 표시 (서버가 너무 빨리 응답하는 경우)
                if (uploadDuration < 2000) {
                    await new Promise(resolve => setTimeout(resolve, 2000 - uploadDuration)); // 1000ms → 2000ms
                }

                // 4단계: 처리 완료 (60-100%)
                const completeProgress = ((i + 1) / uploadedFiles.length) * 100;
                if (progressFill) {
                    progressFill.style.setProperty('width', completeProgress + '%', 'important');
                    console.log(`📊 4단계 진행율: ${completeProgress.toFixed(1)}%`);
                }
                if (progressPercentage) progressPercentage.textContent = completeProgress.toFixed(1) + '%';
                if (progressText) progressText.textContent = `${file.name} 처리 완료 ✓`;
                if (progressPhase) progressPhase.textContent = `${result.processedRows}건 처리 완료 (성공: ${result.successRows}건, 실패: ${result.failedRows}건)`;
                await new Promise(resolve => setTimeout(resolve, 800)); // 500ms → 800ms

                // 결과 누적
                totalProcessedRows += result.processedRows;
                totalSuccessRows += result.successRows;
                totalFailedRows += result.failedRows;
                uploadResults.push({
                    fileName: file.name,
                    success: result.failedRows === 0,
                    processedRows: result.processedRows,
                    successRows: result.successRows,
                    failedRows: result.failedRows,
                    errors: result.errors || [],
                    message: result.message || ''
                });
            }

            // 업로드 완료 처리
            if (progressFill) {
                progressFill.style.setProperty('width', '100%', 'important');
                console.log('🎉 진행율 100% 완료!');
            }
            if (progressPercentage) progressPercentage.textContent = '100%';
            if (progressText) {
                progressText.textContent = `✅ 업로드 완료! 총 ${totalProcessedRows.toLocaleString()}건 처리`;
            }
            if (progressPhase) {
                progressPhase.textContent = `성공: ${totalSuccessRows.toLocaleString()}건 | 실패: ${totalFailedRows.toLocaleString()}건`;
            }

            console.log('✅ 업로드 완료:', { totalProcessedRows, totalSuccessRows, totalFailedRows });

            // 결과를 볼 수 있도록 4초 대기 (사용자가 결과를 읽을 시간)
            await new Promise(resolve => setTimeout(resolve, 4000)); // 3000ms → 4000ms

            // 대량 업로드 결과 표시
            displayBulkUploadResults(uploadResults, uploadedFiles.length, totalSuccessRows, 0);

            showNotification(`✅ ${uploadedFiles.length}개 파일 업로드 완료! 총 ${totalProcessedRows.toLocaleString()}개 식자재 데이터가 처리되었습니다.`, 'success');

            // 업로드 완료 후 자동으로 최근 업로드 데이터 표시
            const showRecentCheckbox = document.getElementById('show-recent-only');
            if (showRecentCheckbox) {
                showRecentCheckbox.checked = true;
                console.log('✨ 최근 업로드만 보기 자동 활성화');
            }

            // 식자재 목록 새로고침 (방금 업로드한 데이터 표시)
            if (window.IngredientsModule && window.IngredientsModule.loadIngredients) {
                setTimeout(() => {
                    window.IngredientsModule.loadIngredients();
                    console.log('🔄 식자재 목록 새로고침 완료 - 최근 업로드 데이터 표시');
                }, 1000);
            }

            // 초기화 (5초 후 모달 숨김 - 사용자가 결과를 충분히 볼 수 있도록)
            setTimeout(() => {
                uploadedFiles = [];
                updateFileList();
                disableUploadButton();
                if (progressSection) {
                    progressSection.style.display = 'none';
                    console.log('🔚 진행율 모달 숨김 (5초 경과)');
                }
            }, 5000);

            // 업로드 히스토리 갱신
            loadUploadHistory();

        } catch (error) {
            console.error('❌ 업로드 실패:', error);

            // 에러 상태 표시
            if (progressFill) {
                progressFill.style.setProperty('width', '100%', 'important');
                progressFill.style.setProperty('background', 'linear-gradient(90deg, #dc3545 0%, #c82333 100%)', 'important');
                console.log('❌ 에러 발생 - 진행율 바 빨간색으로 표시');
            }
            if (progressPercentage) progressPercentage.textContent = '오류';
            if (progressText) progressText.textContent = '❌ 업로드 실패';
            if (progressPhase) progressPhase.textContent = `오류: ${error.message}`;

            showNotification('❌ 파일 업로드 중 오류가 발생했습니다: ' + error.message, 'error');

            // 5초 후 모달 숨김 (에러 메시지를 읽을 시간)
            setTimeout(() => {
                if (progressSection) {
                    progressSection.style.display = 'none';
                    console.log('🔚 진행율 모달 숨김 (에러 발생)');
                }
            }, 5000);
        }
    }

    // 대용량 업로드 결과 표시 (18,000개 이상 식자재 데이터 처리용)
    function displayBulkUploadResults(uploadResults, totalProcessed, totalSuccess, totalFailed) {
        // 상세 결과 섹션이 있는지 확인하고 없으면 생성
        let resultsSection = document.getElementById('bulk-upload-results');
        if (!resultsSection) {
            resultsSection = document.createElement('div');
            resultsSection.id = 'bulk-upload-results';
            resultsSection.style.cssText = 'margin-top: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';

            const uploadSection = document.getElementById('upload-section');
            if (uploadSection) {
                uploadSection.appendChild(resultsSection);
            }
        }

        // 요약 통계
        const summaryHTML = `
        <div style="padding: 20px; border-bottom: 1px solid #eee;">
            <h3 style="margin: 0 0 15px 0; color: #007bff;">📊 대용량 업로드 결과</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #007bff;">${totalProcessed}</div>
                    <div style="font-size: 14px; color: #666;">처리된 파일</div>
                </div>
                <div style="background: #e8f5e8; padding: 15px; border-radius: 5px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #28a745;">${totalSuccess.toLocaleString()}</div>
                    <div style="font-size: 14px; color: #666;">성공한 식자재</div>
                </div>
                <div style="background: ${totalFailed > 0 ? '#ffe6e6' : '#f8f9fa'}; padding: 15px; border-radius: 5px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: ${totalFailed > 0 ? '#dc3545' : '#666'};">${totalFailed}</div>
                    <div style="font-size: 14px; color: #666;">실패한 파일</div>
                </div>
            </div>
        </div>
    `;

        // 파일별 상세 결과
        let detailsHTML = '';
        if (uploadResults.length > 0) {
            detailsHTML = `
            <div style="padding: 20px;">
                <h4 style="margin: 0 0 15px 0;">📋 파일별 처리 결과</h4>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${uploadResults.map(result => {
                const isSuccess = result.success;
                const statusColor = isSuccess ? '#28a745' : '#dc3545';
                const statusIcon = isSuccess ? '✅' : '❌';

                return `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border: 1px solid #eee; border-radius: 4px; margin-bottom: 8px; background: ${isSuccess ? '#f8fff8' : '#fff8f8'}; cursor: pointer;" onclick="showUploadResultDetail(${JSON.stringify(result).replace(/"/g, '&quot;')})">
                                <div style="flex: 1;">
                                    <div style="font-weight: 500;">${statusIcon} ${result.fileName}</div>
                                    ${isSuccess
                        ? `<small style="color: #666;">성공: ${(result.successRows || 0).toLocaleString()}개, 실패: ${(result.failedRows || 0).toLocaleString()}개</small>`
                        : `<small style="color: #dc3545;">${result.error}</small>`
                    }
                                </div>
                                <div style="text-align: right;">
                                    <div style="color: ${statusColor}; font-weight: bold;">
                                        ${isSuccess ? `${(result.processedRows || 0).toLocaleString()}개 처리됨` : '처리 실패'}
                                    </div>
                                </div>
                            </div>
                        `;
            }).join('')}
                </div>
                ${uploadResults.length > 10 ? `<div style="text-align: center; padding-top: 10px; color: #666; font-size: 12px;">총 ${uploadResults.length}개 파일 중 처리 완료</div>` : ''}
            </div>
        `;
        }

        resultsSection.innerHTML = summaryHTML + detailsHTML;

        // 결과 섹션으로 스크롤
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 파일 업로드 시뮬레이션 (대량 데이터 처리 시뮬레이션)
    // 실제 서버 업로드 함수
    async function uploadFileToServer(file) {
        console.log('🚀 uploadFileToServer 함수 시작 - 파일:', file.name);
        const formData = new FormData();
        formData.append('file', file);

        // 날짜 정보 추가 (단가 이력 저장용)
        const startDate = document.getElementById('upload-start-date')?.value;
        const endDate = document.getElementById('upload-end-date')?.value;
        if (startDate) {
            formData.append('start_date', startDate);
            console.log('📅 시작일 추가:', startDate);
        }
        if (endDate) {
            formData.append('end_date', endDate);
            console.log('📅 종료일 추가:', endDate);
        }

        let progressInterval = null; // 폴링 인터벌 변수를 외부에 선언

        try {
            console.log('🌐 서버 요청 시작 - /api/admin/upload-ingredients');

            // 인증 토큰 가져오기
            const token = localStorage.getItem('auth_token');
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
                console.log('🔑 인증 토큰 추가됨');
            } else {
                console.warn('⚠️ 인증 토큰이 없습니다');
            }

            // 진행 상태 폴링 시작 (임시 비활성화 - 클라이언트 진행율만 사용)
            const progressText = document.getElementById('progress-text');
            const progressFill = document.getElementById('progress-fill');
            const progressPercentage = document.getElementById('progress-percentage');
            const progressPhase = document.getElementById('progress-phase');

            // 서버 폴링 비활성화 (클라이언트 진행율과 충돌)
            progressInterval = null; // setInterval 대신 null

            /* 서버 폴링 임시 비활성화
            progressInterval = setInterval(async () => {
                try {
                    const progressResponse = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/upload-progress`, {
                        headers: headers
                    });
                    const progressData = await progressResponse.json();
    
                    if (progressData.success && progressData.is_uploading) {
                        const serverPercentage = progressData.progress_percentage || 0;
    
                        // 서버 진행율을 40%~90% 범위로 매핑 (클라이언트 단계와 충돌 방지)
                        const mappedPercentage = 40 + (serverPercentage * 0.5); // 0-100% → 40-90%
    
                        // 진행율 바 업데이트 (부드러운 애니메이션)
                        if (progressFill) {
                            progressFill.style.setProperty('width', mappedPercentage + '%', 'important');
                            console.log(`📊 서버 진행율: ${serverPercentage.toFixed(1)}% → 화면: ${mappedPercentage.toFixed(1)}%`);
                        }
    
                        // 퍼센트 텍스트 업데이트
                        if (progressPercentage) {
                            progressPercentage.textContent = mappedPercentage.toFixed(1) + '%';
                        }
    
                        // 진행 상태 텍스트 업데이트
                        if (progressText) {
                            const phase = progressData.phase || '업로드 중';
                            const current = progressData.current_row || 0;
                            const total = progressData.total_rows || 0;
    
                            if (total > 0) {
                                progressText.textContent = `${phase}... (${current.toLocaleString()}/${total.toLocaleString()}건)`;
                            } else {
                                progressText.textContent = `${phase}...`;
                            }
                        }
    
                        // 상세 정보 업데이트
                        if (progressPhase && progressData.phase) {
                            const errors = progressData.error_count || 0;
                            const errorText = errors > 0 ? ` • 오류: ${errors}건` : '';
                            progressPhase.textContent = `서버 처리 중 • ${progressData.phase}${errorText}`;
                        }
                    }
                } catch (err) {
                    console.error('진행 상태 조회 오류:', err);
                }
            }, 200); // 200ms마다 폴링 (더 빠른 업데이트)
            */ // 서버 폴링 끝

            const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/upload-ingredients`, {
                method: 'POST',
                headers: headers,
                body: formData
            });

            // 업로드 완료 - 폴링 중지
            if (progressInterval) clearInterval(progressInterval); // null이면 실행 안 함

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ HTTP 에러 ${response.status}:`, errorText);
                throw new Error(`서버 오류 (${response.status}): ${errorText.substring(0, 100)}`);
            }

            const result = await response.json();
            console.log('🎯 서버 응답:', result);
            console.log('📋 응답 타입:', typeof result);
            console.log('📋 result.success:', result.success, typeof result.success);
            console.log('📋 result.inserted:', result.inserted, typeof result.inserted);
            console.log('📋 result.updated:', result.updated, typeof result.updated);
            console.log('📋 result.data:', result.data);
            console.log('📋 result.details:', result.details);

            if (result.success && result.data) {
                // 업로드 결과 표시
                const data = result.data;

                console.log(`📊 업로드 완료: ${file.name}
- 총 처리: ${data.total_rows}행
- 신규: ${data.new_count}개
- 업데이트: ${data.updated_count}개
- 오류: ${data.error_count}개`);

                // 간단한 업로드 결과 팝업 표시
                showSimpleUploadResult({
                    fileName: file.name,
                    data: data,
                    error_details: result.error_details || []
                });

                return {
                    processedRows: data.total_rows,
                    successRows: data.new_count + data.updated_count,
                    failedRows: data.error_count,
                    errors: [],
                    message: result.message || ''
                };
            } else if (result.success && result.details) {
                // 이전 형식 지원 (details 있는 경우)
                console.log(`파일 업로드 완료: ${file.name} - ${result.details.total_rows}행 처리됨`);
                return {
                    processedRows: result.details.total_rows,
                    successRows: result.details.new_count + result.details.updated_count,
                    failedRows: result.details.error_count,
                    errors: result.details.errors || [],
                    message: result.message || ''
                };
            } else if (result.success && (result.inserted !== undefined || result.updated !== undefined)) {
                // 새로운 형식 지원 (inserted, updated, errors)
                console.log(`파일 업로드 완료: ${file.name} - ${result.total || 0}행 처리됨`);

                const inserted = result.inserted || 0;
                const updated = result.updated || 0;
                const errors = result.errors || 0;
                const total = result.total || (inserted + updated + errors);

                console.log('🎉 모달 표시 시작:', {
                    fileName: file.name,
                    total, inserted, updated, errors,
                    error_details: result.error_details
                });

                showSimpleUploadResult({
                    fileName: file.name,
                    data: {
                        total_rows: total,
                        new_count: inserted,
                        updated_count: updated,
                        error_count: errors
                    },
                    error_details: result.error_details || []
                });

                console.log('✅ 모달 표시 완료');

                return {
                    processedRows: total,
                    successRows: inserted + updated,
                    failedRows: errors,
                    errors: [],
                    message: result.message || ''
                };
            } else if (result.success) {
                // 가장 이전 형식 지원
                console.log(`파일 업로드 완료: ${file.name} - ${result.total || 0}행 처리됨`);
                return {
                    processedRows: result.total || 0,
                    successRows: result.processed || 0,
                    failedRows: result.errors || 0
                };
            } else {
                // 상세한 에러 로깅
                console.error('❌ 서버 응답 실패:', {
                    success: result.success,
                    message: result.message,
                    error: result.error,
                    details: result.details,
                    전체응답: result
                });

                const errorMessage = result.message || result.error || '업로드 실패 (원인 불명)';
                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error('업로드 오류:', error);
            // 폴링 중지
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            throw error;
        }
    }

    // simulateFileUpload 함수가 제거됨 - 실제 서버 업로드만 사용

    // 간단한 업로드 결과 표시
    function showSimpleUploadResult(result) {
        const { fileName, data, error_details } = result;

        // 에러 상세 정보 HTML 생성
        let errorDetailsHtml = '';
        if (error_details && error_details.length > 0) {
            const errorRows = error_details.map(err => `
            <tr style="border-bottom: 1px solid #dee2e6;">
                <td style="padding: 8px; text-align: center;">${err.row}</td>
                <td style="padding: 8px;">${err.code}</td>
                <td style="padding: 8px;">${err.name}</td>
                <td style="padding: 8px; color: #dc3545; font-size: 12px;">${err.error}</td>
            </tr>
        `).join('');

            errorDetailsHtml = `
            <div style="background: #f8d7da; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #f5c6cb; max-height: 200px; overflow-y: auto;">
                <h5 style="color: #721c24; margin: 0 0 10px 0;">❌ 실패한 항목 (${error_details.length}개)</h5>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #f5c6cb; font-weight: bold;">
                            <th style="padding: 8px; text-align: center; width: 60px;">행번호</th>
                            <th style="padding: 8px; width: 100px;">품목코드</th>
                            <th style="padding: 8px; width: 150px;">품명</th>
                            <th style="padding: 8px;">오류 원인</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${errorRows}
                    </tbody>
                </table>
            </div>
        `;
        }

        const modalHtml = `
        <div id="uploadResultModal" class="modal" style="display: block; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7);">
            <div class="modal-content" style="background-color: #fff; margin: 5% auto; padding: 25px; border-radius: 10px; width: 90%; max-width: 700px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); max-height: 85vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e9ecef; padding-bottom: 15px;">
                    <h2 style="color: #28a745; margin: 0;">
                        <i class="fas fa-check-circle"></i> 업로드 완료!
                    </h2>
                    <span onclick="closeUploadResultModal()" style="color: #6c757d; font-size: 24px; font-weight: bold; cursor: pointer; padding: 5px;">&times;</span>
                </div>

                <div style="margin-bottom: 20px;">
                    <h4 style="color: #495057; margin-bottom: 15px;">📁 ${fileName}</h4>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #007bff;">${data.total_rows || 0}</div>
                        <div style="color: #6c757d; font-size: 14px;">총 처리</div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${(data.new_count || 0) + (data.updated_count || 0)}</div>
                        <div style="color: #6c757d; font-size: 14px;">성공</div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #17a2b8; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #17a2b8;">${data.new_count || 0}</div>
                        <div style="color: #6c757d; font-size: 14px;">신규</div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid ${(data.error_count || 0) > 0 ? '#dc3545' : '#6c757d'}; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: ${(data.error_count || 0) > 0 ? '#dc3545' : '#6c757d'};">${data.error_count || 0}</div>
                        <div style="color: #6c757d; font-size: 14px;">오류</div>
                    </div>
                </div>

                <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #bee5eb;">
                    <div style="color: #0c5460; font-size: 14px; text-align: center;">
                        <strong>업데이트: ${data.updated_count || 0}개</strong> | 배치 ID: ${data.batch_id || '-'}
                    </div>
                </div>

                ${errorDetailsHtml}

                <div style="text-align: center;">
                    <button onclick="closeUploadResultModal()" style="background: #007bff; color: white; border: none; padding: 10px 30px; border-radius: 5px; cursor: pointer; font-size: 16px;">
                        확인
                    </button>
                </div>
            </div>
        </div>
    `;

        // 기존 모달 제거
        const existingModal = document.getElementById('uploadResultModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 새 모달 추가
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 업로드 결과 모달 닫기
    window.closeUploadResultModal = function () {
        const modal = document.getElementById('uploadResultModal');
        if (modal) {
            modal.remove();
        }
    };

    // 업로드 히스토리 로드
    function loadUploadHistory() {
        // 실제 구현에서는 API에서 데이터를 가져옴
        // console.log('업로드 히스토리 로드됨');
    }

    // 업로드 결과 상세 팝업 표시 - 전역 함수로 선언
    window.showUploadResultDetail = function (result) {
        const isSuccess = result.failedRows === 0;

        // 팝업 HTML 생성
        const popupHtml = `
        <div id="resultDetailModal" class="modal" style="display: block; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);">
            <div class="modal-content" style="background-color: #fefefe; margin: 5% auto; padding: 20px; border: 1px solid #888; width: 80%; max-width: 800px; max-height: 80vh; overflow-y: auto; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="color: ${isSuccess ? '#28a745' : '#dc3545'};">
                        <i class="bi bi-${isSuccess ? 'check-circle' : 'exclamation-triangle'}"></i>
                        업로드 ${isSuccess ? '성공' : '결과'}
                    </h2>
                    <span onclick="closeResultModal()" style="color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer;">&times;</span>
                </div>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                    <h4>${result.fileName}</h4>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px;">
                        <div>
                            <strong>전체 행:</strong> ${result.processedRows}개
                        </div>
                        <div style="color: #28a745;">
                            <strong>성공:</strong> ${result.successRows}개
                        </div>
                        <div style="color: #dc3545;">
                            <strong>실패:</strong> ${result.failedRows}개
                        </div>
                    </div>
                </div>
                
                ${!isSuccess && result.errors && result.errors.length > 0 ? `
                    <div style="margin-top: 20px;">
                        <h4 style="color: #dc3545;">오류 상세 (최대 10개 표시)</h4>
                        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; max-height: 300px; overflow-y: auto;">
                            <ul style="margin: 0; padding-left: 20px;">
                                ${result.errors.map(error => `<li style="margin: 5px 0; color: #856404;">${error}</li>`).join('')}
                            </ul>
                        </div>
                        ${result.failedRows > 10 ? `<p style="color: #6c757d; margin-top: 10px;">... 외 ${result.failedRows - 10}개 오류</p>` : ''}
                    </div>
                ` : ''}
                
                ${isSuccess ? `
                    <div style="text-align: center; margin-top: 20px;">
                        <i class="bi bi-check-circle" style="font-size: 48px; color: #28a745;"></i>
                        <p style="margin-top: 15px; font-size: 18px;">모든 데이터가 성공적으로 처리되었습니다!</p>
                    </div>
                ` : ''}
                
                <div style="text-align: right; margin-top: 30px;">
                    <button onclick="closeResultModal()" style="padding: 10px 30px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">확인</button>
                </div>
            </div>
        </div>
    `;

        // 팝업을 body에 추가
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    }

    // 팝업 닫기 - 전역 함수로 선언
    window.closeResultModal = function () {
        const modal = document.getElementById('resultDetailModal');
        if (modal) {
            modal.remove();
        }
    }

    // 업체별 필터링
    function filterUploadHistory() {
        const supplierFilter = document.getElementById('supplier-filter')?.value;
        // console.log('업체별 필터:', supplierFilter);
        showNotification('업체별 필터가 적용되었습니다.', 'info');
    }

    // 업로드 이력 검색
    function searchUploadHistory() {
        const supplierFilter = document.getElementById('supplier-filter')?.value;
        const dateFrom = document.getElementById('date-from')?.value;
        const dateTo = document.getElementById('date-to')?.value;

        // console.log('업로드 이력 검색:', { supplierFilter, dateFrom, dateTo });
        showNotification('업로드 이력을 조회했습니다.', 'success');
    }

    // 업로드 상세 결과 표시
    function showUploadDetails(uploadId) {
        const detailsSection = document.getElementById('upload-details-section');
        const detailsContent = document.getElementById('upload-details-content');

        if (!detailsSection || !detailsContent) return;

        // 샘플 상세 데이터
        const sampleDetails = {
            1: {
                fileName: 'food_sample_20241210.xls',
                supplier: '웰스토리',
                uploadDate: '2024-12-10',
                totalRows: 150,
                successRows: 148,
                failedRows: 2,
                validationErrors: [
                    { row: 15, column: 'C', field: '고유코드', error: '영문+숫자만 허용됨', value: '한글코드123' },
                    { row: 67, column: 'N', field: '비고', error: 'N열 범위 초과', value: '매우 긴 비고 내용...' }
                ],
                outOfRangeData: [
                    { row: 67, column: 'O', value: '범위초과데이터' },
                    { row: 67, column: 'P', value: '추가데이터' }
                ]
            },
            2: {
                fileName: 'samsung_ingredients.xlsx',
                supplier: '삼성웰스토리',
                uploadDate: '2024-12-08',
                totalRows: 200,
                successRows: 195,
                failedRows: 5,
                validationErrors: [
                    { row: 23, column: 'E', field: '원산지', error: '특수문자 사용불가', value: '한국@#$' },
                    { row: 45, column: 'I', field: '면세', error: '허용값: Full tax, No tax', value: '부가세있음' },
                    { row: 78, column: 'J', field: '선발주일', error: '형식 오류', value: 'D+5일' },
                    { row: 123, column: 'K', field: '입고가', error: '숫자만 입력', value: '천원' },
                    { row: 156, column: 'L', field: '판매가', error: '음수 불가', value: '-1500' }
                ],
                outOfRangeData: []
            }
        };

        const details = sampleDetails[uploadId];
        if (!details) return;

        let detailsHTML = generateUploadDetailsHTML(details);

        detailsContent.innerHTML = detailsHTML;
        detailsSection.style.display = 'block';

        // 상세 결과 섹션으로 스크롤
        detailsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // 업로드 상세 HTML 생성
    function generateUploadDetailsHTML(details) {
        let html = `
        <div style="display: flex; gap: 20px; margin-bottom: 20px;">
            <div style="flex: 1; background: white; padding: 15px; border-radius: 5px; border-left: 4px solid #007bff;">
                <h5 style="margin-top: 0; color: #007bff;">📊 업로드 요약</h5>
                <p><strong>파일명:</strong> ${details.fileName}</p>
                <p><strong>거래처:</strong> ${details.supplier}</p>
                <p><strong>업로드일:</strong> ${details.uploadDate}</p>
                <p><strong>총 항목수:</strong> ${details.totalRows}개</p>
                <p><strong>성공:</strong> <span style="color: #28a745; font-weight: bold;">${details.successRows}개</span></p>
                <p><strong>실패:</strong> <span style="color: #dc3545; font-weight: bold;">${details.failedRows}개</span></p>
            </div>
        </div>
    `;

        if (details.validationErrors.length > 0) {
            html += generateValidationErrorsTable(details.validationErrors);
        }

        if (details.outOfRangeData.length > 0) {
            html += generateOutOfRangeDataTable(details.outOfRangeData);
        }

        return html;
    }

    // 검증 실패 테이블 생성
    function generateValidationErrorsTable(errors) {
        return `
        <div style="margin-bottom: 20px;">
            <h5 style="color: #dc3545;">❌ 검증 실패 항목 (${errors.length}개)</h5>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #f8d7da;">
                            <th style="border: 1px solid #f5c6cb; padding: 8px;">행</th>
                            <th style="border: 1px solid #f5c6cb; padding: 8px;">열</th>
                            <th style="border: 1px solid #f5c6cb; padding: 8px;">필드명</th>
                            <th style="border: 1px solid #f5c6cb; padding: 8px;">오류내용</th>
                            <th style="border: 1px solid #f5c6cb; padding: 8px;">입력값</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${errors.map(error => `
                            <tr>
                                <td style="border: 1px solid #f5c6cb; padding: 8px; text-align: center;">${error.row}</td>
                                <td style="border: 1px solid #f5c6cb; padding: 8px; text-align: center;">${error.column}</td>
                                <td style="border: 1px solid #f5c6cb; padding: 8px;">${error.field}</td>
                                <td style="border: 1px solid #f5c6cb; padding: 8px; color: #721c24;">${error.error}</td>
                                <td style="border: 1px solid #f5c6cb; padding: 8px; font-family: monospace; background: #f8f9fa;">${error.value}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    }

    // 범위 초과 데이터 테이블 생성
    function generateOutOfRangeDataTable(outOfRangeData) {
        return `
        <div style="margin-bottom: 20px;">
            <h5 style="color: #856404;">⚠️ N열 범위 초과 데이터 (${outOfRangeData.length}개)</h5>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #fff3cd;">
                            <th style="border: 1px solid #ffeaa7; padding: 8px;">행</th>
                            <th style="border: 1px solid #ffeaa7; padding: 8px;">열</th>
                            <th style="border: 1px solid #ffeaa7; padding: 8px;">범위초과 데이터</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${outOfRangeData.map(data => `
                            <tr>
                                <td style="border: 1px solid #ffeaa7; padding: 8px; text-align: center;">${data.row}</td>
                                <td style="border: 1px solid #ffeaa7; padding: 8px; text-align: center;">${data.column}</td>
                                <td style="border: 1px solid #ffeaa7; padding: 8px; font-family: monospace; background: #f8f9fa;">${data.value}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    }

    // 알림 메시지 표시
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        padding: 15px 20px; border-radius: 5px; color: white; font-weight: 500;
        ${type === 'success' ? 'background: #28a745;' :
                type === 'error' ? 'background: #dc3545;' : 'background: #007bff;'}
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        transition: opacity 0.3s ease;
    `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // 전역 함수로 내보내기
    window.initializeIngredientsPage = initializeIngredientsPage;
    window.showUploadSection = showUploadSection;
    window.downloadTemplate = downloadTemplate;
    window.showUploadHistory = showUploadHistory;
    window.hideUploadHistory = hideUploadHistory;
    window.filterUploadHistory = filterUploadHistory;
    window.searchUploadHistory = searchUploadHistory;
    window.showUploadDetails = showUploadDetails;
    window.uploadFiles = uploadFiles;
    window.uploadNewFile = uploadFiles; // 템플릿에서 사용하는 함수명
    window.finalUploadFile = uploadFiles; // 템플릿에서 사용하는 또 다른 함수명
    window.handleFileSelect = handleFileSelect;
    window.clearFiles = clearFiles;
    window.clearNewFile = clearFiles; // 템플릿에서 사용하는 함수명
    window.removeFile = removeFile;
    window.processSelectedFiles = processSelectedFiles;
    window.displayBulkUploadResults = displayBulkUploadResults;

    // 이미지 모달 관련 함수 - 전역으로 노출
    window.showImageModal = function () {
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';
        }
    };

    window.hideImageModal = function () {
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    };

    // UI 업데이트 함수들
    function updateFileUI(file) {
        const selectedFileInfo = document.getElementById('selected-file-info');
        const selectedFileName = document.getElementById('selected-file-name');
        const uploadBtn = document.getElementById('newUploadBtn');

        if (file && selectedFileInfo && selectedFileName) {
            selectedFileName.textContent = `📁 ${file.name} (${formatFileSize(file.size)})`;
            selectedFileInfo.style.display = 'block';

            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.style.opacity = '1';
            }
        }
    }

    function clearSelectedFile(event) {
        if (event) event.stopPropagation(); // 부모 요소 클릭 방지

        // 템플릿 호환성: 두 가지 ID 모두 시도
        const fileInput = document.getElementById('excel-file-input') || document.getElementById('finalFileInput');
        const selectedFileInfo = document.getElementById('file-info') || document.getElementById('selected-file-info');
        const uploadBtn = document.getElementById('newUploadBtn');

        if (fileInput) fileInput.value = '';
        if (selectedFileInfo) selectedFileInfo.style.display = 'none';
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.style.opacity = '0.5';
        }
        console.log('[파일 취소] 파일 선택 초기화됨');
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 협력업체별 통계 로드
    async function loadSupplierStats() {
        console.log('📊 협력업체별 통계 로드 시작');
        const container = document.getElementById('supplier-stats-container');

        if (!container) {
            console.warn('supplier-stats-container 요소를 찾을 수 없습니다');
            return;
        }

        try {
            const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/suppliers`);
            const data = await response.json();

            if (data.success && data.suppliers) {
                const suppliers = data.suppliers;

                // 식자재 개수로 정렬 (내림차순)
                suppliers.sort((a, b) => b.ingredient_count - a.ingredient_count);

                // 전체 식자재 개수 계산
                const totalCount = suppliers.reduce((sum, s) => sum + s.ingredient_count, 0);

                // ✅ 상단 통계 박스 업데이트
                const totalIngredientsEl = document.getElementById('total-ingredients');
                const totalSuppliersEl = document.getElementById('total-suppliers-count');
                const totalCategoriesEl = document.getElementById('total-categories');
                const lastUpdateEl = document.getElementById('last-update');

                if (totalIngredientsEl) {
                    totalIngredientsEl.textContent = totalCount.toLocaleString();
                    console.log('✅ 전체 식자재 수 업데이트:', totalCount);
                }

                if (totalSuppliersEl) {
                    totalSuppliersEl.textContent = suppliers.length;
                    console.log('✅ 협력업체 수 업데이트:', suppliers.length);
                }

                if (totalCategoriesEl && data.total_categories) {
                    totalCategoriesEl.textContent = data.total_categories;
                    console.log('✅ 카테고리 수 업데이트:', data.total_categories);
                }

                // 최근 업데이트는 DB에서 실제 날짜 조회
                if (lastUpdateEl && data.last_update) {
                    lastUpdateEl.textContent = data.last_update;
                    console.log('✅ 최근 업데이트 날짜 업데이트 (DB):', data.last_update);
                } else if (lastUpdateEl) {
                    // DB에 날짜가 없으면 오늘 날짜 표시
                    const today = new Date().toISOString().split('T')[0];
                    lastUpdateEl.textContent = today;
                    console.log('✅ 최근 업데이트 날짜 업데이트 (폴백):', today);
                }

                // HTML 생성
                let html = '';
                suppliers.forEach(supplier => {
                    const percentage = ((supplier.ingredient_count / totalCount) * 100).toFixed(1);
                    html += `
                    <div class="supplier-card">
                        <div class="supplier-name">🏢 ${supplier.name}</div>
                        <div class="supplier-count">${supplier.ingredient_count.toLocaleString()}개</div>
                        <div class="supplier-percentage">${percentage}%</div>
                    </div>
                `;
                });

                container.innerHTML = html;
                console.log('✅ 협력업체 통계 로드 완료:', suppliers.length, '개 업체');
            } else {
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">통계 데이터가 없습니다</div>';
            }
        } catch (error) {
            console.error('❌ 협력업체 통계 로드 실패:', error);
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #f44336;">통계 로드 실패</div>';
        }
    }

    // ✅ 개별 식자재 단위당 단가 재계산 함수
    async function recalculateSingleIngredient(ingredientId) {
        console.log(`🔄 개별 재계산 시작: ID ${ingredientId}`);

        try {
            const API_BASE_URL = window.CONFIG?.API?.BASE_URL || window.location.origin;
            const response = await fetch(`${API_BASE_URL}/api/admin/ingredients/${ingredientId}/recalculate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (result.success) {
                console.log('✅ 재계산 성공:', result);

                // 결과 모달 표시
                const debugInfo = result.debug_info;
                const message = `
✅ ${result.ingredient_name} 재계산 완료

📊 계산 정보:
- 규격: ${result.specification}
- 단위: ${result.unit}
- 입고가: ${result.purchase_price.toLocaleString()}원

🔍 계산 과정:
- 패턴: ${debugInfo.matched_pattern || '알 수 없음'}
- 추출값: ${debugInfo.extracted_value || 'N/A'} ${debugInfo.extracted_unit || ''}
- 계산식: ${debugInfo.calculation || 'N/A'}

💰 결과:
- 이전: ${result.old_price_per_unit.toFixed(4)}원/단위
- 새값: ${result.price_per_unit.toFixed(4)}원/단위
            `.trim();

                alert(message);

                // 테이블 새로고침
                if (typeof window.IngredientsModule.loadIngredients === 'function') {
                    await window.IngredientsModule.loadIngredients();
                }

            } else {
                console.error('❌ 재계산 실패:', result.error);
                alert(`재계산 실패:\n${result.error}`);
            }

        } catch (error) {
            console.error('❌ 재계산 오류:', error);
            alert(`재계산 중 오류 발생:\n${error.message}`);
        }
    }

    // 모듈 완료 및 전역 함수 노출
    window.clearSelectedFile = clearSelectedFile;
    window.clearFileSelection = clearSelectedFile; // 템플릿 호환성을 위한 별칭
    window.updateFileUI = updateFileUI;
    window.formatFileSize = formatFileSize;
    window.uploadExcelFile = uploadFiles; // 업로드 함수 노출
    window.loadSupplierStats = loadSupplierStats; // 통계 로드 함수 노출
    window.recalculateSingleIngredient = recalculateSingleIngredient; // 개별 재계산 함수 노출

    // ⚠️ 주의: IngredientsModule은 이미 29번째 줄에서 정의되어 있습니다!
    // 여기서는 추가 함수만 등록합니다 (덮어쓰지 않음!)
    if (window.IngredientsModule) {
        console.log('✅ IngredientsModule에 추가 함수 등록 중...');
        window.IngredientsModule.uploadFiles = uploadFiles;
        window.IngredientsModule.uploadFileToServer = uploadFileToServer;
        window.IngredientsModule.handleFileSelect = handleFileSelect;
        window.IngredientsModule.clearFiles = clearFiles;
        window.IngredientsModule.removeFile = removeFile;
        window.IngredientsModule.setUploadedFiles = setUploadedFiles;
        window.IngredientsModule.initializeIngredientsPage = initializeIngredientsPage;
        window.IngredientsModule.loadSupplierStats = loadSupplierStats;
        window.IngredientsModule.recalculateSingleIngredient = recalculateSingleIngredient;
        console.log('✅ IngredientsModule 추가 함수 등록 완료 - uploadFiles:', typeof uploadFiles);
    } else {
        console.error('❌ IngredientsModule이 먼저 정의되지 않았습니다!');
    }

})();
