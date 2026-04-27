'use client';

import { Suspense } from 'react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// ... rest of the code
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtINR } from '@/lib/api';
import { MapPin, Star, Filter, Search, Leaf } from 'lucide-react';

type Listing = {
  id: string; display_id: string; variety: string; quantity: number; unit: string;
  price_per_unit: number; quality_grade: string; is_organic: boolean;
  crop_name: string; category: string; farmer_name: string;
  state: string; district: string; farmer_rating: number; rating_count: number;
  premium_tier: string; verified: boolean; photos: string[];
};

const CATEGORIES = ['All', 'Vegetables', 'Grains', 'Fruits', 'Spices', 'Pulses', 'Oilseeds'];
const CROP_EMOJI: Record<string, string> = {
  Tomato: '🍅', Onion: '🧅', Potato: '🥔', Wheat: '🌾',
  'Basmati Rice': '🌾', 'Toor Dal': '🫘', Mango: '🥭',
  Banana: '🍌', Turmeric: '🌿', 'Red Chilli': '🌶️', Groundnut: '🥜', Cotton: '🌱',
};

export default function BrowsePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (category !== 'All') params.category = category;
    if (search) params.q = search;
    if (state) params.state = state;
    api.get('/api/v1/listings', { params })
      .then(r => setListings(r.data.items))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, [category, search, state]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-medium mb-1">Fresh from the field</h1>
        <p className="text-sm text-gray-600">Direct from Indian farmers · no middlemen · fair prices</p>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search crops (e.g. tomato, basmati, alphonso)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input
          className="input max-w-xs"
          placeholder="State (e.g. Gujarat)"
          value={state}
          onChange={(e) => setState(e.target.value)}
        />
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${
              category === c ? 'bg-kisan-900 text-kisan-50' : 'bg-white border border-gray-200 hover:border-kisan-100'
            }`}
          >{c}</button>
        ))}
      </div>

      {loading && <div className="text-center py-12 text-gray-500">Loading listings…</div>}

      {!loading && listings.length === 0 && (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Leaf size={32} className="mx-auto text-gray-400 mb-2" />
          <p className="text-gray-700">No listings match your filters</p>
          <button onClick={() => { setCategory('All'); setSearch(''); setState(''); }} className="mt-3 text-sm text-kisan-600 hover:underline">Clear filters</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map(l => (
          <Link href={`/listings/${l.id}`} key={l.id} className="card hover:border-kisan-100 transition">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{CROP_EMOJI[l.crop_name] || '🌱'}</span>
                <div>
                  <div className="font-medium text-sm">{l.crop_name}</div>
                  <div className="text-xs text-gray-500">{l.variety}</div>
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                {l.is_organic && <span className="badge bg-kisan-50 text-kisan-900">Organic</span>}
                {l.premium_tier !== 'standard' && <span className="badge bg-soil-50 text-soil-900">Featured</span>}
              </div>
            </div>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-lg font-medium">{fmtINR(l.price_per_unit)}</span>
              <span className="text-xs text-gray-500">/ {l.unit}</span>
            </div>
            <div className="text-xs text-gray-600 flex items-center gap-1 mb-2">
              <MapPin size={12} /> {l.district}, {l.state}
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
              <span>{l.quantity} {l.unit} avail</span>
              <span className="flex items-center gap-1">
                <Star size={12} className="fill-current text-amber-500" /> {Number(l.farmer_rating).toFixed(1)}
                {l.rating_count > 0 && ` · ${l.rating_count}`}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
