import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../src/index.js';

describe('Revenue Engine API', () => {
  let createdId = '';

  test('POST /api/revenue/opportunities - should create an opportunity', async () => {
    const res = await request(app)
      .post('/api/revenue/opportunities')
      .send({
        title: 'Test Opportunity',
        description: 'Test Desc',
        opportunityType: 'digital_product',
        sourcePlatform: 'github',
      });
    
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.stage, 'discovered');
    createdId = res.body.id;
  });

  test('GET /api/revenue/opportunities/:id - should retrieve opportunity', async () => {
    const res = await request(app).get(`/api/revenue/opportunities/${createdId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, createdId);
  });

  test('PATCH /api/revenue/opportunities/:id - should update allowed fields', async () => {
    const res = await request(app)
      .patch(`/api/revenue/opportunities/${createdId}`)
      .send({ overallScore: 99 });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.overallScore, 99);
  });

  test('POST /api/revenue/opportunities/:id/approve - should block approval if not in awaiting_approval stage', async () => {
    const res = await request(app).post(`/api/revenue/opportunities/${createdId}/approve`);
    assert.strictEqual(res.status, 409);
  });

  test('POST /api/revenue/opportunities/:id/transition - should transition stage', async () => {
    const res = await request(app)
      .post(`/api/revenue/opportunities/${createdId}/transition`)
      .send({ stage: 'awaiting_approval' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stage, 'awaiting_approval');
  });

  test('POST /api/revenue/opportunities/:id/reject - should require a reason', async () => {
    const res = await request(app).post(`/api/revenue/opportunities/${createdId}/reject`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Rejection reason is required');
  });

  test('POST /api/revenue/opportunities/:id/reject - should reject with reason', async () => {
    const res = await request(app)
      .post(`/api/revenue/opportunities/${createdId}/reject`)
      .send({ reason: 'Not profitable' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stage, 'rejected');
    assert.strictEqual(res.body.rejectionReason, 'Not profitable');
  });
  test('POST /api/revenue/opportunities/check-duplicate - should identify duplicate by URL', async () => {
    // Create an opp with specific URL
    const createRes = await request(app).post('/api/revenue/opportunities').send({
      title: 'Dup Test', opportunityType: 'ecommerce', sourceUrl: 'https://test.com/dup'
    });
    
    // Check duplicate
    const checkRes = await request(app).post('/api/revenue/opportunities/check-duplicate').send({
      sourceUrl: 'https://test.com/dup'
    });
    assert.strictEqual(checkRes.status, 200);
    assert.strictEqual(checkRes.body.duplicate, true);
    assert.strictEqual(checkRes.body.opportunity.id, createRes.body.id);
  });

  test('POST /api/revenue/opportunities/:id/evidence - should append evidence', async () => {
    const res = await request(app)
      .post(`/api/revenue/opportunities/${createdId}/evidence`)
      .send({ evidence: { title: 'New Evidence', type: 'analytics', reliability: 'verified' } });
    
    assert.strictEqual(res.status, 200);
    const evidenceList = JSON.parse(res.body.evidencePayload);
    assert.strictEqual(evidenceList.length, 1);
    assert.strictEqual(evidenceList[0].title, 'New Evidence');
  });

  test('POST /api/revenue/opportunities/:id/score - should transition to scored', async () => {
    // Stage is currently rejected from previous test. Let's transition it back to researching so we can score it
    await request(app).post(`/api/revenue/opportunities/${createdId}/transition`).send({ stage: 'researching' });

    const res = await request(app).post(`/api/revenue/opportunities/${createdId}/score`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stage, 'scored');
    assert.ok(res.body.overallScore !== null);
  });

  test('POST /api/revenue/opportunities/:id/request-approval - should move to awaiting_approval', async () => {
    const res = await request(app).post(`/api/revenue/opportunities/${createdId}/request-approval`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stage, 'awaiting_approval');
    assert.strictEqual(res.body.approvalStatus, 'pending');
  });
});
