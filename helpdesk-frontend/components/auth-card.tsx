import type { ReactNode } from 'react';

const points = [
  '25+ years trusted cosmetic & beauty destination in Meerut',
  '100% genuine brands: Dot & Key, Lotus, Pilgrim, Swiss Beauty',
  'Fast replacement for damaged items & live beauty advisor support',
];

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#8a093c] via-[#cc145d] to-[#e6397e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-amber-400/15 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 text-lg font-extrabold backdrop-blur shadow-inner">
            S
          </span>
          <span className="text-xl font-bold tracking-tight">
            Shagun Shopping<span className="text-pink-200">.</span>
            <span className="ml-1 text-xs font-normal text-pink-100/80">Care Desk</span>
          </span>
        </div>
        <div className="relative space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-amber-300 animate-pulse" />
            Official Customer Resolution Center
          </div>
          <h2 className="text-4xl leading-tight font-semibold">
            Real-time care for your beauty orders.
          </h2>
          <ul className="space-y-3.5 text-white/95 text-sm">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-xs font-bold">
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-pink-100/75">
          Shagun Shopping Meerut · 25+ Years of Beauty Trust · Direct Order Support
        </p>
      </aside>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-pink-100/80 bg-white/90 p-8 shadow-xl shadow-pink-900/5 backdrop-blur dark:border-white/10 dark:bg-white/5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
