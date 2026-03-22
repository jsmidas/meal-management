#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Database Module
PostgreSQL 연결 및 데이터 처리 함수
- 연결 풀링 지원 (성능 최적화)
"""

import os
import re
from psycopg2 import pool

# Railway/GCP 환경변수 지원 - 함수 내부에서 동적으로 확인
# (모듈 레벨에서 한 번만 로드하면 import 순서 문제 발생 가능)

# 🔄 전역 연결 풀 (싱글톤)
_connection_pool = None
_pool_initialized = False


def fix_encoding(text):
    """PostgreSQL에서 가져온 한글 텍스트의 인코딩을 수정"""
    if not text:
        return ""

    # 이미 올바른 한글이면 그대로 반환
    try:
        # 한글 범위 확인
        if any('\uac00' <= char <= '\ud7af' for char in text):
            return text
    except:
        pass

    # 여러 인코딩 변환 시도
    try:
        # euc-kr/cp949로 인코딩된 후 잘못 해석된 경우
        if isinstance(text, str):
            # 문자열을 바이트로 변환하고 올바른 인코딩으로 디코딩
            bytes_data = text.encode('latin-1', errors='ignore')

            # euc-kr 시도
            try:
                decoded = bytes_data.decode('euc-kr')
                if any('\uac00' <= char <= '\ud7af' for char in decoded):
                    return decoded
            except:
                pass

            # cp949 시도
            try:
                decoded = bytes_data.decode('cp949')
                if any('\uac00' <= char <= '\ud7af' for char in decoded):
                    return decoded
            except:
                pass

            # utf-8 시도
            try:
                decoded = bytes_data.decode('utf-8')
                if any('\uac00' <= char <= '\ud7af' for char in decoded):
                    return decoded
            except:
                pass
    except:
        pass

    # 모든 시도가 실패하면 원본 반환
    return text if text else ""


def _init_connection_pool():
    """연결 풀 초기화 (최초 1회만 실행, 재시도 로직 포함)"""
    global _connection_pool, _pool_initialized
    import time

    if _pool_initialized:
        return _connection_pool

    import psycopg2

    DATABASE_URL = os.environ.get("DATABASE_URL")

    if not DATABASE_URL:
        error_msg = """
        ========================================
        [ERROR] DATABASE_URL 환경변수가 설정되지 않았습니다!
        ========================================
        Railway DB만 사용하도록 설정되었습니다.
        해결 방법: .env 파일에 DATABASE_URL 설정
        ========================================
        """
        print(error_msg)
        raise ValueError("DATABASE_URL이 설정되지 않았습니다.")

    # postgres:// 와 postgresql:// 둘 다 허용
    if DATABASE_URL.startswith('postgres://'):
        DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

    if not DATABASE_URL.startswith('postgresql://'):
        raise ValueError(f"잘못된 DATABASE_URL 형식")

    conn_string = DATABASE_URL
    is_local = 'localhost' in DATABASE_URL or '127.0.0.1' in DATABASE_URL
    is_flycast = '.flycast' in DATABASE_URL  # Fly.io 내부 네트워크

    # SSL 모드 설정
    if 'sslmode=' not in conn_string:
        if is_flycast:
            # Fly.io 내부 네트워크는 SSL 비활성화
            conn_string += '?sslmode=disable'
        elif not is_local:
            # 외부 연결은 SSL 필수
            conn_string += '?sslmode=require'

    # 로컬(flyctl proxy)은 연결 수 제한, 프로덕션은 더 많이 허용
    if is_local:
        min_conn, max_conn = 1, 3  # flyctl proxy는 동시 연결 제한
    else:
        min_conn, max_conn = 3, 10  # 프로덕션 (메모리 절약)

    # 재시도 설정: 5초 간격으로 최대 5번 시도 (총 25초)
    max_retries = 5
    retry_delay = 5  # 초

    for attempt in range(max_retries):
        try:
            _connection_pool = pool.ThreadedConnectionPool(
                minconn=min_conn,
                maxconn=max_conn,
                dsn=conn_string
            )
            _pool_initialized = True
            db_type = "로컬(flyctl proxy)" if is_local else "Fly.io"
            if attempt > 0:
                print(f"[DB POOL] 연결 풀 초기화 완료 ({db_type}, {min_conn}~{max_conn} connections) - {attempt + 1}번째 시도에서 성공")
            else:
                print(f"[DB POOL] 연결 풀 초기화 완료 ({db_type}, {min_conn}~{max_conn} connections)")
            return _connection_pool
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"[DB POOL] 연결 풀 초기화 실패 ({attempt + 1}/{max_retries}): {e}")
                print(f"[DB POOL] {retry_delay}초 후 재시도...")
                time.sleep(retry_delay)
            else:
                print(f"[DB ERROR] 연결 풀 초기화 최종 실패 ({max_retries}회 시도): {e}")
                raise


class PooledConnection:
    """연결 풀 래퍼 - close() 호출 시 풀에 반환"""
    def __init__(self, conn, pool_obj):
        self._conn = conn
        self._pool = pool_obj

    def cursor(self, *args, **kwargs):
        return self._conn.cursor(*args, **kwargs)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        """연결을 풀에 반환 (트랜잭션 상태 정리 후)"""
        if self._pool and self._conn:
            try:
                # 트랜잭션이 열려있거나 에러 상태면 롤백
                self._conn.rollback()
            except:
                pass
            try:
                self._pool.putconn(self._conn)
            except:
                try:
                    self._conn.close()
                except:
                    pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def _check_connection(conn):
    """연결이 살아있는지 확인 (stale connection 감지)"""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        return True
    except Exception:
        return False


def close_connection_pool():
    """서버 종료 시 연결 풀 정리 (공개 인터페이스)"""
    global _connection_pool
    try:
        if _connection_pool:
            _connection_pool.closeall()
            print("[DB POOL] 연결 풀 정리 완료")
    except Exception as e:
        print(f"[DB POOL] 정리 오류: {e}")


def _reset_pool():
    """연결 풀 강제 재생성 (모든 연결이 죽었을 때)"""
    global _connection_pool, _pool_initialized
    print("[DB POOL] 연결 풀 강제 재생성 시작...")
    try:
        if _connection_pool:
            _connection_pool.closeall()
    except Exception:
        pass
    _connection_pool = None
    _pool_initialized = False
    _init_connection_pool()


def get_db_connection():
    """
    Railway PostgreSQL 연결 (연결 풀 사용)
    사용 후 conn.close()를 호출하면 자동으로 풀에 반환됩니다.
    - stale connection 자동 감지 및 교체
    - 풀 손상 시 자동 재생성
    """
    global _connection_pool
    import time

    # 풀이 초기화되지 않았으면 초기화
    if not _pool_initialized or _connection_pool is None:
        _init_connection_pool()

    # 최대 3번 재시도 (stale connection 감지 포함)
    pool_reset_attempted = False
    for attempt in range(3):
        try:
            conn = _connection_pool.getconn()

            # stale connection 감지: 연결이 살아있는지 확인
            if _check_connection(conn):
                return PooledConnection(conn, _connection_pool)

            # 연결이 죽어있으면 폐기하고 재시도
            print(f"[DB POOL] stale connection 감지, 폐기 후 재시도 ({attempt + 1}/3)")
            try:
                conn.close()
            except Exception:
                pass
            try:
                _connection_pool.putconn(conn, close=True)
            except Exception:
                pass

        except pool.PoolError as e:
            if attempt < 2:
                print(f"[DB POOL] 연결 풀 고갈, 0.5초 후 재시도 ({attempt + 1}/3)")
                time.sleep(0.5)
            else:
                print(f"[DB ERROR] 연결 풀 가져오기 실패 (3회 시도): {e}")
        except Exception as e:
            print(f"[DB ERROR] 연결 풀 오류: {e}")
            # 풀 자체가 손상된 경우 1회만 재생성 시도
            if not pool_reset_attempted:
                pool_reset_attempted = True
                try:
                    _reset_pool()
                    continue  # 재생성 후 다시 시도
                except Exception as reset_err:
                    print(f"[DB ERROR] 풀 재생성 실패: {reset_err}")
            break

    # 풀에서 실패하면 직접 연결 시도 (fallback)
    print("[DB WARN] 풀 실패, 직접 연결 시도")
    import psycopg2
    DATABASE_URL = os.environ.get("DATABASE_URL")
    conn_string = DATABASE_URL
    if 'sslmode=' not in conn_string:
        if '.flycast' in DATABASE_URL:
            conn_string += '?sslmode=disable'
        elif 'localhost' not in DATABASE_URL and '127.0.0.1' not in DATABASE_URL:
            conn_string += '?sslmode=require'
    return psycopg2.connect(conn_string)


def simple_unit_price_calculation(price: float, specification: str, unit: str, return_debug_info: bool = False):
    """
    개선된 단위당 단가 계산 (복잡한 규격 패턴 지원)

    핵심 개선사항:
    1. 괄호 안의 내용 우선 처리
    2. 모든 숫자+단위 패턴 추출 (findall 사용)
    3. 우선순위 규칙: G > KG, ML > L (작은 단위 우선)
    4. 곱셈 패턴 처리 (×, *, x)
    5. 계산 과정 디버깅 지원

    Args:
        price: 입고가
        specification: 규격
        unit: 단위
        return_debug_info: True면 (결과, 디버깅정보) 튜플 반환

    Returns:
        float 또는 (float, dict) - 단위당 단가 또는 (단가, 디버깅정보)
    """
    debug_info = {
        "matched_pattern": None,
        "extracted_value": None,
        "extracted_unit": None,
        "calculation": None,
        "success": False
    }

    try:
        # Decimal to float 변환 (PostgreSQL에서 받은 값 처리)
        price = float(price) if price else 0.0

        if not specification or not unit or price <= 0:
            return 0.0

        spec_upper = specification.upper().strip() if specification else ""
        unit_upper = unit.upper().strip() if unit else ""

        # 0단계: 빈 규격이나 None 처리
        if not spec_upper or spec_upper in ['NONE', 'NULL', '']:
            # 단위 기반으로 기본값 설정
            if unit_upper in ['KG', 'KGS']:
                result = round(price / 1000, 4)
                debug_info.update({
                    "matched_pattern": "빈 규격 - 단위 기반(KG)",
                    "extracted_value": 1,
                    "extracted_unit": "KG",
                    "calculation": f"{price} / 1000 = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_upper in ['EA', 'PCS', '개', 'PIECE', 'PAK', 'PAC', 'BOX', 'PK']:
                result = round(price / 1, 4)
                debug_info.update({
                    "matched_pattern": "빈 규격 - 단위 기반(EA)",
                    "extracted_value": 1,
                    "extracted_unit": "EA",
                    "calculation": f"{price} / 1 = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_upper in ['L', 'LITER']:
                result = round(price / 1000, 4)
                debug_info.update({
                    "matched_pattern": "빈 규격 - 단위 기반(L)",
                    "extracted_value": 1,
                    "extracted_unit": "L",
                    "calculation": f"{price} / 1000 = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_upper in ['G', 'GRAM']:
                result = round(price / 1, 4)
                debug_info.update({
                    "matched_pattern": "빈 규격 - 단위 기반(G)",
                    "extracted_value": 1,
                    "extracted_unit": "G",
                    "calculation": f"{price} / 1 = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_upper in ['ML', 'CC']:
                result = round(price / 1, 4)
                debug_info.update({
                    "matched_pattern": "빈 규격 - 단위 기반(ML)",
                    "extracted_value": 1,
                    "extracted_unit": "ML",
                    "calculation": f"{price} / 1 = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result

        # 1단계: 기본 단위 처리 (KG, EA, Kg 등)
        if spec_upper == unit_upper:
            if spec_upper in ['KG', 'KGS']:
                return round(price / 1000, 4)  # 1KG = 1000g
            elif spec_upper in ['EA', 'PCS', '개']:
                return round(price / 1, 4)     # 1EA = 1개
            elif spec_upper == 'L':
                return round(price / 1000, 4)  # 1L = 1000ml
            elif spec_upper in ['G', 'ML']:
                return round(price / 1, 4)     # 1G = 1g, 1ML = 1ml

        # ✅ 2단계: 개선된 복잡한 패턴 매칭
        # 2-0. 곱셈 패턴 처리 (×, *, x)
        # 예: "1KG×10" → 10KG, "500G*2" → 1000G
        multiply_pattern = re.search(r'(\d+(?:\.\d+)?)\s*(KG|G|L|ML)\s*[×*xX]\s*(\d+(?:\.\d+)?)', spec_upper)
        if multiply_pattern:
            value = float(multiply_pattern.group(1))
            unit_str = multiply_pattern.group(2)
            multiplier = float(multiply_pattern.group(3))
            total_value = value * multiplier

            if unit_str in ['KG']:
                result = round(price / (total_value * 1000), 4)
                debug_info.update({
                    "matched_pattern": f"곱셈 패턴 (KG): {value}{unit_str} × {multiplier}",
                    "extracted_value": total_value,
                    "extracted_unit": "KG",
                    "calculation": f"{price} / ({total_value} × 1000) = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_str in ['G']:
                result = round(price / total_value, 4)
                debug_info.update({
                    "matched_pattern": f"곱셈 패턴 (G): {value}{unit_str} × {multiplier}",
                    "extracted_value": total_value,
                    "extracted_unit": "G",
                    "calculation": f"{price} / {total_value} = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_str in ['L']:
                result = round(price / (total_value * 1000), 4)
                debug_info.update({
                    "matched_pattern": f"곱셈 패턴 (L): {value}{unit_str} × {multiplier}",
                    "extracted_value": total_value,
                    "extracted_unit": "L",
                    "calculation": f"{price} / ({total_value} × 1000) = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result
            elif unit_str in ['ML']:
                result = round(price / total_value, 4)
                debug_info.update({
                    "matched_pattern": f"곱셈 패턴 (ML): {value}{unit_str} × {multiplier}",
                    "extracted_value": total_value,
                    "extracted_unit": "ML",
                    "calculation": f"{price} / {total_value} = {result}",
                    "success": True
                })
                return (result, debug_info) if return_debug_info else result

        # 2-1. 괄호 안의 내용 우선 추출
        text_to_parse = spec_upper
        parenthesis_match = re.search(r'\(([^)]+)\)', spec_upper)
        if parenthesis_match:
            text_to_parse = parenthesis_match.group(1)
            debug_info["matched_pattern"] = f"괄호 내용 우선: '{text_to_parse}'"

        # 2-2. 모든 숫자+단위 패턴 추출 (findall 사용)
        # 무게: KG, G, GRAM
        weight_patterns = re.findall(r'(\d+(?:\.\d+)?)\s*(KG|G|GRAM)', text_to_parse)
        # 부피: L, LITER, ML, CC
        volume_patterns = re.findall(r'(\d+(?:\.\d+)?)\s*(L|LITER|ML|CC)', text_to_parse)
        # 개수: EA, PCS, 개, PIECE 등
        count_patterns = re.findall(r'(\d+(?:\.\d+)?)\s*(EA|PCS|개|PIECE|PAK|PAC|BOX|PK)', text_to_parse)

        # 2-3. 우선순위 규칙: 작은 단위 우선
        # 무게: G > KG
        if weight_patterns:
            # G 단위 우선
            g_items = [float(num) for num, unit in weight_patterns if unit == 'G' or unit == 'GRAM']
            if g_items:
                # 여러 개면 마지막 값 사용 (예: "10EA×500G" → 500G)
                weight_g = g_items[-1]
                if weight_g > 0:
                    result = round(price / weight_g, 4)
                    debug_info.update({
                        "matched_pattern": f"무게 패턴 (G): {weight_g}G",
                        "extracted_value": weight_g,
                        "extracted_unit": "G",
                        "calculation": f"{price} / {weight_g} = {result}",
                        "success": True
                    })
                    return (result, debug_info) if return_debug_info else result

            # KG 단위
            kg_items = [float(num) for num, unit in weight_patterns if unit == 'KG']
            if kg_items:
                weight_kg = kg_items[-1]
                if weight_kg > 0:
                    result = round(price / (weight_kg * 1000), 4)
                    debug_info.update({
                        "matched_pattern": f"무게 패턴 (KG): {weight_kg}KG",
                        "extracted_value": weight_kg,
                        "extracted_unit": "KG",
                        "calculation": f"{price} / ({weight_kg} × 1000) = {result}",
                        "success": True
                    })
                    return (result, debug_info) if return_debug_info else result

        # 부피: ML > L
        if volume_patterns:
            # ML, CC 단위 우선
            ml_items = [float(num) for num, unit in volume_patterns if unit in ['ML', 'CC']]
            if ml_items:
                volume_ml = ml_items[-1]
                if volume_ml > 0:
                    result = round(price / volume_ml, 4)
                    debug_info.update({
                        "matched_pattern": f"부피 패턴 (ML): {volume_ml}ML",
                        "extracted_value": volume_ml,
                        "extracted_unit": "ML",
                        "calculation": f"{price} / {volume_ml} = {result}",
                        "success": True
                    })
                    return (result, debug_info) if return_debug_info else result

            # L 단위
            l_items = [float(num) for num, unit in volume_patterns if unit in ['L', 'LITER']]
            if l_items:
                volume_l = l_items[-1]
                if volume_l > 0:
                    result = round(price / (volume_l * 1000), 4)
                    debug_info.update({
                        "matched_pattern": f"부피 패턴 (L): {volume_l}L",
                        "extracted_value": volume_l,
                        "extracted_unit": "L",
                        "calculation": f"{price} / ({volume_l} × 1000) = {result}",
                        "success": True
                    })
                    return (result, debug_info) if return_debug_info else result

        # 개수: EA, PCS 등
        if count_patterns:
            count_items = [float(num) for num, unit in count_patterns]
            if count_items:
                # 마지막 값 사용
                count = count_items[-1]
                if count > 0:
                    result = round(price / count, 4)
                    debug_info.update({
                        "matched_pattern": f"개수 패턴: {count}개",
                        "extracted_value": count,
                        "extracted_unit": "EA",
                        "calculation": f"{price} / {count} = {result}",
                        "success": True
                    })
                    return (result, debug_info) if return_debug_info else result

        # 2-4. 괄호 밖에서도 재시도 (괄호 안에서 실패한 경우)
        if parenthesis_match and text_to_parse != spec_upper:
            # 원본 텍스트에서 다시 시도
            weight_patterns = re.findall(r'(\d+(?:\.\d+)?)\s*(KG|G|GRAM)', spec_upper)
            if weight_patterns:
                for num, unit_str in reversed(weight_patterns):
                    value = float(num)
                    if unit_str == 'G' or unit_str == 'GRAM':
                        if value > 0:
                            return round(price / value, 4)
                    elif unit_str == 'KG':
                        if value > 0:
                            return round(price / (value * 1000), 4)

        # 기본값 반환 (계산 불가능한 경우)
        debug_info["matched_pattern"] = "패턴 매칭 실패"
        return (0.0, debug_info) if return_debug_info else 0.0

    except (ValueError, ZeroDivisionError, TypeError) as e:
        # 변환 실패, 0으로 나누기, 타입 에러 등 모든 예외 처리
        print(f"[PRICE CALC WARNING] 단가 계산 실패 (spec: {specification}, unit: {unit}): {e}")
        debug_info["matched_pattern"] = f"에러: {type(e).__name__}"
        return (0.0, debug_info) if return_debug_info else 0.0
    except Exception as e:
        # 예상치 못한 에러도 안전하게 처리
        print(f"[PRICE CALC ERROR] 예상치 못한 에러 (spec: {specification}, unit: {unit}): {e}")
        debug_info["matched_pattern"] = f"예외: {type(e).__name__}"
        return (0.0, debug_info) if return_debug_info else 0.0
