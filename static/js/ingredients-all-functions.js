// 식자재 관리 - 모든 함수들
// 이 파일은 ingredients_management.html에서 분리된 모든 JavaScript 함수를 포함합니다


// 정렬 핸들러 설정 함수
function setupSortHandlers() {
    const sortableHeaders = document.querySelectorAll('.sortable');
    sortableHeaders.forEach(header => {
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';

        header.addEventListener('click', function() {
            const sortField = this.dataset.sort;

            // 같은 컬럼 클릭시 방향 전환
            if (currentSort === sortField) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = sortField;
                sortDirection = 'asc';
            }

            // 모든 정렬 아이콘을 비활성 상태로
            document.querySelectorAll('.sort-icon').forEach(icon => {
                icon.classList.remove('active');
                icon.classList.add('inactive');
                icon.textContent = '⬍';
            });

            // 현재 정렬 아이콘을 활성 상태로
            const currentIcon = document.getElementById(`sort-${sortField}`);
            if (currentIcon) {
                currentIcon.classList.remove('inactive');
                currentIcon.classList.add('active');
                currentIcon.textContent = sortDirection === 'asc' ? '▲' : '▼';
            }

            // 정렬 적용
            sortIngredients();
            displayPage();
        });
    });
}

// 페이지 표시 함수
function displayPage() {
    document.getElementById('loadingDiv').style.display = 'none';
    document.getElementById('ingredientsTable').style.display = 'table';
    document.querySelector('.table-container').style.display = 'block';

    // 로드된 데이터 개수 업데이트
    document.getElementById('loadedDataCount').textContent = allIngredients.length.toLocaleString();

    const tbody = document.getElementById('ingredientsTableBody');
    tbody.innerHTML = '';

    // 검색 중일 때는 필터링된 데이터 사용
    const dataToDisplay = isSearching ? filteredIngredients : allIngredients;
    const totalToDisplay = isSearching ? filteredIngredients.length : totalItems;

    if (dataToDisplay.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px; color: #666;">등록된 식자재가 없습니다.</td></tr>';
        updatePaginationControls();
        return;
    }

    // 현재 페이지의 데이터 계산
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalToDisplay);
    const pageIngredients = dataToDisplay.slice(startIndex, endIndex);

    pageIngredients.forEach(ingredient => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.onclick = (event) => {
            const clickedElement = event.target;
            const isUnitPriceClick = clickedElement.closest('td:nth-child(11)') ||
                                   clickedElement.id?.startsWith('price-') ||
                                   clickedElement.className?.includes('price-per-unit') ||
                                   clickedElement.tagName === 'SPAN' && clickedElement.onclick?.toString().includes('openRecalculationModal');

            // 단위당 단가 클릭 시 - 재계산 모달만 열기
            if (isUnitPriceClick) {
                console.log('단위당 단가 클릭 - 재계산 모달 열기:', ingredient);
                event.stopPropagation(); // 이벤트 버블링 방지
                return; // 식자재 수정 모달은 열지 않음
            } else {
                // 다른 컬럼 클릭 시에는 식자재 수정 모달 열기
                console.log('Clicked ingredient full object:', ingredient);
                console.log('ID field:', ingredient.ID, ingredient.id, ingredient['ID'], ingredient['id']);
                openIngredientModal(ingredient);
            }
        };

        // 텍스트 줄이기 함수
        const truncateText = (text, maxLength = 12) => {
            if (!text) return '';
            const str = String(text);
            return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
        };

        // 한글 필드명 사용 및 데이터 정리
        const category = ingredient['분류(대분류)'] || ingredient['category'] || '';
        const subCategory = ingredient['기본식자재(세분류)'] || ingredient['sub_category'] || '';
        const code = ingredient['고유코드'] || ingredient['ingredient_code'] || '';
        const name = ingredient['식자재명'] || ingredient['ingredient_name'] || '';
        const origin = ingredient['원산지'] || ingredient['origin'] || '';
        const isPublished = ingredient['게시유무'] || ingredient['posting_status'] || '';
        const specification = ingredient['규격'] || ingredient['specification'] || '';
        const unit = ingredient['단위'] || ingredient['unit'] || '';
        const taxExempt = ingredient['면세'] || ingredient['tax_type'] || '';
        const procurementDays = ingredient['선발주일'] || ingredient['delivery_days'] || '';
        const pricePerUnit = ingredient['g당단가'] || ingredient['단위당 단가'] || ingredient['price_per_unit'] || '';
        const purchasePrice = ingredient['입고가'] || ingredient['purchase_price'] || '';
        const salePrice = ingredient['판매가'] || ingredient['selling_price'] || '';

        // 디버깅용 로그 (첫 번째 아이템만)
        if (pageIngredients.indexOf(ingredient) === 0) {
            console.log('첫 번째 식자재 단위당 단가 데이터 확인:', {
                ingredient: ingredient,
                pricePerUnit: pricePerUnit,
                'g당단가': ingredient['g당단가'],
                '단위당 단가': ingredient['단위당 단가'],
                'price_per_unit': ingredient['price_per_unit']
            });
        }

        // 숫자 포맷팅 함수 (미계산 표시 포함)
        const formatPricePerUnit = (value) => {
            if (!value || value === '' || value === '-' || value === null || value === undefined || value === 0) {
                return '<span style="color: #dc3545; font-style: italic; cursor: pointer;" onclick="event.stopPropagation(); openRecalculationModal(\'' +
                       (ingredient.ID || ingredient.id) + '\')" title="클릭하여 재계산">미계산</span>';
            }
            const num = parseFloat(value);
            if (isNaN(num) || num === 0) {
                return '<span style="color: #dc3545; font-style: italic; cursor: pointer;" onclick="event.stopPropagation(); openRecalculationModal(\'' +
                       (ingredient.ID || ingredient.id) + '\')" title="클릭하여 재계산">미계산</span>';
            }
            return `<span style="color: #28a745; font-weight: 600; cursor: pointer;" onclick="event.stopPropagation(); openRecalculationModal('${ingredient.ID || ingredient.id}')" title="클릭하여 재계산">${num.toFixed(1)}</span>`;
        };

        const formatSalePrice = (value) => {
            if (!value || value === '' || value === '-') return '';
            const num = parseFloat(value);
            return isNaN(num) ? value : Math.round(num).toString();
        };
        const supplier = ingredient['거래처명'] || ingredient['협력업체명'] || ingredient['supplier_name'] || '';
        const note = ingredient['비고'] || ingredient['notes'] || '';
        const registrationDate = ingredient['등록일'] || ingredient['생성일'] || ingredient['created_at'] || '';

        // ID 필드 추출 (다양한 형태 지원)
        const ingredientId = ingredient.ID || ingredient.id || ingredient['ID'] || ingredient['id'] || '';

        // 데이터 행에 ID 저장
        row.dataset.id = ingredientId;

        row.innerHTML = `
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${category}">${truncateText(category, 10)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${subCategory}">${truncateText(subCategory, 10)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${code}">${truncateText(code, 8)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px; position: relative;" title="${name}">
                <span class="ingredient-name-display" data-full-name="${name}">${truncateText(name, 15)}</span>
            </td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${origin}">${truncateText(origin, 8)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px; color: ${isPublished === 'Y' ? '#28a745' : '#dc3545'};">${isPublished}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${specification}">${truncateText(specification, 10)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${unit}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${taxExempt}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${procurementDays}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px; font-weight: bold; color: #2c5aa0; cursor: pointer;"
                id="price-${ingredientId}"
                class="price-per-unit clickable-price"
                title="클릭하여 상세 정보 확인">${formatPricePerUnit(pricePerUnit)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${purchasePrice}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${formatSalePrice(salePrice)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${supplier}">${truncateText(supplier, 10)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;" title="${note}">${truncateText(note, 8)}</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${registrationDate}</td>
        `;

        tbody.appendChild(row);
    });

    updatePaginationControls();
}

