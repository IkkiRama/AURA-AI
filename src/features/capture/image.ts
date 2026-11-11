import type { ImageInput, ImageMime } from '../ai/types';

export const ALLOWED_IMAGE_MIME: ImageMime[] = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2048;

export function validateImage(file: { type: string; size: number }): string | null {
  if (!ALLOWED_IMAGE_MIME.includes(file.type as ImageMime)) {
    return 'Format gambar tidak didukung. Gunakan PNG, JPG, atau WebP.';
  }
  if (file.size > MAX_IMAGE_BYTES) return 'Gambar terlalu besar. Maksimal 10 MB.';
  if (file.size === 0) return 'File gambar kosong.';
  return null;
}

/** Returns the first image file in a clipboard/drag payload, if any. */
export function pickImageFromItems(items: ArrayLike<DataTransferItem> | null | undefined): File | null {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads an image into RAM for sending. Large screenshots are downscaled to a
 * 2048px long edge (text stays legible) to save tokens. Nothing is written to
 * disk.
 */
export async function prepareImage(file: File): Promise<ImageInput> {
  const err = validateImage(file);
  if (err) throw new Error(err);
  let width = 0;
  let height = 0;
  let blob: Blob = file;
  let mime = file.type as ImageMime;
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    if (scale < 1 || file.size > 4 * 1024 * 1024) {
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bmp, 0, 0, w, h);
        const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        if (out) {
          blob = out;
          mime = 'image/jpeg';
          width = w;
          height = h;
        }
      }
    }
    bmp.close();
  }
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { mime, base64, bytes: blob.size, width, height };
}
