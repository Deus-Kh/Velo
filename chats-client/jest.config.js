module.exports = {
  preset: 'react-native',
  // The RN preset transforms only react-native packages inside node_modules.
  // @noble/* ship ESM-only builds, so they must be transformed too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
  moduleNameMapper: {
    // The protocol package is consumed as TypeScript source (see metro.config.js).
    '^@velo/protocol$': '<rootDir>/../packages/protocol/src/index.ts',
    // Shared crypto deps resolve to the app's copies, exactly as Metro does,
    // so the package's own node_modules never leak into the app's tests.
    '^@noble/hashes/(.*)$': '<rootDir>/node_modules/@noble/hashes/$1',
    '^tweetnacl$': '<rootDir>/node_modules/tweetnacl',
    '^tweetnacl-util$': '<rootDir>/node_modules/tweetnacl-util',
    // Babel injects runtime helpers relative to the transformed file; the
    // protocol package has no @babel/runtime of its own.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
};
