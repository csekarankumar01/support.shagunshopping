import { PlatformLoginForm } from '@/components/platform-forms';

export const metadata = { title: 'Platform sign-in' };

export default function PlatformLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-white p-8 shadow-2xl dark:bg-slate-900">
        <div className="space-y-1">
          <span className="inline-block rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            PLATFORM
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Super admin sign-in</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">For the operator of this service, not for organisation members.</p>
        </div>
        <PlatformLoginForm />
      </div>
    </main>
  );
}
