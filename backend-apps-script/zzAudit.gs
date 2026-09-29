/**
 * ПОЛНЫЙ АУДИТ СИСТЕМЫ — ТОЛЬКО ЧТЕНИЕ (30.09.2026).
 *
 * Ничего не меняет ни в amoCRM, ни в данных приложения. Единственное, что
 * пишет, — отчёт на отдельный лист «_audit» в таблице WTUSA SELF (лист
 * пересоздаётся при каждом запуске части A). Claude читает этот лист сам —
 * скриншоты не нужны.
 *
 * Запуск (по очереди, каждая часть укладывается в лимит 6 минут):
 *   aaAuditA — настройки, триггеры, код, все листы WTUSA SELF   (~30 с)
 *   aaAuditB — amoCRM: вебхуки, воронка, сделки, поля, срок 3-го  (~1 мин)
 *   aaAuditC — таблица «2027 ABC» против amoCRM (пробный перенос)   (~3 мин)
 *
 * Статусы в отчёте: OK — всё в порядке; WARN — не ломает, но стоит убрать /
 * поправить; FAIL — что-то сломано или сломается; INFO — справка.
 * После аудита файл можно удалить целиком.
 */

var AUD_ROWS_ = [];

function aud_(section, check, status, details) {
  AUD_ROWS_.push([
    Utilities.formatDate(new Date(), "GMT+5", "dd.MM HH:mm:ss"),
    section, check, status,
    String(details === undefined ? "" : details).slice(0, 45000),
  ]);
}

function audSafe_(section, check, fn) {
  try { fn(); } catch (err) { aud_(section, check, "FAIL", "проверка упала: " + err); }
}

function audSheet_(reset) {
  const ss = SpreadsheetApp.openById(CFG("SHEET_ID"));
  let sh = ss.getSheetByName("_audit");
  if (!sh) sh = ss.insertSheet("_audit");
  if (reset) {
    sh.clear();
    sh.getRange(1, 1, 1, 5).setValues([["время", "раздел", "проверка", "статус", "подробности"]]);
  }
  return sh;
}

function audFlush_(reset) {
  const sh = audSheet_(reset);
  if (AUD_ROWS_.length) sh.getRange(sh.getLastRow() + 1, 1, AUD_ROWS_.length, 5).setValues(AUD_ROWS_);
  const counts = { OK: 0, WARN: 0, FAIL: 0, INFO: 0 };
  AUD_ROWS_.forEach((r) => { counts[r[3]] = (counts[r[3]] || 0) + 1; });
  Logger.log("audit: %s строк, OK %s, WARN %s, FAIL %s, INFO %s", AUD_ROWS_.length, counts.OK, counts.WARN, counts.FAIL, counts.INFO);
  AUD_ROWS_ = [];
}

function audRaw_(name) {
  const sh = SpreadsheetApp.openById(CFG("SHEET_ID")).getSheetByName(name);
  if (!sh) return null;
  const v = sh.getDataRange().getValues();
  const h = (v[0] || []).map((x) => String(x).trim());
  const rows = v.slice(1).filter((r) => r.some((c) => String(c).trim() !== ""));
  const col = (n) => h.indexOf(n);
  return { h: h, rows: rows, col: col };
}

function audLeads_() {
  const leads = [];
  for (let page = 1; page < 20; page++) {
    const resp = amoApiFetch_("/api/v4/leads?filter[pipeline_id][0]=" + ABC_PIPELINE_ID_ + "&limit=250&page=" + page, "get");
    const it = resp && resp._embedded && resp._embedded.leads;
    if (!it || !it.length) break;
    leads.push.apply(leads, it);
    if (it.length < 250) break;
  }
  return leads;
}

