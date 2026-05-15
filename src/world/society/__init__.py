"""
明代社会系统

负责：
- 百姓负担与逃亡
- 士绅包揽与抗税
- 商帮与市场波动
- 民变、盗匪、宗族械斗
- 舆论与清议
"""
from dataclasses import dataclass, field


@dataclass
class PublicSentiment:
    region_id: str
    overall_mood: float = 0.5       # 0=绝望 -> 1=满意
    tax_burden_complaint: float = 0.5 # 税负怨气 0-1
    trust_in_local_official: float = 0.5
    trust_in_central_gov: float = 0.5
    risk_of_unrest: float = 0.0    # 民变风险 0-1
    gentry_influence: float = 0.5   # 士绅势力 0-1
    merchant_activity: float = 0.5  # 商业活跃度 0-1

    def update(self, tax_burden_delta: float, harvest_quality: float, disaster_impact: float):
        self.tax_burden_complaint = min(1.0, max(0.0, self.tax_burden_complaint + tax_burden_delta))
        self.overall_mood = (
            0.3 * (1 - self.tax_burden_complaint)
            + 0.3 * harvest_quality
            + 0.2 * self.trust_in_local_official
            + 0.2 * (1 - disaster_impact)
        )
        self.risk_of_unrest = (1 - self.overall_mood) * 0.8 + self.tax_burden_complaint * 0.2
        self.risk_of_unrest = min(1.0, max(0.0, self.risk_of_unrest))


@dataclass
class EliteOpinion:
    """清议 / 士林舆论"""
    faction_id: str
    stance_on_emperor: float = 0.5    # 对皇帝满意度
    stance_on_cabinet: float = 0.5    # 对内阁态度
    policy_opinions: dict[str, float] = field(default_factory=dict)  # policy_id -> approval
    recently_voiced_concerns: list[str] = field(default_factory=list)
