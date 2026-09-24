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
      reportError_("webhook:deal " + dealId, err);
      results.push({ dealId: dealId, error: String(err) });
    }
  });
  // АВТОПРИВЯЗКА ПО ЭТАПУ (24.09.2026). Сделка попала в этап «Отправить
  // ссылку в приложение» — вебхук сам зовёт autoLinkDeal_ (Api.gs). Salesbot
  // здесь не подошёл: для сделок без контакта он не запускается, а его
  // работу не видно ни в логах, ни в карточке — проверить нельзя.
  autoLinkDealIds_(params).forEach((dealId) => {
    try {
      // Один раз на сделку: если ссылка уже выписывалась (автоматически или
      // координатором из admin.html) — повторно не шлём, даже если старая
      // истекла. Повторную отправку делает координатор вручную.
      const issued = getRows("LinkTokens").some((t) => String(t.amo_deal_id) === String(dealId));
      const r = issued ? { skipped: true, reason: "link already issued" } : autoLinkDeal_(dealId);
      Logger.log("autoLink from webhook for deal %s: %s", dealId, JSON.stringify(r));
      results.push({ dealId: dealId, autoLink: r });
    } catch (err) {
      Logger.log("autoLink from webhook failed for deal %s: %s", dealId, err);
      reportError_("webhook:autoLink " + dealId, err);
      results.push({ dealId: dealId, autoLinkError: String(err) });
    }
  });
  return { processed: results };
}

/**
 * Сделки из вебхука, которые ТОЛЬКО ЧТО попали в этап автопривязки
 * (Script Property AUTOLINK_STATUS_ID, по умолчанию 88848478 — «Отправить
 * ссылку в приложение»). Берём любое событие сделки (status/add/update) —
 * amoCRM склеивает быстрые изменения и может прислать только update; от
 * повторов защищает проверка LinkTokens выше и autoLinkDeal_.
 */
