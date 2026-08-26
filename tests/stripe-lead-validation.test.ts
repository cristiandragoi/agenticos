import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateB2BEmail, verifyCompanyDomain, isRoleBasedEmail, validateB2BLead, validateEmailFormat } from '../src/utils/lead-validator';
import { createStripeCustomer, attachPaymentMethod, handleWebhookEvent } from '../src/services/stripe-service';

// Mock Stripe service internal functions if needed
vi.mock('../src/services/stripe-service', async () => {
  const actual = await vi.importActual('../src/services/stripe-service');
  return {
    ...actual,
    // We keep the real implementation for logic but mock network calls if they existed
  };
});

describe('B2B Lead Validation', () => {
  describe('Email Format Validation', () => {
    it('should accept valid business email formats', () => {
      expect(validateEmailFormat('john.doe@company.com')).toBe(true);
      expect(validateEmailFormat('jane_smith@enterprise.co.uk')).toBe(true);
      expect(validateEmailFormat('contact+sales@business.io')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(validateEmailFormat('invalid-email')).toBe(false);
      expect(validateEmailFormat('missing@domain')).toBe(false);
      expect(validateEmailFormat('spaces @domain.com')).toBe(false);
      expect(validateEmailFormat('')).toBe(false);
      expect(validateEmailFormat(null as any)).toBe(false);
    });
  });

  describe('Domain Verification', () => {
    it('should identify company domains vs personal domains', async () => {
      expect(await verifyCompanyDomain('user@gmail.com')).toBe(false);
      expect(await verifyCompanyDomain('user@yahoo.com')).toBe(false);
      expect(await verifyCompanyDomain('user@hotmail.com')).toBe(false);
      expect(await verifyCompanyDomain('user@outlook.com')).toBe(false);
    });

    it('should accept legitimate business domains', async () => {
      expect(await verifyCompanyDomain('user@microsoft.com')).toBe(true);
      expect(await verifyCompanyDomain('user@apple.com')).toBe(true);
      expect(await verifyCompanyDomain('user@startup.tech')).toBe(true);
    });
  });

  describe('Role-based Email Filtering', () => {
    it('should detect role-based emails', () => {
      expect(isRoleBasedEmail('admin@company.com')).toBe(true);
      expect(isRoleBasedEmail('info@business.com')).toBe(true);
      expect(isRoleBasedEmail('support@enterprise.com')).toBe(true);
      expect(isRoleBasedEmail('sales@corp.com')).toBe(true);
      expect(isRoleBasedEmail('contact@firm.com')).toBe(true);
    });

    it('should allow individual user emails', () => {
      expect(isRoleBasedEmail('john.doe@company.com')).toBe(false);
      expect(isRoleBasedEmail('jane.smith@business.com')).toBe(false);
      expect(isRoleBasedEmail('developer@startup.io')).toBe(false);
    });
  });

  describe('Comprehensive B2B Validation', () => {
    it('should return valid result for good B2B lead', () => {
      const result = validateB2BLead('john.doe@acme-corp.com', 'John Doe');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.domain).toBe('acme-corp.com');
    });

    it('should return invalid result for personal email', () => {
      const result = validateB2BLead('john@gmail.com', 'John Doe');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Personal email domains not allowed for B2B');
    });

    it('should warn about role-based emails', () => {
      const result = validateB2BLead('info@acme-corp.com', 'Info');
      expect(result.isValid).toBe(true); // Still valid domain
      expect(result.warnings).toContain('Role-based email detected - consider requesting individual contact');
      expect(result.isRoleBased).toBe(true);
    });
  });
});

describe('Stripe Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create customer with valid B2B data', async () => {
    const result = await createStripeCustomer({
      email: 'validated@company.com',
      name: 'Valid Business User',
      metadata: { source: 'test' }
    });

    expect(result.id).toBeDefined();
    expect(result.email).toBe('validated@company.com');
    expect(result.metadata?.b2b_verified).toBe('true');
    expect(result.metadata?.domain).toBe('company.com');
  });

  it('should reject customer creation with invalid email format', async () => {
    await expect(createStripeCustomer({
      email: 'invalid-email-format',
      name: 'Invalid User'
    })).rejects.toThrow('Invalid email format');
  });

  it('should reject customer creation with personal email domain', async () => {
    await expect(createStripeCustomer({
      email: 'user@gmail.com',
      name: 'Personal User'
    })).rejects.toThrow('Personal email domains not allowed for B2B');
  });

  it('should attach payment method to customer', async () => {
    const result = await attachPaymentMethod('cus_test123', 'pm_123');
    
    expect(result.id).toBe('pm_123');
    expect(result.type).toBe('card');
  });

  it('should reject attaching payment method with missing IDs', async () => {
    await expect(attachPaymentMethod('', 'pm_123')).rejects.toThrow('Customer ID and Payment Method ID are required');
    await expect(attachPaymentMethod('cus_123', '')).rejects.toThrow('Customer ID and Payment Method ID are required');
  });
});

describe('Webhook Handling', () => {
  it('should handle valid customer.created event', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = JSON.stringify({ type: 'customer.created', data: { object: { id: 'cus_123' } } });
    
    handleWebhookEvent(payload);
    
    expect(consoleSpy).toHaveBeenCalledWith('Customer created:', 'cus_123');
    consoleSpy.mockRestore();
  });

  it('should handle malformed webhook payloads', () => {
    const invalidPayload = '{ invalid json }';
    
    expect(() => handleWebhookEvent(invalidPayload)).toThrow('Failed to parse webhook payload');
  });

  it('should handle unknown event types gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = JSON.stringify({ type: 'unknown.event' });
    
    handleWebhookEvent(payload);
    
    expect(consoleSpy).toHaveBeenCalledWith('Unhandled event type:', 'unknown.event');
    consoleSpy.mockRestore();
  });
});

describe('Edge Cases and Error Handling', () => {
  it('should handle concurrent requests safely', async () => {
    const email = `concurrent_${Date.now()}@company.com`;
    const promises = Array(5).fill(null).map(() => 
      createStripeCustomer({ email, name: 'Concurrent Test' })
    );

    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(5);
    results.forEach(result => {
      expect(result.email).toBe(email);
      expect(result.isValid).not.toBeDefined(); // Customer object doesn't have isValid
      expect(result.id).toBeDefined();
    });
  });

  it('should handle empty name with warning', async () => {
    const resultValidation = validateB2BLead('user@company.com', '');
    expect(resultValidation.warnings).toContain('Name provided is too short or missing');
    expect(resultValidation.isValid).toBe(true); // Email is still valid
  });
});
