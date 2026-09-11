# MASTER ROADMAP
**Modern Cross-Platform Secure Communication System**

This document is the detailed implementation roadmap for the secure chat system across `chats-client` and `chats-server`.

It is not just a feature list. It also documents the hidden protocol dependencies that must exist for the system to be correct in production, especially around E2EE session lifecycle, offline delivery, history replay, and recovery flows.

---

## 1. Goals

The system should provide:

- secure one-to-one messaging
- realtime delivery
- encrypted history at rest on the server
- forward secrecy
- post-compromise recovery
- multi-account support on one device
- a path toward media, groups, and calls without rewriting the crypto core

The system should avoid:

- plaintext messages on the server
- coupling product UX to unstable cryptographic state
- hidden bootstrap assumptions
- protocol ambiguity caused by temporary mixed-mode behavior

---

## 2. Core Design Principles

### 2.1 Security Principles

- The server stores ciphertext, never plaintext.
- Identity verification must be possible.
- Session state is local to the device and account-scoped.
- Message keys must not be reused.
- Recovery flows must be explicit rather than implicit.

### 2.2 Product Principles

- Existing working chat behavior should degrade gracefully.
- New protocol steps should be introduced with feature flags or controlled rollout.
- Realtime and history flows must produce the same decrypt result.
- Offline recipients must still be able to initialize sessions correctly.
- The same conversation should survive app restarts, reconnections, and pagination.
- During development, protocol simplicity is preferred over preserving disposable legacy test data.

### 2.3 Engineering Principles

- Protocol state transitions should be observable in logs.
- Storage keys must be namespaced by account and peer.
- Every major crypto step should have at least one integration scenario test.
- Temporary compatibility layers should have an explicit removal plan.

---

## 3. System Scope

### 3.1 Included

- auth
- realtime 1:1 chat
- X3DH bootstrap
- Double Ratchet evolution
- encrypted history retrieval
- message and conversation models
- trust UX
- media and voice as later phases

### 3.2 Not Initially Included

- multi-device session sync
- key transparency infrastructure
- sealed sender
- anonymous metadata protection
- full audited Signal-compatible implementation

These can be later roadmap items, but the current architecture should avoid blocking them.

---

## 4. Current Status Snapshot

### 4.1 Already Implemented or Partially Implemented

- auth
- Socket.IO realtime
- legacy encrypted chat mostly sunset, with only minor cleanup still remaining
- Ed25519 identity signing keys
- X25519 identity DH keys
- signed prekeys
- one-time prekeys
- X3DH with identity DH contribution
- local v2 session storage
- chain ratchet basics
- wire format v2
- session bootstrap transport for first v2 message
- session establishment policy and broken-session detection
- manual session reset and recovery MVP
- history fetch centered on v2
- partial out-of-order handling
- partial DH ratchet support
- v2 enabled as the active development chat protocol

### 4.2 Current Development Direction

The project is currently in a development-only phase:

- there are no real production conversations to preserve
- old test chats can be deleted safely
- `v2` stabilization now has higher priority than long-term `v1` coexistence

Because of this, the near-term plan is:

1. stabilize `v2`
2. validate core scenarios on clean state
3. finish remaining Block 1 validation
4. move into Block 2 once `v2` core behavior is considered stable enough
### 4.3 Recently Discovered Architectural Gap

The first-message bootstrap path for new v2 chats needs to be an explicit roadmap item.

Why this matters:

- Initiator can derive a local v2 session after X3DH.
- Responder cannot derive the same session unless the bootstrap data reaches them.
- This bootstrap must work for:
  - realtime delivery
  - offline delivery
  - history replay
- Without this, first incoming v2 messages may remain undecryptable or may poison later ratchet state.

This gap is now explicitly represented in the roadmap below.

---

## 5. Phase Plan

The roadmap is organized into blocks. Each block has:

- objective
- scope
- technical details
- done criteria
- risks

---

## 6. Block 0 - Foundation

### 6.1 Auth

#### Objective

Establish stable user identity and session lifecycle.

#### Scope

- register
- login
- session hydration
- logout
- token-based auth
- account switching

#### Technical Requirements

- store auth session safely
- reconnect sockets with fresh auth state
- isolate user-scoped crypto material by `userId`
- clear or rotate account-local caches when switching users

#### Done Criteria

- user can register, login, logout
- auth survives app restart
- switching accounts does not leak crypto/session state between users

#### Risks

- stale auth token on socket reconnect
- shared local storage keys across accounts

---

### 6.2 Realtime Transport

#### Objective

Provide stable encrypted message transport without assuming plaintext inspection by the server.

