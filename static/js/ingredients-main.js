// 식자재 관리 메인 로직

// 페이지네이션 변수
let currentPage = 1;
let itemsPerPage = 300;
let totalItems = 0;
let allIngredients = [];
let filteredIngredients = [];
let isSearching = false;
let currentSort = 'price_per_unit'; // 기본 정렬: 단위당 단가
let sortDirection = 'asc'; // 오름차순
let isLoadingMore = false; // 추가 로딩 중 플래그
let totalDataCount = 0; // 실제 DB의 전체 데이터 수

// 페이지 로드 시 식자재 목록 불러오기
document.addEventListener('DOMContentLoaded', function() {
    // 브랜딩 시스템 적용
    if (typeof BrandingManager !== 'undefined') {
        BrandingManager.applyBranding('식자재 관리');
        console.log('✅ 브랜딩 시스템 적용 완료 (식자재 관리)');
    }

    // 페이지당 항목 수 변경 이벤트
    document.getElementById('itemsPerPage').addEventListener('change', function() {
        itemsPerPage = parseInt(this.value);
        currentPage = 1;
        displayPage();
    });

    // 엔터키로 검색 실행
    document.getElementById('searchSupplier').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchIngredients();
    });
    document.getElementById('searchName').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchIngredients();
    });
    document.getElementById('searchCode').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchIngredients();
    });

    // 정렬 핸들러 설정
    setupSortHandlers();

    loadIngredients();
});

