import * as api from "../services/api.js";
import { formatDate } from "../utils/format.js?v=2";
import { goBack } from "../router.js";

export async function render(container) {
    const events = await api.getEvents();

  if (!events.length) {
        container.innerHTML = `
              <section class="screen active">
                      <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
                              <div class="card">
                                        <h2>Мероприятия</h2>
                                                  <div class="sub">Пока нет приглашений — координатор пришлёт уведомление, когда появится брифинг или встреча.</div>
                                                          </div>
                                                                </section>`;
        container.querySelector("#back-btn").addEventListener("click", goBack);
        return;
  }

  container.innerHTML = `
      <section class="screen active">
            <button class="btn secondary" id="back-btn" style="width:auto;padding:8px 14px;margin-bottom:12px">← Назад</button>
                  <h1 style="font-size:20px;margin:4px 0 12px">Мероприятия</h1>
                        ${events.map(eventCardHtml).join("")}
                            </section>`;

  container.querySelector("#back-btn").addEventListener("click", goBack);

  container.querySelectorAll("[data-confirm]").forEach((btn) => {
        btn.addEventListener("click", async () => {
                const groupId = btn.dataset.confirm;
                const select = container.querySelector(`#slot-${cssEscape(groupId)}`);
                const chosenEventId = select ? select.value : btn.dataset.singleSlot;
                btn.disabled = true;
                try {
                          await api.respondEvent(groupId, "confirm", chosenEventId);
                          render(container);
                } catch (err) {
                          btn.disabled = false;
                          alert(err.message || "Не удалось записаться, попробуйте ещё раз.");
                }
        });
  });

  container.querySelectorAll("[data-decline]").forEach((btn) => {
        btn.addEventListener("click", async () => {
                const groupId = btn.dataset.decline;
                btn.disabled = true;
                try {
                          await api.respondEvent(groupId, "decline");
                          render(container);
                } catch (err) {
                          btn.disabled = false;
                          alert(err.message || "Не удалось сохранить ответ, попробуйте ещё раз.");
                }
        });
  });
}

function eventCardHtml(ev) {
    if (ev.attended !== null) {
          return `
                <div class="card">
                        <div class="kicker">${ev.title}</div>
                                <h2>${ev.attended ? "✅ Вы посетили" : "Мероприятие прошло"}</h2>
                                        <div class="sub">${ev.description}</div>
                                              </div>`;
    }

  const slotsHtml =
        ev.slots.length > 1
        ? `<select id="slot-${ev.groupId}" style="width:100%;border:1px solid var(--line);background:#fff;padding:10px;border-radius:10px;margin:10px 0">
                  ${ev.slots
                                .map((s) => {
                                                const full = s.spotsLeft === 0 && s.id !== ev.chosenEventId;
                                                return `<option value="${s.id}" ${s.id === ev.chosenEventId ? "selected" : ""} ${full ? "disabled" : ""}>
                                                                ${formatDate(s.date)}${s.time ? " · " + s.time : ""}${s.spotsLeft !== null ? ` · мест: ${s.spotsLeft}` : ""}
                                                                              </option>`;
                                })
                                .join("")}
                                        </select>`
          : `<div class="status">
                    <span class="dot active"></span>
                              <div><b>${formatDate(ev.slots[0].date)}${ev.slots[0].time ? " · " + ev.slots[0].time : ""}</b>
                                          <div class="sub">${ev.slots[0].location || ""}</div>
                                                    </div>
                                                            </div>`;

  const statusTagHtml =
        ev.status === "confirmed"
        ? `<div class="tag ok" style="display:inline-block;margin-top:10px">Вы записаны ✅</div>`
          : ev.status === "declined"
        ? `<div class="tag miss" style="display:inline-block;margin-top:10px">Вы отказались</div>`
          : "";

  const singleSlotAttr = ev.slots.length === 1 ? ` data-single-slot="${ev.slots[0].id}"` : "";

  return `
      <div class="card">
            <div class="kicker">Приглашение</div>
                  <h2>📅 ${ev.title}</h2>
                        <div class="sub">${ev.description || ""}</div>
                              ${slotsHtml}
                                    ${statusTagHtml}
                                          <div style="display:grid;gap:8px;margin-top:10px">
                                                  <button class="btn" data-confirm="${ev.groupId}"${singleSlotAttr}>${ev.status === "confirmed" ? "Изменить время" : "Записаться"}</button>
                                                          ${ev.status !== "declined" ? `<button class="btn secondary" data-decline="${ev.groupId}">Не приду</button>` : ""}
                                                                </div>
                                                                    </div>`;
}

/** group_id values are coordinator-chosen sheet text — escape for use in a CSS id selector. */
function cssEscape(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
