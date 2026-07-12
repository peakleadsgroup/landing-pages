/**
 * POST /api/stripe/create-nationwide-checkout-session-testing
 *
 * Sandbox/test-mode copy of create-nationwide-checkout-session.
 * Uses STRIPE_TEST_SECRET_KEY (must be sk_test_), never live STRIPE_SECRET_KEY.
 *
 * Success/cancel path defaults to /nationwide-agreement.html (same page when
 * wired to testing endpoints for Drew self-test).
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
            "Stripe test key not configured. Set STRIPE_TEST_SECRET_KEY (sk_test_) for nationwide testing endpoints.",
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

    const businessName = clean(body.businessName, 250);
    const contactName = clean(body.contactName, 250);
    const email = clean(body.email, 250).toLowerCase();
    const phone = clean(body.phone, 50);
    const website = clean(body.website, 500);
    const serviceArea = clean(body.serviceArea, 2000);
    const signerName = clean(body.signerName, 250);
    const b2bLeadId = clean(body.b2bLeadId, 40);

    if (!businessName) return json({ error: "businessName is required" }, 400, cors);
    if (!contactName) return json({ error: "contactName is required" }, 400, cors);
    if (!email || !EMAIL_RE.test(email)) return json({ error: "Valid email is required" }, 400, cors);
    const phoneDigits = phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
    if (!phone || phoneDigits.length !== 10) {
      return json({ error: "Valid 10-digit phone is required" }, 400, cors);
    }
    if (!serviceArea) return json({ error: "serviceArea is required" }, 400, cors);
    if (!signerName) return json({ error: "signerName is required" }, 400, cors);
    if (b2bLeadId && !/^rec[a-zA-Z0-9]{14,}$/.test(b2bLeadId)) {
      return json({ error: "Invalid b2bLeadId" }, 400, cors);
    }

    const origin = new URL(context.request.url).origin;
    const path = "/nationwide-agreement.html";
    const successUrl = `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${path}?checkout=cancel`;

    const meta = {
      product: "nationwide",
      test_mode: "true",
      business_name: businessName,
      contact_name: contactName,
      email,
      phone,
      website,
      service_area: serviceArea.slice(0, 450),
      signer_name: signerName,
      lead_price: "49",
      payment_model: "Nationwide",
    };
    if (b2bLeadId) meta.b2b_lead_id = b2bLeadId;

    const sessionParams = {
      mode: "setup",
      "payment_method_types[0]": "card",
      customer_creation: "always",
      customer_email: email,
      client_reference_id: b2bLeadId || businessName.slice(0, 200),
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
