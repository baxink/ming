"""
多数据库管理器

负责管理多个 SQLite 数据库的连接与查询。
支持注册多个外部数据库（CBDB、CHGIS、地方志等），提供统一查询接口。
"""
import os
import sqlite3
from pathlib import Path
from typing import Optional, Any
from threading import Lock


class DatabaseRegistry:
    """数据库注册表"""

    def __init__(self):
        self._dbs: dict[str, str] = {}
        self._lock = Lock()

    def register(self, name: str, path: str):
        """注册一个数据库"""
        if not os.path.exists(path):
            raise FileNotFoundError(f"数据库文件不存在: {path}")
        with self._lock:
            self._dbs[name] = os.path.abspath(path)

    def unregister(self, name: str):
        with self._lock:
            self._dbs.pop(name, None)

    def get_path(self, name: str) -> Optional[str]:
        return self._dbs.get(name)

    def list_databases(self) -> dict[str, str]:
        with self._lock:
            return dict(self._dbs)

    @property
    def count(self) -> int:
        return len(self._dbs)


class ConnectionPool:
    """SQLite 连接池（按数据库名缓存连接）"""

    def __init__(self, registry: DatabaseRegistry):
        self._registry = registry
        self._connections: dict[str, sqlite3.Connection] = {}
        self._lock = Lock()

    def get_connection(self, db_name: str) -> sqlite3.Connection:
        with self._lock:
            if db_name not in self._connections:
                path = self._registry.get_path(db_name)
                if path is None:
                    raise ValueError(f"数据库未注册: {db_name}")
                conn = sqlite3.connect(path, check_same_thread=False)
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA foreign_keys=ON")
                self._connections[db_name] = conn
            return self._connections[db_name]

    def close_all(self):
        with self._lock:
            for conn in self._connections.values():
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()


class DatabaseManager:
    """多数据库管理器 — 全局单例"""

    _instance: Optional["DatabaseManager"] = None
    _lock = Lock()

    def __init__(self):
        self.registry = DatabaseRegistry()
        self.pool = ConnectionPool(self.registry)

    @classmethod
    def get_instance(cls) -> "DatabaseManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def register(self, name: str, path: str):
        self.registry.register(name, path)

    def query(self, db_name: str, sql: str, params: tuple = ()) -> list[dict]:
        conn = self.pool.get_connection(db_name)
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]

    def query_one(self, db_name: str, sql: str, params: tuple = ()) -> Optional[dict]:
        rows = self.query(db_name, sql, params)
        return rows[0] if rows else None

    def query_value(self, db_name: str, sql: str, params: tuple = ()) -> Optional[Any]:
        row = self.query_one(db_name, sql, params)
        if row:
            return list(row.values())[0]
        return None

    def execute(self, db_name: str, sql: str, params: tuple = ()):
        conn = self.pool.get_connection(db_name)
        conn.execute(sql, params)
        conn.commit()

    def table_names(self, db_name: str) -> list[str]:
        rows = self.query(db_name, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return [r["name"] for r in rows]

    def table_info(self, db_name: str, table: str) -> list[dict]:
        return self.query(db_name, f"PRAGMA table_info({table})")

    def close(self):
        self.pool.close_all()

    def status(self) -> dict:
        dbs = self.registry.list_databases()
        result = {}
        for name, path in dbs.items():
            size_mb = os.path.getsize(path) / (1024 * 1024)
            table_count = len(self.table_names(name))
            result[name] = {"path": path, "size_mb": round(size_mb, 1), "tables": table_count}
        return result


def get_db() -> DatabaseManager:
    return DatabaseManager.get_instance()


def auto_register_databases(data_dir: str = None):
    """自动扫描 data/raw 下的 SQLite 数据库并注册"""
    if data_dir is None:
        data_dir = Path(__file__).resolve().parent.parent.parent / "data" / "raw"

    db = get_db()
    for root, dirs, files in os.walk(data_dir):
        for f in files:
            if f.endswith(".sqlite3") or f.endswith(".db"):
                full_path = os.path.join(root, f)
                rel = os.path.relpath(root, data_dir)
                name = os.path.basename(root) if rel != "." else f.replace(".sqlite3", "").replace(".db", "")
                try:
                    db.register(name, full_path)
                except FileNotFoundError:
                    pass
    return db
