// 보안 강화된 배치 계산 시스템

class SecureBatchCalculation {
    constructor() {
        this.isRunning = false;
        this.userRole = null;
        this.authToken = null;
    }

    // 1. 권한 확인
    async checkPermissions() {
        try {
            const response = await fetch('/api/auth/check-admin');
            const data = await response.json();

            if (!data.success || data.role !== 'admin') {
                this.showSecurityAlert('관리자 권한이 필요합니다.');
                return false;
            }

            this.userRole = data.role;
            this.authToken = data.token;
            return true;
        } catch (error) {
            this.showSecurityAlert('권한 확인 실패');
            return false;
        }
    }

    // 2. 보안 확인 모달
    showSecurityConfirmation() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'security-modal';
            modal.innerHTML = `
                <div class="security-modal-content">
                    <h3>⚠️ 중요한 작업 확인</h3>
                    <div class="security-warning">
                        <p><strong>전체 DB 배치 계산</strong>을 실행하시겠습니까?</p>
                        <ul style="text-align: left; margin: 10px 0;">
                            <li>📊 대상: 84,314개 전체 식자재</li>
                            <li>⏱️ 예상 시간: 30-60분</li>
                            <li>🚫 실행 중 취소 불가능</li>
                            <li>💾 DB 전체 업데이트</li>
                        </ul>
                        <p style="color: #dc3545; font-weight: bold;">
                            이 작업은 되돌릴 수 없습니다.
                        </p>
                    </div>

                    <div class="auth-input">
                        <label>관리자 비밀번호 확인:</label>
                        <input type="password" id="adminPassword" placeholder="비밀번호 입력">
                    </div>

                    <div class="modal-buttons">
                        <button class="btn-danger" onclick="this.confirmExecution()">
                            🚀 실행
                        </button>
                        <button class="btn-secondary" onclick="this.cancelExecution()">
                            ❌ 취소
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // 버튼 이벤트 처리
            modal.querySelector('.btn-danger').onclick = () => {
                const password = document.getElementById('adminPassword').value;
                if (this.validateAdminPassword(password)) {
                    document.body.removeChild(modal);
                    resolve(true);
                } else {
                    this.showSecurityAlert('비밀번호가 틀렸습니다.');
                }
            };

            modal.querySelector('.btn-secondary').onclick = () => {
                document.body.removeChild(modal);
                resolve(false);
            };
        });
    }

    // 3. 관리자 비밀번호 검증
    async validateAdminPassword(password) {
        try {
            const response = await fetch('/api/auth/validate-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, token: this.authToken })
            });

            const data = await response.json();
            return data.success;
        } catch (error) {
            return false;
        }
    }

    // 4. 보안 배치 계산 실행
    async executeSecureBatchCalculation() {
        // 권한 확인
        if (!(await this.checkPermissions())) {
            return;
        }

        // 이미 실행 중인지 확인
        if (this.isRunning) {
            this.showSecurityAlert('이미 배치 계산이 실행 중입니다.');
            return;
        }

        // 보안 확인
        const confirmed = await this.showSecurityConfirmation();
        if (!confirmed) {
            return;
        }

        // 실행
        this.isRunning = true;
        this.showSecurityAlert('배치 계산이 시작되었습니다.', 'info');

        try {
            const response = await fetch('/api/admin/secure-batch-calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    action: 'batch_calculate',
                    target: 'all_ingredients',
                    timestamp: new Date().toISOString()
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showSecurityAlert('배치 계산이 성공적으로 완료되었습니다.', 'success');
            } else {
                this.showSecurityAlert('배치 계산 실패: ' + data.message, 'error');
            }
        } catch (error) {
            this.showSecurityAlert('배치 계산 중 오류 발생', 'error');
        } finally {
            this.isRunning = false;
        }
    }

    // 5. 보안 알림
    showSecurityAlert(message, type = 'warning') {
        const alert = document.createElement('div');
        alert.className = `security-alert security-alert-${type}`;
        alert.innerHTML = `
            <div class="alert-content">
                <span class="alert-icon">
                    ${type === 'warning' ? '⚠️' :
                      type === 'error' ? '❌' :
                      type === 'success' ? '✅' : 'ℹ️'}
                </span>
                <span class="alert-message">${message}</span>
            </div>
        `;

        document.body.appendChild(alert);

        setTimeout(() => {
            if (document.body.contains(alert)) {
                document.body.removeChild(alert);
            }
        }, 5000);
    }
}

// 사용법
const secureBatch = new SecureBatchCalculation();

// Admin 대시보드에서만 호출
function adminBatchCalculate() {
    secureBatch.executeSecureBatchCalculation();
}