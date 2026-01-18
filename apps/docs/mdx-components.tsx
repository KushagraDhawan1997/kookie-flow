import type { MDXComponents } from 'mdx/types';
import { Code } from '@kushagradhawan/kookie-ui';
import {
  CodeBlock,
  useCodeBlockContext,
  createMarkdownComponents,
} from '@kushagradhawan/kookie-blocks';

const PreWrapper = ({
  children,
  className,
  ...props
}: React.ComponentProps<'pre'>) => {
  const isInsideCodeBlock = useCodeBlockContext();
  if (isInsideCodeBlock) {
    return (
      <pre className={className} {...props}>
        {children}
      </pre>
    );
  }
  return (
    <CodeBlock>
      <pre className={className} {...props}>
        {children}
      </pre>
    </CodeBlock>
  );
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  const baseComponents = createMarkdownComponents({
    inlineCodeHighContrast: true,
    codeBlockCollapsible: false,
    spacing: 'spacious',
  });

  return {
    ...baseComponents,
    code: ({ children, className, ...props }: any) => {
      // Code blocks with language are handled by rehype-pretty-code
      if (className?.includes('language-')) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      // Inline code
      return (
        <Code size="3" color="gray" variant="soft" highContrast>
          {children}
        </Code>
      );
    },
    pre: (props) => <PreWrapper {...props} />,
    CodeBlock,
    ...components,
  };
}
