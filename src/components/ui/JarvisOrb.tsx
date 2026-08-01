import React from 'react';

export interface JarvisOrbProps {
  state: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';
  audioLevel?: number;
  errorMessage?: string;
  subtext?: string;
}

export const JarvisOrb: React.FC<JarvisOrbProps> = ({
  state,
  audioLevel = 0,
  errorMessage,
  subtext,
}) => {
  // Define colors and animations based on state
  const colors = {
    idle: { primary: '#00f0ff', secondary: 'rgba(0, 240, 255, 0.15)', glow: 'rgba(0, 240, 255, 0.4)' },
    listening: { primary: '#10b981', secondary: 'rgba(16, 185, 129, 0.15)', glow: 'rgba(16, 185, 129, 0.4)' },
    transcribing: { primary: '#f59e0b', secondary: 'rgba(245, 158, 11, 0.15)', glow: 'rgba(245, 158, 11, 0.4)' },
    thinking: { primary: '#d4a373', secondary: 'rgba(212, 163, 115, 0.15)', glow: 'rgba(212, 163, 115, 0.4)' },
    speaking: { primary: '#3b82f6', secondary: 'rgba(59, 130, 246, 0.15)', glow: 'rgba(59, 130, 246, 0.4)' },
    error: { primary: '#ef4444', secondary: 'rgba(239, 68, 68, 0.15)', glow: 'rgba(239, 68, 68, 0.4)' },
  };

  const currentColors = colors[state] || colors.idle;

  // Base sizing calculations
  const baseScale = 1 + (audioLevel * 0.15);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 'clamp(260px, 30vw, 410px)',
        height: 'clamp(260px, 30vw, 410px)',
        padding: '24px',
        position: 'relative',
      }}
    >
      {/* Reactor Rings Area */}
      <div
        data-testid="jarvis-orb-core"
        style={{
          position: 'relative',
          width: 'clamp(180px, 100%, 360px)',
          aspectRatio: '1 / 1',
          maxWidth: '420px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${baseScale})`,
          transition: 'transform 0.1s ease-out',
        }}
      >
        {/* SVG concentric rings */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 200 200"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
          }}
        >
          <defs>
            <radialGradient id="reactorGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={currentColors.primary} stopOpacity={0.25} />
              <stop offset="70%" stopColor={currentColors.primary} stopOpacity={0.05} />
              <stop offset="100%" stopColor={currentColors.primary} stopOpacity={0} />
            </radialGradient>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={currentColors.primary} stopOpacity={1} />
              <stop offset="40%" stopColor={currentColors.primary} stopOpacity={0.6} />
              <stop offset="100%" stopColor={currentColors.primary} stopOpacity={0} />
            </radialGradient>
            <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Central radial background glow */}
          <circle cx="100" cy="100" r="90" fill="url(#reactorGlow)" />

          {/* Outermost rotating ticks ring */}
          <circle
            cx="100"
            cy="100"
            r="85"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="0.5"
            strokeDasharray="1 8"
            style={{
              transformOrigin: 'center',
              animation: 'spin-clockwise 45s linear infinite',
              opacity: 0.3,
            }}
          />

          {/* Outermost secondary solid ring */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="0.5"
            style={{ opacity: 0.15 }}
          />

          {/* Main rotating orbital dashes */}
          <circle
            cx="100"
            cy="100"
            r="70"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="1.5"
            strokeDasharray="40 100 20 40"
            filter="url(#glowFilter)"
            style={{
              transformOrigin: 'center',
              animation: state === 'error' ? 'none' : 'spin-clockwise 15s linear infinite',
              opacity: state === 'idle' ? 0.4 : 0.8,
            }}
          />

          {/* Counter-rotating secondary dashes */}
          <circle
            cx="100"
            cy="100"
            r="60"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="1"
            strokeDasharray="15 30 5 10"
            style={{
              transformOrigin: 'center',
              animation: state === 'error' ? 'none' : 'spin-counterclockwise 12s linear infinite',
              opacity: state === 'idle' ? 0.3 : 0.6,
            }}
          />

          {/* Dotted indicator ring */}
          <circle
            cx="100"
            cy="100"
            r="50"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="2"
            strokeDasharray="2 6"
            style={{
              transformOrigin: 'center',
              animation: 'spin-clockwise 25s linear infinite',
              opacity: 0.25,
            }}
          />

          {/* Pulsing inner glow base */}
          <circle
            cx="100"
            cy="100"
            r="38"
            fill="none"
            stroke={currentColors.primary}
            strokeWidth="0.75"
            style={{
              opacity: 0.2,
            }}
          />

          {/* Central Reactor Core Sphere */}
          <circle
            cx="100"
            cy="100"
            r="24"
            fill="url(#coreGlow)"
            style={{
              transformOrigin: 'center',
              animation: state === 'thinking'
                ? 'pulse-core 1.2s ease-in-out infinite'
                : state === 'speaking'
                ? 'pulse-core 0.8s ease-in-out infinite'
                : state === 'listening'
                ? 'pulse-core 1.6s ease-in-out infinite'
                : 'pulse-core 3s ease-in-out infinite',
            }}
          />
        </svg>

        {/* CSS styles injected inline for reactor rotation and core animations */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes spin-clockwise {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes spin-counterclockwise {
            from { transform: rotate(360deg); }
            to { transform: rotate(0deg); }
          }
          @keyframes pulse-core {
            0% { transform: scale(0.9); opacity: 0.8; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(0.9); opacity: 0.8; }
          }
        `}} />

      </div>

      {/* Under-orb Telemetry / Details */}
      <div
        style={{
          marginTop: '20px',
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          minHeight: '24px',
          width: '100%',
        }}
      >
        {subtext && (
          <div
            style={{
              color: 'var(--text-tertiary)',
              textTransform: 'lowercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '300px',
              margin: '0 auto',
            }}
          >
            {subtext}
          </div>
        )}
        {state === 'error' && errorMessage && (
          <div
            style={{
              color: 'var(--color-error)',
              fontSize: '11px',
              marginTop: '4px',
              padding: '0 12px',
              wordBreak: 'break-word',
            }}
          >
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
};
