export type JarvisState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'researching'
  | 'executing'
  | 'delegating'
  | 'speaking'
  | 'completed'
  | 'warning'
  | 'error'
  | 'interrupted';

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type JarvisNodeId =
  | 'Memory'
  | 'Projects'
  | 'Knowledge'
  | 'Hermes'
  | 'CodeX'
  | 'Runs'
  | 'Artifacts'
  | 'Vision'
  | 'Oracle';

export interface JarvisNodeConfig {
  id: JarvisNodeId;
  label: string;
  route?: string;
  x: number;
  y: number;
  side: 'left' | 'right';
}

export interface JarvisVisualizationProps {
  state: JarvisState;
  activeNode?: JarvisNodeId | null;
  activeAgent?: string | null;
  severity?: Severity;
  speakingLevel?: number;
  thinkingIntensity?: number;
  isConnected?: boolean;
  nodeActivity?: Partial<Record<JarvisNodeId, number>>;
  visibleNodes?: JarvisNodeId[];
  onNodeClick?: (node: JarvisNodeId, route?: string) => void;
  className?: string;
}
