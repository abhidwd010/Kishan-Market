// src/routes/admin.js — moderation, user mgmt, analytics
const router = require('express').Router();
const { z } = require('zod');
const db = require('../utils/db');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

// ─── Listings moderation queue ───────────────────
router.get('/listings/pending', async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT l.id, l.display_id, l.created_at, l.photos, l.description, l.price_per_unit,
             c.name AS crop, u.name AS farmer, u.state, u.district, u.phone
        FROM listings l JOIN crops c ON c.id = l.crop_id
        JOIN users u ON u.id = l.farmer_id
       WHERE l.status = 'active' AND l.moderated_at IS NULL AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC LIMIT 100`);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

router.patch('/listings/:id', async (req, res, next) => {
  try {
    const { action, reason } = z.object({
      action: z.enum(['approve', 'flag', 'unflag']),
      reason: z.string().max(200).optional(),
    }).parse(req.body);

    let sql, params;
    if (action === 'approve') {
      sql = `UPDATE listings SET moderated_at = NOW(), moderator_id = $2, flagged_reason = NULL,
                                  status = 'active' WHERE id = $1 RETURNING *`;
      params = [req.params.id, req.user.id];
    } else if (action === 'flag') {
      sql = `UPDATE listings SET status = 'flagged', moderated_at = NOW(),
                                  moderator_id = $2, flagged_reason = $3 WHERE id = $1 RETURNING *`;
      params = [req.params.id, req.user.id, reason || 'Quality issue'];
    } else {
      sql = `UPDATE listings SET status = 'active', flagged_reason = NULL,
                                  moderated_at = NOW(), moderator_id = $2 WHERE id = $1 RETURNING *`;
      params = [req.params.id, req.user.id];
    }
    const r = await db.query(sql, params);
    if (!r.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');

    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, after, ip_address)
       VALUES ($1, 'admin', $2, 'listing', $3, $4, $5)`,
      [req.user.id, action, req.params.id, { reason }, req.ip]);

    res.json({ listing: r.rows[0] });
  } catch (e) { next(e); }
});

// ─── User mgmt ───────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { role, q, limit = 50 } = req.query;
    const params = []; const where = ['deleted_at IS NULL'];
    if (role) { params.push(role); where.push(`role = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
    params.push(parseInt(limit, 10));
    const r = await db.query(`
      SELECT id, role, name, phone, state, district, premium_tier, rating, rating_count,
             status, created_at FROM users
       WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { action } = z.object({ action: z.enum(['suspend', 'unsuspend', 'verify']) }).parse(req.body);
    const map = {
      suspend: "status = 'suspended'",
      unsuspend: "status = 'active'",
      verify: 'verified = TRUE',
    };
    const r = await db.query(`UPDATE users SET ${map[action]} WHERE id = $1 RETURNING id, status, verified`, [req.params.id]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, ip_address)
       VALUES ($1, 'admin', $2, 'user', $3, $4)`,
      [req.user.id, action, req.params.id, req.ip]);
    res.json({ user: r.rows[0] });
  } catch (e) { next(e); }
});

// ─── Analytics ───────────────────────────────────
router.get('/analytics', async (req, res, next) => {
  try {
    const range = parseInt(req.query.days || '30', 10);
    const since = `NOW() - INTERVAL '${range} days'`;

    const [farmers, buyers, listings, deals, gmv, fees, byState, topCrops] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'farmer' AND created_at > ${since}`),
      db.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'buyer' AND created_at > ${since}`),
      db.query(`SELECT COUNT(*)::int AS c FROM listings WHERE created_at > ${since}`),
      db.query(`SELECT COUNT(*)::int AS c FROM deals WHERE created_at > ${since}`),
      db.query(`SELECT COALESCE(SUM(total_value),0)::numeric AS s FROM deals WHERE created_at > ${since}`),
      db.query(`SELECT COALESCE(SUM(platform_fee_amt),0)::numeric AS s FROM deals WHERE created_at > ${since}`),
      db.query(`SELECT state, COUNT(*)::int AS c FROM users
                 WHERE role = 'farmer' AND deleted_at IS NULL
                 GROUP BY state ORDER BY c DESC LIMIT 10`),
      db.query(`SELECT c.name, COUNT(*)::int AS c FROM listings l
                  JOIN crops c ON c.id = l.crop_id
                 WHERE l.status = 'active' AND l.deleted_at IS NULL
                 GROUP BY c.name ORDER BY c DESC LIMIT 10`),
    ]);

    res.json({
      range_days: range,
      summary: {
        new_farmers: farmers.rows[0].c,
        new_buyers: buyers.rows[0].c,
        new_listings: listings.rows[0].c,
        deals_count: deals.rows[0].c,
        gmv: parseFloat(gmv.rows[0].s),
        platform_revenue: parseFloat(fees.rows[0].s),
      },
      farmers_by_state: byState.rows,
      top_crops: topCrops.rows,
    });
  } catch (e) { next(e); }
});

router.get('/disputes', async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT d.*, u_b.name AS buyer_name, u_f.name AS farmer_name, c.name AS crop_name
        FROM deals d JOIN users u_b ON u_b.id = d.buyer_id
        JOIN users u_f ON u_f.id = d.farmer_id
        JOIN crops c ON c.id = d.crop_id
       WHERE d.status = 'disputed' ORDER BY d.dispute_opened_at DESC`);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
