/**
 * Mock "database" for Phase 1 (UI Prototype). Shape mirrors the minimal
 * entities described in ТЗ §59 (User, Document, Briefing, ...) so that
 * swapping js/services/api.js for real fetch() calls later doesn't require
 * touching any screen code.
 *
 * This module is intentionally mutable (simple `let` state) — the mock API
 * service reads/writes it to simulate a backend + amoCRM without a network.
 */

export const participant = {
  id: "usr_demo_1",
  name: "Улпан",
  fullName: "Асанова Улпан Бекаровна",
  program: "SELF",
  season: "2027",
  cieeId: "Будет добавлен после интеграции",
  telegramConnected: true,
  enrollmentDate: "2026-08-01",
};

export const coordinator = {
  name: "Жансая",
  role: "Координатор SELF",
  telegramUsername: "abc_universe_support", // mock — used to build t.me link
};

// Mutable "current stage" — simulates the amoCRM pipeline stage. Changed only
// by the demo panel (js/screens/demo.js) to preview every state without a backend.
export let currentStageId = "JOB_OFFER_CIEE_REVIEW";

export function setCurrentStageId(id) {
  currentStageId = id;
}

export const documents = [
  {
    id: "doc_passport",
    type: "Паспорт",
    status: "ok", // ok | review | need | miss
    updatedAt: "2026-08-20",
    note: "Загружен 20 августа",
    coordinatorComment: null,
  },
  {
    id: "doc_university",
    type: "Справка из университета",
    status: "review",
    updatedAt: "2026-08-21",
    note: "Загружена 21 августа",
    coordinatorComment: null,
  },
  {
    id: "doc_student_id",
    type: "Student ID",
    status: "miss",
    updatedAt: null,
    note: "Документ не загружен",
    coordinatorComment: null,
  },
  {
    id: "doc_photo",
    type: "Фото",
    status: "need",
    updatedAt: "2026-08-18",
    note: "Нужно заменить файл",
    coordinatorComment: "Необходимо загрузить более качественный скан — фото размыто.",
  },
];

export function setDocumentStatus(docId, status) {
  const doc = documents.find((d) => d.id === docId);
  if (doc) {
    doc.status = status;
    doc.updatedAt = new Date().toISOString().slice(0, 10);
    if (status === "review") doc.note = "Загружено только что · на проверке";
  }
  return doc;
}

export const payments = [
  {
    id: "pay_1",
    label: "Оплата 1",
    amount: 200000,
    currency: "KZT",
    deadline: "2026-08-20",
    status: "paid", // not_due | awaiting | paid | overdue
    paidDate: "2026-08-20",
  },
  {
    id: "pay_2",
    label: "Оплата 2",
    amount: 450,
    currency: "USD",
    deadline: "2026-10-15",
    status: "awaiting",
    paidDate: null,
  },
  {
    id: "pay_3",
    label: "Оплата 3",
    amount: 1500,
    currency: "USD",
    deadline: "2026-11-15",
    status: "not_due",
    paidDate: null,
  },
];

// Fixed reference total (Payment 1 is pure KZT with no $ figure, so it can't
// be summed with the USD-denominated payments) — matches PROGRAM_COST_USD
// on the live backend.
export const programCost = 2850;

export const visaFees = [
  { id: "fee_sevis", label: "SEVIS Fee", amount: 220, status: "locked" }, // locked | unpaid | paid
  { id: "fee_visa", label: "Visa Fee", amount: 185, status: "locked" },
];

export const briefings = [
  {
    id: "br_welcome",
    title: "Welcome Briefing",
    description: "Вводный брифинг о программе SELF.",
    date: "2026-08-25",
    time: null,
    status: "completed", // upcoming | completed | missed | rescheduled
    link: null,
    materials: null,
  },
  {
    id: "br_ciee_joboffer",
    title: "CIEE & Job Offer",
    description: "Как правильно оформить и загрузить Job Offer в CIEE.",
    date: "2026-10-21",
    time: "18:00",
    status: "upcoming",
    link: "https://zoom.us/j/demo",
    materials: null,
  },
  {
    id: "br_visa",
    title: "Visa Briefing",
    description: "Подготовка к визовому этапу: SEVIS, Visa Fee, DS-160.",
    date: null,
    time: null,
    status: "upcoming",
    link: null,
    materials: null,
  },
  {
    id: "br_predeparture",
    title: "Pre-Departure Briefing",
    description: "Финальная подготовка к вылету.",
    date: null,
    time: null,
    status: "upcoming",
    link: null,
    materials: null,
  },
];

export const visaInfo = {
  appointmentDate: "2027-03-17",
  appointmentTime: "09:15",
  location: "Посольство США, Астана",
  result: "pending", // pending | approved | admin_processing | refused
  passportStatus: "waiting", // waiting | at_embassy | ready | received
};

export const preDepartureChecklist = [
  { id: "chk_visa", label: "Visa", done: false },
  { id: "chk_ds2019", label: "DS-2019", done: false },
  { id: "chk_passport", label: "Passport", done: false },
  { id: "chk_flight", label: "Flight", done: false },
  { id: "chk_insurance", label: "Insurance / необходимые документы", done: false },
  { id: "chk_money", label: "Необходимые деньги", done: false },
  { id: "chk_printed", label: "Документы распечатаны", done: false },
  { id: "chk_briefing", label: "Pre-Departure Briefing", done: false },
];

export const supportMessages = [];

export function addSupportMessage(text) {
  supportMessages.push({ text, sentAt: new Date().toISOString() });
}
