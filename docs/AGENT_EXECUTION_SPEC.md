# VELO — AI AGENT EXECUTION SPECIFICATION v2

**Companion to [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md).** The roadmap says *what* and *why*; this document says *how*, in enough detail to execute without further design decisions. Evidence for every defect: [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md).

**Audience:** an autonomous or semi-autonomous coding agent.
**Spec version:** 2.0 · **Written against commit:** `c9c9267` (Open Beta 0.1) · **Verified:** 2026-09-07 · Supersedes [archive/AGENT_EXECUTION_SPEC.v1.md](archive/AGENT_EXECUTION_SPEC.v1.md).

Paths in this document are relative to the repository root unless they start with `docs/`.

---

# 0. PRIME DIRECTIVES

## 0.1 Your role

You are implementing a production-grade end-to-end encrypted messenger. The primitives and KDF chains already exist and are correct. The protocol built on them is **not yet a Double Ratchet** (the DH step never fires) and **does not authenticate the initiator**. Your job is to make the protocol correct with a harness proving it, close the security perimeter, and then extend — without regressing the parts that work.

This is security-critical code. A subtle bug here does not produce a crash; it produces silent confidentiality loss that nobody notices for months. Work accordingly.

## 0.2 Hard rules — violating any of these is a failed task

| # | Rule |
|---|---|
| **R1** | **Never modify protocol code without a failing test first.** Write the test, watch it fail, then fix. Applies to everything under `packages/protocol`, `storage/`, and the ratchet. |
| **R2** | **Never change two protocol behaviours in one commit.** One defect per commit. Bisectability is the only debugging tool that works on this class of bug. |
| **R3** | **Never log key material.** Not truncated, not hashed, not "just for debugging". Public keys may be logged truncated. Private keys, chain keys, root keys, message keys, session master keys: never. |
| **R4** | **Never use `JSON.stringify` for anything that gets hashed, signed, or authenticated.** Use explicit length-prefixed byte serialization. |
| **R5** | **Never compare secrets with `===`.** Use `nacl.verify` (constant-time). |
| **R6** | **Never add `@ts-ignore`, `@ts-expect-error`, or `any` in `packages/protocol`.** |
| **R7** | **Never persist session state before decryption succeeds.** Mutation follows authentication. |
| **R8** | **Any change to the wire format requires a version bump** and an entry in §8.2. |
| **R9** | **Never weaken a security control to make a test pass.** |
| **R10** | **Never commit secrets.** Before every commit, verify no `.env`, `.pem`, `.keystore`, service-account JSON, connection string, password, or token is staged. The repository is **public**. |
| **R11** | **Do not "clean up" code you were not asked to touch.** |
| **R12** | **If an acceptance criterion cannot be met, stop and report.** |
| **R13** | **Never "adopt" a peer ratchet key without performing a ratchet step.** A null `DHr` means "no previous receiving chain to drain", never "skip the ratchet". (This is how P1-0 happened.) |
| **R14** | **Never trust an identity key that arrived in the same message or response it is meant to authenticate.** Identity comes from the pinned trust store or a verified binding; the `initPacket` and the bundle only *claim* it. (This is P0-9.) |

## 0.3 STOP — ask the human, do not decide alone

1. Rotating any production credential (Atlas password, JWT secret, Firebase service account, **Android upload keystore**). You write the code that reads the new value; a human rotates it.
2. Rewriting git history or creating a new repository (D4 — now justified by P0-10, not P0-1).
3. Any deployment or change to a running server.
4. Any change that invalidates existing sessions or stored messages — flag the blast radius and wait. (T2.0, T2.5, T2.13 all do; they ship as one wire bump.)
5. Deleting user data or dropping a collection, even in development.
6. **Adding a dependency that performs cryptography.** Approved set: `tweetnacl`, `tweetnacl-util`, `@noble/hashes`. Pending sign-off: `@noble/ciphers` (D3 = B). Approved **test-only** (devDependency of `packages/protocol`, never linked into the app): `@signalapp/libsignal-client` (AGPL-3.0; the licence does not reach the shipped app because nothing from it is distributed).
7. Any task whose acceptance criteria contradict the security model.

## 0.4 How to know you succeeded

A task is complete when every acceptance criterion is mechanically verified: a command that exits 0, a test that passes, a grep that returns nothing. Report per task using §9.2.

---

# 1. PROJECT MAP

## 1.1 Verified repository layout (2026-09-07)

```
velo_old/
├── docs/                                   this folder (tracked since 2026-09-07)
├── chats-client/                           React Native 0.83.1, TypeScript, RN CLI (not Expo)
│   ├── index.js                            CSPRNG polyfill first, then app. NO FCM handler exists.
│   ├── babel.config.js                     ⚠ worklets entry malformed; react-native-dotenv NOT registered — T1.2
│   ├── tsconfig.json                       ⚠ line 12 stray include — T1.0
│   ├── android/gradle.properties           ⚠ TRACKED, contains release-keystore password — T1.13
│   ├── android/app/google-services.json    tracked (normal); restrict the key in Firebase console
│   ├── ios/client/Info.plist               ATS blocks http → iOS cannot connect until T1.2; no GoogleService-Info.plist — T1.16
│   └── src/
│       ├── app/Navigation.tsx              renders null while isLoading (P0-11)
│       ├── screens/ components/ store/ theme/
│       └── shared/
│           ├── api/ chat/ notifications/ socket/ utils/
│           ├── crypto/                     ← THE PROTOCOL. 22 files. Moves to packages/protocol in T2.1
│           └── storage/                    AsyncStorage + Keychain (sessions in plaintext — T1.3)
└── chats-server/                           Express 5, Mongoose 9, Socket.io 4
    └── src/
        ├── config.ts                       ⚠ gitignored, NEVER committed, has live fallbacks; no .env exists — T1.1
        ├── index.ts middleware/ models/ routes/ push/ utils/
        └── socket/setupSocket.ts           ~200 lines dead code at top; authz holes; initPacket injection
```

Stray root `package.json` + `node_modules` (one unrelated dependency) — remove in T1.11. `chat-backend.pem` and `my-release-key.keystore` sit at the repo root, gitignored — move out of the tree in T1.11.

## 1.2 Files by responsibility

| Concern | Primary files |
|---|---|
| Ratchet | `chats-client/src/shared/crypto/messageV2.ts` · `dhRatchet.ts` · `ratchetChain.ts` · `ratchetRoot.ts` · `storage/sessionStore.ts` (session creation lives here today) |
| Handshake | `crypto/x3dh.ts` · `prekeyBundle.ts` · `prekeyBundleVerify.ts` · `prekeys.ts` · `sessionBootstrap.ts` |
| Identity / trust | `crypto/identityKeys.ts` (Ed25519) · `identityDhKeys.ts` (X25519) · `fingerprint.ts` · `storage/trustedIdentities.ts` |
| Key persistence | `storage/v2MessageKeyStore.ts` · `crypto/historyMasterKey.ts` · `storage/oneTimePreKeys.ts` |
| Send path | `socket/sendAuto.ts` → `socket/messaging.ts` → `chats-server/src/socket/setupSocket.ts` |
| Receive path | `setupSocket.ts` → `socket/socket.ts` → `chat/useChatE2EE.ts` |
| Auth (client) | `store/auth.store.ts` · `api/http.ts` · `screens/LoginScreen.tsx` · `RegisterScreen.tsx` |
| Server security | `config.ts` · `middleware/auth.ts` · `routes/auth.routes.ts` · `routes/keys.routes.ts` · `routes/users.routes.ts` · `socket/setupSocket.ts` |
| Push | `chats-server/src/push/firebase.ts` · `chats-client/src/shared/notifications/*` |

## 1.3 Data flow — memorise these, including the two ⚠ that are not in v1

**Send:** `ChatScreen` → `sendAuto()` → `ensureV2Session()` (X3DH if none; ⚠ never re-bootstraps if a stale session exists — T2.11) → `encryptV2()` (⚠ I/O inside crypto — T2.2; ⚠ always reuses `DHsPublicKey` — T2.0) → `socket.emit('message:send')` → server validates (only `n >= 0`), dedupes, persists, attaches a stored `initPacket` if the message has none (⚠ T2.13), fans out.

