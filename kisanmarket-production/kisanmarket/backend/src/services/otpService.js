// src/services/otpService.js — OTP generation, send via MSG91, verify
const bcrypt = require('bcrypt');
const axios = require('axios');
const db = require('../utils/db');
const logger = require('../utils/logger');

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;

const normalizePhone = (raw) => {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  // India: accept 10-digit or 91-prefixed 12-digit
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
};

const generateCode = () => {
  if (process.env.OTP_BYPASS === 'true') return '123456';
  let n = '';
  for (let i = 0; i < OTP_LENGTH; i++) n += Math.floor(Math.random() * 10);
  return n;
};

const sendOTP = async (phone, purpose = 'login') => {
  const normalized = normalizePhone(phone);
  if (!normalized) throw Object.assign(new Error('Invalid phone'), { status: 400 });

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await db.query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [normalized, codeHash, purpose, expiresAt]
  );

  if (process.env.OTP_BYPASS === 'true') {
    logger.info({ phone: normalized, code }, 'OTP_BYPASS dev — code is 123456');
    return { sent: true, debug: code };
  }

  // MSG91 OTP send
  try {
    await axios.post('https://control.msg91.com/api/v5/otp', {
      template_id: process.env.MSG91_OTP_TEMPLATE_ID,
      mobile: normalized.replace('+', ''),
      otp: code,
    }, {
      headers: { authkey: process.env.MSG91_API_KEY },
      timeout: 10000,
    });
    return { sent: true };
  } catch (err) {
    logger.error({ err: err.message, phone: normalized }, 'MSG91 send failed');
    throw Object.assign(new Error('SMS send failed'), { status: 502 });
  }
};

const verifyOTP = async (phone, code) => {
  const normalized = normalizePhone(phone);
  if (!normalized) throw Object.assign(new Error('Invalid phone'), { status: 400 });

  const result = await db.query(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes
      WHERE phone = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized]
  );

  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('No OTP found, please request again'), { status: 400 });
  if (row.expires_at < new Date()) throw Object.assign(new Error('OTP expired'), { status: 400 });
  if (row.attempts >= MAX_ATTEMPTS) throw Object.assign(new Error('Too many attempts'), { status: 429 });

  const ok = await bcrypt.compare(String(code), row.code_hash);
  if (!ok) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw Object.assign(new Error('Wrong code'), { status: 400 });
  }

  await db.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
  return { phone: normalized };
};

module.exports = { sendOTP, verifyOTP, normalizePhone };
