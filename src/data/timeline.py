"""
明代编年时间线查询

从 data/processed/timeline/ming_timeline.json 加载连贯历史事件，
支持按年份、年号、类型、地区、人物等多维度检索。
"""
import json
import os
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class TimelineEvent:
    id: str
    year: int
    month: Optional[int]
    reign: str
    reign_year: int
    title: str
    description: str
    event_type: str
    scope: str
    severity: str
    location: dict = field(default_factory=dict)
    involved_persons: list[dict] = field(default_factory=list)
    causes: list[str] = field(default_factory=list)
    consequences: list[str] = field(default_factory=list)
    category: str = ""

    def __repr__(self):
        return f"[{self.year} {self.reign}{self.reign_year}年] {self.title}"

    @property
    def has_cbdb_persons(self) -> bool:
        return any(p.get("person_id") for p in self.involved_persons)


class Timeline:
    """编年时间线查询"""

    def __init__(self, path: str = None):
        if path is None:
            path = Path(__file__).resolve().parent.parent.parent / "data" / "processed" / "timeline" / "ming_timeline.json"
        self._events: list[TimelineEvent] = []
        self._by_year: dict[int, list[TimelineEvent]] = {}
        self._by_type: dict[str, list[TimelineEvent]] = {}
        self._by_person: dict[int, list[TimelineEvent]] = {}
        self._load(path)

    def _load(self, path: str):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for d in data:
            evt = TimelineEvent(
                id=d["id"], year=d["year"], month=d.get("month"),
                reign=d.get("reign", ""), reign_year=d.get("reign_year", 0),
                title=d["title"], description=d.get("description", ""),
                event_type=d["event_type"], scope=d.get("scope", ""),
                severity=d.get("severity", ""), location=d.get("location", {}),
                involved_persons=d.get("involved_persons", []),
                causes=d.get("causes", []), consequences=d.get("consequences", []),
                category=d.get("category", ""),
            )
            self._events.append(evt)
            self._by_year.setdefault(evt.year, []).append(evt)
            self._by_type.setdefault(evt.event_type, []).append(evt)
            for p in evt.involved_persons:
                pid = p.get("person_id")
                if pid is not None:
                    self._by_person.setdefault(pid, []).append(evt)

    @property
    def count(self) -> int:
        return len(self._events)

    @property
    def years_covered(self) -> tuple[int, int]:
        years = [e.year for e in self._events if e.year]
        return (min(years), max(years))

    def all(self) -> list[TimelineEvent]:
        return list(self._events)

    def by_year(self, year: int) -> list[TimelineEvent]:
        return self._by_year.get(year, [])

    def by_year_range(self, start: int, end: int) -> list[TimelineEvent]:
        result = []
        for y in range(start, end + 1):
            result.extend(self.by_year(y))
        return result

    def by_reign(self, reign: str) -> list[TimelineEvent]:
        return [e for e in self._events if e.reign == reign]

    def by_type(self, event_type: str) -> list[TimelineEvent]:
        return self._by_type.get(event_type, [])

    def by_category(self, category: str) -> list[TimelineEvent]:
        return [e for e in self._events if e.category == category]

    def by_person(self, person_id: int) -> list[TimelineEvent]:
        return self._by_person.get(person_id, [])

    def by_scope(self, scope: str) -> list[TimelineEvent]:
        return [e for e in self._events if e.scope == scope]

    def by_severity(self, severity: str) -> list[TimelineEvent]:
        return [e for e in self._events if e.severity == severity]

    def critical_events(self) -> list[TimelineEvent]:
        return self.by_severity("critical")

    def search(self, keyword: str) -> list[TimelineEvent]:
        kw = keyword.lower()
        return [e for e in self._events if kw in e.title.lower() or kw in e.description.lower()]

    def get_year_context(self, year: int, before: int = 3, after: int = 3) -> list[TimelineEvent]:
        """获取某年前后若干年的历史上下文（连贯叙事）"""
        start = max(year - before, 1368)
        end = min(year + after, 1644)
        return self.by_year_range(start, end)

    def get_cbdb_person_events(self, person_id: int) -> list[TimelineEvent]:
        """获取 CBDB 人物关联的历史事件"""
        return self._by_person.get(person_id, [])

    def event_types(self) -> list[str]:
        return sorted(self._by_type.keys())

    def categories(self) -> list[str]:
        cats = {e.category for e in self._events if e.category}
        return sorted(cats)

    def summary(self) -> dict:
        return {
            "total_events": self.count,
            "year_span": self.years_covered,
            "reigns": len({e.reign for e in self._events if e.reign}),
            "critical_events": len(self.critical_events()),
            "event_types": self.event_types(),
            "categories": self.categories(),
        }


_timeline_instance: Optional[Timeline] = None


def get_timeline() -> Timeline:
    global _timeline_instance
    if _timeline_instance is None:
        _timeline_instance = Timeline()
    return _timeline_instance
