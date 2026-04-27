// src/utils/redis.js
const Redis = require('ioredis');
const logger = require('./logger');

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false })
  : new Redis({ host: 'localhost', port: 6379, lazyConnect: false });

redis.on('error', (err) => logger.warn({ err: err.message }, 'Redis error (non-fatal)'));
redis.on('connect', () => logger.info('Redis connected'));

module.exports = redis;
