# cards-tracker

Personal credit card spend tracker — a static single-page web app backed by Firebase. Tracks transactions, points, statement cycles, voucher trades, and rewards balances across multiple Indian credit cards.

For Claude / AI assistants: read **[CLAUDE.md](CLAUDE.md)** first — it has the architecture, module map, current status, and what to work on next.

## What this is

The **front-end UI** only. Plain HTML + ES-module JS + CSS, no build step, no bundler. Firebase SDK and Chart.js loaded from CDN. Deployed to GitHub Pages.

The backend (daily Gmail/PDF processor, Cloud Function for iOS Shortcut SMS, Telegram notification PNG) lives in a separate repo: [cards-processor](https://github.com/vishal-parwani/cards-processor).

## Run locally

```bash
python3 -m http.server 3456
# Open http://localhost:3456
```

That's it — no `npm install`, no build.
