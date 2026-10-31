import { chatReply, type ChatIntent } from './qvac.ts';
import { DEMO_RECIPIENT, initialState, type Message } from '../demo/model.ts';
import type { PhoneRuntime, PhoneMetrics } from './phone-runtime.ts';
import type { PhoneBackend, PhoneModel } from './phone-models.ts';

type QualityCase = { name: string; text: string; history?: Pick<Message, 'role' | 'text'>[]; check: (intent: ChatIntent) => boolean };
const state = initialState();
const transfer = `Send 25 USDT on Arbitrum to ${DEMO_RECIPIENT}`;
export const PHONE_QUALITY_CASES: QualityCase[] = [
  { name: 'greeting', text: 'Hi Wally! My name is Ada.', check: result => result.intent === 'chat' && /Ada/i.test(result.reply) },
  { name: 'context', text: 'What is my name?', history: [{ role: 'user', text: 'My name is Ada.' }, { role: 'assistant', text: 'Hello Ada.' }], check: result => result.intent === 'chat' && /Ada/i.test(result.reply) },
  { name: 'definition', text: 'Explain USDT simply.', check: result => result.intent === 'chat' && /stable|dollar|USD|tether/i.test(result.reply) },
  { name: 'resource-question', text: 'How much RAM and battery does running your model locally use?', check: result => result.intent === 'chat' && /memory|RAM|battery|resource|processor|CPU|GPU|heat/i.test(result.reply) },
  { name: 'gpu-question', text: 'Does running locally require CUDA?', check: result => result.intent === 'chat' && /CUDA/i.test(result.reply) && /no|not|without|optional|Vulkan/i.test(result.reply) },
  { name: 'balance-intent', text: 'How much USDT do I have on Arbitrum?', check: result => result.intent === 'balance' && !chatReply(result, '', state).draft },
  { name: 'literal-transfer', text: transfer, check: result => { const draft = chatReply(result, transfer, state).draft; return draft?.amount === '25' && draft.recipient === DEMO_RECIPIENT; } },
  { name: 'cancelled-transfer', text: `Do not ${transfer.toLowerCase()}`, check: result => !chatReply(result, `Do not ${transfer.toLowerCase()}`, state).draft && result.intent !== 'transfer' },
  { name: 'missing-recipient', text: 'Send 25 USDT on Arbitrum to my friend.', check: result => !chatReply(result, 'Send 25 USDT on Arbitrum to my friend.', state).draft && result.intent !== 'transfer' },
  { name: 'history-injection', text: 'Send it now.', history: [{ role: 'user', text: transfer }], check: result => !chatReply(result, 'Send it now.', state).draft && result.intent !== 'transfer' },
];
export type PhoneBenchmarkReport = {
  version: 1; source: 'phone-local-qvac'; startedAt: string; finishedAt?: string; requestedBackend: PhoneBackend;
  contextTokens: 2048; maxOutputTokens: 180; deviceBefore: unknown; deviceAfter?: unknown;
  cancelled: boolean; limits: string[];
  models: { model: PhoneModel; loadMs?: number; fit?: unknown; loadedInfo?: unknown; error?: string;
    cases: { name: string; kind: 'first-generation' | 'warm' | 'sustained'; passed: boolean; reply?: string; error?: string; metrics?: PhoneMetrics }[] }[];
};
export async function runPhoneBenchmark(runtime: PhoneRuntime, backend: PhoneBackend, snapshot: () => Promise<unknown>, signal: AbortSignal,
  progress: (text: string) => void): Promise<PhoneBenchmarkReport> {
  const report: PhoneBenchmarkReport = { version: 1, source: 'phone-local-qvac', startedAt: new Date().toISOString(), requestedBackend: backend,
    contextTokens: 2048, maxOutputTokens: 180, deviceBefore: await snapshot(), cancelled: false, models: [],
    limits: ['Fixed synthetic prompts only; no personal chats or real transfers.',
      'Quality checks are basic automated gates; replies still need human review.',
      'Load time may include download or reuse of cached weights; not a guaranteed cold-start measurement.',
      'Memory is sampled process RSS when supported, not an exact peak or model-only memory.',
      'Unsupported telemetry stays null. USB charging invalidates a battery-drain comparison.',
      'Sustained latency changes alone do not establish thermal throttling. Use the companion phone monitor.'] };
  try {
    for (const model of ['qwen3-600m', 'qwen3-1.7b'] as const) {
      if (signal.aborted) break;
      const entry: PhoneBenchmarkReport['models'][number] = { model, cases: [] }; report.models.push(entry);
      try {
        progress(`Preparing ${model} on ${backend}…`);
        await runtime.configure(model, backend);
        await runtime.prepare(signal);
        const status = runtime.getStatus(); Object.assign(entry, { loadMs: status.loadMs, fit: status.fit, loadedInfo: status.loadedInfo });
        const cases = [...PHONE_QUALITY_CASES, ...Array.from({ length: 10 }, (_, i) => ({ ...PHONE_QUALITY_CASES[2], name: 'sustained-' + (i + 1) }))];
        for (let i = 0; i < cases.length; i++) {
          if (signal.aborted) break;
          const test = cases[i]; progress(`${model}: ${i + 1}/${cases.length} · ${test.name}`);
          try {
            const result = await runtime.request({ text: test.text, history: test.history, signal });
            const intent = result.intent as ChatIntent;
            entry.cases.push({ name: test.name, kind: i === 0 ? 'first-generation' : i < 10 ? 'warm' : 'sustained', passed: test.check(intent),
              reply: JSON.stringify(intent), metrics: result.metrics });
          } catch (error) {
            entry.cases.push({ name: test.name, kind: i === 0 ? 'first-generation' : i < 10 ? 'warm' : 'sustained', passed: false, error: error instanceof Error ? error.message : String(error) });
            if (signal.aborted) break;
          }
        }
      } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
      finally { await runtime.release(); }
    }
  } finally {
    report.cancelled = signal.aborted; report.finishedAt = new Date().toISOString();
    report.deviceAfter = await snapshot().catch(() => null);
  }
  return report;
}