// 페이지네이션 컨트롤 업데이트 함수
function updatePaginationControls() {
    const dataToDisplay = isSearching ? filteredIngredients : allIngredients;
    const totalToDisplay = dataToDisplay.length;
    const totalPages = Math.ceil(totalToDisplay / itemsPerPage);

    // 페이지 정보 업데이트
    const startItem = totalToDisplay === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalToDisplay);

    document.getElementById('pageInfo').textContent =
        `${startItem.toLocaleString()} - ${endItem.toLocaleString()} / ${totalToDisplay.toLocaleString()}개`;

    // 이전/다음 버튼 상태 업데이트
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;

    // 현재 페이지 번호 입력 필드 업데이트
    document.getElementById('currentPageInput').value = currentPage;
    document.getElementById('currentPageInput').max = totalPages;

    // 총 페이지 수 표시
    document.getElementById('totalPagesSpan').textContent = totalPages;
}

// 다음 페이지로 이동
function nextPage() {
    const dataToDisplay = isSearching ? filteredIngredients : allIngredients;
    const totalPages = Math.ceil(dataToDisplay.length / itemsPerPage);

    if (currentPage < totalPages) {
        currentPage++;
        displayPage();
    }
}

// 이전 페이지로 이동
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        displayPage();
    }
}

// 특정 페이지로 이동
function goToPage() {
    const input = document.getElementById('currentPageInput');
    const pageNum = parseInt(input.value);
    const dataToDisplay = isSearching ? filteredIngredients : allIngredients;
    const totalPages = Math.ceil(dataToDisplay.length / itemsPerPage);

    if (pageNum >= 1 && pageNum <= totalPages) {
        currentPage = pageNum;
        displayPage();
    } else {
        input.value = currentPage; // 유효하지 않은 경우 현재 페이지로 되돌림
    }
}

// 더 많은 데이터 로드 함수
function loadMoreData() {
    isLoadingMore = true;
    const currentLoadedCount = allIngredients.length;

    // 버튼 상태 변경
    const loadMoreBtn = document.querySelector('button[onclick="loadMoreData()"]');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 로딩 중...';
    }

    // 다음 페이지 계산 (1000개씩 로드했으므로)
    const nextPage = Math.floor(currentLoadedCount / 1000) + 2;

    loadIngredients(nextPage, true).then(() => {
        isLoadingMore = false;
        console.log(`추가 데이터 로드 완료: ${allIngredients.length}개`);

        // 버튼 상태 복원
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = '<i class="fas fa-plus"></i> 더 많은 데이터 로드';
        }
    });
}

// 자동으로 더 많은 데이터 로드
function loadMoreDataAutomatically(pageNum) {
    if (allIngredients.length >= totalDataCount) {
        console.log('모든 데이터 로드 완료');
        return;
    }

    loadIngredients(pageNum, true);
}

