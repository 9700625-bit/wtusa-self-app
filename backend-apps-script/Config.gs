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
  "CIEE_REGISTRATION", "CIEE_FILLED", "CIEE_ANKETA_REVIEW",
  "JOB_OFFER_UPLOADED", "JOB_OFFER_CIEE_REVIEW", "JOB_PROBLEM", "PLACED",
  "DS2019_ISSUED",
  "DS160_STARTED", "DS160_REVIEW", "DS160_SUBMITTED",
  "VISA_FINAL_CALL", "PASSPORT_READY", "VISA_APPROVED",
];

/**
 * amoCRM status_id (numeric, per pipeline stage — get real values from
 * listAmoPipelineStatuses() in Setup.gs) → our STAGE_IDS string.
 * Fill this in once your SELF pipeline exists in amoCRM. Kept as a Script
 * Property (JSON string) so it can be edited without redeploying code:
 * Script Properties → STATUS_ID_MAP_JSON → {"12345678":"JOB_OFFER_CIEE_REVIEW", ...}
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

/**
 * Short Telegram notification text per stage — deliberately terse; the
 * Mini App itself (roadmap.config.js) has the full rich copy.
 *
 * ТОН (03.09.2026). Переписаны в сухом служебном тоне: восклицаний и
 * англоязычного пафоса («YOU'RE PLACED!», «Congratulations!») больше нет —
 * это транзакционные уведомления о смене статуса, а не поздравительные
 * открытки. Структура у всех одинаковая: жирный заголовок «что произошло»,
 * пустая строка, одна строка «что делать». sendTelegramMessage шлёт их с
 * parse_mode: "HTML", поэтому <b> здесь намеренный и безопасный: эти строки
 * статические, через escapeTgHtml_ они НЕ проходят (он только для значений,
 * пришедших от людей — заголовков мероприятий, названий платежей).
 *
 * ⚠️ оставлен ровно на двух сообщениях, где от участника нужно действие
 * (JOB_PROBLEM и VISA_FINAL_CALL), чтобы они не терялись в ленте чата.
 *
 * Обещаний по визе здесь нет и быть не должно: PASSPORT_READY говорит
 * «решение принято», не называя какое.
 */
const STAGE_NOTIFY_TEXT = {
  // Про оплату здесь намеренно ни слова: приветственное сообщение не место
  // для денег. Отдельное уведомление о принятом платеже — в бэклоге, см.
  // CLAUDE.md; напоминания о СРОКАХ оплаты уже шлёт Reminders.gs.
  ENROLLED: "<b>Вы в программе</b>\n\nДоговор подписан. В приложении — ваш путь по этапам и список документов.",
  CIEE_REGISTRATION: "<b>Регистрация в CIEE</b>\n\nМы зарегистрировали вас у спонсора CIEE. На почту пришло Welcome Email — активируйте аккаунт и заполните анкету в течение 5 дней. Инструкция в приложении.",
  CIEE_FILLED: "<b>Личный кабинет CIEE заполнен</b>\n\nАнкета заполнена, дальше её проверит ABC Universe. Ждать проверки не нужно — начинайте искать работодателя. Когда получите Job Offer, загрузите его в приложении.",
  CIEE_ANKETA_REVIEW: "<b>Анкета CIEE на проверке</b>\n\nПроверяем данные из анкеты. По ней от вас ничего не требуется — продолжайте искать работодателя.",
  JOB_OFFER_UPLOADED: "<b>Job Offer получен</b>\n\nABC Universe начал проверку документа. Сейчас от вас ничего не требуется.",
  JOB_OFFER_CIEE_REVIEW: "<b>Job Offer передан в CIEE</b>\n\nABC Universe проверил документ и передал его спонсору. Проверку проводит CIEE.",
  JOB_PROBLEM: "⚠️ <b>Нужно ваше внимание</b>\n\nПо вашему Job Offer появились замечания. Откройте приложение — там детали и что нужно сделать.",
  PLACED: "<b>Job Offer подтверждён</b>\n\nCIEE подтвердил ваш Job Offer. Дальше — выпуск формы DS-2019.",
  DS2019_ISSUED: "<b>DS-2019 выпущена</b>\n\nНачинается визовый этап. Следующий шаг — форма DS-160.",
  DS160_STARTED: "<b>Заполните DS-160</b>\n\nЗаполните форму по инструкции ABC Universe — она в приложении.",
  DS160_REVIEW: "<b>DS-160 на проверке</b>\n\nПроверяем форму перед подачей. Сейчас от вас ничего не требуется.",
  DS160_SUBMITTED: "<b>DS-160 подана</b>\n\nТеперь можно записываться на визовое интервью.",
  VISA_FINAL_CALL: "⚠️ <b>Final Call перед интервью</b>\n\nСверьте дату и время записи и соберите документы по чек-листу в приложении.",
  PASSPORT_READY: "<b>Паспорт в посольстве</b>\n\nРешение по визе принято, паспорт на обработке. Сообщим, когда его можно будет забрать.",
  VISA_APPROVED: "<b>Виза J-1 одобрена</b>\n\nОткройте приложение и пройдите чек-лист подготовки к вылету.",
};
