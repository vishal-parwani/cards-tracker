import {
  collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc,
  orderBy, Timestamp, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { getTxns } from './store.js';
import { formatCurrency, guardWrite } from './utils.js';
import { isAepEligible, computeAepBands, resolveDashboardWidget } from './points-config.js';

const TOLERANCE_PTS = 500;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(year, month1) { return `${MONTH_NAMES[month1 - 1]} ${year}`; }
function monthSortKey(year, month1) { return `${year}-${String(month1).padStart(2, '0')}`; }

// The AEP ledger follows whichever card is assigned the 'mbAep' dashboard
// widget, so renaming the Magnus card doesn't break it.
async function resolveMbAepCardName() {
  const snap = await getDoc(doc(db, 'config', 'cards'));
  const cards = snap.exists() ? snap.data() : {};
  for (const [name, val] of Object.entries(cards)) {
    if (resolveDashboardWidget(name, val) === 'mbAep') return name;
  }
  return null;
}

async function computeAepForMonth(monthSort, cardName) {
  const [year, month1] = monthSort.split('-').map(Number);
  const monthStart = new Date(year, month1 - 1, 1);
  const monthEnd   = new Date(year, month1, 1);

  // Txns from the shared live store (this used to run one card+month
  // Firestore query PER LEDGER ROW); mbAep is one small config doc.
  const [allTxns, mbAepSnap] = await Promise.all([
    getTxns(),
    getDoc(doc(db, 'config', 'mbAep')),
  ]);

  const mbAep = mbAepSnap.exists() ? mbAepSnap.data() : {};

  let totalDebit = 0, eligibleSpend = 0, txnCount = 0, ineligibleCount = 0;
  allTxns.forEach(t => {
    if (t.card !== cardName || t.type !== 'debit' || !t.date) return;
    const d = t.date.toDate ? t.date.toDate() : new Date(t.date);
    if (d < monthStart || d >= monthEnd) return;
    txnCount++;
    totalDebit += t.amount || 0;
    if (isAepEligible(t)) eligibleSpend += t.amount || 0;
    else ineligibleCount++;
  });

  const b = computeAepBands(eligibleSpend, mbAep);

  // The ledger tracks the AEP milestone credit, i.e. the ACCELERATED points
  // only (`aepPoints`) — not the base points that post per-transaction.
  return {
    eligibleSpend, totalDebit, txnCount, ineligibleCount,
    band: b.band, calculatedPoints: b.aepPoints,
    breakdown: {
      band1Bonus: b.band1Bonus, band2Bonus: b.band2Bonus, band3Bonus: b.band3Bonus,
      band1Max: b.band1Max, band2Max: b.band2Max,
      band1Rate: b.band1Rate, band2Rate: b.band2Rate, band3Rate: b.band3Rate,
    },
  };
}

// Returns {year, month1} pairs for past months that:
//   • have Magnus debit spend AND
//   • the 3rd of the following month has arrived
async function findMissingLedgerMonths(existingMonthSorts, cardName) {
  const allTxns = await getTxns();
  const monthsSeen = new Set();
  allTxns.forEach(t => {
    if (t.card !== cardName || t.type !== 'debit' || !t.date?.toDate) return;
    const dt = t.date.toDate();
    monthsSeen.add(monthSortKey(dt.getFullYear(), dt.getMonth() + 1));
  });

  const today = new Date();
  const missing = [];
  for (const ms of monthsSeen) {
    if (existingMonthSorts.has(ms)) continue;
    const [y, m1] = ms.split('-').map(Number);
    // Cutoff = 3rd of the month AFTER (y, m1).
    const cutoff = new Date(y, m1, 3);  // month index m1 (0-based) = next month
    if (today >= cutoff) missing.push({ year: y, month1: m1, monthSort: ms });
  }
  return missing;
}

export async function loadAepLedger() {
  const container = document.getElementById('aep-ledger-list');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const cardName = await resolveMbAepCardName();
    if (!cardName) {
      container.innerHTML = '<p class="empty">No card is assigned the Magnus AEP widget. In Settings, set a card\'s "Dashboard Spend Tracker" to Magnus AEP.</p>';
      return;
    }

    const rowsSnap = await getDocs(query(
      collection(db, 'aepLedger'), orderBy('monthSort', 'desc'),
    ));
    const rows = [];
    const existingMonthSorts = new Set();
    rowsSnap.forEach(d => {
      const data = d.data();
      rows.push({ id: d.id, ...data });
      existingMonthSorts.add(data.monthSort);
    });

    // Auto-create any missing past-month rows once their cutoff has passed.
    const missing = await findMissingLedgerMonths(existingMonthSorts, cardName);
    for (const m of missing) {
      const docId = monthLabel(m.year, m.month1);
      const newRow = {
        month: docId,
        monthSort: m.monthSort,
        status: 'pending',
        receivedPoints: null,
        receivedDate: null,
        notes: '',
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'aepLedger', docId), newRow);
      rows.push({ id: docId, ...newRow });
    }
    rows.sort((a, b) => b.monthSort.localeCompare(a.monthSort));

    if (rows.length === 0) {
      container.innerHTML = '<p class="empty">No AEP rows yet. The first row will appear on the 3rd of the month after a Magnus AEP-eligible txn lands.</p>';
      return;
    }

    const enriched = await Promise.all(rows.map(async r => ({
      ...r,
      calc: await computeAepForMonth(r.monthSort, cardName),
    })));

    container.innerHTML = renderTable(enriched);
  } catch (e) {
    container.innerHTML = `<p class="error">Error loading AEP ledger: ${e.message}</p>`;
  }
}