// 식자재 목록 로딩 함수
async function loadIngredients(pageNum = 1, appendData = false) {
    console.log('=== loadIngredients 함수 시작 ===');
    console.log('pageNum:', pageNum, 'appendData:', appendData);

    try {
        if (!appendData) {
            // 초기 로딩 시 로딩 메시지 표시 및 전체 개수 조회
            document.getElementById('loadingDiv').innerHTML = '<i class="fas fa-spinner fa-spin"></i> 식자재 목록을 불러오는 중...';
            document.getElementById('loadingDiv').style.display = 'block';
            console.log('로딩 div 표시됨');

            // 간단한 API 테스트 먼저 수행
            try {
                console.log('=== 간단한 API 테스트 시작 ===');
                const testResponse = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-new?page=1&per_page=1');
                console.log('테스트 응답 상태:', testResponse.status);
                console.log('테스트 응답 헤더:', testResponse.headers);

                if (testResponse.ok) {
                    const testData = await testResponse.json();
                    console.log('테스트 데이터:', testData);
                } else {
                    throw new Error(`테스트 API 실패: ${testResponse.status}`);
                }
            } catch (testError) {
                console.error('=== API 테스트 실패 ===');
                console.error('테스트 오류:', testError);
                throw testError;
            }

            // 실제 DB 전체 개수 조회하여 즉시 표시
            const actualTotalCount = await getTotalIngredientsCount();
            if (actualTotalCount > 0) {
                totalDataCount = actualTotalCount;
                document.getElementById('totalCount').textContent = `총 ${actualTotalCount.toLocaleString()}개`;
                document.getElementById('loadedDataCount').textContent = '0';
                console.log(`🎯 전체 개수 설정: ${actualTotalCount}개`);
            }
        }

        // 필터링 파라미터 가져오기 (기본값: 필터 해제)
        const excludeUnpublished = document.getElementById('excludeUnpublished')?.checked ?? false;
        const excludeNoPrice = document.getElementById('excludeNoPrice')?.checked ?? false;

        console.log('필터 설정:', { excludeUnpublished, excludeNoPrice });

        // 초기 로딩은 1,000개만 빠르게, 검색은 전체 대상
        const perPageLoad = appendData ? 10000 : 1000;  // 초기:1000개, 추가로딩:10000개

        // 정렬 파라미터 추가
        const sortParams = currentSort && sortDirection ? `&sort_by=${currentSort}&sort_order=${sortDirection}` : '';

        // 필터링 파라미터 추가
        const filterParams = `&exclude_unpublished=${excludeUnpublished}&exclude_no_price=${excludeNoPrice}`;

        console.log('API 요청 시작:', `${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-new?page=${pageNum}&per_page=${perPageLoad}${sortParams}${filterParams}`);

        const response = await fetch(`${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-new?page=${pageNum}&per_page=${perPageLoad}${sortParams}${filterParams}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API 응답 성공:', data);

        if (data.success) {
            console.log('Raw API response sample:', data.data.ingredients[0]); // 디버깅: 원본 데이터 확인
            // API 응답의 영어 필드를 한글로 매핑
            const newIngredients = (data.data.ingredients || []).map(item => {
                console.log('Processing item with id:', item.id); // 디버깅: 각 아이템의 id 확인
                return {
                    // ID 필드 추가
                    'ID': item.id,
                    'id': item.id,
                // 한글 필드명
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
                'g당단가': item.price_per_unit || 0,
                '입고가': item.purchase_price,
                '판매가': item.selling_price,
                '거래처명': item.supplier_name,
                '비고': item.notes,
                '등록일': formatDate(item.created_at),
                '협력업체명': item.supplier_name,
                '단위당 단가': item.price_per_unit || 0,
                '게시여부': item.posting_status,
                '과/면세': item.tax_type,
                '선발주일': item.delivery_days,
                '사용유무': item.is_active,
                '생성일': formatDate(item.created_date),
                '생성자': item.created_by,
                '수정일': formatDate(item.updated_at),

                // 영어 필드명도 보존 (엑셀 다운로드용)
                // 원본 데이터 별도 프로퍼티로 저장
                _original: item,
                // 추가 매핑
                price_per_unit: item.price_per_unit || 0,
                purchase_price: item.purchase_price || 0,
                selling_price: item.selling_price || 0
                };
            });

            if (appendData) {
                // 추가 로딩인 경우 기존 데이터에 병합
                allIngredients = allIngredients.concat(newIngredients);
            } else {
                // 초기 로딩인 경우 새로 설정
                allIngredients = newIngredients;
                totalDataCount = data.data.pagination?.total_count || data.total_count || newIngredients.length;
            }

            // 전체 데이터 수 업데이트
            totalItems = allIngredients.length;

            // 데이터를 단위당 단가 기준으로 낮은 가격 순 정렬 (0은 뒤로)
            allIngredients.sort((a, b) => {
                const priceA = parseFloat(a['단위당 단가']) || 0;
                const priceB = parseFloat(b['단위당 단가']) || 0;

                // 0인 값들(미계산)은 뒤로 보내기
                if (priceA === 0 && priceB === 0) return 0;
                if (priceA === 0) return 1;
                if (priceB === 0) return -1;

                return priceA - priceB; // 저단가 순
            });

            // 로딩 상태 표시 업데이트
            document.getElementById('loadedDataCount').textContent = allIngredients.length.toLocaleString();

            if (totalDataCount > allIngredients.length && !appendData) {
                // 빠른 시작: 1,000개만 로드하고 필요시 더 로드
                const percentage = Math.round((allIngredients.length / totalDataCount) * 100);
                document.getElementById('loadingDiv').innerHTML =
                    `<div style="background: #e8f4fd; padding: 12px; border-radius: 6px; margin-bottom: 10px; border-left: 4px solid #3498db;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-rocket" style="color: #3498db;"></i>
                            <div>
                                <div style="font-weight: bold;">⚡ 빠른 시작: ${allIngredients.length.toLocaleString()}개 로드 완료!</div>
                                <div style="font-size: 12px; color: #666;">
                                    전체 ${totalDataCount.toLocaleString()}개 중 ${percentage}% | 검색은 전체 DB 대상
                                </div>
                            </div>
                            <button onclick="loadMoreData()" class="btn btn-primary" style="margin-left: auto; padding: 6px 12px; font-size: 12px;">
                                <i class="fas fa-plus"></i> 더 많은 데이터 로드
                            </button>
                        </div>
                        <div style="background: #f8f9fa; height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #28a745, #20c997); height: 100%; width: ${Math.min(percentage + 10, 100)}%; transition: width 0.3s ease;"></div>
                        </div>
                    </div>`;
                document.getElementById('loadingDiv').style.display = 'block';
            } else if (appendData || allIngredients.length >= totalDataCount) {
                // 추가 로딩 완료 또는 전체 로드 완료
                document.getElementById('loadingDiv').innerHTML =
                    `<div style="background: #d4edda; padding: 10px; border-radius: 6px; margin-bottom: 10px; border-left: 4px solid #28a745;">
                        <i class="fas fa-check-circle" style="color: #28a745;"></i>
                        <strong>전체 ${allIngredients.length.toLocaleString()}개 데이터 로드 완료!</strong>
                    </div>`;
                setTimeout(() => {
                    document.getElementById('loadingDiv').style.display = 'none';
                }, 3000);
            }

            // 초기 로딩에서는 자동 로드하지 않음 (1,000개만 빠르게 표시)
            // 사용자가 "추가 로드" 버튼을 클릭할 때만 더 로드
            if (data.data.ingredients && data.data.ingredients.length === 1000 && !appendData) {
                console.log('초기 1,000개 로드 완료. 추가 데이터는 버튼 클릭 시 로드됩니다.');
            } else if (data.data.ingredients && data.data.ingredients.length === 10000 && appendData) {
                // 추가 로딩 중일 때만 자동 계속 로드
                setTimeout(() => {
                    loadMoreDataAutomatically(pageNum + 1);
                }, 100);
            }
        } else {
            if (!appendData) {
                allIngredients = [];
            }
        }

        // 전체 데이터 저장하고 필터링 적용
        // allIngredients는 이미 위에서 설정됨

        if (!appendData) {
            // 초기 로딩일 때만 정렬 설정 및 필터 적용
            currentSort = 'price_per_unit';
            sortDirection = 'asc';

            // 필터링 적용
            applyFilters();

            // 계산 현황 업데이트
            setTimeout(() => updateCalculationStatus(), 1000);

            // 업체별 박스 업데이트 - 디버깅
            console.log('API에서 받은 supplier_stats:', data.data.supplier_stats);
            console.log('전체 API 응답:', data);

            // 업체별 통계가 없으면 직접 계산
            if (!data.data.supplier_stats || Object.keys(data.data.supplier_stats).length === 0) {
                console.log('API에서 supplier_stats가 없어서 직접 계산합니다.');
                const calculatedStats = {};
                (data.data.ingredients || []).forEach(item => {
                    const supplier = item.supplier_name;
                    if (supplier) {
                        calculatedStats[supplier] = (calculatedStats[supplier] || 0) + 1;
                    }
                });
                console.log('직접 계산한 통계:', calculatedStats);
                updateSuppliersGrid(calculatedStats);
            } else {
                updateSuppliersGrid(data.data.supplier_stats);
            }
        } else {
            // 추가 로딩일 때는 필터만 다시 적용
            applyFilters();
        }

    } catch (error) {
        console.error('Error loading ingredients:', error);
        document.getElementById('loadingDiv').innerHTML = '<div style="color: red; padding: 20px;">오류: 데이터를 불러올 수 없습니다. API 서버 연결을 확인해주세요.</div>';
        document.getElementById('loadingDiv').style.display = 'block';
        // 페이지 새로고침 방지 - 오류 발생 시에도 계속 진행
    }
}

// 나머지 대형 함수들 (약 800줄)
// 이 주석 다음에 displayPage부터 searchIngredientsLocal까지의 함수들이 추가됩니다// 대규모 함수들 추가
