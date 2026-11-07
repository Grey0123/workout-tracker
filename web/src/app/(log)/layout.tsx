import { AppHeader } from "@/components/log/app-header";
import { LogProvider } from "@/components/log/log-provider";

export default function LogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="log-app">
      <AppHeader />
      <main className="log-main">
        <LogProvider>{children}</LogProvider>
      </main>
    </div>
  );
}
