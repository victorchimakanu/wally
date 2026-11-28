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

/** Just the time, for a row that already sits under a Today or Yesterday heading. */
export function clockLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Just the day, "27 Nov", for a row under Earlier where the hour no longer matters. */
export function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export type DayGroup<T> = { title: 'Today' | 'Yesterday' | 'Earlier'; items: T[] };

/**
 * A newest-first list split under Today, Yesterday and Earlier, as the activity boards group
 * it. Consecutive items share a heading, so the list's own order is kept; an item with no time
 * (a record older than the field) goes under Earlier.
 */
export function dayGroups<T>(items: readonly T[], at: (item: T) => number | undefined, now = Date.now()): DayGroup<T>[] {
  const today = startOfDay(new Date(now));
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const time = at(item);
    const days = time === undefined ? Infinity : Math.round((today - startOfDay(new Date(time))) / 86_400_000);
    const title = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier';
    const last = groups.at(-1);
    if (last?.title === title) last.items.push(item); else groups.push({ title, items: [item] });
  }
  return groups;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
