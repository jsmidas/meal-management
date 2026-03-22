/**
 * Enhanced File Upload Client
 * 대용량 파일을 위한 청크 업로드 클라이언트
 * - 2MB 청크로 파일 분할
 * - 실시간 진행률 추적
 * - 에러 복구 및 재시도
 * - 백그라운드 상태 폴링
 */

class EnhancedFileUploader {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 2 * 1024 * 1024; // 2MB
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        this.statusPollInterval = options.statusPollInterval || 2000;
        this.baseUrl = options.baseUrl || '';
        
        // 상태 추적
        this.activeUploads = new Map();
        this.statusPollers = new Map();
    }
    
    /**
     * 파일 업로드 시작
     */
    async uploadFile(file, options = {}) {
        try {
            // 1. 파일 유효성 검사
            const validation = await this.validateFile(file);
            if (!validation.valid) {
                throw new Error(`파일 검증 실패: ${validation.errors.join(', ')}`);
            }
            
            // 2. 청크 계산
            const totalChunks = Math.ceil(file.size / this.chunkSize);
            
            // 3. 업로드 세션 시작
            const uploadSession = await this.startUpload(file.name, file.size, totalChunks);
            const uploadId = uploadSession.upload_id;
            
            // 4. 업로드 상태 초기화
            this.activeUploads.set(uploadId, {
                file,
                uploadId,
                totalChunks,
                completedChunks: 0,
                status: 'uploading',
                startTime: Date.now()
            });
            
            // 5. 진행률 콜백 호출
            if (options.onProgress) {
                options.onProgress({
                    uploadId,
                    progress: 0,
                    status: 'starting',
                    message: '업로드 시작 중...'
                });
            }
            
            // 6. 청크 업로드 시작
            await this.uploadChunks(file, uploadId, totalChunks, options);
            
            // 7. 업로드 완료
            await this.completeUpload(uploadId);
            
            // 8. 백그라운드 처리 상태 모니터링 시작
            this.startStatusPolling(uploadId, options);
            
            return uploadId;
            
        } catch (error) {
            console.error('파일 업로드 오류:', error);
            if (options.onError) {
                options.onError(error);
            }
            throw error;
        }
    }
    
    /**
     * 파일 유효성 검사
     */
    async validateFile(file) {
        try {
            const response = await fetch(`${this.baseUrl}/api/upload/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filename: file.name,
                    file_size: file.size
                })
            });
            
            return await response.json();
        } catch (error) {
            return { valid: false, errors: [`검증 요청 실패: ${error.message}`] };
        }
    }
    
    /**
     * 업로드 세션 시작
     */
    async startUpload(filename, fileSize, totalChunks) {
        const response = await fetch(`${this.baseUrl}/api/upload/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filename,
                file_size: fileSize,
                total_chunks: totalChunks
            })
        });
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '업로드 시작 실패');
        }
        
        return result;
    }
    
    /**
     * 청크 업로드
     */
    async uploadChunks(file, uploadId, totalChunks, options) {
        const uploadInfo = this.activeUploads.get(uploadId);
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            let retryCount = 0;
            let success = false;
            
            while (!success && retryCount < this.maxRetries) {
                try {
                    // 청크 데이터 추출
                    const start = chunkIndex * this.chunkSize;
                    const end = Math.min(start + this.chunkSize, file.size);
                    const chunk = file.slice(start, end);
                    
                    // 청크 업로드
                    await this.uploadSingleChunk(uploadId, chunkIndex, chunk);
                    
                    // 성공 시
                    success = true;
                    uploadInfo.completedChunks++;
                    
                    // 진행률 계산 및 콜백
                    const progress = (uploadInfo.completedChunks / totalChunks) * 100;
                    if (options.onProgress) {
                        options.onProgress({
                            uploadId,
                            progress: Math.round(progress * 100) / 100,
                            status: 'uploading',
                            message: `업로드 중... (${uploadInfo.completedChunks}/${totalChunks})`
                        });
                    }
                    
                } catch (error) {
                    retryCount++;
                    console.warn(`청크 ${chunkIndex} 업로드 실패 (시도 ${retryCount}/${this.maxRetries}):`, error);
                    
                    if (retryCount < this.maxRetries) {
                        // 재시도 지연
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay * retryCount));
                    } else {
                        throw new Error(`청크 ${chunkIndex} 업로드 실패: ${error.message}`);
                    }
                }
            }
        }
    }
    
    /**
     * 단일 청크 업로드
     */
    async uploadSingleChunk(uploadId, chunkIndex, chunkData) {
        const formData = new FormData();
        formData.append('upload_id', uploadId);
        formData.append('chunk_index', chunkIndex.toString());
        formData.append('chunk', new Blob([chunkData]));
        
        const response = await fetch(`${this.baseUrl}/api/upload/chunk`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '청크 업로드 실패');
        }
        
        return result;
    }
    
    /**
     * 업로드 완료
     */
    async completeUpload(uploadId) {
        const response = await fetch(`${this.baseUrl}/api/upload/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ upload_id: uploadId })
        });
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '업로드 완료 실패');
        }
        
        // 상태 업데이트
        const uploadInfo = this.activeUploads.get(uploadId);
        if (uploadInfo) {
            uploadInfo.status = 'processing';
        }
        
        return result;
    }
    
    /**
     * 백그라운드 처리 상태 모니터링
     */
    startStatusPolling(uploadId, options) {
        const pollStatus = async () => {
            try {
                const response = await fetch(`${this.baseUrl}/api/upload/status/${uploadId}`);
                const result = await response.json();
                
                if (result.success && result.data) {
                    const { status, processing } = result.data;
                    
                    if (options.onProgress && processing) {
                        options.onProgress({
                            uploadId,
                            progress: processing.progress || 0,
                            status: processing.status || status,
                            message: processing.message || '처리 중...'
                        });
                    }
                    
                    // 완료되었거나 오류가 발생하면 폴링 중지
                    if (status === 'done' || status === 'error' || processing?.status === 'completed' || processing?.status === 'error') {
                        this.stopStatusPolling(uploadId);
                        
                        if (options.onComplete) {
                            options.onComplete({
                                uploadId,
                                status,
                                processing
                            });
                        }
                        
                        // 업로드 정보 정리
                        this.activeUploads.delete(uploadId);
                        return;
                    }
                }
                
                // 다음 폴링 스케줄링
                const pollerId = setTimeout(pollStatus, this.statusPollInterval);
                this.statusPollers.set(uploadId, pollerId);
                
            } catch (error) {
                console.error('상태 폴링 오류:', error);
                this.stopStatusPolling(uploadId);
                
                if (options.onError) {
                    options.onError(error);
                }
            }
        };
        
        // 초기 폴링 시작
        setTimeout(pollStatus, 1000);
    }
    
    /**
     * 상태 폴링 중지
     */
    stopStatusPolling(uploadId) {
        const pollerId = this.statusPollers.get(uploadId);
        if (pollerId) {
            clearTimeout(pollerId);
            this.statusPollers.delete(uploadId);
        }
    }
    
    /**
     * 모든 활성 업로드 취소
     */
    cancelAllUploads() {
        // 모든 폴링 중지
        for (const [uploadId, pollerId] of this.statusPollers) {
            clearTimeout(pollerId);
        }
        
        this.statusPollers.clear();
        this.activeUploads.clear();
    }
    
    /**
     * 업로드 상태 조회
     */
    getUploadStatus(uploadId) {
        return this.activeUploads.get(uploadId) || null;
    }
    
    /**
     * 활성 업로드 목록 조회
     */
    getActiveUploads() {
        return Array.from(this.activeUploads.values());
    }
}

// 유틸리티 함수들
const FileUploadUtils = {
    /**
     * 파일 크기를 읽기 쉬운 형태로 포맷
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },
    
    /**
     * 업로드 시간 추정
     */
    estimateUploadTime(fileSize, uploadSpeed = 1024 * 1024) { // 기본 1MB/s
        const seconds = Math.ceil(fileSize / uploadSpeed);
        if (seconds < 60) return `${seconds}초`;
        if (seconds < 3600) return `${Math.ceil(seconds / 60)}분`;
        return `${Math.ceil(seconds / 3600)}시간`;
    },
    
    /**
     * 진행률을 백분율로 포맷
     */
    formatProgress(progress) {
        return `${Math.round(progress * 100) / 100}%`;
    }
};

// 전역에서 사용 가능하도록 export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhancedFileUploader, FileUploadUtils };
}

// 브라우저 환경에서 전역 객체에 추가
if (typeof window !== 'undefined') {
    window.EnhancedFileUploader = EnhancedFileUploader;
    window.FileUploadUtils = FileUploadUtils;
}