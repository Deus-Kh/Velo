# VELO — AI AGENT EXECUTION SPECIFICATION

**Companion to [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md).** The roadmap says *what* and *why*. This document says *how*,
in enough detail to execute without further design decisions.

**Audience:** an autonomous or semi-autonomous coding agent.
**Spec version:** 1.0 · **Written against commit:** `c9c9267` (Open Beta 0.1) · **Date:** 2026-08-07

---

# 0. PRIME DIRECTIVES

## 0.1 Your role

You are implementing a production-grade end-to-end encrypted messenger. The cryptographic core already
exists and is *mostly* correct. Your job is to fix what is broken, harden what is weak, and extend what is
missing — **without regressing the parts that work.**

This is security-critical code. A subtle bug here does not produce a crash; it produces silent
confidentiality loss that nobody notices for months. Work accordingly.

## 0.2 Hard rules — violating any of these is a failed task

| # | Rule |
|---|---|
| **R1** | **Never modify protocol code without a failing test first.** Write the test, watch it fail, then fix. Applies to everything under `crypto/`, `storage/`, and the ratchet. |
| **R2** | **Never change two protocol behaviors in one commit.** One defect per commit, always. Bisectability is the only debugging tool that works on this class of bug. |
| **R3** | **Never log key material.** Not truncated, not hashed, not "just for debugging". Public keys may be logged truncated. Private keys, chain keys, root keys, message keys: never. |
| **R4** | **Never use `JSON.stringify` for anything that gets hashed, signed, or authenticated.** Key order is not guaranteed stable. Use explicit length-prefixed byte serialization. |
| **R5** | **Never compare secrets with `===` or `==`.** Use `nacl.verify(a, b)` (constant-time). |
| **R6** | **Never add `@ts-ignore`, `@ts-expect-error`, or `any` in `packages/protocol`.** If the types don't work, the design is wrong. |
| **R7** | **Never persist session state before decryption succeeds.** State mutation must follow authentication, never precede it. |
| **R8** | **Any change to the wire format requires a version bump** and an entry in §8.2. |
| **R9** | **Never weaken a security control to make a test pass.** If a test fails because of a control, the test is wrong. |
| **R10** | **Never commit secrets.** Before every commit, verify no `.env`, `.pem`, `.keystore`, connection string, or token is staged. |
| **R11** | **Do not "clean up" code you were not asked to touch.** Unrelated refactors hide real changes in review noise. |
| **R12** | **If an acceptance criterion cannot be met, stop and report.** Do not mark a task done with caveats buried in a commit message. |

## 0.3 STOP — ask the human, do not decide alone

Halt and request explicit confirmation for any of these:

1. **Rotating any production credential** (Atlas password, JWT secret, Firebase key, signing keystore). You can write the code that *reads* the new value; a human must rotate the actual secret.
2. **Rewriting git history or creating a new repository** (roadmap decision D4).
3. **Any deployment, or any change to a running server.**
4. **Any change that invalidates existing user sessions or stored messages** — flag it, describe the blast radius, wait.
5. **The eight open decisions in [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §15** (D1–D8). Each changes downstream work substantially.
6. **Deleting user data or dropping a collection**, even in development.
7. **Adding a new third-party dependency that performs cryptography.** Existing approved set: `tweetnacl`, `tweetnacl-util`, `@noble/hashes`. Additions to that set need sign-off.
8. **Any task where the acceptance criteria appear to contradict the security model.**

## 0.4 How to know you succeeded

A task is complete when **every** acceptance criterion is mechanically verifiable and verified — a command
that exits 0, a test that passes, a grep that returns nothing. "It looks right" is not an acceptance criterion.

Report per task: criteria met, commands run with output, files changed, anything deferred and why.

---

# 1. PROJECT MAP

## 1.1 Verified repository layout

```
velo_old/                                  ← repo root
├── chats-client/                          React Native 0.83.1, TypeScript, RN CLI (not Expo)
│   ├── index.js                           entry; registers background FCM handler
│   ├── App.tsx
│   ├── babel.config.js                    ⚠ malformed plugins array — see T1.2
│   ├── android/  ios/
│   └── src/
│       ├── app/Navigation.tsx
│       ├── screens/                       8 screens
│       ├── components/                    10 shared components
│       ├── store/                         6 Zustand stores
│       ├── theme/                         theme.ts, ThemeProvider.tsx
│       └── shared/
│           ├── api/                       axios client + 6 API modules
│           ├── chat/                       useChatE2EE.ts (846 lines), drainPendingMessages.ts
│           ├── crypto/                     ← THE PROTOCOL. 22 files.
│           ├── notifications/              notifee.ts, push.ts, sync.ts
│           ├── socket/                     socket.ts, messaging.ts, sendAuto.ts
│           ├── storage/                    5 stores (AsyncStorage + Keychain)
│           └── utils/conversation.ts
└── chats-server/                          Express 5, Mongoose 9, Socket.io 4
    └── src/
        ├── config.ts                      ⚠ contains committed secrets — T1.1
        ├── index.ts                       bootstrap
        ├── middleware/auth.ts             requireAuth
        ├── models/                        User, Message, Conversation, SignedPreKey, OneTimePreKey
        ├── routes/                        auth, users, keys, messages, conversations
        ├── socket/setupSocket.ts          ⚠ ~200 lines of dead commented code at top
        ├── push/firebase.ts
        └── utils/conversation.ts          makeConversationId
```

**Note:** there is a stray root `package.json` + `node_modules` containing one unrelated dependency
(`@notifee/react-native`). It is not part of either workspace. Remove in T1.11.

## 1.2 Files by responsibility — read these before touching related code

| Concern | Primary files |
|---|---|
| **Ratchet** | [messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) · [dhRatchet.ts](chats-client/src/shared/crypto/dhRatchet.ts) · [ratchetChain.ts](chats-client/src/shared/crypto/ratchetChain.ts) · [ratchetRoot.ts](chats-client/src/shared/crypto/ratchetRoot.ts) |
| **Handshake** | [x3dh.ts](chats-client/src/shared/crypto/x3dh.ts) · [prekeyBundle.ts](chats-client/src/shared/crypto/prekeyBundle.ts) · [prekeyBundleVerify.ts](chats-client/src/shared/crypto/prekeyBundleVerify.ts) · [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts) |
| **Identity** | [identityKeys.ts](chats-client/src/shared/crypto/identityKeys.ts) (Ed25519) · [identityDhKeys.ts](chats-client/src/shared/crypto/identityDhKeys.ts) (X25519) · [fingerprint.ts](chats-client/src/shared/crypto/fingerprint.ts) |
| **Session state** | [sessionTypes.ts](chats-client/src/shared/crypto/sessionTypes.ts) · [sessionStore.ts](chats-client/src/shared/storage/sessionStore.ts) · [sessionBootstrap.ts](chats-client/src/shared/crypto/sessionBootstrap.ts) |
| **Key persistence** | [v2MessageKeyStore.ts](chats-client/src/shared/storage/v2MessageKeyStore.ts) · [historyMasterKey.ts](chats-client/src/shared/crypto/historyMasterKey.ts) · [oneTimePreKeys.ts](chats-client/src/shared/storage/oneTimePreKeys.ts) |
| **Send path** | [sendAuto.ts](chats-client/src/shared/socket/sendAuto.ts) → [messaging.ts](chats-client/src/shared/socket/messaging.ts) → [setupSocket.ts](chats-server/src/socket/setupSocket.ts) |
| **Receive path** | [setupSocket.ts](chats-server/src/socket/setupSocket.ts) → [socket.ts](chats-client/src/shared/socket/socket.ts) → [useChatE2EE.ts](chats-client/src/shared/chat/useChatE2EE.ts) |
| **Server security** | [config.ts](chats-server/src/config.ts) · [auth.ts](chats-server/src/middleware/auth.ts) · [auth.routes.ts](chats-server/src/routes/auth.routes.ts) · [keys.routes.ts](chats-server/src/routes/keys.routes.ts) |

## 1.3 Data flow — memorize these two paths

**Send:**
```
ChatScreen
  → sendAuto()                    ensureV2Session() → x3dhInitiate() if no session
  → sendMessageV2()               encryptV2(session, plaintext)
      encryptV2                   chainKdf → messageKey → secretbox
                                  putV2MessageKey('out')     ⚠ I/O inside crypto — T2.2
                                  saveSession()              ⚠ I/O inside crypto — T2.2
  → socket.emit('message:send')   { toUserId, clientMessageId, createdAt, v2, initPacket?, replyTo? }
  → server validates, dedupes on (fromUserId, clientMessageId), persists, fans out
```

**Receive:**
```
socket 'message:new'
  → useChatE2EE handler
  → if initPacket && no session   ensureV2SessionFromIncoming() → x3dhRespond()
  → decryptV2(session, envelope)
      decryptV2                   detect dhPub change → applyDhRatchet()   ⚠ P1-3, P1-4 here
                                  derive skipped keys → derive target key
                                  secretbox.open
                                  putV2MessageKey('in'), saveSession()
  → render
```

## 1.4 Known-good vs known-broken — do not "fix" the left column

| ✅ Correct — leave alone unless a task says otherwise | ❌ Broken — see task IDs |
|---|---|
| `chainKdf` HMAC construction ([ratchetChain.ts](chats-client/src/shared/crypto/ratchetChain.ts)) | Header not authenticated → **T2.5** |
| `kdfRootKey` HKDF construction ([ratchetRoot.ts](chats-client/src/shared/crypto/ratchetRoot.ts)) | Unbounded skip loop → **T2.6** |
| Ed25519 prekey signature verify ([prekeyBundleVerify.ts](chats-client/src/shared/crypto/prekeyBundleVerify.ts)) | Skipped keys wiped on ratchet → **T2.7** |
| Keychain-backed history master key ([historyMasterKey.ts](chats-client/src/shared/crypto/historyMasterKey.ts)) | `header.pn` never read → **T2.8** |
| Per-entry `secretbox` on message keys ([v2MessageKeyStore.ts](chats-client/src/shared/storage/v2MessageKeyStore.ts)) | X3DH missing 4th DH → **T2.9** |
| Message dedupe via unique index + 11000 catch | Signed prekey never rotates → **T2.10** |
| `makeConversationId` sorted-pair scheme | Message keys never pruned → **T2.11** |
| Directional chain split in `createSessionFromX3DH` | Session state unencrypted → **T1.3** |

---

# 2. CONVENTIONS

## 2.1 Language and style

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true` in `packages/protocol`.
- **English only** in all new code, comments, and commit messages. Existing Russian comments in
  [messages.routes.ts](chats-server/src/routes/messages.routes.ts), [users.routes.ts](chats-server/src/routes/users.routes.ts), [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts) may be translated *only* when you are
  already editing that function for another reason.
- **Naming:** `camelCase` functions/variables, `PascalCase` types/components, `SCREAMING_SNAKE` module constants.
- **No default exports** in `packages/protocol`. Named exports only — they survive refactors and grep.
- **Explicit return types** on every exported function.
- Match the surrounding file's existing style. Do not reformat files you are only partially editing.

## 2.2 Cryptographic code rules

- **All key material is `Uint8Array` in memory.** Base64 `string` only at storage and wire boundaries.
- **One conversion point.** Never `decodeBase64` the same value in two places — decode once, pass bytes.
- **Length-check every decoded key.** X25519 and Ed25519 public keys are 32 bytes; Ed25519 secret keys are 64. Throw a typed error on mismatch. `nacl.scalarMult` on a wrong-length input has undefined behavior.
- **Zeroize after use** where the lifetime is clear: `key.fill(0)`. Best-effort in JS, but do it — it's the right habit and examiners look for it.
- **No `Math.random()`.** `nacl.randomBytes()` only. (`react-native-get-random-values` is already installed and polyfills the underlying CSPRNG.)
- **Every crypto function gets a doc comment** stating: inputs, outputs, what security property it provides, and any deviation from the reference specification.
- **Deviations from the spec get a `DEVIATION-n` marker** in code and an entry in §8.5, so the ProVerif model in Phase 13 can account for them.

## 2.3 Branching and commits

```
main          protected, always green
  └─ phase/1-security
       └─ task/T1.3-encrypt-session-state
```

One branch per task. Commit format:

```
T1.3: encrypt session state at rest

Wraps the serialized RatchetSessionV2 in secretbox under a Keychain-held
master key, mirroring the pattern already used in v2MessageKeyStore.ts.

Fixes: P0-3
Wire format: unchanged
Breaking: existing plaintext sessions are wiped on first load (dev-mode
          acceptable per V2_STABILIZATION_CHECKLIST.md §1)
Tests: packages/protocol/test/storage/sessionStore.test.ts (7 cases)
```

Required trailers: `Fixes:`, `Wire format:`, `Breaking:`, `Tests:`.

## 2.4 Testing requirements

| Code being changed | Minimum test requirement |
|---|---|
| `packages/protocol/primitives` | 100% line + branch. Known-answer tests against published vectors where they exist. |
| `packages/protocol/ratchet` | 100% branch. Every throw path must have a test that reaches it. |
| `packages/protocol/handshake` | Both sides derive identical output; every failure mode covered. |
| Server route | Happy path + every 4xx branch + authorization bypass attempt. |
| Client service | Happy path + error path. |
| UI component | Render + primary interaction. |

**A crypto change with no test is not a change. Revert it.**

## 2.5 Documentation you must keep current

| When you… | Update |
|---|---|
| Close a P-numbered defect | [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §3 — mark resolved with the task ID |
| Complete a phase | [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §2 parity matrices |
| Pass a checklist scenario | [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) — tick the box, fill §12 |
| Change the wire format | §8.2 here + bump `protoVersion` |
| Introduce a spec deviation | §8.5 here + `DEVIATION-n` marker in code |
| Change session lifecycle | [SESSION_ESTABLISHMENT_POLICY.md](SESSION_ESTABLISHMENT_POLICY.md) |
| Change architecture | [architecture.md](architecture.md) (needs a full rewrite regardless — T4.11) |

---

# 3. ENVIRONMENT

## 3.1 Setup

```bash
# server
cd chats-server && npm install
cp .env.example .env          # after T1.1 creates it; fill values
npm run dev

# client
cd chats-client && npm install
cd ios && pod install && cd ..   # macOS only
npm start
npm run android                  # or: npm run ios
```

## 3.2 Verification commands — run before declaring any task done

```bash
# Type checking (must be clean)
cd chats-server && npx tsc --noEmit
cd chats-client && npx tsc --noEmit

# Lint
cd chats-client && npm run lint

# Protocol tests (exists after T2.4)
cd packages/protocol && npm test
cd packages/protocol && npm run test:coverage

# Secret scan — must return nothing
git grep -nE "(mongodb\+srv://[^\"']*:[^\"'@]+@|<REDACTED_JWT_SECRET>|BEGIN [A-Z ]*PRIVATE KEY)" -- \
  ':!*.md' ':!package-lock.json'

# Staged-file secret check before commit
git diff --cached --name-only | grep -Ei "\.(pem|keystore|jks|p12|env)$"   # must be empty

# Dependency audit
cd chats-server && npm audit --audit-level=high
cd chats-client && npm audit --audit-level=high
```

## 3.3 What you cannot do — hand these to the human

- Run the app on a physical device or simulator
- Perform the manual two-device scenarios in [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) §4–§7 (**this is why T2.4 automating them matters so much**)
- Rotate credentials, provision DNS/TLS, deploy
- Anything in Xcode or Android Studio GUI
- Approve decisions D1–D8

When a task needs one of these, complete everything around it, then produce a precise
**HUMAN ACTION REQUIRED** block: what to do, exact commands or clicks, and how you will verify it afterwards.

---

# 4. PHASE 1 — SECURITY REMEDIATION

**Goal:** no P0 remains open. **Duration:** ~2 weeks. **Branch:** `phase/1-security`.

Tasks T1.1–T1.11 are independent unless noted; T1.5 (Redis) unblocks T1.6.

---

## T1.1 — Remove committed secrets from config

**Tier** CORE · **Fixes** P0-1 · **Est** 0.5d · **Depends** none · **Risk** low (code) / high (operational)

### Read first
[chats-server/src/config.ts](chats-server/src/config.ts) · [chats-server/src/index.ts](chats-server/src/index.ts) · `chats-server/.gitignore`

### Objective
No secret has a hardcoded fallback. Missing configuration fails loudly at boot, never silently at runtime.

### Changes

Replace [config.ts](chats-server/src/config.ts) entirely:

```ts
import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Copy .env.example to .env and provide a value.`
    );
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be numeric, got: ${raw}`);
  return n;
}

