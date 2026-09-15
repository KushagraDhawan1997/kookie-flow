/**
 * The Stripe client, or null when there is no key. One per key per process: a dev reload
 * re-evaluates this module, and a key changed in `.env.local` while the server runs must get a new
 * client rather than keep sending to the account the old key named.
 */

import Stripe from 'stripe';

declare global {
  var __studioStripe: { key: string; client: Stripe } | undefined;
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (globalThis.__studioStripe?.key !== key) globalThis.__studioStripe = { key, client: new Stripe(key) };
  return globalThis.__studioStripe.client;
}
