// 🔗 모듈 로더 - 의존성 관리 시스템
// 모든 모듈의 참조와 로딩을 중앙에서 관리

class ModuleLoader {
    constructor() {
        this.loadedModules = new Map();
        this.loadingPromises = new Map();
        this.dependencies = new Map();
        this.moduleRegistry = this.setupModuleRegistry();
        
        console.log('[ModuleLoader] 초기화 완료');
    }

    /**
     * 모듈 등록 정보 설정
     */
    setupModuleRegistry() {
        return {
            // 필수 기본 모듈들 (항상 먼저 로드)
            core: {
                'config': {
                    path: 'config.js',
                    global: 'CONFIG',
                    required: true,
                    dependencies: []
                },
                'admin-cache': {
                    path: 'static/utils/admin-cache.js', 
                    global: 'AdminCache',
                    required: true,
                    dependencies: ['config']
                }
            },
            
            // 관리자 모듈들
            admin: {
                'dashboard-core': {
                    path: 'static/modules/dashboard-core/dashboard-core.js',
                    global: 'DashboardCore',
                    dependencies: ['config', 'admin-cache']
                },
                'users-admin': {
                    path: 'static/modules/users-admin/users-admin.js',
                    global: 'UsersAdminModule',
                    dependencies: ['config', 'admin-cache']
                },
                'users': {
                    path: 'static/modules/users/users.js',
                    global: 'UserManagement',
                    dependencies: ['config']
                },
                'suppliers': {
                    path: 'static/modules/suppliers/suppliers.js',
                    global: 'SupplierManagement',
                    dependencies: ['config']
                },
                'sites': {
                    path: 'static/modules/sites/sites.js',
                    global: 'SiteManagement',
                    dependencies: ['config']
                },
                'meal-pricing': {
                    path: 'static/modules/meal-pricing/meal-pricing.js',
                    global: 'MealPricingManagement',
                    dependencies: ['config']
                },
                'ingredients': {
                    path: 'static/modules/ingredients/ingredients.js',
                    global: 'IngredientManagement',
                    dependencies: ['config']
                },
                'suppliers-admin': {
                    path: 'static/modules/suppliers-admin/suppliers-admin.js',
                    global: 'SuppliersAdminModule',
                    dependencies: ['config', 'admin-cache']
                },
                'sites-admin': {
                    path: 'static/modules/sites-admin/sites-admin.js',
                    global: 'SitesAdminModule',
                    dependencies: ['config', 'admin-cache']
                },
                'meal-pricing-admin': {
                    path: 'static/modules/meal-pricing-admin/meal-pricing-admin.js',
                    global: 'MealPricingAdminModule',
                    dependencies: ['config', 'admin-cache']
                },
                'ingredients-admin': {
                    path: 'static/modules/ingredients-admin/ingredients-admin.js',
                    global: 'IngredientsAdminModule',
                    dependencies: ['config', 'admin-cache']
                }
            }
        };
    }

    /**
     * 모듈 로드 (의존성 자동 해결)
     */
    async loadModule(moduleName) {
        // 이미 로드된 모듈인지 확인
        if (this.loadedModules.has(moduleName)) {
            console.log(`[ModuleLoader] ${moduleName} 이미 로드됨`);
            return this.loadedModules.get(moduleName);
        }

        // 로딩 중인 모듈인지 확인
        if (this.loadingPromises.has(moduleName)) {
            console.log(`[ModuleLoader] ${moduleName} 로딩 중... 대기`);
            return await this.loadingPromises.get(moduleName);
        }

        // 새 모듈 로딩 시작
        const loadPromise = this._loadModuleWithDependencies(moduleName);
        this.loadingPromises.set(moduleName, loadPromise);

        try {
            const result = await loadPromise;
            this.loadedModules.set(moduleName, result);
            this.loadingPromises.delete(moduleName);
            return result;
        } catch (error) {
            this.loadingPromises.delete(moduleName);
            throw error;
        }
    }

