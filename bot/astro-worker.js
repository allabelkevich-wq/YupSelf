import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateImage, editImage } from "./openrouter.js";
import supabase from "./db.js";

// Geocode — Nominatim directly (no external deps)
async function geocode(place) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&accept-language=ru`;
    const res = await fetch(url, { headers: { "User-Agent": "YupSelf/1.0" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data[0]) return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch {}
  return null;
}

// Use simplified chart (no swisseph dependency)
function getAstroSnapshot(opts) {
  return buildSimplifiedChart(opts);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Simplified natal chart without swisseph — based on date math.
 * Not as accurate as Swiss Ephemeris, but works without native C module.
 */
function buildSimplifiedChart(opts) {
  const { year, month, day, hour = 12, minute = 0 } = opts;

  // Sun sign by date (tropical, simplified)
  const SIGNS = ["Овен","Телец","Близнецы","Рак","Лев","Дева","Весы","Скорпион","Стрелец","Козерог","Водолей","Рыбы"];
  const SIGN_DATES = [
    [3,21],[4,20],[5,21],[6,21],[7,23],[8,23],[9,23],[10,23],[11,22],[12,22],[1,20],[2,19]
  ];
  let sunSign = "Рыбы", sunIndex = 11;
  for (let i = 0; i < 12; i++) {
    const [sm, sd] = SIGN_DATES[i];
    const [nm, nd] = SIGN_DATES[(i+1) % 12];
    if ((month === sm && day >= sd) || (month === nm && day < nd) ||
        (sm === 12 && nm === 1 && ((month === 12 && day >= sd) || (month === 1 && day < nd)))) {
      sunSign = SIGNS[i]; sunIndex = i; break;
    }
  }

  // Moon sign approximation (Moon moves ~13° per day, full cycle ~27.3 days)
  const dayOfYear = Math.floor((new Date(year, month-1, day) - new Date(year, 0, 0)) / 86400000);
  const moonCycle = (dayOfYear * 13.17 + hour * 0.55) % 360;
  const moonIndex = Math.floor(moonCycle / 30) % 12;
  const moonSign = SIGNS[moonIndex];

  // Ascendant approximation (based on birth hour)
  const ascIndex = (sunIndex + Math.floor(hour / 2)) % 12;
  const ascSign = SIGNS[ascIndex];

  // Houses (whole sign from ascendant)
  const sunHouse = ((sunIndex - ascIndex + 12) % 12) + 1;
  const moonHouse = ((moonIndex - ascIndex + 12) % 12) + 1;

  // Elements
  const ELEMENTS = { "Овен":"fire","Лев":"fire","Стрелец":"fire",
    "Телец":"earth","Дева":"earth","Козерог":"earth",
    "Близнецы":"air","Весы":"air","Водолей":"air",
    "Рак":"water","Скорпион":"water","Рыбы":"water" };

  // Simple positions
  const positions = [
    { name: "Солнце", sign: sunSign, degree: 15, house: sunHouse, retrograde: false, nakshatra: "", nakshatra_goal: "Дхарма" },
    { name: "Луна", sign: moonSign, degree: (moonCycle % 30), house: moonHouse, retrograde: false, nakshatra: "", nakshatra_goal: ["Дхарма","Артха","Кама","Мокша"][moonIndex % 4] },
    { name: "Меркурий", sign: SIGNS[(sunIndex + (day % 3 === 0 ? -1 : day % 3 === 1 ? 0 : 1) + 12) % 12], degree: 10, house: ((sunHouse + day % 3) % 12) + 1, retrograde: day % 7 === 0, nakshatra: "", nakshatra_goal: "Артха" },
    { name: "Венера", sign: SIGNS[(sunIndex + (month % 2 === 0 ? -2 : 1) + 12) % 12], degree: 20, house: ((sunHouse + 1) % 12) + 1, retrograde: false, nakshatra: "", nakshatra_goal: "Кама" },
    { name: "Марс", sign: SIGNS[(sunIndex + 3 + year % 3) % 12], degree: 8, house: ((sunHouse + 5) % 12) + 1, retrograde: year % 2 === 0, nakshatra: "", nakshatra_goal: "Артха" },
    { name: "Юпитер", sign: SIGNS[(year % 12)], degree: 15, house: ((ascIndex + 8) % 12) + 1, retrograde: false, nakshatra: "", nakshatra_goal: "Дхарма" },
    { name: "Сатурн", sign: SIGNS[((year - 3) % 12)], degree: 22, house: ((ascIndex + 10) % 12) + 1, retrograde: month > 6, nakshatra: "", nakshatra_goal: "Мокша" },
  ];

  // Aspects (simplified)
  const aspects = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const diff = Math.abs(positions[i].degree + SIGNS.indexOf(positions[i].sign) * 30 - positions[j].degree - SIGNS.indexOf(positions[j].sign) * 30);
      const angle = diff % 360 > 180 ? 360 - diff % 360 : diff % 360;
      if (Math.abs(angle - 90) < 10) aspects.push({ p1: positions[i].name, p2: positions[j].name, aspect: "квадрат", angle: 90, orb: Math.abs(angle - 90) });
      if (Math.abs(angle - 120) < 10) aspects.push({ p1: positions[i].name, p2: positions[j].name, aspect: "трин", angle: 120, orb: Math.abs(angle - 120) });
      if (Math.abs(angle - 180) < 10) aspects.push({ p1: positions[i].name, p2: positions[j].name, aspect: "оппозиция", angle: 180, orb: Math.abs(angle - 180) });
      if (angle < 8) aspects.push({ p1: positions[i].name, p2: positions[j].name, aspect: "соединение", angle: 0, orb: angle });
    }
  }

  // Atmakaraka (highest degree)
  const atma = positions.reduce((a, b) => a.degree > b.degree ? a : b);

  return {
    snapshot_text: `Simplified chart for ${opts.year}-${opts.month}-${opts.day}`,
    snapshot_json: {
      system: "simplified_tropical",
      house_system: "whole_sign",
      positions,
      aspects,
      retrograde: positions.filter(p => p.retrograde).map(p => p.name),
      atmakaraka: atma.name,
      arudha_lagna: ascSign,
      cusps: SIGNS.map((s, i) => SIGNS[(ascIndex + i) % 12]),
      dashas: {
        current_mahadasha: SIGNS[(year + month) % 7] ? ["Солнце","Луна","Марс","Меркурий","Юпитер","Венера","Сатурн"][(year + month) % 7] : "Венера",
        current_antardasha: ["Солнце","Луна","Марс","Меркурий","Юпитер","Венера","Сатурн"][(year + day) % 7],
      },
    },
    error: null,
  };
}

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
