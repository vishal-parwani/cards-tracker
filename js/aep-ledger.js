import {
  collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc,
  orderBy, Timestamp, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency } from './utils.js';

const TOLERANCE_PTS = 500;
const AEP_EXCLUDED = new Set([
  'Fees & Charges', 'Fuel', 'Government Services', 'Insurance',
  'Utilities & Telecom', 'Shopping - Jewellery', 'Wallet Load',
]);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(year, month1) { return `${MONTH_NAMES[month1 - 1]} ${year}`; }
function monthSortKey(year, month1) { return `${year}-${String(month1).padStart(2, '0')}`; }

async function computeAepForMonth(monthSort) {
  const [year, month1] = monthSort.split('-').map(Number);
  const monthStart = new Date(year, month1 - 1, 1);
  const monthEnd   = new Date(year, month1, 1);

  const [txnSnap, mbAepSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', 'Magnus Burgundy'),
      where('date', '>=', Timestamp.fromDate(monthStart)),
      where('date', '<', Timestamp.fromDate(monthEnd)),
    )),
    getDoc(doc(db, 'config', 'mbAep')),
  ]);

  const mbAep = mbAepSnap.exists() ? mbAepSnap.data() : {};
  const band1Max  = mbAep.band1Max  || 150000;
  const band2Max  = mbAep.band2Max  || 1450000;
  const band1Rate = mbAep.band1Rate || 12;
  const band2Rate = mbAep.band2Rate || 35;
  const band3Rate = mbAep.band3Rate || 12;

  let totalDebit = 0, eligibleSpend = 0, txnCount = 0, ineligibleCount = 0;
  txnSnap.forEach(d => {
    const t = d.data();
    if (t.type !== 'debit') return;
    txnCount++;
    totalDebit += t.amount || 0;
    const eligible = !AEP_EXCLUDED.has(t.category) && t.category !== 'Rent'
                  && t.transactionTag !== 'AEP Ineligible';
    if (eligible) eligibleSpend += t.amount || 0;
    else ineligibleCount++;
  });

  let band1Pts = 0, band2Pts = 0, band3Pts = 0, band = 'Band 1';
  if (eligibleSpend <= band1Max) {
    band1Pts = Math.floor(eligibleSpend / 200) * band1Rate;
    band = 'Band 1';
  } else if (eligibleSpend <= band2Max) {
    band1Pts = Math.floor(band1Max / 200) * band1Rate;
    band2Pts = Math.floor((eligibleSpend - band1Max) / 200) * band2Rate;
    band = 'Band 2';
  } else {
    band1Pts = Math.floor(band1Max / 200) * band1Rate;
    band2Pts = Math.floor((band2Max - band1Max) / 200) * band2Rate;
    band3Pts = Math.floor((eligibleSpend - band2Max) / 200) * band3Rate;
    band = 'Band 3';
  }
  const calculatedPoints = band1Pts + band2Pts + band3Pts;

  return {
    eligibleSpend, totalDebit, txnCount, ineligibleCount,
    band, calculatedPoints,
    breakdown: { band1Pts, band2Pts, band3Pts, band1Max, band2Max,
                 band1Rate, band2Rate, band3Rate },
  };
}

// Returns {year, month1} pairs for past months that:
//   • have Magnus debit spend AND
//   • the 3rd of the following month has arrived
async function findMissingLedgerMonths(existingMonthSorts) {
  const snap = await getDocs(query(
    collection(db, 'transactions'),
    where('card', '==', 'Magnus Burgundy'),
  ));
  const monthsSeen = new Set();
  snap.forEach(d => {
    const t = d.data();
    if (t.type !== 'debit' || !t.date?.toDate) return;
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
    const missing = await findMissingLedgerMonths(existingMonthSorts);
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
      calc: await computeAepForMonth(r.monthSort),
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
          <th>Calculated</th>
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
      <td><strong>${r.month}</strong></td>
      <td>${formatCurrency(c.eligibleSpend)}</td>
      <td>${c.band}</td>
      <td>${calcStr}</td>
      <td>${receivedStr}</td>
      <td>${statusBadge}</td>
      <td class="actions-cell">
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

  await updateDoc(doc(db, 'aepLedger', id), {
    status: 'received',
    receivedPoints: points,
    receivedDate: Timestamp.fromDate(new Date(dateStr)),
    notes,
  });
  document.getElementById('aep-received-modal').classList.add('hidden');
  loadAepLedger();
}

export async function clearAepReceived() {
  const { id } = markReceivedState;
  if (!id) return;
  if (!confirm('Reset this AEP row back to Pending?')) return;
  await updateDoc(doc(db, 'aepLedger', id), {
    status: 'pending',
    receivedPoints: null,
    receivedDate: null,
    notes: '',
  });
  document.getElementById('aep-received-modal').classList.add('hidden');
  loadAepLedger();
}

// ─── Modal: View Calculation Detail ───────────────────────────────────────
export async function openAepDetailModal(id) {
  const snap = await getDoc(doc(db, 'aepLedger', id));
  if (!snap.exists()) return;
  const r = snap.data();
  const calc = await computeAepForMonth(r.monthSort);
  const b = calc.breakdown;

  const lines = [];
  lines.push(`<strong>${r.month}</strong>`);
  lines.push(`Total Magnus debit: ${formatCurrency(calc.totalDebit)} (${calc.txnCount} txn${calc.txnCount === 1 ? '' : 's'})`);
  lines.push(`Excluded / AEP-Ineligible: ${calc.ineligibleCount} txn${calc.ineligibleCount === 1 ? '' : 's'}`);
  lines.push(`AEP-eligible spend: <strong>${formatCurrency(calc.eligibleSpend)}</strong>`);
  lines.push('');
  lines.push(`<u>Band breakdown</u>`);
  lines.push(`Band 1 (${b.band1Rate}/200, up to ${formatCurrency(b.band1Max)}): ${b.band1Pts.toLocaleString('en-IN')} pts`);
  if (b.band2Pts > 0 || calc.eligibleSpend > b.band1Max) {
    lines.push(`Band 2 (${b.band2Rate}/200, ${formatCurrency(b.band1Max)}–${formatCurrency(b.band2Max)}): ${b.band2Pts.toLocaleString('en-IN')} pts`);
  }
  if (b.band3Pts > 0 || calc.eligibleSpend > b.band2Max) {
    lines.push(`Band 3 (${b.band3Rate}/200, above ${formatCurrency(b.band2Max)}): ${b.band3Pts.toLocaleString('en-IN')} pts`);
  }
  lines.push('');
  lines.push(`<strong>Calculated total: ${calc.calculatedPoints.toLocaleString('en-IN')} pts</strong>`);
  if (r.status === 'received') {
    const diff = (r.receivedPoints || 0) - calc.calculatedPoints;
    lines.push(`Received: ${r.receivedPoints?.toLocaleString('en-IN') ?? '—'} pts (${diff >= 0 ? '+' : ''}${diff.toLocaleString('en-IN')} vs calc)`);
  }

  document.getElementById('aep-detail-body').innerHTML = lines.map(l => l ? `<div class="aep-detail-line">${l}</div>` : '<div class="aep-detail-spacer"></div>').join('');
  document.getElementById('aep-detail-modal').classList.remove('hidden');
}
