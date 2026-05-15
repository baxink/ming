import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

async function readJson(response) {
  return JSON.parse(await response.text());
}

test("GET /api/issue/latest returns the generated issue JSON", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest"));
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(data.period.issue_number, 1);
  assert.equal(data.lead.headline, "朱元璋称帝，建元洪武");
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
