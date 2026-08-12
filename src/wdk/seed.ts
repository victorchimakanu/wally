// Seed capture. A plaintext WDK_SEED in the parent environment is readable for
// the whole process lifetime via /proc/<pid>/environ or anything that inspects
// process.env. We capture it once into a module-local value and delete it from
// process.env, which closes the parent /proc/environ surface.
//
// Honest scope of this protection: the seed still exists (a) in the parent's
// JS heap while the process runs (a parent heap/core dump would contain it),
// and (b) in the environment of the WDK MCP subprocess, which needs it to
// sign — that child deletes WDK_SEED from its own env after reading, but it is
// still briefly present there at startup. This is inherent to server-side
// signing; the only way to remove it entirely is client-side (non-custodial)
// keys. For a single-user local wallet the residual surface is acceptable; a
// hosted multi-user deployment should not hold anyone's seed server-side.
//
// WDK_SEED_COMMAND / WDK_SEED_FILE are left in place: they are pointers, not
// the secret itself, and children resolve them on demand.

let captured: string | undefined;
let done = false;

export function captureSeed(): void {
  if (done) return;
  done = true;
  const s = process.env["WDK_SEED"];
  if (s) {
    captured = s;
    delete process.env["WDK_SEED"];
  }
}

export function getCapturedSeed(): string | undefined {
  return captured;
}
