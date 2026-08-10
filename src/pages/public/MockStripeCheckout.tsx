import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Lock, ShieldCheck, Check } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

const MockStripeCheckout: React.FC = () => {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await apiFetch('/api/stripe/mock-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: leadId || 'mock-id' })
      });
      const data = await res.json();
      if (data.success) {
        navigate(`/public/deliverable/${data.artifactId}`);
      } else {
        setError(data.error || 'Payment failed');
      }
    } catch (err) {
      console.error(err);
      setError('An unexpected error occurred.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-col min-h-screen" style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
      <header className="p-4 flex-row gap-2 items-center" style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', justifyContent: 'center' }}>
        <Box size={24} color="#3b82f6" />
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>RecruitAI Secure Checkout</h1>
      </header>

      <main className="flex-row justify-center p-8 gap-8" style={{ flex: 1, maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        
        {/* Order Summary */}
        <div style={{ flex: 1, maxWidth: '400px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '24px' }}>Order Summary</h2>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
            
            <div className="flex-row justify-between items-start mb-6 pb-6" style={{ borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a' }}>Candidate Intelligence Brief</h3>
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>One-time unlock for candidate ID: {leadId}</p>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>$9.99</div>
            </div>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', color: '#334155', fontSize: '0.875rem' }}>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Check size={16} color="#10b981" /> Full Executive Summary</li>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Check size={16} color="#10b981" /> Interview Guide & Red Flags</li>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Check size={16} color="#10b981" /> Client-ready PDF Export</li>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Check size={16} color="#10b981" /> Email Outreach Template</li>
            </ul>

            <div className="flex-row justify-between items-center mt-6 pt-6" style={{ borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>Total due today</div>
              <div style={{ fontWeight: 700, fontSize: '1.5rem' }}>$9.99</div>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div style={{ flex: 1.2, maxWidth: '500px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '24px' }}>Payment Details</h2>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
            
            <div className="flex-row items-center gap-2 mb-6" style={{ color: '#64748b', fontSize: '0.875rem' }}>
              <Lock size={16} /> Secure, 256-bit encrypted checkout via Stripe.
            </div>

            <div className="flex-col gap-4 mb-8">
              <div className="flex-col gap-1">
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>Email address</label>
                <input type="email" placeholder="you@agency.com" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc' }} />
              </div>
              
              <div className="flex-col gap-1">
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>Card Information</label>
                <div style={{ display: 'flex', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden' }}>
                  <input type="text" placeholder="Card number" style={{ flex: 1, padding: '12px', border: 'none', borderRight: '1px solid #cbd5e1', background: '#f8fafc' }} />
                  <input type="text" placeholder="MM / YY" style={{ width: '80px', padding: '12px', border: 'none', borderRight: '1px solid #cbd5e1', background: '#f8fafc' }} />
                  <input type="text" placeholder="CVC" style={{ width: '70px', padding: '12px', border: 'none', background: '#f8fafc' }} />
                </div>
              </div>
              
              <div className="flex-col gap-1">
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>Name on card</label>
                <input type="text" placeholder="Name on card" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc' }} />
              </div>
            </div>

            {error && <div style={{ color: '#ef4444', background: '#fef2f2', padding: '12px', borderRadius: '6px', marginBottom: '16px', border: '1px solid #fecaca', fontSize: '0.875rem' }}>{error}</div>}

            <button 
              onClick={handlePay}
              disabled={isProcessing}
              style={{ 
                width: '100%', padding: '16px', borderRadius: '8px', 
                background: isProcessing ? '#334155' : '#0f172a', color: '#fff', 
                fontSize: '1.125rem', fontWeight: 600, border: 'none', 
                cursor: isProcessing ? 'not-allowed' : 'pointer', 
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
                transition: 'background 0.2s ease'
              }}
            >
              {isProcessing ? (
                <>
                  <div className="spinner" style={{ width: '20px', height: '20px', border: '2px solid rgba(255, 255, 255, 0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  Processing Payment...
                </>
              ) : (
                `Pay $9.99`
              )}
            </button>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px', color: '#64748b', fontSize: '0.75rem', gap: '4px', alignItems: 'center' }}>
              <ShieldCheck size={14} /> Payments are secure and encrypted.
            </div>

          </div>
        </div>

      </main>
    </div>
  );
};

export default MockStripeCheckout;

