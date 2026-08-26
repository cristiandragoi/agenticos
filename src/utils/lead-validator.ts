// B2B Lead Validation Utilities

const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'protonmail.com',
  'yandex.com',
  'live.com',
  'msn.com',
]);

const ROLE_BASED_PREFIXES = new Set([
  'admin',
  'info',
  'support',
  'sales',
  'contact',
  'help',
  'billing',
  'hr',
  'jobs',
  'careers',
  'marketing',
  'press',
  'legal',
  'privacy',
  'abuse',
  'noreply',
  'no-reply',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates email format
 */
export function validateEmailFormat(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Checks if email domain is a personal/free provider
 */
export function isPersonalDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? PERSONAL_DOMAINS.has(domain) : true;
}

/**
 * Verifies if the domain is a company domain (not personal)
 */
export async function verifyCompanyDomain(email: string): Promise<boolean> {
  if (!validateEmailFormat(email)) {
    return false;
  }
  return !isPersonalDomain(email);
}

/**
 * Checks if email uses a role-based prefix
 */
export function isRoleBasedEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) {
    return false;
  }
  
  // Check exact match
  if (ROLE_BASED_PREFIXES.has(prefix)) {
    return true;
  }
  
  // Check for common patterns like info-, support-, etc.
  for (const role of ROLE_BASED_PREFIXES) {
    if (prefix.startsWith(role + '-') || prefix.startsWith(role + '.')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Main B2B email validation function
 */
export function validateB2BEmail(email: string): boolean {
  // Check format
  if (!validateEmailFormat(email)) {
    return false;
  }
  
  // Check not personal domain
  if (isPersonalDomain(email)) {
    return false;
  }
  
  return true;
}

/**
 * Full B2B lead validation result
 */
export interface B2BValidationResult {
  isValid: boolean;
  email: string;
  errors: string[];
  warnings: string[];
  isRoleBased: boolean;
  domain: string | null;
}

/**
 * Comprehensive B2B lead validation
 */
export function validateB2BLead(email: string, name?: string): B2BValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Format validation
  if (!validateEmailFormat(email)) {
    errors.push('Invalid email format');
    return {
      isValid: false,
      email,
      errors,
      warnings,
      isRoleBased: false,
      domain: null,
    };
  }
  
  const domain = email.split('@')[1]?.toLowerCase() || null;
  const isRoleBased = isRoleBasedEmail(email);
  
  // Domain validation
  if (isPersonalDomain(email)) {
    errors.push('Personal email domains not allowed for B2B');
  }
  
  // Role-based warning
  if (isRoleBased) {
    warnings.push('Role-based email detected - consider requesting individual contact');
  }
  
  // Name validation
  if (!name || name.trim().length < 2) {
    warnings.push('Name provided is too short or missing');
  }
  
  return {
    isValid: errors.length === 0,
    email,
    errors,
    warnings,
    isRoleBased,
    domain,
  };
}