function autoLinkDealIds_(params) {
  const target = String(CFG_OPTIONAL("AUTOLINK_STATUS_ID", "88848478"));
  if (!target) return [];
  const ids = new Set();
  Object.keys(params).forEach((key) => {
    const m = key.match(/^leads\[(status|add|update)\]\[(\d+)\]\[status_id\]$/);
    if (!m || String(params[key]) !== target) return;
    const id = params["leads[" + m[1] + "][" + m[2] + "][id]"];
    if (id) ids.add(String(id));
  });
  Logger.log("autoLinkDealIds_: keys=%s -> %s", Object.keys(params).filter((k) => /status_id|\]\[id\]$/.test(k)).join(","), ids.size);
  return Array.from(ids);
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
  // HTTP — ДО ЗАМКА (22.09.2026). Запрос сделки в amoCRM (~0,5–1 с) и
  // проверка воронки раньше выполнялись внутри критической секции: каждый
  // вебхук, включая сделки из чужой воронки, держал общий замок на время
  // сетевого запроса. При массовом добавлении студентов очередь на замок
  // росла, и вебхуки, не дождавшиеся 30 с, молча пропускались. Теперь замок
  // охватывает только чтение/запись Sheets — критическая секция короче
  // примерно вдвое, чужие воронки замок вообще не трогают.
  const deal = getDeal(dealId);
  if (!deal) {
    Logger.log("syncDealToSheets: deal %s not found in amoCRM (empty response).", dealId);
    return { skipped: true, reason: "deal not found" };
  }

  const targetPipelineId = CFG_OPTIONAL("AMO_PIPELINE_ID", "");
  if (targetPipelineId && String(deal.pipeline_id) !== String(targetPipelineId)) {
    return { skipped: true, reason: "wrong pipeline", pipelineId: deal.pipeline_id };
  }

  // ЗАКРЫТЫЕ СДЕЛКИ (23.09.2026, решение владельца). «Успешно реализовано»
  // (142) и «Закрыто и не реализовано» (143) — бывшие участники, новых строк
  // в Participants им не заводим. Уже существующую строку (студент, который
  // дошёл до конца программы) продолжаем синхронизировать как раньше.
  if (isClosedAmoStatus_(deal.status_id) && !findRow("Participants", "amo_deal_id", dealId)) {
    return { skipped: true, reason: "closed deal", statusId: deal.status_id };
  }

  // amoCRM is known to fire the same webhook event twice in quick succession.
  // Without a lock, two concurrent executions can both read the OLD stage
  // before either writes the new one — each then thinks "the stage changed"
  // and both send the Telegram notification, producing the duplicate message
  // seen in Telegram. A script lock serializes deal syncs so the second
  // (redundant) delivery always sees the already-updated stage and skips
  // re-notifying.
  // ЗАМОК НА СДЕЛКУ, А НЕ НА ВЕСЬ СКРИПТ (22.09.2026). Общий LockService
  // выстраивал ВСЕ вебхуки в одну очередь: при массовом переносе сделок
  // часть не дожидалась 30 с и молча пропускалась (именно так amoCRM в итоге
  // отключил вебхук — накопились таймауты). Теперь разные сделки
  // синхронизируются параллельно, а очередь есть только у повторных
  // вебхуков ОДНОЙ сделки — ровно там, где она нужна против дублей.
  // Вернуть прежнее поведение без правки кода: Script Property
  // SYNC_LOCK_GLOBAL = yes.
  const lock = acquireDealLock_(dealId, 30000);
  if (!lock) {
    Logger.log("syncDealToSheets: could not acquire lock for deal %s within 30s — skipping to avoid a duplicate write/notification.", dealId);
    const p_ = findRow("Participants", "amo_deal_id", dealId); if (p_) logEvent(p_.telegram_id, "amocrm_webhook", "sync_skipped_lock_timeout", "", "");
    return { skipped: true, reason: "lock timeout" };
  }

  try {
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

    // ИМЯ ДЛЯ ОБРАЩЕНИЯ (22.09.2026). Participants.name — это название
    // сделки, поэтому приветствие по имени убрали 03.09. Настоящее имя есть у
    // контакта сделки (он уже приходит в ?with=contacts). Запрашиваем его
    // один раз — пока first_name пустой — и дальше не трогаем: лишний GET на
    // каждый вебхук здесь не нужен.
    let firstName = (previous && previous.first_name) || "";
    let fullName = (previous && previous.full_name) || "";
    if (!firstName || !fullName) {
      try {
        const n = contactNameForDeal_(deal);
        if (n) {
          firstName = firstName || n.firstName;
          fullName = fullName || n.fullName; // «Имя Фамилия» из контакта — для приветствия
        }
      } catch (err) {
        Logger.log("syncDealToSheets: contact name unavailable for deal %s: %s", dealId, err);
      }
    }

    upsertRow("Participants", "amo_deal_id", dealId, {
      current_stage_id: newStageId || oldStageId || "",
      name: deal.name || (previous && previous.name) || "",
      first_name: firstName,
      full_name: fullName,
      season: fieldGet("FIELD_ID_SEASON") || (previous && previous.season) || "",
      program: fieldGet("FIELD_ID_PROGRAM") || (previous && previous.program) || "",
      ciee_id: fieldGet("FIELD_ID_CIEE_ID") || (previous && previous.ciee_id) || "",
      coordinator_name: coordinator ? coordinator.name : (previous && previous.coordinator_name) || "",
      coordinator_tg: coordinator ? coordinator.telegram_username : (previous && previous.coordinator_tg) || "",
      coordinator_avatar_url: coordinator ? coordinator.avatar_url : (previous && previous.coordinator_avatar_url) || "",
      // ДАТА РЕГИСТРАЦИИ В CIEE (02.09.2026). Колонка была в схеме и читалась в
      // двух местах, но НЕ ЗАПИСЫВАЛАСЬ ни одной строкой кода во всём проекте.
      // Из-за этого не работала целая ветка автоматики: фильтр
      // `p.ciee_registration_date` в sendCieeActivationReminders_ отсеивал
      // всех до единого, поэтому напоминания «осталось 2 дня / 1 день /
      // истекает сегодня» и эскалация координатору не отправлялись никому, а
      // обратный отсчёт на экране студента всегда был пустым.
      //
      // Берём дату из кастомного поля amoCRM, если оно настроено. Если поля
      // нет — подставляем момент перехода на этап CIEE_REGISTRATION: для
      // пятидневного отсчёта это ровно то, что нужно, и это лучше, чем
      // молчащая автоматика. Уже записанную дату не перетираем, иначе отсчёт
      // начинался бы заново при каждом вебхуке.
      ciee_registration_date:
        (previous && previous.ciee_registration_date) ||
        fieldGet("FIELD_ID_CIEE_REG_DATE") ||
        (newStageId === "CIEE_REGISTRATION" ? Utilities.formatDate(new Date(), "GMT+5", "yyyy-MM-dd") : ""),
      // РЕАЛЬНАЯ ПРИЧИНА "ТРЕБУЮТСЯ ИСПРАВЛЕНИЯ" ПО JOB OFFER (08.09.2026).
      //
      // До этого поле stage.coordinatorComment на JOB_PROBLEM было пустой
      // веткой: рендер в statusDetail.js существовал, но подставлять в него
      // было нечего, и раньше здесь был вымышленный текст "Работодателю
      // необходимо исправить даты работы" — один и тот же для всех, убран
      // 03.09.2026 (см. CLAUDE.md). Источник появился только теперь: новое
      // текстовое поле сделки в amoCRM (FIELD_ID_JOB_PROBLEM_COMMENT),
      // координатор пишет туда причину сам, когда переводит сделку в статус
      // Job Problem. Синкается сюда так же, как season/program — при
      // отсутствии значения в amoCRM (ещё не написали) не затираем то, что
      // уже было записано раньше.
      job_problem_comment: fieldGet("FIELD_ID_JOB_PROBLEM_COMMENT") || (previous && previous.job_problem_comment) || "",
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
      syncVisaInfoFromDeal_(deal, participant);
    }

    // PUSH ПРИ НОВОМ КОММЕНТАРИИ К JOB OFFER (22.09.2026). Комментарий
    // синкается в таблицу и лежит на экране, но студент о нём не узнавал,
    // пока сам не откроет приложение. Шлём один раз — только когда текст
    // изменился по сравнению с тем, что уже было в таблице.
    const newComment = String(fieldGet("FIELD_ID_JOB_PROBLEM_COMMENT") || "").trim();
    const oldComment = String((previous && previous.job_problem_comment) || "").trim();
    if (participant && participant.telegram_id && newComment && newComment !== oldComment) {
      sendTelegramMessage(participant.telegram_id, "💬 <b>Комментарий координатора по Job Offer</b>\n\n" + escapeTgHtml_(newComment) + "\n\nПодробности — в приложении.");
      logEvent(participant.telegram_id, "amocrm_webhook", "job_comment_notified", oldComment, newComment);
    }

    if (newStageId && newStageId !== oldStageId) {
      const text = STAGE_NOTIFY_TEXT[newStageId] || "Ваш статус в программе обновился — откройте приложение, чтобы посмотреть детали.";
      notifyParticipantByDealId(dealId, text);
      if (participant) logEvent(participant.telegram_id, "amocrm_webhook", "stage_changed", oldStageId, newStageId);
    }

    return { oldStageId: oldStageId, newStageId: newStageId };
  } finally {
    lock.release();
  }
}

