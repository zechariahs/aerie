// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aerie',
  description: 'Ops dashboard for autonomous agents',
  icons: { icon: '/aerie/favicon.svg' },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps): Promise<React.JSX.Element> {
  const headerStore = await headers();
  const nonce = headerStore.get('x-nonce') ?? '';

  return (
    <html lang="en" suppressHydrationWarning className={ibmPlexMono.variable}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Nonce is applied to inline scripts by Next.js when x-nonce is present */}
        <meta name="x-nonce" content={nonce} />
      </head>
      <body>{children}</body>
    </html>
  );
}
