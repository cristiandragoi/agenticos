// @ts-nocheck
import { useData } from '../../store/dataStore';
import React, { useState } from 'react';
import DrawerShell from './DrawerShell';
import { apiClient } from '../../api/client';
import { CheckCircle, XCircle, UserPlus } from 'lucide-react';

interface CreateAgentDrawerProps {
  onClose: () => void;
  onPin: () => void;
  isPinned: boolean;
  onCreated?: () => void;
}

const PRESET_COLORS = [
  '#d4a373', '#38bdf8', '#c084fc', '#f87171', '#10b981',
  '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#94a3b8',
];

const PRESET_ICONS = ['🤖', '🧠', '⚡', '🔍', '🛡️', '📊', '🎯', '🔧', '🌐', '📝'];

const CreateAgentDrawer: React.FC<CreateAgentDrawerProps> = ({
  onClose,
  onPin,
  isPinned,
  onCreated,
}) => {
  const { tools, providers, refresh } = useData();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('🤖');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [capabilities, setCapabilities] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const caps = capabilities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      await apiClient.createAgent({
        name: name.trim(),
        description: description.trim(),
        slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        avatar,
        color,
        capabilities: caps,
        toolIds: selectedTools,
        providerIds: selectedProviders,
      });

      setSuccess(true);
      refresh();
      if (onCreated) onCreated();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Failed to create agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId)
        ? prev.filter((id) => id !== toolId)
        : [...prev, toolId]
    );
  };

  const toggleProvider = (providerId: string) => {
    setSelectedProviders((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId]
    );
  };

  return (
    <DrawerShell
      title="Create New Agent"
      subtitle="Define a new autonomous agent"
      icon={<UserPlus size={18} color="var(--color-hermes)" />}
      accentColor="var(--color-hermes)"
      onClose={onClose}
      onPin={onPin}
      isPinned={isPinned}
    >
      <form onSubmit={handleSubmit} className="drawer-section">
        {success ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--color-success)',
            }}
          >
            <CheckCircle size={40} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 600, fontSize: '1rem' }}>
              Agent created!
            </div>
          </div>
        ) : (
          <div className="flex-col gap-4">
            {/* Name */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Name <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Obsidian, Apify, News Radar"
                className="form-input"
                style={{
                  width: '100%',
                  height: 36,
                  fontSize: '0.85rem',
                  padding: '0 10px',
                }}
                autoFocus
                required
              />
            </div>

            {/* Description */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                className="form-input"
                style={{
                  width: '100%',
                  minHeight: 60,
                  fontSize: '0.8rem',
                  padding: '8px 10px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Icon + Color */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Icon
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {PRESET_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setAvatar(icon)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '8px',
                      background:
                        avatar === icon
                          ? 'var(--color-hermes)'
                          : 'var(--bg-elevated)',
                      border:
                        avatar === icon
                          ? '2px solid var(--color-hermes)'
                          : '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Color
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: c,
                      border:
                        color === c
                          ? '3px solid var(--text-primary)'
                          : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Capabilities */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Capabilities
              </label>
              <input
                type="text"
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
                placeholder="e.g. code-generation, research, monitoring"
                className="form-input"
                style={{
                  width: '100%',
                  height: 36,
                  fontSize: '0.8rem',
                  padding: '0 10px',
                }}
              />
              <div
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                }}
              >
                Comma-separated
              </div>
            </div>

            {/* Tools */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Tools
              </label>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {tools.map((tool: any) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      border: `1px solid ${
                        selectedTools.includes(tool.id)
                          ? 'var(--color-hermes)'
                          : 'var(--border-subtle)'
                      }`,
                      background: selectedTools.includes(tool.id)
                        ? 'rgba(212, 163, 115, 0.15)'
                        : 'var(--bg-elevated)',
                      color: selectedTools.includes(tool.id)
                        ? 'var(--color-hermes)'
                        : 'var(--text-secondary)',
                    }}
                  >
                    {tool.name}
                    {selectedTools.includes(tool.id) && (
                      <span style={{ marginLeft: 4 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Providers */}
            <div>
              <label
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Default Providers / Models
              </label>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              >
                {providers.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProvider(p.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      border: `1px solid ${
                        selectedProviders.includes(p.id)
                          ? 'var(--color-hermes)'
                          : 'var(--border-subtle)'
                      }`,
                      background: selectedProviders.includes(p.id)
                        ? 'rgba(212, 163, 115, 0.15)'
                        : 'var(--bg-elevated)',
                      color: selectedProviders.includes(p.id)
                        ? 'var(--color-hermes)'
                        : 'var(--text-secondary)',
                    }}
                  >
                    {p.name}
                    {selectedProviders.includes(p.id) && (
                      <span style={{ marginLeft: 4 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-error)',
                  padding: '6px 10px',
                  background: 'var(--color-error-bg)',
                  borderRadius: '6px',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '0.85rem',
                fontWeight: 600,
                background: 'var(--color-hermes)',
                border: 'none',
                borderRadius: '8px',
                color: '#000',
                cursor:
                  !name.trim() || isSubmitting ? 'not-allowed' : 'pointer',
                opacity: !name.trim() || isSubmitting ? 0.5 : 1,
              }}
            >
              {isSubmitting ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
        )}
      </form>
    </DrawerShell>
  );
};

export default CreateAgentDrawer;
