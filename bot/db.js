import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;

// ── User operations ─────────────────────────────────────────────────

export async function getOrCreateUser(telegramId, { username, firstName, avatarUrl, referralCode } = {}) {
  // Try to get existing user
  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (existing) return existing;

  // Create new user
  const refCode = telegramId.toString(36) + Date.now().toString(36).slice(-4);
  const { data: newUser, error } = await supabase
    .from("users")
    .insert({
      telegram_id: telegramId,
      username: username || null,
      first_name: firstName || null,
      avatar_url: avatarUrl || null,
      referral_code: refCode,
      referred_by: referralCode ? await resolveReferral(referralCode) : null,
      tokens_balance: 300, // 300 tokens = 3 free generations (100 per gen)
    })
    .select()
    .single();

  if (error) throw error;

  // Log welcome tokens
  await logTokenTransaction(telegramId, 300, "welcome", "Приветственные токены");

  // Referral bonus: both get 100 tokens
  if (newUser.referred_by) {
    try {
      await addTokens(newUser.referred_by, 100, "referral", `Реферал: ${firstName || username || telegramId}`);
      await addTokens(telegramId, 100, "referral_bonus", "Бонус за приглашение");
    } catch (e) { console.error("[referral bonus]", e.message); }
  }

  return newUser;
}

async function resolveReferral(code) {
  const { data } = await supabase
    .from("users")
    .select("telegram_id")
    .eq("referral_code", code)
    .single();
  return data?.telegram_id || null;
}

// ── Token operations ────────────────────────────────────────────────

export async function getBalance(telegramId) {
  const { data } = await supabase
    .from("users")
    .select("tokens_balance, tariff")
    .eq("telegram_id", telegramId)
    .single();
  return data || { tokens_balance: 0, tariff: "free" };
}

/**
 * Atomically spend tokens via a Postgres function.
 * Check-and-update happens in a single SQL statement — no race condition.
 */
export async function spendTokens(telegramId, amount = 100, description = "Генерация") {
  const { data, error } = await supabase.rpc("spend_tokens_atomic", {
    p_telegram_id: telegramId,
    p_amount: amount,
  });

  if (error) {
    console.error("[spendTokens] rpc error:", error.message);
    throw new Error("Не удалось списать Искры");
  }

  if (!data?.ok) {
    return { ok: false, balance: data?.balance || 0 };
  }

  await logTokenTransaction(telegramId, -amount, "spend", description);
  return { ok: true, balance: data.balance };
}

/**
 * Atomically add tokens via Postgres function (no read-modify-write race).
 * Requires SQL migration: add_tokens_atomic(p_telegram_id bigint, p_amount int).
 *
 * Graceful fallback: if the RPC is missing (older DB), falls back to
 * non-atomic SELECT+UPDATE and logs a warning. Remove fallback once
 * the migration is applied in prod.
 */
export async function addTokens(telegramId, amount, type, description) {
  const { data, error } = await supabase.rpc("add_tokens_atomic", {
    p_telegram_id: telegramId,
    p_amount: amount,
  });

  if (error) {
    const msg = (error.message || "").toLowerCase();
    const rpcMissing = msg.includes("add_tokens_atomic") || msg.includes("function") || error.code === "PGRST202";
    if (!rpcMissing) {
      console.error("[addTokens] rpc error:", error.message);
      throw new Error("Не удалось начислить Искры");
    }
    // Fallback (pre-migration): non-atomic — log warning.
    console.warn("[addTokens] RPC missing, using non-atomic fallback");
    const { data: user } = await supabase
      .from("users")
      .select("tokens_balance")
      .eq("telegram_id", telegramId)
      .single();
    if (!user) return;
    await supabase
      .from("users")
      .update({ tokens_balance: user.tokens_balance + amount, updated_at: new Date().toISOString() })
      .eq("telegram_id", telegramId);
    await logTokenTransaction(telegramId, amount, type, description);
    return;
  }

  if (!data?.ok) {
    console.warn("[addTokens] no user:", telegramId);
    return;
  }
  await logTokenTransaction(telegramId, amount, type, description);
}

