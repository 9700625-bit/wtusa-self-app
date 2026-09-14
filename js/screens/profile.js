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

  // ПОДПИСЬ БЕЗ ЗНАЧЕНИЯ — ЭТО НЕ ИНФОРМАЦИЯ (14.09.2026). Так уже было
  // сделано для ФИО строкой выше, но остальные три строки карточки рисовались
  // всегда. По живым данным season и program пусты у всех подключённых
  // участников (поля FIELD_ID_SEASON/FIELD_ID_PROGRAM не приходят из сделки),
  // ciee_id — тоже: экран показывал три подписи подряд с пустотой справа.
  const строкаПрограммы = программаИСезон
    ? `<div class="profile-row"><div class="small">Программа</div><b>${программаИСезон}</b></div>`
    : "";
  const cieeId = esc(participant.cieeId);
  const строкаCieeId = cieeId
    ? `<div class="profile-row"><div class="small">CIEE ID</div><b>${cieeId}</b></div>`
    : "";
  // Та же логика, что на экране «Оплата»: стоимость едет из сделки amoCRM и
  // приходит null, пока её там не проставили. formatMoney(null) даёт «$0» —
  // студент прочитает это как «программа бесплатная», что хуже пустого места.
  const строкаСтоимости = programCost
    ? `<div class="profile-row"><div class="small">Стоимость программы</div><b>${formatMoney(programCost, "USD")}</b></div>`
    : "";

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Профиль</div>
        <h1>Участник</h1>
        ${программаИСезон ? `<div class="sub">${программа ? "Program: " + программа : ""}${сезон ? (программа ? " · " : "") + "Season: " + сезон : ""}</div>` : ""}
      </div>
      <div class="card">
        ${строкаФИО}
        ${строкаПрограммы}
        ${строкаCieeId}
        ${строкаСтоимости}
        <div class="profile-row"><div class="small">Telegram</div><b>${participant.telegramConnected ? "Подключён ✅" : "Не подключён"}</b></div>
      </div>
      <div class="card">
        <h3>Ваш координатор</h3>
        ${
          // КООРДИНАТОРА МОЖЕТ НЕ БЫТЬ (14.09.2026). coordinator_name
          // заполняется по ответственному в сделке через лист Coordinators, а
          // в нём заведён один человек — у всех остальных поле пустое. Экран
          // «Документы» этот случай уже разбирал (кнопку заменяет пояснение),
          // а профиль рисовал пустое имя с подписью «Координатор SELF» под
          // ним. Кнопка при этом честно показывает объяснение в диалоге, так
          // что оставляем её на месте — правим только карточку.
          coordinator.name
            ? `<div class="profile-row"><b>${esc(coordinator.name)}</b><div class="small">${esc(coordinator.role)}</div></div>`
            : `<div class="sub">Ещё не назначен — появится здесь, как только вас закрепят за менеджером.</div>`
        }
      </div>
      <button class="btn secondary" id="my-events">Мои мероприятия</button>
      <button class="btn secondary" id="write-coordinator" style="margin-top:8px">Написать координатору</button>
    </section>`;

  container.querySelector("#write-coordinator").addEventListener("click", () => runCtaAction("writeCoordinator"));
  container.querySelector("#my-events").addEventListener("click", () => {
    window.location.hash = "event";
  });
}
