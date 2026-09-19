/** Starter asks under Home's box. Choosing one puts its words in the box; the agent does the rest. */
export interface Starter {
  id: string;
  label: string;
  ask: string;
}

export const STARTERS: Starter[] = [
  { id: 'concept', label: 'Concept a product', ask: 'Concept art for a controller for a handheld games console' },
  { id: 'launch', label: 'Launch images', ask: 'Launch images for a new sneaker, from this product shot' },
  { id: 'animate', label: 'Animate a photo', ask: 'Animate this photo: mist rolling slowly over the ridge' },
  { id: 'relight', label: 'Relight a portrait', ask: 'Relight this portrait three ways: golden hour, studio, overcast' },
];
