'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

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
      <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
        Something went wrong
      </h1>
      <p
        style={{
          fontSize: '1rem',
          color: '#888',
          marginTop: '1rem',
          marginBottom: '2rem',
          maxWidth: '400px',
        }}
      >
        An unexpected error occurred. Please try again or return to the homepage.
      </p>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          onClick={reset}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#ffffff',
            color: '#0a0a0a',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
        >
          Try Again
        </button>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.75rem 1.5rem',
            background: 'transparent',
            color: '#ffffff',
            border: '1px solid #333',
            borderRadius: '8px',
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'border-color 0.2s',
          }}
        >
          Go Home
        </a>
      </div>
    </main>
  );
}
