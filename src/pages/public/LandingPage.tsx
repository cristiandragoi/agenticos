import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, CheckCircle, Zap } from 'lucide-react';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      {/* Navigation */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', padding: '24px 48px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.5px', color: '#fff' }}>
          Recruit<span style={{ color: '#3b82f6' }}>AI</span>
        </div>
        <div>
          <button 
            onClick={() => navigate('/public/intake')}
            style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
          >
            Start Free Demo
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '100px 24px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '32px' }}>
          <Zap size={16} /> The #1 Tool for Agency Recruiters
        </div>
        
        <h1 style={{ fontSize: '4.5rem', fontWeight: 800, lineHeight: 1.1, marginBottom: '24px', letterSpacing: '-1.5px' }}>
          Evaluate Candidates <br/>
          <span style={{ color: '#3b82f6' }}>10x Faster</span> with AI.
        </h1>
        
        <p style={{ fontSize: '1.25rem', color: '#94a3b8', maxWidth: '600px', margin: '0 auto 48px auto', lineHeight: 1.6 }}>
          Upload CVs, automatically extract structured data, score against job requirements, and generate client-ready briefs in seconds. Stop reading resumes. Start placing candidates.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '80px' }}>
          <button 
            onClick={() => navigate('/public/intake')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 32px', borderRadius: '12px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', fontSize: '1.125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.4)' }}
          >
            Try the Free Demo <ArrowRight size={20} />
          </button>
        </div>

        {/* Features / Value Prop */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px', textAlign: 'left' }}>
          <div style={{ padding: '32px', backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', marginBottom: '20px' }}>
              <FileText size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '12px' }}>Autonomous Extraction</h3>
            <p style={{ color: '#94a3b8', lineHeight: 1.5 }}>Instantly parse any PDF or text resume into clean, structured data. No more manual data entry into your ATS.</p>
          </div>

          <div style={{ padding: '32px', backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34d399', marginBottom: '20px' }}>
              <CheckCircle size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '12px' }}>Intelligent Scoring</h3>
            <p style={{ color: '#94a3b8', lineHeight: 1.5 }}>Score candidates against specific job requirements automatically. See exactly why a candidate is a strong fit.</p>
          </div>

          <div style={{ padding: '32px', backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fbbf24', marginBottom: '20px' }}>
              <Zap size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '12px' }}>Client-Ready Briefs</h3>
            <p style={{ color: '#94a3b8', lineHeight: 1.5 }}>Generate perfectly formatted executive summaries and next best actions to send directly to your hiring managers.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LandingPage;
