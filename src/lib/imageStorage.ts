const supportedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export function isSupportedImage(file: File): boolean {
  return supportedImageTypes.has(file.type);
}

export function createStorageId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function fileExtension(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  return extension.replace(/[^a-z0-9]/g, '') || 'jpg';
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
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
