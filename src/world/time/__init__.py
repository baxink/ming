"""
明代时间系统

负责：
- 年号与公历换算
- 月、季、年推进
- 特殊事件按日处理
- 农时、漕运季、征税季、会试秋审等制度周期
- 真实时间到明朝月份的映射（纪元: 2026-05-15，每天=2个月）
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from datetime import datetime, timezone, timedelta


class Season(Enum):
    SPRING = "春"
    SUMMER = "夏"
    AUTUMN = "秋"
    WINTER = "冬"


@dataclass
class MingDate:
    """明代日期"""
    year: int
    month: int           # 1-12, 13=闰月
    day: int              # 1-30
    reign_title: str      # 年号
    reign_year: int       # 年号纪年

    def __repr__(self):
        return f"{self.reign_title}{self.reign_year}年{self.month}月{self.day}日 (公元{self.year})"

    def to_dict(self):
        return {
            "year": self.year, "month": self.month, "day": self.day,
            "reign_title": self.reign_title, "reign_year": self.reign_year
        }

    @property
    def season(self) -> Season:
        if self.month <= 3:
            return Season.SPRING
        elif self.month <= 6:
            return Season.SUMMER
        elif self.month <= 9:
            return Season.AUTUMN
        else:
            return Season.WINTER

    @property
    def is_harvest_season(self) -> bool:
        """秋收季节 (农历7-9月)"""
        return 7 <= self.month <= 9

    @property
    def is_tax_season(self) -> bool:
        """秋粮征收季 (农历8-10月)"""
        return 8 <= self.month <= 10

    @property
    def is_grain_transport_season(self) -> bool:
        """漕运季 (春末至秋初)"""
        return 4 <= self.month <= 9

    @property
    def is_examination_season(self) -> bool:
        """科举季 (乡试秋八月、会试春二月)"""
        return self.month in (2, 8)

    @property
    def is_autumn_assizes(self) -> bool:
        """秋审季 (农历八月)"""
        return self.month == 8

    def advance_days(self, days: int) -> "MingDate":
        new_day = self.day + days
        new_month = self.month
        new_year = self.year
        days_per_month = 30
        while new_day > days_per_month:
            new_day -= days_per_month
            new_month += 1
            if new_month > 12:
                new_month = 1
                new_year += 1
        return MingDate(
            year=new_year, month=new_month, day=new_day,
            reign_title=self.reign_title,
            reign_year=self.reign_year + (1 if new_year > self.year else 0)
        )

    def advance_months(self, months: int) -> "MingDate":
        new_month = self.month + months
        new_year = self.year + (new_month - 1) // 12
        new_month = ((new_month - 1) % 12) + 1
        return MingDate(
            year=new_year, month=new_month, day=min(self.day, 30),
            reign_title=self.reign_title,
            reign_year=self.reign_year + (new_year - self.year)
        )


REIGN_PERIODS = [
    {"title": "洪武", "start": 1368, "end": 1398, "emperor": "朱元璋"},
    {"title": "建文", "start": 1399, "end": 1402, "emperor": "朱允炆"},
    {"title": "永乐", "start": 1403, "end": 1424, "emperor": "朱棣"},
    {"title": "洪熙", "start": 1425, "end": 1425, "emperor": "朱高炽"},
    {"title": "宣德", "start": 1426, "end": 1435, "emperor": "朱瞻基"},
    {"title": "正统", "start": 1436, "end": 1449, "emperor": "朱祁镇"},
    {"title": "景泰", "start": 1450, "end": 1457, "emperor": "朱祁钰"},
    {"title": "天顺", "start": 1457, "end": 1464, "emperor": "朱祁镇"},
    {"title": "成化", "start": 1465, "end": 1487, "emperor": "朱见深"},
    {"title": "弘治", "start": 1488, "end": 1505, "emperor": "朱祐樘"},
    {"title": "正德", "start": 1506, "end": 1521, "emperor": "朱厚照"},
    {"title": "嘉靖", "start": 1522, "end": 1566, "emperor": "朱厚熜"},
    {"title": "隆庆", "start": 1567, "end": 1572, "emperor": "朱载坖"},
    {"title": "万历", "start": 1573, "end": 1620, "emperor": "朱翊钧"},
    {"title": "泰昌", "start": 1620, "end": 1620, "emperor": "朱常洛"},
    {"title": "天启", "start": 1621, "end": 1627, "emperor": "朱由校"},
    {"title": "崇祯", "start": 1628, "end": 1644, "emperor": "朱由检"},
]


def get_reign_title(year: int) -> Optional[dict]:
    for r in REIGN_PERIODS:
        if r["start"] <= year <= r["end"]:
            return r
    return None


def from_gregorian(year: int, month: int = 1, day: int = 1) -> MingDate:
    r = get_reign_title(year)
    if r is None:
        raise ValueError(f"公元 {year} 不在明朝时间范围 (1368-1644)")
    reign_year = year - r["start"] + 1
    return MingDate(year=year, month=month, day=day, reign_title=r["title"], reign_year=reign_year)


EMPERORS = [
    {"name": "朱元璋", "temple": "太祖", "birth": 1328, "death": 1398, "reign_start": 1368, "reign_end": 1398},
    {"name": "朱允炆", "temple": "惠宗", "birth": 1377, "death": None, "reign_start": 1398, "reign_end": 1402},
    {"name": "朱棣", "temple": "太宗/成祖", "birth": 1360, "death": 1424, "reign_start": 1402, "reign_end": 1424},
    {"name": "朱高炽", "temple": "仁宗", "birth": 1378, "death": 1425, "reign_start": 1424, "reign_end": 1425},
    {"name": "朱瞻基", "temple": "宣宗", "birth": 1399, "death": 1435, "reign_start": 1425, "reign_end": 1435},
    {"name": "朱祁镇", "temple": "英宗", "birth": 1427, "death": 1464, "reign_start": 1435, "reign_end": 1449},
    {"name": "朱祁钰", "temple": "代宗", "birth": 1428, "death": 1457, "reign_start": 1449, "reign_end": 1457},
    {"name": "朱祁镇", "temple": "英宗", "birth": 1427, "death": 1464, "reign_start": 1457, "reign_end": 1464, "restoration": True},
    {"name": "朱见深", "temple": "宪宗", "birth": 1447, "death": 1487, "reign_start": 1464, "reign_end": 1487},
    {"name": "朱祐樘", "temple": "孝宗", "birth": 1470, "death": 1505, "reign_start": 1487, "reign_end": 1505},
    {"name": "朱厚照", "temple": "武宗", "birth": 1491, "death": 1521, "reign_start": 1505, "reign_end": 1521},
    {"name": "朱厚熜", "temple": "世宗", "birth": 1507, "death": 1567, "reign_start": 1521, "reign_end": 1567},
    {"name": "朱载坖", "temple": "穆宗", "birth": 1537, "death": 1572, "reign_start": 1567, "reign_end": 1572},
    {"name": "朱翊钧", "temple": "神宗", "birth": 1563, "death": 1620, "reign_start": 1572, "reign_end": 1620},
    {"name": "朱常洛", "temple": "光宗", "birth": 1582, "death": 1620, "reign_start": 1620, "reign_end": 1620},
    {"name": "朱由校", "temple": "熹宗", "birth": 1605, "death": 1627, "reign_start": 1620, "reign_end": 1627},
    {"name": "朱由检", "temple": "思宗", "birth": 1611, "death": 1644, "reign_start": 1627, "reign_end": 1644},
]

# === 真实时间 → 明朝时间映射 ===
# 纪元: 2026-05-15 00:00 CST = 洪武元年正月
# 速率: 1 真实日 = 2 模拟月（即 6 真实日 = 1 模拟年）

EPOCH_REAL = datetime(2026, 5, 15, 0, 0, 0, tzinfo=timezone(timedelta(hours=8)))
EPOCH_MING_YEAR = 1368
EPOCH_MING_MONTH = 1
MING_END_YEAR = 1644
MING_END_MONTH = 4     # 崇祯十七年三月 ≈ 1644年4月
TIMEZONE_CST = timezone(timedelta(hours=8))

# 1 真实日 = 2 模拟月
MONTHS_PER_REAL_DAY = 2
# 完整明朝跨度: 276 年 = 3312 个月 → 1656 真实日
TOTAL_MING_MONTHS = (MING_END_YEAR - EPOCH_MING_YEAR) * 12 + MING_END_MONTH - EPOCH_MING_MONTH


def real_time_now() -> datetime:
    return datetime.now(TIMEZONE_CST)


def elapsed_ming_months(now: datetime = None) -> float:
    if now is None:
        now = real_time_now()
    delta_seconds = (now - EPOCH_REAL).total_seconds()
    if delta_seconds < 0:
        return 0.0
    return (delta_seconds / 86400.0) * MONTHS_PER_REAL_DAY


def elapsed_days_since_epoch(now: datetime = None) -> int:
    if now is None:
        now = real_time_now()
    delta = now - EPOCH_REAL
    return max(0, delta.days)


def ming_year_from_elapsed_months(months: float) -> int:
    return EPOCH_MING_YEAR + int(months) // 12


def current_ming_year() -> int:
    return ming_year_from_elapsed_months(elapsed_ming_months())


def from_real_time(now: datetime = None) -> MingDate:
    if now is None:
        now = real_time_now()
    months = elapsed_ming_months(now)
    total_months = int(months)
    year = EPOCH_MING_YEAR + total_months // 12
    month = EPOCH_MING_MONTH + total_months % 12

    if month > 12:
        year += 1
        month -= 12

    if year > MING_END_YEAR:
        year = MING_END_YEAR
        month = min(month, MING_END_MONTH)
    if year == MING_END_YEAR and month > MING_END_MONTH:
        month = MING_END_MONTH

    day = min(now.day, 30)
    return from_gregorian(year, month, day)


def current_ming_month() -> int:
    months = elapsed_ming_months()
    return EPOCH_MING_MONTH + int(months) % 12


def real_time_status() -> dict:
    now = real_time_now()
    months = elapsed_ming_months(now)
    year = ming_year_from_elapsed_months(months)
    ming = from_real_time(now) if year <= MING_END_YEAR else None
    months_remaining = max(0.0, TOTAL_MING_MONTHS - months)
    days_remaining = months_remaining / MONTHS_PER_REAL_DAY
    return {
        "real_time": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "epoch": EPOCH_REAL.strftime("%Y-%m-%d"),
        "elapsed_real_days": elapsed_days_since_epoch(now),
        "elapsed_ming_months": round(months, 2),
        "ming_year": year,
        "ming_date": repr(ming) if ming else "明朝已亡",
        "is_ming_period": year <= MING_END_YEAR and months <= TOTAL_MING_MONTHS,
        "real_days_remaining": round(days_remaining, 1),
        "ming_years_remaining": round(months_remaining / 12, 1),
    }

