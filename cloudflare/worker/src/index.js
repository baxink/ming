import { generateIssue } from "./generator.js";
import { enhanceIssueOpinion } from "./opinion-ai.js";

const CACHE_VERSION = "v4";
const AI_UPGRADE_ATTEMPTS = 2;
const HISTORY_DATA_KEYS = {
  timeline: "data:v1:ming:timeline",
  disasters: "data:v1:ming:disasters",
};

const historyDataPromises = new WeakMap();

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "public, max-age=300",
};

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function healthPayload(issue) {
  return {
    ok: true,
    service: "ming-post-api",
    issue: {
      number: issue.period?.issue_number || null,
      label: issue.period?.label || null,
      real_date: issue.date?.real_date || null,
    },
  };
}

function notFoundPayload(pathname) {
  return {
    ok: false,
    error: "not_found",
    message: `No route for ${pathname}`,
  };
}

function invalidDatePayload(date) {
  return {
    ok: false,
    error: "invalid_date",
    message: `Invalid date: ${date}`,
  };
}

function unavailablePayload() {
  return {
    ok: false,
    error: "history_data_unavailable",
    message: "Historical source data is unavailable",
  };
}

function issueCacheKey(issue) {
  return `issue:${CACHE_VERSION}:${issue.period.start_year}:${issue.period.start_month}`;
}

function attachDebug(issue, debug) {
  return {
    ...issue,
    _debug: debug,
  };
}

function canUpgradeOpinion(env) {
  return Boolean(
    typeof env?.AI?.run === "function" ||
    env?.LLM_API_KEY ||
    env?.OPENAI_API_KEY,
  );
}

function hasAiOpinion(issue) {
  const opinion = issue?.sections?.["评论"]?.[0] || issue?.articles?.find((article) => article.section === "评论");
  const sources = opinion?.sources || [];
  return opinion?.byline === "本报评论部" || sources.some((source) => /生成评论/.test(String(source || "")));
}

async function loadHistoryData(env) {
  const cache = env?.ISSUE_CACHE;
  if (!cache) throw new Error("History data unavailable");
  let historyDataPromise = historyDataPromises.get(cache);
  if (!historyDataPromise) {
    historyDataPromise = Promise.all([
      cache.get(HISTORY_DATA_KEYS.timeline, "json"),
      cache.get(HISTORY_DATA_KEYS.disasters, "json"),
    ]).then(([timeline, disasters]) => {
      if (!Array.isArray(timeline) || !Array.isArray(disasters)) {
        throw new Error("History data unavailable");
      }
      return { timeline, disasters };
    });
    historyDataPromise.catch(() => historyDataPromises.delete(cache));
    historyDataPromises.set(cache, historyDataPromise);
  }
  return historyDataPromise;
}

async function upgradeIssueOpinion(cache, key, baseIssue, env) {
  let lastResult = null;
  for (let attempt = 0; attempt < AI_UPGRADE_ATTEMPTS; attempt += 1) {
    const result = await enhanceIssueOpinion(baseIssue, env);
    lastResult = result;
    if (result.debug?.validationOk) {
      await cache.put(key, JSON.stringify(result.issue));
      return { issue: result.issue, debug: result.debug, upgraded: true };
    }
  }
  return { issue: baseIssue, debug: lastResult?.debug || null, upgraded: false };
}

async function cachedIssue(env, date, options = {}) {
  const cache = env?.ISSUE_CACHE;
  const historyData = await loadHistoryData(env);
  const baseIssue = generateIssue(date, historyData);
  const key = issueCacheKey(baseIssue);
  const includeDebug = options.includeDebug === true;
  const bypassCache = options.bypassCache === true;
  const waitUntil = options.waitUntil;

  if (!cache) {
    const { issue, debug } = await enhanceIssueOpinion(baseIssue, env);
    if (!includeDebug) return issue;
    return attachDebug(issue, {
      cache: { hit: false, bypassed: true, key, available: false },
      ai: debug,
    });
  }

  if (!bypassCache) {
    const cached = await cache.get(key, "json");
    if (cached) {
      if (!includeDebug && !hasAiOpinion(cached) && canUpgradeOpinion(env) && typeof waitUntil === "function") {
        waitUntil(upgradeIssueOpinion(cache, key, cached, env));
      }
      if (!includeDebug) return cached;
      return attachDebug(cached, {
        cache: { hit: true, bypassed: false, key, available: true },
        ai: null,
      });
    }
  }

  if (bypassCache || includeDebug) {
    const { issue, debug } = await enhanceIssueOpinion(baseIssue, env);
    await cache.put(key, JSON.stringify(issue));
    if (!includeDebug) return issue;
    return attachDebug(issue, {
      cache: { hit: false, bypassed: bypassCache, key, available: true },
      ai: debug,
    });
  }

  await cache.put(key, JSON.stringify(baseIssue));
  if (canUpgradeOpinion(env) && typeof waitUntil === "function") {
    waitUntil(upgradeIssueOpinion(cache, key, baseIssue, env));
  }
  return baseIssue;
}

async function preGenerateCurrentIssue(env, scheduledTime) {
  const date = scheduledTime ? new Date(scheduledTime).toISOString().slice(0, 10) : undefined;
  const historyData = await loadHistoryData(env);
  const baseIssue = generateIssue(date, historyData);
  const cache = env?.ISSUE_CACHE;
  if (!cache) {
    const { issue } = await enhanceIssueOpinion(baseIssue, env);
    return issue;
  }

  const key = issueCacheKey(baseIssue);
  await cache.put(key, JSON.stringify(baseIssue));
  const result = await upgradeIssueOpinion(cache, key, baseIssue, env);
  return result.upgraded ? result.issue : baseIssue;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: "method_not_allowed", message: "Only GET is supported" },
        { status: 405, headers: { allow: "GET, OPTIONS" } },
      );
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      try {
        const issue = await cachedIssue(env);
        return jsonResponse(healthPayload(issue));
      } catch (error) {
        if (error instanceof Error && error.message === "History data unavailable") {
          return jsonResponse(unavailablePayload(), { status: 503, headers: { "cache-control": "no-store" } });
        }
        throw error;
      }
    }

    if (url.pathname === "/api/issue" || url.pathname === "/api/issue/latest") {
      const date = url.searchParams.get("date") || undefined;
      const includeDebug = url.searchParams.get("debug") === "1";
      const bypassCache = url.searchParams.get("refresh") === "1";
      try {
        const issue = await cachedIssue(env, date, {
          includeDebug,
          bypassCache,
          waitUntil: ctx?.waitUntil?.bind(ctx),
        });
        return jsonResponse(issue, {
          headers: includeDebug ? { "cache-control": "no-store" } : undefined,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid date:")) {
          return jsonResponse(invalidDatePayload(date || ""), { status: 400, headers: { "cache-control": "no-store" } });
        }
        if (error instanceof Error && error.message === "History data unavailable") {
          return jsonResponse(unavailablePayload(), { status: 503, headers: { "cache-control": "no-store" } });
        }
        throw error;
      }
    }

    return jsonResponse(notFoundPayload(url.pathname), { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const task = preGenerateCurrentIssue(env, event?.scheduledTime);
    if (ctx?.waitUntil) {
      ctx.waitUntil(task);
      return;
    }
    await task;
  },
};
