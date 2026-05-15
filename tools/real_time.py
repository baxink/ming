#!/usr/bin/env python3
"""
明朝模拟器 — 真实时间映射检查

纪元:  2026年5月13日 00:00 CST = 明朝洪武元年正月
速率:  1 真实日 = 2 模拟月（6 真实日 = 1 年）
范围:  1368-1644，共 276 年 → 1656 真实日
"""
import sys
sys.path.insert(0, '/Users/fanxiaojun/Desktop/Design/明朝')

from src.world.time import (
    real_time_status, current_ming_year, current_ming_month,
    real_time_now, from_real_time, elapsed_ming_months,
    EPOCH_REAL, MING_END_YEAR, MING_END_MONTH,
    MONTHS_PER_REAL_DAY, TOTAL_MING_MONTHS,
)
from datetime import timedelta


def main():
    status = real_time_status()

    print("═══════════════════════════════════════════")
    print("  明朝模拟器 — 真实时间 → 明朝时间")
    print("═══════════════════════════════════════════")
    print(f"  当前真实时间:   {status['real_time']}")
    print(f"  纪元起点:       {EPOCH_REAL.strftime('%Y-%m-%d %H:%M')}")
    print(f"  时间速率:       1 真实日 = {MONTHS_PER_REAL_DAY} 模拟月")
    print(f"  ─────────────────────────────────────")
    print(f"  已过真实天数:   {status['elapsed_real_days']} 天")
    print(f"  已过模拟月数:   {status['elapsed_ming_months']} 月")
    print(f"  对应明朝时间:   {status['ming_date']}")
    print(f"  在明朝范围内:   {'是' if status['is_ming_period'] else '否'}")
    print(f"  ─────────────────────────────────────")
    print(f"  剩余真实天数:   {status['real_days_remaining']} 天")
    print(f"  剩余模拟年数:   {status['ming_years_remaining']} 年")

    if not status['is_ming_period']:
        print(f"\n  ⚠ 当前已超出明朝范围 (1368-{MING_END_YEAR})")
    else:
        remaining = status['real_days_remaining']
        real_end = real_time_now() + timedelta(days=remaining)
        print(f"  明朝灭亡 (1644) 预计: {real_end.strftime('%Y-%m-%d')}")

    print(f"\n  时间推进推算:")
    print(f"    1 小时后   → 模拟 +{MONTHS_PER_REAL_DAY / 24:.1f} 月")
    print(f"    12 小时后  → 模拟 +1 月")
    print(f"    1 天后     → 模拟 +2 月")
    print(f"    3 天后     → 模拟 +6 月（半年）")
    print(f"    6 天后     → 模拟 +1 年")


if __name__ == "__main__":
    main()
