import { mediaTypeError } from './mediaValidation';

export function isSupportedImage(file: File): boolean { return !mediaTypeError(file, 'photo'); }

export function createStorageId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function fileExtension(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  return extension.replace(/[^a-z0-9]/g, '') || 'jpg';
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // Canvas and FileReader produce base64 data URLs. Fetching those URLs is
  // blocked by the site's connect-src policy, even though img-src permits them.
  // Decode the existing local bytes instead of issuing a network request.
  try {
    const match = /^data:([^,]*);base64,([\s\S]*)$/i.exec(dataUrl);
    if (!match) throw new Error('Invalid image data URL');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
  } catch {
    throw new Error('The preview image could not be read. Choose an image or capture the frame again.');
  }
}

type ImageVariants = {
  preview: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
};

export async function createImageVariants(source: Blob): Promise<ImageVariants> {
  const url = URL.createObjectURL(source);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The selected image could not be processed.'));
      element.src = url;
    });

    const render = (maxWidth: number, maxHeight: number, quality: number) => {
      const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is not available in this browser.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('The image could not be encoded.')),
          'image/webp',
          quality,
        );
      });
    };

    const [preview, thumbnail] = await Promise.all([
      render(1600, 1600, 0.84),
      render(480, 480, 0.78),
    ]);

    return {
      preview,
      thumbnail,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
