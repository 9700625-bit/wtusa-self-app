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
  // briefing_key связывает мероприятие с позицией обязательного реестра брифингов
  // (js/config/briefingRoster.config.js). Без неё экран «Мероприятия» не мог
  // отличить обязательный брифинг от разового, см. комментарий в Events.gs.
  Events: ["id", "group_id", "title", "description", "date", "time", "location", "capacity", "roadmap_stage_id", "briefing_key"],
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
 * One-off: creates the 3 SELF custom fields that ТЗ/SETUP.md call for but
 * were never actually created in amoCRM (Season, Program, CIEE ID), then
 * writes their numeric ids straight into Script Properties
 * (FIELD_ID_SEASON / FIELD_ID_PROGRAM / FIELD_ID_CIEE_ID) — no manual
 * copy-pasting needed. Safe to re-run: skips any field that already exists
 * (matched by name) and just re-syncs the Script Property to its real id.
 */
function createMissingSelfCustomFields() {
  const existing = amoApiFetch_("/api/v4/leads/custom_fields?limit=250", "get");
  const fields = ((existing._embedded && existing._embedded.custom_fields) || []).slice();
  const wanted = [
    { name: "Season", type: "text", prop: "FIELD_ID_SEASON" },
    { name: "Program", type: "text", prop: "FIELD_ID_PROGRAM" },
    { name: "CIEE ID", type: "text", prop: "FIELD_ID_CIEE_ID" },
  ];

  const toCreate = wanted.filter((w) => !fields.some((f) => f.name === w.name));
  if (toCreate.length) {
    const created = amoApiFetch_(
      "/api/v4/leads/custom_fields",
      "post",
      toCreate.map((w) => ({ name: w.name, type: w.type }))
    );
    const createdFields = (created._embedded && created._embedded.custom_fields) || [];
    createdFields.forEach((f) => Logger.log("Created field: " + f.id + "  " + f.name));
    fields.push.apply(fields, createdFields);
  }

  wanted.forEach((w) => {
    const f = fields.find((f2) => f2.name === w.name);
    if (f) {
      setProp(w.prop, f.id);
      Logger.log(w.prop + " = " + f.id + " (" + w.name + ")");
    } else {
      Logger.log("WARNING: could not find or create field " + w.name);
    }
  });
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
  Logger.log('Now build STATUS_ID_MAP_JSON like: {"78553950":"ENROLLED", "79035314":"CIEE_REGISTRATION", ...} ' +
    "using the status_id values above (pipeline \"Сопровождение self\"), and save it as a Script Property (see Config.gs).");
}

/**
 * УСТАРЕЛО ПОД НОВЫЕ STAGE_IDS (04.09.2026) — но трогать эту функцию/карту не
 * нужно, это исторический снимок того, что реально было прогнано 2026-08-23 и
 * что реально сейчас лежит в live STATUS_ID_MAP_JSON. STAGE_IDS в Config.gs с
 * 04.09.2026 другой (CIEE_ANKETA_REVIEW/CIEE_FILLED переставлены,
 * JOB_OFFER_UPLOADED/JOB_OFFER_CIEE_REVIEW заменены на пять новых статусов,
 * PLACED -> PLACEMENT_COMPLETED, добавлен VISA_INTERVIEW_SCHEDULED) — но эти
 * статусы ЕЩЁ НЕ созданы в самой воронке self в amoCRM (это делает
 * пользователь). Когда появятся: заново прогнать listAmoPipelineStatuses(),
 * написать НОВУЮ версию этой функции (не редактировать карту ниже — она
 * отражает то, что реально стоит сейчас) с новыми status_id под новые имена,
 * и уже её вызвать вручную один раз.
 *
 * One-off: wires STATUS_ID_MAP_JSON + AMO_PIPELINE_ID Script Properties
 * directly from the real "Сопровождение self" pipeline (id=9881242), pulled
 * via listAmoPipelineStatuses() on 2026-08-23 — no manual copy-pasting of
 * status_ids needed. Mirrors createMissingSelfCustomFields()'s approach.
 *
 * AMO_PIPELINE_ID matters beyond convenience: without it, syncDealToSheets
 * (Webhooks.gs) processes deal changes from EVERY amoCRM pipeline, including
 * ones (Отказники, Отказ в визе, Сопровождение full, ...) that share the
 * same default won/lost status_id (142/143) with this one — a deal moving
 * in an unrelated pipeline could otherwise appear to change this
 * participant's SELF stage. Scoping to this one pipeline's id closes that.
 *
 * Every key here matches an `id` in js/config/roadmap.config.js exactly —
 * re-run listAmoPipelineStatuses() and update both files together if the
 * amoCRM board ever changes.
 */
function wireUpSelfPipelineMapping() {
  const map = {
    "78553950": "ENROLLED",
    "79035314": "CIEE_REGISTRATION",
    "87245618": "CIEE_ANKETA_REVIEW",
    "78615418": "CIEE_FILLED",
    "78615422": "JOB_OFFER_UPLOADED",
    "78615426": "JOB_OFFER_CIEE_REVIEW",
    "83521190": "JOB_PROBLEM",
    "78615430": "PLACED",
    "78615438": "DS2019_ISSUED",
    "78615442": "DS160_STARTED",
    "87247222": "DS160_REVIEW",
    "87247350": "DS160_SUBMITTED",
    "83069410": "VISA_FINAL_CALL",
    "83233450": "PASSPORT_READY",
    "83238730": "VISA_APPROVED",
    // Intentionally NOT mapped:
    //   78553946 "Неразобранное", 86090494 "2027 перенос" — housekeeping
    //     statuses with no participant-facing equivalent.
    //   87246442 "Офер долго на проверке" — an internal coordinator note,
    //     not shown to the participant (only "Job problem" is).
    //   142/143 (won/lost) — shared by every pipeline in this account, so a
    //     single global entry here would misfire for deals in OTHER
    //     pipelines too; leaving them unmapped means the app just keeps
    //     showing the last real stage (VISA_APPROVED) once a deal is won,
    //     which is what we want anyway (see VISA_APPROVED's own checklist).
  };
  setProp("STATUS_ID_MAP_JSON", JSON.stringify(map));
  setProp("AMO_PIPELINE_ID", "9881242");
  Logger.log("STATUS_ID_MAP_JSON set with " + Object.keys(map).length + " entries.");
  Logger.log("AMO_PIPELINE_ID set to 9881242 (Сопровождение self).");
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
