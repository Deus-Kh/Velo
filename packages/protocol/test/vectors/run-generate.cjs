/* eslint-disable */
// Entry point for `npm run vectors:generate`: loads the TypeScript generator
// through the on-the-fly transpile hook and writes libsignal.json.
require('../harness/ts-require.cjs');
const { writeVectors } = require('./generate.ts');
process.stdout.write('wrote ' + writeVectors() + '\n');
