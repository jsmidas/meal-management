/**
 * 공통 사이드바 모듈
 * 모든 사용자 페이지에서 동일한 사이드바를 생성합니다.
 */

(function() {
    'use strict';

    // 사이드바 HTML (인라인으로 포함)
    const sidebarHTML = `
        <div class="logo">
            <img src="/static/images/logo.png?v=20251027" alt="다함푸드 로고">
        </div>
        <a href="dashboard.html" class="nav-item" data-page="dashboard"><i class="fas fa-home"></i>대시보드</a>
        <a href="meal_count_management.html" class="nav-item" data-page="meal_count_management"><i class="fas fa-users"></i>식수 관리</a>
        <a href="meal_count_inquiry.html" class="nav-item" data-page="meal_count_inquiry"><i class="fas fa-search"></i>식수 조회</a>
        <a href="menu_recipe_management.html" class="nav-item" data-page="menu_recipe_management"><i class="fas fa-utensils"></i>메뉴/레시피 관리</a>
        <a href="meal_plan_advanced.html" class="nav-item" data-page="meal_plan_advanced"><i class="fas fa-calendar-alt"></i>식단 관리</a>
        <a href="meal_plan_print.html" class="nav-item" data-page="meal_plan_print"><i class="fas fa-print"></i>식단표 출력</a>
        <div class="nav-dropdown" id="event-dropdown">
            <div class="nav-dropdown-toggle" onclick="toggleDropdown('event-dropdown')"><i class="fas fa-star"></i><span>행사/특별식</span><i class="fas fa-chevron-down dropdown-arrow"></i></div>
            <div class="nav-submenu">
                <a href="event_template_management.html" class="nav-item" data-page="event_template_management">템플릿 관리</a>
                <a href="event_order_management.html" class="nav-item" data-page="event_order_management">행사 등록/손익</a>
                <a href="event_ordering_management.html" class="nav-item" data-page="event_ordering_management">행사 발주</a>
            </div>
        </div>
        <a href="base_weight_correction.html" class="nav-item" data-page="base_weight_correction"><i class="fas fa-balance-scale"></i>기준용량 보정</a>
        <div class="nav-dropdown" id="ingredients-dropdown">
            <div class="nav-dropdown-toggle" onclick="toggleDropdown('ingredients-dropdown')"><i class="fas fa-carrot"></i><span>식자재 관리</span><i class="fas fa-chevron-down dropdown-arrow"></i></div>
            <div class="nav-submenu">
                <a href="ingredients_management.html" class="nav-item" data-page="ingredients_management">식자재 목록</a>
                <a href="ingredient_bulk_change.html" class="nav-item" data-page="ingredient_bulk_change">식자재 일괄변경</a>
                <a href="ingredient_usage_history.html" class="nav-item" data-page="ingredient_usage_history">식자재 사용내역</a>
            </div>
        </div>
        <a href="ordering_management.html" class="nav-item" data-page="ordering_management"><i class="fas fa-shopping-cart"></i>발주 관리</a>
        <a href="receiving_management.html" class="nav-item" data-page="receiving_management"><i class="fas fa-truck"></i>입고명세서 관리</a>
        <a href="logs_management.html" class="nav-item" data-page="logs_management"><i class="fas fa-book"></i>각종 일지</a>
        <div class="nav-dropdown" id="instruction-dropdown">
            <div class="nav-dropdown-toggle" onclick="toggleDropdown('instruction-dropdown')"><i class="fas fa-clipboard-list"></i><span>지시서 관리</span><i class="fas fa-chevron-down dropdown-arrow"></i></div>
            <div class="nav-submenu">
                <a href="preprocessing_management.html" class="nav-item" data-page="preprocessing_management">전처리지시서</a>
                <a href="cooking_instruction_management.html" class="nav-item" data-page="cooking_instruction_management">조리지시서</a>
                <a href="portion_instruction_management.html" class="nav-item" data-page="portion_instruction_management">소분지시서</a>
                <a href="side_dish_position_guide.html" class="nav-item" data-page="side_dish_position_guide">반찬위치지정서</a>
            </div>
        </div>
        <div class="nav-divider"></div>
        <a href="notice_board.html" class="nav-item" data-page="notice_board"><i class="fas fa-bullhorn"></i>공지사항</a>
        <a href="hygiene_notice.html" class="nav-item" data-page="hygiene_notice"><i class="fas fa-shield-alt"></i>위생안전</a>
        <a href="system_request.html" class="nav-item" data-page="system_request"><i class="fas fa-tools"></i>시스템 요청</a>
        <a href="sales_management.html" class="nav-item" data-page="sales_management"><i class="fas fa-chart-pie"></i>식재료비 분석</a>
        <div class="nav-divider"></div>
        <a href="admin_dashboard.html" class="nav-item admin-item" id="admin-link" style="display:none;" data-page="admin_dashboard"><i class="fas fa-cog"></i>ADMIN</a>
    `;

    // 드롭다운 토글 함수 (전역)
    window.toggleDropdown = function(id) {
        const dropdown = document.getElementById(id);
        if (dropdown) {
            dropdown.classList.toggle('open');
        }
    };

    // 현재 페이지 이름 추출
    function getCurrentPageName() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'dashboard.html';
        return filename.replace('.html', '');
    }

    // 사이드바 초기화
    function initSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) {
            console.warn('[CommonSidebar] .sidebar 요소를 찾을 수 없습니다.');
            return;
        }

        // 사이드바에 이미 내용이 있는지 확인 (nav-item이 있으면 스킵)
        const existingNavItems = sidebar.querySelectorAll('.nav-item');
        if (existingNavItems.length > 2) {
            console.log('[CommonSidebar] 기존 사이드바 내용 유지');
            highlightCurrentPage();
            showAdminLink();
            return;
        }

        // 사이드바 내용 삽입
        sidebar.innerHTML = sidebarHTML;
        console.log('[CommonSidebar] 사이드바 생성 완료');

        // 현재 페이지 하이라이트
        highlightCurrentPage();

        // 관리자 링크 표시
        showAdminLink();
    }

    // 현재 페이지 하이라이트
    function highlightCurrentPage() {
        const currentPage = getCurrentPageName();
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // 모든 nav-item에서 active 제거
        sidebar.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // 현재 페이지에 active 추가
        const currentItem = sidebar.querySelector(`[data-page="${currentPage}"]`);
        if (currentItem) {
            currentItem.classList.add('active');

            // 드롭다운 내부에 있으면 드롭다운 열기
            const dropdown = currentItem.closest('.nav-dropdown');
            if (dropdown) {
                dropdown.classList.add('open');
            }
        }

        // data-page가 없는 기존 링크도 처리
        sidebar.querySelectorAll('.nav-item').forEach(item => {
            const href = item.getAttribute('href');
            if (href && href.includes(currentPage + '.html')) {
                item.classList.add('active');
                const dropdown = item.closest('.nav-dropdown');
                if (dropdown) {
                    dropdown.classList.add('open');
                }
            }
        });
    }

    // 관리자 링크 표시
    function showAdminLink() {
        const adminLink = document.getElementById('admin-link');
        if (!adminLink) return;

        try {
            const userInfo = JSON.parse(localStorage.getItem('user_info') || localStorage.getItem('user') || '{}');
            if (userInfo.role === 'admin' || userInfo.operator) {
                adminLink.style.display = 'flex';
            }
        } catch (e) {
            console.warn('[CommonSidebar] 사용자 정보 파싱 실패:', e);
        }
    }

    // DOM 로드 시 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }

    // 전역 노출
    window.CommonSidebar = {
        init: initSidebar,
        highlight: highlightCurrentPage
    };
})();
