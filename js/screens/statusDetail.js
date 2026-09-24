import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatDate, daysUntil, daysLabel, esc } from "../utils/format.js?v=3";
import { goBack } from "../router.js";

// ЦВЕТНАЯ ТОЧКА ВМЕСТО ЭМОДЗИ (22.09.2026): 🟢🔵🔴 рисуются по-разному на
// iPhone/Android и не совпадают с остальной графикой. Теперь — обычный
// кружок цветом важности, как точки в списках на других экранах.
const SEVERITY_COLOR = { ok: "var(--ok)", active: "#3b6fe0", wait: "#b8c2d1", warn: "#e0a100", danger: "var(--danger)" };
function severityDot(severity) {
  const c = SEVERITY_COLOR[severity] || "#b8c2d1";
  return `<span aria-hidden="true" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${c};vertical-align:middle;margin:-3px 10px 0 0"></span>`;
}

/**
 * «ЧТО ОЗНАЧАЕТ ЭТОТ СТАТУС?» → «ПОДРОБНЕЕ ОБ ЭТАПЕ» (22.09.2026).
 * Раньше — свёрнутый <details>, внутри три абзаца, часть из которых слово
 * в слово повторяла описание сверху. Теперь: на текущем этапе блок раскрыт
 * сразу (это самое важное, что есть на экране), на остальных — свёрнут;
 * строка, дублирующая описание, не показывается; пустые строки — тоже.
 */
function detailCardHtml(stage, isCurrentStage) {
  const d = stage.detail || {};
  const norm = (t) => String(t || "").trim().toLowerCase();
  const rows = [
    ["Что происходит", d.whatsHappening],
    ["Что нужно от вас", d.whatRequired],
    ["Что дальше", d.whatsNext],
  ].filter(([, text]) => text && norm(text) !== norm(stage.description));
  if (!rows.length) return "";
  return `
      <details class="card detail-card"${isCurrentStage ? " open" : ""}>
        <summary><b>Подробнее об этапе</b><span class="detail-chevron" aria-hidden="true"></span></summary>
        <div class="detail-body">
          ${rows.map(([label, text]) => `
          <div class="detail-row">
            <div class="kicker">${label}</div>
            <div class="sub">${esc(text)}</div>
          </div>`).join("")}
        </div>
      </details>`;
}

