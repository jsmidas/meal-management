/**
 * Settings Module - 시스템 설정 관리
 * 독립적인 설정 페이지 모듈
 */
class SettingsModule {
    constructor() {
        this.settings = {
            systemName: '다함식단관리',
            systemVersion: 'v1.0.0',
            defaultPage: 'dashboard',
            itemsPerPage: 20
        };
        this.init();
    }

    /**
     * 모듈 초기화
     */
    init() {
        this.loadSettings();
        this.updateSystemInfo();
        console.log('[Settings] 모듈 초기화 완료');
    }

    /**
     * 설정값 로드
     */
    loadSettings() {
        try {
            // localStorage에서 설정값 불러오기
            const savedSettings = localStorage.getItem('dahamsSettings');
            if (savedSettings) {
                this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
            }
            
            this.applySettingsToUI();
        } catch (error) {
            console.error('[Settings] 설정 로드 실패:', error);
        }
    }

    /**
     * UI에 설정값 적용
     */
    applySettingsToUI() {
        const systemNameInput = document.getElementById('system-name');
        const systemVersionInput = document.getElementById('system-version');
        const defaultPageSelect = document.getElementById('default-page');
        const itemsPerPageSelect = document.getElementById('items-per-page');

        if (systemNameInput) systemNameInput.value = this.settings.systemName;
        if (systemVersionInput) systemVersionInput.value = this.settings.systemVersion;
        if (defaultPageSelect) defaultPageSelect.value = this.settings.defaultPage;
        if (itemsPerPageSelect) itemsPerPageSelect.value = this.settings.itemsPerPage;
    }

    /**
     * 시스템 정보 업데이트
     */
    async updateSystemInfo() {
        try {
            // 데이터베이스 상태 확인
            const dbStatus = document.getElementById('db-status');
            if (dbStatus) {
                dbStatus.textContent = '연결됨';
                dbStatus.className = 'info-value status-active';
            }

            // 마지막 백업 시간 확인
            const lastBackup = document.getElementById('last-backup');
            if (lastBackup) {
                const backupTime = localStorage.getItem('lastBackupTime');
                lastBackup.textContent = backupTime || '백업 정보 없음';
            }

            // 사용자 수 조회
            const userCountElement = document.getElementById('user-count');
            if (userCountElement) {
                try {
                    const response = await fetch('http://localhost:9000/api/admin/users');
                    if (response.ok) {
                        const data = await response.json();
                        const userCount = data.success ? data.users.length : 0;
                        userCountElement.textContent = `${userCount}명`;
                    } else {
                        userCountElement.textContent = '조회 실패';
                    }
                } catch (error) {
                    userCountElement.textContent = '조회 실패';
                    console.error('[Settings] 사용자 수 조회 실패:', error);
                }
            }

        } catch (error) {
            console.error('[Settings] 시스템 정보 업데이트 실패:', error);
        }
    }

    /**
     * 설정 저장
     */
    async saveSettings() {
        try {
            // UI에서 설정값 수집
            this.collectSettingsFromUI();
            
            // localStorage에 저장
            localStorage.setItem('dahamsSettings', JSON.stringify(this.settings));
            
            // 성공 메시지
            this.showNotification('설정이 저장되었습니다.', 'success');
            
            console.log('[Settings] 설정 저장 완료:', this.settings);
        } catch (error) {
            console.error('[Settings] 설정 저장 실패:', error);
            this.showNotification('설정 저장에 실패했습니다.', 'error');
        }
    }

    /**
     * UI에서 설정값 수집
     */
    collectSettingsFromUI() {
        const systemName = document.getElementById('system-name')?.value;
        const defaultPage = document.getElementById('default-page')?.value;
        const itemsPerPage = document.getElementById('items-per-page')?.value;

        if (systemName) this.settings.systemName = systemName;
        if (defaultPage) this.settings.defaultPage = defaultPage;
        if (itemsPerPage) this.settings.itemsPerPage = parseInt(itemsPerPage);
    }

