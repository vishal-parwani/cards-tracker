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
  'Atlas':           { rate: 2,  per: 100 },   // EDGE Miles; travel earns 5 (see below)
};

// Categories that earn ZERO base points, per card. Magnus Burgundy is
// intentionally absent — for that card, base earning follows the backend's
// AEP exclusion set (see AEP_EXCLUDED_CATS + computePointsForTag below).
export const CARD_EXCLUDED_CATS = {
  'Infinia':     new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load']),
  'ICICI EPM':   new Set(['Fuel', 'Fees & Charges', 'Government Services', 'Rent', 'Wallet Load']),
  'Times Black': new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Insurance']),
  'HSBC Premier': new Set(['Fuel', 'Fees & Charges']),
  // Axis Atlas T&C (20-Apr-2024): gold/jewellery, rent, wallet, government,
  // insurance, fuel, utilities and telecom earn no EDGE Miles.
  'Atlas': new Set(['Shopping - Jewellery', 'Rent', 'Wallet Load',
                    'Government Services', 'Insurance', 'Fuel',
                    'Utilities & Telecom', 'Fees & Charges']),
};

// Atlas earns 5 EDGE Miles/₹100 on travel (Travel EDGE portal, direct airline,
// direct hotel) and 2/₹100 on everything else. The 5x is capped at ₹2L of
// travel spend per calendar month — the backend enforces that cap; this guide
// is un-capped, same convention as SmartBuy/iShop.
export const ATLAS_TRAVEL_CATS = new Set(['Travel', 'Travel - Air', 'Travel - Hotels']);
export const ATLAS_TRAVEL_RATE = 5;
export const ATLAS_TRAVEL_SPEND_CAP = 200000;

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

// Magnus Rent earns the base rate on at most this much spend per transaction.
export const MB_RENT_PTS_CAP = 50000;

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
    // One Magnus rule lives in magnusTxnPoints; delegate so the AEP switch,
    // the Rent cap and the exclusions can't drift between the two. No prior
    // spend is known here, so AEP is on only if this txn alone crosses the
    // band — callers with month context should use magnusTxnPoints directly.
    return magnusTxnPoints(amount, category, tag);
  }
  const excl = CARD_EXCLUDED_CATS[card];
  if (excl && excl.has(category)) return 0;
  if (card === 'Atlas' && ATLAS_TRAVEL_CATS.has(category)) {
    return Math.floor(amount / 100) * ATLAS_TRAVEL_RATE;
  }
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

// Split a txn's stored pointsEarned into what posts with the statement (base)
// and what the bank pays separately at month end (accelerated) — Magnus AEP,
// Infinia SmartBuy, EPM/Times Black iShop, HSBC TWP.
//
// The backend already records the accel portion in `pointsMeta`, so that is
// the source of truth; the derivation below is only a fallback for docs
// written before that metadata existed (or edited by hand in the UI).
export function splitPoints(txn, mbAep = {}) {
  const total = txn.pointsEarned || 0;
  if (!total) return { base: 0, accel: 0 };
  const meta = txn.pointsMeta || {};
  const amount = txn.amount || 0;
  const base1 = mbAep.band1Rate || AEP_BAND_DEFAULTS.band1Rate;
  let accel = null;

  if (typeof txn.pointsAccel === 'number') {
    accel = txn.pointsAccel;                               // split set by hand in the modal
  } else if (typeof meta.accel === 'number') {
    accel = meta.accel;                                   // SmartBuy / iShop / TWP
  } else if (txn.card === 'Magnus Burgundy') {
    if (meta.b2_pts !== undefined || meta.b3_pts !== undefined) {
      // Band portions above band 1 earn the AEP rate; the base share of those
      // same portions is what the statement itself credits.
      const above = (b_pts, b_amt) =>
        Math.max(0, (b_pts || 0) - Math.floor((b_amt || 0) / 200) * base1);
      accel = above(meta.b2_pts, meta.b2_amt) + above(meta.b3_pts, meta.b3_amt);
    } else if (isAepEligible(txn)) {
      accel = Math.max(0, total - Math.floor(amount / 200) * base1);
    }
  } else if (txn.card === 'Infinia' && txn.transactionTag === 'SmartBuy') {
    accel = smartBuyAccelPts(amount);
  } else if (txn.card === 'ICICI EPM' && txn.transactionTag === 'iShop') {
    accel = epmIshopAccelPts(amount);
  } else if (txn.card === 'Times Black' && txn.transactionTag === 'iShop') {
    accel = timesBlackIshopAccelPts(amount);
  } else if (txn.card === 'HSBC Premier') {
    const rate = txn.twpRate || hsbcTwpRate((txn.description || '').toUpperCase());
    if (rate) accel = Math.floor(amount / 100) * (rate - 3);
  }

  accel = Math.min(Math.max(accel || 0, 0), total);
  return { base: total - accel, accel };
}

