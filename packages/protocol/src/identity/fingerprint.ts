import { sha256 } from '@noble/hashes/sha2.js';
import { decodeBase64 } from 'tweetnacl-util';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sortTwoStrings(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function computeSafetyNumber(params: {
  myIdentitySignPub: string;
  theirIdentitySignPub: string;
}): { fingerprintHex: string; displayCode: string } {
  const [k1, k2] = sortTwoStrings(
    params.myIdentitySignPub,
    params.theirIdentitySignPub
  );

  const b1 = decodeBase64(k1);
  const b2 = decodeBase64(k2);

  const combined = new Uint8Array(b1.length + b2.length);
  combined.set(b1, 0);
  combined.set(b2, b1.length);

  const digest = sha256(combined);
  const fingerprintHex = bytesToHex(digest);

  const short = fingerprintHex.slice(0, 30).toUpperCase();
  const displayCode = short.match(/.{1,5}/g)?.join(' ') ?? short;

  return { fingerprintHex, displayCode };
}
