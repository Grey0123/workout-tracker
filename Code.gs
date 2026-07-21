/**
 * WorkoutTracker backend — Google Apps Script bound to a Google Sheet.
 *
 * Sheets (created automatically on first use):
 *   Log   | Id | Timestamp | Date | Exercise | Variant | Weight | Reps | Sets | Notes | SetsJson
 *   Meals | Id | Timestamp | Date | Slot | Food | Notes | PhotoUrl
 *
 * SetsJson holds the per-set detail: [{"w":60,"r":12},{"w":65,"r":10}]
 * Weight / Reps / Sets remain as summary columns — top weight, first-set reps,
 * and set count — so the sheet stays readable and rows written by the old
 * version keep working.
 *
 * Meal photos go to a Drive folder and the shareable link is stored in PhotoUrl.
 *
 * Deploy as Web App:  Execute as: Me  |  Who has access: Anyone
 *
 * After pasting this in, run `migrateSheets()` once from the editor. It adds
 * the new columns to existing sheets and backfills ids + set detail.
 */

const LOG_SHEET    = "Log";
const MEAL_SHEET   = "Meals";
const PHOTO_FOLDER = "WorkoutTracker Meal Photos";

const LOG_HEADERS  = ["Id", "Timestamp", "Date", "Exercise", "Variant", "Weight", "Reps", "Sets", "Notes", "SetsJson"];
const MEAL_HEADERS = ["Id", "Timestamp", "Date", "Slot", "Food", "Notes", "PhotoUrl"];
const SLOTS = ["morning", "afternoon", "evening"];

/* ------------------------------------------------------------------ sheets */

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Force the Date column to plain text. Without this, Sheets reinterprets
  // "2026-07-20" as a date value and hands it back in the spreadsheet locale
  // (e.g. 20/07/2026), which is what produced NaN dates in the UI.
  const dateCol = headers.indexOf("Date") + 1;
  sheet.getRange(2, dateCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
  return sheet;
}

const logSheet_  = () => getSheet_(LOG_SHEET, LOG_HEADERS);
const mealSheet_ = () => getSheet_(MEAL_SHEET, MEAL_HEADERS);

function newId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

/* ------------------------------------------------------------------- dates */

/** Normalise anything to yyyy-mm-dd, or "" if unreadable. Mirrors toKey() in app.js. */
function toISODate_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(v).trim();
  if (!s) return "";

  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + pad_(m[2]) + "-" + pad_(m[3]);

  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);   // dd/mm/yyyy
  if (m) return m[3] + "-" + pad_(m[2]) + "-" + pad_(m[1]);

  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
function pad_(n) { return ("0" + String(parseInt(n, 10))).slice(-2); }

/* -------------------------------------------------------------------- sets */

/**
 * Parse the per-set payload the client sends: "60x12;65x10;70x8".
 * Falls back to an empty array; callers then synthesise from the summary.
 */
function parseSets_(raw) {
  const out = [];
  String(raw || "").split(";").forEach(function (chunk) {
    const t = chunk.trim();
    if (!t) return;
    const m = t.match(/^(-?[\d.]*)\s*[xX*]\s*(\d*)$/);
    if (!m) return;
    const w = parseFloat(m[1]);
    const r = parseInt(m[2], 10);
    out.push({ w: isNaN(w) ? 0 : w, r: isNaN(r) ? 0 : r });
  });
  return out;
}

/** Rebuild a sets array from a legacy row that only has summary columns. */
function setsFromSummary_(weight, reps, sets) {
  const w = parseFloat(weight); const r = parseInt(reps, 10); const n = parseInt(sets, 10);
  const count = isNaN(n) || n < 1 ? 1 : n;
  const out = [];
  for (var i = 0; i < count; i++) {
    out.push({ w: isNaN(w) ? 0 : w, r: isNaN(r) ? 0 : r });
  }
  return out;
}

function summarise_(sets) {
  var top = 0, reps = 0;
  for (var i = 0; i < sets.length; i++) {
    if (sets[i].w > top) top = sets[i].w;
    if (i === 0) reps = sets[i].r;
  }
  return { weight: top ? String(top) : "", reps: reps ? String(reps) : "", sets: String(sets.length) };
}

/* --------------------------------------------------------------------- GET */

