// app/admin/page.tsx — Admin dashboard
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtINR } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { TrendingUp, AlertTriangle, Check, Flag } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [analytics, setAnalytics] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    if (!user) router.push('/login');
    else if (user.role !== 'admin') { toast.error('Admin only'); router.push('/'); }
    else {
      api.get('/api/v1/admin/analytics').then(r => setAnalytics(r.data));
      api.get('/api/v1/admin/listings/pending').then(r => setPending(r.data.items));
    }
  }, [user]);

  const moderate = async (id: string, action: 'approve' | 'flag') => {
    await api.patch(`/api/v1/admin/listings/${id}`, { action });
    setPending(pending.filter(p => p.id !== id));
    toast.success(`Listing ${action}d`);
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <div>
      <h1 className="text-xl font-medium mb-1">Admin dashboard</h1>
      <p className="text-sm text-gray-600 mb-6">Last {analytics?.range_days || 30} days</p>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            ['New farmers', analytics.summary.new_farmers],
            ['New buyers', analytics.summary.new_buyers],
            ['Total GMV', fmtINR(analytics.summary.gmv)],
            ['Platform revenue', fmtINR(analytics.summary.platform_revenue)],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded-md p-3">
              <div className="text-xs text-gray-600">{label}</div>
              <div className="text-lg font-medium mt-1">{val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-medium mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-amber-600" /> Listings pending review ({pending.length})</h2>
          {pending.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">All clear ✓</p>}
          {pending.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div>
                <div className="text-sm">{p.crop} · {p.farmer}</div>
                <div className="text-xs text-gray-500">{p.state}, {p.district} · {fmtINR(p.price_per_unit)}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => moderate(p.id, 'approve')} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1">
                  <Check size={12} /> Approve
                </button>
                <button onClick={() => moderate(p.id, 'flag')} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 text-red-700">
                  <Flag size={12} /> Flag
                </button>
              </div>
            </div>
          ))}
        </div>

        {analytics && (
          <div className="card">
            <h2 className="font-medium mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-kisan-600" /> Farmers by state</h2>
            {analytics.farmers_by_state.map((s: any) => {
              const max = analytics.farmers_by_state[0]?.c || 1;
              return (
                <div key={s.state} className="mb-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span>{s.state}</span><span className="text-gray-600">{s.c} farmers</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-kisan-900" style={{ width: `${(s.c / max * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
