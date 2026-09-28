const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const protocolRoot = path.resolve(projectRoot, '..', 'packages', 'protocol');

// Packages the protocol package shares with the app. They must resolve to the
// app's copies so the bundle never carries two tweetnacl instances.
const SHARED_DEPS = ['tweetnacl', 'tweetnacl-util', '@noble/hashes', '@babel/runtime'];

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), protocolRoot];

config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),
    '@velo/protocol': protocolRoot,
  },
  resolveRequest: (context, moduleName, platform) => {
    const fromProtocol = context.originModulePath.startsWith(protocolRoot);
    if (fromProtocol && SHARED_DEPS.some((d) => moduleName === d || moduleName.startsWith(`${d}/`))) {
      const appNodeModules = path.join(projectRoot, 'node_modules');
      return context.resolveRequest({ ...context, originModulePath: path.join(projectRoot, 'index.js'), nodeModulesPaths: [appNodeModules] }, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = withNativeWind(config, { input: './global.css' });
