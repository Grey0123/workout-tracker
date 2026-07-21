/* =========================================================================
   WorkoutTracker — shared logic for index.html (member) and coach.html
   ========================================================================= */

/* CONFIG — paste your Apps Script Web App URL here after deploying. */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwcekQ2kAV3ApQu9jbcN60D7k2mXDmhCh-QAhNcR8hX4Lhbq3GcH3tjB4CtMAryI_6kMw/exec";

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MEAL_SLOTS = ["morning", "afternoon", "evening"];

/* =========================================================================
   DATE HANDLING
   Everything downstream assumes a day key of exactly yyyy-mm-dd.

   Sheets is the problem: a cell holding 2026-07-20 may come back as a Date
   object, an ISO timestamp, "20/07/2026", or "Mon Jul 20 2026 ...". Feeding
   any of those into `new Date(k + "T00:00:00")` gives an Invalid Date, and
   .getDate() on that renders literally as "NaN".

   toKey() normalises every shape into yyyy-mm-dd, or "" if unreadable.
   Nothing else in the app parses raw date input.
   ========================================================================= */
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());

function toKey(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : keyOf(v);

  const s = String(v).trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;

  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);   // dd/mm/yyyy, en-GB
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;

  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : keyOf(d);
}

function dateOf(key) {
  const k = toKey(key);
  if (!k) return null;
  const [y, mo, da] = k.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  return isNaN(d.getTime()) ? null : d;
}

/* Every date shown to the user goes through one of these; each falls back to
   a dash rather than leaking "NaN" or "Invalid Date" into the UI. */
function niceDate(key, opts) {
  const d = dateOf(key);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", opts || { weekday: "long", day: "numeric", month: "long" });
}
const shortDate = (k) => { const d = dateOf(k); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"; };
const dayNum   = (k) => { const d = dateOf(k); return d ? d.getDate() : "—"; };
const dowShort = (k) => { const d = dateOf(k); return d ? d.toLocaleDateString("en-GB", { weekday: "short" }) : ""; };
const monShort = (k) => { const d = dateOf(k); return d ? d.toLocaleDateString("en-GB", { month: "short" }) : ""; };

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const fmtKg = (v) => Number.isFinite(v) ? (Math.round(v * 10) / 10).toLocaleString() : "0";

/* =========================================================================
   SETS
   A workout row carries setList: [{w, r}, ...] — weight and reps per set.
   Rows written before per-set logging existed have no detail, so the backend
   synthesises a flat list from the old Weight/Reps/Sets columns. Either way
   the client always sees a setList.
   ========================================================================= */

/** Normalise whatever came back from the sheet into a clean [{w,r}] array. */
function normaliseSets(row) {
  let list = Array.isArray(row.setList) ? row.setList : [];
  list = list
    .map(s => ({ w: num(s && s.w), r: int(s && s.r) }))
    .filter(s => s.w > 0 || s.r > 0);
  if (!list.length) {
    // Last-resort fallback: rebuild from the summary columns.
    const n = Math.max(1, int(row.sets));
    const w = num(row.weight), r = int(row.reps);
    if (w > 0 || r > 0) list = Array.from({ length: n }, () => ({ w, r }));
  }
  return list;
}

/** Wire format for POST: "60x12;65x10;70x8" */
const setsToRaw = (list) => list.map(s => `${s.w}x${s.r}`).join(";");

/** Collapsed label: "3 × 12" — set count by the first set's reps. */
function setsSummary(list) {
  if (!list.length) return "";
  const reps = list[0].r;
  const sameReps = list.every(s => s.r === reps);
  return `${list.length} × ${sameReps ? reps : "…"}`;
}

/** Weight range across the sets, for the collapsed row. */
function weightSummary(list) {
  const ws = list.map(s => s.w).filter(w => w > 0);
  if (!ws.length) return "";
  const lo = Math.min(...ws), hi = Math.max(...ws);
  return lo === hi ? `${fmtKg(lo)} kg` : `${fmtKg(lo)}–${fmtKg(hi)} kg`;
}

const setsVolume = (list) => list.reduce((s, x) => s + x.w * x.r, 0);
const topWeight  = (list) => list.reduce((m, x) => Math.max(m, x.w), 0);

/* ---------- shared state ---------- */
let WORKOUTS = [];
let MEALS = [];
let BY_DATE = {};
let MEALS_BY_DATE = {};
let selectedDay = todayKey();
let calCursor = new Date();

const setsOf   = (rows) => rows.reduce((s, r) => s + normaliseSets(r).length, 0);
const volumeOf = (rows) => rows.reduce((s, r) => s + setsVolume(normaliseSets(r)), 0);

function rebuildIndex() {
  BY_DATE = {};
  let dropped = 0;
  for (const r of WORKOUTS) {
    const k = toKey(r.date);
    if (!k) { dropped++; continue; }
    r.date = k;
    r.setList = normaliseSets(r);
    (BY_DATE[k] = BY_DATE[k] || []).push(r);
  }

  MEALS_BY_DATE = {};
  for (const m of MEALS) {
    const k = toKey(m.date);
    if (!k) { dropped++; continue; }
    m.date = k;
    const slot = MEAL_SLOTS.includes(String(m.slot).toLowerCase())
      ? String(m.slot).toLowerCase() : "morning";
    m.slot = slot;
    MEALS_BY_DATE[k] = MEALS_BY_DATE[k] || {};
    MEALS_BY_DATE[k][slot] = m;
  }

  if (dropped) console.warn(`WorkoutTracker: skipped ${dropped} row(s) with an unreadable date.`);
}

const workoutsOn = (k) => BY_DATE[k] || [];
const mealsOn    = (k) => MEALS_BY_DATE[k] || {};
const mealCount  = (k) => Object.values(mealsOn(k)).filter(m => m && (m.food || m.photoUrl)).length;
const trainedDays = () => Object.keys(BY_DATE).filter(k => BY_DATE[k].length).sort();

/* ---------- toast ---------- */
function toast(msg, kind = "ok", ms = 3200) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="tick">${kind === "err" ? "!" : "✓"}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------- header ---------- */
function initHeader() {
  const head = document.querySelector(".site-head");
  if (!head) return;
  let ticking = false;
  const apply = () => {
    ticking = false;
    const y = window.scrollY;
    // Two thresholds so the reflow from collapsing can't flicker.
    if (y > 80) head.classList.add("scrolled");
    else if (y < 30) head.classList.remove("scrolled");
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(apply); }
  }, { passive: true });
}

