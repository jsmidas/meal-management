/**
 * 커스텀 알림창 시스템
 * 브라우저 기본 alert/confirm을 대체하여 깔끔한 UI 제공
 */
(function() {
    'use strict';

    // 원본 함수 백업
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;

    // CSS 동적 로드 (아직 로드되지 않은 경우)
    function loadCSS() {
        if (!document.querySelector('link[href*="custom-alert.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/static/css/custom-alert.css?v=' + Date.now();
            document.head.appendChild(link);
        }
    }

    // 알림창 타입 감지
    function detectAlertType(message) {
        const msg = String(message).toLowerCase();
        if (msg.includes('성공') || msg.includes('완료') || msg.includes('저장되었') || msg.includes('✅')) {
            return 'success';
        }
        if (msg.includes('실패') || msg.includes('오류') || msg.includes('에러') || msg.includes('❌')) {
            return 'error';
        }
        if (msg.includes('주의') || msg.includes('경고') || msg.includes('⚠️')) {
            return 'warning';
        }
        return 'info';
    }

    // 알림창 생성
    function createAlertElement(message, type, isConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'custom-alert-overlay';

        const headerType = isConfirm ? 'confirm' : type;
        const headerText = isConfirm ? '확인' : '알림';

        overlay.innerHTML = `
            <div class="custom-alert-box">
                <div class="custom-alert-header ${headerType}">
                    <span class="custom-alert-icon">${headerText}</span>
                </div>
                <div class="custom-alert-body">${escapeHtml(String(message))}</div>
                <div class="custom-alert-footer">
                    ${isConfirm ? '<button class="custom-alert-btn custom-alert-btn-secondary" data-action="cancel">취소</button>' : ''}
                    <button class="custom-alert-btn custom-alert-btn-primary" data-action="ok">확인</button>
                </div>
            </div>
        `;

        return overlay;
    }

    // HTML 이스케이프
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/\n/g, '<br>');
    }

    // 알림창 표시
    function showCustomAlert(message, isConfirm) {
        return new Promise((resolve) => {
            loadCSS();

            const type = detectAlertType(message);
            const overlay = createAlertElement(message, type, isConfirm);

            document.body.appendChild(overlay);

            // 애니메이션을 위한 딜레이
            requestAnimationFrame(() => {
                overlay.classList.add('show');
            });

            // 버튼 이벤트
            const handleClick = (e) => {
                const action = e.target.dataset.action;
                if (action) {
                    closeAlert(overlay);
                    resolve(action === 'ok');
                }
            };

            // 키보드 이벤트
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    closeAlert(overlay);
                    resolve(true);
                } else if (e.key === 'Escape' && isConfirm) {
                    closeAlert(overlay);
                    resolve(false);
                } else if (e.key === 'Escape' && !isConfirm) {
                    closeAlert(overlay);
                    resolve(true);
                }
            };

            overlay.addEventListener('click', handleClick);
            document.addEventListener('keydown', handleKeydown, { once: true });

            // 확인 버튼에 포커스
            const okBtn = overlay.querySelector('[data-action="ok"]');
            if (okBtn) okBtn.focus();

            function closeAlert(el) {
                el.classList.remove('show');
                el.removeEventListener('click', handleClick);
                setTimeout(() => el.remove(), 200);
            }
        });
    }

    // window.alert 오버라이드
    window.alert = function(message) {
        // 동기적 동작을 위해 비동기 alert 실행
        showCustomAlert(message, false);
    };

    // window.confirm 오버라이드
    window.confirm = function(message) {
        // confirm은 동기적이어야 하므로 원본 사용하되, 커스텀 UI도 지원
        // 기존 코드 호환성을 위해 원본 confirm 사용
        // 비동기 confirm이 필요한 경우 window.customConfirm 사용
        return originalConfirm(message);
    };

    // 비동기 confirm (Promise 반환)
    window.customConfirm = function(message) {
        return showCustomAlert(message, true);
    };

    // 비동기 alert (Promise 반환)
    window.customAlert = function(message) {
        return showCustomAlert(message, false);
    };

    // showCustomAlert 글로벌 노출 (type 파라미터 지원)
    window.showCustomAlert = function(message, type) {
        return showCustomAlert(message, false);
    };

    // 초기화 로그
    console.log('[CustomAlert] 커스텀 알림창 시스템 초기화 완료');
})();