// =====================================================================
// ЧАСТЬ A — настройки, триггеры, код, листы
// =====================================================================
function aaAuditA() {
  AUD_ROWS_ = [];
  const S = "A";

  // A1. Script Properties
  audSafe_(S, "A1 Свойства скрипта", () => {
    const p = PropertiesService.getScriptProperties().getProperties();
    const keys = Object.keys(p);
    let size = 0;
    keys.forEach((k) => { size += k.length + String(p[k]).length; });
    const whq = keys.filter((k) => k.indexOf("WHQ_") === 0).length;
    aud_(S, "A1 Размер хранилища свойств", size > 350000 ? "FAIL" : size > 200000 ? "WARN" : "OK",
      Math.round(size / 1024) + " КБ из 500 КБ, ключей " + keys.length);
    aud_(S, "A1 Очередь вебхуков сейчас", whq > 200 ? "WARN" : "OK", whq + " событий ждут разбора");
    const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "AMO_SUBDOMAIN", "AMO_ACCESS_TOKEN",
      "WEBHOOK_SECRET", "SHEET_ID", "ADMIN_SECRET", "ABC_UNIVERSE_SHEET_ID", "WAZZUP_API_KEY",
      "WAZZUP_CHANNEL_ID", "STATUS_ID_MAP_JSON", "ADMIN_TELEGRAM_ID"];
    const missing = required.filter((k) => !p[k]);
    aud_(S, "A1 Обязательные ключи", missing.length ? "FAIL" : "OK", missing.length ? "нет: " + missing.join(", ") : "все " + required.length + " на месте (значения не выводятся)");
    const fid = keys.filter((k) => k.indexOf("FIELD_ID_") === 0).sort();
    aud_(S, "A1 Поля amoCRM (FIELD_ID_*)", "INFO", fid.join(", "));
    if (p.PROGRAM_COST_USD) aud_(S, "A1 PROGRAM_COST_USD", "WARN", "задано — всем студентам показывается одна и та же стоимость");
    if (p.LINK_TOKEN_TTL_HOURS) aud_(S, "A1 Срок жизни ссылки", "INFO", p.LINK_TOKEN_TTL_HOURS + " ч");
    const odd = keys.filter((k) => !/^(WHQ_|WHQSTAT_|FIELD_ID_)/.test(k) && required.indexOf(k) === -1);
    aud_(S, "A1 Прочие ключи", "INFO", odd.sort().join(", "));
  });

  // A2. Триггеры
  audSafe_(S, "A2 Триггеры", () => {
    const expected = ["sendScheduledReminders", "abcDailySync", "processAmoWebhookQueue", "abcOnStudentsEdit"];
    const tr = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction() + " (" + t.getEventType() + ")");
    const names = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
    const missing = expected.filter((n) => names.indexOf(n) === -1);
    const extra = names.filter((n) => expected.indexOf(n) === -1);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    const st = missing.length ? "FAIL" : (extra.length || dup.length) ? "WARN" : "OK";
    aud_(S, "A2 Триггеры", st, tr.join("; ") + (missing.length ? " | НЕТ: " + missing.join(", ") : "") +
      (extra.length ? " | лишние: " + extra.join(", ") : "") + (dup.length ? " | дубли: " + dup.join(", ") : ""));
  });

  // A3. Лишний код
  audSafe_(S, "A3 Код", () => {
    const g = globalThis;
    const fns = Object.keys(g).filter((k) => { try { return typeof g[k] === "function"; } catch (e) { return false; } });
    aud_(S, "A3 Всего функций", "INFO", fns.length);
    const temp = fns.filter((k) => /^(aa|zz|tmp|temp|test)/i.test(k) && k.indexOf("aaAudit") !== 0);
    aud_(S, "A3 Временные функции (aa*/zz*/test*)", temp.length ? "WARN" : "OK", temp.join(", ") || "нет");
    const risky = ["fixAmoWebhookUrl", "bulkAutoLink", "createSheetsIfMissing", "wireUpSelfPipelineMapping", "backfillMissingDeals"].filter((k) => fns.indexOf(k) !== -1);
    aud_(S, "A3 Опасные при случайном запуске", risky.indexOf("fixAmoWebhookUrl") !== -1 ? "WARN" : "INFO",
      risky.join(", ") + " — fixAmoWebhookUrl переподписывает вебхук на ВСЕ события");
    const legacy = ["abcSyncPay3Deadlines_", "abcDryRunTest", "listAmoCustomFields", "listAmoPipelineStatuses", "listWazzupChannels", "logAmoAuthorizeUrl", "exchangeAmoAuthCode", "getAmoAuthorizeUrl"].filter((k) => fns.indexOf(k) !== -1);
    aud_(S, "A3 Служебные/диагностика (можно оставить)", "INFO", legacy.join(", "));
  });

  // A4. Листы WTUSA SELF
  audSafe_(S, "A4 Листы", () => {
    const ss = SpreadsheetApp.openById(CFG("SHEET_ID"));
    const expected = ["Participants", "Payments", "Documents", "VisaInfo", "PreDepartureChecklist", "LinkTokens",
      "EventLog", "Events", "EventInvitations", "Coordinators"];
    const all = ss.getSheets().map((s) => s.getName());
    expected.forEach((n) => {
      const sh = ss.getSheetByName(n);
      aud_(S, "A4 Лист " + n, sh ? "OK" : "FAIL", sh ? (sh.getLastRow() - 1) + " строк, " + sh.getLastColumn() + " колонок" : "листа нет");
    });
    const extra = all.filter((n) => expected.indexOf(n) === -1);
    aud_(S, "A4 Прочие листы", "INFO", extra.join(", "));
  });

  // A5. Participants
  audSafe_(S, "A5 Participants", () => {
    const t = audRaw_("Participants");
    const cD = t.col("amo_deal_id"), cT = t.col("telegram_id"), cS = t.col("current_stage_id"), cC = t.col("coordinator_name"),
      cF = t.col("first_name"), cA = t.col("last_activity");
    const deals = {};
    t.rows.forEach((r) => { const d = String(r[cD]).trim(); if (d) deals[d] = (deals[d] || 0) + 1; });
    const dup = Object.keys(deals).filter((d) => deals[d] > 1);
    const noDeal = t.rows.filter((r) => !String(r[cD]).trim());
    const linked = t.rows.filter((r) => String(r[cT]).trim());
    const noStage = t.rows.filter((r) => String(r[cD]).trim() && !String(r[cS]).trim());
    const known = (typeof STAGE_IDS !== "undefined" ? STAGE_IDS : []);
    const badStage = t.rows.filter((r) => String(r[cS]).trim() && known.indexOf(String(r[cS]).trim()) === -1);
    const noCoord = t.rows.filter((r) => String(r[cD]).trim() && !String(r[cC]).trim());
    const junkName = cF === -1 ? [] : t.rows.filter((r) => String(r[cF]).trim() && !/\p{L}/u.test(String(r[cF])));
    aud_(S, "A5 Всего строк / привязано к Telegram", "INFO", t.rows.length + " / " + linked.length);
    aud_(S, "A5 Дубли сделок", dup.length ? "WARN" : "OK", dup.join(", ") || "нет");
    aud_(S, "A5 Строки без сделки", noDeal.length ? "WARN" : "OK", noDeal.map((r) => (r[cT] || "?") + "/" + (r[t.col("name")] || "")).join(", ") || "нет");
    aud_(S, "A5 Сделка без этапа", noStage.length ? "WARN" : "OK", noStage.length + ": " + noStage.slice(0, 20).map((r) => r[cD]).join(", "));
    aud_(S, "A5 Неизвестный этап", badStage.length ? "WARN" : "OK", badStage.map((r) => r[cD] + "=" + r[cS]).slice(0, 30).join(", ") || "нет");
    aud_(S, "A5 Без координатора", noCoord.length ? "WARN" : "OK", noCoord.length + ": " + noCoord.slice(0, 20).map((r) => r[cD]).join(", "));
    aud_(S, "A5 Имя без букв", junkName.length ? "WARN" : "OK", junkName.length);
    if (cA !== -1) {
      const act = linked.map((r) => r[cA]).filter(Boolean).map((d) => new Date(d)).filter((d) => !isNaN(d));
      aud_(S, "A5 Последняя активность в приложении", "INFO", act.length ? Utilities.formatDate(new Date(Math.max.apply(null, act)), "GMT+5", "dd.MM.yyyy HH:mm") : "нет");
    }
  });

  // A6. Payments
  audSafe_(S, "A6 Payments", () => {
    const p = audRaw_("Participants");
    const tg = {};
    p.rows.forEach((r) => { const x = String(r[p.col("telegram_id")]).trim(); if (x) tg[x] = true; });
    const t = audRaw_("Payments");
    const cT = t.col("telegram_id"), cK = t.col("pay_row_key"), cS = t.col("status"), cDl = t.col("deadline");
    const orphan = t.rows.filter((r) => !tg[String(r[cT]).trim()]);
    const keys = {};
    t.rows.forEach((r) => { const k = String(r[cK]); keys[k] = (keys[k] || 0) + 1; });
    const dupK = Object.keys(keys).filter((k) => keys[k] > 1);
    const now = Date.now();
    const badOverdue = t.rows.filter((r) => String(r[cS]) === "overdue" && (!r[cDl] || new Date(r[cDl]).getTime() > now));
    const byStatus = {};
    t.rows.forEach((r) => { const s = String(r[cS] || "?"); byStatus[s] = (byStatus[s] || 0) + 1; });
    aud_(S, "A6 Строк / по статусам", "INFO", t.rows.length + " " + JSON.stringify(byStatus));
    aud_(S, "A6 Без студента (осиротевшие)", orphan.length ? "WARN" : "OK", orphan.map((r) => r[cK]).join(", ") || "нет");
    aud_(S, "A6 Дубли ключей", dupK.length ? "WARN" : "OK", dupK.join(", ") || "нет");
    aud_(S, "A6 «Просрочено» без просрочки", badOverdue.length ? "WARN" : "OK", badOverdue.map((r) => r[cK]).join(", ") || "нет");
  });

  // A7. Documents / VisaInfo / Checklist — сироты
  ["Documents", "VisaInfo", "PreDepartureChecklist"].forEach((name) => {
    audSafe_(S, "A7 " + name, () => {
      const p = audRaw_("Participants");
      const tg = {};
      p.rows.forEach((r) => { const x = String(r[p.col("telegram_id")]).trim(); if (x) tg[x] = true; });
      const t = audRaw_(name);
      if (!t) { aud_(S, "A7 " + name, "WARN", "листа нет"); return; }
      const c = t.col("telegram_id");
      const orphan = c === -1 ? [] : t.rows.filter((r) => !tg[String(r[c]).trim()]);
      aud_(S, "A7 " + name + ": строк / сирот", orphan.length ? "WARN" : "OK", t.rows.length + " / " + orphan.length);
    });
  });

  // A8. LinkTokens
  audSafe_(S, "A8 LinkTokens", () => {
    const t = audRaw_("LinkTokens");
    const cU = t.col("used"), cE = t.col("expires_at"), cD = t.col("amo_deal_id");
    const by = {};
    t.rows.forEach((r) => { const u = String(r[cU] || "?"); by[u] = (by[u] || 0) + 1; });
    const now = Date.now();
    const expired = t.rows.filter((r) => String(r[cU]) === "no" && r[cE] && new Date(r[cE]).getTime() < now);
    const live = {};
    t.rows.filter((r) => String(r[cU]) === "no" && (!r[cE] || new Date(r[cE]).getTime() > now)).forEach((r) => { const d = String(r[cD]); live[d] = (live[d] || 0) + 1; });
    const multi = Object.keys(live).filter((d) => live[d] > 1);
    aud_(S, "A8 Ссылки по статусам", "INFO", t.rows.length + " " + JSON.stringify(by));
    aud_(S, "A8 Истекли неиспользованными", expired.length ? "WARN" : "OK", expired.length + ": " + expired.map((r) => r[cD]).join(", "));
    aud_(S, "A8 Несколько живых ссылок на сделку", multi.length ? "WARN" : "OK", multi.join(", ") || "нет");
    const failed = t.rows.filter((r) => String(r[cU]) === "failed");
    aud_(S, "A8 Ссылка не ушла (failed)", failed.length ? "WARN" : "OK", failed.map((r) => r[cD]).join(", ") || "нет");
  });

  // A9. EventLog — ошибки за 7 дней
  audSafe_(S, "A9 EventLog", () => {
    const t = audRaw_("EventLog");
    const cTs = t.col("timestamp"), cSrc = t.col("source"), cEv = t.col("event"), cOld = t.col("old_value"), cNew = t.col("new_value");
    const week = Date.now() - 7 * 86400000;
    const recent = t.rows.filter((r) => { const d = new Date(r[cTs]); return !isNaN(d) && d.getTime() > week; });
    const errs = recent.filter((r) => String(r[cSrc]) === "monitor" || /fail|error/i.test(String(r[cEv])));
    const kinds = {};
    errs.forEach((r) => { const k = (String(r[cOld]) + " " + String(r[cNew])).replace(/\d+/g, "#").slice(0, 80); kinds[k] = (kinds[k] || 0) + 1; });
    aud_(S, "A9 Журнал: всего / за 7 дней", t.rows.length > 5000 ? "WARN" : "INFO", t.rows.length + " / " + recent.length);
    aud_(S, "A9 Ошибки за 7 дней", errs.length > 20 ? "WARN" : "INFO", errs.length + " " + JSON.stringify(kinds));
    const ev = {};
    recent.forEach((r) => { const k = r[cSrc] + "/" + r[cEv]; ev[k] = (ev[k] || 0) + 1; });
    aud_(S, "A9 События за 7 дней", "INFO", JSON.stringify(ev));
  });

  // A10. Coordinators, Events
  audSafe_(S, "A10 Coordinators", () => {
    const t = audRaw_("Coordinators");
    const noTg = t.rows.filter((r) => !String(r[t.col("telegram_username")]).trim());
    aud_(S, "A10 Координаторы", noTg.length ? "WARN" : "OK", t.rows.map((r) => r[t.col("name")] + "(" + r[t.col("amo_user_id")] + ")").join(", ") + (noTg.length ? " | без Telegram: " + noTg.length : ""));
  });
  audSafe_(S, "A10 Events", () => {
    const e = audRaw_("Events"), i = audRaw_("EventInvitations");
    aud_(S, "A10 Мероприятия / приглашения", "INFO", (e ? e.rows.length : 0) + " / " + (i ? i.rows.length : 0));
  });

  audFlush_(true);
}

