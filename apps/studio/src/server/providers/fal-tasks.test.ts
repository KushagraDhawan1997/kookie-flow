import { describe, expect, it } from 'vitest';
import type { MediaRef } from 'studio-core';
import { FAL_TASKS } from './fal-tasks';
import { JobFailed } from './provider';

const picture: MediaRef = {
  kind: 'image',
  hash: 'abc',
  width: 10,
  height: 10,
  url: '/api/blob/abc.png',
};
const mask: MediaRef = { kind: 'mask', hash: 'm1', width: 10, height: 10, url: '/api/blob/m1.png' };
const media = async (ref: MediaRef) => `https://cdn.example/${ref.hash}`;

describe('GPT Image 2.5 on fal', () => {
  const t = FAL_TASKS['gpt-image-2.5'];

  it('goes to the flavour the node chose, and to the edit endpoint when a picture is connected', () => {
    expect(t.endpoint({ variant: 'sunburst' })).toBe('openai/gpt-image-2.5/sunburst/text-to-image');
    expect(t.endpoint({})).toBe('openai/gpt-image-2.5/flare/text-to-image');
    expect(t.endpoint({ image: picture })).toBe('openai/gpt-image-2.5/flare/edit');
    expect(t.endpoint({ reference: picture, variant: 'sunburst' })).toBe(
      'openai/gpt-image-2.5/sunburst/edit'
    );
  });

  it("sends every control under the endpoint's name, and compression only with a lossy format", async () => {
    const input = {
      prompt: ' a fox ',
      size: 'auto',
      quality: 'high',
      background: 'transparent',
      format: 'png',
      compression: 80,
      reroll: 7,
    };
    expect(await t.body(input, media)).toEqual({
      prompt: 'a fox',
      image_size: 'auto',
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
      num_images: 1,
    });
    expect(await t.body({ ...input, format: 'jpeg' }, media)).toMatchObject({
      output_format: 'jpeg',
      output_compression: 80,
    });
    expect(
      await t.body({ ...input, size: 'custom', width: 1536, height: 1024 }, media)
    ).toMatchObject({
      image_size: { width: 1536, height: 1024 },
    });
  });

  it("falls back to the model's defaults for a choice it does not know", async () => {
    expect(
      await t.body(
        { prompt: 'x', quality: 'bogus', background: 3, format: 'bmp', size: 'huge' },
        media
      )
    ).toMatchObject({
      quality: 'medium',
      background: 'auto',
      output_format: 'png',
      image_size: 'auto',
    });
  });

  it('refuses what the endpoint would refuse before anything is sent', async () => {
    await expect(t.body({ prompt: '  ' }, media)).rejects.toBeInstanceOf(JobFailed);
    const custom = (width: number, height: number) =>
      t.body({ prompt: 'x', size: 'custom', width, height }, media);
    await expect(custom(512, 512)).rejects.toThrow('too small');
    await expect(custom(3840, 3840)).rejects.toThrow('too large');
    await expect(custom(3840, 1024)).rejects.toThrow('3 to 1');
    await expect(custom(4096, 1024)).rejects.toThrow('over 3840');
    await expect(custom(3840, 2160)).resolves.toBeTruthy();
  });

  it('edits with the picture, a reference and a mask as URLs fal can fetch', async () => {
    expect(await t.body({ prompt: 'night', image: picture }, media)).toEqual({
      prompt: 'night',
      image_size: 'auto',
      image_urls: ['https://cdn.example/abc'],
      quality: 'medium',
      background: 'auto',
      output_format: 'png',
      num_images: 1,
    });
    const full = await t.body(
      {
        prompt: 'night',
        image: picture,
        reference: { ...picture, hash: 'ref' },
        mask,
        size: 'square_hd',
      },
      media
    );
    expect(full).toMatchObject({
      image_urls: ['https://cdn.example/abc', 'https://cdn.example/ref'],
      mask_url: 'https://cdn.example/m1',
      image_size: 'square_hd',
    });
    // A mask with nothing to change is not an edit, and is not sent.
    expect(await t.body({ prompt: 'x', mask }, media)).not.toHaveProperty('mask_url');
  });

  it('takes the first image out of the answer, with only what fal states', () => {
    expect(
      t.files(
        {
          images: [
            { url: 'https://f/1.png', width: 1024, height: 1024, content_type: 'image/png' },
          ],
        },
        {}
      )
    ).toEqual([
      {
        name: 'image',
        kind: 'image',
        url: 'https://f/1.png',
        mime: 'image/png',
        width: 1024,
        height: 1024,
      },
    ]);
    expect(() => t.files({ images: [] }, {})).toThrow(JobFailed);
  });
});

