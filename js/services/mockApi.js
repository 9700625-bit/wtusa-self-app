/**
 * Mock API layer — mirrors the endpoint contract from ТЗ §61
 * (GET /me, /dashboard, /roadmap, /documents, POST /documents/upload,
 * GET /payments, /briefings, POST /support).
 *
 * Every function returns a Promise, resolves after a small artificial delay,
 * and returns plain JSON-serialisable data — exactly what liveApi.js returns
 * from the real backend. js/services/api.js picks between this file and
 * liveApi.js; screens never import either directly.
 */

import * as db from "../data/mockData.js";
import { deriveDashboard, deriveRoadmap, deriveStageDetail, derivePayments } from "./deriveViews.js";

const LATENCY_MS = 180;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Snapshot of mockData.js in the flat shape deriveViews.js expects — the
 * same shape a live backend's `state` endpoint returns (see AmoCRM/Api.gs
 * stateForUser_ on the backend side). */
function snapshotState() {
  return {
    participant: db.participant,
    coordinator: db.coordinator,
    currentStageId: db.currentStageId,
    documents: db.documents,
    payments: db.payments,
    programCost: db.programCost,
    visaFees: db.visaFees,
    briefings: db.briefings,
    visaInfo: db.visaInfo,
    preDepartureChecklist: db.preDepartureChecklist,
  };
}

/** GET /me */
export function getMe() {
  return delay(clone({ participant: db.participant, coordinator: db.coordinator }));
}

/** GET /dashboard */
export function getDashboard() {
  return delay(clone(deriveDashboard(snapshotState())));
}

/** GET /roadmap */
export function getRoadmap() {
  return delay(clone(deriveRoadmap(snapshotState())));
}

/** GET /roadmap/:stageId — status detail screen */
export function getStageDetail(stageId) {
  const detail = deriveStageDetail(snapshotState(), stageId);
  return delay(detail ? clone(detail) : null);
}

/** GET /documents */
export function getDocuments() {
  return delay(clone(db.documents));
}

/** POST /documents/upload */
export function uploadDocument(docId, _file) {
  const updated = db.setDocumentStatus(docId, "review");
  return delay(clone(updated));
}

/** GET /payments */
export function getPayments() {
  return delay(clone(derivePayments(snapshotState())));
}

/** GET /briefings */
export function getBriefings() {
  return delay(clone(db.briefings));
}

/** POST /support */
export function postSupport(message) {
  db.addSupportMessage(message);
  return delay({ ok: true });
}

/** GET /pre-departure-checklist (extension of §31, not in §61 list but needed for that screen) */
export function getPreDepartureChecklist() {
  return delay(clone(db.preDepartureChecklist));
}

export function toggleChecklistItem(itemId) {
  const item = db.preDepartureChecklist.find((i) => i.id === itemId);
  if (item) item.done = !item.done;
  return delay(clone(db.preDepartureChecklist));
}

/** GET /visa */
export function getVisaInfo() {
  return delay(clone(db.visaInfo));
}

/* ---------------------------------------------------------------------- *
 * Demo-only helpers (NOT part of the production API contract).            *
 * They simulate what a real amoCRM webhook + stage-mapping recalculation  *
 * would do (ТЗ §63), so the Phase-1 prototype can show every screen state *
 * without a backend. The demo panel (js/components/demoPanel.js) is the   *
 * only caller, and it's only mounted when the live backend isn't         *
 * configured (see app.js).                                               *
 * ---------------------------------------------------------------------- */
export function _debugSetCurrentStage(stageId) {
  db.setCurrentStageId(stageId);
  return delay(true);
}

export function _debugGetCurrentStageId() {
  return db.currentStageId;
}
