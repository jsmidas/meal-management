/**
 * 🏎️ DOM 관리자
 * 성능 최적화 및 메모리 누수 방지
 */

const DOMManager = (function() {
    'use strict';

    // 🗑️ 이벤트 리스너 추적
    const eventListeners = new WeakMap();
    const activeElements = new Set();

    // 🔄 Virtual DOM 캐시
    const virtualCache = new Map();

    // ⏱️ 렌더링 큐
    let renderQueue = [];
    let isRenderScheduled = false;

    // 🎯 Public API
    return {
        // 🏗️ 초기화
        init() {
            console.log('🏎️ DOMManager 초기화');
            this._setupMutationObserver();
            this._setupPerformanceMonitoring();
            console.log('✅ DOMManager 초기화 완료');
        },

        // 🎨 효율적인 요소 생성
        createElement(tag, options = {}) {
            const element = document.createElement(tag);

            // 속성 설정
            if (options.attributes) {
                Object.entries(options.attributes).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });
            }

            // 클래스 설정
            if (options.className) {
                element.className = options.className;
            }

            // 텍스트 내용 설정
            if (options.textContent) {
                element.textContent = options.textContent;
            }

            // innerHTML 설정 (보안 검증 후)
            if (options.innerHTML) {
                element.innerHTML = this._sanitizeHTML(options.innerHTML);
            }

            // 스타일 설정
            if (options.styles) {
                Object.assign(element.style, options.styles);
            }

            // 이벤트 리스너 설정
            if (options.events) {
                this.addEventListeners(element, options.events);
            }

            // 추적 대상에 추가
            activeElements.add(element);

            return element;
        },

        // 👂 이벤트 리스너 추가 (메모리 누수 방지)
        addEventListeners(element, events) {
            if (!eventListeners.has(element)) {
                eventListeners.set(element, []);
            }

            const listeners = eventListeners.get(element);

            Object.entries(events).forEach(([event, handler]) => {
                element.addEventListener(event, handler);
                listeners.push({ event, handler });
            });
        },

        // 🗑️ 이벤트 리스너 제거
        removeEventListeners(element) {
            if (eventListeners.has(element)) {
                const listeners = eventListeners.get(element);
                listeners.forEach(({ event, handler }) => {
                    element.removeEventListener(event, handler);
                });
                eventListeners.delete(element);
            }
        },

        // 🔄 배치 업데이트 (성능 최적화)
        batchUpdate(updates) {
            return new Promise((resolve) => {
                renderQueue.push(...updates);

                if (!isRenderScheduled) {
                    isRenderScheduled = true;
                    requestAnimationFrame(() => {
                        this._processBatchUpdates();
                        isRenderScheduled = false;
                        resolve();
                    });
                }
            });
        },

        // 📝 효율적인 텍스트 업데이트
        updateText(element, newText) {
            if (element.textContent !== newText) {
                element.textContent = newText;
            }
        },

        // 🎨 효율적인 HTML 업데이트
        updateHTML(element, newHTML) {
            const sanitizedHTML = this._sanitizeHTML(newHTML);
            if (element.innerHTML !== sanitizedHTML) {
                element.innerHTML = sanitizedHTML;
            }
        },

        // 🖼️ 이미지 지연 로딩
        lazyLoadImages(container = document) {
            const images = container.querySelectorAll('img[data-src]');
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        imageObserver.unobserve(img);
                    }
                });
            });

            images.forEach(img => imageObserver.observe(img));
        },

        // 🔍 효율적인 요소 검색
        findElements(selector, context = document) {
            const cacheKey = `${selector}_${context.id || 'document'}`;

            if (virtualCache.has(cacheKey)) {
                const cached = virtualCache.get(cacheKey);
                if (cached.timestamp > Date.now() - 5000) { // 5초 캐시
                    return cached.elements;
                }
            }

            const elements = context.querySelectorAll(selector);
            virtualCache.set(cacheKey, {
                elements,
                timestamp: Date.now()
            });

            return elements;
        },

        // 🧹 메모리 정리
        cleanup(element) {
            if (element) {
                // 이벤트 리스너 제거
                this.removeEventListeners(element);

                // 자식 요소들도 정리
                const children = element.querySelectorAll('*');
                children.forEach(child => {
                    this.removeEventListeners(child);
                    activeElements.delete(child);
                });

                // 추적에서 제거
                activeElements.delete(element);

                // 부모에서 제거
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }
        },

        // 🔄 배치 업데이트 처리
        _processBatchUpdates() {
            // DOM 변경사항을 하나의 프레임에서 처리
            renderQueue.forEach(update => {
                try {
                    if (typeof update === 'function') {
                        update();
                    } else if (update.element && update.property) {
                        update.element[update.property] = update.value;
                    }
                } catch (error) {
                    console.error('Batch update error:', error);
                }
            });

            renderQueue = [];
        },

        // 🛡️ HTML 보안 검증
        _sanitizeHTML(html) {
            // 기본적인 XSS 방지
            const temp = document.createElement('div');
            temp.textContent = html;
            return temp.innerHTML;
        },

        // 👀 DOM 변경 감지
        _setupMutationObserver() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    // 추가된 노드들 처리
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // 지연 로딩 이미지 처리
                            if (node.tagName === 'IMG' && node.dataset.src) {
                                this.lazyLoadImages(node.parentElement);
                            }

                            // 새로 추가된 요소들 추적
                            activeElements.add(node);
                        }
                    });

                    // 제거된 노드들 정리
                    mutation.removedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.removeEventListeners(node);
                            activeElements.delete(node);
                        }
                    });
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        // 📊 성능 모니터링
        _setupPerformanceMonitoring() {
            // 렌더링 성능 측정
            let frameCount = 0;
            let lastTime = performance.now();

            const measureFPS = () => {
                frameCount++;
                const currentTime = performance.now();

                if (currentTime - lastTime >= 1000) {
                    const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));

                    if (fps < 30) {
                        console.warn('⚠️ 낮은 FPS 감지:', fps);
                    }

                    frameCount = 0;
                    lastTime = currentTime;
                }

                requestAnimationFrame(measureFPS);
            };

            requestAnimationFrame(measureFPS);

            // 메모리 사용량 모니터링 (지원되는 브라우저에서)
            if (performance.memory) {
                setInterval(() => {
                    const memory = performance.memory;
                    const usedPercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

                    if (usedPercent > 80) {
                        console.warn('⚠️ 높은 메모리 사용량:', Math.round(usedPercent) + '%');
                        this._performGarbageCollection();
                    }
                }, 30000); // 30초마다 체크
            }
        },

        // 🗑️ 수동 가비지 컬렉션
        _performGarbageCollection() {
            // 캐시 정리
            virtualCache.clear();

            // 비활성 요소들 정리
            const inactiveElements = [];
            activeElements.forEach(element => {
                if (!document.contains(element)) {
                    inactiveElements.push(element);
                }
            });

            inactiveElements.forEach(element => {
                this.removeEventListeners(element);
                activeElements.delete(element);
            });

            console.log(`🗑️ 가비지 컬렉션 완료: ${inactiveElements.length}개 요소 정리`);
        },

        // 📊 성능 통계 (고급 버전)
        getStats() {
            const memoryInfo = performance.memory || {};
            return {
                activeElements: activeElements.size,
                eventListeners: eventListeners.size,
                cacheSize: virtualCache.size,
                renderQueueSize: renderQueue.length,
                memoryUsage: {
                    used: Math.round((memoryInfo.usedJSHeapSize || 0) / 1024 / 1024),
                    total: Math.round((memoryInfo.totalJSHeapSize || 0) / 1024 / 1024),
                    limit: Math.round((memoryInfo.jsHeapSizeLimit || 0) / 1024 / 1024)
                },
                performance: {
                    renderCount: this._renderCount || 0,
                    avgRenderTime: this._avgRenderTime || 0
                }
            };
        },

        // 🚀 성능 최적화 자동 실행
        enableAutoOptimization() {
            // 5분마다 자동 최적화 실행
            setInterval(() => {
                this._performGarbageCollection();
                this._optimizeEventListeners();
                this._cleanupInactiveCache();
            }, 300000); // 5분

            console.log('🚀 자동 성능 최적화 활성화됨 (5분 간격)');
        },

        // 🧹 이벤트 리스너 최적화 (WeakMap은 반복 불가능하므로 비활성화)
        _optimizeEventListeners() {
            // WeakMap은 forEach를 지원하지 않으므로 임시 비활성화
            // console.log('🧹 WeakMap 기반 이벤트 리스너는 자동 정리됨');
        },

        // 💾 비활성 캐시 정리
        _cleanupInactiveCache() {
            const now = Date.now();
            let cleaned = 0;
            virtualCache.forEach((cached, key) => {
                if (now - cached.timestamp > 300000) { // 5분 초과
                    virtualCache.delete(key);
                    cleaned++;
                }
            });
            if (cleaned > 0) {
                console.log(`💾 오래된 캐시 ${cleaned}개 정리됨`);
            }
        },

        // 🧹 전체 정리
        destroy() {
            // 모든 이벤트 리스너 제거
            activeElements.forEach(element => {
                this.removeEventListeners(element);
            });

            // 캐시 정리
            virtualCache.clear();
            activeElements.clear();
            renderQueue = [];

            console.log('🧹 DOMManager 정리 완료');
        }
    };
})();

// 🌍 전역 접근 가능하게 설정
window.DOMManager = DOMManager;