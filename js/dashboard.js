import { getTxns, getVts, onStoreChange, getCachedDoc } from './store.js';
import { formatCurrency, getStatementStartDate, getStatementEndDate, getCurrentMonthStart, getBillingCycleLabel } from './utils.js';
import { isAepEligible, smartBuyAccelPts, epmIshopAccelPts, timesBlackIshopAccelPts, hsbcTwpRate, computeAepBands, resolveDashboardWidget, SMARTBUY_CAP, ISHOP_CAP, ISHOP_DAILY_ACCEL_CAP, TIMES_BLACK_ISHOP_CAP, TIMES_BLACK_DAILY_ACCEL_CAP, HSBC_TWP_CAP } from './points-config.js';
import { loadCharts } from './charts.js';

// Mobile-only expand control rendered at a chart canvas's bottom-right; opens
// the chart fullscreen (CSS hides it above 600px).
function expandBtn(key, title) {
  return `<button class="chart-expand-btn" type="button" aria-label="Expand chart"
    onclick="window.expandChart('${key}', '${title.replace(/'/g, "\\'")}')">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
  </button>`;
}

// Monotonic sequence guarding against out-of-order renders: if the user
// toggles away and back mid-load, only the latest invocation may write the
// panel — a slow earlier fetch can no longer clobber (or lose to) a newer one.
let loadSeq = 0;

// Live refresh: when the store receives a delta (new SMS txn, edit from
// another device) while the dashboard is on screen, re-render quietly —
// no Loading flash, the numbers just update.
let liveWired = false;
function wireLiveRefresh() {
  if (liveWired) return;
  liveWired = true;
  onStoreChange(() => {
    const panel = document.getElementById('tab-dashboard');
    if (panel && !panel.classList.contains('hidden')) loadDashboard(true);
  });
}

export async function loadDashboard(quiet = false) {
  wireLiveRefresh();
  const seq = ++loadSeq;
  const container = document.getElementById('dashboard-content');
  if (!quiet) container.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const [cardsSnap, mbAepSnap] = await Promise.all([
      getCachedDoc('config', 'cards'),
      getCachedDoc('config', 'mbAep'),
    ]);
    const cardsData = cardsSnap.exists() ? cardsSnap.data() : {};
    const cards = Object.entries(cardsData)
      .filter(([, val]) => typeof val === 'number' || (!val.deleted && val.active !== false))
      .map(([name, val]) => ({
        name,
        cutoffDay: typeof val === 'number' ? val : (val.statementDate || 1),
        billDay: typeof val === 'number' ? null : (val.billPaymentDate || null),
        dashboardWidget: resolveDashboardWidget(name, val),
        showOnDashboard: typeof val === 'number' ? true : (val.showOnDashboard !== false),
        showWhenZero: typeof val === 'number' ? false : (val.showWhenZero === true),
        showInTrackers: typeof val === 'number' ? true : (val.showInTrackers !== false),
        autoAdjustCredits: typeof val === 'number' ? true : (val.autoAdjustCredits !== false),
      }));
    const mbAep = mbAepSnap.exists() ? mbAepSnap.data() : {};

    // Everything downstream — per-card balances, tracker widgets, VT summary,
    // charts — computes from the shared live store (store.js). The store's
    // listeners resume from the persistent cache, so this resolves instantly
    // on repeat visits and only doc DELTAS ever cross the network.
    const [txns, vts] = await Promise.all([getTxns(), getVts()]);
    if (seq !== loadSeq) return;
    renderDashboard(container, cards, mbAep, txns, vts);
  } catch (e) {
    if (seq === loadSeq) {
      container.innerHTML = `<p class="error">Error loading dashboard: ${e.message}</p>`;
    }
  }
}

