// Fixed to UTC so the server render never depends on the server's own timezone.
const formatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export const formatDate = (iso: string) => `${formatter.format(new Date(iso))} UTC`;
