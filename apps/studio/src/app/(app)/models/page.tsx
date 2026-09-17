import type { Metadata } from 'next';
import { ModelsPage } from './models-page';

export const metadata: Metadata = { title: 'Models' };

export default function Page() {
  return <ModelsPage />;
}
