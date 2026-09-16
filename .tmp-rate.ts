import { getAddress } from "ethers";
import { buildSystemPrompt, FEW_SHOT_EXAMPLES } from "./src/qvac/prompts.js";
import { classify } from "./src/agent/intent.js";
const A = getAddress("0x742d35cc6634c0532925a3b844bc9e7595f0beb1");
const SCHEMA = { type:"object", properties:{ intent:{type:"string",enum:["transfer","swap","bridge","balance","price","history","last_recipient","address","lend_borrow","position","unknown"]}, params:{type:"object"}, reply:{type:"string"} }, required:["intent","params","reply"], additionalProperties:false };
async function run(text: string) {
  const body = { model:"wally-llm", stream:false, max_tokens:512, reasoning_budget:false,
    messages:[{role:"system",content:buildSystemPrompt("testnet")},...FEW_SHOT_EXAMPLES,{role:"user",content:text}],
    response_format:{type:"json_schema",json_schema:{name:"wallet_intent",schema:SCHEMA,strict:true}} };
  const r = await fetch("http://127.0.0.1:11434/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const o = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  const p = (o.params ?? {}) as Record<string, unknown>;
  return { v: classify(o).intent, ok: classify(o).intent === "transfer" && String(p.to ?? "") === A, raw: JSON.stringify(p) };
}
for (const [label, text] of [["comma 12,50", `send 12,50 USDT to ${A} on arbitrum`], ["plain 10", `send 10 USDT to ${A} on arbitrum`]] as const) {
  let pass = 0; const fails: string[] = [];
  for (let i = 0; i < 10; i++) {
    try { const x = await run(text); if (x.ok) pass++; else fails.push(`${x.v} :: ${x.raw}`); }
    catch (e) { fails.push("ERROR " + (e as Error).message.slice(0, 60)); }
  }
  console.log(`${label.padEnd(12)} ${pass}/10 pass`);
  for (const f of fails) console.log(`   FAIL: ${f}`);
}
