"""
大明新闻季报 — 新闻编辑引擎

负责：
- 从时间线数据中提取当前明朝时间窗内的事件
- 以每 3 个月为 1 个季度生成当期版面
- 按版面分类、格式化为新闻文章
- 生成供前端渲染的报纸 JSON
"""
import json
import os
import re
import random
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta

TIMEZONE_CST = timezone(timedelta(hours=8))

EPOCH_REAL = datetime(2026, 5, 15, 0, 0, 0, tzinfo=TIMEZONE_CST)
EPOCH_MING_YEAR = 1368
EPOCH_MING_MONTH = 1
MING_END_YEAR = 1644
MING_END_MONTH = 4
MONTHS_PER_REAL_DAY = 3
ISSUE_MONTH_SPAN = 3

REIGN_PERIODS = [
    (1368, 1398, "洪武", "太祖朱元璋"),
    (1399, 1402, "建文", "惠宗朱允炆"),
    (1403, 1424, "永乐", "成祖朱棣"),
    (1425, 1425, "洪熙", "仁宗朱高炽"),
    (1426, 1435, "宣德", "宣宗朱瞻基"),
    (1436, 1449, "正统", "英宗朱祁镇"),
    (1450, 1456, "景泰", "代宗朱祁钰"),
    (1457, 1464, "天顺", "英宗朱祁镇"),
    (1465, 1487, "成化", "宪宗朱见深"),
    (1488, 1505, "弘治", "孝宗朱祐樘"),
    (1506, 1521, "正德", "武宗朱厚照"),
    (1522, 1566, "嘉靖", "世宗朱厚熜"),
    (1567, 1572, "隆庆", "穆宗朱载坖"),
    (1573, 1620, "万历", "神宗朱翊钧"),
    (1621, 1627, "天启", "熹宗朱由校"),
    (1628, 1644, "崇祯", "思宗朱由检"),
]


@dataclass
class NewspaperDate:
    real_date: str
    ming_reign: str
    ming_year: int
    ming_month: int
    emperor: str
    season: str


@dataclass
class PeriodMeta:
    issue_number: int
    label: str
    start_label: str
    end_label: str
    start_year: int
    start_month: int
    end_year: int
    end_month: int
    calendar_note: str = ""


@dataclass
class Article:
    id: str
    section: str
    headline: str
    subhead: str = ""
    dateline: str = ""
    byline: str = ""
    body: str = ""
    event_type: str = ""
    severity: str = ""
    location: str = ""
    category: str = ""
    sources: list = field(default_factory=list)
    source_date: str = ""
    content_type: str = "historical_digest"
    time_precision: str = "unknown"
    verification_status: str = "needs_review"
    source_excerpt: str = ""
    editorial_note: str = ""
    background: str = ""
    later_effects: str = ""


@dataclass
class NewspaperIssue:
    date: NewspaperDate
    period: PeriodMeta
    lead: Article | None = None
    articles: list = field(default_factory=list)
    sections: dict = field(default_factory=dict)
    annual_events: list = field(default_factory=list)
    editorial_note: str = ""


CONTENT_TYPE_REPORT = "historical_report"
CONTENT_TYPE_DIGEST = "historical_digest"
CONTENT_TYPE_ANALYSIS = "historical_analysis"
CONTENT_TYPE_OPINION = "opinion"

TIME_PRECISION_MONTH = "month"
TIME_PRECISION_YEAR = "year"
TIME_PRECISION_RANGE = "range"
TIME_PRECISION_UNKNOWN = "unknown"

VERIFICATION_VERIFIED = "verified"
VERIFICATION_NEEDS_REVIEW = "needs_review"

CALENDAR_NOTE = "时段按明代历法月序（正月、二月……十二月）编组，未换算为公历日期。"

# 十一月/十二月 must be matched before 一月/二月 so a substring is never read as a short month.
MONTH_TOKENS = [
    (11, "十一月"), (12, "十二月"),
    (1, "正月"), (1, "一月"),
    (2, "二月"), (3, "三月"), (4, "四月"), (5, "五月"), (6, "六月"),
    (7, "七月"), (8, "八月"), (9, "九月"), (10, "十月"),
]


