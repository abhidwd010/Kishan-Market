// app/dashboard/page.tsx — Farmer & Buyer dashboard
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, fmtINR } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import toast from 'react-hot-toast';

export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'listings' | 'inquiries' | 'deals'>(user?.role === 'farmer' ? 'listings' : 'inquiries');
  const [listings, setListings] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);

  useEffect(() => {
    if (!user) { router.push('/login?redirect=/dashboard'); return; }
    refresh();
  }, [user, tab]);

  const refresh = async () => {
    try {
      if (user?.role === 'farmer' && tab === 'listings') {
        const r = await api.get('/api/v1/listings/me/all');
        setListings(r.data.items);
      }
      if (tab === 'inquiries') {
        const r = await api.get('/api/v1/inquiries');
        setInquiries(r.data.items);
      }
      if (tab === 'deals') {
        const r = await api.get('/api/v1/deals');
        setDeals(r.data.items);
      }
    } catch {}
  };

  if (!user) return null;

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium">Welcome back, {user.name.split(' ')[0]}</h1>
          <p className="text-sm text-gray-600">{user.role === 'farmer' ? `${user.district}, ${user.state}` : `Buyer · ${user.state}`}</p>
        </div>
        {user.role === 'farmer' && (
          <Link href="/sell" className="btn-primary">+ Add new listing</Link>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {user.role === 'farmer' && (
          <button onClick={() => setTab('listings')} className={`px-4 py-2 text-sm ${tab === 'listings' ? 'border-b-2 border-kisan-900 font-medium' : 'text-gray-600'}`}>
            My listings ({listings.length})
          </button>
        )}
        <button onClick={() => setTab('inquiries')} className={`px-4 py-2 text-sm ${tab === 'inquiries' ? 'border-b-2 border-kisan-900 font-medium' : 'text-gray-600'}`}>
          Inquiries ({inquiries.length})
        </button>
        <button onClick={() => setTab('deals')} className={`px-4 py-2 text-sm ${tab === 'deals' ? 'border-b-2 border-kisan-900 font-medium' : 'text-gray-600'}`}>
          Deals ({deals.length})
        </button>
      </div>

      {tab === 'listings' && (
        <div className="space-y-2">
          {listings.length === 0 && <p className="text-center py-12 text-gray-500">No listings yet. <Link href="/sell" className="text-kisan-600 hover:underline">Create your first one →</Link></p>}
          {listings.map(l => (
            <div key={l.id} className="card flex items-center gap-3">
              <span className="text-2xl">🌱</span>
              <div className="flex-1">
                <div className="font-medium text-sm">{l.crop_name} ({l.variety})</div>
                <div className="text-xs text-gray-600">{fmtINR(l.price_per_unit)}/{l.unit} · {l.quantity} {l.unit} · {l.view_count} views · {l.inquiry_count} inquiries</div>
              </div>
              <span className={`badge ${l.status === 'active' ? 'bg-kisan-50 text-kisan-900' : 'bg-gray-100 text-gray-700'}`}>{l.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'inquiries' && (
        <div className="space-y-2">
          {inquiries.length === 0 && <p className="text-center py-12 text-gray-500">No inquiries yet.</p>}
          {inquiries.map((i: any) => (
            <Link href={`/inquiries/${i.id}`} key={i.id} className="card block hover:border-kisan-100">
              <div className="flex justify-between items-start mb-1">
                <div className="font-medium text-sm">
                  {user.role === 'farmer' ? (i.business_name || i.buyer_name) : i.farmer_name}
                  {i.unread > 0 && <span className="badge bg-blue-50 text-blue-900 ml-2">{i.unread} new</span>}
                </div>
                <div className="text-xs text-gray-500">{new Date(i.last_message_at).toLocaleDateString()}</div>
              </div>
              <div className="text-sm text-gray-600">
                {i.quantity_requested} {i.unit} of {i.crop_name}
                {i.offer_price && ` at ₹${i.offer_price}/${i.unit}`}
              </div>
              <div className="text-xs text-gray-500 mt-1">Status: {i.status}</div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'deals' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="py-2 px-2 font-normal">Deal ID</th>
                <th className="py-2 px-2 font-normal">{user.role === 'farmer' ? 'Buyer' : 'Farmer'}</th>
                <th className="py-2 px-2 font-normal">Crop</th>
                <th className="py-2 px-2 font-normal">Amount</th>
                <th className="py-2 px-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-gray-500">No deals yet</td></tr>
              )}
              {deals.map(d => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="py-3 px-2 font-mono text-xs">{d.display_id}</td>
                  <td className="py-3 px-2">{user.role === 'farmer' ? (d.business_name || d.buyer_name) : d.farmer_name}</td>
                  <td className="py-3 px-2">{d.crop_name}</td>
                  <td className="py-3 px-2 font-medium">{fmtINR(d.total_value)}</td>
                  <td className="py-3 px-2">
                    <span className={`badge ${d.status === 'completed' ? 'bg-kisan-50 text-kisan-900' : d.status === 'disputed' ? 'bg-red-50 text-red-900' : 'bg-blue-50 text-blue-900'}`}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
