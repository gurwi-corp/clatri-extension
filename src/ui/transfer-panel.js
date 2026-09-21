(() => {
  const {t}=globalThis.ClatriI18n;
  const kit=globalThis.ClatriKit;
  const el=id=>document.getElementById(id);
  let state=null, signedIn=false, busy=false, timer=null, generation=0;
  const errors={auth_unavailable:'We couldn’t load your Clatri accounts. Try again in a moment.',sign_in_required:'Sign in again to continue.',capture_changed:'The bank selection changed. Refresh before sending.',destination_conflict:'This bank account is already linked to another destination in this entity.',import_busy:'Another import is in progress. Try again shortly.',import_unavailable:'We couldn’t load your Clatri accounts. Try again in a moment.'};
  const reasons={possible_duplicate:'Possible duplicate; no extra movement created.',historical_fx_unavailable:'Historical exchange rate unavailable.',card_payment_or_refund:'Card payment or refund requires identification.',bank_status_not_completed:'Not yet completed at the bank.'};
  async function message(type, data={}) {
    const response=await chrome.runtime.sendMessage({type,...data});
    if (!response?.ok) throw new Error(response?.error || 'import_unavailable');
    return response.result;
  }
  function status(text,tone='') { el('transfer-status').textContent=text; el('transfer-status').className='msg'+(tone ? ' '+tone : ''); }
  const fail=error=>status(t(errors[error.message] || errors.import_unavailable),'error');

  // Same picker as the bank panel: `node.value` plus a "change" event. Nothing
  // is preselected unless it is the only choice, so a destination is never a guess.
  const choices=items=>items.map(item=>({value:item.id,label:item.name,hint:item.currency || ''}));
  function options(node,items,value,placeholder,labelledby) {
    kit.picker.fill(node,choices(items),value || (items.length===1 ? items[0].id : ''),{placeholder:t(placeholder),autoSelect:false,disabled:busy,labelledby});
  }
  const canSend=()=>!busy && Boolean(state?.capture?.count && el('entity').value && el('destination-account').value);
  function destinations(saved) {
    const entity=state?.entities.find(e=>e.id===el('entity').value);
    const items=(state?.capture?.product==='card' ? entity?.cards : entity?.accounts) || [];
    options(el('destination-account'),items,items.some(item=>item.id===saved) ? saved : '','Choose a destination','destination-label');
    el('destination-empty').hidden=!entity || items.length>0;
    el('send-transactions').disabled=!canSend();
  }
  function lock(flag) {
    busy=flag;
    kit.picker.disable(el('entity'),flag);kit.picker.disable(el('destination-account'),flag);
    el('send-transactions').disabled=!canSend();
  }
  async function refresh() {
    if(!signedIn || busy) return;
    const version=++generation;
    // Field-shaped placeholders hold the layout while the first context loads.
    el('transfer-skeleton').hidden=Boolean(state);
    if(state) status(t('Loading your Clatri accounts…')); else status('');
    try {
      const result=await message('transfer.context');
      if(version!==generation || !signedIn) return;
      const previous=state?.capture?.last4===result.capture?.last4 && state?.capture?.product===result.capture?.product ? {entity:el('entity').value,account:el('destination-account').value} : null;
      state=result;
      el('transfer-skeleton').hidden=true;
      el('destination').hidden=!state.capture;
      el('capture-summary').textContent=state.capture ? t('{count} transactions · ending {last4} · {from} to {to}',{count:state.capture.count,last4:state.capture.last4,from:state.capture.coverage.start,to:state.capture.coverage.end}) : t('In your bank, open your transactions and click “Send to Clatri”.');
      if(state.capture && !state.capture.count) el('capture-summary').textContent=t('Load your bank transactions with the button above, then choose where to send them.');
      if(state.capture?.count && !state.capture.coverage.complete) el('capture-summary').textContent+=' '+t('The bank did not confirm the end of the list. Only the received transactions will be sent.');
      const entityId=previous?.entity || state.selection?.entity_id;
      options(el('entity'),state.entities,state.entities.some(e=>e.id===entityId) ? entityId : '','Choose an entity','entity-label');
      destinations(previous?.account || (state.capture?.product==='card' ? state.selection?.card_id : state.selection?.account_id));
      el('destination-label').textContent=t(state.capture?.product==='card' ? 'Credit card in Clatri' : 'Bank account in Clatri');
      if(state.job && state.capture?.count) poll(state.job,version);
      else status('');
    } catch(error) { if(version===generation) {el('transfer-skeleton').hidden=true;el('destination').hidden=true;fail(error);} }
  }
  function issueRow(job,item,version) {
    const li=document.createElement('li');
    li.textContent=item.description+' — '+t(reasons[item.reason] || 'This transaction needs attention.');
    if(item.reason!=='possible_duplicate') return li;
    const controls=document.createElement('div');controls.className='issue-actions';
    const buttons=document.createElement('div');buttons.className='row';
    const distinct=document.createElement('button');distinct.className='ghost small';distinct.textContent=t('Record as a separate transaction');
    const link=document.createElement('button');link.className='ghost small';link.textContent=t('Already in Clatri');link.disabled=true;
    const choose=document.createElement('div');choose.className='picker';choose.setAttribute('role','group');choose.setAttribute('aria-label',t('Existing transaction'));
    kit.picker.fill(choose,(item.candidates || []).map(candidate=>({value:candidate.id,label:candidate.description || candidate.occurred_at})),'',{placeholder:t('Choose an existing transaction'),autoSelect:false});
    kit.picker.wire(choose,{grow:document.body});
    choose.addEventListener('change',()=>{link.disabled=!choose.value;});
    buttons.append(distinct);
    if(item.candidates?.length){controls.append(choose);buttons.append(link);}
    controls.append(buttons);
    async function resolve(action) {
      distinct.disabled=true;link.disabled=true;
      try {await message('transfer.resolve',{id:job.id,item_key:item.item_key,expected_version:item.version,action,target_event_id:action==='same_existing' ? choose.value : null});await poll(job.id,version);}
      catch {status(t('The transaction changed. Refresh its status before retrying.'),'error');}
    }
    distinct.addEventListener('click',()=>resolve('distinct'));link.addEventListener('click',()=>resolve('same_existing'));
    li.append(controls);
    return li;
  }
  async function poll(id,version=generation) {
    clearTimeout(timer);
    try {
      const job=await message('transfer.status',{id});
      if(!signedIn || version!==generation) return;
      el('import-issues').replaceChildren();
      if(job.status==='completed') {
        status(t('{created} imported · {issues} need attention · {pending} pending at the bank',{...job.result}),'ok');
        for(const item of job.items || []) if(item.outcome==='issue' || item.outcome==='pending') el('import-issues').append(issueRow(job,item,version));
        if(job.result.classification?.startsWith('unclassified')) status(el('transfer-status').textContent+' '+t('Automatic categorization was unavailable.'),'ok');
      } else if(['failed','cancelled'].includes(job.status)) status(t('The import could not be completed.'),'error');
      else { status(t('Received by Clatri. Processing transactions…'));timer=setTimeout(()=>poll(id,version),2500); }
    } catch(error) { if(version===generation) fail(error); }
  }
  for(const id of ['entity','destination-account']) kit.picker.wire(el(id),{grow:document.body});
  el('refresh-transfer').innerHTML=kit.icons.refresh;
  el('refresh-transfer').title=t('Refresh');el('refresh-transfer').setAttribute('aria-label',t('Refresh'));
  el('logout').insertAdjacentHTML('afterbegin',kit.icons.signOut);
  el('entity').addEventListener('change',()=>destinations());
  el('destination-account').addEventListener('change',()=>{el('send-transactions').disabled=!canSend();});
  el('refresh-transfer').addEventListener('click',refresh);
  el('send-transactions').addEventListener('click',async()=>{
    if(!canSend()) return;
    lock(true);
    const version=generation;
    status(t('Sending transactions…'));
    try {
      const job=await message('transfer.send',{capture_id:state.capture.id,entity_id:el('entity').value,account_id:state.capture.product==='deposit' ? el('destination-account').value : null,card_id:state.capture.product==='card' ? el('destination-account').value : null});
      if(version===generation) await poll(job.id,version);
    } catch(error) { if(version===generation) fail(error); }
    finally {lock(false);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && Object.keys(changes).some(k=>k.startsWith('capture:'))) refresh();});
  globalThis.ClatriTransfer={authChanged(value){signedIn=value;generation++;clearTimeout(timer);if(value) refresh();else {state=null;el('destination').hidden=true;el('transfer-skeleton').hidden=true;el('import-issues').replaceChildren();status('');}}};
})();
