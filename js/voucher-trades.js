import { collection, query, where, getDocs, addDoc, updateDoc, doc, orderBy, Timestamp, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, formatDate, formatDateInput } from './utils.js';

let showCompleted = false;

export async function loadVoucherTrades() {
  const container = document.getElementById('voucher-trades-list');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    let q;
    if (showCompleted) {
      q = query(collection(db, 'voucherTrades'), orderBy('purchaseDate', 'desc'));
    } else {
      q = query(collection(db, 'voucherTrades'), where('status', '==', 'Pending'), orderBy('purchaseDate', 'desc'));
    }

    const snap = await getDocs(q);
    const trades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderVoucherTrades(trades);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderVoucherTrades(trades) {
  const container = document.getElementById('voucher-trades-list');

  if (trades.length === 0) {
    container.innerHTML = '<p class="empty">No pending voucher trades.</p>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Card</th>
          <th>Description</th>
          <th>Amount</th>
          <th>Cash Received</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${trades.map(t => `
          <tr class="${t.status === 'Pending' ? 'pending-row' : ''}">
            <td>${formatDate(t.purchaseDate)}</td>
            <td>${t.card || ''}</td>
            <td>${t.description || ''}</td>
            <td>${formatCurrency(t.purchaseAmount)}</td>
            <td>${t.cashReceived ? formatCurrency(t.cashReceived) : '—'}</td>
            <td><span class="status-badge ${t.status === 'Pending' ? 'badge-orange' : 'badge-green'}">${t.status}</span></td>
            <td>
              ${t.status === 'Pending' ? `<button class="btn btn-sm btn-primary" onclick="window.openMarkTradedModal('${t.id}')">Mark Traded</button>` : ''}
              <button class="btn btn-sm btn-secondary" onclick="window.openEditTradeModal('${t.id}')">Edit</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export async function openMarkTradedModal(id) {
  const snap = await getDoc(doc(db, 'voucherTrades', id));
  if (!snap.exists()) return;
  const trade = { id, ...snap.data() };

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

  if (!tradeDateStr || isNaN(cashReceived)) {
    alert('Please fill in trade date and cash received.');
    return;
  }

  const snap = await getDoc(doc(db, 'voucherTrades', id));
  const trade = snap.data();
  const purchaseAmount = trade.purchaseAmount || 0;
  const haircut = purchaseAmount > 0 ? ((purchaseAmount - cashReceived) / purchaseAmount * 100) : 0;

  await updateDoc(doc(db, 'voucherTrades', id), {
    status: 'Traded',
    tradeDate: Timestamp.fromDate(new Date(tradeDateStr)),
    cashReceived,
    haircut: parseFloat(haircut.toFixed(2)),
    netPnl: cashReceived - purchaseAmount
  });

  closeMarkTradedModal();
  loadVoucherTrades();
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
  const snap = await getDoc(doc(db, 'voucherTrades', id));
  if (!snap.exists()) return;
  const trade = snap.data();
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

  if (!dateStr || isNaN(amount)) {
    alert('Please fill in date and amount.');
    return;
  }

  const data = {
    purchaseDate: Timestamp.fromDate(new Date(dateStr)),
    card: document.getElementById('trade-card').value,
    description: document.getElementById('trade-description').value.trim(),
    purchaseAmount: amount,
    pointsEarned: parseInt(document.getElementById('trade-points').value) || 0,
    status: 'Pending'
  };

  if (id) {
    await updateDoc(doc(db, 'voucherTrades', id), data);
  } else {
    await addDoc(collection(db, 'voucherTrades'), data);
  }

  closeAddTradeModal();
  loadVoucherTrades();
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