function renderTable(rows) {
  return `
    <table class="data-table aep-table">
      <thead>
        <tr>
          <th>Month</th>
          <th>Eligible Spend</th>
          <th>Band</th>
          <th>Calculated AEP</th>
          <th>Received</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${rows.map(renderRow).join('')}</tbody>
    </table>
  `;
}

function renderRow(r) {
  const c = r.calc;
  const calcStr = c.calculatedPoints.toLocaleString('en-IN');
  const receivedStr = r.receivedPoints != null ? r.receivedPoints.toLocaleString('en-IN') : '—';
  let statusBadge;
  if (r.status === 'received') {
    const diff = (r.receivedPoints || 0) - c.calculatedPoints;
    const absDiff = Math.abs(diff);
    if (absDiff <= TOLERANCE_PTS) {
      statusBadge = `<span class="status-badge badge-green">Received</span>`;
    } else {
      const sign = diff > 0 ? '+' : '−';
      statusBadge = `<span class="status-badge badge-red">Discrepancy ${sign}${absDiff.toLocaleString('en-IN')}</span>`;
    }
  } else {
    statusBadge = `<span class="status-badge badge-orange">Pending</span>`;
  }
  return `
    <tr>
      <td data-label="Month"><strong>${r.month}</strong></td>
      <td data-label="Eligible Spend">${formatCurrency(c.eligibleSpend)}</td>
      <td data-label="Band">${c.band}</td>
      <td data-label="Calculated">${calcStr}</td>
      <td data-label="Received">${receivedStr}</td>
      <td data-label="Status">${statusBadge}</td>
      <td class="actions-cell" data-label="Action">
        <button class="btn-icon" title="Mark / Edit Received" onclick="window.openMarkAepReceivedModal('${r.id}')">✓</button>
        <button class="btn-icon" title="View calculation" onclick="window.openAepDetailModal('${r.id}')">🔍</button>
      </td>
    </tr>
  `;
}

// ─── Modal: Mark Received ────────────────────────────────────────────────
let markReceivedState = { id: null };

export async function openMarkAepReceivedModal(id) {
  const snap = await getDoc(doc(db, 'aepLedger', id));
  if (!snap.exists()) return;
  const r = snap.data();
  markReceivedState = { id };
  document.getElementById('aep-received-month').textContent = r.month;
  document.getElementById('aep-received-points').value = r.receivedPoints ?? '';
  document.getElementById('aep-received-date').value = r.receivedDate?.toDate
    ? r.receivedDate.toDate().toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  document.getElementById('aep-received-notes').value = r.notes ?? '';
  document.getElementById('aep-received-modal').classList.remove('hidden');
}

