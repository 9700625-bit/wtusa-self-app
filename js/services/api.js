/**
 * Public API surface every screen imports (`import * as api from
 * "../services/api.js"`). Delegates to the live backend (liveApi.js) once
 * BACKEND_URL is configured (js/services/config.js), otherwise stays on
 * mock data (mockApi.js) — this is the Phase 1 → Phase 2 switch, and it's
 * the ONLY file screens depend on, so nothing else needs to change.
 */

import { isLiveBackendConfigured } from "./config.js";
import * as mockApi from "./mockApi.js";
import * as liveApi from "./liveApi.js";

function backend() {
  return isLiveBackendConfigured() ? liveApi : mockApi;
}

export function getMe() {
  return backend().getMe();
}
export function getDashboard() {
  return backend().getDashboard();
}
export function getRoadmap() {
  return backend().getRoadmap();
}
export function getStageDetail(stageId) {
  return backend().getStageDetail(stageId);
}
export function getDocuments() {
  return backend().getDocuments();
}
export function uploadDocument(docId, file) {
  return backend().uploadDocument(docId, file);
}
export function getPayments() {
  return backend().getPayments();
}
export function getBriefings() {
  return backend().getBriefings();
}
export function postSupport(message) {
  return backend().postSupport(message);
}
export function getPreDepartureChecklist() {
  return backend().getPreDepartureChecklist();
}
export function toggleChecklistItem(itemId) {
  return backend().toggleChecklistItem(itemId);
}
export function getVisaInfo() {
  return backend().getVisaInfo();
}

/** Live-only: consumes a one-time linking token (ТЗ §58). No-op on mock. */
export function linkAccount(token) {
  return isLiveBackendConfigured() ? liveApi.linkAccount(token) : Promise.resolve({ skipped: true });
}

/* Demo-only helpers — only exist on the mock backend. Calling them while
 * the live backend is active is a programming error (the demo panel is
 * never mounted in that case — see app.js), so they intentionally throw. */
export function _debugSetCurrentStage(stageId) {
  if (isLiveBackendConfigured()) throw new Error("_debugSetCurrentStage is mock-only");
  return mockApi._debugSetCurrentStage(stageId);
}
export function _debugGetCurrentStageId() {
  if (isLiveBackendConfigured()) throw new Error("_debugGetCurrentStageId is mock-only");
  return mockApi._debugGetCurrentStageId();
}
