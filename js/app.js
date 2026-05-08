import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './config.js';
import { signInWithApple, signOut } from './auth.js';
import { loadDashboard } from './dashboard.js';
import { loadTransactions, openAddTransaction, openEditTransaction, deleteTransaction, saveTransaction, closeTransactionModal, toggleFilterPanel, applyFilters, clearFilters, openConvertToVtModal, addSplitRow, saveVtSplits, unlinkVtFromTxn, openApplyToVtModal, saveVtApply, unlinkVtChildFromCredit } from './transactions.js';
import { loadVoucherTrades, openMarkTradedModal, saveMarkTraded, closeMarkTradedModal, openAddTradeModal, openEditTradeModal, saveTrade, closeAddTradeModal, toggleCompleted, deleteVtParent, openEditSplitsModal, addEditSplitRow, saveEditSplits, openSettleVtModal, saveSettleVt, unsettleVt, onSettleVtCreditChange } from './voucher-trades.js';
import { loadAepLedger, openMarkAepReceivedModal, openAepDetailModal, saveAepReceived, clearAepReceived } from './aep-ledger.js';
import { loadRewards, openAddRewardModal, openEditRewardModal, saveReward, deleteReward, closeRewardModal } from './rewards.js';
import { loadSettings, openAddCardModal, openEditCardModal, saveCard, closeCardModal, openAddAddOnModal, saveAddOnCard, closeAddOnModal, deleteAddOnCard } from './settings.js';

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
window.deleteReward = deleteReward;
window.openAddCardModal  = openAddCardModal;
window.openEditCardModal = openEditCardModal;
window.openAddAddOnModal = openAddAddOnModal;
window.deleteAddOnCard   = deleteAddOnCard;

let activeTab = 'dashboard';

onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.displayName || user.email || '';
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

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${tab}`));

  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'transactions') loadTransactions(true);
  else if (tab === 'voucher-trades') loadVoucherTrades();
  else if (tab === 'aep-ledger') loadAepLedger();
  else if (tab === 'rewards') loadRewards();
  else if (tab === 'settings') loadSettings();
}

// Transactions
document.getElementById('add-txn-btn').addEventListener('click', openAddTransaction);
document.getElementById('filter-btn').addEventListener('click', toggleFilterPanel);
document.getElementById('clear-filter-btn').addEventListener('click', clearFilters);
['filter-date-from', 'filter-date-to', 'filter-card', 'filter-category', 'filter-tag', 'filter-description'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
document.getElementById('load-more-btn').addEventListener('click', () => loadTransactions(false));
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
document.getElementById('add-reward-btn').addEventListener('click', openAddRewardModal);
document.getElementById('save-reward-btn').addEventListener('click', saveReward);
document.getElementById('cancel-reward-btn').addEventListener('click', closeRewardModal);

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