const isMobile = () => window.matchMedia("(max-width:640px)").matches;

function showView(name, views) {
  for (const v of views) {
    const sec = $("view-" + v), tab = $("tab-" + v);
    if (sec) sec.classList.toggle("active", v === name);
    if (tab) tab.classList.toggle("active", v === name);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

/* =========================================================================
   CALENDAR
   Each cell carries stripes: a blue workout stripe and an amber meal stripe,
   so a trained day reads at a glance without opening it. Trained days also
   get a tinted cell and a left accent bar — the "went to the gym" signal.
   ========================================================================= */
function renderCalendarInto(gridId, monthId, onPick) {
  const grid = $(gridId);
  if (!grid) return;
  $(monthId).textContent = `${MONTHS[calCursor.getMonth()]} ${calCursor.getFullYear()}`;

  grid.innerHTML = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    .map(d => `<div class="dow">${d}</div>`).join("");

  const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));   // Monday-first

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = keyOf(d);
    const rows = workoutsOn(k);
    const meals = mealCount(k);
    const trained = rows.length > 0;

    const btn = document.createElement("button");
    btn.className = "day"
      + (d.getMonth() !== calCursor.getMonth() ? " other" : "")
      + (k === todayKey() ? " today" : "")
      + (k === selectedDay ? " selected" : "")
      + (trained ? " trained" : "");

    const stripes = [];
    if (trained) {
      const sets = setsOf(rows);
      stripes.push(`<span class="stripe work" title="${rows.length} exercises, ${sets} sets">
        <span class="s-ico" aria-hidden="true">🏋</span><span class="s-txt">${sets}</span></span>`);
    }
    if (meals) {
      stripes.push(`<span class="stripe food" title="${meals} meals logged">
        <span class="s-ico" aria-hidden="true">🍽</span><span class="s-txt">${meals}</span></span>`);
    }

    btn.innerHTML =
      `<span class="dnum">${d.getDate()}</span>
       <span class="stripes">${stripes.join("")}</span>`;

    const bits = [];
    if (rows.length) bits.push(`${rows.length} exercise${rows.length > 1 ? "s" : ""}`);
    if (meals) bits.push(`${meals} meal${meals > 1 ? "s" : ""}`);
    btn.setAttribute("aria-label", niceDate(k) + (bits.length ? `, ${bits.join(", ")}` : ", nothing logged"));

    btn.addEventListener("click", () => onPick(k));
    grid.appendChild(btn);
  }
}

