// 🕒 다함 식자재 관리 시스템 - 날짜/시간 유틸리티
// 시스템 전체에서 사용하는 견고한 날짜/시간 처리

class DateTimeUtils {
    constructor() {
        this.timezone = 'Asia/Seoul';
        this.locale = 'ko-KR';
        
        console.log('[DateTimeUtils] 초기화 완료');
    }

    /**
     * 현재 날짜/시간 반환 (한국 시간 기준)
     */
    now() {
        return new Date();
    }

    /**
     * 현재 날짜 문자열 반환 (YYYY-MM-DD 형식)
     */
    getCurrentDateString() {
        const now = this.now();
        return now.getFullYear() + '-' + 
               String(now.getMonth() + 1).padStart(2, '0') + '-' + 
               String(now.getDate()).padStart(2, '0');
    }

    /**
     * 현재 시간 문자열 반환 (HH:MM:SS 형식)
     */
    getCurrentTimeString() {
        const now = this.now();
        return String(now.getHours()).padStart(2, '0') + ':' + 
               String(now.getMinutes()).padStart(2, '0') + ':' + 
               String(now.getSeconds()).padStart(2, '0');
    }

    /**
     * 현재 날짜/시간 문자열 반환 (YYYY-MM-DD HH:MM:SS 형식)
     */
    getCurrentDateTimeString() {
        return this.getCurrentDateString() + ' ' + this.getCurrentTimeString();
    }

    /**
     * 한국어 형식의 날짜 문자열 반환
     * @param {Date} date - Date 객체 (선택사항, 기본값: 현재 날짜)
     * @returns {string} - "2025년 9월 13일 (금)" 형식
     */
    getKoreanDateString(date = null) {
        const targetDate = date || this.now();
        
        try {
            return targetDate.toLocaleDateString(this.locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
                timeZone: this.timezone
            });
        } catch (error) {
            console.warn('[DateTimeUtils] toLocaleDateString 실패, 대체 방법 사용:', error);
            return this.getKoreanDateStringFallback(targetDate);
        }
    }

    /**
     * 대체 한국어 날짜 형식 (브라우저 호환성)
     */
    getKoreanDateStringFallback(date) {
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekday = weekdays[date.getDay()];
        
        return `${year}년 ${month}월 ${day}일 (${weekday})`;
    }

    /**
     * 상대적 시간 문자열 반환
     * @param {Date} date - 기준 날짜
     * @returns {string} - "2분 전", "1시간 전" 등
     */
    getRelativeTimeString(date) {
        const now = this.now();
        const diffMs = now.getTime() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60) {
            return diffSec === 0 ? '방금 전' : `${diffSec}초 전`;
        } else if (diffMin < 60) {
            return `${diffMin}분 전`;
        } else if (diffHour < 24) {
            return `${diffHour}시간 전`;
        } else if (diffDay < 7) {
            return `${diffDay}일 전`;
        } else {
            return this.formatDate(date, 'YYYY-MM-DD');
        }
    }

    /**
     * 날짜 형식 지정
     * @param {Date} date - 형식을 지정할 날짜
     * @param {string} format - 형식 문자열
     * @returns {string} - 형식이 적용된 날짜 문자열
     */
    formatDate(date, format) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    /**
     * 문자열을 Date 객체로 안전하게 변환
     * @param {string} dateString - 날짜 문자열
     * @returns {Date|null} - Date 객체 또는 null (실패 시)
     */
    parseDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                console.warn(`[DateTimeUtils] 유효하지 않은 날짜 문자열: ${dateString}`);
                return null;
            }
            return date;
        } catch (error) {
            console.error(`[DateTimeUtils] 날짜 파싱 실패: ${dateString}`, error);
            return null;
        }
    }

    /**
     * 두 날짜 간의 차이 계산
     * @param {Date} date1 - 첫 번째 날짜
     * @param {Date} date2 - 두 번째 날짜
     * @returns {Object} - {days, hours, minutes, seconds}
     */
    getDateDifference(date1, date2) {
        const diffMs = Math.abs(date2.getTime() - date1.getTime());
        
        return {
            days: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
            hours: Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            minutes: Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)),
            seconds: Math.floor((diffMs % (1000 * 60)) / 1000),
            totalMs: diffMs
        };
    }

    /**
     * 날짜 유효성 검사
     * @param {Date} date - 검사할 날짜
     * @returns {boolean} - 유효한 날짜인지 여부
     */
    isValidDate(date) {
        return date instanceof Date && !isNaN(date.getTime());
    }

    /**
     * 실시간 날짜/시간 업데이트 시작
     * @param {string} elementId - 업데이트할 요소의 ID
     * @param {string} format - 표시 형식 ('korean', 'datetime', 'time')
     */
    startRealTimeUpdate(elementId, format = 'korean') {
        const updateElement = () => {
            const element = document.getElementById(elementId);
            if (!element) {
                console.warn(`[DateTimeUtils] 요소 ${elementId}를 찾을 수 없습니다`);
                return;
            }

            let displayText;
            switch (format) {
                case 'korean':
                    displayText = this.getKoreanDateString();
                    break;
                case 'datetime':
                    displayText = this.getCurrentDateTimeString();
                    break;
                case 'time':
                    displayText = this.getCurrentTimeString();
                    break;
                default:
                    displayText = this.getKoreanDateString();
            }

            element.textContent = displayText;
        };

        // 즉시 업데이트
        updateElement();
        
        // 1초마다 업데이트
        const intervalId = setInterval(updateElement, 1000);
        
        console.log(`[DateTimeUtils] 실시간 업데이트 시작: ${elementId} (${format})`);
        
        return intervalId;
    }

    /**
     * 캐시 만료 시간 계산
     * @param {number} minutes - 만료까지의 분 수
     * @returns {Date} - 만료 시간
     */
    getCacheExpirationTime(minutes = 5) {
        const expirationTime = new Date(this.now().getTime() + minutes * 60 * 1000);
        return expirationTime;
    }

    /**
     * 시간이 만료되었는지 확인
     * @param {Date} expirationTime - 만료 시간
     * @returns {boolean} - 만료 여부
     */
    isExpired(expirationTime) {
        return this.now() > expirationTime;
    }
}

// 전역 인스턴스 생성
window.DateTimeUtils = new DateTimeUtils();

console.log('🕒 [DateTimeUtils] 전역 유틸리티 준비 완료');