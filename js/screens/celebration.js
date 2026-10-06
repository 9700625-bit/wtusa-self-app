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

export async function render(container, params, роутер) {
  const stageId = params[0];
  const detail = await api.getStageDetail(stageId);
  const copy = CELEBRATION_COPY[stageId];

  // Пока ждали данные, студент открыл другой экран — никуда его не перенаправляем.
  if (роутер && typeof роутер.актуальна === "function" && !роутер.актуальна()) return;

  if (!detail || !copy) {
    window.location.hash = "home";
    return;
  }

  // ПОЗДРАВЛЯЕМ ТОЛЬКО С ТЕМ, ЧТО СЛУЧИЛОСЬ (05.10.2026). Экран не смотрел, дошёл ли
  // студент до этапа: по любой ссылке вида celebration/<этап> он поздравлял с визой
  // или DS-2019 того, у кого их ещё нет. Будущий этап открываем обычным экраном
  // этапа; redirect роутера не оставляет этот адрес в истории, чтобы «Назад» не зациклился.
  if (detail.status === "upcoming") {
    if (роутер && typeof роутер.redirect === "function") роутер.redirect("status/" + stageId);
    else window.location.hash = "status/" + stageId;
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
