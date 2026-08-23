import * as api from "../services/api.js";
import { stageRoute } from "../utils/navigation.js";

function stepIconHtml(stage) {
  if (stage.status === "done") return "✓";
  if (stage.status === "current") return stage.icon || "•";
  return "";
}

function stepsHtmlFor(stages) {
  return stages
    .map((stage) => {
      // Independent of status — lit up once a coordinator marks the linked
      // event's attendance as "yes" (see deriveRoadmap / attendedRoadmapStageIds_).
      const attendedBadge = stage.attended
        ? ` <span class="tag ok" style="margin-left:6px">Посещено ✓</span>`
        : "";
      return `
      <div class="road-step ${stage.status}" data-route="${stageRoute(stage)}" role="button" tabindex="0">
        <div class="road-title">
          <span class="num">${stepIconHtml(stage)}</span>${stage.title}${attendedBadge}
        </div>
        <div class="road-desc">${stage.description}</div>
      </div>`;
    })
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
  // main linear list (getStagesByGroup filters out branch stages, so this
  // group's own stages never report status "current" for it — see
  // roadmap.config.js) — demo panel/notifications may deep-link into it, and
  // it's useful for QA to reach it from the roadmap too when active.
  if (currentStageId === "JOB_PROBLEM") {
    // Was `querySelectorAll("details.card")[3]` — a positional guess ("job_offer
    // is 4th group") that silently pointed at the wrong group the moment GROUPS
    // in roadmap.config.js was reordered. Look the group up by its real id instead.
    const jobOfferGroup = container.querySelector('details.card[data-group="job_offer"]');
    if (jobOfferGroup) {
      const body = jobOfferGroup.querySelector(".road-steps");
      // Because job_offer isn't the "current" group above, it was left as an
      // empty lazy shell (data-lazy, not yet filled) — the banner below then
      // got prepended into it, open or not. The very first time the student
      // expanded this group to read the warning, the lazy-fill "toggle"
      // handler ran body.innerHTML = stepsHtmlFor(...) and silently wiped
      // the banner out along with everything else in the div. Force this
      // group open and fill it right now (marking it "filled" so that
      // handler skips it) so the banner survives being opened.
      if (body && !body.dataset.filled) {
        body.dataset.filled = "1";
        const group = groupsById.get("job_offer");
        if (group) {
          body.innerHTML = stepsHtmlFor(group.stages);
          bindStepHandlers(body);
        }
      }
      jobOfferGroup.open = true;

      const banner = document.createElement("div");
      banner.className = "road-step warn";
      banner.setAttribute("role", "button");
      banner.setAttribute("tabindex", "0");
      banner.innerHTML = `<div class="road-title">⚠️ Требуется ваше внимание</div><div class="road-desc">По вашему Job Offer появились замечания. Нажмите, чтобы посмотреть детали.</div>`;
      const openDetail = () => (window.location.hash = "status/JOB_PROBLEM");
      banner.addEventListener("click", openDetail);
      banner.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") openDetail();
      });
      if (body) body.prepend(banner);
    }
  }
}
