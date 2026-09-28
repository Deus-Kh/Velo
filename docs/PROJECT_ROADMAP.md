# VELO — MASTER ROADMAP v2

### From working prototype to a verifiable, shippable secure messenger
**Version 2** · Status date 2026-09-07 · Branch `master` · Open Beta 0.1 (`c9c9267`)
Supersedes [archive/PROJECT_ROADMAP.v1.md](archive/PROJECT_ROADMAP.v1.md) (2026-08-07). Evidence for every claim: [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md). Execution detail: [AGENT_EXECUTION_SPEC.md](AGENT_EXECUTION_SPEC.md).

---

## 0. HOW TO READ THIS DOCUMENT

### 0.1 The target, and the two constraints you set

> *"A real competitor to Signal and any Signal-like app."*
> Constraints (2026-09-07): **thesis and product matter equally**, **about six months**, **keep the from-scratch protocol but verify it against libsignal**.

Those constraints decide the shape of this plan:

| Dimension | Benchmark | Six-month verdict |
|---|---|---|
| Cryptographic rigor | Signal | **Achievable, and non-negotiable.** Today the protocol is not yet a Double Ratchet (§3.2 P1-0) and does not authenticate senders (§3.1 P0-9). Both are fixable in weeks once a harness exists. |
| Security perimeter | Signal | **Achievable in weeks.** Cleartext transport, live secrets as config fallbacks, no rate limits, socket authorization holes. |
| Table-stakes features | WhatsApp / Signal | **Partially achievable.** Push, groups, media, disappearing messages, delete/edit/reactions, block/report, account deletion fit. Multi-device, calls, backup with PIN escrow do not. |
| Interface | Telegram | **Achievable.** The visual layer is already good; the behavioural layer (errors, confirmations, accessibility, offline) is prototype grade. |
| Scale / operations | All three | **Not required for either goal.** Single region, one process behind a Redis adapter, observability, CI. |

### 0.2 What changed since v1

v1 was written from a static read that missed the two defects that matter most and mis-diagnosed its top P0. Corrections in v2:

1. **The DH ratchet never executes** (new P1-0). v1's Phase 2 fixed epoch-boundary message loss in code that never runs, and its normative algorithm preserved the bug.
2. **The responder never authenticates the initiator, and the safety number does not cover the key used in the handshake** (new P0-9).
3. **v1's P0-1 was wrong about git.** The server config was never committed. The credentials are hardcoded fallbacks that are live because no `.env` exists. No history rewrite is needed for that file.
4. **The real committed secret** is the Android release-keystore password in a tracked file, in a repository that is public (new P0-10).
5. **Push does not work the way v1 says**, iOS cannot connect at all, a wrong password blanks the app, logout leaves every key on disk (new P1-9, P0-11, P0-12, P1-10).
6. **The storage model is the root cause of the forward-secrecy erosion**, not a tuning problem (P1-7 replaced by P1-10).
7. The decision register is now answered (§13) and the schedule is cut to 26 weeks (§11).

### 0.3 Tier tags

- `[CORE]` — required for either goal. Do not cut.
- `[PARITY]` — closes a real gap against Signal/WhatsApp. Cut only under deadline pressure, in the order given in §11.3.
- `[FRONTIER]` — research-grade. At most two.
- `[DOC]` — written analysis, no code.

### 0.4 Document map

| Document | Role |
|---|---|
| [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md) | Verified findings with file:line evidence. Update when a finding is closed. |
| [AGENT_EXECUTION_SPEC.md](AGENT_EXECUTION_SPEC.md) | Task-level *how*, acceptance criteria, normative algorithms. |
| [protocol/ROADMAP.md](protocol/ROADMAP.md) | Original protocol design reference (2026-03). Its §4 "Current Status" is superseded by §1 here. |
| [protocol/SESSION_ESTABLISHMENT_POLICY.md](protocol/SESSION_ESTABLISHMENT_POLICY.md) | Session lifecycle rules. Must be rewritten for the standard bootstrap (T2.0) and identity checks (T2.13). |
| [protocol/V2_STABILIZATION_CHECKLIST.md](protocol/V2_STABILIZATION_CHECKLIST.md) | Manual two-device acceptance suite. 0/22 checked. Becomes the Phase 2 gate. |
| [design/UI_INTERFACE_ROADMAP.md](design/UI_INTERFACE_ROADMAP.md), [design/UX.md](design/UX.md), [design/UserFlow.md](design/UserFlow.md), [design/UI_realization.md](design/UI_realization.md) | Interface references. |
| [design/architecture.md](design/architecture.md) | Stale layer diagram; rewrite in T4.11. |
| [archive/](archive/) | v1 roadmap and spec, kept for the change narrative. Credential quotes were redacted on 2026-09-07. |
| [../README.md](../README.md) | Contains claims that are not true (email verification, tests, "history limited to session"). Fix in T1.11. |

---

# PART I — WHERE YOU ACTUALLY ARE

## 1. VERIFIED INVENTORY

### 1.1 Cryptographic core

| Component | File | Verdict |
|---|---|---|
| Primitives, chain KDF, root KDF | `ratchetChain.ts`, `ratchetRoot.ts`, `kdf.ts` | **Correct.** `MK=HMAC(CK,0x01)`, `CK'=HMAC(CK,0x02)`; HKDF-SHA256 with root key as salt. |
| X3DH handshake | `x3dh.ts` | Works between two honest clients. Three of four DHs. **Initiator unauthenticated** (P0-9). |
| Signed prekey signature | `prekeyBundleVerify.ts` | Math correct. **Trust unpinned**: verified with the key in the same response (P0-9). |
| Signed prekeys | `prekeys.ts` | Never rotate (P1-6). |
| One-time prekeys | `prekeys.ts`, `oneTimePreKeys.ts` | Server consumption atomic. Pool drainable by anyone (P0-4). Secret deleted before session creation; leaked when an `initPacket` is ignored. |
| DH ratchet | `dhRatchet.ts`, `sessionStore.ts`, `messageV2.ts` | **Never executes** (P1-0). Correct root-KDF code that is unreachable. |
| Symmetric ratchet | `messageV2.ts` | Works. Skip loop unbounded (P1-2). Header unauthenticated (P1-1). State mutated before authentication. |
| Wire format v2 | `messageV2.ts`, `Message.ts` | `{header:{n,pn,dhPub}, nonce, ciphertext}` + optional `initPacket`. Header in clear on the server. |
| Safety numbers / TOFU | `fingerprint.ts`, `trustedIdentities.ts` | **Display-only.** Never consulted by any crypto path; omits the X25519 identity key (P0-9). |
| Session store | `sessionStore.ts` | Root key, chain keys, DH private key **in plaintext AsyncStorage** (P0-3). |
| Encrypted message-key archive | `v2MessageKeyStore.ts`, `historyMasterKey.ts` | Sound wrapping, wrong concept: every key ever derived is kept forever because there is no local message store (P1-10). |
| Session bootstrap / reset | `sessionBootstrap.ts` | Early-returns when a session exists: peer reinstall and glare break silently (P1-11). |

The server stores only ciphertext for message bodies. That part is true and worth keeping true.

### 1.2 Product surface

The interface is further along than the code: swipe-to-reply, reply threading with quoted blocks, date separators, presence/typing/read state, offline and reconnect notices, pinned/archived chats, skeleton loaders, five distinct empty states, a working appearance system (theme, density, surface style), shared `Button`/`Input`/`ScreenHeader`/`SectionEyebrow`/`StatusChip`/`BottomSheetPanel`.

What a user can actually do today: 1:1 text with replies, receipts, typing, presence, and a safety-number screen. Nothing else on the Signal checklist exists (§2.2).

### 1.3 Maturity scorecard

| Layer | Score | Note |
|---|---|---|
| Crypto primitives & KDFs | 8/10 | Correct constructions, good libraries |
| Protocol core | 3/10 | No DH ratchet, no initiator authentication, no header AD |
| Protocol edge cases | 2/10 | Unbounded skip, glare, reinstall, replay all unhandled |
| Server security posture | 2/10 | Live secret fallbacks, cleartext, no rate limits, authz holes |
| Transport / platforms | 2/10 | Cleartext; iOS cannot connect; push has no client handler |
| Product UI (visual) | 6/10 | Genuinely good |
| Product UI (behavioural) | 3/10 | Silent auth failures, no confirmations, no a11y, no i18n |
| Feature breadth | 3/10 | No media, groups, calls, multi-device, backup, delete |
| Test coverage | 0/10 | One default smoke test; client type-check fails |
| Ops / deploy | 1/10 | `nodemon` in production, one process, no CI — *compiled `dist/` build since T4.1 (2026-09-28)* |
| Documentation | 6/10 | Thorough but was untracked and partly wrong |

