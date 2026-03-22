#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recipes Router
레시피/메뉴 관련 API 엔드포인트
"""

import json
import io
import uuid
import os
import re
from datetime import datetime
from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Request, Body, Query, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from core.database import get_db_connection, fix_encoding

# Cloudinary 유틸리티 (환경변수 미설정 시 로컬 저장)
from utils.cloudinary_utils import (
    CLOUDINARY_ENABLED,
    upload_image_to_cloudinary
)

# 이미지 업로드 설정 (로컬 폴백용)
UPLOAD_DIR = Path("static/uploads")
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


ALLOWED_TABLES = {
    'menu_recipes', 'menu_recipe_ingredients', 'ingredients',
    'orders', 'order_items', 'suppliers', 'users', 'sites',
}

ALLOWED_SEQUENCES = {
    'menu_recipes_id_seq', 'menu_recipe_ingredients_id_seq', 'ingredients_id_seq',
    'orders_id_seq', 'order_items_id_seq', 'suppliers_id_seq', 'users_id_seq', 'sites_id_seq',
}


def fix_sequence(cursor, table_name, seq_name):
    """시퀀스를 현재 최대 ID + 1로 재설정"""
    if table_name not in ALLOWED_TABLES:
        raise ValueError(f"허용되지 않은 테이블명: {table_name}")
    if seq_name not in ALLOWED_SEQUENCES:
        raise ValueError(f"허용되지 않은 시퀀스명: {seq_name}")
    try:
        cursor.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")
        max_id = cursor.fetchone()[0]
        cursor.execute(f"SELECT setval('{seq_name}', %s, false)", (max_id + 1,))
        print(f"[시퀀스 수정] {table_name}: max_id={max_id}, new_seq={max_id + 1}")
        return True
    except Exception as e:
        print(f"[시퀀스 수정 실패] {table_name}: {e}")
        return False

router = APIRouter()


@router.post("/api/search_recipes")
async def search_recipes_compat(request_data: dict = Body(...)):
    """레시피 검색 (최적화 버전) - 동적 조합 표시 지원"""
    try:
        query = request_data.get("query", "")
        keyword = request_data.get("keyword", query)  # keyword도 지원
        limit = request_data.get("limit", 99999)  # 제한 없음

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 사업장/카테고리 약어 포함 조회 (동적 조합용)
            # site_id는 site_groups.id를 참조하므로 site_groups와 JOIN
            base_query = """
                SELECT mr.id, mr.recipe_name, mr.category, mr.cooking_note, mr.created_at, mr.photo_path,
                       mr.site_id, mr.category_id, mr.base_name,
                       CASE
                           WHEN sg.group_name LIKE '%%본사%%' THEN '본사'
                           WHEN sg.group_name LIKE '%%영남%%' THEN '영남'
                           ELSE LEFT(sg.group_name, 2)
                       END AS site_abbr,
                       rc.abbreviation AS cat_abbr,
                       COALESCE(mr.prefix, '') AS prefix,
                       COALESCE(mr.suffix, '') AS suffix,
                       COALESCE(mr.created_by, '') AS created_by
                FROM menu_recipes mr
                LEFT JOIN site_groups sg ON mr.site_id = sg.id
                LEFT JOIN recipe_categories rc ON mr.category_id = rc.id
            """

            search_term = keyword or query
            if search_term:
                cursor.execute(base_query + """
                    WHERE mr.recipe_name ILIKE %s OR mr.base_name ILIKE %s
                    ORDER BY mr.created_at DESC
                    LIMIT %s
                """, (f"%{search_term}%", f"%{search_term}%", limit))
            else:
                cursor.execute(base_query + """
                    ORDER BY mr.created_at DESC
                    LIMIT %s
                """, (limit,))

            recipes = cursor.fetchall()

            # 전체 개수 조회 (캐시용)
            cursor.execute("SELECT COUNT(*) FROM menu_recipes")
            total_count = cursor.fetchone()[0]

            recipe_list = []
            for recipe in recipes:
                photo_path = recipe[5] if recipe[5] else ""
                base_name = fix_encoding(recipe[8]) if recipe[8] else fix_encoding(recipe[1])
                site_abbr = recipe[9] or ""
                cat_abbr = recipe[10] or ""
                prefix = recipe[11] or ""
                suffix = recipe[12] or ""
                created_by = recipe[13] or ""

                # 동적 조합: [접두사 또는 사업장약어]-[base_name]-[접미사 또는 카테고리약어]
                display_prefix = prefix or site_abbr
                display_suffix = suffix or cat_abbr

                # base_name에서 접미사 제거 (중복 방지)
                clean_base = base_name
                if display_suffix and clean_base.endswith(display_suffix):
                    clean_base = clean_base[:-len(display_suffix)].strip()

                display_name = clean_base
                if display_prefix:
                    display_name = f"{display_prefix}-{display_name}"
                if display_suffix:
                    display_name = f"{display_name}-{display_suffix}"

                recipe_list.append({
                    "id": recipe[0],
                    "recipe_code": f"R{recipe[0]:04d}",
                    "recipe_name": fix_encoding(recipe[1]),
                    "name": display_name,  # 🏷️ display_name으로 변경 (접두사-메뉴명-접미사)
                    "base_name": base_name,
                    "display_name": display_name,  # 동적 조합된 표시명
                    "site_id": recipe[6],
                    "category_id": recipe[7],
                    "site_abbr": site_abbr,
                    "cat_abbr": cat_abbr,
                    "prefix": prefix,
                    "suffix": suffix,
                    "created_by": created_by,
                    "category": fix_encoding(recipe[2]) if recipe[2] else "미분류",
                    "description": fix_encoding(recipe[3]) if recipe[3] else "",
                    "total_cost": 0,
                    "serving_size": 1,
                    "cooking_note": fix_encoding(recipe[3]) if recipe[3] else "",
                    "instructions": fix_encoding(recipe[3]) if recipe[3] else "",
                    "has_inactive_supplier": False,  # 목록에서는 체크 안함 (상세에서 확인)
                    "inactive_supplier_names": "",
                    "created_at": str(recipe[4]),
                    "photo_path": photo_path,
                    "thumbnail": photo_path
                })


            return {
                "success": True,
                "recipes": recipe_list,
                "total": total_count,
                "returned": len(recipe_list)
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "recipes": [], "error": str(e)}


@router.get("/api/admin/menus")
async def get_admin_menus():
    """관리자용 메뉴 목록 API"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, recipe_name, category, created_at
                FROM menu_recipes
                ORDER BY created_at DESC
            """)

            menus = cursor.fetchall()

            menu_list = []
            for menu in menus:
                menu_list.append({
                    "id": menu[0],
                    "name": fix_encoding(menu[1]),
                    "recipe_name": fix_encoding(menu[1]),
                    "category": fix_encoding(menu[2]) if menu[2] else "미분류",
                    "total_cost": 0,
                    "serving_size": 1,
                    "created_at": str(menu[3])
                })

            return {
                "success": True,
                "menus": menu_list,
                "total": len(menu_list)
            }

    except Exception as e:
        print(f"메뉴 목록 조회 오류: {e}")
        return {
            "success": False,
            "error": str(e),
            "menus": []
        }


@router.get("/api/admin/menu-recipes")
async def get_admin_menu_recipes(per_page: int = 10, site_id: Optional[int] = None):
    """관리자용 메뉴 레시피 목록 (호환성) - site_id 필터링 지원"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 🏢 site_id 필터링 (owner_site_id 컬럼이 있는 경우)
            site_filter = ""
            params = []
            if site_id:
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'menu_recipes' AND column_name = 'owner_site_id'
                """)
                if cursor.fetchone():
                    # owner_site_id가 NULL(전역) 이거나 해당 사업장 소유인 것만
                    site_filter = " WHERE (owner_site_id IS NULL OR owner_site_id = %s)"
                    params.append(site_id)

            query = f"""
                SELECT id, recipe_name, category, cooking_note, cooking_note, created_at, scope, owner_site_id, photo_path
                FROM menu_recipes
                {site_filter}
                ORDER BY created_at DESC
                LIMIT %s
            """
            params.append(per_page)
            cursor.execute(query, params)

            recipes = cursor.fetchall()
            recipe_list = []
            for recipe in recipes:
                photo_path = recipe[8] if len(recipe) > 8 and recipe[8] else ""
                recipe_list.append({
                    "id": recipe[0],
                    "recipe_code": f"R{recipe[0]:04d}",
                    "recipe_name": fix_encoding(recipe[1]),
                    "name": fix_encoding(recipe[1]),
                    "category": fix_encoding(recipe[2]) if recipe[2] else "미분류",
                    "description": fix_encoding(recipe[3]) if recipe[3] else "",
                    "total_cost": 0,
                    "serving_size": 1,
                    "cooking_note": fix_encoding(recipe[4]) if recipe[4] else "",
                    "instructions": fix_encoding(recipe[4]) if recipe[4] else "",
                    "created_at": str(recipe[5]),
                    "is_active": True,
                    "scope": recipe[6] or "global",
                    "owner_site_id": recipe[7],
                    "photo_path": photo_path,
                    "thumbnail": photo_path  # 프론트엔드 호환용
                })

            # 총 개수 (site_id 필터링 적용)
            count_query = f"SELECT COUNT(*) FROM menu_recipes {site_filter}"
            count_params = params[:-1] if site_filter else []  # per_page 제외
            cursor.execute(count_query, count_params if count_params else None)
            total = cursor.fetchone()[0]


            return {
                "success": True,
                "data": {
                    "recipes": recipe_list,
                    "total": total,
                    "per_page": per_page
                },
                "filteredBySite": site_id
            }
    except Exception as e:
        return {
            "success": False,
            "data": {"recipes": [], "total": 0},
            "error": str(e)
        }

# 루트 엔드포인트

@router.get("/api/admin/menu-recipes/{recipe_id}")
async def get_menu_recipe_detail(recipe_id: int):
    """메뉴 레시피 상세 정보"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 레시피 기본 정보 (cooking_note, photo_path, owner_site_id, cooking_yield_rate, prefix, suffix, category_id 포함)
            cursor.execute("""
                SELECT mr.id, mr.recipe_name, mr.category, mr.created_at, mr.cooking_note, mr.photo_path,
                       mr.owner_site_id, mr.cooking_yield_rate, mr.prefix, mr.suffix, mr.category_id,
                       CASE
                           WHEN sg.group_name LIKE '%%본사%%' THEN '본사'
                           WHEN sg.group_name LIKE '%%영남%%' THEN '영남'
                           ELSE LEFT(sg.group_name, 2)
                       END AS site_abbr,
                       rc.abbreviation AS cat_abbr
                FROM menu_recipes mr
                LEFT JOIN site_groups sg ON mr.site_id = sg.id
                LEFT JOIN recipe_categories rc ON mr.category_id = rc.id
                WHERE mr.id = %s
            """, (recipe_id,))

            recipe = cursor.fetchone()
            if not recipe:
                return {"success": False, "error": "Recipe not found"}

            # 재료 목록 (ingredients 테이블과 JOIN하여 base_weight_grams, ingredient_id 가져오기)
            cursor.execute("""
                SELECT mri.ingredient_code, mri.ingredient_name, mri.specification, mri.unit,
                       mri.delivery_days, mri.selling_price, mri.quantity, mri.amount, mri.supplier_name,
                       i.id as ingredient_id, i.base_weight_grams, COALESCE(i.updated_at, i.created_at) as updated_at, mri.required_grams
                FROM menu_recipe_ingredients mri
                LEFT JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                WHERE mri.recipe_id = %s
            """, (recipe_id,))

            ingredients = cursor.fetchall()


            recipe_data = {
                "id": recipe[0],
                "recipe_code": f"R{recipe[0]:04d}",
                "recipe_name": recipe[1],
                "name": recipe[1],
                "category": recipe[2],
                "total_cost": 0,
                "serving_size": 1,
                "cooking_note": recipe[4] or "",  # cooking_note
                "instructions": recipe[4] or "",  # 호환성
                "created_at": str(recipe[3]),
                "photo_path": recipe[5] or "",    # photo_path
                "owner_site_id": recipe[6],       # 소유 사업장 ID (권한 체크용)
                "cooking_yield_rate": float(recipe[7]) if recipe[7] else 100,  # 조리수율
                "prefix": recipe[8] or "",        # ★ 접두사
                "suffix": recipe[9] or "",        # ★ 접미사
                "category_id": recipe[10],        # ★ 레시피 카테고리 ID
                "site_abbr": recipe[11] or "",    # ★ 사업장 약어 (fallback용)
                "cat_abbr": recipe[12] or ""      # ★ 카테고리 약어 (fallback용)
            }

            ingredients_data = []
            for ing in ingredients:
                quantity = float(ing[6]) if ing[6] else 0
                base_weight = float(ing[10]) if ing[10] else 0
                spec = ing[2] or ''
                unit = (ing[3] or '').upper()

                # DB에서 저장된 required_grams 가져오기 (인덱스 12)
                db_required_grams = float(ing[12]) if ing[12] else 0

                # 기준용량 계산 (base_weight_grams가 없으면 규격에서 추출)
                total_grams = base_weight
                if total_grams <= 0:
                    # 규격에서 숫자+단위 추출 (예: "3.5kg", "500g")
                    spec_match = re.search(r'([\d.]+)\s*(kg|g)', spec, re.IGNORECASE)
                    if spec_match:
                        value = float(spec_match.group(1))
                        spec_unit = spec_match.group(2).lower()
                        if spec_unit == 'kg':
                            total_grams = value * 1000
                        elif spec_unit == 'g':
                            total_grams = value
                    elif unit == 'KG':
                        num_match = re.search(r'([\d.]+)', spec)
                        total_grams = float(num_match.group(1)) * 1000 if num_match else 1000
                    elif unit == 'G':
                        num_match = re.search(r'([\d.]+)', spec)
                        total_grams = float(num_match.group(1)) if num_match else 100

                # 1인필요량(g): DB에 저장된 값 우선 사용, 없으면 계산
                if db_required_grams > 0:
                    required_grams = db_required_grams
                else:
                    required_grams = round(quantity * total_grams) if total_grams > 0 else 0

                ingredients_data.append({
                    "ingredient_code": ing[0],
                    "ingredient_name": ing[1],
                    "specification": ing[2],
                    "unit": ing[3],
                    "delivery_days": ing[4],
                    "selling_price": ing[5],
                    "quantity": quantity,
                    "amount": ing[7],
                    "supplier_name": ing[8],
                    "ingredient_id": ing[9],
                    "base_weight_grams": base_weight if base_weight > 0 else total_grams,
                    "required_grams": required_grams,
                    "created_at": str(ing[11]) if ing[11] else None
                })

            return {
                "success": True,
                "data": {
                    "recipe": recipe_data,
                    "ingredients": ingredients_data
                }
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/api/recipe/save")
async def save_recipe(request: Request):
    """레시피 저장 (FormData 지원)"""
    try:
        form = await request.form()

        recipe_name = form.get('recipe_name', '').strip()

        # 메뉴명 특수문자 검증 (XSS 방지)
        if recipe_name and re.search(r'[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ()&*,/+\[\]\-]', recipe_name):
            return JSONResponse(status_code=400, content={
                "success": False,
                "message": "메뉴명에 허용되지 않는 특수문자가 포함되어 있습니다."
            })

        category = form.get('category', '')
        cooking_note = form.get('cooking_note', '')
        instructions = form.get('instructions', cooking_note)  # instructions 지원
        recipe_id = form.get('recipe_id')  # 수정인 경우
        cooking_yield_rate = float(form.get('cooking_yield_rate', 100) or 100)  # 조리수율

        # 접두사/접미사
        prefix = form.get('prefix', '') or ''
        suffix = form.get('suffix', '') or ''
        print(f"[레시피 저장] prefix='{prefix}', suffix='{suffix}'")  # 디버깅

        # 작성자 정보 가져오기
        created_by = ''
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            try:
                import jwt
                from core.config import SECRET_KEY, ALGORITHM
                token = auth_header.replace('Bearer ', '')
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                created_by = payload.get('sub', '')  # username
            except:
                pass  # 토큰 파싱 실패 시 무시

        # 📷 이미지 처리 (파일 업로드 또는 URL)
        image_url = form.get('image_url', '') or form.get('photo_path', '')

        # 파일 업로드 처리 (image 필드로 파일이 전송된 경우)
        image_file = form.get('image')
        if image_file and hasattr(image_file, 'file'):
            try:
                # 파일 확장자 확인
                filename = image_file.filename or ''
                ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

                if ext in ALLOWED_IMAGE_EXTENSIONS:
                    # 파일 내용 읽기
                    content = await image_file.read()

                    if len(content) <= MAX_IMAGE_SIZE:
                        # Cloudinary 우선 업로드
                        if CLOUDINARY_ENABLED:
                            result = upload_image_to_cloudinary(content, filename)
                            if result["success"]:
                                image_url = result["url"]
                                print(f"[레시피] Cloudinary 업로드 완료: {image_url}")
                            else:
                                print(f"[레시피] Cloudinary 실패, 로컬 저장: {result.get('error')}")
                                # 로컬 폴백
                                year_month = datetime.now().strftime('%Y%m')
                                upload_path = UPLOAD_DIR / year_month
                                upload_path.mkdir(parents=True, exist_ok=True)
                                unique_id = uuid.uuid4().hex[:8]
                                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                                unique_filename = f"{timestamp}_{unique_id}.{ext}"
                                file_path = upload_path / unique_filename
                                with open(file_path, 'wb') as f:
                                    f.write(content)
                                image_url = f"/static/uploads/{year_month}/{unique_filename}"
                                print(f"[레시피] 로컬 업로드 완료: {image_url}")
                        else:
                            # Cloudinary 미설정 - 로컬 저장
                            year_month = datetime.now().strftime('%Y%m')
                            upload_path = UPLOAD_DIR / year_month
                            upload_path.mkdir(parents=True, exist_ok=True)
                            unique_id = uuid.uuid4().hex[:8]
                            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                            unique_filename = f"{timestamp}_{unique_id}.{ext}"
                            file_path = upload_path / unique_filename
                            with open(file_path, 'wb') as f:
                                f.write(content)
                            image_url = f"/static/uploads/{year_month}/{unique_filename}"
                            print(f"[레시피] 로컬 업로드 완료: {image_url}")
            except Exception as img_error:
                print(f"[레시피] 이미지 업로드 실패 (무시됨): {img_error}")

        # 🏢 scope 및 owner_site_id 처리
        scope = form.get('scope', 'global')  # global, group, site
        site_id = form.get('site_id')
        owner_site_id = int(site_id) if site_id and site_id.isdigit() else None
        owner_group_id = None

        # 🏷️ 레시피 카테고리 ID (도시락, 운반 등)
        recipe_category_id_str = form.get('recipe_category_id', '')
        recipe_category_id = int(recipe_category_id_str) if recipe_category_id_str and recipe_category_id_str.isdigit() else None

        # 카테고리 약어 → suffix 강제 동기화 (카테고리가 있으면 항상 약어로 덮어쓰기)
        if recipe_category_id:
            try:
                with get_db_connection() as sync_conn:
                    sync_cursor = sync_conn.cursor()
                    sync_cursor.execute("SELECT abbreviation FROM recipe_categories WHERE id = %s", (recipe_category_id,))
                    cat_row = sync_cursor.fetchone()
                    if cat_row:
                        suffix = cat_row[0] or ''
                        print(f"[레시피 저장] suffix 강제 동기화: '{suffix}' (category_id={recipe_category_id})")
            except Exception as e:
                print(f"[레시피 저장] suffix 동기화 실패: {e}")

        # site 범위인 경우 owner_site_id 필수
        if scope == 'site' and not owner_site_id:
            scope = 'global'  # site_id 없으면 global로 fallback

        if not recipe_name:
            return {"success": False, "error": "Recipe name is required"}

        # 재료 데이터 파싱
        ingredients_json = form.get('ingredients', '[]')
        try:
            ingredients_raw = json.loads(ingredients_json)
        except:
            ingredients_raw = []

        # 🔧 중복 ingredient_code 합치기 (같은 식자재는 quantity/amount 합산)
        ingredients_map = {}
        for ing in ingredients_raw:
            code = ing.get('ingredient_code', '')
            if not code:
                continue
            if code in ingredients_map:
                # 기존 재료에 수량/금액 합산
                ingredients_map[code]['quantity'] = float(ingredients_map[code].get('quantity', 0)) + float(ing.get('quantity', 0))
                ingredients_map[code]['amount'] = float(ingredients_map[code].get('amount', 0)) + float(ing.get('amount', 0))
            else:
                ingredients_map[code] = ing.copy()
        ingredients = list(ingredients_map.values())

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 총 비용 계산
            total_cost = sum(ing.get('amount', 0) for ing in ingredients)

            # 형제 자동 복사 플래그 초기화
            sibling_auto_copied = False
            auto_copied_message = ""

            if recipe_id:  # 기존 레시피 수정 (ID 기준)
                # 📦 변경 전 데이터를 이력 테이블에 저장 (백업) - SAVEPOINT 사용
                try:
                    cursor.execute("SAVEPOINT recipe_backup")
                    cursor.execute("""
                        INSERT INTO menu_recipes_history
                        (original_id, recipe_code, recipe_name, category, cooking_note, total_cost,
                         serving_size, cooking_yield_rate, site_id, action, changed_by)
                        SELECT id, recipe_code, recipe_name, category, cooking_note, total_cost,
                               serving_size, cooking_yield_rate, site_id, 'BEFORE_UPDATE', %s
                        FROM menu_recipes WHERE id = %s
                    """, (created_by or 'api', recipe_id))
                    cursor.execute("RELEASE SAVEPOINT recipe_backup")
                    print(f"[백업] menu_recipes 이력 저장: ID={recipe_id}")
                except Exception as backup_err:
                    # 백업 실패 시 SAVEPOINT로 롤백 (전체 트랜잭션은 유지)
                    print(f"[백업] menu_recipes 이력 저장 실패 (무시하고 계속): {backup_err}")
                    cursor.execute("ROLLBACK TO SAVEPOINT recipe_backup")

                cursor.execute("""
                    UPDATE menu_recipes
                    SET recipe_name = %s, base_name = %s, category = %s, cooking_note = %s,
                        photo_path = CASE WHEN %s = '' THEN photo_path ELSE %s END,
                        scope = %s, owner_site_id = %s, owner_group_id = %s,
                        cooking_yield_rate = %s,
                        site_id = %s, category_id = %s,
                        prefix = %s, suffix = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (recipe_name, recipe_name, category, instructions, image_url, image_url, scope, owner_site_id, owner_group_id, cooking_yield_rate, owner_site_id, recipe_category_id, prefix, suffix, recipe_id))

                # 📦 식자재 변경 이력 저장 - SAVEPOINT 사용
                try:
                    cursor.execute("SAVEPOINT ingredient_audit")
                    cursor.execute("""
                        SELECT ingredient_code, ingredient_name, required_grams, quantity
                        FROM menu_recipe_ingredients WHERE recipe_id = %s
                    """, (recipe_id,))
                    old_ingredients = {row[0]: {'name': row[1], 'grams': row[2], 'qty': row[3]} for row in cursor.fetchall()}

                    # 새 재료 맵 생성
                    new_ingredients = {ing.get('ingredient_code'): {
                        'name': ing.get('ingredient_name', ''),
                        'grams': float(ing.get('required_grams', 0) or 0),
                        'qty': float(ing.get('quantity', 0) or 0)
                    } for ing in ingredients if ing.get('ingredient_code')}

                    # 변경 사항 비교
                    all_codes = set(old_ingredients.keys()) | set(new_ingredients.keys())
                    for code in all_codes:
                        old_ing = old_ingredients.get(code)
                        new_ing = new_ingredients.get(code)

                        if old_ing and not new_ing:
                            # 삭제된 재료
                            cursor.execute("""
                                INSERT INTO menu_recipe_ingredients_audit
                                (recipe_id, recipe_name, ingredient_code, ingredient_name, action,
                                 old_required_grams, old_quantity, changed_by)
                                VALUES (%s, %s, %s, %s, 'DELETE', %s, %s, %s)
                            """, (recipe_id, recipe_name, code, old_ing['name'],
                                  old_ing['grams'], old_ing['qty'], created_by or 'api'))
                        elif new_ing and not old_ing:
                            # 추가된 재료
                            cursor.execute("""
                                INSERT INTO menu_recipe_ingredients_audit
                                (recipe_id, recipe_name, ingredient_code, ingredient_name, action,
                                 new_required_grams, new_quantity, changed_by)
                                VALUES (%s, %s, %s, %s, 'ADD', %s, %s, %s)
                            """, (recipe_id, recipe_name, code, new_ing['name'],
                                  new_ing['grams'], new_ing['qty'], created_by or 'api'))
                        elif old_ing and new_ing:
                            # 수정된 재료 (인당량 또는 수량 변경 시에만)
                            old_grams = float(old_ing['grams'] or 0)
                            new_grams = float(new_ing['grams'] or 0)
                            if abs(old_grams - new_grams) > 0.01:
                                cursor.execute("""
                                    INSERT INTO menu_recipe_ingredients_audit
                                    (recipe_id, recipe_name, ingredient_code, ingredient_name, action,
                                     old_required_grams, new_required_grams, old_quantity, new_quantity, changed_by)
                                    VALUES (%s, %s, %s, %s, 'UPDATE', %s, %s, %s, %s, %s)
                                """, (recipe_id, recipe_name, code, new_ing['name'],
                                      old_grams, new_grams, old_ing['qty'], new_ing['qty'], created_by or 'api'))
                    cursor.execute("RELEASE SAVEPOINT ingredient_audit")
                    print(f"[이력] 식자재 변경 이력 저장 완료: recipe_id={recipe_id}")
                except Exception as audit_err:
                    # 이력 저장 실패 시 SAVEPOINT로 롤백 (전체 트랜잭션은 유지)
                    print(f"[이력] 식자재 변경 이력 저장 실패 (무시하고 계속): {audit_err}")
                    cursor.execute("ROLLBACK TO SAVEPOINT ingredient_audit")

                # 기존 재료 삭제
                cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (recipe_id,))

                result_recipe_id = int(recipe_id)
                recipe_code = f"R{int(recipe_id):04d}"

            else:  # 새 레시피 생성 또는 동일 메뉴 덮어쓰기
                # 동일한 (메뉴명 + 접두사 + 접미사) 조합이 있는지 확인
                cursor.execute("""
                    SELECT id, recipe_code FROM menu_recipes
                    WHERE recipe_name = %s
                      AND COALESCE(prefix, '') = %s
                      AND COALESCE(suffix, '') = %s
                """, (recipe_name, prefix, suffix))

                existing_menu = cursor.fetchone()
                if existing_menu:
                    # 🔄 동일한 조합이 있으면 덮어쓰기 (UPSERT)
                    result_recipe_id = int(existing_menu[0])
                    recipe_code = existing_menu[1] or f"R{result_recipe_id:04d}"

                    cursor.execute("""
                        UPDATE menu_recipes
                        SET base_name = %s, category = %s, cooking_note = %s,
                            photo_path = CASE WHEN %s = '' THEN photo_path ELSE %s END,
                            scope = %s, owner_site_id = %s, owner_group_id = %s,
                            cooking_yield_rate = %s,
                            site_id = %s, category_id = %s,
                            prefix = %s, suffix = %s,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (recipe_name, category, instructions, image_url, image_url, scope, owner_site_id, owner_group_id, cooking_yield_rate, owner_site_id, recipe_category_id, prefix, suffix, result_recipe_id))

                    # 기존 재료 삭제
                    cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (result_recipe_id,))

                    print(f"[레시피] 동일 메뉴 덮어쓰기: '{prefix}-{recipe_name}-{suffix}' (ID: {result_recipe_id})")
                else:
                    # 새 레시피 생성 - 임시 recipe_code로 INSERT 후 ID 기반으로 업데이트
                    # 먼저 시퀀스 동기화 (duplicate key 에러 방지)
                    fix_sequence(cursor, 'menu_recipes', 'menu_recipes_id_seq')

                    # 다음 ID 예측하여 recipe_code 생성
                    cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM menu_recipes")
                    predicted_id = int(cursor.fetchone()[0])
                    temp_recipe_code = f"R{predicted_id:04d}"

                    try:
                        cursor.execute("""
                            INSERT INTO menu_recipes (recipe_code, recipe_name, base_name, category, cooking_note, photo_path, scope, owner_site_id, owner_group_id, cooking_yield_rate, site_id, category_id, prefix, suffix, created_by)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                        """, (temp_recipe_code, recipe_name, recipe_name, category, instructions, image_url or None, scope, owner_site_id, owner_group_id, cooking_yield_rate, owner_site_id, recipe_category_id, prefix, suffix, created_by))

                        result_recipe_id = int(cursor.fetchone()[0])
                    except Exception as insert_error:
                        if 'duplicate key' in str(insert_error).lower():
                            # 시퀀스 재수정 후 재시도
                            conn.rollback()
                            fix_sequence(cursor, 'menu_recipes', 'menu_recipes_id_seq')
                            cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM menu_recipes")
                            predicted_id = int(cursor.fetchone()[0])
                            temp_recipe_code = f"R{predicted_id:04d}"
                            cursor.execute("""
                                INSERT INTO menu_recipes (recipe_code, recipe_name, base_name, category, cooking_note, photo_path, scope, owner_site_id, owner_group_id, cooking_yield_rate, site_id, category_id, prefix, suffix, created_by)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                            """, (temp_recipe_code, recipe_name, recipe_name, category, instructions, image_url or None, scope, owner_site_id, owner_group_id, cooking_yield_rate, owner_site_id, recipe_category_id, prefix, suffix, created_by))
                            result_recipe_id = int(cursor.fetchone()[0])
                        else:
                            raise insert_error

                    # 실제 ID와 다르면 recipe_code 업데이트
                    recipe_code = f"R{result_recipe_id:04d}"
                    if recipe_code != temp_recipe_code:
                        cursor.execute("UPDATE menu_recipes SET recipe_code = %s WHERE id = %s", (recipe_code, result_recipe_id))

                    print(f"[레시피] 새 메뉴 생성: '{recipe_name}' (ID: {result_recipe_id}, 작성자: {created_by})")

                    # 🔄 신규 레시피: 형제 레시피 재료 자동 복사 (요양원 제외)
                    sibling_auto_copied = False
                    auto_copied_message = ""
                    if suffix != '요':
                        try:
                            cursor.execute("""
                                SELECT mr.id, COALESCE(mr.suffix, '') as suffix,
                                       (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id) as ing_count
                                FROM menu_recipes mr
                                WHERE mr.recipe_name = %s
                                  AND COALESCE(mr.prefix, '') = %s
                                  AND mr.id != %s
                                  AND COALESCE(mr.suffix, '') != '요'
                                ORDER BY ing_count DESC
                                LIMIT 1
                            """, (recipe_name, prefix, result_recipe_id))
                            best_sibling = cursor.fetchone()

                            if best_sibling and best_sibling[2] > 0:
                                sibling_id, sibling_suffix, sibling_ing_count = best_sibling
                                # 형제의 재료를 복사
                                cursor.execute("""
                                    SELECT ingredient_code, ingredient_name, specification, unit,
                                           delivery_days, selling_price, quantity, amount, supplier_name, required_grams
                                    FROM menu_recipe_ingredients WHERE recipe_id = %s
                                """, (sibling_id,))
                                sibling_ingredients = cursor.fetchall()

                                for sing in sibling_ingredients:
                                    cursor.execute("""
                                        INSERT INTO menu_recipe_ingredients
                                        (recipe_id, ingredient_code, ingredient_name, specification, unit,
                                         delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                    """, (result_recipe_id, *sing))

                                sibling_display = f"{recipe_name}-{sibling_suffix}" if sibling_suffix else recipe_name
                                auto_copied_message = f"형제 레시피 '{sibling_display}'에서 재료 {sibling_ing_count}개를 자동 복사했습니다."
                                sibling_auto_copied = True
                                print(f"[레시피] 형제 재료 자동 복사: {sibling_display}(ID:{sibling_id}) → ID:{result_recipe_id} ({sibling_ing_count}개)")
                        except Exception as sibling_err:
                            print(f"[레시피] 형제 재료 자동 복사 실패 (무시): {sibling_err}")

            # 재료 추가 (형제 자동 복사된 경우 스킵)
            if not sibling_auto_copied:
                missing_required_grams = []
                for ing in ingredients:
                    req_grams = ing.get('required_grams', 0)
                    # ★★★ 인당량 검증 - 0이면 경고 목록에 추가 ★★★
                    if not req_grams or float(req_grams) <= 0:
                        missing_required_grams.append(ing.get('ingredient_name', '알 수 없음'))

                    cursor.execute("""
                        INSERT INTO menu_recipe_ingredients
                        (recipe_id, ingredient_code, ingredient_name, specification, unit,
                         delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        result_recipe_id,
                        ing.get('ingredient_code', ''),
                        ing.get('ingredient_name', ''),
                        ing.get('specification', ''),
                        ing.get('unit', ''),
                        ing.get('delivery_days', 0),
                        ing.get('selling_price', 0),
                        ing.get('quantity', 0),
                        ing.get('amount', 0),
                        ing.get('supplier_name', ''),
                        req_grams
                    ))

                # 인당량 누락 경고 로그
                if missing_required_grams:
                    print(f"[레시피저장] ⚠️ 인당량(required_grams) 누락: {recipe_name} - {', '.join(missing_required_grams)}")

            # 형제 레시피 감지 (동기화 프롬프트용)
            warnings = []
            sibling_prompt = None

            # suffix가 '요'가 아닌 경우에만 형제 동기화 제안
            if suffix != '요' and not sibling_auto_copied:
                cursor.execute("""
                    SELECT id, recipe_name, COALESCE(suffix, '') as suffix, COALESCE(prefix, '') as prefix,
                           (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id) as ing_count
                    FROM menu_recipes mr
                    WHERE recipe_name = %s
                      AND COALESCE(prefix, '') = %s
                      AND mr.id != %s
                      AND COALESCE(suffix, '') != '요'
                """, (recipe_name, prefix, result_recipe_id))
                siblings = cursor.fetchall()

                if siblings:
                    sibling_list = []
                    for sb in siblings:
                        sb_id, sb_name, sb_suffix, sb_prefix, sb_ing_count = sb
                        display = f"{sb_prefix}-{sb_name}-{sb_suffix}" if sb_prefix and sb_suffix else (f"{sb_name}-{sb_suffix}" if sb_suffix else sb_name)
                        sibling_list.append({
                            "id": sb_id,
                            "suffix": sb_suffix,
                            "display_name": display,
                            "ingredient_count": sb_ing_count
                        })

                    sibling_prompt = {
                        "message": f"형제 레시피 {len(siblings)}개에 재료를 동기화하시겠습니까?",
                        "siblings": sibling_list,
                        "source_id": result_recipe_id
                    }
                    print(f"[레시피저장] 형제 동기화 제안: {len(siblings)}개 ({', '.join(s['display_name'] for s in sibling_list)})")

            # 같은 recipe_name이지만 다른 prefix 가진 레시피 경고 (참고용)
            cursor.execute("""
                SELECT id, recipe_name, COALESCE(suffix, '') as suffix, COALESCE(prefix, '') as prefix,
                       (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id) as ing_count
                FROM menu_recipes mr
                WHERE recipe_name = %s AND id != %s AND COALESCE(prefix, '') != %s
            """, (recipe_name, result_recipe_id, prefix))
            other_prefix_recipes = cursor.fetchall()

            if other_prefix_recipes:
                other_list = []
                for opr in other_prefix_recipes:
                    opr_prefix = opr[3]
                    opr_suffix = opr[2]
                    display = f"{opr_prefix}-{recipe_name}-{opr_suffix}" if opr_prefix else f"{recipe_name}-{opr_suffix}"
                    other_list.append(display)
                warnings.append(f"다른 접두사의 동명 레시피가 있습니다: {', '.join(other_list)}")

            conn.commit()

            result = {
                "success": True,
                "recipe_id": result_recipe_id,
                "recipe_code": recipe_code,
                "message": "Recipe saved successfully"
            }
            if warnings:
                result["warnings"] = warnings
            if sibling_prompt:
                result["sibling_prompt"] = sibling_prompt
            if sibling_auto_copied:
                result["auto_copied"] = True
                result["auto_copied_message"] = auto_copied_message
            return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/api/recipes")
async def get_recipes(site_id: Optional[int] = None):
    """레시피/메뉴 목록 조회 - 식단관리 Ⅱ 페이지용 (최신순, 단가 포함, 사업장별 발주불가 체크)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 🚚 사업장별 허용된 협력업체 목록 조회
            allowed_suppliers = set()
            if site_id:
                cursor.execute("""
                    SELECT s.name FROM customer_supplier_mappings csm
                    JOIN suppliers s ON csm.supplier_id = s.id
                    WHERE csm.customer_id = %s AND csm.is_active = 1
                """, (site_id,))
                allowed_suppliers = set(row[0] for row in cursor.fetchall())
                print(f"[발주가능] 사업장 {site_id}의 허용 협력업체: {len(allowed_suppliers)}개")

            # 메뉴 레시피 조회 + 재료비 합계 + 비활성 협력업체 체크 + display_name용 약어 (최신순 정렬)
            # ★ 성능 최적화: 3개 상관 서브쿼리 → CTE 1회 집계로 변환
            cursor.execute("""
                WITH cost_agg AS (
                    SELECT recipe_id,
                           COALESCE(SUM(amount), 0) as total_cost,
                           COUNT(id) as ingredient_count
                    FROM menu_recipe_ingredients
                    GROUP BY recipe_id
                ),
                supplier_agg AS (
                    SELECT mri.recipe_id,
                           string_agg(DISTINCT mri.supplier_name, ', ') FILTER (WHERE mri.supplier_name IS NOT NULL) as all_supplier_names,
                           string_agg(DISTINCT s.name, ', ') FILTER (WHERE s.is_active = 0) as inactive_supplier_names,
                           bool_or(s.is_active = 0) as has_inactive_supplier
                    FROM menu_recipe_ingredients mri
                    LEFT JOIN suppliers s ON mri.supplier_name = s.name
                    GROUP BY mri.recipe_id
                )
                SELECT mr.id, mr.recipe_name, mr.category,
                       mr.created_at,
                       COALESCE(ca.total_cost, 0) as total_cost,
                       COALESCE(ca.ingredient_count, 0) as ingredient_count,
                       COALESCE(sa.has_inactive_supplier, false) as has_inactive_supplier,
                       sa.inactive_supplier_names,
                       sa.all_supplier_names,
                       mr.base_name,
                       CASE
                           WHEN sg.group_name LIKE '%%본사%%' THEN '본사'
                           WHEN sg.group_name LIKE '%%영남%%' THEN '영남'
                           ELSE LEFT(sg.group_name, 2)
                       END AS site_abbr,
                       COALESCE(NULLIF(mr.suffix, ''), rc.abbreviation) AS display_suffix,
                       mr.prefix
                FROM menu_recipes mr
                LEFT JOIN cost_agg ca ON mr.id = ca.recipe_id
                LEFT JOIN supplier_agg sa ON mr.id = sa.recipe_id
                LEFT JOIN site_groups sg ON mr.site_id = sg.id
                LEFT JOIN recipe_categories rc ON mr.category_id = rc.id
                ORDER BY mr.created_at DESC, mr.id DESC
            """)

            # ★ 새 SELECT 컬럼 순서: id[0], recipe_name[1], category[2], created_at[3],
            #   total_cost[4], ingredient_count[5], has_inactive_supplier[6],
            #   inactive_supplier_names[7], all_supplier_names[8],
            #   base_name[9], site_abbr[10], display_suffix[11], prefix[12]
            recipes = []
            for row in cursor.fetchall():
                recipe_id = int(row[0])
                total_cost = float(row[4]) if row[4] else 0
                ingredient_count = int(row[5]) if row[5] else 0
                has_inactive_supplier = bool(row[6]) if row[6] else False
                inactive_suppliers = row[7] or ""
                all_suppliers_str = row[8] or ""

                # 🏷️ display_name 동적 조합용
                base_name = fix_encoding(row[9]) if row[9] else fix_encoding(row[1])
                site_abbr = row[10] or ""
                display_suffix = row[11] or ""
                prefix = row[12] or ""

                # 동적 조합: [접두사/사업장약어]-[base_name]-[접미사]
                clean_base = base_name
                if display_suffix and clean_base.endswith(display_suffix):
                    clean_base = clean_base[:-len(display_suffix)].strip()
                if prefix and clean_base.startswith(prefix):
                    clean_base = clean_base[len(prefix):].lstrip('-').strip()

                display_name = clean_base
                actual_prefix = prefix if prefix else site_abbr
                if actual_prefix:
                    display_name = f"{actual_prefix}-{display_name}"
                if display_suffix:
                    display_name = f"{display_name}-{display_suffix}"

                # 🚚 사업장에서 발주불가한 협력업체 체크
                has_unavailable_supplier = False
                unavailable_suppliers = []
                if site_id and allowed_suppliers and all_suppliers_str:
                    recipe_suppliers = set(s.strip() for s in all_suppliers_str.split(',') if s.strip())
                    unavailable_suppliers = [s for s in recipe_suppliers if s not in allowed_suppliers]
                    has_unavailable_supplier = len(unavailable_suppliers) > 0

                recipes.append({
                    "id": recipe_id,
                    "display_name": display_name,
                    "name": display_name,
                    "category": fix_encoding(row[2]) if row[2] else "미분류",
                    "total_cost": round(total_cost, 0),
                    "ingredient_count": ingredient_count,
                    "has_inactive_supplier": has_inactive_supplier,
                    "inactive_supplier_names": inactive_suppliers,
                    "has_unavailable_supplier": has_unavailable_supplier,
                    "unavailable_supplier_names": ', '.join(unavailable_suppliers),
                    "created_at": str(row[3]) if row[3] else ""
                })

            cursor.close()

            return {
                "success": True,
                "recipes": recipes,
                "total": len(recipes)
            }

    except Exception as e:
        print(f"[ERROR] get_recipes: {e}")
        return {
            "success": False,
            "error": str(e),
            "recipes": []
        }


@router.post("/api/calculate_menu_costs")
async def calculate_menu_costs(request: Request):
    """메뉴 원가 계산 - 식단관리 Ⅱ 페이지용"""
    try:
        data = await request.json()
        menu_ids = data.get("menu_ids", [])

        if not menu_ids:
            return {"success": False, "error": "메뉴 ID가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 메뉴별 원가 계산
            costs = {}
            for menu_id in menu_ids:
                # 메뉴 기본 정보 (PostgreSQL 실제 컬럼 사용)
                cursor.execute("""
                    SELECT recipe_name
                    FROM menu_recipes
                    WHERE id = %s
                """, (menu_id,))

                menu_row = cursor.fetchone()
                if menu_row:
                    menu_name = fix_encoding(menu_row[0])
                    base_cost = 0  # total_cost 컬럼이 없으므로 0으로 초기화

                    # 재료 기반 계산 (선택사항)
                    cursor.execute("""
                        SELECT COUNT(*)
                        FROM menu_recipe_ingredients
                        WHERE recipe_id = %s
                    """, (menu_id,))

                    ingredient_count = cursor.fetchone()[0]

                    costs[str(menu_id)] = {
                        "menu_name": menu_name,
                        "base_cost": base_cost,
                        "ingredient_count": ingredient_count,
                        "calculated_cost": base_cost,  # 임시로 기본 원가 사용
                        "cost_breakdown": {
                            "ingredients": base_cost * 0.7,
                            "labor": base_cost * 0.2,
                            "overhead": base_cost * 0.1
                        }
                    }

            cursor.close()

            return {
                "success": True,
                "costs": costs
            }

    except Exception as e:
        print(f"[ERROR] calculate_menu_costs: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/menus_ingredients")
async def get_menus_ingredients(menu_ids: str = Query(None)):
    """메뉴별 재료 정보 조회 - 식단관리 Ⅱ 페이지용"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if menu_ids:
                # 특정 메뉴들의 재료 조회
                menu_id_list = [int(x.strip()) for x in menu_ids.split(',') if x.strip().isdigit()]
                placeholders = ','.join(['%s'] * len(menu_id_list))

                cursor.execute(f"""
                    SELECT mri.recipe_id, mri.ingredient_name, mri.ingredient_code,
                           mri.quantity, mri.unit, mr.recipe_name
                    FROM menu_recipe_ingredients mri
                    JOIN menu_recipes mr ON mri.recipe_id = mr.id
                    WHERE mri.recipe_id IN ({placeholders})
                    ORDER BY mri.recipe_id, mri.ingredient_name
                """, menu_id_list)
            else:
                # 모든 메뉴의 재료 조회 (제한적)
                cursor.execute("""
                    SELECT mri.recipe_id, mri.ingredient_name, mri.ingredient_code,
                           mri.quantity, mri.unit, mr.recipe_name
                    FROM menu_recipe_ingredients mri
                    JOIN menu_recipes mr ON mri.recipe_id = mr.id
                    ORDER BY mri.recipe_id, mri.ingredient_name
                    LIMIT 1000
                """)

            # 메뉴별로 재료 그룹화
            menus_ingredients = {}
            for row in cursor.fetchall():
                recipe_id = row[0]
                if recipe_id not in menus_ingredients:
                    menus_ingredients[recipe_id] = {
                        "recipe_id": recipe_id,
                        "recipe_name": fix_encoding(row[5]),
                        "ingredients": []
                    }

                menus_ingredients[recipe_id]["ingredients"].append({
                    "ingredient_name": fix_encoding(row[1]),
                    "ingredient_code": row[2],
                    "quantity": float(row[3]) if row[3] else 0,
                    "unit": fix_encoding(row[4]) if row[4] else ""
                })

            cursor.close()

            return {
                "success": True,
                "menus_ingredients": list(menus_ingredients.values())
            }

    except Exception as e:
        print(f"[ERROR] get_menus_ingredients: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/check_menu_orderability")
async def check_menu_orderability(request: Request):
    """메뉴 발주 가능성 체크 - 식단관리 Ⅱ 페이지용"""
    try:
        data = await request.json()
        menu_ids = data.get("menu_ids", [])
        target_date = data.get("target_date")  # YYYY-MM-DD 형식

        if not menu_ids:
            return {"success": False, "error": "메뉴 ID가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            orderability = {}

            for menu_id in menu_ids:
                # 메뉴 정보 조회
                cursor.execute("""
                    SELECT recipe_name
                    FROM menu_recipes
                    WHERE id = %s
                """, (menu_id,))

                menu_row = cursor.fetchone()
                if not menu_row:
                    orderability[str(menu_id)] = {
                        "orderable": False,
                        "reason": "메뉴를 찾을 수 없습니다",
                        "missing_ingredients": []
                    }
                    continue

                menu_name = fix_encoding(menu_row[0])

                # 재료 체크
                cursor.execute("""
                    SELECT ingredient_name, ingredient_code, quantity, unit
                    FROM menu_recipe_ingredients
                    WHERE recipe_id = %s
                """, (menu_id,))

                ingredients = cursor.fetchall()
                missing_ingredients = []

                # 실제로는 재고나 공급업체 매핑을 체크해야 하지만,
                # 현재는 간단히 재료가 있는지만 체크
                if not ingredients:
                    missing_ingredients.append("재료 정보 없음")

                orderable = len(missing_ingredients) == 0

                orderability[str(menu_id)] = {
                    "menu_name": menu_name,
                    "orderable": orderable,
                    "reason": "발주 가능" if orderable else f"재료 부족: {', '.join(missing_ingredients)}",
                    "missing_ingredients": missing_ingredients,
                    "ingredient_count": len(ingredients),
                    "target_date": target_date
                }

            cursor.close()

            return {
                "success": True,
                "orderability": orderability,
                "summary": {
                    "total_menus": len(menu_ids),
                    "orderable_count": sum(1 for item in orderability.values() if item["orderable"]),
                    "check_date": target_date
                }
            }

    except Exception as e:
        print(f"[ERROR] check_menu_orderability: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/menu-recipes/{recipe_id}")
async def delete_menu_recipe(recipe_id: int):
    """관리자용 메뉴/레시피 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 메뉴 존재 확인
            cursor.execute("""
                SELECT recipe_name FROM menu_recipes WHERE id = %s
            """, (recipe_id,))

            menu = cursor.fetchone()
            if not menu:
                return {
                    "success": False,
                    "error": "해당 메뉴를 찾을 수 없습니다."
                }

            menu_name = menu[0]

            # 관련 재료 데이터 먼저 삭제 (CASCADE로 자동 삭제되지만 명시적으로 확인)
            cursor.execute("""
                DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s
            """, (recipe_id,))

            deleted_ingredients = cursor.rowcount

            # 메뉴 삭제
            cursor.execute("""
                DELETE FROM menu_recipes WHERE id = %s
            """, (recipe_id,))

            conn.commit()

            print(f"[INFO] 메뉴 삭제 완료: ID={recipe_id}, 이름={menu_name}, 재료={deleted_ingredients}개")

            return {
                "success": True,
                "message": f"메뉴 '{menu_name}'가 성공적으로 삭제되었습니다.",
                "deleted_recipe_id": recipe_id,
                "deleted_ingredients_count": deleted_ingredients
            }

    except Exception as e:
        print(f"[ERROR] delete_menu_recipe: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/api/recipe/bulk-upload-sample")
async def download_bulk_upload_sample():
    """대량 업로드용 엑셀 샘플 파일 다운로드"""
    import os
    sample_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                               "static", "templates", "recipe_bulk_upload_template.xlsx")

    if os.path.exists(sample_path):
        return FileResponse(
            sample_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="recipe_bulk_upload_template.xlsx"
        )
    else:
        return {"success": False, "error": "샘플 파일을 찾을 수 없습니다."}


@router.post("/api/recipe/bulk-upload")
async def bulk_upload_recipes(file: UploadFile = File(...)):
    """대량 레시피 업로드 (엑셀 파일)

    엑셀 필수 컬럼:
    - 메뉴명: 레시피 이름
    - 분류: 국, 밥, 찌개, 조림, 무침, 겉절이, 생채, 볶음, 찜, 튀김, 구이, 전
    - 식자재코드: DB의 ingredient_code와 매칭
    - 1인필요량 또는 1인소요량: 숫자 (g 단위) - 둘 중 하나만 있어도 됨

    같은 메뉴명의 행들은 하나의 레시피로 그룹화됨
    """
    import pandas as pd

    try:
        # 엑셀 파일 읽기
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents), engine='openpyxl')

        # 1인필요량/1인소요량 컬럼 통합 처리
        quantity_column = None
        if '1인필요량' in df.columns:
            quantity_column = '1인필요량'
        elif '1인소요량' in df.columns:
            quantity_column = '1인소요량'

        # 필수 컬럼 확인 (1인필요량 또는 1인소요량 중 하나 필수)
        base_required = ['메뉴명', '분류', '식자재코드']
        missing_columns = [col for col in base_required if col not in df.columns]

        if quantity_column is None:
            missing_columns.append('1인필요량 또는 1인소요량')

        if missing_columns:
            return {
                "success": False,
                "error": f"필수 컬럼이 없습니다: {', '.join(missing_columns)}\n\n※ '1인필요량' 또는 '1인소요량' 중 하나만 있으면 됩니다."
            }

        # 통합 컬럼명으로 변환 (내부 처리용)
        df['_quantity'] = df[quantity_column]

        # 빈 값 제거
        df = df.dropna(subset=['메뉴명', '식자재코드'])

        if len(df) == 0:
            return {
                "success": False,
                "error": "유효한 데이터가 없습니다."
            }

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 메뉴별로 그룹화
            grouped = df.groupby(['메뉴명', '분류'])

            created_count = 0
            updated_count = 0
            skipped_count = 0
            error_list = []
            not_found_ingredients = set()

            for (menu_name, category), group in grouped:
                menu_name = str(menu_name).strip()
                category = str(category).strip() if pd.notna(category) else '미분류'

                # 기존 메뉴 확인
                cursor.execute("""
                    SELECT id FROM menu_recipes WHERE recipe_name = %s
                """, (menu_name,))

                existing = cursor.fetchone()

                if existing:
                    recipe_id = existing[0]
                    # 기존 재료 삭제
                    cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (recipe_id,))
                    updated_count += 1
                else:
                    # 새 레시피 생성 - 임시 recipe_code로 INSERT 후 ID 기반으로 업데이트
                    # 시퀀스 동기화 (duplicate key 에러 방지)
                    fix_sequence(cursor, 'menu_recipes', 'menu_recipes_id_seq')

                    # 다음 ID 예측하여 recipe_code 생성
                    cursor.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM menu_recipes")
                    predicted_id = int(cursor.fetchone()[0])
                    temp_recipe_code = f"R{predicted_id:04d}"

                    cursor.execute("""
                        INSERT INTO menu_recipes (recipe_code, recipe_name, category)
                        VALUES (%s, %s, %s) RETURNING id
                    """, (temp_recipe_code, menu_name, category))
                    recipe_id = cursor.fetchone()[0]

                    # 실제 ID와 다르면 recipe_code 업데이트
                    recipe_code = f"R{recipe_id:04d}"
                    if recipe_code != temp_recipe_code:
                        cursor.execute("UPDATE menu_recipes SET recipe_code = %s WHERE id = %s", (recipe_code, recipe_id))
                    created_count += 1

                # 재료 추가
                for _, row in group.iterrows():
                    ingredient_code = str(row['식자재코드']).strip()
                    quantity = float(row['_quantity']) if pd.notna(row['_quantity']) else 0

                    # 식자재 정보 조회
                    cursor.execute("""
                        SELECT ingredient_code, ingredient_name, specification, unit,
                               purchase_price, supplier_name
                        FROM ingredients
                        WHERE ingredient_code = %s
                        LIMIT 1
                    """, (ingredient_code,))

                    ingredient = cursor.fetchone()

                    if ingredient:
                        selling_price = float(ingredient[4]) if ingredient[4] else 0
                        amount = round(selling_price * quantity, 2)
                        # 기준용량에서 1인필요량 계산
                        base_weight = float(ingredient[6]) if len(ingredient) > 6 and ingredient[6] else 1000
                        required_grams = round(quantity * base_weight)

                        cursor.execute("""
                            INSERT INTO menu_recipe_ingredients
                            (recipe_id, ingredient_code, ingredient_name, specification, unit,
                             delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            recipe_id,
                            ingredient[0],  # ingredient_code
                            ingredient[1],  # ingredient_name
                            ingredient[2],  # specification
                            ingredient[3],  # unit
                            0,              # delivery_days
                            selling_price,
                            quantity,
                            amount,
                            ingredient[5],  # supplier_name
                            required_grams
                        ))
                    else:
                        not_found_ingredients.add(ingredient_code)
                        # 식자재를 찾지 못해도 코드와 소요량만으로 저장
                        cursor.execute("""
                            INSERT INTO menu_recipe_ingredients
                            (recipe_id, ingredient_code, ingredient_name, specification, unit,
                             delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            recipe_id,
                            ingredient_code,
                            f"[미등록] {ingredient_code}",
                            "",
                            "",
                            0,
                            0,
                            quantity,
                            0,
                            "",
                            0
                        ))

            conn.commit()

            result = {
                "success": True,
                "message": f"업로드 완료! 신규: {created_count}개, 수정: {updated_count}개",
                "created_count": created_count,
                "updated_count": updated_count,
                "total_rows": len(df),
                "total_menus": created_count + updated_count
            }

            if not_found_ingredients:
                result["warning"] = f"찾을 수 없는 식자재 코드: {', '.join(list(not_found_ingredients)[:10])}"
                if len(not_found_ingredients) > 10:
                    result["warning"] += f" 외 {len(not_found_ingredients) - 10}개"
                result["not_found_count"] = len(not_found_ingredients)

            return result

    except Exception as e:
        print(f"[ERROR] bulk_upload_recipes: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/api/recipe/copy")
