import "dotenv/config";
import { Bot, InputFile, InlineKeyboard, session } from "grammy";
import express from "express";
import { enhancePrompt, translatePrompt, generateImage, editImage } from "./openrouter.js";
import { transcribeAudio } from "./groq.js";
import supabase, { getOrCreateUser, getBalance, spendTokens, addTokens, saveGeneration, getGenerations, getUserStats, toggleFavorite, uploadImage } from "./db.js";
import { createPayment, checkPayment, getPendingPayments, PACKAGES, MERCHANT_ACCOUNT } from "./darai-pay.js";
import { createInvoice as yuppayCreateInvoice, verifyWebhookSignature as yuppayVerifySig, getYupPayPackages, getCurrentRate } from "./yuppay.js";
import { saveFace, getSavedFaces, getFaceImage, deleteFace } from "./sessions.js";
import { generateAstroImage } from "./astro-worker.js";

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

/** Send a message to all admins. */
async function notifyAdmins(text) {
  for (const id of ADMIN_IDS) {
    try {
      await bot.api.sendMessage(id, text, { parse_mode: "HTML" });
    } catch (err) {
      console.warn(`[notify] Failed to message admin ${id}:`, err.message);
    }
  }
}

// ── Session ─────────────────────────────────────────────────────────
bot.use(
  session({
    initial: () => ({
      pendingPrompt: null,
      lastPrompt: null,
      style: null, // null = AI выбирает сам
      aspectRatio: "1:1",
      imageSize: "1K",
      refImages: [],
    }),
  })
);

// ── Aspect Ratios ─────────────────────────────────────────��─────────
const ASPECT_RATIOS = [
  { id: "1:1", label: "1:1 Квадрат" },
  { id: "9:16", label: "9:16 Stories/Reels" },
  { id: "16:9", label: "16:9 Ш��рокий" },
  { id: "3:4", label: "3:4 Портрет" },
  { id: "4:3", label: "4:3 Классика" },
  { id: "2:3", label: "2:3 Постер" },
  { id: "3:2", label: "3:2 Фото" },
  { id: "4:5", label: "4:5 Instagram" },
  { id: "5:4", label: "5:4 Печать" },
  { id: "21:9", label: "21:9 Кинематограф" },
];

// ── Image Sizes ─────────────────────────────────────────────────────
const IMAGE_SIZES = [
  { id: "512", label: "512px Быстрое" },
  { id: "1K", label: "1K Стандарт" },
  { id: "2K", label: "2K Высокое" },
  { id: "4K", label: "4K Максимум" },
];

// ── Styles ──────────────────────────────────────────────────────────
const STYLES = [
  { id: "photo", label: "Фотореализм", eng: "photorealistic, 8k, shot on Hasselblad, natural lighting" },
  { id: "editorial", label: "Эдиториал", eng: "editorial photography, high fashion, Vogue aesthetic, dramatic lighting" },
  { id: "cinematic", label: "Кинематограф", eng: "cinematic still, anamorphic lens, volumetric fog, color grading" },
  { id: "anime", label: "Аниме", eng: "anime style, Studio Ghibli quality, vibrant colors, detailed backgrounds" },
  { id: "oil", label: "Масло", eng: "oil painting, rich impasto textures, classical composition, museum quality" },
  { id: "digital", label: "Концепт-арт", eng: "digital concept art, matte painting, epic scale, atmospheric perspective" },
  { id: "watercolor", label: "Акварель", eng: "watercolor painting, wet-on-wet technique, soft bleeding edges, luminous" },
  { id: "3d", label: "3D рендер", eng: "3D render, octane, subsurface scattering, cinematic global illumination" },
  { id: "minimal", label: "Минимализм", eng: "minimalist design, clean composition, negative space, geometric simplicity" },
  { id: "surreal", label: "Сюрреализм", eng: "surrealist art, dreamlike atmosphere, impossible geometry, Salvador Dali inspired" },
];

// ── Web App URL ─────────────────────────────────────────────────────
const WEBAPP_URL = process.env.WEBHOOK_URL || "https://yupself-bot.onrender.com";

// ── /start (with referral support) ──────────────────────────────────
bot.command("start", async (ctx) => {
  const payload = ctx.match || "";
  const referralCode = payload.startsWith("ref_") ? payload.slice(4) : null;

  // Register/get user
  const tgUser = ctx.from;
  try {
    await getOrCreateUser(tgUser.id, {
      username: tgUser.username,
      firstName: tgUser.first_name,
      referralCode,
    });
    if (referralCode) {
      console.log(`[referral] ${tgUser.id} joined via ${referralCode}`);
    }
  } catch (err) {
    console.error("[start/auth]", err.message);
  }

  const keyboard = new InlineKeyboard()
    .webApp("Открыть студию", WEBAPP_URL)
    .row()
    .text("Помощь", "cmd:help");

  await ctx.reply(
    `Привет! Я YupSelf — генерация AI-изображений.\n\n` +
      `Напиши описание картинки — я сгенерирую прямо здесь.\n` +
      `Или открой студию для настройки стилей, форматов и 4K.`,
    { reply_markup: keyboard }
  );
});

