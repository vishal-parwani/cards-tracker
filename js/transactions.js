import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, limit, startAfter, Timestamp, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, formatDate, formatDateTime, formatDateInput, getMonthStr, CATEGORIES, TRANSACTION_TAGS, computeChildHaircutPnl, sumChildHaircut, aggregateChildStatus, guardWrite, showToast, initDatePickers } from './utils.js';
import { deriveTag, computePointsForTag, AEP_EXCLUDED_CATS } from './points-config.js';

const PAGE_SIZE = 50;
let lastVisible = null;
let allLoaded = false;
let modalCardsData = {};
let stmtListenersAttached = false;
let pointsManuallyEdited = false;
let tagManuallyEdited = false;
let editingOriginal = null;

// ── Per-column filters ─────────────────────────────────────────────
// One small filter popover per `<th>` on desktop; a single combined modal
// on mobile (thead is hidden in card-stacked mode). Both UIs read/write
// the same `colFilters` state and call `applyColumnFilters` on change.
const FILTER_COL_LABELS = {
  date: 'Date', card: 'Card', description: 'Description',
  category: 'Category', amount: 'Amount', tag: 'Tag',
};
const CATEGORY_OPTS = CATEGORIES;
const TAG_OPTS = TRANSACTION_TAGS.filter(t => t !== '');
let cardOpts = [];
let columnFiltersInit = false;
let colFilters = {
  date: { from: '', to: '' },
  card: [],
  description: '',
  category: [],
  amount: { min: '', max: '' },
  tag: [],
};

function autoComputePoints() {
  if (pointsManuallyEdited) return;
  const card     = document.getElementById('txn-card').value;
  const amount   = parseFloat(document.getElementById('txn-amount').value) || 0;
  const category = document.getElementById('txn-category').value;
  const type     = document.getElementById('txn-type').value;
  const tag      = document.getElementById('txn-tag').value;

  // Magnus Burgundy edit-preserve: the backend prorates points across AEP
  // bands (Band 2 = 35/200, vs base 12/200); the UI can't replicate that
  // without cumulative state, so a naive recompute on edit would clobber
  // a high-band value with the base rate. Preserve the stored value unless
  // the new category zeros it or the amount changed.
  if (card === 'Magnus Burgundy' && editingOriginal && editingOriginal.card === 'Magnus Burgundy') {
    if (type === 'credit') { document.getElementById('txn-points').value = 0; return; }
    if (AEP_EXCLUDED_CATS.has(category)) { document.getElementById('txn-points').value = 0; return; }
    const origAmt = editingOriginal.amount || 0;
    const origPts = editingOriginal.pointsEarned || 0;
    if (amount === origAmt) {
      document.getElementById('txn-points').value = origPts;
      return;
    }
    if (origAmt > 0 && origPts > 0) {
      // Scale by the original effective rate so a Band-2 txn stays Band-2.
      document.getElementById('txn-points').value = Math.round((origPts / origAmt) * amount);
      return;
    }
  }

  document.getElementById('txn-points').value =
    computePointsForTag(card, amount, category, type, tag);
}

// Auto-set the tag from card+description unless the user has touched it.
// After updating the tag, recompute points.
function autoSetTagFromDesc() {
  if (tagManuallyEdited) return;
  const card        = document.getElementById('txn-card').value;
  const description = document.getElementById('txn-description').value;
  const derived     = deriveTag(card, description);
  const tagEl       = document.getElementById('txn-tag');
  if (tagEl.value !== derived) tagEl.value = derived;
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
  const f = colFilters;
  return !!(f.date.from || f.date.to || f.card.length || f.description ||
           f.category.length || f.amount.min !== '' || f.amount.max !== '' ||
           f.tag.length);
}

function colHasFilter(col) {
  const f = colFilters;
  switch (col) {
    case 'date':        return !!(f.date.from || f.date.to);
    case 'card':        return f.card.length > 0;
    case 'description': return !!f.description;
    case 'category':    return f.category.length > 0;
    case 'amount':      return f.amount.min !== '' || f.amount.max !== '';
    case 'tag':         return f.tag.length > 0;
    default:            return false;
  }
}