async def copy_recipe(request: Request):
    """레시피 복사 - 다른 사업장의 레시피를 내 사업장으로 복사"""
    try:
        data = await request.json()
        source_recipe_id = data.get("recipe_id")
        target_site_id = data.get("site_id")
        new_name = data.get("new_name")  # 선택: 새 이름 지정

        if not source_recipe_id or not target_site_id:
            return {"success": False, "error": "recipe_id와 site_id가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 원본 레시피 정보 조회 (base_name, category_id 포함)
            cursor.execute("""
                SELECT recipe_name, base_name, category, cooking_note, photo_path, category_id, cooking_yield_rate
                FROM menu_recipes WHERE id = %s
            """, (source_recipe_id,))

            source = cursor.fetchone()
            if not source:
                return {"success": False, "error": "원본 레시피를 찾을 수 없습니다"}

            original_name = source[0]
            original_base_name = source[1] or original_name  # base_name이 없으면 recipe_name 사용
            category = source[2]
            cooking_note = source[3]
            photo_path = source[4]
            category_id = source[5]  # 레시피 카테고리 (도시락, 운반 등)
            cooking_yield_rate = source[6] or 100

            # 새 레시피 이름 결정 (base_name 기준)
            if new_name:
                copy_name = new_name
                copy_base_name = new_name
            else:
                # 같은 base_name이 있는지 확인하고 번호 붙이기
                cursor.execute("""
                    SELECT COUNT(*) FROM menu_recipes
                    WHERE base_name LIKE %s AND owner_site_id = %s
                """, (f"{original_base_name}%", target_site_id))
                count = cursor.fetchone()[0]
                if count > 0:
                    copy_base_name = f"{original_base_name} (복사 {count + 1})"
                else:
                    copy_base_name = original_base_name
                copy_name = copy_base_name

            # 새 레시피 생성 (base_name, site_id, category_id 포함)
            # 먼저 시퀀스 동기화 (duplicate key 에러 방지)
            fix_sequence(cursor, 'menu_recipes', 'menu_recipes_id_seq')

            cursor.execute("""
                INSERT INTO menu_recipes (recipe_name, base_name, category, cooking_note, photo_path, owner_site_id, site_id, category_id, cooking_yield_rate, scope, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'site', NOW(), NOW())
                RETURNING id
            """, (copy_name, copy_base_name, category, cooking_note, photo_path, target_site_id, target_site_id, category_id, cooking_yield_rate))

            new_recipe_id = cursor.fetchone()[0]

            # 재료 복사 (required_grams 포함)
            cursor.execute("""
                INSERT INTO menu_recipe_ingredients
                    (recipe_id, ingredient_code, ingredient_name, specification, unit, delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                SELECT %s, ingredient_code, ingredient_name, specification, unit, delivery_days, selling_price, quantity, amount, supplier_name, COALESCE(required_grams, 0)
                FROM menu_recipe_ingredients
                WHERE recipe_id = %s
            """, (new_recipe_id, source_recipe_id))

            copied_count = cursor.rowcount

            conn.commit()

            return {
                "success": True,
                "new_recipe_id": new_recipe_id,
                "new_recipe_name": copy_name,
                "copied_ingredients": copied_count,
                "message": f"레시피가 복사되었습니다: {copy_name}"
            }

    except Exception as e:
        print(f"[ERROR] copy_recipe: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/recipe/find-variants")
async def find_recipe_variants(request: Request):
    """
    복사 시 변형 레시피 검색 - 대상 카테고리에 맞는 변형 레시피 찾기

    요청: {
        "recipe_ids": [123, 456, ...],  // 원본 레시피 ID 목록
        "target_category": "도시락"      // 대상 카테고리명
    }

    응답: {
        "variants": {
            "123": {"id": 789, "name": "갈비탕", "display_name": "본사-갈비탕-도"},
            "456": null  // 변형 없음 - 원본 사용
        }
    }
    """
    import json as json_lib
    try:
        # 수동으로 body 읽기 및 인코딩 처리
        body_bytes = await request.body()
        try:
            body_str = body_bytes.decode('utf-8')
        except UnicodeDecodeError:
            try:
                body_str = body_bytes.decode('cp949')
            except:
                body_str = body_bytes.decode('latin-1', errors='replace')

        data = json_lib.loads(body_str)
        recipe_ids = data.get("recipe_ids", [])
        target_category = data.get("target_category", "")
        target_category_id = data.get("target_category_id")  # 직접 ID 지원

        if not recipe_ids:
            return {"success": True, "variants": {}}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 카테고리명 → category_id 변환 (target_category_id가 없을 때만)
            if not target_category_id and target_category:
                cursor.execute("""
                    SELECT id FROM recipe_categories WHERE name = %s AND is_active = TRUE
                """, (target_category,))
                cat_row = cursor.fetchone()
                if cat_row:
                    target_category_id = cat_row[0]

            variants = {}

            for recipe_id in recipe_ids:
                try:
                    # 원본 레시피의 base_name과 site_id 조회 (id만 먼저)
                    cursor.execute("""
                        SELECT id, site_id, category_id FROM menu_recipes WHERE id = %s
                    """, (recipe_id,))
                    orig_basic = cursor.fetchone()

                    if not orig_basic:
                        variants[str(recipe_id)] = None
                        continue

                    orig_site_id = orig_basic[1]
                    orig_category_id = orig_basic[2]

                    # 이미 대상 카테고리와 같으면 변형 불필요
                    if orig_category_id == target_category_id:
                        variants[str(recipe_id)] = None
                        continue

                    # base_name을 별도 쿼리로 안전하게 조회 (bytes로)
                    try:
                        cursor.execute("""
                            SELECT base_name::bytea FROM menu_recipes WHERE id = %s
                        """, (recipe_id,))
                        bn_row = cursor.fetchone()
                        if bn_row and bn_row[0]:
                            # bytea에서 bytes 추출 후 디코딩 시도
                            raw_bytes = bytes(bn_row[0])
                            try:
                                base_name = raw_bytes.decode('utf-8')
                            except:
                                try:
                                    base_name = raw_bytes.decode('cp949')
                                except:
                                    base_name = raw_bytes.decode('latin-1', errors='replace')
                        else:
                            base_name = None
                    except Exception as e:
                        print(f"[WARN] base_name 조회 실패 recipe_id={recipe_id}: {e}")
                        base_name = None

                    # 변형 레시피 검색 (우선순위: 동일 site_id + 대상 category_id)
                    variant_id = None

                    if target_category_id and base_name:
                        # 1순위: 동일 site_id + 대상 category_id + 동일 base_name
                        if orig_site_id:
                            try:
                                cursor.execute("""
                                    SELECT id FROM menu_recipes
                                    WHERE base_name = %s AND site_id = %s AND category_id = %s
                                    LIMIT 1
                                """, (base_name, orig_site_id, target_category_id))
                                row = cursor.fetchone()
                                if row:
                                    variant_id = row[0]
                            except Exception as e:
                                print(f"[WARN] 1순위 검색 실패: {e}")

                        # 2순위: 대상 category_id + 동일 base_name (site_id 무관)
                        if not variant_id:
                            try:
                                cursor.execute("""
                                    SELECT id FROM menu_recipes
                                    WHERE base_name = %s AND category_id = %s
                                    LIMIT 1
                                """, (base_name, target_category_id))
                                row = cursor.fetchone()
                                if row:
                                    variant_id = row[0]
                            except Exception as e:
                                print(f"[WARN] 2순위 검색 실패: {e}")

                    if variant_id:
                        try:
                            # 변형 레시피 상세 정보 조회 (bytea로)
                            # site_id는 site_groups.id를 참조
                            cursor.execute("""
                                SELECT mr.id,
                                       mr.recipe_name::bytea,
                                       mr.base_name::bytea,
                                       mr.category::bytea,
                                       CASE
                                           WHEN sg.group_name LIKE '%%본사%%' THEN '본사'::bytea
                                           WHEN sg.group_name LIKE '%%영남%%' THEN '영남'::bytea
                                           ELSE LEFT(sg.group_name, 2)::bytea
                                       END AS site_abbr,
                                       rc.abbreviation::bytea AS cat_abbr
                                FROM menu_recipes mr
                                LEFT JOIN site_groups sg ON mr.site_id = sg.id
                                LEFT JOIN recipe_categories rc ON mr.category_id = rc.id
                                WHERE mr.id = %s
                            """, (variant_id,))
                            var_row = cursor.fetchone()

                            if var_row:
                                def safe_decode(bytea_val):
                                    if not bytea_val:
                                        return None
                                    raw = bytes(bytea_val)
                                    for enc in ['utf-8', 'cp949', 'euc-kr', 'latin-1']:
                                        try:
                                            return raw.decode(enc)
                                        except:
                                            continue
                                    return raw.decode('latin-1', errors='replace')

                                var_base_name = safe_decode(var_row[2])
                                var_recipe_name = safe_decode(var_row[1])
                                var_category = safe_decode(var_row[3])
                                site_abbr = safe_decode(var_row[4])
                                cat_abbr = safe_decode(var_row[5])

                                # base_name에서 접미사 제거 (중복 방지)
                                clean_base = var_base_name or var_recipe_name
                                if cat_abbr and clean_base.endswith(cat_abbr):
                                    clean_base = clean_base[:-len(cat_abbr)].strip()

                                display_name = clean_base
                                if site_abbr:
                                    display_name = f"{site_abbr}-{display_name}"
                                if cat_abbr:
                                    display_name = f"{display_name}{cat_abbr}"

                                variants[str(recipe_id)] = {
                                    "id": var_row[0],
                                    "name": var_base_name or var_recipe_name,
                                    "display_name": display_name,
                                    "category": var_category
                                }
                            else:
                                variants[str(recipe_id)] = None
                        except Exception as e:
                            print(f"[WARN] 변형 상세 조회 실패 variant_id={variant_id}: {e}")
                            variants[str(recipe_id)] = None
                    else:
                        variants[str(recipe_id)] = None

                except Exception as e:
                    print(f"[WARN] recipe_id={recipe_id} 처리 실패: {e}")
                    variants[str(recipe_id)] = None


            return {
                "success": True,
                "variants": variants,
                "target_category": target_category,
                "target_category_id": target_category_id
            }

    except Exception as e:
        import traceback
        print(f"[ERROR] find_recipe_variants: {e}")
        traceback.print_exc()
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.get("/api/recipe-categories")
async def get_recipe_categories():
    """레시피 카테고리 목록 조회 (도시락, 운반 등)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, name, abbreviation, parent_id, display_order, is_active
                FROM recipe_categories
                WHERE is_active = TRUE
                ORDER BY display_order, name
            """)

            categories = []
            for row in cursor.fetchall():
                categories.append({
                    "id": row[0],
                    "name": row[1],
                    "abbreviation": row[2],
                    "parent_id": row[3],
                    "display_order": row[4],
                    "is_active": row[5]
                })


            return {
                "success": True,
                "categories": categories
            }

    except Exception as e:
        print(f"[ERROR] get_recipe_categories: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/site/{site_id}/has-categories")
