/* eslint-disable */
// S12 runs the ratchet in a separate Node process so a synchronous hang can
// be killed at the 5 s deadline (an in-process timeout cannot interrupt a
// blocked event loop). TypeScript sources are transpiled on require.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  mod._compile(out, filename);
};

const { encodeBase64 } = require('tweetnacl-util');
const { createSessionFromX3DH } = require(path.join(__dirname, '..', '..', 'src', 'ratchet', 'session.ts'));
const { ratchetEncrypt, ratchetDecrypt } = require(path.join(__dirname, '..', '..', 'src', 'ratchet', 'message.ts'));

const n = Number(process.argv[2]);
const rootKey = encodeBase64(new Uint8Array(32).fill(0xaa));
const chainKey = encodeBase64(new Uint8Array(32).fill(0xbb));
const a = createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true });
const b = createSessionFromX3DH({ peerUserId: 'a', rootKey, chainKey, isInitiator: false });

const e = ratchetEncrypt(a, 'x');
const forged = { ...e.envelope, header: { ...e.envelope.header, n } };

const t0 = Date.now();
try {
  ratchetDecrypt(b, forged);
  process.stdout.write(JSON.stringify({ outcome: 'decrypted', ms: Date.now() - t0 }));
} catch (err) {
  process.stdout.write(JSON.stringify({ outcome: 'threw', code: err && err.code ? err.code : null, ms: Date.now() - t0 }));
}
