# Running Wally locally

How to start the whole thing: by hand, one service per terminal, or with the backend and the
dev wallet server in containers ([With Docker](#with-docker)).

**Last run end to end on 28 November 2026**, on `mobile-chat-and-brand`: backend and dev wallet
server from `docker-compose.product.yml`, the model server and Metro on the host, against real
Sepolia nodes and real CoinGecko. The 8 November run on `correctness` did the same by hand.
Every step below was executed, not remembered.

---

## The short version

The app runs in a **browser** with no phone and no Android tooling. That is the fastest way
to see it working:

```
Terminal 1:  cd backend && npm run dev        # port 8080
Terminal 2:  cd mobile  && npm run start:local # port 8082
```

Open **http://127.0.0.1:8082**. That gives you the full UI, live market prices through your
own backend, and the demo wallet. Everything else on this page is optional.

---

## What each piece is

| Service | Port | Needed for | Optional? |
|---|---|---|---|
| **Backend proxy** | 8080 | Market prices, charts, Activity history, chain RPC, and the AI passthrough | Yes — prices fall back to CoinGecko and Activity to the dev wallet server |
| **Expo / Metro** | 8082 | The app itself | **No** |
| **QVAC AI server** | 11434 | Chat with the assistant. The app does **not** call this directly — it goes through the backend on 8080 | Yes — without it chat uses scripted replies |
| **Dev wallet API** | 3003 | A real testnet wallet with keys on this computer | Yes — without it the wallet is a demo |

The dev wallet API needs a one-time install of the isolated WDK runtime before it will start:

```bash
cd mobile && npm run wallet:install
```

Without it the server exits with that exact command in the error, and the two signing tests in
`npm test` skip with the same hint rather than failing.

Start only what you need. Each lives in its own terminal because each stays in the foreground.

---

## With Docker

`docker-compose.product.yml` at the repository root runs the two servers in containers. It is
**not** `docker-compose.yml` beside it: that file builds the old reference app, holds a seed and
points at mainnet RPCs. Everything in the product compose file is Sepolia and loopback.

| Profile | What comes up | Then |
|---|---|---|
| `live` | the backend proxy on 8080 and the dev wallet server on 3003 | start the model server and Metro on the host (Terminals 2 and 3 below) |
| `demo` | the app as a static web export on 8082, on fictional data, with no server behind it | open http://127.0.0.1:8082 |

```bash
docker compose -f docker-compose.product.yml --profile live up --build -d   # backend + wallet server
docker compose -f docker-compose.product.yml --profile demo up --build -d   # the app on fictional data
docker compose -f docker-compose.product.yml --profile live --profile demo down
```

**What stays on the host, and why.** The model server wants the GPU and a 1 GB model file, so it
runs on the host (`cd mobile && npm run ai:server`); the backend container reaches it at
`host.docker.internal:11434`. Metro runs on the host because it watches the source tree and
serves your browser. The demo profile needs neither: it bakes an unset `EXPO_PUBLIC_WALLY_API_URL`
into a web export, so the app runs on fictional data and cannot reach a server. Chat in that build
is scripted by construction (see *Running it with no GUI* below).

**Secrets.** None in the compose file and none in any image. The wallet seed is a bind mount of
`internal/testnet-wallet/` (gitignored); the first start writes one there if the directory is
empty. Optional provider keys (`ETHERSCAN_API_KEY`, `COINGECKO_API_KEY`) are read from the shell
or from a gitignored `.env` beside the compose file.

**Ports.** Metro's port is the browser origin both servers allow, 8082 by default. Running Metro
elsewhere means `WALLY_WEB_PORT=8086 docker compose -f docker-compose.product.yml --profile live up -d`,
which sets the backend's `ALLOWED_ORIGINS` and the wallet server's `WALLY_API_ORIGINS` together.
By hand, set those two variables yourself.

**Why each server has a `-port` sidecar.** Both bind `127.0.0.1` on purpose, the wallet server
refuses any peer that is not loopback, and the backend registers its development-only model
passthrough (the one chat needs in a browser) only when bound to loopback. A published Docker port
arrives from the bridge gateway (`172.17.0.1`, measured here), which both would refuse, and Docker
Desktop's host networking was not enabled on this machine. So a small `socat` container shares each
server's network namespace and forwards the published port to `127.0.0.1` inside it. Each server
sees exactly what it sees on a laptop, and no guard is loosened.

**Measured on 28 November 2026** (Windows 11, Docker Desktop 4.99, Metro on 8086 because stale
Metros held 8082 to 8085):

- `curl http://127.0.0.1:8080/health` answered from the container; `/v1/market` with a browser
  `Origin` header came back `200` with `access-control-allow-origin` set, and `403` until
  `WALLY_WEB_PORT` matched Metro's port, which is the allowlist doing its job.
- The wallet server handed out a session cookie and a snapshot: the same address on Arbitrum
  Sepolia and Ethereum Sepolia, derived from the seed that was already in
  `internal/testnet-wallet/wallet.seed` (created 7 October; no new seed was generated).
- `/v1/models` through the backend listed `wally-llm` as `ready`, so the container reaches the
  host's model server.
- In the app at 375 px: the wallet card showed both chains and the USDT row (all zero, this wallet
  has never been funded), Receive showed the address and QR, Settings → Connection named
  *Wally backend* for both market data and Activity, and Activity said each chain needs
  `ETHERSCAN_API_KEY`, which was not set.
- Chat, asked *"Hi, my name is Ada. Tell me one fun fact about octopuses, in a single
  sentence."*: first text after 1.8 s, the full reply after 17.7 s, the model server itself
  reporting 15.1 s on the CPU. The question deliberately avoids wallet words: *"why does sending
  ETH cost a fee"* is answered in 3.6 s from `asset-copy.ts` without any inference, and a stale
  reading of that as a model reply is easy. The same question asked while Gradle and a Docker
  build were saturating the CPU hit the app's 90-second timeout and showed *That took too long*,
  which is the correct failure. The GPU profile (`npm run ai:server:vulkan`) failed to start three
  times that afternoon with *Worker did not establish IPC before the RPC initialization timeout*,
  each time while the machine was loaded; it is not known whether it works idle today.
- Send with `0.001` ETH to a test address stopped at the quote with *Not enough testnet ETH. Fund
  this address from a faucet before sending.* The review screen needs a funded wallet; funding
  needs a faucet account, which was not created.
- The `demo` profile built in 13 minutes (`npm ci` plus the web export inside the image; the
  final image is 96 MB) and served on `WALLY_DEMO_PORT=8087` because a Metro held 8082. Deep
  links answer `200`. At 375 px: the welcome, the wallet card with the fictional 1,250 USDt and
  a *Demo* badge, and the scripted balance reply in chat. The only host the page contacted
  besides itself was `api.coingecko.com`, the documented market fallback when no proxy is set.

---

## One-time setup

```bash
cd wally

# Backend
cd backend && npm install && cp .env.example .env.local && cd ..
#   then edit backend/.env.local and UNCOMMENT this line, or the browser gets a 403:
#   ALLOWED_ORIGINS=http://127.0.0.1:8082,http://localhost:8082

# Mobile app (large: ~1,000 packages, around 3.5 GB)
cd mobile && npm install && cp .env.example .env.local && cd ..
```

Then open `mobile/.env.local` and set these two so the app talks to your backend:

```bash
EXPO_PUBLIC_WALLY_PROXY_URL=http://127.0.0.1:8080   # market data
EXPO_PUBLIC_QVAC_URL=http://127.0.0.1:8080          # chat — the BACKEND, not 11434
```

That second line is not a typo. Chat is routed through the backend because QVAC omits the
CORS header on streaming replies, which makes browsers block every streamed answer. The
backend adds it. See [`backend/README.md`](../backend/README.md).

Metro caches environment variables at startup. **Restart Metro after any change to
`.env.local`**, or the app will keep using the old value and you will chase a ghost.

---

## Terminal 1 — Backend proxy

```bash
cd backend
npm run dev
```

Expect:

```
wally backend listening · holds no keys
```

Check it:

```bash
curl http://127.0.0.1:8080/health
curl "http://127.0.0.1:8080/v1/market?currency=ngn"
```

The second call should return Naira prices. Call it twice — the second is near-instant
because the backend caches for 60 seconds, which is the entire point of it existing.

Defaults are public testnet endpoints, so it works with no API keys. Edit `.env.local` to
point at paid providers later.

---

## Terminal 2 — The app

```bash
cd mobile
npm run start:local
```

Open **http://127.0.0.1:8082**.

Press `w` in that terminal to open a browser, or `a` for an Android emulator. Press `r` to
reload, `j` to open the debugger.

On a wide screen the app renders inside a phone frame with an introduction panel beside it.
That is deliberate — it is the same build either way.

### Confirming the backend is actually in use

Open **Settings → Connection**. The **MARKET DATA** card names the live source:

- *Wally backend* plus your URL — the proxy is working
- *CoinGecko (direct)* — the proxy is being bypassed

Prices appear either way, because the fallback to CoinGecko is deliberate. That card is the
reliable signal; request lines in Terminal 1 are a second confirmation.

---

## Terminal 3 — AI chat (optional)

Without this, chat still works using scripted replies. With it, a real model answers.

**One-time**, from the repository root:

```bash
npm install --prefix internal/qvac-runtime --save-exact @qvac/cli@0.15.0 --no-audit --no-fund
```

Then:

```bash
cd mobile
npm run ai:server
```

First run downloads **Qwen3-1.7B-Q4_0, about 1.06 GB**, verifies its SHA-256 against the
pinned manifest in `mobile/qvac-model.json`, and caches it under `internal/qvac-models/`.
Later runs reuse it.

It serves on **port 11434** with the model alias `wally-llm`, matching
`EXPO_PUBLIC_QVAC_MODEL` in your `.env.local`.

If you have a dedicated GPU on Linux or Windows:

```bash
npm run ai:server:vulkan
```

Stop the CPU server before starting the Vulkan one — they want the same port. On the
measured desktop, warm GPU replies came back in roughly 1–4 seconds against 14–47 seconds on
CPU, so it is worth it if your hardware supports it.

---

## Terminal 4 — Real testnet wallet (optional)

Without this the wallet is a demo with fictional balances. With it, you get real Sepolia
testnet keys and real transactions.

**One-time**, from `mobile/`:

```bash
npm run wallet:install    # installs a pinned WDK runtime under internal/
```

Then:

```bash
npm run wallet:server     # port 3003
```

The first start generates a seed at `internal/testnet-wallet/wallet.seed` and reuses it
afterwards. That directory is gitignored. **Back it up if you fund the wallet.**

Set this in `mobile/.env.local` and restart Metro:

```bash
EXPO_PUBLIC_WALLY_API_URL=http://127.0.0.1:3003
```

The server answers only the browser origins `http://127.0.0.1:8082` and `http://localhost:8082`
unless `WALLY_API_ORIGINS` lists others, comma separated, the way the backend's `ALLOWED_ORIGINS`
does. The compose file sets both from `WALLY_WEB_PORT`.

A fresh wallet is empty. Open **Receive** in the app, copy the address, and request funds from
a Sepolia faucet for the network you picked. Testnet ETH has no monetary value.

Checking it with `curl` needs two calls, not one. `/api/wallet` is gated behind a session
cookie, so a bare request answers `{"error":"Connect to the local wallet API first."}`:

```bash
curl -s -c /tmp/wally.jar http://127.0.0.1:3003/api/wallet/session   # {"ready":true,...}
curl -s -b /tmp/wally.jar http://127.0.0.1:3003/api/wallet | head -c 200
```

**The first call after the server starts can fail, and that is not a real failure.** WDK
derives the accounts on the first request, and the public Sepolia RPCs are slow enough that at
least one chain usually comes back `"balance could not be refreshed"`. Ask again and it
answers. Seen on both chains on 8 November. The app shows the same thing on its first paint,
so a cold start reports a problem that is not there.

Two things to know: this path handles **native testnet ETH only**, not USDt. And the keys sit
on your computer, not on a phone — it is a development scaffold, superseded by on-device
signing. See [`docs/ADR-001-key-custody.md`](ADR-001-key-custody.md).

---

## Running on an Android device or emulator

The app in a browser needs none of this. For a real device:

The repo ships `npm run android:local-ai`, but it is a **PowerShell script and Windows only**.
On Linux and macOS, do the forwards yourself.

A phone cannot reach your computer's `127.0.0.1`, so each service needs a reverse tunnel over
USB:

**Install adb first** (Ubuntu 26.04, needs sudo):

```bash
sudo apt update && sudo apt install -y android-sdk-platform-tools
sudo apt install -y android-sdk-platform-tools-common   # udev rules
sudo usermod -aG plugdev "$USER"                        # then log out and back in
adb version
```

On the phone: Settings → About → tap **Build number** seven times, then Developer options →
enable **USB debugging**. Plug in and accept the prompt. `adb devices` should list it as
`device`, not `unauthorized`.

Then the tunnels:

```bash
adb reverse tcp:8082 tcp:8082     # Metro — required
adb reverse tcp:8080 tcp:8080     # backend proxy
adb reverse tcp:11434 tcp:11434   # QVAC
adb reverse tcp:3003 tcp:3003     # dev wallet API
```

These do not survive unplugging. Re-run them after every reconnect.

Then press `a` in the Metro terminal, or run `npm run android`.

Expo Go cannot run native QVAC or the WDK worklet. Those need a development build:
`npm run phone:check`, then `phone:prebuild`, `phone:build`, `phone:start` (which uses port
8083, not 8082). That path needs a **physical ARM64 phone on Android 12 or newer**, plus Android
build-tools. Java is already installed at `/usr/bin/java`, so the JDK blocker noted in the
10 October readiness document no longer applies; build-tools are still missing.

### Building an installable release APK on this machine (28 November 2026)

`npm run export:android` is a JavaScript bundle, not an APK. On Windows 11 with the Microsoft
JDK 21 at `JAVA_HOME`, the Android SDK under `%LOCALAPPDATA%\Android\Sdk` (platform 36,
build-tools 36, NDK 27.1; Gradle fetched NDK 27.0.12077973 on its own) and 26 GB of free disk,
this is the host build. **Read the path-length item below before running it: on this checkout
it stops at the native compile.** No APK came out of this machine on 28 November; what was
tried, and where each route stops, is recorded below so the next attempt starts there.

```powershell
cd mobile
$env:EXPO_NO_DOTENV = "1"                                   # do not bake .env.local into the APK
$env:EXPO_PUBLIC_WALLY_PROXY_URL = "http://127.0.0.1:8080"  # the backend, reached through adb reverse
Remove-Item Env:EXPO_PUBLIC_WALLY_API_URL -ErrorAction SilentlyContinue   # no dev wallet server on a phone
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"
npx expo prebuild --platform android --clean --no-install   # regenerates android/ as com.wally.app, "Wally"
"sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk" | Set-Content android/local.properties
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
```

When it completes, the APK is at `mobile/android/app/build/outputs/apk/release/app-release.apk`.

**The Docker recipe.** `docker/android-release.Dockerfile` does the same steps on Linux, where
the path limit does not exist: Debian's JDK 17, the pinned Android command-line tools with the
licences accepted inside the image, `npm ci`, `npm run wdk:generate`, `expo prebuild`, and Gradle
with two workers and a smaller heap because Docker Desktop's VM has about 6 GB. It bakes in the
same three environment values. From the repository root:

```powershell
docker build --target apk --output type=local,dest=mobile/dist/apk-docker -f docker/android-release.Dockerfile .
```

The APK is written to `mobile/dist/apk-docker/app-release.apk` and nothing else leaves the image.
**Not verified end to end.** On 28 November the image got through the SDK install, `npm ci`,
`wdk:generate` and `prebuild`, then Gradle's configuration phase failed with *Process 'command
'node'' finished with non-zero exit value 1* and no further detail (plain console). A rerun with
`--stacktrace` to capture the failing command never completed: BuildKit stalled exporting the
multi-gigabyte image, the system drive filled to 3 GB free, and Docker Desktop stopped. Budget
disk before trying again: the `deps` stage alone is several gigabytes inside Docker's disk image,
and that image does not shrink on its own when layers are pruned.

Why each line is the way it is:

- `EXPO_NO_DOTENV=1`. Gradle's bundling step runs `expo export:embed`, which reads `.env.local`
  exactly as Metro does. Without this, the live-mode `EXPO_PUBLIC_WALLY_API_URL=http://127.0.0.1:3003`
  is compiled into a phone build that then points at the phone's own loopback.
- No `EXPO_PUBLIC_WALLY_API_URL` puts the app on the keystore path: the WDK worklet, not the dev
  wallet server. That path requires `EXPO_PUBLIC_WALLY_PROXY_URL` (the worklet needs a chain to
  talk to), and `127.0.0.1:8080` works on a USB phone and on an emulator alike once
  `adb reverse tcp:8080 tcp:8080` is in place and the backend is running.
- `WALLY_NATIVE_QVAC` unset: no native model in this build, so chat on the phone is scripted (the
  HTTP adapter is `__DEV__`-only). The `phone-preview` profile in `eas.json` is the variant with
  the model; it needs an ARM64 phone on Android 12 or newer.
- `arm64-v8a` only. The prebuild default is four ABIs, each a full native compile. Phones are
  arm64, and the x86_64 emulator image is not installed here in any case.
- `local.properties` is a Java properties file, where a backslash escapes the next character:
  `sdk.dir=C:\Users\...` is read as `C:UserskfdosAppData...` and the Android Gradle plugin fails
  while configuring `:app` with *The filename, directory name, or volume label syntax is
  incorrect*. Forward slashes work. (`expo run:android` writes this file for you, but it insists
  on a connected device or a bootable emulator, which this machine has neither of.)
- Signing is the debug keystore that prebuild generates (`android/app/debug.keystore`), which is
  what the generated `build.gradle` uses for release. Installable, not store-ready.
- `--no-daemon --max-workers=2`. The first attempt crashed the Gradle JVM with *insufficient
  memory for the Java Runtime Environment* while four Metros and two other projects' servers
  were running; two workers fit inside what was left. The second attempt failed on the
  `local.properties` escape above, the third lost DNS to `dl.google.com` 31 minutes in and
  resumed from the Gradle cache.
- **The path-length limit, which is where the host build stops.** CMake mirrors the absolute
  path of each source file under `android/app/.cxx`, so an object for
  `react-native-gesture-handler`'s codegen lands at a path about 390 characters long, and
  `:app:buildCMakeRelWithDebInfo[arm64-v8a]` fails with `ninja: error: Stat(...)`. Windows caps
  paths at 260 unless `LongPathsEnabled` is set in the registry (it is `0` on this machine; the
  change needs an administrator), and the SDK's CMake 3.22.1 ships ninja 1.10.2, which is not
  long-path aware even then, so a newer `cmake;3.30+` would have to be installed and pinned as
  well. Moving the checkout to `C:\w` is not enough on its own: the mirrored source path alone is
  over 290 characters. The Docker recipe above sidesteps all of it.

**What this build verifies, and what it does not.** It proves the native project compiles and
packages with the WDK worklet runtime (`react-native-bare-kit`) and the generated `.wdk-bundle`
inside, with the ring icon's adaptive-icon layers from `mobile/assets/`. It does **not** prove
the app launches: no Android device was attached and the `Wally_API_36` virtual device cannot
boot because its system image is missing (`system-images/android-36` is empty). So the icon on
a launcher, the first run of `wallet-keystore.ts` over the worklet, and the recovery flow remain
unexecuted. To run it: either plug in a phone (`adb install app-release.apk`,
`adb reverse tcp:8080 tcp:8080`, start the backend, open Wally), or install an emulator image
(`sdkmanager "system-images;android-36;google_apis;x86_64"`, about 1.5 GB) and rebuild with
`-PreactNativeArchitectures=arm64-v8a,x86_64`.

**The EAS route**, if you would rather not build locally: from `mobile/`,
`npx eas-cli@latest login` with your Expo account (nothing here was logged in), then
`npx eas-cli@latest build --platform android --profile preview`. The `preview` profile produces
an APK for internal distribution; `phone-preview` adds the native model. Put the three
environment values above into the profile's `env` or as EAS environment variables, or the cloud
build bakes in nothing and the app runs on demo data.

---

## Running it with no GUI, and driving it

> **A static export cannot do AI chat. Nothing you start will change that.**
>
> `src/demo/store.tsx` reads the model endpoint as
> `const endpoint = __DEV__ ? process.env.EXPO_PUBLIC_QVAC_URL ?? '' : '';`
>
> `npm run export:web` is a production build, so `__DEV__` compiles to `false`, the endpoint
> is the empty string, and chat falls back to scripted replies **even with QVAC running and
> the backend up**. That is deliberate — a production bundle must not call a development AI
> server — and it is not a failure you can debug from the outside: the app simply never asks.
>
> So use this path for the wallet, for Activity, for the market, for export, for anything that
> is not the assistant. **For chat, run Metro** (`npm run start:local`). It cost an hour on
> 8 November to work this out from the symptom.

Useful on a server, in a container, or on any machine where Metro will not start. It needs no
Metro and no file watchers.

```bash
cd mobile && npm run export:web          # bundles the whole app into dist/web
```

The `demo` profile of `docker-compose.product.yml` does exactly this inside an image and serves
the result on 8082 with nginx and the SPA fallback, so on a machine with Docker the rest of this
section is optional.

Then serve `dist/web` on **port 8082** with SPA fallback — every unknown path must return
`index.html`, or deep links 404:

```bash
cd dist/web && python3 -c "
import http.server, socketserver, os, posixpath
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if not os.path.exists(self.translate_path(self.path)) and '.' not in posixpath.basename(self.path):
            self.path = '/index.html'
        return super().send_head()
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(('127.0.0.1', 8082), H).serve_forever()"
```

**8082 is not arbitrary.** It is the only origin the backend and the wallet server accept.

The export compiles `EXPO_PUBLIC_*` in at build time, exactly as Metro does, so change
`.env.local` and export again — there is nothing to restart.

To drive it without a desktop, start Chrome headless and talk to it over the DevTools
protocol. Node's built-in `WebSocket` is enough; no Playwright or Puppeteer needed:

```bash
google-chrome --headless=new --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/wally-chrome --window-size=430,932 about:blank &
curl -s http://127.0.0.1:9222/json/version     # confirms the endpoint
```

From there `Page.navigate` loads a route and `Runtime.evaluate` reads
`document.body.innerText`, or clicks a control by its label. That is how the 8 November run
walked all 22 routes, clicked through *Export your history*, and read back the CSV the
browser would have downloaded.

---

## Running the tests

```bash
cd backend && npm test              # validation, cache, access control, concurrency
cd backend && npm run test:mutation # proves the tests catch the bugs they claim to
cd mobile  && npm test              # includes the signing path
```

**`npm run test:mutation` is worth running after any change to a guard.** It applies one bug at a
time and checks the suite notices. It exists because a green suite proved almost nothing: on
22 October 2026, with 52 backend tests passing, seven mutations survived — five of them in
`server.ts`, including every key being accepted and the rate limiter never refusing.

**The mobile signing tests were not in `npm test` until 23 October 2026** and errored outright on a
fresh checkout, so the code that builds and signs transactions had tests nobody ran. They are in the
default suite now, and skip with a visible reason when the WDK runtime is absent.

## Checking everything works

From the repository root:

```bash
cd backend && npm run typecheck && npm test && npm run test:mutation && cd ..
cd mobile  && npm run typecheck && npm test && npm run lint && cd ..
npm run typecheck && npm test                      # the reference app, at the root
```

Measured on 8 November 2026:

| | |
|---|---|
| `mobile` | **245 tests** |
| `backend` | **95 tests** |
| reference app (root) | **66 tests** |
| `backend` mutation harness | **37 killed, 0 survived** |

Those run offline and need none of the servers above. CI runs the same four as separate jobs,
so a number here that no longer matches is a sign this document has drifted, not that
something broke.

---

## When something is wrong

| Symptom | Cause |
|---|---|
| **"Market data could not be refreshed" in the browser, but `curl` works** | **CORS.** `ALLOWED_ORIGINS` is unset in `backend/.env.local`, so the backend returns 403 to the browser. `curl` sends no `Origin` header and browsers always do, which is why the command line looks fine. Set it, then restart the backend — a `.env` change does not hot-reload |
| Prices show, but Settings says "CoinGecko (direct)" | The proxy is being bypassed. Set `EXPO_PUBLIC_WALLY_PROXY_URL` and **restart Metro** |
| `Activity` says it needs an indexer API key | Expected until `ETHERSCAN_API_KEY` is set in `backend/.env.local`. Activity now reads indexed history from the backend; without a key it falls back to transfers sent from this device and says why. See `BACKEND-ACTIONS-NEEDED.md` |
| `Activity` names Blockscout as its source | The backend is not configured or its call failed, so history came from the dev wallet server, where Blockscout returns 403 for Arbitrum Sepolia. Set `EXPO_PUBLIC_WALLY_PROXY_URL` and restart Metro. **This line is only trustworthy from 8 Nov 2026**: before that it was a hardcoded string that said Blockscout even when the data came from Etherscan through the backend, so an older build naming Blockscout proves nothing |
| Settings → Connection says Activity comes from "Local wallet server" | The proxy is being bypassed for history. Same fix: set `EXPO_PUBLIC_WALLY_PROXY_URL` and **restart Metro** |
| **"The local assistant is unavailable" in chat** | Three causes, in the order to check them. **One:** the QVAC server is not running — `cd mobile && npm run ai:server`, and wait for the model to report ready. **Two:** the backend is not running — chat goes through its passthrough on 8080, not to 11434 directly, so QVAC alone is not enough. **Three:** you are serving a static export, where chat is scripted by construction; run Metro instead. Verified end to end on 8 November: with all three right, a reply came back in about five seconds |
| Chat gives scripted replies | Terminal 3 is not running, or `EXPO_PUBLIC_QVAC_MODEL` does not match `wally-llm` |
| **"Wally could not reach or validate the local model"** | `EXPO_PUBLIC_QVAC_URL` points at `11434` instead of `8080`. QVAC omits the CORS header on streamed replies, so the browser blocks them; routing through the backend adds it. Restart Metro after changing this |
| Chat replies take 8–16 seconds | Normal on a CPU without AVX2. Not a bug. A GPU would cut it to 1–4 seconds, but nouveau is not usable for this |
| Balances say "Unavailable" | Correct behaviour. It never shows a missing balance as zero. Check Terminal 4 |
| **"Connect to the local wallet API first"** while the wallet server is clearly running | **You opened the app on a different hostname than the wallet API.** The session cookie is `SameSite=Strict`, and browsers treat `localhost` and `127.0.0.1` as different sites, so the cookie is never stored and every call after the handshake is unauthenticated. Fixed in the app as of 31 Oct 2026 — it now follows the page's hostname — so this should only appear on an older build. If it does, open the app on the same spelling as `EXPO_PUBLIC_WALLY_API_URL` |
| **Metro dies with `ENOSPC: System limit for number of file watchers reached`** | Not a project problem. Something else is holding your inotify watches — on this machine it was two VS Code file-watcher processes holding 62,776 of 65,536, because VS Code watches `node_modules` unless told not to. Three ways out: add `files.watcherExclude` for `**/node_modules/**` to VS Code settings, raise the limit with `sudo sysctl fs.inotify.max_user_watches=524288`, or close a VS Code window to free about 30,000. Diagnose with `cat /proc/[0-9]*/fdinfo/* 2>/dev/null \| grep -c '^inotify wd:'` |
| **You need a browser but Metro will not start** | Build a static export instead — it uses no file watchers at all: `npm run export:web`, then serve `dist/web` on **port 8082** with SPA fallback (every unknown path returns `index.html`). 8082 matters: both the backend's `ALLOWED_ORIGINS` and the wallet server's origin allowlist name it. **Chat will be scripted in this build and cannot be fixed by starting anything** — `__DEV__` is false in an export, so the app never calls the model. Everything else works |
| **First load shows "balance could not be refreshed", then works on Refresh** | A cold start, not a fault. WDK derives the accounts on the first request and the public Sepolia RPCs are slow; at least one chain usually misses the first attempt. The same happens to the first market fetch after the backend starts. Both recover on the next call. It is listed here because the app's first paint reports a problem that is not there |
| **Everything renders but nothing loads data** | **You are serving the app on a port other than 8082.** Both allowlists name `8082` by default — `ALLOWED_ORIGINS` in `backend/.env.local`, and `WALLY_API_ORIGINS` for `mobile/scripts/wallet-api-server.mjs`. The app reports this as *"The local wallet API could not be reached"*, which reads like the server is down when it is in fact refusing you. Serve on 8082, or set both variables to your port and restart the two servers (`WALLY_WEB_PORT` does both under compose) |
| App loads but nothing talks to anything on a phone | Missing `adb reverse` — see above |
| Changed `.env.local`, nothing happened | Metro caches env at startup. Restart it |
| Port already in use | `ss -lptn 'sport = :8080'` to find the process, then `kill` that PID |

---

## What you can and cannot test locally

**Works now**, and all of it was exercised in a browser against the live services on
8 November 2026:

- The whole interface. Every one of the 22 routes renders.
- Live market prices and charts through your backend, in USD, NGN or EUR.
- The demo wallet end to end, and the real testnet wallet's balances and addresses.
- **Real AI chat in the browser** through the backend passthrough.
- Real Sepolia **ETH** transfers with review and confirmation, activity, and receipts.
- Activity through the backend's Etherscan path, paged.
- Wallet creation, recovery phrase, restore and removal (`/wallet-setup`, `/recovery-phrase`,
  `/restore-wallet`, `/reset-wallet`).
- App lock, and QR scanning (`/scan`).
- The address book, and **Settings → Your data**: *Export your history* (`/export-data`) and
  *Clear chat history* (`/clear-chats`).

**Does not work yet:**

- **Sending USDt.** The balance and the history are read and displayed; the send path is
  native ETH only.
- **Gasless fees** via the paymaster. `GET /v1/gasless` answers `available:false` until a
  bundler and paymaster URL are configured, and no USDT paymaster exists on Arbitrum Sepolia
  in any case — see `GASLESS.md`.
- **The WDK Bare worklet**, which holds the on-device keys. It has never run: it needs a
  development build on a physical phone. The browser path above uses the dev wallet server,
  which is a different wallet with its own seed. Conflating the two is the easiest serious
  mistake to make here.
- **Mainnet.** Both the app and the backend hardcode Sepolia.

Activity now reads indexed history from the backend and merges in transfers sent from this
device, so a just-sent transfer never disappears while it waits to be indexed. It needs
`ETHERSCAN_API_KEY` in `backend/.env.local` to show anything the indexer knows — without the
key it still shows this device's own transfers and says plainly that the key is missing.
