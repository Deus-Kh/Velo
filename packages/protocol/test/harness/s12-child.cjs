/* eslint-disable */
// S12 runs the ratchet in a separate Node process so a synchronous hang can
// be killed at the 5 s deadline (an in-process timeout cannot interrupt a
// blocked event loop). TypeScript sources are transpiled on require.
const path = require('path');
require('./ts-require.cjs');

const nacl = require('tweetnacl');
const { encodeBase64 } = require('tweetnacl-util');
const { initInitiatorSession, initResponderSession } = require(path.join(__dirname, '..', '..', 'src', 'ratchet', 'session.ts'));
const { ratchetEncrypt, ratchetDecrypt } = require(path.join(__dirname, '..', '..', 'src', 'ratchet', 'message.ts'));

const n = Number(process.argv[2]);
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const spk = nacl.box.keyPair();
const signedPreKey = { publicKey: encodeBase64(spk.publicKey), privateKey: encodeBase64(spk.secretKey) };
const a = initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: signedPreKey.publicKey });
const b = initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey });

const e = ratchetEncrypt(a, 'x');
const forged = { ...e.envelope, header: { ...e.envelope.header, n } };

const t0 = Date.now();
try {
  ratchetDecrypt(b, forged);
  process.stdout.write(JSON.stringify({ outcome: 'decrypted', ms: Date.now() - t0 }));
} catch (err) {
  process.stdout.write(JSON.stringify({ outcome: 'threw', code: err && err.code ? err.code : null, ms: Date.now() - t0 }));
}
