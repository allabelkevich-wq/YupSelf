import "dotenv/config";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LAOZHANG_API_KEY = process.env.LAOZHANG_API_KEY;

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

  // Attempt 1: OpenRouter
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
    console.warn("[image] OpenRouter failed:", err.message);
  }

  // Attempt 2: laozhang.ai fallback
  if (LAOZHANG_API_KEY) {
    try {
      const result = await _callImageApi(
        LAOZHANG_URL,
        LAOZHANG_API_KEY,
        IMAGE_MODEL_FALLBACK,
        prompt,
        config
      );
      if (result) return result;
    } catch (err) {
      console.warn("[image] laozhang fallback failed:", err.message);
    }
  }

  throw new Error("All image generation APIs failed");
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
  // Build multimodal content: images first, then structured prompt
  const content = [];

  // Add images as inline_data (Gemini native format, more reliable than image_url)
  for (const b64 of imageBase64List) {
    const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${cleanB64}`,
      },
    });
  }

  // Structured prompt with face preservation instructions
  const structuredPrompt = `Use the attached reference image(s). ${prompt}. ` +
    `Preserve facial features, expression, and identity exactly as in the reference. ` +
    `Maintain character consistency. Do not alter face shape, eye color, or distinguishing features.`;

  content.push({ type: "text", text: structuredPrompt });

  const body = {
    model: IMAGE_MODEL_PRO, // Always use Pro for edits (better face preservation)
    messages: [{ role: "user", content }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
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
    const result = _extractImage(data);
    if (result) return result;
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[edit] failed:", err.message);
    throw err;
  }

  throw new Error("Image editing failed — no image in response");
}

/**
 * Internal: call an OpenAI-compatible image API and extract result.
 */
async function _callImageApi(apiUrl, apiKey, model, prompt, imageConfig = {}) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
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