describe('the other models on fal', () => {
  it('upscales with every knob, leaving the words to the model when the node did', async () => {
    const t = FAL_TASKS['clarity-upscaler'];
    expect(
      await t.body(
        {
          image: picture,
          factor: 3,
          creativity: 0.5,
          resemblance: 0.7,
          guidance: 6,
          steps: 20,
          seed: 9,
        },
        media
      )
    ).toEqual({
      image_url: 'https://cdn.example/abc',
      upscale_factor: 3,
      creativity: 0.5,
      resemblance: 0.7,
      guidance_scale: 6,
      num_inference_steps: 20,
      seed: 9,
    });
    expect(
      await t.body({ image: picture, prompt: 'crisp', negative: 'blurry' }, media)
    ).toMatchObject({ prompt: 'crisp', negative_prompt: 'blurry', upscale_factor: 2 });
    await expect(t.body({ factor: 2 }, media)).rejects.toThrow('image is not connected');
    expect(() => t.files({ image: {} }, {})).toThrow(JobFailed);
  });

  it('cuts out with the mask always asked for', async () => {
    const t = FAL_TASKS.birefnet;
    expect(
      await t.body(
        {
          image: picture,
          model: 'Portrait',
          resolution: '2048x2048',
          refine: false,
          format: 'webp',
        },
        media
      )
    ).toEqual({
      image_url: 'https://cdn.example/abc',
      model: 'Portrait',
      operating_resolution: '2048x2048',
      output_format: 'webp',
      refine_foreground: false,
      output_mask: true,
    });
    expect(
      t.files(
        {
          image: { url: 'https://f/cut.png', width: null },
          mask_image: { url: 'https://f/mask.png' },
        },
        {}
      )
    ).toEqual([
      { name: 'image', kind: 'image', url: 'https://f/cut.png' },
      { name: 'mask', kind: 'mask', url: 'https://f/mask.png' },
    ]);
  });

  it('animates inside what wan can make, and gives the clip the rate asked for', async () => {
    const t = FAL_TASKS['wan-i2v'];
    const body = await t.body(
      {
        prompt: 'pan',
        image: picture,
        frames: 200,
        fps: 30,
        resolution: '480p',
        aspect: '9:16',
        guidance: 3,
        shift: 2,
        steps: 12,
        expand: true,
        acceleration: 'none',
        seed: 4,
      },
      media
    );
    expect(body).toEqual({
      prompt: 'pan',
      image_url: 'https://cdn.example/abc',
      num_frames: 100,
      frames_per_second: 24,
      resolution: '480p',
      aspect_ratio: '9:16',
      guide_scale: 3,
      shift: 2,
      num_inference_steps: 12,
      enable_prompt_expansion: true,
      acceleration: 'none',
      seed: 4,
    });
    expect(await t.body({ prompt: 'pan', image: picture, negative: 'blur' }, media)).toMatchObject({
      num_frames: 81,
      frames_per_second: 16,
      negative_prompt: 'blur',
    });
    expect(
      t.files(
        { video: { url: 'https://v3.fal.media/x.mp4', content_type: 'video/mp4' } },
        { fps: 8 }
      )
    ).toEqual([
      {
        name: 'video',
        kind: 'video',
        url: 'https://v3.fal.media/x.mp4',
        mime: 'video/mp4',
        fps: 8,
      },
    ]);
  });
});
