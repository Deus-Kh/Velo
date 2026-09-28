import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';
import { dumpDatabase, pruneSnapshots, restoreDatabase, snapshotDirName, verifySnapshot } from '../src/tools/backup';

/**
 * T4.9 — the rehearsed restore, run on every CI build: dump the live
 * database, destroy it, restore the dump, and compare every document.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let root: string;

beforeAll(async () => {
  harness = await startTestApp();
  root = mkdtempSync(join(tmpdir(), 'velo-backup-'));
});

afterAll(async () => {
  await harness.stop();
  rmSync(root, { recursive: true, force: true });
});

async function db() {
  const mongoose = (await import('mongoose')).default;
  return mongoose.connection.db!;
}

async function everything() {
  const d = await db();
  const names = (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  const out: Record<string, unknown[]> = {};
  for (const name of names) out[name] = await d.collection(name).find({}, { sort: { _id: 1 } }).toArray();
  return out;
}

describe('T4.9 backup and restore', () => {
  it('dump → destroy → restore reproduces every document, types included', async () => {
    const a = await createUser({ oneTimePreKeys: 3 });
    const b = await createUser();
    const { MessageModel } = await import('../src/models/Message');
    const { makeConversationId } = await import('../src/utils/conversation');
    const { messageExpiry } = await import('../src/lib/delivery');
    await MessageModel.create({
      conversationId: makeConversationId(a.userId, b.userId),
      fromUserId: new Types.ObjectId(a.userId),
      toUserId: new Types.ObjectId(b.userId),
      protoVersion: 4,
      v4: { encHeader: Buffer.alloc(85, 3).toString('base64'), ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) },
      clientMessageId: 'backup-1',
      createdAtClient: 1_700_000_000_000,
      seq: 1,
      expiresAt: messageExpiry(1_700_000_000_000),
    });

    const before = await everything();
    expect(Object.keys(before).length).toBeGreaterThanOrEqual(4);
    expect(before.messages).toHaveLength(1);

    const dir = join(root, snapshotDirName());
    const manifest = await dumpDatabase(await db(), dir);
    expect(manifest.collections.messages?.count).toBe(1);
    expect(manifest.collections.users?.count).toBeGreaterThanOrEqual(2);
    await verifySnapshot(dir);

    // Destroy: every collection dropped.
    const d = await db();
    for (const name of Object.keys(before)) await d.collection(name).drop();
    expect(Object.keys(await everything())).toEqual([]);

    const restored = await restoreDatabase(d, dir, { drop: true });
    expect(restored.messages).toBe(1);
    const after = await everything();
    // Extended JSON in canonical mode round-trips ObjectIds, Dates and numbers exactly.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect((after.messages![0] as { expiresAt: Date }).expiresAt).toBeInstanceOf(Date);
    expect((after.messages![0] as { fromUserId: Types.ObjectId }).fromUserId).toBeInstanceOf(Types.ObjectId);
  });

  it('a tampered or truncated snapshot is refused before anything is touched', async () => {
    const d = await db();
    const dir = join(root, 'tampered');
    await dumpDatabase(d, dir);
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.collections.users.sha256 = '0'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const before = await everything();
    await expect(restoreDatabase(d, dir, { drop: true })).rejects.toThrow(/checksum mismatch/);
    expect(JSON.stringify(await everything())).toBe(JSON.stringify(before));
  });

  it('merge restore (no --drop) upserts by _id and leaves newer documents in place', async () => {
    const d = await db();
    const dir = join(root, 'merge');
    await dumpDatabase(d, dir);
    const extra = await createUser();
    const restored = await restoreDatabase(d, dir, { drop: false });
    expect(restored.users).toBeGreaterThanOrEqual(2);
    const users = await d.collection('users').find({}).toArray();
    expect(users.some((u) => String(u._id) === extra.userId), 'a document created after the snapshot survives a merge restore').toBe(true);
  });

  it('retention removes snapshots older than the window and keeps the rest', () => {
    const old = join(root, 'old');
    const fresh = join(root, 'fresh');
    for (const [dir, createdAt] of [[old, '2020-01-01T00:00:00.000Z'], [fresh, new Date().toISOString()]] as const) {
      rmSync(dir, { recursive: true, force: true });
      require('fs').mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ createdAt, db: 'x', collections: {} }));
    }
    const removed = pruneSnapshots(root, 14);
    expect(removed).toEqual([old]);
    expect(require('fs').existsSync(fresh)).toBe(true);
  });
});