**Composite ~3.5/10 against "production secure messenger".** The distance is in schedulable work, but two of the items (P1-0, P0-9) are protocol-level and must come before anything else that touches sessions.

---

# PART II — THE GAP TO SIGNAL

## 2. PARITY MATRICES

### 2.1 Cryptographic parity

| Capability | Signal | WhatsApp | Telegram | **Velo today** | **Velo at 6 months** |
|---|---|---|---|---|---|
| E2EE 1:1 by default | ✅ | ✅ | ❌ | ✅ | ✅ |
| X3DH / async handshake | ✅ | ✅ | ✅ (secret chats) | ⚠️ 3 of 4 DHs | ✅ T2.9 |
| Initiator authentication | ✅ | ✅ | ✅ | ✅ since T2.13 | done |
| Double Ratchet (DH step) | ✅ | ✅ | ❌ | ❌ never fires | ✅ T2.0 |
| Post-compromise security | ✅ | ✅ | ❌ | ❌ | ✅ T2.0 |
| AEAD with header + identity AD | ✅ | ✅ | ✅ | ❌ | ✅ T2.5 |
| Header encryption | ✅ | ✅ | — | ✅ wire v4: header sealed under HKs/NHKs, trial decryption (T3.6) | done |
| Forward secrecy at rest | ✅ | ✅ | ⚠️ | ✅ keys deleted with the step, plaintext sealed locally (T2.14) | done |
| Safety numbers | ✅ | ✅ | ✅ | ✅ libsignal numeric fingerprint over both keys, enforced (T2.13) | done |
| Signed prekey rotation | ✅ | ✅ | — | ✅ 7-day rotation, 30-day retention, tagged signature (T2.10) | done |
| Prekey drain protection | ✅ | ✅ | — | ❌ | ✅ T1.4 |
| Encrypted local store | ✅ | ✅ | ✅ | ✅ sealed AsyncStorage records (T2.14, D7 = A; SQLite when search needs it) | done |
| Delete-on-delivery server | ✅ | ✅ | ❌ | ✅ ciphertext deleted on the recipient's ack, receipts + 30-day TTL (T3.1) | done |
| Multi-device (Sesame) | ✅ | ✅ | ✅ | ❌ | ❌ deferred, §10 |
| Group E2EE (Sender Keys) | ✅ | ✅ | ❌ | ❌ | ✅ Phase 6' (per-user) |
| Sealed sender | ✅ | ❌ | ❌ | ❌ | ❌ documented |
| Private contact discovery | ✅ | ❌ | ❌ | ❌ | ❌ documented |
| Key transparency | ✅ | ⚠️ | ❌ | ❌ | ❌ documented |
| Post-quantum handshake | ✅ | ❌ | ❌ | ❌ | ⚠️ readiness only (T3.5) |
| Encrypted backup w/ PIN escrow | ✅ | ✅ | — | ❌ | ❌ deferred |
| E2EE calls | ✅ | ✅ | ✅ | ❌ | ❌ deferred |
| Disappearing messages | ✅ | ✅ | ✅ | ❌ | ✅ Phase 7' |
| Verified against reference impl. | n/a | n/a | n/a | ✅ X3DH, KDFs, message keys, fingerprint byte-identical to libsignal 0.103 (T2.15, green since T2.9) | done |

### 2.2 Product parity

| Feature | Signal | **Velo today** | **6 months** |
|---|---|---|---|
| 1:1 text, reply/quote | ✅ | ✅ | ✅ |
| Read receipts / typing / presence | ✅ with toggles (no presence) | ⚠️ always-on, no toggles, subscribable by anyone | ✅ toggles + relationship check (P2-10) |
| Push notifications | ✅ data-only, decrypted on device | ✅ data-only wake-up, fetched and decrypted on the device, rendered with the local contact name and an honest preview toggle (T3.3, Android); iOS parked | done (Android) |
| iOS build | ✅ | ❌ cannot connect | ⏸ T1.16 deferred by owner (2026-09-28): Android only for now |
| Reactions, edit, delete, forward | ✅ | ❌ | ✅ Phase 7' |
| Images / video / files / voice notes | ✅ | ❌ | ✅ Phase 8' |
| Disappearing messages | ✅ | ❌ | ✅ Phase 7' |
| Avatars / profiles | ✅ encrypted | ⚠️ initials only | ✅ Phase 7' |
| Groups | ✅ | ❌ structurally impossible (2-member limit) | ✅ Phase 6' |
| Block / report | ✅ | ❌ | ✅ Phase 7' |
| Account deletion | ✅ | ❌ | ✅ Phase 7' **(legally required)** |
| Local history survives reinstall | ✅ backup/transfer | ❌ everything becomes `[Encrypted]` | ⚠️ local DB (T2.14); backup deferred |
| Search in chat | ✅ | ❌ | ⚠️ if local DB lands early |
| Multi-device | ✅ | ❌ | ❌ deferred |
| 1:1 / group calls | ✅ | ❌ | ❌ deferred |
| Screen lock, screenshot protection | ✅ | ❌ | ⚠️ Phase 12' if time |
| Pinned / archived chats | ✅ | ⚠️ local only | ⚠️ local (server sync deferred) |
| Phone-number-free identity | ⚠️ phone required at signup | ✅ email + username | ✅ **differentiator** |
| Contact upload | ✅ hashed/enclave | ❌ none needed, but the directory is public (P0-6) | ✅ fixed search; no upload ever |
| Desktop | ✅ | ❌ | ❌ out of scope |
| i18n / RTL | ✅ | ❌ | ⚠️ scaffold + en/ru/hy |
| Accessibility | ✅ | ❌ zero props | ✅ Phase 12' |

### 2.3 Explicitly out of scope for six months `[DOC]`

Write these into the thesis with reasoning. Concession with analysis reads as maturity.

| Not building | Why | What you write instead |
|---|---|---|
| Multi-device (Sesame) | Changes the identity unit from user to device; ~6 weeks; groups must be re-keyed per device afterwards | Design sketch: `Device` model, per-device bundles, fan-out, provisioning, "new device" safety-number change |
| Calls (1:1, group) | 5 + 6 weeks, WebRTC + TURN/SFU; Insertable Streams risk on RN | Design: SDP through the ratchet so DTLS fingerprints inherit the safety number; TURN-only privacy mode |
| Encrypted backup with PIN escrow | Needs Argon2id + rate-limited server; without an enclave it is weaker than Signal's SVR | Threat analysis of PIN escrow without a TEE |
| Sealed sender | Requires header encryption first | Quantify what the server learns before/after |
| Key transparency | Merkle log + client proofs, ~4 weeks | Analysis of TOFU vs KT; what a malicious server can do today |
| Private contact discovery | SGX/PSI infrastructure | Note that Velo never uploads contacts, so the gap is the searchable directory, fixed in T1.6 |
| Post-quantum handshake (PQXDH) | ML-KEM via `@noble/post-quantum` is available, ~3 weeks | Keep the IKM extension point (T3.5); discuss as first post-defense item |
| Desktop / web | Multiplies platform work | Note that `packages/protocol` (T2.1) makes it possible |
| Stickers, channels, bots, stories | Breadth, no research content | State the secure-core focus |

---

## 3. DEFECT REGISTER

Every entry cites [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md). Fix P0 first, then P1 in the order shown; P1-0 and P0-9 gate every other protocol task.

### 3.1 P0 — Security. Nobody else installs this until these are closed.

**P0-1 · Live secrets as hardcoded config fallbacks; no `.env`** `[CORE]`
`chats-server/src/config.ts:7-8` falls back to a real Atlas connection string and a dictionary-word JWT secret. The file is gitignored and **was never committed** (git history is empty for it), but no `.env` exists, so the fallbacks are the running values. Anyone who guesses the JWT secret mints a token for any user.
Fix: rotate both secrets; replace fallbacks with hard failure on missing env; require a 32+ byte JWT secret; **add the sanitized `config.ts` to git** so a clean clone compiles; `.env.example` in the repo. **No history rewrite is needed for this file.** → T1.1
**Status 2026-09-11:** code resolved by T1.1 (`8a83696`). Still open for the human: rotate the Atlas password and put it in `chats-server/.env`.

**P0-2 · All traffic is cleartext HTTP; iOS cannot connect** `[CORE]`
`http.ts:6`, `socket.ts:5` hardcode `http://` to a bare IP; `AndroidManifest.xml:15` permits cleartext; iOS ATS blocks it entirely. Bearer tokens and prekey bundles cross the network in the clear; with P0-9 that is full impersonation for an on-path attacker.
Fix: domain + TLS (Caddy), env-driven URLs via `react-native-dotenv` (currently not even registered in Babel), cleartext off, iOS ATS satisfied, pinning in Phase 4'. → T1.2, T1.16
**Status 2026-09-11:** client side resolved by T1.2 (`90c27ee`): URLs from `.env`, release builds refuse `http://`, Android cleartext off (debug builds allow it for localhost and the current dev server only). Still open: domain + certificate + Caddy (human), then remove the dev-server entry from the debug network config; iOS Firebase config (T1.16).

