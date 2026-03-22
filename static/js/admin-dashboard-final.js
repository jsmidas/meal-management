        document.addEventListener('DOMContentLoaded', function() {
            
            // 모든 모듈이 로드된 후 초기화
            setTimeout(() => {
                
                // Dashboard 모듈 초기화
                if (window.DashboardModule) {
                    window.dashboardInstance = new window.DashboardModule();
                }
                
                // Price Per Gram 모듈 초기화
                if (window.PricePerGramModule) {
                    window.pricePerGramInstance = new window.PricePerGramModule();
                }
                
                // Event Handlers 모듈 초기화
                if (window.EventHandlersModule) {
                    window.eventHandlersInstance = new window.EventHandlersModule();
                }
                
            }, 500);
        });
