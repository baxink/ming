import assert from "node:assert/strict";
import test from "node:test";
import { enhanceIssueOpinion } from "../src/opinion-ai.js";

const GOOD_BODY = [
  "黄河决口并非孤立的灾异，它把河防、漕运与地方赈济同时推到朝廷面前。",
  "洪武元年的开封受灾，暴露的不是一句天命可以解释的问题，而是河工岁修与仓储调度能否落到实处的治理考验。",
  "若只以蠲免了事，堤防不修、仓储不实，来年汛期仍会重复同样的损失；",
  "若借机整饬河务、预留赈粮，才可能把一次灾伤转化为制度上的补强。",
  "史料只记决口与漂没民居，评论不宜替朝廷虚构德政，只能就已有证据指出：治理能否奏效，取决于后续是否真的落实。",
].join("");

function report(overrides = {}) {
  return {
    id: "R1",
    section: "灾异志",
    headline: "黄河决口，开封受灾",
    content_type: "historical_report",
    verification_status: "verified",
    time_precision: "month",
    source_excerpt: "洪武元年六月，河决开封，漂没民居。",
    sources: ["明太祖实录·卷三十"],
    background: "黄河下游河道多年淤积。",
    later_effects: "此后黄河改道频繁。",
    body: "河决开封，漂没民居，朝廷遣使赈之。",
    ...overrides,
  };
}

function makeIssue(overrides = {}) {
  return {
    period: {
      start_year: 1368,
      start_month: 6,
      start_label: "洪武1年6月",
      end_label: "洪武1年9月",
      label: "洪武1年第2季度",
    },
    lead: report(),
    articles: [],
    sections: {},
    ...overrides,
  };
}

function makeWorkersAi({ body, calls = [] } = {}) {
  return async (model, input = {}) => {
    calls.push({ model, input });
    return body;
  };
}

function goodModelBody() {
  return {
    response: {
      headline: "社论：河防不是天意，是岁修与仓储的考验",
      subhead: "本报评论本季河患与治理压力。",
      body: GOOD_BODY,
    },
  };
}

test("skips without a model call when no verified historical_report fact exists", async () => {
  const calls = [];
  const issue = makeIssue({
    lead: null,
    articles: [
      report({ id: "P1", verification_status: "needs_review" }),
      report({ id: "D1", content_type: "historical_digest" }),
      report({ id: "A1", content_type: "historical_analysis" }),
    ],
    sections: {},
  });

  const result = await enhanceIssueOpinion(issue, { AI: { run: makeWorkersAi({ calls }) } });

  assert.equal(calls.length, 0);
  assert.equal(result.issue, issue);
  assert.equal(result.debug.skipped, true);
  assert.equal(result.debug.skipReason, "insufficient_evidence");
  assert.equal(result.debug.modelCalled, false);
  assert.equal(result.debug.evidenceCount, 0);
  assert.match(result.debug.errorMessage, /historical_report/);
});

test("does not treat unverified annual_events as AI facts", async () => {
  const calls = [];
  const issue = makeIssue({
    lead: null,
    articles: [],
    sections: {},
    annual_events: [
      report({ id: "AN1", content_type: "historical_report", verification_status: "needs_review" }),
      { id: "AN2", headline: "未经核验的年度条目", content_type: "historical_digest" },
    ],
  });

  const result = await enhanceIssueOpinion(issue, { AI: { run: makeWorkersAi({ calls }) } });

  assert.equal(calls.length, 0);
  assert.equal(result.issue, issue);
  assert.equal(result.debug.skipped, true);
  assert.equal(result.debug.annualEventsCount, 2);
});

