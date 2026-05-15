const TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const EPOCH_DATE = "2026-05-15";
const EPOCH_MING_YEAR = 1368;
const EPOCH_MING_MONTH = 1;
const MING_END_YEAR = 1644;
const MING_END_MONTH = 4;
const MONTHS_PER_REAL_DAY = 3;
const ISSUE_MONTH_SPAN = 3;

const REIGN_PERIODS = [
  [1368, 1398, "洪武", "太祖朱元璋"],
  [1399, 1402, "建文", "惠宗朱允炆"],
  [1403, 1424, "永乐", "成祖朱棣"],
  [1425, 1425, "洪熙", "仁宗朱高炽"],
  [1426, 1435, "宣德", "宣宗朱瞻基"],
  [1436, 1449, "正统", "英宗朱祁镇"],
  [1450, 1457, "景泰", "代宗朱祁钰"],
  [1457, 1464, "天顺", "英宗朱祁镇"],
  [1465, 1487, "成化", "宪宗朱见深"],
  [1488, 1505, "弘治", "孝宗朱祐樘"],
  [1506, 1521, "正德", "武宗朱厚照"],
  [1522, 1566, "嘉靖", "世宗朱厚熜"],
  [1567, 1572, "隆庆", "穆宗朱载坖"],
  [1573, 1620, "万历", "神宗朱翊钧"],
  [1621, 1627, "天启", "熹宗朱由校"],
  [1628, 1644, "崇祯", "思宗朱由检"],
];

const SECTION_MAP = {
  "朝政要闻": ["dynasty", "institutional", "political", "political_purge", "court_purge", "imperial_ritual", "policy_reform", "policy_enactment", "palace", "diplomatic"],
  "边关军事": ["military", "battle", "rebellion", "border", "foreign", "wokou"],
  "经济民生": ["fiscal", "fiscal_reform", "economy", "economic", "taxation", "grain", "water_conservancy", "agriculture", "infrastructure"],
  "科举文教": ["examination", "culture", "cultural", "academy", "art", "literature"],
  "灾异志": ["disaster", "natural_disaster"],
  "人事任免": ["personnel", "appointment", "dismissal"],
  "评论": ["commentary"],
};

const SECTION_ORDER = ["朝政要闻", "边关军事", "经济民生", "科举文教", "灾异志", "人事任免", "评论"];
const SECTION_TARGETS = {
  "朝政要闻": { max: 3 },
  "边关军事": { max: 2 },
  "经济民生": { max: 2 },
  "科举文教": { max: 2 },
  "灾异志": { max: 2 },
  "人事任免": { max: 2 },
  "评论": { max: 1 },
};

function parseRealDate(dateString) {
  const source = dateString || new Date(Date.now() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) throw new Error(`Invalid date: ${source}`);
  const date = { label: source, year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const normalized = new Date(Date.UTC(date.year, date.month - 1, date.day)).toISOString().slice(0, 10);
  if (normalized !== source) throw new Error(`Invalid date: ${source}`);
  return date;
}

function dateToUtcDay(date) {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86400000);
}

function getReignData(year) {
  const reign = REIGN_PERIODS.find(([start, end]) => start <= year && year <= end);
  if (!reign) return ["明朝", year, ""];
  return [reign[2], year - reign[0] + 1, reign[3]];
}

function clampMonth(year, month) {
  if (year > MING_END_YEAR || (year === MING_END_YEAR && month > MING_END_MONTH)) {
    return [MING_END_YEAR, MING_END_MONTH];
  }
  return [year, month];
}

function realToMing(date) {
  const elapsedDays = Math.max(0, dateToUtcDay(date) - dateToUtcDay(parseRealDate(EPOCH_DATE)));
  const totalMonths = elapsedDays * MONTHS_PER_REAL_DAY;
  let year = EPOCH_MING_YEAR + Math.floor(totalMonths / 12);
  let month = EPOCH_MING_MONTH + (totalMonths % 12);
  if (month > 12) {
    year += 1;
    month -= 12;
  }
  return clampMonth(year, month);
}

function seasonForMonth(month) {
  if (month <= 3) return "春";
  if (month <= 6) return "夏";
  if (month <= 9) return "秋";
  return "冬";
}

