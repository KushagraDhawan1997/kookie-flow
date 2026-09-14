/**
 * Which provider answers jobs. Chosen by environment, never by the caller: `STUDIO_PROVIDER`
 * names one outright, and without it a key means fal and no key means the mock — so adding a key
 * is the whole of switching to real generations, and `STUDIO_PROVIDER=mock` is the way back while
 * keeping the key around.
 */

import { falProvider } from './fal';
import { mockProvider } from './mock';
import type { Provider } from './provider';

export function getProvider(): Provider {
  const stated = process.env.STUDIO_PROVIDER?.trim().toLowerCase();
  if (stated === 'fal') return falProvider;
  if (stated === 'mock') return mockProvider;
  return process.env.FAL_KEY?.trim() ? falProvider : mockProvider;
}

/** The provider a row was submitted to, which is the one that must be asked about it. */
export function providerById(id: string): Provider | undefined {
  if (id === 'fal') return falProvider;
  if (id === 'mock') return mockProvider;
  return undefined;
}
