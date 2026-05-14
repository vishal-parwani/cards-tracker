# CLAUDE.md — cards-tracker (UI repo)

> **For AI assistants.** Read this first; it tells you what this repo is, where the rest of the system lives, and the current status of work in progress. Update the **STATUS** section at the end of every session.

## Identity

This is the **front-end UI** for Vishal's personal credit card spend tracker. A static single-page web app, deployed to GitHub Pages.

- **Stack:** Plain HTML + ES-module JS + CSS. No build step, no bundler, no package manager. Firebase SDK and Chart.js loaded from CDN at runtime as ES modules.
- **Backend:** Firestore (data) + Firebase Auth with Apple Sign-In (auth) + Firebase Cloud Functions (one HTTPS endpoint, see other repo).
- **Live site:** Custom domain via `CNAME` file in this repo.

## What this repo is NOT

The **server-side automations** — daily Gmail/PDF processor, Cloud Function for iOS Shortcut SMS ingestion, Telegram notification PNG generator — all live in a **sibling folder:**

```
~/code/cards/processor/
```

GitHub: `vishal-parwani/cards-processor`. Read its [CLAUDE.md](../processor/CLAUDE.md) for status of that side.

The two repos sit side-by-side under `~/code/cards/`; there is also a master `~/code/cards/CLAUDE.md` that points at both.

## Running locally

```bash
python3 -m http.server 3456
# Open http://localhost:3456
```

`.claude/launch.json` configures this for Claude Code's web runner.

---

## Architecture

### No build step

`index.html` is the entire shell — all modals and tab panels are static HTML; JavaScript progressively fills them. Entry point: `<script type="module" src="js/app.js"></script>`.

All Firebase SDK imports use the CDN ESM format:

```js
import { ... } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
```

**Never switch to npm imports.** There is no bundler.

### Module map (`js/`)

| File | Responsibility |
|---|---|
| `config.js` | Firebase app init; exports `auth` and `db` |
| `app.js` | Auth state listener, tab switching, event listener wiring. Exposes modal openers on `window.*` for HTML `onclick` handlers |
| `auth.js` | Apple Sign-In via Firebase OAuth popup |
| `dashboard.js` | Card balance cards, spend tracker widgets (Magnus AEP, Infinia SmartBuy cap, EPM iShop cap), triggers chart load |
| `transactions.js` | Paginated transaction list (50/page), filters, add/edit/delete modal, points auto-calc, statement period auto-compute |
| `voucher-trades.js` | Voucher trade lifecycle: Pending → Traded; haircut + net P&L |
| `rewards.js` | Rewards ledger (opening / earned / redeemed / lapsed / closing per statement period) |
| `settings.js` | Card config CRUD + add-on card mapping; normalises old flat format to new object format |
| `charts.js` | Chart.js stacked bar (monthly spend by card) + two category donuts (YTD and MTD) |
| `utils.js` | `formatCurrency`, `formatDate`, `getStatementStartDate`, billing-cycle label, `CATEGORIES` and `TRANSACTION_TAGS` arrays |

### Global `window.*` pattern

Modals open from `onclick="..."` attributes in server-rendered HTML rows (not React-style event delegation), so `app.js` attaches functions to `window`:

```js
window.editTransaction = openEditTransaction;
window.deleteTransaction = deleteTransaction;
```

Intentional — don't refactor without also updating every `onclick="window.foo()"` in HTML.

### Firestore schema (shared with cards-processor)

All dates are Firestore `Timestamp` objects. Convert with `.toDate()`.

| Collection / Doc | Shape |
|---|---|
| `config/cards` | `{ [cardName]: { statementDate, billPaymentDate, bank, last4, pdfPassword, forexRate, active, dateHistory[] } }` |
| `config/addOnCards` | `{ [last4]: mainCardName }` — maps add-on card last-4 to primary card name |
| `config/mbAep` | `{ band1Max, band2Max, band1Rate, band2Rate, band3Rate }` — Magnus AEP bands |
| `config/processedLog` | Used by `cards-processor`. Tracks Gmail msg IDs + SMS hashes. Don't touch from UI. |
| `transactions` | `{ date, card, description, category, subcategory, amount, type, pointsEarned, pointsMeta, transactionTag, statementPeriod, reimbursable, notes, month, source, sourceMessageId }` |
| `voucherTrades` | `{ purchaseDate, card, description, purchaseAmount, pointsEarned, status, tradeDate?, cashReceived?, haircut?, netPnl? }` |
| `rewardsTracker` | `{ card, pointsType, statementPeriod, statementDate, openingBalance, pointsEarned, redeemed, lapsed, closingBalance, notes }` |

`source` values now include `'sms'` (written by Cloud Function from iOS Shortcut) and `'sms+email'` (an SMS-sourced doc later enriched by the daily Gmail pass).

