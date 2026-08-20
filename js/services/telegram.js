/**
 * Thin wrapper around window.Telegram.WebApp so the rest of the app never
 * touches the global directly and keeps working (no-ops) when opened in a
 * plain desktop browser during development.
 */

function tg() {
  return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

export function initTelegram() {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
  try {
    app.setHeaderColor("#0f2344");
    app.setBackgroundColor("#f5f7fb");
  } catch {
    // older clients may not support these — safe to ignore
  }
}

export function hapticImpact(style = "light") {
  const app = tg();
  if (app && app.HapticFeedback) app.HapticFeedback.impactOccurred(style);
}

export function hapticNotification(type = "success") {
  const app = tg();
  if (app && app.HapticFeedback) app.HapticFeedback.notificationOccurred(type);
}

/** Opens an external link via Telegram's native handler when available. */
export function openExternalLink(url) {
  const app = tg();
  if (app && app.openLink) {
    app.openLink(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export function openTelegramLink(url) {
  const app = tg();
  if (app && app.openTelegramLink) {
    app.openTelegramLink(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Raw initData string the backend must validate (see backend-apps-script/Auth.gs).
 * Empty string outside Telegram — callers should treat that as "not authenticated". */
export function getInitData() {
  const app = tg();
  return app && app.initData ? app.initData : "";
}

/**
 * Parses `?startapp=<param>` (ТЗ §58/§78). Convention: "<type>_<rest>",
 * split only on the FIRST underscore so `rest` can itself contain
 * underscores (stage ids like STUDENT_SIGNATURE) or hyphens (a linking
 * token/UUID) safely.
 *   "status_STUDENT_SIGNATURE"        -> {type:"status", rest:"STUDENT_SIGNATURE"}
 *   "link_a1b2c3d4-....-...."          -> {type:"link", rest:"a1b2c3d4-....-...."}
 */
export function getStartParam() {
  const app = tg();
  const startParam = app && app.initDataUnsafe ? app.initDataUnsafe.start_param : null;
  if (!startParam) return null;
  const idx = startParam.indexOf("_");
  if (idx === -1) return { type: startParam, rest: "" };
  return { type: startParam.slice(0, idx), rest: startParam.slice(idx + 1) };
}