export const config = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: optionalNumber('PORT', 9999),

  MONGO_URI: required('MONGO_URI'),
  JWT_SECRET: required('JWT_SECRET'),

  JWT_ALGORITHM: 'HS256' as const,
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '900s',      // 15m — was 10800s
  JWT_REFRESH_TTL_DAYS: optionalNumber('JWT_REFRESH_TTL_DAYS', 30),

  BCRYPT_ROUNDS: optionalNumber('BCRYPT_ROUNDS', 12),         // was 10

  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  FIREBASE_SERVICE_ACCOUNT_PATH: required('FIREBASE_SERVICE_ACCOUNT_PATH'),

  CORS_ORIGINS: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
} as const;

if (config.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 48');
}
```

Create `chats-server/.env.example`:
```bash
NODE_ENV=development
PORT=9999
MONGO_URI=mongodb://127.0.0.1:27017/velo
JWT_SECRET=CHANGE_ME_generate_with_openssl_rand_base64_48
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL_DAYS=30
BCRYPT_ROUNDS=12
REDIS_URL=redis://127.0.0.1:6379
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-admin.json
CORS_ORIGINS=
```

Verify `.env`, `*.pem`, `*.keystore`, `secrets/` are in `chats-server/.gitignore`.

### 🛑 HUMAN ACTION REQUIRED
1. Rotate the MongoDB Atlas password for user `velo` (Atlas → Database Access → Edit → Autogenerate).
2. Generate a new JWT secret: `openssl rand -base64 48`. **This invalidates all existing tokens** — acceptable, there are no production users.
3. Place both in `chats-server/.env`.
4. Decide D4 (rewrite history vs. fresh repository). Recommendation: fresh repository, archive the old one privately.
5. Treat the old credentials as permanently compromised regardless of which option you choose.

### Acceptance
- [ ] `git grep -nE "mongodb\+srv://[^\"']*:[^\"'@]+@|<REDACTED_JWT_SECRET>" -- ':!*.md'` returns nothing
- [ ] Server exits non-zero with a clear message when `MONGO_URI` is unset
- [ ] Server exits non-zero when `JWT_SECRET` is shorter than 32 chars
- [ ] `npx tsc --noEmit` clean
- [ ] `.env.example` exists and contains no real values

### Failure modes
- `dotenv.config()` must run before `config` is evaluated — it does, at module top. Do not move it.
- `BCRYPT_ROUNDS` 10→12 makes existing hashes still verify (cost is embedded in the hash). Safe.
- Shortening the access-token TTL to 15m **requires T1.10** to ship in the same release, or users get logged out every 15 minutes.

---

## T1.2 — TLS and environment-driven URLs

**Tier** CORE · **Fixes** P0-2 · **Est** 2d · **Depends** none · **Risk** medium

### Read first
[http.ts](chats-client/src/shared/api/http.ts) · [socket.ts](chats-client/src/shared/socket/socket.ts) · [babel.config.js](chats-client/babel.config.js) · `chats-client/android/app/src/main/AndroidManifest.xml`

### Objective
No hardcoded host anywhere. Cleartext HTTP impossible in release builds on both platforms.

### Changes

**1 · Fix `babel.config.js`.** It is currently malformed — the worklets options object is passed as a
*separate plugin* rather than as options, so worklet configuration never reaches the plugin:

```js
/** @type {import('react-native-worklets/plugin').PluginOptions} */
const workletsPluginOptions = {};

module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        safe: true,
        allowUndefined: false,
      },
    ],
    ['react-native-worklets/plugin', workletsPluginOptions],   // ← was a flat pair; now correctly nested
  ],
};
```
> `react-native-worklets/plugin` must remain **last** in the plugin list — it is a Babel requirement.

**2 · Create `chats-client/.env.example`** and `.env`:
```bash
API_URL=https://api.velo.example.com
SOCKET_URL=https://api.velo.example.com
```

**3 · Create `chats-client/src/shared/config/env.ts`:**
```ts
import { API_URL, SOCKET_URL } from '@env';

function requireHttps(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing env var ${name}. Copy .env.example to .env.`);
  if (!__DEV__ && !value.startsWith('https://')) {
    throw new Error(`${name} must use https:// in release builds. Got: ${value}`);
  }
  return value.replace(/\/+$/, '');   // strip trailing slashes — the current value has one
}

