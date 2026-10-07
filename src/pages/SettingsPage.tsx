// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useData } from '../store/dataStore';
import { apiFetch } from '../api/client';
import {
  Send, Shield, CheckCircle2, XCircle, AlertCircle, Eye, EyeOff,
  RefreshCw, Smartphone, Key, Lock, Check, ExternalLink, Zap
} from 'lucide-react';

interface TelegramStatus {
  configured: boolean;
  connected: boolean;
  polling: boolean;
  status: 'TELEGRAM_NOT_CONFIGURED' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  botUsername: string | null;
  botId: number | null;
  authorizedUserCount: number;
  authorizedChatCount: number;
  lastUpdateAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
}

const SettingsPage: React.FC = () => {
  const { runtimes: mockRuntimes, isLoading } = useData();

  // Telegram Integration State
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLoading, setTelegramLoading] = useState<boolean>(true);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [allowedUsersInput, setAllowedUsersInput] = useState<string>('');
  const [allowedChatsInput, setAllowedChatsInput] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchTelegramStatus = async () => {
    try {
      setTelegramLoading(true);
      const res = await apiFetch('/api/integrations/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setTelegramStatus(data);
      }
    } catch (err: any) {
      console.error('Failed to load Telegram status:', err);
    } finally {
      setTelegramLoading(false);
    }
  };

  useEffect(() => {
    fetchTelegramStatus();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setBannerMessage(null);
    try {
      const payload: any = {};
      if (tokenInput.trim()) {
        payload.botToken = tokenInput.trim();
      }
      if (allowedUsersInput.trim()) {
        payload.allowedUserIds = allowedUsersInput.trim();
      }
      if (allowedChatsInput.trim()) {
        payload.allowedChatIds = allowedChatsInput.trim();
      }

      const res = await apiFetch('/api/integrations/telegram/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setBannerMessage({ type: 'success', text: data.message || 'Telegram settings saved securely.' });
        setTelegramStatus(data.status);
        setTokenInput(''); // Clear input after successful storage
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to save configuration.' });
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err?.message || 'Network error saving configuration.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setBannerMessage(null);
    try {
      const res = await apiFetch('/api/integrations/telegram/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBannerMessage({ type: 'success', text: `Telegram connection verified! Bot @${data.status.botUsername} is active and polling.` });
      } else {
        setBannerMessage({ type: 'error', text: `Connection test failed: ${data.status.lastError || 'Could not connect'}` });
      }
      setTelegramStatus(data.status);
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err?.message || 'Test request failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to remove the stored Telegram bot token?')) return;
    setSaving(true);
    setBannerMessage(null);
    try {
      const res = await apiFetch('/api/integrations/telegram/credentials', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: 'Telegram credentials cleared.' });
        setTelegramStatus(data.status);
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err?.message || 'Failed to clear credentials' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;

  return (
    <div className="flex-col h-full" style={{ maxWidth: 880 }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Settings</h1>
          <p>System configuration, runtime adapters, and remote integrations.</p>
        </div>
      </div>

      <div className="flex-col gap-6">

        {/* ── Telegram Remote Jarvis Integration ── */}
        <div className="widget-card" style={{ border: '1px solid rgba(0, 136, 204, 0.3)', background: 'linear-gradient(180deg, rgba(0, 136, 204, 0.04) 0%, rgba(20, 24, 33, 0.98) 100%)' }}>
          <div className="widget-card__header flex-row justify-between align-center">
            <div className="flex-row align-center gap-2">
              <div style={{ padding: '6px', background: 'rgba(0, 136, 204, 0.15)', borderRadius: '8px', color: '#0088cc' }}>
                <Send size={18} />
              </div>
              <div>
                <span className="font-semibold text-primary">Telegram Remote Jarvis</span>
                <div className="text-secondary text-xs">First-class mobile control plane & autonomous agent interface</div>
              </div>
            </div>

            {/* Status Badge */}
            <div>
              {telegramLoading ? (
                <span className="badge badge-dim flex-row align-center gap-1"><RefreshCw size={12} className="spin" /> Checking...</span>
              ) : !telegramStatus?.configured ? (
                <span className="badge badge-warning flex-row align-center gap-1" style={{ background: 'rgba(255, 170, 0, 0.15)', color: '#ffaa00' }}>
                  <AlertCircle size={12} /> TELEGRAM_NOT_CONFIGURED
                </span>
              ) : telegramStatus.connected && telegramStatus.polling ? (
                <span className="badge badge-success flex-row align-center gap-1" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                  <CheckCircle2 size={12} /> CONNECTED (@{telegramStatus.botUsername || 'bot'})
                </span>
              ) : (
                <span className="badge badge-danger flex-row align-center gap-1" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                  <XCircle size={12} /> DISCONNECTED
                </span>
              )}
            </div>
          </div>

          <div className="flex-col gap-4 text-sm mt-3">
            {bannerMessage && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: bannerMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: `1px solid ${bannerMessage.type === 'success' ? '#10b981' : '#ef4444'}`,
                  color: bannerMessage.type === 'success' ? '#10b981' : '#f87171',
                }}
                className="flex-row align-center gap-2"
              >
                {bannerMessage.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{bannerMessage.text}</span>
              </div>
            )}

            {/* Status Telemetry Overview */}
            {telegramStatus && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '10px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div>
                  <div className="text-muted text-xs">Bot Username</div>
                  <div className="font-semibold text-primary text-sm mt-0.5">
                    {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-xs">Polling Status</div>
                  <div className="font-semibold text-sm mt-0.5" style={{ color: telegramStatus.polling ? '#10b981' : '#888' }}>
                    {telegramStatus.polling ? 'Active (Long Poll)' : 'Idle'}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-xs">Allowed Users</div>
                  <div className="font-semibold text-primary text-sm mt-0.5">
                    {telegramStatus.authorizedUserCount > 0 ? `${telegramStatus.authorizedUserCount} authorized` : 'Any (unrestricted)'}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-xs">Last Activity</div>
                  <div className="font-semibold text-primary text-sm mt-0.5 text-ellipsis">
                    {telegramStatus.lastUpdateAt ? new Date(telegramStatus.lastUpdateAt).toLocaleTimeString() : 'None'}
                  </div>
                </div>
              </div>
            )}

            {telegramStatus?.lastError && telegramStatus.lastError !== 'TELEGRAM_NOT_CONFIGURED' && (
              <div className="text-xs" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: '4px' }}>
                <strong>Last Error:</strong> {telegramStatus.lastError}
              </div>
            )}

            {/* Secure Configuration Form */}
            <form onSubmit={handleSaveConfig} className="flex-col gap-3">
              <div>
                <div className="flex-row justify-between align-center mb-1">
                  <label className="text-secondary font-medium flex-row align-center gap-1">
                    <Key size={14} /> Telegram Bot Token
                  </label>
                  <span className="text-dim text-xs">Stored in OS Credential Manager (keytar)</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showToken ? 'text' : 'password'}
                    placeholder={telegramStatus?.configured ? '•••••••••••••••••••••••••••••••••••• (Configured — enter new to replace)' : 'e.g. 123456789:ABCdefGHIjklMNOpqrsTUVwxyz'}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="chat-dock__input"
                    style={{ width: '100%', paddingRight: '40px' }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex-row gap-3">
                <div style={{ flex: 1 }}>
                  <div className="text-secondary mb-1 font-medium flex-row align-center gap-1">
                    <Shield size={14} /> Allowed Telegram User IDs (Optional)
                  </div>
                  <input
                    type="text"
                    placeholder="Comma-separated, e.g. 123456789, 987654321"
                    value={allowedUsersInput}
                    onChange={(e) => setAllowedUsersInput(e.target.value)}
                    className="chat-dock__input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="text-secondary mb-1 font-medium flex-row align-center gap-1">
                    <Smartphone size={14} /> Allowed Chat IDs (Optional)
                  </div>
                  <input
                    type="text"
                    placeholder="Comma-separated, e.g. 123456789, -100123456789"
                    value={allowedChatsInput}
                    onChange={(e) => setAllowedChatsInput(e.target.value)}
                    className="chat-dock__input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex-row gap-2 mt-2">
                <button
                  type="submit"
                  disabled={saving || (!tokenInput.trim() && !allowedUsersInput.trim() && !allowedChatsInput.trim())}
                  className="btn btn-primary flex-row align-center gap-2"
                  style={{ background: '#0088cc', borderColor: '#0088cc', color: '#fff' }}
                >
                  {saving ? <RefreshCw size={14} className="spin" /> : <Lock size={14} />}
                  <span>Save & Connect</span>
                </button>

                {telegramStatus?.configured && (
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="btn btn-secondary flex-row align-center gap-1"
                  >
                    {testing ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />}
                    <span>Test Connection</span>
                  </button>
                )}

                {telegramStatus?.configured && (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={saving}
                    className="btn btn-danger flex-row align-center gap-1 ml-auto"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                  >
                    <XCircle size={14} />
                    <span>Clear Credentials</span>
                  </button>
                )}
              </div>
            </form>

            {/* Quick Setup Instructions */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px' }} className="text-secondary text-xs flex-col gap-1">
              <div className="font-semibold text-primary">How to connect your Telegram phone:</div>
              <div>1. In Telegram, start a chat with <strong>@BotFather</strong>.</div>
              <div>2. Send <code>/newbot</code>, choose a bot name and username (e.g. <code>my_jarvis_bot</code>).</div>
              <div>3. Copy the HTTP API token into the field above and click <strong>Save & Connect</strong>.</div>
              <div>4. Send <code>/start</code> to your bot on your phone. If allowlist is empty, it will display your User ID so you can restrict access.</div>
              <div>5. Test <code>/health</code>, <code>What is AntiGravity doing right now?</code>, and <code>/screenshot</code>.</div>
            </div>
          </div>
        </div>

        {/* ── Workspace Configuration ── */}
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Workspace Configuration</span>
          </div>
          <div className="flex-col gap-4 text-sm">
            <div>
              <div className="text-secondary mb-1">Workspace ID</div>
              <input type="text" value="ws-1" readOnly className="chat-dock__input" style={{ width: '100%' }} />
            </div>
            <div>
              <div className="text-secondary mb-1">Environment</div>
              <input type="text" value="development" readOnly className="chat-dock__input" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        {/* ── Registered Runtimes ── */}
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Registered Runtimes</span>
          </div>
          <div className="flex-col gap-2 text-sm">
            {mockRuntimes.map(rt => (
              <div key={rt.id} className="flex-row justify-between p-2" style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)' }}>
                <span>{rt.label} <span className="text-muted">({rt.adapterType})</span></span>
                <span className="text-secondary">{rt.eventProtocol}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Memory Sync Settings ── */}
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Memory Sync & External Vaults</span>
          </div>
          <div className="flex-col gap-4 text-sm">
            <div>
              <div className="text-secondary mb-1">Obsidian Vault Path</div>
              <input type="text" defaultValue="~/Documents/ObsidianVault" className="chat-dock__input" style={{ width: '100%' }} />
              <div className="text-dim text-xxs mt-1">Absolute path to your local Obsidian vault.</div>
            </div>
            <div>
              <div className="text-secondary mb-1">Global Sync Policy</div>
              <select className="chat-dock__input" style={{ width: '100%', background: 'var(--bg-base)' }} defaultValue="batched">
                <option value="immediate">Immediate</option>
                <option value="batched">Batched (every 5 events)</option>
                <option value="once-daily">Once Daily</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
            <div className="flex-row align-center gap-2">
              <input type="checkbox" id="auto-summary" defaultChecked />
              <label htmlFor="auto-summary" className="text-secondary cursor-pointer">Auto-summarize conversation runs before syncing</label>
            </div>
            <div className="flex-row align-center gap-2">
              <input type="checkbox" id="preview-before-sync" />
              <label htmlFor="preview-before-sync" className="text-secondary cursor-pointer">Preview before sync</label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
