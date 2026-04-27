# 🌾 KisanMarket — Production-Ready Marketplace

Direct-from-farmer agricultural marketplace. Built as a Next.js + Node.js + PostgreSQL stack — deployable to Vercel + Render + Supabase in under an hour.

---

## 📦 What's in this repo

```
kisanmarket/
├── ARCHITECTURE.md          ← Full system architecture
├── README.md                ← You're reading it
├── docker-compose.yml       ← Local dev stack (Postgres + Redis + API + Web)
├── .github/workflows/ci.yml ← CI/CD pipeline
│
├── database/
│   └── schema.sql           ← Complete PostgreSQL schema with seed data
│
├── backend/                 ← Node.js + Express REST API
│   ├── src/
│   │   ├── server.js        ← Entrypoint
│   │   ├── routes/          ← auth, listings, inquiries, deals, payments, admin, crops, uploads
│   │   ├── middleware/      ← auth (JWT), rate limiter, error handler
│   │   ├── services/        ← OTP, Socket.io
│   │   └── utils/           ← DB pool, Redis, logger
│   ├── __tests__/
│   ├── Dockerfile
│   ├── .env.example
│   └── package.json
│
└── frontend/                ← Next.js 14 (App Router) + Tailwind + Zustand
    ├── app/
    │   ├── page.tsx         ← Browse (public)
    │   ├── login/           ← OTP signup/login
    │   ├── listings/[id]/   ← Listing detail + send inquiry
    │   ├── inquiries/[id]/  ← Real-time chat thread
    │   ├── sell/            ← Farmer creates listing
    │   ├── dashboard/       ← Farmer/Buyer dashboard
    │   └── admin/           ← Admin panel
    ├── components/Navbar.tsx
    ├── lib/api.ts           ← Axios client + auth interceptor
    ├── lib/store.ts         ← Zustand auth store
    ├── Dockerfile
    └── package.json
```

---

## 🚀 Quick start (local — 5 minutes)

```bash
git clone <this-repo>
cd kisanmarket

cp backend/.env.example backend/.env
# OTP_BYPASS=true → use 123456 as OTP for any phone (dev only)

docker compose up -d
```

Open:
- **Frontend** → http://localhost:3000
- **Backend API** → http://localhost:4000/health
- **Postgres** → `localhost:5432` (postgres / postgres / kisanmarket)

To create a farmer account: enter any 10-digit phone → use code `123456` → fill registration → done.

---

## 🌐 Production deployment

### 1. Database — Supabase (free → ₹2K/mo)
```bash
# 1. Create project at supabase.com
# 2. Connection string → backend .env DATABASE_URL
# 3. Apply schema:
psql "$DATABASE_URL" -f database/schema.sql
```

### 2. Backend — Render or Railway
```bash
# Render.com → New Web Service → connect GitHub repo
# Root directory: backend/
# Build command: npm install
# Start command: npm start
# Add env vars from .env.example (use real Razorpay/MSG91/etc keys)
# Add Redis: Render → New Redis instance → URL into REDIS_URL
```

Cost: ~₹2K/mo (Render Standard) + ₹600/mo (Redis).

### 3. Frontend — Vercel
```bash
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://api.kisanmarket.in
vercel env add NEXT_PUBLIC_SOCKET_URL production # same
vercel --prod
```

### 4. Razorpay setup
1. Account → kyc → activate live mode
2. Settings → Webhooks → add `https://api.kisanmarket.in/api/v1/payments/webhook`
3. Subscribe to: `payment.captured`, `payment.failed`, `refund.processed`
4. Copy webhook secret → `RAZORPAY_WEBHOOK_SECRET` env var

### 5. Cloudinary (photos)
1. Free account → cloud name → API key + secret → backend env
2. Direct browser uploads via signed URLs (no photos transit your server)

### 6. MSG91 (SMS / OTP)
1. msg91.com signup → buy 10K SMS credits (~₹1500)
2. Create OTP template — get DLT-approved (mandatory in India)
3. Set `MSG91_API_KEY`, `MSG91_OTP_TEMPLATE_ID`
4. Switch `OTP_BYPASS=false`

---

## 🔌 API reference

Base URL: `https://api.kisanmarket.in/api/v1`

