import { env } from '../config/env';
import type { BlobTarget } from '../api/attachments.api';

/**
 * Byte transport for blobs (T8.3) over React Native's XMLHttpRequest, which
 * uploads typed arrays and downloads array buffers natively. Kept apart
 * from the pipeline so tests inject a fake. A relative URL (the local
 * store's default) is resolved against the API base the app already uses.
 */
export type ProgressFn = (loaded: number, total: number) => void;
export type BlobTransport = {
  put: (target: BlobTarget, bytes: Uint8Array, onProgress?: ProgressFn) => Promise<void>;
  get: (target: BlobTarget, onProgress?: ProgressFn) => Promise<Uint8Array>;
};

export function resolveBlobUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = env.API_URL.replace(/\/+$/, '');
  return base + (url.startsWith('/') ? url : '/' + url);
}

export class TransportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function request(method: string, url: string, headers: Record<string, string>, body: Uint8Array | null, responseType: '' | 'arraybuffer', onProgress?: ProgressFn): Promise<{ status: number; body: ArrayBuffer | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = 120_000;
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'content-length') xhr.setRequestHeader(k, v);
    if (responseType) xhr.responseType = responseType;
    if (onProgress) {
      const handler = (e: ProgressEvent) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      if (body) xhr.upload.onprogress = handler;
      else xhr.onprogress = handler;
    }
    xhr.onload = () => resolve({ status: xhr.status, body: responseType === 'arraybuffer' ? (xhr.response as ArrayBuffer) : null });
    xhr.onerror = () => reject(new TransportError(0, 'network error'));
    xhr.ontimeout = () => reject(new TransportError(0, 'timeout'));
    xhr.send(body ? (body as unknown as string) : null); // React Native encodes a typed array itself
  });
}

export const xhrTransport: BlobTransport = {
  async put(target, bytes, onProgress) {
    const r = await request(target.method, resolveBlobUrl(target.url), { 'Content-Type': 'application/octet-stream', ...target.headers }, bytes, '', onProgress);
    if (r.status < 200 || r.status >= 300) throw new TransportError(r.status, 'upload refused (' + String(r.status) + ')');
  },
  async get(target, onProgress) {
    const r = await request(target.method, resolveBlobUrl(target.url), target.headers, null, 'arraybuffer', onProgress);
    if (r.status < 200 || r.status >= 300 || !r.body) throw new TransportError(r.status, 'download refused (' + String(r.status) + ')');
    return new Uint8Array(r.body);
  },
};
