/**
 * Thin helpers over a Google Sheet used as the "DB" (see Setup.gs ->
 * createSheetsIfMissing() for the exact tabs/headers this expects).
 * Rows are read/written as plain objects keyed by header name, so column
 * order in the sheet doesn't matter — only the header text does.
 *
 * Performance note: SpreadsheetApp.openById() and getSheetByName() are real
 * round-trips, not free in-memory lookups. A single "state" request
 * (stateForUser_) touches ~6 different sheet tabs, so without caching it
 * was calling openById() over and over — the #1 cause of slow screen
 * transitions in the Mini App. Both the Spreadsheet handle and each Sheet
 * handle are cached here; they stay valid for the life of the script (they
 * don't go stale — writes go straight through to the live sheet), so this
 * is safe to keep warm across requests, not just within one.
 *
 * A second cache below (rowsCache_) holds each sheet's DATA for the
 * duration of one execution — e.g. the amoCRM webhook handler used to call
 * getRows("Payments") up to 6 times and getRows("Documents") up to 5 times
 * while syncing one deal. Every write (appendRow/updateRow) invalidates
 * that sheet's cached rows so nothing ever reads stale data back within the
 * same request.
 */

let ss_cache_ = null;
function ss_() {
  if (!ss_cache_) ss_cache_ = SpreadsheetApp.openById(CFG("SHEET_ID"));
  return ss_cache_;
}

const sheetHandleCache_ = {};
function sheet_(name) {
  if (!sheetHandleCache_[name]) {
    const sh = ss_().getSheetByName(name);
    if (!sh) throw new Error("Sheet tab not found: " + name + " — run createSheetsIfMissing() first.");
    sheetHandleCache_[name] = sh;
  }
  return sheetHandleCache_[name];
}

// Headers almost never change during normal request handling (only
// createSheetsIfMissing() in Setup.gs rewrites row 1, and that's a manual
// one-off tool, not called from the Web App). Before this cache,
// appendRow/updateRow each re-fetched the header row with its own live
// Sheets API call on every single write -- e.g. onboarding one new
// participant did 14 appendRow calls, each paying for its own extra header
// read on top of the actual write. Cached per sheet name for the life of
// the script, same lifetime as sheetHandleCache_ above.
const headersCache_ = {};
function headers_(sh) {
  const name = sh.getName();
  if (!(name in headersCache_)) {
    const lastCol = sh.getLastColumn();
    headersCache_[name] = lastCol === 0 ? [] : sh.getRange(1, 1, 1, lastCol).getValues()[0];
  }
  return headersCache_[name];
}

const rowsCache_ = {};

/** Reads headers + data in a single getRange call and caches the result for
 * the rest of this execution. Returns a shallow copy each time so a caller
 * mutating one field on a row it got back can never corrupt the cache. */
function getRows(sheetName) {
  if (!(sheetName in rowsCache_)) {
    const sh = sheet_(sheetName);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      rowsCache_[sheetName] = [];
    } else {
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
      const heads = values[0];
      rowsCache_[sheetName] = values.slice(1).map((row, i) => {
        const obj = { _row: i + 2 };
        heads.forEach((h, j) => (obj[h] = row[j]));
        return obj;
      });
    }
  }
  return rowsCache_[sheetName].map((row) => Object.assign({}, row));
}

function invalidateRowsCache_(sheetName) {
  delete rowsCache_[sheetName];
}

/** First row where `keyColumn` === keyValue, or null. */
function findRow(sheetName, keyColumn, keyValue) {
  const rows = getRows(sheetName);
  return rows.find((r) => String(r[keyColumn]) === String(keyValue)) || null;
}

function findRows(sheetName, keyColumn, keyValue) {
  return getRows(sheetName).filter((r) => String(r[keyColumn]) === String(keyValue));
}

/** Appends a new row; `data` keys must match existing headers (extra keys ignored). */
function appendRow(sheetName, data) {
  const sh = sheet_(sheetName);
  const heads = headers_(sh);
  const row = heads.map((h) => (h in data ? data[h] : ""));
  sh.appendRow(row);
  invalidateRowsCache_(sheetName);
}

/** Updates an existing row (found via _row from getRows/findRow) with the given fields. */
function updateRow(sheetName, rowNumber, data) {
  const sh = sheet_(sheetName);
  const heads = headers_(sh);
  heads.forEach((h, j) => {
    if (h in data) sh.getRange(rowNumber, j + 1).setValue(data[h]);
  });
  invalidateRowsCache_(sheetName);
}

/** Insert-or-update by key column — the common case (e.g. one row per telegram_id). */
function upsertRow(sheetName, keyColumn, keyValue, data) {
  const existing = findRow(sheetName, keyColumn, keyValue);
  const payload = Object.assign({}, data, { [keyColumn]: keyValue });
  if (existing) {
    updateRow(sheetName, existing._row, payload);
  } else {
    appendRow(sheetName, payload);
  }
}

/**
 * Google Sheets silently turns a plain date/time-looking string into a real
 * Date value once it's written to a cell (appendRow/updateRow behave the
 * same as a human typing it in). Reading that cell back then hands the app
 * a JS Date instead of the plain text callers actually want to send to the
 * frontend: a TIME-only value comes back anchored to the Sheets time epoch
 * (1899-12-30), and a DATE-only value can silently shift a calendar day once
 * JSON.stringify converts it to a UTC ISO timestamp — a coordinator typing
 * "2026-11-11" while the sheet's timezone is GMT+5 becomes, once serialized,
 * "2026-11-10T19:00:00.000Z", which the frontend would read back as Nov 10,
 * not Nov 11. Both helpers force an explicit plain format in the same GMT+5
 * zone used everywhere else in this backend, so neither failure mode can
 * leak through. Call these on any sheet value before it goes into a
 * jsonOutput_() response; an already-plain string (never round-tripped
 * through a cell, e.g. one written by our own code this same run) passes
 * through unchanged. */
function formatSheetDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "GMT+5", "yyyy-MM-dd");
  }
  return String(value || "");
}
function formatSheetTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "GMT+5", "HH:mm");
  }
  return String(value || "");
}

function logEvent(telegramId, source, event, oldValue, newValue) {
  appendRow("EventLog", {
    timestamp: new Date(),
    telegram_id: telegramId,
    source: source,
    event: event,
    old_value: oldValue,
    new_value: newValue,
  });
}
