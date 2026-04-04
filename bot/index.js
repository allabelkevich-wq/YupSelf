import "dotenv/config";
import { Bot, InputFile, InlineKeyboard, session } from "grammy";
import express from "express";
import { enhancePrompt, generateImage, editImage } from "./openrouter.js";
import { transcribeAudio } from "./groq.js";

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

// ── /start ──────────────────────────────────────────────────────────
bot.command("start", async (ctx) => {
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
    const text = await transcribeAudio(buffer, filename);

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

  await ctx.reply("Улучшаю промт...");

  try {
    const enhanced = await enhancePrompt(text, ctx.session.style || "");
    ctx.session.pendingPrompt = enhanced;

    const keyboard = new InlineKeyboard()
      .text("Сгенерировать", "gen:confirm")
      .text("Переделать промт", "gen:redo")
      .row()
      .text("Отмена", "gen:cancel");

    await ctx.reply(`Промт:\n\n${enhanced}`, { reply_markup: keyboard });
  } catch (err) {
    console.error("[enhance]", err.message);
    await ctx.reply("Не удалось улучшить промт. Попробуй ещё раз.");
  }
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
app.use(express.static(join(__dirname, "public")));

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
    const text = await transcribeAudio(req.file.buffer, req.file.originalname || "voice.webm");
    res.json({ text });
  } catch (err) {
    console.error("[api/transcribe]", err.message);
    res.status(500).json({ error: "Transcription failed" });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, style, aspectRatio, imageSize } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    // Enhance prompt via DeepSeek
    const enhanced = await enhancePrompt(prompt, style || "");

    // Generate image
    const result = await generateImage(enhanced, {
      aspectRatio: aspectRatio || "1:1",
      imageSize: imageSize || "1K",
    });

    res.json({
      enhancedPrompt: enhanced,
      imageBase64: result.imageBase64 || null,
      imageUrl: result.imageUrl || null,
    });
  } catch (err) {
    console.error("[api/generate]", err.message);
    res.status(500).json({ error: "Generation failed" });
  }
});

// ── Web API: edit image with reference ───────────────────────────────
app.post("/api/edit", upload.array("images", 5), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    if (!req.files?.length) return res.status(400).json({ error: "at least 1 image required" });

    const imageBase64List = req.files.map(f => f.buffer.toString("base64"));
    // Don't enhance prompt for edits — pass instruction directly
    // DeepSeek rewrites it as "generate from scratch" and loses the reference
    const editInstruction = `Edit this attached image according to the following instruction: ${prompt}`;

    const result = await editImage(editInstruction, imageBase64List, {
      aspectRatio: req.body.aspectRatio || "1:1",
      imageSize: req.body.imageSize || "1K",
    });

    res.json({
      enhancedPrompt: editInstruction,
      imageBase64: result.imageBase64 || null,
      imageUrl: result.imageUrl || null,
    });
  } catch (err) {
    console.error("[api/edit]", err.message);
    res.status(500).json({ error: "Edit failed" });
  }
});

async function main() {
  if (WEBHOOK_URL) {
    const { webhookCallback } = await import("grammy");
    app.use(`/bot${BOT_TOKEN}`, webhookCallback(bot, "express"));

    app.listen(PORT, async () => {
      await bot.api.setWebhook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
      console.log(`YuPself running on port ${PORT} (webhook)`);
      const ts = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      await notifyAdmins(`<b>YuPself обновлён</b>\n${ts} MSK`);
    });
  } else {
    app.listen(PORT, () => console.log(`Health check on port ${PORT}`));
    await bot.api.deleteWebhook();
    console.log("YuPself starting in polling mode...");
    bot.start();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
