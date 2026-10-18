(function initReviewNotes(global) {
  const Tango = global.Tango = global.Tango || {};
  const STORAGE_KEY = 'tangoTokenReviewNotesV1';
  const MAX_TEXT = 4000, MAX_BYTES = 1024 * 1024;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function localDate(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y,m,d] = value.split('-').map(Number);
    const date = new Date(y,m-1,d,12);
    return y >= 2000 && y <= 9999 && localDate(date) === value;
  }
  function key(chain, address, date) {
    if (!Tango.Chains.get(chain) || !Tango.Chains.validateAddress(chain,address) || !validDate(date)) throw new Error('invalidJournal');
    return `${chain}:${Tango.Chains.normalizeAddress(chain,address)}:${date}`;
  }
  const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
  function normalize(value, { maximumTimestamp = Number.MAX_SAFE_INTEGER } = {}) {
    if (value == null) return { schemaVersion: 1, epoch: 0, records: {} };
    if (!object(value) || value.schemaVersion !== 1 || !safeInteger(value.epoch) || !object(value.records)) throw new Error('invalidJournal');
    const records = {};
    for (const [id,note] of Object.entries(value.records)) {
      if (!object(note) || id !== key(note.chain,note.address,note.date) || note.key !== id
        || typeof note.text !== 'string' || note.text.length > MAX_TEXT
        || typeof note.symbol !== 'string' || note.symbol.length > 32
        || typeof note.name !== 'string' || note.name.length > 100
        || !safeInteger(note.revision) || note.revision < 1
        || !safeInteger(note.createdAt) || !safeInteger(note.updatedAt)
        || note.createdAt > note.updatedAt || note.updatedAt > maximumTimestamp) throw new Error('invalidJournal');
      records[id] = { key:id,chain:note.chain,address:Tango.Chains.normalizeAddress(note.chain,note.address),date:note.date,
        symbol:note.symbol,name:note.name,text:note.text,revision:note.revision,createdAt:note.createdAt,updatedAt:note.updatedAt };
    }
    const result = { schemaVersion:1,epoch:value.epoch,records };
    // Bound note data separately; never evict trade history to make room for it.
    let bytes = 0;
    for (const char of JSON.stringify(result)) { const code=char.codePointAt(0); bytes += code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4; }
    if (bytes > MAX_BYTES) throw new Error('journalFull');
    return result;
  }
  function upsert(value, input, now = Date.now()) {
    const store = normalize(value);
    const id = key(input?.chain,input?.address,input?.date);
    const current = store.records[id];
    if (!safeInteger(input.expectedEpoch) || !safeInteger(input.expectedRevision)
      || input.expectedEpoch !== store.epoch || input.expectedRevision !== (current?.revision || 0)) throw new Error('journalConflict');
    if (typeof input.text !== 'string' || input.text.length > MAX_TEXT || !safeInteger(now)) throw new Error('invalidJournal');
    const cleanLabel = (value,limit) => String(value || '').replace(/\s+/g,' ').trim().slice(0,limit);
    const record = { key:id,chain:input.chain,address:Tango.Chains.normalizeAddress(input.chain,input.address),date:input.date,
      symbol:cleanLabel(input.symbol,32),name:cleanLabel(input.name,100),text:input.text,
      revision:(current?.revision || 0)+1,createdAt:current?.createdAt ?? now,updatedAt:Math.max(now,current?.updatedAt || 0) };
    return normalize({ ...store,records:{ ...store.records,[id]:record } });
  }
  function list(store, date, chain = '') {
    if (!validDate(date) || (chain && !Tango.Chains.get(chain))) return [];
    return Object.values(store?.records || {}).filter(n => n.date === date && (!chain || n.chain === chain) && n.text.trim())
      .sort((a,b) => b.updatedAt-a.updatedAt || a.key.localeCompare(b.key));
  }
  Tango.ReviewNotes = { STORAGE_KEY,MAX_TEXT,MAX_BYTES,localDate,validDate,key,normalize,upsert,list };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.ReviewNotes;
})(globalThis);
