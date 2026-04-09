import "dotenv/config";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LAOZHANG_API_KEY = process.env.LAOZHANG_API_KEY;
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_KEY;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LAOZHANG_URL = "https://api.laozhang.ai/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Image models
const IMAGE_MODEL_PRO = "google/gemini-3-pro-image-preview";
const IMAGE_MODEL_FLASH = "google/gemini-2.5-flash-image";
const IMAGE_MODEL_FALLBACK = "gemini-3-pro-image-preview-c";
// Text model for prompt enhancement — DeepSeek (smarter than Gemini Flash)
const DEEPSEEK_MODEL = "deepseek-chat";

// ── NEGATIVE PROMPT — what to NEVER generate ────────────────────────
const NEGATIVE_PROMPT = `
NEGATIVE PROMPT (absolutely avoid in the generated image):
- No stock photo aesthetic, no generic corporate look
- No cheesy motivational poster style (sunset + silhouette cliche)
- No clip art, no cartoon elements unless explicitly requested
- No oversaturated neon colors, no rainbow gradients
- No AI-obvious artifacts (distorted hands, melted faces, wrong text, extra fingers)
- No generic Pinterest "inspirational quote" aesthetic
- No busy cluttered backgrounds
- No watermarks, borders, frames, logos
- No generic "beautiful landscape" without unique perspective
- No cliche stock lighting (flat corporate flash)
- No plastic-looking skin or uncanny valley faces
- No text on image UNLESS user explicitly requested text/title/caption
`.trim();

// ── LIGHT TRANSLATE PROMPT — just translate + add quality markers ────
const TRANSLATE_PROMPT = `Translate the user's image description to English.
Keep the EXACT same idea — do NOT change, rewrite or "improve" the concept.
Just translate accurately and add "high quality, detailed" at the end.
If the text is already in English — return it as-is.
If user asks for text on image — preserve the exact text in quotes.
Return ONLY the translated prompt, nothing else.`;

// ── FULL ENHANCE PROMPT — for when user explicitly asks for enhancement ──
const ENHANCE_PROMPT = `You are an image prompt engineer.
The user gives you a description. Your job:
1. Translate to English if needed
2. Add 1-2 sentences of visual detail (lighting, composition, mood)
3. Keep the user's original idea intact — do NOT replace it
4. If user asks for text on image — preserve exact text in quotes
Return ONLY the final prompt. No quotes, no explanations.`;

/**
 * Light translation — just translate to English, keep the idea.
 * Used automatically before every generation.
 */
export async function translatePrompt(userText) {
  // Skip if already English
  if (/^[a-zA-Z0-9\s.,!?'"()\-:;]+$/.test(userText)) return userText;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: TRANSLATE_PROMPT },
          { role: "user", content: userText },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!res.ok) return userText; // fallback to original
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || userText;
  } catch {
    return userText; // fallback
  }
}

/**
 * Full enhancement — translate + add visual details.
 * Used only when user explicitly asks.
 */
export async function enhancePrompt(userText, style = "") {
  const userMessage = style
    ? `Description: ${userText}\n\nApply this style: ${style}`
    : userText;

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: ENHANCE_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || userText;
}

/**
 * Generate image with fallback chain.
 * @param {string} prompt
 * @param {{ aspectRatio?: string, imageSize?: string, quality?: string }} imageConfig
 * quality: "fast" = Flash (5-10s), "pro" = Pro (15-30s, default)
 */
export async function generateImage(prompt, imageConfig = {}) {
  const config = {
    aspect_ratio: imageConfig.aspectRatio || "1:1",
    image_size: imageConfig.imageSize || "1K",
  };

  const model = imageConfig.quality === "fast" ? IMAGE_MODEL_FLASH : IMAGE_MODEL_PRO;

  // Attempt 1: laozhang.ai (primary — cheaper, $0.05 vs $0.134)
  if (LAOZHANG_API_KEY) {
    try {
      const laoModel = imageConfig.quality === "fast" ? "gemini-2.5-flash-image" : IMAGE_MODEL_FALLBACK;
      const result = await _callImageApi(
        LAOZHANG_URL,
        LAOZHANG_API_KEY,
        laoModel,
        prompt,
        config
      );
      if (result) return result;
    } catch (err) {
      console.warn("[image] laozhang failed:", err.message);
    }
  }

  // Attempt 2: laozhang Flash (if Pro was rate-limited)
  if (LAOZHANG_API_KEY && imageConfig.quality !== "fast") {
    try {
      console.log("[image] trying laozhang Flash fallback...");
      const result = await _callImageApi(
        LAOZHANG_URL,
        LAOZHANG_API_KEY,
        "gemini-2.5-flash-image",
        prompt,
        config
      );
      if (result) return result;
    } catch (err) {
      console.warn("[image] laozhang Flash failed:", err.message);
    }
  }

  // Attempt 3: OpenRouter (last resort)
  try {
    const result = await _callImageApi(
      OPENROUTER_URL,
      OPENROUTER_API_KEY,
      model,
      prompt,
      config
    );
    if (result) return result;
  } catch (err) {
    console.warn("[image] OpenRouter fallback failed:", err.message);
  }

  throw new Error("All image generation APIs failed");
}

