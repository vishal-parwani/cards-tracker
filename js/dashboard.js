import { collection, query, where, getDocs, doc, getDoc, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';
import { formatCurrency, getStatementStartDate, getStatementEndDate, getCurrentMonthStart, getBillingCycleLabel } from './utils.js';
import { isAepEligible, smartBuyAccelPts, epmIshopAccelPts, timesBlackIshopAccelPts, computeAepBands, resolveDashboardWidget, SMARTBUY_CAP, ISHOP_CAP, ISHOP_DAILY_ACCEL_CAP, TIMES_BLACK_ISHOP_CAP, TIMES_BLACK_DAILY_ACCEL_CAP } from './points-config.js';
import { loadCharts } from './charts.js';

export async function loadDashboard() {
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const cardsSnap = await getDoc(doc(db, 'config', 'cards'));
    const cardsData = cardsSnap.exists() ? cardsSnap.data() : {};
    const cards = Object.entries(cardsData)
      .filter(([, val]) => typeof val === 'number' || (!val.deleted && val.active !== false))
      .map(([name, val]) => ({
        name,
        cutoffDay: typeof val === 'number' ? val : (val.statementDate || 1),
        dashboardWidget: resolveDashboardWidget(name, val),
        showOnDashboard: typeof val === 'number' ? true : (val.showOnDashboard !== false),
      }));

    const mbAepSnap = await getDoc(doc(db, 'config', 'mbAep'));
    const mbAep = mbAepSnap.exists() ? mbAepSnap.data() : {};

    const monthStart = getCurrentMonthStart();
    const [cardResults, vtSummary] = await Promise.all([
      Promise.all(cards.map(c => loadCardData(c, monthStart))),
      loadVtSummary(monthStart),
    ]);
    const sortedCards = [...cardResults].sort((a, b) => b.mtdSpend - a.mtdSpend);

    container.innerHTML = `
      <section class="section">
        <h2 class="section-title">Card Balances</h2>
        <div class="cards-grid">
          ${renderTotalCard(cardResults)}
          <div class="grid-row-break"></div>
          ${sortedCards.filter(r => r.showOnDashboard || r.stmtBalance !== 0).map(r => renderCardBalanceCard(r)).join('')}
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Spend Trackers</h2>
        <div class="trackers-grid" id="trackers-grid">
          ${renderMagnusAep(cardResults, mbAep)}
          ${renderInfiniaSmartBuy(cardResults)}
          ${renderEpmIshop(cardResults)}
          ${renderTimesBlackIshop(cardResults)}
          ${renderVtSummary(vtSummary)}
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Charts</h2>
        <div class="chart-card chart-card-wide">
          <div class="chart-title">Monthly Spend by Card</div>
          <div class="chart-canvas-wrap chart-canvas-bar">
            <canvas id="chart-monthly"></canvas>
          </div>
        </div>
        <div class="charts-grid-donuts">
          <div class="chart-card">
            <div class="chart-title">Spend by Category — YTD</div>
            <div class="chart-canvas-wrap chart-canvas-donut">
              <canvas id="chart-cat-ytd"></canvas>
            </div>
          </div>
          <div class="chart-card">
            <div class="chart-title">Spend by Category — MTD</div>
            <div class="chart-canvas-wrap chart-canvas-donut">
              <canvas id="chart-cat-mtd"></canvas>
            </div>
          </div>
        </div>
      </section>
    `;
    loadCharts();
  } catch (e) {
    container.innerHTML = `<p class="error">Error loading dashboard: ${e.message}</p>`;
  }
}

