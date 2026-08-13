// Seed lifecycle for a single-user, self-hosted Wally.
//
// Wally is one wallet per running instance. Whoever starts it gets THEIR own
// wallet; two people running two copies never share funds because the keys
// live on each person's own machine. This module resolves that one seed.
//
// Resolution order at startup:
//   1. WDK_SEED (plaintext env)          -> capture it, delete from env.
//   2. WDK_SEED_COMMAND / WDK_SEED_FILE  -> leave for the WDK subprocess to
//                                           resolve (a pointer, not the secret).
//   3. Nothing configured                -> AUTO-CREATE a fresh wallet: generate
//                                           a BIP-39 phrase, persist it to a
//                                           gitignored local file (owner-only),
//                                           and flag it for the one-time backup
//                                           prompt in the UI.
//
// Honest scope: the seed still lives in this process's memory and, briefly, in
// the WDK subprocess environment (which needs it to sign). That is inherent to
// any on-device wallet and acceptable here because it is the user's OWN wallet
// on the user's OWN machine — never a shared server holding many people's keys.

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SEED_FILE = process.env["WALLY_SEED_PATH"] ?? path.join(ROOT, ".wally-seed");
const BACKED_MARKER = SEED_FILE + ".backed";

let captured: string | undefined;
let done = false;
// The freshly-generated phrase, held until the user acknowledges the backup.
// Null once acknowledged (or if the seed pre-existed and was already backed up).
let unbackedPhrase: string | null = null;

export function captureSeed(): void {
  if (done) return;
  done = true;

  // 1. Plaintext env seed.
  if (process.env["WDK_SEED"]) {
    captured = process.env["WDK_SEED"];
    delete process.env["WDK_SEED"];
    return;
  }

  // 2. A command/file source — let the subprocess resolve it; nothing to hold.
  if (process.env["WDK_SEED_COMMAND"] || process.env["WDK_SEED_FILE"]) {
    return;
  }

  // 3. Auto-managed local wallet.
  if (existsSync(SEED_FILE)) {
    captured = readFileSync(SEED_FILE, "utf8").trim();
    // Existing wallet the user never confirmed backing up → still prompt.
    if (!existsSync(BACKED_MARKER)) unbackedPhrase = captured;
    return;
  }

  // First run: create a wallet for this user.
  const phrase = Wallet.createRandom().mnemonic!.phrase;
  writeFileSync(SEED_FILE, phrase + "\n", { mode: 0o600 });
  try {
    chmodSync(SEED_FILE, 0o600);
  } catch {
    // best effort on platforms without POSIX perms
  }
  captured = phrase;
  unbackedPhrase = phrase;

  // Loud console notice on the run that creates the wallet.
  console.error(
    "\n" +
      "────────────────────────────────────────────────────────────\n" +
      " A new wallet was created for you. Your recovery phrase is:\n\n" +
      "   " + phrase + "\n\n" +
      " Write it down and keep it safe. It is the ONLY way to recover\n" +
      " this wallet. Anyone who has it controls your funds.\n" +
      " Saved to: " + SEED_FILE + " (keep this file private).\n" +
      "────────────────────────────────────────────────────────────\n"
  );
}

export function getCapturedSeed(): string | undefined {
  return captured;
}

// getRecoveryPhraseForBackup returns the phrase ONLY while a backup is still
// pending, for the one-time UI prompt. Returns null once acknowledged.
export function getRecoveryPhraseForBackup(): string | null {
  return unbackedPhrase;
}

export function isBackupPending(): boolean {
  return unbackedPhrase !== null;
}

// acknowledgeBackup records that the user saved their phrase and stops the UI
// from ever showing it again (a marker file, so it survives restarts).
export function acknowledgeBackup(): void {
  if (unbackedPhrase === null) return;
  try {
    writeFileSync(BACKED_MARKER, new Date().toISOString() + "\n");
  } catch {
    // non-fatal
  }
  unbackedPhrase = null;
}
