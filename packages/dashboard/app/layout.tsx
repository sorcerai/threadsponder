import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Threadsponder',
  description: 'AI-powered Threads reply bot with trainable brand voice',
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
