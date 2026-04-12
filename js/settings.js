import { doc, getDoc, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';

export async function loadSettings() {
  const container = document.getElementById('settings-content');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const snap = await getDoc(doc(db, 'config', 'cards'));
    const cards = snap.exists() ? snap.data() : {};
    renderSettings(cards);
  } catch (e) {
    container.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function renderSettings(cards) {
  const container = document.getElementById('settings-content');
  const cardEntries = Object.entries(cards).sort((a, b) => a[0].localeCompare(b[0]));

  container.innerHTML = `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Cards</h2>
        <button class="btn btn-primary" onclick="window.openAddCardModal()">+ Add Card</button>
      </div>
      <div class="cards-settings-list">
        ${cardEntries.map(([name, cutoffDay]) => `
          <div class="settings-card">
            <div class="settings-card-info">
              <span class="card-name">${name}</span>
              <span class="settings-detail">Statement cutoff: <strong>Day ${cutoffDay}</strong></span>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.openEditCardModal('${name}', ${cutoffDay})">Edit</button>
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
  document.getElementById('card-cutoff-input').value = '';
  document.getElementById('card-modal').classList.remove('hidden');
}

export function openEditCardModal(name, cutoffDay) {
  document.getElementById('card-modal-title').textContent = 'Edit Card';
  document.getElementById('card-original-name').value = name;
  document.getElementById('card-name-input').value = name;
  document.getElementById('card-cutoff-input').value = cutoffDay;
  document.getElementById('card-modal').classList.remove('hidden');
}

export async function saveCard() {
  const originalName = document.getElementById('card-original-name').value;
  const newName = document.getElementById('card-name-input').value.trim();
  const cutoffDay = parseInt(document.getElementById('card-cutoff-input').value);

  if (!newName || isNaN(cutoffDay) || cutoffDay < 1 || cutoffDay > 31) {
    alert('Please enter a valid card name and cutoff day (1–31).');
    return;
  }

  const cardsRef = doc(db, 'config', 'cards');
  const snap = await getDoc(cardsRef);
  const cards = snap.exists() ? snap.data() : {};

  if (originalName && originalName !== newName) {
    delete cards[originalName];
  }
  cards[newName] = cutoffDay;

  await setDoc(cardsRef, cards);
  closeCardModal();
  loadSettings();
}

export function closeCardModal() {
  document.getElementById('card-modal').classList.add('hidden');
}