function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

function buildFilterControl(col) {
  const f = colFilters;
  if (col === 'date') {
    return `
      <div class="cf-field"><label>From</label><input type="date" class="cf-date-from" value="${f.date.from}"></div>
      <div class="cf-field"><label>To</label><input type="date" class="cf-date-to" value="${f.date.to}"></div>`;
  }
  if (col === 'amount') {
    return `
      <div class="cf-field"><label>Min ₹</label><input type="number" class="cf-amt-min" min="0" step="0.01" value="${f.amount.min}"></div>
      <div class="cf-field"><label>Max ₹</label><input type="number" class="cf-amt-max" min="0" step="0.01" value="${f.amount.max}"></div>`;
  }
  if (col === 'description') {
    return `<div class="cf-field"><label>Contains</label><input type="text" class="cf-desc" placeholder="Merchant…" value="${escAttr(f.description)}"></div>`;
  }
  // checklist: card / category / tag
  const opts = col === 'card' ? cardOpts : col === 'category' ? CATEGORY_OPTS : TAG_OPTS;
  const selected = f[col];
  return `<div class="cf-checklist">${opts.map(o => `
    <label class="cf-check"><input type="checkbox" value="${escAttr(o)}" ${selected.includes(o) ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>`;
}

function readFilterControl(col, root) {
  const f = colFilters;
  if (col === 'date') {
    f.date.from = root.querySelector('.cf-date-from').value;
    f.date.to   = root.querySelector('.cf-date-to').value;
  } else if (col === 'amount') {
    f.amount.min = root.querySelector('.cf-amt-min').value;
    f.amount.max = root.querySelector('.cf-amt-max').value;
  } else if (col === 'description') {
    f.description = root.querySelector('.cf-desc').value.trim();
  } else {
    f[col] = [...root.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  }
}

function clearColumn(col) {
  if (col === 'date') colFilters.date = { from: '', to: '' };
  else if (col === 'amount') colFilters.amount = { min: '', max: '' };
  else if (col === 'description') colFilters.description = '';
  else colFilters[col] = [];
}

function applyColumnFilters() {
  if (hasActiveFilters()) loadFilteredTransactions();
  else loadTransactions(true);
}

function updateFilterIcons() {
  document.querySelectorAll('.th-filter').forEach(btn => {
    btn.classList.toggle('cf-on', colHasFilter(btn.dataset.col));
  });
  document.getElementById('clear-filters-btn')?.classList.toggle('hidden', !hasActiveFilters());
  document.getElementById('txn-filter-mobile-btn')?.classList.toggle('cf-on', hasActiveFilters());
}

function openColFilterPopover(btn, col) {
  document.querySelector('.col-filter-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'col-filter-pop';
  pop.innerHTML = `
    <div class="cf-title">${FILTER_COL_LABELS[col]}</div>
    <div class="cf-body">${buildFilterControl(col)}</div>
    <div class="cf-pop-actions"><button type="button" class="btn btn-sm btn-secondary cf-clear">Clear</button></div>
  `;
  document.body.appendChild(pop);
  initDatePickers(pop);
  const rect = btn.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  pop.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8) + 'px';

  const apply = () => { readFilterControl(col, pop); applyColumnFilters(); updateFilterIcons(); };
  pop.addEventListener('input', apply);
  pop.addEventListener('change', apply);
  pop.querySelector('.cf-clear').addEventListener('click', () => {
    clearColumn(col);
    pop.remove();
    applyColumnFilters();
    updateFilterIcons();
  });

  const closer = ev => {
    if (!pop.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)
        && !ev.target.closest('.flatpickr-calendar')) {
      pop.remove();
      document.removeEventListener('click', closer);
    }
  };
  setTimeout(() => document.addEventListener('click', closer), 0);
}

function openColFilterModal() {
  const body = document.getElementById('col-filter-modal-body');
  body.innerHTML = ['date','card','description','category','amount','tag'].map(col => `
    <div class="cf-section" data-col="${col}">
      <div class="cf-title">${FILTER_COL_LABELS[col]}</div>
      ${buildFilterControl(col)}
    </div>`).join('');
  initDatePickers(body);
  document.getElementById('col-filter-modal').classList.remove('hidden');
}

function onModalFilterChange(e) {
  const section = e.target.closest('.cf-section');
  if (!section) return;
  readFilterControl(section.dataset.col, section);
  applyColumnFilters();
  updateFilterIcons();
}

export function clearAllFilters() {
  colFilters = {
    date: { from: '', to: '' }, card: [], description: '',
    category: [], amount: { min: '', max: '' }, tag: [],
  };
  updateFilterIcons();
  loadTransactions(true);
}

async function initColumnFilters() {
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  cardOpts = cardsSnap.exists() ? Object.keys(cardsSnap.data()).sort() : [];

  document.querySelectorAll('.th-filter').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openColFilterPopover(btn, btn.dataset.col);
    });
  });
  document.getElementById('txn-filter-mobile-btn')?.addEventListener('click', openColFilterModal);
  const body = document.getElementById('col-filter-modal-body');
  body?.addEventListener('input', onModalFilterChange);
  body?.addEventListener('change', onModalFilterChange);
  document.getElementById('col-filter-clear-all-btn')?.addEventListener('click', () => {
    clearAllFilters();
    document.getElementById('col-filter-modal').classList.add('hidden');
  });
  document.getElementById('clear-filters-btn')?.addEventListener('click', clearAllFilters);
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
  // Card or description change → re-derive tag, then re-compute points.
  document.getElementById('txn-card').addEventListener('change', () => {
    autoSetTagFromDesc();
    autoComputePoints();
  });
  document.getElementById('txn-description').addEventListener('input', () => {
    autoSetTagFromDesc();
    autoComputePoints();
  });
  document.getElementById('txn-amount').addEventListener('input', autoComputePoints);
  document.getElementById('txn-category').addEventListener('change', autoComputePoints);
  document.getElementById('txn-type').addEventListener('change', autoComputePoints);
  document.getElementById('txn-tag').addEventListener('change', () => {
    tagManuallyEdited = true;
    autoComputePoints();
  });
  document.getElementById('txn-points').addEventListener('input', () => { pointsManuallyEdited = true; });
  stmtListenersAttached = true;
}

export async function loadTransactions(reset = false) {
  try {
    if (!columnFiltersInit) {
      await initColumnFilters();
      columnFiltersInit = true;
    }

    if (hasActiveFilters()) {
      await loadFilteredTransactions();
      return;
    }

    if (reset) {
      lastVisible = null;
      allLoaded = false;
      document.getElementById('transactions-list').innerHTML =
        '<tr><td colspan="8" class="loading">Loading…</td></tr>';
    }
    if (allLoaded) return;

    const firstPage = !lastVisible;
    const q = firstPage
      ? query(collection(db, 'transactions'), orderBy('date', 'desc'), limit(PAGE_SIZE))
      : query(collection(db, 'transactions'), orderBy('date', 'desc'), startAfter(lastVisible), limit(PAGE_SIZE));

    const snap = await getDocs(q);
    if (snap.docs.length < PAGE_SIZE) allLoaded = true;
    if (snap.docs.length > 0) lastVisible = snap.docs[snap.docs.length - 1];

    if (firstPage) document.getElementById('transactions-list').innerHTML = '';

    const txns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const vtChildMap = await buildVtEnrichment(txns);
    renderTransactions(txns, firstPage && txns.length === 0, vtChildMap);

    document.getElementById('load-more-btn').style.display = allLoaded ? 'none' : 'block';
  } catch (e) {
    console.error('Load transactions failed:', e);
    document.getElementById('transactions-list').innerHTML =
      `<tr><td colspan="8" class="error">Couldn't load transactions: ${e.message}</td></tr>`;
    document.getElementById('load-more-btn').style.display = 'none';
  }
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

function rowHtml(t, vtChildMap = new Map()) {
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
}

function renderTransactions(txns, replace = false, vtChildMap = new Map()) {
  const list = document.getElementById('transactions-list');
  if (replace) list.innerHTML = '';

  if (txns.length === 0 && replace) {
    list.innerHTML = '<tr><td colspan="8" class="empty">No transactions found.</td></tr>';
    return;
  }

  list.insertAdjacentHTML('beforeend', txns.map(t => rowHtml(t, vtChildMap)).join(''));
}

// Optimistic-update helpers — keep the list rendered in place on edit/delete
// instead of a full re-fetch + scroll reset. Adds with active filters still
// trigger a full reload (the new row may not match), and same for edits that
// might shift the row out of the current filtered/sorted view.
async function patchRowInPlace(txn) {
  const vtChildMap = await buildVtEnrichment([txn]);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = rowHtml(txn, vtChildMap);
  const existing = document.querySelector(`#transactions-list tr[data-id="${txn.id}"]`);
  if (existing && tmp.firstElementChild) existing.replaceWith(tmp.firstElementChild);
}

function removeRowFromDom(id) {
  document.querySelector(`#transactions-list tr[data-id="${id}"]`)?.remove();
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
  editingOriginal = isEdit ? {
    date: txn?.date || null,
    source: txn?.source || null,
    card: txn?.card || null,
    amount: txn?.amount || 0,
    type: txn?.type || null,
    category: txn?.category || null,
    pointsEarned: txn?.pointsEarned || 0,
  } : null;
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
  tagManuallyEdited = false;
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
  if (splits.some(s => s.amount <= 0)) { alert('Each split amount must be greater than zero.'); return; }

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
  if (!await guardWrite(() => batch.commit(), 'Save voucher trade')) return;

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
  if (!await guardWrite(() => batch.commit(), 'Unlink voucher trade')) return;
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
    if (isNaN(cash) || cash < 0) { alert('Enter a non-negative cash amount for every checked split.'); return; }
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
  if (!await guardWrite(() => batch.commit(), 'Apply credit to voucher trade')) return;

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
  if (!await guardWrite(() => batch.commit(), 'Revert voucher trade')) return;
  renderVtSection({ id: txnId, ...t, voucherTradeChildIds: linkedIds });
  loadTransactions(true);
}

export async function saveTransaction() {
  const id = document.getElementById('txn-id').value;
  const dateStr = document.getElementById('txn-date').value;
  const amount = parseFloat(document.getElementById('txn-amount').value);
  const card = document.getElementById('txn-card').value;
  const category = document.getElementById('txn-category').value;

  if (!dateStr) { alert('Pick a date.'); return; }
  if (!card) { alert('Select a card.'); return; }
  if (isNaN(amount) || amount <= 0) { alert('Enter an amount greater than zero.'); return; }
  if (!category) { alert('Select a category.'); return; }

  // Preserve original time if the user didn't change the date (otherwise
  // `new Date('YYYY-MM-DD')` is midnight UTC and time is silently dropped).
  let dateValue;
  const origDate = editingOriginal?.date?.toDate ? editingOriginal.date.toDate() : null;
  if (id && origDate && formatDateInput(origDate) === dateStr) {
    dateValue = editingOriginal.date;
  } else {
    dateValue = Timestamp.fromDate(new Date(dateStr));
  }

  const data = {
    date: dateValue,
    card,
    description: document.getElementById('txn-description').value.trim(),
    category,
    amount,
    type: document.getElementById('txn-type').value,
    pointsEarned: parseInt(document.getElementById('txn-points').value) || 0,
    transactionTag: document.getElementById('txn-tag').value,
    statementPeriod: document.getElementById('txn-statement-period').value.trim(),
    reimbursable: document.getElementById('txn-reimbursable').checked,
    notes: document.getElementById('txn-notes').value.trim(),
    month: getMonthStr(new Date(dateStr)),
    source: (id && editingOriginal?.source) ? editingOriginal.source : 'manual'
  };

  const ok = await guardWrite(
    () => id
      ? updateDoc(doc(db, 'transactions', id), data)
      : addDoc(collection(db, 'transactions'), data),
    id ? 'Update transaction' : 'Add transaction'
  );
  if (!ok) return;

  showToast(id ? 'Transaction updated.' : 'Transaction added.', 'success');
  closeTransactionModal();

  if (id && !hasActiveFilters()) {
    await patchRowInPlace({ id, ...data });
  } else {
    loadTransactions(true);
  }
}

export async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  if (!await guardWrite(() => deleteDoc(doc(db, 'transactions', id)), 'Delete transaction')) return;
  showToast('Transaction deleted.', 'success');
  removeRowFromDom(id);
}

