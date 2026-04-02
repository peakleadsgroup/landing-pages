/**
 * Same-origin proxy for the Airtable REST API. Adds Authorization from the
 * Cloudflare secret AIRTABLE_API_KEY (Pages/Workers env binding).
 *
 * Client: fetch("/api/airtable/v0/{baseId}/{tableId}?…", { method, headers, body })
 * — do not send Bearer tokens from the browser.
 */
const ALLOWED_PREFIX = "v0/";

export async function onRequest(context) {
  const apiKey = context.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Airtable API not configured (AIRTABLE_API_KEY)" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const raw = context.params.path;
  /** Pages catch-all [[path]] is an array of segments, not a slash-separated string. */
  const path =
    raw == null
      ? ""
      : Array.isArray(raw)
        ? raw.filter(Boolean).join("/")
        : String(raw).replace(/^\/+/, "");
  if (!path || !path.startsWith(ALLOWED_PREFIX)) {
    return new Response(JSON.stringify({ error: "Invalid path; expected /api/airtable/v0/…" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const targetUrl = `https://api.airtable.com/${path}${url.search}`;

  const method = context.request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (!["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${apiKey}`);
  const ct = context.request.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  const accept = context.request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);

  /** @type {RequestInit} */
  const init = { method, headers, redirect: "follow" };
  if (!["GET", "HEAD"].includes(method)) {
    init.body = context.request.body;
  }

  const res = await fetch(targetUrl, init);
  const out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  return out;
}
