# Setting up Wally locally

This sets up the current web app in this repository — a Fastify server you talk to in a browser.
The standalone mobile app described in [CLAUDE.md](CLAUDE.md) does not exist yet; this is the
reference app it will be built from.

Wally needs **two processes running side by side**: the QVAC model server (which owns the LLM) and
Wally itself (which owns the wallet and the agent loop). Plan on two terminals.

All commands below run from the repository root.

---

## Before you start

| Requirement | Why | Check |
|---|---|---|
| Node.js 22+ | `engines` requires it; the code is ESM + `NodeNext` | `node -v` |
| GitHub access | Two dependencies resolve over `git+ssh` (see below) | `ssh -T git@github.com` |
| QVAC CLI + a `.gguf` model | Wally does not load a model itself; it talks to QVAC's server | `which qvac` |
| `openssl` | Generating the session secret | `openssl version` |
| `python3`, `make`, `g++` | `better-sqlite3` compiles a native module | `which python3 make g++` |

`package-lock.json` pins `wdk-mcp-toolkit` and `wdk-indexer-http` to exact commits over
`git+ssh://git@github.com/...`, so `npm install` shells out to git for those two. A working SSH key
on your GitHub account is the normal path:

```bash
ssh-keygen -t ed25519 -C "your-email"        # if you do not already have a key
cat ~/.ssh/id_ed25519.pub                    # add this at github.com/settings/keys
ssh -T git@github.com                        # expect: "Hi <user>! You've successfully authenticated"
```

If you cannot use SSH, both repositories are **public over HTTPS**, so a URL rewrite works instead —
no key, no access request:

```bash
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
```

Run `ssh -T` in a real terminal. In a non-interactive shell it can report `Host key verification
failed` purely because there is no prompt available to accept GitHub's host key, which says nothing
about whether your key works.

---

## 1. Install dependencies

```bash
cd wally
npm install
```

**Expect this to take a long time, and to look frozen while it does.** The tree is roughly 700 MB —
WDK pulls in `ethers`, the `@bitcoinerlab` bitcoin stack, `@bgd-labs/aave-address-book`, and esbuild
platform binaries. After npm prints its resolution warnings (including
`skipping integrity check for git dependency ssh://...`) it downloads and extracts several hundred
packages while showing only a spinner, then goes quiet again to compile `better-sqlite3`. On a slow
connection the silent stretch can run for an hour or more; that is not a hang.

Do not interrupt it — a half-written tree is worse than a slow one. If you must, resume with
`npm install --prefer-offline` so anything already downloaded comes from the cache. You can confirm
it is alive with `du -sh node_modules` a minute apart, or read the per-request timings in the newest
file under `~/.npm/_logs/`.

You are done when `node_modules/better-sqlite3/build/Release/` contains a `.node` file and the
nested `node_modules` directories under the two WDK protocol packages are gone.

**Check the native module even if npm exits 0.** On a slow or flaky connection `prebuild-install`
can fail to fetch a prebuilt binary and leave `better-sqlite3` with no `build/` directory at all,
while the overall install still reports success. Wally would then crash on startup at `getDb()`.
Verify and fix:

```bash
node -e "new (require('better-sqlite3'))(':memory:'); console.log('ok')"
npm rebuild better-sqlite3      # compiles from source if that failed
```

Then confirm the whole tree is sound with `npm run typecheck` and `npm test` (66 tests should pass).
Both run without QVAC or a wallet.

`postinstall` runs `scripts/dedupe-wdk.mjs`, which deletes nested `node_modules` under the WDK
protocol packages. That is load-bearing — duplicate wallet classes fail the Aave package's
`instanceof` check. If you ever see `npm install` output without a `dedupe-wdk:` line, something
skipped scripts.

`npm audit` will report findings in the WDK dependency tree. They are known and accepted; do **not**
try to fix them with `axios`/`elliptic` overrides, which breaks WDK's internal class checks.

## 2. Configure Wally

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Only one value is mandatory:

```bash
openssl rand -base64 32     # paste into SESSION_SECRET
```

Wally refuses to start with a short or placeholder `SESSION_SECRET`, because a predictable one would
let anyone forge a session cookie.

**You do not need to create a wallet.** With no seed configured, Wally generates one on first start,
writes it to a gitignored owner-only `.wally-seed`, and shows you the recovery phrase once. Write it
down — it is the wallet, and nobody can recover it for you. To bring your own instead, set exactly
one of `WDK_SEED` (development only), `WDK_SEED_FILE`, or `WDK_SEED_COMMAND` (a command whose stdout
is the phrase; preferred outside development).
Update the PR, with all the changes that I have already made.
Everything else has a working default. `NETWORK_MODE=testnet` is the default and is where you should
stay until a transfer has worked end to end.

## 3. Start the QVAC model server

Wally is an OpenAI-style client pointed at `QVAC_SERVER_URL`; it never loads a model in-process. You
need the QVAC CLI and a `.gguf` model on disk. Pick the model to fit the machine — on this hardware
that means Qwen3-0.6B, for the reasons measured below.

The CLI is a **scoped** npm package — there is no `qvac` package, no apt package:

```bash
npm install -g @qvac/cli      # provides the `qvac` binary
```

Then create the config:

```bash
cp qvac.config.example.json qvac.config.json
```

Edit the `src` field to the **absolute path** of your `.gguf` file and set `device: "cpu"` (see
below), then, in its own terminal:

```bash
qvac serve openai -c qvac.config.json
```

It listens on `127.0.0.1:11434`. Keep it running. The model alias in that file (`wally-llm`) must
match `QVAC_MODEL` in `.env.local`.

