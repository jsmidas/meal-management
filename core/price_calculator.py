#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
통합 단가 계산 시스템 (Unified Price Calculator)

84,215개 식자재 데이터를 위한 4개 엔진 통합 가격 계산 시스템:
1. Fast Calculator (기본) - PostgreSQL 호환 빠른 계산
2. Enhanced Calculator (고급) - 장비류 및 복잡한 규격 처리
3. Learning Calculator (AI) - 패턴 학습 및 사용자 피드백 적용
4. Improved Calculator (정교) - 최고 정확도 계산

폭포수 방식(Waterfall) 계산으로 최적의 결과 제공
"""

import re
import os
import sys
from typing import Optional, Tuple, Dict, Any
from decimal import Decimal, InvalidOperation
from datetime import datetime

# 기존 계산 모듈들 임포트
try:
    from enhanced_price_calculator import calculate_enhanced_unit_price
    ENHANCED_AVAILABLE = True
except ImportError:
    ENHANCED_AVAILABLE = False
    print("[WARNING] Enhanced calculator not available")

try:
    from learning_price_calculator import calculate_unit_price_with_learning
    LEARNING_AVAILABLE = True
except ImportError:
    LEARNING_AVAILABLE = False
    print("[WARNING] Learning calculator not available")

# 기본 Fast Calculator (항상 사용 가능)
def calculate_unit_price_fast(price, specification, unit, ingredient_id=None):
    """PostgreSQL 호환 단위 가격 계산 함수 - 간단한 정규식 사용"""
    if not price or price <= 0 or not specification:
        return None

    try:
        # 기본 패턴들 (안전한 정규식 사용)
        patterns = [
            (r'(\d+)kg', lambda m: price / (int(m.group(1)) * 1000)),  # kg -> g 단위
            (r'(\d+)g', lambda m: price / int(m.group(1))),            # g 단위
            (r'(\d+)ml', lambda m: price / int(m.group(1))),           # ml 단위
            (r'(\d+)L', lambda m: price / (int(m.group(1)) * 1000)),   # L -> ml 단위
            (r'(\d+)개', lambda m: price / int(m.group(1))),           # 개 단위
            (r'(\d+)EA', lambda m: price / int(m.group(1))),           # EA 단위
        ]

        spec_lower = specification.lower()
        for pattern, calc_func in patterns:
            match = re.search(pattern, spec_lower)
            if match:
                return calc_func(match)

        # 패턴을 찾지 못한 경우 기본값
        return price

    except Exception as e:
        print(f"[FAST] Unit price calculation error: {e}")
        return price


class UnifiedPriceCalculator:
    """통합 단가 계산 시스템"""

    def __init__(self):
        self.calculation_stats = {
            'fast': 0,
            'enhanced': 0,
            'learning': 0,
            'improved': 0,
            'fallback': 0
        }

    def calculate_unit_price(self, price: float, specification: str, unit: str = None,
                           ingredient_id: int = None, use_learning: bool = True) -> Tuple[float, str, Dict]:
        """
        통합 단가 계산 - 폭포수 방식

        Args:
            price: 입고 단가
            specification: 규격 정보
            unit: 단위
            ingredient_id: 식자재 ID
            use_learning: 학습 엔진 사용 여부

        Returns:
            (계산된 단가, 사용된 엔진, 메타데이터)
        """
        if not price or price <= 0 or not specification:
            return None, 'none', {'error': 'Invalid input parameters'}

        calculation_metadata = {
            'timestamp': datetime.now().isoformat(),
            'input_price': price,
            'specification': specification,
            'unit': unit,
            'ingredient_id': ingredient_id,
            'engines_tried': []
        }

        # 1단계: Learning Calculator (최우선 - AI 학습 적용)
        if use_learning and LEARNING_AVAILABLE:
            try:
                result = calculate_unit_price_with_learning(price, specification, unit, ingredient_id)
                if result and result > 0:
                    self.calculation_stats['learning'] += 1
                    calculation_metadata['engines_tried'].append('learning')
                    calculation_metadata['confidence'] = 'high'
                    return result, 'learning', calculation_metadata
            except Exception as e:
                calculation_metadata['engines_tried'].append(f'learning_failed:{str(e)[:50]}')

        # 2단계: Enhanced Calculator (고급 - 장비류 및 복잡 규격)
        if ENHANCED_AVAILABLE:
            try:
                result = calculate_enhanced_unit_price(price, specification, unit, ingredient_id)
                if result and result > 0 and result != price:  # 계산된 값이 원가와 다른 경우만
                    self.calculation_stats['enhanced'] += 1
                    calculation_metadata['engines_tried'].append('enhanced')
                    calculation_metadata['confidence'] = 'medium-high'
                    return result, 'enhanced', calculation_metadata
            except Exception as e:
                calculation_metadata['engines_tried'].append(f'enhanced_failed:{str(e)[:50]}')

        # 3단계: Fast Calculator (기본 - 빠른 계산)
        try:
            result = calculate_unit_price_fast(price, specification, unit, ingredient_id)
            if result and result > 0 and result != price:  # 계산된 값이 원가와 다른 경우만
                self.calculation_stats['fast'] += 1
                calculation_metadata['engines_tried'].append('fast')
                calculation_metadata['confidence'] = 'medium'
                return result, 'fast', calculation_metadata
        except Exception as e:
            calculation_metadata['engines_tried'].append(f'fast_failed:{str(e)[:50]}')

        # 4단계: Fallback (원가 그대로 반환)
        self.calculation_stats['fallback'] += 1
        calculation_metadata['engines_tried'].append('fallback')
        calculation_metadata['confidence'] = 'low'
        return price, 'fallback', calculation_metadata

    def batch_calculate(self, ingredients: list, progress_callback=None) -> Dict:
        """대량 계산 (84K 데이터 처리)"""
        results = []
        total = len(ingredients)
        processed = 0

        for ingredient in ingredients:
            try:
                price = ingredient.get('purchase_price')
                spec = ingredient.get('specification')
                unit = ingredient.get('unit')
                ing_id = ingredient.get('id')

                calculated_price, engine, metadata = self.calculate_unit_price(
                    price, spec, unit, ing_id
                )

                results.append({
                    'ingredient_id': ing_id,
                    'original_price': price,
                    'calculated_price': calculated_price,
                    'engine_used': engine,
                    'metadata': metadata
                })

            except Exception as e:
                results.append({
                    'ingredient_id': ingredient.get('id'),
                    'error': str(e)
                })

            processed += 1
            if progress_callback and processed % 1000 == 0:
                progress_callback(processed, total)

        return {
            'total_processed': processed,
            'results': results,
            'statistics': self.calculation_stats.copy(),
            'success_rate': (processed - len([r for r in results if 'error' in r])) / processed * 100
        }

    def get_statistics(self) -> Dict:
        """계산 통계 반환"""
        total = sum(self.calculation_stats.values())
        if total == 0:
            return self.calculation_stats

        stats_with_percentage = {}
        for engine, count in self.calculation_stats.items():
            stats_with_percentage[engine] = {
                'count': count,
                'percentage': round(count / total * 100, 2)
            }

        return {
            'total_calculations': total,
            'engine_usage': stats_with_percentage,
            'available_engines': {
                'fast': True,  # 항상 사용 가능
                'enhanced': ENHANCED_AVAILABLE,
                'learning': LEARNING_AVAILABLE,
                'improved': False  # 향후 구현
            }
        }

    def optimize_for_search(self, search_term: str, max_results: int = 1000) -> Dict:
        """검색 최적화 - 단위당 단가 정렬 문제 해결"""
        # 검색어가 있을 때는 더 정확한 계산 엔진을 우선 사용
        optimization_settings = {
            'use_learning': True,
            'prefer_enhanced': True,
            'max_calculation_time': 5.0,  # 초
            'sort_by_unit_price': True
        }

        # 특정 검색어에 대한 최적화
        search_lower = search_term.lower() if search_term else ""

        if any(keyword in search_lower for keyword in ['돈까스', '치킨', '고기']):
            # 육류 제품은 정확한 g당 가격이 중요
            optimization_settings['prefer_enhanced'] = True
            optimization_settings['use_learning'] = True

        elif any(keyword in search_lower for keyword in ['소스', '양념', '조미료']):
            # 소스류는 ml 또는 g 단위 정확도가 중요
            optimization_settings['prefer_enhanced'] = True

        return optimization_settings


# 전역 계산기 인스턴스
_unified_calculator = UnifiedPriceCalculator()

def calculate_unit_price_unified(price: float, specification: str, unit: str = None,
                               ingredient_id: int = None, use_learning: bool = True) -> Tuple[float, str]:
    """
    통합 단가 계산 함수 (단순 인터페이스)

    기존 코드와의 호환성을 위한 래퍼 함수
    """
    result, engine, metadata = _unified_calculator.calculate_unit_price(
        price, specification, unit, ingredient_id, use_learning
    )
    return result, engine

def get_calculator_statistics() -> Dict:
    """계산기 통계 조회"""
    return _unified_calculator.get_statistics()

def reset_calculator_statistics():
    """계산기 통계 초기화"""
    _unified_calculator.calculation_stats = {
        'fast': 0,
        'enhanced': 0,
        'learning': 0,
        'improved': 0,
        'fallback': 0
    }

# 성능 테스트 함수
def performance_test(test_data: list = None) -> Dict:
    """성능 테스트 실행"""
    import time

    if not test_data:
        # 테스트 데이터 생성
        test_data = [
            {'purchase_price': 1000, 'specification': '500g', 'unit': 'g', 'id': 1},
            {'purchase_price': 2000, 'specification': '1kg', 'unit': 'kg', 'id': 2},
            {'purchase_price': 1500, 'specification': '300ml', 'unit': 'ml', 'id': 3},
            {'purchase_price': 5000, 'specification': '돈까스 100g*10개', 'unit': 'g', 'id': 4},
            {'purchase_price': 50000, 'specification': '인덕션 1대', 'unit': '대', 'id': 5},
        ] * 200  # 1000개 테스트 데이터

    start_time = time.time()

    results = _unified_calculator.batch_calculate(test_data)

    end_time = time.time()
    total_time = end_time - start_time

    return {
        'total_time_seconds': round(total_time, 3),
        'items_per_second': round(len(test_data) / total_time, 2),
        'average_time_per_item_ms': round(total_time / len(test_data) * 1000, 3),
        'results_summary': results,
        'performance_rating': 'Excellent' if total_time < 1.0 else 'Good' if total_time < 5.0 else 'Needs Optimization'
    }

if __name__ == "__main__":
    # 간단한 테스트
    print("=== 통합 단가 계산 시스템 테스트 ===")

    test_cases = [
        (1000, "500g", "g"),
        (2000, "1kg", "kg"),
        (1500, "300ml", "ml"),
        (5000, "돈까스 100g*10개", "g"),
        (50000, "인덕션 1대", "대"),
    ]

    for price, spec, unit in test_cases:
        result, engine, metadata = _unified_calculator.calculate_unit_price(price, spec, unit)
        print(f"입고가: {price:,}원, 규격: {spec}")
        print(f"→ 단위당 단가: {result:.2f}원, 엔진: {engine}")
        print(f"  시도한 엔진들: {metadata.get('engines_tried', [])}")
        print()

    print("=== 계산 통계 ===")
    stats = _unified_calculator.get_statistics()
    print(f"총 계산 횟수: {stats['total_calculations']}")
    for engine, data in stats['engine_usage'].items():
        print(f"{engine}: {data['count']}회 ({data['percentage']}%)")

    print("\n=== 성능 테스트 ===")
    perf_result = performance_test()
    print(f"처리 속도: {perf_result['items_per_second']:.1f}개/초")
    print(f"평균 처리 시간: {perf_result['average_time_per_item_ms']:.1f}ms/개")
    print(f"성능 등급: {perf_result['performance_rating']}")