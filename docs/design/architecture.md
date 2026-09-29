# Velo architecture (as built, 2026-09-28)

This describes the system that exists at the end of Phase 4' (rewritten by
T4.11; the earlier layered sketch is in `docs/archive/`). Every claim below
is verifiable in the code paths named. Normative protocol detail lives in
`docs/AGENT_EXECUTION_SPEC.md` §8; the findings and their status in
`docs/PROJECT_ROADMAP.md` §3.

## 1. Components

```
┌──────────────────────────────┐        TLS (Caddy, Let's Encrypt; app pins the LE roots)
│ Android app (React Native)   │◄──────────────────────────────────────────────────────┐
│  screens ── hooks ── shared/ │   HTTPS REST (axios)      WSS (socket.io)   FCM data-only │
│  @velo/protocol (TS source)  │──────────────┐         ┌──────────────┐    (wake-up:      │
└──────────────────────────────┘              ▼         ▼              │     message id)   │
                                 ┌───────────────────────────────┐     │                   │
                                 │ chats-server (Node 20, dist/) │     │                   │
                                 │  Express routes · socket.io   │─────┼──► Firebase FCM   │
                                 │  lib/: delivery, presence,    │     │                   │
                                 │  lifecycle, logger, metrics   │     │                   │
                                 └───────┬───────────┬───────────┘     │                   │
                                         │           │                 │                   │
                                   ┌─────▼────┐ ┌────▼─────┐           │                   │
                                   │ MongoDB  │ │  Redis   │           │                   │
                                   │ (Atlas)  │ │ limits · │           │                   │
                                   │          │ │ presence·│           │                   │
                                   │          │ │ io adapter          │                   │
                                   └──────────┘ └──────────┘           │                   │
   Prometheus ──scrape /metrics (bearer)──► server   journald ◄── pino JSON lines           │
```

| Component | Where | Notes |
|---|---|---|
| Protocol core | `packages/protocol/src` | Pure TypeScript, no platform imports (lint-enforced). X3DH + Double Ratchet with header encryption, identity binding, safety numbers; Sender Keys for groups and the content envelope that carries them (Phase 6'). Consumed by the app as source (Metro/Jest/tsconfig mappings), never published. |
| App | `chats-client/src` | React Native 0.83 (Android; iOS parked). `screens/` render, `shared/chat` orchestrates (hook, incoming path, adapter, history sync; `groupKeys` / `groupMessaging` / `useGroupChat` for groups), `shared/crypto` holds the I/O wrappers around the core, `shared/storage` the sealed stores (sessions, messages, sender keys), `shared/notifications` push. |
| Server | `chats-server/src` | Express 5 + socket.io 4, compiled to `dist/` (T4.1), run by systemd (T4.2). Relays and briefly stores ciphertext; never sees plaintext, counters or ratchet keys (wire v4). |
| Stores | MongoDB, Redis | Mongo: users and public keys, undelivered ciphertext with TTL (one copy per recipient for groups), receipts, refresh-token families, conversations, groups (members, roles, epoch, system feed). Redis: rate limits, login throttle, presence, socket.io adapter. |
| Ops | `deploy/` | systemd units (server, backup timer), Caddyfile, Prometheus scrape + alerts, Grafana dashboard, host runbook. |
| CI | `.github/workflows/ci.yml` | secret scan + gitleaks, protocol tests with a coverage gate, server tests against an in-memory MongoDB, client typecheck/lint/Jest/bundle, Android debug build. |

## 2. Trust boundaries

- **Device ⇄ server.** The server is untrusted for content: it never holds a
  message key, a session, or plaintext. It is trusted for availability and
  for serving the *public* key material it stores, which the app verifies
  (identity binding signature, signed-prekey signature) and pins (trust on
  first use, change detection). A server or on-path attacker cannot
  impersonate a sender (initiator authentication, T2.13), substitute a
  bundle without the safety number changing, replay a bootstrap, or read
  headers (T3.6).
- **Device ⇄ Google/FCM.** The push carries a message id and nothing else;
  the device fetches and decrypts (T3.3).
- **Device at rest.** Sessions, one-time prekey secrets, the outgoing queue,
  trust pins and the local message store are sealed under a per-user master
  key in the Keychain; long-lived private keys live in the Keychain
  directly. Logout wipes them. Message keys are never kept (T2.14); the
  ratchet state holds only bounded skipped keys.
- **Operator.** Logs redact every secret field (T4.5); metrics carry no user
  identifier (T4.6); backups are as sensitive as the database, no more
  (T4.9).

## 3. Protocol in one paragraph each

**Identity.** Ed25519 signing key + X25519 DH key per user, bound by a
signature over `"velo-identity-binding-v1" ‖ IK_dh`; the server stores the
binding and the identity history and tells peers when it changes. Safety
number: libsignal's numeric fingerprint construction (5200 SHA-512
iterations, 60 digits) over `IK_sign ‖ IK_dh` and the user id.

