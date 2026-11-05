import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = path.join(root, 'internal/qvac-runtime');
const cli = path.join(runtime, 'node_modules/@qvac/cli/dist/index.js');
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
if (!existsSync(cli)) {
  console.error('Install the pinned runtime first: npm install --prefix internal/qvac-runtime --save-exact @qvac/cli@0.15.0 --no-audit --no-fund');
  process.exit(1);
}
const config = readJson(path.join(root, 'mobile/qvac.config.example.json'));
const gpuRequested = process.argv.includes('--vulkan');
if (gpuRequested && !['win32', 'linux'].includes(process.platform)) throw new Error('This Vulkan development profile supports Windows/Linux; use CPU mode here.');
if (gpuRequested) {
  Object.assign(config.serve.models['wally-llm'].config, { device: 'gpu', gpu_layers: 99, 'main-gpu': 'dedicated' });
}

const manifest = readJson(path.join(root, 'mobile/qvac-model.json'));
if (!/^[\w.-]+\.gguf$/.test(manifest.filename) || !/^https:\/\/huggingface\.co\//.test(manifest.url) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid pinned model manifest.');
config.cacheDirectory = path.join(root, 'internal/qvac-models');
mkdirSync(config.cacheDirectory, { recursive: true });
const modelFile = path.join(config.cacheDirectory, manifest.filename);
const partial = `${modelFile}.partial`;
async function verify(file) {
  if (!existsSync(file) || statSync(file).size !== manifest.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === manifest.sha256;
}
let child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child?.kill(signal); process.exitCode = 130; });
if (!(await verify(modelFile))) {
  if (existsSync(modelFile)) throw new Error('The cached model failed its checksum. Move it out of internal/qvac-models and retry.');
  if (!(await verify(partial))) {
    if (existsSync(partial) && statSync(partial).size >= manifest.size) throw new Error('The partial model failed verification. Move the .partial file out of internal/qvac-models and retry.');
    console.log(`Downloading ${manifest.name} (${(manifest.size / 1024 ** 3).toFixed(2)} GiB); subsequent launches reuse the verified file.`);
    // Windows curl uses system networking; avoids native-runtime proxy/peer download issues.
    child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--location', '--fail', '--retry', '2', '--connect-timeout', '30',
      '--speed-time', '60', '--speed-limit', '1024', '--continue-at', '-',
      '--proto', '=https', '--proto-redir', '=https', '--output', partial, manifest.url,
    ], { stdio: 'inherit', windowsHide: true });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`Model download failed (${code}). Rerun to resume the partial download.`);
    if (!(await verify(partial))) throw new Error('Downloaded model failed SHA-256 verification; it will not be loaded.');
  }
  renameSync(partial, modelFile);
}
console.log('Model size and SHA-256 verified. Starting ' + (gpuRequested ? 'Vulkan GPU' : 'CPU') + ' inference.');
config.serve.models['wally-llm'].src = modelFile;
const configPath = path.join(runtime, 'qvac.config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
if (!existsSync(path.join(runtime, 'qvac/worker.entry.mjs'))) {
  console.log('Generating the text-only native worker.');
  child = spawn(process.execPath, [cli, 'bundle', 'sdk', '--host', `${process.platform}-${process.arch}`, '--config', configPath, '--no-install', '--offline'], { cwd: runtime, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`QVAC worker generation failed (${code}).`);
}
child = spawn(process.execPath, [cli, 'serve', '--openai', '--no-lazy-load', '--host', '127.0.0.1', '--port', '11434', '--config', configPath], {
  cwd: runtime, stdio: 'inherit', windowsHide: true, env: { ...process.env, QVAC_RPC_INIT_TIMEOUT_MS: '120000' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });



