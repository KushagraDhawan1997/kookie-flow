import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoTextureManager, MAX_PLAYING_VIDEOS } from './video-loader';

/**
 * The playback policy is the whole performance story of video entities: a playing video uploads a
 * frame per frame and a paused one uploads nothing, so what this class decides to play IS the
 * per-frame cost of a board. These are the rules that keep that cost bounded by what is on screen
 * rather than by what exists.
 *
 * jsdom has no media pipeline, so `play()` and `pause()` are stubbed and the assertions are about
 * the DECISIONS — which sources are allowed to decode — never about pixels.
 */

const played = new Set<HTMLVideoElement>();

beforeEach(() => {
  played.clear();
  // jsdom's play() throws "not implemented"; pause() is a no-op that does not clear `paused`.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    played.add(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLVideoElement
  ) {
    played.delete(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('what is allowed to decode', () => {
  it('plays nothing until something asks', () => {
    const m = new VideoTextureManager();
    m.acquire('a.mp4', true);
    expect(m.playingCount).toBe(0);
    m.disposeAll();
  });

  it('starts a source the render loop wants on screen', () => {
    const m = new VideoTextureManager();
    m.acquire('a.mp4', true);
    m.reconcilePlayback(new Set(['a.mp4']));
    expect(m.isPlaying('a.mp4')).toBe(true);
    m.disposeAll();
  });

  it('pauses a source that has dropped out of the wanted set', () => {
    // This is culling: an entity scrolled off the viewport is not iterated any more, so it cannot
    // ask to stop. The set says what should be playing and the difference does the rest.
    const m = new VideoTextureManager();
    m.acquire('a.mp4', true);
    m.reconcilePlayback(new Set(['a.mp4']));
    m.reconcilePlayback(new Set());
    expect(m.isPlaying('a.mp4')).toBe(false);
    m.disposeAll();
  });

  it('never decodes more than the cap, however many are on screen', () => {
    // Past the platform's decoder limit playback fails SILENTLY — black rectangles, no error
    // anywhere — so the cap is a correctness rule, not only a budget.
    const m = new VideoTextureManager();
    const srcs = Array.from({ length: MAX_PLAYING_VIDEOS + 3 }, (_, i) => `v${i}.mp4`);
    for (const s of srcs) m.acquire(s, true);
    m.reconcilePlayback(new Set(srcs));
    expect(m.playingCount).toBe(MAX_PLAYING_VIDEOS);
    m.disposeAll();
  });

  it('gives a starved source a slot once a playing one leaves', () => {
    const m = new VideoTextureManager();
    const srcs = Array.from({ length: MAX_PLAYING_VIDEOS + 1 }, (_, i) => `v${i}.mp4`);
    for (const s of srcs) m.acquire(s, true);
    m.reconcilePlayback(new Set(srcs));

    const starved = srcs.find((s) => !m.isPlaying(s));
    expect(starved).toBeDefined();

    // The board scrolls: everything that was playing goes away, the starved one stays wanted.
    m.reconcilePlayback(new Set([starved as string]));
    expect(m.isPlaying(starved as string)).toBe(true);
    m.disposeAll();
  });

  it('keeps a shared source playing while any entity still wants it', () => {
    // Two entities, one URL, one element. The manager is refcounted, so releasing one entity must
    // not stop the other's picture.
    const m = new VideoTextureManager();
    m.acquire('shared.mp4', true);
    m.acquire('shared.mp4', true);
    m.reconcilePlayback(new Set(['shared.mp4']));
    m.release('shared.mp4');
    expect(m.isPlaying('shared.mp4')).toBe(true);
    m.disposeAll();
  });
});

describe('teardown', () => {
  it.each(['resolve', 'reject'] as const)(
    'ignores an old play %s after the same URL is reacquired',
    async (outcome) => {
      let resolveOld!: () => void;
      let rejectOld!: (error: Error) => void;
      const pending = new Promise<void>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(pending);
      const m = new VideoTextureManager();
      try {
        const old = m.acquire('same.mp4', true);
        m.setPlaying('same.mp4', true);
        m.release('same.mp4');
        expect(old.wantsPlay).toBe(false);
        const current = m.acquire('same.mp4', true);
        m.setPlaying('same.mp4', true);
        for (let i = 1; i < MAX_PLAYING_VIDEOS; i++) {
          m.acquire(`other-${i}.mp4`, true);
          m.setPlaying(`other-${i}.mp4`, true);
        }
        await Promise.resolve();
        if (outcome === 'resolve') {
          // A browser may finish the pending start after the element was paused for release.
          played.add(old.element);
          resolveOld();
        } else rejectOld(new Error('AbortError from the released source'));
        await Promise.resolve();
        expect(m.getEntry('same.mp4')).toBe(current);
        expect(m.isPlaying('same.mp4')).toBe(true);
        expect(current.wantsPlay).toBe(true);
        expect(played.has(old.element)).toBe(false);
        expect(played.has(current.element)).toBe(true);
        expect(m.playingCount).toBe(MAX_PLAYING_VIDEOS);
        m.acquire('overflow.mp4', true);
        expect(m.setPlaying('overflow.mp4', true)).toBe(false);
      } finally {
        m.disposeAll();
      }
    }
  );

  it('honours a pause while the current play promise is pending', async () => {
    let resolvePlay!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      })
    );
    const m = new VideoTextureManager();
    try {
      const entry = m.acquire('pause.mp4', true);
      m.setPlaying('pause.mp4', true);
      m.setPlaying('pause.mp4', false);
      played.add(entry.element);
      resolvePlay();
      await Promise.resolve();
      expect(m.isPlaying('pause.mp4')).toBe(false);
      expect(played.has(entry.element)).toBe(false);
    } finally {
      m.disposeAll();
    }
  });

  it('does not resume a pending play after renewed demand is denied by the decoder cap', async () => {
    let resolvePlay!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      })
    );
    const m = new VideoTextureManager();
    try {
      const waiting = m.acquire('waiting.mp4', true);
      m.setPlaying('waiting.mp4', true);
      m.setPlaying('waiting.mp4', false);
      for (let i = 0; i < MAX_PLAYING_VIDEOS; i++) {
        m.acquire(`active-${i}.mp4`, true);
        m.setPlaying(`active-${i}.mp4`, true);
      }
      expect(m.setPlaying('waiting.mp4', true)).toBe(false);
      played.add(waiting.element);
      resolvePlay();
      await Promise.resolve();
      expect(waiting.wantsPlay).toBe(true);
      expect(m.isPlaying('waiting.mp4')).toBe(false);
      expect(played.has(waiting.element)).toBe(false);
      expect(played.size).toBe(MAX_PLAYING_VIDEOS);
    } finally {
      m.disposeAll();
    }
  });

  it('stops decoding when the last reference goes', () => {
    const m = new VideoTextureManager();
    const entry = m.acquire('a.mp4', true);
    m.reconcilePlayback(new Set(['a.mp4']));
    m.release('a.mp4');
    expect(m.isPlaying('a.mp4')).toBe(false);
    expect(m.getEntry('a.mp4')).toBeUndefined();
    // Pausing alone leaves the decoder and the network buffer alive; the source must be cleared.
    expect(entry.element.getAttribute('src')).toBeNull();
  });

  it('disposeAll releases entries held by more than one entity', () => {
    // A naive loop that decrements once per src would leave every shared source alive on unmount.
    const m = new VideoTextureManager();
    m.acquire('a.mp4', true);
    m.acquire('a.mp4', true);
    m.acquire('b.mp4', true);
    m.disposeAll();
    expect(m.getEntry('a.mp4')).toBeUndefined();
    expect(m.getEntry('b.mp4')).toBeUndefined();
    expect(m.playingCount).toBe(0);
  });

  it('autoplay policy needs muted and inline, so the element must carry both', () => {
    // Without these every browser refuses play() on an element the user has not touched, and a
    // board of previews sits black with a rejected promise per entity.
    const m = new VideoTextureManager();
    const entry = m.acquire('a.mp4', true);
    expect(entry.element.muted).toBe(true);
    expect(entry.element.playsInline).toBe(true);
    m.disposeAll();
  });
});
