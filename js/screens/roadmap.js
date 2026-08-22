import * as api from "../services/api.js";
import { stageRoute } from "../utils/navigation.js";

function stepIconHtml(stage) {
  if (stage.status === "done") return "✓";
  if (stage.status === "current") return stage.icon || "•";
  return "";
}

function stepsHtmlFor(stages) {
  return stages
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
}

function bindStepHandlers(root) {
  root.querySelectorAll("[data-route]").forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    const go = () => {
      window.location.hash = el.dataset.route;
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go();
    });
  });
}

export async function render(container) {
  const { groups, currentStageId, progress } = await api.getRoadmap();

  // Only the currently-active group's steps are built up front. A native
  // <details> keeps its children in the DOM even while collapsed, so
  // rendering all ~27 stages' markup on every mount (as before) was the
  // real cost behind "Путь" feeling slower than the other tabs. Closed
  // groups now render an empty shell and get their steps built lazily the
  // first time the user actually opens them.
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

      const bodyHtml = isCurrentGroup ? stepsHtmlFor(group.stages) : "";

      return `
      <details class="card" data-group="${group.id}" ${isCurrentGroup ? "open" : ""} ${isCurrentGroup ? "" : 'data-lazy="1"'}>
        <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center">
          <span><b>${group.title}</b></span>
          ${badge}
        </summary>
        <div style="margin-top:8px" class="road-steps">${bodyHtml}</div>
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

  bindStepHandlers(container);

  const groupsById = new Map(groups.map((g) => [g.id, g]));
  container.querySelectorAll("details[data-lazy]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      const body = details.querySelector(".road-steps");
      if (body.dataset.filled) return;
      body.dataset.filled = "1";
      const group = groupsById.get(details.dataset.group);
      body.innerHTML = stepsHtmlFor(group.stages);
      bindStepHandlers(body);
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
      const targetDiv = jobOfferGroup.querySelector("div[style]");
      if (targetDiv) targetDiv.prepend(banner);
    }
  }
}
