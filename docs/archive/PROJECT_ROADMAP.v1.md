# VELO — MASTER ROADMAP

### From working prototype to production-grade secure messenger
**Graduation thesis edition** · Status date: 2026-08-07 · Branch `master` · Open Beta 0.1

---

## 0. HOW TO READ THIS DOCUMENT

### 0.1 The target you set

> *"Signal-level or better, fully ready, with calls, with the best interface — on the level of
> Telegram, WhatsApp, Signal."*

That target decomposes into three different competitions, and they are not equally hard:

| Dimension | Benchmark | Honest difficulty for you |
|---|---|---|
| **Cryptographic rigor** | Signal | Hard but **achievable** — this is math and care, not headcount |
| **Interface & UX** | Telegram | Hard but **achievable** — you are already 60% there |
| **Feature breadth** | WhatsApp | **Not achievable solo** — 15 years, thousands of engineers |
| **Infrastructure scale** | All three | **Not achievable solo, and not required** for a thesis |

So the strategy this roadmap encodes: **compete on rigor and interface, deliberately concede breadth
and scale, and document the concession as an engineering decision rather than a gap.**

That is not a consolation prize. Signal itself has ~50 engineers and a decade. A thesis that ships a
formally-analyzed, correctly-implemented protocol with an excellent interface — and a written analysis of
exactly what it does *not* do and why — is a stronger academic result than one that chases feature count and
ships broken crypto. Examiners can tell the difference. Users can't, but examiners can.

### 0.2 The one input that would sharpen this plan

**Your defense date.** The full plan below is ~11 months of focused solo work. §13 gives cut lines for
3 / 6 / 9 / 12-month scenarios so you can pick immediately, but tell me the real deadline and I'll re-cut
the schedule around it.

### 0.3 Tier system used throughout

Every item below is tagged:

- **`[CORE]`** — thesis-critical. Without it the work is not defensible. Do not cut.
- **`[PARITY]`** — closes a real gap against Signal/WhatsApp. Cut only under deadline pressure.
- **`[FRONTIER]`** — research-grade. Enormous thesis value, enormous cost. Pick at most two.
- **`[DOC]`** — no code; written analysis. Cheap, and disproportionately valuable for a thesis.

### 0.4 Relationship to your existing documents

| Document | Keep? | Role going forward |
|---|---|---|
| [ROADMAP.md](ROADMAP.md) | Yes | Protocol *design* reference. §4 "Current Status" is superseded by §2 here. |
| [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) | Yes | Becomes the acceptance suite for Phase 2. Currently **0/22 checked.** |
| [UI_INTERFACE_ROADMAP.md](UI_INTERFACE_ROADMAP.md) | Yes | Absorbed into §9; still the authoritative per-screen status |
| [SESSION_ESTABLISHMENT_POLICY.md](SESSION_ESTABLISHMENT_POLICY.md) | Yes | Extend for multi-device in Phase 5 |
| [architecture.md](architecture.md) | Rewrite | Layer diagram no longer matches the code. See §5. |
| [UX.md](UX.md), [UserFlow.md](UserFlow.md), [UI_realization.md](UI_realization.md) | Yes | Design references |
| [README.md](README.md) | Fix | Contains claims that aren't true (§4.4) |

---

# PART I — WHERE YOU ACTUALLY ARE

## 1. VERIFIED INVENTORY

Everything in this section was checked against source, not against intent.

### 1.1 Cryptographic core — the strong part

| Component | File | Verdict |
|---|---|---|
| X3DH handshake | [x3dh.ts](chats-client/src/shared/crypto/x3dh.ts) | Working. Three of four spec DHs (§3.2 P1-5) |
| Symmetric chain ratchet | [ratchetChain.ts](chats-client/src/shared/crypto/ratchetChain.ts) | **Correct.** `MK=HMAC(CK,0x01)`, `CK'=HMAC(CK,0x02)` |
| Root KDF | [ratchetRoot.ts](chats-client/src/shared/crypto/ratchetRoot.ts) | **Correct.** HKDF-SHA256, root key as salt, domain-separated info |
| DH ratchet | [dhRatchet.ts](chats-client/src/shared/crypto/dhRatchet.ts) | Working. Drops out-of-epoch messages (§3.2 P1-3) |
| Wire format v2 | [messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) | Working. Header unauthenticated (§3.2 P1-1) |
| Signed prekeys | [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts) | Working. Never rotates (§3.2 P1-6) |
| One-time prekeys | [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts), [oneTimePreKeys.ts](chats-client/src/shared/storage/oneTimePreKeys.ts) | Working. Server-side drainable (§3.1 P0-4) |
| Bundle signature verify | [prekeyBundleVerify.ts](chats-client/src/shared/crypto/prekeyBundleVerify.ts) | **Correct.** Ed25519 detached verify |
| Safety numbers / TOFU | [fingerprint.ts](chats-client/src/shared/crypto/fingerprint.ts), [trustedIdentities.ts](chats-client/src/shared/storage/trustedIdentities.ts) | Working |
| Encrypted history keys | [v2MessageKeyStore.ts](chats-client/src/shared/storage/v2MessageKeyStore.ts), [historyMasterKey.ts](chats-client/src/shared/crypto/historyMasterKey.ts) | **Good design.** Keychain master key + per-entry `secretbox` |
| Session store | [sessionStore.ts](chats-client/src/shared/storage/sessionStore.ts) | Working. **Unencrypted at rest** (§3.1 P0-3) |
| Session bootstrap / reset | [sessionBootstrap.ts](chats-client/src/shared/crypto/sessionBootstrap.ts) | MVP |

Primitives: `tweetnacl` (X25519, Ed25519, XSalsa20-Poly1305) + `@noble/hashes` (SHA-256, HMAC, HKDF).
Both are respectable choices. The server genuinely never sees plaintext — [Message.ts](chats-server/src/models/Message.ts) stores only
`{header:{n,pn,dhPub}, nonce, ciphertext}`.

**This is real work.** Most people who attempt a from-scratch Double Ratchet do not get the KDF chain,
the root KDF, and the prekey signature verification all correct. You did.

### 1.2 Product surface — further along than the code alone suggests

Per [UI_INTERFACE_ROADMAP.md](UI_INTERFACE_ROADMAP.md), corroborated by the component tree:

**Chat screen** (`Mostly Done`) — overlay open inside the tab shell, Telegram-style back swipe, date
separators, message bubbles with time + delivery status, Telegram-like composer, tap actions, **swipe to
reply**, full `replyTo` threading with quoted blocks and tap-to-jump, copy action, live presence /
last-seen / typing, offline + reconnect + reset-required notices.

**Chat list** (`Mostly Done`) — unread badges, realtime refresh, long-press menu, **local pinned chats**,
**local archived chats**, mark-as-read, search split into Existing Chats / Contacts, skeleton loaders,
Pinned / Chats / Archived hierarchy.

**New chat** (`Mostly Done`) — contact hub with Saved / Verified / Recent / Discover, trust-state-aware
search ranking, invite via Share, Copy ID, verified-contacts layer wired to [VerifyContactScreen](chats-client/src/screens/VerifyContactScreen.tsx).

**Settings** (`Mostly Done`) — profile, privacy, encryption, devices, account sections; local secure-state
diagnostics; reset local secure state; human-readable security summaries; **appearance system with
theme (system/light/dark) + density (compact/comfortable) + surface style (glass/solid)** persisted and
applied app-wide.

**Design system** (`In Progress`) — shared [Button](chats-client/src/components/Button.tsx), [Input](chats-client/src/components/Input.tsx), [ScreenHeader](chats-client/src/components/ScreenHeader.tsx),
[SectionEyebrow](chats-client/src/components/SectionEyebrow.tsx), [StatusChip](chats-client/src/components/StatusChip.tsx), [BottomSheetPanel](chats-client/src/components/BottomSheetPanel.tsx), [appearance.store.ts](chats-client/src/store/appearance.store.ts).

**Infrastructure**: Socket.io with JWT handshake auth, per-user rooms, presence, typing, delivered/read
receipts, FCM push via notifee (sent only when the recipient socket is absent), offline queue
([pendingMessageStore.ts](chats-client/src/shared/storage/pendingMessageStore.ts) + [drainPendingMessages.ts](chats-client/src/shared/chat/drainPendingMessages.ts)), 6 Zustand stores, Express 5 + Mongoose 9 with
5 route modules and 5 models.

### 1.3 Maturity scorecard

| Layer | Score | Note |
|---|---|---|
| Crypto primitives & KDFs | 8/10 | Correct constructions, good library choices |
| Protocol edge cases | 3/10 | Reorder, epoch boundaries, malformed input all unhandled |
| Server security posture | 2/10 | Committed credentials, cleartext HTTP, no rate limiting |
| Product UI | 6/10 | Genuinely good; needs a systems layer and polish pass |
| Feature breadth | 3/10 | No media, groups, calls, multi-device, backup |
| Test coverage | 0/10 | One default RN smoke test; server `npm test` exits 1 |
| Ops / deploy | 1/10 | `nodemon` against a hardcoded IP, no build step |
| Documentation | 7/10 | Unusually thorough design docs; some now stale |

**Composite: ~4/10 against "production messenger."** The distance is almost entirely in the columns that
are *tedious rather than intellectually hard* — which is good news, because those are schedulable.

---

# PART II — THE GAP TO SIGNAL

