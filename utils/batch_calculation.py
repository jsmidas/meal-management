#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch Calculation Module
식자재 단위당 단가 배치 계산 - 청크 처리 방식 (메모리 최적화)
"""

import time
from core.database import get_db_connection, simple_unit_price_calculation


# 배치 계산 상태 전역 변수
batch_calculation_status = {
    "is_running": False,
    "total_items": 0,
    "completed_items": 0,
    "current_item": "",
    "start_time": None,
    "estimated_remaining": None,
    "error_count": 0,
    "thread": None
}

CHUNK_SIZE = 1000


def run_batch_calculation():
    """청크 기반 배치 계산 (메모리 최적화) - Railway PostgreSQL 전용"""
    global batch_calculation_status

    try:
        batch_calculation_status["is_running"] = True
        batch_calculation_status["start_time"] = time.time()
        batch_calculation_status["error_count"] = 0

        print("배치 계산 시작 (청크 처리 모드)")

        # 단일 커넥션으로 전체 배치 처리 (커넥션 풀 churn 방지)
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. 전체 건수 조회 (진행률 추적용)
            cursor.execute("""
                SELECT COUNT(*) FROM ingredients
                WHERE (price_per_unit IS NULL OR price_per_unit = 0)
                AND purchase_price IS NOT NULL AND purchase_price > 0
            """)
            total_count = cursor.fetchone()[0]

            batch_calculation_status["total_items"] = total_count
            batch_calculation_status["completed_items"] = 0

            print(f"계산 대상: {total_count}개 항목 (청크 크기: {CHUNK_SIZE})")

            if total_count == 0:
                print("계산할 항목이 없습니다.")
                return {"success": True, "message": "계산할 항목이 없습니다."}

            # 2. 청크 단위로 처리
            total_success = 0
            offset = 0

            while offset < total_count and batch_calculation_status["is_running"]:
                # 청크 조회
                cursor.execute("""
                    SELECT id, ingredient_name, specification, unit, purchase_price
                    FROM ingredients
                    WHERE (price_per_unit IS NULL OR price_per_unit = 0)
                    AND purchase_price IS NOT NULL AND purchase_price > 0
                    ORDER BY id
                    LIMIT %s OFFSET %s
                """, (CHUNK_SIZE, offset))

                chunk = cursor.fetchall()
                if not chunk:
                    break

                # 청크 내 계산
                updates = []
                for item in chunk:
                    if not batch_calculation_status["is_running"]:
                        break

                    item_id, ingredient_name, specification, unit, purchase_price = item
                    batch_calculation_status["current_item"] = ingredient_name or f"ID_{item_id}"

                    try:
                        try:
                            price = float(purchase_price) if purchase_price else 0.0
                        except (ValueError, TypeError):
                            price = 0.0
                            batch_calculation_status["error_count"] += 1
                            batch_calculation_status["completed_items"] += 1
                            continue

                        unit_price = simple_unit_price_calculation(price, specification, unit)

                        if unit_price > 0:
                            updates.append((unit_price, item_id))
                        else:
                            batch_calculation_status["error_count"] += 1

                        batch_calculation_status["completed_items"] += 1

                    except Exception as e:
                        batch_calculation_status["error_count"] += 1
                        batch_calculation_status["completed_items"] += 1
                        print(f"계산 오류 ({ingredient_name}): {e}")

                # 청크 업데이트 + 커밋
                if updates and batch_calculation_status["is_running"]:
                    for unit_price, item_id in updates:
                        cursor.execute("""
                            UPDATE ingredients
                            SET price_per_unit = %s
                            WHERE id = %s
                        """, (unit_price, item_id))
                    conn.commit()
                    total_success += len(updates)

                offset += CHUNK_SIZE
                progress = min((batch_calculation_status["completed_items"] / total_count) * 100, 100)
                print(f"청크 업데이트 완료: {batch_calculation_status['completed_items']}/{total_count} ({progress:.1f}%), 성공: {len(updates)}건")

        print(f"배치 계산 완료: 총 {batch_calculation_status['completed_items']}개 처리, {total_success}개 성공, {batch_calculation_status['error_count']}개 실패")

    except Exception as e:
        print(f"배치 계산 중 치명적 오류: {e}")
        batch_calculation_status["error_count"] += 1

    finally:
        batch_calculation_status["is_running"] = False
        batch_calculation_status["current_item"] = ""
