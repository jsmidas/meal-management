/**
 * 앱 모드 감지 및 적용
 * simple 모드: 카테고리/suffix UI 숨김
 * advanced 모드: 전체 기능 표시 (다함푸드)
 */
(function() {
    'use strict';

    window.APP_MODE = 'simple'; // 기본값
    window.APP_FEATURES = { categories: false, suffix: false, sibling_sync: false };

    function isSimpleMode() { return window.APP_MODE === 'simple'; }
    window.isSimpleMode = isSimpleMode;

    fetch('/api/app-config')
        .then(r => r.json())
        .then(config => {
            window.APP_MODE = config.mode || 'simple';
            window.APP_FEATURES = config.features || {};

            if (config.title) {
                document.title = document.title.replace(/다함푸드 급식관리|다함 식자재 관리 시스템/g, config.title);
            }

            if (isSimpleMode()) {
                document.body.classList.add('mode-simple');
            } else {
                document.body.classList.add('mode-advanced');
            }

            document.dispatchEvent(new CustomEvent('app-mode-ready', { detail: config }));
        })
        .catch(() => {
            document.body.classList.add('mode-simple');
        });
})();
