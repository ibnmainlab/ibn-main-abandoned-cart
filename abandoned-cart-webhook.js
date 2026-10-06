const express = require('express');
const twilio = require('twilio');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// Capture raw body BEFORE bodyParser parsing
app.use(express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  req.rawBody = req.body;
  next();
});

// NOW parse JSON
app.use(express.json());

// Credentials from environment variables ONLY
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Validate required environment variables
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !SHOPIFY_STORE || !SHOPIFY_WEBHOOK_SECRET) {
  throw new Error('Missing required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SHOPIFY_STORE, SHOPIFY_WEBHOOK_SECRET');
}

// WhatsApp numbers to receive alerts
const WHATSAPP_NUMBERS = [
  'whatsapp:+8801323935023',
  'whatsapp:+8801632303043'
];

// Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Store for active timeouts (to prevent duplicate messages if webhook fires multiple times)
const activeTimeouts = {};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'abandoned-cart-webhook' });
});

// Webhook endpoint for Shopify checkouts
app.post('/webhook/checkout', (req, res) => {
  const body = req.rawBody; // Use raw body buffer
  const hmacHeader = req.get('X-Shopify-Hmac-SHA256');

  // Verify Shopify webhook signature
  const hash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (hash !== hmacHeader) {
    console.error(`Invalid webhook signature. Expected: ${hash}, Got: ${hmacHeader}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✓ Webhook signature valid');

  const checkout = JSON.parse(req.rawBody.toString());
  const checkoutId = checkout.token;

  // DEBUG: Log what we're receiving
  console.log(`DEBUG: completed_at = ${checkout.completed_at}`);
  console.log(`DEBUG: abandoned_checkout_url = ${checkout.abandoned_checkout_url}`);
  console.log(`DEBUG: checkoutId (token) = ${checkoutId}`);

  // Detect abandoned cart: has abandoned_checkout_url but completed_at is null
  if (checkout.completed_at === null && checkout.abandoned_checkout_url) {
    console.log(`[${new Date().toISOString()}] Abandoned cart detected: ${checkoutId}`);

    // Skip if we already have a pending notification for this checkout
    if (activeTimeouts[checkoutId]) {
      console.log(`Already scheduled notification for ${checkoutId}`);
      return res.status(200).json({ message: 'Notification already scheduled' });
    }

    // Schedule notification after 10 minutes
    activeTimeouts[checkoutId] = setTimeout(() => {
      sendWhatsAppNotifications(checkout);
      delete activeTimeouts[checkoutId];
    }, 10 * 60 * 1000); // 10 minutes

    console.log(`Scheduled WhatsApp notification in 10 minutes for checkout ${checkoutId}`);
  }

  res.status(200).json({ message: 'Webhook processed' });
});

// Send WhatsApp notifications
async function sendWhatsAppNotifications(checkout) {
  try {
    const customer = checkout.customer || {};
    const lineItems = checkout.line_items || [];

    // Format cart items
    let cartSummary = '';
    let totalPrice = 0;
    lineItems.forEach((item) => {
      cartSummary += `${item.title} - ${item.quantity} x ${item.price} BDT\n`;
      totalPrice += parseFloat(item.price) * item.quantity;
    });

    // Message
