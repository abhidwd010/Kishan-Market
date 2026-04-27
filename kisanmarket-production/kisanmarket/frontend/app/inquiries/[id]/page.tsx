// app/inquiries/[id]/page.tsx — Inquiry thread with real-time messaging
'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { api, fmtINR } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Send, ArrowLeft, CheckCircle2, Phone } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InquiryThread() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken } = useAuthStore();
  const [inquiry, setInquiry] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalQty, setFinalQty] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);

  const loadData = () => {
    api.get(`/api/v1/inquiries/${id}`).then(r => {
      setInquiry(r.data.inquiry);
      setMessages(r.data.messages);
      setFinalQty(r.data.inquiry.quantity_requested);
      setFinalPrice(r.data.inquiry.offer_price || r.data.inquiry.listing_price);
    }).catch(() => toast.error('Cannot load inquiry'));
  };

  useEffect(() => {
    if (!user) { router.push('/login'); return; }
    loadData();
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000', {
      auth: { token: accessToken }, withCredentials: true,
    });
    socketRef.current = s;
    s.emit('inquiry:join', id);
    s.on('message:new', (m: any) => setMessages((prev) => [...prev, m]));
    s.on('deal:confirmed', () => loadData());
    return () => { s.disconnect(); };
  }, [id, user]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await api.post(`/api/v1/inquiries/${id}/messages`, { content: text });
      setText('');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const confirmDeal = async () => {
    try {
      await api.post(`/api/v1/inquiries/${id}/confirm`, { final_quantity: finalQty, final_price: finalPrice });
      toast.success('Deal confirmed!');
      setConfirmOpen(false);
      loadData();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  if (!inquiry) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  const otherParty = user?.role === 'farmer'
    ? { name: inquiry.buyer_name, phone: inquiry.buyer_phone }
    : { name: inquiry.farmer_name, phone: inquiry.farmer_phone };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-600 hover:text-kisan-900 mb-4">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="card mb-3">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h2 className="font-medium">{otherParty.name}</h2>
            <p className="text-xs text-gray-600">
              {inquiry.crop_name} · {inquiry.quantity_requested} {inquiry.unit}
              {inquiry.offer_price && ` · offer ₹${inquiry.offer_price}/${inquiry.unit}`}
            </p>
          </div>
          <span className={`badge ${
            inquiry.status === 'confirmed' ? 'bg-kisan-50 text-kisan-900' :
            inquiry.status === 'cancelled' ? 'bg-red-50 text-red-900' :
            'bg-blue-50 text-blue-900'}`}>{inquiry.status}</span>
        </div>
        {inquiry.status === 'confirmed' && otherParty.phone && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 text-sm">
            <Phone size={14} className="text-kisan-600" />
            <span>{otherParty.phone}</span>
            <span className="text-xs text-gray-500">— shared after deal confirmation</span>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="bg-white rounded-lg border border-gray-200 h-[420px] overflow-y-auto p-4 mb-2 flex flex-col gap-3">
        {messages.map((m: any) => (
          <div key={m.id} className={`flex ${m.sender_type === user?.role ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
              m.sender_type === 'system' ? 'bg-amber-50 text-amber-900 text-xs italic mx-auto' :
              m.sender_type === user?.role ? 'bg-kisan-900 text-kisan-50' : 'bg-gray-100 text-gray-900'
            }`}>
              {m.content}
              <div className="text-[10px] opacity-60 mt-0.5">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        ))}
      </div>

      {inquiry.status !== 'confirmed' && inquiry.status !== 'cancelled' && (
        <>
          <div className="flex gap-2 mb-2">
            <input className="input flex-1" placeholder="Type a message…" value={text}
                   onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button onClick={send} className="btn-primary"><Send size={16} /></button>
          </div>
          <button onClick={() => setConfirmOpen(true)} className="btn-secondary w-full flex items-center justify-center gap-1.5 text-kisan-900">
            <CheckCircle2 size={16} /> Confirm deal
          </button>
        </>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-sm w-full p-6">
            <h3 className="font-medium mb-3">Confirm deal terms</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Final quantity ({inquiry.unit})</label>
                <input className="input" type="number" value={finalQty} onChange={(e) => setFinalQty(+e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Final price (₹/{inquiry.unit})</label>
                <input className="input" type="number" value={finalPrice} onChange={(e) => setFinalPrice(+e.target.value)} />
              </div>
              <div className="bg-gray-50 p-3 rounded text-sm flex justify-between">
                <span>Total deal value</span><strong>{fmtINR(finalQty * finalPrice)}</strong>
              </div>
              <div className="flex gap-2">
                <button onClick={confirmDeal} className="btn-primary flex-1">Confirm</button>
                <button onClick={() => setConfirmOpen(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
