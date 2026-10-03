import { useCallback, useState } from 'react';
import { groupPeerKey, groupsApi, type GroupView } from '../api/groups.api';
import { ensureOwnSenderKey } from './groupKeys';
import { deleteGroupKeys } from '../storage/senderKeyStore';
import { ingestLiveGroupMessage } from '../notifications/pushIngest';

/**
 * C1: the groups shown on the chat list, and what a live group message
 * or a membership change does to them. The socket subscription itself
 * lives in `useConversationList`, which hands the events here.
 */
export function useGroupList({ myUserId, activeChatPeerUserId }: { myUserId: string | null; activeChatPeerUserId: string | null }) {
  const [groups, setGroups] = useState<GroupView[]>([]);

  const refreshGroupsSilently = useCallback(async () => {
    try {
      const res = await groupsApi.list();
      setGroups(res.data.items);
    } catch (e: any) {
      console.warn('[ChatListScreen] group list refresh failed:', e?.message || e);
    }
  }, []);

  // T6.4: a group copy; the open group screen ingests its own, the rest is stored and notified here.
  const applyLiveGroupMessage = useCallback(
    (evt: any) => {
      const groupOpen = activeChatPeerUserId === groupPeerKey(String(evt.groupId));
      if (!groupOpen && myUserId && evt.fromUserId !== myUserId) {
        ingestLiveGroupMessage({
          myUserId,
          item: {
            serverMessageId: String(evt.serverMessageId),
            conversationId: evt.conversationId,
            fromUserId: String(evt.fromUserId),
            toUserId: String(evt.toUserId ?? myUserId),
            groupId: String(evt.groupId),
            g1: evt.g1,
            epoch: typeof evt.epoch === 'number' ? evt.epoch : null,
            clientMessageId: String(evt.clientMessageId ?? ''),
            createdAt: Number(evt.createdAt ?? Date.now()),
            seq: typeof evt.seq === 'number' ? evt.seq : null,
            status: evt.status,
          },
        }).catch((ingestError) => {
          console.warn('[ChatListScreen] Failed to ingest live group message:', ingestError);
        });
      }
      setGroups((prev) => prev.map((g) => (g.groupId === String(evt.groupId) ? { ...g, lastMessageAt: Number(evt.createdAt ?? Date.now()) } : g)));
    },
    [activeChatPeerUserId, myUserId],
  );

  // T6.5: a membership change rotates our sender key at once (the new key is distributed on the
  // next open or send); being removed wipes everything this device holds for the group.
  const applyGroupChanged = useCallback(
    (evt: any) => {
      const groupId = String(evt?.groupId ?? '');
      if (!groupId || !myUserId) return;
      const gone = (evt?.change?.type === 'removed' || evt?.change?.type === 'left') && Array.isArray(evt?.change?.userIds) && evt.change.userIds.includes(myUserId);
      const work = gone ? deleteGroupKeys(myUserId, groupId) : typeof evt?.epoch === 'number' ? ensureOwnSenderKey({ myUserId, groupId, epoch: evt.epoch }).then(() => undefined) : Promise.resolve();
      work.catch((e) => console.warn('[ChatListScreen] group key update failed:', e)).finally(refreshGroupsSilently);
    },
    [myUserId, refreshGroupsSilently],
  );

  return { groups, refreshGroupsSilently, applyLiveGroupMessage, applyGroupChanged };
}

export type GroupListHandle = ReturnType<typeof useGroupList>;