## 2. PARITY MATRICES

These matrices are themselves a thesis deliverable — Chapter 2 of your dissertation, essentially. Keep them
updated as you build; the diff between the first and last version *is* your contribution narrative.

### 2.1 Cryptographic parity

| Capability | Signal | WhatsApp | Telegram | **Velo today** | **Velo target** |
|---|---|---|---|---|---|
| E2EE 1:1 by default | ✅ | ✅ | ❌ (opt-in Secret Chats) | ✅ | ✅ |
| X3DH / async handshake | ✅ | ✅ | ✅ (secret chats) | ⚠️ 3 of 4 DHs | ✅ Phase 3 |
| Double Ratchet | ✅ | ✅ | ❌ | ⚠️ buggy at epoch edges | ✅ Phase 2 |
| Header encryption | ✅ | ✅ | — | ❌ | ✅ Phase 3 |
| AEAD over header (AD binding) | ✅ | ✅ | ✅ | ❌ | ✅ Phase 2 |
| Post-quantum handshake (PQXDH) | ✅ (2023) | ❌ | ❌ | ❌ | 🎯 Phase 11 `[FRONTIER]` |
| Post-quantum ratchet (SPQR) | ✅ (2025) | ❌ | ❌ | ❌ | ❌ document only |
| Multi-device (Sesame) | ✅ | ✅ | ✅ | ❌ | ✅ Phase 5 |
| Group E2EE (Sender Keys) | ✅ | ✅ | ❌ | ❌ | ✅ Phase 6 |
| Anonymous group credentials (ZKGroup) | ✅ | ❌ | ❌ | ❌ | ❌ document only |
| Sealed sender | ✅ | ❌ | ❌ | ❌ | 🎯 Phase 11 `[FRONTIER]` |
| Private contact discovery | ✅ (SGX) | ❌ | ❌ | ❌ | ❌ document only |
| Key transparency | ✅ (2024) | ⚠️ partial | ❌ | ❌ | 🎯 Phase 11 `[FRONTIER]` |
| Safety numbers / verification | ✅ | ✅ | ✅ | ✅ | ✅ |
| Encrypted backup w/ PIN escrow | ✅ (SVR/HSM) | ✅ (HSM) | — | ❌ | ✅ Phase 8 (no enclave) |
| E2EE calls | ✅ | ✅ | ✅ | ❌ | ✅ Phase 9 |
| E2EE group calls | ✅ | ✅ | ✅ | ❌ | ⚠️ Phase 10 (risk, §8.4) |
| Disappearing messages | ✅ | ✅ | ✅ | ❌ | ✅ Phase 7 |
| Forward secrecy | ✅ | ✅ | ⚠️ | ⚠️ eroded by key retention | ✅ Phase 2 |
| Post-compromise security | ✅ | ✅ | ❌ | ⚠️ ratchet exists, untested | ✅ Phase 2 |

### 2.2 Product parity

| Feature | Signal | WhatsApp | Telegram | **Velo today** | **Target phase** |
|---|---|---|---|---|---|
| 1:1 text | ✅ | ✅ | ✅ | ✅ | — |
| Reply / quote | ✅ | ✅ | ✅ | ✅ | — |
| Read receipts, typing, presence | ✅ | ✅ | ✅ | ✅ | — |
| Pinned / archived chats | ✅ | ✅ | ✅ | ⚠️ local only | Phase 7 (server sync) |
| Reactions | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Edit / delete messages | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Forward messages | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Images / video / files | ✅ | ✅ | ✅ | ❌ | Phase 8 |
| Voice messages | ✅ | ✅ | ✅ | ❌ | Phase 8 |
| Avatars / profiles | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Groups | ✅ | ✅ | ✅ (200k) | ❌ | Phase 6 |
| 1:1 calls | ✅ | ✅ | ✅ | ❌ | Phase 9 |
| Group calls | ✅ (40) | ✅ (32) | ✅ | ❌ | Phase 10 |
| Multi-device | ✅ | ✅ | ✅ | ❌ | Phase 5 |
| Desktop client | ✅ | ✅ | ✅ | ❌ | ❌ out of scope |
| Stickers / GIFs | ✅ | ✅ | ✅ | ❌ | ❌ out of scope |
| Channels / broadcast | ❌ | ✅ | ✅ | ❌ | ❌ out of scope |
| Bots / platform | ❌ | ⚠️ | ✅ | ❌ | ❌ out of scope |
| Search in chat | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Backup / restore | ✅ | ✅ | ✅ | ❌ | Phase 8 |
| Block / report | ✅ | ✅ | ✅ | ❌ | Phase 7 |
| Account deletion | ✅ | ✅ | ✅ | ❌ | Phase 7 **(legally required)** |
| i18n / RTL | ✅ | ✅ | ✅ | ❌ | Phase 12 |

### 2.3 Explicitly out of scope — and why `[DOC]`

Write this list into your thesis with justification. Conceding scope *with reasoning* reads as engineering
maturity; omitting it silently reads as an oversight.

| Not building | Why | What you write instead |
|---|---|---|
| Private contact discovery | Requires SGX/TEE infrastructure | Analysis of PSI vs. enclave approaches, and what Velo leaks without it |
| ZKGroup anonymous credentials | Needs a full anonymous-credential stack | Threat analysis of what the server learns about group membership |
| Desktop / web clients | Multiplies platform work with no new research content | Note that Sesame multi-device (Phase 5) makes it *possible* |
| Channels, bots, stickers | Product breadth, zero research content | State the deliberate focus on the secure-core |
| Global scale infrastructure | Single-region deployment is sufficient to demonstrate | Include a capacity model and scaling plan instead |
| Post-quantum ratchet (SPQR) | Bleeding edge, ~2025 research | Cover PQXDH only; discuss SPQR in future work |

---

## 3. DEFECT REGISTER

Everything here was verified in source. Fix in order.

### 3.1 P0 — Security. Blocking. Nobody else installs this until these are closed.

---

**P0-1 · Live database credentials and JWT secret committed to git** `[CORE]`

