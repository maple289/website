import type { ChatMessage } from './messenger';

export type MessageDeleteScope = 'self' | 'everyone';

// Account-specific, synchronous tombstones prevent a stale request from
// resurrecting a removed card during pagination, reconnect or navigation.
export class MessageVisibility {
  private removed = new Map<string, MessageDeleteScope>();

  remove(id: string, scope: MessageDeleteScope) {
    if (this.removed.get(id) !== 'everyone') this.removed.set(id, scope);
  }

  has(id: string) { return this.removed.has(id); }

  messages(rows: ChatMessage[]): ChatMessage[] {
    return rows.filter(row => !row.deleted && !row.deleting && !this.has(row.id)).map(row => {
      const scope = row.reply && this.removed.get(row.reply.id);
      return scope && row.reply ? { ...row, reply: { ...row.reply, body: scope === 'everyone' ? 'Original message deleted' : 'This message is unavailable.' } } : row;
    });
  }
}
