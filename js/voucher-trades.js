import { collection, addDoc, updateDoc, doc, Timestamp, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { getTxns, getVts, onStoreChange } from './store.js';
import { formatCurrency, formatDate, formatDateInput, aggregateChildStatus, sumChildHaircut, computeChildHaircutPnl, guardWrite, showToast } from './utils.js';

let creditTxnsCache = null; // populated on first child-edit modal open per session

let showCompleted = false;

// Read the current doc straight from the live store instead of a server-first
// getDoc. A getDoc on a zombie connection (iOS PWA resumed from background)
// hangs until the dead channel times out — that was the "click the tick, enter
// an amount, nothing happens" freeze. The store is already in memory and
// latency-compensated, so these are instant and always reflect local writes.
async function vtById(id) { return (await getVts()).find(v => v.id === id) || null; }
async function txnById(id) { return (await getTxns()).find(t => t.id === id) || null; }

// Re-render the VT tab whenever the store changes (a local write's latency-
// compensated snapshot, or an edit from another device) while the tab is on
// screen. Save handlers no longer await the server commit or reload manually —
// they close the modal and let this fire, so a flaky connection can't freeze
// the flow.
let liveWired = false;
function wireVtLiveRefresh() {
  if (liveWired) return;
  liveWired = true;
  onStoreChange(() => {
    const panel = document.getElementById('tab-voucher-trades');
    if (panel && !panel.classList.contains('hidden')) loadVoucherTrades();
  });
}

export async function loadVoucherTrades() {
  wireVtLiveRefresh();
  const container = document.getElementById('voucher-trades-list');
  if (!container.querySelector('table')) container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const vts = await getVts();
    const ms = v => (v.purchaseDate && v.purchaseDate.toMillis) ? v.purchaseDate.toMillis()
               : (v.purchaseDate ? new Date(v.purchaseDate).getTime() : -Infinity);
    const all = [...vts].sort((a, b) => ms(b) - ms(a));

    const parents = all.filter(d => d.isParent);
    const childrenByParent = new Map();
    for (const d of all) {
      if (d.parentId) {
        if (!childrenByParent.has(d.parentId)) childrenByParent.set(d.parentId, []);
        childrenByParent.get(d.parentId).push(d);
      }
    }
    // sort children by purchaseDate asc within each parent for stable display
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => (a.purchaseDate?.seconds || 0) - (b.purchaseDate?.seconds || 0));
    }
    const legacy = all.filter(d => !d.isParent && !d.parentId);

    renderVoucherTrades(parents, childrenByParent, legacy);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderVoucherTrades(parents, childrenByParent, legacy) {
  const container = document.getElementById('voucher-trades-list');

  const items = [
    ...parents.map(p => ({ kind: 'parent', doc: p, sortKey: p.purchaseDate?.seconds || 0 })),
    ...legacy.map(l => ({ kind: 'legacy', doc: l, sortKey: l.purchaseDate?.seconds || 0 })),
  ];
  items.sort((a, b) => b.sortKey - a.sortKey);

  const visibleItems = items.filter(item => {
    if (showCompleted) return true;
    if (item.kind === 'legacy') return item.doc.status !== 'Traded';
    const status = aggregateChildStatus(childrenByParent.get(item.doc.id) || []);
    return status !== 'Traded';
  });

  if (visibleItems.length === 0) {
    container.innerHTML = '<p class="empty">No pending voucher trades.</p>';
    return;
  }

  const showCash = showCompleted;
  const rows = visibleItems.map(item => {
    if (item.kind === 'legacy') return renderLegacyRow(item.doc, showCash);
    return renderParentRows(item.doc, childrenByParent.get(item.doc.id) || [], showCash);
  }).join('');

  container.innerHTML = `
    <table class="data-table vt-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Card</th>
          <th>Description</th>
          <th>Amount</th>
          ${showCash ? '<th>Cash / Haircut</th>' : ''}
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderLegacyRow(t, showCash) {
  return `
    <tr class="${t.status === 'Pending' ? 'pending-row' : ''}">
      <td data-label="Date">${formatDate(t.purchaseDate)}</td>
      <td data-label="Card">${t.card || ''}</td>
      <td data-label="Description">${t.description || ''}</td>
      <td data-label="Amount">${formatCurrency(t.purchaseAmount)}</td>
      ${showCash ? `<td data-label="Cash / Haircut">${t.cashReceived ? formatCurrency(t.cashReceived) : '—'}</td>` : ''}
      <td data-label="Status"><span class="status-badge ${t.status === 'Pending' ? 'badge-orange' : 'badge-green'}">${t.status}</span></td>
      <td class="actions-cell" data-label="Action">
        ${t.status === 'Pending' ? `<button class="btn-icon" title="Mark Traded" onclick="window.openMarkTradedModal('${t.id}')">✓</button>` : ''}
        <button class="btn-icon" title="Edit" onclick="window.openEditTradeModal('${t.id}')">✏️</button>
      </td>
    </tr>
  `;
}

function renderParentRows(parent, children, showCash) {
  const status = aggregateChildStatus(children);
  const totalHaircut = sumChildHaircut(children);

  // Single-split: collapse into one row.
  if (children.length === 1) {
    const c = children[0];
    const cashCell = c.status === 'Traded'
      ? `${formatCurrency(c.cashReceived)} <span class="vt-haircut-inline">(haircut ${formatCurrency(c.haircut)})</span>`
      : '—';
    return `
      <tr class="${c.status === 'Pending' ? 'pending-row' : ''} vt-parent-row">
        <td data-label="Date">${formatDate(parent.purchaseDate)}</td>
        <td data-label="Card">${parent.card || ''}</td>
        <td data-label="Description"><strong>${parent.description || ''}</strong>${c.description && c.description !== parent.description ? ` <span class="vt-split-count">· ${c.description}</span>` : ''}</td>
        <td data-label="Amount">${formatCurrency(c.purchaseAmount)}</td>
        ${showCash ? `<td data-label="Cash / Haircut">${cashCell}</td>` : ''}
        <td data-label="Status"><span class="status-badge ${c.status === 'Pending' ? 'badge-orange' : 'badge-green'}">${c.status}</span></td>
        <td class="actions-cell" data-label="Action">
          <button class="btn-icon" title="${c.status === 'Traded' ? 'Edit settlement' : 'Settle'}" onclick="window.openSettleVtModal('${c.id}')">✓</button>
          <button class="btn-icon" title="Edit splits" onclick="window.openEditSplitsModal('${parent.id}')">✏️</button>
          <button class="btn-icon" title="Delete" onclick="window.deleteVtParent('${parent.id}')">🗑️</button>
        </td>
      </tr>
    `;
  }

  const haircutCell = status === 'Traded' && children.length > 0
    ? `<span class="vt-haircut-chip">Haircut ${formatCurrency(totalHaircut)}</span>`
    : '—';

  const parentRow = `
    <tr class="${status === 'Pending' ? 'pending-row' : ''} vt-parent-row">
      <td data-label="Date">${formatDate(parent.purchaseDate)}</td>
      <td data-label="Card">${parent.card || ''}</td>
      <td data-label="Description"><strong>${parent.description || ''}</strong></td>
      <td data-label="Amount">${formatCurrency(parent.purchaseAmount)}</td>
      ${showCash ? `<td data-label="Cash / Haircut">${haircutCell}</td>` : ''}
      <td data-label="Status"><span class="status-badge ${status === 'Pending' ? 'badge-orange' : 'badge-green'}">${status}</span></td>
      <td class="actions-cell" data-label="Action">
        <button class="btn-icon" title="Edit splits" onclick="window.openEditSplitsModal('${parent.id}')">✏️</button>
        <button class="btn-icon" title="Delete" onclick="window.deleteVtParent('${parent.id}')">🗑️</button>
      </td>
    </tr>
  `;

  const childRows = children.map(c => {
    const cashCell = c.status === 'Traded'
      ? `${formatCurrency(c.cashReceived)} <span class="vt-haircut-inline">(haircut ${formatCurrency(c.haircut)})</span>`
      : '—';
    return `
      <tr class="vt-child-row ${c.status === 'Pending' ? 'pending-row' : ''}">
        <td data-label="Date">${c.tradeDate ? formatDate(c.tradeDate) : '↳'}</td>
        <td data-label="Card"></td>
        <td class="vt-child-desc" data-label="Description">${c.description || ''}</td>
        <td data-label="Amount">${formatCurrency(c.purchaseAmount)}</td>
        ${showCash ? `<td data-label="Cash / Haircut">${cashCell}</td>` : ''}
        <td data-label="Status"><span class="status-badge ${c.status === 'Pending' ? 'badge-orange' : 'badge-green'}">${c.status}</span></td>
        <td class="actions-cell" data-label="Action">
          <button class="btn-icon" title="${c.status === 'Traded' ? 'Edit settlement' : 'Settle'}" onclick="window.openSettleVtModal('${c.id}')">✓</button>
        </td>
      </tr>
    `;
  }).join('');

  return parentRow + childRows;
}

// ─── Legacy doc handlers (unchanged) ─────────────────────────────────────────

export async function openMarkTradedModal(id) {
  const trade = await vtById(id);
  if (!trade) return;

  document.getElementById('mark-traded-id').value = id;
  document.getElementById('mark-traded-trade-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('mark-traded-cash').value = trade.purchaseAmount || '';
  document.getElementById('mark-traded-desc').textContent = `${trade.card} — ${trade.description} (${formatCurrency(trade.purchaseAmount)})`;

  document.getElementById('mark-traded-modal').classList.remove('hidden');
}

export async function saveMarkTraded() {
  const id = document.getElementById('mark-traded-id').value;
  const tradeDateStr = document.getElementById('mark-traded-trade-date').value;
  const cashReceived = parseFloat(document.getElementById('mark-traded-cash').value);

  if (!tradeDateStr || isNaN(cashReceived) || cashReceived < 0) {
    alert('Enter a valid trade date and a non-negative cash amount.');
    return;
  }

  const trade = await vtById(id);
  if (!trade) return;
  const purchaseAmount = trade.purchaseAmount || 0;
  const haircut = purchaseAmount > 0 ? ((purchaseAmount - cashReceived) / purchaseAmount * 100) : 0;

  closeMarkTradedModal();
  guardWrite(() => updateDoc(doc(db, 'voucherTrades', id), {
    status: 'Traded',
    tradeDate: Timestamp.fromDate(new Date(tradeDateStr)),
    cashReceived,
    haircut: parseFloat(haircut.toFixed(2)),
    netPnl: cashReceived - purchaseAmount
  }), 'Mark as traded');
}

export async function openAddTradeModal() {
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  const cards = cardsSnap.exists() ? Object.keys(cardsSnap.data()) : [];
  document.getElementById('trade-card').innerHTML = cards.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('trade-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('trade-id').value = '';
  document.getElementById('trade-description').value = '';
  document.getElementById('trade-amount').value = '';
  document.getElementById('trade-points').value = '';
  document.getElementById('add-trade-modal').classList.remove('hidden');
}

export async function openEditTradeModal(id) {
  const trade = await vtById(id);
  if (!trade) return;
  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  const cards = cardsSnap.exists() ? Object.keys(cardsSnap.data()) : [];

  document.getElementById('trade-card').innerHTML = cards.map(c => `<option value="${c}" ${trade.card === c ? 'selected' : ''}>${c}</option>`).join('');
  document.getElementById('trade-id').value = id;
  document.getElementById('trade-date').value = trade.purchaseDate ? formatDateInput(trade.purchaseDate.toDate()) : '';
  document.getElementById('trade-description').value = trade.description || '';
  document.getElementById('trade-amount').value = trade.purchaseAmount || '';
  document.getElementById('trade-points').value = trade.pointsEarned || '';
  document.getElementById('add-trade-modal').classList.remove('hidden');
}

export async function saveTrade() {
  const id = document.getElementById('trade-id').value;
  const dateStr = document.getElementById('trade-date').value;
  const amount = parseFloat(document.getElementById('trade-amount').value);

  if (!dateStr) { alert('Pick a purchase date.'); return; }
  if (isNaN(amount) || amount <= 0) { alert('Enter a purchase amount greater than zero.'); return; }

  const data = {
    purchaseDate: Timestamp.fromDate(new Date(dateStr)),
    card: document.getElementById('trade-card').value,
    description: document.getElementById('trade-description').value.trim(),
    purchaseAmount: amount,
    pointsEarned: parseInt(document.getElementById('trade-points').value) || 0,
    status: 'Pending'
  };

  closeAddTradeModal();
  guardWrite(
    () => id
      ? updateDoc(doc(db, 'voucherTrades', id), data)
      : addDoc(collection(db, 'voucherTrades'), data),
    id ? 'Update voucher trade' : 'Add voucher trade'
  );
}

export function toggleCompleted() {
  showCompleted = !showCompleted;
  const btn = document.getElementById('toggle-completed-btn');
  btn.textContent = showCompleted ? 'Hide Completed' : 'Show Completed';
  loadVoucherTrades();
}

export function closeMarkTradedModal() {
  document.getElementById('mark-traded-modal').classList.add('hidden');
}

export function closeAddTradeModal() {
  document.getElementById('add-trade-modal').classList.add('hidden');
}

// ─── Delete VT parent (cascade) ──────────────────────────────────────────────

export async function deleteVtParent(id) {
  if (!confirm('Delete this voucher trade and ALL its splits? The linked debit transaction will be unlinked.')) return;
  const vts = await getVts();
  const txns = await getTxns();
  const children = vts.filter(v => v.parentId === id);
  const linkedTxns = txns.filter(t => t.voucherTradeParentId === id);

  const batch = writeBatch(db);
  batch.delete(doc(db, 'voucherTrades', id));
  children.forEach(c => batch.delete(doc(db, 'voucherTrades', c.id)));
  // Also strip child ids from any settling credit txn arrays.
  for (const c of children) {
    const settleId = c.settlementTransactionId;
    if (settleId) {
      const s = txns.find(t => t.id === settleId);
      if (s) {
        const arr = (s.voucherTradeChildIds || []).filter(x => x !== c.id);
        batch.update(doc(db, 'transactions', settleId), { voucherTradeChildIds: arr });
      }
    }
  }
  linkedTxns.forEach(t => batch.update(doc(db, 'transactions', t.id), { voucherTradeParentId: null }));
  guardWrite(() => batch.commit(), 'Delete voucher trade');
}

// ─── Manage Splits modal (parent edit) ───────────────────────────────────────

let editSplitsState = { parentId: null, parent: null, originalChildren: [] };

export async function openEditSplitsModal(parentId) {
  const vts = await getVts();
  const parent = vts.find(v => v.id === parentId);
  if (!parent) return;
  const children = vts.filter(v => v.parentId === parentId);

  editSplitsState = { parentId, parent, originalChildren: children };
  document.getElementById('edit-splits-parent-id').value = parentId;
  document.getElementById('edit-splits-summary').textContent =
    `${parent.card || ''} — ${parent.description || ''} (${formatCurrency(parent.purchaseAmount)})`;

  const rows = document.getElementById('edit-splits-rows');
  rows.innerHTML = '';
  children.forEach(c => appendEditSplitRow(c));
  if (children.length === 0) appendEditSplitRow({});
  document.getElementById('edit-splits-modal').classList.remove('hidden');
}

function appendEditSplitRow(child = {}) {
  const rows = document.getElementById('edit-splits-rows');
  const row = document.createElement('div');
  row.className = 'vt-split-row form-row two-col';
  row.dataset.id = child.id || '';
  row.dataset.status = child.status || 'Pending';
  const isTraded = child.status === 'Traded';
  row.innerHTML = `
    <div>
      <label>Description ${isTraded ? '<span class="status-badge badge-green" style="margin-left:6px">Traded</span>' : ''}</label>
      <input type="text" class="vt-split-desc" value="${(child.description || '').replace(/"/g, '&quot;')}" placeholder="Voucher description">
    </div>
    <div class="vt-split-amount-wrap">
      <label>Amount (₹)</label>
      <div class="vt-split-amount-inline">
        <input type="number" class="vt-split-amount" step="0.01" min="0" value="${child.purchaseAmount ?? ''}">
        <button type="button" class="btn btn-sm btn-link vt-split-remove" title="${isTraded ? 'Cannot remove a traded split' : 'Remove split'}" ${isTraded ? 'disabled' : ''}>✕</button>
      </div>
    </div>
  `;
  row.querySelector('.vt-split-remove').addEventListener('click', () => {
    if (isTraded) return;
    row.remove();
  });
  rows.appendChild(row);
}

export function addEditSplitRow() { appendEditSplitRow({}); }

export async function saveEditSplits() {
  const { parentId, parent, originalChildren } = editSplitsState;
  if (!parentId) return;

  const rows = [...document.querySelectorAll('#edit-splits-rows .vt-split-row')];
  const entries = rows.map(r => ({
    id: r.dataset.id || null,
    status: r.dataset.status,
    description: r.querySelector('.vt-split-desc').value.trim(),
    amount: parseFloat(r.querySelector('.vt-split-amount').value),
  })).filter(e => !isNaN(e.amount));

  if (entries.length === 0) { alert('At least one split required.'); return; }
  if (entries.some(e => e.amount <= 0)) { alert('Each split amount must be greater than zero.'); return; }

  const total = entries.reduce((s, e) => s + e.amount, 0);
  if (total > (parent.purchaseAmount || 0) + 0.01) {
    alert(`Split total ${formatCurrency(total)} exceeds the source debit amount ${formatCurrency(parent.purchaseAmount)}.`);
    return;
  }

  const keptIds = new Set(entries.filter(e => e.id).map(e => e.id));
  const removed = originalChildren.filter(c => !keptIds.has(c.id));
  if (removed.some(c => c.status === 'Traded')) {
    alert('Cannot remove a traded split. Unsettle it first.');
    return;
  }

  const batch = writeBatch(db);
  for (const e of entries) {
    if (e.id) {
      const existing = originalChildren.find(c => c.id === e.id);
      const update = { description: e.description, purchaseAmount: e.amount };
      if (existing && existing.status === 'Traded' && existing.cashReceived != null) {
        const { haircut, netPnl } = computeChildHaircutPnl(e.amount, existing.cashReceived);
        update.haircut = haircut;
        update.netPnl = netPnl;
      }
      batch.update(doc(db, 'voucherTrades', e.id), update);
    } else {
      batch.set(doc(collection(db, 'voucherTrades')), {
        parentId,
        purchaseDate: parent.purchaseDate,
        card: parent.card,
        description: e.description,
        purchaseAmount: e.amount,
        status: 'Pending',
      });
    }
  }
  for (const c of removed) batch.delete(doc(db, 'voucherTrades', c.id));

  document.getElementById('edit-splits-modal').classList.add('hidden');
  guardWrite(() => batch.commit(), 'Save splits');
}

// ─── Settle modal (child) ────────────────────────────────────────────────────

export async function openSettleVtModal(childId) {
  const c = await vtById(childId);
  if (!c) return;
  const isAlreadyTraded = c.status === 'Traded';

  document.getElementById('settle-vt-id').value = childId;
  document.getElementById('settle-vt-title').textContent = isAlreadyTraded ? 'Edit Settlement' : 'Settle Voucher Trade';
  document.getElementById('settle-vt-summary').textContent =
    `${c.card || ''} — ${c.description || ''} (${formatCurrency(c.purchaseAmount)})`;
  document.getElementById('settle-vt-trade-date').value = c.tradeDate
    ? formatDateInput(c.tradeDate.toDate())
    : new Date().toISOString().split('T')[0];
  document.getElementById('settle-vt-cash').value = c.cashReceived ?? c.purchaseAmount ?? '';

  await populateCreditTxnDropdown('settle-vt-credit-link', c.settlementTransactionId || '');
  document.getElementById('unsettle-vt-btn').classList.toggle('hidden', !isAlreadyTraded);
  document.getElementById('settle-vt-modal').classList.remove('hidden');
}

export function onSettleVtCreditChange() {
  const id = document.getElementById('settle-vt-credit-link').value;
  if (!id || !creditTxnsCache) return;
  const t = creditTxnsCache.find(x => x.id === id);
  if (!t) return;
  document.getElementById('settle-vt-trade-date').value = t.date ? formatDateInput(t.date.toDate()) : '';
  document.getElementById('settle-vt-cash').value = t.amount || '';
}

export async function saveSettleVt() {
  const id = document.getElementById('settle-vt-id').value;
  const tradeDateStr = document.getElementById('settle-vt-trade-date').value;
  const cash = parseFloat(document.getElementById('settle-vt-cash').value);
  const linkedCreditId = document.getElementById('settle-vt-credit-link').value || null;
  if (!tradeDateStr || isNaN(cash) || cash < 0) { alert('Enter a valid trade date and a non-negative cash amount.'); return; }

  const c = await vtById(id);
  if (!c) return;
  const prevSettlementId = c.settlementTransactionId || null;
  const { haircut, netPnl } = computeChildHaircutPnl(c.purchaseAmount || 0, cash);

  const batch = writeBatch(db);
  batch.update(doc(db, 'voucherTrades', id), {
    status: 'Traded',
    tradeDate: Timestamp.fromDate(new Date(tradeDateStr)),
    cashReceived: cash,
    haircut,
    netPnl,
    settlementTransactionId: linkedCreditId,
  });
  await syncCreditLinkArrays(batch, id, prevSettlementId, linkedCreditId);

  document.getElementById('settle-vt-modal').classList.add('hidden');
  guardWrite(() => batch.commit(), 'Settle voucher trade');
}

export async function unsettleVt() {
  const id = document.getElementById('settle-vt-id').value;
  const c = await vtById(id);
  if (!c) return;
  const prevSettlementId = c.settlementTransactionId || null;

  const batch = writeBatch(db);
  batch.update(doc(db, 'voucherTrades', id), {
    status: 'Pending',
    tradeDate: null,
    cashReceived: null,
    haircut: null,
    netPnl: null,
    settlementTransactionId: null,
  });
  await syncCreditLinkArrays(batch, id, prevSettlementId, null);

  document.getElementById('settle-vt-modal').classList.add('hidden');
  guardWrite(() => batch.commit(), 'Unsettle voucher trade');
}

async function syncCreditLinkArrays(batch, childId, prevSettlementId, newSettlementId) {
  if (prevSettlementId && prevSettlementId !== newSettlementId) {
    const prev = await txnById(prevSettlementId);
    if (prev) {
      const arr = (prev.voucherTradeChildIds || []).filter(x => x !== childId);
      batch.update(doc(db, 'transactions', prevSettlementId), { voucherTradeChildIds: arr });
    }
  }
  if (newSettlementId && newSettlementId !== prevSettlementId) {
    const next = await txnById(newSettlementId);
    if (next) {
      const arr = next.voucherTradeChildIds || [];
      if (!arr.includes(childId)) batch.update(doc(db, 'transactions', newSettlementId), { voucherTradeChildIds: [...arr, childId] });
    }
  }
}

async function populateCreditTxnDropdown(selectId, selectedId) {
  if (!creditTxnsCache) {
    const txns = await getTxns();
    const ms = t => (t.date && t.date.toMillis) ? t.date.toMillis()
               : (t.date ? new Date(t.date).getTime() : -Infinity);
    creditTxnsCache = txns
      .filter(t => t.type === 'credit')
      .sort((a, b) => ms(b) - ms(a))
      .slice(0, 60);
  }
  const select = document.getElementById(selectId);
  select.innerHTML = `<option value="">— Cash settlement (no credit txn) —</option>` +
    creditTxnsCache.map(t => `
      <option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>
        ${formatDate(t.date)} · ${t.card || ''} · ${t.description || '(no desc)'} · ${formatCurrency(t.amount)}
      </option>
    `).join('');
}
