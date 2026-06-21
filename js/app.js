import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './config.js';
import { signInWithApple, signOut } from './auth.js';
import { loadDashboard } from './dashboard.js';
import { loadTransactions, openAddTransaction, openEditTransaction, deleteTransaction, saveTransaction, closeTransactionModal, openConvertToVtModal, addSplitRow, saveVtSplits, unlinkVtFromTxn, openApplyToVtModal, saveVtApply, unlinkVtChildFromCredit, exportTransactionsXlsx, runVtCategoryMigration } from './transactions.js';
import { loadVoucherTrades, openMarkTradedModal, saveMarkTraded, closeMarkTradedModal, openAddTradeModal, openEditTradeModal, saveTrade, closeAddTradeModal, toggleCompleted, deleteVtParent, openEditSplitsModal, addEditSplitRow, saveEditSplits, openSettleVtModal, saveSettleVt, unsettleVt, onSettleVtCreditChange } from './voucher-trades.js';
import { loadAepLedger, openMarkAepReceivedModal, openAepDetailModal, saveAepReceived, clearAepReceived } from './aep-ledger.js';
import { loadRewards, setRewardsPreset, setRewardsCustom, openEditRewardModal, saveReward, deleteReward, closeRewardModal, addRedemptionRow } from './rewards.js';
import { loadSettings, openAddCardModal, openEditCardModal, saveCard, closeCardModal, openAddAddOnModal, openEditAddOnModal, saveAddOnCard, closeAddOnModal, deleteAddOnCard, toggleArchiveCard, deleteCard, restoreCard } from './settings.js';
import { initDatePickers } from './utils.js';

// Expose handlers to HTML onclick attributes
window.editTransaction = openEditTransaction;
window.deleteTransaction = deleteTransaction;
window.openMarkTradedModal = openMarkTradedModal;
window.openEditTradeModal = openEditTradeModal;
window.openEditSplitsModal = openEditSplitsModal;
window.openSettleVtModal = openSettleVtModal;
window.deleteVtParent = deleteVtParent;
window.openConvertToVtModal = openConvertToVtModal;
window.unlinkVtFromTxn = unlinkVtFromTxn;
window.openApplyToVtModal = openApplyToVtModal;
window.unlinkVtChildFromCredit = unlinkVtChildFromCredit;
window.openMarkAepReceivedModal = openMarkAepReceivedModal;
window.openAepDetailModal = openAepDetailModal;
window.openEditRewardModal = openEditRewardModal;
window.openAddCardModal  = openAddCardModal;
window.openEditCardModal = openEditCardModal;
window.openAddAddOnModal  = openAddAddOnModal;
window.openEditAddOnModal = openEditAddOnModal;
window.deleteAddOnCard    = deleteAddOnCard;
window.toggleArchiveCard  = toggleArchiveCard;
window.deleteCard         = deleteCard;
window.restoreCard        = restoreCard;

let activeTab = 'dashboard';

onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.displayName || user.email || '';
    await runVtCategoryMigration().catch(e => console.warn('VT category backfill failed:', e));
    switchTab('dashboard');
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
});

document.getElementById('apple-signin-btn').addEventListener('click', async () => {
  try {
    await signInWithApple();
  } catch (e) {
    alert('Sign in failed: ' + e.message);
  }
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await signOut();
});

document.getElementById('settings-gear-btn').addEventListener('click', () => switchTab('settings'));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  document.getElementById('tab-actions-transactions').classList.toggle('hidden', tab !== 'transactions');

  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'transactions') loadTransactions(true);
  else if (tab === 'voucher-trades') loadVoucherTrades();
  else if (tab === 'aep-ledger') loadAepLedger();
  else if (tab === 'rewards') loadRewards();
  else if (tab === 'settings') loadSettings();
}

// Transactions
document.getElementById('add-txn-btn').addEventListener('click', openAddTransaction);
document.getElementById('load-more-btn').addEventListener('click', () => loadTransactions(false));
document.getElementById('export-xlsx-btn').addEventListener('click', exportTransactionsXlsx);
document.getElementById('save-txn-btn').addEventListener('click', saveTransaction);
document.getElementById('cancel-txn-btn').addEventListener('click', closeTransactionModal);

// Voucher trades
document.getElementById('add-trade-btn').addEventListener('click', openAddTradeModal);
document.getElementById('toggle-completed-btn').addEventListener('click', toggleCompleted);
document.getElementById('save-trade-btn').addEventListener('click', saveTrade);
document.getElementById('cancel-trade-btn').addEventListener('click', closeAddTradeModal);
document.getElementById('save-mark-traded-btn').addEventListener('click', saveMarkTraded);
document.getElementById('cancel-mark-traded-btn').addEventListener('click', closeMarkTradedModal);
document.getElementById('save-edit-splits-btn').addEventListener('click', saveEditSplits);
document.getElementById('edit-splits-add-row-btn').addEventListener('click', addEditSplitRow);
document.getElementById('save-settle-vt-btn').addEventListener('click', saveSettleVt);
document.getElementById('unsettle-vt-btn').addEventListener('click', unsettleVt);
document.getElementById('settle-vt-credit-link').addEventListener('change', onSettleVtCreditChange);
document.getElementById('vt-split-add-row-btn').addEventListener('click', addSplitRow);
document.getElementById('save-vt-split-btn').addEventListener('click', saveVtSplits);
document.getElementById('save-vt-apply-btn').addEventListener('click', saveVtApply);

// AEP Ledger
document.getElementById('save-aep-received-btn').addEventListener('click', saveAepReceived);
document.getElementById('clear-aep-received-btn').addEventListener('click', clearAepReceived);

// Rewards
document.querySelectorAll('.rwd-preset').forEach(btn => {
  btn.addEventListener('click', () => setRewardsPreset(btn.dataset.preset));
});
document.getElementById('rewards-from').addEventListener('change', setRewardsCustom);
document.getElementById('rewards-to').addEventListener('change', setRewardsCustom);
document.getElementById('save-reward-btn').addEventListener('click', saveReward);
document.getElementById('cancel-reward-btn').addEventListener('click', closeRewardModal);
document.getElementById('cancel-reward-btn-2').addEventListener('click', closeRewardModal);
document.getElementById('delete-reward-btn').addEventListener('click', deleteReward);
document.getElementById('reward-add-redemption-btn').addEventListener('click', addRedemptionRow);
document.getElementById('reward-redemptions').addEventListener('click', e => {
  if (e.target.classList.contains('rwd-red-remove')) e.target.closest('.rwd-redemption-row').remove();
});

// Settings
document.getElementById('save-card-btn').addEventListener('click', saveCard);
document.getElementById('cancel-card-btn').addEventListener('click', closeCardModal);
document.getElementById('save-addon-btn').addEventListener('click', saveAddOnCard);
document.getElementById('cancel-addon-btn').addEventListener('click', closeAddOnModal);

// Close modals on backdrop click or Escape key
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) el.classList.add('hidden');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(el => el.classList.add('hidden'));
  }
});

// Themed date pickers for every static date input (modals included — their
// inputs exist in the DOM from page load even while the modal is hidden).
initDatePickers();

// PWA: register the app-shell service worker.
// app.js only runs after its CDN module imports resolve, so the window
// 'load' event may already have fired by now — register directly if so.
if ('serviceWorker' in navigator) {
  const registerSW = () =>
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW registration failed:', err));
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
}