// ── Google AI Studio URL ────────────────────────────────────────────
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Generate image WITH face reference using Google AI Studio native API.
 * This is the ONLY reliable way to do multimodal image generation (face in → image out).
 * laozhang/OpenRouter return 400 for multimodal image generation.
 *
 * Fallback chain:
 * 1. Google AI Studio (gemini-2.0-flash-preview-image-generation) — multimodal
 * 2. Google AI Studio (gemini-2.0-flash-exp) — multimodal fallback
 * 3. laozhang/OpenRouter text-only (no face, just prompt) — last resort
 *
 * @param {string} prompt — the image generation prompt
 * @param {string} faceBase64 — face photo base64 (with or without data: prefix)
 * @param {{ aspectRatio?: string }} imageConfig
 */
export async function generateImageWithFace(prompt, faceBase64, imageConfig = {}) {
  const cleanB64 = faceBase64.replace(/^data:image\/\w+;base64,/, "");

  // Truncate visual prompt to ~800 chars to leave room for face instructions
  // Long prompts cause Gemini to ignore the face reference
  const visualPrompt = prompt.length > 800 ? prompt.slice(0, 800) + "..." : prompt;

  // Face instruction FIRST, short and direct — then visual description
  const fullPrompt = `Generate a portrait using the attached face photo as reference. ` +
    `The person's face MUST match the photo exactly — same eyes, nose, lips, face shape, skin tone. ` +
    `Do NOT change the face. Do NOT use a different person.\n\n` +
    `Visual style: ${visualPrompt}`;

  const MODELS = [
    "gemini-3-pro-image-preview",      // Nano Banana Pro — best quality
    "gemini-3.1-flash-image-preview",   // Nano Banana 2 — fast fallback
    "gemini-2.5-flash-image",           // Nano Banana — another fallback
  ];

  // Primary: laozhang editImage (paid, reliable for multimodal)
  try {
    console.log("[face-gen] using laozhang editImage (primary)...");
    return await editImage(fullPrompt, [faceBase64], imageConfig);
  } catch (err) {
    console.warn("[face-gen] editImage failed:", err.message);
  }

  // Fallback: Google AI Studio (if key available and has quota)
  if (GOOGLE_AI_KEY) {
    for (const model of MODELS) {
      try {
        console.log(`[face-gen] trying Google AI Studio: ${model}...`);
        const result = await _callGoogleAI(model, fullPrompt, cleanB64);
        if (result) {
          console.log(`[face-gen] success with ${model}`);
          return result;
        }
      } catch (err) {
        console.warn(`[face-gen] ${model} failed:`, err.message);
      }
    }
  }

  // Last resort: generate without face (text-only)
  console.log("[face-gen] all multimodal failed, generating text-only...");
  const textOnlyPrompt = prompt + "\nCreate a portrait of this person showing their unique energy and presence.";
  return await generateImage(textOnlyPrompt, { ...imageConfig, quality: "pro" });
}

/**
 * Call Google AI Studio native API for multimodal image generation.
 * Uses inline_data format (Gemini native, most reliable).
 */
async function _callGoogleAI(model, prompt, imageBase64) {
  const url = `${GOOGLE_AI_URL}/${model}:generateContent?key=${GOOGLE_AI_KEY}`;

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: imageBase64,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      temperature: 1.0,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s for image gen

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google AI ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();

  // Extract image from Google AI response
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  for (const part of parts) {
    if (part.inlineData?.data) {
      return { imageBase64: part.inlineData.data };
    }
    // Some responses use inline_data (snake_case)
    if (part.inline_data?.data) {
      return { imageBase64: part.inline_data.data };
    }
  }

  return null;
}

/**
 * Edit an image using reference photo(s) + instruction.
 * Uses best practices from top NanoBanana services:
 * - "maintain identity" / "preserve face" instructions
 * - inline_data format (not image_url)
 * - Structured prompt: action → subject → attributes → constraints
 *
 * @param {string} prompt — user's edit instruction
 * @param {string[]} imageBase64List — base64 images (without data: prefix)
 * @param {{ aspectRatio?: string, imageSize?: string }} imageConfig
 */