// Magnus AEP eligibility for a single transaction.
export function isAepEligible(txn) {
  return txn.type === 'debit'
    && !AEP_EXCLUDED_CATS.has(txn.category)
    && txn.category !== 'Rent'
    && txn.transactionTag !== 'AEP Ineligible';
}

// Band-aware Magnus points for ONE debit, mirroring the backend's compute_points.
// `priorEligible` is the month's AEP-eligible spend already booked (every other
// eligible Magnus debit that month) — the store holds it all in memory, so the
// UI no longer has to fall back to a flat base-rate guess.
//
// The cumulative spend is a SWITCH, not a proration: it picks ONE rate and the
// txn's whole amount earns at it. Prorating (the marginal band points the amount
// added on top of `priorEligible`) floored the running total, so the stray
// half-block landed on whichever txn straddled a band threshold — two identical
// amounts in the same month came out with different points.
//
// Non-eligible-but-earning spend (Rent, or AEP-Ineligible-tagged) earns base
// only; AEP-excluded categories earn 0.
export function magnusTxnPoints(amount, category, tag, priorEligible = 0, mbAep = {}) {
  if (AEP_EXCLUDED_CATS.has(category)) return 0;
  const band1Max  = mbAep.band1Max  || AEP_BAND_DEFAULTS.band1Max;
  const band2Max  = mbAep.band2Max  || AEP_BAND_DEFAULTS.band2Max;
  const band1Rate = mbAep.band1Rate || AEP_BAND_DEFAULTS.band1Rate;
  const band2Rate = mbAep.band2Rate || AEP_BAND_DEFAULTS.band2Rate;
  const band3Rate = mbAep.band3Rate || AEP_BAND_DEFAULTS.band3Rate;

  // Rent earns the base rate on at most MB_RENT_PTS_CAP of spend (backend rule).
  if (category === 'Rent') {
    return Math.floor(Math.min(amount, MB_RENT_PTS_CAP) / 200) * band1Rate;
  }
  if (tag === 'AEP Ineligible') {
    return Math.floor(amount / 200) * band1Rate;
  }
  // AEP starts only above band1Max, so only the part of THIS txn sitting above
  // the threshold earns the AEP rate; the rest earns base. Each portion is
  // floored on its own — flooring the running cumulative instead is what made
  // two identical amounts in one month earn different points.
  const pre  = Math.max(0, priorEligible);
  const post = pre + amount;
  const b1Amt = Math.max(0, Math.min(post, band1Max) - Math.min(pre, band1Max));
  const b2Amt = post > band1Max
    ? Math.max(0, Math.min(post, band2Max) - Math.max(pre, band1Max)) : 0;
  const b3Amt = post > band2Max ? Math.max(0, post - Math.max(pre, band2Max)) : 0;
  return Math.floor(b1Amt / 200) * band1Rate
       + Math.floor(b2Amt / 200) * band2Rate
       + Math.floor(b3Amt / 200) * band3Rate;
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