function calShift(n, rerender) {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + n, 1);
  rerender();
}
function calToday(rerender) {
  const now = new Date();
  calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedDay = todayKey();
  rerender();
}

/* =========================================================================
   ACTIVITY MARKUP
   Collapsed row shows the summary ("3 × 12", weight range). Expanding it
   reveals the per-set breakdown. `actions` adds Edit/Delete for the member
   page; the coach page passes false and gets a read-only list.
   ========================================================================= */
function activitiesHtml(rows, actions) {
  if (!rows.length) {
    return `<div class="no-entries">No workout logged for this day.</div>`;
  }
  return rows.map((r, i) => {
    const list = normaliseSets(r);
    const uid = `act-${esc(r.id || i)}`;
    const perSet = list.map((s, n) => `
      <div class="set-row">
        <span class="set-n">Set ${n + 1}</span>
        <span class="set-w">${s.w ? fmtKg(s.w) + " kg" : "—"}</span>
        <span class="set-r">${s.r ? s.r + " reps" : "—"}</span>
      </div>`).join("");

    return `<div class="activity" id="${uid}">
      <button class="act-head" onclick="toggleActivity('${uid}')" aria-expanded="false">
        <span class="act-main">
          <span class="act-name">${esc(r.exercise)}${r.variant ? `<span class="variant"> · ${esc(r.variant)}</span>` : ""}</span>
          ${r.notes ? `<span class="act-note">${esc(r.notes)}</span>` : ""}
        </span>
        <span class="act-figs">
          <b>${esc(setsSummary(list))}</b>
          <small>${esc(weightSummary(list))}</small>
        </span>
        <span class="act-caret" aria-hidden="true">⌄</span>
      </button>
      <div class="act-body" hidden>
        <div class="set-table">${perSet || `<div class="no-entries">No set detail.</div>`}</div>
        <div class="act-meta">Volume ${Math.round(setsVolume(list)).toLocaleString()} kg · top set ${fmtKg(topWeight(list))} kg</div>
        ${actions ? `<div class="act-actions">
          <button class="btn ghost sm" onclick="editActivity('${esc(r.id)}')">Edit</button>
          <button class="btn ghost sm danger" onclick="deleteActivity('${esc(r.id)}')">Delete</button>
        </div>` : ""}
      </div>
    </div>`;
  }).join("");
}

function toggleActivity(uid) {
  const el = $(uid);
  if (!el) return;
  const body = el.querySelector(".act-body");
  const head = el.querySelector(".act-head");
  const open = !body.hidden;
  body.hidden = open;
  el.classList.toggle("open", !open);
  head.setAttribute("aria-expanded", String(!open));
}

function mealsHtml(dayKey, actions) {
  const m = mealsOn(dayKey);
  return MEAL_SLOTS.map(slot => {
    const e = m[slot];
    const has = e && (e.food || e.photoUrl);
    const body = has
      ? `${esc(e.food || "")}${e.notes ? `<span class="note"> — ${esc(e.notes)}</span>` : ""}
         ${e.photoUrl ? photoHtml(e.photoUrl) : ""}`
      : `<span class="empty">not logged</span>`;
    return `<div class="meal-slot">
      <span class="slot-tag">${slot}</span>
      <span class="slot-body">${body}</span>
      ${actions ? `<button class="btn ghost sm" onclick="editMeal('${slot}')">${has ? "Edit" : "Add"}</button>` : ""}
    </div>`;
  }).join("");
}

/* Drive share links can't be used as <img src> directly; the thumbnail
   endpoint can. Fall back to a plain link for non-Drive URLs. */
function photoHtml(url) {
  const id = driveFileId(url);
  if (id) {
    return `<a href="${esc(url)}" target="_blank" rel="noopener">
      <img class="meal-photo" loading="lazy" alt="Meal photo"
           src="https://drive.google.com/thumbnail?id=${esc(id)}&sz=w400">
    </a>`;
  }
  return `<a class="meal-photo-link" href="${esc(url)}" target="_blank" rel="noopener">View photo ↗</a>`;
}
function driveFileId(url) {
  const s = String(url || "");
  let m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : "";
}

