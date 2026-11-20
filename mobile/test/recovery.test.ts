import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHRASE_WORDS, normalisePhrase, phraseWords, phraseShape,
  backupPositions, checkBackup,
} from '../src/services/recovery.ts';

/**
 * These rules decide whether somebody can get their money back, so the cases are the messy
 * real ones: a phrase pasted out of a notes app, a word missed while transcribing, a wallet
 * funded before it was ever backed up.
 */

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';

test('Wally creates 12 words', () => {
  assert.equal(PHRASE_WORDS, 12);
});

test('a pasted phrase is cleaned up rather than rejected', () => {
  // Every one of these is a real way a phrase comes back from where someone stored it.
  assert.equal(normalisePhrase('  Abandon   Ability \n able\t'), 'abandon ability able');
  assert.equal(normalisePhrase('1. abandon 2. ability 3. able'), 'abandon ability able');
  assert.equal(normalisePhrase('1) abandon 2) ability'), 'abandon ability');
  // A non-breaking space, which is what copying from a web page gives you.
  assert.equal(normalisePhrase('abandon ability'), 'abandon ability');
  assert.equal(normalisePhrase('ABANDON,ability;able'), 'abandon ability able');
  assert.equal(normalisePhrase(''), '');
  assert.equal(normalisePhrase('   '), '');
  assert.deepEqual(phraseWords('  '), [], 'empty must not read as one empty word');
});

test('the word count is named, because a missed word is invisible in a wall of twelve', () => {
  assert.equal(phraseShape(PHRASE).ok, true);
  assert.deepEqual(phraseShape(PHRASE).words.length, 12);

  const short = phraseShape('abandon ability able about above absent absorb abstract absurd abuse access');
  assert.equal(short.ok, false);
  assert.match(short.ok === false ? short.reason : '', /11 words/);

  // BIP-39's other legal lengths are accepted, because another wallet may have produced them.
  for (const n of [15, 18, 21, 24]) {
    assert.equal(phraseShape(Array.from({ length: n }, () => 'abandon').join(' ')).ok, true, `${n} words`);
  }
  for (const n of [1, 11, 13, 23, 25]) {
    assert.equal(phraseShape(Array.from({ length: n }, () => 'abandon').join(' ')).ok, false, `${n} words`);
  }

  const empty = phraseShape('   ');
  assert.equal(empty.ok, false);
  assert.match(empty.ok === false ? empty.reason : '', /Enter your recovery phrase/);
});

test('the backup challenge asks about distinct positions, and cannot be talked into fewer', () => {
  const sequence = [0.0, 0.5, 0.99];
  let at = 0;
  assert.deepEqual(backupPositions(12, 3, () => sequence[at++ % sequence.length]!), [0, 6, 11]);

  // A degenerate source of randomness must not produce a weaker challenge than asked for.
  const stuck = backupPositions(12, 3, () => 0.5);
  assert.equal(stuck.length, 3, 'a constant pick must still yield three positions');
  assert.equal(new Set(stuck).size, 3);

  // Never out of range, however pick behaves at the boundary.
  for (const p of [0, 0.999999, 1]) {
    for (const position of backupPositions(12, 4, () => p)) {
      assert.ok(position >= 0 && position < 12, `position ${position} out of range for pick ${p}`);
    }
  }
  // Asking for more than exists yields every position, not a hang.
  assert.equal(backupPositions(12, 99, () => Math.random()).length, 12);
});

test('a typed answer is forgiven its capitals and spaces, but not its spelling', () => {
  const words = phraseWords(PHRASE);
  const positions = [1, 5, 9];

  assert.deepEqual(
    checkBackup(words, positions, { 1: ' Ability ', 5: 'ABSENT', 9: 'abuse' }),
    { ok: true, wrong: [] },
  );

  // Every wrong position comes back at once, so the screen can mark them together instead of
  // making the user find them one at a time.
  const result = checkBackup(words, positions, { 1: 'ability', 5: 'absint', 9: '' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.wrong, [5, 9]);

  // A missing answer is wrong, not accepted.
  assert.deepEqual(checkBackup(words, [0], {}), { ok: false, wrong: [0] });
  // A position past the end of the phrase is wrong rather than throwing.
  assert.deepEqual(checkBackup(words, [99], { 99: 'abandon' }), { ok: false, wrong: [99] });
});

// The spend-gate cases moved to custody.test.ts on 8 November 2026. They now have to name
// whose money is being spent, because answering that is the whole point: a backup of the
// keystore wallet must never unlock spending from the dev server's.
