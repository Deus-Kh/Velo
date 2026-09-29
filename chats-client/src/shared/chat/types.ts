export type ReplyReference = {
  serverMessageId?: string | null;
  clientMessageId?: string | null;
};

export type UIMessage = {
  id: string;
  serverMessageId?: string;
  clientMessageId?: string;
  text: string;
  mine: boolean;
  createdAt: number;
  replyTo?: ReplyReference | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
  /** T7.2 */
  reactions?: Record<string, string> | null;
  editedAt?: number | null;
  deletedAt?: number | null;
  forwardedFrom?: { userId: string; createdAt: number } | null;
  /** T7.3 */
  system?: boolean;
  expiresAt?: number | null;
};