**P0-3 · Ratchet private state, OPK secrets, pending plaintext, trust pins unencrypted at rest** `[CORE]`
`sessionStore.ts:27-30`, `oneTimePreKeys.ts:12`, `pendingMessageStore.ts:41`, `trustedIdentities.ts:19`. The chain keys derive every future message key, so the encrypted message-key archive protects nothing.
Fix: a separate Keychain-held session master key; `secretbox` the serialized session, the OPK secrets, the pending queue, and an HMAC over the trust pins. → T1.3
**Status 2026-09-25:** resolved by T1.3. Session state, one-time prekey secrets and the outgoing queue are sealed with XSalsa20-Poly1305 under a per-user `session-mk` Keychain entry (separate from the history master key); trust pins carry an HMAC bound to (me, peer, key) and a failed check is treated as "not trusted"; every Keychain write now uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Deviation from the spec: pre-T1.3 plaintext entries are **migrated in place** on first read rather than discarded, so existing conversations survive the upgrade (discarding buys nothing for bytes already on disk and would break every chat until T2.11). Stale `skippedKeys` type and `ProtoVersion` corrected. Verified by 16 Jest tests with mocked AsyncStorage/Keychain: no secret substring appears in stored blobs, wrong key or tampered blob → `null`, another user's master key cannot open a copied blob, tampered pin → not trusted, legacy values migrate.

**P0-4 · One-time prekey pool drainable by any authenticated user** `[CORE]`
`keys.routes.ts:134-177` consumes an OPK per call, unthrottled, no relationship check; fallback to no-OPK is silent.
Fix: budget every fresh issue per (requester, target) pair and per requester, keep an issue ledger, report the remaining count, refill on the client on a threshold and on foreground, log depletion. → T1.4
**Design change 2026-09-11:** the v2.0 spec's 24 h per-pair bundle *cache* was dropped before implementation. The responder deletes a one-time prekey secret after first use, so re-serving a cached bundle would break every session a requester re-establishes after a reset or reinstall (the v1 spec's "same OPK for one requester" argument was wrong). Replaced by Signal-style issue budgets: 5 issues per pair per hour, 30 per requester per hour, on top of a coarse 120 requests/h/user cap.
**Status 2026-09-11:** resolved by T1.4. Also: unused pool capped at 500 keys per user, consumed keys expire after 30 days, per-item validation on upload, client tops up at login and on every return to the foreground (throttled to once per 5 min). Verified by route tests against an in-memory MongoDB: 6th request per pair → 429, 31st distinct target → 429, 100 sequential requests consume ≤ 5 keys, warn at <10 and error at 0, own bundle → 400.

**P0-5 · No rate limiting anywhere** `[CORE]` → T1.5
**Status 2026-09-11:** resolved by T1.5. Global 1000/15 min/IP, auth 10/15 min/IP, bundle 20/h/user, per-account login backoff min(2^n, 300) s, socket 60 messages/min/user and a 64 KiB ciphertext cap. Redis-backed when `REDIS_URL` is set (required in production); in-memory in development. Verified live: 11th login → 429; backoff 2 s → 4 s; 61st socket send → `RATE_LIMITED`.

**P0-6 · User directory dump with emails, and ReDoS in search** `[CORE]`
`users.routes.ts:173-199`: empty `q` returns every account with email; raw `$regex`. Emails also in `GET /conversations`.
Fix: min 3 chars, escaped prefix match on username only, no email in any response, rate limit. → T1.6
**Status 2026-09-23:** resolved by T1.6. `GET /users` requires a 3–32 character query, escapes it, and matches a case-insensitive username prefix only; email removed from the search response and from `GET /conversations`. Client shows `@username` or the short secure ID where it used to show email, and searches saved contacts by username only. Verified by route tests: empty/short query → `[]`, `(a+)+$` answers in well under a second, no `@` address in any body, `malice@` matches nothing.

**P0-7 · Missing authorization on socket handlers** `[CORE]`
`message:delivered` (`setupSocket.ts:588-597`) mutates any message by id; `message:read` (630–686) trusts a client `conversationId` and spoofs receipts; `presence:subscribe` / `typing:*` (292–335) accept any target.
Fix: ownership checks, server-derived conversation ids, relationship check for presence/typing. → T1.7
**Status 2026-09-23:** resolved by T1.7. `message:delivered` takes only `serverMessageId` and requires the caller to be the recipient (read is never regressed); `message:read` names the peer and the server derives the conversation; presence and typing require an existing conversation between the two users; `message:send` refuses self-send and unknown recipients; acks return codes, never internal messages. The authorization table sits above `setupSocket`. Verified by socket-level tests with three real clients (stranger refused everywhere and hears nothing; partner works). P2-10's relationship check is done; the privacy toggles remain for Phase 7'.

**P0-8 · No password policy at registration; mismatched client rules** `[CORE]` → T1.8
**Status 2026-09-25:** resolved by T1.8. Shared zod validation module for every mutating route (auth, profile, push token, all key uploads with exact decoded key lengths); password policy = min 10 chars + zxcvbn score ≥ 3 against the user's own identifiers + HaveIBeenPwned k-anonymity breach check that fails open; usernames restricted to a safe alphabet and unique case-insensitively at the database level; field-level `400 VALIDATION` responses rendered next to the inputs; strength meter on the registration form. Verified by 79 server tests including register/login/change-password routes against an in-memory MongoDB.

**P0-9 · Initiator identity unauthenticated; safety number omits the DH identity key; bundle trust unpinned** `[CORE]` *(new)* — **fixed 2026-09-28 (T2.13)**
`x3dh.ts:130-133` uses the initiator's identity key straight from the `initPacket`. `prekeyBundleVerify.ts:5-15` verifies the SPK with the identity key from the same response. `fingerprint.ts:14-21` hashes only the Ed25519 keys; nothing binds Ed25519 to X25519. The trust store is never read by any crypto path. Result: the server, or any on-path attacker while P0-2 is open, can impersonate any sender to any victim and can swap the X25519 identity key without changing the safety number. `setupSocket.ts:481-495` (server attaches stored `initPacket`s to later messages) turns this into a first-class injection point.
Fix: identity binding signature (Ed25519 over the X25519 identity key), pinned identities enforced on both bundle fetch and every `initPacket`, safety number over both keys using libsignal's fingerprint construction, `IDENTITY_MISMATCH` blocks the chat until acknowledged, server records identity-key history and notifies peers. → T2.13

**P0-10 · Release-keystore password tracked in a public repository** `[CORE]` *(new)*
`chats-client/android/gradle.properties:49-52`, tracked since the first commit, consumed by `build.gradle:98-100`. The keystore binary itself is gitignored.
Fix: rotate the upload key (Play Console upload-key reset if the app was ever uploaded with it; otherwise generate a new keystore), move credentials to `~/.gradle/gradle.properties` or CI secrets, gitignore the file, and purge history (this, not P0-1, is what justifies decision D4). → T1.13
**Status 2026-09-11:** code resolved by T1.13 (`e880c5e`): credentials removed from the tracked file, release builds fail loudly without external properties, debug builds unaffected. Still open for the human: rotate the upload key; decide D4 (the old password remains in history until then).

**P0-11 · A wrong password blanks the app** `[CORE]` *(new)*
`auth.store.ts:130-132` and `155-157` await the API call outside the try/finally; `Navigation.tsx:58` renders `null` while loading. Login requires 8 chars, register 6.
Fix: try/catch/finally, error surfaced in the form, one shared password rule. → T1.0
**Status 2026-09-11:** resolved by T1.0 (`ba7edb2`). Client type-check is green again (P2-12 client part).

**P0-12 · Logout leaves every session, key, and plaintext pending message on disk** `[CORE]` *(new)*
`auth.store.ts:199` removes two AsyncStorage keys. The next account on the device inherits the previous user's decryptable material. `deleteAllSessionsForUser` exists and is never called.
Fix: full per-user wipe on logout (sessions, message keys, OPK secrets, pins, pending queue, Keychain entries); encrypt the pending queue. → T1.14
**Design change 2026-09-25:** an unconditional wipe on logout was not implemented. All local state is already namespaced by userId, so a second account cannot use another account's material; the real risk is at-rest exposure, which T1.3 (encryption) addresses. Wiping sessions on every logout would also break every existing conversation on re-login until T2.11 automates re-bootstrap. Logout therefore offers two paths: "Log out" keeps protocol state, "Log out and erase local data" wipes sessions, message keys, the history master key and the plaintext outgoing queue (identity and trust pins survive so the safety number does not change). "Reset local secure state" is the full wipe and now asks for confirmation.
**Status 2026-09-25:** resolved by T1.14 with the design above. Shared `wipeLocalStateForUser(userId, scope)` used by both paths; the push token is always unregistered on logout regardless of the push preference (previous no-op bug); the first two confirmation dialogs in the app. Pending-queue encryption stays with T1.3.

