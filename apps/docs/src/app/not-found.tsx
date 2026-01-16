import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '404 - Page Not Found',
  description: 'The page you are looking for does not exist.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
        background: '#0a0a0a',
        color: '#ffffff',
      }}
    >
      <h1 style={{ fontSize: '4rem', fontWeight: 700, margin: 0 }}>404</h1>
      <p
        style={{
          fontSize: '1.25rem',
          color: '#888',
          marginTop: '1rem',
          marginBottom: '2rem',
        }}
      >
        The page you are looking for does not exist.
      </p>
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.75rem 1.5rem',
          background: '#ffffff',
          color: '#0a0a0a',
          borderRadius: '8px',
          fontWeight: 500,
          textDecoration: 'none',
          transition: 'opacity 0.2s',
        }}
      >
        Go Home
      </Link>
    </main>
  );
}
