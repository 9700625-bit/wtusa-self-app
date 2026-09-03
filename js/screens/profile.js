import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatMoney, esc } from "../utils/format.js?v=3";

export async function render(container) {
  const { participant, coordinator, programCost } = await api.getMe();

  // ЭКРАНИРОВАНИЕ (03.09.2026). Здесь оставались четыре неэкранированные
  // подстановки — fullName, program, season, cieeId. Все четыре приходят из
  // amoCRM, то есть из полей, которые заполняет человек, а не наш код: это
  // ровно тот случай, ради которого esc() добавлялся в остальные экраны.
  // Профиль был единственным местом, где правило не соблюдалось: обёрнуто
  // было только имя координатора.
  const программа = esc(participant.program);
  const сезон = esc(participant.season);

  // Сезон приходит не всегда (FIELD_ID_SEASON может быть не настроен в Script
  // Properties) — без этой проверки в шапке оставалось «Season: » с пустотой
  // после двоеточия, а в строке «Программа» — «SELF » с висящим пробелом.
  const программаИСезон = [программа, сезон].filter(Boolean).join(" ");

  // ФИО: колонку full_name на сегодня не пишет никто (ни вебхук, ни посев),
  // поэтому строка была бы пустой у всех — подпись «ФИО» над пустым местом.
  // Прячем строку, пока значения нет. Настоящее решение — начать заполнять
  // full_name из amoCRM, тогда строка появится сама.
  const фио = esc(participant.fullName);
  const строкаФИО = фио
    ? `<div class="profile-row"><div class="small">ФИО</div><b>${фио}</b></div>`
    : "";

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Профиль</div>
        <h1>Участник</h1>
        <div class="sub">Program: ${программа}${сезон ? " · Season: " + сезон : ""}</div>
      </div>
      <div class="card">
        ${строкаФИО}
        <div class="profile-row"><div class="small">Программа</div><b>${программаИСезон}</b></div>
        <div class="profile-row"><div class="small">CIEE ID</div><b>${esc(participant.cieeId)}</b></div>
        <div class="profile-row"><div class="small">Стоимость программы</div><b>${formatMoney(programCost, "USD")}</b></div>
        <div class="profile-row"><div class="small">Telegram</div><b>${participant.telegramConnected ? "Подключён ✅" : "Не подключён"}</b></div>
      </div>
      <div class="card">
        <h3>Ваш координатор</h3>
        <div class="profile-row"><b>${esc(coordinator.name)}</b><div class="small">${esc(coordinator.role)}</div></div>
      </div>
      <button class="btn secondary" id="my-events">Мои мероприятия</button>
      <button class="btn secondary" id="write-coordinator" style="margin-top:8px">Написать координатору</button>
    </section>`;

  container.querySelector("#write-coordinator").addEventListener("click", () => runCtaAction("writeCoordinator"));
  container.querySelector("#my-events").addEventListener("click", () => {
    window.location.hash = "event";
  });
}
