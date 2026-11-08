/**
 * What the app records when it breaks, and what it refuses to record.
 *
 * Until now Wally had no error reporting of any kind — not one file mentioned a crash
 * reporter, a log, or an error boundary. When a transfer failed on a phone in Lagos, nobody
 * would ever know it happened. For software that moves money that is a larger hole than any
 * missing feature.
 *
 * **Local, and deliberately so.** Nothing here is sent anywhere. A hosted reporter means a
 * stack trace from a wallet leaving the device to a third party, and `CLAUDE.md`'s second team
 * rule is that keys never leave the device. A report the user reads and chooses to hand over is
 * the version of this that needs no account, no DSN, and no promise about someone else's
 * retention policy. Sending them automatically is a separate decision, and a product one.
 *
 * **The scrubber is the security control in this file.** A crash is exactly the moment a seed
 * phrase, a private key or a ciphertext blob is most likely to be sitting in a variable that
 * ends up in a stack trace or an error message. It redacts before anything is stored, not
 * before anything is shown, because the stored copy is the one that outlives the session.
 */

export type CrashRecord = {
  /** Unix ms. The only time this file keeps. */
  at: number;
  /** 'error' for a thrown exception, 'rejection' for an unhandled promise. */
  kind: 'error' | 'rejection' | 'render';
  /** Already scrubbed. */
  message: string;
  /** Already scrubbed, and clipped. */
  stack: string;
  /** Which build, so a report is attributable to a version. */
  build: string;
};

/** Keeping every crash forever is its own bug. Newest wins. */
export const MAX_RECORDS = 20;
/** A stack long enough to debug, short enough not to be a storage problem. */
export const MAX_STACK = 4000;

const REDACTED = '[redacted]';

/**
 * Remove anything that could be key material before it is written down.
 *
 * The order matters: the longest and most dangerous shapes go first, so a 64-character key is
 * never partially matched by the 40-character address rule and left half-visible.
 *
 * What is kept on purpose: a **truncated** address, because "which wallet" is most of what a
 * report is for, and six leading characters cannot be reversed into a key.
 */
export function scrubCrash(input: unknown): string {
  let text = typeof input === 'string' ? input : String(input ?? '');

  // A mnemonic. Twelve or more lowercase words in a row is not a sentence anyone's code
  // produces by accident; it is the one thing in this app that must never be written down
  // anywhere but paper. Checked before everything else and redacted whole.
  text = text.replace(/\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g, REDACTED);

  // 64 hex characters: a private key, an encryption key, or a transaction hash. A hash would
  // be useful in a report and a key would be catastrophic, and from the outside they are
  // indistinguishable — so both go. Safety is worth the debugging cost.
  text = text.replace(/\b(?:0x)?[\da-fA-F]{64}\b/g, REDACTED);

  // Addresses: keep enough to tell wallets apart, not enough to be anything else.
  text = text.replace(/\b0x[\da-fA-F]{40}\b/g, match => `${match.slice(0, 8)}…${match.slice(-4)}`);

  // Long base64 runs: the vault stores the encrypted seed this way.
  text = text.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, REDACTED);

  // Anything a key-shaped label introduces, whatever its format.
  text = text.replace(/\b(seed|mnemonic|phrase|privateKey|private_key|secret|password|entropy)\b\s*[:=]\s*\S+/gi,
    (_m, label: string) => `${label}: ${REDACTED}`);

  return text;
}

/** Build one record from a thrown thing. Never throws itself — it runs inside a crash handler. */
export function toRecord(kind: CrashRecord['kind'], thrown: unknown, build: string, at: number): CrashRecord {
  let message = '';
  let stack = '';
  try {
    if (thrown instanceof Error) {
      message = thrown.message || thrown.name || 'Unknown error';
      stack = thrown.stack ?? '';
    } else {
      message = String(thrown ?? 'Unknown error');
    }
  } catch { message = 'Unknown error'; }

  return {
    at,
    kind,
    message: scrubCrash(message).slice(0, 300),
    stack: scrubCrash(stack).slice(0, MAX_STACK),
    build: scrubCrash(build).slice(0, 120),
  };
}

/** Newest first, capped. Pure, so the cap is testable without a device. */
export function addRecord(existing: readonly CrashRecord[], record: CrashRecord): CrashRecord[] {
  return [record, ...existing].slice(0, MAX_RECORDS);
}

/** Only well-formed records survive a read; a corrupt file must not crash the crash reporter. */
export function parseRecords(raw: unknown): CrashRecord[] {
  if (!Array.isArray(raw)) return [];
  const kinds = ['error', 'rejection', 'render'];
  return raw.filter((item): item is CrashRecord => {
    if (!item || typeof item !== 'object') return false;
    const r = item as Record<string, unknown>;
    return typeof r.at === 'number' && Number.isFinite(r.at) && r.at > 0
      && typeof r.kind === 'string' && kinds.includes(r.kind)
      && typeof r.message === 'string' && typeof r.stack === 'string' && typeof r.build === 'string';
  }).slice(0, MAX_RECORDS);
}

/**
 * The text a person hands to whoever is helping them.
 *
 * Scrubbed again on the way out. The stored copy is already clean, but this is the string that
 * actually leaves the device, and running the control twice costs nothing.
 */
export function reportText(records: readonly CrashRecord[]): string {
  if (!records.length) return 'No problems have been recorded on this device.';
  return records.map(record => scrubCrash([
    `${new Date(record.at).toISOString()} · ${record.kind} · ${record.build}`,
    record.message,
    record.stack,
  ].filter(Boolean).join('\n'))).join('\n\n---\n\n');
}
