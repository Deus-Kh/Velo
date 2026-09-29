import { http } from './http';

/** T8.2/T8.3: the server hands out where to put and fetch ciphertext blobs. It never sees a key. */
export type BlobTarget = { url: string; method: 'PUT' | 'GET'; headers: Record<string, string> };

export const attachmentsApi = {
  reserve: (size: number) => http.post<{ blobId: string; size: number; upload: BlobTarget; expiresAt: number }>('/attachments', { size }),
  complete: (blobId: string) => http.post<{ ok: true; size: number }>(`/attachments/${blobId}/complete`),
  download: (blobId: string) => http.post<{ blobId: string; size: number; download: BlobTarget; expiresAt: number }>(`/attachments/${blobId}/download`),
};
