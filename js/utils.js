export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '₹0';
  return '₹' + Math.abs(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : date.toDate();
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
