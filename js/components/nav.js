/**
 * ИКОНКИ — ЦВЕТНЫЕ, ДВУХТОНОВЫЕ (22.09.2026, по просьбе владельца).
 *
 * История: 14.09 текстовые символы заменили на рисованные SVG в одну
 * серую линию (см. git). Теперь — цветной набор в одном языке форм:
 *   • у каждого пункта свой цвет (ACCENT) и мягкая тонированная подложка
 *     со скруглением — она же становится насыщеннее у активного пункта;
 *   • рисунок двухтоновый: светлая заливка + контур цветом пункта;
 *   • сетка 24×24, толщина линии 1.6 у всех — набор читается как один.
 * Цвета заданы явно (не currentColor), поэтому значки цветные и в
 * неактивном состоянии; подпись под ними по-прежнему серая/тёмно-синяя.
 */
const ACCENT = {
  home: "#2f9e6b",      // зелёный — дом
  roadmap: "#3b6fe0",   // синий — путь
  event: "#e9534f",     // красный — календарь
  documents: "#e08a1e", // янтарный — документы
  payments: "#7c5cd6",  // фиолетовый — оплата
  profile: "#1f9fb2",   // бирюзовый — профиль
};

// Светлая заливка внутри фигур: тот же цвет, сильно разбавленный.
const LIGHT = {
  home: "#dff3e8", roadmap: "#e1eafc", event: "#fde3e2",
  documents: "#fdeedb", payments: "#ebe4fa", profile: "#dcf2f5",
};

const GLYPH = {
  // дом: крыша контуром, стены светлой заливкой, дверь цветом
  home: (a, l) =>
    `<path d="M5.6 10.4V19a1.2 1.2 0 0 0 1.2 1.2h10.4A1.2 1.2 0 0 0 18.4 19v-8.6" fill="${l}" stroke="${a}"/>` +
    `<path d="M3.8 11 12 4l8.2 7" fill="none" stroke="${a}"/>` +
    `<path d="M10.2 20.2v-4.4a1.8 1.8 0 0 1 3.6 0v4.4" fill="${a}" stroke="${a}"/>`,
  // путь: тропа точками и флаг на вершине
  roadmap: (a, l) =>
    `<path d="M7 20.6V4.6" stroke="${a}"/>` +
    `<path d="M7 5.2h9.6l-2 3.1 2 3.1H7z" fill="${l}" stroke="${a}"/>` +
    `<circle cx="7" cy="20.6" r="1.5" fill="${a}" stroke="none"/>` +
    `<circle cx="12" cy="17.2" r="1.1" fill="${a}" stroke="none"/><circle cx="16.4" cy="14.6" r="1.1" fill="${a}" stroke="none"/>`,
  // календарь: красная шапка с кольцами, белый лист, точки-дни
  event: (a, l) =>
    `<rect x="3.6" y="5.6" width="16.8" height="14.8" rx="2.6" fill="#fff" stroke="${a}"/>` +
    `<path d="M3.6 8.2a2.6 2.6 0 0 1 2.6-2.6h11.6a2.6 2.6 0 0 1 2.6 2.6v2.4H3.6z" fill="${a}" stroke="${a}"/>` +
    `<path d="M8.4 3.4v3.4M15.6 3.4v3.4" stroke="#0f2344" stroke-width="2"/>` +
    `<circle cx="8.4" cy="14.2" r="1.1" fill="#0f2344" stroke="none"/><circle cx="12" cy="14.2" r="1.1" fill="#0f2344" stroke="none"/><circle cx="15.6" cy="14.2" r="1.1" fill="#0f2344" stroke="none"/>` +
    `<circle cx="8.4" cy="17.6" r="1.1" fill="${a}" stroke="none"/><circle cx="12" cy="17.6" r="1.1" fill="#0f2344" stroke="none"/>`,
  // документ: лист с загнутым углом и строками
  documents: (a, l) =>
    `<path d="M13.6 3.6H7a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" fill="${l}" stroke="${a}"/>` +
    `<path d="M13.4 3.8v5.2h5.4" fill="#fff" stroke="${a}"/>` +
    `<path d="M8.6 13.2h6.8M8.6 16.4h4.4" stroke="${a}"/>`,
  // карта: цветная полоса и чип
  payments: (a, l) =>
    `<rect x="2.8" y="5.8" width="18.4" height="12.6" rx="2.6" fill="${l}" stroke="${a}"/>` +
    `<path d="M2.8 9.4h18.4v2.6H2.8z" fill="${a}" stroke="none"/>` +
    `<rect x="6" y="14" width="4.2" height="2" rx=".6" fill="${a}" stroke="none"/>`,
  // человек: голова и плечи
  profile: (a, l) =>
    `<circle cx="12" cy="8.4" r="3.6" fill="${l}" stroke="${a}"/>` +
    `<path d="M4.8 20.4c0-3.8 3.2-6.2 7.2-6.2s7.2 2.4 7.2 6.2z" fill="${l}" stroke="${a}"/>`,
};

function ico(name) {
  const a = ACCENT[name], l = LIGHT[name];
  return (
    '<svg class="ico" viewBox="0 0 24 24" width="27" height="27" fill="none" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
    `<rect class="ico-bg" x="0" y="0" width="24" height="24" rx="7" fill="${l}" fill-opacity=".5" stroke="none"/>` +
    GLYPH[name](a, l) +
    "</svg>"
  );
}

const NAV_ITEMS = [
  { screen: "home", label: "Главная" },
  { screen: "roadmap", label: "Путь" },
    // "event" (singular) is the screen name registered in app.js — reused as-is
    // here so this nav button routes to the same screen as the Telegram
    // deep-link notifications (t.me/bot/app?startapp=event_<groupId>) already
    // use. Label kept short ("События") to fit the 6-item bottom nav; the
    // screen's own header still reads "Мероприятия" in full.
  { screen: "event", label: "События" },
  { screen: "documents", label: "Документы" },
  { screen: "payments", label: "Оплата" },
  { screen: "profile", label: "Профиль" },
];

export function renderNav(navEl) {
  navEl.innerHTML = NAV_ITEMS.map(
    (item) => `
    <button class="nav" data-screen="${item.screen}" aria-label="${item.label}">
      ${ico(item.screen)}<span class="nav-label">${item.label}</span>
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
