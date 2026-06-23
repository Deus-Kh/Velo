// import nacl from 'tweetnacl';
// import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
// import type { RatchetSessionV2 } from './sessionTypes';
// import { kdfRootKey } from './ratchetRoot';

// /**
//  * Applies a DH ratchet step when we detect peer dhPub change.
//  *
//  * Steps (Signal-like):
//  * 1) PN = Ns, reset Ns/Nr, clear skipped keys (MVP)
//  * 2) RK, CKr = KDF_RK(RK, DH(DHs_priv, DHr_new))
//  * 3) Set DHr = DHr_new
//  * 4) Generate new DHs
//  * 5) RK, CKs = KDF_RK(RK, DH(DHs_new_priv, DHr))
//  */
// export function applyDhRatchet(session: RatchetSessionV2, newPeerDhPubB64: string): RatchetSessionV2 {
//   if (!session.DHsPrivateKey) {
//     throw new Error('Session missing DHs private key');
//   }

//   const rootKeyBytes = decodeBase64(session.rootKey);

//   const dhsPriv = decodeBase64(session.DHsPrivateKey);
//   const dhrNewPub = decodeBase64(newPeerDhPubB64);

//   // 1) Reset counters and skipped keys (MVP)
//   const PN = session.Ns;

//   // 2) Derive receiving chain from DH(DHs_priv, DHr_new)
//   const dh1 = nacl.scalarMult(dhsPriv, dhrNewPub);
//   const step1 = kdfRootKey({ rootKey: rootKeyBytes, dhOut: dh1 });

//   // 3) Update DHr
//   const DHrPublicKey = newPeerDhPubB64;

//   // 4) Generate new DHs
//   const dhsNew = nacl.box.keyPair();

//   // 5) Derive sending chain from DH(DHs_new_priv, DHr)
//   const dh2 = nacl.scalarMult(dhsNew.secretKey, dhrNewPub);
//   const step2 = kdfRootKey({ rootKey: step1.newRootKey, dhOut: dh2 });

//   return {
//     ...session,

//     // Update root and chains
//     rootKey: encodeBase64(step2.newRootKey),
//     chainKeyRecv: encodeBase64(step1.newChainKey),
//     chainKeySend: encodeBase64(step2.newChainKey),

//     // Reset counters for new chains
//     PN,
//     Ns: 0,
//     Nr: 0,

//     // MVP: clear skipped on ratchet boundary
//     skippedKeys: {},

//     // Save new DH keys
//     DHrPublicKey,
//     DHsPublicKey: encodeBase64(dhsNew.publicKey),
//     DHsPrivateKey: encodeBase64(dhsNew.secretKey),
//   };
// }


// dhRatchet.ts (или applyDhRatchet.ts — как у тебя называется файл)
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import type { RatchetSessionV2 } from './sessionTypes';
import { kdfRootKey } from './ratchetRoot';

/**
 * Normalizes base64 values coming from DB/API/storage:
 * - converts spaces to '+'
 * - converts url-safe '-','_' to '+','/'
 * - restores padding '='
 */
function normalizeB64(b64: string): string {
  let s = String(b64).replace(/ /g, '+').trim();
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);
  return s;
}

/**
 * Applies a DH ratchet step when we detect peer dhPub change.
 *
 * Signal-like:
 * 1) PN = Ns, reset Ns/Nr, (MVP: clear skipped keys)
 * 2) RK, CKr = KDF_RK(RK, DH(DHs_priv, DHr_new))
 * 3) Set DHr = DHr_new
 * 4) Generate new DHs
 * 5) RK, CKs = KDF_RK(RK, DH(DHs_new_priv, DHr))
 */
export function applyDhRatchet(session: RatchetSessionV2, newPeerDhPubB64: string): RatchetSessionV2 {
  if (!session.DHsPrivateKey) {
    throw new Error('Session missing DHs private key');
  }

  // Normalize all stored b64 inputs to avoid silent decode mismatches
  const rootKeyBytes = decodeBase64(normalizeB64(session.rootKey));

  const dhsPriv = decodeBase64(normalizeB64(session.DHsPrivateKey));
  const peerDhPubB64 = normalizeB64(newPeerDhPubB64);
  const dhrNewPub = decodeBase64(peerDhPubB64);

  // X25519 keys must be 32 bytes
  if (dhsPriv.length !== 32) throw new Error('Bad DHsPrivateKey length');
  if (dhrNewPub.length !== 32) throw new Error('Bad peer DH public key length');

  // 1) Reset counters and skipped keys (MVP)
  const PN = session.Ns;

  // 2) Derive receiving chain from DH(DHs_priv, DHr_new)
  const dh1 = nacl.scalarMult(dhsPriv, dhrNewPub);
  const step1 = kdfRootKey({ rootKey: rootKeyBytes, dhOut: dh1 });

  // 3) Update DHr
  const DHrPublicKey = peerDhPubB64;

  // 4) Generate new DHs (for sending chain)
  const dhsNew = nacl.box.keyPair();

  // 5) Derive sending chain from DH(DHs_new_priv, DHr)
  const dh2 = nacl.scalarMult(dhsNew.secretKey, dhrNewPub);
  const step2 = kdfRootKey({ rootKey: step1.newRootKey, dhOut: dh2 });

  console.warn('[v2] applyDhRatchet', {
  oldDHs: session.DHsPublicKey?.slice(0, 10),
  newPeerDhPub: newPeerDhPubB64.slice(0, 10),
});


  return {
    ...session,

    // Update root and chains
    rootKey: encodeBase64(step2.newRootKey),
    chainKeyRecv: encodeBase64(step1.newChainKey),
    chainKeySend: encodeBase64(step2.newChainKey),

    // Reset counters for new chains
    PN,
    Ns: 0,
    Nr: 0,

    // MVP: clear skipped on ratchet boundary (consider namespacing by dhPub later)
    skippedKeys: {},

    // Save new DH keys
    DHrPublicKey,
    DHsPublicKey: encodeBase64(dhsNew.publicKey),
    DHsPrivateKey: encodeBase64(dhsNew.secretKey),
  };
}