const HELP_TEXT =
  `<b>YupSelf — AI-генерация изображений</b>\n\n` +

  `<b>Генерация с нуля</b>\n` +
  `Напиши описание — получи картинку:\n` +
  `- "Кот-астронавт на поверхности Луны"\n` +
  `- "Логотип кофейни в стиле минимализма"\n` +
  `- "Обложка для подкаста про технологии"\n\n` +

  `<b>Редактирование по фото</b>\n` +
  `Отправь фото + напиши что сделать:\n` +
  `- "Сделай в стиле комикса"\n` +
  `- "Убери фон"\n` +
  `- "Добавь северное сияние"\n\n` +

  `<b>Генерация персонажа</b>\n` +
  `Загрузи 1-5 фото лица + напиши сцену:\n` +
  `- "Портрет в стиле ренессанса"\n` +
  `- "Я на обложке журнала Vogue"\n` +
  `- "Аватар в стиле аниме"\n\n` +

  `<b>Голосовой ввод</b>\n` +
  `Отправь голосовое — AI расшифрует и сгенерирует.\n\n` +

  `<b>Настройки</b>\n` +
  `/style — 10 стилей (фото, аниме, масло...)\n` +
  `/format — 7 форматов (1:1, 9:16, 16:9...)\n` +
  `/size — 4 разрешения (512px — 4K)\n` +
  `/settings — текущие настройки\n` +
  `/imagine &lt;текст&gt; — быстрая генерация`;

bot.callbackQuery("cmd:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
});

// ── /help ───────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
});

// ── /settings — show current settings ───────────────────────────────
bot.command("settings", async (ctx) => {
  const styleName = STYLES.find((s) => s.eng === ctx.session.style)?.label || "Без стиля";
  await ctx.reply(
    `Текущие настройки:\n\n` +
      `Стиль: ${styleName}\n` +
      `Формат: ${ctx.session.aspectRatio}\n` +
      `Разрешение: ${ctx.session.imageSize}\n\n` +
      `/style /format /size — изменить`
  );
});

// ── /style ──────────────────────────────────────────────────────────
bot.command("style", async (ctx) => {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < STYLES.length; i += 2) {
    const row = [STYLES[i]];
    if (STYLES[i + 1]) row.push(STYLES[i + 1]);
    for (const s of row) {
      const mark = ctx.session.style === s.eng ? " ★" : "";
      keyboard.text(s.label + mark, `style:${s.id}`);
    }
    keyboard.row();
  }
  keyboard.text("Без стиля", "style:none").row();
  await ctx.reply("Выбери стиль:", { reply_markup: keyboard });
});

bot.callbackQuery(/^style:(.+)$/, async (ctx) => {
  const styleId = ctx.match[1];
  if (styleId === "none") {
    ctx.session.style = null;
    await ctx.answerCallbackQuery("Стиль сброшен");
    await ctx.editMessageText("Стиль сброшен.");
  } else {
    const style = STYLES.find((s) => s.id === styleId);
    ctx.session.style = style?.eng || null;
    await ctx.answerCallbackQuery(`${style?.label}`);
    await ctx.editMessageText(`Стиль: ${style?.label}`);
  }
});

// ── /format — aspect ratio ──────────────────────────────────────────
bot.command("format", async (ctx) => {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < ASPECT_RATIOS.length; i += 2) {
    const row = [ASPECT_RATIOS[i]];
    if (ASPECT_RATIOS[i + 1]) row.push(ASPECT_RATIOS[i + 1]);
    for (const ar of row) {
      const mark = ctx.session.aspectRatio === ar.id ? " ★" : "";
      keyboard.text(ar.label + mark, `ar:${ar.id}`);
    }
    keyboard.row();
  }
  await ctx.reply("Выбери формат изображения:", { reply_markup: keyboard });
});

bot.callbackQuery(/^ar:(.+)$/, async (ctx) => {
  ctx.session.aspectRatio = ctx.match[1];
  const ar = ASPECT_RATIOS.find((a) => a.id === ctx.match[1]);
  await ctx.answerCallbackQuery(`${ar?.label}`);
  await ctx.editMessageText(`Формат: ${ar?.label}`);
});

// ── /size — image resolution ────────────────────────────────────────
bot.command("size", async (ctx) => {
  const keyboard = new InlineKeyboard();
  for (const sz of IMAGE_SIZES) {
    const mark = ctx.session.imageSize === sz.id ? " ★" : "";
    keyboard.text(sz.label + mark, `sz:${sz.id}`).row();
  }
  await ctx.reply("Выбери разрешение:", { reply_markup: keyboard });
});

bot.callbackQuery(/^sz:(.+)$/, async (ctx) => {
  ctx.session.imageSize = ctx.match[1];
  const sz = IMAGE_SIZES.find((s) => s.id === ctx.match[1]);
  await ctx.answerCallbackQuery(`${sz?.label}`);
  await ctx.editMessageText(`Разрешение: ${sz?.label}`);
});

// ── /imagine — quick generation ─────────────────────────────────────
bot.command("imagine", async (ctx) => {
  const text = ctx.match;
  if (!text) {
    return ctx.reply("Напиши описание после /imagine\nПример: /imagine кот в космосе");
  }
  await doGenerate(ctx, text);
});

// ── Photo messages — save as reference ───────────────────────────────
bot.on("message:photo", async (ctx) => {
  const caption = ctx.message.caption || "";
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1]; // highest resolution

  try {
    const file = await ctx.api.getFile(largest.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(fileUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");

    ctx.session.refImages.push(b64);
    const count = ctx.session.refImages.length;

    if (caption) {
      // Photo + caption = edit/generate immediately
      await ctx.reply(`Обрабатываю (${count} фото + описание)...`);
      await doEdit(ctx, caption);
    } else {
      const keyboard = new InlineKeyboard()
        .text("Готово, генерируй", "ref:done")
        .text("Сбросить фото", "ref:clear");

      await ctx.reply(
        `Фото ${count} сохранено как референс.\n` +
          `Отправь ещё фото или напиши описание — что сделать с референсом.`,
        { reply_markup: keyboard }
      );
    }
  } catch (err) {
    console.error("[photo]", err.message);
    await ctx.reply("Не удалось обработать фото. Попробуй ещё раз.");
  }
});

bot.callbackQuery("ref:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.refImages.length) {
    return ctx.editMessageText("Нет сохранённых фото. Отправь фото.");
  }
  await ctx.editMessageText("Напиши, что сделать с фото.");
});

