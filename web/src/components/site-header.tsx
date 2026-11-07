export function SiteHeader({ tag }: { tag?: string }) {
  return (
    <header className="flex items-center justify-between gap-3 bg-navy px-4 py-4 text-white">
      <div className="font-display text-2xl leading-tight font-bold tracking-[0.04em] uppercase">
        Workout<span className="text-blue-hi">Tracker</span>
      </div>
      {tag && (
        <span className="rounded-full bg-white/12 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.14em] text-blue-tint uppercase">
          {tag}
        </span>
      )}
    </header>
  );
}