/**
 * Замок на конкретную сделку поверх CacheService (у Apps Script нет
 * именованных замков). Оптимистичная схема: если ключа нет — кладём свой
 * токен, ждём 60 мс и перечитываем; если там наш токен — замок наш. Два
 * вебхука одной сделки в одну и ту же миллисекунду — единственный случай,
 * когда оба могут «выиграть»; тогда второй увидит уже записанный этап и
 * не пришлёт дубль (сравнение old/new). Срок ключа 90 с — на случай, если
 * выполнение упало без release. SYNC_LOCK_GLOBAL=yes → прежний общий замок.
 */
/** amoCRM: 142 = «Успешно реализовано», 143 = «Закрыто и не реализовано» — одинаковы во всех воронках. */
function isClosedAmoStatus_(statusId) {
  const s = String(statusId);
  return s === "142" || s === "143";
}

function acquireDealLock_(dealId, waitMs) {
  if (String(CFG_OPTIONAL("SYNC_LOCK_GLOBAL", "")).toLowerCase() === "yes") {
    const gl = LockService.getScriptLock();
    if (!gl.tryLock(waitMs)) return null;
    return { release: () => gl.releaseLock() };
  }
  const cache = CacheService.getScriptCache();
  const key = "deal_lock:" + dealId;
  const token = Utilities.getUuid();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!cache.get(key)) {
      cache.put(key, token, 90);
      Utilities.sleep(60);
      if (cache.get(key) === token) {
        return { release: () => { if (cache.get(key) === token) cache.remove(key); } };
      }
    }
    Utilities.sleep(250);
  }
  return null;
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

