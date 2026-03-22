/**
 * 배치 상태 업데이트 모듈
 * admin_dashboard.html에서 분리됨
 */

// 배치 상태 업데이트 함수
async function updateBatchStatus() {
    try {
        const response = await fetch('/api/admin/batch-status');

        if (response.ok) {
            const data = await response.json();

            // 상태 표시 업데이트
            const total = data.total_ingredients || 84311;
            const processed = data.processed_count || 0;
            const accuracy = ((processed / total) * 100).toFixed(1);

            document.getElementById('batch-total-count').textContent = total.toLocaleString() + '개';
            document.getElementById('batch-processed-count').textContent = processed.toLocaleString() + '개';
            document.getElementById('batch-uncalculated-count').textContent = (total - processed).toLocaleString() + '개';
            document.getElementById('batch-accuracy-rate').textContent = accuracy + '%';

            // 진행 중이면 1초 후 다시 확인
            if (!data.is_completed && processed < total) {
                setTimeout(updateBatchStatus, 1000);
            }
        }
    } catch (error) {
        console.error('배치 상태 업데이트 실패:', error);
        // 실패해도 계속 시도
        setTimeout(updateBatchStatus, 3000);
    }
}

// 페이지 로드 시 배치 상태 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(updateBatchStatus, 2000);
});