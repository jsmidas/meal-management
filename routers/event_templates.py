"""
행사/특별식 템플릿 관리 API
"""
from fastapi import APIRouter, Request, Query
from core.database import get_db_connection
import json

router = APIRouter()


def init_event_tables():
    """테이블 및 컬럼 초기화 (마이그레이션)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # event_categories 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_categories (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(50) UNIQUE NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    is_system BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    sort_order INTEGER DEFAULT 0,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # event_templates 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_templates (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    category VARCHAR(50),
                    category_name VARCHAR(200),
                    price_tier VARCHAR(50),
                    selling_price DECIMAL(12, 2) DEFAULT 0,
                    base_serving INTEGER DEFAULT 1,
                    description TEXT,
                    notes TEXT,
                    tags TEXT,
                    is_shared BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    total_ingredient_cost DECIMAL(12, 2) DEFAULT 0,
                    ingredient_cost_ratio DECIMAL(5, 2) DEFAULT 0,
                    ingredient_cost_per_person DECIMAL(12, 2) DEFAULT 0,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # event_template_menus 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_template_menus (
                    id SERIAL PRIMARY KEY,
                    template_id INTEGER NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
                    menu_id INTEGER,
                    menu_name VARCHAR(200),
                    quantity DECIMAL(10, 2) DEFAULT 1,
                    unit VARCHAR(50),
                    unit_price DECIMAL(12, 2) DEFAULT 0,
                    notes TEXT,
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 기본 카테고리 is_system=true로 업데이트
            cursor.execute("""
                UPDATE event_categories SET is_system = TRUE
                WHERE code IN ('buffet', 'lunchbox', 'salad', 'event')
            """)

            # event_template_menu_ingredients 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_template_menu_ingredients (
                    id SERIAL PRIMARY KEY,
                    template_menu_id INTEGER NOT NULL REFERENCES event_template_menus(id) ON DELETE CASCADE,
                    ingredient_code VARCHAR(50),
                    ingredient_name VARCHAR(200),
                    specification VARCHAR(200),
                    unit VARCHAR(50),
                    selling_price DECIMAL(12, 2) DEFAULT 0,
                    quantity DECIMAL(10, 4) DEFAULT 0,
                    amount DECIMAL(12, 2) DEFAULT 0,
                    base_quantity DECIMAL(10, 2) DEFAULT 0,
                    required_grams DECIMAL(10, 2) DEFAULT 0,
                    supplier_name VARCHAR(200),
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_etmi_template_menu
                ON event_template_menu_ingredients(template_menu_id)
            """)

            # 기준용량 컬럼 추가 (기존 테이블인 경우)
            cursor.execute("""
                ALTER TABLE event_template_menu_ingredients
                ADD COLUMN IF NOT EXISTS base_quantity DECIMAL(10, 2) DEFAULT 0
            """)

            # 누락 컬럼 추가 (기존 테이블인 경우)
            cursor.execute("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS ingredient_cost_per_person DECIMAL(12, 2) DEFAULT 0")
            cursor.execute("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS total_ingredient_cost DECIMAL(12, 2) DEFAULT 0")
            cursor.execute("ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS ingredient_cost_ratio DECIMAL(5, 2) DEFAULT 0")

            # event_categories에 sort_order 컬럼 (display_order로 만들어진 경우 대비)
            cursor.execute("ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0")

            # event_template_images 테이블 생성
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_template_images (
                    id SERIAL PRIMARY KEY,
                    template_id INTEGER NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
                    image_data TEXT,
                    image_order INTEGER DEFAULT 0,
                    caption VARCHAR(200),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.commit()
            print("[event_templates] 테이블 초기화 완료")
    except Exception as e:
        print(f"[event_templates] 테이블 초기화 오류: {e}")


# 초기화 실행
init_event_tables()


# =====================
# 카테고리 API
# =====================

@router.get("/api/event/categories")
async def get_event_categories():
    """카테고리 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, code, name, sort_order,
                       COALESCE(is_system, FALSE) as is_system
                FROM event_categories
                WHERE is_active = true
                ORDER BY sort_order
            """)

            categories = []
            for row in cursor.fetchall():
                categories.append({
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "sort_order": row[3],
                    "is_system": row[4]
                })

            return {"success": True, "categories": categories}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/event/categories")
