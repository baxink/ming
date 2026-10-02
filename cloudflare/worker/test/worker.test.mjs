import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.js";

const processedTimeline = JSON.parse(
  readFileSync(new URL("../../../data/processed/timeline/ming_timeline.json", import.meta.url), "utf8"),
);
const processedDisasters = JSON.parse(
  readFileSync(new URL("../../../data/processed/timeline/ming_disasters.json", import.meta.url), "utf8"),
);

const CACHE_VERSION = "v5";
const ARTICLE_METADATA_FIELDS = [
  "content_type",
  "time_precision",
  "verification_status",
  "source_excerpt",
  "editorial_note",
  "background",
  "later_effects",
];
const CONTENT_TYPES = ["historical_report", "historical_digest", "historical_analysis", "opinion"];
const TIME_PRECISIONS = ["month", "year", "range", "unknown"];
const VERIFICATION_STATUSES = ["verified", "needs_review"];

const ZHU_SOURCE = "明太祖实录·卷一";
const DADU_SOURCE = "明史·太祖本纪";
const JINGSHI_SOURCE = "明太祖实录·卷四十";

async function readJson(response) {
  return JSON.parse(await response.text());
}

function makeKv(initial = {}) {
  const calls = { get: [], put: [] };
  const values = new Map(Object.entries(initial));
  return {
    calls,
    async get(key, type) {
      calls.get.push({ key, type });
      const value = values.get(key);
      if (!value) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      calls.put.push({ key, value });
      values.set(key, value);
    },
  };
}

