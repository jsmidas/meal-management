#!/usr/bin/env python3
"""
다함 식자재 관리 시스템 - 식자재 데이터 모델
84K 식자재 데이터를 위한 Pydantic 모델들
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from enum import Enum

class IngredientCategory(str, Enum):
    """식자재 카테고리"""
    VEGETABLE = "채소류"
    FRUIT = "과일류"
    MEAT = "육류"
    SEAFOOD = "수산물"
    GRAIN = "곡물류"
    DAIRY = "유제품"
    SEASONING = "조미료"
    PROCESSED = "가공식품"
    FROZEN = "냉동식품"
    BEVERAGE = "음료"
    OTHER = "기타"

class SupplierCode(str, Enum):
    """협력업체 코드"""
    SAMSUNG_WELSTORY = "SWS"
    HYUNDAI_GREEN_FOOD = "HGF"
    CJ_FOODVILLE = "CJ"
    FOODIST = "FDS"
    DONGWON_HOME_FOOD = "DWN"
    OTHER = "ETC"

class Unit(str, Enum):
    """단위"""
    KG = "kg"
    G = "g"
    L = "L"
    ML = "ml"
    EA = "ea"
    PACK = "pack"
    BOX = "box"
    BAG = "bag"

# Base Models
class IngredientBase(BaseModel):
    """식자재 기본 모델"""
    ingredient_name: str = Field(..., min_length=1, max_length=200, description="식자재명")
    category: Optional[str] = Field(None, max_length=100, description="카테고리")
    unit: Optional[str] = Field("kg", max_length=20, description="단위")
    price_per_unit: Optional[float] = Field(None, ge=0, description="단위당 가격")
    supplier_name: Optional[str] = Field(None, max_length=100, description="협력업체명")
    supplier_code: Optional[str] = Field(None, max_length=50, description="협력업체 코드")
    description: Optional[str] = Field(None, max_length=500, description="설명")
    storage_method: Optional[str] = Field(None, max_length=100, description="보관방법")
    shelf_life_days: Optional[int] = Field(None, ge=0, description="유통기한(일)")
    origin_country: Optional[str] = Field(None, max_length=50, description="원산지")
    is_organic: Optional[bool] = Field(False, description="유기농 여부")
    is_halal: Optional[bool] = Field(False, description="할랄 인증 여부")
    allergen_info: Optional[str] = Field(None, max_length=200, description="알러지 정보")
    nutritional_info: Optional[Dict[str, Any]] = Field(None, description="영양성분 정보")

    @validator('ingredient_name')
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError('식자재명은 필수입니다')
        return v.strip()

    @validator('price_per_unit')
    def validate_price(cls, v):
        if v is not None and v < 0:
            raise ValueError('가격은 0 이상이어야 합니다')
        return v

    @validator('category')
    def validate_category(cls, v):
        if v:
            return v.strip()
        return v

class IngredientCreate(IngredientBase):
    """식자재 생성 모델"""
    created_by: Optional[str] = Field(None, max_length=100, description="생성자")

    class Config:
        schema_extra = {
            "example": {
                "ingredient_name": "양파",
                "category": "채소류",
                "unit": "kg",
                "price_per_unit": 2500.0,
                "supplier_name": "삼성웰스토리",
                "supplier_code": "SWS",
                "description": "국내산 황색 양파",
                "storage_method": "냉장보관",
                "shelf_life_days": 30,
                "origin_country": "대한민국",
                "is_organic": False,
                "allergen_info": "없음"
            }
        }

class IngredientUpdate(BaseModel):
    """식자재 수정 모델 (부분 업데이트)"""
    ingredient_name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, max_length=100)
    unit: Optional[str] = Field(None, max_length=20)
    price_per_unit: Optional[float] = Field(None, ge=0)
    supplier_name: Optional[str] = Field(None, max_length=100)
    supplier_code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=500)
    storage_method: Optional[str] = Field(None, max_length=100)
    shelf_life_days: Optional[int] = Field(None, ge=0)
    origin_country: Optional[str] = Field(None, max_length=50)
    is_organic: Optional[bool] = None
    is_halal: Optional[bool] = None
    allergen_info: Optional[str] = Field(None, max_length=200)
    nutritional_info: Optional[Dict[str, Any]] = None
    updated_by: Optional[str] = Field(None, max_length=100, description="수정자")

    @validator('ingredient_name')
    def validate_name(cls, v):
        if v is not None and (not v or not v.strip()):
            raise ValueError('식자재명이 비어있을 수 없습니다')
        return v.strip() if v else v

    @validator('price_per_unit')
    def validate_price(cls, v):
        if v is not None and v < 0:
            raise ValueError('가격은 0 이상이어야 합니다')
        return v

class IngredientResponse(IngredientBase):
    """식자재 응답 모델"""
    id: int = Field(..., description="식자재 ID")
    created_at: datetime = Field(..., description="생성일시")
    updated_at: Optional[datetime] = Field(None, description="수정일시")
    created_by: Optional[str] = Field(None, description="생성자")
    updated_by: Optional[str] = Field(None, description="수정자")

    # 계산 필드들
    has_valid_price: bool = Field(False, description="유효한 가격 보유 여부")
    last_price_update: Optional[datetime] = Field(None, description="마지막 가격 업데이트")
    usage_count: Optional[int] = Field(0, description="레시피 사용 횟수")

    class Config:
        from_attributes = True
        schema_extra = {
            "example": {
                "id": 1,
                "ingredient_name": "양파",
                "category": "채소류",
                "unit": "kg",
                "price_per_unit": 2500.0,
                "supplier_name": "삼성웰스토리",
                "supplier_code": "SWS",
                "description": "국내산 황색 양파",
                "storage_method": "냉장보관",
                "shelf_life_days": 30,
                "origin_country": "대한민국",
                "is_organic": False,
                "is_halal": False,
                "allergen_info": "없음",
                "created_at": "2025-09-26T10:00:00",
                "updated_at": "2025-09-26T12:00:00",
                "has_valid_price": True,
                "usage_count": 15
            }
        }

class IngredientBulkCreate(BaseModel):
    """대량 식자재 생성 모델"""
    ingredients: List[IngredientCreate] = Field(..., description="생성할 식자재 목록")
    batch_id: Optional[str] = Field(None, description="배치 ID")
    created_by: Optional[str] = Field(None, description="생성자")

    @validator('ingredients')
    def validate_ingredients(cls, v):
        if not v:
            raise ValueError('식자재 목록이 비어있습니다')
        if len(v) > 1000:
            raise ValueError('한 번에 최대 1000개까지 생성 가능합니다')
        return v

class IngredientBulkUpdate(BaseModel):
    """대량 식자재 수정 모델"""
    updates: List[Dict[str, Any]] = Field(..., description="수정할 데이터 목록")
    updated_by: Optional[str] = Field(None, description="수정자")

    @validator('updates')
    def validate_updates(cls, v):
        if not v:
            raise ValueError('수정할 데이터가 비어있습니다')
        if len(v) > 5000:
            raise ValueError('한 번에 최대 5000개까지 수정 가능합니다')

        # 각 업데이트 항목에 id가 있는지 확인
        for update in v:
            if 'id' not in update:
                raise ValueError('각 수정 항목에는 id가 필요합니다')
        return v

# Search and Filter Models
class IngredientSearchFilter(BaseModel):
    """식자재 검색 필터"""
    search_term: Optional[str] = Field(None, description="검색어")
    categories: Optional[List[str]] = Field(None, description="카테고리 목록")
    suppliers: Optional[List[str]] = Field(None, description="협력업체 목록")
    price_min: Optional[float] = Field(None, ge=0, description="최소 가격")
    price_max: Optional[float] = Field(None, ge=0, description="최대 가격")
    has_price: Optional[bool] = Field(None, description="가격 정보 보유 여부")
    is_organic: Optional[bool] = Field(None, description="유기농 여부")
    is_halal: Optional[bool] = Field(None, description="할랄 인증 여부")
    origin_countries: Optional[List[str]] = Field(None, description="원산지 목록")
    shelf_life_min: Optional[int] = Field(None, ge=0, description="최소 유통기한")
    updated_since: Optional[date] = Field(None, description="업데이트 날짜 이후")
    created_since: Optional[date] = Field(None, description="생성 날짜 이후")

class IngredientSort(BaseModel):
    """식자재 정렬 옵션"""
    sort_by: str = Field("ingredient_name", description="정렬 기준")
    sort_order: str = Field("asc", description="정렬 순서 (asc/desc)")

    @validator('sort_by')
    def validate_sort_by(cls, v):
        allowed_fields = [
            'ingredient_name', 'category', 'price_per_unit',
            'supplier_name', 'created_at', 'updated_at',
            'usage_count', 'shelf_life_days'
        ]
        if v not in allowed_fields:
            raise ValueError(f'정렬 기준은 다음 중 하나여야 합니다: {", ".join(allowed_fields)}')
        return v

    @validator('sort_order')
    def validate_sort_order(cls, v):
        if v.lower() not in ['asc', 'desc']:
            raise ValueError('정렬 순서는 asc 또는 desc여야 합니다')
        return v.lower()

class IngredientSearchRequest(BaseModel):
    """식자재 검색 요청"""
    filters: Optional[IngredientSearchFilter] = Field(None, description="검색 필터")
    sort: Optional[IngredientSort] = Field(None, description="정렬 옵션")
    page: int = Field(1, ge=1, description="페이지 번호")
    per_page: int = Field(20, ge=1, le=1000, description="페이지당 항목 수")

class IngredientSearchResponse(BaseModel):
    """식자재 검색 응답"""
    ingredients: List[IngredientResponse] = Field(..., description="검색 결과")
    total_count: int = Field(..., description="전체 결과 수")
    page: int = Field(..., description="현재 페이지")
    per_page: int = Field(..., description="페이지당 항목 수")
    total_pages: int = Field(..., description="전체 페이지 수")
    has_next: bool = Field(..., description="다음 페이지 존재 여부")
    has_prev: bool = Field(..., description="이전 페이지 존재 여부")

    # 추가 정보
    categories: List[Dict[str, Any]] = Field([], description="카테고리별 개수")
    suppliers: List[Dict[str, Any]] = Field([], description="협력업체별 개수")
    price_range: Dict[str, float] = Field({}, description="가격 범위")

# Price and Analysis Models
class IngredientPriceHistory(BaseModel):
    """식자재 가격 이력"""
    ingredient_id: int = Field(..., description="식자재 ID")
    price_per_unit: float = Field(..., ge=0, description="단위당 가격")
    supplier_name: Optional[str] = Field(None, description="협력업체명")
    effective_date: date = Field(..., description="적용 날짜")
    recorded_at: datetime = Field(..., description="기록 일시")
    recorded_by: Optional[str] = Field(None, description="기록자")
    notes: Optional[str] = Field(None, max_length=200, description="비고")

class IngredientPriceUpdate(BaseModel):
    """식자재 가격 업데이트"""
    ingredient_id: int = Field(..., description="식자재 ID")
    new_price: float = Field(..., ge=0, description="새 가격")
    supplier_code: Optional[str] = Field(None, description="협력업체 코드")
    effective_date: Optional[date] = Field(None, description="적용 날짜")
    notes: Optional[str] = Field(None, max_length=200, description="비고")
    updated_by: Optional[str] = Field(None, description="수정자")

class IngredientAnalytics(BaseModel):
    """식자재 분석 데이터"""
    ingredient_id: int = Field(..., description="식자재 ID")
    usage_frequency: int = Field(0, description="사용 빈도")
    average_price: Optional[float] = Field(None, description="평균 가격")
    price_volatility: Optional[float] = Field(None, description="가격 변동성")
    last_used_date: Optional[date] = Field(None, description="마지막 사용 날짜")
    cost_efficiency_score: Optional[float] = Field(None, description="비용 효율성 점수")
    seasonal_trend: Optional[Dict[str, Any]] = Field(None, description="계절성 트렌드")

# Import/Export Models
class IngredientExportRequest(BaseModel):
    """식자재 내보내기 요청"""
    filters: Optional[IngredientSearchFilter] = Field(None, description="내보낼 데이터 필터")
    format_type: str = Field("excel", description="내보내기 형식")
    include_fields: Optional[List[str]] = Field(None, description="포함할 필드 목록")
    filename: Optional[str] = Field(None, description="파일명")

    @validator('format_type')
    def validate_format(cls, v):
        if v not in ['excel', 'csv', 'json']:
            raise ValueError('형식은 excel, csv, json 중 하나여야 합니다')
        return v

class IngredientImportRequest(BaseModel):
    """식자재 가져오기 요청"""
    file_format: str = Field(..., description="파일 형식")
    mapping_config: Optional[Dict[str, str]] = Field(None, description="필드 매핑 설정")
    validation_rules: Optional[Dict[str, Any]] = Field(None, description="검증 규칙")
    batch_size: int = Field(1000, ge=1, le=5000, description="배치 크기")
    skip_duplicates: bool = Field(True, description="중복 건너뛰기")
    update_existing: bool = Field(False, description="기존 데이터 업데이트")

    @validator('file_format')
    def validate_format(cls, v):
        if v not in ['excel', 'csv']:
            raise ValueError('파일 형식은 excel 또는 csv여야 합니다')
        return v

class IngredientImportResult(BaseModel):
    """식자재 가져오기 결과"""
    total_rows: int = Field(..., description="전체 행 수")
    successful_imports: int = Field(..., description="성공한 가져오기 수")
    failed_imports: int = Field(..., description="실패한 가져오기 수")
    skipped_duplicates: int = Field(..., description="건너뛴 중복 수")
    updated_existing: int = Field(..., description="업데이트된 기존 데이터 수")
    errors: List[Dict[str, Any]] = Field([], description="오류 목록")
    warnings: List[Dict[str, Any]] = Field([], description="경고 목록")
    import_id: str = Field(..., description="가져오기 ID")
    processed_at: datetime = Field(..., description="처리 일시")

# Validation and Quality Models
class IngredientValidation(BaseModel):
    """식자재 데이터 검증"""
    ingredient_id: int = Field(..., description="식자재 ID")
    validation_rules: List[str] = Field(..., description="적용된 검증 규칙")
    is_valid: bool = Field(..., description="검증 통과 여부")
    validation_errors: List[str] = Field([], description="검증 오류")
    validation_warnings: List[str] = Field([], description="검증 경고")
    validated_at: datetime = Field(..., description="검증 일시")

class IngredientQualityScore(BaseModel):
    """식자재 데이터 품질 점수"""
    ingredient_id: int = Field(..., description="식자재 ID")
    completeness_score: float = Field(..., ge=0, le=1, description="완성도 점수")
    accuracy_score: float = Field(..., ge=0, le=1, description="정확도 점수")
    consistency_score: float = Field(..., ge=0, le=1, description="일관성 점수")
    timeliness_score: float = Field(..., ge=0, le=1, description="최신성 점수")
    overall_score: float = Field(..., ge=0, le=1, description="전체 품질 점수")
    quality_grade: str = Field(..., description="품질 등급 (A/B/C/D)")
    improvement_suggestions: List[str] = Field([], description="개선 제안")
    calculated_at: datetime = Field(..., description="계산 일시")