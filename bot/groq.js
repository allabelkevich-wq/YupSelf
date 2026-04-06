import "dotenv/config";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Transcribe audio buffer using Groq Whisper.
 * Uses whisper-large-v3-turbo (faster) — same as DreamWorker.
 *
 * @param {Buffer} audioBuffer — audio file buffer
 * @param {string} filename — e.g. "voice.ogg"
 * @param {string} mimetype — e.g. "audio/webm"
 * @returns {string} transcribed text
 */
export async function transcribeAudio(audioBuffer, filename = "voice.webm", mimetype = "audio/webm") {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not configured");
  }

  console.log("[groq] transcribing:", filename, "size:", audioBuffer.length, "mime:", mimetype);

  const form = new FormData();
  form.append("file", new File([audioBuffer], filename, { type: mimetype }));
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "ru");
  form.append("response_format", "json");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[groq] error:", res.status, err);
    throw new Error(`Groq Whisper error ${res.status}: ${err}`);
  }

  const data = await res.json();
  console.log("[groq] result:", (data.text || "").slice(0, 80));
  return (data.text || "").trim();
}