/**
 * УВЕДОМЛЕНИЕ О ПРИНЯТОМ ПЛАТЕЖЕ (04.09.2026, п.4 из CLAUDE.md).
 *
 * Раньше при переводе координатором платежа в «Оплачено» в амоCRM студент
 * не получал вообще ничего — было только напоминание о СРОКЕ оплаты
 * (Reminders.gs), а подтверждения самого факта оплаты не существовало.
 *
 * Вызывающий код (syncPaymentsFromDeal_ / syncVariablePayment3_) шлёт это
 * ровно один раз, на переходе "не оплачено"/"просрочено" -> "оплачено":
 * сравнивает новый status со status, прочитанным из Sheets ДО пересчёта
 * (existing). Без этой проверки сообщение уходило бы на КАЖДЫЙ вебхук по
 * сделке, а не только на реальную оплату — амоCRM шлёт вебхук на любое
 * изменение сделки, не только на смену этого конкретного поля.
 *
 * Суммы в тексте намеренно нет — действующее ограничение проекта, см.
 * комментарий над STAGE_NOTIFY_TEXT в Config.gs.
 */
function notifyPaymentPaid_(participant, label) {
  const text =
    "✅ <b>Платёж получен</b>\n\nМы отметили «" + label + "» как оплаченный. Спасибо! Актуальный статус всех платежей — в разделе «Оплата» в приложении.";
  sendTelegramMessage(participant.telegram_id, text);
  logEvent(participant.telegram_id, "amocrm_webhook", "payment_paid", "", label);
}
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
    const label = "Оплата " + n;

    let status, paidDate;
    if (raw.indexOf("Оплачено") !== -1) {
      status = "paid";
      paidDate = (existing && existing.paid_date) || Utilities.formatDate(new Date(), "GMT+5", "yyyy-MM-dd");
    } else {
      // НЕ СТАВИМ overdue РАНЬШЕ НАПОМИНАНИЯ (02.09.2026).
      //
      // Здесь стояло status = просрочен ? "overdue" : "awaiting". Вебхук
      // прилетает при ЛЮБОМ изменении сделки, поэтому статус переключался на
      // "overdue" молча — без сообщения студенту и без задачи координатору.
      // А ежедневный прогон напоминаний (Reminders.gs) проверяет
      // `daysLeft < 0 && row.status !== "overdue"` — то есть увидев уже
      // проставленный статус, он ничего не делал. В итоге «🔴 Оплата
      // просрочена» не приходило НИКОГДА: срок истекал вечером, утром
      // координатор что-то правил в сделке, и уведомление пропадало.
      //
      // Теперь вебхук про просрочку не решает: он только различает «оплачено»
      // и «ждём оплату», а перевод в overdue вместе с уведомлением остаётся
      // работой напоминаний. Уже проставленный ранее overdue сохраняем —
      // сбрасывать его в awaiting значило бы прислать напоминание повторно.
      status = existing && existing.status === "overdue" ? "overdue" : "awaiting";
      paidDate = "";
    }

    upsertRow("Payments", "pay_row_key", rowKey, {
      telegram_id: participant.telegram_id,
      pay_id: payId,
      label: label,
      amount: cfg.amount,
      currency: cfg.currency,
      deadline: Utilities.formatDate(deadline, "GMT+5", "yyyy-MM-dd"),
      status: status,
      paid_date: paidDate,
    });
    if (status === "paid" && (!existing || existing.status !== "paid")) {
      notifyPaymentPaid_(participant, label);
    }
  });

  syncVariablePayment3_(deal, participant);
}

