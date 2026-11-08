import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  weight: ["600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WorkoutTracker",
  description: "Log your training and meals, and share them with your coach or friends.",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "WorkoutTracker", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0B1B33",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <div className="flex-1">{children}</div>
        <footer className="px-4 pt-2 pb-6 text-center text-xs text-muted">
          WorkoutTracker is an individual project, not a certified coaching service, and nothing here is medical or
          nutrition advice.
        </footer>
      </body>
    </html>
  );
}
