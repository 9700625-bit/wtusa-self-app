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

/**
 * ТАЙМАУТ И РАЗБОР ОТВЕТА (02.09.2026).
 *
 * Здесь было два пробела, и оба били по студенту на слабой сети.
 *
 * Первый: fetch без таймаута. Если запрос повисал — метро, лифт, холодный
 * старт Apps Script — он не завершался НИКОГДА. Значит не срабатывал ни
 * catch, ни finally, и человек смотрел на крутящийся кружок минуту и больше,
 * без единого слова и без возможности повторить.
 *
 * Второй: resp.json() вызывался без проверки, что ответ вообще JSON. Apps
 * Script при исчерпании квоты или проблеме с доступом отдаёт HTML-страницу, и
 * студент получал на экран «Unexpected token '<' ... is not valid JSON».
 *
 * ЗАЧЕМ 25 СЕКУНД. Холодный старт Apps Script занимает до 10–15 секунд — это
 * нормальная работа, а не сбой, обрывать её нельзя. Берём с запасом, но так,
 * чтобы человек не ждал бесконечно.
 */
const ТАЙМАУТ_МС = 25000;

async function запросить_(url, options, таймаутМс) {
    // AbortController есть во всех браузерах, где работает Telegram Mini App.
    const controller = new AbortController();
    const таймер = setTimeout(() => controller.abort(), таймаутМс || ТАЙМАУТ_МС);
    let resp;
    try {
        resp = await fetch(url, { ...(options || {}), signal: controller.signal });
    } catch (err) {
        // Различаем «истекло время» и «сети нет» — на экране это разные советы.
        if (err && err.name === "AbortError") throw new Error("TIMEOUT");
        throw new Error("OFFLINE");
    } finally {
        clearTimeout(таймер);
    }

    const текст = await resp.text();
    let json;
    try {
        json = JSON.parse(текст);
    } catch (err) {
        // Не JSON — почти всегда HTML-страница ошибки от Google.
        console.error("[api] сервер ответил не JSON:", текст.slice(0, 300));
        throw new Error("BACKEND_HTML");
    }
    if (json.error) throw new Error(json.error);
    return json;
}

async function apiGet(action, extraParams) {
    const params = new URLSearchParams({ action, initData: getInitData(), ...(extraParams || {}) });
    return запросить_(`${BACKEND_URL}?${params.toString()}`, { method: "GET" });
}

async function apiPost(action, payload, таймаутМс) {
    return запросить_(`${BACKEND_URL}?action=${encodeURIComponent(action)}`, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // see CORS note above
          body: JSON.stringify({ initData: getInitData(), ...(payload || {}) }),
    }, таймаутМс);
}

// МГНОВЕННЫЙ ПОКАЗ ИЗ ПАМЯТИ ТЕЛЕФОНА (01.10.2026, ТЗ ускорения, п. 3.1).
// Замер: ответ сервера на state — ~3 с при любом входе (8 чтений листов по
// 0,2–0,7 с). Поэтому последний ответ сохраняем в localStorage и при
// следующем открытии рисуем экран сразу из него, а свежие данные тянем в
// фоне. Пришли другие — событие "state-refreshed", роутер перерисует экран.
// Ключ привязан к telegram id (чужих данных не покажем), старше 7 дней —
// не показываем. localStorage в некоторых webview недоступен — всё в try.
const DISK_KEY_PREFIX_ = "wtusa_state_v1_";
const DISK_MAX_AGE_MS_ = 7 * 24 * 3600 * 1000;
function diskKey_() {
    try {
        const u = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user;
        return u && u.id ? DISK_KEY_PREFIX_ + u.id : null;
    } catch (e) { return null; }
}
function diskLoad_() {
    try {
        const k = diskKey_(); if (!k) return null;
        const raw = localStorage.getItem(k); if (!raw) return null;
        const saved = JSON.parse(raw);
        if (!saved || !saved.data || !saved.at || Date.now() - saved.at > DISK_MAX_AGE_MS_) return null;
        return saved.data;
    } catch (e) { return null; }
}
function diskSave_(data) {
    try {
        const k = diskKey_(); if (!k) return;
        const copy = { ...data }; delete copy._t;
        localStorage.setItem(k, JSON.stringify({ at: Date.now(), data: copy }));
    } catch (e) { /* нет места или запрещено — просто не сохраняем */ }
}
function diskClear_() {
    try { const k = diskKey_(); if (k) localStorage.removeItem(k); } catch (e) { /* ignore */ }
}
let fromDisk_ = false;
(function () {
    const saved = diskLoad_();
    if (saved) { stateCache = saved; stateCacheAt = 0; fromDisk_ = true; }
})();

function fetchState_() {
    if (!statePromise) {
        statePromise = apiGet("state")
            .then((json) => {
                stateCache = json;
                stateCacheAt = Date.now();
                fromDisk_ = false;
                diskSave_(json);
                return json;
            })
            .finally(() => {
                statePromise = null;
            });
    }
    return statePromise;
}

