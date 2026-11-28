/**
 * When something happened, the way a person says it: "Today, 10:42", "Yesterday, 16:15", and
 * "27 Nov, 11:24" for anything older. Calendar days, not 24-hour windows, so a transfer at
 * 23:50 last night is "Yesterday" at 00:10 and not "Today".
 */
export function whenLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
