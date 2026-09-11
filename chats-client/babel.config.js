/** @type {import('react-native-worklets/plugin').PluginOptions} */
const workletsPluginOptions = {};

module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        // `safe` validates .env against .env.example: a key present in the
        // example but missing from .env fails the build instead of yielding
        // `undefined` at runtime.
        safe: true,
        allowUndefined: false,
      },
    ],
    // Must stay last — Babel requirement for the worklets plugin.
    ['react-native-worklets/plugin', workletsPluginOptions],
  ],
};
