/**
 * Single Web App entry point. Deploy this project (Deploy → New deployment →
 * Web app, execute as "Me", access "Anyone") and you get one URL that
 * handles everything via ?action=... :
 *
 *   GET  ?action=state&initData=...            -> combined participant state (see stateForUser_)
 *   POST ?action=uploadDocument  body:{initData, docId, fileName}
 *   POST ?action=support         body:{initData, message}
 *   POST ?action=toggleChecklist body:{initData, itemId}
 *   POST ?action=link            body:{initData, token}
 *   GET  ?action=events&initData=...             -> this student's event invitations (see Events.gs)
 *   POST ?action=respondEvent    body:{initData, groupId, choice, chosenEventId}
 *   GET/POST ?action=amoWebhook&secret=...       -> amoCRM webhook receiver (Webhooks.gs)
 *   GET  ?action=amoOauthCallback&code=...        -> one-time amoCRM OAuth callback (AmoCRM.gs)
 *   GET  ?action=adminCreateLink&dealId=...&secret=<ADMIN_SECRET> -> ready-to-send
 *        Telegram linking link for one amoCRM deal (used by admin.html — see SETUP.md §5.3)
 *   GET  ?action=adminListParticipants&secret=<ADMIN_SECRET>       -> name list for admin-events.html
 *   POST ?action=adminCreateEvent&secret=<ADMIN_SECRET>  body:{title, description, location, slots:[{date,time,capacity}], telegramIds:[...], roadmapStageId?}
 *        -> creates the event slot(s), invites the given students, sends the Telegram notification (admin-events.html)
 *
 * IMPORTANT CORS gotcha: Apps Script Web Apps don't implement CORS preflight
 * (OPTIONS). GET requests work fine cross-origin. For POST, the frontend
 * must send the body as `Content-Type: text/plain` (NOT application/json) —
 * see js/services/liveApi.js — otherwise the browser's preflight OPTIONS
 * request will fail with no response.
 */

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(err) {
  const message = err && err.message ? err.message : String(err);
  const status = message.indexOf("UNAUTHORIZED") === 0 ? 401 : 400;
  return jsonOutput_({ error: message, status: status });
}

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === "amoOauthCallback") {
      exchangeAmoAuthCode(e.parameter.code);
      return HtmlService.createHtmlOutput("<h3>amoCRM подключён. Можно закрыть эту вкладку.</h3>");
    }

    if (action === "amoWebhook") {
      if (e.parameter.secret !== CFG("WEBHOOK_SECRET")) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(handleAmoWebhook(e.parameter));
    }

    if (action === "state") {
      const user = requireTelegramUser_(e.parameter.initData);
      return jsonOutput_(stateForUser_(user));
    }

    if (action === "events") {
      const user = requireTelegramUser_(e.parameter.initData);
      return jsonOutput_(getEventsForUser_(String(user.id)));
    }

    if (action === "adminListParticipants") {
      if (e.parameter.secret !== CFG("ADMIN_SECRET")) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(adminListParticipants_());
    }

    if (action === "adminCreateLink") {
      if (e.parameter.secret !== CFG("ADMIN_SECRET")) return jsonOutput_({ error: "bad secret" });
      const dealId = e.parameter.dealId;
      if (!dealId) return jsonOutput_({ error: "dealId required" });
      const token = createLinkToken(dealId);
      const botUsername = CFG("TELEGRAM_BOT_USERNAME");
      const appName = CFG("TELEGRAM_APP_NAME");
      const link = "https://t.me/" + botUsername + "/" + appName + "?startapp=link_" + token;
      return jsonOutput_({ link: link, dealId: dealId, token: token });
    }

    return jsonOutput_({ error: "unknown action" });
  } catch (err) {
    return errorOutput_(err);
  }
}

