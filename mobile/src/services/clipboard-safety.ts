/**
 * Copying an address without leaving it lying there.
 *
 * A wallet address sitting in the system clipboard is readable by every app on the device for
 * as long as it stays there. Clipboard-sniffing malware is ordinary in this space, and the
 * version that matters swaps the contents for the attacker's address between the copy and the
 * paste — so the user copies their own address and pastes someone else's.
 *
 * This cannot prevent that. Nothing in an app can. What it can do is stop the address
 * outliving its use: clear it a short while later, and only if it is still what we put there,
 * so a later copy of something unrelated is never destroyed.
 *
 * Everything is injected rather than imported, both so this is testable without a device and
 * because the clipboard module differs by platform.
 */

export type ClipboardPort = {
  setStringAsync(value: string): Promise<boolean>;
  getStringAsync(): Promise<string>;
};

export type Scheduler = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/**
 * Long enough to paste somewhere, short enough that a phone left on a table is not carrying an
 * address around. Sixty seconds is the convention among wallets and there is no reason to be
 * cleverer than that.
 */
export const CLIPBOARD_TTL_MS = 60_000;

export type CopyResult = { copied: boolean; willClearInMs: number | null };

export function createClipboardSafety(clipboard: ClipboardPort, scheduler: Scheduler = globalThis) {
  let pending: unknown = null;

  return {
    /**
     * Copy, and arrange for it to be cleared.
     *
     * Only one clear is ever outstanding: copying a second address cancels the first timer,
     * so an earlier address cannot wipe a later one out from under the user.
     */
    async copy(value: string, ttlMs = CLIPBOARD_TTL_MS): Promise<CopyResult> {
      const copied = await clipboard.setStringAsync(value);
      if (!copied) return { copied: false, willClearInMs: null };

      if (pending !== null) scheduler.clearTimeout(pending);
      pending = scheduler.setTimeout(() => {
        pending = null;
        void (async () => {
          try {
            // Only clear what we put there. By now the user may have copied a password, a
            // message, anything — none of which is ours to destroy.
            const current = await clipboard.getStringAsync();
            if (current === value) await clipboard.setStringAsync('');
          } catch {
            // A clipboard that cannot be read is not a reason to show the user an error.
          }
        })();
      }, ttlMs);

      return { copied: true, willClearInMs: ttlMs };
    },

    /** Stop a pending clear — for when a screen unmounts and the timer should not outlive it. */
    cancel(): void {
      if (pending !== null) scheduler.clearTimeout(pending);
      pending = null;
    },
  };
}

/** What to tell someone once an address is copied, so the clearing is not a surprise. */
export function copyNotice(result: CopyResult): string {
  if (!result.copied) return 'Copy is unavailable on this device. Share the address instead.';
  const seconds = Math.round((result.willClearInMs ?? 0) / 1000);
  return `Address copied. It will be cleared from the clipboard in ${seconds} seconds — paste it before then, and check it after pasting.`;
}
