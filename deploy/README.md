# Deploying the Velo server

The server runs as a compiled Node process (`npm run build` → `dist/`, T4.1)
under systemd (T4.2). TLS is terminated in front of it by Caddy (T1.2). These
steps are the **HUMAN ACTION** part of T4.2: they run on the host, not from
the repository.

## One-time host setup

```bash
# 1. Node 20+ and a system user with no shell
sudo useradd --system --home /opt/velo --shell /usr/sbin/nologin velo

# 2. The checkout, owned by the deploy user, readable by the service user
sudo git clone https://github.com/Deus-Kh/Velo /opt/velo
sudo chown -R "$USER":velo /opt/velo

# 3. The environment: never in the repository, readable by the service only
sudo mkdir -p /etc/velo
sudo cp /opt/velo/chats-server/.env.example /etc/velo/server.env
sudo chown root:velo /etc/velo/server.env && sudo chmod 0640 /etc/velo/server.env
sudo editor /etc/velo/server.env     # MONGO_URI, JWT_SECRET, REDIS_URL, FIREBASE_SERVICE_ACCOUNT_PATH, CORS_ORIGINS

# 4. The unit
sudo cp /opt/velo/deploy/systemd/velo-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable velo-server
```

`REDIS_URL` is required in production: rate limits, presence and the
socket.io adapter (T4.3) share state through it, so two server processes
behind the proxy behave as one.

Logs are JSON lines on stdout (pino, T4.5): `journalctl -u velo-server -o cat | jq`.
`LOG_LEVEL` (default `info`) sets the level; secrets are redacted by field name
before anything is written.

`FIREBASE_SERVICE_ACCOUNT_PATH` must point outside the checkout (for example
`/etc/velo/firebase-admin.json`, mode 0640, owner root:velo). The service
refuses to start when a required variable is missing.

## Each deploy

```bash
cd /opt/velo && git pull --ff-only
cd chats-server && npm ci --omit=dev && npm run build   # build needs typescript: use `npm ci` then prune, or build in CI (T4.7)
sudo systemctl restart velo-server
sudo systemctl status velo-server --no-pager
journalctl -u velo-server -n 50 --no-pager
```

Until CI produces the build (T4.7), build with the dev dependencies present
(`npm ci && npm run build && npm prune --omit=dev`).

## What the unit guarantees

- **Restart on crash.** `Restart=always`, 2 s backoff. The process exits 1 on
  an uncaught exception or unhandled rejection (`src/lib/lifecycle.ts`), so
  systemd restarts it; a clean `systemctl stop` exits 0.
- **No flapping.** More than 5 restarts in 60 s stops the unit so a broken
  deploy is visible: `systemctl reset-failed velo-server` after fixing it.
- **Graceful stop.** SIGTERM → stop accepting → close socket.io (clients
  reconnect to the next process and resume from their local store, T2.14) →
  close Redis → disconnect MongoDB → exit. A 10 s in-process deadline, then
  systemd's 20 s `TimeoutStopSec`.
- **Least privilege.** Unprivileged user, read-only filesystem
  (`ProtectSystem=strict`), no capabilities, private `/tmp`.

## Metrics

Set `METRICS_TOKEN` (`openssl rand -hex 32`) to enable `GET /metrics`; Prometheus
scrapes it with the same bearer token (`deploy/prometheus/prometheus.yml`,
alert rules in `alerts.yml`). Import `deploy/grafana/velo-dashboard.json` into
Grafana. No series carries a user or conversation identifier.

## Backups (T4.9)

```bash
sudo mkdir -p /var/backups/velo && sudo chown velo:velo /var/backups/velo && sudo chmod 0700 /var/backups/velo
sudo cp /opt/velo/deploy/systemd/velo-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now velo-backup.timer
sudo systemctl start velo-backup.service && journalctl -u velo-backup -n 5 --no-pager   # first snapshot now
```

Daily at 03:30, `node dist/tools/backup.js dump /var/backups/velo --keep-days 14`
writes one directory per snapshot (`<collection>.ejson.gz` in canonical
Extended JSON plus `manifest.json` with document counts and SHA-256 per
collection) and prunes snapshots older than 14 days. A snapshot holds what
the server holds: accounts, public keys, undelivered ciphertext, receipts,
refresh-token hashes. No plaintext and no private key of any user, so it is
exactly as sensitive as the database: encrypted storage, not the web root.
Copy the directory off-host (`rsync -a /var/backups/velo backup-host:`).

### Restore (rehearsed on every CI run: `chats-server/test/backup.test.ts`)

```bash
sudo systemctl stop velo-server
cd /opt/velo/chats-server
sudo -u velo node dist/tools/backup.js verify  /var/backups/velo/<snapshot>      # checksums first
sudo -u velo node dist/tools/backup.js restore /var/backups/velo/<snapshot> --drop   # replace every collection
sudo systemctl start velo-server
```

Without `--drop` the restore merges by `_id` (documents created after the
snapshot survive). A snapshot whose checksums do not match is refused before
anything is touched. Devices keep their sessions and history; a restore only
rewinds what the server knew, so messages sent after the snapshot that were
not yet delivered are lost and their senders see them as undelivered.

## TLS and certificate pinning (T1.2, T4.10)

Caddy terminates TLS (`deploy/Caddyfile.example` → `/etc/caddy/Caddyfile`) with
Let's Encrypt certificates that renew themselves. The Android release build
pins the **Let's Encrypt roots** (ISRG Root X1 in use, ISRG Root X2 as the
backup) for the API host in
`chats-client/android/app/src/main/res/xml/network_security_config.xml`, so a
renewed leaf or intermediate never breaks pinning, and a compromised or
mis-issued certificate from any other CA is refused by the app. The pin-set
has an `expiration` (about one year out): after it Android ignores the pins
(fail-open, still TLS with system trust), so an install that never updated
keeps working.

**Before the first release (human):**

```bash
# 1. the host in the config must be API_URL's host
# 2. verify the pins against the live chain and the published roots
tools/spki-pin.sh host api.velo.example.com          # prints subject + pin for every certificate in the chain
curl -sO https://letsencrypt.org/certs/isrgrootx1.pem && tools/spki-pin.sh pem isrgrootx1.pem
curl -sO https://letsencrypt.org/certs/isrg-root-x2.pem && tools/spki-pin.sh pem isrg-root-x2.pem
```

Both printed pins must appear in the config. A wrong pin means every release
install fails to connect and there is no remote fix.

**Rotation procedure** (moving to a different CA or root):

1. Add the new root's pin to the config **while keeping the old ones**; move
   `expiration` forward; release the app; wait until the installed base has
   updated (the store's adoption numbers).
2. Switch Caddy to the new CA (`tls` directive / ACME endpoint) and confirm
   `tools/spki-pin.sh host <api host>` shows a pinned key in the chain.
3. In a later release remove the retired pin. Never ship a single pin.

**Every release:** move `expiration` to about a year ahead (the client test
`networkSecurityConfig.test.ts` fails when it is under three months or over
two years away). iOS pinning is parked with the rest of iOS (T1.16).

## Rollback

```bash
cd /opt/velo && git checkout <previous-tag-or-commit>
cd chats-server && npm ci && npm run build && npm prune --omit=dev
sudo systemctl restart velo-server
```

Sessions are on the devices, undelivered messages and receipts are in
MongoDB (T3.1): a restart or rollback loses nothing in flight.

## Health

`GET /health` returns `{ ok, uptime, mongo }` with HTTP 200 when MongoDB is
connected and 503 otherwise; point the reverse proxy's health check at it.
