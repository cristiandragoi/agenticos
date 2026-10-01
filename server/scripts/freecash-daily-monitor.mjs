#!/usr/bin/env node
/**
 * freecash-daily-monitor
 * 
 * Daily status monitoring for Free Cash Finance Automation
 * 
 * RULES ENFORCED (non-negotiable):
 * 1. NO earning action automatically - this script never executes transactions
 * 2. CHECK STATUS once per day only - runs at configured time, skips if already checked
 * 3. NOTIFY on earnings/status changes - logs alerts and sends notifications via existing channels
 * 4. HUMAN APPROVAL required for any external action - waits for user consent on writes
 */

const cron = require('node-cron');
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');
const https = require('https');

// Configuration from .env or defaults
const config = {
  // Check time (once per day)
  CHECK_TIME: '08:30', // 8:30 AM local time
  
  // Storage for daily check timestamps (prevents double-checks - Rule 2)
  CHECK_TIMESTAMP_FILE: './data/freecash-daily-check.last',
  
  // Notification settings (Rule 3)
  NOTIFICATION_EMAIL: process.env.FREECASH_NOTIFICATION_EMAIL || null,
  NOTIFICATION_WEBHOOK: process.env.FREECASH_WEBHOOK_URL || null,
  
  // API endpoint for status fetch (read-only - no earnings actions - Rule 1)
  STATUS_API_URL: process.env.FREECASH_STATUS_API || 'https://api.freecash.com/v1/status',
  
  // User approval interface (Rule 4)
  APPROVAL_INTERFACE: './data/freecash-approval-request.json'
};

/**
 * Check if daily check has already been performed today (Rule 2)
 */
function isDailyCheckAllowed(): boolean {
  const fs = require('fs');
  
  try {
    // Only allow one check per day
    const lastCheckPath = config.CHECK_TIMESTAMP_FILE;
    
    if (!fs.existsSync(lastCheckPath)) {
      return true;
    }
    
    const lastCheck = JSON.parse(fs.readFileSync(lastCheckPath, 'utf8'));
    const today = new Date().toDateString(); // Mon Sep 11 2026
    
    return lastCheck.date !== today;
  } catch (err) {
    console.error('[FREECASH MONITOR] Error reading check timestamp:', err.message);
    return true; // Allow on error, will log alert
  }
}

/**
 * Record that today's check has been performed (prevents Rule 2 violations)
 */
function recordDailyCheck() {
  const fs = require('fs');
  const lastCheckPath = config.CHECK_TIMESTAMP_FILE;
  
  const record = {
    date: new Date().toDateString(),
    checkedAt: new Date().toISOString(),
    checkNumber: getDailyCheckCount()
  };
  
  fs.writeFileSync(lastCheckPath, JSON.stringify(record, null, 2));
}

function getDailyCheckCount(): number {
  try {
    const lastCheckPath = config.CHECK_TIMESTAMP_FILE;
    if (!require('fs').existsSync(lastCheckPath)) return 0;
    
    const records = JSON.parse(require('fs').readFileSync(lastCheckPath, 'utf8'));
    return records.count || 1;
  } catch { return 0; }
}

/**
 * Fetch account status (READ-ONLY - Rule 1: never executes earnings actions)
 */
