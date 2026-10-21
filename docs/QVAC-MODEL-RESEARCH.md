# QVAC Model Selection for Wally

Research against **Wally V1 Feature Spec and V2 Direction** (drafted 28 Sep 2026).
Compiled 6 Oct 2026.

---

## How this was researched

Everything below is checked against a source, and anything unconfirmed is labelled
**UNVERIFIED** rather than asserted. Per the team's "verified stack only" rule.

| Source | What it gave |
|---|---|
| `@qvac/sdk` **0.19.1** (installed, via `@qvac/cli` 0.13.1) | The SDK catalog, queried directly in Node: **411 entries carrying a size**, 725 exports total |
| `huggingface.co/qvac` | Tether's own published models — 28 repositories |
| `qvac.tether.io/products/models` | Official Psy family descriptions |
| Individual Hugging Face model cards | Sizes, language lists, stated limitations |
| Local benchmark, 16 Sep 2026 | Measured latency and correctness of Qwen3-0.6B through Wally's real pipeline |

Two documentation pages returned 404 (`/models/`, `/models/catalog/`), so the installed
SDK was used as the authority for what exists rather than the docs site.

### "Official QVAC model" means two different things

This distinction matters and the spec blurs it.

1. **Published by Tether** under the `qvac` Hugging Face org — 28 repos, all of them
   Psy-family: Genesis, TranslatePsy, VisionPsy, MedPsy, fabric-llm-finetune.
   **Tether publishes no speech, TTS or OCR models.**
2. **In the QVAC SDK catalog** — 411 sized entries, mostly curated third-party models
   (Qwen, Llama, Whisper, NVIDIA Parakeet, Supertonic, Chatterbox, Gemma). These are
   downloadable by constant name with a bundled checksum.

The two sets barely overlap. Most of what Wally needs comes from set 2.

### What the catalog actually contains

| Addon type | Entries | Relevant to Wally |
|---|---|---|
| `llm` | 120 | **Yes** — chat, intent parsing, vision-language |
| `tts` | 57 | **Yes** — V2 voice out |
| `whisper` | 43 | **Yes** — V2 voice in |
| `parakeet` | 21 | **Yes** — V2 voice in, end-of-utterance |
| `nmt` | 114 | No — Bergamot, no African languages (see below) |
| `embeddings` | 7 | Maybe — V2 spending insights |
| `ocr` | 4 | **Yes** — V2·B bill reading |
| `diffusion`, `audiogen`, `vla`, `bci` | 45 | No |

---

## Part 1 — Which features actually need a model

Most of V1 is code, not AI. Mapping every feature in the spec:

| Feature | Needs a model? | Model class |
|---|---|---|
| F1 Create a wallet | No | — |
| F2 Restore a wallet | No | — |
| F3 Lock the app | No | — |
| F4 See balances | No | — |
| F5 Receive | No | — |
| F6 Send USDt with buttons | **No — explicitly** | — |
| F7 Scan a QR code | No | Camera + decoder |
| F8 Address book | No — "names resolved from saved data by code" | — |
| F9 Fees on both chains | No | — |
| F10 History | No | — |
| **F11 Chat with the wallet** | **Yes** | Text LLM, schema-constrained JSON |
| F12 Get the model onto the phone | n/a — this *is* the download | — |
| F13 Work with AI switched off | **No, by design** | — |
| F14 Testnet/mainnet, caps | No | — |
| F15 Guards | No | — |
| F16 Settings | No | — |
| V2·A Swaps | Reuses F11 | Same text LLM |
| **V2·B Errands — read a bill photo** | **Yes** | Vision-language or OCR |
| **V2·C Money in your own language** | **Yes** | African-language translation |
| V2 Voice in and out (roadmap) | **Yes** | STT + TTS |
| V2 Spending insights (roadmap) | Probably reuses F11 | Text LLM, optionally embeddings |
| V3 On-device personalization | Yes — LoRA adapter on the main model | — |

**V1 needs exactly one model.** Sixteen features, one of which is AI. That is worth
holding on to: the model is a layer on a wallet that already works, exactly as the
spec's eight-step diagram says.

---

## Part 2 — Feature-by-feature model comparison

### F11 · Chat with the wallet (the only V1 model)

The job: turn a sentence into a validated JSON instruction. Short output, strict schema,
no long-form generation.

