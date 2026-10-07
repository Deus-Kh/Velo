import { useSyncExternalStore } from 'react';

/**
 * Upload progress of photos that are still being sent, keyed by the local
 * blob id of their placeholder (sendPhotos). In memory only: a placeholder
 * whose upload is interrupted by a restart is simply gone.
 */
const progress = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setUploadProgress(id: string, fraction: number): void {
  const value = Math.max(0, Math.min(1, fraction));
  if (progress.get(id) === value) return;
  progress.set(id, value);
  emit();
}

export function clearUploadProgress(id: string): void {
  if (progress.delete(id)) emit();
}

export function getUploadProgress(id: string): number | undefined {
  return progress.get(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 0..1 while this photo is uploading, undefined otherwise. */
export function useUploadProgress(id: string): number | undefined {
  return useSyncExternalStore(subscribe, () => progress.get(id));
}
