import * as api from "../services/api.js";
import { hapticNotification } from "../services/telegram.js";

const CELEBRATION_COPY = {
  // 04.09.2026: PLACED переименован в PLACEMENT_COMPLETED вместе с
  // переработкой всей группы job_offer (см. roadmap.config.js).
  PLACEMENT_COMPLETED: {
    heading: "Job Offer подтверждён 🎉",
    emoji: "🇺🇸",
    lines: ["Ваш Job Offer полностью подтверждён CIEE.", "Один из главных этапов программы завершён."],
  },
  DS2019_ISSUED: {
    heading: "DS-2019 ISSUED",
    emoji: "🇺🇸",
    lines: ["Ваша форма DS-2019 выпущена.", "Теперь начинается визовый этап."],
  },
  VISA_APPROVED: {
    heading: "VISA APPROVED",
    emoji: "🇺🇸",
    lines: ["Congratulations!", "Ваша J-1 Visa одобрена — теперь закройте чек-лист подготовки к вылету."],
  },
};

export async function render(container, params) {
  const stageId = params[0];
  const detail = await api.getStageDetail(stageId);
  const copy = CELEBRATION_COPY[stageId];

  if (!detail || !copy) {
    window.location.hash = "home";
    return;
  }

  hapticNotification("success");

  const { next } = detail;

  container.innerHTML = `
    <section class="screen active">
      <div class="card hero" style="text-align:center;padding:36px 20px">
        <div style="font-size:56px;line-height:1;margin-bottom:10px">${copy.emoji}</div>
        <h1 style="font-size:26px;letter-spacing:.02em">${copy.heading}</h1>
        ${copy.lines.map((l) => `<div class="sub" style="font-size:15px;margin-top:6px">${l}</div>`).join("")}
        ${next ? `<div class="pill" style="margin-top:18px;display:inline-block">Следующий этап — ${next.title}</div>` : ""}
      </div>
      <button class="btn" id="continue-btn">Продолжить</button>
    </section>`;

  container.querySelector("#continue-btn").addEventListener("click", () => {
    window.location.hash = "home";
  });
}