function makeOpenAiFetch({ body, status = 200, calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

function makeWorkersAiRun({ body, calls = [] } = {}) {
  return async (model, input = {}) => {
    calls.push({ model, input });
    return body;
  };
}

// Real source dataset loaded from disk. Even sourced curated entries are still
// awaiting primary-source verification, so the generator must keep them as
// historical_digest/needs_review and never let the AI use them as evidence.
function makeEnv(initial = {}) {
  return {
    ISSUE_CACHE: makeKv({
      "data:v1:ming:timeline": JSON.stringify(processedTimeline),
      "data:v1:ming:disasters": JSON.stringify(processedDisasters),
      ...initial,
    }),
  };
}

// Synthetic fixtures used only to exercise provider parsing, caching and the
// AI creation path. They are NOT the real dataset and must never be presented
// as real historical verification.
//
// The generator only promotes a record to historical_report/verified when the
// input explicitly asserts verification_status:"verified" plus non-empty
// sources and source_excerpt. The two timeline records below carry that
// explicit synthetic assertion so the AI mocks that quote 朱元璋称帝 and
// 明军攻占大都 still resolve to a verified evidence fact.
function syntheticTimeline(verified = true) {
  const entries = [
    {
      id: "SYN_1368_01",
      year: 1368,
      month: 1,
      reign: "洪武",
      reign_year: 1,
      title: "朱元璋称帝，建元洪武",
      description: "正月，朱元璋在应天府即皇帝位，国号大明，建元洪武。",
      event_type: "imperial_ritual",
      scope: "national",
      severity: "critical",
      location: { province: "南直隶", city: "应天府" },
      involved_persons: [{ name: "朱元璋", role: "皇帝" }],
      causes: ["元末农民起义", "北伐灭元"],
      consequences: ["明朝建立"],
      category: "dynasty",
      sources: [ZHU_SOURCE],
      source_excerpt: "洪武元年正月，朱元璋即皇帝位，国号大明，建元洪武。",
      verification_status: "verified",
    },
    {
      id: "SYN_1368_08",
      year: 1368,
      month: 8,
      reign: "洪武",
      reign_year: 1,
      title: "明军攻占大都，元朝灭亡",
      description: "八月，徐达率军攻入元大都，元顺帝北逃上都。",
      event_type: "battle",
      scope: "national",
      severity: "critical",
      location: { province: "北直隶", city: "大都" },
      causes: ["北伐灭元"],
      consequences: ["元朝灭亡", "北元残余势力存续"],
      category: "military",
      sources: [DADU_SOURCE],
      source_excerpt: "洪武元年八月，徐达入大都，元帝北遁。",
      verification_status: "verified",
    },
    {
      id: "SYN_1368_AN",
      year: 1368,
      month: null,
      reign: "洪武",
      reign_year: 1,
      title: "颁行大明律，月份不详",
      description: "诏颁大明律，其月份史载不详。",
      event_type: "policy_enactment",
      scope: "national",
      severity: "major",
      location: { province: "南直隶", city: "应天府" },
      causes: ["开国立法"],
      consequences: ["明代律令体系确立"],
      category: "institutional",
    },
  ];
  if (verified) return entries;
  // Keep sources/source_excerpt but drop the explicit verification assertion:
  // a clean, sourced record is still pending, not verified.
  return entries.map((entry) => {
    const next = { ...entry };
    delete next.verification_status;
    return next;
  });
}

// Clean single-month, explicitly verified synthetic disaster for the
// 京师灾异 case. Disasters derive their source_excerpt from `sources` when no
// explicit excerpt is honored, so this is a second independent AI fact.
const SYNTHETIC_VERIFIED_DISASTER = {
  year: 1369,
  reign: "明太祖洪武二年（1369年）",
  disaster_type: "旱灾",
  location: "京师（今江苏南京）",
  modern_location: "",
  description: "正月丁酉，以春久不雨，告祭于风云雷雨岳镇海渎山川城隍旗纛诸神。",
  sources: [JINGSHI_SOURCE],
  verification_status: "verified",
  source_excerpt: "洪武二年正月，以春久不雨，告祭于风云雷雨岳镇海渎山川城隍旗纛诸神。",
};

function syntheticDisaster(verified = true) {
  if (verified) return { ...SYNTHETIC_VERIFIED_DISASTER };
  // Precise, fully sourced, but without the explicit verification assertion.
  const next = { ...SYNTHETIC_VERIFIED_DISASTER };
  delete next.verification_status;
  return next;
}

function makeVerifiedEnv(initial = {}) {
  return {
    ISSUE_CACHE: makeKv({
      "data:v1:ming:timeline": JSON.stringify(syntheticTimeline(true)),
      "data:v1:ming:disasters": JSON.stringify([syntheticDisaster(true)]),
      ...initial,
    }),
  };
}

function makeUnverifiedEnv(initial = {}) {
  return {
    ISSUE_CACHE: makeKv({
      "data:v1:ming:timeline": JSON.stringify(syntheticTimeline(false)),
      "data:v1:ming:disasters": JSON.stringify([syntheticDisaster(false)]),
      ...initial,
    }),
  };
}

function assertArticleMetadata(article) {
  assert.ok(article && typeof article === "object", "expected an article object");
  for (const field of ARTICLE_METADATA_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(article, field),
      `article ${article.id} is missing ${field}`,
    );
  }
  assert.ok(Array.isArray(article.sources), `article ${article.id} sources must be an array`);
  assert.ok(CONTENT_TYPES.includes(article.content_type), `unexpected content_type ${article.content_type}`);
  assert.ok(TIME_PRECISIONS.includes(article.time_precision), `unexpected time_precision ${article.time_precision}`);
  assert.ok(
    VERIFICATION_STATUSES.includes(article.verification_status),
    `unexpected verification_status ${article.verification_status}`,
  );
}

function assertNoFillerArticles(data) {
  const articles = [data.lead, ...(data.articles || []), ...(data.annual_events || [])].filter(Boolean);
  for (const article of articles) {
    assert.doesNotMatch(String(article.id || ""), /^(BG_|SUP_)/, `unexpected filler article ${article.id}`);
  }
}

function opinionOf(data) {
  return data.sections?.["评论"]?.[0];
}

const STUB = {
  zhuOpenAi: {
    headline: "社论：胜利不是秩序，财政才是疆土的边界",
    subhead: "本报评论本季开国政治：头条之外，更要看朝廷能否把战果变成治理能力。",
    body: "本季真正值得警惕的，不是捷报能否写入诏书，而是朝廷是否有能力把军事胜利转化为可征税、可供粮、可派官的地方秩序。围绕“朱元璋称帝，建元洪武”，新朝已经取得名分优势，但名分并不自动带来户籍、仓储和卫所。若北伐继续推进而财政、粮运和地方官缺位，朝廷得到的将不是稳定版图，而是一张需要长期输血的军事账单。下一季的关键，是制度能否跟上战线，而不是诏书写得多漂亮。",
  },
  zhuChat: {
    headline: "社论：名分已经到手，治理才刚开始",
    subhead: "本报评论本季开国热点：称帝只是政治起点，财政与地方执行才决定新朝成色。",
    body: "围绕“朱元璋称帝，建元洪武”，本季最要紧的判断是：新朝已经取得名分，但名分还不是治理。真正考验朝廷的，是能否把开国声威转化为户籍、赋役、仓储和卫所的连续执行。若地方只听见新国号，却看不见可执行的官制、粮道与财政安排，开国政治就会停在仪式层面。下一季的风险，不在诏书是否庄严，而在国家能力能否压住军政扩张带来的财政缺口。",
  },
  zhuNormalize: {
    headline: "洪武元年季度评论：战后秩序重建与权力结构",
    subhead: "新朝立足未稳，真正的考验不在登基礼成，而在制度能否压住战后失序",
    body: "本季度的新闻报道显示，朱元璋称帝，建元洪武之后，新朝正处于建立和巩固的关键时期。同时，北方元廷残余和各地卫所建设仍然是朝廷关注的重要问题。朝廷需要通过黄册、鱼鳞图册、里甲和赋役编审来重建财政秩序，也需要重点建设国子学、科举取士和礼制。综上所述，战后秩序重建与权力结构调整是当前的重要任务。",
  },
  daduStructured: "```json\n{\n  \"headline\": \"战后秩序重建与财政承压\",\n  \"subhead\": \"北伐灭元后，明朝面临财政、治理与地方执行的多重压力\",\n  \"body\": [\n    {\n      \"判断\": \"明军攻占大都、元朝灭亡之后，明朝进入战后秩序重建阶段。\",\n      \"热点切入\": \"本季度最重要的一条热点新闻，是明军攻占大都、元朝灭亡后留下的治理与接收压力。\",\n      \"制度分析\": \"战后秩序重建与财政承压彼此缠绕。若黄册、赋役、仓储与地方军政编制不能及时落地，新朝就会在扩张之后立刻面对治理真空。\",\n      \"风险结论\": \"真正危险的不是战果不够，而是朝廷能否把胜利转化为可以持续运转的财政与制度能力。\"\n    }\n  ]\n}\n```",
  jingshiChat: {
    headline: "社论：南京旱灾不是天象，是治理压力测试",
    subhead: "本报评论本季灾异热点：京师灾情照见财政、仓储与地方执行的薄弱处。",
    body: "本季的京师旱灾不只是灾异记录，更是新朝治理能力的压力测试。南京作为政治中枢，一旦旱情牵动粮价、仓储和赈济，朝廷面对的就不是单一自然风险，而是财政调度、地方执行和民力承受之间的连锁反应。若政令只停留在安民口号，而不能落实到粮仓、税役减免和官员问责，灾异就会从地方痛点变成朝廷信用的损耗。下一步关键，是用制度响应灾情，而不是用祥异解释灾情。",
  },
  jingshiWorkers: {
    headline: "社论：灾情逼近中枢，国家能力就不能停在口号上",
    subhead: "本报评论本季京师旱情：灾害进入京畿之后，财政、仓储与赈济调度必须立即接受检验。",
    body: "围绕“京师（今江苏南京旱灾”，本季真正的问题已经不是是否有灾，而是国家机器能否比灾情更快一步启动。京师受旱意味着政治中心直接面对粮价、仓储、赈济和民心压力，任何迟缓都会被放大成对朝廷能力的怀疑。若中枢只强调开国声威，而不能把减赋、发仓、问责和地方执行一并压实，那么灾害就会从自然损失转化为制度损耗。对新朝而言，真正需要建立的不是解释灾异的话语，而是应对风险的治理常态。",
  },
  jingshiNewline: "{\n\"headline\":\"社论：灾情当前，真正受考的是朝廷执行力\",\n\"subhead\":\"本报评论本季京师旱情：真正的压力不在天象，而在财政与赈济调度。\",\n\"body\":\"围绕京师（今江苏南京旱灾），本季真正需要追问的不是灾异如何解释，\n而是中枢能否把财政、仓储、赈济和地方执行快速组织起来。京师受旱意味着政治中心直接面对粮价与民心压力。若朝廷只有安民之辞，没有减赋、发仓与问责之实，那么灾情就会迅速转化为对国家能力的怀疑。真正决定新朝成色的，不是口号，而是制度是否先于风险到位。\"}",
  unrelated: {
    headline: "社论：与史实无关的评论",
    subhead: "空泛的子标题",
    body: "朝廷今年的政令很多，各地情况不同。".repeat(10),
  },
};

test("GET /api/issue/latest generates an epoch quarter from unverified history without filler or a fallback opinion", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(data.period.label, "洪武1年第1季度");
  assert.equal(data.period.start_label, "洪武1年1月");
  assert.equal(data.period.end_label, "洪武1年3月");

  assert.equal(data.lead.headline, "朱元璋称帝，建元洪武");
  assert.equal(data.lead.content_type, "historical_digest");
  assert.equal(data.lead.verification_status, "needs_review");
  assert.deepEqual(data.lead.sources, []);

  assert.equal(data.articles.length, 0);
  assert.equal(opinionOf(data), undefined);
  assert.deepEqual(data.annual_events, []);
  assertNoFillerArticles(data);
});