async def check_site_has_categories(site_id: int):
    """사업장의 카테고리 사용 여부 확인"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT has_categories, abbreviation
                FROM business_locations
                WHERE id = %s
            """, (site_id,))

            row = cursor.fetchone()

            if row:
                return {
                    "success": True,
                    "has_categories": bool(row[0]),
                    "abbreviation": row[1]
                }
            else:
                return {
                    "success": False,
                    "error": "사업장을 찾을 수 없습니다",
                    "has_categories": False
                }

    except Exception as e:
        print(f"[ERROR] check_site_has_categories: {e}")
        return {"success": False, "error": str(e)}


# ========== 레시피-식자재 불일치 수정 API ==========

@router.get("/api/recipe/mismatch-list")
async def get_recipe_mismatch_list():
    """레시피-식자재 불일치 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 주요 식재료 키워드
            keywords = [
                '연근', '호두', '김치', '된장', '고추장', '제육', '돼지', '소고기', '닭', '오리',
                '새우', '오징어', '멸치', '고등어', '삼치', '갈치', '조기', '꽁치', '참치',
                '두부', '계란', '달걀', '감자', '고구마', '당근', '양파', '마늘', '파', '배추',
                '시금치', '콩나물', '숙주', '미역', '버섯', '호박', '가지', '오이', '무',
                '떡', '어묵', '라면', '우동', '스파게티', '카레', '짜장',
                '불고기', '갈비', '삼겹', '목살', '안심', '등심',
            ]

            cursor.execute('''
                SELECT mr.id, mr.recipe_name,
                       string_agg(mri.ingredient_name, ' ') as all_ingredients
                FROM menu_recipes mr
                LEFT JOIN menu_recipe_ingredients mri ON mr.id = mri.recipe_id
                GROUP BY mr.id, mr.recipe_name
                ORDER BY mr.id
            ''')

            mismatch_list = []
            for row in cursor.fetchall():
                recipe_id, recipe_name, ingredients = row
                if not recipe_name:
                    continue

                recipe_lower = recipe_name.lower()
                ing_lower = (ingredients or '').lower()

                missing = []
                for kw in keywords:
                    if kw in recipe_lower and kw not in ing_lower:
                        missing.append(kw)

                if missing:
                    mismatch_list.append({
                        "id": recipe_id,
                        "recipe_name": fix_encoding(recipe_name),
                        "missing_keywords": missing,
                        "current_ingredients": fix_encoding(ingredients[:100]) if ingredients else ""
                    })

            return mismatch_list

    except Exception as e:
        print(f"[ERROR] get_recipe_mismatch_list: {e}")
        return []


@router.get("/api/recipe/{recipe_id}/ingredients")
async def get_recipe_ingredients(recipe_id: int):
    """레시피의 식자재 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, ingredient_code, ingredient_name, specification, unit,
                       quantity, selling_price, supplier_name
                FROM menu_recipe_ingredients
                WHERE recipe_id = %s
                ORDER BY id
            """, (recipe_id,))

            ingredients = []
            for row in cursor.fetchall():
                ingredients.append({
                    "id": row[0],
                    "ingredient_code": row[1],
                    "ingredient_name": fix_encoding(row[2]),
                    "specification": fix_encoding(row[3]) if row[3] else "",
                    "unit": row[4],
                    "quantity": float(row[5]) if row[5] else 0,
                    "selling_price": float(row[6]) if row[6] else 0,
                    "supplier_name": fix_encoding(row[7]) if row[7] else ""
                })

            return ingredients

    except Exception as e:
        print(f"[ERROR] get_recipe_ingredients: {e}")
        return []


@router.post("/api/recipe/{recipe_id}/ingredients")
async def add_recipe_ingredient(recipe_id: int, request: Request):
    """레시피에 식자재 추가"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO menu_recipe_ingredients
                (recipe_id, ingredient_code, ingredient_name, specification, unit,
                 quantity, selling_price, supplier_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                recipe_id,
                data.get('ingredient_code', ''),
                data.get('ingredient_name', ''),
                data.get('specification', ''),
                data.get('unit', 'EA'),
                data.get('quantity', 1),
                data.get('selling_price', 0),
                data.get('supplier_name', '')
            ))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {"success": True, "id": new_id}

    except Exception as e:
        print(f"[ERROR] add_recipe_ingredient: {e}")
        return {"success": False, "error": str(e)}


