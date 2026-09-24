/**
 * Single Web App entry point. Deploy this project (Deploy → New deployment →
 * Web app, execute as "Me", access "Anyone") and you get one URL that
 * handles everything via ?action=... :
 *
 *   GET  ?action=state&initData=...            -> combined participant state (see stateForUser_)
 *   POST ?action=uploadDocument  body:{initData, docId, fileName}
 *   POST ?action=support         body:{initData, message}
 *   POST ?action=toggleChecklist body:{initData, itemId}
 *   POST ?action=link            body:{initData, token}
 *   GET  ?action=events&initData=...             -> this student's event invitations (see Events.gs)
 *   POST ?action=respondEvent    body:{initData, groupId, choice, chosenEventId}
  * POST ?action=confirmVisaReady body:{initData} -> Final Call: student confirms visa readiness; notifies coordinator via amoCRM task (idempotent, see confirmVisaReady_)
 *   GET/POST ?action=amoWebhook&secret=...       -> amoCRM webhook receiver (Webhooks.gs)
 *   GET  ?action=amoOauthCallback&code=...        -> one-time amoCRM OAuth callback (AmoCRM.gs)
 *   GET  ?action=adminCreateLink&dealId=...&secret=<ADMIN_SECRET> -> ready-to-send
 *        Telegram linking link (+ the deal's phone, if amoCRM has one) for
 *        one amoCRM deal (used by admin.html — see SETUP.md §5.3)
 *   GET  ?action=adminListParticipants&secret=<ADMIN_SECRET>       -> name list for admin-events.html
 *   GET  ?action=adminListAllParticipants&secret=<ADMIN_SECRET>    -> full "who's using the app" list
 *        (name, stage, joined/last-active dates) for admin-users.html
 *   GET  ?action=adminListUnlinkedDeals&secret=<ADMIN_SECRET>      -> deals with no Telegram link yet, for admin.html
 *   POST ?action=adminCreateEvent&secret=<ADMIN_SECRET>  body:{title, description, location, slots:[{date,time,capacity}], telegramIds:[...], roadmapStageId?}
 *        -> creates the event slot(s), invites the given students, sends the Telegram notification (admin-events.html)
 *   POST ?action=adminSendWhatsApp&secret=<ADMIN_SECRET>  body:{phone, text}
 *        -> sends `text` as a WhatsApp message to `phone` through Wazzup24, using
 *           the same channel/number coordinators already chat with clients from
 *           inside amoCRM (used by admin.html — see SETUP.md §5.4)
 *
 * IMPORTANT CORS gotcha: Apps Script Web Apps don't implement CORS preflight
 * (OPTIONS). GET requests work fine cross-origin. For POST, the frontend
 * must send the body as `Content-Type: text/plain` (NOT application/json) —
 * see js/services/liveApi.js — otherwise the browser's preflight OPTIONS
 * request will fail with no response.
 */

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(err) {
  const message = err && err.message ? err.message : String(err);
  const status = message.indexOf("UNAUTHORIZED") === 0 ? 401 : 400;
  return jsonOutput_({ error: message, status: status });
}

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === "amoOauthCallback") {
      // ЗАКРЫТО ПАРОЛЕМ (02.09.2026). Это был единственный роут во всём API без
      // какой-либо проверки, а адрес бэкенда лежит открытым текстом в
      // js/services/config.js на GitHub Pages — то есть дёрнуть его мог кто угодно.
      // При неверном code в ответ уходил полный текст ошибки amoCRM (готовая
      // справка по вашей интеграции), а при валидном — storeAmoTokens_
      // безусловно перезаписывал AMO_ACCESS_TOKEN в Script Properties чужим
      // токеном, после чего вся синхронизация вставала с 401 до ручного
      // восстановления. Обмен кода на токен делает координатор при настройке,
      // поэтому пароль администратора здесь уместен и ничего не ломает.
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      exchangeAmoAuthCode(e.parameter.code);
      return HtmlService.createHtmlOutput("<h3>amoCRM подключён. Можно закрыть эту вкладку.</h3>");
    }

    if (action === "amoWebhook") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("WEBHOOK_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(handleAmoWebhook(e.parameter));
    }

    if (action === "state") {
      const user = requireTelegramUser_(e.parameter.initData);
      return jsonOutput_(stateForUser_(user));
    }

    if (action === "events") {
      const user = requireTelegramUser_(e.parameter.initData);
      return jsonOutput_(getEventsForUser_(String(user.id)));
    }

    if (action === "adminListParticipants") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(adminListParticipants_());
    }

    if (action === "adminListAllParticipants") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(adminListAllParticipants_());
    }

    if (action === "adminCreateLink") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      const dealId = e.parameter.dealId;
      if (!dealId) return jsonOutput_({ error: "dealId required" });
      // ПРОВЕРКА СДЕЛКИ ДО СОЗДАНИЯ ТОКЕНА (14.09.2026).
      //
      // Раньше токен выписывался первой же строкой, без единой проверки, а
      // getDeal() вызывался ниже и только ради телефона -- причём его ошибка
      // намеренно проглатывалась. В итоге любой мусор в поле "ID сделки" в
      // admin.html (например случайно вставленное имя) давал координатору
      // рабочую ссылку на несуществующую сделку.
      //
      // Ловушка: amoCRM на несуществующий ID отвечает НЕ 404, а 204 с пустым
      // телом. getDeal() поэтому не бросает исключение, а тихо возвращает
      // null -- отсюда отдельная проверка на пустой результат, одной только
      // try/catch здесь недостаточно.
      if (!/^\d+$/.test(String(dealId))) {
        return jsonOutput_({ error: "dealId должен быть числовым ID сделки amoCRM" });
      }
      const deal = getDeal(dealId);
      if (!deal) {
        return jsonOutput_({ error: "Сделка " + dealId + " не найдена в amoCRM" });
      }
      const token = createLinkToken(dealId);
      const botUsername = CFG("TELEGRAM_BOT_USERNAME");
      const appName = CFG("TELEGRAM_APP_NAME");
      const link = "https://t.me/" + botUsername + "/" + appName + "?startapp=link_" + token;
      // Best-effort: also hand back the client's phone (straight from amoCRM,
      // not from the Participants sheet -- works even for a brand-new deal
      // the webhook hasn't synced yet) so admin.html can offer a one-click
      // "send in WhatsApp" button instead of copy-paste. A failure here
      // (no linked contact, no phone field, amoCRM hiccup) must not break
      // link creation itself -- the coordinator can still copy the link.
      let phone = null;
      try {
        phone = contactPhoneForDeal_(deal);
      } catch (err) {
        Logger.log("adminCreateLink: could not fetch phone for deal %s: %s", dealId, err);
      }
      return jsonOutput_({ link: link, dealId: dealId, token: token, phone: phone });
    }

    if (action === "adminListUnlinkedDeals") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(adminListUnlinkedDeals_());
    }

    // admin-events.html, вкладка «Посещаемость» (22.09.2026).
    if (action === "adminListInvitations") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(adminListInvitations_());
    }

    // Автопривязка из amoCRM (Salesbot/вебхук на этап) — см. autoLinkDeal_.
    if (action === "autoLink") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("WEBHOOK_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(autoLinkDeal_(e.parameter.dealId || e.parameter["leads[status][0][id]"] || e.parameter["leads[add][0][id]"]));
    }

    return jsonOutput_({ error: "unknown action" });
  } catch (err) {
    reportApiError_(e, err);
    return errorOutput_(err);
  }
}

