/**
 * Marketing scenario presets — one-click templates for /api/generate.
 *
 * Why this exists: a brand-new user staring at an empty "describe your image"
 * field rarely converts. Scenarios let them click a familiar use-case
 * (avatar / story / flyer / wallpaper) and only fill in the SPECIFIC bit
 * (their topic, their event, their channel name).
 *
 * Server applies the scenario by:
 *   - prepending a prefix that locks composition / aspect / style
 *   - appending a suffix that enforces brand palette + "no text rendering"
 *   - overriding aspectRatio to the scenario's canonical format
 *
 * The user's free-form prompt becomes the SUBJECT/THEME inside the template.
 *
 * needsFace = whether the preset is meaningfully better with a saved face.
 * The frontend uses this to surface the face-selector when the chip is picked.
 *
 * previewUrl = static PNG used as the chip thumbnail in the Mini App.
 * These are generated once per major brand refresh (see sql/preset-previews.md).
 */

const PREVIEW_BASE = "https://uersovccoomwukrdzodd.supabase.co/storage/v1/object/public/images/preset-previews";

export const SCENARIOS = {
  avatar: {
    label: "🌙 Аватарка",
    description: "Портрет для соцсетей",
    aspectRatio: "1:1",
    needsFace: true,
    previewUrl: `${PREVIEW_BASE}/v2-avatar-mopbo7tu.png`,
    placeholder: "Опиши настроение: спокойный портрет с лунным светом, тёплое утро, мягкая магия...",
    promptPrefix: "Premium soft portrait avatar, square 1:1. Subject and mood:",
    promptSuffix:
      ". Pearl-cream and lunar palette, gentle premium spiritual aesthetic, " +
      "centred composition. Preserve identity from reference. PNG output.",
  },
  stories: {
    label: "📱 Сторис",
    description: "Фон для поста 9:16",
    aspectRatio: "9:16",
    needsFace: true,
    previewUrl: `${PREVIEW_BASE}/v2-stories-mopbo7tu.png`,
    placeholder: "О чём пост: тема дня, настроение, время суток...",
    promptPrefix: "Vertical 9:16 social media story banner. Theme:",
    promptSuffix:
      ". Subject positioned in lower third; top third intentionally clean " +
      "with empty space for headline text overlay. Pearl-cream palette, " +
      "premium feminine spiritual brand mood. Don't render any text. PNG output.",
  },
  youtube: {
    label: "🎬 YouTube",
    description: "Обложка ролика 16:9",
    aspectRatio: "16:9",
    needsFace: true,
    previewUrl: `${PREVIEW_BASE}/v2-youtube-mopeq8oq.png`,
    placeholder: "О чём ролик: тема, главный месседж, эмоция...",
    promptPrefix: "Premium horizontal 16:9 YouTube thumbnail. Topic:",
    promptSuffix:
      ". Subject on the right third; left two-thirds intentionally clean " +
      "with empty space for big bold headline text. Magnetic, eye-catching, " +
      "premium spiritual lifestyle brand aesthetic. Don't render any text. PNG output.",
  },
  flyer: {
    label: "🪧 Флаер",
    description: "Анонс события 1:1",
    aspectRatio: "1:1",
    needsFace: false,
    previewUrl: `${PREVIEW_BASE}/v2-flyer-mopeq8oq.png`,
    placeholder: "Что анонсируем: мероприятие, дата, эмоция...",
    promptPrefix: "Premium minimalist event flyer, square 1:1. Theme:",
    promptSuffix:
      ". Top half intentionally clean for title text overlay. Soft " +
      "pearl-cream background, delicate decorative element on the bottom " +
      "(astrological / lunar motif). No people, no faces. Don't render " +
      "any text. PNG output.",
  },
  card: {
    label: "💼 Визитка",
    description: "Контакт-карточка 16:9",
    aspectRatio: "16:9",
    needsFace: false,
    previewUrl: `${PREVIEW_BASE}/v2-card-mopeq8oq.png`,
    placeholder: "Бренд / профессия / стиль (минимализм, тёплый, премиум)...",
    promptPrefix: "Premium minimalist horizontal 16:9 business card. Brand:",
    promptSuffix:
      ". Right third has a small elegant decorative element (gold lunar " +
      "arc with one sparkle). Left two-thirds intentionally clean with " +
      "empty space for name and contact text. Pearl-cream palette, calm " +
      "premium aesthetic. No people, no faces. Don't render any text. PNG output.",
  },
  wallpaper: {
    label: "🌅 Обои",
    description: "Обои телефона 9:16",
    aspectRatio: "9:16",
    needsFace: false,
    previewUrl: `${PREVIEW_BASE}/v2-wallpaper-mopeq8oq.png`,
    placeholder: "Атмосфера: лунное озеро, утренний туман, звёздное небо...",
    promptPrefix: "Vertical 9:16 mobile phone wallpaper. Atmosphere:",
    promptSuffix:
      ". Composition designed to read well behind app icons (calm and " +
      "uncluttered in the central area, decorative interest at top and " +
      "bottom). Pearl-cream and midnight-violet palette, dreamy spiritual " +
      "mood. No people, no faces. PNG output.",
  },
};

/**
 * Apply a scenario to a user prompt.
 * Returns the final prompt + the (possibly overridden) aspectRatio.
 * Unknown / falsy scenarioId is a no-op — the user gets exactly what they typed.
 */
export function applyScenario(scenarioId, userPrompt, defaults = {}) {
  const fallback = {
    prompt: userPrompt,
    aspectRatio: defaults.aspectRatio || "1:1",
    scenario: null,
  };
  if (!scenarioId || scenarioId === "free") return fallback;
  const s = SCENARIOS[scenarioId];
  if (!s) return fallback;
  const subject = String(userPrompt || "").trim() || "the user's chosen idea";
  return {
    prompt: `${s.promptPrefix} ${subject}${s.promptSuffix}`,
    aspectRatio: s.aspectRatio,
    scenario: scenarioId,
  };
}

/** Public list shipped to the Mini App via /api/scenarios. */
export function listScenarios() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({
    id,
    label: s.label,
    description: s.description,
    aspectRatio: s.aspectRatio,
    needsFace: s.needsFace,
    previewUrl: s.previewUrl,
    placeholder: s.placeholder,
  }));
}
