/** @type {import('react-native-worklets/plugin').PluginOptions} */
const workletsPluginOptions = {};

module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        // Base file; the plugin also loads `.env.<mode>` (development / production /
        // test, from Metro's NODE_ENV) and `.env.<mode>.local` on top of it.
        path: '.env',
        // `safe` validates the merged result against .env.example: a key present
        // in the example but missing from the loaded files fails the build
        // instead of yielding `undefined` at runtime.
        safe: true,
        allowUndefined: false,
      },
    ],
    // Must stay last — Babel requirement for the worklets plugin.
    ['react-native-worklets/plugin', workletsPluginOptions],
  ],
};
