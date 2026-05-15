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
};

// Categories that earn ZERO base points, per card.
export const CARD_EXCLUDED_CATS = {
  'Magnus Burgundy': new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load', 'EMI']),
  'Infinia':         new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Rent', 'Insurance', 'Wallet Load']),
  'ICICI EPM':       new Set(['Fuel', 'Fees & Charges', 'Government Services', 'Rent', 'Wallet Load']),
  'Times Black':     new Set(['Fees & Charges', 'Fuel', 'Government Services', 'Insurance']),
};

// Categories excluded from Magnus AEP *eligible spend*. Distinct from the
// base-points exclusion above — AEP eligibility is its own ruleset.
export const AEP_EXCLUDED_CATS = new Set([
  'Fees & Charges', 'Fuel', 'Government Services', 'Insurance',
  'Utilities & Telecom', 'Shopping - Jewellery', 'Wallet Load',
]);

// Accelerated-points caps (monthly, calendar-month reset).
export const SMARTBUY_CAP = 15000;
export const ISHOP_CAP = 18000;
export const ISHOP_DAILY_ACCEL_CAP = 10000;

// AEP band defaults — overridden per-field by config/mbAep when present.
export const AEP_BAND_DEFAULTS = {
  band1Max: 150000, band2Max: 1450000,
  band1Rate: 12, band2Rate: 35, band3Rate: 12,
};

// Dashboard spend-tracker widgets. A card opts into one via its
// `dashboardWidget` config field, so the widget (and the AEP ledger) follow
// the card through a rename instead of being hard-bound to its name.
export const DASHBOARD_WIDGETS = [
  { id: '',         label: 'None' },
  { id: 'mbAep',    label: 'Magnus AEP' },
  { id: 'infiniaSb', label: 'Infinia SmartBuy' },
  { id: 'epmIshop', label: 'EPM iShop' },
];

// Cards historically hard-linked to a widget. Used only as the default for
// cards that predate the explicit `dashboardWidget` field — once a card is
// saved from Settings, its own stored field takes over.
export const DEFAULT_WIDGET_BY_NAME = {
  'Magnus Burgundy': 'mbAep',
  'Infinia':         'infiniaSb',
  'ICICI EPM':       'epmIshop',
};

// Resolve a card's dashboard widget from its raw config value, falling back
// to the legacy name-based default. `value` may be the legacy bare integer.
export function resolveDashboardWidget(name, value) {
  if (value && typeof value === 'object' && value.dashboardWidget) {
    return value.dashboardWidget;
  }
  return DEFAULT_WIDGET_BY_NAME[name] || '';
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
  return '';
}

// Compute points keyed off tag (uncapped — processor enforces monthly caps
// at write time; the UI shows the un-capped value as a guide).
export function computePointsForTag(card, amount, category, type, tag) {
  if (type === 'credit') return 0;
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

// Magnus AEP eligibility for a single transaction.
export function isAepEligible(txn) {
  return txn.type === 'debit'
    && !AEP_EXCLUDED_CATS.has(txn.category)
    && txn.category !== 'Rent'
    && txn.transactionTag !== 'AEP Ineligible';
}

// Prorate eligible AEP spend across the 3 bands. Returns per-band points,
// the total, the band label, and the resolved thresholds/rates used.
export function computeAepBands(eligibleSpend, mbAep = {}) {
  const band1Max  = mbAep.band1Max  || AEP_BAND_DEFAULTS.band1Max;
  const band2Max  = mbAep.band2Max  || AEP_BAND_DEFAULTS.band2Max;
  const band1Rate = mbAep.band1Rate || AEP_BAND_DEFAULTS.band1Rate;
  const band2Rate = mbAep.band2Rate || AEP_BAND_DEFAULTS.band2Rate;
  const band3Rate = mbAep.band3Rate || AEP_BAND_DEFAULTS.band3Rate;

  let band1Pts = 0, band2Pts = 0, band3Pts = 0, band = 'Band 1';
  if (eligibleSpend <= band1Max) {
    band1Pts = Math.floor(eligibleSpend / 200) * band1Rate;
    band = 'Band 1';
  } else if (eligibleSpend <= band2Max) {
    band1Pts = Math.floor(band1Max / 200) * band1Rate;
    band2Pts = Math.floor((eligibleSpend - band1Max) / 200) * band2Rate;
    band = 'Band 2';
  } else {
    band1Pts = Math.floor(band1Max / 200) * band1Rate;
    band2Pts = Math.floor((band2Max - band1Max) / 200) * band2Rate;
    band3Pts = Math.floor((eligibleSpend - band2Max) / 200) * band3Rate;
    band = 'Band 3';
  }
  return {
    band, band1Pts, band2Pts, band3Pts,
    calculatedPoints: band1Pts + band2Pts + band3Pts,
    band1Max, band2Max, band1Rate, band2Rate, band3Rate,
  };
}
