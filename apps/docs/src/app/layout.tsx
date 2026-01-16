import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kookie Flow',
  description:
    "WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
