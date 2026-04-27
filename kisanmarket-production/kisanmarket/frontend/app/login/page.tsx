// app/login/page.tsx — OTP-based login/signup
'use client';
import { Suspense } from 'react';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Phone, KeyRound, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

const STATES = ['Gujarat', 'Maharashtra', 'Punjab', 'Madhya Pradesh', 'Tamil Nadu', 'Karnataka', 'Uttar Pradesh', 'Rajasthan', 'Telangana', 'Andhra Pradesh', 'West Bengal', 'Bihar'];
function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<'phone' | 'otp' | 'register'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [reg, setReg] = useState({ role: 'buyer' as 'buyer' | 'farmer', name: '', state: 'Gujarat', district: '', business_type: 'wholesaler' as const });
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    if (phone.length < 10) return toast.error('Enter valid phone');
    setLoading(true);
    try {
      const r = await api.post('/api/v1/auth/send-otp', { phone });
      toast.success(r.data.debug ? `Dev OTP: ${r.data.debug}` : 'OTP sent');
      setStep('otp');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  const verifyOtp = async (extra = {}) => {
    setLoading(true);
    try {
      const r = await api.post('/api/v1/auth/verify-otp', { phone, code, ...extra });
      if (r.data.newUser) {
        setStep('register');
        return;
      }
      setAuth(r.data.user, r.data.accessToken);
      toast.success('Welcome back!');
      router.push(redirect);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="card">
        <h1 className="text-xl font-medium mb-1">Sign in to KisanMarket</h1>
        <p className="text-sm text-gray-600 mb-6">No password — just your phone number</p>

        {step === 'phone' && (
          <div className="space-y-3">
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" type="tel" placeholder="10-digit mobile number" value={phone}
                     onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            </div>
            <button onClick={sendOtp} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-1.5">
              {loading ? 'Sending…' : <>Send OTP <ArrowRight size={14} /></>}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">OTP sent to +91 {phone}</p>
            <div className="relative">
              <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9 tracking-widest text-center font-mono" type="text" placeholder="6-digit code" maxLength={6}
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button onClick={() => verifyOtp()} disabled={loading || code.length !== 6} className="btn-primary w-full">
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button onClick={() => setStep('phone')} className="text-sm text-gray-600 hover:text-kisan-900">Change number</button>
          </div>
        )}

        {step === 'register' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">New here — tell us a bit about yourself</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setReg({ ...reg, role: 'farmer' })}
                      className={`p-3 border rounded-md text-sm ${reg.role === 'farmer' ? 'border-kisan-600 bg-kisan-50' : 'border-gray-200'}`}>
                I'm a farmer 👨‍🌾
              </button>
              <button onClick={() => setReg({ ...reg, role: 'buyer' })}
                      className={`p-3 border rounded-md text-sm ${reg.role === 'buyer' ? 'border-kisan-600 bg-kisan-50' : 'border-gray-200'}`}>
                I'm a buyer 🛒
              </button>
            </div>
            <input className="input" placeholder="Full name" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} />
            <select className="input" value={reg.state} onChange={(e) => setReg({ ...reg, state: e.target.value })}>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="input" placeholder="District" value={reg.district} onChange={(e) => setReg({ ...reg, district: e.target.value })} />
            {reg.role === 'buyer' && (
              <select className="input" value={reg.business_type} onChange={(e) => setReg({ ...reg, business_type: e.target.value as any })}>
                <option value="wholesaler">Wholesaler</option>
                <option value="retailer">Retailer</option>
                <option value="horeca">Restaurant/Hotel</option>
                <option value="individual">Individual buyer</option>
                <option value="export">Export</option>
              </select>
            )}
            <button onClick={() => verifyOtp(reg)} disabled={loading || !reg.name || !reg.district} className="btn-primary w-full">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading Login...</div>}>
      <LoginContent />
    </Suspense>
  );
}
