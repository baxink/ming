import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadNewsRenderer(overrides = {}) {
  const source = readFileSync(new URL("../web/js/news.js", import.meta.url), "utf8");
  const context = {
    document: overrides.document || { addEventListener() {} },
    window: overrides.window || {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function createFakeDocument() {
  const nodes = new Map();
  const getElementById = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: "", innerHTML: "" });
    return nodes.get(id);
  };
  return { title: "", addEventListener() {}, getElementById, _node: getElementById };
}

const BASE_ISSUE = {
  date: {
    real_date: "2026年10月",
    ming_reign: "洪武",
    ming_year: 1,
    ming_month: 10,
    emperor: "太祖朱元璋",
    season: "冬",
  },
  period: {
    issue_number: 4,
    label: "洪武1年第4季度",
    start_label: "洪武1年10月",
    end_label: "洪武1年12月",
  },
};

test("createArticleHTML removes dangling source fragments from API bodies", () => {
  const { createArticleHTML } = loadNewsRenderer();
  const html = createArticleHTML({
    id: "DIS_1368_1",
    headline: "永新州（今江西永新）大雨、涝水灾",
    body: "水灾永新州（今江西永新）大雨、涝：六月戊辰，江西永新州大风雨，蛟出，江水入城，高八尺，人多溺死。事闻，使赈之。曹州（今山东菏泽）决口：（河）决曹州双河口，入鱼台。（《",
  }, true);

  assert.match(html, /入鱼台。/);
  assert.doesNotMatch(html, /（《/);
});

test("createArticleHTML escapes interpolated metadata and allowlists severity", () => {
  const { createArticleHTML } = loadNewsRenderer();
  const malicious = createArticleHTML({
    id: '"><script>alert(1)</script>',
    headline: "<img src=x onerror=alert(1)>",
    dateline: '" onmouseover="alert(1)',
    body: "<svg onload=alert(1)>正文",
    severity: 'critical"><script>',
    content_type: '"><script>alert(1)</script>',
    time_precision: '"><b>',
    sources: ["<b>伪来源</b>"],
    verification_status: "verified<script>",
  });

  assert.doesNotMatch(malicious, /<script/i);
  assert.doesNotMatch(malicious, /<img/i);
  assert.doesNotMatch(malicious, /<svg/i);
  assert.doesNotMatch(malicious, /<b>伪来源<\/b>/);
  assert.doesNotMatch(malicious, /class="severity-badge/);
  assert.doesNotMatch(malicious, /class="content-type-tag/);
  assert.match(malicious, /&lt;img/);
  assert.match(malicious, /待核验资料/);

  const valid = createArticleHTML({
    id: "ok",
    headline: "正常条目",
    severity: "major",
    content_type: "historical_report",
    time_precision: "range",
    verification_status: "verified",
  }, false);
  assert.match(valid, /severity-badge major/);
  assert.match(valid, /史料报道/);
  assert.match(valid, /跨月时段/);
  assert.match(valid, /verification-badge verified/);
});

test("renderer discloses source availability and verification status", () => {
  const { createArticleHTML } = loadNewsRenderer();

  const missing = createArticleHTML({
    id: "no-source",
    headline: "无出处条目",
    sources: [],
    verification_status: "needs_review",
  }, false);
  assert.match(missing, /未提供可定位出处，待核验/);
  assert.match(missing, /待核验资料/);
  assert.doesNotMatch(missing, /已核验/);

  const sourced = createArticleHTML({
    id: "sourced",
    headline: "有出处条目",
    sources: ["《明太祖实录》卷三", "《明史·太祖本纪》"],
    verification_status: "verified",
    time_precision: "month",
    source_excerpt: "原文摘录内容",
  }, false);
  assert.match(sourced, /《明太祖实录》卷三/);
  assert.match(sourced, /已核验/);
  assert.match(sourced, /月份可考/);
  assert.match(sourced, /原文摘录/);
  assert.doesNotMatch(sourced, /未提供可定位出处/);
});

test("renderAnnualPanel presents unknown-month annual records separately", () => {
  const { renderAnnualPanel } = loadNewsRenderer();

  assert.equal(renderAnnualPanel([]), "");
  assert.equal(renderAnnualPanel(null), "");

  const html = renderAnnualPanel([{
    id: "AN_1",
    headline: "<b>年度水利</b>",
    body: "年份可考但月份不详",
    sources: ["《明史·河渠志》"],
    time_precision: "year",
  }]);

  assert.match(html, /annual-panel/);
  assert.match(html, /月份不详/);
  assert.match(html, /年份可考/);
  assert.match(html, /《明史·河渠志》/);
  assert.match(html, /&lt;b&gt;年度水利&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>年度水利<\/b>/);
});

test("distributeSections keeps one column per available section up to three", () => {
  const { distributeSections } = loadNewsRenderer();
  const entries = (n) => Array.from({ length: n }, (_, i) => ({
    name: `栏目${i}`,
    articles: [{ id: `a${i}` }],
  }));

  assert.equal(distributeSections([]).length, 0);
  assert.equal(distributeSections(entries(1)).length, 1);
  assert.equal(distributeSections(entries(2)).length, 2);
  assert.equal(distributeSections(entries(3)).length, 3);

  const four = distributeSections(entries(4));
  assert.equal(four.length, 3);
  assert.ok(four.every((column) => column.length >= 1));
  assert.ok(distributeSections(entries(2)).every((column) => column.length >= 1));
});

test("renderNewspaper still renders annual panel when quarterly sections are empty", () => {
  const document = createFakeDocument();
  const { renderNewspaper } = loadNewsRenderer({ document });

  renderNewspaper({
    ...BASE_ISSUE,
    lead: null,
    articles: [],
    sections: {},
    annual_events: [{
      id: "AN_1",
      headline: "年度河工",
      sources: ["《明史·河渠志》"],
      time_precision: "year",
    }],
  });

  const content = document._node("content");
  assert.match(content.innerHTML, /annual-panel/);
  assert.match(content.innerHTML, /年度河工/);
  assert.doesNotMatch(content.innerHTML, /史料不足以刊行/);
  assert.doesNotMatch(content.innerHTML, /本栏无文章/);
});

test("renderNewspaper states insufficient material for a completely empty issue", () => {
  const document = createFakeDocument();
  const { renderNewspaper } = loadNewsRenderer({ document });

  renderNewspaper({
    ...BASE_ISSUE,
    lead: null,
    articles: [],
    sections: {},
    annual_events: [],
  });

  const content = document._node("content");
  assert.match(content.innerHTML, /史料不足以刊行/);
  assert.match(content.innerHTML, /洪武1年第4季度/);
  assert.doesNotMatch(content.innerHTML, /news-grid/);
});

test("renderNewspaper uses sparse column count and drops empty-column filler", () => {
  const document = createFakeDocument();
  const { renderNewspaper } = loadNewsRenderer({ document });

  renderNewspaper({
    ...BASE_ISSUE,
    lead: null,
    articles: [],
    sections: { "朝政要闻": [{ id: "x", headline: "单栏要闻", body: "正文" }] },
    annual_events: [],
  });

  const content = document._node("content");
  assert.match(content.innerHTML, /news-grid cols-1/);
  assert.doesNotMatch(content.innerHTML, /news-grid cols-2/);
  assert.doesNotMatch(content.innerHTML, /news-grid cols-3/);
  assert.doesNotMatch(content.innerHTML, /本栏无文章/);
});
