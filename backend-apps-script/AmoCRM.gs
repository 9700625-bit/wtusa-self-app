/**
 * Minimal amoCRM REST API v4 client: OAuth token lifecycle + reading a deal's
 * custom fields + updating fields + creating coordinator tasks.
 * Docs: https://www.amocrm.ru/developers/content/oauth/step-by-step
 */

function amoBaseUrl_() {
  const domain = CFG_OPTIONAL("AMO_BASE_DOMAIN", "amocrm.ru");
  return "https://" + CFG("AMO_SUBDOMAIN") + "." + domain;
}

/** Step 1 of OAuth: send the user (you, once, as admin) to this URL to approve the integration. */
function getAmoAuthorizeUrl() {
  // `mode` deliberately omitted — that gives a plain full-page redirect back
  // to AMO_REDIRECT_URI with ?code=..., which doGet(action=amoOauthCallback)
  // exchanges for tokens. (mode=popup/post_message are for widget JS flows.)
  return (
    amoBaseUrl_() +
    "/oauth?client_id=" + encodeURIComponent(CFG("AMO_CLIENT_ID")) +
    "&state=setup"
  );
}

/** Step 2: called from doGet(action=amoOauthCallback) with the ?code=... amoCRM redirected back with. */
function exchangeAmoAuthCode(code) {
  const resp = UrlFetchApp.fetch(amoBaseUrl_() + "/oauth2/access_token", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      client_id: CFG("AMO_CLIENT_ID"),
      client_secret: CFG("AMO_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code: code,
      redirect_uri: CFG("AMO_REDIRECT_URI"),
    }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (!body.access_token) throw new Error("amoCRM OAuth exchange failed: " + resp.getContentText());
  storeAmoTokens_(body);
  return true;
}

function storeAmoTokens_(tokenResponse) {
  setProp("AMO_ACCESS_TOKEN", tokenResponse.access_token);
  setProp("AMO_REFRESH_TOKEN", tokenResponse.refresh_token);
  setProp("AMO_TOKEN_EXPIRES_AT", Math.floor(Date.now() / 1000) + Number(tokenResponse.expires_in) - 60);
}

/** Returns a valid access token, refreshing it first if it's expired/near-expiry.
 * If you generated a "Долгосрочный токен" (long-lived token) directly in
 * amoCRM's Ключи и доступы page instead of doing the OAuth code exchange,
 * just set AMO_ACCESS_TOKEN and leave AMO_REFRESH_TOKEN unset — that token
 * is already good for ~1 year and needs no refreshing. */
function getAmoAccessToken_() {
  if (!CFG_OPTIONAL("AMO_REFRESH_TOKEN", "")) {
    return CFG("AMO_ACCESS_TOKEN");
  }
  if (Date.now() / 1000 < Number(CFG_OPTIONAL("AMO_TOKEN_EXPIRES_AT", "0"))) {
    return CFG("AMO_ACCESS_TOKEN");
  }

  // Same double-checked-locking shape used elsewhere in this codebase
  // (ensureParticipantRow_, syncDealToSheets, ...): an amoCRM webhook and
  // the daily Reminders.gs run can both land here at once with the same
  // near-expired token, and amoCRM refresh tokens are typically single-use
  // -- two concurrent refresh POSTs would let one succeed and one fail (or
  // worse, race on which response gets stored last), potentially leaving
  // Script Properties holding a token whose refresh token was already
  // burned, which would break every amoCRM call until someone re-runs the
  // OAuth flow by hand. The lock serializes refreshes; the re-check right
  // after acquiring it means the loser of the race just reuses the token
  // the winner already fetched instead of refreshing a second time.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("amoCRM token refresh: could not acquire lock within 10s.");
  try {
    if (Date.now() / 1000 < Number(CFG_OPTIONAL("AMO_TOKEN_EXPIRES_AT", "0"))) {
      return CFG("AMO_ACCESS_TOKEN");
    }
    const resp = UrlFetchApp.fetch(amoBaseUrl_() + "/oauth2/access_token", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        client_id: CFG("AMO_CLIENT_ID"),
        client_secret: CFG("AMO_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: CFG("AMO_REFRESH_TOKEN"),
        redirect_uri: CFG("AMO_REDIRECT_URI"),
      }),
      muteHttpExceptions: true,
    });
    const body = JSON.parse(resp.getContentText());
    if (!body.access_token) throw new Error("amoCRM token refresh failed: " + resp.getContentText());
    storeAmoTokens_(body);
    return body.access_token;
  } finally {
    lock.releaseLock();
  }
}

function amoApiFetch_(path, method, payload) {
  const resp = UrlFetchApp.fetch(amoBaseUrl_() + path, {
    method: method || "get",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + getAmoAccessToken_() },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error("amoCRM API " + code + ": " + resp.getContentText());
  const text = resp.getContentText();
  return text ? JSON.parse(text) : null;
}

function getDeal(dealId) {
  return amoApiFetch_("/api/v4/leads/" + dealId + "?with=contacts", "get");
}

/** Looks up the phone number of a deal's main contact (or its first linked
 * contact, if none is flagged main) -- used by adminCreateLink so admin.html
 * can offer a one-click "send in WhatsApp" button instead of the coordinator
 * having to copy the link and paste it in by hand. `deal` must come from
 * getDeal() (needs the ?with=contacts it already requests). Returns the raw
 * phone string as stored in amoCRM (whatever format the contact has), or
 * null if there's no linked contact or no phone on it. */
function contactPhoneForDeal_(deal) {
  const contacts = (deal && deal._embedded && deal._embedded.contacts) || [];
  if (!contacts.length) return null;
  const main = contacts.find((c) => c.is_main) || contacts[0];
  const contact = amoApiFetch_("/api/v4/contacts/" + main.id, "get");
  const fields = (contact && contact.custom_fields_values) || [];
  const phoneField = fields.find((f) => f.field_code === "PHONE");
  if (!phoneField || !phoneField.values || !phoneField.values.length) return null;
  return phoneField.values[0].value;
}

/** Reads one custom field's value off a deal object returned by getDeal(). */
function customFieldValue(deal, fieldId) {
  const fields = (deal && deal.custom_fields_values) || [];
  const field = fields.find((f) => String(f.field_id) === String(fieldId));
  if (!field || !field.values || !field.values.length) return null;
  return field.values[0].value;
}

function updateDealCustomField(dealId, fieldId, value) {
  return amoApiFetch_("/api/v4/leads/" + dealId, "patch", {
    custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: value }] }],
  });
}

/** Creates a coordinator task on a deal (ТЗ §64 escalations). */
function createCoordinatorTask(dealId, text, dueInHours) {
  const completeTill = Math.floor(Date.now() / 1000) + (dueInHours || 24) * 3600;
  return amoApiFetch_("/api/v4/tasks", "post", [
    { entity_id: Number(dealId), entity_type: "leads", text: text, complete_till: completeTill },
  ]);
}