// 정렬 함수
function sortIngredients() {
    if (!currentSort) return;

    const dataToSort = isSearching ? filteredIngredients : allIngredients;

    dataToSort.sort((a, b) => {
        let aValue = a[currentSort] || a[getKoreanFieldName(currentSort)] || '';
        let bValue = b[currentSort] || b[getKoreanFieldName(currentSort)] || '';

        // 숫자 필드 처리
        if (currentSort === 'price_per_unit' || currentSort === 'purchase_price' || currentSort === 'selling_price') {
            aValue = parseFloat(aValue) || 0;
            bValue = parseFloat(bValue) || 0;
        } else {
            // 문자열 필드 처리
            aValue = String(aValue).toLowerCase();
            bValue = String(bValue).toLowerCase();
        }

        if (sortDirection === 'asc') {
            return aValue > bValue ? 1 : -1;
        } else {
            return aValue < bValue ? 1 : -1;
        }
    });

    // 정렬 후 첫 페이지로 이동
    currentPage = 1;
}

// 한글 필드명 매핑 함수
function getKoreanFieldName(englishField) {
    const fieldMap = {
        'price_per_unit': 'g당단가',
        'purchase_price': '입고가',
        'selling_price': '판매가',
        'ingredient_name': '식자재명',
        'supplier_name': '거래처명',
        'category': '분류(대분류)',
        'sub_category': '기본식자재(세분류)',
        'ingredient_code': '고유코드',
        'origin': '원산지',
        'posting_status': '게시유무',
        'specification': '규격',
        'unit': '단위',
        'tax_type': '면세',
        'delivery_days': '선발주일',
        'notes': '비고',
        'created_at': '등록일'
    };
    return fieldMap[englishField] || englishField;
}