export async function saveAepReceived() {
  const { id } = markReceivedState;
  if (!id) return;
  const ptsStr  = document.getElementById('aep-received-points').value;
  const dateStr = document.getElementById('aep-received-date').value;
  const notes   = document.getElementById('aep-received-notes').value.trim();
  if (!ptsStr || !dateStr) {
    alert('Please enter both received points and date.');
    return;
  }
  const points = parseInt(ptsStr, 10);
  if (isNaN(points) || points < 0) { alert('Invalid points value.'); return; }

  const ok = await guardWrite(() => updateDoc(doc(db, 'aepLedger', id), {
    status: 'received',
    receivedPoints: points,
    receivedDate: Timestamp.fromDate(new Date(dateStr)),
    notes,
  }), 'Save AEP received');
  if (!ok) return;
  document.getElementById('aep-received-modal').classList.add('hidden');
  loadAepLedger();
}

export async function clearAepReceived() {
  const { id } = markReceivedState;
  if (!id) return;
  if (!confirm('Reset this AEP row back to Pending?')) return;
  const ok = await guardWrite(() => updateDoc(doc(db, 'aepLedger', id), {
    status: 'pending',
    receivedPoints: null,
    receivedDate: null,
    notes: '',
  }), 'Reset AEP row');
  if (!ok) return;
  document.getElementById('aep-received-modal').classList.add('hidden');
  loadAepLedger();
}

// ─── Modal: View Calculation Detail ───────────────────────────────────────
export async function openAepDetailModal(id) {
  const snap = await getDoc(doc(db, 'aepLedger', id));
  if (!snap.exists()) return;
  const r = snap.data();
  const cardName = await resolveMbAepCardName();
  const calc = await computeAepForMonth(r.monthSort, cardName);
  const b = calc.breakdown;

  const lines = [];
  lines.push(`<strong>${r.month}</strong>`);
  lines.push(`Total Magnus debit: ${formatCurrency(calc.totalDebit)} (${calc.txnCount} txn${calc.txnCount === 1 ? '' : 's'})`);
  lines.push(`Excluded / AEP-Ineligible: ${calc.ineligibleCount} txn${calc.ineligibleCount === 1 ? '' : 's'}`);
  lines.push(`AEP-eligible spend: <strong>${formatCurrency(calc.eligibleSpend)}</strong>`);
  lines.push('');
  lines.push(`<u>AEP (accelerated) breakdown</u>`);
  const aep2Rate = Math.max(0, b.band2Rate - b.band1Rate);
  const aep3Rate = Math.max(0, b.band3Rate - b.band1Rate);
  lines.push(`Base ${b.band1Rate}/200 posts per-txn and is not part of the AEP credit.`);
  lines.push(`Band 1 (up to ${formatCurrency(b.band1Max)}): no accelerated points`);
  if (b.band2Bonus > 0 || calc.eligibleSpend > b.band1Max) {
    lines.push(`Band 2 (+${aep2Rate}/200, ${formatCurrency(b.band1Max)}–${formatCurrency(b.band2Max)}): ${b.band2Bonus.toLocaleString('en-IN')} pts`);
  }
  if (b.band3Bonus > 0 || calc.eligibleSpend > b.band2Max) {
    lines.push(`Band 3 (+${aep3Rate}/200, above ${formatCurrency(b.band2Max)}): ${b.band3Bonus.toLocaleString('en-IN')} pts`);
  }
  lines.push('');
  lines.push(`<strong>Calculated AEP: ${calc.calculatedPoints.toLocaleString('en-IN')} pts</strong>`);
  if (r.status === 'received') {
    const diff = (r.receivedPoints || 0) - calc.calculatedPoints;
    lines.push(`Received: ${r.receivedPoints?.toLocaleString('en-IN') ?? '—'} pts (${diff >= 0 ? '+' : ''}${diff.toLocaleString('en-IN')} vs calc)`);
  }

  document.getElementById('aep-detail-body').innerHTML = lines.map(l => l ? `<div class="aep-detail-line">${l}</div>` : '<div class="aep-detail-spacer"></div>').join('');
  document.getElementById('aep-detail-modal').classList.remove('hidden');
}
