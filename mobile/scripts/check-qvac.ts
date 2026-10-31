import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_RECIPIENT, initialState } from '../src/demo/model.ts';
import { intentReply, requestIntent } from '../src/services/qvac.ts';
const results = [];
for (const [prompt, expected] of [
  ['How much USDT do I have on Arbitrum?', 'balance'],
  ['Show my Arbitrum receive address', 'address'],
  ['Show my transaction history', 'history'],
  [`Please transfer 25 USDT on Arbitrum to ${DEMO_RECIPIENT}`, 'transfer'],
] as const) {
  const start = Date.now();
  const intent = await requestIntent('http://127.0.0.1:11434', 'wally-llm', prompt);
  assert.equal(intent.intent, expected, prompt);
  const reply = intentReply(intent, prompt, initialState());
  if (expected === 'transfer') assert.deepEqual(reply.draft, { amount: '25', recipient: DEMO_RECIPIENT });
  results.push({ prompt, intent, reply, elapsedMs: Date.now() - start });
  console.log(`${expected}: passed (${results.at(-1)!.elapsedMs} ms)`);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(path.join(root, 'internal/evidence'), { recursive: true });
writeFileSync(path.join(root, 'internal/evidence/qvac-smoke.json'), JSON.stringify({ checkedAt: new Date().toISOString(), model: 'Qwen3-1.7B-Q4_0', device: 'CPU', results }, null, 2));
