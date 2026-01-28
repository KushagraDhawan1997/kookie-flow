import type { DocsNavigationConfig } from '@kushagradhawan/kookie-blocks';
import {
  Download01Icon,
  FlowIcon,
  GridIcon,
  Link01Icon,
  Settings01Icon,
  Clipboard01Icon,
  Keyboard01Icon,
  ArrowTurnBackwardIcon,
  Menu01Icon,
} from '@hugeicons/core-free-icons';

export const docsNavigation: DocsNavigationConfig = {
  groups: [
    {
      label: 'Get Started',
      items: [
        {
          href: '/docs/installation',
          title: 'Installation',
          icon: Download01Icon,
        },
        {
          href: '/docs/quick-start',
          title: 'Quick Start',
          icon: FlowIcon,
        },
      ],
    },
    {
      label: 'Core Concepts',
      items: [
        {
          href: '/docs/nodes',
          title: 'Nodes',
          icon: GridIcon,
        },
        {
          href: '/docs/edges',
          title: 'Edges',
          icon: Link01Icon,
        },
      ],
    },
    {
      label: 'Plugins',
      items: [
        {
          href: '/docs/plugins/clipboard',
          title: 'Clipboard',
          icon: Clipboard01Icon,
        },
        {
          href: '/docs/plugins/keyboard-shortcuts',
          title: 'Keyboard Shortcuts',
          icon: Keyboard01Icon,
        },
        {
          href: '/docs/plugins/undo-redo',
          title: 'Undo/Redo',
          icon: ArrowTurnBackwardIcon,
        },
        {
          href: '/docs/plugins/context-menu',
          title: 'Context Menu',
          icon: Menu01Icon,
        },
      ],
    },
    {
      label: 'API Reference',
      items: [
        {
          href: '/docs/api/kookie-flow',
          title: 'KookieFlow',
          icon: Settings01Icon,
        },
        {
          href: '/docs/api/use-graph',
          title: 'useGraph',
          icon: Settings01Icon,
        },
        {
          href: '/docs/api/use-flow-store-api',
          title: 'useFlowStoreApi',
          icon: Settings01Icon,
        },
      ],
    },
  ],
};
