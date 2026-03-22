/**
 * 브랜딩 관리 시스템
 * 화이트라벨링을 위한 로고 및 회사명 동적 적용
 * DB 기반 브랜딩 설정 (API 조회 → sessionStorage 캐시)
 */

// 중복 로딩 방지
if (typeof BrandingManager !== 'undefined') {
    console.warn('BrandingManager가 이미 정의되어 있습니다. 중복 로딩을 방지합니다.');
} else {
    window.BrandingManager = {
        _brandingData: null,

        /**
         * 브랜딩 정보 가져오기 (동기 - 캐시에서)
         */
        getBranding() {
            // 이미 로드된 데이터
            if (this._brandingData) return this._brandingData;

            // sessionStorage 캐시
            try {
                const cached = sessionStorage.getItem('branding_cache');
                if (cached) {
                    this._brandingData = JSON.parse(cached);
                    return this._brandingData;
                }
            } catch (e) {}

            // fallback: CONFIG 또는 기본값
            if (typeof CONFIG !== 'undefined' && CONFIG.BRANDING) {
                return CONFIG.BRANDING;
            }

            return {
                COMPANY_NAME: '다함푸드',
                SYSTEM_NAME: '급식관리',
                LOGO_PATH: '/static/images/logo.png?v=20251027',
                SIDEBAR_TITLE: '급식관리',
                COLORS: {
                    PRIMARY: '#2a5298',
                    SECONDARY: '#667eea'
                }
            };
        },

        /**
         * API에서 브랜딩 로드 (비동기)
         */
        async fetchBranding() {
            try {
                const resp = await fetch('/api/admin/branding');
                const result = await resp.json();
                if (result.success && result.branding) {
                    this._brandingData = result.branding;
                    sessionStorage.setItem('branding_cache', JSON.stringify(result.branding));
                    return result.branding;
                }
            } catch (e) {
                console.warn('브랜딩 API 호출 실패, 기본값 사용:', e.message);
            }
            return this.getBranding();
        },

        /**
         * 사이드바 현재 페이지 활성화
         */
        highlightActiveSidebarItem() {
            const path = window.location.pathname;
            const pageName = path.substring(path.lastIndexOf('/') + 1) || 'dashboard.html';

            const links = document.querySelectorAll('.sidebar .nav-item');
            links.forEach(link => {
                const href = link.getAttribute('href');
                if (!href || href === '#') return;
                if (href === pageName) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        },

        /**
         * 사이드바 헤더 HTML 생성
         */
        generateSidebarHeader(isCompact = false) {
            const branding = this.getBranding();

            return `
            <div class="logo branded-header" style="text-align: center; padding: 15px 10px; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.1);">
                <img src="${branding.LOGO_PATH}"
                     alt="${branding.COMPANY_NAME} 로고"
                     style="width: 120px; height: auto; display: block; margin: 0 auto;"
                     onerror="this.style.display='none'">
            </div>
        `;
        },

        /**
         * 기존 사이드바 헤더를 브랜딩 헤더로 교체
         */
        applySidebarBranding() {
            const sidebar = document.querySelector('.sidebar, nav.sidebar, .left-panel');

            if (!sidebar) {
                console.warn('사이드바를 찾을 수 없습니다.');
                return;
            }

            if (sidebar.querySelector('.branded-header')) {
                // 이미 존재하면 로고만 업데이트
                const branding = this.getBranding();
                const img = sidebar.querySelector('.branded-header img');
                if (img) img.src = branding.LOGO_PATH;
                return;
            }

            const isAdminPage = document.title.includes('관리자') ||
                window.location.pathname.includes('admin') ||
                document.querySelector('.admin-dashboard');

            const headerSelectors = [
                '.sidebar-header',
                '.sidebar .logo',
                '.sidebar h1:first-child',
                '.sidebar h2:first-child',
                'nav.sidebar > div:first-child',
                'nav.sidebar > h1:first-child',
                'nav.sidebar > h2:first-child',
                '.left-panel h2:first-child',
                '.logo h1',
                'h1:first-child'
            ];

            let headerElement = null;
            for (const selector of headerSelectors) {
                headerElement = sidebar.querySelector(selector.replace('.sidebar ', '').replace('nav.sidebar > ', ''));
                if (headerElement) break;
            }

            if (headerElement) {
                headerElement.outerHTML = this.generateSidebarHeader(isAdminPage);
            } else {
                sidebar.insertAdjacentHTML('afterbegin', this.generateSidebarHeader(isAdminPage));
            }
        },

        /**
         * 브라우저 타이틀 업데이트
         */
        updatePageTitle(pageTitle = '') {
            const branding = this.getBranding();
            const fullTitle = pageTitle
                ? `${pageTitle} - ${branding.COMPANY_NAME} ${branding.SYSTEM_NAME}`
                : `${branding.COMPANY_NAME} ${branding.SYSTEM_NAME}`;

            document.title = fullTitle;
        },

        /**
         * CSS 커스텀 속성으로 브랜딩 색상 적용
         */
        applyBrandingColors() {
            const branding = this.getBranding();
            if (!branding.COLORS) return;
            const root = document.documentElement;
            const primary = branding.COLORS.PRIMARY || '#2a5298';
            const secondary = branding.COLORS.SECONDARY || '#667eea';
            root.style.setProperty('--brand-primary', primary);
            root.style.setProperty('--brand-secondary', secondary);
        },

        /**
         * 두 색상을 비율로 블렌드 (ratio=0이면 c1, ratio=1이면 c2)
         */
        /**
         * 색상을 밝게 (white 방향으로 블렌드)
         */
        _lightenColor(hex, amount) {
            hex = hex.replace('#', '');
            const r = Math.min(255, Math.round(parseInt(hex.substring(0, 2), 16) + (255 - parseInt(hex.substring(0, 2), 16)) * amount));
            const g = Math.min(255, Math.round(parseInt(hex.substring(2, 4), 16) + (255 - parseInt(hex.substring(2, 4), 16)) * amount));
            const b = Math.min(255, Math.round(parseInt(hex.substring(4, 6), 16) + (255 - parseInt(hex.substring(4, 6), 16)) * amount));
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        },

        _blendColors(c1, c2, ratio) {
            c1 = c1.replace('#', '');
            c2 = c2.replace('#', '');
            const r = Math.round(parseInt(c1.substring(0, 2), 16) * (1 - ratio) + parseInt(c2.substring(0, 2), 16) * ratio);
            const g = Math.round(parseInt(c1.substring(2, 4), 16) * (1 - ratio) + parseInt(c2.substring(2, 4), 16) * ratio);
            const b = Math.round(parseInt(c1.substring(4, 6), 16) * (1 - ratio) + parseInt(c2.substring(4, 6), 16) * ratio);
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        },

        /**
         * 전체 브랜딩 적용 (API 우선, 캐시 즉시 적용)
         */
        applyBranding(pageTitle = '') {
            const apply = () => {
                this.applySidebarBranding();
                this.updatePageTitle(pageTitle);
                this.applyBrandingColors();
                this.highlightActiveSidebarItem();
            };

            // 즉시 캐시/기본값으로 적용
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => apply());
            } else {
                apply();
            }

            // 비동기로 API에서 최신 데이터 가져와서 재적용
            this.fetchBranding().then(() => {
                if (document.readyState !== 'loading') {
                    apply();
                }
            });
        },

        /**
         * 개발자 도구용 브랜딩 정보 출력
         */
        debugBranding() {
            console.log('브랜딩 정보:', this.getBranding());
            console.log('페이지 제목:', document.title);
        }
    };

    window.debugBranding = () => BrandingManager.debugBranding();
}

// 자동 브랜딩 적용 (페이지 로드시)
BrandingManager.applyBranding();
