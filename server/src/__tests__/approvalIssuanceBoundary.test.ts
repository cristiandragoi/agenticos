import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import Database from 'better-sqlite3';
import {generateKeyPairSync,sign} from 'node:crypto';
import {ApprovalVerifier,canonical,type ApprovalBinding,type ApprovalPayload} from '../domains/securitySupervisor/approvalVerifier.js';
import {issueTrustedHumanApproval,verifyAndConsumeTrustedApproval} from '../domains/controlPlane/taskGraph/TrustedHumanApprovalBridge.js';
const binding: ApprovalBinding={goalId:'g',graphId:'graph',nodeId:'n',workerId:'w',operation:'READ',attempt:1,tool:'git.status',scopeHash:'s',argumentHash:'a',previewHash:'p'};
describe('public-key out-of-band approval protocol (synthetic keys only)',()=>{
 let db:Database.Database; let verifier:ApprovalVerifier;
 const keys=generateKeyPairSync('ed25519'); const now=100000;
 beforeEach(()=>{db=new Database(':memory:');verifier=new ApprovalVerifier(db,()=>keys.publicKey);});
 afterEach(()=>{if(db.open)db.close();});
 function issue():ApprovalPayload {const challenge=verifier.challenge(binding,now);return {...binding,...challenge,version:1,issuer:'agenticos-interactive-issuer',issuedAt:now,secondConfirmation:true};}
 function signature(p:ApprovalPayload) {return sign(null,Buffer.from(canonical(p)),keys.privateKey).toString('base64');}
 it('accepts a valid signed exact binding once',()=>{const p=issue();verifier.consume(p,signature(p),binding,now);expect(()=>verifier.consume(p,signature(p),binding,now)).toThrow('NONCE_REPLAY');});
 it('rejects a different signing key',()=>{const p=issue();const other=generateKeyPairSync('ed25519');expect(()=>verifier.consume(p,sign(null,Buffer.from(canonical(p)),other.privateKey).toString('base64'),binding,now)).toThrow('SIGNATURE_INVALID');});
 it('rejects tampering',()=>{const p=issue(),sig=signature(p);p.expiresAt--;expect(()=>verifier.consume(p,sig,binding,now)).toThrow('SIGNATURE_INVALID');});
 it.each(['goalId','graphId','nodeId','workerId','operation','tool','scopeHash','argumentHash','previewHash','attempt'] as const)('rejects cross-binding substitution of %s',field=>{
  const p=issue();const changed={...binding,[field]:field==='attempt'?2:'other'};
  expect(()=>verifier.consume(p,signature(p),changed,now)).toThrow('BINDING_MISMATCH');
 });
 it('rejects a valid signature for a substituted nonce',()=>{const p=issue();p.nonce='0'.repeat(64);expect(()=>verifier.consume(p,signature(p),binding,now)).toThrow('NONCE_REPLAY');});
 it('rejects expiry at the exact boundary',()=>{const p=issue();expect(()=>verifier.consume(p,signature(p),binding,p.expiresAt)).toThrow('EXPIRED');});
 it('rejects revocation',()=>{const p=issue();verifier.revoke(p.nonce);expect(()=>verifier.consume(p,signature(p),binding,now)).toThrow('REVOKED');});
 it('rejects service failure',()=>{const p=issue();db.close();expect(()=>verifier.consume(p,signature(p),binding,now)).toThrow('SERVICE_UNAVAILABLE');});
 it('rejects unavailable keys without consuming nonce',()=>{const p=issue();const unavailable=new ApprovalVerifier(db,()=>undefined);expect(()=>unavailable.consume(p,signature(p),binding,now)).toThrow('KEY_UNAVAILABLE');verifier.consume(p,signature(p),binding,now);});
 it('rejects key provider failure',()=>{const p=issue();const broken=new ApprovalVerifier(db,()=>{throw new Error('offline');});expect(()=>broken.consume(p,signature(p),binding,now)).toThrow('KEY_UNAVAILABLE');});
 it('refuses a private signing key in the verifier',()=>{const p=issue();const bad=new ApprovalVerifier(db,()=>keys.privateKey);expect(()=>bad.consume(p,signature(p),binding,now)).toThrow('KEY_UNAVAILABLE');});
 it('persists replay denial across verifier recreation',()=>{const p=issue();verifier.consume(p,signature(p),binding,now);const next=new ApprovalVerifier(db,()=>keys.publicKey);expect(()=>next.consume(p,signature(p),binding,now)).toThrow('NONCE_REPLAY');});
 it('requires second confirmation covered by signature',()=>{const p=issue();(p as any).secondConfirmation=false;expect(()=>verifier.consume(p,signature(p),binding,now)).toThrow('INVALID');});
 it('prevents signed expiry beyond challenge deadline',()=>{const p=issue();p.issuedAt+=100;p.expiresAt+=100;expect(()=>verifier.consume(p,signature(p),binding,now+100)).toThrow('NONCE_REPLAY');});
 it('production issuance and dispatch stay disabled',()=>{expect(()=>issueTrustedHumanApproval()).toThrow('HUMAN_AUTHENTICATION_UNAVAILABLE');expect(()=>verifyAndConsumeTrustedApproval()).toThrow('HUMAN_AUTHENTICATION_UNAVAILABLE');});
});
