import { afterEach, expect, it, vi } from 'vitest';
import { ImageTextureManager } from './image-loader';

const managers: ImageTextureManager[] = [];
afterEach(() => {
  for (const m of managers) m.disposeAll();
  managers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function loaded() {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 64, height: 64, close: vi.fn() }))
  );
  const fetchMock = vi.fn(
    async (_src: string, _options?: RequestInit): Promise<Response> =>
      ({ ok: true, status: 200, blob: async () => new Blob(['image']) }) as Response
  );
  vi.stubGlobal('fetch', fetchMock);
  const m = new ImageTextureManager();
  managers.push(m);
  m.acquire('image.png');
  await settle();
  m.processUploadQueue();
  expect(m.getEntry('image.png')?.state).toBe('loaded');
  vi.advanceTimersByTime(30_001);
  return { m, fetchMock };
}

it('A16: releasing an image aborts a deferred full-resolution refetch', async () => {
  const { m, fetchMock } = await loaded();
  let signal: AbortSignal | undefined | null;
  let resolve!: (r: Response) => void;
  fetchMock.mockImplementationOnce((_src, options) => {
    signal = options?.signal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  m.getTexture('image.png', 512);
  m.release('image.png');
  resolve(new Response(new Blob(['image']), { status: 200 }));
  await settle();
  expect(signal?.aborted).toBe(true);
});

it('A17: repeated texture queries do not immediately retry a failed full-resolution load', async () => {
  const { m, fetchMock } = await loaded();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock.mockRejectedValue(new Error('offline'));
  for (let frame = 0; frame < 3; frame++) {
    m.getTexture('image.png', 512);
    await settle();
  }
  expect(fetchMock).toHaveBeenCalledTimes(2); // Initial thumbnail plus one failed full-res attempt.
  vi.advanceTimersByTime(999);
  m.getTexture('image.png', 512);
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  m.getTexture('image.png', 512);
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1999);
  m.getTexture('image.png', 512);
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    blob: async () => new Blob(['image']),
  } as Response);
  m.getTexture('image.png', 512);
  await settle();
  m.processUploadQueue();
  expect(m.getEntry('image.png')?.full).not.toBeNull();
  expect(m.getEntry('image.png')?.fullFailures).toBe(0);
});

it('a decoded upload cannot attach to a later acquisition of the same URL', async () => {
  const { m } = await loaded();
  const staleBitmap = { width: 64, height: 64, close: vi.fn() };
  vi.mocked(createImageBitmap).mockResolvedValueOnce(staleBitmap as unknown as ImageBitmap);
  m.getTexture('image.png', 512);
  await settle();
  expect(m.hasQueuedUploads).toBe(true);
  m.release('image.png');
  const current = m.acquire('image.png');
  await settle();
  m.processUploadQueue(10);
  expect(staleBitmap.close).toHaveBeenCalledOnce();
  expect(current.thumbnail).not.toBeNull();
  expect(current.full).toBeNull();
});

it('a full decode completed after release closes its bitmap without publishing it', async () => {
  const { m } = await loaded();
  const staleBitmap = { width: 64, height: 64, close: vi.fn() };
  let finish!: (bitmap: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  m.getTexture('image.png', 512);
  await settle();
  m.release('image.png');
  const current = m.acquire('image.png');
  await settle();
  finish(staleBitmap as unknown as ImageBitmap);
  await settle();
  m.processUploadQueue(10);
  expect(staleBitmap.close).toHaveBeenCalledOnce();
  expect(current.full).toBeNull();
  expect(current.thumbnail).not.toBeNull();
});
