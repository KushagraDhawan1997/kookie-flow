import { describe, expect, it } from 'vitest';
import { identityOf, jobKey } from './jobs';

describe('jobKey', () => {
  const picture = {
    kind: 'image',
    hash: 'h1',
    width: 4,
    height: 4,
    url: '/api/blob/h1.png',
    preview: '/api/blob/h1.png',
  };

  it('is the same for the same ask, however the picture is reached', async () => {
    const a = await jobKey('fal', 'edit-image', 'm', { prompt: 'x', image: picture, seed: 0 });
    const b = await jobKey('fal', 'edit-image', 'm', {
      seed: 0,
      image: { ...picture, url: 'https://elsewhere/h1.png', preview: undefined },
      prompt: 'x',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the seed, the model and the picture', async () => {
    const base = await jobKey('fal', 'edit-image', 'm', { prompt: 'x', image: picture, seed: 0 });
    expect(
      await jobKey('fal', 'edit-image', 'm', { prompt: 'x', image: picture, seed: 1 })
    ).not.toBe(base);
    expect(
      await jobKey('fal', 'edit-image', 'other', { prompt: 'x', image: picture, seed: 0 })
    ).not.toBe(base);
    expect(
      await jobKey('fal', 'edit-image', 'm', {
        prompt: 'x',
        image: { ...picture, hash: 'h2' },
        seed: 0,
      })
    ).not.toBe(base);
    expect(
      await jobKey('mock', 'edit-image', 'm', { prompt: 'x', image: picture, seed: 0 })
    ).not.toBe(base);
  });

  it('reduces a picture to its kind and hash, wherever it sits', () => {
    expect(identityOf({ a: picture, list: [picture, 2], n: 1 })).toEqual({
      a: 'image:h1',
      list: ['image:h1', 2],
      n: 1,
    });
  });
});
