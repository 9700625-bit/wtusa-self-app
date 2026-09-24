/**
 * СИНХРОНИЗАЦИЯ ТАБЛИЦЫ «2027 ABC UNIVERSE» С amoCRM (24.09.2026, по просьбе
 * владельца — три пункта из разговора в чате: синхронизация статусов/оплат,
 * автоперенос в «Отказ», автосверка «Сверка Self»).
 *
 * ВАЖНО: это ОТДЕЛЬНАЯ таблица от `SHEET_ID` (база Mini App — Participants/
 * Payments/Events и т.д.). «2027 ABC Universe» — таблица координаторов для
 * учёта набора Self 2027 (вкладки «Студенты», «Отказ», «Документы», «Сверка
 * Self»), никак не связанная с Mini App. Этот файл открывает её ОТДЕЛЬНО по
 * ID (Script Property ABC_UNIVERSE_SHEET_ID), не трогает SHEET_ID/Sheets.gs/
 * Participants и не меняет ничего в логике Mini App — переиспользует только
 * amoApiFetch_/CFG из уже существующего клиента amoCRM (AmoCRM.gs, Config.gs).
 *
 * Требуется Script Property:
 *   ABC_UNIVERSE_SHEET_ID = 194LSHbCDAUAIsVm2oGJpT2chj16LtcwVsAUPXcNKFzw
 *
 * Три функции, каждая принимает dryRun (true = только считает и логирует,
 * ничего не пишет в таблицу — так их проверяли перед первым боевым запуском):
 *   abcSyncStatusesAndPayments_(dryRun) — «Студенты»: колонки «Status» и
 *     «Ответственный» подтягиваются из сделки amoCRM (сопоставление по
 *     телефону); «Документы»: колонка оплаты по «Оплата 1» (сопоставление по
 *     номеру «№»/«N» — в обеих таблицах это один и тот же порядковый номер
 *     студента).
 *   abcFlagRefusedStudents_(dryRun) — сделки со статусом «Закрыто и не
 *     реализовано» (status_id 143 — универсальный статус закрытия воронки)
 *     копируются строкой в «Отказ» (если там ещё нет строки с этим
 *     телефоном). Исходная строка в «Студенты» НЕ удаляется (риск потери
 *     данных при ошибке сопоставления) — только подсвечивается красным и
 *     помечается примечанием; удалить руками — решение координатора.
 *   abcGenerateSverkaReport_(dryRun) — пересобирает вкладку «Сверка Self»:
 *     1) есть в таблице, нет сделки в CRM; 2) есть сделка в CRM, нет в
 *     таблице; 3) статус в CRM расходится со статусом в таблице. (Категория
 *     «похожие имена» из ручной версии сверки — сознательно не
 *     автоматизирована в этой итерации: сопоставление по телефону надёжнее и
 *     не даёт ложных срабатываний; ручную проверку написаний имён оставляем
 *     координатору.)
 *
 * Многозначные совпадения (один телефон/контакт на несколько сделок amoCRM)
 * сознательно ПРОПУСКАЮТСЯ в статусной синхронизации и в автопереносе —
 * такие случаи попадут в «Сверка Self» как расхождение статуса или их видно
 * руками; риск переписать не ту сделку важнее автоматизации этого редкого
 * случая.
 *
 * 24.09.2026 (правка после первого боевого запуска): «Студенты»/«Отказ» имеют
 * валидацию данных на колонке «Ответственный» (выпадающий список конкретных
 * имён координаторов). Если имя ответственного из amoCRM не входит в этот
 * список — Google Sheets отклоняет запись целиком исключением, и БЕЗ
 * try/catch это останавливало вообще весь прогон (включая ещё не обработанные
 * строки, «Документы», автоперенос и сверку). Теперь каждая отдельная запись
 * оборачивается в try/catch: отклонённые ячейки собираются в failedUpdates и
 * не мешают остальным — так одно расхождение справочника не блокирует всю
 * синхронизацию.
 *
 * abcDailySync() — вызывает все функции подряд, ловит и репортит ошибку через
 * reportError_ (Api.gs), не роняя весь прогон. Триггер — раз в сутки, ставится
 * вручную (Триггеры → abcDailySync → по времени → раз в день), как и
 * sendScheduledReminders.
 *
 * 25.09.2026 (обратная синхронизация, ОДИН конкретный переход, по просьбе
 * владельца): abcPushOxanaCieeTransition_(dryRun) — единственное направление
 * «таблица -> amoCRM» в этом файле. Оксана в «Студенты» ставит статус
 * «Передан в CIEE» (это разрешено делать вручную ТОЛЬКО когда сделка в CRM
 * сейчас в статусе «Job Submitted to CIEE Oxana») — скрипт видит это
 * расхождение и переставляет сделку в CRM. Владелец явно подтвердил: (1) CRM
 * главнее таблицы, (2) из таблицы можно менять только статус и ничего
 * больше, (3) разрешён только этот один переход. Вызывается в abcDailySync
 * ПЕРВОЙ, до abcSyncStatusesAndPayments_ — так «CRM главнее» соблюдается
 * автоматически: любое другое ручное изменение статуса в таблице просто
 * перезатирается на следующем шаге значением из CRM, без отдельной проверки
 * конфликтов. Подробности и id статусов — в комментарии над функцией.
 */

