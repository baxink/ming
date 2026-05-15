"""
明代制度系统

负责：
- 中央与地方官制
- 品级、员额、职责
- 任免、考课、巡按、督抚制度
- 宦官机构、厂卫体系
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class OfficeRank(Enum):
    ZHENG1 = "正一品"
    CONG1 = "从一品"
    ZHENG2 = "正二品"
    CONG2 = "从二品"
    ZHENG3 = "正三品"
    CONG3 = "从三品"
    ZHENG4 = "正四品"
    CONG4 = "从四品"
    ZHENG5 = "正五品"
    CONG5 = "从五品"
    ZHENG6 = "正六品"
    CONG6 = "从六品"
    ZHENG7 = "正七品"
    CONG7 = "从七品"
    ZHENG8 = "正八品"
    CONG8 = "从八品"
    ZHENG9 = "正九品"
    CONG9 = "从九品"
    UNRANKED = "未入流"


class OfficeType(Enum):
    CENTRAL_CABINET = "central_cabinet"
    CENTRAL_SIX_MINISTRIES = "central_six_ministries"
    CENTRAL_CENSORATE = "central_censorate"
    CENTRAL_HANLIN = "central_hanlin"
    CENTRAL_IMPERIAL_GUARDS = "central_imperial_guards"
    CENTRAL_EUNUCH = "central_eunuch"
    PROVINCIAL = "provincial"
    PREFECTURAL = "prefectural"
    COUNTY = "county"
    MILITARY_WEI = "military_wei"
    MILITARY_BORDER = "military_border"


@dataclass
class Office:
    id: str
    name: str
    full_name: str
    office_type: OfficeType
    rank: OfficeRank
    quota: int = 1
    parent_office_id: Optional[str] = None
    sub_office_ids: list[str] = field(default_factory=list)
    responsibilities: list[str] = field(default_factory=list)
    can_issue_policy: bool = False
    can_appoint: bool = False
    can_impeach: bool = False
    can_command_troops: bool = False
    can_levy_tax: bool = False
    can_adjudicate: bool = False
    can_memorialize: bool = True
    can_approve_execution: bool = False
    jurisdiction_region_ids: list[str] = field(default_factory=list)

    @property
    def is_central(self) -> bool:
        return self.office_type.value.startswith("central_")

    @property
    def is_local(self) -> bool:
        return self.office_type in (OfficeType.PROVINCIAL, OfficeType.PREFECTURAL, OfficeType.COUNTY)


CENTRAL_OFFICES = [
    {
        "id": "neige",
        "name": "内阁",
        "office_type": OfficeType.CENTRAL_CABINET,
        "rank": OfficeRank.ZHENG5,
        "quota": 7,
        "responsibilities": ["票拟", "参决大政"],
        "can_issue_policy": True,
        "can_memorialize": True,
    },
    {
        "id": "libu",
        "name": "吏部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["人事任免", "考课", "铨选", "封爵"],
        "can_appoint": True,
        "can_memorialize": True,
    },
    {
        "id": "hubu",
        "name": "户部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["赋税征收", "仓储管理", "漕运", "盐政", "钱法"],
        "can_levy_tax": True,
        "can_memorialize": True,
    },
    {
        "id": "libu2",
        "name": "礼部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["科举", "学校", "祭祀", "朝贡", "礼制"],
        "can_memorialize": True,
    },
    {
        "id": "bingbu",
        "name": "兵部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["军务", "边镇", "武选", "军器", "驿传"],
        "can_command_troops": True,
        "can_memorialize": True,
    },
    {
        "id": "xingbu",
        "name": "刑部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["刑名", "狱讼", "秋审", "朝审"],
        "can_adjudicate": True,
        "can_memorialize": True,
    },
    {
        "id": "gongbu",
        "name": "工部",
        "office_type": OfficeType.CENTRAL_SIX_MINISTRIES,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["营造", "河工", "屯田", "虞衡"],
        "can_memorialize": True,
    },
    {
        "id": "duchayuan",
        "name": "都察院",
        "office_type": OfficeType.CENTRAL_CENSORATE,
        "rank": OfficeRank.ZHENG2,
        "responsibilities": ["谏诤", "封驳", "弹劾", "巡按"],
        "can_impeach": True,
        "can_memorialize": True,
    },
    {
        "id": "hanlinyuan",
        "name": "翰林院",
        "office_type": OfficeType.CENTRAL_HANLIN,
        "rank": OfficeRank.ZHENG5,
        "responsibilities": ["制诰", "史馆", "经筵", "侍读"],
        "can_memorialize": True,
    },
    {
        "id": "sili_jian",
        "name": "司礼监",
        "office_type": OfficeType.CENTRAL_EUNUCH,
        "rank": OfficeRank.ZHENG4,
        "responsibilities": ["批红", "传旨", "掌印"],
        "can_issue_policy": True,
        "can_approve_execution": True,
    },
    {
        "id": "jinyiwei",
        "name": "锦衣卫",
        "office_type": OfficeType.CENTRAL_IMPERIAL_GUARDS,
        "rank": OfficeRank.ZHENG3,
        "responsibilities": ["刑侦", "缉捕", "诏狱"],
        "can_adjudicate": True,
    },
    {
        "id": "dongchang",
        "name": "东厂",
        "office_type": OfficeType.CENTRAL_IMPERIAL_GUARDS,
        "rank": OfficeRank.ZHENG4,
        "responsibilities": ["刑侦", "缉捕", "情报"],
    },
]


def load_central_offices() -> dict[str, Office]:
    result = {}
    for data in CENTRAL_OFFICES:
        o = Office(
            id=data["id"],
            name=data["name"],
            full_name=data["name"],
            office_type=data["office_type"],
            rank=data["rank"],
            quota=data.get("quota", 1),
            responsibilities=data.get("responsibilities", []),
            can_issue_policy=data.get("can_issue_policy", False),
            can_appoint=data.get("can_appoint", False),
            can_impeach=data.get("can_impeach", False),
            can_command_troops=data.get("can_command_troops", False),
            can_levy_tax=data.get("can_levy_tax", False),
            can_adjudicate=data.get("can_adjudicate", False),
            can_memorialize=data.get("can_memorialize", True),
            can_approve_execution=data.get("can_approve_execution", False),
        )
        result[o.id] = o
    return result
