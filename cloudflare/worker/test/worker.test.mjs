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
