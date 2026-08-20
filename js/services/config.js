/**
 * Flip the switch here once your Apps Script backend is deployed (see
 * backend-apps-script/ + SETUP.md). Leave BACKEND_URL empty to keep running
 * entirely on mock data (Phase 1 behaviour) — nothing else changes.
 */
export const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxCe_iRK4uEJIw3t-d7Iypj7QbMZTw9M0rHj6UbgRo4dyV2kuJN1d4dH1kln1h1apIZjA/exec";

export function isLiveBackendConfigured() {
  return Boolean(BACKEND_URL);
}
