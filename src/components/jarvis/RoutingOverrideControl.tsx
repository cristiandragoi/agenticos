/**
 * Conversation-level routing override (PRIORITY 3) — compact AUTO/manual
 * control near the Jarvis message input. Manual selection applies ONLY to
 * this conversation's executions; it never changes global AgenticOS routing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiUrl } from '../../api/client';

export interface RoutingOverrideValue {
  provider: string | null;
  model: string | null;
  mode: 'auto' | 'manual';
}

interface Props {
  value: RoutingOverrideValue;
  onChange: (v: RoutingOverrideValue) => void;
}

export const RoutingOverrideControl: React.FC<Props> = ({ value, onChange }) => {
  const [options, setOptions] = useState<Array<{ provider: string; model: string | null }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Only show providers/models that are actually configured/available.
    (async () => {
      try {
        const res = await apiFetch('/api/providers');
        const providers = await res.json();
        const list: Array<{ provider: string; model: string | null }> = [];
        const arr = Array.isArray(providers) ? providers : (providers?.providers || []);
        for (const p of arr) {
          const models = Array.isArray(p?.models) ? p.models : [];
          if (models.length) {
            for (const m of models) list.push({ provider: p.id || p.name, model: typeof m === 'string' ? m : (m?.id || m?.name || null) });
          } else {
            list.push({ provider: p.id || p.name, model: null });
          }
        }
        setOptions(list.slice(0, 20));
      } catch { /* providers unavailable — AUTO only */ }
    })();
  }, []);

  const label = value.mode === 'manual' && value.provider
    ? `MANUAL · ${value.provider}${value.model ? ` / ${value.model}` : ''}`
    : 'AUTO';

  const pick = (provider: string, model: string | null) => {
    onChange({ provider, model, mode: 'manual' });
    setOpen(false);
  };

  const parts = useMemo(() => {
    const unique = new Map<string, { provider: string; model: string | null }>();
    for (const o of options) {
      const key = `${o.provider}|${o.model || ''}`;
      if (!unique.has(key)) unique.set(key, o);
    }
    return [...unique.values()];
  }, [options]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        data-testid="routing-override-control"
        onClick={() => setOpen((o) => !o)}
        title="Conversation-level provider/model override (does NOT change global routing)"
        style={{
          background: value.mode === 'manual' ? '#1e3a5f' : '#0f172a',
          border: `1px solid ${value.mode === 'manual' ? '#3b82f6' : '#1e293b'}`,
          color: value.mode === 'manual' ? '#93c5fd' : '#64748b',
          borderRadius: 8, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
        }}
      >
        {label} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: 26, left: 0, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 6, zIndex: 40, maxHeight: 280, overflowY: 'auto', minWidth: 220 }}>
          <div
            onClick={() => { onChange({ provider: null, model: null, mode: 'auto' }); setOpen(false); }}
            style={{ padding: '5px 8px', cursor: 'pointer', color: value.mode === 'auto' ? '#93c5fd' : '#cbd5e1', fontSize: 12 }}
          >
            AUTO (global routing)
          </div>
          {parts.map((o) => (
            <div
              key={`${o.provider}|${o.model}`}
              onClick={() => pick(o.provider, o.model)}
              style={{ padding: '5px 8px', cursor: 'pointer', color: '#cbd5e1', fontSize: 12 }}
            >
              {o.provider}{o.model ? ` / ${o.model}` : ''}
            </div>
          ))}
          {!parts.length && <div style={{ padding: 5, color: '#64748b', fontSize: 11 }}>No providers available</div>}
        </div>
      )}
    </div>
  );
};
