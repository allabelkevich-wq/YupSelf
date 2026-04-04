import "dotenv/config";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LAOZHANG_API_KEY = process.env.LAOZHANG_API_KEY;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LAOZHANG_URL = "https://api.laozhang.ai/v1/chat/completions";

// Image models (with fallback chain)
const IMAGE_MODEL_PRIMARY = "google/gemini-3-pro-image-preview";
const IMAGE_MODEL_FALLBACK = "gemini-3-pro-image-preview-c";
// Text model for prompt enhancement
const TEXT_MODEL = "google/gemini-2.5-flash-preview";

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
- No emojis as visual elements
- No generic "beautiful landscape" without unique perspective
- No cliche stock lighting (flat corporate flash)
- No plastic-looking skin or uncanny valley faces
- No text on image unless explicitly requested
`.trim();

// ── QUALITY SYSTEM PROMPT — expert prompt engineer ──────────────────
const SYSTEM_PROMPT = `You are an elite visual prompt architect — not a generic AI assistant.
Your mission: transform ANY user description into a cinematic, editorial-grade image prompt.

## YOUR APPROACH:
1. TRANSLATE to English if the input is in another language
2. IDENTIFY the core visual concept — what makes this image unique, not generic
3. CRAFT a detailed prompt (3-6 sentences) with these mandatory layers:
   - SUBJECT: precise, specific, with personality or story
   - COMPOSITION: camera angle, framing, depth of field, focal point
   - LIGHTING: volumetric, directional, color temperature, shadows
   - ATMOSPHERE: mood, texture, environment details
   - TECHNIQUE: photographic or artistic technique reference (not artist names)
4. APPLY the requested style (if any), deeply integrated — not just appended
5. INJECT the negative prompt at the end

## QUALITY RULES:
- Every prompt must feel like a brief to a $10,000/day photographer or concept artist
- Specificity > generality: "warm amber side-light at golden hour" NOT "nice lighting"
- Unique perspective > cliche: "low angle through rain-covered glass" NOT "beautiful view"
- Emotional resonance: every image should evoke a feeling, not just depict a scene
- Reference 2026 visual trends: editorial minimalism, volumetric atmospherics, raw textures
- If the user's idea is vague, make a bold creative choice — don't play it safe

## ABSOLUTE PROHIBITIONS:
- Never produce a prompt that could result in a stock photo
- Never use generic phrases: "beautiful", "stunning", "amazing", "breathtaking"
- Never reference specific artists by name (copyright issues)
- Never add text/typography to images unless user explicitly asks

## OUTPUT FORMAT:
Return ONLY the final prompt text. No quotes, no explanations, no preamble.
End with the negative prompt section.`;

/**
 * Enhance a user's image prompt — full creative rewrite with anti-cliche system.
 */
export async function enhancePrompt(userText, style = "") {
  const userMessage = style
    ? `Description: ${userText}\n\nApply this style deeply: ${style}`
    : userText;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 600,
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter text error ${res.status}: ${err}`);
  }

  const data = await res.json();
  let enhanced = data.choices?.[0]?.message?.content?.trim() || userText;

  // Ensure negative prompt is included
  if (!enhanced.toLowerCase().includes("negative prompt")) {
    enhanced += "\n\n" + NEGATIVE_PROMPT;
  }

  return enhanced;
}

/**
 * Generate image with fallback chain: OpenRouter → laozhang.ai
 */
export async function generateImage(prompt) {
  // Attempt 1: OpenRouter (Gemini 3 Pro Image)
  try {
    const result = await _callImageApi(
      OPENROUTER_URL,
      OPENROUTER_API_KEY,
      IMAGE_MODEL_PRIMARY,
      prompt
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
        prompt
      );
      if (result) return result;
    } catch (err) {
      console.warn("[image] laozhang fallback failed:", err.message);
    }
  }

  throw new Error("All image generation APIs failed");
}

/**
 * Internal: call an OpenAI-compatible image API and extract result.
 */
async function _callImageApi(apiUrl, apiKey, model, prompt) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

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
  if (!message?.content) return null;

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
