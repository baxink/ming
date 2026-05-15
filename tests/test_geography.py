"""
测试 — 地理系统
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.world.geography import load_all_provinces, TWO_CAPITALS_THIRTEEN_PROVINCES, PROVINCE_CAPITALS


def test_province_count():
    provinces = load_all_provinces()
    assert len(provinces) == 15  # 2 京 + 13 省
    print(f"✓ 共 {len(provinces)} 个省级区划")


def test_province_capitals():
    for pid, (name, lat, lng) in PROVINCE_CAPITALS.items():
        assert name, f"{pid} 缺少治所名"
        assert 18 <= lat <= 55, f"{pid} 纬度异常"
        assert 73 <= lng <= 135, f"{pid} 经度异常"
    print("✓ 所有省区治所坐标有效")


def test_province_types():
    provinces = load_all_provinces()
    jing_count = sum(1 for p in provinces.values() if p.tier.value == "jing")
    sheng_count = sum(1 for p in provinces.values() if p.tier.value == "sheng")
    assert jing_count == 2
    assert sheng_count == 13
    print(f"✓ 2 京 + {sheng_count} 省")


if __name__ == "__main__":
    test_province_count()
    test_province_capitals()
    test_province_types()
    print("\n✅ 地理系统全部测试通过")