/**
 * АВТОПРИВЯЗКА БЕЗ КООРДИНАТОРА (22.09.2026).
 *
 * Сейчас, чтобы студент попал в приложение, координатор открывает admin.html,
 * находит сделку, жмёт «создать ссылку» и «отправить в WhatsApp». Этот роут
 * делает то же самое сам, когда его дёргает amoCRM: Salesbot на шаге
 * «Оформлен» (или обычный вебхук на смену этапа) вызывает
 *   {BACKEND_URL}?action=autoLink&secret={WEBHOOK_SECRET}&dealId={{lead.id}}
 * — бэкенд проверяет сделку, выписывает одноразовую ссылку и отправляет её
 * клиенту через Wazzup тем же каналом WhatsApp, что и вся переписка.
 *
 * Защита от повторов: если у сделки уже привязан Telegram — ничего не шлём;
 * если за последние 72 часа для этой сделки уже выписывалась живая ссылка —
 * тоже (иначе каждое движение сделки дублировало бы сообщение). Секрет —
 * WEBHOOK_SECRET, не ADMIN_SECRET: он и так уже лежит в настройках amoCRM.
 */
/**
 * ТЕКСТ ПРИГЛАШЕНИЯ (23.09.2026, формулировка владельца). Без имени —
 * имена в amoCRM вбиты вручную, на русском и казахском, с ошибками.
 * Тот же текст уходит из Salesbot, из bulkAutoLink и из admin.html.
 */
function autoLinkMessage_(link) {
  return [
    "Здравствуйте! На связи ABC Universe 👋",
    "",
    "У вас теперь есть личный помощник по программе Work & Travel USA — приложение в Telegram. Там всегда видно, на каком вы этапе и что делать дальше, когда и сколько платить, какие документы нужны, когда ближайший брифинг. Мы напомним о каждом дедлайне, чтобы ничего не пропустить.",
    "",
    "Подключение за 10 секунд — просто откройте ссылку в Telegram:",
    link,
    "",
    "Это первая версия приложения — если встретите ошибку или что-то будет работать не так, не пугайтесь. Актуальную информацию по вашей программе всегда можно уточнить у координатора. А если поделитесь впечатлениями и замечаниями о приложении — будем очень рады.",
  ].join("\n");
}

