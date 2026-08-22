/**
 * Central handler for stage CTA actions ("Открыть CIEE", "Написать
 * координатору", "Открыть инструкцию", ...). Screens declare CTAs
 * declaratively via roadmap.config.js (`cta: { label, action }`) and call
 * `runCtaAction(action)` — this keeps screens free of link/URL details.
 */

import { openExternalLink, openTelegramLink, hapticImpact } from "./telegram.js";
import * as api from "./api.js";

const MOCK_CIEE_PORTAL_URL = "https://www.ciee.org/participant-login";
const MOCK_INSTRUCTIONS_URL = "https://abcuniverse.kz/instructions/self";

export async function runCtaAction(action, meta = {}) {
  hapticImpact("light");
  switch (action) {
    case "openCiee":
      openExternalLink(MOCK_CIEE_PORTAL_URL);
      break;
    case "openInstruction":
      openExternalLink(MOCK_INSTRUCTIONS_URL);
      break;
    case "writeCoordinator": {
      const { coordinator } = await api.getMe();
      if (coordinator && coordinator.telegramUsername) {
        openTelegramLink(`https://t.me/${coordinator.telegramUsername}`);
      }
      break;
    }
    case "openChecklist":
      window.location.hash = `status/${meta.stageId || "PRE_DEPARTURE"}`;
      break;
    default:
      console.warn("[actions] unknown CTA action:", action);
  }
}
