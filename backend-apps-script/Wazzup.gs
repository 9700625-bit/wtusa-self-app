/**
 * Minimal Wazzup24 API client -- sends outgoing WhatsApp messages through the
 * same WhatsApp channel/number the coordinators already use for client chats
 * inside amoCRM (imBox). Docs: https://wazzup24.com/help/api-en/sending-messages/
 *
 * Required Script Properties (see SETUP.md §5.4):
 *   WAZZUP_API_KEY      -- from Wazzup dashboard: Channels (add a channel first,
 *                           if you haven't) -> "Integration with CRM" -> API -> Add,
 *                           then Integration with CRM -> tab "More" to read it back.
 *   WAZZUP_CHANNEL_ID    -- the UUID of the WhatsApp channel to send from. Run
 *                           listWazzupChannels() (below) once, check the
 *                           execution log for the entry with transport
 *                           "whatsapp", and paste its channelId here.
 */

function wazzupApiFetch_(path, method, payload) {
  const resp = UrlFetchApp.fetch("https://api.wazzup24.com" + path, {
    method: method || "get",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + CFG("WAZZUP_API_KEY") },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error("Wazzup API " + code + ": " + resp.getContentText());
  const text = resp.getContentText();
  return text ? JSON.parse(text) : null;
}

/** One-time setup helper: run this from the Apps Script editor (Выполнить),
 * then check Журнал выполнения / Executions for the logged list -- copy the
 * channelId of the entry with transport "whatsapp" into the WAZZUP_CHANNEL_ID
 * Script Property. Not called from the web app. */
function listWazzupChannels() {
  const channels = wazzupApiFetch_("/v3/channels", "get");
  Logger.log(JSON.stringify(channels, null, 2));
  return channels;
}

// Wazzup wants the phone as bare digits with country code, e.g. 79011112233
// -- same shape admin.html already normalizes to for the old wa.me link, so
// this mirrors that logic server-side (never trust the client's formatting).
function wazzupPhoneDigits_(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "8") digits = "7" + digits.slice(1);
  return digits;
}

/**
 * Sends a WhatsApp text message via Wazzup, through the channel configured in
 * WAZZUP_CHANNEL_ID. Throws on failure (bad phone, channel disconnected, API
 * error, ...) -- callers decide how to surface that to the coordinator.
 * Returns Wazzup's { messageId, chatId }.
 */
function sendWazzupWhatsApp_(phone, text) {
  const chatId = wazzupPhoneDigits_(phone);
  if (!chatId) throw new Error("sendWazzupWhatsApp_: no usable phone number");
  return wazzupApiFetch_("/v3/message", "post", {
    channelId: CFG("WAZZUP_CHANNEL_ID"),
    chatType: "whatsapp",
    chatId: chatId,
    text: text,
  });
}
