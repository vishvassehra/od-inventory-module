const mongoose = require('mongoose');
const logger = require('./logger');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

const connectDB = async (retries = MAX_RETRIES) => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Recommended Atlas settings
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info(`MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected – attempting reconnect...');
    });

  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    if (retries > 0) {
      logger.info(`Retrying in ${RETRY_DELAY_MS / 1000}s... (${retries} retries left)`);
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      return connectDB(retries - 1);
    }
    logger.error('All MongoDB connection retries exhausted. Exiting.');
    process.exit(1);
  }
};

module.exports = connectDB;