export async function render(container, params) {
  const stageId = params[0];
  const detail = await api.getStageDetail(stageId);

  if (!detail) {
    container.innerHTML = `<div class="card"><h2>Этап не найден</h2></div>`;
    return;
  }

  const { stage, isCurrentStage } = detail;
  const emoji = severityDot(stage.severity);

  let extraHtml = "";

  if (stage.id === "CIEE_REGISTRATION" && stage.deadlineDays) {
    // stage.cieeDaysRemaining is the real count from deriveStageDetail() once
    // the backend knows this participant's actual registration date (see
    // Api.gs/deriveViews.js). Without it (mock data, or before that date is
    // known yet) fall back to the old "just show the full window" placeholder
    // rather than a countdown that looks live but never moves.
    const hasReal = stage.cieeDaysRemaining != null;
    const remaining = hasReal ? stage.cieeDaysRemaining : stage.deadlineDays;
    const overdue = hasReal && remaining < 0;
    extraHtml += `
      <div class="card">
        <h3>Срок активации</h3>
        <div class="row"><div class="sub">${overdue ? "Просрочено" : "Осталось"}</div><div class="metric">${daysLabel(Math.abs(remaining))}</div></div>
      </div>`;
  }

  if (stage.id === "VISA_FINAL_CALL" || stage.id === "VISA_INTERVIEW_SCHEDULED") {
    // 04.09.2026: интервью впервые становится известным на VISA_INTERVIEW_SCHEDULED
    // (новый этап), а VISA_FINAL_CALL — это просто напоминание перед ним же, так
    // что карточка с датой/временем/обратным отсчётом нужна на обоих.
    const visa = await api.getVisaInfo();
    const days = daysUntil(visa.appointmentDate);
    extraHtml += `
      <div class="card hero">
        <div class="sub">US Visa Interview 🇺🇸</div>
        <h1 style="margin-bottom:2px">${
          // Пока координатор не внёс запись об интервью, бэкенд отдаёт здесь
          // null, а formatDate возвращал его как есть — в шаблонной строке это
          // печаталось словом «null», три раза подряд (02.09.2026).
          visa.appointmentDate ? formatDate(visa.appointmentDate, { forceYear: true }) : "Дата пока не назначена"
        }</h1>
        ${
          visa.appointmentTime || visa.location
            ? `<div class="sub">${[esc(visa.appointmentTime), esc(visa.location)].filter(Boolean).join(" · ")}</div>`
            : `<div class="sub">Координатор сообщит время и место, как только назначит интервью.</div>`
        }
        ${days !== null && days >= 0 ? `<div class="row" style="margin-top:10px"><div class="sub">До интервью</div><div class="metric">${daysLabel(days)}</div></div>` : ""}
      </div>`;
  }

  if (stage.id === "VISA_APPROVED" && stage.checklist) {
    // amoCRM has no status after VISA APPROVE (the deal is simply won from
    // here), so there's no separate "Pre-Departure"/"Ready to fly" stage to
    // advance current_stage_id into — this whole checklist lives inside
    // VISA_APPROVED's own detail screen instead, and "ready to fly" is
    // computed client-side from checklist completion rather than being a
    // distinct backend-driven state.
    const checklist = await api.getPreDepartureChecklist();
    const allDone = checklist.length > 0 && checklist.every((item) => item.done);
    extraHtml += `
      <div class="card">
        <h3>Чек-лист подготовки</h3>
        ${checklist
          .map(
            (item) => `
          <label class="status" style="cursor:pointer">
            <input type="checkbox" data-checklist="${item.id}" ${item.done ? "checked" : ""} style="width:18px;height:18px;margin-top:2px" />
            <div><b style="${item.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${item.label}</b></div>
          </label>`
          )
          .join("")}
      </div>
      ${
        allDone
          ? `<div class="card hero" style="text-align:center;padding:28px 20px">
               <div style="font-size:44px;line-height:1;margin-bottom:8px">✈️</div>
               <h2>READY TO FLY</h2>
               <div class="sub" style="margin-top:4px">Все пункты чек-листа закрыты. Вы готовы к вылету в США!</div>
             </div>`
          : ""
      }`;
  }

  if (stage.coordinatorComment) {
    extraHtml += `
      <div class="card" style="border-left:4px solid var(--danger);padding-left:12px">
        <h3>Комментарий координатора</h3>
        <div class="sub"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M4 5.5h16v10H9l-4.5 3.5z"/></svg>${esc(stage.coordinatorComment)}</div>
      </div>`;
  }

  // Карточка «Напоминания в Telegram» была здесь и обещала рассылку, которой
  // не существует (см. комментарий у VISA_FINAL_CALL в roadmap.config.js).
  // Удалена вместе с полем reminderSchedule 03.09.2026. Если рассылку
  // когда-нибудь напишут в Reminders.gs и повесят time-driven триггер —
  // вернуть можно обе части, но только вместе.

  /**
   * СВЯЗЬ С КООРДИНАТОРОМ ЕСТЬ НА КАЖДОМ ЭТАПЕ (14.09.2026).
   *
   * Кнопка «Написать координатору» стояла ровно на двух этапах из двадцати.
   * На тринадцати не было ВООБЩЕ ни одной кнопки: этапы ожидания — студенту
   * там нечего делать, и формально это правда. Но именно на них он проводит
   * больше всего времени, и именно там естественно хочется спросить «а долго
   * ещё?». Выхода из экрана не было никакого.
   *
   * Добавляем запасную кнопку ко всем этапам, где своей такой нет. Это не
   * трогает roadmap.config.js: тексты этапов остаются как согласованы, кнопка
   * появляется из кода.
   *
   * Заодно исправлена мелочь: раньше вторичная кнопка рисовалась только
   * вместе с главной (`ctaHtml ? ...`), поэтому этап с одной лишь вторичной
   * кнопкой не показал бы ничего.
   */
  const кнопки = [];
  // ГЛАВНАЯ КНОПКА — ТОЛЬКО НА ТЕКУЩЕМ ЭТАПЕ (22.09.2026). На пройденном
  // этапе она оставалась активной: студент с этапа «Ищем работодателя» мог
  // открыть предыдущий «Анкета CIEE проверена» и снова нажать «У меня есть
  // Job Offer». То же с будущими этапами. Не текущий этап — только
  // «Написать координатору» (writeCoordinator как главная кнопка остаётся).
  const ctaЗакрыта = stage.cta && stage.cta.action !== "writeCoordinator" && !isCurrentStage;
  if (stage.cta && !ctaЗакрыта) {
    // stage.ctaDone — кнопка уже нажималась (флаг из state, см.
    // deriveStageDetail). Рисуем серой, неактивной и без обработчика: второй
    // раз отправить координатору нельзя ни с этого экрана, ни после перезахода.
    кнопки.push(
      stage.ctaDone
        ? `<button class="btn" disabled data-cta-done="${stage.cta.action}">✓ Подтверждено — передано координатору</button>`
        : `<button class="btn" data-cta="${stage.cta.action}">${stage.cta.label}</button>`
    );
  }
  if (stage.secondaryCta) {
    кнопки.push(`<button class="btn secondary" data-cta="${stage.secondaryCta.action}">${stage.secondaryCta.label}</button>`);
  }
  const ужеЕсть =
    (stage.cta && stage.cta.action === "writeCoordinator") ||
    (stage.secondaryCta && stage.secondaryCta.action === "writeCoordinator");
  if (!ужеЕсть) {
    кнопки.push('<button class="btn secondary" data-cta="writeCoordinator">Написать координатору</button>');
  }
  const ctaHtml = кнопки.join("");

  container.innerHTML = `
    <section class="screen active">
      <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
      <div class="card" style="border-left:4px solid ${severityBorderColor(stage.severity)};padding-left:12px">
        <div class="kicker">${
          // «ЭТАП ПРОЙДЕН» У БУДУЩИХ ЭТАПОВ (найдено прогоном 23.09.2026):
          // любой не текущий этап подписывался как пройденный, включая те, до
          // которых студент ещё не дошёл. detail.status — done / current / upcoming.
          isCurrentStage ? "Текущий этап" : detail.status === "done" ? "Этап пройден" : "Предстоит"
        }</div>
        <h1>${emoji}${stage.title}</h1>
        <div class="sub">${stage.description}</div>
        ${ctaHtml ? `<div style="margin-top:14px;display:grid;gap:8px">${ctaHtml}</div>` : ""}
      </div>
      ${extraHtml}
      ${detailCardHtml(stage, isCurrentStage)}
    </section>`;

  container.querySelector("#back-btn").addEventListener("click", goBack);
container.querySelectorAll("[data-cta]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    // Одноразовые кнопки: блокируем сразу, чтобы повторное нажатие (до
    // ответа бэкенда) не ушло вторым запросом в amoCRM; бэкенд всё равно
    // идемпотентен, но зачем лишние запросы.
    //
    // ДОБАВЛЕН confirmJobOffer (14.09.2026). Защита стояла только на
    // confirmVisaReady, хотя вторая кнопка устроена ровно так же: «У меня
    // есть Job Offer» на этапе CIEE_FILLED тоже ставит задачу координатору
    // и тоже одноразовая по смыслу. Без блокировки её можно было нажимать
    // сколько угодно раз подряд, и каждое нажатие уходило на сервер.
    if (btn.dataset.cta === "confirmVisaReady" || btn.dataset.cta === "confirmJobOffer") {
      if (btn.disabled) return;
      const original = btn.textContent;
      btn.disabled = true;
      try {
        await runCtaAction(btn.dataset.cta, { stageId: stage.id });
        btn.textContent = "✓ Подтверждено — передано координатору";
      } catch (err) {
        console.error("[statusDetail] confirmVisaReady failed:", err);
        btn.disabled = false;
        btn.textContent = original;
      }
      return;
    }
    runCtaAction(btn.dataset.cta, { stageId: stage.id });
  });
});
  container.querySelectorAll("[data-checklist]").forEach((input) => {
    input.addEventListener("change", async () => {
      // Lock the checkbox for the duration of the request -- without this,
      // toggling it twice quickly (or a keyboard user holding Enter/Space)
      // fires two overlapping toggleChecklistItem calls that race each
      // other and can leave the checked state flipped the wrong number of
      // times.
      input.disabled = true;
      // СБОЙ СОХРАНЕНИЯ БЫЛ НЕВИДИМ (02.09.2026). При ошибке сети промис
      // отклонялся прямо в обработчике: render() не вызывался, галочка
      // оставалась отмеченной и заблокированной. Студент был уверен, что
      // прогресс сохранён, а на сервере ничего не было — и при следующем
      // заходе галочка исчезала без объяснений.
      const былаОтмечена = input.checked;
      try {
        await api.toggleChecklistItem(input.dataset.checklist);
        render(container, params);
      } catch (err) {
        console.error("[checklist] не удалось сохранить:", err);
        input.checked = !былаОтмечена; // возвращаем как было — правда важнее вида
        input.disabled = false;
        const ряд = input.closest("label") || input.parentElement;
        if (ряд && !ряд.querySelector(".checklist-err")) {
          const подсказка = document.createElement("div");
          подсказка.className = "small checklist-err";
          подсказка.style.color = "var(--danger)";
          подсказка.textContent = "Не сохранилось — проверьте связь и нажмите ещё раз.";
          ряд.appendChild(подсказка);
          setTimeout(() => подсказка.remove(), 5000);
        }
      }
    });
  });
}

function severityBorderColor(severity) {
  const map = { ok: "var(--ok)", active: "#4c78ff", wait: "var(--muted)", warn: "var(--warn)", danger: "var(--red)" };
  return map[severity] || "var(--line)";
}
