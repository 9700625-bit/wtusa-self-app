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
    // reminder flow that triggered it. ТЗ §77 asks for retry-ability instead
    // of hard failure; logEvent below leaves a trail for a manual resend.
    // We still return Telegram's own error body (when present) so callers
    // that want to surface *why* it failed — e.g. adminCreateEventAndInvite_ —
    // can do so instead of failing silently.
    Logger.log("Telegram sendMessage failed (%s): %s", code, resp.getContentText());
    return json || { ok: false, description: "HTTP " + code };
  }
  return json;
}

/**
 * ЭКРАНИРОВАНИЕ HTML В СООБЩЕНИЯХ (02.09.2026).
 *
 * sendTelegramMessage жёстко ставит parse_mode: "HTML", а тексты собираются
 * конкатенацией с данными, которые вводит человек: название мероприятия из
 * координаторской страницы, название платежа, имя. Telegram при parse_mode
 * HTML отклоняет сообщение целиком (ошибка 400), если натыкается на символ
 * "<", не открывающий известный тег.
 *
 * Чем это било. Мероприятие с названием вроде «Брифинг <по документам>» —
 * и КАЖДОЕ приглашение отваливается с 400. При этом строки EventInvitations
 * уже созданы и помечены notified:"yes", поэтому sendPendingEventInvites их
 * больше не подхватит: студенты не получат приглашение никогда, а координатор
 * увидит лишь строчку в списке неудач и вряд ли поймёт причину.
 *
 * Экранируем три символа, значимых для HTML-разметки Telegram. Осознанно НЕ
 * трогаем сам parse_mode: где-то в проекте разметка нужна (жирный шрифт), и
 * отключение сломало бы её. Вместо этого экранируем вставляемые ЗНАЧЕНИЯ —
 * через escapeTgHtml_ в местах сборки текста.
 */
function escapeTgHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
