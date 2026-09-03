import * as api from "../services/api.js";
import { docTagHtml } from "../components/statusBadge.js";
import { esc } from "../utils/format.js?v=2";
import { openTelegramLink, hapticImpact } from "../services/telegram.js";

export async function render(container) {
  const [documents, me] = await Promise.all([api.getDocuments(), api.getMe()]);
  const coordinatorUsername = me.coordinator && me.coordinator.telegramUsername;

  // Was previously left as `` when documents.length === 0, rendering a
  // visibly empty <div class="card"> with no content or explanation --
  // reads as a broken/blank screen rather than "nothing here yet". Match
  // the empty-state pattern already used in events.js.
  const rowsHtml = documents.length
    ? documents
        .map(
          (doc) => `
      <div class="doc">
        <div>
          <b>${doc.type}</b>
          <div class="small">${esc(doc.note)}</div>
          ${doc.coordinatorComment ? `<div class="small" style="color:var(--danger);margin-top:4px">💬 ${esc(doc.coordinatorComment)}</div>` : ""}
        </div>
        ${docTagHtml(doc.status)}
      </div>`
        )
        .join("")
    : `<div class="sub">Список документов пока пуст — он появится, как только координатор его настроит.</div>`;

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