function renderDashboard(container, cards, mbAep, txns, vts) {
  const monthStart = getCurrentMonthStart();

  const byCard = new Map();
  txns.forEach(t => {
    if (!t.card) return;
    if (!byCard.has(t.card)) byCard.set(t.card, []);
    byCard.get(t.card).push(t);
  });

  const cardResults = cards.map(c => computeCardData(c, byCard.get(c.name) || [], monthStart));
  const vtSummary   = computeVtSummary(vts, monthStart);
  const sortedCards = [...cardResults].sort((a, b) =>
    (b.totalOutstanding - a.totalOutstanding) || a.name.localeCompare(b.name));

  container.innerHTML = `
      <section class="section">
        <h2 class="section-title">Card Balances</h2>
        <div class="cards-grid">
          ${renderTotalCard(cardResults)}
          <div class="grid-row-break"></div>
          ${sortedCards.filter(r => r.showOnDashboard && (r.totalOutstanding !== 0 || r.showWhenZero)).map(r => renderCardBalanceCard(r)).join('')}
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Spend Trackers</h2>
        <div class="trackers-grid" id="trackers-grid">
          ${renderMagnusAep(cardResults, mbAep)}
          ${renderInfiniaSmartBuy(cardResults)}
          ${renderEpmIshop(cardResults)}
          ${renderTimesBlackIshop(cardResults)}
          ${renderHsbcTwp(cardResults)}
          ${renderVtSummary(vtSummary)}
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">Charts</h2>
        <div class="chart-card chart-card-wide">
          <div class="chart-title">Monthly Spend by Card</div>
          <div class="chart-canvas-wrap chart-canvas-bar">
            <canvas id="chart-monthly"></canvas>
            ${expandBtn('monthly', 'Monthly Spend by Card')}
          </div>
        </div>
        <div class="charts-grid-donuts">
          <div class="chart-card">
            <div class="chart-head">
              <div class="chart-title">Spend by Category — YTD</div>
              <div class="chart-total" id="chart-cat-ytd-total"></div>
            </div>
            <div class="chart-canvas-wrap chart-canvas-donut">
              <canvas id="chart-cat-ytd"></canvas>
              ${expandBtn('catYtd', 'Spend by Category — YTD')}
            </div>
          </div>
          <div class="chart-card">
            <div class="chart-head">
              <div class="chart-title">Spend by Category — MTD</div>
              <div class="chart-total" id="chart-cat-mtd-total"></div>
            </div>
            <div class="chart-canvas-wrap chart-canvas-donut">
              <canvas id="chart-cat-mtd"></canvas>
              ${expandBtn('catMtd', 'Spend by Category — MTD')}
            </div>
          </div>
        </div>
      </section>
    `;
  loadCharts(txns);
}