bot.callbackQuery("ref:clear", async (ctx) => {
  await ctx.answerCallbackQuery("Фото сброшены");
  ctx.session.refImages = [];
  await ctx.editMessageText("Референсы очищены. Отправь новые фото.");
});

// ── Edit with reference images ──────────────────────────────────────
async function doEdit(ctx, instruction) {
  const refs = ctx.session.refImages;
  if (!refs.length) {
    return doGenerate(ctx, instruction);
  }

  try {
    // Don't enhance — pass edit instruction directly to preserve reference context
    const editInstruction = `Edit this attached image: ${instruction}`;
    const result = await editImage(editInstruction, refs, {
      aspectRatio: ctx.session.aspectRatio,
      imageSize: ctx.session.imageSize,
    });

    ctx.session.lastPrompt = editInstruction;

    const retryKeyboard = new InlineKeyboard()
      .text("Повторить", "gen:retry")
      .text("Сбросить фото", "ref:clear")
      .row()
      .text("Новое описание", "gen:cancel");

    if (result.imageBase64) {
      const buf = Buffer.from(result.imageBase64, "base64");
      await ctx.replyWithPhoto(new InputFile(buf, "image.png"), {
        caption: `${ctx.session.aspectRatio} | ${ctx.session.imageSize} | ${refs.length} ref`,
        reply_markup: retryKeyboard,
      });
    } else if (result.imageUrl) {
      await ctx.replyWithPhoto(result.imageUrl, {
        caption: `${ctx.session.aspectRatio} | ${ctx.session.imageSize} | ${refs.length} ref`,
        reply_markup: retryKeyboard,
      });
    }
  } catch (err) {
    console.error("[edit]", err.message);
    await ctx.reply("Не удалось обработать. Попробуй другое описание.");
  }
}

// ── Voice messages — transcribe via Groq Whisper ────────────────────
bot.on(["message:voice", "message:audio"], async (ctx) => {
  await ctx.reply("Расшифровываю голос...");

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    console.log("[voice] file_path:", file.file_path, "size:", ctx.message.voice?.file_size || ctx.message.audio?.file_size);

    const res = await fetch(fileUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log("[voice] downloaded buffer:", buffer.length, "bytes");

    // Telegram voice = .oga (Opus), rename to .ogg for Groq compatibility
    const filename = (file.file_path || "voice.oga").replace(/\.oga$/, ".ogg");
    const text = await transcribeAudio(buffer, filename, "audio/ogg");

    if (!text) {
      return ctx.reply("Не удалось распознать речь. Попробуй ещё раз.");
    }

    await ctx.reply(`Распознано: "${text}"\n\nУлучшаю промт...`);

    const enhanced = await enhancePrompt(text, ctx.session.style || "");
    ctx.session.pendingPrompt = enhanced;

    const keyboard = new InlineKeyboard()
      .text("Сгенерировать", "gen:confirm")
      .text("Переделать промт", "gen:redo")
      .row()
      .text("Отмена", "gen:cancel");

    await ctx.reply(`Промт:\n\n${enhanced}`, { reply_markup: keyboard });
  } catch (err) {
    console.error("[voice]", err.message);
    await ctx.reply("Ошибка расшифровки. Попробуй отправить текстом.");
  }
});

// ── Text messages — enhance prompt + confirm ────────────────────────
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  // If user has reference images — use edit mode
  if (ctx.session.refImages.length > 0) {
    await ctx.reply(`Обрабатываю с ${ctx.session.refImages.length} референсами...`);
    return doEdit(ctx, text);
  }

  // Generate directly from user's prompt, no auto-enhancement
  ctx.session.pendingPrompt = text;

  const keyboard = new InlineKeyboard()
    .text("Сгенерировать", "gen:confirm")
    .text("Улучшить промт", "gen:enhance")
    .row()
    .text("Отмена", "gen:cancel");

  await ctx.reply(`Промт:\n\n${text}\n\nНажми "Сгенерировать" или "Улучшить промт" если хочешь помощь AI.`, { reply_markup: keyboard });
});

// ── Callbacks: confirm / redo / cancel / retry ────────────��─────────
bot.callbackQuery("gen:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const prompt = ctx.session.pendingPrompt;
  if (!prompt) {
    return ctx.editMessageText("Промт не найден. Отправь описание заново.");
  }
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText("Генерирую изображение...");
  await doGenerate(ctx, prompt, true);
});

bot.callbackQuery("gen:enhance", async (ctx) => {
  await ctx.answerCallbackQuery();
  const prompt = ctx.session.pendingPrompt;
  if (!prompt) return ctx.editMessageText("Промт не найден.");

  await ctx.editMessageText("Улучшаю промт...");
  try {
    const enhanced = await enhancePrompt(prompt, ctx.session.style || "");
    ctx.session.pendingPrompt = enhanced;

    const keyboard = new InlineKeyboard()
      .text("Сгенерировать", "gen:confirm")
      .text("Отмена", "gen:cancel");

    await ctx.reply(`Улучшенный промт:\n\n${enhanced}`, { reply_markup: keyboard });
  } catch {
    await ctx.reply("Не удалось улучшить. Генерирую как есть.");
    await doGenerate(ctx, prompt, true);
  }
});

bot.callbackQuery("gen:redo", async (ctx) => {
  await ctx.answerCallbackQuery("Отправь новое описание");
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText("Отправь новое описание.");
});

bot.callbackQuery("gen:cancel", async (ctx) => {
  await ctx.answerCallbackQuery("Отменено");
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText("Отменено.");
});

bot.callbackQuery("gen:retry", async (ctx) => {
  await ctx.answerCallbackQuery();
  const prompt = ctx.session.lastPrompt;
  if (!prompt) {
    return ctx.reply("Нет предыдущего промта. Отправь новое описание.");
  }
  await ctx.reply("Повторяю генерацию...");
  await doGenerate(ctx, prompt, true);
});

