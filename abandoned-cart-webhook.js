const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Credentials from environment variables ONLY
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

// Validate required environment variables
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !SHOPIFY_STORE) {
    throw new Error('Missing required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SHOPIFY_STORE');
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
    const body = req.rawBody || JSON.stringify(req.body);
    const hmacHeader = req.get('X-Shopify-Hmac-SHA256');

           // Verify Shopify webhook signature
           const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET || '')
      .update(body, 'utf8')
      .digest('base64');

           if (hash !== hmacHeader) {
                 console.warn('Invalid webhook signature');
                 return res.status(401).json({ error: 'Unauthorized' });
           }

           const checkout = req.body;
    const checkoutId = checkout.id;

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

      // Message content
      const message = `Customer Name: ${customer.first_name || 'N/A'} ${customer.last_name || ''}
      Phone number: ${checkout.phone || 'N/A'}
      Email: ${checkout.email || 'N/A'}

      Assalamualaikum from IBN MA'IN. Hope you're doing wonderful.

      Looks like you have an abandoned cart.

      *Order Receipt*
      ${cartSummary}
      Home Delivery: ${checkout.shipping_line?.price || '0'} BDT

      Total: ${totalPrice + parseFloat(checkout.shipping_line?.price || 0)} BDT

      Thank you so much for your patience, Shall we confirm the order, Sir?`;

      // Send to all WhatsApp numbers
      for (const number of WHATSAPP_NUMBERS) {
              try {
                        await twilioClient.messages.create({
                                    from: 'whatsapp:+14155238886', // Twilio sandbox number
                                    to: number,
                                    body: message
                        });
                        console.log(`✓ WhatsApp sent to ${number}`);
              } catch (error) {
                        console.error(`✗ Failed to send to ${number}:`, error.message);
              }
      }
    } catch (error) {
          console.error('Error sending WhatsApp notifications:', error);
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✓ Abandoned cart webhook listening on port ${PORT}`);
    console.log(`✓ Shopify store: ${SHOPIFY_STORE}`);
    console.log(`✓ Webhook URL: /webhook/checkout`);
});
