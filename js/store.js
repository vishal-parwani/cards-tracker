// Shared live data store — ONE onSnapshot listener each on `transactions`
// and `voucherTrades`, started once after sign-in. Every tab reads from
// these in-memory arrays instead of running its own getDocs scans.
//
// Why listeners: combined with the persistent IndexedDB cache (config.js),
// a listener resumes from the cached state and the server only transfers
// docs that CHANGED since the last sync — one-shot getDocs re-downloads the
// full result set every call. This is the bandwidth/read-cost saver.
//
// Local writes (add/edit/delete from the UI) surface here immediately via
// Firestore's latency compensation, so reading the store right after a
// write is safe.

import { collection, query, onSnapshot, doc, getDoc, getDocFromCache } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';

// Cache-first read for small config docs. A plain getDoc is server-first and
// hangs on a zombie connection (iOS PWA resumed from background) — that froze
// the dashboard/txn tabs behind a dead socket. The IndexedDB cache answers
// instantly (and reflects local pending writes); a background server read
// keeps the cache fresh for the next paint. Server is only awaited on a true
// cache miss (first-ever signed-in load on a device).
export async function getCachedDoc(col, id) {
  const ref = doc(db, col, id);
  try {
    const snap = await getDocFromCache(ref);
    getDoc(ref).catch(() => {});
    return snap;
  } catch {
    return getDoc(ref);
  }
}

let txns = null;
let vts = null;
let started = false;
const subs = new Set();

let readyResolve;
const ready = new Promise(r => { readyResolve = r; });

function emit() {
  if (txns !== null && vts !== null) readyResolve();
  subs.forEach(fn => { try { fn(); } catch (e) { console.error('[store] subscriber:', e); } });
}

export function startStore() {
  if (started) return;
  started = true;
  onSnapshot(query(collection(db, 'transactions')), snap => {
    txns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }, e => console.error('[store] transactions listener:', e));
  onSnapshot(query(collection(db, 'voucherTrades')), snap => {
    vts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }, e => console.error('[store] voucherTrades listener:', e));
}

// Resolve once both listeners have delivered their first snapshot
// (instantly from cache on repeat visits; from the server on first ever).
export async function getTxns() { await ready; return txns; }
export async function getVts() { await ready; return vts; }

// Subscribe to store updates (new SMS arriving, edits from another device).
// Returns an unsubscribe function.
export function onStoreChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