function doGet(e) {
  const out = { workouts: readWorkouts_(), meals: readMeals_() };
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function readWorkouts_() {
  const sheet = logSheet_();
  const last = sheet.getLastRow();
  if (last <= 1) return [];
  const values = sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
  const rows = [];
  for (var i = 0; i < values.length; i++) {
    const v = values[i];
    const date = toISODate_(v[2]);
    if (!date) continue;                       // skip unreadable rows entirely

    var sets = [];
    if (v[9]) {
      try { sets = JSON.parse(v[9]) || []; } catch (err) { sets = []; }
    }
    if (!sets.length) sets = setsFromSummary_(v[5], v[6], v[7]);

    rows.push({
      id: String(v[0] || ""),
      timestamp: String(v[1]),
      date: date,
      exercise: String(v[3]),
      variant: String(v[4]),
      weight: String(v[5]),
      reps: String(v[6]),
      sets: String(v[7]),
      notes: String(v[8]),
      setList: sets
    });
  }
  return rows;
}

function readMeals_() {
  const sheet = mealSheet_();
  const last = sheet.getLastRow();
  if (last <= 1) return [];
  const values = sheet.getRange(2, 1, last - 1, MEAL_HEADERS.length).getValues();
  const rows = [];
  for (var i = 0; i < values.length; i++) {
    const v = values[i];
    const date = toISODate_(v[2]);
    if (!date) continue;
    var slot = String(v[3] || "").toLowerCase().trim();
    if (SLOTS.indexOf(slot) === -1) slot = "morning";
    rows.push({
      id: String(v[0] || ""),
      timestamp: String(v[1]),
      date: date,
      slot: slot,
      food: String(v[4]),
      notes: String(v[5]),
      photoUrl: String(v[6])
    });
  }
  return rows;
}

/* -------------------------------------------------------------------- POST */

/**
 * POST (form-encoded), dispatched on `action`:
 *   workout        -> date, exercise, variant, setsRaw, notes
 *   workoutUpdate  -> id + the same fields
 *   workoutDelete  -> id
 *   meal           -> date, slot, food, notes, photoData, photoName
 *   mealDelete     -> id
 */
function doPost(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || "workout").toLowerCase();
  try {
    if (action === "meal")          return saveMeal_(p);
    if (action === "mealdelete")    return deleteRow_(mealSheet_(), p.id);
    if (action === "workoutupdate") return saveWorkout_(p, true);
    if (action === "workoutdelete") return deleteRow_(logSheet_(), p.id);
    return saveWorkout_(p, false);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function saveWorkout_(p, isUpdate) {
  const date = toISODate_(p.date);
  if (!date || !p.exercise) return json_({ ok: false, error: "date and exercise are required" });

  var sets = parseSets_(p.setsRaw);
  if (!sets.length) sets = setsFromSummary_(p.weight, p.reps, p.sets);
  const sum = summarise_(sets);

  const sheet = logSheet_();
  const id = isUpdate && p.id ? String(p.id) : newId_();
  const values = [
    id,
    new Date(),
    date,                                    // always yyyy-mm-dd text
    String(p.exercise).slice(0, 100),
    String(p.variant || "").slice(0, 100),
    sum.weight,
    sum.reps,
    sum.sets,
    String(p.notes || "").slice(0, 500),
    JSON.stringify(sets).slice(0, 4000)
  ];

  if (isUpdate) {
    const row = findRowById_(sheet, id);
    if (row < 0) return json_({ ok: false, error: "row not found" });
    sheet.getRange(row, 1, 1, LOG_HEADERS.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return json_({ ok: true, id: id });
}

function saveMeal_(p) {
  const date = toISODate_(p.date);
  var slot = String(p.slot || "").toLowerCase().trim();
  if (SLOTS.indexOf(slot) === -1) slot = "morning";
  if (!date) return json_({ ok: false, error: "date is required" });
  if (!p.food && !p.photoData) return json_({ ok: false, error: "food or a photo is required" });

  var photoUrl = String(p.photoUrl || "");
  if (p.photoData) photoUrl = savePhoto_(p.photoData, p.photoName, date, slot);

  const sheet = mealSheet_();
  const rowIndex = findMealRow_(sheet, date, slot);

  // One entry per slot per day — re-logging breakfast replaces it rather than
  // stacking a second row the UI would have to reconcile.
  const id = rowIndex > 0 ? String(sheet.getRange(rowIndex, 1).getValue() || newId_()) : newId_();
  const values = [
    id,
    new Date(),
    date,
    slot,
    String(p.food || "").slice(0, 300),
    String(p.notes || "").slice(0, 500),
    photoUrl
  ];

  if (rowIndex > 0) {
    // Keep the existing photo if this save didn't include a new one.
    if (!photoUrl) values[6] = String(sheet.getRange(rowIndex, 7).getValue() || "");
    sheet.getRange(rowIndex, 1, 1, MEAL_HEADERS.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return json_({ ok: true, id: id, photoUrl: values[6] });
}

function deleteRow_(sheet, id) {
  if (!id) return json_({ ok: false, error: "id required" });
  const row = findRowById_(sheet, String(id));
  if (row < 0) return json_({ ok: false, error: "row not found" });
  sheet.deleteRow(row);
  return json_({ ok: true });
}

function findRowById_(sheet, id) {
  const last = sheet.getLastRow();
  if (last <= 1) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function findMealRow_(sheet, date, slot) {
  const last = sheet.getLastRow();
  if (last <= 1) return -1;
  const values = sheet.getRange(2, 3, last - 1, 2).getValues();   // Date, Slot
  for (var i = 0; i < values.length; i++) {
    if (toISODate_(values[i][0]) === date &&
        String(values[i][1]).toLowerCase().trim() === slot) {
      return i + 2;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ photos */

function savePhoto_(dataUrl, name, date, slot) {
  const s = String(dataUrl);
  const comma = s.indexOf(",");
  const meta = comma > -1 ? s.substring(0, comma) : "";
  const b64  = comma > -1 ? s.substring(comma + 1) : s;

  var mime = "image/jpeg";
  const mm = meta.match(/data:([^;]+);/);
  if (mm) mime = mm[1];

  const bytes = Utilities.base64Decode(b64);
  const filename = (date + "-" + slot + "-" + (name || "meal")).slice(0, 120);
  const blob = Utilities.newBlob(bytes, mime, filename);

  const file = getPhotoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getPhotoFolder_() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(PHOTO_FOLDER);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------------------------------------------- migration */

/**
 * Run ONCE from the editor after pasting this file in.
 *
 * Handles sheets written by the older versions:
 *   - inserts the Id and SetsJson columns if they're missing
 *   - gives every existing row an id
 *   - backfills SetsJson from the old Weight/Reps/Sets columns
 *   - rewrites the Date column as yyyy-mm-dd text
 *
 * Safe to run more than once.
 */
function migrateSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  migrateOne_(ss.getSheetByName(LOG_SHEET),  LOG_HEADERS);
  migrateOne_(ss.getSheetByName(MEAL_SHEET), MEAL_HEADERS);

  // Backfill ids and set detail on the Log sheet.
  const log = logSheet_();
  const last = log.getLastRow();
  if (last > 1) {
    const range = log.getRange(2, 1, last - 1, LOG_HEADERS.length);
    const rows = range.getValues();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i][0]) rows[i][0] = newId_();
      rows[i][2] = toISODate_(rows[i][2]);
      if (!rows[i][9]) {
        rows[i][9] = JSON.stringify(setsFromSummary_(rows[i][5], rows[i][6], rows[i][7]));
      }
    }
    range.setValues(rows);
  }

  // Backfill ids on the Meals sheet.
  const meals = mealSheet_();
  const mlast = meals.getLastRow();
  if (mlast > 1) {
    const mrange = meals.getRange(2, 1, mlast - 1, MEAL_HEADERS.length);
    const mrows = mrange.getValues();
    for (var j = 0; j < mrows.length; j++) {
      if (!mrows[j][0]) mrows[j][0] = newId_();
      mrows[j][2] = toISODate_(mrows[j][2]);
    }
    mrange.setValues(mrows);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Migration complete.", "WorkoutTracker", 5);
}

/**
 * Bring one sheet up to the current header set. Old layouts had no Id column
 * (so everything is shifted one to the left) and no SetsJson column.
 */
function migrateOne_(sheet, headers) {
  if (!sheet) return;                       // sheet doesn't exist yet — nothing to do
  if (sheet.getLastRow() === 0) return;

  const width = sheet.getLastColumn();
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);

  // Old layout started with "Timestamp"; the new one starts with "Id".
  if (current[0] !== "Id") {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue("Id");
  }

  // Append any headers still missing (e.g. SetsJson).
  const now = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  for (var i = 0; i < headers.length; i++) {
    if (now.indexOf(headers[i]) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(headers[i]);
    }
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}
