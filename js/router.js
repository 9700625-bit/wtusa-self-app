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

/**
 * КНОПКА «НАЗАД» TELEGRAM (12.10.2026).
 *
 * Что ломалось. В шапке Telegram у Mini App всегда был крестик «Закрыть», а
 * «Назад» — только кнопкой внутри экрана, которую на длинном экране надо было
 * искать прокруткой вверх. Привычный жест «назад» (крестик/стрелка вверху,
 * свайп на Android) закрывал приложение целиком.
 *
 * Теперь, если в истории приложения больше одного экрана, показываем штатную
 * кнопку Telegram BackButton; нажатие — тот же goBack(), что и у кнопки
 * «← Назад» на экране. На первом экране кнопку прячем. Старые клиенты без
 * BackButton просто ничего не показывают.
 */
let кнопкаНазадПодключена = false;
function обновитьКнопкуНазад_() {
  try {
    const app = window.Telegram && window.Telegram.WebApp;
    const bb = app && app.BackButton;
    if (!bb || typeof bb.show !== "function" || typeof bb.hide !== "function") return;
    if (!кнопкаНазадПодключена && typeof bb.onClick === "function") {
      bb.onClick(goBack);
      кнопкаНазадПодключена = true;
    }
    // Волна 5 (аудит 14.10.2026, B-64): и на вложенном экране, открытом по ссылке (status_…,
    // event_…), где в истории он один. Раньше кнопка там была скрыта, и «Назад» на Android
    // закрывал приложение, хотя на экране есть «← Назад»; теперь она ведёт на главную, как и
    // экранная (goBack без предыдущего экрана идёт на home). На вкладках — по-прежнему скрыта.
    if (historyStack.length > 1 || !этоВкладка_(historyStack[historyStack.length - 1])) bb.show();
    else bb.hide();
  } catch (e) {
    // кнопка — удобство, ошибка в ней не должна ронять отрисовку экрана
  }
}

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = raw.split("/").filter(Boolean);
  return { name: name || "home", params: rest };
}

