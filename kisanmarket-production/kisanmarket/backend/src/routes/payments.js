const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { z } = require('zod');
const Razorpay = require('razorpay');
const db = require('../utils/db');
const logger = require('../utils/logger');
const { requireAuth, HttpError } = require('../middleware/auth');

const rzp = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const PREMIUM_PRICES = {
  premium_monthly:   { amount: 19900, days: 30,  label: 'Premium Monthly' },
  premium_quarterly: { amount: 49900, days: 90,  label: 'Premium Quarterly' },
  premium_annual:    { amount: 149900, days: 365, label: 'Premium Annual' },
};

// ─── Buy Premium ─────────────────────────────────
const premiumSchema = z.object({
  tier: z.enum(['premium_monthly', 'premium_quarterly', 'premium_annual']),
});

router.post('/premium/order', requireAuth, async (req, res, next) => {
  try {
    if (!rzp) throw new HttpError(503, 'Payment gateway not configured', 'NO_GATEWAY');
    const { tier } = premiumSchema.parse(req.body);
    const { amount, label } = PREMIUM_PRICES[tier];

    const order = await rzp.orders.create({
      amount, currency: 'INR',
      receipt: `prem_${req.user.id.slice(0, 8)}_${Date.now()}`,
      notes: { user_id: req.user.id, tier, type: 'premium' },
    });

    await db.query(`
      INSERT INTO transactions (user_id, txn_type, amount, net_amount, status, razorpay_order_id, metadata)
      VALUES ($1, 'premium', $2, $2, 'pending', $3, $4)`,
      [req.user.id, amount / 100, order.id, { tier, label }]);

    res.json({ order_id: order.id, amount, currency: 'INR', key: process.env.RAZORPAY_KEY_ID });
  } catch (e) { next(e); }
});

// Manual verify after frontend checkout (in case webhook is slow)
const verifySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

router.post('/premium/verify', requireAuth, async (req, res, next) => {
  try {
    const data = verifySchema.parse(req.body);
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest('hex');
    if (expected !== data.razorpay_signature) {
      throw new HttpError(400, 'Invalid signature', 'BAD_SIG');
    }

    await db.transaction(async (client) => {
      const txn = await client.query(`
        UPDATE transactions
           SET status = 'paid', razorpay_payment_id = $2, razorpay_signature = $3, updated_at = NOW()
         WHERE razorpay_order_id = $1 AND user_id = $4 AND status = 'pending'
        RETURNING *`,
        [data.razorpay_order_id, data.razorpay_payment_id, data.razorpay_signature, req.user.id]);
      if (!txn.rows[0]) throw new HttpError(404, 'Transaction not found', 'NOT_FOUND');

      const tier = txn.rows[0].metadata.tier;
      const days = PREMIUM_PRICES[tier].days;
      await client.query(`
        UPDATE users SET premium_tier = $2,
                          premium_until = COALESCE(premium_until, NOW()) + INTERVAL '1 day' * $3
         WHERE id = $1`, [req.user.id, tier, days]);
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── Escrow Payment for Deal (Phase 2) ───────────
router.post('/escrow/order', requireAuth, async (req, res, next) => {
  try {
    if (!rzp) throw new HttpError(503, 'Gateway not configured', 'NO_GATEWAY');
    const { deal_id } = z.object({ deal_id: z.string().uuid() }).parse(req.body);

    const dealQ = await db.query('SELECT * FROM deals WHERE id = $1', [deal_id]);
    if (!dealQ.rows[0]) throw new HttpError(404, 'Deal not found', 'NOT_FOUND');
    const deal = dealQ.rows[0];
    if (deal.buyer_id !== req.user.id) throw new HttpError(403, 'Only buyer can pay', 'NOT_BUYER');
    if (deal.payment_status !== 'pending') throw new HttpError(409, 'Already paid', 'PAID');

    const amountPaise = Math.round(parseFloat(deal.total_value) * 100);

    const order = await rzp.orders.create({
      amount: amountPaise, currency: 'INR',
      receipt: `deal_${deal.display_id}_${Date.now()}`,
      notes: { deal_id, type: 'escrow', farmer_id: deal.farmer_id, buyer_id: deal.buyer_id },
    });

    await db.query(`
      INSERT INTO transactions (deal_id, user_id, txn_type, amount, platform_fee, net_amount, status, razorpay_order_id, metadata)
      VALUES ($1, $2, 'escrow_in', $3, $4, $5, 'pending', $6, $7)`,
      [deal_id, req.user.id, deal.total_value, deal.platform_fee_amt,
       parseFloat(deal.total_value) - parseFloat(deal.platform_fee_amt), order.id, { deal_display_id: deal.display_id }]);

    res.json({ order_id: order.id, amount: amountPaise, currency: 'INR', key: process.env.RAZORPAY_KEY_ID });
  } catch (e) { next(e); }
});


// ─── Razorpay Webhook ────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {

  try {
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body).digest('hex');
    if (expected !== signature) {
      logger.warn({ ip: req.ip }, 'Webhook signature mismatch');
      return res.status(400).send('bad signature');
    }

    const event = JSON.parse(req.body.toString());
    const payment = event.payload?.payment?.entity;
    if (!payment) return res.status(200).send('ignored');

    if (event.event === 'payment.captured') {
      await db.query(`
        UPDATE transactions
           SET status = 'paid', razorpay_payment_id = $2, updated_at = NOW()
         WHERE razorpay_order_id = $1 AND status = 'pending'`,
        [payment.order_id, payment.id]);

      // If escrow → mark deal as in_escrow
      const txn = await db.query(
        'SELECT deal_id, txn_type, metadata FROM transactions WHERE razorpay_order_id = $1',
        [payment.order_id]
      );
      if (txn.rows[0]?.txn_type === 'escrow_in' && txn.rows[0]?.deal_id) {
        await db.query("UPDATE deals SET payment_status = 'in_escrow' WHERE id = $1", [txn.rows[0].deal_id]);
      }
      if (txn.rows[0]?.txn_type === 'premium') {
        const meta = txn.rows[0].metadata;
        const days = PREMIUM_PRICES[meta.tier].days;
        await db.query(`
          UPDATE users u SET premium_tier = $2,
                              premium_until = COALESCE(u.premium_until, NOW()) + INTERVAL '1 day' * $3
            FROM transactions t
           WHERE t.id = $4 AND t.user_id = u.id`, [null, meta.tier, days, payment.notes?.user_id]);
      }
    }

    if (event.event === 'payment.failed') {
      await db.query(`
        UPDATE transactions SET status = 'failed', failure_reason = $2, updated_at = NOW()
         WHERE razorpay_order_id = $1`,
        [payment.order_id, payment.error_description || 'Failed']);
    }

    res.status(200).send('ok');
  } catch (e) {
    logger.error({ err: e }, 'Webhook handler error');
    res.status(500).send('error');
  }
});

module.exports = router;
