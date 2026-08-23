/**
 * Central config. All secrets live in Script Properties (Project Settings →
 * Script Properties in the Apps Script editor) — never hardcoded here, so
 * this file is safe to keep in git/share.
 *
 * Required Script Properties (see SETUP.md for how to fill each one):
 *   TELEGRAM_BOT_TOKEN        — from @BotFather
 *   AMO_SUBDOMAIN              — e.g. "abcuniverse" for abcuniverse.amocrm.ru
 *   AMO_CLIENT_ID               — amoCRM OAuth integration
 *   AMO_CLIENT_SECRET
 *   AMO_REDIRECT_URI             — same as configured in the amoCRM integration
 *   AMO_ACCESS_TOKEN             — filled automatically after oneTimeAmoAuth()
 *   AMO_REFRESH_TOKEN            — filled automatically, auto-refreshed after that
 *   AMO_TOKEN_EXPIRES_AT          — unix seconds, auto-managed
 *   WEBHOOK_SECRET                — random string you invent; appended to the
 *                                    amoCRM webhook URL as ?secret=... so random
 *                                    internet traffic can't post fake stage changes
 *   SHEET_ID                       — Google Sheet used as the DB (see Setup.gs)
 *   LINK_TOKEN_TTL_HOURS            — optional, defaults to 72
 *
 * Custom field IDs (numeric) — amoCRM API v4 references custom fields by
 * numeric field_id, not by name. After creating the fields from SETUP.md,
 * run listAmoCustomFields() (Setup.gs) once, check the Apps Script execution
 * log, and paste the printed IDs into these Script Properties:
 *   FIELD_ID_TELEGRAM_ID, FIELD_ID_CIEE_ID, FIELD_ID_SEASON, FIELD_ID_PROGRAM,
 *   FIELD_ID_PAY1_STATUS, FIELD_ID_PAY1_DEADLINE, FIELD_ID_PAY1_PAID_DATE, (x3 for pay2/pay3)
 *   FIELD_ID_DS2019_ISSUED_DATE, FIELD_ID_PLACED_DATE, FIELD_ID_CIEE_REG_DATE, ...
 */
// One request can read a dozen+ Script Properties (custom field ids, coordinator
// defaults, etc.) — fetch them all in a single bulk call and serve the rest of
// this execution from memory instead of round-tripping PropertiesService per key.
let scriptPropsCache_ = null;
function scriptProps_() {
  if (!scriptPropsCache_) scriptPropsCache_ = PropertiesService.getScriptProperties().getProperties();
  return scriptPropsCache_;
}

function CFG(key) {
  const v = scriptProps_()[key];
  if (!v) throw new Error("Missing Script Property: " + key + " — set it in Project Settings → Script Properties.");
  return v;
}

function CFG_OPTIONAL(key, fallback) {
  return scriptProps_()[key] || fallback;
}

function setProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  if (scriptPropsCache_) scriptPropsCache_[key] = String(value); // keep the cache consistent for the rest of this run
}

/**
 * Must exactly match the `id` values in js/config/roadmap.config.js on the
 * frontend — the frontend owns all copy/severity/CTA, the backend only ever
 * needs to say WHICH of these the participant is currently on.
 */
const STAGE_IDS = [
  "CONTRACT_SIGNED", "INITIAL_SETUP",
  "BRIEFING_WELCOME", "PROGRAM_BASICS",
  "CIEE_REGISTRATION", "CIEE_FILLING", "CIEE_REVIEW", "CIEE_READY",
  "JOB_OFFER_SUBMITTED", "ABC_REVIEW", "SPONSOR_REVIEW", "JOB_PROBLEM",
  "EMPLOYER_SIGNATURE", "STUDENT_SIGNATURE", "FINAL_CHECK", "PLACED",
  "DS2019_PROCESSING", "DS2019_ISSUED",
  "VISA_PREPARATION", "DS160_REVIEW", "DS160_SUBMITTED", "VISA_APPOINTMENT",
  "VISA_INTERVIEW", "PASSPORT_READY", "VISA_APPROVED",
  "PRE_DEPARTURE", "READY_TO_FLY",
  "USA_ARRIVED",
];

/**
 * amoCRM status_id (numeric, per pipeline stage — get real values from
 * listAmoPipelineStatuses() in Setup.gs) → our STAGE_IDS string.
 * Fill this in once your SELF pipeline exists in amoCRM. Kept as a Script
 * Property (JSON string) so it can be edited without redeploying code:
 * Script Properties → STATUS_ID_MAP_JSON → {"12345678":"SPONSOR_REVIEW", ...}
 */
function getStatusIdMap() {
  const raw = CFG_OPTIONAL("STATUS_ID_MAP_JSON", "{}");
  return JSON.parse(raw);
}

function stageIdForAmoStatus(statusId) {
  const map = getStatusIdMap();
  return map[String(statusId)] || null;
}

/** Short Telegram notification text per stage — deliberately terse; the
 * Mini App itself (roadmap.config.js) has the full rich copy. Extend freely. */
const STAGE_NOTIFY_TEXT = {
  CIEE_REGISTRATION: "📩 Вы были зарегистрированы на портале вашего спонсора CIEE, на почту вам отправлено Welcome Letter — у вас есть 5 дней на регистрацию. Ссылка на инструкцию в приложении.",
  CIEE_READY: "✅ Ваш CIEE Account проверен и готов.",
  SPONSOR_REVIEW: "🔵 Job Offer передан на проверку Sponsor.",
  JOB_PROBLEM: "⚠️ По вашему Job Offer появились замечания. Откройте приложение.",
  STUDENT_SIGNATURE: "✍️ Работодатель подписал Job Offer — теперь нужна ваша подпись в CIEE.",
  PLACED: "🇺🇸 YOU'RE PLACED! Один из главных этапов программы завершён.",
  DS2019_PROCESSING: "🔵 ABC Universe готовит документы для DS-2019.",
  DS2019_ISSUED: "🇺🇸 Ваша DS-2019 выпущена — начинается визовый этап.",
  VISA_APPOINTMENT: "📅 Вы записаны на визовое интервью.",
  VISA_APPROVED: "🇺🇸 Congratulations! Ваша J-1 Visa одобрена.",
  PRE_DEPARTURE: "🧳 Начался финальный этап подготовки к вылету.",
  READY_TO_FLY: "✈️ Вы готовы к вылету!",
};
