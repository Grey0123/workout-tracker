import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The app is the website in a WebView (PRD 7), so it loads the site from SERVER_URL
 * rather than shipping its own copy. Until v2 is hosted, that's this computer:
 * `adb reverse` makes the phone's localhost reach it over USB (see README.md).
 */
const url = process.env.SERVER_URL ?? "http://localhost:3000";

const config: CapacitorConfig = {
  appId: "app.workouttracker.mobile",
  appName: "WorkoutTracker",
  // Shown only if the site can't be reached.
  webDir: "www",
  server: {
    url,
    // Plain http is only for the computer during development.
    cleartext: url.startsWith("http://"),
  },
  android: {
    // Shows the site's own status-bar colour rather than a white strip.
    backgroundColor: "#0B1B33",
  },
};

export default config;