async function getState(force) {
    // Данные с диска: отдаём сразу, свежие — в фоне (один раз).
    if (!force && fromDisk_ && stateCache) {
        if (!statePromise) {
            const before = JSON.stringify(stateCache);
            fetchState_()
                .then((json) => {
                    const after = { ...json }; delete after._t;
                    if (JSON.stringify(after) !== before) window.dispatchEvent(new Event("state-refreshed"));
                })
                .catch((err) => {
                    // Доступ отозван — стираем сохранённое и даём экрану показать ошибку.
                    if (/NOT_INVITED|UNAUTHORIZED/.test(String(err && err.message))) {
                        diskClear_(); stateCache = null; fromDisk_ = false;
                        window.dispatchEvent(new Event("state-refreshed"));
                    }
                });
        }
        return stateCache;
    }
    const fresh = !force && stateCache && Date.now() - stateCacheAt < STATE_CACHE_MS;
    if (fresh) return stateCache;
    if (force) statePromise = null; // discard any stale in-flight promise, force a real refetch
    return fetchState_();
}

function invalidateState() {
    stateCache = null;
    fromDisk_ = false;
}

/**
 * ТОЧЕЧНОЕ ОБНОВЛЕНИЕ КЕША (14.09.2026).
 *
 * Половина действий в приложении меняет ровно одно поле состояния, а
 * бэкенд в ответ уже присылает новое значение. Раньше мы это значение
 * выбрасывали и звали invalidateState() — то есть следующая же отрисовка
 * экрана тянула состояние целиком заново. А "состояние целиком" на стороне
 * Apps Script — это восемь полных чтений листов Google Sheets.
 *
 * Замерено на стенде: один клик по галочке чек-листа давал ДВА обращения к
 * серверу вместо одного. На чек-листе из восьми пунктов это восемь лишних
 * полных выгрузок базы, и каждая — пара секунд ожидания с перерисовкой
 * экрана под пальцем.
 *
 * Здесь мы вместо этого кладём свежее значение в уже имеющийся кеш. Если
 * кеша нет (первое действие после запуска) — честно инвалидируем, как
 * раньше: тогда следующий getState() и так сходит на сервер один раз.
 */
