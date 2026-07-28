/**
 * POST /api/stripe/create-airfilter-setup-session
 *
 * Creates a Stripe Checkout Session in setup mode (save card, no charge)
 * for the Home Filter Plan landing page. Uses STRIPE_TEST_SECRET_KEY
 * (or STRIPE_SECRET_KEY when it is already sk_test_).
 *
 * Body JSON: {
 *   email, name?,
 *   filterCount?, frequencyMonths?, price?,
 *   knowsSizes?, timing?, shipDate?, address?, filterSizes?
 * }
 */
import {
  json,
  corsFor,
  stripePostForm,
  CHECKOUT_DISABLE_LINK_PARAMS,
  STRIPE_CHECKOUT_API_VERSION,
  resolveStripeTestSecretKey,
  stripeEnvWithSecretKey,
} from "./stripe-lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max = 250) {
  if (str == null) return "";
  const s = String(str).trim();
  return s.length > max ? s.slice(0, max) : s;
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
    const sandboxKey = resolveStripeTestSecretKey(context.env);
    if (!sandboxKey) {
      return json(
        {
          error:
            "Stripe test key not configured. Set STRIPE_TEST_SECRET_KEY (sk_test_) in Cloudflare.",
        },
        503,
        cors
      );
    }
    const stripeEnv = stripeEnvWithSecretKey(context.env, sandboxKey);

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

    const origin = new URL(context.request.url).origin;
    const path = "/main/airfilters.html";
    const successUrl = `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${path}?checkout=cancel`;

    const meta = {
      product: "airfilter",
      test_mode: "true",
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
            ? [
                body.address.street,
                body.address.city,
                body.address.state,
                body.address.zip,
              ]
                .filter(Boolean)
                .join(", ")
            : "",
        450
      ),
    };

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

    if (!session.url) {
      return json({ error: "Stripe did not return a checkout URL" }, 502, cors);
    }

    return json(
      { url: session.url, sessionId: session.id, testMode: true, livemode: !!session.livemode },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
