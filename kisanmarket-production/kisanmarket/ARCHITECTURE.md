# KisanMarket — System Architecture

## 1. High-Level Architecture

```
                      ┌───────────────────────────────────┐
                      │         CDN / Edge (Vercel)        │
                      └─────────────────┬─────────────────┘
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  │                     │                     │
        ┌─────────▼──────────┐  ┌──────▼──────┐  ┌──────────▼──────────┐
        │  Next.js Frontend  │  │  Admin UI   │  │   Marketing Site    │
        │   (App Router)     │  │  (same app) │  │  (same Next.js app) │
        └─────────┬──────────┘  └──────┬──────┘  └──────────┬──────────┘
                  │                    │                     │
                  └────────────┬───────┴─────────────────────┘
                               │  HTTPS + JWT
                  ┌────────────▼────────────┐
                  │  Node.js / Express API  │
                  │  (Stateless, scalable)  │
                  └────┬─────────┬──────┬───┘
                       │         │      │
            ┌──────────▼─┐  ┌────▼───┐ ┌▼─────────────┐
            │ PostgreSQL │  │ Redis  │ │  Socket.io   │
            │  (Supabase)│  │(cache+ │ │ (real-time   │
            │            │  │ queue) │ │  messaging)  │
            └────────────┘  └────────┘ └──────────────┘
                  │
   ┌──────────────┼──────────────┬───────────────┬─────────────┐
   ▼              ▼              ▼               ▼             ▼
Cloudinary   Razorpay      MSG91/Twilio    Algolia      Firebase
(photos)     (payments)    (SMS+OTP)       (search)     (push)
```

## 2. Service Decision: Modular Monolith

**Choice:** Modular monolith over microservices.

**Reasoning:**
- Pre-revenue startup. Microservices = 10x infra cost & 5x dev velocity tax
- Single deployable, single DB transaction across entities
- Module boundaries inside the codebase = future split is cheap
- Refactor to services only at >100K MAU or specific scaling pain

**Modules (logical separation, single deployable):**
```
src/
├── routes/auth          # OTP signup/login
├── routes/listings      # Crop CRUD
├── routes/inquiries     # Inquiry + messaging
├── routes/deals         # Deal lifecycle
├── routes/payments      # Razorpay + escrow
├── routes/admin         # Moderation + analytics
├── services/            # Business logic per domain
├── middleware/          # Cross-cutting concerns
└── utils/               # DB pool, logger, helpers
```

## 3. API Layer

**Style:** REST + JSON. GraphQL rejected — overkill for marketplace CRUD, harder caching.

**Versioning:** All routes prefixed `/api/v1/...`

**Auth:** JWT in `Authorization: Bearer <token>`. Refresh token in HTTP-only cookie.

**Key endpoints (full list in routes/):**
```
POST   /api/v1/auth/send-otp           Send OTP to phone
POST   /api/v1/auth/verify-otp         Verify + get JWT
POST   /api/v1/auth/refresh            Refresh JWT
GET    /api/v1/listings                Browse (public, paginated)
GET    /api/v1/listings/:id            Listing detail (public)
POST   /api/v1/listings                Create listing (farmer)
PATCH  /api/v1/listings/:id            Update listing
DELETE /api/v1/listings/:id            Soft-delete listing
POST   /api/v1/inquiries               Send inquiry (buyer)
GET    /api/v1/inquiries               List own inquiries
POST   /api/v1/inquiries/:id/messages  Send message in thread
POST   /api/v1/inquiries/:id/confirm   Confirm deal (creates Deal)
POST   /api/v1/deals/:id/complete      Mark deal done + rate
POST   /api/v1/payments/premium        Buy premium subscription
POST   /api/v1/payments/escrow         Initiate escrow payment
POST   /api/v1/payments/webhook        Razorpay webhook
GET    /api/v1/admin/listings/pending  Moderation queue
PATCH  /api/v1/admin/listings/:id      Approve/flag listing
GET    /api/v1/admin/analytics         Platform metrics
```

