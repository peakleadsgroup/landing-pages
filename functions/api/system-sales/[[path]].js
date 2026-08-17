/**
 * Same-origin proxy for B2B System Sales ops API.
 *
 * Browser: /api/system-sales/*  →  SYSTEM_SALES_UPSTREAM/api/*
 * Auth: injects x-plg-token from Pages secret SYSTEM_SALES_API_TOKEN
 * (never expose the token to the browser).
 *
 * Env (Cloudflare Pages):
 *   SYSTEM_SALES_UPSTREAM   e.g. https://system-sales.peakleadsgroup.com
 *   SYSTEM_SALES_API_TOKEN  shared secret with Hermes ops app
 */
const ALLOWED_PREFIXES = [
  "health",
  "pipeline",
  "leads",
];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function pathOk(rel) {
  if (!rel) return false;
  // strip query already handled by URL
  const base = rel.split("?")[0].replace(/^\/+/, "");
  return ALLOWED_PREFIXES.some((p) => base === p || base.startsWith(p + "/"));
}

export async function onRequest(context) {
  const upstreamBase = (context.env.SYSTEM_SALES_UPSTREAM || "").replace(/\/+$/, "");
  const token = context.env.SYSTEM_SALES_API_TOKEN || "";
  if (!upstreamBase || !token) {
    return json(503, {
      error: "System Sales API not configured (SYSTEM_SALES_UPSTREAM / SYSTEM_SALES_API_TOKEN)",
    });
  }

  const url = new URL(context.request.url);
  // Pages [[path]] is array of segments
  const raw = context.params.path;
  const rel =
    raw == null
      ? ""
      : Array.isArray(raw)
        ? raw.filter(Boolean).join("/")
        : String(raw).replace(/^\/+/, "");

  if (!pathOk(rel)) {
    return json(400, { error: "Invalid path; expected /api/system-sales/{health|pipeline|leads…}" });
  }

  const method = context.request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (!["GET", "HEAD", "POST"].includes(method)) {
    return json(405, { error: "Method not allowed" });
  }

  const target = `${upstreamBase}/api/${rel}${url.search}`;
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("x-plg-token", token);
  const ct = context.request.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);

  /** @type {RequestInit} */
  const init = { method, headers, redirect: "follow" };
  if (method === "POST") {
    init.body = context.request.body;
  }

  let res;
  try {
    res = await fetch(target, init);
  } catch (err) {
    return json(502, { error: "Upstream unreachable", detail: String(err && err.message ? err.message : err) });
  }

  const outHeaders = new Headers(res.headers);
  outHeaders.set("Cache-Control", "no-store");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}
