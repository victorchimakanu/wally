// `config` is app.json's "expo" object, passed in by Expo.
module.exports = ({ config }) => {
  const nativeQvac = process.env.WALLY_NATIVE_QVAC === '1';
  return {
    ...config,
    extra: { ...config.extra, nativeQvac },
    plugins: nativeQvac ? [
      ...config.plugins,
      './plugins/with-optional-opencl.cjs',
      ['@qvac/sdk/expo-plugin', { installMissingPrebuilds: true }],
      ['expo-build-properties', { android: { minSdkVersion: 31 } }],
    ] : config.plugins,
  };
};