test("GET /api/issue/latest allows a sparse quarter with no lead and no opinion", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第2季度");
  assert.equal(data.period.start_label, "洪武1年4月");
  assert.equal(data.lead, null);
  assert.deepEqual(data.articles, []);
  assert.deepEqual(data.sections, {});
  assert.deepEqual(data.annual_events, []);
  assert.equal(opinionOf(data), undefined);
});

test("GET /api/issue/latest attaches full provenance metadata to every emitted article", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeEnv());
  const data = await readJson(response);

  const articles = [data.lead, ...(data.articles || []), ...(data.annual_events || [])].filter(Boolean);
  assert.ok(articles.length >= 1);
  for (const article of articles) assertArticleMetadata(article);
});

test("GET /api/issue/latest places unknown-month records only in the Q4 annual_events", async () => {
  const env = makeVerifiedEnv();

  const q4 = await readJson(
    await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-18"), env),
  );
  assert.equal(q4.period.label, "洪武1年第4季度");
  const annual = q4.annual_events.find((article) => article.id === "SYN_1368_AN");
  assert.ok(annual, "expected the unknown-month record in Q4 annual_events");
  assert.equal(annual.time_precision, "year");
  assert.equal(annual.verification_status, "needs_review");
  assert.equal([q4.lead, ...q4.articles].some((article) => article?.id === "SYN_1368_AN"), false);

  const q1 = await readJson(
    await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), env),
  );
  assert.deepEqual(q1.annual_events, []);
  assert.equal([q1.lead, ...q1.articles].some((article) => article?.id === "SYN_1368_AN"), false);
});

