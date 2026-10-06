// @ts-nocheck — migrated unchanged JS assertions; exercised by Vitest.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {identitySchema,specimen,validateIdentity,digest,canonical,SyntheticIdentityModel} from '../../../scripts/contracts/phase1-runtime-identity.mjs';
const other=digest('fixture','different');
test('matching synthetic identity gives only SYNTHETIC_MATCH',()=>{const v=specimen(),m=new SyntheticIdentityModel(v),p=m.evaluate(m.syntheticMeasurement(v));assert.equal(p.state,'SYNTHETIC_MATCH');assert.equal(m.proofCurrent(p),true);});
for(const [name,change] of [
  ['stale build',v=>v.build.fingerprint=other],['substituted executable',v=>v.executable.contentHash=other],
  ['missing module',v=>{v.modules.pop();v.moduleSetHash=digest('AgenticOS/ModuleSet/v1',v.modules);}],
  ['additional module',v=>{v.modules.push({moduleId:'unexpected',contentHash:other});v.moduleSetHash=digest('AgenticOS/ModuleSet/v1',v.modules);}],
  ['changed configuration',v=>v.configuration.effectiveHash=other],['changed permissions',v=>v.effectivePermissions.descriptorHash=other],
  ['changed privileges',v=>v.effectivePermissions.privilegeSetHash=other],['changed scope',v=>v.effectivePermissions.resourceScopeHash=other],
  ['wrong worker identity',v=>v.runtime.workerId='other-worker'],['wrong OS principal',v=>v.osPrincipal.principalId='other-principal'],
  ['wrong logon session',v=>v.osPrincipal.logonSessionId='other-session'],['wrong incarnation',v=>v.runtime.incarnation='other-incarnation'],
  ['source versus installed confusion',v=>v.acceptanceLayer='INSTALLED'],['source versus production confusion',v=>v.acceptanceLayer='PRODUCTION'],
  ['different source tree',v=>v.source.treeHash=other],['different revision',v=>v.source.revision='other-revision'],
  ['wrong policy version',v=>v.policy.version++],['wrong manifest version',v=>v.manifest.version++],
  ['wrong manifest hash',v=>v.manifest.contentHash=other],['wrong boot epoch',v=>v.runtime.bootEpoch='new-boot'],
  ['missing provenance',v=>delete v.provenance]
])test(`${name}: reject and invalidate`,()=>{
  const original=specimen(),m=new SyntheticIdentityModel(original),v=structuredClone(original);change(v);
  assert.equal(m.evaluate(m.syntheticMeasurement(v)).state,'REJECTED');assert.equal(m.invalidated(),true);
  assert.equal(m.evaluate(m.syntheticMeasurement(original)).state,'REJECTED');
});
test('revoked trust cannot restore old proof',()=>{const v=specimen(),m=new SyntheticIdentityModel(v),p=m.evaluate(m.syntheticMeasurement(v));m.revoke();assert.equal(m.proofCurrent(p),false);assert.equal(m.evaluate(m.syntheticMeasurement(v)).state,'REJECTED');});
test('restoring bytes never resurrects evidence for invalidated incarnation',()=>{const v=specimen(),m=new SyntheticIdentityModel(v),p=m.evaluate(m.syntheticMeasurement(v)),bad=structuredClone(v);bad.build.fingerprint=other;m.evaluate(m.syntheticMeasurement(bad));assert.equal(m.proofCurrent(p),false);assert.equal(m.evaluate(m.syntheticMeasurement(v)).state,'REJECTED');});
test('supervisor-looking plain object cannot supply provenance',()=>{const v=specimen(),m=new SyntheticIdentityModel(v);assert.equal(m.evaluate(v).reason,'PROVENANCE_UNAUTHENTICATED');});
test('mutating sealed measurement invalidates provenance',()=>{const v=specimen(),m=new SyntheticIdentityModel(v),e=m.syntheticMeasurement(v);e.configuration.effectiveHash=other;assert.equal(m.evaluate(e).reason,'PROVENANCE_UNAUTHENTICATED');});
test('policy change invalidates previous proofs',()=>{const v=specimen(),m=new SyntheticIdentityModel(v),p=m.evaluate(m.syntheticMeasurement(v));m.updatePolicy(2,2);assert.equal(m.proofCurrent(p),false);assert.equal(m.evaluate(m.syntheticMeasurement(v)).state,'REJECTED');});
test('policy rollback and unchanged trust epoch rejected',()=>{const m=new SyntheticIdentityModel(specimen());assert.throws(()=>m.updatePolicy(1,1));assert.throws(()=>m.updatePolicy(2,1));});
test('proof cannot be copied or transferred between synthetic verifiers',()=>{const v=specimen(),a=new SyntheticIdentityModel(v),b=new SyntheticIdentityModel(v),p=a.evaluate(a.syntheticMeasurement(v));assert.equal(a.proofCurrent({...p}),false);assert.equal(b.proofCurrent(p),false);});
function requiredPaths(schema,prefix=[]){return schema.type==='object'?Object.entries(schema.fields).flatMap(([k,s])=>[[...prefix,k],...requiredPaths(s,[...prefix,k])]):[];}
for(const path of requiredPaths(identitySchema))test(`required field ${path.join('.')}`,()=>{const v=specimen();let parent=v;for(const k of path.slice(0,-1))parent=parent[k];delete parent[path.at(-1)];assert.throws(()=>validateIdentity(v));});
for(const [name,change] of [
  ['unknown field',v=>v.enroll=true],['nested unknown field',v=>v.runtime.execute='x'],
  ['unsupported schema',v=>v.schemaVersion=2],['malformed hash',v=>v.source.treeHash='bad'],
  ['oversized ID',v=>v.runtime.workerId='x'.repeat(129)],['null principal',v=>v.osPrincipal=null],
  ['fractional version',v=>v.policy.version=1.5],['zero version',v=>v.manifest.version=0],
  ['duplicate module',v=>v.modules.push(v.modules[0])],['unsorted modules',v=>v.modules.reverse()],
  ['empty module inventory',v=>v.modules=[]],['oversized module inventory',v=>v.modules=Array(129).fill(v.modules[0])],
  ['wrong boolean type',v=>v.source.dirty='true'],['invented acceptance layer',v=>v.acceptanceLayer='VERIFIED']
])test(`schema rejects ${name}`,()=>{const v=specimen();change(v);assert.throws(()=>validateIdentity(v));});
test('canonical record identity ignores property insertion order and separates hash domains',()=>{const v=specimen(),r=Object.fromEntries(Object.entries(v).reverse());assert.equal(canonical(v),canonical(r));assert.notEqual(digest('one',v),digest('two',v));});
