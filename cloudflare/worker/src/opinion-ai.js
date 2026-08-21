const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_LLM_BASE = "https://api.chatanywhere.tech/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function topArticles(issue) {
  return [issue.lead, ...(issue.articles || [])]
    .filter((article) => article && article.section !== "评论" && article.event_type !== "opinion")
    .slice(0, 6);
}

function fallbackOpinion(issue) {
  return issue.sections?.["评论"]?.[0] || issue.articles?.find((article) => article.section === "评论") || null;
}

function commentaryPrompt(issue) {
  const period = issue.period || {};
  const headlines = topArticles(issue).map((article, index) => {
    const body = String(article.body || "").slice(0, 120);
    return `${index + 1}. [${article.section}] ${article.headline}：${body}`;
  }).join("\n");

  return [
    "你是《大明新闻季报》的资深社论作者。请基于本季度新闻写一篇真正像报纸社论的中文时评。",
    "要求：",
    "1. 只使用给定新闻事实，不编造未出现的人名、地名、事件。",
    "2. 必须围绕本季度一条最重要的热点新闻立论，开头两句内点明矛盾，不要写季度综述。",
    "3. 按“判断、热点切入、制度分析、风险结论”的逻辑写，语气专业、犀利、像报纸社论。",
    "4. 评论应聚焦财政、军政、地方执行、民生承压、权力结构中的至少一个维度，必须指出朝廷真正的问题不在表面消息，而在制度和执行。",
    "5. 输出严格 JSON，不要 Markdown，不要解释。",
    "6. body 必须是单个中文字符串，不得输出数组、对象、分点字段或嵌套 JSON。",
    "7. 禁止使用“本季度的新闻报道显示”“综上所述”“可以看出”“值得关注的是”等总结腔。",
    "8. headline 必须像报纸社论标题，直接下判断；不要写“季度评论”“综述”“观察”。",
    "JSON 字段：headline, subhead, body。",
    `本期：${period.label || ""}，${period.start_label || ""}至${period.end_label || ""}。`,
    "本季度新闻：",
    headlines,
  ].join("\n");
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

function normalizeOpinion(raw, baseOpinion, issue, sourceLabel) {
  const headline = normalizeEditorialHeadline(raw?.headline);
  const subhead = String(raw?.subhead || "").trim();
  const body = normalizeEditorialBody(normalizeBody(raw?.body));
  const focusHeadlines = topArticles(issue).map((article) => article?.headline || "").filter(Boolean);

  if (!headline || !subhead || body.length < 120) return null;
  if (focusHeadlines.length > 0) {
    const matchesHotspot = focusHeadlines.some((focus) => {
      if (body.includes(focus)) return true;
      return headlineKeywords(focus).some((keyword) => body.includes(keyword));
    });
    if (!matchesHotspot) return null;
  }

  return {
    ...baseOpinion,
    headline: headline.slice(0, 48),
    subhead: subhead.slice(0, 90),
    byline: "本报评论部",
    body: body.slice(0, 520),
    sources: Array.from(new Set([...(baseOpinion.sources || []), sourceLabel])),
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

function replaceOpinion(issue, nextOpinion) {
  const articles = (issue.articles || []).map((article) => article.section === "评论" ? nextOpinion : article);
  const sections = { ...(issue.sections || {}) };
  sections["评论"] = [nextOpinion];
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
  const baseOpinion = fallbackOpinion(issue);
  if (!baseOpinion) {
    return {
      issue,
      debug: { ...debugState(), errorMessage: "Missing base opinion article" },
    };
  }

  const provider = resolveProvider(env);
  if (!provider) {
    return {
      issue,
      debug: { ...debugState(), errorMessage: "No AI provider configured" },
    };
  }

  const debug = debugState(provider);
  const startedAt = Date.now();

  try {
    if (typeof provider.execute === "function") {
      const payload = await provider.execute(issue);
      debug.status = 200;
      debug.responseOk = true;
      debug.durationMs = Date.now() - startedAt;
      debug.outputPreview = previewOutput(parseOutputText(payload));

      const raw = parseOpinionJson(parseOutputText(payload));
      debug.parseOk = true;
      const nextOpinion = normalizeOpinion(raw, baseOpinion, issue, provider.sourceLabel);
      if (!nextOpinion) {
        debug.validationOk = false;
        debug.errorMessage = "Model output failed opinion validation";
        return { issue, debug };
      }

      debug.validationOk = true;
      return { issue: replaceOpinion(issue, nextOpinion), debug };
    }

    const response = await provider.fetchFn(provider.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(provider.payload(issue)),
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
    const nextOpinion = normalizeOpinion(raw, baseOpinion, issue, provider.sourceLabel);
    if (!nextOpinion) {
      debug.validationOk = false;
      debug.errorMessage = "Model output failed opinion validation";
      return { issue, debug };
    }

    debug.validationOk = true;
    return { issue: replaceOpinion(issue, nextOpinion), debug };
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
      execute(issue) {
        return env.AI.run(model, {
          messages: [
            {
              role: "system",
              content: "你是《大明新闻季报》的资深社论作者，只输出严格 JSON。",
            },
            {
              role: "user",
              content: commentaryPrompt(issue),
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
        payload(issue) {
          return {
            model,
            messages: [
              {
                role: "system",
                content: "你是《大明新闻季报》的资深社论作者，只输出严格 JSON。",
              },
              {
                role: "user",
                content: commentaryPrompt(issue),
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
      payload(issue) {
        return {
          model,
          input: commentaryPrompt(issue),
          max_output_tokens: 700,
        };
      },
    };
  }

  return null;
}
