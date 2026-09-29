import { useEffect } from 'react';
import { blocksApi, type ReportReason } from '../api/blocks.api';
import { useBlocksStore } from '../../store/blocks.store';

/**
 * T7.5: block, unblock, report. The server enforces a block silently; the
 * local mirror lets the app drop inbound copies at once and hide the peer.
 */
export async function syncBlocks(myUserId: string): Promise<void> {
  const res = await blocksApi.list();
  useBlocksStore.getState().setBlocked(myUserId, res.data.items.map((i) => i.userId));
}

export async function blockPeer(myUserId: string, userId: string): Promise<void> {
  await blocksApi.block(userId);
  useBlocksStore.getState().addBlocked(myUserId, userId);
}

export async function unblockPeer(myUserId: string, userId: string): Promise<void> {
  await blocksApi.unblock(userId).catch((e) => {
    if (e?.response?.status !== 404) throw e; // already gone server-side: the mirror just catches up
  });
  useBlocksStore.getState().removeBlocked(myUserId, userId);
}

export async function reportPeer(params: { reportedUserId: string; reason: ReportReason; excerpt?: string; groupId?: string }): Promise<string> {
  const res = await blocksApi.report({ ...params, excerpt: params.excerpt?.trim() || undefined });
  return res.data.reportId;
}

/** Mirror the block list at sign-in and whenever the account changes. */
export function useBlocksSync(myUserId: string | null | undefined): void {
  useEffect(() => {
    if (!myUserId) return;
    syncBlocks(String(myUserId)).catch((e) => console.warn('[blocks] sync failed:', e));
  }, [myUserId]);
}
