// Seed capture. A plaintext WDK_SEED in the environment is readable for the
// whole process lifetime via /proc/<pid>/environ, a core dump, or any code
// that inspects process.env. We capture it once into a module-local value and
// delete it from process.env, so the parent no longer carries it in its
// environment. Child processes that need to sign (the MCP subprocess, the
// approve runner) get it handed to them explicitly via getCapturedSeed().
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
