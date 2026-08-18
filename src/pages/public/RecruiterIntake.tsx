import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, FileText, Upload, Sparkles, Loader2 } from 'lucide-react';
import { apiClient } from '../../api/client';

const RecruiterIntake: React.FC = () => {
  const navigate = useNavigate();
  const [jobDescription, setJobDescription] = useState('');
  const [cvText, setCvText] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobDescription || !cvText || !customerEmail) {
      setError('Please fill in all required fields to continue.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    
    try {
      const data = { 
        customerName: 'Guest Recruiter', 
        customerEmail, 
        company: 'Unknown', 
        requestType: 'cv_evaluation', 
        budget: '0', 
        goal: `Eval CV against JD: ${jobDescription.slice(0, 50)}...`,
        cvText,
        jobDescription
      };
      
      // Store the CV/JD locally to simulate the backend passing it around for the demo
      localStorage.setItem('demo_cv', cvText);
      localStorage.setItem('demo_jd', jobDescription);

      const res = await apiClient.createLead(data);
      if (res.success) {
        // Redirect to brief preview page
        navigate(`/public/brief/${res.lead.id}`);
      } else {
        setError(res.error || 'Failed to analyze CV.');
      }
    } catch (err) {
      console.error(err);
      setError('An unexpected network error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-col min-h-screen" style={{ background: '#0f172a', color: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <header className="p-4 flex-row gap-2 items-center" style={{ background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <Box size={24} color="#3b82f6" />
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px' }}>Recruit<span style={{color:'#3b82f6'}}>AI</span></h1>
      </header>

      <main className="flex-col items-center p-8" style={{ flex: 1 }}>
        <div style={{ maxWidth: '800px', width: '100%' }}>
          <div className="flex-col items-center mb-10">
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800, textAlign: 'center', marginBottom: '16px', letterSpacing: '-1px' }}>
              Free Resume Evaluation
            </h2>
            <p style={{ color: '#94a3b8', textAlign: 'center', fontSize: '1.125rem', maxWidth: '600px', lineHeight: 1.5 }}>
              Paste a Job Description and a Candidate CV. Our AI will extract key data, score the match, and generate a client-ready brief in 5 seconds.
            </p>
          </div>

          <div style={{ background: '#1e293b', padding: '36px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            {error && <div className="p-4 mb-6 rounded-lg flex-row gap-2 items-center" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <span style={{ fontWeight: 600 }}>Error:</span> {error}
            </div>}

            <form onSubmit={handleSubmit} className="flex-col gap-6">
              
              <div className="flex-col gap-2">
                <label style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} color="#3b82f6" /> 1. Paste the Job Description
                </label>
                <textarea 
                  required 
                  value={jobDescription} 
                  onChange={e => setJobDescription(e.target.value)} 
                  placeholder="Paste the full job requirements here..." 
                  style={{ width: '100%', height: '140px', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#f8fafc', resize: 'vertical', fontSize: '0.95rem', lineHeight: 1.5, outline: 'none' }} 
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>

              <div className="flex-col gap-2">
                <label style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Upload size={18} color="#10b981" /> 2. Paste the Candidate's Resume
                </label>
                <textarea 
                  required 
                  value={cvText} 
                  onChange={e => setCvText(e.target.value)} 
                  placeholder="Paste the raw text of the candidate's CV here..." 
                  style={{ width: '100%', height: '160px', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#f8fafc', resize: 'vertical', fontSize: '0.95rem', lineHeight: 1.5, outline: 'none' }} 
                  onFocus={(e) => e.target.style.borderColor = '#10b981'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>

              <div className="flex-col gap-2 mt-4 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <label style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>Where should we send the final evaluation?</label>
                <input 
                  type="email" 
                  required 
                  value={customerEmail} 
                  onChange={e => setCustomerEmail(e.target.value)} 
                  placeholder="your.email@agency.com" 
                  style={{ width: '100%', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#f8fafc', fontSize: '1rem', outline: 'none' }} 
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>

              <button 
                type="submit" 
                disabled={isSubmitting} 
                style={{ 
                  width: '100%', padding: '18px', borderRadius: '8px', background: isSubmitting ? '#2563eb' : '#3b82f6', color: '#fff', 
                  fontSize: '1.125rem', fontWeight: 600, border: 'none', cursor: isSubmitting ? 'not-allowed' : 'pointer', marginTop: '16px', 
                  display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
                  opacity: isSubmitting ? 0.8 : 1, boxShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.39)',
                  transition: 'all 0.2s ease'
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Analyzing Match...
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    Generate Instant Brief
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default RecruiterIntake;
