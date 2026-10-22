# Wally: phone-local QVAC and performance comparison

## Current status, 7 October 2026

The phone-local adapter, model comparison screen, lifecycle controls and Android native build configuration are implemented. QVAC SDK 0.21.0's text-only ARM64 mobile worker was generated and verified by the SDK plugin. This is **not a completed physical-device inference test or a compiled APK**.

The connected Samsung SM-G960U reports Android 10 / API 29, ARM64, 3,755,687,936 bytes of system RAM (roughly a 4 GB phone), and an Adreno 630 GPU. Available RAM varied around 1.1 GB during inspection. It fails QVAC's documented Android 12 / API 31 support floor and falls below our 6–8 GB target. No native model was installed or benchmarked on that phone. The compatibility report is saved in ignored `internal/evidence/phone-compatibility.json`.

The existing emulator path continues to use QVAC on the computer. Its response times do not establish phone-local performance.

## Implemented behavior

- Explicit phone-local build flag (`WALLY_NATIVE_QVAC=1`); it takes precedence over the computer HTTP adapter, which remains development-only. There is no automatic cloud or computer fallback in phone mode.
- Qwen3 0.6B Q4 (382,156,480 bytes) and Qwen3 1.7B Q4 (1,056,782,912 bytes), pinned to SDK catalog descriptors and checksums. These are file sizes, not total runtime RAM requirements.
- SDK registry download with a pinned HTTPS Hugging Face fallback, checksum enforcement and cache in app-private document storage. Weights are downloaded after explicit setup, not packaged in the APK. Cached weights remain after model unload.
- CPU is the initial choice. Optional GPU loads request GPU placement; actual completion statistics are recorded independently. Missing backend information is reported as unavailable.
- Advisory pre-download memory assessment: a `likely-too-large` result blocks loading; `unknown` is not presented as a guarantee.
- One native operation at a time, 2,048-token context, bounded history, 180 output tokens, disabled reasoning and streamed conversational previews. Only a complete validated result can enter the wallet interpretation path.
- Cancellation reaches native load/generation request IDs. Backgrounding cancels work, unloads weights and suspends the worker. Idle models unload after two minutes; cached weights can reload when chat resumes. Pause releases the model. No wallet secrets are stored in the benchmark or model cache.
- Exact wallet reads use current application state. Transfers still require literal current-request details and the existing review/confirmation flow. All balances and transactions remain fictional; WDK is not integrated.
- Android packaging targets ARM64 and API 31. The configuration plugin makes OpenCL optional so its absence does not prevent installation on a CPU/Vulkan device. SDK default API 29 settings are overridden to match its published support floor.
- The Expo Go preview excludes the native SDK worker through the Metro resolver. Native test builds include the real worker. This prevents shipping the large runtime into the computer-connected preview.

## Run on a supported physical phone

Commands below run on the development computer, from `mobile/`:

```powershell
npm run phone:check
npm run phone:prebuild
npm run phone:build
npm run phone:start
```

`phone:check` and `phone:build` refuse an emulator, non-ARM64 device or Android below 12. A single authorized USB phone is selected automatically; with multiple phones, pass the device ID after `--` to either command. The build command needs a working local Android/JDK toolchain and installs only on the checked phone. No local APK compilation was verified here; Java was not available in this session's PATH.

The native development server uses port 8083. `phone:start` checks the connected phone and forwards **Metro only** over USB, then starts the native development server with IPv4 enabled for Windows. Open the installed development build and connect to `http://127.0.0.1:8083`. Phone-local inference does not use port 11434. Release preview builds do not need Metro after installation.

If using EAS cloud builds, `eas.json` provides `phone-development` and `phone-preview` APK profiles with the native flag. An authenticated Expo account/project is required. No cloud build, publication or signing operation was performed.

For JavaScript bundle verification alone, use `npm run phone:export`. This generates an Android/Hermes bundle, **not an APK**. The ordinary `npm run export:android` remains the lightweight Expo Go/computer preview. After dependency installation or regeneration, native builds must use `phone:prebuild`; never hand-edit the generated Android directory.

## Comparison and measurements

On the supported phone, open **Settings → Phone performance**. Run CPU first, then GPU if supported. Each comparison downloads/loads only one model at a time and runs 20 fixed cases per model: ten answer/intent checks, followed by ten repeated explanation requests for sustained behavior. It does not create chats, change wallet state, or submit a transfer.

Checks include recent-name recall, USDT explanation, resource/CUDA questions, exact transfer interpretation, transfer cancellation, missing recipients, and attempted reuse of transfer details from history. They are simple automated gates; the full replies must still be reviewed. In particular, the repeated capability answer from the user's screenshot fails the resource-question check.

The report records first content token, first conversational reply text, complete response time, requested/actual backend, SDK stats, model download/load duration, fit evidence, sampled process RSS, device metadata and battery snapshots. First-reply time is null for wallet intents where the app supplies the reply. It saves only fixed test prompts/results in local AsyncStorage and can be copied as JSON. It is separate from wallet/chat persistence.

To collect independent Android process memory, battery temperature and thermal-service readings during the run, use another computer terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/measure-phone.ps1 -DeviceId DEVICE_ID -Seconds 300
```

The monitor writes timestamped JSONL under ignored `internal/evidence/`. Process PSS and SDK process RSS are different measures. Battery temperature is not GPU/chip temperature. Missing/unsupported metrics stay null. USB charging invalidates a battery-drain comparison: download the weights first, then disconnect charging and use the copied on-phone report for battery testing. A longer wireless-debugging run is needed for a useful energy comparison.

Download/load time may include cached weights or network transfer. Test a cached-weight app restart separately before calling a result “cold startup.” Debug builds have overhead; repeat promising results in the native release preview. Compare medians and upper-tail latency after reviewing failures, rather than picking a model from one fast response. Slower later replies alone are not proof of thermal throttling; check the thermal readings.

## Remaining verification

Completed locally: SDK native worker generation/verification, TypeScript, ESLint, all 25 behavior tests, Android/Hermes exports for both preview and native phone modes, and the web export. The native phone JavaScript bundle is approximately 27 MB; the regular Android preview is approximately 2.9 MB. These are bundle sizes, not APK sizes or runtime RAM measurements. Lifecycle/benchmark tests use an injected test engine and do not establish native hardware performance.

The emulator opened the new Phone performance screen, displayed the physical-device requirement and disabled the comparison buttons. The restarted IPv4 preview remains on `127.0.0.1:8082`; the computer model remains on `127.0.0.1:11434`. Existing saved wallet/chat data was retained. UI evidence is saved in ignored `internal/evidence/wally-performance-ready.xml`.

Compile/install the native APK, generate on a supported physical device, verify CPU/GPU backend reporting and checksum/download cancellation, test background/foreground and idle reload, inspect answer quality, and collect sustained memory/battery/thermal measurements. No mobile timing, RAM peak, battery drain or temperature improvement is claimed before those checks.

References: [QVAC requirements](https://docs.qvac.tether.io/sdk/system-requirements/), [QVAC Expo setup](https://docs.qvac.tether.io/sdk/js-ts-sdk/), [model-fit assessment](https://docs.qvac.tether.io/sdk/models/assess-model-fit/), [runtime lifecycle](https://docs.qvac.tether.io/sdk/runtime/lifecycle/), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Expo Metro configuration](https://docs.expo.dev/guides/customizing-metro/).
