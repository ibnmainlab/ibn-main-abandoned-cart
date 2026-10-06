const express = require('express');
const twilio = require('twilio');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

app.use(express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  req.rawBody = req.body;
  next();
});

app.use(express.json());

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !SHOPIFY_STORE || !SHOPIFY_WEBHOOK_SECRET) {
  throw new Error('Missing environment variables');
}

const WHATSAPP_NUMBERS = [
  'whatsapp:+8801323935023',
  'whatsapp:+8801632303043'
];

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const activeTimeouts = {};

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.post('/webhook/checkout', (req, res) => {
  const body = req.rawBody;
  const hmacHeader = req.get('X-Shopify-Hmac-SHA256');

  const hash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (hash !== hmacHeader) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✓ Webhook signature valid');

  const checkout = JSON.parse(req.rawBody.toString());
  const checkoutId = checkout.token;

  console.log(`DEBUG: completed_at = ${checkout.completed_at}`);
  console.log(`DEBUG: abandoned_checkout_url = ${checkout.abandoned_checkout_url}`);
  console.log(`DEBUG: checkoutId = ${checkoutId}`);

  if (checkout.completed_at === null && checkout.abandoned_checkout_url) {
    console.log(`Abandoned cart detected: ${checkoutId}`);

    if (activeTimeouts[checkoutId]) {
      console.log(`Already scheduled for ${checkoutId}`);
      return res.status(200).json({ message: 'Already scheduled' });
    }

    activeTimeouts[checkoutId] = setTimeout(() => {
      sendWhatsAppNotifications(checkout);
      delete activeTimeouts[checkoutId];
    }, 10 * 60 * 1000);

    console.log(`Scheduled notification in 10 minutes for ${checkoutId}`);
  }

  res.status(200).json({ message: 'Webhook processed' });
});

async function sendWhatsAppNotifications(checkout) {
  try {
    const customer = checkout.customer || {};
    const lineItems = checkout.line_items || [];

    let cartSummary = '';
    let totalPrice = 0;
    lineItems.forEach((item) => {
      cartSummary += `${item.title} - ${item.quantity} x ${item.price} BDT\n`;
      totalPrice += parseFloat(item.price) * item.quantity;
    });

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

    for (const number of WHATSAPP_NUMBERS) {
      try {
        await twilioClient.messages.create({
          from: 'whatsapp:+14155238886',
          to: number,
          body: message
        });
        console.log(`✓ WhatsApp sent to ${number}`);
      } catch (error) {
        console.error(`✗ Failed to send to ${number}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('Error sending notifications:', error);
  }
}

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✓ Listening on port ${PORT}`);
  console.log(`✓ Shopify store: ${SHOPIFY_STORE}`);
});