function doPost(e) {
  try {
    const action = e.parameter.action;

    // amoCRM's classic webhook posts form-urlencoded data with action/secret
    // in the query string and the payload in the form body (merged into
    // e.parameter by Apps Script automatically).
    if (action === "amoWebhook") {
      if (e.parameter.secret !== CFG("WEBHOOK_SECRET")) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(handleAmoWebhook(e.parameter));
    }

    // admin-events.html: coordinator-only, protected by ADMIN_SECRET in the
    // query string (same pattern as adminCreateLink) instead of a Telegram
    // initData check — this call isn't coming from inside the Mini App.
    if (action === "adminCreateEvent") {
      if (e.parameter.secret !== CFG("ADMIN_SECRET")) return jsonOutput_({ error: "bad secret" });
      const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      return jsonOutput_(adminCreateEventAndInvite_(body));
    }

    // Everything else: our own Mini App, sent as a text/plain JSON body
    // (see CORS note above).
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const user = requireTelegramUser_(body.initData);

    switch (action) {
      case "uploadDocument":
        return jsonOutput_(uploadDocument_(user, body.docId, body.fileName));
      case "support":
        return jsonOutput_(submitSupport_(user, body.message));
      case "toggleChecklist":
        return jsonOutput_(toggleChecklistItem_(user, body.itemId));
      case "link":
        return jsonOutput_({ amoDealId: consumeLinkToken(body.token, String(user.id)) });
      case "respondEvent":
        return jsonOutput_(respondToEvent_(user, body.groupId, body.choice, body.chosenEventId));
      default:
        return jsonOutput_({ error: "unknown action" });
    }
  } catch (err) {
    return errorOutput_(err);
  }
}

/* --------------------------------- handlers --------------------------------- */

function stateForUser_(telegramUser) {
  const telegramId = String(telegramUser.id);
  // ensureParticipantRow_ already looked this row up (or just wrote it) —
  // reuse that instead of reading the Participants sheet a second time.
  const participantRow = ensureParticipantRow_(telegramId, telegramUser) || {};
  const documents = findRows("Documents", "telegram_id", telegramId).map((d) => ({
    id: d.doc_id,
    type: d.type,
    status: d.status,
    updatedAt: d.updated_at || null,
    note: d.note,
    coordinatorComment: d.coordinator_comment || null,
  }));
  const paymentRows = findRows("Payments", "telegram_id", telegramId);
  const payments = mergeWithDefaultPayments_(paymentRows);
  const briefings = getRows("Briefings").map(stripRowMeta_); // global, not per-participant
  const visaRow = findRow("VisaInfo", "telegram_id", telegramId) || {};
  const checklist = findRows("PreDepartureChecklist", "telegram_id", telegramId).map((c) => ({
    id: c.item_id,
    label: c.label,
    done: c.done === "yes",
  }));

  return {
    participant: {
      id: telegramId,
      name: participantRow.name || telegramUser.first_name || "",
      fullName: participantRow.full_name || "",
      program: participantRow.program || "SELF",
      season: participantRow.season || "",
      cieeId: participantRow.ciee_id || "Будет добавлен после интеграции",
      telegramConnected: true,
      enrollmentDate: participantRow.enrollment_date || "",
    },
    coordinator: {
      name: participantRow.coordinator_name || CFG_OPTIONAL("DEFAULT_COORDINATOR_NAME", ""),
      role: "Координатор SELF",
      telegramUsername: participantRow.coordinator_tg || CFG_OPTIONAL("DEFAULT_COORDINATOR_TG", ""),
      avatarUrl: participantRow.coordinator_avatar_url || "",
    },
    currentStageId: participantRow.current_stage_id || "CONTRACT_SIGNED",
    documents: documents,
    payments: payments,
    programCost: Number(CFG_OPTIONAL("PROGRAM_COST_USD", 2850)),
    visaFees: [
      { id: "fee_sevis", label: "SEVIS Fee", amount: 220, status: visaRow.sevis_fee_status || "locked" },
      { id: "fee_visa", label: "Visa Fee", amount: 185, status: visaRow.visa_fee_status || "locked" },
    ],
    briefings: briefings,
    visaInfo: {
      appointmentDate: visaRow.appointment_date || null,
      appointmentTime: visaRow.appointment_time || null,
      location: visaRow.location || null,
      result: visaRow.result || "pending",
      passportStatus: visaRow.passport_status || "waiting",
    },
    preDepartureChecklist: checklist,
    attendedRoadmapStageIds: attendedRoadmapStageIds_(telegramId),
  };
}

function stripRowMeta_(row) {
  const copy = Object.assign({}, row);
  delete copy._row;
  return copy;
}

const DEFAULT_DOCUMENT_TYPES = ["Паспорт", "Свидетельство о рождении", "Справка об обучении", "Фото", "Транскрипт"];
const DEFAULT_CHECKLIST_ITEMS = [
  "Visa", "DS-2019", "Passport", "Flight",
  "Insurance / необходимые документы", "Необходимые деньги",
  "Документы распечатаны", "Pre-Departure Briefing",
];

/** First time we see a telegram_id, create its row (unlinked until consumeLinkToken runs)
 * and seed the standard document checklist so the Documents screen isn't empty.
 * Returns the participant row (existing or newly-created) so callers don't
 * have to re-read the Participants sheet right after this. */
