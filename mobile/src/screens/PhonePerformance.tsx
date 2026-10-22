import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { useDemo } from '../demo/store';
import { phoneCompatibility, phoneSnapshot } from '../services/phone-adapter';
import { PHONE_MODELS, type PhoneBackend } from '../services/phone-models';
import { runPhoneBenchmark, type PhoneBenchmarkReport } from '../services/phone-benchmark';

const REPORT_KEY = 'wally.phone-benchmark.v1';
const seconds = (ms: number) => (ms / 1000).toFixed(2) + 's';
export function PhonePerformanceScreen() {
  const { ai, phone, state, getRuntime, releasePhone } = useDemo();
  const [report, setReport] = useState<PhoneBenchmarkReport | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef<AbortController | null>(null);
  const compatibility = phoneCompatibility();
  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(REPORT_KEY).then(raw => { if (alive && raw) { const value = JSON.parse(raw); if (value.version === 1 && value.source === 'phone-local-qvac' && Array.isArray(value.models)) setReport(value); } }).catch(() => {});
    const subscription = AppState.addEventListener('change', next => { if (next !== 'active') running.current?.abort(); });
    return () => { alive = false; running.current?.abort(); subscription.remove(); };
  }, []);
  useEffect(() => { if (state.aiPaused || state.offline) running.current?.abort(); }, [state.aiPaused, state.offline]);
  async function start(backend: PhoneBackend) {
    if (running.current || ai.status === 'working' || !compatibility.supported || state.aiPaused) return;
    const controller = new AbortController(); running.current = controller;
    setBusy(true);
    setError(''); setReport(null); setCopyStatus(''); setProgress('Starting phone test…');
    try {
      const runtime = await getRuntime();
      const result = await runPhoneBenchmark(runtime, backend, phoneSnapshot, controller.signal, setProgress);
      setReport(result); await AsyncStorage.setItem(REPORT_KEY, JSON.stringify(result));
      setProgress(result.cancelled ? 'Test stopped. Partial results saved.' : 'Comparison finished. Results saved on this phone.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Phone test failed.'); }
    finally { running.current = null; setBusy(false); }
  }
  return <Screen title="Phone performance" subtitle="Measure the model on this device">
    <Card><Pill>{compatibility.supported ? 'PHONE-LOCAL TEST' : 'DEVICE CHECK'}</Pill><Label>{compatibility.supported ? 'Compare the smaller and larger models using the same 40 test messages. No transfer is sent.' : compatibility.reason}</Label><Note>The first setup downloads about 382 MB + 1.06 GB. Keep Wally open. Replies, memory and backend details are saved locally.</Note></Card>
    <Button label="Compare models on phone CPU" onPress={() => { void start('cpu'); }} disabled={!compatibility.supported || busy || ai.status === 'working' || state.aiPaused || state.offline} />
    <Button label="Compare using phone GPU" secondary onPress={() => { void start('gpu'); }} disabled={!compatibility.supported || busy || ai.status === 'working' || state.aiPaused || state.offline} />
    <Note>GPU support varies by phone. Results record the backend reported by QVAC; choosing GPU does not prove it was used. For battery comparison, unplug after downloading the models.</Note>
    {!!progress && <Card><Label>{progress}</Label>{phone?.phase === 'loading' && phone.progress !== null && <Note>Model download: {phone.progress}%</Note>}{busy && <Button label="Stop test" secondary onPress={() => { running.current?.abort(); }} />}</Card>}
    {!!error && <Note error>{error}</Note>}
    {report && <>
      <Note>Recorded {report.finishedAt ?? report.startedAt}. These results belong to that device and run.</Note>
      {report.models.map(entry => {
        const measured = entry.cases.flatMap(test => test.metrics ? [test.metrics] : []);
        const first = measured.flatMap(metrics => metrics.firstReplyMs === null ? [] : [metrics.firstReplyMs]);
        const memory = measured.flatMap(metrics => metrics.sampledPeakProcessBytes === null ? [] : [metrics.sampledPeakProcessBytes]);
        const backends = [...new Set(measured.map(metrics => metrics.actualBackend ?? 'unreported'))];
        return <Card key={entry.model}><Label weight="semibold">{PHONE_MODELS[entry.model].label}</Label>
          <Label>Answer checks: {entry.cases.filter(test => test.passed).length}/{entry.cases.length}</Label>
          <Note>Requested: {report.requestedBackend} · Reported: {backends.join(', ') || 'unreported'}</Note>
          {entry.error && <Note error>{entry.error}</Note>}
          {!!first.length && <Note>Average first reply: {seconds(first.reduce((sum, value) => sum + value, 0) / first.length)}</Note>}
          {!!measured.length && <Note>Average complete reply: {seconds(measured.reduce((sum, metrics) => sum + metrics.totalMs, 0) / measured.length)}</Note>}
          <Note>Highest sampled process memory: {memory.length ? (Math.max(...memory) / 1024 ** 2).toFixed(0) + ' MB' : 'unavailable'}</Note>
          {!!entry.loadMs && <Note>Download/load: {seconds(entry.loadMs)}</Note>}
          {entry.cases.filter(test => !test.passed).map(test => <Note error key={test.name}>{test.name}: {test.error ?? 'Answer needs review'}</Note>)}
        </Card>;
      })}
      <Button label="Copy full test results" secondary onPress={() => { void Clipboard.setStringAsync(JSON.stringify(report, null, 2)).then(() => setCopyStatus('Results copied.')).catch(() => setCopyStatus('Could not copy results.')); }} />
      {!!copyStatus && <Note>{copyStatus}</Note>}
      <Note>These are basic answer checks, not a guarantee of wallet safety or production readiness. Unsupported measurements remain unavailable. USB charging affects battery readings.</Note>
    </>}
    <Button label="Release model memory" secondary disabled={busy} onPress={releasePhone} />
  </Screen>;
}