async def create_event_category(request: Request):
    """새 카테고리 추가 (코드 자동 생성)"""
    try:
        data = await request.json()
        name = data.get('name', '').strip()

        if not name:
            return {"success": False, "error": "카테고리 이름을 입력하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 이름 중복 체크
            cursor.execute("SELECT id FROM event_categories WHERE name = %s", (name,))
            if cursor.fetchone():
                return {"success": False, "error": "이미 존재하는 카테고리 이름입니다."}

            # 가장 큰 ID 조회하여 코드 자동 생성
            cursor.execute("SELECT COALESCE(MAX(id), 0) FROM event_categories")
            max_id = cursor.fetchone()[0]
            code = f"custom_{max_id + 1}"

            # 가장 큰 sort_order 조회
            cursor.execute("SELECT COALESCE(MAX(sort_order), 0) FROM event_categories")
            max_order = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO event_categories (code, name, sort_order, is_system, is_active)
                VALUES (%s, %s, %s, FALSE, TRUE)
                RETURNING id
            """, (code, name, max_order + 1))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {
                "success": True,
                "message": "카테고리가 추가되었습니다.",
                "category": {"id": new_id, "code": code, "name": name}
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/event/categories/{category_id}")
async def delete_event_category(category_id: int):
    """카테고리 삭제 (사용 중이 아닌 경우만)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 시스템 카테고리 여부 및 사용 여부 확인
            cursor.execute("""
                SELECT c.code, c.name, COALESCE(c.is_system, FALSE),
                       (SELECT COUNT(*) FROM event_templates t WHERE t.category = c.code AND t.is_active = TRUE)
                FROM event_categories c WHERE c.id = %s
            """, (category_id,))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "카테고리를 찾을 수 없습니다."}

            code, name, is_system, template_count = row

            if is_system:
                return {"success": False, "error": f"'{name}'은(는) 시스템 기본 카테고리이므로 삭제할 수 없습니다."}

            if template_count > 0:
                return {"success": False, "error": f"'{name}' 카테고리에 {template_count}개의 템플릿이 있어 삭제할 수 없습니다."}

            cursor.execute("DELETE FROM event_categories WHERE id = %s", (category_id,))
            conn.commit()

            return {"success": True, "message": f"'{name}' 카테고리가 삭제되었습니다."}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 식자재 검색 API
# =====================

