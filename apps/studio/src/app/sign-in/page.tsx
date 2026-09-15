import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/shared/next-path';
import { currentUser } from '@/server/session';
import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <SignInForm next={next} />;
}
