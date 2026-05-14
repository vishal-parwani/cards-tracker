export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '₹0';
  // Preserve the sign: a negative balance is a credit (e.g. Times Black
  // overpaid / net-credit), not an outstanding due. Math.abs would hide it.
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return sign + '₹' + Math.abs(rounded).toLocaleString('en-IN');
}

export function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : date.toDate();
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "26 May, 10:44 PM" — appends time when the timestamp has a non-midnight
// component (i.e. came from time-aware SMS/email parsing). Older txns stored
// as IST midnight render as plain "26 May 2026" via formatDate above.
export function formatDateTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : date.toDate();
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  if (!hasTime) return formatDate(d);
  const datePart = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const timePart = d.toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

export function formatDateInput(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : date.toDate();
  return d.toISOString().split('T')[0];
}

export function getMonthStr(date = new Date()) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function getCurrentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function getStatementStartDate(cutoffDay) {
  const today = new Date();
  const currentDay = today.getDate();
  if (currentDay >= cutoffDay) {
    return new Date(today.getFullYear(), today.getMonth(), cutoffDay);
  } else {
    return new Date(today.getFullYear(), today.getMonth() - 1, cutoffDay);
  }
}

export function getStatementEndDate(cutoffDay) {
  const start = getStatementStartDate(cutoffDay);
  return new Date(start.getFullYear(), start.getMonth() + 1, cutoffDay - 1);
}

export function getBillingCycleLabel(cutoffDay) {
  const start = getStatementStartDate(cutoffDay);
  const end = getStatementEndDate(cutoffDay);
  return `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export const CATEGORIES = [
  'Food & Dining', 'Shopping', 'Travel', 'Entertainment', 'Groceries',
  'Electronics', 'Rent', 'Utilities', 'Health & Medical', 'Insurance',
  'Fuel', 'Education & Classes', 'Fees & Charges', 'Wallet Load', 'Miscellaneous'
];

export const TRANSACTION_TAGS = [
  '', 'SmartBuy', 'iShop', 'VERNOST', 'Grab Deals', 'AEP Ineligible'
];

// Voucher-trade helpers (parent/child schema). Children store haircut in ₹
// (not %), distinguished from legacy flat docs by presence of `parentId`.
export function computeChildHaircutPnl(purchaseAmount, cashReceived) {
  const haircut = (purchaseAmount || 0) - (cashReceived || 0);
  return { haircut, netPnl: -haircut };
}

export function aggregateChildStatus(children) {
  if (!children || children.length === 0) return 'Pending';
  return children.every(c => c.status === 'Traded') ? 'Traded' : 'Pending';
}

export function sumChildHaircut(children) {
  return (children || [])
    .filter(c => c.status === 'Traded')
    .reduce((s, c) => s + (c.haircut || 0), 0);
}
