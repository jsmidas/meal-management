/**
 * 사이드바 드롭다운 토글 함수
 * 모든 페이지에서 공통으로 사용
 */
function toggleDropdown(id) {
    const dropdown = document.getElementById(id);
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

// 페이지 로드 시 현재 페이지에 해당하는 드롭다운 자동 열기
document.addEventListener('DOMContentLoaded', function() {
    const currentPath = window.location.pathname;

    // 식자재 관리 관련 페이지인 경우 드롭다운 자동 열기
    if (currentPath.includes('ingredients_management') ||
        currentPath.includes('ingredient_bulk_change')) {
        const dropdown = document.getElementById('ingredients-dropdown');
        if (dropdown) {
            dropdown.classList.add('open');
        }
    }
});
