/**
 * 행사/특별식 지시서 공통 모듈
 * 조리지시서, 소분지시서, 전처리지시서에서 공용으로 사용
 */

const EventInstruction = (function() {
    'use strict';

    let _container = null;
    let _type = '';  // 'cooking', 'portion', 'preprocessing'

    // HTML 이스케이프 (XSS 방지)
    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // 숫자 포맷 (소수점 2자리)
    function fmtQty(val) {
        const n = parseFloat(val);
        if (isNaN(n)) return '0';
        return n % 1 === 0 ? n.toString() : n.toFixed(2);
    }

    /**
     * 초기화
     * @param {string} containerId - 렌더링할 컨테이너 ID
     * @param {string} type - 지시서 유형
     */
    function init(containerId, type) {
        _container = document.getElementById(containerId);
        _type = type || 'cooking';
    }

    /**
     * 행사 지시서 데이터 로드 및 렌더링
     * @param {string} usageDate - 행사일 (식단표 날짜)
     * @param {number} siteId - 사업장 ID
     */
    async function load(usageDate, siteId) {
        if (!_container) return;

        if (!usageDate) {
            _container.innerHTML = '';
            _container.style.display = 'none';
            return;
        }

        try {
            let url = `/api/event-orders/instructions?usage_date=${usageDate}`;
            if (siteId) url += `&site_id=${siteId}`;

            const res = await fetch(url);
            const data = await res.json();

            if (!data.success || !data.has_events || data.orders.length === 0) {
                _container.innerHTML = '';
                _container.style.display = 'none';
                return;
            }

            _container.style.display = 'block';
            render(data.orders);
        } catch (error) {
            console.error('[행사지시서] 로드 오류:', error);
            _container.innerHTML = '';
            _container.style.display = 'none';
        }
    }

    /**
     * 렌더링
     */
    function render(orders) {
        const typeLabels = {
            cooking: '조리지시서',
            portion: '소분지시서',
            preprocessing: '전처리지시서'
        };

        let html = `
            <div style="margin-top:30px;border-top:3px solid #f59e0b;padding-top:20px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                    <span style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:6px 14px;border-radius:8px;font-weight:700;font-size:0.95rem;">
                        <i class="fas fa-star"></i> 행사/특별식
                    </span>
                    <span style="color:#92400e;font-size:0.9rem;">
                        ${orders.length}건의 행사 발주서 (${typeLabels[_type] || '지시서'})
                    </span>
                </div>
        `;

        orders.forEach(order => {
            const totalAmount = order.menus.reduce((sum, m) => sum + (m.menu_total || 0), 0);

            html += `
                <div style="background:white;border:2px solid #fde68a;border-radius:12px;margin-bottom:20px;overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <strong style="font-size:1rem;color:#92400e;">
                                <i class="fas fa-calendar-star" style="margin-right:5px;"></i>
                                ${esc(order.template_name) || '행사'}
                            </strong>
                            <span style="color:#b45309;font-size:0.85rem;margin-left:10px;">
                                ${esc(order.site_name)} | ${order.attendees || '-'}명 | ${esc(order.order_number)}
                            </span>
                        </div>
                        <span style="font-weight:700;color:#d97706;font-size:1rem;">
                            ${Math.round(totalAmount).toLocaleString()}원
                        </span>
                    </div>
            `;

            order.menus.forEach(menu => {
                html += `
                    <div style="padding:0 16px;">
                        <div style="padding:10px 0;border-bottom:1px solid #fde68a;font-weight:600;color:#92400e;display:flex;justify-content:space-between;">
                            <span><i class="fas fa-utensils" style="margin-right:5px;color:#f59e0b;"></i>${esc(menu.menu_name)}</span>
                            <span style="color:#d97706;">${Math.round(menu.menu_total).toLocaleString()}원</span>
                        </div>
                        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                            <thead>
                                <tr style="background:#fffbeb;">
                                    <th style="padding:6px 8px;text-align:left;color:#92400e;font-weight:500;">식자재명</th>
                                    <th style="padding:6px 8px;text-align:left;color:#92400e;font-weight:500;">규격</th>
                                    <th style="padding:6px 8px;text-align:center;color:#92400e;font-weight:500;">단위</th>
                                    <th style="padding:6px 8px;text-align:right;color:#92400e;font-weight:500;">수량</th>
                                    <th style="padding:6px 8px;text-align:right;color:#92400e;font-weight:500;">단가</th>
                                    <th style="padding:6px 8px;text-align:right;color:#92400e;font-weight:500;">금액</th>
                                    <th style="padding:6px 8px;text-align:left;color:#92400e;font-weight:500;">협력업체</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                menu.ingredients.forEach(ing => {
                    html += `
                                <tr style="border-bottom:1px solid #fef3c7;">
                                    <td style="padding:5px 8px;">${esc(ing.ingredient_name)}</td>
                                    <td style="padding:5px 8px;color:#64748b;">${esc(ing.specification) || '-'}</td>
                                    <td style="padding:5px 8px;text-align:center;">${esc(ing.unit) || '-'}</td>
                                    <td style="padding:5px 8px;text-align:right;font-weight:600;color:#d97706;">${fmtQty(ing.required_qty)}</td>
                                    <td style="padding:5px 8px;text-align:right;">${Math.round(ing.unit_price || 0).toLocaleString()}</td>
                                    <td style="padding:5px 8px;text-align:right;">${Math.round(ing.total_price || 0).toLocaleString()}</td>
                                    <td style="padding:5px 8px;color:#64748b;">${esc(ing.supplier_name) || '-'}</td>
                                </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            });

            html += `</div>`;
        });

        html += `</div>`;
        _container.innerHTML = html;
    }

    return { init, load };
})();
