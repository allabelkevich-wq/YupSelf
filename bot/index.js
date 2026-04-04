import "dotenv/config";
import { Bot, InputFile, InlineKeyboard, session } from "grammy";
import express from "express";
import { enhancePrompt, generateImage } from "./openrouter.js";

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // empty = long polling (dev)

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ── Session (stores user state per chat) ────────────────────────────
bot.use(
  session({
    initial: () => ({
      pendingPrompt: null, // enhanced prompt waiting for confirmation
      style: null, // chosen style
    }),
  })
);

// ── Styles ──────────────────────────────────────────────────────────
const STYLES = [
  { id: "photo", label: "Фотореализм", eng: "photorealistic, 8k, detailed" },
  { id: "anime", label: "Аниме", eng: "anime style, vibrant colors, detailed" },
  { id: "oil", label: "Масло", eng: "oil painting, rich textures, classical" },
  { id: "digital", label: "Диджитал-арт", eng: "digital art, concept art, trending on artstation" },
  { id: "watercolor", label: "Акварель", eng: "watercolor painting, soft, flowing" },
  { id: "3d", label: "3D рендер", eng: "3D render, octane, cinematic lighting" },
];

// ── /start ──────────────────────────────────────────────────────────
bot.command("start", async (ctx) => {
  await ctx.reply(
    `Привет! Я YuPself — бот для генерации AI-изображений.\n\n` +
      `Как использовать:\n` +
      `1. Отправь мне описание картинки (на любом языке)\n` +
      `2. Я улучшу твой промт и предложу стили\n` +
      `3. Нажми "Сгенерировать" и получи картинку\n\n` +
      `Команды:\n` +
      `/imagine <описание> — быстрая генерация\n` +
      `/style — выбрать стиль по умолчанию\n` +
      `/help — помощь`,
    { parse_mode: "Markdown" }
  );
});

// ── /help ───────────────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.reply(
    `Просто напиши описание того, что хочешь увидеть.\n\n` +
      `Примеры:\n` +
      `- "Кот-астронавт на Луне"\n` +
      `- "Закат над горами в стиле Ван Гога"\n` +
      `- "Футуристический город ночью"\n\n` +
      `Я переведу, улучшу промт и сгенерирую картинку.\n\n` +
      `/style — сменить стиль (фото, аниме, масло...)\n` +
      `/imagine <текст> — быстрая генерация без подтверждения`
  );
});

// ── /style — choose default style ──────────────────────────────────
bot.command("style", async (ctx) => {
  const keyboard = new InlineKeyboard();
  for (const s of STYLES) {
    keyboard.text(s.label, `style:${s.id}`).row();
  }
  keyboard.text("Без стиля", "style:none").row();
  await ctx.reply("Выбери стиль для генерации:", {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^style:(.+)$/, async (ctx) => {
  const styleId = ctx.match[1];
  if (styleId === "none") {
    ctx.session.style = null;
    await ctx.answerCallbackQuery("Стиль сброшен");
    await ctx.editMessageText("Стиль сброшен. Теперь генерация без стиля.");
  } else {
    const style = STYLES.find((s) => s.id === styleId);
    ctx.session.style = style?.eng || null;
    await ctx.answerCallbackQuery(`Стиль: ${style?.label}`);
    await ctx.editMessageText(
      `Стиль установлен: ${style?.label}\nТеперь отправь описание картинки.`
    );
  }
});

// ── /imagine — quick generation ─────────────────────────────────────
bot.command("imagine", async (ctx) => {
  const text = ctx.match;
  if (!text) {
    return ctx.reply("Напиши описание после /imagine\nПример: /imagine кот в космосе");
  }
  await doGenerate(ctx, text);
});

// ── Text messages — enhance prompt + confirm ────────────────────────
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return; // skip unknown commands

  await ctx.reply("Улучшаю промт...");

  try {
    const enhanced = await enhancePrompt(text, ctx.session.style || "");

    ctx.session.pendingPrompt = enhanced;

    const keyboard = new InlineKeyboard()
      .text("Сгенерировать", "gen:confirm")
      .text("Переделать", "gen:redo")
      .row()
      .text("Отмена", "gen:cancel");

    await ctx.reply(`Промт:\n\n${enhanced}`, {
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("[enhance]", err.message);
    await ctx.reply("Не удалось улучшить промт. Попробуй ещё раз.");
  }
});

// ── Callbacks: confirm / redo / cancel ──────────────────────────────
bot.callbackQuery("gen:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const prompt = ctx.session.pendingPrompt;
  if (!prompt) {
    return ctx.editMessageText("Промт не найден. Отправь описание заново.");
  }
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText(`Генерирую изображение...\n\nПромт: ${prompt}`);
  await doGenerate(ctx, prompt, true);
});

bot.callbackQuery("gen:redo", async (ctx) => {
  await ctx.answerCallbackQuery("Отправь новое описание");
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText("Отправь новое описание картинки.");
});

bot.callbackQuery("gen:cancel", async (ctx) => {
  await ctx.answerCallbackQuery("Отменено");
  ctx.session.pendingPrompt = null;
  await ctx.editMessageText("Генерация отменена.");
});

// ── Core generation logic ───────────────────────────────────────────
async function doGenerate(ctx, prompt, alreadyEnhanced = false) {
  let finalPrompt = prompt;

  if (!alreadyEnhanced) {
    try {
      await ctx.reply("Готовлю промт...");
      finalPrompt = await enhancePrompt(prompt, ctx.session.style || "");
    } catch {
      // Use original prompt if enhancement fails
    }
    await ctx.reply(`Генерирую...\nПромт: ${finalPrompt}`);
  }

  try {
    const result = await generateImage(finalPrompt);

    if (result.imageBase64) {
      const buf = Buffer.from(result.imageBase64, "base64");
      await ctx.replyWithPhoto(new InputFile(buf, "image.png"), {
        caption: finalPrompt.slice(0, 1024),
      });
    } else if (result.imageUrl) {
      await ctx.replyWithPhoto(result.imageUrl, {
        caption: finalPrompt.slice(0, 1024),
      });
    }
  } catch (err) {
    console.error("[generate]", err.message);
    await ctx.reply(
      "Не удалось сгенерировать изображение. Попробуй другое описание или повтори позже."
    );
  }
}

// ── Express + Webhook / Polling ─────────────────────────────────────
const app = express();

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

async function main() {
  if (WEBHOOK_URL) {
    // Production: webhook mode
    const { webhookCallback } = await import("grammy");
    app.use(express.json());
    app.use(`/bot${BOT_TOKEN}`, webhookCallback(bot, "express"));

    app.listen(PORT, async () => {
      await bot.api.setWebhook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
      console.log(`YuPself bot running on port ${PORT} (webhook)`);
    });
  } else {
    // Development: long polling
    app.listen(PORT, () => {
      console.log(`Health check on port ${PORT}`);
    });

    await bot.api.deleteWebhook();
    console.log("YuPself bot starting in polling mode...");
    bot.start();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
