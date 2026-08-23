/**
 * Phase-1-only "Demo" panel: lets anyone previewing the prototype jump the
 * mock participant to any pipeline stage (or trigger the Job Problem branch)
 * without a backend, so every screen state described in the ТЗ is reachable
 * and clickable. This has no equivalent in production — once amoCRM drives
 * `currentStageId` for real, this whole panel is deleted.
 */

import { GROUPS, STAGES, SELECTABLE_STAGE_IDS, getStage } from "../config/roadmap.config.js";
import * as api from "../services/api.js";
import { stageRoute } from "../utils/navigation.js";

export function mountDemoPanel() {
  const trigger = document.createElement("button");
  trigger.className = "demo-fab";
  trigger.setAttribute("aria-label", "Demo controls");
  trigger.textContent = "⚙";
  document.body.appendChild(trigger);

  const overlay = document.createElement("div");
  overlay.className = "demo-overlay";
  overlay.innerHTML = `
    <div class="demo-sheet">
      <div class="demo-sheet-header">
        <b>Demo · выбрать этап</b>
        <button class="demo-close" aria-label="Закрыть">✕</button>
      </div>
      <div class="sub" style="margin-bottom:10px">Только для прототипа: меняет mock-статус участника, как если бы координатор перевёл сделку в amoCRM.</div>
      <div class="demo-groups"></div>
      <div class="kicker" style="margin-top:10px">Смоделировать проблему</div>
      <div class="demo-stage-list" id="demo-branch-list" style="margin-top:6px"></div>
    </div>`;
  document.body.appendChild(overlay);

  const groupsEl = overlay.querySelector(".demo-groups");
  groupsEl.innerHTML = GROUPS.map((group) => {
    const stages = STAGES.filter((s) => s.group === group.id && SELECTABLE_STAGE_IDS.includes(s.id));
    return `
      <div class="demo-group">
        <div class="kicker">${group.title}</div>
        <div class="demo-stage-list">
          ${stages
            .map((s) => `<button class="demo-stage-btn" data-stage="${s.id}">${s.icon || ""} ${s.shortTitle}</button>`)
            .join("")}
        </div>
      </div>`;
  }).join("");

  function close() {
    overlay.classList.remove("open");
  }

  trigger.addEventListener("click", () => overlay.classList.add("open"));
  overlay.querySelector(".demo-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelectorAll("[data-stage]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stageId = btn.dataset.stage;
      await api._debugSetCurrentStage(stageId);
      close();
      // Celebration stages (Placed, DS-2019 Issued, Visa Approved, Ready to
      // Fly) preview the full-screen takeover; everything else lands on
      // Home so you see the dashboard reacting to the new stage.
      const stage = getStage(stageId);
      const target = stage && stage.celebration ? stageRoute(stage) : "home";
      window.location.hash = target;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  });

  // One button per branch stage (currently just JOB_PROBLEM) — generated
  // from STAGES instead of hardcoded, so a new branch stage shows up here
  // automatically.
  const branchListEl = overlay.querySelector("#demo-branch-list");
  const branchStages = STAGES.filter((s) => s.branch);
  branchListEl.innerHTML = branchStages
    .map((s) => `<button class="demo-stage-btn" data-branch-stage="${s.id}">${s.icon || "⚠️"} ${s.shortTitle}</button>`)
    .join("");
  branchListEl.querySelectorAll("[data-branch-stage]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stageId = btn.dataset.branchStage;
      await api._debugSetCurrentStage(stageId);
      close();
      window.location.hash = `status/${stageId}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  });
}
