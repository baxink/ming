"""
明代经济系统

负责：
- 田赋、徭役、商税、盐税、矿税
- 折色与白银化
- 国库与地方库分层
- 仓储与运输损耗
"""
from dataclasses import dataclass, field
from enum import Enum


class TaxType(Enum):
    TIAN_FU = "田赋"
    YAO_YI = "徭役"
    SHANG_SHUI = "商税"
    YAN_SHUI = "盐税"
    KUANG_SHUI = "矿税"


@dataclass
class TaxQuota:
    region_id: str
    tax_type: TaxType
    grain_dan: float = 0.0
    silver_tael: float = 0.0
    is_commuted: bool = False  # 是否已折银


@dataclass
class Granary:
    id: str
    name: str
    region_id: str
    grain_stored_dan: float = 0.0
    silver_stored_tael: float = 0.0
    capacity_grain_dan: float = 10000.0
    annual_wastage_rate: float = 0.02  # 损耗率


@dataclass
class FiscalState:
    central_treasury_silver: float = 0.0
    central_granary_grain_dan: float = 0.0
    annual_revenue_silver: float = 0.0
    annual_revenue_grain_dan: float = 0.0
    annual_expenditure_silver: float = 0.0
    annual_expenditure_grain_dan: float = 0.0

    @property
    def balance_silver(self) -> float:
        return self.annual_revenue_silver - self.annual_expenditure_silver

    @property
    def balance_grain(self) -> float:
        return self.annual_revenue_grain_dan - self.annual_expenditure_grain_dan

    @property
    def is_deficit(self) -> bool:
        return self.balance_silver < 0 or self.balance_grain < 0


DEFAULT_TAX_RATES = {
    TaxType.TIAN_FU: {"grain_per_mu": 0.03, "silver_per_mu": 0.0},
    TaxType.YAO_YI: {"silver_per_male": 0.5},
    TaxType.SHANG_SHUI: {"rate": 0.03},
    TaxType.YAN_SHUI: {"silver_per_yin": 4.0},
}
