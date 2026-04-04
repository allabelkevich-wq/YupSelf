import "dotenv/config";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// NanoBanana 2 (Gemini 3.1 Flash Image) — fast, high quality
const IMAGE_MODEL = "google/gemini-2.5-flash-preview-image";
// Text model for prompt enhancement
const TEXT_MODEL = "google/gemini-2.5-flash-preview";

/**
 * Enhance a user's image prompt — translate to English, add style details.
 * Returns the improved prompt string.
 */
export async function enhancePrompt(userText, style = "") {
  const systemPrompt = `You are an expert AI image prompt engineer.
The user gives you a description in any language. Your job:
1. Translate it to English if needed
2. Expand it into a detailed, vivid image generation prompt (2-4 sentences)
3. Add artistic details: lighting, composition, mood, texture
${style ? `4. Apply this style: ${style}` : ""}
Return ONLY the final prompt, nothing else. No quotes, no explanations.`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter text error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || userText;
}

/**
 * Generate an image from a prompt using NanoBanana.
 * Returns { imageBase64, revisedPrompt } or throws on error.
 */
export async function generateImage(prompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      // Request image output
      response_format: { type: "image" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter image error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;

  // NanoBanana returns image as base64 in content
  if (message?.content) {
    // Check if content is an array (multimodal response)
    if (Array.isArray(message.content)) {
      const imagePart = message.content.find(
        (p) => p.type === "image_url" || p.type === "image"
      );
      if (imagePart) {
        const b64 = imagePart.image_url?.url || imagePart.url || imagePart.data;
        if (b64) {
          const base64Data = b64.replace(/^data:image\/\w+;base64,/, "");
          return { imageBase64: base64Data };
        }
      }
    }
    // String content — might be base64 or a URL
    if (typeof message.content === "string") {
      if (message.content.startsWith("data:image")) {
        const base64Data = message.content.replace(
          /^data:image\/\w+;base64,/,
          ""
        );
        return { imageBase64: base64Data };
      }
      // Could be a URL
      if (message.content.startsWith("http")) {
        return { imageUrl: message.content.trim() };
      }
    }
  }

  throw new Error("No image in OpenRouter response");
}