test("GET /api/issue/latest promotes explicitly verified synthetic timeline records and keeps unverified ones as digests", async () => {
  const verified = await readJson(
    await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeVerifiedEnv()),
  );
  assert.equal(verified.lead.content_type, "historical_report");
  assert.equal(verified.lead.verification_status, "verified");
  assert.deepEqual(verified.lead.sources, [ZHU_SOURCE]);
  assert.equal(verified.lead.source_excerpt.length > 0, true);

  const pending = await readJson(
    await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeUnverifiedEnv()),
  );
  // Sourced and excerpted, but without explicit verification it stays pending.
  assert.equal(pending.lead.content_type, "historical_digest");
  assert.equal(pending.lead.verification_status, "needs_review");
  assert.deepEqual(pending.lead.sources, [ZHU_SOURCE]);
  assert.equal(pending.lead.source_excerpt.length > 0, true);
});

test("verified annual records retain provenance without becoming quarterly AI facts", async () => {
  const annual = { ...syntheticTimeline(true)[0], id: "SYN_VERIFIED_ANNUAL", month: null };
  let calls = 0;
  const env = {
    ...makeEnv({
      "data:v1:ming:timeline": JSON.stringify([annual]),
      "data:v1:ming:disasters": "[]",
    }),
    AI: { run: async () => { calls += 1; return {}; } },
  };
  const data = await readJson(await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-18&debug=1"), env));
  assert.equal(data.lead, null);
  assert.deepEqual(data.articles, []);
  assert.equal(data.annual_events[0].verification_status, "verified");
  assert.equal(data.annual_events[0].time_precision, "year");
  assert.equal(data._debug.ai.skipReason, "insufficient_evidence");
  assert.equal(calls, 0);
});

test("known-month unsourced or truncated disasters never become month-unknown annual records", async () => {
  const disasters = [
    { ...syntheticDisaster(false), year: 1368, sources: [], description: "十一月，京师地震。" },
    { ...syntheticDisaster(false), year: 1368, description: "三月戊寅，成都府安县" },
  ];
  const env = makeEnv({
    "data:v1:ming:timeline": "[]",
    "data:v1:ming:disasters": JSON.stringify(disasters),
  });
  const data = await readJson(await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-18"), env));
  assert.equal(data.lead, null);
  assert.deepEqual(data.annual_events, []);
});

test("GET /api/issue/latest can generate a later quarter by request date", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第3季度");
  assert.equal(data.period.start_label, "洪武1年7月");
  assert.equal(data.period.end_label, "洪武1年9月");
  assert.equal(data.lead.headline, "明军攻占大都，元朝灭亡");
  assert.notEqual(data.lead.headline, "朱元璋称帝，建元洪武");
  assert.equal(opinionOf(data), undefined);
});

test("GET /api/issue/latest rejects invalid request dates", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-99-99"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(data.ok, false);
  assert.equal(data.error, "invalid_date");
});