function autoLinkDeal_(dealId) {
  if (!dealId || !/^\d+$/.test(String(dealId))) return { error: "dealId required (numeric)" };
  dealId = String(dealId);

  const participant = findRow("Participants", "amo_deal_id", dealId);
  if (participant && participant.telegram_id) return { skipped: true, reason: "already linked" };

  const alive = getRows("LinkTokens").some(
    (t) => String(t.amo_deal_id) === dealId && t.used !== "yes" && t.expires_at && new Date(t.expires_at).getTime() > Date.now()
  );
  if (alive) return { skipped: true, reason: "active link already sent" };

  const deal = getDeal(dealId);
  if (!deal) return { error: "Сделка " + dealId + " не найдена в amoCRM" };

  const phone = contactPhoneForDeal_(deal);
  if (!phone) {
    try { createCoordinatorTask(dealId, "Автопривязка к приложению: у контакта нет телефона — отправьте ссылку вручную через admin.html.", 24, deal.responsible_user_id); } catch (err) { Logger.log("autoLink task failed: %s", err); }
    return { error: "no phone on contact", dealId: dealId };
  }

  const token = createLinkToken(dealId);
  const link = "https://t.me/" + CFG("TELEGRAM_BOT_USERNAME") + "/" + CFG("TELEGRAM_APP_NAME") + "?startapp=link_" + token;
  const text = autoLinkMessage_(link);

  const result = sendWazzupWhatsApp_(phone, text);
  addDealNote_(dealId, "🔗 Ссылка на подключение к приложению отправлена в WhatsApp автоматически (" + phone + ").");
  logEvent("", "amocrm_autolink", "link_sent", "", dealId);
  return { ok: true, dealId: dealId, phone: phone, wazzup: result };
}

function doPost(e) {
  try {
    const action = e.parameter.action;

    // amoCRM's classic webhook posts form-urlencoded data with action/secret
    // in the query string and the payload in the form body (merged into
    // e.parameter by Apps Script automatically).
    if (action === "amoWebhook") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("WEBHOOK_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(handleAmoWebhook(e.parameter));
    }

    // amoCRM шлёт вебхуки POST-ом — тот же роут, что и в doGet (см. autoLinkDeal_).
    if (action === "autoLink") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("WEBHOOK_SECRET"))) return jsonOutput_({ error: "bad secret" });
      return jsonOutput_(autoLinkDeal_(e.parameter.dealId || e.parameter["leads[status][0][id]"] || e.parameter["leads[add][0][id]"]));
    }

    // admin-events.html: coordinator-only, protected by ADMIN_SECRET in the
    // query string (same pattern as adminCreateLink) instead of a Telegram
    // initData check — this call isn't coming from inside the Mini App.
    if (action === "adminCreateEvent") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      return jsonOutput_(adminCreateEventAndInvite_(body));
    }

    // admin-events.html, вкладка «Посещаемость»: отметка «был / не был».
    if (action === "adminSetAttendance") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      return jsonOutput_(adminSetAttendance_(body));
    }

    // admin.html: sends the ready-made linking message straight to the
    // client's WhatsApp via Wazzup, through the same channel/number the
    // coordinator already uses inside amoCRM's imBox -- no separate
    // WhatsApp Web session, no copy-paste.
    if (action === "adminSendWhatsApp") {
      if (!timingSafeEqual_(e.parameter.secret, CFG("ADMIN_SECRET"))) return jsonOutput_({ error: "bad secret" });
      const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      if (!body.phone) return jsonOutput_({ error: "phone required" });
      if (!body.text) return jsonOutput_({ error: "text required" });
      return jsonOutput_(sendWazzupWhatsApp_(body.phone, body.text));
    }

    // Everything else: our own Mini App, sent as a text/plain JSON body
    // (see CORS note above).
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const user = requireTelegramUser_(body.initData);

    switch (action) {
      case "uploadDocument":
        return jsonOutput_(uploadDocument_(user, body.docId, body.fileName));
      case "support":
        return jsonOutput_(submitSupport_(user, body.message));
      case "toggleChecklist":
        return jsonOutput_(toggleChecklistItem_(user, body.itemId));
      case "link":
        return jsonOutput_({ amoDealId: consumeLinkToken(body.token, String(user.id), user) });
      case "respondEvent":
        return jsonOutput_(respondToEvent_(user, body.groupId, body.choice, body.chosenEventId));
      case "confirmVisaReady":
        return jsonOutput_(confirmVisaReady_(user));
      case "confirmJobOffer":
        return jsonOutput_(confirmJobOffer_(user));
      case "clientError":
        return jsonOutput_(clientError_(user, body));
      default:
        return jsonOutput_({ error: "unknown action" });
    }
  } catch (err) {
    reportApiError_(e, err);
    return errorOutput_(err);
  }
}

/* --------------------------------- handlers --------------------------------- */

