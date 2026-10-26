'use client';

import { formatLocal, formatUtc } from '@/lib/format';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Shows a timestamp in the viewer's own timezone. The server cannot know it, so the page arrives with the
 * time in UTC (labelled) and switches to local time as soon as the browser has loaded the script.
 */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{hydrated ? formatLocal(iso) : formatUtc(iso)}</time>;
}
