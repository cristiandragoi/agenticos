const fetch = require('node-fetch');

async function runE2E() {
  console.log('1. Submitting Recruiter Intake Form...');
  const intakeRes = await fetch('http://localhost:4000/api/sales/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Test User',
      customerEmail: 'test@example.com',
      company: 'Test Agency',
      requestType: 'cv_evaluation',
      budget: '0',
      goal: 'Test E2E',
      cvText: 'Senior React Developer with 10 years of experience',
      jobDescription: 'Looking for a Senior Frontend Engineer with React and Node.js'
    })
  });
  const leadData = await intakeRes.json();
  console.log('Intake response:', leadData);
  
  if (!leadData.success) {
    console.error('Intake failed');
    return;
  }
  const leadId = leadData.lead.id;

  console.log('\n2. Simulating Stripe Webhook (Payment Complete)...');
  const stripePayload = {
    id: `evt_test_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: leadId
      }
    }
  };

  // Mocking the Stripe signature is tricky because we use express.raw(). 
  // Let's just use the mock-pay endpoint which bypasses the signature but triggers the same artifact logic.
  console.log('\n2. Triggering mock payment...');
  const payRes = await fetch('http://localhost:4000/api/stripe/mock-pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId })
  });
  const payData = await payRes.json();
  console.log('Payment response:', payData);

  console.log('\n3. Waiting 3 seconds for async artifact generation...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n4. Fetching the generated Artifact (Deliverable)...');
  const artifactRes = await fetch('http://localhost:4000/api/artifacts');
  const artifacts = await artifactRes.json();
  const target = artifacts.find(a => a.id === payData.artifactId);
  
  if (target) {
    console.log('Deliverable generated successfully!');
    console.log(`Title: ${target.title}`);
    console.log(`Markdown Length: ${target.content.length} characters`);
    console.log(`Email Status: ${target.emailStatus}`);
  } else {
    console.error('Artifact not found!');
  }
}

runE2E();
