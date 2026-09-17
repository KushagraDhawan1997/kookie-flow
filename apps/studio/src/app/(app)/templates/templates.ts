/**
 * MOCK TEMPLATES. Nothing here is a real graph yet: the words, the steps and the prices are what a
 * template page should say once templates exist. Pictures are grey boxes at the size they would be.
 * "Use template" makes an empty graph under the template's name.
 */

export type TemplateKind = 'image' | 'video' | 'edit';

/** An input with `text` is words a person types; one without is a picture they drop in. */
export interface TemplateInput {
  label: string;
  text?: string;
}

export interface TemplateOutput {
  label: string;
  /** The output is a clip. */
  video?: boolean;
  /** Width over height, where the output is not the grid's 4:3. */
  ratio?: string;
}

export interface TemplateStep {
  /** The node, named as the canvas names it. */
  node: string;
  does: string;
}

export interface Template {
  slug: string;
  title: string;
  /** One sentence, for the tile and under the title. */
  summary: string;
  kind: TemplateKind;
  inputs: TemplateInput[];
  outputs: TemplateOutput[];
  steps: TemplateStep[];
  /** What a run costs you, in US dollars. */
  price: number;
}

export const TEMPLATES: Template[] = [
  {
    slug: 'furniture-in-a-room',
    title: 'Place furniture in a room',
    summary: 'Drop in a product shot and get it styled into finished interiors.',
    kind: 'edit',
    inputs: [
      { label: 'Product' },
      { label: 'Room', text: 'A bright Scandinavian living room, oak floor, late afternoon light' },
    ],
    outputs: [
      { label: 'Reading corner' },
      { label: 'Living room' },
    ],
    steps: [
      { node: 'BiRefNet', does: 'Cuts the product out of its background.' },
      { node: 'GPT Image 2.5', does: 'Places it in the room you describe, matching the light.' },
      { node: 'Clarity Upscaler', does: 'Sharpens the result to print size.' },
    ],
    price: 0.31,
  },
  {
    slug: 'lookbook-from-a-brief',
    title: 'Lookbook from a brief',
    summary: 'Write a season in a sentence and get four looks that belong together.',
    kind: 'image',
    inputs: [{ label: 'Brief', text: 'Sun-faded sportswear, saffron and denim, shot against open sky' }],
    outputs: [
      { label: 'Look 1' },
      { label: 'Look 2' },
      { label: 'Look 3' },
      { label: 'Look 4' },
    ],
    steps: [
      { node: 'Text', does: 'Splits the brief into four shot descriptions.' },
      { node: 'GPT Image 2.5', does: 'Makes each look, with the same palette and light.' },
    ],
    price: 0.6,
  },
  {
    slug: 'photo-to-motion',
    title: 'Photo to motion',
    summary: 'Turn a still into a five-second clip with slow, natural movement.',
    kind: 'video',
    inputs: [
      { label: 'Photo' },
      { label: 'Motion', text: 'Stars drift slowly, a thin mist rolls over the ridge' },
    ],
    outputs: [{ label: 'Clip, 5 s', video: true, ratio: '16 / 9' }],
    steps: [{ node: 'Wan Image to Video', does: 'Animates the photo the way the motion prompt says.' }],
    price: 0.6,
  },
  {
    slug: 'upscale-for-print',
    title: 'Upscale for print',
    summary: 'Take a web-size photo to four times the resolution, with detail restored.',
    kind: 'edit',
    inputs: [{ label: 'Photo' }],
    outputs: [{ label: '4× upscale', ratio: '16 / 9' }],
    steps: [{ node: 'Clarity Upscaler', does: 'Enlarges the photo and restores fine detail.' }],
    price: 0.18,
  },
  {
    slug: 'portrait-relight',
    title: 'Relight a portrait',
    summary: 'Keep the person, change the light: golden hour, studio key or overcast.',
    kind: 'edit',
    inputs: [
      { label: 'Portrait' },
      { label: 'Light', text: 'Three looks: golden hour, hard studio key, soft overcast' },
    ],
    outputs: [
      { label: 'Golden hour' },
      { label: 'Studio key' },
      { label: 'Overcast' },
    ],
    steps: [
      { node: 'BiRefNet', does: 'Separates the person from the background.' },
      { node: 'GPT Image 2.5', does: 'Relights them once for each look you list.' },
    ],
    price: 0.45,
  },
  {
    slug: 'clean-cutout',
    title: 'Clean cutout',
    summary: 'Lift any object off its background, with a mask to keep editing.',
    kind: 'edit',
    inputs: [{ label: 'Photo' }],
    outputs: [
      { label: 'Cutout' },
      { label: 'Mask' },
    ],
    steps: [{ node: 'BiRefNet', does: 'Finds the object and returns it with a mask.' }],
    price: 0.01,
  },
  {
    slug: 'moodboard-from-a-word',
    title: 'Moodboard from a word',
    summary: 'One word in, a board of colour and texture out, ready to pin.',
    kind: 'image',
    inputs: [{ label: 'Word', text: 'Tidal' }],
    outputs: [
      { label: 'Surface' },
      { label: 'Glow' },
      { label: 'Fold' },
      { label: 'Depth' },
    ],
    steps: [
      { node: 'Text', does: 'Expands the word into four visual directions.' },
      { node: 'GPT Image 2.5', does: 'Makes a texture for each direction.' },
    ],
    price: 0.6,
  },
  {
    slug: 'resize-for-every-feed',
    title: 'Resize for every feed',
    summary: 'One product shot, cropped for square, portrait and story formats. No model, no cost.',
    kind: 'edit',
    inputs: [{ label: 'Photo' }],
    outputs: [
      { label: '1:1', ratio: '1 / 1' },
      { label: '4:5', ratio: '4 / 5' },
      { label: '9:16', ratio: '9 / 16' },
    ],
    steps: [
      { node: 'Crop', does: 'Crops around the subject for each format.' },
      { node: 'Resize', does: 'Sizes each crop to the platform’s pixels.' },
    ],
    price: 0,
  },
  {
    slug: 'product-on-colour',
    title: 'Product on colour',
    summary: 'Set a product on a bold seamless backdrop in your brand colours.',
    kind: 'image',
    inputs: [
      { label: 'Product' },
      { label: 'Colours', text: 'Sunflower yellow, cobalt, off-white' },
    ],
    outputs: [
      { label: 'Sunflower' },
      { label: 'Cobalt' },
      { label: 'Off-white' },
    ],
    steps: [
      { node: 'BiRefNet', does: 'Cuts the product out.' },
      { node: 'GPT Image 2.5', does: 'Sets it on each colour with a soft floor shadow.' },
    ],
    price: 0.46,
  },
];

export const KIND_LABEL: Record<TemplateKind, string> = { image: 'Image', video: 'Video', edit: 'Edit' };

export function findTemplate(slug: string): Template | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