async function loadFilteredTransactions() {
  const list = document.getElementById('transactions-list');
  list.innerHTML = '<tr><td colspan="8" class="loading">Loading…</td></tr>';
  document.getElementById('load-more-btn').style.display = 'none';

  try {
    const f = colFilters;
    const constraints = [orderBy('date', 'desc')];
    if (f.date.from) constraints.push(where('date', '>=', Timestamp.fromDate(new Date(f.date.from + 'T00:00:00'))));
    if (f.date.to)   constraints.push(where('date', '<=', Timestamp.fromDate(new Date(f.date.to + 'T23:59:59'))));

    const snap = await getDocs(query(collection(db, 'transactions'), ...constraints));
    let txns = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (f.card.length)     txns = txns.filter(t => f.card.includes(t.card));
    if (f.category.length) txns = txns.filter(t => f.category.includes(t.category));
    if (f.tag.length)      txns = txns.filter(t => f.tag.includes(t.transactionTag || ''));
    if (f.description) {
      const q = f.description.toLowerCase();
      txns = txns.filter(t => (t.description || '').toLowerCase().includes(q));
    }
    if (f.amount.min !== '') { const m = parseFloat(f.amount.min); if (!isNaN(m)) txns = txns.filter(t => (t.amount || 0) >= m); }
    if (f.amount.max !== '') { const m = parseFloat(f.amount.max); if (!isNaN(m)) txns = txns.filter(t => (t.amount || 0) <= m); }

    const vtChildMap = await buildVtEnrichment(txns);
    renderTransactions(txns, true, vtChildMap);
  } catch (e) {
    console.error('Filtered transactions load failed:', e);
    list.innerHTML = `<tr><td colspan="8" class="error">Couldn't load transactions: ${e.message}</td></tr>`;
  }
}

