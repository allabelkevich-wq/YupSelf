/**
 * Watermark downloaded images with a subtle YupSelf brand mark.
 *
 * Why: when a user shares a generated image in a chat / social network,
 * the watermark turns that share into free brand exposure.
 *
 * Design:
 *  - SVG overlay composited in the bottom-right corner
 *  - ~4% of the shorter image side (scales with size)
 *  - Semi-transparent white with soft shadow — visible but unobtrusive
 *  - No PII, no QR codes, just "✨ YupSelf  @YupSelf_bot"
 *
 * Graceful: if sharp is missing (dev environment without native build) or
 * the input isn't a valid image, the original buffer is returned untouched.
 * This is intentional — NEVER block a paid download because the brand
 * watermarker crashed.
 */

let _sharpP = null;
async function getSharp() {
  if (_sharpP) return _sharpP;
  _sharpP = import("sharp")
    .then((m) => m.default || m)
    .catch((err) => {
      console.warn("[watermark] sharp not available:", err?.message);
      return null;
    });
  return _sharpP;
}

function buildSvg(width, height) {
  // Mark height = ~4% of the shorter side, clamped to a sensible range
  const shortSide = Math.min(width, height);
  const mh = Math.max(22, Math.min(64, Math.round(shortSide * 0.04)));
  const fontSize = Math.round(mh * 0.5);
  const paddingX = Math.round(mh * 0.55);
  const text = "✨ YupSelf · @YupSelf_bot";
  // Rough width estimate (monospace-ish ~0.55em per char)
  const estWidth = Math.round(fontSize * 0.58 * text.length + paddingX * 2);
  const mw = Math.min(width - 2 * mh, estWidth);

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${mw}" height="${mh}" viewBox="0 0 ${mw} ${mh}">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
      <feOffset dx="0" dy="1" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="${mw}" height="${mh}" rx="${mh / 2}" ry="${mh / 2}"
        fill="rgba(0,0,0,0.35)"/>
  <text x="${mw / 2}" y="${mh / 2}" dominant-baseline="middle" text-anchor="middle"
        filter="url(#shadow)"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        font-size="${fontSize}" font-weight="700" fill="rgba(255,255,255,0.95)"
        letter-spacing="0.5">${text}</text>
</svg>`);
}

/**
 * Apply watermark to a PNG/JPEG/WebP buffer.
 * @param {Buffer} buf
 * @returns {Promise<Buffer>} watermarked PNG buffer, or the original on failure.
 */
export async function applyWatermark(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return buf;
  try {
    const sharp = await getSharp();
    if (!sharp) return buf;

    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return buf;

    // Skip watermark on tiny images (thumbnails, icons) — ugly and useless
    if (Math.min(meta.width, meta.height) < 256) return buf;

    const svg = buildSvg(meta.width, meta.height);
    return await img
      .composite([{ input: svg, gravity: "southeast", blend: "over" }])
      // Re-encode as PNG to keep quality consistent across upstream formats
      .png({ compressionLevel: 6 })
      .toBuffer();
  } catch (err) {
    console.warn("[watermark] failed, returning original:", err?.message);
    return buf;
  }
}
