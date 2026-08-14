// Shared points / rewards rate config for the cards-tracker UI.
//
// These rates mirror the cards-processor backend
// (processor/firestore_utils.py: CARD_POINTS_RATES, derive_transaction_tag,
// compute_points, AEP bands). The processor stamps pointsEarned on the daily
// run; this file lets the UI's auto-calc agree with it. If a rate changes,
// update BOTH repos or the UI guide and the stored value will diverge.

// Base earn rates (points per ₹`per`).
export const CARD_POINTS_RATES = {
  'Magnus Burgundy': { rate: 12, per: 200 },
  'Infinia':         { rate: 5,  per: 150 },
  'ICICI EPM':       { rate: 6,  per: 200 },
  'Times Black':     { rate: 2,  per: 100 },
  'HSBC Premier':    { rate: 3,  per: 100 },
};

// Categories that earn ZERO base points, per card. Magnus Burgundy is
// intentionally absent — for that card, base earning follows the backend's
// AEP exclusion set (see AEP_EXCLUDED_CATS + computePointsForTag below).
export const CARD_EXCLUDED_CATS = {
  'Infinia':     new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load']),
  'ICICI EPM':   new Set(['Fuel', 'Fees & Charges', 'Government Services', 'Rent', 'Wallet Load']),
  'Times Black': new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Insurance']),
  'HSBC Premier': new Set(['Fuel', 'Fees & Charges']),
};

// HSBC Premier earns base 3/100 in these categories only up to ₹1L cumulative
// spend/calendar month (combined). The UI guide shows the un-capped base
// (backend enforces the ₹1L spend cap, same as the SmartBuy/iShop caps).
export const HSBC_CAPPED_CATS = new Set([
  'Utilities & Telecom', 'Government Services', 'Education & Classes',
  'Rent', 'Shopping - Jewellery', 'Insurance', 'Wallet Load',
]);
export const HSBC_CAPPED_SPEND_LIMIT = 100000;

// Magnus AEP-excluded categories. Backend uses this set for BOTH AEP
// eligibility AND base-point exclusion on Magnus Burgundy
// (firestore_utils.py::compute_points), so the UI must mirror that.
export const AEP_EXCLUDED_CATS = new Set([
  'Fees & Charges', 'Fuel', 'Government Services', 'Insurance',
  'Utilities & Telecom', 'Shopping - Jewellery', 'Wallet Load',
]);

// Accelerated-points caps (monthly, calendar-month reset).
export const SMARTBUY_CAP = 15000;
export const ISHOP_CAP = 18000;
export const ISHOP_DAILY_ACCEL_CAP = 10000;
export const TIMES_BLACK_ISHOP_CAP = 15000;
export const TIMES_BLACK_DAILY_ACCEL_CAP = 8000;
export const HSBC_TWP_CAP = 18000;

// AEP band defaults — overridden per-field by config/mbAep when present.
export const AEP_BAND_DEFAULTS = {
  band1Max: 150000, band2Max: 1450000,
  band1Rate: 12, band2Rate: 35, band3Rate: 12,
};

// Dashboard spend-tracker widgets. A card opts into one via its
// `dashboardWidget` config field, so the widget (and the AEP ledger) follow
// the card through a rename instead of being hard-bound to its name.
export const DASHBOARD_WIDGETS = [
  { id: '',               label: 'None' },
  { id: 'mbAep',          label: 'Magnus AEP' },
  { id: 'infiniaSb',      label: 'Infinia SmartBuy' },
  { id: 'epmIshop',       label: 'EPM iShop' },
  { id: 'timesBlackIshop', label: 'Times Black iShop' },
  { id: 'hsbcTwp',        label: 'HSBC TWP' },
];

// Cards historically hard-linked to a widget. Used only as the default for
// cards that predate the explicit `dashboardWidget` field — once a card is
// saved from Settings, its own stored field takes over.
export const DEFAULT_WIDGET_BY_NAME = {
  'Magnus Burgundy': 'mbAep',
  'Infinia':         'infiniaSb',
  'ICICI EPM':       'epmIshop',
  'Times Black':     'timesBlackIshop',
  'HSBC Premier':    'hsbcTwp',
};

