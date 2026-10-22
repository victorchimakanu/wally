# QVAC speed and delivery — verified 7 October 2026

Wally's Android simulator now uses a warm Qwen3 1.7B Q4_0 model on this computer's GTX 1650 through Vulkan. The server remains local at 127.0.0.1:11434. CPU mode remains available. No CUDA runtime or cloud AI was added.

## Measured results

These are individual development samples on this busy computer, not controlled averages or phone benchmarks. Hardware: Intel i5-10300H, 4 physical / 8 logical cores, GTX 1650 with 4 GB VRAM.

| Message | Before: complete answer on CPU | Warm Vulkan: first visible reply | Warm Vulkan: complete answer |
| --- | ---: | ---: | ---: |
| Hi Wally! My name is Ada. | 14.16 s | 0.72 s | 1.74 s |
| What is my name? | 32.59 s | 0.56 s | 1.28 s |
| Explain USDT simply. | 47.08 s | 0.77 s | 3.94 s |

The first Vulkan request after model loading took 18.67 seconds, before the warm results above. Model loading itself also took minutes on this host. Keep the model/server running to avoid paying startup and warm-up again.

Shortening the prompt alone did not consistently make CPU completion faster: the final CPU samples were 29.92, 28.59 and 64.66 seconds, under variable host load. Streaming still exposed the explanation after 20.15 seconds instead of waiting for its 64.66-second completion. The substantial warm generation gain came from GPU offloading.

The benchmark preserves both first-reply and total-response times, plus the returned text. Results are under ignored internal/evidence/qvac-speed-baseline.json, qvac-speed-optimized.json, qvac-speed-vulkan.json and qvac-speed-vulkan-warm.json. Server logs confirmed backend=gpu for accelerated requests; the installed Windows QVAC backend is Vulkan.

## Implemented changes

- Shorter instruction prompt: 1,444 to 1,019 characters, with regression checks for personal follow-ups and currency explanations.
- Conversational text is generated before unused wallet fields and delivered through SSE using Expo's native streaming fetch.
- Stream previews are display-only. Only a complete, validated response can produce a transfer draft. Incomplete streams, malformed output and cancellation fail closed.
- Exact balance, receive-address and history queries are answered directly from current application state. The benchmark measured about 2 ms per balance lookup averaged across 100 function calls; this excludes screen rendering and is not an end-to-end phone timing.
- Output budget reduced from 256 to 180 tokens; recent conversation remains bounded to four message texts. Reasoning remains disabled.
- Optional Vulkan launch profile selects the dedicated GPU and offloads model layers. The normal launch command retains CPU mode.
- Repeatable benchmark command records latency and checks conversation context and response classification.

Wallet amounts and recipients still need explicit literals in the current request. Review and confirmation remain required; no real wallet or WDK execution was added.

## Repeat the setup

From the mobile folder, run the model server:

~~~powershell
npm run ai:server:vulkan
~~~

From another terminal in the mobile folder, reconnect Android:

~~~powershell
npm run android:local-ai
~~~

Once the model is loaded and warmed, measure it from the mobile folder:

~~~powershell
npm run ai:benchmark -- vulkan-warm
~~~

Stop the running AI server before selecting CPU mode with npm run ai:server. The Vulkan profile is for a compatible Windows/Linux desktop GPU; it is not an Android native runtime configuration. Confirm the reported runtime backend rather than assuming that requesting GPU mode guarantees offloading.

## Verification

Lint, TypeScript and all 15 behavior tests passed. Live GPU checks preserved the exact 25 USDT / Arbitrum / full-address draft and refused a negated transfer. No transfer was submitted.

Android displayed an immediate balance reply from its saved 1,199.96 USDT demo state. A typed explanation request completed through native streamed fetch in 2.39 seconds on the server (first model token 435 ms). An early screenshot shows partial reply text while Cancel AI request is still visible: internal/evidence/wally-vulkan-streaming.png. The final UI hierarchy is saved beside it.

## Phone deployment boundary

The Android emulator runs the UI; inference still runs on the computer. These GTX 1650 timings do not predict the speed, heat, battery use or RAM on a 6–8 GB phone. A native QVAC development build and a physical ARM64 device are required for that next benchmark. Start with the same instant wallet reads, short bounded context, streamed replies and serialized generation, then measure a smaller model and supported native GPU backend on the target device.

References: [QVAC system requirements](https://docs.qvac.tether.io/sdk/system-requirements/), [QVAC streaming HTTP API](https://docs.qvac.tether.io/cli/http-server/), [Expo SDK 57 streaming fetch](https://docs.expo.dev/versions/v57.0.0/sdk/expo/).

