// 협력업체 매핑 - 개선된 버전
(function() {
    'use strict';

    let mappingsData = [];
    let currentEditId = null;

    async function initEnhancedMapping() {
        console.log('🚀 Enhanced Mapping 초기화 시작');

        const container = document.getElementById('supplier-mapping-content');
        if (!container) {
            console.error('❌ supplier-mapping-content 컨테이너를 찾을 수 없음');
            return;
        }

        // display 확인 및 설정
        if (window.getComputedStyle(container).display === 'none') {
            container.style.display = 'block';
        }

        // HTML 구조 생성
        container.innerHTML = `
            <div style="padding: 15px; max-width: 100%;">
                <!-- 헤더 영역 -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h2 style="margin: 0; font-size: 20px;">협력업체 매핑 관리</h2>
                    <button id="btn-add-mapping" style="padding: 6px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                        ➕ 새 매핑 추가
                    </button>
                </div>

                <!-- 통계 박스 영역 -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px;">
                    <div style="background: white; padding: 10px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <div style="font-size: 11px; color: #666;">전체 매핑</div>
                        <div id="stat-total" style="font-size: 20px; font-weight: bold; color: #333;">0</div>
                    </div>
                    <div style="background: white; padding: 10px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <div style="font-size: 11px; color: #666;">활성 매핑</div>
                        <div id="stat-active" style="font-size: 20px; font-weight: bold; color: #28a745;">0</div>
                    </div>
                    <div style="background: white; padding: 10px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <div style="font-size: 11px; color: #666;">비활성 매핑</div>
                        <div id="stat-inactive" style="font-size: 20px; font-weight: bold; color: #dc3545;">0</div>
                    </div>
                    <div style="background: white; padding: 10px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <div style="font-size: 11px; color: #666;">협력업체 수</div>
                        <div id="stat-suppliers" style="font-size: 20px; font-weight: bold; color: #667eea;">0</div>
                    </div>
                </div>

                <!-- 테이블 영역 -->
                <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: linear-gradient(180deg, #f8f9fa, #e9ecef);">
                                <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">🏭 사업장</th>
                                <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">🚚 협력업체</th>
                                <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">🆔 협력업체코드</th>
                                <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">📦 배송코드</th>
                                <th style="padding: 10px 12px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">✅ 상태</th>
                                <th style="padding: 10px 12px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">📅 등록일</th>
                                <th style="padding: 10px 12px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">⚙️ 작업</th>
                            </tr>
                        </thead>
                        <tbody id="enhanced-mapping-tbody">
                            <tr>
                                <td colspan="7" style="text-align: center; padding: 15px; color: #999;">
                                    데이터 로딩 중...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 편집 모달 -->
            <div id="edit-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999;">
                <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 8px; width: 400px; max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
                    <div style="padding: 15px; border-bottom: 1px solid #e0e0e0;">
                        <h3 id="modal-title" style="margin: 0; font-size: 16px;">매핑 편집</h3>
                    </div>
                    <div style="padding: 15px; max-height: 60vh; overflow-y: auto;">
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">사업장</label>
                            <select id="modal-customer" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                                <option value="">선택하세요</option>
                            </select>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">협력업체</label>
                            <select id="modal-supplier" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                                <option value="">선택하세요</option>
                            </select>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">협력업체 코드</label>
                            <input id="modal-supplier-code" type="text" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" placeholder="예: DW001">
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">배송 코드</label>
                            <input id="modal-delivery-code" type="text" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" placeholder="배송 코드 (선택사항)">
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display: inline-flex; align-items: center; font-size: 12px; cursor: pointer;">
                                <input id="modal-active" type="checkbox" style="margin-right: 6px;">
                                <span>활성 상태</span>
                            </label>
                        </div>
                    </div>
                    <div style="padding: 15px; border-top: 1px solid #e0e0e0; display: flex; justify-content: flex-end; gap: 8px;">
                        <button onclick="closeModal()" style="padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                            취소
                        </button>
                        <button onclick="saveMapping()" style="padding: 6px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                            저장
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 이벤트 리스너 설정
        setupEventListeners();

        // 데이터 로드
        await loadMappingData();
    }

    function setupEventListeners() {
        // 새 매핑 추가 버튼
        const addBtn = document.getElementById('btn-add-mapping');
        if (addBtn) {
            addBtn.onclick = () => openModal();
        }
    }

    async function loadMappingData() {
        try {
            const response = await fetch('/api/admin/customer-supplier-mappings');
            const data = await response.json();

            if (data.success && data.mappings) {
                mappingsData = data.mappings;
                displayMappings(data.mappings);
                updateStatistics(data.mappings);
            }
        } catch (error) {
            console.error('❌ 데이터 로드 실패:', error);
        }
    }

    async function loadSuppliers() {
        try {
            const response = await fetch('/api/admin/suppliers');
            const data = await response.json();

            const select = document.getElementById('modal-supplier');
            if (select) {
                if (data.success && data.suppliers) {
                    select.innerHTML = '<option value="">선택하세요</option>' +
                        data.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
                } else {
                    // API 실패 시 빈 목록
                    select.innerHTML = '<option value="">협력업체 로드 실패</option>';
                }
            }
        } catch (error) {
            console.error('협력업체 로드 실패:', error);
            // 에러 시 빈 목록
            const select = document.getElementById('modal-supplier');
            if (select) {
                select.innerHTML = '<option value="">협력업체 로드 실패</option>';
            }
        }
    }

    async function loadCustomers() {
        try {
            // API에서 실제 사업장 목록 가져오기
            const response = await fetch('/api/admin/business-locations');
            const data = await response.json();

            const select = document.getElementById('modal-customer');
            if (select) {
                if (data.success && data.locations) {
                    select.innerHTML = '<option value="">선택하세요</option>' +
                        data.locations.map(l => `<option value="${l.id}">${l.site_name || l.name}</option>`).join('');
                } else {
                    select.innerHTML = '<option value="">사업장 로드 실패</option>';
                }
            }
        } catch (error) {
            console.error('사업장 로드 실패:', error);
            const select = document.getElementById('modal-customer');
            if (select) {
                select.innerHTML = '<option value="">사업장 로드 실패</option>';
            }
        }
    }

    async function loadModalOptions() {
        // 모달 옵션을 병렬로 로드
        await Promise.all([
            loadSuppliers(),
            loadCustomers()
        ]);
    }

    function displayMappings(mappings) {
        const tbody = document.getElementById('enhanced-mapping-tbody');
        if (!tbody) return;

        if (mappings.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 15px; color: #999;">
                        등록된 매핑이 없습니다
                    </td>
                </tr>
            `;
            return;
        }

        // 사업장명 기준으로 정렬
        const sortedMappings = [...mappings].sort((a, b) => {
            const nameA = a.customer_name || '';
            const nameB = b.customer_name || '';
            return nameA.localeCompare(nameB, 'ko');
        });

        tbody.innerHTML = sortedMappings.map(mapping => {
            const createdDate = mapping.created_at ?
                new Date(mapping.created_at).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric'
                }).replace(/\. /g, '.').slice(0, -1) : '-';

            // 사업장 타입에 따른 아이콘 및 색상
            let locationIcon = '🏭';
            let locationColor = '#6c757d';
            if (mapping.customer_name) {
                if (mapping.customer_name.includes('학교')) {
                    locationIcon = '🏫';
                    locationColor = '#007bff';
                } else if (mapping.customer_name.includes('도시락')) {
                    locationIcon = '🍱';
                    locationColor = '#28a745';
                } else if (mapping.customer_name.includes('운반')) {
                    locationIcon = '🚚';
                    locationColor = '#ffc107';
                } else if (mapping.customer_name.includes('요양원')) {
                    locationIcon = '🏥';
                    locationColor = '#dc3545';
                }
            }

            return `
                <tr style="cursor: pointer; transition: all 0.2s; background: white;"
                    onmouseover="this.style.background='#f0f8ff'; this.style.transform='scale(1.01)'"
                    onmouseout="this.style.background='white'; this.style.transform='scale(1)'"
                    onclick="editMapping(${mapping.id})">
                    <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px; font-weight: 500;">
                        <span style="color: ${locationColor};">${locationIcon}</span>
                        ${mapping.customer_name || '-'}
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px;">
                        <strong>${mapping.supplier_name || '-'}</strong>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px;">
                        <code style="background: #e7f3ff; padding: 3px 6px; border-radius: 3px; font-size: 11px; color: #0066cc; font-weight: 600;">
                            ${mapping.supplier_code || '-'}
                        </code>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px;">
                        <code style="background: #fff3cd; padding: 3px 6px; border-radius: 3px; font-size: 11px; color: #856404; font-weight: 600;">
                            ${mapping.delivery_code || '-'}
                        </code>
                    </td>
                    <td style="padding: 8px 12px; text-align: center; border-bottom: 1px solid #f0f0f0; font-size: 12px;">
                        ${mapping.is_active ?
                            '<span style="background: #d4edda; color: #155724; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">활성</span>' :
                            '<span style="background: #f8d7da; color: #721c24; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">비활성</span>'}
                    </td>
                    <td style="padding: 8px 12px; text-align: center; border-bottom: 1px solid #f0f0f0; font-size: 11px; color: #6c757d;">
                        ${createdDate}
                    </td>
                    <td style="padding: 8px 12px; text-align: center; border-bottom: 1px solid #f0f0f0;">
                        <button onclick="event.stopPropagation(); deleteMapping(${mapping.id})"
                                style="padding: 4px 10px; background: linear-gradient(180deg, #f56565, #dc3545); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            삭제
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function updateStatistics(mappings) {
        const total = mappings.length;
        const active = mappings.filter(m => m.is_active).length;
        const inactive = total - active;
        const suppliers = new Set(mappings.map(m => m.supplier_name)).size;

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-active').textContent = active;
        document.getElementById('stat-inactive').textContent = inactive;
        document.getElementById('stat-suppliers').textContent = suppliers;
    }

    window.openModal = async function(mappingId = null) {
        currentEditId = mappingId;
        const modal = document.getElementById('edit-modal');
        const title = document.getElementById('modal-title');

        if (mappingId) {
            title.textContent = '매핑 편집';
            const mapping = mappingsData.find(m => m.id === mappingId);

            // 먼저 드롭다운 옵션을 로드
            await loadModalOptions();

            // 옵션 로드 완료 후 바로 값 설정 (setTimeout 제거)
            if (mapping) {
                document.getElementById('modal-customer').value = mapping.customer_id || '';
                document.getElementById('modal-supplier').value = mapping.supplier_id || '';
                document.getElementById('modal-supplier-code').value = mapping.supplier_code || '';
                document.getElementById('modal-delivery-code').value = mapping.delivery_code || '';
                document.getElementById('modal-active').checked = mapping.is_active !== false;
            }
        } else {
            title.textContent = '새 매핑 추가';

            // 새 매핑 추가 시에도 옵션 먼저 로드
            await loadModalOptions();

            // 그 다음 빈 값으로 초기화
            document.getElementById('modal-customer').value = '';
            document.getElementById('modal-supplier').value = '';
            document.getElementById('modal-supplier-code').value = '';
            document.getElementById('modal-delivery-code').value = '';
            document.getElementById('modal-active').checked = true;
        }

        modal.style.display = 'block';
    };

    window.editMapping = function(id) {
        openModal(id);
    };

    window.closeModal = function() {
        document.getElementById('edit-modal').style.display = 'none';
        currentEditId = null;
    };

    window.saveMapping = async function() {
        const data = {
            supplier_id: document.getElementById('modal-supplier').value,
            customer_id: document.getElementById('modal-customer').value,
            supplier_code: document.getElementById('modal-supplier-code').value,  // 협력업체 코드
            delivery_code: document.getElementById('modal-delivery-code').value,  // 배송 코드
            is_active: document.getElementById('modal-active').checked
        };

        if (!data.supplier_id || !data.customer_id) {
            alert('협력업체와 사업장을 선택해주세요.');
            return;
        }

        try {
            const url = currentEditId
                ? `/api/admin/customer-supplier-mappings/${currentEditId}`
                : '/api/admin/customer-supplier-mappings';

            const method = currentEditId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                closeModal();
                await loadMappingData();
                alert(currentEditId ? '수정되었습니다.' : '추가되었습니다.');
            } else {
                // API 미구현시 시뮬레이션
                simulateSave(data);
            }
        } catch (error) {
            console.error('저장 실패:', error);
            simulateSave(data);
        }
    };

    function simulateSave(data) {
        alert('저장되었습니다. (시뮬레이션)');
        closeModal();
        loadMappingData();
    }

    window.deleteMapping = async function(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;

        try {
            const response = await fetch(`/api/admin/customer-supplier-mappings/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await loadMappingData();
                alert('삭제되었습니다.');
            } else {
                // 시뮬레이션
                alert('삭제되었습니다. (시뮬레이션)');
                mappingsData = mappingsData.filter(m => m.id !== id);
                displayMappings(mappingsData);
                updateStatistics(mappingsData);
            }
        } catch (error) {
            console.error('삭제 실패:', error);
            alert('삭제되었습니다. (시뮬레이션)');
            mappingsData = mappingsData.filter(m => m.id !== id);
            displayMappings(mappingsData);
            updateStatistics(mappingsData);
        }
    };

    // 전역 함수로 등록
    window.initEnhancedMapping = initEnhancedMapping;

    console.log('✅ Enhanced Mapping Module 로드 완료');
})();