function formatRealDate(date) {
  return `${date.year}年${String(date.month).padStart(2, "0")}月${String(date.day).padStart(2, "0")}日`;
}

function formatMingLabel(year, month) {
  const [title, reignYear] = getReignData(year);
  return `${title}${reignYear}年${month}月`;
}

function monthKey(year, month) {
  return year * 12 + month;
}

function monthDiff(startYear, startMonth, year, month) {
  return monthKey(year, month) - monthKey(startYear, startMonth);
}

function advanceMonth(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return clampMonth(Math.floor(total / 12), (total % 12) + 1);
}

function buildPeriod(year, month) {
  const quarterIndex = Math.floor((month - 1) / ISSUE_MONTH_SPAN) + 1;
  const [endYear, endMonth] = advanceMonth(year, month, ISSUE_MONTH_SPAN - 1);
  const issueNumber = Math.floor(((year - EPOCH_MING_YEAR) * 12 + (month - EPOCH_MING_MONTH)) / ISSUE_MONTH_SPAN) + 1;
  const [reignTitle, reignYear] = getReignData(year);
  return {
    issue_number: issueNumber,
    label: `${reignTitle}${reignYear}年第${quarterIndex}季度`,
    start_label: formatMingLabel(year, month),
    end_label: formatMingLabel(endYear, endMonth),
    start_year: year,
    start_month: month,
    end_year: endYear,
    end_month: endMonth,
  };
}

function classifyEvent(event) {
  const category = event.category || "unknown";
  for (const [section, categories] of Object.entries(SECTION_MAP)) {
    if (categories.includes(category)) return section;
  }
  return "朝政要闻";
}

function sourceDate(year, month) {
  return month ? `${year}年${month}月` : `${year}年`;
}

function monthName(month) {
  return ["", "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"][month] || `${month}月`;
}

function eventToArticle(event) {
  const loc = event.location || {};
  const city = loc.city || "";
  const province = loc.province || "";
  const dateline = [city, province].filter(Boolean).join("、") || "京师";
  let desc = String(event.description || "").replace(/\s+/g, " ").trim();
  if (desc.length > 180) desc = `${desc.slice(0, 180).replace(/[，、；：,. ]+$/, "")}。`;
  const names = (event.involved_persons || []).slice(0, 2).map((p) => p.name).filter(Boolean);
  const sentences = desc ? [desc] : [];
  if (event.causes?.length) sentences.push(`背景在于${event.causes.slice(0, 2).join("、")}。`);
  if (event.consequences?.length) sentences.push(`其后续影响包括${event.consequences.slice(0, 2).join("、")}。`);
  let body = sentences.join("").slice(0, 260);
  if (body && !"。！？".includes(body.at(-1))) body += "。";
  return {
    id: event.id || "",
    section: classifyEvent(event),
    headline: String(event.title || "").trim(),
    subhead: desc.length > 56 ? `${desc.slice(0, 56)}…` : desc,
    dateline: `${dateline} —`,
    byline: names.length ? `${names.join("、")} 报道` : "",
    body,
    event_type: event.event_type || "",
    severity: event.severity || "",
    location: `${province}${city}`,
    category: event.category || "",
    sources: event.sources || [],
    source_date: sourceDate(event.year || 0, event.month || null),
  };
}

function cleanLocation(raw) {
  if (!raw) return "";
  return String(raw).split(/[：:]/)[0].replace(/[12]\.\s*/g, "").replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "").trim().slice(0, 30);
}

function cleanDisasterDesc(raw) {
  const desc = String(raw || "")
    .replace(/[12]\.\d*\.?\s*/g, "")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "")
    .replace(/（[^）]*《[^》]*》[^）]*）/g, "")
    .replace(/（《[^。！？]*$/g, "")
    .trim();
  return desc.length > 220 ? `${desc.slice(0, 220)}…` : desc;
}

function extractDisasterLocation(raw) {
  if (!raw) return "各地";
  const loc = String(raw).split(/[：:]/)[0].replace(/[12]\.\s*/g, "").trim();
  return loc.length > 25 ? `${loc.slice(0, 25)}…` : loc;
}

