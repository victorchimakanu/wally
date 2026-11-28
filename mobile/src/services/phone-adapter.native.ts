import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { createPhoneRuntime, type PhoneEngine, type PhoneStatus } from './phone-runtime';
import { PHONE_MODELS, type PhoneBackend, type PhoneModel } from './phone-models';
import workerConfig from '../../qvac.config.json';

export const phoneAvailable = Constants.expoConfig?.extra?.nativeQvac === true;
export function phoneCompatibility() {
  const reason = Platform.OS !== 'android' ? 'This benchmark targets Android phones.'
    : !Device.isDevice ? 'QVAC needs a physical phone; emulator timings would be misleading.'
      : Number(Platform.Version) < 31 ? 'QVAC requires Android 12 or newer. This phone runs Android ' + Device.osVersion + '.'
        : Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !phoneAvailable ? 'Install the native Wally phone-test build. Expo Go cannot run QVAC inside the phone.' : '';
  return { supported: !reason, reason };
}
let runtimePromise: Promise<ReturnType<typeof createPhoneRuntime>> | null = null;
let statusListener: ((status: PhoneStatus) => void) | undefined;
export function getPhoneRuntime(onStatus?: (status: PhoneStatus) => void) {
  if (onStatus) statusListener = onStatus;
  const compatibility = phoneCompatibility();
  if (!compatibility.supported) return Promise.reject(new Error(compatibility.reason));
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const models = new Directory(Paths.document, 'qvac-models');
      models.create({ idempotent: true, intermediates: true });
      // Write before importing/initializing the worker: native runtime reads this path.
      new File(Paths.document, 'qvac.config.json').write(JSON.stringify({ ...workerConfig, cacheDirectory: models.uri.replace(/^file:\/\//, '') }));
      const sdk = await import('@qvac/sdk');
      const descriptors = { 'qwen3-600m': sdk.QWEN3_600M_INST_Q4, 'qwen3-1.7b': sdk.QWEN3_1_7B_INST_Q4 };
      const modelConfig = (backend: PhoneBackend) => ({ device: backend, gpu_layers: backend === 'gpu' ? 99 : 0, ctx_size: 2048 });
      const engine: PhoneEngine = {
        fit: (model, backend) => sdk.assessModelFit({ models: [{ modelSrc: descriptors[model], modelConfig: modelConfig(backend) }] }),
        load(model: PhoneModel, backend, progress) {
          return sdk.loadModel({ modelSrc: descriptors[model], modelType: 'llamacpp-completion', fallbackSrc: PHONE_MODELS[model].url,
            modelConfig: modelConfig(backend), requireHttpChecksum: true, requireSecureTransport: true,
            onProgress: value => progress(value.percentage) });
        },
        complete: (modelId, input) => sdk.completion({ modelId, history: input.history, stream: true,
          generationParams: { temp: 0, predict: 180, reasoning_budget: 0 },
          responseFormat: { type: 'json_schema', json_schema: { name: 'wally_phone_chat', strict: true, schema: input.schema as Record<string, unknown> } } }),
        cancel: requestId => sdk.cancel({ requestId }),
        unload: modelId => sdk.unloadModel({ modelId, clearStorage: false, autoClose: false }),
        async sample() {
          const raw = await sdk.getSystemResources({ sample: true });
          const metric = raw.sample?.memory.processUsedBytes;
          return { processBytes: metric?.status === 'supported' ? metric.value : null, raw };
        },
        info: modelId => sdk.getLoadedModelInfo({ modelId }),
        suspend: () => sdk.suspend(), resume: () => sdk.resume(),
      };
      return createPhoneRuntime(engine, status => statusListener?.(status));
    })().catch(error => { runtimePromise = null; throw error; });
  }
  return runtimePromise;
}
export async function phoneSnapshot() {
  const batteryLevel = await Battery.getBatteryLevelAsync().catch(() => -1);
  const batteryState = await Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN);
  let resources: unknown = null;
  if (runtimePromise) {
    const sdk = await import('@qvac/sdk');
    resources = await sdk.getSystemResources({ sample: true }).catch(() => null);
  }
  return { recordedAt: new Date().toISOString(), physicalDevice: Device.isDevice, brand: Device.brand, model: Device.modelName,
    androidVersion: Device.osVersion, androidApi: Platform.Version, totalMemoryBytes: Device.totalMemory,
    architectures: Device.supportedCpuArchitectures, batteryLevel: batteryLevel >= 0 ? batteryLevel : null,
    batteryState, charging: [Battery.BatteryState.CHARGING, Battery.BatteryState.FULL].includes(batteryState), resources };
}
