const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Credentials from environment variables
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC5ac21bf78cecdc79481c28bfab2a8b80';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'e0339451a1ffd589c31f18421808c404';
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'ibnmain.myshopify.com';

// WhatsApp numbers to receive alerts
const WHATSAPP_NUMBERS = [
    'whatsapp:+8801323935023',
    'whatsapp:+8801632303043'
  ];

// Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Format abandoned cart message
function formatAbandonedCartMessage(customer, cart) {
    const customerName = customer?.first_name || 'Valued Customer';
    const customerPhone = customer?.phone || 'N/A';
    const customerEmail = customer?.email || 'N/A';

  let productsList = '';
    if (cart.line_items && cart.line_items.length > 0) {
          productsList = cart.line_items
            .map(item => {
                      const price = (item.variant?.price * item.quantity).toFixed(2);
                      return `${item.title} - ${item.quantity} x ${item.variant?.price} BDT\n${price} BDT`;
            })
            .join('\n\n');
    }

  const subtotal = (cart.subtotal_price || 0).toFixed(2);
    const shipping = (cart.shipping_lines?.[0]?.price || 70).toFixed(2);
    const total = (parseFloat(subtotal) + parseFloat(shipping)).toFixed(2);

  const message = `Customer Name: ${customerName}\nPhone number: ${customerPhone}\nEmail: ${customerEmail}\n\nAssalamualaikum from IBN MA'IN. Hope you're doing wonderful.\n\nLooks like you have an abandoned cart.\n\n*Order Receipt*\n${productsList}\n\nHome Delivery: ${shipping} BDT\n\nTotal : ${total} BDT\n\nThank you so much for your patience, Shall we confirm the order, Sir?`;

  return message;
}

// Send WhatsApp notification
async function sendWhatsAppNotification(message) {
    try {
          for (const phoneNumber of WHATSAPP_NUMBERS) {
                  await twilioClient.messages.create({
                            body: message,
                            from: 'whatsapp:+14155238886',
                            to: phoneNumber
                  });
                  console.log(`Message sent to ${phoneNumber}`);
          }
    } catch (error) {
          console.error('Error sending WhatsApp message:', error);
    }
}

// Webhook endpoint for checkout/cart abandonment
app.post('/webhook/checkout', async (req, res) => {
    try {
          const checkout = req.body;

      // Check if cart is abandoned (not completed)
      if (checkout.completed_at === null && checkout.abandoned_checkout_url) {
              console.log('Abandoned cart detected:', checkout.id);

            // Send notification after 10 minutes
            setTimeout(async () => {
                      const message = formatAbandonedCartMessage(checkout.customer, checkout);
                      await sendWhatsAppNotification(message);
            }, 10 * 60 * 1000);
      }

      res.status(200).send('OK');
    } catch (error) {
          console.error('Error processing webhook:', error);
          res.status(500).send('Error');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Webhook running');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});
