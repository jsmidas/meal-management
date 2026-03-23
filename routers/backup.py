# routers/backup.py
"""
핵심 데이터 백업 및 복원 시스템

백업 대상:
1. 슬롯/사업장: business_locations, site_groups, site_categories, category_slots, meal_slot_settings
2. 메뉴/레시피: menu_recipes, menu_recipe_ingredients
3. 식자재: ingredients (base_weight_grams 포함)
4. 식단: meal_plans
"""

from fastapi import APIRouter, Request, Query
from core.database import get_db_connection
from datetime import datetime, timedelta
import json
import time
import traceback

# 스케줄러
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

router = APIRouter()
scheduler = None  # 전역 스케줄러 인스턴스

# 허용된 테이블명 화이트리스트
ALLOWED_TABLES = {
    'business_locations', 'site_groups', 'site_categories',
    'category_slots', 'meal_slot_settings',
    'menu_recipes', 'menu_recipe_ingredients',
    'ingredients', 'meal_plans', 'meal_counts',
    'users', 'suppliers', 'orders', 'order_items', 'sites',
    'ingredients_history', 'site_structure_history', 'daily_snapshots',
    'backup_metadata',
}

def validate_table_name(table_name: str) -> str:
    """테이블명 화이트리스트 검증"""
    if table_name not in ALLOWED_TABLES:
        raise ValueError(f"허용되지 않은 테이블명: {table_name}")
    return table_name


# ============================================
# 초기화: 백업 테이블 및 트리거 생성
# ============================================

