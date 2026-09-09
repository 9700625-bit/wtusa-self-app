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
// ПЕРЕСОБРАНО 04.09.2026 под новую воронку self (п. из CLAUDE.md "добавить
// сделки в воронке self, добавятся этапы и в роадмапе"). Меняется: порядок
// CIEE_ANKETA_REVIEW/CIEE_FILLED (осознанно, подтверждено владельцем — вернули
// «проверка анкеты -> кабинет заполнен», это ОТМЕНЯЕТ решение от 03.09.2026);
// JOB_OFFER_UPLOADED и JOB_OFFER_CIEE_REVIEW заменены на пять новых статусов
// (Sent to International Representative -> ... -> CIEE Review); PLACED
// переименован в PLACEMENT_COMPLETED; добавлен VISA_INTERVIEW_SCHEDULED между
// DS160_SUBMITTED и VISA_FINAL_CALL. JOB_PROBLEM остаётся веткой (branchOf
// теперь JOB_OFFER_CIEE_FINAL_REVIEW, см. roadmap.config.js).
//
// ВАЖНО: эти статусы ЕЩЁ НЕ созданы в воронке self в amoCRM — их только
// предстоит завести/переставить там (это делает пользователь). Пока это не
// сделано, STATUS_ID_MAP_JSON нельзя заполнить реальными status_id для новых
// имён — wireUpSelfPipelineMapping() в Setup.gs хранит карту от 2026-08-23 под
// СТАРЫЕ имена и требует пересборки после того, как статусы появятся в CRM.
const STAGE_IDS = [
  "ENROLLED",
  "CIEE_REGISTRATION", "CIEE_ANKETA_REVIEW", "CIEE_FILLED",
  "JOB_OFFER_SENT_INTL_REP", "JOB_OFFER_SUBMITTED_CIEE", "JOB_OFFER_HOST_REVIEW",
  "JOB_OFFER_PARTICIPANT_REVIEW", "JOB_OFFER_CIEE_FINAL_REVIEW", "JOB_PROBLEM",
  "PLACEMENT_COMPLETED",
  "DS2019_ISSUED",
  "DS160_STARTED", "DS160_REVIEW", "DS160_SUBMITTED",
  "VISA_INTERVIEW_SCHEDULED", "VISA_FINAL_CALL", "PASSPORT_READY", "VISA_APPROVED",
];

/**
 * amoCRM status_id (numeric, per pipeline stage — get real values from
 * listAmoPipelineStatuses() in Setup.gs) → our STAGE_IDS string.
 * Fill this in once your SELF pipeline exists in amoCRM. Kept as a Script
 * Property (JSON string) so it can be edited without redeploying code:
 * Script Properties → STATUS_ID_MAP_JSON → {"12345678":"JOB_OFFER_SUBMITTED_CIEE", ...}
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
// ПЕРЕПИСАНО 04.09.2026 под новую воронку self (текст прислан владельцем
// напрямую для всех 17 этапов после ENROLLED, п.5 из CLAUDE.md). Возврат
// эмодзи-пафоса (🎉, 📅) на нескольких этапах — осознанный: это ТЕ ЖЕ тексты,
// что и в новом roadmap.config.js, не сухая версия из правки 03.09.2026;
// ⚠️ по-прежнему только там, где реально нужно действие участника.
const STAGE_NOTIFY_TEXT = {
  // Про оплату здесь намеренно ни слова: приветственное сообщение не место
  // для денег. Отдельное уведомление о принятом платеже шлёт
  // notifyPaymentPaid_ (Webhooks.gs); напоминания о СРОКАХ оплаты — Reminders.gs.
  ENROLLED: "<b>Вы в программе</b>\n\nДоговор подписан. В приложении — ваш путь по этапам и список документов.",
  CIEE_REGISTRATION: "<b>Регистрация в CIEE готова</b>\n\nПроверьте почту, активируйте аккаунт и заполните анкету в течение 5 дней. Инструкция по заполнению — в приложении.",
  CIEE_ANKETA_REVIEW: "<b>Проверяем анкету CIEE</b>\n\nМы проверяем заполненные данные. Пока продолжайте поиск Job Offer.",
  CIEE_FILLED: "<b>Анкета CIEE проверена</b>\n\nВсё готово! Продолжайте поиск Job Offer. Как только получите офер — сообщите нам.",
  JOB_OFFER_SENT_INTL_REP: "<b>Job Offer на проверке</b>\n\nМы получили ваш офер и проверяем его перед отправкой в CIEE. Пока от вас ничего не требуется.",
  JOB_OFFER_SUBMITTED_CIEE: "<b>Job Offer передан в CIEE</b>\n\nОфер отправлен спонсору. Будьте на связи с работодателем — CIEE может запросить у него дополнительные документы.",
  JOB_OFFER_HOST_REVIEW: "<b>Работодателю нужно подтвердить Job Offer</b>\n\nПопросите работодателя зайти в личный кабинет CIEE и подписать ваш Job Offer.",
  JOB_OFFER_PARTICIPANT_REVIEW: "<b>Подтвердите Job Offer</b>\n\nЗайдите в личный кабинет CIEE, проверьте условия и подпишите Job Offer.",
  JOB_OFFER_CIEE_FINAL_REVIEW: "<b>Job Offer на финальной проверке</b>\n\nCIEE проверяет офер после подписания. Пока от вас ничего не требуется.",
  JOB_PROBLEM: "⚠️ <b>Нужно ваше внимание</b>\n\nПо вашему Job Offer появились замечания. Откройте приложение — там детали и что нужно сделать.",
  PLACEMENT_COMPLETED: "<b>Job Offer подтверждён 🎉</b>\n\nОфер полностью подтверждён CIEE. Следующий этап — выпуск DS-2019.",
  DS2019_ISSUED: "<b>DS-2019 готова</b>\n\nДокумент выпущен! Переходим к визовому этапу — следующий шаг DS-160.",
  DS160_STARTED: "<b>Пора заполнить DS-160</b>\n\nЗаполните визовую анкету по инструкции в приложении и отправьте нам на проверку.",
  DS160_REVIEW: "<b>Проверяем DS-160</b>\n\nМы проверяем анкету перед подачей. Пока от вас ничего не требуется.",
  DS160_SUBMITTED: "<b>DS-160 подана</b>\n\nАнкета готова. Теперь можно переходить к записи на визовое интервью.",
  VISA_INTERVIEW_SCHEDULED: "<b>Визовое интервью назначено 📅</b>\n\nДата подтверждена. Проверьте дату и время записи и начинайте подготовку к интервью.",
  VISA_FINAL_CALL: "⚠️ <b>Скоро визовое интервью</b>\n\nПроверьте дату и время записи и подготовьте документы по чек-листу в приложении.",
  PASSPORT_READY: "<b>Паспорт готов 🎉</b>\n\nВаш паспорт с визовым решением готов к выдаче. Заберите его и сразу сообщите нам о результате.",
  VISA_APPROVED: "<b>Виза J-1 одобрена 🎉🇺🇸</b>\n\nПоздравляем! Переходите к чек-листу подготовки к вылету в приложении.",
};
