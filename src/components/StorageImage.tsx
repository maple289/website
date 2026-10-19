import { useContext, useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { AuthContext } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { resolveBucketPath } from '@/lib/storageSettings';
import { sharedImageUrl } from '@/lib/sharedMedia';

type StorageImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  storagePath?: string | null;
  legacyUrl?: string | null;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  publicAccess?: boolean;
};

export function StorageImage({ storagePath, legacyUrl, publicAccess = false, fallback = null, loadingFallback = fallback, ...imageProps }: StorageImageProps) {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? 'guest', token = auth?.session?.access_token;
  const [revision, setRevision] = useState(0);
  const key = `${storagePath ?? ''}:${legacyUrl ?? ''}:${publicAccess ? 'public' : userId}:${revision}`;
  const [image, setImage] = useState({ key, source: storagePath ? null : legacyUrl ?? null, loading: !!storagePath });

  useEffect(() => {
    const retry = () => setRevision(value => value + 1);
    window.addEventListener('storage-settings-changed', retry);
    window.addEventListener('media-access-changed', retry);
    return () => { window.removeEventListener('storage-settings-changed', retry); window.removeEventListener('media-access-changed', retry); };
  }, []);

  useEffect(() => {
    let active = true;
    // Keep a successfully loaded public image through auth transitions. Failed
    // attempts retry once per changed session/path/settings, never in a loop.
    setImage(current => current.key === key && current.source ? current : { key, source: storagePath ? null : legacyUrl ?? null, loading: !!storagePath });
    const load = async () => {
      if (!storagePath) return;
      let shared = false;
      try {
        const fullPath = await resolveBucketPath(storagePath, 'images');
        const { data, error } = await supabase.storage.from('user-images').createSignedUrl(fullPath, 3600);
        shared = !!token && (!!error || !data?.signedUrl);
        const source = !error && data?.signedUrl ? data.signedUrl : shared ? await sharedImageUrl(fullPath) : legacyUrl ?? null;
        if (active) setImage({ key, source, loading: false });
      } catch {
        if (active) setImage({ key, source: shared ? null : legacyUrl ?? null, loading: false });
      }
    };
    void load();

    return () => { active = false; };
  }, [storagePath, legacyUrl, key, userId, token]);

  if (image.key !== key || image.loading) return <>{loadingFallback}</>;
  if (!image.source) return <>{fallback}</>;
  return <img {...imageProps} src={image.source} onError={event => {
    setImage(current => current.key === key && current.source === image.source ? { ...current, source: null } : current);
    imageProps.onError?.(event);
  }} />;
}
