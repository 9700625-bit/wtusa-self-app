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
 * @param {number} maxAgeSeconds - reject initData older than this (replay protection). Default 24h.
 */
function validateInitData(initData, maxAgeSeconds) {
  if (!initData) return null;
  maxAgeSeconds = maxAgeSeconds || 86400;

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
function consumeLinkToken(token, telegramId) {
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
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("Linking token expired");

    updateRow("LinkTokens", row._row, { used: "yes" });
    upsertRow("Participants", "telegram_id", telegramId, { amo_deal_id: row.amo_deal_id });
    logEvent(telegramId, "linking", "account_linked", "", row.amo_deal_id);
    return row.amo_deal_id;
  } finally {
    lock.releaseLock();
  }
}
