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
import { getInitData, getTelegramUserId, telegramReady } from "./telegram.js";
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
    let текст;
    try {
        const resp = await fetch(url, { ...(options || {}), signal: controller.signal });
        // ТЕЛО ОТВЕТА — ПОД ТЕМ ЖЕ ТАЙМЕРОМ И ТЕМ ЖЕ catch (05.10.2026). Раньше оно
        // читалось после: обрыв связи посреди ответа показывался студенту как «Что-то
        // пошло не так на нашей стороне» и уходил владельцу как ошибка приложения, а
        // зависшее чтение не обрывалось вовсе.
        текст = await resp.text();
    } catch (err) {
        // Различаем «истекло время» и «сети нет» — на экране это разные советы.
        if (err && err.name === "AbortError") throw new Error("TIMEOUT");
        throw new Error("OFFLINE");
    } finally {
        clearTimeout(таймер);
    }

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

/**
 * Волна 5 (аудит 14.10.2026, B-10, B-65): ЗАПРОС ЖДЁТ SDK TELEGRAM, НО НЕ ВЕЧНО.
 * SDK теперь грузится async, поэтому перед запросом ждём его (telegramReady — не дольше 6 с);
 * не дождались — берём данные запуска из адреса (getInitData). Данных запуска нет совсем —
 * на сервер не ходим: вне Telegram (SDK есть, а initData пустая) — NOT_IN_TELEGRAM, раньше это
 * был запрос с пустой initData и ложное «Сеанс устарел»; SDK не скачался — TG_SDK_FAILED.
 * Тексты для студента — в router.js.
 */
async function initDataДляЗапроса_() {
    await telegramReady();
    const initData = getInitData();
    if (initData) return initData;
    throw new Error(window.Telegram && window.Telegram.WebApp ? "NOT_IN_TELEGRAM" : "TG_SDK_FAILED");
}

async function apiGet(action, extraParams) {
    const params = new URLSearchParams({ action, initData: await initDataДляЗапроса_(), ...(extraParams || {}) });
    return запросить_(`${BACKEND_URL}?${params.toString()}`, { method: "GET" });
}

async function apiPost(action, payload, таймаутМс) {
    const initData = await initDataДляЗапроса_();
    return запросить_(`${BACKEND_URL}?action=${encodeURIComponent(action)}`, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // see CORS note above
          body: JSON.stringify({ initData, ...(payload || {}) }),
    }, таймаутМс);
}

/**
 * Волна 5 (аудит 14.10.2026, B-26, SEC-4): state и events — POST-ом: initData (вход студента) в теле, а не в адресе
 * (адрес оседает в журналах прокси, истории и Referer). text/plain — простой запрос, без preflight, как остальные
 * действия. Старый сервер POST state не знает («unknown action (POST)») — тогда GET, как раньше, до перезагрузки.
 */
let чтениеPost_ = true;
async function apiRead_(action) {
    if (чтениеPost_) {
        try {
            return await apiPost(action);
        } catch (err) {
            if (!/unknown action \(POST\)/.test(String(err && err.message))) throw err;
            чтениеPost_ = false;
        }
    }
    return apiGet(action);
}

