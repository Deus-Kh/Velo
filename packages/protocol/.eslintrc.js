// Purity guard for the protocol package (spec T2.1). The package computes;
// storage, keychain and transport live in the client.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { es2022: true },
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['react-native', 'react-native/*', 'react-native-*'], message: 'packages/protocol is platform-free.' },
          { group: ['@react-native-*', '@react-native-*/*', '@react-native/*'], message: 'packages/protocol is platform-free.' },
          { group: ['*async-storage*', '*keychain*', '*Keychain*'], message: 'No storage in packages/protocol.' },
          { group: ['axios', 'socket.io-client'], message: 'No network in packages/protocol.' },
          { group: ['**/chats-client/**'], message: 'The package must not depend on the app.' },
        ],
      },
    ],
  },
  overrides: [{ files: ['test/**/*.ts'], env: { node: true } }],
};