| Catalog constant | Size | Notes |
|---|---|---|
| `SMOLLM2_360M_INST_Q8` | 0.39 GB | Smallest instruct model. Schema reliability **UNVERIFIED** |
| **`QWEN3_600M_INST_Q4`** | **0.38 GB** | **Benchmarked — see below** |
| `LLAMA_3_2_1B_INST_Q4_0` | 0.77 GB | |
| `LLAMA_TOOL_CALLING_1B_INST_Q4_K` | 0.81 GB | Fine-tuned for structured output. Community model (`mav23`), not Tether |
| `BITNET_1B_INST_TQ2_0` | 0.83 GB | Ternary. Quality **UNVERIFIED** |
| `QWEN3_1_7B_INST_Q4` | 1.06 GB | |
| `QWEN3_4B_INST_Q4_K_M` | 2.50 GB | Too heavy for budget phones |
| `QWEN3_8B_INST_Q4_K_M` | 5.03 GB | Server only |

**Measured, 16 Sep 2026** — Qwen3-0.6B through Wally's *real* pipeline (parse → recipient
substitution → amount gate → `classify()`), not raw model output:

- **20/20 correct** across transfer, European-decimal amount, and balance cases
- 14–46 s per parse on an 8-core 2012 CPU with no AVX2 and no GPU
- Qwen3-4B on the same machine: **>300 s, never completed**
- It truncated the recipient address in ~30% of runs — and this was **harmless**, because
  `agent/index.ts:119-125` takes the address from the user's literal text and discards the
  model's. The measured failure was absorbed by the architecture.

One prompt change was required and is already shipped: an explicit dot-decimal rule, which
took European-format amounts from 0/2 to 6/6.

### V2·B · Reading a bill photo

Two approaches, with very different costs:

