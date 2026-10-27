// 23.10.2026: «Мои документы» — разметка по ответу сервера (node tests/fe-docs.mjs, без браузера).
import { docsVisible, docsRowsHtml } from "../js/utils/docsView.js";
let fail = 0;
const check = (n, c, i) => { console.log((c ? "PASS " : "FAIL ") + n + (i ? "  " + i : "")); if (!c) fail++; };
const six = (st) => ["Passport", "Birth Certificate", "Photo", "Study Certificate", "Student ID", "Transcript"].map((type, i) => ({ type, status: st[i] }));
const h = docsRowsHtml(six(["received", "received", "missing", "received", "missing", "missing"]));
check("3 документа: 3 «Получен», 3 «Нужно сдать»", (h.match(/>Получен</g) || []).length === 3 && (h.match(/>Нужно сдать</g) || []).length === 3);
check("названия по-русски, порядок D–I", /Паспорт[\s\S]*Свидетельство о рождении[\s\S]*Фото[\s\S]*Справка об обучении[\s\S]*Студенческий билет[\s\S]*Транскрипт оценок/.test(h));
check("«Проблема» — тег need", /tag need">Проблема</.test(docsRowsHtml([{ type: "Photo", status: "problem" }])));
check("null — блок скрыт", !docsVisible(null) && docsRowsHtml(null) === "" && !docsVisible(undefined));
check("старый ответ из копии на телефоне (ok/miss, русские названия) — без ошибки", /Паспорт[\s\S]*Получен/.test(docsRowsHtml([{ id: "doc_1", type: "Паспорт", status: "ok" }])));
check("ТЗ 34: транскрипт not_required — серая плашка «Пока не требуется», не «Нужно сдать»", /Транскрипт оценок<\/b><\/div>\s*<span class="tag ">Пока не требуется</.test(docsRowsHtml([{ type: "Transcript", status: "not_required", note: "Пока не нужен" }])) && !/Нужно сдать/.test(docsRowsHtml([{ type: "Transcript", status: "not_required" }])));
check("HTML в названии экранируется", !/<script>/.test(docsRowsHtml([{ type: "<script>", status: "missing" }])));
console.log(fail ? fail + " FAIL" : "ALL PASS");
process.exit(fail ? 1 : 0);
