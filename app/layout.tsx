import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orchestrator Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white font-mono antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