[chats-server/src/config.ts:7-8](chats-server/src/config.ts#L7-L8)
```ts
MONGO_URI: process.env.MONGO_URI || 'mongodb+srv://velo:<REDACTED>@velo.xy3tnsq.mongodb.net/?appName=velo',
JWT_SECRET: process.env.JWT_SECRET || '<REDACTED_JWT_SECRET>',
```

Anyone with repo access owns the database and can mint a valid token for any user ID. Both values are in
git history, so deleting the lines is insufficient.

**Fix, in order:**
1. Rotate the Atlas password *now*, and the JWT secret (this logs everyone out — fine, you have no real users)
2. Replace fallbacks with hard failure:
   ```ts
   function required(name: string): string {
     const v = process.env[name];
     if (!v) throw new Error(`Missing required env var: ${name}`);
     return v;
   }
   ```
3. `.env` on the server, `.env.example` in the repo with placeholder values
4. Either `git filter-repo` the history, or — simpler and cleaner for a thesis submission — start a fresh
   repository with a clean initial commit and archive the old one privately
5. Add `gitleaks` or `trufflehog` to CI (Phase 4) so this cannot recur

---

**P0-2 · All traffic is cleartext HTTP** `[CORE]`

[http.ts:6](chats-client/src/shared/api/http.ts#L6) and [socket.ts:5](chats-client/src/shared/socket/socket.ts#L5) both hardcode `http://13.63.159.111/`.

This is the single most important defect in the project, because it *undoes the thing the project is for.*
E2EE protects message bodies. It does not protect the bearer token in every request header. An attacker on
the same network takes the token, impersonates the user, and — critically — **publishes a new prekey bundle
under that identity**, at which point they receive and can read all future messages. Your entire crypto
stack is bypassed by one unencrypted header.

An examiner will find this in thirty seconds. Fix it first.

**Fix:**
1. Domain name + TLS. Caddy is the least work — automatic Let's Encrypt, ~6 lines of config
2. Move base URLs into `.env` via the already-installed `react-native-dotenv`
3. Android: `android:usesCleartextTraffic="false"` + a network security config that permits cleartext only for `10.0.2.2` in debug
4. iOS: remove any ATS exceptions in `Info.plist`
5. Certificate pinning in Phase 4 (`react-native-ssl-pinning` or a native trust-evaluation hook)

---

**P0-3 · Ratchet private state stored unencrypted** `[CORE]`

[sessionStore.ts](chats-client/src/shared/storage/sessionStore.ts) writes `rootKey`, `chainKeySend`, `chainKeyRecv`, and `DHsPrivateKey` as plain JSON
into AsyncStorage — which on Android is an unencrypted SQLite file readable by any process with the app's
data directory (root, ADB backup on older targets, some device-manufacturer backup agents).

This is inconsistent with your own design: per-message keys *are* encrypted at rest in
[v2MessageKeyStore.ts](chats-client/src/shared/storage/v2MessageKeyStore.ts) under a Keychain-held master key. The session state those keys derive from is
the higher-value target, and it's in the clear.

**Fix:** apply the exact pattern you already wrote. `getOrCreateHistoryMasterKey` → `secretbox` the
serialized session → store the blob. Roughly 25 lines. Consider a separate `session-mk:` service so
compromise of the history key doesn't imply compromise of live sessions.

---

**P0-4 · One-time prekey pool drainable by any authenticated user** `[CORE]`

[keys.routes.ts:158](chats-server/src/routes/keys.routes.ts#L158) — `GET /keys/bundle/:userId` consumes an OPK on every call, unauthenticated as to
*intent* and unrate-limited. ~100 requests strips a victim's pool. The client only refills at login
([prekeys.ts](chats-client/src/shared/crypto/prekeys.ts) `ensurePreKeysForUser`, `MIN_UNUSED = 30`). After depletion, every new session with that user
silently falls back to a handshake without the one-time key — measurably weaker forward secrecy, with no
signal to either party.

Your own [ROADMAP.md](ROADMAP.md) §6.5 lists "prekey exhaustion" as a risk. It is now a live vulnerability.

**Fix:**
1. Per-requester rate limit on bundle fetch (e.g. 10/hour/target)
2. Cache the issued bundle per `(requester, target)` for ~24h and return the same one on repeat — prevents
   drain by a single actor without breaking legitimate retry
3. Server returns remaining count; client refills on threshold, not only at login
4. Background refill task on app foreground
5. Log and alert on depletion events — an examiner will ask how you *detect* this, not just prevent it

---

**P0-5 · No rate limiting anywhere** `[CORE]`

No `express-rate-limit`, no account lockout, no CAPTCHA. `/auth/login` is freely brute-forceable at network speed.

**Fix:** `express-rate-limit` global bucket + a strict bucket on `/auth/*` + per-account progressive
backoff (exponential delay after N failures, tracked server-side) + Redis-backed store so limits survive
restart and work across instances.

---

**P0-6 · User enumeration and ReDoS in search** `[CORE]`

[users.routes.ts:181-182](chats-server/src/routes/users.routes.ts#L181-L182) — raw user input goes directly into `$regex`:
```ts
{ username: { $regex: q, $options: 'i' } },
{ email:    { $regex: q, $options: 'i' } },
```
Two distinct bugs. Empty `q` returns every account **with email addresses** — a full user dump for any
logged-in account. And a crafted pattern (`(a+)+$`) pins a CPU core indefinitely.

**Fix:** escape regex metacharacters or switch to a MongoDB text index; require `q.length >= 3`; anchor to
prefix match; **never return emails from search**; rate-limit the endpoint. Longer term this is what private
contact discovery solves — cite that in your thesis (§2.3).

---

**P0-7 · Missing authorization on socket message-state events** `[CORE]`

[setupSocket.ts:588](chats-server/src/socket/setupSocket.ts#L588) — `findByIdAndUpdate(serverMessageId, …)` with no check that the caller is the
message's recipient. Any authenticated user can mark any message ID delivered and fire a
`message:status-changed` at its real sender. `message:read` has the same shape: it trusts an
attacker-supplied `conversationId` and derives `otherUserId` by splitting the string, so a crafted ID emits
a spoofed read receipt to an arbitrary user.

**Fix:** load the document, assert `String(doc.toUserId) === socket.data.userId`, reject otherwise. For
`message:read`, derive the conversation ID server-side from `(callerId, peerId)` using
[makeConversationId](chats-server/src/utils/conversation.ts) rather than accepting it from the client. **General principle: never accept a
server-derivable identifier from a client.** Audit every socket handler for this.

---

**P0-8 · No password policy at registration** `[CORE]`

[auth.routes.ts](chats-server/src/routes/auth.routes.ts) accepts any non-empty password. `/auth/change-password` enforces 8 characters; register
does not. Email format is unvalidated at register but validated at `PATCH /users/me`.

**Fix:** extract a shared validation module. Minimum 10 characters, zxcvbn strength scoring, breach check
against the HaveIBeenPwned k-anonymity range API (free, privacy-preserving, and a nice thesis detail), plus
the email regex already present in [users.routes.ts](chats-server/src/routes/users.routes.ts).

---

### 3.2 P1 — Protocol correctness. These lose or corrupt user messages.

---

**P1-1 · Message headers are not authenticated** `[CORE]`

[messageV2.ts:74](chats-client/src/shared/crypto/messageV2.ts#L74):
```ts
const cipherBytes = nacl.secretbox(plainBytes, nonce, messageKey);
```
The AEAD covers the plaintext only. `header.n`, `header.pn`, and `header.dhPub` travel unauthenticated —
and the client **acts on them before decryption succeeds** (advances counters, writes storage, triggers
ratchets). A malicious or compromised server can flip any of them.

The Double Ratchet specification requires the header be bound as associated data. This is not optional.

**Fix.** `nacl.secretbox` has no AD parameter, so you have two options:

*Option A (minimal change, correct):* canonically serialize the header and prepend it to the plaintext
before sealing; after opening, re-serialize the received header and constant-time compare against the
prefix. Reject on mismatch.
```ts
// send
const ad = canonicalHeaderBytes(header);          // fixed-order, length-prefixed
const sealed = nacl.secretbox(concat(ad, plainBytes), nonce, messageKey);
// receive
const opened = nacl.secretbox.open(sealed, nonce, messageKey);
if (!opened) throw new DecryptError();
if (!timingSafeEqual(opened.slice(0, ad.length), canonicalHeaderBytes(receivedHeader)))
  throw new HeaderTamperError();
```

*Option B (cleaner, more work):* migrate to XChaCha20-Poly1305 with real AD support via `@noble/ciphers`.
Since you already depend on `@noble/hashes`, this is a consistent choice and gives you proper AEAD
semantics. Do this if you have the schedule room — it also sets up header encryption (P1-8) more naturally.

**Canonical serialization matters.** Use a fixed field order with explicit length prefixes, not
`JSON.stringify` — JSON key ordering is not guaranteed stable across engines and a mismatch becomes an
undebuggable decrypt failure.

---

**P1-2 · Unbounded skip loop — remote client freeze** `[CORE]`

[messageV2.ts:156](chats-client/src/shared/crypto/messageV2.ts#L156):
```ts
while (nr <= targetN) { … }
```
`targetN` comes from `header.n`, which is attacker-controlled and (per P1-1) unauthenticated. `MAX_SKIP = 50`
at [line 173](chats-client/src/shared/crypto/messageV2.ts#L173) bounds only the in-memory skipped map — the loop itself and the `putV2MessageKey`
write inside it are unbounded. A message with `n = 10_000_000` costs ten million HMAC operations and ten
million AsyncStorage writes. The app is gone.

The server validates only `n >= 0` ([setupSocket.ts](chats-server/src/socket/setupSocket.ts)).

**Fix:** reject before the loop —
```ts
if (targetN - session.Nr > MAX_SKIP) throw new TooManySkippedError(targetN - session.Nr);
```
— and add an absolute upper bound on `n` and `pn` in the server's payload validator. Defense in depth:
the client must not trust the server, and the server should not relay obviously malicious payloads.

---

**P1-3 · DH ratchet destroys pending skipped keys — silent message loss** `[CORE]`

[dhRatchet.ts:150](chats-client/src/shared/crypto/dhRatchet.ts#L150) — `skippedKeys: {}` on every ratchet step, with the comment
*"MVP: clear skipped on ratchet boundary (consider namespacing by dhPub later)."*

Concrete failure: A sends `n=0,1,2`, then ratchets. Message `n=1` was delayed and arrives after the ratchet.
It is now **permanently undecryptable** and surfaces as `Replay or unknown old message`
([messageV2.ts:124](chats-client/src/shared/crypto/messageV2.ts#L124)).

This is not an attack scenario. This is ordinary mobile-network packet reordering. **Users are losing
messages right now and being told it's a replay attack.**

**Fix, and it's smaller than it looks:** your skipped-key IDs are *already* epoch-namespaced —
`skippedKeyId()` returns `${dhPub}:${n}` ([messageV2.ts:19](chats-client/src/shared/crypto/messageV2.ts#L19)). So simply **stop clearing the map**.
Replace the wipe with bounded eviction: keep at most `MAX_SKIP_TOTAL` (e.g. 1000) keys across all epochs
and at most `MAX_SKIP_EPOCHS` (e.g. 5) distinct `dhPub` values, evicting oldest-epoch-first. Track insertion
order so eviction is deterministic and testable.

---

**P1-4 · `header.pn` is transmitted, stored, and never read** `[CORE]`

The `pn` field ("previous chain length") exists precisely so that, when you detect a DH ratchet, you can
derive and retain the remaining message keys from the *old* receiving chain — indices `Nr` through `pn-1` —
before switching chains. The specification calls this `SkipMessageKeys(header.pn)` and it runs *before*
`DHRatchet()`.

[messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) never reads `pn`. [Message.ts](chats-server/src/models/Message.ts) stores it. It is dead weight.

Combined with P1-3, this is the complete explanation for epoch-boundary message loss: you neither retain
old-chain keys before ratcheting, nor keep the ones you already had.

**Fix:** in `decryptV2`, when `session.DHrPublicKey !== incomingDhPub`:
```ts
// BEFORE applyDhRatchet:
skipMessageKeys(session, session.DHrPublicKey, encrypted.header.pn);  // fill Nr … pn-1 on old chain
session = applyDhRatchet(session, incomingDhPub);
```
with `skipMessageKeys` bounded by the same `MAX_SKIP` guard from P1-2.

---

**P1-5 · X3DH omits DH(EK_A, IK_B)** `[CORE]` (decide, then either fix or document)

[x3dh.ts:60-73](chats-client/src/shared/crypto/x3dh.ts#L60-L73) computes `EK×SPK`, `EK×OPK`, `IK_A×SPK`. The specification's fourth DH —
initiator's ephemeral against the **responder's identity key** — is absent.

Currently, responder authentication rests entirely on the signed-prekey signature check in
[prekeyBundleVerify.ts](chats-client/src/shared/crypto/prekeyBundleVerify.ts). That is a defensible design, but it is a deviation, and an examiner who knows
X3DH will ask about it. Having no answer is much worse than having a considered one.

**Recommendation: add the fourth DH.** The bundle already returns `identityDhPublicKey`
([keys.routes.ts](chats-server/src/routes/keys.routes.ts)), so you have the input. It is roughly four lines on each side, plus a version
bump. Then note in your thesis that you initially shipped a three-DH variant, identified the deviation
through spec review, and corrected it — that narrative is worth more than having gotten it right silently.

If you *don't* fix it, write the justification into [SESSION_ESTABLISHMENT_POLICY.md](SESSION_ESTABLISHMENT_POLICY.md) with an explicit
statement of what property is weakened.

---

**P1-6 · Signed prekey never rotates** `[CORE]`

[prekeys.ts:40](chats-client/src/shared/crypto/prekeys.ts#L40) — `if (!spk)` means the signed prekey is generated once at first run and kept
forever. Compromise of that one private key retroactively opens **every session ever bootstrapped with it**.
Signal rotates roughly weekly.

**Fix:** store `createdAt` with the SPK; rotate when older than 7 days; retain the previous SPK for a
30-day grace window so in-flight handshakes still resolve (the responder looks up the secret by
`signedPreKeyId`, which the init packet already carries); delete beyond the window. Requires a small
server change: keep the last N signed prekeys per user rather than only the latest.

---

**P1-7 · Message keys retained forever — forward secrecy traded away permanently** `[CORE]`

[messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) calls `putV2MessageKey` for every message in both directions, including *every* skipped
key regardless of `MAX_SKIP`. The keys are encrypted at rest (genuinely good), but never pruned.

Two costs: unbounded AsyncStorage growth, and — more importantly — the forward secrecy the ratchet exists
to provide is surrendered for the entire history rather than for a bounded window. Device compromise today
decrypts everything from day one.

Your [ROADMAP.md](ROADMAP.md) §7.8 flags this tradeoff. It needs bounding.

**Fix:** define a retention policy (recommended: keys older than 30 days, or beyond the most recent 1000
messages per conversation, whichever is tighter), implement pruning on app foreground, expose the window in
Settings, and **document the tradeoff explicitly in your threat model** — "Velo provides forward secrecy
beyond a 30-day window; within the window, local history is recoverable by design to support offline
history rendering." That is a legitimate engineering position, stated honestly.

---

**P1-8 · No header encryption** `[PARITY]`

Even after P1-1 authenticates the header, the server still *reads* `n`, `pn`, and `dhPub` in clear. That
leaks conversation volume, message ordering, and ratchet timing — a rich metadata channel.

Signal's Double Ratchet variant encrypts headers under separate header keys (`HKs`/`NHKs`) derived from the
root KDF. Implementing it means the receiver must trial-decrypt the header against the current and next
header keys.

**Do this in Phase 3.** It is also a hard prerequisite for sealed sender (Phase 11).

---

### 3.3 P2 — Reliability & operations

**P2-1 · No token refresh** `[CORE]` — [endpoints.ts:6](chats-client/src/shared/api/endpoints.ts#L6) declares `/auth/refresh`; no such route exists on the
server. `JWT_MAX_AGE` is `10800s`, so users are silently logged out every 3 hours. Add refresh tokens with
rotation and reuse detection (a replayed refresh token invalidates the whole family — standard, and a good
thesis detail).

**P2-2 · Effectively zero tests** `[CORE]` — server `npm test` is `echo "Error: no test specified" && exit 1`;
client has one default `App.test.tsx`. For a cryptography project this is the highest-leverage gap in the
entire repo. See §10.

**P2-3 · The stabilization checklist has never been run** `[CORE]` — all 22 boxes in
[V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) unchecked, §12 "Working Notes" empty. This is *why* P1-3 and P1-4 went
unnoticed: the scenarios that expose them are exactly the ones in §6 of that checklist.

**P2-4 · Presence and push routing live in process memory** `[CORE]` — [setupSocket.ts](chats-server/src/socket/setupSocket.ts) holds
`onlineConnectionCounts` and `lastSeenByUserId` as plain `Map`s. Every restart marks everyone offline and
loses last-seen. It also hard-caps you at one server process forever: a second instance would consider
users on the first offline and push-notify them for messages they are actively reading.

**P2-5 · No build step, no process manager** `[CORE]` — `npm start` is `nodemon src/index.ts`. Production
runs TypeScript through a file watcher with no `tsc` gate and no restart-on-crash.

**P2-6 · No pagination stability** `[PARITY]` — [ROADMAP.md](ROADMAP.md) §8.6 specifies scroll anchoring and
dedupe-on-merge; [ChatScreen.tsx](chats-client/src/screens/ChatScreen.tsx) (1089 lines) doesn't implement it. Also: the history endpoint
paginates on `createdAtClient` ([messages.routes.ts](chats-server/src/routes/messages.routes.ts)), a **client-supplied timestamp** — two messages with
identical values will duplicate or drop across a page boundary. Use a compound `(createdAtClient, _id)`
cursor.

**P2-7 · `cors({ origin: true, credentials: true })`** `[PARITY]` — reflects any origin. Mostly moot for a
native client; pin the allowed origins anyway.

**P2-8 · No structured error taxonomy** `[PARITY]` — [ROADMAP.md](ROADMAP.md) §9.4 defines eight categories
(missing bootstrap, no session, stale session, decrypt failed, replay detected, unknown old message, send
failed, storage corruption). None are typed in code; failures surface as `Error` with string messages that
the UI cannot branch on.

### 3.4 P3 — Hygiene

- **Dead code.** [dhRatchet.ts](chats-client/src/shared/crypto/dhRatchet.ts) and [setupSocket.ts](chats-server/src/socket/setupSocket.ts) each carry a full commented-out prior
  version above the live one (57 and ~200 lines respectively). Delete — git remembers.
- **Debug logging.** The server logs message IDs, initPacket presence, and unread counts on every send. No
  plaintext leak, but it buries real errors and is exactly what [ROADMAP.md](ROADMAP.md) §9.3 says to replace.
- **`@ts-ignore` on both `jwt.sign` calls** in [auth.routes.ts](chats-server/src/routes/auth.routes.ts) — masking a genuine `expiresIn` type
  mismatch. Fix the type; never suppress in crypto-adjacent code.
- **`normalizeB64`** duplicated in [messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) and [dhRatchet.ts](chats-client/src/shared/crypto/dhRatchet.ts), converting spaces back to `+`
  and repairing padding. This is a workaround for base64 being mangled somewhere upstream. **Find the real
  cause.** A silent-repair function on the crypto path can mask genuine corruption and turn a loud failure
  into a wrong-key derivation.
- **Stray root `package.json` + `node_modules`** holding one unrelated dependency. Remove or convert to a
  proper workspace (§5.4).
- **Root clutter.** `1.png`, `chat-backend.pem`, `my-release-key.keystore` in the project root. The secrets
  are correctly gitignored, but move them out of the tree entirely — one `git add -f` from disaster.
- **Mixed-language comments.** Russian and English interleaved across [messages.routes.ts](chats-server/src/routes/messages.routes.ts),
  [users.routes.ts](chats-server/src/routes/users.routes.ts), [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts). Pick one for the codebase (English, given your English docs)
  and be consistent — examiners read code.
- **[README.md](README.md) contains false claims** — email verification (not implemented), tests (not
  implemented), "message history limited to the current session" (it's persisted in MongoDB). On a security
  project, an inaccurate README costs credibility with exactly the audience you want.

---

# PART III — THE PLAN

## 4. PHASE OVERVIEW

| # | Phase | Weeks | Tier | Gate |
|---|---|---|---|---|
| 1 | Security remediation | 2 | `[CORE]` | No P0 open |
| 2 | Test harness + ratchet correctness | 4 | `[CORE]` | 22/22 checklist green |
| 3 | Protocol hardening | 3 | `[CORE]` | Header encryption + PQ-ready |
| 4 | Production infrastructure | 3 | `[CORE]` | Deployable, observable, CI |
| 5 | Multi-device (Sesame) | 6 | `[PARITY]` | Two devices, one identity |
| 6 | Groups (Sender Keys) | 5 | `[PARITY]` | E2EE group chat |
| 7 | Product completeness | 4 | `[PARITY]` | Feature-complete vs §2.2 |
| 8 | Media, voice, backup | 5 | `[PARITY]` | E2EE attachments + restore |
| 9 | 1:1 calls | 5 | `[PARITY]` | E2EE audio + video |
| 10 | Group calls | 6 | `[PARITY]` | SFU with frame E2EE |
| 11 | Research frontier | 6 | `[FRONTIER]` | Pick ≤2 of PQXDH / sealed sender / KT |
| 12 | Interface excellence | 4 | `[CORE]` | Design system complete, 60fps |
| 13 | Verification & thesis | 6 | `[CORE]` | ProVerif model + dissertation |

**Full plan: ~59 weeks.** See §13 for cut lines.

---

## 5. TARGET ARCHITECTURE

### 5.1 What the system must become

```
┌─────────────────────────── CLIENT (React Native) ───────────────────────────┐
│                                                                             │
│  PRESENTATION      screens/ · components/ · theme/ · design tokens          │
│       │            ── no crypto, no network, no storage ──                  │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  STATE             Zustand stores · optimistic updates · selectors          │
│       │                                                                     │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  DOMAIN            ChatService · CallService · GroupService · DeviceService  │
│       │            ── orchestration only, no primitives ──                  │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  PROTOCOL          ┌──────────────┬──────────────┬──────────────┐           │
│       │            │ Double       │ Sender Keys  │ Sesame       │           │
│       │            │ Ratchet      │ (groups)     │ (devices)    │           │
│       │            └──────┬───────┴──────┬───────┴──────┬───────┘           │
│       │                   └──────────────┼──────────────┘                   │
│       │                          X3DH / PQXDH                               │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  PRIMITIVES        X25519 · Ed25519 · ML-KEM · HKDF · HMAC · AEAD           │
│       │            ── pure functions, zero I/O, 100% test coverage ──       │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  PERSISTENCE       SecureStore (Keychain) │ EncryptedStore │ MMKV/SQLite    │
│       │            identity, session mk   │ sessions, keys │ messages, UI   │
│  ─────┼─────────────────────────────────────────────────────────────────    │
│  TRANSPORT         REST (axios) · WebSocket (socket.io) · WebRTC · FCM/APNs │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │  ciphertext + minimal metadata only
┌─────────────────────────── SERVER (Node/Express) ───────────────────────────┐
│  EDGE          TLS (Caddy) · rate limiting · abuse detection · WAF          │
│  API           auth · users · keys · messages · conversations · groups      │
│  REALTIME      socket.io + Redis adapter · presence · typing · signaling    │
│  DELIVERY      queue · push fanout (FCM/APNs) · retry · dead-letter         │
│  MEDIA         encrypted blob store (S3-compatible) · signed URLs · TTL     │
│  CALLS         TURN (coturn) · SFU (mediasoup/LiveKit) for group calls      │
│  DATA          MongoDB (messages, users, keys) · Redis (presence, limits)   │
│  OBSERVE       structured logs · metrics · traces · alerting                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 The layering rule that matters most

**Primitives must be pure.** Today [messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) does `await saveSession(...)` and
`await putV2MessageKey(...)` *inside* `encryptV2`/`decryptV2`. Crypto logic is entangled with I/O, which is
why the protocol cannot be tested without a device.

**Refactor to:**
```ts
// pure — no async, no storage, fully testable
function ratchetEncrypt(session: Session, plaintext: Uint8Array):
  { session: Session; envelope: Envelope; derivedKeys: KeyRecord[] }

// the caller persists
const { session: next, envelope, derivedKeys } = ratchetEncrypt(session, pt);
await Promise.all([saveSession(next), storeKeys(derivedKeys)]);
```

This single refactor unlocks Phase 2's test harness, makes the ProVerif model in Phase 13 tractable, and
removes a whole class of "partial write left the session corrupted" bugs. **Do it first in Phase 2.**

### 5.3 Data model evolution

| Model | Change | Phase |
|---|---|---|
| `User` | `+ avatarUrl, avatarKey, profileKey, deletedAt, lockUntil` | 7 |
| `User` | `+ devices[]` — device list becomes the identity unit | 5 |
| `Device` | **new** — `userId, deviceId, identityKey, registrationId, lastSeen` | 5 |
| `Message` | `+ groupId, editedAt, deletedAt, reactions[], expiresAt, attachments[]` | 6,7,8 |
| `Message` | `v2.header` becomes opaque ciphertext (header encryption) | 3 |
| `Group` | **new** — `groupId, members[], senderKeyEpoch, avatarKey, metadata` | 6 |
| `SenderKeyDistribution` | **new** — per `(group, sender, device)` | 6 |
| `Attachment` | **new** — `blobId, size, contentKeyDigest, ttl` | 8 |
| `Call` | **new** — `callId, participants[], startedAt, endedAt, type` | 9 |
| `RefreshToken` | **new** — `userId, family, token, revokedAt` | 1 |
| `PreKeyBundleIssue` | **new** — rate-limit + cache ledger (P0-4) | 1 |

### 5.4 Repository restructure

```
velo/
├── packages/
│   ├── protocol/          ← extract: pure crypto, zero React Native deps
│   │   ├── src/primitives/    x25519, ed25519, kdf, aead
│   │   ├── src/ratchet/       chain, root, dh, session
│   │   ├── src/handshake/     x3dh, pqxdh
│   │   ├── src/groups/        senderkeys
│   │   ├── src/devices/       sesame
│   │   └── test/              ← the harness (§10.2). Runs in Node. No device.
│   ├── client/            ← React Native app (today's chats-client)
│   └── server/            ← Express API (today's chats-server)
├── docs/                  ← all .md files, currently scattered in root
└── tools/                 ← test vectors, fuzzers, benchmark scripts
```

Extracting `packages/protocol` is the structural change that makes everything else possible: the protocol
becomes testable in plain Node, benchmarkable, fuzzable, and — for your thesis — presentable as a
self-contained artifact independent of the app.

---

## 6. PHASES 1–4 — THE FOUNDATION

### PHASE 1 — Security remediation · 2 weeks · `[CORE]`

**Objective:** nothing in the repository or on the wire can compromise a user.

| # | Task | Est. |
|---|---|---|
| 1.1 | Rotate Atlas password + JWT secret; hard-fail on missing env (P0-1) | 0.5d |
| 1.2 | Clean repository or `git filter-repo`; add `.env.example` | 0.5d |
| 1.3 | Domain + TLS via Caddy; env-driven URLs; disable cleartext on both platforms (P0-2) | 2d |
| 1.4 | Encrypt session state at rest (P0-3) | 1d |
| 1.5 | Bundle-fetch rate limit + per-requester cache + threshold refill (P0-4) | 2d |
| 1.6 | `express-rate-limit` + Redis store + per-account backoff (P0-5) | 1.5d |
| 1.7 | Fix search: escape/text-index, min length, drop emails (P0-6) | 1d |
| 1.8 | Authorization on all socket handlers; server-derived conversation IDs (P0-7) | 1d |
| 1.9 | Shared validation: password policy, zxcvbn, HIBP range check (P0-8) | 1d |
| 1.10 | Refresh tokens with rotation + reuse detection (P2-1) | 1.5d |

**Exit:** run `/security-review` and `npm audit`; no finding above medium. Write the remediation up — it
becomes a thesis chapter on secure development lifecycle.

---

### PHASE 2 — Test harness + ratchet correctness · 4 weeks · `[CORE]`

**This is the most important phase in the roadmap.** Everything downstream depends on being able to change
the protocol without fear.

**Week 1 — Extract and purify**
- Create `packages/protocol`, move all of `shared/crypto` into it
- Strip I/O from `encryptV2`/`decryptV2` per §5.2 — they return state and key records, callers persist
- Define typed error taxonomy from [ROADMAP.md](ROADMAP.md) §9.4 as a discriminated union
- Result: the protocol runs in plain Node with zero React Native dependencies

**Week 2 — Build the harness**

A `VirtualClient` class with in-memory storage, and a `Network` that can delay, reorder, drop, duplicate,
and tamper. Then every checklist scenario becomes an executable test:

```ts
test('epoch boundary reorder', async () => {
  const [a, b] = await Network.pair();
  await a.send('m0'); await a.send('m1'); await a.send('m2');
  net.hold('m1');                       // delay one message
  await net.deliver('m0', 'm2');
  await b.send('reply');                // forces a DH ratchet on A
  await net.release('m1');              // arrives in the new epoch
  expect(b.inbox).toContain('m1');      // ← fails today (P1-3, P1-4)
});
```

Scenarios to cover — every one of these is currently an unrun manual ritual in
[V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md):

| Scenario | Catches |
|---|---|
| New chat, first message, first reply | baseline |
| 5 messages each direction | chain ratchet |
| Reorder within an epoch | skipped keys |
| **Reorder across a DH ratchet** | **P1-3, P1-4** |
| Restart: serialize → reload → continue | session persistence |
| Receiver offline for the first message | bootstrap transport |
| Both sides restart mid-conversation | mutual state |
| One-sided storage wipe → reset → recover | recovery path |
| Duplicate delivery | replay handling |
| `n = 10_000_000` | **P1-2** |
| Flipped `dhPub` / `n` / `pn` | **P1-1** |
| One-time prekey exhausted | fallback path |
| 1000-message conversation | key store bounds |

**Week 3 — Fix the protocol, with the harness catching you**
- P1-1 header authentication (choose Option A or B, §3.2)
- P1-2 bounded skip
- P1-3 stop clearing skipped keys; bounded multi-epoch eviction
- P1-4 implement `skipMessageKeys(pn)` before the ratchet
- P1-5 add the fourth DH (or document the deviation)
- P1-6 signed prekey rotation with grace window
- P1-7 retention policy + pruning

**Week 4 — Validate and document**
- Run the real two-device manual pass; check all 22 boxes in
  [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) and fill in §12 Working Notes
- Property-based tests via `fast-check`: *for any interleaving of N messages with arbitrary
  delay/reorder/duplication, every message either decrypts exactly once or is explicitly rejected*
- Generate test vectors (inputs → expected outputs) and commit them — these are a thesis artifact and let
  anyone reproduce your results
- Benchmark: ratchet ops/sec, encrypt/decrypt latency, storage per message

**Exit gate:** 22/22 checklist green, property tests passing over 10,000 generated interleavings,
committed test vectors. **[ROADMAP.md](ROADMAP.md) Block 1 can only be marked done here** — it currently claims
"implemented" for things implemented but never validated.

---

### PHASE 3 — Protocol hardening · 3 weeks · `[CORE]`

| Task | Detail | Est. |
|---|---|---|
| Header encryption (P1-8) | `HKs`/`NHKs` from root KDF; trial-decrypt current + next | 1w |
| Migrate to XChaCha20-Poly1305 | Real AEAD with AD via `@noble/ciphers`; versioned wire format | 3d |
| Protocol versioning | Negotiation + migration path; you *will* need v3 | 2d |
| Key-compromise hardening | Zeroize buffers after use; audit every place a key is copied | 2d |
| Replay window | Explicit, bounded, with a typed rejection reason | 2d |
| PQ-readiness | Structure the handshake so a KEM secret can be concatenated into the IKM later | 2d |

**Exit:** wire format v3 stable; header contents invisible to the server; the handshake has a documented
extension point for PQXDH.

---

### PHASE 4 — Production infrastructure · 3 weeks · `[CORE]`

| Task | Detail | Est. |
|---|---|---|
| Build pipeline | `tsc` → `dist/`; typecheck gate; drop `nodemon` in prod | 1d |
| Process management | systemd or pm2; restart-on-crash; graceful shutdown | 1d |
| Redis | socket.io adapter, presence, rate limits, refresh-token family store (P2-4) | 3d |
| Structured logging | `pino`; correlation IDs; **zero plaintext, zero key material** | 2d |
| Metrics + alerting | Prometheus + Grafana: delivery latency, decrypt failure rate, prekey depletion | 3d |
| CI/CD | GitHub Actions: typecheck, lint, protocol tests, `gitleaks`, build both platforms | 3d |
| Error taxonomy in UI (P2-8) | Typed errors → distinct user-facing messages | 2d |
| Pagination cursor fix (P2-6) | Compound `(createdAtClient, _id)` cursor | 1d |
| Backup + DR | Automated Mongo backups; documented restore drill; run it once | 2d |
| Certificate pinning | Pin the leaf or intermediate; document the rotation procedure | 2d |

**Exit:** you can deploy, restart, and roll back without losing sessions or presence; a dashboard shows
delivery latency and decrypt failure rate; CI blocks a merge that breaks the protocol tests.

---

## 7. PHASES 5–8 — CLOSING THE FEATURE GAP

### PHASE 5 — Multi-device / Sesame · 6 weeks · `[PARITY]`

The hardest non-call phase, and the one that most changes your architecture. Attempt it only after Phase 2.

**The conceptual shift:** today, identity = user. After Sesame, **identity = device**, and a user is a set
of devices. Every pairwise session becomes a session *per device pair*. Sending to a user with 3 devices
while you have 2 means encrypting to 5 sessions (3 theirs + your 1 other).

| Week | Work |
|---|---|
| 1 | `Device` model; device registration; per-device identity keys and prekey bundles |
| 2 | Device list endpoint; signed device lists so the server can't inject a device |
| 3 | Fanout: encrypt-to-all-devices on send; per-device session management |
| 4 | Provisioning: QR-code pairing flow, identity key transfer over an ephemeral channel |
| 5 | Sync: read state, conversation list, contacts, and settings across devices |
| 6 | Device management UI; revocation; "new device added" security notification |

**Critical security requirement:** a device added to your account must be **visibly announced** to your
contacts as a safety-number change. Otherwise the server can silently add a device and read everything —
this is precisely the "ghost user" attack, and it is exactly the kind of design detail an examiner will
probe. Get it right and it's a thesis highlight.

---

### PHASE 6 — Groups / Sender Keys · 5 weeks · `[PARITY]`

**Why Sender Keys:** naive group E2EE encrypts each message once per recipient — O(n) work per message. For
a 50-person group that's 50 encryptions per message. Sender Keys make it O(1): each member holds a sending
chain, distributes the chain key once to each member over the existing pairwise Double Ratchet sessions,
then encrypts each message once and lets the server fan out.

| Week | Work |
|---|---|
| 1 | `Group` model; create/join/leave; membership; roles; system events |
| 2 | Sender Key generation; `SenderKeyDistributionMessage` over pairwise sessions |
| 3 | Group send/receive; server fanout; per-sender chain state |
| 4 | Rotation on membership change (**mandatory** — a departing member must not read future messages) |
| 5 | Group UI: member list, admin actions, system message feed, group avatar |

**Design points that matter:**
- Each sender's messages are **signed** with a per-sender signature key so members cannot forge each other.
  Sender Keys alone give confidentiality within the group but not sender authentication — without the
  signature, any member can impersonate any other.
- Sender Keys provide **no forward secrecy within an epoch**. Rotate on every membership change, and
  consider periodic rotation. Document this limitation; it is a real and well-known property.
- Interacts with Phase 5: distribution is per-*device*, not per-user.

---

### PHASE 7 — Product completeness · 4 weeks · `[PARITY]`

| Feature | Notes | Est. |
|---|---|---|
| Avatars / profiles | Encrypted with a profile key shared with contacts — not a plain URL | 4d |
| Reactions | New message type; aggregation; encrypted like any message | 3d |
| Edit / delete | Tombstone protocol messages; "delete for everyone" is a *request*, not a guarantee — say so in the UI | 4d |
| Forward | With provenance metadata; consider a "forwarded" marker | 2d |
| Disappearing messages | Per-conversation timer; ties into P1-7 retention nicely | 3d |
| Local search | Requires a local plaintext index — explicitly a security tradeoff, needs UI disclosure | 4d |
| Block / report | Server-side block list; abuse reporting flow | 3d |
| **Account deletion** | **Legally required** (GDPR Art. 17). Cascade delete + key destruction | 2d |
| Server-synced pin/archive | Promote local state ([UI_INTERFACE_ROADMAP.md](UI_INTERFACE_ROADMAP.md) §3.2) to server | 2d |
| Push notification privacy | Notification content must be decrypted client-side, never server-side | 2d |

---

### PHASE 8 — Media, voice, backup · 5 weeks · `[PARITY]`

**Media E2EE (2.5 weeks).** Per-attachment random key; encrypt client-side; upload the ciphertext blob to
object storage; transmit the key inside the E2EE message. The server stores an opaque blob and never holds
the key.
- Thumbnails encrypted separately (so a preview doesn't require the full download)
- Chunked upload with resume; progress; cancel
- Blob TTL and garbage collection
- **Strip EXIF before encryption** — GPS coordinates in a photo defeat the entire privacy model
- Content-type validation *after* decryption, client-side

**Voice messages (1 week).** Recording UI, waveform, duration, playback with scrubbing, speed control.
Same encryption path as media.

**Backup & restore (1.5 weeks).** The users-will-actually-need-this feature:
- Backup key derived from a user PIN via **Argon2id** (not PBKDF2)
- Server-side rate limiting on restore attempts, with a hard lockout
- Encrypted archive containing message history, session state, and identity keys
- **Document honestly** that without an enclave (Signal's SVR uses SGX; WhatsApp uses HSMs) your PIN
  escrow is weaker — a malicious server can attempt offline brute force against a stolen archive. Argon2id
  parameters are your only defense. This limitation, clearly stated, is worth more marks than pretending
  otherwise.

---

## 8. PHASES 9–10 — CALLS

### PHASE 9 — 1:1 calls · 5 weeks · `[PARITY]`

**Stack:** `react-native-webrtc` + your existing socket.io for signaling.

| Week | Work |
|---|---|
| 1 | `react-native-webrtc` integration; permissions; audio device handling on both platforms |
| 2 | Signaling over socket.io: offer/answer/ICE — **all sent as E2EE messages through the ratchet** |
| 3 | STUN + TURN (`coturn` on your VPS); NAT traversal; relay fallback |
| 4 | Call UI: incoming/outgoing, in-call controls, CallKit (iOS) + ConnectionService (Android) |
| 5 | Video; camera switching; quality adaptation; call history |

**The security-critical design decision:** DTLS-SRTP protects the media, but DTLS authenticates using
certificate fingerprints exchanged in signaling. **If your signaling is server-mediated in the clear, the
server can MITM the call.** Send the SDP offer/answer — including the DTLS fingerprints — *through the
Double Ratchet session*. Then the call inherits the authentication of your message channel, and the
safety number the user already verified covers voice too.

Say this explicitly in your thesis. It is exactly the kind of end-to-end reasoning a strong dissertation
demonstrates.

**Additional:** offer an "always relay through TURN" privacy setting (Signal has this) — direct P2P reveals
your IP address to the other party.

---

### PHASE 10 — Group calls · 6 weeks · `[PARITY]` ⚠️ **highest-risk phase**

Mesh topology collapses past ~4 participants (each client encodes n-1 streams). Real group calling needs an
SFU — a server that forwards streams. But a normal SFU **decrypts** media, which breaks E2EE.

The solution is frame-level encryption: encrypt each media frame with a group key *before* it reaches the
SFU, using WebRTC **Insertable Streams / Encoded Transform**. The SFU routes opaque frames.

**The risk you must scout before committing:** `react-native-webrtc` support for Insertable Streams is
significantly behind the browser. **Spend three days in Phase 9 building a proof of concept** before
scheduling Phase 10. If the API isn't available on your target platforms, your options are:

1. Cap group calls at 3–4 participants using mesh (no SFU, E2EE preserved) — honest and achievable
2. Use an SFU **without** frame E2EE and document the trust boundary explicitly — a real degradation
3. Fork/patch `react-native-webrtc` — expensive, but genuinely novel work
4. Skip group calls; document the analysis

**Option 1 or 4 with a written analysis beats a broken option 2.** Do not compromise the E2EE story for a
feature checkbox — the whole thesis rests on that story.

---

## 9. PHASE 12 — INTERFACE EXCELLENCE · 4 weeks · `[CORE]`

You said "the best interface." That is a real, winnable goal — and you're closer than the code suggests.
But "best" is not more features; it is **systematic consistency, motion quality, and performance under
load.** Telegram feels good because everything is 60fps and every interaction has the same physics.

### 9.1 Finish the design system

From [UI_INTERFACE_ROADMAP.md](UI_INTERFACE_ROADMAP.md) §3.5, still outstanding:

**Tokens** — replace ad-hoc values with a systematic layer:
```ts
spacing:    4 · 8 · 12 · 16 · 24 · 32 · 48 · 64        // 4pt base grid
radii:      4 · 8 · 12 · 16 · 24 · full
type:       11/13/15/17/20/24/32  ×  {regular, medium, semibold}
             — with explicit line heights, not defaults
motion:     instant 100 · fast 150 · base 250 · slow 350 · deliberate 500
easing:     standard cubic-bezier(.2,0,0,1) · decelerate · accelerate · spring
elevation:  0–4 as shadow + border pairs, defined for BOTH themes
```

**Components still needed:** the unified row pattern (your own stated next step — one primitive serving
chat rows, contact rows, and settings rows), Avatar, Badge, Toast/Snackbar, Modal, ActionSheet, EmptyState,
ErrorState, Skeleton, Divider, SegmentedControl, Switch, Slider.

**Resolve the glass/blur decision** ([UI_INTERFACE_ROADMAP.md](UI_INTERFACE_ROADMAP.md) §3.5) — `@react-native-community/blur`
vs. Reanimated-based, with an Android performance fallback path. Your `surface style: glass/solid`
preference already anticipates this; now make it real.

### 9.2 Motion

Define a motion vocabulary and apply it uniformly:
- Screen transitions: shared-element where it aids continuity, never decorative
- Message send: optimistic insert → subtle settle, never a jarring re-layout on server ack
- Swipe-to-reply: spring physics with correct rubber-banding at the limit
- Typing indicator: continuous, not stepped
- Skeleton → content: crossfade, never a hard swap
- **Respect `prefers-reduced-motion`** — an accessibility requirement, and examiners notice

### 9.3 Performance budgets — measure, don't assume

| Metric | Target |
|---|---|
| Cold start to chat list | < 1.5s |
| Chat open (100 messages) | < 300ms |
| Message send → local echo | < 50ms |
| Scroll | 60fps sustained (120 on ProMotion) |
| Frame drops in a 1000-message scroll | < 1% |
| Memory, 50 conversations open | < 250MB |

**Actions:** replace `FlatList` with `FlashList` in the message list; ensure Reanimated animations run on
the UI thread (worklets, not JS-thread `Animated`); memoize message rows properly; move decryption off the
render path with a decrypt cache; virtualize the chat list; profile with Flipper/Hermes on a **low-end
Android device**, not just a simulator.

### 9.4 Accessibility — not optional, and easy marks

Screen reader labels on every interactive element; dynamic type support (test at 200%); contrast ≥ 4.5:1
verified in both themes; touch targets ≥ 44×44pt; focus order; VoiceOver/TalkBack tested end-to-end.

### 9.5 Platform fidelity

iOS: proper back-swipe, native share sheet, haptics matching Apple's vocabulary, safe-area handling,
Dynamic Island for calls. Android: predictive back (Android 14+), Material You color extraction as an
optional theme, correct notification channels, proper up-navigation.

### 9.6 Polish that separates good from excellent

App icon and adaptive icon; splash → first-frame with no flash; an onboarding flow that explains E2EE in
one screen without jargon; empty states with personality; error states that suggest an action; **haptics
vocabulary** (send / receive / error / verify are four distinct feelings); sound design; a genuinely
OLED-black dark theme, not dark grey.

### 9.7 Internationalization

`i18next` + `react-i18next`; extract every string; **RTL support** (Arabic/Hebrew — this is a real
engineering constraint that reveals hardcoded `marginLeft` everywhere, so do it early enough to matter);
locale-aware date/time via `date-fns` (already a dependency); pluralization rules. English + Russian +
Armenian is a natural set and demonstrates the system works.

---

## 10. QUALITY ENGINEERING

### 10.1 The test pyramid you need

```
                    ╱╲          Manual two-device      ~20 scenarios, per release
                   ╱  ╲         (the existing checklist)
                  ╱────╲        E2E (Detox/Maestro)    ~15 flows, on CI
                 ╱      ╲       Integration            ~50 tests
                ╱────────╲      Protocol harness       ~40 scenarios  ← Phase 2
               ╱          ╲     Property-based         ~10 properties × 10k cases
              ╱────────────╲    Unit (primitives)      ~200 tests, 100% coverage
```

### 10.2 Coverage targets by layer

| Layer | Target | Rationale |
|---|---|---|
| `packages/protocol/primitives` | **100%** | Pure functions; no excuse |
| `packages/protocol/ratchet` | **100% branch** | Every error path matters |
| Server routes | 80% | Focus on authorization paths |
| Client services | 70% | |
| UI components | 40% | Snapshot + interaction on shared components |

### 10.3 Beyond conventional testing — this is where thesis marks live

**Differential testing** `[FRONTIER]` — run your ratchet against `libsignal` (Rust, with Node bindings) on
identical inputs and assert identical outputs. Any divergence is either a bug in yours or a documented,
deliberate deviation. This is a *very* strong result to present.

**Fuzzing** `[CORE]` — throw structured-random envelopes at `decryptV2`. It must never hang (P1-2), never
corrupt session state, and always fail with a typed error. Cheap to build once the protocol is pure.

**Test vectors** `[CORE]` — publish input→output vectors for your handshake and ratchet. Makes your work
reproducible by a third party, which is exactly what a dissertation should enable.

**Benchmarks** `[CORE]` — ratchet ops/sec, handshake latency, storage per message, battery per 100
messages. Compare against published Signal figures where available. Charts in a thesis are persuasive.

---

## 11. PHASE 11 — RESEARCH FRONTIER · 6 weeks · `[FRONTIER]`

**Pick at most two.** Each is genuinely publishable-adjacent; attempting all three will sink the schedule.

### Option A — PQXDH (post-quantum handshake) · ~3 weeks

**Highest recommendation.** Signal shipped this in 2023; almost no student project has it.

Hybrid X25519 + ML-KEM-768 (Kyber). Add a PQ signed prekey and PQ one-time prekeys to the bundle; the KEM
ciphertext travels in the init packet; concatenate the KEM shared secret into the X3DH IKM before HKDF.
`@noble/post-quantum` provides ML-KEM in pure TypeScript, so this fits your existing stack cleanly.

Thesis value: **very high.** Directly addresses harvest-now-decrypt-later, which is a live topic. Your
Phase 3 "PQ-readiness" work makes this a contained change.

### Option B — Sealed sender · ~2.5 weeks

The server currently sees who talks to whom, which is the most sensitive metadata you leak. Sealed sender
encrypts the sender's identity into an envelope the server can't read, with a delivery certificate that
still permits rate limiting.

Requires header encryption (Phase 3) as a prerequisite. Thesis value: **high** — metadata privacy is
where the interesting open problems are, and you can quantify exactly what the server learns before and after.

### Option C — Key transparency · ~4 weeks

Solves the trust-on-first-use weakness: today a malicious server can hand a victim the wrong identity key
and only manual safety-number comparison catches it. A Merkle-tree-based append-only log with client-side
consistency and inclusion proofs makes key substitution detectable.

Thesis value: **very high**, cost also very high. A simplified version (signed append-only log +
client-verified inclusion proofs, without third-party auditors) is achievable and honestly scoped.

---

## 12. PHASE 13 — VERIFICATION & DISSERTATION · 6 weeks · `[CORE]`

### 12.1 Formal verification `[FRONTIER]` — the single highest-value thesis item

Model your protocol in **ProVerif** or **Tamarin** and mechanically verify the security properties:

| Property | Statement |
|---|---|
| Secrecy | The adversary never learns a message plaintext |
| Authentication | If B accepts a message as from A, A sent it |
| Forward secrecy | Compromise at time *t* does not reveal messages before *t* |
| Post-compromise security | After a ratchet step following compromise, security is restored |
| Key agreement | Both parties derive identical session keys |

Signal's protocol was formally analyzed by Cohn-Gordon et al. (2017); modelling **your variant** — including
your three-DH X3DH decision, if you keep it — is genuine contribution. If the model finds an attack, that
is an *excellent* result, not a failure: finding and fixing it is the strongest possible narrative.

Budget 3 weeks. ProVerif has a steeper learning curve than it looks, but the payoff for a security
dissertation is unmatched.

### 12.2 Threat model `[DOC]` — 1 week, cheap and essential

Structured, explicit:

**Adversaries:** passive network observer · active network attacker (MITM) · malicious server ·
compromised endpoint · law-enforcement compulsion · malicious conversation participant

**For each, per phase:** what they can and cannot do, which mechanism stops them, and what remains exposed.

**State the limits plainly:** the server sees who messages whom and when (until sealed sender); message
sizes and timing leak; a compromised device loses everything within the key-retention window; TOFU means
first contact is unauthenticated absent out-of-band verification.

**A threat model that honestly states limitations is worth more than one that claims perfection.** Examiners
specifically probe for awareness of what you did *not* solve.

### 12.3 Dissertation structure

| Ch. | Content | Source |
|---|---|---|
| 1 | Introduction, motivation, contributions | — |
| 2 | Background: E2EE, X3DH, Double Ratchet, related systems | §2 matrices |
| 3 | Comparative analysis: Signal / WhatsApp / Telegram-MTProto | §2 |
| 4 | Threat model | §12.2 |
| 5 | Architecture & design decisions | §5, [architecture.md](architecture.md) rewritten |
| 6 | Protocol implementation, including the deviations you found and fixed | §3.2 |
| 7 | Formal verification | §12.1 |
| 8 | Testing methodology & results | §10 |
| 9 | Performance evaluation | §10.3 benchmarks |
| 10 | Interface design & evaluation (ideally with a small user study, n≈10) | §9 |
| 11 | Limitations & future work | §2.3 |
| 12 | Conclusion | — |

**Start writing at Phase 2, not at the end.** Keep an engineering journal from now — the P1-3/P1-4 discovery
and fix, written up with the failing test and the corrected trace, is *exactly* the kind of concrete
narrative that distinguishes a strong dissertation from a feature list.

### 12.4 Evidence to collect as you go

Screenshots at every UI milestone · benchmark data at each phase · the ProVerif model and its output ·
test coverage reports over time · the security-review before/after · git history showing methodology ·
the parity matrices in §2, versioned, showing progress.

---

## 13. SCHEDULE & CUT LINES

### 13.1 Full plan (~59 weeks, ~13 months)

```
M1  ██ Phase 1  Security
M1  ████ Phase 2  Harness + ratchet correctness
M2  ███ Phase 3  Protocol hardening
M3  ███ Phase 4  Infrastructure
M4  ██████ Phase 5  Multi-device
M5  █████ Phase 6  Groups
M6  ████ Phase 7  Product completeness
M7  █████ Phase 8  Media, voice, backup
M8  █████ Phase 9  1:1 calls
M9  ██████ Phase 10 Group calls
M10 ██████ Phase 11 Research frontier (×2)
M11 ████ Phase 12  Interface excellence
M12 ██████ Phase 13 Verification + dissertation
```

### 13.2 Cut lines by available time

**If you have 3 months** — *"a rigorously correct secure messenger"*
Phases 1, 2, 3, 12 (partial), 13 (threat model + writing; skip formal verification).
No new features. Ship what you have, **correct and verified**, with an excellent interface and an honest
gap analysis. This is a **solid** thesis. Do not attempt calls.

**If you have 6 months** — *"…with groups and media"* ← **most likely your realistic target**
Phases 1, 2, 3, 4, 6, 7, 8, 12, 13 + ProVerif.
Skip multi-device and calls; document both as future work with a design sketch. This is a **strong** thesis.

**If you have 9 months** — *"…with calls"*
Add Phases 9 and 5. Group calls documented but not built (§8.4 risk analysis stands in for it).
This is a **very strong** thesis.

**If you have 12+ months** — *"…and a research contribution"*
Everything, including two `[FRONTIER]` items. PQXDH + formal verification is the strongest pairing.
This is **publishable-adjacent** work.

### 13.3 Non-negotiable regardless of timeline

1. **Phase 1** — the credentials and cleartext HTTP must be fixed; they invalidate the project's premise
2. **Phase 2** — an unvalidated protocol that silently loses messages cannot be defended
3. **§12.2 threat model** — one week, and it is what turns an implementation into research
4. **Honest limitations chapter** — every claimed feature must be true; examiners verify

### 13.4 Working method

- **Never start a phase with the previous phase's gate unmet.** Compounding protocol debt is what produced P1-3.
- **One branch per phase**, merged behind the CI gate from Phase 4
- **Update §2 matrices at every phase end** — the diff is your progress narrative
- **Journal weekly**: what you tried, what failed, what you learned. This becomes Chapter 6.
- **Re-run [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) at every phase gate** once it's automated — it costs
  minutes and catches regressions

---

## 14. RISK REGISTER

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Insertable Streams unavailable in RN WebRTC | **High** | Group calls impossible | 3-day PoC during Phase 9; fall back to mesh-4 or document (§8.4) |
| Multi-device refactor destabilizes 1:1 | **High** | Regression in working code | Phase 2 harness must exist first; feature-flag the rollout |
| Formal verification learning curve | Medium | 3 weeks → 6 | Start the ProVerif tutorial during Phase 3 evenings; timebox hard |
| Scope creep from feature comparison | **High** | Nothing finishes | Re-read §2.3 whenever tempted; concessions are documented, not failures |
| TURN/SFU hosting cost | Medium | Calls unaffordable | `coturn` on a €5/mo VPS is fine at thesis scale; budget bandwidth |
| iOS deployment friction (certs, TestFlight) | Medium | Late-stage blocker | Get an Apple Developer account and one TestFlight build out during Phase 4 |
| Solo burnout across 12 months | **High** | Project abandoned | Ship something demoable at every phase gate; visible progress sustains motivation |
| Key rotation breaks existing sessions | Medium | Data loss in testing | Version every wire change; test the migration path in the harness |
| Thesis writing deferred to the end | **High** | Rushed, weak dissertation | Write chapters as phases complete; Ch. 2–4 can be written now |

---

## 15. OPEN DECISIONS — your call, needed soon

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| D1 | Defense date / available months | — | **Tell me and I'll re-cut §13** | Now |
| D2 | X3DH: fix the 4th DH or document the deviation | Fix / Document | **Fix.** ~4 lines each side; then narrate the discovery | Phase 2 |
| D3 | AEAD: keep `secretbox` + prefix-AD, or move to XChaCha20-Poly1305 | A / B | **B** if schedule allows — proper AD, cleaner header encryption | Phase 2 |
| D4 | Repository: rewrite history or start clean | filter-repo / fresh | **Fresh repo**, archive the old privately. Simpler, and a clean history reads better in submission | Phase 1 |
| D5 | Which two `[FRONTIER]` items | PQXDH / sealed sender / KT | **PQXDH + formal verification** — highest value per week | Phase 10 |
| D6 | Multi-device before or after groups | 5→6 / 6→5 | **5 before 6.** Sender-key distribution is per-device; doing groups first means redoing it | Phase 4 |
| D7 | Storage engine for messages | AsyncStorage / MMKV / SQLite | **SQLite** (`op-sqlite`). AsyncStorage will not survive search or large histories | Phase 7 |
| D8 | Group call strategy if Insertable Streams fails | mesh-4 / SFU-no-E2EE / skip | **mesh-4 or skip.** Never break the E2EE story for a checkbox | Phase 9 |

---

## 16. THE HONEST SUMMARY

You have built the hard part. A from-scratch X3DH plus Double Ratchet with prekey infrastructure, safety
numbers, and encrypted history keys — solo, from primitives, with a correct chain KDF and a correct root
KDF — is genuinely difficult, and most people who attempt it do not finish. The interface is further along
than the code alone suggests: swipe-to-reply, reply threading, pinned and archived chats, a working
appearance system, and shared design-system components are all real.

Three things stand between that and the target you named.

**First, the security perimeter currently negates the cryptography.** Committed database credentials and
cleartext HTTP mean an attacker takes a session token and publishes their own prekey bundle under your
user's identity. Everything you built downstream of that is bypassed. Two weeks fixes it.

**Second, the ratchet loses messages, and you don't know it yet.** [dhRatchet.ts:150](chats-client/src/shared/crypto/dhRatchet.ts#L150) clears skipped keys
on every epoch change, and `header.pn` is transmitted but never read — so any message that crosses a DH
ratchet boundary out of order is permanently lost and reported to the user as a replay attack. This is
ordinary mobile-network reordering, not an attack. It went unnoticed because
[V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) has never been run — its §6 scenarios are exactly the ones that expose it.
Build the harness first; then fix the ratchet with the harness catching you.

**Third, the target needs reframing to be winnable.** You will not match WhatsApp's feature breadth solo —
nobody expects you to, and chasing it is the most likely way to end up with a broad, shallow, insecure
result. You *can* match Signal's rigor on the subset you build, and you can beat all three on interface
polish because you're optimizing one experience instead of serving two billion users. Then write down
precisely what you did not build and why. **A thesis that says "I implemented X and Y rigorously, formally
verified them, and here is my analysis of Z which I deliberately did not build" is a stronger result than
one that ships six half-features.** The parity matrices in §2 exist to make that argument for you.

Fix the perimeter this month. Build the harness and fix the ratchet next. Then decide, from §13, how far
your calendar actually reaches — and tell me the date, so the schedule can be cut properly rather than
optimistically.

---

*Living document. Update §2 matrices and §3 register at every phase gate. Keep [ROADMAP.md](ROADMAP.md) as the
protocol design reference; this is the execution plan.*
