import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import './ContentContextMenu.css';

export type ContentAction = { id: string; label: string; icon?: ReactNode; disabled?: boolean; danger?: boolean; run: () => void };
export type MenuAnchor = { x: number; y: number };

export function ContentContextMenu({ name, actions, className = '', anchor, onClose }: {
  name: string; actions: ContentAction[]; className?: string; anchor?: MenuAnchor; onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = open || !!anchor;
  const close = () => { setOpen(false); onClose?.(); };
  useLayoutEffect(() => {
    if (!visible || !panel.current) return;
    const place = () => {
      if (!panel.current) return;
      const rect = trigger.current?.getBoundingClientRect();
      const x = anchor?.x ?? rect?.right ?? 0;
      const below = anchor?.y ?? rect?.bottom ?? 0;
      const above = anchor?.y ?? rect?.top ?? 0;
      const { width, height } = panel.current.getBoundingClientRect();
      const margin = 8;
      const belowFits = below + height + margin <= innerHeight;
      const aboveFits = above - height - 4 >= margin;
      const sideways = !belowFits && !aboveFits;
      const left = sideways && (rect?.right ?? x) + width + margin <= innerWidth ? (rect?.right ?? x) + 4 : x - width;
      const top = belowFits ? below + 4 : aboveFits ? above - height - 4 : Math.max(margin, Math.min(above, innerHeight - height - margin));
      setPosition({ left: Math.max(margin, Math.min(left, innerWidth - width - margin)), top: Math.max(margin, Math.min(top, innerHeight - height - margin)) });
    };
    place();
    (panel.current.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panel.current).focus({ preventScroll: true });
    const reposition = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [visible, anchor]);
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: Event) => {
      if (event.type === 'pointerdown' && (panel.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node))) return;
      setOpen(false); onClose?.();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); };
  }, [visible, onClose]);
  return <>
    {!anchor && <button ref={trigger} type="button" className={`content-menu-trigger ${className}`} aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={visible} aria-controls={visible ? id : undefined}
      onClick={event => { event.stopPropagation(); setOpen(value => !value); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><MoreVertical size={18} /></button>}
    {visible && createPortal(<div id={id} ref={panel} role="menu" tabIndex={-1} aria-label={`Actions for ${name}`} className="content-menu" style={position}
      onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); close(); trigger.current?.focus({ preventScroll: true }); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      {actions.map((action, index) => <div key={action.id}>{action.danger && !actions[index - 1]?.danger && index > 0 && <div role="separator" className="content-menu-divider" />}
        <button type="button" role="menuitem" disabled={action.disabled} data-danger={action.danger} onClick={() => { close(); trigger.current?.focus(); action.run(); }}>{action.icon}<span>{action.label}</span></button>
      </div>)}
    </div>, document.body)}
  </>;
}