Loopback is what keeps inference on-device. Wally refuses to start against a non-loopback
`QVAC_SERVER_URL` unless it is `https` **and** `QVAC_API_KEY` is set — pointing at a remote server
means your messages leave the machine, so it has to be a deliberate choice.

### Three settings this machine requires

Measured on this hardware (2012 Ivy Bridge, AVX but no AVX2, nouveau GPU):

- **`device: "cpu"` is mandatory.** QVAC auto-selects the GPU backend on desktop. On nouveau that
  faults mid-inference and kills the worker (`CTXSW_TIMEOUT`, `channel killed`), after which every
  request fails in ~25ms. **`gpu_layers: 0` alone does not prevent this** — only `device: "cpu"` does.
- **Serve exactly one model.** Two preloaded models roughly halved throughput here: the same prompt
  took 45.8s with a second model resident and 27.3s without.
- **The model must be small.** Qwen3-4B exceeded 300s per request and never completed.
  Qwen3-0.6B answers in 14-46s and parses Wally's intents correctly.

A `src` may be a local path, a Hugging Face URL, or an SDK catalog constant such as
`QWEN3_600M_INST_Q4`. A constant is downloaded and checksum-validated automatically, but it caches to
`~/snap/code/common/.qvac/models/` when launched from a snap-packaged VS Code terminal, because the
snap remaps `HOME`.

The model name in `qvac.config.json` must match `QVAC_MODEL` in `.env.local`, or every request 404s.

## 4. Check the pieces before the browser

In a second terminal:

```bash
npm run cli
```

This runs the full agent loop in the terminal, so a failure tells you which component is broken
without the browser in the way. Type `what is my ethereum balance`. Confirmations are answered
`yes` / `no` here instead of by button.

Then start the server:

```bash
npm run dev
```

Open http://localhost:3000. `curl localhost:3000/health` reports `qvac`, `wdk`, and `db` separately
— useful when only one of the three is wrong. The first message takes a few extra seconds while the
model loads.

## 5. Optional: pay fees in USDT instead of ETH

Without this, transfers are classic accounts and need ETH on the same chain for gas. The gasless
setup makes Arbitrum a smart account (ERC-4337) whose fee comes out of your USDT. Full walkthrough
in [GASLESS.md](../GASLESS.md); the short version:

```bash
cp wdk.config.example.json wdk.config.json     # replace YOUR_PIMLICO_API_KEY in BOTH urls
```

Then uncomment `WDK_CONFIG=./wdk.config.json` in `.env.local` and restart. Any chain in that file
with both a `bundlerUrl` and a `paymasterUrl` becomes gasless automatically — no extra flag.

Do not retype the contract addresses in the example file; their capitalization is a checksum and
validation rejects any deviation.

**Note the network.** The shipped `wdk.config.example.json` targets chain `42161` — Arbitrum One,
which is *mainnet*, with real funds — while `NETWORK_MODE` defaults to `testnet`. If you enable
gasless as shipped, fund it with a small amount you are willing to lose while testing.

After restarting, your Arbitrum address **changes**: a smart account is a different address derived
from the same seed. Click the Arbitrum balance card to reveal and copy the new one.

---

## Optional extras

- **Docs site:** `cd docs-site && npm install && npm start` → http://localhost:3001
- **Tests:** `npm test`. Integration tests are excluded by default and need a live QVAC, a seed, and
  a running Wally: `INTEGRATION=1 npx vitest run test/integration`
- **Docker:** `docker-compose.yml` builds and runs the server, but supply the seed at runtime via
  `WDK_SEED_COMMAND` or `WDK_SEED_FILE`. Never bake a seed into an image.

## When it does not start

Wally exits loudly rather than starting in a compromised state. The message names the problem; these
are the ones you are most likely to hit.

| Symptom | Cause and fix |
|---|---|
| `npm install` looks frozen after the git-dependency warning | Almost always just a slow download, not a hang. See *Install dependencies*. |
| `npm install` **errors** on a `git+ssh` URL | No GitHub SSH access. Use the HTTPS rewrite in *Before you start*. |
| `npm warn EBADENGINE ... npm: '>=11'` | Cosmetic. `wdk-indexer-http` asks for a newer npm than the one you have; the install proceeds. |
| `Command 'qvac' not found` | The package is scoped: `npm install -g @qvac/cli`. Plain `qvac` is not on npm and there is no apt package. |
| Crash on startup mentioning `better-sqlite3` or bindings | The native module did not build. `npm rebuild better-sqlite3`. |
| `SESSION_SECRET` error on startup | Missing, under 32 chars, or still a placeholder. Regenerate with `openssl rand -base64 32`. |
| Complaint about a non-loopback `QVAC_SERVER_URL` | A remote QVAC server needs `https` **and** `QVAC_API_KEY`. |
| Complaint about `HOST` | Binding off-loopback needs `WALLY_ALLOW_REMOTE=true`, which in turn needs a `WALLY_ACCESS_TOKEN` of 16+ chars. Do not do this on an untrusted network. |
| Refuses a plaintext `WDK_SEED` | You are on `mainnet`. Use `WDK_SEED_COMMAND`/`WDK_SEED_FILE`, or opt in with `WALLY_ALLOW_PLAINTEXT_SEED=true` for a throwaway wallet only. |
| `/health` shows `qvac: error` | The QVAC server is not running, or `QVAC_MODEL` does not match the alias in `qvac.config.json`. |
| `/health` shows `wdk: error` | The MCP subprocess did not start — usually a seed source problem. The startup log says which. |
| Transfer blocked: "0 ETH on this chain" | A classic account needs native gas. Either enable gasless (step 5) or send a little ETH to the address. |
| Type errors | `npm run typecheck` shows them without building. |
