import { afterEach, expect, it, vi } from 'vitest';
import { ImageTextureManager } from './image-loader';

const managers: ImageTextureManager[] = [];
afterEach(() => {
  managers.forEach((manager) => manager.disposeAll());
  managers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

function bitmap() {
  return { width: 256, height: 256, close: vi.fn() } as unknown as ImageBitmap;
}

async function board(count: number) {
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }));
  const decode = vi.fn(async () => bitmap());
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('createImageBitmap', decode);
  const ready = vi.fn();
  const manager = new ImageTextureManager(ready);
  managers.push(manager);
  const sources = Array.from({ length: count }, (_, i) => `image-${i}.png`);
  sources.forEach((src) => manager.acquire(src));
  await settle();
  manager.processUploadQueue(count);
  return { manager, sources, fetcher, decode, ready };
}

function frame(manager: ImageTextureManager, sources: string[], width = 300) {
  manager.processUploadQueue(2);
  manager.beginFrame();
  sources.forEach((src) => manager.getTexture(src, width));
  manager.endFrame();
}

it.each([32, 33, 128])(
  'a stationary %i-image viewport settles within the full-tier budget',
  async (count) => {
    const { manager, sources, fetcher, decode } = await board(count);
    for (let i = 0; i < 100; i++) {
      frame(manager, sources);
      await settle();
    }
    expect(sources.filter((src) => manager.getEntry(src)?.full)).toHaveLength(32);
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(decode).toHaveBeenCalledTimes(count + 32);
    for (let i = 0; i < 100; i++) {
      frame(manager, sources);
      await settle();
    }
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(decode).toHaveBeenCalledTimes(count + 32);
  }
);

it('retains visible owners even when the traversal order changes, then admits an image when an owner leaves', async () => {
  const { manager, sources, decode } = await board(33);
  frame(manager, sources);
  await settle();
  manager.processUploadQueue(100);
  const oldTexture = manager.getEntry(sources[0])?.full;
  const oldBitmap = oldTexture?.image as ImageBitmap;
  frame(manager, [...sources].reverse());
  await settle();
  expect(decode).toHaveBeenCalledTimes(65);
  expect(manager.getEntry(sources[32])?.fullLoadState).toBe('idle');
  frame(manager, sources.slice(1));
  await settle();
  manager.processUploadQueue(100);
  expect(oldBitmap.close).toHaveBeenCalledOnce();
  expect(manager.getEntry(sources[0])?.full).toBeNull();
  expect(manager.getEntry(sources[32])?.full).not.toBeNull();
});

it('frees a zoomed-out owner and deduplicates shared sources in the visible pass', async () => {
  const { manager, sources } = await board(33);
  frame(manager, sources);
  await settle();
  manager.processUploadQueue(100);
  manager.beginFrame();
  manager.getTexture(sources[0], 128);
  sources.slice(1).forEach((src) => {
    manager.getTexture(src, 300);
    manager.getTexture(src, 300);
    manager.getTexture(src, 128);
  });
  manager.endFrame();
  await settle();
  manager.processUploadQueue(100);
  expect(manager.getEntry(sources[0])?.full).toBeNull();
  expect(sources.slice(1).filter((src) => manager.getEntry(src)?.full)).toHaveLength(32);
});

it('retains finished cold tiers while no waiting source needs their budget', async () => {
  const { manager, sources, decode, fetcher } = await board(32);
  frame(manager, sources);
  await settle();
  manager.processUploadQueue(100);
  frame(manager, sources, 128);
  frame(manager, []);
  frame(manager, sources);
  await settle();
  expect(sources.filter((src) => manager.getEntry(src)?.full)).toHaveLength(32);
  expect(fetcher).toHaveBeenCalledTimes(32);
  expect(decode).toHaveBeenCalledTimes(64);
});

it('closes an abandoned queued tier immediately and never publishes it into a new admission', async () => {
  const { manager, sources, decode } = await board(1);
  const stale = bitmap();
  decode.mockResolvedValueOnce(stale);
  frame(manager, sources);
  await settle();
  expect(manager.hasQueuedUploads).toBe(true);
  manager.beginFrame();
  manager.endFrame();
  expect(stale.close).toHaveBeenCalledOnce();
  frame(manager, sources);
  await settle();
  manager.processUploadQueue(100);
  expect(stale.close).toHaveBeenCalledOnce();
  expect(manager.getEntry(sources[0])?.full?.image).not.toBe(stale);
  expect(manager.getEntry(sources[0])?.full).not.toBeNull();
});

it('caps non-abortable full decodes across rapid viewport changes and wakes waiting work when they finish', async () => {
  const { manager, sources, decode, ready } = await board(64);
  const finish: Array<(value: ImageBitmap) => void> = [];
  decode.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  frame(manager, sources.slice(0, 32));
  await settle();
  expect(finish).toHaveLength(32);
  frame(manager, sources.slice(32));
  await settle();
  expect(finish).toHaveLength(32); // Cancelled native decodes still count until settled.
  ready.mockClear();
  const stale = bitmap();
  finish[0](stale);
  await settle();
  expect(stale.close).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalled();
  frame(manager, sources.slice(32));
  await settle();
  expect(finish).toHaveLength(33); // Exactly one returned slot is reused.
  for (const resolve of finish.slice(1)) resolve(bitmap());
  await settle();
  manager.processUploadQueue(100);
  expect(sources.slice(0, 32).every((src) => manager.getEntry(src)?.full === null)).toBe(true);
  expect(manager.getEntry(sources[32])?.full).not.toBeNull();
});

it('shares one budget between retained loaded tiers and cancelled unresolved decodes', async () => {
  const { manager, sources, decode } = await board(48);
  frame(manager, sources.slice(0, 16));
  await settle();
  manager.processUploadQueue(100);
  const finish: Array<(value: ImageBitmap) => void> = [];
  decode.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  frame(manager, sources.slice(0, 32));
  await settle();
  expect(finish).toHaveLength(16);
  const nextView = [...sources.slice(0, 16), ...sources.slice(32)];
  frame(manager, nextView);
  await settle();
  expect(finish).toHaveLength(16); // 16 retained textures + 16 orphaned decodes fill all 32 slots.
  const stale = bitmap();
  finish[0](stale);
  await settle();
  frame(manager, nextView);
  await settle();
  expect(stale.close).toHaveBeenCalledOnce();
  expect(finish).toHaveLength(17);
  for (const resolve of finish.slice(1)) resolve(bitmap());
  await settle();
});
