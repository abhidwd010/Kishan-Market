-- =============================================================================
-- KISANMARKET — POSTGRESQL SCHEMA v1.0
-- Production-ready. Run with: psql -d kisanmarket -f schema.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy search

-- ==================== ENUMS ====================
CREATE TYPE user_role AS ENUM ('farmer', 'buyer', 'admin');
CREATE TYPE listing_status AS ENUM ('draft', 'active', 'paused', 'expired', 'flagged', 'deleted');
CREATE TYPE inquiry_status AS ENUM ('sent', 'replied', 'negotiating', 'confirmed', 'cancelled');
CREATE TYPE deal_status AS ENUM ('confirmed', 'dispatched', 'delivered', 'completed', 'disputed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'in_escrow', 'released', 'refunded', 'failed');
CREATE TYPE message_sender AS ENUM ('farmer', 'buyer', 'system');
CREATE TYPE quality_grade AS ENUM ('A', 'B', 'C');
CREATE TYPE qty_unit AS ENUM ('kg', 'quintal', 'ton', 'dozen', 'piece');
CREATE TYPE business_type AS ENUM ('wholesaler', 'retailer', 'horeca', 'individual', 'fpo', 'export');
CREATE TYPE premium_tier AS ENUM ('standard', 'premium_monthly', 'premium_quarterly', 'premium_annual');

-- ==================== USERS (single table for all roles) ====================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           VARCHAR(15) UNIQUE NOT NULL,        -- +91XXXXXXXXXX format
  role            user_role NOT NULL,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(120),
  state           VARCHAR(50) NOT NULL,
  district        VARCHAR(80) NOT NULL,
  village         VARCHAR(120),
  -- Farmer-specific
  land_size_acres NUMERIC(8,2),
  primary_crops   TEXT[],                             -- crop_ids array
  bank_account    VARCHAR(30),
  ifsc            VARCHAR(15),
  upi_id          VARCHAR(80),
  -- Buyer-specific
  business_type   business_type,
  business_name   VARCHAR(150),
  gst_number      VARCHAR(20),
  -- Common
  verified        BOOLEAN DEFAULT FALSE,
  premium_tier    premium_tier DEFAULT 'standard',
  premium_until   TIMESTAMPTZ,
  rating          NUMERIC(3,2) DEFAULT 0,
  rating_count    INT DEFAULT 0,
  wallet_balance  INT DEFAULT 0,                      -- in paise
  fcm_token       VARCHAR(255),
  status          VARCHAR(20) DEFAULT 'active',       -- active, suspended, deleted
  deleted_at      TIMESTAMPTZ,                        -- soft delete
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_state ON users(state, district);
CREATE INDEX idx_users_premium ON users(premium_tier, premium_until) WHERE premium_tier <> 'standard';

-- ==================== OTP CODES ====================
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       VARCHAR(15) NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,                  -- bcrypt hash, never plain
  purpose     VARCHAR(30) NOT NULL,                   -- signup, login
  attempts    INT DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_otp_phone ON otp_codes(phone, created_at DESC);

-- ==================== CROP CATALOG ====================
CREATE TABLE crops (
  id              VARCHAR(10) PRIMARY KEY,            -- C001, C002 ...
  category        VARCHAR(40) NOT NULL,
  sub_category    VARCHAR(40),
  name            VARCHAR(80) NOT NULL,
  hindi_name      VARCHAR(80),
  default_units   qty_unit[] NOT NULL,
  ref_price_min   NUMERIC(10,2),                      -- per kg reference
  ref_price_max   NUMERIC(10,2),
  is_seasonal     BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crops_category ON crops(category) WHERE active = TRUE;
CREATE INDEX idx_crops_name_trgm ON crops USING GIN (name gin_trgm_ops);

-- ==================== LISTINGS ====================
CREATE TABLE listings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id      VARCHAR(20) UNIQUE NOT NULL,        -- LS-0047
  farmer_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop_id         VARCHAR(10) NOT NULL REFERENCES crops(id),
  variety         VARCHAR(80),
  quantity        NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit            qty_unit NOT NULL,
  price_per_unit  NUMERIC(10,2) NOT NULL CHECK (price_per_unit > 0),
  min_order_qty   NUMERIC(12,2),
  available_from  DATE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  quality_grade   quality_grade DEFAULT 'B',
  is_organic      BOOLEAN DEFAULT FALSE,
  no_pesticide    BOOLEAN DEFAULT FALSE,
  description     TEXT,
  photos          TEXT[],                             -- Cloudinary URLs
  show_village    BOOLEAN DEFAULT TRUE,               -- privacy toggle
  status          listing_status DEFAULT 'active',
  view_count      INT DEFAULT 0,
  inquiry_count   INT DEFAULT 0,
  search_vec      tsvector,                           -- full-text search
  -- Moderation
  flagged_reason  VARCHAR(200),
  moderator_id    UUID REFERENCES users(id),
  moderated_at    TIMESTAMPTZ,
  -- Audit
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_status ON listings(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_listings_farmer ON listings(farmer_id);
CREATE INDEX idx_listings_crop ON listings(crop_id);
CREATE INDEX idx_listings_active_recent ON listings(created_at DESC) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_listings_search ON listings USING GIN(search_vec);
CREATE INDEX idx_listings_price ON listings(price_per_unit) WHERE status = 'active';

-- Trigger: auto-update search_vec
CREATE OR REPLACE FUNCTION listings_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vec := to_tsvector('simple',
    coalesce((SELECT name FROM crops WHERE id = NEW.crop_id), '') || ' ' ||
    coalesce(NEW.variety, '') || ' ' ||
    coalesce(NEW.description, '')
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_listings_search BEFORE INSERT OR UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION listings_search_update();

-- Display ID generator
CREATE SEQUENCE listing_display_seq START 1000;
CREATE OR REPLACE FUNCTION gen_listing_display_id() RETURNS trigger AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := 'LS-' || LPAD(nextval('listing_display_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_listings_displayid BEFORE INSERT ON listings
  FOR EACH ROW EXECUTE FUNCTION gen_listing_display_id();

-- ==================== INQUIRIES ====================
CREATE TABLE inquiries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id          VARCHAR(20) UNIQUE NOT NULL,    -- INQ-2401
  listing_id          UUID NOT NULL REFERENCES listings(id),
  buyer_id            UUID NOT NULL REFERENCES users(id),
  farmer_id           UUID NOT NULL REFERENCES users(id),
  quantity_requested  NUMERIC(12,2) NOT NULL,
  unit                qty_unit NOT NULL,
  offer_price         NUMERIC(10,2),
  initial_message     TEXT,
  status              inquiry_status DEFAULT 'sent',
  cancellation_reason VARCHAR(80),
  last_message_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inquiries_buyer ON inquiries(buyer_id, created_at DESC);
CREATE INDEX idx_inquiries_farmer ON inquiries(farmer_id, created_at DESC);
CREATE INDEX idx_inquiries_listing ON inquiries(listing_id);
CREATE INDEX idx_inquiries_status ON inquiries(status);

CREATE SEQUENCE inquiry_display_seq START 1000;
CREATE OR REPLACE FUNCTION gen_inquiry_display_id() RETURNS trigger AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := 'INQ-' || LPAD(nextval('inquiry_display_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inquiries_displayid BEFORE INSERT ON inquiries
  FOR EACH ROW EXECUTE FUNCTION gen_inquiry_display_id();

-- ==================== MESSAGES ====================
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inquiry_id    UUID NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  sender_type   message_sender NOT NULL,
  sender_id     UUID,                                 -- null for system messages
  content       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_inquiry ON messages(inquiry_id, created_at);

-- ==================== DEALS ====================
CREATE TABLE deals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id        VARCHAR(20) UNIQUE NOT NULL,      -- DEAL-0091
  inquiry_id        UUID NOT NULL REFERENCES inquiries(id),
  listing_id        UUID NOT NULL REFERENCES listings(id),
  farmer_id         UUID NOT NULL REFERENCES users(id),
  buyer_id          UUID NOT NULL REFERENCES users(id),
  crop_id           VARCHAR(10) NOT NULL REFERENCES crops(id),
  final_quantity    NUMERIC(12,2) NOT NULL,
  unit              qty_unit NOT NULL,
  final_price       NUMERIC(10,2) NOT NULL,
  total_value       NUMERIC(14,2) NOT NULL,
  platform_fee_pct  NUMERIC(5,2) DEFAULT 0,
  platform_fee_amt  NUMERIC(12,2) DEFAULT 0,
  status            deal_status DEFAULT 'confirmed',
  payment_status    payment_status DEFAULT 'pending',
  -- Ratings
  buyer_rated_at    TIMESTAMPTZ,
  buyer_rating      INT CHECK (buyer_rating BETWEEN 1 AND 5),
  buyer_review      TEXT,
  farmer_rated_at   TIMESTAMPTZ,
  farmer_rating     INT CHECK (farmer_rating BETWEEN 1 AND 5),
  farmer_review     TEXT,
  -- Lifecycle timestamps
  dispatched_at     TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancellation_reason VARCHAR(120),
  dispute_opened_at TIMESTAMPTZ,
  dispute_reason    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_farmer ON deals(farmer_id, created_at DESC);
CREATE INDEX idx_deals_buyer ON deals(buyer_id, created_at DESC);
CREATE INDEX idx_deals_status ON deals(status);

CREATE SEQUENCE deal_display_seq START 1000;
CREATE OR REPLACE FUNCTION gen_deal_display_id() RETURNS trigger AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := 'DEAL-' || LPAD(nextval('deal_display_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deals_displayid BEFORE INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION gen_deal_display_id();

-- ==================== TRANSACTIONS ====================
CREATE TABLE transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id             UUID REFERENCES deals(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  txn_type            VARCHAR(30) NOT NULL,           -- escrow_in, escrow_release, premium, refund
  amount              NUMERIC(14,2) NOT NULL,
  platform_fee        NUMERIC(12,2) DEFAULT 0,
  net_amount          NUMERIC(14,2) NOT NULL,
  status              payment_status DEFAULT 'pending',
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_signature  VARCHAR(255),
  failure_reason      TEXT,
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_txn_deal ON transactions(deal_id);
CREATE INDEX idx_txn_user ON transactions(user_id, created_at DESC);
CREATE INDEX idx_txn_razorpay ON transactions(razorpay_payment_id);

-- ==================== AUDIT LOG ====================
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  actor_role  user_role,
  action      VARCHAR(80) NOT NULL,
  entity      VARCHAR(40) NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);

-- ==================== REFRESH TOKENS ====================
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ==================== SEED DATA: CROP CATALOG ====================
INSERT INTO crops (id, category, sub_category, name, hindi_name, default_units, ref_price_min, ref_price_max) VALUES
('C001','Vegetables','Nightshade','Tomato','टमाटर',ARRAY['kg','quintal']::qty_unit[],12,30),
('C002','Vegetables','Bulb','Onion','प्याज',ARRAY['kg','quintal']::qty_unit[],8,22),
('C003','Vegetables','Tuber','Potato','आलू',ARRAY['kg','quintal']::qty_unit[],6,15),
('C004','Grains','Wheat','Wheat','गेहूं',ARRAY['kg','quintal']::qty_unit[],22,28),
('C005','Grains','Rice','Basmati Rice','बासमती चावल',ARRAY['kg','quintal']::qty_unit[],40,80),
('C006','Pulses','Pigeon','Toor Dal','तूर दाल',ARRAY['kg','quintal']::qty_unit[],80,120),
('C007','Fruits','Drupe','Mango','आम',ARRAY['kg','dozen']::qty_unit[],30,120),
('C008','Fruits','Tropical','Banana','केला',ARRAY['dozen','quintal']::qty_unit[],20,40),
('C009','Spices','Dry','Turmeric','हल्दी',ARRAY['kg','quintal']::qty_unit[],80,150),
('C010','Spices','Dry','Red Chilli','लाल मिर्च',ARRAY['kg','quintal']::qty_unit[],100,200),
('C011','Oilseeds','Legume','Groundnut','मूंगफली',ARRAY['kg','quintal']::qty_unit[],50,75),
('C012','Cash Crops','Fiber','Cotton','कपास',ARRAY['quintal']::qty_unit[],5500,7000);

-- ==================== ROW-LEVEL SECURITY (Supabase) ====================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- Public can read active listings
CREATE POLICY listings_public_read ON listings FOR SELECT USING (status = 'active' AND deleted_at IS NULL);
-- Farmer can manage own listings
CREATE POLICY listings_farmer_write ON listings FOR ALL
  USING (farmer_id = current_setting('app.current_user_id', TRUE)::uuid);
-- Inquiries visible only to participants
CREATE POLICY inquiries_participants ON inquiries FOR SELECT
  USING (buyer_id = current_setting('app.current_user_id', TRUE)::uuid
      OR farmer_id = current_setting('app.current_user_id', TRUE)::uuid);