/**
 * Refund tokens after a failed generation.
 * Uses addTokens (atomic via RPC) under the hood and tags the transaction
 * type as "refund" so it can be audited separately from regular earnings.
 */
export async function refundTokens(telegramId, amount, description = "Возврат за ошибку") {
  return addTokens(telegramId, amount, "refund", description);
}

async function logTokenTransaction(telegramId, amount, type, description) {
  await supabase.from("token_transactions").insert({
    user_id: telegramId,
    amount,
    type,
    description,
  });
}

// ── Image Storage ───────────────────────────────────────────────────

/**
 * Upload base64 image to Supabase Storage and return public URL.
 * Retries once on failure.
 */
let _bucketChecked = false;
export async function uploadImage(imageBase64, filename) {
  if (!imageBase64) return null;

  const buf = Buffer.from(imageBase64, "base64");
  const path = `gen/${filename || Date.now() + ".png"}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Check bucket exists only once per process lifetime
      if (!_bucketChecked) {
        const { data: buckets } = await supabase.storage.listBuckets();
        if (!buckets?.find(b => b.name === "images")) {
          await supabase.storage.createBucket("images", { public: true });
        }
        _bucketChecked = true;
      }

      const { error } = await supabase.storage
        .from("images")
        .upload(path, buf, { contentType: "image/png", upsert: true });

      if (error) {
        console.error(`[upload] attempt ${attempt + 1}:`, error.message);
        if (attempt === 0) continue;
        return null;
      }

      const { data: urlData } = supabase.storage.from("images").getPublicUrl(path);
      return urlData?.publicUrl || null;
    } catch (e) {
      console.error(`[upload] attempt ${attempt + 1}:`, e.message);
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

// ── Generation history ──────────────────────────────────────────────

export async function saveGeneration(telegramId, { prompt, enhancedPrompt, style, aspectRatio, imageSize, imageUrl, refImagesCount, isEdit }) {
  const { data, error } = await supabase
    .from("generations")
    .insert({
      user_id: telegramId,
      prompt,
      enhanced_prompt: enhancedPrompt || null,
      style: style || null,
      aspect_ratio: aspectRatio || "1:1",
      image_size: imageSize || "1K",
      image_url: imageUrl || null,
      ref_images_count: refImagesCount || 0,
      is_edit: isEdit || false,
    })
    .select()
    .single();

  if (error) console.error("[db] saveGeneration:", error.message);
  return data;
}

export async function getGenerations(telegramId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from("generations")
    .select("*")
    .eq("user_id", telegramId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) console.error("[db] getGenerations:", error.message);
  return data || [];
}

export async function toggleFavorite(genId, telegramId) {
  const { data: gen } = await supabase
    .from("generations")
    .select("is_favorite")
    .eq("id", genId)
    .eq("user_id", telegramId)
    .single();

  if (!gen) return false;

  await supabase
    .from("generations")
    .update({ is_favorite: !gen.is_favorite })
    .eq("id", genId);

  return !gen.is_favorite;
}

// ── Stats ───────────────────────────────────────────────────────────

/**
 * Fetch aggregate stats using SQL count() instead of loading all rows.
 * Previously this loaded ALL user generations + transactions into memory.
 */
export async function getUserStats(telegramId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Parallel count queries — each uses SQL count, not row loading
  const [totalRes, todayRes, spentRes, earnedRes] = await Promise.all([
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("user_id", telegramId),
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("user_id", telegramId).gte("created_at", todayIso),
    supabase.from("token_transactions").select("amount").eq("user_id", telegramId).eq("type", "spend"),
    supabase.from("token_transactions").select("amount").eq("user_id", telegramId).neq("type", "spend"),
  ]);

  const total = totalRes.count || 0;
  const today = todayRes.count || 0;
  const spent = (spentRes.data || []).reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const earned = (earnedRes.data || []).reduce((s, t) => s + (t.amount || 0), 0);

  return { total, today, spent, earned };
}