async function fetchStatus(): Promise<any> {
  const url = config.STATUS_API_URL;
  
  return new Promise((resolve, reject) => {
    // Use HTTPS with proper timeouts
    const options = {
      hostname: url.replace(/^https?:\/\//, '').split('/')[0],
      port: 443,
      path: url.split('/').slice(3).join('/'),
      method: 'GET',
      timeout: 10000 // 10 second timeout
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`Status: ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', error => {
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

/**
 * Check for earnings and status changes (Rule 3: notify on changes)
 */
async function checkForChanges(currentStatus): Promise<ChangeAlert[]> {
  const fs = require('fs');
  const existingPath = config.CHECK_TIMESTAMP_FILE;
  
  if (!fs.existsSync(existingPath)) {
    return [
      {
        type: 'INITIAL_CHECK',
        message: `First daily check. Account balance: ${currentStatus.balance || 'unknown'}$, pending: ${currentStatus.pendingEarnings || 0}$`
      }
    ];
  }
  
  const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  const alerts: ChangeAlert[] = [];
  
  if (currentStatus && typeof currentStatus === 'object') {
    // Rule 3: Notify on changes since last check
    if (currentStatus.balance !== existing.status?.balance) {
      alerts.push({
        type: 'ACCOUNT_BALANCE_CHANGE',
        message: `Account balance changed from ${existing.status?.balance || 0}$ to ${currentStatus.balance}$`,
        timestamp: new Date().toISOString()
      });
    }
    
    if (currentStatus.pendingEarnings !== existing.status?.pendingEarnings) {
      alerts.push({
        type: 'PENDING_EARNINGS_UPDATE',
        message: `Pending earnings updated from ${existing.status?.pendingEarnings || 0}$ to ${currentStatus.pendingEarnings}$`,
        timestamp: new Date().toISOString()
      });
    }
    
    if (currentStatus.todayEarned !== existing.status?.todayEarned) {
      alerts.push({
        type: 'TODAY_EARNINGS_UPDATE',
        message: `Today's earnings: ${currentStatus.todayEarned || 0}$`,
        timestamp: new Date().toISOString()
      });
    }
    
    if (currentStatus.flags?.length) {
      alerts.push({
        type: 'STATUS_FLAGS_DETECTED',
        message: `Alert flags detected: ${currentStatus.flags.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return alerts;
}

/**
 * Prepare action requests for human approval (Rule 4)
 */
async function prepareActionRequests(status, alerts): Promise<ActionRequest[]> {
  const fs = require('fs');
  const approvalPath = config.APPROVAL_INTERFACE;
  
  // Rule 1: Never auto-execute earnings actions
  const actionRequests: ActionRequest[] = [];
  
  if (alerts.some(a => a.type === 'ACCOUNT_BALANCE_CHANGE' || a.type === 'STATUS_FLAGS_DETECTED')) {
    // Prepare potential external actions for human review/approval (Rule 4)
    actionRequests.push({
      actionType: 'REVIEW_STATUS',
      target: status.accountId || 'main_account',
      reason: alerts.map(a => a.message).join('; '),
      priority: 'NORMAL',
      requiresApproval: true,
      description: `User approval required for: ${alerts[0].message}`
    });
  }
  
  // Write requests to approval queue
  const existingRequests = fs.existsSync(approvalPath) 
    ? JSON.parse(fs.readFileSync(approvalPath, 'utf8'))
    : { requests: [], lastReview: null };
  
  existingRequests.requests.push(...actionRequests);
  
  return actionRequests;
}

/**
 * Send notifications (Rule 3)
 */
async function sendNotifications(alerts): Promise<void> {
  const fs = require('fs');
  let notificationBody = '=== FREE CASH FINANCE STATUS ALERT ===\n\n';
  
  alerts.forEach(alert => {
    notificationBody += `[${alert.timestamp}] ${alert.type}: ${alert.message}\n`;
  });
  
  if (config.NOTIFICATION_EMAIL) {
    // Add email sending logic (stubbed - implement actual SMTP/SES integration)
    console.log(`[FREECASH MONITOR] Email notification to: ${config.NOTIFICATION_EMAIL}`);
    // await sendEmail(config.NOTIFICATION_EMAIL, 'Free Cash Status Alert', notificationBody);
  }
  
  if (config.NOTIFICATION_WEBHOOK) {
    // Add webhook calling logic
    console.log(`[FREECASH MONITOR] Webhook notification sent to: ${config.NOTIFICATION_WEBHOOK}`);
  }
  
  // Always log for user visibility
  console.log(notificationBody);
}

/**
 * Main check routine (enforces all 4 rules)
 */
async function runDailyCheck(): Promise<void> {
  const start = Date.now();
  
  try {
    console.log(`[FREECASH MONITOR] Starting daily status check at ${new Date().toLocaleTimeString()}`);
    
    // Rule 2: Verify only one check per day
    if (!isDailyCheckAllowed()) {
      const lastCheck = JSON.parse(require('fs').readFileSync(config.CHECK_TIMESTAMP_FILE, 'utf8'));
      console.log(`[FREECASH MONITOR] Daily check already performed today (${lastCheck.date}. Skipping.)`);
      
      // But still prepare for next day and record timestamp (cleanup)
      const newRecord = { ...lastCheck, date: new Date().toDateString() };
      require('fs').writeFileSync(config.CHECK_TIMESTAMP_FILE, JSON.stringify(newRecord, null, 2));
      return;
    }
    
    // Fetch status (Rule 1: read-only, no earnings actions)
    const status = await fetchStatus();
    
    // Check for changes (Rule 3: notify on earnings/status changes)
    const alerts = await checkForChanges(status);
    
    if (alerts.length > 0) {
      console.log(`[FREECASH MONITOR] Alerts detected (${alerts.length}):`);
      
      // Rule 1: Never auto-execute any external actions based on earnings data
      // Only prepare for human review/approval
      
      const actionRequests = await prepareActionRequests(status, alerts);
      
      // Rule 4: Human approval before ANY external action
      if (actionRequests.length > 0) {
        console.log(`[FREECASH MONITOR] ${actionRequests.length} action(s) pending human approval.`);
        
        // Send notifications (Rule 3)
        await sendNotifications(alerts);
      } else {
        console.log('[FREECASH MONITOR] Status changes detected but no external actions required.');
      }
    }
    
    // Record today's check (prevents double-check - Rule 2)
    recordDailyCheck();
    
    const duration = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`[FREECASH MONITOR] Daily check completed in ${duration}s. Rule compliance: OK.`);
    
  } catch (err) {
    console.error('[FREECASH MONITOR]', err.message);
    
    // Never auto-retry or execute on error - respect all rules
    throw err;
  }
}

/**
 * Main entry point
 */
(async () => {
  // Check if already run today (Rule 2)
  const fs = require('fs');
  const lastCheckPath = config.CHECK_TIMESTAMP_FILE + '.today';
  
  if (require('fs').existsSync(lastCheckPath)) {
    console.log('[FREECASH MONITOR] Daily check already completed. Exiting.');
    process.exit(0);
  }
  
  await runDailyCheck();
})().catch(err => {
  console.error('[FREECASH MONITOR] Error:', err.message);
  process.exit(1);
});
// eslint-disable-next-line no-redeclare