### Auth (no token needed)
| Method | Endpoint              | Body                                     |
|--------|-----------------------|------------------------------------------|
| POST   | /auth/send-otp        | `{ phone }`                              |
| POST   | /auth/verify-otp      | `{ phone, code, [role, name, state, …] }`|
| GET    | /auth/me              | (Bearer required)                        |
| POST   | /auth/logout          | (Bearer required)                        |

### Listings
| Method | Endpoint              | Auth   | Notes                       |
|--------|-----------------------|--------|-----------------------------|
| GET    | /listings             | none   | Filters: q, category, state, district, min_price, max_price, grade, organic, sort, page, limit |
| GET    | /listings/:id         | none   | Single listing detail       |
| POST   | /listings             | farmer | Create new listing          |
| PATCH  | /listings/:id         | farmer | Update own (locked if active inquiry) |
| DELETE | /listings/:id         | farmer | Soft delete                 |
| GET    | /listings/me/all      | farmer | All my listings             |

### Inquiries
| Method | Endpoint                     | Auth         |
|--------|------------------------------|--------------|
| POST   | /inquiries                   | buyer        |
| GET    | /inquiries                   | farmer/buyer |
| GET    | /inquiries/:id               | participant  |
| POST   | /inquiries/:id/messages      | participant  |
| POST   | /inquiries/:id/confirm       | participant  |
| POST   | /inquiries/:id/cancel        | participant  |

### Deals
| Method | Endpoint                  | Auth         |
|--------|---------------------------|--------------|
| GET    | /deals                    | participant  |
| GET    | /deals/:id                | participant  |
| POST   | /deals/:id/dispatch       | farmer       |
| POST   | /deals/:id/delivered      | buyer        |
| POST   | /deals/:id/complete       | participant  |
| POST   | /deals/:id/dispute        | buyer        |

### Payments
| Method | Endpoint                  | Auth   |
|--------|---------------------------|--------|
| POST   | /payments/premium/order   | any    |
| POST   | /payments/premium/verify  | any    |
| POST   | /payments/escrow/order    | buyer  |
| POST   | /payments/webhook         | none (HMAC verified) |

### Admin
| Method | Endpoint                       | Auth  |
|--------|--------------------------------|-------|
| GET    | /admin/listings/pending        | admin |
| PATCH  | /admin/listings/:id            | admin |
| GET    | /admin/users                   | admin |
| PATCH  | /admin/users/:id               | admin |
| GET    | /admin/analytics               | admin |
| GET    | /admin/disputes                | admin |

---

## 💬 Socket.io events

**Client → server:**
- `inquiry:join` — join an inquiry's chat room
- `inquiry:leave`
- `typing` — `{ inquiryId, isTyping }`

**Server → client:**
- `message:new` — new message in joined inquiry room
- `inquiry:new` — farmer received new inquiry
- `inquiry:update` — inquiry state changed
- `deal:confirmed` — deal created from inquiry

Connection requires `auth: { token: <accessToken> }` in handshake.

---

## 🧪 Testing

```bash
# Backend unit/API tests
cd backend && npm test

# Frontend component tests (recommended add: Playwright + Testing Library)
cd frontend && npm test

# Load testing — k6 example
k6 run scripts/load-browse.js   # 1000 RPS browse for 5 min
```

Recommended scenarios for k6:
- Browse listings (anon, GET-heavy) — target 2K RPS
- Send inquiry (auth, write) — target 100 RPS
- Confirm deal (transactional) — target 50 RPS
- WebSocket message (1K concurrent connections)

---

## 🔒 Security checklist

✅ Implemented
- Helmet headers, CORS allowlist, HTTPS only in prod
- Parameterised SQL (no concat) — pg `$N` placeholders everywhere
- Zod input validation on every route
- JWT short-lived (15min) + rotated refresh token in HTTP-only cookie
- bcrypt for OTP hashing (never store plain code)
- Rate limit: 5 OTP/hr/phone, 100 req/min/IP, 30 listings/day/farmer
- Razorpay webhook HMAC signature verification
- Audit log on all admin actions
- Soft delete (no destructive removal)
- Phone numbers normalized + masked until deal confirmed
- Row-level security policies on Postgres (Supabase)

