import { createHmac, timingSafeEqual } from 'crypto';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { config } from '../config';
import { presignS3 } from './s3Presign';

/**
 * Where ciphertext blobs live (T8.2). Two stores behind one interface:
 *  - `LocalBlobStore`: files under `BLOB_DIR`, served by the server's own
 *    `PUT/GET /blobs/:id` with an HMAC-signed, expiring token in the query
 *    string (no bucket needed; the default);
 *  - `S3BlobStore`: presigned PUT/GET/HEAD/DELETE against any S3-compatible
 *    endpoint (`S3_*` env), the server never proxies the bytes.
 * Either way the server learns size and timing, never content.
 */
export type Target = { url: string; method: 'PUT' | 'GET'; headers: Record<string, string> };

export interface BlobStore {
  readonly kind: 'local' | 's3';
  uploadTarget(blobId: string, size: number, expiresAt: Date): Target;
  downloadTarget(blobId: string, expiresAt: Date): Target;
  /** Size of the stored blob, or null if it is not there. */
  stat(blobId: string): Promise<number | null>;
  delete(blobId: string): Promise<void>;
}

export const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;

// ───────── local ─────────

export class LocalBlobStore implements BlobStore {
  readonly kind = 'local' as const;
  constructor(
    readonly dir: string,
    private readonly tokenKey: string,
    /** Prefix for the URLs handed to clients ('' = relative to the API base). */
    private readonly publicBaseUrl: string,
  ) {}

  filePath(blobId: string): string {
    if (!BLOB_ID_PATTERN.test(blobId)) throw new Error('invalid blob id');
    return path.join(this.dir, blobId);
  }

  token(op: 'put' | 'get', blobId: string, exp: number): string {
    return createHmac('sha256', this.tokenKey).update(`${op}:${blobId}:${exp}`).digest('hex');
  }

  verifyToken(op: 'put' | 'get', blobId: string, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
    const expNum = Number(exp);
    if (!BLOB_ID_PATTERN.test(blobId) || !Number.isFinite(expNum) || expNum * 1000 < now || typeof sig !== 'string' || sig.length !== 64) return false;
    const expected = Buffer.from(this.token(op, blobId, expNum), 'hex');
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private url(op: 'put' | 'get', blobId: string, expiresAt: Date): string {
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return `${this.publicBaseUrl}/blobs/${blobId}?exp=${exp}&sig=${this.token(op, blobId, exp)}`;
  }

  uploadTarget(blobId: string, size: number, expiresAt: Date): Target {
    return { url: this.url('put', blobId, expiresAt), method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } };
  }

  downloadTarget(blobId: string, expiresAt: Date): Target {
    return { url: this.url('get', blobId, expiresAt), method: 'GET', headers: {} };
  }

  async stat(blobId: string): Promise<number | null> {
    try {
      const st = await fs.stat(this.filePath(blobId));
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  }

  /** Atomic: written to a temp name, then renamed. */
  async write(blobId: string, bytes: Buffer): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const final = this.filePath(blobId);
    const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, final);
  }

  readStream(blobId: string) {
    return createReadStream(this.filePath(blobId));
  }

  async delete(blobId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(blobId));
    } catch {
      /* already gone */
    }
  }
}

// ───────── s3 ─────────

export type S3Settings = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; pathStyle: boolean };

export class S3BlobStore implements BlobStore {
  readonly kind = 's3' as const;
  constructor(private readonly s3: S3Settings, private readonly fetchImpl: typeof fetch = fetch) {}

  private sign(method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', blobId: string, expiresAt: Date): string {
    const expiresSeconds = Math.max(60, Math.min(7 * 24 * 3600, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    return presignS3({ method, endpoint: this.s3.endpoint, bucket: this.s3.bucket, key: blobId, region: this.s3.region, accessKeyId: this.s3.accessKeyId, secretAccessKey: this.s3.secretAccessKey, expiresSeconds, pathStyle: this.s3.pathStyle }).url;
  }

  uploadTarget(blobId: string, size: number, expiresAt: Date): Target {
    return { url: this.sign('PUT', blobId, expiresAt), method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } };
  }

  downloadTarget(blobId: string, expiresAt: Date): Target {
    return { url: this.sign('GET', blobId, expiresAt), method: 'GET', headers: {} };
  }

  async stat(blobId: string): Promise<number | null> {
    const res = await this.fetchImpl(this.sign('HEAD', blobId, new Date(Date.now() + 5 * 60_000)), { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) ? len : null;
  }

  async delete(blobId: string): Promise<void> {
    await this.fetchImpl(this.sign('DELETE', blobId, new Date(Date.now() + 5 * 60_000)), { method: 'DELETE' }).catch(() => undefined);
  }
}

// ───────── selection ─────────

let current: BlobStore | null = null;

export function createBlobStore(): BlobStore {
  const c = config as unknown as Record<string, string>;
  if (c.S3_ENDPOINT && c.S3_BUCKET && c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY) {
    return new S3BlobStore({ endpoint: c.S3_ENDPOINT, region: c.S3_REGION || 'us-east-1', bucket: c.S3_BUCKET, accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY, pathStyle: c.S3_PATH_STYLE !== 'false' });
  }
  return new LocalBlobStore(c.BLOB_DIR || path.resolve('data', 'blobs'), c.JWT_SECRET, c.PUBLIC_BASE_URL || '');
}

/** The process-wide store (created on first use; tests replace it). */
export function blobStore(): BlobStore {
  if (!current) current = createBlobStore();
  return current;
}

export function setBlobStore(store: BlobStore | null): void {
  current = store;
}
