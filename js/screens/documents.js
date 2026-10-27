import * as api from "../services/api.js";
import { docsVisible, docsRowsHtml } from "../utils/docsView.js";
import { openTelegramLink, hapticImpact } from "../services/telegram.js";

export async function render(container) {
  const [documents, me] = await Promise.all([api.getDocuments(), api.getMe()]);
  const coordinatorUsername = me.coordinator && me.coordinator.telegramUsername;

  // 23.10.2026: статусы — из листа «Документы» таблицы координаторов (колонки D–I), а не прежний статичный список.
  // documents === null — сервер блок не показывает (лист недоступен, ФИО не совпало, отказник): остаётся только
  // «Как отправить документ».
  const docsCard = docsVisible(documents)
    ? `<div class="card">
        <div class="kicker">Документы</div>
        <h1>Мои документы</h1>
        <div class="sub">Что уже получено ABC Universe и что ещё нужно сдать.</div>
      </div>
      <div class="card">${docsRowsHtml(documents)}</div>`
    : `<div class="card"><div class="kicker">Документы</div></div>`;

  container.innerHTML = `
    <section class="screen active">
      ${docsCard}
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
