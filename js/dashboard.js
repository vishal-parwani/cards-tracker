import { collection, query, where, getDocs, doc, getDoc, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, getStatementStartDate, getCurrentMonthStart, getBillingCycleLabel } from './utils.js';

export async function loadDashboard() {
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
    const cardsData = cardsSnap.exists() ? cardsSnap.data() : {};
    const cards = Object.entries(cardsData).map(([name, cutoffDay]) => ({ name, cutoffDay }));

    const mbAepSnap = await getDoc(doc(db, 'config', 'mbAep'));
    const mbAep = mbAepSnap.exists() ? mbAepSnap.data() : {};

    const monthStart = getCurrentMonthStart();
    const cardResults = await Promise.all(cards.map(c => loadCardData(c, monthStart)));

    container.innerHTML = `
      <section class="section">
        <h2 class="section-title">Card Balances</h2>
        <div class="cards-grid">
          ${cardResults.map(r => renderCardBalanceCard(r)).join('')}
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Spend Trackers</h2>
        <div class="trackers-grid" id="trackers-grid">
          ${renderMagnusAep(cardResults, mbAep)}
          ${renderInfiniaSmartBuy(cardResults)}
          ${renderEpmIshop(cardResults)}
        </div>
      </section>
    `;
  } catch (e) {
    container.innerHTML = `<p class="error">Error loading dashboard: ${e.message}</p>`;
  }
}

async function loadCardData(card, monthStart) {
  const stmtStart = getStatementStartDate(card.cutoffDay);
  const stmtStartTs = Timestamp.fromDate(stmtStart);
  const monthStartTs = Timestamp.fromDate(monthStart);

  const [stmtSnap, mtdSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', card.name),
      where('date', '>=', stmtStartTs)
    )),
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', card.name),
      where('date', '>=', monthStartTs)
    ))
  ]);

  let stmtBalance = 0;
  stmtSnap.forEach(d => {
    const t = d.data();
    stmtBalance += t.type === 'debit' ? (t.amount || 0) : -(t.amount || 0);
  });

  let mtdSpend = 0;
  let mtdTxns = [];
  mtdSnap.forEach(d => {
    const t = d.data();
    if (t.type === 'debit') mtdSpend += (t.amount || 0);
    mtdTxns.push({ id: d.id, ...t });
  });

  // For Magnus AEP — compute by tag/category
  let magnusMonthlySpend = 0;
  let magnusAepEligible = 0;
  let magnusSmartBuyPts = 0;
  let epmIshopPts = 0;

  if (card.name === 'Magnus Burgundy') {
    mtdTxns.forEach(t => {
      if (t.type === 'debit') {
        magnusMonthlySpend += t.amount || 0;
        if (t.category !== 'Rent' && t.category !== 'Fees & Charges' && t.transactionTag !== 'AEP Ineligible') {
          magnusAepEligible += t.amount || 0;
        }
      }
    });
  }

  if (card.name === 'Infinia') {
    mtdTxns.forEach(t => {
      if (t.type === 'debit' && t.transactionTag === 'SmartBuy') {
        magnusSmartBuyPts += Math.floor((t.amount || 0) / 150) * 4; // accel pts only (4x)
      }
    });
  }

  if (card.name === 'ICICI EPM') {
    mtdTxns.forEach(t => {
      if (t.type === 'debit' && t.transactionTag === 'iShop') {
        epmIshopPts += Math.floor((t.amount || 0) / 200) * 36;
      }
    });
  }

  return {
    ...card,
    stmtBalance,
    mtdSpend,
    stmtStart,
    magnusAepEligible,
    magnusSmartBuyPts,
    epmIshopPts,
    billingCycle: getBillingCycleLabel(card.cutoffDay)
  };
}

function renderCardBalanceCard(r) {
  return `
    <div class="balance-card">
      <div class="balance-card-header">
        <span class="card-name">${r.name}</span>
        <span class="billing-cycle">${r.billingCycle}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Next Statement</span>
        <span class="balance-amount accent">${formatCurrency(r.stmtBalance)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">MTD Spend</span>
        <span class="balance-amount">${formatCurrency(r.mtdSpend)}</span>
      </div>
    </div>
  `;
}

