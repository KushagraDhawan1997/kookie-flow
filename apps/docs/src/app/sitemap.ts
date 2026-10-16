import type { MetadataRoute } from 'next';

import { CHAPTERS } from './(docs)/chapters';
import { SITE_URL } from './site';

/** The front door, then every chapter, straight from the registry — so the sitemap cannot list
    a page that does not exist or miss one that does. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: 'weekly', priority: 1 },
    ...CHAPTERS.map((chapter) => ({
      url: `${SITE_URL}/${chapter.slug}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    // Not a chapter, so the registry cannot list it.
    { url: `${SITE_URL}/whats-new`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
  ];
}