#### Scope

- Socket.IO connection
- auth on connect
- per-user room join
- `message:send`
- `message:new`

#### Technical Requirements

- sender identity must come from socket auth, not client payload
- socket reconnect must restore subscriptions cleanly
- transport format must support protocol versioning

#### Done Criteria

- authenticated users receive encrypted realtime messages reliably
- reconnect does not duplicate listeners or corrupt UI

#### Risks

- duplicate subscriptions
- lost listener cleanup
- race conditions between history and realtime

---

### 6.3 Legacy E2EE

#### Objective

Keep existing legacy chat only as a temporary development safety net until `v2` is stable enough to replace it.

#### Scope

- shared-secret based encryption
- send/decrypt path
- history support
- temporary only, pending removal

#### Done Criteria

- legacy behavior remains available only while `v2` stabilization is incomplete
- there is a clear removal checkpoint

#### Exit Criteria

This block is considered complete when:

- `v2` passes the stabilization checklist
- runtime fallback to `v1` is removed
- legacy send/decrypt/history code is deleted

---

### 6.4 Identity Keys

#### Objective

Establish long-term identity material for authentication and key agreement.

#### Scope

- Ed25519 signing keys
- X25519 identity DH keys
- local secure storage

#### Technical Requirements

- per-account key generation
- no accidental cross-account reuse
- durable storage across app restarts

#### Done Criteria

- every user has signing + DH identity keys
- keys survive normal app restart

---

### 6.5 PreKey Infrastructure

#### Objective

Provide one-shot bootstrap material for asynchronous secure session setup.

#### Scope

- signed prekeys
- one-time prekeys
- verification and top-up

#### Technical Requirements

- signed prekey must be verifiable with identity signing key
- one-time prekeys must be consumed once
- top-up policy must prevent depletion

#### Done Criteria

- bundle fetch works
- bundle verification works
- responder can use local secrets corresponding to uploaded public prekeys

#### Risks

- prekey exhaustion
- mismatch between uploaded bundle and local secure storage

---

### 6.6 X3DH

#### Objective

Derive initial shared session keys for asynchronous chat initiation.

#### Scope

- initiator flow
- responder flow
- identity DH contribution
- derive `rootKey` and initial `chainKey`

#### Technical Requirements

- both sides must derive identical initial secrets
- initiator must include enough bootstrap information for responder
- responder must validate and consume required local prekeys

#### Done Criteria

- initiator and responder derive matching session material
- one-time prekey is consumed correctly if used

#### Risks

- missing local one-time prekey secret
- mismatch in DH inputs order

---

## 7. Block 1 - Signal-Style Cryptographic Core

This is the highest priority block.

---

### 7.1 Session Store

#### Objective

Persist local secure session state per peer.

#### Stored State

- `protoVersion`
- `rootKey`
- `chainKeySend`
- `chainKeyRecv`
- `Ns`
- `Nr`
- `PN`
- `DHsPublicKey`
- `DHsPrivateKey`
- `DHrPublicKey`
- `skippedKeys`

#### Technical Requirements

- namespace by `(myUserId, peerUserId)`
- persist after every meaningful state transition
- support account isolation
- cleanup on logout and reset

#### Done Criteria

- sessions persist across app restart
- multiple peers maintain independent state
- multiple accounts do not collide

#### Risks

- stale state after partial failure
- overwriting session from wrong account context

---

### 7.2 Chain Ratchet

#### Objective

Generate a fresh message key for every message.

#### Scope

- derive `messageKey` from chain key
- advance send chain
- advance recv chain
- maintain counters

#### Technical Requirements

- never reuse `messageKey`
- persist updated chain state after encrypt/decrypt
- support deterministic replay of received messages if needed

#### Done Criteria

- sequential messages from same sender all use distinct keys
- current key compromise does not reveal previous message contents

---

### 7.3 Wire Format v2

#### Objective

Introduce the ratchet-aware protocol format that will become the default and then the only active chat protocol.

#### Format

- `protoVersion`
- `v2.header.n`
- `v2.header.pn`
- `v2.header.dhPub`
- `v2.nonce`
- `v2.ciphertext`

#### Technical Requirements

- server stores v2 payloads as the long-term target format
- mixed-mode support may exist temporarily during stabilization
- client chooses decrypt handler by version
- format must be stable across history and realtime

#### Done Criteria

- v2 format is stable across send, receive, and history
- same API can return both versions safely

---

### 7.4 Session Bootstrap Transport

#### Objective

Define and implement how responder receives the material required to create the initial v2 session.

#### Why This Is Required

X3DH is not complete in product terms until the responder receives the bootstrap data.

