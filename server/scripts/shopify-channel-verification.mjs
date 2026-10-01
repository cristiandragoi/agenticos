/**
 * shopify-channel-verification.mjs — real runtime channel verification for the
 * Shopify revenue channel, executed against a COPY of the live canonical DB.
 *
 * Runs the production dist code paths (no reimplementation):
 *   distributionService.getDistributionStatus() / getChannel() / publishExperiment()
 *   operatorService.seedChannels() / listChannels()
 *
 * Usage:
 *   AGENTICOS_DATA_DIR="D:/AgenticOS/.tmp/shopify-verify" node scripts/shopify-channel-verification.mjs
 */
const out = { startedAt: new Date().toISOString(), dataDir: process.env.AGENTICOS_DATA_DIR };

const svc = await import('../dist/services/revenueOperator/distributionService.js');
const op = await import('../dist/services/revenueOperator/operatorService.js');
const { db } = await import('../dist/db/index.js');
const schema = await import('../dist/db/schema.js');

const { eq } = await import('drizzle-orm');

// STEP 1 — what does the live channel registry actually contain?
out.step1_registry_before_seed = svc.getDistributionStatus();
out.step1_channel_row_count = out.step1_registry_before_seed.length;

// STEP 2 — SHOPIFY channel lookup by name (the verification target).
const before = svc.getChannel('SHOPIFY');
out.step2_shopify_channel_before_seed = before
  ? { channel: before.channel, status: before.status, humanGateRequired: !!before.humanGateRequired, capabilities: before.capabilities }
  : null;

// STEP 3 — run the canonical seeding path so the declared contract is visible.
const seeded = op.seedChannels();
out.step3_seeded_channel_count = seeded.length;
const shop = svc.getChannel('SHOPIFY');
out.step3_shopify_channel_after_seed = shop
  ? { channel: shop.channel, status: shop.status, humanGateRequired: !!shop.humanGateRequired, automationAllowed: !!shop.automationAllowed, capabilities: shop.capabilities }
  : null;

// STEP 4 — attempt a real publish through the M7 path with a real experiment.
const experiments = db.select().from(schema.revenueExperiments).all();
out.step4_experiment_pool = experiments.length;
const target = experiments.find((e) => e.status && e.status !== 'PUBLISHED') || experiments[0];
out.step4_target_experiment = target ? { id: target.id, status: target.status, product: String(target.product || '').slice(0, 120) } : null;

let publishResult = null;
if (target) {
  try {
    publishResult = await svc.publishExperiment(target.id, 'SHOPIFY');
  } catch (err) {
    publishResult = { threw: true, message: err?.message, status: err?.status };
  }
}
out.step4_publish_result = publishResult;

// STEP 5 — did the honest gate land in the registry, and did anything claim publication?
const gateRows = db.select().from(schema.revenueHumanGates).where(eq(schema.revenueHumanGates.experimentId, target?.id ?? '')).all();
out.step5_gates_for_experiment = gateRows.map((g) => ({ id: g.id, gateType: g.gateType, status: g.status, branchPaused: !!g.branchPaused, createdAt: g.createdAt }));

const ledger = db.select().from(schema.revenueLedgerEntries).all();
out.step5_ledger_entries = ledger.length;
const ledgerRevenue = ledger.filter((l) => String(l.entryType).includes('REVENUE')).reduce((a, l) => a + Number(l.amount || 0), 0);
out.step5_ledger_revenue_total = ledgerRevenue;

// STEP 6 — product inventory: what catalog does the runtime actually own?
const products = experiments.map((e) => ({
  id: e.id,
  status: e.status,
  product: String(e.product || '').slice(0, 100),
  channel: e.channel ?? null,
  sales: e.sales ?? 0,
  verifiedRevenue: e.verifiedRevenue ?? 0,
  updatedAt: e.updatedAt,
}));
out.step6_product_inventory_count = products.length;
out.step6_product_inventory = products;

// STEP 7 — channel-side inventory capability state (Shopify inventory sync precondition).
out.step7_capability_inventory_declared = !!(shop?.capabilities && shop.capabilities.inventory);
out.step7_auth_state = shop ? shop.status : 'NO_CHANNEL_ROW';
out.step7_auth_established = shop ? shop.status === 'active' : false;

out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
process.exit(0);
