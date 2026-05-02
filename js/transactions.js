import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, startAfter, Timestamp, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, formatDate, formatDateTime, formatDateInput, getCurrentMonthStart, getMonthStr, CATEGORIES, TRANSACTION_TAGS } from './utils.js';

const PAGE_SIZE = 50;
let lastVisible = null;
let allLoaded = false;
let currentFilter = { card: '', category: '' };
let modalCardsData = {};
let stmtListenersAttached = false;
let activeFilters = { dateFrom: '', dateTo: '', card: '', category: '', tag: '', description: '' };
let filterPanelInitialized = false;
let pointsManuallyEdited = false;

const CARD_POINTS_RATES = {
  'Magnus Burgundy': { rate: 12, per: 200 },
  'Infinia':         { rate: 5,  per: 150 },
  'ICICI EPM':       { rate: 6,  per: 200 },
  'Times Black':     { rate: 2,  per: 100 },
};
const CARD_EXCLUDED_CATS = {
  'Magnus Burgundy': new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load', 'EMI']),
  'Infinia':         new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load']),
  'ICICI EPM':       new Set(['Fuel', 'Fees & Charges', 'Government Services', 'Rent', 'Wallet Load']),
  'Times Black':     new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Insurance']),
};

function autoComputePoints() {
  if (pointsManuallyEdited) return;
  const card     = document.getElementById('txn-card').value;
  const amount   = parseFloat(document.getElementById('txn-amount').value) || 0;
  const category = document.getElementById('txn-category').value;
  const type     = document.getElementById('txn-type').value;
  const el       = document.getElementById('txn-points');

  if (type === 'credit') { el.value = 0; return; }
  const excl = CARD_EXCLUDED_CATS[card];
  if (excl && excl.has(category)) { el.value = 0; return; }
  const r = CARD_POINTS_RATES[card];
  el.value = r ? Math.floor(amount / r.per) * r.rate : 0;
}

window.showDescPopover = function(e, cell) {
  document.querySelector('.desc-popover')?.remove();
  if (cell.scrollWidth <= cell.clientWidth) return;
  const pop = document.createElement('div');
  pop.className = 'desc-popover';
  pop.textContent = cell.textContent.trim();
  document.body.appendChild(pop);
  const rect = cell.getBoundingClientRect();
  pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  pop.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 360) + 'px';
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
  e.stopPropagation();
};

function hasActiveFilters() {
  return Object.values(activeFilters).some(v => v !== '');
}