// Payment 3 varies per student in amount — the coordinator fills that in
// directly on the deal card (FIELD_ID_PAY3_AMOUNT), same "Не оплачено"/
// "Оплачено" dropdown as the others for status. Also quoted in $, paid in
// tenge at the NBRK rate on the day.
//
// Дедлайн (09.09.2026, по договору): по умолчанию — через 4 месяца после
// создания сделки, автоматически, как и у платежей 1/2 (5 и 30 дней). Если
// у студента индивидуальная договорённость — это исключение, координатор
// вручную указывает свою дату в FIELD_ID_PAY3_DEADLINE на карточке сделки,
// и она перекрывает автоматический расчёт.
const PAY_3_AUTO_DEADLINE_MONTHS_ = 4;
function syncVariablePayment3_(deal, participant) {
  const statusFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_STATUS", "");
  const amountFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_AMOUNT", "");
  const deadlineFieldId = CFG_OPTIONAL("FIELD_ID_PAY3_DEADLINE", "");
  if (!statusFieldId || !amountFieldId) return; // fields not created in amoCRM yet

  const createdAt = deal.created_at ? new Date(deal.created_at * 1000) : new Date();
  const raw = String(customFieldValue(deal, statusFieldId) || "");
  const amount = Number(customFieldValue(deal, amountFieldId) || 0);
  const manualDeadline = deadlineFieldId ? parseAmoDate_(customFieldValue(deal, deadlineFieldId)) : null;
  const autoDeadline = new Date(createdAt.getTime());
  autoDeadline.setMonth(autoDeadline.getMonth() + PAY_3_AUTO_DEADLINE_MONTHS_);
  const deadline = manualDeadline || autoDeadline;
  const rowKey = participant.telegram_id + ":pay_3";
  const existing = findRow("Payments", "pay_row_key", rowKey);
  const label = "Оплата 3";

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
    label: label,
    amount: amount,
    currency: "USD",
    deadline: deadline ? Utilities.formatDate(deadline, "GMT+5", "yyyy-MM-dd") : "",
    status: status,
    paid_date: paidDate,
  });
  if (status === "paid" && (!existing || existing.status !== "paid")) {
    notifyPaymentPaid_(participant, label);
  }
}

/* ---------------------------------- visa info ---------------------------------- */

/**
 * ДАТА ВИЗОВОГО ИНТЕРВЬЮ ИЗ amoCRM (22.09.2026).
 *
 * Лист VisaInfo был пуст с самого начала: его читали в трёх местах
 * (обратный отсчёт, экран визы, статусы сборов), но не писал никто. Теперь
 * источник — поля сделки:
 *   FIELD_ID_VISA_INTERVIEW_DATE  — дата (обязательно, без неё ничего не пишем)
 *   FIELD_ID_VISA_INTERVIEW_TIME  — текст «10:30» (необязательно)
 *   FIELD_ID_VISA_LOCATION        — текст (необязательно)
 *   FIELD_ID_VISA_RESULT          — список: содержит «Одобр» → approved,
 *                                   «Отказ» → denied, иначе pending
 * Пока Script Property с id поля даты не задан — функция ничего не делает.
 * Остальные колонки VisaInfo (паспорт, сборы) не трогаем — у них пока нет
 * источника, и затирать их пустотой нельзя.
 */
