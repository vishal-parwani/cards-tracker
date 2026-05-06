import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, startAfter, Timestamp, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, formatDate, formatDateTime, formatDateInput, getCurrentMonthStart, getMonthStr, CATEGORIES, TRANSACTION_TAGS, computeChildHaircutPnl, sumChildHaircut, aggregateChildStatus } from './utils.js';

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
  const vtChildMap = await buildVtEnrichment(txns);
  renderTransactions(txns, !lastVisible || snap.docs.length === 0, vtChildMap);

  document.getElementById('load-more-btn').style.display = allLoaded ? 'none' : 'block';
}

async function buildVtEnrichment(txns) {
  const parentIds = [...new Set(txns.filter(t => t.voucherTradeParentId).map(t => t.voucherTradeParentId))];
  const childMap = new Map();
  for (let i = 0; i < parentIds.length; i += 30) {
    const chunk = parentIds.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, 'voucherTrades'), where('parentId', 'in', chunk)));
    snap.docs.forEach(d => {
      const data = d.data();
      if (!childMap.has(data.parentId)) childMap.set(data.parentId, []);
      childMap.get(data.parentId).push({ id: d.id, ...data });
    });
  }
  return childMap;
}

function vtChipFor(t, vtChildMap) {
  if (t.voucherTradeParentId) {
    const children = vtChildMap.get(t.voucherTradeParentId) || [];
    const status = aggregateChildStatus(children);
    if (status === 'Pending') return `<span class="vt-chip vt-chip-pending">VT pending</span>`;
    return `<span class="vt-chip vt-chip-traded">Haircut ${formatCurrency(sumChildHaircut(children))}</span>`;
  }
  if ((t.voucherTradeChildIds || []).length > 0) {
    return `<span class="vt-chip vt-chip-credit">Settles VT ×${t.voucherTradeChildIds.length}</span>`;
  }
  return '';
}

function renderTransactions(txns, replace = false, vtChildMap = new Map()) {
  const list = document.getElementById('transactions-list');
  if (replace) list.innerHTML = '';

  if (txns.length === 0 && replace) {
    list.innerHTML = '<p class="empty">No transactions found.</p>';
    return;
  }

  const rows = txns.map(t => {
    const chip = vtChipFor(t, vtChildMap);
    return `
    <tr data-id="${t.id}">
      <td>${formatDateTime(t.date)}</td>
      <td>${t.card || ''}</td>
      <td class="desc-cell">
        <div class="desc-text" onclick="window.showDescPopover(event, this)">${t.description || ''}</div>
        ${chip ? `<div class="desc-chip-row">${chip}</div>` : ''}
      </td>
      <td>${t.category || ''}</td>
      <td class="amount-cell ${t.type === 'credit' ? 'credit' : ''}">${t.type === 'credit' ? '-' : ''}${formatCurrency(t.amount)}</td>
      <td>${(t.pointsEarned || 0).toLocaleString('en-IN')}</td>
      <td>${t.transactionTag || ''}</td>
      <td class="actions-cell">
        <button class="btn-icon" onclick="window.editTransaction('${t.id}')">✏️</button>
        <button class="btn-icon" onclick="window.deleteTransaction('${t.id}')">🗑️</button>
      </td>
    </tr>
  `;
  }).join('');

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

  renderVtSection(txn);

  document.getElementById('transaction-modal').classList.remove('hidden');
}

// ─── VT section inside the transaction modal ─────────────────────────────────

let vtSectionListenersAttached = false;
function ensureVtSectionListeners() {
  if (vtSectionListenersAttached) return;
  document.getElementById('txn-type').addEventListener('change', () => {
    const txnId = document.getElementById('txn-id').value;
    // Re-render with current DOM state; we don't have the full txn obj here.
    // Reload the txn from Firestore if it was an edit so we keep linkage.
    if (txnId) {
      getDoc(doc(db, 'transactions', txnId)).then(s => {
        if (s.exists()) renderVtSection({ id: txnId, ...s.data() });
        else renderVtSection(null);
      });
    } else {
      renderVtSection(null);
    }
  });
  vtSectionListenersAttached = true;
}

