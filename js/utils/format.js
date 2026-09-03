const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// Google Sheets silently turns a plain "2026-12-21" string cell into a real
// Date value, which Apps Script then sends to the frontend as a full
// "2026-12-21T19:00:00.000Z" timestamp (UTC, shifted by the sheet's
// timezone) instead of a plain date. Take just the first 10 chars so both
// forms parse the same way, whichever one the backend happens to send.
function dateOnly_(isoDate) {
  if (!isoDate) return null;
  const datePart = String(isoDate).slice(0, 10);
  const d = new Date(datePart + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '2026-10-15' -> '15 октября' (year appended only if different from today's year) */
export function formatDate(isoDate, opts = {}) {
  const d = dateOnly_(isoDate);
  if (!d) return isoDate || null;
  const day = d.getDate();
  const month = RU_MONTHS[d.getMonth()];
  const now = new Date();
  const showYear = opts.forceYear || d.getFullYear() !== now.getFullYear();
  return `${day} ${month}${showYear ? " " + d.getFullYear() : ""}`;
}

/** currency: "USD" (default) -> "$1,234"; "KZT" -> "200 000 ₸". */
export function formatMoney(amount, currency = "USD") {
  const n = Number(amount) || 0;
  if (currency === "KZT") {
    return `${n.toLocaleString("ru-RU")} ₸`;
  }
  return `$${n.toLocaleString("en-US")}`;
}

/** Days remaining until isoDate, relative to "today" (see NOW below). Negative = overdue. */
export function daysUntil(isoDate) {
  const target = dateOnly_(isoDate);
  if (!target) return null;
  const diffMs = target.getTime() - NOW.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * '2026-10-15' + 5 -> '2026-10-20'. Used to turn a stored start date plus a
 * fixed deadline window (e.g. CIEE's 5-day activation window) into a date
 * daysUntil() can then count down against.
 *
 * Deliberately does NOT go through .toISOString() -- that serializes in UTC,
 * which can land on a different calendar day than dateOnly_() would parse
 * back out once the local timezone offset is applied (the exact bug class
 * this whole codebase has had to fix repeatedly on the backend side with
 * formatSheetDate_/formatSheetTime_). Building the "YYYY-MM-DD" string from
 * the local Date getters instead keeps it symmetric with how dateOnly_()
 * reads it back.
 */
export function addDaysIso(isoDate, days) {
  const base = dateOnly_(isoDate);
  if (!base) return null;
  base.setDate(base.getDate() + days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

// Real "today" — was pinned to a fixed demo date during the Phase-1
// mock-only prototype; now that deadlines come from the live backend,
// "days left" needs to count down against the actual current time.
export const NOW = new Date();

/**
 * ЭКРАНИРОВАНИЕ ДЛЯ ВСТАВКИ В HTML (02.09.2026).
 *
 * Экраны собирают разметку шаблонными строками и кладут её в innerHTML. Часть
 * подставляемых значений пишут люди — координатор в карточке amoCRM
 * (комментарии к документам, названия и описания мероприятий, адреса) и сам
 * студент в профиле Telegram (имя). Раньше эти значения вставлялись как есть.
 *
 * Внутри Mini App это в первую очередь ломает ТЕКСТ, а не безопасность:
 * комментарий координатора «Скан должен быть <5 МБ» обрывался на «<5», потому
 * что браузер съедал остаток строки как незакрытый тег, и студент так и не
 * узнавал, чего от него хотят. Плюс закрывается сама возможность подставить
 * разметку через данные.
 *
 * Правило простое: любое значение, пришедшее с сервера, внутри шаблонной
 * строки оборачивается в esc(). Числа и наши собственные константы — не нужно.
 */
export function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
