"""
明代军事系统

负责：
- 卫所与募兵并行
- 边镇兵力状态
- 军费与粮饷
- 军纪、缺额
"""
from dataclasses import dataclass, field
from enum import Enum


class UnitType(Enum):
    WEI = "卫"
    SUO = "所"
    BORDER_GARRISON = "边镇"
    CONSCRIPT = "募兵"
    MILITIA = "民壮"


@dataclass
class MilitaryUnit:
    id: str
    name: str
    unit_type: UnitType
    region_id: str
    nominal_strength: int = 5600
    actual_strength: int = 5600
    morale: float = 0.5        # 0-1
    training_level: float = 0.5  # 0-1
    equipment_quality: float = 0.5  # 0-1
    monthly_cost_silver: float = 0.0
    monthly_cost_grain_dan: float = 0.0

    @property
    def deficit_ratio(self) -> float:
        return 1.0 - (self.actual_strength / max(1, self.nominal_strength))

    @property
    def combat_effectiveness(self) -> float:
        return (
            (self.actual_strength / self.nominal_strength) * 0.4
            + self.morale * 0.2
            + self.training_level * 0.2
            + self.equipment_quality * 0.2
        )


NINE_BORDER_GARRISONS = [
    {"id": "border_liaodong", "name": "辽东镇", "region": "sheng_shandong"},
    {"id": "border_ji", "name": "蓟州镇", "region": "jing_bei"},
    {"id": "border_xuanfu", "name": "宣府镇", "region": "jing_bei"},
    {"id": "border_datong", "name": "大同镇", "region": "sheng_shanxi"},
    {"id": "border_shanxi", "name": "山西镇", "region": "sheng_shanxi"},
    {"id": "border_yansui", "name": "延绥镇", "region": "sheng_shaanxi"},
    {"id": "border_ningxia", "name": "宁夏镇", "region": "sheng_shaanxi"},
    {"id": "border_guyuan", "name": "固原镇", "region": "sheng_shaanxi"},
    {"id": "border_gansu", "name": "甘肃镇", "region": "sheng_shaanxi"},
]


EXTERNAL_THREATS = [
    {"id": "threat_mongol", "name": "蒙古诸部", "region": "north", "active_period": (1368, 1644)},
    {"id": "threat_wokou", "name": "倭寇", "region": "southeast_coastal", "active_period": (1522, 1566)},
    {"id": "threat_jianzhou", "name": "建州女真", "region": "liaodong", "active_period": (1583, 1644)},
]
