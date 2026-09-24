/**
 * ОЧЕРЕДЬ ВЕБХУКОВ amoCRM (24.09.2026, по решению владельца).
 *
 * Проблема: doPost раньше обрабатывал событие amoCRM синхронно
 * (handleAmoWebhook → syncDealToSheets: блокировка сделки, запросы в amoCRM,
 * запись в Sheets, уведомления) и только потом отвечал. Обычно ~1 с, но
 * бывало 2–8 с. amoCRM засчитывает медленный/ошибочный ответ как сбой и после
 * серии сбоев отключает вебхук («Webhook отключен из-за невалидного
 * отклика») — так и случилось 24.09 (последний принятый вызов 12:57, вечером
 * вебхук стоял выключенным; включён вручную в 22:47). Пока вебхук выключен,
 * не работают синхронизация Mini App, автопривязка и уведомление Оксане.
 *
 * Решение: doPost только кладёт параметры события в Script Properties
 * (ключ WHQ_<время>_<случайное>) и сразу отвечает. Раз в минуту
 * processAmoWebhookQueue (триггер по времени) достаёт события по порядку и
 * вызывает тот же самый handleAmoWebhook(params), что и раньше, — логика
 * обработки не менялась, поменялось только КОГДА она выполняется (задержка
 * до ~1 минуты).
 *
 * Детали:
 * - secret в очередь не пишется (проверяется в doPost до постановки).
 * - Значение Script Property ограничено ~9 КБ. Если событие больше
 *   WHQ_MAX_VALUE_CHARS_, оно обрабатывается сразу, по-старому, — данные не
 *   теряются.
 * - Обработчик берёт getUserLock (НЕ getScriptLock: script-lock использует
 *   сам syncDealToSheets/токен amoCRM, и держать его весь прогон нельзя),
 *   чтобы два запуска триггера не разбирали очередь одновременно.
 * - Событие удаляется из очереди перед обработкой; если обработка упала —
 *   ошибка уходит в reportError_ (как и раньше, повторной попытки нет:
 *   следующее изменение сделки всё равно пришлёт свежее событие).
 * - За один запуск — не дольше WHQ_MAX_RUN_MS_ (лимит Apps Script 6 мин);
 *   остаток доберёт следующий запуск.
 */

const WHQ_PREFIX_ = "WHQ_";
const WHQ_MAX_VALUE_CHARS_ = 8500;
const WHQ_MAX_RUN_MS_ = 4 * 60 * 1000;

/** Вызывается из doPost после проверки secret. Возвращает то, что уйдёт amoCRM в ответе. */
function enqueueAmoWebhook_(params) {
  const copy = {};
  Object.keys(params || {}).forEach((k) => {
    if (k !== "secret" && k !== "action") copy[k] = params[k];
  });
  const json = JSON.stringify(copy);
  const props = PropertiesService.getScriptProperties();
  if (json.length > WHQ_MAX_VALUE_CHARS_) {
    Logger.log("enqueueAmoWebhook_: payload %s chars > limit, processing synchronously", json.length);
    whqStat_(props, "WHQSTAT_ENQ", { path: "sync", size: json.length });
    return handleAmoWebhook(params);
  }
  const key = WHQ_PREFIX_ + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  props.setProperty(key, json);
  whqStat_(props, "WHQSTAT_ENQ", { path: "queued", size: json.length, key: key });
  return { ok: true, queued: true };
}

/** Триггер по времени: раз в минуту. */
function processAmoWebhookQueue() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return; // предыдущий запуск ещё разбирает очередь
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const keys = Object.keys(all).filter((k) => k.indexOf(WHQ_PREFIX_) === 0).sort();
    if (!keys.length) return;

    const started = Date.now();
    let done = 0;
    let failed = 0;
    for (let i = 0; i < keys.length; i++) {
      if (Date.now() - started > WHQ_MAX_RUN_MS_) break;
      const key = keys[i];
      const raw = all[key];
      props.deleteProperty(key);
      let params;
      try {
        params = JSON.parse(raw);
      } catch (e) {
        Logger.log("processAmoWebhookQueue: bad JSON in %s, dropped", key);
        failed++;
        continue;
      }
      try {
        handleAmoWebhook(params);
        done++;
      } catch (err) {
        failed++;
        Logger.log("processAmoWebhookQueue: handleAmoWebhook failed for %s: %s", key, err);
        try { reportError_("processAmoWebhookQueue", err, { key: key }); } catch (ignore) {}
      }
    }
    Logger.log("processAmoWebhookQueue: done=%s failed=%s queued=%s", done, failed, keys.length);
    whqStat_(props, "WHQSTAT_RUN", { done: done, failed: failed, queued: keys.length });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Самодиагностика (журналы Cloud Console для запусков по триггеру/вебу в этом
 * проекте не отдаются): последняя постановка в очередь (WHQSTAT_ENQ) и
 * последний непустой разбор (WHQSTAT_RUN) пишутся в Script Properties —
 * видно в «Настройки проекта → Свойства скрипта». Префикс WHQSTAT_ не
 * начинается с WHQ_, поэтому очередь эти ключи не подхватывает. Ошибка
 * записи статистики никогда не должна ломать приём/обработку события.
 */
function whqStat_(props, name, data) {
  try {
    data.at = Utilities.formatDate(new Date(), "GMT+5", "dd.MM.yyyy HH:mm:ss");
    props.setProperty(name, JSON.stringify(data));
  } catch (ignore) {}
}

/** Диагностика: сколько событий сейчас ждёт в очереди. Ничего не меняет. */
function whqStatus() {
  const keys = Object.keys(PropertiesService.getScriptProperties().getProperties()).filter((k) => k.indexOf(WHQ_PREFIX_) === 0);
  Logger.log("WHQ queued: %s", keys.length);
  return keys.length;
}
