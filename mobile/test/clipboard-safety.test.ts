import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipboardSafety, copyNotice, CLIPBOARD_TTL_MS, type ClipboardPort, type Scheduler } from '../src/services/clipboard-safety.ts';

/** A clipboard and a clock we control, so the timing is deterministic. */
function harness(setOk = true) {
  let value = '';
  const sets: string[] = [];
  const clipboard: ClipboardPort = {
    async setStringAsync(v) { if (!setOk) return false; value = v; sets.push(v); return true; },
    async getStringAsync() { return value; },
  };
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;
  const scheduler: Scheduler = {
    setTimeout(fn, ms) { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout(handle) { const i = timers.findIndex(t => t.id === handle); if (i >= 0) timers.splice(i, 1); },
  };
  return {
    clipboard, scheduler, sets, timers,
    get value() { return value; },
    set value(v: string) { value = v; },
    async fire() { const due = [...timers]; timers.length = 0; for (const t of due) t.fn(); await new Promise(r => setImmediate(r)); },
  };
}

const ADDRESS = '0xab12cd34ef567890abcdef1234567890abcd1234';

test('an address does not stay in the clipboard', async () => {
  const h = harness();
  const safety = createClipboardSafety(h.clipboard, h.scheduler);

  const result = await safety.copy(ADDRESS);
  assert.equal(result.copied, true);
  assert.equal(result.willClearInMs, CLIPBOARD_TTL_MS);
  assert.equal(h.value, ADDRESS);

  await h.fire();
  assert.equal(h.value, '', 'the address must not outlive its use');
});

test('it only clears what it put there', async () => {
  const h = harness();
  const safety = createClipboardSafety(h.clipboard, h.scheduler);
  await safety.copy(ADDRESS);

  // The user copies something else before the timer fires.
  h.value = 'a password they are mid-way through pasting';
  await h.fire();

  assert.equal(h.value, 'a password they are mid-way through pasting', 'must never destroy what it did not write');
});

test('copying twice does not let the first clear wipe the second', async () => {
  const h = harness();
  const safety = createClipboardSafety(h.clipboard, h.scheduler);
  const second = '0x1111222233334444555566667777888899990000';

  await safety.copy(ADDRESS);
  await safety.copy(second);
  assert.equal(h.timers.length, 1, 'the earlier timer must be cancelled, not left running');

  await h.fire();
  assert.equal(h.value, '', 'the surviving timer clears the address that is actually there');
});

test('cancel stops a pending clear, for a screen that goes away', async () => {
  const h = harness();
  const safety = createClipboardSafety(h.clipboard, h.scheduler);
  await safety.copy(ADDRESS);
  safety.cancel();
  await h.fire();
  assert.equal(h.value, ADDRESS, 'a cancelled clear must not fire');
});

test('a clipboard that refuses the write reports honestly and schedules nothing', async () => {
  const h = harness(false);
  const safety = createClipboardSafety(h.clipboard, h.scheduler);
  const result = await safety.copy(ADDRESS);

  assert.equal(result.copied, false);
  assert.equal(result.willClearInMs, null);
  assert.equal(h.timers.length, 0);
  assert.match(copyNotice(result), /unavailable|Share the address/i);
});

test('a clipboard that throws on read does not surface as an error', async () => {
  const h = harness();
  h.clipboard.getStringAsync = async () => { throw new Error('denied'); };
  const safety = createClipboardSafety(h.clipboard, h.scheduler);
  await safety.copy(ADDRESS);
  await assert.doesNotReject(() => h.fire());
});

test('the notice tells the user it will be cleared, and to check after pasting', () => {
  const notice = copyNotice({ copied: true, willClearInMs: CLIPBOARD_TTL_MS });
  assert.match(notice, /60 seconds/);
  assert.match(notice, /cleared/i);
  // The swap attack happens between copy and paste, so checking after pasting is the advice
  // that actually helps.
  assert.match(notice, /check it after pasting/i);
});
