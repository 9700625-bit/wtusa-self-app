import * as api from "../services/api.js";
import { docTagHtml } from "../components/statusBadge.js";
import { openTelegramLink, hapticImpact } from "../services/telegram.js";

export async function render(container) {
  const [documents, me] = await Promise.all([api.getDocuments(), api.getMe()]);
  const coordinatorUsername = me.coordinator && me.coordinator.telegramUsername;

  const rowsHtml = documents
    .map(
      (doc) => `
      <div class="doc">
        <div>
          <b>${doc.type}</b>
          <div class="small">${doc.note}</div>
          ${doc.coordinatorComment ? `<div class="small" style="color:var(--danger);margin-top:4px">💬 ${doc.coordinatorComment}</div>` : ""}
        </div>
        ${docTagHtml(doc.status)}
      </div>`
    )
    .join("");

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Документы</div>
        <h1>Мои документы</h1>
        <div class="sub">Статусы проверки ABC Universe.</div>
      </div>
      <div class="card">${rowsHtml}</div>
      <div class="card">
        <h3>Как отправить документ</h3>
        <div class="sub" style="margin-bottom:12px">
          Пришлите фото или скан координатору в личные сообщения в Telegram — как только он его проверит, статус здесь обновится сам.
          Если у вас на руках только бумажный паспорт — принесите его в офис, мы сделаем скан на месте.
        </div>
        ${
          coordinatorUsername
            ? `<button class="btn" id="doc-write-coordinator-btn">Написать координатору</button>`
            : `<div class="small">Координатор ещё не назначен — уточните у ABC Universe.</div>`
        }
      </div>
    </section>`;

  const writeBtn = container.querySelector("#doc-write-coordinator-btn");
  if (writeBtn) {
    writeBtn.addEventListener("click", () => {
      hapticImpact("light");
      openTelegramLink(`https://t.me/${coordinatorUsername}`);
    });
  }
}
