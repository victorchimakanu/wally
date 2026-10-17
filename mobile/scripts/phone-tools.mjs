import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(mobile);
export function checkPhone({ androidApi, architectures, physical, memoryBytes }) {
  const reasons = [];
  if (!physical) reasons.push('QVAC needs a physical Android phone.');
  if (!Number.isInteger(androidApi) || androidApi < 31) reasons.push('QVAC requires Android 12 (API 31) or newer.');
  if (!architectures.includes('arm64-v8a')) reasons.push('QVAC requires an ARM64 Android device.');
  return { supported: reasons.length === 0, reasons, targetRam: memoryBytes >= 5.5 * 1024 ** 3 ? 'meets the 6–8 GB target' : 'below the 6–8 GB target' };
}
function adbPath() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  const candidate = sdk && path.join(sdk, 'platform-tools', executable);
  return candidate && existsSync(candidate) ? candidate : executable;
}
export function inspectPhone(requestedSerial) {
  const adb = adbPath();
  const read = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 15_000 }).trim();
  const devices = read(['devices']).split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).filter(([, status]) => status === 'device');
  const physical = devices.filter(([serial]) => !serial.startsWith('emulator-'));
  const serial = requestedSerial ?? (physical.length === 1 ? physical[0][0] : undefined);
  if (!serial || !devices.some(([id]) => id === serial)) throw new Error('Connect and authorize one physical phone, or pass its device ID explicitly.');
  const shell = command => read(['-s', serial, 'shell', ...command]);
  const memory = shell(['cat', '/proc/meminfo']);
  const properties = {
    serial, model: shell(['getprop', 'ro.product.model']), androidVersion: shell(['getprop', 'ro.build.version.release']),
    androidApi: Number(shell(['getprop', 'ro.build.version.sdk'])), architectures: shell(['getprop', 'ro.product.cpu.abilist']).split(','),
    physical: shell(['getprop', 'ro.kernel.qemu']) !== '1' && !serial.startsWith('emulator-'),
    memoryBytes: Number(memory.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0) * 1024,
    availableMemoryBytes: Number(memory.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? 0) * 1024,
  };
  return { recordedAt: new Date().toISOString(), ...properties, ...checkPhone(properties) };
}
async function expo(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(mobile, 'node_modules', 'expo', 'bin', 'cli'), ...args], {
      cwd: mobile, stdio: 'inherit', windowsHide: true, env: { ...process.env, WALLY_NATIVE_QVAC: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' ') },
    });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Android build command failed (' + code + ').')));
  });
}
async function main() {
  const command = process.argv[2] ?? 'check';
  if (command === 'prebuild') return expo(['prebuild', '--platform', 'android']);
  if (command === 'start') {
    const phone = inspectPhone(process.argv[3]);
    if (!phone.supported) throw new Error(phone.reasons.join(' '));
    execFileSync(adbPath(), ['-s', phone.serial, 'reverse', 'tcp:8083', 'tcp:8083'], { stdio: 'inherit', timeout: 15_000 });
    return expo(['start', '--dev-client', '--localhost', '--port', '8083']);
  }
  if (command === 'export') return expo(['export', '--platform', 'android', '--output-dir', 'dist/phone-android', '--max-workers', '2']);
  if (!['check', 'build'].includes(command)) throw new Error('Use check, prebuild, or build.');
  const report = inspectPhone(process.argv[3]);
  const evidence = path.join(root, 'internal', 'evidence'); mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, 'phone-compatibility.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.supported) { process.exitCode = 1; return; }
  if (command === 'build') await expo(['run:android', '--device', report.serial, '--no-bundler']);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
