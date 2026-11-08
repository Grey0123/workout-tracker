import type { MetadataRoute } from "next";

/** Lets the site be installed to a phone's home screen (PRD 11: a solid PWA first). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WorkoutTracker",
    short_name: "WorkoutTracker",
    description: "Log your training and meals, and share them with your coach or friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: "#0b1b33",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