export const env = {
  API_URL: requireHttps('API_URL', API_URL),
  SOCKET_URL: requireHttps('SOCKET_URL', SOCKET_URL),
} as const;
```

**4 · Add `chats-client/src/shared/config/env.d.ts`:**
```ts
declare module '@env' {
  export const API_URL: string;
  export const SOCKET_URL: string;
}
```

**5 · Update consumers.** [http.ts:6](chats-client/src/shared/api/http.ts#L6) → `baseURL: env.API_URL`.
[socket.ts:5](chats-client/src/shared/socket/socket.ts#L5) → `io(env.SOCKET_URL, …)`. Delete both hardcoded IPs and the
commented-out localhost lines above them.

**6 · Android.** In `AndroidManifest.xml`, set `android:usesCleartextTraffic="false"` on `<application>`
and add `android:networkSecurityConfig="@xml/network_security_config"`. Create
`android/app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
```

**7 · iOS.** Remove any `NSAppTransportSecurity` exception from `ios/*/Info.plist`.

### 🛑 HUMAN ACTION REQUIRED
Point a domain at `13.63.159.111`, then run Caddy:
```caddyfile
api.velo.example.com {
    reverse_proxy localhost:9999
}
```
Caddy obtains and renews the certificate automatically. Verify:
`curl -I https://api.velo.example.com/health` returns `200`, and plain `http://` redirects to `https://`.

### Acceptance
- [ ] `git grep -n "13\.63\.159\.111"` returns nothing outside `.md` files
- [ ] `git grep -nE "['\"]http://" -- chats-client/src` returns nothing
- [ ] `npx tsc --noEmit` clean
- [ ] A release build with `API_URL=http://…` throws at startup
- [ ] `curl -I https://<domain>/health` → `200`
- [ ] WebSocket connects over `wss://`

### Failure modes
- `safe: true` in the dotenv config makes the build fail when `.env` is missing a key present in `.env.example`. That is intentional.
- Metro caches env values aggressively. After any `.env` edit: `npm start --reset-cache`.
- Socket.io upgrades `https://` to `wss://` automatically. Do not write `wss://` in `SOCKET_URL`.

---

## T1.3 — Encrypt session state at rest

**Tier** CORE · **Fixes** P0-3 · **Est** 1d · **Depends** none · **Risk** medium

### Read first
[sessionStore.ts](chats-client/src/shared/storage/sessionStore.ts) · [v2MessageKeyStore.ts](chats-client/src/shared/storage/v2MessageKeyStore.ts) (the pattern to copy) · [historyMasterKey.ts](chats-client/src/shared/crypto/historyMasterKey.ts)

### Objective
`rootKey`, `chainKeySend`, `chainKeyRecv`, and `DHsPrivateKey` are never written to AsyncStorage in clear.

### Changes

**1 · Create `chats-client/src/shared/crypto/sessionMasterKey.ts`** — modelled on
[historyMasterKey.ts](chats-client/src/shared/crypto/historyMasterKey.ts) but with a **separate Keychain service**, so compromise of the history key
does not imply compromise of live sessions:

```ts
import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

function service(userId: string) {
  return `session-mk:${userId}`;
}

/**
 * Master key encrypting ratchet session state at rest.
 * Deliberately distinct from the history master key (historyMasterKey.ts):
 * history keys are lower-value than live session state, and separating them
 * limits blast radius if one Keychain entry is exposed.
 */