@router.delete("/api/recipe/ingredient/{ingredient_id}")
async def delete_recipe_ingredient(ingredient_id: int):
    """레시피에서 식자재 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM menu_recipe_ingredients WHERE id = %s
            """, (ingredient_id,))

            conn.commit()

            return {"success": True}

    except Exception as e:
        print(f"[ERROR] delete_recipe_ingredient: {e}")
        return {"success": False, "error": str(e)}


@router.put("/api/recipe/ingredient/{ingredient_id}")
async def update_recipe_ingredient(ingredient_id: int, request: Request):
    """식자재 수량 업데이트"""
    try:
        data = await request.json()
        quantity = data.get('quantity', 1)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE menu_recipe_ingredients SET quantity = %s WHERE id = %s
            """, (quantity, ingredient_id))

            conn.commit()

            return {"success": True}

    except Exception as e:
        print(f"[ERROR] update_recipe_ingredient: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/admin/sync-recipe-suffixes")
async def sync_recipe_suffixes():
    """모든 레시피의 suffix를 category_id의 약어(abbreviation)와 일치시키는 일괄 동기화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 변경 전 현황
            cursor.execute("SELECT COUNT(*) FROM menu_recipes WHERE category_id IS NOT NULL")
            has_category = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM menu_recipes WHERE category_id IS NULL")
            no_category = cursor.fetchone()[0]

            # category_id가 있는 레시피: 해당 카테고리의 abbreviation으로 suffix 업데이트
            cursor.execute("""
                UPDATE menu_recipes mr
                SET suffix = rc.abbreviation
                FROM recipe_categories rc
                WHERE mr.category_id = rc.id
                  AND (COALESCE(mr.suffix, '') != COALESCE(rc.abbreviation, ''))
            """)
            updated_with_category = cursor.rowcount

            # category_id가 NULL인 레시피: suffix를 빈 문자열로 초기화
            cursor.execute("""
                UPDATE menu_recipes
                SET suffix = ''
                WHERE category_id IS NULL AND COALESCE(suffix, '') != ''
            """)
            cleared_count = cursor.rowcount

            conn.commit()

            return {
                "success": True,
                "message": f"동기화 완료: {updated_with_category}개 suffix 업데이트, {cleared_count}개 suffix 초기화",
                "stats": {
                    "has_category_count": has_category,
                    "no_category_count": no_category,
                    "updated_with_category": updated_with_category,
                    "cleared_suffix": cleared_count
                }
            }

    except Exception as e:
        print(f"[ERROR] sync_recipe_suffixes: {e}")
        return {"success": False, "error": str(e)}


