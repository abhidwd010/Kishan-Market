// src/routes/inquiries.js — inquiry lifecycle + in-thread messaging
const router = require('express').Router();
const { z } = require('zod');
const db = require('../utils/db');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');

const sendInquirySchema = z.object({
  listing_id: z.string().uuid(),
  quantity_requested: z.number().positive(),
  unit: z.enum(['kg', 'quintal', 'ton', 'dozen', 'piece']),
  offer_price: z.number().positive().optional(),
  message: z.string().max(500).optional(),
});

router.post('/', requireAuth, requireRole('buyer'), async (req, res, next) => {
  try {
    const data = sendInquirySchema.parse(req.body);
    const ls = await db.query(
      `SELECT id, farmer_id, min_order_qty, status FROM listings
         WHERE id = $1 AND deleted_at IS NULL`,
      [data.listing_id]
    );
    if (!ls.rows[0]) throw new HttpError(404, 'Listing not found', 'NOT_FOUND');
    if (ls.rows[0].status !== 'active') throw new HttpError(409, 'Listing not active', 'INACTIVE');
    if (ls.rows[0].farmer_id === req.user.id) throw new HttpError(400, 'Cannot inquire on own listing', 'SELF');
    if (ls.rows[0].min_order_qty && data.quantity_requested < ls.rows[0].min_order_qty) {
      throw new HttpError(400, `Minimum order is ${ls.rows[0].min_order_qty}`, 'MIN_QTY');
    }

    const result = await db.transaction(async (client) => {
      const ins = await client.query(`
        INSERT INTO inquiries (listing_id, buyer_id, farmer_id, quantity_requested, unit, offer_price, initial_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
      `, [data.listing_id, req.user.id, ls.rows[0].farmer_id, data.quantity_requested, data.unit,
          data.offer_price || null, data.message || null]);
      const inquiry = ins.rows[0];

      if (data.message) {
        await client.query(`
          INSERT INTO messages (inquiry_id, sender_type, sender_id, content)
          VALUES ($1, 'buyer', $2, $3)`,
          [inquiry.id, req.user.id, data.message]);
      }
      await client.query('UPDATE listings SET inquiry_count = inquiry_count + 1 WHERE id = $1', [data.listing_id]);
      return inquiry;
    });

    // Notify farmer via Socket.io
    const io = req.app.get('io');
    io.to(`user:${ls.rows[0].farmer_id}`).emit('inquiry:new', result);

    res.status(201).json({ inquiry: result });
  } catch (e) { next(e); }
});

// List my inquiries (farmer or buyer)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const col = req.user.role === 'farmer' ? 'farmer_id' : 'buyer_id';
    const r = await db.query(`
      SELECT i.*, l.display_id AS listing_display_id, c.name AS crop_name,
             u_b.name AS buyer_name, u_b.business_name, u_b.state AS buyer_state,
             u_f.name AS farmer_name, u_f.state AS farmer_state, u_f.district AS farmer_district,
             (SELECT COUNT(*) FROM messages m WHERE m.inquiry_id = i.id AND m.read_at IS NULL AND m.sender_type <> $2) AS unread
        FROM inquiries i
        JOIN listings l ON l.id = i.listing_id
        JOIN crops c ON c.id = l.crop_id
        JOIN users u_b ON u_b.id = i.buyer_id
        JOIN users u_f ON u_f.id = i.farmer_id
       WHERE i.${col} = $1
       ORDER BY i.last_message_at DESC`,
      [req.user.id, req.user.role]);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

// Get one (with messages)
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const inq = await db.query(`
      SELECT i.*, l.display_id AS listing_display_id, l.price_per_unit AS listing_price,
             c.name AS crop_name, c.category,
             u_b.name AS buyer_name, u_b.phone AS buyer_phone,
             u_f.name AS farmer_name, u_f.phone AS farmer_phone
        FROM inquiries i
        JOIN listings l ON l.id = i.listing_id
        JOIN crops c ON c.id = l.crop_id
        JOIN users u_b ON u_b.id = i.buyer_id
        JOIN users u_f ON u_f.id = i.farmer_id
       WHERE i.id = $1`, [req.params.id]);

    if (!inq.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
    const inquiry = inq.rows[0];

    if (inquiry.buyer_id !== req.user.id && inquiry.farmer_id !== req.user.id) {
      throw new HttpError(403, 'Not a participant', 'FORBIDDEN');
    }

    // Hide phone unless deal confirmed
    if (inquiry.status !== 'confirmed') {
      delete inquiry.buyer_phone; delete inquiry.farmer_phone;
    }

    const msgs = await db.query(
      'SELECT id, sender_type, sender_id, content, read_at, created_at FROM messages WHERE inquiry_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    // Mark unread as read
    await db.query(
      'UPDATE messages SET read_at = NOW() WHERE inquiry_id = $1 AND read_at IS NULL AND sender_type <> $2',
      [req.params.id, req.user.role]
    );

    res.json({ inquiry, messages: msgs.rows });
  } catch (e) { next(e); }
});