export async function getOrCreateSessionMasterKey(userId: string): Promise<Uint8Array> {
  const creds = await Keychain.getGenericPassword({ service: service(userId) });
  if (creds !== false && creds?.password) return decodeBase64(creds.password);

  const mk = nacl.randomBytes(32);
  await Keychain.setGenericPassword('session-mk', encodeBase64(mk), {
    service: service(userId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return mk;
}
```

**2 · Rewrite `loadSession` / `saveSession`** in [sessionStore.ts](chats-client/src/shared/storage/sessionStore.ts). Keep the signatures identical —
every caller stays unchanged.

```ts
type SessionBlob = { v: 1; nonce: string; ciphertext: string };

export async function saveSession(params: {
  myUserId: string; peerUserId: string; session: AnySession;
}): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const nonce = nacl.randomBytes(24);
  const plain = utf8Encode(JSON.stringify(params.session));   // JSON is fine here: storage only, never authenticated (R4)
  const cipher = nacl.secretbox(plain, nonce, mk);

  const blob: SessionBlob = { v: 1, nonce: encodeBase64(nonce), ciphertext: encodeBase64(cipher) };
  await AsyncStorage.setItem(sessionKey(params.myUserId, params.peerUserId), JSON.stringify(blob));
}

export async function loadSession(params: {
  myUserId: string; peerUserId: string;
}): Promise<AnySession | null> {
  const raw = await AsyncStorage.getItem(sessionKey(params.myUserId, params.peerUserId));
  if (!raw) return null;

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }

  // Legacy plaintext session (pre-T1.3). Discard rather than migrate: the plaintext
  // has already been exposed, so re-encrypting it provides no real protection.
  // Dev-mode acceptable per V2_STABILIZATION_CHECKLIST.md §1.
  if (!isSessionBlob(parsed)) {
    await AsyncStorage.removeItem(sessionKey(params.myUserId, params.peerUserId));
    return null;
  }

  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const plain = nacl.secretbox.open(
    decodeBase64(parsed.ciphertext), decodeBase64(parsed.nonce), mk,
  );
  if (!plain) return null;      // wrong key or tampered → treat as no session; triggers reset flow

  return JSON.parse(utf8Decode(plain)) as AnySession;
}

function isSessionBlob(v: unknown): v is SessionBlob {
  return !!v && typeof v === 'object'
    && (v as any).v === 1
    && typeof (v as any).nonce === 'string'
    && typeof (v as any).ciphertext === 'string';
}
```

**3 · Fix the stale type.** [sessionTypes.ts](chats-client/src/shared/crypto/sessionTypes.ts) declares:
```ts
skippedKeys?: { [messageNumber: number]: string };
```
but the implementation keys it by `` `${dhPub}:${n}` `` ([messageV2.ts:19](chats-client/src/shared/crypto/messageV2.ts#L19)). The declaration is wrong and
will actively mislead you during T2.7. Correct it now:
```ts
/** Key format: `${dhPubBase64}:${messageNumber}` — epoch-namespaced. See T2.7. */
skippedKeys?: Record<string, string>;
```
Also remove `ProtoVersion = 1 | 2` → `export type ProtoVersion = 2;` (v1 is gone; [protocolPolicy.ts](chats-client/src/shared/crypto/protocolPolicy.ts) already returns 2 unconditionally).

### Acceptance
- [ ] Reading raw AsyncStorage for a `session:v2:*` key shows only `{v,nonce,ciphertext}`
- [ ] `grep -c "rootKey" <raw stored value>` → 0
- [ ] Round-trip test: save → load → deep-equal the original
- [ ] Corrupted ciphertext → `loadSession` returns `null`, does not throw
- [ ] Legacy plaintext entry → removed, returns `null`
- [ ] No caller of `loadSession`/`saveSession` required a signature change
- [ ] `npx tsc --noEmit` clean

### Failure modes
- Keychain is unavailable while the device is locked. `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is correct but means background message processing fails on a locked device — **expected and acceptable**; note it in [SESSION_ESTABLISHMENT_POLICY.md](SESSION_ESTABLISHMENT_POLICY.md).
- `Keychain.getGenericPassword` returns `false` (not `null`) when absent. The `creds !== false` check is mandatory.
- Do **not** reuse `getOrCreateHistoryMasterKey` here. Separate services are the point.

---

## T1.4 — Prekey bundle rate limiting and caching

**Tier** CORE · **Fixes** P0-4 · **Est** 2d · **Depends** T1.5 (Redis) · **Risk** medium

### Read first
[keys.routes.ts](chats-server/src/routes/keys.routes.ts) (esp. the `/bundle/:userId` handler at line 158) · [OneTimePreKey.ts](chats-server/src/models/OneTimePreKey.ts) · [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts)

### Objective
A single requester cannot drain another user's one-time prekey pool. Legitimate retries must not consume
additional keys.

### Changes

**1 · New model `chats-server/src/models/PreKeyBundleIssue.ts`:**
```ts
import { Schema, model, Types } from 'mongoose';

const PreKeyBundleIssueSchema = new Schema({
  requesterId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  targetId:    { type: Types.ObjectId, ref: 'User', required: true, index: true },
  oneTimePreKeyId: { type: Number, default: null },
  issuedBundle: { type: Schema.Types.Mixed, required: true },
  expiresAt:   { type: Date, required: true },
}, { timestamps: true });

PreKeyBundleIssueSchema.index({ requesterId: 1, targetId: 1 }, { unique: true });
PreKeyBundleIssueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });   // TTL cleanup

export const PreKeyBundleIssueModel = model('PreKeyBundleIssue', PreKeyBundleIssueSchema);
```

**2 · Rewrite the bundle handler** with this logic:
```
GET /keys/bundle/:targetId
  requester = req.userId
  if requester === targetId  → 400 (pointless, and a drain vector)

  cached = PreKeyBundleIssue.findOne({ requesterId, targetId, expiresAt: { $gt: now } })
  if cached → return cached.issuedBundle           // ⚠ no OPK consumed on repeat

  rate limit: 20 distinct targets per requester per hour  → 429 on exceed

  ... existing identity + signed prekey lookup ...

  oneTime = OneTimePreKey.findOneAndUpdate({ userId: targetId, used: false }, { used: true, usedAt: now },
                                           { sort: { createdAt: 1 }, new: true })

  remaining = OneTimePreKey.countDocuments({ userId: targetId, used: false })
  if remaining < 10 → logger.warn({ targetId, remaining }, 'prekey pool low')
  if remaining === 0 → logger.error({ targetId }, 'prekey pool exhausted')

  bundle = { ... , oneTimePreKey, remainingOneTimePreKeys: remaining }
  PreKeyBundleIssue.create({ requesterId, targetId, oneTimePreKeyId: oneTime?.keyId ?? null,
                             issuedBundle: bundle, expiresAt: now + 24h })
  return bundle
```

**3 · Client-side proactive top-up.** In [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts), `ensurePreKeysForUser` currently runs only at
login. Export a `topUpPreKeysIfNeeded()` and call it on app foreground and after any successful bundle
fetch that reports `remainingOneTimePreKeys < MIN_UNUSED`.

**4 · Extend `PreKeyBundleResponse`** in [keys.api.ts](chats-client/src/shared/api/keys.api.ts) with `remainingOneTimePreKeys: number`.

### Acceptance
- [ ] Two consecutive bundle requests for the same target consume **one** OPK total
- [ ] 21 distinct targets within an hour → the 21st returns 429
- [ ] Cache expires after 24h and the next request consumes a fresh OPK
- [ ] Requesting your own bundle → 400
- [ ] Depletion emits a `warn` at <10 and an `error` at 0
- [ ] Test: 100 sequential requests from one requester consume ≤ 1 OPK

### Failure modes
- The unique index on `(requesterId, targetId)` collides with `create` after TTL expiry if the TTL monitor lags (it runs every ~60s). Use `findOneAndUpdate` with `upsert: true` rather than `create`.
- Caching the bundle means the same OPK is handed out repeatedly to one requester for 24h. That is correct and intended — the OPK is single-use *per session*, and one requester establishing many sessions with the same peer is the case the cache is for.

---

## T1.5 — Rate limiting infrastructure

**Tier** CORE · **Fixes** P0-5 · **Est** 1.5d · **Depends** none · **Blocks** T1.4 · **Risk** low

### Changes

Add `express-rate-limit`, `rate-limit-redis`, `ioredis`. Create `chats-server/src/redis.ts` (a shared
client — Phase 4 reuses it for presence) and `chats-server/src/middleware/rateLimit.ts` exporting three limiters:

| Limiter | Window | Max | Applied to |
|---|---|---|---|
| `globalLimiter` | 15 min | 1000 / IP | all routes |
| `authLimiter` | 15 min | 10 / IP | `/auth/login`, `/auth/register` |
| `bundleLimiter` | 1 h | 20 / user | `/keys/bundle/*` |

Plus per-account progressive backoff on failed login, stored in Redis as
`login:fail:<userIdOrEmailHash>` → delay `min(2^failures, 300)` seconds. **Key on a hash of the email, not
the raw email** — Redis keys land in logs and dumps.

Apply `globalLimiter` in [index.ts](chats-server/src/index.ts) after `express.json()`. Set `app.set('trust proxy', 1)` — Caddy
sits in front, so without it every request appears to originate from `127.0.0.1` and rate limiting is a no-op.

### Acceptance
- [ ] 11 login attempts in 15 min from one IP → 429
- [ ] Failed logins for one account produce increasing delays
- [ ] `X-Forwarded-For` is honored (verify via Caddy, not directly)
- [ ] Limits survive a server restart (Redis-backed)
- [ ] Redis unavailable → server still boots; limiter fails **closed** on auth routes, **open** elsewhere

---

## T1.6 — Fix user search: enumeration and ReDoS

**Tier** CORE · **Fixes** P0-6 · **Est** 1d · **Depends** none · **Risk** low

### Read first
[users.routes.ts](chats-server/src/routes/users.routes.ts) — the `GET /` handler, lines 175–195

### Changes

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

usersRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit || 20), 50);   // was 50/100

  // No blanket listing: an empty query previously dumped every account with emails.
  if (q.length < 3) {
    return res.json({ items: [] });
  }

  const safe = escapeRegex(q);
  const users = await UserModel.find({
    _id: { $ne: req.userId },
    username: { $regex: `^${safe}`, $options: 'i' },   // prefix-anchored, username only
  })
    .select('_id username identitySignUpdatedAt identityDhUpdatedAt')   // email removed
    .limit(limit)
    .sort({ username: 1 });

  return res.json({
    items: users.map((u) => ({
      userId: String(u._id),
      username: u.username,
      hasPublicKey: !!(u.identitySignUpdatedAt && u.identityDhUpdatedAt),
    })),
  });
});
```

Three changes, all deliberate: **regex escaped** (kills ReDoS), **prefix-anchored on username only**
(email is no longer a search key), **email removed from the response** (kills the address harvest).

### 🛑 CHECK BEFORE CHANGING
[NewChatScreen.tsx](chats-client/src/screens/NewChatScreen.tsx) may display `peerEmail`. Grep for `email` across `chats-client/src/screens`
and `chats-client/src/store` and update the UI to show usernames only. Do not leave a broken display.

### Acceptance
- [ ] `GET /users?q=` → `{items:[]}`
- [ ] `GET /users?q=ab` → `{items:[]}` (below the 3-char minimum)
- [ ] `GET /users?q=(a%2B)%2B%24` returns promptly (< 100ms), no CPU spike
- [ ] No response body from this endpoint contains an email address
- [ ] Client search still works end to end

---

## T1.7 — Authorization on socket handlers

**Tier** CORE · **Fixes** P0-7 · **Est** 1d · **Depends** none · **Risk** low

### Read first
[setupSocket.ts](chats-server/src/socket/setupSocket.ts) — `message:delivered` (~line 588) and `message:read`

### Objective
No socket handler acts on a client-supplied identifier without verifying the caller is entitled to it.

### Changes

**`message:delivered`** — the current handler calls `findByIdAndUpdate(serverMessageId, …)` with no
ownership check. Load first, verify, then update:
```ts
const doc = await MessageModel.findById(serverMessageId);
if (!doc) return ack?.({ ok: false, error: 'Message not found' });
if (String(doc.toUserId) !== userId) {
  logger.warn({ userId, serverMessageId }, 'unauthorized message:delivered');
  return ack?.({ ok: false, error: 'Forbidden' });
}
if (doc.status === 'read') return ack?.({ ok: true });   // do not regress read → delivered
doc.status = 'delivered';
doc.deliveredAt = Date.now();
await doc.save();
```

**`message:read`** — currently accepts `conversationId` from the client and derives the peer by splitting
the string, which lets a caller emit a spoofed read receipt to an arbitrary user. Change the DTO to
`{ peerUserId }` and derive server-side:
```ts
if (!isValidObjectIdString(dto.peerUserId)) return ack?.({ ok: false, error: 'Invalid peerUserId' });
const conversationId = makeConversationId(userId, dto.peerUserId);   // server-derived — never trusted from client
```
Then the existing `updateMany({ conversationId, toUserId: userId, … })` is safe, and the notification
target is `dto.peerUserId` rather than a parsed substring.

**Audit every other handler** in the file for the same pattern: `presence:subscribe`,
`presence:unsubscribe`, `typing:start`, `typing:stop`, `message:send`. Document the check performed for each
in a comment block at the top of `setupSocket`.

**Update the client** ([messaging.ts](chats-client/src/shared/socket/messaging.ts) / [useChatE2EE.ts](chats-client/src/shared/chat/useChatE2EE.ts)) to emit `{ peerUserId }`.

> **General principle, apply everywhere: never accept a server-derivable identifier from a client.**
> `conversationId` is always `makeConversationId(callerId, peerId)`.

### Acceptance
- [ ] `message:delivered` for a message addressed to someone else → `Forbidden`, no mutation
- [ ] `message:read` with a crafted `peerUserId` cannot mark another pair's messages read
- [ ] A `read` message is not downgraded to `delivered` by a late event
- [ ] Every handler in `setupSocket.ts` has a documented authorization check
- [ ] Client and server DTOs agree; receipts still work end to end

---

## T1.8 — Password policy and input validation

**Tier** CORE · **Fixes** P0-8 · **Est** 1d · **Depends** none · **Risk** low

Create `chats-server/src/utils/validation.ts` with `validateEmail`, `validateUsername`,
`validatePassword` (min 10 chars, `zxcvbn` score ≥ 3), and `isBreachedPassword` (HaveIBeenPwned
**k-anonymity range API**: SHA-1 the password, send the first 5 hex chars only, match the remainder
locally — the full password and full hash never leave the server). Fail open on HIBP network error; never
block registration on a third-party outage.

Apply to `/auth/register` and `/auth/change-password`. Return field-level errors:
`{ error: 'Validation failed', fields: { password: '…' } }`. Add matching client-side validation in
[RegisterScreen.tsx](chats-client/src/screens/RegisterScreen.tsx) with a strength meter — **client validation is UX only; the server check is
the security boundary.**

### Acceptance
- [ ] 9-char password → 400 with a field error
- [ ] `"password123"` → 400 (zxcvbn and/or HIBP)
- [ ] Invalid email format → 400
- [ ] HIBP unreachable → registration still succeeds
- [ ] The full password and full SHA-1 never appear in an outbound request

---

## T1.9 — Remove `@ts-ignore` from auth routes

**Tier** CORE · **Fixes** P3 · **Est** 0.5d

[auth.routes.ts](chats-server/src/routes/auth.routes.ts) has `@ts-ignore` above both `jwt.sign` calls, masking an `expiresIn` type
mismatch. Fix properly:
```ts
import jwt, { type SignOptions } from 'jsonwebtoken';

const signOptions: SignOptions = {
  expiresIn: config.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  algorithm: config.JWT_ALGORITHM,
};
const accessToken = jwt.sign({ userId: String(user._id) }, config.JWT_SECRET, signOptions);
```
**Acceptance:** no `@ts-ignore` anywhere in `chats-server/src`; `npx tsc --noEmit` clean.

---

## T1.10 — Refresh tokens with rotation and reuse detection

**Tier** CORE · **Fixes** P2-1 · **Est** 1.5d · **Depends** T1.1, T1.5

Access token drops to 15 minutes (T1.1), so this must ship together with it.

**Model `RefreshToken`:** `{ userId, family (uuid), tokenHash (sha256), expiresAt, revokedAt, replacedBy, userAgent, createdAt }`.
Store **only the hash** — a database leak must not yield usable tokens.

**`POST /auth/refresh`:**
```
hash the presented token → look up
  not found            → 401
  revokedAt set        → REUSE DETECTED: revoke the entire family, 401, log at error
  expired              → 401
  valid                → issue new access + new refresh in the same family;
                         mark the old one revoked with replacedBy = new id
