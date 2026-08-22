/**
 * Outbound-only Telegram Bot API calls (we never need an inbound bot
 * webhook for this MVP — the Mini App calls our backend directly, and the
 * only thing the "bot" needs to do is proactively push messages).
 */

function telegramApiFetch_(method, payload) {
  const url = "https://api.telegram.org/bot" + CFG("TELEGRAM_BOT_TOKEN") + "/" + method;
  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  let json = null;
  try {
    json = JSON.parse(resp.getContentText());
  } catch (e) {
    // ignore — non-JSON body, json stays null
  }
  if (code >= 300) {
    // Log and swallow — a failed notification shouldn't break the webhook/
    // reminder flow that triggered it. Callers that want to surface *why*
    // it failed (e.g. adminCreateEventAndInvite_) can inspect the returned
    // object's ok/description fields instead of failing silently.
    Logger.log("Telegram sendMessage failed (%s): %s", code, resp.getContentText());
    return json || { ok: false, description: "HTTP " + code };
  }
  return json;
}

function sendTelegramMessage(chatId, text, opts) {
  const payload = Object.assign(
    { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true },
    opts || {}
  );
  return telegramApiFetch_("sendMessage", payload);
}

/** Convenience: look up a participant's telegram_id and notify them, logging either way. */
function notifyParticipantByDealId(amoDealId, text) {
  const participant = findRow("Participants", "amo_deal_id", amoDealId);
  if (!participant || !participant.telegram_id) {
    Logger.log("No linked Telegram account for amo_deal_id=%s — notification skipped.", amoDealId);
    return false;
  }
  sendTelegramMessage(participant.telegram_id, text);
  logEvent(participant.telegram_id, "backend", "telegram_notification_sent", "", text);
  return true;
}
