import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';
import {
  Blockquote,
  Box,
  Code,
  Heading,
  Link,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@kookie-ui/react';

/**
 * The prose element map for MDX, replacing `createMarkdownComponents` from
 * `@kushagradhawan/kookie-blocks`.
 *
 * The block's three config options — `inlineCodeHighContrast`, `codeBlockCollapsible`,
 * `spacing` — are gone rather than translated. The first names a prop v2 refuses on
 * principle (contrast is an app-wide `<Theme contrast>` setting, not a per-atom choice), the
 * second controlled a feature this site never used, and the third is spacing this map states
 * directly.
 *
 * Headings keep their `id`: `rehype-slug` writes it and TableOfContents scans for it.
 */
/**
 * v2 components set no outer spacing — a margin belongs to the layout that holds a thing,
 * not to the thing. So each block is wrapped rather than given a margin prop.
 */
const heading =
  (
    size: ComponentProps<typeof Heading>['size'],
    mt: ComponentProps<typeof Box>['mt'],
    mb: ComponentProps<typeof Box>['mb']
  ) =>
  ({ children, ...props }: ComponentProps<'h1'>) => (
    <Box mt={mt} mb={mb}>
      <Heading size={size} weight="medium" {...props}>
        {children}
      </Heading>
    </Box>
  );

export const markdownComponents: MDXComponents = {
  h1: heading('7', '0', '4'),
  h2: heading('6', '8', '4'),
  h3: heading('4', '6', '3'),
  h4: heading('3', '5', '2'),
  h5: heading('2', '4', '2'),
  h6: heading('2', '4', '2'),

  p: ({ children, ...props }) => (
    <Box mb="4">
      <Text render={<p />} size="3" {...props}>
        {children}
      </Text>
    </Box>
  ),

  a: ({ children, href, ...props }) => (
    <Link href={href} {...props}>
      {children}
    </Link>
  ),

  ul: (props) => <ul style={{ paddingLeft: '1.25rem', marginBottom: 'var(--space-4)' }} {...props} />,
  ol: (props) => <ol style={{ paddingLeft: '1.25rem', marginBottom: 'var(--space-4)' }} {...props} />,
  li: ({ children, ...props }) => (
    <li style={{ marginBottom: 'var(--space-1)' }} {...props}>
      <Text size="3">{children}</Text>
    </li>
  ),

  blockquote: ({ children, ...props }) => <Blockquote {...props}>{children}</Blockquote>,
  hr: () => (
    <Box my="6">
      <Separator />
    </Box>
  ),

  table: (props) => (
    <Box my="4" style={{ overflowX: 'auto' }}>
      <Table {...props} />
    </Box>
  ),
  thead: (props) => <TableHeader {...props} />,
  tbody: (props) => <TableBody {...props} />,
  tr: (props) => <TableRow {...props} />,
  th: (props) => <TableHead {...props} />,
  td: (props) => <TableCell {...props} />,

  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" style={{ maxWidth: '100%', height: 'auto' }} {...props} />
  ),

  code: ({ children, className, ...props }) => {
    // Blocks with a language are handled by rehype-pretty-code; leave them alone.
    if (className?.includes('language-')) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return <Code size="3">{children}</Code>;
  },
};
