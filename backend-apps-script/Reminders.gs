/**
 * Time-driven entry point — wire this up once via Apps Script's Triggers UI
 * (clock icon on the left) → sendScheduledReminders → Time-driven → Day
 * timer, once a day. Covers the two automations explicitly required by
 * ТЗ §70: Payments (7/3/0 days + overdue) and CIEE Activation (5-day
 * deadline + escalation). Extend the same pattern for Student Signature /
 * Visa Appointment reminders as those become priorities.
 */

function daysBetween_(fromDate, toDate) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
}

function sendScheduledReminders() {
  // This walks every Payments/Participants row once a day; nothing else in
  // the codebase should be writing those same reminder-flag columns at the
  // same time, but a lock costs nothing on a once-a-day run and closes off
  // the same class of race the rest of this codebase already guards against
  // elsewhere (see e.g. syncDealToSheets in Webhooks.gs) — e.g. someone
  // manually re-running this from the Apps Script editor while the daily
  // trigger is also mid-run, which would otherwise let both executions read
  // the same "not yet reminded" row and send the same student two identical
  // reminders. A longer timeout than the other locks in this codebase
  // because this one covers a full sweep of two sheets, not a single row.
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) {
    Logger.log("sendScheduledReminders: could not acquire lock within 30s — another run is likely still in progress, skipping this run.");
    return;
  }
  try {
    sendPaymentReminders_();
    sendCieeActivationReminders_();
  } finally {
    lock.releaseLock();
  }
}

function sendPaymentReminders_() {
  const today = new Date();
  const rows = getRows("Payments");

  rows.forEach((row) => {
    if (!row.deadline || row.status === "paid") return;
    const deadline = new Date(row.deadline);
    const daysLeft = daysBetween_(today, deadline);

    if (daysLeft < 0 && row.status !== "overdue") {
      // Notify (and create the coordinator task) BEFORE flipping the status
      // flag below, same as every other branch in this file — Telegram
      // delivery (sendTelegramMessage) never throws, but the amoCRM task
      // call inside maybeCreateCoordinatorTask_ can. Flagging first would
      // mean a failed task creation gets silently skipped forever (this
      // deadline never triggers the "overdue" branch again); flagging last
      // means a failure here simply leaves the row eligible to retry on
      // tomorrow's run.
      notifyParticipantByDealId_bySheetTelegramId_(row.telegram_id, "🔴 " + escapeTgHtml_(row.label) + " просрочен. Пожалуйста, свяжитесь с координатором.");
      maybeCreateCoordinatorTask_(row.telegram_id, "Payment просрочен: " + row.label);
      updateRow("Payments", row._row, { status: "overdue" });
      return;
    }

    // «НЕ ПОЗЖЕ, ЧЕМ ЗА N ДНЕЙ», А НЕ «РОВНО ЗА N ДНЕЙ» (02.09.2026).
    //
    // Здесь стояло строгое равенство daysLeft === 7 / === 3 / === 0. Если
    // ежедневный прогон не состоялся ровно в тот день — а это не гипотетика,
    // прогон молча выходит по таймауту лока, если в это окно пришёл вебхук из
    // amoCRM, — флаг оставался пустым, а назавтра daysLeft === 6 не попадал
    // уже ни в одну ветку. Напоминание не отправлялось НИКОГДА, и ничто об
    // этом не сообщало.
    //
    // Теперь порог «догоняющий»: берём ближайший непройденный рубеж из тех,
    // что уже наступили. Флаг по-прежнему защищает от повторной отправки, а
    // пропущенный день просто отработает на следующем прогоне.
    let reminderFlagCol = null;
    if (daysLeft <= 0) reminderFlagCol = "reminder_0_sent";
    else if (daysLeft <= 3) reminderFlagCol = "reminder_3_sent";
    else if (daysLeft <= 7) reminderFlagCol = "reminder_7_sent";
    if (!reminderFlagCol || row[reminderFlagCol] === "yes") return;

    // formatSheetDate_ обязателен: row.deadline прочитан из таблицы и является
    // объектом Date, а не строкой "2026-11-11". Без форматирования студент
    // получал в Telegram «срок через 7 дней (Wed Nov 11 2026 00:00:00 GMT+0500
    // (Yekaterinburg Standard Time))». Везде в проекте для этого есть хелпер —
    // здесь его забыли (02.09.2026).
    // Склонение теперь считается от реального числа дней: пороги стали
    // «не позже чем», поэтому daysLeft может быть любым от 0 до 7, а не
    // только 7, 3 или 0.
    const остаток10 = daysLeft % 10;
    const остаток100 = daysLeft % 100;
    const сутки =
      остаток10 === 1 && остаток100 !== 11 ? "день" :
      остаток10 >= 2 && остаток10 <= 4 && (остаток100 < 12 || остаток100 > 14) ? "дня" : "дней";
    const label = daysLeft <= 0 ? "сегодня" : "через " + daysLeft + " " + сутки;
    sendTelegramToSheetTelegramId_(row.telegram_id, "💳 Напоминание об оплате\n\n" + escapeTgHtml_(row.label) + " — срок " + label + " (" + formatSheetDate_(row.deadline) + ").");
    updateRow("Payments", row._row, { [reminderFlagCol]: "yes" });
  });
}

