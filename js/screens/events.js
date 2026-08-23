import * as api from "../services/api.js";
import { formatDate } from "../utils/format.js?v=2";
import { goBack } from "../router.js";

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

function isSummaryView(ev, state) {
  if (ev.attended !== null) return true;
  if (ev.status === "declined" && !state.overridePicker) return true;
  if (ev.status === "confirmed" && state.view !== "confirm" && !state.overridePicker) return true;
  return false;
}

export async function render(container, params = []) {
  const events = await api.getEvents();
  cardState.clear();

  if (!events.length) {
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

  container.innerHTML = `
    <section class="screen active">
      <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
      <h1 style="font-size:20px;margin:4px 0 12px">Мероприятия</h1>
      <div id="events-list">${events.map(cardWrapperHtml).join("")}</div>
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
      doConfirm(container, groupId, state.selectedSlotId, confirmBtn);
    } else if (declineBtn) {
      doDecline(container, groupId, declineBtn);
    }
  });

  // Deep link support: t.me/bot/app?startapp=event_<groupId> lands here as
  // #event/<groupId> (see app.js), with the groupId passed through as
  // params[0]. The screen still always lists every invitation -- that's
  // intentional (see the comment in app.js) -- but with nothing marking
  // which card the student was actually sent about, a coordinator's "check
  // this one" link just dumped them into an undifferentiated list. Scroll to
  // and briefly highlight that one card instead.
  const targetGroupId = params[0];
  if (targetGroupId) {
    const targetCard = container.querySelector(`.evt-card[data-group="${CSS.escape(targetGroupId)}"]`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
      targetCard.classList.add("evt-card-highlight");
      setTimeout(() => targetCard.classList.remove("evt-card-highlight"), 2200);
    }
  }
}

async function doConfirm(container, groupId, chosenEventId, btnEl) {
  if (!chosenEventId) return;
  btnEl.disabled = true;
  try {
    await api.respondEvent(groupId, "confirm", chosenEventId);
    render(container);
  } catch (err) {
    btnEl.disabled = false;
    alert(err.message || "Не удалось записаться, попробуйте ещё раз.");
  }
}

async function doDecline(container, groupId, btnEl) {
  btnEl.disabled = true;
  try {
    await api.respondEvent(groupId, "decline");
    render(container);
  } catch (err) {
    btnEl.disabled = false;
    alert(err.message || "Не удалось сохранить ответ, попробуйте ещё раз.");
  }
}

function rerenderCard(cardEl, ev) {
  cardEl.innerHTML = cardInnerHtml(ev);
}

function cardWrapperHtml(ev) {
  return `<div class="card evt-card" data-group="${ev.groupId}">${cardInnerHtml(ev)}</div>`;
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
      <div class="evt-icon">📅</div>
      <div>
        <div class="evt-title">${ev.title}</div>
        ${ev.description ? `<div class="evt-desc">${ev.description}</div>` : ""}
      </div>
    </div>
    ${body}`;
}

function cardBodyHtml(ev) {
  const state = getState(ev);

  if (ev.attended !== null) return doneBodyHtml(ev);
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
      <div class="evt-done-ico ${ev.attended ? "ok" : "muted"}">${ev.attended ? "✓" : "—"}</div>
      <div class="evt-done-title">${ev.attended ? "Вы посетили" : "Мероприятие прошло"}</div>
      <div class="sub">${ev.title}</div>
    </div>`;
}

function confirmedBodyHtml(ev) {
  const slot = ev.slots.find((s) => s.id === ev.chosenEventId) || ev.slots[0];
  const hasChoice = ev.slots.length > 1;
  return `
    <div class="evt-done">
      <div class="evt-done-ico ok">✓</div>
      <div class="evt-done-title">Вы записаны</div>
      <div class="sub">${ev.title}</div>
    </div>
    <div class="evt-meta" style="margin-top:14px">
      <div class="evt-meta-row"><span class="evt-meta-ico">🕐</span> ${formatDate(slot.date)}${slot.time ? " · " + slot.time : ""}</div>
      ${slot.location ? `<div class="evt-meta-row"><span class="evt-meta-ico">📍</span> ${slot.location}</div>` : ""}
    </div>
    <div class="evt-links-row">
      ${hasChoice ? `<button type="button" data-change-time>Изменить время</button>` : ""}
      <button type="button" class="danger" data-do-decline="${ev.groupId}">Не смогу прийти</button>
    </div>`;
}

function declinedBodyHtml(ev) {
  return `
    <div class="evt-done">
      <div class="evt-done-ico muted">—</div>
      <div class="evt-done-title">Вы отказались</div>
      <div class="sub">${ev.title}</div>
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
      <div class="evt-meta-row"><span class="evt-meta-ico">🕐</span> ${formatDate(slot.date)}${slot.time ? " · " + slot.time : ""}</div>
      ${slot.location ? `<div class="evt-meta-row"><span class="evt-meta-ico">📍</span> ${slot.location}</div>` : ""}
      ${slot.spotsLeft !== null ? `<div class="evt-meta-row"><span class="evt-meta-ico">👥</span> ${full ? "мест нет" : "свободных мест: " + slot.spotsLeft}</div>` : ""}
    </div>
    ${showBackLink ? `<button type="button" class="evt-back-link" data-back-to-calendar>‹ Выбрать другое время</button>` : ""}
    <div class="evt-actions" style="margin-top:12px">
      <button class="btn" data-do-confirm="${ev.groupId}" ${full ? "disabled" : ""}>${confirmLabel}</button>
      <button class="btn secondary" data-do-decline="${ev.groupId}">Не приду</button>
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
             return `<button type="button" class="${cls}" data-slot="${s.id}" ${full ? "disabled" : ""}>
               <span class="evt-slot-date">${s.time || "время не указано"}</span>
               ${s.spotsLeft !== null ? `<span class="evt-slot-spots">${full ? "мест нет" : "мест: " + s.spotsLeft}</span>` : ""}
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
      <button type="button" class="danger" data-do-decline="${ev.groupId}">Не смогу прийти</button>
    </div>`;
}