// 식자재 검색 함수
async function searchIngredients() {
    const supplierName = document.getElementById('searchSupplier').value.trim();
    const ingredientName = document.getElementById('searchName').value.trim();
    const ingredientCode = document.getElementById('searchCode').value.trim();

    // 검색어가 모두 비어있으면 전체 데이터 표시
    if (!supplierName && !ingredientName && !ingredientCode) {
        isSearching = false;
        filteredIngredients = [];
        currentPage = 1;
        displayPage();
        document.getElementById('searchResultsInfo').style.display = 'none';
        return;
    }

    try {
        document.getElementById('loadingDiv').innerHTML = '<i class="fas fa-spinner fa-spin"></i> 검색 중...';
        document.getElementById('loadingDiv').style.display = 'block';

        // 필터링 파라미터 가져오기
        const excludeUnpublished = document.getElementById('excludeUnpublished')?.checked ?? false;
        const excludeNoPrice = document.getElementById('excludeNoPrice')?.checked ?? false;

        // 검색 파라미터 구성
        const searchParams = new URLSearchParams({
            page: 1,
            per_page: 150000, // 검색시에는 전체 DB 대상으로 검색
            exclude_unpublished: excludeUnpublished,
            exclude_no_price: excludeNoPrice
        });

        if (supplierName) searchParams.append('supplier_name', supplierName);
        if (ingredientName) searchParams.append('ingredient_name', ingredientName);
        if (ingredientCode) searchParams.append('ingredient_code', ingredientCode);

        const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-new?${searchParams}`);
        const data = await response.json();

        if (data.success) {
            // 검색 결과를 한글 필드명으로 매핑
            const searchResults = (data.data.ingredients || []).map(item => ({
                'ID': item.id,
                'id': item.id,
                '분류(대분류)': item.category,
                '기본식자재(세분류)': item.sub_category,
                '고유코드': item.ingredient_code,
                '식자재명': item.ingredient_name,
                '원산지': item.origin,
                '게시유무': item.posting_status,
                '규격': item.specification,
                '단위': item.unit,
                '면세': item.tax_type,
                '선발주일': item.delivery_days,
                'g당단가': item.price_per_unit,
                '입고가': item.purchase_price,
                '판매가': item.selling_price,
                '거래처명': item.supplier_name,
                '비고': item.notes,
                '등록일': formatDate(item.created_at),
                '협력업체명': item.supplier_name,
                '단위당 단가': item.price_per_unit,
                '게시여부': item.posting_status,
                '과/면세': item.tax_type,
                '사용유무': item.is_active,
                '생성일': formatDate(item.created_date),
                '생성자': item.created_by,
                '수정일': formatDate(item.updated_at),
                _original: item
            }));

            // 검색 결과를 단위당 단가 기준으로 낮은 가격 순 정렬
            searchResults.sort((a, b) => {
                const priceA = parseFloat(a['단위당 단가']) || 0;
                const priceB = parseFloat(b['단위당 단가']) || 0;

                // 0인 값들(미계산)은 뒤로 보내기
                if (priceA === 0 && priceB === 0) return 0;
                if (priceA === 0) return 1;
                if (priceB === 0) return -1;

                return priceA - priceB; // 저단가 순
            });

            isSearching = true;
            filteredIngredients = searchResults;
            currentPage = 1;

            // 검색 결과 정보 표시
            const resultCount = searchResults.length;
            document.getElementById('searchResultsInfo').innerHTML =
                `<i class="fas fa-search"></i> 검색 결과: <strong>${resultCount.toLocaleString()}개</strong> 발견`;
            document.getElementById('searchResultsInfo').style.display = 'block';

            console.log(`검색 완료: ${resultCount}개 결과`);

        } else {
            isSearching = true;
            filteredIngredients = [];
            document.getElementById('searchResultsInfo').innerHTML =
                `<i class="fas fa-exclamation-triangle"></i> 검색 결과가 없습니다.`;
            document.getElementById('searchResultsInfo').style.display = 'block';
        }

        displayPage();

    } catch (error) {
        console.error('검색 오류:', error);
        document.getElementById('searchResultsInfo').innerHTML =
            `<i class="fas fa-exclamation-triangle"></i> 검색 중 오류가 발생했습니다.`;
        document.getElementById('searchResultsInfo').style.display = 'block';
    } finally {
        document.getElementById('loadingDiv').style.display = 'none';
    }
}

// 검색 초기화 함수
function resetSearch() {
    document.getElementById('searchSupplier').value = '';
    document.getElementById('searchName').value = '';
    document.getElementById('searchCode').value = '';

    isSearching = false;
    filteredIngredients = [];
    currentPage = 1;

    document.getElementById('searchResultsInfo').style.display = 'none';
    displayPage();
}

// 필터 적용 함수
function applyFilters() {
    // 현재는 단순히 displayPage를 호출하여 데이터 새로고침
    displayPage();
}

// 업체별 통계 그리드 업데이트 함수
function updateSuppliersGrid(supplierStats) {
    const container = document.getElementById('suppliersGrid');
    if (!container || !supplierStats) return;

    container.innerHTML = '';

    // 통계 데이터를 배열로 변환하고 정렬
    const suppliers = Object.entries(supplierStats)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12); // 상위 12개만 표시

    suppliers.forEach(supplier => {
        const box = document.createElement('div');
        box.className = 'supplier-stat-box';
        box.innerHTML = `
            <div class="supplier-name">${supplier.name}</div>
            <div class="supplier-count">${supplier.count.toLocaleString()}개</div>
        `;
        container.appendChild(box);
    });
}

// 식자재 모달 열기 함수
function openIngredientModal(ingredient) {
    if (!ingredient) {
        console.error('식자재 데이터가 없습니다.');
        return;
    }

    // 원본 데이터 추출
    const originalData = ingredient._original || ingredient;

    // ID 확인 및 로깅
    const ingredientId = originalData.id || ingredient.ID || ingredient.id || '';
    console.log('모달 열기 - 식자재 ID:', ingredientId);
    console.log('모달 열기 - 전체 데이터:', originalData);

    // 모달 필드에 데이터 채우기
    document.getElementById('ingredientId').value = ingredientId;
    document.getElementById('ingredientCategory').value = originalData.category || '';
    document.getElementById('ingredientSubcategory').value = originalData.sub_category || '';
    document.getElementById('ingredientCode').value = originalData.ingredient_code || '';
    document.getElementById('ingredientName').value = originalData.ingredient_name || '';
    document.getElementById('ingredientOrigin').value = originalData.origin || '';
    document.getElementById('ingredientCalculation').value = originalData.posting_status || '';
    document.getElementById('ingredientSpecification').value = originalData.specification || '';
    document.getElementById('ingredientUnit').value = originalData.unit || '';
    document.getElementById('ingredientTaxFree').value = originalData.tax_type || '';
    document.getElementById('ingredientUnitPrice').value = originalData.price_per_unit || '';
    document.getElementById('ingredientPurchasePrice').value = originalData.purchase_price || '';
    document.getElementById('ingredientPrice').value = originalData.selling_price || '';
    document.getElementById('ingredientSupplier').value = originalData.supplier_name || '';
    document.getElementById('ingredientSelectiveOrder').value = originalData.delivery_days || '';
    document.getElementById('ingredientMemo').value = originalData.notes || '';

    // 자동 계산 기능 활성화
    const purchasePrice = parseFloat(originalData.purchase_price) || 0;
    const autoCalcSection = document.getElementById('autoCalculationHelper');
    if (autoCalcSection && purchasePrice > 0) {
        autoCalcSection.style.display = 'block';

        // 자동 계산 시도
        const result = calculateUnitPrice(originalData.specification || '', originalData.unit || '', purchasePrice);
        if (result.success) {
            document.getElementById('autoCalculatedValue').textContent = result.price.toFixed(1) + '원';
            document.getElementById('calculationMethod').textContent = result.method;
            document.getElementById('applyAutoCalculation').style.display = 'inline-block';

            // 자동 계산 적용 버튼 이벤트
            document.getElementById('applyAutoCalculation').onclick = function() {
                document.getElementById('ingredientUnitPrice').value = result.price.toFixed(1);
                showToast('자동 계산 값이 적용되었습니다.');
            };
        }
    } else if (autoCalcSection) {
        autoCalcSection.style.display = 'none';
    }

    // 실시간 자동 계산 이벤트 리스너 추가
    setupAutoCalculationListeners();

    // 모달 표시
    document.getElementById('ingredientModal').style.display = 'block';
}

// 자동 계산 이벤트 리스너 설정 함수
function setupAutoCalculationListeners() {
    const purchasePriceInput = document.getElementById('ingredientPurchasePrice');
    const specificationInput = document.getElementById('ingredientSpecification');
    const unitInput = document.getElementById('ingredientUnit');
    const autoCalcHelper = document.getElementById('autoCalculationHelper');

    async function updateAutoCalculation() {
        const purchasePrice = parseFloat(purchasePriceInput.value) || 0;
        const specification = specificationInput.value;
        const unit = unitInput.value;

        if (purchasePrice > 0 && specification && unit) {
            try {
                // API 호출하여 고급 계산 시도
                const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/calculate-unit-price', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        specification: specification,
                        unit: unit,
                        purchase_price: purchasePrice
                    })
                });

                const apiResult = await response.json();

                if (apiResult.success && apiResult.unit_price !== null && autoCalcHelper) {
                    // API 계산 성공
                    autoCalcHelper.style.display = 'block';
                    document.getElementById('autoCalculatedValue').textContent = apiResult.unit_price.toFixed(1) + '원';
                    document.getElementById('calculationMethod').textContent = `🤖 AI 학습 기반 (${apiResult.method || '고급 패턴 매칭'})`;
                    document.getElementById('applyAutoCalculation').style.display = 'inline-block';

                    // 자동 계산 적용 버튼 이벤트 재설정
                    document.getElementById('applyAutoCalculation').onclick = function() {
                        document.getElementById('ingredientUnitPrice').value = apiResult.unit_price.toFixed(1);
                        showToast('🤖 AI 계산 값이 적용되었습니다.');
                    };
                } else {
                    // API 실패시 로컬 계산 시도
                    const localResult = calculateUnitPrice(specification, unit, purchasePrice);

                    if (localResult.success && autoCalcHelper) {
                        autoCalcHelper.style.display = 'block';
                        document.getElementById('autoCalculatedValue').textContent = localResult.price.toFixed(1) + '원';
                        document.getElementById('calculationMethod').textContent = localResult.method;
                        document.getElementById('applyAutoCalculation').style.display = 'inline-block';

                        // 자동 계산 적용 버튼 이벤트 재설정
                        document.getElementById('applyAutoCalculation').onclick = function() {
                            document.getElementById('ingredientUnitPrice').value = localResult.price.toFixed(1);
                            showToast('자동 계산 값이 적용되었습니다.');
                        };
                    } else if (autoCalcHelper) {
                        autoCalcHelper.style.display = 'none';
                    }
                }
            } catch (error) {
                console.log('API 계산 실패, 로컬 계산 사용:', error);
                // API 오류시 로컬 계산 사용
                const localResult = calculateUnitPrice(specification, unit, purchasePrice);

                if (localResult.success && autoCalcHelper) {
                    autoCalcHelper.style.display = 'block';
                    document.getElementById('autoCalculatedValue').textContent = localResult.price.toFixed(1) + '원';
                    document.getElementById('calculationMethod').textContent = localResult.method;
                    document.getElementById('applyAutoCalculation').style.display = 'inline-block';

                    // 자동 계산 적용 버튼 이벤트 재설정
                    document.getElementById('applyAutoCalculation').onclick = function() {
                        document.getElementById('ingredientUnitPrice').value = localResult.price.toFixed(1);
                        showToast('자동 계산 값이 적용되었습니다.');
                    };
                } else if (autoCalcHelper) {
                    autoCalcHelper.style.display = 'none';
                }
            }
        } else if (autoCalcHelper) {
            autoCalcHelper.style.display = 'none';
        }
    }

    // 이벤트 리스너 추가 (기존 리스너 제거 후 추가)
    if (purchasePriceInput) {
        purchasePriceInput.removeEventListener('input', updateAutoCalculation);
        purchasePriceInput.addEventListener('input', updateAutoCalculation);
    }
    if (specificationInput) {
        specificationInput.removeEventListener('input', updateAutoCalculation);
        specificationInput.addEventListener('input', updateAutoCalculation);
    }
    if (unitInput) {
        unitInput.removeEventListener('input', updateAutoCalculation);
        unitInput.addEventListener('input', updateAutoCalculation);
    }
}

// 식자재 모달 닫기 함수
function closeIngredientModal() {
    document.getElementById('ingredientModal').style.display = 'none';
}

// 식자재 저장 함수
async function saveIngredient() {
    const ingredientId = document.getElementById('ingredientId').value;

    const ingredientData = {
        category: document.getElementById('ingredientCategory').value,
        sub_category: document.getElementById('ingredientSubcategory').value,
        ingredient_code: document.getElementById('ingredientCode').value,
        ingredient_name: document.getElementById('ingredientName').value,
        origin: document.getElementById('ingredientOrigin').value,
        posting_status: document.getElementById('ingredientCalculation').value,
        specification: document.getElementById('ingredientSpecification').value,
        unit: document.getElementById('ingredientUnit').value,
        tax_type: document.getElementById('ingredientTaxFree').value,
        price_per_unit: document.getElementById('ingredientUnitPrice').value,
        purchase_price: document.getElementById('ingredientPurchasePrice').value,
        selling_price: document.getElementById('ingredientPrice').value,
        supplier_name: document.getElementById('ingredientSupplier').value,
        delivery_days: document.getElementById('ingredientSelectiveOrder').value,
        notes: document.getElementById('ingredientMemo').value
    };

    try {
        let response;
        if (ingredientId) {
            // 수정
            response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients/${ingredientId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ingredientData)
            });
        } else {
            // 새 등록
            response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ingredientData)
            });
        }

        const result = await response.json();

        if (result.success) {
            showToast(ingredientId ? '식자재가 성공적으로 수정되었습니다.' : '식자재가 성공적으로 등록되었습니다.');
            closeIngredientModal();
            loadIngredients(); // 데이터 새로고침
        } else {
            showToast(`오류: ${result.message || '알 수 없는 오류가 발생했습니다.'}`);
        }
    } catch (error) {
        console.error('저장 오류:', error);
        showToast('저장 중 오류가 발생했습니다.');
    }
}

// 식자재 삭제 함수
async function deleteIngredient() {
    const ingredientId = document.getElementById('ingredientId').value;

    if (!ingredientId) {
        showToast('삭제할 식자재 ID가 없습니다.');
        return;
    }

    if (!confirm('정말로 이 식자재를 삭제하시겠습니까?')) {
        return;
    }

    try {
        const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients/${ingredientId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('식자재가 성공적으로 삭제되었습니다.');
            closeIngredientModal();
            loadIngredients(); // 데이터 새로고침
        } else {
            showToast(`삭제 오류: ${result.message || '알 수 없는 오류가 발생했습니다.'}`);
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        showToast('삭제 중 오류가 발생했습니다.');
    }
}

// 고급 단위당 단가 자동 계산 함수 (API 기반)
async function autoCalculateUnitPrice() {
    const specification = document.getElementById('ingredientSpecification').value;
    const unit = document.getElementById('ingredientUnit').value;
    const purchasePrice = parseFloat(document.getElementById('ingredientPurchasePrice').value) || 0;

    if (!specification || !unit || purchasePrice <= 0) {
        showToast('규격, 단위, 입고가를 먼저 입력해주세요.');
        return;
    }

    try {
        // 로딩 표시
        showToast('🤖 AI 기반 자동 계산 중...');

        // API 호출
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/calculate-unit-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                specification: specification,
                unit: unit,
                purchase_price: purchasePrice
            })
        });

        const result = await response.json();

        if (result.success && result.unit_price !== null) {
            document.getElementById('ingredientUnitPrice').value = result.unit_price.toFixed(1);
            showToast(`✅ AI 계산 완료: ${result.unit_price.toFixed(1)}원 (방법: ${result.method || 'AI 학습 기반'})`);
        } else {
            // API 실패시 기존 로컬 계산 사용
            const localResult = calculateUnitPrice(specification, unit, purchasePrice);
            if (localResult.success) {
                document.getElementById('ingredientUnitPrice').value = localResult.price.toFixed(1);
                showToast(`계산 완료: ${localResult.method}`);
            } else {
                showToast(`계산 실패: ${result.error || localResult.error}`);
            }
        }
    } catch (error) {
        console.error('API 계산 오류:', error);
        // API 오류시 기존 로컬 계산 사용
        const localResult = calculateUnitPrice(specification, unit, purchasePrice);
        if (localResult.success) {
            document.getElementById('ingredientUnitPrice').value = localResult.price.toFixed(1);
            showToast(`계산 완료: ${localResult.method}`);
        } else {
            showToast(`계산 실패: ${localResult.error}`);
        }
    }
}

// 엑셀 다운로드 함수
function exportToExcel() {
    showToast('엑셀 다운로드 기능은 개발 중입니다.');
}

// 전체 데이터 로드 함수
function loadAllData() {
    showToast('전체 데이터를 로드하는 중...');
    // 전체 데이터를 로드하는 로직을 여기에 구현
    loadIngredients(1, false);
}

// 식자재 추가 함수 (openNewIngredientModal의 별칭)
function addIngredient() {
    openNewIngredientModal();
}

// 새 식자재 추가 모달 열기
function openNewIngredientModal() {
    // 모든 필드 초기화
    document.getElementById('ingredientId').value = '';
    document.getElementById('ingredientCategory').value = '';
    document.getElementById('ingredientSubcategory').value = '';
    document.getElementById('ingredientCode').value = '';
    document.getElementById('ingredientName').value = '';
    document.getElementById('ingredientOrigin').value = '';
    document.getElementById('ingredientCalculation').value = 'Y';
    document.getElementById('ingredientSpecification').value = '';
    document.getElementById('ingredientUnit').value = '';
    document.getElementById('ingredientTaxFree').value = '';
    document.getElementById('ingredientUnitPrice').value = '';
    document.getElementById('ingredientPurchasePrice').value = '';
    document.getElementById('ingredientPrice').value = '';
    document.getElementById('ingredientSupplier').value = '';
    document.getElementById('ingredientSelectiveOrder').value = '';
    document.getElementById('ingredientMemo').value = '';

    // 자동 계산 섹션 숨김
    const autoCalcSection = document.getElementById('autoCalculationHelper');
    if (autoCalcSection) {
        autoCalcSection.style.display = 'none';
    }

    // 모달 표시
    document.getElementById('ingredientModal').style.display = 'block';
}


// === 630 패턴 기반 100% 계산 완료 시스템 ===

let currentRecalcIngredientId = null;

// 계산 현황 업데이트 (전체 DB 기준)
async function updateCalculationStatus() {
    try {
        // 정확한 배치 계산 진행률 API 사용
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/batch-progress');
        const data = await response.json();

        if (data.success) {
            const total = data.total_items || 0;
            const calculated = data.completed_items || 0;
            const uncalculated = data.error_count || 0;  // 실패한 것들이 미계산
            const accuracy = total > 0 ? Math.round((calculated / total) * 100) : 0;

            document.getElementById('calculated-count').textContent = calculated.toLocaleString();
            document.getElementById('uncalculated-count').textContent = uncalculated.toLocaleString();
            document.getElementById('accuracy-rate').textContent = accuracy;

            // 색상 업데이트
            const statusEl = document.getElementById('calculation-status');
            if (accuracy >= 95) {
                statusEl.style.borderLeftColor = '#28a745';
            } else if (accuracy >= 80) {
                statusEl.style.borderLeftColor = '#ffc107';
            } else {
                statusEl.style.borderLeftColor = '#dc3545';
            }

            console.log(`정확한 계산 현황: ${calculated.toLocaleString()}/${total.toLocaleString()} (${accuracy}%) - 미계산: ${uncalculated.toLocaleString()}`);
        } else {
            throw new Error('API 호출 실패');
        }
    } catch (error) {
        console.error('계산 현황 조회 실패:', error);
        // 폴백: 현재 로드된 데이터로 추정
        const total = totalDataCount || allIngredients.length;
        const calculated = allIngredients.filter(item => {
            const price = item['단위당 단가'] || item['price_per_unit'] || 0;
            return price && parseFloat(price) > 0;
        }).length;
        const uncalculated = total - calculated;
        const accuracy = total > 0 ? Math.round((calculated / total) * 100) : 0;

        document.getElementById('calculated-count').textContent = calculated.toLocaleString() + '*';
        document.getElementById('uncalculated-count').textContent = uncalculated.toLocaleString() + '*';
        document.getElementById('accuracy-rate').textContent = accuracy + '*';
    }
}

// 재계산 모달 열기
async function openRecalculationModal(ingredientId) {
    currentRecalcIngredientId = ingredientId;
    const ingredient = allIngredients.find(item =>
        (item.ID || item.id) == ingredientId
    );

    if (!ingredient) {
        showToast('식자재 정보를 찾을 수 없습니다.');
        return;
    }

    // 기본 정보 표시
    document.getElementById('recalc-name').textContent = ingredient['식자재명'] || '-';
    document.getElementById('recalc-spec').textContent = ingredient['규격'] || '-';
    document.getElementById('recalc-unit').textContent = ingredient['단위'] || '-';
    document.getElementById('recalc-price').textContent = (ingredient['입고가'] || 0).toLocaleString();

    // AI 제안 로딩
    const aiLoadingElement = document.getElementById('ai-loading');
    if (aiLoadingElement) {
        aiLoadingElement.textContent = '630+ 패턴 기반 계산 중...';
    }

    // 모달 표시
    document.getElementById('recalculationModal').style.display = 'block';

    // AI 계산 요청
    try {
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/calculate-unit-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                specification: ingredient['규격'] || '',
                unit: ingredient['단위'] || '',
                purchase_price: parseFloat(ingredient['입고가'] || 0)
            })
        });

        const result = await response.json();

        if (result.success && result.unit_price) {
            const aiSuggestionsElement = document.getElementById('ai-suggestions');
            if (aiSuggestionsElement) {
                aiSuggestionsElement.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 10px; border-radius: 4px; border-left: 4px solid #28a745;">
                    <div>
                        <div style="font-weight: bold; color: #28a745;">✅ ${result.unit_price.toFixed(1)}원</div>
                        <div style="font-size: 12px; color: #666;">방법: ${result.method || 'AI 학습 기반'}</div>
                    </div>
                    <button onclick="applyAIPrice(${result.unit_price})" class="btn btn-success btn-sm">적용</button>
                </div>
                `;
            }
        } else {
            const aiSuggestionsElement = document.getElementById('ai-suggestions');
            if (aiSuggestionsElement) {
                aiSuggestionsElement.innerHTML = `
                    <div style="color: #856404; text-align: center;">
                        ⚠️ 자동 계산 실패 - 수동 입력을 사용해주세요
                    </div>
                `;
            }
        }
    } catch (error) {
        const aiSuggestionsElement = document.getElementById('ai-suggestions');
        if (aiSuggestionsElement) {
            aiSuggestionsElement.innerHTML = `
                <div style="color: #dc3545; text-align: center;">
                    ❌ 계산 서버 오류 - 수동 입력을 사용해주세요
                </div>
            `;
        }
    }
}

