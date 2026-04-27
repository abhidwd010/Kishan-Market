// app/listings/[id]/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, fmtINR } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { ArrowLeft, MapPin, Star, Shield, Send } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [listing, setListing] = useState<any>(null);
  const [showInquiry, setShowInquiry] = useState(false);
  const [qty, setQty] = useState(0);
  const [offer, setOffer] = useState(0);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/listings/${id}`)
      .then(r => {
        setListing(r.data.listing);
        setQty(r.data.listing.min_order_qty || 50);
        setOffer(r.data.listing.price_per_unit);
      })
      .catch(() => toast.error('Listing not found'));
  }, [id]);

  const sendInquiry = async () => {
    if (!user) return router.push('/login?redirect=/listings/' + id);
    if (user.role !== 'buyer') return toast.error('Only buyers can send inquiries');
    setSending(true);
    try {
      await api.post('/api/v1/inquiries', {
        listing_id: id,
        quantity_requested: qty,
        unit: listing.unit,
        offer_price: offer,
        message: msg || undefined,
      });
      toast.success('Inquiry sent!');
      router.push('/dashboard');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (!listing) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  return (
    <div>
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-600 hover:text-kisan-900 mb-4">
        <ArrowLeft size={16} /> Back to browse
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-4xl">🌱</span>
            <div>
              <h1 className="text-2xl font-medium">{listing.crop_name}</h1>
              <p className="text-sm text-gray-600">{listing.variety} · Grade {listing.quality_grade}{listing.is_organic ? ' · Organic' : ''}</p>
            </div>
          </div>

          {listing.photos?.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {listing.photos.map((p: string, i: number) => (
                <img key={i} src={p} alt="" className="w-full h-48 object-cover rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="h-48 bg-gray-100 rounded-lg flex items-center justify-center text-6xl mb-4">🌾</div>
          )}

          <div className="card">
            <h2 className="font-medium mb-3">Listing details</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="text-gray-600 py-1.5">Price</td><td className="text-right font-medium">{fmtINR(listing.price_per_unit)} / {listing.unit}</td></tr>
                <tr><td className="text-gray-600 py-1.5">Quantity available</td><td className="text-right">{listing.quantity} {listing.unit}</td></tr>
                {listing.min_order_qty && (
                  <tr><td className="text-gray-600 py-1.5">Minimum order</td><td className="text-right">{listing.min_order_qty} {listing.unit}</td></tr>
                )}
                <tr><td className="text-gray-600 py-1.5">Available from</td><td className="text-right">{new Date(listing.available_from).toLocaleDateString()}</td></tr>
                <tr><td className="text-gray-600 py-1.5">Location</td><td className="text-right">{listing.district}, {listing.state}</td></tr>
              </tbody>
            </table>
            {listing.description && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-700">{listing.description}</div>
            )}
          </div>
        </div>

        <div>
          <div className="card mb-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-full bg-kisan-100 text-kisan-900 flex items-center justify-center font-medium">
                {listing.farmer_name?.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div>
                <div className="font-medium text-sm">{listing.farmer_name}</div>
                <div className="text-xs text-gray-600 flex items-center gap-2">
                  <Star size={12} className="fill-current text-amber-500" />
                  {Number(listing.farmer_rating).toFixed(1)}
                  {listing.rating_count > 0 && ` · ${listing.rating_count} deals`}
                  {listing.verified && <Shield size={12} className="text-kisan-600" />}
                </div>
              </div>
            </div>
            <button onClick={() => setShowInquiry(true)} className="btn-primary w-full">Send inquiry</button>
          </div>
          <div className="text-xs text-gray-600 p-3 bg-amber-50 rounded-md border border-amber-100">
            <Shield size={12} className="inline mr-1 text-amber-700" />
            Farmer's phone is shared only after deal confirmation. All conversations are kept on platform until then.
          </div>
        </div>
      </div>

      {showInquiry && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-lg font-medium mb-1">Send inquiry to {listing.farmer_name}</h2>
            <p className="text-sm text-gray-600 mb-4">For {listing.crop_name} · {fmtINR(listing.price_per_unit)}/{listing.unit}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Quantity needed ({listing.unit})</label>
                <input className="input" type="number" value={qty} onChange={(e) => setQty(+e.target.value)} min={listing.min_order_qty || 1} />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Your offer price (₹/{listing.unit})</label>
                <input className="input" type="number" value={offer} onChange={(e) => setOffer(+e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Message (optional)</label>
                <textarea className="input" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)}
                  placeholder="Looking for regular weekly supply…" />
              </div>
              <div className="bg-gray-50 p-3 rounded text-sm flex justify-between">
                <span>Total deal value</span>
                <strong>{fmtINR(qty * offer)}</strong>
              </div>
              <div className="flex gap-2">
                <button onClick={sendInquiry} disabled={sending} className="btn-primary flex-1 flex items-center justify-center gap-1.5">
                  <Send size={14} /> {sending ? 'Sending…' : 'Send inquiry'}
                </button>
                <button onClick={() => setShowInquiry(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
