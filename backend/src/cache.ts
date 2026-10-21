/**
 * A small TTL cache that also keeps entries past expiry so a failing upstream can be served
 * stale rather than as an error. The mobile app already distinguishes fresh from saved data,
 * so handing it stale-but-labelled beats handing it nothing.
 */
export type Cached<T> = { value: T; storedAt: number; fresh: boolean };

type Entry<T> = { value: T; storedAt: number };

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  /** Returns a fresh entry, or null. Use `stale` to fall back when the upstream fails. */
  get(key: string): Cached<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt >= this.ttlMs) return null;
    return { value: entry.value, storedAt: entry.storedAt, fresh: true };
  }

  /** Returns an expired entry if one exists. Only for the upstream-failed path. */
  stale(key: string): Cached<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return { value: entry.value, storedAt: entry.storedAt, fresh: false };
  }

  set(key: string, value: T): void {
    // Drop the oldest insertion when full; these are all equivalent-cost refetches.
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, storedAt: Date.now() });
  }

  get size(): number {
    return this.entries.size;
  }
}
