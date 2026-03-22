// 빠른 g당 단가 기능 추가
function addQuickPricePerGramButton() {
    // 기존 버튼이 있으면 제거
    const existingBtn = document.getElementById('quick-price-per-gram-btn');
    if (existingBtn) existingBtn.remove();

    // 버튼 생성
    const button = document.createElement('button');
    button.id = 'quick-price-per-gram-btn';
    button.innerHTML = '📊 g당 단가 계산';
    button.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        border: none;
        padding: 12px 20px;
        border-radius: 25px;
        cursor: pointer;
        font-weight: 600;
        z-index: 1000;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        transition: all 0.3s;
    `;

    button.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    });

    button.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    });

    button.addEventListener('click', showPricePerGramModal);
    document.body.appendChild(button);
}

// 모달 표시
function showPricePerGramModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
    `;

    modal.innerHTML = `
        <div style="background: white; border-radius: 15px; padding: 30px; max-width: 600px; width: 90%; max-height: 80%; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <h2 style="margin: 0; color: #333;">📊 g당 단가 관리</h2>
                <button onclick="this.closest('[style*=\"position: fixed\"]').remove()" 
                        style="background: none; border: none; font-size: 24px; cursor: pointer; color: #999;">&times;</button>
            </div>
            
            <div id="price-stats-container" style="margin-bottom: 25px;">
                <div style="text-align: center; padding: 20px; color: #666;">
                    <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin: 10px 0 0 0;">통계 로딩 중...</p>
                </div>
            </div>
            
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button id="calculate-btn" onclick="calculatePricePerGram()" 
                        style="background: #28a745; color: white; border: none; padding: 12px 25px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    ⚡ g당 단가 계산
                </button>
                <button onclick="loadPriceStats()" 
                        style="background: #17a2b8; color: white; border: none; padding: 12px 25px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    🔄 통계 새로고침
                </button>
            </div>
            
            <div id="result-container" style="margin-top: 20px;"></div>
        </div>
    `;

    // CSS 애니메이션 추가
    if (!document.querySelector('#spin-animation')) {
        const style = document.createElement('style');
        style.id = 'spin-animation';
        style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }

    document.body.appendChild(modal);
    
    // 배경 클릭 시 닫기
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.remove();
    });

    // 통계 로드
    loadPriceStats();
}

// 통계 로드
async function loadPriceStats() {
    const container = document.getElementById('price-stats-container');
    if (!container) return;

    try {
        const response = await fetch('/price-per-gram-stats');
        const stats = await response.json();
        
        const coverage = stats.coverage_percentage;
        const coverageColor = coverage >= 80 ? '#28a745' : coverage >= 60 ? '#ffc107' : '#dc3545';

        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 10px; border-left: 4px solid #6c757d;">
                    <div style="font-size: 24px; font-weight: bold; color: #333;">${stats.total_ingredients.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #666;">전체 식자재</div>
                </div>
                <div style="text-align: center; padding: 15px; background: #f8fff9; border-radius: 10px; border-left: 4px solid ${coverageColor};">
                    <div style="font-size: 24px; font-weight: bold; color: ${coverageColor};">${stats.calculated_count.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #666;">계산 완료 (${coverage}%)</div>
                </div>
                <div style="text-align: center; padding: 15px; background: #fff5f5; border-radius: 10px; border-left: 4px solid #dc3545;">
                    <div style="font-size: 24px; font-weight: bold; color: #dc3545;">${(stats.total_ingredients - stats.calculated_count).toLocaleString()}</div>
                    <div style="font-size: 12px; color: #666;">미계산 항목</div>
                </div>
            </div>

            ${stats.highest_price ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="background: #fff5f5; padding: 15px; border-radius: 10px; border-left: 4px solid #dc3545;">
                        <h4 style="margin: 0 0 10px 0; color: #dc3545;">최고가 식자재</h4>
                        <div style="font-size: 14px; margin-bottom: 5px; font-weight: 600;">${stats.highest_price.ingredient_name}</div>
                        <div style="font-size: 18px; font-weight: bold; color: #dc3545;">${stats.highest_price.price_per_gram.toLocaleString()}원/g</div>
                        <div style="font-size: 12px; color: #666;">${stats.highest_price.specification}</div>
                    </div>
                    
                    <div style="background: #f8fff9; padding: 15px; border-radius: 10px; border-left: 4px solid #28a745;">
                        <h4 style="margin: 0 0 10px 0; color: #28a745;">최저가 식자재</h4>
                        <div style="font-size: 14px; margin-bottom: 5px; font-weight: 600;">${stats.lowest_price.ingredient_name}</div>
                        <div style="font-size: 18px; font-weight: bold; color: #28a745;">${stats.lowest_price.price_per_gram.toFixed(4)}원/g</div>
                        <div style="font-size: 12px; color: #666;">${stats.lowest_price.specification}</div>
                    </div>
                </div>
            ` : ''}
        `;
    } catch (error) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #dc3545;">
                ⚠️ 통계를 불러올 수 없습니다: ${error.message}
            </div>
        `;
    }
}

// g당 단가 계산
async function calculatePricePerGram() {
    const btn = document.getElementById('calculate-btn');
    const resultContainer = document.getElementById('result-container');
    
    if (!btn || !resultContainer) return;

    // 버튼 비활성화
    btn.disabled = true;
    btn.innerHTML = '⏳ 계산 중...';
    
    // 진행 상태 표시
    resultContainer.innerHTML = `
        <div style="background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 8px; padding: 20px; text-align: center;">
            <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 10px;"></div>
            g당 단가 계산 중... 잠시만 기다려주세요.
        </div>
    `;

    try {
        const response = await fetch('/calculate-price-per-gram', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            const successRate = ((result.calculated_count / result.total_ingredients) * 100).toFixed(1);
            
            resultContainer.innerHTML = `
                <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px;">
                    <h4 style="margin: 0 0 15px 0; color: #155724;">✅ 계산 완료!</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                        <div>전체: <strong>${result.total_ingredients.toLocaleString()}개</strong></div>
                        <div>성공: <strong style="color: #28a745;">${result.calculated_count.toLocaleString()}개</strong></div>
                        <div>새로 계산: <strong style="color: #17a2b8;">${result.new_calculated.toLocaleString()}개</strong></div>
                        <div>실패: <strong style="color: #dc3545;">${result.failed_count.toLocaleString()}개</strong></div>
                        <div>성공률: <strong style="color: ${successRate >= 80 ? '#28a745' : '#ffc107'};">${successRate}%</strong></div>
                    </div>
                    <p style="margin: 15px 0 0 0; font-style: italic; color: #666;">${result.message}</p>
                </div>
            `;
            
            // 통계 새로고침
            setTimeout(() => loadPriceStats(), 1000);
        } else {
            throw new Error(result.message || '계산에 실패했습니다.');
        }
    } catch (error) {
        resultContainer.innerHTML = `
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #721c24;">❌ 계산 실패</h4>
                <p style="margin: 0; color: #721c24;">${error.message}</p>
            </div>
        `;
    } finally {
        // 버튼 복원
        btn.disabled = false;
        btn.innerHTML = '⚡ g당 단가 계산';
    }
}

// 페이지 로드 시 자동 실행
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addQuickPricePerGramButton);
} else {
    addQuickPricePerGramButton();
}