If initiator alone creates a session locally:

- initiator can encrypt first v2 message
- responder cannot derive corresponding recv chain
- first incoming message may fail to decrypt
- history replay may also fail

#### Responsibilities

- transport `initPacket`
- persist bootstrap when necessary
- allow responder to lazily create session
- support realtime delivery
- support offline recipient
- support history replay later

#### Candidate Designs

##### Option A: Attach to first v2 message

Pros:

- simplest
- realtime and history naturally stay aligned
- no separate bootstrap lifecycle object needed

Cons:

- handshake data sits in message model

##### Option B: Separate `session:init` event

Pros:

- cleaner separation of concerns

Cons:

- requires ordering guarantees or retry
- can race with first message

##### Option C: Separate server-side session/bootstrap entity

Pros:

- cleanest long-term design
- explicit lifecycle

Cons:

- more schema and lifecycle complexity

#### Current Recommendation

For MVP and stabilization:

- attach bootstrap to the first v2 message or equivalent persisted bootstrap path
- ensure responder can create session from both realtime and history payloads

#### Done Criteria

- new chat first message decrypts on receiver
- offline receiver can later open chat and decrypt first v2 message
- history replay can recover the same session path

---

### 7.5 Session Establishment Policy

#### Objective

Define the lifecycle rules for when a v2 session is created and when it is considered usable.

#### Required States

- no session
- bootstrap pending
- local session created
- peer session likely established
- reset required

#### Questions This Must Answer

- when is `ensureV2Session` called
- when is bootstrap attached
- when do we stop attaching bootstrap
- how do we detect stale or broken session
- when do we fail loudly versus recover automatically

#### Done Criteria

- system behavior is deterministic for:
  - new chat
  - existing v2 chat
  - reinstall on one device
  - session wipe on one device

#### Current Status

- implemented at MVP level
- policy documented in `SESSION_ESTABLISHMENT_POLICY.md`
- send, realtime receive, and history replay are aligned to the same bootstrap rules
- broken-session conditions now surface as explicit state instead of silent fallback

---

### 7.6 Out-of-Order Handling

#### Objective

Handle delayed and reordered delivery without corrupting session state.

#### Scope

- skipped key window
- replay protection
- bounded storage
- DoS limits

#### Technical Requirements

- skipped keys must be limited
- old messages should decrypt only if matching skipped key exists
- out-of-order support must not allow unbounded memory growth

#### Done Criteria

- small delivery reorder is handled correctly
- replayed old ciphertext is rejected or safely ignored

#### Current Status

- MVP only
- enough for current development, but not yet treated as hardened
- should be revisited if reorder bugs appear during Block 2 and Block 3 work

---

### 7.7 DH Ratchet

#### Objective

Provide post-compromise security by rotating DH ratchet material.

#### Scope

- detect new peer `dhPub`
- derive new recv chain
- generate new local send ratchet key
- derive new send chain
- reset epoch-local counters

#### Technical Requirements

- apply ratchet exactly when peer ratchet key changes
- namespace skipped keys by DH epoch or equivalent identifier
- avoid collisions between old and new chains

#### Done Criteria

- conversation continues after ratchet step
- old epoch keys do not collide with new epoch logic

#### Risks

- applying ratchet too early
- applying ratchet twice
- history replay using wrong epoch

#### Current Status

- implemented in working form
- still considered validation-sensitive
- not blocked on new architecture work unless real scenario failures appear

---

### 7.8 History Key Strategy

#### Objective

Make history decryption reliable across app restart without weakening the ratchet model.

#### Scope

- encrypted-at-rest storage for per-message keys when needed
- distinguish incoming vs outgoing key storage
- use stored keys for history fallback
- preserve forward progression for active session logic

#### Technical Requirements

- history decryption must not silently mutate current ratchet state incorrectly
- if message keys are stored, they must be encrypted locally
- keys must be namespaced by peer, direction, epoch, and message number

#### Done Criteria

- reopening chat after restart shows decryptable history
- stored key lookup is deterministic and bounded

#### Current Status

- implemented in practical MVP form
- history prefers replay for inbound messages when session exists
- stored message keys are used as a bounded fallback for rendering history
- controlled failure now exists for inbound history items with neither session nor `initPacket`

---

### 7.9 Enable v2 in Chat

#### Objective

Make `v2` the default chat protocol for all active development flows, then prepare the project for `v2-only`.

#### Scope

- use `v2` for all new and actively tested chats
- keep mixed-mode only if it still helps short-term stabilization
- remove silent fallback behavior that hides `v2` failures
- prepare codepaths for `v2-only` runtime

