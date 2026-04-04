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

export async function spendTokens(telegramId, amount = 100, description = "Генерация") {
  const { data: user } = await supabase
    .from("users")
    .select("tokens_balance")
    .eq("telegram_id", telegramId)
    .single();

  if (!user || user.tokens_balance < amount) {
    return { ok: false, balance: user?.tokens_balance || 0 };
  }

  const { error } = await supabase
    .from("users")
    .update({ tokens_balance: user.tokens_balance - amount, updated_at: new Date().toISOString() })
    .eq("telegram_id", telegramId);

  if (error) throw error;

  await logTokenTransaction(telegramId, -amount, "spend", description);
  return { ok: true, balance: user.tokens_balance - amount };
}

export async function addTokens(telegramId, amount, type, description) {
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
}

async function logTokenTransaction(telegramId, amount, type, description) {
  await supabase.from("token_transactions").insert({
    user_id: telegramId,
    amount,
    type,
    description,
  });
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

export async function getUserStats(telegramId) {
  const { data: gens } = await supabase
    .from("generations")
    .select("created_at")
    .eq("user_id", telegramId);

  const total = gens?.length || 0;
  const today = gens?.filter(g => {
    const d = new Date(g.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length || 0;

  const { data: txs } = await supabase
    .from("token_transactions")
    .select("amount, type")
    .eq("user_id", telegramId);

  const spent = txs?.filter(t => t.type === "spend").reduce((s, t) => s + Math.abs(t.amount), 0) || 0;
  const earned = txs?.filter(t => t.type !== "spend").reduce((s, t) => s + t.amount, 0) || 0;

  return { total, today, spent, earned };
}
