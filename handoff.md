# Handoff — voucher-trade flow + processor SMS tag mapping

> Pick this up on the Mac mini. Branch: `claude/debug-sms-parsing-KR4Ht` (tracker repo). Nothing committed yet.

## Context

Two issues surfaced in the last session:

1. **SmartBuy / iShop trackers not updating for SMS-ingested txns.** Today's HDFC Gyftr ₹70k (Infinia) and an ICICI EPM Reward360 txn didn't move the dashboard widgets. Root cause: `dashboard.js:127` and `dashboard.js:135` filter strictly on `transactionTag === 'SmartBuy'` / `=== 'iShop'`. The Cloud Function in `cards-processor` writes SMS txns with no `transactionTag`, so they're invisible to the trackers. **Vishal manually re-tagged today's txns** so the dashboard is now correct. Long-term fix is a merchant→tag mapping in `cards-processor` — see "Processor todo" below.

2. **Voucher-trade workflow needs an overhaul.** Today: voucher trades live in their own collection, disconnected from `transactions`. Vishal wants to start from an existing debit txn, optionally split it into multiple vouchers, and settle each one against a future credit txn (or manually with cash).

## Decisions locked in (all answered by Vishal)

- One debit can produce **N voucher trades** (split allowed).
- Existing `SmartBuy` / `iShop` tag on the debit is **retained** — voucher-trade-ness is orthogonal, doesn't affect cap trackers.
- Haircut display on the source debit txn = **option (a) — display only, computed live from linked children, no data duplication**.
- Credit → VT picker scope: **across all cards** (Vishal sometimes gets cash back on a different card / payment instrument).
- Credit txn is **just a trigger**; Vishal enters `cashReceived` per child manually in the picker.
- Sub-rows show **haircut and net P&L** in the Voucher Trades tab.
- **Edit capability** required on parent + child rows.
- **No over-allocation check** (sum of children may exceed parent purchaseAmount — don't validate).
- Larger-credit-than-VT case: not allowed for a single VT (haircut is always positive). The "credit larger than one VT" case is handled by letting one credit settle multiple VTs.
- **Legacy flat `voucherTrades` docs** stay as-is, render at top level. No migration.

## Schema plan

### `voucherTrades` (extended)

**Parent** (created when converting a debit txn):
```
{
  isParent: true,
  purchaseDate,             // = source txn.date
  card,                     // = source txn.card
  description,              // = source txn.description
  purchaseAmount,           // = source txn.amount
  pointsEarned,             // = source txn.pointsEarned
  purchaseTransactionId,    // FK → transactions/{id}
}
```
No status / cash / haircut on the parent — derived from children.

**Child** (1+ per parent, also lives in `voucherTrades` collection):
```
{
  parentId,                 // FK → parent doc
  purchaseDate,             // mirrors parent
  card,                     // mirrors parent
  description,              // user-entered (e.g. "Amazon ₹40k")
  purchaseAmount,           // user-entered
  status,                   // 'Pending' | 'Traded'
  tradeDate?,
  cashReceived?,
  haircut?,                 // = purchaseAmount - cashReceived
  netPnl?,                  // = -haircut (always ≤ 0 on a single VT)
  settlementTransactionId?, // FK → transactions/{creditTxnId}
}
```

Render rule for the VT tab: docs without `isParent` and without `parentId` are **legacy flat** and render at top level untouched.

### `transactions` (additions)

- `voucherTradeParentId` — set on debit txns when converted. FK → parent VT doc.
- `voucherTradeChildIds: []` — set on credit txns when applied to one or more VT children. FK array.

## UI plan

### Transactions tab — edit modal gets a "Voucher Trade" section

**Debit, unlinked:**
- Button: "Convert to Voucher Trade".
- Click → sub-modal with N rows of `description + amount`. Defaults to 1 row pre-filled with the txn's description and amount. Add/remove rows.
- Save: creates 1 parent + N children, sets `voucherTradeParentId` on the txn.

**Debit, linked:**
- Show linked parent summary + per-child summary (status, haircut, net P&L computed live).
- "Unlink" button: cascade-delete parent + children, clear `voucherTradeParentId`.

**Credit, unlinked:**
- Button: "Apply to Voucher Trade".
- Picker shows all `Pending` children **across all cards**, sorted by `purchaseDate desc`.
- Vishal checks 1+ children. For each checked child, an input for `cashReceived`.
- Save: for each, set `status='Traded'`, `tradeDate=creditTxn.date`, `cashReceived=entered`, `haircut=purchaseAmount-cashReceived`, `netPnl=-haircut`, `settlementTransactionId=creditTxn.id`. Credit's `voucherTradeChildIds` gets the array.

**Credit, linked:**
- Show linked child summaries.
- "Unlink" per child or bulk: revert child to `Pending`, clear `tradeDate / cashReceived / haircut / netPnl / settlementTransactionId`. Remove from credit's `voucherTradeChildIds`.

**Row chip:** small "VT" badge on linked txn rows in the Transactions list.

**Inline haircut on linked debit row:** read children, sum `haircut` across `Traded` children, render small chip (e.g. `Haircut ₹X`) or `VT pending` if any unsettled.

### Voucher Trades tab

- Legacy flat docs render at top level (unchanged).
- New parents render as a top-level row: description, total `purchaseAmount`, `pointsEarned`, aggregate status (`Pending` if any child pending else `Traded`).
- Children render indented under each parent: description, amount, status, tradeDate, cashReceived, **haircut, net P&L**. Edit + delete buttons per child.
- Edit child modal: `description / amount / status / tradeDate / cashReceived` (haircut + netPnl recomputed on save).
- Edit parent modal: `description / pointsEarned` only.

### Trackers

No change. SmartBuy/iShop continue to filter on `transactionTag` — orthogonal to VT linkage.

## Files to touch

- `js/transactions.js` — VT section in edit modal; convert/apply/unlink flows; VT chip; inline haircut on linked debit rows.
- `js/voucher-trades.js` — render parents with indented children; edit modals.
- `js/utils.js` — minor helpers if needed (`aggregateChildStatus`, `sumHaircut`).
- No changes to `dashboard.js`, `charts.js`, `settings.js`, `rewards.js`.
- Update STATUS section in `CLAUDE.md` after shipping.

## Out of scope for this change

- Migration of legacy flat voucher-trade docs.
- Over-allocation validation.
- The `cards-processor` SMS merchant→tag mapping (separate repo, see below).

## Processor todo (sibling repo `cards-processor`)

The Cloud Function that ingests iOS-Shortcut SMS writes txns with no `transactionTag`. Add a merchant→tag mapping so SmartBuy/iShop trackers stay correct without manual tagging:

- `GYFTR` (and any `SMARTBUY` / `HDFCSMARTBUY` variants) → `transactionTag: 'SmartBuy'` (only on Infinia card).
- `REWARD360` / `REWARDSARENA` / `ISHOP` → `transactionTag: 'iShop'` (only on ICICI EPM card).
- Any other accelerator merchant strings Vishal recalls — add when noticed.

Apply the tag only when the card matches the expected card name, to avoid false positives.

This repo isn't on the current machine. Do this on the Mac mini in a separate session.

## Resume checklist

1. `cd ~/code/cards/tracker && git checkout claude/debug-sms-parsing-KR4Ht && git pull`.
2. Read this file + `CLAUDE.md`.
3. Implement per the plan above. No further design questions outstanding — sign-off was the last gate.
4. Test locally with `python3 -m http.server 3456`.
5. Commit + push to `claude/debug-sms-parsing-KR4Ht`.
6. Update `CLAUDE.md` STATUS section.
7. Then switch to `~/code/cards/processor/` and do the SMS tag mapping in a separate commit/session.
