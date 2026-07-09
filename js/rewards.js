import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { getTxns } from './store.js';
import { formatDate, formatDateInput, guardWrite, showToast, initDatePickers } from './utils.js';

// ── Period filter ─────────────────────────────────────────────────
// One row per card; the filter just re-scopes the numbers. Earned is
// always derived from transactions; Redeemed/Closing come from the
// per-card rewardsTracker doc (manual opening baseline + dated
// redemptions, with an optional manual closing override).
let activePreset = 'this-month';

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function periodRange(preset, customFrom, customTo) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const monthLabel = (yy, mm) =>
    new Date(yy, mm, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  switch (preset) {
    case 'last-month':
      return { from: new Date(y, m - 1, 1), to: endOfDay(new Date(y, m, 0)), label: monthLabel(y, m - 1) };
    case 'this-year':
      return { from: new Date(y, 0, 1), to: endOfDay(new Date(y, 11, 31)), label: String(y) };
    case 'last-year':
      return { from: new Date(y - 1, 0, 1), to: endOfDay(new Date(y - 1, 11, 31)), label: String(y - 1) };
    case 'all':
      return { from: new Date(2000, 0, 1), to: endOfDay(now), label: 'All time' };
    case 'custom': {
      const f = customFrom ? new Date(customFrom) : new Date(y, m, 1);
      const t = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
      return { from: f, to: t, label: `${formatDate(f)} – ${formatDate(t)}` };
    }
    case 'this-month':
    default:
      return { from: new Date(y, m, 1), to: endOfDay(new Date(y, m + 1, 0)), label: monthLabel(y, m) };
  }
}

export function setRewardsPreset(preset) {
  activePreset = preset;
  document.querySelectorAll('.rwd-preset').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset));
  loadRewards();
}

export function setRewardsCustom() {
  activePreset = 'custom';
  document.querySelectorAll('.rwd-preset').forEach(b => b.classList.remove('active'));
  loadRewards();
}