const ABC_PIPELINE_ID_ = 9881242; // «Сопровождение self»
const ABC_REFUSAL_STATUS_ID_ = 143; // «Закрыто и не реализовано» (общий для всех воронок)

// Позиции колонок листа «Студенты» (и «Отказ» — та же схема), 0-индексные,
// сверено вручную по живой таблице 24.09.2026.
const ABC_COL_ = {
  N: 0, COST: 1, FIO: 2, SURNAME: 3, NAME: 4, EMAIL: 5, PHONE: 6, DOB: 7,
  SPONSOR: 8, STATUS: 9, RESP: 10, VISA_STATUS: 11, VISA_DATE: 12, CONTRACT_DATE: 13,
};
const ABC_STUDENTS_HEADER_ROW_ = 6; // 1-индексная строка заголовков в «Студенты»
const ABC_STUDENTS_FIRST_DATA_ROW_ = 7;

function abcSpreadsheet_() {
  return SpreadsheetApp.openById(CFG("ABC_UNIVERSE_SHEET_ID"));
}
function abcSheet_(name) {
  const sh = abcSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Лист "' + name + '" не найден в таблице ABC Universe (' + name + ').');
  return sh;
}

function abcNormPhone_(v) {
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function abcFetchAmoData_() {
  const pipeline = amoApiFetch_("/api/v4/leads/pipelines/" + ABC_PIPELINE_ID_, "get");
  const statusNames = {};
  ((pipeline && pipeline._embedded && pipeline._embedded.statuses) || []).forEach((s) => { statusNames[s.id] = s.name; });

  const usersResp = amoApiFetch_("/api/v4/users?limit=250", "get");
  const userNames = {};
  ((usersResp && usersResp._embedded && usersResp._embedded.users) || []).forEach((u) => { userNames[u.id] = u.name; });

  const fieldsResp = amoApiFetch_("/api/v4/leads/custom_fields?limit=250", "get");
  const fields = (fieldsResp && fieldsResp._embedded && fieldsResp._embedded.custom_fields) || [];
  const pay1Field = fields.find((f) => f.name === "Оплата 1");

  const leads = [];
  let page = 1;
  while (true) {
    const resp = amoApiFetch_(
      "/api/v4/leads?filter[pipeline_id][0]=" + ABC_PIPELINE_ID_ + "&with=contacts&limit=250&page=" + page,
      "get"
    );
    const items = resp && resp._embedded && resp._embedded.leads;
    if (!items || !items.length) break;
    leads.push.apply(leads, items);
    if (items.length < 250) break;
    page++;
  }

  const contactIds = Array.from(
    new Set(
      leads
        .flatMap((l) => ((l._embedded && l._embedded.contacts) || []).map((c) => c.id))
        .filter(Boolean)
    )
  );
  const contactPhone = {};
  for (let i = 0; i < contactIds.length; i += 50) {
    const chunk = contactIds.slice(i, i + 50);
    const q = chunk.map((id) => "id[]=" + id).join("&");
    const resp = amoApiFetch_("/api/v4/contacts?" + q + "&limit=50", "get");
    const items = (resp && resp._embedded && resp._embedded.contacts) || [];
    items.forEach((c) => {
      const pf = (c.custom_fields_values || []).find((f) => f.field_code === "PHONE");
      const val = pf && pf.values && pf.values[0] && pf.values[0].value;
      if (val) contactPhone[c.id] = val;
    });
  }

  return leads.map((l) => {
    const contacts = (l._embedded && l._embedded.contacts) || [];
    const main = contacts.find((c) => c.is_main) || contacts[0];
    const phone = main ? contactPhone[main.id] : null;
    let pay1 = null;
    if (pay1Field) {
      const f = (l.custom_fields_values || []).find((cf) => cf.field_id === pay1Field.id);
      pay1 = f && f.values && f.values[0] && f.values[0].value;
    }
    return {
      id: l.id,
      name: l.name,
      statusId: l.status_id,
      statusName: statusNames[l.status_id] || String(l.status_id),
      responsibleName: userNames[l.responsible_user_id] || "",
      phoneNorm: phone ? abcNormPhone_(phone) : null,
      pay1: pay1,
      isRefused: l.status_id === ABC_REFUSAL_STATUS_ID_,
    };
  });
}

function abcGroupByPhone_(leads) {
  const map = {};
  leads.forEach((l) => {
    if (!l.phoneNorm) return;
    (map[l.phoneNorm] = map[l.phoneNorm] || []).push(l);
  });
  return map;
}

function abcReadStudentsSheet_() {
  const sh = abcSheet_("Студенты");
  const values = sh.getDataRange().getValues();
  const rows = [];
  for (let r = ABC_STUDENTS_FIRST_DATA_ROW_ - 1; r < values.length; r++) {
    const row = values[r];
    const phone = row[ABC_COL_.PHONE];
    if (!phone) continue;
    rows.push({
      rowIndex: r + 1,
      n: row[ABC_COL_.N],
      fio: row[ABC_COL_.FIO],
      phoneNorm: abcNormPhone_(phone),
      status: row[ABC_COL_.STATUS],
      resp: row[ABC_COL_.RESP],
    });
  }
  return { sheet: sh, rows: rows };
}

function abcSyncStatusesAndPayments_(dryRun) {
  const amo = abcFetchAmoData_();
  const amoByPhone = abcGroupByPhone_(amo);
  const { sheet, rows } = abcReadStudentsSheet_();

  const statusUpdates = [];
  const docUpdates = [];
  let ambiguous = 0;

  rows.forEach((row) => {
    const matches = amoByPhone[row.phoneNorm];
    if (!matches || !matches.length) return;
    if (matches.length > 1) { ambiguous++; return; }
    const lead = matches[0];
    if (lead.statusName && lead.statusName !== row.status) {
      statusUpdates.push({ rowIndex: row.rowIndex, col: ABC_COL_.STATUS + 1, value: lead.statusName, fio: row.fio, from: row.status, to: lead.statusName });
    }
    if (lead.responsibleName && lead.responsibleName !== row.resp) {
      statusUpdates.push({ rowIndex: row.rowIndex, col: ABC_COL_.RESP + 1, value: lead.responsibleName, fio: row.fio, from: row.resp, to: lead.responsibleName });
    }
    if (lead.pay1) docUpdates.push({ n: row.n, pay1: lead.pay1 });
  });

  // Ячейки со списком (валидацией данных, напр. «Ответственный») отклоняют
  // запись исключением, если значения нет в списке — ловим по одной, чтобы
  // одно расхождение справочника не остановило весь прогон (см. правку от
  // 24.09.2026 в шапке файла).
  // ВАЖНО: Apps Script откладывает фактическую запись setValue() до flush
  // (батчинг ради скорости) — ошибка валидации данных вылетает не в момент
  // setValue(), а при следующем flush/окончании функции. Без явного
  // SpreadsheetApp.flush() после каждой записи try/catch НИЧЕГО не ловит:
  // исключение всплывает позже, уже вне try/catch конкретной ячейки (так и
  // случилось при первом запуске с try/catch — ошибка ушла в общий catch
  // abcDailySync). Поэтому flush() вызывается сразу после каждого setValue.
  const failedUpdates = [];
  if (!dryRun) {
    statusUpdates.forEach((u) => {
      try {
        sheet.getRange(u.rowIndex, u.col).setValue(u.value);
        SpreadsheetApp.flush();
      } catch (e) {
        failedUpdates.push({ rowIndex: u.rowIndex, col: u.col, value: u.value, fio: u.fio, error: String(e) });
      }
    });
    if (docUpdates.length) {
      const docSheet = abcSheet_("Документы");
      const docValues = docSheet.getDataRange().getValues();
      docUpdates.forEach((du) => {
        for (let r = 0; r < docValues.length; r++) {
          if (String(docValues[r][0]) === String(du.n)) {
            const mark = du.pay1 === "Оплачено" ? "✅ Оплачен" : "❌ Не оплачен";
            if (docValues[r][2] !== mark) {
              try {
                docSheet.getRange(r + 1, 3).setValue(mark);
                SpreadsheetApp.flush();
              } catch (e) {
                failedUpdates.push({ n: du.n, col: "Документы!C", value: mark, error: String(e) });
              }
            }
            break;
          }
        }
      });
    }
  }

  return {
    checkedRows: rows.length,
    statusUpdates: statusUpdates.length,
    docUpdates: docUpdates.length,
    ambiguousSkipped: ambiguous,
    failedUpdates: failedUpdates.length,
    failedSample: failedUpdates,
    dryRun: !!dryRun,
    sample: statusUpdates.slice(0, 10),
  };
}

function abcFlagRefusedStudents_(dryRun) {
  const amo = abcFetchAmoData_();
  const refused = amo.filter((l) => l.isRefused && l.phoneNorm);
  const amoByPhone = abcGroupByPhone_(refused);

  const { sheet, rows } = abcReadStudentsSheet_();
  const otkazSheet = abcSheet_("Отказ");
  const otkazValues = otkazSheet.getDataRange().getValues();
  const otkazPhones = new Set(
    otkazValues.map((r) => abcNormPhone_(r[ABC_COL_.PHONE])).filter((p) => p.length >= 10)
  );

  const toMove = rows.filter((row) => amoByPhone[row.phoneNorm] && !otkazPhones.has(row.phoneNorm));
  const failed = [];

  if (!dryRun) {
    const lastCol = sheet.getLastColumn();
    toMove.forEach((row) => {
      try {
        const fullRow = sheet.getRange(row.rowIndex, 1, 1, lastCol).getValues()[0];
        otkazSheet.appendRow(fullRow);
        SpreadsheetApp.flush();
        sheet.getRange(row.rowIndex, 1, 1, lastCol).setBackground("#f4cccc");
        sheet
          .getRange(row.rowIndex, ABC_COL_.FIO + 1)
          .setNote(
            "Автоматически скопировано в «Отказ» " +
              Utilities.formatDate(new Date(), "GMT+5", "dd.MM.yyyy") +
              " — сделка в CRM закрыта статусом «Закрыто и не реализовано». Строку можно удалить вручную после проверки."
          );
        SpreadsheetApp.flush();
      } catch (e) {
        failed.push({ rowIndex: row.rowIndex, fio: row.fio, error: String(e) });
      }
    });
  }

  return { moved: toMove.length, failed: failed.length, failedSample: failed.slice(0, 10), dryRun: !!dryRun, sample: toMove.slice(0, 10).map((r) => r.fio) };
}

function abcGenerateSverkaReport_(dryRun) {
  const amo = abcFetchAmoData_();
  const amoByPhone = abcGroupByPhone_(amo);
  const { rows } = abcReadStudentsSheet_();
  const sheetPhones = new Set(rows.map((r) => r.phoneNorm));

  const missingInCrm = rows.filter((r) => !amoByPhone[r.phoneNorm]);
  const missingInSheet = amo.filter((l) => l.phoneNorm && !sheetPhones.has(l.phoneNorm));
  const statusMismatch = rows.filter(
    (r) => amoByPhone[r.phoneNorm] && amoByPhone[r.phoneNorm].length === 1 && amoByPhone[r.phoneNorm][0].statusName !== r.status
  );

  if (!dryRun) {
    const today = Utilities.formatDate(new Date(), "GMT+5", "dd.MM.yyyy");
    const lines = [];
    lines.push(["СВЕРКА SELF: автоматическая сверка воронки «Сопровождение self» vs «Студенты» (" + today + ")", "", "", "", "", ""]);
    lines.push(["1) Есть в таблице, сделки НЕТ в CRM (по телефону) — " + missingInCrm.length, "", "", "", "", ""]);
    lines.push(["ФИО", "Телефон", "", "", "", ""]);
    missingInCrm.forEach((r) => lines.push([r.fio, r.phoneNorm, "", "", "", ""]));
    lines.push(["2) Есть сделка в CRM, НЕТ в таблице (по телефону) — " + missingInSheet.length, "", "", "", "", ""]);
    lines.push(["Название сделки в CRM", "Телефон", "Статус в CRM", "", "", ""]);
    missingInSheet.forEach((l) => lines.push([l.name, l.phoneNorm, l.statusName, "", "", ""]));
    lines.push(["3) Статус в CRM не совпадает со статусом в таблице — " + statusMismatch.length, "", "", "", "", ""]);
    lines.push(["ФИО", "Статус в таблице", "Статус в CRM", "", "", ""]);
    statusMismatch.forEach((r) => lines.push([r.fio, r.status, amoByPhone[r.phoneNorm][0].statusName, "", "", ""]));
    lines.push(["4) Похожие написания имён — сверяется координатором вручную (не автоматизировано)", "", "", "", "", ""]);

    const sh = abcSheet_("Сверка Self");
    sh.clearContents();
    sh.getRange(1, 1, lines.length, 6).setValues(lines);
  }

  return {
    missingInCrm: missingInCrm.length,
    missingInSheet: missingInSheet.length,
    statusMismatch: statusMismatch.length,
    dryRun: !!dryRun,
  };
}

function abcDailySync() {
  try {
    // r0 (обратная синхронизация) вызывается ПЕРВОЙ, до основного pull-синка
    // r1: если Оксана поставила «Передан в CIEE» в таблице, это сначала
    // уходит в CRM, а затем r1 подтягивает актуальное состояние обратно —
    // так порядок вызовов сам обеспечивает «CRM главнее таблицы» без
    // отдельной проверки конфликтов (см. комментарий у
    // abcPushOxanaCieeTransition_ выше).
    const r0 = abcPushOxanaCieeTransition_(false);
    const r1 = abcSyncStatusesAndPayments_(false);
    const r2 = abcFlagRefusedStudents_(false);
    const r3 = abcGenerateSverkaReport_(false);
    Logger.log("abcDailySync: %s", JSON.stringify({ r0: r0, r1: r1, r2: r2, r3: r3 }));
  } catch (err) {
    Logger.log("abcDailySync failed: %s", err);
    try { reportError_("abcDailySync", err, {}); } catch (ignore) {}
  }
}

function abcDryRunTest() {
  const result = {
    pushOxanaCiee: abcPushOxanaCieeTransition_(true),
    statuses: abcSyncStatusesAndPayments_(true),
    refused: abcFlagRefusedStudents_(true),
    sverka: abcGenerateSverkaReport_(true),
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// 24.09.2026: диагностика abcListResponsibleNames() показала, что в воронке
// self за ответственными в CRM числится не только Айжан/Жансая (35/171
// сделка), но и Андрей — 18 сделок (совпадает с тем, что ловит failedUpdates
// в abcSyncStatusesAndPayments_: 13 из этих 18 расходятся со значением в
// таблице). Владелец подтвердил: self ведут только Айжан и Жансая, Андрей к
// self отношения не имеет (работает по «Фулл», который пока не трогаем) —
// поэтому список допустимых значений в дропдауне «Ответственный» и логика
// синхронизации остаются как есть, эти строки продолжают попадать в
// failedUpdates и пропускаться. Диагностическая функция была одноразовой и
// удалена после использования.

// 25.09.2026 (обратная синхронизация: таблица -> amoCRM, ОДИН конкретный
// переход, по просьбе владельца). Владелец подтвердил условия:
//   1) CRM главнее таблицы — таблица второстепенна, при любом расхождении
//      побеждает CRM (см. ниже про порядок вызова в abcDailySync).
//   2) Из таблицы можно менять ТОЛЬКО статус, больше ничего (не
//      ответственного, не оплату).
//   3) Разрешён ровно один переход: Оксана в «Студенты» ставит статус
//      «Передан в CIEE» ТОЛЬКО когда сделка в CRM сейчас в статусе «Job
//      Submitted to CIEE Oxana» (id 88549674, воронка self) — тогда скрипт
//      переставляет сделку в CRM на статус «Передан в CIEE» (id 88370982).
//      Точные id получены разовой диагностикой abcListPipelineStatuses()
//      (список статусов воронки self, см. историю чата 24.09.2026) —
//      функция после использования удалена, сама диагностика больше не
//      нужна.
//   4) Любое другое ручное изменение статуса в таблице НЕ пушится в CRM —
//      следующий abcSyncStatusesAndPayments_ просто перезапишет его обратно
//      значением из CRM (правило «CRM главнее» соблюдается автоматически,
//      без отдельной проверки конфликтов).
// Сопоставление сделки — по телефону, как и везде в этом файле;
// неоднозначные совпадения (несколько сделок на один телефон) пропускаются
// по той же причине, что и в abcSyncStatusesAndPayments_ (см. шапку файла).
const ABC_STATUS_JOB_SUBMITTED_TO_CIEE_OXANA_ = 88549674; // «Job Submitted to CIEE Oxana»
const ABC_STATUS_PEREDAN_V_CIEE_ = 88370982; // «Передан в CIEE»
const ABC_STATUS_PEREDAN_V_CIEE_NAME_ = "Передан в CIEE";

function abcPushOxanaCieeTransition_(dryRun) {
  const amo = abcFetchAmoData_();
  const amoByPhone = abcGroupByPhone_(amo);
  const { rows } = abcReadStudentsSheet_();

  const pushed = [];
  const failed = [];

  rows.forEach((row) => {
    const matches = amoByPhone[row.phoneNorm];
    if (!matches || matches.length !== 1) return;
    const lead = matches[0];
    if (
      lead.statusId === ABC_STATUS_JOB_SUBMITTED_TO_CIEE_OXANA_ &&
      row.status === ABC_STATUS_PEREDAN_V_CIEE_NAME_
    ) {
      if (!dryRun) {
        try {
          updateDealStatus_(lead.id, ABC_STATUS_PEREDAN_V_CIEE_);
          pushed.push({ fio: row.fio, dealId: lead.id });
        } catch (e) {
          failed.push({ fio: row.fio, dealId: lead.id, error: String(e) });
        }
      } else {
        pushed.push({ fio: row.fio, dealId: lead.id });
      }
    }
  });

  return {
    pushed: pushed.length,
    failed: failed.length,
    failedSample: failed,
    dryRun: !!dryRun,
    sample: pushed.slice(0, 10),
  };
}