```
Reuse detection is the point: if a stolen token is replayed after the legitimate client has already
rotated, the whole family dies and the attacker is locked out.

**Client** ([http.ts](chats-client/src/shared/api/http.ts)): on 401, attempt refresh once, then retry the original request. **Queue
concurrent 401s** so ten parallel requests trigger one refresh, not ten. On refresh failure, clear auth
state and route to login.

### Acceptance
- [ ] Access token expires in 15 min; refresh yields a working new one
- [ ] Using a refresh token twice revokes the family and returns 401
- [ ] Ten concurrent 401s produce exactly one refresh call
- [ ] Refresh tokens are stored hashed — plaintext never in the DB
- [ ] Logout revokes the family server-side

---

## T1.11 — Repository hygiene

**Tier** CORE · **Est** 0.5d · **Risk** low

- Delete the stray root `package.json` and `node_modules` (one unrelated dependency, not part of either workspace)
- Move `1.png`, `logo.png` → `docs/assets/`
- Move `chat-backend.pem`, `my-release-key.keystore` **out of the repository tree entirely** (they are gitignored, but one `git add -f` from disaster). Document the new location in `.env.example`.
- Move all `*.md` except `README.md` into `docs/`; fix cross-links
- Delete the ~57 commented-out lines at the top of [dhRatchet.ts](chats-client/src/shared/crypto/dhRatchet.ts) and ~200 in [setupSocket.ts](chats-server/src/socket/setupSocket.ts)
- Fix [README.md](README.md): remove the email-verification claim, the tests claim, and the "history limited to the current session" claim (history *is* persisted in MongoDB)

**Acceptance:** `git grep -c "^// " chats-client/src/shared/crypto/dhRatchet.ts` → 0 for the dead block;
repo root contains only `README.md`, config files, and the three workspace directories; every claim in
`README.md` is verifiable in code.

---

# 5. PHASE 2 — TEST HARNESS AND RATCHET CORRECTNESS

**Goal:** the protocol is provably correct on every scenario in [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md).
**Duration:** ~4 weeks. **Branch:** `phase/2-protocol`.

> **Execution order is mandatory: T2.1 → T2.2 → T2.3 → T2.4, then T2.5–T2.11.**
> Do not attempt any ratchet fix before the harness exists. That ordering is the entire point of this phase —
> the defects being fixed are exactly the ones that manual testing failed to catch for months.

---

## T2.1 — Extract `packages/protocol`

**Tier** CORE · **Est** 3d · **Depends** Phase 1 complete · **Risk** high (large mechanical move)

### Objective
The protocol builds and tests in plain Node with **zero** React Native dependencies.

### Target structure
```
packages/protocol/
├── package.json          name: @velo/protocol, type: module
├── tsconfig.json         strict, noUncheckedIndexedAccess, target ES2022
├── src/
│   ├── primitives/       base64.ts encoding.ts utf8.ts kdf.ts aead.ts random.ts
│   ├── ratchet/          chain.ts root.ts dh.ts session.ts message.ts
│   ├── handshake/        x3dh.ts prekeys.ts bundle.ts
│   ├── identity/         signing.ts dh.ts fingerprint.ts
│   ├── types/            session.ts envelope.ts errors.ts
│   └── index.ts
└── test/
    ├── harness/          VirtualClient.ts Network.ts MemoryStore.ts
    ├── scenarios/        one file per checklist scenario
    ├── properties/       fast-check property tests
    └── vectors/          committed known-answer test vectors
```

### Migration map

| From | To | Note |
|---|---|---|
| `crypto/base64.ts`, `encoding.ts`, `utf8.ts` | `primitives/` | pure, move as-is |
| `crypto/kdf.ts` | `primitives/kdf.ts` | pure, move as-is |
| `crypto/ratchetChain.ts` | `ratchet/chain.ts` | pure, move as-is |
| `crypto/ratchetRoot.ts` | `ratchet/root.ts` | pure, move as-is |
| `crypto/dhRatchet.ts` | `ratchet/dh.ts` | drop the commented block; remove the `console.warn` |
| `crypto/messageV2.ts` | `ratchet/message.ts` | **must be purified — T2.2** |
| `crypto/x3dh.ts` | `handshake/x3dh.ts` | **has I/O** (keychain, network) — split |
| `crypto/sessionTypes.ts` | `types/session.ts` | apply the T1.3 type correction |
| `crypto/prekeyBundleVerify.ts` | `handshake/bundle.ts` | pure, move as-is |
| `crypto/fingerprint.ts` | `identity/fingerprint.ts` | pure |
| `storage/*` | **stays in the client** | I/O by definition |
| `crypto/prekeys.ts`, `identityKeys.ts`, `identityDhKeys.ts` | **split** | pure derivation → protocol; Keychain access → client |

### Rules
- **Do not change behavior in this task.** Pure mechanical move plus import rewiring. Any behavior change here makes the Phase 2 bisect worthless.
- The client imports from `@velo/protocol` via a path alias in `tsconfig.json` + `metro.config.js` `extraNodeModules`.
- Nothing under `packages/protocol/src` may import from `react-native`, `@react-native-*`, `AsyncStorage`, or `Keychain`. Enforce with an ESLint `no-restricted-imports` rule.

### Acceptance
- [ ] `cd packages/protocol && npx tsc --noEmit` clean
- [ ] `grep -rE "react-native|AsyncStorage|Keychain" packages/protocol/src` returns nothing
- [ ] The client builds and runs unchanged
- [ ] `git log --stat` shows renames, not delete+add (use `git mv`)
- [ ] Zero behavioral diff — no test existed before, so verify by manual two-device smoke test

---

## T2.2 — Purify the ratchet: separate crypto from I/O

**Tier** CORE · **Est** 3d · **Depends** T2.1 · **Risk** high

### The problem
[messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) currently performs storage I/O *inside* the crypto functions:
```ts
export async function encryptV2(params: {...}) {
  ...
  await putV2MessageKey({...});     // ← I/O
  await saveSession({...});         // ← I/O
}
```
Consequences: the protocol can't be tested without a device; a failed write leaves state inconsistent; and
the ProVerif model in Phase 13 has no clean function to model.

### Target signatures — synchronous, pure, no I/O

```ts
// packages/protocol/src/ratchet/message.ts

export interface DerivedKeyRecord {
  direction: 'in' | 'out';
  dhPub: string;
  n: number;
  messageKeyB64: string;
}

export interface EncryptResult {
  session: RatchetSessionV2;      // new state — caller persists
  envelope: Envelope;             // to send
  derivedKeys: DerivedKeyRecord[];// caller persists
}

export interface DecryptResult {
  session: RatchetSessionV2;
  plaintext: string;
  derivedKeys: DerivedKeyRecord[];
  consumedSkippedKeyId: string | null;
}

/** Pure. No I/O, no async. Throws a typed ProtocolError on failure. */
export function ratchetEncrypt(session: RatchetSessionV2, plaintext: string): EncryptResult;

/** Pure. No I/O, no async. Throws a typed ProtocolError on failure. */
export function ratchetDecrypt(session: RatchetSessionV2, envelope: Envelope): DecryptResult;
```

### Caller adapter — client side only

Create `chats-client/src/shared/chat/ratchetAdapter.ts`:
```ts
export async function encryptAndPersist(params: {
  myUserId: string; peerUserId: string; session: RatchetSessionV2; plaintext: string;
}): Promise<{ envelope: Envelope; session: RatchetSessionV2 }> {
  const result = ratchetEncrypt(params.session, params.plaintext);   // throws before any write

  // Persist only after the pure step succeeds. Keys first: a key without a saved session
  // is harmless; a saved session without its keys loses history.
  for (const k of result.derivedKeys) {
    await putV2MessageKey({ myUserId: params.myUserId, peerUserId: params.peerUserId, ...k });
  }
  await saveSession({ myUserId: params.myUserId, peerUserId: params.peerUserId, session: result.session });

  return { envelope: result.envelope, session: result.session };
}
```
Mirror for `decryptAndPersist`. **Critical: on a `ratchetDecrypt` throw, persist nothing** — this is R7,
and it is what prevents a forged message from corrupting a live session.

### Acceptance
- [ ] `ratchetEncrypt` / `ratchetDecrypt` are synchronous and contain no `await`
- [ ] `grep -rE "AsyncStorage|Keychain|putV2MessageKey|saveSession" packages/protocol/src` → nothing
- [ ] A failed decrypt leaves the passed-in session object untouched (verify by deep-equal before/after)
- [ ] The app still sends and receives (manual smoke)
- [ ] `npx tsc --noEmit` clean in both packages

---

## T2.3 — Typed error taxonomy

**Tier** CORE · **Est** 1d · **Depends** T2.1

Implement the eight categories from [ROADMAP.md](ROADMAP.md) §9.4 as a discriminated union in
`packages/protocol/src/types/errors.ts`:

```ts
export type ProtocolErrorCode =
  | 'MISSING_BOOTSTRAP' | 'NO_SESSION'        | 'STALE_SESSION'  | 'DECRYPT_FAILED'
  | 'REPLAY_DETECTED'   | 'UNKNOWN_OLD_MESSAGE' | 'SEND_FAILED' | 'STORAGE_CORRUPTION'
  | 'TOO_MANY_SKIPPED'  | 'HEADER_TAMPERED'   | 'INVALID_KEY_LENGTH' | 'SESSION_RESET_REQUIRED';

export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly context?: Record<string, string | number | boolean>,   // NEVER key material (R3)
    readonly recoverable: boolean = false,
  ) { super(message); this.name = 'ProtocolError'; }
}
```

Replace every `throw new Error(...)` in `packages/protocol`. Map each code to a user-facing string in the
client. `SESSION_RESET_REQUIRED` must surface the existing [ChatReset](chats-client/src/components/ChatReset.tsx) affordance.

**Acceptance:** zero bare `throw new Error` in `packages/protocol/src`; every code has a UI mapping and a
test that reaches its throw site.

---

## T2.4 — Build the protocol test harness

**Tier** CORE · **Est** 5d · **Depends** T2.2, T2.3 · **Risk** medium

**This is the most important task in the entire roadmap.** It converts 22 manual two-device rituals that
have never been performed into automated tests that run in seconds.

### `MemoryStore` — in-memory replacements for AsyncStorage and Keychain, synchronous, inspectable.

### `VirtualClient`
```ts
class VirtualClient {
  constructor(readonly userId: string, private store = new MemoryStore()) {}

  async register(): Promise<PublishedKeys>;        // identity keys + signed prekey + N one-time prekeys
  async startSession(peer: PublishedKeys): Promise<void>;   // X3DH initiate
  send(plaintext: string): Envelope;               // pure; caller routes via Network
  receive(envelope: Envelope): string;             // pure; throws ProtocolError
  serialize(): string;                             // for restart simulation
  static restore(userId: string, blob: string): VirtualClient;
  get sessionState(): Readonly<RatchetSessionV2>;  // white-box assertions
}
```

### `Network` — the adversary
```ts
class Network {
  deliver(env: Envelope): void;
  hold(tag: string): void;                     // delay indefinitely
  release(tag: string): void;                  // deliver a held message
  reorder(...tags: string[]): void;
  duplicate(tag: string): void;
  drop(tag: string): void;
  tamper(tag: string, mutate: (e: Envelope) => Envelope): void;   // for T2.5 tests
  partition(clientId: string, durationMs: number): void;
}
```

### Scenario suite — one file per row. Every one maps to a checklist item.

| # | Scenario | Checklist ref | Expected today |
|---|---|---|---|
| S01 | New chat, first message | §4.1 | pass |
| S02 | First reply | §4.2 | pass |
| S03 | 5 messages each direction | §4.3 | pass |
| S04 | Reorder **within** an epoch | §6.2 | pass |
| S05 | **Reorder across a DH ratchet** | §6.2 | **FAIL — T2.7, T2.8** |
| S06 | Restart one side | §5.2 | pass |
| S07 | Restart both sides | §5.3 | pass |
| S08 | Receiver offline for the first message | §6.1 | pass |
| S09 | Delayed history load | §6.3 | pass |
| S10 | Wipe one client, reset, recover | §7.1–7.2 | pass |
| S11 | Duplicate delivery | — | pass |
| S12 | `header.n = 10_000_000` | — | **FAIL/HANG — T2.6** |
| S13 | Tampered `dhPub` | — | **FAIL — T2.5** |
| S14 | Tampered `n` / `pn` | — | **FAIL — T2.5** |
| S15 | One-time prekeys exhausted | — | pass |
| S16 | 1000-message conversation | — | check storage bounds |
| S17 | Both sides send simultaneously (ratchet race) | — | verify |
| S18 | Message from an unknown epoch | — | typed error |

**Write all 18 first. Six must fail.** A red suite that pinpoints exactly the defects in
[PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §3.2 is the correct starting state — it proves the harness works.

### Acceptance
- [ ] All 18 scenarios implemented
- [ ] S05, S12, S13, S14 fail with a clear diagnostic (S12 must **time out**, not hang the runner — set a 5s per-test limit)
- [ ] Suite runs in < 30s
- [ ] Zero React Native dependencies; runs under plain `node`
- [ ] Coverage of `packages/protocol/src/ratchet` ≥ 90% before any fix

---

## T2.5 — Authenticate the message header

**Tier** CORE · **Fixes** P1-1 · **Est** 2d · **Depends** T2.4 · **Risk** high · **Breaks wire format**

### Read first
[messageV2.ts](chats-client/src/shared/crypto/messageV2.ts) lines 60–80 · §8.1 · §8.2

### Why
`nacl.secretbox` covers the plaintext only. `header.{n,pn,dhPub}` are unauthenticated, and
`ratchetDecrypt` acts on them *before* decryption. A malicious server can flip them.

### Canonical header serialization — R4 applies: no `JSON.stringify`

```ts
// packages/protocol/src/ratchet/header.ts
import { decodeBase64 } from '../primitives/base64';