// ── Load + compute ────────────────────────────────────────────────
export async function loadRewards() {
  const container = document.getElementById('rewards-list');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const fromInput = document.getElementById('rewards-from');
    const toInput = document.getElementById('rewards-to');
    const period = periodRange(activePreset, fromInput?.value, toInput?.value);

    // Transactions come from the shared live store (full history is needed
    // to compute closing back to each card's opening date); rewardsTracker
    // is a tiny per-card collection, still read directly.
    const [cardsSnap, rtSnap, storeTxns] = await Promise.all([
      getDoc(doc(db, 'config', 'cards')),
      getDocs(collection(db, 'rewardsTracker')),
      getTxns(),
    ]);

    const cardNames = cardsSnap.exists() ? Object.keys(cardsSnap.data()) : [];

    const rtByCard = {};
    rtSnap.forEach(d => { const v = d.data(); rtByCard[v.card] = { id: d.id, ...v }; });

    const txns = [];
    storeTxns.forEach(t => {
      if (!t.date || !t.card) return;
      txns.push({ card: t.card, date: t.date.toDate ? t.date.toDate() : new Date(t.date), pts: t.pointsEarned || 0 });
    });

    // Every config card gets a row; include any orphan rewardsTracker
    // cards not (or no longer) in config so their data stays visible.
    const allCards = [...cardNames];
    Object.keys(rtByCard).forEach(c => { if (!allCards.includes(c)) allCards.push(c); });

    const rows = allCards.map(card => computeCardRow(card, rtByCard[card], txns, period));
    renderRewards(rows, period);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function toDate(v) {
  if (!v) return null;
  return v.toDate ? v.toDate() : new Date(v);
}

function sumTxnPts(txns, card, from, to) {
  let s = 0;
  for (const t of txns) {
    if (t.card === card && t.date >= from && t.date <= to) s += t.pts;
  }
  return s;
}

function sumRedemptions(redemptions, from, to) {
  return (redemptions || []).reduce((s, r) => {
    const d = toDate(r.date);
    return (d && d >= from && d <= to) ? s + (r.points || 0) : s;
  }, 0);
}

function computeCardRow(card, rt, txns, period) {
  const earned = sumTxnPts(txns, card, period.from, period.to);
  let redeemed = 0, closing = null, closingOverridden = false;
  const configured = !!rt;

  if (rt) {
    redeemed = sumRedemptions(rt.redemptions, period.from, period.to);

    if (rt.closingOverride != null && rt.closingOverride !== '') {
      closing = rt.closingOverride;
      closingOverridden = true;
    } else {
      const openDate = toDate(rt.openingDate);
      // Closing = balance as of the range end. Computable only when the
      // range end is on/after the opening baseline date.
      if (openDate && period.to >= openDate) {
        closing = (rt.openingBalance || 0)
          + sumTxnPts(txns, card, openDate, period.to)
          - sumRedemptions(rt.redemptions, openDate, period.to);
      }
    }
  }

  return { card, pointsType: rt?.pointsType || '', earned, redeemed, closing, closingOverridden, configured };
}

// ── Render ────────────────────────────────────────────────────────
function renderRewards(rows, period) {
  const container = document.getElementById('rewards-list');
  if (rows.length === 0) {
    container.innerHTML = '<p class="empty">No cards configured. Add cards in Settings.</p>';
    return;
  }

  const totals = rows.reduce((a, r) => ({
    earned: a.earned + r.earned,
    redeemed: a.redeemed + r.redeemed,
    closing: a.closing + (r.closing || 0),
  }), { earned: 0, redeemed: 0, closing: 0 });

  const fmt = n => n.toLocaleString('en-IN');

  container.innerHTML = `
    <p class="rewards-period-note">
      One row per card for <strong>${period.label}</strong>.
      <span class="rwd-auto-key">Earned</span> auto-sums transaction points in range;
      Redeemed &amp; Closing come from each card's manual setup — tap a row to edit.
    </p>
    <table class="data-table rewards-table">
      <thead>
        <tr>
          <th>Card</th>
          <th class="rwd-num rwd-earned-col">Earned</th>
          <th class="rwd-num">Redeemed</th>
          <th class="rwd-num">Closing Balance</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="rwd-row" onclick="window.openEditRewardModal('${r.card.replace(/'/g, "\\'")}')">
            <td>
              <div class="rwd-card-name">${r.card}</div>
              <div class="rwd-card-type">${
                r.pointsType || (r.configured ? '' : '<span class="rwd-setup">tap to set up</span>')
              }</div>
            </td>
            <td class="rwd-num rwd-earned-col" data-label="Earned">${fmt(r.earned)}</td>
            <td class="rwd-num" data-label="Redeemed">${r.configured ? fmt(r.redeemed) : '—'}</td>
            <td class="rwd-num" data-label="Closing Balance">${
              r.closing != null ? `<strong>${fmt(r.closing)}</strong>` : '—'
            }${
              r.closingOverridden ? '<span class="rwd-override" title="Manually overridden">override</span>' : ''
            }</td>
          </tr>
        `).join('')}
        <tr class="rwd-total-row">
          <td>All cards</td>
          <td class="rwd-num rwd-earned-col" data-label="Earned">${fmt(totals.earned)}</td>
          <td class="rwd-num" data-label="Redeemed">${fmt(totals.redeemed)}</td>
          <td class="rwd-num" data-label="Closing Balance">${fmt(totals.closing)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

// ── Modal ─────────────────────────────────────────────────────────
function redemptionRowHtml(r = {}) {
  const d = r.date ? formatDateInput(r.date.toDate ? r.date.toDate() : new Date(r.date)) : '';
  const note = (r.note || '').replace(/"/g, '&quot;');
  return `
    <div class="rwd-redemption-row">
      <input type="date" class="rwd-red-date" value="${d}">
      <input type="number" class="rwd-red-points" min="0" placeholder="Points" value="${r.points || ''}">
      <input type="text" class="rwd-red-note" placeholder="Note" value="${note}">
      <button type="button" class="btn-icon rwd-red-remove" title="Remove">✕</button>
    </div>`;
}

export function addRedemptionRow() {
  const container = document.getElementById('reward-redemptions');
  container.insertAdjacentHTML('beforeend', redemptionRowHtml());
  initDatePickers(container.lastElementChild);
}

export async function openEditRewardModal(card) {
  const rtSnap = await getDocs(query(collection(db, 'rewardsTracker'), where('card', '==', card)));
  const existing = rtSnap.docs[0];
  const e = existing ? existing.data() : {};

  const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
  const cards = cardsSnap.exists() ? Object.keys(cardsSnap.data()) : [];
  if (!cards.includes(card)) cards.push(card);

  document.getElementById('reward-id').value = existing ? existing.id : '';
  document.getElementById('reward-modal-title').textContent = `Rewards Setup — ${card}`;
  document.getElementById('reward-card').innerHTML =
    cards.map(c => `<option value="${c}" ${c === card ? 'selected' : ''}>${c}</option>`).join('');
  document.getElementById('reward-points-type').value = e.pointsType || '';
  document.getElementById('reward-opening').value = e.openingBalance ?? '';
  document.getElementById('reward-opening-date').value =
    e.openingDate ? formatDateInput(e.openingDate.toDate()) : '';
  document.getElementById('reward-closing-override').value = e.closingOverride ?? '';
  document.getElementById('reward-notes').value = e.notes || '';
  document.getElementById('reward-redemptions').innerHTML =
    (e.redemptions || []).map(redemptionRowHtml).join('');
  initDatePickers(document.getElementById('reward-redemptions'));
  document.getElementById('delete-reward-btn').style.display = existing ? '' : 'none';

  document.getElementById('reward-modal').classList.remove('hidden');
}

export async function saveReward() {
  const id = document.getElementById('reward-id').value;
  const card = document.getElementById('reward-card').value;
  if (!card) { alert('Pick a card.'); return; }

  const openingDateStr = document.getElementById('reward-opening-date').value;
  const overrideStr = document.getElementById('reward-closing-override').value.trim();

  const openingBalance = parseInt(document.getElementById('reward-opening').value) || 0;
  if (openingBalance < 0) { alert('Opening balance cannot be negative.'); return; }
  const closingOverride = overrideStr === '' ? null : (parseInt(overrideStr) || 0);
  if (closingOverride != null && closingOverride < 0) { alert('Closing override cannot be negative.'); return; }

  const redemptions = [...document.querySelectorAll('#reward-redemptions .rwd-redemption-row')]
    .map(row => {
      const d = row.querySelector('.rwd-red-date').value;
      const pts = parseInt(row.querySelector('.rwd-red-points').value);
      const note = row.querySelector('.rwd-red-note').value.trim();
      if (!d || !pts || pts <= 0) return null;
      return { date: Timestamp.fromDate(new Date(d)), points: pts, note };
    })
    .filter(Boolean);

  const data = {
    card,
    pointsType: document.getElementById('reward-points-type').value.trim(),
    openingBalance,
    openingDate: openingDateStr ? Timestamp.fromDate(new Date(openingDateStr)) : null,
    closingOverride,
    redemptions,
    notes: document.getElementById('reward-notes').value.trim(),
  };

  const ok = await guardWrite(
    () => id
      ? updateDoc(doc(db, 'rewardsTracker', id), data)
      : addDoc(collection(db, 'rewardsTracker'), data),
    'Save rewards setup'
  );
  if (!ok) return;

  closeRewardModal();
  loadRewards();
}

export async function deleteReward() {
  const id = document.getElementById('reward-id').value;
  if (!id) { closeRewardModal(); return; }
  if (!confirm('Delete the rewards setup for this card? Transactions are untouched.')) return;
  if (!await guardWrite(() => deleteDoc(doc(db, 'rewardsTracker', id)), 'Delete rewards setup')) return;
  closeRewardModal();
  loadRewards();
}

export function closeRewardModal() {
  document.getElementById('reward-modal').classList.add('hidden');
}
