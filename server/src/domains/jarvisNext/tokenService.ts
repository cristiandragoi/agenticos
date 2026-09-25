import { AccessToken } from 'livekit-server-sdk';
import { logger } from '../../utils/logger.js';

export const LIVEKIT_CONFIG = {
  wsUrl: process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880',
  apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  defaultRoom: 'jarvis-next-main',
};

export interface TokenRequestOptions {
  roomName?: string;
  identity?: string;
  name?: string;
}

export interface TokenResponse {
  token: string;
  wsUrl: string;
  roomName: string;
  identity: string;
}

export async function generateClientToken(options: TokenRequestOptions = {}): Promise<TokenResponse> {
  const roomName = options.roomName?.trim() || LIVEKIT_CONFIG.defaultRoom;
  const identity = options.identity?.trim() || `user-${Date.now().toString(36)}`;
  const name = options.name?.trim() || 'User';

  const at = new AccessToken(LIVEKIT_CONFIG.apiKey, LIVEKIT_CONFIG.apiSecret, {
    identity,
    name,
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  logger.info('[JarvisNext] Generated client token for room:', { roomName, identity });

  return {
    token,
    wsUrl: LIVEKIT_CONFIG.wsUrl,
    roomName,
    identity,
  };
}

export async function generateAgentToken(roomName: string = LIVEKIT_CONFIG.defaultRoom): Promise<string> {
  const at = new AccessToken(LIVEKIT_CONFIG.apiKey, LIVEKIT_CONFIG.apiSecret, {
    identity: 'jarvis-next-assistant',
    name: 'Jarvis (LiveKit)',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: true,
  });

  return await at.toJwt();
}
