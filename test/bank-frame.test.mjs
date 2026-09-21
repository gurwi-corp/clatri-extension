import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankFrames} from '../src/background/bank-frame.js';
import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
test('only the granted extension iframe in the source tab can send; clear revokes it',async()=>{
 const store={};const chrome={runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p},storage:{session:{get:async k=>({[k]:store[k]}),set:async v=>Object.assign(store,v),remove:async keys=>keys.forEach(k=>delete store[k])}}};
 const frames=createBankFrames(chrome);const url=await frames.grant(7);const sender={id:'ext',tab:{id:7},frameId:3,url};
 assert.equal(await frames.accepts(sender),true);
 for(const patch of [{id:'other'},{tab:{id:8}},{frameId:0},{url:'https://bank.test'},{url:url+'&extra=x'},{url:chrome.runtime.getURL('sidepanel.html')}]) assert.equal(await frames.accepts({...sender,...patch}),false);
 await frames.clear(7);assert.equal(await frames.accepts(sender),false);
});