test(`GET /api/issue/latest caches generated issues by Ming quarter under cache ${CACHE_VERSION}`, async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;

  const first = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17"), env);
  const firstData = await readJson(first);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17"), env);
  const secondData = await readJson(second);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(secondData, firstData);
  assert.equal(kv.calls.get.filter((call) => call.key === `issue:${CACHE_VERSION}:1368:7`).length, 2);
  assert.equal(kv.calls.put.filter((call) => call.key === `issue:${CACHE_VERSION}:1368:7`).length, 1);
});

test("GET /api/issue/latest ignores stale v4 cache entries", async () => {
  const env = makeEnv({
    "issue:v4:1368:4": JSON.stringify({
      period: { start_year: 1368, start_month: 4, label: "洪武1年第2季度" },
      lead: { id: "STALE", headline: "过期缓存不应被读取", content_type: "historical_digest" },
      articles: [],
      sections: {},
      annual_events: [],
    }),
  });

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第2季度");
  assert.notEqual(data.lead?.id, "STALE");
  assert.equal(env.ISSUE_CACHE.calls.get.some((call) => call.key === "issue:v4:1368:4"), false);
  assert.equal(env.ISSUE_CACHE.calls.put.some((call) => call.key === `issue:${CACHE_VERSION}:1368:4`), true);
});

test("GET /api/issue/latest skips AI and emits no opinion when no fact is verified", async () => {
  const calls = [];
  const env = {
    ...makeUnverifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.zhuOpenAi } }) },
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 0);
  assert.equal(opinionOf(data), undefined);
  assert.equal(data._debug.ai.skipped, true);
  assert.equal(data._debug.ai.skipReason, "insufficient_evidence");
  assert.equal(data._debug.ai.modelCalled, false);
  assert.equal(data._debug.ai.evidenceCount, 0);
});

test("GET /api/issue/latest rejects a precise but explicitly unverified disaster as AI evidence", async () => {
  const calls = [];
  const env = {
    ...makeUnverifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.jingshiWorkers } }) },
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.lead.content_type, "historical_digest");
  assert.equal(data.lead.verification_status, "needs_review");
  assert.equal(data.lead.time_precision, "month");
  assert.deepEqual(data.lead.sources, [JINGSHI_SOURCE]);
  assert.equal(calls.length, 0);
  assert.equal(opinionOf(data), undefined);
  assert.equal(data._debug.ai.skipped, true);
  assert.equal(data._debug.ai.skipReason, "insufficient_evidence");
});