function syncVisaInfoFromDeal_(deal, participant) {
  const dateFieldId = CFG_OPTIONAL("FIELD_ID_VISA_INTERVIEW_DATE", "");
  if (!dateFieldId) return;

  const appointment = parseAmoDate_(customFieldValue(deal, dateFieldId));
  const timeFieldId = CFG_OPTIONAL("FIELD_ID_VISA_INTERVIEW_TIME", "");
  const locationFieldId = CFG_OPTIONAL("FIELD_ID_VISA_LOCATION", "");
  const resultFieldId = CFG_OPTIONAL("FIELD_ID_VISA_RESULT", "");

  const existing = findRow("VisaInfo", "telegram_id", participant.telegram_id);
  const data = { telegram_id: participant.telegram_id };

  if (appointment) data.appointment_date = Utilities.formatDate(appointment, "GMT+5", "yyyy-MM-dd");
  if (timeFieldId) {
    const t = customFieldValue(deal, timeFieldId);
    if (t) data.appointment_time = String(t);
  }
  if (locationFieldId) {
    const loc = customFieldValue(deal, locationFieldId);
    if (loc) data.location = String(loc);
  }
  if (resultFieldId) {
    const raw = String(customFieldValue(deal, resultFieldId) || "").toLowerCase();
    if (raw.indexOf("одобр") !== -1) data.result = "approved";
    else if (raw.indexOf("отказ") !== -1) data.result = "denied";
    else if (raw) data.result = "pending";
  }
  // Паспорт и сборы (22.09.2026): три поля сделки, опциональные.
  //   FIELD_ID_PASSPORT_STATUS — список: «Готов»/«В посольстве»/… → ready | at_embassy | waiting
  //   FIELD_ID_SEVIS_PAID, FIELD_ID_VISA_FEE_PAID — флажок/список «Да» → paid, иначе unpaid
  const passportFieldId = CFG_OPTIONAL("FIELD_ID_PASSPORT_STATUS", "");
  if (passportFieldId) {
    const raw = String(customFieldValue(deal, passportFieldId) || "").toLowerCase();
    if (raw.indexOf("готов") !== -1 || raw.indexOf("получ") !== -1) data.passport_status = "ready";
    else if (raw.indexOf("посол") !== -1) data.passport_status = "at_embassy";
    else if (raw) data.passport_status = "waiting";
  }
  const paidFlag = (prop) => {
    const id = CFG_OPTIONAL(prop, "");
    if (!id) return null;
    const raw = customFieldValue(deal, id);
    if (raw === null || raw === undefined || raw === "") return null;
    const str = String(raw).toLowerCase();
    return raw === true || str === "true" || str === "1" || str === "да" || str === "оплач" || str.indexOf("оплачен") !== -1 ? "paid" : "unpaid";
  };
  const sevis = paidFlag("FIELD_ID_SEVIS_PAID"); if (sevis) data.sevis_fee_status = sevis;
  const visaFee = paidFlag("FIELD_ID_VISA_FEE_PAID"); if (visaFee) data.visa_fee_status = visaFee;

  // Ничего нового — не пишем (иначе каждый вебхук делал бы лишнюю запись).
  const keys = Object.keys(data).filter((k) => k !== "telegram_id");
  if (!keys.length) return;
  // Дата из листа приходит объектом Date — сравниваем в одном формате.
  const same = (k) => {
    const cur = existing[k];
    const curStr = k === "appointment_date" && cur ? formatSheetDate_(cur) : String(cur || "");
    return curStr === String(data[k]);
  };
  if (existing && keys.every(same)) return;

  if (existing) updateRow("VisaInfo", existing._row, data);
  else appendRow("VisaInfo", data);
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

    // НЕ ОТКАТЫВАЕМ СВЕЖУЮ ЗАГРУЗКУ СТУДЕНТА (02.09.2026).
    //
    // Сценарий, который ломался. Студент загрузил исправленный документ →
    // uploadDocument_ поставил статус "review" («на проверке»). Но в карточке
    // amoCRM у координатора ещё стоит «Нужна корректировка» — он же файл ещё
    // не смотрел. Любое следующее изменение сделки давало вебхук, и эта ветка
    // перезаписывала "review" обратно в "need". Загрузка исчезала из
    // интерфейса, студент видел тот же красный статус и грузил файл заново.
    //
    // Правило: пока документ ждёт проверки, вебхук может только ПОДТВЕРДИТЬ
    // приёмку ("Принято" в amoCRM — это решение координатора, оно новее).
    // Повторное «нужна корректировка» из CRM в этот момент — просто эхо
    // старого значения поля, и его мы игнорируем.
    if (existing && existing.status === "review" && status === "need") return;

    const updated = {
      telegram_id: participant.telegram_id,
      doc_id: cfg.docId,
      type: cfg.type,
      status: status,
      note: status === "ok" ? "Принято координатором" : "Нужна корректировка — свяжитесь с координатором",
      // При приёмке чистим старый комментарий: иначе рядом со статусом
      // «Принято» продолжало висеть прошлое «переснимите страницу 2».
      coordinator_comment: status === "ok" ? "" : (existing && existing.coordinator_comment) || "",
      updated_at: new Date(),
    };
    if (existing) {
      updateRow("Documents", existing._row, updated);
    } else {
      appendRow("Documents", Object.assign({ coordinator_comment: "" }, updated));
    }
  });
}