## 4. Database

**Choice:** PostgreSQL (Supabase managed)
- ACID for deal/payment integrity
- Full-text search via `tsvector` (until Algolia is added)
- Row-level security for admin/user separation
- JSON columns for flexible metadata

**Connection pooling:** PgBouncer (Supabase built-in) → 100 connections max from app

**Indexes:** All FK columns, all filter columns (state, district, category, status), tsvector GIN index on listings

## 5. Real-time Messaging

**Choice:** Socket.io with Redis adapter (horizontal scale)

**Rooms:** One room per inquiry — `inquiry:{inquiry_id}`. Both farmer and buyer join on inquiry open.

**Fallback:** Long-poll endpoint `/api/v1/inquiries/:id/messages?since=:timestamp` for slow networks (rural farmers).

**Persistence:** Every message → DB write before broadcast. Source of truth = Postgres.

## 6. Payments

**Phase 1 (MVP launch):** Off-platform. Platform shares UPI ID, both parties confirm payment manually. Zero exposure.

**Phase 2 (Month 4+):** Razorpay Route — escrow:
1. Buyer pays full amount to platform-controlled merchant account
2. Platform holds in escrow
3. Farmer confirms dispatch → 24hr buyer dispute window
4. Auto-release to farmer's UPI/bank (T+2)
5. Platform retains 3-5% transaction fee

**Webhook:** Razorpay → `/payments/webhook` (HMAC verified) → updates `transactions` table → triggers payout job.

## 7. Search

**Phase 1:** Postgres full-text search (good for <100K listings)
**Phase 2:** Algolia — 10K listings free tier, sub-50ms typo-tolerant search

## 8. File Storage

**Cloudinary:** Direct browser upload via signed URL. Auto-resize, format optimisation, CDN-served.

## 9. Notifications

**SMS:** MSG91 (cheaper than Twilio for India, ~₹0.15/SMS)
**Push:** Firebase FCM (free)
**WhatsApp (Phase 2):** Aisensy or Meta Cloud API

## 10. Scaling Strategy

| Stage         | Setup                                    | Cost/mo  |
|---------------|------------------------------------------|----------|
| 0–10K users   | 1 backend instance, Supabase free tier   | ₹3K      |
| 10K–100K      | 2 instances behind Vercel/LB, Supabase Pro| ₹25K    |
| 100K–1M       | Auto-scaling group, read replicas, Redis| ₹2L      |
| 1M+           | Split: search service, payment service  | ₹10L+    |

**Bottleneck order (anticipated):**
1. Photo upload bandwidth → solved by direct-to-Cloudinary
2. Search latency → solved by Algolia at 50K listings
3. DB writes on hot listings → solved by read replicas + cache
4. Socket.io connections → solved by Redis adapter + sticky sessions

## 11. Security

- All inputs validated with Zod (frontend + backend)
- Phone numbers normalised (+91 prefix, 10-digit India only)
- Rate limit: 5 OTP/hour per phone, 100 reqs/min per IP, 30 listings/day per farmer
- SQL injection: parameterised queries only, no string concat
- XSS: React auto-escapes; backend strips HTML from user content
- HTTPS only, HSTS header
- Secrets in env vars only, never logged
- Razorpay webhook signature verified
- JWT short-lived (15 min), refresh token rotation
- Admin endpoints: separate role + 2FA for admin accounts

## 12. Monitoring

- **Logs:** Pino (structured JSON) → Logtail or Better Stack
- **Errors:** Sentry (frontend + backend)
- **Uptime:** UptimeRobot ping every minute
- **Metrics:** Prometheus + Grafana (cost: ₹0 self-hosted) OR Datadog (₹15K/mo)
- **Alerts:** PagerDuty for P0 (DB down, payment webhook failures)

## 13. Backup & DR

- Postgres: daily full backup + WAL streaming (Supabase auto)
- Cloudinary: replicated by default
- Code: GitHub
- Recovery: <30 min RTO, <1 hour RPO
