/**
 * Flip the switch here once your Apps Script backend is deployed (see
 * backend-apps-script/ + SETUP.md). Leave BACKEND_URL empty to keep running
 * entirely on mock data (Phase 1 behaviour) — nothing else changes.
 */
export const BACKEND_URL = ""; // e.g. "https://script.google.com/macros/s/AKfycb.../exec"

export function isLiveBackendConfigured() {
  return Boolean(BACKEND_URL);
}
