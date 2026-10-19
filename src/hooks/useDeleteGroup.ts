import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { chatRequestId } from '@/lib/messenger';
import { authenticatedRequest } from '@/lib/authSession';
import { supabase } from '@/lib/supabase';
import { useMessenger } from '@/context/MessengerContext';

export function useDeleteGroup() {
  const { requestDelete } = useDeleteConfirmation();
  const { removeConversation } = useMessenger();
  return (group: { id: string; name: string }, administratorAction: boolean, deleted: () => Promise<void>) => {
    const clientId = chatRequestId();
    return requestDelete({ title: 'Delete this group for everyone?', message: `Permanently delete “${group.name}” for everyone?`,
      details: `${administratorAction ? 'Site administrator action: you are deleting another owner’s group. ' : ''}This will permanently delete the group, messages and group Messenger content. Messenger attachments are queued for storage cleanup. Videos and photos only shared with this group remain in their original libraries. This cannot be undone.`,
      confirmLabel: 'Delete Group', processingLabel: 'Deleting…', onConfirm: async () => {
        const { error } = await authenticatedRequest(() => supabase.rpc('messenger_groups_rpc', { p_action: 'delete', p_group: group.id, p_data: { client_id: clientId } }));
        if (error) throw new Error(error.code === 'P0001' || error.code === '42501' ? error.message : 'Could not delete the group. Please try again.');
        removeConversation(group.id);
        await deleted();
      } });
  };
}
