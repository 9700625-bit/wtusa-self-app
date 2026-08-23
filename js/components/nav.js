const NAV_ITEMS = [
  { screen: "home", icon: "⌂", label: "Главная" },
  { screen: "roadmap", icon: "◎", label: "Путь" },
    // "event" (singular) is the screen name registered in app.js — reused as-is
    // here so this nav button routes to the same screen as the Telegram
    // deep-link notifications (t.me/bot/app?startapp=event_<groupId>) already
    // use. Label kept short ("События") to fit the 6-item bottom nav; the
    // screen's own header still reads "Мероприятия" in full.
  { screen: "event", icon: "📅", label: "События" },
  { screen: "documents", icon: "▤", label: "Документы" },
  { screen: "payments", icon: "$", label: "Оплата" },
  { screen: "profile", icon: "◉", label: "Профиль" },
];

export function renderNav(navEl) {
  navEl.innerHTML = NAV_ITEMS.map(
    (item) => `
    <button class="nav" data-screen="${item.screen}" aria-label="${item.label}">
      <span class="ico">${item.icon}</span>${item.label}
    </button>`
  ).join("");

  navEl.querySelectorAll(".nav").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = btn.dataset.screen;
    });
  });
}

export function setActiveNav(navEl, screenName) {
  const mapped = ["status", "celebration"].includes(screenName) ? null : screenName;
  navEl.querySelectorAll(".nav").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === mapped);
  });
}
