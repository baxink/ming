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

const CONTENT_TYPE_REPORT = "historical_report";
const CONTENT_TYPE_DIGEST = "historical_digest";
const CONTENT_TYPE_ANALYSIS = "historical_analysis";
const CONTENT_TYPE_OPINION = "opinion";

const TIME_PRECISION_MONTH = "month";
const TIME_PRECISION_YEAR = "year";
const TIME_PRECISION_RANGE = "range";
const TIME_PRECISION_UNKNOWN = "unknown";

const VERIFICATION_VERIFIED = "verified";
const VERIFICATION_NEEDS_REVIEW = "needs_review";

const CALENDAR_NOTE = "时段按明代历法月序（正月、二月……十二月）编组，未换算为公历日期。";

const MONTH_NAMES = {
  1: "正月", 2: "二月", 3: "三月", 4: "四月", 5: "五月", 6: "六月",
  7: "七月", 8: "八月", 9: "九月", 10: "十月", 11: "十一月", 12: "十二月",
};

// 十一月/十二月 must be matched before 一月/二月 so a substring is never read as a short month.
const MONTH_TOKENS = [
  [11, "十一月"], [12, "十二月"],
  [1, "正月"], [1, "一月"],
  [2, "二月"], [3, "三月"], [4, "四月"], [5, "五月"], [6, "六月"],
  [7, "七月"], [8, "八月"], [9, "九月"], [10, "十月"],
];

const MULTI_RECORD_RE = /[0-9]+\s*[.．](?=[^0-9])|[①②③④⑤⑥⑦⑧⑨⑩]/;
const DANGLING_SOURCE_RE = /[（(][^）)]*$|《[^》]*$/;

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
    calendar_note: CALENDAR_NOTE,
  };
}

function classifyEvent(event) {
  const specificSection = { examination: "科举文教", appointment: "人事任免", dismissal: "人事任免" }[event.event_type];
  if (specificSection) return specificSection;
  const category = event.category || "unknown";
  for (const [section, categories] of Object.entries(SECTION_MAP)) {
    if (categories.includes(category)) return section;
  }
  return "朝政要闻";
}

function monthName(month) {
  return MONTH_NAMES[month] || `${month}月`;
}

function sourceDate(year, month) {
  return month ? `${year}年${monthName(month)}` : `${year}年`;
}

function distinctMonths(text) {
  let work = String(text || "");
  const found = new Set();
  for (const [month, token] of MONTH_TOKENS) {
    if (work.includes(token)) {
      found.add(month);
      work = work.split(token).join(`\u0001${month}\u0001`);
    }
  }
  return found;
}

function countChar(text, char) {
  return text.split(char).length - 1;
}

function hasMultiRecordMarkers(text) {
  return MULTI_RECORD_RE.test(String(text || ""));
}

function hasDanglingSource(text) {
  const value = String(text || "");
  if (DANGLING_SOURCE_RE.test(value)) return true;
  return countChar(value, "（") !== countChar(value, "）")
    || countChar(value, "《") !== countChar(value, "》");
}

function completeSources(sources) {
  return Array.isArray(sources) && sources.length > 0 && sources.every((source) => typeof source === "string" && source.trim());
}

function sourceList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((source) => typeof source === "string").map((source) => source.trim()).filter(Boolean);
}

function disasterText(disaster) {
  // The `reign` field is deliberately excluded: it carries year text that would
  // otherwise smear records across quarters.
  return `${disaster.location || ""}${disaster.description || ""}`;
}

function disasterIsPrecise(disaster) {
  if (!completeSources(disaster.sources)) return false;
  const text = disasterText(disaster);
  if (hasMultiRecordMarkers(text) || hasDanglingSource(text) || !disasterHasCompleteDescription(disaster)) return false;
  return distinctMonths(text).size === 1;
}

function disasterHasCompleteDescription(disaster) {
  return /[。！？.!?）)]$/.test(String(disaster.description || "").trim());
}

const CITATION_RE = /[（(]《[^》]*》[^）)]*[）)]/;

// Verification must be asserted by the input, never inferred from a clean parse.
function explicitVerified(record) {
  if (String(record.verification_status || "").trim() !== VERIFICATION_VERIFIED) return false;
  if (!completeSources(record.sources)) return false;
  return typeof record.source_excerpt === "string" && Boolean(record.source_excerpt.trim());
}

function resolveSourceExcerpt(record, fallback = "") {
  const explicit = String(record.source_excerpt || "").trim();
  return explicit || String(fallback || "").trim();
}

function disasterRawExcerpt(disaster) {
  // Raw excerpt fallback: copied text only, never a verification signal.
  const desc = String(disaster.description || "");
  return desc.replace(/\s+/g, " ").trim().slice(0, 500);
}

