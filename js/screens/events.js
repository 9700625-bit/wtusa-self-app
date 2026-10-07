import * as api from "../services/api.js"; 
import { formatDate, esc } from "../utils/format.js?v=3";
import { goBack } from "../router.js";
import { BRIEFING_ROSTER } from "../config/briefingRoster.config.js";
import { showAlert } from "../services/telegram.js";

/** Технические коды из liveApi превращает в человеческий текст, а осмысленные
 *  сообщения с бэкенда («На это время уже нет мест») показывает как есть. */
function понятнаяОшибка_(err, запасной) {
  const код = String((err && err.message) || "");
  if (код === "OFFLINE") return "Нет связи. Проверьте интернет и попробуйте ещё раз.";
  if (код === "TIMEOUT") return "Сервер долго не отвечает. Попробуйте ещё раз.";
  if (код === "BACKEND_HTML") return "Приложение временно недоступно. Попробуйте через несколько минут.";
  if (/UNAUTHORIZED|initData/.test(код)) return "Сеанс устарел. Закройте приложение и откройте его заново из чата с ботом.";
  if (!код || /[a-z_]{4,}/i.test(код) && !/[а-яё]/i.test(код)) return запасной;
  return код;
}

/**
 * A real Calendly-style booking flow, not just Calendly-looking cards:
 * month calendar -> pick a highlighted date -> pick a time for that date ->
 * a confirm step with the chosen date/time recapped -> a confirmed summary
 * screen with "change time" / "can't come" text links, mirroring exactly
 * how Calendly's own booking page behaves (calendar first, time second,
 * an explicit confirm step before anything is booked, then a management
 * screen instead of the picker once you're booked). One invitation with
 * only a single time skips straight to the confirm step, same as Calendly
 * does when an event type only has one slot left.
 */

const RU_MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const RU_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// Per-invitation UI state (which calendar month is showing, which date/time
// is picked, whether the student re-opened a declined/confirmed invite to
// change their answer). Lives only for as long as this screen is on
// screen -- render() clears it on every fresh fetch, which is fine since a
// fresh fetch only ever happens after a real state change (a confirm/decline
// round trip) that should reset the UI back to its default view anyway.

// РИСОВАННЫЕ ЗНАЧКИ ВМЕСТО ЭМОДЗИ (22.09.2026): 📅 🕐 📍 👥 ✓ — у каждой
// платформы свои картинки (на iPhone 📅 — наклейка «July 17»). Теперь
// одинаковые линейные SVG, цвет — от родителя.
const I = {
  cal: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4"/><circle cx="8.3" cy="14.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.3" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="14.3" r="1" fill="currentColor" stroke="none"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M15.5 14.4c2.6.3 5 2 5 4.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>',
  dash: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
  clockBig: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

const cardState = new Map();

function parseYMD(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d };
}

function groupByDate(slots) {
  const map = {};
  slots
    .slice()
    .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))
    .forEach((s) => {
      (map[s.date] = map[s.date] || []).push(s);
    });
  return map;
}

function availableMonths(slotsByDate) {
  const set = new Map();
  Object.keys(slotsByDate).forEach((dateStr) => {
    const { y, m } = parseYMD(dateStr);
    set.set(y + "-" + m, { y, m });
  });
  return Array.from(set.values()).sort((a, b) => a.y - b.y || a.m - b.m);
}

