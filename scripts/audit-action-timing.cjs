'use strict';

const http = require('http');

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('[AUDIT] 1. Creating conversation via POST /api/jarvis/conversations ...');
  const createRes = await httpRequest({
    hostname: '127.0.0.1',
    port: 4600,
    path: '/api/jarvis/conversations',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { title: 'Audit Timing' });

  console.log('[AUDIT] Conversation created:', createRes.body);
  const conversationId = createRes.body?.id || createRes.body?.conversation?.id;
  if (!conversationId) {
    console.error('[AUDIT] Failed to obtain conversation ID');
    process.exit(1);
  }

  const prompt = 'Open YouTube, search for Python AI agents, and open the first result';
  const operationId = 'audit-op-' + Date.now();
  const streamPayload = JSON.stringify({
    prompt,
    conversationId,
    operationId,
    inputChannel: 'web'
  });

  console.log(`\n[AUDIT] 2. Dispatched prompt at ${new Date().toISOString()}: "${prompt}"`);
  const startTime = Date.now();

  const events = [];

  const req = http.request({
    hostname: '127.0.0.1',
    port: 4600,
    path: `/api/jarvis/conversations/${conversationId}/message/stream`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(streamPayload)
    }
  }, res => {
    console.log(`[AUDIT] Stream response status: ${res.statusCode} in ${Date.now() - startTime}ms`);
    let buffer = '';
    let currentEvent = 'message';

    res.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          const dataStr = line.replace('data:', '').trim();
          const elapsed = Date.now() - startTime;
          const timestamp = new Date().toISOString();
          let parsed = null;
          try { parsed = JSON.parse(dataStr); } catch {}

          const eventRecord = {
            timestamp,
            elapsedMs: elapsed,
            event: currentEvent,
            data: parsed || dataStr
          };
          events.push(eventRecord);

          console.log(`[+${elapsed}ms] EVENT: ${currentEvent}`);
          if (currentEvent === 'action_status') {
            console.log(`>>> ACTION_STATUS at +${elapsed}ms:\n`, JSON.stringify(parsed, null, 2));
          } else {
            console.log(`    Data preview:`, typeof parsed === 'object' ? JSON.stringify(parsed).slice(0, 120) : String(dataStr).slice(0, 120));
          }
        }
      }
    });

    res.on('end', () => {
      const totalTime = Date.now() - startTime;
      console.log(`\n[AUDIT] Stream ended in ${totalTime}ms. Total events captured: ${events.length}`);

      const actionStatusEvents = events.filter(e => e.event === 'action_status');
      console.log(`\n[AUDIT] Action Status events count: ${actionStatusEvents.length}`);
      actionStatusEvents.forEach((ase, idx) => {
        console.log(`--- Action Status Event #${idx + 1} at +${ase.elapsedMs}ms ---`);
        console.log(JSON.stringify(ase.data, null, 2));
      });

      const fs = require('fs');
      fs.writeFileSync('docs/acceptance/action_timing_audit.json', JSON.stringify({
        prompt,
        conversationId,
        operationId,
        totalDurationMs: totalTime,
        actionStatusEventCount: actionStatusEvents.length,
        events
      }, null, 2));
      console.log('\n[AUDIT] Full audit trace saved to docs/acceptance/action_timing_audit.json');
    });
  });

  req.on('error', err => {
    console.error('[AUDIT] Stream error:', err);
  });

  req.write(streamPayload);
  req.end();
}

main().catch(err => {
  console.error('[AUDIT] Fatal error:', err);
});
