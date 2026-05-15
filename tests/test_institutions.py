"""
测试 — 制度系统
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.world.institutions import load_central_offices, CENTRAL_OFFICES


def test_offices_count():
    offices = load_central_offices()
    assert len(offices) >= 10
    print(f"✓ 共 {len(offices)} 个中央机构")


def test_key_offices():
    offices = load_central_offices()
    assert "neige" in offices
    assert "libu" in offices
    assert "hubu" in offices
    assert "bingbu" in offices
    assert "duchayuan" in offices
    assert "sili_jian" in offices
    print("✓ 内阁、六部、都察院、司礼监均已定义")


def test_libu_permissions():
    offices = load_central_offices()
    libu = offices["libu"]
    assert libu.can_appoint
    assert not libu.can_command_troops
    print("✓ 吏部权限正确")


def test_bingbu_permissions():
    offices = load_central_offices()
    bingbu = offices["bingbu"]
    assert bingbu.can_command_troops
    assert not bingbu.can_levy_tax
    print("✓ 兵部权限正确")


if __name__ == "__main__":
    test_offices_count()
    test_key_offices()
    test_libu_permissions()
    test_bingbu_permissions()
    print("\n✅ 制度系统全部测试通过")