@router.get("/api/event/search-ingredients")
async def search_ingredients_for_event(
    q: str = Query(..., min_length=1),
    supplier_id: int = Query(None, description="협력업체 ID로 필터링")
):
    """식자재 검색 (자동완성용) - 단위당 단가 낮은 순, 비활성 업체 제외"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            search_term = f"%{q}%"

            # 특정 협력업체로 필터링하는 경우
            supplier_filter = ""
            supplier_name_for_filter = None
            if supplier_id:
                cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
                supplier_row = cursor.fetchone()
                if supplier_row:
                    supplier_name_for_filter = supplier_row[0]
                    supplier_filter = " AND supplier_name = %s"

            # 비활성 업체(is_active = false) 목록 조회 - 특정 협력업체 필터 없을 때만
            inactive_filter = ""
            inactive_suppliers = []
            if not supplier_id:
                cursor.execute("SELECT name FROM suppliers WHERE is_active = false")
                inactive_suppliers = [row[0] for row in cursor.fetchall()]
                if inactive_suppliers:
                    placeholders = ','.join(['%s'] * len(inactive_suppliers))
                    inactive_filter = f" AND (supplier_name IS NULL OR supplier_name NOT IN ({placeholders}))"

            # 파라미터 구성
            params = [search_term, search_term]
            if supplier_name_for_filter:
                params.append(supplier_name_for_filter)
            params.extend(inactive_suppliers)

            cursor.execute(f"""
                SELECT ingredient_code, ingredient_name, specification, unit, selling_price,
                       supplier_name, price_per_unit, COALESCE(base_weight_grams, 0)
                FROM ingredients
                WHERE (ingredient_name ILIKE %s OR ingredient_code ILIKE %s)
                {supplier_filter}
                {inactive_filter}
                ORDER BY COALESCE(price_per_unit, 999999) ASC
                LIMIT 50
            """, params)

            ingredients = []
            for row in cursor.fetchall():
                ingredients.append({
                    "code": row[0] or '',
                    "name": row[1] or '',
                    "specification": row[2] or '',
                    "unit": row[3] or '',
                    "selling_price": float(row[4]) if row[4] else 0,
                    "supplier_name": row[5] or '',
                    "price_per_unit": float(row[6]) if row[6] else 0,
                    "base_weight_grams": float(row[7]) if row[7] else 0
                })

            return {"success": True, "ingredients": ingredients}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "ingredients": []}


# =====================
# 새 레시피 생성 API
# =====================

@router.post("/api/event/create-recipe")
async def create_recipe_from_event(request: Request):
    """행사 템플릿에서 새 레시피 생성"""
    try:
        data = await request.json()
        recipe_name = data.get('name', '').strip()
        category = data.get('category', '기타')
        ingredients = data.get('ingredients', [])

        if not recipe_name:
            return {"success": False, "error": "레시피 이름을 입력하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 중복 체크
            cursor.execute("SELECT id FROM menu_recipes WHERE recipe_name = %s", (recipe_name,))
            existing = cursor.fetchone()
            if existing:
                return {"success": False, "error": "이미 존재하는 레시피 이름입니다."}

            # 레시피 코드 생성
            cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM menu_recipes")
            next_id = cursor.fetchone()[0]
            recipe_code = f"R{next_id:04d}"

            # 레시피 저장
            cursor.execute("""
                INSERT INTO menu_recipes (recipe_code, recipe_name, base_name, category, scope)
                VALUES (%s, %s, %s, %s, 'global')
                RETURNING id
            """, (recipe_code, recipe_name, recipe_name, category))

            recipe_id = cursor.fetchone()[0]

            # 식자재 저장 및 총 원가 계산
            total_cost = 0
            for idx, ing in enumerate(ingredients):
                selling_price = float(ing.get('selling_price', 0))
                quantity = float(ing.get('quantity', 0))
                amount = selling_price * quantity
                total_cost += amount

                cursor.execute("""
                    INSERT INTO menu_recipe_ingredients
                    (recipe_id, ingredient_code, ingredient_name, specification, unit,
                     selling_price, quantity, amount, supplier_name, required_grams, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    recipe_id,
                    ing.get('ingredient_code', ''),
                    ing.get('ingredient_name', ''),
                    ing.get('specification', ''),
                    ing.get('unit', ''),
                    selling_price,
                    quantity,
                    round(amount, 2),
                    ing.get('supplier_name', ''),
                    float(ing.get('required_grams', 0)),
                    idx
                ))

            # 총 원가 업데이트
            cursor.execute("""
                UPDATE menu_recipes SET total_cost = %s WHERE id = %s
            """, (round(total_cost, 2), recipe_id))

            conn.commit()

            return {
                "success": True,
                "message": f"'{recipe_name}' 레시피가 생성되었습니다.",
                "recipe": {
                    "id": recipe_id,
                    "name": recipe_name,
                    "code": recipe_code,
                    "total_cost": round(total_cost, 2)
                }
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 템플릿 API
# =====================

@router.get("/api/event/templates")
async def get_event_templates(
    category: str = Query(None),
    price_tier: int = Query(None),
    search: str = Query(None),
    is_active: bool = Query(True)
):
    """템플릿 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    t.id, t.name, t.category, t.category_name,
                    t.price_tier, t.selling_price, t.ingredient_cost_per_person,
                    t.base_serving, t.description, t.notes, t.tags,
                    t.is_shared, t.is_active, t.created_at,
                    (SELECT COUNT(*) FROM event_template_menus WHERE template_id = t.id) as menu_count,
                    (SELECT COUNT(*) FROM event_template_images WHERE template_id = t.id) as image_count,
                    COALESCE(t.total_ingredient_cost, 0) as total_ingredient_cost,
                    COALESCE(t.ingredient_cost_ratio, 0) as ingredient_cost_ratio
                FROM event_templates t
                WHERE 1=1
            """
            params = []

            if category:
                query += " AND t.category = %s"
                params.append(category)

            if price_tier:
                query += " AND t.price_tier = %s"
                params.append(price_tier)

            if search:
                query += " AND (t.name ILIKE %s OR t.description ILIKE %s)"
                params.extend([f"%{search}%", f"%{search}%"])

            if is_active is not None:
                query += " AND t.is_active = %s"
                params.append(is_active)

            query += " ORDER BY t.category, t.selling_price, t.name"

            cursor.execute(query, params)

            templates = []
            for row in cursor.fetchall():
                templates.append({
                    "id": row[0],
                    "name": row[1],
                    "category": row[2],
                    "category_name": row[3],
                    "price_tier": row[4],
                    "selling_price": row[5],
                    "ingredient_cost_per_person": row[6],
                    "base_serving": row[7],
                    "description": row[8],
                    "notes": row[9],
                    "tags": row[10],
                    "is_shared": row[11],
                    "is_active": row[12],
                    "created_at": row[13].isoformat() if row[13] else None,
                    "menu_count": row[14],
                    "image_count": row[15],
                    "total_ingredient_cost": float(row[16]) if row[16] else 0,
                    "ingredient_cost_ratio": float(row[17]) if row[17] else 0
                })

            return {"success": True, "templates": templates}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.get("/api/event/menu-ingredients/{menu_id}")
async def get_menu_ingredients(menu_id: int):
    """메뉴 레시피의 식자재 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 메뉴 레시피 정보 조회
            cursor.execute("""
                SELECT id, recipe_name, serving_size, total_cost
                FROM menu_recipes
                WHERE id = %s
            """, (menu_id,))

            menu_row = cursor.fetchone()
            if not menu_row:
                return {"success": False, "error": "메뉴를 찾을 수 없습니다."}

            menu_info = {
                "id": menu_row[0],
                "name": menu_row[1],
                "serving_size": menu_row[2] or 1,
                "total_cost": float(menu_row[3]) if menu_row[3] else 0
            }

            # 레시피 식자재 목록 조회 (base_weight_grams 추가, 서브쿼리로 중복 방지)
            cursor.execute("""
                SELECT
                    mri.id,
                    mri.ingredient_code,
                    COALESCE((SELECT ingredient_name FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), mri.ingredient_name) as ingredient_name,
                    COALESCE((SELECT specification FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), '') as specification,
                    COALESCE(mri.unit, (SELECT unit FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), '') as unit,
                    COALESCE((SELECT selling_price FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), 0) as selling_price,
                    mri.quantity,
                    mri.amount,
                    COALESCE(mri.required_grams, 0) as required_grams,
                    COALESCE((SELECT supplier_name FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), '') as supplier_name,
                    COALESCE((SELECT price_per_unit FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), 0) as price_per_unit,
                    COALESCE((SELECT base_weight_grams FROM ingredients WHERE ingredient_code = mri.ingredient_code LIMIT 1), 0) as base_weight_grams
                FROM menu_recipe_ingredients mri
                WHERE mri.recipe_id = %s
                ORDER BY mri.sort_order, mri.id
            """, (menu_id,))

            ingredients = []
            for row in cursor.fetchall():
                ingredients.append({
                    "id": row[0],
                    "ingredient_code": row[1],
                    "ingredient_name": row[2],
                    "specification": row[3],
                    "unit": row[4],
                    "selling_price": float(row[5]) if row[5] else 0,
                    "quantity": float(row[6]) if row[6] else 0,
                    "amount": float(row[7]) if row[7] else 0,
                    "required_grams": float(row[8]) if row[8] else 0,
                    "supplier_name": row[9],
                    "price_per_unit": float(row[10]) if row[10] else 0,
                    "base_quantity": float(row[11]) if row[11] else 0  # 기준용량 (프론트엔드 호환)
                })

            return {
                "success": True,
                "menu": menu_info,
                "ingredients": ingredients
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "ingredients": []}


@router.get("/api/event/templates/{template_id}")
async def get_event_template(template_id: int):
    """템플릿 상세 조회 (메뉴, 식자재, 이미지 포함)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 템플릿 정보
            cursor.execute("""
                SELECT
                    id, name, category, category_name,
                    price_tier, selling_price, ingredient_cost_per_person,
                    base_serving, description, notes, tags,
                    is_shared, is_active, created_at,
                    COALESCE(total_ingredient_cost, 0) as total_ingredient_cost,
                    COALESCE(ingredient_cost_ratio, 0) as ingredient_cost_ratio
                FROM event_templates
                WHERE id = %s
            """, (template_id,))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "템플릿을 찾을 수 없습니다."}

            template = {
                "id": row[0],
                "name": row[1],
                "category": row[2],
                "category_name": row[3],
                "price_tier": row[4],
                "selling_price": row[5],
                "ingredient_cost_per_person": row[6],
                "base_serving": row[7],
                "description": row[8],
                "notes": row[9],
                "tags": row[10],
                "is_shared": row[11],
                "is_active": row[12],
                "created_at": row[13].isoformat() if row[13] else None,
                "total_ingredient_cost": float(row[14]) if row[14] else 0,
                "ingredient_cost_ratio": float(row[15]) if row[15] else 0,
                "menus": [],
                "images": []
            }

            # 메뉴 목록
            cursor.execute("""
                SELECT
                    m.id, m.menu_id, m.menu_name, m.quantity, m.unit,
                    m.unit_price, m.notes, m.sort_order
                FROM event_template_menus m
                WHERE m.template_id = %s
                ORDER BY m.sort_order, m.id
            """, (template_id,))

            menu_rows = cursor.fetchall()
            menu_ids = []
            for item in menu_rows:
                menu_obj = {
                    "id": item[0],
                    "menu_id": item[1],
                    "menu_name": item[2],
                    "quantity": float(item[3]) if item[3] else 1,
                    "unit": item[4],
                    "unit_price": float(item[5]) if item[5] else 0,
                    "notes": item[6],
                    "sort_order": item[7],
                    "ingredients": []
                }
                template["menus"].append(menu_obj)
                menu_ids.append(item[0])

            # 각 메뉴의 저장된 식자재 조회 (ingredients 테이블에서 최신 base_weight_grams도 조회)
            if menu_ids:
                for menu_obj in template["menus"]:
                    cursor.execute("""
                        SELECT etmi.id, etmi.ingredient_code, etmi.ingredient_name, etmi.specification,
                               etmi.unit, etmi.selling_price, etmi.quantity, etmi.amount,
                               COALESCE(etmi.base_quantity, 0), etmi.required_grams,
                               etmi.supplier_name, etmi.sort_order,
                               COALESCE((SELECT base_weight_grams FROM ingredients WHERE ingredient_code = etmi.ingredient_code LIMIT 1), 0) as current_base_weight
                        FROM event_template_menu_ingredients etmi
                        WHERE etmi.template_menu_id = %s
                        ORDER BY etmi.sort_order, etmi.id
                    """, (menu_obj["id"],))

                    for ing_row in cursor.fetchall():
                        saved_base_qty = float(ing_row[8]) if ing_row[8] else 0
                        current_base_weight = float(ing_row[12]) if ing_row[12] else 0
                        # 저장된 값이 없으면 ingredients 테이블의 최신 값 사용
                        final_base_qty = saved_base_qty if saved_base_qty > 0 else current_base_weight

                        menu_obj["ingredients"].append({
                            "id": ing_row[0],
                            "ingredient_code": ing_row[1],
                            "ingredient_name": ing_row[2],
                            "specification": ing_row[3],
                            "unit": ing_row[4],
                            "selling_price": float(ing_row[5]) if ing_row[5] else 0,
                            "quantity": float(ing_row[6]) if ing_row[6] else 0,
                            "amount": float(ing_row[7]) if ing_row[7] else 0,
                            "base_quantity": final_base_qty,
                            "required_grams": float(ing_row[9]) if ing_row[9] else 0,
                            "supplier_name": ing_row[10]
                        })

            # 이미지 목록
            cursor.execute("""
                SELECT id, image_data, image_order, caption
                FROM event_template_images
                WHERE template_id = %s
                ORDER BY image_order, id
            """, (template_id,))

            for img in cursor.fetchall():
                template["images"].append({
                    "id": img[0],
                    "image_data": img[1],
                    "image_order": img[2],
                    "caption": img[3]
                })

            return {"success": True, "template": template}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/event/templates")
