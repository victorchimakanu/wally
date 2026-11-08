const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Native bundles include the real SDK. Expo Go keeps the computer adapter and
// excludes the large worker binary; accidentally invoking it fails explicitly.
config.resolver.resolveRequest = (context, moduleName, platform) => context.resolveRequest(
  context,
  moduleName === '@qvac/sdk' && process.env.WALLY_NATIVE_QVAC !== '1'
    ? path.join(__dirname, 'src/services/phone-sdk-unavailable.ts') : moduleName,
  platform,
);
module.exports = config;
