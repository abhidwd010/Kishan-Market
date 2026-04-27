// src/routes/deals.js — deal lifecycle: dispatch, deliver, complete, rate, dispute
const router = require('express').Router();
const { z } = require('zod');
const db = require('../utils/db');
const { requireAuth, HttpError } = require('../middleware/auth');

// List my deals
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const col = req.user.role === 'farmer' ? 'farmer_id' : 'buyer_id';
    const r = await db.query(`
      SELECT d.*, c.name AS crop_name,
             u_b.name AS buyer_name, u_b.business_name,
             u_f.name AS farmer_name, u_f.state AS farmer_state
        FROM deals d
        JOIN crops c ON c.id = d.crop_id
        JOIN users u_b ON u_b.id = d.buyer_id
        JOIN users u_f ON u_f.id = d.farmer_id
       WHERE d.${col} = $1
       ORDER BY d.created_at DESC`, [req.user.id]);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT d.*, c.name AS crop_name, c.category,
             u_b.name AS buyer_name, u_b.phone AS buyer_phone, u_b.business_name,
             u_f.name AS farmer_name, u_f.phone AS farmer_phone, u_f.state AS farmer_state,
             u_f.upi_id AS farmer_upi
        FROM deals d
        JOIN crops c ON c.id = d.crop_id
        JOIN users u_b ON u_b.id = d.buyer_id
        JOIN users u_f ON u_f.id = d.farmer_id
       WHERE d.id = $1`, [req.params.id]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
    const deal = r.rows[0];
    if (deal.farmer_id !== req.user.id && deal.buyer_id !== req.user.id && req.user.role !== 'admin') {
      throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    }
    res.json({ deal });
  } catch (e) { next(e); }
});

// Farmer marks dispatched
router.post('/:id/dispatch', requireAuth, async (req, res, next) => {
  try {
    const meta = z.object({
      transporter: z.string().optional(),
      vehicle: z.string().optional(),
      eta_hours: z.number().optional(),
    }).parse(req.body || {});

    const r = await db.query(`
      UPDATE deals SET status = 'dispatched', dispatched_at = NOW()
       WHERE id = $1 AND farmer_id = $2 AND status = 'confirmed'
      RETURNING *`, [req.params.id, req.user.id]);
    if (!r.rows[0]) throw new HttpError(409, 'Cannot dispatch in current state', 'BAD_STATE');

    // System message in inquiry thread
    await db.query(`
      INSERT INTO messages (inquiry_id, sender_type, content)
      VALUES ($1, 'system', $2)`,
      [r.rows[0].inquiry_id,
       `🚚 Crop dispatched. ${meta.transporter ? `Transporter: ${meta.transporter}.` : ''} ${meta.vehicle ? `Vehicle: ${meta.vehicle}.` : ''} ${meta.eta_hours ? `ETA: ${meta.eta_hours}hrs` : ''}`]);

    res.json({ deal: r.rows[0] });
  } catch (e) { next(e); }
});

// Buyer confirms delivery
router.post('/:id/delivered', requireAuth, async (req, res, next) => {
  try {
    const r = await db.query(`
      UPDATE deals SET status = 'delivered', delivered_at = NOW()
       WHERE id = $1 AND buyer_id = $2 AND status = 'dispatched'
      RETURNING *`, [req.params.id, req.user.id]);
    if (!r.rows[0]) throw new HttpError(409, 'Cannot mark delivered', 'BAD_STATE');
    res.json({ deal: r.rows[0] });
  } catch (e) { next(e); }
});

// Mark deal complete + rate (either side)
const completeSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(500).optional(),
});

router.post('/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const { rating, review } = completeSchema.parse(req.body);
    const result = await db.transaction(async (client) => {
      const dealQ = await client.query('SELECT * FROM deals WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!dealQ.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
      const deal = dealQ.rows[0];

      const isBuyer = deal.buyer_id === req.user.id;
      const isFarmer = deal.farmer_id === req.user.id;
      if (!isBuyer && !isFarmer) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');

      const fields = isBuyer
        ? { col_at: 'buyer_rated_at', col_r: 'buyer_rating', col_rev: 'buyer_review', target: deal.farmer_id }
        : { col_at: 'farmer_rated_at', col_r: 'farmer_rating', col_rev: 'farmer_review', target: deal.buyer_id };

      if (deal[fields.col_at]) throw new HttpError(409, 'Already rated', 'RATED');

      await client.query(`
        UPDATE deals SET ${fields.col_at} = NOW(), ${fields.col_r} = $2, ${fields.col_rev} = $3,
                          status = CASE WHEN buyer_rated_at IS NOT NULL OR farmer_rated_at IS NOT NULL
                                        THEN 'completed' ELSE status END,
                          completed_at = COALESCE(completed_at, CASE WHEN $2 IS NOT NULL THEN NOW() END)
         WHERE id = $1`, [req.params.id, rating, review || null]);

      // Update target's rolling rating average
      const targetUser = await client.query('SELECT rating, rating_count FROM users WHERE id = $1', [fields.target]);
      const { rating: oldR, rating_count: oldC } = targetUser.rows[0];
      const newCount = oldC + 1;
      const newRating = ((parseFloat(oldR) * oldC) + rating) / newCount;
      await client.query('UPDATE users SET rating = $2, rating_count = $3 WHERE id = $1',
        [fields.target, newRating.toFixed(2), newCount]);

      const updated = await client.query('SELECT * FROM deals WHERE id = $1', [req.params.id]);
      return updated.rows[0];
    });

    res.json({ deal: result });
  } catch (e) { next(e); }
});

// Open dispute (within 24hr of delivery)
const disputeSchema = z.object({ reason: z.string().min(10).max(1000) });

router.post('/:id/dispute', requireAuth, async (req, res, next) => {
  try {
    const { reason } = disputeSchema.parse(req.body);
    const r = await db.query(`
      UPDATE deals SET status = 'disputed', dispute_opened_at = NOW(), dispute_reason = $3
       WHERE id = $1 AND buyer_id = $2 AND status = 'delivered'
         AND delivered_at > NOW() - INTERVAL '24 hours'
      RETURNING *`, [req.params.id, req.user.id, reason]);
    if (!r.rows[0]) throw new HttpError(409, 'Cannot dispute (must be within 24hr of delivery)', 'BAD_STATE');
    res.json({ deal: r.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
