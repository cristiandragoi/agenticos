const BASE = process.env.RO_BACKEND || 'http://127.0.0.1:4001';

async function test() {
  console.log('Testing Revenue Measurements API against:', BASE);
  
  // 1. First get or create an opportunity
  const oppRes = await fetch(`${BASE}/api/revenue/opportunities`);
  if (!oppRes.ok) throw new Error(`GET /opportunities failed: ${oppRes.status} ${await oppRes.text()}`);
  const opps = await oppRes.json();
  
  let oppId;
  if (opps && opps.length > 0) {
    oppId = opps[0].id;
  } else {
    const createOpp = await fetch(`${BASE}/api/revenue/opportunities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Opportunity for Measurements',
        description: 'Auto-created test opportunity',
        opportunityType: 'digital_products',
        sourcePlatform: 'test'
      })
    });
    const oppData = await createOpp.json();
    oppId = oppData.id || oppData.opportunity?.id;
  }
  console.log('Using Opportunity ID:', oppId);

  // 2. POST /api/revenue/measurements
  const postRes = await fetch(`${BASE}/api/revenue/measurements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      opportunityId: oppId,
      expectedYield: 150.5,
      actualYield: 120.0,
      clicks: 45,
      conversions: 8,
      revenue: 160.0,
      status: 'active'
    })
  });
  console.log('POST /measurements status:', postRes.status);
  if (postRes.status !== 201) {
    throw new Error(`POST /measurements failed: ${postRes.status} ${await postRes.text()}`);
  }
  const createdMetric = await postRes.json();
  console.log('Created Metric ID:', createdMetric.id);

  // 3. GET /api/revenue/measurements
  const getAllRes = await fetch(`${BASE}/api/revenue/measurements`);
  console.log('GET /measurements status:', getAllRes.status);
  if (!getAllRes.ok) throw new Error(`GET /measurements failed: ${getAllRes.status}`);
  const allMetrics = await getAllRes.json();
  console.log(`Retrieved ${allMetrics.length} measurements total.`);
  const found = allMetrics.find(m => m.id === createdMetric.id);
  if (!found) throw new Error('Created metric not found in GET /measurements');

  // 4. GET /api/revenue/opportunities/:id/measurements
  const getByOppRes = await fetch(`${BASE}/api/revenue/opportunities/${oppId}/measurements`);
  console.log(`GET /opportunities/${oppId}/measurements status:`, getByOppRes.status);
  if (!getByOppRes.ok) throw new Error(`GET /opportunities/:id/measurements failed: ${getByOppRes.status}`);
  const oppMetrics = await getByOppRes.json();
  console.log(`Retrieved ${oppMetrics.length} measurements for opportunity ${oppId}`);
  const foundInOpp = oppMetrics.find(m => m.id === createdMetric.id);
  if (!foundInOpp) throw new Error('Created metric not found in GET /opportunities/:id/measurements');

  // 5. Test validation / 400 for missing opportunityId
  const badPost = await fetch(`${BASE}/api/revenue/measurements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedYield: 100 })
  });
  console.log('POST without opportunityId status:', badPost.status);
  if (badPost.status !== 400) throw new Error(`Expected 400, got ${badPost.status}`);

  console.log('\nALL 3 MEASUREMENT ENDPOINTS VERIFIED SUCCESSFULLY AGAINST LIVE DEV API!');
}

test().catch(err => {
  console.error('API Verification Error:', err);
  process.exit(1);
});
