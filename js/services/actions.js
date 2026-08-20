/**
 * Central handler for stage CTA actions ("Открыть CIEE", "Написать
 * координатору", "Открыть инструкцию", ...). Screens declare CTAs
 * declaratively via roadmap.config.js (`cta: { label, action }`) and call
 * `runCtaAction(action)` — this keeps screens free of link/URL details.
 *
 * URLs are mock placeholders for Phase 1; Phase 2 will likely source them
 * from participant-specific data (real CIEE portal link, coordinator chat).
 */

import { openExternalLink, openTelegramLink, hapticImpact } from "./telegram.js";
import * as db from "../data/mockData.js";

const MOCK_CIEE_PORTAL_URL = "https://www.ciee.org/participant-login";
const MOCK_INSTRUCTIONS_URL = "https://abcuniverse.kz/instructions/self";

export function runCtaAction(action, meta = {}) {
  hapticImpact("light");
  switch (action) {
    case "openCiee":
      openExternalLink(MOCK_CIEE_PORTAL_URL);
      break;
    case "openInstruction":
      openExternalLink(MOCK_INSTRUCTIONS_URL);
      break;
    case "writeCoordinator":
      openTelegramLink(`https://t.me/${db.coordinator.telegramUsername}`);
      break;
    case "openChecklist":
      // In-app navigation (e.g. Pre-Departure checklist lives on its own
      // Status Detail screen, not an external link).
      window.location.hash = `status/${meta.stageId || "PRE_DEPARTURE"}`;
      break;
    default:
      console.warn("[actions] unknown CTA action:", action);
  }
}