    /**
     * 의존성을 포함한 모듈 로드
     */
    async _loadModuleWithDependencies(moduleName) {
        console.log(`[ModuleLoader] ${moduleName} 로드 시작`);
        
        const moduleInfo = this.findModuleInfo(moduleName);
        if (!moduleInfo) {
            throw new Error(`모듈 '${moduleName}'을 찾을 수 없습니다`);
        }

        // 의존성 먼저 로드
        if (moduleInfo.dependencies && moduleInfo.dependencies.length > 0) {
            console.log(`[ModuleLoader] ${moduleName} 의존성 로드:`, moduleInfo.dependencies);
            
            await Promise.all(
                moduleInfo.dependencies.map(dep => this.loadModule(dep))
            );
        }

        // 스크립트 로드
        await this.loadScript(moduleInfo.path);

        // 전역 객체 확인
        if (moduleInfo.global) {
            const globalObject = window[moduleInfo.global];
            if (!globalObject) {
                throw new Error(`모듈 '${moduleName}'의 전역 객체 '${moduleInfo.global}'을 찾을 수 없습니다`);
            }
            console.log(`[ModuleLoader] ${moduleName} 로드 완료 (${moduleInfo.global})`);
            return globalObject;
        }

        console.log(`[ModuleLoader] ${moduleName} 로드 완료`);
        return true;
    }

    /**
     * 모듈 정보 찾기
     */
    findModuleInfo(moduleName) {
        // core 모듈에서 찾기
        if (this.moduleRegistry.core[moduleName]) {
            return this.moduleRegistry.core[moduleName];
        }

        // admin 모듈에서 찾기  
        if (this.moduleRegistry.admin[moduleName]) {
            return this.moduleRegistry.admin[moduleName];
        }

        return null;
    }

    /**
     * 스크립트 동적 로드
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            // 이미 로드된 스크립트인지 확인
            const existingScript = document.querySelector(`script[src="${src}"]`);
            if (existingScript) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.onload = () => {
                console.log(`[ModuleLoader] 스크립트 로드 완료: ${src}`);
                resolve();
            };
            script.onerror = () => {
                console.error(`[ModuleLoader] 스크립트 로드 실패: ${src}`);
                reject(new Error(`Failed to load script: ${src}`));
            };
            
            document.head.appendChild(script);
        });
    }

    /**
     * 필수 모듈들 일괄 로드
     */
    async loadCoreModules() {
        console.log('[ModuleLoader] 필수 모듈 일괄 로드 시작');
        
        const coreModules = Object.keys(this.moduleRegistry.core);
        const promises = coreModules.map(moduleName => this.loadModule(moduleName));
        
        try {
            await Promise.all(promises);
            console.log('[ModuleLoader] 필수 모듈 로드 완료:', coreModules);
        } catch (error) {
            if (error instanceof Error) {
                console.error('[ModuleLoader] 필수 모듈 로드 실패:', error);
                throw error;
            } else {
                console.error('[ModuleLoader] 알 수 없는 오류 발생:', error);
                throw new Error('Unknown error occurred during core module loading');
            }
        }
    }

    /**
     * 모듈 상태 확인
     */
    getModuleStatus() {
        const status = {
            loaded: Array.from(this.loadedModules.keys()),
            loading: Array.from(this.loadingPromises.keys()),
            available: [
                ...Object.keys(this.moduleRegistry.core),
                ...Object.keys(this.moduleRegistry.admin)
            ]
        };

        console.log('[ModuleLoader] 모듈 상태:', status);
        return status;
    }

    /**
     * 모듈 언로드 (메모리 정리)
     */
    unloadModule(moduleName) {
        if (this.loadedModules.has(moduleName)) {
            // 모듈 정리 메서드가 있으면 호출
            const module = this.loadedModules.get(moduleName);
            if (module && typeof module.destroy === 'function') {
                module.destroy();
            }

            this.loadedModules.delete(moduleName);
            console.log(`[ModuleLoader] ${moduleName} 언로드 완료`);
        }
    }

    /**
     * 의존성 체크
     */
    checkDependencies(moduleName) {
        const moduleInfo = this.findModuleInfo(moduleName);
        if (!moduleInfo) return [];

        const missing = [];
        if (moduleInfo.dependencies) {
            for (const dep of moduleInfo.dependencies) {
                if (!this.loadedModules.has(dep)) {
                    missing.push(dep);
                }
            }
        }

        return missing;
    }
}

// 전역 모듈 로더 인스턴스
window.ModuleLoader = new ModuleLoader();