function computeStatementPeriod(dateStr, cutoffDay) {
  if (!dateStr || !cutoffDay) return '';
  const txnDate = new Date(dateStr);
  const day = txnDate.getDate();
  const stmtStart = day >= cutoffDay
    ? new Date(txnDate.getFullYear(), txnDate.getMonth(), cutoffDay)
    : new Date(txnDate.getFullYear(), txnDate.getMonth() - 1, cutoffDay);
  const stmtEnd = new Date(stmtStart.getFullYear(), stmtStart.getMonth() + 1, cutoffDay - 1);
  const fmt = d => [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('/');
  return `${fmt(stmtStart)} - ${fmt(stmtEnd)}`;
}

function updateStatementPeriod() {
  const dateStr = document.getElementById('txn-date').value;
  const card = document.getElementById('txn-card').value;
  const cutoffDay = modalCardsData[card];
  document.getElementById('txn-statement-period').value = computeStatementPeriod(dateStr, cutoffDay);
}

function ensureStmtListeners() {
  if (stmtListenersAttached) return;
  document.getElementById('txn-date').addEventListener('change', updateStatementPeriod);
  document.getElementById('txn-card').addEventListener('change', updateStatementPeriod);
  document.getElementById('txn-amount').addEventListener('input', autoComputePoints);
  document.getElementById('txn-card').addEventListener('change', autoComputePoints);
  document.getElementById('txn-category').addEventListener('change', autoComputePoints);
  document.getElementById('txn-type').addEventListener('change', autoComputePoints);
  document.getElementById('txn-points').addEventListener('input', () => { pointsManuallyEdited = true; });
  stmtListenersAttached = true;
}

export async function loadTransactions(reset = false) {
  if (!filterPanelInitialized) {
    await initFilterPanel();
    filterPanelInitialized = true;
  }

  if (hasActiveFilters()) {
    await loadFilteredTransactions();
    return;
  }

  if (reset) {
    lastVisible = null;
    allLoaded = false;
    document.getElementById('transactions-list').innerHTML = '';
  }
  if (allLoaded) return;

  const monthStart = getCurrentMonthStart();
  let q;

  if (!lastVisible) {
    q = query(
      collection(db, 'transactions'),
      orderBy('date', 'desc'),
      limit(PAGE_SIZE)
    );
  } else {
    q = query(
      collection(db, 'transactions'),
      orderBy('date', 'desc'),
      startAfter(lastVisible),
      limit(PAGE_SIZE)
    );
  }

  const snap = await getDocs(q);
  if (snap.docs.length < PAGE_SIZE) allLoaded = true;
  if (snap.docs.length > 0) lastVisible = snap.docs[snap.docs.length - 1];

  const txns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTransactions(txns, !lastVisible || snap.docs.length === 0);

  document.getElementById('load-more-btn').style.display = allLoaded ? 'none' : 'block';
}

function renderTransactions(txns, replace = false) {
  const list = document.getElementById('transactions-list');
  if (replace) list.innerHTML = '';

  if (txns.length === 0 && replace) {
    list.innerHTML = '<p class="empty">No transactions found.</p>';
    return;
  }

  const rows = txns.map(t => `
    <tr data-id="${t.id}">
      <td>${formatDateTime(t.date)}</td>
      <td>${t.card || ''}</td>
      <td class="desc-cell" onclick="window.showDescPopover(event, this)">${t.description || ''}</td>
      <td>${t.category || ''}</td>
      <td class="amount-cell ${t.type === 'credit' ? 'credit' : ''}">${t.type === 'credit' ? '-' : ''}${formatCurrency(t.amount)}</td>
      <td>${t.pointsEarned || 0}</td>
      <td>${t.transactionTag || ''}</td>
      <td class="actions-cell">
        <button class="btn-icon" onclick="window.editTransaction('${t.id}')">✏️</button>
        <button class="btn-icon" onclick="window.deleteTransaction('${t.id}')">🗑️</button>
      </td>
    </tr>
  `).join('');

  list.insertAdjacentHTML('beforeend', rows);
}

export async function openAddTransaction() {
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  showTransactionModal(null, cardsSnap.exists() ? cardsSnap.data() : {});
}

export async function openEditTransaction(id) {
  const snap = await getDoc(doc(db, 'transactions', id));
  if (!snap.exists()) return;
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  showTransactionModal({ id, ...snap.data() }, cardsSnap.exists() ? cardsSnap.data() : {});
}

function showTransactionModal(txn, cardsData) {
  const isEdit = !!txn;
  const date = txn?.date ? formatDateInput(txn.date.toDate()) : new Date().toISOString().split('T')[0];

  modalCardsData = Object.fromEntries(
    Object.entries(cardsData).map(([name, val]) => [name, typeof val === 'number' ? val : (val.statementDate || 1)])
  );
  const cards = Object.keys(cardsData);

  document.getElementById('modal-title').textContent = isEdit ? 'Edit Transaction' : 'Add Transaction';
  document.getElementById('txn-id').value = txn?.id || '';
  document.getElementById('txn-date').value = date;
  document.getElementById('txn-card').innerHTML = cards.map(c => `<option value="${c}" ${txn?.card === c ? 'selected' : ''}>${c}</option>`).join('');
  document.getElementById('txn-description').value = txn?.description || '';
  document.getElementById('txn-category').value = txn?.category || '';
  document.getElementById('txn-amount').value = txn?.amount || '';
  document.getElementById('txn-type').value = txn?.type || 'debit';
  document.getElementById('txn-points').value = txn?.pointsEarned || 0;
  document.getElementById('txn-tag').value = txn?.transactionTag || '';
  document.getElementById('txn-reimbursable').checked = txn?.reimbursable || false;
  document.getElementById('txn-notes').value = txn?.notes || '';

  pointsManuallyEdited = false;
  ensureStmtListeners();
  updateStatementPeriod();

  document.getElementById('transaction-modal').classList.remove('hidden');
}

export async function saveTransaction() {
  const id = document.getElementById('txn-id').value;
  const dateStr = document.getElementById('txn-date').value;
  const amount = parseFloat(document.getElementById('txn-amount').value);

  if (!dateStr || isNaN(amount)) {
    alert('Please fill in date and amount.');
    return;
  }

  const data = {
    date: Timestamp.fromDate(new Date(dateStr)),
    card: document.getElementById('txn-card').value,
    description: document.getElementById('txn-description').value.trim(),
    category: document.getElementById('txn-category').value,
    amount,
    type: document.getElementById('txn-type').value,
    pointsEarned: parseInt(document.getElementById('txn-points').value) || 0,
    transactionTag: document.getElementById('txn-tag').value,
    statementPeriod: document.getElementById('txn-statement-period').value.trim(),
    reimbursable: document.getElementById('txn-reimbursable').checked,
    notes: document.getElementById('txn-notes').value.trim(),
    month: getMonthStr(new Date(dateStr)),
    source: 'manual'
  };

  if (id) {
    await updateDoc(doc(db, 'transactions', id), data);
  } else {
    await addDoc(collection(db, 'transactions'), data);
  }

  closeTransactionModal();
  loadTransactions(true);
}

export async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  await deleteDoc(doc(db, 'transactions', id));
  loadTransactions(true);
}