// Resolve a card's dashboard widget from its raw config value, falling back
// to the legacy name-based default. `value` may be the legacy bare integer.
export function resolveDashboardWidget(name, value) {
  if (value && typeof value === 'object' && value.dashboardWidget) {
    return value.dashboardWidget;
  }
  return DEFAULT_WIDGET_BY_NAME[name] || '';
}

// HSBC "Travel with Points" portal total rates (pts per ₹100), mirroring
// processor's _hsbc_twp_rate. Portal txns land as "HSBCIN TWP FLIGHT" etc.
const HSBC_TWP_RATES = [['HOTEL', 36], ['FLIGHT', 18], ['CAR', 6]];
export function hsbcTwpRate(descUpper) {
  if (!/\bTWP\b/.test(descUpper)) return null;
  for (const [kw, rate] of HSBC_TWP_RATES) {
    if (descUpper.includes(kw)) return rate;
  }
  return null;
}

// Mirror processor's derive_transaction_tag(card, description).
// Tag drives accelerated points; UI and processor derive it identically so
// manual edits stay consistent with automated writes.
export function deriveTag(card, description) {
  const desc = (description || '').toUpperCase();
  if (card === 'Infinia' && desc.includes('SMARTBUY')) return 'SmartBuy';
  const stripped = desc.replace(/\s+/g, '');
  if ((card === 'ICICI EPM' || card === 'Times Black') &&
      (stripped.includes('ISHOP') || stripped.includes('REWARD360GLOB'))) {
    return 'iShop';
  }
  if (card === 'HSBC Premier' && hsbcTwpRate(desc) !== null) return 'TWP';
  return '';
}

// Compute points keyed off tag (uncapped — processor enforces monthly caps
// at write time; the UI shows the un-capped value as a guide).
export function computePointsForTag(card, amount, category, type, tag, description = '', twpRate = 0) {
  if (type === 'credit') return 0;
  if (card === 'Magnus Burgundy') {
    // Backend zeros base points whenever the category is AEP-excluded.
    // Otherwise it prorates across the 3 AEP bands (Band 2 = 35/200). The UI
    // can't replicate band proration without per-txn cumulative state, so this
    // returns the base 12/200 rate — used only as a "guide" for NEW txns. The
    // edit flow preserves the backend-stored value (see transactions.js).
    if (AEP_EXCLUDED_CATS.has(category)) return 0;
    return Math.floor(amount / 200) * 12;
  }
  const excl = CARD_EXCLUDED_CATS[card];
  if (excl && excl.has(category)) return 0;
  if (card === 'Infinia' && tag === 'SmartBuy') {
    return Math.floor(amount / 150) * 25;  // 5x = base 5 + accel 20
  }
  if (card === 'ICICI EPM' && tag === 'iShop') {
    const rate = category === 'Travel - Hotels' ? 72 : 36;  // 6x or 12x
    return Math.floor(amount / 200) * rate;
  }
  if (card === 'Times Black' && tag === 'iShop') {
    return Math.floor(amount / 100) * 12;  // 6x
  }
  if (card === 'HSBC Premier') {
    // TWP portal: Flight 18, Hotel 36, Car 6 per ₹100. The rate is normally
    // description-driven (matching the backend), but a manually-tagged TWP txn
    // whose description lacks the FLIGHT/HOTEL/CAR keyword carries an explicit
    // `twpRate` override (chosen in the modal). Override wins when present.
    // Capped cats earn base 3/100 here (un-capped guide; backend enforces the
    // ₹1L/mo spend cap). Fuel/Fees already 0 above.
    const twp = twpRate || hsbcTwpRate((description || '').toUpperCase());
    if (twp) return Math.floor(amount / 100) * twp;
  }
  const r = CARD_POINTS_RATES[card];
  return r ? Math.floor(amount / r.per) * r.rate : 0;
}

// Accel-only points for the SmartBuy / iShop dashboard cap trackers.
export function smartBuyAccelPts(amount) {
  return Math.floor((amount || 0) / 150) * 20;  // 4× accel of 5pts/₹150
}
export function epmIshopAccelPts(amount) {
  return Math.floor((amount || 0) / 200) * 30;  // 5× accel of 6pts/₹200
}
export function timesBlackIshopAccelPts(amount) {
  return Math.floor((amount || 0) / 100) * 10;  // 5× accel of 2pts/₹100
}

