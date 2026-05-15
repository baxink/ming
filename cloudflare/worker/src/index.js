import { generateIssue } from "./generator.js";

const CACHE_VERSION = "v2";
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

async function cachedIssue(env, date) {
  const cache = env?.ISSUE_CACHE;
  const historyData = await loadHistoryData(env);
  const issue = generateIssue(date, historyData);
  if (!cache) return issue;

  const key = issueCacheKey(issue);
  const cached = await cache.get(key, "json");
  if (cached) return cached;

  await cache.put(key, JSON.stringify(issue));
  return issue;
}

async function preGenerateCurrentIssue(env, scheduledTime) {
  const date = scheduledTime ? new Date(scheduledTime).toISOString().slice(0, 10) : undefined;
  const historyData = await loadHistoryData(env);
  const issue = generateIssue(date, historyData);
  const cache = env?.ISSUE_CACHE;
  if (cache) await cache.put(issueCacheKey(issue), JSON.stringify(issue));
  return issue;
}

export default {
  async fetch(request, env) {
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
      try {
        return jsonResponse(await cachedIssue(env, date));
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