function disasterToArticle(disaster, seq) {
  const dtype = disaster.disaster_type || "灾异";
  const location = extractDisasterLocation(disaster.location || "");
  const cleanLoc = cleanLocation(disaster.location || "");
  const headline = cleanLoc ? `${cleanLoc}${dtype}` : `${dtype}报告`;
  return {
    id: `DIS_${disaster.year}_${seq}`,
    section: "灾异志",
    headline: headline.length > 30 ? `${dtype}：${cleanLoc.slice(0, 20)}` : headline,
    subhead: "",
    dateline: `${location} —`,
    byline: "",
    body: cleanDisasterDesc(disaster.description || ""),
    event_type: "disaster",
    severity: /疫|灾|震|涝|旱/.test(dtype) ? "major" : "",
    location,
    category: "disaster",
    sources: disaster.sources || [],
    source_date: `${disaster.year || 0}年`,
  };
}

function eraContext(year) {
  if (year <= 1398) return {
    phase: "开国整饬期",
    focus: "战后秩序、户籍赋役与军政制度仍在重建",
    capital: "应天府",
    military: "北方元廷残余与各地卫所建设仍牵动朝廷注意",
    finance: "黄册、鱼鳞图册、里甲与赋役编审是财政秩序的基础工程",
    education: "国子学、科举取士和礼制建设正在为新朝吸纳士人",
    disaster: "战后人口流徙与垦复尚未稳定，地方灾伤容易牵动蠲免和赈济",
  };
  if (year <= 1424) return {
    phase: "靖难余波与永乐经营期",
    focus: "迁都、北征、海运与文教修纂共同塑造新政治中心",
    capital: "北京、南京",
    military: "北边防务与远征调度是军政重心",
    finance: "迁都营建、北征军需、漕运转输和匠役征发并行",
    education: "翰林修撰、典籍编纂与科举取士服务于新政权叙事",
    disaster: "大规模工程与转运压力下，水旱灾伤会直接影响粮运和工役",
  };
  if (year <= 1505) return {
    phase: "中期守成期",
    focus: "科举官僚、边防财政与地方治理维持帝国常态运转",
    capital: "京师",
    military: "九边防务、漕运通道和地方卫所需要持续维持",
    finance: "漕粮、盐课、屯田和地方存留是维持京师与边镇的财政支柱",
    education: "会试、殿试与翰林院形成较稳定的官僚补给机制",
    disaster: "地方灾异通常与赈济、蠲免和仓储调度一并考察",
  };
  if (year <= 1572) return {
    phase: "制度压力累积期",
    focus: "财政、边防、宗藩和地方赋役压力逐渐抬升",
    capital: "京师",
    military: "北虏、倭患与地方兵备交织成长期压力",
    finance: "白银流通、盐法、边饷和宗藩禄米逐步加重财政约束",
    education: "科举规模扩大，士论、讲学与地方文教影响朝廷舆论",
    disaster: "灾荒记录需与蠲免、赈济和地方赋役承受力合并判断",
  };
  if (year <= 1620) return {
    phase: "万历财政与边防压力期",
    focus: "矿税、辽东、党争与财政调度不断牵动朝局",
    capital: "京师",
    military: "辽东边事、边饷与军镇供给成为关键议题",
    finance: "矿税、加派、边饷和仓储亏空共同挤压地方财政",
    education: "科场、书院和士大夫舆论逐渐卷入朝政分歧",
    disaster: "灾伤若与赋役加派叠加，容易放大地方治理风险",
  };
  return {
    phase: "晚明危局期",
    focus: "财政枯竭、边患、灾荒与地方动荡相互叠加",
    capital: "京师",
    military: "辽东战事、流寇与军饷短缺压迫朝廷决策",
    finance: "辽饷、练饷、剿饷、欠饷和地方征派构成财政危机主线",
    education: "士人舆论、科道弹劾和党争影响政策执行与人事任免",
    disaster: "小冰期背景下的旱蝗饥疫与流民问题常相互放大",
  };
}

