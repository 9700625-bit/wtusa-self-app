import { initRouter, registerScreen, setNavigateListener } from "./router.js";
import { renderNav, setActiveNav } from "./components/nav.js";
import { mountDemoPanel } from "./components/demoPanel.js";
import { initTelegram, getStartParam } from "./services/telegram.js";
import { isLiveBackendConfigured } from "./services/config.js";
import * as api from "./services/api.js";

import * as home from "./screens/home.js";
import * as roadmap from "./screens/roadmap.js";
import * as documents from "./screens/documents.js";
import * as payments from "./screens/payments.js";
import * as profile from "./screens/profile.js";
import * as statusDetail from "./screens/statusDetail.js";
import * as celebration from "./screens/celebration.js";
import * as events from "./screens/events.js";

initTelegram();

registerScreen("home", home.render);
registerScreen("roadmap", roadmap.render);
registerScreen("documents", documents.render);
registerScreen("payments", payments.render);
registerScreen("profile", profile.render);
registerScreen("status", statusDetail.render);
registerScreen("celebration", celebration.render);
// Deep link: t.me/bot/app?startapp=event_<groupId> -> #event/<groupId> (see
// handleStartParam below). The screen itself always lists ALL of this
// student's invitations — the groupId param isn't currently used to filter,
// it's just what makes the link land on the right screen.
registerScreen("event", events.render);

const navEl = document.getElementById("bottom-nav");
const contentEl = document.getElementById("screen-root");

renderNav(navEl);
setNavigateListener((screenName) => setActiveNav(navEl, screenName));

// Deep link support (ТЗ §58/§78): either a one-time account-linking token
// (?startapp=link_<token>) or a direct jump to a screen (?startapp=status_STUDENT_SIGNATURE).
async function handleStartParam() {
    const startParam = getStartParam();
    if (!startParam) return;

    if (startParam.type === "link" && startParam.rest) {
          try {
                  await api.linkAccount(startParam.rest);
          } catch (err) {
                  console.error("[app] account linking failed:", err);
          }
          return;
    }

    // NOTE: intentionally not checking "!window.location.hash" here.
        // Inside real Telegram clients the page loads with Telegram's own launch
        // data already in the hash (e.g. "#tgWebAppData=...&tgWebAppVersion=..."),
        // so that check was always false there and silently broke every deep
        // link (both event_ and status_) whenever this was opened for real from
        // a Telegram message, even though it worked fine in a plain browser tab
        // where the hash starts empty. Always override with our own route.
        if (startParam.type && startParam.rest) {
                    window.location.hash = `${startParam.type}/${startParam.rest}`;
        }
}

handleStartParam().finally(() => {
    initRouter(contentEl);
});

// The demo stage-switcher only makes sense on mock data — once a live
// amoCRM-backed backend is configured, currentStageId is real and this
// panel is never mounted.
if (!isLiveBackendConfigured()) {
    mountDemoPanel();
}
