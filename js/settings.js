import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';

// Module-level cache so edit modal can look up card by name
let _cardsCache = {};

// Normalize old flat format (integer) to new object format
function normalizeCard(name, value) {
  if (typeof value === 'number') {
    return { name, statementDate: value, billPaymentDate: null, bank: '', last4: '', active: true, dateHistory: [] };
  }
  return {
    name,
    statementDate:   value.statementDate   ?? null,
    billPaymentDate: value.billPaymentDate  ?? null,
    bank:            value.bank            || '',
    last4:           value.last4           || '',
    active:          value.active          !== false,
    dateHistory:     value.dateHistory     || [],
  };
}

export async function loadSettings() {
  const container = document.getElementById('settings-content');
  container.innerHTML = '<p class="loading">Loading...</p>';
  try {
    const snap = await getDoc(doc(db, 'config', 'cards'));
    const raw = snap.exists() ? snap.data() : {};
    const cards = Object.entries(raw)
      .map(([name, val]) => normalizeCard(name, val))
      .sort((a, b) => a.name.localeCompare(b.name));
    _cardsCache = {};
    cards.forEach(c => (_cardsCache[c.name] = c));
    renderSettings(cards);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderSettings(cards) {
  const container = document.getElementById('settings-content');
  container.innerHTML = `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Cards</h2>
        <button class="btn btn-primary" onclick="window.openAddCardModal()">+ Add Card</button>
      </div>
      <div class="cards-settings-list">
        ${cards.map(card => `
          <div class="settings-card${card.active ? '' : ' inactive'}">
            <div class="settings-card-info">
              <span class="card-name">${card.name}</span>
              ${card.bank || card.last4 ? `<span class="settings-detail-small">${card.bank}${card.last4 ? ' ••' + card.last4 : ''}</span>` : ''}
              <span class="settings-detail">
                Statement: <strong>${card.statementDate ? 'Day ' + card.statementDate : '—'}</strong>
                &nbsp;·&nbsp;
                Bill due: <strong>${card.billPaymentDate ? 'Day ' + card.billPaymentDate : '—'}</strong>
                ${!card.active ? '&nbsp;·&nbsp;<em>Inactive</em>' : ''}
              </span>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.openEditCardModal('${card.name.replace(/'/g, "\\'")}')">Edit</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

export function openAddCardModal() {
  document.getElementById('card-modal-title').textContent = 'Add Card';
  document.getElementById('card-original-name').value = '';
  document.getElementById('card-name-input').value = '';
  document.getElementById('card-bank-input').value = '';
  document.getElementById('card-last4-input').value = '';
  document.getElementById('card-cutoff-input').value = '';
  document.getElementById('card-bill-input').value = '';
  document.getElementById('card-active-input').checked = true;
  document.getElementById('card-modal').classList.remove('hidden');
}

export function openEditCardModal(name) {
  const card = _cardsCache[name];
  if (!card) return;
  document.getElementById('card-modal-title').textContent = 'Edit Card';
  document.getElementById('card-original-name').value = card.name;
  document.getElementById('card-name-input').value = card.name;
  document.getElementById('card-bank-input').value = card.bank || '';
  document.getElementById('card-last4-input').value = card.last4 || '';
  document.getElementById('card-cutoff-input').value = card.statementDate || '';
  document.getElementById('card-bill-input').value = card.billPaymentDate || '';
  document.getElementById('card-active-input').checked = card.active !== false;
  document.getElementById('card-modal').classList.remove('hidden');
}

export async function saveCard() {
  const originalName    = document.getElementById('card-original-name').value.trim();
  const newName         = document.getElementById('card-name-input').value.trim();
  const bank            = document.getElementById('card-bank-input').value.trim();
  const last4           = document.getElementById('card-last4-input').value.trim();
  const statementDate   = parseInt(document.getElementById('card-cutoff-input').value) || null;
  const billPaymentDate = parseInt(document.getElementById('card-bill-input').value) || null;
  const active          = document.getElementById('card-active-input').checked;

  if (!newName) { alert('Card name is required.'); return; }
  if (statementDate && (statementDate < 1 || statementDate > 31)) { alert('Statement date must be 1–31.'); return; }
  if (billPaymentDate && (billPaymentDate < 1 || billPaymentDate > 31)) { alert('Bill payment date must be 1–31.'); return; }

  const cardsRef = doc(db, 'config', 'cards');
  const snap = await getDoc(cardsRef);
  const raw = snap.exists() ? snap.data() : {};

  // Build updated card object
  const existing = originalName ? normalizeCard(originalName, raw[originalName] ?? {}) : null;
  const today = new Date().toISOString().split('T')[0];

  // Track date changes non-retroactively
  let dateHistory = existing ? [...(existing.dateHistory || [])] : [];
  const datesChanged = existing && (
    existing.statementDate !== statementDate ||
    existing.billPaymentDate !== billPaymentDate
  );
  if (datesChanged) {
    dateHistory.push({
      effectiveFrom:   today,
      statementDate,
      billPaymentDate,
    });
  }

  const updatedCard = { statementDate, billPaymentDate, bank, last4, active, dateHistory };

  // Remove old key if name changed
  if (originalName && originalName !== newName) {
    delete raw[originalName];
  }
  raw[newName] = updatedCard;

  await setDoc(cardsRef, raw);
  closeCardModal();
  loadSettings();
}

export function closeCardModal() {
  document.getElementById('card-modal').classList.add('hidden');
}