/**
 * Canonical, deterministic header encoding used as AEAD associated data.
 * Layout:  u8 version | u32be dhPubLen | dhPub bytes | u32be n | u32be pn
 * Fixed field order and explicit lengths — never JSON (R4).
 */
export function canonicalHeaderBytes(h: V2Header, protoVersion = 3): Uint8Array {
  const dhPub = decodeBase64(h.dhPub);
  if (dhPub.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'dhPub must be 32 bytes', { got: dhPub.length });
  }
  const out = new Uint8Array(1 + 4 + dhPub.length + 4 + 4);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o] = protoVersion;                 o += 1;
  dv.setUint32(o, dhPub.length, false);  o += 4;
  out.set(dhPub, o);                     o += dhPub.length;
  dv.setUint32(o, h.n, false);           o += 4;
  dv.setUint32(o, h.pn, false);
  return out;
}
```

### Sealing and opening — decision D3

**If D3 = A (keep `secretbox`, prefix the AD):**
```ts
// seal
const ad = canonicalHeaderBytes(header);
const sealed = nacl.secretbox(concat(ad, utf8Encode(plaintext)), nonce, messageKey);

// open
const opened = nacl.secretbox.open(sealed, nonce, messageKey);
if (!opened) throw new ProtocolError('DECRYPT_FAILED', 'secretbox.open failed');

const expected = canonicalHeaderBytes(receivedHeader);
if (!nacl.verify(opened.subarray(0, expected.length), expected)) {
  throw new ProtocolError('HEADER_TAMPERED', 'header does not match authenticated copy');
}
const plaintext = utf8Decode(opened.subarray(expected.length));
```

> **Why the comparison is required even though the MAC already covers the AD.** The tag authenticates the
> *embedded* copy. An attacker can still alter the *transmitted* header while leaving the embedded copy
> intact. Without the comparison, the receiver would advance counters and ratchet according to the forged
> header, then decrypt successfully — acting on data that was never authenticated. The comparison is what
> binds the two. Use `nacl.verify` (constant-time), never `===` (R5).

**If D3 = B (XChaCha20-Poly1305):** add `@noble/ciphers` (approved extension to the crypto set) and use
`xchacha20poly1305(key, nonce, ad)` with the canonical bytes as real AD. Cleaner, and it sets up header
encryption in T3.1 more naturally.

### Wire format
Bump `protoVersion` to **3**. Server validator accepts 3 only. **All existing sessions and stored messages
become undecryptable** — acceptable per [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) §1 (development mode, disposable
data), but say so explicitly in the commit's `Breaking:` trailer.

### Acceptance
- [ ] S13 (tampered `dhPub`) passes — throws `HEADER_TAMPERED`
- [ ] S14 (tampered `n`/`pn`) passes — throws `HEADER_TAMPERED`
- [ ] S01–S04, S06–S11 still pass
- [ ] `canonicalHeaderBytes` is byte-identical across 1000 randomized round-trips
- [ ] No `JSON.stringify` on any authenticated path
- [ ] Comparison uses `nacl.verify`
- [ ] §8.2 updated with wire format v3

---

## T2.6 — Bound the skipped-key derivation

**Tier** CORE · **Fixes** P1-2 · **Est** 1d · **Depends** T2.4 · **Risk** low

[messageV2.ts:156](chats-client/src/shared/crypto/messageV2.ts#L156) — `while (nr <= targetN)` runs on attacker-controlled `header.n`.
`MAX_SKIP = 50` bounds only the in-memory map, not the loop or its per-iteration storage write.

**Client:** before any derivation,
```ts
const gap = targetN - session.Nr;
if (gap > MAX_SKIP_PER_STEP) {
  throw new ProtocolError('TOO_MANY_SKIPPED', 'message number too far ahead', { gap }, true);
}
```
Constants in `packages/protocol/src/ratchet/constants.ts`:
```ts
export const MAX_SKIP_PER_STEP = 100;    // derivations in one skip operation
export const MAX_SKIP_TOTAL    = 1000;   // stored skipped keys per session
export const MAX_SKIP_EPOCHS   = 5;      // distinct dhPub epochs retained
export const MAX_MESSAGE_NUMBER = 2 ** 24;
```

**Server:** [setupSocket.ts](chats-server/src/socket/setupSocket.ts) currently validates only `n >= 0`. Add
`n < MAX_MESSAGE_NUMBER && pn < MAX_MESSAGE_NUMBER && n >= 0 && pn >= 0`. Defense in depth — the client
must not trust the server, and the server should not relay obviously malicious payloads.

### Acceptance
- [ ] S12 passes in < 50ms with `TOO_MANY_SKIPPED`
- [ ] A legitimate gap of 99 still decrypts
- [ ] A gap of 101 throws
- [ ] Server rejects `n = 10_000_000` at the socket boundary
- [ ] No regression in S01–S11

---

## T2.7 — Stop destroying skipped keys on ratchet

**Tier** CORE · **Fixes** P1-3 · **Est** 2d · **Depends** T2.6 · **Risk** medium

### The bug
[dhRatchet.ts:150](chats-client/src/shared/crypto/dhRatchet.ts#L150) sets `skippedKeys: {}` on every ratchet step. Any message delayed across
an epoch boundary becomes permanently undecryptable and is reported as `Replay or unknown old message`.
This fires under ordinary mobile packet reordering — **users are losing messages right now.**

### The fix is smaller than it looks
The skipped-key IDs are *already* epoch-namespaced: `skippedKeyId()` returns `` `${dhPub}:${n}` ``
([messageV2.ts:19](chats-client/src/shared/crypto/messageV2.ts#L19)). So simply **stop clearing the map** and add bounded eviction instead.

In `ratchet/dh.ts`, delete `skippedKeys: {}` from the returned object (carry the existing map forward).
Then add to `ratchet/session.ts`:

```ts
/**
 * Bounded eviction. Skipped keys are namespaced `${dhPub}:${n}`, so keys from
 * distinct DH epochs coexist safely. Evict oldest-epoch-first, then lowest-n
 * within an epoch, so recent out-of-order messages survive longest.
 */
export function pruneSkippedKeys(session: RatchetSessionV2): RatchetSessionV2 {
  const skipped = session.skippedKeys ?? {};
  const ids = Object.keys(skipped);
  if (ids.length <= MAX_SKIP_TOTAL) {
    const epochs = new Set(ids.map((id) => id.slice(0, id.lastIndexOf(':'))));
    if (epochs.size <= MAX_SKIP_EPOCHS) return session;
  }
  // insertion order of Object.keys is stable for string keys in V8/Hermes,
  // but do NOT rely on it — carry an explicit epoch order list on the session.
  ...
}
```

> **Important:** do not rely on JS object key ordering for eviction. Add
> `skippedEpochOrder: string[]` to `RatchetSessionV2` recording `dhPub` values in the order first seen,
> and evict from the front. Deterministic eviction is testable; implicit ordering is not.

### Acceptance
- [ ] S05 (reorder across a DH ratchet) **passes**
- [ ] A message from 2 epochs back still decrypts (within `MAX_SKIP_EPOCHS`)
- [ ] A message from 6 epochs back throws `UNKNOWN_OLD_MESSAGE` (not a crash)
- [ ] Stored skipped keys never exceed `MAX_SKIP_TOTAL`
- [ ] S16 (1000 messages) shows bounded storage
- [ ] Eviction is deterministic — the same interleaving always evicts the same keys

---

## T2.8 — Implement `skipMessageKeys(header.pn)`

**Tier** CORE · **Fixes** P1-4 · **Est** 2d · **Depends** T2.7 · **Risk** high

### The bug
`header.pn` ("previous chain length") is transmitted and stored but **never read**. The Double Ratchet
requires that on detecting a DH ratchet you first derive and retain the remaining keys of the *old*
receiving chain — indices `Nr` through `pn-1` — before switching chains. Without it, in-flight
previous-epoch messages have no derivable key even after T2.7 preserves the map.

### Corrected algorithm — implement exactly as written in §8.1

The critical ordering, which the current code gets wrong:
```
1. skipped-key fast path
2. if dhPub changed:
     a. skipMessageKeys(OLD chain, up to header.pn)     ← MISSING TODAY
     b. applyDhRatchet(newDhPub)
