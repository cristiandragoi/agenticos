import { useEffect, useRef } from 'react';
import type { GatewayUiEvent } from '../types';
import { apiFetch, apiUrl } from '../api/client';

interface UseGatewayStreamProps {
  conversationId: string | null;
  onMessage: (message: any) => void;
  onGatewayEvent: (messageId: string | null, event: GatewayUiEvent, metadataUpdate: any) => void;
}

export function useGatewayStream({ conversationId, onMessage, onGatewayEvent }: UseGatewayStreamProps) {
  const activeOperationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || typeof EventSource === 'undefined') return;

    const es = new EventSource(apiUrl(`/api/jarvis/stream/${conversationId}`));
    
    const isStale = (opId?: string) => {
      if (!opId) return false;
      if (!activeOperationIdRef.current) activeOperationIdRef.current = opId;
      if (activeOperationIdRef.current !== opId) return true;
      return false;
    };

    es.addEventListener('message', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    });

    es.addEventListener('gateway.selected', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (isStale(data.operationId)) return;
        onGatewayEvent(data.id || null, {
          type: 'selected',
          timestamp: new Date().toISOString(),
          provider: data.provider,
          model: data.model,
          operationId: data.operationId
        }, {
          provider: data.provider,
          model: data.model,
          status: 'streaming'
        });
      } catch {}
    });

    es.addEventListener('gateway.fallback', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (isStale(data.operationId)) return;
        onGatewayEvent(data.id || null, {
          type: 'fallback',
          timestamp: new Date().toISOString(),
          provider: data.provider,
          model: data.model,
          target: data.provider,
          reason: `Fallback: ${data.error || 'Provider failed'}`,
          operationId: data.operationId
        }, {
          provider: data.provider,
          model: data.model,
          status: 'fallback',
          fallbackFrom: data.failedProvider
        });
      } catch {}
    });

    es.addEventListener('gateway.failed', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (isStale(data.operationId)) return;
        onGatewayEvent(data.id || null, {
          type: 'failed',
          timestamp: new Date().toISOString(),
          reason: data.error,
          operationId: data.operationId
        }, {
          status: 'failed'
        });
      } catch {}
    });

    es.addEventListener('streaming_interruption', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (isStale(data.operationId)) return;
        onGatewayEvent(data.id || null, {
          type: 'interrupted',
          timestamp: new Date().toISOString(),
          operationId: data.operationId
        }, {
          status: 'interrupted',
          streamInterrupted: true
        });
      } catch {}
    });

    es.addEventListener('gateway.completed', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (isStale(data.operationId)) return;
        onGatewayEvent(data.id || null, {
          type: 'completed',
          timestamp: new Date().toISOString(),
          durationMs: data.durationMs,
          operationId: data.operationId
        }, {
          status: 'completed',
          durationMs: data.durationMs,
          promptTokens: data.promptTokens,
          completionTokens: data.completionTokens,
          totalTokens: data.totalTokens,
          estimatedCost: data.estimatedCost,
          latencyMs: data.latencyMs,
          tokensPerSecond: data.tokensPerSecond
        });
      } catch {}
    });

    return () => {
      es.close();
      activeOperationIdRef.current = null;
    };
  }, [conversationId]);
}
