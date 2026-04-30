# Cards Tracker — Telegram Notification Graphic Spec

## Goal
Replace the current plain-text Telegram message with a generated PNG image. Send via Telegram `sendPhoto` (with caption) instead of `sendMessage`.

## Stack
- **Pillow (PIL)** only — no Chromium, no external services, no system deps beyond `pip install Pillow`.
- Runs inside the existing GitHub Actions Python script.

## Visual Direction
- **Palette:** Warm terracotta background + soft sage card.
- **Font:** Poppins (Regular, Medium, Bold). Bundle the TTF files in the repo (`fonts/` dir) — do not rely on system fonts in GitHub Actions.
- **Tone:** minimal, soft, compact. Each transaction is a single row, not a card.
- **Removed from old message:** AEP / milestone progress block.

## Color Tokens (RGB)
```
bg          = (232, 200, 180)   # warm terracotta
card        = (224, 232, 220)   # soft sage
ink         = (48, 58, 46)      # primary text
ink_soft    = (118, 132, 114)   # secondary text
muted       = (204, 214, 200)   # divider lines
accent      = (98, 124, 90)     # sage accent (eyebrow dot, "CARDS" label)
accent_soft = (210, 220, 204)   # "all clear" pill bg
warm        = (170, 92, 64)     # "1 new" pill text
warm_soft   = (244, 218, 200)   # "1 new" pill bg
```

## Font Sizes
- Eyebrow ("CARDS"): 11px Bold
- Date heading ("26 April 2026"): 20px Medium
- Pill ("1 new" / "all clear"): 12px Medium
- Section label ("transactions", "statement"): 10px Medium
- Row date ("12 Apr"): 13px Medium
- Card name: 14px Bold
- Merchant + category: 12px Regular
- Amount: 18px Medium
- Footer: 10px Regular

## Layout
- Image: 820 × 420 (transactions) or 820 × 360 (no-new-tx variant). Height should grow with row count.
- Outer padding: 28px.
- Card: rounded rect, radius 20.
- Inner padding inside card: 28px.
- Header divider line at y = pad + 78.
- Row height: 44px. Each row separated by a 1px `muted` line.

### Header structure
- Left: small 8px sage dot, then "CARDS" eyebrow, then date heading on next line.
- Right: status pill — "1 new" (warm_soft bg, warm text) when new transactions, "all clear" (accent_soft bg, accent text) when none.

### Transaction row structure (left to right)
- Date (e.g. "12 Apr") at x = pad + 28
- Card name + merchant·location·category at x = pad + 110 (two lines)
- Amount right-aligned

### Statement footer
- "statement" eyebrow + card name on the left
- Transaction count right-aligned

### No-new-transactions variant
- Replace transactions section with: "No new transactions" (18px Medium, ink) + "All caught up since last check" (12px Light, ink_soft).
- Then an "april mtd" eyebrow and a single MTD row showing card name, statement date, total.

## Telegram delivery
```python
import requests

with open("notification.png", "rb") as photo:
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto",
        data={"chat_id": CHAT_ID, "caption": short_caption_optional},
        files={"photo": photo},
    )
```
Keep an optional short caption (e.g. "26 Apr · 1 new") for notification preview text. Or omit caption entirely.

## Reference implementation
See `notification.py` — it generates the exact mockup the user approved. Use it as the starting point. Wire in real data (transactions list, MTD totals, statement info) by replacing the hardcoded sample data.

## Files in this handoff
- `MOCKUP.png` — the approved visual
- `notification.py` — working Pillow code that generated the mockup
- `SPEC.md` — this document