// =====================================================================
// ЧАСТЬ B — amoCRM
// =====================================================================
function aaAuditB() {
  AUD_ROWS_ = [];
  const S = "B";
  const leads = audLeads_();
  const open = leads.filter((l) => l.status_id !== 142 && l.status_id !== 143);

  // B1. Вебхуки
  audSafe_(S, "B1 Вебхуки", () => {
    const w = amoApiFetch_("/api/v4/webhooks", "get");
    const hooks = (w && w._embedded && w._embedded.webhooks) || [];
    const ours = hooks.filter((h) => String(h.destination).indexOf("script.google.com") !== -1);
    aud_(S, "B1 Наших вебхуков", ours.length === 1 ? "OK" : "FAIL", ours.length + " (должен быть ровно 1)");
    ours.forEach((h) => {
      aud_(S, "B1 Вебхук " + h.id, h.disabled ? "FAIL" : "OK", (h.disabled ? "ВЫКЛЮЧЕН" : "включён") + ", событий " + h.settings.length + ": " + h.settings.join(","));
      if (h.settings.length > 3) aud_(S, "B1 Лишние события", "WARN", "нужны только add_lead, update_lead, status_lead");
    });
    aud_(S, "B1 Чужие вебхуки", "INFO", hooks.filter((h) => ours.indexOf(h) === -1).map((h) => h.id + " " + String(h.destination).split("/")[2]).join(", "));
  });

  // B2. Этапы воронки ↔ карта приложения
  audSafe_(S, "B2 Этапы", () => {
    const pl = amoApiFetch_("/api/v4/leads/pipelines/" + ABC_PIPELINE_ID_, "get");
    const statuses = (pl && pl._embedded && pl._embedded.statuses) || [];
    const map = JSON.parse(CFG_OPTIONAL("STATUS_ID_MAP_JSON", "{}"));
    const mapped = {};
    Object.keys(map).forEach((k) => { mapped[String(map[k])] = k; mapped[String(k)] = mapped[String(k)] || map[k]; });
    const ids = statuses.map((s) => String(s.id));
    const autolink = String(CFG_OPTIONAL("AUTOLINK_STATUS_ID", "88848478"));
    const unmapped = statuses.filter((s) => !mapped[String(s.id)] && [142, 143].indexOf(s.id) === -1 && s.type !== 1 && String(s.id) !== autolink);
    aud_(S, "B2 Этапов в воронке / в карте", "INFO", statuses.length + " / " + Object.keys(map).length);
    aud_(S, "B2 Этапы, которых приложение не знает", unmapped.length ? "FAIL" : "OK", unmapped.map((s) => s.id + " «" + s.name + "»").join(", ") || "нет");
    const stale = Object.keys(map).filter((k) => ids.indexOf(String(map[k])) === -1 && ids.indexOf(String(k)) === -1);
    aud_(S, "B2 В карте, но нет в воронке", stale.length ? "WARN" : "OK", stale.join(", ") || "нет");
  });

  // B3. Сделки ↔ Participants
  audSafe_(S, "B3 Сделки", () => {
    const p = audRaw_("Participants");
    const cD = p.col("amo_deal_id"), cT = p.col("telegram_id");
    const inSheet = {};
    p.rows.forEach((r) => { inSheet[String(r[cD]).trim()] = r; });
    const missing = open.filter((l) => !inSheet[String(l.id)]);
    aud_(S, "B3 Открытых сделок в воронке", "INFO", open.length + " (закрытых " + (leads.length - open.length) + ")");
    aud_(S, "B3 Открытые сделки без строки в приложении", missing.length ? "FAIL" : "OK", missing.map((l) => l.id + " " + l.name).join(", ") || "нет");
    const openIds = {};
    open.forEach((l) => { openIds[String(l.id)] = true; });
    const extra = p.rows.filter((r) => String(r[cD]).trim() && !openIds[String(r[cD]).trim()]);
    const extraLinked = extra.filter((r) => String(r[cT]).trim());
    aud_(S, "B3 Строки приложения без открытой сделки", extra.length - extraLinked.length > 0 ? "WARN" : "OK",
      "всего " + extra.length + ", из них привязанных к Telegram " + extraLinked.length + ": " + extra.slice(0, 30).map((r) => r[cD]).join(", "));
  });

  // B4. Этап «Отправить ссылку»
  audSafe_(S, "B4 Автопривязка", () => {
    const autolink = Number(CFG_OPTIONAL("AUTOLINK_STATUS_ID", "88848478"));
    const inStage = open.filter((l) => l.status_id === autolink);
    const tok = audRaw_("LinkTokens");
    const issued = {};
    tok.rows.forEach((r) => { if (String(r[tok.col("used")]) !== "failed") issued[String(r[tok.col("amo_deal_id")])] = true; });
    const noLink = inStage.filter((l) => !issued[String(l.id)]);
    aud_(S, "B4 На этапе «Отправить ссылку» / без ссылки", noLink.length ? "FAIL" : "OK", inStage.length + " / " + noLink.length + (noLink.length ? ": " + noLink.map((l) => l.id).join(", ") : ""));
  });

  // B5. Срок 3-го платежа и дата договора
  audSafe_(S, "B5 Сроки", () => {
    const f3 = CFG_OPTIONAL("FIELD_ID_PAY3_DEADLINE", "");
    let eq = 0, noC = 0; const diff = [];
    const noContract = [];
    open.forEach((l) => {
      const c = contractDateForDeal_(l);
      if (!c) noContract.push(l.id);
      const raw = f3 ? customFieldValue(l, f3) : "";
      if (!raw) return;
      if (!c) { noC++; return; }
      const rule = new Date(c.getTime()); rule.setMonth(rule.getMonth() + 4);
      const a = Utilities.formatDate(new Date(Number(raw) * 1000), "GMT+5", "yyyy-MM-dd");
      const b = Utilities.formatDate(rule, "GMT+5", "yyyy-MM-dd");
      if (a === b) eq++; else diff.push(l.id + " " + a + "≠" + b);
    });
    aud_(S, "B5 Без даты договора", noContract.length ? "WARN" : "OK", noContract.length + ": " + noContract.slice(0, 40).join(", "));
    aud_(S, "B5 Поле «Оплата 3 (дата)»: = правилу / без договора / отличается", (eq + noC) > 5 ? "WARN" : "OK",
      eq + " / " + noC + " / " + diff.length + " — поле перекрывает расчёт приложения; автоматические значения лучше очистить" + (diff.length ? " | отличаются: " + diff.join(", ") : ""));
  });

  // B6. FIELD_ID_* существуют в amoCRM
  audSafe_(S, "B6 Поля", () => {
    const cf = [];
    for (let page = 1; page < 5; page++) {
      const r = amoApiFetch_("/api/v4/leads/custom_fields?limit=250&page=" + page, "get");
      const it = r && r._embedded && r._embedded.custom_fields;
      if (!it || !it.length) break;
      cf.push.apply(cf, it);
      if (it.length < 250) break;
    }
    const ids = {};
    cf.forEach((f) => { ids[String(f.id)] = f.name; });
    const p = PropertiesService.getScriptProperties().getProperties();
    const bad = Object.keys(p).filter((k) => k.indexOf("FIELD_ID_") === 0 && p[k] && !ids[String(p[k])]);
    aud_(S, "B6 FIELD_ID_* указывают на несуществующее поле", bad.length ? "WARN" : "OK", bad.join(", ") || "нет");
    const fill = (id) => open.filter((l) => { const v = customFieldValue(l, id); return v !== "" && v !== null && v !== undefined; }).length;
    const report = cf.filter((f) => f.type !== "tracking_data").map((f) => f.id + " «" + f.name + "» " + fill(f.id) + "/" + open.length);
    aud_(S, "B6 Заполненность полей сделки", "INFO", report.join("; "));
  });

  audFlush_(false);
}

