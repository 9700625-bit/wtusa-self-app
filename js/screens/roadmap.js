import * as api from "../services/api.js";
import { stageRoute } from "../utils/navigation.js";

function stepIconHtml(stage) {
  if (stage.status === "done") return "✓";
  if (stage.status === "current") return stage.icon || "•";
  return "";
}

export async function render(container) {
  const { groups, currentStageId, progress } = await api.getRoadmap();

  const groupsHtml = groups
    .map((group) => {
      const isCurrentGroup = group.stages.some((s) => s.status === "current");
      const groupState = group.stages.every((s) => s.status === "done")
        ? "done"
        : isCurrentGroup
        ? "current"
        : "upcoming";
      const badge =
        groupState === "done" ? `<span class="tag ok">Завершено</span>` : groupState === "current" ? `<span class="tag review">Сейчас</span>` : "";

      const stepsHtml = group.stages
        .map(
          (stage) => `
        <div class="road-step ${stage.status}" data-route="${stageRoute(stage)}" role="button" tabindex="0">
          <div class="road-title">
            <span class="num">${stepIconHtml(stage)}</span>${stage.title}
          </div>
          <div class="road-desc">${stage.description}</div>
        </div>`
        )
        .join("");

      return `
      <details class="card" ${isCurrentGroup ? "open" : ""}>
        <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center">
          <span><b>${group.title}</b></span>
          ${badge}
        </summary>
        <div style="margin-top:8px">${stepsHtml}</div>
      </details>`;
    })
    .join("");

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">SELF 2027</div>
        <h1>Мой путь</h1>
        <div class="sub">От оформления до вылета в США · прогресс ${progress}%</div>
      </div>
      ${groupsHtml}
    </section>`;

  container.querySelectorAll("[data-route]").forEach((el) => {
    const go = () => {
      window.location.hash = el.dataset.route;
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go();
    });
  });

  // Keep the JOB_PROBLEM branch reachable even though it isn't part of the
  // main linear list — demo panel/notifications may deep-link into it, and
  // it's useful for QA to reach it from the roadmap too when active.
  if (currentStageId === "JOB_PROBLEM") {
    const jobOfferGroup = container.querySelectorAll("details.card")[3]; // job_offer is 4th group
    if (jobOfferGroup) {
      const banner = document.createElement("div");
      banner.className = "road-step warn";
      banner.setAttribute("role", "button");
      banner.setAttribute("tabindex", "0");
      banner.innerHTML = `<div class="road-title">⚠️ Требуется ваше внимание</div><div class="road-desc">По вашему Job Offer появились замечания. Нажмите, чтобы посмотреть детали.</div>`;
      banner.addEventListener("click", () => (window.location.hash = "status/JOB_PROBLEM"));
      jobOfferGroup.querySelector("div[style]").prepend(banner);
    }
  }
}
