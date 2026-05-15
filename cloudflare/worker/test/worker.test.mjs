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

function makeEnv(initial = {}) {
  return {
    ISSUE_CACHE: makeKv({
      "data:v1:ming:timeline": JSON.stringify(processedTimeline),
      "data:v1:ming:disasters": JSON.stringify(processedDisasters),
      ...initial,
    }),
  };
}

test("GET /api/issue/latest generates the epoch issue from KV history data", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(data.period.label, "洪武1年第1季度");
  assert.equal(data.period.start_label, "洪武1年1月");
  assert.equal(data.period.end_label, "洪武1年3月");
  assert.equal(data.lead.headline, "朱元璋称帝，建元洪武");
  assert.equal(data.sections["评论"][0].event_type, "opinion");
});

test("GET /api/issue/latest can generate a later quarter by request date", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第2季度");
  assert.equal(data.period.start_label, "洪武1年4月");
  assert.equal(data.period.end_label, "洪武1年6月");
  assert.notEqual(data.lead.headline, "朱元璋称帝，建元洪武");
});

test("GET /api/issue/latest rejects invalid request dates", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-99-99"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(data.ok, false);
  assert.equal(data.error, "invalid_date");
});

test("GET /api/issue/latest caches generated issues by Ming quarter", async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;

  const first = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const firstData = await readJson(first);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const secondData = await readJson(second);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(secondData, firstData);
  assert.equal(kv.calls.get.filter((call) => call.key === "issue:v3:1368:4").length, 2);
  assert.equal(kv.calls.put.filter((call) => call.key === "issue:v3:1368:4").length, 1);
});

test("GET /api/issue/latest enhances the opinion with OpenAI when configured", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.4-mini",
    OPENAI_FETCH: makeOpenAiFetch({
      calls,
      body: {
        output_text: JSON.stringify({
          headline: "社论：胜利不是秩序，财政才是疆土的边界",
          subhead: "本报评论本季开国政治：头条之外，更要看朝廷能否把战果变成治理能力。",
          body: "本季真正值得警惕的，不是捷报能否写入诏书，而是朝廷是否有能力把军事胜利转化为可征税、可供粮、可派官的地方秩序。围绕“朱元璋称帝，建元洪武”，新朝已经取得名分优势，但名分并不自动带来户籍、仓储和卫所。若北伐继续推进而财政、粮运和地方官缺位，朝廷得到的将不是稳定版图，而是一张需要长期输血的军事账单。下一季的关键，是制度能否跟上战线，而不是诏书写得多漂亮。",
        }),
      },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.headline, "社论：胜利不是秩序，财政才是疆土的边界");
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.event_type, "opinion");
  assert.equal(opinion.category, "commentary");
  assert.equal(opinion.sources.includes("OpenAI 生成评论"), true);
  assert.match(opinion.body, /朱元璋称帝，建元洪武/);
  assert.match(opinion.body, /财政/);
});

test("GET /api/issue/latest falls back to rule opinion when OpenAI fails", async () => {
  const env = {
    ...makeEnv(),
    OPENAI_API_KEY: "test-key",
    OPENAI_FETCH: makeOpenAiFetch({ status: 500, body: { error: { message: "model unavailable" } } }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报编辑部");
  assert.equal(opinion.sources.includes("OpenAI 生成评论"), false);
});

test("scheduled pre-generates the current issue in KV", async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;
  const waitUntilCalls = [];

  await worker.scheduled({ scheduledTime: Date.UTC(2026, 4, 17) }, env, {
    waitUntil(promise) {
      waitUntilCalls.push(promise);
    },
  });
  await Promise.all(waitUntilCalls);

  const issueWrites = kv.calls.put.filter((call) => call.key === "issue:v3:1368:7");
  assert.equal(issueWrites.length, 1);
  const cached = JSON.parse(issueWrites[0].value);
  assert.equal(cached.period.label, "洪武1年第3季度");
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
  assert.equal(data.issue.label, "洪武1年第1季度");
});

test("unknown routes return JSON 404", async () => {
  const response = await worker.fetch(new Request("https://example.test/missing"));
  const data = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(data.ok, false);
  assert.equal(data.error, "not_found");
});
