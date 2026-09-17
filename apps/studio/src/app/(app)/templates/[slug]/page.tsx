import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findTemplate } from '../templates';
import { TemplatePage } from '../template-page';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const template = findTemplate((await params).slug);
  return { title: template?.title ?? 'Template' };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const template = findTemplate((await params).slug);
  if (!template) notFound();
  return <TemplatePage slug={template.slug} />;
}