async function loadFilteredTransactions() {
  const list = document.getElementById('transactions-list');
  list.innerHTML = '';
  document.getElementById('load-more-btn').style.display = 'none';

  const constraints = [orderBy('date', 'desc')];
  if (activeFilters.dateFrom) {
    constraints.push(where('date', '>=', Timestamp.fromDate(new Date(activeFilters.dateFrom + 'T00:00:00'))));
  }
  if (activeFilters.dateTo) {
    constraints.push(where('date', '<=', Timestamp.fromDate(new Date(activeFilters.dateTo + 'T23:59:59'))));
  }

  const snap = await getDocs(query(collection(db, 'transactions'), ...constraints));
  let txns = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (activeFilters.card) txns = txns.filter(t => t.card === activeFilters.card);
  if (activeFilters.category) txns = txns.filter(t => t.category === activeFilters.category);
  if (activeFilters.tag) txns = txns.filter(t => t.transactionTag === activeFilters.tag);
  if (activeFilters.description) txns = txns.filter(t => (t.description || '').toLowerCase().includes(activeFilters.description));

  renderTransactions(txns, true);
}

export function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const btn = document.getElementById('filter-btn');
  const isHidden = panel.classList.toggle('hidden');
  if (isHidden && !hasActiveFilters()) btn.classList.remove('filter-active');
}

export function applyFilters() {
  activeFilters = {
    dateFrom: document.getElementById('filter-date-from').value,
    dateTo: document.getElementById('filter-date-to').value,
    card: document.getElementById('filter-card').value,
    category: document.getElementById('filter-category').value,
    tag: document.getElementById('filter-tag').value,
    description: document.getElementById('filter-description').value.toLowerCase().trim(),
  };
  const hasFilter = hasActiveFilters();
  document.getElementById('filter-btn').classList.toggle('filter-active', hasFilter);
  if (hasFilter) {
    loadFilteredTransactions();
  } else {
    loadTransactions(true);
  }
}

export function clearFilters() {
  activeFilters = { dateFrom: '', dateTo: '', card: '', category: '', tag: '', description: '' };
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  document.getElementById('filter-card').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-tag').value = '';
  document.getElementById('filter-description').value = '';
  document.getElementById('filter-btn').classList.remove('filter-active');
  loadTransactions(true);
}

async function initFilterPanel() {
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  const cardsData = cardsSnap.exists() ? cardsSnap.data() : {};
  const select = document.getElementById('filter-card');
  Object.keys(cardsData).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    select.appendChild(opt);
  });
}

export function closeTransactionModal() {
  document.getElementById('transaction-modal').classList.add('hidden');
}

export function getTransactionFormHTML() {
  return `
    <div class="form-row">
      <label>Date</label>
      <input type="date" id="txn-date" required>
    </div>
    <div class="form-row">
      <label>Card</label>
      <select id="txn-card"></select>
    </div>
    <div class="form-row">
      <label>Description</label>
      <input type="text" id="txn-description" placeholder="Merchant name">
    </div>
    <div class="form-row">
      <label>Category</label>
      <select id="txn-category">
        ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="form-row two-col">
      <div>
        <label>Amount (₹)</label>
        <input type="number" id="txn-amount" step="0.01" min="0" required>
      </div>
      <div>
        <label>Type</label>
        <select id="txn-type">
          <option value="debit">Debit</option>
          <option value="credit">Credit</option>
        </select>
      </div>
    </div>
    <div class="form-row two-col">
      <div>
        <label>Points Earned</label>
        <input type="number" id="txn-points" value="0" min="0">
      </div>
      <div>
        <label>Tag</label>
        <select id="txn-tag">
          ${TRANSACTION_TAGS.map(t => `<option value="${t}">${t || 'None'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <label>Statement Period</label>
      <input type="text" id="txn-statement-period" placeholder="e.g. 01/04/2026 - 30/04/2026">
    </div>
    <div class="form-row checkbox-row">
      <input type="checkbox" id="txn-reimbursable">
      <label for="txn-reimbursable">Reimbursable</label>
    </div>
    <div class="form-row">
      <label>Notes</label>
      <input type="text" id="txn-notes" placeholder="Optional notes">
    </div>
  `;
}
