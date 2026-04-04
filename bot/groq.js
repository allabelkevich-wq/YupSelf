import "dotenv/config";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Transcribe audio buffer using Groq Whisper.
 * @param {Buffer} audioBuffer — OGG/MP3/WAV file buffer
 * @param {string} filename — e.g. "voice.ogg"
 * @returns {string} transcribed text
 */
export async function transcribeAudio(audioBuffer, filename = "voice.ogg") {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not configured");
  }

  // Determine MIME type from filename
  const ext = filename.split(".").pop()?.toLowerCase() || "ogg";
  const mimeMap = { ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", m4a: "audio/mp4" };
  const mime = mimeMap[ext] || "audio/ogg";

  const formData = new FormData();
  formData.append("file", new File([audioBuffer], filename, { type: mime }));
  formData.append("model", "whisper-large-v3");
  formData.append("language", "ru");
  formData.append("response_format", "text");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Whisper error ${res.status}: ${err}`);
  }

  const text = await res.text();
  return text.trim();
}
