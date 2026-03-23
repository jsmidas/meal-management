"""
recipe_export.json에서 식자재 및 레시피 데이터를 DB에 시딩하는 스크립트
"""
import json
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def seed():
    # recipe_export.json 로드
    with open("recipe_export.json", "r", encoding="utf-8") as f:
        recipes = json.load(f)

    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()

    # 1. 식자재 추출 (중복 제거: ingredient_code 기준)
    ingredients_map = {}
    for recipe in recipes:
        for ing in recipe.get("ingredients", []):
            code = ing.get("ingredient_code", "").strip()
            if not code:
                continue
            # 동일 코드면 마지막 데이터로 덮어쓰기
            ingredients_map[code] = {
                "code": code,
                "name": ing.get("ingredient_name", "").strip(),
                "specification": ing.get("specification", "").strip(),
                "unit": ing.get("unit", "").strip(),
                "selling_price": float(ing.get("selling_price", 0) or 0),
                "supplier_name": ing.get("supplier_name", "").strip(),
                "required_grams": float(ing.get("required_grams", 0) or 0),
            }

    print(f"[SEED] 고유 식자재: {len(ingredients_map)}개")

    # 2. 공급업체 등록
    suppliers = set(v["supplier_name"] for v in ingredients_map.values() if v["supplier_name"])
    for sup_name in suppliers:
        cursor.execute("""
            INSERT INTO suppliers (name, is_active, created_at)
            VALUES (%s, TRUE, NOW())
            ON CONFLICT DO NOTHING
        """, (sup_name,))
    conn.commit()
    print(f"[SEED] 공급업체 등록: {len(suppliers)}개")

    # 3. suppliers 테이블에 UNIQUE 제약 확인/추가
    try:
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_name_key'
                ) THEN
                    ALTER TABLE suppliers ADD CONSTRAINT suppliers_name_key UNIQUE (name);
                END IF;
            END $$;
        """)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[SEED] suppliers unique 제약 스킵: {e}")

    # 4. ingredients 테이블에 누락 컬럼 추가
    for col, col_def in [
        ("ingredient_name", "VARCHAR(200)"),
        ("ingredient_code", "VARCHAR(50)"),
        ("selling_price", "FLOAT DEFAULT 0"),
        ("posting_status", "VARCHAR(10) DEFAULT '유'"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS {col} {col_def}")
            conn.commit()
        except Exception:
            conn.rollback()

    # 5. ingredient_code UNIQUE 제약 확인 (이미 있으면 스킵)
    # main.py에서 ingredient_code UNIQUE로 생성됨

    # 6. 식자재 일괄 등록
    inserted = 0
    updated = 0
    errors = 0
    for ing in ingredients_map.values():
        try:
            cursor.execute("""
                INSERT INTO ingredients (ingredient_code, name, ingredient_name, specification, unit, price, selling_price, supplier_name, base_weight_grams, is_active, posting_status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, '유', NOW(), NOW())
                ON CONFLICT (ingredient_code) DO UPDATE SET
                    name = EXCLUDED.name,
                    ingredient_name = EXCLUDED.ingredient_name,
                    specification = EXCLUDED.specification,
                    unit = EXCLUDED.unit,
                    price = EXCLUDED.price,
                    selling_price = EXCLUDED.selling_price,
                    supplier_name = EXCLUDED.supplier_name,
                    base_weight_grams = EXCLUDED.base_weight_grams,
                    updated_at = NOW()
            """, (
                ing["code"],
                ing["name"],
                ing["name"],
                ing["specification"],
                ing["unit"],
                ing["selling_price"],
                ing["selling_price"],
                ing["supplier_name"],
                ing["required_grams"] if ing["required_grams"] > 0 else 1000,
            ))
            if cursor.statusmessage.startswith("INSERT"):
                inserted += 1
            else:
                updated += 1
        except Exception as e:
            conn.rollback()
            errors += 1
            if errors <= 3:
                print(f"[SEED ERROR] {ing['code']}: {e}")
            continue

    conn.commit()
    print(f"[SEED] 식자재 완료: 신규 {inserted}, 업데이트 {updated}, 에러 {errors}")

    # 7. 레시피 등록
    recipe_inserted = 0
    recipe_errors = 0
    for recipe in recipes:
        recipe_name = recipe.get("recipe_name", "").strip()
        if not recipe_name:
            continue
        category = recipe.get("category", "").strip()
        cooking_note = recipe.get("cooking_note", "").strip()
        cooking_yield_rate = float(recipe.get("cooking_yield_rate", 100) or 100)

        try:
            cursor.execute("""
                INSERT INTO menu_recipes (recipe_name, base_name, category, cooking_note, cooking_yield_rate, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                RETURNING id
            """, (recipe_name, recipe_name, category, cooking_note, cooking_yield_rate))
            recipe_id = cursor.fetchone()[0]

            # 레시피 식자재 등록
            for ing in recipe.get("ingredients", []):
                code = ing.get("ingredient_code", "").strip()
                if not code:
                    continue
                cursor.execute("""
                    INSERT INTO menu_recipe_ingredients (recipe_id, ingredient_code, ingredient_name, specification, unit, quantity, selling_price, supplier_name, required_grams)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    recipe_id,
                    code,
                    ing.get("ingredient_name", ""),
                    ing.get("specification", ""),
                    ing.get("unit", ""),
                    float(ing.get("quantity", 0) or 0),
                    float(ing.get("selling_price", 0) or 0),
                    ing.get("supplier_name", ""),
                    float(ing.get("required_grams", 0) or 0),
                ))

            recipe_inserted += 1
        except Exception as e:
            conn.rollback()
            recipe_errors += 1
            if recipe_errors <= 3:
                print(f"[SEED RECIPE ERROR] {recipe_name}: {e}")
            continue

    conn.commit()
    print(f"[SEED] 레시피 완료: {recipe_inserted}개 등록, {recipe_errors}개 에러")

    cursor.close()
    conn.close()
    print("[SEED] 완료!")


if __name__ == "__main__":
    seed()
