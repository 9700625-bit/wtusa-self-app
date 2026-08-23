/**
 * Handles amoCRM's classic webhook (Настройки → Вебхуки in the amoCRM UI —
 * no API subscription call needed, just paste the deployed Apps Script URL
 * there and tick "Сделка изменена" / "Изменение статуса сделки"). amoCRM
 * posts application/x-www-form-urlencoded with PHP-style bracket keys, e.g.
 * leads[status][0][id]=123&leads[status][0][status_id]=456...
 *
 * On any change we re-fetch the deal in full (source of truth) rather than
 * trusting webhook fields directly — this also makes duplicate/out-of-order
 * webhook deliveries idempotent (ТЗ §77): we just overwrite with the same
 * current state and skip re-notifying if the stage didn't actually change.
 */

function extractChangedLeadIds_(params) {
  const ids = new Set();
  Object.keys(params).forEach((key) => {
    const m = key.match(/^leads\[(status|update|add)\]\[(\d+)\]\[id\]$/);
    if (m) ids.add(params[key]);
  });
  return Array.from(ids);
}

function handleAmoWebhook(params) {
  const dealIds = extractChangedLeadIds_(params);
  const results = [];
  dealIds.forEach((dealId) => {
    try {
      results.push({ dealId: dealId, result: syncDealToSheets(dealId) });
    } catch (err) {
      Logger.log("Failed to sync deal %s from webhook: %s", dealId, err);
      results.push({ dealId: dealId, error: String(err) });
    }
  });
  return { processed: results };
}

/** Looks up a coordinator by amoCRM's numeric user id (the deal's "Ответственный"). */
function coordinatorForUserId_(userId) {
  if (!userId) return null;
  return findRow("Coordinators", "amo_user_id", userId);
}

/**
 * Pulls the current state of a deal from amoCRM and writes it into the
 * Participants/Payments/Documents sheets. Sends a Telegram notification
 * only when the stage actually changed since the last sync.
 */
function syncDealToSheets(dealId) {
  // amoCRM is known to fire the same webhook event twice in quick succession.
  // Without a lock, two concurrent executions can both read the OLD stage
  // before either writes the new one — each then thinks "the stage changed"
  // and both send the Telegram notification, producing the duplicate message
  // seen in Telegram. A script lock serializes deal syncs so the second
  // (redundant) delivery always sees the already-updated stage and skips
  // re-notifying.
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(10000);
  if (!gotLock) {
    Logger.log("syncDealToSheets: could not acquire lock for deal %s within 10s — skipping to avoid a duplicate write/notification.", dealId);
    return { skipped: true, reason: "lock timeout" };
  }

  try {
    const deal = getDeal(dealId);

    const targetPipelineId = CFG_OPTIONAL("AMO_PIPELINE_ID", "");
    if (targetPipelineId && String(deal.pipeline_id) !== String(targetPipelineId)) {
      return { skipped: true, reason: "wrong pipeline", pipelineId: deal.pipeline_id };
    }

    const statusId = deal.status_id;
    const newStageId = stageIdForAmoStatus(statusId);
    if (!newStageId) {
      Logger.log("No STAGE_IDS mapping for amoCRM status_id=%s (deal %s) — check STATUS_ID_MAP_JSON.", statusId, dealId);
    }

    const previous = findRow("Participants", "amo_deal_id", dealId);
    const oldStageId = previous ? previous.current_stage_id : null;

    const fieldGet = (propName) => {
      const fieldId = CFG_OPTIONAL(propName, "");
      return fieldId ? customFieldValue(deal, fieldId) : null;
    };

    const coordinator = coordinatorForUserId_(deal.responsible_user_id);

    upsertRow("Participants", "amo_deal_id", dealId, {
      current_stage_id: newStageId || oldStageId || "",
      name: deal.name || (previous && previous.name) || "",
      season: fieldGet("FIELD_ID_SEASON") || (previous && previous.season) || "",
      program: fieldGet("FIELD_ID_PROGRAM") || (previous && previous.program) || "",
      ciee_id: fieldGet("FIELD_ID_CIEE_ID") || (previous && previous.ciee_id) || "",
      coordinator_name: coordinator ? coordinator.name : (previous && previous.coordinator_name) || "",
      coordinator_tg: coordinator ? coordinator.telegram_username : (previous && previous.coordinator_tg) || "",
      coordinator_avatar_url: coordinator ? coordinator.avatar_url : (previous && previous.coordinator_avatar_url) || "",
      last_synced_at: new Date(),
    });

    // upsertRow's payload above never touches telegram_id, so `previous`
    // (read before the write) already has the same telegram_id the row has
    // now -- no need to pay for a third live read of Participants just to
    // get back a value that didn't change.
    const participant = previous;
    if (participant && participant.telegram_id) {
      syncPaymentsFromDeal_(deal, participant);
      syncDocumentsFromDeal_(deal, participant);
    }

    if (newStageId && newStageId !== oldStageId) {
      const text = STAGE_NOTIFY_TEXT[newStageId] || "Ваш статус в программе обновился — откройте приложение, чтобы посмотреть детали.";
      notifyParticipantByDealId(dealId, text);
      if (participant) logEvent(participant.telegram_id, "amocrm_webhook", "stage_changed", oldStageId, newStageId);
    }

    return { oldStageId: oldStageId, newStageId: newStageId };
  } finally {
    lock.releaseLock();
  }
}

