"""
明代地理查询 — 府州县区划

从 data/raw/地图地理/ming_places.sqlite3 查询。
数据库由 CBDB 自动提取，含 373 府 + 619 州 + 2566 县。
"""
from typing import Optional
from src.data.db_manager import get_db

DB_NAME = "地图地理"


def _query(sql: str, params: tuple = ()) -> list[dict]:
    return get_db().query(DB_NAME, sql, params)


def _query_one(sql: str, params: tuple = ()) -> Optional[dict]:
    return get_db().query_one(DB_NAME, sql, params)


def _query_value(sql: str, params: tuple = ()):
    return get_db().query_value(DB_NAME, sql, params)


def search_place(name: str, limit: int = 10) -> list[dict]:
    return _query("SELECT * FROM places WHERE name LIKE ? LIMIT ?", (f"%{name}%", limit))


def get_place(place_id: int) -> Optional[dict]:
    return _query_one("SELECT * FROM places WHERE id = ?", (place_id,))


def get_prefectures(province: str = "") -> list[dict]:
    if province:
        return _query("SELECT * FROM places WHERE tier='fu' AND province LIKE ? ORDER BY name", (f"%{province}%",))
    return _query("SELECT * FROM places WHERE tier='fu' ORDER BY province, name")


def get_subordinates(parent_id: int) -> list[dict]:
    return _query("SELECT * FROM places WHERE parent_id = ? ORDER BY tier, name", (parent_id,))


def get_by_province(province: str) -> list[dict]:
    return _query("SELECT * FROM places WHERE province LIKE ? ORDER BY tier, level, name", (f"%{province}%",))


def get_provinces() -> list[str]:
    rows = _query("SELECT DISTINCT province FROM places WHERE province != '' ORDER BY province")
    return [r['province'] for r in rows]


def get_by_tier(tier: str) -> list[dict]:
    return _query("SELECT * FROM places WHERE tier = ? ORDER BY province, name", (tier,))


def stats() -> dict:
    return {
        "total_places": _query_value("SELECT COUNT(*) FROM places"),
        "prefectures": _query_value("SELECT COUNT(*) FROM places WHERE tier='fu'"),
        "subprefectures": _query_value("SELECT COUNT(*) FROM places WHERE tier='zhou'"),
        "counties": _query_value("SELECT COUNT(*) FROM places WHERE tier='xian'"),
        "provinces": len(get_provinces()),
    }