#### Done Criteria

- new dialogs choose `v2` consistently
- `v2` failures are visible and diagnosable
- the project is ready to disable `v1` at runtime

#### Current Status

- done for current development mode
- runtime behavior is effectively `v2`-first / `v2`-only for active paths
- legacy compatibility is no longer treated as a roadmap priority

---

### 7.11 Legacy v1 Sunset

#### Objective

Remove `v1` once `v2` is stable enough that keeping both protocols only adds complexity.

#### Scope

- remove runtime fallback to `v1`
- remove legacy send path
- remove legacy decrypt path
- remove legacy history branches
- simplify DTOs and policy logic where appropriate

#### Preconditions

- first-message bootstrap is stable
- reply path is stable
- chat reopen works
- app restart works
- offline receiver works
- session reset/recovery works at least at MVP level

#### Done Criteria

- project can operate in `v2-only` mode
- no active code path silently sends or decrypts `v1`
- roadmap focus can move entirely to `v2` hardening and product features

#### Current Status

- mostly complete in runtime behavior
- remaining work is cleanup and final deletion of dead legacy branches when convenient

---

### 7.10 Session Reset and Recovery

#### Objective

Recover from broken local state without leaving the user permanently locked out of a conversation.

#### Scope

- manual reset
- auto-detection of unrecoverable mismatch
- wipe and re-bootstrap
- UX for explaining secure reset

#### Done Criteria

- reinstall or storage wipe on one device can recover with explicit session reset
- errors do not leave chat permanently unusable

#### Current Status

- manual recovery implemented at MVP level
- broken-session state can raise `reset_required`
- chat screen exposes a secure session reset action for recovery
- further UX polish belongs to later blocks, not Block 1

---

## 8. Block 2 - Messages, History, Conversations

### 8.1 Message History API

#### Objective

Return encrypted history for a conversation in a way that is correct for `v2`, with temporary mixed-mode support only if still needed during development.

#### Scope

- `GET /messages/with/:userId`
- pagination
- ciphertext only on server
- return versioned payloads

#### Done Criteria

- history fetch works reliably for `v2`
- pagination preserves message order

---

### 8.2 Conversation Identity

#### Objective

Stabilize server queries and future list views.

#### Scope

- define `conversationId = sort(A, B)`
- add indexes
- support efficient history lookup

---

### 8.3 Conversations Collection

#### Objective

Track conversation-level metadata separately from message records.

#### Scope

- members
- last message preview metadata
- `lastMessageAt`
- `lastProtoVersion`
- unread counters

#### Done Criteria

- chat list can be loaded without scanning all messages

---

### 8.4 Chat List

#### Objective

Present conversation-level state like a real messenger.

#### Scope

- recent dialogs
- last activity ordering
- unread badges
- open existing conversation

---

### 8.5 Delivery Metadata

#### Objective

Support message state UX without exposing plaintext.

#### Scope

- sending
- sent
- delivered
- read
- failed
- retry

#### Technical Requirements

- state machine must be independent of ciphertext content
- client ids must support dedupe and retries

---

### 8.6 Pagination and Scroll Stability

#### Objective

Avoid UI corruption as history grows.

#### Scope

- incremental history loading
- scroll anchoring
- no duplicates on merge with realtime

---

## 9. Block 3 - Reliability and Product Hardening

### 9.1 Realtime Resilience

- reconnect and resubscribe
- listener dedupe
- idempotent message merge
- recover after temporary disconnect

### 9.2 Offline Behavior

- queue unsent messages
- optimistic UI
- resend after reconnect
- recover pending state after restart

### 9.3 Logging and Telemetry

- log bootstrap steps
- log session creation
- log ratchet transitions
- log decrypt failures
- never log plaintext or raw secret material in production

### 9.4 Error Taxonomy

Standardize these categories:

- missing bootstrap
- no session
- stale session
- decrypt failed
- replay detected
- unknown old message
- send failed
- storage corruption

### 9.5 Testing Harness

Create repeatable scenarios for:

- brand new chat
- first message while receiver offline
- history replay after restart
- reordered delivery
- reinstall on one device
- manual reset and recovery

---

## 10. Block 4 - UX and Trust Layer

### 10.1 Chat UX

- sending and retry states
- skeleton loaders
- empty states
- pagination indicators
- stable scroll behavior

### 10.2 Trust Indicators

- verified/unverified status
- safety numbers
- key change warnings

### 10.3 Recovery UX

- decrypt failure messaging
- secure session reset action
- warnings for trust state changes

---

## 11. Block 5 - Media Messages

### 11.1 Media MVP

