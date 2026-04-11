import "dotenv/config";
import crypto from "crypto";

// ── YupPay API client ────────────────────────────────────────────────
// Docs: https://www.yupland.io/pay/api
// Flow: create_invoice → return pay_url / pay_tg_url → user pays →
//       YupPay worker POSTs payment.confirmed to our webhook (signed)

const YUPPAY_URL = "https://jkjgpbawhxtafmwsrseb.supabase.co/functions/v1/yuppay-api";
const YUPPAY_API_KEY = process.env.YUPPAY_API_KEY;
const YUPPAY_WEBHOOK_SECRET = process.env.YUPPAY_WEBHOOK_SECRET;

// Supabase anon key for the YupLand project (public — used as frontdoor auth for Edge Functions)
const YUPPAY_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpramdwYmF3aHh0YWZtd3Nyc2ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAzMDA3NjgsImV4cCI6MjA3NTg3Njc2OH0.Il2w6Vd40hGnosvI0QJKn2bHlZNrNvnl7UZxB92_vAQ";

// 1 DARAI = 10^24 yocto (NEAR FT standard, 24 decimals)
const DARAI_DECIMALS = 24n;
const ONE_DARAI = 10n ** DARAI_DECIMALS;

/**
 * Convert DARAI number → yocto string (required by API).
 * Example: 1.5 → "1500000000000000000000000"
 */
export function daraiToYocto(amountDarai) {
  const str = String(amountDarai);
  const [intPart, fracPart = ""] = str.split(".");
  const fracPadded = (fracPart + "0".repeat(24)).slice(0, 24);
  const combined = (intPart || "0") + fracPadded;
  return combined.replace(/^0+/, "") || "0";
}

/**
 * Pricing for YupSelf Искры packages (in DARAI).
 * 1 generation = 100 Искр. User balance in Supabase `users.tokens_balance`.
 * No USD conversion — fixed DARAI amounts.
 */
export const YUPPAY_PACKAGES = [
  { id: "pack_500",   tokens: 500,   darai: 3_500_000,   label: "500 Искр (5 генераций)",    discount: 0 },
  { id: "pack_1000",  tokens: 1000,  darai: 7_000_000,   label: "1 000 Искр (10 генераций)", discount: 0 },
  { id: "pack_5000",  tokens: 5000,  darai: 31_500_000,  label: "5 000 Искр (50 генераций) −10%",  discount: 10 },
  { id: "pack_10000", tokens: 10000, darai: 56_000_000,  label: "10 000 Искр (100 генераций) −20%", discount: 20 },
  { id: "pack_20000", tokens: 20000, darai: 105_000_000, label: "20 000 Искр (200 генераций) −25%", discount: 25 },
];

/**
 * Low-level call to YupPay API.
 */
async function _callYupPay(action, body = {}) {
  if (!YUPPAY_API_KEY) throw new Error("YUPPAY_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(YUPPAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: YUPPAY_SUPABASE_ANON,
        Authorization: `Bearer ${YUPPAY_SUPABASE_ANON}`,
        "x-yuppay-api-key": YUPPAY_API_KEY,
      },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (!res.ok || data.ok === false) {
      const msg = data.error || data.message || `HTTP ${res.status}`;
      throw new Error(`YupPay ${action}: ${msg}`);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("YupPay timeout");
    throw err;
  }
}

/**
 * Create a payment invoice.
 *
 * @param {Object} params
 * @param {string} params.packageId — one of YUPPAY_PACKAGES.id
 * @param {number} params.telegramId — user's Telegram id (for webhook matching)
 * @param {string} [params.publicBaseUrl] — our app base URL for return links
 * @returns {{ invoiceId, payUrl, payTgUrl, amountDarai, tokens }}
 */
export async function createInvoice({ packageId, telegramId, publicBaseUrl }) {
  const pkg = YUPPAY_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Unknown package: ${packageId}`);

  const amountRaw = daraiToYocto(pkg.darai);
  const metadata = {
    package_id: pkg.id,
    tokens: pkg.tokens,
    telegram_chat_id: String(telegramId),
    order_id: `yupself_${telegramId}_${Date.now()}`,
  };

  const data = await _callYupPay("create_invoice", {
    token_contract_id: "darai.tkn.near",
    amount_raw: amountRaw,
    metadata,
    public_base_url: publicBaseUrl || "https://yupself-bot.onrender.com",
  });

  return {
    invoiceId: data.invoice?.id || data.invoice?.public_token,
    publicToken: data.invoice?.public_token,
    payUrl: data.pay_url || data.links?.browser,
    payTgUrl: data.pay_tg_url || data.links?.telegram_mini_app,
    amountDarai: pkg.darai,
    tokens: pkg.tokens,
    packageId: pkg.id,
    status: data.invoice?.status || "pending",
  };
}

/**
 * Check invoice status (optional — webhook is the primary path).
 */
export async function getInvoice(invoiceId) {
  const data = await _callYupPay("get_invoice", { invoice_id: invoiceId });
  return data.invoice || null;
}

/**
 * Verify webhook signature (HMAC-SHA256 of raw body using webhook secret).
 *
 * YupPay sends:
 *   Header `x-yuppay-signature`: hex-encoded HMAC-SHA256 of raw request body
 *   (Some implementations also include `x-yuppay-timestamp` for replay protection)
 *
 * @param {string|Buffer} rawBody — raw request body bytes
 * @param {string} signature — value of X-Yuppay-Signature header
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!YUPPAY_WEBHOOK_SECRET || !signature) return false;
  try {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
    const expected = crypto
      .createHmac("sha256", YUPPAY_WEBHOOK_SECRET)
      .update(bodyStr)
      .digest("hex");

    // Normalise signature: some sources may prefix with "sha256="
    const cleanSig = signature.replace(/^sha256=/i, "").trim();

    // Constant-time comparison
    if (expected.length !== cleanSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(cleanSig, "hex"));
  } catch {
    return false;
  }
}
