import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatDate, daysUntil, daysLabel } from "../utils/format.js?v=2";
import { goBack } from "../router.js";

const SEVERITY_EMOJI = { ok: "🟢", active: "🔵", wait: "⚪", warn: "🟡", danger: "🔴" };

export async function render(container, params) {
  const stageId = params[0];
  const detail = await api.getStageDetail(stageId);

  if (!detail) {
    container.innerHTML = `<div class="card"><h2>Этап не найден</h2></div>`;
    return;
  }

  const { stage, isCurrentStage } = detail;
  const emoji = SEVERITY_EMOJI[stage.severity] || "";

  let extraHtml = "";

  if (stage.id === "CIEE_REGISTRATION" && stage.deadlineDays) {
    // Registration date is mocked as "today - 1 day" so the countdown reads naturally.
    const remaining = stage.deadlineDays - 1;
    extraHtml += `
      <div class="card">
        <h3>Срок активации</h3>
        <div class="row"><div class="sub">Осталось</div><div class="metric">${daysLabel(Math.max(remaining, 0))}</div></div>
      </div>`;
  }

  if (stage.id === "VISA_APPOINTMENT" || stage.id === "VISA_INTERVIEW") {
    const visa = await api.getVisaInfo();
    const days = daysUntil(visa.appointmentDate);
    extraHtml += `
      <div class="card hero">
        <div class="sub">US Visa Interview 🇺🇸</div>
        <h1 style="margin-bottom:2px">${formatDate(visa.appointmentDate, { forceYear: true })}</h1>
        <div class="sub">${visa.appointmentTime} · ${visa.location}</div>
        ${days !== null && days >= 0 ? `<div class="row" style="margin-top:10px"><div class="sub">До интервью</div><div class="metric">${daysLabel(days)}</div></div>` : ""}
      </div>`;
  }

  if (stage.id === "PRE_DEPARTURE" && stage.checklist) {
    const checklist = await api.getPreDepartureChecklist();
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
      </div>`;
  }

  if (stage.coordinatorComment) {
    extraHtml += `
      <div class="card" style="border-left:4px solid var(--danger);padding-left:12px">
        <h3>Комментарий координатора</h3>
        <div class="sub">💬 ${stage.coordinatorComment}</div>
      </div>`;
  }

  if (stage.reminderSchedule) {
    extraHtml += `
      <div class="card">
        <h3>Напоминания в Telegram</h3>
        <div class="sub">${stage.reminderSchedule.join(" · ")}</div>
      </div>`;
  }

  const ctaHtml = stage.cta
    ? `<button class="btn" data-cta="${stage.cta.action}">${stage.cta.label}</button>`
    : "";
  const secondaryCtaHtml = stage.secondaryCta
    ? `<button class="btn secondary" data-cta="${stage.secondaryCta.action}">${stage.secondaryCta.label}</button>`
    : "";

  container.innerHTML = `
    <section class="screen active">
      <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
      <div class="card" style="border-left:4px solid ${severityBorderColor(stage.severity)};padding-left:12px">
        <div class="kicker">${isCurrentStage ? "Текущий этап" : "Этап пройден"}</div>
        <h1>${emoji} ${stage.title}</h1>
        <div class="sub">${stage.description}</div>
        ${ctaHtml ? `<div style="margin-top:14px;display:grid;gap:8px">${ctaHtml}${secondaryCtaHtml}</div>` : ""}
      </div>
      ${extraHtml}
      <details class="card">
        <summary style="cursor:pointer;list-style:none"><b>Что означает этот статус?</b></summary>
        <div style="margin-top:10px">
          <div class="profile-row"><div class="kicker">Что происходит?</div><div class="sub" style="margin-top:4px">${stage.detail.whatsHappening}</div></div>
          <div class="profile-row"><div class="kicker">Что требуется от меня?</div><div class="sub" style="margin-top:4px">${stage.detail.whatRequired}</div></div>
          <div class="profile-row"><div class="kicker">Что будет дальше?</div><div class="sub" style="margin-top:4px">${stage.detail.whatsNext}</div></div>
        </div>
      </details>
    </section>`;

  container.querySelector("#back-btn").addEventListener("click", goBack);
  container.querySelectorAll("[data-cta]").forEach((btn) => {
    btn.addEventListener("click", () => runCtaAction(btn.dataset.cta, { stageId: stage.id }));
  });
  container.querySelectorAll("[data-checklist]").forEach((input) => {
    input.addEventListener("change", async () => {
            // Lock the checkbox for the duration of the request -- without this,
            // toggling it twice quickly races two overlapping toggleChecklistItem
            // calls and can leave the checked state flipped the wrong number of
            // times.
            input.disabled = true;
      await api.toggleChecklistItem(input.dataset.checklist);
      render(container, params);
    });
  });
}

function severityBorderColor(severity) {
  const map = { ok: "var(--ok)", active: "#4c78ff", wait: "var(--muted)", warn: "var(--warn)", danger: "var(--red)" };
  return map[severity] || "var(--line)";
}
