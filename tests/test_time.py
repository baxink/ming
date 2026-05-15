"""
测试 — 时间系统
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import datetime, timedelta

from src.world.time import (
    from_gregorian,
    from_real_time,
    elapsed_ming_months,
    MingDate,
    get_reign_title,
    REIGN_PERIODS,
    EPOCH_REAL,
    MONTHS_PER_REAL_DAY,
)


def test_gregorian_to_ming():
    d = from_gregorian(1573)
    assert d.year == 1573
    assert d.reign_title == "万历"
    assert d.reign_year == 1
    print(f"✓ 公历 1573 -> {d}")


def test_reign_titles():
    assert get_reign_title(1368)["title"] == "洪武"
    assert get_reign_title(1522)["title"] == "嘉靖"
    assert get_reign_title(1644)["title"] == "崇祯"
    assert get_reign_title(1367) is None
    assert get_reign_title(1645) is None
    print("✓ 年号映射正确")


def test_advance_months():
    d = from_gregorian(1573, 1, 1)
    d2 = d.advance_months(1)
    assert d2.month == 2
    d12 = d.advance_months(12)
    assert d12.year == 1574
    assert d12.month == 1
    print("✓ 月份推进正确")


def test_real_time_advances_one_quarter_per_day():
    assert MONTHS_PER_REAL_DAY == 3
    assert elapsed_ming_months(EPOCH_REAL + timedelta(days=1)) == 3

    d0 = from_real_time(EPOCH_REAL)
    assert d0.year == 1368
    assert d0.month == 1

    d0_late = from_real_time(EPOCH_REAL + timedelta(hours=23, minutes=59))
    assert d0_late.year == 1368
    assert d0_late.month == 1

    d1 = from_real_time(EPOCH_REAL + timedelta(days=1))
    assert d1.year == 1368
    assert d1.month == 4
    print("✓ 真实时间按 1 自然日 = 1 明朝季度推进")


def test_season_detection():
    d_spring = from_gregorian(1573, 3, 1)
    assert d_spring.season.value == "春"
    d_winter = from_gregorian(1573, 12, 1)
    assert d_winter.season.value == "冬"
    print("✓ 季节判断正确")


def test_tax_season():
    d_tax = from_gregorian(1573, 8, 1)
    assert d_tax.is_tax_season
    d_not = from_gregorian(1573, 3, 1)
    assert not d_not.is_tax_season
    print("✓ 征税季判断正确")


def test_grain_transport_season():
    d = from_gregorian(1573, 6, 1)
    assert d.is_grain_transport_season
    d2 = from_gregorian(1573, 11, 1)
    assert not d2.is_grain_transport_season
    print("✓ 漕运季判断正确")


def test_emperor_data():
    from src.world.time import EMPERORS
    assert len(EMPERORS) == 17
    assert EMPERORS[0]["name"] == "朱元璋"
    assert EMPERORS[-1]["name"] == "朱由检"
    print(f"✓ 皇帝数据完整 ({len(EMPERORS)} 位)")


if __name__ == "__main__":
    test_gregorian_to_ming()
    test_reign_titles()
    test_advance_months()
    test_real_time_advances_one_quarter_per_day()
    test_season_detection()
    test_tax_season()
    test_grain_transport_season()
    test_emperor_data()
    print("\n✅ 时间系统全部测试通过")
