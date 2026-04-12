import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, Timestamp, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatDate, formatDateInput } from './utils.js';

export async function loadRewards() {
  const container = document.getElementById('rewards-list');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const snap = await getDocs(query(collection(db, 'rewardsTracker'), orderBy('statementDate', 'desc')));
    const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRewards(entries);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderRewards(entries) {
  const container = document.getElementById('rewards-list');
  if (entries.length === 0) {
    container.innerHTML = '<p class="empty">No rewards entries yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Card</th>
          <th>Points Type</th>
          <th>Statement Period</th>
          <th>Statement Date</th>
          <th>Opening</th>
          <th>Earned</th>
          <th>Redeemed</th>
          <th>Lapsed</th>
          <th>Closing</th>
          <th>Notes</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(e => `
          <tr>
            <td>${e.card || ''}</td>
            <td>${e.pointsType || ''}</td>
            <td>${e.statementPeriod || ''}</td>
            <td>${formatDate(e.statementDate)}</td>
            <td>${e.openingBalance?.toLocaleString('en-IN') || '—'}</td>
            <td>${e.pointsEarned?.toLocaleString('en-IN') || '—'}</td>
            <td>${e.redeemed?.toLocaleString('en-IN') || '—'}</td>
            <td>${e.lapsed?.toLocaleString('en-IN') || '—'}</td>
            <td><strong>${e.closingBalance?.toLocaleString('en-IN') || '—'}</strong></td>
            <td>${e.notes || ''}</td>
            <td>
              <button class="btn-icon" onclick="window.openEditRewardModal('${e.id}')">✏️</button>
              <button class="btn-icon" onclick="window.deleteReward('${e.id}')">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function openAddRewardModal() {
  document.getElementById('reward-id').value = '';
  document.getElementById('reward-card').value = '';
  document.getElementById('reward-points-type').value = '';
  document.getElementById('reward-stmt-period').value = '';
  document.getElementById('reward-stmt-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('reward-opening').value = '';
  document.getElementById('reward-earned').value = '';
  document.getElementById('reward-redeemed').value = '';
  document.getElementById('reward-lapsed').value = '';
  document.getElementById('reward-closing').value = '';
  document.getElementById('reward-notes').value = '';
  document.getElementById('reward-modal').classList.remove('hidden');
}

export async function openEditRewardModal(id) {
  const snap = await getDoc(doc(db, 'rewardsTracker', id));
  if (!snap.exists()) return;
  const e = snap.data();

  document.getElementById('reward-id').value = id;
  document.getElementById('reward-card').value = e.card || '';
  document.getElementById('reward-points-type').value = e.pointsType || '';
  document.getElementById('reward-stmt-period').value = e.statementPeriod || '';
  document.getElementById('reward-stmt-date').value = e.statementDate ? formatDateInput(e.statementDate.toDate()) : '';
  document.getElementById('reward-opening').value = e.openingBalance || '';
  document.getElementById('reward-earned').value = e.pointsEarned || '';
  document.getElementById('reward-redeemed').value = e.redeemed || '';
  document.getElementById('reward-lapsed').value = e.lapsed || '';
  document.getElementById('reward-closing').value = e.closingBalance || '';
  document.getElementById('reward-notes').value = e.notes || '';
  document.getElementById('reward-modal').classList.remove('hidden');
}

export async function saveReward() {
  const id = document.getElementById('reward-id').value;
  const dateStr = document.getElementById('reward-stmt-date').value;

  const data = {
    card: document.getElementById('reward-card').value.trim(),
    pointsType: document.getElementById('reward-points-type').value.trim(),
    statementPeriod: document.getElementById('reward-stmt-period').value.trim(),
    statementDate: dateStr ? Timestamp.fromDate(new Date(dateStr)) : null,
    openingBalance: parseInt(document.getElementById('reward-opening').value) || null,
    pointsEarned: parseInt(document.getElementById('reward-earned').value) || null,
    redeemed: parseInt(document.getElementById('reward-redeemed').value) || null,
    lapsed: parseInt(document.getElementById('reward-lapsed').value) || null,
    closingBalance: parseInt(document.getElementById('reward-closing').value) || null,
    notes: document.getElementById('reward-notes').value.trim()
  };

  if (id) {
    await updateDoc(doc(db, 'rewardsTracker', id), data);
  } else {
    await addDoc(collection(db, 'rewardsTracker'), data);
  }

  closeRewardModal();
  loadRewards();
}

export async function deleteReward(id) {
  if (!confirm('Delete this rewards entry?')) return;
  await deleteDoc(doc(db, 'rewardsTracker', id));
  loadRewards();
}

export function closeRewardModal() {
  document.getElementById('reward-modal').classList.add('hidden');
}