### 3.2 P1 — Protocol correctness

**P1-0 · The DH ratchet never executes** `[CORE]` *(new, blocks P1-3, P1-4)* — **fixed 2026-09-28 (T2.0)**
`sessionStore.ts:81-103` gives both sides a fresh `DHs` and `DHrPublicKey: null`; `messageV2.ts:108-112` adopts the first inbound `dhPub` without ratcheting; `messageV2.ts:90` reuses `DHsPublicKey` forever; `dhRatchet.ts:124` is the only place a new `DHs` is made and nothing ever triggers it. The protocol degenerates to two static HMAC chains: **no post-compromise security**, `rootKey` never read again. v1's DEVIATION-1 was this bug, not a design choice.
Fix: standard Double Ratchet initialisation — initiator ratchets against the responder's signed prekey at session creation; responder's initial `DHs` is the SPK pair copied into the session; a null `DHr` on first receive **triggers a full ratchet step** instead of adoption; the HKDF directional split is deleted. Wire bump shared with P1-1. → T2.0

**P1-1 · Message header not authenticated; ciphertext not bound to identities** `[CORE]` — **fixed 2026-09-28 (T2.5)**
`messageV2.ts:74` seals plaintext only; `n`, `pn`, `dhPub` are malleable and acted on before authentication.
Fix: XChaCha20-Poly1305 with `AD = IK_A || IK_B || canonicalHeader` (decision D3 = B). → T2.5

**P1-2 · Unbounded skip loop — remote client freeze** `[CORE]` — **fixed 2026-09-28 (T2.5)**
`messageV2.ts:156-192` on attacker-chosen `header.n`; server checks only `n >= 0`. → T2.6

**P1-3 · Ratchet step discards skipped keys** `[CORE]` (`dhRatchet.ts:150`; reachable only after P1-0) → T2.7

**P1-4 · `header.pn` never read** `[CORE]` (reachable only after P1-0) → T2.8

**P1-5 · X3DH omits `DH(EK_A, IK_B)`** `[CORE]` — decision D2 = fix. → T2.9 — **fixed 2026-09-28 (T2.9)**

**P1-6 · Signed prekey never rotates** `[CORE]` (`prekeys.ts:38-55`) → T2.10 — **fixed 2026-09-28 (T2.10)**

**P1-7 · Message keys retained forever** — **superseded by P1-10.** The 30-day window from v1 remains only as the fallback if T2.14 slips.

**P1-8 · No header encryption** `[PARITY]` — server reads `n`, `pn`, `dhPub`. Only if on schedule. → T3.6 — **fixed 2026-09-28 (wire v4; the server sees three opaque strings)**

**P1-9 · Push has no client handler; iOS unconfigured; payload leaks sender and pair; token pruning bug; preview toggle is a no-op** `[PARITY]` *(new)*
No `setBackgroundMessageHandler`/`onMessage`/tap handler exists. Server `notification.title` is the sender's username and `data.conversationId` is the participant pair (`push/firebase.ts:69,85-90`). Any FCM error deletes the token (107–109).
Fix: data-only pushes carrying only `type` + `serverMessageId`; client resolves the sender name locally and renders via notifee; tap deep-links; iOS Firebase configured; prune only on `registration-token-not-registered`. → T3.3 — **fixed for Android 2026-09-28 (T3.3); iOS remains parked with T1.16**

**P1-10 · No local message store; keys kept forever; reinstall and "reset" destroy history** `[CORE]` *(new, replaces P1-7)* — **fixed 2026-09-28: client side by T2.14 (D7 = A), server delete-on-delivery, receipts and TTL by T3.1**
`useChatE2EE.ts:562-608` refetches ciphertext from the server on every open, so every message key must be kept (`v2MessageKeyStore.ts`). Reinstall makes all history `[Encrypted]` forever; "Reset secure session" (`useChatE2EE.ts:820-832`) deletes the keys it would need.
Fix (the Signal model): encrypted local message DB (SQLite + SQLCipher via `@op-engineering/op-sqlite`, key in Keychain); decrypt once, store plaintext locally; **delete message keys after use**, keep only bounded skipped keys in the session; fetch only undelivered messages from the server; server deletes ciphertext after delivery and TTL-expires undelivered messages. Prerequisite for search, disappearing messages, backup, multi-device. Decision D7 pulled forward. → T2.14, T3.1

**P1-11 · Glare and peer-reinstall produce mismatched sessions with no detection; OPK secret deleted before session creation** `[CORE]` *(new)* — **fixed 2026-09-28 (T2.11; stale-prekey part by T2.13)**
`sessionBootstrap.ts:9,36`, `x3dh.ts:124-127`.
Fix: after T2.0, an inbound `initPacket` whose identity matches the pin but whose session differs triggers a deterministic tie-break (lower user id wins) and a typed `SESSION_RESET_REQUIRED` otherwise; delete the OPK secret only after the session is persisted. → T2.11
**Added by T2.4 (harness scenario S10, 2026-09-28):** a reinstall leaves the user's **old one-time prekeys on the server**. `POST /keys/identity` and `POST /keys/identity-dh` only `$set` the new key; the bundle route serves the *oldest unused* one-time prekey first; the client's top-up is count based (`prekeyPolicy.ts`, minimum 30) so it uploads nothing while stale keys remain. Result: every new session initiated to a reinstalled user fails on that user with `SESSION_RESET_REQUIRED` until the stale pool drains, and "reset on both sides" does not recover the chat. Fix: an identity upload with a different key purges the user's one-time and signed prekeys (server) and the client re-uploads after re-registering. → T2.13 step 5

### 3.3 P2 — Reliability & operations

- **P2-1 · No token refresh** `[CORE]` — `endpoints.ts:6` declares a route the server lacks; expiry check commented out; 401 only logs. → T1.10
  **Status 2026-09-25:** resolved by T1.10. Access tokens live 15 minutes; refresh tokens (32 random bytes, stored only as SHA-256) rotate on every use inside a per-login family, and presenting a rotated-out token revokes the whole family (reuse detection). `POST /auth/logout` revokes the family; a password change revokes every family and hands the caller a fresh pair. Client: refresh token in the Keychain (device-only), access token in memory only, proactive refresh before expiry and reactive refresh on 401 with a single in-flight request, socket re-auth on reconnect, and a session-lost path that lands on Login. Legacy pre-T1.10 access tokens keep working until they expire. Verified by 9 route tests (rotation, reuse → family revoked, expired, concurrent refresh, logout, change-password) and client unit tests for the JWT and single-flight helpers.
- **P2-2 · Effectively zero tests; client type-check fails** `[CORE]` → T1.0, T2.4
- **P2-3 · Stabilization checklist never run** `[CORE]` → T2.12
- **P2-4 · Presence and push routing in process memory** `[CORE]` → T4.3
- **P2-5 · No build step, no process manager** `[CORE]` → T4.1, T4.2
- **P2-6 · Pagination on a client-supplied timestamp** `[PARITY]` → T3.2 — **fixed 2026-09-28 (undelivered cursor is `seq`; the legacy history route keeps its timestamp cursor until it is removed)**
- **P2-7 · `cors({ origin: true, credentials: true })`** `[PARITY]` → T4.4
- **P2-8 · No structured error taxonomy** `[PARITY]` → T2.3, T4.7
- **P2-9 · Ordering keyed on the client clock** `[PARITY]` *(new)* — any client pins itself to the top of everyone's history. Server-assigned per-conversation sequence. → T3.2 — **fixed 2026-09-28**
- **P2-10 · Presence/typing subscribable by anyone; no privacy toggles** `[PARITY]` *(new)* — relationship check; toggles for read receipts, typing, last-seen; consider dropping "online" broadcast entirely (Signal has none). → T1.7, Phase 7'
- **P2-11 · 69 dependency advisories, 7 critical** `[CORE]` *(new)* → T1.12
  **Status 2026-09-28:** resolved by T1.12. Server: 26 → 8 advisories, all moderate, none high or critical. Client: 43 → 1; the remaining one is `image-size` inside Metro (the bundler, pinned by `@react-native/metro-config` 0.83.1), a build-time-only dependency that never ships in the app — accepted until the next React Native upgrade. Removed unused packages: `crypto-js`, `date-fns`, `uuid`, `@react-native/new-app-screen`, `@bam.tech/react-native-make`, legacy `react-native-vector-icons` and its type shim.
