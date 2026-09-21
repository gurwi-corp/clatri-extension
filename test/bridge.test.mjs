import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const clicks={},listeners={},sent=[],frames=[];let release;
 const slot={replaceChildren(){frames.length=0;},append(f){frames.push(f);}};
 const context={Date,Promise,navigator:{language:'es'},location:{origin:'https://bank.bancolombia.com'},document:{documentElement:{dataset:{}},addEventListener:(t,f)=>clicks[t]=f,createElement:()=>({style:{}}),getElementById:()=>({shadowRoot:{getElementById:id=>id==='transfer-slot'?slot:frames[0]}})},chrome:{i18n:{getUILanguage:()=> 'es'},runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener(){}},sendMessage:async m=>{sent.push(m);if(m.type==='bank.prepare')return new Promise(r=>release=r);return {ok:true};}}}};
 context.window=context;context.addEventListener=(t,f)=>listeners[t]=f;context.postMessage=()=>{};
 vm.createContext(context);vm.runInContext(code,context);
 const win=vm.runInContext("window",context);
 return {sent,frames,release:()=>release({ok:true,url:'chrome-extension://ext/bank-transfer.html?token=mock'}),click:()=>clicks.click({isTrusted:true,target:{id:'clatri-root'}}),send:channel=>listeners.message({source:win,origin:context.location.origin,data:{channel,capture:{}}})};
}
test('opens destination frame before staging finishes and preserves it after staging',async()=>{
 const f=fixture();f.click();f.send('clatri-prepare-transfer');await tick();
 f.send('clatri-stage-transfer');assert.equal(f.sent.length,1);
 f.release();await tick();assert.equal(f.frames.length,1);assert.deepEqual(f.sent.map(m=>m.type),['bank.prepare','bank.stage']);
});
test('selection change while preparation is pending cannot open a stale frame',async()=>{
 const f=fixture();f.click();f.send('clatri-prepare-transfer');await tick();
 f.send('clatri-clear-transfer');f.release();await tick();
 assert.equal(f.frames.length,0);assert.equal(f.sent.at(-1).type,'bank.clear');
});