**Handshake.** X3DH in Signal's form: `IKM = 0xFF×32 ‖ DH1..DH4 [‖ SS]`,
HKDF "WhisperText" expanded to `SK ‖ ck ‖ HK_A ‖ NHK_B` (the first 64 bytes
byte-identical to libsignal, vector-tested). Signed prekeys rotate weekly
and are retained 30 days; one-time prekeys are consumed once and topped up;
the bundle route is budgeted against draining. The optional KEM secret is
the PQXDH extension point (T3.5).

**Ratchet.** Standard Double Ratchet with header encryption (Double Ratchet
§4): `KDF_RK_HE` (96 bytes: RK ‖ CK ‖ NHK), `KDF_CK` (HMAC 0x01/0x02), message
keys expanded with "WhisperMessageKeys" into cipher key, MAC key and a
derived nonce. Wire v4 envelope `{encHeader, ciphertext, mac}`: header
`{n, pn, dhPub}` sealed under the sender's header key, payload secretbox,
MAC over `IK_A ‖ IK_B ‖ encHeader ‖ ciphertext`. Bounds: 100 skipped per
step, 1000 total, 5 epochs; replay window of 256 ids; counters below 2²⁴.
A step is pure: it returns the next session and the plaintext or envelope,
persists nothing, and wipes every intermediate key (T3.4). Nothing is
persisted before a message authenticates (R7; audited).

**Lifecycle.** The responder persists its session only after the first
message decrypts; glare converges on the lower user id with a decrypt-only
secondary session for in-flight messages; a peer's local reset is adopted
when its new packet decrypts (T2.11).

