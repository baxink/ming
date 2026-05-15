"""
明代行政地理系统

负责：
- 京师、省、府、州、县多级行政结构
- 驿路、漕运、河道、边镇通路
- 距离和运输时间
- 不同地区税赋、产出、人口密度差异
"""
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class RegionTier(Enum):
    JING = "jing"       # 京师
    SHENG = "sheng"     # 省
    FU = "fu"           # 府
    ZHOU = "zhou"       # 州
    XIAN = "xian"       # 县


class RoadType(Enum):
    OFFICIAL = "official_road"
    POSTAL = "postal_road"
    CANAL = "canal"
    SEA = "sea_route"
    MOUNTAIN = "mountain_pass"

    @property
    def speed_km_per_day(self) -> float:
        speeds = {
            RoadType.OFFICIAL: 50,
            RoadType.POSTAL: 80,
            RoadType.CANAL: 40,
            RoadType.SEA: 120,
            RoadType.MOUNTAIN: 25,
        }
        return speeds[self.value]


@dataclass
class Region:
    id: str
    name: str
    full_name: str
    tier: RegionTier
    parent_id: Optional[str]
    sub_region_ids: list[str] = field(default_factory=list)
    capital: str = ""
    latitude: float = 0.0
    longitude: float = 0.0
    population_households: int = 0
    population_adult_males: int = 0
    total_population: int = 0
    tax_quota_grain_dan: float = 0.0
    tax_quota_silver_tael: float = 0.0
    climate_zone: str = ""
    notable_features: list[str] = field(default_factory=list)

    @property
    def is_coastal(self) -> bool:
        return self.climate_zone in ("yangtze_delta", "southeast_coastal")

    @property
    def is_frontier(self) -> bool:
        return self.climate_zone in ("northwest_arid", "southwest_mountain")


@dataclass
class Route:
    from_region_id: str
    to_region_id: str
    road_type: RoadType
    distance_km: float

    @property
    def travel_days(self) -> int:
        return max(1, int(self.distance_km / self.road_type.speed_km_per_day))


TWO_CAPITALS_THIRTEEN_PROVINCES = [
    {"id": "jing_bei", "name": "北直隶", "tier": RegionTier.JING, "parent": None},
    {"id": "jing_nan", "name": "南直隶", "tier": RegionTier.JING, "parent": None},
    {"id": "sheng_zhejiang", "name": "浙江", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_jiangxi", "name": "江西", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_huguang", "name": "湖广", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_fujian", "name": "福建", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_guangdong", "name": "广东", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_guangxi", "name": "广西", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_guizhou", "name": "贵州", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_yunnan", "name": "云南", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_sichuan", "name": "四川", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_shandong", "name": "山东", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_henan", "name": "河南", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_shanxi", "name": "山西", "tier": RegionTier.SHENG, "parent": None},
    {"id": "sheng_shaanxi", "name": "陕西", "tier": RegionTier.SHENG, "parent": None},
]

PROVINCE_CAPITALS = {
    "jing_bei": ("北京", 39.9, 116.4),
    "jing_nan": ("南京", 32.06, 118.79),
    "sheng_zhejiang": ("杭州", 30.25, 120.16),
    "sheng_jiangxi": ("南昌", 28.68, 115.89),
    "sheng_huguang": ("武昌", 30.57, 114.30),
    "sheng_fujian": ("福州", 26.07, 119.30),
    "sheng_guangdong": ("广州", 23.13, 113.26),
    "sheng_guangxi": ("桂林", 25.27, 110.28),
    "sheng_guizhou": ("贵阳", 26.65, 106.63),
    "sheng_yunnan": ("昆明", 25.04, 102.68),
    "sheng_sichuan": ("成都", 30.67, 104.06),
    "sheng_shandong": ("济南", 36.67, 117.00),
    "sheng_henan": ("开封", 34.79, 114.31),
    "sheng_shanxi": ("太原", 37.87, 112.55),
    "sheng_shaanxi": ("西安", 34.34, 108.94),
}


def make_province_region(prov_dict: dict) -> Region:
    cap = PROVINCE_CAPITALS.get(prov_dict["id"], ("", 0, 0))
    return Region(
        id=prov_dict["id"],
        name=prov_dict["name"],
        full_name=f"{prov_dict['name']}等处承宣布政使司" if prov_dict["tier"] == RegionTier.SHENG else prov_dict["name"],
        tier=prov_dict["tier"],
        parent_id=prov_dict.get("parent"),
        capital=cap[0],
        latitude=cap[1],
        longitude=cap[2],
    )


def load_all_provinces() -> dict[str, Region]:
    return {p["id"]: make_province_region(p) for p in TWO_CAPITALS_THIRTEEN_PROVINCES}