function stateForUser_(telegramUser) {
  const telegramId = String(telegramUser.id);
  // ensureParticipantRow_ already looked this row up (or just wrote it) —
  // reuse that instead of reading the Participants sheet a second time.
  const participantRow = ensureParticipantRow_(telegramId, telegramUser) || {};
  const documents = findRows("Documents", "telegram_id", telegramId).map((d) => ({
    id: d.doc_id,
    type: d.type,
    status: d.status,
    updatedAt: d.updated_at ? formatSheetDate_(d.updated_at) : null,
    note: d.note,
    coordinatorComment: d.coordinator_comment || null,
  }));
  const paymentRows = findRows("Payments", "telegram_id", telegramId);
  const payments = mergeWithDefaultPayments_(paymentRows);
  // ЛИСТ Briefings НЕ ЧИТАЕМ (22.09.2026). Он пуст с момента создания и
  // ничем не заполняется — брифинги живут в Events/EventInvitations. Это
  // было одно из восьми обращений к Sheets на каждый запрос state, впустую.
  // Фронтенд ждёт массив — отдаём пустой; вернуть чтение можно одной строкой,
  // если у листа появится источник.
  const briefings = [];
  const visaRow = findRow("VisaInfo", "telegram_id", telegramId) || {};
  const checklist = findRows("PreDepartureChecklist", "telegram_id", telegramId).map((c) => ({
    id: c.item_id,
    label: c.label,
    done: c.done === "yes",
  }));

  return {
    participant: {
      id: telegramId,
      name: participantRow.name || telegramUser.first_name || "",
      // Имя для обращения — из контакта amoCRM (Webhooks.gs), не из
      // названия сделки. Пусто → фронтенд здоровается без имени.
      firstName: participantRow.first_name || "",
      fullName: participantRow.full_name || "",
      // ОДНОРАЗОВЫЕ КНОПКИ (22.09.2026). Флаги «уже нажато» хранились в
      // Participants, но во state не отдавались — после перезахода кнопки
      // «У меня есть Job Offer» / «Я готов(а) к визе» снова были активны, и
      // каждое нажатие уходило координатору новой задачей. Теперь фронтенд
      // рисует их серыми и неактивными, если флаг стоит.
      visaReadyConfirmed: participantRow.visa_ready_confirmed === "yes",
      jobOfferReadyConfirmed: participantRow.job_offer_ready_confirmed === "yes",
      program: participantRow.program || "SELF",
      season: participantRow.season || "",
      cieeId: participantRow.ciee_id || "Будет добавлен после интеграции",
      telegramConnected: true,
      // "enrollment_date" isn't its own tracked field anywhere in this
      // backend (no sync path or admin UI ever writes it) -- created_at
      // (set once, the first time this telegram_id ever opens the app) is
      // the closest real signal we actually have, so fall back to it
      // rather than always sending an empty string.
      enrollmentDate: formatSheetDate_(participantRow.enrollment_date || participantRow.created_at),
      // Tracked (per participant) purely for Reminders.gs's own 2d/1d/0d CIEE
      // activation nudges (sendCieeActivationReminders_) -- never previously
      // sent to the frontend, so statusDetail.js's "Осталось X дней" countdown
      // was hardcoded to a fake constant (stage.deadlineDays - 1) that never
      // moved regardless of when registration actually happened. Surfacing
      // the real date lets deriveStageDetail() compute the same real
      // countdown client-side (see js/services/deriveViews.js).
      cieeRegistrationDate: participantRow.ciee_registration_date ? formatSheetDate_(participantRow.ciee_registration_date) : null,
      // Реальная причина "требуются исправления" по Job Offer (08.09.2026,
      // см. Webhooks.gs) — координатор пишет её в amoCRM, синкается сюда как
      // есть. null, а не "", когда пусто: deriveStageDetail на фронтенде
      // проверяет именно truthy-значение перед тем как показать карточку.
      jobProblemComment: participantRow.job_problem_comment || null,
    },
    coordinator: {
      name: participantRow.coordinator_name || CFG_OPTIONAL("DEFAULT_COORDINATOR_NAME", ""),
      role: "Координатор SELF",
      telegramUsername: participantRow.coordinator_tg || CFG_OPTIONAL("DEFAULT_COORDINATOR_TG", ""),
      avatarUrl: participantRow.coordinator_avatar_url || "",
    },
    currentStageId: participantRow.current_stage_id || "ENROLLED",
    documents: documents,
    payments: payments,
    // Fixed reference total (Payment 1 is pure KZT with no $ figure, so it
    // can't be computed by summing the payments — see Webhooks.gs). Change
    // the PROGRAM_COST_USD Script Property if the program price changes.
    programCost: Number(CFG_OPTIONAL("PROGRAM_COST_USD", 2850)),
    visaFees: [
      { id: "fee_sevis", label: "SEVIS Fee", amount: 35, status: visaRow.sevis_fee_status || "locked" },
      { id: "fee_visa", label: "Visa Fee", amount: 185, status: visaRow.visa_fee_status || "locked" },
    ],
    briefings: briefings,
    visaInfo: {
      appointmentDate: visaRow.appointment_date ? formatSheetDate_(visaRow.appointment_date) : null,
      appointmentTime: visaRow.appointment_time ? formatSheetTime_(visaRow.appointment_time) : null,
      location: visaRow.location || null,
      result: visaRow.result || "pending",
      passportStatus: visaRow.passport_status || "waiting",
    },
    preDepartureChecklist: checklist,
    attendedRoadmapStageIds: attendedRoadmapStageIds_(telegramId),
    // Курс USD/KZT Нацбанка РК — для ориентировочной суммы в тенге у платежей
    // 2/3 (22.09.2026). null, если фид недоступен — экран тогда молчит.
    fxRate: nbkUsdRate_(),
    // Даты попадания на этапы (из EventLog) — подписи на пройденных этапах.
    stageDates: stageDatesFor_(telegramId),
  };
}

