import { useId } from 'react';
import { Globe, Lock } from 'lucide-react';

export function MediaEditFields({ kind, name, onNameChange, visibility, onVisibilityChange, extension = '', disabled = false }: {
  kind: 'Video' | 'Photo'; name: string; onNameChange: (value: string) => void;
  visibility: 'private' | 'public'; onVisibilityChange: (value: 'private' | 'public') => void;
  extension?: string; disabled?: boolean;
}) {
  const id = useId();
  return <>
    <label htmlFor={id} className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">{kind} Name</label>
    <div className="mb-4 flex items-center gap-2">
      <input id={id} value={name} onChange={(event) => onNameChange(event.target.value)} disabled={disabled} autoFocus={kind === 'Photo'}
        className="h-11 min-w-0 flex-1 rounded-xl border border-[#3a3a3a] bg-[#121212] px-4 text-sm outline-none transition focus:border-[#4b86ff]" placeholder={`${kind} name`} />
      {extension && <span className="text-sm text-[#aaa]" title="Original extension is preserved">{extension}</span>}
    </div>
    <fieldset disabled={disabled} className="mb-5">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Visibility</legend>
      <div className="grid grid-cols-2 gap-2">
        {(['private', 'public'] as const).map((value) => <button key={value} type="button" aria-pressed={visibility === value} onClick={() => onVisibilityChange(value)}
          className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${visibility === value ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>
          {value === 'private' ? <Lock size={15} /> : <Globe size={15} />}{value === 'private' ? 'Private' : 'Public'}
        </button>)}
      </div>
    </fieldset>
  </>;
}