- image/file upload
- media message type
- preview UI
- upload states

### 11.2 E2EE Media

- encrypt file client-side
- one file key per asset
- wrap file key via session/group mechanism
- encrypted metadata when appropriate

### 11.3 Media Reliability

- retry upload
- cancel upload
- handle expired/missing media gracefully

---

## 12. Block 6 - Voice Messages

- push-to-talk
- waveform/duration UI
- audio upload
- encrypted media handling
- playback UX

---

## 13. Block 7 - Groups

Only after one-to-one protocol is stable.

### 13.1 Group Model

- create group
- membership
- roles
- system events

### 13.2 Group Crypto Strategy

Choose one:

- sender keys
- server fanout with per-recipient encryption

This requires its own threat and lifecycle analysis.

### 13.3 Group UX

- member list
- system message feed
- leave/join handling

---

## 14. Block 8 - Liquid Glass UI

Only after logic is stable.

- glassmorphism
- blur surfaces
- translucent headers
- refined chat bubbles
- performance fallback on Android

This block must not change crypto or messaging behavior.

---

## 15. Block 9 - Calls

### 15.1 Audio and Video Calls MVP

- WebRTC
- signaling through Socket.IO
- STUN/TURN
- basic call lifecycle

### 15.2 Security Framing

- tie call trust to identity verification UX
- expose trust state clearly

---

## 16. Block 10 - Documentation, Security, Audit

### 16.1 Threat Model

Document:

- trusted device assumptions
- untrusted server assumptions
- metadata limitations
- compromise and recovery boundaries

### 16.2 Security Guarantees

Document:

- what is protected
- what is not protected
- forward secrecy scope
- post-compromise security scope

### 16.3 Diagrams

Required diagrams:

- auth and socket connection
- X3DH bootstrap
- session bootstrap transport
- chain ratchet
- DH ratchet
- history decryption flow
- media encryption flow

### 16.4 Test Plan

Include:

- unit tests
- integration tests
- two-device manual tests
- reinstall/reset scenarios
- delayed delivery scenarios

### 16.5 Limitations and Future Work

- multi-device
- key transparency
- stronger metadata privacy
- audit-readiness milestones

---

## 17. Priority Order

Priority should remain:

1. Block 1 - MUST
2. Block 2 - MUST
3. Block 3 - MUST
4. Block 4 - SHOULD
5. Block 5 and Block 6 - SHOULD
6. Block 7 - LATER
7. Block 8 - AFTER LOGIC
8. Block 9 - IF TIME
9. Block 10 - REQUIRED FOR MATURITY

Within Block 1, the immediate execution order is:

1. stabilize `v2`
2. validate clean-state and restart scenarios
3. disable runtime `v1` fallback
4. remove `v1` entirely
5. continue with pure `v2` hardening

---

## 18. Immediate Next Recommendations

These are the next practical priorities based on the current architecture:

### 18.1 Stabilize New-Chat v2 Bootstrap

- verify first-message decrypt in repeated clean-state runs
- verify offline receiver bootstrap
- verify history replay after restart
- verify reply after first inbound bootstrap
- verify recovery path through explicit reset when needed

### 18.2 Formalize Session Lifecycle

- keep `SESSION_ESTABLISHMENT_POLICY.md` in sync with implementation
- refine semantics only if a new scenario exposes ambiguity
- avoid reopening lifecycle design unless a concrete gap appears

### 18.3 Harden History Decryption

- reduce ambiguity between replay and stored key fallback
- ensure message key storage is bounded and namespaced
- test reopen/restart/history pagination cases

### 18.4 Move Toward v2-Only Runtime

- keep `v2` failure states explicit in logs and UI
- remove remaining dead legacy-only branches when they stop helping debugging
- keep new work fully `v2`-centric
### 18.5 Improve Observability

- replace debug logs with structured, non-sensitive diagnostics
- make bootstrap/decrypt/session errors easier to triage

---

## 19. Definition of "Production-Ready Enough"

The system is not "done" when messages happen to decrypt in happy-path testing.

It is ready for serious use only when:

- first-message bootstrap is stable
- v2 survives app restart
- offline delivery works
- history replay works
- session reset is recoverable
- the app no longer depends on legacy fallback for normal operation
- crypto failures are diagnosable
- trust UX is understandable

---

## 20. Living Document Rule

This roadmap should evolve with the protocol.

Whenever a hidden dependency or failure mode is discovered, it should be added here as:

- a missing roadmap item
- an explicit lifecycle requirement
- a test scenario

That keeps the implementation roadmap honest and prevents protocol assumptions from staying implicit in code.
