# WorkoutTracker

A workout and food log with two views, backed by a Google Sheet. The site is
static (free on GitHub Pages); every entry is saved through a small Apps Script
web app.

| File | What it is |
|---|---|
| `index.html` | **Your side.** Calendar-first: tap a day to log workouts (weight and reps per set), log meals with photos, edit or delete anything. Plus dashboard and progress charts. |
| `coach.html` | **Coach / PT side.** Read-only. Dashboard, day cards, workout history with a date filter, calendar. Cannot edit or add anything. |
| `styles.css` | Shared stylesheet. |
| `app.js` | Shared logic — date handling, data loading, calendar, chart. **Your Web App URL goes here.** |
| `Code.gs` | The Apps Script backend. Paste into your Sheet's script editor. |

Both pages are mobile-first — they're built to be used from a phone browser.

---

## Part 1 — Google Sheet backend (~5 minutes)

1. Go to [sheets.new](https://sheets.new) and create a blank spreadsheet. Name it
   e.g. **WorkoutTracker Data**.
2. **Extensions → Apps Script**.
3. Delete the placeholder code, paste in the full contents of `Code.gs`, save (Ctrl+S).
4. **Deploy → New deployment**.
   - Gear icon next to "Select type" → **Web app**
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` ← required, or the site can't reach it
   - **Deploy**, then authorise. It will warn that the app is unverified —
     *Advanced → Go to project*. It's your own script.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/AKfy.../exec`).

The script creates two tabs on first use: `Log` (workouts) and `Meals` (food).

### If you already have data — run the migration

Per-set logging and editing added two columns (`Id` and `SetsJson`). After
pasting the new `Code.gs` in, pick **`migrateSheets`** from the function
dropdown in the Apps Script editor and click **Run**, once. It:

- inserts the `Id` column and gives every existing row one (needed for edit/delete)
- backfills `SetsJson` from your old Weight/Reps/Sets columns
- rewrites the Date column as `yyyy-mm-dd` text

It's safe to run more than once. Old rows keep working either way — they just
show every set at the same weight until you edit them.

### About the Drive permission

Meal photos are uploaded to a Drive folder called **WorkoutTracker Meal Photos**,
created automatically on the first upload. Because of this the script now asks
for Drive access on top of Sheets — that's expected. Photos are set to
"anyone with the link can view" so they render in the coach view.

## Part 2 — Configure the site

Open `app.js` and set the URL near the top:

```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfy.../exec";
```

Both pages read this one value.

## Part 3 — Host on GitHub Pages

1. Create a public repo, e.g. `workout-tracker`.
2. Push the files (`index.html` must be at the repo root):

   ```bash
   git init
   git add .
   git commit -m "WorkoutTracker"
   git branch -M main
   git remote add origin https://github.com/Grey0123/workout-tracker.git
   git push -u origin main
   ```

3. **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
4. After a minute:
   - Your side: `https://Grey0123.github.io/workout-tracker/`
   - Coach side: `https://Grey0123.github.io/workout-tracker/coach.html`

Send your coach the second link.

## Updating the Apps Script later

Editing `Code.gs` isn't enough — you must redeploy:
**Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**.
The URL stays the same. (This catches everyone at least once.)

---

## Notes & limitations

- **Open by design.** Anyone with either URL can read the log, and anyone with
  the Apps Script URL could POST to it. Fine for a workout log — don't put
  anything private in the notes. The coach page contains no write code, but
  that's a property of the page, not a permission on the backend.
- **Everything lives in the calendar.** Tap a day, then use the Workout / Food
  toggle. There are no separate logging tabs. A day with a workout is tinted
  blue with an accent bar; stripes inside each cell show sets done and meals
  logged.
- **Sets are recorded individually.** A collapsed activity reads `3 × 12`;
  tap it to see each set's own weight and reps. Rows logged before this
  existed show every set at the same weight until you edit them.
- **Meals are one entry per slot per day.** Re-logging breakfast updates that
  entry rather than adding a second one. The form shows you what's already
  saved when you pick a date and slot.
- **Photos are resized** to 1200px and re-encoded as JPEG in the browser before
  upload, because phone photos are far too large for an Apps Script POST.
- **Save flow.** Apps Script can't return a readable response to a browser
  (CORS), so the app POSTs, waits, re-reads the sheet, and confirms the row
  actually landed before showing the green "Saved" confirmation. If you see
  "sent, but not confirmed", the write probably still succeeded — refresh.
- **Editing / deleting entries** is done directly in the Google Sheet — it's
  your admin panel.

### If dates ever show as `NaN` or `—`

Sheets likes to reinterpret `2026-07-20` as a real date value and hand it back
in the spreadsheet's locale (`20/07/2026`), which used to break the display.
Two things now guard against it:

- `Code.gs` forces the Date column to plain-text format and writes `yyyy-mm-dd`.
- `app.js` normalises whatever it receives (`toKey()`), and every date shown to
  you falls back to `—` rather than `NaN`.

If you have older rows written before this fix, open the Apps Script editor,
pick `repairDateColumn` from the function dropdown and click **Run** once. It
rewrites both sheets' Date columns into the canonical format.