| Approach | Constants | Total size |
|---|---|---|
| **Vision-language (Tether's own)** | `VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M` 0.30 GB + `MMPROJ_…_Q8_0` 0.11 GB | **0.41 GB** |
| Vision-language (generic) | `OCR_0_6B_MULTIMODAL_Q4_K_M` 0.40 GB + `MMPROJ_OCR_0_6B_…_F16` 0.82 GB | 1.22 GB |
| Vision-language (larger) | `OCR_3B_MULTIMODAL_Q4_0` 1.70 GB + mmproj 0.46 GB | 2.16 GB |
| Classic OCR pipeline | `OCR_CRAFT` 0.08 GB + `OCR_LATIN` 0.02 GB + `OCR_DOCTR` | **~0.10 GB** |

**VisionPsy-Nano-460M is the right choice**, and it is Tether's own. The product page says
it is built for on-device mobile and runs "25 times faster" on smartphones using as few as
64 visual tokens. Its model card confirms scene-text reading and reports OCRBench results.
Note the vision projector is mandatory — budget both files.

The classic OCR pipeline is ten times smaller but only *extracts* text. It cannot answer
"which number is the total". For a bill, that semantic step is the whole feature.

Both carry a caveat the spec should absorb: VisionPsy "may occasionally hallucinate or
miscount" and is "best suited to focused tasks rather than very dense documents". The spec
already handles this correctly by showing the extracted account number and total back for
checking before anything moves.

### V2·C · Money in your own language

| Model | Size | In SDK catalog? | Base |
|---|---|---|---|
| TranslatePsy-AfriSLM-0.8B-Q4 | **0.67 GB** (672 MB) | **No** | Qwen3.5-0.8B |
| TranslatePsy-AfriSLM-2B-Q4 | **1.56 GB** | **No** | Qwen3.5-2B |
| `AFRICAN_4B_TRANSLATION_Q4_K_M` | **2.87 GB** | Yes | AfriqueGemma-4B |
| Bergamot (`nmt`, 102 pairs) | 13–44 MB each | Yes | **No African languages** |

The spec's three sizes are all **correct**. Two other things in that table are not — see
Corrections below.

Language coverage is good: AfriSLM 0.8B and 2B both support **20 languages** — English plus
Afrikaans, Amharic, Hausa, Igbo, Kinyarwanda, Lingala, Luganda, Malagasy, Nyanja, Oromo,
Shona, Somali, Southern Sotho, Swahili, Tswana, Wolof, Xhosa, Yoruba and Zulu. All four
languages the spec names are covered.

Bergamot looked like a cheap alternative at 13–44 MB per pair. It is not an option: I
checked all 102 pairs and **none** covers an African language.

### V2 · Voice

| Role | Best option | Size |
|---|---|---|
| Speech to text | `WHISPER_BASE_Q8_0` | **0.08 GB** |
| …or higher accuracy | `WHISPER_SMALL_Q8_0` | 0.26 GB |
| …or NVIDIA alternative | `PARAKEET_TDT_0_6B_V3_Q4_0` | 0.40 GB |
| End-of-utterance detection | `PARAKEET_EOU_120M_V1_Q4_0` | **0.07 GB** |
| Text to speech | `TTS_MULTILINGUAL_SUPERTONIC3_Q4_0` | **0.08 GB** |
| …English only | `TTS_EN_SUPERTONIC_Q4_0` | 0.13 GB |
| …higher quality | `TTS_T3_TURBO_EN_CHATTERBOX_Q4_0` | 0.33 GB |

Voice is far cheaper than expected: a complete loop in **0.23 GB** using Whisper Base,
Parakeet EOU and Supertonic 3.

`PARAKEET_EOU_120M_V1` is worth knowing about — it detects when the user has stopped
speaking, which is what makes a voice turn feel natural rather than cut off.

**UNVERIFIED:** whether Whisper covers Yoruba, Hausa, Igbo and Swahili at usable quality.
The spec already says "speech models do not yet cover all of them" and defers speaking in
those languages — that caution looks right, and the exact list still needs confirming.

### V2 · Spending insights

No dedicated model needed. Either reuse the chat model for categorisation, or use
`EMBEDDINGGEMMA_300M_Q4_0` (0.28 GB) for clustering. Start with the chat model.

---

## Part 3 — The recommendation

### For V1: `QWEN3_600M_INST_Q4` — 0.38 GB

1. **It is the only candidate measured against Wally's actual pipeline**, scoring 20/20.
   Every other model on the list is a guess until benchmarked.
2. **It is the smallest download that is known to work.** F12's friction scales directly
   with this number.
3. **The spec already argues for it.** V2·C states: *"room for a second model on the phone,
   which is another reason to ship V1 with the smallest main model that passes."*
4. **The architecture compensates for its weaknesses.** Its address truncation is discarded
   by code; its amount errors are caught by the echo check. A small model is defensible
   here precisely because nothing trusts it.

Second choice if 0.6B disappoints on a phone: `LLAMA_TOOL_CALLING_1B_INST_Q4_K` (0.81 GB),
trained for structured output. Third: `QWEN3_1_7B_INST_Q4` (1.06 GB).

**This recommendation is conditional on one thing that is still unmeasured: speed on a real
mid-range Android.** My numbers come from a 13-year-old laptop CPU with no AVX2 and a dead
GPU. That hardware is not a proxy for a modern phone in either direction.

### Full stack if everything eventually runs on-device

| Role | Model | Size |
|---|---|---|
| Chat (V1) | `QWEN3_600M_INST_Q4` | 0.38 GB |
| Speech in (V2) | `WHISPER_BASE_Q8_0` | 0.08 GB |
| Turn detection (V2) | `PARAKEET_EOU_120M_V1_Q4_0` | 0.07 GB |
| Speech out (V2) | `TTS_MULTILINGUAL_SUPERTONIC3_Q4_0` | 0.08 GB |
| Bill reading (V2·B) | VisionPsy-Nano-460M Q4 + projector | 0.41 GB |
| Translation (V2·C) | TranslatePsy-AfriSLM-0.8B-Q4 | 0.67 GB |
| **Total** | | **1.69 GB** |

Feasible on a mid-range phone, provided they are loaded on demand rather than all at once.
Choosing the 1.7B chat model instead would push this to 2.37 GB.

---

## Part 4 — Can a user actually download this?

### Download sizes in context

| What | Size | At 1 MB/s | At 5 MB/s |
|---|---|---|---|
| Qwen3-0.6B | 0.38 GB | ~6 min | ~1 min |
| Llama tool-calling 1B | 0.81 GB | ~13 min | ~3 min |
| Qwen3-1.7B | 1.06 GB | ~18 min | ~4 min |
| Qwen3-4B | 2.50 GB | ~42 min | ~8 min |
| Full V2 stack | 1.69 GB | ~28 min | ~6 min |

For a Nigeria-first product on mobile data, the gap between 0.38 GB and 2.50 GB is the gap
between a feature people use and one they abandon. This alone argues for the smallest model.

### Memory, which matters more than file size

A Q4 model needs roughly its file size **plus** KV cache and compute buffers. At `ctx_size`
4096 budget approximately:

| Model | File | Rough runtime RAM |
|---|---|---|
| Qwen3-0.6B | 0.38 GB | ~0.6 GB |
| Llama 1B | 0.81 GB | ~1.1 GB |
| Qwen3-1.7B | 1.06 GB | ~1.5 GB |
| Qwen3-4B | 2.50 GB | ~3.2 GB |

A 3–4 GB Android device gives an app roughly 1–1.5 GB before the OS starts killing it.
**0.6B fits comfortably, 1.7B is marginal, 4B is out.** These are estimates — confirm on
real hardware during the spike.

The SDK ships the check for this: **`assess-model-fit`**, which answers before any weights
are fetched. Its own documentation matches the spec's risk row word for word:

> `unknown` is a real answer, not an error: the evidence does not support a call either way.
> Show it as "can't say", never as "no".

It reports which evidence it used — `system-memory`, `device-memory` or `device-budget`.

### Platform notes

- **Storage location.** F12 requires the model to survive a cache clear. On Android that
  means `filesDir`, not `cacheDir`; on iOS, Application Support with the
  do-not-back-up flag set — which also satisfies "any cloud backup: never".
- **Wi-Fi default** is already specified and is right; iOS in particular is unfriendly to
  large cellular downloads.
- **Store limits apply to the app, not the model.** Downloading weights post-install is the
  normal pattern and keeps the binary small.
- **Loading path.** Catalog constants are resolved and checksum-verified by QVAC. AfriSLM is
  **not** a catalog constant, so it would load via a Hugging Face URL — attested by the Hub's
  SHA-256 rather than a bundled checksum. A real difference in integrity guarantees.

### If the model stays on the VPS

The team's current decision puts inference on a server, which changes this analysis:

- **F12 and F13 become moot for V1.** There is no download and no device memory check.
- **The size constraint disappears.** On a GPU you should run `QWEN3_4B_INST_Q4_K_M` or the
  8B — materially better intent parsing than anything above. Choosing 0.6B for a server
  would be leaving quality on the table for no reason.
- **V2·C still needs a decision.** Translation either also runs server-side, or AfriSLM runs
  on the phone and you are back to a 0.67 GB download.
- One caveat from measurement: QVAC's `parallel` setting **defaults to 1** — a single
  inference at a time. It must be raised, and the server sized, before any load arrives.

---

## Part 5 — Corrections to the spec

**1. Two of the three V2·C models are not in the SDK registry.**

The table is headed "MODEL IN THE SDK REGISTRY". I queried all 411 sized catalog entries in
SDK 0.19.1: there are **zero** matches for TranslatePsy or AfriSLM. Only the third row is a
catalog constant, and it is `AFRICAN_4B_TRANSLATION_Q4_K_M` — which resolves to
`mradermacher/AfriqueGemma-4B-GGUF`, a **third-party Gemma fine-tune, not Tether's
TranslatePsy family**. The sizes quoted are all correct; the provenance and loading path are
not what the table implies.

**2. The AfriSLM model cards explicitly disclaim financial use.**

Both the 0.8B and 2B cards state the model:

> was not designed or validated for autonomous use in medical, legal, emergency,
> immigration, **financial**, or other high-stakes contexts

and that it "may hallucinate, omit, or mistranslate content", with "high-impact translations
should always receive qualified human review". Training data is synthetic.

V2·C's premise is a user instructing a payment in Yoruba. Shipping that on a model whose
authors exclude financial use needs a deliberate answer.

**The good news is that Wally's existing architecture already contains it.** Code owns every
number and every address; the model only ever shapes text. If translation is confined to
understanding intent and rendering the confirmation screen — while the amount still has to
appear literally in what the user typed, and the recipient still comes from their own text
or the address book — then a mistranslation produces a refusal, not a wrong payment. That
boundary should be written into the V2·C design explicitly, not left implicit.

**3. A note on "the desktop app already has these".**

§04 says the safety features carry over. True for F15 — amount normalisation, checksum
validation, contract-address refusal, rate limits, injection screening and
confirm-on-chain-only all exist. **Not true for F14's per-payment and daily caps**, which do
not exist anywhere in the current codebase. Only frequency limits do.

---

## Part 6 — Still unverified

1. **Speed of any model on a real mid-range Android.** The decisive unknown. The spike
   answers it.
2. **Whisper's coverage of Yoruba, Hausa, Igbo and Swahili.** The spec's own V2·C step 4
   already calls for confirming the language list per model.
3. **Whether AfriSLM loads under QVAC's `llamacpp-completion` engine.** It is a Qwen3.5
   derivative in GGUF, so it should, but it is not a catalog entry and has not been tested.
4. **VisionPsy accuracy on Nigerian bill layouts specifically.** OCRBench is a general
   benchmark.
5. **Whether `AFRICAN_4B_TRANSLATION` (AfriqueGemma) carries the same financial disclaimer.**
   Not checked; it is a different publisher.

---

## Appendix — measured reference numbers

```
SDK catalog (0.19.1):        411 sized entries, 725 exports
  llm 120 · tts 57 · whisper 43 · parakeet 21 · nmt 114
  embeddings 7 · ocr 4 · diffusion 31 · audiogen 6 · vla 6 · bci 2

Tether-published (HF qvac):  28 repos
  Genesis · TranslatePsy · VisionPsy · MedPsy · fabric-llm-finetune
  No Tether-published speech, TTS or OCR models

Benchmark, 16 Sep 2026, i7-3615QM (2012, AVX only, no AVX2, no usable GPU):
  Qwen3-0.6B Q4_0   14–46 s/parse, 20/20 correct on the production path
  Qwen3-4B Q4_K_M   >300 s, never completed
  Address truncated by the model in ~30% of runs — discarded by code, zero impact
```
