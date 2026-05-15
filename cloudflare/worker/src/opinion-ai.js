const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

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
    "你是《大明新闻季报》的资深社论作者。请基于本季度新闻写一篇中文时政评论。",
    "要求：",
    "1. 只使用给定新闻事实，不编造未出现的人名、地名、事件。",
    "2. 必须引用或点明本季度最重要的一条热点新闻。",
    "3. 按“判断、热点切入、制度分析、风险结论”的逻辑写，语气专业、犀利、像报纸社论。",
    "4. 评论应聚焦财政、军政、地方执行、民生承压、权力结构中的至少一个维度。",
    "5. 输出严格 JSON，不要 Markdown，不要解释。",
    "JSON 字段：headline, subhead, body。",
    `本期：${period.label || ""}，${period.start_label || ""}至${period.end_label || ""}。`,
    "本季度新闻：",
    headlines,
  ].join("\n");
}

function parseOutputText(payload) {
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

function normalizeOpinion(raw, baseOpinion, issue) {
  const headline = String(raw?.headline || "").trim();
  const subhead = String(raw?.subhead || "").trim();
  const body = String(raw?.body || "").trim();
  const focus = topArticles(issue)[0]?.headline || "";

  if (!headline || !subhead || body.length < 120) return null;
  if (focus && !body.includes(focus)) return null;

  return {
    ...baseOpinion,
    headline: headline.slice(0, 48),
    subhead: subhead.slice(0, 90),
    byline: "本报评论部",
    body: body.slice(0, 520),
    sources: Array.from(new Set([...(baseOpinion.sources || []), "OpenAI 生成评论"])),
  };
}

function replaceOpinion(issue, nextOpinion) {
  const articles = (issue.articles || []).map((article) => article.section === "评论" ? nextOpinion : article);
  const sections = { ...(issue.sections || {}) };
  sections["评论"] = [nextOpinion];
  return { ...issue, articles, sections };
}

export async function enhanceIssueOpinion(issue, env) {
  const apiKey = env?.OPENAI_API_KEY;
  const baseOpinion = fallbackOpinion(issue);
  if (!apiKey || !baseOpinion) return issue;

  const apiBase = String(env.OPENAI_API_BASE || DEFAULT_OPENAI_BASE).replace(/\/+$/, "");
  const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const fetchFn = env.OPENAI_FETCH || fetch;

  try {
    const response = await fetchFn(`${apiBase}/responses`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: commentaryPrompt(issue),
        max_output_tokens: 700,
      }),
    });
    if (!response.ok) return issue;

    const payload = await response.json();
    const raw = JSON.parse(parseOutputText(payload));
    const nextOpinion = normalizeOpinion(raw, baseOpinion, issue);
    return nextOpinion ? replaceOpinion(issue, nextOpinion) : issue;
  } catch {
    return issue;
  }
}