// МГНОВЕННЫЙ ПОКАЗ ИЗ ПАМЯТИ ТЕЛЕФОНА (01.10.2026, ТЗ ускорения, п. 3.1).
// Замер: ответ сервера на state — ~3 с при любом входе (8 чтений листов по
// 0,2–0,7 с). Поэтому последний ответ сохраняем в localStorage и при
// следующем открытии рисуем экран сразу из него, а свежие данные тянем в
// фоне. Пришли другие — событие "state-refreshed", роутер перерисует экран.
// Ключ привязан к telegram id (чужих данных не покажем), старше 3 дней (волна 5: было 7) —
// не показываем. localStorage в некоторых webview недоступен — всё в try.
const DISK_KEY_PREFIX_ = "wtusa_state_v1_";
// Волна 5 (аудит 14.10.2026, SEC-7): 7 дней → 3. Копия на телефоне — это ФИО, платежи и комментарии координатора; на
// общем компьютере (Telegram Desktop / Web) она лежала неделю. Студент, открывающий приложение хотя бы раз в 3 дня,
// разницы не заметит (копия обновляется при каждом открытии); реже — первый экран ждёт сервер (~1–3 с), как при первом входе.
const DISK_MAX_AGE_MS_ = 3 * 24 * 3600 * 1000;
// Волна 5 (B-10): id — из SDK, а пока SDK нет — из данных запуска в адресе (getTelegramUserId):
// копия на телефоне рисуется сразу, не дожидаясь telegram.org, и только того аккаунта, который открыл приложение.
function diskKey_() {
    try {
        const id = getTelegramUserId();
        return id ? DISK_KEY_PREFIX_ + id : null;
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
    // 06.10.2026: вместе с состоянием стираем и сохранённые мероприятия (ключ …_ev) — раньше
    // после отзыва доступа они оставались на устройстве.
    // Волна 5 (B-09): и отметки «ссылка подтверждена» (…_lk) — без сохранённых данных ссылку снова проверяет сервер.
    try { const k = diskKey_(); if (k) { localStorage.removeItem(k); localStorage.removeItem(k + "_ev"); localStorage.removeItem(k + "_lk"); } } catch (e) { /* ignore */ }
}
// УСТАРЕВШИЕ КОПИИ УДАЛЯЕМ, А НЕ ТОЛЬКО НЕ ПОКАЗЫВАЕМ (06.10.2026). Копия старше 7 дней не
// показывалась, но оставалась в памяти браузера навсегда — с ФИО, платежами и комментариями
// координатора; на общем компьютере (Telegram Web / Desktop) в том числе копии других
// аккаунтов. При каждом запуске убираем все наши записи, у которых срок вышел или дата не читается.
(function () {
    try {
        const stale = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || k.indexOf(DISK_KEY_PREFIX_) !== 0) continue;
            let at = 0;
            try { at = Number((JSON.parse(localStorage.getItem(k)) || {}).at) || 0; } catch (e) { at = 0; }
            if (!at || Date.now() - at > DISK_MAX_AGE_MS_) stale.push(k);
        }
        stale.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* хранилище недоступно */ }
})();
let fromDisk_ = false;
let idКопии_ = null; // чья копия с телефона сейчас в памяти (Волна 5, B-10)
(function () {
    const saved = diskLoad_();
    if (saved) { delete saved.events; stateCache = saved; stateCacheAt = 0; fromDisk_ = true; idКопии_ = getTelegramUserId(); } // events — в своём ключе …_ev
})();

/**
 * P12-аудит (12.10.2026): ОТВЕТ, ПРОЧИТАННЫЙ ДО ДЕЙСТВИЯ СТУДЕНТА, НЕ ЗАТИРАЕТ ЕГО.
 * Что ломалось: при открытии из памяти телефона свежее состояние идёт в фоне ~3 с. Студент
 * за это время жал «Я готов(а) к визе» (или галочку чек-листа) — кеш правился на месте, а
 * потом приходил фоновый ответ, прочитанный сервером ДО нажатия, и молча возвращал старое:
 * кнопка снова активна, галочка снята, и так сохранялось на телефоне.
 * Теперь: каждое своё изменение увеличивает номер версии (stateEpoch). Ответ на запрос,
 * начатый при другой версии, в кеш не кладём — сразу перезапрашиваем.
 */
let stateEpoch = 0;
let stateИзLink_ = -1; // Волна 5 (B-08): номер версии, при которой state пришёл в ответе link (свежее ответов, ушедших до него)
function fetchState_() {
    if (statePromise) return statePromise;
    const эпоха = stateEpoch;
    const эпохаСобытий = eventsEpoch;
    const p = apiRead_("state").then(
        (json) => {
            if (statePromise === p) statePromise = null;
            const state = разобратьState_(json, эпохаСобытий); // Волна 5 (B-06): мероприятия из ответа — в свой кеш
            if (эпоха !== stateEpoch) return stateИзLink_ === stateEpoch && stateCache ? stateCache : fetchState_(); // устарел, пока шёл, — перезапрос (state из ответа link новее — его и отдаём)
            stateCache = state;
            stateCacheAt = Date.now();
            fromDisk_ = false;
            diskSave_(state);
            return state;
        },
        (err) => {
            if (statePromise === p) statePromise = null;
            throw err;
        }
    );
    statePromise = p;
    return p;
}

function безМетки_(data) {
    const copy = { ...(data || {}) }; delete copy._t;
    return JSON.stringify(copy);
}