function eventsInPeriod(period, timeline) {
  return timeline
    .filter((event) => {
      const em = event.month || 1;
      return monthDiff(period.start_year, period.start_month, event.year || 0, em) >= 0
        && monthDiff(period.start_year, period.start_month, event.year || 0, em) < ISSUE_MONTH_SPAN;
    })
    .map(eventToArticle);
}

function disasterMentionsPeriod(disaster, startMonth) {
  const text = `${disaster.location || ""}${disaster.description || ""}${disaster.reign || ""}`;
  return [0, 1, 2].some((offset) => text.includes(monthName(startMonth + offset)));
}

function disastersInPeriod(period, disasters) {
  let seq = 1;
  return disasters
    .filter((disaster) => disaster.year === period.start_year && disasterMentionsPeriod(disaster, period.start_month))
    .slice(0, 6)
    .map((disaster) => disasterToArticle(disaster, seq++));
}

function backgroundArticles(period, timelineArticles) {
  const ctx = eraContext(period.start_year);
  if (period.start_year === 1368 && period.start_month === 1) {
    return [
      article("BG_1368_CAPITAL", "朝政要闻", "新朝定都应天，南直隶成政治中枢", "本季度的开国大典把应天府推上全国政治舞台。", "应天府 —", "新朝以应天府为都城，围绕宫城、六部与中书省展开行政运转。对外仍需面对北方元廷残余，对内则要把战时政权转为常设朝廷。", "background", "major", "南直隶应天府", "dynasty", ["明朝制度资料", "明代大事年表"], period.start_label),
      article("BG_1368_MILITARY", "边关军事", "北伐仍在推进，新朝军事重心指向大都", "开国并不意味着战事结束，北方局势仍是朝廷首要压力。", "中原诸路 —", "徐达、常遇春等将领统率的北伐军事行动仍将决定新朝边界。此后数月，明军的推进将直接关系元廷是否还能维持中原统治。", "background", "major", "中原、华北", "military", ["明代大事年表", "明朝军事资料"], period.start_label),
      article("BG_1368_INSTITUTION", "人事任免", "李善长、徐达分掌文武，新朝班底成形", "开国人事安排显示朝廷仍依赖淮西功臣与军功集团。", "应天府 —", "朱元璋即位后，以李善长、徐达等人为核心安排中枢文武职务。新政权的最初秩序，建立在军功、幕府旧臣与开国礼制之间。", "background", "", "南直隶应天府", "personnel", ["明代大事年表"], period.start_label),
    ];
  }
  if (timelineArticles.length >= 3) return [];
  return [
    article(`BG_${period.start_year}_${period.start_month}_CONTEXT`, "朝政要闻", `本季朝政观察：${ctx.phase}维持连续运转`, "季报按三个月周期组织政务、军务与地方风险。", "京师 —", `本期对应${period.start_label}至${period.end_label}。朝廷日常政务围绕${ctx.focus}展开，军务上则需持续面对${ctx.military}。季报以季度为单位呈现制度运行和地方反馈，让读者看到单条大事之外的政治节奏。`, "background", "", "京师", "dynasty", ["明代大事年表", "灾害通史资料"], `${period.start_label}—${period.end_label}`),
  ];
}

function article(id, section, headline, subhead, dateline, body, eventType, severity, location, category, sources, srcDate) {
  return { id, section, headline, subhead, dateline, byline: "", body, event_type: eventType, severity, location, category, sources, source_date: srcDate };
}

function opinion(id, section, headline, subhead, dateline, body, eventType, severity, location, category, sources, srcDate) {
  return { id, section, headline, subhead, dateline, byline: "本报编辑部", body, event_type: eventType, severity, location, category, sources, source_date: srcDate };
}

