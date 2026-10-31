import { CHAT_PROMPT, TESTNET_CHAT_PROMPT, CHAT_SCHEMA, SYSTEM_PROMPT, INTENT_SCHEMA, parseChat, parseIntent, partialChatReply, recentContext, type ChatIntent, type WalletIntent } from './qvac.ts';
import type { Message } from '../demo/model.ts';
import type { PhoneBackend, PhoneModel } from './phone-models.ts';

export type PhoneMetrics = {
  model: PhoneModel; requestedBackend: PhoneBackend; actualBackend: string | null;
  firstTokenMs: number | null; firstReplyMs: number | null; totalMs: number;
  sampledPeakProcessBytes: number | null; samples: number; stats?: unknown;
};
export type PhoneStatus = {
  model: PhoneModel; backend: PhoneBackend; phase: 'idle' | 'checking' | 'loading' | 'ready' | 'working' | 'error';
  progress: number | null; error: string; fit?: unknown; loadMs?: number; loadedInfo?: unknown;
};
export type PhoneInput = {
  walletMode?: 'testnet';
  text: string; history?: Pick<Message, 'role' | 'text'>[]; intentOnly?: boolean;
  signal?: AbortSignal; onReply?: (text: string) => void;
};
type NativeEvent = { type: string; text?: string; stopReason?: string; error?: { message: string } };
type NativeFinal = { contentText: string; stopReason?: string; stats?: { backendDevice?: string } };
export type PhoneEngine = {
  fit: (model: PhoneModel, backend: PhoneBackend) => Promise<{ verdict: string; [key: string]: unknown }>;
  load: (model: PhoneModel, backend: PhoneBackend, progress: (percentage: number) => void) => Promise<string> & { requestId: string };
  complete: (modelId: string, input: { history: { role: string; content: string }[]; schema: object }) => {
    requestId: string; events: AsyncIterable<NativeEvent>; final: Promise<NativeFinal>;
  };
  cancel: (requestId: string) => Promise<void>;
  unload: (modelId: string) => Promise<void>;
  sample: () => Promise<{ processBytes: number | null; raw: unknown }>;
  info: (modelId: string) => Promise<unknown>;
  suspend: () => Promise<void>; resume: () => Promise<void>;
};
function aborted() { const error = new Error('Phone AI request cancelled.'); error.name = 'AbortError'; return error; }

