module.exports = {
  preset: 'react-native',
  // The RN preset transforms only react-native packages inside node_modules.
  // @noble/* ship ESM-only builds, so they must be transformed too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
};