function timelineArticle(event, timePrecision, editorialNote, verified, sources, sourceExcerpt) {
  const loc = event.location || {};
  const city = loc.city || "";
  const province = loc.province || "";
  const dateline = [city, province].filter(Boolean).join("、") || "京师";
  const title = String(event.title || "").trim();
  let desc = String(event.description || "").replace(/\s+/g, " ").trim();
  if (desc.length > 220) desc = `${desc.slice(0, 220).replace(/[，、；：,. ]+$/, "")}…`;
  const subhead = desc.length > 56 ? `${desc.slice(0, 56)}…` : desc;
  const causes = (event.causes || []).filter(Boolean).slice(0, 2);
  const consequences = (event.consequences || []).filter(Boolean).slice(0, 2);
  return {
    id: event.id || "",
    section: classifyEvent(event),
    headline: title,
    subhead,
    dateline: `${dateline} —`,
    byline: "",
    body: desc,
    event_type: event.event_type || "",
    severity: event.severity || "",
    location: `${province}${city}`,
    category: event.category || "",
    sources,
    source_date: sourceDate(event.year || 0, event.month || null),
    content_type: verified ? CONTENT_TYPE_REPORT : CONTENT_TYPE_DIGEST,
    time_precision: timePrecision,
    verification_status: verified ? VERIFICATION_VERIFIED : VERIFICATION_NEEDS_REVIEW,
    source_excerpt: sourceExcerpt,
    editorial_note: editorialNote,
    background: causes.join("、"),
    later_effects: consequences.join("、"),
  };
}

function eventToArticle(event) {
  const verified = explicitVerified(event);
  const sources = sourceList(event.sources);
  const sourceExcerpt = resolveSourceExcerpt(event, "");
  let editorialNote = verified
    ? `本条资料已显式标注为核验完成；月份为明代历法月序（${monthName(event.month)}），未作公历换算。`
    : `${sources.length ? "本条附有来源材料，仍列为待核记录；" : "本条取自原始时间线，未附史源与校订信息，列为待核记录；"}月份为明代历法月序（${monthName(event.month)}），未作公历换算。`;
  if (event.editorial_note) editorialNote = `${event.editorial_note} ${editorialNote}`;
  return timelineArticle(event, TIME_PRECISION_MONTH, editorialNote, verified, sources, sourceExcerpt);
}

function annualTimelineArticle(event) {
  const verified = explicitVerified(event);
  const statusNote = verified ? "资料已显式标注为核验完成。" : "资料仍待核验。";
  return timelineArticle(
    event,
    TIME_PRECISION_YEAR,
    `${event.editorial_note || ""} 原始记录仅系年、月份不详，未列入季度版面，改列年度辑录；未作公历换算。${statusNote}`.trim(),
    verified,
    sourceList(event.sources),
    resolveSourceExcerpt(event, ""),
  );
}

function cleanLocation(raw) {
  if (!raw) return "";
  const value = String(raw).split(/[：:]/)[0].replace(/[12]\.\s*/g, "").replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "").trim();
  return value.length > 30 ? `${value.slice(0, 30)}…` : value;
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
  const first = String(raw).split(/[：:]/)[0];
  if (!first) return "各地";
  const loc = first.replace(/[12]\.\s*/g, "").trim();
  return loc.length > 25 ? `${loc.slice(0, 25)}…` : loc;
}

