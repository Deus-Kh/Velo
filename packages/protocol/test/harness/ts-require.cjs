/* eslint-disable */
// Registers a require hook that transpiles the package's TypeScript on the
// fly (CommonJS, no type-check), so plain `node` scripts can load src/ and
// test/ files without a build step. Used by S12's child process and the
// vector generator.
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  mod._compile(out, filename);
};