// Фоновое обновление данных (liveApi, 01.10.2026): пришли свежие —
// тихо перерисовываем текущий экран. Если человек что-то печатает —
// не трогаем, чтобы не стереть ввод.
// P12-аудит (12.10.2026): перерисовка ТИХАЯ. Что ломалось: она шла как обычный переход —
// экран затемнялся, страница прокручивалась в самый верх (студент читал середину «Оплаты» и
// через 3 с после открытия его подбрасывало наверх), а «Мероприятия» сбрасывали выбранные
// день и время. Теперь прокрутка остаётся на месте, затемнения нет, а экран получает
// признак «тихо» (третий аргумент render) и может сохранить то, что студент начал выбирать.
window.addEventListener("state-refreshed", () => {
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
  render(true, true);
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
let ошибкаSdkНаЭкране_ = false;

// Волна 5 (B-10): SDK Telegram пришёл позже первого экрана — показываем BackButton, а если на
// экране «Не удалось связаться с Telegram», сразу пробуем ещё раз.
window.addEventListener("telegram-ready", () => {
  обновитьКнопкуНазад_();
  if (ошибкаSdkНаЭкране_) render(true);
});
// Волна 5 (B-10): SDK сообщил другой аккаунт, чем в данных запуска, — то, что нарисовано из
// копии на телефоне, убираем сразу, не дожидаясь сервера.
window.addEventListener("account-changed", () => {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  render(true);
});

/**
 * P12-аудит (12.10.2026): ВКЛАДКИ НЕ КОПЯТСЯ В ИСТОРИИ «НАЗАД». Что ломалось: каждая вкладка
 * нижнего меню ложилась в историю, кнопка Telegram «Назад» появлялась на самих вкладках и
 * водила по ним по кругу (Профиль → Оплата → Документы…). Теперь переход на вкладку (без
 * параметров) начинает историю заново, и «Назад» на ней скрыт; в историю ложатся только
 * вложенные экраны — этап, поздравление, конкретное приглашение (event/<id>).
 */
const ВКЛАДКИ_ = ["home", "roadmap", "event", "documents", "payments", "profile"];
function этоВкладка_(запись) {
  return !запись || ВКЛАДКИ_.includes(запись);
}

/**
 * Волна 5 (аудит 14.10.2026, B-22): СТЕК «НАЗАД» ЖИВЁТ В САМОЙ ЗАПИСИ ИСТОРИИ. Что ломалось:
 * браузерная «Назад» (Telegram Web/Desktop, жест, Alt+←) меняла адрес, а наш стек об этом не
 * знал и только дописывался: home → этап A → этап B, браузерная «Назад» на A, затем кнопка
 * Telegram «Назад» вела ВПЕРЁД на B. Теперь каждая запись истории хранит снимок стека
 * (history.state); при переходе по истории стек берётся из записи, на которую вернулись.
 */
function стекИзИстории_(currentEntry) {
  try {
    const st = window.history.state;
    const снимок = st && Array.isArray(st.wtusaStack) ? st.wtusaStack : null;
    if (снимок && снимок.length && снимок[снимок.length - 1] === currentEntry) return снимок.slice();
  } catch (e) { /* history недоступна */ }
  return null;
}
function запомнитьСтек_() {
  try {
    const st = window.history.state;
    const было = st && Array.isArray(st.wtusaStack) ? st.wtusaStack.join("|") : null;
    if (было === historyStack.join("|")) return;
    window.history.replaceState(Object.assign({}, st && typeof st === "object" ? st : {}, { wtusaStack: historyStack.slice() }), "");
  } catch (e) { /* не страшно: стек просто не переживёт переход по истории */ }
}

async function render(force, тихо) {
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
  const изИстории = стекИзИстории_(currentEntry);
  if (изИстории) {
    historyStack.length = 0;
    historyStack.push(...изИстории);
  } else if (!params.length && ВКЛАДКИ_.includes(resolvedName)) {
    historyStack.length = 0;
    historyStack.push(currentEntry);
  } else if (historyStack[historyStack.length - 1] !== currentEntry) {
    historyStack.push(currentEntry);
  }
  запомнитьСтек_();
  обновитьКнопкуНазад_();

  const seq = ++renderSeq;
  const актуальна = () => seq === renderSeq;
  const холст = document.createElement("div");

  if (!тихо) containerEl.setAttribute("aria-busy", "true");
  const прокрутка = window.scrollY;
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
    await renderFn(холст, params, { актуальна, redirect, тихо: !!тихо });
    if (!актуальна()) return; // пока экран загружался, студент открыл другой
    // Экран, который сам ничего не нарисовал (перенаправил на другой адрес),
    // прежнее содержимое не стирает — его заменит следующий экран.
    if (холст.childNodes.length) {
      ошибкаSdkНаЭкране_ = false;
      containerEl.innerHTML = "";
      containerEl.appendChild(холст);
    }
    if (тихо) {
      window.scrollTo(0, прокрутка); // тихая перерисовка: остаёмся там, где читал студент
      if (onNavigate) onNavigate(resolvedName, params);
      return;
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
    } else if (код === "NOT_IN_TELEGRAM") {
      // Волна 5 (аудит 14.10.2026, B-65): открыли в обычном браузере. Раньше запрос уходил на
      // сервер с пустыми данными входа и возвращался ложным «Сеанс устарел».
      заголовок = "Откройте приложение через Telegram";
      пояснение = "Это приложение работает только внутри Telegram: откройте его из чата с ботом ABC Universe или по персональной ссылке, которую прислал координатор.";
    } else if (код === "TG_SDK_FAILED") {
      // Волна 5 (B-10): не скачался служебный файл Telegram (telegram.org), а данных входа нет.
      заголовок = "Не удалось связаться с Telegram";
      пояснение = "Приложение не получило от Telegram данные для входа — обычно из-за медленного интернета. Проверьте соединение и нажмите «Попробовать ещё раз».";
    } else if (код.indexOf("UNAUTHORIZED") !== -1 || код.indexOf("initData") !== -1) {
      заголовок = "Нужно переоткрыть приложение";
      пояснение = "Сеанс устарел — так бывает, если приложение было открыто долго. Закройте его и откройте заново из чата с ботом.";
    }

    // При «доступ по приглашению» повтор ничего не изменит — кнопка только
    // сбивала бы с толку: человек жал бы её снова и снова с тем же результатом.
    const показатьПовтор = (код.indexOf("NOT_INVITED") === -1 || !!window.__linkPending) && код !== "NOT_IN_TELEGRAM";
    ошибкаSdkНаЭкране_ = код === "TG_SDK_FAILED";
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
    if (кнопка) кнопка.addEventListener("click", () => {
      // Волна 5 (B-10): повтор снова ждёт SDK Telegram, если в прошлый раз не дождались.
      try { window.dispatchEvent(new Event("app-retry")); } catch (e) { /* старый WebView */ }
      render(true);
    });
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
