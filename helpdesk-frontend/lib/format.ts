const options = { dateStyle: 'medium', timeStyle: 'short' } as const;

// The server renders in UTC so its output never depends on the server's own timezone.
const utc = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const local = new Intl.DateTimeFormat('en-GB', options);

export const formatUtc = (iso: string) => `${utc.format(new Date(iso))} UTC`;
/** In the viewer's own timezone, so it only makes sense in the browser. */
export const formatLocal = (iso: string) => local.format(new Date(iso));
