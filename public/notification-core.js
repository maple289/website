/* Shared by the page and classic service worker (including Firefox). No tokens. */
(() => {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const valid = value => !!value && uuid(value.id) && uuid(value.conversation_id)
    && ['message', 'voice', 'video', 'call-closed'].includes(value.kind)
    && (value.kind === 'message' ? uuid(value.message_id) : uuid(value.call_id))
    && Number.isFinite(Date.parse(value.expires_at)) && Date.parse(value.expires_at) > Date.now()
    && Date.parse(value.expires_at) < Date.now() + 86401000
    && (value.kind === 'call-closed' || (typeof value.sender_name === 'string' && value.sender_name.length <= 200
      && typeof value.body === 'string' && value.body.length <= 500));
  let database;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('myhostage-messenger-notifications-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = undefined; reject(request.error); };
    });
    return database;
  }
  async function get(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction('state').objectStore('state').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function put(key, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      if (value === undefined) transaction.objectStore('state').delete(key);
      else transaction.objectStore('state').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async function clearBinding(owner) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get('binding');
      let previous;
      request.onsuccess = () => {
        if (request.result && (!owner || request.result.user_id === owner)) { previous = request.result; store.delete('binding'); }
      };
      transaction.oncomplete = () => resolve(previous);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  // One read/write transaction arbitrates two tabs, realtime, and a push wakeup.
  async function claim(id, owner) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get(`event:${owner}:${id}`);
      let claimed = false;
      request.onsuccess = () => {
        if (!request.result || request.result < Date.now() - 86400000) {
          store.put(Date.now(), `event:${owner}:${id}`); claimed = true;
        }
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async function prune() {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      const request = transaction.objectStore('state').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (/^(event|closed):/.test(String(cursor.key)) && Number(cursor.value) < Date.now() - 86400000) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  const tag = payload => payload.kind === 'message' ? `message-conversation-${payload.conversation_id}` : `incoming-call-${payload.call_id}`;
  const route = payload => `#/messages?conversation=${encodeURIComponent(payload.conversation_id)}${payload.call_id ? `&call=${encodeURIComponent(payload.call_id)}` : ''}&notification=1`;
  globalThis.MyhostageNotifications = { uuid, valid, get, put, clearBinding, claim, prune, tag, route };
})();
