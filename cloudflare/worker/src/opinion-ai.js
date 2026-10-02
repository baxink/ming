const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_LLM_BASE = "https://api.chatanywhere.tech/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_EVIDENCE_FACTS = 6;
const MAX_SOURCES_PER_FACT = 4;
const MAX_OPINION_SOURCES = 12;
const EXCERPT_LIMIT = 220;
const BACKGROUND_LIMIT = 200;
const LATER_EFFECTS_LIMIT = 200;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isOpinionArticle(article) {
  return Boolean(article)
    && (article.section === "评论" || article.content_type === "opinion" || article.event_type === "opinion");
}

function isQualifiedFact(article) {
  if (!article || typeof article !== "object") return false;
  if (isOpinionArticle(article)) return false;
  if (article.content_type !== "historical_report") return false;
  if (article.verification_status !== "verified") return false;
  if (article.is_template === true || article.template === true) return false;
  if (!Array.isArray(article.sources) || !article.sources.some(isNonEmptyString)) return false;
  if (!isNonEmptyString(article.source_excerpt)) return false;
  return true;
}

function selectEvidenceFacts(issue) {
  if (!issue) return [];
  const seen = new Set();
  const candidates = [];
  const pushArticle = (article) => {
    if (!article || typeof article !== "object") return;
    const key = article.id || article;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(article);
  };

  pushArticle(issue.lead);
  for (const article of Array.isArray(issue.articles) ? issue.articles : []) pushArticle(article);
  for (const items of Object.values(issue.sections || {})) {
    for (const article of Array.isArray(items) ? items : []) pushArticle(article);
  }

  return candidates.filter(isQualifiedFact).slice(0, MAX_EVIDENCE_FACTS);
}

function existingOpinion(issue) {
  const fromSections = Array.isArray(issue?.sections?.["评论"])
    ? issue.sections["评论"].find(isOpinionArticle)
    : null;
  if (fromSections) return fromSections;
  return (Array.isArray(issue?.articles) ? issue.articles : []).find(isOpinionArticle) || null;
}