export function closeTransactionModal() {
  document.getElementById('transaction-modal').classList.add('hidden');
}

// ── Excel export ──────────────────────────────────────────────────
// SheetJS (xlsx) is vendored at js/vendor/xlsx.full.min.js but lazy-loaded
// on first click — it's ~880KB and most sessions never export.
function loadXlsxLibrary() {
  return new Promise((resolve, reject) => {
    if (typeof XLSX !== 'undefined') return resolve();
    const s = document.createElement('script');
    s.src = 'js/vendor/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load xlsx library'));
    document.head.appendChild(s);
  });
}

export async function exportTransactionsXlsx() {
  const btn = document.getElementById('export-xlsx-btn');
  if (btn) btn.disabled = true;
  try {
    await loadXlsxLibrary();
    const snap = await getDocs(query(collection(db, 'transactions'), orderBy('date', 'desc')));
    const rows = snap.docs.map(d => {
      const t = d.data();
      return {
        Date: t.date?.toDate ? t.date.toDate() : t.date,
        Card: t.card || '',
        Description: t.description || '',
        Category: t.category || '',
        Type: t.type || '',
        Amount: t.amount || 0,
        Points: t.pointsEarned || 0,
        Tag: t.transactionTag || '',
        'Statement Period': t.statementPeriod || '',
        Reimbursable: t.reimbursable ? 'Yes' : '',
        Source: t.source || '',
        Notes: t.notes || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `cards-tracker-${today}.xlsx`);
    showToast(`Exported ${rows.length} transactions.`, 'success');
  } catch (e) {
    console.error('Export failed:', e);
    showToast(`Export failed: ${e.message || e}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
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
