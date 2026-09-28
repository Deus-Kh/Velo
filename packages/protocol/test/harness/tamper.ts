import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { sealHeader, type MessageHeader } from '../../src/ratchet/header';
import type { NewMessageDTO } from './fakeServer';
import type { VirtualClient } from './virtualClient';

/**
 * Wire-level header tampering for the T3.6 scenarios. The header is
 * encrypted, so an on-path attacker can only flip bytes; forging a
 * plaintext field models an attacker who also holds the sender's header
 * key (the strongest header adversary the MAC still has to stop).
 */

/** Flip one byte of the encrypted header (on-path attacker without keys). */
export function flipEncHeader(dto: NewMessageDTO): NewMessageDTO {
  const bytes = decodeBase64(dto.v4.encHeader);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
  return { ...dto, v4: { ...dto.v4, encHeader: encodeBase64(bytes) } };
}

/** Re-seal the sender's own header with a patch, under the sender's current header key. */
export function resealHeader(sender: VirtualClient, dto: NewMessageDTO, patch: Partial<MessageHeader>): NewMessageDTO {
  const session = sender.sessionState(dto.toUserId);
  if (!session?.headerKeySend) throw new Error('sender has no header key');
  const header = { ...sender.sentHeader(dto.clientMessageId), ...patch };
  return { ...dto, v4: { ...dto.v4, encHeader: sealHeader({ headerKey: decodeBase64(session.headerKeySend), header }) } };
}

/** A header sealed under a key nobody in the conversation knows (an unknown session or epoch). */
export function alienHeader(dto: NewMessageDTO, header: MessageHeader = { n: 0, pn: 0, dhPub: encodeBase64(nacl.box.keyPair().publicKey) }): NewMessageDTO {
  return { ...dto, v4: { ...dto.v4, encHeader: sealHeader({ headerKey: nacl.randomBytes(32), header }) } };
}