# ============================================
# 중복 레시피 분석 및 정리
# ============================================

@router.get("/api/recipes/duplicates")
async def get_duplicate_recipes():
    """
    같은 recipe_name에 다른 suffix를 가진 중복 레시피 분석
    - 재료 수가 더 많은 레시피를 '기준' 으로 추천
    - 조리지시서 매칭 문제 가능성 표시
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 같은 recipe_name을 공유하는 레시피 그룹 찾기
            cursor.execute("""
                SELECT mr.recipe_name,
                       json_agg(json_build_object(
                           'id', mr.id,
                           'recipe_code', mr.recipe_code,
                           'suffix', COALESCE(mr.suffix, ''),
                           'display_name', CASE WHEN COALESCE(mr.suffix, '') != ''
                               THEN COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) || '-' || mr.suffix
                               ELSE COALESCE(NULLIF(mr.base_name, ''), mr.recipe_name) END,
                           'ingredient_count', (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id),
                           'total_cost', COALESCE((SELECT SUM(amount) FROM menu_recipe_ingredients WHERE recipe_id = mr.id), 0),
                           'category_id', mr.category_id,
                           'created_at', mr.created_at,
                           'updated_at', mr.updated_at
                       ) ORDER BY (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id) DESC) as recipes,
                       COUNT(*) as variant_count
                FROM menu_recipes mr
                WHERE mr.recipe_name IN (
                    SELECT recipe_name FROM menu_recipes
                    GROUP BY recipe_name HAVING COUNT(*) > 1
                )
                GROUP BY mr.recipe_name
                ORDER BY mr.recipe_name
            """)

            rows = cursor.fetchall()
            duplicates = []
            for row in rows:
                recipe_name, recipes_json, variant_count = row
                recipes = recipes_json if isinstance(recipes_json, list) else json.loads(recipes_json)

                # 재료 수 기준으로 추천 (가장 많은 것)
                recommended = recipes[0] if recipes else None

                duplicates.append({
                    "recipe_name": recipe_name,
                    "variant_count": variant_count,
                    "recommended_id": recommended['id'] if recommended else None,
                    "recommended_display": recommended['display_name'] if recommended else None,
                    "recommended_ingredient_count": recommended['ingredient_count'] if recommended else 0,
                    "variants": recipes
                })

            cursor.close()

            return {
                "success": True,
                "total_duplicate_groups": len(duplicates),
                "duplicates": duplicates
            }

    except Exception as e:
        print(f"[ERROR] get_duplicate_recipes: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/recipe/sync-siblings")
async def sync_sibling_recipes(request: Request):
    """
    형제 레시피 동기화: source_id의 재료를 같은 recipe_name+prefix인 형제들에 복사
    - suffix가 '요'인 레시피는 제외 (요양원 독립)
    - source_id 자신의 suffix가 '요'이면 동기화 거부
    """
    try:
        data = await request.json()
        source_id = data.get('source_id')

        if not source_id:
            return {"success": False, "error": "source_id가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # source 레시피 확인
            cursor.execute("""
                SELECT id, recipe_name, COALESCE(prefix, '') as prefix, COALESCE(suffix, '') as suffix
                FROM menu_recipes WHERE id = %s
            """, (source_id,))
            source = cursor.fetchone()
            if not source:
                return {"success": False, "error": f"레시피 ID {source_id}를 찾을 수 없습니다"}

            source_id, source_name, source_prefix, source_suffix = source

            # 요양원 레시피는 동기화 불가
            if source_suffix == '요':
                return {"success": False, "error": "요양원(-요) 레시피는 형제 동기화 대상이 아닙니다"}

            # source의 재료 조회
            cursor.execute("""
                SELECT ingredient_code, ingredient_name, specification, unit,
                       delivery_days, selling_price, quantity, amount, supplier_name, required_grams
                FROM menu_recipe_ingredients WHERE recipe_id = %s
            """, (source_id,))
            source_ingredients = cursor.fetchall()

            if not source_ingredients:
                return {"success": False, "error": "소스 레시피에 재료가 없습니다"}

            # 형제 레시피 검색 (같은 recipe_name + prefix, suffix != '요', 자기 자신 제외)
            cursor.execute("""
                SELECT id, COALESCE(suffix, '') as suffix
                FROM menu_recipes
                WHERE recipe_name = %s
                  AND COALESCE(prefix, '') = %s
                  AND id != %s
                  AND COALESCE(suffix, '') != '요'
            """, (source_name, source_prefix, source_id))
            siblings = cursor.fetchall()

            if not siblings:
                return {"success": False, "error": "동기화할 형제 레시피가 없습니다"}

            synced_count = 0
            for sibling_id, sibling_suffix in siblings:
                # 이력 백업 (SAVEPOINT)
                try:
                    cursor.execute("SAVEPOINT sibling_sync_backup")

                    # 레시피 메타 백업
                    cursor.execute("""
                        INSERT INTO menu_recipes_history
                        (original_id, recipe_code, recipe_name, category, cooking_note, total_cost,
                         serving_size, cooking_yield_rate, site_id, action, changed_by)
                        SELECT id, recipe_code, recipe_name, category, cooking_note, total_cost,
                               serving_size, cooking_yield_rate, site_id, 'BEFORE_SIBLING_SYNC', 'sibling_sync'
                        FROM menu_recipes WHERE id = %s
                    """, (sibling_id,))

                    # 기존 재료 JSON 백업
                    cursor.execute("""
                        SELECT ingredient_code, ingredient_name, required_grams, quantity, amount
                        FROM menu_recipe_ingredients WHERE recipe_id = %s
                    """, (sibling_id,))
                    old_ingredients = cursor.fetchall()
                    if old_ingredients:
                        ingredients_backup = json.dumps([
                            {"code": r[0], "name": r[1], "grams": float(r[2]) if r[2] else 0,
                             "qty": float(r[3]) if r[3] else 0, "amount": float(r[4]) if r[4] else 0}
                            for r in old_ingredients
                        ], ensure_ascii=False)
                        cursor.execute("""
                            UPDATE menu_recipes_history
                            SET cooking_note = COALESCE(cooking_note, '') || E'\n[형제동기화 전 재료 백업] ' || %s
                            WHERE id = (
                                SELECT id FROM menu_recipes_history
                                WHERE original_id = %s AND action = 'BEFORE_SIBLING_SYNC'
                                ORDER BY id DESC LIMIT 1
                            )
                        """, (ingredients_backup, sibling_id))

                    # 기존 재료 삭제 → source 재료 복사
                    cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (sibling_id,))
                    for ing in source_ingredients:
                        cursor.execute("""
                            INSERT INTO menu_recipe_ingredients
                            (recipe_id, ingredient_code, ingredient_name, specification, unit,
                             delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (sibling_id, *ing))

                    cursor.execute("RELEASE SAVEPOINT sibling_sync_backup")
                    synced_count += 1
                    sibling_display = f"{source_name}-{sibling_suffix}" if sibling_suffix else source_name
                    print(f"[형제동기화] {source_name}: ID {source_id} → ID {sibling_id}({sibling_display}) 재료 동기화 완료")
                except Exception as sync_err:
                    print(f"[형제동기화] 동기화 실패 (ID {sibling_id} 건너뜀): {sync_err}")
                    try:
                        cursor.execute("ROLLBACK TO SAVEPOINT sibling_sync_backup")
                    except Exception:
                        pass
                    continue

            conn.commit()

            return {
                "success": True,
                "synced_count": synced_count,
                "message": f"{source_name}: {synced_count}개 형제 레시피에 재료 동기화 완료 (재료 {len(source_ingredients)}개)"
            }

    except Exception as e:
        print(f"[ERROR] sync_sibling_recipes: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/recipe/sync-all-siblings")