// AI 가격 적용
async function applyAIPrice(price) {
    await applyCalculatedPrice(price);
}

// 수동 가격 적용
async function applyManualPrice() {
    const price = parseFloat(document.getElementById('manual-unit-price').value);
    if (!price || price <= 0) {
        showToast('올바른 단가를 입력해주세요.');
        return;
    }
    await applyCalculatedPrice(price);
}

// 계산된 가격 적용 (공통)
async function applyCalculatedPrice(price) {
    try {
        const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients/${currentRecalcIngredientId}/unit-price`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                price_per_unit: price
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast(`단위당 단가가 ${price.toFixed(1)}원으로 업데이트되었습니다.`);
            closeRecalculationModal();

            // 화면 데이터 업데이트
            const ingredient = allIngredients.find(item => (item.ID || item.id) == currentRecalcIngredientId);
            if (ingredient) {
                ingredient['단위당 단가'] = price;
                ingredient['price_per_unit'] = price;
            }

            displayPage();
            updateCalculationStatus();
        } else {
            showToast('업데이트 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        showToast('서버 오류가 발생했습니다.');
        console.error('Price update error:', error);
    }
}

// 재계산 모달 닫기
function closeRecalculationModal() {
    document.getElementById('recalculationModal').style.display = 'none';
    document.getElementById('manual-unit-price').value = '';
    currentRecalcIngredientId = null;
}

// 건너뛰기
function skipThisItem() {
    closeRecalculationModal();
}

// 최적화된 일괄 단가 계산 (빠른 계산기 사용)
async function startBatchCalculation() {
    // 진행률 표시 엘리먼트 생성 (confirm 없이 바로 시작)
    showProgressModal();

    try {
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/batch-calculate-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showToast('일괄 계산이 시작되었습니다. 진행 상황을 모니터링합니다.');
                monitorBatchProgress();
            } else {
                hideProgressModal();
                showToast('일괄 계산 시작에 실패했습니다: ' + (data.message || '알 수 없는 오류'));
            }
        } else {
            hideProgressModal();
            showToast('서버 오류: ' + response.status);
        }
    } catch (error) {
        hideProgressModal();
        console.error('일괄 계산 시작 오류:', error);
        showToast('일괄 계산 시작 중 오류가 발생했습니다.');
    }
}

// 진행률 모달 표시
function showProgressModal() {
    const modal = document.createElement('div');
    modal.id = 'progress-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; min-width: 400px; text-align: center;">
            <h3 style="margin: 0 0 20px 0; color: #333;">⚡ 일괄 단가 계산 진행 중</h3>

            <div style="margin: 20px 0;">
                <div style="background: #f8f9fa; border-radius: 10px; overflow: hidden; height: 20px; margin: 10px 0;">
                    <div id="progress-bar" style="background: linear-gradient(90deg, #007bff, #0056b3); height: 100%; width: 0%; transition: width 0.3s;"></div>
                </div>
                <div id="progress-text" style="font-size: 14px; color: #666; margin-top: 10px;">시작 중...</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin: 20px 0;">
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #007bff;" id="processed-count">0</div>
                    <div style="font-size: 12px; color: #666;">처리됨</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #28a745;" id="success-count">0</div>
                    <div style="font-size: 12px; color: #666;">성공</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #dc3545;" id="failed-count">0</div>
                    <div style="font-size: 12px; color: #666;">실패</div>
                </div>
            </div>

            <div id="speed-info" style="font-size: 12px; color: #999; margin-top: 15px;">
                속도: 계산 중... | 예상 시간: 계산 중...
            </div>

            <button onclick="hideProgressModal()" style="margin-top: 20px; padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">백그라운드에서 계속</button>
        </div>
    `;

    document.body.appendChild(modal);
}

// 진행률 모달 숨기기
function hideProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (modal) {
        modal.remove();
    }
}