/* -------------------------------------- payments -------------------------------------- */

// Payment 1 & 2 are the same for every student — fixed amount/currency, due
// N days after the deal was created. The coordinator only ever sets one
// dropdown per payment ("Не оплачено" / "Оплачено") on the deal card.
// Payment 2 is quoted in $ but physically paid in tenge at the National
// Bank of RK's rate on the day — we don't try to convert it ourselves.
const FIXED_PAYMENTS_ = {
  pay_1: { amount: 200000, currency: "KZT", offsetDays: 5 },
  pay_2: { amount: 450, currency: "USD", offsetDays: 30 },
};

function syncPaymentsFromDeal_(deal, participant) {
  const createdAt = deal.created_at ? new Date(deal.created_at * 1000) : new Date();

  Object.keys(FIXED_PAYMENTS_).forEach((payId) => {
    const cfg = FIXED_PAYMENTS_[payId];
    const n = payId.slice(-1); // "pay_1" -> "1"
    const statusFieldId = CFG_OPTIONAL("FIELD_ID_PAY" + n + "_STATUS", "");
    if (!statusFieldId) return;

    const raw = String(customFieldValue(deal, statusFieldId) || "");
    const deadline = new Date(createdAt.getTime() + cfg.offsetDays * 24 * 3600 * 1000);
    const rowKey = participant.telegram_id + ":" + payId;
    const existing = findRow("Payments", "pay_row_key", rowKey);

    let status, paidDate;
    if (raw.indexOf("Оплачено") !== -1) {
      status = "paid";
      paidDate = (existing && existing.paid_date) || Utilities.formatDate(new Date(), "GMT+5", "yyyy-MM-dd");
    } else {
      status = deadline.getTime() < Date.now() ? "overdue" : "awaiting";
      paidDate = "";
    }

    upsertRow("Payments", "pay_row_key", rowKey, {
      telegram_id: participant.telegram_id,
      pay_id: payId,
      label: "Оплата " + n,
      amount: cfg.amount,
      currency: cfg.currency,
      deadline: Utilities.formatDate(deadline, "GMT+5", "yyyy-MM-dd"),
      status: status,
      paid_date: paidDate,
    });
  });

  syncVariablePayment3_(deal, participant);
}

