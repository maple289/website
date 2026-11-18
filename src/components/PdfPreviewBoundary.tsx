import { Component, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { logPdfFailure } from '@/lib/pdfDiagnostics';

export function PdfPreviewUnavailable({ allowDownload, onDownload, onClose, message }: {
  allowDownload: boolean; onDownload?: () => void; onClose?: () => void; message?: string;
}) {
  return <div role="alert" className="m-auto max-w-md p-5 text-center text-slate-700">
    <FileText size={36} className="mx-auto mb-3 text-slate-400" />
    <h3 className="font-semibold">Preview unavailable</h3>
    <p className="mt-2 text-sm">{message || 'This PDF could not be displayed.'}</p>
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {allowDownload && onDownload && <button onClick={onDownload} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white">Download PDF</button>}
      {onClose && <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold">Close</button>}
    </div>
  </div>;
}

export class PdfPreviewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(cause: Error) { logPdfFailure('viewer_module', cause); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
