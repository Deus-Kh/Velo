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
const { sealHeader } = require(path.join(__dirname, '..', '..', 'src', 'ratchet', 'header.ts'));
const { decodeBase64 } = require('tweetnacl-util');

const n = Number(process.argv[2]);
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const headerKeyA = encodeBase64(new Uint8Array(32).fill(0xa1));
const nextHeaderKeyB = encodeBase64(new Uint8Array(32).fill(0xb2));
const spk = nacl.box.keyPair();
const signedPreKey = { publicKey: encodeBase64(spk.publicKey), privateKey: encodeBase64(spk.secretKey) };
const a = initInitiatorSession({ peerUserId: 'b', sharedSecret, headerKeyA, nextHeaderKeyB, theirSignedPreKeyPublicKey: signedPreKey.publicKey });
const b = initResponderSession({ peerUserId: 'a', sharedSecret, headerKeyA, nextHeaderKeyB, signedPreKey });

const AD = { senderIdentityKey: encodeBase64(new Uint8Array(32).fill(1)), receiverIdentityKey: encodeBase64(new Uint8Array(32).fill(2)) };
const e = ratchetEncrypt(a, 'x', AD);
// T3.6: the header is encrypted; the forger here holds the sender's header key.
const reseal = (patch) => ({ ...e.envelope, encHeader: sealHeader({ headerKey: decodeBase64(a.headerKeySend), header: { ...e.header, ...patch } }) });
const forged = reseal({ n });

// Warm up the transpiled modules and the hash implementation so the timed call measures the bound, not module loading.
try {
  ratchetDecrypt(b, reseal({ n: 1 }), AD);
} catch (_) {
  /* expected */
}

const t0 = Date.now();
try {
  ratchetDecrypt(b, forged, AD);
  process.stdout.write(JSON.stringify({ outcome: 'decrypted', ms: Date.now() - t0 }));
} catch (err) {
  process.stdout.write(JSON.stringify({ outcome: 'threw', code: err && err.code ? err.code : null, ms: Date.now() - t0 }));
}