function buildMonthGrid(y, m) {
  const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0=Mon..6=Sun
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function getState(ev) {
  if (!cardState.has(ev.groupId)) {
    const slotsByDate = groupByDate(ev.slots);
    const dates = Object.keys(slotsByDate);
    const chosen = ev.chosenEventId ? ev.slots.find((s) => s.id === ev.chosenEventId) : null;
    const initialDate = (chosen && chosen.date) || dates[0] || null;
    cardState.set(ev.groupId, {
      view: ev.slots.length > 1 ? "calendar" : "single",
      selectedDate: initialDate,
      selectedSlotId: ev.chosenEventId || (ev.slots.length === 1 ? ev.slots[0].id : null),
      monthCursor: initialDate ? { y: parseYMD(initialDate).y, m: parseYMD(initialDate).m } : { y: 2000, m: 1 },
      overridePicker: false, // set once the student re-opens a confirmed/declined invite to change their answer
    });
  }
  return cardState.get(ev.groupId);
}

/**
 * ПРОШЕДШЕЕ МЕРОПРИЯТИЕ БЕЗ ОТМЕТКИ (22.09.2026).
 *
 * Пока координатор не проставил attended, карточка события с датой месяц
 * назад выглядела как будущее: «Вы записаны», кнопки «Изменить время» и
 * «Не смогу прийти» — на встречу, которая давно прошла. Теперь, если все
 * слоты в прошлом, показываем спокойное «Мероприятие прошло» без кнопок;
 * отметка «Вы посетили» появится, когда координатор её поставит.
 */
function isPastEvent(ev) {
  if (!ev.slots || !ev.slots.length) return false;
  const now = Date.now();
  return ev.slots.every((s) => {
    if (!s.date) return false;
    // +05:00 (06.10.2026): время мероприятия задано по Астане. Без смещения телефон в другом
    // часовом поясе считал встречу прошедшей (или ещё не прошедшей) на несколько часов раньше.
    const end = new Date(s.date + "T" + (s.time || "23:59") + ":00+05:00").getTime();
    // Час запаса: встреча в 17:00 не должна «исчезать» ровно в 17:00.
    return !isNaN(end) && end + 60 * 60 * 1000 < now;
  });
}

/**
 * ПРОШЕДШЕЕ ВРЕМЯ НЕ ПРЕДЛАГАЕМ (05.10.2026). У брифинга два времени: вчера и послезавтра.
 * Студент, который ещё не ответил, открывал приглашение и видел календарь, открытый на ВЧЕРАШНЕЙ
 * дате (первая по порядку), со вчерашним временем в списке — два нажатия, и он «записан» на
 * встречу, которая уже прошла (бэкенд дату не проверяет). Прошедшие слоты из выбора убираем;
 * уже выбранный слот и целиком прошедшее мероприятие не трогаем — их рисуют свои ветки.
 * Запас в час — как в isPastEvent.
 */
function slotPassed_(s) {
  if (!s.date) return false;
  const end = new Date(s.date + "T" + (s.time || "23:59") + ":00+05:00").getTime(); // по Астане, см. isPastEvent
  return !isNaN(end) && end + 60 * 60 * 1000 < Date.now();
}
function withoutPassedSlots_(ev) {
  if (ev.attended !== null || isPastEvent(ev)) return ev;
  const slots = ev.slots.filter((s) => !slotPassed_(s) || s.id === ev.chosenEventId);
  return slots.length === ev.slots.length ? ev : { ...ev, slots };
}

function isSummaryView(ev, state) {
  if (ev.attended !== null) return true;
  if (isPastEvent(ev)) return true;
  if (ev.status === "declined" && !state.overridePicker) return true;
  if (ev.status === "confirmed" && state.view !== "confirm" && !state.overridePicker) return true;
  return false;
}

/**
 * Splits the raw invitation list into the fixed roster (one slot per
 * BRIEFING_ROSTER entry, null where the student has no invitation with that
 * briefingKey yet -- rendered as a dimmed placeholder) and everything else
 * (ad-hoc briefings: no briefingKey, or a key that's since dropped out of
 * the roster config). Matching is by key only, never by title text -- see
 * briefingRoster.config.js and Events.gs (adminCreateEventAndInvite_).
 */
function splitRosterAndExtra_(events) {
  const byKey = new Map(events.filter((e) => e.briefingKey).map((e) => [e.briefingKey, e]));
  const rosterKeys = new Set(BRIEFING_ROSTER.map((r) => r.key));
  const rosterEvents = BRIEFING_ROSTER.map((r) => byKey.get(r.key) || null);
  const extraEvents = events.filter((e) => !e.briefingKey || !rosterKeys.has(e.briefingKey));
  return { rosterEvents, extraEvents };
}

export async function render(container, params = []) {
  const events = (await api.getEvents()).map(withoutPassedSlots_);
  cardState.clear();
  // ВЫБОР СТУДЕНТА ПОСЛЕ ОБРЫВА (07.10.2026). Ответ сервера не пришёл — список перечитан. Если сервер
  // ответ НЕ записал (статус приглашения прежний), возвращаем карточке выбранные день и время:
  // студенту остаётся нажать кнопку ещё раз, а не выбирать всё заново.
  if (выборПослеОбрыва_) {
    const { groupId, status, chosenEventId, state } = выборПослеОбрыва_;
    выборПослеОбрыва_ = null;
    const свежее = events.find((x) => x.groupId === groupId);
    if (свежее && state && свежее.status === status && (свежее.chosenEventId || "") === (chosenEventId || "") &&
        (!state.selectedSlotId || свежее.slots.some((s) => s.id === state.selectedSlotId))) cardState.set(groupId, state);
  }

  if (!events.length && !BRIEFING_ROSTER.length) {
    container.innerHTML = `
      <section class="screen active">
        <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
        <div class="card">
          <h2>Мероприятия</h2>
          <div class="sub">Пока нет приглашений — координатор пришлёт уведомление, когда появится брифинг или встреча.</div>
        </div>
      </section>`;
    container.querySelector("#back-btn").addEventListener("click", goBack);
    return;
  }

  const { rosterEvents, extraEvents } = splitRosterAndExtra_(events);
  const rosterHtml = BRIEFING_ROSTER.map((item, i) => (rosterEvents[i] ? cardWrapperHtml(rosterEvents[i]) : rosterPlaceholderHtml(item))).join("");
  const extraHtml = extraEvents.length
    ? `<h2 style="font-size:16px;margin:18px 0 10px">Дополнительные мероприятия</h2>${extraEvents.map(cardWrapperHtml).join("")}`
    : "";

  container.innerHTML = `
    <section class="screen active">
      <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
      <h1 style="font-size:20px;margin:4px 0 12px">Мероприятия</h1>
            ${attendanceSummaryHtml(rosterEvents, extraEvents)}
      <div id="events-list">${rosterHtml}${extraHtml}</div>
    </section>`;

  container.querySelector("#back-btn").addEventListener("click", goBack);

  // Event delegation on the whole list: every calendar-nav click, date
  // pick, time pick, "change time" / "decline" link etc. re-renders just
  // that one card in place (rerenderCard) without touching the others --
  // no per-card listeners to re-bind after each partial re-render.
  container.querySelector("#events-list").addEventListener("click", (e) => {
    const cardEl = e.target.closest(".evt-card");
    if (!cardEl) return;
    const groupId = cardEl.dataset.group;
    const ev = events.find((x) => x.groupId === groupId);
    if (!ev) return;
    const state = getState(ev);
    const hasChoice = ev.slots.length > 1;

    const dayBtn = e.target.closest(".cal-day.has-slots");
    const prevBtn = e.target.closest("[data-cal-prev]:not(:disabled)");
    const nextBtn = e.target.closest("[data-cal-next]:not(:disabled)");
    const timeBtn = e.target.closest(".evt-slot:not(.full)");
    const backToCalBtn = e.target.closest("[data-back-to-calendar]");
    const changeTimeBtn = e.target.closest("[data-change-time]");
    const reopenBtn = e.target.closest("[data-reopen]");
    const confirmBtn = e.target.closest("[data-do-confirm]");
    const declineBtn = e.target.closest("[data-do-decline]");

    if (dayBtn) {
      state.selectedDate = dayBtn.dataset.date;
      state.selectedSlotId = null;
      rerenderCard(cardEl, ev);
    } else if (prevBtn || nextBtn) {
      let ny = state.monthCursor.y;
      let nm = state.monthCursor.m + (prevBtn ? -1 : 1);
      if (nm === 0) { nm = 12; ny -= 1; }
      if (nm === 13) { nm = 1; ny += 1; }
      state.monthCursor = { y: ny, m: nm };
      state.selectedDate = null;
      state.selectedSlotId = null;
      rerenderCard(cardEl, ev);
    } else if (timeBtn) {
      state.selectedSlotId = timeBtn.dataset.slot;
      state.view = "confirm";
      rerenderCard(cardEl, ev);
    } else if (backToCalBtn) {
      state.view = hasChoice ? "calendar" : "single";
      rerenderCard(cardEl, ev);
    } else if (changeTimeBtn) {
      state.overridePicker = true;
      state.view = hasChoice ? "calendar" : "single";
      rerenderCard(cardEl, ev);
    } else if (reopenBtn) {
      state.overridePicker = true;
      state.view = hasChoice ? "calendar" : "single";
      rerenderCard(cardEl, ev);
    } else if (confirmBtn) {
      doConfirm(container, groupId, state.selectedSlotId, confirmBtn, ev);
    } else if (declineBtn) {
      doDecline(container, groupId, declineBtn, ev);
    }
  });

  // Deep link support: t.me/bot/app?startapp=event_<groupId> lands here as
  // #event/<groupId> (see app.js), with the groupId passed through as
  // params[0]. The screen still always lists every invitation -- that's
  // intentional (see the comment in app.js) -- but with nothing marking
  // which card the student was actually sent about, a coordinator's "check
  // this one" link just dumped them into an undifferentiated list. Scroll to
  // and briefly highlight that one card instead.
  заблокироватьОтветыВПути_(container);

  const targetGroupId = params[0];
  if (targetGroupId) {
    const targetCard = container.querySelector(`.evt-card[data-group="${CSS.escape(targetGroupId)}"]`);
    if (targetCard) {
      // ПРОКРУТКА К КАРТОЧКЕ — ПОСЛЕ РОУТЕРА (05.10.2026). Роутер, показав экран,
      // прокручивает страницу в начало и этим отменял прокрутку к карточке:
      // по ссылке из приглашения студент видел верх списка, а нужная карточка
      // оставалась ниже экрана. Откладываем на следующий такт — к этому
      // моменту экран уже на странице и роутер свою прокрутку сделал.
      setTimeout(() => {
        if (targetCard.isConnected !== false) targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      targetCard.classList.add("evt-card-highlight");
      setTimeout(() => targetCard.classList.remove("evt-card-highlight"), 2200);
    }
  }
}

/**
 * ОТВЕТ НА ПРИГЛАШЕНИЕ В ПУТИ (06.10.2026). На холодном сервере запрос идёт до 25 секунд, и всё
 * это время студент видел только посеревшую кнопку. Ушёл на другую вкладку и вернулся — кнопка
 * снова активна: второй такой же запрос и второе примечание в сделке. «Не приду» оставалась
 * нажимаемой, пока шла запись. Теперь: пока ответ по приглашению в пути, второй не отправляется,
 * все кнопки карточки заблокированы, на нажатой — «Записываем…» / «Сохраняем…».
 */
const ответВПути_ = new Map(); // id приглашения → { confirm: true|false, подпись }
let выборПослеОбрыва_ = null;   // { groupId, status, chosenEventId, state } — см. render
function начатьОтвет_(groupId, btnEl, подпись) {
  if (ответВПути_.has(String(groupId))) return null;
  const ответ = { confirm: !!(btnEl.hasAttribute && btnEl.hasAttribute("data-do-confirm")), подпись, копии: [] };
  ответВПути_.set(String(groupId), ответ);
  const карточка = (btnEl.closest && btnEl.closest(".evt-card")) || null;
  const заблокированы = карточка ? Array.from(карточка.querySelectorAll("button")).filter((b) => !b.disabled) : [btnEl];
  заблокированы.forEach((b) => { b.disabled = true; });
  const прежняя = btnEl.textContent;
  btnEl.textContent = подпись;
  return () => {
    if (ответВПути_.get(String(groupId)) === ответ) ответВПути_.delete(String(groupId)); // не снимаем чужую, более новую блокировку
    заблокированы.forEach((b) => { b.disabled = false; });
    btnEl.textContent = прежняя;
    // Карточку за время запроса могли нарисовать заново и заблокировать ещё раз (см. ниже) — снимаем и эти
    // блокировки, иначе после «Система сейчас занята» на экране навсегда оставалось «Записываем…».
    ответ.копии.forEach((снять) => снять());
    ответ.копии = [];
  };
}
/**
 * СПИСОК ПЕРЕРИСОВАН, ПОКА ОТВЕТ В ПУТИ (07.10.2026). Студент ушёл на другую вкладку и вернулся (или
 * пришло фоновое обновление) — список рисуется заново, и кнопки на нём выглядели живыми, но молча не
 * нажимались: ответ по этому приглашению ещё идёт. Теперь такая карточка рисуется сразу заблокированной,
 * с той же подписью «Записываем…» / «Сохраняем…» на нажатой кнопке.
 */
function заблокироватьОтветыВПути_(container) {
  ответВПути_.forEach((ответ, gid) => {
    const карточка = container.querySelector(`.evt-card[data-group="${CSS.escape(gid)}"]`);
    if (!карточка) return;
    const кнопки = Array.from(карточка.querySelectorAll("button")).filter((b) => !b.disabled);
    кнопки.forEach((b) => { b.disabled = true; });
    const нажатая = карточка.querySelector(ответ.confirm ? "[data-do-confirm]" : "[data-do-decline]");
    const прежняя = нажатая ? нажатая.textContent : "";
    if (нажатая) нажатая.textContent = ответ.подпись;
    ответ.копии.push(() => { кнопки.forEach((b) => { b.disabled = false; }); if (нажатая) нажатая.textContent = прежняя; });
  });
}

/** Ответ сервера не пришёл (обрыв, тайм-аут): запись могла состояться — список надо перечитать. */
function исходНеизвестен_(err) {
  return /^(TIMEOUT|OFFLINE|BACKEND_HTML)$/.test(String((err && err.message) || ""));
}

async function doConfirm(container, groupId, chosenEventId, btnEl, ev) {
  if (!chosenEventId) return;
  const вернуть = начатьОтвет_(groupId, btnEl, "Записываем…");
  if (!вернуть) return;
  try {
    await api.respondEvent(groupId, "confirm", chosenEventId);
    ответВПути_.delete(String(groupId));
    перерисовать_(container, btnEl, () => { вернуть(); показатьИтог_(container, groupId, ev, "confirmed", chosenEventId); });
  } catch (err) {
    вернуть();
    if (исходНеизвестен_(err) || container.isConnected === false) перерисовать_(container, btnEl, null, выборКарточки_(groupId, ev));
    // Через штатное окно Telegram, а не голый window.alert: системное окно
    // браузера внутри Mini App выглядит чужеродно. И не показываем сырой
    // err.message — там технический текст с бэкенда (02.09.2026).
    showAlert(понятнаяОшибка_(err, "Не удалось записаться, попробуйте ещё раз."));
    if (списокУстарел_(err) && container.isConnected !== false) перерисовать_(container, btnEl);
  }
}

async function doDecline(container, groupId, btnEl, ev) {
  const вернуть = начатьОтвет_(groupId, btnEl, "Сохраняем…");
  if (!вернуть) return;
  try {
    await api.respondEvent(groupId, "decline");
    ответВПути_.delete(String(groupId));
    перерисовать_(container, btnEl, () => { вернуть(); показатьИтог_(container, groupId, ev, "declined", null); });
  } catch (err) {
    вернуть();
    if (исходНеизвестен_(err) || container.isConnected === false) перерисовать_(container, btnEl, null, выборКарточки_(groupId, ev));
    showAlert(понятнаяОшибка_(err, "Не удалось сохранить ответ, попробуйте ещё раз."));
    if (списокУстарел_(err) && container.isConnected !== false) перерисовать_(container, btnEl);
  }
}

/** Сервер отказал по существу (мест нет, приглашение или время пропали) — список надо перечитать.
 *  «Система сейчас занята» — нет: там достаточно нажать ещё раз, выбор студента сохраняем. */
function списокУстарел_(err) {
  const код = String((err && err.message) || "");
  return /[а-яё]/i.test(код) && код.indexOf("Система сейчас занята") === -1;
}

/** Перечитать и перерисовать список после ответа сервера. Только если экран ещё на
 *  странице: пока шёл запрос, студент мог уйти на другую вкладку — раньше список
 *  мероприятий рисовался поверх неё (05.10.2026). Если перечитать не удалось
 *  (пропала связь) — возвращаем кнопку, иначе она оставалась серой навсегда. */
/**
 * ОТВЕТ ПРИНЯТ, А СПИСОК ПЕРЕЧИТАТЬ НЕ УДАЛОСЬ (07.10.2026). Сервер подтвердил запись (или отказ), но
 * следом пропала связь. Раньше карточке возвращались прежние кнопки без единого слова: студент записан,
 * а на экране снова «Записаться». Итог известен точно — рисуем его на этой карточке без запроса.
 */
function показатьИтог_(container, groupId, ev, status, chosenEventId) {
  if (!ev || container.isConnected === false) return;
  ev.status = status;
  ev.chosenEventId = chosenEventId || null;
  cardState.delete(String(groupId));
  const карточка = container.querySelector(`.evt-card[data-group="${CSS.escape(String(groupId))}"]`);
  if (карточка) rerenderCard(карточка, ev);
}

function выборКарточки_(groupId, ev) {
  const state = cardState.get(String(groupId));
  return ev && state ? { groupId: String(groupId), status: ev.status, chosenEventId: ev.chosenEventId, state } : null;
}

function перерисовать_(container, btnEl, приСбое, выбор) {
  if (container.isConnected === false) {
    // 07.10.2026: пока шёл запрос, студент ушёл с экрана и вернулся — на странице уже другая копия
    // списка, со старым состоянием и заблокированной карточкой. Если открыт снова экран мероприятий,
    // просим роутер перерисовать его (кеш списка к этому моменту сброшен, придёт свежий).
    if (/^#\/?event(\/|$)/.test(window.location.hash)) window.dispatchEvent(new Event("state-refreshed"));
    return;
  }
  выборПослеОбрыва_ = выбор || null;
  render(container).catch((err) => {
    выборПослеОбрыва_ = null;
    console.warn("[events] не удалось обновить список:", err);
    if (btnEl) btnEl.disabled = false;
    if (приСбое) приСбое(); // вернуть карточке кнопки и подпись, заблокированные на время запроса
  });
}

function rerenderCard(cardEl, ev) {
  cardEl.innerHTML = cardInnerHtml(ev);
}

/** Small stat line under the "Мероприятия" title: how many of the fixed
 * roster's mandatory briefings this student has actually attended (attended
 * already recorded yes/no by a coordinator, see Events.gs step 4), out of
 * the full roster size -- a null/not-yet-invited roster slot just doesn't
 * count toward either the numerator or denominator's "attended" state, it's
 * simply not reached yet. Ad-hoc briefings (outside the roster) are folded
 * into a small "+N доп." note instead of the headline number, since they're
 * optional and shouldn't make mandatory progress look better or worse than
 * it is. */
function attendanceSummaryHtml(rosterEvents, extraEvents) {
    const rosterTotal = BRIEFING_ROSTER.length;
    const rosterAttended = rosterEvents.filter((e) => e && e.attended === true).length;
    const extraPast = extraEvents.filter((e) => e.attended !== null);
    const extraAttended = extraPast.filter((e) => e.attended === true).length;
    if (!rosterTotal && !extraPast.length) return "";
    const extraNote = extraPast.length ? ` <span style="font-size:13px;font-weight:600;color:var(--muted)">· +${extraAttended}/${extraPast.length} доп.</span>` : "";
    return `
        <div class="card" style="padding:14px 16px;margin-bottom:14px">
              <div class="sub" style="margin-bottom:2px">Посещено обязательных брифингов</div>
              <div class="metric" style="font-size:22px">${rosterAttended} <span style="font-size:14px;font-weight:600;color:var(--muted)">из ${rosterTotal}</span>${extraNote}</div>
        </div>`;
}

/** Dimmed, non-interactive stand-in for a roster briefing the coordinator
 * hasn't invited this student to yet -- no groupId/data-group, so the click
 * delegation in render() simply ignores it (nothing to click). */
function rosterPlaceholderHtml(item) {
  return `
    <div class="card" style="opacity:.55">
      <div class="evt-head">
        <div class="evt-icon">${I.cal}</div>
        <div>
          <div class="evt-title">${item.title}</div>
          <div class="evt-desc">Ожидается — координатор пришлёт приглашение, когда подойдёт время.</div>
        </div>
      </div>
    </div>`;
}

function cardWrapperHtml(ev) {
  return `<div class="card evt-card" data-group="${esc(ev.groupId)}">${cardInnerHtml(ev)}</div>`;
}

function cardInnerHtml(ev) {
  const state = getState(ev);
  const body = cardBodyHtml(ev);
  // Summary screens (done / confirmed / declined) already show their own
  // title inside the checkmark block -- showing the icon+title header on
  // top of that would duplicate it, so only the active picker/confirm
  // views get the header.
  if (isSummaryView(ev, state)) return body;
  return `
    <div class="evt-head">
      <div class="evt-icon">${I.cal}</div>
      <div>
        <div class="evt-title">${esc(ev.title)}</div>
        ${ev.description ? `<div class="evt-desc">${esc(ev.description)}</div>` : ""}
      </div>
    </div>
    ${body}`;
}

function cardBodyHtml(ev) {
  const state = getState(ev);

  if (ev.attended !== null) return doneBodyHtml(ev);
  if (isPastEvent(ev)) return pastBodyHtml(ev);
  if (isSummaryView(ev, state)) {
    return ev.status === "declined" ? declinedBodyHtml(ev) : confirmedBodyHtml(ev);
  }
  if (state.view === "confirm") return confirmPanelHtml(ev, state, ev.slots.length > 1);
  if (ev.slots.length === 1) return confirmPanelHtml(ev, state, false);
  return calendarBodyHtml(ev, state);
}

function doneBodyHtml(ev) {
  return `
    <div class="evt-done">
      <div class="evt-done-ico ${ev.attended ? "ok" : "muted"}">${ev.attended ? I.check : I.dash}</div>
      <div class="evt-done-title">${ev.attended ? "Вы посетили" : "Мероприятие прошло"}</div>
      <div class="sub">${esc(ev.title)}</div>
    </div>`;
}

/** Все слоты в прошлом, отметки посещения ещё нет — без кнопок. */
function pastBodyHtml(ev) {
  const slot = ev.slots.find((s) => s.id === ev.chosenEventId) || ev.slots[0];
  const wasBooked = ev.status === "confirmed";
  return `
    <div class="evt-done">
      <div class="evt-done-ico muted">${wasBooked ? I.clockBig : I.dash}</div>
      <div class="evt-done-title">Мероприятие прошло</div>
      <div class="sub">${esc(ev.title)}</div>
    </div>
    <div class="evt-meta" style="margin-top:14px">
      <div class="evt-meta-row"><span class="evt-meta-ico">${I.clock}</span> ${formatDate(slot.date)}${slot.time ? " · " + esc(slot.time) : ""}</div>
      ${wasBooked ? `<div class="sub" style="margin-top:6px">Вы были записаны. Отметка о посещении появится после проверки координатором.</div>` : ""}
    </div>`;
}

function confirmedBodyHtml(ev) {
  const slot = ev.slots.find((s) => s.id === ev.chosenEventId) || ev.slots[0];
  const hasChoice = ev.slots.length > 1;
  return `
    <div class="evt-done">
      <div class="evt-done-ico ok">${I.check}</div>
      <div class="evt-done-title">Вы записаны</div>
      <div class="sub">${esc(ev.title)}</div>
    </div>
    <div class="evt-meta" style="margin-top:14px">
      <div class="evt-meta-row"><span class="evt-meta-ico">${I.clock}</span> ${formatDate(slot.date)}${slot.time ? " · " + esc(slot.time) : ""}</div>
      ${slot.location ? `<div class="evt-meta-row"><span class="evt-meta-ico">${I.pin}</span> ${esc(slot.location)}</div>` : ""}
    </div>
    <div class="evt-links-row">
      ${hasChoice ? `<button type="button" data-change-time>Изменить время</button>` : ""}
      <button type="button" class="danger" data-do-decline="${esc(ev.groupId)}">Не смогу прийти</button>
    </div>`;
}

function declinedBodyHtml(ev) {
  return `
    <div class="evt-done">
      <div class="evt-done-ico muted">${I.dash}</div>
      <div class="evt-done-title">Вы отказались</div>
      <div class="sub">${esc(ev.title)}</div>
    </div>
    <div class="evt-links-row">
      <button type="button" data-reopen>Всё-таки записаться</button>
    </div>`;
}

/** Shared by the "only one time slot exists" case (view "single") and the
 * confirm step after picking a time off the calendar (view "confirm") --
 * both just recap the chosen slot and ask for an explicit confirm click,
 * exactly like Calendly's own booking-confirmation panel. */
function confirmPanelHtml(ev, state, showBackLink) {
  const slot = ev.slots.find((s) => s.id === state.selectedSlotId) || ev.slots[0];
  const full = slot.spotsLeft === 0 && slot.id !== ev.chosenEventId;
  const confirmLabel = full ? "Мест нет" : ev.status === "confirmed" ? "Подтвердить новое время" : "Записаться";
  return `
    <div class="evt-meta">
      <div class="evt-meta-row"><span class="evt-meta-ico">${I.clock}</span> ${formatDate(slot.date)}${slot.time ? " · " + esc(slot.time) : ""}</div>
      ${slot.location ? `<div class="evt-meta-row"><span class="evt-meta-ico">${I.pin}</span> ${esc(slot.location)}</div>` : ""}
      ${slot.spotsLeft !== null ? `<div class="evt-meta-row"><span class="evt-meta-ico">${I.people}</span> ${full ? "мест нет" : "свободных мест: " + Number(slot.spotsLeft)}</div>` : ""}
    </div>
    ${showBackLink ? `<button type="button" class="evt-back-link" data-back-to-calendar>‹ Выбрать другое время</button>` : ""}
    <div class="evt-actions" style="margin-top:12px">
      <button class="btn" data-do-confirm="${esc(ev.groupId)}" ${full ? "disabled" : ""}>${confirmLabel}</button>
      <button class="btn secondary" data-do-decline="${esc(ev.groupId)}">Не приду</button>
    </div>`;
}

function calendarBodyHtml(ev, state) {
  const slotsByDate = groupByDate(ev.slots);
  const months = availableMonths(slotsByDate);
  const cursor = state.monthCursor;
  const grid = buildMonthGrid(cursor.y, cursor.m);
  const monthLabel = `${RU_MONTHS_NOM[cursor.m - 1]} ${cursor.y}`;

  const minMonth = months[0];
  const maxMonth = months[months.length - 1];
  const prevAllowed = minMonth && (cursor.y > minMonth.y || (cursor.y === minMonth.y && cursor.m > minMonth.m));
  const nextAllowed = maxMonth && (cursor.y < maxMonth.y || (cursor.y === maxMonth.y && cursor.m < maxMonth.m));

  const dayCellsHtml = grid
    .map((week) =>
      week
        .map((d) => {
          if (!d) return `<span class="cal-day empty"></span>`;
          const dateStr = `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const hasSlots = !!slotsByDate[dateStr];
          const selected = dateStr === state.selectedDate;
          const cls = ["cal-day", hasSlots ? "has-slots" : "disabled", selected ? "selected" : ""].filter(Boolean).join(" ");
          return `<button type="button" class="${cls}" ${hasSlots ? `data-date="${dateStr}"` : "disabled"}>${d}</button>`;
        })
        .join("")
    )
    .join("");

  const monthHasSlots = Object.keys(slotsByDate).some((ds) => {
    const { y, m } = parseYMD(ds);
    return y === cursor.y && m === cursor.m;
  });
  const timesForDate = state.selectedDate ? slotsByDate[state.selectedDate] || [] : [];

  const timesHtml = timesForDate.length
    ? `<div class="evt-day-label">Время на ${formatDate(state.selectedDate)}</div>
       <div class="evt-slots">
         ${timesForDate
           .map((s) => {
             const full = s.spotsLeft === 0 && s.id !== ev.chosenEventId;
             // When re-opening the calendar via "Изменить время", show which
             // slot is the one already booked -- otherwise a student has no
             // way to tell which of several same-day times is their current
             // booking before they change it.
             const isCurrent = s.id === ev.chosenEventId;
             const cls = ["evt-slot", full ? "full" : "", isCurrent ? "selected" : ""].filter(Boolean).join(" ");
             return `<button type="button" class="${cls}" data-slot="${esc(s.id)}" ${full ? "disabled" : ""}>
               <span class="evt-slot-date">${esc(s.time) || "время не указано"}</span>
               ${s.spotsLeft !== null ? `<span class="evt-slot-spots">${full ? "мест нет" : "мест: " + Number(s.spotsLeft)}</span>` : ""}
             </button>`;
           })
           .join("")}
       </div>`
    : monthHasSlots
    ? `<div class="evt-hint">Выберите дату выше, чтобы увидеть время.</div>`
    : `<div class="evt-hint">В этом месяце нет доступного времени.</div>`;

  return `
    <div class="cal-nav">
      <button type="button" class="cal-nav-btn" data-cal-prev ${prevAllowed ? "" : "disabled"}>‹</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button type="button" class="cal-nav-btn" data-cal-next ${nextAllowed ? "" : "disabled"}>›</button>
    </div>
    <div class="cal-weekdays">${RU_WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
    <div class="cal-grid">${dayCellsHtml}</div>
    ${timesHtml}
    <div class="evt-links-row" style="margin-top:14px">
      <button type="button" class="danger" data-do-decline="${esc(ev.groupId)}">Не смогу прийти</button>
    </div>`;
}
