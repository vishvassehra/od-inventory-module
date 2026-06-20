const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes     = require('./modules/auth/auth.routes');
const userRoutes     = require('./modules/auth/user.routes');
const superAdminRoutes = require('./modules/superadmin/superadmin.routes');
const mastersRoutes  = require('./modules/masters/masters.routes');
const purchaseRoutes = require('./modules/purchase/purchase.routes');
const stockRoutes    = require('./modules/stock/stock.routes');

const app = express();
connectDB();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(mongoSanitize());

const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false });
const authLimiter   = rateLimit({ windowMs: 15*60*1000, max: 20 });
app.use(globalLimiter);
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));
}

app.get('/health', (req, res) => res.json({
  status: 'ok', service: 'od-inventory-module',
  version: '1.0.0', env: process.env.NODE_ENV,
  timestamp: new Date().toISOString()
}));

app.use('/api/v1/auth',       authLimiter, authRoutes);
app.use('/api/v1/users',      userRoutes);
app.use('/api/v1/superadmin', superAdminRoutes);
app.use('/api/v1/masters',    mastersRoutes);
app.use('/api/v1/purchase',   purchaseRoutes);
app.use('/api/v1/stock',      stockRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`OD Inventory running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`));
module.exports = app;
