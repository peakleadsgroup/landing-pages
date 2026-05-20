/**
 * Smoke-test agreement Checkout Session params against Stripe (test mode).
 *
 * Usage (PowerShell):
 *   $env:STRIPE_SECRET_KEY = "sk_test_..."
 *   node scripts/test-stripe-checkout.mjs
 *
 * Or set STRIPE_TEST_SECRET_KEY instead.
 */
import {
  CHECKOUT_CARD_ONLY_BASE_PARAMS,
  CHECKOUT_DISABLE_LINK_PARAMS,
  STRIPE_CHECKOUT_API_VERSION,
  resolveStripeTestSecretKey,
  stripeEnvWithSecretKey,
  stripePostForm,
} from "../functions/api/stripe/stripe-lib.js";

const sk = resolveStripeTestSecretKey(process.env);
if (!sk) {
  console.error(
    "Set STRIPE_TEST_SECRET_KEY or STRIPE_SECRET_KEY to an sk_test_ key, then re-run."
  );
  process.exit(1);
}

const env = stripeEnvWithSecretKey(process.env, sk);
const sessionFields = {
  "customer_creation": "always",
  success_url: "https://example.com/agreement-testing.html?recordID=recTEST&session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://example.com/agreement-testing.html?recordID=recTEST&checkout=cancel",
  "line_items[0][quantity]": "1",
  "line_items[0][price_data][currency]": "usd",
  "line_items[0][price_data][unit_amount]": "100",
  "line_items[0][price_data][product_data][name]": "Checkout smoke test",
};

async function tryCreate(label, params, apiVersion) {
  console.log("\n---", label, "---");
  if (apiVersion) console.log("Stripe-Version:", apiVersion);
  try {
    const session = await stripePostForm(env, "/v1/checkout/sessions", params, { apiVersion });
    console.log("OK", session.id, session.url ? "(url returned)" : "(no url)");
    return true;
  } catch (e) {
    console.error("FAIL", e.message || e);
    return false;
  }
}

const baseOnly = { ...CHECKOUT_CARD_ONLY_BASE_PARAMS, ...sessionFields };
const withLinkOff = { ...baseOnly, ...CHECKOUT_DISABLE_LINK_PARAMS };

let ok = await tryCreate("card only (default API)", baseOnly);
if (!ok) process.exit(2);

ok = await tryCreate("card + wallet_options.link never", withLinkOff, STRIPE_CHECKOUT_API_VERSION);
if (!ok) {
  console.log("\nwallet_options failed on", STRIPE_CHECKOUT_API_VERSION, "— production code will fall back to card-only.");
}

console.log("\nDone. Use agreement-testing.html with the same sk_test_ key in Cloudflare env.");