function clip(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function periodTimePrecision(issue) {
  const period = issue?.period;
  if (period && (isNonEmptyString(period.start_label) || period.start_year != null)) return "range";
  return "unknown";
}

function collectSources(facts) {
  const sources = [];
  for (const fact of facts) {
    for (const source of Array.isArray(fact?.sources) ? fact.sources : []) {
      const value = String(source || "").trim();
      if (!value || sources.includes(value)) continue;
      sources.push(value);
      if (sources.length >= MAX_OPINION_SOURCES) return sources;
    }
  }
  return sources;
}

function evidencePrompt(issue, facts) {
  const period = issue?.period || {};
  const lines = [
    "你是《大明新闻季报》的评论作者。请只依据下面提供的“已核验史实”写一篇中文时评。",
    "写作要求：",
    "1. 不得编造史实中没有的人名、地名、事件、数字或引文；无法从史实推出的话不要写。",
    "2. 结论必须由证据支撑，不要预设固定立场，也不要为了升华而强行上升到制度或兴亡结论；证据不足时应明确指出不确定。",
    "3. “背景”是编辑部整理材料，“后世影响”是现代回望，两者都不是当时发生的事实；引用后世影响时必须用现代视角明确标注，不得写成当时事实。",
    "4. 开头切入一条具体史实，不写季度综述；避免“本季度的新闻报道显示”“综上所述”“可以看出”“值得关注的是”等套话。",
    "5. 只输出严格 JSON，字段为 headline、subhead、body；body 为单个中文字符串，不要 Markdown、不要分点字段或嵌套 JSON。",
    `本期：${period.label || ""}，${period.start_label || ""}至${period.end_label || ""}。`,
    "已核验史实：",
  ];

  facts.forEach((fact, index) => {
    lines.push(`【史实${index + 1}】${fact.headline || ""}`);
    if (isNonEmptyString(fact.section)) lines.push(`栏目：${fact.section}`);
    lines.push(`时间精度：${fact.time_precision || "unknown"}${isNonEmptyString(fact.source_date) ? `；系年：${fact.source_date}` : ""}`);
    if (isNonEmptyString(fact.source_excerpt)) lines.push(`史料摘录：${clip(fact.source_excerpt, EXCERPT_LIMIT)}`);
    if (isNonEmptyString(fact.background)) lines.push(`背景（编辑部整理，非史实原文）：${clip(fact.background, BACKGROUND_LIMIT)}`);
    if (isNonEmptyString(fact.later_effects)) lines.push(`后世影响（现代回望，非当时事实，须明确标注为现代视角）：${clip(fact.later_effects, LATER_EFFECTS_LIMIT)}`);
    const sources = (Array.isArray(fact.sources) ? fact.sources : []).filter(isNonEmptyString).slice(0, MAX_SOURCES_PER_FACT);
    if (sources.length) lines.push(`来源：${sources.join("；")}`);
  });

  return lines.join("\n");
}

function opinionJsonSchema() {
  return {
    type: "object",
    required: ["headline", "subhead", "body"],
    additionalProperties: false,
    properties: {
      headline: { type: "string" },
      subhead: { type: "string" },
      body: { type: "string" },
    },
  };
}

function parseOutputText(payload) {
  if (payload?.response && typeof payload.response === "object") return JSON.stringify(payload.response);
  if (typeof payload?.response === "string") return payload.response;
  if (payload?.result?.response && typeof payload.result.response === "object") return JSON.stringify(payload.result.response);
  if (typeof payload?.result?.response === "string") return payload.result.response;
  const chatContent = payload?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return chatContent;
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.text === "string") return payload.text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseOpinionJson(text) {
  const source = String(text || "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  const candidate = fenced ? fenced[1] : source;
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(escapeJsonLiteralNewlines(candidate));
  }
}

function headlineKeywords(headline) {
  return String(headline || "")
    .split(/[，、：《》“”"'（）()\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 4);
}

function normalizeOpinion(raw, issue, facts, sourceLabel, baseOpinion) {
  const headline = normalizeEditorialHeadline(raw?.headline);
  const subhead = String(raw?.subhead || "").trim();
  const body = normalizeEditorialBody(normalizeBody(raw?.body));

  if (!headline || !subhead || body.length < 120) return null;

  const focusHeadlines = facts.map((fact) => fact.headline || "").filter(Boolean);
  if (focusHeadlines.length > 0) {
    const matchesHotspot = focusHeadlines.some((focus) => {
      if (body.includes(focus)) return true;
      return headlineKeywords(focus).some((keyword) => body.includes(keyword));
    });
    if (!matchesHotspot) return null;
  }

  const period = issue?.period || {};
  const sources = collectSources(facts);
  const supportingSources = sources.length
    ? sources
    : (Array.isArray(baseOpinion?.sources) ? baseOpinion.sources : []).map((source) => String(source || "").trim()).filter(Boolean);

  return {
    ...(baseOpinion || {}),
    id: baseOpinion?.id || `AI_OPINION_${period.start_year ?? "x"}_${period.start_month ?? "x"}`,
    section: "评论",
    headline: headline.slice(0, 48),
    subhead: subhead.slice(0, 90),
    dateline: baseOpinion?.dateline || "本报评论 —",
    byline: "本报评论部",
    body: body.slice(0, 520),
    event_type: "opinion",
    content_type: "opinion",
    verification_status: "needs_review",
    time_precision: baseOpinion?.time_precision || periodTimePrecision(issue),
    severity: baseOpinion?.severity ?? "",
    location: baseOpinion?.location || "",
    category: baseOpinion?.category || "commentary",
    sources: supportingSources,
    source_date: baseOpinion?.source_date || (isNonEmptyString(period.start_label) && isNonEmptyString(period.end_label) ? `${period.start_label}—${period.end_label}` : ""),
    source_excerpt: "",
    background: baseOpinion?.background || "",
    later_effects: baseOpinion?.later_effects || "",
    editorial_note: `${sourceLabel || "AI"}自动生成；本文为模型对已核验史实的编辑解读，非史料原文，未经人工核验；依据史实：${focusHeadlines.join("；")}。`,
  };
}

function normalizeBody(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeBody(item)).filter(Boolean).join("\n\n").trim();
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((item) => normalizeBody(item)).filter(Boolean).join("\n").trim();
  }
  return String(value || "").trim();
}

function normalizeEditorialHeadline(value) {
  const original = String(value || "").trim();
  let headline = original
    .replace(/^(洪武|永乐|建文|宣德|正统|景泰|天顺|成化|弘治|正德|嘉靖|隆庆|万历|天启|崇祯)[^：:]{0,12}(季度评论|季报评论|综述|观察)[:：]?\s*/u, "")
    .replace(/^(季度评论|季报评论|综述|观察)[:：]?\s*/u, "");
  if (!headline) headline = original;
  if (headline && !headline.startsWith("社论：")) {
    headline = `社论：${headline}`;
  }
  return headline.trim();
}

function normalizeEditorialBody(value) {
  let body = String(value || "").trim();
  const replacements = [
    [/^本季度的新闻报道显示，?/u, ""],
    [/^本季的新闻报道显示，?/u, ""],
    [/综上所述，?/gu, ""],
    [/可以看出，?/gu, ""],
    [/值得关注的是，?/gu, ""],
  ];
  for (const [pattern, replacement] of replacements) {
    body = body.replace(pattern, replacement);
  }

  return body.trim();
}

function syncOpinion(issue, nextOpinion) {
  const sourceArticles = Array.isArray(issue?.articles) ? issue.articles : [];
  const hasOpinionInArticles = sourceArticles.some(isOpinionArticle);
  const articles = hasOpinionInArticles
    ? sourceArticles.map((article) => (isOpinionArticle(article) ? nextOpinion : article))
    : [...sourceArticles, nextOpinion];

  const sections = { ...(issue?.sections || {}) };
  const commentItems = Array.isArray(sections["评论"])
    ? sections["评论"].filter((article) => !isOpinionArticle(article))
    : [];
  sections["评论"] = [nextOpinion, ...commentItems];

  return { ...issue, articles, sections };
}

function resolveFetch(fetchFn) {
  if (typeof fetchFn === "function") {
    return fetchFn === fetch ? fetch.bind(globalThis) : fetchFn;
  }
  return fetch.bind(globalThis);
}

function debugState(provider = null) {
  return {
    provider: provider?.id || null,
    providerSource: provider?.sourceLabel || null,
    providerHost: provider?.host || null,
    responseOk: false,
    status: null,
    parseOk: false,
    validationOk: false,
    durationMs: null,
    errorName: null,
    errorMessage: null,
    outputPreview: null,
    skipped: false,
    skipReason: null,
    evidenceCount: 0,
    annualEventsCount: 0,
    modelCalled: false,
  };
}

function sanitizeErrorMessage(message) {
  return String(message || "")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 240);
}

