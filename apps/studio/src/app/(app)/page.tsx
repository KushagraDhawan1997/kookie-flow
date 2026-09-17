import type { Metadata } from 'next';
import { HomePage } from './home/home-page';

export const metadata: Metadata = { title: 'Home' };

/** Signed-in only: the group's layout redirects anyone without a session before this renders. */
export default function Page() {
  return <HomePage />;
}
