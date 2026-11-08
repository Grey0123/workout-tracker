# WorkoutTracker Android app

The app is the website in a WebView, made with Capacitor (PRD 7 and M6). It loads the site from
`SERVER_URL` rather than shipping its own copy, so every website change reaches the app without a
new build. `www/` holds only the page shown when the site can't be reached.

## Run it on a phone, against this computer

Until v2 is hosted, the app points at `http://localhost:3000`. Over a USB cable, `adb reverse` makes
the phone's localhost reach this computer, including local Supabase.

1. Start Docker Desktop, then the site: in `../web`, `npm run db:start` and `npm run dev` (or
   `npx next build` then `npx next start`).
2. Connect the phone with USB debugging on, then:

   ```bash
   adb reverse tcp:3000 tcp:3000      # the site
   adb reverse tcp:54321 tcp:54321    # local Supabase
   ```

3. Build and install:

   ```bash
   npm install
   npm run build                      # needs JAVA_HOME, e.g. Android Studio's jbr folder
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

The links in step 2 last until the cable is unplugged.

## Point it at the hosted site

```bash
SERVER_URL=https://your-site.example npm run build
```

Plain `http` is only allowed when `SERVER_URL` uses it, which is meant for development.

## What the app adds to the site

- Login persists: cookies are saved whenever the app leaves the screen (`MainActivity.java`).
- The Android back button goes back a page, and leaves the app from the first one (`@capacitor/app`).
- Photo inputs can use the camera as well as the gallery (the camera permission in the manifest).
- The icon comes from `resources/icon-only.png`: `npm run assets` regenerates the Android sizes.

Push notifications need a Firebase project, which isn't set up yet.