// Send message in thread
const msgSchema = z.object({ content: z.string().min(1).max(1000) });

router.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const { content } = msgSchema.parse(req.body);
    const inq = await db.query(
      'SELECT buyer_id, farmer_id, status FROM inquiries WHERE id = $1', [req.params.id]
    );
    if (!inq.rows[0]) throw new HttpError(404, 'Inquiry not found', 'NOT_FOUND');
    const { buyer_id, farmer_id, status } = inq.rows[0];
    if (req.user.id !== buyer_id && req.user.id !== farmer_id) {
      throw new HttpError(403, 'Not a participant', 'FORBIDDEN');
    }
    if (['cancelled', 'confirmed'].includes(status) && req.user.role !== 'admin') {
      throw new HttpError(409, 'Inquiry closed', 'CLOSED');
    }

    const sender = req.user.role; // 'farmer' or 'buyer'
    const r = await db.query(`
      INSERT INTO messages (inquiry_id, sender_type, sender_id, content)
      VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, sender, req.user.id, content]
    );

    const newStatus = status === 'sent' && sender === 'farmer' ? 'replied' :
                       status === 'replied' ? 'negotiating' : status;
    await db.query(
      'UPDATE inquiries SET last_message_at = NOW(), status = $2 WHERE id = $1',
      [req.params.id, newStatus]
    );

    // Real-time push
    const io = req.app.get('io');
    io.to(`inquiry:${req.params.id}`).emit('message:new', r.rows[0]);
    const recipient = sender === 'buyer' ? farmer_id : buyer_id;
    io.to(`user:${recipient}`).emit('inquiry:update', { inquiry_id: req.params.id });

    res.status(201).json({ message: r.rows[0] });
  } catch (e) { next(e); }
});

// Confirm deal — both parties must confirm; auto-creates Deal record
router.post('/:id/confirm', requireAuth, async (req, res, next) => {
  try {
    const { final_quantity, final_price } = z.object({
      final_quantity: z.number().positive(),
      final_price: z.number().positive(),
    }).parse(req.body);

    const result = await db.transaction(async (client) => {
      const inq = await client.query(
        'SELECT * FROM inquiries WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!inq.rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
      const inquiry = inq.rows[0];
      if (req.user.id !== inquiry.buyer_id && req.user.id !== inquiry.farmer_id) {
        throw new HttpError(403, 'Not a participant', 'FORBIDDEN');
      }
      if (inquiry.status === 'confirmed') throw new HttpError(409, 'Already confirmed', 'CONFIRMED');
      if (inquiry.status === 'cancelled') throw new HttpError(409, 'Cancelled', 'CANCELLED');

      const totalValue = final_quantity * final_price;
      const feePct = parseFloat(process.env.PLATFORM_FEE_PCT || '0');
      const feeAmt = +(totalValue * feePct / 100).toFixed(2);

      const listing = await client.query('SELECT crop_id, unit FROM listings WHERE id = $1', [inquiry.listing_id]);

      const deal = await client.query(`
        INSERT INTO deals (inquiry_id, listing_id, farmer_id, buyer_id, crop_id,
          final_quantity, unit, final_price, total_value, platform_fee_pct, platform_fee_amt, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed')
        RETURNING *`,
        [inquiry.id, inquiry.listing_id, inquiry.farmer_id, inquiry.buyer_id,
         listing.rows[0].crop_id, final_quantity, listing.rows[0].unit, final_price,
         totalValue, feePct, feeAmt]);

      await client.query("UPDATE inquiries SET status = 'confirmed' WHERE id = $1", [req.params.id]);

      await client.query(`
        INSERT INTO messages (inquiry_id, sender_type, content)
        VALUES ($1, 'system', $2)`,
        [req.params.id, `✅ Deal confirmed: ${final_quantity} ${listing.rows[0].unit} at ₹${final_price}/${listing.rows[0].unit} = ₹${totalValue.toLocaleString('en-IN')}`]);

      return deal.rows[0];
    });

    const io = req.app.get('io');
    io.to(`inquiry:${req.params.id}`).emit('deal:confirmed', result);
    res.status(201).json({ deal: result });
  } catch (e) { next(e); }
});

// Cancel
router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const reason = z.string().max(80).parse(req.body.reason || 'Other');
    const r = await db.query(`
      UPDATE inquiries SET status = 'cancelled', cancellation_reason = $3
       WHERE id = $1 AND (buyer_id = $2 OR farmer_id = $2) AND status NOT IN ('confirmed','cancelled')
      RETURNING *`, [req.params.id, req.user.id, reason]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found or already closed', 'NOT_FOUND');
    res.json({ inquiry: r.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
