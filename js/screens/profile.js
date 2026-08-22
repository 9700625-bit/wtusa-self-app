import * as api from "../services/api.js";
import { runCtaAction } from "../services/actions.js";
import { formatMoney } from "../utils/format.js?v=2";

export async function render(container) {
    const { participant, coordinator, programCost } = await api.getMe();

  container.innerHTML = `
      <section class="screen active">
            <div class="card">
                    <div class="kicker">Профиль</div>
                            <h1>Участник</h1>
                                    <div class="sub">Program: ${participant.program} · Season: ${participant.season}</div>
                                          </div>
                                                <div class="card">
                                                        <div class="profile-row"><div class="small">ФИО</div><b>${participant.fullName}</b></div>
                                                                <div class="profile-row"><div class="small">Программа</div><b>${participant.program} ${participant.season}</b></div>
                                                                        <div class="profile-row"><div class="small">CIEE ID</div><b>${participant.cieeId}</b></div>
                                                                                <div class="profile-row"><div class="small">Стоимость программы</div><b>${formatMoney(programCost, "USD")}</b></div>
                                                                                        <div class="profile-row"><div class="small">Telegram</div><b>${participant.telegramConnected ? "Подключён ✅" : "Не подключён"}</b></div>
                                                                                              </div>
                                                                                                    <div class="card">
                                                                                                            <h3>Ваш координатор</h3>
                                                                                                                    <div class="profile-row"><b>${coordinator.name}</b><div class="small">${coordinator.role}</div></div>
                                                                                                                          </div>
                                                                                                                                <button class="btn secondary" id="my-events">Мои мероприятия</button>
                                                                                                                                      <button class="btn secondary" id="write-coordinator" style="margin-top:8px">Написать координатору</button>
                                                                                                                                          </section>`;

  container.querySelector("#write-coordinator").addEventListener("click", () => runCtaAction("writeCoordinator"));
    container.querySelector("#my-events").addEventListener("click", () => {
          window.location.hash = "event";
    });
}