**Receive:** `message:new` → `useChatE2EE` → if `initPacket` and no session: `ensureV2SessionFromIncoming()` → `x3dhRespond()` (⚠ identity key taken from the packet, unverified — T2.13) → `decryptV2()` (⚠ `DHr` null → adopt without ratchet — T2.0; ⚠ unbounded skip and key writes before authentication — T2.6, T2.2) → render.

## 1.4 Known-good vs known-broken

| ✅ Correct — leave alone unless a task says otherwise | ❌ Broken — task |
|---|---|
| `chainKdf` HMAC construction (`ratchetChain.ts`) | DH ratchet never fires → **T2.0** |
| `kdfRootKey` HKDF construction (`ratchetRoot.ts`) | Initiator unauthenticated; safety number omits DH key; bundle trust unpinned → **T2.13** |
| Ed25519 SPK signature *math* (`prekeyBundleVerify.ts`) | Header not authenticated → **T2.5** |
| Keychain for long-term keys | Unbounded skip loop → **T2.6** |
| Atomic OPK consumption (`keys.routes.ts:158-162`) | Skipped keys wiped on ratchet → **T2.7** |
| `fromUserId` from socket auth | `header.pn` never read → **T2.8** |
| Message dedupe via unique index + 11000 catch | X3DH missing 4th DH → **T2.9** |
| `makeConversationId` sorted pair | SPK never rotates → **T2.10** |
| Queue-first optimistic send (`useChatE2EE.ts:423-512`) | Glare / reinstall undetected; OPK deleted early → **T2.11** |
| CSPRNG polyfill ordering (`index.js:4`) | No local store; keys kept forever → **T2.14** |
| | Session state plaintext → **T1.3**; login blanks app → **T1.0**; logout keeps keys → **T1.14** |

---

# 2. CONVENTIONS

## 2.1 Language and style
- TypeScript strict; `noUncheckedIndexedAccess: true` in `packages/protocol`.
- English only in new code, comments, and commit messages. Translate existing Russian comments only when already editing that function.
- Named exports only in `packages/protocol`; explicit return types on every export.
- Match surrounding style; do not reformat files you only partially edit.

## 2.2 Cryptographic code rules
- All key material is `Uint8Array` in memory; base64 only at storage and wire boundaries; decode once.
- Length-check every decoded key (X25519/Ed25519 public 32 bytes; Ed25519 secret 64); throw a typed error on mismatch.
- Zeroize with `key.fill(0)` where the lifetime is clear.
- `nacl.randomBytes()` only. Never `Math.random()`.
- Every crypto function has a doc comment: inputs, outputs, security property, and any deviation from the reference specification marked `DEVIATION-n` with an entry in §8.5.
- Adopt Signal's constants wherever the wire is already breaking (T2.0/T2.5): `0xFF×32` prefix on the X3DH IKM, HKDF info strings `"WhisperText"` / `"WhisperRatchet"` / `"WhisperMessageKeys"`, AD layout `IK_A || IK_B`. This is what makes the libsignal vectors (T2.15) comparable.

## 2.3 Branching and commits
```
main                         protected, always green
  └─ phase/1-security
       └─ task/T1.3-encrypt-session-state
```
Commit format with required trailers `Fixes:`, `Wire format:`, `Breaking:`, `Tests:` (see v1 §2.3 for the example).

## 2.4 Testing requirements
| Code | Minimum |
|---|---|
| `packages/protocol/primitives` | 100% line + branch; known-answer tests |
| `packages/protocol/ratchet`, `handshake`, `identity` | 100% branch; every throw path reached; libsignal vectors where applicable |
| Server route / socket handler | happy path + every 4xx + authorization bypass attempt |
| Client service | happy + error path |
| UI component | render + primary interaction |

**A crypto change with no test is not a change. Revert it.**

## 2.5 Documentation you must keep current
| When you… | Update |
|---|---|
| Close a P-number | `docs/PROJECT_ROADMAP.md` §3 and `docs/AUDIT_2026-09-07.md` (mark closed with task id) |
| Complete a phase | roadmap §2 matrices |
| Pass a checklist scenario | `docs/protocol/V2_STABILIZATION_CHECKLIST.md` |
| Change the wire format | §8.2 here + bump `protoVersion` |
| Introduce or remove a deviation | §8.5 |
| Change session lifecycle | `docs/protocol/SESSION_ESTABLISHMENT_POLICY.md` (full rewrite in T2.0/T2.13) |
| Change architecture | `docs/design/architecture.md` (T4.11) |

---

# 3. ENVIRONMENT

## 3.1 Setup
```bash
cd chats-server && npm install && cp .env.example .env   # .env.example exists after T1.1
npm run dev
cd chats-client && npm install && (cd ios && pod install) && npm start
npm run android   # or npm run ios (works after T1.2 + T1.16)
```

## 3.2 Verification commands — baseline on 2026-09-07 in brackets
```bash
cd chats-server && npx tsc --noEmit                      # [clean]
cd chats-client && npx tsc --noEmit                      # [FAILS: NewChatScreen.tsx 624, 659 — T1.0]
cd chats-client && npm run lint
cd packages/protocol && npm test && npm run test:coverage  # [exists after T2.4]

# Secret scan — must return nothing
git grep -nE "(mongodb\+srv://[^\"']*:[^\"'@]+@|BEGIN [A-Z ]*PRIVATE KEY|MYAPP_UPLOAD_(STORE|KEY)_PASSWORD=.+)" -- ':!*.md' ':!package-lock.json'
gitleaks detect --source . --no-banner                    # [after T1.15]
git diff --cached --name-only | grep -Ei "\.(pem|keystore|jks|p12|env)$|firebase-adminsdk"   # must be empty

cd chats-server && npm audit --audit-level=high          # [26 advisories, 2 critical — T1.12]
cd chats-client && npm audit --audit-level=high          # [43 advisories, 5 critical — T1.12]
```

## 3.3 What you cannot do — hand these to the human
Run on a device or simulator; the manual two-device scenarios; rotate credentials or the upload keystore; DNS/TLS; deploy; Xcode/Android Studio GUI; approve decisions or the pending crypto dependencies. Produce a precise **HUMAN ACTION REQUIRED** block when a task needs one.

---

# 4. PHASE 1' — SECURITY PERIMETER

**Goal:** no P0 remains open; both platforms connect over TLS. **Duration:** ~3 weeks. **Branch:** `phase/1-security`.
Independent unless noted; T1.5 unblocks T1.4; T1.1 + T1.5 unblock T1.10; T1.2 unblocks T1.16.

---

## T1.0 — Type-check green; login/register cannot brick the app
**Tier** CORE · **Fixes** P0-11, P2-12 (client tsc) · **Est** 0.5d

1. Fix the two union-narrowing errors in `chats-client/src/screens/NewChatScreen.tsx` (lines 624, 659): narrow on `item.type` before accessing `entry` / `conversation`. Remove the stray include in `tsconfig.json:12`.
2. `store/auth.store.ts` `login` and `register`: wrap the entire body in `try { … } catch (e) { set({ isLoading:false }); throw e } finally { … }` so `isLoading` is always reset; keep `isAuthenticated` false on failure.
3. `LoginScreen.tsx` / `RegisterScreen.tsx`: catch, map to a field-level or banner error, never silent.
4. One shared password rule (`shared/validation/password.ts`, min 10 chars — matches T1.8) used by both screens.

**Acceptance:** `npx tsc --noEmit` clean in the client; a failed login shows an error and the form stays interactive; `grep -n "isLoading: true" src/store/auth.store.ts` shows each occurrence inside a try with a finally.

---

## T1.1 — Secrets: no fallbacks, fail loudly, commit the sanitized config
**Tier** CORE · **Fixes** P0-1 · **Est** 0.5d

