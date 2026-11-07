# WorkoutTracker v2 website

Next.js + Supabase. The database and its access rules live in
[`../supabase/migrations`](../supabase/migrations). v1 stays at the repo root and keeps running on
GitHub Pages until v2 launches.

## Run it locally

Start Docker Desktop first. Supabase runs on your machine in Docker, so this is free and uses no
hosted project.

```bash
npm install
npm run db:start              # first run downloads a few GB of images
npm run db:status             # shows the local URL and publishable key
cp .env.example .env.local    # then paste those two values in
npm run dev
```

Without those two values the site still runs and shows a setup notice.

| Command | What it does |
|---|---|
| `npm run db:start` | Starts local Supabase and applies new migrations |
| `npm run db:stop` | Stops it and keeps your data |
| `npm run db:reset` | **Wipes local data** and rebuilds from the migrations |
| `npm run db:status` | Shows the URLs and keys |

Studio, the database dashboard, runs at http://127.0.0.1:54323. Sign-up emails aren't really sent:
they appear in the local mail viewer at http://127.0.0.1:54324.

## What's here

Home, Calendar (workouts and meals) and Progress, the same flows and look as v1, per account. The
screens load the signed-in person's log in the browser and write through the database functions in
[`20261101000100_logging.sql`](../supabase/migrations/20261101000100_logging.sql), so one save can't
half-happen. Changes show straight away and roll back if the database refuses them.

People (M3) is where you share your log: with a friend or a coach, by username or a single-use
invite link. Connections only change through the functions in
[`20261107000100_sharing.sql`](../supabase/migrations/20261107000100_sharing.sql), which check who's
asking. A log shared with you opens read-only at `/u/their-username`, with only what they ticked.

Coaches (M4) get a Clients tab, and a client's page adds Notes and lets them log within the access
level the client chose. Every change by someone else is in the edit history and notifies the
owner, who can undo it, including restoring what a coach deleted
([`20261107000200_coach_workspace.sql`](../supabase/migrations/20261107000200_coach_workspace.sql)).

Progress (M5) covers a chosen period against the one before: summary, the coach's goal with a progress
bar, strength (estimated 1RM, PRs with their tempo, rep ranges), sets per muscle against a 10–20 target,
a training heatmap, meals, body weight with a 7-day average, form videos, and coach evaluations. The
figures are pure functions in [`src/lib/progress/calc.ts`](src/lib/progress/calc.ts), tested on their own.

The built-in exercises are in
[`20261101000000_exercise_library.sql`](../supabase/migrations/20261101000000_exercise_library.sql).
That list is a draft, written because the PRD's `exercises.json` couldn't be found.

## Import v1's history

Sign up on the site first, then preview and import into that account:

```bash
npm run import:v1 -- --username your_username           # preview, writes nothing
npm run import:v1 -- --username your_username --write
```

The preview lists every correction it would make, such as times read from notes, misspelled
exercise names, machines folded into one exercise (the machine goes in the variant), assisted
pull-ups and dips, and body weight typed as the weight on a plank. Running the import again is safe: it updates the same rows, and anything you added
in v2 is left alone. Entries deleted in v1 after an earlier run stay in v2 until you remove them.

It only writes to local Supabase unless you also pass `--allow-remote`.

## Set up hosted Supabase

Apply the migrations in `../supabase/migrations`, in order, using the Supabase CLI or the dashboard's
SQL editor.

## Test

```bash
npm test
```

The tests run the real migrations on PGlite, a Postgres that runs inside Node, so they need neither
Docker nor a Supabase project. They cover who can read and write what (PRD sections 4 and 9).
Add a test whenever an access rule changes: a mistake here exposes someone's body and food data.
A second set runs against local Supabase when it's up, and is skipped when it isn't.
