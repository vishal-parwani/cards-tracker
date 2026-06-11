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

## Deploy

The live site (`cards.vishalparwani.com`) is served by **GitHub Pages from `main`** — a push to `main` triggers the "pages build and deployment" run automatically; there is no deploy workflow to run. **Convention (2026-06-04): merge the feature branch to `main` before deploying — i.e. deploy = merge to `main`, never deploy from a feature branch.** Bump `CACHE_VERSION` in `sw.js` whenever a precached shell file changes so the service worker purges the old cache on next launch. (A stale `deploy.yml` "Deploy to Firebase Hosting" workflow was **deleted** 2026-06-04 — it failed on every push because no `FIREBASE_SERVICE_ACCOUNT` secret was set in this repo, and Pages, not Firebase Hosting, is the real host.)

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
| `config/cards` | `{ [cardName]: { statementDate, billPaymentDate, bank, last4, pdfPassword, forexRate, active, showOnDashboard, showWhenZero, showInTrackers, autoAdjustCredits, dashboardWidget, dateHistory[] } }` |
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

**Last updated:** 2026-06-11

### Recently shipped
- 2026-06-11: **Dashboard tile ordering fixed + zero-balance hiding + per-card spend-tracker toggle.** Three things. (a) **Card balance tiles now sort by `totalOutstanding` descending** (was `mtdSpend` desc), with an `a.name.localeCompare(b.name)` tiebreaker so the order is stable across reloads (`dashboard.js` ~line 32) — same JS sort feeds desktop and mobile, so mobile gets the same fixed order (single column = top-to-bottom). (b) **Zero-outstanding cards are hidden by default.** New per-card `showWhenZero` flag (default false). Dashboard filter changed from `r.showOnDashboard || r.totalOutstanding !== 0` to `r.showOnDashboard && (r.totalOutstanding !== 0 || r.showWhenZero)` (`dashboard.js` ~line 41) — note this also makes `showOnDashboard:false` a hard hide (a hidden card with a nonzero balance no longer force-shows, matching the toggle's literal meaning). New toggle `#card-show-when-zero-input` in the card modal, rendered as an indented sub-row (`.form-row-sub`) under "Show on Dashboard". (c) **New per-card `showInTrackers` flag** (default true) gating whether the card's spend-tracker widget renders on the dashboard. New toggle `#card-show-in-trackers-input`; **greyed out (and forced off) when the card's Dashboard Spend Tracker is "None"** — i.e. no accelerated reward system — via `syncTrackerToggleState()` in `settings.js`, wired to the widget `<select>`'s `onchange` and called on modal open. The four tracker `find()`s in `dashboard.js` now also require `r.showInTrackers !== false`. Both new fields added to `normalizeCard` (settings.js), the dashboard `cards` projection, the modal populate/save paths, and `updatedCard`. New CSS: `.form-row-sub`, `.form-row.row-disabled`. `CACHE_VERSION` v8→v9. **NOT verified live** (Apple Sign-In blocks the preview; the preview harness was also unreachable from the Bash sandbox this session) — both edited JS modules pass `node --check`. Eyeball once signed in: tile order is highest-outstanding first and stable; a paid-off (₹0) card disappears unless its new sub-toggle is on; the "Show in Spend Trackers" toggle greys out when you set Dashboard Spend Tracker to None, and turning it off hides that card's tracker widget.
- 2026-06-07: **Dashboard balance rework + per-card credit auto-adjust + transaction Source/VT filters** (commit `e10b39a`). Three things in one changeset. (a) **Dashboard balance tiles** now lead with **Total Outstanding** (all-time net debits−credits, the true carry-forward balance) and **Next Statement** (current billing cycle). Credit handling is **prior-balance-aware**: a current-cycle credit pays down the prior statement's outstanding FIRST (`appliedToPrior = min(cycleCredits, max(priorNet,0))` where `priorNet = totalOutstanding − (cycleDebits − cycleCredits)`), and only the leftover lowers Next Statement — so a credit on an already-paid-off card correctly reduces the upcoming bill instead of vanishing. **Cycle Spend** row is hidden when it equals Next Statement (i.e. whenever auto-adjust fully absorbs the credit), and Next Statement now shares Total Outstanding's `accent` styling. (b) **Auto-adjust is a per-card toggle**, stored at `config/cards[name].autoAdjustCredits` (default ON; `normalizeCard` defaults legacy/object both to true). The switch lives in the **Settings → card edit modal** (`#card-auto-adjust-input`, saved via the normal Save), NOT a global preference and NOT on the dashboard tile — an earlier build had a global `config/preferences.autoAdjustCredits` toggle; that was fully removed (settings.js Preferences section, `toggleAutoAdjustCredits`, the app.js window-wiring, and the dashboard's global read). `dashboard.js::loadCardData` reads `card.autoAdjustCredits` per card. (c) **Transactions:** PDF-sourced rows show a small blue `PDF` pill (`.src-chip-pdf`); new "More filters" popover (funnel button in the tab-actions bar) filters by Source (Manual / SMS / Email — separate / PDF) and Voucher Trade (all / VT-only / non-VT), applied client-side in `loadFilteredTransactions`. `CACHE_VERSION` v7→v8. **NOT verified live** (Apple Sign-In blocks preview) — dashboard math was verified numerically against real Firestore data via the processor's `serviceAccount.json`; eyeball once signed in: the per-card toggle in the card edit modal, the hidden Cycle Spend row, and the More-filters popover. **Firestore access note:** local Python tooling now authenticates via `~/code/cards/processor/serviceAccount.json` (a non-expiring service-account key, gitignored) — use that, NOT `firebase login` (its token expires and is the recurring access pain). For the iPad/cloud sandbox the same key should be supplied as a `FIREBASE_SERVICE_ACCOUNT` env secret.
- 2026-06-04: **Edit-modal category + tag dropdowns made dynamic (fixes TWP tag vanishing).** The edit/add modal's `#txn-category` and `#txn-tag` `<select>`s in `index.html` were **static hardcoded `<option>` lists** — and out of sync with reality: the tag list had no `TWP`, and the category list used stale strings (`Utilities`, `Travel`, `Shopping`, `Groceries`, `Electronics`) that don't match the backend's `Utilities & Telecom` / `Travel - Air` / `Shopping - Online` / `Grocery`. So opening a TWP (or any backend-categorised) txn set `.value` to a non-existent option → it blanked → saved as `''`, silently dropping the tag/category. (Root of the confusion: `transactions.js::getTransactionFormHTML()` builds a *dynamic* version from `CATEGORIES`/`TRANSACTION_TAGS` but is **dead code — never called**; the live modal is the static one in `index.html`.) Fix: `showTransactionModal()` now populates both selects from `CATEGORIES`/`TRANSACTION_TAGS`, always appending the txn's own stored value if absent (same safeguard as the card dropdown), so nothing can be blanked on edit. `CATEGORIES` (utils.js) re-synced to the processor's `_CATEGORY_RULES` outputs (25 cats + Wallet Load + Miscellaneous). Static `<option>`s stripped from `index.html` (JS repopulates on open). `CACHE_VERSION` v6→v7. **NOT verified live** (Apple Sign-In blocks preview) — eyeball: edit a TWP txn, confirm tag persists and category shows the full new list.
- 2026-06-04: **HSBC Premier points mirrored into UI auto-calc.** Backend added HSBC Premier rewards (cards-processor, same date); this mirrors it so manual txn entry/edit computes correctly instead of showing 0. `points-config.js`: `CARD_POINTS_RATES['HSBC Premier'] = {rate:3, per:100}`; `CARD_EXCLUDED_CATS['HSBC Premier'] = {Fuel, Fees & Charges}` (→0); new `hsbcTwpRate(descUpper)` mirrors backend `_hsbc_twp_rate` (word-bounded `\bTWP\b` then HOTEL 36 / FLIGHT 18 / CAR 6 per ₹100); `deriveTag` returns `'TWP'` for HSBC TWP descriptions; `computePointsForTag` gained a `description` param (6th arg) and an HSBC branch (TWP → accel rate, else base 3/100). `transactions.js::autoComputePoints` now reads `txn-description` and passes it through (fires on description input, so the TWP rate updates live as you type). `'TWP'` added to `TRANSACTION_TAGS` (utils.js) so it shows in the tag dropdown. Also exported `HSBC_CAPPED_CATS` + `HSBC_CAPPED_SPEND_LIMIT` (the ₹1L/mo capped categories) for reference — but like SmartBuy/iShop, the UI guide is **un-capped**: capped cats show base 3/100, and the backend enforces the ₹1L spend cap (backend value canonical, as with Magnus AEP bands). `CACHE_VERSION` bumped v5→v6 (shell JS changed). Unit-tested compute mirror against backend values (flight 10347→1854, hotel/car, fuel/fees→0, base). **NOT verified live** (Apple Sign-In blocks preview) — eyeball once signed in: add an HSBC txn, type a `TWP FLIGHT` description, confirm points + tag.
- 2026-05-27: **Magnus Burgundy points no longer clobbered on edit + dashboard "Cycle Spend" row.** Two related fixes. (a) The UI's `computePointsForTag` for Magnus Burgundy returns the base 12/200 rate; the backend (`firestore_utils.py::compute_points`) prorates across AEP bands (Band 2 = 35/200) and stamps that band-prorated value on `pointsEarned`. On edit, `autoComputePoints` was clobbering the stored Band-2 value with the UI's base-rate value as soon as the user touched any auto-bound field (category/amount/type/tag) — even when the amount didn't change. Now `autoComputePoints` recognises Magnus Burgundy edits and either zeros (if new category ∈ `AEP_EXCLUDED_CATS` — covers `Shopping - Jewellery`, `Utilities & Telecom`, etc.), preserves the original `pointsEarned` (if amount unchanged), or scales by the original effective rate (if amount changed — keeps a Band-2 txn at ~17.5% rate). `editingOriginal` now captures `card/amount/type/category/pointsEarned`. Also dropped the `Magnus Burgundy` entry from `CARD_EXCLUDED_CATS` and pointed the Magnus branch of `computePointsForTag` directly at `AEP_EXCLUDED_CATS` — old UI list had `Rent`/`EMI` (which earn pts on backend, capped/regular) and was missing `Utilities & Telecom`/`Shopping - Jewellery` (which backend zeros). New-txn auto-calc is still a base-rate "guide" — comment in `points-config.js` flags that the backend value is canonical. (b) Dashboard balance cards now show three lines: `Next Statement` (debit − credit), `Cycle Spend` (debit only in current cycle), `MTD Spend` (debit only in calendar month). The MTD↔Next Statement gap was confusing because Next Statement subtracts credits — chiefly the SMS-parsed `PAYMENT RECEIVED` for last cycle's bill, plus refunds. The new Cycle Spend line makes the missing piece visible (and matches MTD for cards whose cycle aligns with the calendar month). Statement query now upper-bounds at `stmtEnd` (last day of cycle, 23:59:59) so next-cycle / future-dated txns don't leak into the count. Files: `js/points-config.js`, `js/transactions.js`, `js/dashboard.js`. `CACHE_VERSION` bumped v3→v4. Backend unchanged — was already correct.
- 2026-05-14: **PWA — iOS launch screens.** iOS doesn't build a splash from the manifest (that's Android-only) — it needs explicit `apple-touch-startup-image` link tags with a device-exact PNG per resolution. Added 8 `splash-{WxH}.png` (repo root) covering iPhone SE 2/3 through 16 Pro Max, portrait only (manifest is portrait-locked): cream `#f5ede4` canvas (= manifest `background_color`) with the rounded green app icon centered at 34% width. 8 `<link rel="apple-touch-startup-image">` tags added to `index.html` `<head>` with `device-width`/`device-height`/`-webkit-device-pixel-ratio` media queries. Generated by `/tmp/gen_splash.py` (not committed). `CACHE_VERSION` bumped `cards-v1` → `cards-v2` because `index.html` (a precached shell file) changed — splash PNGs themselves are deliberately NOT in the SW precache (OS chrome, not app shell). Note: the home-screen *icon* not appearing earlier was just iOS caching a pre-deploy install — delete + re-add the home-screen icon fixes it (no code change). Verified: all 8 splash PNGs serve 200, tags well-formed. NOT verified: media-query device matching (needs a real iPhone).
- 2026-05-14: **PWA — service worker for app-shell caching.** Added `sw.js` (root, scope `/`), registered from the end of `js/app.js`. Strategy: **network-first for same-origin GETs, cache only as the offline fallback** — while online you always get fresh files, so no staleness footgun; offline you get the cached shell. Cross-origin (Firebase, Firestore, Chart.js CDN) is never intercepted, so data is always live. `install` precaches the 19-file shell (`index.html`, `/`, css, all 11 js modules, manifest, 4 icons) + `skipWaiting()`; `activate` deletes every cache whose name != `CACHE_VERSION` + `clients.claim()`. **Deploy convention: bump `CACHE_VERSION` in `sw.js` (`cards-v1` → `cards-v2` …) whenever a shell file changes** — that purges the old cache on next launch. Registration in `app.js` checks `document.readyState` (app.js runs after its CDN imports resolve, so `window`'s `load` event may already have fired — register directly if so, else on `load`). Verified in preview: sw.js installs → `activated`, precaches all 19 files, and a version bump purges old caches (tested v1→v2→reverted to v1). **NOT verified in preview:** app.js's own registration call — the preview sandbox can't load the Firebase CDN modules so app.js never executes there (same limitation as Apple Sign-In blocking the signed-in app); the registration code is straightforward and will run in a real browser. Eyeball once on a real iPhone.
- 2026-05-14: **PWA — installable to home screen.** Decided against a native iOS app; making the web app a PWA instead. Added `manifest.json` (name "Card Spend Tracker" / short "Card Tracker", `display: standalone`, `theme_color #5c3d2e`, `background_color #f5ede4`, `start_url`/`scope` `/`) and PWA `<head>` tags in `index.html` (`<link rel="manifest">`, `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: default`, `apple-mobile-web-app-title`, `apple-touch-icon`). Icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (maskable = card shrunk into 80% safe zone), `icon-180.png` (apple-touch-icon) — all in repo root. Icon design = flat credit-card glyph in the **Telegram-notification palette** (`processor/notification.py`): accent-green bg `#627C5A`, sage card `#E0E8DC`, ink stripe `#303A2E`, rust chip + number-lines `#AA5C40`. Generated by a one-off PIL script (not committed, lived in `/tmp/gen_icons.py`) — to regenerate, redraw a rounded-rect card on a green square, 1024px master downscaled to 512/192/180. Verified via preview: manifest + all icons return 200, no console errors. **NOT verified:** the actual installed/standalone experience on a real iPhone (needs a device + sign-in) — install via Safari Share → Add to Home Screen and check the splash + status bar. No service worker yet (so no offline shell caching — that's a possible follow-up).
- 2026-05-14: **Mobile UI — data tables collapse to cards.** Replaced the 14-line `@media (max-width: 600px)` block in `css/style.css` with a full mobile pass (targets ~390px iPhone). Under 600px the four `.data-table`s stop being scrollable tables and become stacked cards: `thead` is hidden, each `<tr>` is a card, each `<td>` is a label/value row driven by a `data-label` attribute (`::before { content: attr(data-label) }`). Transactions uses a **bespoke 4-row CSS grid** on the `<tr>` (`grid-template-areas` — date+amount / desc / card+cat+actions / pts+tag) instead of the generic stack — it's the highest-traffic table and the generic 8-row stack was too tall; the grid card works off `nth-child`, no JS change. The other three tables (`vt-table`, `aep-table`, `rewards-table`) needed `data-label="..."` added to every rendered `<td>` — done in `js/voucher-trades.js` (all 4 row variants: legacy / single-split / multi parent / child), `js/aep-ledger.js`, `js/rewards.js`. Dashboard/settings: `.cards-grid` and `.charts-grid-donuts` go single-column on mobile (balance cards + settings tiles were cramped at 2-col; donuts were squished). Mobile CSS quirk-handlers: `td:empty { display:none }` (VT child rows have an empty Card cell), VT parent/child `border-top` reset, `.vt-child-desc` padding reset, rewards first cell renders as a card header not a label/value row. Verified at 390px via a temporary `mobile-mockup.html` (deleted) that linked the real `style.css` — **live signed-in render NOT verified** (Apple Sign-In blocks preview tools); eyeball once signed in on a phone, especially the VT multi-split parent/child cards and the rewards row-tap-to-edit.
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
- **PWA install — live verification pending.** Manifest + icons + service worker + 8 iOS splash images all verified to load/install in preview, but the installed standalone experience (splash screen picking the right image, status bar, home-screen icon, offline launch) hasn't been checked on a real iPhone. Re-add the home-screen icon after deploy (iOS cached a pre-deploy blank). Also app.js's SW-registration call couldn't run in preview (Firebase CDN blocked in sandbox) — confirm the SW actually registers in a real browser via DevTools/Application.
- **Mobile data-table cards — live verification pending.** Verified at 390px against the real `style.css` via a scratch mockup, but not on the actual signed-in app. Sign in on a phone and check: VT multi-split parent/child cards, rewards tap-to-edit, action-button tap targets.
- **Rewards tab — live verification pending.** Compute logic + period math were unit-verified, but the rendered table, the per-card setup modal save/delete round-trip, and filter re-rendering were not exercised (Apple Sign-In blocks the preview tools). Sign in and confirm. Also: each card needs its `openingBalance`/`openingDate` set once before Closing can compute (until then Redeemed/Closing show `—`).

### Open ideas / not started
- _(none recorded — surface here as they come up)_

---

## Conventions

- **Always show a visual preview before finalizing/committing any UI change.** Live preview of the real app is blocked by Apple Sign-In, so build a standalone scratch mockup HTML that links the real `css/style.css` and hardcodes sample data + the new markup (prior art: `mobile-mockup.html`), then `open` it for review. Iterate on the preview until approved, then wire into the real files and delete the mockup.
- No emoji in code or commit messages unless Vishal asks.
- Commit messages: short subject (~70 chars), no body unless the change is non-trivial. Existing repo style: imperative mood (`Add`, `Fix`, `Update`).
- No `Co-Authored-By` trailer — Vishal doesn't use it.
- Don't create new files unless necessary; prefer editing existing modules.
- Don't add comments explaining what code does; only add a comment if there's a non-obvious reason a particular line exists.
