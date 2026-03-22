#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Suppliers Router
협력업체 관리 관련 API 엔드포인트
"""

import hashlib
from fastapi import APIRouter, Request
from core.database import get_db_connection
from routers.ingredients import clear_inactive_suppliers_cache

router = APIRouter()

# 통계에서 제외할 협력업체 이름 목록
exclude_names = set()


def get_stable_hash_id(name: str) -> int:
    """이름 기반 안정적인 해시 ID 생성 (서버 재시작해도 동일한 값)"""
    hash_bytes = hashlib.md5(name.encode('utf-8')).hexdigest()
    return 10000 + (int(hash_bytes[:8], 16) % 90000)


def ensure_supplier_code_column(cursor):
    """supplier_code 컬럼이 없으면 추가"""
    cursor.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'suppliers' AND column_name = 'supplier_code'
    """)
    if not cursor.fetchone():
        cursor.execute("ALTER TABLE suppliers ADD COLUMN supplier_code VARCHAR(50)")
        cursor.connection.commit()


def ensure_delivery_code_column(cursor):
    """delivery_code 컬럼이 없으면 추가"""
    cursor.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'suppliers' AND column_name = 'delivery_code'
    """)
    if not cursor.fetchone():
        cursor.execute("ALTER TABLE suppliers ADD COLUMN delivery_code VARCHAR(50)")
        cursor.connection.commit()


@router.get("/api/admin/suppliers")
async def get_suppliers():
    """공급업체 목록 - suppliers 테이블 + ingredients 기반 데이터 통합"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # supplier_code, delivery_code 컬럼 확인 및 추가
            ensure_supplier_code_column(cursor)
            ensure_delivery_code_column(cursor)

            # 1. suppliers 테이블 컬럼 구조 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'suppliers'
            """)
            existing_columns = set(row[0] for row in cursor.fetchall())

            # 2. suppliers 테이블에서 등록된 협력업체 조회 (supplier_code 포함)
            registered_suppliers = {}
            if existing_columns:
                cursor.execute("SELECT * FROM suppliers ORDER BY name")
                rows = cursor.fetchall()

                # 컬럼명 가져오기
                col_names = [desc[0] for desc in cursor.description]

                for row in rows:
                    row_dict = dict(zip(col_names, row))
                    name = row_dict.get('name', '')
                    registered_suppliers[name] = row_dict

            # 3. ingredients 테이블에서 협력업체별 통계 조회
            cursor.execute("""
                SELECT
                    supplier_name,
                    COUNT(*) as ingredient_count,
                    AVG(CASE WHEN purchase_price > 0 THEN purchase_price END) as avg_price
                FROM ingredients
                WHERE supplier_name IS NOT NULL
                GROUP BY supplier_name
            """)
            ingredient_stats = cursor.fetchall()

            # 통계 딕셔너리로 변환
            stats_dict = {}
            for row in ingredient_stats:
                stats_dict[row[0]] = {
                    'ingredient_count': row[1] or 0,
                    'avg_price': row[2] or 0
                }

            # 추가 통계 정보 조회
            cursor.execute("""
                SELECT COUNT(DISTINCT category)
                FROM ingredients
                WHERE category IS NOT NULL AND category != ''
            """)
            total_categories = cursor.fetchone()[0] or 0

            cursor.execute("""
                SELECT MAX(updated_at)::date
                FROM ingredients
                WHERE updated_at IS NOT NULL
            """)
            last_update_result = cursor.fetchone()
            last_update = str(last_update_result[0]) if last_update_result and last_update_result[0] else None

            # 매핑 정보 조회 (delivery_code, mapping_count)
            mapping_dict = {}
            try:
                cursor.execute("""
                    SELECT supplier_code, delivery_code, COUNT(*) as mapping_count
                    FROM customer_supplier_mappings
                    WHERE supplier_code IS NOT NULL
                    GROUP BY supplier_code, delivery_code
                """)
                for row in cursor.fetchall():
                    code = row[0]
                    if code not in mapping_dict:
                        mapping_dict[code] = {
                            'delivery_code': row[1] or "",
                            'mapping_count': row[2] or 0
                        }
            except:
                pass  # 테이블이 없을 경우 무시

            # 결과 리스트 생성
            suppliers = []
            seen_names = set()

            # 1) suppliers 테이블에서 등록된 협력업체 추가 (비활성 포함)
            for name, row_dict in registered_suppliers.items():
                seen_names.add(name)

                stats = stats_dict.get(name, {'ingredient_count': 0, 'avg_price': 0})
                # DB에서 supplier_code 가져오기
                supplier_code = row_dict.get('supplier_code', '') or ''
                mapping_info = mapping_dict.get(supplier_code, {'delivery_code': '', 'mapping_count': 0})

                # delivery_code: suppliers 테이블 우선, 없으면 mapping_info에서
                delivery_code = row_dict.get('delivery_code', '') or mapping_info.get('delivery_code', '')

                suppliers.append({
                    "id": row_dict.get('id', 0),
                    "name": name,
                    "code": supplier_code,  # 프론트엔드 호환
                    "supplier_code": supplier_code,
                    "delivery_code": delivery_code,
                    "headquarters_address": row_dict.get('headquarters_address', '') or '',
                    "headquarters_phone": row_dict.get('headquarters_phone', '') or '',
                    "email": row_dict.get('email', '') or '',
                    "contact": row_dict.get('headquarters_phone', '') or '',
                    "phone": row_dict.get('phone', '') or row_dict.get('headquarters_phone', '') or '',
                    "businessType": row_dict.get('business_type', '') or '',
                    "business_type": row_dict.get('business_type', '') or '',
                    "representative": row_dict.get('representative', '') or '',
                    "business_number": row_dict.get('business_number', '') or '',
                    "ingredient_count": int(stats['ingredient_count']),
                    "avg_price": round(float(stats['avg_price']), 2) if stats['avg_price'] else 0,
                    "mapping_count": mapping_info.get('mapping_count', 0),
                    "isActive": bool(row_dict.get('is_active', 1)) and row_dict.get('portal_enabled', True) is not False,
                    "is_active": bool(row_dict.get('is_active', 1)) and row_dict.get('portal_enabled', True) is not False,
                    "portal_enabled": row_dict.get('portal_enabled', True),
                    "status": "active" if (bool(row_dict.get('is_active', 1)) and row_dict.get('portal_enabled', True) is not False) else "inactive",
                    "login_id": row_dict.get('login_id', '') or '',
                    "created_at": str(row_dict.get('created_at')) if row_dict.get('created_at') else None
                })

            # 2) ingredients 테이블에만 있는 협력업체 추가 (suppliers 테이블에 없는 것들)
            # 이름 해시 기반 고정 ID 생성 (일관성 보장)
            for name, stats in stats_dict.items():
                if name not in seen_names and name not in exclude_names:
                    # 임시 업체는 supplier_code 없음
                    mapping_info = {'delivery_code': '', 'mapping_count': 0}
                    # 이름 기반 고정 ID (해시값 사용)
                    temp_id = get_stable_hash_id(name)
                    suppliers.append({
                        "id": temp_id,
                        "name": name,
                        "code": "",
                        "supplier_code": "",
                        "delivery_code": "",
                        "headquarters_address": "",
                        "headquarters_phone": "",
                        "email": "",
                        "contact": "",
                        "phone": "",
                        "businessType": "",
                        "business_type": "",
                        "representative": "",
                        "business_number": "",
                        "ingredient_count": int(stats['ingredient_count']),
                        "avg_price": round(float(stats['avg_price']), 2) if stats['avg_price'] else 0,
                        "mapping_count": 0,
                        "isActive": True,
                        "is_active": True,
                        "status": "active",
                        "created_at": None,
                        "is_temp": True  # 임시 업체 표시
                    })


            # 이름순 정렬
            suppliers.sort(key=lambda x: x['name'])

            return {
                "success": True,
                "data": suppliers,
                "suppliers": suppliers,  # 호환성 유지
                "total": len(suppliers),
                "total_categories": total_categories,
                "last_update": last_update,
                "pagination": {
                    "current_page": 1,
                    "total_pages": 1,
                    "has_prev": False,
                    "has_next": False
                }
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/suppliers/stats")
async def get_suppliers_stats():
    """협력업체 통계 API - suppliers 테이블 + ingredients 통계 통합"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. suppliers 테이블에서 등록된 협력업체 수 조회
            cursor.execute("""
                SELECT COUNT(*) FROM suppliers
            """)
            registered_count = cursor.fetchone()[0] or 0

            cursor.execute("""
                SELECT COUNT(*) FROM suppliers
                WHERE is_active = 1 AND (portal_enabled IS NULL OR portal_enabled = true)
            """)
            active_registered = cursor.fetchone()[0] or 0

            # 2. 협력업체별 식자재 통계 집계 (ingredients 테이블)
            cursor.execute("""
                SELECT
                    supplier_name,
                    COUNT(*) as ingredient_count,
                    AVG(CASE WHEN purchase_price > 0 THEN purchase_price END) as avg_price,
                    COUNT(CASE WHEN purchase_price > 0 THEN 1 END) as priced_items
                FROM ingredients
                WHERE supplier_name IS NOT NULL AND supplier_name != ''
                GROUP BY supplier_name
                ORDER BY ingredient_count DESC
            """)

            results = cursor.fetchall()

            stats = []
            total_ingredients = 0
            ingredient_supplier_names = set()

            for row in results:
                supplier_name = row[0]

                # 제외 목록에 있으면 스킵
                if supplier_name in exclude_names:
                    continue

                count = row[1]
                avg_price = float(row[2]) if row[2] else 0
                priced_count = row[3]

                pricing_rate = round((priced_count / count * 100), 1) if count > 0 else 0
                ingredient_supplier_names.add(supplier_name)

                stats.append({
                    "supplier_name": supplier_name,
                    "ingredient_count": count,
                    "avg_price": round(avg_price, 2),
                    "priced_items": priced_count,
                    "pricing_rate": pricing_rate
                })

                total_ingredients += count

            # 3. suppliers 테이블에만 있는 협력업체 추가 (식자재 없는 신규 등록 업체)
            cursor.execute("SELECT name FROM suppliers")
            registered_names = [row[0] for row in cursor.fetchall()]

            for name in registered_names:
                # 제외 목록에 있으면 스킵
                if name in exclude_names:
                    continue
                if name not in ingredient_supplier_names:
                    stats.append({
                        "supplier_name": name,
                        "ingredient_count": 0,
                        "avg_price": 0,
                        "priced_items": 0,
                        "pricing_rate": 0
                    })


            # 총 협력업체 수 = suppliers 테이블 + ingredients에만 있는 업체
            total_suppliers = len(stats)

            return {
                "success": True,
                "total": total_suppliers,
                "active": active_registered if registered_count > 0 else total_suppliers,
                "stats": {
                    "total_suppliers": total_suppliers,
                    "active_suppliers": active_registered if registered_count > 0 else total_suppliers
                },
                "data": {
                    "supplier_stats": stats,
                    "summary": {
                        "total_suppliers": total_suppliers,
                        "registered_suppliers": registered_count,
                        "total_ingredients": total_ingredients,
                        "avg_ingredients_per_supplier": round(total_ingredients / total_suppliers, 1) if total_suppliers > 0 else 0
                    }
                }
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/admin/suppliers/{supplier_id}")
async def get_supplier_by_id(supplier_id: int):
    """개별 협력업체 정보 조회 - suppliers 테이블에서 직접 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # supplier_code, delivery_code 컬럼 확인 및 추가
            ensure_supplier_code_column(cursor)
            ensure_delivery_code_column(cursor)

            supplier_data = None

            # 1. suppliers 테이블에서 직접 조회
            cursor.execute("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
            row = cursor.fetchone()

            if row:
                col_names = [desc[0] for desc in cursor.description]
                row_dict = dict(zip(col_names, row))

                supplier_name = row_dict.get('name', '')
                # DB에서 supplier_code 가져오기
                supplier_code = row_dict.get('supplier_code', '') or ''

                # 식자재 통계 조회
                cursor.execute("""
                    SELECT COUNT(*) as cnt,
                           AVG(CASE WHEN purchase_price > 0 THEN purchase_price END) as avg_price
                    FROM ingredients
                    WHERE supplier_name = %s
                """, (supplier_name,))
                stats = cursor.fetchone()
                ingredient_count = stats[0] or 0
                avg_price = stats[1] or 0

                # 배송코드: suppliers 테이블 우선, 없으면 customer_supplier_mappings에서
                delivery_code = row_dict.get('delivery_code', '') or ''
                mapping_count = 0
                if supplier_code:
                    try:
                        cursor.execute("""
                            SELECT delivery_code, COUNT(*) as mapping_count
                            FROM customer_supplier_mappings
                            WHERE supplier_code = %s
                            GROUP BY delivery_code LIMIT 1
                        """, (supplier_code,))
                        mapping_result = cursor.fetchone()
                        if mapping_result:
                            # suppliers 테이블에 없으면 mapping에서 가져옴
                            if not delivery_code:
                                delivery_code = mapping_result[0] or ""
                            mapping_count = mapping_result[1] or 0
                    except:
                        pass

                supplier_data = {
                    "id": supplier_id,
                    "name": supplier_name,
                    "supplier_code": supplier_code,
                    "delivery_code": delivery_code,
                    # 실제 DB 컬럼명 그대로 반환
                    "headquarters_address": row_dict.get('headquarters_address', '') or '',
                    "headquarters_phone": row_dict.get('headquarters_phone', '') or '',
                    "headquarters_fax": row_dict.get('headquarters_fax', '') or '',
                    "email": row_dict.get('email', '') or '',
                    "website": row_dict.get('website', '') or '',
                    "business_number": row_dict.get('business_number', '') or '',
                    "representative": row_dict.get('representative', '') or '',
                    "business_type": row_dict.get('business_type', '') or '',
                    "business_item": row_dict.get('business_item', '') or '',
                    "company_scale": row_dict.get('company_scale', '') or '',
                    "parent_code": row_dict.get('parent_code', '') or '',
                    "notes": row_dict.get('notes', '') or '',
                    # 호환성 유지 (기존 필드명도 함께 반환)
                    "address": row_dict.get('headquarters_address', '') or '',
                    "phone": row_dict.get('headquarters_phone', '') or '',
                    "contact": row_dict.get('headquarters_phone', '') or '',
                    "ingredient_count": int(ingredient_count),
                    "avg_price": round(float(avg_price), 2) if avg_price else 0,
                    "mapping_count": int(mapping_count),
                    "is_active": row_dict.get('is_active', 1),
                    "status": "active" if row_dict.get('is_active', 1) else "inactive",
                    "login_id": row_dict.get('login_id', '') or '',
                    "portal_enabled": bool(row_dict.get('portal_enabled', False))
                }
            else:
                # 2. suppliers 테이블에 없으면 ingredients 기반으로 조회 (해시 기반 ID >= 10000)
                if supplier_id >= 10000:
                    cursor.execute("""
                        SELECT supplier_name, COUNT(*) as cnt,
                               AVG(CASE WHEN purchase_price > 0 THEN purchase_price END) as avg_price
                        FROM ingredients
                        WHERE supplier_name IS NOT NULL
                        GROUP BY supplier_name
                    """)
                    all_suppliers = cursor.fetchall()

                    # 해시 기반 ID로 매칭되는 협력업체 찾기
                    matched_supplier = None
                    for row in all_suppliers:
                        name = row[0]
                        # 동일한 해시 함수로 ID 계산
                        calc_id = get_stable_hash_id(name)
                        if calc_id == supplier_id:
                            matched_supplier = row
                            break

                    if matched_supplier:
                        supplier_name = matched_supplier[0]
                        # 임시 협력업체는 DB에 없으므로 supplier_code 없음
                        supplier_data = {
                            "id": supplier_id,
                            "name": supplier_name,
                            "supplier_code": "",  # 정식 등록 후 설정 가능
                            "delivery_code": "",
                            "headquarters_address": "",
                            "headquarters_phone": "",
                            "email": "",
                            "address": "",
                            "phone": "",
                            "contact": "",
                            "ingredient_count": int(matched_supplier[1] or 0),
                            "avg_price": round(float(matched_supplier[2]), 2) if matched_supplier[2] else 0,
                            "mapping_count": 0,
                            "is_active": 1,
                            "status": "active",
                            "is_temp": True
                        }


            if supplier_data:
                return {"success": True, "data": supplier_data}
            else:
                return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/suppliers")
async def create_supplier(request: Request):
    """협력업체 생성 - 실제 DB에 저장"""
    try:
        data = await request.json()

        name = data.get("name")
        if not name:
            return {"success": False, "error": "업체명은 필수입니다"}

        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # suppliers 테이블 컬럼 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'suppliers'
            """)
            existing_columns = set(row[0] for row in cursor.fetchall())

            # 동적으로 INSERT 쿼리 구성
            columns = ['name']
            values = [name]
            placeholders = ['%s']

            # supplier_code 추가
            if 'supplier_code' in existing_columns:
                columns.append('supplier_code')
                values.append(data.get("supplier_code", ""))
                placeholders.append('%s')

            # delivery_code 추가
            if 'delivery_code' in existing_columns:
                columns.append('delivery_code')
                values.append(data.get("delivery_code", ""))
                placeholders.append('%s')

            if 'address' in existing_columns:
                columns.append('address')
                values.append(data.get("address", ""))
                placeholders.append('%s')

            if 'phone' in existing_columns:
                columns.append('phone')
                values.append(data.get("phone", ""))
                placeholders.append('%s')

            if 'email' in existing_columns:
                columns.append('email')
                values.append(data.get("email", ""))
                placeholders.append('%s')

            if 'is_active' in existing_columns:
                columns.append('is_active')
                # INTEGER 타입일 수 있으므로 1/0 사용
                values.append(1 if data.get("status", "active") == "active" else 0)
                placeholders.append('%s')

            if 'created_at' in existing_columns:
                columns.append('created_at')
                placeholders.append('CURRENT_TIMESTAMP')

            if 'updated_at' in existing_columns:
                columns.append('updated_at')
                placeholders.append('CURRENT_TIMESTAMP')

            # 먼저 중복 확인
            cursor.execute("SELECT id FROM suppliers WHERE name = %s", (name,))
            existing = cursor.fetchone()
            if existing:
                return {"success": False, "error": f"'{name}' 협력업체가 이미 존재합니다."}

            # INSERT 실행
            insert_sql = f"""
                INSERT INTO suppliers ({', '.join(columns)})
                VALUES ({', '.join(placeholders)})
                RETURNING id
            """
            # CURRENT_TIMESTAMP는 값 목록에서 제외
            actual_values = [v for v, p in zip(values, placeholders[:len(values)]) if p == '%s']
            cursor.execute(insert_sql, actual_values)

            result = cursor.fetchone()
            conn.commit()

            if result:
                new_id = result[0]
                return {
                    "success": True,
                    "data": {
                        "id": new_id,
                        "name": name,
                        "address": data.get("address", ""),
                        "phone": data.get("phone", ""),
                        "email": data.get("email", ""),
                        "status": data.get("status", "active")
                    },
                    "message": "협력업체가 성공적으로 생성되었습니다."
                }
            else:
                return {"success": False, "error": "협력업체 생성에 실패했습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/suppliers/{supplier_id}")
