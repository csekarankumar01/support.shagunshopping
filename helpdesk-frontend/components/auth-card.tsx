import type { ReactNode } from 'react';

const points = ['Isolated workspace for every organisation', 'Live chat with private internal notes', 'SLA timers that alert before it is too late'];

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-sky-500 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-base backdrop-blur">H</span>
          Helpdesk
        </div>
        <div className="relative space-y-6">
          <h2 className="text-4xl leading-tight font-semibold">Support that keeps its promises.</h2>
          <ul className="space-y-3 text-white/90">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Real-time, multi-tenant customer support.</p>
      </aside>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-slate-200/70 bg-white/80 p-8 shadow-xl shadow-indigo-500/5 backdrop-blur dark:border-white/10 dark:bg-white/5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
