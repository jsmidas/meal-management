"""
다함 식자재 관리 시스템 - 식단 비즈니스 로직
30개 식단 운영을 위한 비용 계산 및 소요량 산출

⚠️ 주의: PostgreSQL 전용 (SQLite 지원 안 함)
"""

import json
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, date
from decimal import Decimal


class MealPlanCalculator:
    """식단 비용 계산 및 소요량 산출 클래스"""

    def __init__(self, db_connection):
        self.conn = db_connection
        self.cursor = db_connection.cursor()

    def calculate_recipe_cost(self, recipe_id: int, serving_count: int, target_date: date = None) -> Dict[str, Any]:
        """레시피 기반 비용 계산"""
        try:
            # 타겟 날짜가 없으면 오늘 날짜 사용
            if not target_date:
                target_date = date.today()

            # 레시피의 재료 정보 조회
            self.cursor.execute("""
                SELECT
                    i.id as ingredient_id,
                    mri.quantity,
                    mri.unit,
                    i.ingredient_name as ingredient_name,
                    i.unit as base_unit,
                    i.purchase_price as latest_price,
                    i.price_per_unit as unit_price_per_gram
                FROM menu_recipe_ingredients mri
                JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                WHERE mri.recipe_id = %s
            """, (recipe_id,))

            ingredients = self.cursor.fetchall()

            if not ingredients:
                return {
                    "total_cost": 0,
                    "cost_per_serving": 0,
                    "ingredients_cost": [],
                    "error": "레시피에 재료 정보가 없습니다."
                }

            total_cost = 0
            ingredients_cost = []

            for ingredient in ingredients:
                ingredient_id, quantity, unit, name, base_unit, latest_price, unit_price_per_gram = ingredient
                
                # PostgreSQL Decimal -> float 변환
                quantity = float(quantity) if quantity is not None else 0.0
                latest_price = float(latest_price) if latest_price is not None else 0.0
                unit_price_per_gram = float(unit_price_per_gram) if unit_price_per_gram is not None else 0.0

                # 날짜 기반 단가 조회 (가장 중요)
                # 이력이 있으면 그것을 사용하고, 없으면 최신 단가 사용
                self.cursor.execute("""
                    SELECT price_per_unit, purchase_price
                    FROM ingredient_price_history
                    WHERE ingredient_id = %s
                    AND start_date <= %s
                    AND (end_date IS NULL OR end_date >= %s)
                    ORDER BY start_date DESC
                    LIMIT 1
                """, (ingredient_id, target_date, target_date))
                
                history = self.cursor.fetchone()
                
                if history:
                    # 이력에서 찾은 단가 (단위당 단가 또는 입고가)
                    # 우선순위: 단위당 단가 > 입고가 (입고가는 단위 환산 필요할 수 있음)
                    # 여기서는 로직 단순화를 위해 unit_price_per_gram을 대체할 값을 결정
                    # 하지만 history에는 unit_price_per_gram(g당 단가)가 아니라 price_per_unit(단위당 단가)가 저장됨.
                    # 기존 로직과 맞추기 위해 변환 로직이 필요할 수 있으나,
                    # 만약 history.price_per_unit이 'g당 단가'로 저장된다면 그대로 사용.
                    # SQL 테이블 주석: price_per_unit IS '단위당 단가 (g/ml 등)'
                    
                    price_from_history = float(history[0]) if history[0] is not None else None
                    if price_from_history:
                        unit_price_per_gram = price_from_history
                        # 이 경우 latest_price는 무시됨 (아래 _calculate_ingredient_cost에서 unit_price_per_gram 우선 사용)
                    else:
                        # 단위당 단가가 없으면 구매가 사용 (단, 이 경우 단위 변환 이슈가 있을 수 있음)
                        # 따라서 가능한 latest_price를 history의 구매가로 대체
                        latest_price = float(history[1]) if history[1] is not None else latest_price

                # 단위 환산 및 비용 계산
                cost_info = self._calculate_ingredient_cost(
                    ingredient_id, quantity, unit, serving_count,
                    name, latest_price, unit_price_per_gram
                )

                if cost_info:
                    total_cost += cost_info['total_cost']
                    ingredients_cost.append(cost_info)

            cost_per_serving = total_cost / serving_count if serving_count > 0 else 0

            return {
                "total_cost": round(total_cost, 2),
                "cost_per_serving": round(cost_per_serving, 2),
                "ingredients_cost": ingredients_cost,
                "serving_count": serving_count
            }

        except Exception as e:
            print(f"Recipe cost calculation error: {e}")
            return {
                "total_cost": 0,
                "cost_per_serving": 0,
                "ingredients_cost": [],
                "error": str(e)
            }

    def _calculate_ingredient_cost(self, ingredient_id: int, quantity: float, unit: str,
                                 serving_count: int, name: str, latest_price: float,
                                 unit_price_per_gram: float) -> Optional[Dict[str, Any]]:
        """개별 재료 비용 계산"""
        try:
            # 단위별 계산
            total_quantity = quantity * serving_count

            # 단위 가격 계산 (g 기준)
            if unit_price_per_gram and unit_price_per_gram > 0:
                # g 기준 단가가 있는 경우
                quantity_in_grams = self._convert_to_grams(total_quantity, unit)
                if quantity_in_grams is not None:
                     # convert_to_grams가 0을 반환할 수도 있으므로 None 체크
                    total_cost = quantity_in_grams * unit_price_per_gram
                else:
                    # 변환 실패 시 최신 가격 사용 (단위가 맞지 않는 경우 등)
                    # 하지만 단위가 다르면 latest_price도 의미 없을 수 있음.
                    # 여기서는 단순히 quantity * latest_price로 계산 (개당 단가 등일 경우)
                    if unit in ['개', 'ea', 'piece', 'box', 'can', 'bottle']:
                         total_cost = total_quantity * latest_price
                    else:
                        total_cost = latest_price or 0
            else:
                # 단가가 없는 경우 최신 가격 사용
                # 이 경우 latest_price가 '단위당 가격'인지 '총 가격'인지 모호함.
                # 보통은 '표준 단위당 가격'일 것임.
                total_cost = (latest_price or 0) * (total_quantity if unit in ['개', 'ea'] else 1) # 단순화

            return {
                "ingredient_id": ingredient_id,
                "ingredient_name": name,
                "quantity_per_serving": quantity,
                "total_quantity": total_quantity,
                "unit": unit,
                "unit_price": unit_price_per_gram or 0,
                "total_cost": round(total_cost, 2),
                "cost_per_serving": round(total_cost / serving_count if serving_count > 0 else 0, 2)
            }

        except Exception as e:
            print(f"Ingredient cost calculation error for {name}: {e}")
            return None

    def _convert_to_grams(self, quantity: float, unit: str) -> Optional[float]:
        """단위를 그램으로 변환"""
        if not unit: return None
        unit_lower = unit.lower()

        conversion_table = {
            'g': 1,
            'gram': 1,
            'kg': 1000,
            'kilogram': 1000,
            'ml': 1,  # 액체의 경우 근사치 (물 기준)
            'l': 1000,
            'liter': 1000,
            '개': 100,  # 개당 평균 100g 가정 (위험한 가정이지만 기존 로직 유지)
            'ea': 100,
            'piece': 100,
            '근': 600,  # 1근 = 600g
            '되': 1800,  # 1되 = 1.8kg
            'lb': 453.59,
            'oz': 28.35
        }

        for key, multiplier in conversion_table.items():
            if key == unit_lower or (len(key) > 1 and key in unit_lower):
                 # 정확한 매칭을 위해 우선순위 등 고려 필요하나 간단히 처리
                 if unit_lower == key:
                     return quantity * multiplier
                 # 'kg'가 'pkg'에 매칭되지 않도록 주의 필요하나 현재는 단순 포함 관계
                 if key in unit_lower: 
                     return quantity * multiplier

        # 변환할 수 없는 단위의 경우 None 반환
        return None

    def calculate_meal_plan_cost(self, meal_plan_master_id: int, start_date: date,
                               end_date: date) -> Dict[str, Any]:
        """기간별 식단 비용 계산"""
        try:
            # 해당 기간의 스케줄 조회
            self.cursor.execute("""
                SELECT
                    mps.id, mps.plan_date, mps.recipe_id, mps.serving_count,
                    mps.estimated_cost, mps.actual_cost,
                    mr.name as recipe_name
                FROM meal_plan_schedules mps
                LEFT JOIN menu_recipes mr ON mps.recipe_id = mr.id
                WHERE mps.meal_plan_master_id = %s
                AND mps.plan_date BETWEEN %s AND %s
                ORDER BY mps.plan_date
            """, (meal_plan_master_id, start_date, end_date))

            schedules = self.cursor.fetchall()

            if not schedules:
                return {
                    "total_estimated_cost": 0,
                    "total_actual_cost": 0,
                    "daily_costs": [],
                    "summary": {
                        "total_days": 0,
                        "avg_cost_per_day": 0,
                        "avg_cost_per_serving": 0
                    }
                }

            daily_costs = []
            total_estimated_cost = 0
            total_actual_cost = 0
            total_servings = 0

            for schedule in schedules:
                schedule_id, plan_date, recipe_id, serving_count, estimated_cost, actual_cost, recipe_name = schedule

                # 실제 비용이 없으면 레시피 기반으로 계산
                if not actual_cost and recipe_id and serving_count:
                    # 날짜 기준 비용 계산 호출!
                    recipe_cost = self.calculate_recipe_cost(recipe_id, serving_count, target_date=plan_date)
                    calculated_cost = recipe_cost['total_cost']
                else:
                    calculated_cost = actual_cost or estimated_cost or 0

                daily_cost = {
                    "schedule_id": schedule_id,
                    "plan_date": plan_date,
                    "recipe_id": recipe_id,
                    "recipe_name": recipe_name,
                    "serving_count": serving_count,
                    "estimated_cost": estimated_cost or 0,
                    "actual_cost": actual_cost or 0,
                    "calculated_cost": calculated_cost
                }

                daily_costs.append(daily_cost)
                total_estimated_cost += estimated_cost or 0
                total_actual_cost += actual_cost or 0
                total_servings += serving_count or 0

            return {
                "total_estimated_cost": round(total_estimated_cost, 2),
                "total_actual_cost": round(total_actual_cost, 2),
                "daily_costs": daily_costs,
                "summary": {
                    "total_days": len(schedules),
                    "total_servings": total_servings,
                    "avg_cost_per_day": round(total_estimated_cost / len(schedules) if schedules else 0, 2),
                    "avg_cost_per_serving": round(total_estimated_cost / total_servings if total_servings > 0 else 0, 2)
                }
            }

        except Exception as e:
            print(f"Meal plan cost calculation error: {e}")
            return {
                "total_estimated_cost": 0,
                "total_actual_cost": 0,
                "daily_costs": [],
                "error": str(e)
            }

    def calculate_ingredient_requirements(self, meal_plan_master_id: int,
                                        start_date: date, end_date: date) -> List[Dict[str, Any]]:
        """기간별 식자재 소요량 계산"""
        try:
            # 해당 기간의 모든 스케줄과 레시피 정보 조회
            self.cursor.execute("""
                SELECT
                    mps.id as schedule_id, mps.plan_date, mps.recipe_id,
                    mps.serving_count, mr.name as recipe_name
                FROM meal_plan_schedules mps
                LEFT JOIN menu_recipes mr ON mps.recipe_id = mr.id
                WHERE mps.meal_plan_master_id = %s
                AND mps.plan_date BETWEEN %s AND %s
                AND mps.recipe_id IS NOT NULL
            """, (meal_plan_master_id, start_date, end_date))

            schedules = self.cursor.fetchall()

            if not schedules:
                return []

            # 식자재별 소요량 집계
            ingredient_requirements = {}

            for schedule in schedules:
                schedule_id, plan_date, recipe_id, serving_count, recipe_name = schedule

                if not recipe_id or not serving_count:
                    continue

                # 레시피의 재료 정보 조회
                self.cursor.execute("""
                    SELECT
                        i.id as ingredient_id, mri.quantity, mri.unit,
                        i.ingredient_name as ingredient_name, i.unit as base_unit,
                        i.purchase_price as latest_price,
                        i.price_per_unit as unit_price_per_gram
                    FROM menu_recipe_ingredients mri
                    JOIN ingredients i ON mri.ingredient_code = i.ingredient_code
                    WHERE mri.recipe_id = %s
                """, (recipe_id,))

                recipe_ingredients = self.cursor.fetchall()

                for ingredient in recipe_ingredients:
                    ingredient_id, quantity, unit, name, base_unit, latest_price, unit_price_per_gram = ingredient

                    # PostgreSQL Decimal -> float 변환
                    quantity = float(quantity) if quantity is not None else 0.0
                    latest_price = float(latest_price) if latest_price is not None else 0.0
                    unit_price_per_gram = float(unit_price_per_gram) if unit_price_per_gram is not None else 0.0

                    # 날짜 기반 단가 조회
                    self.cursor.execute("""
                        SELECT price_per_unit, purchase_price
                        FROM ingredient_price_history
                        WHERE ingredient_id = %s
                        AND start_date <= %s
                        AND (end_date IS NULL OR end_date >= %s)
                        ORDER BY start_date DESC
                        LIMIT 1
                    """, (ingredient_id, plan_date, plan_date))
                    
                    history = self.cursor.fetchone()
                    if history:
                        price_from_history = float(history[0]) if history[0] is not None else None
                        if price_from_history:
                            unit_price_per_gram = price_from_history
                        else:
                            latest_price = float(history[1]) if history[1] is not None else latest_price

                    total_quantity = quantity * serving_count

                    if ingredient_id not in ingredient_requirements:
                        ingredient_requirements[ingredient_id] = {
                            "ingredient_id": ingredient_id,
                            "ingredient_name": name,
                            "base_unit": base_unit,
                            "total_quantity": 0,
                            "unit": unit,
                            "estimated_cost": 0,
                            "usage_details": []
                        }

                    # 수량 누적
                    ingredient_requirements[ingredient_id]["total_quantity"] += total_quantity

                    # 비용 계산
                    if unit_price_per_gram and unit_price_per_gram > 0:
                        quantity_in_grams = self._convert_to_grams(total_quantity, unit)
                        if quantity_in_grams is not None:
                            cost = quantity_in_grams * unit_price_per_gram
                        else:
                             # 단위 변환 실패시 개수 기반 또는 단순 곱
                            if unit in ['개', 'ea', 'piece', 'box']:
                                cost = total_quantity * latest_price
                            else:
                                cost = latest_price or 0
                    else:
                        cost = (latest_price or 0) * (total_quantity if unit in ['개', 'ea'] else 1)

                    ingredient_requirements[ingredient_id]["estimated_cost"] += cost

                    # 사용 상세 기록
                    ingredient_requirements[ingredient_id]["usage_details"].append({
                        "plan_date": plan_date,
                        "recipe_name": recipe_name,
                        "quantity": total_quantity,
                        "serving_count": serving_count
                    })

            # 리스트로 변환하고 비용 순으로 정렬
            result = list(ingredient_requirements.values())
            for item in result:
                item["estimated_cost"] = round(item["estimated_cost"], 2)

            result.sort(key=lambda x: x["estimated_cost"], reverse=True)

            return result

        except Exception as e:
            print(f"Ingredient requirements calculation error: {e}")
            return []

    def get_budget_analysis(self, meal_plan_master_id: int,
                          tracking_month: date) -> Dict[str, Any]:
        """월별 예산 분석"""
        try:
            # 식단 마스터 정보 조회
            self.cursor.execute("""
                SELECT name, budget_per_month, target_people_count
                FROM meal_plan_masters
                WHERE id = %s
            """, (meal_plan_master_id,))

            meal_plan = self.cursor.fetchone()
            if not meal_plan:
                return {"error": "식단을 찾을 수 없습니다."}

            name, budget_per_month, target_people_count = meal_plan

            # 해당 월의 실제 비용 조회
            month_start = tracking_month.replace(day=1)
            if tracking_month.month == 12:
                month_end = tracking_month.replace(year=tracking_month.year + 1, month=1, day=1)
            else:
                month_end = tracking_month.replace(month=tracking_month.month + 1, day=1)

            self.cursor.execute("""
                SELECT
                    COUNT(*) as total_days,
                    SUM(COALESCE(actual_cost, estimated_cost, 0)) as total_cost,
                    SUM(serving_count) as total_servings,
                    AVG(COALESCE(actual_cost, estimated_cost, 0)) as avg_daily_cost
                FROM meal_plan_schedules
                WHERE meal_plan_master_id = %s
                AND plan_date >= %s AND plan_date < %s
            """, (meal_plan_master_id, month_start, month_end))

            stats = self.cursor.fetchone()
            total_days, total_cost, total_servings, avg_daily_cost = stats

            # 예산 사용률 계산
            budget_usage_rate = 0
            remaining_budget = budget_per_month or 0

            if budget_per_month and budget_per_month > 0:
                budget_usage_rate = (total_cost / budget_per_month) * 100
                remaining_budget = budget_per_month - total_cost

            # 1식당 비용 계산
            cost_per_serving = total_cost / total_servings if total_servings > 0 else 0

            return {
                "meal_plan_name": name,
                "tracking_month": tracking_month.strftime("%Y-%m"),
                "budget_per_month": budget_per_month or 0,
                "total_cost": round(total_cost, 2),
                "remaining_budget": round(remaining_budget, 2),
                "budget_usage_rate": round(budget_usage_rate, 2),
                "total_days": total_days,
                "total_servings": total_servings,
                "target_people_count": target_people_count,
                "avg_daily_cost": round(avg_daily_cost or 0, 2),
                "cost_per_serving": round(cost_per_serving, 2),
                "efficiency_score": self._calculate_efficiency_score(
                    budget_usage_rate, cost_per_serving, target_people_count
                )
            }

        except Exception as e:
            print(f"Budget analysis error: {e}")
            return {"error": str(e)}

    def _calculate_efficiency_score(self, budget_usage_rate: float,
                                  cost_per_serving: float, target_people_count: int) -> float:
        """효율성 점수 계산 (0-100)"""
        try:
            # 예산 효율성 (예산 사용률이 85% 이하일 때 높은 점수)
            budget_score = max(0, 100 - abs(budget_usage_rate - 85))

            # 비용 효율성 (1식당 5000-8000원 범위가 적정)
            if 5000 <= cost_per_serving <= 8000:
                cost_score = 100
            elif cost_per_serving < 5000:
                cost_score = 80  # 너무 저렴할 수도 있음
            else:
                cost_score = max(0, 100 - (cost_per_serving - 8000) / 100)

            # 종합 점수
            efficiency_score = (budget_score * 0.6 + cost_score * 0.4)

            return round(min(100, max(0, efficiency_score)), 2)

        except Exception as e:
            print(f"Efficiency score calculation error: {e}")
            return 0


def get_meal_plan_calculator(db_connection) -> MealPlanCalculator:
    """MealPlanCalculator 인스턴스 생성"""
    return MealPlanCalculator(db_connection)