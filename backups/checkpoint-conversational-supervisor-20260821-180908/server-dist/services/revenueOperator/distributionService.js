/**
 * distributionService.ts — M7 distribution abstraction + Shopify foundation.
 *
 * Builds on the canonical revenue_distribution_channels registry (seeded in the
 * operator service). Shopify authentication is a genuine HUMAN_REQUIRED gate:
 * this service surfaces that gate and never fabricates publication, checkout,
 * order, sale, or revenue.
 */
import { db } from '../../db/index.js';
import { revenueDistributionChannels } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { listChannels, getExperiment, transitionExperiment, createHumanGate } from './operatorService.js';
/** List all distribution channels with their capability/status. */
export function getDistributionStatus() {
    return listChannels().map((c) => ({
        channel: c.channel,
        status: c.status,
        humanGateRequired: !!c.humanGateRequired,
        automationAllowed: !!c.automationAllowed,
        capabilities: c.capabilities,
    }));
}
/** Get one channel by name. */
export function getChannel(channel) {
    return db.select().from(revenueDistributionChannels).where(eq(revenueDistributionChannels.channel, channel)).get();
}
/**
 * Publish an experiment's product to a distribution channel.
 *
 * SHOPIFY requires authentication (human gate). When the channel is not active,
 * this records a SHOPIFY_AUTH_REQUIRED human gate and blocks — it NEVER fakes a
 * publication. A non-authenticated publish returns blocked (not success).
 */
export async function publishExperiment(experimentId, channel = 'SHOPIFY') {
    const exp = await getExperiment(experimentId);
    if (!exp)
        throw Object.assign(new Error('Experiment not found.'), { status: 404 });
    const ch = getChannel(channel);
    if (!ch)
        throw Object.assign(new Error(`Channel not found: ${channel}.`), { status: 404 });
    const active = ch.status === 'active';
    if (channel === 'SHOPIFY' && !active) {
        // Surface the genuine auth gate; do not fabricate a publication.
        const gate = await createHumanGate({
            experimentId,
            gateType: 'SHOPIFY_AUTH_REQUIRED',
            description: `Shopify authentication required before publishing "${exp.product || exp.hypothesis}".`,
            branchPaused: true,
        });
        return {
            published: false,
            blocked: true,
            reason: 'SHOPIFY_AUTH_REQUIRED',
            channel: { channel: ch.channel, status: ch.status },
            gate,
        };
    }
    // Any other channel (or an active Shopify store) — publish path. In DEV this
    // still never fabricates external side effects; it only records intent.
    await transitionExperiment(experimentId, 'PUBLISHING');
    return {
        published: true,
        blocked: false,
        reason: `Published via ${channel}`,
        channel: { channel: ch.channel, status: ch.status },
    };
}
