import { initRouter, registerScreen, setNavigateListener } from "./router.js";
import { renderNav, setActiveNav } from "./components/nav.js";
import { initTelegram, getStartParam } from "./services/telegram.js";
import { isLiveBackendConfigured } from "./services/config.js";
import * as api from "./services/api.js";

import * as home from "./screens/home.js";
import * as roadmap from "./screens/roadmap.js";
import * as documents from "./screens/documents.js";
import * as payments from "./screens/payments.js";
import * as profile from "./screens/profile.js";
import * as statusDetail from "./screens/statusDetail.js";
import * as celebration from "./screens/celebration.js";
import * as events from "./screens/events.js";

initTelegram();

/**
 * МОНИТОРИНГ ОШИБОК НА ЭКРАНЕ (23.09.2026). Любая необработанная ошибка
 * JavaScript или отклонённый промис уходит на бэкенд (clientError), а
 * оттуда — владельцу в Telegram. Одна и та же ошибка за сеанс шлётся один
 * раз; сетевые сбои (OFFLINE/TIMEOUT) не шлём — это не баг приложения, и
 * отправить их всё равно не выйдет. Только в живом режиме.
 */
const reportedErrors_ = new Set();
function reportClientError_(err, kind) {
  try {
    if (!isLiveBackendConfigured()) return;
    const message = String((err && err.message) || err || "").slice(0, 300);
    if (!message || /^(OFFLINE|TIMEOUT|BACKEND_HTML)$/.test(message)) return;
    const key = kind + ":" + message;
    if (reportedErrors_.has(key) || reportedErrors_.size > 5) return;
    reportedErrors_.add(key);
    api.reportClientError({
      message: kind + ": " + message,
      stack: String((err && err.stack) || "").slice(0, 400),
      screen: (window.location.hash || "#home").slice(1, 40),
      url: window.location.pathname,
      ua: navigator.userAgent,
    }).catch(() => {});
  } catch (ignore) { /* мониторинг не должен ронять приложение */ }
}
window.__reportScreenError = reportClientError_;
window.addEventListener("error", (e) => reportClientError_(e.error || e.message, "error"));
window.addEventListener("unhandledrejection", (e) => reportClientError_(e.reason, "promise"));

registerScreen("home", home.render);
registerScreen("roadmap", roadmap.render);
registerScreen("documents", documents.render);
registerScreen("payments", payments.render);
registerScreen("profile", profile.render);
registerScreen("status", statusDetail.render);
registerScreen("celebration", celebration.render);
// Deep link: t.me/bot/app?startapp=event_<groupId> -> #event/<groupId> (see
// handleStartParam below). The screen itself always lists ALL of this
// student's invitations — the groupId param isn't used to filter, only to
// scroll to and briefly highlight that one card (see events.js render()).
registerScreen("event", events.render);

const navEl = document.getElementById("bottom-nav");
const contentEl = document.getElementById("screen-root");

renderNav(navEl);
setNavigateListener((screenName) => setActiveNav(navEl, screenName));

/**
 * ЧТО ВИДИТ ЧЕЛОВЕК, КОГДА ССЫЛКА НЕ СРАБОТАЛА (14.09.2026).
 *
 * Прогнал все исходы привязки на стенде. Было две беды.
 *
 * Первая: из пяти возможных ошибок разбиралась одна («ссылка уже
 * использована»), остальные четыре получали общий текст «Попробуйте открыть
 * ссылку ещё раз». Для просроченной ссылки этот совет бесполезен — она
 * мертва навсегда, нужна новая. А для случая «сделка уже привязана к другому
 * Telegram» бэкенд (consumeLinkToken в Auth.gs) присылает готовое понятное
 * объяснение по-русски — и мы его выбрасывали.
 *
 * Вторая, хуже: после показа ошибки управление через четыре секунды уходило
 * роутеру, тот запрашивал состояние, получал NOT_INVITED и рисовал поверх
 * ВТОРОЙ экран — «Доступ по приглашению. Координатор пришлёт вам ссылку».
 * Человек с неработающей ссылкой в руках читал два разных объяснения подряд,
 * причём второе стирало первое и прямо противоречило происходящему.
 *
 * Теперь: одна причина — один экран, и он остаётся на месте. Если проблема
 * в связи, а не в ссылке, даём кнопку повторить.
 */
