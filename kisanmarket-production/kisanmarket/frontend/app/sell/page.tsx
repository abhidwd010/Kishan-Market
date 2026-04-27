// app/sell/page.tsx — Farmer creates listing
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Camera, X } from 'lucide-react';
import toast from 'react-hot-toast';

type Crop = { id: string; name: string; category: string; default_units: string[]; ref_price_min: number; ref_price_max: number };

export default function SellPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [form, setForm] = useState({
    crop_id: '', variety: '', quantity: 100, unit: 'kg',
    price_per_unit: 0, min_order_qty: 50,
    available_from: new Date().toISOString().split('T')[0],
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0] + 'T23:59:00Z',
    quality_grade: 'B' as 'A' | 'B' | 'C',
    is_organic: false, no_pesticide: false,
    description: '', photos: [] as string[], show_village: true,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) router.push('/login?redirect=/sell');
    else if (user.role !== 'farmer') { toast.error('Farmer account required'); router.push('/'); }
    api.get('/api/v1/crops').then(r => setCrops(r.data.items));
  }, [user, router]);

  const selectedCrop = crops.find(c => c.id === form.crop_id);

  const uploadPhoto = async (file: File) => {
    const sigR = await api.post('/api/v1/uploads/sign');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sigR.data.api_key);
    fd.append('timestamp', sigR.data.timestamp);
    fd.append('signature', sigR.data.signature);
    fd.append('folder', sigR.data.folder);
    fd.append('transformation', 'q_auto,f_auto,w_1600,c_limit');
    const up = await fetch(`https://api.cloudinary.com/v1_1/${sigR.data.cloud_name}/image/upload`, { method: 'POST', body: fd });
    const data = await up.json();
    setForm({ ...form, photos: [...form.photos, data.secure_url] });
  };

  const submit = async () => {
    if (!form.crop_id) return toast.error('Choose a crop');
    if (form.price_per_unit <= 0) return toast.error('Enter a valid price');
    setSubmitting(true);
    try {
      const r = await api.post('/api/v1/listings', form);
      toast.success(`Listed! ID: ${r.data.listing.display_id}`);
      router.push('/dashboard');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-medium mb-1">List a new crop</h1>
      <p className="text-sm text-gray-600 mb-6">Buyers across India will see this within minutes</p>

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Crop</label>
            <select className="input" value={form.crop_id} onChange={(e) => {
              const crop = crops.find(c => c.id === e.target.value);
              setForm({ ...form, crop_id: e.target.value, unit: crop?.default_units[0] || 'kg' });
            }}>
              <option value="">Select…</option>
              {crops.map(c => <option key={c.id} value={c.id}>{c.name} ({c.category})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Variety</label>
            <input className="input" placeholder="e.g. Hybrid, Pusa 1121" value={form.variety} onChange={(e) => setForm({ ...form, variety: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Quantity</label>
            <input className="input" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Unit</label>
            <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {selectedCrop?.default_units.map(u => <option key={u} value={u}>{u}</option>) || <option value="kg">kg</option>}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Price / {form.unit}</label>
            <input className="input" type="number" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: +e.target.value })} />
            {selectedCrop && (
              <p className="text-xs text-gray-500 mt-1">Market: ₹{selectedCrop.ref_price_min}–{selectedCrop.ref_price_max}/kg</p>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-600 mb-1 block">Quality grade</label>
          <div className="flex gap-2">
            {(['A', 'B', 'C'] as const).map(g => (
              <button key={g} type="button"
                onClick={() => setForm({ ...form, quality_grade: g })}
                className={`flex-1 py-2 border rounded-md text-sm ${form.quality_grade === g ? 'border-kisan-600 bg-kisan-50' : 'border-gray-200'}`}>
                Grade {g}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={form.is_organic} onChange={(e) => setForm({ ...form, is_organic: e.target.checked })} />
            Organic
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={form.no_pesticide} onChange={(e) => setForm({ ...form, no_pesticide: e.target.checked })} />
            No pesticide
          </label>
        </div>

        <div>
          <label className="text-xs text-gray-600 mb-1 block">Description</label>
          <textarea className="input" rows={2} placeholder="Fresh harvest, direct from field…"
                    value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div>
          <label className="text-xs text-gray-600 mb-1 block">Photos (up to 4)</label>
          <div className="grid grid-cols-4 gap-2">
            {form.photos.map((p, i) => (
              <div key={i} className="relative aspect-square">
                <img src={p} className="w-full h-full object-cover rounded" />
                <button onClick={() => setForm({ ...form, photos: form.photos.filter((_, j) => j !== i) })}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5">
                  <X size={12} />
                </button>
              </div>
            ))}
            {form.photos.length < 4 && (
              <label className="aspect-square border border-dashed border-gray-300 rounded flex items-center justify-center cursor-pointer hover:border-kisan-400">
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
                <Camera size={20} className="text-gray-400" />
              </label>
            )}
          </div>
        </div>

        <button onClick={submit} disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Publishing…' : 'Publish listing'}
        </button>
      </div>
    </div>
  );
}