function patchState_(поле, значение) {
    if (stateCache && значение !== undefined && значение !== null) {
        stateCache = { ...stateCache, [поле]: значение };
    } else {
        invalidateState();
    }
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

/** Ошибка JavaScript на экране → владельцу в Telegram (см. clientError_ в Api.gs). */
export async function reportClientError(payload) {
    return apiPost("clientError", payload);
}

/**
 * СОСТОЯНИЕ НЕ СБРАСЫВАЕМ (14.09.2026).
 *
 * Обе эти кнопки ставят координатору задачу в amoCRM и, в случае визы,
 * помечают участника в листе Participants. Ни то, ни другое не попадает в
 * ответ `state`: stateForUser_ (Api.gs) собирает participant из строго
 * перечисленных полей, и флага подтверждения среди них нет.
 *
 * То есть прежний invalidateState() заставлял следующий же экран заново
 * выгрузить всю базу — ради данных, которые не изменились. Замерено: после
 * нажатия «Я готов(а) к визе» переход на любой экран стоил лишнего полного
 * запроса состояния.
 *
 * ЕСЛИ бэкенд когда-нибудь начнёт отдавать эти флаги во `state` (например
 * чтобы кнопка оставалась «Подтверждено ✅» после перезахода) — сброс кеша
 * сюда надо вернуть, иначе экран будет показывать старое значение.
 */
// ФЛАГИ ТЕПЕРЬ ЕСТЬ ВО STATE (22.09.2026): бэкенд отдаёт
// participant.visaReadyConfirmed / jobOfferReadyConfirmed. После нажатия
// кладём флаг в кеш на месте (patchState_), не сбрасывая всё состояние —
// экран сразу рисует кнопку серой, и после перезахода она такой и остаётся.
function markParticipantFlag_(поле) {
    if (stateCache && stateCache.participant) {
        patchState_("participant", { ...stateCache.participant, [поле]: true });
    } else {
        invalidateState();
    }
}

export async function confirmVisaReady() {
    const result = await apiPost("confirmVisaReady", {});
    markParticipantFlag_("visaReadyConfirmed");
    return result;
}

export async function confirmJobOffer() {
    const result = await apiPost("confirmJobOffer", {});
    markParticipantFlag_("jobOfferReadyConfirmed");
    return result;
}

export async function getPreDepartureChecklist() {
    const state = await getState();
    return state.preDepartureChecklist;
}

export async function toggleChecklistItem(itemId) {
    // Бэкенд (toggleChecklistItem_ в Api.gs) возвращает ВЕСЬ обновлённый
    // чек-лист — этого достаточно, чтобы поправить кеш на месте. Раньше
    // ответ игнорировался и состояние выбрасывалось целиком, из-за чего
    // экран после каждой галочки заново тянул все восемь листов.
    const checklist = await apiPost("toggleChecklist", { itemId });
    patchState_("preDepartureChecklist", Array.isArray(checklist) ? checklist : null);
    return checklist;
}

export async function getVisaInfo() {
    const state = await getState();
    return state.visaInfo;
}

/** Consumes a one-time linking token from a deep link (ТЗ §58). Call this
 * once at startup when a `link-<token>` start_param is present. */
/** Есть ли на этом телефоне сохранённые данные студента (значит, он уже привязан). */
export function hasSavedState() {
    return fromDisk_ && !!stateCache;
}

// ПОДКЛЮЧЕНИЕ НЕ ОБРЫВАЕМ ЧЕРЕЗ 25 С (01.10.2026). Привязка на сервере — это
// запись в таблицу + заметка/тег в amoCRM + подтягивание платежей и документов
// из сделки, с холодным стартом бывает дольше 25 с. Студент видел «Сервер долго
// не отвечает», хотя сервер его уже подключил (Абуталипова, Адамбек 01.10), а
// «Попробовать ещё раз» снова запускал ту же долгую привязку. Теперь ждём до
// 60 с, а если и это истекло — не показываем ошибку, а сразу открываем
// приложение: состояние грузится по Telegram id, и если привязка на сервере
// прошла (почти всегда так), студент просто попадает внутрь.
const ТАЙМАУТ_ПРИВЯЗКИ_МС = 60000;
export async function linkAccount(token) {
    try {
        const result = await apiPost("link", { token }, ТАЙМАУТ_ПРИВЯЗКИ_МС);
        invalidateState();
        return result;
    } catch (err) {
        if (String(err && err.message) === "TIMEOUT") {
            invalidateState();
            return { pending: true };
        }
        throw err;
    }
}

// Deliberately NOT folded into getState()/stateCache: event invitations are
// invite-only and low-volume, and a student needs to see the result of
// confirming/declining immediately — a plain always-fresh call is simpler
// and cheaper here than adding a second cache with its own invalidation.
//
// КОРОТКИЙ КЕШ (14.09.2026). Замысел выше остаётся в силе, но «всегда
// свежо» означало запрос на КАЖДЫЙ заход во вкладку «События» — в разборе
// одного сеанса это оказалось шесть обращений из тринадцати, больше всех
// остальных вместе взятых. Человек, который трижды заглянул в мероприятия,
// трижды ждал ответа сервера ради одного и того же списка.
//
// Компромисс: держим ответ 60 секунд и СБРАСЫВАЕМ его сразу после записи
// или отказа. То есть требование «увидеть результат своего действия
// немедленно» выполняется буквально, как и раньше. Меняется только одно:
// приглашение, которое координатор создал, пока студент сидит в
// приложении, появится у него в течение минуты, а не мгновенно.
// 01.10: 60 с → 5 мин, как у state. После записи/отказа кеш всё равно
// сбрасывается (respondEvent), а каждые 60 с главная ждала сервер заново.
const EVENTS_CACHE_MS = 5 * 60 * 1000;
let eventsCache = null;
let eventsCacheAt = 0;
let eventsPromise = null;

// 01.10: мероприятия тоже сохраняем на телефоне — иначе при мгновенном
// открытии из сохранённого state главная всё равно ждала их до 1,2 с.
let eventsFromDisk_ = false;
(function () {
    try {
        const k = diskKey_(); if (!k) return;
        const saved = JSON.parse(localStorage.getItem(k + "_ev") || "null");
        if (saved && saved.data && Date.now() - saved.at < DISK_MAX_AGE_MS_) { eventsCache = saved.data; eventsCacheAt = 0; eventsFromDisk_ = true; }
    } catch (e) { /* ignore */ }
})();

export async function getEvents() {
    if (eventsFromDisk_ && eventsCache) {
        eventsFromDisk_ = false;
        const cached = eventsCache;
        const before = JSON.stringify(cached);
        eventsCache = null;
        // свежие — в фоне; пришли другие — перерисовываем экран (как для state)
        getEvents()
            .then((fresh) => { if (JSON.stringify(fresh) !== before) window.dispatchEvent(new Event("state-refreshed")); })
            .catch(() => {});
        eventsCache = eventsCache || cached;
        return cached;
    }
    if (eventsCache && Date.now() - eventsCacheAt < EVENTS_CACHE_MS) return eventsCache;
    // Склейка параллельных вызовов — та же причина, что и у getState выше:
    // экран может спросить события дважды в один тик.
    if (!eventsPromise) {
        eventsPromise = apiGet("events")
            .then((json) => {
                eventsCache = json;
                eventsCacheAt = Date.now();
                try { const k = diskKey_(); if (k) localStorage.setItem(k + "_ev", JSON.stringify({ at: Date.now(), data: json })); } catch (e) { /* ignore */ }
                return json;
            })
            .finally(() => { eventsPromise = null; });
    }
    return eventsPromise;
}

export async function respondEvent(groupId, choice, chosenEventId) {
    const result = await apiPost("respondEvent", { groupId, choice, chosenEventId });
    eventsCache = null; // ответ студента меняет список — показываем свежий
    return result;
}
