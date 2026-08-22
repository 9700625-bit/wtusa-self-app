import * as api from "../services/api.js";
import { paymentTagHtml } from "../components/statusBadge.js";
import { formatDate, formatMoney, daysLabel } from "../utils/format.js";

function timingText(p) {
  if (p.status === "paid" && p.paidDate) return `Оплачено ${formatDate(p.paidDate)}`;
  if (p.daysUntilDeadline == null) return `до ${formatDate(p.deadline)}`;
  if (p.daysUntilDeadline >= 0) return `до ${formatDate(p.deadline)} · осталось ${daysLabel(p.daysUntilDeadline)}`;
  return `до ${formatDate(p.deadline)} · просрочено на ${daysLabel(p.daysUntilDeadline)}`;
}

export async function render(container) {
  const { paidTotal, programCost, payments, visaFees, visaFeesUnlocked } = await api.getPayments();

  const paymentsHtml = payments
    .map((p) => {
      const currency = p.currency || "USD";
      const rateNote =
        currency === "USD"
          ? `<div class="small" style="margin-top:2px">Оплата в тенге по курсу Нацбанка РК на день оплаты</div>`
          : "";
      return `
      <div class="pay">
        <div>
          <b>${p.label}</b>
          <div class="small">${timingText(p)} · ${formatMoney(p.amount, currency)}</div>
          ${rateNote}
        </div>
        ${paymentTagHtml(p.status)}
      </div>`;
    })
    .join("");

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
