// 식자재 관리 API 함수들

// 실제 DB 전체 개수 조회 함수
async function getTotalIngredientsCount() {
    try {
        // 전체 개수만 조회 (검색 없이)
        const response = await fetch('${window.CONFIG?.API?.BASE_URL || window.location.origin}/api/admin/ingredients-new?page=1&per_page=1');
        const data = await response.json();

        if (data.success) {
            const totalCount = data.pagination?.total_items || data.total || data.total_count || 0;
            console.log(`실제 DB 전체 개수: ${totalCount}개`);
            return totalCount;
        }
        return 0;
    } catch (error) {
        console.error('전체 개수 조회 실패:', error);
        return 0;
    }
}

// 식자재 목록 로딩 함수 (복잡한 함수이므로 나중에 HTML에서 이동 예정)
// loadIngredients() - 이 함수는 매우 길어서 별도로 처리 예정

// 식자재 저장 함수 (복잡한 함수이므로 나중에 HTML에서 이동 예정)
// saveIngredient() - 이 함수는 매우 길어서 별도로 처리 예정

// 식자재 삭제 함수 (복잡한 함수이므로 나중에 HTML에서 이동 예정)
// deleteIngredient() - 이 함수는 매우 길어서 별도로 처리 예정

// 식자재 검색 함수 (복잡한 함수이므로 나중에 HTML에서 이동 예정)
// searchIngredients() - 이 함수는 매우 길어서 별도로 처리 예정