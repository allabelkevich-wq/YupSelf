import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getAstroSnapshot } from "./astroLib.js";
import { geocode } from "./geocode.js";
import { generateImage, editImage } from "./openrouter.js";
import supabase from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load astro-visual system prompt
const ASTRO_VISUAL_PROMPT = readFileSync(
  join(__dirname, "prompts", "astro-visual-prompt.txt"),
  "utf-8"
);

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

/**
 * Full astro-image generation pipeline.
 * Birth data → geocode → natal chart → DeepSeek visual prompt → NanoBanana Pro → image
 *
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.birthdate — YYYY-MM-DD
 * @param {string} params.birthplace — city name
 * @param {string} params.birthtime — HH:MM or null
 * @param {boolean} params.birthtimeUnknown
 * @param {string} params.gender — male/female
 * @param {string} params.intention — user's request/question (optional)
 * @param {string} params.faceImageB64 — face photo base64 (optional)
 * @param {string} params.aspectRatio — 1:1, 9:16, etc.
 * @returns {{ imageBase64, imageUrl, astroPrompt, snapshotSummary }}
 */
export async function generateAstroImage(params) {
  const {
    name,
    birthdate,
    birthplace,
    birthtime,
    birthtimeUnknown,
    gender,
    intention,
    faceImageB64,
    aspectRatio = "1:1",
  } = params;

  // ── Step 1: Geocode birthplace ──────────────────────────
  console.log(`[astro] Step 1: Geocoding "${birthplace}"...`);
  const geo = await geocode(birthplace);
  if (!geo || !geo.lat) {
    throw new Error(`Не удалось определить координаты: ${birthplace}`);
  }
  console.log(`[astro] Geocoded: ${geo.lat}, ${geo.lon}`);

  // ── Step 2: Calculate natal chart ───────────────────────
  console.log(`[astro] Step 2: Calculating natal chart...`);
  const [year, month, day] = birthdate.split("-").map(Number);
  let hour = 12, minute = 0;
  if (birthtime && !birthtimeUnknown) {
    const [h, m] = birthtime.split(":").map(Number);
    hour = h;
    minute = m;
  }

  const astro = getAstroSnapshot({
    year,
    month,
    day,
    hour,
    minute,
    latitude: geo.lat,
    longitude: geo.lon,
    timeUnknown: !!birthtimeUnknown,
  });

  if (astro.error) {
    throw new Error(`Ошибка расчёта карты: ${astro.error}`);
  }
  console.log(`[astro] Chart calculated. Planets: ${astro.snapshot_json.positions.length}`);

  // ── Step 3: DeepSeek → visual prompt ────────────────────
  console.log(`[astro] Step 3: DeepSeek generating visual prompt...`);

  const userMessage = buildAstroUserMessage(astro, name, gender, intention, !!faceImageB64);

  const dsRes = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: ASTRO_VISUAL_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 800,
      temperature: 0.85,
    }),
  });

  if (!dsRes.ok) {
    const err = await dsRes.text();
    throw new Error(`DeepSeek error: ${err.slice(0, 200)}`);
  }

  const dsData = await dsRes.json();
  const imagePrompt = dsData.choices?.[0]?.message?.content?.trim();
  if (!imagePrompt) throw new Error("DeepSeek returned empty prompt");

  console.log(`[astro] Visual prompt (${imagePrompt.length} chars): "${imagePrompt.slice(0, 100)}..."`);

  // ── Step 4: Generate image ──────────────────────────────
  console.log(`[astro] Step 4: Generating image...`);

  let result;
  if (faceImageB64) {
    // Edit mode: face + astro prompt
    result = await editImage(imagePrompt, [faceImageB64], { aspectRatio });
  } else {
    // Generate from scratch
    result = await generateImage(imagePrompt, { aspectRatio, quality: "pro" });
  }

  console.log(`[astro] Image generated! base64: ${(result.imageBase64 || "").length} chars`);

  // Build summary (no astro terms for user)
  const sun = astro.snapshot_json.positions.find(p => p.name === "Солнце");
  const moon = astro.snapshot_json.positions.find(p => p.name === "Луна");
  const snapshotSummary = `Визуальный профиль для ${name}: энергия ${sun?.sign || "?"}, настроение ${moon?.sign || "?"}`;

  return {
    imageBase64: result.imageBase64 || null,
    imageUrl: result.imageUrl || null,
    astroPrompt: imagePrompt,
    snapshotSummary,
    astroSnapshot: astro.snapshot_json,
  };
}

/**
 * Build user message for DeepSeek from astro data.
 */
function buildAstroUserMessage(astro, name, gender, intention, hasFace) {
  const json = astro.snapshot_json;
  const positions = json.positions || [];

  // Extract key data
  const sun = positions.find(p => p.name === "Солнце");
  const moon = positions.find(p => p.name === "Луна");
  const asc = json.cusps?.[0] || "unknown";

  // Element distribution
  const elements = { fire: 0, earth: 0, air: 0, water: 0 };
  const elementMap = {
    "Овен": "fire", "Лев": "fire", "Стрелец": "fire",
    "Телец": "earth", "Дева": "earth", "Козерог": "earth",
    "Близнецы": "air", "Весы": "air", "Водолей": "air",
    "Рак": "water", "Скорпион": "water", "Рыбы": "water",
  };
  for (const p of positions) {
    const el = elementMap[p.sign];
    if (el) elements[el]++;
  }
  const dominantElement = Object.entries(elements).sort((a, b) => b[1] - a[1])[0][0];

  // Retrograde planets
  const retro = json.retrograde || [];

  // Key aspects
  const keyAspects = (json.aspects || [])
    .filter(a => ["квадрат", "оппозиция", "трин", "соединение"].includes(a.aspect))
    .slice(0, 5);

  // Dashas
  const dasha = json.dashas || {};

  let msg = `Создай визуальный промт для изображения.

ДАННЫЕ НАТАЛЬНОЙ КАРТЫ:
Имя: ${name || "Unknown"}
Пол: ${gender === "male" ? "мужской" : "женский"}
${intention ? `Намерение/запрос: ${intention}` : ""}

ПЛАНЕТЫ:
${positions.map(p => `${p.name}: ${p.sign} (${p.degree.toFixed(1)}°), ${p.house} дом${p.retrograde ? " [R]" : ""}${p.nakshatra ? `, накшатра: ${p.nakshatra} (${p.nakshatra_goal})` : ""}`).join("\n")}

ДОМИНАНТНАЯ СТИХИЯ: ${dominantElement} (${JSON.stringify(elements)})
АТМАКАРАКА: ${json.atmakaraka || "не определена"}
АРУДА ЛАГНА: ${json.arudha_lagna || "не определена"}

КЛЮЧЕВЫЕ АСПЕКТЫ:
${keyAspects.map(a => `${a.p1} ${a.aspect} ${a.p2} (орб ${a.orb.toFixed(1)}°)`).join("\n") || "нет значимых"}

РЕТРОГРАДНЫЕ: ${retro.length ? retro.join(", ") : "нет"}

ДАШИ:
Махадаша: ${dasha.current_mahadasha || "?"}, Антардаша: ${dasha.current_antardasha || "?"}

${hasFace ? "ВАЖНО: К промту будет приложено фото лица. Добавь инструкцию: 'Preserve the facial features, identity and expression from the reference photo exactly. Maintain character consistency.'" : "Фото лица нет — создай абстрактный/символический портрет энергии этого человека."}`;

  return msg;
}