test("GET /api/issue/latest never treats the real unverified timeline as AI evidence", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.zhuOpenAi } }) },
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.lead.content_type, "historical_digest");
  assert.equal(data.lead.verification_status, "needs_review");
  assert.equal(calls.length, 0);
  assert.equal(opinionOf(data), undefined);
  assert.equal(data._debug.ai.skipped, true);
  assert.equal(data._debug.ai.skipReason, "insufficient_evidence");
});

test("GET /api/issue/latest creates an opinion from scratch with OpenAI responses", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.4-mini",
    OPENAI_FETCH: makeOpenAiFetch({ calls, body: { output_text: JSON.stringify(STUB.zhuOpenAi) } }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.headline, STUB.zhuOpenAi.headline);
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.event_type, "opinion");
  assert.equal(opinion.content_type, "opinion");
  assert.equal(opinion.verification_status, "needs_review");
  assert.equal(opinion.category, "commentary");
  assert.deepEqual(opinion.sources, [ZHU_SOURCE]);
  assert.equal(opinion.sources.some((source) => /生成评论/.test(String(source))), false);
  assert.match(opinion.editorial_note, /OpenAI 生成评论/);
  assert.match(opinion.editorial_note, /未经人工核验/);
  assert.match(opinion.body, /朱元璋称帝，建元洪武/);
});

test("GET /api/issue/latest creates an opinion with chat completions and parses fenced JSON", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      calls,
      body: { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(STUB.jingshiChat)}\n\`\`\`` } }] },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);
  const requestBody = JSON.parse(calls[0].init.body);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.chatanywhere.tech/v1/chat/completions");
  assert.equal(requestBody.model, "gpt-4o-mini");
  assert.equal(requestBody.messages[0].role, "system");
  assert.equal(requestBody.messages[1].role, "user");
  assert.equal(opinion.headline, STUB.jingshiChat.headline);
  assert.equal(opinion.byline, "本报评论部");
  assert.deepEqual(opinion.sources, [JINGSHI_SOURCE]);
  assert.equal(opinion.sources.includes("ChatAnywhere 生成评论"), false);
  assert.match(opinion.editorial_note, /ChatAnywhere 生成评论/);
});

test("GET /api/issue/latest creates an opinion with Cloudflare Workers AI and reports bounded evidence debug metadata", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.jingshiWorkers } }) },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(calls[0].input.messages[0].role, "system");
  assert.equal(calls[0].input.messages[1].role, "user");
  assert.match(calls[0].input.messages[1].content, /已核验史实/);
  assert.match(calls[0].input.messages[1].content, /史料摘录：/);
  assert.match(calls[0].input.messages[1].content, new RegExp(`来源：${JINGSHI_SOURCE}`));
  assert.equal(calls[0].input.response_format.type, "json_schema");
  assert.deepEqual(calls[0].input.response_format.json_schema.required, ["headline", "subhead", "body"]);
  assert.equal(opinion.byline, "本报评论部");
  assert.deepEqual(opinion.sources, [JINGSHI_SOURCE]);
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), false);
  assert.match(opinion.editorial_note, /Cloudflare Workers AI 生成评论/);
  assert.equal(data._debug.ai.provider, "workers_ai");
  assert.equal(data._debug.ai.evidenceCount, 1);
  assert.equal(data._debug.ai.responseOk, true);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest prefers Cloudflare Workers AI over external chat completions", async () => {
  const aiCalls = [];
  const llmCalls = [];
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls: aiCalls, body: { response: STUB.jingshiWorkers } }) },
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({ calls: llmCalls, body: { choices: [{ message: { content: "{}" } }] } }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(aiCalls.length, 1);
  assert.equal(llmCalls.length, 0);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.editorial_note, /Cloudflare Workers AI 生成评论/);
});

