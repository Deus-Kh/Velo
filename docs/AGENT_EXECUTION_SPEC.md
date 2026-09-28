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
6. **Adding a dependency that performs cryptography.** Approved set: `tweetnacl`, `tweetnacl-util`, `@noble/hashes`. Pending sign-off: `@noble/ciphers` (D3 = B). Approved **test-only** (devDependency of `packages/protocol`, never linked into the app): `@signalapp/libsignal-client` (AGPL-3.0; the licence does not reach the shipped app because nothing from it is distributed). Installed 2026-09-28 at 0.103.0 (T2.15).
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
│           ├── crypto/                     ← impure remainder after T2.1 (messageV2, x3dh, prekeys, key stores); pure core is in packages/protocol
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
**Tier** CORE · **Fixes** P0-2 (iOS), part of P1-9 · **Est** 1d · **Depends** T1.2 · **Status: DEFERRED by the owner (2026-09-28) — do not touch iOS until told otherwise.** Phase 1' is considered complete for Android with this task parked. When resumed: `FirebaseApp.configure()` in AppDelegate, `use_frameworks! :linkage => :static` + `$RNFirebaseAsStaticFramework = true` in the Podfile, `UIBackgroundModes: remote-notification`, `aps-environment` entitlement, a real bundle identifier (the project still carries the template `org.reactjs.native.example.*`), and the Firebase `GoogleService-Info.plist` from the console.

Add `ios/client/GoogleService-Info.plist` (from Firebase console; it is a client config, may be committed), `FirebaseApp.configure()` in `AppDelegate.swift`, `UIBackgroundModes: remote-notification`, APNs key uploaded to Firebase (human), remove the empty `NSLocationWhenInUseUsageDescription`, `pod install`.

**Acceptance:** iOS simulator logs in over TLS and exchanges messages; a real device receives a push (after T3.3 for rendering).

---

# 5. PHASE 2 — PROTOCOL PACKAGE, HARNESS, CORRECTNESS

**Goal:** the protocol is provably a correct, authenticated Double Ratchet. **Duration:** ~5 weeks. **Branch:** `phase/2-protocol`.

> **Execution order is mandatory: T2.1 → T2.2 → T2.3 → T2.4 → T2.15, then T2.0 → T2.13 → T2.5 → T2.6 → T2.7 → T2.8 → T2.9 → T2.10 → T2.11 → T2.14 → T2.12.**
> The two defects that matter most (T2.0, T2.13) are invisible to manual testing because both peers are consistently wrong in the same way. Only the harness and the libsignal vectors can show them. Do not touch the ratchet before T2.4 exists.

---

## T2.1 — Extract `packages/protocol`
**Tier** CORE · **Est** 3d · **Risk** high (large mechanical move) · **Status:** done 2026-09-28

Target structure and migration map as in v1 T2.1 (`primitives/`, `ratchet/`, `handshake/`, `identity/`, `types/`, `test/{harness,scenarios,properties,vectors}`), with one change: `storage/sessionStore.ts`'s `createSessionFromX3DH` moves to `ratchet/session.ts` as a **pure** function (the persistence wrapper stays in the client). Zero behaviour change. `git mv`. ESLint `no-restricted-imports` bans `react-native`, `@react-native-*`, `AsyncStorage`, `Keychain` under `packages/protocol/src`.

**Acceptance:** `tsc --noEmit` clean in the package; `grep -rE "react-native|AsyncStorage|Keychain" packages/protocol/src` empty; the client builds and runs unchanged; renames, not delete+add.

