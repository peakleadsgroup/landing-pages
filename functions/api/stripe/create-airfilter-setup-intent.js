/**
 * POST /api/stripe/create-airfilter-setup-intent
 *
 * Creates a Stripe Customer + SetupIntent for the Home Filter Plan landing page
 * so the card can be collected with Stripe Elements on-page (no hosted Checkout,
 * so Peak Leads Group branding is not shown).
 *
 * Uses STRIPE_TEST_SECRET_KEY (+ STRIPE_TEST_PUBLISHABLE_KEY / STRIPE_PUBLISHABLE_KEY).
 *
 * Body JSON: { email, name?, ...signup metadata }
 * Returns: { clientSecret, customerId, setupIntentId, publishableKey, testMode }
 */
import {
  json,
  corsFor,
  stripePostForm,
  resolveStripeTestSecretKey,
  resolveStripeTestPublishableKey,
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
    const publishableKey = resolveStripeTestPublishableKey(context.env);
    if (!publishableKey) {
      return json(
        {
          error:
            "Stripe test publishable key not configured. Set STRIPE_TEST_PUBLISHABLE_KEY (pk_test_) in Cloudflare.",
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
      return json({ error: "Stripe did not return a setup client secret" }, 502, cors);
    }

    return json(
      {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        customerId: customer.id,
        publishableKey,
        testMode: true,
        livemode: !!setupIntent.livemode,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
