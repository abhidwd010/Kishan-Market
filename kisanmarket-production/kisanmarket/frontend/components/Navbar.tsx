// components/Navbar.tsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { Sprout, ShoppingBasket, LogOut, LayoutDashboard } from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const handleLogout = () => { logout(); router.push('/'); };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-medium">
          <span className="w-8 h-8 rounded-full bg-kisan-100 text-kisan-900 flex items-center justify-center text-sm font-semibold">KM</span>
          <span>KisanMarket</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="flex items-center gap-1.5 text-gray-700 hover:text-kisan-900">
            <ShoppingBasket size={16} /> Browse
          </Link>
          {user?.role === 'farmer' && (
            <>
              <Link href="/sell" className="flex items-center gap-1.5 text-gray-700 hover:text-kisan-900">
                <Sprout size={16} /> Sell
              </Link>
              <Link href="/dashboard" className="flex items-center gap-1.5 text-gray-700 hover:text-kisan-900">
                <LayoutDashboard size={16} /> Dashboard
              </Link>
            </>
          )}
          {user?.role === 'buyer' && (
            <Link href="/dashboard" className="flex items-center gap-1.5 text-gray-700 hover:text-kisan-900">
              <LayoutDashboard size={16} /> My deals
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link href="/admin" className="flex items-center gap-1.5 text-gray-700 hover:text-kisan-900">
              <LayoutDashboard size={16} /> Admin
            </Link>
          )}
          {user ? (
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-gray-600 hover:text-red-600">
              <LogOut size={16} /> {user.name.split(' ')[0]}
            </button>
          ) : (
            <Link href="/login" className="btn-primary">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
