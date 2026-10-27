// 23.10.2026: «Мои документы» — статусы из листа «Документы» таблицы координаторов (колонки D–I).
// Сервер отдаёт documents: [{ type, status: received | problem | missing }] или null — блок скрыт
// (лист недоступен, ФИО не совпало, отказник). 27.10.2026 (ТЗ 34): транскрипт без отметки — not_required, серая плашка
// «Пока не требуется» (решает сервер). Здесь — только разметка, без запросов: проверяется в node (tests/fe-docs.mjs).
import { esc } from "./format.js?v=3";

export const DOC_LABELS = {
  Passport: "Паспорт",
  "Birth Certificate": "Свидетельство о рождении",
  Photo: "Фото",
  "Study Certificate": "Справка об обучении",
  "Student ID": "Студенческий билет",
  Transcript: "Транскрипт оценок",
};
const STATUS_META = {
  received: { tagClass: "ok", label: "Получен" },
  problem: { tagClass: "need", label: "Проблема" },
  missing: { tagClass: "miss", label: "Нужно сдать" },
  not_required: { tagClass: "", label: "Пока не требуется" },
};
// Старый ответ сервера (до 23.10) из сохранённой на телефоне копии: ok / need / review / miss.
const LEGACY = { ok: "received", need: "problem", review: "missing", miss: "missing" };

/** Показывать блок? Только массив (null / нет поля — блок скрыт). */
export function docsVisible(documents) {
  return Array.isArray(documents);
}

export function docsRowsHtml(documents) {
  if (!docsVisible(documents)) return "";
  if (!documents.length) return `<div class="sub">Список документов пока пуст.</div>`;
  return documents
    .map((doc) => {
      const st = STATUS_META[doc.status] || STATUS_META[LEGACY[doc.status]] || STATUS_META.missing;
      return `
      <div class="doc">
        <div><b>${esc(DOC_LABELS[doc.type] || doc.type || "")}</b></div>
        <span class="tag ${st.tagClass}">${st.label}</span>
      </div>`;
    })
    .join("");
}
