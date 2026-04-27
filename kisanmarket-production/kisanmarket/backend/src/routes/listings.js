// src/routes/listings.js — CRUD + browse + search
const router = require('express').Router();
const { z } = require('zod');
const db = require('../utils/db');
const { requireAuth, optionalAuth, requireRole, HttpError } = require('../middleware/auth');
const { listingCreateLimit } = require('../middleware/rateLimiter');

// ─── Browse (public) ──────────────────────────────
const browseSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  grade: z.enum(['A', 'B', 'C']).optional(),
  organic: z.coerce.boolean().optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'qty_desc']).default('recent'),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

router.get('/', async (req, res, next) => {
  try {
    const f = browseSchema.parse(req.query);
    const params = [];
    const where = ['l.status = \'active\'', 'l.deleted_at IS NULL', 'l.expires_at > NOW()'];

    if (f.q) { params.push(`%${f.q}%`); where.push(`(c.name ILIKE $${params.length} OR l.variety ILIKE $${params.length})`); }
    if (f.category) { params.push(f.category); where.push(`c.category = $${params.length}`); }
    if (f.state) { params.push(f.state); where.push(`u.state = $${params.length}`); }
    if (f.district) { params.push(f.district); where.push(`u.district = $${params.length}`); }
    if (f.min_price != null) { params.push(f.min_price); where.push(`l.price_per_unit >= $${params.length}`); }
    if (f.max_price != null) { params.push(f.max_price); where.push(`l.price_per_unit <= $${params.length}`); }
    if (f.grade) { params.push(f.grade); where.push(`l.quality_grade = $${params.length}`); }
    if (f.organic === true) { where.push(`l.is_organic = TRUE`); }

    const orderMap = {
      recent: 'l.created_at DESC',
      price_asc: 'l.price_per_unit ASC',
      price_desc: 'l.price_per_unit DESC',
      qty_desc: 'l.quantity DESC',
    };
    // Premium farmers always boosted
    const orderBy = `CASE WHEN u.premium_tier <> 'standard' THEN 0 ELSE 1 END, ${orderMap[f.sort]}`;

    const offset = (f.page - 1) * f.limit;
    params.push(f.limit, offset);

    const sql = `
      SELECT
        l.id, l.display_id, l.variety, l.quantity, l.unit, l.price_per_unit,
        l.min_order_qty, l.quality_grade, l.is_organic, l.no_pesticide,
        l.description, l.photos, l.created_at, l.view_count,
        c.id AS crop_id, c.name AS crop_name, c.category, c.hindi_name,
        u.id AS farmer_id, u.name AS farmer_name, u.state, u.district,
        u.rating AS farmer_rating, u.rating_count, u.premium_tier,
        u.verified
      FROM listings l
      JOIN crops c ON c.id = l.crop_id
      JOIN users u ON u.id = l.farmer_id AND u.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const r = await db.query(sql, params);

    // Count total (cached short-term recommended)
    const countSql = `SELECT COUNT(*)::int AS c FROM listings l
      JOIN crops c ON c.id = l.crop_id JOIN users u ON u.id = l.farmer_id
      WHERE ${where.join(' AND ')}`;
    const countParams = params.slice(0, -2);
    const cr = await db.query(countSql, countParams);

    res.json({ items: r.rows, page: f.page, limit: f.limit, total: cr.rows[0].c });
  } catch (e) { next(e); }
});

// ─── Get one (public) ─────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT l.*, c.name AS crop_name, c.category, c.hindi_name,
             u.id AS farmer_id, u.name AS farmer_name, u.state, u.district, u.village,
             u.rating AS farmer_rating, u.rating_count, u.premium_tier, u.verified
        FROM listings l
        JOIN crops c ON c.id = l.crop_id
        JOIN users u ON u.id = l.farmer_id AND u.deleted_at IS NULL
       WHERE l.id = $1 AND l.deleted_at IS NULL
    `, [req.params.id]);

    if (!r.rows[0]) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
    const listing = r.rows[0];

    // Privacy: hide phone unless deal exists
    delete listing.farmer_phone;
    if (!listing.show_village) delete listing.village;

    // Increment view count async (don't block)
    db.query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [req.params.id]).catch(() => {});

    res.json({ listing });
  } catch (e) { next(e); }
});