Replace `chats-server/src/config.ts` with a `required()`/`optionalNumber()` loader (see v1 T1.1 for the reference implementation): `MONGO_URI` and `JWT_SECRET` required; `JWT_SECRET` length ≥ 32 enforced; `JWT_ACCESS_TTL` default `900s`; `BCRYPT_ROUNDS` default 12; `REDIS_URL`; `FIREBASE_SERVICE_ACCOUNT_PATH` required and **outside the repo tree** by default (`../secrets/…`); `CORS_ORIGINS`; `NODE_ENV`. Create `chats-server/.env.example` with placeholders. **Remove `src/config.ts` from both `.gitignore` files** and add it to git — a clean clone must compile. Keep `.env`, `*.pem`, `*.keystore`, `*firebase-adminsdk*.json`, `secrets/` ignored.

### 🛑 HUMAN ACTION REQUIRED
Rotate the Atlas password and the JWT secret (`openssl rand -base64 48`); place both in `chats-server/.env`. Treat the old values as compromised (they have been on this machine and in two now-redacted documents). Consider the Firebase service account for rotation as well.

**Acceptance:** secret-scan grep empty; server exits non-zero with a clear message when `MONGO_URI` or `JWT_SECRET` is missing or short; `git ls-files chats-server/src/config.ts` lists the file; `.env.example` has no real values.

---

## T1.2 — TLS and environment-driven URLs
**Tier** CORE · **Fixes** P0-2 · **Est** 2d

1. Fix `babel.config.js`: presets unchanged; `plugins: [['module:react-native-dotenv', { moduleName:'@env', path:'.env', safe:true, allowUndefined:false }], ['react-native-worklets/plugin', workletsPluginOptions]]` (worklets last).
2. `chats-client/.env.example` and `.env`: `API_URL=https://…`, `SOCKET_URL=https://…`.
3. `src/shared/config/env.ts` with `requireHttps()` (throws in release builds on non-https) and `env.d.ts` for `@env`.
4. `http.ts` → `baseURL: env.API_URL`; `socket.ts` → `io(env.SOCKET_URL, …)`; delete the hardcoded IP and commented localhost lines.
5. Android: `android:usesCleartextTraffic="false"`, `networkSecurityConfig` permitting cleartext only for `10.0.2.2` in debug.
6. iOS: no ATS exceptions (none exist; leave `NSAllowsArbitraryLoads=false`).

### 🛑 HUMAN ACTION REQUIRED
Point a domain at the server; run Caddy with `reverse_proxy localhost:9999`; verify `curl -I https://<domain>/health` → 200 and `http://` redirects.

**Acceptance:** `git grep -nE "['\"]http://" -- chats-client/src` empty; the old IP appears nowhere outside `docs/`; release build with `API_URL=http://…` throws at startup; WebSocket connects over `wss://`.

---

## T1.3 — Encrypt session state, OPK secrets, pending queue; authenticate trust pins
**Tier** CORE · **Fixes** P0-3 · **Est** 1.5d

