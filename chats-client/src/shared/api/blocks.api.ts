import { http } from './http';

/** T7.5: block list and reports. The server enforces blocks silently; the app also drops locally. */
export type BlockedUser = { userId: string; username: string | null; blockedAt: number };
export type ReportReason = 'spam' | 'abuse' | 'impersonation' | 'other';

export const blocksApi = {
  list: () => http.get<{ items: BlockedUser[] }>('/users/me/blocks'),
  block: (userId: string) => http.post<{ ok: true }>(`/users/${userId}/block`),
  unblock: (userId: string) => http.delete<{ ok: true }>(`/users/${userId}/block`),
  report: (body: { reportedUserId: string; reason: ReportReason; excerpt?: string; groupId?: string }) =>
    http.post<{ ok: true; reportId: string }>('/reports', body),
};
