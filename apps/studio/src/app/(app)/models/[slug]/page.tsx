import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findModel } from '../models';
import { ModelPage } from '../model-page';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: findModel((await params).slug)?.name ?? 'Model' };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const model = findModel((await params).slug);
  if (!model) notFound();
  return <ModelPage slug={model.slug} />;
}
