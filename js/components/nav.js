/**
 * ИКОНКИ СТАЛИ РИСОВАННЫМИ (14.09.2026).
 *
 * Раньше здесь стояли текстовые символы: ⌂ ◎ 📅 ▤ $ ◉. С ними три беды.
 *
 * Первая — это символы шрифта, а не картинки: как они выглядят, решает
 * система. На iPhone, на Android и в разных версиях Telegram они разные,
 * и повлиять на это нельзя.
 *
 * Вторая — 📅 настоящее эмодзи, цветное, с нарисованной внутри датой
 * «17 июля». Среди шести серых значков оно выглядит наклейкой.
 *
 * Третья — ◎ у «Пути» и ◉ у «Профиля» это два круга в круге, отличающиеся
 * только заливкой. На 18 пикселях их не различить.
 *
 * Теперь каждый значок — встроенный SVG одной толщины линии, одного
 * размера и одного языка форм. Цвет берётся из currentColor, поэтому
 * активный пункт подсвечивается тем же правилом CSS, что и раньше.
 */
const ICONS = {
  // дом
  home: '<path d="M3.6 9.9 12 3.4l8.4 6.5"/><path d="M5.6 9.2V19a1 1 0 0 0 1 1h3.2v-4.6h4.4V20h3.2a1 1 0 0 0 1-1V9.2"/>',
  // путь: флажок на вершине и тропа к нему
  roadmap: '<path d="M6.5 20.5V4.2"/><path d="M6.5 4.8h9.7l-1.8 3 1.8 3H6.5"/><circle cx="6.5" cy="20.5" r="1.2"/>',
  // календарь
  event: '<rect x="3.4" y="5.4" width="17.2" height="15.2" rx="2.4"/><path d="M3.4 10.2h17.2"/><path d="M8.2 3.4v4M15.8 3.4v4"/>',
  // документ с загнутым углом
  documents: '<path d="M13.6 3.4H7a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.8z"/><path d="M13.4 3.6v5.2h5.4"/><path d="M8.6 13.4h6.8M8.6 16.8h4.6"/>',
  // карта оплаты
  payments: '<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.4"/><path d="M2.8 10h18.4"/><path d="M6.6 14.6h3.4"/>',
  // человек
  profile: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20.4c0-3.7 3.2-6 7.2-6s7.2 2.3 7.2 6"/>',
};

function ico(name) {
  return (
    '<svg class="ico" viewBox="0 0 24 24" width="23" height="23" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    ICONS[name] +
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
