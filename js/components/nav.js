const NAV_ITEMS = [
  { screen: "home", icon: "⌂", label: "Главная" },
  { screen: "roadmap", icon: "◎", label: "Путь" },
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
