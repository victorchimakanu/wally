import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhoneBenchmark, PHONE_QUALITY_CASES } from '../src/services/phone-benchmark.ts';
import type { PhoneRuntime } from '../src/services/phone-runtime.ts';

test('comparison preserves failed answers and unsupported telemetry instead of reporting invented success', async () => {
  const configured: string[] = [];
  let model = 'qwen3-600m' as 'qwen3-600m' | 'qwen3-1.7b', released = 0;
  const runtime = {
    async configure(value: typeof model) { model = value; configured.push(value); },
    async prepare() { return 'loaded'; },
    getStatus() { return { model, backend: 'gpu', phase: 'ready', progress: null, error: '', fit: { verdict: 'unknown' } }; },
    async request() { return { intent: { intent: 'chat', reply: 'I can help you manage crypto.', chain: 'unknown', token: 'unknown', amount: '', recipient: '' },
      metrics: { model, requestedBackend: 'gpu', actualBackend: 'cpu', firstTokenMs: 1, firstReplyMs: 2, totalMs: 3, sampledPeakProcessBytes: null, samples: 2 } }; },
    async release() { released++; },
  } as unknown as PhoneRuntime;
  const report = await runPhoneBenchmark(runtime, 'gpu', async () => ({ physicalDevice: true, charging: true }), new AbortController().signal, () => {});
  assert.deepEqual(configured, ['qwen3-600m', 'qwen3-1.7b']); assert.equal(released, 2);
  for (const entry of report.models) {
    assert.equal(entry.cases.length, 20);
    assert.equal(entry.cases.find(item => item.name === 'resource-question')?.passed, false);
    assert.equal(entry.cases[0].metrics?.actualBackend, 'cpu');
    assert.equal(entry.cases[0].metrics?.sampledPeakProcessBytes, null);
  }
  assert.equal(report.source, 'phone-local-qvac'); assert.equal(report.cancelled, false);
});
test('comparison cancellation stops before downloading either model', async () => {
  let configured = false;
  const runtime = { async configure() { configured = true; } } as unknown as PhoneRuntime;
  const controller = new AbortController(); controller.abort();
  const report = await runPhoneBenchmark(runtime, 'cpu', async () => ({}), controller.signal, () => {});
  assert.equal(configured, false); assert.equal(report.cancelled, true); assert.deepEqual(report.models, []);
});
test('quality gate catches the repeated capability answer in the supplied screenshot', () => {
  const sample = { intent: 'chat', reply: 'I can help you manage crypto, check balances, and transfer funds.', chain: 'unknown', token: 'unknown', amount: '', recipient: '' } as const;
  assert.equal(PHONE_QUALITY_CASES.find(test => test.name === 'resource-question')!.check(sample), false);
});
