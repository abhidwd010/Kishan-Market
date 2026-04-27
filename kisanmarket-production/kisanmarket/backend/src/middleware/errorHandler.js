// src/middleware/errorHandler.js
const logger = require('../utils/logger');
const { ZodError } = require('zod');

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
};

const errorHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  if (err.status) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Postgres errors → safe public responses
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate value', code: 'DUPLICATE' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource missing', code: 'BAD_REF' });
  }

  logger.error({ err, path: req.originalUrl, body: req.body }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
};

module.exports = { errorHandler, notFoundHandler };