async def update_supplier(supplier_id: int, request: Request):
    """협력업체 수정 - suppliers 테이블 직접 업데이트"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            supplier_name = None
            supplier_code = ""  # DB에서 가져오거나 data에서 가져옴

            # 1. suppliers 테이블에서 직접 조회
            cursor.execute("SELECT id, name, supplier_code FROM suppliers WHERE id = %s", (supplier_id,))
            row = cursor.fetchone()

            if row:
                # suppliers 테이블에 있는 협력업체 - 직접 업데이트
                supplier_name = row[1]
                supplier_code = row[2] or ""  # 기존 supplier_code

                # 업데이트할 컬럼 확인
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'suppliers'
                """)
                existing_columns = set(r[0] for r in cursor.fetchall())

                # 동적으로 UPDATE 쿼리 구성
                update_parts = []
                values = []

                # supplier_code, delivery_code 컬럼 확인 및 추가
                ensure_supplier_code_column(cursor)
                ensure_delivery_code_column(cursor)

                # 컬럼 목록 다시 조회
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'suppliers'
                """)
                existing_columns = set(r[0] for r in cursor.fetchall())

                # 필드 매핑 (프론트엔드 필드명 -> DB 컬럼명)
                field_mappings = {
                    'name': 'name',
                    'supplier_code': 'supplier_code',  # 업체코드 (DB 저장)
                    'delivery_code': 'delivery_code',  # 배송코드 (DB 저장)
                    'headquarters_address': 'headquarters_address',
                    'address': 'headquarters_address',  # address도 headquarters_address로
                    'headquarters_phone': 'headquarters_phone',
                    'phone': 'headquarters_phone',  # phone도 headquarters_phone로
                    'headquarters_fax': 'headquarters_fax',
                    'email': 'email',
                    'website': 'website',
                    'business_number': 'business_number',
                    'representative': 'representative',
                    'business_type': 'business_type',
                    'business_item': 'business_item',
                    'company_scale': 'company_scale',
                    'parent_code': 'parent_code',
                    'notes': 'notes',
                    'login_id': 'login_id',
                    'portal_enabled': 'portal_enabled'
                }

                for frontend_field, db_column in field_mappings.items():
                    if db_column in existing_columns and frontend_field in data:
                        value = data.get(frontend_field)
                        if value is not None:  # None이 아닌 값만 업데이트
                            update_parts.append(f"{db_column} = %s")
                            values.append(value)
                            if frontend_field == 'name':
                                supplier_name = value

                # portal_enabled 변경 시 is_active도 동기화
                if 'portal_enabled' in data and 'is_active' in existing_columns:
                    update_parts.append("is_active = %s")
                    values.append(1 if data['portal_enabled'] else 0)

                # 비밀번호 별도 처리 (해시 변환)
                if 'password' in data and data['password']:
                    if 'password_hash' in existing_columns:
                        from routers.supplier_portal import hash_password
                        update_parts.append("password_hash = %s")
                        values.append(hash_password(data['password']))

                if 'updated_at' in existing_columns:
                    update_parts.append("updated_at = CURRENT_TIMESTAMP")

                if update_parts:
                    values.append(supplier_id)
                    update_sql = f"UPDATE suppliers SET {', '.join(update_parts)} WHERE id = %s"
                    cursor.execute(update_sql, values)
                    conn.commit()

                message = f"협력업체 '{supplier_name}' 정보가 업데이트되었습니다."

            elif supplier_id >= 10000:
                # 임시 협력업체 (해시 기반 ID) - 이름으로 찾기
                cursor.execute("""
                    SELECT DISTINCT supplier_name FROM ingredients
                    WHERE supplier_name IS NOT NULL
                """)
                all_names = cursor.fetchall()

                for (name,) in all_names:
                    calc_id = get_stable_hash_id(name)
                    if calc_id == supplier_id:
                        supplier_name = name
                        break

                if supplier_name:
                    # 임시 협력업체 -> suppliers 테이블에 자동 등록 후 업데이트
                    # 먼저 이름으로 중복 체크
                    cursor.execute("SELECT id FROM suppliers WHERE name = %s", (supplier_name,))
                    existing = cursor.fetchone()

                    if existing:
                        # 이미 등록된 경우 해당 ID로 업데이트
                        real_supplier_id = existing[0]
                    else:
                        # 새로 등록
                        cursor.execute("""
                            INSERT INTO suppliers (name, is_active, created_at, updated_at)
                            VALUES (%s, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            RETURNING id
                        """, (supplier_name,))
                        result = cursor.fetchone()
                        real_supplier_id = result[0]
                        conn.commit()

                    # 이제 실제 suppliers 레코드 업데이트
                    # supplier_code 컬럼 확인 및 추가
                    ensure_supplier_code_column(cursor)

                    # 컬럼 목록 조회
                    cursor.execute("""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = 'suppliers'
                    """)
                    existing_columns = set(r[0] for r in cursor.fetchall())

                    # 필드 매핑
                    field_mappings = {
                        'supplier_code': 'supplier_code',
                        'headquarters_address': 'headquarters_address',
                        'headquarters_phone': 'headquarters_phone',
                        'email': 'email',
                        'business_number': 'business_number',
                        'representative': 'representative',
                        'parent_code': 'parent_code',
                        'notes': 'notes'
                    }

                    update_parts = []
                    values = []
                    for frontend_field, db_column in field_mappings.items():
                        if db_column in existing_columns and frontend_field in data:
                            value = data.get(frontend_field)
                            if value is not None:
                                update_parts.append(f"{db_column} = %s")
                                values.append(value)

                    if 'updated_at' in existing_columns:
                        update_parts.append("updated_at = CURRENT_TIMESTAMP")

                    if update_parts:
                        values.append(real_supplier_id)
                        update_sql = f"UPDATE suppliers SET {', '.join(update_parts)} WHERE id = %s"
                        cursor.execute(update_sql, values)
                        conn.commit()

                    # 새로운 실제 ID 반환
                    supplier_id = real_supplier_id
                    supplier_code = data.get("supplier_code", "")
                    message = f"협력업체 '{supplier_name}'가 정식 등록되고 정보가 업데이트되었습니다."
                else:
                    return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다"}
            else:
                return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다"}

            # 배송코드 업데이트 (가능한 경우)
            # data에서 supplier_code가 전송된 경우 업데이트 (이미 field_mappings에서 DB 업데이트됨)
            if data.get("supplier_code"):
                supplier_code = data.get("supplier_code")
            new_delivery_code = data.get("delivery_code", "")
            if new_delivery_code and supplier_code:
                try:
                    cursor.execute("""
                        UPDATE customer_supplier_mappings
                        SET delivery_code = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE supplier_code = %s
                    """, (new_delivery_code, supplier_code))
                    if cursor.rowcount > 0:
                        conn.commit()
                except:
                    pass


            return {
                "success": True,
                "data": {
                    "id": supplier_id,
                    "name": supplier_name,
                    "supplier_code": supplier_code,
                    "delivery_code": new_delivery_code,
                    "address": data.get("address", ""),
                    "phone": data.get("phone", ""),
                    "email": data.get("email", ""),
                    "status": "active"
                },
                "message": message
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/admin/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: int):
    """협력업체 삭제 - 실제 DB에서 삭제"""
    try:
        # Railway PostgreSQL 연결
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 삭제 전 협력업체 이름 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            result = cursor.fetchone()

            if result:
                supplier_name = result[0]
                # suppliers 테이블에서 삭제
                cursor.execute("DELETE FROM suppliers WHERE id = %s", (supplier_id,))
                conn.commit()
                clear_inactive_suppliers_cache()
                # ingredients에 남아있으면 임시업체로 재등록 방지: 비활성으로 재등록
                cursor.execute("""
                    SELECT COUNT(*) FROM ingredients
                    WHERE supplier_name = %s
                """, (supplier_name,))
                if cursor.fetchone()[0] > 0:
                    cursor.execute("""
                        INSERT INTO suppliers (name, is_active, portal_enabled)
                        VALUES (%s, 0, false)
                    """, (supplier_name,))
                    conn.commit()
                return {
                    "success": True,
                    "message": f"협력업체 '{supplier_name}'(ID: {supplier_id})가 성공적으로 삭제되었습니다."
                }

            # 임시 업체 (ingredients 기반, 해시 ID >= 10000)
            if supplier_id >= 10000:
                cursor.execute("""
                    SELECT DISTINCT supplier_name FROM ingredients
                    WHERE supplier_name IS NOT NULL
                """)
                for (name,) in cursor.fetchall():
                    if get_stable_hash_id(name) == supplier_id:
                        # suppliers 테이블에 비활성으로 등록하여 재등록 방지
                        cursor.execute("""
                            INSERT INTO suppliers (name, is_active, portal_enabled)
                            VALUES (%s, 0, false)
                        """, (name,))
                        conn.commit()
                        clear_inactive_suppliers_cache()
                        return {
                            "success": True,
                            "message": f"협력업체 '{name}'가 목록에서 제거되었습니다."
                        }

            return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/suppliers/{supplier_id}/deactivate")
async def deactivate_supplier(supplier_id: int):
    """협력업체 비활성화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체 이름 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다."}

            supplier_name = result[0]

            # is_active 컬럼 존재 여부 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'suppliers' AND column_name = 'is_active'
            """)
            has_is_active = cursor.fetchone() is not None

            if has_is_active:
                # INTEGER 타입일 수 있으므로 0 사용
                cursor.execute("UPDATE suppliers SET is_active = 0 WHERE id = %s", (supplier_id,))
                conn.commit()
                clear_inactive_suppliers_cache()
                return {
                    "success": True,
                    "message": f"협력업체 '{supplier_name}'가 비활성화되었습니다."
                }
            else:
                return {"success": False, "error": "is_active 컬럼이 없습니다. 마이그레이션을 먼저 실행하세요."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/admin/suppliers/{supplier_id}/activate")
async def activate_supplier(supplier_id: int):
    """협력업체 활성화"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 협력업체 이름 조회
            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            result = cursor.fetchone()

            if not result:
                return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다."}

            supplier_name = result[0]

            # is_active 컬럼 존재 여부 확인
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'suppliers' AND column_name = 'is_active'
            """)
            has_is_active = cursor.fetchone() is not None

            if has_is_active:
                # INTEGER 타입일 수 있으므로 1 사용
                cursor.execute("UPDATE suppliers SET is_active = 1 WHERE id = %s", (supplier_id,))
                conn.commit()
                clear_inactive_suppliers_cache()
                return {
                    "success": True,
                    "message": f"협력업체 '{supplier_name}'가 활성화되었습니다."
                }
            else:
                return {"success": False, "error": "is_active 컬럼이 없습니다. 마이그레이션을 먼저 실행하세요."}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/suppliers/{supplier_id}/status")
async def update_supplier_status(supplier_id: int, request: Request):
    """협력업체 상태 변경 (프론트엔드 호환용)"""
    try:
        data = await request.json()
        is_active = 1 if data.get("isActive") else 0

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT name FROM suppliers WHERE id = %s", (supplier_id,))
            result = cursor.fetchone()
            if not result:
                return {"success": False, "error": f"협력업체 ID {supplier_id}를 찾을 수 없습니다."}

            supplier_name = result[0]
            cursor.execute("UPDATE suppliers SET is_active = %s WHERE id = %s", (is_active, supplier_id))
            conn.commit()
            clear_inactive_suppliers_cache()

            status_text = "활성화" if is_active else "비활성화"
            return {
                "success": True,
                "message": f"협력업체 '{supplier_name}'가 {status_text}되었습니다."
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/admin/suppliers/sync")
async def sync_suppliers():
    """
    협력업체 동기화 API
    ingredients 테이블에 있는 supplier_name 중
    suppliers 테이블에 없는 것들을 자동으로 등록합니다.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. ingredients에 있는 모든 supplier_name 조회
            cursor.execute("""
                SELECT DISTINCT supplier_name, COUNT(*) as count
                FROM ingredients
                WHERE supplier_name IS NOT NULL AND supplier_name != '' AND supplier_name != '미등록'
                GROUP BY supplier_name
                ORDER BY count DESC
            """)
            ingredient_suppliers = {row[0]: row[1] for row in cursor.fetchall()}

            # 2. suppliers 테이블에 등록된 업체 조회
            cursor.execute("SELECT name FROM suppliers")
            registered_suppliers = set(row[0] for row in cursor.fetchall())

            # 3. 미등록 업체 찾기
            missing_suppliers = set(ingredient_suppliers.keys()) - registered_suppliers

            # 4. 미등록 업체 자동 등록
            added = []
            for supplier_name in missing_suppliers:
                try:
                    cursor.execute("""
                        INSERT INTO suppliers (name, is_active, created_at, updated_at)
                        VALUES (%s, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (name) DO NOTHING
                        RETURNING id
                    """, (supplier_name,))
                    result = cursor.fetchone()
                    if result:
                        added.append({
                            "id": result[0],
                            "name": supplier_name,
                            "ingredient_count": ingredient_suppliers[supplier_name]
                        })
                except Exception as e:
                    print(f"[SYNC ERROR] {supplier_name}: {e}")

            conn.commit()

            # 5. 최종 현황 조회
            cursor.execute("""
                SELECT s.id, s.name, s.is_active, COALESCE(i.count, 0) as ingredient_count
                FROM suppliers s
                LEFT JOIN (
                    SELECT supplier_name, COUNT(*) as count
                    FROM ingredients
                    GROUP BY supplier_name
                ) i ON s.name = i.supplier_name
                ORDER BY ingredient_count DESC
            """)

            final_suppliers = []
            for row in cursor.fetchall():
                final_suppliers.append({
                    "id": row[0],
                    "name": row[1],
                    "is_active": row[2],
                    "ingredient_count": row[3]
                })


            return {
                "success": True,
                "message": f"협력업체 동기화 완료: {len(added)}개 신규 등록",
                "added": added,
                "total_suppliers": len(final_suppliers),
                "suppliers": final_suppliers
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# 협력업체 휴무일 관리 API
# ============================================

@router.get("/api/suppliers/{supplier_id}/blackout-periods")
async def get_supplier_blackout_periods(supplier_id: int, include_expired: bool = False):
    """협력업체 휴무일 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT id, start_date, end_date, reason, is_active, created_at
                FROM supplier_blackout_periods
                WHERE supplier_id = %s
            """
            params = [supplier_id]

            if not include_expired:
                query += " AND (end_date >= CURRENT_DATE OR is_active = true)"

            query += " ORDER BY start_date DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            periods = []
            for row in rows:
                period = dict(zip(col_names, row))
                for key, value in period.items():
                    if hasattr(value, 'isoformat'):
                        period[key] = value.isoformat() if value else None
                periods.append(period)

            return {"success": True, "data": periods}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/suppliers/{supplier_id}/blackout-periods")
async def add_supplier_blackout_period(supplier_id: int, request: Request):
    """협력업체 휴무일 추가"""
    try:
        data = await request.json()
        start_date = data.get("start_date")
        end_date = data.get("end_date")
        reason = data.get("reason", "")

        if not start_date or not end_date:
            return {"success": False, "error": "start_date와 end_date는 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO supplier_blackout_periods (supplier_id, start_date, end_date, reason)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (supplier_id, start_date, end_date, reason))

            new_id = cursor.fetchone()[0]
            conn.commit()

            return {"success": True, "message": "휴무일이 등록되었습니다", "id": new_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/api/suppliers/blackout-periods/{period_id}")
async def update_supplier_blackout_period(period_id: int, request: Request):
    """협력업체 휴무일 수정"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            update_fields = []
            params = []

            if "start_date" in data:
                update_fields.append("start_date = %s")
                params.append(data["start_date"])
            if "end_date" in data:
                update_fields.append("end_date = %s")
                params.append(data["end_date"])
            if "reason" in data:
                update_fields.append("reason = %s")
                params.append(data["reason"])
            if "is_active" in data:
                update_fields.append("is_active = %s")
                params.append(data["is_active"])

            if not update_fields:
                return {"success": False, "error": "수정할 필드가 없습니다"}

            update_fields.append("updated_at = NOW()")
            params.append(period_id)

            cursor.execute(f"""
                UPDATE supplier_blackout_periods
                SET {', '.join(update_fields)}
                WHERE id = %s
            """, params)

            conn.commit()

            return {"success": True, "message": "휴무일이 수정되었습니다"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/suppliers/blackout-periods/{period_id}")
async def delete_supplier_blackout_period(period_id: int):
    """협력업체 휴무일 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("DELETE FROM supplier_blackout_periods WHERE id = %s", (period_id,))
            conn.commit()

            return {"success": True, "message": "휴무일이 삭제되었습니다"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/suppliers/check-blackout")
async def check_supplier_blackout(supplier_id: int = None, supplier_name: str = None, target_date: str = None):
    """특정 날짜의 협력업체 주문 가능 여부 확인"""
    try:
        if not target_date:
            return {"success": False, "error": "target_date는 필수입니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # supplier_id 또는 supplier_name으로 조회
            if supplier_id:
                cursor.execute("""
                    SELECT sbp.id, sbp.start_date, sbp.end_date, sbp.reason, s.name
                    FROM supplier_blackout_periods sbp
                    JOIN suppliers s ON sbp.supplier_id = s.id
                    WHERE sbp.supplier_id = %s
                      AND sbp.is_active = true
                      AND sbp.start_date <= %s
                      AND sbp.end_date >= %s
                """, (supplier_id, target_date, target_date))
            elif supplier_name:
                cursor.execute("""
                    SELECT sbp.id, sbp.start_date, sbp.end_date, sbp.reason, s.name
                    FROM supplier_blackout_periods sbp
                    JOIN suppliers s ON sbp.supplier_id = s.id
                    WHERE s.name = %s
                      AND sbp.is_active = true
                      AND sbp.start_date <= %s
                      AND sbp.end_date >= %s
                """, (supplier_name, target_date, target_date))
            else:
                return {"success": False, "error": "supplier_id 또는 supplier_name이 필요합니다"}

            row = cursor.fetchone()

            if row:
                return {
                    "success": True,
                    "can_order": False,
                    "blackout": {
                        "id": row[0],
                        "start_date": str(row[1]),
                        "end_date": str(row[2]),
                        "reason": row[3],
                        "supplier_name": row[4]
                    },
                    "message": f"주문 불가: {row[3] or '휴무 기간'} ({row[1]} ~ {row[2]})"
                }
            else:
                return {
                    "success": True,
                    "can_order": True,
                    "message": "주문 가능"
                }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/suppliers/blackout-periods/all")
async def get_all_blackout_periods(from_date: str = None, to_date: str = None):
    """모든 협력업체의 휴무일 목록 조회 (기간 필터 가능)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT sbp.id, sbp.supplier_id, s.name AS supplier_name,
                       sbp.start_date, sbp.end_date, sbp.reason, sbp.is_active
                FROM supplier_blackout_periods sbp
                JOIN suppliers s ON sbp.supplier_id = s.id
                WHERE sbp.is_active = true
            """
            params = []

            if from_date:
                query += " AND sbp.end_date >= %s"
                params.append(from_date)
            if to_date:
                query += " AND sbp.start_date <= %s"
                params.append(to_date)

            query += " ORDER BY sbp.start_date"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]

            periods = []
            for row in rows:
                period = dict(zip(col_names, row))
                for key, value in period.items():
                    if hasattr(value, 'isoformat'):
                        period[key] = value.isoformat() if value else None
                periods.append(period)

            return {"success": True, "data": periods}
    except Exception as e:
        return {"success": False, "error": str(e)}