### Card config backward-compat

Old records stored statement date as a bare integer (`"Infinia": 5`). `settings.js::normalizeCard()` upgrades these on read. Both formats coexist in Firestore — don't migrate; let the normaliser handle it.

### Points auto-calc

`transactions.js` auto-computes `pointsEarned` when card / amount / category / type change, using `CARD_POINTS_RATES` and `CARD_EXCLUDED_CATS`. User can manually override (tracked by `pointsManuallyEdited` flag, reset on modal open).

### Statement period auto-compute

When user picks a transaction date and card, `computeStatementPeriod()` derives the billing cycle (e.g. `"05/03/2026 - 04/04/2026"`) from the card's `statementDate` cutoff day.

### Hardcoded card names in dashboard

Three tracker widgets are tied to specific card names:
- **Magnus AEP** → `"Magnus Burgundy"`; 3-band points using `config/mbAep`
- **Infinia SmartBuy** → `"Infinia"`; 15,000 accelerated-points cap on `SmartBuy`-tagged spend
- **EPM iShop** → `"ICICI EPM"`; 18,000-points cap on `iShop`-tagged spend

If card names in Firestore change, these widgets silently disappear (`find()` returns nothing). Update `dashboard.js` if a card is renamed.

---

## Cross-machine setup

Vishal works from **two machines** (Mac mini + MacBook Air). Both should have clones at `~/code/cards/tracker/` and `~/code/cards/processor/`. Process for switching machines:

1. `git pull` in **both** repos on the machine you're starting at.
2. Read this file's **STATUS** section to learn what was last shipped.
3. Read `~/code/cards/processor/CLAUDE.md` for the backend side.
4. Per-machine auto-memory at `~/.claude/projects/.../memory/` may exist on one machine and not the other — it's complementary, not authoritative. **This file (in git) is the source of truth.**

### Git auth

The remote URL uses **SSH** (`git@github.com:vishal-parwani/...`). SSH key at `~/.ssh/id_ed25519` is registered with GitHub. No tokens involved. If you ever see a remote URL containing `ghp_...`, strip it immediately (it leaks credentials in shell history).

---

## STATUS

> Update this section at the end of every session. Keep it short.

**Last updated:** 2026-05-14

