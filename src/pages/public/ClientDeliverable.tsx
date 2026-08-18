import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/client';
import { Box, Download, CheckCircle, FileText, Lock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const ClientDeliverable: React.FC = () => {
  const { artifactId } = useParams<{ artifactId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const navigate = useNavigate();
  const [artifact, setArtifact] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchArtifact = async () => {
      if (!artifactId) {
        setError('Deliverable not found.');
        setIsLoading(false);
        return;
      }

      try {
        const storageKey = `sessionToken_${artifactId}`;
        let sessionToken = localStorage.getItem(storageKey);

        // If there's a token in the URL, try to exchange it
        if (token) {
          try {
            const exchangeData = await apiClient.exchangeToken(artifactId, token);
            sessionToken = exchangeData.sessionToken;
            localStorage.setItem(storageKey, sessionToken!);
            
            // Clean up the URL
            searchParams.delete('token');
            navigate({ search: searchParams.toString() }, { replace: true });
          } catch (err) {
            console.error('Token exchange failed:', err);
            // We don't fail immediately, we'll try to use an existing sessionToken if it exists
          }
        }

        if (!sessionToken) {
          setError('Unauthorized Access');
          setIsLoading(false);
          return;
        }

        // Fetch securely using the session token
        const data = await apiClient.getArtifactSecure(artifactId, sessionToken);
        setArtifact(data.artifact);
      } catch (err) {
        console.error(err);
        setError('Deliverable not found or access denied.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchArtifact();
  }, [artifactId, token, navigate, searchParams]);

  const handleExport = () => {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex-col min-h-screen items-center justify-center p-6" style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div className="flex-col items-center gap-4">
          <div className="spinner" style={{ width: '48px', height: '48px', border: '4px solid rgba(59, 130, 246, 0.2)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#334155' }}>Preparing Your Deliverable...</h2>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex-col min-h-screen items-center justify-center p-6" style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ maxWidth: '500px', background: '#fff', padding: '40px', borderRadius: '16px', textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            {error === 'Unauthorized Access' ? <Lock size={48} color="#ef4444" /> : <FileText size={48} color="#94a3b8" />}
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
            {error === 'Unauthorized Access' ? 'Secure Link Required' : 'Deliverable Not Found'}
          </h2>
          <p style={{ color: '#64748b', lineHeight: 1.6 }}>
            {error === 'Unauthorized Access' 
              ? 'This intelligence brief is securely locked. Please use the exact magic link provided in your delivery email to view this report.' 
              : error || 'The requested brief could not be found or is still processing. Please check back later or contact your account manager.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-col min-h-screen" style={{ background: '#f1f5f9', color: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
      <header className="p-4 flex-row gap-2 items-center" style={{ background: '#1e293b', color: '#fff', borderBottom: '1px solid #e2e8f0', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="flex-row gap-2 items-center">
          <Box size={24} color="#3b82f6" />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px' }}>Recruit<span style={{color:'#3b82f6'}}>AI</span></h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, marginLeft: '12px' }}>
            <CheckCircle size={14} /> Paid & Delivered
          </span>
        </div>
        <button onClick={handleExport} className="flex-row gap-2 items-center" style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)' }} onMouseOver={(e) => e.currentTarget.style.background = '#2563eb'} onMouseOut={(e) => e.currentTarget.style.background = '#3b82f6'}>
          <Download size={18} /> Export Markdown
        </button>
      </header>

      <main className="flex-col items-center p-8" style={{ flex: 1 }}>
        <div style={{ maxWidth: '850px', width: '100%', background: '#fff', padding: '56px', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
          
          <style>{`
            .premium-markdown {
              color: #334155;
              line-height: 1.7;
              font-size: 1.125rem;
            }
            .premium-markdown h1 {
              font-size: 2.5rem;
              font-weight: 800;
              color: #0f172a;
              letter-spacing: -1px;
              margin-bottom: 32px;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 16px;
            }
            .premium-markdown h2 {
              font-size: 1.75rem;
              font-weight: 700;
              color: #1e293b;
              margin-top: 40px;
              margin-bottom: 20px;
            }
            .premium-markdown h3 {
              font-size: 1.25rem;
              font-weight: 600;
              color: #3b82f6;
              margin-top: 32px;
              margin-bottom: 16px;
            }
            .premium-markdown p {
              margin-bottom: 20px;
            }
            .premium-markdown ul {
              padding-left: 24px;
              margin-bottom: 24px;
            }
            .premium-markdown li {
              margin-bottom: 8px;
            }
            .premium-markdown hr {
              border: 0;
              border-top: 1px solid #e2e8f0;
              margin: 48px 0;
            }
          `}</style>
          
          <div className="premium-markdown">
            <ReactMarkdown>{artifact.content}</ReactMarkdown>
          </div>

        </div>
      </main>
    </div>
  );
};

export default ClientDeliverable;