// 배치 계산 진행률 모니터링 (개선된 UI)
async function monitorBatchProgress() {
    const pollInterval = 1000; // 1초마다 확인 (더 빠른 업데이트)
    let isCompleted = false;
    let startTime = Date.now();

    const poll = async () => {
        try {
            const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/batch-progress');
            const data = await response.json();

            if (data.success) {
                const total = data.total_items || 0;
                const processed = data.completed_items || 0;
                const success = processed - (data.error_count || 0);
                const failed = data.error_count || 0;
                const percentage = Math.round(data.progress_percentage || 0);

                console.log('🔄 진행률 업데이트:', {percentage, processed, total, success, failed});

                // 진행률 UI 업데이트
                const progressBar = document.getElementById('progress-bar');
                const progressText = document.getElementById('progress-text');
                const processedCount = document.getElementById('processed-count');
                const successCount = document.getElementById('success-count');
                const failedCount = document.getElementById('failed-count');
                const speedInfo = document.getElementById('speed-info');

                if (progressBar) progressBar.style.width = percentage + '%';
                if (progressText) progressText.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} (${percentage}%)`;
                if (processedCount) processedCount.textContent = processed.toLocaleString();
                if (successCount) successCount.textContent = success.toLocaleString();
                if (failedCount) failedCount.textContent = failed.toLocaleString();

                // 속도 및 예상 시간 계산
                const elapsedTime = (Date.now() - startTime) / 1000; // 초
                const speed = processed > 0 ? Math.round(processed / elapsedTime) : 0;
                const remaining = total - processed;
                const estimatedTime = speed > 0 ? Math.round(remaining / speed) : 0;

                if (speedInfo) {
                    speedInfo.textContent = `속도: ${speed}개/초 | 예상 완료: ${estimatedTime}초 후`;
                }

                // 완료 확인
                if (data.is_completed || processed >= total) {
                    isCompleted = true;

                    // 완료 메시지 표시
                    if (progressText) {
                        progressText.innerHTML = `
                            <span style="color: #28a745; font-weight: bold;">✅ 완료!</span><br>
                            성공: ${success.toLocaleString()}, 실패: ${failed.toLocaleString()}<br>
                            소요시간: ${Math.round(elapsedTime)}초
                        `;
                    }

                    // 화면 데이터 새로고침
                    setTimeout(() => {
                        loadIngredients();
                        updateCalculationStatus();
                        hideProgressModal();
                        showToast(`✅ 일괄 계산 완료! 성공: ${success.toLocaleString()}개, 실패: ${failed.toLocaleString()}개`);
                    }, 3000);

                    console.log(`🎉 전체 배치 계산 완료: ${success.toLocaleString()}/${total.toLocaleString()} (소요시간: ${Math.round(elapsedTime)}초)`);
                    return;
                }
            }

            // 진행 중이면 계속 폴링
            if (!isCompleted) {
                setTimeout(poll, pollInterval);
            }

        } catch (error) {
            console.error('진행률 모니터링 실패:', error);
            if (!isCompleted) {
                setTimeout(poll, pollInterval * 2); // 에러 시 더 긴 간격으로 재시도
            }
        }
    };

    // 첫 폴링 시작
    poll();
}

// 배치 모달 닫기
function closeBatchModal() {
    document.getElementById('batchCalculationModal').style.display = 'none';
}