def init_backup_system():
    """백업 시스템 초기화 - 서버 시작 시 호출"""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        try:
            # 1. 백업 메타데이터 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS backup_metadata (
                    id SERIAL PRIMARY KEY,
                    backup_type VARCHAR(50) NOT NULL,  -- 'snapshot', 'history', 'manual'
                    backup_name VARCHAR(255),
                    table_name VARCHAR(100),
                    record_count INTEGER,
                    backup_data JSONB,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    notes TEXT
                )
            """)

            # 2. meal_plans 변경 이력 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meal_plans_history (
                    id SERIAL PRIMARY KEY,
                    original_id INTEGER NOT NULL,
                    plan_date DATE NOT NULL,
                    slot_name VARCHAR(255),
                    category VARCHAR(100),
                    menus JSONB,
                    site_id INTEGER,
                    action VARCHAR(20) NOT NULL,  -- 'INSERT', 'UPDATE', 'DELETE'
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)

            # 3. menu_recipes 변경 이력 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS menu_recipes_history (
                    id SERIAL PRIMARY KEY,
                    original_id INTEGER NOT NULL,
                    recipe_code VARCHAR(100),
                    recipe_name VARCHAR(255),
                    category VARCHAR(100),
                    cooking_note TEXT,
                    total_cost NUMERIC,
                    serving_size INTEGER,
                    cooking_yield_rate NUMERIC,
                    site_id INTEGER,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)

            # 4. menu_recipe_ingredients 변경 이력 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS menu_recipe_ingredients_history (
                    id SERIAL PRIMARY KEY,
                    original_id INTEGER NOT NULL,
                    recipe_id INTEGER,
                    ingredient_code VARCHAR(100),
                    ingredient_name VARCHAR(255),
                    specification VARCHAR(255),
                    unit VARCHAR(50),
                    quantity NUMERIC,
                    required_grams NUMERIC,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)

            # 5. ingredients 변경 이력 테이블 (base_weight_grams 중심)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ingredients_history (
                    id SERIAL PRIMARY KEY,
                    original_id INTEGER NOT NULL,
                    ingredient_code TEXT,
                    ingredient_name TEXT,
                    specification TEXT,
                    unit TEXT,
                    base_weight_grams NUMERIC,
                    purchase_price NUMERIC,
                    selling_price NUMERIC,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)

            # 6. 사업장/슬롯 변경 이력 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_structure_history (
                    id SERIAL PRIMARY KEY,
                    table_name VARCHAR(100) NOT NULL,
                    original_id INTEGER NOT NULL,
                    record_data JSONB NOT NULL,
                    action VARCHAR(20) NOT NULL,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_by VARCHAR(100)
                )
            """)

            # 7. 일일 스냅샷 테이블
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_snapshots (
                    id SERIAL PRIMARY KEY,
                    snapshot_date DATE NOT NULL,
                    table_name VARCHAR(100) NOT NULL,
                    record_count INTEGER,
                    snapshot_data JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(snapshot_date, table_name)
                )
            """)

            # 인덱스 생성
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_plans_history_date ON meal_plans_history(plan_date)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_meal_plans_history_changed ON meal_plans_history(changed_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_menu_recipes_history_changed ON menu_recipes_history(changed_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots(snapshot_date)")

            conn.commit()
            print("[백업 시스템] 테이블 초기화 완료")

        except Exception as e:
            conn.rollback()
            print(f"[백업 시스템] 초기화 오류: {e}")
            traceback.print_exc()
        finally:
            cursor.close()

        # 스케줄러 시작
        start_backup_scheduler()


# ============================================
# 자동 백업 스케줄러
# ============================================

def start_backup_scheduler():
    """백업 스케줄러 시작 - 매일 새벽 3시 실행"""
    global scheduler

    if scheduler is not None:
        print("[백업 스케줄러] 이미 실행 중")
        return

    try:
        scheduler = BackgroundScheduler(timezone='Asia/Seoul')

        # 매일 새벽 3시에 자동 백업
        scheduler.add_job(
            run_scheduled_backup,
            CronTrigger(hour=3, minute=0),
            id='daily_backup',
            name='일일 자동 백업 (새벽 3시)',
            replace_existing=True
        )

        # 매일 새벽 0시 30분에 단가 만료 식자재 미게시 처리
        scheduler.add_job(
            deactivate_expired_ingredients,
            CronTrigger(hour=0, minute=30),
            id='deactivate_expired',
            name='단가 만료 식자재 미게시 처리 (새벽 0:30)',
            replace_existing=True
        )

        scheduler.start()
        print("[백업 스케줄러] 시작됨 - 매일 새벽 3시 자동 백업, 0:30 만료 식자재 처리")

        # 다음 실행 시간 출력
        job = scheduler.get_job('daily_backup')
        if job:
            next_run = job.next_run_time
            print(f"[백업 스케줄러] 다음 백업 예정: {next_run}")

        job_expired = scheduler.get_job('deactivate_expired')
        if job_expired:
            print(f"[백업 스케줄러] 다음 만료처리 예정: {job_expired.next_run_time}")

        # 서버 시작 시 즉시 1회 실행 (밀린 처리 수행)
        try:
            deactivate_expired_ingredients()
        except Exception as e:
            print(f"[만료처리] 초기 실행 오류: {e}")

    except Exception as e:
        print(f"[백업 스케줄러] 시작 오류: {e}")
        traceback.print_exc()


def deactivate_expired_ingredients():
    """단가 적용일이 만료된 식자재의 posting_status를 '무'로 변경"""
    print(f"\n[만료처리] 단가 만료 식자재 미게시 처리 시작 - {datetime.now()}")

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ingredient_price_history 테이블 기준: 모든 이력의 end_date가 오늘 이전인 식자재
            count_history = 0
            try:
                cursor.execute("""
                    UPDATE ingredients SET posting_status = '무', updated_at = NOW()
                    WHERE id IN (
                        SELECT ingredient_id FROM ingredient_price_history
                        GROUP BY ingredient_id
                        HAVING MAX(COALESCE(end_date, '9999-12-31'::date)) < CURRENT_DATE
                    )
                    AND posting_status != '무'
                """)
                count_history = cursor.rowcount
            except Exception as e:
                print(f"[만료처리] ingredient_price_history 테이블 없음 (무시): {e}")
                conn.rollback()  # 트랜잭션 롤백 후 계속 진행

            # ingredient_prices 테이블 기준: 모든 이력의 effective_to가 오늘 이전인 식자재
            try:
                cursor.execute("""
                    UPDATE ingredients SET posting_status = '무', updated_at = NOW()
                    WHERE id IN (
                        SELECT ingredient_id FROM ingredient_prices
                        GROUP BY ingredient_id
                        HAVING MAX(COALESCE(effective_to, '9999-12-31'::date)) < CURRENT_DATE
                    )
                    AND posting_status != '무'
                """)
                count_prices = cursor.rowcount
            except Exception as e:
                print(f"[만료처리] ingredient_prices 테이블 없음 (무시): {e}")
                conn.rollback()
                count_prices = 0

            conn.commit()
            cursor.close()

            total = count_history + count_prices
            print(f"[만료처리] 완료 - price_history 기준: {count_history}건, prices 기준: {count_prices}건, 총 {total}건 미게시 처리")

    except Exception as e:
        print(f"[만료처리] 오류: {e}")
        traceback.print_exc()


def run_scheduled_backup():
    """스케줄러에서 호출하는 백업 함수"""
    print(f"\n{'='*50}")
    print(f"[자동 백업] 시작 - {datetime.now()}")
    print(f"{'='*50}")

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            today = datetime.now().strftime('%Y-%m-%d')

            # 1. 일일 스냅샷 생성
            backup_tables = {
                'business_locations': "SELECT * FROM business_locations",
                'site_groups': "SELECT * FROM site_groups",
                'site_categories': "SELECT * FROM site_categories",
                'category_slots': "SELECT * FROM category_slots",
                'meal_slot_settings': "SELECT * FROM meal_slot_settings",
                'menu_recipes': "SELECT * FROM menu_recipes",
                'menu_recipe_ingredients': "SELECT * FROM menu_recipe_ingredients",
                'meal_plans': f"SELECT * FROM meal_plans WHERE plan_date >= '{today}'::date - interval '7 days'",
            }

            total_records = 0
            for table_name, query in backup_tables.items():
                try:
                    cursor.execute(query)
                    columns = [desc[0] for desc in cursor.description]
                    rows = cursor.fetchall()

                    data_list = []
                    for row in rows:
                        row_dict = {}
                        for i, col in enumerate(columns):
                            val = row[i]
                            if isinstance(val, datetime):
                                val = val.isoformat()
                            elif hasattr(val, '__json__'):
                                val = val.__json__()
                            row_dict[col] = val
                        data_list.append(row_dict)

                    cursor.execute("""
                        INSERT INTO daily_snapshots (snapshot_date, table_name, record_count, snapshot_data)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (snapshot_date, table_name)
                        DO UPDATE SET record_count = EXCLUDED.record_count,
                                      snapshot_data = EXCLUDED.snapshot_data,
                                      created_at = CURRENT_TIMESTAMP
                    """, (today, table_name, len(data_list), json.dumps(data_list, default=str, ensure_ascii=False)))

                    total_records += len(data_list)
                    print(f"[자동 백업] {table_name}: {len(data_list)}개 레코드")

                except Exception as e:
                    print(f"[자동 백업] {table_name} 실패: {e}")

            # 2. 30일 이상 된 스냅샷 정리
            cursor.execute("""
                DELETE FROM daily_snapshots
                WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'
            """)
            deleted_old = cursor.rowcount
            if deleted_old > 0:
                print(f"[자동 백업] 30일 이상 된 스냅샷 {deleted_old}개 삭제")

            # 3. 식자재 건수만 기록 (전체 데이터 백업은 pg_dump 사용 권장)
            cursor.execute("SELECT COUNT(*) FROM ingredients")
            ing_count = cursor.fetchone()[0]

            backup_name = f"auto_ingredients_count_{today.replace('-', '')}"
            cursor.execute("""
                INSERT INTO backup_metadata
                (backup_type, backup_name, table_name, record_count, backup_data, created_by, notes)
                VALUES ('count_only', %s, 'ingredients', %s, NULL, 'scheduler', '식자재 건수 기록 (전체 백업은 pg_dump 사용)')
            """, (backup_name, ing_count))

            print(f"[자동 백업] 식자재 건수 기록: {ing_count}개")

            conn.commit()
            cursor.close()

            print(f"\n[자동 백업] 완료 - 총 {total_records}개 레코드 백업됨")
            print(f"{'='*50}\n")

    except Exception as e:
        print(f"[자동 백업] 오류: {e}")
        traceback.print_exc()


def stop_backup_scheduler():
    """백업 스케줄러 중지"""
    global scheduler
    if scheduler:
        scheduler.shutdown()
        scheduler = None
        print("[백업 스케줄러] 중지됨")


# ============================================
# meal_plans 변경 이력 저장 함수
# ============================================

def save_meal_plan_history(cursor, original_id: int, action: str, changed_by: str = None):
    """meal_plans 변경 전 데이터를 이력 테이블에 저장"""
    try:
        cursor.execute("""
            INSERT INTO meal_plans_history
            (original_id, plan_date, slot_name, category, menus, site_id, action, changed_by)
            SELECT id, plan_date, slot_name, category, menus, site_id, %s, %s
            FROM meal_plans WHERE id = %s
        """, (action, changed_by, original_id))
    except Exception as e:
        print(f"[백업] meal_plans 이력 저장 실패: {e}")


def save_meal_plans_bulk_history(cursor, plan_date: str, category: str, action: str, changed_by: str = None):
    """특정 날짜/카테고리의 모든 meal_plans를 이력에 저장"""
    try:
        cursor.execute("""
            INSERT INTO meal_plans_history
            (original_id, plan_date, slot_name, category, menus, site_id, action, changed_by)
            SELECT id, plan_date, slot_name, category, menus, site_id, %s, %s
            FROM meal_plans
            WHERE plan_date = %s AND category = %s
        """, (action, changed_by, plan_date, category))
        return cursor.rowcount
    except Exception as e:
        print(f"[백업] meal_plans 벌크 이력 저장 실패: {e}")
        return 0


# ============================================
# 백업 API 엔드포인트
# ============================================

@router.get("/api/backup/status")
async def get_backup_status():
    """백업 시스템 상태 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 각 이력 테이블의 레코드 수 확인
            status = {}
            history_tables = [
                'meal_plans_history',
                'menu_recipes_history',
                'menu_recipe_ingredients_history',
                'ingredients_history',
                'site_structure_history',
                'daily_snapshots'
            ]

            for table in history_tables:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cursor.fetchone()[0]

                    cursor.execute(f"SELECT MAX(changed_at) FROM {table}" if 'history' in table else f"SELECT MAX(created_at) FROM {table}")
                    last_update = cursor.fetchone()[0]

                    status[table] = {
                        'count': count,
                        'last_update': str(last_update) if last_update else None
                    }
                except Exception as e:
                    status[table] = {'error': str(e)}

            # 최근 스냅샷 날짜
            cursor.execute("SELECT DISTINCT snapshot_date FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 7")
            recent_snapshots = [str(row[0]) for row in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "history_tables": status,
                "recent_snapshots": recent_snapshots
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/backup/snapshot/create")
async def create_daily_snapshot(request: Request):
    """일일 스냅샷 생성 (수동)"""
    try:
        data = await request.json()
        snapshot_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        tables = data.get('tables', ['all'])  # 특정 테이블만 또는 전체

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 백업 대상 테이블 목록
            backup_tables = {
                'business_locations': "SELECT * FROM business_locations",
                'site_groups': "SELECT * FROM site_groups",
                'site_categories': "SELECT * FROM site_categories",
                'category_slots': "SELECT * FROM category_slots",
                'meal_slot_settings': "SELECT * FROM meal_slot_settings",
                'menu_recipes': "SELECT * FROM menu_recipes",
                'menu_recipe_ingredients': "SELECT * FROM menu_recipe_ingredients",
                'meal_plans': f"SELECT * FROM meal_plans WHERE plan_date >= '{snapshot_date}'::date - interval '7 days'",
            }

            if 'all' not in tables:
                backup_tables = {k: v for k, v in backup_tables.items() if k in tables}

            results = {}

            for table_name, query in backup_tables.items():
                try:
                    cursor.execute(query)
                    columns = [desc[0] for desc in cursor.description]
                    rows = cursor.fetchall()

                    # JSON 직렬화 가능한 형태로 변환
                    data_list = []
                    for row in rows:
                        row_dict = {}
                        for i, col in enumerate(columns):
                            val = row[i]
                            if isinstance(val, datetime):
                                val = val.isoformat()
                            elif hasattr(val, '__json__'):
                                val = val.__json__()
                            row_dict[col] = val
                        data_list.append(row_dict)

                    # 스냅샷 저장 (UPSERT)
                    cursor.execute("""
                        INSERT INTO daily_snapshots (snapshot_date, table_name, record_count, snapshot_data)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (snapshot_date, table_name)
                        DO UPDATE SET record_count = EXCLUDED.record_count,
                                      snapshot_data = EXCLUDED.snapshot_data,
                                      created_at = CURRENT_TIMESTAMP
                    """, (snapshot_date, table_name, len(data_list), json.dumps(data_list, default=str, ensure_ascii=False)))

                    results[table_name] = {'success': True, 'count': len(data_list)}

                except Exception as e:
                    results[table_name] = {'success': False, 'error': str(e)}

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "snapshot_date": snapshot_date,
                "results": results
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/snapshots")
async def list_snapshots(days: int = Query(30)):
    """스냅샷 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT snapshot_date, table_name, record_count, created_at
                FROM daily_snapshots
                WHERE snapshot_date >= CURRENT_DATE - %s
                ORDER BY snapshot_date DESC, table_name
            """, (days,))

            rows = cursor.fetchall()

            # 날짜별로 그룹화
            snapshots = {}
            for row in rows:
                date_str = str(row[0])
                if date_str not in snapshots:
                    snapshots[date_str] = {'tables': [], 'created_at': str(row[3])}
                snapshots[date_str]['tables'].append({
                    'table_name': row[1],
                    'record_count': row[2]
                })

            cursor.close()

            return {"success": True, "snapshots": snapshots}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/meal-plans/history")
