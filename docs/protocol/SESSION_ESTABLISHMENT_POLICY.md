# Session Establishment Policy

This document defines the lifecycle rules for establishing and using a `v2` secure chat session.

It is the source of truth for:

- send behavior
- realtime receive behavior
- history replay behavior
- broken session detection
- later recovery/reset behavior

The goal is to make `v2` session behavior deterministic across all entry points.

---

## 1. Scope

This policy applies to:

- one-to-one chats only
- `protoVersion = 2`
- current development mode where `v2` is the active protocol

This policy does not yet define:

- multi-device session sync
- groups
- production trust UX wording

---

## 2. Core Rule

A `v2` message is valid only if the receiver can determine one of the following:

1. a valid local session already exists for that peer
2. a valid `initPacket` is attached and can be used to create the missing local session

If neither is true, the message is not decryptable and this is treated as an error, not a fallback-to-v1 scenario.

---

## 3. Session States

For the current architecture, a peer session can be treated as being in one of these logical states:

### `none`

No local `v2` session exists for `(myUserId, peerUserId)`.

### `local_established`

A local `v2` session exists and can be used for encrypt/decrypt.

### `bootstrap_required`

A `v2` message is encountered but no local session exists yet. Session creation is only allowed if a valid `initPacket` is available.

### `broken`

A session exists but cannot be used safely because the expected decrypt/session progression failed in a way that normal replay/bootstrap cannot explain.

### `reset_required`

The app has concluded that the conversation must be re-established explicitly, rather than continuing with current local session state.

### Identity states (T2.13)

Orthogonal to the session states above, each peer has an identity state on this device:

#### `unverified-first-contact`

The peer's identity (both keys, binding verified) was pinned silently on first contact. Sessions work; the safety number has not been compared out of band.

#### `verified`

The user compared the safety number and marked the identity verified (VerifyContactScreen). Same crypto path as above; only the badge differs.

#### `identity-changed-blocked`

A bundle, an `initPacket`, or an `identity:changed` event presented an identity that does not match the pin (`IDENTITY_MISMATCH`). No session is created or used for this peer, sending is blocked, and the chat shows the security-warning class until the user either verifies out of band or accepts the new identity, which re-pins from the server (binding verified) and drops the session so the next message re-bootstraps.

Rules: the pin, never the server or the packet, decides identity; first contact pins silently; a mismatch is never resolved automatically; accepting requires a user action.

---

## 4. Send Path Rules

### Rule 4.1

Sending a `v2` message always requires a local `v2` session.

### Rule 4.2

If no local session exists at send time:

- call `ensureV2Session(myUserId, peerUserId)`
- create a new local session via X3DH
- obtain `initPacket`

### Rule 4.3

`initPacket` is attached only when the local session was created during this send flow.

That means:

- existing session -> no `initPacket`
- newly created session -> attach `initPacket`

### Rule 4.4

If session creation fails, the send fails loudly.

Current development policy:

- no silent fallback to `v1`

---

## 5. Realtime Receive Rules

### Rule 5.1

When a realtime `v2` message arrives:

- try loading local session for sender peer

### Rule 5.2

If local session exists:

- use `decryptV2`

### Rule 5.3

If local session does not exist:

- if `initPacket` exists, create session from incoming bootstrap
- reload the created session
- then run `decryptV2`

### Rule 5.4

If local session does not exist and `initPacket` is absent:

- this is a controlled failure
- do not invent a session
- do not fall back to `v1`

This case means the receiver was given ciphertext without enough material to bootstrap the conversation.

---

## 6. History Replay Rules

### Rule 6.1

History must follow the same establishment rules as realtime.

History is not allowed to have a different “magic” session policy.

### Rule 6.2

When loading history:

- load local session once
- process messages oldest -> newest

### Rule 6.3

For inbound `v2` history items:

- if local session exists, prefer replay through `decryptV2`
- if local session does not exist and `initPacket` exists, create session from it
- then continue replay using the newly created session

