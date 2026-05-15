import { issue } from "./issue-data.js";

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

function healthPayload() {
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

export default {
  async fetch(request) {
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
      return jsonResponse(healthPayload());
    }

    if (url.pathname === "/api/issue" || url.pathname === "/api/issue/latest") {
      return jsonResponse(issue);
    }

    return jsonResponse(notFoundPayload(url.pathname), { status: 404 });
  },
};