async function renderVtSection(txn) {
  ensureVtSectionListeners();
  const section = document.getElementById('txn-vt-section');
  const type = document.getElementById('txn-type').value;
  const isEdit = !!txn?.id;

  if (!isEdit) {
    section.innerHTML = `<div class="vt-section-inner muted">Save the transaction first to convert it to a voucher trade.</div>`;
    return;
  }

  if (type === 'debit') {
    if (txn.voucherTradeParentId) {
      // Already linked debit — show summary + unlink.
      const parentSnap = await getDoc(doc(db, 'voucherTrades', txn.voucherTradeParentId));
      if (!parentSnap.exists()) {
        section.innerHTML = `<div class="vt-section-inner muted">Linked voucher trade no longer exists. <button class="btn btn-sm btn-secondary" onclick="window.unlinkVtFromTxn('${txn.id}')">Clear link</button></div>`;
        return;
      }
      const childSnap = await getDocs(query(collection(db, 'voucherTrades'), where('parentId', '==', txn.voucherTradeParentId)));
      const children = childSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const status = aggregateChildStatus(children);
      const haircut = sumChildHaircut(children);
      section.innerHTML = `
        <div class="vt-section-inner">
          <div class="vt-section-title">Voucher Trade <span class="status-badge ${status === 'Pending' ? 'badge-orange' : 'badge-green'}">${status}</span></div>
          <ul class="vt-child-summary">
            ${children.map(c => `
              <li>
                ${c.description || '(no description)'} — ${formatCurrency(c.purchaseAmount)}
                ${c.status === 'Traded' ? `<span class="muted">→ ${formatCurrency(c.cashReceived)} (haircut ${formatCurrency(c.haircut)})</span>` : `<span class="muted">pending</span>`}
              </li>
            `).join('')}
          </ul>
          ${status === 'Traded' ? `<div class="vt-section-haircut">Total haircut: ${formatCurrency(haircut)}</div>` : ''}
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.unlinkVtFromTxn('${txn.id}')">Unlink Voucher Trade</button>
        </div>
      `;
    } else {
      section.innerHTML = `
        <div class="vt-section-inner">
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.openConvertToVtModal('${txn.id}')">Convert to Voucher Trade</button>
        </div>
      `;
    }
    return;
  }

  if (type === 'credit') {
    const linkedIds = txn.voucherTradeChildIds || [];
    if (linkedIds.length > 0) {
      // Fetch linked children (chunks of 30 for `in` queries).
      const children = [];
      for (let i = 0; i < linkedIds.length; i += 30) {
        const chunk = linkedIds.slice(i, i + 30);
        const snap = await getDocs(query(collection(db, 'voucherTrades'), where('__name__', 'in', chunk)));
        snap.docs.forEach(d => children.push({ id: d.id, ...d.data() }));
      }
      section.innerHTML = `
        <div class="vt-section-inner">
          <div class="vt-section-title">Settles Voucher Trade${children.length === 1 ? '' : 's'}</div>
          <ul class="vt-child-summary">
            ${children.map(c => `
              <li>
                ${c.description || '(no description)'} — ${formatCurrency(c.purchaseAmount)}
                <span class="muted">→ cash ${formatCurrency(c.cashReceived)}, haircut ${formatCurrency(c.haircut)}</span>
                <button type="button" class="btn btn-sm btn-link" onclick="window.unlinkVtChildFromCredit('${txn.id}','${c.id}')">unlink</button>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    } else {
      section.innerHTML = `
        <div class="vt-section-inner">
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.openApplyToVtModal('${txn.id}')">Apply to Voucher Trade</button>
        </div>
      `;
    }
    return;
  }

  section.innerHTML = '';
}

// ─── Convert-to-VT (debit) ───────────────────────────────────────────────────

export async function openConvertToVtModal(txnId) {
  const snap = await getDoc(doc(db, 'transactions', txnId));
  if (!snap.exists()) return;
  const t = snap.data();
  document.getElementById('vt-split-source-txn-id').value = txnId;
  const rows = document.getElementById('vt-split-rows');
  rows.innerHTML = '';
  appendSplitRow(t.description || '', t.amount || '');
  document.getElementById('vt-split-modal').classList.remove('hidden');
}

