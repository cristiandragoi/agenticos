// Phase 1 SPECIFICATION FIXTURE ONLY. No app imports, OS inspection, keys or runtime enrollment.
import { createHash } from 'node:crypto';
const id={type:'pattern',pattern:/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/};
const hash={type:'pattern',pattern:/^[a-f0-9]{64}$/};
const positive={type:'integer',min:1,max:2147483647};
const obj=fields=>({type:'object',fields});
export const identitySchema=obj({schemaVersion:{type:'enum',values:[1]},
  source:obj({revision:id,treeHash:hash,dirty:{type:'boolean'}}),
  build:obj({fingerprint:hash,recipeHash:hash,toolchainHash:hash}),
  executable:obj({artifactId:id,contentHash:hash}),
  modules:{type:'array',max:128,item:obj({moduleId:id,contentHash:hash})},
  moduleSetHash:hash,configuration:obj({effectiveHash:hash,schemaVersion:positive}),
  runtime:obj({incarnation:id,bootEpoch:id,workerId:id,role:{type:'enum',values:['WORKER','SUPERVISOR','VERIFIER']}}),
  osPrincipal:obj({principalId:id,logonSessionId:id,tokenIdentityHash:hash}),
  effectivePermissions:obj({descriptorHash:hash,privilegeSetHash:hash,resourceScopeHash:hash}),
  policy:obj({reference:id,version:positive,trustEpoch:positive}),
  manifest:obj({id:id,version:positive,contentHash:hash}),
  acceptanceLayer:{type:'enum',values:['SOURCE','DEVELOPMENT','INSTALLED','PRODUCTION']},
  provenance:obj({authorityId:id,statementHash:hash,kind:{type:'enum',values:['SYNTHETIC_FIXTURE']}})});
function sorted(v){return Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;}
export const canonical=v=>JSON.stringify(sorted(v));
export const digest=(domain,v)=>createHash('sha256').update(domain+'\0').update(canonical(v)).digest('hex');
function check(s,v){
  if(s.type==='object'){
    if(!v||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw Error('OBJECT');
    if(Object.keys(v).length!==Object.keys(s.fields).length||Object.keys(v).some(k=>!Object.hasOwn(s.fields,k)))throw Error('FIELDS');
    for(const [k,t] of Object.entries(s.fields))check(t,v[k]);
  }else if(s.type==='array'){
    if(!Array.isArray(v)||!v.length||v.length>s.max)throw Error('ARRAY');v.forEach(x=>check(s.item,x));
  }else if(s.type==='pattern'){if(typeof v!=='string'||!s.pattern.test(v))throw Error('PATTERN');
  }else if(s.type==='integer'){if(!Number.isSafeInteger(v)||v<s.min||v>s.max)throw Error('INTEGER');
  }else if(s.type==='enum'){if(!s.values.includes(v))throw Error('ENUM');
  }else if(s.type==='boolean'){if(typeof v!=='boolean')throw Error('BOOLEAN');}
}
export function validateIdentity(v){
  check(identitySchema,v);
  if(Buffer.byteLength(canonical(v),'utf8')>65536)throw Error('SIZE');
  const ids=v.modules.map(m=>m.moduleId);
  if(new Set(ids).size!==ids.length||canonical(ids)!==canonical([...ids].sort()))throw Error('MODULE_ORDER');
  if(v.moduleSetHash!==digest('AgenticOS/ModuleSet/v1',v.modules))throw Error('MODULE_HASH');
  return v;
}
export function specimen(){
  const h=digest('fixture','reviewed'), modules=[{moduleId:'entry',contentHash:h},{moduleId:'library',contentHash:h}];
  return {schemaVersion:1,source:{revision:'fixture-revision',treeHash:h,dirty:true},
    build:{fingerprint:h,recipeHash:h,toolchainHash:h},executable:{artifactId:'fixture-executable',contentHash:h},
    modules,moduleSetHash:digest('AgenticOS/ModuleSet/v1',modules),configuration:{effectiveHash:h,schemaVersion:1},
    runtime:{incarnation:'runtime-1',bootEpoch:'boot-1',workerId:'worker-1',role:'WORKER'},
    osPrincipal:{principalId:'test-principal',logonSessionId:'session-1',tokenIdentityHash:h},
    effectivePermissions:{descriptorHash:h,privilegeSetHash:h,resourceScopeHash:h},
    policy:{reference:'policy-1',version:1,trustEpoch:1},manifest:{id:'manifest-1',version:1,contentHash:h},
    acceptanceLayer:'SOURCE',provenance:{authorityId:'synthetic-authority',statementHash:h,kind:'SYNTHETIC_FIXTURE'}};
}
// This model is solely a synthetic oracle, not a protected policy store or actual verifier.
export class SyntheticIdentityModel {
  #expected; #seal=new WeakMap(); #invalid=new Set(); #revoked=false; #proofs=new WeakMap(); #generation=1;
  constructor(expected){validateIdentity(expected);this.#expected=structuredClone(expected);}
  syntheticMeasurement(value){const copy=structuredClone(value);this.#seal.set(copy,canonical(copy));return copy;}
  revoke(){this.#revoked=true;this.#invalid.add(this.#expected.runtime.incarnation);this.#generation++;}
  updatePolicy(version,trustEpoch){
    if(!Number.isSafeInteger(version)||!Number.isSafeInteger(trustEpoch)||version<=this.#expected.policy.version||trustEpoch<=this.#expected.policy.trustEpoch)throw Error('ROLLBACK_OR_INVALID_VERSION');
    this.#invalid.add(this.#expected.runtime.incarnation);this.#generation++;
    this.#expected.policy.version=version;this.#expected.policy.trustEpoch=trustEpoch;
  }
  evaluate(value){
    const incarnation=this.#expected.runtime.incarnation;
    const deny=reason=>{this.#invalid.add(incarnation);this.#generation++;return {state:'REJECTED',reason};};
    if(this.#invalid.has(incarnation))return deny('INCARNATION_INVALIDATED');
    if(this.#revoked)return deny('TRUST_REVOKED');
    try{validateIdentity(value);}catch{return deny('SCHEMA_INVALID');}
    if(this.#seal.get(value)!==canonical(value))return deny('PROVENANCE_UNAUTHENTICATED');
    if(canonical(value)!==canonical(this.#expected))return deny('IDENTITY_MISMATCH');
    const proof=Object.freeze({state:'SYNTHETIC_MATCH',incarnation,identityHash:digest('AgenticOS/RuntimeIdentity/v1',value)});
    this.#proofs.set(proof,this.#generation);return proof;
  }
  proofCurrent(proof){return this.#proofs.get(proof)===this.#generation&&!this.#revoked&&!this.#invalid.has(this.#expected.runtime.incarnation);}
  invalidated(){return this.#invalid.has(this.#expected.runtime.incarnation);}
}
