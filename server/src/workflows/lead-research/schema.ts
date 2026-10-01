import { pgTable, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Lead Research Database Schema
 * Stores qualified German company leads for cold calling
 */

export const leadResearchTable = pgTable('lead_research', {
  // Company Identification
  id: text().primaryKey().default(''),
  company_name: text().notNull(),
  website: text().notNull(),
  city: text(),
  industry: text(),
  employee_estimate: text(),
  
  // Buying Signal
  buying_signal: text().notNull(),
  signal_date: timestamp(),
  signal_source: text(),
  signal_url: text(),
  
  // Technical Analysis
  detected_problem: text(),
  recommended_service: text(),
  technical_solution: text(),
  
  // Decision Maker
  decision_maker_name: text(),
  decision_maker_title: text(),
  linkedin_url: text(),
  
  // Contact Information
  direct_phone: text(),
  company_phone: text(),
  business_email: text(),
  
  // Scoring & Status
  lead_score: integer().default(0),
  verification_status: text().default('UNVERIFIED'), // VERIFIED, PARTIALLY_VERIFIED, UNVERIFIED
  
  // Call Preparation
  call_reason: text(),
  call_opening: text(),
  
  // Metadata
  research_sources: text().array(),
  date_last_verified: timestamp(),
  status: text().default('DISCOVERED'), // DISCOVERED → RESEARCHING → SIGNAL_CONFIRMED → CONTACT_RESEARCH → QUALIFICATION → VERIFICATION → CALL_READY → CALLED → FOLLOW_UP → WON / LOST / ARCHIVED
  
  created_at: timestamp().defaultNow(),
  updated_at: timestamp().defaultNow(),
});

export type LeadRecord = typeof leadResearchTable.$inferSelect;
export type NewLeadRecord = typeof leadResearchTable.$inferInsert;
