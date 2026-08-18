import React from 'react';
import type { ChatMessage } from '../../types';

interface GatewayNoticeProps {
  message: ChatMessage;
}

export const GatewayNotice: React.FC<GatewayNoticeProps> = ({ message }) => {
  if (!message.gateway) return null;

  const { status, fallbackFrom } = message.gateway;

  if (status === 'fallback') {
    return (
      <div className="mt-2 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 p-2 rounded-md" aria-live="polite">
        <strong className="font-semibold block mb-1">Switched provider</strong>
        {fallbackFrom} failed or timed out.<br/>
        Continuing with {message.gateway.provider}.
      </div>
    );
  }

  if (status === 'interrupted') {
    return (
      <div className="mt-2 text-xs bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md" aria-live="assertive">
        <strong className="font-semibold block mb-1">Stream interrupted</strong>
        The response could not continue because output had already been released.
      </div>
    );
  }

  return null;
};