async function loadCardData(card, monthStart) {
  const stmtStart = getStatementStartDate(card.cutoffDay);
  // Upper bound the statement query so next-cycle / future-dated txns don't
  // leak in. End is the last day of the current billing cycle, inclusive.
  const stmtEnd = new Date(getStatementEndDate(card.cutoffDay));
  stmtEnd.setHours(23, 59, 59, 999);
  const stmtStartTs = Timestamp.fromDate(stmtStart);
  const stmtEndTs   = Timestamp.fromDate(stmtEnd);
  const monthStartTs = Timestamp.fromDate(monthStart);

  const [stmtSnap, mtdSnap, allTimeSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', card.name),
      where('date', '>=', stmtStartTs),
      where('date', '<=', stmtEndTs)
    )),
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', card.name),
      where('date', '>=', monthStartTs)
    )),
    getDocs(query(
      collection(db, 'transactions'),
      where('card', '==', card.name)
    ))
  ]);

  // stmtBalance = all-time net outstanding (total debits minus total credits/payments
  // ever recorded). This is the true card balance — it accounts for carry-forward from
  // previous cycles that were only partially paid. stmtSpend = debits only in the
  // current billing cycle, the "how much did I spend this cycle" number.
  let stmtBalance = 0;
  allTimeSnap.forEach(d => {
    const t = d.data();
    const amt = t.amount || 0;
    if (t.type === 'debit') stmtBalance += amt;
    else stmtBalance -= amt;
  });
  let stmtSpend = 0;
  stmtSnap.forEach(d => {
    const t = d.data();
    if (t.type === 'debit') stmtSpend += (t.amount || 0);
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
  let timesBlackIshopPts = 0;

  if (card.dashboardWidget === 'mbAep') {
    mtdTxns.forEach(t => {
      if (t.type === 'debit') {
        magnusMonthlySpend += t.amount || 0;
        if (isAepEligible(t)) magnusAepEligible += t.amount || 0;
      }
    });
  }

  // SmartBuy / iShop caps reset on the calendar month.
  if (card.dashboardWidget === 'infiniaSb') {
    mtdTxns.forEach(t => {
      if (t.type === 'debit' && t.transactionTag === 'SmartBuy') {
        magnusSmartBuyPts += smartBuyAccelPts(t.amount);
      }
    });
  }

  // EPM iShop accel pts have a 10k/day cap. Bucket by date, cap each day at
  // the daily cap, and flag overages — but only the first two chronologically,
  // because 2×daily-cap already exceeds the 18k monthly cap so further
  // warnings are moot.
  const epmDailyOverages = [];
  if (card.dashboardWidget === 'epmIshop') {
    const dailyAccel = new Map();
    mtdTxns.forEach(t => {
      if (t.type !== 'debit' || t.transactionTag !== 'iShop' || !t.date) return;
      const accel = epmIshopAccelPts(t.amount);
      const d = t.date.toDate ? t.date.toDate() : new Date(t.date);
      const key = d.toISOString().slice(0, 10);
      dailyAccel.set(key, (dailyAccel.get(key) || 0) + accel);
    });
    const sortedDays = [...dailyAccel.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const overagesAll = [];
    for (const [day, raw] of sortedDays) {
      epmIshopPts += Math.min(raw, ISHOP_DAILY_ACCEL_CAP);
      if (raw > ISHOP_DAILY_ACCEL_CAP) overagesAll.push({ day, raw });
    }
    epmDailyOverages.push(...overagesAll.slice(0, 2));
  }

  const timesBlackDailyOverages = [];
  if (card.dashboardWidget === 'timesBlackIshop') {
    const dailyAccel = new Map();
    mtdTxns.forEach(t => {
      if (t.type !== 'debit' || t.transactionTag !== 'iShop' || !t.date) return;
      const accel = timesBlackIshopAccelPts(t.amount);
      const d = t.date.toDate ? t.date.toDate() : new Date(t.date);
      const key = d.toISOString().slice(0, 10);
      dailyAccel.set(key, (dailyAccel.get(key) || 0) + accel);
    });
    const sortedDays = [...dailyAccel.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const overagesAll = [];
    for (const [day, raw] of sortedDays) {
      timesBlackIshopPts += Math.min(raw, TIMES_BLACK_DAILY_ACCEL_CAP);
      if (raw > TIMES_BLACK_DAILY_ACCEL_CAP) overagesAll.push({ day, raw });
    }
    timesBlackDailyOverages.push(...overagesAll.slice(0, 2));
  }

  return {
    ...card,
    stmtBalance,
    stmtSpend,
    mtdSpend,
    stmtStart,
    magnusAepEligible,
    magnusSmartBuyPts,
    epmIshopPts,
    epmDailyOverages,
    timesBlackIshopPts,
    timesBlackDailyOverages,
    billingCycle: getBillingCycleLabel(card.cutoffDay)
  };
}

function renderTimesBlackIshop(cardResults) {
  const tb = cardResults.find(r => r.dashboardWidget === 'timesBlackIshop');
  if (!tb) return '';

  const pts = tb.timesBlackIshopPts;
  const cap = TIMES_BLACK_ISHOP_CAP;
  const remainingPts = Math.max(0, cap - pts);
  // ₹100 iShop spend earns 10 accel pts → remaining spend = (remainingPts / 10) * 100
  const remainingSpend = Math.ceil((remainingPts / 10) * 100);
  const pct = Math.min(100, (pts / cap) * 100).toFixed(0);

  const overages = tb.timesBlackDailyOverages || [];
  const dailyWarning = overages.length
    ? `<div class="tracker-warning">⚠ Daily 8k accel cap hit (capped to 8,000): ${overages
        .map(o => `${o.day} (raw ${o.raw.toLocaleString('en-IN')} pts)`)
        .join(', ')}</div>`
    : '';

  return `
    <div class="tracker-card">
      <div class="tracker-header">
        <span class="tracker-title">Times Black iShop</span>
        <span class="tracker-badge ${pts >= cap ? 'badge-red' : 'badge-green'}">${pts >= cap ? 'Cap reached' : 'Active'}</span>
      </div>
      <div class="tracker-metric">${pts.toLocaleString('en-IN')} <span class="tracker-sub">/ 15,000 pts</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar bar-indigo ${pts >= cap ? 'bar-red' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="tracker-row">
        <span>${pts >= cap ? '✓ Cap reached' : formatCurrency(remainingSpend) + ' to max cap'}</span>
        <span>${pct}% used</span>
      </div>
      ${dailyWarning}
    </div>
  `;
}

async function loadVtSummary(monthStart) {
  // Fetch all voucher trades; filter in JS. Personal-scale volume — fine.
  // Skip parent docs (they aggregate children); count children + legacy.
  // Scopes per spec:
  //   gross   = sum purchaseAmount where purchaseDate is in current month (any status)
  //   net     = sum cashReceived  where status='Traded' AND tradeDate is in current month
  //   haircut = sum (purchaseAmount - cashReceived) over the same set as `net`
  //   pending = sum purchaseAmount where status='Pending' (all time, current exposure)
  const snap = await getDocs(collection(db, 'voucherTrades'));
  let gross = 0, haircut = 0, net = 0, pending = 0;
  snap.forEach(d => {
    const v = d.data();
    if (v.isParent) return;
    const purchaseAmount = v.purchaseAmount || 0;
    const pd = v.purchaseDate?.toDate ? v.purchaseDate.toDate() : null;
    const td = v.tradeDate?.toDate    ? v.tradeDate.toDate()    : null;

    if (pd && pd >= monthStart) gross += purchaseAmount;

    if (v.status === 'Traded' && td && td >= monthStart) {
      const cash = v.cashReceived || 0;
      net     += cash;
      haircut += (purchaseAmount - cash);
    }

    if (v.status === 'Pending') pending += purchaseAmount;
  });
  return { gross, haircut, net, pending };
}

function renderVtSummary(s) {
  if (!s) return '';
  const { gross, haircut, net, pending } = s;
  // Haircut % is computed over the settled-this-month base (i.e., haircut + net),
  // not over `gross` — gross includes purchased-but-not-yet-settled items, which
  // would dilute the ratio meaninglessly.
  const settledBase = haircut + net;
  const haircutPct = settledBase > 0 ? (haircut / settledBase * 100).toFixed(1) : '0.0';
  return `
    <div class="tracker-card vt-summary-card">
      <div class="tracker-header">
        <span class="tracker-title">Voucher Trades · MTD</span>
      </div>
      <div class="tracker-metric">${formatCurrency(haircut)} <span class="tracker-sub">haircut · ${haircutPct}%</span></div>
      <div class="vt-summary-grid">
        <div><span class="vt-summary-label">Gross (purchased)</span><span class="vt-summary-val">${formatCurrency(gross)}</span></div>
        <div><span class="vt-summary-label">Net (settled)</span><span class="vt-summary-val">${formatCurrency(net)}</span></div>
        <div><span class="vt-summary-label">Pending (all-time)</span><span class="vt-summary-val">${formatCurrency(pending)}</span></div>
      </div>
    </div>
  `;
}

function renderTotalCard(cardResults) {
  const totalStmt  = cardResults.reduce((sum, r) => sum + r.stmtBalance, 0);
  const totalSpend = cardResults.reduce((sum, r) => sum + r.stmtSpend, 0);
  const totalMtd   = cardResults.reduce((sum, r) => sum + r.mtdSpend, 0);
  return `
    <div class="balance-card total-card">
      <div class="balance-card-header">
        <span class="card-name">All Cards</span>
        <span class="billing-cycle">Combined</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Next Statement</span>
        <span class="balance-amount accent">${formatCurrency(totalStmt)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Cycle Spend</span>
        <span class="balance-amount">${formatCurrency(totalSpend)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">MTD Spend</span>
        <span class="balance-amount">${formatCurrency(totalMtd)}</span>
      </div>
    </div>
  `;
}

function renderCardBalanceCard(r) {
  const aepRibbon = (r.dashboardWidget === 'mbAep' && r.magnusAepEligible >= 150000)
    ? `<span class="aep-ribbon">AEP On ✓</span>` : '';
  return `
    <div class="balance-card">
      ${aepRibbon}
      <div class="balance-card-header">
        <span class="card-name">${r.name}</span>
        <span class="billing-cycle">${r.billingCycle}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Next Statement</span>
        <span class="balance-amount accent">${formatCurrency(r.stmtBalance)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Cycle Spend</span>
        <span class="balance-amount">${formatCurrency(r.stmtSpend)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">MTD Spend</span>
        <span class="balance-amount">${formatCurrency(r.mtdSpend)}</span>
      </div>
    </div>
  `;
}

function renderMagnusAep(cardResults, mbAep) {
  const magnus = cardResults.find(r => r.dashboardWidget === 'mbAep');
  if (!magnus) return '';

  const spend = magnus.magnusAepEligible;
  const { band, calculatedPoints: pts, band1Max } = computeAepBands(spend, mbAep);

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
  const infinia = cardResults.find(r => r.dashboardWidget === 'infiniaSb');
  if (!infinia) return '';

  const accelPts = infinia.magnusSmartBuyPts;
  const cap = SMARTBUY_CAP;
  const remainingPts = Math.max(0, cap - accelPts);
  // ₹150 SmartBuy spend earns 20 accel pts → remaining spend = (remainingPts / 20) * 150
  const remainingSpend = Math.ceil((remainingPts / 20) * 150);
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
  const epm = cardResults.find(r => r.dashboardWidget === 'epmIshop');
  if (!epm) return '';

  const pts = epm.epmIshopPts;
  const cap = ISHOP_CAP;
  const remainingPts = Math.max(0, cap - pts);
  // ₹200 iShop spend earns 30 accel pts → remaining spend = (remainingPts / 30) * 200
  const remainingSpend = Math.ceil((remainingPts / 30) * 200);
  const pct = Math.min(100, (pts / cap) * 100).toFixed(0);

  const overages = epm.epmDailyOverages || [];
  const dailyWarning = overages.length
    ? `<div class="tracker-warning">⚠ Daily 10k accel cap hit (capped to 10k): ${overages
        .map(o => `${o.day} (raw ${o.raw.toLocaleString('en-IN')} pts)`)
        .join(', ')}</div>`
    : '';

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
      ${dailyWarning}
    </div>
  `;
}
