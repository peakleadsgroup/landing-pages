/**
 * Peak Leads System Offer — signed deal tokens + shared helpers.
 * Tokens are HMAC-SHA256 over a base64url JSON payload so price/tier cannot be edited in the URL.
 */

import { json as stripeJson, corsFor as stripeCorsFor } from "../stripe/stripe-lib.js";

export const PRODUCT = "system-offer";
export const AGREEMENT_PATH = "/system-offer.html";
export const TOKEN_VERSION = 1;

export const TIERS = {
  1: {
    id: 1,
    name: "The Vault",
    kicker: "Tier 1",
    tagline: "Everything you need to run it yourself.",
    includes: [
      "Ad bank with winners flagged",
      "Budget and pacing strategy",
      "Multiple budgets across multiple areas",
      "Full tool stack",
      "Meta setup and run SOP",
      "Out-of-area and duplicate lead removal",
      "Qualifying questions and landing page structure",
    ],
  },
  2: {
    id: 2,
    name: "Creative Engine",
    kicker: "Tier 2",
    tagline: "How to keep leads coming after the bank runs its course.",
    includes: [
      "Everything in Tier 1 — The Vault",
      "Ad creation videos (research, hook, script, assembly)",
      "Ad creation tools and sites",
      "Iteration SOP — fatigue, refreshes, and turning one winner into many",
    ],
  },
  3: {
    id: 3,
    name: "Hands-On Buildout",
    kicker: "Tier 3",
    tagline: "We get you live, then stay on it for a month.",
    includes: [
      "Everything in Tier 1 and Tier 2",
      "First 30 days of support and scheduled calls",
      "Custom landing page, built and branded for you",
      "Leads wired into your CRM — we help you connect it",
    ],
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PRICE_CENTS = 500_000_000; // $5,000,000
const MIN_PRICE_CENTS = 100; // $1.00

export function json(data, status = 200, extraHeaders = {}) {
  return stripeJson(data, status, extraHeaders);
}

export function corsFor(request) {
  const base = stripeCorsFor(request);
  return {
    ...base,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function clean(str, max = 250) {
  if (str == null) return "";
  const s = String(str).trim().replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max) : s;
}

export function isEmail(s) {
  return EMAIL_RE.test(String(s || "").trim());
}

export function parseTier(raw) {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

export function parsePriceToCents(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  const s = String(raw).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function formatUsdFromCents(cents) {
  const n = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function signingSecret(env) {
  const dedicated = String(env.SYSTEM_OFFER_SECRET || "").trim();
  if (dedicated) return dedicated;
  const stripe = String(env.STRIPE_SECRET_KEY || "").trim();
  if (stripe) return stripe;
  return "";
}

function bytesToB64Url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ToB64Url(str) {
  return bytesToB64Url(new TextEncoder().encode(str));
}

export function b64UrlToUtf8(s) {
  return new TextDecoder().decode(b64UrlToBytes(s));
}

async function hmacSha256B64Url(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToB64Url(sig);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function signToken(secret, payload) {
  const body = utf8ToB64Url(JSON.stringify(payload));
  const sig = await hmacSha256B64Url(secret, body);
  return `${body}.${sig}`;
}

export async function verifyToken(secret, token) {
  if (!token || typeof token !== "string") throw new Error("Missing offer token");
  const parts = token.trim().split(".");
  if (parts.length !== 2) throw new Error("Invalid offer token");
  const [body, sig] = parts;
  if (!body || !sig) throw new Error("Invalid offer token");
  const expected = await hmacSha256B64Url(secret, body);
  if (!timingSafeEqual(sig, expected)) throw new Error("Invalid or tampered offer link");
  let payload;
  try {
    payload = JSON.parse(b64UrlToUtf8(body));
  } catch {
    throw new Error("Invalid offer token");
  }
  return normalizePayload(payload);
}

export function normalizePayload(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid offer");
  const v = Number(raw.v);
  if (v !== TOKEN_VERSION) throw new Error("Unsupported offer version");
  const tier = parseTier(raw.tier);
  if (!tier) throw new Error("Invalid tier");
  const priceCents = Number(raw.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < MIN_PRICE_CENTS || priceCents > MAX_PRICE_CENTS) {
    throw new Error("Invalid price");
  }
  const company = clean(raw.company, 250);
  const contact = clean(raw.contact, 250);
  const email = clean(raw.email, 250).toLowerCase();
  if (!company) throw new Error("Company name is required");
  if (!contact) throw new Error("Contact name is required");
  if (!isEmail(email)) throw new Error("Valid email is required");
  return {
    v: TOKEN_VERSION,
    id: clean(raw.id, 80) || crypto.randomUUID(),
    company,
    contact,
    email,
    phone: clean(raw.phone, 50),
    vertical: clean(raw.vertical, 120),
    tier,
    priceCents,
    createdAt: clean(raw.createdAt, 40) || new Date().toISOString(),
  };
}

export function publicOffer(payload) {
  const tier = TIERS[payload.tier];
  return {
    id: payload.id,
    company: payload.company,
    contact: payload.contact,
    email: payload.email,
    phone: payload.phone || "",
    vertical: payload.vertical || "",
    tier: payload.tier,
    tierName: tier.name,
    tierKicker: tier.kicker,
    tagline: tier.tagline,
    includes: tier.includes,
    priceCents: payload.priceCents,
    priceLabel: formatUsdFromCents(payload.priceCents),
    createdAt: payload.createdAt,
  };
}

export function validateCreateBody(body) {
  const company = clean(body.company || body.businessName, 250);
  const contact = clean(body.contact || body.contactName, 250);
  const email = clean(body.email, 250).toLowerCase();
  const phone = clean(body.phone, 50);
  const vertical = clean(body.vertical, 120);
  const tier = parseTier(body.tier);
  const priceCents =
    body.priceCents != null && body.priceCents !== ""
      ? Math.round(Number(body.priceCents))
      : parsePriceToCents(body.price ?? body.amount);

  const errors = [];
  if (!company) errors.push("Company name is required");
  if (!contact) errors.push("Contact name is required");
  if (!isEmail(email)) errors.push("Valid email is required");
  if (!tier) errors.push("Select Tier 1, 2, or 3");
  if (priceCents == null || !Number.isInteger(priceCents)) errors.push("Enter a valid price");
  else if (priceCents < MIN_PRICE_CENTS) errors.push("Price must be at least $1.00");
  else if (priceCents > MAX_PRICE_CENTS) errors.push("Price is too large");

  if (errors.length) {
    const err = new Error(errors[0]);
    err.details = errors;
    throw err;
  }

  return {
    v: TOKEN_VERSION,
    id: crypto.randomUUID(),
    company,
    contact,
    email,
    phone,
    vertical,
    tier,
    priceCents,
    createdAt: new Date().toISOString(),
  };
}

export function offerUrl(origin, token) {
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}${AGREEMENT_PATH}?t=${encodeURIComponent(token)}`;
}

export function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    ""
  );
}