3. skipMessageKeys(CURRENT chain, up to header.n)
4. derive the message key at n
5. decrypt and verify the header AD          ← authentication happens HERE
6. commit state                              ← mutation happens only AFTER step 5
```

**The null case.** A session freshly created by `createSessionFromX3DH` has `DHrPublicKey: null` and both
chains derived from the X3DH output via HKDF split — this is `DEVIATION-1`, not standard Double Ratchet.
On the first inbound message, adopt `header.dhPub` **without ratcheting and without skipping an old
chain** (there is no old chain). Getting this wrong breaks every new conversation, so cover it explicitly
in S01.

### Acceptance
- [ ] S05 passes with messages from **both** sides of the boundary
- [ ] S17 (simultaneous send / ratchet race) passes
- [ ] S01 (fresh session, first inbound) still passes — the null branch is correct
- [ ] `pn` is read in exactly one place
- [ ] A `pn` gap over `MAX_SKIP_PER_STEP` throws `TOO_MANY_SKIPPED`, not a hang
- [ ] Property test: any interleaving of 20 messages with arbitrary delay/reorder → each decrypts exactly once or is explicitly rejected (10,000 generated cases)

---

## T2.9 — Add the missing X3DH DH

**Tier** CORE · **Fixes** P1-5 · **Est** 1d · **Depends** T2.4 · **Risk** medium · **Breaks handshake**
**🛑 Requires decision D2 before starting.**

### Current state
[x3dh.ts:60-73](chats-client/src/shared/crypto/x3dh.ts#L60-L73) computes three DHs in a non-standard order:
`EK×SPK`, `(EK×OPK)`, `IK_A×SPK`. Missing: `EK_A × IK_B` — the initiator's ephemeral against the
responder's identity key.

### If D2 = fix (recommended)

Adopt the specification's canonical order so the Phase 13 ProVerif model maps to published analyses:
```
IKM = DH1 || DH2 || DH3 [|| DH4]
  DH1 = DH(IK_A, SPK_B)      initiator identity  × responder signed prekey
  DH2 = DH(EK_A, IK_B)       initiator ephemeral × responder identity      ← ADD
  DH3 = DH(EK_A, SPK_B)      initiator ephemeral × responder signed prekey
  DH4 = DH(EK_A, OPK_B)      initiator ephemeral × responder one-time key (if present)
```

Initiator (`x3dhInitiate`) — `bundle.identityDhPublicKey` is already returned by
[keys.routes.ts](chats-server/src/routes/keys.routes.ts), so the input exists:
```ts
const dh1 = nacl.scalarMult(myIdentityDhSk, spkPub);
const dh2 = nacl.scalarMult(eph.secretKey, decodeBase64(bundle.identityDhPublicKey));   // NEW
const dh3 = nacl.scalarMult(eph.secretKey, spkPub);
const dhParts = [dh1, dh2, dh3];
if (bundle.oneTimePreKey) dhParts.push(nacl.scalarMult(eph.secretKey, opkPub));
```

Responder (`x3dhRespond`) — needs its own identity DH secret. `getIdentityDhSecretKeyBytesForUser` is
**already imported** in [x3dh.ts](chats-client/src/shared/crypto/x3dh.ts) but unused in this function:
```ts
const myIdentityDhSk = await getIdentityDhSecretKeyBytesForUser(params.myUserId);
const dh1 = nacl.scalarMult(spkSk, initiatorIdentityDhPub);
const dh2 = nacl.scalarMult(myIdentityDhSk, ephPub);        // NEW — mirrors initiator dh2
const dh3 = nacl.scalarMult(spkSk, ephPub);
const dhParts = [dh1, dh2, dh3];
if (initPacket.oneTimePreKeyId !== null) dhParts.push(nacl.scalarMult(opkSk, ephPub));
```

Bump the HKDF info string: `INFO_X3DH_V1` → `INFO_X3DH_V2` (`"x3dh-v2"`). Optionally prepend 32 `0xFF`
bytes to the IKM for full spec fidelity — if you do, document it.

**Both sides must change in the same commit.** A partial rollout produces silent key-agreement failure
that looks like a decrypt bug.

### If D2 = document
Leave the code alone. Add `DEVIATION-2` to §8.5 and a section in [SESSION_ESTABLISHMENT_POLICY.md](SESSION_ESTABLISHMENT_POLICY.md) stating
precisely which property is weakened and why the signed-prekey signature is considered sufficient.

### Acceptance
- [ ] Initiator and responder derive byte-identical `rootKey` and `chainKey` (assert in the harness)
- [ ] Works with and without a one-time prekey
- [ ] S01, S02, S08, S15 pass
- [ ] Committed test vectors updated
- [ ] §8.5 records the decision either way

---

## T2.10 — Signed prekey rotation

**Tier** CORE · **Fixes** P1-6 · **Est** 2d · **Depends** T2.4

Store `createdAt` alongside the SPK in [prekeys.ts](chats-client/src/shared/crypto/prekeys.ts). Rotate when older than 7 days. Retain the
previous SPK for 30 days keyed by `signedPreKeyId` so in-flight handshakes still resolve — the init packet
already carries `signedPreKeyId`, and `getSignedPreKeySecretBytesForUser` must become
`getSignedPreKeySecretBytesForKeyId(userId, keyId)`.

Server: [keys.routes.ts](chats-server/src/routes/keys.routes.ts) `/bundle/:userId` already sorts by `createdAt: -1` and returns the newest —
no change needed there, but stop pruning old signed prekeys server-side within the grace window.

### Acceptance
- [ ] SPK older than 7 days rotates on next `ensurePreKeysForUser`
- [ ] A handshake referencing an SPK from 20 days ago still completes
- [ ] An SPK older than 30 days is deleted, and a handshake against it fails with a typed error
- [ ] Rotation does not break existing sessions (they no longer depend on the SPK)

---

## T2.11 — Message key retention policy

**Tier** CORE · **Fixes** P1-7 · **Est** 2d · **Depends** T2.4

Today `putV2MessageKey` is called for every message in both directions, including every skipped key
regardless of `MAX_SKIP`, and nothing is ever pruned. Storage grows without bound and forward secrecy is
surrendered for all history rather than a window.

Add `RETENTION_DAYS = 30` and `MAX_KEYS_PER_CONVERSATION = 1000`. Extend the storage key with a timestamp
(or keep a per-conversation index), implement `pruneMessageKeys()`, call it on app foreground, and surface
the window in [SettingsScreen.tsx](chats-client/src/screens/SettingsScreen.tsx) under the encryption section.

**Document the tradeoff in the threat model** — "Velo provides forward secrecy beyond a 30-day window;
within the window, local history is recoverable by design to support offline rendering." That is a
legitimate position, stated honestly.

### Acceptance
- [ ] Keys older than 30 days are removed on foreground
- [ ] Per-conversation key count never exceeds 1000
- [ ] Pruning never removes a key still referenced by a rendered message
- [ ] S16 shows bounded storage growth
- [ ] The window is visible and explained in Settings

---

## T2.12 — Run the full stabilization checklist

**Tier** CORE · **Est** 2d · **Depends** T2.5–T2.11 · **🛑 Requires a human with two devices**

Automated scenarios cover the protocol; this validates the *integration* — real network, real storage,
real push, real app lifecycle.

Produce a filled-in [V2_STABILIZATION_CHECKLIST.md](V2_STABILIZATION_CHECKLIST.md) with all 22 boxes ticked and §12 Working Notes
completed. Any failure becomes a new task before Phase 3 opens.

### Acceptance
- [ ] 22/22 checklist boxes ticked with evidence
- [ ] §12 filled in: date, scenarios run, failures, fixes, retest results
- [ ] [ROADMAP.md](ROADMAP.md) Block 1 marked genuinely complete
- [ ] [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §3.2 shows every P1 resolved

---

# 6. PHASE 3 — PROTOCOL HARDENING

**Duration** ~3 weeks · **Branch** `phase/3-hardening` · **Gate:** Phase 2 fully green.

| Task | Objective | Est | Notes |
|---|---|---|---|
| **T3.1** | Header encryption (P1-8) | 5d | `HKs`/`NHKs` from the root KDF; receiver trial-decrypts against current then next header key. Prerequisite for sealed sender. Wire format **v4**. |
| **T3.2** | Migrate to XChaCha20-Poly1305 | 3d | Only if D3 = B and not already done in T2.5. `@noble/ciphers`. Real AD, no prefix trick. |
| **T3.3** | Protocol version negotiation | 2d | Explicit `supportedVersions` in the bundle; graceful downgrade refusal. You *will* need v5. |
| **T3.4** | Key zeroization audit | 2d | `fill(0)` every derived key after use; audit every place a key is copied or serialized. |
| **T3.5** | Explicit replay window | 2d | Bounded, typed rejection. Distinguish "replay" from "unknown old message" — today they share a message. |
| **T3.6** | PQ-readiness refactor | 2d | Restructure the handshake so a KEM shared secret can be concatenated into the IKM without another breaking change. Enables Phase 11 Option A cheaply. |

**Phase gate:** wire format v4 stable; header contents opaque to the server; all Phase 2 scenarios still
green; a documented extension point for PQXDH.

---

# 7. PHASE 4 — PRODUCTION INFRASTRUCTURE

**Duration** ~3 weeks · **Branch** `phase/4-infra`

| Task | Objective | Est |
|---|---|---|
| **T4.1** | `tsc` build → `dist/`; drop `nodemon` in production | 1d |
| **T4.2** | systemd or pm2; graceful shutdown; restart-on-crash | 1d |
| **T4.3** | Redis-backed presence + socket.io adapter (P2-4) — removes the single-process ceiling | 3d |
| **T4.4** | Structured logging with `pino`; correlation IDs; **zero key material** (R3) | 2d |
| **T4.5** | Prometheus + Grafana: delivery latency, decrypt failure rate, prekey depletion, ratchet-step rate | 3d |
| **T4.6** | GitHub Actions: typecheck, lint, protocol tests, coverage gate, `gitleaks`, both platform builds | 3d |
| **T4.7** | Error taxonomy wired into the UI (P2-8) — every `ProtocolErrorCode` maps to a distinct, actionable message | 2d |
| **T4.8** | Compound `(createdAtClient, _id)` pagination cursor (P2-6) — current cursor uses a **client-supplied** timestamp | 1d |
| **T4.9** | Automated Mongo backups + a **rehearsed** restore drill | 2d |
| **T4.10** | Certificate pinning + documented rotation procedure | 2d |
| **T4.11** | Rewrite [architecture.md](architecture.md) to match reality (it describes a layering the code does not have) | 1d |

**Phase gate:** deploy, restart, and roll back without losing sessions or presence; dashboard live; CI
blocks a merge that breaks protocol tests.

---

# 8. REFERENCE

## 8.1 Corrected ratchet algorithm — normative

Implement `ratchetDecrypt` exactly as follows. Deviations require a `DEVIATION-n` entry.

```
ratchetDecrypt(session, envelope) -> { session, plaintext, derivedKeys }

  header := envelope.header
  work   := clone(session)              // never mutate the input (R7)

  // ─── 1. Skipped-key fast path ────────────────────────────────────────────
  id := skippedKeyId(header.dhPub, header.n)
  if work.skippedKeys[id] exists:
      mk        := work.skippedKeys[id]
      plaintext := aeadOpen(mk, envelope.nonce, envelope.ciphertext, AD(header))
      if plaintext is null: throw DECRYPT_FAILED         // do not delete the key
      delete work.skippedKeys[id]
      return { work, plaintext, [] }

  // ─── 2. DH ratchet if the peer key changed ───────────────────────────────
  if work.DHrPublicKey is null:
      // Fresh X3DH session: both chains came from the HKDF split (DEVIATION-1).
      // Adopt the peer key; there is no previous chain to drain.
      work.DHrPublicKey := header.dhPub

  else if work.DHrPublicKey != header.dhPub:
      // Drain the OLD receiving chain up to pn before switching. (T2.8)
      work := skipMessageKeys(work, work.DHrPublicKey, header.pn)
      work := applyDhRatchet(work, header.dhPub)          // must NOT clear skippedKeys (T2.7)

  // ─── 3. Fill the gap on the CURRENT receiving chain ──────────────────────
  work := skipMessageKeys(work, header.dhPub, header.n)

  // ─── 4. Derive the target message key ────────────────────────────────────
  assert work.Nr == header.n                              // guaranteed by step 3
  { mk, nextCk } := chainKdf(work.chainKeyRecv)

  // ─── 5. Authenticate. NOTHING above this line may be persisted. ──────────
  plaintext := aeadOpen(mk, envelope.nonce, envelope.ciphertext, AD(header))
  if plaintext is null: throw DECRYPT_FAILED
  // AD comparison happens inside aeadOpen; see T2.5

  // ─── 6. Commit ───────────────────────────────────────────────────────────
  work.chainKeyRecv := nextCk
  work.Nr           := header.n + 1
  work              := pruneSkippedKeys(work)
  return { work, plaintext, derivedKeys }