test("generates a new needs_review opinion from a qualified lead fact without a preexisting opinion", async () => {
  const calls = [];
  const issue = makeIssue();

  const result = await enhanceIssueOpinion(issue, {
    AI: { run: makeWorkersAi({ body: goodModelBody(), calls }) },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.debug.validationOk, true);
  assert.equal(result.debug.skipped, false);
  assert.equal(result.debug.modelCalled, true);
  assert.equal(result.debug.evidenceCount, 1);

  const opinion = result.issue.sections["评论"][0];
  assert.equal(opinion.content_type, "opinion");
  assert.equal(opinion.verification_status, "needs_review");
  assert.equal(opinion.section, "评论");
  assert.equal(opinion.event_type, "opinion");
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.time_precision, "range");
  assert.deepEqual(opinion.sources, ["明太祖实录·卷三十"]);
  assert.equal(opinion.sources.some((source) => /生成评论/.test(source)), false);
  assert.match(opinion.editorial_note, /Cloudflare Workers AI 生成评论/);
  assert.match(opinion.editorial_note, /未经人工核验/);
  assert.match(opinion.body, /黄河决口/);

  assert.equal(result.issue.articles.length, 1);
  assert.equal(result.issue.articles[0].content_type, "opinion");
  assert.equal(result.issue.articles[0], opinion);

  assert.equal(result.issue.lead, issue.lead);
});

test("replaces an existing opinion in place without duplicating it", async () => {
  const calls = [];
  const oldOpinion = {
    id: "OP_OLD",
    section: "评论",
    content_type: "opinion",
    event_type: "opinion",
    verification_status: "needs_review",
    headline: "社论：旧评论",
    body: "旧评论正文".repeat(30),
    sources: ["旧来源"],
  };
  const issue = makeIssue({ articles: [oldOpinion], sections: { "评论": [oldOpinion] } });

  const result = await enhanceIssueOpinion(issue, {
    AI: { run: makeWorkersAi({ body: goodModelBody(), calls }) },
  });

  const opinionArticles = result.issue.articles.filter((article) => article.section === "评论");
  assert.equal(opinionArticles.length, 1);
  assert.equal(opinionArticles[0].id, "OP_OLD");
  assert.equal(opinionArticles[0].content_type, "opinion");
  assert.equal(result.issue.sections["评论"].length, 1);
  assert.equal(result.issue.sections["评论"][0].id, "OP_OLD");
  assert.notEqual(result.issue.sections["评论"][0].headline, "社论：旧评论");
});

test("sends a bounded evidence pack with excerpts, time precision, sources and labeled later_effects", async () => {
  const calls = [];
  const issue = makeIssue();

  await enhanceIssueOpinion(issue, {
    AI: { run: makeWorkersAi({ body: goodModelBody(), calls }) },
  });

  const prompt = calls[0].input.messages[1].content;
  assert.match(prompt, /已核验史实/);
  assert.match(prompt, /史料摘录：洪武元年六月，河决开封/);
  assert.match(prompt, /时间精度：month/);
  assert.match(prompt, /来源：明太祖实录·卷三十/);
  assert.match(prompt, /背景（编辑部整理/);
  assert.match(prompt, /后世影响（现代回望/);
  assert.match(prompt, /不得编造/);
  assert.match(prompt, /不要预设固定立场/);
  assert.doesNotMatch(prompt, /朱元璋称帝/);
});

test("keeps the issue unchanged when the model output does not reference the evidence", async () => {
  const calls = [];
  const issue = makeIssue();
  const unrelatedBody = "朝廷今年的政令很多，各地情况不同。".repeat(10);
  const payload = {
    response: {
      headline: "社论：与史实无关的评论",
      subhead: "空泛的子标题",
      body: unrelatedBody,
    },
  };

  const result = await enhanceIssueOpinion(issue, {
    AI: { run: makeWorkersAi({ body: payload, calls }) },
  });

  assert.equal(result.issue, issue);
  assert.equal(result.debug.validationOk, false);
  assert.equal(result.issue.sections["评论"], undefined);
});

test("skips with a clear reason when no provider is configured", async () => {
  const issue = makeIssue();
  const result = await enhanceIssueOpinion(issue, {});

  assert.equal(result.issue, issue);
  assert.equal(result.debug.skipped, true);
  assert.equal(result.debug.skipReason, "no_provider");
  assert.equal(result.debug.modelCalled, false);
});
