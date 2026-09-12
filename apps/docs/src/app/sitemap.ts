import type { MetadataRoute } from 'next';

import { CHAPTERS } from './(docs)/chapters';

const baseUrl = 'https://kookie-flow.vercel.app';

/** The front door, then every chapter, straight from the registry — so the sitemap cannot list
    a page that does not exist or miss one that does. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    ...CHAPTERS.map((chapter) => ({
      url: `${baseUrl}/${chapter.slug}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
