# Velo — Secure Messenger

An end-to-end encrypted messenger built with React Native and Node.js. Identity is a username and an email address — no phone number, no contact upload. The server relays and briefly stores ciphertext; it never sees message bodies.

![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-blue) ![License](https://img.shields.io/badge/license-ISC-green) ![Status](https://img.shields.io/badge/status-open%20beta%200.1%20%2B%20phase%201-orange)

> **Status.** Open Beta 0.1 with the Phase 1 security remediation applied on the `dev` branch. The protocol core is being brought to standard Signal-protocol behaviour in Phase 2 — see [docs/PROJECT_ROADMAP.md](docs/PROJECT_ROADMAP.md) for what works, what does not yet, and in what order it is being fixed. Read that document before relying on any security claim below.

## What it does today

- 1:1 text messaging in real time (Socket.IO), with replies, delivery and read receipts, typing indicators and presence between conversation partners.
- End-to-end encryption: X3DH handshake with signed and one-time prekeys, symmetric chain ratchet, safety-number verification screen. **Known limitations in the current protocol** (DH ratchet step and initiator authentication) are documented in the roadmap's defect register and are the next work items.
- Encrypted local state: session state, prekey secrets and the outgoing queue are sealed under a Keychain-held key; trust pins are authenticated.
- Session management: 15-minute access tokens, rotating refresh tokens with reuse detection, server-side logout, password change signs out other devices.
- Abuse controls: rate limits, per-account login backoff, prekey-issue budgets, socket authorization on every event, schema validation with field-level errors, password policy with breach check.
- Android: builds and runs. iOS: builds after the Firebase config is added (roadmap task T1.16).

## What it does not do yet

No groups, media, voice/video calls, multi-device, backup/restore, disappearing messages, message edit/delete, blocking, or account deletion. Push notifications are Android-only and rendered by the OS. Each of these has a roadmap entry.

## Repository layout

```
velo/
├── chats-client/   React Native 0.83 app (TypeScript, Zustand, NativeWind)
├── chats-server/   Express 5 + Mongoose 9 + Socket.IO 4 (TypeScript)
├── docs/           roadmap, execution spec, audit, protocol and design references
├── tools/          secret-scan.js (pre-commit / CI)
└── .githooks/      pre-commit hook
```

## Getting started

Prerequisites: Node.js 20+, npm, a MongoDB instance (local or Atlas), Android Studio or Xcode. Redis is optional in development and required in production.

### 1. Clone and enable the pre-commit secret scanner

```bash
git clone https://github.com/Deus-Kh/Velo.git
cd Velo
git config core.hooksPath .githooks
```

The hook refuses commits containing connection strings, private keys, signing passwords or API keys. Run it over the whole tree with `node tools/secret-scan.js --all`.

### 2. Server

```bash
cd chats-server
npm install
cp .env.example .env      # then fill in MONGO_URI, JWT_SECRET (>= 32 chars), FIREBASE_SERVICE_ACCOUNT_PATH
npm run dev               # nodemon
npm start                 # production mode (NODE_ENV=production; requires REDIS_URL)
npm test                  # vitest: route and socket tests against an in-memory MongoDB
```

The server refuses to start when a required variable is missing. Keep the Firebase service-account JSON and any keystore or certificate **outside** the repository (the example uses `../../velo-secrets/`).

### 3. Client

```bash
cd chats-client
npm install
cp .env.example .env      # API_URL and SOCKET_URL; https:// is mandatory in release builds
npm start -- --reset-cache
npm run android           # or: npm run ios (after `cd ios && pod install`)
npm test                  # jest unit tests
```

Release builds on Android read the upload-key credentials from `~/.gradle/gradle.properties` (`MYAPP_UPLOAD_*`), never from the repository.

## Verification commands

```bash
cd chats-server && npx tsc --noEmit && npm test
cd chats-client && npx tsc --noEmit && npm run lint && npm test
node tools/secret-scan.js --all
```

## Security model, briefly

- The server stores users, public keys, prekeys and undelivered ciphertext; message bodies are encrypted on the device with per-message keys.
- The server can see who talks to whom and when (no sealed sender yet), message sizes, and delivery/read timing. This is stated in the threat model in the roadmap.
- Trust is on first use; compare safety numbers out of band to detect a substituted key.
- Everything above is subject to the open defects listed in [docs/PROJECT_ROADMAP.md](docs/PROJECT_ROADMAP.md) §3. Do not treat this beta as production-grade until Phase 2 is complete.

## Documentation

- [docs/README.md](docs/README.md) — index
- [docs/PROJECT_ROADMAP.md](docs/PROJECT_ROADMAP.md) — roadmap, parity matrices, defect register, decisions
- [docs/AGENT_EXECUTION_SPEC.md](docs/AGENT_EXECUTION_SPEC.md) — task-level execution spec
- [docs/AUDIT_2026-09-07.md](docs/AUDIT_2026-09-07.md) — verified audit with file references
- [docs/protocol/](docs/protocol/) — protocol design, session policy, stabilization checklist
- [docs/design/](docs/design/) — UX and interface references

## License

ISC. Author: Deus_Kh.