skipMessageKeys(session, dhPub, until) -> session
  if until <= session.Nr: return session
  gap := until - session.Nr
  if gap > MAX_SKIP_PER_STEP: throw TOO_MANY_SKIPPED(gap)     // (T2.6)

  ck := session.chainKeyRecv
  for n from session.Nr to until - 1:
      { mk, nextCk } := chainKdf(ck)
      session.skippedKeys[skippedKeyId(dhPub, n)] := mk
      ck := nextCk
  session.chainKeyRecv := ck
  session.Nr           := until
  return session
```

**Why the step 5 / step 6 boundary matters.** Steps 2–4 mutate a *local copy* driven by unauthenticated
header data. If an attacker forges a header, the work is wasted but nothing is persisted, because the
caller (`decryptAndPersist`, T2.2) only writes on a successful return. The `MAX_SKIP_PER_STEP` guard
bounds the wasted work. Persisting before step 5 would let any attacker desynchronize a live session with
a single forged packet.

## 8.2 Wire format history

| Ver | Status | Envelope | Introduced |
|---|---|---|---|
| 1 | removed | legacy shared-secret | pre-history |
| 2 | **current** | `{header:{n,pn,dhPub}, nonce, ciphertext}` — header unauthenticated | Open Beta 0.1 |
| 3 | T2.5 | header bound as AEAD associated data | Phase 2 |
| 4 | T3.1 | header encrypted under `HKs`/`NHKs` | Phase 3 |

Every bump: update this table, the server validator in [setupSocket.ts](chats-server/src/socket/setupSocket.ts), the `protoVersion` default in
[Message.ts](chats-server/src/models/Message.ts), and [protocolPolicy.ts](chats-client/src/shared/crypto/protocolPolicy.ts).

## 8.3 Error code → user message mapping

| Code | User-facing | Recoverable | Action offered |
|---|---|---|---|
| `MISSING_BOOTSTRAP` | "Waiting for secure session…" | yes | auto-retry |
| `NO_SESSION` | "Setting up encryption…" | yes | auto |
| `STALE_SESSION` | "Secure session needs refreshing" | yes | Reset button |
| `DECRYPT_FAILED` | "This message couldn't be decrypted" | no | Reset button |
| `REPLAY_DETECTED` | *(silent — drop)* | n/a | log only |
| `UNKNOWN_OLD_MESSAGE` | "Older message unavailable" | no | none |
| `SEND_FAILED` | "Not sent — tap to retry" | yes | Retry |
| `STORAGE_CORRUPTION` | "Local data problem" | no | Reset local state |
| `TOO_MANY_SKIPPED` | "Too many missed messages" | yes | Reset button |
| `HEADER_TAMPERED` | **"Security warning: message was modified in transit"** | no | **prominent warning + verify contact** |
| `INVALID_KEY_LENGTH` | "Invalid key data" | no | Reset |
| `SESSION_RESET_REQUIRED` | "Secure session must be reset" | yes | Reset button |

`HEADER_TAMPERED` is the only code that should produce a *security* warning rather than a technical one —
it is the sole indicator of active tampering, and users must be able to distinguish it from a bug.

## 8.4 Test scenario catalog

Canonical list in T2.4. Each scenario file must state which checklist row it automates, which defect it
covers, and its expected state before and after the fix.

## 8.5 Deviation register

Every intentional divergence from the reference specification. Phase 13's formal model must account for
each one.

| ID | Deviation | Rationale | Status |
|---|---|---|---|
| `DEVIATION-1` | X3DH output is HKDF-split into two directional chain keys rather than starting Alice with an immediate DH ratchet against Bob's signed prekey | Simplifies bootstrap; both sides derive mirrored chains deterministically via `isInitiator` | **Active** — model in Phase 13 |
| `DEVIATION-2` | X3DH omits `DH(EK_A, IK_B)` | — | **Resolve in T2.9** (decision D2) |
| `DEVIATION-3` | Message keys retained for 30 days to support offline history rendering | Product requirement; bounded rather than unbounded | Active after T2.11 |
| `DEVIATION-4` | Skipped keys bounded by count *and* epoch, not by the spec's simple `MAX_SKIP` | DoS resistance with multi-epoch reorder tolerance | Active after T2.7 |

## 8.6 Glossary

**IK** identity key (long-term) · **SPK** signed prekey (medium-term, rotating) · **OPK** one-time prekey ·
**EK** ephemeral key (per handshake) · **RK** root key · **CK** chain key · **MK** message key ·
**DHs/DHr** self/remote ratchet key pair · **Ns/Nr** send/receive counter in the current chain ·
**PN** length of the previous sending chain · **epoch** the span of one `dhPub` value ·
**AD** associated data — authenticated but not encrypted.

---

# 9. TASK INDEX AND DEPENDENCY GRAPH

```
PHASE 1 ── all parallel except where noted
  T1.1 secrets            ──┐
  T1.2 TLS                  │
  T1.3 session-at-rest      │
  T1.5 rate-limit infra ──► T1.4 prekey drain
  T1.6 search fix           │
  T1.7 socket authz         │
  T1.8 password policy      │
  T1.9 ts-ignore            │
  T1.1 + T1.5 ───────────► T1.10 refresh tokens
  T1.11 hygiene           ──┘
                            ▼
PHASE 2 ── strictly sequential through T2.4
  T2.1 extract package
    └► T2.2 purify
         └► T2.3 errors
              └► T2.4 HARNESS  ★ nothing below may start before this
                   ├► T2.5 header auth   (wire v3)
                   ├► T2.6 bound skip
                   │    └► T2.7 keep skipped keys
                   │         └► T2.8 skipMessageKeys(pn)
                   ├► T2.9  4th DH        (needs D2)
                   ├► T2.10 SPK rotation
                   └► T2.11 key retention
                        └► T2.12 manual checklist  🛑 human
                             ▼
PHASE 3 ── T3.1 … T3.6      (T3.1 blocks Phase 11 sealed sender)
PHASE 4 ── T4.1 … T4.11     (T4.6 CI should land early; it protects everything after)
```

## 9.1 Suggested execution order

1. **T1.1, T1.2** — the two defects that invalidate the project's premise. Nothing else matters until these are closed.
2. **T1.5 → T1.4, T1.6, T1.7, T1.8, T1.9** — the remaining P0s, mostly parallel.
3. **T1.3, T1.10, T1.11** — completes Phase 1.
4. **T2.1 → T2.2 → T2.3 → T2.4** — strictly sequential. Do not shortcut.
5. **T2.5–T2.11** — with the harness catching every mistake. Land T2.6 before T2.7, and T2.7 before T2.8 (T2.8's correctness depends on the map surviving the ratchet).
6. **T2.12** — human gate. Phase 3 does not open until 22/22.
7. **T4.6 (CI) early**, out of order, as soon as T2.4 exists — it protects everything after it.

## 9.2 Per-task reporting template

```
TASK:        T2.7
STATUS:      complete | blocked | partial
BRANCH:      task/T2.7-preserve-skipped-keys
COMMITS:     <sha> …

ACCEPTANCE
  [x] S05 passes
  [x] 2-epoch-old message decrypts
  [x] 6-epoch-old message throws UNKNOWN_OLD_MESSAGE
  [x] skipped keys bounded by MAX_SKIP_TOTAL
  [ ] S16 storage bound — DEFERRED, see below

COMMANDS RUN
  $ cd packages/protocol && npm test        → 18 passed, 0 failed (4.2s)
  $ npx tsc --noEmit                        → clean
  $ npm run test:coverage                   → ratchet/ 94% branch

FILES CHANGED
  packages/protocol/src/ratchet/dh.ts        -1  +0
  packages/protocol/src/ratchet/session.ts   +38
  packages/protocol/src/types/session.ts     +2
  packages/protocol/test/scenarios/s05.test.ts +61

DEFERRED / BLOCKED
  S16 storage assertion needs T2.11 pruning to exist. Tracked, not silently dropped.

DOCS UPDATED
  PROJECT_ROADMAP.md §3.2 — P1-3 marked resolved
  AGENT_EXECUTION_SPEC.md §8.5 — DEVIATION-4 added
```

---

# 10. FINAL NOTES FOR THE IMPLEMENTING AGENT

**The single most important thing in this document is the ordering constraint in Phase 2.** The defects
T2.5–T2.11 fix have survived months of manual testing precisely because manual testing cannot reliably
reproduce cross-epoch packet reordering. If you fix the ratchet before building the harness, you will not
know whether you fixed it, and you will have burned the one opportunity to prove it.

**When something is ambiguous, prefer the interpretation that fails loudly.** This codebase has a history
of silent degradation: `normalizeB64` quietly repairing corrupt base64, skipped keys quietly discarded,
`@ts-ignore` quietly hiding a type error, a prekey pool quietly draining. Each was a small convenience that
turned a detectable failure into an undetectable one. Prefer a typed error over a fallback, every time.

**When you find something not in this document, add it.** This spec was written from a static reading of
the code at commit `c9c9267`. Runtime behavior will reveal things a read cannot. New defects go into
[PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) §3 with a P-number; new deviations go into §8.5 here; new scenarios go into T2.4's
catalog.

---

*Spec version 1.0 · Companion to [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) · Update §8.2 on every wire change and §8.5 on every deviation.*
