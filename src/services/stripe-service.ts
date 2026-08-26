// Stripe Service for B2B Customer Management

import { validateB2BLead } from '../utils/lead-validator';

export interface StripeCustomerData {
  email: string;
  name: string;
  metadata?: Record<string, string>;
}

export interface StripeCustomer {
  id: string;
  email: string;
  metadata?: Record<string, string>;
}

export interface StripePaymentMethod {
  id: string;
  type: string;
}

/**
 * Creates a Stripe customer after B2B validation
 */
export async function createStripeCustomer(data: StripeCustomerData): Promise<StripeCustomer> {
  // Validate B2B lead first
  const validation = validateB2BLead(data.email, data.name);
  
  if (!validation.isValid) {
    throw new Error(validation.errors.join(', '));
  }
  
  // Check for duplicates (simulated - in real implementation would query Stripe)
  const existingCustomer = await findExistingCustomer(data.email);
  if (existingCustomer) {
    return existingCustomer;
  }
  
  // Create customer with metadata
  const customer: StripeCustomer = {
    id: `cus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    email: data.email,
    metadata: {
      b2b_verified: 'true',
      domain: validation.domain || 'unknown',
      is_role_based: validation.isRoleBased.toString(),
      ...data.metadata,
    },
  };
  
  // Log warnings if any
  if (validation.warnings.length > 0) {
    console.warn('B2B Validation Warnings:', validation.warnings);
  }
  
  return customer;
}

/**
 * Attaches a payment method to a customer
 */
export async function attachPaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<StripePaymentMethod> {
  if (!customerId || !paymentMethodId) {
    throw new Error('Customer ID and Payment Method ID are required');
  }
  
  // Simulate attachment
  const paymentMethod: StripePaymentMethod = {
    id: paymentMethodId,
    type: 'card',
  };
  
  return paymentMethod;
}

/**
 * Finds an existing customer by email (simulated)
 */
async function findExistingCustomer(email: string): Promise<StripeCustomer | null> {
  // In real implementation, this would query Stripe API
  // For now, return null to allow creation
  return null;
}

/**
 * Handles Stripe webhook events
 */
export function handleWebhookEvent(payload: any): void {
  try {
    const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
    
    switch (event.type) {
      case 'customer.created':
        console.log('Customer created:', event.data.object.id);
        break;
      case 'payment_method.attached':
        console.log('Payment method attached:', event.data.object.id);
        break;
      case 'invoice.paid':
        console.log('Invoice paid:', event.data.object.id);
        break;
      default:
        console.log('Unhandled event type:', event.type);
    }
  } catch (error) {
    throw new Error(`Failed to parse webhook payload: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
