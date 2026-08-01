import { logger } from '../utils/logger.js';
import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { db } from '../services/db.js';
import { Resend } from 'resend';
import OpenAI from 'openai';
import crypto from 'crypto';
import { randomUUID as uuidv4 } from 'crypto';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2024-04-10' as any, // Bypass TS error for latest version
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key');

// Mock asynchronous fulfillment worker
async function enqueueFulfillment(leadId: string) {
  logger.info(`[Worker] Started async fulfillment for lead: ${leadId}`);
  
  const leads = await db.leads.list();
  const lead = leads.find(l => l.id === leadId);
  if (!lead) {
    logger.error(`[Worker] Failed: Lead ${leadId} not found.`);
    return;
  }

  const cvText = lead.cvText || 'No CV provided.';
  const jobDescription = lead.jobDescription || 'No Job Description provided.';

  let finalBriefContent = '';
  let rawJsonContent = '';

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an elite Senior Executive Recruiter with 15+ years of experience placing C-level and senior technical talent. Your job is to rigorously evaluate a candidate's CV against a Job Description.
Tone: Highly professional, objective, analytical, and direct. Avoid fluff.
Instructions:
1. Extract exact years of experience and compare to requirements.
2. Categorize key technical and cultural skills.
3. Identify glaring red flags, missing qualifications, or flight risks.
4. Draft a premium, client-ready executive summary that a hiring manager would expect from a retained search firm.
5. Provide actionable next steps (e.g. specific behavioral interview questions to probe identified weaknesses).`
        },
        {
          role: 'user',
          content: `Job Description:\n${jobDescription}\n\nCandidate CV:\n${cvText}`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'candidate_evaluation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              matchScore: { type: 'number', description: 'Score from 0 to 100 based on rigorous fit criteria.' },
              recruiterSummary: { type: 'string', description: 'Internal: 2-sentence blunt assessment of the candidate.' },
              strengths: { type: 'array', items: { type: 'string' }, description: 'Top 3-5 verified strengths.' },
              risksGaps: { type: 'array', items: { type: 'string' }, description: '2-4 red flags or unverified skills.' },
              nextBestActions: { type: 'array', items: { type: 'string' }, description: '1-3 recommended hard interview questions to probe risks.' },
              clientReadyExecutiveSummary: { type: 'string', description: 'Premium 1-2 paragraph pitch/assessment for the hiring manager.' }
            },
            required: ['matchScore', 'recruiterSummary', 'strengths', 'risksGaps', 'nextBestActions', 'clientReadyExecutiveSummary'],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0].message.content;

    if (content) {
      const parsed = JSON.parse(content);
      rawJsonContent = content; // Store the raw structured JSON

      finalBriefContent = `# Candidate Intelligence Brief

Prepared for: ${lead.customerEmail || 'Recruiter AI'}
Target Role: Evaluated Candidate

## Candidate Match: ${parsed.matchScore}/100

### Recruiter Summary
${parsed.recruiterSummary}

### Key Strengths
${parsed.strengths.map((s: string) => `- ${s}`).join('\n')}

### Risks & Gaps
${parsed.risksGaps.map((r: string) => `- ${r}`).join('\n')}

### Recommended Next Actions
${parsed.nextBestActions.map((a: string) => `- ${a}`).join('\n')}

---

## Client-Ready Executive Summary
${parsed.clientReadyExecutiveSummary}
`;
    } else {
      throw new Error('No parsed output returned from OpenAI.');
    }
  } catch (err: any) {
    logger.error(`[Worker] OpenAI Generation Failed: ${err.message}`);
    finalBriefContent = `# Generation Failed\n\nThere was an error generating this brief using the LLM: ${err.message}`;
    rawJsonContent = JSON.stringify({ error: err.message });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const accessTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

  const newArtifact: any = {
    id: `artifact-${leadId}`,
    title: `Full Brief: Lead ${leadId}`,
    type: 'report',
    content: finalBriefContent,
    rawJson: rawJsonContent,
    preview: 'Executive Summary for Candidate',
    version: '1',
    status: 'done' as const,
    emailStatus: 'pending',
    accessTokenHash,
    accessTokenExpiresAt: expiresAt.toISOString(),
    tokenUsed: false,
    createdAt: new Date().toISOString()
  };
  
  await db.artifacts.upsert(newArtifact);
  logger.info(`[Worker] Finished generating full brief: ${newArtifact.id}`);

  // Check if we already successfully sent this email (if worker was retried)
  const artifacts = await db.artifacts.list();
  const existingArtifactCheck = artifacts.find(a => a.id === `artifact-${leadId}`);
  if (existingArtifactCheck && existingArtifactCheck.emailStatus === 'sent') {
    logger.info(`[Worker] Email already marked as sent for lead ${leadId}. Skipping email dispatch.`);
    return;
  }

  // Send the brief via email
  const recipientEmail = lead.customerEmail || 'test@example.com';
  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
  let emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  
  if (process.env.NODE_ENV === 'production' && emailFrom === 'onboarding@resend.dev') {
    logger.error(`[Worker] ERROR: Cannot use onboarding@resend.dev in production. Delivery will fail.`);
    // We let it attempt anyway, but it will fail.
  }

  const deliverableLink = `${appBaseUrl}/public/deliverable/${newArtifact.id}?token=${rawToken}`;
  
  try {
    const emailResult = await resend.emails.send({
      from: emailFrom,
      to: recipientEmail,
      subject: `Your Candidate Intelligence Brief is Ready: Lead ${leadId}`,
      headers: {
        'Idempotency-Key': `email-fulfill-${leadId}`
      },
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Your Candidate Evaluation is Complete!</h2>
          <p>Hi there,</p>
          <p>Thank you for using RecruitAI. Our system has successfully evaluated the candidate against your job description.</p>
          <div style="margin: 30px 0;">
            <a href="${deliverableLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              View Your Full Deliverable
            </a>
          </div>
          <p>Or copy this link to your browser: <br/> <a href="${deliverableLink}">${deliverableLink}</a></p>
          <p>Best regards,<br/>The RecruitAI Team</p>
        </div>
      `
    });
    
    logger.info(`[Worker] Email sent to ${recipientEmail} with id: ${emailResult.data?.id}`);
    
    // Update artifact with success status
    newArtifact.emailStatus = 'sent';
    newArtifact.emailTimestamp = new Date().toISOString();
    await db.artifacts.upsert(newArtifact);

  } catch (emailErr: any) {
    logger.error(`[Worker] Failed to send email to ${recipientEmail}: ${emailErr.message}`);
    // Update artifact with failed status
    newArtifact.emailStatus = 'failed';
    newArtifact.emailTimestamp = new Date().toISOString();
    await db.artifacts.upsert(newArtifact);
  }
}

// Use raw body for this specific route to verify signatures
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (!endpointSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('STRIPE_WEBHOOK_SECRET is completely required in production. Aborting.');
      }
      logger.warn('⚠️ STRIPE_WEBHOOK_SECRET is not configured. Bypassing signature verification (local dev).');
      event = JSON.parse(req.body.toString());
    } else {
      event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);
    }
  } catch (err: any) {
    logger.error(`⚠️ Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency check using durable storage
  const stripeEvents = await db.stripeEvents.list();
  const existingEvent = stripeEvents.find(e => e.id === event.id);
  if (existingEvent) {
    logger.info(`[Stripe Webhook] Idempotency catch: Stripe event ${event.id} already processed. Skipping.`);
    return res.send(); // Fast acknowledgment for duplicates
  }
  
  // Persist event.id BEFORE side effects to protect against duplicate deliveries/restarts
  await db.stripeEvents.upsert({ id: event.id, createdAt: new Date().toISOString() });

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      const leadId = session.client_reference_id;
      
      logger.info(`[Stripe Webhook] Received payment for lead: ${leadId} via event: ${event.id}`);
      
      if (leadId) {
        // Fast acknowledgment, queue fulfillment
        logger.info(`[Stripe Webhook] Marking lead ${leadId} as paid and queuing fulfillment.`);
        setTimeout(() => enqueueFulfillment(leadId), 0);
      }
      break;
      
    default:
      logger.info(`[Stripe Webhook] Unhandled event type ${event.type}`);
  }

  // Return a 200 response IMMEDIATELY to acknowledge receipt of the event
  res.send();
});

// Mock endpoint for local development without real Stripe
router.post('/mock-pay', express.json(), async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) return res.status(400).json({ success: false, error: 'Missing leadId' });

  logger.info(`[Mock Stripe] Processing mock payment for lead: ${leadId}`);
  
  // Idempotency check
  const artifacts = await db.artifacts.list();
  const existingArtifact = artifacts.find(a => a.id === `artifact-${leadId}`);
  if (existingArtifact) {
    return res.json({ success: true, artifactId: existingArtifact.id });
  }

  // Enqueue fulfillment asynchronously
  setTimeout(() => enqueueFulfillment(leadId), 0);
  
  return res.json({ success: true, artifactId: `artifact-${leadId}` });
});

export default router;
