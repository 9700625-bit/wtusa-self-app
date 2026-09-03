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
      const status = visaFeesUnlocked ? fee.status : "locked";
      const dot = status === "paid" ? "ok" : status === "unpaid" ? "warn" : "wait";
      const note = status === "paid" ? "Оплачено" : status === "unpaid" ? `Не оплачено · ${formatMoney(fee.amount)}` : "Откроется на визовом этапе";
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
          <div style="text-align:right"><div class="small">Стоимость программы</div><div class="metric">${formatMoney(programCost, "USD")}</div></div>
        </div>
      </div>
      <div class="card">${paymentsHtml}</div>
      <div class="card">
        <h3>Обязательные визовые сборы</h3>
        ${feesHtml}
      </div>
    </section>`;
}