- **P2-12 · Stack traces returned to clients; no error middleware; `NODE_ENV` unset** `[CORE]` *(new)* → T1.9
  **Status 2026-09-11:** error middleware landed with T1.5 (404/400/413/503/500 as `{error, code}`, no stack); `@ts-ignore`s removed in T1.1. Remaining for T1.9: `NODE_ENV=production` in the start script and socket acks that echo `e.message`.
  **Status 2026-09-25:** closed. `npm start` runs with `NODE_ENV=production` (`npm run dev` keeps nodemon); the last socket ack echoing an internal message now returns `INTERNAL`. The `tsc` build to `dist/` remains T4.1.
- **P2-13 · Server can be tricked into synthesising `initPacket`s** `[CORE]` *(new)* — remove `setupSocket.ts:481-495`; the client bootstraps from the stored first message or a dedicated fetch. → T2.13

### 3.4 P3 — Hygiene

Dead code (`dhRatchet.ts` header block, ~200 lines in `setupSocket.ts`, `ChatReset.tsx` with hardcoded ObjectIDs and `AsyncStorage.clear()`, `Navigation.tsx:14-32`, `MainTabsScreen.tsx` experiments, v1 crypto files, empty `crypto/index.ts`); `@ts-ignore` on both `jwt.sign` calls; `normalizeB64` ×4 applied to ciphertext; hand-rolled `utf8.ts` with a silent fallback; `babel.config.js` malformed and dotenv unregistered; `tsconfig.json:12` artifact; empty `NSLocationWhenInUseUsageDescription`; keyboard logging on every event; `enableProguardInReleaseBuilds=false`; unused deps (`crypto-js`, `date-fns`, `uuid`, `@react-native/new-app-screen`, legacy `react-native-vector-icons`); server logs ciphertext and `initPacket`s; no ciphertext size cap; consumed OPKs and old SPKs never deleted; mixed Russian/English comments; stray root `package.json`; `README.md` false claims; `chat-backend.pem` and `my-release-key.keystore` at repo root (gitignored, one `git add -f` from disaster). → T1.11, T4.11
**Status 2026-09-28:** closed by T1.0 (tsconfig), T1.1 (`@ts-ignore`), T1.2 (babel/dotenv), T1.5 (ciphertext cap), T1.4 (OPK expiry), T1.12 (unused deps), T1.15 (secret scanning), and T1.11 (dead code, logs, stray workspace, secrets out of tree, README). Still open: `utf8.ts` and strict base64 (protocol path → Phase 2), `NSLocationWhenInUseUsageDescription` and Proguard (T1.16 / Phase 12'), SPK cleanup (T2.10), `architecture.md` (T4.11), remaining Russian comments (translate when touched).

---

# PART III — THE PLAN

## 4. PHASE OVERVIEW (26 weeks)

| Weeks | Phase | Tier | Gate |
|---|---|---|---|
| 1–3 | **1' Security perimeter** | `[CORE]` | No P0 open; both platforms connect over TLS; CI with typecheck + gitleaks |
| 4–5 | **2a Protocol package + harness** | `[CORE]` | Red suite pinpointing P1-0, P0-9, P1-1, P1-2, P1-3, P1-4 |
| 6–8 | **2b Protocol correctness** | `[CORE]` | 21/21 scenarios green; 10k property cases; libsignal vectors match; checklist 22/22 |
| 9–11 | **3' Storage, push, hardening** | `[CORE]` | Reinstall keeps local history; server holds no delivered ciphertext; push on both platforms |
| 12–13 | **4' Ops essentials** | `[CORE]` | Deploy/restart/rollback without losing sessions; CI blocks protocol regressions |
| 14–17 | **6' Groups (per-user Sender Keys)** | `[PARITY]` | E2EE group between 3+ devices; rotation on membership change |
| 18–21 | **7'/8' Product completeness + media** | `[PARITY]` | Feature-complete vs §2.2 six-month column |
| 22–23 | **12' Interface** | `[CORE]` | Confirmations, a11y pass, onboarding, offline composing, 60 fps |
| 24–26 | **13' Threat model, dissertation, review** | `[CORE]` | Defensible, demoable, installable |

The v1 thirteen-phase plan (~59 weeks) remains the long-form reference in [archive/PROJECT_ROADMAP.v1.md](archive/PROJECT_ROADMAP.v1.md) §4 for everything deferred in §10.

---

## 5. TARGET ARCHITECTURE

### 5.1 The system at six months

```
CLIENT (React Native)
  PRESENTATION   screens · components · theme      — no crypto, no network, no storage
  STATE          Zustand stores · optimistic updates
  DOMAIN         ChatService · GroupService · MediaService · NotificationService
  PROTOCOL       @velo/protocol (pure TS): X3DH · Double Ratchet · Sender Keys · identity binding
  PERSISTENCE    Keychain (identity, SPK, master keys) · SQLCipher DB (messages, sessions, keys) · MMKV/AsyncStorage (UI prefs)
  TRANSPORT      REST (axios, TLS+pinning) · socket.io (wss) · FCM/APNs data-only
                                   │ ciphertext + minimal metadata
SERVER (Node/Express)
  EDGE           Caddy TLS · express-rate-limit (Redis) · zod validation · error middleware
  API            auth (refresh tokens) · users · keys (bundle issue ledger, identity history) · messages (seq, undelivered) · groups · media (signed URLs)
  REALTIME       socket.io + Redis adapter · presence with relationship checks
  DELIVERY       store → deliver → delete; TTL on undelivered; data-only push fan-out
  DATA           MongoDB (users, keys, undelivered messages, groups) · Redis (presence, limits, token families) · S3-compatible blobs with TTL
  OBSERVE        pino · Prometheus · alerting on decrypt-failure rate and prekey depletion
```

### 5.2 Two rules that matter most

**Protocol functions are pure.** `ratchetEncrypt`/`ratchetDecrypt` return new state and derived keys; the caller persists. Nothing under `packages/protocol/src` imports React Native, AsyncStorage, or Keychain. This is what makes the harness, the libsignal vectors, and the formal model possible.

**Plaintext lives locally, keys do not.** Decrypt once into the encrypted local DB; delete the message key. The server keeps a message only until it is delivered. Forward secrecy at rest follows automatically; history survives because it is stored, not because keys are hoarded.

### 5.3 Data model evolution

| Model | Change | Task |
|---|---|---|
| `User` | `+ identityBindingSignature, identityKeyHistory[], identityChangedAt, deletedAt, lockUntil, privacy{readReceipts, typing, lastSeen}` | T2.13, Phase 7' |
| `Message` | `+ seq (server-assigned per conversation), expiresAt (TTL), delete-after-delivery; v2.header → v3 envelope` | T3.1, T3.2 |
| `RefreshToken` | new: `userId, family, tokenHash, expiresAt, revokedAt, replacedBy` | T1.10 |
| `PreKeyBundleIssue` | new: `requesterId, targetId, oneTimePreKeyId, issuedBundle, expiresAt` | T1.4 |
| `Group`, `GroupMember`, `SenderKeyDistribution` | new | Phase 6' |
| `Attachment` | new: `blobId, size, ttl` (key travels inside the E2EE message) | Phase 8' |
| `Device` | **deferred** (multi-device) | §10 |

### 5.4 Repository structure

```
velo/
├── packages/
│   ├── protocol/      pure crypto, zero RN deps, its own test suite + libsignal vectors
│   ├── client/        React Native app (today chats-client)
│   └── server/        Express API (today chats-server)
├── docs/              this folder
└── tools/             test vectors, fuzzers, benchmarks
```

Extraction happens in T2.1. Secrets (`*.pem`, `*.keystore`, service-account JSON) live **outside** the tree; `.env.example` documents where.

---

## 6. PHASES 1'–4' — FOUNDATION

### PHASE 1' — Security perimeter · weeks 1–3 · `[CORE]`

| Task | Fixes | Est. |
|---|---|---|
| T1.0 Client type-check green; login/register try-finally + visible errors; one password rule | P0-11, P2-12 | 0.5d |
| T1.1 Secrets: rotate, hard-fail on missing env, commit sanitized `config.ts`, `.env.example` | P0-1 | 0.5d |
| T1.2 TLS + domain; env-driven URLs (register dotenv in Babel); cleartext off on Android | P0-2 | 2d |
| T1.3 Encrypt session state, OPK secrets, pending queue; authenticate trust pins | P0-3 | 1.5d |
| T1.4 Bundle issue cache + limits + refill signal | P0-4 | 2d |
| T1.5 Rate limiting infra (Redis) | P0-5 | 1.5d |
| T1.6 Search fix; email removed from all responses; UI shows usernames | P0-6 | 1d |
| T1.7 Socket authorization incl. presence/typing relationship check | P0-7, P2-10 | 1d |
| T1.8 Password policy + zod validation module | P0-8 | 1d |
| T1.9 Error middleware, `NODE_ENV`, no stack traces, remove `@ts-ignore` | P2-12, P3 | 0.5d |
| T1.10 Refresh tokens with rotation + reuse detection; client 401 handling | P2-1 | 1.5d |
| T1.11 Repository hygiene, dead code, README truth — **done 2026-09-28**: dead blocks in `setupSocket.ts`/`dhRatchet.ts`, dead v1 crypto files, `ChatReset`, hardcoded-id wipe helper, commented experiments and keyboard logging removed; `normalizeB64` single-sourced (behaviour unchanged until the Phase 2 harness, per R1); per-message server logs that printed init packets removed; stray root workspace deleted; `.pem`, keystore and Firebase service account moved to a sibling folder outside the tree; README rewritten. Left for Phase 2: `utf8.ts` replacement (protocol path) and the stricter base64 | P3 | 1d |
| T1.12 Dependency remediation (`npm audit fix`, drop unused deps) | P2-11 | 0.5d |
| T1.13 Keystore rotation; credentials out of `gradle.properties`; history purge | P0-10 | 0.5d + human |
| T1.14 Logout wipes everything per user | P0-12 | 0.5d |
| T1.15 `.gitattributes`; docs tracked (done 2026-09-07); secret-scan pre-commit — **done 2026-09-28**: LF normalisation, dependency-free `tools/secret-scan.js` refusing connection strings, private keys, signing passwords, API keys and forbidden file types; wired via `.githooks/pre-commit` (each clone runs `git config core.hooksPath .githooks` once); CI runs `--all` in T4.7 | P3 | 0.5d |
| T1.16 iOS builds and connects: ATS via TLS, Firebase config, `FirebaseApp.configure()`, empty usage strings removed | P0-2 | 1d |

**Exit:** `/security-review` and `npm audit --audit-level=high` clean; both platforms connect over `https`/`wss`; login failure shows an error; logout leaves no user data. Write the remediation up — it is a thesis chapter.

### PHASE 2 — Protocol package, harness, correctness · weeks 4–8 · `[CORE]`

**2a (weeks 4–5).** T2.1 extract `packages/protocol` (pure mechanical move); T2.2 purify encrypt/decrypt; T2.3 typed error taxonomy; T2.4 harness (`MemoryStore`, `VirtualClient`, adversarial `Network`) with scenarios S01–S21; T2.15 libsignal known-answer vectors. **Nine scenarios must fail** before any fix — that is the proof the harness works.

**T2.1 — done 2026-09-28.** `packages/protocol` (`@velo/protocol`) holds `primitives/{base64,encoding,utf8,kdf}`, `ratchet/{chain,root,dh,session}`, `handshake/{bundle,types}`, `identity/fingerprint`, `types/session` — all `git mv`, zero behaviour change, chain/root/session KDF outputs frozen as vectors (R8). `createSessionFromX3DH` split: pure builder in the package, persistence wrapper in the client. Consumed as TypeScript source without npm workspaces: `tsconfig` `paths`, Metro `extraNodeModules` + a `resolveRequest` that pins the package's shared deps (`tweetnacl`, `tweetnacl-util`, `@noble/hashes`, `@babel/runtime`) to the app's copies (bundle source map shows one tweetnacl), Jest `moduleNameMapper`. Purity enforced twice: package `.eslintrc.js` `no-restricted-imports` and a vitest test that also forbids `await`. Still in the client after T2.1: `messageV2.ts`, `x3dh.ts`, `prekeyBundle.ts`, `sessionBootstrap.ts`, key stores.

**T2.2 — done 2026-09-28.** `ratchet/message.ts` in the package: `ratchetEncrypt(session, plaintext)` and `ratchetDecrypt(session, envelope)` are synchronous, never mutate the input, and return the next session, the derived message keys and (on decrypt) the consumed skipped-key id. The only client touchpoint is `chat/ratchetAdapter.ts`, which runs the pure step and persists keys first, then the session, or nothing at all on throw (R7). `crypto/messageV2.ts` deleted. Behaviour pinned with frozen vectors; one deliberate change: message keys derived during a decrypt that then fails authentication are no longer archived (they were written before `secretbox.open` ran). The `ad` argument arrives with the AEAD in T2.5.

**3' progress — T3.1 done 2026-09-28** (two commits): the server deletes ciphertext on the recipient's delivered ack and keeps a metadata-only receipt with a 30-day TTL; the client syncs from `GET /messages/undelivered`, acks only after decrypting and storing, and applies receipts to its stored copies; S26 in the harness. T2.12 (manual checklist) remains the human gate before Phase 3' formally opens; T3.1 was built ahead of it because it closes P1-10. Next in order: T3.2.

**3' progress — T3.2 done 2026-09-28** (two commits): the server hands out a per-conversation sequence number atomically on send; ordering, the undelivered cursor and the client's chat list use it; the sender's clock is display only. S27 in the harness. Next in order: T3.3 (push done right).

**3' progress — T3.3 done for Android 2026-09-28** (two commits): the push is a data-only wake-up; the device fetches, decrypts, stores, acks and renders with the local contact name; taps open the chat from any app state; the preview toggle is honest. A live message for a chat that is not open now goes through the same ingest path, so delivery ticks no longer wait for the chat to be opened. iOS stays parked. Next in order: T3.4 (zeroization, replay window, mutation audit).

**3' progress — T3.4 done 2026-09-28** (three commits): explicit bounded replay window with `REPLAY_DETECTED` and `UNKNOWN_OLD_MESSAGE` meaning what they say; every derived key wiped and no key material leaving a ratchet step; a frozen-input mutation audit over every refusal class plus S28 end to end. Next in order: T3.5 (PQ-readiness).

**3' progress — T3.5 done 2026-09-28** (one commit): the X3DH IKM builder takes an optional trailing KEM shared secret (PQXDH's exact shape), the bundle and init-packet schemas carry the PQ slots as `null`/absent, no wire bump. PQXDH proper stays a post-defense item (month 7). Next in order: T3.6 (header encryption) **only if weeks 9–11 are on schedule**; otherwise Phase 4'.

