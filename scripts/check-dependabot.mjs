#!/usr/bin/env node
/**
 * Guard .github/dependabot.yml against the two ways it goes quietly wrong.
 *
 * **One.** `ignore` applies to security updates as well as version updates, so an entry that
 * names a dependency and nothing else switches off its security pull requests. The escape is
 * to list `update-types` explicitly, because those affect only version updates — GitHub's
 * documentation says "Security updates will always be created regardless of the
 * `update-types` setting". Every ignore in that file therefore carries all three semver
 * levels, and the file looks repetitive enough that someone will eventually tidy it. Tidying
 * it turns off security updates for the wallet's runtime, and nothing would say so: the
 * advisory still appears on the alerts page, looking handled.
 *
 * **Two.** A new workspace with a package.json and no entry here is simply unwatched. That is
 * the same failure as the one `app-data.ts` was built against — a thing with no single place
 * that knows the full list — so the full list is checked rather than remembered.
 *
 * This reads the file as text rather than parsing YAML, which needs no dependency and has a
 * deliberate side effect: a reformat fails the check. In a file where a formatting choice
 * changes security behaviour, making someone look is the right outcome, not a false alarm.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, '.github', 'dependabot.yml');
const problems = [];

let text;
try {
  text = readFileSync(configPath, 'utf8');
} catch {
  problems.push('.github/dependabot.yml is missing. Nothing is watching the dependencies (FEATURE-AUDIT §19.6).');
}

if (text) {
  const lines = text.split('\n');
  const SEMVER = ['version-update:semver-major', 'version-update:semver-minor', 'version-update:semver-patch'];

  // ── One: every ignore must be scoped to version updates ───────────────────────────────────
  let ignores = 0;
  lines.forEach((line, index) => {
    if (!/^\s*- dependency-name:/.test(line)) return;
    ignores++;
    const name = line.split(':').slice(1).join(':').trim();
    const next = lines[index + 1] ?? '';
    if (!/^\s*update-types:/.test(next)) {
      problems.push(`dependabot.yml:${index + 1}: the ignore for ${name} has no update-types on the next line, so it ` +
        `would switch off that dependency's SECURITY updates as well as its version updates.`);
      return;
    }
    const missing = SEMVER.filter(level => !next.includes(level));
    if (missing.length) {
      problems.push(`dependabot.yml:${index + 2}: the ignore for ${name} is missing ${missing.join(', ')}. ` +
        `All three must be listed; a partial list leaves version-update noise it was meant to stop.`);
    }
  });
  if (ignores === 0) {
    problems.push('dependabot.yml has no ignore entries at all. The Expo SDK pins its own versions and ' +
      '`npx expo install` is what sets them, so a plain npm bump is exactly what AGENTS.md forbids.');
  }

  // ── Two: every tracked manifest must be watched ───────────────────────────────────────────
  const watched = new Set(
    lines.filter(line => /^\s*directory:/.test(line))
      .map(line => line.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '')),
  );

  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '*package.json', 'package.json'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    tracked = findManifests(root);  // not a checkout; walk the tree instead
  }

  for (const manifest of tracked) {
    // node_modules is never ours, and a nested manifest inside a package we depend on is not
    // a workspace anyone updates.
    if (manifest.includes('node_modules/')) continue;
    const dir = '/' + dirname(manifest).replace(/^\.$/, '');
    const normalised = dir === '/' ? '/' : dir.replace(/\/$/, '');
    if (!watched.has(normalised)) {
      problems.push(`${manifest} is committed but no dependabot.yml entry covers "${normalised}", so nothing ` +
        `watches its dependencies. Add an entry, or say in a comment why it is deliberately excluded.`);
    }
  }
}

function findManifests(from, found = []) {
  for (const name of readdirSync(from)) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(from, name);
    if (statSync(path).isDirectory()) findManifests(path, found);
    else if (name === 'package.json') found.push(relative(root, path));
  }
  return found;
}

if (problems.length) {
  console.error('dependabot.yml needs attention:\n');
  for (const problem of problems) console.error('  - ' + problem + '\n');
  process.exit(1);
}
console.log('dependabot.yml: every ignore is scoped to version updates, and every committed manifest is watched.');
