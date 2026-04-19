import "dotenv/config";
import crypto from "crypto";
import supabase from "./db.js";

/**
 * Create or get editing session.
 * Session stores conversation history for multi-turn editing.
 */
export async function getOrCreateSession(telegramId) {
  // Get active session (last 30 min)
  const { data: existing } = await supabase
    .from("edit_sessions")
    .select("*")
    .eq("telegram_id", telegramId)
    .gte("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing;

  // Create new session
  const sessionId = crypto.randomBytes(6).toString("hex");
  const { data, error } = await supabase
    .from("edit_sessions")
    .insert({
      telegram_id: telegramId,
      session_id: sessionId,
      messages: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Add a message to session history (for multi-turn).
 * Keeps last 10 messages to avoid token overflow.
 */
export async function addMessage(sessionId, role, content) {
  const { data: session } = await supabase
    .from("edit_sessions")
    .select("messages")
    .eq("session_id", sessionId)
    .single();

  if (!session) return;

  const messages = session.messages || [];
  messages.push({ role, content: typeof content === "string" ? content : "[image]", ts: Date.now() });

  // Keep last 10 messages
  const trimmed = messages.slice(-10);

  await supabase
    .from("edit_sessions")
    .update({ messages: trimmed, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId);
}

/**
 * Save last generated image to session (for "now change the background" flow).
 */
export async function saveSessionImage(sessionId, imageBase64) {
  await supabase
    .from("edit_sessions")
    .update({ last_image_b64: imageBase64?.slice(0, 100000), updated_at: new Date().toISOString() }) // truncate to save space
    .eq("session_id", sessionId);
}

/**
 * Max active faces per user — caps storage usage from abusive bulk-saving.
 * Active = status != 'deleted'. With 1.5MB per face (compressed on client),
 * 50 × ~2MB base64 ≈ 100MB worst case per user.
 */
const MAX_FACES_PER_USER = 50;

/**
 * Save a face for reuse across sessions. Caps at MAX_FACES_PER_USER active.
 */
export async function saveFace(telegramId, name, faceImageB64, description = "") {
  // Count existing active faces (status != 'deleted')
  const { count, error: countErr } = await supabase
    .from("saved_faces")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .neq("status", "deleted");

  if (countErr) {
    // Column may not exist pre-migration — fall back to a bounded count without the filter
    const { count: countFallback } = await supabase
      .from("saved_faces")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", telegramId);
    if ((countFallback || 0) >= MAX_FACES_PER_USER) {
      const err = new Error(`Достигнут лимит: ${MAX_FACES_PER_USER} лиц`);
      err.code = "FACE_LIMIT";
      throw err;
    }
  } else if ((count || 0) >= MAX_FACES_PER_USER) {
    const err = new Error(`Достигнут лимит: ${MAX_FACES_PER_USER} лиц`);
    err.code = "FACE_LIMIT";
    throw err;
  }

  const { data, error } = await supabase
    .from("saved_faces")
    .insert({
      telegram_id: telegramId,
      name,
      face_image_b64: faceImageB64,
      face_description: description,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all saved faces for a user (excluding soft-deleted).
 * Filter is tolerant to pre-migration rows where `status` column/value is missing.
 */
export async function getSavedFaces(telegramId) {
  const { data } = await supabase
    .from("saved_faces")
    .select("id, name, face_description, created_at, status")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false });

  return (data || []).filter(f => f.status !== "deleted");
}

/**
 * Get face image by ID (excluding soft-deleted).
 */
export async function getFaceImage(faceId, telegramId) {
  const { data } = await supabase
    .from("saved_faces")
    .select("face_image_b64, name, face_description, status")
    .eq("id", faceId)
    .eq("telegram_id", telegramId)
    .single();

  if (!data || data.status === "deleted") return null;
  return data;
}

/**
 * Soft-delete a saved face (CLAUDE.md rule #4 — never hard-delete user data).
 * Sets status = 'deleted' so the row remains auditable but hidden.
 */
export async function deleteFace(faceId, telegramId) {
  await supabase
    .from("saved_faces")
    .update({ status: "deleted" })
    .eq("id", faceId)
    .eq("telegram_id", telegramId);
}

/**
 * Build multi-turn messages array for Gemini.
 * Includes conversation history + face reference if enabled.
 */
export function buildMultiTurnMessages(session, currentPrompt, currentImages = [], faceData = null) {
  const messages = [];

  // Add face reference as first message if enabled
  if (faceData?.face_image_b64) {
    messages.push({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${faceData.face_image_b64}` },
        },
        {
          type: "text",
          text: `This is the reference face. Remember this person's identity: ${faceData.face_description || faceData.name || "main character"}. All subsequent images must preserve this exact face, expression style, and features.`,
        },
      ],
    });
    messages.push({
      role: "assistant",
      content: "I've memorized this face. I will preserve this person's identity in all subsequent generations.",
    });
  }

  // Add conversation history (text only, images are too heavy)
  const history = session.messages || [];
  for (const msg of history.slice(-6)) { // last 6 messages
    messages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    });
  }

  // Add current request
  const currentContent = [];
  for (const img of currentImages) {
    currentContent.push({
      type: "image_url",
      image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
    });
  }
  currentContent.push({
    type: "text",
    text: currentPrompt + (faceData ? ". Preserve the reference face identity exactly." : ""),
  });

  messages.push({ role: "user", content: currentContent });

  return messages;
}
