import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import { AppShell } from './app-shell';

export const dynamic = 'force-dynamic';

/**
 * Every screen outside the editor lives in one frame: the sidebar stays put and only the pane
 * beside it changes. The editor is not in this group — a canvas wants the whole window.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  return (
    <AppShell name={user.name} email={user.email}>
      {children}
    </AppShell>
  );
}
