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

  if (stage.id === "VISA_FINAL_CALL") {
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
      // toggling it twice quickly (or a keyboard user holding Enter/Space)
      // fires two overlapping toggleChecklistItem calls that race each
      // other and can leave the checked state flipped the wrong number of
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