async function показатьОшибкуПривязки_(err, token) {
  const код = String((err && err.message) || "");
  const связь = код === "OFFLINE" || код === "TIMEOUT" || код === "BACKEND_HTML";

  let заголовок = "Не получилось подключить профиль";
  let текст;
  if (связь) {
    заголовок = код === "TIMEOUT" ? "Сервер долго не отвечает" : "Нет связи";
    текст = "Ссылка в порядке — не удалось достучаться до сервера. Проверьте интернет и нажмите «Попробовать ещё раз».";
  } else if (код.indexOf("already used") !== -1) {
    текст = "Эта ссылка уже была использована. Если приложение не показывает ваши данные, попросите координатора прислать новую.";
  } else if (код.indexOf("expired") !== -1) {
    текст = "Срок действия ссылки истёк — она живёт трое суток. Напишите координатору, он пришлёт новую.";
  } else if (код.indexOf("Unknown linking token") !== -1) {
    текст = "Ссылка не распознана. Скорее всего, она скопировалась не целиком — откройте её прямо из сообщения координатора или попросите прислать заново.";
  } else if (/[А-Яа-я]/.test(код)) {
    // Бэкенд прислал объяснение на русском (например «Эта сделка уже
    // привязана к другому аккаунту Telegram») — оно точнее любого нашего.
    текст = код;
  } else {
    текст = "Попробуйте открыть ссылку ещё раз или напишите координатору.";
  }

  contentEl.innerHTML =
    '<div class="card"><h2>' + заголовок + "</h2>" +
    '<div class="sub">' + текст + "</div>" +
    (связь ? '<button class="btn btn-primary" id="link-retry" style="margin-top:14px">Попробовать ещё раз</button>' : "") +
    "</div>";

  const повтор = contentEl.querySelector("#link-retry");
  if (повтор) {
    повтор.addEventListener("click", async () => {
      повтор.disabled = true;
      повтор.textContent = "Подключаем…";
      try {
        await api.linkAccount(token);
        initRouter(contentEl);
        подставитьСезонВШапку();
      } catch (e2) {
        console.error("[app] retry linking failed:", e2);
        await показатьОшибкуПривязки_(e2, token);
      }
    });
  }
}

// Deep link support (ТЗ §58/§78): either a one-time account-linking token
// (?startapp=link_<token>) or a direct jump to a screen (?startapp=status_PLACEMENT_COMPLETED).
async function handleStartParam() {
  const startParam = getStartParam();
  if (!startParam) return;

  if (startParam.type === "link" && startParam.rest) {
    // ПОКАЗЫВАЕМ, ЧТО ИДЁТ ПРИВЯЗКА (02.09.2026).
    //
    // Раньше здесь просто ждали ответа сервера, а роутер (вместе с
    // единственным спиннером) стартовал только после. Контейнер экрана в это
    // время пуст, поэтому студент видел БЕЛУЮ СТРАНИЦУ всё время запроса — а
    // на Apps Script это 1–10 секунд. И это его самое первое открытие
    // приложения, по ссылке от координатора: ровно тот момент, где часть
    // людей просто закрывает и не возвращается.
    //
    // Плюс ошибка привязки уходила только в консоль: человек молча попадал в
    // пустой непривязанный аккаунт («Оформились», 5 %, пустые документы) и не
    // понимал, почему приложение не знает, кто он.
    if (contentEl) {
      contentEl.innerHTML =
        '<div class="card"><h2>Подключаем ваш профиль</h2>' +
        '<div class="sub">Это займёт несколько секунд.</div></div>';
    }
    try {
      await api.linkAccount(startParam.rest);
    } catch (err) {
      console.error("[app] account linking failed:", err);
      if (contentEl) {
        await показатьОшибкуПривязки_(err, startParam.rest);
        return "стоп"; // роутер не запускаем — см. комментарий в функции
      }
    }
    return;
  }

  // NOTE: we intentionally do NOT check "!window.location.hash" here.
  // Inside real Telegram clients the page loads with Telegram's own launch
  // data already in the hash (e.g. "#tgWebAppData=...&tgWebAppVersion=..."),
  // so that check was always false there — it silently broke every deep
  // link (both event_ and status_) the moment this was opened for real
  // from a Telegram message, even though it worked fine in a plain browser
  // tab where the hash starts empty. Always override with our own route.
  if (startParam.type && startParam.rest) {
    window.location.hash = `${startParam.type}/${startParam.rest}`;
  }
}