function supplementaryArticles(period, existingSections) {
  const ctx = eraContext(period.start_year);
  const templates = {
    "朝政要闻": [`本季朝局：${ctx.phase}持续推进政务整饬`, `${ctx.focus}，朝廷围绕中枢号令与地方执行展开连续治理。`, `本期对应${period.start_label}至${period.end_label}。朝政线索集中在${ctx.focus}；同时，${ctx.military}。编辑部按季度梳理制度运行、军政压力与地方反馈，呈现这一阶段的政治节奏。`, "dynasty", "background"],
    "边关军事": [`边防观察：${ctx.military}`, "军务栏目以季度为单位追踪边防、卫所和战事压力。", `对${period.start_label}至${period.end_label}这一季而言，军事形势不只取决于单次战报，也取决于军粮、兵员、转运和地方卫所能否承受持续调度。${ctx.military}，仍是朝廷必须反复评估的安全议题。`, "military", "military"],
    "经济民生": [`${ctx.phase}：赋役、仓储与漕运仍为民生命脉`, `${ctx.finance}，构成本季民生报道的核心背景。`, `户部与地方州县仍需围绕田赋、漕粮、仓储和转输维持日常运作。对${period.start_label}至${period.end_label}这一时段而言，民生稳定不仅取决于收成，也取决于地方官能否把赋役、救济和运输安排在可承受范围内。${ctx.focus}，财政栏目需持续观察具体征派和仓储记录。`, "fiscal", "economy"],
    "科举文教": [`${ctx.phase}下，取士与文教维系官僚秩序`, `${ctx.education}，文教秩序为新一季政务提供官僚基础。`, `礼部、翰林院与地方学校共同维持文教秩序。随着${ctx.focus}，朝廷仍需依靠稳定的科举与文书系统，把地方士人纳入可管理的官僚网络。`, "examination", "education"],
    "灾异志": [`灾异观察：${ctx.phase}的地方风险仍需留档`, `${ctx.disaster}，灾异栏目按季度追踪地方风险。`, `灾异志栏目本期关注地方风险与财政承压之间的关系。灾荒、蠲免或赈济条目一旦出现，将与${ctx.finance}等财政线索并置观察，避免把灾异孤立为单一地方事件。`, "disaster", "disaster"],
    "人事任免": [`人事观察：${ctx.phase}倚重官僚与军功班底`, "人事任免反映朝廷如何把季度政务压力分派到中枢和地方。", `在${period.start_label}至${period.end_label}这一季，官员升黜、差遣和文书责任构成政策落地的关键环节。${ctx.focus}，朝廷必须依靠稳定的人事体系维持法令、赋役和军务的连续执行。`, "personnel", "personnel"],
  };
  const result = [];
  for (const section of SECTION_ORDER) {
    if (existingSections.has(section) || !templates[section]) continue;
    const [headline, subhead, body, category, eventType] = templates[section];
    result.push(article(`SUP_${period.start_year}_${period.start_month}_${section}`, section, headline, subhead, `${ctx.capital} —`, body, eventType, "", ctx.capital, category, ["明代制度资料", "明代大事年表"], `${period.start_label}—${period.end_label}`));
  }
  if (existingSections.size < 4 && result.length < 7) {
    result.push(article(`SUP_${period.start_year}_${period.start_month}_CONTEXT`, "朝政要闻", `时局综述：${ctx.phase}进入本季议程`, "季报以三个月为观察单位，串联政务、军务、财政与地方风险。", `${ctx.capital} —`, `本期对应${period.start_label}至${period.end_label}。本季报道围绕${ctx.focus}展开；同时，${ctx.military}。在政务层面，${ctx.finance}；在文教层面，${ctx.education}。季报把单条史事、制度背景和地方风险放在同一季度内观察，呈现明朝政务运行的连续性。`, "background", "", ctx.capital, "dynasty", ["明代大事年表", "明代制度资料"], `${period.start_label}—${period.end_label}`));
  }
  return result;
}

function headlineFingerprint(text) {
  return String(text || "").replace(/[：:，、。；！？\s]/g, "").slice(0, 18);
}

function articleScore(art) {
  const severity = { critical: 100, major: 70, "": 20 }[art.severity] ?? 30;
  const bias = { "朝政要闻": 30, "边关军事": 24, "经济民生": 22, "科举文教": 18, "灾异志": 20, "人事任免": 16 }[art.section] ?? 10;
  let score = severity + bias + Math.min(Math.floor(String(art.body || "").length / 20), 12);
  if (art.byline) score += 6;
  if (art.source_date) score += 4;
  if (art.event_type === "background") score -= 10;
  if (art.event_type === "opinion") score -= 1000;
  return score;
}

