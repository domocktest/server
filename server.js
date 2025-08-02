const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('./config');

const app = express();

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://examnest.vercel.app/', // Replace with your actual frontend domain
      config.cors.frontendUrl
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

// Create Order
app.post('/api/create-order', async (req, res) => {
  try {
    const { planId, userId, amount, currency = 'INR' } = req.body;

    // Validate input
    if (!planId || !userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: planId, userId, and amount are required'
      });
    }

    // Validate amount (must be positive and in paise)
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Validate currency
    if (currency !== 'INR') {
      return res.status(400).json({
        success: false,
        message: 'Only INR currency is supported'
      });
    }

    // Validate amount limits
    if (amount < 100 || amount > 1000000) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be between ₹1 and ₹10,000'
      });
    }

    // Create Razorpay order
    const options = {
      amount: amount, // amount in paise
      currency: currency,
      receipt: `order_${Date.now().toString().slice(-8)}_${userId.slice(-8)}`, // Keep receipt under 40 chars
      notes: {
        planId: planId,
        userId: userId
      }
    };

    console.log('Creating Razorpay order with options:', {
      amount: options.amount,
      currency: options.currency,
      receipt: options.receipt,
      planId: options.notes.planId,
      userId: options.notes.userId
    });

    const order = await razorpay.orders.create(options);

    console.log('Razorpay order created successfully:', {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (error) {
    console.error('Error creating order:', error);
    
    // Handle specific Razorpay errors
    if (error.error && error.error.description) {
      res.status(400).json({
        success: false,
        message: `Payment Error: ${error.error.description}`,
        errorCode: error.error.code
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to create order. Please try again.'
      });
    }
  }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      planId,
      userId
    } = req.body;

    // Validate input
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification data'
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Payment is verified
    console.log('Payment verified successfully:', {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      planId: planId,
      userId: userId
    });

    // Here you would typically:
    // 1. Update user subscription in database
    // 2. Send confirmation email
    // 3. Log the transaction

    res.json({
      success: true,
      message: 'Payment verified successfully',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

// Get Payment Status
app.get('/api/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await razorpay.payments.fetch(paymentId);
    
    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        created_at: payment.created_at
      }
    });

  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status'
    });
  }
});

// Webhook for payment events
app.post('/api/webhook', async (req, res) => {
  try {
    const webhookSecret = config.razorpay.webhookSecret;
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const event = req.body;

    switch (event.event) {
      case 'payment.captured':
        // Handle successful payment
        console.log('Payment captured:', event.payload.payment.entity);
        break;
      
      case 'payment.failed':
        // Handle failed payment
        console.log('Payment failed:', event.payload.payment.entity);
        break;
      
      case 'subscription.activated':
        // Handle subscription activation
        console.log('Subscription activated:', event.payload.subscription.entity);
        break;
      
      case 'subscription.cancelled':
        // Handle subscription cancellation
        console.log('Subscription cancelled:', event.payload.subscription.entity);
        break;
      
      default:
        console.log('Unhandled event:', event.event);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = config.server.port;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${config.server.nodeEnv}`);
  console.log(`CORS enabled for: ${config.cors.frontendUrl}`);
});

module.exports = app; 