async def get_meal_plans_history(
    plan_date: str = Query(None),
    category: str = Query(None),
    limit: int = Query(100)
):
    """meal_plans 변경 이력 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, original_id, plan_date, slot_name, category, menus,
                       action, changed_at, changed_by
                FROM meal_plans_history
                WHERE 1=1
            """
            params = []

            if plan_date:
                query += " AND plan_date = %s"
                params.append(plan_date)
            if category:
                query += " AND category = %s"
                params.append(category)

            query += " ORDER BY changed_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            history = []
            for row in rows:
                history.append({
                    'id': row[0],
                    'original_id': row[1],
                    'plan_date': str(row[2]),
                    'slot_name': row[3],
                    'category': row[4],
                    'menus': row[5],
                    'action': row[6],
                    'changed_at': str(row[7]),
                    'changed_by': row[8]
                })

            cursor.close()

            return {"success": True, "history": history, "count": len(history)}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/backup/meal-plans/restore")
async def restore_meal_plans(request: Request):
    """meal_plans 특정 시점으로 복원"""
    try:
        data = await request.json()
        plan_date = data.get('plan_date')
        category = data.get('category')
        restore_to = data.get('restore_to')  # 복원할 시점 (changed_at)

        if not plan_date or not restore_to:
            return {"success": False, "error": "plan_date와 restore_to가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 현재 데이터를 이력에 저장 (복원 전 백업)
            cursor.execute("""
                INSERT INTO meal_plans_history
                (original_id, plan_date, slot_name, category, menus, site_id, action, changed_by)
                SELECT id, plan_date, slot_name, category, menus, site_id, 'BEFORE_RESTORE', 'system'
                FROM meal_plans
                WHERE plan_date = %s AND (%s IS NULL OR category = %s)
            """, (plan_date, category, category))

            # 2. 복원할 이력 데이터 조회
            query = """
                SELECT DISTINCT ON (slot_name)
                    original_id, slot_name, category, menus, site_id
                FROM meal_plans_history
                WHERE plan_date = %s
                  AND changed_at <= %s
                  AND action != 'BEFORE_RESTORE'
            """
            params = [plan_date, restore_to]

            if category:
                query += " AND category = %s"
                params.append(category)

            query += " ORDER BY slot_name, changed_at DESC"

            cursor.execute(query, params)
            restore_data = cursor.fetchall()

            if not restore_data:
                return {"success": False, "error": "복원할 데이터가 없습니다"}

            # 3. 현재 데이터 삭제
            delete_query = "DELETE FROM meal_plans WHERE plan_date = %s"
            delete_params = [plan_date]
            if category:
                delete_query += " AND category = %s"
                delete_params.append(category)
            cursor.execute(delete_query, delete_params)
            deleted_count = cursor.rowcount

            # 4. 이력 데이터로 복원 (canonical_name 보강)
            # 복원 데이터에 canonical_name이 없는 메뉴에 대해 DB 조회로 추가
            all_recipe_ids = set()
            for row in restore_data:
                _, _, _, menus, _ = row
                if isinstance(menus, list):
                    for m in menus:
                        if isinstance(m, dict) and m.get('id') and not m.get('canonical_name'):
                            try:
                                all_recipe_ids.add(int(m['id']))
                            except (ValueError, TypeError):
                                pass

            id_to_canonical = {}
            if all_recipe_ids:
                rid_placeholders = ','.join(['%s'] * len(all_recipe_ids))
                cursor.execute(f"""
                    SELECT id,
                           CASE WHEN COALESCE(suffix, '') != ''
                                THEN COALESCE(NULLIF(base_name, ''), recipe_name) || '-' || suffix
                                ELSE COALESCE(NULLIF(base_name, ''), recipe_name)
                           END AS canonical_name
                    FROM menu_recipes WHERE id IN ({rid_placeholders})
                """, list(all_recipe_ids))
                id_to_canonical = {r[0]: r[1] for r in cursor.fetchall()}

            restored_count = 0
            for row in restore_data:
                original_id, slot_name, cat, menus, site_id = row
                # canonical_name 보강
                if isinstance(menus, list) and id_to_canonical:
                    for m in menus:
                        if isinstance(m, dict) and m.get('id') and not m.get('canonical_name'):
                            try:
                                rid = int(m['id'])
                                if rid in id_to_canonical:
                                    m['canonical_name'] = id_to_canonical[rid]
                            except (ValueError, TypeError):
                                pass
                cursor.execute("""
                    INSERT INTO meal_plans (plan_date, slot_name, category, menus, site_id, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, (plan_date, slot_name, cat, json.dumps(menus) if isinstance(menus, (dict, list)) else menus, site_id))
                restored_count += 1

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"복원 완료: {deleted_count}개 삭제, {restored_count}개 복원",
                "deleted": deleted_count,
                "restored": restored_count
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/backup/snapshot/restore")
async def restore_from_snapshot(request: Request):
    """스냅샷에서 복원"""
    try:
        data = await request.json()
        snapshot_date = data.get('snapshot_date')
        table_name = data.get('table_name')

        if not snapshot_date or not table_name:
            return {"success": False, "error": "snapshot_date와 table_name이 필요합니다"}

        try:
            validate_table_name(table_name)
        except ValueError as e:
            return {"success": False, "error": str(e)}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 스냅샷 데이터 조회
            cursor.execute("""
                SELECT snapshot_data, record_count
                FROM daily_snapshots
                WHERE snapshot_date = %s AND table_name = %s
            """, (snapshot_date, table_name))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "스냅샷을 찾을 수 없습니다"}

            snapshot_data = row[0]
            record_count = row[1]

            # 현재 데이터 백업 (메타데이터 테이블에)
            # 대형 테이블(10,000건 이상)은 COPY TO CSV 파일로 백업
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            current_count = cursor.fetchone()[0]

            if current_count >= 10000:
                # 대형 테이블: CSV 파일로 백업 (메모리 절약)
                from pathlib import Path
                backup_dir = Path("backups")
                backup_dir.mkdir(exist_ok=True)
                csv_path = backup_dir / f"before_restore_{table_name}_{snapshot_date}.csv"

                with open(csv_path, 'wb') as f:
                    cursor.copy_expert(
                        f"COPY {table_name} TO STDOUT WITH (FORMAT CSV, HEADER true, ENCODING 'UTF8')",
                        f
                    )

                file_info = json.dumps({
                    "file_path": str(csv_path),
                    "file_size_bytes": csv_path.stat().st_size,
                    "format": "csv"
                })
                cursor.execute("""
                    INSERT INTO backup_metadata (backup_type, backup_name, table_name, record_count, backup_data, created_by, notes)
                    VALUES ('before_restore', %s, %s, %s, %s, 'system', '스냅샷 복원 전 CSV 파일 백업')
                """, (f"restore_{snapshot_date}", table_name, current_count, file_info))
            else:
                # 소형 테이블: 기존 방식 (JSON in DB)
                cursor.execute(f"SELECT * FROM {table_name}")
                current_data = cursor.fetchall()
                columns = [desc[0] for desc in cursor.description]
                current_list = [dict(zip(columns, row)) for row in current_data]

                cursor.execute("""
                    INSERT INTO backup_metadata (backup_type, backup_name, table_name, record_count, backup_data, created_by, notes)
                    VALUES ('before_restore', %s, %s, %s, %s, 'system', '스냅샷 복원 전 백업')
                """, (f"restore_{snapshot_date}", table_name, len(current_list), json.dumps(current_list, default=str, ensure_ascii=False)))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": f"스냅샷 조회 완료. 복원하려면 별도 확인이 필요합니다.",
                "snapshot_date": snapshot_date,
                "table_name": table_name,
                "record_count": record_count,
                "preview": snapshot_data[:5] if isinstance(snapshot_data, list) else None
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/ingredients/history")
async def get_ingredients_history(
    ingredient_code: str = Query(None),
    limit: int = Query(100)
):
    """ingredients 변경 이력 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, original_id, ingredient_code, ingredient_name, specification,
                       unit, base_weight_grams, purchase_price, selling_price,
                       action, changed_at, changed_by
                FROM ingredients_history
                WHERE 1=1
            """
            params = []

            if ingredient_code:
                query += " AND ingredient_code = %s"
                params.append(ingredient_code)

            query += " ORDER BY changed_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            history = []
            for row in rows:
                history.append({
                    'id': row[0],
                    'original_id': row[1],
                    'ingredient_code': row[2],
                    'ingredient_name': row[3],
                    'specification': row[4],
                    'unit': row[5],
                    'base_weight_grams': float(row[6]) if row[6] else None,
                    'purchase_price': float(row[7]) if row[7] else None,
                    'selling_price': float(row[8]) if row[8] else None,
                    'action': row[9],
                    'changed_at': str(row[10]),
                    'changed_by': row[11]
                })

            cursor.close()

            return {"success": True, "history": history, "count": len(history)}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 식자재 전체 백업 (15일 주기, 1개월 보관)
# ============================================

@router.post("/api/backup/ingredients/full")
async def backup_ingredients_full(request: Request):
    """식자재 전체 백업 (COPY TO CSV 스트리밍 - 메모리 효율적)"""
    from pathlib import Path

    try:
        data = await request.json() if request else {}
        backup_name = data.get('backup_name', f"ingredients_{datetime.now().strftime('%Y%m%d')}")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1개월 이상 된 식자재 백업 삭제 (용량 관리)
            cursor.execute("""
                DELETE FROM backup_metadata
                WHERE table_name = 'ingredients'
                  AND backup_type IN ('full_backup', 'csv_file_backup')
                  AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
            """)
            deleted_old = cursor.rowcount
            if deleted_old > 0:
                print(f"[식자재 백업] 1개월 이상 된 백업 {deleted_old}개 삭제")

            # 마지막 식자재 백업 날짜 확인
            cursor.execute("""
                SELECT created_at FROM backup_metadata
                WHERE table_name = 'ingredients' AND backup_type IN ('full_backup', 'csv_file_backup')
                ORDER BY created_at DESC LIMIT 1
            """)
            last_backup = cursor.fetchone()
            days_since = None
            if last_backup:
                days_since = (datetime.now() - last_backup[0]).days
                print(f"[식자재 백업] 마지막 백업: {last_backup[0]} ({days_since}일 전)")

            # 건수 조회
            cursor.execute("SELECT COUNT(*) FROM ingredients")
            record_count = cursor.fetchone()[0]

            # COPY TO CSV로 파일 직접 스트리밍 (메모리 사용 거의 0)
            backup_dir = Path("backups")
            backup_dir.mkdir(exist_ok=True)
            csv_path = backup_dir / f"{backup_name}.csv"

            with open(csv_path, 'wb') as f:
                cursor.copy_expert(
                    "COPY ingredients TO STDOUT WITH (FORMAT CSV, HEADER true, ENCODING 'UTF8')",
                    f
                )

            file_size = csv_path.stat().st_size

            # 메타데이터에 파일 경로만 기록 (backup_data=NULL)
            file_info = json.dumps({
                "file_path": str(csv_path),
                "file_size_bytes": file_size,
                "format": "csv"
            })
            cursor.execute("""
                INSERT INTO backup_metadata
                (backup_type, backup_name, table_name, record_count, backup_data, created_by, notes)
                VALUES ('csv_file_backup', %s, 'ingredients', %s, %s, 'system', '식자재 CSV 파일 백업 (COPY TO)')
            """, (backup_name, record_count, file_info))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "backup_name": backup_name,
                "record_count": record_count,
                "file_path": str(csv_path),
                "file_size": f"{file_size / 1024 / 1024:.2f} MB",
                "days_since_last": days_since,
                "old_backups_deleted": deleted_old,
                "message": f"식자재 CSV 백업 완료: {record_count}개 레코드 ({file_size / 1024 / 1024:.2f} MB)"
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/ingredients/list")
async def list_ingredients_backups(limit: int = Query(10)):
    """식자재 백업 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, backup_name, record_count, created_at, notes,
                       CASE WHEN backup_data IS NOT NULL
                            THEN pg_size_pretty(length(backup_data::text)::bigint)
                            ELSE 'N/A (파일)'
                       END as size
                FROM backup_metadata
                WHERE table_name = 'ingredients' AND backup_type IN ('full_backup', 'csv_file_backup')
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))

            backups = []
            for row in cursor.fetchall():
                backups.append({
                    'id': row[0],
                    'backup_name': row[1],
                    'record_count': row[2],
                    'created_at': str(row[3]),
                    'notes': row[4],
                    'size': row[5]
                })

            cursor.close()

            return {"success": True, "backups": backups}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================
