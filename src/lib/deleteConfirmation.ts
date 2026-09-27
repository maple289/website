import { createContext, useContext } from 'react';

export type DeleteConfirmation = {
  title?: string;
  message: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  processingLabel?: string;
  tone?: 'destructive' | 'primary';
  onConfirm: () => Promise<void>;
};
export const DeleteConfirmationContext = createContext<{
  requestDelete: (options: DeleteConfirmation) => Promise<boolean>;
  isOpen: boolean;
} | null>(null);

export function useDeleteConfirmation() {
  const context = useContext(DeleteConfirmationContext);
  if (!context) throw new Error('Delete actions require DeleteConfirmationProvider.');
  return context;
}
