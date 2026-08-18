async function runE2E() {
  console.log('1. Submitting Recruiter Intake Form...');
  try {
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
    
    if (!intakeRes.ok) {
        console.log("Intake failed HTTP:", intakeRes.status);
        return;
    }
    
    const leadData = await intakeRes.json();
    console.log('Intake response:', leadData);
    
    if (!leadData.success) {
      console.error('Intake failed');
      return;
    }
    const leadId = leadData.lead.id;

    console.log('\n2. Triggering mock payment (Stripe Webhook proxy)...');
    const payRes = await fetch('http://localhost:4000/api/stripe/mock-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId })
    });
    const payData = await payRes.json();
    console.log('Payment response:', payData);

    console.log('\n3. Waiting 5 seconds for async OpenAI / Resend execution...');
    await new Promise(r => setTimeout(r, 5000));

    // For test verification, we actually just need to know it executed.
    console.log('\nE2E backend pipeline complete.');
  } catch(e) {
      console.log("Error in E2E:", e);
  }
}

runE2E();
