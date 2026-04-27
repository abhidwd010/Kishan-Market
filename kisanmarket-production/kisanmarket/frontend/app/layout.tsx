// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'KisanMarket — Direct from farmer to buyer',
  description: 'Buy fresh produce directly from Indian farmers. No middlemen, no commission cuts. Fair prices for everyone.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
