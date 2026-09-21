// Only the trusted extension panel can read destinations or send imports.
export const isBankSender = (sender, runtime) => {
  try { const url = new URL(sender.url); return sender.id === runtime.id && sender.tab?.id >= 0 && sender.frameId === 0 && url.protocol === 'https:' && (url.hostname === 'bancolombia.com' || url.hostname.endsWith('.bancolombia.com')); } catch { return false; }
};
const allowed = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every(k => keys.includes(k));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function validateCapture(value, allowEmpty = false) {
  if (!allowed(value, ['institution','product','number','from','to','complete','items']) || value.institution !== 'co-bancolombia' || !['deposit','card'].includes(value.product) || !text(value.number,64) || !/^[0-9 *xX-]+$/.test(value.number) || !iso(value.from) || !iso(value.to) || value.from > value.to || typeof value.complete !== 'boolean' || !Array.isArray(value.items) || (!allowEmpty && value.items.length < 1) || value.items.length > 500) throw new Error('invalid_capture');
  for (const row of value.items) {
    if (!allowed(row,['booking_date','description','reference','original_amount','original_currency','direction','status','timezone']) || !iso(row.booking_date) || row.booking_date < value.from || row.booking_date > value.to || !text(row.description,2048) || typeof row.original_amount !== 'string' || !/^[0-9]{1,16}(?:\.[0-9]{1,8})?$/.test(row.original_amount) || Number(row.original_amount) <= 0 || !/^[A-Z]{3}$/.test(row.original_currency) || !['incoming','outgoing'].includes(row.direction) || !['pending','completed'].includes(row.status) || (row.reference != null && (typeof row.reference !== 'string' || row.reference.length > 256)) || row.timezone !== 'America/Bogota') throw new Error('invalid_capture');
  }
  return value;
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function createTransfer({ chrome, getClient, apiBase, fetcher = fetch }) {
  let sending = false;
  async function user() {
    const client = await getClient();
    let { data, error } = await client.auth.getSession();
    if (error || !data?.session) throw new Error('sign_in_required');
    if (data.session.expires_at * 1000 < Date.now() + 60_000) {
      const refreshed = await client.auth.refreshSession();
      if (refreshed.error || !refreshed.data?.session) throw new Error('sign_in_required');
      data = refreshed.data;
    }
    return data.session;
  }
  async function api(path, session, body) {
    const response = await fetcher(apiBase + path, { method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'sign_in_required' : response.status === 409 ? 'capture_changed' : response.status === 429 ? 'import_busy' : 'import_unavailable');
    return response.json();
  }
  async function current(tabId) {
    const [tab] = Number.isInteger(tabId) ? [{id:tabId}] : await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return null;
    const capture = (await chrome.storage.session.get('capture:' + tab.id))['capture:' + tab.id];
    return capture?.expires_at > Date.now() ? capture : null;
  }
  return {
    async usage(action, product=null) {
      // Optional signed-in usage; no money, bank numbers, names or raw errors.
      try {
        const session=await user();
        const version=chrome.runtime.getManifest().version;
        const key='usage:'+session.user.id+':'+new Date().toISOString().slice(0,10)+':'+version+':'+action+':'+(product||'');
        if(action!=='csv_generated' && (await chrome.storage.local.get(key))[key]) return;
        await api('/usage',session,{event_id:crypto.randomUUID(),action,product,institution:product?'co-bancolombia':null,connector_version:version});
        if(action!=='csv_generated') await chrome.storage.local.set({[key]:true});
      } catch {} // telemetry never blocks sign-in or export
    },
    async prepare(selection, tabId) {
      if (!allowed(selection,['institution','product','number','from','to'])) throw new Error('invalid_capture');
      return this.stage({...selection,complete:false,items:[]},tabId,true);
    },
    async stage(payload, tabId, allowEmpty = false) {
      const value = validateCapture(payload, allowEmpty);
      const last4 = value.number.replace(/[^0-9]/g,'').slice(-4);
      if (!/^[0-9]{4}$/.test(last4)) throw new Error('invalid_capture');
      const sourceKey = await digest(value.institution + ':' + value.product + ':' + value.number.replace(/[ -]/g,''));
      const capture = { id: crypto.randomUUID(), expires_at: Date.now() + 600000, source_key: sourceKey, source_last4: last4, institution: value.institution, product: value.product, coverage: { start: value.from, end: value.to, complete: value.complete }, items: value.items.map((row,index) => ({...row, item_key: String(index + 1)})) };
      await chrome.storage.session.set({ ['capture:' + tabId]: capture });
      return { staged: true }; // nothing about Clatri is returned to the bank page
    },
    async handle(message, tabId) {
      const session = await user();
      const uid = session.user.id;
      if (message.type === 'transfer.context' && allowed(message,['type'])) {
        const capture = await current(tabId);
        const last = (await chrome.storage.local.get('extension-import:' + uid))['extension-import:' + uid];
        const context = await api('/context', session);
        const selection = capture ? (await chrome.storage.local.get('destination:'+uid+':'+capture.source_key))['destination:'+uid+':'+capture.source_key] : null;
        return { ...context, selection, capture: capture ? { id:capture.id, product:capture.product, last4:capture.source_last4, coverage:capture.coverage, count:capture.items.length } : null, job: last?.job || null };
      }
      if (message.type === 'transfer.status' && allowed(message,['type','id']) && /^[0-9a-f-]{36}$/.test(message.id)) return api('/imports/' + message.id,session);
      if (message.type === 'transfer.resolve' && allowed(message,['type','id','item_key','action','expected_version','target_event_id']) && /^[0-9a-f-]{36}$/.test(message.id) && text(message.item_key,128) && Number.isInteger(message.expected_version) && ['distinct','same_existing'].includes(message.action)) {
        return api('/imports/' + message.id + '/items/' + encodeURIComponent(message.item_key) + '/resolve',session,{action:message.action,expected_version:message.expected_version,target_event_id:message.target_event_id || null});
      }
      if (message.type !== 'transfer.send' || !allowed(message,['type','capture_id','entity_id','account_id','card_id']) || sending) throw new Error('invalid_message');
      sending = true;
      try {
        const capture = await current(tabId);
        if (!capture || !capture.items.length || capture.id !== message.capture_id) throw new Error('capture_changed');
        const context = await api('/context',session);
        const entity = context.entities.find(e=>e.id === message.entity_id);
        const target = capture.product === 'card' ? entity?.cards.find(c=>c.id === message.card_id) : entity?.accounts.find(a=>a.id === message.account_id);
        if (!target) throw new Error('invalid_destination');
        const destination={entity_id:entity.id,account_id:capture.product==='card' ? target.account_id : target.id,card_id:capture.product==='card' ? target.id : null};
        // A destination is selected per send. Give each destination a stable
        // transport UUID so retrying is safe without imposing a permanent link.
        const sendHash=await digest(capture.id+':'+uid+':'+JSON.stringify(destination));
        const sendId=sendHash.slice(0,8)+'-'+sendHash.slice(8,12)+'-4'+sendHash.slice(13,16)+'-8'+sendHash.slice(17,20)+'-'+sendHash.slice(20,32);
        const envelope = { schema_version:1, ...destination, institution:capture.institution, product:capture.product, capture_id:sendId, part_index:0, part_count:1, connector_version:chrome.runtime.getManifest().version, coverage:capture.coverage, items:capture.items };
        const job = await api('/imports',session,envelope);
        await chrome.storage.local.set({ ['extension-import:' + uid]: {job:job.id}, ['destination:'+uid+':'+capture.source_key]:destination });
        return job;
      } finally { sending = false; }
    },
  };
}
