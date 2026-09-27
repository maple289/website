import { useDeleteConfirmation } from '@/lib/deleteConfirmation';

export function useGuardedClose(onClose: () => void, dirty: boolean, busy = false) {
  const { requestDelete } = useDeleteConfirmation();
  return () => {
    if (busy) return;
    if (!dirty) { onClose(); return; }
    void requestDelete({ title: 'Discard your changes?', message: 'Your unsaved changes will be lost.',
      cancelLabel: 'Keep Editing', confirmLabel: 'Discard', processingLabel: 'Discarding…',
      onConfirm: async () => { onClose(); },
    });
  };
}