function dedupeArticles(articles) {
  const best = new Map();
  const order = [];
  for (const art of articles) {
    const key = `${art.section}:${headlineFingerprint(art.headline) || art.id}`;
    if (!best.has(key)) order.push(key);
    if (!best.has(key) || articleScore(art) > articleScore(best.get(key))) best.set(key, art);
  }
  return order.map((key) => best.get(key));
}

function limitSectionArticles(articles) {
  const grouped = new Map(SECTION_ORDER.map((section) => [section, []]));
  for (const art of articles) grouped.get(art.section)?.push(art);
  return SECTION_ORDER.flatMap((section) => {
    const max = SECTION_TARGETS[section]?.max ?? Infinity;
    return (grouped.get(section) || []).sort((a, b) => articleScore(b) - articleScore(a)).slice(0, max);
  });
}

function opinionArticle(period, articles) {
  const ctx = eraContext(period.start_year);
  const lead = articles.find((art) => art.section !== "评论" && art.event_type !== "opinion");
  const focus = lead?.headline || `${ctx.phase}政务`;
  return opinion(
    `OP_${period.start_year}_${period.start_month}`,
    "评论",
    `社论：${ctx.phase}贵在立制安民`,
    "本报评论本季政务轻重：立国之初，声威与制度须并行。",
    "本报评论 —",
    `本报社论认为，${period.start_label}至${period.end_label}这一季的关键，不只在于“${focus}”，更在于新朝能否把号令转化为可持续的制度。${ctx.focus}，朝廷若只重声威而轻户籍、赋役、仓储与学校，则政令虽出而地方难以承受。军务上，${ctx.military}；民生上，${ctx.finance}。因此，本季之治当以立法定制、安集民力为先，使开创之势不止于一时捷报，而能成为长久秩序。`,
    "opinion",
    "",
    ctx.capital,
    "commentary",
    ["明代制度资料", "明代大事年表"],
    `${period.start_label}—${period.end_label}`,
  );
}

function pickLead(articles) {
  const candidates = articles.filter((art) => art.section !== "评论" && art.event_type !== "opinion");
  const ranked = (candidates.length ? candidates : articles).slice().sort((a, b) => articleScore(b) - articleScore(a));
  const lead = ranked[0] || null;
  return [lead, articles.filter((art) => art !== lead)];
}

function buildSections(articles) {
  const sections = {};
  for (const section of SECTION_ORDER) sections[section] = [];
  for (const art of articles) sections[art.section]?.push(art);
  return Object.fromEntries(Object.entries(sections).filter(([, items]) => items.length));
}

export function generateIssue(dateString, historyData) {
  if (!historyData?.timeline || !historyData?.disasters) {
    throw new Error("History data unavailable");
  }
  const realDate = parseRealDate(dateString);
  const [year, month] = realToMing(realDate);
  const [reignTitle, reignYear, emperor] = getReignData(year);
  const period = buildPeriod(year, month);
  const timelineArticles = eventsInPeriod(period, historyData.timeline);
  const disasterArticles = disastersInPeriod(period, historyData.disasters);
  const base = dedupeArticles([...timelineArticles, ...disasterArticles, ...backgroundArticles(period, timelineArticles)]);
  const existingSections = new Set(base.map((art) => art.section));
  let allArticles = dedupeArticles([...base, ...supplementaryArticles(period, existingSections)]);
  allArticles.push(opinionArticle(period, allArticles));
  allArticles = limitSectionArticles(allArticles);
  const [lead, remaining] = pickLead(allArticles);
  const articles = limitSectionArticles(remaining);
  return {
    date: {
      real_date: formatRealDate(realDate),
      ming_reign: reignTitle,
      ming_year: reignYear,
      ming_month: month,
      emperor,
      season: seasonForMonth(month),
    },
    period,
    lead,
    articles,
    sections: buildSections(articles),
    editorial_note: `本报以 1 真实日对应 1 明朝季度，每期覆盖 3 个月，为一个季度。本期对应 ${period.start_label} 至 ${period.end_label}。`,
  };
}
