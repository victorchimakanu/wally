import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestChat, CHAT_PROMPT, quickWalletReply } from '../src/services/qvac.ts';
import { initialState } from '../src/demo/model.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const label = process.argv[2] ?? 'current';
if (!/^[a-z-]+$/.test(label)) throw new Error('Use a simple benchmark label.');
const results = [], history = [];
let error;
try {
  for (const prompt of ['Hi Wally! My name is Ada.', 'What is my name?', 'Explain USDT simply.']) {
    const start = performance.now();
    let firstReplyMs, updates = 0;
    const result = await requestChat('http://127.0.0.1:11434', 'wally-llm', prompt, history, undefined, {
      onReply(text) { if (text && firstReplyMs === undefined) firstReplyMs = performance.now() - start; updates++; },
    });
    const totalMs = performance.now() - start;
    assert.equal(result.intent, 'chat');
    if (prompt === 'What is my name?') assert.match(result.reply, /Ada/i);
    results.push({ prompt, firstReplyMs: Math.round(firstReplyMs ?? totalMs), totalMs: Math.round(totalMs), updates, reply: result.reply });
    console.log(JSON.stringify(results.at(-1)));
    history.push({ role: 'user', text: prompt }, { role: 'assistant', text: result.reply });
  }
} catch (failure) { error = failure.message; process.exitCode = 1; console.error(error); }
const state = initialState();
const startRead = performance.now();
for (let i = 0; i < 100; i++) assert.ok(quickWalletReply('What is my balance?', state));
const averageReadMs = (performance.now() - startRead) / 100;
const evidence = path.join(root, 'internal/evidence');
mkdirSync(evidence, { recursive: true });
writeFileSync(path.join(evidence, 'qvac-speed-' + label + '.json'), JSON.stringify({ checkedAt: new Date().toISOString(), model: 'Qwen3-1.7B-Q4_0', backend: label.includes('vulkan') ? 'Vulkan GPU (confirm in server logs)' : 'CPU', promptChars: CHAT_PROMPT.length, averageWalletReadMs: averageReadMs, results, error }, null, 2));

