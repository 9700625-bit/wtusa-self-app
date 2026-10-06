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

/**
 * РАЗРЕШЕНИЕ БОТУ ПИСАТЬ СТУДЕНТУ (05.10.2026).
 *
 * Студент попадает в приложение по ссылке из WhatsApp и может ни разу не
 * нажать «Старт» в чате с ботом. Тогда Telegram отвечает боту «chat not
 * found», и до человека не доходит НИЧЕГО: ни напоминания об оплате, ни
 * «Платёж получен», ни приглашение на брифинг. 05.10 так не дошло 7
 * сообщений из 67.
 *
 * У Telegram для этого есть штатное окно «Разрешить боту присылать вам
 * сообщения» (requestWriteAccess, Bot API 6.9+). Показываем его только тем, у
 * кого разрешения нет (user.allows_write_to_pm), и не чаще раза в сутки, если
 * человек отказался. Любая ошибка здесь глотается: окно — удобство, оно не
 * должно ронять приложение на старых клиентах.
 */
const WRITE_ACCESS_KEY_ = "wtusa_write_access_v1";
export function requestWriteAccessIfNeeded() {
  try {
    const app = tg();
    if (!app || typeof app.requestWriteAccess !== "function") return;
    if (typeof app.isVersionAtLeast === "function" && !app.isVersionAtLeast("6.9")) return;
    const user = app.initDataUnsafe && app.initDataUnsafe.user;
    if (!user || user.allows_write_to_pm) return;
    // Ключ — на аккаунт: на одном телефоне бывает два аккаунта Telegram, а память браузера у
    // них общая. С общим ключом ответ первого («ok») навсегда отменял вопрос для второго.
    const key = WRITE_ACCESS_KEY_ + "_" + user.id;
    let saved = "";
    try { saved = window.localStorage.getItem(key) || ""; } catch { /* хранилище недоступно */ }
    if (saved === "ok") return;
    if (saved && Date.now() - Number(saved) < 24 * 60 * 60 * 1000) return;
    try { window.localStorage.setItem(key, String(Date.now())); } catch { /* хранилище недоступно */ }
    app.requestWriteAccess((allowed) => {
      if (!allowed) return;
      try { window.localStorage.setItem(key, "ok"); } catch { /* хранилище недоступно */ }
    });
  } catch (err) {
    console.warn("[telegram] requestWriteAccess недоступен:", err);
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
 * underscores (stage ids like JOB_OFFER_SUBMITTED_CIEE) or hyphens (a linking
 * token/UUID) safely.
 *   "status_JOB_OFFER_SUBMITTED_CIEE"     -> {type:"status", rest:"JOB_OFFER_SUBMITTED_CIEE"}
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

/**
 * ЕДИНОЕ ОКНО СООБЩЕНИЙ (02.09.2026).
 *
 * В приложении было два способа сообщить что-то человеку: штатный
 * Telegram.WebApp.showAlert (правильный — окно выглядит частью Telegram) и
 * голый window.alert в events.js (чужеродное системное окно браузера). Плюс
 * места, где сообщать было нечем, и кнопка просто молчала.
 *
 * Здесь один вход для всех: пробуем окно Telegram, а если приложение открыли
 * в обычном браузере (SDK нет) — откатываемся на window.alert.
 */
export function showAlert(message) {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && typeof tg.showAlert === "function") {
    try {
      tg.showAlert(String(message));
      return;
    } catch (err) {
      console.warn("[telegram] showAlert недоступен, откатываюсь на alert:", err);
    }
  }
  window.alert(String(message));
}
