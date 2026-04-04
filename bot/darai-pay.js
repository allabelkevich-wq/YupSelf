import "dotenv/config";
import crypto from "crypto";
import supabase from "./db.js";
import { addTokens } from "./db.js";

// NEAR RPC for checking DARAI transfers
const NEAR_RPC = "https://rpc.mainnet.near.org";
const DARAI_CONTRACT = "darai.tkn.near";
const MERCHANT_ACCOUNT = process.env.DARAI_MERCHANT_ACCOUNT || "yupself.near";

// Token packages: DARAI amount → YupSelf tokens
const PACKAGES = [
  { id: "starter", darai: 500, tokens: 500, label: "500 токенов (5 генераций)" },
  { id: "basic", darai: 1500, tokens: 2000, label: "2000 токенов (20 генераций)" },
  { id: "pro", darai: 3000, tokens: 5000, label: "5000 токенов (50 генераций)" },
  { id: "ultra", darai: 5000, tokens: 10000, label: "10000 токенов (100 генераций)" },
];

export { PACKAGES, MERCHANT_ACCOUNT };

/**
 * Create a payment request — returns memo code for user to include in transfer.
 */
export async function createPayment(telegramId, packageId) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error("Unknown package: " + packageId);

  const memo = crypto.randomBytes(4).toString("hex"); // 8-char unique code

  // Save to Supabase
  const { data, error } = await supabase
    .from("darai_payments")
    .insert({
      telegram_id: telegramId,
      package_id: pkg.id,
      darai_amount: pkg.darai,
      tokens_amount: pkg.tokens,
      memo,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw error;

  return {
    paymentId: data.id,
    memo,
    daraiAmount: pkg.darai,
    tokensAmount: pkg.tokens,
    merchantAccount: MERCHANT_ACCOUNT,
    label: pkg.label,
  };
}

/**
 * Check if a DARAI payment was received by querying NEAR RPC for recent transfers.
 */
export async function checkPayment(paymentId) {
  // Get payment from DB
  const { data: payment } = await supabase
    .from("darai_payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (!payment) throw new Error("Payment not found");
  if (payment.status === "completed") return { status: "completed", payment };

  // Check NEAR blockchain for transfer with this memo
  try {
    const found = await findDaraiTransfer(
      payment.memo,
      payment.darai_amount
    );

    if (found) {
      // Mark as completed
      await supabase
        .from("darai_payments")
        .update({
          status: "completed",
          tx_hash: found.txHash,
          paid_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      // Credit tokens to user
      await addTokens(
        payment.telegram_id,
        payment.tokens_amount,
        "purchase",
        `Пакет ${payment.package_id}: ${payment.tokens_amount} токенов за ${payment.darai_amount} DARAI`
      );

      return { status: "completed", payment: { ...payment, status: "completed" } };
    }
  } catch (err) {
    console.error("[darai-pay] check error:", err.message);
  }

  return { status: "pending", payment };
}

/**
 * Query NearBlocks API for recent DARAI transfers to merchant account with memo.
 */
async function findDaraiTransfer(memo, expectedAmount) {
  try {
    // Use NearBlocks API to check recent FT transfers
    const url = `https://api.nearblocks.io/v1/account/${MERCHANT_ACCOUNT}/ft-txns?token=${DARAI_CONTRACT}&limit=20&order=desc`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const txns = data.txns || data.data || [];

    // Look for transfer with matching memo or amount
    for (const tx of txns) {
      const args = tx.args || {};
      const txMemo = args.memo || tx.memo || "";
      const txAmount = Number(args.amount || tx.amount || 0) / 1e18; // 18 decimals

      if (txMemo === memo && txAmount >= expectedAmount) {
        return { txHash: tx.transaction_hash || tx.hash };
      }
    }
  } catch (err) {
    console.error("[darai-pay] nearblocks query:", err.message);
  }

  // Fallback: NEAR RPC view of recent activity
  try {
    const res = await fetch(NEAR_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: DARAI_CONTRACT,
          method_name: "ft_balance_of",
          args_base64: btoa(JSON.stringify({ account_id: MERCHANT_ACCOUNT })),
        },
      }),
    });

    const rpc = await res.json();
    if (rpc.result?.result) {
      const balance = JSON.parse(
        String.fromCharCode(...rpc.result.result)
      );
      console.log("[darai-pay] merchant DARAI balance:", balance);
    }
  } catch {}

  return null;
}

/**
 * Get all pending payments for a user.
 */
export async function getPendingPayments(telegramId) {
  const { data } = await supabase
    .from("darai_payments")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return data || [];
}