// Pure computation over the dashboard's single pre-fetched snapshot — no
// Firestore reads in here (this used to fire 3 queries per card).
function computeCardData(card, cardTxns, monthStart) {
  const autoAdjustCredits = card.autoAdjustCredits !== false;
  const stmtStart = getStatementStartDate(card.cutoffDay);
  // Upper bound the statement window so next-cycle / future-dated txns don't
  // leak in. End is the last day of the current billing cycle, inclusive.
  const stmtEnd = new Date(getStatementEndDate(card.cutoffDay));
  stmtEnd.setHours(23, 59, 59, 999);

  const txnDate = t => (t.date && t.date.toDate) ? t.date.toDate()
                     : (t.date ? new Date(t.date) : null);

  // totalOutstanding = all-time net (total debits minus total credits/payments ever
  // recorded). The true current balance on the card, accounting for carry-forward
  // from partially-paid prior cycles.
  let totalOutstanding = 0;
  cardTxns.forEach(t => {
    const amt = t.amount || 0;
    if (t.type === 'debit') totalOutstanding += amt;
    else totalOutstanding -= amt;
  });

  // Current billing cycle: cycleDebits = "Cycle Spend". nextStatement = the
  // upcoming bill. With credit auto-adjust ON (default) current-cycle credits pay
  // down the prior statement FIRST; only the leftover (once the prior balance is
  // cleared) reduces Next Statement — so a credit on an already-paid-off card
  // correctly lowers the upcoming bill instead of vanishing. With it OFF, all
  // current-cycle credits net straight into Next Statement.
  let cycleDebits = 0, cycleCredits = 0;
  cardTxns.forEach(t => {
    const d = txnDate(t);
    if (!d || d < stmtStart || d > stmtEnd) return;
    if (t.type === 'debit') cycleDebits += (t.amount || 0);
    else cycleCredits += (t.amount || 0);
  });
  const stmtSpend = cycleDebits;
  const priorNet = totalOutstanding - (cycleDebits - cycleCredits);
  const appliedToPrior = autoAdjustCredits ? Math.min(cycleCredits, Math.max(priorNet, 0)) : 0;
  const nextStatement = cycleDebits - (cycleCredits - appliedToPrior);

  // currentStatement = the already-generated bill currently outstanding (the
  // carry-forward portion not part of the in-progress cycle).
  const currentStatement = totalOutstanding - nextStatement;

  // Due dates. A statement closes on cutoffDay and is due on billDay; when
  // billDay <= cutoffDay the due date falls in the month after the cycle closes.
  // The current statement closed at stmtStart (the most recent cutoff); the next
  // statement closes one cycle later.
  let currentStatementDue = null, nextStatementDue = null;
  if (card.billDay) {
    const dueOffset = card.billDay > card.cutoffDay ? 0 : 1;
    currentStatementDue = new Date(stmtStart.getFullYear(), stmtStart.getMonth() + dueOffset, card.billDay);
    nextStatementDue    = new Date(stmtStart.getFullYear(), stmtStart.getMonth() + 1 + dueOffset, card.billDay);
  }

  let mtdSpend = 0;
  let mtdTxns = [];
  cardTxns.forEach(t => {
    const d = txnDate(t);
    if (!d || d < monthStart) return;
    if (t.type === 'debit') mtdSpend += (t.amount || 0);
    mtdTxns.push(t);
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

  // HSBC TWP travel portal — accumulate the BONUS (accelerated) points only,
  // i.e. the portal rate minus the 3/₹100 base (Flight 18→15, Hotel 36→33,
  // Car 6→3 per ₹100). The 18,000/month cap is on this bonus portion.
  let hsbcTwpSpend = 0;
  let hsbcTwpPts = 0;
  if (card.dashboardWidget === 'hsbcTwp') {
    mtdTxns.forEach(t => {
      if (t.type !== 'debit' || t.transactionTag !== 'TWP') return;
      const rate = t.twpRate || hsbcTwpRate((t.description || '').toUpperCase());
      if (!rate) return;
      hsbcTwpSpend += t.amount || 0;
      hsbcTwpPts += Math.floor((t.amount || 0) / 100) * (rate - 3);
    });
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
    totalOutstanding,
    nextStatement,
    currentStatement,
    currentStatementDue,
    nextStatementDue,
    stmtSpend,
    mtdSpend,
    stmtStart,
    magnusAepEligible,
    magnusSmartBuyPts,
    epmIshopPts,
    epmDailyOverages,
    timesBlackIshopPts,
    timesBlackDailyOverages,
    hsbcTwpSpend,
    hsbcTwpPts,
    billingCycle: getBillingCycleLabel(card.cutoffDay)
  };
}

function renderTimesBlackIshop(cardResults) {
  const tb = cardResults.find(r => r.dashboardWidget === 'timesBlackIshop' && r.showInTrackers !== false);
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

function computeVtSummary(vts, monthStart) {
  // Filter the dashboard's pre-fetched voucherTrades in JS.
  // Skip parent docs (they aggregate children); count children + legacy.
  // Scopes per spec:
  //   gross   = sum purchaseAmount where purchaseDate is in current month (any status)
  //   net     = sum cashReceived  where status='Traded' AND tradeDate is in current month
  //   haircut = sum (purchaseAmount - cashReceived) over the same set as `net`
  //   pending = sum purchaseAmount where status='Pending' (all time, current exposure)
  let gross = 0, haircut = 0, net = 0, pending = 0;
  vts.forEach(v => {
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
  const totalOutstanding = cardResults
    .filter(r => r.totalOutstanding > 0)
    .reduce((sum, r) => sum + r.totalOutstanding, 0);
  const totalNext  = cardResults.reduce((sum, r) => sum + r.nextStatement, 0);
  const totalCurrent = cardResults.reduce((sum, r) => sum + r.currentStatement, 0);
  const totalMtd   = cardResults.reduce((sum, r) => sum + r.mtdSpend, 0);
  return `
    <div class="balance-card total-card">
      <div class="balance-card-header">
        <span class="card-name">All Cards</span>
        <span class="billing-cycle">Combined</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Total Outstanding</span>
        <span class="balance-amount accent">${formatCurrency(totalOutstanding)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Current Statement</span>
        <span class="balance-amount accent">${formatCurrency(totalCurrent)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">Next Statement</span>
        <span class="balance-amount accent">${formatCurrency(totalNext)}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label">MTD Spend</span>
        <span class="balance-amount">${formatCurrency(totalMtd)}</span>
      </div>
    </div>
  `;
}

function ordinalDay(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return n + suffix;
}

function fmtDueShort(d) {
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
}

// A statement-outstanding row with the bill's due date stacked beneath the label
// in small font + brackets (kept off the amount line so it never clips on a
// narrow tile).
function stmtRow(label, amount, dueDate) {
  const dueNote = dueDate ? `<span class="due-note">(due ${fmtDueShort(dueDate)})</span>` : '';
  return `
      <div class="balance-row balance-row-stmt">
        <span class="balance-label-col">
          <span class="balance-label">${label}</span>
          ${dueNote}
        </span>
        <span class="balance-amount accent">${formatCurrency(amount)}</span>
      </div>`;
}

function renderCardBalanceCard(r) {
  const aepRibbon = (r.dashboardWidget === 'mbAep' && r.magnusAepEligible >= 150000)
    ? `<span class="aep-ribbon">AEP On ✓</span>` : '';
  const isCredit = r.totalOutstanding < 0;
  const outstandingDisplay = isCredit
    ? `${formatCurrency(r.totalOutstanding)} cr`
    : formatCurrency(r.totalOutstanding);
  // Header due tag shows just the bill day (the current statement's due date).
  const dueDay = r.billDay ? `<span class="due-day">Due ${ordinalDay(r.billDay)}</span>` : '';
  return `
    <div class="balance-card">
      ${aepRibbon}
      <div class="balance-card-header">
        <span class="card-name">${r.name}</span>
        <div class="cycle-row">
          <span class="billing-cycle">${r.billingCycle}</span>
          ${dueDay}
        </div>
      </div>
      <div class="balance-row">
        <span class="balance-label">Total Outstanding</span>
        <span class="balance-amount accent${isCredit ? ' credit' : ''}">${outstandingDisplay}</span>
      </div>
      ${stmtRow('Current Statement', r.currentStatement, r.currentStatementDue)}
      ${stmtRow('Next Statement', r.nextStatement, r.nextStatementDue)}
      <div class="balance-row">
        <span class="balance-label">MTD Spend</span>
        <span class="balance-amount">${formatCurrency(r.mtdSpend)}</span>
      </div>
    </div>
  `;
}

function renderMagnusAep(cardResults, mbAep) {
  const magnus = cardResults.find(r => r.dashboardWidget === 'mbAep' && r.showInTrackers !== false);
  if (!magnus) return '';

  const spend = magnus.magnusAepEligible;
  const { band, aepPoints: pts, band1Max } = computeAepBands(spend, mbAep);

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
        <span>${pts.toLocaleString('en-IN')} AEP pts earned</span>
      </div>
    </div>
  `;
}

function renderInfiniaSmartBuy(cardResults) {
  const infinia = cardResults.find(r => r.dashboardWidget === 'infiniaSb' && r.showInTrackers !== false);
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
  const epm = cardResults.find(r => r.dashboardWidget === 'epmIshop' && r.showInTrackers !== false);
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

function renderHsbcTwp(cardResults) {
  const hsbc = cardResults.find(r => r.dashboardWidget === 'hsbcTwp' && r.showInTrackers !== false);
  if (!hsbc) return '';

  const pts = hsbc.hsbcTwpPts;
  const cap = HSBC_TWP_CAP;
  const remainingPts = Math.max(0, cap - pts);
  // Flights earn 15 bonus pts/₹100 (5× of base 3) — use that as the
  // representative rate for the "spend to cap" estimate (hotel/car reach it faster).
  const remainingSpend = Math.ceil((remainingPts / 15) * 100);
  const pct = Math.min(100, (pts / cap) * 100).toFixed(0);

  return `
    <div class="tracker-card">
      <div class="tracker-header">
        <span class="tracker-title">HSBC TWP</span>
        <span class="tracker-badge ${pts >= cap ? 'badge-red' : 'badge-green'}">${pts >= cap ? 'Cap reached' : 'Active'}</span>
      </div>
      <div class="tracker-metric">${pts.toLocaleString('en-IN')} <span class="tracker-sub">/ 18,000 pts</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar bar-sage ${pts >= cap ? 'bar-red' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="tracker-row">
        <span>${pts >= cap ? '✓ Cap reached' : formatCurrency(remainingSpend) + ' to max cap'}</span>
        <span>${pct}% used</span>
      </div>
    </div>
  `;
}
