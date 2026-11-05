/**
 * The rules around a recovery phrase: what a valid one looks like, how we check the user
 * really wrote it down, and when a wallet is safe enough to spend from.
 *
 * None of this touches key material. The phrase is generated, encrypted and decrypted inside
 * the WDK Bare worklet (see wallet-keystore.ts); this module only reasons about a string the
 * user typed or a record the vault holds. That split is deliberate — these are the decisions
 * worth testing exhaustively, and they can be tested without a device.
 *
 * Decisions recorded here because they are product decisions, not obvious ones:
 *
 *   12 words, not 24. WDK supports either. 128 bits of entropy is beyond brute force, and the
 *   realistic failure is a person transcribing a phrase wrongly onto paper — which 24 words
 *   makes twice as likely, for no security gain.
 *
 *   Guardians are deliberately not here. The Arbitrum account is a Safe and could have
 *   guardian owners, but WDK exposes no API for it (the multisig owner-management interfaces
 *   in @tetherto/wdk-wallet have no EVM implementation), and the Ethereum account is a plain
 *   EOA that guardians could never protect. So the phrase is the whole recovery story, and
 *   pretending otherwise would be worse than saying so.
 */

/** The only length Wally creates. Restore still accepts 24, because other wallets produce it. */
export const PHRASE_WORDS: 12 = 12;

/** Lengths BIP-39 defines that we will accept on restore. */
const ACCEPTED_LENGTHS = [12, 15, 18, 21, 24];

/**
 * Collapse whatever the user gave us into a canonical phrase.
 *
 * Paste is the normal case and paste is messy: newlines from a text file, numbered lists from
 * a screenshot's OCR, non-breaking spaces from a web page, a trailing space from a keyboard.
 * Lowercasing is safe because the BIP-39 English wordlist is entirely lowercase.
 */
export function normalisePhrase(raw: string): string {
  return raw
    .normalize('NFKD')
    // Strip list numbering such as "1. abandon" or "1) abandon", which is how a phrase written
    // down in a notes app usually comes back.
    .replace(/\b\d{1,2}[.)]\s*/g, ' ')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function phraseWords(raw: string): string[] {
  const text = normalisePhrase(raw);
  return text ? text.split(' ') : [];
}

export type PhraseProblem =
  | { ok: true; words: string[] }
  | { ok: false; reason: string; words: string[] };

/**
 * Check the shape of a phrase before handing it to the worklet.
 *
 * This deliberately does **not** validate the BIP-39 checksum — that needs the wordlist and
 * the worklet does it properly. The point here is to turn the two mistakes a person actually
 * makes into a sentence they can act on. "That is 11 words, not 12" is useful; the worklet's
 * answer for the same input is an invalid-seed error that does not say which part is wrong.
 */
export function phraseShape(raw: string): PhraseProblem {
  const words = phraseWords(raw);
  if (words.length === 0) return { ok: false, reason: 'Enter your recovery phrase.', words };
  if (!ACCEPTED_LENGTHS.includes(words.length)) {
    const nearest = words.length < 12 ? 12 : 24;
    return {
      ok: false,
      // Naming the count found is the whole value of this check: a missed or doubled word is
      // the common error, and it is invisible in a wall of twelve words.
      reason: `That is ${words.length} ${words.length === 1 ? 'word' : 'words'}. A recovery phrase has ${nearest === 12 ? '12' : '12 or 24'}.`,
      words,
    };
  }
  return { ok: true, words };
}

/**
 * Which words to ask about when confirming a backup.
 *
 * Typed, not multiple choice. Multiple choice needs decoy words, and decoys drawn from the
 * same phrase are all correct answers while decoys drawn from the wordlist mean shipping the
 * wordlist. More to the point, tapping a word you recognise proves recognition; typing it
 * proves you have it written down, which is the thing being checked.
 *
 * `pick` is injected so a test can pin the positions. It returns a float in [0, 1).
 */
export function backupPositions(wordCount: number, howMany: number, pick: () => number): number[] {
  const chosen = new Set<number>();
  // Bounded rather than while-true: a `pick` that always returns the same value would
  // otherwise spin forever, and this runs on the user's phone.
  for (let attempt = 0; attempt < wordCount * 20 && chosen.size < Math.min(howMany, wordCount); attempt++) {
    chosen.add(Math.min(wordCount - 1, Math.floor(pick() * wordCount)));
  }
  // Still short — a degenerate `pick`. Fill in order so the challenge is never silently
  // weaker than asked for.
  for (let i = 0; chosen.size < Math.min(howMany, wordCount); i++) chosen.add(i);
  return [...chosen].sort((a, b) => a - b);
}

export type BackupCheck = { ok: boolean; wrong: number[] };

/**
 * Compare typed answers against the phrase.
 *
 * Answers are normalised the same way the phrase is, so trailing spaces and capitals from a
 * phone keyboard do not read as a wrong answer. Returns every wrong position rather than the
 * first, so the screen can mark them all at once instead of making the user discover them one
 * at a time.
 */
export function checkBackup(words: string[], positions: number[], answers: Record<number, string>): BackupCheck {
  const wrong = positions.filter(position => {
    const expected = words[position];
    const given = normalisePhrase(answers[position] ?? '');
    return !expected || !given || given !== expected;
  });
  return { ok: wrong.length === 0, wrong };
}

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: string; action: 'create' | 'back-up' };

/**
 * Whether this wallet may be spent from.
 *
 * **Receiving and balances are never gated — only signing.** A wallet that cannot receive is
 * useless, and a user who has funded a wallet they cannot recover is the worst outcome this
 * app can produce. So the gate sits exactly where the irreversible step is.
 *
 * wallet-vault.ts has promised this in a comment since it was written ("nothing may be signed
 * until the user has written it down") and nothing enforced it. This is the enforcement.
 *
 * Note the honest limit: this is an app rule, not a chain rule. Someone holding the phrase can
 * spend these funds from any other wallet software, and nothing here prevents that.
 */
export function spendAllowed(record: { backedUpAt: number } | null): SpendDecision {
  if (!record) {
    return { allowed: false, reason: 'Set up your wallet before sending.', action: 'create' };
  }
  if (!record.backedUpAt) {
    return {
      allowed: false,
      reason: 'Write down your recovery phrase first. Without it, nothing can bring this wallet back.',
      action: 'back-up',
    };
  }
  return { allowed: true };
}
