/**
 * Maps a stage/document/payment "severity" to the colour language defined in
 * ТЗ §65: 🔴 action required/problem · 🟡 waiting/attention · 🔵 processing ·
 * 🟢 completed. Kept in one place so every screen reads statuses consistently.
 */

const SEVERITY_META = {
  ok: { dot: "ok", tagClass: "ok", label: "Готово" },
  active: { dot: "active", tagClass: "review", label: "В процессе" },
  wait: { dot: "wait", tagClass: "", label: "Ожидание" },
  warn: { dot: "warn", tagClass: "need", label: "Внимание" },
  danger: { dot: "warn", tagClass: "miss", label: "Требуется действие" },
};

export function severityMeta(severity) {
  return SEVERITY_META[severity] || SEVERITY_META.wait;
}

export function dotHtml(severity) {
  return `<span class="dot ${severityMeta(severity).dot}"></span>`;
}

export function tagHtml(severity, label) {
  const meta = severityMeta(severity);
  return `<span class="tag ${meta.tagClass}">${label || meta.label}</span>`;
}

const DOC_STATUS_META = {
  ok: { tagClass: "ok", label: "Принят" },
  review: { tagClass: "review", label: "На проверке" },
  need: { tagClass: "need", label: "Исправить" },
  miss: { tagClass: "miss", label: "Нужно предоставить" },
};

export function docTagHtml(status) {
  const meta = DOC_STATUS_META[status] || DOC_STATUS_META.miss;
  return `<span class="tag ${meta.tagClass}">${meta.label}</span>`;
}

const PAYMENT_STATUS_META = {
  paid: { tagClass: "ok", label: "Оплачено" },
  awaiting: { tagClass: "review", label: "Ожидается" },
  overdue: { tagClass: "miss", label: "Просрочено" },
  not_due: { tagClass: "", label: "Позже" },
};

export function paymentTagHtml(status) {
  const meta = PAYMENT_STATUS_META[status] || PAYMENT_STATUS_META.not_due;
  return `<span class="tag ${meta.tagClass}">${meta.label}</span>`;
}
