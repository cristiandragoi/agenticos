import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LIVEKIT_PORT = 7880;
let livekitProcess: ChildProcess | null = null;
let startingPromise: Promise<boolean> | null = null;

export function isLivekitPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${LIVEKIT_PORT}`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404 || (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500));
    });
    req.on('error', () => {
      // Try raw TCP port connect
      const sock = net.connect({ host: '127.0.0.1', port: LIVEKIT_PORT }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(500, () => {
        sock.destroy();
        resolve(false);
      });
    });
  });
}

export function resolveLivekitBinary(): string | null {
  const candidates: string[] = [];

  // Packaged app resources
  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'runtime', 'livekit', 'livekit-server.exe'),
      path.join(process.resourcesPath, 'app', 'runtime', 'livekit', 'livekit-server.exe')
    );
  }

  // Current working directory & ancestors
  candidates.push(
    path.join(process.cwd(), 'runtime', 'livekit', 'livekit-server.exe'),
    path.join(process.cwd(), '..', 'runtime', 'livekit', 'livekit-server.exe'),
    path.join(__dirname, '..', '..', '..', '..', 'runtime', 'livekit', 'livekit-server.exe'),
    path.join(__dirname, '..', '..', '..', 'runtime', 'livekit', 'livekit-server.exe'),
    'D:\\AgenticOS\\runtime\\livekit\\livekit-server.exe'
  );

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return c;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function ensureLivekitServerRunning(): Promise<boolean> {
  if (await isLivekitPortOpen()) {
    logger.info('[LiveKitManager] LiveKit server is already running on port ' + LIVEKIT_PORT);
    return true;
  }

  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    const binary = resolveLivekitBinary();
    if (!binary) {
      logger.error('[LiveKitManager] livekit-server.exe binary not found in candidates');
      return false;
    }

    logger.info('[LiveKitManager] Spawning LiveKit server from: ' + binary);

    try {
      const child = spawn(binary, ['--dev'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      livekitProcess = child;

      child.stdout?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          logger.debug('[LiveKitServer:stdout] ' + text);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          logger.debug('[LiveKitServer:stderr] ' + text);
        }
      });

      child.on('error', (err) => {
        logger.error('[LiveKitManager] Process error:', err);
        livekitProcess = null;
      });

      child.on('exit', (code, signal) => {
        logger.warn(`[LiveKitManager] Process exited with code=${code}, signal=${signal}`);
        livekitProcess = null;
      });

      // Poll up to 10 seconds for health
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isLivekitPortOpen()) {
          logger.info('[LiveKitManager] LiveKit server is healthy and responding on port ' + LIVEKIT_PORT);
          return true;
        }
        if (!livekitProcess) {
          break;
        }
      }

      logger.error('[LiveKitManager] LiveKit server failed to become healthy within timeout');
      return false;
    } catch (err: any) {
      logger.error('[LiveKitManager] Failed to launch LiveKit server:', err);
      return false;
    }
  })();

  try {
    return await startingPromise;
  } finally {
    startingPromise = null;
  }
}

export function stopLivekitServer(): Promise<void> {
  return new Promise((resolve) => {
    if (livekitProcess) {
      try {
        livekitProcess.kill();
      } catch {
        // ignore
      }
      livekitProcess = null;
    }
    resolve();
  });
}

// Clean up on process exit
process.on('exit', () => {
  if (livekitProcess) {
    try {
      livekitProcess.kill();
    } catch {
      // ignore
    }
  }
});