def _data_dir():
    return os.path.join(os.path.dirname(__file__), "..", "..", "data", "processed")


def _load_json(filename: str):
    path = os.path.join(_data_dir(), filename)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


SECTION_MAP = {
    "朝政要闻": ["dynasty", "institutional", "political", "political_purge", "court_purge",
                  "imperial_ritual", "policy_reform", "policy_enactment", "palace", "diplomatic"],
    "边关军事": ["military", "battle", "rebellion", "border", "foreign", "wokou"],
    "经济民生": ["fiscal", "fiscal_reform", "economy", "economic", "taxation", "grain",
                  "water_conservancy", "agriculture", "infrastructure"],
    "科举文教": ["examination", "culture", "cultural", "academy", "art", "literature"],
    "灾异志": ["disaster", "natural_disaster"],
    "人事任免": ["personnel", "appointment", "dismissal"],
    "评论": ["commentary"],
}

SECTION_ORDER = ["朝政要闻", "边关军事", "经济民生", "科举文教", "灾异志", "人事任免", "评论"]
SECTION_TARGETS = {
    "朝政要闻": {"min": 1, "max": 3},
    "边关军事": {"min": 1, "max": 2},
    "经济民生": {"min": 1, "max": 2},
    "科举文教": {"min": 1, "max": 2},
    "灾异志": {"min": 1, "max": 2},
    "人事任免": {"min": 1, "max": 2},
    "评论": {"min": 1, "max": 1},
}


def _season_for_month(month: int) -> str:
    season_map = {1: "春", 2: "春", 3: "春", 4: "夏", 5: "夏", 6: "夏",
                  7: "秋", 8: "秋", 9: "秋", 10: "冬", 11: "冬", 12: "冬"}
    return season_map.get(month, "")


def _get_reign_data(year: int) -> tuple[str, int, str]:
    for start, end, rtitle, emperor in REIGN_PERIODS:
        if start <= year <= end:
            return rtitle, year - start + 1, emperor
    return "明朝", year, ""


def _format_ming_label(abs_year: int, abs_month: int) -> str:
    reign_title, reign_year, _ = _get_reign_data(abs_year)
    return f"{reign_title}{reign_year}年{abs_month}月"


def _month_key(year: int, month: int) -> int:
    return year * 12 + month


def _month_diff(start_year: int, start_month: int, year: int, month: int) -> int:
    return _month_key(year, month) - _month_key(start_year, start_month)


def _clamp_month(year: int, month: int) -> tuple[int, int]:
    if year > MING_END_YEAR or (year == MING_END_YEAR and month > MING_END_MONTH):
        return MING_END_YEAR, MING_END_MONTH
    return year, month


def _advance_month(year: int, month: int, delta: int = 1) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + delta
    next_year = total // 12
    next_month = total % 12 + 1
    return _clamp_month(next_year, next_month)