// ── Core generation ─────────────────────────────────────────────────
async function doGenerate(ctx, prompt, alreadyEnhanced = false) {
  let finalPrompt = prompt;

  if (!alreadyEnhanced) {
    try {
      await ctx.reply("Готовлю промт...");
      finalPrompt = await enhancePrompt(prompt, ctx.session.style || "");
    } catch {
      // Use original if enhancement fails
    }
    await ctx.reply("Генерирую...");
  }

  // Save for retry
  ctx.session.lastPrompt = finalPrompt;

  const imageConfig = {
    aspectRatio: ctx.session.aspectRatio,
    imageSize: ctx.session.imageSize,
  };

  try {
    const result = await generateImage(finalPrompt, imageConfig);

    const retryKeyboard = new InlineKeyboard()
      .text("Повторить", "gen:retry")
      .text("Новое описание", "gen:cancel");

    if (result.imageBase64) {
      const buf = Buffer.from(result.imageBase64, "base64");
      await ctx.replyWithPhoto(new InputFile(buf, "image.png"), {
        caption: `${ctx.session.aspectRatio} | ${ctx.session.imageSize}`,
        reply_markup: retryKeyboard,
      });
    } else if (result.imageUrl) {
      await ctx.replyWithPhoto(result.imageUrl, {
        caption: `${ctx.session.aspectRatio} | ${ctx.session.imageSize}`,
        reply_markup: retryKeyboard,
      });
    }
  } catch (err) {
    console.error("[generate]", err.message);
    const retryKeyboard = new InlineKeyboard().text(
      "Попробовать ещё раз",
      "gen:retry"
    );
    await ctx.reply(
      "Не удалось сгенерировать. Попробуй другое описание или повтори.",
      { reply_markup: retryKeyboard }
    );
  }
}

// ── Rate limiting (in-memory sliding window) ───────────────────────
// Prevents abuse: max N requests per window per key (IP or user).
const _rateLimitStore = new Map();

function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) || "anon";
    const now = Date.now();
    const bucket = _rateLimitStore.get(key) || [];
    // Remove expired entries
    const fresh = bucket.filter(t => now - t < windowMs);
    if (fresh.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - fresh[0])) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Слишком много запросов. Подожди немного." });
    }
    fresh.push(now);
    _rateLimitStore.set(key, fresh);
    next();
  };
}

// Cleanup stale rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _rateLimitStore.entries()) {
    const fresh = bucket.filter(t => now - t < 600000); // 10 min max window
    if (fresh.length === 0) _rateLimitStore.delete(key);
    else _rateLimitStore.set(key, fresh);
  }
}, 300000).unref?.();

// Key function: prefer Telegram user id, fallback to IP
function userOrIpKey(req) {
  // Try to extract Telegram user id from initData (lazy verify)
  const initData = req.get("X-Telegram-Init-Data") || req.body?.initData;
  if (initData) {
    const result = verifyTelegramInitData(initData);
    if (result.ok && result.user) return "tg:" + result.user.id;
  }
  return "ip:" + (req.ip || req.connection?.remoteAddress || "unknown");
}

// ── Telegram WebApp initData verification ──────────────────────────
import crypto from "crypto";

/**
 * Verify Telegram WebApp initData HMAC signature.
 * Returns { ok: true, user } if valid, { ok: false } otherwise.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") return { ok: false };
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false };
    params.delete("hash");

    // Build data_check_string
    const pairs = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

    // HMAC-SHA256 with secret = HMAC-SHA256("WebAppData", BOT_TOKEN)
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return { ok: false };

    // Check auth_date freshness (within 24h)
    const authDate = Number(params.get("auth_date") || 0);
    if (Date.now() / 1000 - authDate > 86400) return { ok: false };

    const userJson = params.get("user");
    const user = userJson ? JSON.parse(userJson) : null;
    return { ok: true, user };
  } catch {
    return { ok: false };
  }
}

/**
 * Express middleware: require verified Telegram user.
 * Reads initData from X-Telegram-Init-Data header or body.initData.
 * Sets req.tgUser on success. Sends 401 on failure.
 */
function requireTelegramAuth(req, res, next) {
  const initData = req.get("X-Telegram-Init-Data") || req.body?.initData || req.query?.initData;
  const result = verifyTelegramInitData(initData);
  if (!result.ok || !result.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.tgUser = result.user;
  next();
}

/** Middleware: require auth AND that the :telegramId in URL matches authed user. */
function requireOwnResource(req, res, next) {
  requireTelegramAuth(req, res, (err) => {
    if (err) return;
    const urlTid = Number(req.params.telegramId || req.params.id);
    if (!req.tgUser || Number(req.tgUser.id) !== urlTid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  });
}

// ── Express + Webhook / Polling ─────────────────────────────────────
const app = express();

// Serve static files (web UI)
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
// No-cache headers for HTML (no redirect — Telegram WebView doesn't follow 302)
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});
app.use(express.static(join(__dirname, "public"), { maxAge: 0, etag: false, lastModified: false }));

app.get("/healthz", async (_req, res) => {
  const tableOk = await ensureJobsTable();
  res.json({ status: "ok", jobsTable: tableOk, cacheSize: jobCache.size, jobsError: _jobsLastError });
});

// ── YupPay webhook (BEFORE express.json — needs raw body for HMAC) ──
// Track processed invoices to avoid double-crediting on webhook retries
const _yuppayProcessed = new Set();
setInterval(() => { if (_yuppayProcessed.size > 1000) _yuppayProcessed.clear(); }, 3600000).unref?.();

