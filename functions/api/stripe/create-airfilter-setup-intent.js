/**
 * POST /api/stripe/create-airfilter-setup-intent
 *
 * HomeFilter card-on-file — LIVE MODE.
 * Uses STRIPE_SECRET_KEY (sk_live_) and STRIPE_PUBLISHABLE_KEY (pk_live_).
 *
 * Preferred: Stripe Elements when publishable key is set.
 * Fallback: hosted Checkout setup session if publishable key is missing.
 *
 * Body JSON: { email, name?, ...signup metadata }
 * Returns either:
 *   { mode: "elements", clientSecret, publishableKey, ... }
 *   { mode: "checkout", url, sessionId, ... }
 */
import {
  json,
  corsFor,
  stripePostForm,
  CHECKOUT_DISABLE_LINK_PARAMS,
  STRIPE_CHECKOUT_API_VERSION,
  resolveStripeLiveSecretKey,
  resolveStripeLivePublishableKey,
  stripeEnvWithSecretKey,
} from "./stripe-lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max = 250) {
  if (str == null) return "";
  const s = String(str).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function buildMeta(body, email, name) {
  return {
    product: "airfilter",
    test_mode: "false",
    email,
    name,
    filter_count: clean(body.filterCount, 20),
    frequency_months: clean(body.frequencyMonths, 20),
    price: clean(body.price, 20),
    knows_sizes: body.knowsSizes === true ? "true" : body.knowsSizes === false ? "false" : "",
    timing: clean(body.timing, 40),
    ship_date: clean(body.shipDate, 40),
    address: clean(
      typeof body.address === "string"
        ? body.address
        : body.address
          ? [body.address.street, body.address.city, body.address.state, body.address.zip]
              .filter(Boolean)
              .join(", ")
          : "",
      450
    ),
  };
}

async function createElementsSetup(stripeEnv, publishableKey, email, name, meta) {
  const customerParams = {
    email,
    description: "HomeFilter.co subscription signup",
  };
  if (name) customerParams.name = name;
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === "") continue;
    customerParams[`metadata[${k}]`] = String(v).slice(0, 500);
  }

  const customer = await stripePostForm(stripeEnv, "/v1/customers", customerParams);

  const setupParams = {
    customer: customer.id,
    "payment_method_types[0]": "card",
    usage: "off_session",
  };
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === "") continue;
    setupParams[`metadata[${k}]`] = String(v).slice(0, 500);
  }

  const setupIntent = await stripePostForm(stripeEnv, "/v1/setup_intents", setupParams);
  if (!setupIntent.client_secret) {
    throw new Error("Stripe did not return a setup client secret");
  }

  return {
    mode: "elements",
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
    customerId: customer.id,
    publishableKey,
    testMode: false,
    livemode: !!setupIntent.livemode,
  };
}

async function createCheckoutSetup(stripeEnv, requestUrl, email, name, meta) {
  const origin = new URL(requestUrl).origin;
  const path = "/main/airfilters.html";
  const successUrl = `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}${path}?checkout=cancel`;

  const sessionParams = {
    mode: "setup",
    "payment_method_types[0]": "card",
    customer_creation: "always",
    customer_email: email,
    client_reference_id: ("airfilter:" + email).slice(0, 200),
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...CHECKOUT_DISABLE_LINK_PARAMS,
  };
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === "") continue;
    sessionParams[`metadata[${k}]`] = String(v).slice(0, 500);
    sessionParams[`setup_intent_data[metadata][${k}]`] = String(v).slice(0, 500);
  }

  let session;
  try {
    session = await stripePostForm(stripeEnv, "/v1/checkout/sessions", sessionParams, {
      apiVersion: STRIPE_CHECKOUT_API_VERSION,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    if (!/wallet_options|unknown parameter/i.test(msg)) throw e;
    const retry = { ...sessionParams };
    delete retry["wallet_options[link][display]"];
    session = await stripePostForm(stripeEnv, "/v1/checkout/sessions", retry);
  }

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  return {
    mode: "checkout",
    url: session.url,
    sessionId: session.id,
    testMode: false,
    livemode: !!session.livemode,
    note: "Using Checkout because STRIPE_PUBLISHABLE_KEY (pk_live_) is not set. Add it for on-page Elements.",
  };
}

export async function onRequest(context) {
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const liveKey = resolveStripeLiveSecretKey(context.env);
    if (!liveKey) {
      return json(
        {
          error:
            "Stripe live secret not configured. Set STRIPE_SECRET_KEY (sk_live_) in Cloudflare.",
        },
        503,
        cors
      );
    }

    const stripeEnv = stripeEnvWithSecretKey(context.env, liveKey);

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const email = clean(body.email, 250).toLowerCase();
    const name = clean(body.name || body.cardName || "", 250);
    if (!email || !EMAIL_RE.test(email)) {
      return json({ error: "Valid email is required" }, 400, cors);
    }

    const meta = buildMeta(body, email, name);
    const publishableKey = resolveStripeLivePublishableKey(context.env);

    const payload = publishableKey
      ? await createElementsSetup(stripeEnv, publishableKey, email, name, meta)
      : await createCheckoutSetup(stripeEnv, context.request.url, email, name, meta);

    return json(payload, 200, cors);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
