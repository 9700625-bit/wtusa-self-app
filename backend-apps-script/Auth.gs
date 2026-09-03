/**
 * Telegram initData validation (per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * and the one-time linking-token flow from ТЗ §58.
 *
 * NEVER trust telegram_id/user data coming from the client without running
 * it through validateInitData() first — that's the whole point of doing
 * this server-side instead of reading window.Telegram.WebApp.initDataUnsafe
 * directly in the browser.
 */

function bytesToHex_(bytes) {
  return bytes
    .map((b) => {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

/**
 * Constant-time string compare -- Apps Script has no built-in equivalent of
 * Node's crypto.timingSafeEqual. A plain `===`/`!==` on a secret short-
 * circuits at the first mismatched character, so how long the comparison
 * takes leaks how many leading characters an attacker's guess got right,
 * letting a hash or shared secret be recovered byte-by-byte over many
 * requests. This always walks the full (longer) length and ORs every
 * mismatch together instead of returning early, so elapsed time doesn't
 * depend on WHERE the strings first differ. Used for the Telegram initData
 * HMAC check below and for ADMIN_SECRET/WEBHOOK_SECRET checks in Api.gs.
 */
function timingSafeEqual_(a, b) {
  a = String(a == null ? "" : a);
  b = String(b == null ? "" : b);
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/**
 * Returns the parsed Telegram user object ({id, first_name, ...}) if
 * `initData` is authentic and fresh, or null otherwise.
 * @param {string} initData - raw initData string as sent by the Mini App client.
 * @param {number} maxAgeSeconds - reject initData older than this (replay protection).
 */
function validateInitData(initData, maxAgeSeconds) {
  if (!initData) return null;

  // ОКНО ЖИЗНИ СТРОКИ ВХОДА (02.09.2026). Было 86400 — целые сутки. Строка
  // initData подписана ботом и заменяет собой пароль: любой, кто её получил —
  // из журнала выполнений Apps Script (пароль и initData уходят в АДРЕСЕ
  // запроса), со скриншота, с расшаренного экрана, — целые сутки читал карточку
  // студента и мог писать от его имени. Подделывать ничего не требовалось:
  // подпись остаётся валидной, пока данные не менялись.
  //
  // Telegram рекомендует минуты. Ставим шесть часов — это сокращает окно
  // вчетверо и при этом покрывает любой реальный сеанс: клиент Telegram
  // выдаёт свежую строку при КАЖДОМ открытии приложения, поэтому истечь она
  // может только у того, кто оставил приложение открытым полдня и вернулся к
  // нему. Такой человек увидит понятный экран «Нужно переоткрыть приложение»
  // (router.js), а не техническую ошибку, как было раньше.
  maxAgeSeconds = maxAgeSeconds || 6 * 3600;

  const pairs = initData.split("&").map((p) => {
    const idx = p.indexOf("=");
    return [decodeURIComponent(p.slice(0, idx)), decodeURIComponent(p.slice(idx + 1))];
  });

  const hashPair = pairs.find((p) => p[0] === "hash");
  if (!hashPair) return null;
  const receivedHash = hashPair[1];

  const dataCheckString = pairs
    .filter((p) => p[0] !== "hash")
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map((p) => p[0] + "=" + p[1])
    .join("\n");

  const botToken = CFG("TELEGRAM_BOT_TOKEN");
  const secretKeyBytes = Utilities.computeHmacSha256Signature(botToken, "WebAppData");
  const dataCheckBytes = Utilities.newBlob(dataCheckString).getBytes();
  const computedHashBytes = Utilities.computeHmacSha256Signature(dataCheckBytes, secretKeyBytes);
  const computedHash = bytesToHex_(computedHashBytes);

  if (!timingSafeEqual_(computedHash, receivedHash)) return null;

  const authDatePair = pairs.find((p) => p[0] === "auth_date");
  if (authDatePair) {
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(authDatePair[1]);
    if (ageSeconds > maxAgeSeconds) return null; // stale — reject replay
  }

  const userPair = pairs.find((p) => p[0] === "user");
  const startParamPair = pairs.find((p) => p[0] === "start_param");
  return {
    user: userPair ? JSON.parse(userPair[1]) : null,
    startParam: startParamPair ? startParamPair[1] : null,
  };
}

/** Convenience wrapper used by every API handler in Api.gs. Throws on failure. */
function requireTelegramUser_(initData) {
  const parsed = validateInitData(initData);
  if (!parsed || !parsed.user || !parsed.user.id) {
    throw new Error("UNAUTHORIZED: invalid or missing Telegram initData");
  }
  return parsed.user;
}

/* -------------------------- one-time linking tokens (§58) -------------------------- */

/** Called by a coordinator (manually, or from a small internal tool) to generate
 * a personal link for a participant: https://t.me/<bot>/<app>?startapp=<token> */
function createLinkToken(amoDealId) {
  const token = Utilities.getUuid();
  const ttlHours = Number(CFG_OPTIONAL("LINK_TOKEN_TTL_HOURS", "72"));
  appendRow("LinkTokens", {
    token: token,
    amo_deal_id: amoDealId,
    expires_at: new Date(Date.now() + ttlHours * 3600 * 1000),
    used: "no",
  });
  return token;
}

/** Consumes a token once: validates it's unused & unexpired, marks it used,
 * and links telegram_id -> amo_deal_id in Participants. Returns the deal id. */
function consumeLinkToken(token, telegramId, telegramUser) {
  // Same check-then-write race as respondToEvent_ in Events.gs: without a
  // lock, two near-simultaneous requests with the same one-time token could
  // both read used="no" before either writes, letting the token be consumed
  // twice. This only runs once per participant (account linking), so the
  // lock costs nothing on the app's actual hot path (the "state" request).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Система сейчас занята — попробуйте ещё раз через несколько секунд.");
  try {
    const row = findRow("LinkTokens", "token", token);
    if (!row) throw new Error("Unknown linking token");
    if (row.used === "yes") throw new Error("Linking token already used");
    // Срок жизни токена. Проверка написана «от обратного» намеренно: если
    // ячейка expires_at пуста или не разобралась в дату, getTime() даёт NaN, а
    // NaN < Date.now() — это false, то есть прежняя запись считала такой токен
    // ВЕЧНЫМ. Теперь непонятная дата означает «просрочен»: одноразовый доступ к
    // чужой сделке безопаснее закрыть, чем оставить открытым навсегда.
    const expiresAt = new Date(row.expires_at).getTime();
    if (!(expiresAt > Date.now())) throw new Error("Linking token expired");

    updateRow("LinkTokens", row._row, { used: "yes" });

    // ПРИВЯЗКА К СУЩЕСТВУЮЩЕЙ СТРОКЕ, А НЕ СОЗДАНИЕ ВТОРОЙ (02.09.2026).
    //
    // Здесь стояло upsertRow("Participants", "telegram_id", ...) — поиск строки
    // по telegram_id. Но строка участника к этому моменту УЖЕ ЕСТЬ: её создал
    // вебхук из amoCRM, и лежит она под ключом amo_deal_id с пустым telegram_id
    // (Webhooks.gs пишет Participants именно по amo_deal_id). Поиск по
    // telegram_id её не находил, и upsertRow дописывал в конец листа ВТОРУЮ
    // строку про того же человека.
    //
    // Дальше ломалось всё, что ищет участника по сделке, потому что findRow
    // возвращает первое совпадение — то есть строку-сироту без telegram_id:
    //   • платежи и документы не синхронизировались вообще (Webhooks.gs);
    //   • новый этап писался в сироту, а приложение читает строку по
    //     telegram_id — у студента навсегда оставалось «Оформились»;
    //   • уведомления о смене этапа не отправлялись («No linked Telegram account»);
    //   • сделка продолжала висеть в списке непривязанных у координатора.
    // Снаружи это выглядело как работающее приложение, которое просто никогда
    // ничего не обновляет.
    //
    // ВТОРОЙ ИСТОЧНИК ДУБЛЕЙ. Строку с telegram_id создаёт не только привязка:
    // ensureParticipantRow_ (Api.gs) заводит её при ЛЮБОМ первом открытии
    // приложения — например, если студент нашёл бота сам и открыл до того, как
    // координатор прислал ссылку. Тогда к моменту привязки в таблице лежат уже
    // две строки про одного человека: своя по telegram_id (без сделки) и
    // сиротская по amo_deal_id (без telegram_id). Просто вписать telegram_id в
    // сиротскую — значит получить ДВЕ строки с одним telegram_id, и findRow
    // вернёт первую, то есть снова не ту. Поэтому ниже разобраны все случаи.
    //
    // Какая строка главная. Побеждает строка сделки: именно в неё пишет вебхук
    // (upsertRow по amo_deal_id), и в ней лежат данные из CRM — этап, имя,
    // координатор, сезон. Строка, созданная при первом открытии, несёт только
    // дату создания и имя из профиля Telegram; их переносим, а саму строку
    // обезличиваем, очищая telegram_id, чтобы поиск по нему находил ровно одну.
    // Именно очищаем, а не удаляем: удаление строки сдвигает номера всех
    // следующих, а на них ссылаются уже прочитанные в этом же прогоне данные.
    // Документы и чек-лист привязаны к telegram_id, а не к строке участника,
    // поэтому они переезжают сами.
    const byDeal = findRow("Participants", "amo_deal_id", row.amo_deal_id);
    const byTg = findRow("Participants", "telegram_id", telegramId);

    if (byDeal && String(byDeal.telegram_id || "") && String(byDeal.telegram_id) !== String(telegramId)) {
      // Сделка уже привязана к другому аккаунту. Раньше этот случай молча
      // создавал вторую строку и уводил уведомления не тому человеку —
      // теперь честно отказываем, чтобы координатор увидел проблему.
      throw new Error("Эта сделка уже привязана к другому аккаунту Telegram. Обратитесь к координатору.");
    }

    if (byDeal && byTg && byDeal._row !== byTg._row) {
      // Обе строки существуют — сливаем в строку сделки.
      updateRow("Participants", byDeal._row, {
        telegram_id: telegramId,
        name: byDeal.name || byTg.name || "",
        created_at: byTg.created_at || byDeal.created_at || new Date(),
        last_activity: byTg.last_activity || new Date(),
      });
      updateRow("Participants", byTg._row, { telegram_id: "", amo_deal_id: "" });
      logEvent(telegramId, "linking", "rows_merged", "", row.amo_deal_id);
    } else if (byDeal) {
      // Есть только строка сделки (обычный путь: вебхук был, приложение ещё нет).
      updateRow("Participants", byDeal._row, { telegram_id: telegramId });
    } else if (byTg) {
      // Есть только своя строка: вебхука по сделке ещё не было.
      updateRow("Participants", byTg._row, { amo_deal_id: row.amo_deal_id });
    } else {
      // Ни той, ни другой — координатор ввёл ID сделки руками до всякой
      // синхронизации. Создаём строку тем же кодом, что и раньше создавал
      // ensureParticipantRow_: там же заводятся имя, этап и даты.
      createParticipantRow_(telegramId, telegramUser || {});
      const свежая = findRow("Participants", "telegram_id", telegramId);
      if (свежая) updateRow("Participants", свежая._row, { amo_deal_id: row.amo_deal_id });
    }

    // ДОСЕВ ДОКУМЕНТОВ И ЧЕК-ЛИСТА (02.09.2026). Раньше их создавала только
    // ветка «новый участник» в ensureParticipantRow_, а у пришедшего по ссылке
    // строка к этому моменту уже есть — поэтому чек-лист подготовки к вылету
    // оставался ПУСТЫМ у всех, кто пришёл нормальным путём. Функция
    // идемпотентна: досевает лишь недостающее, повторный вызов ничего не портит.
    seedParticipantDefaults_(telegramId);

    logEvent(telegramId, "linking", "account_linked", "", row.amo_deal_id);
    return row.amo_deal_id;
  } finally {
    lock.releaseLock();
  }
}