/* ---------- chart ---------- */
function lineChart(pts) {
  if (!pts.length) return `<div class="pg-empty">No sessions for this exercise yet.</div>`;

  /* The SVG scales to its container, so a wide viewBox on a phone shrinks the
     axis text to nothing. Narrower box on small screens. */
  const narrow = isMobile();
  const W = narrow ? 380 : 920;
  const H = narrow ? 260 : 300;
  const P = narrow ? { l: 40, r: 10, t: 14, b: 34 } : { l: 56, r: 18, t: 16, b: 40 };
  const FS = narrow ? 13 : 11;
  const MAX_XLABELS = narrow ? 4 : 6;

  const vs = pts.map(p => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { min = Math.max(0, min - 5); max += 5; }
  const span = max - min;
  min = Math.max(0, min - span * 0.08);
  max += span * 0.08;

  const X = (i) => pts.length === 1
    ? P.l + (W - P.l - P.r) / 2
    : P.l + (W - P.l - P.r) * i / (pts.length - 1);
  const Y = (v) => H - P.b - (H - P.t - P.b) * (v - min) / (max - min);
  const clampX = (x) => Math.min(W - P.r, Math.max(P.l, x));

  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const v = min + (max - min) * g / 4;
    const y = Y(v);
    grid += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="var(--line-soft)" stroke-width="1"/>
      <text x="${P.l - 8}" y="${y + 4}" text-anchor="end" font-size="${FS}" fill="var(--muted)">${fmtKg(v)}</text>`;
  }

  let xlabels = "";
  const step = Math.max(1, Math.ceil(pts.length / MAX_XLABELS));
  for (let i = 0; i < pts.length; i += step) {
    xlabels += `<text x="${clampX(X(i))}" y="${H - P.b + 20}" text-anchor="middle" font-size="${FS}" fill="var(--muted)">${shortDate(pts[i].d)}</text>`;
  }
  if ((pts.length - 1) % step !== 0) {
    xlabels += `<text x="${clampX(X(pts.length - 1))}" y="${H - P.b + 20}" text-anchor="middle" font-size="${FS}" fill="var(--muted)">${shortDate(pts[pts.length - 1].d)}</text>`;
  }

  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const maxV = Math.max(...vs);
  const dots = pts.map((p, i) => {
    const isPR = p.v === maxV;
    return `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${isPR ? 5 : 3.5}"
      fill="${isPR ? "var(--blue)" : "var(--surface)"}" stroke="var(--blue)" stroke-width="2">
      <title>${shortDate(p.d)} — ${fmtKg(p.v)} kg</title></circle>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Progress chart">
    ${grid}
    <path d="${path}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xlabels}
  </svg>`;
}

function exerciseNames() {
  const count = {};
  for (const r of WORKOUTS) {
    const n = String(r.exercise || "").trim();
    if (n) count[n] = (count[n] || 0) + 1;
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b));
}

/* ---------- data ---------- */
const isConfigured = () => !String(APPS_SCRIPT_URL).startsWith("PASTE_");

function setupWarning(slotId, msg) {
  const slot = $(slotId);
  if (slot) slot.innerHTML = `<div class="setup-warn">${msg}</div>`;
}

function absorb(data) {
  WORKOUTS = Array.isArray(data.workouts) ? data.workouts
           : Array.isArray(data.rows) ? data.rows : [];      // v1 payload
  MEALS = Array.isArray(data.meals) ? data.meals : [];
}

async function loadData(slotId, onDone) {
  if (!isConfigured()) {
    setupWarning(slotId, `<b>Setup needed:</b> deploy the Apps Script from <code>Code.gs</code>
      and paste its Web App URL into <code>APPS_SCRIPT_URL</code> in <code>app.js</code>.
      Full steps in <code>README.md</code>.`);
    onDone();
    return;
  }
  try {
    const res = await fetch(APPS_SCRIPT_URL, { cache: "no-store" });
    absorb(await res.json());
    onDone();
  } catch (err) {
    setupWarning(slotId, `Could not load data from Google Sheets. Check the Web App is
      deployed with access set to <b>“Anyone”</b> and that the URL in <code>app.js</code> is correct.`);
    onDone();
  }
}

/* Apps Script web apps don't return readable CORS responses to a browser, so
   we fire in no-cors mode and confirm by re-reading the sheet. */
async function postForm(fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.append(k, v ?? "");
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
}

async function refetch() {
  const res = await fetch(APPS_SCRIPT_URL, { cache: "no-store" });
  absorb(await res.json());
  rebuildIndex();
}
