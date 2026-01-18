import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface DocMetadata {
  title: string;
  description?: string;
  category?: string;
}

const docsDirectory = path.join(process.cwd(), 'src/app/docs');

// Cache for metadata
const metadataCache = new Map<string, DocMetadata | null>();

export function getDocMetadata(slug: string): DocMetadata | null {
  // Normalize slug
  const normalizedSlug = slug.startsWith('/docs')
    ? slug.replace('/docs', '')
    : slug;
  const slugPath = normalizedSlug.startsWith('/')
    ? normalizedSlug.slice(1)
    : normalizedSlug;

  // Check cache
  if (metadataCache.has(slugPath)) {
    return metadataCache.get(slugPath) || null;
  }

  // Try to find content.mdx
  const mdxPath = path.join(docsDirectory, slugPath, 'content.mdx');

  try {
    if (fs.existsSync(mdxPath)) {
      const fileContents = fs.readFileSync(mdxPath, 'utf8');
      const { data } = matter(fileContents);

      const metadata: DocMetadata = {
        title: data.title || 'Untitled',
        description: data.description,
        category: data.category,
      };

      metadataCache.set(slugPath, metadata);
      return metadata;
    }
  } catch (error) {
    console.error(`Error reading metadata for ${slugPath}:`, error);
  }

  metadataCache.set(slugPath, null);
  return null;
}

// Cached version for use in generateMetadata
export const getCachedDocMetadata = getDocMetadata;
