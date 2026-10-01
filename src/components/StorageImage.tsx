import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { resolveBucketPath } from '@/lib/storageSettings';

type StorageImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  storagePath?: string | null;
  legacyUrl?: string | null;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
};

export function StorageImage({ storagePath, legacyUrl, fallback = null, loadingFallback = fallback, ...imageProps }: StorageImageProps) {
  const key = `${storagePath ?? ''}:${legacyUrl ?? ''}`;
  const [image, setImage] = useState({ key, source: storagePath ? null : legacyUrl ?? null, loading: !!storagePath });

  useEffect(() => {
    let active = true;
    setImage({ key, source: storagePath ? null : legacyUrl ?? null, loading: !!storagePath });
    const load = async () => {
      if (!storagePath) return;
      try {
        const fullPath = await resolveBucketPath(storagePath, 'images');
        const { data, error } = await supabase.storage.from('user-images').createSignedUrl(fullPath, 3600);
        if (active) setImage({ key, source: error ? legacyUrl ?? null : data?.signedUrl ?? legacyUrl ?? null, loading: false });
      } catch {
        if (active) setImage({ key, source: legacyUrl ?? null, loading: false });
      }
    };
    void load();

    return () => { active = false; };
  }, [storagePath, legacyUrl, key]);

  if (image.key !== key || image.loading) return <>{loadingFallback}</>;
  if (!image.source) return <>{fallback}</>;
  return <img {...imageProps} src={image.source} onError={event => {
    setImage(current => ({ ...current, source: null }));
    imageProps.onError?.(event);
  }} />;
}
