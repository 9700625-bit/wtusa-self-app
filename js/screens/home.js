import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatDate, formatMoney, daysUntil, daysLabel, esc } from "../utils/format.js?v=3";
import { stageRoute } from "../utils/navigation.js";

function nearestEventFrom_(events) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let best = null;
  (events || []).forEach((ev) => {
    if (ev.status === "declined" || ev.attended !== null) return;
    const chosen = ev.chosenEventId ? ev.slots.find((s) => s.id === ev.chosenEventId) : null;
    const candidates = chosen ? [chosen] : ev.slots;
    candidates.forEach((s) => {
      if (!s.date) return;
      const d = new Date(s.date + "T00:00:00");
      if (isNaN(d) || d < today) return;
      const key = s.date + (s.time || "");
      if (!best || key < best.key) best = { key, title: ev.title, date: s.date, time: s.time || "", groupId: ev.groupId, booked: !!chosen };
    });
  });
  return best;
}

export async function render(container) {
  // БЛИЖАЙШИЙ БРИФИНГ — ИЗ РЕАЛЬНЫХ ПРИГЛАШЕНИЙ (22.09.2026). Раньше он
  // брался из листа Briefings, который пуст с момента создания, — у живых
  // студентов блок не показывался никогда. Теперь — из «Событий»: ближайший
  // будущий слот (выбранный студентом или самый ранний), если приглашение
  // не отклонено. getEvents() кеширует ответ, лишнего запроса нет.
  const [dashboard, events] = await Promise.all([api.getDashboard(), api.getEvents().catch(() => [])]);
  const { currentStage, progress, action, nearestPayment, participant } = dashboard;
  const nearestBriefing = nearestEventFrom_(events);
  // ПРИВЕТСТВИЕ БЕЗ ИМЕНИ (23.09.2026, решение владельца). Имена в amoCRM
  // вбиты вручную, на русском и казахском, местами с ошибками — показывать
  // их студенту на главном экране рискованно. participant.fullName/firstName
  // остаются в state для кабинета координатора и уведомлений.
  const greeting = "Добро пожаловать в программу Work & Travel USA";

  const actionBlockHtml = action.actionRequired
    ? `
      <div class="card action">
        <div class="kicker">Сейчас</div>
        <h2><span class="sev-dot" style="background:var(--danger)"></span>${action.title}</h2>
        <div class="sub">${action.description}</div>
        ${
          action.cta
            ? action.ctaDone
              ? `<button class="btn" style="margin-top:12px" disabled>✓ Подтверждено — передано координатору</button>`
              : `<button class="btn" style="margin-top:12px" data-cta="${action.cta.action}">${action.cta.label}</button>`
            : ""
        }
      </div>`
    : `
      <div class="card action" style="border-left-color:var(--ok)">
        <div class="kicker">Сейчас</div>
        <h2><span class="sev-dot" style="background:var(--ok)"></span>От вас ничего не требуется</h2>
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
                <div class="sub">${paymentWhen} · ${
                  // СУММА МОЖЕТ БЫТЬ НУЛЁМ (14.09.2026). Экран «Оплата» с
                  // 02.09 пишет в этом случае «сумма уточняется», а главная
                  // продолжала печатать «$0» — и попадал сюда именно третий
                  // платёж, у которого сумма приходит из amoCRM и до
                  // заполнения равна нулю. Два экрана говорили студенту
                  // разное об одном платеже, а «$0» читается как «платить не
                  // нужно». Проверено на живых данных: у участника на этапе
                  // Placement Completed главная показывала «Оплата 3 · срок
                  // уточняется · $0».
                  Number(nearestPayment.amount) > 0
                    ? formatMoney(nearestPayment.amount, nearestPayment.currency)
                    : "сумма уточняется"
                }${
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
        <!-- Приветствие без имени (решение владельца, 23.09.2026). -->
        <div class="sub">${greeting}</div>
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
  btn.addEventListener("click", async () => {
    // Final Call — см. такой же комментарий в statusDetail.js: одноразовая кнопка,
    // блокируем её сразу, чтобы не ушло вторым запросом.
    // Обе одноразовые кнопки (23.09.2026): блокируем сразу, после успеха —
    // серая «Подтверждено», как на экране этапа; при ошибке возвращаем.
    if (btn.dataset.cta === "confirmVisaReady" || btn.dataset.cta === "confirmJobOffer") {
      if (btn.disabled) return;
      const original = btn.textContent;
      btn.disabled = true;
      try {
        await runCtaAction(btn.dataset.cta, { stageId: action.stageId });
        btn.textContent = "✓ Подтверждено — передано координатору";
      } catch (err) {
        console.error("[home] " + btn.dataset.cta + " failed:", err);
        btn.disabled = false;
        btn.textContent = original;
      }
      return;
    }
    runCtaAction(btn.dataset.cta, { stageId: action.stageId });
  });
});

  container.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", () => {
      window.location.hash = el.dataset.route;
    });
  });
}
