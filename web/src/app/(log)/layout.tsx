import { AppHeader } from "@/components/log/app-header";
import { LogProvider } from "@/components/log/log-provider";
import { RestTimerProvider } from "@/components/log/rest-timer";

export default function LogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="log-app">
      <AppHeader />
      <main className="log-main">
        <RestTimerProvider>
          <LogProvider>{children}</LogProvider>
        </RestTimerProvider>
      </main>
    </div>
  );
}
