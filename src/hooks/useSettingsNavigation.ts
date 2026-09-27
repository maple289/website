import { useLayoutEffect, useRef } from 'react';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { goBackAfterConfirmation, registerNavigationGuard } from '@/lib/appHistory';

export function useSettingsNavigation(dirty: boolean, busy: boolean) {
  const { requestDelete, isOpen } = useDeleteConfirmation();
  const current = useRef({ dirty, busy, isOpen });
  current.current = { dirty, busy, isOpen };
  const prompting = useRef(false);
  const leaving = useRef(false);
  const confirm = async () => {
    if (current.current.busy || current.current.isOpen || prompting.current) return false;
    if (!current.current.dirty) return true;
    prompting.current = true;
    try {
      return await requestDelete({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. If you leave this page, your changes will be lost. Are you sure you want to leave?',
        cancelLabel: 'Keep Editing', confirmLabel: 'Discard Changes', processingLabel: 'Leaving…',
        // The provider resolves only after explicit confirmation; the navigation
        // controller then resumes the exact pending history traversal.
        onConfirm: async () => {},
      });
    } finally { prompting.current = false; }
  };
  const actions = useRef({ confirm });
  actions.current = { confirm };
  const back = async () => {
    if (window.history.length <= 1) return;
    if (current.current.busy || current.current.isOpen || prompting.current) return;
    if (!current.current.dirty) { window.history.back(); return; }
    if (await actions.current.confirm()) { leaving.current = true; goBackAfterConfirmation(); }
  };
  const backRef = useRef(back);
  backRef.current = back;

  useLayoutEffect(() => {
    const unregister = registerNavigationGuard({
      blocked: () => current.current.dirty || current.current.busy || current.current.isOpen,
      confirm: () => actions.current.confirm(),
    });
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat) return;
      // Other task dialogs own Escape while they are open.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      void backRef.current();
    };
    // Cross-document Back/reload cannot use an asynchronous custom dialog.
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving.current && (current.current.dirty || current.current.busy)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => { unregister(); window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, []);
  return () => { void backRef.current(); };
}
