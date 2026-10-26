import type { ReactNode } from 'react';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
