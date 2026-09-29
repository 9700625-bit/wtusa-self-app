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
  // 29.09: в очередь кладём только id и status_id сделок — остальное
  // handleAmoWebhook не использует (сделку перечитывает из amoCRM сам).
  // Полное событие весило несколько КБ, и хранилище (500 КБ) переполнялось.
  const copy = {};
  Object.keys(params || {}).forEach((k) => {
    if (/^leads\[(status|update|add)\]\[\d+\]\[(id|status_id)\]$/.test(k)) copy[k] = params[k];
  });
  if (!Object.keys(copy).length) return { ok: true, skipped: "no lead ids" };
  const json = JSON.stringify(copy);
  const props = PropertiesService.getScriptProperties();
  if (json.length > WHQ_MAX_VALUE_CHARS_) {
    whqStat_(props, "WHQSTAT_ENQ", { path: "sync", size: json.length });
    return handleAmoWebhook(copy);
  }
  const key = WHQ_PREFIX_ + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  try {
    props.setProperty(key, json);
  } catch (err) {
    Logger.log("enqueueAmoWebhook_: store full (%s), processing synchronously", err);
    return handleAmoWebhook(copy);
  }
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
        const result = handleAmoWebhook(params);
        done++;
        // ПОВТОР ПРИ ВРЕМЕННОЙ ОШИБКЕ amoCRM (28.09.2026). handleAmoWebhook
        // сам ловит ошибки по сделке и кладёт их в result.processed[].error —
        // сюда исключение не долетает, и раньше событие с «Bandwidth quota
        // exceeded»/«Address unavailable» (после 3 ретраев в amoApiFetch_)
        // просто пропадало: для автопривязки сделка оставалась без ссылки и
        // без задачи. Теперь такое событие кладётся обратно в очередь (до 3
        // раз, счётчик в __attempt) и разбирается следующим запуском.
        const errs = ((result && result.processed) || []).map(function (p) { return p.error || p.autoLinkError || ""; }).filter(Boolean);
        const transient = errs.some(function (m) { return isTransientFetchError_({ message: m }); });
        const attempt = Number(params.__attempt || 0);
        if (transient && attempt < 3) {
          params.__attempt = attempt + 1;
          props.setProperty(WHQ_PREFIX_ + Date.now() + "_retry" + params.__attempt + "_" + Math.random().toString(36).slice(2, 6), JSON.stringify(params));
          Logger.log("processAmoWebhookQueue: transient error, re-queued %s (attempt %s): %s", key, params.__attempt, errs[0]);
        } else if (transient) {
          try { reportError_("processAmoWebhookQueue:gave-up", new Error(errs[0]), { key: key }); } catch (ignore) {}
        }
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