test("GET /api/issue/latest tolerates Workers AI JSON with literal newlines in body", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.jingshiNewline } }) },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.editorial_note, /Cloudflare Workers AI 生成评论/);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest flattens structured Workers AI body objects into commentary text", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.daduStructured } }) },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.body, /明军攻占大都/);
  assert.match(opinion.body, /财政承压/);
  assert.deepEqual(opinion.sources, [DADU_SOURCE]);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest normalizes AI commentary into a sharper editorial frame", async () => {
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ body: { response: STUB.zhuNormalize } }) },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&refresh=1"), env);
  const data = await readJson(response);
  const opinion = opinionOf(data);

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.headline, /^社论：/);
  assert.doesNotMatch(opinion.headline, /季度评论|综述|观察/);
  assert.doesNotMatch(opinion.body, /本季度的新闻报道显示/);
  assert.doesNotMatch(opinion.body, /综上所述/);
  assert.match(opinion.editorial_note, /Cloudflare Workers AI 生成评论/);
});

test("GET /api/issue/latest rejects an AI opinion that does not reference the evidence", async () => {
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ body: { response: STUB.unrelated } }) },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"), env);
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(opinionOf(data), undefined);
  assert.equal(data._debug.ai.validationOk, false);
});

test("GET /api/issue/latest debug exposes sanitized AI provider metadata on demand", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({ calls, body: { choices: [{ message: { content: JSON.stringify(STUB.zhuChat) } }] } }),
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(data._debug.cache.hit, false);
  assert.equal(data._debug.cache.bypassed, true);
  assert.equal(data._debug.ai.provider, "chat_completions");
  assert.equal(data._debug.ai.providerSource, "ChatAnywhere 生成评论");
  assert.equal(data._debug.ai.providerHost, "api.chatanywhere.tech");
  assert.equal(data._debug.ai.responseOk, true);
  assert.equal(data._debug.ai.status, 200);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
  assert.equal(data._debug.ai.evidenceCount, 1);
  assert.equal(typeof data._debug.ai.durationMs, "number");
  assert.equal(data._debug.ai.errorMessage, null);
});

test("GET /api/issue/latest debug shows AI failure details without secrets and emits no opinion", async () => {
  const env = {
    ...makeVerifiedEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({ status: 502, body: { error: { message: "upstream overloaded" } } }),
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(opinionOf(data), undefined);
  assert.equal(data._debug.ai.provider, "chat_completions");
  assert.equal(data._debug.ai.responseOk, false);
  assert.equal(data._debug.ai.status, 502);
  assert.equal(data._debug.ai.parseOk, false);
  assert.equal(data._debug.ai.validationOk, false);
  assert.match(data._debug.ai.errorMessage, /HTTP 502/);
  assert.match(data._debug.ai.errorMessage, /upstream overloaded/);
  assert.equal(data._debug.ai.outputPreview, "{\"error\":{\"message\":\"upstream overloaded\"}}");
  assert.equal(data._debug.ai.errorMessage.includes("test-chatanywhere-key"), false);
});

test("GET /api/issue/latest uses the runtime fetch binding when no custom AI fetch is provided", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function runtimeBoundFetch(url, init = {}) {
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(STUB.jingshiWorkers) } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };

  try {
    const env = {
      ...makeVerifiedEnv(),
      LLM_API_KEY: "test-chatanywhere-key",
      LLM_API_BASE: "https://api.chatanywhere.tech/v1",
      LLM_API_TYPE: "chat_completions",
      LLM_MODEL: "gpt-4o-mini",
    };

    const response = await worker.fetch(
      new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"),
      env,
    );
    const data = await readJson(response);
    const opinion = opinionOf(data);

    assert.equal(response.status, 200);
    assert.equal(opinion.byline, "本报评论部");
    assert.match(opinion.editorial_note, /ChatAnywhere 生成评论/);
    assert.equal(data._debug.ai.responseOk, true);
    assert.equal(data._debug.ai.validationOk, true);
    assert.equal(data._debug.ai.errorMessage, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/issue/latest does not schedule an async AI upgrade without verified evidence", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.zhuOpenAi } }) },
  };

  const firstWaits = [];
  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15"),
    env,
    { waitUntil(promise) { firstWaits.push(promise); } },
  );
  assert.equal(opinionOf(await readJson(first)), undefined);
  assert.equal(firstWaits.length, 0);

  // A cached base without verified evidence must not schedule an upgrade either.
  const secondWaits = [];
  const second = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15"),
    env,
    { waitUntil(promise) { secondWaits.push(promise); } },
  );
  assert.equal(opinionOf(await readJson(second)), undefined);
  assert.equal(secondWaits.length, 0);
  assert.equal(calls.length, 0);
});