function renderMagnusAep(cardResults, mbAep) {
  const magnus = cardResults.find(r => r.name === 'Magnus Burgundy');
  if (!magnus) return '';

  const spend = magnus.magnusAepEligible;
  const band1Max = mbAep.band1Max || 150000;
  const band2Max = mbAep.band2Max || 1450000;
  const band1Rate = mbAep.band1Rate || 12;
  const band2Rate = mbAep.band2Rate || 35;
  const band3Rate = mbAep.band3Rate || 12;

  let pts = 0;
  let band = 'Band 1';
  if (spend <= band1Max) {
    pts = Math.floor(spend / 200) * band1Rate;
    band = 'Band 1';
  } else if (spend <= band2Max) {
    pts = Math.floor(band1Max / 200) * band1Rate + Math.floor((spend - band1Max) / 200) * band2Rate;
    band = 'Band 2';
  } else {
    pts = Math.floor(band1Max / 200) * band1Rate + Math.floor((band2Max - band1Max) / 200) * band2Rate + Math.floor((spend - band2Max) / 200) * band3Rate;
    band = 'Band 3';
  }

  const toThreshold = Math.max(0, band1Max - spend);
  const pct = Math.min(100, (spend / band1Max) * 100).toFixed(0);

  return `
    <div class="tracker-card">
      <div class="tracker-header">
        <span class="tracker-title">Magnus AEP</span>
        <span class="tracker-badge ${band === 'Band 2' || band === 'Band 3' ? 'badge-green' : 'badge-orange'}">${band}</span>
      </div>
      <div class="tracker-metric">${formatCurrency(spend)} <span class="tracker-sub">AEP eligible spend</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="tracker-row">
        <span>${toThreshold > 0 ? formatCurrency(toThreshold) + ' to Band 2' : '✓ Band 2 reached'}</span>
        <span>${pts.toLocaleString('en-IN')} pts earned</span>
      </div>
    </div>
  `;
}

function renderInfiniaSmartBuy(cardResults) {
  const infinia = cardResults.find(r => r.name === 'Infinia');
  if (!infinia) return '';

  const accelPts = infinia.magnusSmartBuyPts;
  const cap = 15000;
  const remainingPts = Math.max(0, cap - accelPts);
  // Each ₹150 SmartBuy spend earns 4 accel pts → remaining spend = (remainingPts / 4) * 150
  const remainingSpend = Math.ceil((remainingPts / 4) * 150);
  const pct = Math.min(100, (accelPts / cap) * 100).toFixed(0);

  return `
    <div class="tracker-card">
      <div class="tracker-header">
        <span class="tracker-title">Infinia SmartBuy</span>
        <span class="tracker-badge ${accelPts >= cap ? 'badge-red' : 'badge-green'}">${accelPts >= cap ? 'Cap reached' : 'Active'}</span>
      </div>
      <div class="tracker-metric">${accelPts.toLocaleString('en-IN')} <span class="tracker-sub">/ 15,000 accel pts</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar bar-sage ${accelPts >= cap ? 'bar-red' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="tracker-row">
        <span>${accelPts >= cap ? '✓ Cap reached' : formatCurrency(remainingSpend) + ' to max cap'}</span>
        <span>${pct}% used</span>
      </div>
    </div>
  `;
}

function renderEpmIshop(cardResults) {
  const epm = cardResults.find(r => r.name === 'ICICI EPM');
  if (!epm) return '';

  const pts = epm.epmIshopPts;
  const cap = 18000;
  const remainingPts = Math.max(0, cap - pts);
  // Each ₹200 iShop spend earns 36 pts → remaining spend = (remainingPts / 36) * 200
  const remainingSpend = Math.ceil((remainingPts / 36) * 200);
  const pct = Math.min(100, (pts / cap) * 100).toFixed(0);

  return `
    <div class="tracker-card">
      <div class="tracker-header">
        <span class="tracker-title">EPM iShop</span>
        <span class="tracker-badge ${pts >= cap ? 'badge-red' : 'badge-green'}">${pts >= cap ? 'Cap reached' : 'Active'}</span>
      </div>
      <div class="tracker-metric">${pts.toLocaleString('en-IN')} <span class="tracker-sub">/ 18,000 pts</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar bar-amber ${pts >= cap ? 'bar-red' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="tracker-row">
        <span>${pts >= cap ? '✓ Cap reached' : formatCurrency(remainingSpend) + ' to max cap'}</span>
        <span>${pct}% used</span>
      </div>
    </div>
  `;
}
