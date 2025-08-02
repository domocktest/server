// Backend configuration file
require('dotenv').config();

const config = {
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET
  },
  server: {
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
  }
};

module.exports = config; 