/**
 * КУРС НАЦБАНКА РК (22.09.2026, по просьбе владельца).
 *
 * Официальный фид: https://nationalbank.kz/rss/rates_all.xml — XML со
 * всеми валютами, у USD котировка за 1 доллар. Тянем не чаще раза в 6 часов
 * (CacheService общий на весь скрипт), при любой ошибке отдаём null и не
 * ломаем state. Возвращает { usdKzt: 535.12, date: "22.09.2026", url }.
 */
const NBK_RATES_URL_ = "https://nationalbank.kz/rss/rates_all.xml";
const NBK_PAGE_URL_ = "https://nationalbank.kz/ru/exchangerates/ezhednevnye-oficialnye-rynochnye-kursy-valyut";
function nbkUsdRate_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("nbk_usd_kzt");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* перечитаем */ }
  }
  try {
    const resp = UrlFetchApp.fetch(NBK_RATES_URL_, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return null;
    const xml = resp.getContentText("UTF-8");
    // Берём блок <item> с <title>USD</title>, теги внутри читаем по отдельности —
    // их порядок в фиде (title/pubDate/description/quant) не фиксирован.
    const item = xml.match(/<item>(?:(?!<\/item>)[\s\S])*?<title>\s*USD\s*<\/title>[\s\S]*?<\/item>/);
    if (!item) return null;
    const tag = (name) => { const mm = item[0].match(new RegExp("<" + name + ">([^<]*)<\\/" + name + ">")); return mm ? mm[1].trim() : ""; };
    const rate = Number(tag("description").replace(",", ".")) / (Number(tag("quant")) || 1);
    const pub = tag("pubDate");
    if (!rate || !isFinite(rate)) return null;
    const result = { usdKzt: Math.round(rate * 100) / 100, date: pub, url: NBK_PAGE_URL_ };
    cache.put("nbk_usd_kzt", JSON.stringify(result), 6 * 3600);
    return result;
  } catch (err) {
    Logger.log("nbkUsdRate_ failed: %s", err);
    return null;
  }
}

function stripRowMeta_(row) {
  const copy = Object.assign({}, row);
  delete copy._row;
  return copy;
}

const DEFAULT_DOCUMENT_TYPES = ["Паспорт", "Свидетельство о рождении", "Справка об обучении", "Фото", "Транскрипт"];
const DEFAULT_CHECKLIST_ITEMS = [
  "Visa", "DS-2019", "Passport", "Flight",
  "Insurance / необходимые документы", "Необходимые деньги",
  "Документы распечатаны", "Pre-Departure Briefing",
];

/**
 * ЗАСЕВ ДОКУМЕНТОВ И ЧЕК-ЛИСТА (02.09.2026).
 *
 * Раньше эти строки создавались ВНУТРИ ветки «создаём нового участника» в
 * ensureParticipantRow_. Из-за этого студент, пришедший по ссылке от
 * координатора, не получал их вообще: к моменту первого запроса state его
 * строка уже существовала (её только что создала или дополнила привязка),
 * поэтому ветка создания не выполнялась. Документы потом подтягивались из
 * amoCRM вебхуком, а вот чек-лист подготовки к вылету брать неоткуда — он
 * оставался ПУСТЫМ у всех, кто пришёл нормальным путём, по ссылке.
 *
 * Теперь засев вынесен отдельно и идемпотентен: проверяет, есть ли уже строки,
 * и досевает только недостающее. Вызывается из обоих мест — и при создании
 * участника, и после успешной привязки по ссылке.
 */
function seedParticipantDefaults_(telegramId) {
  const документы = findRows("Documents", "telegram_id", telegramId);
  if (!документы.length) {
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
  }
  const чеклист = findRows("PreDepartureChecklist", "telegram_id", telegramId);
  if (!чеклист.length) {
    DEFAULT_CHECKLIST_ITEMS.forEach((label, i) => {
      appendRow("PreDepartureChecklist", {
        telegram_id: telegramId,
        item_id: "chk_" + i,
        label: label,
        done: "",
      });
    });
  }
}

/** First time we see a telegram_id, create its row (unlinked until consumeLinkToken runs)
 * and seed the standard document checklist so the Documents screen isn't empty.
 * Returns the participant row (existing or newly-created) so callers don't
 * have to re-read the Participants sheet right after this. */
// last_activity нужен только для admin-users.html («давно не заходил»).
// Точность в минуты там не нужна — пишем не чаще раза в 15 минут.
const LAST_ACTIVITY_THROTTLE_MS_ = 15 * 60 * 1000;

