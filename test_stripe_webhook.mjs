import crypto from 'crypto';

const webhookSecret = 'whsec_aCaKw6LUFSuHsa3GbELZPlmdMLTI0ZJZ';
const payload = {
  id: 'evt_test_webhook_123',
  type: 'checkout.session.completed',
  data: {
    object: {
      client_reference_id: 'lead-test-123'
    }
  }
};

const payloadString = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const signedPayload = `${timestamp}.${payloadString}`;
const signature = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
const stripeSignatureHeader = `t=${timestamp},v1=${signature}`;

async function run() {
  console.log('Sending simulated Stripe signed webhook...');
  try {
    const res = await fetch('http://localhost:4000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignatureHeader
      },
      body: payloadString
    });
    
    console.log('Response Status:', res.status);
    console.log('Response Text:', await res.text());
  } catch(e) {
    console.error('Error:', e);
  }
}

run();