// ─── Create (farmer only) ─────────────────────────
const createSchema = z.object({
  crop_id: z.string().regex(/^C\d{3,}$/),
  variety: z.string().max(80).optional(),
  quantity: z.number().positive(),
  unit: z.enum(['kg', 'quintal', 'ton', 'dozen', 'piece']),
  price_per_unit: z.number().positive(),
  min_order_qty: z.number().positive().optional(),
  available_from: z.string(),       // ISO date
  expires_at: z.string(),           // ISO datetime
  quality_grade: z.enum(['A', 'B', 'C']).default('B'),
  is_organic: z.boolean().default(false),
  no_pesticide: z.boolean().default(false),
  description: z.string().max(500).optional(),
  photos: z.array(z.string().url()).max(10).default([]),
  show_village: z.boolean().default(true),
});

router.post('/', requireAuth, requireRole('farmer'), listingCreateLimit, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    // Verify crop exists
    const crop = await db.query('SELECT id, default_units FROM crops WHERE id = $1 AND active = TRUE', [data.crop_id]);
    if (!crop.rows[0]) throw new HttpError(400, 'Crop not in catalog', 'BAD_CROP');
    if (!crop.rows[0].default_units.includes(data.unit)) {
      throw new HttpError(400, 'Unit not allowed for this crop', 'BAD_UNIT');
    }

    // Photo limit: standard = 4, premium = 10
    const me = await db.query('SELECT premium_tier FROM users WHERE id = $1', [req.user.id]);
    const maxPhotos = me.rows[0].premium_tier === 'standard' ? 4 : 10;
    if (data.photos.length > maxPhotos) {
      throw new HttpError(400, `Photo limit is ${maxPhotos}`, 'PHOTO_LIMIT');
    }

    const r = await db.query(`
      INSERT INTO listings (farmer_id, crop_id, variety, quantity, unit, price_per_unit,
        min_order_qty, available_from, expires_at, quality_grade, is_organic, no_pesticide,
        description, photos, show_village, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'active')
      RETURNING *`,
      [req.user.id, data.crop_id, data.variety, data.quantity, data.unit, data.price_per_unit,
       data.min_order_qty, data.available_from, data.expires_at, data.quality_grade, data.is_organic,
       data.no_pesticide, data.description, data.photos, data.show_village]
    );

    res.status(201).json({ listing: r.rows[0] });
  } catch (e) { next(e); }
});

// ─── Update (farmer only, own listing) ────────────
router.patch('/:id', requireAuth, requireRole('farmer'), async (req, res, next) => {
  try {
    const owns = await db.query('SELECT id FROM listings WHERE id = $1 AND farmer_id = $2 AND deleted_at IS NULL',
      [req.params.id, req.user.id]);
    if (!owns.rows[0]) throw new HttpError(404, 'Not found or not yours', 'FORBIDDEN');

    // Block edits if active negotiation
    const inq = await db.query(
      "SELECT 1 FROM inquiries WHERE listing_id = $1 AND status IN ('replied','negotiating') LIMIT 1",
      [req.params.id]);
    if (inq.rows[0]) throw new HttpError(409, 'Cannot edit while inquiry is active', 'INQ_ACTIVE');

    const allowed = ['variety', 'quantity', 'price_per_unit', 'min_order_qty', 'description',
                     'photos', 'is_organic', 'no_pesticide', 'quality_grade', 'expires_at', 'status'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) throw new HttpError(400, 'No fields to update', 'NO_FIELDS');

    params.push(req.params.id);
    const r = await db.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    res.json({ listing: r.rows[0] });
  } catch (e) { next(e); }
});

// ─── Soft delete ─────────────────────────────────
router.delete('/:id', requireAuth, requireRole('farmer'), async (req, res, next) => {
  try {
    const r = await db.query(
      "UPDATE listings SET deleted_at = NOW(), status = 'deleted' WHERE id = $1 AND farmer_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.user.id]
    );
    if (!r.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── My listings ─────────────────────────────────
router.get('/me/all', requireAuth, requireRole('farmer'), async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT l.*, c.name AS crop_name, c.category
        FROM listings l JOIN crops c ON c.id = l.crop_id
       WHERE l.farmer_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC`, [req.user.id]);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
