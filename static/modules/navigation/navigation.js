/**
 * 네비게이션 모듈
 * 사이드바 메뉴 및 네비게이션 관리
 */

window.NavigationModule = {
    app: null,
    currentMenu: 'dashboard',

    init(adminApp) {
        this.app = adminApp;
        this.render();
        this.setupEventListeners();
        console.log('🧭 Navigation Module 로드됨');
    },

    render() {
        const sidebar = document.getElementById('sidebar-navigation');
        if (!sidebar) return;

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <h2>🍽️ 다함식단관리</h2>
                <p>관리자 대시보드</p>
            </div>

            <nav class="sidebar-nav">
                <ul class="nav-menu">
                    <li class="nav-item ${this.currentMenu === 'dashboard' ? 'active' : ''}">
                        <a href="#" data-module="dashboard" class="nav-link">
                            <span class="nav-icon">📊</span>
                            <span class="nav-text">대시보드</span>
                        </a>
                    </li>
                    
                    <li class="nav-item ${this.currentMenu === 'users' ? 'active' : ''}">
                        <a href="#" data-module="users" class="nav-link">
                            <span class="nav-icon">👥</span>
                            <span class="nav-text">사용자 관리</span>
                        </a>
                    </li>
                    
                    <li class="nav-item ${this.currentMenu === 'sites' ? 'active' : ''}">
                        <a href="#" data-module="sites" class="nav-link">
                            <span class="nav-icon">🏢</span>
                            <span class="nav-text">사업장 관리</span>
                        </a>
                    </li>
                    
                    <li class="nav-item ${this.currentMenu === 'ingredients' ? 'active' : ''}">
                        <a href="#" data-module="ingredients" class="nav-link">
                            <span class="nav-icon">🥬</span>
                            <span class="nav-text">식재료 관리</span>
                        </a>
                    </li>
                    
                    <li class="nav-item ${this.currentMenu === 'meal-pricing' ? 'active' : ''}">
                        <a href="#" data-module="meal-pricing" class="nav-link">
                            <span class="nav-icon">💰</span>
                            <span class="nav-text">식단가 관리</span>
                        </a>
                    </li>
                </ul>

                <div class="nav-divider"></div>

                <ul class="nav-menu nav-secondary">
                    <li class="nav-item">
                        <a href="#" class="nav-link">
                            <span class="nav-icon">⚙️</span>
                            <span class="nav-text">설정</span>
                        </a>
                    </li>
                    
                    <li class="nav-item">
                        <a href="/login" class="nav-link">
                            <span class="nav-icon">🚪</span>
                            <span class="nav-text">로그아웃</span>
                        </a>
                    </li>
                </ul>
            </nav>

            <div class="sidebar-footer">
                <!-- 하단 네비게이션 버튼들 -->
                <div class="nav-bottom-actions" style="margin-bottom: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2);">
                    <a href="/" class="nav-link" style="background: #e8f5e8; color: #4caf50; border-radius: 4px;">
                        <span class="nav-icon">🍽️</span>
                        <span class="nav-text">급식관리로 이동</span>
                    </a>
                </div>
                
                <div class="version-info">
                    <small>v2.0.0 (모듈형)</small>
                </div>
            </div>
        `;

        this.applyStyles();
    },

    applyStyles() {
        // 네비게이션 전용 스타일 주입
        const style = document.createElement('style');
        style.textContent = `
            .sidebar-header {
                text-align: center;
                padding: 0 20px 30px;
                border-bottom: 1px solid rgba(255,255,255,0.2);
            }

            .sidebar-header h2 {
                font-size: 18px;
                font-weight: 600;
                margin-bottom: 5px;
            }

            .sidebar-header p {
                font-size: 12px;
                opacity: 0.8;
            }

            .sidebar-nav {
                flex: 1;
                padding: 20px 0;
                overflow-y: auto;
            }

            .nav-menu {
                list-style: none;
                padding: 0;
                margin: 0;
            }

            .nav-item {
                margin-bottom: 5px;
            }

            .nav-link {
                display: flex;
                align-items: center;
                padding: 12px 20px;
                color: rgba(255,255,255,0.8);
                text-decoration: none;
                transition: all 0.3s ease;
                border-left: 3px solid transparent;
            }

            .nav-link:hover {
                background: rgba(255,255,255,0.1);
                color: white;
                border-left-color: rgba(255,255,255,0.5);
            }

            .nav-item.active .nav-link {
                background: rgba(255,255,255,0.15);
                color: white;
                border-left-color: #fff;
            }

            .nav-icon {
                font-size: 16px;
                margin-right: 10px;
                width: 20px;
                text-align: center;
            }

            .nav-text {
                font-size: 14px;
                font-weight: 500;
            }

            .nav-divider {
                height: 1px;
                background: rgba(255,255,255,0.2);
                margin: 20px 0;
            }

            .nav-secondary {
                margin-top: auto;
            }

            .sidebar-footer {
                padding: 20px;
                border-top: 1px solid rgba(255,255,255,0.2);
                text-align: center;
            }

            .version-info {
                opacity: 0.6;
            }
        `;
        document.head.appendChild(style);
    },

    setupEventListeners() {
        const sidebar = document.getElementById('sidebar-navigation');
        if (!sidebar) return;

        sidebar.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (!link) return;

            // 외부 링크(href가 있는 경우)는 기본 동작을 허용
            const href = link.getAttribute('href');
            if (href && href !== '#') {
                // 외부 링크는 preventDefault 하지 않음
                return;
            }

            e.preventDefault();

            const module = link.dataset.module;
            if (module) {
                this.setActiveMenu(module);
                if (this.app) {
                    this.app.switchModule(module);
                }
            }
        });
    },

    setActiveMenu(menuName) {
        // 기존 active 클래스 제거
        const activeItems = document.querySelectorAll('.nav-item.active');
        activeItems.forEach(item => item.classList.remove('active'));

        // 새 active 클래스 추가
        const newActiveItem = document.querySelector(`[data-module="${menuName}"]`);
        if (newActiveItem) {
            newActiveItem.closest('.nav-item').classList.add('active');
        }

        this.currentMenu = menuName;
    }
};