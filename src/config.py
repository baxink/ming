"""
明朝模拟器 — 配置管理

从环境变量加载所有外部 API 密钥和配置。
优先读取项目根目录的 .env 文件，其次读取系统环境变量。
"""
import os
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path


def _load_dotenv() -> dict[str, str]:
    """加载 .env 文件（不依赖 python-dotenv）"""
    env_vars = {}
    env_paths = [
        Path(__file__).resolve().parent.parent / ".env",
        Path.cwd() / ".env",
    ]
    for p in env_paths:
        if p.exists():
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in env_vars:
                        env_vars[key] = val
    return env_vars


def _get_env(key: str, default: str = "") -> str:
    """读取环境变量，优先系统 env，其次 .env"""
    dotenv = _load_dotenv()
    return os.environ.get(key, dotenv.get(key, default))


@dataclass
class CBDBConfig:
    api_url: str = ""
    api_key: str = ""


@dataclass
class CtextConfig:
    api_url: str = ""
    api_key: str = ""


@dataclass
class MingqingConfig:
    api_url: str = ""
    api_key: str = ""


@dataclass
class GugongConfig:
    api_url: str = ""
    api_key: str = ""


@dataclass
class CHGISConfig:
    api_url: str = ""
    api_key: str = ""


@dataclass
class LLMConfig:
    api_key: str = ""
    api_base: str = "https://api.openai.com/v1"
    model: str = "gpt-4"
    llm_api_key: str = ""
    llm_api_base: str = ""
    llm_model: str = ""


@dataclass
class RAGConfig:
    chroma_persist_dir: str = ""
    embedding_model: str = "text-embedding-3-small"


@dataclass
class DatabaseConfig:
    sqlite_path: str = "data/ming_sim.db"


@dataclass
class AppConfig:
    cbdb: CBDBConfig = field(default_factory=CBDBConfig)
    ctext: CtextConfig = field(default_factory=CtextConfig)
    mingqing: MingqingConfig = field(default_factory=MingqingConfig)
    gugong: GugongConfig = field(default_factory=GugongConfig)
    chgis: CHGISConfig = field(default_factory=CHGISConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    rag: RAGConfig = field(default_factory=RAGConfig)
    db: DatabaseConfig = field(default_factory=DatabaseConfig)


def load_config() -> AppConfig:
    return AppConfig(
    cbdb=CBDBConfig(
        api_url=_get_env("CBDB_API_URL", "https://cbdb.fas.harvard.edu/cbdbapi"),
        api_key=_get_env("CBDB_API_KEY"),
    ),
        ctext=CtextConfig(
            api_url=_get_env("CTEXT_API_URL"),
            api_key=_get_env("CTEXT_API_KEY"),
        ),
        mingqing=MingqingConfig(
            api_url=_get_env("MINGQING_API_URL"),
            api_key=_get_env("MINGQING_API_KEY"),
        ),
        gugong=GugongConfig(
            api_url=_get_env("GUGONG_API_URL"),
            api_key=_get_env("GUGONG_API_KEY"),
        ),
        chgis=CHGISConfig(
            api_url=_get_env("CHGIS_API_URL"),
            api_key=_get_env("CHGIS_API_KEY"),
        ),
        llm=LLMConfig(
            api_key=_get_env("OPENAI_API_KEY"),
            api_base=_get_env("OPENAI_API_BASE"),
            model=_get_env("OPENAI_MODEL"),
            llm_api_key=_get_env("LLM_API_KEY"),
            llm_api_base=_get_env("LLM_API_BASE"),
            llm_model=_get_env("LLM_MODEL"),
        ),
        rag=RAGConfig(
            chroma_persist_dir=_get_env("CHROMA_PERSIST_DIR"),
            embedding_model=_get_env("EMBEDDING_MODEL"),
        ),
        db=DatabaseConfig(
            sqlite_path=_get_env("SQLITE_PATH"),
        ),
    )


_config_cache: Optional[AppConfig] = None


def get_config() -> AppConfig:
    global _config_cache
    if _config_cache is None:
        _config_cache = load_config()
    return _config_cache


def check_api_keys() -> dict[str, bool]:
    """检查各 API 密钥与本地数据库是否已配置"""
    c = get_config()
    from src.data.db_manager import get_db
    db = get_db()
    dbs = db.registry.list_databases()
    result = {}
    for name in dbs:
        result[f"本地DB: {name}"] = True
    result["ctext.org API"] = bool(c.ctext.api_key)
    result["故宫博物院 API"] = bool(c.gugong.api_key)
    result["LLM"] = bool(c.llm.api_key or c.llm.llm_api_key)
    result["嵌入模型"] = bool(c.rag.embedding_model)
    return result


def status() -> str:
    """获取完整配置状态报告"""
    from src.data import init as data_init
    db = data_init()
    c = get_config()
    lines = ["=== 明朝模拟器 配置状态 ==="]
    lines.append(f"本地数据库 ({db.registry.count} 个):")
    for name, path in db.registry.list_databases().items():
        tables = len(db.table_names(name))
        import os
        size = os.path.getsize(path) / (1024*1024)
        lines.append(f"  📂 {name}: {path} ({size:.0f}MB, {tables} 表)")
    lines.append(f"LLM: {'✓' if (c.llm.api_key or c.llm.llm_api_key) else '✗'} (模型: {c.llm.model or c.llm.llm_model or '未设置'})")
    lines.append(f"ctext API: {'✓' if c.ctext.api_key else '✗'}")
    lines.append(f"故宫 API: {'✓' if c.gugong.api_key else '✗'}")
    return "\n".join(lines)


if __name__ == "__main__":
    cfg = get_config()
    print("=== 明朝模拟器 配置状态 ===")
    for name, ready in check_api_keys().items():
        status = "✓ 已配置" if ready else "✗ 未配置"
        print(f"  {name}: {status}")