# 범용 백업 (SQL 덤프 / CSV 내보내기)
# - 프로그램 재개발해도 복원 가능
# - DB 구조가 바뀌어도 데이터 보존
# ============================================

@router.post("/api/backup/export/sql")
async def export_sql_backup(request: Request):
    """SQL 덤프 백업 생성 (스키마 + 데이터 완전 백업)"""
    import subprocess
    import os
    from pathlib import Path

    try:
        data = await request.json() if request else {}
        tables = data.get('tables', ['all'])  # 특정 테이블 또는 전체

        # 백업 디렉토리 생성
        backup_dir = Path("backups")
        backup_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_file = backup_dir / f"backup_{timestamp}.sql"

        # DATABASE_URL에서 연결 정보 추출
        import os
        db_url = os.environ.get('DATABASE_URL', '')

        if not db_url:
            return {"success": False, "error": "DATABASE_URL이 설정되지 않았습니다"}

        # pg_dump 실행 (Windows/Linux 호환)
        # 주요 테이블만 백업
        core_tables = [
            'business_locations', 'site_groups', 'site_categories',
            'category_slots', 'meal_slot_settings',
            'menu_recipes', 'menu_recipe_ingredients',
            'ingredients', 'meal_plans', 'meal_counts'
        ]

        if 'all' not in tables:
            core_tables = [t for t in core_tables if t in tables]

        # pg_dump 명령 생성
        cmd = ['pg_dump', db_url] + [arg for t in core_tables for arg in ['-t', t]] + ['--no-owner', '--no-acl', '-f', str(backup_file)]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0 and backup_file.exists():
            file_size = backup_file.stat().st_size
            return {
                "success": True,
                "file": str(backup_file),
                "size": f"{file_size / 1024 / 1024:.2f} MB",
                "tables": core_tables,
                "message": f"SQL 백업 완료: {backup_file.name}"
            }
        else:
            # pg_dump가 없거나 실패한 경우 Python으로 직접 생성
            return await export_sql_manual(core_tables, backup_file)

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


