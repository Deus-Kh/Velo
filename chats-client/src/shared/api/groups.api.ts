import { http } from './http';

/** Phase 6' (T6.3/T6.4): groups as the server describes them. Keys never appear here. */
export type GroupRole = 'admin' | 'member';

export interface GroupMember {
  userId: string;
  username: string | null;
  role: GroupRole;
  addedAt: number;
}

export interface GroupEvent {
  at: number;
  type: 'created' | 'added' | 'removed' | 'left' | 'promoted' | 'renamed';
  byUserId: string;
  userIds: string[];
  epoch: number;
}

export interface GroupView {
  groupId: string;
  name: string;
  epoch: number;
  createdBy: string;
  members: GroupMember[];
  lastMessageAt: number;
  lastSeq: number;
  history: GroupEvent[];
}

export const groupsApi = {
  create: (body: { name: string; memberIds: string[] }) => http.post<GroupView>('/groups', body),
  list: () => http.get<{ items: GroupView[] }>('/groups'),
  get: (groupId: string) => http.get<GroupView>(`/groups/${groupId}`),
  rename: (groupId: string, name: string) => http.patch<GroupView>(`/groups/${groupId}`, { name }),
  addMembers: (groupId: string, userIds: string[]) => http.post<GroupView>(`/groups/${groupId}/members`, { userIds }),
  removeMember: (groupId: string, userId: string) => http.delete<GroupView | { ok: true; deleted: true }>(`/groups/${groupId}/members/${userId}`),
  leave: (groupId: string) => http.post<{ ok: true; deleted: boolean }>(`/groups/${groupId}/leave`),
};

/** The local "peer" slot group messages are stored under (storage/messageStore.ts). */
export function groupPeerKey(groupId: string): string {
  return 'group:' + groupId;
}
