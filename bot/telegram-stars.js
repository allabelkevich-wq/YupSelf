/**
 * Telegram Stars payment integration (native Telegram Wallet).
 *
 * Flow:
 *   1. Client asks for an invoice link via POST /api/stars/create.
 *   2. Server calls bot.api.createInvoiceLink (currency=XTR, provider_token="").
 *   3. Client opens the link via tg.openInvoice(link).
 *   4. Telegram → bot receives update `pre_checkout_query` → we answer true.
 *   5. Telegram → bot receives `message.successful_payment` → we credit Искры
 *      inside an idempotent DB insert (processed_stars_invoices.payload).
 *
 * Why Stars in addition to DARAI:
 *   DARAI (NEAR) is the flagship payment method — keep it first.
 *   Stars is the zero-friction fallback for users without a NEAR wallet.
 */

// Package catalogue — roughly mirrors YupPay pricing but denominated in Stars.
// XTR rate at time of writing: 1 XTR ≈ $0.013. 100 Искр at ~$1 USD ≈ 75 XTR.
// Adjust the rate via env STARS_PER_ISKRA if you want to re-price without a deploy.
const DEFAULT_STARS_PER_ISKRA = 0.75; // 100 Искр ≈ 75 Stars

function starsPerIskra() {
  const v = Number(process.env.STARS_PER_ISKRA);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STARS_PER_ISKRA;
}

/** Same tiers/discounts as YupPay — consistent pricing across channels. */
const STARS_TIERS = [
  { id: "stars_100",  tokens: 100,  discount: 0,  label: "100 Искр" },
  { id: "stars_300",  tokens: 300,  discount: 5,  label: "300 Искр · −5%" },
  { id: "stars_700",  tokens: 700,  discount: 10, label: "700 Искр · −10%" },
  { id: "stars_1500", tokens: 1500, discount: 15, label: "1500 Искр · −15%" },
  { id: "stars_3500", tokens: 3500, discount: 20, label: "3500 Искр · −20%" },
];

export function getStarsPackages() {
  const rate = starsPerIskra();
  return STARS_TIERS.map((t) => {
    const base = t.tokens * rate;
    const price = Math.max(1, Math.round(base * (1 - t.discount / 100)));
    return {
      id: t.id,
      tokens: t.tokens,
      stars: price,
      discount: t.discount,
      label: `${t.label} = ${price} ⭐`,
    };
  });
}

/**
 * Create an invoice link the client can open with tg.openInvoice(link).
 * @param {import("grammy").Bot} bot
 * @param {{ packageId: string, telegramId: number }} params
 * @returns {Promise<{ invoiceId: string, payUrl: string, package: object }>}
 */
export async function createStarsInvoice(bot, { packageId, telegramId }) {
  const pkg = getStarsPackages().find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Unknown Stars package: ${packageId}`);
  if (!telegramId) throw new Error("telegramId is required");

  // Deterministic-ish invoice id, opaque to the client. The payload also
  // carries telegramId + packageId so the webhook never has to trust the
  // client for those.
  const crypto = await import("crypto");
  const invoiceId = "stars_" + crypto.randomBytes(10).toString("hex");
  const payload = JSON.stringify({ v: 1, invoiceId, telegramId: Number(telegramId), packageId: pkg.id, tokens: pkg.tokens });

  const link = await bot.api.createInvoiceLink(
    `YupSelf · ${pkg.tokens} Искр`,
    `Пополнение баланса: ${pkg.tokens} Искр${pkg.discount ? ` (скидка ${pkg.discount}%)` : ""}`,
    payload,
    "", // provider_token — MUST be empty for Stars (XTR)
    "XTR",
    [{ label: `${pkg.tokens} Искр`, amount: pkg.stars }],
  );

  return { invoiceId, payUrl: link, package: pkg };
}

/**
 * Parse the payload we embedded when creating the invoice. Returns null on
 * malformed input (e.g. someone sending a crafted successful_payment).
 */
export function parseStarsPayload(raw) {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const j = JSON.parse(raw);
    if (j.v !== 1) return null;
    const telegramId = Number(j.telegramId);
    const tokens = Number(j.tokens);
    if (!Number.isFinite(telegramId) || !Number.isFinite(tokens)) return null;
    if (tokens <= 0 || tokens > 100_000) return null;
    return { invoiceId: String(j.invoiceId || ""), telegramId, packageId: String(j.packageId || ""), tokens };
  } catch {
    return null;
  }
}
