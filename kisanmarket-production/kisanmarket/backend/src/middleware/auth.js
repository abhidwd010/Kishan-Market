// src/middleware/auth.js
const jwt = require('jsonwebtoken');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sign = (payload, exp = process.env.JWT_ACCESS_EXPIRES || '15m') =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: exp });

const verify = (token) => jwt.verify(token, process.env.JWT_SECRET);

// Attach req.user if valid token, else 401
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required', 'NO_TOKEN'));
  try {
    req.user = verify(token);
    next();
  } catch (e) {
    next(new HttpError(401, 'Invalid or expired token', 'BAD_TOKEN'));
  }
};

// Optional auth — sets req.user if present, no error if absent
const optionalAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try { req.user = verify(token); } catch {}
  }
  next();
};

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Auth required', 'NO_AUTH'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Forbidden', 'BAD_ROLE'));
  next();
};

module.exports = { sign, verify, requireAuth, optionalAuth, requireRole, HttpError };
