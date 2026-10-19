import type { ChatMessage } from './messenger';

export type MessageDeleteScope = 'self' | 'everyone';

// Account-specific, synchronous tombstones prevent a stale request from
// resurrecting a removed card during pagination, reconnect or navigation.
export class MessageVisibility {
  private removed = new Map<string, MessageDeleteScope>();
  private conversations = new Set<string>();
  private conversationEpoch = 0;
  revokeConversation(id: string) { this.conversations.add(id); this.conversationEpoch++; }
  restoreConversation(id: string) { if (this.conversations.delete(id)) this.conversationEpoch++; }
  conversationRevision() { return this.conversationEpoch; }
  restoreSnapshot(ids: string[], requestedEpoch: number) {
    if (requestedEpoch === this.conversationEpoch) ids.forEach(id => this.restoreConversation(id));
  }
  conversationUnavailable(id: string) { return this.conversations.has(id); }

  remove(id: string, scope: MessageDeleteScope) {
    if (this.removed.get(id) !== 'everyone') this.removed.set(id, scope);
  }

  has(id: string) { return this.removed.has(id); }

  messages(rows: ChatMessage[]): ChatMessage[] {
    return rows.filter(row => !this.conversationUnavailable(row.conversation_id) && !row.deleted && !row.deleting && !this.has(row.id)).map(row => {
      const scope = row.reply && this.removed.get(row.reply.id);
      return scope && row.reply ? { ...row, reply: { ...row.reply, body: scope === 'everyone' ? 'Original message deleted' : 'This message is unavailable.' } } : row;
    });
  }
}