app.post("/api/webhooks/yuppay",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    try {
      const rawBody = req.body; // Buffer
      const signature = req.get("x-yuppay-signature") || req.get("X-Yuppay-Signature") || "";

      if (!yuppayVerifySig(rawBody, signature)) {
        console.warn("[yuppay/webhook] invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const event = payload.event || payload.type;
      const data = payload.data || payload;
      const invoiceId = data?.invoice?.id || data?.invoice_id || data?.id;

      console.log(`[yuppay/webhook] event=${event} invoice=${invoiceId}`);

      if (event !== "payment.confirmed") {
        // Acknowledge other events (status updates etc.) without crediting
        return res.json({ ok: true, skipped: true });
      }

      // Idempotency: don't credit the same invoice twice
      if (invoiceId && _yuppayProcessed.has(invoiceId)) {
        return res.json({ ok: true, alreadyProcessed: true });
      }

      // Read metadata set when we created the invoice
      const metadata = data?.invoice?.metadata || data?.metadata || {};
      const telegramId = Number(metadata.telegram_chat_id);
      const tokens = Number(metadata.tokens);
      const packageId = metadata.package_id;

      if (!telegramId || !tokens) {
        console.warn("[yuppay/webhook] missing metadata:", metadata);
        return res.status(400).json({ error: "Missing telegram_chat_id/tokens in metadata" });
      }

      // Credit Искры to user
      await addTokens(telegramId, tokens, "yuppay", `Пополнение через YupPay (${packageId || "—"})`);
      if (invoiceId) _yuppayProcessed.add(invoiceId);
      console.log(`[yuppay/webhook] credited ${tokens} to user ${telegramId}`);

      // Notify user in Telegram
      try {
        await bot.api.sendMessage(
          telegramId,
          `✨ Оплата прошла! На баланс зачислено ${tokens} Искр. Открой YupSelf и создавай портреты.`
        );
      } catch (e) {
        console.warn("[yuppay/webhook] user notify failed:", e.message);
      }

      // Notify admins about payment (with rate for cost tracking)
      const paidDarai = metadata.darai_amount || "—";
      const paidRate = metadata.darai_per_iskra || "—";
      await notifyAdmins(
        `<b>YupPay оплата</b>\nUser: ${telegramId}\nПакет: ${packageId || "—"}\nИскры: +${tokens}\nDarai: ${paidDarai}\nКурс: ${paidRate} DARAI/Искра`
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("[yuppay/webhook] error:", err.message);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// ── Web API: generate image ─────────────────────────────────────────
// 20MB limit — enough for 5 base64 photos (each ~2-3MB compressed)
app.use(express.json({ limit: "20mb" }));

// CORS for web UI
app.use("/api", (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Web API: voice transcription ────────────────────────────────────
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "audio file required" });
    console.log("[transcribe] file:", req.file.originalname, "size:", req.file.size, "mime:", req.file.mimetype);
    const filename = req.file.originalname || "voice.webm";
    const mimetype = req.file.mimetype || "audio/webm";
    const text = await transcribeAudio(req.file.buffer, filename, mimetype);
    console.log("[transcribe] result:", text?.slice(0, 100));
    res.json({ text });
  } catch (err) {
    console.error("[api/transcribe]", err.message);
    res.status(500).json({ error: "Transcription failed: " + err.message });
  }
});

// ── Persistent job store (Supabase) ──────────────────────────────────
// Jobs survive server restarts — no more lost generations during deploys.
// In-memory cache for fast reads during active generation.
// Each entry has { data, ts } — entries older than 30min auto-evicted.
const jobCache = new Map();
const JOB_CACHE_TTL = 30 * 60 * 1000; // 30 min

// Lazy check: verify jobs table on first write, retry periodically
let jobsTableReady = false;
let jobsTableChecked = false;
let _jobsLastError = null;
async function ensureJobsTable() {
  if (jobsTableReady) return true;
  if (jobsTableChecked && Date.now() - jobsTableChecked < 30000) return false;
  jobsTableChecked = Date.now();
  try {
    const { data, error } = await supabase.from("jobs").select("job_id").limit(1);
    if (!error) { jobsTableReady = true; _jobsLastError = null; console.log("[jobs] Supabase table ready"); return true; }
    _jobsLastError = error.message + " | code:" + (error.code || "?") + " | hint:" + (error.hint || "?");
    console.warn("[jobs]", _jobsLastError);
  } catch (e) { _jobsLastError = "exception: " + e.message; }
  return false;
}

async function setJob(jobId, data) {
  jobCache.set(jobId, data);
  if (!(await ensureJobsTable())) return;
  try {
    const row = {
      job_id: jobId,
      status: data.status,
      type: data.type || "generate",
      error: data.error || null,
      prompt: data.prompt || data.astroPrompt || null,
      image_url: null,
      result_json: null,
      updated_at: new Date().toISOString(),
    };
    if (data.status === "done") {
      let imageUrl = data.imageUrl || null;
      if (data.imageBase64 && !imageUrl) {
        imageUrl = await uploadImage(data.imageBase64, `${jobId}.png`);
      }
      row.image_url = imageUrl;
      row.result_json = JSON.stringify({
        snapshotSummary: data.snapshotSummary || null,
        analysis: data.analysis || null,
        astroPrompt: data.astroPrompt || null,
      });
      data.imageUrl = imageUrl || data.imageUrl;
    }
    await supabase.from("jobs").upsert(row, { onConflict: "job_id" });
  } catch (e) {
    console.error("[jobs db]", e.message);
  }
}

async function getJob(jobId) {
  // Fast path: in-memory cache
  const cached = jobCache.get(jobId);
  if (cached) return cached;

  // Slow path: read from Supabase (survives restarts)
  if (!(await ensureJobsTable())) return null;
  try {
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();
    if (!data) return null;

    const result = {
      status: data.status,
      type: data.type,
      error: data.error,
      prompt: data.prompt,
      imageUrl: data.image_url,
    };
    if (data.result_json) {
      try { Object.assign(result, JSON.parse(data.result_json)); } catch {}
    }
    return result;
  } catch {
    return null;
  }
}

// Track insertion time per job (parallel Map)
const jobCacheTs = new Map();

// Wrap original set/get to track TTL
const _origSet = jobCache.set.bind(jobCache);
jobCache.set = (k, v) => { jobCacheTs.set(k, Date.now()); return _origSet(k, v); };
const _origDelete = jobCache.delete.bind(jobCache);
jobCache.delete = (k) => { jobCacheTs.delete(k); return _origDelete(k); };

// TTL cleanup every 5 min — removes entries older than 30 min
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of jobCacheTs.entries()) {
    if (now - ts > JOB_CACHE_TTL) {
      jobCache.delete(k);
    }
  }
}, 300000).unref?.();

