'use client';

import { useState } from 'react';
import { useHydrated } from '@/lib/use-hydrated';

export function ThemeToggle() {
  const hydrated = useHydrated();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  });

  const toggleTheme = () => {
    const isCurrentlyDark =
      document.documentElement.classList.contains('dark') ||
      (!document.documentElement.classList.contains('light') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isCurrentlyDark ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // localStorage may be disabled in private browsing
    }

    if (next === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  };

  if (!hydrated) {
    return (
      <div className="h-8 w-8 rounded-lg border border-slate-300/60 bg-white/50 dark:border-white/10 dark:bg-white/5" />
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300/70 bg-white/80 text-slate-700 shadow-sm backdrop-blur transition-all duration-200 hover:border-indigo-400 hover:bg-white hover:text-indigo-600 hover:shadow active:scale-95 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-white/10 dark:hover:text-indigo-400"
    >
      {theme === 'dark' ? (
        // Sun icon (click to make light)
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 transition-transform duration-300 rotate-0 hover:rotate-45 text-amber-400"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        // Moon icon (click to make dark)
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 transition-transform duration-300 -rotate-12 hover:rotate-0 text-indigo-600"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  );
}