function ensureParticipantRow_(telegramId, telegramUser) {
  const existing = findRow("Participants", "telegram_id", telegramId);
  if (existing) {
    // ЗАПИСЬ НЕ НА КАЖДЫЙ ЗАПРОС (22.09.2026). Это самый частый вызов в
    // приложении (state), и здесь на каждое открытие делались чтение +
    // запись строки ради отметки активности. Теперь — только если прошлая
    // отметка старше 15 минут: в обычном сеансе это ноль записей.
    const last = existing.last_activity ? new Date(existing.last_activity).getTime() : 0;
    if (!last || Date.now() - last > LAST_ACTIVITY_THROTTLE_MS_) {
      updateRow("Participants", existing._row, { last_activity: new Date() });
      existing.last_activity = new Date();
    }
    return existing;
  }

  // Slow path only, deliberately NOT locked above -- this function runs on
  // every single "state" request (the app's most frequent call), and almost
  // every one of those hits the `existing` branch above with zero lock
  // overhead. Only a telegram_id's very first-ever request reaches here, so
  // this is the one place a lock is worth its cost: without it, two
  // near-simultaneous first opens from the same brand-new user could both
  // pass the check above and both create duplicate Participants/Documents/
  // PreDepartureChecklist rows.
  // ВХОД ТОЛЬКО ПО ССЫЛКЕ ОТ КООРДИНАТОРА (02.09.2026).
  //
  // Раньше здесь безусловно заводился участник: ссылка на бота публичная, и
  // ЛЮБОЙ пользователь Telegram, открывший приложение, получал строку в
  // Participants плюс пять строк документов и восемь пунктов чек-листа. Эти
  // люди попадали в admin-users.html вперемешку с настоящими студентами, и
  // отличить их было нечем.
  //
  // Теперь новая строка появляется только через consumeLinkToken — то есть по
  // персональной ссылке, которую выдал координатор. Все, кто уже привязан,
  // проходят выше по ветке `existing` и ничего не замечают.
  //
  // Код ошибки читает фронтенд (js/router.js) и показывает человеческий экран
  // вместо технического текста.
  throw new Error("NOT_INVITED: доступ к приложению выдаёт координатор");
}

/** Создаёт строку участника — вызывается ТОЛЬКО из consumeLinkToken, то есть
 * когда человек пришёл по персональной ссылке координатора. */
function createParticipantRow_(telegramId, telegramUser) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Система сейчас занята — попробуйте ещё раз через несколько секунд.");
  try {
    const existingRetry = findRow("Participants", "telegram_id", telegramId);
    if (existingRetry) {
      updateRow("Participants", existingRetry._row, { last_activity: new Date() });
      existingRetry.last_activity = new Date();
      return existingRetry;
    }

    const newRow = {
      telegram_id: telegramId,
      name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" "),
      current_stage_id: "ENROLLED",
      created_at: new Date(),
      last_activity: new Date(),
    };
    appendRow("Participants", newRow);
    seedParticipantDefaults_(telegramId);
    return newRow;
  } finally {
    lock.releaseLock();
  }
}

// Payment 1 & 2 are fixed amount/currency (see Webhooks.gs FIXED_PAYMENTS_);
// Payment 3 varies per student, so 0/USD here is just the placeholder shown
// until amoCRM has synced a real amount for that deal.
const DEFAULT_PAYMENT_TEMPLATE = [
  { pay_id: "pay_1", label: "Оплата 1", amount: 200000, currency: "KZT" },
  { pay_id: "pay_2", label: "Оплата 2", amount: 450, currency: "USD" },
  { pay_id: "pay_3", label: "Оплата 3", amount: 0, currency: "USD" },
];

/** Payments sheet only stores rows once amoCRM/coordinator has set something —
 * fill in sane defaults (amount/currency/label) for any not-yet-synced payment. */
function mergeWithDefaultPayments_(rows) {
  return DEFAULT_PAYMENT_TEMPLATE.map((tpl) => {
    const row = rows.find((r) => r.pay_id === tpl.pay_id);
    return {
      id: tpl.pay_id,
      label: tpl.label,
      amount: (row && Number(row.amount)) || tpl.amount,
      currency: (row && row.currency) || tpl.currency,
      deadline: row && row.deadline ? formatSheetDate_(row.deadline) : null,
      status: (row && row.status) || "not_due",
      paidDate: row && row.paid_date ? formatSheetDate_(row.paid_date) : null,
    };
  });
}

function uploadDocument_(telegramUser, docId, fileName) {
  const telegramId = String(telegramUser.id);
  const existing = findRows("Documents", "telegram_id", telegramId).find((d) => d.doc_id === docId);
  const updated = {
    telegram_id: telegramId,
    doc_id: docId,
    status: "review",
    note: "Загружено " + Utilities.formatDate(new Date(), "GMT+5", "d MMMM") + " · на проверке (" + fileName + ")",
    updated_at: new Date(),
  };
  if (existing) {
    updateRow("Documents", existing._row, updated);
  } else {
    appendRow("Documents", Object.assign({ type: docId, coordinator_comment: "" }, updated));
  }
  logEvent(telegramId, "mini_app", "document_uploaded", "", docId);
  noteToDeal_(telegramId, "📎 Студент отметил в приложении загрузку документа «" + ((existing && existing.type) || docId) + "» (" + fileName + "). Файл — в WhatsApp/Telegram, статус в приложении: «на проверке».");
  return updated;
}

/**
 * ДЕЙСТВИЯ СТУДЕНТА — В КАРТОЧКУ СДЕЛКИ (22.09.2026).
 *
 * Координатор работает в amoCRM, а не в Sheets. Всё, что студент делает в
 * приложении, теперь ложится примечанием в таймлайн его сделки. Участник
 * без amo_deal_id (служебные аккаунты) — тихо пропускаем. Ошибка amoCRM
 * никогда не ломает само действие студента (addDealNote_ глотает её).
 */