async def create_event_template(request: Request):
    """템플릿 생성 (메뉴 및 식자재 포함)"""
    try:
        data = await request.json()

        name = data.get('name')
        category = data.get('category')
        category_name = data.get('category_name')
        price_tier = data.get('price_tier', 0)
        selling_price = data.get('selling_price', 0)
        base_serving = data.get('base_serving', 1)
        description = data.get('description', '')
        notes = data.get('notes', '')
        tags = data.get('tags', '')
        is_shared = data.get('is_shared', False)
        menus = data.get('menus', [])
        images = data.get('images', [])

        if not name:
            return {"success": False, "error": "템플릿명을 입력하세요."}

        if not category:
            return {"success": False, "error": "카테고리를 선택하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 템플릿 저장
            cursor.execute("""
                INSERT INTO event_templates
                (name, category, category_name, price_tier, selling_price,
                 base_serving, description, notes, tags, is_shared)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (name, category, category_name, price_tier, selling_price,
                  base_serving, description, notes, tags, is_shared))

            template_id = cursor.fetchone()[0]

            # 메뉴 저장 및 총 식재료비 계산
            total_ingredient_cost = 0
            for idx, menu in enumerate(menus):
                unit_price = float(menu.get('unit_price', 0))
                quantity = float(menu.get('quantity', 1))
                ingredients = menu.get('ingredients', [])

                cursor.execute("""
                    INSERT INTO event_template_menus
                    (template_id, menu_id, menu_name, quantity, unit, unit_price, notes, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    template_id,
                    menu.get('menu_id'),
                    menu.get('menu_name'),
                    quantity,
                    menu.get('unit', '인분'),
                    unit_price,
                    menu.get('notes'),
                    idx
                ))

                template_menu_id = cursor.fetchone()[0]

                # 메뉴별 식자재 저장
                menu_cost = 0
                for ing_idx, ing in enumerate(ingredients):
                    ing_amount = float(ing.get('amount', 0))
                    menu_cost += ing_amount

                    cursor.execute("""
                        INSERT INTO event_template_menu_ingredients
                        (template_menu_id, ingredient_code, ingredient_name, specification,
                         unit, selling_price, quantity, amount, base_quantity, required_grams, supplier_name, sort_order)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        template_menu_id,
                        ing.get('ingredient_code'),
                        ing.get('ingredient_name'),
                        ing.get('specification'),
                        ing.get('unit'),
                        float(ing.get('selling_price', 0)),
                        float(ing.get('quantity', 0)),
                        ing_amount,
                        float(ing.get('base_quantity', 0)),
                        float(ing.get('required_grams', 0)),
                        ing.get('supplier_name'),
                        ing_idx
                    ))

                # 메뉴 원가 = 식자재비 합계
                total_ingredient_cost += menu_cost * quantity

            # 이미지 저장
            for idx, img in enumerate(images):
                if img.get('image_data'):
                    cursor.execute("""
                        INSERT INTO event_template_images
                        (template_id, image_data, image_order, caption)
                        VALUES (%s, %s, %s, %s)
                    """, (template_id, img.get('image_data'), idx, img.get('caption', '')))

            # 식재료비 및 비율 계산 후 업데이트
            ingredient_cost_ratio = 0
            if selling_price > 0:
                ingredient_cost_ratio = (total_ingredient_cost / selling_price) * 100

            cursor.execute("""
                UPDATE event_templates
                SET total_ingredient_cost = %s,
                    ingredient_cost_ratio = %s,
                    ingredient_cost_per_person = %s
                WHERE id = %s
            """, (total_ingredient_cost, round(ingredient_cost_ratio, 2),
                  int(total_ingredient_cost) if base_serving == 1 else int(total_ingredient_cost / base_serving),
                  template_id))

            conn.commit()

            return {
                "success": True,
                "message": "템플릿이 생성되었습니다.",
                "template_id": template_id,
                "total_ingredient_cost": total_ingredient_cost,
                "ingredient_cost_ratio": round(ingredient_cost_ratio, 2)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.put("/api/event/templates/{template_id}")
async def update_event_template(template_id: int, request: Request):
    """템플릿 수정 (메뉴 및 식자재 포함)"""
    try:
        data = await request.json()

        name = data.get('name')
        category = data.get('category')
        category_name = data.get('category_name')
        price_tier = data.get('price_tier', 0)
        selling_price = data.get('selling_price', 0)
        base_serving = data.get('base_serving', 1)
        description = data.get('description', '')
        notes = data.get('notes', '')
        tags = data.get('tags', '')
        is_shared = data.get('is_shared', False)
        menus = data.get('menus', [])
        images = data.get('images', [])

        if not name:
            return {"success": False, "error": "템플릿명을 입력하세요."}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 템플릿 존재 확인
            cursor.execute("SELECT id FROM event_templates WHERE id = %s", (template_id,))
            if not cursor.fetchone():
                return {"success": False, "error": "템플릿을 찾을 수 없습니다."}

            # 템플릿 업데이트
            cursor.execute("""
                UPDATE event_templates SET
                    name = %s, category = %s, category_name = %s,
                    price_tier = %s, selling_price = %s, base_serving = %s,
                    description = %s, notes = %s, tags = %s, is_shared = %s,
                    updated_at = NOW()
                WHERE id = %s
            """, (name, category, category_name, price_tier, selling_price,
                  base_serving, description, notes, tags, is_shared, template_id))

            # 기존 메뉴 삭제 (CASCADE로 식자재도 삭제됨)
            cursor.execute("DELETE FROM event_template_menus WHERE template_id = %s", (template_id,))

            # 메뉴 및 식자재 저장
            total_ingredient_cost = 0
            for idx, menu in enumerate(menus):
                unit_price = float(menu.get('unit_price', 0))
                quantity = float(menu.get('quantity', 1))
                ingredients = menu.get('ingredients', [])

                cursor.execute("""
                    INSERT INTO event_template_menus
                    (template_id, menu_id, menu_name, quantity, unit, unit_price, notes, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    template_id,
                    menu.get('menu_id'),
                    menu.get('menu_name'),
                    quantity,
                    menu.get('unit', '인분'),
                    unit_price,
                    menu.get('notes'),
                    idx
                ))

                template_menu_id = cursor.fetchone()[0]

                # 메뉴별 식자재 저장
                menu_cost = 0
                for ing_idx, ing in enumerate(ingredients):
                    ing_amount = float(ing.get('amount', 0))
                    menu_cost += ing_amount

                    cursor.execute("""
                        INSERT INTO event_template_menu_ingredients
                        (template_menu_id, ingredient_code, ingredient_name, specification,
                         unit, selling_price, quantity, amount, base_quantity, required_grams, supplier_name, sort_order)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        template_menu_id,
                        ing.get('ingredient_code'),
                        ing.get('ingredient_name'),
                        ing.get('specification'),
                        ing.get('unit'),
                        float(ing.get('selling_price', 0)),
                        float(ing.get('quantity', 0)),
                        ing_amount,
                        float(ing.get('base_quantity', 0)),
                        float(ing.get('required_grams', 0)),
                        ing.get('supplier_name'),
                        ing_idx
                    ))

                total_ingredient_cost += menu_cost * quantity

            # 기존 이미지 삭제 후 다시 저장
            cursor.execute("DELETE FROM event_template_images WHERE template_id = %s", (template_id,))
            for idx, img in enumerate(images):
                if img.get('image_data'):
                    cursor.execute("""
                        INSERT INTO event_template_images
                        (template_id, image_data, image_order, caption)
                        VALUES (%s, %s, %s, %s)
                    """, (template_id, img.get('image_data'), idx, img.get('caption', '')))

            # 식재료비 및 비율 계산 후 업데이트
            ingredient_cost_ratio = 0
            if selling_price > 0:
                ingredient_cost_ratio = (total_ingredient_cost / selling_price) * 100

            cursor.execute("""
                UPDATE event_templates
                SET total_ingredient_cost = %s,
                    ingredient_cost_ratio = %s,
                    ingredient_cost_per_person = %s
                WHERE id = %s
            """, (total_ingredient_cost, round(ingredient_cost_ratio, 2),
                  int(total_ingredient_cost) if base_serving == 1 else int(total_ingredient_cost / base_serving),
                  template_id))

            conn.commit()

            return {
                "success": True,
                "message": "템플릿이 수정되었습니다.",
                "total_ingredient_cost": total_ingredient_cost,
                "ingredient_cost_ratio": round(ingredient_cost_ratio, 2)
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.delete("/api/event/templates/{template_id}")
async def delete_event_template(template_id: int):
    """템플릿 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT name FROM event_templates WHERE id = %s", (template_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "템플릿을 찾을 수 없습니다."}

            template_name = row[0]

            # CASCADE로 자동 삭제됨
            cursor.execute("DELETE FROM event_templates WHERE id = %s", (template_id,))

            conn.commit()

            return {"success": True, "message": f"'{template_name}' 템플릿이 삭제되었습니다."}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@router.post("/api/event/templates/{template_id}/duplicate")
async def duplicate_event_template(template_id: int, request: Request):
    """템플릿 복제 (메뉴 및 식자재 포함)"""
    try:
        data = await request.json()
        new_name = data.get('name')

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 원본 템플릿 조회
            cursor.execute("""
                SELECT name, category, category_name, price_tier, selling_price,
                       ingredient_cost_per_person, base_serving, description, notes, tags, is_shared,
                       COALESCE(total_ingredient_cost, 0), COALESCE(ingredient_cost_ratio, 0)
                FROM event_templates WHERE id = %s
            """, (template_id,))

            row = cursor.fetchone()
            if not row:
                return {"success": False, "error": "원본 템플릿을 찾을 수 없습니다."}

            if not new_name:
                new_name = f"{row[0]} (복사본)"

            # 새 템플릿 생성
            cursor.execute("""
                INSERT INTO event_templates
                (name, category, category_name, price_tier, selling_price,
                 ingredient_cost_per_person, base_serving, description, notes, tags, is_shared,
                 total_ingredient_cost, ingredient_cost_ratio)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (new_name, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10],
                  row[11], row[12]))

            new_template_id = cursor.fetchone()[0]

            # 원본 메뉴 조회
            cursor.execute("""
                SELECT id, menu_id, menu_name, quantity, unit, unit_price, notes, sort_order
                FROM event_template_menus
                WHERE template_id = %s
                ORDER BY sort_order, id
            """, (template_id,))

            original_menus = cursor.fetchall()

            # 메뉴 및 식자재 복제
            for orig_menu in original_menus:
                orig_menu_id = orig_menu[0]

                cursor.execute("""
                    INSERT INTO event_template_menus
                    (template_id, menu_id, menu_name, quantity, unit, unit_price, notes, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (new_template_id, orig_menu[1], orig_menu[2], orig_menu[3],
                      orig_menu[4], orig_menu[5], orig_menu[6], orig_menu[7]))

                new_menu_id = cursor.fetchone()[0]

                # 식자재 복제
                cursor.execute("""
                    INSERT INTO event_template_menu_ingredients
                    (template_menu_id, ingredient_code, ingredient_name, specification,
                     unit, selling_price, quantity, amount, base_quantity, required_grams, supplier_name, sort_order)
                    SELECT %s, ingredient_code, ingredient_name, specification,
                           unit, selling_price, quantity, amount, COALESCE(base_quantity, 0), required_grams, supplier_name, sort_order
                    FROM event_template_menu_ingredients
                    WHERE template_menu_id = %s
                """, (new_menu_id, orig_menu_id))

            # 이미지 복제
            cursor.execute("""
                INSERT INTO event_template_images
                (template_id, image_data, image_order, caption)
                SELECT %s, image_data, image_order, caption
                FROM event_template_images
                WHERE template_id = %s
            """, (new_template_id, template_id))

            conn.commit()

            return {
                "success": True,
                "message": "템플릿이 복제되었습니다.",
                "template_id": new_template_id
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =====================
# 메뉴 검색 API
# =====================

@router.get("/api/event/search-menus")
async def search_menus(q: str = Query(..., min_length=1)):
    """메뉴/레시피 검색"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, recipe_name, category, serving_size,
                       COALESCE(total_cost / NULLIF(serving_size, 0), 0) as cost_per_serving
                FROM menu_recipes
                WHERE recipe_name ILIKE %s AND is_active = true
                ORDER BY recipe_name
                LIMIT 20
            """, (f"%{q}%",))

            menus = []
            for row in cursor.fetchall():
                menus.append({
                    "id": row[0],
                    "name": row[1],
                    "category": row[2],
                    "serving_size": row[3],
                    "cost_per_serving": float(row[4]) if row[4] else 0
                })

            return {"success": True, "menus": menus}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "menus": []}


# =====================
# 가격대 목록 API
# =====================

@router.get("/api/event/price-tiers")
async def get_price_tiers(category: str = Query(None)):
    """카테고리별 가격대 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT DISTINCT price_tier, category
                FROM event_templates
                WHERE is_active = true
            """
            params = []

            if category:
                query += " AND category = %s"
                params.append(category)

            query += " ORDER BY category, price_tier"

            cursor.execute(query, params)

            price_tiers = []
            for row in cursor.fetchall():
                price_tiers.append({
                    "price_tier": row[0],
                    "category": row[1],
                    "display": f"{row[0]:,}원"
                })

            return {"success": True, "price_tiers": price_tiers}

    except Exception as e:
        return {"success": False, "error": str(e)}