// Magnus AEP eligibility for a single transaction.
export function isAepEligible(txn) {
  return txn.type === 'debit'
    && !AEP_EXCLUDED_CATS.has(txn.category)
    && txn.category !== 'Rent'
    && txn.transactionTag !== 'AEP Ineligible';
}

// Band-aware Magnus points for ONE debit, mirroring the backend's proration.
// `priorEligible` is the month's AEP-eligible spend already booked (every other
// eligible Magnus debit that month) — the store holds it all in memory, so the
// UI no longer has to fall back to a flat base-rate guess. The txn earns the
// MARGINAL band points its amount adds on top of `priorEligible`: base 12/200
// up to ₹1.5L, then 35/200 (Band 2). Non-eligible-but-earning spend (Rent, or
// AEP-Ineligible-tagged) earns base only; AEP-excluded categories earn 0.
export function magnusTxnPoints(amount, category, tag, priorEligible = 0, mbAep = {}) {
  if (AEP_EXCLUDED_CATS.has(category)) return 0;
  const base = mbAep.band1Rate || AEP_BAND_DEFAULTS.band1Rate;
  const eligible = category !== 'Rent' && tag !== 'AEP Ineligible';
  if (!eligible) return Math.floor(amount / 200) * base;
  const before = computeAepBands(priorEligible, mbAep).calculatedPoints;
  const after  = computeAepBands(priorEligible + amount, mbAep).calculatedPoints;
  return Math.max(0, after - before);
}

// Prorate eligible AEP spend across the 3 bands. `calculatedPoints` is the
// TOTAL (base + accelerated) the bands earn; `aepPoints` is the ACCELERATED
// portion only — the earn ABOVE the base rate (band1Rate) — which is what the
// AEP milestone credits separately (23/200 in Band 2 by default: 35 − 12).
export function computeAepBands(eligibleSpend, mbAep = {}) {
  const band1Max  = mbAep.band1Max  || AEP_BAND_DEFAULTS.band1Max;
  const band2Max  = mbAep.band2Max  || AEP_BAND_DEFAULTS.band2Max;
  const band1Rate = mbAep.band1Rate || AEP_BAND_DEFAULTS.band1Rate;
  const band2Rate = mbAep.band2Rate || AEP_BAND_DEFAULTS.band2Rate;
  const band3Rate = mbAep.band3Rate || AEP_BAND_DEFAULTS.band3Rate;

  // Spend falling within each band.
  const band1Spend = Math.min(eligibleSpend, band1Max);
  const band2Spend = Math.max(0, Math.min(eligibleSpend, band2Max) - band1Max);
  const band3Spend = Math.max(0, eligibleSpend - band2Max);

  const band =
    eligibleSpend <= band1Max ? 'Band 1' :
    eligibleSpend <= band2Max ? 'Band 2' : 'Band 3';

  // Total points (base + accelerated) each band earns.
  const band1Pts = Math.floor(band1Spend / 200) * band1Rate;
  const band2Pts = Math.floor(band2Spend / 200) * band2Rate;
  const band3Pts = Math.floor(band3Spend / 200) * band3Rate;

  // Accelerated (AEP) points only = earn above the base rate. Band 1 is the
  // un-accelerated base, so its bonus is 0; Band 2 gives (band2Rate − base).
  const base = band1Rate;
  const band1Bonus = Math.floor(band1Spend / 200) * Math.max(0, band1Rate - base);
  const band2Bonus = Math.floor(band2Spend / 200) * Math.max(0, band2Rate - base);
  const band3Bonus = Math.floor(band3Spend / 200) * Math.max(0, band3Rate - base);

  return {
    band, band1Pts, band2Pts, band3Pts,
    calculatedPoints: band1Pts + band2Pts + band3Pts,
    band1Bonus, band2Bonus, band3Bonus,
    aepPoints: band1Bonus + band2Bonus + band3Bonus,
    band1Max, band2Max, band1Rate, band2Rate, band3Rate,
  };
}
