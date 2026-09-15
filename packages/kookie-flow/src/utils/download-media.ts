/**
 * Saving a piece of media to disk, for the download button media chrome draws.
 *
 * `<a download>` is ignored for a cross-origin URL — the browser navigates to it instead, and a
 * generated picture on a CDN would open in the tab rather than save. Fetching it into a blob first
 * makes the link same-origin, so the name sticks. A source that refuses the fetch (no CORS) is
 * opened in a new tab, where the browser's own save is one step away.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'video/quicktime': 'mov',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
};

/**
 * The name a saved file gets: the URL's own file name when it has one with an extension, otherwise
 * the kind of media with an extension read from the content type.
 */
export function downloadFileName(src: string, kind: 'image' | 'video' | 'mesh', mimeType: string): string {
  if (!src.startsWith('data:') && !src.startsWith('blob:')) {
    const path = src.split(/[?#]/)[0] ?? '';
    const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  }
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = MIME_EXTENSIONS[type] ?? (/^[a-z]+\/([a-z0-9]+)$/.exec(type)?.[1] ?? '');
  return ext ? `${kind}.${ext}` : kind;
}

export async function downloadMedia(src: string, kind: 'image' | 'video' | 'mesh'): Promise<void> {
  let blob: Blob;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (err: unknown) {
    console.warn(`[KookieFlow] Download fetch failed for "${src}", opening it instead:`, err);
    window.open(src, '_blank', 'noopener');
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadFileName(src, kind, blob.type);
  link.click();
  // Safari starts the save after the click returns; revoking at once cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
