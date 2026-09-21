(() => {
  const {t}=globalThis.ClatriI18n;
  const el=id=>document.getElementById(id);
  let state=null, signedIn=false, busy=false, timer=null, generation=0;
  const errors={auth_unavailable:'We couldn’t load your Clatri accounts. Try again in a moment.',sign_in_required:'Sign in again to continue.',capture_changed:'The bank selection changed. Refresh before sending.',destination_conflict:'This bank account is already linked to another destination in this entity.',import_busy:'Another import is in progress. Try again shortly.',import_unavailable:'We couldn’t load your Clatri accounts. Try again in a moment.'};
  async function message(type, data={}) {
    const response=await chrome.runtime.sendMessage({type,...data});
    if (!response?.ok) throw new Error(response?.error || 'import_unavailable');
    return response.result;
  }
  function status(text) { el('transfer-status').textContent=text; }
  function options(node,items,placeholder) {
    node.replaceChildren(new Option(t(placeholder),''));
    for(const item of items) node.add(new Option(item.name+(item.currency ? ' · '+item.currency : ''),item.id));
  }
  function destinations() {
    const entity=state?.entities.find(e=>e.id===el('entity').value);
    const items=(state?.capture?.product==='card' ? entity?.cards : entity?.accounts) || [];
    options(el('destination-account'),items,'Choose a destination');
    el('destination-empty').hidden=!entity || items.length>0;
    el('send-transactions').disabled=true;
  }
  async function refresh() {
    if(!signedIn || busy) return;
    const version=++generation;
    status(t('Loading your Clatri accounts…'));
    try {
      const result=await message('transfer.context');
      if(version!==generation || !signedIn) return;
      state=result;
      el('destination').hidden=!state.capture;
      el('capture-summary').textContent=state.capture ? t('{count} transactions · ending {last4} · {from} to {to}',{count:state.capture.count,last4:state.capture.last4,from:state.capture.coverage.start,to:state.capture.coverage.end}) : t('In your bank, open your transactions and click “Send to Clatri”.');
      if(state.capture && !state.capture.coverage.complete) el('capture-summary').textContent+=' '+t('The bank did not confirm the end of the list. Only the received transactions will be sent.');
      options(el('entity'),state.entities,'Choose an entity');
      if(state.selection && state.entities.some(e=>e.id===state.selection.entity_id)) el('entity').value=state.selection.entity_id;
      destinations();
      const saved=state.capture?.product==='card' ? state.selection?.card_id : state.selection?.account_id;
      if(saved && [...el('destination-account').options].some(o=>o.value===saved)) {el('destination-account').value=saved;el('send-transactions').disabled=false;}
      el('destination-label').textContent=t(state.capture?.product==='card' ? 'Credit card in Clatri' : 'Bank account in Clatri');
      if(state.job) poll(state.job,version);
      else status('');
    } catch(error) { if(version===generation) {el('destination').hidden=true;status(t(errors[error.message] || errors.import_unavailable));} }
  }
  async function poll(id,version=generation) {
    clearTimeout(timer);
    try {
      const job=await message('transfer.status',{id});
      if(!signedIn || version!==generation) return;
      el('import-issues').replaceChildren();
      if(job.status==='completed') {
        status(t('{created} imported · {issues} need attention · {pending} pending at the bank',{...job.result}));
        for(const item of job.items || []) if(item.outcome==='issue' || item.outcome==='pending') {
          const li=document.createElement('li'); li.textContent=item.description+' — '+t(({possible_duplicate:'Possible duplicate; no extra movement created.',historical_fx_unavailable:'Historical exchange rate unavailable.',card_payment_or_refund:'Card payment or refund requires identification.',bank_status_not_completed:'Not yet completed at the bank.'})[item.reason] || 'This transaction needs attention.');el('import-issues').append(li);
          if(item.reason==='possible_duplicate') {
            const controls=document.createElement('div');controls.className='issue-actions';
            const distinct=document.createElement('button');distinct.className='text-button';distinct.textContent=t('Record as a separate transaction');controls.append(distinct);
            const choose=document.createElement('select');choose.setAttribute('aria-label',t('Existing transaction'));choose.add(new Option(t('Choose an existing transaction'),''));
            for(const candidate of item.candidates || []) choose.add(new Option(candidate.description || candidate.occurred_at,candidate.id));
            const link=document.createElement('button');link.className='text-button';link.textContent=t('Already in Clatri');link.disabled=true;
            choose.addEventListener('change',()=>{link.disabled=!choose.value;});
            if(item.candidates?.length){controls.append(choose);controls.append(link);}
            async function resolve(action) {
              distinct.disabled=true;link.disabled=true;
              try {await message('transfer.resolve',{id:job.id,item_key:item.item_key,expected_version:item.version,action,target_event_id:action==='same_existing' ? choose.value : null});await poll(job.id,version);}
              catch {status(t('The transaction changed. Refresh its status before retrying.'));}
            }
            distinct.addEventListener('click',()=>resolve('distinct'));link.addEventListener('click',()=>resolve('same_existing'));li.append(controls);
          }

        }
        if(job.result.classification?.startsWith('unclassified')) status(el('transfer-status').textContent+' '+t('Automatic categorization was unavailable.'));
      } else if(['failed','cancelled'].includes(job.status)) status(t('The import could not be completed.'));
      else { status(t('Received by Clatri. Processing transactions…'));timer=setTimeout(()=>poll(id,version),2500); }
    } catch(error) { if(version===generation) status(t(errors[error.message] || errors.import_unavailable)); }
  }
  el('entity').addEventListener('change',destinations);
  el('destination-account').addEventListener('change',()=>{el('send-transactions').disabled=busy || !el('destination-account').value;});
  el('refresh-transfer').addEventListener('click',refresh);
  el('send-transactions').addEventListener('click',async()=>{
    if(busy || !state?.capture || !el('entity').value || !el('destination-account').value) return;
    busy=true;el('send-transactions').disabled=true;el('entity').disabled=true;el('destination-account').disabled=true;
    const version=generation;
    status(t('Sending transactions…'));
    try {
      const job=await message('transfer.send',{capture_id:state.capture.id,entity_id:el('entity').value,account_id:state.capture.product==='deposit' ? el('destination-account').value : null,card_id:state.capture.product==='card' ? el('destination-account').value : null});
      if(version===generation) await poll(job.id,version);
    } catch(error) { if(version===generation) status(t(errors[error.message] || errors.import_unavailable)); }
    finally {busy=false;el('send-transactions').disabled=false;el('entity').disabled=false;el('destination-account').disabled=false;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && Object.keys(changes).some(k=>k.startsWith('capture:'))) refresh();});
  globalThis.ClatriTransfer={authChanged(value){signedIn=value;generation++;clearTimeout(timer);if(value) refresh();else {state=null;el('destination').hidden=true;el('import-issues').replaceChildren();status('');}}};
})();
