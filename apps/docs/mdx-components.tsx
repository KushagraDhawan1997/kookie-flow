import type { MDXComponents } from 'mdx/types';
import { CodeBlock } from '@kookie-ui/react';

import { markdownComponents } from '@/components/blocks/markdown-components';

/**
 * v2 ships `CodeBlock` itself, so the block package's wrapper and its
 * `useCodeBlockContext` nesting guard are gone: there is no second CodeBlock to nest inside.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...markdownComponents,
    CodeBlock,
    ...components,
  };
}
