import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fetchFileServerUrl } from '@/lib/storageSettings';

export function ExternalFileServerLink() {
  const [href, setHref] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const value = await fetchFileServerUrl();
        const url = value ? new URL(/^[a-z]+:/i.test(value) ? value : `http://${value}`) : null;
        if (alive) setHref(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '');
      } catch { if (alive) setHref(''); }
    };
    void refresh(); window.addEventListener('storage-settings-changed', refresh);
    return () => { alive = false; window.removeEventListener('storage-settings-changed', refresh); };
  }, []);
  return href ? <a className="group flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left text-[#c4c4c4] transition hover:bg-[#202020] hover:text-white" href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={20} /><span>External file server</span></a> : null;
}