function disasterToArticle(disaster, seq, month, precise) {
  const dtype = disaster.disaster_type || "灾异";
  const year = disaster.year || 0;
  const desc = cleanDisasterDesc(disaster.description || "");
  const location = extractDisasterLocation(disaster.location || "");
  const cleanLoc = cleanLocation(disaster.location || "");
  const sources = sourceList(disaster.sources);
  const sourceExcerpt = resolveSourceExcerpt(disaster, disasterRawExcerpt(disaster));
  const verified = precise && explicitVerified(disaster);

  const headline = cleanLoc ? `${cleanLoc}${dtype}` : `${dtype}报告`;
  const finalHeadline = headline.length > 30
    ? (cleanLoc ? `${dtype}：${cleanLoc.slice(0, 20)}` : `${dtype}报告`)
    : headline;

  let id;
  let contentType;
  let timePrecision;
  let verificationStatus;
  let editorialNote;
  if (precise) {
    id = `DIS_${year}_${month}_${seq}`;
    timePrecision = TIME_PRECISION_MONTH;
    if (verified) {
      contentType = CONTENT_TYPE_REPORT;
      verificationStatus = VERIFICATION_VERIFIED;
      editorialNote = `单一月份灾异记录，出处已显式核验（${sourceExcerpt}）；月份为明代历法月序（${monthName(month)}），未作公历换算。`;
    } else {
      contentType = CONTENT_TYPE_DIGEST;
      verificationStatus = VERIFICATION_NEEDS_REVIEW;
      const excerptNote = sourceExcerpt ? `原文摘录仅照录、未经核验（${sourceExcerpt}）` : "原始出处未附";
      editorialNote = `单一月份灾异记录，${excerptNote}，列为待核记录；月份为明代历法月序（${monthName(month)}），未作公历换算。`;
    }
  } else {
    id = `DIS_${year}_A${seq}`;
    contentType = CONTENT_TYPE_DIGEST;
    timePrecision = TIME_PRECISION_YEAR;
    verificationStatus = VERIFICATION_NEEDS_REVIEW;
    editorialNote = "本条未载明确月份，列入年度待核辑录，不推定具体季度；未作公历换算。";
  }

  return {
    id,
    section: "灾异志",
    headline: finalHeadline,
    subhead: "",
    dateline: location ? `${location} —` : "各地 —",
    byline: "",
    body: desc,
    event_type: "disaster",
    severity: /疫|灾|震|涝|旱/.test(dtype) ? "major" : "",
    location,
    category: "disaster",
    sources,
    source_date: `${year}年`,
    content_type: contentType,
    time_precision: timePrecision,
    verification_status: verificationStatus,
    source_excerpt: sourceExcerpt,
    editorial_note: editorialNote,
    background: "",
    later_effects: "",
  };
}

function eventsInPeriod(period, timeline, spanMonths = ISSUE_MONTH_SPAN) {
  if (spanMonths !== ISSUE_MONTH_SPAN) {
    throw new Error(`季报固定为 ${ISSUE_MONTH_SPAN} 个月窗口，收到 ${spanMonths} 个月`);
  }
  return timeline
    .filter((event) => {
      if (!event.month) return false;
      const diff = monthDiff(period.start_year, period.start_month, event.year || 0, event.month);
      return diff >= 0 && diff < ISSUE_MONTH_SPAN;
    })
    .map(eventToArticle);
}

function disastersInPeriod(period, disasters) {
  const result = [];
  let seq = 1;
  for (const disaster of disasters) {
    if (disaster.year !== period.start_year || !disasterIsPrecise(disaster)) continue;
    const months = [...distinctMonths(disasterText(disaster))];
    if (months.length !== 1) continue;
    const month = months[0];
    const diff = monthDiff(period.start_year, period.start_month, period.start_year, month);
    if (diff >= 0 && diff < ISSUE_MONTH_SPAN) {
      result.push(disasterToArticle(disaster, seq, month, true));
      seq += 1;
    }
  }
  return result.slice(0, 6);
}

function annualEvents(period, timeline, disasters) {
  if (Math.floor((period.start_month - 1) / ISSUE_MONTH_SPAN) + 1 !== 4) return [];
  const year = period.start_year;
  const events = [];
  for (const event of timeline) {
    if ((event.year || 0) === year && !event.month) events.push(annualTimelineArticle(event));
  }
  let seq = 1;
  for (const disaster of disasters) {
    if (disaster.year !== year || disasterIsPrecise(disaster)) continue;
    const text = disasterText(disaster);
    if (hasMultiRecordMarkers(text) || hasDanglingSource(text) || distinctMonths(text).size > 0 || !disasterHasCompleteDescription(disaster)) continue;
    events.push(disasterToArticle(disaster, seq, 0, false));
    seq += 1;
  }
  return events;
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
  const excerpts = [];
  for (const art of articles.slice().sort((a, b) => Number(a.verification_status !== VERIFICATION_VERIFIED) - Number(b.verification_status !== VERIFICATION_VERIFIED))) {
    const excerpt = String(art.source_excerpt || "").replace(/\s+/g, "");
    if (excerpt.length >= 20) {
      if (excerpts.some((previous) => excerpt.includes(previous) || previous.includes(excerpt))) continue;
      excerpts.push(excerpt);
    }
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
  let allArticles = dedupeArticles([...timelineArticles, ...disasterArticles]);
  allArticles = limitSectionArticles(allArticles);
  const [lead, remaining] = pickLead(allArticles);
  const articles = limitSectionArticles(remaining);
  const annual_events = annualEvents(period, historyData.timeline, historyData.disasters);
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
    annual_events,
    editorial_note: `本报以 1 真实日对应 1 明朝季度，每期覆盖 3 个月，为一个季度。本期对应 ${period.start_label} 至 ${period.end_label}。${CALENDAR_NOTE}未附史源的时间线条目列为待核记录；月份不详的年度条目仅在第四季度辑录中列出。`,
  };
}