function summarizeFailure(status, payloadText) {
  const detail = sanitizeErrorMessage(payloadText).trim();
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

function previewOutput(text) {
  return sanitizeErrorMessage(String(text || "").trim()).slice(0, 240) || null;
}

function escapeJsonLiteralNewlines(source) {
  let result = "";
  let inString = false;
  let escaping = false;

  for (const char of String(source || "")) {
    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString && (char === "\n" || char === "\r")) {
      result += "\\n";
      continue;
    }

    result += char;
  }

  return result;
}

export async function enhanceIssueOpinion(issue, env) {
  const facts = selectEvidenceFacts(issue);
  const annualEventsCount = Array.isArray(issue?.annual_events) ? issue.annual_events.length : 0;

  if (facts.length === 0) {
    return {
      issue,
      debug: {
        ...debugState(),
        skipped: true,
        skipReason: "insufficient_evidence",
        annualEventsCount,
        errorMessage: "Skipped AI opinion: no verified historical_report fact with non-empty sources and source_excerpt",
      },
    };
  }

  const provider = resolveProvider(env);
  if (!provider) {
    return {
      issue,
      debug: {
        ...debugState(),
        skipped: true,
        skipReason: "no_provider",
        evidenceCount: facts.length,
        annualEventsCount,
        errorMessage: "No AI provider configured",
      },
    };
  }

  const baseOpinion = existingOpinion(issue);
  const debug = {
    ...debugState(provider),
    evidenceCount: facts.length,
    annualEventsCount,
  };
  const startedAt = Date.now();

  try {
    if (typeof provider.execute === "function") {
      debug.modelCalled = true;
      const payload = await provider.execute(issue, facts);
      debug.status = 200;
      debug.responseOk = true;
      debug.durationMs = Date.now() - startedAt;
      debug.outputPreview = previewOutput(parseOutputText(payload));

      const raw = parseOpinionJson(parseOutputText(payload));
      debug.parseOk = true;
      const nextOpinion = normalizeOpinion(raw, issue, facts, provider.sourceLabel, baseOpinion);
      if (!nextOpinion) {
        debug.validationOk = false;
        debug.errorMessage = "Model output failed opinion validation";
        return { issue, debug };
      }

      debug.validationOk = true;
      return { issue: syncOpinion(issue, nextOpinion), debug };
    }

    debug.modelCalled = true;
    const response = await provider.fetchFn(provider.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(provider.payload(issue, facts)),
    });
    debug.status = response.status;
    debug.responseOk = response.ok;
    debug.durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const payloadText = await response.text();
      debug.outputPreview = previewOutput(payloadText);
      debug.errorMessage = summarizeFailure(response.status, payloadText);
      return { issue, debug };
    }

    const payload = await response.json();
    debug.outputPreview = previewOutput(parseOutputText(payload));
    const raw = parseOpinionJson(parseOutputText(payload));
    debug.parseOk = true;
    const nextOpinion = normalizeOpinion(raw, issue, facts, provider.sourceLabel, baseOpinion);
    if (!nextOpinion) {
      debug.validationOk = false;
      debug.errorMessage = "Model output failed opinion validation";
      return { issue, debug };
    }

    debug.validationOk = true;
    return { issue: syncOpinion(issue, nextOpinion), debug };
  } catch (error) {
    debug.durationMs = Date.now() - startedAt;
    debug.errorName = error instanceof Error ? error.name : "Error";
    debug.errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    return { issue, debug };
  }
}

