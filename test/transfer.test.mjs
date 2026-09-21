import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransfer, validateCapture, isBankSender } from '../src/background/transfer.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;
const capture = () => ({institution:'co-bancolombia',product:'deposit',number:'0000001234',from:'2026-09-01',to:'2026-09-01',complete:false,items:[{booking_date:'2026-09-01',description:'Bus fare',reference:null,original_amount:'3000.00',original_currency:'COP',direction:'outgoing',status:'completed',timezone:'America/Bogota'}]});
function fixture() {
  const sessionStore={},localStore={},requests=[];
  const area=store=>({get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,values)});
  const chrome={tabs:{query:async()=>[{id:7}]},storage:{session:area(sessionStore),local:area(localStore)},runtime:{getManifest:()=>({version:'0.12.0'})}};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-jwt',expires_at:Date.now()/1000+3600,user:{id:'user'}}}})}};
  const entities=[{id:'entity',accounts:[{id:'account',name:'Checking',currency:'COP'}],cards:[]}];
  const api=async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>url.endsWith('/context') ? {entities} : url.endsWith('/bindings') ? {id:'binding'} : {id:'11111111-2222-4333-8444-555555555555',status:'queued'}};};
  return {transfer:createTransfer({chrome,getClient:async()=>client,apiBase:'https://api.example.test/extension',fetcher:api}),requests,sessionStore,localStore};
}
test('bank sender must be same extension, top frame, HTTPS and genuine hostname',()=>{
  const runtime={id:'extension'}; const sender={id:'extension',frameId:0,tab:{id:7},url:'https://svpersonas.apps.bancolombia.com/home'};
  assert.ok(isBankSender(sender,runtime));
  for(const change of [{frameId:1},{id:'other'},{tab:undefined},{url:'https://bancolombia.com.evil.test'},{url:'http://bancolombia.com'}]) assert.equal(isBankSender({...sender,...change},runtime),false);
});
test('capture allows normalized evidence only, never secrets or arbitrary fields',()=>{
  assert.equal(validateCapture(capture()).items.length,1);
  for(const value of [{...capture(),headers:{Authorization:'secret'}},{...capture(),items:[{...capture().items[0],cookie:'secret'}]},{...capture(),items:Array(501).fill(capture().items[0])},{...capture(),items:[{...capture().items[0],original_amount:3000}]}]) assert.throws(()=>validateCapture(value));
});
test('staging sends no network request and stores no full account number',async()=>{
  const f=fixture();assert.deepEqual(await f.transfer.stage(capture(),7),{staged:true});
  assert.equal(f.requests.length,0);assert.equal(JSON.stringify(f.sessionStore).includes('0000001234'),false);
  const state=await f.transfer.handle({type:'transfer.context'});
  assert.equal(state.capture.count,1);assert.equal(state.capture.last4,'1234');assert.equal('items' in state.capture,false);
});
test('trusted send chooses an authorized target and delivers one exact envelope',async()=>{
  const f=fixture();await f.transfer.stage(capture(),7);
  const {capture:current}=await f.transfer.handle({type:'transfer.context'});
  await f.transfer.handle({type:'transfer.send',capture_id:current.id,entity_id:'entity',account_id:'account',card_id:null});
  const send=f.requests.find(r=>r.url.endsWith('/imports'));const body=JSON.parse(send.init.body);
  assert.equal(body.entity_id,'entity');assert.equal(body.account_id,'account');assert.equal('binding_id' in body,false);assert.equal(f.requests.some(r=>r.url.endsWith('/bindings')),false);
  assert.equal(body.items[0].original_amount,'3000.00');assert.equal(body.capture_id,current.id);assert.equal(body.coverage.complete,false);
  assert.equal(send.init.credentials,'omit');assert.equal(send.init.redirect,'error');assert.equal(send.init.headers.Authorization,'Bearer synthetic-jwt');
  assert.ok(f.localStore['extension-import:user'].job);
});
test('stale captures, unknown destinations and arbitrary routes cannot submit',async()=>{
  const f=fixture();await f.transfer.stage(capture(),7);const state=await f.transfer.handle({type:'transfer.context'});
  await assert.rejects(f.transfer.handle({type:'transfer.send',capture_id:'old',entity_id:'entity',account_id:'account'}),/capture_changed/);
  await assert.rejects(f.transfer.handle({type:'transfer.send',capture_id:state.capture.id,entity_id:'other',account_id:'account'}),/invalid_destination/);
  await assert.rejects(f.transfer.handle({type:'transfer.send',capture_id:state.capture.id,entity_id:'entity',account_id:'account',url:'https://evil.test'}),/invalid_message/);
  assert.equal(f.requests.some(r=>r.url.endsWith('/imports')),false);
});
test('two identical occurrences receive different item keys',async()=>{
  const f=fixture();const value=capture();value.items.push({...value.items[0]});await f.transfer.stage(value,7);
  const staged=f.sessionStore['capture:7'];assert.equal(staged.items.length,2);assert.notEqual(staged.items[0].item_key,staged.items[1].item_key);
});

test('remembered destination is user scoped and is never an authorization grant',async()=>{
 const f=fixture();await f.transfer.stage(capture(),7);const state=await f.transfer.handle({type:'transfer.context'},7);
 await f.transfer.handle({type:'transfer.send',capture_id:state.capture.id,entity_id:'entity',account_id:'account',card_id:null},7);
 assert.equal((await f.transfer.handle({type:'transfer.context'},7)).selection.account_id,'account');
 await assert.rejects(f.transfer.handle({type:'transfer.send',capture_id:state.capture.id,entity_id:'entity',account_id:'foreign',card_id:null},7),/invalid_destination/);
 assert.equal((await f.transfer.handle({type:'transfer.context'},8)).capture,null);
});
