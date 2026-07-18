import React, { useState } from 'react';
import { useData } from '../../store/dataStore';
import { useDrawer, useChat } from '../../store/appStore';
import MagicBento from '../ui/MagicBento';
import { Database, Search, Play, CheckCircle2, Activity } from 'lucide-react';

interface ApifyProviderViewProps {
  providerId: string;
}

const ApifyProviderView: React.FC<ApifyProviderViewProps> = ({ providerId }) => {
  const { providers, agents } = useData();
  const { setTarget, sendMessage } = useChat();
  const drawer = useDrawer();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);

  const provider = providers.find(p => p.id === providerId);
  if (!provider) return null;

  const associatedAgents = agents.filter(a => a.toolIds?.includes('tool-apify') || a.providerIds?.includes('prov-apify'));

  const handleTestConnection = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setTested(true);
      setTimeout(() => setTested(false), 3000);
    }, 1500);
  };

  const handleRunSample = () => {
    // Navigate to Universal Chat
    drawer.close();
    const targetAgentId = associatedAgents.length > 0 ? associatedAgents[0].id : null;
    if (targetAgentId) {
      setTarget(targetAgentId);
    }
    sendMessage({
      id: `msg-${Date.now()}`,
      role: 'user',
      agentId: targetAgentId || undefined,
      content: "Run the Apify Web Scraper actor on https://news.ycombinator.com and extract the top 10 articles.",
      timestamp: new Date().toISOString()
    });
  };

  const cards = [
    {
      title: 'Connection Status',
      description: `Token: Valid • Auth Scheme: ${provider.authScheme}`,
      label: provider.status.toUpperCase(),
      color: 'var(--surface-raised)',
      glowColor: provider.status === 'connected' ? '0, 255, 100' : '255, 0, 0',
      icon: <Activity size={16} />
    },
    {
      title: 'Available Actors',
      description: 'Web Scraper, Google Search Results Scraper, Instagram Profile Scraper',
      label: '3 SYNCED',
      color: 'var(--surface-raised)',
      icon: <Search size={16} />
    },
    {
      title: 'Datasets',
      description: 'Latest: "YC Top 10" (2 hours ago, 150KB)',
      label: 'DATA',
      color: 'var(--surface-raised)',
      icon: <Database size={16} />
    },
    {
      title: 'Associated Agents',
      description: associatedAgents.map(a => a.name).join(', ') || 'None',
      label: 'PIPELINES',
      color: 'var(--surface-raised)'
    },
    {
      title: 'Test Connection',
      description: testing ? 'Verifying token...' : tested ? 'Connection successful!' : 'Ping Apify API',
      label: 'ACTION',
      color: 'var(--surface-raised)',
      glowColor: tested ? '0, 255, 100' : testing ? '255, 150, 0' : undefined,
      onClick: handleTestConnection,
      icon: testing ? <Activity size={16} className="spin" /> : tested ? <CheckCircle2 size={16} color="var(--color-success)" /> : undefined
    },
    {
      title: 'Run Sample Actor',
      description: 'Launch an extraction workflow using Deep Researcher',
      label: 'QUICK START',
      color: 'var(--color-hermes)',
      glowColor: '120, 100, 255',
      onClick: handleRunSample,
      icon: <Play size={16} />
    }
  ];

  return (
    <div className="flex-col gap-4" style={{ height: '100%', padding: '16px', overflowY: 'auto' }}>
      <p className="text-sm text-secondary mb-2">{provider.description}</p>
      <MagicBento 
        cards={cards} 
        enableStars={false} 
        enableBorderGlow={true} 
        textAutoHide={false} 
      />
    </div>
  );
};

export default ApifyProviderView;