async def sync_all_sibling_recipes(request: Request):
    """
    일괄 형제 동기화: 모든 형제 그룹을 스캔하여 재료 불일치를 자동 정리
    - 같은 recipe_name + prefix 그룹에서 재료가 가장 많은 레시피를 기준으로 동기화
    - suffix가 '요'인 레시피는 제외
    - dry_run=true면 실제 변경 없이 불일치 목록만 반환
    """
    try:
        data = await request.json() if request.headers.get('content-type', '').startswith('application/json') else {}
        dry_run = data.get('dry_run', False)

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 형제 그룹 탐색: 같은 recipe_name+prefix, suffix!='요', 2개 이상인 그룹
            cursor.execute("""
                SELECT recipe_name, COALESCE(prefix, '') as prefix, COUNT(*) as cnt
                FROM menu_recipes
                WHERE COALESCE(suffix, '') != '요'
                GROUP BY recipe_name, COALESCE(prefix, '')
                HAVING COUNT(*) >= 2
                ORDER BY recipe_name
            """)
            groups = cursor.fetchall()

            if not groups:
                return {"success": True, "message": "동기화할 형제 그룹이 없습니다", "groups_checked": 0, "groups_synced": 0}

            total_groups_checked = 0
            total_groups_synced = 0
            total_recipes_synced = 0
            sync_details = []

            for group_name, group_prefix, group_cnt in groups:
                total_groups_checked += 1

                # 그룹 내 모든 레시피와 재료 수 조회
                cursor.execute("""
                    SELECT mr.id, COALESCE(mr.suffix, '') as suffix,
                           (SELECT COUNT(*) FROM menu_recipe_ingredients WHERE recipe_id = mr.id) as ing_count,
                           (SELECT string_agg(ingredient_code, ',' ORDER BY ingredient_code)
                            FROM menu_recipe_ingredients WHERE recipe_id = mr.id) as ing_codes
                    FROM menu_recipes mr
                    WHERE mr.recipe_name = %s
                      AND COALESCE(mr.prefix, '') = %s
                      AND COALESCE(mr.suffix, '') != '요'
                    ORDER BY ing_count DESC
                """, (group_name, group_prefix))
                members = cursor.fetchall()

                if len(members) < 2:
                    continue

                # 재료 코드 목록으로 불일치 감지
                code_sets = set()
                for m in members:
                    code_sets.add(m[3] or '')  # ing_codes

                if len(code_sets) <= 1:
                    # 모든 형제가 동일한 재료 → 스킵
                    continue

                # 기준 레시피: 재료가 가장 많은 것 (이미 ing_count DESC로 정렬됨)
                source_id, source_suffix, source_ing_count, _ = members[0]
                targets = [(m[0], m[1]) for m in members[1:]]

                source_display = f"{group_prefix}-{group_name}-{source_suffix}" if group_prefix and source_suffix else (f"{group_name}-{source_suffix}" if source_suffix else group_name)
                target_displays = []
                for t_id, t_suffix in targets:
                    td = f"{group_name}-{t_suffix}" if t_suffix else group_name
                    target_displays.append(td)

                detail = {
                    "group": f"{group_prefix}-{group_name}" if group_prefix else group_name,
                    "source": source_display,
                    "source_id": source_id,
                    "source_ingredient_count": source_ing_count,
                    "targets": target_displays,
                    "target_count": len(targets)
                }

                if dry_run:
                    sync_details.append(detail)
                    total_groups_synced += 1
                    total_recipes_synced += len(targets)
                    continue

                # 소스 재료 조회
                cursor.execute("""
                    SELECT ingredient_code, ingredient_name, specification, unit,
                           delivery_days, selling_price, quantity, amount, supplier_name, required_grams
                    FROM menu_recipe_ingredients WHERE recipe_id = %s
                """, (source_id,))
                source_ingredients = cursor.fetchall()

                if not source_ingredients:
                    continue

                group_synced = 0
                for target_id, target_suffix in targets:
                    # 이력 백업 (SAVEPOINT)
                    try:
                        cursor.execute("SAVEPOINT batch_sync_backup")

                        cursor.execute("""
                            INSERT INTO menu_recipes_history
                            (original_id, recipe_code, recipe_name, category, cooking_note, total_cost,
                             serving_size, cooking_yield_rate, site_id, action, changed_by)
                            SELECT id, recipe_code, recipe_name, category, cooking_note, total_cost,
                                   serving_size, cooking_yield_rate, site_id, 'BEFORE_BATCH_SYNC', 'batch_sync'
                            FROM menu_recipes WHERE id = %s
                        """, (target_id,))

                        # 기존 재료 JSON 백업
                        cursor.execute("""
                            SELECT ingredient_code, ingredient_name, required_grams, quantity, amount
                            FROM menu_recipe_ingredients WHERE recipe_id = %s
                        """, (target_id,))
                        old_ingredients = cursor.fetchall()
                        if old_ingredients:
                            ingredients_backup = json.dumps([
                                {"code": r[0], "name": r[1], "grams": float(r[2]) if r[2] else 0,
                                 "qty": float(r[3]) if r[3] else 0, "amount": float(r[4]) if r[4] else 0}
                                for r in old_ingredients
                            ], ensure_ascii=False)
                            cursor.execute("""
                                UPDATE menu_recipes_history
                                SET cooking_note = COALESCE(cooking_note, '') || E'\n[일괄동기화 전 재료 백업] ' || %s
                                WHERE id = (
                                    SELECT id FROM menu_recipes_history
                                    WHERE original_id = %s AND action = 'BEFORE_BATCH_SYNC'
                                    ORDER BY id DESC LIMIT 1
                                )
                            """, (ingredients_backup, target_id))

                        # 재료 교체
                        cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (target_id,))
                        for ing in source_ingredients:
                            cursor.execute("""
                                INSERT INTO menu_recipe_ingredients
                                (recipe_id, ingredient_code, ingredient_name, specification, unit,
                                 delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """, (target_id, *ing))

                        cursor.execute("RELEASE SAVEPOINT batch_sync_backup")
                        group_synced += 1
                    except Exception as sync_err:
                        print(f"[일괄동기화] 동기화 실패 (ID {target_id} 건너뜀): {sync_err}")
                        try:
                            cursor.execute("ROLLBACK TO SAVEPOINT batch_sync_backup")
                        except Exception:
                            pass
                        continue

                if group_synced > 0:
                    total_groups_synced += 1
                    total_recipes_synced += group_synced
                    detail["synced"] = group_synced
                    sync_details.append(detail)
                    print(f"[일괄동기화] {source_display} → {group_synced}개 형제 동기화 완료")

            if not dry_run:
                conn.commit()

            mode_label = "미리보기 (dry_run)" if dry_run else "실행 완료"
            return {
                "success": True,
                "mode": "dry_run" if dry_run else "executed",
                "message": f"{mode_label}: {total_groups_checked}개 그룹 검사, {total_groups_synced}개 그룹 불일치, {total_recipes_synced}개 레시피 동기화",
                "groups_checked": total_groups_checked,
                "groups_synced": total_groups_synced,
                "recipes_synced": total_recipes_synced,
                "details": sync_details
            }

    except Exception as e:
        print(f"[ERROR] sync_all_sibling_recipes: {e}")
        return {"success": False, "error": str(e)}