### Rule 6.4

If replay fails but a stored message key exists for that exact message:

- stored key lookup may be used as a fallback for history rendering

This fallback is allowed only for history usability, not as a replacement for the normal session lifecycle.

### Rule 6.5

If local session does not exist and history item has no `initPacket`:

- history may display controlled encrypted/unsupported state
- it must not fabricate a bootstrap path

---

## 7. `initPacket` Attachment Policy

### Rule 7.1

`initPacket` exists to bootstrap the responder-side session.

### Rule 7.2

Current policy:

- attach `initPacket` only on first send that creates the local session
- (T2.11) an `initPacket` for a peer that already has a session is not ignored: it means the peer built its own session (glare, or a local reset on the peer). A candidate session is built from it and must decrypt the accompanying message; only then is anything persisted. See §8.

### Rule 7.3

The server must preserve `initPacket` anywhere the first inbound message might later be needed:

- realtime delivery
- persisted message/history path

### Rule 7.4

If future architecture introduces a separate bootstrap/session entity, this policy can be updated, but the behavioral contract must remain the same:

- receiver must always have enough information to bootstrap exactly once

---

## 8. Broken Session Rules

### Resolution before anything is called broken (T2.11)

- **Bootstrap:** the responder session is persisted only after the first message decrypts (R7); the one-time prekey secret is deleted only after that; the packet's ephemeral key is remembered and a replay is `REPLAY_DETECTED`. A packet whose message does not decrypt leaves no trace.
- **Glare** (both sides bootstrapped at once; our session has never received): the lower user id's session wins, deterministically on both sides. The winner keeps its session and keeps the peer's as a decrypt-only *secondary* until the peer sends on the winner's session; the loser adopts the peer's session. No message is lost and no reset is needed.
- **Peer reset** (our session has received before, a new packet arrives whose message decrypts under the candidate): the peer reset locally and re-initiated; adopt its session. A packet that does not decrypt changes nothing (`DECRYPT_FAILED`).
- **Reinstall** (identity changed): `IDENTITY_MISMATCH`, sending blocked until the user verifies or accepts; accepting drops the stale session.

A session should be considered `broken` when one of these is true:

### Case 8.1

A `v2` message arrives, no session exists, and there is no usable `initPacket`.

### Case 8.2

Session exists, but decrypt fails in a way that:

- is not explained by out-of-order handling
- is not explained by stored history key fallback
- is not explained by missing bootstrap on first inbound message

### Case 8.3

Local state was wiped or replaced, and the remaining conversation state can no longer be resumed deterministically.

At this stage, the app should not silently continue pretending the session is healthy.

---

## 9. Reset Required Rules

The app should transition toward `reset_required` when:

- session is classified as broken
- decrypt consistently fails for current conversation
- local reinstall/storage wipe made the active session unusable

This policy does not yet define the full reset UX. It only defines when the situation should be treated as requiring reset instead of more silent retries.

---

## 10. Invariants

These must remain true:

- send, realtime receive, and history replay all follow the same bootstrap logic
- `initPacket` is only used to create a missing session, never to override a healthy one
- session creation is deterministic for a given sender/receiver/bootstrap
- no silent fallback to `v1`
- history fallback via stored message keys must not replace the normal session lifecycle

---

## 11. Minimum Acceptance Criteria

This policy is considered implemented enough when all of the following are true:

- first outbound message creates session if needed
- first inbound message can bootstrap receiver session if needed
- history can bootstrap from first inbound message if receiver was offline
- existing healthy session is reused instead of recreated
- missing session + missing `initPacket` becomes explicit failure
- no normal send path depends on `v1`

---

## 12. Next Implementation Order

After this document, implementation work should proceed in this order:

1. align send path with this policy
2. align realtime receive path with this policy
3. align history replay path with this policy
4. codify broken session detection
5. implement reset/recovery behavior
