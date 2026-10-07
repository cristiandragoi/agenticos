import { assertExecutionActive } from '../taskGraph/ExecutionIdentity.js';
import { authorizeToolDispatch, toolScopeHash } from '../taskGraph/ToolAuthorization.js';

const methods = ['goto','title','url','evaluate','locator','getByRole','getByText','getByLabel','fill','click','press',
 'waitForSelector','waitForLoadState','screenshot','content','isClosed','bringToFront','context','pages','contexts',
 'newPage','newCDPSession','send','close','frames','mainFrame','waitForTimeout','waitForFunction','waitForURL',
 'selectOption','setInputFiles','count','first','nth','last','innerText','textContent','getAttribute','isVisible',
 'isEnabled','inputValue','scrollIntoViewIfNeeded','allTextContents','all','waitFor'];

/** Explicit facade, not a Proxy: descriptors and prototypes cannot expose raw handles. */
export function leaseBrowserHandle(handle: any, sessionIsCurrent:()=>boolean, resource='page'): any {
 const owner=assertExecutionActive();
 const cache=new WeakMap<object,any>();
 const check=()=>{
  if(assertExecutionActive()!==owner || !sessionIsCurrent())throw new Error('BROWSER_HANDLE_OWNERSHIP_MISMATCH');
 };
 const wrap=(value:any, location:string):any=>{
  if(value===null || value===undefined || ['string','number','boolean'].includes(typeof value))return value;
  if(Buffer.isBuffer(value))return Buffer.from(value);
  if(Array.isArray(value))return Object.freeze(value.map((item,index)=>wrap(item,`${location}[${index}]`)));
  if(typeof value!=='object')throw new Error('BROWSER_HANDLE_RESULT_UNSUPPORTED');
  if(cache.has(value))return cache.get(value);
  const exposed=methods.filter(name=>typeof value[name]==='function');
  if(!exposed.length){
   if(Object.getPrototypeOf(value)!==Object.prototype)throw new Error('BROWSER_HANDLE_RESULT_UNSUPPORTED');
   return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,wrap(item,`${location}.${key}`)])));
  }
  const facade=Object.create(null);cache.set(value,facade);
  for(const name of exposed) Object.defineProperty(facade,name,{enumerable:true,value:(...args:any[])=>{
   check();
   // Functions, callbacks, undefined and opaque objects have no serializable approved scope.
   authorizeToolDispatch(`browser.handle.${name}`,{handle:location,arguments:args});
   const childLocation=`${location}.${name}:${toolScopeHash({arguments:args})}`;
   const result=value[name](...args);
   if(result && typeof result.then==='function')return result.then((resolved:any)=>{check();return wrap(resolved,childLocation);});
   check();return wrap(result,childLocation);
  }});
  return Object.freeze(facade);
 };
 return wrap(handle,resource);
}
