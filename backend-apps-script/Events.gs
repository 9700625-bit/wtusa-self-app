/**
 * Invite-only events (брифинги, визиты в офис, ...). A student only ever
 * sees an event if a coordinator explicitly invited them — there is no
 * open/public sign-up.
 *
 * Coordinator workflow — everything below is done directly in the Sheet,
 * no new tool to learn:
 *   1. Add rows to the "Events" tab — one row per date/time. Give every
 *      alternative time slot of THE SAME session the same group_id (e.g.
 *      "brief3_20may" for both a 15:00 and an 18:00 slot); a standalone
 *      event with only one time can just reuse its own id as group_id.
 *   2. Add one row per invited student to "EventInvitations": telegram_id +
 *      group_id + status "invited" — leave everything else blank.
 *   3. Run sendPendingEventInvites() (function dropdown in the Apps Script
 *      editor toolbar → sendPendingEventInvites → ▶ Run). It messages every
 *      not-yet-notified invitee in Telegram with a deep link straight into
 *      the app's Events screen, and is safe to re-run — already-notified
 *      rows are skipped, so you can keep adding invite rows over time and
 *      just re-run this whenever you want the new ones sent.
 *   4. After the event, open EventInvitations and type "yes" or "no" into
 *      the `attended` column for each row — that's the entire attendance
 *      tracking step, no code involved.
 */

/** All of a student's invitations, each with its available time slot(s) and
 * their current response — this is what the app's Events screen renders. */
function getEventsForUser_(telegramId) {
  const invitations = findRows("EventInvitations", "telegram_id", telegramId);
  if (!invitations.length) return [];

  const allEvents = getRows("Events");

  return invitations
    .map((inv) => {
      const slots = allEvents
        .filter((e) => e.group_id === inv.group_id)
        .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))
        .map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          date: formatSheetDate_(e.date),
          time: formatSheetTime_(e.time),
          location: e.location,
          spotsLeft: eventSpotsLeft_(e.id, Number(e.capacity) || null),
        }));
      if (!slots.length) return null; // event rows for this group_id got removed/renamed
      return {
        groupId: inv.group_id,
        title: slots[0].title,
        description: slots[0].description,
        slots: slots,
        status: inv.status || "invited", // invited | confirmed | declined
        chosenEventId: inv.chosen_event_id || null,
        attended: inv.attended === "yes" ? true : inv.attended === "no" ? false : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.slots[0].date + a.slots[0].time).localeCompare(String(b.slots[0].date + b.slots[0].time)));
}

/** Confirmed headcount for one specific slot — null capacity means unlimited. */
function eventSpotsLeft_(eventId, capacity) {
  if (!capacity) return null;
  const taken = getRows("EventInvitations").filter((i) => i.status === "confirmed" && i.chosen_event_id === eventId).length;
  const left = capacity - taken;
  return left > 0 ? left : 0;
}

function findInvitationRow_(telegramId, groupId) {
  return findRows("EventInvitations", "telegram_id", telegramId).find((r) => r.group_id === groupId) || null;
}

/** Student confirms (with a chosen time slot) or declines an invitation. */
function respondToEvent_(telegramUser, groupId, choice, chosenEventId) {
  const telegramId = String(telegramUser.id);

  // Same race-condition class fixed in Webhooks.gs: without a lock, two
  // near-simultaneous "confirm" requests for the last spot on a limited
  // slot could both pass the capacity check before either writes, causing
  // overbooking. A script lock keeps this correct at essentially zero cost
  // (events are invited-only and low-volume, so contention is rare).
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(10000);
  if (!gotLock) throw new Error("Система сейчас занята — попробуйте ещё раз через несколько секунд.");

  try {
    const existing = findInvitationRow_(telegramId, groupId);
    if (!existing) throw new Error("Приглашение не найдено.");

    if (choice === "decline") {
      updateRow("EventInvitations", existing._row, { status: "declined", responded_at: new Date(), chosen_event_id: "" });
      return { status: "declined" };
    }

    if (choice === "confirm") {
      if (!chosenEventId) throw new Error("Не выбрано время.");
      const slot = findRow("Events", "id", chosenEventId);
      if (!slot || slot.group_id !== groupId) throw new Error("Это время больше не доступно.");

      const capacity = Number(slot.capacity) || null;
      if (capacity) {
        const taken = getRows("EventInvitations").filter(
          (i) => i.status === "confirmed" && i.chosen_event_id === chosenEventId && i.telegram_id !== telegramId
        ).length;
        if (taken >= capacity) throw new Error("На это время уже нет мест — выберите другое.");
      }

      updateRow("EventInvitations", existing._row, { status: "confirmed", chosen_event_id: chosenEventId, responded_at: new Date() });
      return { status: "confirmed", chosenEventId: chosenEventId };
    }

    throw new Error("Неизвестный выбор.");
  } finally {
    lock.releaseLock();
  }
}