/** Свежие данные — в фоне, один запрос на всех; пришли другие — тихо перерисовываем экран. */
function обновитьВФоне_() {
    if (statePromise) return;
    // Волна 5 (B-06): ответ state приносит и мероприятия — перерисовываем, если изменилось что-то одно.
    const снимок = () => безМетки_(stateCache) + "|" + JSON.stringify(eventsCache);
    const before = снимок();
    fetchState_()
        .then(() => {
            if (снимок() !== before) window.dispatchEvent(new Event("state-refreshed"));
        })
        .catch((err) => {
            // Доступ отозван — стираем сохранённое и даём экрану показать ошибку.
            if (/NOT_INVITED|UNAUTHORIZED/.test(String(err && err.message))) {
                diskClear_(); stateCache = null; fromDisk_ = false;
                window.dispatchEvent(new Event("state-refreshed"));
            }
        });
}

async function getState(force) {
    // Данные с диска: отдаём сразу, свежие — в фоне (один раз).
    // P12-аудит (12.10.2026): так же и с кешем старше 5 минут. Раньше после 5 минут каждый
    // переход ждал сервер ~3 с с затемнённым экраном; теперь экран рисуется сразу из
    // памяти, а свежие данные приходят тихой перерисовкой (см. router.js).
    if (!force && stateCache && (fromDisk_ || Date.now() - stateCacheAt >= STATE_CACHE_MS)) {
        обновитьВФоне_();
        return stateCache;
    }
    if (!force && stateCache) return stateCache;
    if (force) statePromise = null; // discard any stale in-flight promise, force a real refetch
    return fetchState_();
}

