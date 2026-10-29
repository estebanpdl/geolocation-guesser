import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Geolocation Guesser',
  description: 'OSINT geolocation training platform — develop analytical reasoning through structured hypothesis-driven practice',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-tactical-bg text-slate-200 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