@router.post("/api/recipes/duplicates/merge")
async def merge_duplicate_recipes(request: Request):
    """
    중복 레시피 병합: 기준 레시피의 재료를 다른 변형에 동기화
    - keep_id: 기준이 되는 레시피 ID (재료가 가장 많은 것 추천)
    - target_ids: 재료를 동기화할 대상 레시피 ID 목록
    - 대상 레시피의 기존 재료를 삭제하고 기준 레시피의 재료로 복사
    """
    try:
        data = await request.json()
        keep_id = data.get('keep_id')
        target_ids = data.get('target_ids', [])

        if not keep_id or not target_ids:
            return {"success": False, "error": "keep_id와 target_ids가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기준 레시피 확인
            cursor.execute("SELECT id, recipe_name, suffix FROM menu_recipes WHERE id = %s", (keep_id,))
            source = cursor.fetchone()
            if not source:
                return {"success": False, "error": f"기준 레시피 ID {keep_id}를 찾을 수 없습니다"}

            source_name = source[1]

            # 기준 레시피의 재료 조회
            cursor.execute("""
                SELECT ingredient_code, ingredient_name, specification, unit,
                       delivery_days, selling_price, quantity, amount, supplier_name, required_grams
                FROM menu_recipe_ingredients WHERE recipe_id = %s
            """, (keep_id,))
            source_ingredients = cursor.fetchall()

            if not source_ingredients:
                return {"success": False, "error": f"기준 레시피에 재료가 없습니다"}

            merged_count = 0
            for target_id in target_ids:
                target_id = int(target_id)
                if target_id == int(keep_id):
                    continue

                # 대상 레시피가 같은 recipe_name인지 확인
                cursor.execute("SELECT id, recipe_name, suffix FROM menu_recipes WHERE id = %s", (target_id,))
                target = cursor.fetchone()
                if not target or target[1] != source_name:
                    continue

                # 이력 백업 (레시피 메타 + 재료 데이터)
                try:
                    cursor.execute("SAVEPOINT merge_backup")

                    # 레시피 메타 백업
                    cursor.execute("""
                        INSERT INTO menu_recipes_history
                        (original_id, recipe_code, recipe_name, category, cooking_note, total_cost,
                         serving_size, cooking_yield_rate, site_id, action, changed_by)
                        SELECT id, recipe_code, recipe_name, category, cooking_note, total_cost,
                               serving_size, cooking_yield_rate, site_id, 'BEFORE_MERGE', 'admin_merge'
                        FROM menu_recipes WHERE id = %s
                    """, (target_id,))

                    # 재료 데이터도 JSON으로 백업 (cooking_note 컬럼에 추가 기록)
                    cursor.execute("""
                        SELECT ingredient_code, ingredient_name, required_grams, quantity, amount
                        FROM menu_recipe_ingredients WHERE recipe_id = %s
                    """, (target_id,))
                    old_ingredients = cursor.fetchall()
                    if old_ingredients:
                        ingredients_backup = json.dumps([
                            {"code": r[0], "name": r[1], "grams": float(r[2]) if r[2] else 0,
                             "qty": float(r[3]) if r[3] else 0, "amount": float(r[4]) if r[4] else 0}
                            for r in old_ingredients
                        ], ensure_ascii=False)
                        # 가장 최근 history 레코드에 재료 백업 추가
                        cursor.execute("""
                            UPDATE menu_recipes_history
                            SET cooking_note = COALESCE(cooking_note, '') || E'\n[병합 전 재료 백업] ' || %s
                            WHERE id = (
                                SELECT id FROM menu_recipes_history
                                WHERE original_id = %s AND action = 'BEFORE_MERGE'
                                ORDER BY id DESC LIMIT 1
                            )
                        """, (ingredients_backup, target_id))

                    cursor.execute("RELEASE SAVEPOINT merge_backup")
                except Exception as backup_err:
                    print(f"[레시피 병합] ⚠️ 이력 백업 실패 (ID {target_id} 건너뜀): {backup_err}")
                    try:
                        cursor.execute("ROLLBACK TO SAVEPOINT merge_backup")
                    except Exception:
                        pass
                    continue  # 백업 실패 시 해당 대상 건너뜀

                # 대상 레시피의 기존 재료 삭제
                cursor.execute("DELETE FROM menu_recipe_ingredients WHERE recipe_id = %s", (target_id,))

                # 기준 레시피의 재료 복사
                for ing in source_ingredients:
                    cursor.execute("""
                        INSERT INTO menu_recipe_ingredients
                        (recipe_id, ingredient_code, ingredient_name, specification, unit,
                         delivery_days, selling_price, quantity, amount, supplier_name, required_grams)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (target_id, *ing))

                merged_count += 1
                print(f"[레시피 병합] {source_name}: ID {keep_id} → ID {target_id} 재료 동기화 완료")

            conn.commit()

            return {
                "success": True,
                "message": f"{source_name}: {merged_count}개 변형 레시피에 재료 동기화 완료 (기준: ID {keep_id}, 재료 {len(source_ingredients)}개)",
                "merged_count": merged_count,
                "source_ingredient_count": len(source_ingredients)
            }

    except Exception as e:
        print(f"[ERROR] merge_duplicate_recipes: {e}")
        return {"success": False, "error": str(e)}
