import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes } from 'react';
import './TaskModal.css';
import { useModalLayer } from '@/hooks/useModalLayer';

export const TaskModal = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TaskModal(props, forwarded) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwarded, () => root.current!);
  useModalLayer(root);
  return <div {...props} ref={root} data-task-modal onClick={(event) => { props.onClick?.(event); event.stopPropagation(); }} onDragOver={(event) => { props.onDragOver?.(event); event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { props.onDrop?.(event); event.preventDefault(); event.stopPropagation(); }} role={props.role ?? 'dialog'} aria-modal="true" tabIndex={-1} />;
});