// Generation rate limit: max 10 per 60s per user/IP
const genRateLimit = rateLimit({ windowMs: 60000, max: 10, keyFn: userOrIpKey });

app.post("/api/generate", genRateLimit, async (req, res) => {
  try {
    const { prompt, style, aspectRatio, imageSize, quality } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    // Spend 100 Iskry per generation (if user is authenticated)
    const telegramId = req.body.telegramId ? Number(req.body.telegramId) : null;
    if (telegramId) {
      const spend = await spendTokens(telegramId, 100, "Генерация изображения");
      if (!spend.ok) {
        return res.status(402).json({ error: "insufficient_balance", balance: spend.balance, message: "Недостаточно Искр" });
      }
    }

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await setJob(jobId, { status: "processing", prompt });

    console.log(`[job ${jobId}] generating (${quality || "pro"}): "${prompt.slice(0, 80)}..."`);
    const genPromise = generateImage(prompt, {
      aspectRatio: aspectRatio || "1:1",
      imageSize: imageSize || "1K",
      quality: quality || "pro",
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Generation timeout (120s)")), 120000)
    );

    // Safe background execution — all errors captured
    (async () => {
      try {
        const result = await Promise.race([genPromise, timeoutPromise]);
        console.log(`[job ${jobId}] done! base64: ${(result.imageBase64||'').length} chars`);
        await setJob(jobId, {
          status: "done",
          prompt,
          imageBase64: result.imageBase64 || null,
          imageUrl: result.imageUrl || null,
        });
        if (telegramId) {
          try {
            await saveGeneration(telegramId, {
              prompt,
              aspectRatio: aspectRatio || "1:1",
              imageSize: imageSize || "1K",
              imageUrl: (await getJob(jobId))?.imageUrl || null,
            });
          } catch (e) { console.error("[save]", e.message); }
        }
      } catch (err) {
        console.error(`[job ${jobId}] error:`, err.message);
        try {
          await setJob(jobId, { status: "error", error: err.message });
        } catch (e2) { console.error("[job] setJob on error failed:", e2.message); }
      }
    })();

    res.json({ jobId });
  } catch (err) {
    console.error("[generate]", err.message);
    res.status(500).json({ error: "Не удалось запустить генерацию" });
  }
});

app.get("/api/job/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// Download image as file (works in Telegram WebView)
app.get("/api/download/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).send("Not found");

  // If base64 in cache — serve directly
  if (job.imageBase64) {
    const buf = Buffer.from(job.imageBase64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="yupself-${req.params.id}.png"`);
    return res.send(buf);
  }

  // If image_url (from Supabase Storage) — redirect
  if (job.imageUrl) {
    return res.redirect(job.imageUrl);
  }

  res.status(404).send("Not found");
});

// ── Web API: user profile / cabinet ──────────────────────────────────
app.post("/api/auth", async (req, res) => {
  try {
    const { telegramId, username, firstName, avatarUrl, referralCode } = req.body;
    if (!telegramId) return res.status(400).json({ error: "telegramId required" });
    const user = await getOrCreateUser(telegramId, { username, firstName, avatarUrl, referralCode });
    res.json(user);
  } catch (err) {
    console.error("[api/auth]", err.message);
    res.status(500).json({ error: "Не удалось авторизоваться" });
  }
});

app.get("/api/profile/:telegramId", requireOwnResource, async (req, res) => {
  try {
    const tid = req.tgUser.id;
    const [balance, stats, history] = await Promise.all([
      getBalance(tid),
      getUserStats(tid),
      getGenerations(tid, 20),
    ]);
    res.json({ ...balance, stats, history });
  } catch (err) {
    console.error("[profile]", err.message);
    res.status(500).json({ error: "Не удалось загрузить профиль" });
  }
});

app.get("/api/history/:telegramId", requireOwnResource, async (req, res) => {
  try {
    const tid = req.tgUser.id;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const gens = await getGenerations(tid, limit, offset);
    res.json(gens);
  } catch (err) {
    console.error("[history]", err.message);
    res.status(500).json({ error: "Не удалось загрузить историю" });
  }
});

app.post("/api/favorite/:id", requireTelegramAuth, async (req, res) => {
  try {
    const result = await toggleFavorite(Number(req.params.id), req.tgUser.id);
    res.json({ isFavorite: result });
  } catch (err) {
    console.error("[favorite]", err.message);
    res.status(500).json({ error: "Не удалось обновить" });
  }
});

// ── Face Memory API ─────────────────────────────────────────────────
app.post("/api/face/save", upload.single("face"), requireTelegramAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!req.file) return res.status(400).json({ error: "face required" });
    const b64 = req.file.buffer.toString("base64");
    const face = await saveFace(req.tgUser.id, name || "Моё лицо", b64);
    res.json({ id: face.id, name: face.name });
  } catch (err) {
    console.error("[face/save]", err.message);
    res.status(500).json({ error: "Не удалось сохранить фото" });
  }
});

app.get("/api/faces/:telegramId", requireOwnResource, async (req, res) => {
  try {
    const faces = await getSavedFaces(req.tgUser.id);
    res.json(faces);
  } catch (err) {
    console.error("[faces]", err.message);
    res.status(500).json({ error: "Не удалось загрузить фото" });
  }
});

app.delete("/api/face/:id", requireTelegramAuth, async (req, res) => {
  try {
    await deleteFace(Number(req.params.id), req.tgUser.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[face/delete]", err.message);
    res.status(500).json({ error: "Не удалось удалить" });
  }
});

// ── DaraiPay API ────────────────────────────────────────────────────
app.get("/api/packages", (_req, res) => {
  res.json({ packages: PACKAGES, merchantAccount: MERCHANT_ACCOUNT });
});

app.post("/api/payment/create", requireTelegramAuth, async (req, res) => {
  try {
    const { packageId } = req.body;
    if (!packageId) return res.status(400).json({ error: "packageId required" });
    const payment = await createPayment(req.tgUser.id, packageId);
    res.json(payment);
  } catch (err) {
    console.error("[darai-pay]", err.message);
    res.status(500).json({ error: "Не удалось создать платёж" });
  }
});

app.get("/api/payment/check/:id", requireTelegramAuth, async (req, res) => {
  try {
    const result = await checkPayment(Number(req.params.id));
    res.json(result);
  } catch (err) {
    console.error("[payment/check]", err.message);
    res.status(500).json({ error: "Не удалось проверить платёж" });
  }
});

app.get("/api/payment/pending/:telegramId", requireOwnResource, async (req, res) => {
  try {
    const payments = await getPendingPayments(req.tgUser.id);
    res.json(payments);
  } catch (err) {
    console.error("[payment/pending]", err.message);
    res.status(500).json({ error: "Не удалось загрузить платежи" });
  }
});

// ── YupPay API ──────────────────────────────────────────────────────
app.get("/api/yuppay/packages", (_req, res) => {
  res.json({ packages: getYupPayPackages(), rate: getCurrentRate() });
});

// Rate limit: max 5 invoices per minute per user
const invoiceRateLimit = rateLimit({ windowMs: 60000, max: 5, keyFn: userOrIpKey });

app.post("/api/yuppay/create", invoiceRateLimit, requireTelegramAuth, async (req, res) => {
  try {
    const { packageId } = req.body;
    if (!packageId) return res.status(400).json({ error: "packageId required" });
    const invoice = await yuppayCreateInvoice({
      packageId,
      telegramId: req.tgUser.id,
      publicBaseUrl: process.env.WEBHOOK_URL || "https://yupself-bot.onrender.com",
    });
    res.json(invoice);
  } catch (err) {
    console.error("[yuppay/create]", err.message);
    res.status(500).json({ error: "Не удалось создать счёт" });
  }
});

// ── Astro Image Generation API ───────────────────────────────────────
app.post("/api/astro/generate", genRateLimit, async (req, res) => {
  try {
    const { name, birthdate, birthplace, birthtime, birthtimeUnknown, gender, intention, faceBase64, faceId, telegramId, aspectRatio } = req.body;
    console.log("[astro] request:", JSON.stringify({ name, birthdate, birthplace, birthtime, gender, hasFace: !!(faceBase64 || faceId) }));
    if (!birthdate || !birthplace) return res.status(400).json({ error: "birthdate and birthplace required" });

    // Spend 100 Iskry per astro generation
    if (telegramId) {
      const spend = await spendTokens(Number(telegramId), 100, "Астро-портрет");
      if (!spend.ok) {
        return res.status(402).json({ error: "insufficient_balance", balance: spend.balance, message: "Недостаточно Искр" });
      }
    }

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await setJob(jobId, { status: "processing", type: "astro" });

    console.log(`[astro job ${jobId}] starting for ${name}, ${birthdate}, ${birthplace}, face: ${!!(faceBase64 || faceId)}`);

    // Get face image: direct base64 OR from saved face
    let faceImageB64 = faceBase64 || null;
    if (!faceImageB64 && faceId && telegramId) {
      try {
        const face = await getFaceImage(Number(faceId), Number(telegramId));
        if (face?.face_image_b64) faceImageB64 = face.face_image_b64;
      } catch {}
    }

    // Safe background execution — all errors captured
    (async () => {
      try {
        const result = await generateAstroImage({
          name, birthdate, birthplace, birthtime,
          birthtimeUnknown: !!birthtimeUnknown,
          gender, intention, faceImageB64, aspectRatio: aspectRatio || "1:1",
        });
        console.log(`[astro job ${jobId}] done!`);
        await setJob(jobId, {
          status: "done",
          type: "astro",
          imageBase64: result.imageBase64,
          imageUrl: result.imageUrl,
          astroPrompt: result.astroPrompt,
          snapshotSummary: result.snapshotSummary,
          analysis: result.analysis,
        });
        if (telegramId) {
          try {
            await supabase.from("astro_image_requests").insert({
              telegram_id: Number(telegramId),
              name, birthdate, birthplace, birthtime, gender, intention,
              aspect_ratio: aspectRatio || "1:1",
              status: "completed",
              astro_snapshot: result.astroSnapshot,
              image_prompt: result.astroPrompt,
              completed_at: new Date().toISOString(),
            });
          } catch (e) { console.error("[astro db]", e.message); }
          // Save to generations table so it appears in profile history
          try {
            const jobData = await getJob(jobId);
            await saveGeneration(Number(telegramId), {
              prompt: result.astroPrompt || intention || "Персональный расклад",
              aspectRatio: aspectRatio || "1:1",
              imageUrl: jobData?.imageUrl || null,
            });
          } catch (e) { console.error("[astro save gen]", e.message); }
        }
      } catch (err) {
        console.error(`[astro job ${jobId}] error:`, err.message);
        try {
          await setJob(jobId, { status: "error", error: err.message });
        } catch (e2) { console.error("[astro] setJob on error failed:", e2.message); }
      }
    })();

    res.json({ jobId });
  } catch (err) {
    console.error("[astro/generate]", err.message);
    res.status(500).json({ error: "Не удалось запустить генерацию" });
  }
});

// ── Places autocomplete ─────────────────────────────────────────────
app.get("/api/places", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json([]);
    // Use Nominatim for place suggestions
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=ru`;
    const r = await fetch(url, { headers: { "User-Agent": "YupSelf/1.0" } });
    if (!r.ok) return res.json([]);
    const data = await r.json();
    res.json(data.map(d => ({
      name: d.display_name?.split(",").slice(0, 2).join(",").trim(),
      fullName: d.display_name,
      lat: Number(d.lat),
      lon: Number(d.lon),
    })));
  } catch {
    res.json([]);
  }
});

// ── Web API: edit image with reference ───────────────────────────────
app.post("/api/edit", genRateLimit, upload.array("images", 5), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    if (!req.files?.length) return res.status(400).json({ error: "at least 1 image required" });

    let imageBase64List = req.files.map(f => f.buffer.toString("base64"));
    const faceId = Number(req.body.faceId) || null;
    const telegramId = Number(req.body.telegramId) || null;
    console.log("[edit] images:", req.files.length, "faceId:", faceId, "prompt:", prompt.slice(0, 50));

    // Spend 100 Iskry per edit
    if (telegramId) {
      const spend = await spendTokens(telegramId, 100, "Редактирование");
      if (!spend.ok) {
        return res.status(402).json({ error: "insufficient_balance", balance: spend.balance, message: "Недостаточно Искр" });
      }
    }

    // If face memory enabled — prepend saved face image to reference list
    let facePromptSuffix = "";
    if (faceId && telegramId) {
      try {
        const face = await getFaceImage(faceId, telegramId);
        if (face?.face_image_b64) {
          imageBase64List = [face.face_image_b64, ...imageBase64List];
          facePromptSuffix = `. Preserve the face identity from the first reference image exactly — same facial features, expression style, eye color, face shape. Character: ${face.name || "main character"}.`;
          console.log("[edit] face loaded:", face.name);
        }
      } catch (e) { console.warn("[edit] face load failed:", e.message); }
    }

    const fullPrompt = `Edit this image: ${prompt}${facePromptSuffix}. Return the edited image.`;

    // Async job
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await setJob(jobId, { status: "processing", prompt });

    // Safe background execution — all errors captured
    (async () => {
      try {
        const result = await editImage(fullPrompt, imageBase64List, {
          aspectRatio: req.body.aspectRatio || "1:1",
          imageSize: req.body.imageSize || "1K",
        });
        console.log(`[edit job ${jobId}] done!`);
        await setJob(jobId, {
          status: "done",
          prompt,
          imageBase64: result.imageBase64 || null,
          imageUrl: result.imageUrl || null,
        });
      } catch (editErr) {
        console.warn(`[edit job ${jobId}] editImage failed, fallback:`, editErr.message);
        try {
          const result = await generateImage(prompt, {
            aspectRatio: req.body.aspectRatio || "1:1",
            imageSize: req.body.imageSize || "1K",
          });
          await setJob(jobId, {
            status: "done",
            prompt,
            imageBase64: result.imageBase64 || null,
            imageUrl: result.imageUrl || null,
          });
        } catch (genErr) {
          try {
            await setJob(jobId, { status: "error", error: genErr.message });
          } catch (e2) { console.error("[edit] setJob on error failed:", e2.message); }
        }
      }
    })();

    res.json({ jobId });
  } catch (err) {
    console.error("[api/edit]", err.message);
    res.status(500).json({ error: "Edit failed: " + err.message });
  }
});

