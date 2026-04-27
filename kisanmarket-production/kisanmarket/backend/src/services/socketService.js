// src/services/socketService.js — Socket.io with Redis adapter for horizontal scale
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const { verify } = require('../middleware/auth');
const logger = require('../utils/logger');
const db = require('../utils/db');

const initSocket = async (io) => {
  // Redis adapter for multi-instance fanout
  if (process.env.REDIS_URL) {
    const pub = new Redis(process.env.REDIS_URL);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.io Redis adapter ready');
  }

  // JWT auth on connect
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      socket.user = verify(token);
      next();
    } catch (e) {
      next(new Error('Bad token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    socket.join(`user:${id}`);
    logger.info({ user: id, role }, 'Socket connected');

    socket.on('inquiry:join', async (inquiryId) => {
      // Authorize: user must be participant
      const r = await db.query(
        'SELECT 1 FROM inquiries WHERE id = $1 AND (buyer_id = $2 OR farmer_id = $2)',
        [inquiryId, id]
      );
      if (r.rows[0]) {
        socket.join(`inquiry:${inquiryId}`);
        socket.emit('inquiry:joined', { inquiryId });
      }
    });

    socket.on('inquiry:leave', (inquiryId) => socket.leave(`inquiry:${inquiryId}`));

    socket.on('typing', ({ inquiryId, isTyping }) => {
      socket.to(`inquiry:${inquiryId}`).emit('typing', { userId: id, role, isTyping });
    });

    socket.on('disconnect', () => logger.info({ user: id }, 'Socket disconnected'));
  });
};

module.exports = { initSocket };