1. `crypto/sessionMasterKey.ts`: separate Keychain service `session-mk:<userId>`, `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Also pass this accessibility option to every existing `Keychain.setGenericPassword` call (`identityKeys.ts`, `identityDhKeys.ts`, `prekeys.ts`, `historyMasterKey.ts`) — currently none set it.
2. `storage/sessionStore.ts`: `saveSession` seals `JSON.stringify(session)` (storage only — R4 does not apply) with `secretbox` under the session master key as `{v:1, nonce, ciphertext}`; `loadSession` opens it, returns `null` on failure, and **deletes** legacy plaintext entries rather than migrating them.
3. Same wrapper for `storage/oneTimePreKeys.ts` values and `storage/pendingMessageStore.ts` bodies.
4. `storage/trustedIdentities.ts`: store `{record, mac}` with `mac = HMAC-SHA256(sessionMasterKey, canonical(record))`; reject on mismatch.
5. Fix the stale type: `skippedKeys?: Record<string,string>` (keys are `${dhPub}:${n}`); `ProtoVersion = 2`.

**Acceptance:** raw AsyncStorage for `session:v2:*`, `otpk:*`, `pending_messages_v1:*` contains only `{v,nonce,ciphertext}`; `grep -c rootKey` on any raw value → 0; corrupted blob → `null`, no throw; no caller signature changed; `tsc` clean.

---

## T1.4 — Prekey bundle issue budgets and pool hygiene
**Tier** CORE · **Fixes** P0-4 · **Est** 2d · **Depends** T1.5 · **Status:** done 2026-09-11

> **Design change (2026-09-11).** Spec 2.0 prescribed a 24 h per-(requester, target) bundle *cache*
> so repeat requests would not consume one-time keys. That was wrong: the responder deletes a
> one-time prekey secret the first time it is used (`x3dh.ts` → `deleteOneTimePreKeySecret`), so a
> requester who resets or reinstalls within the cache window would be handed a bundle whose
> one-time key the peer no longer holds, and every handshake would fail until the cache expired.
> Drain protection therefore uses issue *budgets* (what Signal does), never re-served bundles.

### Server
- **Budgets on every fresh issue**, charged before any lookup so probing unknown ids costs too:
  `bundlePairLimiter` 5 issues per (requester, target) per hour and `bundleIssueLimiter` 30 issues
  per requester per hour (`lib/services.ts`, on the KeyValueStore, so Redis-backed in production).
  `bundleLimiter` (express-rate-limit) stays as a coarse 120 requests/h/user cap.
- `GET /keys/bundle/:userId`: 400 `BAD_ID` / `SELF_BUNDLE`; 429 `BUNDLE_PAIR_LIMITED` /
  `BUNDLE_LIMITED` with `Retry-After`; consume atomically as before; `remainingOneTimePreKeys` in
  the response; `console.warn` below 10 remaining, `console.error` at 0.
- `PreKeyBundleIssue` is a **ledger** `{requesterId, targetId, signedPreKeyId, oneTimePreKeyId,
  issuedAt}` with a 30-day TTL — depletion forensics and T2.13 diagnostics, never a cache.
- `POST /keys/prekeys`: per-item validation (`BAD_PREKEY_ITEM`), total unused pool capped at 500
  (`409 PREKEY_POOL_FULL`). Consumed keys expire 30 days after `usedAt` (TTL index).
- `src/app.ts` exports `createApp()` (no listen, no connect) so routes are testable with supertest
  against `mongodb-memory-server`; `index.ts` wires databases, services, sockets.

### Client
- `crypto/prekeyPolicy.ts` (pure): `computeTopUpCount`, `isTopUpCheckDue`, constants
  (min 30, target 100, batch ≤ 200, check interval 5 min).
- `topUpOneTimePreKeysIfNeeded(userId, {force})` in `prekeys.ts`: single in-flight promise,
  throttled unless forced, never throws. Called with `force` at login/hydrate and on every
  `AppState` → `active` (subscription owned by `auth.store.ts`, removed on logout).
- `PreKeyBundleResponse.remainingOneTimePreKeys?` (informational; 0 ⇒ handshake had no one-time key).

### Acceptance (all verified by `test/keys.bundle.test.ts`)
- [x] own bundle → 400; malformed id → 400; target without keys → 404, nothing consumed
- [x] each issue consumes exactly one key and writes one ledger row; a second request issues a **fresh** key
- [x] 6th issue for one pair within an hour → 429 `BUNDLE_PAIR_LIMITED`; 31st distinct target → 429 `BUNDLE_LIMITED`
- [x] 100 sequential requests from one requester consume ≤ 5 keys of one target
- [x] warn at `remaining < 10`, error at 0; an empty pool still issues a bundle with `oneTimePreKey: null`
- [x] upload of malformed items → 400; unused pool > 500 → 409

### Still open (later tasks)
- Silent no-OPK fallback is unchanged on the client (typed handling in T2.x).
- SPK grace-window cleanup belongs to T2.10.

---

## T1.5 — Rate limiting infrastructure
**Tier** CORE · **Fixes** P0-5 · **Est** 1.5d · **Blocks** T1.4, T1.10

`express-rate-limit` + `rate-limit-redis` + `ioredis`; shared `src/redis.ts`; limiters: global 1000/15min/IP, auth 10/15min/IP on `/auth/login` and `/auth/register`, bundle 20/h/user; per-account progressive backoff on failed login keyed on `sha256(email)` (never the raw email); `app.set('trust proxy', 1)`; socket: 60 `message:send`/min/user and a 64 KiB cap on `v2.ciphertext`. Redis down → server boots; auth limiter fails closed, others open.

**Acceptance:** 11th login attempt → 429; increasing delays per account; `X-Forwarded-For` honoured behind Caddy; limits survive restart; oversized ciphertext rejected with a typed ack error.

---

## T1.6 — Fix user search: enumeration and ReDoS
**Tier** CORE · **Fixes** P0-6 · **Est** 1d

`escapeRegex`; `q.length < 3 → {items:[]}`; prefix-anchored on `username` only; `limit ≤ 50`; **no `email` in any response** (also remove `peerEmail` from `conversations.routes.ts`). Client: grep `email` across `screens/` and `store/`; show usernames only.

**Acceptance:** `GET /users?q=` → empty; `q=ab` → empty; `q=(a%2B)%2B%24` returns in <100 ms; no response body from any route contains an email other than the caller's own on `GET /users/me`.

---

## T1.7 — Authorization on every socket handler
**Tier** CORE · **Fixes** P0-7, part of P2-10 · **Est** 1d

- `message:delivered`: load by id, require `String(doc.toUserId) === userId`, never regress `read → delivered`.
- `message:read`: DTO becomes `{ peerUserId }`; `conversationId = makeConversationId(userId, peerUserId)` server-side; notify `peerUserId`.
- `presence:subscribe`, `typing:start/stop`: require an existing conversation between caller and target (or a contact relationship once that exists); otherwise silently ignore and log at `warn`.
- Validate `toUserId` exists and `toUserId !== userId` on `message:send`.
- Document the check performed by every handler in a comment block at the top of `setupSocket.ts`. Client DTOs updated in `messaging.ts` / `useChatE2EE.ts`.

**Acceptance:** delivered/read for someone else's message → `Forbidden`, no mutation; presence subscribe to a stranger → no `presence:update` ever arrives; receipts still work end to end.

---

## T1.8 — Password policy and input validation
**Tier** CORE · **Fixes** P0-8 · **Est** 1d

`src/utils/validation.ts` built on `zod`: `registerSchema`, `loginSchema`, `changePasswordSchema`, key-upload schemas (base64, exact decoded lengths 32/64, arrays ≤ 500 with per-item validation). Password: min 10, `zxcvbn` ≥ 3, HIBP k-anonymity range check (fail open on network error). Usernames stored lowercase with a case-insensitive unique index. Field-level error responses.

**Acceptance:** 9-char password → 400 with field error; `password123` → 400; invalid email → 400; a prekey upload with a 31-byte key → 400; HIBP unreachable → registration succeeds.

---

## T1.9 — Error middleware, environment mode, and the `@ts-ignore`s
**Tier** CORE · **Fixes** P2-12, P3 · **Est** 0.5d

404 handler + error middleware returning `{error, code}` only; `NODE_ENV=production` in the start script; socket acks return codes, never `e.message`; `jwt.sign` typed via `SignOptions`; `jwt.verify` with `algorithms: ['HS256']`; `process.on('unhandledRejection')` logs and exits; SIGTERM graceful shutdown.

**Acceptance:** `GET /keys/bundle/notanid` → 400 JSON with no stack; `grep -rn "@ts-ignore" chats-server/src` empty.

---

## T1.10 — Refresh tokens with rotation and reuse detection
**Tier** CORE · **Fixes** P2-1 · **Est** 1.5d · **Depends** T1.1, T1.5

`RefreshToken {userId, family, tokenHash, expiresAt, revokedAt, replacedBy, userAgent}` (hash only). `POST /auth/refresh`: not found → 401; revoked → **revoke family**, 401, `error` log; valid → new pair, old marked replaced. `POST /auth/logout` revokes the family; `change-password` revokes all families. Client `http.ts`: on 401 refresh once with a single in-flight promise, retry; on failure clear auth and route to Login; delete the commented-out expiry block in `auth.store.ts:223-240` and replace it with a real check. Socket: re-auth on reconnect with the fresh access token.

**Acceptance:** access token 15 min; reuse of a refresh token kills the family; ten concurrent 401s → one refresh call; DB never holds a plaintext refresh token; logout revokes server-side.

---

## T1.11 — Repository hygiene and README truth
**Tier** CORE · **Est** 1d

Delete the stray root `package.json`/`node_modules`; move `chat-backend.pem` and `my-release-key.keystore` out of the tree (document location in `.env.example`); delete dead code (`dhRatchet.ts` header block, `setupSocket.ts` top block, `components/ChatReset.tsx` and its import, `Navigation.tsx:14-32`, `MainTabsScreen.tsx` experiments, `metro.config.js` comments, keyboard logging in `ChatScreen.tsx:688-694`, v1 crypto files `messageCrypto.ts`, `sharedSecret.ts`, `keypair.ts`, `sharedSecretCache.ts`, `protocolPolicy.ts`); one `normalizeB64` in `base64.ts` that **rejects** malformed input instead of repairing it; replace `utf8.ts` with `TextEncoder`/`TextDecoder` (fatal on invalid UTF-8); remove server logging of DTOs and `initPacket`s; fix `README.md` (no email verification, no tests, history is persisted, iOS status); English comments where touched.

**Acceptance:** repo root contains `README.md`, config files, `docs/`, and the workspace directories only; every README claim verifiable; `grep -rn "normalizeB64" chats-client/src | wc -l` → definitions 1.

---

## T1.12 — Dependency remediation
**Tier** CORE · **Fixes** P2-11 · **Est** 0.5d

`npm audit fix` (no `--force`) in both packages; remove `@bam.tech/react-native-make`, `crypto-js`, `date-fns` (unless adopted for i18n later), `uuid`, `@react-native/new-app-screen`, legacy `react-native-vector-icons`; move `nodemon` to devDependencies; add `engines.node >= 20` to the server; re-run the client and server builds.

**Acceptance:** `npm audit --audit-level=high` reports 0 in both; app builds and runs.

---

## T1.13 — Android upload keystore
**Tier** CORE · **Fixes** P0-10 · **Est** 0.5d + human

Remove lines 49–52 from `android/gradle.properties`; read `MYAPP_UPLOAD_*` from `~/.gradle/gradle.properties` or environment in `build.gradle`; add `android/gradle.properties` password keys to gitleaks rules.

### 🛑 HUMAN ACTION REQUIRED
If the app was ever uploaded to Google Play with this key: request an upload-key reset in Play Console (Play App Signing). If not: generate a new keystore and discard the old one. Then decide D4 (history rewrite / fresh repository) — the old password stays in history until you do.

**Acceptance:** `git grep -n "MYAPP_UPLOAD_STORE_PASSWORD=" ` returns nothing; release build signs from an external properties file.

---

## T1.14 — Logout wipes the user's local state
**Tier** CORE · **Fixes** P0-12 · **Est** 0.5d

`logout()` calls `deleteAllSessionsForUser`, removes `v2mk:<uid>:*`, `otpk:<uid>:*`, `trusted-identity:<uid>:*`, `pending_messages_v1:<uid>`, and resets the four Keychain services for that user; `unregisterPushTokenFromServer` always attempts unregistration regardless of the preference flag (fix `sync.ts:30-34`). Add "Log out" and "Reset local secure state" confirmation dialogs (first two `Alert.alert` calls in the app).

**Acceptance:** after logout, `AsyncStorage.getAllKeys()` contains no key with the user's id and `Keychain.getGenericPassword` returns `false` for all four services; the server no longer holds the device's push token.

---

## T1.15 — Line endings, docs, secret scanning
**Tier** CORE · **Est** 0.5d

`.gitattributes` (`* text=auto`, binaries marked); `docs/` already tracked as of 2026-09-07 — verify no secret in `docs/archive/*` (redacted); `gitleaks` pre-commit hook via `lefthook` or `husky`.

**Acceptance:** `gitleaks detect` clean; `git status` shows no line-ending-only diffs.

---

## T1.16 — iOS builds, connects, and receives push
**Tier** CORE · **Fixes** P0-2 (iOS), part of P1-9 · **Est** 1d · **Depends** T1.2

Add `ios/client/GoogleService-Info.plist` (from Firebase console; it is a client config, may be committed), `FirebaseApp.configure()` in `AppDelegate.swift`, `UIBackgroundModes: remote-notification`, APNs key uploaded to Firebase (human), remove the empty `NSLocationWhenInUseUsageDescription`, `pod install`.

**Acceptance:** iOS simulator logs in over TLS and exchanges messages; a real device receives a push (after T3.3 for rendering).

---

# 5. PHASE 2 — PROTOCOL PACKAGE, HARNESS, CORRECTNESS

**Goal:** the protocol is provably a correct, authenticated Double Ratchet. **Duration:** ~5 weeks. **Branch:** `phase/2-protocol`.

> **Execution order is mandatory: T2.1 → T2.2 → T2.3 → T2.4 → T2.15, then T2.0 → T2.13 → T2.5 → T2.6 → T2.7 → T2.8 → T2.9 → T2.10 → T2.11 → T2.14 → T2.12.**
> The two defects that matter most (T2.0, T2.13) are invisible to manual testing because both peers are consistently wrong in the same way. Only the harness and the libsignal vectors can show them. Do not touch the ratchet before T2.4 exists.

---

## T2.1 — Extract `packages/protocol`
**Tier** CORE · **Est** 3d · **Risk** high (large mechanical move)

Target structure and migration map as in v1 T2.1 (`primitives/`, `ratchet/`, `handshake/`, `identity/`, `types/`, `test/{harness,scenarios,properties,vectors}`), with one change: `storage/sessionStore.ts`'s `createSessionFromX3DH` moves to `ratchet/session.ts` as a **pure** function (the persistence wrapper stays in the client). Zero behaviour change. `git mv`. ESLint `no-restricted-imports` bans `react-native`, `@react-native-*`, `AsyncStorage`, `Keychain` under `packages/protocol/src`.

**Acceptance:** `tsc --noEmit` clean in the package; `grep -rE "react-native|AsyncStorage|Keychain" packages/protocol/src` empty; the client builds and runs unchanged; renames, not delete+add.

---

## T2.2 — Purify the ratchet
**Tier** CORE · **Est** 3d · **Depends** T2.1

`ratchetEncrypt(session, plaintext, ad) → {session, envelope, derivedKeys}` and `ratchetDecrypt(session, envelope, ad) → {session, plaintext, derivedKeys, consumedSkippedKeyId}`: synchronous, no I/O, never mutate the input. Client adapter `chat/ratchetAdapter.ts` persists **only after** the pure step succeeds (keys first, then session); on throw persist nothing (R7).

**Acceptance:** no `await` in either function; `grep -rE "AsyncStorage|Keychain|putV2MessageKey|saveSession" packages/protocol/src` empty; a failed decrypt leaves the input session deep-equal to before; manual smoke passes.

---

## T2.3 — Typed error taxonomy
**Tier** CORE · **Est** 1d

`ProtocolError` with codes `MISSING_BOOTSTRAP | NO_SESSION | STALE_SESSION | DECRYPT_FAILED | REPLAY_DETECTED | UNKNOWN_OLD_MESSAGE | SEND_FAILED | STORAGE_CORRUPTION | TOO_MANY_SKIPPED | HEADER_TAMPERED | INVALID_KEY_LENGTH | SESSION_RESET_REQUIRED | IDENTITY_MISMATCH | IDENTITY_BINDING_INVALID`. `context` never carries key material (R3). Replace every bare `throw new Error` in the package; the client maps codes to strings (§8.3).

---

## T2.4 — Protocol test harness
**Tier** CORE · **Est** 5d · **Depends** T2.2, T2.3

`MemoryStore`, `VirtualClient` (`register`, `startSession`, `send`, `receive`, `serialize`/`restore`, `sessionState`), `Network` (`deliver`, `hold`, `release`, `reorder`, `duplicate`, `drop`, `tamper`, `partition`, plus a **malicious server** mode that can substitute bundles and `initPacket`s). Scenarios, one file each:

| # | Scenario | Expected before fixes |
|---|---|---|
| S01 | New chat, first message | pass |
| S02 | First reply | pass |
| S03 | 5 messages each direction | pass |
| S04 | Reorder within an epoch | pass |
| S05 | Reorder across a DH ratchet | **fail** (T2.0, T2.7, T2.8) |
| S06 | Restart one side | pass |
| S07 | Restart both sides | pass |
| S08 | Receiver offline for the first message | pass |
| S09 | Delayed history load | pass |
| S10 | Wipe one client, reset, recover | pass |
| S11 | Duplicate delivery | pass |
| S12 | `header.n = 10_000_000` | **hang → must time out at 5 s** (T2.6) |
| S13 | Tampered `dhPub` | **fail** (T2.5) |
| S14 | Tampered `n` / `pn` | **fail** (T2.5) |
| S15 | One-time prekeys exhausted | pass |
| S16 | 1000-message conversation, storage bounded | check |
| S17 | Simultaneous send (ratchet race) | verify |
| S18 | Message from an unknown epoch | typed error |
| S19 | **Ratchet actually advances:** after A→B→A→B, each side's `DHsPublicKey` changed ≥ 2× and `rootKey` ≠ X3DH root | **fail** (T2.0) |
| S20 | **Forged `initPacket` identity:** malicious server replaces `initiatorIdentityDhPublicKey` | **fail — accepted today** (T2.13) |
| S21 | **Substituted bundle identity vs pin:** second bundle fetch returns different identity keys | **fail — accepted today** (T2.13) |

**Acceptance:** all 21 implemented; S05, S12, S13, S14, S19, S20, S21 fail with clear diagnostics; suite < 30 s; runs under plain Node; ratchet coverage ≥ 90% before any fix.

---

## T2.15 — libsignal known-answer vectors
**Tier** CORE · **Est** 2d · **Depends** T2.4 · **Dependency** `@signalapp/libsignal-client` devDependency only (§0.3-6)

`test/vectors/generate.ts` uses libsignal to produce, for fixed seeds: X3DH shared secrets (with and without OPK), root/chain KDF outputs for a scripted sequence, and `Fingerprint` display strings. Commit the JSON vectors. Assertions run against Velo after T2.0/T2.5/T2.13 adopt Signal's constants (§2.2). Until then the assertions are `test.failing`.

**Acceptance:** vectors committed with the libsignal version recorded; after T2.9 all vector assertions pass.

---

## T2.0 — Standard Double Ratchet initialisation (the ratchet must ratchet)
**Tier** CORE · **Fixes** P1-0 · **Est** 3d · **Depends** T2.4 · **Risk** high · **Breaks wire format** (v3, shared with T2.5/T2.13)

### Why
`ratchet/session.ts` (ex-`createSessionFromX3DH`) creates both sides with a fresh `DHs` and `DHr = null`, and `ratchetDecrypt` adopts the first inbound `dhPub` without ratcheting. Nothing ever regenerates `DHs`, so `dhRatchet` never runs. See audit §1.3.

### Changes
1. `initInitiatorSession(SK, spkB_pub)` and `initResponderSession(SK, spkB_pair)` exactly as in §8.1. The responder's session **copies** the SPK private key so later SPK rotation cannot break it.
2. Delete the HKDF directional split and the `isInitiator` mirroring.
3. `ratchetDecrypt` step 2 per §8.1: a null `DHr` performs a full `dhRatchet` and skips only the drain of the non-existent old chain (R13).
4. `ratchetEncrypt` is unchanged in shape; `DHs` now rotates because `dhRatchet` runs on every direction change.
5. Adopt Signal's root/chain KDF info strings (§2.2) in the same commit series since the wire is breaking anyway — one commit per constant (R2).
6. `x3dhInitiate` must return `spkB_pub` to the session initialiser; `x3dhRespond` must return the SPK pair.

**Acceptance:** S19 passes; S01–S04, S06–S11 still pass; `grep -n "isInitiator" packages/protocol/src` empty; property test "every direction change performs exactly one ratchet step" over 1000 random conversations; `DEVIATION-1` removed from §8.5.

---

## T2.13 — Identity binding, initiator authentication, safety number
**Tier** CORE · **Fixes** P0-9, P2-13 · **Est** 4d · **Depends** T2.0 · **Breaks handshake** (same v3 bump)

### Changes
1. **Binding signature.** `identity/binding.ts`: `signIdentityBinding(ikSignPriv, ikDhPub) = ed25519.sign("velo-identity-binding-v1" || ikDhPub)`; `verifyIdentityBinding`. Client publishes it via `POST /keys/identity` (extended); server stores `identityBindingSignature`, returns it in the bundle and in new `GET /keys/identity/:userId` `{identitySignPublicKey, identityDhPublicKey, identityBindingSignature, identityChangedAt}`.
2. **Pinned trust enforced.** `identity/trust.ts` (pure): `checkIdentity(pinned, presented) → 'first-contact' | 'match' | 'mismatch'`. `fetchAndVerifyPreKeyBundle` and `x3dhRespond` both: verify the binding, then `checkIdentity` against the pin; `first-contact` → pin both keys; `mismatch` → throw `IDENTITY_MISMATCH`; never proceed on a mismatch. The trust store now pins **both** keys.
3. **Responder authenticates the initiator.** On `initPacket`: fetch (or use pinned) identity for `fromUserId`; require `initPacket.initiatorIdentityDhPublicKey === pinned IK_dh`. The packet no longer needs to carry the identity key at all after this — keep it for the mismatch diagnostic only.
4. **Safety number.** `identity/fingerprint.ts` implements libsignal's numeric fingerprint (version 0, 5200 iterations SHA-512 over `version || IK_sign || IK_dh || stableUserId`, two 30-digit halves ordered by raw bytes). Verified against the T2.15 vectors. `VerifyContactScreen` shows it; a mismatch renders the security-warning class from §8.3 and blocks send until "Verify" or "Accept new identity".
5. **Server:** `identityKeyHistory[]` and `identityChangedAt` on `User`; identity upload with a different key appends history and emits `identity:changed` to every peer with a conversation; **remove the `initPacket` synthesis in `setupSocket.ts:481-495`** — the client bootstraps from the first stored message (history path) or from the live `initPacket`.
6. **AD** for T2.5 becomes `IK_sign_A || IK_sign_B || canonicalHeader` (binding covers the DH keys).
7. Rewrite `docs/protocol/SESSION_ESTABLISHMENT_POLICY.md` for the new states: `unverified-first-contact`, `verified`, `identity-changed-blocked`.

**Acceptance:** S20 and S21 pass with `IDENTITY_MISMATCH`; first contact pins silently; fingerprint KAT matches libsignal; a peer reinstall shows the warning and blocks until accepted; `grep -n "firstWithInitPacket" chats-server/src` empty; §8.5 gains `DEVIATION-5`.

---

## T2.5 — AEAD with identity-bound associated data
**Tier** CORE · **Fixes** P1-1 · **Est** 2d · **Depends** T2.13 · **Requires** D3 sign-off for `@noble/ciphers`

`ratchet/header.ts` `canonicalHeaderBytes(h)`: `u8 version | u32be dhPubLen | dhPub | u32be n | u32be pn` (R4). `primitives/aead.ts`: `xchacha20poly1305(key, nonce, ad)` from `@noble/ciphers`; `ad = IK_A || IK_B || canonicalHeaderBytes(header)`. Message key split per Signal (`WhisperMessageKeys` → 32-byte key + 24-byte nonce input, or random 24-byte nonce — document the choice). If D3 is refused, fall back to v1 Option A (prefix the AD inside `secretbox` and `nacl.verify` it after opening).

**Acceptance:** S13, S14 pass (`HEADER_TAMPERED` / `DECRYPT_FAILED`); a ciphertext re-attributed to a different sender pair fails; `canonicalHeaderBytes` byte-identical over 1000 randomised round-trips; §8.2 updated.

---

## T2.6 — Bound the skipped-key derivation
**Tier** CORE · **Fixes** P1-2 · **Est** 1d

Constants: `MAX_SKIP_PER_STEP = 100`, `MAX_SKIP_TOTAL = 1000`, `MAX_SKIP_EPOCHS = 5`, `MAX_MESSAGE_NUMBER = 2**24`. Throw `TOO_MANY_SKIPPED` before any derivation when `gap > MAX_SKIP_PER_STEP`. Server: `Number.isInteger(n) && 0 <= n < MAX_MESSAGE_NUMBER`, same for `pn`.

**Acceptance:** S12 passes in < 50 ms; gap 99 decrypts; gap 101 throws; server rejects `n = 10_000_000`.

---

## T2.7 — Keep skipped keys across ratchet steps
**Tier** CORE · **Fixes** P1-3 · **Est** 2d · **Depends** T2.0, T2.6

`dhRatchet` no longer clears `skippedKeys`; `pruneSkippedKeys` evicts oldest-epoch-first using an explicit `skippedEpochOrder: string[]` on the session (never JS object order).

**Acceptance:** S05 passes; a message 2 epochs back decrypts; 6 epochs back → `UNKNOWN_OLD_MESSAGE`; stored skipped keys never exceed `MAX_SKIP_TOTAL`; eviction deterministic.

---

## T2.8 — `skipMessageKeys(header.pn)` before the ratchet
**Tier** CORE · **Fixes** P1-4 · **Est** 2d · **Depends** T2.7

Implement §8.1 step 2 exactly. `pn` is read in exactly one place.

**Acceptance:** S05 with messages from both sides of the boundary; S17 passes; S01 still passes; property test over 10,000 interleavings of 20 messages: each decrypts exactly once or is explicitly rejected.

---

## T2.9 — Fourth DH and Signal's X3DH constants
**Tier** CORE · **Fixes** P1-5 · **Est** 1d · **Decision** D2 = fix

`DH1 = DH(IK_A, SPK_B)`, `DH2 = DH(EK_A, IK_B)`, `DH3 = DH(EK_A, SPK_B)`, `DH4 = DH(EK_A, OPK_B)`; IKM = `0xFF×32 || DH1 || DH2 || DH3 [|| DH4]`; HKDF info `"WhisperText"`. Both sides in one commit.

**Acceptance:** initiator and responder derive identical SK with and without OPK; T2.15 X3DH vectors pass; S01, S02, S08, S15 pass.

---

## T2.10 — Signed prekey rotation
**Tier** CORE · **Fixes** P1-6 · **Est** 2d

`createdAt` stored with the SPK; rotate after 7 days; retain previous SPKs for 30 days keyed by `signedPreKeyId` (`getSignedPreKeySecretForKeyId`); server keeps the last N; SPK signature covers `keyId || publicKey` with a domain tag (wire v3 change, document in §8.2).

**Acceptance:** rotation on next `ensurePreKeysForUser` after 7 days; a handshake against a 20-day-old SPK completes; 31-day-old → typed error; existing sessions unaffected (they copied the SPK pair in T2.0).

---

## T2.11 — Glare, peer reinstall, and OPK lifecycle
**Tier** CORE · **Fixes** P1-11 · **Est** 2d · **Depends** T2.13

- Inbound `initPacket` while a session exists and the identity **matches** the pin: if the local session has never decrypted anything from the peer, both sides tie-break deterministically (the lower user id's session wins; the other side re-bootstraps from the peer's packet). Otherwise surface `SESSION_RESET_REQUIRED` with the Reset affordance.
- Delete the OPK secret only after the responder session is persisted; delete OPK secrets referenced by ignored packets.

**Acceptance:** S10 and S17 pass without manual reset; no OPK secret remains for a consumed key id after the session is persisted.

---

## T2.14 — Local encrypted message store; delete keys after use
**Tier** CORE · **Fixes** P1-10 (with T3.1) · **Est** 4d · **Decision** D7 · **May slide to Phase 3'**

`@op-engineering/op-sqlite` with SQLCipher enabled; DB key generated once, stored in Keychain (`db-mk:<userId>`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); tables `messages(id, conversationId, seq, direction, body, createdAt, status, replyTo, expiresAt)`, `sessions(peerUserId, blob)`, `skipped_keys` (bounded). Receive path: decrypt → insert → **do not store the message key**. Remove `v2MessageKeyStore.ts` and `historyMasterKey.ts` from the live path (keep a one-time migration that decrypts existing server history with the archived keys into the DB, then deletes the archive). `useChatE2EE` reads history from the DB and asks the server only for `undelivered` (T3.1). "Reset secure session" no longer touches history.

**Acceptance:** after a message is decrypted, no `v2mk:*` key exists for it; kill + relaunch shows history without any server call; `stored_keys_only` mode removed; S16 shows bounded storage.

---

## T2.12 — Run the full stabilization checklist 🛑 human with two devices
**Tier** CORE · **Est** 2d · **Depends** all of Phase 2

22/22 boxes in `docs/protocol/V2_STABILIZATION_CHECKLIST.md` with evidence; §12 Working Notes filled; roadmap §3.2 shows every P1 resolved.

---

# 6. PHASE 3' — STORAGE, PUSH, HARDENING (~3 weeks)

| Task | Objective | Est | Notes |
|---|---|---|---|
| **T3.1** | Delete-on-delivery, TTL, undelivered endpoint | 2d | Server deletes a message after the recipient's `message:delivered` ack; TTL index 30 days on undelivered; `GET /messages/undelivered?after=<seq>`; history endpoint kept only for the T2.14 migration window then removed. |
| **T3.2** | Server sequence numbers | 1d | `seq` assigned atomically per conversation (`findOneAndUpdate $inc`); ordering and cursors use `(seq)`; `createdAtClient` display-only. Fixes P2-6, P2-9. |
| **T3.3** | Push done right | 3d | Server: data-only `{type:'msg', serverMessageId}` — no username, no conversation id; prune only on `registration-token-not-registered` / `invalid-argument`. Client: `setBackgroundMessageHandler` + `onMessage` fetch the undelivered message, decrypt via the adapter, insert into the DB, render with notifee using the local contact name; `onNotificationOpenedApp`/`getInitialNotification` deep-link; honest preview toggle (content shown only if the user enables it); iOS APNs. |
| **T3.4** | Zeroization, replay window, mutation audit | 2d | `fill(0)` on every derived key after use; explicit bounded replay window; `REPLAY_DETECTED` distinct from `UNKNOWN_OLD_MESSAGE`; audit that nothing persists before authentication. |
| **T3.5** | PQ-readiness | 1d | X3DH IKM builder accepts an optional KEM shared secret; bundle schema has an optional `pqPreKey` field ignored today. |
| **T3.6** | Header encryption (P1-8) | 5d | `HKs`/`NHKs` from the root KDF; trial-decrypt current and next; wire v4. **Only if weeks 9–11 are on schedule.** |
| T2.14 if slid | Local encrypted DB | 4d | |

**Gate:** reinstall keeps local history; server holds no delivered ciphertext; push renders on both platforms with tap-to-open; all Phase 2 scenarios still green.

---

# 7. PHASE 4' — OPS ESSENTIALS (~2 weeks)

| Task | Objective | Est |
|---|---|---|
| T4.1 | `tsc` build → `dist/`; drop `nodemon` from production | 1d |
| T4.2 | pm2 or systemd; graceful shutdown; restart-on-crash | 1d |
| T4.3 | Redis: socket.io adapter, presence, rate limits, refresh-token families (P2-4) | 3d |
| T4.4 | CORS pinned to known origins (P2-7) | 0.5d |
| T4.5 | `pino` with correlation ids; redaction list; **zero key material** (R3) | 2d |
| T4.6 | Prometheus + Grafana: delivery latency, decrypt-failure rate, prekey depletion, ratchet-step rate | 3d |
| T4.7 | GitHub Actions: typecheck, lint, protocol tests + coverage gate, gitleaks, Android build — **land as soon as T2.4 exists** | 3d |
| T4.8 | Error taxonomy in the UI (P2-8) | 2d |
| T4.9 | Automated Mongo backups + one rehearsed restore | 2d |
| T4.10 | Certificate pinning + rotation procedure | 2d |
| T4.11 | Rewrite `docs/design/architecture.md` to match reality | 1d |

---

# 8. REFERENCE

## 8.1 Normative ratchet algorithm (replaces v1 §8.1)

```
// ───────── Initialisation (T2.0) ─────────
initInitiatorSession(SK, spkB_pub):        initResponderSession(SK, spkB_pair):
  RK  := SK                                   RK  := SK
  DHs := fresh X25519 pair                    DHs := spkB_pair          // copied into the session
  DHr := spkB_pub                             DHr := null
  RK, CKs := KDF_RK(RK, DH(DHs, DHr))         CKs := null
  CKr := null                                 CKr := null
  Ns := Nr := PN := 0                         Ns := Nr := PN := 0
  skippedKeys := {}; skippedEpochOrder := []

// ───────── Encrypt ─────────
ratchetEncrypt(session, plaintext, AD):
  work := clone(session)
  mk, work.CKs := KDF_CK(work.CKs)
  header := { dhPub: work.DHs.pub, pn: work.PN, n: work.Ns }
  work.Ns += 1
  envelope := aeadSeal(mk, nonce, plaintext, AD || canonicalHeader(header))
  return { work, envelope, derivedKeys: [] }          // keys are NOT archived (T2.14)

// ───────── Decrypt ─────────
ratchetDecrypt(session, envelope, AD):
  header := envelope.header
  work   := clone(session)                            // never mutate the input (R7)

  // 1. skipped-key fast path
  id := skippedKeyId(header.dhPub, header.n)
  if work.skippedKeys[id] exists:
      mk := work.skippedKeys[id]
      plaintext := aeadOpen(mk, envelope, AD || canonicalHeader(header))
      if plaintext is null: throw DECRYPT_FAILED       // keep the key
      delete work.skippedKeys[id]
      return { work, plaintext }

  // 2. DH ratchet if the peer key is new — ALWAYS ratchet, never merely adopt (R13)
  if work.DHr == null OR work.DHr != header.dhPub:
      if work.DHr != null:                             // an old receiving chain exists
          work := skipMessageKeys(work, work.DHr, header.pn)     // (T2.8)
      work := dhRatchet(work, header.dhPub)            // (T2.0) — must NOT clear skippedKeys (T2.7)

  // 3. fill the gap on the current receiving chain
  work := skipMessageKeys(work, header.dhPub, header.n)

  // 4. derive the target key
  assert work.Nr == header.n
  mk, nextCK := KDF_CK(work.CKr)

  // 5. authenticate — NOTHING above this line may be persisted
  plaintext := aeadOpen(mk, envelope, AD || canonicalHeader(header))
  if plaintext is null: throw DECRYPT_FAILED

  // 6. commit
  work.CKr := nextCK; work.Nr := header.n + 1
  work := pruneSkippedKeys(work)
  return { work, plaintext }

dhRatchet(work, dhPub):
  work.PN := work.Ns; work.Ns := 0; work.Nr := 0
  work.DHr := dhPub
  work.RK, work.CKr := KDF_RK(work.RK, DH(work.DHs, work.DHr))
  work.DHs := fresh X25519 pair
  work.RK, work.CKs := KDF_RK(work.RK, DH(work.DHs, work.DHr))
  push dhPub onto work.skippedEpochOrder
  return work

skipMessageKeys(work, dhPub, until):
  if work.CKr == null OR until <= work.Nr: return work
  if until - work.Nr > MAX_SKIP_PER_STEP: throw TOO_MANY_SKIPPED   // (T2.6)
  for n from work.Nr to until-1:
      mk, work.CKr := KDF_CK(work.CKr)
      work.skippedKeys[skippedKeyId(dhPub, n)] := mk
  work.Nr := until
  return work
```

`AD = IK_sign_A || IK_sign_B` in initiator-first order, fixed at session creation (T2.13). `KDF_RK` = HKDF-SHA256(salt = RK, ikm = DH, info = "WhisperRatchet", 64 bytes → RK', CK). `KDF_CK` = HMAC-SHA256(CK, 0x01) → MK, HMAC-SHA256(CK, 0x02) → CK'.

## 8.2 Wire format history

| Ver | Status | Envelope | Introduced |
|---|---|---|---|
| 1 | removed | legacy shared-secret | pre-history |
| 2 | **current** | `{header:{n,pn,dhPub}, nonce, ciphertext}` + optional `initPacket`; header unauthenticated; non-standard bootstrap | Open Beta 0.1 |
| 3 | Phase 2 | standard bootstrap (T2.0) + identity-bound AD + XChaCha20-Poly1305 (T2.5) + identity binding in bundles/packets (T2.13) + SPK signature over `keyId || pub` (T2.10). **One bump, one migration: all existing sessions reset.** | T2.0–T2.13 |
| 4 | Phase 3' | header encrypted under `HKs`/`NHKs` (T3.6, conditional) | T3.6 |

Every bump: update this table, the server validator, `Message.ts`, and the client's supported-versions constant.

## 8.3 Error code → user message

| Code | User-facing | Recoverable | Action |
|---|---|---|---|
| `MISSING_BOOTSTRAP` | "Waiting for secure session…" | yes | auto-retry |
| `NO_SESSION` | "Setting up encryption…" | yes | auto |
| `STALE_SESSION` / `SESSION_RESET_REQUIRED` | "Secure session needs to be reset" | yes | Reset (history is kept after T2.14) |
| `DECRYPT_FAILED` | "This message couldn't be decrypted" | no | Reset |
| `REPLAY_DETECTED` | *(silent — drop)* | n/a | log |
| `UNKNOWN_OLD_MESSAGE` | "Older message unavailable" | no | none |
| `TOO_MANY_SKIPPED` | "Too many missed messages" | yes | Reset |
| `SEND_FAILED` | "Not sent — tap to retry" | yes | Retry |
| `STORAGE_CORRUPTION` | "Local data problem" | no | Reset local state |
| `INVALID_KEY_LENGTH` / `IDENTITY_BINDING_INVALID` | "Invalid key data from <name>" | no | Reset |
| **`HEADER_TAMPERED`** | **"Security warning: a message was modified in transit"** | no | prominent warning + verify |
| **`IDENTITY_MISMATCH`** | **"Safety number with <name> has changed"** | manual | verify or accept new identity; sending blocked until then |

The two bold codes are the security-warning class and must look different from technical errors.

## 8.4 Scenario catalog
Canonical list in T2.4. Each scenario file states the checklist row it automates, the defect it covers, and expected state before and after the fix.

## 8.5 Deviation register

| ID | Deviation | Rationale | Status |
|---|---|---|---|
| `DEVIATION-1` | HKDF directional split instead of an initial DH ratchet | — | **Was the P1-0 bug. Removed by T2.0.** |
| `DEVIATION-2` | X3DH omits `DH(EK_A, IK_B)` | — | **Resolved by T2.9 (D2 = fix).** |
| `DEVIATION-3` | Message keys retained 30 days for offline history | superseded by the local store | **Removed by T2.14** (fallback only if T2.14 slips) |
| `DEVIATION-4` | Skipped keys bounded by count *and* epoch | DoS resistance with multi-epoch tolerance | Active after T2.7 |
| `DEVIATION-5` | Two identity keys (Ed25519 signing + X25519 DH) bound by a signature, versus Signal's single Curve25519 identity with XEdDSA | avoids a new signature scheme; binding is verified on every bundle and `initPacket` | Active after T2.13 (D10) |
| `DEVIATION-6` | Random 24-byte AEAD nonce instead of a KDF-derived nonce | XChaCha nonce space makes random nonces safe; simpler | Active after T2.5 — or removed if the Signal derivation is adopted for vector parity |

## 8.6 Glossary
**IK** identity key · **SPK** signed prekey · **OPK** one-time prekey · **EK** ephemeral key · **RK/CK/MK** root/chain/message key · **DHs/DHr** self/remote ratchet keys · **Ns/Nr/PN** counters · **AD** associated data · **binding signature** Ed25519 signature by IK_sign over IK_dh · **pin** the locally stored identity of a peer.

---

# 9. TASK INDEX AND DEPENDENCY GRAPH

```
PHASE 1' ── parallel except:  T1.5 ─► T1.4;  T1.1+T1.5 ─► T1.10;  T1.2 ─► T1.16
  T1.0 T1.1 T1.2 T1.3 T1.5 T1.6 T1.7 T1.8 T1.9 T1.11 T1.12 T1.13 T1.14 T1.15
                                              ▼
PHASE 2 ── strictly sequential through T2.15
  T2.1 ─► T2.2 ─► T2.3 ─► T2.4 ─► T2.15  ★ nothing below may start before this
                                   ├─► T2.0  standard bootstrap      (wire v3)
                                   │     └─► T2.13 identity + safety number
                                   │           └─► T2.5 AEAD + AD
                                   │                 ├─► T2.6 bound skip ─► T2.7 keep skipped ─► T2.8 pn
                                   │                 ├─► T2.9 4th DH + constants
                                   │                 ├─► T2.10 SPK rotation
                                   │                 └─► T2.11 glare/reinstall
                                   └─► T2.14 local store (may slide)
                                         └─► T2.12 manual checklist 🛑 human
                                              ▼
PHASE 3' ── T3.1 … T3.6           (T3.6 conditional; blocks nothing in six months)
PHASE 4' ── T4.1 … T4.11          (T4.7 CI lands early, right after T2.4)
```

## 9.1 Suggested execution order
1. **T1.0, T1.1, T1.2, T1.13** — the app must not brick on login, and the two exposures (live fallbacks, public keystore password) must close.
2. **T1.5 → T1.4, T1.6, T1.7, T1.8, T1.9, T1.12, T1.14** — remaining P0s, mostly parallel.
3. **T1.3, T1.10, T1.11, T1.15, T1.16** — completes Phase 1'.
4. **T2.1 → T2.2 → T2.3 → T2.4 → T2.15** — no shortcuts.
5. **T2.0 → T2.13 → T2.5** — the three that make it a Signal-class protocol; one wire bump.
6. **T2.6 → T2.7 → T2.8, T2.9, T2.10, T2.11, T2.14** — with the harness catching every mistake.
7. **T2.12** — human gate. Phase 3' does not open until 22/22.
8. **T4.7 early** — as soon as T2.4 exists.

## 9.2 Per-task reporting template
```
TASK:        T2.0
STATUS:      complete | blocked | partial
BRANCH:      task/T2.0-standard-bootstrap
COMMITS:     <sha> …
ACCEPTANCE   [x]/[ ] per criterion, with the command and output that proves it
COMMANDS RUN $ cd packages/protocol && npm test   → 21 passed (6.1s)
FILES CHANGED
DEFERRED / BLOCKED   (tracked, never silently dropped)
DOCS UPDATED  docs/PROJECT_ROADMAP.md §3 · docs/AUDIT_2026-09-07.md · §8.2/§8.5 here
```

---

# 10. FINAL NOTES FOR THE IMPLEMENTING AGENT

**The two most important tasks in this document are T2.0 and T2.13**, and the most important constraint is that they come *after* T2.4 and T2.15. Both defects survived months of manual testing because both peers were wrong in the same way, so every message still decrypted. A harness with white-box assertions (S19) and a reference implementation (T2.15) are the only tools that can show a ratchet that does not ratchet or a responder that trusts whatever identity it is handed.

**When something is ambiguous, prefer the interpretation that fails loudly.** This codebase's history is one of silent degradation: `normalizeB64` repairing corrupt input, skipped keys discarded, `@ts-ignore` hiding a type error, a prekey pool draining, a "null means adopt" branch that quietly turned a Double Ratchet into two static chains. Prefer a typed error over a fallback, every time.

**When you find something not in this document, add it** — to `docs/AUDIT_2026-09-07.md` with evidence, to the roadmap §3 with a P-number, to §8.5 if it is a deviation, to T2.4's catalog if it is a scenario.

*Spec version 2.0 · Companion to [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) · Evidence in [AUDIT_2026-09-07.md](AUDIT_2026-09-07.md).*