function ensureParticipantRow_(telegramId, telegramUser) {
  const existing = findRow("Participants", "telegram_id", telegramId);
  if (existing) {
    updateRow("Participants", existing._row, { last_activity: new Date() });
    existing.last_activity = new Date();
    return existing;
  }

  // Slow path only, deliberately NOT locked above -- this function runs on
  // every single "state" request (the app's most frequent call), and almost
  // every one of those hits the `existing` branch above with zero lock
  // overhead. Only a telegram_id's very first-ever request reaches here, so
  // this is the one place a lock is worth its cost: without it, two
  // near-simultaneous first opens from the same brand-new user could both
  // pass the check above and both create duplicate Participants/Documents/
  // PreDepartureChecklist rows.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Система сейчас занята — попробуйте ещё раз через несколько секунд.");
  try {
    const existingRetry = findRow("Participants", "telegram_id", telegramId);
    if (existingRetry) {
      updateRow("Participants", existingRetry._row, { last_activity: new Date() });
      existingRetry.last_activity = new Date();
      return existingRetry;
    }

    const newRow = {
      telegram_id: telegramId,
      name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" "),
      current_stage_id: "CONTRACT_SIGNED",
      created_at: new Date(),
      last_activity: new Date(),
    };
    appendRow("Participants", newRow);
    DEFAULT_DOCUMENT_TYPES.forEach((type, i) => {
      appendRow("Documents", {
        telegram_id: telegramId,
        doc_id: "doc_" + (i + 1),
        type: type,
        status: "miss",
        note: "Документ не загружен",
        coordinator_comment: "",
        updated_at: "",
      });
    });
    DEFAULT_CHECKLIST_ITEMS.forEach((label, i) => {
      appendRow("PreDepartureChecklist", {
        telegram_id: telegramId,
        item_id: "chk_" + i,
        label: label,
        done: "",
      });
    });
    return newRow;
  } finally {
    lock.releaseLock();
  }
}

const DEFAULT_PAYMENT_TEMPLATE = [
  { pay_id: "pay_1", label: "Оплата 1", amount: 200000, currency: "KZT" },
  { pay_id: "pay_2", label: "Оплата 2", amount: 450, currency: "USD" },
  { pay_id: "pay_3", label: "Оплата 3", amount: 0, currency: "USD" },
];

function mergeWithDefaultPayments_(rows) {
  return DEFAULT_PAYMENT_TEMPLATE.map((tpl) => {
    const row = rows.find((r) => r.pay_id === tpl.pay_id);
    return {
      id: tpl.pay_id,
      label: tpl.label,
      amount: (row && Number(row.amount)) || tpl.amount,
      currency: (row && row.currency) || tpl.currency,
      deadline: (row && row.deadline) || null,
      status: (row && row.status) || "not_due",
      paidDate: (row && row.paid_date) || null,
    };
  });
}

function uploadDocument_(telegramUser, docId, fileName) {
  const telegramId = String(telegramUser.id);
  const existing = findRows("Documents", "telegram_id", telegramId).find((d) => d.doc_id === docId);
  const updated = {
    telegram_id: telegramId,
    doc_id: docId,
    status: "review",
    note: "Загружено " + Utilities.formatDate(new Date(), "GMT+5", "d MMMM") + " · на проверке (" + fileName + ")",
    updated_at: new Date(),
  };
  if (existing) {
    updateRow("Documents", existing._row, updated);
  } else {
    appendRow("Documents", Object.assign({ type: docId, coordinator_comment: "" }, updated));
  }
  logEvent(telegramId, "mini_app", "document_uploaded", "", docId);
  return updated;
}

function submitSupport_(telegramUser, message) {
  const telegramId = String(telegramUser.id);
  appendRow("SupportMessages", { telegram_id: telegramId, message: message, sent_at: new Date() });
  logEvent(telegramId, "mini_app", "support_message", "", message);
  return { ok: true };
}

function toggleChecklistItem_(telegramUser, itemId) {
  const telegramId = String(telegramUser.id);
  // Reuse the one findRows result instead of re-querying after the write --
  // updateRow() invalidates this sheet's row cache, so a second findRows
  // call here would force a brand-new live Sheets read for no reason: we
  // already know the new value locally.
  const rows = findRows("PreDepartureChecklist", "telegram_id", telegramId);
  const row = rows.find((r) => r.item_id === itemId);
  if (row) {
    row.done = row.done === "yes" ? "" : "yes";
    updateRow("PreDepartureChecklist", row._row, { done: row.done });
  }
  return rows.map((c) => ({
    id: c.item_id,
    label: c.label,
    done: c.done === "yes",
  }));
}
