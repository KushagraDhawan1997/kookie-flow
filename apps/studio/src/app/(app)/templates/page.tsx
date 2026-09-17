import type { Metadata } from 'next';
import { TemplatesPage } from './templates-page';

export const metadata: Metadata = { title: 'Templates' };

export default function Page() {
  return <TemplatesPage />;
}
