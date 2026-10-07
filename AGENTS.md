# Velo — notes for coding agents

End-to-end encrypted messenger: a from-scratch Signal-style protocol verified against libsignal, a Node server, and a React Native app. Android only for now. The repository is public, so never write a secret into code, docs or commits.

## Layout

| Path | What |
|---|---|
| `packages/protocol` | `@velo/protocol`: X3DH-style handshake, double ratchet, sender keys, attachments. Vitest, high coverage bar |
| `chats-server` | Express + Socket.IO + MongoDB (`src/routes`, `src/socket`, `src/models`). Vitest with mongodb-memory-server |
| `chats-client` | React Native + NativeWind. `src/screens`, `src/components`, `src/shared/<area>` (api, auth, chat, crypto, media, …), `src/store`, `src/theme`. Jest |
| `deploy` | Caddy, systemd, Prometheus and Grafana examples |
| `tools` | `secret-scan.js` (pre-commit and CI), `spki-pin.sh` |
| `docs` | Start at `docs/README.md` |

## Checks (what CI runs)

```sh
# packages/protocol
npm run typecheck && npm run lint && npm test
# chats-server
npm run typecheck && npm test && npm run build
# chats-client
npx tsc --noEmit && npm run lint && npm test -- --ci
# Android smoke (chats-client/android)
./gradlew assembleDebug
# repo root
node tools/secret-scan.js
```

Run only the packages you touched. Don't run the mongodb-memory-server tests alongside other heavy jobs; they time out under load.

## Reading the docs cheaply

`docs/AGENT_EXECUTION_SPEC.md` (~160 KB) and `docs/PROJECT_ROADMAP.md` (~130 KB) are the source of truth, but **never read either one whole**. Search for the ID you need, then read only that section:

- Spec task: `grep -n '^## T2.3 ' docs/AGENT_EXECUTION_SPEC.md`, then read from that line to the next `## `.
- Roadmap step: `grep -n '\*\*B18 ·' docs/PROJECT_ROADMAP.md` (B and A steps are bold paragraphs, not headings).
- Spec rules you must follow are in §0 (prime directives) and §2 (conventions); read those once per task.
- `docs/AUDIT_2026-09-07.md` holds the evidence for each defect. Its line numbers refer to commit `c9c9267`, so check them again before relying on them.
- `docs/archive/` is superseded. Don't read it unless you need the history of a change.
- `docs/DEV_COPILOT_HANDOFF.md` is a one-off handoff snapshot and is stale.

## Hard rules

- **No iOS.** Don't build, edit or verify anything under `chats-client/ios`.
- **No emoji in the interface.** Use the `Icon` component (Lucide or Ionicons) or plain words ("Photo", "Voice message · 0:12"). Don't use glyph stand-ins such as ↪ ▶ ⏸ either. Emoji are allowed only as user content (reactions).
- **Ask before** running test suites, committing, landing on `dev`, or touching the device, unless the owner has said to continue without asking.
- **Never push** and never touch `master` or the remote without an explicit instruction.
- Don't stage or revert unrelated working-tree changes.
- Crypto code follows spec §2.2: keys are `Uint8Array`, every decoded key is length-checked, randomness comes only from `nacl.randomBytes()`, and every deviation is marked `DEVIATION-n`.

## Branches and commits

- Work on `wip/<task>` and make behaviour-sized commits, each one only after its checks pass. Land with `git checkout dev && git merge --ff-only wip/<task>`.
- Commit subject: `<step id>: <what the user sees>` (e.g. `B17: photo viewer pages sideways and closes up or down`). The body explains why and what was found.
- Enable the hooks once per clone: `git config core.hooksPath .githooks`. The pre-commit hook runs the secret scan and checks that `gradlew` and `*.sh` are executable.

## Owner's dev machine (Windows, Android phone over USB)

- Local MongoDB runs on 27017. The owner's `npm run dev` (nodemon) owns port **9999**, so never kill it. Smoke-test the server on 9998: `PORT=9998 npx ts-node src/index.ts`, then `/health`.
- After a USB reconnect, run `npm run dev:reverse` (in `chats-client`) again.
- Metro misses new folders. If tsc passes but the bundle fails to resolve, restart with `npx react-native start --reset-cache`.
- Launch the app with `adb shell monkey -p com.velo -c android.intent.category.LAUNCHER 1`. In Git Bash, prefix adb commands that carry `/data/...` paths with `MSYS_NO_PATHCONV=1`.
- **Never tap the phone blind.** The owner is using it at the same time. Take a screenshot and confirm what is on screen before every `input tap`.
- If `assembleDebug` fails on autolinking paths, delete `chats-client/android/build/generated/autolinking/`.
