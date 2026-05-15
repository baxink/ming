"""
数据对齐工具

负责将不同来源的数据对齐到统一 schema
"""
from typing import Optional
from copy import deepcopy


def align_person_record(record: dict, source: str) -> dict:
    """将不同来源的人物记录对齐到 person.schema.json"""
    aligned = {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "style_name": record.get("style_name", record.get("字", "")),
        "birth_year": record.get("birth_year", record.get("生年", None)),
        "death_year": record.get("death_year", record.get("卒年", None)),
        "native_place": {
            "province": record.get("native_place", {}).get("province", ""),
            "prefecture": record.get("native_place", {}).get("prefecture", ""),
            "county": record.get("native_place", {}).get("county", ""),
        },
        "entry_path": record.get("entry_path", record.get("入仕途径", "")),
        "career_timeline": record.get("career_timeline", []),
        "faction_tags": record.get("faction_tags", []),
        "relation_edges": record.get("relation_edges", []),
        "structured_traits": record.get("structured_traits", {}),
        "evidence_quotes": record.get("evidence_quotes", []),
        "behavior_guidelines": record.get("behavior_guidelines", []),
        "source_refs": record.get("source_refs", [source]),
        "historical_confidence": record.get("historical_confidence", "reasonable_inference"),
        "is_historical": record.get("is_historical", True),
    }
    return aligned


def align_region_record(record: dict, source: str) -> dict:
    """将不同来源的区域记录对齐到 region.schema.json"""
    aligned = {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "tier": record.get("tier", record.get("层级", "")),
        "parent_id": record.get("parent_id", record.get("上级区划", None)),
        "capital_city": record.get("capital_city", ""),
        "coordinates": record.get("coordinates", {}),
        "population": record.get("population", {}),
        "economy": record.get("economy", {}),
        "sources": record.get("sources", [source]),
    }
    return aligned


def align_event_record(record: dict, source: str) -> dict:
    """将不同来源的事件记录对齐到 event.schema.json"""
    aligned = {
        "id": record.get("id", ""),
        "title": record.get("title", ""),
        "event_type": record.get("event_type", record.get("类型", "")),
        "date": record.get("date", {}),
        "location": record.get("location", {}),
        "severity": record.get("severity", record.get("严重程度", "moderate")),
        "primary_sources": record.get("primary_sources", [source]),
        "is_historical": record.get("is_historical", True),
        "historical_confidence": record.get("historical_confidence", "reasonable_inference"),
    }
    return aligned


def merge_person_records(records: list[dict]) -> dict:
    """合并同一人物的多条记录"""
    if not records:
        return {}
    merged = deepcopy(records[0])
    for record in records[1:]:
        merged["evidence_quotes"] = merged.get("evidence_quotes", []) + record.get("evidence_quotes", [])
        merged["source_refs"] = list(set(merged.get("source_refs", []) + record.get("source_refs", [])))
        merged["relation_edges"] = merged.get("relation_edges", []) + [e for e in record.get("relation_edges", []) if e not in merged.get("relation_edges", [])]
    return merged
