"""
Menu Name Normalization Utility
메뉴명 정규화 중앙 유틸리티

메뉴명 구조:
    [접두사]-[레시피명]-[접미사]
    예: 본사-현미밥-요, 영남-김치찌개-운, 백미밥-도, 닭볶음탕

canonical_name = recipe_name + '-' + suffix (접두사 제외)
    예: 현미밥-요, 김치찌개-운, 백미밥-도, 닭볶음탕

base_name = recipe_name만 (접두사/접미사 모두 제외)
    예: 현미밥, 김치찌개, 백미밥, 닭볶음탕
"""

# 알려진 사이트 접두사 (site_groups 기반)
SITE_PREFIXES = ('본사-', '영남-', '위탁-')

# 알려진 suffix 약어 (recipe_categories.abbreviation 기반)
KNOWN_SUFFIXES = {'도', '운', '학', '요', '유', '초', '중', '고', '유,도'}

# 식단표 카테고리 → recipe_categories.name 매핑
# recipe_categories DB: 도시락, 운반, 학교, 요양원, 유치원, 초등학교, 중학교, 고등학교
CATEGORY_NAME_MAP = {
    '도시락': '도시락',
    '운반': '운반',
    '학교': '학교',
    '요양원': '요양원',
    '유치원': '유치원',
    '초등학교': '초등학교',
    '중학교': '중학교',
    '고등학교': '고등학교',
}


def strip_site_prefix(menu_name: str) -> str:
    """사이트 접두사 제거 (본사-, 영남- 등)"""
    if not menu_name:
        return ''
    for prefix in SITE_PREFIXES:
        if menu_name.startswith(prefix):
            return menu_name[len(prefix):]
    # 대괄호 접두사 제거 ([행사], [국내] 등)
    if menu_name.startswith('[') and ']' in menu_name:
        return menu_name[menu_name.index(']') + 1:].strip()
    return menu_name


def get_base_name(menu_name: str) -> str:
    """
    base_name 추출 (접두사 + 접미사 모두 제거)
    예: '본사-현미밥-요' → '현미밥', '김치찌개-운' → '김치찌개', '백미밥' → '백미밥'
    """
    if not menu_name:
        return ''
    name = strip_site_prefix(menu_name).strip()
    # suffix 제거: 마지막 '-X' 에서 X가 알려진 suffix인 경우만 제거
    if '-' in name:
        parts = name.rsplit('-', 1)
        if len(parts) == 2 and parts[1].strip() in KNOWN_SUFFIXES:
            return parts[0].strip()
    return name.strip()


def get_canonical_name(menu_name: str) -> str:
    """
    canonical_name 생성 (접두사만 제거, 접미사 유지)
    예: '본사-현미밥-요' → '현미밥-요', '영남-김치찌개-운' → '김치찌개-운', '백미밥' → '백미밥'
    """
    if not menu_name:
        return ''
    return strip_site_prefix(menu_name).strip()


def build_canonical_from_recipe(recipe_name: str, suffix: str = '') -> str:
    """
    recipe_name + suffix로 canonical_name 구성
    예: ('현미밥', '요') → '현미밥-요', ('백미밥', '') → '백미밥'
    """
    name = (recipe_name or '').strip()
    sfx = (suffix or '').strip()
    if sfx:
        return f"{name}-{sfx}"
    return name


def get_cooking_yield(cooking_yields: dict, menu_name: str, ingredient_id: int) -> float:
    """
    cooking_yields 조회 (fallback 체인 포함)
    1순위: 원본 menu_name (suffix 포함, 예: '현미밥-요')
    2순위: canonical_name (접두사 제거)
    3순위: base_name (접미사도 제거, 예: '현미밥')
    4순위: 기본값 100.0
    """
    if not cooking_yields or not menu_name:
        return 100.0

    # 1순위: 원본 그대로
    result = cooking_yields.get((menu_name, ingredient_id))
    if result is not None:
        return result

    # 2순위: 접두사 제거
    canonical = get_canonical_name(menu_name)
    if canonical != menu_name:
        result = cooking_yields.get((canonical, ingredient_id))
        if result is not None:
            return result

    # 3순위: base_name (접미사도 제거)
    base = get_base_name(menu_name)
    if base != canonical:
        result = cooking_yields.get((base, ingredient_id))
        if result is not None:
            return result

    return 100.0
