/**
 * One-off helpers you run manually from the Apps Script editor (select the
 * function in the toolbar dropdown → Run) while setting things up. None of
 * these are called by the Web App itself. Output appears in View → Logs
 * (or Executions).
 */

const SHEET_SCHEMA = {
  Participants: [
    "telegram_id", "amo_deal_id", "amo_contact_id", "name", "full_name",
    "program", "season", "ciee_id", "coordinator_name", "coordinator_tg", "coordinator_avatar_url",
    "current_stage_id", "ciee_registration_date",
    "ciee_reminder_2d_sent", "ciee_reminder_1d_sent", "ciee_reminder_0d_sent", "ciee_escalated",
    "last_synced_at", "last_activity", "created_at",
  ],
  // Looked up by Webhooks.gs (coordinatorForUserId_) via amoCRM's numeric
  // "Ответственный" (responsible_user_id) on every deal sync, to fill in
  // Participants.coordinator_name/coordinator_tg/coordinator_avatar_url.
  // One row per coordinator -- fill this in by hand (there's no UI for it):
  // amo_user_id is the numeric id shown in amoCRM's own user list (Settings
  // → Users), telegram_username is what the student taps to message them
  // from the app, avatar_url is optional (leave blank for no photo).
  Coordinators: ["amo_user_id", "name", "telegram_username", "avatar_url"],
  Documents: ["telegram_id", "doc_id", "type", "status", "note", "coordinator_comment", "updated_at"],
  Payments: [
    "telegram_id", "pay_row_key", "pay_id", "label", "amount", "currency", "deadline", "status", "paid_date",
    "reminder_7_sent", "reminder_3_sent", "reminder_0_sent",
  ],
  Briefings: ["id", "title", "description", "date", "time", "status", "link", "materials"],
  VisaInfo: ["telegram_id", "appointment_date", "appointment_time", "location", "result", "passport_status", "sevis_fee_status", "visa_fee_status"],
  PreDepartureChecklist: ["telegram_id", "item_id", "label", "done"],
  LinkTokens: ["token", "amo_deal_id", "expires_at", "used"],
  SupportMessages: ["telegram_id", "message", "sent_at"],
  EventLog: ["timestamp", "telegram_id", "source", "event", "old_value", "new_value"],
  // Invite-only events (брифинги, визиты в офис, ...) — see Events.gs for the
  // full workflow. One row per date/time; give alternative time slots of the
  // SAME session the same group_id (a standalone event can reuse its own id
  // as group_id).
  Events: ["id", "group_id", "title", "description", "date", "time", "location", "capacity", "roadmap_stage_id"],
  // One row per invited student per event group. Coordinator fills in
  // telegram_id + group_id + status="invited" — everything else is managed
  // by the app/script (notified, chosen_event_id, responded_at, attended).
  EventInvitations: [
    "telegram_id", "group_id", "status", "chosen_event_id",
    "invited_at", "responded_at", "notified", "attended",
  ],
};

/**
 * Run this once against a blank Google Sheet (File → New spreadsheet first,
 * copy its ID from the URL into SHEET_ID script property, THEN run this).
 * Safe to re-run — skips tabs that already exist.
 */
function createSheetsIfMissing() {
  const ss = ss_();
  Object.keys(SHEET_SCHEMA).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      Logger.log("Created sheet tab: " + name);
    }
    const heads = SHEET_SCHEMA[name];
    sh.getRange(1, 1, 1, heads.length).setValues([heads]);
    sh.setFrozenRows(1);
  });
  // Apps Script always creates a default "Sheet1" — remove it if still empty/unused.
  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  Logger.log("Done. Tabs: " + ss.getSheets().map((s) => s.getName()).join(", "));
}

/** Prints the authorize URL — open it in a browser signed in as an amoCRM admin. */
function logAmoAuthorizeUrl() {
  Logger.log(getAmoAuthorizeUrl());
}

/**
 * Run AFTER creating the custom fields listed in SETUP.md. Prints every
 * lead (deal) custom field's id + name so you can copy the right numeric
 * ids into the FIELD_ID_* Script Properties.
 */
function listAmoCustomFields() {
  const data = amoApiFetch_("/api/v4/leads/custom_fields?limit=250", "get");
  const fields = (data._embedded && data._embedded.custom_fields) || [];
  fields.forEach((f) => Logger.log(f.id + "  " + f.name + "  (" + f.type + ")"));
}

/**
 * Run AFTER creating the SELF pipeline + its stages in amoCRM. Prints every
 * pipeline's stages with their numeric status_id, so you can build
 * STATUS_ID_MAP_JSON (Script Properties) mapping status_id -> our STAGE_IDS.
 */
function listAmoPipelineStatuses() {
  const data = amoApiFetch_("/api/v4/leads/pipelines", "get");
  const pipelines = (data._embedded && data._embedded.pipelines) || [];
  pipelines.forEach((p) => {
    Logger.log("Pipeline: " + p.name + " (id=" + p.id + ")");
    const statuses = (p._embedded && p._embedded.statuses) || [];
    statuses.forEach((s) => Logger.log("   status_id=" + s.id + "  " + s.name));
  });
  Logger.log('Now build STATUS_ID_MAP_JSON like: {"12345678":"SPONSOR_REVIEW", "23456789":"ABC_REVIEW", ...} ' +
    "using the status_id values above, and save it as a Script Property (see Config.gs).");
}

/** Seeds a couple of global Briefings rows so the Home/Briefings UI isn't empty on day one. */
function seedExampleBriefings() {
  appendRow("Briefings", {
    id: "br_welcome", title: "Welcome Briefing", description: "Вводный брифинг о программе SELF.",
    date: "2026-08-25", time: "", status: "completed", link: "", materials: "",
  });
  appendRow("Briefings", {
    id: "br_ciee_joboffer", title: "CIEE & Job Offer", description: "Как оформить и загрузить Job Offer в CIEE.",
    date: "2026-10-21", time: "18:00", status: "upcoming", link: "https://zoom.us/j/example", materials: "",
  });
  Logger.log("Seeded example briefings — edit dates/links directly in the Briefings tab.");
}

/**
 * One-off fix for a participant whose Documents rows were seeded before
 * DEFAULT_DOCUMENT_TYPES became the real 5-document list (Паспорт,
 * Свидетельство о рождении, Справка об обучении, Фото, Транскрипт). Deletes
 * their old doc_0..doc_3 rows and replaces them with the correct doc_1..doc_5
 * set, all status "miss" (nothing uploaded yet). Safe to re-run.
 */
function fixStaleDocumentRows_(telegramId) {
  const sh = sheet_("Documents");
  const rows = findRows("Documents", "telegram_id", telegramId);
  rows
    .map((r) => r._row)
    .sort((a, b) => b - a) // delete bottom-up so row numbers stay valid
    .forEach((rowNum) => sh.deleteRow(rowNum));

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
  Logger.log(
    "Fixed Documents rows for telegram_id " + telegramId + " — deleted " + rows.length + " old row(s), added " + DEFAULT_DOCUMENT_TYPES.length + " new."
  );
}

/** Run this one from the editor (function dropdown → fixDocuments_1077767749 → Run). */
function fixDocuments_1077767749() {
  fixStaleDocumentRows_("1077767749");
}
