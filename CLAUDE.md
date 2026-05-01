# CLAUDE.md — cards-tracker (UI repo)

> **For AI assistants.** Read this first; it tells you what this repo is, where the rest of the system lives, and the current status of work in progress. Update the **STATUS** section at the end of every session.

## Identity

This is the **front-end UI** for Vishal's personal credit card spend tracker. A static single-page web app, deployed to GitHub Pages.

- **Stack:** Plain HTML + ES-module JS + CSS. No build step, no bundler, no package manager. Firebase SDK and Chart.js loaded from CDN at runtime as ES modules.
- **Backend:** Firestore (data) + Firebase Auth with Apple Sign-In (auth) + Firebase Cloud Functions (one HTTPS endpoint, see other repo).
- **Live site:** Custom domain via `CNAME` file in this repo.

## What this repo is NOT

The **server-side automations** — daily Gmail/PDF processor, Cloud Function for iOS Shortcut SMS ingestion, Telegram notification PNG generator — all live in a **separate repo at:**

```
/Users/vishal/Documents/Personal/AI Oversight/Automations/PythonAnywhere/cards-processor/
```

GitHub: `vishal-parwani/cards-processor`. Read its [CLAUDE.md](../Automations/PythonAnywhere/cards-processor/CLAUDE.md) for status of that side.

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

Vishal works from **two machines** (Mac mini + MacBook Air). Both have a clone of this repo at the same path. Process for switching machines:

1. `git pull` on the machine you're starting at.
2. Read this file's **STATUS** section to learn what was last shipped.
3. Read `cards-processor/CLAUDE.md` for the backend side.
4. Per-machine auto-memory at `~/.claude/projects/.../memory/` may exist on one machine and not the other — it's complementary, not authoritative. **This file (in git) is the source of truth.**

### Git auth

The `cards-tracker` remote URL uses plain HTTPS — auth is handled by macOS Keychain or GitHub Desktop. There is **no embedded token** in the remote URL. If you ever see a remote URL containing `ghp_...`, strip it immediately (it leaks credentials in shell history).

---

## STATUS

> Update this section at the end of every session. Keep it short.

**Last updated:** 2026-05-01

### Recently shipped
- 2026-04-30: Notification PNG (Pillow) handoff merged into `cards-processor/notification.py` and wired into the daily run. Sent via Telegram `sendPhoto`.
- 2026-04-29: Forex markup rate field on card settings; charts on dashboard; AEP eligible spend fix.
- 2026-04-26: Active toggle, no-wrap rows, description popover, points auto-calc fixes; PDF password field on card settings.

### In progress / pending in this repo
- _Nothing pending in this repo specifically._ Recent active work has been on the backend; see `cards-processor/CLAUDE.md`.

### Open ideas / not started
- _(none recorded — surface here as they come up)_

---

## Conventions

- No emoji in code or commit messages unless Vishal asks.
- Commit messages: short subject (~70 chars), no body unless the change is non-trivial. Existing repo style: imperative mood (`Add`, `Fix`, `Update`).
- No `Co-Authored-By` trailer — Vishal doesn't use it.
- Don't create new files unless necessary; prefer editing existing modules.
- Don't add comments explaining what code does; only add a comment if there's a non-obvious reason a particular line exists.
