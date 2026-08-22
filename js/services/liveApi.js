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
// Was 4s — way too short: the backend round-trip itself can take a second
// or more (Apps Script + Google Sheets), so a normal "read the Home screen,
// then tap Путь" pause outlived the cache and re-triggered a full fetch on
// almost every navigation. Data here only changes via an explicit action in
// this app (upload/checklist/link — all call invalidateState() themselves)
// or a webhook from amoCRM on the backend side, so it's safe to treat one
// open of the Mini App as "fresh enough" for several minutes.
const STATE_CACHE_MS = 5 * 60 * 1000;
// Some screens fetch more than one thing at once (e.g. documents.js does
// Promise.all([getDocuments(), getMe()])) — both call getState() in the same
// tick, before either has had a chance to populate stateCache. Without this,
// that fired two full network requests to the backend instead of one.
// Caching the in-flight PROMISE (not just the resolved value) means every
// concurrent caller awaits the same single request.
let statePromise = null;

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
    if (force) statePromise = null; // discard any stale in-flight promise, force a real refetch
  if (!statePromise) {
        statePromise = apiGet("state")
          .then((json) => {
                    stateCache = json;
                    stateCacheAt = Date.now();
                    return json;
          })
          .finally(() => {
                    statePromise = null;
          });
  }
    return statePromise;
}

function invalidateState() {
    stateCache = null;
}

export async function getMe() {
    const state = await getState();
    return { participant: state.participant, coordinator: state.coordinator, programCost: state.programCost };
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

// Deliberately NOT folded into getState()/stateCache: event invitations are
// invite-only and low-volume, and a student needs to see the result of
// confirming/declining immediately — a plain always-fresh call is simpler
// and cheaper here than adding a second cache with its own invalidation.
export async function getEvents() {
    return apiGet("events");
}

export async function respondEvent(groupId, choice, chosenEventId) {
    return apiPost("respondEvent", { groupId, choice, chosenEventId });
}
