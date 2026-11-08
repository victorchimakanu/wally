import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addRecord, parseRecords, toRecord, type CrashRecord,
} from './crash-log.ts';

/**
 * Storing crash records on this device, and catching the crashes in the first place.
 *
 * Kept apart from `crash-log.ts` so the scrubber and the record rules stay loadable in the test
 * runner. Everything worth testing is on the other side of this file; all this does is persist
 * and subscribe.
 */

const KEY = 'wally.problem-reports.v1';

export async function readCrashes(): Promise<CrashRecord[]> {
  try { return parseRecords(JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null')); }
  catch { return []; }
}

export async function clearCrashes(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to report about the reporter */ }
}

/**
 * Record one crash.
 *
 * Swallows its own failures completely and on purpose. This runs inside a global error handler;
 * a reporter that throws turns one bug into two, and the second one has no handler left.
 */
export async function recordCrash(kind: CrashRecord['kind'], thrown: unknown, build: string): Promise<void> {
  try {
    const record = toRecord(kind, thrown, build, Date.now());
    await AsyncStorage.setItem(KEY, JSON.stringify(addRecord(await readCrashes(), record)));
  } catch { /* see above */ }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type WithErrorUtils = { ErrorUtils?: { getGlobalHandler?: () => GlobalHandler; setGlobalHandler?: (h: GlobalHandler) => void } };

/**
 * Subscribe to the two ways this app can fail without anyone noticing.
 *
 * React Native routes uncaught exceptions through `ErrorUtils`; the browser and the RN polyfill
 * both emit `unhandledrejection` for a promise nobody caught. A render crash is caught
 * separately by the error boundary, which calls `recordCrash` itself.
 *
 * **The previous handler is always called.** Replacing it would mean this code decides whether
 * the app shows a red screen in development or dies quietly in production, which is not its
 * decision to make — it is here to write things down, not to change what happens.
 *
 * Returns a teardown, and is safe to call twice.
 */
export function installCrashHandlers(build: string): () => void {
  const scope = globalThis as unknown as WithErrorUtils;
  const utils = scope.ErrorUtils;
  let restore: (() => void) | null = null;

  if (utils?.setGlobalHandler) {
    const previous = utils.getGlobalHandler?.();
    utils.setGlobalHandler((error, isFatal) => {
      void recordCrash('error', error, build);
      previous?.(error, isFatal);
    });
    restore = () => { if (previous) utils.setGlobalHandler?.(previous); };
  }

  const onRejection = (event: unknown) => {
    const reason = (event as { reason?: unknown })?.reason ?? event;
    void recordCrash('rejection', reason, build);
  };
  const target = globalThis as unknown as { addEventListener?: (t: string, h: (e: unknown) => void) => void; removeEventListener?: (t: string, h: (e: unknown) => void) => void };
  target.addEventListener?.('unhandledrejection', onRejection);

  return () => {
    restore?.();
    target.removeEventListener?.('unhandledrejection', onRejection);
  };
}
