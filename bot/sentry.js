/**
 * Sentry initialisation — single entry point. Import this FIRST in bot/index.js
 * so it wraps async stack traces from the start.
 *
 * If SENTRY_DSN is not set, init is a no-op and captureException / captureMessage
 * silently do nothing — safe to use unconditionally in production code.
 */
import "dotenv/config";
import * as Sentry from "@sentry/node";

const DSN = process.env.SENTRY_DSN;
const ENV = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production";
const RELEASE = process.env.RENDER_GIT_COMMIT || process.env.SENTRY_RELEASE || undefined;

let _inited = false;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    // Keep traces low-volume to stay within free tier; raise when needed.
    tracesSampleRate: 0.1,
    // Don't send PII (user.first_name, birthdate etc.) automatically.
    sendDefaultPii: false,
    // Ignore pedestrian errors that would just spam the feed.
    ignoreErrors: [
      "AbortError", // upstream fetch timeouts we already handle + retry
      "Unauthorized", // bad initData from spam traffic
    ],
  });
  _inited = true;
  console.log(`[sentry] initialised env=${ENV}${RELEASE ? " release=" + RELEASE.slice(0, 7) : ""}`);
} else {
  console.log("[sentry] SENTRY_DSN not set — Sentry disabled");
}

/**
 * Capture an exception. Safe to call when Sentry is disabled.
 * @param {Error|unknown} err
 * @param {object} [ctx] optional tags / extras (e.g. { tag: "payments", jobId, userId })
 */
export function captureException(err, ctx = {}) {
  if (!_inited) return;
  try {
    Sentry.withScope((scope) => {
      if (ctx.userId != null) scope.setUser({ id: String(ctx.userId) });
      if (ctx.tag) scope.setTag("area", ctx.tag);
      for (const [k, v] of Object.entries(ctx)) {
        if (k !== "userId" && k !== "tag") scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  } catch {}
}

/** Capture a free-form message (e.g. unexpected state). */
export function captureMessage(msg, ctx = {}) {
  if (!_inited) return;
  try {
    Sentry.withScope((scope) => {
      if (ctx.userId != null) scope.setUser({ id: String(ctx.userId) });
      if (ctx.tag) scope.setTag("area", ctx.tag);
      for (const [k, v] of Object.entries(ctx)) {
        if (k !== "userId" && k !== "tag") scope.setExtra(k, v);
      }
      Sentry.captureMessage(msg, ctx.level || "warning");
    });
  } catch {}
}

export const isEnabled = () => _inited;
export default Sentry;
