/** Out-of-band approval protocol prototype. Public-key verification only; no production enrollment. */
import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';
import type Database from 'better-sqlite3';
export interface ApprovalBinding {
  goalId: string; graphId: string; nodeId: string; workerId: string;
  operation: string; attempt: number; tool: string; scopeHash: string; argumentHash: string; previewHash: string;
}
export interface ApprovalPayload extends ApprovalBinding {
  version: 1; issuer: string; nonce: string; issuedAt: number; expiresAt: number; secondConfirmation: true;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value)===Object.prototype)
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  throw new Error('APPROVAL_INVALID_PAYLOAD');
}
export function approvalHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
const fields=['goalId','graphId','nodeId','workerId','operation','tool','scopeHash','argumentHash','previewHash'];
function validateBinding(binding: ApprovalBinding): void {
  if (Object.keys(binding).sort().join() !== [...fields,'attempt'].sort().join() ||
    fields.some(k=>typeof (binding as any)[k] !== 'string' || !(binding as any)[k] || (binding as any)[k].length>4096) ||
    !Number.isSafeInteger(binding.attempt) || binding.attempt<1) throw new Error('APPROVAL_INVALID_BINDING');
}
export class ApprovalVerifier {
  constructor(private db: Database.Database, private publicKey: () => KeyObject | undefined) {
    db.exec(`CREATE TABLE IF NOT EXISTS supervisor_approval_nonces (
      nonce TEXT PRIMARY KEY, binding TEXT NOT NULL, deadline INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)`);
  }
  challenge(binding: ApprovalBinding, now=Date.now()): {nonce:string; expiresAt:number} {
    validateBinding(binding);
    const nonce=randomBytes(32).toString('hex'), expiresAt=now+60000;
    try { this.db.prepare('INSERT INTO supervisor_approval_nonces(nonce,binding,deadline) VALUES (?,?,?)').run(nonce,canonical(binding),expiresAt); }
    catch { throw new Error('APPROVAL_SERVICE_UNAVAILABLE'); }
    return {nonce,expiresAt};
  }
  revoke(nonce: string): void {
    try { this.db.prepare('UPDATE supervisor_approval_nonces SET revoked=1 WHERE nonce=?').run(nonce); }
    catch { throw new Error('APPROVAL_SERVICE_UNAVAILABLE'); }
  }
  consume(payload: ApprovalPayload, signature: string, expected: ApprovalBinding, now=Date.now()): void {
    validateBinding(expected);
    const {version,issuer,nonce,issuedAt,expiresAt,secondConfirmation,...binding}=payload;
    validateBinding(binding);
    if (version!==1 || issuer!=='agenticos-interactive-issuer' || secondConfirmation!==true ||
        !/^[0-9a-f]{64}$/.test(nonce) || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
        issuedAt>now || expiresAt<=now || expiresAt<=issuedAt || expiresAt-issuedAt>60000)
      throw new Error('APPROVAL_INVALID_OR_EXPIRED');
    if (canonical(binding)!==canonical(expected)) throw new Error('APPROVAL_BINDING_MISMATCH');
    let key: KeyObject | undefined;
    try { key=this.publicKey(); } catch { throw new Error('APPROVAL_KEY_UNAVAILABLE'); }
    const ed25519=key?.asymmetricKeyType==='ed25519';
    const es256=key?.asymmetricKeyType==='ec' && key.asymmetricKeyDetails?.namedCurve==='prime256v1';
    if (!key || key.type!=='public' || (!ed25519 && !es256)) throw new Error('APPROVAL_KEY_UNAVAILABLE');
    if (!/^[A-Za-z0-9+/]{86}==$/.test(signature) || !verify(ed25519?null:'sha256',Buffer.from(canonical(payload)),
      es256?{key,dsaEncoding:'ieee-p1363'}:key,Buffer.from(signature,'base64')))
      throw new Error('APPROVAL_SIGNATURE_INVALID');
    try {
      this.db.transaction(()=>{
        const row=this.db.prepare('SELECT * FROM supervisor_approval_nonces WHERE nonce=?').get(nonce) as any;
        if (!row || row.binding!==canonical(expected) || row.deadline<expiresAt || row.deadline<=now || row.consumed || row.revoked)
          throw new Error('APPROVAL_NONCE_REPLAY_REVOKED_OR_EXPIRED');
        const result=this.db.prepare('UPDATE supervisor_approval_nonces SET consumed=1 WHERE nonce=? AND consumed=0 AND revoked=0').run(nonce);
        if (result.changes!==1) throw new Error('APPROVAL_REPLAY');
      })();
    } catch(error) {
      if(error instanceof Error && error.message.startsWith('APPROVAL_')) throw error;
      throw new Error('APPROVAL_SERVICE_UNAVAILABLE');
    }
  }
}