async function setupBotMenu() {
  try {
    // Permanent "Открыть студию" button (replaces hamburger menu)
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Студия",
        web_app: { url: WEBAPP_URL },
      },
    });

    // Bot commands list
    await bot.api.setMyCommands([
      { command: "start", description: "Запустить бота" },
      { command: "imagine", description: "Быстрая генерация изображения" },
      { command: "style", description: "Выбрать стиль" },
      { command: "help", description: "Помощь и возможности" },
      { command: "settings", description: "Текущие настройки" },
    ]);

    console.log("[bot] Menu button + commands set");
  } catch (err) {
    console.warn("[bot] Failed to set menu:", err.message);
  }
}

async function main() {
  if (WEBHOOK_URL) {
    const { webhookCallback } = await import("grammy");
    app.use(`/bot${BOT_TOKEN}`, webhookCallback(bot, "express"));

    const server = app.listen(PORT, () => {
      console.log(`YupSelf listening on port ${PORT}`);
      (async () => {
        try {
          await bot.api.setWebhook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
          await setupBotMenu();
          console.log(`YupSelf webhook set (${WEBHOOK_URL})`);
          const ts = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
          await notifyAdmins(`<b>YupSelf обновлён</b>\n${ts} MSK`);
        } catch (err) {
          console.error("[startup] webhook setup failed:", err.message);
        }
      })();
    });
    setupGracefulShutdown(server);
  } else {
    const server = app.listen(PORT, () => console.log(`Health check on port ${PORT}`));
    await bot.api.deleteWebhook();
    await setupBotMenu();
    console.log("YupSelf starting in polling mode...");
    bot.start();
    setupGracefulShutdown(server);
  }
}

/**
 * Graceful shutdown: stop accepting new connections, wait up to 30s for
 * in-flight jobs to finish, then exit. Prevents lost jobs on deploys.
 */
function setupGracefulShutdown(server) {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, draining...`);
    server.close(() => console.log("[shutdown] server closed"));
    // Wait up to 30s for active jobs (jobCache entries with processing status)
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const active = [...jobCache.values()].filter(j => j?.status === "processing").length;
      if (active === 0) break;
      console.log(`[shutdown] ${active} jobs still processing...`);
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("[shutdown] exiting");
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // Catch unhandled rejections to prevent crashes
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