// =====================================================================
// ЧАСТЬ C — таблица «2027 ABC» ↔ amoCRM
// =====================================================================
function aaAuditC() {
  AUD_ROWS_ = [];
  const S = "C";
  audSafe_(S, "C1 Заголовки таблицы", () => {
    const by = abcTableRowsByPhone_();
    aud_(S, "C1 Колонки «Студенты» на месте", by ? "OK" : "FAIL", by ? Object.keys(by).length + " телефонов" : "колонки сдвинуты — перенос в amoCRM остановлен");
    if (!by) return;
    const multi = Object.keys(by).filter((k) => by[k].length > 1);
    aud_(S, "C1 Телефон в нескольких строках", multi.length ? "WARN" : "OK", multi.length + ": " + multi.slice(0, 20).join(", "));
    const noContract = Object.keys(by).filter((k) => !by[k][0].contract);
    aud_(S, "C1 Строки без даты договора", noContract.length ? "WARN" : "OK", noContract.length);
  });
  audSafe_(S, "C2 Пробный перенос", () => {
    const r = abcSyncTableToAmo_(true);
    aud_(S, "C2 Таблица ↔ amoCRM (пробный перенос, ничего не пишет)", (r.toWrite || 0) > 0 ? "WARN" : "OK", JSON.stringify(r));
  });
  audFlush_(false);
}
