import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatDate, formatMoney, daysUntil, daysLabel, esc } from "../utils/format.js?v=3";
import { stageRoute } from "../utils/navigation.js";

export async function render(container) {
  const [dashboard] = await Promise.all([api.getDashboard()]);
  const { currentStage, progress, action, nearestPayment, nearestBriefing } = dashboard;

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

  // СРОК МОЖЕТ БЫТЬ ПУСТЫМ (03.09.2026). Раньше здесь безусловно печаталось
  // «до <дата>», и на платеже без срока выходило «до null» (formatDate
  // возвращал null на пустом значении). Случай не гипотетический: третий
  // платёж синхронизируется из amoCRM отдельно (syncVariablePayment3_ в
  // Webhooks.gs), и если координатор поставил статус «Не оплачено», но не
  // заполнил дату, платёж получает status: "awaiting" и deadline: "" —
  // и именно он попадает в блок «Ближайшее» на главной.
  const paymentWhen = nearestPayment && nearestPayment.deadline
    ? `до ${formatDate(nearestPayment.deadline)}`
    : "срок уточняется";

  const upcomingHtml = `
    <div class="card">
      <h3>Ближайшее</h3>
      ${
        nearestPayment
          ? `<div class="status">
              <span class="dot ${paymentDot}"></span>
              <div><b>${esc(nearestPayment.label)}</b>
                <div class="sub">${paymentWhen} · ${formatMoney(nearestPayment.amount, nearestPayment.currency)}${
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
              <div><b>${esc(nearestBriefing.title)}</b>
                <div class="sub">${nearestBriefing.date ? formatDate(nearestBriefing.date) + (nearestBriefing.time ? " · " + esc(nearestBriefing.time) : "") : "Дата появится позже"}</div>
              </div>
            </div>`
          : ""
      }
      ${!nearestPayment && !nearestBriefing ? `<div class="sub">Ближайших дедлайнов нет.</div>` : ""}
    </div>`;

  container.innerHTML = `
    <section class="screen active">
      <div class="card hero">
        <!-- БЕЗ ИМЕНИ (03.09.2026). Здесь было «Добрый день, ${name}», где
             name — это Participants.name, куда webhook кладёт НАЗВАНИЕ СДЕЛКИ
             amoCRM (см. syncParticipantFromDeal_ в Webhooks.gs). Названия
             сделок у нас служебные, так что приложение здоровалось со
             студентом строкой вроде «SELF 2027 / Алматы / заявка 412».
             Настоящее ФИО лежит в отдельном поле full_name, но оно
             заполнено не у всех и в приветствии выглядит казённо. Пока в
             amoCRM нет отдельного поля «имя для обращения» — здороваемся
             без имени: это лучше, чем обратиться неправильно. -->
        <div class="sub">Добрый день 👋</div>
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
