import "dotenv/config";
import { Bot, InputFile, InlineKeyboard, session } from "grammy";
import express from "express";
import { enhancePrompt, translatePrompt, generateImage, editImage } from "./openrouter.js";
import { transcribeAudio } from "./groq.js";
import { getOrCreateUser, getBalance, spendTokens, saveGeneration, getGenerations, getUserStats, toggleFavorite } from "./db.js";
import { createPayment, checkPayment, getPendingPayments, PACKAGES, MERCHANT_ACCOUNT } from "./darai-pay.js";
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
const WEBAPP_BASE = process.env.WEBHOOK_URL || "https://yupself-bot.onrender.com";
const WEBAPP_URL = WEBAPP_BASE + "?v=" + Date.now(); // bust Telegram WebView cache

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

// ── Express + Webhook / Polling ─────────────────────────────────────
const app = express();

// Serve static files (web UI)
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
// Force no-cache headers on all static files
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});
app.use(express.static(join(__dirname, "public"), { maxAge: 0, etag: false, lastModified: false }));

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// ── Web API: generate image ─────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// CORS for web UI
app.use("/api", (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

// ── Async job store ──────────────────────────────────────────────────
const jobs = new Map();

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, style, aspectRatio, imageSize, quality } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    // Create job and return immediately
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    jobs.set(jobId, { status: "processing", prompt });

    console.log(`[job ${jobId}] generating (${quality || "pro"}): "${prompt.slice(0, 80)}..."`);
    const genPromise = generateImage(prompt, {
      aspectRatio: aspectRatio || "1:1",
      imageSize: imageSize || "1K",
      quality: quality || "pro",
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Generation timeout (120s)")), 120000)
    );

    const telegramId = req.body.telegramId || null;

    Promise.race([genPromise, timeoutPromise]).then(async (result) => {
      console.log(`[job ${jobId}] done! base64: ${(result.imageBase64||'').length} chars`);
      jobs.set(jobId, {
        status: "done",
        prompt,
        imageBase64: result.imageBase64 || null,
        imageUrl: result.imageUrl || null,
      });
      // Save to history
      if (telegramId) {
        try {
          await saveGeneration(telegramId, {
            prompt,
            aspectRatio: aspectRatio || "1:1",
            imageSize: imageSize || "1K",
          });
        } catch (e) { console.error("[save]", e.message); }
      }
      setTimeout(() => jobs.delete(jobId), 300000);
    }).catch(err => {
      console.error(`[job ${jobId}] error:`, err.message);
      jobs.set(jobId, { status: "error", error: err.message });
      setTimeout(() => jobs.delete(jobId), 60000);
    });

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// Download image as file (works in Telegram WebView)
app.get("/api/download/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.imageBase64) return res.status(404).send("Not found");
  const buf = Buffer.from(job.imageBase64, "base64");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="yupself-${req.params.id}.png"`);
  res.send(buf);
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
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/profile/:telegramId", async (req, res) => {
  try {
    const tid = Number(req.params.telegramId);
    const [balance, stats, history] = await Promise.all([
      getBalance(tid),
      getUserStats(tid),
      getGenerations(tid, 20),
    ]);
    res.json({ ...balance, stats, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/:telegramId", async (req, res) => {
  try {
    const tid = Number(req.params.telegramId);
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const gens = await getGenerations(tid, limit, offset);
    res.json(gens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/favorite/:id", async (req, res) => {
  try {
    const { telegramId } = req.body;
    const result = await toggleFavorite(Number(req.params.id), telegramId);
    res.json({ isFavorite: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Face Memory API ─────────────────────────────────────────────────
app.post("/api/face/save", upload.single("face"), async (req, res) => {
  try {
    const { telegramId, name } = req.body;
    if (!telegramId || !req.file) return res.status(400).json({ error: "telegramId and face required" });
    const b64 = req.file.buffer.toString("base64");
    const face = await saveFace(Number(telegramId), name || "Моё лицо", b64);
    res.json({ id: face.id, name: face.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/faces/:telegramId", async (req, res) => {
  try {
    const faces = await getSavedFaces(Number(req.params.telegramId));
    res.json(faces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/face/:id", async (req, res) => {
  try {
    const { telegramId } = req.body;
    await deleteFace(Number(req.params.id), Number(telegramId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DaraiPay API ────────────────────────────────────────────────────
app.get("/api/packages", (_req, res) => {
  res.json({ packages: PACKAGES, merchantAccount: MERCHANT_ACCOUNT });
});

app.post("/api/payment/create", async (req, res) => {
  try {
    const { telegramId, packageId } = req.body;
    if (!telegramId || !packageId) return res.status(400).json({ error: "telegramId and packageId required" });
    const payment = await createPayment(telegramId, packageId);
    res.json(payment);
  } catch (err) {
    console.error("[darai-pay]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/payment/check/:id", async (req, res) => {
  try {
    const result = await checkPayment(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/payment/pending/:telegramId", async (req, res) => {
  try {
    const payments = await getPendingPayments(Number(req.params.telegramId));
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Astro Image Generation API ───────────────────────────────────────
app.post("/api/astro/generate", async (req, res) => {
  try {
    const { name, birthdate, birthplace, birthtime, birthtimeUnknown, gender, intention, faceId, telegramId, aspectRatio } = req.body;
    console.log("[astro] request:", JSON.stringify({ name, birthdate, birthplace, birthtime, birthtimeUnknown, gender, faceId, aspectRatio }));
    if (!birthdate || !birthplace) return res.status(400).json({ error: "birthdate and birthplace required" });

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    jobs.set(jobId, { status: "processing", type: "astro" });

    console.log(`[astro job ${jobId}] starting for ${name}, ${birthdate}, ${birthplace}`);

    // Get face image if faceId provided
    let faceImageB64 = null;
    if (faceId && telegramId) {
      try {
        const face = await getFaceImage(Number(faceId), Number(telegramId));
        if (face?.face_image_b64) faceImageB64 = face.face_image_b64;
      } catch {}
    }

    // Run pipeline in background
    generateAstroImage({
      name, birthdate, birthplace, birthtime,
      birthtimeUnknown: !!birthtimeUnknown,
      gender, intention, faceImageB64, aspectRatio: aspectRatio || "1:1",
    }).then(result => {
      console.log(`[astro job ${jobId}] done!`);
      jobs.set(jobId, {
        status: "done",
        type: "astro",
        imageBase64: result.imageBase64,
        imageUrl: result.imageUrl,
        astroPrompt: result.astroPrompt,
        snapshotSummary: result.snapshotSummary,
        analysis: result.analysis,
      });
      // Save to DB
      if (telegramId) {
        supabase.from("astro_image_requests").insert({
          telegram_id: Number(telegramId),
          name, birthdate, birthplace, birthtime, gender, intention,
          aspect_ratio: aspectRatio || "1:1",
          status: "completed",
          astro_snapshot: result.astroSnapshot,
          image_prompt: result.astroPrompt,
          completed_at: new Date().toISOString(),
        }).then(() => {}).catch(e => console.error("[astro db]", e.message));
      }
      setTimeout(() => jobs.delete(jobId), 300000);
    }).catch(err => {
      console.error(`[astro job ${jobId}] error:`, err.message);
      jobs.set(jobId, { status: "error", error: err.message });
      setTimeout(() => jobs.delete(jobId), 60000);
    });

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
app.post("/api/edit", upload.array("images", 5), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    if (!req.files?.length) return res.status(400).json({ error: "at least 1 image required" });

    let imageBase64List = req.files.map(f => f.buffer.toString("base64"));
    const faceId = Number(req.body.faceId) || null;
    const telegramId = Number(req.body.telegramId) || null;
    console.log("[edit] images:", req.files.length, "faceId:", faceId, "prompt:", prompt.slice(0, 50));

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

    const fullPrompt = prompt + facePromptSuffix;

    // Async job
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    jobs.set(jobId, { status: "processing", prompt });

    // Start edit in background
    editImage(fullPrompt, imageBase64List, {
      aspectRatio: req.body.aspectRatio || "1:1",
      imageSize: req.body.imageSize || "1K",
    }).then(result => {
      console.log(`[edit job ${jobId}] done!`);
      jobs.set(jobId, {
        status: "done",
        prompt,
        imageBase64: result.imageBase64 || null,
        imageUrl: result.imageUrl || null,
      });
      setTimeout(() => jobs.delete(jobId), 300000);
    }).catch(async (editErr) => {
      // Fallback to generate
      console.warn(`[edit job ${jobId}] editImage failed, fallback:`, editErr.message);
      try {
        const result = await generateImage(prompt, {
          aspectRatio: req.body.aspectRatio || "1:1",
          imageSize: req.body.imageSize || "1K",
        });
        jobs.set(jobId, {
          status: "done",
          prompt,
          imageBase64: result.imageBase64 || null,
          imageUrl: result.imageUrl || null,
        });
      } catch (genErr) {
        jobs.set(jobId, { status: "error", error: genErr.message });
      }
      setTimeout(() => jobs.delete(jobId), 60000);
    });

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

    app.listen(PORT, async () => {
      await bot.api.setWebhook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
      await setupBotMenu();
      console.log(`YupSelf running on port ${PORT} (webhook)`);
      const ts = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      await notifyAdmins(`<b>YupSelf обновлён</b>\n${ts} MSK`);
    });
  } else {
    app.listen(PORT, () => console.log(`Health check on port ${PORT}`));
    await bot.api.deleteWebhook();
    await setupBotMenu();
    console.log("YupSelf starting in polling mode...");
    bot.start();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
