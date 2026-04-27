// src/server.js — KisanMarket API entrypoint
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const { Server } = require('socket.io');

const logger = require('./utils/logger');
const db = require('./utils/db');
const redis = require('./utils/redis');
const { initSocket } = require('./services/socketService');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { globalRateLimit } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const inquiriesRoutes = require('./routes/inquiries');
const dealsRoutes = require('./routes/deals');
const paymentsRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const cropsRoutes = require('./routes/crops');
const uploadsRoutes = require('./routes/uploads');

const app = express();
const server = http.createServer(app);

// ─── Middleware ──────────────────────────
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: process.env.APP_URL?.split(',') || 'http://localhost:3000',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(globalRateLimit);

// ─── Healthcheck ─────────────────────────
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

// ─── API v1 ──────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/listings', listingsRoutes);
app.use('/api/v1/inquiries', inquiriesRoutes);
app.use('/api/v1/deals', dealsRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/crops', cropsRoutes);
app.use('/api/v1/uploads', uploadsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Socket.io ───────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.APP_URL?.split(',') || 'http://localhost:3000', credentials: true },
});
initSocket(io);
app.set('io', io);

// ─── Start ────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'KisanMarket API listening');
});

// Graceful shutdown
const shutdown = async (sig) => {
  logger.info({ sig }, 'Shutting down');
  server.close(() => process.exit(0));
  try { await db.end(); await redis.quit(); } catch {}
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
