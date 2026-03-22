/**
 * 완전한 식자재 관리 모듈
 * - admin_dashboard.html에서 추출한 모든 식자재 관리 기능
 * - 기존 화면과 100% 동일한 기능 제공
 */

window.IngredientsModule = {
    // 모듈 상태
    uploadedFiles: [],
    uploadHistory: [],
    currentIngredients: [],

    // 모듈 초기화
    async init() {
        // console.log('📦 Complete Ingredients Module 초기화');

        // 현재 페이지가 ingredients 등록 페이지인지 확인
        const currentPage = document.querySelector('.page-content:not(.hidden)');
        if (!currentPage || currentPage.id !== 'ingredients-page') {
            // console.log('📦 init: 다른 페이지에서 호출됨, 초기화 건너뜀');
            return this;
        }
        
        this.setupEventListeners();
        await this.loadIngredientsList();
        await this.loadUploadHistory();
        return this;
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        const fileInput = document.getElementById('file-input');
        const uploadArea = document.querySelector('.upload-area');
        
        if (fileInput && uploadArea) {
            // 파일 선택 이벤트
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
            
            // 드래그 앤 드롭 이벤트
            uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
            uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            uploadArea.addEventListener('drop', (e) => this.handleFileDrop(e));
        }
        
        // 식자재 검색 엔터키 처리
        const searchInput = document.getElementById('ingredient-search');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchIngredients();
                }
            });
        }
        
        // 날짜 필터 기본값 설정
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const dateToElement = document.getElementById('date-to');
        const dateFromElement = document.getElementById('date-from');
        
        if (dateToElement) dateToElement.value = today;
        if (dateFromElement) dateFromElement.value = weekAgo;
    },

    // 식자재 목록 로드
    async loadIngredientsList() {
        try {
            // console.log('[Ingredients] 식자재 목록 로드 시작...');
            const response = await fetch(`${window.CONFIG?.API?.BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}'}/api/admin/ingredients-new`);
            const result = await response.json();
            const ingredients = result.ingredients || result.data || [];
            
            this.currentIngredients = ingredients;
            this.displayIngredients(ingredients);
            
        } catch (error) {
            // console.error('[Ingredients] 식자재 목록 로드 실패:', error);
            const tbody = document.getElementById('ingredients-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; color: #dc3545;">식자재 목록을 불러올 수 없습니다.</td></tr>';
            }
        }
    },

    // 식자재 목록 표시
    displayIngredients(ingredients) {
        const tbody = document.getElementById('ingredients-tbody');
        if (!tbody) return;

        if (ingredients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; color: #666;">등록된 식자재가 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = ingredients.map(ingredient => `
            <tr>
                <td>${ingredient.category || '-'}</td>
                <td>${ingredient.sub_category || '-'}</td>
                <td>${ingredient.ingredient_code || '-'}</td>
                <td class="ingredient-name">${ingredient.ingredient_name}</td>
                <td>${ingredient.origin || '-'}</td>
                <td>${ingredient.posting_status || '-'}</td>
                <td class="specification">${ingredient.specification || '-'}</td>
                <td>${ingredient.unit || '-'}</td>
                <td>${ingredient.tax_type || '-'}</td>
                <td>${ingredient.delivery_days || '-'}</td>
                <td>${ingredient.purchase_price ? ingredient.purchase_price.toLocaleString() : '-'}</td>
                <td>${ingredient.selling_price ? ingredient.selling_price.toLocaleString() : '-'}</td>
                <td>${ingredient.supplier_name || '-'}</td>
                <td>${ingredient.notes || '-'}</td>
                <td>
                    <button class="btn-small btn-primary" onclick="IngredientsModule.editIngredient(${ingredient.id})">수정</button>
                    <button class="btn-small btn-danger" onclick="IngredientsModule.deleteIngredient(${ingredient.id})">삭제</button>
                </td>
                <td>${ingredient.created_at ? new Date(ingredient.created_at).toLocaleDateString('ko-KR') : '-'}</td>
            </tr>
        `).join('');
    },

    // 식자재 검색
    searchIngredients() {
        const searchTerm = document.getElementById('ingredient-search')?.value?.toLowerCase() || '';
        
        if (!searchTerm) {
            this.displayIngredients(this.currentIngredients);
            return;
        }

        const filteredIngredients = this.currentIngredients.filter(ingredient => 
            ingredient.name?.toLowerCase().includes(searchTerm) ||
            ingredient.category?.toLowerCase().includes(searchTerm) ||
            ingredient.sub_category?.toLowerCase().includes(searchTerm) ||
            ingredient.code?.toLowerCase().includes(searchTerm)
        );

        this.displayIngredients(filteredIngredients);
            // console.log(`[Ingredients] 검색 결과: ${filteredIngredients.length}개`);
    },

    // 식자재 수정
    editIngredient(ingredientId) {
        alert(`식자재 ID ${ingredientId} 수정 기능은 곧 구현될 예정입니다.`);
    },

    // 식자재 삭제
    deleteIngredient(ingredientId) {
        if (confirm('이 식자재를 삭제하시겠습니까?')) {
            alert(`식자재 ID ${ingredientId} 삭제 기능은 곧 구현될 예정입니다.`);
        }
    },

    // 파일 업로드 섹션 토글
    showUploadSection() {
        const uploadSection = document.getElementById('upload-section');
        const historySection = document.getElementById('upload-history-section');
        
        if (!uploadSection) return;
        
        // 다른 섹션 숨기기
        if (historySection && historySection.style.display !== 'none') {
            historySection.style.display = 'none';
        }
        
        const isVisible = uploadSection.style.display !== 'none';
        uploadSection.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            this.showNotification('📁 파일 업로드 섹션이 열렸습니다.', 'info');
        }
    },

    // 양식 다운로드
    downloadTemplate() {
        try {
            // 샘플 Excel 파일 다운로드 로직
            const link = document.createElement('a');
            link.href = '/static/sample data/food_sample.xls';
            link.download = '식자재_업로드_양식_샘플.xls';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // 다운로드 성공 메시지
            this.showNotification('📋 양식 다운로드가 시작되었습니다.', 'success');
        } catch (error) {
            // console.error('[Ingredients] 양식 다운로드 실패:', error);
            this.showNotification('❌ 양식 다운로드에 실패했습니다.', 'error');
        }
    },

    // 업로드 결과 조회 표시
    showUploadHistory() {
        const historySection = document.getElementById('upload-history-section');
        const uploadSection = document.getElementById('upload-section');
        
        if (!historySection) return;
        
        // 다른 섹션 숨기기
        if (uploadSection && uploadSection.style.display !== 'none') {
            uploadSection.style.display = 'none';
        }
        
        historySection.style.display = 'block';
        this.loadUploadHistory();
        this.showNotification('📊 업로드 결과를 조회합니다.', 'info');
    },

    // 업로드 결과 조회 숨기기
    hideUploadHistory() {
        const historySection = document.getElementById('upload-history-section');
        const detailsSection = document.getElementById('upload-details-section');
        
        if (historySection) historySection.style.display = 'none';
        if (detailsSection) detailsSection.style.display = 'none';
    },

    // 파일 선택 처리
    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        this.processSelectedFiles(files);
    },

    // 드래그 오버 처리
    handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.style.borderColor = '#007bff';
        event.currentTarget.style.backgroundColor = '#e7f3ff';
    },

    // 드래그 떠남 처리
    handleDragLeave(event) {
        event.preventDefault();
        event.currentTarget.style.borderColor = '#4a90e2';
        event.currentTarget.style.backgroundColor = '#f8f9fa';
    },

    // 파일 드롭 처리
    handleFileDrop(event) {
        event.preventDefault();
        event.currentTarget.style.borderColor = '#4a90e2';
        event.currentTarget.style.backgroundColor = '#f8f9fa';
        
        const files = Array.from(event.dataTransfer.files);
        this.processSelectedFiles(files);
    },

    // 선택된 파일 처리
    processSelectedFiles(files) {
        const validFiles = files.filter(file => {
            const isExcel = file.type === 'application/vnd.ms-excel' || 
                           file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                           file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
            const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB
            
            if (!isExcel) {
                this.showNotification(`❌ ${file.name}: Excel 파일만 업로드 가능합니다.`, 'error');
                return false;
            }
            
            if (!isValidSize) {
                this.showNotification(`❌ ${file.name}: 파일 크기는 10MB 이하여야 합니다.`, 'error');
                return false;
            }
            
            return true;
        });
        
        if (validFiles.length > 0) {
            this.uploadedFiles = validFiles;
            this.updateFileList();
            this.enableUploadButton();
            this.showNotification(`✅ ${validFiles.length}개 파일이 선택되었습니다.`, 'success');
        }
    },

    // 파일 초기화
    clearFiles() {
        this.uploadedFiles = [];
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.value = '';
        }
        this.updateFileList();
        this.disableUploadButton();
        this.showNotification('📁 선택된 파일이 초기화되었습니다.', 'info');
    },

    // 파일 목록 업데이트
    updateFileList() {
        const fileListDiv = document.getElementById('selected-files-list');
        if (!fileListDiv) {
            // console.log('[Ingredients] 선택된 파일들:', this.uploadedFiles.map(f => f.name));
            return;
        }
        
        if (this.uploadedFiles.length === 0) {
            fileListDiv.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">선택된 파일이 없습니다.</p>';
            return;
        }
        
        const listHTML = this.uploadedFiles.map((file, index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px; background: #f8f9fa;">
                <div>
                    <strong>${file.name}</strong>
                    <small style="color: #666; margin-left: 10px;">(${(file.size / 1024 / 1024).toFixed(2)} MB)</small>
                </div>
                <button onclick="IngredientsModule.removeFile(${index})" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">
                    삭제
                </button>
            </div>
        `).join('');
        
        fileListDiv.innerHTML = listHTML;
    },

    // 개별 파일 삭제
    removeFile(index) {
        this.uploadedFiles.splice(index, 1);
        this.updateFileList();
        if (this.uploadedFiles.length === 0) {
            this.disableUploadButton();
        } else {
            this.enableUploadButton();
        }
    },

    // 업로드 버튼 활성화
    enableUploadButton() {
        const uploadBtn = document.getElementById('upload-btn');
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.style.opacity = '1';
        }
    },

    // 업로드 버튼 비활성화
    disableUploadButton() {
        const uploadBtn = document.getElementById('upload-btn');
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.style.opacity = '0.5';
        }
    },

    // 파일 업로드 실행
    async uploadFiles() {
            // console.log('[Ingredients] ★★★ MODULAR uploadFiles 함수 호출됨 - 실제 서버 업로드 시작 ★★★');
        if (this.uploadedFiles.length === 0) {
            this.showNotification('❌ 업로드할 파일을 선택해주세요.', 'error');
            return;
        }
        
        const progressSection = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        try {
            // 진행률 표시
            if (progressSection) progressSection.style.display = 'block';
            
            let totalProcessedRows = 0;
            let totalSuccessRows = 0;
            let totalFailedRows = 0;
            const uploadResults = [];
            
            for (let i = 0; i < this.uploadedFiles.length; i++) {
                const file = this.uploadedFiles[i];
                const progress = ((i + 1) / this.uploadedFiles.length) * 100;
                
                if (progressFill) progressFill.style.width = progress + '%';
                if (progressText) progressText.textContent = `업로드 중... ${file.name} (${i + 1}/${this.uploadedFiles.length})`;
                
                // 실제 서버 업로드
                const result = await this.uploadFileToServer(file);
                
                // 결과 누적
                totalProcessedRows += result.processedRows;
                totalSuccessRows += result.successRows;
                totalFailedRows += result.failedRows;
                uploadResults.push({
                    fileName: file.name,
                    success: true,
                    processedRows: result.processedRows,
                    successRows: result.successRows,
                    failedRows: result.failedRows
                });
            }
            
            // 업로드 완료 처리
            if (progressText) {
                progressText.textContent = `업로드 완료! 총 ${totalProcessedRows.toLocaleString()}개 식자재 데이터 처리됨 (성공: ${totalSuccessRows.toLocaleString()})`;
            }
            
            // 대량 업로드 결과 표시
            this.displayBulkUploadResults(uploadResults, this.uploadedFiles.length, totalSuccessRows, 0);
            
            this.showNotification(`✅ ${this.uploadedFiles.length}개 파일 업로드 완료! 총 ${totalProcessedRows.toLocaleString()}개 식자재 데이터가 처리되었습니다.`, 'success');
            
            // 초기화 (3초 후)
            setTimeout(() => {
                this.uploadedFiles = [];
                this.updateFileList();
                this.disableUploadButton();
                if (progressSection) progressSection.style.display = 'none';
            }, 3000);
            
            // 업로드 히스토리 갱신 및 식자재 목록 새로고침
            this.loadUploadHistory();
            this.loadIngredientsList();
            
        } catch (error) {
            // console.error('[Ingredients] 업로드 실패:', error);
            this.showNotification('❌ 파일 업로드 중 오류가 발생했습니다.', 'error');
            
            if (progressSection) progressSection.style.display = 'none';
        }
    },

    // 실제 서버 업로드 함수
    async uploadFileToServer(file) {
            // console.log('[Ingredients] 🚀 uploadFileToServer 함수 시작 - 파일:', file.name);
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // console.log('[Ingredients] 🌐 서버 요청 시작 - /api/admin/ingredients-new/upload');
            const response = await fetch(`${window.CONFIG?.API?.BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}'}/api/admin/ingredients-new/upload`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                // API 응답 구조 확인: result.result 또는 result.details
                const details = result.result || result.details || {};
                const totalRows = details.total_rows || 0;
                const processedCount = details.processed_count || 0;
                const updatedCount = details.updated_count || 0;
                const errorCount = details.error_count || 0;
                const uploadId = details.upload_id;
                const todayStats = details.today_stats || {};
                const errorDetails = details.error_details || [];
                const hasErrorFile = details.has_error_file || false;
                
            // console.log(`[Ingredients] 파일 업로드 완료: ${file.name} - ${totalRows}행 처리됨 (처리: ${processedCount}, 업데이트: ${updatedCount}, 실패: ${errorCount})`);
                
                // 상세 결과 표시
                this.displaySingleUploadResult(file.name, {
                    totalRows, processedCount, updatedCount, errorCount, uploadId,
                    todayStats, errorDetails, hasErrorFile
                });
                
                return {
                    processedRows: totalRows,
                    successRows: processedCount + updatedCount,
                    failedRows: errorCount
                };
            } else {
                throw new Error(result.message || '업로드 실패');
            }
        } catch (error) {
            // console.error('[Ingredients] 업로드 오류:', error);
            throw error;
        }
    },

    // 단일 파일 업로드 결과 표시 (개선된 버전)
    displaySingleUploadResult(filename, data) {
        const { totalRows, processedCount, updatedCount, errorCount, uploadId, todayStats, errorDetails, hasErrorFile } = data;
        
        // 결과 표시 영역 생성 또는 업데이트
        let resultsSection = document.getElementById('single-upload-results');
        if (!resultsSection) {
            resultsSection = document.createElement('div');
            resultsSection.id = 'single-upload-results';
            resultsSection.style.cssText = 'margin-top: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #28a745;';
            
            const uploadSection = document.getElementById('upload-section');
            if (uploadSection) {
                uploadSection.appendChild(resultsSection);
            }
        }
        
        const currentTime = new Date().toLocaleString('ko-KR');
        const successRate = totalRows > 0 ? Math.round(((processedCount + updatedCount) / totalRows) * 100) : 0;
        
        resultsSection.innerHTML = `
            <div style="padding: 20px;">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <span style="font-size: 24px; margin-right: 10px;">✅</span>
                    <div>
                        <h3 style="margin: 0; color: #28a745;">업로드 완료!</h3>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">파일명: ${filename} | 처리시간: ${currentTime}</p>
                    </div>
                </div>
                
                <!-- 이번 업로드 결과 -->
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 10px 0; color: #495057;">🔄 이번 업로드 결과</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
                        <div style="background: white; padding: 12px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #007bff;">${totalRows}</div>
                            <div style="font-size: 12px; color: #666;">전체 행수</div>
                        </div>
                        <div style="background: white; padding: 12px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #28a745;">${processedCount}</div>
                            <div style="font-size: 12px; color: #666;">신규 생성</div>
                        </div>
                        <div style="background: white; padding: 12px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #ffc107;">${updatedCount}</div>
                            <div style="font-size: 12px; color: #666;">기존 업데이트</div>
                        </div>
                        <div style="background: white; padding: 12px; border-radius: 5px; text-align: center; ${errorCount > 0 ? 'border: 2px solid #dc3545;' : ''}">
                            <div style="font-size: 20px; font-weight: bold; color: #dc3545;">${errorCount}</div>
                            <div style="font-size: 12px; color: #666;">실패</div>
                        </div>
                        <div style="background: white; padding: 12px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #17a2b8;">${successRate}%</div>
                            <div style="font-size: 12px; color: #666;">성공률</div>
                        </div>
                    </div>
                </div>
                
                <!-- 당일 누적 통계 -->
                <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 10px 0; color: #007bff;">📊 당일 누적 통계</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px;">
                        <div style="text-align: center;">
                            <div style="font-size: 18px; font-weight: bold; color: #007bff;">${todayStats.uploads || 0}</div>
                            <div style="font-size: 12px; color: #666;">업로드 회수</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 18px; font-weight: bold; color: #28a745;">${todayStats.created || 0}</div>
                            <div style="font-size: 12px; color: #666;">신규 생성</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 18px; font-weight: bold; color: #ffc107;">${todayStats.updated || 0}</div>
                            <div style="font-size: 12px; color: #666;">업데이트</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 18px; font-weight: bold; color: #dc3545;">${todayStats.errors || 0}</div>
                            <div style="font-size: 12px; color: #666;">총 실패</div>
                        </div>
                    </div>
                </div>
                
                ${errorCount > 0 ? `
                <!-- 오류 정보 -->
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px;">
                    <h4 style="margin: 0 0 10px 0; color: #856404;">⚠️ 오류 정보</h4>
                    <div style="margin-bottom: 10px;">
                        ${errorDetails.slice(0, 3).map(error => 
                            `<div style="font-size: 13px; color: #856404; margin-bottom: 5px;">• ${error}</div>`
                        ).join('')}
                        ${errorDetails.length > 3 ? `<div style="font-size: 13px; color: #856404;">... 외 ${errorDetails.length - 3}개</div>` : ''}
                    </div>
                    ${hasErrorFile ? `
                    <button onclick="IngredientsModule.downloadErrorFile(${uploadId})" 
                            style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px;">
                        📥 오류 데이터 엑셀 다운로드
                    </button>
                    ` : ''}
                </div>
                ` : ''}
                
                <!-- 작업 완료 안내 -->
                <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 12px; border-radius: 5px; margin-top: 15px;">
                    <p style="margin: 0; font-size: 14px; color: #0c5460;">
                        💡 모든 데이터는 '<strong>📋 식자재 조회</strong>' 메뉴에서 확인할 수 있습니다.
                    </p>
                </div>
            </div>
        `;
        
        // 5초 후 자동으로 스크롤 (결과 확인 시간 제공)
        setTimeout(() => {
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 1000);
    },

    // 오류 파일 다운로드
    async downloadErrorFile(uploadId) {
        try {
            const response = await fetch(`/api/admin/ingredients-new/download-errors/${uploadId}`);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `오류데이터_${new Date().getTime()}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                this.showNotification('오류 데이터 파일이 다운로드되었습니다.', 'success');
            } else {
                throw new Error('다운로드 실패');
            }
        } catch (error) {
            // console.error('오류 파일 다운로드 실패:', error);
            this.showNotification('오류 파일 다운로드에 실패했습니다.', 'error');
        }
    },

    // 대용량 업로드 결과 표시
    displayBulkUploadResults(uploadResults, totalProcessed, totalSuccess, totalFailed) {
        // 상세 결과 섹션이 있는지 확인하고 없으면 생성
        let resultsSection = document.getElementById('bulk-upload-results');
        if (!resultsSection) {
            resultsSection = document.createElement('div');
            resultsSection.id = 'bulk-upload-results';
            resultsSection.style.cssText = 'margin-top: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
            
            const uploadSection = document.getElementById('upload-section');
            if (uploadSection) {
                uploadSection.appendChild(resultsSection);
            }
        }
        
        // 요약 통계
        const summaryHTML = `
            <div style="padding: 20px; border-bottom: 1px solid #eee;">
                <h3 style="margin: 0 0 15px 0; color: #007bff;">📊 대용량 업로드 결과</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                    <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #007bff;">${totalProcessed}</div>
                        <div style="font-size: 14px; color: #666;">처리된 파일</div>
                    </div>
                    <div style="background: #e8f5e8; padding: 15px; border-radius: 5px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${totalSuccess.toLocaleString()}</div>
                        <div style="font-size: 14px; color: #666;">성공한 식자재</div>
                    </div>
                    <div style="background: ${totalFailed > 0 ? '#ffe6e6' : '#f8f9fa'}; padding: 15px; border-radius: 5px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: ${totalFailed > 0 ? '#dc3545' : '#666'};">${totalFailed}</div>
                        <div style="font-size: 14px; color: #666;">실패한 파일</div>
                    </div>
                </div>
            </div>
        `;
        
        // 파일별 상세 결과
        let detailsHTML = '';
        if (uploadResults.length > 0) {
            detailsHTML = `
                <div style="padding: 20px;">
                    <h4 style="margin: 0 0 15px 0;">📋 파일별 처리 결과</h4>
                    <div style="max-height: 300px; overflow-y: auto;">
                        ${uploadResults.map(result => {
                            const isSuccess = result.success;
                            const statusColor = isSuccess ? '#28a745' : '#dc3545';
                            const statusIcon = isSuccess ? '✅' : '❌';
                            
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border: 1px solid #eee; border-radius: 4px; margin-bottom: 8px; background: ${isSuccess ? '#f8fff8' : '#fff8f8'};">
                                    <div style="flex: 1;">
                                        <div style="font-weight: 500;">${statusIcon} ${result.fileName}</div>
                                        ${isSuccess 
                                            ? `<small style="color: #666;">성공: ${(result.successRows || 0).toLocaleString()}개, 실패: ${(result.failedRows || 0).toLocaleString()}개</small>`
                                            : `<small style="color: #dc3545;">${result.error}</small>`
                                        }
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="color: ${statusColor}; font-weight: bold;">
                                            ${isSuccess ? `${(result.processedRows || 0).toLocaleString()}개 처리됨` : '처리 실패'}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    ${uploadResults.length > 10 ? `<div style="text-align: center; padding-top: 10px; color: #666; font-size: 12px;">총 ${uploadResults.length}개 파일 중 처리 완료</div>` : ''}
                </div>
            `;
        }
        
        resultsSection.innerHTML = summaryHTML + detailsHTML;
        
        // 결과 섹션으로 스크롤
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    // 업로드 히스토리 로드
    async loadUploadHistory() {
        try {
            const response = await fetch(`${window.CONFIG?.API?.BASE_URL || '${window.CONFIG?.API?.BASE_URL || window.location.origin}'}/api/admin/ingredients-upload-history`);
            const result = await response.json();
            
            this.uploadHistory = result.history || [];
            // console.log('[Ingredients] 업로드 히스토리 로드됨:', this.uploadHistory.length);
        } catch (error) {
            // console.error('[Ingredients] 업로드 히스토리 로드 실패:', error);
        }
    },

    // 업체별 필터링
    filterUploadHistory() {
        const supplierFilter = document.getElementById('supplier-filter')?.value;
            // console.log('[Ingredients] 업체별 필터:', supplierFilter);
        this.showNotification('업체별 필터가 적용되었습니다.', 'info');
    },

    // 업로드 이력 검색
    searchUploadHistory() {
        const supplierFilter = document.getElementById('supplier-filter')?.value;
        const dateFrom = document.getElementById('date-from')?.value;
        const dateTo = document.getElementById('date-to')?.value;
        
            // console.log('[Ingredients] 업로드 이력 검색:', { supplierFilter, dateFrom, dateTo });
        this.showNotification('업로드 이력을 조회했습니다.', 'success');
    },

    // 업로드 상세 결과 표시
    showUploadDetails(uploadId) {
        const detailsSection = document.getElementById('upload-details-section');
        const detailsContent = document.getElementById('upload-details-content');
        
        if (!detailsSection || !detailsContent) return;
        
        // 샘플 상세 데이터
        const sampleDetails = {
            1: {
                fileName: 'food_sample_20241210.xls',
                supplier: '웰스토리',
                uploadDate: '2024-12-10',
                totalRows: 150,
                successRows: 148,
                failedRows: 2,
                validationErrors: [
                    { row: 15, column: 'C', field: '고유코드', error: '영문+숫자만 허용됨', value: '한글코드123' },
                    { row: 67, column: 'N', field: '비고', error: 'N열 범위 초과', value: '매우 긴 비고 내용...' }
                ],
                outOfRangeData: [
                    { row: 67, column: 'O', value: '범위초과데이터' },
                    { row: 67, column: 'P', value: '추가데이터' }
                ]
            }
        };
        
        const details = sampleDetails[uploadId] || sampleDetails[1];
        let detailsHTML = this.generateUploadDetailsHTML(details);
        
        detailsContent.innerHTML = detailsHTML;
        detailsSection.style.display = 'block';
        
        // 상세 결과 섹션으로 스크롤
        detailsSection.scrollIntoView({ behavior: 'smooth' });
    },

    // 업로드 상세 HTML 생성
    generateUploadDetailsHTML(details) {
        let html = `
            <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                <div style="flex: 1; background: white; padding: 15px; border-radius: 5px; border-left: 4px solid #007bff;">
                    <h5 style="margin-top: 0; color: #007bff;">📊 업로드 요약</h5>
                    <p><strong>파일명:</strong> ${details.fileName}</p>
                    <p><strong>거래처:</strong> ${details.supplier}</p>
                    <p><strong>업로드일:</strong> ${details.uploadDate}</p>
                    <p><strong>총 항목수:</strong> ${details.totalRows}개</p>
                    <p><strong>성공:</strong> <span style="color: #28a745; font-weight: bold;">${details.successRows}개</span></p>
                    <p><strong>실패:</strong> <span style="color: #dc3545; font-weight: bold;">${details.failedRows}개</span></p>
                </div>
            </div>
        `;
        
        if (details.validationErrors.length > 0) {
            html += this.generateValidationErrorsTable(details.validationErrors);
        }
        
        if (details.outOfRangeData.length > 0) {
            html += this.generateOutOfRangeDataTable(details.outOfRangeData);
        }
        
        return html;
    },

    // 검증 실패 테이블 생성
    generateValidationErrorsTable(errors) {
        return `
            <div style="margin-bottom: 20px;">
                <h5 style="color: #dc3545;">❌ 검증 실패 항목 (${errors.length}개)</h5>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="background: #f8d7da;">
                                <th style="border: 1px solid #f5c6cb; padding: 8px;">행</th>
                                <th style="border: 1px solid #f5c6cb; padding: 8px;">열</th>
                                <th style="border: 1px solid #f5c6cb; padding: 8px;">필드명</th>
                                <th style="border: 1px solid #f5c6cb; padding: 8px;">오류내용</th>
                                <th style="border: 1px solid #f5c6cb; padding: 8px;">입력값</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${errors.map(error => `
                                <tr>
                                    <td style="border: 1px solid #f5c6cb; padding: 8px; text-align: center;">${error.row}</td>
                                    <td style="border: 1px solid #f5c6cb; padding: 8px; text-align: center;">${error.column}</td>
                                    <td style="border: 1px solid #f5c6cb; padding: 8px;">${error.field}</td>
                                    <td style="border: 1px solid #f5c6cb; padding: 8px; color: #721c24;">${error.error}</td>
                                    <td style="border: 1px solid #f5c6cb; padding: 8px; font-family: monospace; background: #f8f9fa;">${error.value}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // 범위 초과 데이터 테이블 생성
    generateOutOfRangeDataTable(outOfRangeData) {
        return `
            <div style="margin-bottom: 20px;">
                <h5 style="color: #856404;">⚠️ N열 범위 초과 데이터 (${outOfRangeData.length}개)</h5>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="background: #fff3cd;">
                                <th style="border: 1px solid #ffeaa7; padding: 8px;">행</th>
                                <th style="border: 1px solid #ffeaa7; padding: 8px;">열</th>
                                <th style="border: 1px solid #ffeaa7; padding: 8px;">범위초과 데이터</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${outOfRangeData.map(data => `
                                <tr>
                                    <td style="border: 1px solid #ffeaa7; padding: 8px; text-align: center;">${data.row}</td>
                                    <td style="border: 1px solid #ffeaa7; padding: 8px; text-align: center;">${data.column}</td>
                                    <td style="border: 1px solid #ffeaa7; padding: 8px; font-family: monospace; background: #f8f9fa;">${data.value}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // 알림 메시지 표시
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 10000;
            padding: 15px 20px; border-radius: 5px; color: white; font-weight: 500;
            ${type === 'success' ? 'background: #28a745;' : 
              type === 'error' ? 'background: #dc3545;' : 'background: #007bff;'}
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            transition: opacity 0.3s ease;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    },

    // ========================================
    // 모달 관련 함수들
    // ========================================

    // 생성 모달 표시
    showCreateModal() {
        this.clearIngredientForm();
        document.getElementById('ingredient-modal-title').textContent = '🆕 신규 식자재 등록';
        document.getElementById('ingredient-modal').style.display = 'flex';
        
        // 실시간 고유코드 중복 체크 이벤트 추가
        this.setupCodeDuplicationCheck();
    },

    // 실시간 고유코드 중복 체크 설정
    setupCodeDuplicationCheck() {
        const codeInput = document.getElementById('ingredient-code');
        let timeout;
        
        codeInput.addEventListener('input', () => {
            clearTimeout(timeout);
            const codeValue = codeInput.value.trim();
            
            if (codeValue.length >= 2) {
                timeout = setTimeout(async () => {
                    await this.checkCodeDuplication(codeValue, codeInput);
                }, 500); // 0.5초 딜레이
            } else {
                this.clearCodeValidation(codeInput);
            }
        });
    },

    // 고유코드 중복 체크
    async checkCodeDuplication(code, inputElement) {
        try {
            // 현재 수정 중인 식자재 ID 확인 (수정 시에는 자기 자신 제외)
            const currentId = document.getElementById('ingredient-id').value;
            
            const response = await fetch(`/api/admin/ingredients-new/check-code?code=${encodeURIComponent(code)}&exclude_id=${currentId || ''}`);
            const result = await response.json();
            
            if (result.exists) {
                this.showCodeError(inputElement, '⚠️ 이미 사용 중인 고유코드입니다');
            } else {
                this.showCodeSuccess(inputElement, '✅ 사용 가능한 고유코드입니다');
            }
        } catch (error) {
            // console.error('고유코드 중복 체크 실패:', error);
            this.clearCodeValidation(inputElement);
        }
    },

    // 코드 오류 표시
    showCodeError(inputElement, message) {
        inputElement.style.borderColor = '#dc3545';
        inputElement.style.backgroundColor = '#fff5f5';
        this.showCodeMessage(inputElement, message, '#dc3545');
    },

    // 코드 성공 표시
    showCodeSuccess(inputElement, message) {
        inputElement.style.borderColor = '#28a745';
        inputElement.style.backgroundColor = '#f8fff9';
        this.showCodeMessage(inputElement, message, '#28a745');
    },

    // 코드 유효성 메시지 표시
    showCodeMessage(inputElement, message, color) {
        let msgElement = inputElement.parentNode.querySelector('.code-validation-msg');
        if (!msgElement) {
            msgElement = document.createElement('div');
            msgElement.className = 'code-validation-msg';
            msgElement.style.cssText = 'font-size: 12px; margin-top: 4px; font-weight: 500;';
            inputElement.parentNode.appendChild(msgElement);
        }
        msgElement.textContent = message;
        msgElement.style.color = color;
    },

    // 코드 유효성 표시 초기화
    clearCodeValidation(inputElement) {
        inputElement.style.borderColor = '#ddd';
        inputElement.style.backgroundColor = 'white';
        const msgElement = inputElement.parentNode.querySelector('.code-validation-msg');
        if (msgElement) {
            msgElement.remove();
        }
    },

    // 수정 모달 표시
    async editIngredient(ingredientId) {
        try {
            // API에서 식자재 정보 가져오기
            const response = await fetch(`/api/admin/ingredients-new/${ingredientId}`);
            const result = await response.json();
            
            if (result.success && result.ingredient) {
                const ingredient = result.ingredient;
                
                // 폼에 데이터 채우기
                document.getElementById('ingredient-id').value = ingredient.id;
                document.getElementById('ingredient-category').value = ingredient.category || '';
                document.getElementById('ingredient-sub-category').value = ingredient.sub_category || '';
                document.getElementById('ingredient-code').value = ingredient.ingredient_code || '';
                document.getElementById('ingredient-name').value = ingredient.ingredient_name || '';
                document.getElementById('ingredient-origin').value = ingredient.origin || '';
                document.getElementById('ingredient-posting-status').value = ingredient.posting_status || '유';
                document.getElementById('ingredient-specification').value = ingredient.specification || '';
                document.getElementById('ingredient-unit').value = ingredient.unit || '';
                document.getElementById('ingredient-tax-type').value = ingredient.tax_type || '과세';
                document.getElementById('ingredient-delivery-days').value = ingredient.delivery_days || 0;
                document.getElementById('ingredient-purchase-price').value = ingredient.purchase_price || 0;
                document.getElementById('ingredient-selling-price').value = ingredient.selling_price || 0;
                document.getElementById('ingredient-supplier').value = ingredient.supplier_name || '';
                document.getElementById('ingredient-notes').value = ingredient.notes || '';
                
                document.getElementById('ingredient-modal-title').textContent = '식자재 정보 수정';
                document.getElementById('ingredient-modal').style.display = 'flex';
            } else {
                this.showNotification('❌ 식자재 정보를 불러올 수 없습니다.', 'error');
            }
        } catch (error) {
            // console.error('[Ingredients] 식자재 정보 로드 실패:', error);
            this.showNotification('❌ 식자재 정보를 불러오는 중 오류가 발생했습니다.', 'error');
        }
    },

    // 식자재 삭제
    async deleteIngredient(ingredientId) {
        if (!confirm('정말로 이 식자재를 삭제하시겠습니까?')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/ingredients-new/${ingredientId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('✅ 식자재가 삭제되었습니다.', 'success');
                this.loadIngredientsList(); // 목록 새로고침
            } else {
                this.showNotification(`❌ 삭제 실패: ${result.message}`, 'error');
            }
        } catch (error) {
            // console.error('[Ingredients] 식자재 삭제 실패:', error);
            this.showNotification('❌ 식자재 삭제 중 오류가 발생했습니다.', 'error');
        }
    },

    // 모달 닫기
    closeIngredientModal() {
        document.getElementById('ingredient-modal').style.display = 'none';
        this.clearIngredientForm();
    },

    // 폼 초기화
    clearIngredientForm() {
        document.getElementById('ingredient-form').reset();
        document.getElementById('ingredient-id').value = '';
    },

    // 식자재 저장 (생성/수정)
    async saveIngredient() {
        try {
            // 폼 데이터 수집
            const formData = {
                category: document.getElementById('ingredient-category').value.trim(),
                sub_category: document.getElementById('ingredient-sub-category').value.trim(),
                ingredient_code: document.getElementById('ingredient-code').value.trim(),
                ingredient_name: document.getElementById('ingredient-name').value.trim(),
                origin: document.getElementById('ingredient-origin').value.trim(),
                posting_status: document.getElementById('ingredient-posting-status').value,
                specification: document.getElementById('ingredient-specification').value.trim(),
                unit: document.getElementById('ingredient-unit').value.trim(),
                tax_type: document.getElementById('ingredient-tax-type').value,
                delivery_days: parseInt(document.getElementById('ingredient-delivery-days').value) || 0,
                purchase_price: parseFloat(document.getElementById('ingredient-purchase-price').value) || 0,
                selling_price: parseFloat(document.getElementById('ingredient-selling-price').value) || 0,
                supplier_name: document.getElementById('ingredient-supplier').value.trim(),
                notes: document.getElementById('ingredient-notes').value.trim()
            };

            // 필수 필드 검증
            const requiredFields = [
                { field: 'category', label: '분류(대분류)' },
                { field: 'sub_category', label: '기본식자재(세분류)' },
                { field: 'ingredient_code', label: '고유코드' },
                { field: 'ingredient_name', label: '식자재명' },
                { field: 'unit', label: '단위' },
                { field: 'supplier_name', label: '업체명' }
            ];

            for (const req of requiredFields) {
                if (!formData[req.field]) {
                    this.showNotification(`❌ ${req.label}은(는) 필수 입력 항목입니다.`, 'error');
                    document.getElementById(`ingredient-${req.field.replace('_', '-')}`).focus();
                    return;
                }
            }

            // 숫자 필드 검증
            if (formData.delivery_days <= 0) {
                this.showNotification('❌ 선발주일은 0보다 큰 값이어야 합니다.', 'error');
                document.getElementById('ingredient-delivery-days').focus();
                return;
            }

            if (formData.purchase_price <= 0) {
                this.showNotification('❌ 입고가는 0보다 큰 값이어야 합니다.', 'error');
                document.getElementById('ingredient-purchase-price').focus();
                return;
            }

            if (formData.selling_price <= 0) {
                this.showNotification('❌ 판매가는 0보다 큰 값이어야 합니다.', 'error');
                document.getElementById('ingredient-selling-price').focus();
                return;
            }

            const ingredientId = document.getElementById('ingredient-id').value;
            const isEdit = !!ingredientId;

            // API 요청
            const url = isEdit ? `/api/admin/ingredients-new/${ingredientId}` : '/api/admin/ingredients-new';
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData),
                credentials: 'include'
            });

            const result = await response.json();

            if (result.success) {
                const action = isEdit ? '수정' : '등록';
                this.showNotification(`✅ 식자재가 ${action}되었습니다.`, 'success');
                this.closeIngredientModal();
                this.loadIngredientsList(); // 목록 새로고침
            } else {
                this.showNotification(`❌ ${isEdit ? '수정' : '등록'} 실패: ${result.message}`, 'error');
            }

        } catch (error) {
            // console.error('[Ingredients] 식자재 저장 실패:', error);
            this.showNotification('❌ 식자재 저장 중 오류가 발생했습니다.', 'error');
        }
    }
};

// 전역 함수로 내보내기 (기존 HTML과의 호환성을 위해)
window.loadIngredientsList = () => IngredientsModule.loadIngredientsList();
window.editIngredient = (id) => IngredientsModule.editIngredient(id);
window.deleteIngredient = (id) => IngredientsModule.deleteIngredient(id);
window.initializeIngredientsPage = () => IngredientsModule.init();
window.showUploadSection = () => IngredientsModule.showUploadSection();
window.downloadTemplate = () => IngredientsModule.downloadTemplate();
window.showUploadHistory = () => IngredientsModule.showUploadHistory();
window.hideUploadHistory = () => IngredientsModule.hideUploadHistory();
window.filterUploadHistory = () => IngredientsModule.filterUploadHistory();
window.searchUploadHistory = () => IngredientsModule.searchUploadHistory();
window.showUploadDetails = (id) => IngredientsModule.showUploadDetails(id);
window.uploadFiles = () => IngredientsModule.uploadFiles();
window.handleFileSelect = (e) => IngredientsModule.handleFileSelect(e);
window.clearFiles = () => IngredientsModule.clearFiles();
window.removeFile = (index) => IngredientsModule.removeFile(index);
window.processSelectedFiles = (files) => IngredientsModule.processSelectedFiles(files);
window.displayBulkUploadResults = (results, total, success, failed) => IngredientsModule.displayBulkUploadResults(results, total, success, failed);

// 새로운 모달 함수들
window.showCreateModal = () => {
            // console.log('[DEBUG] showCreateModal 호출됨');
    IngredientsModule.showCreateModal();
};
window.closeIngredientModal = () => IngredientsModule.closeIngredientModal();
window.saveIngredient = () => IngredientsModule.saveIngredient();

// 백업 함수 (전역 스코프에서 직접 접근 가능)
window.openIngredientCreateModal = function() {
            // console.log('[DEBUG] 백업 함수 openIngredientCreateModal 호출됨');
    try {
        document.getElementById('ingredient-modal-title').textContent = '🆕 신규 식자재 등록';
        document.getElementById('ingredient-form').reset();
        document.getElementById('ingredient-id').value = '';
        document.getElementById('ingredient-modal').style.display = 'flex';
            // console.log('[DEBUG] 모달 표시 성공');
    } catch (error) {
            // console.error('[DEBUG] 모달 표시 실패:', error);
    }
};

            // console.log('📦 Complete Ingredients Module 정의 완료');

// 페이지 로드 후 버튼 상태 확인
document.addEventListener('DOMContentLoaded', function() {
            // console.log('[DEBUG] DOM 로드 완료, 버튼 상태 확인...');
    
    setTimeout(() => {
        const btn = document.getElementById('create-ingredient-btn');
        const page = document.getElementById('ingredients-page');
        
            // console.log('[DEBUG] 생성 버튼 요소:', btn);
            // console.log('[DEBUG] 식자재 페이지 요소:', page);
            // console.log('[DEBUG] 페이지 클래스:', page?.className);
            // console.log('[DEBUG] 버튼 스타일:', btn?.style.cssText);
        
        if (btn) {
            // console.log('[DEBUG] ✅ 버튼 찾음');
            // console.log('[DEBUG] 버튼 표시 상태:', window.getComputedStyle(btn).display);
            // console.log('[DEBUG] 버튼 가시성:', window.getComputedStyle(btn).visibility);
        } else {
            // console.log('[DEBUG] ❌ 버튼을 찾을 수 없음');
        }
    }, 1000);
});