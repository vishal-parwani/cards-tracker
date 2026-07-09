import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDHNffrxjqUzGOUQ6m8NjkdRxlH30QhpyM",
  authDomain: "cards-tracker-vishal.firebaseapp.com",
  projectId: "cards-tracker-vishal",
  storageBucket: "cards-tracker-vishal.firebasestorage.app",
  messagingSenderId: "78105565657",
  appId: "1:78105565657:web:38fcf93d6a3bbb188161c8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Persistent (IndexedDB) local cache: query results survive reloads, so the
// dashboard can paint instantly from cache while fresh data loads (see
// dashboard.js). Multi-tab manager avoids the single-tab lock error when the
// app is open in more than one tab.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