function resolveProvider(env) {
  if (typeof env?.AI?.run === "function") {
    const model = env.AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
    return {
      execute(issue, facts) {
        return env.AI.run(model, {
          messages: [
            {
              role: "system",
              content: "你是《大明新闻季报》的评论作者，只依据已核验史实写作，只输出严格 JSON。",
            },
            {
              role: "user",
              content: evidencePrompt(issue, facts),
            },
          ],
          temperature: 0.7,
          max_tokens: 700,
          response_format: {
            type: "json_schema",
            json_schema: opinionJsonSchema(),
          },
        });
      },
      host: "workers.ai",
      id: "workers_ai",
      sourceLabel: "Cloudflare Workers AI 生成评论",
    };
  }

  if (env?.LLM_API_KEY) {
    const apiBase = String(env.LLM_API_BASE || DEFAULT_LLM_BASE).replace(/\/+$/, "");
    const model = env.LLM_MODEL || DEFAULT_LLM_MODEL;
    const apiType = env.LLM_API_TYPE || "chat_completions";
    if (apiType === "chat_completions") {
      return {
        apiKey: env.LLM_API_KEY,
        fetchFn: resolveFetch(env.LLM_FETCH),
        host: new URL(`${apiBase}/chat/completions`).host,
        id: "chat_completions",
        sourceLabel: apiBase.includes("chatanywhere") ? "ChatAnywhere 生成评论" : "兼容模型生成评论",
        url: `${apiBase}/chat/completions`,
        payload(issue, facts) {
          return {
            model,
            messages: [
              {
                role: "system",
                content: "你是《大明新闻季报》的评论作者，只依据已核验史实写作，只输出严格 JSON。",
              },
              {
                role: "user",
                content: evidencePrompt(issue, facts),
              },
            ],
            temperature: 0.7,
          };
        },
      };
    }
  }

  if (env?.OPENAI_API_KEY) {
    const apiBase = String(env.OPENAI_API_BASE || DEFAULT_OPENAI_BASE).replace(/\/+$/, "");
    const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    return {
      apiKey: env.OPENAI_API_KEY,
      fetchFn: resolveFetch(env.OPENAI_FETCH),
      host: new URL(`${apiBase}/responses`).host,
      id: "openai_responses",
      sourceLabel: "OpenAI 生成评论",
      url: `${apiBase}/responses`,
      payload(issue, facts) {
        return {
          model,
          input: evidencePrompt(issue, facts),
          max_output_tokens: 700,
        };
      },
    };
  }

  return null;
}