// Payment 3 varies per student in both amount and deadline — the coordinator
// fills in both directly on the deal card (FIELD_ID_PAY3_AMOUNT / _DEADLINE),
// same "Не оплачено"/"Оплачено" dropdown as the others for status. Also
// quoted in $, paid in tenge at the NBRK rate on the day.
function syncVariablePayment3_(deal, participant) {
  const statusFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_STATUS", "");
  const amountFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_AMOUNT", "");
  const deadlineFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_DEADLINE", "");
  if (!statusFieldId || !amountFieldId || !deadlineFieldId) return; // fields not created in amoCRM yet

  const raw = String(customFieldValue(deal, statusFieldId) || "");
  const amount = Number(customFieldValue(deal, amountFieldId) || 0);
  const deadline = parseAmoDate_(customFieldValue(deal, deadlineFieldId));
  const rowKey = participant.telegram_id + ":pay_3";
  const existing = findRow("Payments", "pay_row_key", rowKey);

  let status, paidDate;
  if (raw.indexOf("Оплачено") !== -1) {
    status = "paid";
    paidDate = (existing && existing.paid_date) || Utilities.formatDate(new Date(), "GMT+5", "yyyy-MM-dd");
  } else {
    status = deadline && deadline.getTime() < Date.now() ? "overdue" : "awaiting";
    paidDate = "";
  }

  upsertRow("Payments", "pay_row_key", rowKey, {
    telegram_id: participant.telegram_id,
    pay_id: "pay_3",
    label: "Оплата 3",
    amount: amount,
    currency: "USD",
    deadline: deadline ? Utilities.formatDate(deadline, "GMT+5", "yyyy-MM-dd") : "",
    status: status,
    paid_date: paidDate,
  });
}

/** amoCRM "date" custom fields usually come back as a unix-seconds number;
 * fall back to a plain date-string parse just in case. */
function parseAmoDate_(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (!isNaN(n) && n > 0) return new Date(n * 1000);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/* -------------------------- documents (coordinator-reviewed) -------------------------- */

// Coordinator receives the actual file in WhatsApp/Telegram (outside this
// system) and just flips a dropdown on the deal card once reviewed. Until
// they do, whatever's already in the Sheet is left untouched — we only ever
// overwrite on an explicit "Принято" / "Нужна корректировка" decision.
const DOCUMENT_FIELDS_ = [
  { docId: "doc_1", type: "Паспорт", prop: "FIELD_ID_DOC1_STATUS" },
  { docId: "doc_2", type: "Свидетельство о рождении", prop: "FIELD_ID_DOC2_STATUS" },
  { docId: "doc_3", type: "Справка об обучении", prop: "FIELD_ID_DOC3_STATUS" },
  { docId: "doc_4", type: "Фото", prop: "FIELD_ID_DOC4_STATUS" },
  { docId: "doc_5", type: "Транскрипт", prop: "FIELD_ID_DOC5_STATUS" },
];

function syncDocumentsFromDeal_(deal, participant) {
  // Read once before the loop instead of inside it: findRows() would
  // otherwise re-read this same sheet fresh on every field below, because
  // each iteration's own appendRow/updateRow invalidates the cache the NEXT
  // iteration would have hit. Safe to snapshot up front because every entry
  // in DOCUMENT_FIELDS_ has a distinct doc_id, so no iteration needs to see
  // a row a previous iteration in this same call just created.
  const existingDocs = findRows("Documents", "telegram_id", participant.telegram_id);

  DOCUMENT_FIELDS_.forEach((cfg) => {
    const fieldId = CFG_OPTIONAL(cfg.prop, "");
    if (!fieldId) return;

    const raw = String(customFieldValue(deal, fieldId) || "");
    let status = null;
    if (raw.indexOf("Принято") !== -1) status = "ok";
    else if (raw.toLowerCase().indexOf("коррект") !== -1) status = "need";
    if (!status) return; // не выбрано в амоCRM — не трогаем то, что уже в таблице

    const existing = existingDocs.find((d) => d.doc_id === cfg.docId);
    const updated = {
      telegram_id: participant.telegram_id,
      doc_id: cfg.docId,
      type: cfg.type,
      status: status,
      note: status === "ok" ? "Принято координатором" : "Нужна корректировка — свяжитесь с координатором",
      updated_at: new Date(),
    };
    if (existing) {
      updateRow("Documents", existing._row, updated);
    } else {
      appendRow("Documents", Object.assign({ coordinator_comment: "" }, updated));
    }
  });
}