function noteToDeal_(telegramId, text) {
  const participant = findRow("Participants", "telegram_id", telegramId);
  if (!participant || !participant.amo_deal_id) return;
  addDealNote_(participant.amo_deal_id, text);
}

function submitSupport_(telegramUser, message) {
  const telegramId = String(telegramUser.id);
  // Лист SupportMessages убран 22.09.2026 (решение владельца): сообщение
  // живёт в задаче и примечании amoCRM, след — в EventLog.
  logEvent(telegramId, "mini_app", "support_message", "", message);
  // ЗАДАЧА КООРДИНАТОРУ, А НЕ ТОЛЬКО СТРОКА В ЛИСТЕ (22.09.2026). Лист
  // SupportMessages никто не открывал — за всё время в нём 0 строк не потому,
  // что никто не писал. Теперь сообщение ставит задачу на ответственного по
  // сделке (срок — 4 часа) и дублируется примечанием с полным текстом.
  const participant = findRow("Participants", "telegram_id", telegramId);
  if (participant && participant.amo_deal_id) {
    const short = String(message).length > 120 ? String(message).slice(0, 117) + "…" : String(message);
    try {
      createCoordinatorTask(participant.amo_deal_id, "Вопрос из приложения: " + short, 4);
    } catch (err) {
      Logger.log("submitSupport_: task failed for deal %s: %s", participant.amo_deal_id, err);
    }
    addDealNote_(participant.amo_deal_id, "💬 Сообщение из приложения:\n" + message);
  }
  return { ok: true };
}

function toggleChecklistItem_(telegramUser, itemId) {
  const telegramId = String(telegramUser.id);
  // Reuse the one findRows result instead of re-querying after the write --
  // updateRow() invalidates this sheet's row cache, so a second findRows
  // call here would force a brand-new live Sheets read for no reason: we
  // already know the new value locally.
  const rows = findRows("PreDepartureChecklist", "telegram_id", telegramId);
  const row = rows.find((r) => r.item_id === itemId);
  if (row) {
    row.done = row.done === "yes" ? "" : "yes";
    updateRow("PreDepartureChecklist", row._row, { done: row.done });
  }
  return rows.map((c) => ({
    id: c.item_id,
    label: c.label,
    done: c.done === "yes",
  }));
}

function confirmVisaReady_(telegramUser) {
  const telegramId = String(telegramUser.id);
  const participant = findRow("Participants", "telegram_id", telegramId);
  if (!participant) throw new Error("Участник не найден.");
  if (participant.visa_ready_confirmed === "yes") return { ok: true, alreadyConfirmed: true };
  if (participant.amo_deal_id) {
    createCoordinatorTask(participant.amo_deal_id, "Студент подтвердил готовность к визовому интервью (Final Call) в приложении.", 24);
    addDealNote_(participant.amo_deal_id, "✅ Студент нажал «Я готов(а) к визовому интервью» в приложении.");
  }
  updateRow("Participants", participant._row, { visa_ready_confirmed: "yes" });
  logEvent(telegramId, "mini_app", "visa_ready_confirmed", "", "");
  return { ok: true };
}

/**
 * «У МЕНЯ ЕСТЬ JOB OFFER» — СТРОГО ОДИН РАЗ (22.09.2026).
 *
 * Флаг пишется ДО задачи в amoCRM и под замком: два быстрых нажатия (или
 * два открытых экрана) не дадут две задачи. Повторный вызов отвечает
 * alreadyConfirmed без записи в журнал и без задачи. Задача — на
 * ответственного по сделке; плюс примечание в таймлайн.
 */
