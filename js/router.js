/**
 * Minimal hash-based router. No framework, no build step — works when the
 * app is served over HTTP (see README for why file:// won't work with ES
 * modules) and supports deep links, e.g. opening the Mini App straight into
 * a specific status screen from a Telegram notification (ТЗ §78):
 *   https://t.me/your_bot/app?startapp=status-STUDENT_SIGNATURE
 * maps to #status/STUDENT_SIGNATURE.
 */

const screens = new Map(); // name -> async (container, params) => void
let containerEl = null;
let onNavigate = null; // optional callback(screenName) for nav highlighting
const historyStack = [];

export function registerScreen(name, renderFn) {
  screens.set(name, renderFn);
}

export function setNavigateListener(fn) {
  onNavigate = fn;
}

export function navigate(path) {
  if (window.location.hash === "#" + path) {
    // Same hash won't trigger hashchange — force a re-render.
    render();
  } else {
    window.location.hash = path;
  }
}

/** Goes to the previous in-app screen, falling back to Home when there is
 * none (e.g. the app was deep-linked straight into a status screen). */
export function goBack() {
  historyStack.pop(); // drop current entry
  const previous = historyStack.pop();
  navigate(previous || "home");
}

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = raw.split("/").filter(Boolean);
  return { name: name || "home", params: rest };
}

async function render() {
  if (!containerEl) return;
  const { name, params } = parseHash();
  const renderFn = screens.get(name) || screens.get("home");
  const resolvedName = screens.has(name) ? name : "home";

  const currentEntry = window.location.hash.replace(/^#\/?/, "") || "home";
  if (historyStack[historyStack.length - 1] !== currentEntry) {
    historyStack.push(currentEntry);
  }

  containerEl.setAttribute("aria-busy", "true");
  try {
    await renderFn(containerEl, params);
  } catch (err) {
    console.error("[router] screen render failed:", resolvedName, err);
    // TEMP: show the real error text on-screen while debugging the live
    // backend (no devtools access inside Telegram) — revert to the plain
    // "Не удалось загрузить экран" card once things are stable.
    containerEl.innerHTML = `
      <div class="card">
        <h2>Не удалось загрузить экран</h2>
        <div class="sub">Попробуйте вернуться на главную.</div>
        <div class="small" style="margin-top:8px;color:var(--danger)">${(err && err.message) || String(err)}</div>
      </div>`;
  } finally {
    containerEl.removeAttribute("aria-busy");
  }

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (onNavigate) onNavigate(resolvedName, params);
}

export function initRouter(container) {
  containerEl = container;
  window.addEventListener("hashchange", render);
  render();
}
