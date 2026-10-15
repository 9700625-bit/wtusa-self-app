/**
 * Thin wrapper around window.Telegram.WebApp so the rest of the app never
 * touches the global directly and keeps working (no-ops) when opened in a
 * plain desktop browser during development.
 */

function tg() {
  return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

/**
 * Волна 5 (аудит 14.10.2026, B-10): SDK С telegram.org БОЛЬШЕ НЕ ДЕРЖИТ ПЕРВЫЙ ЭКРАН.
 * Что ломалось: SDK стоял с defer, а отложенные скрипты и модули выполняются строго по
 * порядку — пока telegram.org не ответил, не запускалось ничего: при SDK 2 с даже экран из
 * памяти телефона появлялся через 2 с, при зависшем SDK страница оставалась пустой.
 * Теперь SDK подключён async (index.html), а приложение:
 *  • сразу читает данные запуска из адреса (#tgWebAppData=…, их кладёт туда сам Telegram,
 *    так же их читает и SDK) — по ним известно, ЧЕЙ это запуск, и экран из памяти телефона
 *    рисуется без ожидания SDK. Чужое не покажем: ключ копии — id из этого запуска;
 *  • запросы к серверу ждут SDK (telegramReady), но не дольше ЖДАТЬ_SDK_МС; не дождались —
 *    берут те же данные запуска из адреса (сервер проверяет подпись одинаково), а если их нет —
 *    экран с понятной ошибкой (TG_SDK_FAILED / NOT_IN_TELEGRAM, см. router.js).
 */
const ЖДАТЬ_SDK_МС = 6000;
const SDK_SRC_ = "https://telegram.org/js/telegram-web-app.js";
const КЛЮЧ_ЗАПУСКА_SDK_ = "__telegram__initParams"; // так SDK сам хранит данные запуска в sessionStorage

function разобратьЗапуск_() {
  try {
    let параметры = null;
    const h = String(window.location.hash || "").replace(/^#/, "");
    if (h.indexOf("tgWebAppData=") !== -1) {
      параметры = {};
      new URLSearchParams(h).forEach((v, k) => { параметры[k] = v; });
      // Модули и SDK теперь выполняются в любом порядке: если приложение сменит адрес
      // (ссылка status_…, нажатие студента) раньше, чем SDK его прочитает, SDK возьмёт данные
      // запуска из sessionStorage — кладём их туда сами, ровно как сделал бы он.
      if (!tg()) {
        try { window.sessionStorage.setItem(КЛЮЧ_ЗАПУСКА_SDK_, JSON.stringify(параметры)); } catch (e) { /* хранилище недоступно */ }
      }
    } else {
      // Перезагрузка («Обновить») после того, как адрес уже сменился на #home: данные запуска
      // этой вкладки лежат там, куда их сохранил SDK.
      try { параметры = JSON.parse(window.sessionStorage.getItem(КЛЮЧ_ЗАПУСКА_SDK_) || "null"); } catch (e) { параметры = null; }
    }
    const initData = параметры && typeof параметры.tgWebAppData === "string" ? параметры.tgWebAppData : "";
    if (!initData) return null;
    const данные = new URLSearchParams(initData);
    let userId = null;
    try { const u = JSON.parse(данные.get("user") || "null"); userId = u && u.id ? String(u.id) : null; } catch (e) { userId = null; }
    if (!userId) return null;
    return { initData, userId, startParam: данные.get("start_param") || параметры.tgWebAppStartParam || null };
  } catch (e) {
    return null;
  }
}
const ранний_ = разобратьЗапуск_();

/** id аккаунта Telegram этого запуска: из SDK, а пока его нет — из данных запуска в адресе. */
export function getTelegramUserId() {
  const app = tg();
  const u = app && app.initDataUnsafe && app.initDataUnsafe.user;
  if (u && u.id) return String(u.id);
  return ранний_ ? ранний_.userId : null;
}

let готовностьОбъявлена_ = false;
function объявитьГотовность_() {
  if (готовностьОбъявлена_ || !tg()) return;
  готовностьОбъявлена_ = true;
  // SDK появился (в том числе позже тайм-аута): app.js вызывает ready/expand, router.js
  // показывает BackButton, liveApi.js сверяет аккаунт с копией в памяти телефона.
  try { window.dispatchEvent(new Event("telegram-ready")); } catch (e) { /* очень старый WebView */ }
}

function следитьЗаТегом_(tag) {
  if (!tag || tag.__следим) return;
  tag.__следим = true;
  tag.addEventListener("load", () => { window.__sdkState = "load"; объявитьГотовность_(); });
  tag.addEventListener("error", () => { window.__sdkState = "error"; });
}
// Тег из index.html: за ним следим с самого начала, чтобы поздний SDK тоже был замечен.
try { следитьЗаТегом_(document.querySelector('script[src^="' + SDK_SRC_ + '"]')); } catch (e) { /* нет DOM */ }

let ожиданиеSdk_ = null;
// Один раз не дождались — следующие запросы этого захода не ждут ещё по 6 с каждый (экран ошибки
// появляется сразу). Снова ждём после «Попробовать ещё раз» (событие app-retry из router.js).
let неДождались_ = false;
window.addEventListener("app-retry", () => { неДождались_ = false; });
/**
 * Ждёт SDK Telegram не дольше ЖДАТЬ_SDK_МС. true — window.Telegram.WebApp есть.
 * Если SDK не скачался (ошибка сети), первый вызов (и первый после «Попробовать ещё раз»)
 * пробует скачать его ещё раз.
 */
export function telegramReady() {
  if (tg()) { объявитьГотовность_(); return Promise.resolve(true); }
  if (ожиданиеSdk_) return ожиданиеSdk_;
  let завершено = false;
  let промис = null;
  промис = new Promise((resolve) => {
    let таймер = null;
    let тег = null;
    const готово = (неудача) => {
      if (завершено) return;
      завершено = true;
      clearTimeout(таймер);
      window.removeEventListener("telegram-ready", готово);
      if (тег) тег.removeEventListener("error", ошибка);
      if (ожиданиеSdk_ === промис) ожиданиеSdk_ = null;
      if (неудача === true && !tg()) неДождались_ = true;
      resolve(!!tg());
    };
    const ошибка = () => готово(true);
    тег = document.querySelector('script[src^="' + SDK_SRC_ + '"]');
    // Скачан, но Telegram не создал / тега нет / уже не дождались в этот заход — не ждём.
    if (window.__sdkState === "load" || !тег || неДождались_) { готово(); return; }
    if (window.__sdkState === "error") {
      // Попытка оборвалась (нет сети) — ещё одна, новым тегом.
      тег = document.createElement("script");
      тег.src = SDK_SRC_;
      тег.async = true;
      window.__sdkState = "";
      следитьЗаТегом_(тег);
      document.head.appendChild(тег);
    }
    window.addEventListener("telegram-ready", готово);
    тег.addEventListener("error", ошибка);
    таймер = setTimeout(ошибка, ЖДАТЬ_SDK_МС);
  });
  if (!завершено) ожиданиеSdk_ = промис;
  return промис;
}

// Волна 5 (B-10): вызывается, когда SDK появился (может быть и после первого экрана) — ровно один раз.
let инициализирован_ = false;
export function initTelegram() {
  const app = tg();
  if (!app || инициализирован_) return;
  инициализирован_ = true;
  // Ревью В-3: обычно ready() уже вызван обработчиком onload у тега SDK (index.html) — второй раз не зовём.
  if (!window.__tgReadyCalled) { window.__tgReadyCalled = true; app.ready(); }
  app.expand();
  // Волна 5 (аудит 14.10.2026, B-68): цвета — по отдельности. Раньше оба вызова стояли в одном
  // try: на клиентах 6.1–6.8 setHeaderColor с hex бросает исключение, и фон уже не ставился.
  // Hex в шапке понимают только клиенты 6.9+; на старых шапку оставляем как есть (тему не трогаем).
  const неНиже = (v) => typeof app.isVersionAtLeast === "function" && app.isVersionAtLeast(v);
  try {
    if (неНиже("6.9")) app.setHeaderColor("#0f2344");
  } catch {
    // старый клиент — шапка по умолчанию
  }
  try {
    app.setBackgroundColor("#f5f7fb");
  } catch {
    // older clients may not support these — safe to ignore
  }
  // Волна 5 (аудит 14.10.2026, B-67): на iOS/Android (Bot API 7.7+) свайп вниз в начале длинного
  // экрана («Путь», календарь) сворачивал приложение. Закрыть его по-прежнему можно кнопкой и
  // жестом за шапку. На старых клиентах метода нет — не вызываем.
  try {
    if (неНиже("7.7") && typeof app.disableVerticalSwipes === "function") app.disableVerticalSwipes();
  } catch {
    // не поддерживается — не страшно
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
// P13 (12.10.2026): onAllowed — вызывается, когда студент нажал «Разрешить»;
// приложение сообщает об этом бэкенду, и тот сразу дошлёт недоставленные приглашения.
export function requestWriteAccessIfNeeded(onAllowed) {
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
      if (typeof onAllowed === "function") {
        try { onAllowed(); } catch { /* сообщение бэкенду — необязательно */ }
      }
    });
  } catch (err) {
    console.warn("[telegram] requestWriteAccess недоступен:", err);
  }
}

/** Raw initData string the backend must validate (see backend-apps-script/Auth.gs).
 * Empty string outside Telegram — callers should treat that as "not authenticated". */
export function getInitData() {
  const app = tg();
  if (app && app.initData) return app.initData;
  // Волна 5 (B-10): SDK не успел/не смог — те же данные запуска из адреса (подпись проверяет сервер).
  return ранний_ ? ранний_.initData : "";
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
  // Волна 5 (B-10): до прихода SDK — из данных запуска в адресе (это то же подписанное поле).
  const startParam = (app && app.initDataUnsafe && app.initDataUnsafe.start_param) || (ранний_ ? ранний_.startParam : null);
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
// Волна 5 (аудит 14.10.2026, B-66): ОЧЕРЕДЬ СООБЩЕНИЙ. Что ломалось: если окно Telegram уже
// открыто (предыдущее сообщение, вопрос «Точно отказаться?»), SDK бросает WebAppPopupOpened, и
// второе сообщение уходило в системный window.alert — чужое окно браузера. Теперь сообщение ждёт
// своей очереди: показываем следующее, когда закрылось предыдущее (или освободилось чужое окно).
// window.alert остаётся только для клиентов без окон Telegram (вне Telegram, версия 6.0).
const очередьСообщений_ = [];
let повторОкна_ = null;
let ждёмОкно_ = 0;
function показатьСледующее_() {
  if (повторОкна_) { clearTimeout(повторОкна_); повторОкна_ = null; }
  if (!очередьСообщений_.length) return;
  const app = tg();
  const текст = очередьСообщений_[0];
  if (app && typeof app.showAlert === "function") {
    try {
      // Закрыли окно — сразу следующее. На колбэк не полагаемся целиком (не все клиенты его
      // зовут): пока окно открыто, SDK сам отвечает WebAppPopupOpened, и мы ждём.
      app.showAlert(текст, () => показатьСледующее_());
      очередьСообщений_.shift();
      ждёмОкно_ = 0;
      if (очередьСообщений_.length) повторОкна_ = setTimeout(показатьСледующее_, 1500);
      return;
    } catch (err) {
      // Открыто окно (наше прошлое сообщение, вопрос, разрешение) — ждём, пока закроют (до ~2 мин).
      if (/PopupOpened/i.test(String((err && err.message) || err)) && ждёмОкно_ < 240) {
        ждёмОкно_++;
        повторОкна_ = setTimeout(показатьСледующее_, 500);
        return;
      }
      console.warn("[telegram] showAlert недоступен, откатываюсь на alert:", err);
    }
  }
  ждёмОкно_ = 0;
  очередьСообщений_.shift();
  window.alert(текст);
  показатьСледующее_();
}

export function showAlert(message) {
  очередьСообщений_.push(String(message));
  показатьСледующее_();
}
