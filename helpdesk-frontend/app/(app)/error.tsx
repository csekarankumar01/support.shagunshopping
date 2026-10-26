'use client';

// Shown when a page's data call fails for any reason other than "not logged in" (503 backend down, 500, ...).
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p role="alert" className="text-sm text-neutral-600 dark:text-neutral-400">
        {error.message}
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
