/**
 * Public API surface every screen imports (`import * as api from
 * "../services/api.js"`). Delegates to the live backend (liveApi.js) once
 * BACKEND_URL is configured (js/services/config.js), otherwise stays on
 * mock data (mockApi.js) — this is the Phase 1 → Phase 2 switch, and it's
 * the ONLY file screens depend on, so nothing else needs to change.
 *
 * ДЕМО-РЕЖИМ ГРУЗИТСЯ ПО ТРЕБОВАНИЮ (14.09.2026).
 *
 * Здесь стоял обычный статический импорт mockApi.js, а тот тянет за собой
 * mockData.js. Оба нужны ТОЛЬКО когда BACKEND_URL пустой. Адрес давно
 * заполнен, значит у каждого студента при каждом открытии скачивались и
 * разбирались два файла, которые ни разу не вызываются: 11 килобайт и два
 * лишних сетевых запроса из двадцати шести.
 *
 * Теперь mockApi.js запрашивается динамически и только в демо-ветке.
 * Промодуль кешируется в mockPromise_, поэтому import() отрабатывает один
 * раз за сеанс, а не на каждый вызов.
 *
 * Следствие для вызывающего кода: backend_() стала асинхронной, и все
 * функции ниже — тоже. Снаружи ничего не меняется: они и раньше возвращали
 * промисы, экраны их уже await'ят.
 */

import { isLiveBackendConfigured } from "./config.js";
import * as liveApi from "./liveApi.js";

let mockPromise_ = null;
function loadMock_() {
  if (!mockPromise_) mockPromise_ = import("./mockApi.js");
  return mockPromise_;
}

function backend_() {
  return isLiveBackendConfigured() ? Promise.resolve(liveApi) : loadMock_();
}

export async function getMe() {
    return (await backend_()).getMe();
}
export async function getDashboard() {
    return (await backend_()).getDashboard();
}
export async function getRoadmap() {
    return (await backend_()).getRoadmap();
}
export async function getStageDetail(stageId) {
    return (await backend_()).getStageDetail(stageId);
}
export async function getDocuments() {
    return (await backend_()).getDocuments();
}
export async function uploadDocument(docId, file) {
    return (await backend_()).uploadDocument(docId, file);
}
export async function getPayments() {
    return (await backend_()).getPayments();
}
export async function getBriefings() {
    return (await backend_()).getBriefings();
}
export async function postSupport(message) {
    return (await backend_()).postSupport(message);
}
export async function reportClientError(payload) {
    return (await backend_()).reportClientError(payload);
}
export async function confirmVisaReady() {
    return (await backend_()).confirmVisaReady();
}
export async function confirmJobOffer() {
    return (await backend_()).confirmJobOffer();
}
export async function getPreDepartureChecklist() {
    return (await backend_()).getPreDepartureChecklist();
}
export async function toggleChecklistItem(itemId) {
    return (await backend_()).toggleChecklistItem(itemId);
}
export async function getVisaInfo() {
    return (await backend_()).getVisaInfo();
}
export async function getEvents() {
    return (await backend_()).getEvents();
}
export async function respondEvent(groupId, choice, chosenEventId) {
    return (await backend_()).respondEvent(groupId, choice, chosenEventId);
}

/** Live-only: consumes a one-time linking token (ТЗ §58). No-op on mock. */
export async function linkAccount(token) {
    return isLiveBackendConfigured() ? liveApi.linkAccount(token) : { skipped: true };
}

/* Demo-only helpers — only exist on the mock backend. Calling them while
 * the live backend is active is a programming error (the demo panel is
 * never mounted in that case — see app.js), so they intentionally throw. */
export async function _debugSetCurrentStage(stageId) {
    if (isLiveBackendConfigured()) throw new Error("_debugSetCurrentStage is mock-only");
    return (await loadMock_())._debugSetCurrentStage(stageId);
}
export async function _debugGetCurrentStageId() {
    if (isLiveBackendConfigured()) throw new Error("_debugGetCurrentStageId is mock-only");
    return (await loadMock_())._debugGetCurrentStageId();
}
