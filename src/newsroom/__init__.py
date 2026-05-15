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
    (1450, 1457, "景泰", "代宗朱祁钰"),
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


@dataclass
class NewspaperIssue:
    date: NewspaperDate
    period: PeriodMeta
    lead: Article | None = None
    articles: list = field(default_factory=list)
    sections: dict = field(default_factory=dict)
    editorial_note: str = ""


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
    )


def _classify_event(event: dict) -> str:
    category = event.get("category", "unknown")
    for section, cats in SECTION_MAP.items():
        if category in cats:
            return section
    return "朝政要闻"


def _format_source_date(year: int, month: int | None) -> str:
    if month:
        return f"{year}年{month}月"
    return f"{year}年"


def _month_name(month: int) -> str:
    names = {
        1: "正月", 2: "二月", 3: "三月", 4: "四月", 5: "五月", 6: "六月",
        7: "七月", 8: "八月", 9: "九月", 10: "十月", 11: "十一月", 12: "十二月",
    }
    return names.get(month, f"{month}月")


def _event_to_article(event: dict) -> Article:
    section = _classify_event(event)
    loc = event.get("location") or {}
    city = loc.get("city", "") if isinstance(loc, dict) else ""
    province = loc.get("province", "") if isinstance(loc, dict) else ""

    dateline_parts = [p for p in [city, province] if p]
    dateline = "、".join(dateline_parts) if dateline_parts else "京师"

    title = (event.get("title", "") or "").strip()
    desc = (event.get("description", "") or "").strip()
    desc = re.sub(r"\s+", " ", desc)
    if len(desc) > 180:
        desc = desc[:180].rstrip("，、；：,. ") + "。"
    subhead = desc[:56] + "…" if len(desc) > 56 else desc

    byline = ""
    persons = event.get("involved_persons", [])
    if persons:
        names = [p.get("name", "") for p in persons[:2] if p.get("name")]
        if names:
            byline = "、".join(names) + " 报道"

    event_month = event.get("month") or None
    causes = event.get("causes", []) or []
    consequences = event.get("consequences", []) or []
    sentences = [desc] if desc else []
    if causes:
        sentences.append(f"背景在于{'、'.join(causes[:2])}。")
    if consequences:
        sentences.append(f"其后续影响包括{'、'.join(consequences[:2])}。")
    body = "".join(sentences)[:260]
    if body and body[-1] not in "。！？":
        body += "。"

    return Article(
        id=event.get("id", ""),
        section=section,
        headline=title,
        subhead=subhead,
        dateline=f"{dateline} —",
        byline=byline,
        body=body,
        event_type=event.get("event_type", ""),
        severity=event.get("severity", ""),
        location=f"{province}{city}",
        category=event.get("category", ""),
        sources=event.get("sources", []),
        source_date=_format_source_date(event.get("year", 0), event_month),
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


def _disaster_to_article(disaster: dict, seq: int) -> Article:
    dtype = disaster.get("disaster_type", "灾异")
    year = disaster.get("year", 0)
    desc = _clean_disaster_desc(disaster.get("description", ""))
    location = _extract_disaster_location(disaster.get("location", ""))
    clean_loc = _clean_location(disaster.get("location", ""))

    headline = f"{clean_loc}{dtype}" if clean_loc else f"{dtype}报告"
    if len(headline) > 30:
        headline = f"{dtype}：{clean_loc[:20]}" if clean_loc else f"{dtype}报告"

    return Article(
        id=f"DIS_{year}_{seq}",
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
        sources=disaster.get("sources", []),
        source_date=f"{year}年",
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
        events = []
        if not self.timeline:
            return events

        for event in self.timeline:
            ey = event.get("year", 0)
            em = event.get("month") or 1
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
            dy = d.get("year", 0)
            if dy != start_year or not self._disaster_mentions_period(d, start_month):
                continue
            disasters.append(_disaster_to_article(d, seq))
            seq += 1

        return disasters[:6]

    def _disaster_mentions_period(self, disaster: dict, start_month: int) -> bool:
        text = f"{disaster.get('location', '')}{disaster.get('description', '')}{disaster.get('reign', '')}"
        return any(_month_name(m) in text for m in range(start_month, start_month + ISSUE_MONTH_SPAN))

    def get_background_articles(self, period: PeriodMeta, timeline_articles: list[Article]) -> list[Article]:
        articles = []
        if period.start_year == 1368 and period.start_month == 1:
            articles.extend([
                Article(
                    id="BG_1368_CAPITAL",
                    section="朝政要闻",
                    headline="新朝定都应天，南直隶成政治中枢",
                    subhead="本季度的开国大典把应天府推上全国政治舞台。",
                    dateline="应天府 —",
                    body="新朝以应天府为都城，围绕宫城、六部与中书省展开行政运转。对外仍需面对北方元廷残余，对内则要把战时政权转为常设朝廷。",
                    event_type="background",
                    severity="major",
                    location="南直隶应天府",
                    category="dynasty",
                    sources=["明朝制度资料", "明代大事年表"],
                    source_date=period.start_label,
                ),
                Article(
                    id="BG_1368_MILITARY",
                    section="边关军事",
                    headline="北伐仍在推进，新朝军事重心指向大都",
                    subhead="开国并不意味着战事结束，北方局势仍是朝廷首要压力。",
                    dateline="中原诸路 —",
                    body="徐达、常遇春等将领统率的北伐军事行动仍将决定新朝边界。此后数月，明军的推进将直接关系元廷是否还能维持中原统治。",
                    event_type="background",
                    severity="major",
                    location="中原、华北",
                    category="military",
                    sources=["明代大事年表", "明朝军事资料"],
                    source_date=period.start_label,
                ),
                Article(
                    id="BG_1368_INSTITUTION",
                    section="人事任免",
                    headline="李善长、徐达分掌文武，新朝班底成形",
                    subhead="开国人事安排显示朝廷仍依赖淮西功臣与军功集团。",
                    dateline="应天府 —",
                    body="朱元璋即位后，以李善长、徐达等人为核心安排中枢文武职务。新政权的最初秩序，建立在军功、幕府旧臣与开国礼制之间。",
                    event_type="background",
                    severity="",
                    location="南直隶应天府",
                    category="personnel",
                    sources=["明代大事年表"],
                    source_date=period.start_label,
                ),
            ])
        elif len(timeline_articles) < 3:
            ctx = self._era_context(period.start_year)
            articles.append(Article(
                id=f"BG_{period.start_year}_{period.start_month}_CONTEXT",
                section="朝政要闻",
                headline=f"本季朝政观察：{ctx['phase']}维持连续运转",
                subhead="季报按三个月周期组织政务、军务与地方风险。",
                dateline="京师 —",
                body=f"本期对应{period.start_label}至{period.end_label}。朝廷日常政务围绕{ctx['focus']}展开，军务上则需持续面对{ctx['military']}。季报以季度为单位呈现制度运行和地方反馈，让读者看到单条大事之外的政治节奏。",
                event_type="background",
                severity="",
                location="京师",
                category="dynasty",
                sources=["明代大事年表", "灾害通史资料"],
                source_date=f"{period.start_label}—{period.end_label}",
            ))
        return articles

    def _era_context(self, year: int) -> dict:
        if year <= 1398:
            return {
                "phase": "开国整饬期",
                "focus": "战后秩序、户籍赋役与军政制度仍在重建",
                "capital": "应天府",
                "military": "北方元廷残余与各地卫所建设仍牵动朝廷注意",
                "finance": "黄册、鱼鳞图册、里甲与赋役编审是财政秩序的基础工程",
                "education": "国子学、科举取士和礼制建设正在为新朝吸纳士人",
                "disaster": "战后人口流徙与垦复尚未稳定，地方灾伤容易牵动蠲免和赈济",
            }
        if year <= 1424:
            return {
                "phase": "靖难余波与永乐经营期",
                "focus": "迁都、北征、海运与文教修纂共同塑造新政治中心",
                "capital": "北京、南京",
                "military": "北边防务与远征调度是军政重心",
                "finance": "迁都营建、北征军需、漕运转输和匠役征发并行",
                "education": "翰林修撰、典籍编纂与科举取士服务于新政权叙事",
                "disaster": "大规模工程与转运压力下，水旱灾伤会直接影响粮运和工役",
            }
        if year <= 1505:
            return {
                "phase": "中期守成期",
                "focus": "科举官僚、边防财政与地方治理维持帝国常态运转",
                "capital": "京师",
                "military": "九边防务、漕运通道和地方卫所需要持续维持",
                "finance": "漕粮、盐课、屯田和地方存留是维持京师与边镇的财政支柱",
                "education": "会试、殿试与翰林院形成较稳定的官僚补给机制",
                "disaster": "地方灾异通常与赈济、蠲免和仓储调度一并考察",
            }
        if year <= 1572:
            return {
                "phase": "制度压力累积期",
                "focus": "财政、边防、宗藩和地方赋役压力逐渐抬升",
                "capital": "京师",
                "military": "北虏、倭患与地方兵备交织成长期压力",
                "finance": "白银流通、盐法、边饷和宗藩禄米逐步加重财政约束",
                "education": "科举规模扩大，士论、讲学与地方文教影响朝廷舆论",
                "disaster": "灾荒记录需与蠲免、赈济和地方赋役承受力合并判断",
            }
        if year <= 1620:
            return {
                "phase": "万历财政与边防压力期",
                "focus": "矿税、辽东、党争与财政调度不断牵动朝局",
                "capital": "京师",
                "military": "辽东边事、边饷与军镇供给成为关键议题",
                "finance": "矿税、加派、边饷和仓储亏空共同挤压地方财政",
                "education": "科场、书院和士大夫舆论逐渐卷入朝政分歧",
                "disaster": "灾伤若与赋役加派叠加，容易放大地方治理风险",
            }
        return {
            "phase": "晚明危局期",
            "focus": "财政枯竭、边患、灾荒与地方动荡相互叠加",
            "capital": "京师",
            "military": "辽东战事、流寇与军饷短缺压迫朝廷决策",
            "finance": "辽饷、练饷、剿饷、欠饷和地方征派构成财政危机主线",
            "education": "士人舆论、科道弹劾和党争影响政策执行与人事任免",
            "disaster": "小冰期背景下的旱蝗饥疫与流民问题常相互放大",
        }

    def _supplementary_articles(self, period: PeriodMeta, existing_sections: dict, target_count: int = 8) -> list[Article]:
        supplements = []
        missing_sections = [name for name in SECTION_ORDER if name not in existing_sections]
        ctx = self._era_context(period.start_year)
        section_templates = {
            "朝政要闻": (
                f"本季朝局：{ctx['phase']}持续推进政务整饬",
                f"{ctx['focus']}，朝廷围绕中枢号令与地方执行展开连续治理。",
                f"本期对应{period.start_label}至{period.end_label}。朝政线索集中在{ctx['focus']}；同时，{ctx['military']}。编辑部按季度梳理制度运行、军政压力与地方反馈，呈现这一阶段的政治节奏。",
                "dynasty",
                "background",
            ),
            "边关军事": (
                f"边防观察：{ctx['military']}",
                "军务栏目以季度为单位追踪边防、卫所和战事压力。",
                f"对{period.start_label}至{period.end_label}这一季而言，军事形势不只取决于单次战报，也取决于军粮、兵员、转运和地方卫所能否承受持续调度。{ctx['military']}，仍是朝廷必须反复评估的安全议题。",
                "military",
                "military",
            ),
            "经济民生": (
                f"{ctx['phase']}：赋役、仓储与漕运仍为民生命脉",
                f"{ctx['finance']}，构成本季民生报道的核心背景。",
                f"户部与地方州县仍需围绕田赋、漕粮、仓储和转输维持日常运作。对{period.start_label}至{period.end_label}这一时段而言，民生稳定不仅取决于收成，也取决于地方官能否把赋役、救济和运输安排在可承受范围内。{ctx['focus']}，财政栏目需持续观察具体征派和仓储记录。",
                "fiscal",
                "economy",
            ),
            "科举文教": (
                f"{ctx['phase']}下，取士与文教维系官僚秩序",
                f"{ctx['education']}，文教秩序为新一季政务提供官僚基础。",
                f"礼部、翰林院与地方学校共同维持文教秩序。随着{ctx['focus']}，朝廷仍需依靠稳定的科举与文书系统，把地方士人纳入可管理的官僚网络。",
                "examination",
                "education",
            ),
            "灾异志": (
                f"灾异观察：{ctx['phase']}的地方风险仍需留档",
                f"{ctx['disaster']}，灾异栏目按季度追踪地方风险。",
                f"灾异志栏目本期关注地方风险与财政承压之间的关系。灾荒、蠲免或赈济条目一旦出现，将与{ctx['finance']}等财政线索并置观察，避免把灾异孤立为单一地方事件。",
                "disaster",
                "disaster",
            ),
            "人事任免": (
                f"人事观察：{ctx['phase']}倚重官僚与军功班底",
                "人事任免反映朝廷如何把季度政务压力分派到中枢和地方。",
                f"在{period.start_label}至{period.end_label}这一季，官员升黜、差遣和文书责任构成政策落地的关键环节。{ctx['focus']}，朝廷必须依靠稳定的人事体系维持法令、赋役和军务的连续执行。",
                "personnel",
                "personnel",
            ),
        }
        for section in missing_sections:
            tpl = section_templates.get(section)
            if not tpl:
                continue
            headline, subhead, body, category, event_type = tpl
            supplements.append(Article(
                id=f"SUP_{period.start_year}_{period.start_month}_{section}",
                section=section,
                headline=headline,
                subhead=subhead,
                dateline=f"{ctx['capital']} —",
                body=body,
                event_type=event_type,
                severity="",
                location=ctx["capital"],
                category=category,
                sources=["明代制度资料", "明代大事年表"],
                source_date=f"{period.start_label}—{period.end_label}",
            ))

        if len(existing_sections) < 4 and len(supplements) < max(0, target_count - 1):
            supplements.append(Article(
                id=f"SUP_{period.start_year}_{period.start_month}_CONTEXT",
                section="朝政要闻",
                headline=f"时局综述：{ctx['phase']}进入本季议程",
                subhead=f"季报以三个月为观察单位，串联政务、军务、财政与地方风险。",
                dateline=f"{ctx['capital']} —",
                body=f"本期对应{period.start_label}至{period.end_label}。本季报道围绕{ctx['focus']}展开；同时，{ctx['military']}。在政务层面，{ctx['finance']}；在文教层面，{ctx['education']}。季报把单条史事、制度背景和地方风险放在同一季度内观察，呈现明朝政务运行的连续性。",
                event_type="background",
                severity="",
                location=ctx["capital"],
                category="dynasty",
                sources=["明代大事年表", "明代制度资料"],
                source_date=f"{period.start_label}—{period.end_label}",
            ))
        return supplements

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
        for art in articles:
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

    def _opinion_article(self, period: PeriodMeta, articles: list[Article]) -> Article:
        ctx = self._era_context(period.start_year)
        lead = next((a for a in articles if a.section != "评论" and a.event_type != "opinion"), None)
        focus_headline = lead.headline if lead else f"{ctx['phase']}政务"
        body = (
            f"本报社论认为，{period.start_label}至{period.end_label}这一季的关键，不只在于"
            f"“{focus_headline}”，更在于新朝能否把号令转化为可持续的制度。"
            f"{ctx['focus']}，朝廷若只重声威而轻户籍、赋役、仓储与学校，则政令虽出而地方难以承受。"
            f"军务上，{ctx['military']}；民生上，{ctx['finance']}。"
            f"因此，本季之治当以立法定制、安集民力为先，使开创之势不止于一时捷报，而能成为长久秩序。"
        )
        return Article(
            id=f"OP_{period.start_year}_{period.start_month}",
            section="评论",
            headline=f"社论：{ctx['phase']}贵在立制安民",
            subhead="本报评论本季政务轻重：立国之初，声威与制度须并行。",
            dateline="本报评论 —",
            byline="本报编辑部",
            body=body,
            event_type="opinion",
            severity="",
            location=ctx["capital"],
            category="commentary",
            sources=["明代制度资料", "明代大事年表"],
            source_date=f"{period.start_label}—{period.end_label}",
        )

    def _build_sections(self, articles: list[Article]) -> dict:
        sections = {}
        for section_name in SECTION_ORDER:
            sections[section_name] = []
        for art in articles:
            sections.setdefault(art.section, []).append(asdict(art))
        return {name: items for name, items in sections.items() if items}

    def generate_issue(self, now: datetime | None = None, window_months: int = ISSUE_MONTH_SPAN) -> NewspaperIssue:
        if now is None:
            now = datetime.now(TIMEZONE_CST)

        date = self.get_current_ming_date(now)
        abs_year, abs_month = self._real_to_ming(now)
        period = _build_period(abs_year, abs_month)

        timeline_articles = self.get_events_in_period(period.start_year, period.start_month, window_months)
        disaster_articles = self.get_disasters_in_period(period.start_year, period.start_month, period.end_year)
        background_articles = self.get_background_articles(period, timeline_articles)
        base_articles = self._dedupe_articles(timeline_articles + disaster_articles + background_articles)
        existing_sections = {article.section for article in base_articles}
        supplement_articles = self._supplementary_articles(period, existing_sections)
        all_articles = self._dedupe_articles(base_articles + supplement_articles)
        all_articles.append(self._opinion_article(period, all_articles))
        all_articles = self._limit_section_articles(all_articles)

        lead, remaining = self._pick_lead(all_articles)
        remaining = self._limit_section_articles(remaining)
        sections = self._build_sections(remaining)

        issue = NewspaperIssue(
            date=date,
            period=period,
            lead=lead,
            articles=remaining,
            sections=sections,
            editorial_note=(
                f"本报以 1 真实日对应 1 明朝季度，每期覆盖 3 个月，为一个季度。"
                f"本期对应 {period.start_label} 至 {period.end_label}。"
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
            "editorial_note": issue.editorial_note,
        }
        indent = 2 if pretty else None
        return json.dumps(data, ensure_ascii=False, indent=indent)