function invalidateState() {
    stateEpoch++; // P12-аудит: ответ, который уже в пути, в кеш не попадёт
    statePromise = null; // и следующий экран его не ждёт — сразу идёт свежий запрос
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
        // P12-аудит (12.10.2026): новая версия (ответ в пути её не затрёт, см. fetchState_)
        // и сохранённая на телефоне копия — тоже с правкой, иначе при следующем открытии
        // студент снова видел бы кнопку активной.
        stateEpoch++;
        stateCache = { ...stateCache, [поле]: значение };
        diskSave_(stateCache);
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

/** P13: студент разрешил боту писать (окно Telegram requestWriteAccess) — см. writeAccessFromApp_ в Bot.gs. */
export async function reportWriteAccess() {
    return apiPost("writeAccess", { allowed: true });
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

export async function toggleChecklistItem(itemId, done) {
    // Бэкенд (toggleChecklistItem_ в Api.gs) возвращает ВЕСЬ обновлённый
    // чек-лист — этого достаточно, чтобы поправить кеш на месте. Раньше
    // ответ игнорировался и состояние выбрасывалось целиком, из-за чего
    // экран после каждой галочки заново тянул все восемь листов.
    // ЯВНОЕ СОСТОЯНИЕ (06.10.2026). Раньше сервер получал только «переключи»: запрос,
    // повторённый после обрыва связи, снимал только что поставленную галочку. Теперь
    // передаём, какой галочка должна стать, — повтор ничего не меняет. Без done
    // (старый вызов) сервер переключает как раньше.
    const checklist = await apiPost("toggleChecklist", typeof done === "boolean" ? { itemId, done } : { itemId });
    // ИЗ ОТВЕТА БЕРЁМ ТОЛЬКО СВОЙ ПУНКТ (05.10.2026). Бэкенд отвечает списком, каким он его
    // ПРОЧИТАЛ в начале запроса, плюс свой переключённый пункт (toggleChecklistItem_, замка нет).
    // Студент отмечает пункты подряд — запросы идут одновременно, и в ответе на второй ещё нет
    // галочки первого. Раньше каждый ответ целиком заменял список в кеше: побеждал последний,
    // на экране часть галочек пропадала, хотя в таблице они стояли, а повторное нажатие их СНИМАЛО.
    const mine = Array.isArray(checklist) ? checklist.find((i) => i && i.id === itemId) : null;
    const current = stateCache && Array.isArray(stateCache.preDepartureChecklist) ? stateCache.preDepartureChecklist : null;
    if (mine && current && current.some((i) => i.id === itemId)) {
        patchState_("preDepartureChecklist", current.map((i) => (i.id === itemId ? { ...i, done: mine.done } : i)));
    } else {
        patchState_("preDepartureChecklist", Array.isArray(checklist) ? checklist : null);
    }
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

/**
 * Волна 5 (аудит 14.10.2026, B-09): «ССЫЛКА УЖЕ ПОДТВЕРЖДЕНА». Студенты открывают приложение той же ссылкой из
 * WhatsApp, и каждый такой вход слал link (замок на сервере, 3–5 полных чтений листов) — хотя сервер давно ответил
 * «уже привязан». Теперь после успешного ответа link токен запоминается рядом с сохранёнными данными студента
 * (…_lk, тот же telegram id); пока эти данные есть, повторный вход той же ссылкой link не шлёт. Данных нет
 * (новый телефон, очистка, отзыв доступа — diskClear_) — ссылку проверяет сервер, как раньше: досев после
 * оборванной первой привязки и досинхронизация продолжают работать.
 */
const ССЫЛОК_ПОМНИМ_ = 5;
function ссылкиКлюч_() { const k = diskKey_(); return k ? k + "_lk" : null; }
function запомнитьСсылку_(token) {
    try {
        const k = ссылкиКлюч_(); if (!k || !token) return;
        const saved = JSON.parse(localStorage.getItem(k) || "null");
        const list = (saved && Array.isArray(saved.tokens) ? saved.tokens : []).filter((t) => t !== String(token));
        list.push(String(token));
        localStorage.setItem(k, JSON.stringify({ at: Date.now(), tokens: list.slice(-ССЫЛОК_ПОМНИМ_) }));
    } catch (e) { /* хранилище недоступно — проверит сервер */ }
}
export function linkAlreadyConfirmed(token) {
    if (!hasSavedState() || !token) return false;
    try {
        const saved = JSON.parse(localStorage.getItem(ссылкиКлюч_()) || "null");
        return !!(saved && Array.isArray(saved.tokens) && saved.tokens.indexOf(String(token)) !== -1);
    } catch (e) { return false; }
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
        // Волна 5 (аудит 14.10.2026, B-08): withState — сервер кладёт state студента (с мероприятиями) прямо в
        // ответ link: экран рисуется без второго круга за state и events. Старый сервер поле не знает — ответ прежний.
        const result = await apiPost("link", { token, withState: true }, ТАЙМАУТ_ПРИВЯЗКИ_МС);
        const данныеИзменились = !(result && result.alreadyLinked && !result.seeded);
        if (result && result.state && typeof result.state === "object" && result.state.participant) {
            // Данные изменились (привязка, досев) — ответы, ушедшие до неё, в кеш не попадут (номер версии).
            // Не изменились — state из ответа кладём, только если свежий запрос state сейчас не идёт.
            if (данныеИзменились) { stateEpoch++; statePromise = null; stateИзLink_ = stateEpoch; }
            if (данныеИзменились || !statePromise) {
                if (данныеИзменились) { eventsEpoch++; eventsPromise = null; }
                stateCache = разобратьState_(result.state, eventsEpoch);
                stateCacheAt = Date.now();
                fromDisk_ = false;
                diskSave_(stateCache);
                result.stateApplied = true;
            }
        } else if (данныеИзменились) {
            // Волна 4: уже был привязан — данные не менялись, кеш не сбрасываем (иначе лишний запрос state ~3 с).
            invalidateState();
        }
        запомнитьСсылку_(token);
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
        if (saved && saved.data && Date.now() - saved.at < DISK_MAX_AGE_MS_) { eventsCache = saved.data; eventsCacheAt = 0; eventsFromDisk_ = true; idКопии_ = getTelegramUserId(); }
    } catch (e) { /* ignore */ }
})();

/*
 * P12-аудит (12.10.2026): ЗАПИСЬ НЕ ОТКАТЫВАЕТСЯ ФОНОВЫМ ОТВЕТОМ. Что ломалось: при открытии
 * из памяти телефона список мероприятий обновлялся в фоне 2–5 с. Студент успевал записаться,
 * кеш сбрасывался — но перечитывание получало тот же фоновый запрос, прочитанный ДО записи:
 * карточка снова предлагала «Записаться», и эта копия жила 5 минут и сохранялась на телефоне.
 * Теперь, как у state: ответ на запрос, начатый до ответа студента (другая версия eventsEpoch),
 * выбрасывается и список перезапрашивается; сохранённая копия после ответа стирается.
 */
let eventsEpoch = 0;

/**
 * Волна 5 (аудит 14.10.2026, B-06): МЕРОПРИЯТИЯ ПРИХОДЯТ ВМЕСТЕ СО STATE. Новый сервер кладёт список в ответ state
 * (поле events) — открытие приложения стало одним запросом вместо двух (state + events). Что умеет сервер,
 * запоминаем (wtusa_evst: 1 — присылает, 0 — старый сервер): со старым всё как раньше — отдельный запрос events
 * параллельно со state; первый вход, пока неизвестно, — ждём ответ state, и только если в нём списка нет,
 * спрашиваем events отдельно. Маршрут events остаётся для перечитывания (после ошибки записи и т. п.).
 */
const СЕРВЕР_EVST_KEY_ = "wtusa_evst";
let событияВState_ = null;
try { const v = localStorage.getItem(СЕРВЕР_EVST_KEY_); событияВState_ = v === "1" ? true : v === "0" ? false : null; } catch (e) { /* неизвестно */ }
function принятьСобытия_(list, эпохаСобытий) {
    if (эпохаСобытий !== eventsEpoch) return; // студент ответил на приглашение, пока шёл запрос, — список устарел
    eventsCache = list;
    eventsCacheAt = Date.now();
    eventsFromDisk_ = false;
    try { const k = diskKey_(); if (k) localStorage.setItem(k + "_ev", JSON.stringify({ at: Date.now(), data: list })); } catch (e) { /* ignore */ }
}
/** Ответ state → state без поля events; мероприятия — в свой кеш. Заодно запоминаем, присылает ли их сервер. */
function разобратьState_(json, эпохаСобытий) {
    const есть = !!json && Array.isArray(json.events);
    if (событияВState_ !== есть) {
        событияВState_ = есть;
        try { localStorage.setItem(СЕРВЕР_EVST_KEY_, есть ? "1" : "0"); } catch (e) { /* ignore */ }
    }
    if (!есть) return json;
    принятьСобытия_(json.events, эпохаСобытий);
    const state = { ...json };
    delete state.events;
    return state;
}

function fetchEvents_() {
    // Склейка параллельных вызовов — та же причина, что и у getState выше:
    // экран может спросить события дважды в один тик.
    if (eventsPromise) return eventsPromise;
    const эпоха = eventsEpoch;
    const p = apiRead_("events").then(
        (json) => {
            if (eventsPromise === p) eventsPromise = null;
            if (эпоха !== eventsEpoch) return fetchEvents_(); // устарел, пока шёл, — перезапрос
            eventsCache = json;
            eventsCacheAt = Date.now();
            eventsFromDisk_ = false;
            try { const k = diskKey_(); if (k) localStorage.setItem(k + "_ev", JSON.stringify({ at: Date.now(), data: json })); } catch (e) { /* ignore */ }
            return json;
        },
        (err) => {
            if (eventsPromise === p) eventsPromise = null;
            throw err;
        }
    );
    eventsPromise = p;
    return p;
}

function обновитьСобытияВФоне_() {
    if (eventsPromise || !eventsCache) return;
    // Волна 5 (B-06): новый сервер присылает список вместе со state — обновляем state (один запрос на всё);
    // ответ оказался без списка (старый сервер) — тогда отдельным запросом, как раньше.
    if (событияВState_ !== false) {
        if (!statePromise) обновитьВФоне_();
        if (statePromise) { statePromise.then(() => { if (событияВState_ === false) обновитьСобытияВФоне_(); }, () => {}); return; }
    }
    const before = JSON.stringify(eventsCache);
    fetchEvents_()
        .then((fresh) => { if (JSON.stringify(fresh) !== before) window.dispatchEvent(new Event("state-refreshed")); })
        .catch(() => {});
}

export async function getEvents() {
    // Из памяти телефона или старше 5 минут — отдаём сразу, свежие — в фоне;
    // пришли другие — перерисовываем экран (как для state).
    if (eventsCache && (eventsFromDisk_ || Date.now() - eventsCacheAt >= EVENTS_CACHE_MS)) {
        обновитьСобытияВФоне_();
        return eventsCache;
    }
    if (eventsCache) return eventsCache;
    // Волна 5 (B-06, PERF-5, PERF-7): списка нет, а state ещё не пришёл — список придёт в том же ответе: ждём его,
    // а не шлём второй запрос (главная не ждёт мероприятия отдельно; неприглашённому — один запрос state).
    // Старый сервер (событияВState_ === false) — отдельный запрос сразу, как раньше.
    if (событияВState_ !== false && (statePromise || !stateCache)) {
        try {
            await (statePromise || fetchState_());
        } catch (err) {
            if (событияВState_ !== false) throw err; // NOT_INVITED, нет сети — отдельный запрос не поможет
        }
        if (eventsCache) return eventsCache;
    }
    return fetchEvents_();
}

function сброситьСобытия_() {
    eventsEpoch++;
    eventsPromise = null; // устаревший запрос не ждём — перечитывание сразу идёт новым
    eventsCache = null;
    eventsFromDisk_ = false;
    try { const k = diskKey_(); if (k) localStorage.removeItem(k + "_ev"); } catch (e) { /* ignore */ }
}

export async function respondEvent(groupId, choice, chosenEventId) {
    let result;
    try {
        result = await apiPost("respondEvent", { groupId, choice, chosenEventId });
    } catch (err) {
        // Отказ сервера («нет мест», «приглашение не найдено», «время недоступно») означает, что
        // список на экране устарел: сбрасываем кеш, иначе занятое время ещё 5 минут рисуется свободным.
        // 07.10.2026: и при неизвестном исходе (обрыв, тайм-аут, страница ошибки) запись могла состояться.
        // Раньше в этих трёх случаях кеш оставался, и «перечитать список» отдавало старую копию из памяти:
        // студент записан, а карточка по-прежнему предлагает «Записаться». Теперь кеш сбрасывается всегда.
        сброситьСобытия_();
        throw err;
    }
    // Волна 5 (аудит 14.10.2026, B-37): новый сервер присылает обновлённое приглашение (со «Свободно мест») —
    // правим список на месте, без перечитывания. Нет его (старый сервер) — сбрасываем и перечитываем, как раньше.
    const ev = result && result.event;
    if (ev && String(ev.groupId) === String(groupId) && Array.isArray(ev.slots) && Array.isArray(eventsCache) && eventsCache.some((g) => String(g.groupId) === String(groupId))) {
        const былоСДиска = eventsFromDisk_; // список с телефона: остальные приглашения ещё обновятся в фоне
        eventsEpoch++; // ответ, ушедший до записи, список не затрёт
        eventsPromise = null;
        принятьСобытия_(eventsCache.map((g) => (String(g.groupId) === String(groupId) ? ev : g)), eventsEpoch);
        eventsFromDisk_ = былоСДиска;
    } else {
        сброситьСобытия_(); // ответ студента меняет список — показываем свежий
    }
    return result;
}

/**
 * Волна 5 (аудит 14.10.2026, B-10): КОПИЯ С ТЕЛЕФОНА — ТОЛЬКО ТОГО АККАУНТА, КОТОРЫЙ ОТКРЫЛ.
 * До прихода SDK копия выбирается по id из данных запуска в адресе. Когда SDK загрузился,
 * сверяем: если он сообщил другой аккаунт, копию из памяти выбрасываем (ответы в пути — тоже,
 * через номера версий), экран очищается и рисуется заново уже по данным сервера.
 */
function сверитьАккаунт_() {
    if (!idКопии_) return;
    const app = window.Telegram && window.Telegram.WebApp;
    const u = app && app.initDataUnsafe && app.initDataUnsafe.user;
    if (!u || !u.id) return; // SDK не подтвердил аккаунт — сверять не с чем
    if (String(u.id) === String(idКопии_)) { idКопии_ = null; return; }
    idКопии_ = null;
    stateEpoch++; statePromise = null; stateCache = null; fromDisk_ = false;
    eventsEpoch++; eventsPromise = null; eventsCache = null; eventsFromDisk_ = false;
    window.dispatchEvent(new Event("account-changed"));
}
telegramReady().then(сверитьАккаунт_, () => {});
window.addEventListener("telegram-ready", сверитьАккаунт_);

/**
 * Волна 5 (аудит 14.10.2026, B-46): ВОЗВРАТ В ОТКРЫТОЕ ПРИЛОЖЕНИЕ. Что ломалось: студент получил
 * в чате «Платёж получен», вернулся в уже открытый Mini App — и видел старый статус, пока не
 * перейдёт на другой экран после 5 минут или не переоткроет приложение.
 * Теперь, если приложение было скрыто дольше минуты, данные тихо перечитываются тем же фоновым
 * путём, что и при открытии из памяти телефона: один запрос на всех (идущий не дублируется),
 * ответ, прочитанный до действия студента, не затирает его (номера версий), экран
 * перерисовывается без затемнения и только если данные изменились.
 */
const ПЕРЕЧИТАТЬ_ПОСЛЕ_СКРЫТИЯ_МС = 60 * 1000;
let скрытоС_ = 0;
document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (!скрытоС_) скрытоС_ = Date.now(); return; }
    const было = скрытоС_;
    скрытоС_ = 0;
    if (!было || Date.now() - было <= ПЕРЕЧИТАТЬ_ПОСЛЕ_СКРЫТИЯ_МС) return;
    if (stateCache) обновитьВФоне_();
    обновитьСобытияВФоне_();
});
