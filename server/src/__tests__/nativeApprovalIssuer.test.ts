import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
import Database from 'better-sqlite3';
import {ApprovalVerifier,approvalHash,canonical,type ApprovalBinding,type ApprovalPayload} from '../domains/securitySupervisor/approvalVerifier.js';
const probe=path.resolve('../.tmp/security-native/ApprovalProbe.exe');
const issuer=path.resolve('../.tmp/security-native/ApprovalIssuer.exe');
function publicKey(blob:string) {
 const bytes=Buffer.from(blob,'base64');
 expect(bytes.readUInt32LE(0)).toBe(0x31534345); // BCRYPT_ECDSA_PUBLIC_P256_MAGIC
 expect(bytes.readUInt32LE(4)).toBe(32);
 return createPublicKey({key:{kty:'EC',crv:'P-256',x:bytes.subarray(8,40).toString('base64url'),y:bytes.subarray(40,72).toString('base64url')},format:'jwk'});
}
describe('independent native issuer protocol (ephemeral keys, no human UI)',()=>{
 const now=Date.now(),preview='Read the fixture repository status';
 const args={operation:'status'},scope={repository:'fixture'};
 const binding:ApprovalBinding={goalId:'fixture-goal',graphId:'fixture-graph',nodeId:'fixture-node',workerId:'fixture-worker',
  operation:'READ',attempt:1,tool:'git.status',scopeHash:approvalHash(scope),argumentHash:approvalHash(args),previewHash:approvalHash(preview)};
 const payload:ApprovalPayload={...binding,nonce:'a'.repeat(64),version:1,issuer:'agenticos-interactive-issuer',issuedAt:now,expiresAt:now+60000,secondConfirmation:true};
 function request(p:ApprovalPayload=payload,display=preview) {return {canonical:canonical(p),preview:display,arguments:args,scope,now};}
 function run(input:unknown) {return spawnSync(probe,[],{input:JSON.stringify(input)+'\n',env:{SystemRoot:'C:\\Windows'},windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:65536});}
 it('signs exact canonical payload in a separate process with a non-exportable CNG key',()=>{
  const result=run(request());expect(result.status,result.stderr).toBe(0);
  const response=JSON.parse(result.stdout);expect(response.privateExportDenied).toBe(true);
  expect(verify('sha256',Buffer.from(canonical(payload)),{key:publicKey(response.publicBlob),dsaEncoding:'ieee-p1363'},Buffer.from(response.signature,'base64'))).toBe(true);
 });
 it('consumes a native signature with the public-key-only supervisor verifier',()=>{
  const db=new Database(':memory:');let enrolled:ReturnType<typeof publicKey> | undefined;
  try {
   const verifier=new ApprovalVerifier(db,()=>enrolled),challenge=verifier.challenge(binding,now);
   const p={...payload,...challenge};const result=run(request(p));expect(result.status,result.stderr).toBe(0);
   const response=JSON.parse(result.stdout);enrolled=publicKey(response.publicBlob); // synthetic enrollment only
   verifier.consume(p,response.signature,binding,now);
   expect(()=>verifier.consume(p,response.signature,binding,now)).toThrow('REPLAY');
  }finally{db.close();}
 });
 it.each(['preview','arguments','scope'])('refuses substituted %s before signing',field=>{
  const input={...request(),[field]:field==='preview'?'Different action':{different:true}};
  expect(run(input).status).toBe(1);
 });
 it('refuses expiry before signing',()=>expect(run(request({...payload,expiresAt:now})).status).toBe(1));
 it('refuses noncanonical or extra payload fields',()=>{
  expect(run({...request(),canonical:JSON.stringify({...payload,extra:'untrusted'})}).status).toBe(1);
 });
 it('production issuer refuses missing protected enrollment without opening UI',()=>{
  const result=spawnSync(issuer,[],{env:{SystemRoot:'C:\\Windows'},windowsHide:true,encoding:'utf8',timeout:3000});
  expect(result.status).toBe(1);expect(result.stderr).toContain('APPROVAL_ISSUANCE_REFUSED');
 });
 it('production issuer refuses caller-selected manifest without opening UI',()=>{
  const result=spawnSync(issuer,[path.resolve('package.json')],{env:{SystemRoot:'C:\\Windows'},windowsHide:true,encoding:'utf8',timeout:3000});
  expect(result.status).toBe(1);expect(result.stderr).toContain('APPROVAL_ISSUANCE_REFUSED');
 });
 it('refuses misleading bidirectional review text even with a matching hash',()=>{
  const display='Read status\u202e hidden';const p={...payload,previewHash:approvalHash(display)};
  expect(run(request(p,display)).status).toBe(1);
 });
 it('offline enrollment refuses absent manifest without generating a key',()=>{
  const result=spawnSync(path.resolve('../.tmp/security-native/ApprovalEnroll.exe'),[],{env:{SystemRoot:'C:\\Windows'},windowsHide:true,encoding:'utf8',timeout:3000});
  expect(result.status).toBe(1);expect(result.stderr).toContain('ENROLLMENT_REFUSED');
 });
});