### Recently shipped
- 2026-05-14: **Rewards tab rebuilt — one row per card + period filter.** The tab read an always-empty `rewardsTracker` collection (nothing auto-populates it) so it never showed anything. Reworked: one row per card, with a period filter (this/last month, this/last year, all time, custom date range). **Earned** auto-sums `transactions.pointsEarned` for the card in range; **Redeemed** sums manually-entered dated redemptions in range; **Closing** = `openingBalance + earned − redeemed` since the opening date, with an optional manual override. `rewardsTracker` is now **one doc per card**: `{ card, pointsType, openingBalance, openingDate, closingOverride, redemptions[]:{date,points,note}, notes }` — the old per-statement-period entry modal is replaced by a per-card setup modal (clicking a row opens it). Collection was empty → no migration. All compute logic + period math unit-verified via `preview_eval`; **live render / modal round-trip NOT verified** (behind Apple Sign-In) — eyeball once signed in. Files: `js/rewards.js` (rewrite), `index.html` (filter bar + modal), `js/app.js` (wiring), `css/style.css`.
- 2026-05-14: **`formatCurrency` preserves sign.** `Math.abs()` was hiding negative amounts, so a net-credit card balance (e.g. Times Black overpaid) rendered as a plain positive — indistinguishable from an outstanding due. Dashboard math already nets credits into the total; only the display was wrong. Only `stmtBalance`/`totalStmt` in `dashboard.js` ever pass negatives; `transactions.js` credit rows pass a positive amount + own `-` prefix, unaffected.
- 2026-05-09: **Header/tab-row UI cleanup.** Removed the redundant `Transactions` h2 section header (the active tab in the nav already labels the page). Filter + `+ Add` buttons moved into a right-aligned `.tab-actions` block inside `.tab-nav`, shown only when the transactions tab is active (toggled in `switchTab`). Settings is no longer a tab — the Settings tab button is gone, and a gear icon (`#settings-gear-btn`) lives in the header next to the user name; clicking it calls `switchTab('settings')`. The settings panel itself (`#tab-settings`) is unchanged. New CSS: `.btn-icon-header`, `.tab-actions`. Sticky-header offset of 100px in `.txn-table thead th` is unchanged (header 52 + tab nav ~48 still holds).
- 2026-05-06: **Voucher-trade flow overhaul** (parent/child schema). One debit can spawn N voucher-trade splits; each split settles either against a credit txn or as cash-only. Implemented in `js/voucher-trades.js`, `js/transactions.js`, `js/utils.js` (helpers `aggregateChildStatus`, `sumChildHaircut`, `computeChildHaircutPnl`). New modals: `edit-splits-modal` (manage parent's splits), `settle-vt-modal` (mark child traded with optional credit-txn link or cash-only), `vt-split-modal` + `vt-apply-modal` (debit→VT and credit→VT pickers from the txn modal). New Firestore fields: `voucherTrades.{isParent, parentId, purchaseTransactionId, settlementTransactionId, status, haircut, netPnl}` (haircut is in ₹ for new docs; legacy docs still use %); `transactions.{voucherTradeParentId, voucherTradeChildIds[]}`. Legacy flat voucherTrades docs render unchanged (no migration). VT chip on txn list rows shows status + haircut. Tab nav now sticky. Convention: when editing helpers, the parent/child render must keep the legacy-only branch working.
- 2026-05-08: **Magnus AEP Ledger** — new `AEP Ledger` tab + `aepLedger` Firestore collection. Past months auto-create rows on tab render once the 3rd of the following month has passed; `calculatedPoints` is recomputed live from current txns each load (so re-tagging an old txn as `AEP Ineligible` flows through automatically — that's the "recompute philosophy"). Each row stores `month`, `monthSort`, `status` (pending/received), `receivedPoints`, `receivedDate`, `notes`. Mark-Received modal saves user-entered actual points + date; if `|received − calculated| > 500 pts` (tolerance), the status badge shows `Discrepancy ±X` instead of `Received`. View-Detail modal breaks down eligible spend, ineligible txn count, and per-band point allocation so you can audit any mismatch. Implemented entirely in `js/aep-ledger.js`; no backend touch (the daily cron doesn't need to know about this — UI is self-healing).
- 2026-05-08: **VT tab alignment + Transactions sticky header + Dashboard VT summary widget.** (a) `.data-table th:nth-child(5)`/`th:last-child` right-align rules were generic and wrongly hit VT's Status (col 5 when no Cash) + Action columns; scoped both to `.txn-table` only. (b) Transactions table thead now sticky at `top: 100px` (page header 52 + tab nav ~48); had to override `.data-table { overflow: hidden }` for `.txn-table` and re-apply rounded corners cell-by-cell since the parent clipping was breaking sticky descendants. (c) New `Voucher Trades · MTD` tracker card on dashboard: net cash this month (headline) + traded gross / haircut (₹ + %) / pending. Pending is all-time, others are scoped by `tradeDate` in current month. Implemented in `loadVtSummary()` / `renderVtSummary()`; CSS `.vt-summary-grid` reuses the tracker-card chrome.
- 2026-05-08: EPM 10k/day **accel** cap (iShop only) — `dashboard.js` buckets iShop accel pts by date, caps each day's contribution to the monthly total at 10k, and surfaces a red `.tracker-warning` listing the (chronologically) first two cap-hit days with their raw uncapped totals. Limited to two because 2×10k already exceeds the 18k monthly cap. New CSS rule `.tracker-warning` in `css/style.css`.
- 2026-05-06: Fixed Infinia SmartBuy + EPM iShop tracker widgets in `dashboard.js`. Accel-points formula was using multiplier units (`*4`, `*36`) instead of actual accel rate; corrected to `*20` for Infinia (4× of 5pts/₹150) and `*30` for EPM (5× of 6pts/₹200). Also corrected the "remaining spend to cap" denominators. Period stays MTD (calendar month) — caps reset monthly. Visual verification pending — needs signed-in session.
- 2026-04-30: Notification PNG (Pillow) handoff merged into `cards-processor/notification.py` and wired into the daily run. Sent via Telegram `sendPhoto`.
- 2026-04-29: Forex markup rate field on card settings; charts on dashboard; AEP eligible spend fix.
- 2026-04-26: Active toggle, no-wrap rows, description popover, points auto-calc fixes; PDF password field on card settings.

### In progress / pending in this repo
- **Rewards tab — live verification pending.** Compute logic + period math were unit-verified, but the rendered table, the per-card setup modal save/delete round-trip, and filter re-rendering were not exercised (Apple Sign-In blocks the preview tools). Sign in and confirm. Also: each card needs its `openingBalance`/`openingDate` set once before Closing can compute (until then Redeemed/Closing show `—`).

### Open ideas / not started
- _(none recorded — surface here as they come up)_

---

## Conventions

- No emoji in code or commit messages unless Vishal asks.
- Commit messages: short subject (~70 chars), no body unless the change is non-trivial. Existing repo style: imperative mood (`Add`, `Fix`, `Update`).
- No `Co-Authored-By` trailer — Vishal doesn't use it.
- Don't create new files unless necessary; prefer editing existing modules.
- Don't add comments explaining what code does; only add a comment if there's a non-obvious reason a particular line exists.
