// src/routes/auth.js — OTP-based signup/login
const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../utils/db');
const { sendOTP, verifyOTP, normalizePhone } = require('../services/otpService');
const { sign, requireAuth, HttpError } = require('../middleware/auth');
const { otpRateLimit } = require('../middleware/rateLimiter');

const sendSchema = z.object({ phone: z.string().min(10) });

router.post('/send-otp', otpRateLimit, async (req, res, next) => {
  try {
    const { phone } = sendSchema.parse(req.body);
    const result = await sendOTP(phone, 'login');
    res.json({ ok: true, message: 'OTP sent', ...(process.env.NODE_ENV !== 'production' && { debug: result.debug }) });
  } catch (e) { next(e); }
});

const verifySchema = z.object({
  phone: z.string().min(10),
  code: z.string().length(6),
  // If new user, registration data:
  role: z.enum(['farmer', 'buyer']).optional(),
  name: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  district: z.string().min(2).optional(),
  village: z.string().optional(),
  business_type: z.enum(['wholesaler', 'retailer', 'horeca', 'individual', 'fpo', 'export']).optional(),
  business_name: z.string().optional(),
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const data = verifySchema.parse(req.body);
    const { phone } = await verifyOTP(data.phone, data.code);

    let userResult = await db.query('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [phone]);
    let user = userResult.rows[0];

    if (!user) {
      // New user — registration data required
      if (!data.role || !data.name || !data.state || !data.district) {
        return res.status(202).json({
          ok: true,
          newUser: true,
          message: 'Phone verified. Complete registration.',
          phone,
        });
      }
      const insert = await db.query(
        `INSERT INTO users (phone, role, name, state, district, village, business_type, business_name, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         RETURNING *`,
        [phone, data.role, data.name, data.state, data.district, data.village || null, data.business_type || null, data.business_name || null]
      );
      user = insert.rows[0];
    }

    if (user.status === 'suspended') throw new HttpError(403, 'Account suspended', 'SUSPENDED');

    const accessToken = sign({ id: user.id, role: user.role, phone: user.phone });

    // Refresh token (rotated)
    const refresh = crypto.randomBytes(40).toString('hex');
    const refreshHash = await bcrypt.hash(refresh, 8);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshHash, expiresAt]
    );

    res.cookie('rt', refresh, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      accessToken,
      user: {
        id: user.id, role: user.role, name: user.name, phone: user.phone,
        state: user.state, district: user.district, premium_tier: user.premium_tier,
        rating: user.rating, verified: user.verified,
      },
    });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT id, role, name, phone, state, district, village, premium_tier, premium_until, rating, rating_count, verified FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!r.rows[0]) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    res.json({ user: r.rows[0] });
  } catch (e) { next(e); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
    res.clearCookie('rt');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
