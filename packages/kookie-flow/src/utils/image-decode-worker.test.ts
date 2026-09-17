import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageDecodeWorker, WorkerUnavailableError } from './image-decode-worker';
import { ImageTextureManager } from './image-loader';

interface DecodeRequest {
  id: number;
  maxDim: number;
  blob: Blob;
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static constructionError: Error | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  requests: DecodeRequest[] = [];
  postError: Error | null = null;
  terminate = vi.fn();

  constructor() {
    super();
    FakeWorker.instances.push(this);
    if (FakeWorker.constructionError) throw FakeWorker.constructionError;
  }

  postMessage(request: DecodeRequest) {
    if (this.postError) throw this.postError;
    this.requests.push(request);
  }

  fail(type: 'error' | 'messageerror' = 'error') {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      message: 'Worker blocked',
    });
    if (type === 'error') this.onerror?.(event);
    else this.onmessageerror?.(event);
    this.dispatchEvent(event);
  }

  reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

function worker(): FakeWorker {
  const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
  if (!instance) throw new Error('Expected a worker');
  return instance;
}

function bitmap(width = 64, height = 32): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.constructionError = null;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('image worker infrastructure failures', () => {
  it.each(['error', 'messageerror'] as const)(
    'settles every queued request after asynchronous %s',
    async (event) => {
      const decoder = new ImageDecodeWorker();
      expect(decoder.tryStart()).toBe(true);
      const results = Promise.allSettled([
        decoder.decode(64, new Blob()),
        decoder.decode(128, new Blob()),
      ]);
      const failed = worker();
      await Promise.resolve(); // The constructor already returned; this is an asynchronous failure.
      failed.fail(event);
      for (const result of await results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason).toBeInstanceOf(WorkerUnavailableError);
      }
      expect(failed.terminate).toHaveBeenCalledTimes(1);
      expect(decoder.tryStart()).toBe(false);
      await expect(decoder.decode(64, new Blob())).rejects.toBeInstanceOf(WorkerUnavailableError);
      expect(FakeWorker.instances).toHaveLength(1);
      decoder.dispose();
      expect(failed.terminate).toHaveBeenCalledTimes(1);
    }
  );

  it('revokes the source URL when construction throws and never retries that facade', async () => {
    FakeWorker.constructionError = new DOMException('Blocked', 'SecurityError');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const decoder = new ImageDecodeWorker();
    expect(decoder.tryStart()).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
    await expect(decoder.decode(64, new Blob())).rejects.toBeInstanceOf(WorkerUnavailableError);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects existing and new requests when postMessage throws', async () => {
    const decoder = new ImageDecodeWorker();
    const first = decoder.decode(64, new Blob());
    worker().postError = new DOMException('Cannot post', 'DataCloneError');
    const results = await Promise.allSettled([first, decoder.decode(64, new Blob())]);
    expect(
      results.every(
        (result) => result.status === 'rejected' && result.reason instanceof WorkerUnavailableError
      )
    ).toBe(true);
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });

  it('keeps bad-image replies distinct from infrastructure failure', async () => {
    const decoder = new ImageDecodeWorker();
    const first = decoder.decode(64, new Blob());
    worker().reply({ id: worker().requests[0].id, ok: false, error: 'Invalid image' });
    await expect(first).rejects.toThrow('Invalid image');
    expect(worker().terminate).not.toHaveBeenCalled();
    const second = decoder.decode(64, new Blob());
    const image = bitmap();
    worker().reply({
      id: worker().requests[1].id,
      ok: true,
      bitmap: image,
      naturalWidth: 64,
      naturalHeight: 32,
    });
    expect((await second).bitmap).toBe(image);
    expect(FakeWorker.instances).toHaveLength(1);
    decoder.dispose();
  });

  it.each(['failure', 'disposal'] as const)(
    'closes transferred replies arriving after %s',
    async (operation) => {
      const decoder = new ImageDecodeWorker();
      const pending = decoder.decode(64, new Blob()).catch((error) => error);
      const oldWorker = worker();
      if (operation === 'failure') oldWorker.fail();
      else decoder.dispose();
      const rejection = await pending;
      expect(rejection).toBeInstanceOf(Error);
      if (operation === 'disposal') expect(rejection).not.toBeInstanceOf(WorkerUnavailableError);
      const image = bitmap();
      oldWorker.reply({
        id: oldWorker.requests[0].id,
        ok: true,
        bitmap: image,
        naturalWidth: 64,
        naturalHeight: 32,
      });
      expect(image.close).toHaveBeenCalledTimes(1);
      expect(decoder.tryStart()).toBe(false);
      decoder.dispose();
    }
  );
});

describe('image manager worker fallback', () => {
  it('retries in-flight thumbnails on the main thread and uses it for future images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }))
    );
    const createBitmap = vi.fn(async () => bitmap());
    vi.stubGlobal('createImageBitmap', createBitmap);
    const manager = new ImageTextureManager();
    try {
      manager.acquire('a');
      manager.acquire('b');
      await vi.waitFor(() => expect(worker().requests).toHaveLength(2));
      worker().fail();
      await vi.waitFor(() => {
        expect(manager.getEntry('a')?.state).toBe('loaded');
        expect(manager.getEntry('b')?.state).toBe('loaded');
      });
      manager.processUploadQueue(4);
      expect(manager.getEntry('a')?.thumbnail).not.toBeNull();
      expect(manager.getEntry('b')?.thumbnail).not.toBeNull();
      manager.acquire('c');
      await vi.waitFor(() => expect(manager.getEntry('c')?.state).toBe('loaded'));
      expect(createBitmap).toHaveBeenCalledTimes(3);
      expect(FakeWorker.instances).toHaveLength(1);
    } finally {
      manager.disposeAll();
    }
  });

  it('retries a failed full-resolution worker decode without refetching or entering backoff', async () => {
    const fetchImage = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }));
    vi.stubGlobal('fetch', fetchImage);
    const createBitmap = vi.fn(async () => bitmap(512, 256));
    vi.stubGlobal('createImageBitmap', createBitmap);
    const manager = new ImageTextureManager();
    try {
      manager.acquire('a');
      await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
      worker().reply({
        id: worker().requests[0].id,
        ok: true,
        bitmap: bitmap(),
        naturalWidth: 512,
        naturalHeight: 256,
      });
      await vi.waitFor(() => expect(manager.getEntry('a')?.state).toBe('loaded'));
      manager.processUploadQueue(4);
      manager.getTexture('a', 512);
      await vi.waitFor(() => expect(worker().requests).toHaveLength(2));
      worker().fail('messageerror');
      await vi.waitFor(() => expect(createBitmap).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => {
        manager.processUploadQueue(4);
        expect(manager.getEntry('a')?.full).not.toBeNull();
      });
      expect(manager.getEntry('a')?.fullFailures ?? 0).toBe(0);
      expect(manager.getEntry('a')?.fullLoadState).toBe('idle');
      expect(fetchImage).toHaveBeenCalledTimes(1);
      expect(FakeWorker.instances).toHaveLength(1);
    } finally {
      manager.disposeAll();
    }
  });
});
