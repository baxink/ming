import { generateIssue } from "./generator.js";

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
      const issue = generateIssue();
      return jsonResponse(healthPayload(issue));
    }

    if (url.pathname === "/api/issue" || url.pathname === "/api/issue/latest") {
      const date = url.searchParams.get("date") || undefined;
      try {
        return jsonResponse(generateIssue(date));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid date:")) {
          return jsonResponse(invalidDatePayload(date || ""), { status: 400, headers: { "cache-control": "no-store" } });
        }
        throw error;
      }
    }

    return jsonResponse(notFoundPayload(url.pathname), { status: 404 });
  },
};
