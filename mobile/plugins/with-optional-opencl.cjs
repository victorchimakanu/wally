const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

// QVAC declares OpenCL as required. Vulkan/CPU phones must also be installable.
module.exports = config => withGradleProperties(withAndroidManifest(config, mod => {
  for (const library of mod.modResults.manifest.application?.[0]?.['uses-native-library'] ?? []) {
    if (library.$['android:name'] === 'libOpenCL.so') library.$['android:required'] = 'false';
  }
  return mod;
}), mod => {
  // The SDK plugin internally registers build-properties at API 29. Override
  // that generated value to match QVAC's documented Android 12 support floor.
  const existing = mod.modResults.find(item => item.type === 'property' && item.key === 'android.minSdkVersion');
  if (existing) existing.value = '31';
  else mod.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '31' });
  return mod;
});