**3' progress — T3.6 done 2026-09-28** (four commits, wire v4): header keys from the root KDF and X3DH, headers sealed on the wire, trial decryption on receipt, the server blind to counters and ratchet keys; the pre-T2.14 archive migration and the legacy history route retired with the bump. **Phase 3' is complete.** Next: Phase 4' (ops essentials), starting with T4.1.

**4' progress — T4.1 done 2026-09-28** (one commit): the production process runs the compiled `dist/` build; nodemon and the TypeScript loaders are development-only; a manifest test keeps it that way. Next in order: T4.2 (process manager, graceful shutdown, restart on crash).

**2b progress — T2.14 done 2026-09-28** (one commit, D7 = A): plaintext stored locally in sealed records, message keys never archived, history read from the device with the server asked only for newer messages, one-time migration of the old archive. **The known-red registry is empty: every scenario the harness owns is green.** Remaining in Phase 2: T2.12 (manual two-device checklist, owner).

**2b progress — T2.11 done 2026-09-28** (two commits): bootstrap persists only after the first message decrypts, bootstrap replay refused, glare converges on the lower user id without losing messages, a peer's local reset is adopted automatically. Next in order: T2.14.

**2b progress — T2.10 done 2026-09-28** (two commits): signed prekeys rotate after 7 days with 30-day retention and a signature bound to the key id; server keeps the newest five. Next in order: T2.11.

**2b progress — T2.9 done 2026-09-28** (one commit, both sides): Signal's X3DH with the fourth DH; every libsignal vector is green. Next in order: T2.10.

**2b progress — T2.6 done 2026-09-28** (two commits: per-step gap and counter bounds → epoch-aware retention with pruning and `UNKNOWN_OLD_MESSAGE`). S12 green in under 50 ms. Known-red: S16 only (key archive, T2.14). Next in order: T2.9.

