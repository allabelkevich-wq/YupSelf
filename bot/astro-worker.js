import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateImage, editImage } from "./openrouter.js";
import supabase from "./db.js";

// Geocode — multi-strategy (Nominatim → Photon → hardcoded fallback)
async function geocode(place) {
  // Strategy 1: Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&accept-language=ru`;
    const res = await fetch(url, { headers: { "User-Agent": "YupSelf-AstroGen/1.0 (alla@yupsoul.com)" } });
    if (res.ok) {
      const data = await res.json();
      if (data[0]) return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
    }
  } catch {}

  // Strategy 2: Photon (Komoot)
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(place)}&limit=1&lang=ru`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (coords) return { lat: coords[1], lon: coords[0] };
    }
  } catch {}

  // Strategy 3: Hardcoded major cities
  const CITIES = {
    "москва": { lat: 55.7558, lon: 37.6173 }, "санкт-петербург": { lat: 59.9343, lon: 30.3351 },
    "киев": { lat: 50.4501, lon: 30.5234 }, "минск": { lat: 53.9006, lon: 27.5590 },
    "london": { lat: 51.5074, lon: -0.1278 }, "new york": { lat: 40.7128, lon: -74.0060 },
    "berlin": { lat: 52.5200, lon: 13.4050 }, "paris": { lat: 48.8566, lon: 2.3522 },
    "tokyo": { lat: 35.6762, lon: 139.6503 }, "dubai": { lat: 25.2048, lon: 55.2708 },
    "казань": { lat: 55.7887, lon: 49.1221 }, "новосибирск": { lat: 55.0084, lon: 82.9357 },
    "екатеринбург": { lat: 56.8389, lon: 60.6057 }, "краснодар": { lat: 45.0355, lon: 38.9753 },
    "сочи": { lat: 43.5855, lon: 39.7231 }, "ростов-на-дону": { lat: 47.2357, lon: 39.7015 },
    "солигорск": { lat: 52.7879, lon: 27.5414 }, "омск": { lat: 54.9885, lon: 73.3242 },
    "самара": { lat: 53.1959, lon: 50.1002 }, "уфа": { lat: 54.7388, lon: 55.9721 },
    "волгоград": { lat: 48.7080, lon: 44.5133 }, "пермь": { lat: 58.0105, lon: 56.2502 },
    "воронеж": { lat: 51.6616, lon: 39.2003 }, "челябинск": { lat: 55.1644, lon: 61.4368 },
    "красноярск": { lat: 56.0153, lon: 92.8932 }, "нижний новгород": { lat: 56.2965, lon: 43.9361 },
    "тюмень": { lat: 57.1553, lon: 65.5619 }, "иркутск": { lat: 52.2870, lon: 104.3050 },
    "хабаровск": { lat: 48.4802, lon: 135.0719 }, "владивосток": { lat: 43.1332, lon: 131.9113 },
    "ташкент": { lat: 41.2995, lon: 69.2401 }, "алматы": { lat: 43.2220, lon: 76.8512 },
    "тбилиси": { lat: 41.7151, lon: 44.8271 }, "баку": { lat: 40.4093, lon: 49.8671 },
    "ереван": { lat: 40.1792, lon: 44.4991 }, "рига": { lat: 56.9496, lon: 24.1052 },
    "вильнюс": { lat: 54.6872, lon: 25.2797 }, "таллин": { lat: 59.4370, lon: 24.7536 },
  };
  const key = place.toLowerCase().trim();
  if (CITIES[key]) return CITIES[key];
  for (const [k, v] of Object.entries(CITIES)) {
    if (key.includes(k)) return v;
  }

  console.warn("[geocode] all strategies failed for:", place);
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
      max_tokens: 1200,
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

  // ── Step 3b: DeepSeek → text analysis (расшифровка) ─────
  console.log(`[astro] Step 3b: Generating text analysis...`);
  let analysis = "";
  try {
    const analysisRes = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: `Ты — мудрый визуальный астролог-расшифровщик. Ты получишь натальную карту И промт для изображения. Твоя задача — написать ПОДРОБНУЮ расшифровку на русском языке, которая объясняет КАЖДЫЙ элемент изображения.

ФОРМАТ РАСШИФРОВКИ:

1. ОБЩЕЕ ВПЕЧАТЛЕНИЕ (2-3 предложения): что чувствует человек, глядя на эту картину. Почему именно ТАКОЙ стиль и настроение.

2. РАСШИФРОВКА СИМВОЛОВ (каждый элемент картины):
Для каждого заметного элемента:
★ [Что видно] — [Что это означает для тебя]

Примеры:
★ Тёплый золотой свет из центра — это твоя природная способность создавать уют и безопасность вокруг себя. Люди тянутся к тебе как к очагу.
★ Корни дерева, уходящие глубоко в землю — твоя связь с родом, с традицией. Ты черпаешь силу из глубин, из того что было ДО тебя.
★ Лотос над водой — твоя способность превращать глубокие эмоции в красоту. Из глубины чувств рождается цветок.

3. ЛИЧНОЕ ПОСЛАНИЕ (2-3 предложения): обращение к человеку, что эта картина говорит о его пути.

СТИЛЬ: говори как мудрый друг, тепло и лично. Без астрологических терминов. Не упоминай планеты, знаки, дома. Только метафоры и образы.
Длина: 500-800 слов.` },
          { role: "user", content: userMessage + "\n\nПРОМТ ДЛЯ ИЗОБРАЖЕНИЯ (опиши что на картине):\n" + imagePrompt },
        ],
        max_tokens: 1000,
        temperature: 0.8,
      }),
    });
    if (analysisRes.ok) {
      const aData = await analysisRes.json();
      analysis = aData.choices?.[0]?.message?.content?.trim() || "";
    }
  } catch (e) { console.warn("[astro] analysis failed:", e.message); }

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
    analysis,
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