function confirmJobOffer_(telegramUser) {
  const telegramId = String(telegramUser.id);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Система сейчас занята — попробуйте ещё раз через несколько секунд.");
  try {
    const participant = findRow("Participants", "telegram_id", telegramId);
    if (!participant) throw new Error("Участник не найден.");
    if (participant.job_offer_ready_confirmed === "yes") return { ok: true, alreadyConfirmed: true };
    updateRow("Participants", participant._row, { job_offer_ready_confirmed: "yes" });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  logEvent(telegramId, "mini_app", "job_offer_ready_confirmed", "", "");
  const participant = findRow("Participants", "telegram_id", telegramId);
  if (participant && participant.amo_deal_id) {
    // АВТОПЕРЕВОД НА «ОБРАТНАЯ СВЯЗЬ» (24.09.2026, решение владельца — так было
    // и до 23.09). Сделка сама переезжает на STATUS_ID_OBRATNAYA_SVYAZ; вебхук
    // amoCRM затем обновит этап в таблице и пришлёт студенту уведомление
    // этапа JOB_SEARCH. Задача координатору — связаться и всё объяснить.
    let moved = false;
    try {
      updateDealStatus_(participant.amo_deal_id, STATUS_ID_OBRATNAYA_SVYAZ);
      moved = true;
    } catch (err) {
      Logger.log("confirmJobOffer_: stage move failed for deal %s: %s", participant.amo_deal_id, err);
    }
    try {
      createCoordinatorTask(
        participant.amo_deal_id,
        moved
          ? "Студент сообщил, что получил Job Offer — сделка автоматически переведена на этап «Обратная связь». Свяжитесь со студентом и всё объясните."
          : "Студент сообщил в приложении, что у него есть Job Offer. Автоперевод на «Обратная связь» не удался — переведите сделку вручную и свяжитесь со студентом.",
        24
      );
    } catch (err) {
      Logger.log("confirmJobOffer_: task failed for deal %s: %s", participant.amo_deal_id, err);
    }
    addDealNote_(participant.amo_deal_id, "🎉 Студент нажал «У меня есть Job Offer» в приложении." + (moved ? " Сделка переведена на «Обратная связь»." : ""));
  }
  return { ok: true };
}


/* ---------------------------- мониторинг ошибок ---------------------------- */

/**
 * ОШИБКИ — ВЛАДЕЛЬЦУ В TELEGRAM (23.09.2026).
 *
 * До этого об ошибке у студента узнавали только от самого студента. Теперь
 * любая необработанная ошибка бэкенда (API, вебхук amoCRM, ночной прогон) и
 * ошибка JavaScript на экране студента (роут clientError) уходят сообщением
 * в чат из Script Property ADMIN_TELEGRAM_ID и строкой в EventLog
 * (source = monitor, event = error).
 *
 * Чтобы не залить чат: одинаковая ошибка (место + первые 80 символов) — не
 * чаще раза в час; всего — не больше 15 сообщений в сутки, остальное только
 * в EventLog. Ожидаемые ответы (неверный секрет, просроченная ссылка,
 * UNAUTHORIZED) не считаются ошибками.
 * Свойство пустое — в Telegram ничего не шлём, EventLog пишется всегда.
 */
function reportError_(where, err, ctx) {
  try {
    const raw = err && err.stack ? String(err.stack) : String((err && err.message) || err);
    const msg = raw.split("\n").slice(0, 3).join(" | ").slice(0, 600);
    const telegramId = (ctx && ctx.telegramId) || "";
    logEvent(telegramId, "monitor", "error", String(where), msg);

    const chatId = CFG_OPTIONAL("ADMIN_TELEGRAM_ID", "");
    if (!chatId) return;
    const cache = CacheService.getScriptCache();
    const sameKey = "err:" + where + ":" + msg.slice(0, 80);
    if (cache.get(sameKey)) return;
    cache.put(sameKey, "1", 3600);
    const dayKey = "err_count:" + Utilities.formatDate(new Date(), "GMT+5", "yyyy-MM-dd");
    const n = Number(cache.get(dayKey) || 0) + 1;
    cache.put(dayKey, String(n), 24 * 3600);
    if (n > 15) return;

    const lines = ["⚠️ <b>Ошибка в приложении</b>", "Где: <code>" + escapeTgHtml_(String(where)) + "</code>"];
    if (telegramId) lines.push("Студент: <code>" + escapeTgHtml_(String(telegramId)) + "</code>" + (ctx.name ? " · " + escapeTgHtml_(ctx.name) : ""));
    if (ctx && ctx.extra) lines.push(escapeTgHtml_(String(ctx.extra).slice(0, 300)));
    lines.push("", "<code>" + escapeTgHtml_(msg) + "</code>");
    if (n === 15) lines.push("", "Лимит 15 сообщений в сутки достигнут — дальше только в EventLog.");
    sendTelegramMessage(chatId, lines.join("\n"));
  } catch (e) {
    Logger.log("reportError_ failed: %s", e);
  }
}

/** Ошибка API: место — имя роута; ожидаемые отказы не репортим. */
function reportApiError_(e, err) {
  const message = String((err && err.message) || err);
  if (/^UNAUTHORIZED|bad secret|unknown action|ссылка (устарела|уже использована|не найдена)|LINK_/i.test(message)) return;
  const action = (e && e.parameter && e.parameter.action) || "?";
  let telegramId = "";
  try {
    const raw = e && e.parameter && e.parameter.initData ? e.parameter.initData
      : (e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents).initData : "");
    const m = raw && decodeURIComponent(raw).match(/"id":(\d+)/);
    if (m) telegramId = m[1];
  } catch (ignore) { /* initData необязателен для отчёта */ }
  reportError_("api:" + action, err, { telegramId: telegramId });
}

/** Экран студента поймал ошибку JavaScript (window.onerror / unhandledrejection). */
function clientError_(user, body) {
  const message = String((body && body.message) || "").slice(0, 300);
  if (!message) return { ok: false };
  const where = "client:" + String((body && body.screen) || "?").slice(0, 40);
  const participant = findRow("Participants", "telegram_id", String(user.id));
  reportError_(where, { message: message, stack: message + "\n" + String((body && body.stack) || "").slice(0, 400) }, {
    telegramId: String(user.id),
    name: participant ? (participant.full_name || participant.name || "") : "",
    extra: (body && body.url ? body.url + " · " : "") + (body && body.ua ? String(body.ua).slice(0, 80) : ""),
  });
  return { ok: true };
}