**2b progress — T2.5 done 2026-09-28** (two commits; D3 = C: no new library, Signal's encrypt-then-MAC from `tweetnacl` + `@noble/hashes`). Wire v3 is now live end to end: identities and the canonical header are in the MAC, the nonce is derived, S13/S14 green, message-key vector green. Known-red: S12, S16. Next in order: T2.6.

**2b progress — T2.13 done 2026-09-28** (five commits: binding + fingerprint primitives → server identity change handling and prekey purge → initPacket synthesis removed → pin enforcement on both sides → identity-changed state and UI). S20, S21 and S10 green; libsignal fingerprint vector green; a reinstalled peer is blocked with the security-warning banner until the user verifies or accepts. Next in order: T2.5.

**2b progress — T2.0 done 2026-09-28** (four commits: standard bootstrap → keep skipped keys (T2.7 core) → drain to `pn` (T2.8 core) → `WhisperRatchet`). The ratchet ratchets: S19 and S05 green, one-ratchet-step-per-direction-change property over 1000 random conversation segments, libsignal root-KDF vector green. Pre-T2.0 device sessions are discarded on load and re-bootstrap on the next message. The `protoVersion` bump to 3 lands with T2.5. Next in order: T2.13.

**T2.15 — done 2026-09-28.** `@signalapp/libsignal-client` 0.103.0 installed as a **devDependency of `packages/protocol` only** (AGPL-3.0; nothing from it is linked into the app). `test/vectors/generate.ts` (run with `npm run vectors:generate`) writes `test/vectors/libsignal.json`, committed with the libsignal version. Straight from libsignal: X25519 agreements, HKDF-SHA256 with the labels `WhisperText` / `WhisperRatchet` / `WhisperMessageKeys`, and the numeric safety number (`Fingerprint`, 5200 iterations, version 0, display string and scannable bytes). Composed over those primitives exactly as libsignal's `ratchet.rs` / `ratchet/keys.rs` do: X3DH with and without a one-time prekey (`0xFF×32 || DH1..DH4`, `WhisperText`), a scripted `KDF_RK` sequence (`WhisperRatchet`) and three `KDF_CK` steps with the 80-byte `WhisperMessageKeys` expansion. Assertions: X25519, HKDF and the 0x01/0x02 chain KDF **already match** (Velo's chain KDF is Signal's); X3DH (T2.9), `KDF_RK` (T2.0), message-key expansion (T2.5) and safety number (T2.13) are `it.fails` until those tasks adopt the constants. A regeneration test proves the committed file is what the installed libsignal produces. Limitation recorded in the file: libsignal's Node API builds PQXDH sessions only (Kyber prekey mandatory), so no classical end-to-end session vector can come from libsignal itself; the interop stretch (§10.3) would need PQXDH support first.

**T2.4 — done 2026-09-28.** `packages/protocol/test/harness/` (`MemoryStore`, `FakeServer` mirroring the bundle route, one-time-prekey consumption and the server's first-initPacket synthesis with a malicious mode, `VirtualClient` modelling the client's orchestration over the pure package, `Network` with hold/release/reorder/duplicate/drop/tamper/partition); 21 scenarios in `test/scenarios/`, one file each, plus a known-red registry and a 300-run interleaving property test. Pure X3DH (`handshake/x3dh.ts`) moved into the package so the harness runs under plain Node; the client keeps I/O wrappers. **Nine scenarios are red against the current code** (written as `it.fails` so the suite stays green and flips loudly when a fix lands): S05, S12, S13, S14, S19, S20, S21 as predicted, plus two findings the harness added — S16 (message-key archive unbounded, P1-10) and S10 (stale one-time prekeys after reinstall, P1-11). Suite 17 s; ratchet coverage 98–100 % per file.

**T2.3 — done 2026-09-28.** `packages/protocol/src/errors.ts`: `ProtocolError` with the fourteen spec codes and scalar-only `context` (R3, enforced by a test that scans every throw site and one that checks a real error's context against the keys involved). No bare `throw new Error` remains in the package (tested). Client `chat/protocolErrors.ts` holds the §8.3 table (`presentProtocolError`, `requiresSessionReset`) and the single `classifyPendingMessageError`; the socket path throws `NO_SESSION` / `MISSING_BOOTSTRAP` / `SESSION_RESET_REQUIRED` / `SEND_FAILED` and passes the code to `onFailure`. Mapping notes: a missing skipped key for an old counter is `REPLAY_DETECTED` (as libsignal's duplicate-message case; `UNKNOWN_OLD_MESSAGE` becomes distinguishable when T2.6 tracks eviction); a bad signed-prekey signature is `IDENTITY_BINDING_INVALID`; a session missing its DH keys is `STORAGE_CORRUPTION`. `TOO_MANY_SKIPPED` and `HEADER_TAMPERED` have no throw site yet (T2.6, T2.5).

**2b (weeks 6–8), strictly in this order:** T2.0 standard bootstrap → T2.13 identity binding + initiator authentication + safety number → T2.5 AEAD with identity-bound AD (wire v3, one bump) → T2.6 bounded skip → T2.7 keep skipped keys → T2.8 `skipMessageKeys(pn)` → T2.9 fourth DH → T2.10 SPK rotation → T2.11 glare/reinstall handling → T2.14 local encrypted store + delete-after-use (may slide to Phase 3') → T2.12 manual 22/22 checklist.

**Exit:** 21/21 harness scenarios green; property tests over 10,000 interleavings ("every message decrypts exactly once or is explicitly rejected"); X3DH, root KDF, chain KDF, and fingerprint outputs byte-identical to libsignal for committed vectors; `V2_STABILIZATION_CHECKLIST.md` 22/22 with notes; `SESSION_ESTABLISHMENT_POLICY.md` rewritten.

### PHASE 3' — Storage, push, hardening · weeks 9–11 · `[CORE]`

| Task | Detail | Est. |
|---|---|---|
| T3.1 Delete-on-delivery + TTL + `GET /messages/undelivered?after=seq` | Server keeps only undelivered ciphertext (30-day TTL). **Done 2026-09-28** (cursor is `createdAtClient` until T3.2) | 2d |
| T3.2 Server sequence numbers; compound cursor | P2-6, P2-9. **Done 2026-09-28** | 1d |
| T3.3 Push done right | Data-only payload; background handler; notifee render; tap deep-link; iOS APNs; token-prune fix; honest preview toggle. **Done for Android 2026-09-28; iOS parked** | 3d |
| T3.4 Key zeroization + replay window + no-mutation-before-auth audit | `fill(0)`; typed `REPLAY_DETECTED` vs `UNKNOWN_OLD_MESSAGE`. **Done 2026-09-28** (DEVIATION-8: best-effort in JavaScript) | 2d |
| T3.5 PQ-readiness | Handshake IKM accepts a KEM secret without another wire bump. **Done 2026-09-28** | 1d |
| T3.6 Header encryption (P1-8) | **Only if weeks 9–11 are on schedule**; otherwise documented. **Done 2026-09-28** (schedule condition met: T3.1–T3.5 landed on day one of the phase) | 5d |
| T2.14 if slid | Local encrypted DB | 4d |

### PHASE 4' — Ops essentials · weeks 12–13 · `[CORE]`

`tsc` build + pm2/systemd + graceful shutdown (T4.1, T4.2); Redis adapter for socket.io, presence, limits, token families (T4.3); CORS pinned (T4.4); pino with correlation ids and **zero key material** (T4.5); Prometheus: delivery latency, decrypt-failure rate, prekey depletion (T4.6); GitHub Actions: typecheck, lint, protocol tests with coverage gate, gitleaks, Android build (T4.7 — land this as soon as T2.4 exists); error taxonomy in the UI (T4.8); Mongo backup + one rehearsed restore (T4.9); certificate pinning (T4.10); rewrite `architecture.md` (T4.11).

---

## 7. PHASES 6'–8' — CLOSING THE FEATURE GAP

### PHASE 6' — Groups with per-user Sender Keys · weeks 14–17 · `[PARITY]`

Week 1: `Group` model, create/join/leave, roles, system events. Week 2: sender key generation and distribution over pairwise sessions; **per-sender signature key** so members cannot forge each other. Week 3: group send/receive, server fan-out, per-sender chain state in the local DB. Week 4: **rotation on every membership change**, group UI (members, admin actions, system feed, avatar).
Document: Sender Keys give no forward secrecy within an epoch; distribution becomes per-device when multi-device lands (design the distribution record with a `deviceId` field now, always `0`).

### PHASE 7' — Product completeness · weeks 18–19 · `[PARITY]`

Reactions; edit/delete with tombstone protocol messages ("delete for everyone" is a request, say so); forward with provenance; disappearing messages (per-conversation timer; local DB makes it trivial); block/report with a server-side block list; **account deletion** (cascade + key destruction, GDPR Art. 17); privacy toggles (read receipts, typing, last-seen) and the option to remove "online" broadcast; encrypted avatars via a profile key shared over the ratchet; local search over the SQLCipher DB.

### PHASE 8' — Media · weeks 20–21 · `[PARITY]`

Per-attachment random key; encrypt client-side; upload the blob to S3-compatible storage with a signed URL and TTL; key travels inside the E2EE message; encrypted thumbnails; chunked upload with resume; **strip EXIF before encryption**; content-type validation after decryption. Voice notes on the same path with waveform + scrubbing.

---

## 8. PHASE 12' — INTERFACE · weeks 22–23 · `[CORE]`

Confirmation dialogs on every destructive action; accessibility labels and roles on every control, dynamic type at 200%, contrast ≥ 4.5:1 in both themes; onboarding that explains E2EE in one screen; offline composing enabled (the queue already exists); chat list keeps rendering during refresh and fetches once; read vs delivered distinguishable; archive reachable from the row menu; `FlashList` for the message list; i18n scaffold with en/ru/hy and RTL check; haptics vocabulary; profile on a low-end Android; screen lock + `FLAG_SECURE` if time permits. Design tokens and the unified row primitive from `design/UI_INTERFACE_ROADMAP.md` §3.5.

---

## 9. QUALITY ENGINEERING

### 9.1 The pyramid

Unit (primitives, 100%) → property-based (fast-check, 10 properties × 10k cases) → protocol harness (21 scenarios) → **libsignal known-answer vectors** → integration (server routes: happy + every 4xx + authorization bypass) → E2E (Maestro, ~10 flows) → manual two-device checklist per release.

### 9.2 Verification against libsignal (decision D9)

`@signalapp/libsignal-client` (Node bindings, AGPL-3.0) as a **devDependency of `packages/protocol` only**; nothing links into the shipped app, so no licence obligation on Velo.

- **Minimum, Phase 2 (T2.15, ~2 days):** generate X3DH shared secrets, root/chain KDF outputs, and `Fingerprint` values from libsignal for fixed key material; assert Velo produces identical bytes. Requires adopting Signal's constants (`0xFF×32` IKM prefix, HKDF info strings, AD layout) — cheap, and it maps the ProVerif model onto published analyses.
- **Stretch (frontier pick, 1–2 weeks):** a libsignal `VirtualClient` inside the harness so Velo-initiator ↔ libsignal-responder and the reverse exchange real envelopes. The strongest possible thesis and product claim.

### 9.3 Also `[CORE]`
Fuzzing `ratchetDecrypt` with structured-random envelopes (never hangs, never corrupts state, always a typed error); committed test vectors; benchmarks (ratchet ops/s, handshake latency, storage per message) with charts.

---

## 10. DEFERRED BEYOND SIX MONTHS (design sketches, `[DOC]` now)

| Item | Sketch to write now | Earliest |
|---|---|---|
| Multi-device (Sesame) | `Device` model; per-device identity + bundles; encrypt-to-all-devices; QR provisioning over an ephemeral channel; **new device = safety-number change visible to contacts** (ghost-user defence) | month 7 |
| 1:1 calls | `react-native-webrtc`; SDP offer/answer **through the ratchet** so DTLS fingerprints inherit the safety number; coturn; TURN-only privacy mode; CallKit/ConnectionService | month 8 |
| Group calls | 3-day Insertable Streams PoC first; mesh-4 or skip if unavailable; never an SFU without frame E2EE | month 10 |
| Encrypted backup | Argon2id from a PIN; rate-limited restore; honest statement that without an enclave a stolen archive is brute-forceable offline | month 7 |
| PQXDH | ML-KEM-768 via `@noble/post-quantum`; KEM secret concatenated into the IKM (T3.5 extension point) | month 7 |
| Sealed sender | needs header encryption; quantify server knowledge before/after | month 9 |
| Key transparency | signed append-only log + client inclusion proofs | month 10 |
| Desktop | Electron reusing `packages/protocol`; requires multi-device | month 9 |

---

## 11. SCHEDULE & CUT LINES

### 11.1 Six-month calendar (26 weeks)

```
W01–03  ██ Phase 1'  Perimeter
W04–05  ██ Phase 2a  Package + harness + libsignal vectors
W06–08  ███ Phase 2b Protocol correctness (T2.0, T2.13 first)
W09–11  ███ Phase 3'  Storage, push, hardening
W12–13  ██ Phase 4'  Ops + CI
W14–17  ████ Phase 6' Groups
W18–19  ██ Phase 7'  Product completeness
W20–21  ██ Phase 8'  Media
W22–23  ██ Phase 12' Interface
W24–26  ███ Phase 13' Threat model, dissertation, review
```

### 11.2 Non-negotiable regardless of slippage
1. Phase 1' — the perimeter invalidates the premise until closed.
2. T2.0 and T2.13 — a protocol without a DH ratchet or sender authentication cannot be called Signal-class.
3. T2.4 + T2.15 — the harness and reference vectors are what make the claim verifiable.
4. Threat model and honest limitations chapter.

### 11.3 If slipping, cut in this order
ProVerif → header encryption (T3.6) → voice notes → reactions/edit/forward → local search → **groups** (ship an excellent, verified 1:1 messenger rather than a broken group one).

### 11.4 Working method
One branch per task, merged behind the CI gate from week 5. Update §2 matrices and §3 register at every phase gate; the diff is the thesis narrative. Journal weekly. Re-run the checklist at every gate once automated.

---

## 12. RISK REGISTER

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| T2.0 destabilises working 1:1 chat | High | Regression | Harness first; wire v3 behind a flag; keep v2 decrypt-only for one release |
| Identity binding breaks existing sessions | High | All sessions reset once | Acceptable (dev data); announce in-app; single wire bump |
| Local DB (T2.14) larger than estimated | Medium | Slides into Phase 3' | Fallback: 30-day key window (v1 P1-7) for one release |
| libsignal constants force protocol changes | Medium | Extra Phase 2 days | Adopt constants during T2.0 when the wire is already breaking |
| Groups per-user, later per-device rework | Medium | Rework at multi-device | Distribution record carries `deviceId` from day one |
| Insertable Streams unavailable | n/a in 6 mo | — | Documented |
| Solo burnout | High | Abandonment | Demoable milestone at every gate; cut per §11.3, never skip gates |
| Thesis writing deferred | High | Weak dissertation | Ch. 2–4 written during Phase 2; journal from week 1 |
| Public repo leaks a secret again | Medium | Rotation churn | secret-scan pre-commit (T1.15, done) and in CI (T4.7) |

---

## 13. DECISIONS (answered 2026-09-07)

| # | Decision | Answer |
|---|---|---|
| D1 | Time / framing | **6 months; thesis and product equally** |
| D2 | X3DH fourth DH | **Fix** (T2.9) |
| D3 | AEAD | **B — XChaCha20-Poly1305 via `@noble/ciphers`** (needs explicit sign-off per spec §0.3-7 before install) |
| D4 | Repository history | **Not needed for `config.ts`** (never committed). **Needed for `gradle.properties`** (P0-10): fresh repo with a clean initial commit after Phase 1', old one archived privately |
| D5 | Frontier picks | **libsignal verification (T2.15 + interop stretch) and PQ-readiness.** Sealed sender and KT documented only |
| D6 | Multi-device vs groups | **Groups first, per-user Sender Keys**, distribution record carries `deviceId` |
| D7 | Storage engine | **A: sealed AsyncStorage records, no native database (owner, 2026-09-28)**; SQLite + SQLCipher deferred to Phase 7' when search and media need queries |
| D8 | Group-call strategy | n/a in six months |
| D9 | Protocol core | **Keep from-scratch TypeScript in `packages/protocol`, verified against libsignal**; external review or public bug bounty before public launch |
| D10 | Identity key binding | **Binding signature** (Ed25519 over the X25519 identity key) now, no new dependency; single Curve25519 identity with XEdDSA later if the interop harness is pursued |

---

## 14. THE HONEST SUMMARY

The primitives, KDF chains, prekey plumbing, and a good part of the interface are real work that most people do not finish. But the protocol as shipped is not yet a Double Ratchet, and it does not authenticate the sender of a handshake. Those two facts, not feature breadth, are what a Signal-class reviewer checks first. Both are fixable in about three weeks once the harness exists, and fixing them with the harness catching you is the strongest chapter this thesis can have.

Around the protocol, the perimeter currently negates it: cleartext transport, live secrets as config fallbacks, a keystore password in a public repository, no rate limits, socket handlers that trust the client, and a logout that keeps every key. Three weeks closes all of it.

After that, six months buys a verified 1:1 messenger with groups, media, disappearing messages, working push on both platforms, block/report/account deletion, and an interface with fewer rough edges than the incumbents. It does not buy multi-device or calls; write those down as designed-not-built. The reason to switch is already true and should be said out loud: no phone number, no contact upload, no presence broadcast, and a protocol you can verify against the reference implementation.

*Living document. Update §2 and §3 at every phase gate. Evidence lives in [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md); execution detail in [AGENT_EXECUTION_SPEC.md](AGENT_EXECUTION_SPEC.md).*
