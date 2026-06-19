const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./modules/auth/auth.routes');
const superAdminRoutes = require('./modules/superadmin/superadmin.routes');
const mastersRoutes = require('./modules/masters/masters.routes');
const purchaseRoutes = require('./modules/purchase/purchase.routes');

const app = express();

// ── Connect to MongoDB ──────────────────────────────────────────────────────
connectDB();

// ── Security middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(mongoSanitize());

// ── Rate limiting ───────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
});

app.use(globalLimiter);

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Body parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── HTTP logging ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ── Health check ────────────────────────────────────────────────────────────
// TEMPORARY — remove after seeding
app.get('/seed-superadmin', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== 'okiedokie-seed-2025') return res.status(403).json({ message: 'Forbidden' });
  try {
    const User = require('./modules/auth/user.model');
    const { ROLES } = require('./config/constants');
    const exists = await User.findOne({ email: process.env.SA_EMAIL });
    if (exists) return res.json({ success: true, message: 'Super admin already exists' });
    await User.create({ tenantId: null, name: 'Okie Dokie Admin', email: process.env.SA_EMAIL, password: process.env.SA_PASSWORD, role: ROLES.SUPER_ADMIN, mustChangePassword: false });
    res.json({ success: true, message: 'Super admin created: ' + process.env.SA_EMAIL });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'od-inventory-module',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/superadmin', superAdminRoutes);
app.use('/api/v1/masters', mastersRoutes);
app.use('/api/v1/purchase', purchaseRoutes);

// ── 404 & Error handlers ────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`OD Inventory Module running on port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
