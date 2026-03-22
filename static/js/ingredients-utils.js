// 식자재 관리 유틸리티 함수들

// 날짜 포맷팅 함수
function formatDate(dateString) {
    if (!dateString || dateString === '-') return '-';

    // SQLite datetime 문자열 처리
    // 35:09.0 같은 형식은 시간 부분만 잘못 파싱된 경우
    try {
        // ISO 형식으로 변환 시도
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('ko-KR');
        }
    } catch(e) {}

    // 날짜 문자열 그대로 반환 (변환 실패시)
    return dateString;
}

// 토스트 메시지 표시 함수
function showToast(message) {
    // 기존 토스트 제거
    const existingToast = document.querySelector('.toast-message');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #333;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
    `;

    // 애니메이션 CSS 추가
    if (!document.querySelector('#toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // 3초 후 자동 제거
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }
    }, 3000);
}

// 단위당 단가 계산 함수 (원본 유지)
function calculateUnitPrice(specification, unit, purchasePrice) {
    console.log('계산 시작:', { specification, unit, purchasePrice });
    try {
        // EA 패턴 처리
        if (unit === 'EA' || unit === 'ea') {
            // 숫자 EA 패턴 (예: "20EA")
            const numberedEaMatch = specification.match(/^(\d+)\s*EA$/i);
            if (numberedEaMatch) {
                const count = parseFloat(numberedEaMatch[1]);
                return {
                    success: true,
                    price: purchasePrice / count,
                    method: `입고가 ${purchasePrice}원 ÷ ${count}개 = ${(purchasePrice / count).toFixed(1)}원/개`
                };
            }

            // 단순 EA 패턴 (예: "EA")
            if (specification === 'EA' || specification === 'ea') {
                return {
                    success: true,
                    price: purchasePrice,
                    method: `EA 단위로 개당 ${purchasePrice}원`
                };
            }
        }

        // 개 단위 처리
        if (unit === '개') {
            const countMatch = specification.match(/(\d+)/);
            if (countMatch) {
                const count = parseFloat(countMatch[1]);
                return {
                    success: true,
                    price: purchasePrice / count,
                    method: `입고가 ${purchasePrice}원 ÷ ${count}개 = ${(purchasePrice / count).toFixed(1)}원/개`
                };
            } else {
                return {
                    success: true,
                    price: purchasePrice,
                    method: `개 단위로 개당 ${purchasePrice}원`
                };
            }
        }

        // kg 단위 처리
        if (unit === 'kg' || unit === 'KG') {
            const kgMatch = specification.match(/([0-9.]+)\s*kg/i);
            if (kgMatch) {
                const weight = parseFloat(kgMatch[1]);
                return {
                    success: true,
                    price: purchasePrice / (weight * 1000), // g당 가격
                    method: `입고가 ${purchasePrice}원 ÷ ${weight}kg (${weight * 1000}g) = ${(purchasePrice / (weight * 1000)).toFixed(1)}원/g`
                };
            }
        }

        // g 단위 처리
        if (unit === 'g' || unit === 'G') {
            const gMatch = specification.match(/([0-9.]+)\s*g/i);
            if (gMatch) {
                const weight = parseFloat(gMatch[1]);
                return {
                    success: true,
                    price: purchasePrice / weight,
                    method: `입고가 ${purchasePrice}원 ÷ ${weight}g = ${(purchasePrice / weight).toFixed(1)}원/g`
                };
            }
        }

        return {
            success: false,
            error: '자동 계산 패턴에 맞지 않음'
        };

    } catch (error) {
        return {
            success: false,
            error: `계산 오류: ${error.message}`
        };
    }
}

// 테이블 행에서 식자재 데이터 추출 함수
function extractIngredientFromTableRow(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 16) return null;

    return {
        id: row.dataset.id,
        category: cells[0].textContent.trim(),
        subcategory: cells[1].textContent.trim(),
        code: cells[2].textContent.trim(),
        name: cells[3].textContent.trim(),
        origin: cells[4].textContent.trim(),
        is_published: cells[5].textContent.trim(),
        specification: cells[6].textContent.trim(),
        unit: cells[7].textContent.trim(),
        tax_exempt: cells[8].textContent.trim(),
        procurement_days: cells[9].textContent.trim(),
        price_per_unit: cells[10].textContent.trim(),
        purchase_price: cells[11].textContent.trim(),
        sale_price: cells[12].textContent.trim(),
        supplier: cells[13].textContent.trim(),
        note: cells[14].textContent.trim(),
        registration_date: cells[15].textContent.trim()
    };
}