import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';

let _cardsCache = {};
let _addonCache = {};

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
    pdfPassword:     value.pdfPassword     || '',
    forexRate:       value.forexRate       ?? null,
    active:          value.active          !== false,
    dateHistory:     value.dateHistory     || [],
  };
}

export async function loadSettings() {
  const container = document.getElementById('settings-content');
  container.innerHTML = '<p class="loading">Loading...</p>';
  try {
    const [cardsSnap, addonSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'cards')),
      getDoc(doc(db, 'config', 'addOnCards')),
    ]);
    const raw = cardsSnap.exists() ? cardsSnap.data() : {};
    const cards = Object.entries(raw)
      .map(([name, val]) => normalizeCard(name, val))
      .sort((a, b) => a.name.localeCompare(b.name));
    _cardsCache = {};
    cards.forEach(c => (_cardsCache[c.name] = c));
    const rawAddon = addonSnap.exists() ? (addonSnap.data() || {}) : {};
    _addonCache = {};
    Object.entries(rawAddon).forEach(([last4, val]) => {
      _addonCache[last4] = typeof val === 'string'
        ? { mainCard: val, holderName: '' }
        : { mainCard: val.mainCard || '', holderName: val.holderName || '' };
    });
    renderSettings(cards);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderSettings(cards) {
  const addonEntries = Object.entries(_addonCache);
  const container = document.getElementById('settings-content');
  const esc = s => String(s).replace(/'/g, "\\'");
  container.innerHTML = `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Cards</h2>
        <button class="btn btn-primary" onclick="window.openAddCardModal()">+ Add Card</button>
      </div>
      <div class="cards-grid">
        ${cards.map(card => `
          <div class="settings-card-tile${card.active ? '' : ' inactive'}">
            <div class="settings-tile-header">
              <span class="card-name">${card.name}</span>
              ${!card.active ? '<span class="tracker-badge badge-orange">Inactive</span>' : ''}
            </div>
            <div class="settings-tile-sub">${card.bank || ''}${card.last4 ? (card.bank ? ' ' : '') + '••' + card.last4 : ''}</div>
            <div class="settings-tile-rows">
              <div class="settings-tile-row"><span>Statement</span><strong>${card.statementDate ? 'Day ' + card.statementDate : '—'}</strong></div>
              <div class="settings-tile-row"><span>Bill due</span><strong>${card.billPaymentDate ? 'Day ' + card.billPaymentDate : '—'}</strong></div>
              <div class="settings-tile-row"><span>Forex</span><strong>${card.forexRate != null ? (card.forexRate * 100).toFixed(1) + '%' : '—'}</strong></div>
            </div>
            <div class="settings-tile-actions">
              <button class="btn btn-secondary btn-sm" onclick="window.openEditCardModal('${esc(card.name)}')">Edit</button>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Add-on Cards</h2>
        <button class="btn btn-primary btn-sm" onclick="window.openAddAddOnModal()">+ Add</button>
      </div>
      <p class="settings-hint">Add-on card numbers that should be recorded under a main card. Used by the processor to resolve transactions automatically.</p>
      ${addonEntries.length === 0
        ? '<p class="empty" style="padding:6px 0">No add-on cards configured.</p>'
        : `<div class="cards-grid" style="margin-top:10px">
            ${addonEntries.map(([last4, info]) => `
              <div class="settings-card-tile">
                <div class="settings-tile-header"><span class="card-name">••${last4}</span></div>
                <div class="settings-tile-sub">${info.holderName ? info.holderName : '<em style="color:var(--text-sec)">No name</em>'}</div>
                <div class="settings-tile-rows">
                  <div class="settings-tile-row"><span>Main card</span><strong>${info.mainCard || '—'}</strong></div>
                </div>
                <div class="settings-tile-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.openEditAddOnModal('${esc(last4)}')">Edit</button>
                  <button class="btn btn-secondary btn-sm" onclick="window.deleteAddOnCard('${esc(last4)}')">Remove</button>
                </div>
              </div>
            `).join('')}
          </div>`}
    </section>
  `;
}

export function openAddCardModal() {
  document.getElementById('card-modal-title').textContent = 'Add Card';
  document.getElementById('card-original-name').value = '';
  document.getElementById('card-name-input').value = '';
  document.getElementById('card-bank-input').value = '';
  document.getElementById('card-last4-input').value = '';
  document.getElementById('card-pdf-password-input').value = '';
  document.getElementById('card-cutoff-input').value = '';
  document.getElementById('card-bill-input').value = '';
  document.getElementById('card-forex-input').value = '';
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
  document.getElementById('card-pdf-password-input').value = card.pdfPassword || '';
  document.getElementById('card-cutoff-input').value = card.statementDate || '';
  document.getElementById('card-bill-input').value = card.billPaymentDate || '';
  document.getElementById('card-forex-input').value = card.forexRate != null ? (card.forexRate * 100).toFixed(1) : '';
  document.getElementById('card-active-input').checked = card.active !== false;
  document.getElementById('card-modal').classList.remove('hidden');
}

export async function saveCard() {
  const originalName    = document.getElementById('card-original-name').value.trim();
  const newName         = document.getElementById('card-name-input').value.trim();
  const bank            = document.getElementById('card-bank-input').value.trim();
  const last4           = document.getElementById('card-last4-input').value.trim();
  const pdfPassword     = document.getElementById('card-pdf-password-input').value.trim();
  const statementDate   = parseInt(document.getElementById('card-cutoff-input').value) || null;
  const billPaymentDate = parseInt(document.getElementById('card-bill-input').value) || null;
  const forexRawInput   = document.getElementById('card-forex-input').value.trim();
  const forexRate       = forexRawInput !== '' ? parseFloat(forexRawInput) / 100 : null;
  const active          = document.getElementById('card-active-input').checked;

  if (!newName) { alert('Card name is required.'); return; }
  if (statementDate && (statementDate < 1 || statementDate > 31)) { alert('Statement date must be 1–31.'); return; }
  if (billPaymentDate && (billPaymentDate < 1 || billPaymentDate > 31)) { alert('Bill payment date must be 1–31.'); return; }
  if (forexRate !== null && (forexRate < 0 || forexRate > 1)) { alert('Forex rate must be between 0% and 100%.'); return; }

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

  const updatedCard = { statementDate, billPaymentDate, bank, last4, pdfPassword, forexRate, active, dateHistory };

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

// ── Add-on card modal ─────────────────────────────────────────────

function populateAddOnMainSelect(selected) {
  const select = document.getElementById('addon-main-card');
  select.innerHTML = Object.keys(_cardsCache)
    .sort()
    .map(name => `<option value="${name}"${name === selected ? ' selected' : ''}>${name}</option>`)
    .join('');
}

export function openAddAddOnModal() {
  populateAddOnMainSelect();
  document.getElementById('addon-last4').value = '';
  document.getElementById('addon-last4').readOnly = false;
  document.getElementById('addon-holder-name').value = '';
  document.getElementById('addon-modal').classList.remove('hidden');
}

export function openEditAddOnModal(last4) {
  const info = _addonCache[last4];
  if (!info) return;
  populateAddOnMainSelect(info.mainCard);
  document.getElementById('addon-last4').value = last4;
  document.getElementById('addon-last4').readOnly = true;
  document.getElementById('addon-holder-name').value = info.holderName || '';
  document.getElementById('addon-modal').classList.remove('hidden');
}

export async function saveAddOnCard() {
  const last4      = document.getElementById('addon-last4').value.trim();
  const mainCard   = document.getElementById('addon-main-card').value;
  const holderName = document.getElementById('addon-holder-name').value.trim();
  if (!/^\d{4}$/.test(last4)) { alert('Enter exactly 4 digits.'); return; }
  if (!mainCard) { alert('Select a main card.'); return; }

  const ref  = doc(db, 'config', 'addOnCards');
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};
  await setDoc(ref, { ...data, [last4]: { mainCard, holderName } });
  closeAddOnModal();
  loadSettings();
}

export async function deleteAddOnCard(last4) {
  if (!confirm(`Remove add-on card ••${last4}?`)) return;
  const ref  = doc(db, 'config', 'addOnCards');
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};
  delete data[last4];
  await setDoc(ref, data);
  loadSettings();
}

export function closeAddOnModal() {
  document.getElementById('addon-modal').classList.add('hidden');
}