/** Coordinator-facing list for admin-events.html — name + telegram_id +
 * current stage, only students who actually linked Telegram (telegram_id
 * present). Protected by ADMIN_SECRET, same as adminCreateLink. */
function adminListParticipants_() {
  return getRows("Participants")
    .filter((p) => p.telegram_id)
    .map((p) => ({ telegramId: String(p.telegram_id), name: p.name || "(без имени)", stage: p.current_stage_id || "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** One-click flow behind admin-events.html: creates one Events row per time
 * slot (sharing a generated group_id), invites every given telegramId, and
 * sends the Telegram notification immediately — no separate "run the
 * script" step needed the way the raw-sheet workflow requires. */
function adminCreateEventAndInvite_(payload) {
  const title = String((payload && payload.title) || "").trim();
  const description = String((payload && payload.description) || "").trim();
  const location = String((payload && payload.location) || "").trim();
  const slots = Array.isArray(payload && payload.slots) ? payload.slots : [];
  const telegramIds = Array.isArray(payload && payload.telegramIds) ? payload.telegramIds : [];
  // Optional: ties this event to a roadmap stage (e.g. "CIEE_REGISTRATION") so
  // that marking a student's invitation attended=yes in EventInvitations
  // lights up a "Посещено ✓" badge on that stage in their Roadmap screen —
  // see attendedRoadmapStageIds_ below. Most briefings should leave this
  // blank (they run in parallel with the roadmap, tracked only in "Мои
  // мероприятия" — see js/screens/events.js) — reserve it for the rare
  // briefing that should visually gate a roadmap milestone.
  const roadmapStageId = String((payload && payload.roadmapStageId) || "").trim();

  if (!title) throw new Error("Укажите название мероприятия.");
  if (!slots.length) throw new Error("Добавьте хотя бы одно время.");
  if (!telegramIds.length) throw new Error("Выберите хотя бы одного студента.");

  const groupId = "evt_" + Utilities.getUuid().slice(0, 8);
  const normalizedTitle = title.toLowerCase();

  slots.forEach((slot, i) => {
    appendRow("Events", {
      id: groupId + "_" + i,
      group_id: groupId,
      title: title,
      description: description,
      date: String(slot.date || ""),
      time: String(slot.time || ""),
      location: location,
      capacity: slot.capacity ? Number(slot.capacity) : "",
      roadmap_stage_id: roadmapStageId,
    });
  });

  const botUsername = CFG("TELEGRAM_BOT_USERNAME");
  const appName = CFG("TELEGRAM_APP_NAME");
  const link = "https://t.me/" + botUsername + "/" + appName + "?startapp=event_" + encodeURIComponent(groupId);
  const text =
    "📅 Приглашение: " + title + "\n\nОткройте приложение, чтобы выбрать время и записаться (или отказаться, если не сможете прийти).\n" + link;

  let sent = 0;
  const failures = [];
  // Guards against the coordinator re-running this form for the SAME
  // briefing (e.g. once per time slot instead of adding every slot with
  // "+ Добавить время" and submitting once) -- without this, a second
  // submission with the same title silently creates a second, independent
  // invitation for anyone already invited, which the student then sees as
  // a confusing extra "briefing" card they could separately confirm/decline
  // (and could in theory book two different times for what's really one
  // event). Someone who already has ANY invitation (any status) for a
  // same-titled event is skipped here instead -- to add more time options
  // to that existing invitation, add a new row to the Events sheet tab
  // reusing that event's existing group_id, not a new form submission.
  const skipped = [];
  telegramIds.forEach((telegramId) => {
    const idStr = String(telegramId);
    if (alreadyInvitedToTitle_(idStr, normalizedTitle)) {
      skipped.push(idStr);
      return;
    }
    appendRow("EventInvitations", {
      telegram_id: idStr,
      group_id: groupId,
      status: "invited",
      invited_at: new Date(),
      notified: "yes",
    });
    const result = sendTelegramMessage(idStr, text);
    if (result && result.ok === false) {
      // Row is still created (student will see the invite next time they
      // open the app) — but the coordinator should know Telegram delivery
      // itself failed, and why (e.g. "bot was blocked by the user" or
      // "chat not found" means this telegram_id never started the bot).
      failures.push({ telegramId: idStr, error: result.description || "unknown Telegram error" });
    } else {
      sent++;
    }
    logEvent(idStr, "coordinator", "event_invite_sent", "", groupId);
  });

  return { groupId: groupId, sent: sent, failures: failures, skipped: skipped };
}

/** True if telegramId already has an EventInvitations row (any status) for
 * an event whose title matches (case-insensitive) -- see the guard note
 * above. */
function alreadyInvitedToTitle_(telegramId, normalizedTitle) {
  const myGroupIds = new Set(findRows("EventInvitations", "telegram_id", telegramId).map((r) => r.group_id));
  if (!myGroupIds.size) return false;
  return getRows("Events").some((e) => myGroupIds.has(e.group_id) && String(e.title || "").trim().toLowerCase() === normalizedTitle);
}

/** Coordinator runs this manually (see workflow note at the top of this
 * file) after adding invite rows. Safe to re-run. */
function sendPendingEventInvites() {
  const pending = getRows("EventInvitations").filter((r) => r.status === "invited" && r.notified !== "yes");
  if (!pending.length) {
    Logger.log("No pending invitations to send.");
    return;
  }

  const events = getRows("Events");
  const botUsername = CFG("TELEGRAM_BOT_USERNAME");
  const appName = CFG("TELEGRAM_APP_NAME");

  pending.forEach((row) => {
    const slot = events.find((e) => e.group_id === row.group_id);
    const title = slot ? slot.title : "Мероприятие";
    const link = "https://t.me/" + botUsername + "/" + appName + "?startapp=event_" + encodeURIComponent(row.group_id);
    const text =
      "📅 Приглашение: " + title + "\n\nОткройте приложение, чтобы выбрать время и записаться (или отказаться, если не сможете прийти).\n" + link;
    sendTelegramMessage(row.telegram_id, text);
    updateRow("EventInvitations", row._row, { notified: "yes", invited_at: row.invited_at || new Date() });
    logEvent(row.telegram_id, "coordinator", "event_invite_sent", "", row.group_id);
  });

  Logger.log("Sent " + pending.length + " invitation(s).");
}

/** Roadmap stage ids this student should show a "Посещено ✓" badge for —
 * i.e. they have an EventInvitations row with attended="yes" whose event
 * was linked to a roadmap stage when the coordinator created it. Ad-hoc
 * events created with no roadmap_stage_id never show up here, by design. */
function attendedRoadmapStageIds_(telegramId) {
  const attendedGroupIds = findRows("EventInvitations", "telegram_id", telegramId)
    .filter((r) => r.attended === "yes")
    .map((r) => r.group_id);
  if (!attendedGroupIds.length) return [];

  const events = getRows("Events");
  const stageIds = new Set();
  attendedGroupIds.forEach((groupId) => {
    const evt = events.find((e) => e.group_id === groupId && e.roadmap_stage_id);
    if (evt) stageIds.add(evt.roadmap_stage_id);
  });
  return Array.from(stageIds);
}
