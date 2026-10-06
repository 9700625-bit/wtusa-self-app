/**
 * Minimal hash-based router. No framework, no build step — works when the
 * app is served over HTTP (see README for why file:// won't work with ES
 * modules) and supports deep links, e.g. opening the Mini App straight into
 * a specific status screen from a Telegram notification (ТЗ §78):
 *   https://t.me/your_bot/app?startapp=status-PLACEMENT_COMPLETED
 * maps to #status/PLACEMENT_COMPLETED.
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

/** Заменяет текущий экран другим, не оставляя его в истории «Назад»
 * (иначе «Назад» с нового экрана вернул бы на экран, который снова перенаправит).
 * Не экспортируется: экран получает её третьим аргументом render — так файлы
 * экранов не зависят от того, какая версия router.js оказалась в кеше браузера. */
function redirect(path) {
  historyStack.pop();
  navigate(path);
}

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = raw.split("/").filter(Boolean);
  return { name: name || "home", params: rest };
}

// Фоновое обновление данных (liveApi, 01.10.2026): пришли свежие —
// тихо перерисовываем текущий экран. Если человек что-то печатает —
// не трогаем, чтобы не стереть ввод.
window.addEventListener("state-refreshed", () => {
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
  render(true);
});

// НОМЕР ОТРИСОВКИ (05.10.2026). Экраны ждут разные данные и заканчивают не в том
// порядке, в каком были открыты: студент нажал «События» (ответ идёт 5 с), потом
// «Оплата» (готова сразу) — через 4 с «События» рисовались ПОВЕРХ «Оплаты»: адрес
// и подсветка меню — одного экрана, содержимое — другого, а повторное нажатие на
// вкладку ничего не делало (адрес тот же). На первом запуске так же главная
// затирала любую вкладку, открытую, пока шла загрузка. Теперь каждый экран
// рисуется в свой отдельный блок, а на страницу блок попадает, только если с
// начала его отрисовки не началась более новая. Опоздавший экран просто
// отбрасывается; его поздние перерисовки (после «Записаться», после галочки
// чек-листа) идут в тот же отброшенный блок и на странице не видны.
let renderSeq = 0;

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

  const seq = ++renderSeq;
  const актуальна = () => seq === renderSeq;
  const холст = document.createElement("div");

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
    await renderFn(холст, params, { актуальна, redirect });
    if (!актуальна()) return; // пока экран загружался, студент открыл другой
    // Экран, который сам ничего не нарисовал (перенаправил на другой адрес),
    // прежнее содержимое не стирает — его заменит следующий экран.
    if (холст.childNodes.length) {
      containerEl.innerHTML = "";
      containerEl.appendChild(холст);
    }
  } catch (err) {
    console.error("[router] screen render failed:", resolvedName, err);
    // Мониторинг (23.09.2026): экран не отрисовался — это и есть тот баг, о
    // котором владелец должен узнать раньше студента. Обработчик в app.js.
    if (typeof window.__reportScreenError === "function") window.__reportScreenError(err, "screen:" + resolvedName);
    if (!актуальна()) return; // ошибка экрана, с которого уже ушли, — карточку не рисуем
    // ЧЕЛОВЕЧЕСКИЙ ТЕКСТ ОШИБКИ (02.09.2026).
    //
    // Здесь стояла временная заглушка, показывавшая студенту сырое сообщение
    // об ошибке — по-английски и на языке программиста: «Failed to fetch»,
    // «Unexpected token '<' ... is not valid JSON», «UNAUTHORIZED: invalid or
    // missing Telegram initData». Ни кнопки «Обновить», ни подсказки, что
    // делать. Единственным выходом было закрыть и переоткрыть приложение —
    // догадаться до этого невозможно.
    //
    // Теперь на каждую понятную причину — своё объяснение и своё действие.
    // Технический текст остаётся в консоли для разбора, но на экран не идёт.
    const код = (err && err.message) || String(err);
    let заголовок = "Не удалось загрузить экран";
    let пояснение = "Что-то пошло не так на нашей стороне. Попробуйте ещё раз.";

    if (код === "OFFLINE") {
      заголовок = "Нет связи";
      пояснение = "Похоже, интернет пропал. Проверьте соединение и попробуйте ещё раз.";
    } else if (код === "TIMEOUT") {
      заголовок = "Сервер долго не отвечает";
      пояснение = "Соединение слишком медленное. Попробуйте ещё раз — обычно со второго раза открывается.";
    } else if (код === "BACKEND_HTML") {
      заголовок = "Приложение временно недоступно";
      пояснение = "Мы уже знаем о проблеме. Попробуйте зайти через несколько минут.";
    } else if (код.indexOf("NOT_INVITED") !== -1) {
      // Человек открыл приложение, не получив персональную ссылку от
      // координатора. Это не ошибка и не сбой — просто он ещё не участник,
      // поэтому текст объясняет, а не извиняется.
      заголовок = "Откройте ссылку из WhatsApp";
      пояснение =
        "Чтобы войти, откройте персональную ссылку, которую ABC Universe отправил вам в WhatsApp, — приложение подключится само. Если сообщения со ссылкой нет, напишите координатору.";
      if (window.__linkPending) {
        заголовок = "Подключение ещё идёт";
        пояснение = "Сервер ещё подключает ваш профиль. Подождите несколько секунд и нажмите «Попробовать ещё раз».";
      }
    } else if (код.indexOf("UNAUTHORIZED") !== -1 || код.indexOf("initData") !== -1) {
      заголовок = "Нужно переоткрыть приложение";
      пояснение = "Сеанс устарел — так бывает, если приложение было открыто долго. Закройте его и откройте заново из чата с ботом.";
    }

    // При «доступ по приглашению» повтор ничего не изменит — кнопка только
    // сбивала бы с толку: человек жал бы её снова и снова с тем же результатом.
    const показатьПовтор = код.indexOf("NOT_INVITED") === -1 || !!window.__linkPending;
    containerEl.innerHTML = `
      <div class="card">
        <h2>${заголовок}</h2>
        <div class="sub">${пояснение}</div>
        ${показатьПовтор ? `<button class="btn btn-primary" id="retry-btn" style="margin-top:14px">Попробовать ещё раз</button>` : ""}
      </div>`;
    const кнопка = containerEl.querySelector("#retry-btn");
    // render(force=true) перерисовывает текущий хэш заново: сигнатура функции —
    // render(force), а не render(имя, параметры). Именно force здесь обязателен,
    // иначе проверка «этот хэш уже отрисован» молча отменит повтор.
    if (кнопка) кнопка.addEventListener("click", () => render(true));
  } finally {
    // Затемнение «идёт загрузка» снимает только самая свежая отрисовка.
    if (актуальна()) containerEl.removeAttribute("aria-busy");
  }

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (onNavigate) onNavigate(resolvedName, params);
}

export function initRouter(container) {
  containerEl = container;
  window.addEventListener("hashchange", () => render());
  render();
}
