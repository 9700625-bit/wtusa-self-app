import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatDate, formatMoney, daysUntil, daysLabel, esc } from "../utils/format.js?v=2";
import { stageRoute } from "../utils/navigation.js";

export async function render(container) {
  const [dashboard] = await Promise.all([api.getDashboard()]);
  const { participant, currentStage, progress, action, nearestPayment, nearestBriefing } = dashboard;

  const actionBlockHtml = action.actionRequired
    ? `
      <div class="card action">
        <div class="kicker">Сейчас</div>
        <h2>🔴 ${action.title}</h2>
        <div class="sub">${action.description}</div>
        ${action.cta ? `<button class="btn" style="margin-top:12px" data-cta="${action.cta.action}">${action.cta.label}</button>` : ""}
      </div>`
    : `
      <div class="card action" style="border-left-color:var(--ok)">
        <div class="kicker">Сейчас</div>
        <h2>🟢 От вас ничего не требуется</h2>
        <div class="sub">Мы сообщим, когда статус изменится. Следующий шаг появится автоматически.</div>
      </div>`;

  const paymentDays = nearestPayment ? daysUntil(nearestPayment.deadline) : null;
  const paymentDot = paymentDays !== null && paymentDays <= 3 ? "warn" : "active";

  const upcomingHtml = `
    <div class="card">
      <h3>Ближайшее</h3>
      ${
        nearestPayment
          ? `<div class="status">
              <span class="dot ${paymentDot}"></span>
              <div><b>${nearestPayment.label}</b>
                <div class="sub">до ${formatDate(nearestPayment.deadline)} · ${formatMoney(nearestPayment.amount, nearestPayment.currency)}${
                  paymentDays !== null
        ? paymentDays < 0
          // Просроченный платёж на главной подписывался «осталось N дней» —
          // daysLabel берёт модуль числа, а знак никто не разбирал. Экран
          // «Оплата» тот же платёж честно называл просроченным, и два экрана
          // противоречили друг другу; верил студент главному (02.09.2026).
          ? ` · просрочено на ${daysLabel(paymentDays)}`
          : ` · осталось ${daysLabel(paymentDays)}`
        : ""
                }</div>
              </div>
            </div>`
          : ""
      }
      ${
        nearestBriefing
          ? `<div class="status">
              <span class="dot ${nearestBriefing.date ? "active" : "wait"}"></span>
              <div><b>${nearestBriefing.title}</b>
                <div class="sub">${nearestBriefing.date ? formatDate(nearestBriefing.date) + (nearestBriefing.time ? " · " + nearestBriefing.time : "") : "Дата появится позже"}</div>
              </div>
            </div>`
          : ""
      }
      ${!nearestPayment && !nearestBriefing ? `<div class="sub">Ближайших дедлайнов нет.</div>` : ""}
    </div>`;

  container.innerHTML = `
    <section class="screen active">
      <div class="card hero">
        <div class="sub">Добрый день, ${esc(participant.name)} 👋</div>
        <h1>Моя программа</h1>
        <div class="row">
          <div>
            <div class="sub">Текущий этап</div>
            <div class="metric" data-route="${stageRoute(currentStage)}" style="cursor:pointer;text-decoration:underline dotted">${currentStage.shortTitle}</div>
          </div>
          <div style="text-align:right">
            <div class="sub">Прогресс</div>
            <div class="metric">${progress}%</div>
          </div>
        </div>
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="sub">${currentStage.description}</div>
      </div>
      ${actionBlockHtml}
      ${upcomingHtml}
      <button class="btn secondary" data-nav="roadmap">Посмотреть весь путь</button>
    </section>`;

  container.querySelector('[data-nav="roadmap"]').addEventListener("click", () => {
    window.location.hash = "roadmap";
  });

  container.querySelectorAll("[data-cta]").forEach((btn) => {
    btn.addEventListener("click", () => runCtaAction(btn.dataset.cta, { stageId: action.stageId }));
  });

  container.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", () => {
      window.location.hash = el.dataset.route;
    });
  });
}
