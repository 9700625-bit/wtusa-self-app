import * as api from "../services/api.js";
import { paymentTagHtml } from "../components/statusBadge.js";
import { formatDate, formatMoney, daysLabel } from "../utils/format.js?v=3";

function timingText(p) {
  if (p.status === "paid" && p.paidDate) return `Оплачено ${formatDate(p.paidDate)}`;
  // Срок может быть ещё не известен: пока вебхук amoCRM не принёс дедлайны,
  // mergeWithDefaultPayments_ (Api.gs) отдаёт deadline: null. Без этой ветки
  // получалось «до » с висящим предлогом (а до правки formatDate — «до null»).
  if (!p.deadline) return "срок уточняется";
  if (p.daysUntilDeadline == null) return `до ${formatDate(p.deadline)}`;
  if (p.daysUntilDeadline >= 0) return `до ${formatDate(p.deadline)} · осталось ${daysLabel(p.daysUntilDeadline)}`;
  return `до ${formatDate(p.deadline)} · просрочено на ${daysLabel(p.daysUntilDeadline)}`;
}

export async function render(container) {
  const { paidTotal, programCost, payments, visaFees, visaFeesUnlocked } = await api.getPayments();

  // Was previously left as `` when payments.length === 0, rendering a
  // visibly empty <div class="card"> — matches the empty-state pattern
  // already used in events.js instead of showing a blank block.
  const paymentsHtml = payments.length
    ? payments
        .map((p) => {
          const currency = p.currency || "USD";
          // Payment 1 is quoted and paid in tenge directly — no conversion
          // involved. Payments 2/3 are quoted in $ but paid in tenge, so the
          // exact tenge amount depends on the National Bank of RK's rate on the
          // day of payment — we don't try to compute it ourselves.
          const rateNote =
            currency === "USD"
              ? `<div class="small" style="margin-top:2px">Оплата в тенге по курсу Нацбанка РК на день оплаты</div>`
              : "";
          return `
      <div class="pay">
        <div>
          <b>${p.label}</b>
          <div class="small">${timingText(p)} · ${
            // Сумма третьего платежа приходит из amoCRM и до синхронизации
            // равна нулю. Раньше это рисовалось как «Оплата 3 · $0» и читалось
            // студентом как «третий платёж не нужен» (02.09.2026).
            Number(p.amount) > 0 ? formatMoney(p.amount, currency) : "сумма уточняется"
          }</div>
          ${rateNote}
        </div>
        ${paymentTagHtml(p.status)}
      </div>`;
        })
        .join("")
    : `<div class="sub">График платежей пока не сформирован — появится после оформления сделки.</div>`;

  const feesHtml = visaFees
    .map((fee) => {
      // СУММУ ВИДНО, КАК ТОЛЬКО ЭТАП ОТКРЫТ (14.09.2026). Раньше строка
      // показывала сумму только при статусе "unpaid", а статус берётся из
      // листа VisaInfo — в который на сегодня не пишет ни один код: лист
      // пустой, бэкенд подставляет "locked", и сумма не показывалась НИКОМУ
      // и НИКОГДА, даже после визового этапа. Студент видел «Откроется на
      // визовом этапе» и на визовом этапе тоже.
      //
      // Теперь: до этапа — «откроется», после — сумма. Отметку «оплачено /
      // не оплачено» ставим, только если она реально есть в VisaInfo;
      // выдумывать её нельзя — сборы платятся мимо нас, мы не можем знать.
      const status = visaFeesUnlocked ? fee.status : "locked";
      const известен = status === "paid" || status === "unpaid";
      const dot = status === "paid" ? "ok" : visaFeesUnlocked ? "warn" : "wait";
      const note = !visaFeesUnlocked
        ? "Откроется на визовом этапе"
        : status === "paid"
          ? "Оплачено"
          : известен
            ? `Не оплачено · ${formatMoney(fee.amount)}`
            : formatMoney(fee.amount);
      return `
        <div class="status">
          <span class="dot ${dot}"></span>
          <div><b>${fee.label}</b><div class="sub">${note}</div></div>
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Оплата</div>
        <h1>График платежей</h1>
        <div class="row">
          <div><div class="small">Оплачено</div><div class="metric">${formatMoney(paidTotal, "USD")}</div></div>
          ${
            // ЛУЧШЕ НИЧЕГО, ЧЕМ НЕВЕРНАЯ ЦЕНА (14.09.2026).
            //
            // Стоимость программы переезжает в поле сделки amoCRM — она
            // разная у Self и Full и будет меняться. Пока в сделке её не
            // проставили, бэкенд присылает null, и колонка просто не
            // рисуется: «Оплачено» занимает строку одно.
            //
            // Раньше на этом месте всегда стояло число. Бралось оно из
            // настройки PROGRAM_COST_USD, а настройка не была задана —
            // значит срабатывало запасное значение, зашитое в коде, и
            // каждый студент видел одну и ту же сумму независимо от своего
            // тарифа и договорённостей.
            programCost
              ? `<div style="text-align:right"><div class="small">Стоимость программы</div><div class="metric">${formatMoney(programCost, "USD")}</div></div>`
              : ""
          }
        </div>
      </div>
      <div class="card">${paymentsHtml}</div>
      <div class="card">
        <h3>Обязательные визовые сборы</h3>
        ${feesHtml}
        ${
          // В ЧЁМ И ПО КАКОМУ КУРСУ ПЛАТИТЬ (14.09.2026). Оба сбора указаны
          // в долларах, но платятся в тенге, и курс тут НЕ Нацбанка, как у
          // платежей выше, — у консульского сбора свой курс посольства США.
          // Без этой строки студент видел две суммы в долларах и не понимал
          // ни где платить, ни по какому курсу пересчитывать.
          //
          // Суммы намеренно не пересчитываем сами: курс посольства меняется,
          // а ошибиться в деньгах хуже, чем не назвать цифру.
          visaFeesUnlocked
            ? `<div class="small" style="margin-top:10px">Оба сбора платятся напрямую в структуры США, не через ABC Universe. Консульский сбор — в тенге по курсу посольства на день оплаты.</div>`
            : ""
        }
      </div>
    </section>`;
}