/** One resident model and one operation; all cancellation reaches the native worker. */
export function createPhoneRuntime(engine: PhoneEngine, onStatus: (state: PhoneStatus) => void = () => {}) {
  let status: PhoneStatus = { model: 'qwen3-600m', backend: 'cpu', phase: 'idle', progress: null, error: '' };
  let modelId: string | null = null, enabled = false, background = false;
  let active: { controller: AbortController; requestId?: string; done: Promise<void> } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let releasing: Promise<void> | null = null;
  const notify = (patch: Partial<PhoneStatus>) => { status = { ...status, ...patch }; onStatus(status); };
  const check = (signal: AbortSignal) => { if (signal.aborted || background) throw aborted(); };
  function cancel() { active?.controller.abort(); }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void release().catch(() => {}); }, 120_000);
  }
  async function release() {
    clearTimeout(idleTimer);
    if (releasing) return releasing;
    releasing = (async () => {
      cancel();
      await active?.done;
      const loaded = modelId;
      if (loaded) await engine.unload(loaded);
      modelId = null;
      await engine.suspend();
      notify({ phase: 'idle', progress: null });
    })();
    try { await releasing; }
    catch (error) { notify({ phase: 'error', error: 'Could not release model memory. Retry release before switching models.' }); throw error; }
    finally { releasing = null; }
  }
  async function exclusive<T>(work: (signal: AbortSignal, setRequest: (id: string) => void) => Promise<T>, signal?: AbortSignal, timeoutMs = 90_000): Promise<T> {
    if (active || releasing) throw new Error('Wait for the current phone AI operation to finish.');
    if (background) throw new Error('Return to Wally before running phone AI.');
    clearTimeout(idleTimer);
    const controller = new AbortController();
    let finish!: () => void;
    const pending = { controller, requestId: undefined as string | undefined, done: new Promise<void>(resolve => { finish = resolve; }) };
    active = pending;
    const abort = () => controller.abort();
    const cancelNative = () => { if (pending.requestId) void engine.cancel(pending.requestId).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', cancelNative);
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, timeoutMs);
    try {
      check(controller.signal);
      return await work(controller.signal, requestId => { pending.requestId = requestId; if (controller.signal.aborted) cancelNative(); });
    } catch (error) {
      notify({ phase: controller.signal.aborted ? 'idle' : 'error', error: controller.signal.aborted ? '' : error instanceof Error ? error.message : 'Phone AI failed.', progress: null });
      throw error;
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancelNative);
      active = null; finish();
      if (modelId && !background) armIdle();
    }
  }
  async function ensureModel(signal: AbortSignal, setRequest: (id: string) => void) {
    if (modelId) return modelId;
    await engine.resume(); check(signal);
    notify({ phase: 'checking', error: '', progress: null });
    const fit = await engine.fit(status.model, status.backend); check(signal);
    notify({ fit });
    if (fit.verdict === 'likely-too-large') throw new Error('This model exceeds the available memory budget. Try the smaller model or close other apps.');
    // Unknown is advisory, never displayed as a guaranteed fit.
    notify({ phase: 'loading' });
    const start = performance.now();
    const load = engine.load(status.model, status.backend, progress => { if (!signal.aborted) notify({ progress: Math.round(progress) }); });
    setRequest(load.requestId);
    const loaded = await load;
    modelId = loaded;
    if (signal.aborted || background) { await engine.unload(loaded); modelId = null; throw aborted(); }
    const loadedInfo = await engine.info(loaded); check(signal);
    notify({ phase: 'ready', progress: null, loadMs: Math.round(performance.now() - start), loadedInfo });
    return loaded;
  }
  return {
    getStatus: () => status,
    cancel, release,
    async configure(model: PhoneModel, backend: PhoneBackend) {
      await release(); enabled = false;
      status = { model, backend, phase: 'idle', progress: null, error: '' }; onStatus(status);
    },
    async setBackground(value: boolean) {
      background = value;
      if (value) await release();
      else { await releasing; await engine.resume(); }
    },
    async prepare(signal?: AbortSignal) {
      enabled = true;
      return exclusive((localSignal, setRequest) => ensureModel(localSignal, setRequest), signal, 15 * 60_000);
    },
    async request(input: PhoneInput): Promise<{ intent: ChatIntent | WalletIntent; metrics: PhoneMetrics }> {
      if (!enabled) throw new Error('Set up the phone model in Settings → Local model first.');
      return exclusive(async (signal, setRequest) => {
        const loaded = await ensureModel(signal, setRequest); check(signal);
        notify({ phase: 'working', error: '' });
        const start = performance.now();
        let firstTokenMs: number | null = null, firstReplyMs: number | null = null;
        let sampledPeakProcessBytes: number | null = null, samples = 0, content = '', preview = '';
        let sampling: Promise<void> | null = null;
        function sample(): Promise<void> {
          if (sampling) return sampling;
          sampling = (async () => {
            try { const value = await engine.sample(); samples++; if (value.processBytes !== null) sampledPeakProcessBytes = Math.max(sampledPeakProcessBytes ?? 0, value.processBytes); } catch { /* Report unavailable, never zero. */ }
          })().finally(() => { sampling = null; });
          return sampling;
        }
        await sample(); check(signal);
        const sampleTimer = setInterval(() => { void sample(); }, 1000);
        let run: ReturnType<PhoneEngine['complete']> | undefined;
        try {
          run = engine.complete(loaded, {
            history: [{ role: 'system', content: input.intentOnly ? SYSTEM_PROMPT : input.walletMode === 'testnet' ? TESTNET_CHAT_PROMPT : CHAT_PROMPT }, ...recentContext(input.history ?? []), { role: 'user', content: input.text.slice(0, 1000) }],
            schema: input.intentOnly ? INTENT_SCHEMA : CHAT_SCHEMA,
          });
          // Attach immediately: cancellation can reject final before events finish.
          const finalPromise = run.final; void finalPromise.catch(() => {});
          setRequest(run.requestId);
          let finished = false;
          for await (const event of run.events) {
            check(signal);
            if (event.type === 'completionDone') {
              if (event.error || ['length', 'cancelled', 'error'].includes(event.stopReason ?? '')) throw new Error('Phone model did not finish a complete response.');
              finished = true;
            }
            if (event.type !== 'contentDelta' || !event.text) continue;
            firstTokenMs ??= Math.round(performance.now() - start);
            content += event.text;
            if (content.length > 4000) throw new Error('Phone model response exceeded its limit.');
            const next = partialChatReply(content);
            if (next && next !== preview) { firstReplyMs ??= Math.round(performance.now() - start); preview = next; input.onReply?.(preview); }
          }
          const final = await finalPromise; check(signal);
          if (!finished || ['length', 'cancelled'].includes(final.stopReason ?? '')) throw new Error('Phone model response was incomplete.');
          const intent = input.intentOnly ? parseIntent(final.contentText) : parseChat(final.contentText);
          await sample(); check(signal);
          const metrics: PhoneMetrics = { model: status.model, requestedBackend: status.backend, actualBackend: final.stats?.backendDevice ?? null,
            firstTokenMs, firstReplyMs, totalMs: Math.round(performance.now() - start), sampledPeakProcessBytes, samples, stats: final.stats };
          notify({ phase: 'ready' }); return { intent, metrics };
        } catch (error) { if (run) await engine.cancel(run.requestId).catch(() => {}); throw error; }
        finally { clearInterval(sampleTimer); await sampling; }
      }, input.signal);
    },
  };
}
export type PhoneRuntime = ReturnType<typeof createPhoneRuntime>;