function appendSplitRow(desc = '', amount = '') {
  const rows = document.getElementById('vt-split-rows');
  const idx = rows.children.length;
  const row = document.createElement('div');
  row.className = 'vt-split-row form-row two-col';
  row.innerHTML = `
    <div>
      <label>${idx === 0 ? 'Description' : ''}</label>
      <input type="text" class="vt-split-desc" value="${desc.replace(/"/g, '&quot;')}" placeholder="Voucher description">
    </div>
    <div class="vt-split-amount-wrap">
      <label>${idx === 0 ? 'Amount (₹)' : ''}</label>
      <div class="vt-split-amount-inline">
        <input type="number" class="vt-split-amount" step="0.01" min="0" value="${amount}">
        <button type="button" class="btn btn-sm btn-link vt-split-remove">✕</button>
      </div>
    </div>
  `;
  row.querySelector('.vt-split-remove').addEventListener('click', () => {
    if (rows.children.length > 1) row.remove();
  });
  rows.appendChild(row);
}

export function addSplitRow() { appendSplitRow(); }

export async function saveVtSplits() {
  const txnId = document.getElementById('vt-split-source-txn-id').value;
  const rows = [...document.querySelectorAll('#vt-split-rows .vt-split-row')];
  const splits = rows.map(r => ({
    description: r.querySelector('.vt-split-desc').value.trim(),
    amount: parseFloat(r.querySelector('.vt-split-amount').value),
  })).filter(s => !isNaN(s.amount));

  if (splits.length === 0) { alert('Add at least one split with an amount.'); return; }

  const txnSnap = await getDoc(doc(db, 'transactions', txnId));
  if (!txnSnap.exists()) return;
  const t = txnSnap.data();

  const splitTotal = splits.reduce((s, x) => s + x.amount, 0);
  if (splitTotal > (t.amount || 0) + 0.01) {
    alert(`Split total ${formatCurrency(splitTotal)} exceeds the source debit amount ${formatCurrency(t.amount)}.`);
    return;
  }

  const batch = writeBatch(db);
  const parentRef = doc(collection(db, 'voucherTrades'));
  batch.set(parentRef, {
    isParent: true,
    purchaseDate: t.date,
    card: t.card,
    description: t.description || '',
    purchaseAmount: t.amount,
    pointsEarned: t.pointsEarned || 0,
    purchaseTransactionId: txnId,
  });
  for (const s of splits) {
    const childRef = doc(collection(db, 'voucherTrades'));
    batch.set(childRef, {
      parentId: parentRef.id,
      purchaseDate: t.date,
      card: t.card,
      description: s.description,
      purchaseAmount: s.amount,
      status: 'Pending',
    });
  }
  batch.update(doc(db, 'transactions', txnId), { voucherTradeParentId: parentRef.id });
  await batch.commit();

  document.getElementById('vt-split-modal').classList.add('hidden');
  // Refresh the txn modal's VT section so it shows the new linkage.
  renderVtSection({ id: txnId, ...t, voucherTradeParentId: parentRef.id });
  loadTransactions(true);
}

export async function unlinkVtFromTxn(txnId) {
  if (!confirm('Unlink and delete the voucher trade and all its splits?')) return;
  const txnSnap = await getDoc(doc(db, 'transactions', txnId));
  if (!txnSnap.exists()) return;
  const parentId = txnSnap.data().voucherTradeParentId;
  if (!parentId) return;

  const childSnap = await getDocs(query(collection(db, 'voucherTrades'), where('parentId', '==', parentId)));
  const batch = writeBatch(db);
  batch.delete(doc(db, 'voucherTrades', parentId));
  childSnap.docs.forEach(c => batch.delete(c.ref));
  batch.update(doc(db, 'transactions', txnId), { voucherTradeParentId: null });
  await batch.commit();
  renderVtSection({ id: txnId, ...txnSnap.data(), voucherTradeParentId: null });
  loadTransactions(true);
}

// ─── Apply-to-VT (credit) ────────────────────────────────────────────────────

