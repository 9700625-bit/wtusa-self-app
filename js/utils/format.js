const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** '2026-10-15' -> '15 октября' (year appended only if different from today's year) */
export function formatDate(isoDate, opts = {}) {
  if (!isoDate) return null;
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getDate();
  const month = RU_MONTHS[d.getMonth()];
  const now = new Date();
  const showYear = opts.forceYear || d.getFullYear() !== now.getFullYear();
  return `${day} ${month}${showYear ? " " + d.getFullYear() : ""}`;
}

export function formatMoney(amount) {
  return `$${Number(amount).toLocaleString("en-US")}`;
}

/** Days remaining until isoDate, relative to "today" (see NOW below). Negative = overdue. */
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(isoDate + "T00:00:00");
  const diffMs = target.getTime() - NOW.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function daysLabel(n) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = "дней";
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = "день";
    else if (mod10 >= 2 && mod10 <= 4) word = "дня";
  }
  return `${abs} ${word}`;
}

// Single fixed "today" for the whole prototype so relative deadlines stay
// consistent across screens (matches the session's current date).
export const NOW = new Date("2026-08-20T12:00:00");
