/**
 * sse-acceptance-harness.cjs
 *
 * Real SSE & HTTP Acceptance Protocol Driver for Agentic OS.
 * Connects directly to the live backend HTTP/SSE streaming endpoint without mocks.
 * Captures full chronological event timelines and high-precision latency metrics.
 */
'use strict';

const http = require('http');
const { randomUUID } = require('crypto');

function parseSseFrames(buffer) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() || '';
  const events = [];

  for (const frame of frames) {
    if (!frame.trim()) continue;
    let eventName = 'message';
    let data = '';

    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim();
      }
    }
    events.push({ event: eventName, data });
  }

  return { events, rest };
}

/**
 * Execute ONE real HTTP/SSE streaming conversation turn against Agentic OS backend.
 */
async function executeSseTurn(options) {
  const {
    baseUrl = 'http://127.0.0.1:4000',
    conversationId,
    prompt,
    operationId = `acc-op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    acceptanceRunId = `acc-run-${randomUUID().slice(0, 8)}`,
    timeoutMs = 60000,
    headers = {},
  } = options;

  const t0 = Date.now();
  let headersReceivedAt = 0;
  let firstEventAt = 0;
  let firstTokenAt = 0;
  let finishedAt = 0;

  const timeline = [];
  let assistantText = '';
  let finalRoute = 'unknown';
  let sawTerminalDone = false;
  let terminalError = null;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        acceptanceRunId,
        operationId,
        success: false,
        failureClass: 'MODEL_TIMEOUT',
        error: `Turn timed out after ${timeoutMs}ms`,
        assistantText,
        finalRoute,
        metrics: {
          connectLatencyMs: headersReceivedAt ? headersReceivedAt - t0 : null,
          firstEventLatencyMs: firstEventAt ? firstEventAt - headersReceivedAt : null,
          firstTokenLatencyMs: firstTokenAt ? firstTokenAt - headersReceivedAt : null,
          totalDurationMs: Date.now() - t0,
        },
        timeline,
      });
    }, timeoutMs);

    const url = new URL(`${baseUrl}/api/jarvis/conversations/${conversationId}/message/stream`);
    const reqBody = JSON.stringify({
      prompt,
      operationId,
      inputChannel: 'typed',
    });

    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqBody),
          ...headers,
        },
      },
      (res) => {
        headersReceivedAt = Date.now();
        const httpStatus = res.statusCode;

        if (httpStatus !== 200) {
          let errBody = '';
          res.on('data', chunk => { errBody += chunk; });
          res.on('end', () => {
            finish({
              acceptanceRunId,
              operationId,
              success: false,
              httpStatus,
              failureClass: 'SSE_TRANSPORT_FAILURE',
              error: `HTTP ${httpStatus}: ${errBody}`,
              assistantText: '',
              finalRoute: 'unknown',
              metrics: {
                connectLatencyMs: headersReceivedAt - t0,
                firstEventLatencyMs: null,
                firstTokenLatencyMs: null,
                totalDurationMs: Date.now() - t0,
              },
              timeline,
            });
          });
          return;
        }

        let buffer = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          const now = Date.now();
          if (!firstEventAt) firstEventAt = now;

          buffer += chunk;
          const { events, rest } = parseSseFrames(buffer);
          buffer = rest;

          for (const ev of events) {
            let parsedData = {};
            try { parsedData = ev.data ? JSON.parse(ev.data) : {}; } catch { parsedData = { raw: ev.data }; }

            timeline.push({
              ts: new Date(now).toISOString(),
              elapsedMs: now - t0,
              event: ev.event,
              data: parsedData,
            });

            if (ev.event === 'chunk' && typeof parsedData.delta === 'string') {
              if (!firstTokenAt) firstTokenAt = now;
              assistantText += parsedData.delta;
            }

            if (ev.event === 'done') {
              sawTerminalDone = true;
              finalRoute = parsedData.route || 'direct';
            }

            if (ev.event === 'error' || ev.event === 'execution_failed') {
              terminalError = parsedData.error || 'Unknown SSE Error';
            }
          }
        });

        res.on('end', () => {
          finishedAt = Date.now();
          if (buffer.trim()) {
            const { events } = parseSseFrames(`${buffer}\n\n`);
            for (const ev of events) {
              let parsedData = {};
              try { parsedData = ev.data ? JSON.parse(ev.data) : {}; } catch { parsedData = { raw: ev.data }; }
              timeline.push({
                ts: new Date(finishedAt).toISOString(),
                elapsedMs: finishedAt - t0,
                event: ev.event,
                data: parsedData,
              });
              if (ev.event === 'done') {
                sawTerminalDone = true;
                finalRoute = parsedData.route || 'direct';
              }
            }
          }

          const success = sawTerminalDone && !terminalError;
          finish({
            acceptanceRunId,
            operationId,
            success,
            httpStatus,
            failureClass: success ? null : (terminalError ? 'TOOL_FAILURE' : 'CLIENT_ABORT'),
            error: terminalError,
            assistantText,
            finalRoute,
            metrics: {
              connectLatencyMs: headersReceivedAt - t0,
              firstEventLatencyMs: firstEventAt ? firstEventAt - headersReceivedAt : null,
              firstTokenLatencyMs: firstTokenAt ? firstTokenAt - headersReceivedAt : null,
              totalDurationMs: finishedAt - t0,
            },
            timeline,
          });
        });

        res.on('error', (err) => {
          finish({
            acceptanceRunId,
            operationId,
            success: false,
            failureClass: 'SSE_TRANSPORT_FAILURE',
            error: err.message,
            assistantText,
            finalRoute,
            metrics: {
              connectLatencyMs: headersReceivedAt ? headersReceivedAt - t0 : null,
              firstEventLatencyMs: firstEventAt ? firstEventAt - headersReceivedAt : null,
              firstTokenLatencyMs: firstTokenAt ? firstTokenAt - headersReceivedAt : null,
              totalDurationMs: Date.now() - t0,
            },
            timeline,
          });
        });
      }
    );

    req.on('error', (err) => {
      finish({
        acceptanceRunId,
        operationId,
        success: false,
        failureClass: 'SSE_TRANSPORT_FAILURE',
        error: `Connection error: ${err.message}`,
        assistantText: '',
        finalRoute: 'unknown',
        metrics: {
          connectLatencyMs: null,
          firstEventLatencyMs: null,
          firstTokenLatencyMs: null,
          totalDurationMs: Date.now() - t0,
        },
        timeline,
      });
    });

    req.write(reqBody);
    req.end();
  });
}

module.exports = { executeSseTurn, parseSseFrames };