// handleStartParam возвращает "стоп", когда показала экран неудачной
// привязки: в этом случае роутер запускать НЕЛЬЗЯ — он тут же запросит
// состояние, получит NOT_INVITED и нарисует поверх второе, противоречащее
// объяснение (см. комментарий у показатьОшибкуПривязки_). Во всех остальных
// случаях, включая любую неожиданную ошибку, приложение стартует как раньше.
handleStartParam().then(
  (результат) => {
    if (результат === "стоп") return;
    initRouter(contentEl);
    подставитьСезонВШапку();
  },
  (err) => {
    console.error("[app] handleStartParam упала:", err);
    initRouter(contentEl);
    подставитьСезонВШапку();
  }
);

// СЕЗОН В ШАПКЕ ИЗ ДАННЫХ (03.09.2026). В index.html плашка была
// захардкожена как «SELF 2027» — участник следующего сезона видел бы чужой
// год на каждом экране. Запрос состояния здесь бесплатный: getState()
// кеширует ответ и склеивает параллельные вызовы, так что это тот же самый
// запрос, который делает первый экран.
//
// Намеренно fire-and-forget и с полным подавлением ошибок: шапка не должна
// ни задерживать отрисовку, ни ломаться, когда состояние недоступно —
// например у неприглашённого пользователя (NOT_INVITED) или офлайн. В этих
// случаях в плашке просто остаётся текст из разметки.
async function подставитьСезонВШапку() {
  const плашка = document.getElementById("brand-season");
  if (!плашка) return;
  try {
    const { participant } = await api.getMe();
    const program = (participant && participant.program) || "";
    const season = (participant && participant.season) || "";
    // ГОД БЕЗ ИСТОЧНИКА (14.09.2026). Условие было `program && season`, то
    // есть при пустом сезоне плашка оставалась такой, как написана в разметке
    // — «SELF 2027». По живым данным season пуст у ВСЕХ подключённых
    // участников (поле FIELD_ID_SEASON не приезжает из сделки), так что
    // захардкоженный 2027 показывался каждому, включая тех, у кого сезон
    // другой. Это ровно тот случай, который правка 03.09.2026 и должна была
    // закрыть, но не закрыла: без данных разметка проступала обратно.
    // Теперь без сезона показываем только программу — год не выдумываем.
    if (program) плашка.textContent = season ? `${program} ${season}` : program;
  } catch (err) {
    // намеренно тихо — см. комментарий выше
  }
}

// The demo stage-switcher only makes sense on mock data — once a live
// amoCRM-backed backend is configured, currentStageId is real and this
// panel is never mounted.
//
// ДИНАМИЧЕСКИЙ ИМПОРТ (14.09.2026). Раньше demoPanel.js импортировался
// сверху файла, то есть скачивался и разбирался при КАЖДОМ открытии — в
// том числе у студентов, которым панель не показывается никогда. Теперь
// файл запрашивается только внутри этой ветки, и в боевом режиме браузер
// о нём даже не узнаёт.
if (!isLiveBackendConfigured()) {
  import("./components/demoPanel.js").then((m) => m.mountDemoPanel());
}
