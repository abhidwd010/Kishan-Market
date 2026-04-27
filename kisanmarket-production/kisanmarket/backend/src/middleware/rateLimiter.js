// src/middleware/rateLimiter.js — Redis-backed rate limiting
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const redis = require('../utils/redis');

const makeStore = (prefix) => new RedisStore({
  sendCommand: (...args) => redis.call(...args),
  prefix: `rl:${prefix}:`,
});

// 100 requests per minute per IP — sane default
const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  store: makeStore('global'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests, slow down' }),
});

// 5 OTPs per hour per phone
const otpRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  store: makeStore('otp'),
  keyGenerator: (req) => req.body?.phone || req.ip,
  handler: (_req, res) => res.status(429).json({ error: 'OTP limit reached. Try again in an hour.' }),
});

// 30 listings per day per farmer
const listingCreateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  store: makeStore('listing'),
  keyGenerator: (req) => req.user?.id || req.ip,
});

module.exports = { globalRateLimit, otpRateLimit, listingCreateLimit };
