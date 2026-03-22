/**
 * 식자재 조회 모듈
 * - 등록된 식자재 조회, 검색, 필터링
 * - 페이지네이션
 * - 통계 정보
 */

window.IngredientsViewModule = {
    currentPage: 1,
    itemsPerPage: 100,
    totalItems: 0,
    totalPages: 0,
    currentFilters: {
        search: '',
        ingredientName: '',
        ingredientCode: '',
        supplierName: '',
        category: '',
        sort: 'name'
    },
    ingredients: [],
    categories: [],
    isAdvancedSearch: true,

    // 모듈 초기화
    async init() {
        console.log('📋 Ingredients View Module 초기화');
        
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 init: 다른 페이지에서 호출됨, 초기화 건너뜀');
            return this;
        }
        
        await this.loadIngredients();
        await this.loadCategories();
        this.setupEventListeners();
        this.updateStats();
        return this;
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        // 고급 검색 입력창들 엔터키 이벤트
        const searchFields = [
            'search-ingredient-name',
            'search-ingredient-code', 
            'search-supplier-name',
            'simple-search-input'
        ];
        
        searchFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.searchIngredients();
                    }
                });
            }
        });
        
        // 분류 선택 변경 이벤트
        const categoryFilter = document.getElementById('search-category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.searchIngredients();
            });
        }
    },

    // 식자재 목록 로드
    async loadIngredients() {
        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.itemsPerPage,
                search: this.currentFilters.search,
                ingredientName: this.currentFilters.ingredientName,
                ingredientCode: this.currentFilters.ingredientCode,
                supplierName: this.currentFilters.supplierName,
                category: this.currentFilters.category,
                sort: this.currentFilters.sort
            });

            const response = await fetch(`/api/admin/ingredients?${params}`);
            const result = await response.json();

            if (result.success) {
                this.ingredients = result.ingredients || result.data || [];
                this.totalItems = result.total || this.ingredients.length;
                this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
                
                console.log(`[IngredientsView] ${this.ingredients.length}개 식자재 로드 완료`);
                
                this.renderIngredients();
                this.renderPagination();
            } else {
                throw new Error(result.message || '식자재 로드 실패');
            }
        } catch (error) {
            console.error('[IngredientsView] 식자재 로드 실패:', error);
            this.renderError('식자재 목록을 불러올 수 없습니다.');
        }
    },

    // 분류 목록 로드
    async loadCategories() {
        try {
            // 실제 식자재에서 분류 추출
            const uniqueCategories = [...new Set(
                this.ingredients.map(item => item['분류(대분류)']).filter(Boolean)
            )];
            
            this.categories = uniqueCategories;
            this.renderCategoryFilter();
            
            console.log('[IngredientsView] 분류 로드 완료:', this.categories);
        } catch (error) {
            console.error('[IngredientsView] 분류 로드 실패:', error);
        }
    },

    // 식자재 목록 렌더링
    renderIngredients() {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 renderIngredients: 다른 페이지에서 호출됨, 렌더링 건너뜀');
            return;
        }
        
        const tbody = document.getElementById('ingredients-view-tbody');
        if (!tbody) {
            console.error('[IngredientsView] ingredients-view-tbody 요소를 찾을 수 없음');
            return;
        }

        tbody.innerHTML = '';

        if (!this.ingredients || this.ingredients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; color: #666; padding: 40px;">검색된 식자재가 없습니다.</td></tr>';
            return;
        }

        this.ingredients.forEach((ingredient, index) => {
            const rowNumber = (this.currentPage - 1) * this.itemsPerPage + index + 1;
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.onclick = () => this.showIngredientModal(ingredient);
            row.innerHTML = `
                <td style="font-weight: bold; color: #007bff;">${rowNumber}</td>
                <td>${ingredient['분류(대분류)'] || '-'}</td>
                <td>${ingredient['기본식자재(세분류)'] || '-'}</td>
                <td>${ingredient['고유코드'] || '-'}</td>
                <td>${ingredient['식자재명'] || '-'}</td>
                <td>${ingredient['게시유무'] || '-'}</td>
                <td>${ingredient['원산지'] || '-'}</td>
                <td>${ingredient['규격'] || '-'}</td>
                <td>${ingredient['단위'] || '-'}</td>
                <td>${ingredient['면세'] || '-'}</td>
                <td>${ingredient['선발주일'] || '-'}</td>
                <td>${ingredient['입고가'] ? ingredient['입고가'].toLocaleString() + '원' : '-'}</td>
                <td>${ingredient['판매가'] ? ingredient['판매가'].toLocaleString() + '원' : '-'}</td>
                <td>${ingredient['거래처명'] || '-'}</td>
                <td>${ingredient['비고'] || '-'}</td>
                <td>${ingredient['등록일'] ? new Date(ingredient['등록일']).toLocaleDateString() : '-'}</td>
            `;
            tbody.appendChild(row);
        });
    },

    // 오류 렌더링
    renderError(message) {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 renderError: 다른 페이지에서 호출됨, 에러 렌더링 건너뜀');
            return;
        }
        
        const tbody = document.getElementById('ingredients-view-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: #dc3545; padding: 40px;">${message}</td></tr>`;
        }
    },

    // 페이지네이션 렌더링
    renderPagination() {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 renderPagination: 다른 페이지에서 호출됨, 페이지네이션 건너뜀');
            return;
        }
        
        const pageInfo = document.getElementById('ingredients-page-info');
        const prevBtn = document.getElementById('ingredients-prev-page');
        const nextBtn = document.getElementById('ingredients-next-page');

        if (pageInfo) {
            pageInfo.textContent = `${this.currentPage} / ${this.totalPages} 페이지`;
        }

        if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
        }

        if (nextBtn) {
            nextBtn.disabled = this.currentPage >= this.totalPages;
        }
    },

    // 분류 필터 렌더링
    renderCategoryFilter() {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 renderCategoryFilter: 다른 페이지에서 호출됨, 필터 건너뜀');
            return;
        }
        
        const categoryFilter = document.getElementById('search-category-filter');
        if (!categoryFilter) return;

        categoryFilter.innerHTML = '<option value="">전체 분류</option>';
        
        this.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            if (category === this.currentFilters.category) {
                option.selected = true;
            }
            categoryFilter.appendChild(option);
        });
    },

    // 검색 모드 토글
    toggleSearchMode() {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 toggleSearchMode: 다른 페이지에서 호출됨, 토글 건너뜀');
            return;
        }
        
        this.isAdvancedSearch = !this.isAdvancedSearch;
        
        const advancedFields = document.getElementById('advanced-search-fields');
        const simpleField = document.getElementById('simple-search-field');
        const toggleBtn = document.getElementById('toggle-search-mode');
        
        if (this.isAdvancedSearch) {
            // 고급 검색 모드
            advancedFields.style.display = 'grid';
            simpleField.style.display = 'none';
            toggleBtn.textContent = '간단 검색';
        } else {
            // 간단 검색 모드
            advancedFields.style.display = 'none';
            simpleField.style.display = 'block';
            toggleBtn.textContent = '고급 검색';
        }
        
        console.log(`[IngredientsView] 검색 모드 변경: ${this.isAdvancedSearch ? '고급' : '간단'}`);
    },

    // 통계 업데이트
    updateStats() {
        // 현재 페이지가 ingredients-view인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-view-page') {
            console.log('📋 updateStats: 다른 페이지에서 호출됨, 통계 업데이트 건너뜀');
            return;
        }
        
        const statsElement = document.getElementById('ingredients-search-stats');
        if (statsElement) {
            const totalText = this.totalItems > 0 ? 
                `검색결과 ${this.totalItems.toLocaleString()}개` : 
                `전체 ${this.ingredients.length.toLocaleString()}개`;
            statsElement.textContent = totalText + ' 식자재';
            
            // 통계가 업데이트될 때만 표시
            statsElement.style.display = 'block';
        }
    },

    // 검색 실행
    searchIngredients() {
        if (this.isAdvancedSearch) {
            // 고급 검색 모드
            this.currentFilters.ingredientName = document.getElementById('search-ingredient-name')?.value.trim() || '';
            this.currentFilters.ingredientCode = document.getElementById('search-ingredient-code')?.value.trim() || '';
            this.currentFilters.supplierName = document.getElementById('search-supplier-name')?.value.trim() || '';
            this.currentFilters.category = document.getElementById('search-category-filter')?.value || '';
            this.currentFilters.search = ''; // 고급 검색 시 통합 검색 비활성화
        } else {
            // 간단 검색 모드
            this.currentFilters.search = document.getElementById('simple-search-input')?.value.trim() || '';
            this.currentFilters.ingredientName = '';
            this.currentFilters.ingredientCode = '';
            this.currentFilters.supplierName = '';
            this.currentFilters.category = '';
        }
        
        this.currentPage = 1; // 검색 시 첫 페이지로
        this.loadIngredients();
        
        console.log('[IngredientsView] 검색 실행:', this.currentFilters);
    },

    // 검색 초기화
    clearSearch() {
        // 모든 검색 필드 초기화
        const searchFields = [
            'search-ingredient-name',
            'search-ingredient-code',
            'search-supplier-name',
            'simple-search-input'
        ];
        
        searchFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) field.value = '';
        });
        
        const categoryFilter = document.getElementById('search-category-filter');
        if (categoryFilter) categoryFilter.value = '';
        
        // 필터 초기화
        this.currentFilters = {
            search: '',
            ingredientName: '',
            ingredientCode: '',
            supplierName: '',
            category: '',
            sort: 'name'
        };
        
        this.currentPage = 1;
        this.loadIngredients();
        
        console.log('[IngredientsView] 검색 초기화');
    },


    // 정렬
    sortIngredients() {
        const sortSelect = document.getElementById('sort-options');
        if (sortSelect) {
            this.currentFilters.sort = sortSelect.value;
        }
        
        this.loadIngredients();
    },

    // 페이지 변경
    changePage(direction) {
        const newPage = this.currentPage + direction;
        
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.loadIngredients();
        }
    },

    // Excel 내보내기
    exportToExcel() {
        try {
            if (!this.ingredients || this.ingredients.length === 0) {
                alert('내보낼 데이터가 없습니다.');
                return;
            }

            // CSV 형식으로 데이터 생성
            const headers = [
                '분류(대분류)', '기본식자재(세분류)', '고유코드', '식자재명', 
                '게시유무', '원산지', '규격', '단위', '면세', '선발주일', 
                '입고가', '판매가', '거래처명', '비고', '등록일'
            ];
            
            let csvContent = headers.join(',') + '\n';
            
            this.ingredients.forEach(ingredient => {
                const row = [
                    ingredient['분류(대분류)'] || '',
                    ingredient['기본식자재(세분류)'] || '',
                    ingredient['고유코드'] || '',
                    ingredient['식자재명'] || '',
                    ingredient['게시유무'] || '',
                    ingredient['원산지'] || '',
                    ingredient['규격'] || '',
                    ingredient['단위'] || '',
                    ingredient['면세'] || '',
                    ingredient['선발주일'] || '',
                    ingredient['입고가'] || 0,
                    ingredient['판매가'] || 0,
                    ingredient['거래처명'] || '',
                    ingredient['비고'] || '',
                    ingredient['등록일'] ? new Date(ingredient['등록일']).toLocaleDateString() : ''
                ].map(cell => `"${cell}"`);
                
                csvContent += row.join(',') + '\n';
            });
            
            // 파일 다운로드
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `식자재목록_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            console.log('[IngredientsView] Excel 내보내기 완료');
        } catch (error) {
            console.error('[IngredientsView] Excel 내보내기 실패:', error);
            alert('Excel 내보내기에 실패했습니다.');
        }
    },

    // 목록 인쇄
    printList() {
        try {
            if (!this.ingredients || this.ingredients.length === 0) {
                alert('인쇄할 데이터가 없습니다.');
                return;
            }

            // 인쇄용 HTML 생성
            let printHtml = `
                <html>
                <head>
                    <title>식자재 목록</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        h1 { text-align: center; color: #333; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                        th { background-color: #f8f9fa; font-weight: bold; }
                        .print-info { text-align: right; margin-bottom: 20px; font-size: 12px; color: #666; }
                    </style>
                </head>
                <body>
                    <h1>식자재 목록</h1>
                    <div class="print-info">인쇄일: ${new Date().toLocaleDateString()} | 총 ${this.ingredients.length}개</div>
                    <table>
                        <thead>
                            <tr>
                                <th>분류(대분류)</th><th>기본식자재(세분류)</th><th>고유코드</th><th>식자재명</th>
                                <th>게시유무</th><th>원산지</th><th>규격</th><th>단위</th><th>면세</th>
                                <th>선발주일</th><th>입고가</th><th>판매가</th><th>거래처명</th><th>비고</th><th>등록일</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            this.ingredients.forEach(ingredient => {
                printHtml += `
                    <tr>
                        <td>${ingredient['분류(대분류)'] || '-'}</td>
                        <td>${ingredient['기본식자재(세분류)'] || '-'}</td>
                        <td>${ingredient['고유코드'] || '-'}</td>
                        <td>${ingredient['식자재명'] || '-'}</td>
                        <td>${ingredient['게시유무'] || '-'}</td>
                        <td>${ingredient['원산지'] || '-'}</td>
                        <td>${ingredient['규격'] || '-'}</td>
                        <td>${ingredient['단위'] || '-'}</td>
                        <td>${ingredient['면세'] || '-'}</td>
                        <td>${ingredient['선발주일'] || '-'}</td>
                        <td>${ingredient['입고가'] ? ingredient['입고가'].toLocaleString() + '원' : '-'}</td>
                        <td>${ingredient['판매가'] ? ingredient['판매가'].toLocaleString() + '원' : '-'}</td>
                        <td>${ingredient['거래처명'] || '-'}</td>
                        <td>${ingredient['비고'] || '-'}</td>
                        <td>${ingredient['등록일'] ? new Date(ingredient['등록일']).toLocaleDateString() : '-'}</td>
                    </tr>
                `;
            });

            printHtml += `
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            // 새 창에서 인쇄
            const printWindow = window.open('', '_blank');
            printWindow.document.open();
            printWindow.document.write(printHtml);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
            
            console.log('[IngredientsView] 목록 인쇄 실행');
        } catch (error) {
            console.error('[IngredientsView] 목록 인쇄 실패:', error);
            alert('목록 인쇄에 실패했습니다.');
        }
    },

    // 식자재 상세 모달 표시 (식자재 등록과 동일한 기능)
    showIngredientModal(ingredient) {
        // IngredientsModule의 showIngredientModal 기능을 재사용
        if (window.IngredientsModule && window.IngredientsModule.showIngredientModal) {
            window.IngredientsModule.showIngredientModal(ingredient);
        } else {
            alert('모달 기능을 불러올 수 없습니다. 식자재 등록 모듈이 로드되지 않았습니다.');
        }
    }
};

console.log('📋 Ingredients View Module 정의 완료');