async def export_sql_manual(tables: list, backup_file):
    """pg_dump 없이 Python으로 SQL 덤프 생성 (스트리밍 쓰기 - 메모리 효율적)"""
    try:
        with get_db_connection() as conn:

            FETCH_SIZE = 2000

            with open(backup_file, 'w', encoding='utf-8') as f:
                f.write(f"-- 다함 식자재 관리 시스템 백업\n")
                f.write(f"-- 생성일시: {datetime.now().isoformat()}\n")
                f.write(f"-- 테이블: {', '.join(tables)}\n\n")

                for table in tables:
                    try:
                        # 테이블 구조 확인
                        cursor = conn.cursor()
                        cursor.execute(f"""
                            SELECT column_name, data_type, is_nullable, column_default
                            FROM information_schema.columns
                            WHERE table_name = %s
                            ORDER BY ordinal_position
                        """, (table,))
                        columns_info = cursor.fetchall()
                        cursor.close()

                        if not columns_info:
                            continue

                        # 건수 조회
                        cursor = conn.cursor()
                        cursor.execute(f"SELECT COUNT(*) FROM {table}")
                        row_count = cursor.fetchone()[0]
                        cursor.close()

                        f.write(f"\n-- {table} 테이블\n")
                        f.write(f"-- DROP TABLE IF EXISTS {table};\n")
                        f.write(f"-- {row_count}개 레코드\n")

                        # 서버사이드 커서로 데이터 스트리밍
                        server_cursor = conn.cursor(name=f"export_{table}_{int(time.time()*1000)}")
                        try:
                            server_cursor.execute(f"SELECT * FROM {table}")
                            columns = [desc[0] for desc in server_cursor.description]

                            while True:
                                rows = server_cursor.fetchmany(FETCH_SIZE)
                                if not rows:
                                    break

                                for row in rows:
                                    values = []
                                    for val in row:
                                        if val is None:
                                            values.append('NULL')
                                        elif isinstance(val, str):
                                            escaped = val.replace("'", "''")
                                            values.append(f"'{escaped}'")
                                        elif isinstance(val, (dict, list)):
                                            escaped = json.dumps(val, ensure_ascii=False).replace("'", "''")
                                            values.append(f"'{escaped}'")
                                        elif hasattr(val, 'isoformat'):
                                            values.append(f"'{val.isoformat()}'")
                                        else:
                                            values.append(str(val))

                                    f.write(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(values)});\n")
                        finally:
                            server_cursor.close()

                    except Exception as table_err:
                        f.write(f"-- ERROR: {table} - {table_err}\n")


            file_size = backup_file.stat().st_size

            return {
                "success": True,
                "file": str(backup_file),
                "size": f"{file_size / 1024 / 1024:.2f} MB",
                "tables": tables,
                "method": "python_export",
                "message": f"SQL 백업 완료: {backup_file.name}"
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/backup/export/csv")
async def export_csv_backup(request: Request):
    """CSV 파일로 내보내기 (COPY TO 활용 - 메모리 효율적)"""
    from pathlib import Path

    try:
        data = await request.json() if request else {}
        tables = data.get('tables', ['all'])

        # 백업 디렉토리 생성
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = Path("backups") / f"csv_{timestamp}"
        backup_dir.mkdir(parents=True, exist_ok=True)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 백업 대상 테이블
            core_tables = [
                'business_locations', 'site_groups', 'site_categories',
                'category_slots', 'meal_slot_settings',
                'menu_recipes', 'menu_recipe_ingredients',
                'ingredients', 'meal_plans', 'meal_counts'
            ]

            if 'all' not in tables:
                core_tables = [t for t in core_tables if t in tables]

            results = {}
            total_size = 0

            for table in core_tables:
                try:
                    # 건수 조회
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    row_count = cursor.fetchone()[0]

                    csv_file = backup_dir / f"{table}.csv"

                    # COPY TO로 PostgreSQL이 직접 CSV 스트리밍
                    with open(csv_file, 'wb') as f:
                        cursor.copy_expert(
                            f"COPY {table} TO STDOUT WITH (FORMAT CSV, HEADER true, ENCODING 'UTF8')",
                            f
                        )

                    file_size = csv_file.stat().st_size
                    total_size += file_size
                    results[table] = {
                        "success": True,
                        "records": row_count,
                        "size": f"{file_size / 1024:.1f} KB"
                    }

                except Exception as table_err:
                    results[table] = {"success": False, "error": str(table_err)}

            cursor.close()

            return {
                "success": True,
                "directory": str(backup_dir),
                "total_size": f"{total_size / 1024 / 1024:.2f} MB",
                "tables": results,
                "message": f"CSV 백업 완료: {len(core_tables)}개 테이블"
            }

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/export/list")
async def list_export_backups():
    """내보내기 백업 파일 목록"""
    from pathlib import Path

    try:
        backup_dir = Path("backups")
        if not backup_dir.exists():
            return {"success": True, "backups": []}

        backups = []

        # SQL 파일
        for f in backup_dir.glob("*.sql"):
            backups.append({
                "type": "sql",
                "name": f.name,
                "path": str(f),
                "size": f"{f.stat().st_size / 1024 / 1024:.2f} MB",
                "created": datetime.fromtimestamp(f.stat().st_mtime).isoformat()
            })

        # CSV 디렉토리
        for d in backup_dir.glob("csv_*"):
            if d.is_dir():
                total_size = sum(f.stat().st_size for f in d.glob("*.csv"))
                file_count = len(list(d.glob("*.csv")))
                backups.append({
                    "type": "csv",
                    "name": d.name,
                    "path": str(d),
                    "size": f"{total_size / 1024 / 1024:.2f} MB",
                    "files": file_count,
                    "created": datetime.fromtimestamp(d.stat().st_mtime).isoformat()
                })

        # 최신순 정렬
        backups.sort(key=lambda x: x['created'], reverse=True)

        return {"success": True, "backups": backups}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/backup/scheduler/status")
async def get_scheduler_status():
    """스케줄러 상태 확인"""
    global scheduler

    if scheduler is None:
        return {"success": True, "running": False, "message": "스케줄러가 시작되지 않음"}

    try:
        jobs_info = []
        for job_id in ['daily_backup', 'deactivate_expired']:
            job = scheduler.get_job(job_id)
            if job:
                jobs_info.append({
                    "id": job_id,
                    "name": job.name,
                    "next_run": str(job.next_run_time) if job.next_run_time else None
                })

        if jobs_info:
            return {
                "success": True,
                "running": True,
                "jobs": jobs_info,
                "message": f"스케줄러 실행 중 ({len(jobs_info)}개 작업)"
            }
        else:
            return {"success": True, "running": True, "message": "스케줄러 실행 중 (작업 없음)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/backup/schedule/check")
async def check_backup_schedule():
    """백업 스케줄 상태 확인 - 어떤 백업이 필요한지 체크"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            result = {
                "daily_snapshot_needed": False,
                "ingredients_backup_needed": False,
                "last_daily_snapshot": None,
                "last_ingredients_backup": None,
                "days_since_ingredients_backup": None
            }

            # 마지막 일일 스냅샷 확인
            cursor.execute("SELECT MAX(snapshot_date) FROM daily_snapshots")
            last_snapshot = cursor.fetchone()[0]
            if last_snapshot:
                result["last_daily_snapshot"] = str(last_snapshot)
                today = datetime.now().date()
                if last_snapshot < today:
                    result["daily_snapshot_needed"] = True
            else:
                result["daily_snapshot_needed"] = True

            # 마지막 식자재 백업 확인 (15일 주기)
            cursor.execute("""
                SELECT created_at FROM backup_metadata
                WHERE table_name = 'ingredients' AND backup_type IN ('full_backup', 'csv_file_backup')
                ORDER BY created_at DESC LIMIT 1
            """)
            last_ing_backup = cursor.fetchone()
            if last_ing_backup:
                result["last_ingredients_backup"] = str(last_ing_backup[0])
                days_since = (datetime.now() - last_ing_backup[0]).days
                result["days_since_ingredients_backup"] = days_since
                if days_since >= 15:
                    result["ingredients_backup_needed"] = True
            else:
                result["ingredients_backup_needed"] = True
                result["days_since_ingredients_backup"] = 999

            cursor.close()

            return {"success": True, **result}

    except Exception as e:
        traceback.print_exc()
        return {"success": False, "error": str(e)}
