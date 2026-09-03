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
  "ENROLLED",
  "CIEE_REGISTRATION", "CIEE_ANKETA_REVIEW", "CIEE_FILLED",
  "JOB_OFFER_UPLOADED", "JOB_OFFER_CIEE_REVIEW", "JOB_PROBLEM", "PLACED",
  "DS2019_ISSUED",
  "DS160_STARTED", "DS160_REVIEW", "DS160_SUBMITTED", "VISA_FINAL_CALL",
  "PASSPORT_READY", "VISA_APPROVED",
];

/**
 * amoCRM status_id (numeric, per pipeline stage — get real values from
 * listAmoPipelineStatuses() in Setup.gs) → our STAGE_IDS string.
 * Fill this in once your SELF pipeline exists in amoCRM. Kept as a Script
 * Property (JSON string) so it can be edited without redeploying code:
 * Script Properties → STATUS_ID_MAP_JSON → {"78553950":"ENROLLED", ...} (see
 * wireUpSelfPipelineMapping() in Setup.gs, which sets this automatically).
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
  ENROLLED: "📄 Добро пожаловать в программу Work & Travel USA SELF! Договор подписан, Payment #1 принят — вы официально участник. Откройте приложение, чтобы посмотреть свой роадмап.",
  CIEE_REGISTRATION: "📩 Вы были зарегистрированы на портале вашего спонсора CIEE, на почту вам отправлено Welcome Letter — у вас есть 5 дней на регистрацию. Ссылка на инструкцию в приложении.",
  CIEE_ANKETA_REVIEW: "🔎 Мы получили вашу анкету CIEE и начали проверку. Сейчас от вас ничего не требуется.",
  CIEE_FILLED: "✅ Ваш личный кабинет CIEE проверен и готов. Теперь самостоятельно найдите работодателя — как получите Job Offer, загрузите его в приложении.",
  JOB_OFFER_UPLOADED: "📥 Мы получили ваш Job Offer — ABC Universe начинает проверку документа.",
  JOB_OFFER_CIEE_REVIEW: "🔵 Ваш Job Offer проверен ABC Universe и передан на проверку CIEE (Sponsor).",
  JOB_PROBLEM: "⚠️ По вашему Job Offer появились замечания. Откройте приложение.",
  PLACED: "🇺🇸 YOU'RE PLACED! Один из главных этапов программы завершён.",
  DS2019_ISSUED: "🇺🇸 Ваша DS-2019 выпущена — начинается визовый этап.",
  DS160_STARTED: "🛂 Начался визовый этап — заполните форму DS-160 согласно инструкции в приложении.",
  DS160_REVIEW: "🔵 Мы проверяем заполненную вами форму DS-160 перед подачей.",
  DS160_SUBMITTED: "🔵 Форма DS-160 подана. Теперь можно записываться на визовое интервью.",
  VISA_FINAL_CALL: "📞 Final Call перед визой — проверьте дату и время интервью и соберите документы по чек-листу в приложении.",
  PASSPORT_READY: "📕 Решение по визе принято, паспорт находится на обработке в посольстве/консульстве. Сообщим, когда будет готов к получению.",
  VISA_APPROVED: "🇺🇸 Congratulations! Ваша J-1 Visa одобрена. Откройте приложение и пройдите чек-лист подготовки к вылету.",
};