def _build_period(abs_year: int, abs_month: int) -> PeriodMeta:
    quarter_index = ((abs_month - 1) // ISSUE_MONTH_SPAN) + 1
    end_year, end_month = _advance_month(abs_year, abs_month, ISSUE_MONTH_SPAN - 1)
    issue_number = ((abs_year - EPOCH_MING_YEAR) * 12 + (abs_month - EPOCH_MING_MONTH)) // ISSUE_MONTH_SPAN + 1
    reign_title, reign_year, _ = _get_reign_data(abs_year)
    return PeriodMeta(
        issue_number=issue_number,
        label=f"{reign_title}{reign_year}年第{quarter_index}季度",
        start_label=_format_ming_label(abs_year, abs_month),
        end_label=_format_ming_label(end_year, end_month),
        start_year=abs_year,
        start_month=abs_month,
        end_year=end_year,
        end_month=end_month,
        calendar_note=CALENDAR_NOTE,
    )


def _classify_event(event: dict) -> str:
    specific_section = {"examination": "科举文教", "appointment": "人事任免", "dismissal": "人事任免"}.get(event.get("event_type"))
    if specific_section:
        return specific_section
    category = event.get("category", "unknown")
    for section, cats in SECTION_MAP.items():
        if category in cats:
            return section
    return "朝政要闻"


MONTH_NAMES = {
    1: "正月", 2: "二月", 3: "三月", 4: "四月", 5: "五月", 6: "六月",
    7: "七月", 8: "八月", 9: "九月", 10: "十月", 11: "十一月", 12: "十二月",
}

_MULTI_RECORD_RE = re.compile(r"[0-9]+\s*[.．](?=[^0-9])|[①②③④⑤⑥⑦⑧⑨⑩]")
_DANGLING_SOURCE_RE = re.compile(r"[（(][^）)]*$|《[^》]*$")


def _format_source_date(year: int, month: int | None) -> str:
    if month:
        return f"{year}年{_month_name(month)}"
    return f"{year}年"


def _month_name(month: int) -> str:
    return MONTH_NAMES.get(month, f"{month}月")


def _distinct_months(text: str) -> set:
    """Extract distinct Ming lunar months, never reading 十一月 as 一月."""
    work = text or ""
    found = set()
    for month, token in MONTH_TOKENS:
        if token in work:
            found.add(month)
            work = work.replace(token, f"\u0001{month}\u0001")
    return found


def _has_multi_record_markers(text: str) -> bool:
    return bool(_MULTI_RECORD_RE.search(text or ""))


def _has_dangling_source(text: str) -> bool:
    text = text or ""
    if _DANGLING_SOURCE_RE.search(text):
        return True
    return text.count("（") != text.count("）") or text.count("《") != text.count("》")


def _complete_sources(sources) -> bool:
    return (isinstance(sources, list) and len(sources) > 0
            and all(isinstance(s, str) and s.strip() for s in sources))


def _source_list(raw) -> list:
    if not isinstance(raw, list):
        return []
    return [s.strip() for s in raw if isinstance(s, str) and s.strip()]


def _disaster_text(disaster: dict) -> str:
    # The `reign` field is deliberately excluded: it carries year text that would
    # otherwise smear records across quarters.
    return f"{disaster.get('location', '')}{disaster.get('description', '')}"


def _disaster_is_precise(disaster: dict) -> bool:
    if not _complete_sources(disaster.get("sources")):
        return False
    text = _disaster_text(disaster)
    if _has_multi_record_markers(text) or _has_dangling_source(text) or not _disaster_has_complete_description(disaster):
        return False
    if _has_conflicting_source_year(disaster):
        return False
    # Citation dates may refer to a later relief order, not the disaster itself.
    event_text = _CITATION_RE.sub("", text)
    return len(_distinct_months(text)) == 1 and len(_distinct_months(event_text)) == 1


def _disaster_has_complete_description(disaster: dict) -> bool:
    description = str(disaster.get("description") or "").strip()
    return bool(description) and description.endswith(("。", "！", "？", ".", "!", "?", "）", ")"))


_CITATION_RE = re.compile(r"[（(]《[^》]*》[^）)]*[）)]")
_REIGN_YEAR_RE = re.compile(
    r"(" + "|".join(period[2] for period in REIGN_PERIODS) + r")([元一二三四五六七八九十]+)年"
)
_CHINESE_DIGITS = {"元": 1, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
                   "六": 6, "七": 7, "八": 8, "九": 9}


def _has_conflicting_source_year(disaster: dict) -> bool:
    starts = {period[2]: period[0] for period in REIGN_PERIODS}
    text = _disaster_text(disaster)
    years = {int(year) for year in re.findall(r"(?<!\d)(\d{4})年", text)}
    for title, numeral in _REIGN_YEAR_RE.findall(text):
        if "十" in numeral:
            tens, ones = numeral.split("十", 1)
            number = _CHINESE_DIGITS.get(tens, 1) * 10 + _CHINESE_DIGITS.get(ones, 0)
        else:
            number = _CHINESE_DIGITS.get(numeral)
        if number is not None:
            years.add(starts[title] + number - 1)
    return any(year != disaster.get("year") for year in years)


def _explicit_verified(record: dict) -> bool:
    """Verification must be asserted by the input, never inferred from parsing.

    A clean parse with citations is not factual verification; the record itself
    must carry verification_status=="verified" plus non-empty sources and an
    explicit source_excerpt.
    """
    if str(record.get("verification_status") or "").strip() != VERIFICATION_VERIFIED:
        return False
    if not _complete_sources(record.get("sources")):
        return False
    return isinstance(record.get("source_excerpt"), str) and bool(record["source_excerpt"].strip())


def _resolve_source_excerpt(record: dict, fallback: str = "") -> str:
    explicit = str(record.get("source_excerpt") or "").strip()
    return explicit or (fallback or "").strip()


def _disaster_raw_excerpt(disaster: dict) -> str:
    """Raw excerpt fallback: copied text only, never a verification signal."""
    desc = str(disaster.get("description") or "")
    return re.sub(r"\s+", " ", desc).strip()[:500]


def _timeline_article(event: dict, time_precision: str, editorial_note: str,
                      verified: bool, sources: list, source_excerpt: str) -> Article:
    section = _classify_event(event)
    loc = event.get("location") or {}
    city = (loc.get("city") or "") if isinstance(loc, dict) else ""
    province = (loc.get("province") or "") if isinstance(loc, dict) else ""

    dateline_parts = [p for p in [city, province] if p]
    dateline = "、".join(dateline_parts) if dateline_parts else "京师"

    title = (event.get("title", "") or "").strip()
    desc = (event.get("description", "") or "").strip()
    desc = re.sub(r"\s+", " ", desc)
    if len(desc) > 220:
        desc = desc[:220].rstrip("，、；：,. ") + "…"
    subhead = desc[:56] + "…" if len(desc) > 56 else desc

    causes = [c for c in (event.get("causes") or []) if c]
    consequences = [c for c in (event.get("consequences") or []) if c]

    return Article(
        id=event.get("id", ""),
        section=section,
        headline=title,
        subhead=subhead,
        dateline=f"{dateline} —",
        byline="",
        body=desc,
        event_type=event.get("event_type", ""),
        severity=event.get("severity", ""),
        location=f"{province}{city}",
        category=event.get("category", ""),
        sources=sources,
        source_date=_format_source_date(event.get("year", 0), event.get("month")),
        content_type=CONTENT_TYPE_REPORT if verified else CONTENT_TYPE_DIGEST,
        time_precision=time_precision,
        verification_status=VERIFICATION_VERIFIED if verified else VERIFICATION_NEEDS_REVIEW,
        source_excerpt=source_excerpt,
        editorial_note=editorial_note,
        background="、".join(causes[:2]),
        later_effects="、".join(consequences[:2]),
    )


def _event_to_article(event: dict) -> Article:
    month = event.get("month")
    verified = _explicit_verified(event)
    sources = _source_list(event.get("sources"))
    source_excerpt = _resolve_source_excerpt(event, "")
    if verified:
        editorial_note = (
            "本条资料已显式标注为核验完成；"
            f"月份为明代历法月序（{_month_name(month)}），未作公历换算。"
        )
    else:
        editorial_note = (
            ("本条附有来源材料，仍列为待核记录；" if sources else "本条取自原始时间线，未附史源与校订信息，列为待核记录；") +
            f"月份为明代历法月序（{_month_name(month)}），未作公历换算。"
        )
    if event.get("editorial_note"):
        editorial_note = f"{event['editorial_note']} {editorial_note}"
    return _timeline_article(
        event, TIME_PRECISION_MONTH, editorial_note, verified, sources, source_excerpt,
    )


def _annual_timeline_article(event: dict) -> Article:
    verified = _explicit_verified(event)
    status_note = "资料已显式标注为核验完成。" if verified else "资料仍待核验。"
    return _timeline_article(
        event,
        TIME_PRECISION_YEAR,
        f"{event.get('editorial_note') or ''} 原始记录仅系年、月份不详，未列入季度版面，改列年度辑录；未作公历换算。{status_note}".strip(),
        verified,
        _source_list(event.get("sources")),
        _resolve_source_excerpt(event, ""),
    )


def _clean_location(raw: str) -> str:
    if not raw:
        return ""
    parts = re.split(r'[：:]', raw, maxsplit=1)
    first = parts[0].strip()
    first = re.sub(r'[12]\.\s*', '', first)
    first = re.sub(r'[①②③④⑤⑥⑦⑧⑨⑩]', '', first)
    if len(first) > 30:
        first = first[:30] + "…"
    return first


def _clean_disaster_desc(raw: str) -> str:
    if not raw:
        return ""
    desc = re.sub(r'[12]\.\d*\.?\s*', '', raw)
    desc = re.sub(r'[①②③④⑤⑥⑦⑧⑨⑩]', '', desc)
    desc = re.sub(r'（[^）]*《[^》]*》[^）]*）', '', desc)
    desc = re.sub(r'（《[^。！？]*$', '', desc)
    desc = desc.strip()
    if len(desc) > 220:
        desc = desc[:220] + "…"
    return desc


def _extract_disaster_location(raw: str) -> str:
    if not raw:
        return "各地"
    m = re.match(r'([^：:]+?)(?:[：:]|$)', raw)
    if m:
        loc = m.group(1).strip()
        loc = re.sub(r'[12]\.\s*', '', loc)
        if len(loc) > 25:
            loc = loc[:25] + "…"
        return loc
    return "各地"


def _disaster_to_article(disaster: dict, seq: int, month: int, precise: bool) -> Article:
    dtype = disaster.get("disaster_type", "灾异")
    year = disaster.get("year", 0)
    desc = _clean_disaster_desc(disaster.get("description", ""))
    location = _extract_disaster_location(disaster.get("location", ""))
    clean_loc = _clean_location(disaster.get("location", ""))
    sources = _source_list(disaster.get("sources"))
    source_excerpt = _resolve_source_excerpt(disaster, _disaster_raw_excerpt(disaster))
    verified = precise and _explicit_verified(disaster)

    headline = f"{clean_loc}{dtype}" if clean_loc else f"{dtype}报告"
    if len(headline) > 30:
        headline = f"{dtype}：{clean_loc[:20]}" if clean_loc else f"{dtype}报告"

    if precise:
        article_id = f"DIS_{year}_{month}_{seq}"
        time_precision = TIME_PRECISION_MONTH
        if verified:
            content_type = CONTENT_TYPE_REPORT
            verification_status = VERIFICATION_VERIFIED
            editorial_note = (
                f"单一月份灾异记录，出处已显式核验（{source_excerpt}）；"
                f"月份为明代历法月序（{_month_name(month)}），未作公历换算。"
            )
        else:
            content_type = CONTENT_TYPE_DIGEST
            verification_status = VERIFICATION_NEEDS_REVIEW
            excerpt_note = (
                f"原文摘录仅照录、未经核验（{source_excerpt}）"
                if source_excerpt else "原始出处未附"
            )
            editorial_note = (
                f"单一月份灾异记录，{excerpt_note}，列为待核记录；"
                f"月份为明代历法月序（{_month_name(month)}），未作公历换算。"
            )
    else:
        article_id = f"DIS_{year}_A{seq}"
        content_type = CONTENT_TYPE_DIGEST
        time_precision = TIME_PRECISION_YEAR
        verification_status = VERIFICATION_NEEDS_REVIEW
        editorial_note = (
            "本条未载明确月份，列入年度待核辑录，不推定具体季度；未作公历换算。"
        )

    return Article(
        id=article_id,
        section="灾异志",
        headline=headline,
        subhead="",
        dateline=f"{location} —" if location else "各地 —",
        byline="",
        body=desc,
        event_type="disaster",
        severity="major" if any(k in dtype for k in ["疫", "灾", "震", "涝", "旱"]) else "",
        location=location,
        category="disaster",
        sources=sources,
        source_date=f"{year}年",
        content_type=content_type,
        time_precision=time_precision,
        verification_status=verification_status,
        source_excerpt=source_excerpt,
        editorial_note=editorial_note,
    )


class NewsroomEngine:
    def __init__(self):
        self.timeline = _load_json("timeline/ming_timeline.json")
        self.disasters = _load_json("timeline/ming_disasters.json")

    def _elapsed_ming_months(self, now: datetime) -> float:
        delta_days = (now.date() - EPOCH_REAL.date()).days
        if delta_days < 0:
            return 0.0
        return float(delta_days * MONTHS_PER_REAL_DAY)

    def _real_to_ming(self, now: datetime) -> tuple[int, int]:
        months = self._elapsed_ming_months(now)
        total_months = int(months)
        year = EPOCH_MING_YEAR + total_months // 12
        month = EPOCH_MING_MONTH + total_months % 12
        if month > 12:
            year += 1
            month -= 12
        return _clamp_month(year, month)

    def get_current_ming_date(self, now: datetime | None = None) -> NewspaperDate:
        if now is None:
            now = datetime.now(TIMEZONE_CST)
        year, month = self._real_to_ming(now)
        reign_title, reign_year, emperor = _get_reign_data(year)
        return NewspaperDate(
            real_date=now.strftime("%Y年%m月%d日"),
            ming_reign=reign_title,
            ming_year=reign_year,
            ming_month=month,
            emperor=emperor,
            season=_season_for_month(month),
        )

    def get_events_in_period(self, start_year: int, start_month: int,
                             span_months: int = ISSUE_MONTH_SPAN) -> list[Article]:
        if span_months != ISSUE_MONTH_SPAN:
            raise ValueError(
                f"季报固定为 {ISSUE_MONTH_SPAN} 个月窗口，收到 {span_months} 个月"
            )
        events = []
        if not self.timeline:
            return events

        for event in self.timeline:
            em = event.get("month")
            if not em:
                # 月份不详者不进入季度版面，改列年度待核辑录，避免每年重复且错置 Q1。
                continue
            ey = event.get("year", 0)
            diff = _month_diff(start_year, start_month, ey, em)
            if 0 <= diff < span_months:
                events.append(_event_to_article(event))

        return events

    def get_disasters_in_period(self, start_year: int, start_month: int,
                                end_year: int) -> list[Article]:
        disasters = []
        if not self.disasters:
            return disasters

        seq = 1
        for d in self.disasters:
            if d.get("year", 0) != start_year or not _disaster_is_precise(d):
                continue
            months = _distinct_months(_disaster_text(d))
            if len(months) != 1:
                continue
            month = next(iter(months))
            diff = _month_diff(start_year, start_month, start_year, month)
            if 0 <= diff < ISSUE_MONTH_SPAN:
                disasters.append(_disaster_to_article(d, seq, month, precise=True))
                seq += 1

        return disasters[:6]

    def get_annual_events(self, period: PeriodMeta) -> list[Article]:
        if ((period.start_month - 1) // ISSUE_MONTH_SPAN) + 1 != 4:
            return []
        year = period.start_year
        events = []
        for event in self.timeline:
            if event.get("year", 0) == year and not event.get("month"):
                events.append(_annual_timeline_article(event))
        seq = 1
        for d in self.disasters:
            if d.get("year", 0) != year or _disaster_is_precise(d):
                continue
            text = _disaster_text(d)
            if _has_multi_record_markers(text) or _has_dangling_source(text) or _distinct_months(text) or _has_conflicting_source_year(d) or not _disaster_has_complete_description(d):
                continue
            events.append(_disaster_to_article(d, seq, 0, precise=False))
            seq += 1
        return events

    def _headline_fingerprint(self, text: str) -> str:
        text = re.sub(r"[：:，、。；！？\s]", "", text or "")
        return text[:18]

    def _article_score(self, article: Article) -> int:
        score = 0
        severity_scores = {"critical": 100, "major": 70, "": 20}
        score += severity_scores.get(article.severity, 30)
        section_bias = {
            "朝政要闻": 30,
            "边关军事": 24,
            "经济民生": 22,
            "科举文教": 18,
            "灾异志": 20,
            "人事任免": 16,
        }
        score += section_bias.get(article.section, 10)
        score += min(len(article.body or "") // 20, 12)
        if article.byline:
            score += 6
        if article.source_date:
            score += 4
        if article.event_type == "background":
            score -= 10
        if article.event_type == "opinion":
            score -= 1000
        return score

    def _dedupe_articles(self, articles: list[Article]) -> list[Article]:
        best_by_key = {}
        order = []
        excerpts = []
        for art in sorted(articles, key=lambda item: item.verification_status != VERIFICATION_VERIFIED):
            excerpt = re.sub(r"\s+", "", art.source_excerpt or "")
            # Prefer verified evidence; otherwise curated entries precede raw duplicates.
            if len(excerpt) >= 20:
                if any(excerpt in previous or previous in excerpt for previous in excerpts):
                    continue
                excerpts.append(excerpt)
            fp = self._headline_fingerprint(art.headline)
            key = (art.section, fp or art.id)
            score = self._article_score(art)
            if key not in best_by_key:
                best_by_key[key] = art
                order.append(key)
                continue
            if score > self._article_score(best_by_key[key]):
                best_by_key[key] = art
        return [best_by_key[k] for k in order]

    def _limit_section_articles(self, articles: list[Article]) -> list[Article]:
        grouped = {section: [] for section in SECTION_ORDER}
        for art in articles:
            grouped.setdefault(art.section, []).append(art)
        limited = []
        for section in SECTION_ORDER:
            items = grouped.get(section, [])
            items = sorted(items, key=self._article_score, reverse=True)
            max_count = SECTION_TARGETS.get(section, {}).get("max", len(items))
            limited.extend(items[:max_count])
        return limited

    def _pick_lead(self, articles: list[Article]) -> tuple[Article | None, list[Article]]:
        if not articles:
            return None, []
        lead_candidates = [a for a in articles if a.section != "评论" and a.event_type != "opinion"]
        ranked = sorted(lead_candidates or articles, key=self._article_score, reverse=True)
        lead = ranked[0]
        remaining = [a for a in ranked if a != lead]
        remaining.extend(a for a in articles if a not in ranked)
        return lead, remaining

    def _build_sections(self, articles: list[Article]) -> dict:
        sections = {}
        for section_name in SECTION_ORDER:
            sections[section_name] = []
        for art in articles:
            sections.setdefault(art.section, []).append(asdict(art))
        return {name: items for name, items in sections.items() if items}

    def generate_issue(self, now: datetime | None = None, window_months: int = ISSUE_MONTH_SPAN) -> NewspaperIssue:
        if window_months != ISSUE_MONTH_SPAN:
            raise ValueError(
                f"季报固定为 {ISSUE_MONTH_SPAN} 个月窗口，收到 {window_months} 个月"
            )
        if now is None:
            now = datetime.now(TIMEZONE_CST)

        date = self.get_current_ming_date(now)
        abs_year, abs_month = self._real_to_ming(now)
        period = _build_period(abs_year, abs_month)

        timeline_articles = self.get_events_in_period(period.start_year, period.start_month)
        disaster_articles = self.get_disasters_in_period(period.start_year, period.start_month, period.end_year)
        all_articles = self._dedupe_articles(timeline_articles + disaster_articles)
        all_articles = self._limit_section_articles(all_articles)

        lead, remaining = self._pick_lead(all_articles)
        remaining = self._limit_section_articles(remaining)
        sections = self._build_sections(remaining)
        annual_events = self.get_annual_events(period)

        issue = NewspaperIssue(
            date=date,
            period=period,
            lead=lead,
            articles=remaining,
            sections=sections,
            annual_events=annual_events,
            editorial_note=(
                f"本报以 1 真实日对应 1 明朝季度，每期覆盖 3 个月，为一个季度。"
                f"本期对应 {period.start_label} 至 {period.end_label}。"
                f"{CALENDAR_NOTE}"
                f"未附史源的时间线条目列为待核记录；月份不详的年度条目仅在第四季度辑录中列出。"
            )
        )
        return issue

    def issue_to_json(self, issue: NewspaperIssue, pretty: bool = True) -> str:
        data = {
            "date": asdict(issue.date),
            "period": asdict(issue.period),
            "lead": asdict(issue.lead) if issue.lead else None,
            "articles": [asdict(a) for a in issue.articles],
            "sections": issue.sections,
            "annual_events": [asdict(a) for a in issue.annual_events],
            "editorial_note": issue.editorial_note,
        }
        indent = 2 if pretty else None
        return json.dumps(data, ensure_ascii=False, indent=indent)
