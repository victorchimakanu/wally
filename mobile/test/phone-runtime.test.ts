import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhoneRuntime, type PhoneEngine } from '../src/services/phone-runtime.ts';
import { checkPhone } from '../scripts/phone-tools.mjs';

const reply = JSON.stringify({ intent: 'chat', reply: 'Hello Ada.', chain: 'unknown', token: 'unknown', amount: '', recipient: '' });
function fakeEngine(overrides: Partial<PhoneEngine> = {}) {
  const calls: string[] = [];
  const engine: PhoneEngine = {
    async fit() { calls.push('fit'); return { verdict: 'unknown' }; },
    load() { calls.push('load'); return Object.assign(Promise.resolve('model'), { requestId: 'load-request' }); },
    complete() { calls.push('complete'); return { requestId: 'completion-request',
      events: (async function* () { yield { type: 'contentDelta', text: reply }; yield { type: 'completionDone', stopReason: 'eos' }; })(),
      final: Promise.resolve({ contentText: reply, stopReason: 'eos', stats: { backendDevice: 'cpu' } }) }; },
    async cancel(id) { calls.push('cancel:' + id); }, async unload(id) { calls.push('unload:' + id); },
    async sample() { return { processBytes: null, raw: null }; }, async info() { return {}; },
    async suspend() { calls.push('suspend'); }, async resume() { calls.push('resume'); }, ...overrides,
  };
  return { engine, calls };
}
test('Android 10, emulators and non-ARM64 devices fail the documented compatibility gate', () => {
  const target = { androidApi: 31, physical: true, architectures: ['arm64-v8a'], memoryBytes: 6 * 1024 ** 3 };
  assert.equal(checkPhone(target).supported, true);
  for (const patch of [{ androidApi: 29 }, { physical: false }, { architectures: ['x86_64'] }]) assert.equal(checkPhone({ ...target, ...patch }).supported, false);
});
test('phone setup is explicit, unknown fit is advisory, and actual backend does not follow the requested label', async t => {
  const { engine, calls } = fakeEngine(); const runtime = createPhoneRuntime(engine); t.after(() => runtime.release());
  await assert.rejects(runtime.request({ text: 'Hello' }), /Set up/);
  await runtime.configure('qwen3-600m', 'gpu'); await runtime.prepare();
  const result = await runtime.request({ text: 'Hello Ada' });
  assert.equal(result.metrics.requestedBackend, 'gpu'); assert.equal(result.metrics.actualBackend, 'cpu');
  assert.equal(result.metrics.sampledPeakProcessBytes, null);
  assert.equal(result.intent.intent, 'chat'); assert.equal(calls.filter(call => call === 'load').length, 1);
});
test('a too-large model is blocked before downloading or loading', async t => {
  const { engine, calls } = fakeEngine({ async fit() { return { verdict: 'likely-too-large' }; } });
  const runtime = createPhoneRuntime(engine); t.after(() => runtime.release());
  await assert.rejects(runtime.prepare(), /memory budget/); assert.ok(!calls.includes('load'));
});
test('incomplete native output cannot become a wallet response', async t => {
  for (const stopReason of ['length', 'cancelled']) {
    const { engine } = fakeEngine({ complete() { return { requestId: 'bad',
      events: (async function* () { yield { type: 'contentDelta', text: reply }; yield { type: 'completionDone', stopReason }; })(),
      final: Promise.resolve({ contentText: reply, stopReason }) }; } });
    const runtime = createPhoneRuntime(engine); t.after(() => runtime.release()); await runtime.prepare();
    await assert.rejects(runtime.request({ text: 'Hello' }), /complete/);
  }
});
test('backgrounding cancels an in-flight native load and unloads a late result', async t => {
  let finishLoad!: (id: string) => void;
  const { engine, calls } = fakeEngine({ load() { return Object.assign(new Promise<string>(resolve => { finishLoad = resolve; }), { requestId: 'pending-load' }); } });
  const runtime = createPhoneRuntime(engine); t.after(() => runtime.release());
  const preparing = runtime.prepare(); const rejected = assert.rejects(preparing, { name: 'AbortError' });
  while (!finishLoad) await new Promise(resolve => setImmediate(resolve));
  const backgrounded = runtime.setBackground(true); finishLoad('late-model'); await rejected; await backgrounded;
  assert.ok(calls.includes('cancel:pending-load')); assert.ok(calls.includes('unload:late-model')); assert.ok(calls.includes('suspend'));
  await assert.rejects(runtime.prepare(), /Return to Wally/);
});
test('parallel inference is rejected and a pre-cancelled request never reaches native generation', async t => {
  const { engine, calls } = fakeEngine(); const runtime = createPhoneRuntime(engine); t.after(() => runtime.release()); await runtime.prepare();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.request({ text: 'Hello', signal: controller.signal }), { name: 'AbortError' });
  assert.ok(!calls.includes('complete'));
  const first = runtime.request({ text: 'Hello' });
  await assert.rejects(runtime.request({ text: 'Second' }), /Wait for/); await first;
});
test('a failed unload retains the model handle and prevents loading a second model', async t => {
  let failUnload = true;
  const { engine, calls } = fakeEngine({ async unload(id) { calls.push('unload:' + id); if (failUnload) throw new Error('native unload failed'); } });
  const runtime = createPhoneRuntime(engine); t.after(() => runtime.release()); await runtime.prepare();
  await assert.rejects(runtime.configure('qwen3-1.7b', 'cpu'), /unload failed/);
  assert.equal(runtime.getStatus().model, 'qwen3-600m'); assert.equal(runtime.getStatus().phase, 'error');
  assert.equal(calls.filter(call => call === 'load').length, 1);
  failUnload = false; await runtime.release();
  assert.equal(calls.filter(call => call === 'unload:model').length, 2);
});