**Status 2026-09-28:** done. Package `tsc` clean, 21 vitest tests (frozen chain/root/session vectors, `applyDhRatchet` behaviour pinned incl. the P1-3 skipped-key wipe, purity), `eslint` clean; purity grep empty; client `tsc`/ESLint/Jest (56) green; Metro release bundle carries the 11 package modules from source and exactly one `tweetnacl`. Packaging decision (owner): **no npm workspaces** — the package is consumed as TS source via `tsconfig` `paths`, Metro `extraNodeModules` + `resolveRequest` (shared deps pinned to the app's `node_modules`), and Jest `moduleNameMapper`; it has its own `node_modules` only for vitest/eslint/tsc. Deviations: the v1 `test/{harness,scenarios,properties,vectors}` layout is created by T2.4, not here; `applyDhRatchet` and `verifySignedPreKeyBundle` were moved as-is and remain defective (P1-0, P0-9) until T2.0/T2.13. The default `__tests__/App.test.tsx` still fails to load `react-native-gesture-handler` under Jest — pre-existing, unrelated, tracked for T4.7.

---

## T2.2 — Purify the ratchet
**Tier** CORE · **Est** 3d · **Depends** T2.1 · **Status:** done 2026-09-28

`ratchetEncrypt(session, plaintext, ad) → {session, envelope, derivedKeys}` and `ratchetDecrypt(session, envelope, ad) → {session, plaintext, derivedKeys, consumedSkippedKeyId}`: synchronous, no I/O, never mutate the input. Client adapter `chat/ratchetAdapter.ts` persists **only after** the pure step succeeds (keys first, then session); on throw persist nothing (R7).

**Acceptance:** no `await` in either function; `grep -rE "AsyncStorage|Keychain|putV2MessageKey|saveSession" packages/protocol/src` empty; a failed decrypt leaves the input session deep-equal to before; manual smoke passes.

**Status 2026-09-28:** done. `packages/protocol/src/ratchet/message.ts` (`ratchetEncrypt`, `ratchetDecrypt`, `skippedKeyId`, `MAX_SKIP`, wire types `V2Header`/`V2Encrypted`, `DerivedMessageKey`); client adapter `chats-client/src/shared/chat/ratchetAdapter.ts` (`encryptAndPersist`, `decryptAndPersist`); `crypto/messageV2.ts` removed; `socket/messaging.ts` and `chat/useChatE2EE.ts` call the adapter. No `await` in the package; acceptance grep empty; 8 vitest cases including deep-equality of the input after a tampered ciphertext, a tampered skipped-key message, replay, out-of-order delivery, the `MAX_SKIP` bound, and a frozen ciphertext/key/chain vector for a fixed nonce; 4 Jest cases prove the adapter writes keys then session on success and nothing on throw. Deviations: (1) the `ad` parameter is omitted until T2.5 — `secretbox` has no associated data and a dead argument would lie; (2) a `nonce` option exists for vector tests only; (3) the pure step's P1-0 "adopt without ratchet" branch and P1-3 skipped-key wipe are moved verbatim and pinned, per the ordering rule (T2.0/T2.7 change them); (4) behavioural change accepted under R7: keys derived during a decrypt that fails authentication are no longer archived. Manual two-device smoke is owed by the owner on Android (Metro release bundle verified: 12 package modules, one `tweetnacl`).

---

## T2.3 — Typed error taxonomy
**Tier** CORE · **Est** 1d · **Status:** done 2026-09-28

`ProtocolError` with codes `MISSING_BOOTSTRAP | NO_SESSION | STALE_SESSION | DECRYPT_FAILED | REPLAY_DETECTED | UNKNOWN_OLD_MESSAGE | SEND_FAILED | STORAGE_CORRUPTION | TOO_MANY_SKIPPED | HEADER_TAMPERED | INVALID_KEY_LENGTH | SESSION_RESET_REQUIRED | IDENTITY_MISMATCH | IDENTITY_BINDING_INVALID`. `context` never carries key material (R3). Replace every bare `throw new Error` in the package; the client maps codes to strings (§8.3).

**Status 2026-09-28:** done. `src/errors.ts` (`ProtocolError`, `isProtocolError`, `protocolErrorCode`, `PROTOCOL_ERROR_CODES`; `context` typed as scalars only). Throw-site mapping: `secretbox.open` failure and a missing derived key → `DECRYPT_FAILED` `{n, pn}`; old counter with no skipped key → `REPLAY_DETECTED` `{n, nr}` (libsignal's duplicate-message case; `UNKNOWN_OLD_MESSAGE` is reserved until T2.6 tracks eviction); session missing `DHsPublicKey`/`DHsPrivateKey` → `STORAGE_CORRUPTION` `{what}`; wrong X25519/chain-key/nonce length → `INVALID_KEY_LENGTH` `{what, length}`; signed-prekey signature failure → `IDENTITY_BINDING_INVALID` `{what, keyId}`. `TOO_MANY_SKIPPED` (T2.6), `HEADER_TAMPERED` (T2.5), `IDENTITY_MISMATCH` (T2.13), `STALE_SESSION` (T2.11) have no throw site yet. Client: `chat/protocolErrors.ts` implements §8.3 (`presentProtocolError(code, peerName)` with `securityWarning` set only for `HEADER_TAMPERED`/`IDENTITY_MISMATCH`, `REPLAY_DETECTED` silent; `requiresSessionReset`; one `classifyPendingMessageError` replacing the two string-matching copies, with the string heuristics kept only as a fallback for non-protocol errors such as socket failures). `socket/messaging.ts` throws typed `NO_SESSION`, `MISSING_BOOTSTRAP`, `SESSION_RESET_REQUIRED`, `SEND_FAILED`; `onFailure(reason, code)` lets the hook detect a broken session by code. Tests: package 8 new (37 total) incl. "no bare throw in src/", "no key-like identifier in any context", and a runtime check that a real error's context contains none of the keys involved; client 5 new (65 total). Messages are unchanged, so nothing that still matches on text broke; the UI strings from §8.3 are wired in T2.12/Phase 12 when screens render them.

---

## T2.4 — Protocol test harness
**Tier** CORE · **Est** 5d · **Depends** T2.2, T2.3 · **Status:** done 2026-09-28

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

**Status 2026-09-28:** done. Harness in `packages/protocol/test/harness/`: `MemoryStore` (sync stand-in for AsyncStorage+Keychain; `serialize`/`restore` = restart, `clear` = reinstall), `FakeServer` (bundle route with oldest-unused one-time-prekey consumption and empty-pool degradation, `message:send` dedupe by client id and the `firstWithInitPacket` synthesis, history as stored; `malicious` hooks `substituteBundle`, `substituteIdentity`, `substituteInitPacket`, `relabelSender`), `VirtualClient` (`register`, `startSession`, `send`, `receive`, `loadHistory`, `resetSession`, `wipe`, `serialize`/`restore`, `sessionState`, `pinIdentity`/`trustedIdentity`; mirrors sessionBootstrap, messaging, ratchetAdapter, useChatE2EE and the TOFU pin in NewChatScreen), `Network` (`send`, `deliverNow`, `hold`, `release`, `releaseOne`, `reorder`, `duplicate`, `drop`, `discard`, `tamper`, `partition`, `heal`, delivery log). Pure X3DH moved to `src/handshake/x3dh.ts` (frozen vectors with and without a one-time prekey; the client's `crypto/x3dh.ts` is now an I/O wrapper). Scenarios `test/scenarios/S01…S21.*.test.ts`, one file each with checklist row, defect and expected state; `knownRed.test.ts` pins the red set; `test/properties/interleavings.test.ts` (300 seeded runs, gaps kept under `MAX_SKIP`). S12 runs the ratchet in a child Node process (`harness/s12-child.cjs`, TypeScript transpiled on require) killed at 5 s, because a synchronous hang cannot be interrupted in-process. Results against the current code: 61 passing assertions, **9 red scenarios** as `it.fails`: S05, S12, S13, S14, S19, S20, S21 (predicted) + **S16** (message-key archive grows one row per message, P1-10/T2.14) + **S10** (recovery after reinstall fails because the server still serves the pre-reinstall one-time prekeys, P1-11 extended; fix assigned to T2.13 step 5). S14 also shows a message with a modified `pn` is *accepted* (pn unused and unauthenticated). Suite 17 s; ratchet coverage: chain/root/dh/session 100 %, message.ts 98 % lines / 92 % branches; `npm run test:coverage`. S17 passes today only because nothing ratchets; after T2.0 it is the real race test.

---

## T2.15 — libsignal known-answer vectors
**Tier** CORE · **Est** 2d · **Depends** T2.4 · **Dependency** `@signalapp/libsignal-client` devDependency only (§0.3-6) · **Status:** done 2026-09-28 (vectors committed; 4 assertions red by design)

`test/vectors/generate.ts` uses libsignal to produce, for fixed seeds: X3DH shared secrets (with and without OPK), root/chain KDF outputs for a scripted sequence, and `Fingerprint` display strings. Commit the JSON vectors. Assertions run against Velo after T2.0/T2.5/T2.13 adopt Signal's constants (§2.2). Until then the assertions are `test.failing`.

**Acceptance:** vectors committed with the libsignal version recorded; after T2.9 all vector assertions pass.

**Status 2026-09-28:** `@signalapp/libsignal-client@0.103.0` (devDependency of the package; prebuilt binaries for win32/linux/darwin ship in the package, nothing links into the app). `test/vectors/generate.ts` + `run-generate.cjs` (`npm run vectors:generate`, TypeScript loaded through `test/harness/ts-require.cjs`) → `test/vectors/libsignal.json` with `libsignalVersion`, `notes`, and sections `x25519`, `hkdf`, `x3dh` (with/without OPK: inputs, the four DH outputs, IKM, root and chain key), `ratchet` (X3DH root → Alice's initial `KDF_RK` step → Bob's first reply step; three `KDF_CK` steps with seed, next chain key, cipher key, mac key, iv), `fingerprints` (both directions; hash input is the 0x05-prefixed serialized key as libsignal does it). Fixed 32-byte private keys make the file reproducible; `regenerate.test.ts` deep-equals a fresh `buildVectors()` against the committed file. `libsignal.test.ts`: passing today — X25519 agreement, HKDF with Signal labels, chain KDF (Velo's HMAC 0x01/0x02 is Signal's); `it.fails` with diagnostics — X3DH (T2.9: Velo omits `DH(EK_A, IK_B)`, orders DHs differently, no `0xFF` prefix, info `x3dh-v1`), `KDF_RK` (T2.0: info `rk-v1` vs `WhisperRatchet`), message-key expansion (T2.5, if the 80-byte split is adopted; otherwise flip to a documented deviation), safety number (T2.13). Deviations: (1) the generator is TypeScript run through the transpile hook rather than a compiled script; (2) X3DH/ratchet compositions are transcribed from libsignal's Rust (`initialize_alice_session`, `RootKey::create_chain`, `ChainKey::message_keys`) over libsignal's own primitives because the 0.103 Node API only builds PQXDH sessions (Kyber prekey mandatory in `PreKeyBundle.new`) and exposes no Kyber decapsulation, so a classical session's root key cannot be recovered from a real libsignal session for cross-checking; the interop stretch needs PQXDH first; (3) Velo's two-key identity (DEVIATION-5) cannot be fed to libsignal's `Fingerprint`, so the fingerprint vectors pin the construction with one 32-byte key and T2.13 must state how the two keys are combined before hashing. Suite: 32 files, 66 passed, 14 expected-fail, 25 s.

---

## T2.0 — Standard Double Ratchet initialisation (the ratchet must ratchet)
**Tier** CORE · **Fixes** P1-0 · **Est** 3d · **Depends** T2.4 · **Risk** high · **Breaks wire format** (v3, shared with T2.5/T2.13) · **Status:** done 2026-09-28 (with T2.7 and T2.8, four commits)

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

**Status 2026-09-28:** done as four commits, one protocol behaviour each (R2): (1) `initInitiatorSession` / `initResponderSession` in `ratchet/session.ts` exactly as §8.1; `ratchetDecrypt` performs a full `dhRatchet` whenever the peer key is new or `DHr` is null (R13); HKDF directional split and `isInitiator` deleted; session format `v: 2`, a stored `v: 1` session is discarded on load and the pair re-bootstraps; `x3dhInitiate` returns `SPK_B`, the client's `x3dhRespond` returns its SPK pair; client wrappers `createInitiatorSession` / `createResponderSession`. (2) **T2.7 core:** `dhRatchet` keeps the skipped-key map. (3) **T2.8 core:** step 2 drains the previous receiving chain to `header.pn` into the skipped keys before ratcheting; drained keys are archived like any derived key. (4) `KDF_RK` info `"WhisperRatchet"` — the T2.15 root-KDF vector assertion is green. Results: S19 and S05 green (S05 rewritten to the genuine cross-epoch reorder: two messages in one epoch, the second arrives after the next epoch's first); S03/S19 expectations rewritten for per-epoch counters; new property `test/properties/ratchetSteps.test.ts` (1000 random conversation segments over 100 fresh sessions: DHs and root key change exactly on new-epoch receives, never on sends); interleaving property green with cross-epoch traffic (worlds reused for time; `PROPERTY_RUNS` raises the count). Ordering deviation, approved by the owner: T2.7 and T2.8 cores were pulled forward because a ratchet without them loses every late old-epoch message and the interleaving property could not stay honest; their remaining scope (epoch-aware bound, pruning, DEVIATION-4) stays with T2.6. The `protoVersion` bump to 3 lands with T2.5's envelope change (one bump); until then the header shape is unchanged and only key derivation differs from pre-T2.0 clients. Frozen encrypt vectors re-pinned twice (bootstrap, then the constant).

---

## T2.13 — Identity binding, initiator authentication, safety number
**Tier** CORE · **Fixes** P0-9, P2-13 · **Est** 4d · **Depends** T2.0 · **Breaks handshake** (same v3 bump) · **Status:** done 2026-09-28 (five commits)

### Changes
1. **Binding signature.** `identity/binding.ts`: `signIdentityBinding(ikSignPriv, ikDhPub) = ed25519.sign("velo-identity-binding-v1" || ikDhPub)`; `verifyIdentityBinding`. Client publishes it via `POST /keys/identity` (extended); server stores `identityBindingSignature`, returns it in the bundle and in new `GET /keys/identity/:userId` `{identitySignPublicKey, identityDhPublicKey, identityBindingSignature, identityChangedAt}`.
2. **Pinned trust enforced.** `identity/trust.ts` (pure): `checkIdentity(pinned, presented) → 'first-contact' | 'match' | 'mismatch'`. `fetchAndVerifyPreKeyBundle` and `x3dhRespond` both: verify the binding, then `checkIdentity` against the pin; `first-contact` → pin both keys; `mismatch` → throw `IDENTITY_MISMATCH`; never proceed on a mismatch. The trust store now pins **both** keys.
3. **Responder authenticates the initiator.** On `initPacket`: fetch (or use pinned) identity for `fromUserId`; require `initPacket.initiatorIdentityDhPublicKey === pinned IK_dh`. The packet no longer needs to carry the identity key at all after this — keep it for the mismatch diagnostic only.
4. **Safety number.** `identity/fingerprint.ts` implements libsignal's numeric fingerprint (version 0, 5200 iterations SHA-512 over `version || IK_sign || IK_dh || stableUserId`, two 30-digit halves ordered by raw bytes). Verified against the T2.15 vectors. `VerifyContactScreen` shows it; a mismatch renders the security-warning class from §8.3 and blocks send until "Verify" or "Accept new identity".
5. **Server:** `identityKeyHistory[]` and `identityChangedAt` on `User`; identity upload with a different key appends history, **purges the user's one-time and signed prekeys** (S10 finding: stale pre-reinstall prekeys otherwise break every new session to the user), and emits `identity:changed` to every peer with a conversation; the client re-uploads its prekeys after re-registering; **remove the `initPacket` synthesis in `setupSocket.ts:481-495`** — the client bootstraps from the first stored message (history path) or from the live `initPacket`.
6. **AD** for T2.5 becomes `IK_sign_A || IK_sign_B || canonicalHeader` (binding covers the DH keys).
7. Rewrite `docs/protocol/SESSION_ESTABLISHMENT_POLICY.md` for the new states: `unverified-first-contact`, `verified`, `identity-changed-blocked`.

**Acceptance:** S20 and S21 pass with `IDENTITY_MISMATCH`; first contact pins silently; fingerprint KAT matches libsignal; a peer reinstall shows the warning and blocks until accepted; `grep -n "firstWithInitPacket" chats-server/src` empty; §8.5 gains `DEVIATION-5`.

**Status 2026-09-28:** done as five commits (R2): (1) package primitives — `identity/binding.ts` (`signIdentityBinding` / `verifyIdentityBinding`, domain `velo-identity-binding-v1`), `identity/trust.ts` (`checkIdentity`, `requireIdentityMatch` = the single `IDENTITY_MISMATCH` throw site; a legacy signing-key-only pin matches on the signing key because the binding vouches for the DH key), `identity/fingerprint.ts` (libsignal numeric fingerprint; T2.15 fingerprint vector green; Velo feeds `IK_sign || IK_dh`, DEVIATION-5), `PreKeyBundle.identityBindingSignature` verified inside `x3dhInitiate`; client two-key pins (record v2) and the 60-digit safety number in `VerifyContactScreen`. (2) server — `POST /keys/identity` takes both keys + binding, verifies it (`lib/identityBinding.ts`), records `identityKeyHistory` / `identityChangedAt`, **purges the user's one-time and signed prekeys on change** (S10 finding) and emits `identity:changed` to conversation peers via `lib/realtime.ts`; `GET /keys/identity/:userId` returns both keys, binding and change time; the bundle carries the binding (404 `NO_IDENTITY_BINDING` without). (3) `firstWithInitPacket` synthesis removed from `setupSocket.ts` and the harness server. (4) enforcement — client `crypto/identityTrust.ts` (`enforcePinnedIdentity` on every bundle via `prekeyBundle.ts`, `authenticateInitiator` on every `initPacket` via `sessionBootstrap.ts`, `acceptNewIdentity`), bound identity uploaded at login (`auth.store.ts`); harness `VirtualClient` mirrors it; **S20, S21 and S10 green**. (5) UI/state — `useChatE2EE` gains `sessionHealth.status = 'identity_changed'` (from `IDENTITY_MISMATCH` on send, receive or history, or the `identity:changed` socket event), sending is refused in that state, `ChatScreen` shows the security-warning class (danger tone) with **Verify** and **Accept new identity**; `SESSION_ESTABLISHMENT_POLICY.md` §3 gains the identity states. Deviations: the `initPacket` still carries `initiatorIdentityDhPublicKey` (used only for the mismatch diagnostic, as the spec allows); the server verifies the binding with `tweetnacl` (approved set) so it never stores an inconsistent identity, although clients never rely on that; legacy `/keys/identity-dh` stays for rollout. Known-red is now S12, S13, S14, S16.

---

## T2.5 — AEAD with identity-bound associated data
**Tier** CORE · **Fixes** P1-1 · **Est** 2d · **Depends** T2.13 · **Requires** D3 sign-off for `@noble/ciphers` · **Status:** done 2026-09-28 with **D3 = C** (owner): no new primitive; Signal's encrypt-then-MAC from `tweetnacl` + `@noble/hashes`

`ratchet/header.ts` `canonicalHeaderBytes(h)`: `u8 version | u32be dhPubLen | dhPub | u32be n | u32be pn` (R4). `primitives/aead.ts`: `xchacha20poly1305(key, nonce, ad)` from `@noble/ciphers`; `ad = IK_A || IK_B || canonicalHeaderBytes(header)`. Message key split per Signal (`WhisperMessageKeys` → 32-byte key + 24-byte nonce input, or random 24-byte nonce — document the choice). If D3 is refused, fall back to v1 Option A (prefix the AD inside `secretbox` and `nacl.verify` it after opening).

**Acceptance:** S13, S14 pass (`HEADER_TAMPERED` / `DECRYPT_FAILED`); a ciphertext re-attributed to a different sender pair fails; `canonicalHeaderBytes` byte-identical over 1000 randomised round-trips; §8.2 updated.

**Status 2026-09-28:** done in two commits. D3 was decided as **C**: the owner asked to avoid another library, and Signal itself uses encrypt-then-MAC rather than an AEAD, so `ratchet/envelope.ts` builds exactly that from existing primitives: `expandMessageKey` (`ratchet/messageKeys.ts`) = HKDF-SHA256(mk, `WhisperMessageKeys`, 88) → cipher key ‖ MAC key ‖ 24-byte nonce (the first 80 bytes are libsignal's cipher key, MAC key and iv; the T2.15 message-key vector is green); `sealMessage` = secretbox under the cipher key with the derived nonce, then HMAC-SHA256(macKey, `IK_sign_sender ‖ IK_sign_receiver ‖ canonicalHeaderBytes ‖ ciphertext`) truncated to 16 bytes; `openMessage` verifies the MAC (constant-time `nacl.verify`) before returning anything. `ratchet/header.ts` implements the R4 canonical bytes with a decoder and a 1000-round-trip test. The nonce is derived, not transmitted: every message key is used once, so DEVIATION-6 is removed. `ratchetEncrypt/Decrypt(session, …, ad)` take `AssociatedData` (both identity signing keys); the client adapter supplies them from the Keychain and the trust pin (`crypto/associatedData.ts`), which T2.13 guarantees exists before any session. Error classes: if the payload opens under the derived key but the MAC fails, the header or identities were modified → `HEADER_TAMPERED`; otherwise `DECRYPT_FAILED`. A tampered `dhPub` or `n` derives a different key and is therefore `DECRYPT_FAILED` (indistinguishable from a corrupt message), a tampered `pn` or a re-attributed pair is `HEADER_TAMPERED`; S13/S14 assert exactly this and that nothing tampered is ever accepted. Wire v3 end to end: session `protoVersion: 3` (older sessions discarded on load), client DTOs and history read `v3 {header, ciphertext, mac}`, server accepts `protoVersion: 3` only (`UNSUPPORTED_PROTO_VERSION`), `Message.v3` schema, history route returns `v3`. Known-red is now S12 and S16.

---

## T2.6 — Bound the skipped-key derivation
**Tier** CORE · **Fixes** P1-2 · **Est** 1d · **Status:** done 2026-09-28 (two commits, with T2.7's remaining scope)

Constants: `MAX_SKIP_PER_STEP = 100`, `MAX_SKIP_TOTAL = 1000`, `MAX_SKIP_EPOCHS = 5`, `MAX_MESSAGE_NUMBER = 2**24`. Throw `TOO_MANY_SKIPPED` before any derivation when `gap > MAX_SKIP_PER_STEP`. Server: `Number.isInteger(n) && 0 <= n < MAX_MESSAGE_NUMBER`, same for `pn`.

**Acceptance:** S12 passes in < 50 ms; gap 99 decrypts; gap 101 throws; server rejects `n = 10_000_000`.

**Status 2026-09-28:** done. `ratchet/limits.ts` holds `MAX_SKIP_PER_STEP = 100`, `MAX_SKIP_TOTAL = 1000`, `MAX_SKIP_EPOCHS = 5`, `MAX_MESSAGE_NUMBER = 2^24`, `PEER_EPOCH_HISTORY = 16`. (1) `ratchetDecrypt` refuses, before any derivation, a gap over `MAX_SKIP_PER_STEP` on the current chain or on the chain being drained via `pn` (`TOO_MANY_SKIPPED {what, gap, limit}`), and any counter outside `[0, MAX_MESSAGE_NUMBER)` (`HEADER_TAMPERED`); the server applies the same counter bound. S12 green: the child reports `TOO_MANY_SKIPPED` in under 50 ms. (2) `pruneSkippedKeys` runs at commit: keys are kept for the last `MAX_SKIP_EPOCHS` entries of the explicit `skippedEpochOrder` and at most `MAX_SKIP_TOTAL` overall, evicting oldest-epoch-first and lowest-counter-first, deterministically (idempotent, tested). `dhRatchet` appends the new epoch to `skippedEpochOrder` and to `peerEpochHistory` (last 16 peer ratchet keys). A message whose `dhPub` is a remembered previous epoch with no retained key is `UNKNOWN_OLD_MESSAGE` and never triggers a ratchet backwards; a never-seen key is still treated as a new epoch (S18: `DECRYPT_FAILED`). Acceptance from T2.7 met here: 2 epochs back decrypts, 6 epochs back is `UNKNOWN_OLD_MESSAGE`, retained keys never exceed `MAX_SKIP_TOTAL`. The old count-only `MAX_SKIP = 50` is gone. Session fields `skippedEpochOrder` / `peerEpochHistory` are optional (missing = empty), so no session migration. Deviation: per-step limit 100 rather than Signal's 2000, chosen for a mobile client and revisitable.

---

## T2.7 — Keep skipped keys across ratchet steps
**Status:** done 2026-09-28: core with T2.0 (commit "T2.7: keep skipped message keys across a DH ratchet step"), epoch-aware bound, `skippedEpochOrder`, pruning and `UNKNOWN_OLD_MESSAGE` with T2.6 (DEVIATION-4 active).

**Tier** CORE · **Fixes** P1-3 · **Est** 2d · **Depends** T2.0, T2.6

`dhRatchet` no longer clears `skippedKeys`; `pruneSkippedKeys` evicts oldest-epoch-first using an explicit `skippedEpochOrder: string[]` on the session (never JS object order).

**Acceptance:** S05 passes; a message 2 epochs back decrypts; 6 epochs back → `UNKNOWN_OLD_MESSAGE`; stored skipped keys never exceed `MAX_SKIP_TOTAL`; eviction deterministic.

---

## T2.8 — `skipMessageKeys(header.pn)` before the ratchet
**Status:** done 2026-09-28 with T2.0 (commit "T2.8: drain the previous receiving chain to header.pn before ratcheting").

**Tier** CORE · **Fixes** P1-4 · **Est** 2d · **Depends** T2.7

Implement §8.1 step 2 exactly. `pn` is read in exactly one place.

**Acceptance:** S05 with messages from both sides of the boundary; S17 passes; S01 still passes; property test over 10,000 interleavings of 20 messages: each decrypts exactly once or is explicitly rejected.

---

## T2.9 — Fourth DH and Signal's X3DH constants
**Tier** CORE · **Fixes** P1-5 · **Est** 1d · **Decision** D2 = fix · **Status:** done 2026-09-28

`DH1 = DH(IK_A, SPK_B)`, `DH2 = DH(EK_A, IK_B)`, `DH3 = DH(EK_A, SPK_B)`, `DH4 = DH(EK_A, OPK_B)`; IKM = `0xFF×32 || DH1 || DH2 || DH3 [|| DH4]`; HKDF info `"WhisperText"`. Both sides in one commit.

**Acceptance:** initiator and responder derive identical SK with and without OPK; T2.15 X3DH vectors pass; S01, S02, S08, S15 pass.

**Status 2026-09-28:** done in one commit, both sides. `handshake/x3dh.ts` now computes DH1 = DH(IK_A, SPK_B), DH2 = DH(EK_A, IK_B), DH3 = DH(EK_A, SPK_B), DH4 = DH(EK_A, OPK_B), IKM = `0xFF×32 ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4]`, HKDF-SHA256 with info `WhisperText` (constant `INFO_X3DH`; `x3dh-v1` is gone). `x3dhRespond` takes the responder's identity DH secret (`identityDhSecretKey`) for DH2; the client wrapper loads it from the Keychain and the harness client from its store. **The T2.15 X3DH vectors are green: every libsignal-comparable assertion (X25519, HKDF, X3DH, KDF_RK, KDF_CK, message keys, fingerprint) now matches the reference.** Frozen X3DH vectors re-pinned (wire change within the v3 series). DEVIATION-2 resolved. Bundles from a peer whose identity DH key was substituted already failed the binding check (T2.13); the fourth DH additionally binds the responder's identity into the secret itself, as in Signal.

---

## T2.10 — Signed prekey rotation
**Tier** CORE · **Fixes** P1-6 · **Est** 2d · **Status:** done 2026-09-28 (two commits)

`createdAt` stored with the SPK; rotate after 7 days; retain previous SPKs for 30 days keyed by `signedPreKeyId` (`getSignedPreKeySecretForKeyId`); server keeps the last N; SPK signature covers `keyId || publicKey` with a domain tag (wire v3 change, document in §8.2).

**Acceptance:** rotation on next `ensurePreKeysForUser` after 7 days; a handshake against a 20-day-old SPK completes; 31-day-old → typed error; existing sessions unaffected (they copied the SPK pair in T2.0).

**Status 2026-09-28:** done. `handshake/signedPrekey.ts`: signature over `"velo-signed-prekey-v1" ‖ u32be keyId ‖ publicKey` (`signSignedPreKey` / `verifySignedPreKey`; `verifySignedPreKeyBundle` checks the tagged form, a signature replayed onto another key id is refused); pure policy `rotateSignedPreKeySet` (rotate at 7 days, retain previous 30 days, drop expired; a legacy set is replaced) and `selectSignedPreKey` (current or retained by id; unknown or expired → `SESSION_RESET_REQUIRED` with the age in days). Client `crypto/prekeys.ts` stores a `SignedPreKeySet` in the Keychain (`createdAt` per key, key ids = seconds since 2020 so they increase and fit u32), rotates in `ensureSignedPreKeyForUser` on login/hydrate, uploads the current key, and `x3dhRespond` looks the pair up by the packet's `signedPreKeyId`. Server keeps the five newest keys per user after each upload. Harness: a fake clock per world; S22 covers rotation after 7 days, unaffected pre-rotation sessions, a 20-day-old key completing and a 31-day-old one refused. Deviation: rotation runs on the next key bootstrap (login, hydrate, foreground top-up) rather than a background timer; a device that never re-opens the app simply keeps serving its last key, which the 30-day retention on the responder side tolerates.

---

## T2.11 — Glare, peer reinstall, and OPK lifecycle
**Tier** CORE · **Fixes** P1-11 · **Est** 2d · **Depends** T2.13 · **Status:** done 2026-09-28 (two commits)

- Inbound `initPacket` while a session exists and the identity **matches** the pin: if the local session has never decrypted anything from the peer, both sides tie-break deterministically (the lower user id's session wins; the other side re-bootstraps from the peer's packet). Otherwise surface `SESSION_RESET_REQUIRED` with the Reset affordance.
- Delete the OPK secret only after the responder session is persisted; delete OPK secrets referenced by ignored packets.

**Acceptance:** S10 and S17 pass without manual reset; no OPK secret remains for a consumed key id after the session is persisted.

**Status 2026-09-28:** done. (1) Bootstrap lifecycle (`chat/incoming.ts`, harness mirror): authenticate the initiator, refuse a replayed packet (bounded cache of used ephemeral keys, `storage/bootstrapReplayCache.ts`), build a candidate responder session, decrypt the accompanying message, and only then persist keys and session, delete the one-time prekey secret and remember the packet; a packet whose message does not decrypt leaves no session and keeps its secret (deleting on failure would let an attacker burn the pool — deviation from "delete OPK secrets referenced by ignored packets", recorded). `x3dhRespond` no longer deletes the secret itself. S24. (2) Resolution of a packet against an existing session: glare (our session never received) → the lower user id's session wins on both sides; the winner keeps its session and stores the peer's as a decrypt-only **secondary** (`session:v2:<me>:<peer>:secondary`, sealed like the primary) so the loser's in-flight messages still decrypt; the loser adopts; the secondary is retired on the first primary success from the peer. Established session + new packet whose message decrypts under the candidate → the peer reset locally and re-initiated: adopt (the decrypt proves the pinned identity; no manual reset on this side). S23 (glare, loser's two in-flight messages decrypt, convergence) and S25 (peer reset adopted; bogus packet leaves the session untouched); S10 now passes without any `resetSession` call. DEVIATION-7 added: a single secondary session instead of Signal's list of previous session states.

---

## T2.14 — Local encrypted message store; delete keys after use
**Tier** CORE · **Fixes** P1-10 (with T3.1) · **Est** 4d · **Decision** D7 · **May slide to Phase 3'** · **Status:** done 2026-09-28 with **D7 = A** (owner): sealed AsyncStorage records, no native database

`@op-engineering/op-sqlite` with SQLCipher enabled; DB key generated once, stored in Keychain (`db-mk:<userId>`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); tables `messages(id, conversationId, seq, direction, body, createdAt, status, replyTo, expiresAt)`, `sessions(peerUserId, blob)`, `skipped_keys` (bounded). Receive path: decrypt → insert → **do not store the message key**. Remove `v2MessageKeyStore.ts` and `historyMasterKey.ts` from the live path (keep a one-time migration that decrypts existing server history with the archived keys into the DB, then deletes the archive). `useChatE2EE` reads history from the DB and asks the server only for `undelivered` (T3.1). "Reset secure session" no longer touches history.

**Acceptance:** after a message is decrypted, no `v2mk:*` key exists for it; kill + relaunch shows history without any server call; `stored_keys_only` mode removed; S16 shows bounded storage.

**Status 2026-09-28:** done. D7 was decided as **A** (the owner asked to avoid another library): `storage/messageStore.ts` keeps one sealed record per message (`msg:v1:<me>:<peer>:<createdAt>:<id>`, XSalsa20-Poly1305 under the per-user session master key from the Keychain), behind a small interface so a SQLite backend can replace it when search and media need queries (Phase 7'). Receive path: decrypt → store plaintext → **no message key archived** (`ratchetAdapter.persistStep` saves only the session; skipped keys live in the session, bounded by T2.6). Send path stores the outgoing message at each state (sending/sent/failed) and delivery/read updates are written through. `useChatE2EE` reads the newest page from the store, then asks the server only for messages newer than the latest stored one (`GET /messages/with/:id?after=` added, ascending; T3.1's undelivered endpoint replaces it), decrypting them through the T2.11 receive path; `loadMore` pages the store only; `decryptHistoryBatch` and `stored_keys_only` are gone. One-time migration `migrateArchivedHistory` decrypts old server history with the pre-T2.14 archive into the store and deletes the archive; `v2MessageKeyStore` remains for that only. "Reset secure session" and "Accept new identity" no longer touch history. Logout wipe covers the store. Harness: `VirtualClient` mirrors it (`storedMessages`, `loadHistory` = store + sync); **S16 green: zero archived keys after 1000 messages** — the last red scenario; the known-red registry is empty. Deviation: not SQLite (D7 = A, revisit at Phase 7'); reinstall still loses history (backup deferred, as planned).

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

**T3.1 status 2026-09-28: done** (two commits). Server: the recipient's delivered ack (socket `message:delivered`, or the new HTTP twin `POST /messages/delivered` used by the history sync) unsets `v3` and `initPacket`; the document stays as a metadata-only receipt (status, deliveredAt, readAt) so a sender who was offline still learns the state, and read receipts keep working on the stub. `GET /messages/undelivered?peerUserId&after&limit&receiptsSince` returns the ciphertext still held for the caller (oldest first) plus receipts for the caller's own messages updated since the cursor. Every message carries `expiresAt` (`MESSAGE_TTL_DAYS`, default 30) with a TTL index; delivery refreshes it. `lib/delivery.ts` owns the rule (recipient only, read never regressed, repeated ack is a no-op). The old `/messages/with/:id` route is kept only for the T2.14 archive migration. Client: `historySync.syncNewerFromServer` pulls undelivered ciphertext, decrypts through the T2.11 receive path, stores, **then** acks (the ack is never sent for a message that failed to decrypt, so it stays on the server for a retry); receipts patch the stored copies (`patchStoredMessage`); the receipts cursor `msgsync:v1:<me>:<peer>` is wiped on logout. The live path already acked only after a successful decrypt. Harness: `FakeServer.undelivered/ackDelivered/receipts/heldCiphertextCount`, `VirtualClient.receive` acks after storing, `loadHistory` = store + undelivered; **S26** (delete-on-delivery: no ciphertext after decrypt, offline pull then delete, undecryptable stays, authorization) green from the start; S18 takes the genuine DTO from the wire log. Cursor note: `after` was `createdAtClient` until T3.2 made it `seq`. Not done: removing the legacy history route (after the migration window).

**T3.2 status 2026-09-28: done** (two commits). Server: `Conversation.lastSeq` is incremented atomically (`findOneAndUpdate $inc`) before the message document is created, and the message stores that `seq`; unique partial index on `(conversationId, seq)`; `lastMessageAt` is server time. `seq` travels in the send ack, both `message:new` emits, the undelivered listing (sorted by `seq`; `after` is a `seq` cursor), receipts, and the legacy history items; a resend of the same `clientMessageId` returns the original id and `seq`. Client: `seq` on `NewMessageDTO`, `HistoryItem`, `ReceiptItem`, `StoredMessage` and `UIMessage`; the chat list orders by `seq` and falls back to `createdAt` only for a send still in flight (the ack settles it into server order); the sync cursor is the highest `seq` seen; the store's record key stays `createdAt` (paging within a device). Harness: `FakeServer` assigns `seq` per conversation, `VirtualClient` orders its store by `seq` and has `clockSkewMs` for scenarios; **S27** (a peer with a skewed clock cannot reorder the conversation, live or after an offline pull) green from the start. `createdAtClient` is display only everywhere.

**T3.3 status 2026-09-28: done for Android** (two commits; iOS APNs stays parked with T1.16). Server: the push is a data-only wake-up `{type:'msg', serverMessageId}`, no `notification` block, no username, no conversation id, no text; a token is pruned only on `registration-token-not-registered` / `invalid-argument` / `invalid-registration-token` (`buildMessagePush`, `tokensToPrune` pure and tested). Client: one inbound ingest path, `historySync.ingestUndeliveredItems` (decrypt through the T2.11 receive path → store → ack), now serves three callers: the chat's history sync, the chat list for a live message of a chat that is not open, and the push wake-up (`pushIngest.fetchAndIngestUndelivered`: fetch everything undelivered for the device, ingest per peer, notify). `setBackgroundMessageHandler` and `notifee.onBackgroundEvent` are registered in `index.js` before the app; `usePushHandlers` (signed-in shell) wires `onMessage`, `onForegroundEvent` and `getInitialNotification`; a tap sets `pendingOpenChatPeerUserId` and `MainTabsScreen` opens that chat. The sender's name comes from saved contacts, then the conversation list, never from the push. **Honest preview toggle:** the notification body is the message text only if previews are enabled, otherwise the fixed `New message` (`pushPolicy.notificationBodyFor`, tested); the open chat never notifies, the background always does, the foreground follows the in-app alert preference (`shouldNotifyFor`). Stable notifee id per message so a re-fetch never shows one twice. Not done: iOS (parked), and the `message:read` emitted by the ChatScreen path is unchanged (a notification does not mark read).

**T3.4 status 2026-09-28: done** (three commits). (1) **Replay window:** a session remembers the last `REPLAY_WINDOW = 256` consumed message ids (`recentlyReceived`, `dhPub:n`, oldest first). A second copy of one of them is `REPLAY_DETECTED` whatever its epoch; an old counter outside the window, or a skipped key that was evicted, is `UNKNOWN_OLD_MESSAGE` (before, an evicted skipped key on the current chain read as a replay and a replay from an evicted epoch read as unknown). Both are refused before any derivation. (2) **Zeroization:** `primitives/zeroize.ts` `wipe()`; every intermediate the protocol derives is zeroed as soon as the step no longer needs it, on success and on failure (`try/finally`): chain and message keys in both ratchet steps, the HKDF blocks in `kdfRootKey` and `expandMessageKey` (copied out, then zeroed), DH outputs, root-key bytes and private-key bytes in `dhRatchet` and in session initialisation, the DH outputs, the IKM and the HKDF block in X3DH, the initiator's ephemeral secret, and in the envelope the expanded cipher key, MAC key, nonce and the decrypted plaintext bytes; `sealMessage`/`openMessage` consume the message key they are given. **No key material leaves a step:** `derivedKeys` is gone from both step results (nothing needed it since T2.14). DEVIATION-8 records the JavaScript limits. (3) **Mutation audit:** `test/audit.noMutationBeforeAuth.test.ts` deep-freezes the session and envelope and runs every refusal class (bad MAC, re-attributed identities, replay, counter out of range, gap too large, unknown ratchet key, old counter with no key) plus the success paths of encrypt, decrypt and `dhRatchet`: a write into an input would surface as a `TypeError` instead of the `ProtocolError`, and the inputs equal their snapshots afterwards. **S28** does the same end to end: for each refusal class on the wire, the recipient's serialized store is byte-identical before and after and the server still holds the message (no delivered ack). Client persist sites audited (all after the pure step returns): `ratchetAdapter.persistStep` → `saveSession`; `incoming.ts` → `saveSecondarySession`, then `deleteOneTimePreKeySecret` and `markBootstrapSeen` only after the session is persisted; `historySync.ingestUndeliveredItems` → `upsertStoredMessage` then the delivered ack; the initiator's own session is saved on send (`sessionStore.ts`, no inbound authentication involved).

**T3.6 status 2026-09-28: done** (four commits, wire v4). Protocol: `KDF_RK_HE` (96 bytes: RK ‖ CK ‖ NHK; first 64 unchanged), X3DH expands 128 bytes (`SK ‖ ck ‖ HK_A ‖ NHK_B`; first 64 unchanged, libsignal vectors green), session format v3 with `HKs/HKr/NHKs/NHKr` and `epochHeaderKeys` (previous epochs' HKr kept with their skipped keys, pruned together), `initInitiatorSession`/`initResponderSession` are RatchetInitAliceHE/BobHE, `dhRatchet` is DHRatchetHE. Wire v4: `{encHeader, ciphertext, mac}`, `sealHeader`/`openHeader` (random 24-byte nonce, fixed 85-byte size), MAC over `IK_A ‖ IK_B ‖ encHeader ‖ ciphertext`; receiving trial-decrypts the header under HKr, NHKr, then retained previous-epoch keys; a header that opens under none is `DECRYPT_FAILED` (a modified header and a message of an unknown session are indistinguishable, and an epoch evicted with its header key is unrecognisable; within retained epochs `REPLAY_DETECTED` / `UNKNOWN_OLD_MESSAGE` stay precise). The encrypt step returns the plaintext header for the sender's bookkeeping. Server: protoVersion 4 only, `v4` payload, encrypted header validated by size, counters no longer visible; the legacy history route is gone. Client: v4 everywhere, `v3` sessions discarded on load, the pre-T2.14 archive migration, `v2MessageKeyStore` and the history master key removed (the settings diagnostics now report the session master key and the stored-message count). Harness: `sentHeader`, `flipEncHeader` / `resealHeader` / `alienHeader`; S13, S14, S18, S26, S28 re-cut; frozen vectors re-pinned with an injected header nonce. What the server learns per message now: sender, recipient, time, size, and the optional `initPacket` on a session-creating message; sealed sender remains the next step (§10).

**T3.5 status 2026-09-28: done** (one commit). The X3DH IKM builder takes an optional trailing KEM shared secret: `IKM := 0xFF×32 ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4] [‖ SS]`, which is exactly PQXDH's `F ‖ DH1..DH4 ‖ SS`; `x3dhInitiate` / `x3dhRespond` accept `kemSharedSecret` (32 bytes, `KEM_SHARED_SECRET_LENGTH`, wiped after use), both sides must supply the same one, and without it the derivation is byte-identical to before (the libsignal vectors still pass). Schema slots: `PreKeyBundle.pqPreKey` (`{keyId, kind: 'ml-kem-768' | 'ml-kem-1024', publicKey, signature}` or `null`; the server serves `null`, the harness too) and `X3DHInitPacket.pqPreKeyId` / `kemCiphertext` (absent today; the Message model stores them if ever sent). **No wire bump:** nothing PQ leaves the handshake until a client encapsulates, and that day is a wire bump (§8.2) plus `@noble/post-quantum`, not a schema migration. Tests: a bundle with `pqPreKey: null` derives the classical keys and emits no PQ field; with a KEM secret both sides agree and the keys differ from classical; a responder without the secret gets the classical keys, never the PQ ones; wrong length is `INVALID_KEY_LENGTH`; the secret is consumed.

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

**T4.1 status 2026-09-28: done** (one commit). `tsconfig.build.json` extends the type-check config and emits CommonJS with source maps from `src/` to `dist/` (tests excluded); `npm run build` = `tsc -p tsconfig.build.json`, `npm start` = `node dist/index.js` (no TypeScript loader, no watcher, no `cross-env`: the process manager sets `NODE_ENV=production`, T4.2; the server warns at boot when it is not), `npm run dev` keeps nodemon + ts-node, `npm run typecheck` is the `noEmit` pass. `nodemon` moved to devDependencies; `main` is `dist/index.js`; `engines.node >= 20`. `test/build.config.test.ts` pins the manifest so ts-node or nodemon cannot return to the production path. Verified: `npm run build` then loading `dist/app.js` with stub env succeeds; `dist/` is git-ignored.

---

# 8. REFERENCE

## 8.1 Normative ratchet algorithm (replaces v1 §8.1)

```
// ───────── Initialisation (T2.0; header-encryption variant since T3.6) ─────────
// X3DH (T2.9, T3.6) → SK ‖ ck ‖ HK_A ‖ NHK_B  (HKDF "WhisperText", 128 bytes; first 64 = libsignal)
initInitiatorSession(SK, HK_A, NHK_B, spkB_pub):     initResponderSession(SK, HK_A, NHK_B, spkB_pair):
  RK  := SK                                              RK  := SK
  DHs := fresh X25519 pair                               DHs := spkB_pair          // copied into the session
  DHr := spkB_pub                                        DHr := null
  RK, CKs, NHKs := KDF_RK_HE(RK, DH(DHs, DHr))           CKs := CKr := null
  CKr := null                                            HKs := null; HKr := null
  HKs := HK_A; HKr := null; NHKr := NHK_B                NHKs := NHK_B; NHKr := HK_A
  Ns := Nr := PN := 0                                    Ns := Nr := PN := 0
  skippedKeys := {}; skippedEpochOrder := []; epochHeaderKeys := {}; recentlyReceived := []

// KDF_RK_HE(RK, dh) := HKDF-SHA256(salt = RK, ikm = dh, info = "WhisperRatchet", 96) → RK ‖ CK ‖ NHK
// (the first 64 bytes are Signal's KDF_RK; libsignal vectors unchanged)

// ───────── Encrypt (RatchetEncryptHE) ─────────
ratchetEncrypt(session, plaintext, AD):
  work := clone(session)
  mk, work.CKs := KDF_CK(work.CKs)
  header := { dhPub: work.DHs.pub, pn: work.PN, n: work.Ns }
  encHeader := nonce ‖ secretbox(canonicalHeader(header), nonce, work.HKs)   // nonce random, 24 bytes
  work.Ns += 1
  envelope := { encHeader, ciphertext, mac } with
    ciphertext := secretbox(plaintext, nonce(mk), cipherKey(mk))
    mac        := HMAC-SHA256(macKey(mk), IK_A ‖ IK_B ‖ encHeader ‖ ciphertext)[0..16)
  return { work, envelope, header }                    // keys are NOT archived (T2.14); no key material leaves (T3.4)

// ───────── Decrypt (RatchetDecryptHE) ─────────
ratchetDecrypt(session, envelope, AD):
  work := clone(session)                            // never mutate the input (R7)

  // 0. the header must open under a key this session knows (T3.6)
  header, epoch := open(HKr) → 'current' | open(NHKr) → 'next' | open(epochHeaderKeys[e]) → 'previous'
  if none opens: throw DECRYPT_FAILED               // modified header, or a session we do not have
  a header under a known key must name that key's epoch, else DECRYPT_FAILED

  // 1. skipped-key fast path
  id := skippedKeyId(header.dhPub, header.n)
  if work.skippedKeys[id] exists:
      mk := work.skippedKeys[id]
      plaintext := aeadOpen(mk, envelope, AD ‖ encHeader)
      if plaintext is null: throw DECRYPT_FAILED    // keep the key
      delete work.skippedKeys[id]; remember id in recentlyReceived (T3.4)
      return { work, plaintext, header }
  if id in work.recentlyReceived: throw REPLAY_DETECTED           // (T3.4)
  if epoch == 'previous': throw UNKNOWN_OLD_MESSAGE               // its keys were evicted

  // 2. new epoch: drain the old chain to header.pn, then ALWAYS ratchet (R13)
  if epoch == 'next':
      if work.DHr != null: work := skipMessageKeys(work, work.DHr, header.pn)   // (T2.8)
      work := dhRatchet(work, header.dhPub)                                     // (T2.0, T3.6)

  // 3. fill the gap on the current receiving chain
  if header.n < work.Nr: throw UNKNOWN_OLD_MESSAGE
  work := skipMessageKeys(work, header.dhPub, header.n)

  // 4. derive the target key
  mk, nextCK := KDF_CK(work.CKr)

  // 5. authenticate — NOTHING above this line may be persisted
  plaintext := aeadOpen(mk, envelope, AD ‖ encHeader)
  if plaintext is null: throw DECRYPT_FAILED (or HEADER_TAMPERED when the payload opens but the MAC fails)

  // 6. commit
  work.CKr := nextCK; work.Nr := header.n + 1; remember id in recentlyReceived
  work := pruneSkippedKeys(work)                    // also prunes epochHeaderKeys with the epochs
  return { work, plaintext, header }

dhRatchet(work, dhPub):                             // DHRatchetHE
  work.PN := work.Ns; work.Ns := 0; work.Nr := 0
  work.HKs := work.NHKs; work.HKr := work.NHKr
  if work.DHr != null: work.epochHeaderKeys[work.DHr] := old HKr   // late messages of the epoch being left
  work.DHr := dhPub
  work.RK, work.CKr, work.NHKr := KDF_RK_HE(work.RK, DH(work.DHs, work.DHr))
  work.DHs := fresh X25519 pair
  work.RK, work.CKs, work.NHKs := KDF_RK_HE(work.RK, DH(work.DHs, work.DHr))
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
| 2 | removed 2026-09-28 | `{header:{n,pn,dhPub}, nonce, ciphertext}` + optional `initPacket`; header unauthenticated; non-standard bootstrap | Open Beta 0.1 |
| 3 | removed 2026-09-28 | `{header:{n,pn,dhPub}, ciphertext, mac}` + optional `initPacket` on the session-creating message. Standard bootstrap (T2.0, `WhisperRatchet`), message keys expanded with `WhisperMessageKeys` into cipher key + MAC key + derived nonce (no nonce on the wire), MAC-SHA256 over `IK_sign_sender || IK_sign_receiver || canonicalHeader || ciphertext` truncated to 16 bytes, secretbox payload (D3 = C, no new primitive), identity binding in bundles and identity lookups (T2.13). Signed-prekey signature over `keyId || pub` with a domain tag landed with T2.10. **One bump, one migration: all existing sessions reset.** | T2.0–T2.13, 2026-09-28 |
| 4 | **current** | `{encHeader, ciphertext, mac}` + optional `initPacket`. Header encryption (Double Ratchet §4): the header `{n, pn, dhPub}` is sealed under the sender's header key (`nonce ‖ secretbox(canonicalHeader)`, 85 bytes), header keys come from `KDF_RK_HE` (96-byte `WhisperRatchet` expansion, prefix-stable with libsignal) and X3DH's 128-byte `WhisperText` expansion (`SK ‖ ck ‖ HK_A ‖ NHK_B`); MAC over `IK_sign_sender ‖ IK_sign_receiver ‖ encHeader ‖ ciphertext`. The server sees three opaque strings (P1-8). Session format v3. **One bump, one migration: all existing sessions reset; the pre-T2.14 archive migration and `/messages/with/:userId` are gone.** | T3.6, 2026-09-28 |

Every bump: update this table, the server validator, `Message.ts`, and the client's supported-versions constant.

## 8.3 Error code → user message

| Code | User-facing | Recoverable | Action |
|---|---|---|---|
| `MISSING_BOOTSTRAP` | "Waiting for secure session…" | yes | auto-retry |
| `NO_SESSION` | "Setting up encryption…" | yes | auto |
| `STALE_SESSION` / `SESSION_RESET_REQUIRED` | "Secure session needs to be reset" | yes | Reset (history is kept after T2.14) |
| `DECRYPT_FAILED` | "This message couldn't be decrypted" | no | Reset |
| `REPLAY_DETECTED` | *(silent — drop)* — this device already decrypted this message (bounded window of `REPLAY_WINDOW = 256` consumed ids, T3.4) | n/a | log |
| `UNKNOWN_OLD_MESSAGE` | "Older message unavailable" — an old counter whose key is no longer retained: a skipped key that was evicted, or a copy older than the replay window (T3.4) | no | none |
| `TOO_MANY_SKIPPED` | "Too many missed messages" | yes | Reset |
| `SEND_FAILED` | "Not sent — tap to retry" | yes | Retry |
| `STORAGE_CORRUPTION` | "Local data problem" | no | Reset local state |
| `INVALID_KEY_LENGTH` / `IDENTITY_BINDING_INVALID` | "Invalid key data from <name>" | no | Reset |
| **`HEADER_TAMPERED`** | **"Security warning: a message was modified in transit"** | no | prominent warning + verify |
| **`IDENTITY_MISMATCH`** | **"Safety number with <name> has changed"** | manual | verify or accept new identity; sending blocked until then |

The two bold codes are the security-warning class and must look different from technical errors.

## 8.4 Scenario catalog
Canonical list in T2.4. Each scenario file states the checklist row it automates, the defect it covers, and expected state before and after the fix. Implemented in `packages/protocol/test/scenarios/` (2026-09-28); the red set is pinned by `knownRed.test.ts` and must be updated in the same commit as any fix that flips a scenario.

## 8.5 Deviation register

| ID | Deviation | Rationale | Status |
|---|---|---|---|
| `DEVIATION-1` | HKDF directional split instead of an initial DH ratchet | — | **Was the P1-0 bug. Removed by T2.0 on 2026-09-28.** |
| `DEVIATION-2` | X3DH omits `DH(EK_A, IK_B)` | — | **Resolved by T2.9 on 2026-09-28 (D2 = fix); X3DH is byte-identical to libsignal.** |
| `DEVIATION-3` | Message keys retained 30 days for offline history | superseded by the local store | **Removed by T2.14 on 2026-09-28: keys are deleted with the step; plaintext is stored locally.** |
| `DEVIATION-4` | Skipped keys bounded by count *and* epoch (`MAX_SKIP_TOTAL = 1000`, `MAX_SKIP_EPOCHS = 5`, per-step gap 100) | DoS resistance with multi-epoch tolerance | **Active since 2026-09-28 (T2.6)** |
| `DEVIATION-5` | Two identity keys (Ed25519 signing + X25519 DH) bound by a signature, versus Signal's single Curve25519 identity with XEdDSA; the safety number hashes `IK_sign || IK_dh` (64 bytes, no type byte) where libsignal hashes `0x05 || key` | avoids a new signature scheme; binding is verified on every bundle and `initPacket`; the fingerprint construction itself is libsignal's and is vector-tested with libsignal's key encoding | **Active since 2026-09-28 (T2.13, D10)** |
| `DEVIATION-6` | Random 24-byte AEAD nonce instead of a KDF-derived nonce | — | **Removed by T2.5 (2026-09-28): the nonce is derived from the message key with `WhisperMessageKeys`, as in Signal.** |
| `DEVIATION-7` | Glare keeps one decrypt-only secondary session on the winner's side until the peer switches, where libsignal keeps a list of previous session states per address | bounded state, deterministic tie-break (lower user id), no lost in-flight messages | **Active since 2026-09-28 (T2.11)** |
| `DEVIATION-8` | Zeroization is best effort: every intermediate byte array is wiped (`primitives/zeroize.ts`), but the keys stored base64 in a session are JavaScript strings and cannot be wiped, and the engine may hold copies of a byte array | JavaScript has no secure memory; libsignal (Rust) zeroizes on drop | **Active since 2026-09-28 (T3.4)** |

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