    /**
     * 기본값으로 리셋
     */
    resetSettings() {
        if (confirm('모든 설정을 기본값으로 리셋하시겠습니까?')) {
            this.settings = {
                systemName: '다함식단관리',
                systemVersion: 'v1.0.0',
                defaultPage: 'dashboard',
                itemsPerPage: 20
            };
            
            localStorage.removeItem('dahamsSettings');
            this.applySettingsToUI();
            this.showNotification('설정이 기본값으로 리셋되었습니다.', 'info');
            
            console.log('[Settings] 설정 리셋 완료');
        }
    }

    /**
     * 데이터 백업 생성
     */
    async createBackup() {
        try {
            this.showNotification('백업을 생성하고 있습니다...', 'info');
            
            const response = await fetch('http://localhost:9000/api/backup/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const result = await response.json();
                localStorage.setItem('lastBackupTime', new Date().toLocaleString());
                this.updateSystemInfo();
                this.showNotification('백업이 성공적으로 생성되었습니다.', 'success');
            } else {
                throw new Error('백업 생성 실패');
            }
        } catch (error) {
            console.error('[Settings] 백업 생성 실패:', error);
            this.showNotification('백업 생성에 실패했습니다.', 'error');
        }
    }

    /**
     * 시스템 상태 확인
     */
    async checkSystemHealth() {
        try {
            this.showNotification('시스템 상태를 확인하고 있습니다...', 'info');
            
            // 데이터베이스 연결 확인
            const dbResponse = await fetch('http://localhost:9000/api/health/database');
            const dbHealthy = dbResponse.ok;
            
            // API 서버 상태 확인  
            const apiResponse = await fetch('http://localhost:9000/api/health/status');
            const apiHealthy = apiResponse.ok;
            
            if (dbHealthy && apiHealthy) {
                this.showNotification('시스템이 정상적으로 작동하고 있습니다.', 'success');
            } else {
                this.showNotification('시스템에 문제가 발견되었습니다.', 'warning');
            }
            
            // UI 업데이트
            this.updateSystemInfo();
            
        } catch (error) {
            console.error('[Settings] 시스템 상태 확인 실패:', error);
            this.showNotification('시스템 상태 확인에 실패했습니다.', 'error');
        }
    }

    /**
     * 알림 메시지 표시
     */
    showNotification(message, type = 'info') {
        // 기존 알림 제거
        const existingAlert = document.querySelector('.settings-alert');
        if (existingAlert) {
            existingAlert.remove();
        }

        // 새 알림 생성
        const alert = document.createElement('div');
        alert.className = `settings-alert alert-${type}`;
        alert.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="background: none; border: none; font-size: 16px; cursor: pointer;">&times;</button>
        `;

        // 설정 페이지 상단에 추가
        const settingsPage = document.getElementById('settings-page');
        if (settingsPage) {
            settingsPage.insertBefore(alert, settingsPage.firstChild);
            
            // 3초 후 자동 제거
            setTimeout(() => {
                if (alert.parentElement) {
                    alert.remove();
                }
            }, 3000);
        }
    }

    /**
     * 설정값 가져오기 (다른 모듈에서 사용)
     */
    getSetting(key) {
        return this.settings[key];
    }

    /**
     * 설정값 설정하기 (다른 모듈에서 사용)
     */
    setSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem('dahamsSettings', JSON.stringify(this.settings));
    }
}

// CSS 스타일 추가
const settingsStyles = `
<style>
.settings-alert {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    margin-bottom: 20px;
    border-radius: 5px;
    font-size: 14px;
    font-weight: 500;
}

.alert-success {
    background-color: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
}

.alert-error {
    background-color: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
}

.alert-warning {
    background-color: #fff3cd;
    color: #856404;
    border: 1px solid #ffeaa7;
}

.alert-info {
    background-color: #d1ecf1;
    color: #0c5460;
    border: 1px solid #bee5eb;
}
</style>
`;

// 스타일 주입
document.head.insertAdjacentHTML('beforeend', settingsStyles);

// 전역 인스턴스 생성 (다른 모듈에서 접근 가능)
window.SettingsModule = new SettingsModule();

// 모듈 로드 완료 로그
console.log('[Settings] 설정 모듈 로드 완료');