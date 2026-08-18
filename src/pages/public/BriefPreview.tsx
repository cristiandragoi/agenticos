import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Lock, CheckCircle, FileText, ArrowRight } from 'lucide-react';

const BriefPreview: React.FC = () => {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(true);

  // Mock analysis delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnalyzing(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex-col min-h-screen" style={{ background: '#0f172a', color: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <header className="p-4 flex-row gap-2 items-center" style={{ background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <Box size={24} color="#3b82f6" />
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px' }}>Recruit<span style={{color:'#3b82f6'}}>AI</span></h1>
      </header>

      <main className="flex-col items-center p-8" style={{ flex: 1 }}>
        <div style={{ maxWidth: '800px', width: '100%' }}>
          
          {isAnalyzing ? (
            <div className="flex-col items-center justify-center" style={{ padding: '100px 0', gap: '24px' }}>
              <div className="spinner" style={{ width: '48px', height: '48px', border: '4px solid rgba(59, 130, 246, 0.3)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Analyzing Candidate Match...</h2>
              <p style={{ color: '#94a3b8' }}>Extracting skills, computing fit score, and drafting client summary.</p>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              <div className="flex-col items-center mb-8">
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#34d399', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '20px' }}>
                  <CheckCircle size={18} /> Analysis Complete
                </div>
                <h2 style={{ fontSize: '3rem', fontWeight: 800, textAlign: 'center', marginBottom: '16px', letterSpacing: '-1px' }}>
                  Candidate Match: <span style={{ color: '#10b981' }}>87/100</span>
                </h2>
                <p style={{ color: '#94a3b8', textAlign: 'center', fontSize: '1.25rem', maxWidth: '600px', lineHeight: 1.5 }}>
                  This candidate is a strong fit. Review the free preview below, or unlock the full brief to send to your client.
                </p>
              </div>

              {/* Free Preview Section */}
              <div style={{ background: '#1e293b', padding: '36px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '32px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={20} color="#3b82f6" /> Extracted Profile Summary
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Years of Experience</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 500, color: '#f8fafc' }}>8+ Years</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Key Skills Matched</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500 }}>React</span>
                      <span style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500 }}>Node.js</span>
                      <span style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500 }}>System Design</span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '32px' }}>
                  <h4 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '16px', color: '#f8fafc' }}>Strengths vs Job Description</h4>
                  <ul style={{ color: '#cbd5e1', paddingLeft: '24px', lineHeight: 1.6, fontSize: '1rem', listStyleType: 'disc' }}>
                    <li style={{ marginBottom: '8px' }}>Exceeds the 5-year experience requirement.</li>
                    <li>Strong background in scalable frontend architecture.</li>
                  </ul>
                </div>
              </div>

              {/* Paywall Section */}
              <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)', background: '#1e293b', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                {/* Skeleton UI mimicking real content */}
                <div style={{ padding: '36px', opacity: 0.3, userSelect: 'none', pointerEvents: 'none' }}>
                  <div style={{ width: '200px', height: '24px', background: '#cbd5e1', borderRadius: '4px', marginBottom: '32px' }}></div>
                  
                  <div style={{ width: '100%', height: '16px', background: '#94a3b8', borderRadius: '4px', marginBottom: '16px' }}></div>
                  <div style={{ width: '90%', height: '16px', background: '#94a3b8', borderRadius: '4px', marginBottom: '16px' }}></div>
                  <div style={{ width: '95%', height: '16px', background: '#94a3b8', borderRadius: '4px', marginBottom: '32px' }}></div>
                  
                  <div style={{ width: '150px', height: '20px', background: '#cbd5e1', borderRadius: '4px', marginBottom: '24px' }}></div>
                  
                  <div style={{ width: '100%', height: '16px', background: '#94a3b8', borderRadius: '4px', marginBottom: '12px' }}></div>
                  <div style={{ width: '85%', height: '16px', background: '#94a3b8', borderRadius: '4px', marginBottom: '12px' }}></div>
                  <div style={{ width: '60%', height: '16px', background: '#94a3b8', borderRadius: '4px' }}></div>
                </div>
                
                {/* Paywall Overlay */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(to bottom, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.95) 40%, rgba(15,23,42,1) 100%)', padding: '32px', textAlign: 'center', backdropFilter: 'blur(2px)' }}>
                  <div style={{ background: '#0f172a', border: '1px solid #3b82f6', padding: '16px', borderRadius: '50%', marginBottom: '20px', color: '#3b82f6' }}>
                    <Lock size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '12px', letterSpacing: '-0.5px' }}>Unlock the Full Intelligence Brief</h3>
                  <p style={{ color: '#94a3b8', maxWidth: '420px', marginBottom: '32px', fontSize: '1.125rem', lineHeight: 1.5 }}>
                    Get the client-ready executive summary, interview guide, and PDF export instantly via email.
                  </p>
                  
                  <button 
                    onClick={() => {
                      const stripeLink = import.meta.env.VITE_STRIPE_PAYMENT_LINK;
                      if (stripeLink) {
                        window.location.href = `${stripeLink}?client_reference_id=${leadId}&prefilled_email=test@example.com`;
                      } else {
                        navigate(`/public/checkout/${leadId}`);
                      }
                    }}
                    style={{ 
                      padding: '16px 36px', borderRadius: '6px', 
                      background: '#1e293b', 
                      color: '#fff', fontSize: '1.125rem', fontWeight: 600, border: '1px solid #3b82f6', cursor: 'pointer', 
                      display: 'flex', alignItems: 'center', gap: '10px',
                      transition: 'background 0.2s ease'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = '#0f172a'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = '#1e293b'; }}
                  >
                    Unlock for $9.99 <ArrowRight size={20} />
                  </button>
                  <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '20px', fontWeight: 500 }}>Or subscribe for unlimited briefs at $49/mo.</p>
                </div>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  );
};

export default BriefPreview;
