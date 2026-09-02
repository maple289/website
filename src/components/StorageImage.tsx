import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

type StorageImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  storagePath?: string | null;
  legacyUrl?: string | null;
  fallback?: ReactNode;
};

export function StorageImage({ storagePath, legacyUrl, fallback = null, ...imageProps }: StorageImageProps) {
  const [source, setSource] = useState<string | null>(storagePath ? null : legacyUrl ?? null);

  useEffect(() => {
    let active = true;
    setSource(storagePath ? null : legacyUrl ?? null);

    if (storagePath) {
      supabase.storage
        .from('user-images')
        .createSignedUrl(storagePath, 3600)
        .then(({ data, error }) => {
          if (active) setSource(error ? legacyUrl ?? null : data.signedUrl);
        });
    }

    return () => { active = false; };
  }, [storagePath, legacyUrl]);

  if (!source) return <>{fallback}</>;
  return <img {...imageProps} src={source} />;
}
