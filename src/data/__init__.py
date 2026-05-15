"""
数据层入口 — 自动注册数据库并初始化
"""
from src.data.db_manager import get_db, auto_register_databases
from src.data import cbdb

__all__ = ["get_db", "cbdb", "init"]


def init(data_dir: str = None):
    """初始化数据层：扫描并注册所有可用数据库"""
    auto_register_databases(data_dir)
    db = get_db()
    status = db.registry.list_databases()
    for name in status:
        path = status[name]
        tables = len(db.table_names(name))
        print(f"  📂 {name}: {path} ({tables} 表)")
    return db
