import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createGunzip, createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { EJSON } from 'bson';
import type { Db, Document } from 'mongodb';

/**
 * MongoDB backup and restore (T4.9), driver-based so it runs wherever the
 * server runs (no mongodump binary) and can be rehearsed in CI against the
 * in-memory MongoDB. One directory per snapshot:
 *
 *   <dir>/<collection>.ejson.gz   canonical Extended JSON, one document per line
 *   <dir>/manifest.json           { createdAt, db, collections: { name: { count, sha256 } } }
 *
 * What a snapshot contains is what the server holds: users and identity
 * keys, public prekeys, undelivered ciphertext with its expiry, receipts,
 * refresh-token hashes. No plaintext, no private key of any user (those
 * never leave the devices), so a backup is as sensitive as the database
 * itself and no more: keep it on encrypted storage, off the web root.
 */
export type Manifest = {
  createdAt: string;
  db: string;
  collections: Record<string, { count: number; sha256: string }>;
};

const FILE_SUFFIX = '.ejson.gz';

export async function dumpDatabase(db: Db, dir: string): Promise<Manifest> {
  mkdirSync(dir, { recursive: true });
  const manifest: Manifest = { createdAt: new Date().toISOString(), db: db.databaseName, collections: {} };
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  for (const name of collections) {
    const file = join(dir, name + FILE_SUFFIX);
    const hash = createHash('sha256');
    let count = 0;
    const gzip = createGzip();
    const out = createWriteStream(file);
    const done = pipeline(gzip, out);
    const cursor = db.collection(name).find({}, { sort: { _id: 1 } });
    for await (const doc of cursor) {
      const line = EJSON.stringify(doc, { relaxed: false }) + '\n';
      hash.update(line);
      count += 1;
      if (!gzip.write(line)) await new Promise<void>((resolve) => gzip.once('drain', resolve));
    }
    gzip.end();
    await done;
    manifest.collections[name] = { count, sha256: hash.digest('hex') };
  }

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export type RestoreOptions = {
  /** Drop each collection before loading it (a true restore). Default: false (merge by _id). */
  drop?: boolean;
  /** Verify the files against the manifest before touching the database. Default: true. */
  verify?: boolean;
};

async function readLines(file: string): Promise<string[]> {
  const chunks: Buffer[] = [];
  await pipeline(createReadStream(file), createGunzip(), async function* (source) {
    for await (const chunk of source) chunks.push(Buffer.from(chunk));
  });
  return Buffer.concat(chunks).toString('utf8').split('\n').filter((l) => l.length > 0);
}

/** Checks every file against the manifest; throws on a mismatch. Returns the manifest. */
export async function verifySnapshot(dir: string): Promise<Manifest> {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('no manifest.json in ' + dir);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  for (const [name, meta] of Object.entries(manifest.collections)) {
    const file = join(dir, name + FILE_SUFFIX);
    if (!existsSync(file)) throw new Error('missing ' + file);
    const lines = await readLines(file);
    const hash = createHash('sha256');
    for (const line of lines) hash.update(line + '\n');
    if (lines.length !== meta.count) throw new Error(name + ': expected ' + String(meta.count) + ' documents, found ' + String(lines.length));
    if (hash.digest('hex') !== meta.sha256) throw new Error(name + ': checksum mismatch');
  }
  return manifest;
}

export async function restoreDatabase(db: Db, dir: string, opts: RestoreOptions = {}): Promise<Record<string, number>> {
  const manifest = opts.verify === false ? (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest) : await verifySnapshot(dir);
  const restored: Record<string, number> = {};
  for (const name of Object.keys(manifest.collections).sort()) {
    const lines = await readLines(join(dir, name + FILE_SUFFIX));
    const docs = lines.map((l) => EJSON.parse(l, { relaxed: false }) as Document);
    const collection = db.collection(name);
    if (opts.drop) {
      try {
        await collection.drop();
      } catch {
        /* did not exist */
      }
    }
    if (docs.length === 0 && opts.drop) {
      // An empty collection is still part of the snapshot: recreate it so the database shape matches.
      await db.createCollection(name).catch(() => undefined);
    }
    if (docs.length > 0) {
      if (opts.drop) {
        await collection.insertMany(docs, { ordered: true });
      } else {
        await collection.bulkWrite(
          docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
          { ordered: true },
        );
      }
    }
    restored[name] = docs.length;
  }
  return restored;
}

/** Deletes snapshot directories older than `keepDays` (by their manifest's createdAt). Returns what was removed. */
export function pruneSnapshots(root: string, keepDays: number, now: number = Date.now()): string[] {
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const createdAt = Date.parse((JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest).createdAt);
    if (Number.isFinite(createdAt) && now - createdAt > keepDays * 24 * 60 * 60 * 1000) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}

export function snapshotDirName(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function main(argv: string[]): Promise<void> {
  const [command, arg] = argv;
  const usage = 'usage: backup.js dump <root-dir> [--keep-days N] | restore <snapshot-dir> [--drop] | verify <snapshot-dir>';
  if (!command || !arg) {
    console.error(usage);
    process.exit(2);
  }
  if (command === 'verify') {
    const m = await verifySnapshot(arg);
    console.log(JSON.stringify({ ok: true, ...m }));
    return;
  }
  // Loaded here, not at module top: `verify` and the tests must not require the server environment.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('../config') as typeof import('../config');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = (require('mongoose') as typeof import('mongoose')).default;
  await mongoose.connect(config.MONGO_URI);
  const db = mongoose.connection.db!;
  try {
    if (command === 'dump') {
      const keepIdx = argv.indexOf('--keep-days');
      const keepDays = keepIdx >= 0 ? Number(argv[keepIdx + 1]) : 14;
      const dir = join(arg, snapshotDirName());
      const manifest = await dumpDatabase(db, dir);
      const pruned = pruneSnapshots(arg, keepDays);
      console.log(JSON.stringify({ ok: true, dir, collections: manifest.collections, pruned }));
    } else if (command === 'restore') {
      const restored = await restoreDatabase(db, arg, { drop: argv.includes('--drop') });
      console.log(JSON.stringify({ ok: true, restored }));
    } else {
      console.error(usage);
      process.exit(2);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
