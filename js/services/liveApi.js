/**
 * Live backend client — talks to the deployed Apps Script Web App
 * (backend-apps-script/, see SETUP.md). Same function surface as
 * mockApi.js; js/services/api.js picks one or the other.
 *
 * CORS note (see backend-apps-script/Api.gs header comment): GET requests
 * work cross-origin as-is. POST bodies MUST be sent as `text/plain` (never
 * `application/json`) or the browser's CORS preflight will fail against
 * Apps Script, which doesn't implement OPTIONS.
 */

import { BACKEND_URL } from "./config.js";
import { getInitData } from "./telegram.js";
import { deriveDashboard, deriveRoadmap, deriveStageDetail, derivePayments } from "./deriveViews.js";

let stateCache = null;
let stateCacheAt = 0;
const STATE_CACHE_MS = 4000; // avoid refetching on every screen within the same interaction

async function apiGet(action, extraParams) {
  const params = new URLSearchParams({ action, initData: getInitData(), ...(extraParams || {}) });
  const resp = await fetch(`${BACKEND_URL}?${params.toString()}`, { method: "GET" });
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function apiPost(action, payload) {
  const resp = await fetch(`${BACKEND_URL}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // see CORS note above
    body: JSON.stringify({ initData: getInitData(), ...(payload || {}) }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function getState(force) {
  const fresh = !force && stateCache && Date.now() - stateCacheAt < STATE_CACHE_MS;
  if (fresh) return stateCache;
  stateCache = await apiGet("state");
  stateCacheAt = Date.now();
  return stateCache;
}

function invalidateState() {
  stateCache = null;
}

export async function getMe() {
  const state = await getState();
  return { participant: state.participant, coordinator: state.coordinator };
}

export async function getDashboard() {
  return deriveDashboard(await getState());
}

export async function getRoadmap() {
  return deriveRoadmap(await getState());
}

export async function getStageDetail(stageId) {
  return deriveStageDetail(await getState(), stageId);
}

export async function getDocuments() {
  const state = await getState();
  return state.documents;
}

export async function uploadDocument(docId, file) {
  const result = await apiPost("uploadDocument", { docId, fileName: file && file.name ? file.name : "file" });
  invalidateState();
  return result;
}

export async function getPayments() {
  return derivePayments(await getState());
}

export async function getBriefings() {
  const state = await getState();
  return state.briefings;
}

export async function postSupport(message) {
  return apiPost("support", { message });
}

export async function getPreDepartureChecklist() {
  const state = await getState();
  return state.preDepartureChecklist;
}

export async function toggleChecklistItem(itemId) {
  const result = await apiPost("toggleChecklist", { itemId });
  invalidateState();
  return result;
}

export async function getVisaInfo() {
  const state = await getState();
  return state.visaInfo;
}

/** Consumes a one-time linking token from a deep link (ТЗ §58). Call this
 * once at startup when a `link-<token>` start_param is present. */
export async function linkAccount(token) {
  const result = await apiPost("link", { token });
  invalidateState();
  return result;
}