export async function openApplyToVtModal(txnId) {
  document.getElementById('vt-apply-source-txn-id').value = txnId;
  const list = document.getElementById('vt-apply-list');
  list.innerHTML = '<p class="loading">Loading pending voucher trades...</p>';
  document.getElementById('vt-apply-modal').classList.remove('hidden');

  // Load all VT children with status='Pending' across all cards.
  const snap = await getDocs(query(collection(db, 'voucherTrades'), where('status', '==', 'Pending')));
  const children = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.parentId)
    .sort((a, b) => (b.purchaseDate?.seconds || 0) - (a.purchaseDate?.seconds || 0));

  if (children.length === 0) {
    list.innerHTML = '<p class="empty">No pending voucher trades to apply.</p>';
    return;
  }

  list.innerHTML = children.map(c => `
    <div class="vt-apply-row">
      <label class="vt-apply-pick">
        <input type="checkbox" class="vt-apply-check" data-id="${c.id}" data-amount="${c.purchaseAmount}">
        <span>${formatDate(c.purchaseDate)} · ${c.card || ''} · ${c.description || '(no desc)'} · ${formatCurrency(c.purchaseAmount)}</span>
      </label>
      <input type="number" class="vt-apply-cash" data-id="${c.id}" step="0.01" min="0" placeholder="Cash received (₹)">
    </div>
  `).join('');

  list.querySelectorAll('.vt-apply-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const cashInput = list.querySelector(`.vt-apply-cash[data-id="${cb.dataset.id}"]`);
      if (cb.checked && !cashInput.value) cashInput.value = cb.dataset.amount;
    });
  });
}

export async function saveVtApply() {
  const txnId = document.getElementById('vt-apply-source-txn-id').value;
  const txnSnap = await getDoc(doc(db, 'transactions', txnId));
  if (!txnSnap.exists()) return;
  const t = txnSnap.data();

  const checks = [...document.querySelectorAll('#vt-apply-list .vt-apply-check')].filter(c => c.checked);
  if (checks.length === 0) { alert('Pick at least one voucher trade.'); return; }

  const batch = writeBatch(db);
  const linkedIds = [...(t.voucherTradeChildIds || [])];

  for (const cb of checks) {
    const id = cb.dataset.id;
    const cashInput = document.querySelector(`#vt-apply-list .vt-apply-cash[data-id="${id}"]`);
    const cash = parseFloat(cashInput.value);
    const amount = parseFloat(cb.dataset.amount);
    if (isNaN(cash)) { alert('Enter cash received for every checked split.'); return; }
    const { haircut, netPnl } = computeChildHaircutPnl(amount, cash);
    batch.update(doc(db, 'voucherTrades', id), {
      status: 'Traded',
      tradeDate: t.date,
      cashReceived: cash,
      haircut,
      netPnl,
      settlementTransactionId: txnId,
    });
    if (!linkedIds.includes(id)) linkedIds.push(id);
  }
  batch.update(doc(db, 'transactions', txnId), { voucherTradeChildIds: linkedIds });
  await batch.commit();

  document.getElementById('vt-apply-modal').classList.add('hidden');
  renderVtSection({ id: txnId, ...t, voucherTradeChildIds: linkedIds });
  loadTransactions(true);
}

export async function unlinkVtChildFromCredit(txnId, childId) {
  if (!confirm('Revert this split to Pending?')) return;
  const txnSnap = await getDoc(doc(db, 'transactions', txnId));
  if (!txnSnap.exists()) return;
  const t = txnSnap.data();
  const linkedIds = (t.voucherTradeChildIds || []).filter(x => x !== childId);

  const batch = writeBatch(db);
  batch.update(doc(db, 'voucherTrades', childId), {
    status: 'Pending',
    tradeDate: null,
    cashReceived: null,
    haircut: null,
    netPnl: null,
    settlementTransactionId: null,
  });
  batch.update(doc(db, 'transactions', txnId), { voucherTradeChildIds: linkedIds });
  await batch.commit();
  renderVtSection({ id: txnId, ...t, voucherTradeChildIds: linkedIds });
  loadTransactions(true);
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

  const vtChildMap = await buildVtEnrichment(txns);
  renderTransactions(txns, true, vtChildMap);
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