function sendCieeActivationReminders_() {
  const today = new Date();
  const participants = getRows("Participants").filter((p) => p.current_stage_id === "CIEE_REGISTRATION" && p.ciee_registration_date);

  participants.forEach((p) => {
    const regDate = new Date(p.ciee_registration_date);
    const daysElapsed = daysBetween_(regDate, today);
    const remaining = 5 - daysElapsed;

    if (remaining === 2 && p.ciee_reminder_2d_sent !== "yes") {
      sendTelegramToSheetTelegramId_(p.telegram_id, "📩 CIEE Account\n\nОсталось 2 дня для подтверждения регистрации. Проверьте Welcome Email от CIEE.");
      updateRow("Participants", p._row, { ciee_reminder_2d_sent: "yes" });
    } else if (remaining === 1 && p.ciee_reminder_1d_sent !== "yes") {
      sendTelegramToSheetTelegramId_(p.telegram_id, "📩 CIEE Account\n\nОстался 1 день для активации CIEE.");
      updateRow("Participants", p._row, { ciee_reminder_1d_sent: "yes" });
    } else if (remaining === 0 && p.ciee_reminder_0d_sent !== "yes") {
      sendTelegramToSheetTelegramId_(p.telegram_id, "📩 CIEE Account\n\nСрок активации CIEE истекает сегодня.");
      updateRow("Participants", p._row, { ciee_reminder_0d_sent: "yes" });
    } else if (remaining < 0 && p.ciee_escalated !== "yes") {
      // p.amo_deal_id is already in hand here (this loop's own getRows
      // result) — pass it straight through instead of making
      // maybeCreateCoordinatorTask_ re-read Participants to find the exact
      // same row again.
      maybeCreateCoordinatorTask_(p.telegram_id, "Связаться с участником — CIEE Account не активирован.", p.amo_deal_id);
      updateRow("Participants", p._row, { ciee_escalated: "yes" });
    }
  });
}

function sendTelegramToSheetTelegramId_(telegramId, text) {
  if (!telegramId) return;
  sendTelegramMessage(telegramId, text);
  logEvent(telegramId, "reminder_scheduler", "reminder_sent", "", text);
}

// Alias kept for readability at call sites above (same behaviour).
function notifyParticipantByDealId_bySheetTelegramId_(telegramId, text) {
  sendTelegramToSheetTelegramId_(telegramId, text);
}

/** `knownAmoDealId` lets a caller that already has the Participants row (e.g.
 * a loop already iterating getRows("Participants")) skip the lookup below —
 * pass it when you have it. Callers that only have a telegramId (like the
 * Payments-overdue branch above) leave it out and pay for the one lookup. */
function maybeCreateCoordinatorTask_(telegramId, text, knownAmoDealId) {
  const amoDealId = knownAmoDealId || (findRow("Participants", "telegram_id", telegramId) || {}).amo_deal_id;
  if (amoDealId) {
    createCoordinatorTask(amoDealId, text, 24);
  }
  logEvent(telegramId, "reminder_scheduler", "coordinator_task_created", "", text);
}