**Content kinds (Phase 7').** The plaintext of any message is a versioned
envelope (`content/envelope.ts`): text (with forward provenance), the
sender-key traffic of groups, and message actions (reaction, edit, delete
request, disappearing timer, profile). Actions are authenticated by the
session like text, opaque to the server, applied to the device's sealed
store by one path (`chat/actions.ts`) with the rule that only a message's
sender may edit or delete it, and never shown as messages. Profiles (name,
avatar) reach each contact this way too; the server stores none.

**Attachments (Phase 8').** A photo or voice note is sealed on the device
under a fresh 32-byte key (64 KiB XSalsa20-Poly1305 chunks, an HMAC-SHA256
trailer, SHA-256 digest of the blob), metadata stripped first; the
ciphertext goes to the server's blob store (files under `BLOB_DIR`, or an
S3-compatible bucket by presigned URL) under a 128-bit random id with a
30-day TTL, and the message carries id, key, digest, size and type inside
the session. A recipient downloads by id, checks the digest before touching
a key and the MAC before opening a chunk, and keeps the plaintext as a file
sealed under its session master key. The server learns size and timing.

**Groups (Phase 6').** Per-user Sender Keys: each member keeps one
symmetric chain and one Ed25519 signing key per group and membership
epoch; a message is encrypted once under the sender's chain and signed
over `v ‖ keyId ‖ iteration ‖ groupId ‖ senderUserId ‖ ciphertext`
(`group v1`, spec §8.2). The state reaches every member as control
content inside the pairwise Double Ratchet (`{kind:'skdm'}`), never
through the server in the clear; a member lacking a key asks the sender
(`skdm-request`). Every add, remove or leave increments the server's
epoch; each remaining member then makes a fresh keyId and distributes it
to the current members only, so a removed member reads nothing after the
change and a new member nothing before it. Replay window, skip bounds and
zeroization are the ratchet's. Forward secrecy per message, no
post-compromise security inside an epoch (DEVIATION-9, as Signal).

## 4. Message path (send → deliver → delete)

1. **Send** (`shared/socket/messaging.ts`): ensure a session (X3DH if none),
   `ratchetEncrypt`, persist the advanced session, store the outgoing
   message locally as `sending`, emit `message:send` (protoVersion 4).
2. **Server** (`socket/setupSocket.ts`): validate shape and size only, assign
   a per-conversation `seq` atomically, store the ciphertext with a 30-day
   expiry, emit `message:new` to the recipient's room (any process, via the
   Redis adapter), or send a data-only push if no socket is live.
3. **Receive** (`shared/chat/incoming.ts` via the live socket, the chat's
   history sync, the chat list's ingest for chats not open, or the push
   wake-up): decrypt through the one receive path, store the plaintext in
   the sealed local store, then ack `message:delivered`.
4. **Delivery** (`lib/delivery.ts`): the ack deletes the ciphertext and keeps
   a metadata-only receipt so the sender learns delivery/read even if it was
   offline; receipts expire with the TTL. Ordering everywhere is `seq`; the
   sender's clock is display only.
5. **Groups** (`group:send`, `lib/groups.ts`): the same path with one Message
   document per recipient (`g1`, `groupId`, `epoch`, `conversationId =
   group:<id>`, one `seq` from the group), so delivery, receipts, ordering,
   TTL and the push wake-up are unchanged; a stale epoch or a non-member is
   refused before anything is stored. On the device, group copies never
   enter the pairwise paths: `chat/groupMessaging.ts` decrypts under the
   sender's stored key, stores under the `group:<id>` slot, acks, and asks
   for a missing or stale key over the pairwise session.

## 5. Operations

- **Process.** `npm run build` → `node dist/index.js` under
  `deploy/systemd/velo-server.service` (unprivileged, hardened, restart on
  crash with a flap limit). One shutdown path for signals and crashes with a
  force-exit deadline; `/health` reports MongoDB readiness.
- **State.** MongoDB (Atlas) for durable state; Redis required in
  production for rate limits, presence and the socket.io adapter; daily
  driver-based snapshots with checksummed manifests, restore rehearsed in
  CI.
- **Observability.** pino JSON to journald with field-name redaction and
  request ids; Prometheus metrics (delivery latency, device-reported decrypt
  failures by code, prekey depletion, push results) behind a bearer token;
  alert rules and a Grafana dashboard under `deploy/`.
- **Transport.** Caddy terminates TLS with Let's Encrypt; the app pins the
  Let's Encrypt roots with a fail-open expiration; CORS allow-list from
  `CORS_ORIGINS` (native clients send no Origin).

## 6. Known limits (deliberate, recorded)

- Android only; iOS parked (T1.16).
- One device per account; no calls, no backup of history, no video or
  generic files (photos and voice notes since Phase 8'). Groups: `deviceId` is always 0 in the distribution record, so
  multi-device changes nothing in the format.
- Profiles: avatars are emoji-on-colour (the photo picker now shipped for
  attachments could feed a JPEG avatar later; a JPEG is accepted and shown).
- Attachments: capped at 8 MiB; a single upload with one retry (no resume);
  no thumbnail asset (dimensions and auto-download up to 2 MiB); voice
  notes show duration and progress, not a waveform; a decrypted voice note
  exists as a temporary plaintext file for the duration of playback. Local search is a linear scan of the
  sealed store, bounded to the newest 2000 records per conversation.
- "Delete for everyone" is a request the other devices honour; a copy may
  already have been read. A block is silent: the blocked user is not told,
  and its pre-block copies still on the server are dropped on the
  recipient's device.
- Privacy: online and last-seen are hidden unless the user opts in; read
  receipts are the reader's choice. An access token issued before an
  account deletion stays valid until it expires but identifies nobody.
- Groups: no post-compromise security inside a membership epoch; copies in
  flight from a member removed before they are opened are lost; the server
  learns the group's membership, sender and timing of every message
  (DEVIATION-9).
- Presence of a process that died reads as online for up to two minutes.
- Zeroization is best effort in JavaScript (DEVIATION-8); the base64 keys
  inside a session record cannot be wiped.
- Header encryption makes an epoch evicted with its header key
  unrecognisable: such a message reads as a decrypt failure.
- The server still learns sender, recipient, time, size and the bootstrap
  packet of a session-creating message; sealed sender is the next
  metadata step (§10 of the spec).