test("GET /api/issue/latest returns the base issue then caches a successful async AI upgrade", async () => {
  const calls = [];
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: { run: makeWorkersAiRun({ calls, body: { response: STUB.zhuOpenAi } }) },
  };
  const waitUntilCalls = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15"),
    env,
    { waitUntil(promise) { waitUntilCalls.push(promise); } },
  );
  const firstData = await readJson(first);
  assert.equal(first.status, 200);
  assert.equal(opinionOf(firstData), undefined);
  assert.equal(firstData.lead.content_type, "historical_report");
  assert.equal(firstData.lead.verification_status, "verified");
  assert.equal(waitUntilCalls.length, 1);
  assert.equal(calls.length, 1);

  await Promise.all(waitUntilCalls);

  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), env);
  const secondData = await readJson(second);
  const secondOpinion = opinionOf(secondData);

  assert.equal(secondOpinion.byline, "本报评论部");
  assert.equal(secondOpinion.content_type, "opinion");
  assert.match(secondOpinion.editorial_note, /Cloudflare Workers AI 生成评论/);
});

test("GET /api/issue/latest retries the async AI upgrade after a transient failure and caches the opinion", async () => {
  let attempt = 0;
  const env = {
    ...makeVerifiedEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: async () => {
        attempt += 1;
        if (attempt <= 2) return { response: "{" };
        return { response: STUB.jingshiWorkers };
      },
    },
  };
  const firstWaits = [];
  const secondWaits = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    { waitUntil(promise) { firstWaits.push(promise); } },
  );
  assert.equal(opinionOf(await readJson(first)), undefined);
  await Promise.all(firstWaits);

  const second = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    { waitUntil(promise) { secondWaits.push(promise); } },
  );
  assert.equal(opinionOf(await readJson(second)), undefined);
  assert.equal(secondWaits.length, 1);
  await Promise.all(secondWaits);

  assert.equal(attempt, 3);
  const third = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19"), env);
  const thirdOpinion = opinionOf(await readJson(third));
  assert.equal(thirdOpinion.byline, "本报评论部");
  assert.match(thirdOpinion.editorial_note, /Cloudflare Workers AI 生成评论/);
});

test("scheduled pre-generates the next Beijing date's issue in KV", async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;
  const waitUntilCalls = [];

  // 16:05 UTC is 00:05 on the following day in Beijing (UTC+8).
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 4, 17, 16, 5) }, env, {
    waitUntil(promise) {
      waitUntilCalls.push(promise);
    },
  });
  await Promise.all(waitUntilCalls);

  const issueWrites = kv.calls.put.filter((call) => call.key === `issue:${CACHE_VERSION}:1368:10`);
  assert.equal(issueWrites.length, 1);
  const cached = JSON.parse(issueWrites[0].value);
  assert.equal(cached.period.label, "洪武1年第4季度");
  assert.ok(Array.isArray(cached.annual_events));
});

test("GET /api/issue/latest returns 503 when historical data is missing", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15"),
    { ISSUE_CACHE: makeKv() },
  );
  const data = await readJson(response);

  assert.equal(response.status, 503);
  assert.equal(data.ok, false);
  assert.equal(data.error, "history_data_unavailable");
});

test("GET /health returns service metadata", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, "ming-post-api");
  assert.equal(typeof data.issue.label, "string");
  assert.notEqual(data.issue.label.length, 0);
});

test("unknown routes return JSON 404", async () => {
  const response = await worker.fetch(new Request("https://example.test/missing"));
  const data = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(data.ok, false);
  assert.equal(data.error, "not_found");
});