export async function editImage(prompt, imageBase64List, imageConfig = {}) {
  // Build multimodal content using inline_data (Gemini native format)
  // laozhang requires inline_data, NOT image_url for multimodal image generation
  const content = [];

  for (const b64 of imageBase64List) {
    const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
    content.push({
      type: "inline_data",
      inline_data: {
        mime_type: "image/jpeg",
        data: cleanB64,
      },
    });
  }

  content.push({ type: "text", text: prompt });

  const apiUrl = LAOZHANG_API_KEY ? LAOZHANG_URL : OPENROUTER_URL;
  const apiKey = LAOZHANG_API_KEY || OPENROUTER_API_KEY;

  // Try up to 2 attempts — if Gemini returns text instead of image, retry with simpler prompt
  const prompts = [prompt, `Apply changes to this image and return the result as an image: ${prompt}`];

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    // Rebuild content with current prompt
    const reqContent = [...content.slice(0, -1), { type: "text", text: prompts[attempt] }];

    const body = {
      model: LAOZHANG_API_KEY ? IMAGE_MODEL_FALLBACK : IMAGE_MODEL_PRO,
      messages: [{ role: "user", content: reqContent }],
      max_tokens: 8192,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();

      // Check if Gemini returned an error in text instead of image
      const msg = data.choices?.[0]?.message?.content;
      if (typeof msg === "string" && msg.includes("MALFORMED_FUNCTION_CALL")) {
        console.warn(`[edit] attempt ${attempt + 1}: Gemini returned text, not image. Retrying...`);
        continue;
      }

      const result = _extractImage(data);
      if (result) return result;
      console.warn(`[edit] attempt ${attempt + 1}: no image extracted`);
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === prompts.length - 1) {
        console.warn("[edit] all attempts failed:", err.message);
      }
    }
  }

  } catch (e) { console.warn("[edit] text-only fallback failed:", e.message); }

  throw new Error("Image editing failed — no image in response");
}

/**
 * Internal: call an OpenAI-compatible image API and extract result.
 */
async function _callImageApi(apiUrl, apiKey, model, prompt, imageConfig = {}) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 8192, // Limit tokens to avoid 402 credit errors
  };

  // Add image_config for aspect ratio and size
  if (imageConfig.aspect_ratio || imageConfig.image_size) {
    body.image_config = {};
    if (imageConfig.aspect_ratio) body.image_config.aspect_ratio = imageConfig.aspect_ratio;
    if (imageConfig.image_size) body.image_config.image_size = imageConfig.image_size;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return _extractImage(data);
}

/**
 * Extract image from various API response formats.
 */
function _extractImage(data) {
  const message = data.choices?.[0]?.message;
  if (!message) return null;

  // Format 0: message.images[] (Gemini via OpenRouter)
  if (message.images?.length) {
    for (const img of message.images) {
      const url = img.image_url?.url || img.url || img.b64_json;
      if (url) {
        if (url.startsWith("data:image")) {
          return { imageBase64: url.replace(/^data:image\/\w+;base64,/, "") };
        }
        if (url.startsWith("http")) return { imageUrl: url };
        return { imageBase64: url };
      }
    }
  }

  if (!message.content) return null;

  // Format 1: Array with image parts (OpenRouter style)
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url" || part.type === "image") {
        const b64 =
          part.image_url?.url || part.url || part.data || part.b64_json;
        if (b64) {
          return {
            imageBase64: b64.replace(/^data:image\/\w+;base64,/, ""),
          };
        }
      }
    }
    // Try inline_data format
    for (const part of message.content) {
      if (part.inline_data?.data) {
        return { imageBase64: part.inline_data.data };
      }
    }
  }

  // Format 2: String content
  if (typeof message.content === "string") {
    const content = message.content.trim();

    // Markdown image: ![image](data:image/jpeg;base64,...) — laozhang format
    const mdMatch = content.match(/!\[.*?\]\((data:image\/\w+;base64,[A-Za-z0-9+/=]+)\)/);
    if (mdMatch) {
      return { imageBase64: mdMatch[1].replace(/^data:image\/\w+;base64,/, "") };
    }

    // base64 data URI
    if (content.startsWith("data:image")) {
      return {
        imageBase64: content.replace(/^data:image\/\w+;base64,/, ""),
      };
    }

    // Direct URL
    if (content.startsWith("http")) {
      return { imageUrl: content };
    }

    // Raw base64 (no prefix, long string)
    if (content.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(content.slice(0, 100))) {
      return { imageBase64: content };
    }
  }

  // Format 3: images array (some providers)
  if (data.images?.length) {
    const img = data.images[0];
    if (img.url) return { imageUrl: img.url };
    if (img.b64_json) return { imageBase64: img.b64_json };
  }

  return null;
}
