import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.js";

const generatedIssue = JSON.parse(
  readFileSync(new URL("../data/issue.json", import.meta.url), "utf8"),
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

test("GET /api/issue/latest returns the generated issue JSON for the epoch date", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"));
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(data, generatedIssue);
});

test("GET /api/issue/latest can generate a later quarter by request date", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"));
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第2季度");
  assert.equal(data.period.start_label, "洪武1年4月");
  assert.equal(data.period.end_label, "洪武1年6月");
  assert.notDeepEqual(data, generatedIssue);
});

test("GET /api/issue/latest rejects invalid request dates", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-99-99"));
  const data = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(data.ok, false);
  assert.equal(data.error, "invalid_date");
});

test("GET /api/issue/latest caches generated issues by Ming quarter", async () => {
  const kv = makeKv();
  const env = { ISSUE_CACHE: kv };

  const first = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const firstData = await readJson(first);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const secondData = await readJson(second);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(secondData, firstData);
  assert.equal(kv.calls.get.length, 2);
  assert.equal(kv.calls.put.length, 1);
  assert.equal(kv.calls.get[0].key, "issue:v1:1368:4");
});

test("scheduled pre-generates the current issue in KV", async () => {
  const kv = makeKv();
  const waitUntilCalls = [];

  await worker.scheduled({ scheduledTime: Date.UTC(2026, 4, 17) }, { ISSUE_CACHE: kv }, {
    waitUntil(promise) {
      waitUntilCalls.push(promise);
    },
  });
  await Promise.all(waitUntilCalls);

  assert.equal(kv.calls.put.length, 1);
  assert.equal(kv.calls.put[0].key, "issue:v1:1368:7");
  const cached = JSON.parse(kv.calls.put[0].value);
  assert.equal(cached.period.label, "洪武1年第3季度");
});

test("GET /health returns service metadata", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"));
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
