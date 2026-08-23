/**
 * Minimal hash-based router. No framework, no build step — works when the
 * app is served over HTTP (see README for why file:// won't work with ES
 * modules) and supports deep links, e.g. opening the Mini App straight into
 * a specific status screen from a Telegram notification (ТЗ §78):
 *   https://t.me/your_bot/app?startapp=status-PLACED
 * maps to #status/PLACED.
 */

const screens = new Map(); // name -> async (container, params) => void
let containerEl = null;
let onNavigate = null; // optional callback(screenName) for nav highlighting
const historyStack = [];
let lastRenderedHash = null;

export function registerScreen(name, renderFn) {
  screens.set(name, renderFn);
}

export function setNavigateListener(fn) {
  onNavigate = fn;
}

export function navigate(path) {
  if (window.location.hash === "#" + path) {
    // Same hash won't trigger hashchange — force a re-render.
    render(true);
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

async function render(force) {
  if (!containerEl) return;

  // Dedup: app.js sets window.location.hash itself for deep links (before
  // the hashchange listener below even exists yet), then immediately calls
  // initRouter() -> render() for that same hash. The browser still queues a
  // native hashchange for that hash change and fires it once the listener
  // is attached, which used to cause every deep-linked open (event_/status_)
  // to render twice and fire its screen's data fetch twice. Skip a render
  // that targets the exact hash we just rendered, unless explicitly forced
  // (navigate() uses force=true for its own same-hash re-render case).
  const hash = window.location.hash;
  if (!force && hash === lastRenderedHash) return;
  lastRenderedHash = hash;

  const { name, params } = parseHash();
  const renderFn = screens.get(name) || screens.get("home");
  const resolvedName = screens.has(name) ? name : "home";

  // Use the resolved screen name/params, not the raw hash — on a normal
  // (non-deep-link) Telegram launch the hash still holds Telegram's own
  // launch payload ("tgWebAppData=...") the first time render() runs, and
  // that garbage string must never end up in historyStack (goBack() would
  // then navigate to it).
  const currentEntry = resolvedName + (params.length ? "/" + params.join("/") : "");
  if (historyStack[historyStack.length - 1] !== currentEntry) {
    historyStack.push(currentEntry);
  }

  containerEl.setAttribute("aria-busy", "true");
  // The opacity dim above (see styles.css) only reads as "loading" when
  // there's a previous screen underneath it to dim -- on the very first
  // render, containerEl is still empty, so dimming nothing shows the user a
  // blank page with zero feedback while the first fetch is in flight. That's
  // exactly the slow case (Google Apps Script cold start, see SETUP.md's
  // quota note) where feedback matters most. Show a spinner only for that
  // one case; every later navigation already has a previous screen to dim.
  const isFirstRender = containerEl.innerHTML.trim() === "";
  if (isFirstRender) {
    containerEl.innerHTML = `<div class="loading-spinner" role="status" aria-label="Загрузка"><span class="spinner-dot"></span></div>`;
  }
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
  window.addEventListener("hashchange", () => render());
  render();
}
