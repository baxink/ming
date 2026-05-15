"""
大明律在线查询索引

用法：
  from src.data.law import get_volume_url, get_agent_laws, search_law

刑部代理审案时：
  law.search_law("受贿") → 卷23 受赃, URL: https://www.zhonghuashu.com/wiki/大明律/23
"""
import json
from pathlib import Path
from typing import Optional


_INDEX = None
_BASE_URL = "https://www.zhonghuashu.com/wiki/大明律"


def _load():
    global _INDEX
    if _INDEX is None:
        path = Path(__file__).resolve().parent.parent.parent / "data" / "processed" / "institutions" / "大明律_目录.json"
        with open(path) as f:
            _INDEX = json.load(f)
    return _INDEX


def volumes() -> list[dict]:
    return _load()["volumes"]


def get_volume_url(vol: int) -> str:
    return f"{_BASE_URL}/{vol:02d}"


def get_volume(vol: int) -> Optional[dict]:
    for v in _load()["volumes"]:
        if v["vol"] == vol:
            return v
    return None


def get_agent_laws(agent_type: str) -> list[dict]:
    """获取某类代理相关的律法卷"""
    mapping = _load()["agent_mapping"]
    vol_nums = mapping.get(agent_type, [])
    return [get_volume(v) for v in vol_nums if get_volume(v)]


def search_law(keyword: str) -> list[dict]:
    """按关键词搜索律法卷"""
    results = []
    kw = keyword
    for v in _load()["volumes"]:
        if kw in v["name"] or kw in v["desc"]:
            results.append(v)
    return results


def law_toc_string(agent_type: str = "") -> str:
    """生成律法目录文本（供 LLM 代理嵌入 prompt）"""
    idx = _load()
    vols = get_agent_laws(agent_type) if agent_type else idx["volumes"]
    lines = [f"## 大明律（共 30 卷 {idx['total_articles']} 条）\n"]
    if agent_type:
        lines.append(f"以下为 {agent_type} 相关律法：\n")
    for v in vols:
        url = get_volume_url(v["vol"])
        lines.append(f"- 卷{v['vol']:02d} **{v['name']}** {v['articles']}条 — {v['desc']} [查看]({url})")
    return "\n".join(lines)


if __name__ == "__main__":
    print(law_toc_string())
    print("\n--- 刑部相关 ---")
    print(law_toc_string("刑部"))
    print("\n--- 搜索'受贿' ---")
    for v in search_law("受贿"):
        print(f"  卷{v['vol']:02d} {v['name']}: {get_volume_url(v['vol'])}")