⚠️ Add before scaling
- Web Application Firewall (Cloudflare) — DDoS, bot protection
- Sentry for error tracking
- 2FA for admin accounts
- KYC flow for high-value farmers (PAN/Aadhaar verification)
- Anti-fraud: device fingerprinting, velocity checks

---

## 📊 Monitoring

```bash
# Logs (Pino structured JSON)
docker compose logs -f backend | jq

# Metrics — recommended Prometheus exporter
npm install --save prom-client express-prom-bundle
# Drop in src/server.js, scrape /metrics from Grafana

# Uptime monitoring — UptimeRobot pings /health every minute
# Alert routing — PagerDuty for P0 (DB down, payment webhook 5xx)
```

---

## 📈 Scaling roadmap

| Stage         | Users / day | Setup                                                | Cost/mo  |
|---------------|-------------|------------------------------------------------------|----------|
| Pilot         | 100         | 1 backend, Supabase free, Vercel hobby               | ₹3K      |
| Soft launch   | 1K–10K      | 1 backend (Render Std), Supabase Pro, Vercel Pro     | ₹15K     |
| Growth        | 10K–100K    | 2 backend behind LB, Redis, read replicas            | ₹60K     |
| Scale         | 100K–1M     | Auto-scaling, Algolia, dedicated Postgres            | ₹3L      |
| Hyperscale    | 1M+         | Split services: search, payment, messaging           | ₹15L+    |

**Anticipated bottlenecks (in order):**
1. Photo upload bandwidth → already solved (direct-to-Cloudinary)
2. Search latency at 50K listings → swap Postgres FTS for Algolia
3. DB writes on hot listings → add Redis cache + read replicas
4. Socket.io connections at 50K concurrent → add sticky sessions + horizontal Redis adapter (already wired)

---

## 🗓️ Go-live checklist

### Pre-launch (T-2 weeks)
- [ ] All P0 features green in QA (signup, list, inquire, message, confirm)
- [ ] Razorpay live mode KYC complete
- [ ] MSG91 DLT template approved (5–7 days)
- [ ] DNS configured: `kisanmarket.in` → Vercel, `api.kisanmarket.in` → Render
- [ ] SSL certs live (auto via Vercel/Render)
- [ ] Privacy Policy + Terms of Service published
- [ ] Database daily backup verified (Supabase auto)
- [ ] Sentry + UptimeRobot active

### Launch day (T-0)
- [ ] Seed 50 real farmer listings (your team manually onboards)
- [ ] Soft launch to 5–10 wholesale buyers in Gujarat
- [ ] Monitor logs every hour — first 24hr is critical
- [ ] Have ops phone open (rural farmers will call confused)
- [ ] WhatsApp support number live on every page

### Week 1 retro
- [ ] OTP delivery rate > 95%? (else swap MSG91 path)
- [ ] Listing-to-inquiry conversion > 15%?
- [ ] Inquiry-to-deal conversion > 20%?
- [ ] Any payment failures? — review webhook log
- [ ] Farmer NPS poll → fix top 2 friction points

---

## ⚠️ Known limitations of this MVP

What's **shipped**:
- Full CRUD for listings, inquiries, deals
- Real-time messaging with Socket.io
- OTP auth with rotation
- Razorpay premium subscriptions + escrow scaffolding
- Admin moderation + analytics
- Mobile-responsive web UI

What needs work in **v1.1**:
- Native mobile apps (React Native — code reusable)
- WhatsApp bot integration (Aisensy / Meta Cloud API)
- AI photo verification (real crop vs stock image)
- Multi-language UI (Hindi/Marathi/Punjabi/Tamil)
- Logistics partner integration (Delhivery/Porter API)
- Advanced search (Algolia)
- Video listings
- Group/bulk RFQ for buyers ("I need 10 ton wheat")
- Farmer credit-score / pre-harvest financing

---

## 📝 License

MIT. Build, fork, ship — but don't use the KisanMarket name without permission.

---

## 🙏 Credits

Built collaboratively. FSD-driven. Production-leaning.
Architecture decisions documented in `ARCHITECTURE.md`.

For deployment help or issues: open a GitHub issue or email founders@kisanmarket.in
